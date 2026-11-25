import { useMemo, useState, type MouseEvent } from 'react';
import { nextStatus, progress, relativeTime, statusLabels } from '../domain.ts';
import type { Activity, Plan, Step } from '../types.ts';
import { Icon } from './Icon.tsx';
import { planSections } from '../planDocument.ts';

/** Who last touched the plan, in words. */
function authorName(author: string): string {
  if (author === 'vous') return 'Vous';
  if (author === 'agent:claude') return 'Claude Code';
  if (author === 'agent:codex') return 'Codex';
  if (author.startsWith('agent')) return 'L’agent';
  return author;
}

function StepIcon({ status }: { status: Step['status'] }) {
  if (status === 'done') return <Icon name="check" size={12} />;
  if (status === 'blocked') return <span aria-hidden="true">!</span>;
  if (status === 'in_progress') return <span className="active-step-dot" />;
  return null;
}

/**
 * "Avancement": the task's plan as the agent keeps it (proposed plan, steps
 * started and finished), editable by hand. The current step stands out.
 */
export default function PlanPanel({
  plan,
  activities,
  onSave,
  onStep,
  onHistory,
  onEdit,
  onAskProgress,
  width,
}: {
  plan: Plan;
  activities: Activity[];
  onSave: (plan: Plan) => Promise<void>;
  onStep: (step: Step, status: Step['status']) => void;
  onHistory: () => void;
  onEdit: () => void;
  /** Asks the running conversation to report the real state of each step. */
  onAskProgress?: () => void;
  width?: number;
}) {
  // A plan taken from an older conversation: Galeata never saw it being carried
  // out, so it shows no progress rather than a false "0 / n".
  const untracked = plan.tracked === false;
  const [newStep, setNewStep] = useState('');
  const [adding, setAdding] = useState(false);
  const done = plan.steps.filter((step) => step.status === 'done').length;
  const verifications = activities.filter((event) => event.kind === 'verification');
  const latest = plan.steps.reduce<Step | null>(
    (last, step) => (!last || step.updatedAt > last.updatedAt ? step : last),
    null,
  );
  const current = untracked ? undefined : plan.steps.find((step) => step.status === 'in_progress');
  // The plan's full text, with each step's state where the step is described.
  const sections = useMemo(
    () => (plan.document ? planSections(plan.document, plan.steps, plan.objective) : null),
    [plan.document, plan.steps, plan.objective],
  );
  const shown = new Set(
    sections?.flatMap((section) => (section.kind === 'step' ? [section.step.id] : [])),
  );
  // Steps the text does not describe (added by hand or by the agent) stay listed.
  const listed = sections ? plan.steps.filter((step) => !shown.has(step.id)) : plan.steps;
  const noNavigation = (event: MouseEvent) => {
    if ((event.target as HTMLElement).closest('a')) event.preventDefault();
  };
  async function add() {
    if (!newStep.trim()) return;
    await onSave({
      ...plan,
      steps: [
        ...plan.steps,
        {
          id: crypto.randomUUID(),
          title: newStep.trim(),
          status: 'pending',
          note: '',
          author: 'vous',
          updatedAt: Date.now(),
        },
      ],
    });
    setNewStep('');
    setAdding(false);
  }
  return (
    <aside className="plan-panel progress-panel" aria-label="Plan" style={{ width }}>
      <div className="panel-heading">
        <span className="heading-with-icon">
          <Icon name="plan" size={16} /> Plan
        </span>
        <span className="panel-heading-actions">
          <button
            className="icon-button"
            onClick={onHistory}
            title="Historique des changements du plan"
            aria-label="Historique du plan"
          >
            <Icon name="history" size={15} />
          </button>
        </span>
      </div>
      <div className="plan-scroll">
        <header className="progress-goal">
          <h2>{plan.objective || 'Aucune tâche en cours'}</h2>
          <button
            className="icon-button goal-edit"
            onClick={onEdit}
            aria-label="Modifier l’objectif"
            title="Modifier l’objectif"
          >
            <Icon name="edit" size={13} />
          </button>
          {untracked ? (
            <p className="progress-source">
              Repris d’une conversation
              {plan.proposedAt && !Number.isNaN(Date.parse(plan.proposedAt))
                ? ` · plan proposé le ${new Date(plan.proposedAt).toLocaleString('fr-FR', {
                    day: 'numeric',
                    month: 'short',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}`
                : ''}
            </p>
          ) : latest ? (
            <p className="progress-source">
              {authorName(latest.author)} · mis à jour {relativeTime(latest.updatedAt)}
            </p>
          ) : null}
        </header>

        {plan.steps.length ? (
          <>
            {untracked ? (
              <section className="progress-unknown" aria-label="Avancement non suivi">
                <p>
                  <strong>Avancement non suivi.</strong> Ce plan vient d’une conversation reprise :
                  Galeata n’a pas vu le travail se faire. L’agent indiquera l’état réel des étapes à
                  votre prochain message.
                </p>
                {onAskProgress ? (
                  <button className="text-button" onClick={onAskProgress}>
                    <Icon name="refresh" size={13} /> Faire le point maintenant
                  </button>
                ) : null}
              </section>
            ) : (
              <div
                className="progress-count"
                aria-label={`${done} étapes sur ${plan.steps.length} terminées`}
              >
                <div className="progress-track">
                  <div style={{ width: `${progress(plan)}%` }} />
                </div>
                <span>
                  {done} / {plan.steps.length}
                </span>
              </div>
            )}
            {current ? (
              <section className="current-step" aria-label="Étape en cours">
                <span className="current-label">
                  <span className="active-step-dot" /> En cours
                </span>
                <strong>{current.title}</strong>
                {current.note ? <p>{current.note}</p> : null}
              </section>
            ) : null}
            {sections ? (
              <div className="plan-document markdown" onClick={noNavigation}>
                {sections.map((section, index) =>
                  section.kind === 'text' ? (
                    <div key={index} dangerouslySetInnerHTML={{ __html: section.html }} />
                  ) : (
                    <section
                      key={section.step.id}
                      className={`doc-step ${untracked ? 'unknown' : section.step.status}`}
                      aria-label={`Étape : ${section.step.title}`}
                    >
                      <div className="doc-step-heading">
                        <button
                          className={`step-check ${untracked ? 'unknown' : section.step.status}`}
                          title={
                            untracked
                              ? 'État inconnu · cliquer pour l’indiquer'
                              : `${statusLabels[section.step.status]} · cliquer pour changer`
                          }
                          aria-label={`${section.step.title} : ${untracked ? 'état inconnu' : statusLabels[section.step.status]}`}
                          onClick={() => onStep(section.step, nextStatus(section.step.status))}
                        >
                          {untracked ? '?' : <StepIcon status={section.step.status} />}
                        </button>
                        <h3>{section.step.title}</h3>
                        {untracked ? null : section.step.status === 'in_progress' ? (
                          <span className="doc-step-badge">En cours</span>
                        ) : section.step.status === 'blocked' ? (
                          <span className="doc-step-badge blocked">Bloquée</span>
                        ) : null}
                      </div>
                      {section.step.note ? (
                        <p className="doc-step-note">{section.step.note}</p>
                      ) : null}
                      <div dangerouslySetInnerHTML={{ __html: section.html }} />
                    </section>
                  ),
                )}
              </div>
            ) : null}
            <ol className="step-list">
              {listed.map((step) => (
                <li key={step.id} className={`step-row ${untracked ? 'unknown' : step.status}`}>
                  <button
                    className={`step-check ${untracked ? 'unknown' : step.status}`}
                    title={
                      untracked
                        ? 'État inconnu · cliquer pour l’indiquer'
                        : `${statusLabels[step.status]} · cliquer pour changer`
                    }
                    aria-label={`${step.title} : ${untracked ? 'état inconnu' : statusLabels[step.status]}`}
                    onClick={() => onStep(step, nextStatus(step.status))}
                  >
                    {untracked ? '?' : <StepIcon status={step.status} />}
                  </button>
                  <div
                    className="step-text"
                    title={`${authorName(step.author)} · ${relativeTime(step.updatedAt)}`}
                  >
                    <h3>{step.title}</h3>
                    {step.note && step.status !== 'in_progress' ? <p>{step.note}</p> : null}
                  </div>
                  {step.status === 'in_progress' ? (
                    <button
                      className="icon-button step-block"
                      title="Signaler un blocage"
                      aria-label={`Signaler un blocage : ${step.title}`}
                      onClick={() => onStep(step, 'blocked')}
                    >
                      <Icon name="warning" size={13} />
                    </button>
                  ) : null}
                </li>
              ))}
            </ol>
          </>
        ) : (
          <div className="empty-plan">
            <p>
              Le plan apparaîtra ici dès que l’agent en proposera un ou commencera une tâche. Il le
              tient à jour à chaque étape.
            </p>
          </div>
        )}

        {adding ? (
          <form
            className="add-step-form"
            onSubmit={(event) => {
              event.preventDefault();
              void add().catch(() => {});
            }}
          >
            <input
              aria-label="Nouvelle étape"
              autoFocus
              placeholder="Étape à ajouter…"
              value={newStep}
              maxLength={1000}
              onChange={(event) => setNewStep(event.target.value)}
            />
            <div>
              <button type="button" className="text-button" onClick={() => setAdding(false)}>
                Annuler
              </button>
              <button className="button small" disabled={!newStep.trim()}>
                Ajouter
              </button>
            </div>
          </form>
        ) : (
          <button className="add-step" onClick={() => setAdding(true)}>
            <Icon name="plus" size={14} /> Ajouter une étape
          </button>
        )}
        {verifications.length ? (
          <button className="text-button progress-checks" onClick={onHistory}>
            <Icon name="check" size={13} /> {verifications.length} vérification(s) enregistrée(s)
          </button>
        ) : null}
      </div>
    </aside>
  );
}
