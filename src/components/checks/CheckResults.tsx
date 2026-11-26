import { Text, Button } from '../ui/Controls.tsx';
import { formatCommand } from '../../checks/command.ts';
import { useEffect, useState } from 'react';
import { request, subscribe } from '../../api.ts';
import { statusLabels, type CheckRun } from '../../checks/types.ts';

function Output({ runId, checkId }: { runId: string; checkId: string }) {
  const [text, setText] = useState('');
  useEffect(() => {
    let disposed = false; let pending = false; let dirty = false; let clean: (() => void) | undefined;
    const load = async () => { dirty = true; if (pending || disposed) return; pending = true;
      try { while (dirty && !disposed) {
        dirty = false;
        const value = await request<string>('checks.output', { id: runId, checkId });
        if (!disposed) setText(value);
      } }
      catch (error) { if (!disposed) setText(String(error)); } finally { pending = false; }
    };
    void load();
    void subscribe('checks:changed', () => { void load(); }).then(value => { if (disposed) value(); else { clean = value; void load(); } }).catch(error => { if (!disposed) setText(String(error)); });
    return () => { disposed = true; clean?.(); };
  }, [runId, checkId]);
  return <pre className="check-output">{text || 'Aucune sortie reçue.'}</pre>;
}
export default function CheckResults({ runs, onCancel, onRerun, onError }: {
  runs: CheckRun[]; onCancel: (id: string) => Promise<void>; onRerun: (ids: string[]) => void; onError: (error: unknown) => void;
}) {
  const [expanded, setExpanded] = useState('');
  const active = runs.some(run => run.active);
  return <section className="preference-section check-results" aria-label="Résultats des contrôles">
    <h3>Exécutions récentes</h3>
    {!runs.length ? <p className="muted">Aucun contrôle exécuté par Galeata pour ce projet.</p> : null}
    {runs.map(run => <article className="check-run" key={run.id}>
      <header><strong>{new Date(run.createdAt).toLocaleString('fr-FR')}</strong>
        {run.active ? <Button className="text-button" onClick={() => void onCancel(run.id).catch(onError)}>Annuler la sélection</Button> :
          <Button className="text-button" disabled={active || !run.jobs.some(job => !['passed', 'cancelled'].includes(job.status))}
            onClick={() => onRerun(run.jobs.filter(job => !['passed', 'cancelled'].includes(job.status)).map(job => job.check.id))}>Resélectionner les échecs</Button>}
      </header>
      {run.stale ? <Text tone="muted" className="small-copy">Projet modifié depuis le lancement, ou résultat d’une session précédente.</Text> : null}
      {run.jobs.map(job => {
        const key = `${run.id}:${job.check.id}`;
        const duration = job.startedAt && job.finishedAt ? Math.max(0, (job.finishedAt - job.startedAt) / 1000).toFixed(1) : null;
        return <div className="check-job" key={key} data-status={job.status}>
          <div><strong>{job.check.name}</strong><span>{statusLabels[job.status] ?? job.status}{duration ? ` · ${duration} s` : ''}</span></div>
          {job.message ? <Text tone="muted" className="small-copy">{job.message}</Text> : null}
          {job.exitCode !== null ? <small>Code de sortie : {job.exitCode}</small> : null}
          <details><summary>Commande exécutée</summary><code>{formatCommand(job.check.program, job.check.args)}</code><p>Dossier : {job.check.cwd || 'racine du projet'} · délai : {job.check.timeout} s</p></details>
          {(job.hasOutput || job.status === 'running') ? <Button className="text-button" onClick={() => setExpanded(expanded === key ? '' : key)}>{expanded === key ? 'Masquer la sortie' : 'Voir la sortie'}</Button> : null}
          {expanded === key ? <Output runId={run.id} checkId={job.check.id} /> : null}
        </div>;
      })}
    </article>)}
  </section>;
}
