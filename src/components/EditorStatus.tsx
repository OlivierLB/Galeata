import type { OpenFile } from '../types.ts';
import { Button } from './ui/Controls.tsx';
import { ChoicePicker } from './ChoicePicker.tsx';
import { languageExtensions } from '../domain.ts';
export default function EditorStatus({ file, editable, native, autoSave, phase, localDraftSaved, draftError, onPreferences, onRetry, onLanguage }: {
  file: OpenFile; editable: boolean; native: boolean; autoSave: boolean; phase?: 'saving' | 'error';
  localDraftSaved: boolean; draftError: string; onPreferences: () => void; onRetry: () => void; onLanguage: (language: string) => void;
}) {
  const dirty = file.content !== file.savedContent;
  const label = !editable ? 'Lecture seule' : file.external ? 'Conflit sur disque' : phase === 'error' ? 'Échec de l’enregistrement'
    : phase === 'saving' ? 'Enregistrement…' : !native ? dirty ? draftError ? 'Brouillon local non conservé' : localDraftSaved ? 'Brouillon local conservé' : 'Conservation du brouillon…' : 'Fichier d’exemple'
    : dirty ? 'Modifications non enregistrées' : 'Enregistré';
  return <footer className="editor-file-status" aria-label="État du fichier">
    <div className="editor-save-state"><span role="status" aria-live="polite" title={file.path} className={phase === 'error' || file.external ? 'editor-save-error' : ''}>{label}</span>
      {editable && native && phase === 'error' ? <Button className="text-button" onClick={onRetry}>Réessayer</Button> : null}
      {draftError ? <span role="alert" className="editor-save-error">{draftError}</span> : null}
    </div>
    <div className="editor-file-options">
      <Button className="text-button" title="Préférences d’enregistrement du projet" onClick={onPreferences}>{!native ? 'Aperçu' : autoSave ? 'Enregistrement auto' : 'Enregistrement manuel'}</Button>
      <ChoicePicker className="editor-language-picker" label="Langage du fichier" disabled={!editable} value={file.language} options={Object.keys(languageExtensions).sort().map(language => ({ id: language, label: language }))} onChange={onLanguage} />
    </div>
  </footer>;
}
