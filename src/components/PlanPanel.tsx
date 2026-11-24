import { useState } from 'react';
import { nextStatus, progress, statusLabels } from '../domain.ts';
import type { Activity, Plan, Step } from '../types.ts';
import { Icon } from './Icon.tsx';

export default function PlanPanel({
  plan,
  activities,
  onSave,
  onStep,
  onCollapse,
  onHistory,
  onEdit,
}: {
  plan: Plan;
  activities: Activity[];
  onSave: (plan: Plan) => Promise<void>;
  onStep: (step: Step, status: Step['status']) => void;
  onCollapse: () => void;
  onHistory: () => void;
  onEdit: () => void;
}) {
  const [newStep, setNewStep] = useState('');
  const [adding, setAdding] = useState(false);
  const done = plan.steps.filter((step) => step.status === 'done').length;
  const verifications = activities.filter((event) => event.kind === 'verification');
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
    <aside className="plan-panel" aria-label="Plan du projet">
      <div className="panel-heading">
        <span className="heading-with-icon">
          <Icon name="plan" size={16} /> Plan de mission
        </span>
        <button
          className="icon-button"
          title="Replier le plan"
          aria-label="Replier le plan"
          onClick={onCollapse}
        >
          <Icon name="panel" size={16} />
        </button>
      </div>
      <div className="plan-scroll">
        <div className="plan-intro">
          <div className="eyebrow">
            LE CAP DU PROJET <span className="revision">v{plan.revision}</span>
          </div>
          <h2>{plan.objective || 'Chaque projet commence par une intention.'}</h2>
          <button className="text-button" onClick={onEdit}>
            <Icon name="edit" size={13} />
            {plan.objective ? 'Modifier l’objectif' : 'Définir un objectif'}
          </button>
        </div>
        <div className="progress-summary">
          <span>Progression</span>
          <span>
            {done}
            <span className="muted"> / {plan.steps.length} étapes</span>
          </span>
        </div>
        <div className="progress-track">
          <div style={{ width: `${progress(plan)}%` }} />
        </div>
        <div className="plan-steps">
          {plan.steps.map((step, index) => (
            <article key={step.id} className={`plan-step ${step.status}`}>
              <button
                className={`step-marker ${step.status}`}
                title={`${statusLabels[step.status]} · Cliquer pour avancer`}
                aria-label={`${step.title} : ${statusLabels[step.status]}`}
                onClick={() => onStep(step, nextStatus(step.status))}
              >
                {step.status === 'done' ? (
                  <Icon name="check" size={13} />
                ) : step.status === 'in_progress' ? (
                  <span className="active-step-dot" />
                ) : step.status === 'blocked' ? (
                  '!'
                ) : (
                  String(index + 1).padStart(2, '0')
                )}
              </button>
              <div className="step-content">
                <span className={`step-status ${step.status}`}>{statusLabels[step.status]}</span>
                <h3>{step.title}</h3>
                {step.note ? <p>{step.note}</p> : null}
                {step.status === 'in_progress' ? (
                  <button className="text-button subtle" onClick={() => onStep(step, 'blocked')}>
                    Signaler un blocage
                  </button>
                ) : null}
                <span className="step-author">{step.author === 'vous' ? 'Vous' : step.author}</span>
              </div>
            </article>
          ))}
        </div>
        {!plan.steps.length ? (
          <div className="empty-plan">
            <Icon name="spark" size={24} />
            <p>Découpez votre objectif en étapes. Vos agents pourront en suivre l’avancement.</p>
          </div>
        ) : null}
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
              placeholder="La prochaine étape…"
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
            <Icon name="plus" size={15} /> Ajouter une étape
          </button>
        )}
        <section className="verification-card">
          <div>
            <Icon name="check" size={15} />
            <h3>Vérifications</h3>
            <span className="count">{verifications.length}</span>
          </div>
          <p>
            {verifications.length
              ? `${verifications.filter((event) => event.data.provenance === 'galeata_observed').length} exécution(s) observée(s) par Galeata. Les rapports d’agents restent identifiés séparément.`
              : 'Aucune vérification enregistrée. Une étape terminée ne signifie pas que ses tests ont réussi.'}
          </p>
          {verifications.length ? (
            <button className="text-button" onClick={onHistory}>
              Voir les résultats <Icon name="arrow" size={13} />
            </button>
          ) : null}
        </section>
      </div>
      <div className="plan-footer">
        <span className="status-dot" /> Plan enregistré localement{' '}
        <button
          className="icon-button"
          onClick={onHistory}
          title="Historique du plan"
          aria-label="Historique du plan"
        >
          <Icon name="history" size={15} />
        </button>
      </div>
    </aside>
  );
}
