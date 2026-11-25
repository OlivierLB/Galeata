import { useMemo } from 'react';
import type { GitStatus, SearchHit, Workspace } from '../types.ts';
import { Icon } from './Icon.tsx';

export function FilesHome({ workspace, git, onFind, onCreate, onOpen }: {
  workspace: Workspace;
  git: GitStatus;
  onFind: () => void;
  onCreate: () => void;
  onOpen: (path: string) => void;
}) {
  return (
    <div className="workspace-page files-home">
      <header className="page-intro">
        <span className="page-emblem"><Icon name="folder" size={28} /></span>
        <span className="eyebrow">EXPLORER · MODIFIER · CONSTRUIRE</span>
        <h1>Les fichiers de {workspace.name}</h1>
        <p>Ouvrez un fichier dans l’explorateur. Vos onglets et vos modifications restent ici lorsque vous changez de page.</p>
      </header>
      <div className="page-actions">
        <button className="button" onClick={onFind}><Icon name="search" size={16} /> Trouver un fichier <kbd>Ctrl P</kbd></button>
        <button className="button secondary" onClick={onCreate}><Icon name="plus" size={16} /> Créer un fichier</button>
      </div>
      <section className="page-card">
        <div className="page-section-heading"><h2>À portée de main</h2><span>{git.files.length ? 'Fichiers modifiés dans le projet' : 'Votre espace de travail'}</span></div>
        {git.files.length ? git.files.slice(0, 8).map((file) => (
          <button className="page-file-link" key={file.path} onClick={() => onOpen(file.path)}>
            <Icon name="files" size={16} /><span>{file.path}</span><Icon name="arrow" size={15} />
          </button>
        )) : <div className="page-hint"><Icon name="files" size={22} /><p>Aucun fichier ouvert pour le moment. L’explorateur à gauche présente le contenu du projet.</p></div>}
      </section>
      <p className="page-footnote"><Icon name="save" size={14} /> Ctrl S pour enregistrer · Ctrl P pour ouvrir un autre fichier</p>
    </div>
  );
}

export function SearchPage({ query, filesOnly, hits, searching, hasMore, onQuery, onFilesOnly, onOpen, onMore }: {
  query: string;
  filesOnly: boolean;
  hits: SearchHit[];
  searching: boolean;
  hasMore: boolean;
  onQuery: (query: string) => void;
  onFilesOnly: (value: boolean) => void;
  onOpen: (hit: SearchHit) => void;
  onMore: () => void;
}) {
  const groups = useMemo(() => {
    const result = new Map<string, SearchHit[]>();
    for (const hit of hits) {
      const group = result.get(hit.path);
      if (group) group.push(hit);
      else result.set(hit.path, [hit]);
    }
    return [...result.entries()];
  }, [hits]);
  const trimmed = query.trim();
  return (
    <div className="workspace-page search-page">
      <header className="page-intro compact">
        <span className="eyebrow">DANS TOUT LE PROJET</span>
        <h1>Retrouvez le bon endroit.</h1>
        <p>Cherchez dans le code ou dans les noms de fichiers. Ouvrez un résultat pour le lire et le modifier à côté de la recherche.</p>
      </header>
      <div className="page-search-box"><Icon name="search" size={21} />
        <input aria-label="Rechercher dans le projet" placeholder="Un texte, une fonction, un fichier…" value={query} onChange={(event) => onQuery(event.target.value)} />
        {query ? <button className="icon-button" aria-label="Effacer la recherche" onClick={() => onQuery('')}><Icon name="close" size={16} /></button> : <kbd>ripgrep</kbd>}
      </div>
      <label className="checkbox-label"><input type="checkbox" checked={filesOnly} onChange={(event) => onFilesOnly(event.target.checked)} /> Noms de fichiers uniquement</label>
      <div role="status" className="page-section-heading search-summary">
        <h2>{searching ? 'Recherche en cours…' : trimmed ? `${hits.length}${hasMore ? '+' : ''} résultat(s)` : 'Que cherchez-vous ?'}</h2>
        {trimmed ? <span>{groups.length} fichier(s) · {filesOnly ? 'Noms de fichiers' : 'Contenu des fichiers'}</span> : null}
      </div>
      {!trimmed ? <div className="search-welcome page-card">
        <Icon name="search" size={36} /><h2>Du détail à l’ensemble.</h2>
        <p>Retrouvez une définition, un message ou un composant sans ouvrir chaque fichier.</p>
        <div className="search-suggestions"><span>Essayez un nom de fichier</span><button onClick={() => { onFilesOnly(true); onQuery('README'); }}>README</button><button onClick={() => { onFilesOnly(true); onQuery('src'); }}>src</button></div>
      </div> : !searching && !hits.length ? <div className="page-card page-hint"><Icon name="search" size={26} /><div><h2>Aucune correspondance</h2><p>Essayez un terme plus court ou changez le mode de recherche.</p></div></div> : null}
      <div className="page-search-results" aria-busy={searching}>
        {groups.map(([path, matches]) => <section className="search-result-group page-card" key={path}>
          <button className="search-result-path" aria-label={path} onClick={() => onOpen(matches[0])}><Icon name="files" size={16} /><strong>{path}</strong><span>{matches.length}</span><Icon name="arrow" size={14} /></button>
          {!filesOnly ? matches.map((hit, index) => <button className="search-result-line" key={`${hit.line}:${index}`} onClick={() => onOpen(hit)} aria-label={`${path}, ligne ${hit.line}`}><span>{hit.line}</span><code>{hit.text.trim()}</code></button>) : null}
        </section>)}
      </div>
      {hasMore ? <button className="button secondary load-results" disabled={searching} onClick={onMore}>Charger la suite</button> : null}
    </div>
  );
}

export function GitOverview({ git, onDiff, onRefresh, onTerminal }: {
  git: GitStatus;
  onDiff: (path: string, staged?: boolean) => void;
  onRefresh: () => void;
  onTerminal: () => void;
}) {
  const staged = git.files.filter((file) => file.index !== ' ' && file.index !== '?');
  const unstaged = git.files.filter((file) => file.worktree !== ' ' && file.worktree !== '?');
  const untracked = git.files.filter((file) => file.index === '?' || file.worktree === '?');
  return (
    <div className="workspace-page git-overview">
      <header className="page-intro compact">
        <span className="eyebrow">CONTRÔLE DE SOURCE · VUE D’ENSEMBLE</span>
        <h1>Vos changements, en perspective.</h1>
        <p>{git.isRepo ? 'Relisez les fichiers, comparez les versions et préparez votre prochain commit.' : 'Ce dossier n’est pas encore un dépôt Git. Initialisez-le dans le terminal pour suivre vos changements.'}</p>
      </header>
      {git.isRepo ? <>
        <div className="git-summary-grid">
          {[{ count: git.files.length, label: 'Fichiers changés', icon: 'git' }, { count: staged.length, label: 'Indexés pour le commit', icon: 'check' }, { count: unstaged.length, label: 'Modifiés hors index', icon: 'edit' }, { count: untracked.length, label: 'Non suivis', icon: 'plus' }].map((item) => <div className="git-summary-card" key={item.label}><Icon name={item.icon} size={17} /><strong>{item.count}</strong><span>{item.label}</span></div>)}
        </div>
        <section className="page-card git-change-list">
          <div className="page-section-heading"><h2>Fichiers à relire</h2><button className="text-button" onClick={onRefresh}><Icon name="refresh" size={14} /> Actualiser</button></div>
          {git.files.length ? <>
            <div className="git-change-columns"><span>Fichier</span><span>Comparaison</span></div>
            {git.files.map((file) => {
              const indexed = file.index !== ' ' && file.index !== '?';
              const working = file.worktree !== ' ';
              const status = file.index === '?' ? 'Nouveau' : (file.worktree === 'D' || file.index === 'D') ? 'Supprimé' : (file.index === 'A' ? 'Ajouté' : 'Modifié');
              return <div className="git-change-row" key={file.path}>
                <button className="git-change-path" onClick={() => onDiff(file.path, !working && indexed)}><Icon name="files" size={16} /><span>{file.path}</span><small>{status}</small></button>
                <div className="git-compare-actions">{indexed ? <button onClick={() => onDiff(file.path, true)}>Index</button> : null}{working ? <button onClick={() => onDiff(file.path, false)}>Travail</button> : null}</div>
              </div>;
            })}
          </> : <div className="git-clean"><Icon name="check" size={34} /><h2>Tout est à jour.</h2><p>Aucun changement local à relire. Vos prochaines modifications apparaîtront ici.</p></div>}
        </section>
        <div className="page-hint git-review-hint"><Icon name="panel" size={22} /><p>Choisissez un fichier pour ouvrir le comparateur. Les actions d’indexation et le commit sont disponibles dans le panneau de gauche.</p></div>
      </> : <div className="page-card git-clean"><Icon name="git" size={36} /><h2>Commencez l’historique du projet.</h2><p>Ouvrez le terminal et lancez <code>git init</code>, puis actualisez cette page.</p><div className="page-actions"><button className="button" onClick={onTerminal}><Icon name="terminal" size={16} /> Afficher le terminal</button><button className="button secondary" onClick={onRefresh}>Actualiser</button></div></div>}
    </div>
  );
}
