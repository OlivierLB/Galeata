import { useEffect, useRef, useState } from 'react';
import { Button } from './ui/Controls.tsx';
import type { ProposedFileEdit } from '../editorEdits.ts';
export default function EditPreview({ title, files, onApply, onClose }: {
  title: string; files: ProposedFileEdit[]; onApply: (files: ProposedFileEdit[]) => Promise<void>; onClose: () => void;
}) {
  const [selected, setSelected] = useState(() => new Set(files.map(file => file.path)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  return <dialog ref={dialog} className="edit-preview" aria-label={title} onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}><section>
    <h2>{title}</h2><p>Relisez les changements et choisissez les fichiers à modifier. Les versions seront contrôlées avant application.</p>
    <div className="edit-preview-files">{files.map(file => <details key={file.path} open={files.length === 1}>
      <summary><label><input type="checkbox" checked={selected.has(file.path)} onChange={event => setSelected(previous => {
        const next = new Set(previous); if (event.target.checked) next.add(file.path); else next.delete(file.path); return next;
      })} />{file.path}</label></summary>
      <div className="edit-preview-columns"><div><h3>Avant</h3><pre>{file.before}</pre></div><div><h3>Après</h3><pre>{file.after}</pre></div></div>
    </details>)}</div>
    {error ? <p role="alert">{error}</p> : null}
    <div className="dialog-actions"><Button disabled={busy} onClick={onClose}>Annuler</Button><Button disabled={busy || !selected.size} onClick={() => {
      setBusy(true); setError(''); void onApply(files.filter(file => selected.has(file.path))).then(onClose).catch(error => setError(String(error))).finally(() => setBusy(false));
    }}>{busy ? 'Application…' : 'Appliquer les changements'}</Button></div>
  </section></dialog>;
}
