import { formatCommand } from '../../checks/command.ts';
import { useCallback, useEffect, useRef, useState } from 'react';
import { desktop, request } from '../../api.ts';
import { useCheckRuns } from '../../checks/useCheckRuns.ts';
import type { CheckCatalogue, CheckConfiguration, CheckDefinition } from '../../checks/types.ts';
import ModalDialog from '../ModalDialog.tsx';
import CheckEditor from './CheckEditor.tsx';
import CheckResults from './CheckResults.tsx';

export default function ChecksDialog({ workspaceId, dirty = false, onClose }: {
  workspaceId: string; dirty?: boolean; onClose: () => void;
}) {
  const [catalogue, setCatalogue] = useState<CheckCatalogue | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const { runs, error: runError, refresh: refreshRuns } = useCheckRuns(workspaceId);
  const [query, setQuery] = useState('');
  const [profile, setProfile] = useState('');
  const [configuration, setConfiguration] = useState<CheckConfiguration>({});
  const configRef = useRef<CheckConfiguration>({});
  const committed = useRef<CheckConfiguration>({});
  const saving = useRef<Promise<unknown>>(Promise.resolve());
  const [editor, setEditor] = useState<CheckDefinition | 'new' | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const onError = useCallback((reason: unknown) => setError(String(reason).replace(/^Error: /, '')), []);
  const save = (next: CheckConfiguration) => {
    configRef.current = next; setConfiguration(next);
    const operation = saving.current.catch(() => {}).then(() => request('checks.configure', next as Record<string, unknown>))
      .then(value => { committed.current = next; return value; })
      .catch(reason => {
        if (configRef.current === next) {
          configRef.current = committed.current; setConfiguration(committed.current);
          setSelected(committed.current.selected ?? []);
        }
        throw reason;
      });
    saving.current = operation;
    return operation;
  };
  const loadCatalogue = useCallback(async () => {
    const value = await request<CheckCatalogue>('checks.catalog');
    setCatalogue(value);
    const config = value.configuration ?? {};
    configRef.current = config; committed.current = config; setConfiguration(config);
    setSelected((config.selected ?? []).filter(id => value.checks.some(check => check.definition.id === id)));
  }, []);
  useEffect(() => { void loadCatalogue().catch(onError); }, [loadCatalogue, onError]);
  const choose = (ids: string[]) => {
    if (ids.length > 32) { setError('Une sélection peut contenir au maximum 32 contrôles.'); return; }
    setSelected(ids); setError('');
    void save({ ...configRef.current, selected: ids }).catch(onError);
  };
  const active = runs.some(run => run.active);
  const profileNames = Object.keys(configuration.profiles ?? {});
  const filtered = catalogue?.checks.filter(item => `${item.definition.name} ${item.definition.cwd} ${item.definition.category}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())) ?? [];
  return <ModalDialog title="Tests et contrôles" closeLabel="Fermer les tests et contrôles" className="checks-dialog" onClose={onClose}>
    {!desktop ? <p className="muted small-copy">Aperçu : les exemples sont configurables, aucune commande n’est exécutée.</p> : null}
    {dirty ? <p className="inline-error">Des fichiers ne sont pas enregistrés. Les contrôles utilisent le contenu actuellement sur disque.</p> : null}
    {error || runError ? <p role="alert" className="inline-error">{error || runError}</p> : null}
    <section className="preference-section">
      <div className="checks-toolbar"><h3>Contrôles du projet</h3>
        <button className="text-button" disabled={busy} onClick={() => void saving.current.then(loadCatalogue).catch(onError)}>Actualiser</button>
        <button className="text-button" onClick={() => setEditor('new')}>Ajouter un contrôle</button>
      </div>
      <input className="checks-search" aria-label="Rechercher un contrôle" placeholder="Rechercher un contrôle ou un sous-projet…" value={query} onChange={event => setQuery(event.target.value)} />
      <div className="checks-toolbar">
        <button className="text-button" onClick={() => choose(filtered.filter(item => item.available).map(item => item.definition.id).slice(0, 32))}>Sélectionner les contrôles affichés</button>
        <button className="text-button" onClick={() => choose([])}>Tout désélectionner</button>
        <select aria-label="Charger un profil de contrôles" disabled={!profileNames.length} value="" onChange={event => {
          const ids = configuration.profiles?.[event.target.value] ?? [];
          const known = ids.filter(id => catalogue?.checks.some(item => item.definition.id === id));
          choose(known);
          if (known.length !== ids.length) setError('Certains contrôles de ce profil n’existent plus. Vérifiez la sélection.');
        }}><option value="">{profileNames.length ? 'Charger un profil…' : 'Aucun profil enregistré'}</option>{profileNames.map(name => <option key={name} value={name}>{name}</option>)}</select>
      </div>
      {!catalogue ? <p className="muted">Lecture des configurations du projet…</p> : null}
      <div className="checks-catalogue">
        {filtered.map(({ definition: check, available }) => <article key={check.id} className="check-option">
          <div><label><input type="checkbox" checked={selected.includes(check.id)} disabled={!available} onChange={event => choose(event.target.checked ? [...selected, check.id] : selected.filter(id => id !== check.id))} />
            <strong>{check.name}</strong></label><span className="muted small-copy">{check.cwd || 'Racine'} · {check.category} · {available ? 'Programme disponible' : `Programme introuvable : ${check.program}`}</span></div>
          <details><summary>Commande et origine</summary><code>{formatCommand(check.program, check.args)}</code>
            <p className="small-copy">Origine : {check.origin} · délai : {check.timeout} s. Les dépendances du contrôle sont vérifiées à l’exécution.</p>
            <button className="text-button" onClick={() => setEditor(check)}>Modifier ce contrôle</button>
            {(configuration.custom ?? []).some(value => value.id === check.id) ? <button className="text-button" onClick={() => {
              void save({ ...configRef.current, custom: configRef.current.custom?.filter(value => value.id !== check.id) }).then(loadCatalogue).catch(onError);
            }}>Retirer la personnalisation</button> : null}
          </details>
        </article>)}
        {catalogue && !filtered.length ? <p className="muted">Aucun contrôle trouvé. Ajoutez la commande de votre outil.</p> : null}
      </div>
      {catalogue ? <p className="muted small-copy">{catalogue.scope}</p> : null}
      <h3>Enregistrer un profil</h3>
      <p className="muted small-copy">Un profil mémorise les contrôles cochés pour les retrouver en un clic. Cochez les contrôles à conserver, puis donnez un nom à votre sélection.</p>
      <div className="checks-toolbar"><input aria-label="Nom du profil de contrôles" placeholder="Nom du profil : Rapide, Avant commit…" maxLength={60} value={profile} onChange={event => setProfile(event.target.value)} />
        <button className="text-button" disabled={!profile.trim() || !selected.length} onClick={() => {
          const profiles = { ...configRef.current.profiles, [profile.trim()]: selected };
          if (Object.keys(profiles).length > 20) { setError('Vous pouvez enregistrer au maximum 20 profils.'); return; }
          void save({ ...configRef.current, profiles }).then(() => setProfile('')).catch(onError);
        }}>Enregistrer le profil</button>
      </div>
    </section>
    {editor ? <CheckEditor initial={editor === 'new' ? undefined : editor} onCancel={() => setEditor(null)} onSave={async check => {
      const custom = [...(configRef.current.custom ?? []).filter(value => value.id !== check.id), check];
      await save({ ...configRef.current, custom }); await loadCatalogue(); setEditor(null);
    }} /> : null}
    <div className="checks-launch">
      <p className="muted small-copy">Exécuté localement par Galeata · une commande à la fois entre les fenêtres. Les workers internes dépendent de l’outil.</p>
      <button className="button" disabled={!desktop || busy || active || !selected.length} onClick={() => {
        setBusy(true); setError('');
        void saving.current.catch(() => {}).then(() => request('checks.start', { ids: selected }))
          .then(() => refreshRuns(true))
          .catch(onError).finally(() => setBusy(false));
      }}>{busy ? 'Préparation…' : active ? 'Sélection en cours' : `Lancer ${selected.length} ${selected.length === 1 ? 'contrôle' : 'contrôles'}`}</button>
      <p className="muted small-copy">Fermer cette fenêtre laisse les contrôles continuer. Les résultats restent disponibles ici.</p>
    </div>
    <CheckResults runs={runs} onError={onError} onRerun={choose} onCancel={async id => { await request('checks.cancel', { id }); }} />
  </ModalDialog>;
}
