import { Text, Button, TextInput } from './ui/Controls.tsx';
import type { Activity, Plan } from '../types.ts';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { desktop } from '../api.ts';
import { agentStore } from '../agents/store.ts';
import { closeAgent, listenToAgents, startAgent } from '../agents/api.ts';
import { readShowTools, resolveAgent, writeShowTools } from '../agents/preferences.ts';
import { providerNames, type Provider } from '../agents/types.ts';
import type { Provider as ProviderInfo, Session } from '../types.ts';
import { useConversationLayout } from './useConversationLayout.ts';
import { relativeTime } from '../domain.ts';
import AgentChat from './AgentChat.tsx';
import { Icon } from './Icon.tsx';

const install: Record<Provider, { command: string; docs: string }> = {
  claude: {
    command: 'curl -fsSL https://claude.ai/install.sh | bash',
    docs: 'https://docs.claude.com/fr/docs/claude-code/setup',
  },
  codex: {
    command: 'npm install -g @openai/codex',
    docs: 'https://developers.openai.com/codex/cli',
  },
};

/**
 * The center of Galeata: agent conversations. One "+" starts the default
 * agent (chosen in the preferences), with one active conversation tab.
 */
export default function AgentWorkspace({
  workspaceId,
  providers,
  sessions,
  defaultAgent,
  onOpenFile,
  onShowDiff,
  onOpenTerminal,
  onOpenPreferences,
  onError,
  onRefreshProviders,
  onActiveChange,
}: {
  workspaceId?: string;
  missionEvents?: Activity[];
  missionPlan?: Plan;
  providers: ProviderInfo[];
  sessions: Session[];
  defaultAgent: Provider;
  onOpenFile: (path: string) => void;
  onShowDiff: (path: string) => void;
  onOpenTerminal: (provider: Provider, sessionId?: string) => void;
  onOpenPreferences: () => void;
  onError: (error: unknown) => void;
  onRefreshProviders: () => void;
  onActiveChange: (id: string) => void;
}) {
  const conversations = useSyncExternalStore(agentStore.subscribe, agentStore.getAll);
  const { active, select: setActive } = useConversationLayout(conversations.map(c => c.id), workspaceId, onError);
  useEffect(() => { onActiveChange(active); }, [active, onActiveChange]);
  const [names, setNames] = useState<Record<string, string>>(() => {
    try {
      const saved: unknown = JSON.parse(localStorage.getItem('galeata:conversation-names') ?? '{}');
      return saved && typeof saved === 'object' && !Array.isArray(saved)
        ? Object.fromEntries(Object.entries(saved).filter(([, value]) => typeof value === 'string').slice(-200)) : {};
    } catch { return {}; }
  });
  const [renaming, setRenaming] = useState('');
  const [draftName, setDraftName] = useState('');
  const dragging = useRef('');
  function endDrag() { dragging.current = ''; }
  function label(id: string) {
    const conversation = agentStore.get(id);
    if (!conversation) return '';
    const first = conversation.items.find(item => item.kind === 'user')?.text.trim().split('\n')[0];
    const number = conversations.filter(c => c.provider === conversation.provider).findIndex(c => c.id === id) + 1;
    return names[`${conversation.provider}:${conversation.sessionId ?? id}`] || names[id] || first?.slice(0, 60) || `${providerNames[conversation.provider]} ${number}`;
  }
  function rename(id: string) {
    const name = draftName.trim().slice(0, 80);
    const conversation = agentStore.get(id);
    if (name && conversation) setNames(previous => {
      const next = Object.fromEntries(Object.entries({ ...previous,
        [id]: name, [`${conversation.provider}:${conversation.sessionId ?? id}`]: name,
      }).slice(-200));
      try { localStorage.setItem('galeata:conversation-names', JSON.stringify(next)); } catch { /* optional storage */ }
      return next;
    });
    setRenaming('');
  }
  const [starting, setStarting] = useState(false);
  const [showTools, setShowTools] = useState(readShowTools);
  useEffect(() => {
    writeShowTools(showTools);
  }, [showTools]);
  useEffect(() => {
    void listenToAgents();
  }, []);
  const available = (['claude', 'codex'] as Provider[]).filter(
    (id) => providers.find((p) => p.id === id)?.available,
  );
  const agent = desktop ? resolveAgent(defaultAgent, available) : defaultAgent;
  const problems = providers.filter((p) => !p.available && p.error);

  async function start(provider: Provider | null, resumeId?: string) {
    // The browser preview replays a recorded session instead of starting an agent.
    if (!provider && desktop) return;
    setStarting(true);
    try {
      setActive(await startAgent(provider ?? 'claude', resumeId));
    } catch (error) {
      onError(error);
    } finally {
      setStarting(false);
    }
  }
  const newLabel = !desktop
    ? 'Nouvelle conversation de démonstration'
    : agent
      ? `Nouvelle conversation (${providerNames[agent]})`
      : 'Aucun agent disponible';

  return (
    <div className="agent-workspace">
      <div className="agent-tabs" role="tablist" aria-label="Conversations">
        {conversations.map((conversation) => (
          <div
            key={conversation.id}
            draggable={renaming !== conversation.id}
            onDragStart={event => {
              dragging.current = conversation.id;
              event.dataTransfer.setData('text/plain', conversation.id);
              event.dataTransfer.effectAllowed = 'move';
            }}
            onDragEnd={endDrag}
            onDragOver={event => event.preventDefault()}
            onDrop={event => {
              event.preventDefault();
              agentStore.reorder(dragging.current || event.dataTransfer.getData('text/plain'), conversation.id);
              endDrag();
            }}
            className={`agent-tab ${conversation.id === active ? 'active' : ''}`}
          >
            <Button
              role="tab"
              aria-selected={conversation.id === active}
              onDoubleClick={() => { setRenaming(conversation.id); setDraftName(label(conversation.id)); }}
              title={`${label(conversation.id)} · ${providerNames[conversation.provider]} · Double-cliquer pour renommer`}
              onClick={() => {
                setActive(conversation.id);
              }}
            >
              <span className={`status-dot state-${conversation.state}`} />
              <span className="conversation-name">{label(conversation.id)}</span>
            </Button>
            {renaming === conversation.id ? <TextInput autoFocus aria-label="Nom de la conversation"
              value={draftName} maxLength={80} onChange={event => setDraftName(event.target.value)}
              onBlur={() => rename(conversation.id)} onKeyDown={event => {
                if (event.key === 'Enter') rename(conversation.id);
                if (event.key === 'Escape') setRenaming('');
              }} /> : <Button className="tab-close" aria-label={`Renommer ${label(conversation.id)}`}
              onClick={() => { setRenaming(conversation.id); setDraftName(label(conversation.id)); }}>✎</Button>}
            <Button
              className="tab-close"
              aria-label={`Fermer la conversation ${label(conversation.id)}`}
              onClick={() => void closeAgent(conversation.id).catch(onError)}
            >
              <Icon name="close" size={12} />
            </Button>
          </div>
        ))}
        <Button
          className="icon-button agent-new"
          title="Nouvelle conversation"
          aria-label="Nouvelle conversation"
          onClick={() => setActive('')}
        >
          <Icon name="plus" size={16} />
        </Button>
        {conversations.length ? (
          <div className="agent-tab-actions">
            <Button
              className={`agent-view-toggle ${!showTools ? 'active' : ''}`}
              title={
                showTools
                  ? 'Masquer les commandes, outils et raisonnements'
                  : 'Réafficher les commandes, outils et raisonnements'
              }
              aria-pressed={!showTools}
              onClick={() => setShowTools((value) => !value)}
            >
              Texte uniquement
            </Button>

          </div>
        ) : null}
      </div>

      {active ? (
        <div className="agent-panes">
          <AgentChat key={active} id={active} showTools={showTools}
            onOpenFile={onOpenFile} onShowDiff={onShowDiff} />
        </div>
      ) : (
        <div className="agent-home">
          <span className="eyebrow">VOS AGENTS AU CENTRE</span>
          {agent || !desktop ? (
            <>
              <Button
                className="button agent-start"
                disabled={starting}
                onClick={() => void start(agent)}
              >
                <Icon name="plus" size={16} />
                {newLabel}
              </Button>
              {desktop ? (
                <Button className="text-button" onClick={onOpenPreferences}>
                  Agent par défaut : {providerNames[defaultAgent]}
                  {agent !== defaultAgent ? ' (non disponible)' : ''} · modifier
                </Button>
              ) : (
                <Text tone="muted" className="small-copy">
                  L’aperçu navigateur rejoue une vraie conversation enregistrée.
                </Text>
              )}
            </>
          ) : (
            <div className="agent-onboarding">
              <p>
                Galeata a besoin de Claude Code ou de Codex : un seul suffit. Installez-en un,
                connectez-vous une fois dans un terminal, puis revenez ici.
              </p>
              {(['claude', 'codex'] as Provider[]).map((provider) => (
                <div className="install-line" key={provider}>
                  <strong>{providerNames[provider]}</strong>
                  <code>{install[provider].command}</code>
                  <Button
                    className="text-button"
                    onClick={() => void navigator.clipboard?.writeText(install[provider].command)}
                  >
                    Copier
                  </Button>
                  <span className="muted">{install[provider].docs}</span>
                </div>
              ))}
              <Button variant="primary" onClick={onRefreshProviders}>
                <Icon name="refresh" size={14} /> Détecter à nouveau
              </Button>
            </div>
          )}
          {problems.length ? (
            <div className="agent-problems" role="status">
              {problems.map((p) => (
                <p key={p.id}>
                  <strong>{providerNames[p.id as Provider] ?? p.id}</strong> installé mais
                  impossible à lancer : <code>{p.error}</code>
                </p>
              ))}
            </div>
          ) : null}
          {sessions.length ? (
            <div className="agent-resume">
              <h3>Reprendre une session</h3>
              {sessions.slice(0, 8).map((session) => {
                const provider = session.provider as Provider;
                const ready = available.includes(provider);
                return (
                  <div className="resume-row" key={`${session.provider}:${session.id}`}>
                    <Button
                      className="resume-main"
                      disabled={!ready || starting}
                      title={
                        ready
                          ? 'Reprendre cette conversation'
                          : `${providerNames[provider]} n’est pas disponible`
                      }
                      onClick={() => void start(provider, session.id)}
                    >
                      <span className="resume-title">{session.title}</span>
                      {session.description ? (
                        <span className="resume-description">{session.description}</span>
                      ) : null}
                      <span className="resume-meta">
                        {providerNames[provider] ?? provider}
                        {session.branch ? (
                          <>
                            {' · '}
                            <Icon name="branch" size={10} /> {session.branch}
                          </>
                        ) : null}
                        {' · '}
                        {relativeTime(session.modifiedAt)}
                      </span>
                    </Button>
                    <Button
                      variant="icon"
                      title="Reprendre dans le terminal"
                      aria-label={`Reprendre ${session.title} dans le terminal`}
                      disabled={!ready}
                      onClick={() => onOpenTerminal(provider, session.id)}
                    >
                      <Icon name="terminal" size={13} />
                    </Button>
                  </div>
                );
              })}
            </div>
          ) : null}
        </div>
      )}

    </div>
  );
}
