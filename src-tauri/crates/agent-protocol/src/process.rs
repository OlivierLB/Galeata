//! Agent process transport: spawns the CLI in its own process group, feeds its
//! stdout lines to a [`Protocol`], writes the protocol's replies to stdin and
//! delivers events to a sink in coalesced batches.
//!
//! Batching policy (latency first, then throughput): a batch is flushed as soon
//! as the reader has consumed everything already received (the agent paused),
//! or after 16 ms / 512 events during a burst. Tauri-independent so it can be
//! tested with a fake CLI.

use crate::event::{coalesce, AgentEvent};
use crate::{head, Decision, Output, Protocol};
use std::io::{BufRead, BufReader, Read, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

pub type Sink = Arc<dyn Fn(Vec<AgentEvent>) + Send + Sync>;

const FLUSH_AFTER: Duration = Duration::from_millis(16);
const FLUSH_EVENTS: usize = 512;
const STDERR_TAIL: usize = 16 * 1024;
const STOP_GRACE: Duration = Duration::from_secs(3);

/// How to start an agent CLI. Arguments never pass through a shell.
#[derive(Debug, Clone)]
pub struct Launch {
    pub program: String,
    pub args: Vec<String>,
    pub cwd: PathBuf,
    pub env: Vec<(String, String)>,
    /// Longest accepted stdout line; longer lines are skipped and reported.
    pub max_line: usize,
}

impl Launch {
    pub fn new(program: impl Into<String>, args: Vec<String>, cwd: impl Into<PathBuf>) -> Self {
        Self {
            program: program.into(),
            args,
            cwd: cwd.into(),
            env: Vec::new(),
            max_line: 32 * 1024 * 1024,
        }
    }
}

struct Inner {
    protocol: Mutex<Box<dyn Protocol>>,
    stdin: Mutex<Option<ChildStdin>>,
    child: Mutex<Child>,
    sink: Sink,
    alive: AtomicBool,
    pid: u32,
}

/// A running agent. Dropping it does not stop the process: call [`Agent::stop`].
#[derive(Clone)]
pub struct Agent {
    inner: Arc<Inner>,
}

impl Agent {
    pub fn spawn(
        launch: Launch,
        mut protocol: Box<dyn Protocol>,
        sink: Sink,
    ) -> Result<Self, String> {
        let mut command = Command::new(&launch.program);
        command
            .args(&launch.args)
            .current_dir(&launch.cwd)
            // Never leak the AppImage runtime (PYTHONHOME, LD_LIBRARY_PATH…) to the agent.
            .env_clear()
            .envs(crate::host_env(std::env::vars_os()))
            .envs(launch.env.iter().map(|(k, v)| (k, v)))
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        #[cfg(unix)]
        {
            use std::os::unix::process::CommandExt;
            command.process_group(0);
        }
        let mut child = command
            .spawn()
            .map_err(|e| format!("Impossible de lancer {} : {e}", launch.program))?;
        let stdout = child
            .stdout
            .take()
            .ok_or("stdout de l’agent indisponible")?;
        let stderr = child
            .stderr
            .take()
            .ok_or("stderr de l’agent indisponible")?;
        let stdin = child.stdin.take();
        let start = protocol.start();
        let inner = Arc::new(Inner {
            protocol: Mutex::new(protocol),
            stdin: Mutex::new(stdin),
            pid: child.id(),
            child: Mutex::new(child),
            sink,
            alive: AtomicBool::new(true),
        });
        let agent = Self { inner };
        agent.apply(start);

        let stderr_tail = Arc::new(Mutex::new(Vec::<u8>::new()));
        let tail_writer = Arc::clone(&stderr_tail);
        std::thread::Builder::new()
            .name("agent-stderr".into())
            .spawn(move || collect_tail(stderr, &tail_writer))
            .map_err(|e| e.to_string())?;
        let reader_agent = agent.clone();
        std::thread::Builder::new()
            .name("agent-stdout".into())
            .spawn(move || reader_agent.read_loop(stdout, launch.max_line, stderr_tail))
            .map_err(|e| e.to_string())?;
        Ok(agent)
    }

    pub fn pid(&self) -> u32 {
        self.inner.pid
    }

    pub fn is_alive(&self) -> bool {
        self.inner.alive.load(Ordering::Acquire)
    }

    pub fn send_text(&self, text: &str) -> Result<(), String> {
        self.ensure_alive()?;
        let out = self.protocol()?.send_text(text);
        self.apply(out);
        Ok(())
    }
    pub fn send_images(&self, text: &str, images: &[String]) -> Result<(), String> {
        self.ensure_alive()?;
        let out = self.protocol()?.send_images(text, images);
        self.apply(out);
        Ok(())
    }

    pub fn respond(&self, request_id: &str, decision: Decision) -> Result<(), String> {
        self.ensure_alive()?;
        let out = self.protocol()?.respond(request_id, decision)?;
        self.apply(out);
        Ok(())
    }

    pub fn answer(&self, request_id: &str, answer: crate::Answer) -> Result<(), String> {
        self.ensure_alive()?;
        let out = self.protocol()?.answer(request_id, answer)?;
        self.apply(out);
        Ok(())
    }

    pub fn set_mode(&self, mode: &str) -> Result<(), String> {
        self.ensure_alive()?;
        let out = self.protocol()?.set_mode(mode)?;
        self.apply(out);
        Ok(())
    }

    pub fn models(&self) -> Result<(), String> {
        self.ensure_alive()?;
        let out = self.protocol()?.models();
        self.apply(out);
        Ok(())
    }

    pub fn set_model(&self, model: &str) -> Result<(), String> {
        self.ensure_alive()?;
        let out = self.protocol()?.set_model(model)?;
        self.apply(out);
        Ok(())
    }

    pub fn interrupt(&self) -> Result<(), String> {
        self.ensure_alive()?;
        let out = self.protocol()?.interrupt();
        self.apply(out);
        Ok(())
    }

    pub fn compact(&self) -> Result<(), String> {
        self.ensure_alive()?;
        let out = self.protocol()?.compact()?;
        self.apply(out);
        Ok(())
    }

    /// Closes stdin, then terminates the whole process group (SIGTERM, then
    /// SIGKILL after a grace period). Returns immediately.
    pub fn stop(&self) {
        if let Ok(mut stdin) = self.inner.stdin.lock() {
            stdin.take();
        }
        if !self.is_alive() {
            return;
        }
        signal_group(self.inner.pid, Signal::Term);
        let inner = Arc::clone(&self.inner);
        let _ = std::thread::Builder::new()
            .name("agent-stop".into())
            .spawn(move || {
                let deadline = Instant::now() + STOP_GRACE;
                while inner.alive.load(Ordering::Acquire) && Instant::now() < deadline {
                    std::thread::sleep(Duration::from_millis(50));
                }
                if inner.alive.load(Ordering::Acquire) {
                    signal_group(inner.pid, Signal::Kill);
                }
            });
    }

    fn ensure_alive(&self) -> Result<(), String> {
        if self.is_alive() {
            Ok(())
        } else {
            Err("L’agent est arrêté : relancez la conversation".into())
        }
    }

    fn protocol(&self) -> Result<std::sync::MutexGuard<'_, Box<dyn Protocol>>, String> {
        self.inner.protocol.lock().map_err(|e| e.to_string())
    }

    /// Writes the protocol's lines, then forwards its events immediately
    /// (user actions are rare and must feel instant).
    fn apply(&self, out: Output) {
        let mut events = out.events;
        if let Err(error) = self.write(&out.writes) {
            events.push(AgentEvent::Error { message: error });
        }
        if !events.is_empty() {
            (self.inner.sink)(events);
        }
    }

    fn write(&self, lines: &[String]) -> Result<(), String> {
        if lines.is_empty() {
            return Ok(());
        }
        let mut guard = self.inner.stdin.lock().map_err(|e| e.to_string())?;
        let stdin = guard.as_mut().ok_or("Entrée de l’agent fermée")?;
        let mut buffer = Vec::with_capacity(lines.iter().map(|l| l.len() + 1).sum());
        for line in lines {
            buffer.extend_from_slice(line.as_bytes());
            buffer.push(b'\n');
        }
        stdin
            .write_all(&buffer)
            .and_then(|_| stdin.flush())
            .map_err(|e| format!("Écriture vers l’agent impossible : {e}"))
    }

    fn read_loop(self, stdout: impl Read, max_line: usize, stderr_tail: Arc<Mutex<Vec<u8>>>) {
        let mut reader = BufReader::with_capacity(256 * 1024, stdout);
        let mut line = Vec::with_capacity(64 * 1024);
        let mut batch: Vec<AgentEvent> = Vec::new();
        let mut batch_started: Option<Instant> = None;
        loop {
            line.clear();
            let read = match read_bounded_line(&mut reader, &mut line, max_line) {
                Ok(read) => read,
                Err(error) => {
                    batch.push(AgentEvent::Error {
                        message: format!("Lecture de l’agent interrompue : {error}"),
                    });
                    break;
                }
            };
            match read {
                LineRead::Eof => break,
                LineRead::TooLong(size) => batch.push(AgentEvent::Notice {
                    message: format!(
                        "Message de l’agent ignoré : {size} octets dépassent la limite"
                    ),
                }),
                LineRead::Line => {
                    let text = String::from_utf8_lossy(&line);
                    let text = text.trim_end_matches(['\n', '\r']);
                    if text.is_empty() {
                        continue;
                    }
                    let out = match self.protocol() {
                        Ok(mut protocol) => protocol.handle_line(text),
                        Err(error) => {
                            batch.push(AgentEvent::Error { message: error });
                            break;
                        }
                    };
                    if let Err(error) = self.write(&out.writes) {
                        batch.push(AgentEvent::Error { message: error });
                    }
                    batch.extend(out.events);
                }
            }
            if batch.is_empty() {
                continue;
            }
            let started = *batch_started.get_or_insert_with(Instant::now);
            if reader.buffer().is_empty()
                || batch.len() >= FLUSH_EVENTS
                || started.elapsed() >= FLUSH_AFTER
            {
                coalesce(&mut batch);
                (self.inner.sink)(std::mem::take(&mut batch));
                batch_started = None;
            }
        }
        if let Ok(mut stdin) = self.inner.stdin.lock() {
            stdin.take();
        }
        let code = self
            .inner
            .child
            .lock()
            .ok()
            .and_then(|mut child| child.wait().ok())
            .and_then(|status| status.code());
        self.inner.alive.store(false, Ordering::Release);
        // The stderr thread ends with the process; give it a moment to drain.
        std::thread::sleep(Duration::from_millis(20));
        let stderr = stderr_tail
            .lock()
            .map(|bytes| String::from_utf8_lossy(&bytes).trim().to_owned())
            .unwrap_or_default();
        coalesce(&mut batch);
        batch.push(AgentEvent::Exited {
            code,
            stderr: (!stderr.is_empty()).then(|| head(&stderr, STDERR_TAIL)),
        });
        (self.inner.sink)(batch);
    }
}

enum LineRead {
    Line,
    TooLong(usize),
    Eof,
}

/// Reads one `\n`-terminated line without ever buffering more than `max` bytes.
fn read_bounded_line(
    reader: &mut impl BufRead,
    line: &mut Vec<u8>,
    max: usize,
) -> std::io::Result<LineRead> {
    let mut total = 0usize;
    loop {
        let available = match reader.fill_buf() {
            Ok(available) => available,
            Err(e) if e.kind() == std::io::ErrorKind::Interrupted => continue,
            Err(e) => return Err(e),
        };
        if available.is_empty() {
            return Ok(if total == 0 {
                LineRead::Eof
            } else if total > max {
                LineRead::TooLong(total)
            } else {
                LineRead::Line
            });
        }
        let (chunk, done) = match available.iter().position(|b| *b == b'\n') {
            Some(end) => (end + 1, true),
            None => (available.len(), false),
        };
        if total + chunk <= max {
            line.extend_from_slice(&available[..chunk]);
        } else {
            line.clear();
        }
        total += chunk;
        reader.consume(chunk);
        if done {
            return Ok(if total > max {
                LineRead::TooLong(total)
            } else {
                LineRead::Line
            });
        }
    }
}

fn collect_tail(mut stderr: impl Read, tail: &Mutex<Vec<u8>>) {
    let mut buffer = [0u8; 8192];
    while let Ok(read) = stderr.read(&mut buffer) {
        if read == 0 {
            break;
        }
        if let Ok(mut tail) = tail.lock() {
            tail.extend_from_slice(&buffer[..read]);
            if tail.len() > STDERR_TAIL {
                let excess = tail.len() - STDERR_TAIL;
                tail.drain(..excess);
            }
        }
    }
}

enum Signal {
    Term,
    Kill,
}

fn signal_group(pid: u32, signal: Signal) {
    #[cfg(unix)]
    {
        let signal = match signal {
            Signal::Term => libc::SIGTERM,
            Signal::Kill => libc::SIGKILL,
        };
        // SAFETY: plain syscall; the group id is the child's pid (process_group(0)).
        unsafe {
            libc::killpg(pid as libc::pid_t, signal);
        }
    }
    #[cfg(not(unix))]
    {
        let _ = (pid, signal);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bounded_reader_skips_oversized_lines_and_keeps_the_next() {
        let data = format!("{}\nok\npartial", "x".repeat(100));
        let mut reader = BufReader::with_capacity(16, data.as_bytes());
        let mut line = Vec::new();
        assert!(matches!(
            read_bounded_line(&mut reader, &mut line, 10).unwrap(),
            LineRead::TooLong(101)
        ));
        line.clear();
        assert!(matches!(
            read_bounded_line(&mut reader, &mut line, 10).unwrap(),
            LineRead::Line
        ));
        assert_eq!(line, b"ok\n");
        line.clear();
        assert!(matches!(
            read_bounded_line(&mut reader, &mut line, 10).unwrap(),
            LineRead::Line
        ));
        assert_eq!(line, b"partial");
        line.clear();
        assert!(matches!(
            read_bounded_line(&mut reader, &mut line, 10).unwrap(),
            LineRead::Eof
        ));
    }
}
