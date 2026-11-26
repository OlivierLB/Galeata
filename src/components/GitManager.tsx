import { Text, Button, Select, TextInput } from './ui/Controls.tsx';
import { useCallback, useEffect, useRef, useState } from 'react';
import { request } from '../api.ts';
import type { GitBranch, GitOverview, GitStatus } from '../types.ts';
import { Icon } from './Icon.tsx';

export type GitTab = 'branches' | 'stashes';
type Operation = {
  action: string;
  args: Record<string, unknown>;
  title: string;
  description: string;
  submit: string;
};

export function GitToolbar({
  git,
  busy,
  onManage,
  onMutate,
}: {
  git: GitStatus;
  busy: boolean;
  onManage: (tab: GitTab) => void;
  onMutate: (action: string) => void;
}) {
  if (!git.isRepo) return null;
  return (
    <div className="git-toolbar" aria-label="Actions Git">
      <div className="git-toolbar-group">
        <Button className="button secondary small" onClick={() => onManage('branches')}>
          <Icon name="branch" size={14} /> Branches
        </Button>
        <Button className="button secondary small" onClick={() => onManage('stashes')}>
          <Icon name="history" size={14} /> Stash
        </Button>
      </div>
      <div className="git-toolbar-group">
        <Button
          className="text-button"
          disabled={busy}
          title="Fetch : récupérer les références de tous les dépôts distants sans modifier vos fichiers"
          onClick={() => onMutate('fetch')}
        >
          Récupérer
        </Button>
        <Button
          className="text-button"
          disabled={busy || !git.upstream || git.merging}
          title="Pull : mettre à jour la branche active, uniquement en avance rapide"
          onClick={() => onMutate('pull')}
        >
          Mettre à jour
        </Button>
        <Button
          className="text-button"
          disabled={busy || git.merging || git.detached}
          title="Push : publier les commits de la branche active"
          onClick={() => (git.upstream ? onMutate('push') : onManage('branches'))}
        >
          Publier
        </Button>
      </div>
    </div>
  );
}

export default function GitManager({
  git,
  workspaceId,
  initialTab,
  dirty,
  busy,
  onClose,
  onMutate,
}: {
  git: GitStatus;
  workspaceId: string;
  initialTab: GitTab;
  dirty: boolean;
  busy: boolean;
  onClose: () => void;
  onMutate: (action: string, args?: Record<string, unknown>) => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [tab, setTab] = useState(initialTab);
  const [data, setData] = useState<GitOverview>({ branches: [], stashes: [], remotes: [] });
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');
  const [filter, setFilter] = useState('');
  const [name, setName] = useState('');
  const [message, setMessage] = useState('');
  const [remote, setRemote] = useState('');
  const [pending, setPending] = useState<Operation | null>(null);
  const generation = useRef(0);
  const running = useRef(false);
  const [working, setWorking] = useState(false);
  const blocked = busy || working;
  // Status requests return fresh objects even when nothing in Git has changed.
  const gitRevision = JSON.stringify(git);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  const load = useCallback(async () => {
    const expected = ++generation.current;
    setLoading(true);
    try {
      const result = await request<GitOverview>('git.overview');
      if (expected !== generation.current) return;
      setData(result);
      setLoaded(true);
      setRemote((current) =>
        result.remotes.includes(current)
          ? current
          : result.remotes.includes('origin')
            ? 'origin'
            : result.remotes[0] ?? '',
      );
    } catch (value) {
      if (expected === generation.current) setError(String(value));
    } finally {
      if (expected === generation.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
    return () => {
      generation.current++;
    };
  }, [load, workspaceId, gitRevision]);

  async function perform(
    action: string,
    args: Record<string, unknown> = {},
    success = 'Opération terminée.',
  ) {
    if (running.current || busy) return;
    running.current = true;
    setWorking(true);
    setError('');
    setFeedback('');
    try {
      await onMutate(action, args);
      setPending(null);
      setName('');
      setMessage('');
      setFeedback(success);
    } catch (value) {
      setError(String(value).replace(/^Error: /, ''));
    } finally {
      await load();
      running.current = false;
      setWorking(false);
    }
  }
  function switchBranch(branch: GitBranch) {
    setPending({
      action: 'switch',
      args: { name: branch.name, remote: branch.remote },
      title: `Passer sur ${branch.name}`,
      description: branch.remote
        ? `Activer la branche locale suivant ${branch.name}, ou la créer si elle n’existe pas. Git refusera si un changement local risque d’être écrasé.`
        : `Remplacer la branche active ${git.branch} par ${branch.name}. Git refusera si un changement local risque d’être écrasé.`,
      submit: 'Changer de branche',
    });
  }
  function mergeBranch(branch: GitBranch) {
    setPending({
      action: 'merge',
      args: { name: branch.name, remote: branch.remote },
      title: 'Fusionner les branches',
      description: `Source : ${branch.name}\nDestination : ${git.branch} (branche active)\n\nLes commits de ${branch.name} seront intégrés dans ${git.branch}. En cas de conflit, la fusion restera en attente de résolution.`,
      submit: `Fusionner dans ${git.branch}`,
    });
  }
  const conflicts = git.files.filter((file) => file.conflicted).length;
  const branches = data.branches.filter((branch) =>
    branch.name.toLowerCase().includes(filter.toLowerCase()),
  );
  const canChange = !blocked && !loading && !dirty && !git.merging && !conflicts;
  return (
    <dialog
      ref={dialog}
      className="dialog git-manager"
      aria-labelledby="git-manager-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!blocked) onClose();
      }}
    >
      <div className="dialog-heading">
        <div>
          <span className="eyebrow">GÉRER LE DÉPÔT</span>
          <h2 id="git-manager-title">Branches et stash</h2>
        </div>
        <Button
          variant="icon"
          disabled={blocked}
          aria-label="Fermer la gestion Git"
          onClick={onClose}
        >
          <Icon name="close" />
        </Button>
      </div>
      <div className="git-current-branch">
        <Icon name="branch" size={18} />
        <div>
          <strong>{git.branch}</strong>
          <small>
            {git.detached
              ? 'HEAD détachée · choisissez une branche'
              : git.upstream || 'Branche locale · pas de suivi distant'}
          </small>
        </div>
        <span>
          {git.ahead ?? 0} à publier · {git.behind ?? 0} à récupérer
        </span>
      </div>
      {dirty ? (
        <p className="git-notice">
          Des onglets contiennent du texte non enregistré. Enregistrez-les ou fermez-les avant de
          changer les fichiers du dépôt.
        </p>
      ) : null}
      {git.merging || conflicts ? (
        <div className="git-notice">
          <strong>{conflicts ? `${conflicts} fichier(s) en conflit` : 'Fusion en cours'}</strong>
          <p>
            Résolvez les conflits dans les fichiers, puis indexez les corrections depuis la page
            Git.{!git.merging ? ' Le stash est conservé si sa restauration a échoué.' : ''}
          </p>
          {git.merging ? (
            <div className="git-toolbar-group">
              <Button
                className="button secondary small"
                disabled={blocked || dirty || !!conflicts}
                onClick={() => void perform('mergeContinue', {}, 'Fusion terminée.')}
              >
                Terminer la fusion
              </Button>
              <Button
                className="text-button"
                disabled={blocked || dirty}
                onClick={() =>
                  setPending({
                    action: 'mergeAbort',
                    args: {},
                    title: 'Annuler la fusion',
                    description:
                      'Revenir à l’état précédent la fusion. Les corrections faites pour résoudre cette fusion seront abandonnées.',
                    submit: 'Annuler la fusion',
                  })
                }
              >
                Annuler la fusion
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
      <div className="git-manager-tabs" role="tablist" aria-label="Gestion du dépôt">
        {(['branches', 'stashes'] as const).map((value) => (
          <Button
            key={value}
            role="tab"
            aria-selected={tab === value}
            disabled={blocked}
            onClick={() => {
              setTab(value);
              setPending(null);
              setError('');
            }}
          >
            {value === 'branches'
              ? `Branches (${data.branches.length})`
              : `Stash (${data.stashes.length})`}
          </Button>
        ))}
        <Button
          variant="icon"
          aria-label="Actualiser les branches et stash"
          disabled={blocked || loading}
          onClick={() => void load()}
        >
          <Icon name="refresh" size={15} />
        </Button>
      </div>
      {error ? (
        <p role="alert" className="inline-error git-operation-error">
          {error}
        </p>
      ) : null}
      {feedback ? (
        <p role="status" className="git-feedback">
          <Icon name="check" size={15} />
          {feedback}
        </p>
      ) : null}
      {pending ? (
        <section className="git-operation-confirm">
          <h3>{pending.title}</h3>
          <p>{pending.description}</p>
          <div className="dialog-actions">
            <Button
              variant="secondary"
              disabled={blocked}
              onClick={() => {
                setPending(null);
                setError('');
              }}
            >
              Retour
            </Button>
            <Button
              variant="primary"
              disabled={blocked || dirty}
              onClick={() => void perform(pending.action, pending.args)}
            >
              {blocked ? 'En cours…' : pending.submit}
            </Button>
          </div>
        </section>
      ) : tab === 'branches' ? (
        <>
          <form
            className="git-inline-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (!canChange || !name.trim()) return;
              void perform('branch', { name: name.trim() }, 'Branche créée et activée.');
            }}
          >
            <label htmlFor="new-git-branch">Nouvelle branche depuis {git.branch}</label>
            <div>
              <TextInput
                id="new-git-branch"
                required
                value={name}
                placeholder="feature/ma-mission"
                disabled={!canChange}
                onChange={(event) => setName(event.target.value)}
              />
              <Button type="submit" className="button small" disabled={!canChange || !name.trim()}>
                Créer et activer
              </Button>
            </div>
          </form>
          <div className="git-sync-actions">
            <Button
              className="button secondary small"
              disabled={blocked}
              onClick={() =>
                void perform(
                  'fetch',
                  {},
                  'Références distantes actualisées. Vos fichiers n’ont pas été modifiés.',
                )
              }
            >
              Récupérer (fetch)
            </Button>
            <Button
              className="button secondary small"
              disabled={!canChange || !git.upstream}
              onClick={() => void perform('pull', {}, 'Branche mise à jour en avance rapide.')}
            >
              Mettre à jour (pull)
            </Button>
            {!git.upstream && data.remotes.length ? (
              <label>
                Dépôt distant
                <Select
                  aria-label="Dépôt distant pour publier"
                  value={remote}
                  onChange={(event) => setRemote(event.target.value)}
                  disabled={blocked}
                >
                  {data.remotes.map((value) => (
                    <option key={value}>{value}</option>
                  ))}
                </Select>
              </label>
            ) : null}
            <Button
              className="button secondary small"
              disabled={blocked || !data.remotes.length || git.detached || git.merging}
              onClick={() =>
                void perform('push', git.upstream ? {} : { remote }, 'Commits publiés.')
              }
            >
              Publier (push)
            </Button>
          </div>
          <p className="small-copy muted">
            Pour fusionner vers une autre destination, activez-la d’abord, puis choisissez la
            branche source ci-dessous.
          </p>
          <div className="search-input">
            <Icon name="search" size={15} />
            <TextInput
              aria-label="Filtrer les branches"
              value={filter}
              placeholder="Filtrer les branches…"
              onChange={(event) => setFilter(event.target.value)}
            />
          </div>
          <div className="git-branch-list" aria-busy={loading}>
            {loading && !loaded ? (
              <p className="muted">Chargement des branches…</p>
            ) : (
              (['local', 'remote'] as const).map((kind) => (
                <section key={kind}>
                  <h3>{kind === 'local' ? 'Branches locales' : 'Branches distantes'}</h3>
                  {branches
                    .filter((branch) => branch.remote === (kind === 'remote'))
                    .map((branch) => (
                      <div
                        className={`git-branch-row ${branch.current ? 'current' : ''}`}
                        key={`${kind}:${branch.name}`}
                      >
                        <Icon name="branch" size={14} />
                        <div>
                          <strong>{branch.name}</strong>
                          <small>
                            {branch.current
                              ? 'Active'
                              : branch.inWorktree
                                ? 'Utilisée dans un autre worktree'
                                : branch.upstream ||
                                  (branch.remote ? 'Branche distante' : 'Locale')}
                          </small>
                        </div>
                        {!branch.current ? (
                          <div className="git-toolbar-group">
                            <Button
                              className="text-button"
                              disabled={!canChange || branch.inWorktree}
                              aria-label={`Activer ${branch.name}`}
                              onClick={() => switchBranch(branch)}
                            >
                              Activer
                            </Button>
                            <Button
                              className="text-button"
                              disabled={!canChange || git.detached}
                              aria-label={`Fusionner ${branch.name} dans ${git.branch}`}
                              onClick={() => mergeBranch(branch)}
                            >
                              Fusionner
                            </Button>
                          </div>
                        ) : (
                          <Icon name="check" size={16} />
                        )}
                      </div>
                    ))}
                  {!branches.some((branch) => branch.remote === (kind === 'remote')) ? (
                    <Text tone="muted" className="small-copy">
                      Aucune branche {kind === 'local' ? 'locale' : 'distante'}
                      {filter ? ' correspondante' : ''}.
                    </Text>
                  ) : null}
                </section>
              ))
            )}
          </div>
        </>
      ) : (
        <>
          <form
            className="git-inline-form"
            onSubmit={(event) => {
              event.preventDefault();
              void perform('stash', { message }, 'Modifications mises de côté.');
            }}
          >
            <label htmlFor="new-git-stash">Mettre les modifications de côté</label>
            <Text tone="muted" className="small-copy">
              Inclut les fichiers suivis et non suivis, sauf ceux ignorés par Git. Vous pourrez les
              restaurer sur la branche souhaitée.
            </Text>
            <div>
              <TextInput
                id="new-git-stash"
                value={message}
                placeholder="Description facultative du stash"
                disabled={!canChange}
                onChange={(event) => setMessage(event.target.value)}
              />
              <Button className="button small" disabled={!canChange || !git.files.length}>
                Créer le stash
              </Button>
            </div>
          </form>
          <div className="git-stash-list" aria-busy={loading}>
            {loading && !loaded ? (
              <p className="muted">Chargement des stash…</p>
            ) : (
              data.stashes.map((stash) => (
                <article className="git-stash-row" key={stash.oid}>
                  <code>{stash.id}</code>
                  <p>{stash.message}</p>
                  <div className="git-toolbar-group">
                    <Button
                      className="button secondary small"
                      disabled={!canChange}
                      onClick={() =>
                        setPending({
                          action: 'stashApply',
                          args: { oid: stash.oid },
                          title: 'Appliquer le stash',
                          description: `${stash.message}\n\nRestaurer les fichiers sur ${git.branch} et conserver le stash dans la liste.`,
                          submit: 'Appliquer et conserver',
                        })
                      }
                    >
                      Appliquer et conserver
                    </Button>
                    <Button
                      className="button secondary small"
                      disabled={!canChange}
                      onClick={() =>
                        setPending({
                          action: 'stashPop',
                          args: { oid: stash.oid },
                          title: 'Restaurer le stash',
                          description: `${stash.message}\n\nRestaurer les fichiers sur ${git.branch} et retirer ce stash si l’opération réussit. En cas de conflit, Git le conserve.`,
                          submit: 'Restaurer et retirer',
                        })
                      }
                    >
                      Restaurer et retirer (pop)
                    </Button>
                  </div>
                </article>
              ))
            )}
            {loaded && !data.stashes.length ? (
              <div className="git-clean">
                <Icon name="history" size={28} />
                <h3>Aucun stash en attente.</h3>
                <p>Mettez vos modifications de côté pour changer de branche sans les perdre.</p>
              </div>
            ) : null}
          </div>
        </>
      )}
      <div className="dialog-actions">
        <Button variant="secondary" disabled={blocked} onClick={onClose}>
          Fermer
        </Button>
      </div>
    </dialog>
  );
}
