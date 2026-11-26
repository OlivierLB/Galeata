import { Button, TextInput } from './ui/Controls.tsx';
import { useMemo, useRef, useState } from 'react';
import type { GitStatus, SearchHit, Workspace } from '../types.ts';
import { Icon } from './Icon.tsx';
import { globMatches } from '../editorEdits.ts';

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
        <Button variant="primary" onClick={onFind}><Icon name="search" size={16} /> Trouver un fichier <kbd>Ctrl P</kbd></Button>
        <Button variant="secondary" onClick={onCreate}><Icon name="plus" size={16} /> Créer un fichier</Button>
      </div>
      <section className="page-card">
        <div className="page-section-heading"><h2>À portée de main</h2><span>{git.files.length ? 'Fichiers modifiés dans le projet' : 'Votre espace de travail'}</span></div>
        {git.files.length ? git.files.slice(0, 8).map((file) => (
          <Button className="page-file-link" key={file.path} onClick={() => onOpen(file.path)}>
            <Icon name="files" size={16} /><span>{file.path}</span><Icon name="arrow" size={15} />
          </Button>
        )) : <div className="page-hint"><Icon name="files" size={22} /><p>Aucun fichier ouvert pour le moment. L’explorateur à gauche présente le contenu du projet.</p></div>}
      </section>
      <p className="page-footnote"><Icon name="save" size={14} /> Ctrl S pour enregistrer · Ctrl P pour ouvrir un autre fichier</p>
    </div>
  );
}

export function FileSearch({ query, hits, searching, hasMore, onQuery, onOpen, onMore, onReplace }: {
  query: string;
  hits: SearchHit[];
  searching: boolean;
  hasMore: boolean;
  onQuery: (query: string) => void;
  onOpen: (hit: SearchHit) => void;
  onMore: () => void;
  onReplace: (query: string, replacement: string, include: string, exclude: string) => void;
}) {
  const [include, setInclude] = useState('');
  const [exclude, setExclude] = useState('');
  const [replacement, setReplacement] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [replaceOpen, setReplaceOpen] = useState(false);
  const groups = useMemo(() => {
    const result = new Map<string, SearchHit[]>();
    const included = include.split(';').map(pattern => pattern.trim()).filter(Boolean);
    const excluded = exclude.split(';').map(pattern => pattern.trim()).filter(Boolean);
    for (const hit of hits) {
      if ((included.length && !included.some(pattern => globMatches(hit.path, pattern))) || excluded.some(pattern => globMatches(hit.path, pattern))) continue;
      const group = result.get(hit.path);
      if (group) group.push(hit);
      else result.set(hit.path, [hit]);
    }
    return [...result.entries()];
  }, [hits, include, exclude]);
  const trimmed = query.trim();
  const count = groups.reduce((count, [, matches]) => count + matches.length, 0);
  function highlight(text: string) {
    if (!trimmed) return text;
    const parts = []; let cursor = 0;
    const folded = text.toLocaleLowerCase(), term = trimmed.toLocaleLowerCase();
    let at = folded.indexOf(term);
    while (at >= 0) {
      parts.push(text.slice(cursor, at), <mark key={at}>{text.slice(at, at + trimmed.length)}</mark>);
      cursor = at + trimmed.length; at = folded.indexOf(term, cursor);
    }
    parts.push(text.slice(cursor)); return parts;
  }
  return (
    <section className="file-content-search" aria-label="Recherche dans les fichiers">
      <div className="file-search-controls">
        <div className="file-search-row">
          <Button variant="icon" aria-label="Remplacer dans les fichiers" title="Remplacer dans les fichiers" aria-expanded={replaceOpen} aria-controls="project-replace" onClick={() => setReplaceOpen(open => !open)}><Icon name={replaceOpen ? 'arrow-single-down' : 'arrow-single-right'} size={14} /></Button>
          <div className="search-input"><Icon name="search" size={14} />
            <TextInput ref={input} autoFocus id="project-content-search" aria-label="Rechercher dans le contenu" placeholder="Rechercher…" value={query} onChange={event => onQuery(event.target.value)} onKeyDown={event => {
              if (event.key === 'Enter' && !searching && groups.length) { event.preventDefault(); onOpen(groups[0][1][0]); }
              if (event.key === 'Escape' && query) { event.preventDefault(); event.stopPropagation(); onQuery(''); }
            }} />
            {query ? <Button variant="icon" aria-label="Effacer la recherche" onClick={() => { onQuery(''); input.current?.focus(); }}><Icon name="close" size={14} /></Button> : null}
          </div>
          <Button variant="icon" className={include || exclude ? 'has-filters' : ''} aria-label="Filtrer les fichiers" title="Filtrer les fichiers" aria-expanded={filtersOpen} aria-controls="project-search-filters" onClick={() => setFiltersOpen(open => !open)}><Icon name="filter" size={14} /></Button>
        </div>
        {replaceOpen ? <div id="project-replace" className="file-search-row file-search-replace">
          <TextInput aria-label="Texte de remplacement" placeholder="Remplacer par…" value={replacement} onChange={event => setReplacement(event.target.value)} />
          <Button variant="icon" disabled={!trimmed || searching} aria-label="Prévisualiser le remplacement" title="Prévisualiser le remplacement" onClick={() => onReplace(trimmed, replacement, include, exclude)}><Icon name="edit" size={14} /></Button>
        </div> : null}
        {filtersOpen ? <div id="project-search-filters" className="file-search-filters">
          <TextInput aria-label="Fichiers à inclure" placeholder="Inclure : **/*.ts" value={include} onChange={event => setInclude(event.target.value)} />
          <TextInput aria-label="Fichiers à exclure" placeholder="Exclure : **/*.test.*" value={exclude} onChange={event => setExclude(event.target.value)} />
        </div> : null}
      </div>
      <p role="status" className="file-search-count">{searching ? 'Recherche…' : trimmed ? count ? `${count}${hasMore ? '+' : ''} résultat${count > 1 ? 's' : ''} · ${groups.length} fichier${groups.length > 1 ? 's' : ''}` : 'Aucune correspondance.' : ''}</p>
      <div className="file-search-results" aria-busy={searching}>
        {groups.map(([path, matches]) => <details open className="file-search-group" key={path}>
          <summary title={path}><Icon name="chevron" size={12} /><Icon name="files" size={14} /><strong>{path.split('/').pop()}</strong><small>{path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''}</small><span className="file-search-badge">{matches.length}</span></summary>
          {matches.map((hit, index) => <Button className="file-search-match" key={`${hit.line}:${index}`} title={hit.text.trim()} onClick={() => onOpen(hit)} aria-label={`${path}, ligne ${hit.line}`}><span>{hit.line}</span><code>{highlight(hit.text.trim())}</code></Button>)}
        </details>)}
        {hasMore ? <Button variant="secondary" className="load-results" disabled={searching} onClick={onMore}>Charger la suite</Button> : null}
      </div>
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
        <Button className="text-button" onClick={onRefresh}><Icon name="refresh" size={14} /> Actualiser</Button>
      </header>
      {git.isRepo ? <>
        <div className="git-review-filters" aria-label="Filtrer les changements">
          {Object.entries(groups).map(([key, group]) => key !== 'conflicts' || group.files.length ?
            <Button key={key} aria-pressed={filter === key} onClick={() => setFilter(key)}>
              {group.label} <span>{group.files.length}</span>
            </Button> : null)}
          <TextInput aria-label="Filtrer les fichiers Git" placeholder="Filtrer les fichiers…" value={query} onChange={event => setQuery(event.target.value)} />
        </div>
        <section className="page-card git-change-list">

          {git.files.length ? <>
            <div className="git-change-columns"><span>Fichier</span><span>Comparaison</span></div>
            {visible.map((file) => {
              const indexed = file.index !== ' ' && file.index !== '?';
              const working = file.worktree !== ' ';
              const status = file.conflicted ? 'Conflit' : file.index === '?' ? 'Nouveau' : (file.worktree === 'D' || file.index === 'D') ? 'Supprimé' : (file.index === 'A' ? 'Ajouté' : 'Modifié');
              return <div className="git-change-row" key={file.path}>
                <Button className="git-change-path" onClick={() => onDiff(file.path, !working && indexed)}><Icon name="files" size={16} /><span>{file.path}</span><small>{status}</small></Button>
                <div className="git-compare-actions">{indexed ? <Button onClick={() => onDiff(file.path, true)}>Index</Button> : null}{working ? <Button onClick={() => onDiff(file.path, false)}>Travail</Button> : null}</div>
              </div>;
            })}
            {!visible.length ? <p className="git-filter-empty">Aucun fichier ne correspond à ce filtre.</p> : null}
          </> : <div className="git-clean"><Icon name="check" size={34} /><h2>Tout est à jour.</h2><p>Aucun changement local à relire. Vos prochaines modifications apparaîtront ici.</p></div>}
        </section>
      </> : <div className="page-card git-clean"><Icon name="git" size={36} /><h2>Commencez l’historique du projet.</h2><p>Ouvrez le terminal et lancez <code>git init</code>, puis actualisez cette page.</p><div className="page-actions"><Button variant="primary" onClick={onTerminal}><Icon name="terminal" size={16} /> Afficher le terminal</Button><Button variant="secondary" onClick={onRefresh}>Actualiser</Button></div></div>}
    </div>
  );
}
