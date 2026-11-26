import { useState } from 'react';
import type { CheckDefinition } from '../../checks/types.ts';

export default function CheckEditor({ initial, onSave, onCancel }: {
  initial?: CheckDefinition; onSave: (check: CheckDefinition) => Promise<void>; onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [program, setProgram] = useState(initial?.program ?? '');
  const [args, setArgs] = useState(initial?.args.join('\n') ?? '');
  const [cwd, setCwd] = useState(initial?.cwd ?? '');
  const [timeout, setTimeoutValue] = useState(initial?.timeout ?? 600);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return <form className="check-editor preference-section" onSubmit={event => {
    event.preventDefault(); setBusy(true); setError('');
    void onSave({ id: initial?.id ?? `custom:${crypto.randomUUID()}`, name: name.trim(), program: program.trim(),
      args: args.split('\n').filter(value => value.length > 0), cwd: cwd.trim(), timeout,
      category: initial?.category ?? 'Personnalisé', origin: 'Configuration personnalisée' })
      .catch(reason => setError(String(reason))).finally(() => setBusy(false));
  }}>
    <h3>{initial ? 'Modifier le contrôle' : 'Ajouter un contrôle'}</h3>
    <label className="form-field"><span>Nom du contrôle</span><input required maxLength={160} value={name} onChange={event => setName(event.target.value)} /></label>
    <label className="form-field"><span>Programme</span><input required placeholder="python3" value={program} onChange={event => setProgram(event.target.value)} /></label>
    <label className="form-field"><span>Arguments — un par ligne</span><textarea rows={4} placeholder={'-m\npytest\n-q'} value={args} onChange={event => setArgs(event.target.value)} /></label>
    <label className="form-field"><span>Dossier relatif au projet</span><input placeholder="Racine du projet" value={cwd} onChange={event => setCwd(event.target.value)} /></label>
    <label className="form-field"><span>Délai maximal en secondes</span><input type="number" min={1} max={3600} value={timeout} onChange={event => setTimeoutValue(Number(event.target.value))} /></label>
    <p className="muted small-copy">Le programme est lancé directement, sans interpréter les opérateurs de terminal. Les scripts du projet peuvent produire des fichiers.</p>
    {error ? <p role="alert" className="inline-error">{error}</p> : null}
    <div className="dialog-actions"><button type="button" className="button secondary" onClick={onCancel}>Annuler</button><button className="button" disabled={busy}>Enregistrer le contrôle</button></div>
  </form>;
}
