import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { desktop } from '../api.ts';
import { agentStore } from '../agents/store.ts';
import { closeAgent, listenToAgents, startAgent } from '../agents/api.ts';
import { readShowTools, resolveAgent, writeShowTools } from '../agents/preferences.ts';
import { providerNames, type Provider } from '../agents/types.ts';
import type { Provider as ProviderInfo, Session } from '../types.ts';
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
 * agent (chosen in the preferences); tabs, plus an optional side-by-side view.
 */
export default function AgentWorkspace({
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
  const [active, setActive] = useState('');
  useEffect(() => { onActiveChange(active); }, [active, onActiveChange]);
  const [split, setSplit] = useState(false);
  const [starting, setStarting] = useState(false);
  const [showTools, setShowTools] = useState(readShowTools);
  useEffect(() => {
    writeShowTools(showTools);
  }, [showTools]);
  useEffect(() => {
    void listenToAgents();
  }, []);
  // A new conversation (from here or from the sidebar) becomes the active one;
  // closing the active one falls back to the most recent.
  const count = useRef(conversations.length);
  useEffect(() => {
    const grew = conversations.length > count.current;
    count.current = conversations.length;
    if (grew || !conversations.some((c) => c.id === active))
      setActive(conversations[conversations.length - 1]?.id ?? '');
  }, [conversations, active]);

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
  const second = split ? conversations.filter((c) => c.id !== active).at(-1) : undefined;
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
            className={`agent-tab ${conversation.id === active ? 'active' : ''}`}
          >
            <button
              role="tab"
              aria-selected={conversation.id === active}
              onClick={() => setActive(conversation.id)}
            >
              <span className={`status-dot state-${conversation.state}`} />
              {providerNames[conversation.provider]}
              {conversation.demo ? ' · démo' : ''}
            </button>
            <button
              className="tab-close"
              aria-label={`Fermer la conversation ${providerNames[conversation.provider]}`}
              onClick={() => void closeAgent(conversation.id).catch(onError)}
            >
              <Icon name="close" size={12} />
            </button>
          </div>
        ))}
        <button
          className="icon-button agent-new"
          title={newLabel}
          aria-label="Nouvelle conversation"
          disabled={starting || (!agent && desktop)}
          onClick={() => void start(agent)}
        >
          <Icon name="plus" size={16} />
        </button>
        {conversations.length ? (
          <div className="agent-tab-actions">
            <button
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
            </button>
            {conversations.length > 1 ? (
              <button
                className={`icon-button ${split ? 'active' : ''}`}
                title="Afficher deux conversations côte à côte"
                aria-label="Afficher deux conversations côte à côte"
                aria-pressed={split}
                onClick={() => setSplit((value) => !value)}
              >
                <Icon name="panel" size={15} />
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
      {active ? (
        <div className={`agent-panes ${second ? 'split' : ''}`}>
          <AgentChat
            key={active}
            id={active}
            showTools={showTools}
            onOpenFile={onOpenFile}
            onShowDiff={onShowDiff}
          />
          {second ? (
            <AgentChat
              key={second.id}
              id={second.id}
              showTools={showTools}
              onOpenFile={onOpenFile}
              onShowDiff={onShowDiff}
            />
          ) : null}
        </div>
      ) : (
        <div className="agent-home">
          <span className="eyebrow">VOS AGENTS AU CENTRE</span>
          {agent || !desktop ? (
            <>
              <button
                className="button agent-start"
                disabled={starting}
                onClick={() => void start(agent)}
              >
                <Icon name="plus" size={16} />
                {newLabel}
              </button>
              {desktop ? (
                <button className="text-button" onClick={onOpenPreferences}>
                  Agent par défaut : {providerNames[defaultAgent]}
                  {agent !== defaultAgent ? ' (non disponible)' : ''} · modifier
                </button>
              ) : (
                <p className="muted small-copy">
                  L’aperçu navigateur rejoue une vraie conversation enregistrée.
                </p>
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
                  <button
                    className="text-button"
                    onClick={() => void navigator.clipboard?.writeText(install[provider].command)}
                  >
                    Copier
                  </button>
                  <span className="muted">{install[provider].docs}</span>
                </div>
              ))}
              <button className="button" onClick={onRefreshProviders}>
                <Icon name="refresh" size={14} /> Détecter à nouveau
              </button>
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
                    <button
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
                    </button>
                    <button
                      className="icon-button"
                      title="Reprendre dans le terminal"
                      aria-label={`Reprendre ${session.title} dans le terminal`}
                      disabled={!ready}
                      onClick={() => onOpenTerminal(provider, session.id)}
                    >
                      <Icon name="terminal" size={13} />
                    </button>
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
