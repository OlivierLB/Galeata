//! Native agent conversations: starts Claude Code / Codex in structured mode via
//! `galeata-agent-protocol` and forwards their normalized events to the UI as
//! `agent:events` `{agentId, events}` batches.

use crate::{
    store::{self, Result},
    terminal,
    workspace::Workspace,
};
use galeata_agent_protocol::{
    claude_history, plan_from_markdown, Agent, AgentEvent, Answer, Claude, Codex, Decision, Launch,
    Protocol, CLAUDE_MODES,
};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    path::Path,
    sync::{Arc, Mutex},
};
use tauri::{AppHandle, Emitter, Manager};

pub struct Running {
    pub agent: Agent,
    pub provider: String,
    pub workspace: String,
    pub plan_scope: String,
}
pub type Agents = Mutex<HashMap<String, Running>>;

pub fn start(
    app: &AppHandle,
    agents: &Agents,
    w: &Workspace,
    provider: &str,
    resume: Option<&str>,
    mode: Option<&str>,
    socket: &Path,
) -> Result<Value> {
    if let Some(id) = resume {
        // Session/thread ids are UUID-like; never pass free text as an argument.
        if id.is_empty() || !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
            return Err("Identifiant de session invalide".into());
        }
    }
    let id = uuid::Uuid::new_v4().to_string();
    let state = app.state::<Arc<crate::State>>();
    let alias = resume.map(|session| format!("plan-session:{provider}:{session}"));
    let plan_scope = alias
        .as_deref()
        .and_then(|key| state.store.preference(&w.id, key).ok())
        .and_then(|value| value.as_str().map(str::to_owned))
        .unwrap_or_else(|| format!("{}:conversation:{}", w.id, resume.unwrap_or(&id)));
    let cwd = w.root.to_string_lossy().into_owned();
    let bridge = terminal::bridge_path(app)?;
    let bridge_args = json!([
        "--socket",
        socket.to_string_lossy(),
        "--workspace",
        w.id,
        "--conversation",
        id
    ]);
    let (launch, protocol): (Launch, Box<dyn Protocol>) = match provider {
        "claude" => {
            let mut args: Vec<String> = [
                "-p",
                "--input-format",
                "stream-json",
                "--output-format",
                "stream-json",
                "--include-partial-messages",
                "--verbose",
                "--permission-prompts",
                "host",
                // Routes permission prompts to Galeata (with the initialize request).
                "--permission-prompt-tool",
                "stdio",
                // Only makes the "no limit" mode selectable; it is never on by default.
                "--allow-dangerously-skip-permissions",
            ]
            .map(String::from)
            .to_vec();
            if bridge.is_file() {
                args.push("--mcp-config".into());
                args.push(
                    json!({"mcpServers":{"galeata":{"command":bridge.to_string_lossy(),"args":bridge_args}}})
                        .to_string(),
                );
                // Galeata's own tools never need a permission prompt.
                args.push("--allowedTools".into());
                args.push("mcp__galeata".into());
                args.push("--append-system-prompt".into());
                args.push(if resume.is_some() {
                    format!("{PLAN_INSTRUCTIONS} {RESUME_INSTRUCTIONS}")
                } else {
                    PLAN_INSTRUCTIONS.to_owned()
                });
            }
            if let Some(id) = resume {
                args.push("--resume".into());
                args.push(id.into());
                // Claude Code records the system prompt on a conversation's first
                // request and reuses it on resume, ignoring --append-system-prompt
                // (verified with 2.1.331): re-render it so Galeata's instructions apply.
                args.push("--system-prompt-snapshot".into());
                args.push("off".into());
            }
            if let Some(mode) = mode {
                if !CLAUDE_MODES.contains(&mode) {
                    return Err(format!("Mode Claude inconnu : {mode}"));
                }
                args.push("--permission-mode".into());
                args.push(mode.into());
            }
            (
                Launch::new("claude", args, &w.root),
                Box::new(Claude::new(&cwd)),
            )
        }
        "codex" => {
            let mut args = vec!["app-server".to_string()];
            if bridge.is_file() {
                args.push("-c".into());
                args.push(format!(
                    "mcp_servers.galeata.command={}",
                    json!(bridge.to_string_lossy())
                ));
                args.push("-c".into());
                args.push(format!("mcp_servers.galeata.args={bridge_args}"));
                // Verified with Codex 0.172: no approval request for Galeata's tools.
                args.push("-c".into());
                args.push("mcp_servers.galeata.default_tools_approval_mode=\"approve\"".into());
            }
            let mut codex = Codex::new(&cwd, resume);
            if bridge.is_file() {
                codex = codex.with_instructions(&if resume.is_some() {
                    format!("{PLAN_INSTRUCTIONS} {RESUME_INSTRUCTIONS}")
                } else {
                    PLAN_INSTRUCTIONS.to_owned()
                });
            }
            if let Some(mode) = mode {
                codex.set_mode(mode)?;
            }
            (Launch::new("codex", args, &w.root), Box::new(codex))
        }
        _ => return Err(format!("Fournisseur inconnu : {provider}")),
    };
    // Claude does not replay a resumed session in structured mode: read its
    // transcript and send it first (Codex returns it in `thread/resume`).
    if let (Some(session), "claude") = (resume, provider) {
        match claude_transcript(session) {
            Some(transcript) => {
                let history = claude_history(&transcript, &cwd);
                // The conversation's latest plan becomes the mission plan again.
                if let Some(plan) = history.iter().rev().find(|e| {
                    matches!(e, AgentEvent::Plan { .. } | AgentEvent::PlanProposal { .. })
                }) {
                    sync_proposed_plan(
                        app,
                        &plan_scope,
                        &format!("agent:{provider}"),
                        std::slice::from_ref(plan),
                        last_plan_timestamp(&transcript).as_deref(),
                    );
                }
                let _ = app.emit("agent:events", json!({"agentId":id,"events":history}));
            }
            None => {
                let _ = app.emit(
                    "agent:events",
                    json!({"agentId":id,"events":[{"type":"notice","message":"Historique introuvable : la conversation reprend sans afficher les messages précédents."}]}),
                );
            }
        }
    }
    let event_app = app.clone();
    let agent_id = id.clone();
    let workspace_id = w.id.clone();
    let event_scope = plan_scope.clone();
    let event_provider = provider.to_owned();
    let author = format!("agent:{provider}");
    let agent = Agent::spawn(
        launch,
        protocol,
        Arc::new(move |events| {
            for event in &events {
                if let AgentEvent::Session { session_id, .. } = event {
                    let state = event_app.state::<Arc<crate::State>>();
                    let _ = state.store.set_preference(
                        &workspace_id,
                        &format!("plan-session:{event_provider}:{session_id}"),
                        &json!(event_scope),
                    );
                }
            }
            sync_proposed_plan(&event_app, &event_scope, &author, &events, None);
            let _ = event_app.emit("agent:events", json!({"agentId":agent_id,"events":events}));
        }),
    )
    .map_err(|e| {
        format!("{e}. Vérifiez que {provider} est installé et accessible depuis Galeata.")
    })?;
    agents.lock().map_err(|e| e.to_string())?.insert(
        id.clone(),
        Running {
            agent,
            provider: provider.to_owned(),
            workspace: w.id.clone(),
            plan_scope,
        },
    );
    Ok(json!({"id":id,"provider":provider}))
}

fn with_agent<T>(agents: &Agents, id: &str, f: impl FnOnce(&Agent) -> Result<T>) -> Result<T> {
    let agent = agents
        .lock()
        .map_err(|e| e.to_string())?
        .get(id)
        .map(|running| running.agent.clone())
        .ok_or("Conversation inconnue ou fermée")?;
    f(&agent)
}

pub fn send(agents: &Agents, id: &str, text: &str) -> Result<Value> {
    with_agent(agents, id, |agent| agent.send_text(&format!("{text}\n\n[Galeata : après ce message, lisez plan.get, ajoutez les nouvelles tâches sans doublons et préservez les tâches terminées. Actualisez plan.update_step au début et à la fin de chaque tâche, avant votre réponse finale.]"))).map(|_| Value::Null)
}

pub fn respond(agents: &Agents, id: &str, request: &str, decision: &str) -> Result<Value> {
    let decision = match decision {
        "allow" => Decision::Allow,
        "allowForSession" => Decision::AllowForSession,
        "deny" => Decision::Deny,
        _ => return Err(format!("Décision inconnue : {decision}")),
    };
    with_agent(agents, id, |agent| agent.respond(request, decision)).map(|_| Value::Null)
}

/// `{kind:"plan", approve, acceptEdits, feedback?}` or
/// `{kind:"questions", answers:[{id, values:[..]}]}`.
pub fn answer(agents: &Agents, id: &str, request: &str, answer: &Value) -> Result<Value> {
    let answer = match answer["kind"].as_str() {
        Some("plan") => Answer::Plan {
            approve: answer["approve"] == true,
            accept_edits: answer["acceptEdits"] == true,
            feedback: answer["feedback"].as_str().map(str::to_owned),
        },
        Some("refuse") => Answer::Refuse {
            message: answer["message"].as_str().unwrap_or_default().to_owned(),
        },
        Some("questions") => Answer::Questions(
            answer["answers"]
                .as_array()
                .ok_or("Réponses attendues")?
                .iter()
                .map(|a| {
                    let values = a["values"]
                        .as_array()
                        .into_iter()
                        .flatten()
                        .filter_map(Value::as_str)
                        .map(str::to_owned)
                        .collect();
                    (a["id"].as_str().unwrap_or_default().to_owned(), values)
                })
                .collect(),
        ),
        _ => return Err("Type de réponse inconnu".into()),
    };
    with_agent(agents, id, |agent| agent.answer(request, answer)).map(|_| Value::Null)
}

pub fn set_mode(agents: &Agents, id: &str, mode: &str) -> Result<Value> {
    with_agent(agents, id, |agent| agent.set_mode(mode)).map(|_| Value::Null)
}
pub fn models(agents: &Agents, id: &str) -> Result<Value> {
    with_agent(agents, id, |agent| agent.models()).map(|_| Value::Null)
}
pub fn compact(agents: &Agents, id: &str) -> Result<Value> {
    with_agent(agents, id, |agent| agent.compact()).map(|_| Value::Null)
}
pub fn set_model(agents: &Agents, id: &str, model: &str) -> Result<Value> {
    with_agent(agents, id, |agent| agent.set_model(model)).map(|_| Value::Null)
}

pub fn interrupt(agents: &Agents, id: &str) -> Result<Value> {
    with_agent(agents, id, |agent| agent.interrupt()).map(|_| Value::Null)
}

/// Stops the process (if running) and forgets the conversation.
pub fn close(agents: &Agents, id: &str) -> Result<Value> {
    if let Some(running) = agents.lock().map_err(|e| e.to_string())?.remove(id) {
        running.agent.stop();
    }
    Ok(Value::Null)
}

pub fn list(agents: &Agents, workspace: &str) -> Result<Value> {
    Ok(json!(agents
        .lock()
        .map_err(|e| e.to_string())?
        .iter()
        .filter(|(_, running)| running.workspace == workspace)
        .map(|(id, running)| json!({"id":id,"provider":running.provider,"alive":running.agent.is_alive()}))
        .collect::<Vec<_>>()))
}

pub fn any_alive(agents: &Agents) -> bool {
    agents
        .lock()
        .map(|agents| agents.values().any(|running| running.agent.is_alive()))
        .unwrap_or(false)
}

pub fn stop_all(agents: &Agents) {
    if let Ok(mut agents) = agents.lock() {
        for (_, running) in agents.drain() {
            running.agent.stop();
        }
    }
}

/// Upper bound read from a transcript; longer sessions keep their most recent part.
const MAX_TRANSCRIPT: u64 = 32 * 1024 * 1024;

/// `~/.claude/projects/<project>/<session>.jsonl`, read from its end when huge.
fn claude_transcript(session: &str) -> Option<String> {
    read_claude_transcript(
        &crate::sessions::claude_directory().join("projects"),
        session,
    )
}

fn read_claude_transcript(projects: &Path, session: &str) -> Option<String> {
    use std::io::{Read, Seek, SeekFrom};
    let name = format!("{session}.jsonl");
    let path = std::fs::read_dir(projects)
        .ok()?
        .flatten()
        .map(|entry| entry.path().join(&name))
        .find(|path| path.is_file())?;
    let mut file = std::fs::File::open(path).ok()?;
    let length = file.metadata().ok()?.len();
    if length > MAX_TRANSCRIPT {
        file.seek(SeekFrom::End(-(MAX_TRANSCRIPT as i64))).ok()?;
    }
    let mut bytes = Vec::with_capacity(length.min(MAX_TRANSCRIPT) as usize);
    file.take(MAX_TRANSCRIPT).read_to_end(&mut bytes).ok()?;
    let text = String::from_utf8_lossy(&bytes).into_owned();
    // Drop a partial first line when reading from the middle of the file.
    Some(if length > MAX_TRANSCRIPT {
        text.split_once('\n')
            .map(|(_, rest)| rest.to_owned())
            .unwrap_or_default()
    } else {
        text
    })
}

/// Given to agents started from Galeata (with the galeata MCP server).
const PLAN_INSTRUCTIONS: &str = "Pour chaque sous-agent utilisé, déclarez son identité avec activity.report, son parentId, sa name et son initialPrompt complet ; actualisez ses tasks (liste des tâches en cours) et son status pendant son travail. Le parentId doit identifier cette session ou un sous-agent déjà déclaré. Galeata affiche à l’utilisateur un plan de mission à côté de cette conversation, via le serveur MCP « galeata ». Tenez-le à jour sans qu’on vous le demande et sans le mentionner dans vos réponses : après chaque message utilisateur, réconciliez la checklist : ajoutez les nouvelles tâches sans doublons, préservez les tâches terminées et rouvrez celles à corriger ; appelez plan.get puis plan.set (objectif en une phrase, des étapes concrètes, dans la langue de l’utilisateur, en gardant les étapes inchangées) ; au début et à la fin de chaque étape, appelez plan.update_step (in_progress, done, ou blocked avec une note courte). Passez toujours la révision lue ; en cas de REVISION_CONFLICT, relisez avec plan.get puis réessayez. Si vous avez rédigé un plan détaillé (contexte, hypothèses, détail des étapes), passez-le en markdown dans le champ document de plan.set : l’utilisateur le lit dans Galeata. Pour une question simple, lisez le plan et conservez-le si aucune tâche ne change. Si plan.get renvoie tracked: false, l’avancement de ce plan n’a jamais été suivi : indiquez l’état réel de chaque étape avec plan.update_step d’après ce qui a réellement été fait, avant toute autre chose.";

/// Added when a conversation is resumed: its plan may never have been tracked,
/// and only the agent knows what was done. Checked on the next reply, whatever it is.
const RESUME_INSTRUCTIONS: &str = "Cette conversation vient d’être reprise dans Galeata. Au tout début de votre prochaine réponse, quel que soit le message, appelez plan.get ; si le plan renvoie tracked: false, indiquez l’état réel de chacune de ses étapes avec plan.update_step d’après ce qui a réellement été fait dans cette conversation, sans rien refaire, puis répondez normalement.";

/// A plan proposed by the agent (Claude plan mode, Codex plan item) becomes the
/// mission plan right away; steps already started keep their state.
/// A plan read from the history of a resumed conversation is marked "progress
/// not tracked" (Galeata never saw it being carried out) with the date it was
/// proposed, and is left alone if the same plan is already shown.
fn sync_proposed_plan(
    app: &AppHandle,
    workspace: &str,
    author: &str,
    events: &[AgentEvent],
    proposed_at: Option<&str>,
) {
    let state = app.state::<Arc<crate::State>>();
    for event in events {
        let (markdown, historical) = match event {
            AgentEvent::PlanProposal { plan, .. } => (plan, false),
            AgentEvent::Plan {
                text, historical, ..
            } => (text, *historical),
            _ => continue,
        };
        let Some(draft) = plan_from_markdown(markdown) else {
            continue;
        };
        if historical
            && state
                .store
                .plan(workspace)
                .ok()
                .is_some_and(|current| current["revision"].as_u64().unwrap_or(0) > 0)
        {
            // Already shown (maybe with progress since): keep it as it is.
            continue;
        }
        let steps = draft
            .steps
            .into_iter()
            .map(|title| store::PlanStepInput {
                id: None,
                title,
                status: None,
            })
            .collect::<Vec<_>>();
        let saved = state.store.set_plan_document(
            workspace,
            None,
            &draft.objective,
            &steps,
            Some(markdown),
            historical.then_some(proposed_at.unwrap_or("")),
            if historical { "galeata" } else { author },
            if historical {
                "Plan repris de l’historique"
            } else {
                "Plan proposé par l’agent"
            },
        );
        match saved {
            Ok(_) => {
                let _ = app.emit("plan:changed", json!({"workspaceId":workspace.split(":conversation:").next().unwrap_or(workspace)}));
            }
            Err(error) => {
                let _ = state.store.record(
                    workspace,
                    "capability",
                    "galeata",
                    "Le plan proposé n’a pas pu être repris dans le plan de mission",
                    json!({"reason":error}),
                );
            }
        }
    }
}

/// Date (ISO 8601) of the last plan proposed in a Claude transcript.
fn last_plan_timestamp(transcript: &str) -> Option<String> {
    transcript
        .lines()
        .rev()
        .find(|line| line.contains("\"name\":\"ExitPlanMode\""))
        .and_then(|line| serde_json::from_str::<Value>(line).ok())
        .and_then(|value| value["timestamp"].as_str().map(str::to_owned))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resumed_transcript_is_read_from_the_configured_projects_directory() {
        let directory = tempfile::tempdir().unwrap();
        let projects = directory.path().join("custom config/projects");
        let project = projects.join("-workspace");
        std::fs::create_dir_all(&project).unwrap();
        let session = "6e46ad76-900c-41ed-b952-ccc2088beb8d";
        let transcript = "{\"type\":\"user\",\"message\":{\"content\":\"Hello\"}}\n";
        std::fs::write(project.join(format!("{session}.jsonl")), transcript).unwrap();
        assert_eq!(
            read_claude_transcript(&projects, session).as_deref(),
            Some(transcript)
        );
        assert_eq!(read_claude_transcript(&projects, "missing"), None);
    }
}
