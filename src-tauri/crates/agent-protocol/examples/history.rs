//! Diagnostic: what a resumed conversation would show, without printing its content.
//!
//! cargo run -q -p galeata-agent-protocol --example history -- claude <session-id> <cwd>
//! cargo run -q -p galeata-agent-protocol --example history -- codex  <thread-id>  <cwd>
//!
//! Claude: reads ~/.claude/projects/*/<session-id>.jsonl. Codex: really starts
//! `codex app-server` and resumes the thread (no model call), then stops it.

use galeata_agent_protocol::{claude_history, Agent, AgentEvent, AgentState, Codex, Launch};
use std::collections::BTreeMap;
use std::sync::mpsc::channel;
use std::sync::Arc;
use std::time::{Duration, Instant};

fn summarize(events: &[AgentEvent]) {
    let mut counts = BTreeMap::new();
    for event in events {
        let kind = serde_json::to_value(event).unwrap()["type"]
            .as_str()
            .unwrap()
            .to_owned();
        *counts.entry(kind).or_insert(0) += 1;
    }
    println!("événements : {counts:?}");
    let bytes = serde_json::to_string(events).unwrap().len();
    println!(
        "taille envoyée à l’interface : {:.1} Kio",
        bytes as f64 / 1024.0
    );
    let first_user = events.iter().find_map(|e| match e {
        AgentEvent::UserMessage { text, .. } => Some(text.chars().take(60).collect::<String>()),
        _ => None,
    });
    println!("premier message utilisateur : {first_user:?}");
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let [provider, id, cwd] = args.as_slice() else {
        eprintln!("usage : history claude|codex <id> <cwd>");
        std::process::exit(2);
    };
    let started = Instant::now();
    if provider == "claude" {
        let home = std::env::var("HOME").unwrap();
        let path = std::fs::read_dir(format!("{home}/.claude/projects"))
            .unwrap()
            .flatten()
            .map(|e| e.path().join(format!("{id}.jsonl")))
            .find(|p| p.is_file())
            .expect("transcript introuvable");
        let text = std::fs::read_to_string(&path).unwrap();
        let events = claude_history(&text, cwd);
        println!("lecture + analyse : {:?}", started.elapsed());
        summarize(&events);
        return;
    }
    let (tx, rx) = channel();
    let agent = Agent::spawn(
        Launch::new("codex", vec!["app-server".into()], cwd),
        Box::new(Codex::new(cwd, Some(id))),
        Arc::new(move |batch| {
            let _ = tx.send(batch);
        }),
    )
    .expect("codex app-server");
    let mut events = Vec::new();
    let deadline = Instant::now() + Duration::from_secs(30);
    'wait: while let Ok(batch) = rx.recv_timeout(deadline.saturating_duration_since(Instant::now()))
    {
        for event in batch {
            let idle = matches!(
                event,
                AgentEvent::State {
                    state: AgentState::Idle
                }
            );
            events.push(event);
            if idle {
                break 'wait;
            }
        }
    }
    println!("reprise jusqu’à « prêt » : {:?}", started.elapsed());
    agent.stop();
    summarize(&events);
}
