//! Galeata agent protocol layer.
//!
//! Translates the structured protocols of the installed CLIs into one compact
//! event model sent to the UI:
//! - Claude Code: `claude -p --input-format stream-json --output-format stream-json`
//!   (+ `--permission-prompt-tool stdio` and an `initialize` control request).
//! - Codex: `codex app-server` (JSON-RPC over stdio).
//!
//! Performance is the primary constraint: noisy lines (hooks, rate limits,
//! repeated init, input JSON deltas…) are dropped after a borrowed, allocation-free
//! envelope parse; streaming deltas are coalesced before crossing the IPC boundary;
//! command output is bounded per item.
//!
//! This crate is pure (no I/O, no Tauri): the desktop process owns the child
//! processes and feeds lines in; tests replay captured fixtures.

mod claude;
mod codex;
mod env;
mod event;
mod history;
mod plan;
mod process;

pub use claude::{Claude, CLAUDE_MODES};
pub use codex::{Codex, CODEX_MODES};
pub use env::host_env;
pub use event::{
    coalesce, AgentEvent, AgentState, ApprovalKind, FileChange, Model, Question, QuestionOption,
    ToolKind, TurnStatus,
};
pub use history::claude_history;
pub use plan::{plan_from_markdown, PlanDraft};
pub use process::{Agent, Launch, Sink};

/// Upper bound for one tool output forwarded to the UI (streamed and final).
pub const MAX_TOOL_OUTPUT: usize = 256 * 1024;
/// Upper bound for one diff or approval detail forwarded to the UI.
pub const MAX_DETAIL: usize = 512 * 1024;

/// Answer to an approval request.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Decision {
    Allow,
    AllowForSession,
    Deny,
}

/// Answer to a plan proposal or to questions.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Answer {
    /// Approve the plan (optionally accepting file edits for the session), or
    /// keep planning with the user's feedback.
    Plan {
        approve: bool,
        accept_edits: bool,
        feedback: Option<String>,
    },
    /// Selected labels (or free text) per question id.
    Questions(Vec<(String, Vec<String>)>),
    /// Refuse a permission and tell the agent what to do instead.
    Refuse { message: String },
}

/// What a protocol produced for one input line or one user action.
#[derive(Debug, Default)]
pub struct Output {
    /// Events for the UI, in order.
    pub events: Vec<AgentEvent>,
    /// Lines to write on the agent's stdin (each without trailing newline).
    pub writes: Vec<String>,
}

/// Common interface of the provider adapters.
pub trait Protocol: Send {
    /// Lines to send right after spawning the process.
    fn start(&mut self) -> Output;
    /// Handles one line read from the agent's stdout.
    fn handle_line(&mut self, line: &str) -> Output;
    /// Sends a user message.
    fn send_text(&mut self, text: &str) -> Output;
    /// Answers a pending approval. Unknown ids are reported, not ignored.
    fn respond(&mut self, request_id: &str, decision: Decision) -> Result<Output, String>;
    /// Answers a pending plan proposal or question.
    fn answer(&mut self, request_id: &str, answer: Answer) -> Result<Output, String>;
    /// Changes the permission mode for the rest of the conversation.
    fn set_mode(&mut self, mode: &str) -> Result<Output, String>;
    /// Requests the provider's model catalog (Claude sends it during initialization).
    fn models(&mut self) -> Output;
    /// Selects the model used for the next user message.
    fn set_model(&mut self, model: &str) -> Result<Output, String>;
    /// Interrupts the running turn, if any.
    fn interrupt(&mut self) -> Output;
}

/// Makes an absolute path relative to the workspace when it is inside it.
pub(crate) fn relative(cwd: &str, path: &str) -> String {
    let base = cwd.trim_end_matches('/');
    path.strip_prefix(base)
        .and_then(|rest| rest.strip_prefix('/'))
        .map(str::to_owned)
        .unwrap_or_else(|| path.to_owned())
}

/// Keeps the end of a long text (the most useful part of a command output),
/// cutting on a char boundary and marking the truncation.
pub(crate) fn tail(text: &str, max: usize) -> String {
    if text.len() <= max {
        return text.to_owned();
    }
    let mut start = text.len() - max;
    while !text.is_char_boundary(start) {
        start += 1;
    }
    format!("… [{} octets omis]\n{}", start, &text[start..])
}

/// Keeps the beginning of a long text, cutting on a char boundary.
pub(crate) fn head(text: &str, max: usize) -> String {
    if text.len() <= max {
        return text.to_owned();
    }
    let mut end = max;
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    format!("{}\n… [{} octets omis]", &text[..end], text.len() - end)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn relative_paths_stay_inside_workspace_only() {
        assert_eq!(relative("/w/p", "/w/p/src/a.rs"), "src/a.rs");
        assert_eq!(relative("/w/p/", "/w/p/a"), "a");
        assert_eq!(relative("/w/p", "/w/pp/a"), "/w/pp/a");
        assert_eq!(relative("/w/p", "/etc/x"), "/etc/x");
    }

    #[test]
    fn truncation_respects_utf8_boundaries() {
        let text = "é".repeat(10);
        assert!(tail(&text, 5).ends_with("éé"));
        assert!(head(&text, 5).starts_with("éé"));
        assert_eq!(tail("court", 10), "court");
    }
}
