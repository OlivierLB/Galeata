import { useEffect, useState } from 'react';
import { Button, Checkbox, TextArea, TextInput } from '../ui/Controls.tsx';
import { ChoiceGroup } from '../ChoicePicker.tsx';
import { defaultEditorPreferences, type EditorPreferences as Settings } from '../../editorPreferences.ts';
import { desktop, request } from '../../api.ts';
import type { LanguageConfiguration } from '../../languageTypes.ts';

function CommittedInput({ label, value, onCommit, numeric = false }: {
  label: string; value: string; onCommit: (value: string) => void; numeric?: boolean;
}) {
  const [draft, setDraft] = useState(value), [error, setError] = useState('');
  useEffect(() => { setDraft(value); setError(''); }, [value]);
  return <label className="editor-preference-field"><span>{label}</span>
    <TextInput aria-label={label} value={draft} inputMode={numeric ? 'numeric' : undefined} aria-invalid={!!error}
      onChange={event => { setDraft(event.target.value); setError(''); }}
      onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); } }}
      onBlur={() => { try { onCommit(draft.trim()); setError(''); } catch (error) { setError(String(error).replace(/^Error: /, '')); } }} />
    {error ? <small role="alert">{error}</small> : null}
  </label>;
}
export default function EditorPreferences({ project, value, autoSave, language, languageInfo, error, onChange, onAutoSave }: {
  project: string; value: Settings; autoSave: boolean; language?: string; languageInfo?: string; error: string;
  onChange: (patch: Partial<Settings>) => boolean; onAutoSave: (enabled: boolean) => boolean;
}) {
  const [configuration, setConfiguration] = useState<string | null>(null);
  const [toolStatus, setToolStatus] = useState('');
  const [toolError, setToolError] = useState('');
  const [busy, setBusy] = useState(false);
  const shortcutNames: Record<keyof Settings['shortcuts'], string> = { definition: 'Définition', rename: 'Renommage', format: 'Formatage', completion: 'Complétion' };
  return <div className="editor-preferences">
    <p className="muted small-copy">Projet : <strong>{project}</strong>. Ces réglages s’appliquent uniquement à ce projet.</p>
    {error ? <p role="alert" className="inline-error">{error}</p> : null}
    <section className="preference-section" aria-labelledby="editor-save-title">
      <h3 id="editor-save-title">Enregistrement</h3>
      <label className="preference-toggle"><Checkbox aria-label="Enregistrer automatiquement" checked={autoSave} onChange={event => onAutoSave(event.target.checked)} /><span>Enregistrer automatiquement<small>Après une seconde sans saisie. Ctrl+S reste disponible à tout moment.</small></span></label>
      <label className="preference-toggle"><Checkbox checked={value.formatOnSave} onChange={event => onChange({ formatOnSave: event.target.checked })} /><span>Formater à la sauvegarde<small>Utilise le formateur du projet lorsqu’il est disponible.</small></span></label>
      <p className="muted small-copy">Les brouillons sont récupérables après une fermeture inattendue. Un conflit sur disque suspend l’enregistrement automatique.</p>
      {!desktop ? <p className="muted small-copy">Dans cet aperçu, seuls les brouillons locaux sont conservés. Aucun fichier du poste n’est modifié.</p> : null}
    </section>
    <section className="preference-section" aria-labelledby="editor-text-title">
      <h3 id="editor-text-title">Lecture et saisie</h3>
      <div className="editor-preference-grid">
        <CommittedInput label="Police du code" value={value.fontFamily} onCommit={fontFamily => { if (!fontFamily || fontFamily.length > 255) throw new Error('Indiquez une police valide.'); onChange({ fontFamily }); }} />
        <CommittedInput label="Taille du texte" numeric value={String(value.fontSize)} onCommit={text => { const fontSize = Number(text); if (!Number.isInteger(fontSize) || fontSize < 10 || fontSize > 32) throw new Error('Choisissez une taille entre 10 et 32.'); onChange({ fontSize }); }} />
      </div>
      <div className="editor-preference-field"><span>Indentation par défaut</span><ChoiceGroup className="segmented" label="Indentation" value={String(value.tabSize)} options={[2, 4, 8].map(size => ({ id: String(size), label: `${size} espaces` }))} onChange={size => onChange({ tabSize: Number(size) })} /><small className="muted">Le fichier .editorconfig du projet reste prioritaire.</small></div>
      <label className="preference-toggle"><Checkbox checked={value.wordWrap === 'on'} onChange={event => onChange({ wordWrap: event.target.checked ? 'on' : 'off' })} /><span>Retour à la ligne visuel<small>Adapte l’affichage à la largeur sans modifier le code.</small></span></label>
    </section>
    <details className="preference-section editor-advanced"><summary>Raccourcis de l’éditeur</summary>
      <p className="muted small-copy">Exemples : F12, Ctrl+Space, Alt+Shift+F. Validez avec Entrée ou en quittant le champ.</p>
      <div className="editor-preference-grid">{(Object.keys(shortcutNames) as (keyof Settings['shortcuts'])[]).map(key => <CommittedInput key={key} label={`Raccourci ${shortcutNames[key].toLowerCase()}`} value={value.shortcuts[key]} onCommit={shortcut => {
        const parts = shortcut.split('+'); const keyName = parts.pop() ?? '';
        if (!parts.every(part => /^(Ctrl|Alt|Shift)$/i.test(part)) || !/^(F(?:[1-9]|1[0-9]|2[0-4])|[a-z]|Space|Enter|Tab|Escape|Delete|Backspace|Home|End|PageUp|PageDown|LeftArrow|RightArrow|UpArrow|DownArrow)$/i.test(keyName)) throw new Error('Raccourci invalide. Exemple : Ctrl+Alt+F.');
        if (/^ctrl\+(s|p)$/i.test(shortcut)) throw new Error('Ctrl+S et Ctrl+P sont réservés à l’enregistrement et à la recherche.');
        onChange({ shortcuts: { ...value.shortcuts, [key]: shortcut } });
      }} />)}</div>
    </details>
    <details className="preference-section editor-advanced"><summary>Outils de langage</summary>
      <p className="small-copy">{language ? `${language} · ${languageInfo ?? 'Chargement à la demande'}` : 'Ouvrez un fichier pour consulter son outil de langage.'}</p>
      <p className="muted small-copy">Configuration avancée des serveurs et formateurs externes. Elle n’est pas nécessaire pour modifier du texte.</p>
      <div className="editor-tool-actions"><Button variant="secondary" disabled={!desktop || busy} onClick={() => {
        setBusy(true); setToolError(''); void request<LanguageConfiguration | null>('language.configuration.get').then(config => setConfiguration(JSON.stringify(config ?? {}, null, 2))).catch(error => setToolError(String(error))).finally(() => setBusy(false));
      }}>Configurer les outils</Button><Button variant="secondary" disabled={!desktop || !language || busy} onClick={() => {
        setBusy(true); setToolError(''); void request('language.request', { language, method: 'stop' }).then(async () => { const client = await import('../../languageClient.ts'); client.restartLanguageServices(); setToolStatus('L’outil redémarrera à la prochaine demande.'); }).catch(error => setToolError(String(error))).finally(() => setBusy(false));
      }}>Relancer l’outil</Button></div>
      {configuration !== null ? <div className="editor-tool-config"><label className="editor-preference-field"><span>Configuration JSON des langages</span><TextArea aria-label="Configuration des langages" rows={8} value={configuration} onChange={event => { setConfiguration(event.target.value); setToolStatus(''); }} /></label><p className="muted small-copy">Cette configuration nécessite un enregistrement explicite pour être appliquée.</p><Button variant="primary" disabled={busy} onClick={() => {
        setBusy(true); setToolError(''); void Promise.resolve().then(() => request('language.configuration.save', { configuration: JSON.parse(configuration) })).then(async () => { const client = await import('../../languageClient.ts'); client.restartLanguageServices(); setToolStatus('Configuration enregistrée.'); }).catch(error => setToolError(String(error))).finally(() => setBusy(false));
      }}>Enregistrer la configuration</Button></div> : null}
      {toolError ? <p role="alert" className="inline-error">{toolError}</p> : null}{toolStatus ? <p role="status">{toolStatus}</p> : null}
    </details>
    <Button variant="secondary" onClick={() => { if (onChange(defaultEditorPreferences)) onAutoSave(true); }}>Rétablir les réglages de l’éditeur</Button>
  </div>;
}
