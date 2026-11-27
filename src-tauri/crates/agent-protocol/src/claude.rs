//! Claude Code `-p --input-format stream-json --output-format stream-json` adapter.

use crate::event::{AgentEvent, AgentState, ApprovalKind, Question, ToolKind, TurnStatus};
use crate::{
    head, relative, tail, Answer, Decision, Model, Output, Protocol, MAX_DETAIL, MAX_TOOL_OUTPUT,
};
use serde::Deserialize;
use serde_json::{json, Value};
use std::borrow::Cow;
use std::collections::HashMap;

const INIT_REQUEST: &str = "galeata-init";
/// Permission modes, from the strictest to "no limit". `bypassPermissions` needs
/// the session to be launched with `--allow-dangerously-skip-permissions`.
pub const CLAUDE_MODES: [&str; 5] = [
    "plan",
    "default",
    "acceptEdits",
    "auto",
    "bypassPermissions",
];

/// Human label for Claude's "always" suggestions, with their real scope.
fn always_label(suggestions: Option<&Value>) -> Option<String> {
    let labels = suggestions?
        .as_array()?
        .iter()
        .filter_map(|s| {
            let scope = match s["destination"].as_str() {
                Some("localSettings") => "dans ce projet (sur ce poste)",
                Some("projectSettings") => "dans ce projet",
                Some("userSettings") => "dans tous les projets",
                _ => "dans cette conversation",
            };
            match s["type"].as_str() {
                Some("addRules") => {
                    let rules = s["rules"]
                        .as_array()?
                        .iter()
                        .map(|r| {
                            let tool = r["toolName"].as_str().unwrap_or("outil");
                            match r["ruleContent"].as_str() {
                                Some(content) => format!("{tool}({content})"),
                                None => tool.to_owned(),
                            }
                        })
                        .collect::<Vec<_>>()
                        .join(", ");
                    Some(format!("Toujours autoriser {rules} {scope}"))
                }
                Some("setMode") => Some(match s["mode"].as_str() {
                    Some("acceptEdits") => {
                        format!("Accepter toutes les modifications de fichiers {scope}")
                    }
                    Some(mode) => format!("Passer en mode {mode} {scope}"),
                    None => return None,
                }),
                Some("addDirectories") => Some(format!("Autoriser ce dossier {scope}")),
                _ => None,
            }
        })
        .collect::<Vec<_>>();
    (!labels.is_empty()).then(|| labels.join(" ; "))
}

/// Tool calls never shown as tool cards: dialogues with the user (rendered as
/// plan / question cards) and Claude Code's internal tool loading.
pub(crate) const CONVERSATION_TOOLS: [&str; 3] = ["ExitPlanMode", "AskUserQuestion", "ToolSearch"];

/// One stdout line. Only the fields needed for routing and for the streaming
/// hot path are deserialized; everything else is skipped without allocation.
#[derive(Deserialize)]
struct Line<'a> {
    #[serde(rename = "type", borrow)]
    kind: Cow<'a, str>,
    #[serde(borrow, default)]
    subtype: Option<Cow<'a, str>>,
    #[serde(borrow, default)]
    event: Option<StreamEvent<'a>>,
    #[serde(rename = "permissionMode", borrow, default)]
    permission_mode: Option<Cow<'a, str>>,
}

#[derive(Deserialize)]
struct StreamEvent<'a> {
    #[serde(rename = "type", borrow)]
    kind: Cow<'a, str>,
    #[serde(default)]
    index: Option<u64>,
    #[serde(borrow, default)]
    delta: Option<Delta<'a>>,
    #[serde(borrow, default)]
    message: Option<MessageStart<'a>>,
}

#[derive(Deserialize)]
struct Delta<'a> {
    // `message_delta` events carry a delta without `type` (stop reason only).
    #[serde(rename = "type", borrow, default)]
    kind: Option<Cow<'a, str>>,
    #[serde(borrow, default)]
    text: Option<Cow<'a, str>>,
}

#[derive(Deserialize)]
struct MessageStart<'a> {
    #[serde(borrow)]
    id: Cow<'a, str>,
}

struct PendingApproval {
    input: Value,
    suggestions: Option<Value>,
}

pub struct Claude {
    cwd: String,
    state: AgentState,
    session: Option<String>,
    message_id: String,
    block_index: u64,
    streamed_message: bool,
    pending_turns: usize,
    interrupted: bool,
    approvals: HashMap<String, PendingApproval>,
    /// Tool calls shown through their own card (plan, questions), not as tools.
    hidden_tools: std::collections::HashSet<String>,
    next_request: u64,
    mode: String,
    models: Vec<Model>,
    model_requests: HashMap<String, String>,
}

impl Claude {
    /// `cwd` is the workspace root, used to show workspace-relative paths.
    pub fn new(cwd: &str) -> Self {
        Self {
            cwd: cwd.to_owned(),
            state: AgentState::Starting,
            session: None,
            message_id: String::new(),
            block_index: 0,
            streamed_message: false,
            pending_turns: 0,
            interrupted: false,
            approvals: HashMap::new(),
            hidden_tools: std::collections::HashSet::new(),
            next_request: 0,
            mode: String::new(),
            models: Vec::new(),
            model_requests: HashMap::new(),
        }
    }

    fn set_state(&mut self, state: AgentState, out: &mut Output) {
        if self.state != state {
            self.state = state;
            out.events.push(AgentEvent::State { state });
        }
    }

    fn stream(&mut self, event: StreamEvent<'_>, out: &mut Output) {
        match event.kind.as_ref() {
            "message_start" => {
                if let Some(message) = event.message {
                    self.message_id = message.id.into_owned();
                    self.streamed_message = true;
                }
            }
            "content_block_start" => self.block_index = event.index.unwrap_or(0),
            "content_block_delta" => {
                if let Some(Delta {
                    kind,
                    text: Some(text),
                }) = event.delta
                {
                    // Only visible text is streamed; tool input and thinking deltas are
                    // shown once complete, which avoids thousands of tiny UI updates.
                    if kind.as_deref() == Some("text_delta") && !text.is_empty() {
                        out.events.push(AgentEvent::TextDelta {
                            item_id: format!("{}:{}", self.message_id, event.index.unwrap_or(0)),
                            text: text.into_owned(),
                        });
                    }
                }
            }
            _ => {}
        }
    }

    fn assistant(&mut self, value: &Value, out: &mut Output) {
        let message = &value["message"];
        let id = message["id"].as_str().unwrap_or_default();
        let Some(blocks) = message["content"].as_array() else {
            return;
        };
        for (position, block) in blocks.iter().enumerate() {
            // With partial messages, each assistant line carries the block that was
            // just streamed; otherwise blocks are in their natural order.
            let index = if self.streamed_message && id == self.message_id && blocks.len() == 1 {
                self.block_index
            } else {
                position as u64
            };
            match block["type"].as_str() {
                Some("text") => out.events.push(AgentEvent::Message {
                    item_id: format!("{id}:{index}"),
                    text: block["text"].as_str().unwrap_or_default().to_owned(),
                }),
                Some("thinking") => {
                    let text = block["thinking"].as_str().unwrap_or_default();
                    if !text.is_empty() {
                        out.events.push(AgentEvent::Reasoning {
                            item_id: format!("{id}:{index}"),
                            text: text.to_owned(),
                        });
                    }
                }
                Some("tool_use") => {
                    let name = block["name"].as_str().unwrap_or("outil");
                    if CONVERSATION_TOOLS.contains(&name) || name.starts_with("mcp__galeata__plan_")
                    {
                        if let Some(id) = block["id"].as_str() {
                            self.hidden_tools.insert(id.to_owned());
                        }
                        continue;
                    }
                    let (tool, title, path) = describe_tool(name, &block["input"], &self.cwd);
                    if tool == ToolKind::Agent {
                        out.events.push(AgentEvent::ToolInput {
                            item_id: block["id"].as_str().unwrap_or_default().to_owned(),
                            input: block["input"].clone(),
                        });
                    }
                    out.events.push(AgentEvent::ToolStarted {
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

    fn tool_results(&mut self, value: &Value, out: &mut Output) {
        let Some(blocks) = value["message"]["content"].as_array() else {
            return;
        };
        for block in blocks
            .iter()
            .filter(|b| b["type"].as_str() == Some("tool_result"))
        {
            if block["tool_use_id"]
                .as_str()
                .is_some_and(|id| self.hidden_tools.remove(id))
            {
                continue;
            }
            let output = crate::content::tool_text(&block["content"]);
            out.events.push(AgentEvent::ToolCompleted {
                item_id: block["tool_use_id"].as_str().unwrap_or_default().to_owned(),
                ok: block["is_error"].as_bool() != Some(true),
                output: (!output.is_empty()).then(|| tail(&output, MAX_TOOL_OUTPUT)),
            });
        }
    }

    fn control_request(&mut self, value: &Value, out: &mut Output) {
        let request = &value["request"];
        let id = value["request_id"].as_str().unwrap_or_default().to_owned();
        if request["subtype"].as_str() != Some("can_use_tool") {
            // Never leave the CLI waiting on a request Galeata does not handle.
            out.writes.push(
                json!({"type":"control_response","response":{"subtype":"error","request_id":id,
                    "error":format!("Galeata ne gère pas {}", request["subtype"])}})
                .to_string(),
            );
            return;
        }
        let name = request["tool_name"].as_str().unwrap_or("outil");
        let input = request["input"].clone();
        // Mission bookkeeping is already authorized by the host, including in plan mode.
        if matches!(
            name,
            "mcp__galeata__plan_get"
                | "mcp__galeata__plan_set"
                | "mcp__galeata__plan_update_step"
                | "mcp__galeata__plan_propose_change"
                | "mcp__galeata__activity_report"
                | "mcp__galeata__workspace_get_context"
        ) {
            out.writes.push(
                json!({"type":"control_response","response":{
                    "subtype":"success","request_id":id,
                    "response":{"behavior":"allow","updatedInput":input}
                }})
                .to_string(),
            );
            return;
        }
        let pending = PendingApproval {
            input: input.clone(),
            suggestions: request.get("permission_suggestions").cloned(),
        };
        // Plans and questions are conversations, not permissions: dedicated events.
        if name == "ExitPlanMode" {
            out.events.push(AgentEvent::PlanProposal {
                request_id: id.clone(),
                plan: input["plan"].as_str().unwrap_or_default().to_owned(),
                path: input["planFilePath"]
                    .as_str()
                    .map(|p| relative(&self.cwd, p)),
            });
            self.approvals.insert(id, pending);
            self.set_state(AgentState::WaitingApproval, out);
            return;
        }
        if name == "AskUserQuestion" {
            let questions = input["questions"]
                .as_array()
                .into_iter()
                .flatten()
                .map(|q| Question {
                    // Claude keys answers by the question text.
                    id: q["question"].as_str().unwrap_or_default().to_owned(),
                    header: q["header"].as_str().unwrap_or_default().to_owned(),
                    question: q["question"].as_str().unwrap_or_default().to_owned(),
                    options: crate::content::question_options(&q["options"]),
                    multi_select: q["multiSelect"].as_bool().unwrap_or(false),
                    allow_other: true,
                })
                .collect();
            out.events.push(AgentEvent::Question {
                request_id: id.clone(),
                questions,
            });
            self.approvals.insert(id, pending);
            self.set_state(AgentState::WaitingApproval, out);
            return;
        }
        let (tool, title, _) = describe_tool(name, &input, &self.cwd);
        let kind = match tool {
            ToolKind::Command => ApprovalKind::Command,
            ToolKind::FileEdit => ApprovalKind::FileChange,
            _ => ApprovalKind::Tool,
        };
        let detail = approval_detail(name, &input).filter(|d| *d != title);
        out.events.push(AgentEvent::Approval {
            request_id: id.clone(),
            kind,
            title,
            detail,
            description: input["description"]
                .as_str()
                .filter(|d| !d.trim().is_empty())
                .map(str::to_owned),
            always: always_label(pending.suggestions.as_ref()),
        });
        self.approvals.insert(id, pending);
        self.set_state(AgentState::WaitingApproval, out);
    }

    fn mode_changed(&mut self, mode: &str, out: &mut Output) {
        if !mode.is_empty() && self.mode != mode {
            self.mode = mode.to_owned();
            out.events.push(AgentEvent::Mode {
                mode: mode.to_owned(),
            });
        }
    }

    /// Sends a `can_use_tool` reply and marks the request resolved.
    fn reply(&mut self, request_id: &str, response: Value) -> Output {
        let mut out = Output::default();
        out.writes.push(
            json!({"type":"control_response","response":{"subtype":"success",
                "request_id":request_id,"response":response}})
            .to_string(),
        );
        out.events.push(AgentEvent::ApprovalResolved {
            request_id: request_id.to_owned(),
        });
        if self.approvals.is_empty() && self.state == AgentState::WaitingApproval {
            self.set_state(AgentState::Working, &mut out);
        }
        out
    }

    fn result(&mut self, value: &Value, out: &mut Output) {
        let usage = &value["usage"];
        let input = [
            "input_tokens",
            "cache_creation_input_tokens",
            "cache_read_input_tokens",
        ]
        .iter()
        .filter_map(|key| usage[*key].as_u64())
        .reduce(|a, b| a + b);
        let failed = value["is_error"].as_bool() == Some(true);
        let status = if self.interrupted {
            TurnStatus::Interrupted
        } else if failed {
            TurnStatus::Failed
        } else {
            TurnStatus::Completed
        };
        out.events.push(AgentEvent::TurnCompleted {
            status,
            error: failed.then(|| {
                value["result"]
                    .as_str()
                    .or(value["subtype"].as_str())
                    .unwrap_or("Erreur inconnue")
                    .to_owned()
            }),
            cost_usd: value["total_cost_usd"].as_f64(),
            input_tokens: input,
            output_tokens: usage["output_tokens"].as_u64(),
        });
        self.pending_turns = self.pending_turns.saturating_sub(1);
        if self.pending_turns == 0 {
            self.interrupted = false;
            self.approvals.clear();
            self.set_state(AgentState::Idle, out);
        }
    }
}

impl Protocol for Claude {
    fn start(&mut self) -> Output {
        Output {
            events: vec![AgentEvent::State {
                state: AgentState::Starting,
            }],
            writes: vec![json!({"type":"control_request","request_id":INIT_REQUEST,
                "request":{"subtype":"initialize","hooks":null}})
            .to_string()],
        }
    }

    fn handle_line(&mut self, line: &str) -> Output {
        let mut out = Output::default();
        let Ok(parsed) = serde_json::from_str::<Line>(line) else {
            if !line.trim().is_empty() {
                out.events.push(AgentEvent::Notice {
                    message: head(line, 2000),
                });
            }
            return out;
        };
        match (parsed.kind.as_ref(), parsed.subtype.as_deref()) {
            ("stream_event", _) => {
                if let Some(event) = parsed.event {
                    self.stream(event, &mut out);
                }
            }
            ("rate_limit_event", _) => {}
            // Status lines also report permission mode changes (shift+tab, plan approval…).
            ("system", Some("status")) => {
                if let Some(mode) = parsed.permission_mode {
                    self.mode_changed(&mode, &mut out);
                }
            }
            (kind, subtype) => {
                // Rare lines: a full parse is affordable here.
                let Ok(value) = serde_json::from_str::<Value>(line) else {
                    return out;
                };
                match (kind, subtype) {
                    ("system", Some("init")) => {
                        if let Some(mode) = value["permissionMode"].as_str() {
                            self.mode_changed(mode, &mut out);
                        }
                        let session = value["session_id"].as_str().unwrap_or_default();
                        if self.session.as_deref() != Some(session) {
                            self.session = Some(session.to_owned());
                            out.events.push(AgentEvent::Session {
                                session_id: session.to_owned(),
                                model: value["model"].as_str().map(str::to_owned),
                            });
                        }
                    }
                    ("system", Some("permission_denied")) => out.events.push(AgentEvent::Notice {
                        message: value["message"]
                            .as_str()
                            .unwrap_or("Permission refusée")
                            .to_owned(),
                    }),
                    ("assistant", _) => self.assistant(&value, &mut out),
                    ("user", _) => self.tool_results(&value, &mut out),
                    ("control_request", _) => self.control_request(&value, &mut out),
                    ("control_cancel_request", _) => {
                        let id = value["request_id"].as_str().unwrap_or_default().to_owned();
                        if self.approvals.remove(&id).is_some() {
                            out.events
                                .push(AgentEvent::ApprovalResolved { request_id: id });
                        }
                    }
                    ("control_response", _) => {
                        let response = &value["response"];
                        if let Some(model) = response["request_id"]
                            .as_str()
                            .and_then(|id| self.model_requests.remove(id))
                        {
                            if response["subtype"] == "success" {
                                out.events.push(AgentEvent::Model { model });
                            } else {
                                out.events.push(AgentEvent::Error {
                                    message: format!(
                                        "Changement de modèle refusé par Claude Code : {}",
                                        response["error"].as_str().unwrap_or("erreur inconnue")
                                    ),
                                });
                            }
                        }
                        if response["request_id"].as_str() == Some(INIT_REQUEST)
                            && response["subtype"] == "success"
                        {
                            self.models = response["response"]["models"]
                                .as_array()
                                .into_iter()
                                .flatten()
                                .filter_map(|model| {
                                    Some(Model {
                                        id: model["value"].as_str()?.to_owned(),
                                        label: model["displayName"].as_str()?.to_owned(),
                                        description: model["description"]
                                            .as_str()
                                            .unwrap_or_default()
                                            .to_owned(),
                                        resolved_model: model["resolvedModel"]
                                            .as_str()
                                            .map(str::to_owned),
                                    })
                                })
                                .collect();
                            if !self.models.is_empty() {
                                out.events.push(AgentEvent::Models {
                                    models: self.models.clone(),
                                });
                            }
                        }
                        if let Some(mode) = response["response"]["mode"]
                            .as_str()
                            .or(response["response"]["current_permission_mode"].as_str())
                        {
                            self.mode_changed(mode, &mut out);
                        }
                        if response["subtype"].as_str() == Some("error")
                            && response["request_id"]
                                .as_str()
                                .is_some_and(|id| id.starts_with("galeata-mode"))
                        {
                            out.events.push(AgentEvent::Error {
                                message: format!(
                                    "Changement de mode refusé par Claude Code : {}",
                                    response["error"]
                                ),
                            });
                        }
                        // The only control request Galeata sends before being idle is
                        // `initialize`; older captures used another request id.
                        if response["request_id"].as_str() == Some(INIT_REQUEST)
                            || self.state == AgentState::Starting
                        {
                            if response["subtype"].as_str() == Some("error") {
                                out.events.push(AgentEvent::Error {
                                    message: format!(
                                        "Initialisation de Claude Code refusée : {}",
                                        response["error"]
                                    ),
                                });
                            }
                            if self.state == AgentState::Starting {
                                self.set_state(AgentState::Idle, &mut out);
                            }
                        }
                    }
                    ("result", _) => self.result(&value, &mut out),
                    _ => {}
                }
            }
        }
        out
    }

    fn send_text(&mut self, text: &str) -> Output {
        let mut out = Output::default();
        if self.pending_turns == 0 {
            out.events.push(AgentEvent::TurnStarted);
        }
        self.pending_turns += 1;
        self.set_state(AgentState::Working, &mut out);
        out.writes.push(
            json!({"type":"user","message":{"role":"user","content":text},
                "parent_tool_use_id":null,"session_id":self.session.as_deref().unwrap_or("")})
            .to_string(),
        );
        out
    }

    fn send_images(&mut self, text: &str, images: &[String]) -> Output {
        let mut out = self.send_text(text);
        let mut content = vec![json!({"type":"text","text":text})];
        for image in images {
            if let Some((header, data)) = image.split_once(",") {
                let media = header
                    .trim_start_matches("data:")
                    .trim_end_matches(";base64");
                content.push(json!({"type":"image","source":{"type":"base64","media_type":media,"data":data}}));
            }
        }
        if let Some(write) = out.writes.last_mut() {
            if let Ok(mut value) = serde_json::from_str::<Value>(write) {
                value["message"]["content"] = json!(content);
                *write = value.to_string();
            }
        }
        out
    }

    fn respond(&mut self, request_id: &str, decision: Decision) -> Result<Output, String> {
        let pending = self.approvals.remove(request_id).ok_or_else(|| {
            format!("Demande d’autorisation inconnue ou déjà traitée : {request_id}")
        })?;
        let response = match decision {
            Decision::Deny => json!({"behavior":"deny","message":"Refusé dans Galeata"}),
            Decision::Allow => json!({"behavior":"allow","updatedInput":pending.input}),
            Decision::AllowForSession => {
                let mut allow = json!({"behavior":"allow","updatedInput":pending.input});
                if let Some(suggestions) = pending.suggestions {
                    allow["updatedPermissions"] = suggestions;
                }
                allow
            }
        };
        Ok(self.reply(request_id, response))
    }

    fn answer(&mut self, request_id: &str, answer: Answer) -> Result<Output, String> {
        let pending = self
            .approvals
            .remove(request_id)
            .ok_or_else(|| format!("Demande inconnue ou déjà traitée : {request_id}"))?;
        let response = match answer {
            // Same shape as the Agent SDK; verified with Claude Code 2.1.331
            // (tests/fixtures/agents/claude-plan.jsonl).
            Answer::Plan {
                approve: true,
                accept_edits,
                ..
            } => json!({"behavior":"allow","updatedInput":pending.input,
                "updatedPermissions":[{"type":"setMode",
                    "mode": if accept_edits { "acceptEdits" } else { "default" },
                    "destination":"session"}]}),
            Answer::Plan {
                approve: false,
                feedback,
                ..
            } => {
                json!({"behavior":"deny","message": match feedback.filter(|f| !f.trim().is_empty()) {
                    Some(feedback) => format!("L’utilisateur ne valide pas encore le plan. Reste en mode plan et révise-le selon ce retour :\n{feedback}"),
                    None => "L’utilisateur ne valide pas encore le plan. Reste en mode plan et demande-lui ce qu’il faut changer.".to_owned(),
                }})
            }
            Answer::Refuse { message } => {
                json!({"behavior":"deny","message": if message.trim().is_empty() {
                    "Refusé dans Galeata.".to_owned()
                } else {
                    format!("Refusé par l’utilisateur, qui précise : {message}")
                }})
            }
            // Answers keyed by question text (claude-question.jsonl).
            Answer::Questions(answers) => {
                let mut input = pending.input;
                input["answers"] = json!(answers
                    .into_iter()
                    .map(|(question, labels)| (question, json!(labels.join(", "))))
                    .collect::<serde_json::Map<_, _>>());
                json!({"behavior":"allow","updatedInput":input})
            }
        };
        Ok(self.reply(request_id, response))
    }

    fn set_mode(&mut self, mode: &str) -> Result<Output, String> {
        if !CLAUDE_MODES.contains(&mode) {
            return Err(format!("Mode inconnu : {mode}"));
        }
        self.next_request += 1;
        let mut out = Output::default();
        // Confirmed by the CLI (control_response + status line), then a Mode event.
        out.writes.push(
            json!({"type":"control_request","request_id":format!("galeata-mode-{}", self.next_request),
                "request":{"subtype":"set_permission_mode","mode":mode}})
            .to_string(),
        );
        Ok(out)
    }

    fn models(&mut self) -> Output {
        let mut out = Output::default();
        if !self.models.is_empty() {
            out.events.push(AgentEvent::Models {
                models: self.models.clone(),
            });
        }
        out
    }

    fn set_model(&mut self, model: &str) -> Result<Output, String> {
        if self.state != AgentState::Idle || self.pending_turns != 0 {
            return Err("Attendez la fin du tour pour changer de modèle".into());
        }
        if !self.models.iter().any(|available| available.id == model) {
            return Err("Modèle Claude indisponible dans cette conversation".into());
        }
        self.next_request += 1;
        let id = format!("galeata-model-{}", self.next_request);
        self.model_requests.insert(id.clone(), model.to_owned());
        Ok(Output {
            events: vec![],
            writes: vec![json!({"type":"control_request","request_id":id,
                "request":{"subtype":"set_model","model":model}})
            .to_string()],
        })
    }

    fn interrupt(&mut self) -> Output {
        let mut out = Output::default();
        if self.pending_turns == 0 {
            return out;
        }
        self.interrupted = true;
        self.next_request += 1;
        out.writes.push(
            json!({"type":"control_request","request_id":format!("galeata-interrupt-{}", self.next_request),
                "request":{"subtype":"interrupt"}})
            .to_string(),
        );
        out
    }

    fn compact(&mut self) -> Result<Output, String> {
        if self.state != AgentState::Idle || self.pending_turns != 0 {
            return Err("Attendez la fin du tour pour compacter la conversation".into());
        }
        Ok(self.send_text("/compact"))
    }
}

/// Short, human title for a Claude tool call.
pub(crate) fn describe_tool(
    name: &str,
    input: &Value,
    cwd: &str,
) -> (ToolKind, String, Option<String>) {
    let path = input["file_path"]
        .as_str()
        .or(input["notebook_path"].as_str())
        .or(input["path"].as_str())
        .map(|p| relative(cwd, p));
    let text = |key: &str| input[key].as_str().unwrap_or_default().to_owned();
    match name {
        "Bash" | "BashOutput" | "KillShell" => (ToolKind::Command, text("command"), None),
        "Read" => (ToolKind::FileRead, path.clone().unwrap_or_default(), path),
        "Write" | "Edit" | "MultiEdit" | "NotebookEdit" => {
            (ToolKind::FileEdit, path.clone().unwrap_or_default(), path)
        }
        "Grep" | "Glob" => (ToolKind::Search, text("pattern"), path),
        "WebFetch" | "WebSearch" => (
            ToolKind::Web,
            input["url"]
                .as_str()
                .or(input["query"].as_str())
                .unwrap_or_default()
                .to_owned(),
            None,
        ),
        "Task" | "Agent" => (ToolKind::Agent, text("description"), None),
        _ if name.starts_with("mcp__") => (ToolKind::Mcp, name.replacen("mcp__", "", 1), None),
        _ => (ToolKind::Other, name.to_owned(), path),
    }
}

fn approval_detail(name: &str, input: &Value) -> Option<String> {
    let detail = match name {
        "Bash" => input["command"].as_str().map(str::to_owned),
        "Write" => input["content"].as_str().map(str::to_owned),
        "Edit" => Some(format!(
            "- {}\n+ {}",
            input["old_string"].as_str().unwrap_or_default(),
            input["new_string"].as_str().unwrap_or_default()
        )),
        _ => serde_json::to_string_pretty(input).ok(),
    }?;
    Some(head(&detail, MAX_DETAIL))
}
