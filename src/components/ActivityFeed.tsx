import { relativeTime } from '../domain.ts';
import type { Activity, Plan } from '../types.ts';
import { Icon } from './Icon.tsx';

export default function ActivityFeed({
  events,
  checksOnly,
  plan,
  onOpen,
  onDiff,
  onProposal,
}: {
  events: Activity[];
  checksOnly: boolean;
  plan: Plan;
  onOpen: (path: string) => void;
  onDiff: (path: string) => void;
  onProposal: (event: Activity) => void;
}) {
  const visible = events.filter((event) => !checksOnly || event.kind === 'verification');
  return (
    <div className="activity-list">
      {visible.map((event) => {
        const step = plan.steps.find((candidate) => candidate.id === event.data.stepId);
        const files = Array.isArray(event.data.files)
          ? event.data.files.filter((path): path is string => typeof path === 'string')
          : [];
        const command =
          event.data.command ??
          (event.data.program
            ? `${event.data.program} ${Array.isArray(event.data.args) ? event.data.args.join(' ') : ''}`
            : '');
        return (
          <article className="activity-event" key={event.id}>
            <span className={`event-icon ${event.kind}`}>
              <Icon
                name={
                  event.kind === 'verification'
                    ? 'check'
                    : event.kind === 'proposal'
                      ? 'warning'
                      : event.kind === 'plan'
                        ? 'plan'
                        : 'history'
                }
                size={14}
              />
            </span>
            <div>
              <div>
                <strong>{event.message}</strong>
                <span className="event-meta">
                  {event.author} · {relativeTime(event.createdAt)}
                </span>
              </div>
              {step ? (
                <span className="activity-step">
                  <Icon name="plan" size={10} />
                  {step.title}
                </span>
              ) : null}
              {event.data.sessionId ? (
                <span className="event-meta">
                  Session {String(event.data.sessionId).slice(0, 12)}
                </span>
              ) : null}
              {event.kind === 'verification' ? (
                <p className="muted">
                  {event.data.provenance === 'galeata_observed'
                    ? 'Exécuté par Galeata'
                    : 'Rapport déclaré'}
                  {event.data.exitCode !== undefined ? (
                    <span className={event.data.exitCode === 0 ? 'exit-success' : 'exit-failure'}>
                      {' '}
                      · code {String(event.data.exitCode)}
                    </span>
                  ) : null}{' '}
                  <code>{String(command)}</code>
                </p>
              ) : null}
              {event.data.error ? <p className="exit-failure">{String(event.data.error)}</p> : null}
              {event.kind === 'handoff' ? (
                <p className="muted">Suite : {String(event.data.nextAction ?? '')}</p>
              ) : null}
              {files.length ? (
                <div className="activity-files">
                  {files.slice(0, 8).map((path) => (
                    <span key={path}>
                      <button
                        className="text-button"
                        title={`Ouvrir ${path}`}
                        onClick={() => onOpen(path)}
                      >
                        <Icon name="files" size={11} />
                        {path}
                      </button>
                      <button
                        className="icon-button"
                        title={`Diff de ${path}`}
                        aria-label={`Diff de ${path}`}
                        onClick={() => onDiff(path)}
                      >
                        <Icon name="git" size={11} />
                      </button>
                    </span>
                  ))}
                  {files.length > 8 ? (
                    <small>+ {files.length - 8} fichier(s) déclaré(s)</small>
                  ) : null}
                </div>
              ) : null}
              {event.kind === 'proposal' ? (
                <div className="proposal-actions">
                  <span>{String(event.data.objective ?? '')}</span>
                  <button className="text-button" onClick={() => onProposal(event)}>
                    Examiner et accepter
                  </button>
                </div>
              ) : null}
              {event.data.output ? (
                <details>
                  <summary>Voir la sortie</summary>
                  <pre>{String(event.data.output)}</pre>
                </details>
              ) : null}
            </div>
          </article>
        );
      })}
      {!visible.length ? (
        <div className="empty-activity">
          <Icon name={checksOnly ? 'check' : 'history'} size={22} />
          <p>
            {checksOnly
              ? 'Aucune vérification enregistrée pour ce projet.'
              : 'L’histoire de votre projet s’écrit ici.'}
          </p>
          <span>Les événements réels apparaîtront au fil de votre travail.</span>
        </div>
      ) : null}
    </div>
  );
}
