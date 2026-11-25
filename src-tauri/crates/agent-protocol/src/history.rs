//! History of a resumed conversation, shown before the agent's new events.
//!
//! In structured mode neither CLI replays past messages: Claude Code keeps them
//! in `~/.claude/projects/<project>/<session>.jsonl`, and Codex returns them in
//! the `thread/resume` response. Both become ordinary [`AgentEvent`]s, bounded so
//! that a long session stays cheap to transfer and render.

use crate::claude::describe_tool;
use crate::event::AgentEvent;
use crate::{head, tail};
use serde_json::Value;
use std::collections::HashSet;

/// Most recent events kept from a history.
pub const HISTORY_EVENTS: usize = 1200;
/// Size bound for a past command output (its end, the most useful part, is kept).
pub const HISTORY_OUTPUT: usize = 4 * 1024;
/// Size bound for a past diff.
pub const HISTORY_DIFF: usize = 16 * 1024;

/// Messages the CLIs record as user turns but that nobody typed.
pub(crate) fn technical(text: &str) -> bool {
    let text = text.trim_start();
    text.is_empty() || text.starts_with('<') || text.starts_with("Caveat:")
}

/// Reads a Claude Code session transcript (JSONL).
pub fn claude_history(transcript: &str, cwd: &str) -> Vec<AgentEvent> {
    let mut events = Vec::new();
    // Plan and question tool calls: shown as text below, never as tool cards.
    let mut hidden = HashSet::new();
    for line in transcript.lines() {
        // Cheap pre-filter: most lines are snapshots, request blobs or metadata.
        if !(line.contains("\"type\":\"user\"") || line.contains("\"type\":\"assistant\"")) {
            continue;
        }
        let Ok(value) = serde_json::from_str::<Value>(line) else {
            continue;
        };
        let kind = value["type"].as_str();
        if value["isSidechain"] == true || value["isMeta"] == true {
            continue;
        }
        let uuid = value["uuid"].as_str().unwrap_or_default();
        let content = &value["message"]["content"];
        match kind {
            Some("user") => {
                if let Some(text) = content.as_str() {
                    if !technical(text) {
                        events.push(AgentEvent::UserMessage {
                            item_id: uuid.to_owned(),
                            text: text.to_owned(),
                        });
                    }
                    continue;
                }
                for (index, block) in content.as_array().into_iter().flatten().enumerate() {
                    match block["type"].as_str() {
                        Some("text") => {
                            let text = block["text"].as_str().unwrap_or_default();
                            if !technical(text) {
                                events.push(AgentEvent::UserMessage {
                                    item_id: format!("{uuid}:{index}"),
                                    text: text.to_owned(),
                                });
                            }
                        }
                        Some("tool_result") => {
                            if block["tool_use_id"]
                                .as_str()
                                .is_some_and(|id| hidden.remove(id))
                            {
                                continue;
                            }
                            let output = match &block["content"] {
                                Value::String(text) => text.clone(),
                                Value::Array(parts) => parts
                                    .iter()
                                    .filter_map(|p| p["text"].as_str())
                                    .collect::<Vec<_>>()
                                    .join("\n"),
                                _ => String::new(),
                            };
                            events.push(AgentEvent::ToolCompleted {
                                item_id: block["tool_use_id"]
                                    .as_str()
                                    .unwrap_or_default()
                                    .to_owned(),
                                ok: block["is_error"] != true,
                                output: (!output.is_empty()).then_some(output),
                            });
                        }
                        _ => {}
                    }
                }
            }
            Some("assistant") => {
                for (index, block) in content.as_array().into_iter().flatten().enumerate() {
                    match block["type"].as_str() {
                        Some("text") => events.push(AgentEvent::Message {
                            item_id: format!("{uuid}:{index}"),
                            text: block["text"].as_str().unwrap_or_default().to_owned(),
                        }),
                        Some("tool_use") if block["name"] == "ExitPlanMode" => {
                            hidden.insert(block["id"].as_str().unwrap_or_default().to_owned());
                            events.push(AgentEvent::Plan {
                                item_id: block["id"].as_str().unwrap_or_default().to_owned(),
                                text: block["input"]["plan"]
                                    .as_str()
                                    .unwrap_or_default()
                                    .to_owned(),
                                historical: true,
                            });
                        }
                        Some("tool_use")
                            if block["name"] == "AskUserQuestion"
                                || block["name"] == "ToolSearch"
                                || block["name"]
                                    .as_str()
                                    .is_some_and(|n| n.starts_with("mcp__galeata__plan_")) =>
                        {
                            hidden.insert(block["id"].as_str().unwrap_or_default().to_owned());
                        }
                        Some("tool_use") => {
                            let (tool, title, path) = describe_tool(
                                block["name"].as_str().unwrap_or("outil"),
                                &block["input"],
                                cwd,
                            );
                            events.push(AgentEvent::ToolStarted {
                                item_id: block["id"].as_str().unwrap_or_default().to_owned(),
                                tool,
                                title,
                                path,
                            });
                        }
                        _ => {}
                    }
                }
            }
            _ => {}
        }
    }
    finish(events)
}

/// Bounds a history and closes tool calls that never got a result (interrupted
/// sessions), so nothing looks like it is still running.
pub(crate) fn finish(mut events: Vec<AgentEvent>) -> Vec<AgentEvent> {
    if events.len() > HISTORY_EVENTS {
        events.drain(..events.len() - HISTORY_EVENTS);
    }
    let completed: HashSet<String> = events
        .iter()
        .filter_map(|e| match e {
            AgentEvent::ToolCompleted { item_id, .. } => Some(item_id.clone()),
            _ => None,
        })
        .collect();
    let mut unfinished = Vec::new();
    for event in &mut events {
        match event {
            AgentEvent::ToolStarted { item_id, .. } if !completed.contains(item_id) => {
                unfinished.push(item_id.clone())
            }
            AgentEvent::ToolCompleted {
                output: Some(output),
                ..
            } if output.len() > HISTORY_OUTPUT => *output = tail(output, HISTORY_OUTPUT),
            AgentEvent::FileChanges { changes, .. } => {
                for change in changes.iter_mut() {
                    if change.diff.len() > HISTORY_DIFF {
                        change.diff = head(&change.diff, HISTORY_DIFF);
                    }
                }
            }
            _ => {}
        }
    }
    events.extend(
        unfinished
            .into_iter()
            .map(|item_id| AgentEvent::ToolCompleted {
                item_id,
                ok: false,
                output: Some("Sans résultat enregistré (session interrompue).".to_owned()),
            }),
    );
    events
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::event::ToolKind;

    #[test]
    fn claude_transcript_keeps_conversation_and_drops_noise() {
        let transcript = [
            r#"{"type":"file-history-snapshot","snapshot":{}}"#,
            r#"{"type":"user","uuid":"u0","isMeta":true,"message":{"role":"user","content":"<local-command-caveat>x"}}"#,
            r#"{"type":"user","uuid":"u1","message":{"role":"user","content":"<command-name>/plan</command-name>"}}"#,
            r#"{"type":"user","uuid":"u2","message":{"role":"user","content":"Corrige le header"}}"#,
            r#"{"type":"assistant","uuid":"a1","message":{"role":"assistant","content":[{"type":"thinking","thinking":"…"}]}}"#,
            r#"{"type":"assistant","uuid":"a2","message":{"role":"assistant","content":[{"type":"tool_use","id":"t1","name":"Read","input":{"file_path":"/w/src/a.scss"}}]}}"#,
            r#"{"type":"user","uuid":"u3","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"t1","content":"ok"}]}}"#,
            r#"{"type":"assistant","uuid":"a3","message":{"role":"assistant","content":[{"type":"tool_use","id":"t2","name":"Bash","input":{"command":"npm test"}}]}}"#,
            r#"{"type":"assistant","uuid":"a4","isSidechain":true,"message":{"role":"assistant","content":[{"type":"text","text":"sous-agent"}]}}"#,
            r#"{"type":"assistant","uuid":"a5","message":{"role":"assistant","content":[{"type":"text","text":"C’est corrigé."}]}}"#,
            r#"{"type":"api-request-blob","message":{"role":"assistant","content":[{"type":"text","text":"doublon"}]}}"#,
        ]
        .join("\n");
        let events = claude_history(&transcript, "/w");
        let users = events
            .iter()
            .filter_map(|e| match e {
                AgentEvent::UserMessage { text, .. } => Some(text.as_str()),
                _ => None,
            })
            .collect::<Vec<_>>();
        assert_eq!(users, ["Corrige le header"]);
        assert!(events.iter().any(|e| matches!(e,
            AgentEvent::ToolStarted { tool: ToolKind::FileRead, path: Some(p), .. } if p == "src/a.scss")));
        assert!(events.iter().any(|e| matches!(e,
            AgentEvent::Message { text, .. } if text == "C’est corrigé.")));
        assert!(!events.iter().any(|e| matches!(e,
            AgentEvent::Message { text, .. } if text == "sous-agent" || text == "doublon")));
        // The interrupted Bash call is closed, not left running.
        assert!(events.iter().any(|e| matches!(e,
            AgentEvent::ToolCompleted { item_id, ok: false, .. } if item_id == "t2")));
    }

    #[test]
    fn long_histories_are_bounded() {
        let events = (0..HISTORY_EVENTS + 50)
            .map(|i| AgentEvent::Message {
                item_id: i.to_string(),
                text: "x".into(),
            })
            .collect();
        let kept = finish(events);
        assert_eq!(kept.len(), HISTORY_EVENTS);
        assert!(matches!(&kept[0], AgentEvent::Message { item_id, .. } if item_id == "50"));
    }
}
