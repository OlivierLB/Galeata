import { useMemo, useState, useSyncExternalStore } from 'react';
import { agentStore } from '../agents/store.ts';
import { interruptAgent } from '../agents/api.ts';
import { providerNames } from '../agents/types.ts';
import type { Conversation } from '../agents/types.ts';
import type { Activity, Plan } from '../types.ts';
import { relativeTime } from '../domain.ts';

// Streaming text must not repaint the monitoring panel on every fragment.
let source: Conversation[] | undefined;
let snapshot: Conversation[] = [];
function monitorSnapshot() {
  const current = agentStore.getAll();
  if (source === current) return snapshot;
  source = current;
  const next = current.map(conversation => {
    const items = conversation.items.filter(item => item.kind === 'tool' && item.tool === 'agent').slice(-8);
    const previous = snapshot.find(value => value.id === conversation.id);
    if (previous && previous.busy === conversation.busy && previous.state === conversation.state &&
      previous.sessionId === conversation.sessionId && previous.items.length === items.length &&
      items.every((item, index) => previous.items[index] === item)) return previous;
    return { ...conversation, items };
  });
  if (next.length !== snapshot.length || next.some((value, index) => value !== snapshot[index])) snapshot = next;
  return snapshot;
}

function reportedAgents(output?: string) {
  try {
    const agents: unknown = JSON.parse(output ?? '{}').agents;
    if (!agents || typeof agents !== 'object' || Array.isArray(agents)) return [];
    const labels: Record<string, string> = { running: 'Travaille', completed: 'Terminé', errored: 'En erreur',
      interrupted: 'Interrompu', shutdown: 'Arrêté', notFound: 'Introuvable', pendingInit: 'Démarrage' };
    return Object.entries(agents).slice(0, 32).map(([id, value]) => {
      const state = value && typeof value === 'object' ? value as Record<string, unknown> : {};
      const status = typeof state.status === 'string' ? state.status : 'inconnu';
      return { id, status: labels[status] ?? status,
        message: typeof state.message === 'string' ? state.message.slice(0, 2000) : '' };
    });
  } catch { return []; }
}

export function latestMissions(events: Activity[]) {
  const latest = new Map<string, Activity>();
  for (const event of events) {
    if (event.kind !== 'activity' || typeof event.data.sessionId !== 'string') continue;
    const previous = latest.get(event.data.sessionId);
    if (!previous || previous.createdAt < event.createdAt) latest.set(event.data.sessionId, event);
  }
  return [...latest.values()].sort((a, b) => {
    const priority = (status: unknown) => status === 'blocked' ? 0 : status === 'running' ? 1 : 2;
    return priority(a.data.status) - priority(b.data.status) || b.createdAt - a.createdAt;
  });
}

export default function AgentMonitor({ events, plan, onConversation, onOpen, onDiff, onError }: {
  events: Activity[]; plan?: Plan;
  onConversation: (id: string) => void;
  onOpen: (path: string) => void; onDiff: (path: string) => void;
  onError: (reason: unknown) => void;
}) {
  const conversations = useSyncExternalStore(agentStore.subscribe, monitorSnapshot);
  const missions = useMemo(() => latestMissions(events), [events]);
  const [filter, setFilter] = useState('active');
  const [stopping, setStopping] = useState('');
  const active = missions.filter(event => event.data.status === 'running').length;
  const blocked = missions.filter(event => event.data.status === 'blocked').length;
  const delegations = conversations.flatMap(conversation => conversation.items
    .filter(item => item.kind === 'tool' && item.tool === 'agent').slice(-8)
    .map(item => ({ conversation, item })));
  const visible = missions.filter(event => filter === 'all' || event.data.status !== 'done');
  return <details className="agent-monitor" open>
    <summary>Suivi des agents <span>{active} {active === 1 ? 'mission active' : 'missions actives'} · {blocked} {blocked === 1 ? 'blocage' : 'blocages'} · {delegations.length} {delegations.length === 1 ? 'appel de délégation' : 'appels de délégation'}</span></summary>
    <div className="agent-monitor-body">
      <div className="agent-monitor-toolbar">
        <button className="text-button" aria-pressed={filter === 'active'} onClick={() => setFilter('active')}>En cours et bloqués</button>
        <button className="text-button" aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>Inclure les terminés</button>
        <small>États déclarés par les agents · dernière mise à jour indiquée sur chaque mission</small>
      </div>
      {!visible.length ? <p className="muted">Aucune mission déclarée en cours. Les délégations visibles sont affichées ci-dessous.</p> : null}
      {visible.map(event => {
        const id = String(event.data.sessionId);
        const parent = conversations.find(conversation => conversation.sessionId === id || conversation.id === id ||
          (event.data.parentId && (conversation.sessionId === event.data.parentId || conversation.id === event.data.parentId)));
        const step = plan?.steps.find(step => step.id === event.data.stepId);
        const parentMission = missions.find(candidate => candidate.data.sessionId === event.data.parentId);
        const files = Array.isArray(event.data.files) ? event.data.files.filter((file): file is string => typeof file === 'string') : [];
        const history = events.filter(candidate => candidate.kind === 'activity' && candidate.data.sessionId === id)
          .sort((a, b) => b.createdAt - a.createdAt).slice(0, 6);
        return <article className="agent-mission" key={id} data-status={String(event.data.status)}>
          <div className="agent-mission-heading"><strong>{event.message}</strong><span>{event.data.status === 'blocked' ? 'Bloqué' : event.data.status === 'running' ? 'En cours' : event.data.status === 'done' ? 'Terminé' : 'État inconnu'}</span></div>
          <div className="event-meta">Session {id.slice(0, 12)}{event.data.parentId ? ` · Parent ${String(event.data.parentId).slice(0, 12)}` : ''} · {relativeTime(event.createdAt)} <time title={new Date(event.createdAt).toLocaleString('fr-FR')}>{new Date(event.createdAt).toLocaleTimeString('fr-FR')}</time></div>
          {event.data.status !== 'done' && Date.now() - event.createdAt > 15 * 60_000 ?
            <p className="muted">Déclaration ancienne : état à confirmer auprès du pilote.</p> : null}
          {step ? <p>Étape : {step.title}</p> : null}
          {parentMission ? <p>Rattaché à : {parentMission.message}</p> : null}
          <div className="agent-mission-actions">
            {parent ? <button className="text-button" onClick={() => onConversation(parent.id)}>Ouvrir la conversation pilote</button> : <small>Conversation pilote non reliée</small>}
            {parent && parent.busy && parent.state !== 'exited' ? <button className="text-button" disabled={!!stopping}
              onClick={() => { setStopping(parent.id); void interruptAgent(parent.id).catch(onError).finally(() => setStopping('')); }}>Interrompre la conversation pilote</button> : null}
          </div>
          {files.length ? <details><summary>{files.length} {files.length === 1 ? 'fichier concerné' : 'fichiers concernés'}</summary>
            {files.map(path => <div className="agent-mission-actions" key={path}><button className="text-button" onClick={() => onOpen(path)}>{path}</button><button className="text-button" onClick={() => onDiff(path)}>Voir le diff</button></div>)}
          </details> : null}
          <details><summary>Dernières mises à jour</summary>{history.map(item => <p key={item.id}>{new Date(item.createdAt).toLocaleTimeString('fr-FR')} · {item.message}</p>)}</details>
        </article>;
      })}
      {delegations.length ? <div className="agent-delegations"><h3>Appels de délégation</h3>
        <p className="muted">La fin d’un appel ne garantit pas que le sous-agent est arrêté. Le suivi détaillé dépend des informations transmises par l’agent pilote.</p>
        {delegations.map(({ conversation, item }) => <article className="agent-mission" key={`${conversation.id}:${item.id}`}>
          <div className="agent-mission-heading"><strong>{item.title || 'Délégation'}</strong><span>{item.running ? 'Appel en cours' : item.ok === false ? 'Appel en échec' : 'Appel terminé'}</span></div>
          <button className="text-button" onClick={() => onConversation(conversation.id)}>Voir dans {providerNames[conversation.provider]}</button>
          {reportedAgents(item.output).map(agent => <div key={agent.id} className="agent-reported-state">
            <strong>{agent.id.slice(0, 12)}</strong> · {agent.status} <small>(dernier état transmis)</small>
            {agent.message ? <details><summary>Résultat du sous-agent</summary><p>{agent.message}</p></details> : null}
          </div>)}
          {item.output ? <details><summary>Voir le compte rendu transmis</summary><pre>{item.output}</pre></details> : null}
        </article>)}
      </div> : null}
    </div>
  </details>;
}
