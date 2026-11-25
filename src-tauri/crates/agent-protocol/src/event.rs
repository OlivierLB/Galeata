use serde::Serialize;

/// Galeata's provider-independent agent event, serialized for the UI.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum AgentEvent {
    /// The native session (Claude session / Codex thread) is known.
    #[serde(rename_all = "camelCase")]
    Session {
        session_id: String,
        model: Option<String>,
    },
    Models {
        models: Vec<Model>,
    },
    Model {
        model: String,
    },
    /// Coarse state, emitted only on change.
    State {
        state: AgentState,
    },
    TurnStarted,
    #[serde(rename_all = "camelCase")]
    TurnCompleted {
        status: TurnStatus,
        error: Option<String>,
        cost_usd: Option<f64>,
        input_tokens: Option<u64>,
        output_tokens: Option<u64>,
    },
    /// A message the user sent earlier (history of a resumed conversation).
    #[serde(rename_all = "camelCase")]
    UserMessage {
        item_id: String,
        text: String,
    },
    /// Streaming fragment of an assistant message.
    #[serde(rename_all = "camelCase")]
    TextDelta {
        item_id: String,
        text: String,
    },
    /// Final text of an assistant message (replaces its deltas).
    #[serde(rename_all = "camelCase")]
    Message {
        item_id: String,
        text: String,
    },
    #[serde(rename_all = "camelCase")]
    Reasoning {
        item_id: String,
        text: String,
    },
    #[serde(rename_all = "camelCase")]
    ToolStarted {
        item_id: String,
        tool: ToolKind,
        title: String,
        path: Option<String>,
    },
    #[serde(rename_all = "camelCase")]
    ToolOutput {
        item_id: String,
        text: String,
    },
    #[serde(rename_all = "camelCase")]
    ToolCompleted {
        item_id: String,
        ok: bool,
        output: Option<String>,
    },
    #[serde(rename_all = "camelCase")]
    FileChanges {
        item_id: String,
        changes: Vec<FileChange>,
    },
    /// Unified diff of everything the current turn changed so far.
    TurnDiff {
        diff: String,
    },
    #[serde(rename_all = "camelCase")]
    Approval {
        request_id: String,
        kind: ApprovalKind,
        title: String,
        detail: Option<String>,
        /// Why the agent wants it, in its own words (Claude's `description`, Codex's reason).
        description: Option<String>,
        /// Exact scope of "always allow", when the agent offers one.
        always: Option<String>,
    },
    /// Current permission mode (`default`, `acceptEdits`, `auto`, `plan`…).
    Mode {
        mode: String,
    },
    /// The agent proposes a plan and waits for it to be approved or refined
    /// (Claude Code `ExitPlanMode`).
    #[serde(rename_all = "camelCase")]
    PlanProposal {
        request_id: String,
        plan: String,
        path: Option<String>,
    },
    /// A plan the agent produced without asking (Codex plan items).
    #[serde(rename_all = "camelCase")]
    Plan {
        item_id: String,
        text: String,
        /// From the history of a resumed conversation: its progress is unknown.
        #[serde(default)]
        historical: bool,
    },
    /// The agent asks the user one or more questions and waits for the answers
    /// (Claude Code `AskUserQuestion`, Codex `requestUserInput`).
    #[serde(rename_all = "camelCase")]
    Question {
        request_id: String,
        questions: Vec<Question>,
    },
    #[serde(rename_all = "camelCase")]
    ApprovalResolved {
        request_id: String,
    },
    #[serde(rename_all = "camelCase")]
    Usage {
        input_tokens: u64,
        output_tokens: u64,
        context_window: Option<u64>,
    },
    /// Information worth showing that is not an error (e.g. a denied permission).
    Notice {
        message: String,
    },
    Error {
        message: String,
    },
    /// The agent process ended. Always the last event of an agent.
    Exited {
        code: Option<i32>,
        stderr: Option<String>,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum AgentState {
    Starting,
    Idle,
    Working,
    WaitingApproval,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum TurnStatus {
    Completed,
    Interrupted,
    Failed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ToolKind {
    Command,
    FileRead,
    FileEdit,
    Search,
    Web,
    Mcp,
    Agent,
    Other,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ApprovalKind {
    Command,
    FileChange,
    Tool,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Question {
    /// Key of the answer (question text for Claude, question id for Codex).
    pub id: String,
    pub header: String,
    pub question: String,
    pub options: Vec<QuestionOption>,
    pub multi_select: bool,
    /// A free answer is accepted besides the options.
    pub allow_other: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct QuestionOption {
    pub label: String,
    pub description: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct FileChange {
    pub path: String,
    /// `add`, `delete` or `update`.
    pub kind: String,
    pub diff: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Model {
    pub id: String,
    pub label: String,
    pub description: String,
    pub resolved_model: Option<String>,
}

/// Merges adjacent streaming fragments of the same item and keeps only the
/// latest of repeated snapshots, to cut IPC messages and UI renders.
/// Order between distinct items is preserved.
pub fn coalesce(events: &mut Vec<AgentEvent>) {
    let mut merged: Vec<AgentEvent> = Vec::with_capacity(events.len());
    for event in events.drain(..) {
        match (merged.last_mut(), event) {
            (
                Some(AgentEvent::TextDelta { item_id, text }),
                AgentEvent::TextDelta {
                    item_id: next_id,
                    text: next,
                },
            ) if *item_id == next_id => text.push_str(&next),
            (
                Some(AgentEvent::ToolOutput { item_id, text }),
                AgentEvent::ToolOutput {
                    item_id: next_id,
                    text: next,
                },
            ) if *item_id == next_id => text.push_str(&next),
            (Some(last @ AgentEvent::TurnDiff { .. }), next @ AgentEvent::TurnDiff { .. })
            | (Some(last @ AgentEvent::Usage { .. }), next @ AgentEvent::Usage { .. }) => {
                *last = next
            }
            (_, event) => merged.push(event),
        }
    }
    *events = merged;
}

#[cfg(test)]
mod tests {
    use super::*;

    fn delta(id: &str, text: &str) -> AgentEvent {
        AgentEvent::TextDelta {
            item_id: id.into(),
            text: text.into(),
        }
    }

    #[test]
    fn coalesces_adjacent_fragments_without_reordering() {
        let mut events = vec![
            delta("a", "Bon"),
            delta("a", "jour"),
            delta("b", "x"),
            delta("a", "!"),
            AgentEvent::TurnDiff { diff: "1".into() },
            AgentEvent::TurnDiff { diff: "2".into() },
        ];
        coalesce(&mut events);
        assert_eq!(
            events,
            vec![
                delta("a", "Bonjour"),
                delta("b", "x"),
                delta("a", "!"),
                AgentEvent::TurnDiff { diff: "2".into() },
            ]
        );
    }

    #[test]
    fn serializes_compact_camel_case_events() {
        let json = serde_json::to_string(&AgentEvent::ToolStarted {
            item_id: "t1".into(),
            tool: ToolKind::FileEdit,
            title: "src/a.rs".into(),
            path: Some("src/a.rs".into()),
        })
        .unwrap();
        assert_eq!(
            json,
            r#"{"type":"toolStarted","itemId":"t1","tool":"fileEdit","title":"src/a.rs","path":"src/a.rs"}"#
        );
    }
}
