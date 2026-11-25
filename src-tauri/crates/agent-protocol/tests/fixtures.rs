//! Replays the captured CLI sessions (`tests/fixtures/agents/*.jsonl`, produced by
//! `scripts/capture-agent-protocol.mjs`) through the adapters.
//! Inbound user actions are replayed through the adapter API, and the lines the
//! adapter writes for approvals must equal what the real CLI accepted.

use galeata_agent_protocol::{
    coalesce, AgentEvent, AgentState, Answer, ApprovalKind, Claude, Codex, Decision, Protocol,
    ToolKind, TurnStatus,
};
use serde_json::Value;
use std::collections::HashMap;
use std::time::Instant;

fn fixture(name: &str) -> Vec<Value> {
    let path = format!(
        "{}/../../../tests/fixtures/agents/{name}.jsonl",
        env!("CARGO_MANIFEST_DIR")
    );
    std::fs::read_to_string(&path)
        .unwrap_or_else(|e| panic!("fixture {path} illisible : {e}"))
        .lines()
        .filter(|l| !l.trim().is_empty())
        .map(|l| serde_json::from_str(l).expect("ligne de fixture JSON"))
        .collect()
}

fn json(line: &str) -> Value {
    serde_json::from_str(line).unwrap()
}

#[test]
fn claude_lists_models_and_only_confirms_a_switch_after_acknowledgement() {
    let mut claude = Claude::new("/WORKDIR");
    claude.start();
    let initialized = claude.handle_line(r#"{"type":"control_response","response":{"subtype":"success","request_id":"galeata-init","response":{"models":[{"value":"sonnet","displayName":"Sonnet","description":"Efficient","resolvedModel":"claude-sonnet"},{"value":"opus","displayName":"Opus","description":"Complex tasks","resolvedModel":"claude-opus"}]}}}"#);
    assert!(initialized.events.iter().any(|event| matches!(event,
        AgentEvent::Models { models } if models.len() == 2 && models[0].id == "sonnet")));
    let change = claude.set_model("opus").unwrap();
    assert!(change.events.is_empty());
    let request = json(&change.writes[0]);
    assert_eq!(request["request"]["subtype"], "set_model");
    assert_eq!(request["request"]["model"], "opus");
    let confirmed = claude.handle_line(
        &serde_json::json!({
            "type":"control_response", "response": {
                "subtype":"success", "request_id":request["request_id"]
            }
        })
        .to_string(),
    );
    assert!(confirmed.events.iter().any(|event| matches!(event,
        AgentEvent::Model { model } if model == "opus")));
    let refused = claude.set_model("sonnet").unwrap();
    let request = json(&refused.writes[0]);
    let failed = claude.handle_line(
        &serde_json::json!({
            "type":"control_response", "response": {
                "subtype":"error", "request_id":request["request_id"], "error":"Unavailable"
            }
        })
        .to_string(),
    );
    assert!(failed
        .events
        .iter()
        .any(|event| matches!(event, AgentEvent::Error { .. })));
    assert!(!failed
        .events
        .iter()
        .any(|event| matches!(event, AgentEvent::Model { .. })));
    assert!(claude.set_model("unknown").is_err());
    claude.send_text("Work");
    assert!(claude.set_model("opus").is_err());
}

#[test]
fn codex_model_catalog_is_paginated_and_selected_model_is_sent_with_the_next_turn() {
    let mut codex = Codex::new("/WORKDIR", None);
    codex.start();
    assert!(
        codex.models().writes.is_empty(),
        "catalog waits for initialization"
    );
    codex.handle_line(r#"{"id":1,"result":{}}"#);
    let initialized =
        codex.handle_line(r#"{"id":2,"result":{"thread":{"id":"thread-1"},"model":"model-a"}}"#);
    let request = json(&initialized.writes[0]);
    assert_eq!(request["method"], "model/list");
    let next = codex.handle_line(
        &serde_json::json!({
            "id":request["id"], "result":{
                "data":[{"id":"row-a","model":"model-a","displayName":"Model A","isDefault":true}],
                "nextCursor":"next-page"
            }
        })
        .to_string(),
    );
    let request = json(&next.writes[0]);
    assert_eq!(request["params"]["cursor"], "next-page");
    let listed = codex.handle_line(
        &serde_json::json!({
            "id":request["id"], "result":{
                "data":[
                    {"id":"row-b","model":"model-b","displayName":"Model B","description":"Faster"},
                    {"model":"hidden-model","hidden":true}
                ], "nextCursor":null
            }
        })
        .to_string(),
    );
    assert!(listed.events.iter().any(|event| matches!(event,
        AgentEvent::Models { models } if models.len() == 2 && models[1].id == "model-b")));
    assert!(codex.set_model("hidden-model").is_err());
    let changed = codex.set_model("model-b").unwrap();
    assert!(changed.events.iter().any(|event| matches!(event,
        AgentEvent::Model { model } if model == "model-b")));
    let turn = codex.send_text("Work");
    let request = json(&turn.writes[0]);
    assert_eq!(request["method"], "turn/start");
    assert_eq!(request["params"]["model"], "model-b");
    assert!(codex.set_model("model-a").is_err());
}

#[test]
fn codex_rejected_turn_completes_and_allows_a_new_turn() {
    let mut codex = Codex::new("/WORKDIR", None);
    codex.start();
    codex.handle_line(r#"{"id":1,"result":{}}"#);
    codex.handle_line(r#"{"id":2,"result":{"thread":{"id":"thread-1"}}}"#);
    let started = codex.send_text("First request");
    assert!(started
        .events
        .iter()
        .any(|e| matches!(e, AgentEvent::TurnStarted)));
    let request = json(&started.writes[0]);
    let rejected = codex.handle_line(
        &serde_json::json!({
            "id": request["id"],
            "error": {"code": -32602, "message": "Invalid turn parameters"}
        })
        .to_string(),
    );
    assert!(rejected.events.iter().any(|e| matches!(e,
        AgentEvent::TurnCompleted { status: TurnStatus::Failed, error: Some(message), .. }
        if message.contains("Invalid turn parameters"))));
    assert!(rejected.events.iter().any(|e| matches!(
        e,
        AgentEvent::State {
            state: AgentState::Idle
        }
    )));
    assert!(!rejected
        .events
        .iter()
        .any(|e| matches!(e, AgentEvent::Error { .. })));
    let retried = codex.send_text("Second request");
    assert_eq!(retried.writes.len(), 1);
    let retry = json(&retried.writes[0]);
    assert_eq!(retry["method"], "turn/start");
    assert_eq!(retry["params"]["input"][0]["text"], "Second request");
}

#[test]
fn codex_plan_mode_is_native_and_is_reset_when_leaving_plan() {
    let mut codex = Codex::new("/WORKDIR", None);
    let init = codex.start();
    assert_eq!(
        json(&init.writes[0])["params"]["capabilities"]["experimentalApi"],
        true
    );
    codex.handle_line(r#"{"id":1,"result":{}}"#);
    codex.handle_line(r#"{"id":2,"result":{"thread":{"id":"t"},"model":"model-a"}}"#);
    codex.set_mode("plan").unwrap();
    let turn = json(&codex.send_text("Explore first").writes[0]);
    assert_eq!(turn["params"]["collaborationMode"]["mode"], "plan");
    assert_eq!(
        turn["params"]["collaborationMode"]["settings"]["model"],
        "model-a"
    );
    assert!(turn["params"]["collaborationMode"]["settings"]["developer_instructions"].is_null());
    assert_eq!(turn["params"]["sandboxPolicy"]["type"], "readOnly");
    codex.handle_line(
        r#"{"method":"turn/completed","params":{"turn":{"id":"u","status":"completed"}}}"#,
    );
    codex.set_mode("auto").unwrap();
    let turn = json(&codex.send_text("Implement").writes[0]);
    assert_eq!(turn["params"]["collaborationMode"]["mode"], "default");
    assert_eq!(turn["params"]["sandboxPolicy"]["type"], "workspaceWrite");
}

#[test]
fn native_compaction_is_idle_only_and_recovers_from_failure() {
    let mut claude = Claude::new("/WORKDIR");
    assert!(claude.compact().is_err());
    claude.start();
    claude.handle_line(r#"{"type":"control_response","response":{"subtype":"success","request_id":"galeata-init","response":{}}}"#);
    let compact = claude.compact().unwrap();
    assert_eq!(json(&compact.writes[0])["message"]["content"], "/compact");
    assert!(claude.compact().is_err());

    let mut codex = Codex::new("/WORKDIR", None);
    assert!(codex.compact().is_err());
    codex.start();
    codex.handle_line(r#"{"id":1,"result":{}}"#);
    codex.handle_line(r#"{"id":2,"result":{"thread":{"id":"t"}}}"#);
    let compact = json(&codex.compact().unwrap().writes[0]);
    assert_eq!(compact["method"], "thread/compact/start");
    assert_eq!(compact["params"]["threadId"], "t");
    assert!(codex.compact().is_err());
    let failed = codex.handle_line(
        &serde_json::json!({"id":compact["id"],"error":{"message":"unavailable"}}).to_string(),
    );
    assert!(failed.events.iter().any(|event| matches!(
        event,
        AgentEvent::TurnCompleted {
            status: TurnStatus::Failed,
            ..
        }
    )));
    let compact = json(&codex.compact().unwrap().writes[0]);
    codex.handle_line(&serde_json::json!({"id":compact["id"],"result":{}}).to_string());
    codex.send_text("Queued during compaction");
    let completed = codex.handle_line(
        r#"{"method":"turn/completed","params":{"turn":{"id":"u","status":"completed"}}}"#,
    );
    let turn = json(&completed.writes[0]);
    assert_eq!(turn["method"], "turn/start");
    assert_eq!(
        turn["params"]["input"][0]["text"],
        "Queued during compaction"
    );
}

/// Every streamed message must end with a final text equal to its deltas, and a
/// well-formed capture must not produce any "unreadable line" notice.
fn assert_deltas_match_messages(events: &[AgentEvent]) {
    let unreadable = events
        .iter()
        .filter(|e| matches!(e, AgentEvent::Notice { message } if message.starts_with('{')))
        .collect::<Vec<_>>();
    assert!(
        unreadable.is_empty(),
        "lignes non comprises : {unreadable:#?}"
    );
    let mut streamed: HashMap<&str, String> = HashMap::new();
    let mut checked = 0;
    for event in events {
        match event {
            AgentEvent::TextDelta { item_id, text } => {
                streamed.entry(item_id).or_default().push_str(text)
            }
            AgentEvent::Message { item_id, text } => {
                if let Some(deltas) = streamed.get(item_id.as_str()) {
                    assert_eq!(deltas, text, "deltas ≠ message final pour {item_id}");
                    checked += 1;
                }
            }
            _ => {}
        }
    }
    assert!(
        checked >= 2,
        "trop peu de messages streamés vérifiés ({checked})"
    );
}

fn replay_claude(records: &[Value]) -> (Vec<AgentEvent>, Claude) {
    let mut claude = Claude::new("/WORKDIR");
    let mut events = Vec::new();
    for record in records {
        let msg = &record["msg"];
        if record["dir"] == "in" {
            match msg["type"].as_str() {
                Some("user") => {
                    let out = claude.send_text(msg["message"]["content"].as_str().unwrap());
                    events.extend(out.events);
                }
                Some("control_request") => {
                    let out = claude.start();
                    assert_eq!(out.writes.len(), 1);
                    assert_eq!(json(&out.writes[0])["request"], msg["request"]);
                    events.extend(out.events);
                }
                Some("control_response") => {
                    let id = msg["response"]["request_id"].as_str().unwrap();
                    let out = claude.respond(id, Decision::Allow).unwrap();
                    assert_eq!(
                        json(&out.writes[0]),
                        *msg,
                        "réponse d’autorisation différente"
                    );
                    events.extend(out.events);
                }
                other => panic!("entrée inattendue {other:?}"),
            }
        } else {
            events.extend(claude.handle_line(&msg.to_string()).events);
        }
    }
    (events, claude)
}

#[test]
fn claude_session_is_normalized() {
    let records = fixture("claude");
    let (events, _) = replay_claude(&records);
    assert_deltas_match_messages(&events);

    assert!(events.iter().any(|e| matches!(e,
        AgentEvent::Session { model: Some(m), .. } if m.starts_with("claude"))));
    assert_eq!(
        events
            .iter()
            .filter(|e| matches!(e, AgentEvent::Session { .. }))
            .count(),
        1,
        "system/init est réémis à chaque tour mais ne doit produire qu’une session"
    );
    let read = events.iter().find_map(|e| match e {
        AgentEvent::ToolStarted {
            item_id,
            tool: ToolKind::FileRead,
            path,
            ..
        } => Some((item_id.clone(), path.clone())),
        _ => None,
    });
    let (read_id, read_path) = read.expect("lecture de hello.txt");
    assert_eq!(read_path.as_deref(), Some("hello.txt"));
    assert!(events.iter().any(|e| matches!(e,
        AgentEvent::ToolCompleted { item_id, ok: true, output: Some(o) }
            if *item_id == read_id && o.contains("Bonjour depuis Galeata"))));
    assert!(events.iter().any(|e| matches!(e,
        AgentEvent::Approval { kind: ApprovalKind::FileChange, title, detail: Some(d), .. }
            if title == "out.txt" && d == "galeata")));
    let turns = events
        .iter()
        .filter_map(|e| match e {
            AgentEvent::TurnCompleted {
                status, cost_usd, ..
            } => Some((*status, *cost_usd)),
            _ => None,
        })
        .collect::<Vec<_>>();
    assert_eq!(turns.len(), 3);
    assert!(turns
        .iter()
        .all(|(status, cost)| *status == TurnStatus::Completed && cost.is_some()));
    assert_eq!(
        events
            .iter()
            .filter(|e| matches!(e, AgentEvent::TurnStarted))
            .count(),
        3
    );
    let last_state = events.iter().rev().find_map(|e| match e {
        AgentEvent::State { state } => Some(*state),
        _ => None,
    });
    assert_eq!(last_state, Some(AgentState::Idle));
}

fn replay_codex(records: &[Value]) -> Vec<AgentEvent> {
    let mut codex = Codex::new("/WORKDIR", None);
    let mut events = Vec::new();
    for record in records {
        let msg = &record["msg"];
        if record["dir"] == "in" {
            match (msg["method"].as_str(), &msg["id"]) {
                (Some("initialize"), _) => {
                    let out = codex.start();
                    assert_eq!(json(&out.writes[0])["method"], "initialize");
                    assert_eq!(json(&out.writes[0])["id"], msg["id"]);
                    events.extend(out.events);
                }
                (Some("turn/start"), _) => {
                    let text = msg["params"]["input"][0]["text"].as_str().unwrap();
                    let out = codex.send_text(text);
                    let written = json(&out.writes[0]);
                    assert_eq!(written["id"], msg["id"], "numérotation JSON-RPC décalée");
                    assert_eq!(written["params"]["input"], msg["params"]["input"]);
                    events.extend(out.events);
                }
                (None, id) if !id.is_null() => {
                    let out = codex.respond(&id.to_string(), Decision::Allow).unwrap();
                    assert_eq!(
                        json(&out.writes[0]),
                        *msg,
                        "réponse d’approbation différente"
                    );
                    events.extend(out.events);
                }
                // initialized / thread/start are produced by the adapter itself.
                _ => {}
            }
        } else {
            events.extend(codex.handle_line(&msg.to_string()).events);
        }
    }
    events
}

#[test]
fn codex_session_is_normalized() {
    let records = fixture("codex");
    let events = replay_codex(&records);
    assert_deltas_match_messages(&events);

    assert!(events
        .iter()
        .any(|e| matches!(e, AgentEvent::Session { model: Some(_), .. })));
    assert!(events.iter().any(|e| matches!(e,
        AgentEvent::ToolStarted { tool: ToolKind::Command, title, .. } if title.contains("hello.txt"))));
    assert!(events.iter().any(|e| matches!(e,
        AgentEvent::Approval { kind: ApprovalKind::FileChange, title, .. } if title == "out.txt")));
    assert!(events.iter().any(|e| matches!(e,
        AgentEvent::FileChanges { changes, .. }
            if changes.len() == 1 && changes[0].path == "out.txt" && changes[0].kind == "add")));
    assert!(events.iter().any(|e| matches!(e,
        AgentEvent::TurnDiff { diff } if diff.contains("+galeata"))));
    let turns = events
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
    assert_eq!(turns, 3);
    // Hooks, rate limits, MCP startup… never reach the UI.
    let out_lines = records.iter().filter(|r| r["dir"] == "out").count();
    assert!(
        events.len() < out_lines,
        "{} événements pour {} lignes : le bruit n’est pas filtré",
        events.len(),
        out_lines
    );
    assert!(!events.iter().any(|e| matches!(e, AgentEvent::Error { .. })));
}

#[test]
fn coalescing_divides_streaming_events() {
    let mut events = replay_codex(&fixture("codex"));
    let before = events.len();
    coalesce(&mut events);
    assert!(events.len() < before);
    assert_deltas_match_messages(&events);
}

#[test]
fn unknown_approval_is_reported() {
    let mut codex = Codex::new("/w", None);
    assert!(codex.respond("42", Decision::Allow).is_err());
    let mut claude = Claude::new("/w");
    assert!(claude.respond("x", Decision::Deny).is_err());
}

#[test]
fn codex_queues_messages_until_thread_is_ready() {
    let mut codex = Codex::new("/w", None);
    let start = codex.start();
    assert_eq!(start.writes.len(), 1);
    // Typed before the thread exists: nothing is sent yet.
    assert!(codex.send_text("bonjour").writes.is_empty());
    let init = codex.handle_line(r#"{"id":1,"result":{}}"#);
    assert_eq!(json(&init.writes[1])["method"], "thread/start");
    let thread = codex.handle_line(r#"{"id":2,"result":{"thread":{"id":"t1","model":"m"}}}"#);
    let turn = json(thread.writes.last().unwrap());
    assert_eq!(turn["method"], "turn/start");
    assert_eq!(turn["params"]["input"][0]["text"], "bonjour");
}

#[test]
fn unsupported_server_requests_are_refused_not_left_hanging() {
    let mut codex = Codex::new("/w", None);
    let out = codex.handle_line(r#"{"id":7,"method":"mcpServer/elicitation/request","params":{}}"#);
    assert_eq!(json(&out.writes[0])["id"], 7);
    assert!(json(&out.writes[0])["error"].is_object());
    let mut claude = Claude::new("/w");
    let out = claude.handle_line(
        r#"{"type":"control_request","request_id":"r1","request":{"subtype":"hook_callback"}}"#,
    );
    assert_eq!(json(&out.writes[0])["response"]["subtype"], "error");
}

/// Throughput check: `cargo test -p galeata-agent-protocol --release -- --ignored --nocapture`
#[test]
#[ignore]
fn throughput() {
    for name in ["claude", "codex"] {
        let lines = fixture(name)
            .into_iter()
            .filter(|r| r["dir"] == "out")
            .map(|r| r["msg"].to_string())
            .collect::<Vec<_>>();
        let bytes: usize = lines.iter().map(String::len).sum();
        let rounds = 2000;
        let started = Instant::now();
        let mut produced = 0;
        for _ in 0..rounds {
            let mut protocol: Box<dyn Protocol> = if name == "claude" {
                Box::new(Claude::new("/WORKDIR"))
            } else {
                Box::new(Codex::new("/WORKDIR", None))
            };
            for line in &lines {
                produced += protocol.handle_line(line).events.len();
            }
        }
        let elapsed = started.elapsed().as_secs_f64();
        println!(
            "{name}: {:.0} lignes/s, {:.1} Mo/s, {produced} événements",
            (lines.len() * rounds) as f64 / elapsed,
            (bytes * rounds) as f64 / elapsed / 1e6
        );
    }
}

/// Replays a Claude scenario where the recorded inbound answer is produced with
/// `answer`, and checks it is byte-for-byte what Claude Code accepted.
fn replay_claude_answers(name: &str, answer: impl Fn(&Value) -> Answer) -> Vec<AgentEvent> {
    let mut claude = Claude::new("/WORKDIR");
    let mut events = Vec::new();
    for record in fixture(name) {
        let msg = &record["msg"];
        if record["dir"] == "in" {
            match msg["type"].as_str() {
                Some("user") => events.extend(
                    claude
                        .send_text(msg["message"]["content"].as_str().unwrap())
                        .events,
                ),
                Some("control_request") => events.extend(claude.start().events),
                Some("control_response") => {
                    let id = msg["response"]["request_id"].as_str().unwrap();
                    let out = claude.answer(id, answer(msg)).unwrap();
                    assert_eq!(
                        json(&out.writes[0]),
                        *msg,
                        "réponse différente de la capture"
                    );
                    events.extend(out.events);
                }
                other => panic!("entrée inattendue {other:?}"),
            }
        } else {
            events.extend(claude.handle_line(&msg.to_string()).events);
        }
    }
    events
}

#[test]
fn claude_plan_proposal_is_a_plan_not_a_permission() {
    let events = replay_claude_answers("claude-plan", |_| Answer::Plan {
        approve: true,
        accept_edits: true,
        feedback: None,
    });
    let plan = events.iter().find_map(|e| match e {
        AgentEvent::PlanProposal { plan, path, .. } => Some((plan.clone(), path.clone())),
        _ => None,
    });
    let (plan, path) = plan.expect("PlanProposal attendu");
    assert!(plan.starts_with("# Plan"), "{plan}");
    assert!(path.unwrap().ends_with(".md"));
    assert!(!events.iter().any(|e| matches!(e,
        AgentEvent::Approval { title, .. } if title.contains("ExitPlanMode"))));
    // After approval with accepted edits, Claude writes the file without asking.
    assert!(events.iter().any(|e| matches!(e,
        AgentEvent::ToolStarted { path: Some(p), .. } if p == "notes.txt")));
    assert!(events.iter().any(|e| matches!(
        e,
        AgentEvent::TurnCompleted {
            status: TurnStatus::Completed,
            ..
        }
    )));
}

#[test]
fn claude_questions_are_answered_by_label() {
    let events = replay_claude_answers("claude-question", |msg| {
        let answers = msg["response"]["response"]["updatedInput"]["answers"]
            .as_object()
            .unwrap()
            .iter()
            .map(|(q, a)| (q.clone(), vec![a.as_str().unwrap().to_owned()]))
            .collect();
        Answer::Questions(answers)
    });
    let questions = events.iter().find_map(|e| match e {
        AgentEvent::Question { questions, .. } => Some(questions.clone()),
        _ => None,
    });
    let questions = questions.expect("Question attendue");
    assert_eq!(questions.len(), 1);
    assert_eq!(
        questions[0]
            .options
            .iter()
            .map(|o| o.label.as_str())
            .collect::<Vec<_>>(),
        ["Rouge", "Bleu"]
    );
    assert!(events.iter().any(|e| matches!(e,
        AgentEvent::Message { text, .. } if text.trim() == "Bleu")));
}

#[test]
fn plan_feedback_keeps_planning() {
    let mut claude = Claude::new("/w");
    let out = claude.handle_line(
        r##"{"type":"control_request","request_id":"p1","request":{"subtype":"can_use_tool","tool_name":"ExitPlanMode","input":{"plan":"# P"}}}"##,
    );
    assert!(matches!(&out.events[0], AgentEvent::PlanProposal { .. }));
    let out = claude
        .answer(
            "p1",
            Answer::Plan {
                approve: false,
                accept_edits: false,
                feedback: Some("Ajoute des tests".into()),
            },
        )
        .unwrap();
    let response = &json(&out.writes[0])["response"]["response"];
    assert_eq!(response["behavior"], "deny");
    assert!(response["message"]
        .as_str()
        .unwrap()
        .contains("Ajoute des tests"));
}

#[test]
fn codex_user_input_questions_round_trip() {
    let mut codex = Codex::new("/w", None);
    let out = codex.handle_line(
        r#"{"id":9,"method":"item/tool/requestUserInput","params":{"threadId":"t","turnId":"u","itemId":"i","isBlocking":true,"questions":[{"id":"q1","header":"Base","question":"Quelle base ?","options":[{"label":"Postgres","description":"Recommandé"},{"label":"SQLite","description":"Local"}]}]}}"#,
    );
    assert!(
        out.writes.is_empty(),
        "la question ne doit plus être refusée"
    );
    assert!(
        matches!(&out.events[0], AgentEvent::Question { questions, .. } if questions[0].options.len() == 2)
    );
    let out = codex
        .answer(
            "9",
            Answer::Questions(vec![("q1".into(), vec!["Postgres".into()])]),
        )
        .unwrap();
    assert_eq!(
        json(&out.writes[0]),
        serde_json::json!({"jsonrpc":"2.0","id":9,"result":{"answers":{"q1":{"answers":["Postgres"]}}}})
    );
    let plan = codex.handle_line(
        r#"{"method":"item/completed","params":{"item":{"type":"plan","id":"p","text":"1. Faire"}}}"#,
    );
    assert!(matches!(&plan.events[0], AgentEvent::Plan { text, .. } if text == "1. Faire"));
}

#[test]
fn auto_mode_runs_commands_without_asking() {
    let events = replay_claude_answers("claude-auto", |_| unreachable!("aucune demande attendue"));
    assert!(events
        .iter()
        .any(|e| matches!(e, AgentEvent::Mode { mode } if mode == "auto")));
    assert!(!events
        .iter()
        .any(|e| matches!(e, AgentEvent::Approval { .. })));
    assert!(events.iter().any(|e| matches!(e,
        AgentEvent::ToolStarted { title, .. } if title.contains("RTK_DISABLED=1 git status"))));
}

#[test]
fn approvals_explain_why_and_the_real_scope_of_always() {
    let (events, _) = replay_claude(&fixture("claude"));
    let approval = events.iter().find_map(|e| match e {
        AgentEvent::Approval {
            title,
            detail,
            always,
            ..
        } => Some((title.clone(), detail.clone(), always.clone())),
        _ => None,
    });
    let (title, detail, always) = approval.expect("autorisation attendue");
    assert_eq!(title, "out.txt");
    assert_eq!(detail.as_deref(), Some("galeata"));
    assert_eq!(
        always.as_deref(),
        Some("Accepter toutes les modifications de fichiers dans cette conversation")
    );
    let mut claude = Claude::new("/w");
    let out = claude.handle_line(
        r#"{"type":"control_request","request_id":"b1","request":{"subtype":"can_use_tool","tool_name":"Bash","input":{"command":"npm test","description":"Lancer les tests"},"permission_suggestions":[{"type":"addRules","rules":[{"toolName":"Bash","ruleContent":"npm test:*"}],"behavior":"allow","destination":"localSettings"}]}}"#,
    );
    match &out.events[0] {
        AgentEvent::Approval {
            title,
            detail,
            description,
            always,
            ..
        } => {
            assert_eq!(title, "npm test");
            assert_eq!(detail, &None, "la commande n’est pas répétée");
            assert_eq!(description.as_deref(), Some("Lancer les tests"));
            assert_eq!(
                always.as_deref(),
                Some("Toujours autoriser Bash(npm test:*) dans ce projet (sur ce poste)")
            );
        }
        other => panic!("{other:?}"),
    }
    let out = claude
        .answer(
            "b1",
            Answer::Refuse {
                message: "Utilise npm run test:unit".into(),
            },
        )
        .unwrap();
    let response = &json(&out.writes[0])["response"]["response"];
    assert_eq!(response["behavior"], "deny");
    assert!(response["message"]
        .as_str()
        .unwrap()
        .contains("npm run test:unit"));
}

#[test]
fn permission_mode_changes_are_sent_and_followed() {
    let mut claude = Claude::new("/w");
    let out = claude.set_mode("acceptEdits").unwrap();
    let request = json(&out.writes[0]);
    assert_eq!(request["request"]["subtype"], "set_permission_mode");
    assert_eq!(request["request"]["mode"], "acceptEdits");
    assert!(claude.set_mode("yolo").is_err());
    // Confirmation from the CLI (captured shape), then the status line: one Mode event.
    let confirmed = claude.handle_line(
        r#"{"type":"control_response","response":{"subtype":"success","request_id":"galeata-mode-1","response":{"mode":"acceptEdits"}}}"#,
    );
    let status = claude.handle_line(
        r#"{"type":"system","subtype":"status","status":null,"permissionMode":"acceptEdits"}"#,
    );
    assert!(matches!(&confirmed.events[0], AgentEvent::Mode { mode } if mode == "acceptEdits"));
    assert!(status.events.is_empty());

    let mut codex = Codex::new("/w", None);
    assert!(codex.set_mode("acceptEdits").is_err());
    codex.set_mode("default").unwrap();
    codex.start();
    codex.handle_line(r#"{"id":1,"result":{}}"#);
    codex.handle_line(r#"{"id":2,"result":{"thread":{"id":"t"}}}"#);
    let turn = json(&codex.send_text("x").writes[0]);
    assert_eq!(turn["params"]["approvalPolicy"], "untrusted");
    assert_eq!(turn["params"]["sandboxPolicy"]["type"], "workspaceWrite");
    codex.handle_line(r#"{"method":"turn/completed","params":{"turn":{"status":"completed"}}}"#);
    codex.set_mode("bypassPermissions").unwrap();
    let turn = json(&codex.send_text("y").writes[0]);
    assert_eq!(turn["params"]["approvalPolicy"], "never");
    assert_eq!(turn["params"]["sandboxPolicy"]["type"], "dangerFullAccess");
}

#[test]
fn galeata_plan_tool_calls_stay_out_of_the_conversation() {
    let mut claude = Claude::new("/w");
    let out = claude.handle_line(
        r#"{"type":"assistant","message":{"id":"m","content":[{"type":"tool_use","id":"t1","name":"mcp__galeata__plan_update_step","input":{}}]}}"#,
    );
    assert!(out.events.is_empty());
    let out = claude.handle_line(
        r#"{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"t1","content":"{}"}]}}"#,
    );
    assert!(out.events.is_empty());
    let mut codex = Codex::new("/w", None);
    let out = codex.handle_line(
        r#"{"method":"item/started","params":{"item":{"type":"mcpToolCall","id":"x","server":"galeata","tool":"plan.set"}}}"#,
    );
    assert!(out.events.is_empty());
    let out = codex.handle_line(
        r#"{"method":"item/started","params":{"item":{"type":"mcpToolCall","id":"y","server":"github","tool":"list"}}}"#,
    );
    assert_eq!(
        out.events.len(),
        1,
        "les autres outils MCP restent visibles"
    );
}
