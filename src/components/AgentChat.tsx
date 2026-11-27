import { Button, TextArea } from './ui/Controls.tsx';
import ChatMessage from './ChatMessage.tsx';
import { ChoicePicker } from './ChoicePicker.tsx';
import { memo, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { agentStore } from '../agents/store.ts';
import {
  answerAgent,
  interruptAgent,
  respondToAgent,
  sendToAgent,
  setAgentMode,
  setAgentModel,
} from '../agents/api.ts';
import { agentModes } from '../agents/preferences.ts';
import { PlanCard, QuestionCard, type RequestActions } from './AgentRequests.tsx';
import type { Approval, ChatItem, Conversation, Decision, Provider } from '../agents/types.ts';
import { providerNames } from '../agents/types.ts';
import { Markdown } from './Markdown.tsx';
import { Icon } from './Icon.tsx';
import { AgentComposer } from './AgentComposer.tsx';

const toolLabels: Record<string, string> = {
  command: 'Commande',
  fileRead: 'Lecture',
  fileEdit: 'Modification',
  search: 'Recherche',
  web: 'Web',
  mcp: 'MCP',
  agent: 'Sous-agent',
  other: 'Outil',
};
const stateLabels: Record<string, string> = {
  starting: 'Démarrage…',
  idle: 'Prêt',
  working: 'Travaille…',
  waitingApproval: 'Attend votre accord',
  exited: 'Arrêté',
};

interface Actions {
  onOpenFile: (path: string) => void;
  onShowDiff: (path: string) => void;
}
type ItemActions = Actions & RequestActions;

/** One message or tool call. Memoized on the item object: unchanged items never re-render. */
const ItemView = memo(function ItemView({
  item,
  actions,
}: {
  item: ChatItem;
  actions: ItemActions;
}) {
  if (item.kind === 'plan') return <PlanCard item={item} actions={actions} />;
  if (item.kind === 'question') return <QuestionCard item={item} actions={actions} />;
  if (item.kind === 'user')
    return (
      <ChatMessage side="user" createdAt={item.createdAt}>{item.text}{item.images?.map((src, index) => <img className="chat-image" key={index} src={src} alt={`Image jointe ${index + 1}`} />)}</ChatMessage>
    );
  if (item.kind === 'assistant')
    return (
      <ChatMessage side="assistant" createdAt={item.createdAt}>
        {item.streaming ? (
          <div className="chat-streaming">{item.text}</div>
        ) : (
          <Markdown text={item.text} />
        )}
      </ChatMessage>
    );
  if (item.kind === 'reasoning')
    return (
      <details className="chat-item chat-reasoning">
        <summary>Raisonnement</summary>
        <div className="chat-streaming">{item.text}</div>
      </details>
    );
  if (item.kind === 'notice' || item.kind === 'error')
    return (
      <div
        className={`chat-item chat-${item.kind}`}
        role={item.kind === 'error' ? 'alert' : undefined}
      >
        <Icon name={item.kind === 'error' ? 'warning' : 'spark'} size={13} />
        <span>{item.text}</span>
      </div>
    );
  const status = item.running ? 'running' : item.ok === false ? 'failed' : 'done';
  const relativePath = item.path && !item.path.startsWith('/') ? item.path : null;
  return (
    <details
      className={`chat-item chat-tool tool-${status}`}
      open={item.tool === 'command' && item.running}
    >
      <summary>
        <span className={`tool-dot ${status}`} />
        <span className="tool-kind">{toolLabels[item.tool ?? 'other']}</span>
        <span className="tool-title">{item.title || item.path || ''}</span>
        {item.createdAt ? <time className="chat-time" dateTime={new Date(item.createdAt).toISOString()} title={new Date(item.createdAt).toLocaleString('fr-FR')}>{new Date(item.createdAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</time> : null}
        {relativePath ? (
          <span className="tool-actions">
            <Button
              className="text-button"
              onClick={(event) => {
                event.preventDefault();
                actions.onOpenFile(relativePath);
              }}
            >
              Ouvrir
            </Button>
            {item.tool === 'fileEdit' ? (
              <Button
                className="text-button"
                onClick={(event) => {
                  event.preventDefault();
                  actions.onShowDiff(relativePath);
                }}
              >
                Diff
              </Button>
            ) : null}
          </span>
        ) : null}
      </summary>
      {item.changes?.length ? (
        <ul className="tool-changes">
          {item.changes.map((change) => (
            <li key={change.path}>
              <span className="change-kind">{change.kind}</span>
              {change.path.startsWith('/') ? (
                change.path
              ) : (
                <Button className="text-button" onClick={() => actions.onShowDiff(change.path)}>
                  {change.path}
                </Button>
              )}
            </li>
          ))}
        </ul>
      ) : null}
      {item.output ? <pre className="tool-output">{item.output}</pre> : null}
    </details>
  );
});

/**
 * A permission request: what the agent wants to do and why, then one obvious
 * answer. "Always" shows its real scope; refusing can tell the agent what to do.
 */
function ApprovalCard({
  id,
  approval,
  provider,
  mode,
}: {
  id: string;
  approval: Approval;
  provider: Provider;
  mode?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [refusing, setRefusing] = useState(false);
  const [reason, setReason] = useState('');
  const run = (action: Promise<unknown>) => {
    setBusy(true);
    void action
      .catch((error) => agentStore.apply(id, [{ type: 'error', message: String(error) }]))
      .finally(() => setBusy(false));
  };
  const decide = (decision: Decision) => run(respondToAgent(id, approval.requestId, decision));
  const refuse = () =>
    run(answerAgent(id, approval.requestId, { kind: 'refuse', message: reason.trim() }, 'closed'));
  const name = providerNames[provider];
  const what =
    approval.kind === 'command'
      ? `${name} veut exécuter une commande`
      : approval.kind === 'fileChange'
        ? `${name} veut modifier ${approval.title.includes(',') ? 'des fichiers' : 'un fichier'}`
        : `${name} veut utiliser ${approval.title}`;
  const offerAuto = agentModes[provider].some((m) => m.id === 'auto') && mode !== 'auto';
  return (
    <section className="chat-item approval-card" aria-label="Autorisation demandée">
      <header>
        <Icon name="warning" size={14} />
        <strong>{what}</strong>
      </header>
      {approval.description ? <p className="approval-why">{approval.description}</p> : null}
      {approval.kind === 'command' ? (
        <pre className="approval-command">{approval.title}</pre>
      ) : approval.kind === 'fileChange' ? (
        <div className="approval-file">
          <Icon name="edit" size={13} /> {approval.title}
        </div>
      ) : null}
      {approval.detail ? (
        <details className="approval-detail" open={approval.detail.length < 1200}>
          <summary>{approval.kind === 'fileChange' ? 'Contenu' : 'Détails'}</summary>
          <pre>{approval.detail}</pre>
        </details>
      ) : null}
      {refusing ? (
        <div className="approval-refuse">
          <TextArea
            autoFocus
            rows={2}
            aria-label="Que doit faire l’agent à la place ?"
            placeholder="Que doit faire l’agent à la place ? (optionnel)"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                refuse();
              }
            }}
          />
          <Button variant="danger" disabled={busy} onClick={refuse}>
            Refuser
          </Button>
          <Button className="text-button" onClick={() => setRefusing(false)}>
            Annuler
          </Button>
        </div>
      ) : (
        <div className="approval-actions">
          <Button variant="primary" disabled={busy} onClick={() => decide('allow')}>
            <Icon name="check" size={14} /> Autoriser
          </Button>
          {approval.always ? (
            <Button
              className="text-button"
              disabled={busy}
              onClick={() => decide('allowForSession')}
            >
              {approval.always}
            </Button>
          ) : null}
          <Button className="text-button danger" disabled={busy} onClick={() => setRefusing(true)}>
            Refuser…
          </Button>
        </div>
      )}
      {offerAuto ? (
        <p className="approval-hint">
          Trop de demandes ?{' '}
          <Button
            className="text-button"
            onClick={() =>
              void setAgentMode(id, 'auto').catch((error) =>
                agentStore.apply(id, [{ type: 'error', message: String(error) }]),
              )
            }
          >
            Passer cette conversation en mode Auto
          </Button>
          {provider === 'claude' ? ' (votre mode habituel du terminal)' : ''}
        </p>
      ) : null}
    </section>
  );
}

/** Permission mode of a conversation; Shift+Tab in the composer cycles it. */
function ModeSwitch({ id, provider, mode }: { id: string; provider: Provider; mode?: string }) {
  return <ChoicePicker label="Mode d’autorisation" title="Changer de mode (Maj+Tab)"
    value={mode} options={agentModes[provider]} fallback="Mode"
    onChange={next => { void setAgentMode(id, next).catch(error =>
      agentStore.apply(id, [{ type: 'error', message: String(error) }])); }} />;
}

function ModelSwitch({ conversation }: { conversation: Conversation }) {
  const [changing, setChanging] = useState(false);
  const { id, provider, model, models, state, busy } = conversation;
  const selected =
    models.find((option) => option.id === model) ??
    models.find((option) => option.resolvedModel === model) ??
    (!model ? models.find((option) => option.id === 'default') : undefined);
  const value = selected?.id ?? model ?? '';
  return <ChoicePicker className="model-choice" label={`Modèle ${providerNames[provider]}`}
    title={selected?.description || 'Modèle utilisé pour le prochain message'}
    value={value} options={models.map(option => ({ ...option, hint: option.description }))}
    fallback={model || (state === 'starting' ? 'Chargement…' : 'Modèle actuel')}
    disabled={changing || busy || state !== 'idle' || !models.length}
    onChange={next => {
      setChanging(true);
      void setAgentModel(id, next)
        .catch(error => agentStore.apply(id, [{ type: 'error', message: String(error) }]))
        .finally(() => setChanging(false));
    }} />;
}

export default function AgentChat({
  id,
  showTools = true,
  ...actions
}: { id: string; showTools?: boolean } & Actions) {
  const conversation = useSyncExternalStore(agentStore.subscribe, () => agentStore.get(id));
  const scroller = useRef<HTMLDivElement>(null);
  const [historyWindow, setHistoryWindow] = useState({ id, count: 100 });
  const visibleCount = historyWindow.id === id ? historyWindow.count : 100;
  const stick = useRef(true);
  const lastScroll = useRef(0);
  const pointerDown = useRef(false);
  const actionsRef = useRef(actions);
  actionsRef.current = actions;
  // Stable object so memoized items do not re-render when the parent does.
  const [stableActions] = useState<ItemActions>(() => ({
    onOpenFile: (path) => actionsRef.current.onOpenFile(path),
    onShowDiff: (path) => actionsRef.current.onShowDiff(path),
    onAnswer: (item, answer, status, summary) => {
      stick.current = true;
      // A plan that is not a request (Codex, history): nothing to answer, only mark it.
      if (item.status === 'ready') {
        void (async () => {
          if (answer.kind === 'plan' && answer.approve) {
            await setAgentMode(id, 'default');
            await sendToAgent(id, 'Mets en œuvre ce plan.');
          }
          agentStore.markAnswered(id, item.id, status, summary);
        })().catch(error => agentStore.apply(id, [{ type: 'error', message: String(error) }]));
        return;
      }
      void answerAgent(id, item.requestId ?? item.id, answer, status, summary).catch((error) =>
        agentStore.apply(id, [{ type: 'error', message: String(error) }]),
      );
    },
    onSend: (text) => {
      stick.current = true;
      void sendToAgent(id, text).catch((error) =>
        agentStore.apply(id, [{ type: 'error', message: String(error) }]),
      );
    },
  }));

  useLayoutEffect(() => {
    const element = scroller.current;
    if (element && !pointerDown.current && Date.now() - lastScroll.current > 3000) {
      element.scrollTop = element.scrollHeight;
    }
  }, [conversation, showTools]);

  if (!conversation) return null;
  return (
    <section
      className="agent-chat"
      aria-label={`Conversation ${providerNames[conversation.provider]}`}
    >
      <div
        className="chat-scroll"
        ref={scroller}
        onWheel={() => { lastScroll.current = Date.now(); }}
        onTouchMove={() => { lastScroll.current = Date.now(); }}
        onPointerDown={() => { pointerDown.current = true; lastScroll.current = Date.now(); }}
        onPointerUp={() => { pointerDown.current = false; lastScroll.current = Date.now(); }}
        onPointerCancel={() => { pointerDown.current = false; }}
        onPointerLeave={() => { pointerDown.current = false; }}
        onKeyDown={(event) => { if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'].includes(event.key)) lastScroll.current = Date.now(); }}
        onScroll={(event) => {
          if (pointerDown.current) lastScroll.current = Date.now();
          const element = event.currentTarget;
          stick.current = element.scrollHeight - element.scrollTop - element.clientHeight < 48;
        }}
      >
        <div className="chat-column">
          {!conversation.items.length ? (
            <div className="chat-empty">
              <span className="eyebrow">{providerNames[conversation.provider].toUpperCase()}</span>
              <h2>Que voulez-vous construire ?</h2>
              <p>
                L’agent travaille dans ce projet. Les commandes et modifications sensibles vous
                seront demandées ici.
              </p>
              {conversation.demo ? (
                <p className="muted">
                  Démonstration : une vraie session enregistrée est rejouée, aucun agent n’est
                  lancé.
                </p>
              ) : null}
            </div>
          ) : null}
          {conversation.items.length > visibleCount ? (
            <Button className="text-button" onClick={() => {
              stick.current = false;
              setHistoryWindow({ id, count: visibleCount + 100 });
            }}>Afficher 100 éléments précédents</Button>
          ) : null}
          {conversation.items.filter((item, index) =>
            index >= conversation.items.length - visibleCount || item.status === 'pending',
          ).map((item) =>
            showTools || (item.kind !== 'tool' && item.kind !== 'reasoning') ? (
              <ItemView key={item.id} item={item} actions={stableActions} />
            ) : null,
          )}
          {conversation.approvals.map((approval) => (
            <ApprovalCard
              key={approval.requestId}
              id={id}
              approval={approval}
              provider={conversation.provider}
              mode={conversation.mode}
            />
          ))}
        </div>
      </div>
      <AgentComposer
        conversation={conversation}
        onSend={async (text, images) => {
          stick.current = true;
          await sendToAgent(id, text, images);
        }}
      >
        <ModelSwitch conversation={conversation} />
        <ModeSwitch id={id} provider={conversation.provider} mode={conversation.mode} />
        <span className={`agent-state state-${conversation.state}`}>
          <span className="status-dot" /> {stateLabels[conversation.state]}
          {conversation.costUsd ? ` · ${conversation.costUsd.toFixed(2)} $` : ''}
        </span>
        {conversation.busy ? (
          <Button className="text-button" onClick={() => void interruptAgent(id)}>
            Interrompre
          </Button>
        ) : null}
      </AgentComposer>
    </section>
  );
}
