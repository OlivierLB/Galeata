//! End-to-end transport tests: a fake CLI (`tests/fake_cli.py`) replays a captured
//! session and waits for Galeata's real stdin writes at each recorded input.

use galeata_agent_protocol::{
    Agent, AgentEvent, AgentState, Claude, Codex, Decision, Launch, Protocol, TurnStatus,
};
use serde_json::Value;
use std::sync::mpsc::{channel, Receiver};
use std::sync::Arc;
use std::time::{Duration, Instant};

const TIMEOUT: Duration = Duration::from_secs(20);

fn manifest() -> &'static str {
    env!("CARGO_MANIFEST_DIR")
}

fn fixture_path(name: &str) -> String {
    format!("{}/../../../tests/fixtures/agents/{name}.jsonl", manifest())
}

/// User messages recorded in the fixture, in order.
fn user_turns(name: &str) -> Vec<String> {
    std::fs::read_to_string(fixture_path(name))
        .unwrap()
        .lines()
        .filter(|l| !l.trim().is_empty())
        .map(|l| serde_json::from_str::<Value>(l).unwrap())
        .filter(|r| r["dir"] == "in")
        .filter_map(|r| {
            let msg = &r["msg"];
            msg["message"]["content"]
                .as_str()
                .or(msg["params"]["input"][0]["text"].as_str())
                .map(str::to_owned)
        })
        .collect()
}

fn start(name: &str, protocol: Box<dyn Protocol>) -> (Agent, Receiver<Vec<AgentEvent>>) {
    let (tx, rx) = channel();
    let launch = Launch::new(
        "python3",
        vec![
            "-I".into(),
            format!("{}/tests/fake_cli.py", manifest()),
            fixture_path(name),
        ],
        "/",
    );
    let agent = Agent::spawn(
        launch,
        protocol,
        Arc::new(move |batch| {
            let _ = tx.send(batch);
        }),
    )
    .expect("lancement du faux CLI");
    (agent, rx)
}

/// Drives a whole recorded session: sends each user turn when the agent is
/// ready, approves every request, and returns all events up to `Exited`.
fn drive(name: &str, agent: &Agent, rx: &Receiver<Vec<AgentEvent>>) -> (Vec<AgentEvent>, usize) {
    let mut turns = user_turns(name).into_iter();
    let mut events = Vec::new();
    let mut batches = 0;
    let mut ready = false;
    let deadline = Instant::now() + TIMEOUT;
    loop {
        if ready {
            if let Some(text) = turns.next() {
                agent.send_text(&text).unwrap();
            }
            ready = false;
        }
        let batch = rx
            .recv_timeout(deadline.saturating_duration_since(Instant::now()))
            .unwrap_or_else(|_| panic!("délai dépassé ; événements reçus : {events:#?}"));
        batches += 1;
        for event in batch {
            match &event {
                AgentEvent::State {
                    state: AgentState::Idle,
                } => ready = true,
                AgentEvent::Approval { request_id, .. } => {
                    agent.respond(request_id, Decision::Allow).unwrap()
                }
                _ => {}
            }
            let exited = matches!(event, AgentEvent::Exited { .. });
            events.push(event);
            if exited {
                return (events, batches);
            }
        }
    }
}

fn assert_complete_session(events: &[AgentEvent]) {
    let completed = events
        .iter()
        .filter(|e| {
            matches!(
                e,
                AgentEvent::TurnCompleted {
                    status: TurnStatus::Completed,
                    ..
                }
            )
        })
        .count();
    assert_eq!(completed, 3, "{events:#?}");
    match events.last() {
        Some(AgentEvent::Exited { code: Some(0), .. }) => {}
        other => panic!("fin inattendue : {other:?}"),
    }
    assert!(!events.iter().any(|e| matches!(e, AgentEvent::Error { .. })));
}

#[test]
fn claude_session_runs_end_to_end() {
    let (agent, rx) = start("claude", Box::new(Claude::new("/WORKDIR")));
    let (events, _) = drive("claude", &agent, &rx);
    assert_complete_session(&events);
    assert!(!agent.is_alive());
}

#[test]
fn codex_session_runs_end_to_end_with_batching() {
    let (agent, rx) = start("codex", Box::new(Codex::new("/WORKDIR", None)));
    let (events, batches) = drive("codex", &agent, &rx);
    assert_complete_session(&events);
    let lines = std::fs::read_to_string(fixture_path("codex"))
        .unwrap()
        .lines()
        .count();
    assert!(
        batches < lines / 2,
        "{batches} lots pour {lines} lignes : le regroupement ne fonctionne pas"
    );
}

#[test]
fn stop_terminates_the_whole_process_group() {
    let (tx, rx) = channel();
    let launch = Launch::new(
        "sh",
        vec!["-c".into(), "sleep 60 & sleep 60; wait".into()],
        "/",
    );
    let agent = Agent::spawn(
        launch,
        Box::new(Codex::new("/", None)),
        Arc::new(move |batch| {
            let _ = tx.send(batch);
        }),
    )
    .unwrap();
    let pid = agent.pid();
    std::thread::sleep(Duration::from_millis(200));
    let started = Instant::now();
    agent.stop();
    loop {
        let batch = rx
            .recv_timeout(Duration::from_secs(10))
            .expect("Exited attendu");
        if batch.iter().any(|e| matches!(e, AgentEvent::Exited { .. })) {
            break;
        }
    }
    assert!(started.elapsed() < Duration::from_secs(5));
    assert!(!agent.is_alive());
    // No member of the group survives (kill -0 on the group fails).
    let survivors = std::process::Command::new("pgrep")
        .args(["-g", &pid.to_string()])
        .output()
        .unwrap();
    assert!(
        survivors.stdout.is_empty(),
        "processus restants : {:?}",
        survivors
    );
    assert!(agent.send_text("x").is_err());
}

#[test]
fn missing_program_is_reported_with_its_name() {
    let error = Agent::spawn(
        Launch::new("galeata-cli-inexistant", vec![], "/"),
        Box::new(Codex::new("/", None)),
        Arc::new(|_| {}),
    )
    .err()
    .unwrap();
    assert!(error.contains("galeata-cli-inexistant"), "{error}");
}
