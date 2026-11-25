//! Builds the browser-preview demo conversation from captured fixtures: the
//! normalized, batched events Galeata's UI would receive, grouped by user turn.
//!
//! ```sh
//! # from src-tauri; fixtures are read from tests/fixtures/agents/
//! cargo run -q -p galeata-agent-protocol --example demo -- \
//!     claude claude-question claude-plan > ../src/preview/agent-demo.json
//! ```

use galeata_agent_protocol::{coalesce, AgentEvent, Answer, Claude, Codex, Decision, Protocol};
use serde_json::{json, Value};

/// Rebuilds the user's recorded answer (plan approval, question answers, permission).
fn replay_answer(protocol: &mut dyn Protocol, msg: &Value) -> Vec<AgentEvent> {
    let id = msg["response"]["request_id"].as_str().unwrap_or_default();
    let response = &msg["response"]["response"];
    let result = if let Some(answers) = response["updatedInput"]["answers"].as_object() {
        protocol.answer(
            id,
            Answer::Questions(
                answers
                    .iter()
                    .map(|(q, a)| (q.clone(), vec![a.as_str().unwrap_or_default().to_owned()]))
                    .collect(),
            ),
        )
    } else if response["updatedPermissions"][0]["type"] == "setMode" {
        protocol.answer(
            id,
            Answer::Plan {
                approve: true,
                accept_edits: response["updatedPermissions"][0]["mode"] == "acceptEdits",
                feedback: None,
            },
        )
    } else {
        protocol.respond(id, Decision::Allow)
    };
    result.map(|o| o.events).unwrap_or_default()
}

fn main() {
    let mut names: Vec<String> = std::env::args().skip(1).collect();
    if names.is_empty() {
        names = vec!["claude".into()];
    }
    let mut turns: Vec<Value> = Vec::new();
    for name in &names {
        let path = format!(
            "{}/../../../tests/fixtures/agents/{name}.jsonl",
            env!("CARGO_MANIFEST_DIR")
        );
        let text = std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{path} : {e}"));
        let mut protocol: Box<dyn Protocol> = if name.starts_with("codex") {
            Box::new(Codex::new("/WORKDIR", None))
        } else {
            Box::new(Claude::new("/WORKDIR"))
        };
        let mut batches: Vec<Vec<AgentEvent>> = Vec::new();
        let mut user: Option<String> = None;
        let mut flush = |user: &mut Option<String>, batches: &mut Vec<Vec<AgentEvent>>| {
            if let Some(text) = user.take() {
                turns.push(json!({"user": text, "batches": std::mem::take(batches)}));
            } else {
                batches.clear();
            }
        };
        for line in text.lines().filter(|l| !l.trim().is_empty()) {
            let record: Value = serde_json::from_str(line).expect("ligne JSON");
            let msg = &record["msg"];
            let mut events = if record["dir"] == "in" {
                let content = msg["message"]["content"]
                    .as_str()
                    .or(msg["params"]["input"][0]["text"].as_str());
                if let Some(content) = content {
                    flush(&mut user, &mut batches);
                    user = Some(content.to_owned());
                    protocol.send_text(content).events
                } else if msg["type"] == "control_response" {
                    replay_answer(protocol.as_mut(), msg)
                } else if msg["id"].is_number()
                    && msg.get("result").is_some()
                    && msg.get("method").is_none()
                {
                    protocol
                        .respond(&msg["id"].to_string(), Decision::Allow)
                        .map(|o| o.events)
                        .unwrap_or_default()
                } else if msg["type"] == "control_request" || msg["method"] == "initialize" {
                    protocol.start().events
                } else {
                    Vec::new()
                }
            } else {
                protocol.handle_line(&msg.to_string()).events
            };
            coalesce(&mut events);
            if !events.is_empty() {
                batches.push(events);
            }
        }
        flush(&mut user, &mut batches);
    }
    println!(
        "{}",
        serde_json::to_string(
            &json!({"provider": "claude", "source": "captures réelles anonymisées", "turns": turns})
        )
        .unwrap()
    );
}
