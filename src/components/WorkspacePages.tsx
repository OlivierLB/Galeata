import { useMemo, useState } from 'react';
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

export function FileSearch({ query, hits, searching, hasMore, onQuery, onOpen, onMore }: {
  query: string;
  hits: SearchHit[];
  searching: boolean;
  hasMore: boolean;
  onQuery: (query: string) => void;
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
    <section className="file-content-search" aria-label="Recherche dans les fichiers">
      <div className="page-search-box"><Icon name="search" size={16} />
        <input autoFocus id="project-content-search" aria-label="Rechercher dans le contenu" placeholder="Texte dans le projet…" value={query} onChange={event => onQuery(event.target.value)} />
        {query ? <button className="icon-button" aria-label="Effacer la recherche" onClick={() => onQuery('')}><Icon name="close" size={14} /></button> : null}
      </div>
      <p role="status" className="muted small-copy">{searching ? 'Recherche en cours…' : trimmed ? `${hits.length}${hasMore ? '+' : ''} résultat(s) dans ${groups.length} fichier(s)` : 'Cherchez du texte, puis ouvrez une occurrence à sa ligne.'}</p>
      {trimmed && !searching && !hits.length ? <p className="muted small-copy">Aucune correspondance.</p> : null}
      <div className="page-search-results" aria-busy={searching}>
        {groups.map(([path, matches]) => <section className="search-result-group page-card" key={path}>
          <button className="search-result-path" aria-label={path} onClick={() => onOpen(matches[0])}><Icon name="files" size={16} /><strong>{path}</strong><span>{matches.length}</span><Icon name="arrow" size={14} /></button>
          {matches.map((hit, index) => <button className="search-result-line" key={`${hit.line}:${index}`} onClick={() => onOpen(hit)} aria-label={`${path}, ligne ${hit.line}`}><span>{hit.line}</span><code>{hit.text.trim()}</code></button>)}
        </section>)}
      </div>
      {hasMore ? <button className="button secondary load-results" disabled={searching} onClick={onMore}>Charger la suite</button> : null}
    </section>
  );
}

export function GitOverview({ git, onDiff, onRefresh, onTerminal }: {
  git: GitStatus;
  onDiff: (path: string, staged?: boolean) => void;
  onRefresh: () => void;
  onTerminal: () => void;
}) {
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const groups = {
    all: { label: 'Tous', files: git.files },
    staged: { label: 'Indexés', files: git.files.filter(file => file.index !== ' ' && file.index !== '?') },
    unstaged: { label: 'Modifiés', files: git.files.filter(file => file.worktree !== ' ' && file.worktree !== '?') },
    untracked: { label: 'Nouveaux', files: git.files.filter(file => file.index === '?' || file.worktree === '?') },
    conflicts: { label: 'Conflits', files: git.files.filter(file => file.conflicted) },
  };
  const selected = groups[filter as keyof typeof groups];
  const folded = query.trim().toLocaleLowerCase();
  const visible = selected.files.filter(file => file.path.toLocaleLowerCase().includes(folded));
  return (
    <div className="workspace-page git-overview">
      <header className="git-review-toolbar">
        <h1>Changements</h1>
        <span className="git-review-branch"><Icon name="branch" size={14} />{git.branch || 'Sans dépôt'}</span>
        <button className="text-button" onClick={onRefresh}><Icon name="refresh" size={14} /> Actualiser</button>
      </header>
      {git.isRepo ? <>
        <div className="git-review-filters" aria-label="Filtrer les changements">
          {Object.entries(groups).map(([key, group]) => key !== 'conflicts' || group.files.length ?
            <button key={key} aria-pressed={filter === key} onClick={() => setFilter(key)}>
              {group.label} <span>{group.files.length}</span>
            </button> : null)}
          <input aria-label="Filtrer les fichiers Git" placeholder="Filtrer les fichiers…" value={query} onChange={event => setQuery(event.target.value)} />
        </div>
        <section className="page-card git-change-list">

          {git.files.length ? <>
            <div className="git-change-columns"><span>Fichier</span><span>Comparaison</span></div>
            {visible.map((file) => {
              const indexed = file.index !== ' ' && file.index !== '?';
              const working = file.worktree !== ' ';
              const status = file.conflicted ? 'Conflit' : file.index === '?' ? 'Nouveau' : (file.worktree === 'D' || file.index === 'D') ? 'Supprimé' : (file.index === 'A' ? 'Ajouté' : 'Modifié');
              return <div className="git-change-row" key={file.path}>
                <button className="git-change-path" onClick={() => onDiff(file.path, !working && indexed)}><Icon name="files" size={16} /><span>{file.path}</span><small>{status}</small></button>
                <div className="git-compare-actions">{indexed ? <button onClick={() => onDiff(file.path, true)}>Index</button> : null}{working ? <button onClick={() => onDiff(file.path, false)}>Travail</button> : null}</div>
              </div>;
            })}
            {!visible.length ? <p className="git-filter-empty">Aucun fichier ne correspond à ce filtre.</p> : null}
          </> : <div className="git-clean"><Icon name="check" size={34} /><h2>Tout est à jour.</h2><p>Aucun changement local à relire. Vos prochaines modifications apparaîtront ici.</p></div>}
        </section>
      </> : <div className="page-card git-clean"><Icon name="git" size={36} /><h2>Commencez l’historique du projet.</h2><p>Ouvrez le terminal et lancez <code>git init</code>, puis actualisez cette page.</p><div className="page-actions"><button className="button" onClick={onTerminal}><Icon name="terminal" size={16} /> Afficher le terminal</button><button className="button secondary" onClick={onRefresh}>Actualiser</button></div></div>}
    </div>
  );
}
