//! Codex `app-server` (JSON-RPC over stdio) adapter.

use crate::event::{
    AgentEvent, AgentState, ApprovalKind, FileChange, Question, QuestionOption, ToolKind,
    TurnStatus,
};
use crate::{
    head, relative, tail, Answer, Decision, Model, Output, Protocol, MAX_DETAIL, MAX_TOOL_OUTPUT,
};
use serde::Deserialize;
use serde_json::{json, Value};
use std::borrow::Cow;
use std::collections::HashMap;

/// Routing envelope: params are skipped, so noisy notifications cost one scan.
#[derive(Deserialize)]
struct Envelope<'a> {
    #[serde(borrow, default)]
    method: Option<Cow<'a, str>>,
    #[serde(default)]
    id: Option<Value>,
}

/// Hot path: streaming deltas (`item/agentMessage/delta`, `…/outputDelta`).
#[derive(Deserialize)]
struct DeltaLine<'a> {
    #[serde(borrow)]
    params: DeltaParams<'a>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DeltaParams<'a> {
    #[serde(borrow)]
    item_id: Cow<'a, str>,
    #[serde(borrow)]
    delta: Cow<'a, str>,
}

enum Call {
    Initialize,
    Thread,
    Turn,
    Compact,
    Models,
    Other(&'static str),
}

pub struct Codex {
    cwd: String,
    resume: Option<String>,
    state: AgentState,
    thread: Option<String>,
    turn: Option<String>,
    turn_requested: bool,
    queued: Vec<String>,
    next_id: u64,
    calls: HashMap<u64, Call>,
    /// Pending server requests: opaque id → original JSON-RPC id.
    approvals: HashMap<String, Value>,
    /// Display info of file-change items, reused by their approval request.
    file_items: HashMap<String, (String, String)>,
    streamed: HashMap<String, usize>,
    /// Galeata permission mode, mapped to Codex's approval policy.
    mode: String,
    /// Extra developer instructions given when the thread starts or resumes.
    instructions: Option<String>,
    /// True while the past turns of a resumed thread are being read.
    replaying: bool,
    model: Option<String>,
    models: Vec<Model>,
    models_requested: bool,
    models_loading: bool,
    model_pages: u8,
}

impl Codex {
    /// `resume` is a Codex thread id to continue, if any.
    pub fn new(cwd: &str, resume: Option<&str>) -> Self {
        Self {
            cwd: cwd.to_owned(),
            resume: resume.map(str::to_owned),
            state: AgentState::Starting,
            thread: None,
            turn: None,
            turn_requested: false,
            queued: Vec::new(),
            next_id: 0,
            calls: HashMap::new(),
            approvals: HashMap::new(),
            file_items: HashMap::new(),
            streamed: HashMap::new(),
            mode: "auto".to_owned(),
            instructions: None,
            replaying: false,
            model: None,
            models: Vec::new(),
            models_requested: false,
            models_loading: false,
            model_pages: 0,
        }
    }

    /// Developer instructions sent with `thread/start` / `thread/resume`.
    pub fn with_instructions(mut self, instructions: &str) -> Self {
        self.instructions = Some(instructions.to_owned());
        self
    }

    fn set_state(&mut self, state: AgentState, out: &mut Output) {
        if self.state != state {
            self.state = state;
            out.events.push(AgentEvent::State { state });
        }
    }

    fn call(&mut self, method: &str, params: Value, kind: Call, out: &mut Output) {
        self.next_id += 1;
        self.calls.insert(self.next_id, kind);
        out.writes.push(
            json!({"jsonrpc":"2.0","id":self.next_id,"method":method,"params":params}).to_string(),
        );
    }

    /// Starts a turn with every queued message, once the thread is ready and idle.
    fn flush(&mut self, out: &mut Output) {
        let Some(thread) = self.thread.clone() else {
            return;
        };
        if self.queued.is_empty() || self.turn.is_some() || self.turn_requested {
            return;
        }
        let input = self
            .queued
            .drain(..)
            .map(|text| json!({"type":"text","text":text}))
            .collect::<Vec<_>>();
        self.turn_requested = true;
        self.streamed.clear();
        out.events.push(AgentEvent::TurnStarted);
        self.set_state(AgentState::Working, out);
        let mut params = json!({"threadId":thread,"input":input,"approvalPolicy":self.policy().0,
            "sandboxPolicy":{"type":self.policy().1},"model":self.model});
        if let Some(model) = &self.model {
            params["collaborationMode"] = json!({"mode":if self.mode == "plan" {"plan"} else {"default"},
                "settings":{"model":model,"reasoning_effort":null,"developer_instructions":null}});
        }
        self.call("turn/start", params, Call::Turn, out);
    }

    fn response(&mut self, id: &Value, value: &Value, out: &mut Output) {
        let Some(call) = id.as_u64().and_then(|id| self.calls.remove(&id)) else {
            return;
        };
        if let Some(error) = value.get("error") {
            let method = match call {
                Call::Initialize => "initialize",
                Call::Thread => "thread/start",
                Call::Turn => "turn/start",
                Call::Compact => "thread/compact/start",
                Call::Models => "model/list",
                Call::Other(name) => name,
            };
            let message = format!(
                "Codex a refusé {method} : {}",
                error["message"].as_str().unwrap_or("erreur inconnue")
            );
            if matches!(call, Call::Models) {
                self.models_loading = false;
            }
            if matches!(call, Call::Turn | Call::Compact) {
                self.turn = None;
                self.turn_requested = false;
                out.events.push(AgentEvent::TurnCompleted {
                    status: TurnStatus::Failed,
                    error: Some(message),
                    cost_usd: None,
                    input_tokens: None,
                    output_tokens: None,
                });
                self.set_state(AgentState::Idle, out);
            } else {
                out.events.push(AgentEvent::Error { message });
            }
            return;
        }
        let result = &value["result"];
        match call {
            Call::Initialize => {
                out.writes
                    .push(json!({"jsonrpc":"2.0","method":"initialized"}).to_string());
                let (method, mut params) = match &self.resume {
                    Some(thread) => ("thread/resume", json!({"threadId":thread,"cwd":self.cwd})),
                    None => (
                        "thread/start",
                        json!({"cwd":self.cwd,"approvalPolicy":"on-request","sandbox":"workspace-write"}),
                    ),
                };
                if let Some(instructions) = &self.instructions {
                    params["developerInstructions"] = json!(instructions);
                }
                self.call(method, params, Call::Thread, out);
            }
            Call::Thread => {
                let thread = &result["thread"];
                let id = thread["id"].as_str().unwrap_or_default().to_owned();
                out.events.push(AgentEvent::Session {
                    session_id: id.clone(),
                    model: thread["model"]
                        .as_str()
                        .or(result["model"].as_str())
                        .map(str::to_owned),
                });
                self.thread = Some(id);
                self.model = result["model"]
                    .as_str()
                    .or(thread["model"].as_str())
                    .map(str::to_owned);
                // A resumed thread comes with its past turns: show them first.
                if let Some(turns) = thread["turns"].as_array() {
                    let mut history = Output::default();
                    self.replaying = true;
                    for item in turns
                        .iter()
                        .filter_map(|turn| turn["items"].as_array())
                        .flatten()
                    {
                        if item["type"] == "userMessage" {
                            let text = item["content"]
                                .as_array()
                                .into_iter()
                                .flatten()
                                .filter_map(|part| part["text"].as_str())
                                .collect::<Vec<_>>()
                                .join("\n");
                            if !crate::history::technical(&text) {
                                history.events.push(AgentEvent::UserMessage {
                                    item_id: item["id"].as_str().unwrap_or_default().to_owned(),
                                    text,
                                });
                            }
                        } else {
                            self.item_started(item, &mut history);
                            self.item_completed(item, &mut history);
                        }
                    }
                    self.replaying = false;
                    self.file_items.clear();
                    out.events.extend(crate::history::finish(history.events));
                }
                self.set_state(AgentState::Idle, out);
                self.flush(out);
                if self.models_requested {
                    self.request_models(None, out);
                }
            }
            Call::Turn => {
                self.turn_requested = false;
                if let Some(turn) = result["turn"]["id"].as_str() {
                    self.turn = Some(turn.to_owned());
                }
            }
            // Completion is reported by turn/completed, like a regular turn.
            Call::Compact => {}
            Call::Models => {
                for model in result["data"].as_array().into_iter().flatten() {
                    if model["hidden"] == true {
                        continue;
                    }
                    let Some(id) = model["model"].as_str().or(model["id"].as_str()) else {
                        continue;
                    };
                    if !self.models.iter().any(|old| old.id == id) {
                        self.models.push(Model {
                            id: id.to_owned(),
                            label: model["displayName"].as_str().unwrap_or(id).to_owned(),
                            description: model["description"]
                                .as_str()
                                .unwrap_or_default()
                                .to_owned(),
                            resolved_model: Some(id.to_owned()),
                        });
                    }
                    if self.model.is_none() && model["isDefault"] == true {
                        self.model = Some(id.to_owned());
                        out.events.push(AgentEvent::Model {
                            model: id.to_owned(),
                        });
                    }
                }
                if let Some(cursor) = result["nextCursor"]
                    .as_str()
                    .filter(|_| self.model_pages < 10)
                {
                    self.request_models(Some(cursor), out);
                } else {
                    self.models_loading = false;
                    out.events.push(AgentEvent::Models {
                        models: self.models.clone(),
                    });
                }
            }
            Call::Other(_) => {}
        }
    }

    fn request_models(&mut self, cursor: Option<&str>, out: &mut Output) {
        self.model_pages += 1;
        self.models_requested = false;
        self.models_loading = true;
        self.call(
            "model/list",
            json!({"limit":100,"cursor":cursor,"includeHidden":false}),
            Call::Models,
            out,
        );
    }

    fn item_started(&mut self, item: &Value, out: &mut Output) {
        if is_plan_tool(item) {
            return;
        }
        let id = item["id"].as_str().unwrap_or_default().to_owned();
        let (tool, title, path) = match item["type"].as_str() {
            Some("commandExecution") => (ToolKind::Command, command_title(item), None),
            Some("fileChange") => {
                let paths = changed_paths(item, &self.cwd);
                let diff = item["changes"]
                    .as_array()
                    .map(|changes| {
                        changes
                            .iter()
                            .filter_map(|c| c["diff"].as_str())
                            .collect::<Vec<_>>()
                            .join("\n")
                    })
                    .unwrap_or_default();
                let title = paths.join(", ");
                self.file_items
                    .insert(id.clone(), (title.clone(), head(&diff, MAX_DETAIL)));
                (ToolKind::FileEdit, title, paths.into_iter().next())
            }
            Some("mcpToolCall") => (
                ToolKind::Mcp,
                format!(
                    "{}/{}",
                    item["server"].as_str().unwrap_or("mcp"),
                    item["tool"].as_str().unwrap_or("outil")
                ),
                None,
            ),
            Some("webSearch") => (
                ToolKind::Web,
                item["query"].as_str().unwrap_or_default().to_owned(),
                None,
            ),
            Some("collabAgentToolCall") => (ToolKind::Agent, "Sous-agent".to_owned(), None),
            _ => return,
        };
        out.events.push(AgentEvent::ToolStarted {
            item_id: id,
            tool,
            title,
            path,
        });
    }

    fn item_completed(&mut self, item: &Value, out: &mut Output) {
        if is_plan_tool(item) {
            return;
        }
        let id = item["id"].as_str().unwrap_or_default().to_owned();
        let completed = item["status"].as_str() == Some("completed");
        match item["type"].as_str() {
            Some("plan") => out.events.push(AgentEvent::Plan {
                item_id: id,
                text: item["text"].as_str().unwrap_or_default().to_owned(),
                historical: self.replaying,
            }),
            Some("agentMessage") => out.events.push(AgentEvent::Message {
                item_id: id,
                text: item["text"].as_str().unwrap_or_default().to_owned(),
            }),
            Some("reasoning") => {
                let text = item["summary"]
                    .as_array()
                    .map(|parts| {
                        parts
                            .iter()
                            .filter_map(|p| p.as_str().or(p["text"].as_str()))
                            .collect::<Vec<_>>()
                            .join("\n")
                    })
                    .unwrap_or_default();
                if !text.is_empty() {
                    out.events.push(AgentEvent::Reasoning { item_id: id, text });
                }
            }
            Some("commandExecution") => {
                let output = item["aggregatedOutput"].as_str().unwrap_or_default();
                out.events.push(AgentEvent::ToolCompleted {
                    item_id: id,
                    ok: completed && item["exitCode"].as_i64().unwrap_or(0) == 0,
                    output: (!output.is_empty()).then(|| tail(output, MAX_TOOL_OUTPUT)),
                });
            }
            Some("fileChange") => {
                self.file_items.remove(&id);
                let changes = item["changes"]
                    .as_array()
                    .map(|changes| {
                        changes
                            .iter()
                            .map(|c| FileChange {
                                path: relative(&self.cwd, c["path"].as_str().unwrap_or_default()),
                                kind: c["kind"]["type"].as_str().unwrap_or("update").to_owned(),
                                diff: head(c["diff"].as_str().unwrap_or_default(), MAX_DETAIL),
                            })
                            .collect::<Vec<_>>()
                    })
                    .unwrap_or_default();
                if !changes.is_empty() {
                    out.events.push(AgentEvent::FileChanges {
                        item_id: id.clone(),
                        changes,
                    });
                }
                out.events.push(AgentEvent::ToolCompleted {
                    item_id: id,
                    ok: completed,
                    output: None,
                });
            }
            Some("mcpToolCall") | Some("webSearch") | Some("collabAgentToolCall") => {
                out.events.push(AgentEvent::ToolCompleted {
                    item_id: id,
                    ok: completed || item["status"].is_null(),
                    output: None,
                })
            }
            _ => {}
        }
    }

    fn server_request(&mut self, id: Value, method: &str, params: &Value, out: &mut Output) {
        if method == "item/tool/requestUserInput" {
            let questions = params["questions"]
                .as_array()
                .into_iter()
                .flatten()
                .map(|q| Question {
                    id: q["id"].as_str().unwrap_or_default().to_owned(),
                    header: q["header"].as_str().unwrap_or_default().to_owned(),
                    question: q["question"].as_str().unwrap_or_default().to_owned(),
                    options: q["options"]
                        .as_array()
                        .into_iter()
                        .flatten()
                        .map(|o| QuestionOption {
                            label: o["label"].as_str().unwrap_or_default().to_owned(),
                            description: o["description"].as_str().unwrap_or_default().to_owned(),
                        })
                        .collect(),
                    multi_select: false,
                    // Without options, the answer is free text.
                    allow_other: q["isOther"].as_bool().unwrap_or(false)
                        || q["options"].as_array().is_none_or(|o| o.is_empty()),
                })
                .collect();
            let request_id = id.to_string();
            self.approvals.insert(request_id.clone(), id);
            out.events.push(AgentEvent::Question {
                request_id,
                questions,
            });
            self.set_state(AgentState::WaitingApproval, out);
            return;
        }
        let approval = match method {
            "item/commandExecution/requestApproval" | "execCommandApproval" => Some((
                ApprovalKind::Command,
                params["command"]
                    .as_str()
                    .map(str::to_owned)
                    .or_else(|| {
                        params["command"].as_array().map(|parts| {
                            parts
                                .iter()
                                .filter_map(Value::as_str)
                                .collect::<Vec<_>>()
                                .join(" ")
                        })
                    })
                    .unwrap_or_else(|| "Commande".to_owned()),
                None,
                params["reason"].as_str().map(str::to_owned),
                "Toujours autoriser cette commande dans cette conversation",
            )),
            "item/fileChange/requestApproval" | "applyPatchApproval" => {
                let item = params["itemId"].as_str().unwrap_or_default();
                let (title, diff) = self
                    .file_items
                    .get(item)
                    .cloned()
                    .unwrap_or_else(|| ("Modification de fichiers".to_owned(), String::new()));
                Some((
                    ApprovalKind::FileChange,
                    title,
                    (!diff.is_empty()).then_some(diff),
                    params["reason"].as_str().map(str::to_owned),
                    "Toujours autoriser ces fichiers dans cette conversation",
                ))
            }
            _ => None,
        };
        let Some((kind, title, detail, description, always)) = approval else {
            // Unsupported request types are refused explicitly so the agent never hangs.
            out.writes.push(
                json!({"jsonrpc":"2.0","id":id,"error":{"code":-32601,
                    "message":format!("Galeata ne gère pas encore {method}")}})
                .to_string(),
            );
            out.events.push(AgentEvent::Notice {
                message: format!("Demande Codex non prise en charge par Galeata : {method}"),
            });
            return;
        };
        let request_id = id.to_string();
        self.approvals.insert(request_id.clone(), id);
        out.events.push(AgentEvent::Approval {
            request_id,
            kind,
            title,
            detail,
            description,
            always: Some(always.to_owned()),
        });
        self.set_state(AgentState::WaitingApproval, out);
    }

    fn notification(&mut self, method: &str, line: &str, out: &mut Output) {
        // Hot path first: deltas are parsed into borrowed fields only.
        if method == "item/agentMessage/delta"
            || method == "item/commandExecution/outputDelta"
            || method == "item/fileChange/outputDelta"
        {
            let Ok(DeltaLine { params }) = serde_json::from_str::<DeltaLine>(line) else {
                return;
            };
            if method == "item/agentMessage/delta" {
                out.events.push(AgentEvent::TextDelta {
                    item_id: params.item_id.into_owned(),
                    text: params.delta.into_owned(),
                });
                return;
            }
            let sent = self.streamed.entry(params.item_id.to_string()).or_insert(0);
            if *sent >= MAX_TOOL_OUTPUT {
                return;
            }
            *sent += params.delta.len();
            out.events.push(AgentEvent::ToolOutput {
                item_id: params.item_id.into_owned(),
                text: if *sent >= MAX_TOOL_OUTPUT {
                    format!("{}\n… [sortie tronquée en direct]", params.delta)
                } else {
                    params.delta.into_owned()
                },
            });
            return;
        }
        let interesting = matches!(
            method,
            "item/started"
                | "item/completed"
                | "turn/started"
                | "turn/completed"
                | "turn/diff/updated"
                | "thread/tokenUsage/updated"
                | "serverRequest/resolved"
                | "error"
        );
        if !interesting {
            return;
        }
        let Ok(value) = serde_json::from_str::<Value>(line) else {
            return;
        };
        let params = &value["params"];
        match method {
            "item/started" => self.item_started(&params["item"], out),
            "item/completed" => self.item_completed(&params["item"], out),
            "turn/started" => {
                self.turn = params["turn"]["id"].as_str().map(str::to_owned);
            }
            "turn/completed" => {
                let turn = &params["turn"];
                let status = match turn["status"].as_str() {
                    Some("interrupted") => TurnStatus::Interrupted,
                    Some("failed") => TurnStatus::Failed,
                    _ => TurnStatus::Completed,
                };
                out.events.push(AgentEvent::TurnCompleted {
                    status,
                    error: turn["error"]["message"].as_str().map(str::to_owned),
                    cost_usd: None,
                    input_tokens: None,
                    output_tokens: None,
                });
                self.turn = None;
                self.turn_requested = false;
                self.approvals.clear();
                self.set_state(AgentState::Idle, out);
                self.flush(out);
            }
            "turn/diff/updated" => out.events.push(AgentEvent::TurnDiff {
                diff: head(params["diff"].as_str().unwrap_or_default(), MAX_DETAIL),
            }),
            "thread/tokenUsage/updated" => {
                let usage = &params["tokenUsage"];
                out.events.push(AgentEvent::Usage {
                    input_tokens: usage["last"]["inputTokens"].as_u64().unwrap_or(0),
                    output_tokens: usage["total"]["outputTokens"].as_u64().unwrap_or(0),
                    context_window: usage["modelContextWindow"].as_u64(),
                });
            }
            "serverRequest/resolved" => {
                let id = params["requestId"].to_string();
                if self.approvals.remove(&id).is_some() {
                    out.events
                        .push(AgentEvent::ApprovalResolved { request_id: id });
                }
                if self.approvals.is_empty() && self.state == AgentState::WaitingApproval {
                    self.set_state(AgentState::Working, out);
                }
            }
            "error" => {
                let message = params["error"]["message"]
                    .as_str()
                    .unwrap_or("Erreur Codex")
                    .to_owned();
                out.events
                    .push(if params["willRetry"].as_bool() == Some(true) {
                        AgentEvent::Notice {
                            message: format!("{message} (nouvelle tentative)"),
                        }
                    } else {
                        AgentEvent::Error { message }
                    });
            }
            _ => {}
        }
    }
}

impl Protocol for Codex {
    fn start(&mut self) -> Output {
        let mut out = Output::default();
        out.events.push(AgentEvent::State {
            state: AgentState::Starting,
        });
        out.events.push(AgentEvent::Mode {
            mode: self.mode.clone(),
        });
        self.call(
            "initialize",
            json!({"clientInfo":{"name":"galeata","title":"Galeata","version":env!("CARGO_PKG_VERSION")},"capabilities":{"experimentalApi":true}}),
            Call::Initialize,
            &mut out,
        );
        out
    }

    fn handle_line(&mut self, line: &str) -> Output {
        let mut out = Output::default();
        let Ok(envelope) = serde_json::from_str::<Envelope>(line) else {
            if !line.trim().is_empty() {
                out.events.push(AgentEvent::Notice {
                    message: head(line, 2000),
                });
            }
            return out;
        };
        match (envelope.method, envelope.id) {
            (Some(method), None) => self.notification(&method, line, &mut out),
            (Some(method), Some(id)) => {
                let params = serde_json::from_str::<Value>(line)
                    .map(|mut v| v["params"].take())
                    .unwrap_or(Value::Null);
                self.server_request(id, &method, &params, &mut out);
            }
            (None, Some(id)) => {
                if let Ok(value) = serde_json::from_str::<Value>(line) {
                    self.response(&id, &value, &mut out);
                }
            }
            (None, None) => {}
        }
        out
    }

    fn send_text(&mut self, text: &str) -> Output {
        let mut out = Output::default();
        self.queued.push(text.to_owned());
        self.flush(&mut out);
        out
    }

    fn respond(&mut self, request_id: &str, decision: Decision) -> Result<Output, String> {
        let id = self.approvals.remove(request_id).ok_or_else(|| {
            format!("Demande d’autorisation inconnue ou déjà traitée : {request_id}")
        })?;
        let decision = match decision {
            Decision::Allow => "accept",
            Decision::AllowForSession => "acceptForSession",
            Decision::Deny => "decline",
        };
        let mut out = Output::default();
        out.writes
            .push(json!({"jsonrpc":"2.0","id":id,"result":{"decision":decision}}).to_string());
        out.events.push(AgentEvent::ApprovalResolved {
            request_id: request_id.to_owned(),
        });
        if self.approvals.is_empty() && self.state == AgentState::WaitingApproval {
            self.set_state(AgentState::Working, &mut out);
        }
        Ok(out)
    }

    fn set_mode(&mut self, mode: &str) -> Result<Output, String> {
        if !CODEX_MODES.contains(&mode) {
            return Err(format!("Mode non disponible avec Codex : {mode}"));
        }
        // Applied from the next turn (turn/start carries the approval policy).
        self.mode = mode.to_owned();
        let mut out = Output::default();
        out.events.push(AgentEvent::Mode {
            mode: mode.to_owned(),
        });
        Ok(out)
    }

    fn answer(&mut self, request_id: &str, answer: Answer) -> Result<Output, String> {
        if let Answer::Refuse { message } = answer {
            // Codex has no refusal message: decline, then say it as the next message.
            let out = self.respond(request_id, Decision::Deny)?;
            if !message.trim().is_empty() {
                self.queued.push(message);
            }
            return Ok(out);
        }
        let Answer::Questions(answers) = answer else {
            return Err("Codex ne demande pas de validation de plan : envoyez un message.".into());
        };
        let id = self
            .approvals
            .remove(request_id)
            .ok_or_else(|| format!("Demande inconnue ou déjà traitée : {request_id}"))?;
        // ToolRequestUserInputResponse: {answers: {<question id>: {answers: [..]}}}
        let answers = answers
            .into_iter()
            .map(|(question, values)| (question, json!({ "answers": values })))
            .collect::<serde_json::Map<_, _>>();
        let mut out = Output::default();
        out.writes
            .push(json!({"jsonrpc":"2.0","id":id,"result":{"answers":answers}}).to_string());
        out.events.push(AgentEvent::ApprovalResolved {
            request_id: request_id.to_owned(),
        });
        if self.approvals.is_empty() && self.state == AgentState::WaitingApproval {
            self.set_state(AgentState::Working, &mut out);
        }
        Ok(out)
    }

    fn models(&mut self) -> Output {
        let mut out = Output::default();
        if self.models_loading {
            return out;
        }
        if self.thread.is_none() {
            self.models_requested = true;
        } else {
            self.models.clear();
            self.model_pages = 0;
            self.request_models(None, &mut out);
        }
        out
    }

    fn set_model(&mut self, model: &str) -> Result<Output, String> {
        if self.state != AgentState::Idle || self.turn_requested || self.turn.is_some() {
            return Err("Attendez la fin du tour pour changer de modèle".into());
        }
        if !self.models.iter().any(|available| available.id == model) {
            return Err("Modèle Codex indisponible dans cette conversation".into());
        }
        self.model = Some(model.to_owned());
        Ok(Output {
            events: vec![AgentEvent::Model {
                model: model.to_owned(),
            }],
            writes: vec![],
        })
    }

    fn interrupt(&mut self) -> Output {
        let mut out = Output::default();
        self.queued.clear();
        if let (Some(thread), Some(turn)) = (self.thread.clone(), self.turn.clone()) {
            self.call(
                "turn/interrupt",
                json!({"threadId":thread,"turnId":turn}),
                Call::Other("turn/interrupt"),
                &mut out,
            );
        }
        out
    }

    fn compact(&mut self) -> Result<Output, String> {
        if self.state != AgentState::Idle || self.turn_requested || self.turn.is_some() {
            return Err("Attendez la fin du tour pour compacter la conversation".into());
        }
        let thread = self
            .thread
            .clone()
            .ok_or("Conversation en cours de démarrage")?;
        let mut out = Output::default();
        self.turn_requested = true;
        out.events.push(AgentEvent::TurnStarted);
        out.events.push(AgentEvent::Notice {
            message: "Compaction du contexte…".into(),
        });
        self.set_state(AgentState::Working, &mut out);
        self.call(
            "thread/compact/start",
            json!({"threadId":thread}),
            Call::Compact,
            &mut out,
        );
        Ok(out)
    }
}

/// Modes offered with Codex, from the strictest to full access (same ids as
/// Claude's): read-only, ask for anything not known safe, Codex "Auto" (asks only
/// to leave the workspace sandbox), full access without approvals.
pub const CODEX_MODES: [&str; 4] = ["plan", "default", "auto", "bypassPermissions"];

impl Codex {
    /// (approvalPolicy, sandboxPolicy type) sent with each turn.
    fn policy(&self) -> (&'static str, &'static str) {
        match self.mode.as_str() {
            "plan" => ("on-request", "readOnly"),
            "default" => ("untrusted", "workspaceWrite"),
            "bypassPermissions" => ("never", "dangerFullAccess"),
            _ => ("on-request", "workspaceWrite"),
        }
    }
}

/// Prefers the parsed command action (`cat a.txt`) over the shell wrapper
/// (`/usr/bin/zsh -lc 'cat a.txt'`).
fn command_title(item: &Value) -> String {
    let actions = item["commandActions"].as_array();
    actions
        .and_then(|actions| {
            let commands = actions
                .iter()
                .filter_map(|a| a["command"].as_str())
                .collect::<Vec<_>>();
            (!commands.is_empty()).then(|| commands.join(" && "))
        })
        .or_else(|| item["command"].as_str().map(str::to_owned))
        .unwrap_or_else(|| "Commande".to_owned())
}

fn changed_paths(item: &Value, cwd: &str) -> Vec<String> {
    item["changes"]
        .as_array()
        .map(|changes| {
            changes
                .iter()
                .filter_map(|c| c["path"].as_str())
                .map(|p| relative(cwd, p))
                .collect()
        })
        .unwrap_or_default()
}

/// Galeata's own plan tools: shown in the mission plan, not as tool cards.
fn is_plan_tool(item: &Value) -> bool {
    item["type"] == "mcpToolCall"
        && item["server"] == "galeata"
        && item["tool"]
            .as_str()
            .is_some_and(|t| t.starts_with("plan."))
}
