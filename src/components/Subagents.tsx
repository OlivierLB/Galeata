import { Button, Checkbox } from './ui/Controls.tsx';
import { useEffect, useMemo, useRef, useState } from 'react';
import { request, subscribe } from '../api.ts';
import { conversationSubagents } from '../agents/subagents.ts';
import type { ChatItem, Conversation } from '../agents/types.ts';
import type { Activity } from '../types.ts';
import ModalDialog from './ModalDialog.tsx';
import { Icon } from './Icon.tsx';

export default function Subagents({ conversation }: { conversation: Conversation }) {
  const [events, setEvents] = useState<Activity[]>([]);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState('');
  const [includeDone, setIncludeDone] = useState(false);
  useEffect(() => {
    let disposed = false;
    let cleanup: (() => void) | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = () => { void request<Activity[]>('activity.list', { conversationId: conversation.id })
      .then(value => { if (!disposed) { setEvents(value); setError(''); } })
      .catch(reason => { if (!disposed) setError(String(reason)); }); };
    load();
    void subscribe('activity:changed', () => { clearTimeout(timer); timer = setTimeout(load, 100); })
      .then(stop => { if (disposed) stop(); else cleanup = stop; })
      .catch(reason => { if (!disposed) setError(String(reason)); });
    return () => { disposed = true; clearTimeout(timer); cleanup?.(); };
  }, [conversation.id]);
  const delegationItems = useRef<ChatItem[]>([]);
  const tools = conversation.items.filter(item => item.kind === 'tool' && item.tool === 'agent');
  if (tools.length !== delegationItems.current.length || tools.some((item, index) => item !== delegationItems.current[index])) delegationItems.current = tools;
  const agents = useMemo(() => conversationSubagents({ ...conversation, items: delegationItems.current }, events, true),
    [conversation.id, conversation.sessionId, conversation.provider, delegationItems.current, events]);
  const active = agents.filter(agent => agent.active);
  const shown = includeDone ? agents : active;
  const current = shown.find(agent => agent.id === selected) ?? shown[0];
  return <>
    <Button className="text-button subagents-trigger" onClick={() => setOpen(true)} aria-haspopup="dialog">
      <Icon name="agents" size={13} /> Sous-agents · {active.length} actif{active.length === 1 ? '' : 's'} · {agents.length} utilisé{agents.length === 1 ? '' : 's'}
    </Button>
    {open ? <ModalDialog title="Sous-agents de cette conversation" closeLabel="Fermer les sous-agents"
      className="subagents-dialog" onClose={() => setOpen(false)}>
      <div className="subagents-content">
        <label><Checkbox checked={includeDone} onChange={event => setIncludeDone(event.target.checked)} /> Inclure les terminés</label>
        {error ? <p role="alert">Le suivi déclaré n’a pas pu être chargé : {error}</p> : null}
        <div className="subagent-tabs" role="tablist" aria-label="Sous-agents">
          {shown.map((agent, index) => <Button key={agent.id} id={`subagent-tab-${index}`} role="tab"
            aria-selected={agent.id === current?.id} aria-controls="subagent-details"
            onClick={() => setSelected(agent.id)} onKeyDown={event => {
              if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
              event.preventDefault();
              const next = event.key === 'Home' ? 0 : event.key === 'End' ? shown.length - 1
                : (index + (event.key === 'ArrowRight' ? 1 : shown.length - 1)) % shown.length;
              setSelected(shown[next].id); document.getElementById(`subagent-tab-${next}`)?.focus();
            }} tabIndex={agent.id === current?.id ? 0 : -1}>
            {agent.name} <small>{agent.status}</small>
          </Button>)}
        </div>
        {current ? <section id="subagent-details" role="tabpanel" aria-labelledby={`subagent-tab-${shown.indexOf(current)}`}>
          <p className="muted">{current.id} · {current.status}</p>
          <h3>Consigne initiale</h3>
          <pre>{current.prompt || 'La consigne initiale n’a pas été transmise par le fournisseur.'}</pre>
          <h3>Tâches en cours</h3>
          {current.active && current.tasks.length ? <ul>{current.tasks.map((task, index) => <li key={index}>{task}</li>)}</ul>
            : <p>{current.active ? 'Aucun détail de tâche transmis pour le moment.' : 'Aucune tâche en cours.'}</p>}
          {current.updates.length ? <><h3>Mises à jour</h3>{current.updates.map((update, index) => <pre key={index}>{update}</pre>)}</> : null}
          {current.result ? <><h3>Dernier compte rendu transmis</h3><pre>{current.result}</pre></> : null}
        </section> : <p>Aucun sous-agent {includeDone ? 'utilisé' : 'actif'} dans cette conversation.</p>}
      </div>
    </ModalDialog> : null}
  </>;
}
