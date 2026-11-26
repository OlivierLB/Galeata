import { Text, Button, Select, TextArea, TextInput } from './ui/Controls.tsx';
import { useEffect, useRef, useState } from 'react';
import { desktop, request } from '../api.ts';

interface Source { id: string; name: string; path: string; scope: string; category: string; editable: boolean; reason: string }
interface Document { content: string; stamp: string }
const categories: Record<string, string> = { settings: 'Réglages, hooks et MCP', skills: 'Skills', agents: 'Agents', hooks: 'Hooks', commands: 'Commandes', rules: 'Règles', instructions: 'Instructions', mcp: 'MCP', plugins: 'Plugins' };

export default function ToolConfiguration({ onConnect }: { onConnect: (provider: string) => void }) {
  const [provider, setProvider] = useState('codex');
  const [entries, setEntries] = useState<Source[]>([]);
  const [selected, setSelected] = useState<Source | null>(null);
  const [document, setDocument] = useState<Document | null>(null);
  const [content, setContent] = useState('');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const [scope, setScope] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [limited, setLimited] = useState(false);
  const generation = useRef(0);
  const dirty = document !== null && content !== document.content;
  const discard = () => !dirty || window.confirm('Abandonner les modifications non enregistrées ?');
  const fail = (reason: unknown) => setError(String(reason).replace(/^Error: /, ''));
  const refresh = async (tool = provider) => {
    const version = ++generation.current;
    setLoading(true); setError(''); setSelected(null); setDocument(null); setContent(''); setNotice('');
    try {
      const result = await request<{ entries: Source[]; limited: boolean }>('tools.config.list', { provider: tool });
      if (version !== generation.current) return;
      setEntries(result.entries); setLimited(result.limited);
    } catch (reason) { if (version === generation.current) fail(reason); }
    finally { if (version === generation.current) setLoading(false); }
  };
  useEffect(() => { void refresh(); return () => { generation.current++; }; }, []);
  useEffect(() => {
    if (!dirty) return;
    const prevent = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener('beforeunload', prevent);
    return () => window.removeEventListener('beforeunload', prevent);
  }, [dirty]);
  const open = async (source: Source) => {
    if (saving || !discard()) return;
    const version = ++generation.current;
    setSelected(source); setDocument(null); setContent(''); setError(''); setNotice(''); setLoading(true);
    try {
      const value = await request<Document>('tools.config.read', { provider, id: source.id });
      if (version === generation.current) { setDocument(value); setContent(value.content); }
    } catch (reason) { if (version === generation.current) fail(reason); }
    finally { if (version === generation.current) setLoading(false); }
  };
  const filtered = entries.filter(source => (!category || source.category === category)
    && (!scope || source.scope.startsWith(scope))
    && `${source.name} ${source.path}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  return <section className="tool-configuration" aria-label="Configuration des outils IA">
    <header><h1>Outils IA</h1><p className="muted">Consultez les sources installées et modifiez vos configurations Codex et Claude Code.</p></header>
    {!desktop ? <p className="muted">Aperçu : fichiers fictifs, aucune configuration locale n’est modifiée.</p> : null}
    <section aria-label="Connexion aux outils IA">
      <h2>Connexion</h2>
      <p className="muted">Un seul outil suffit. Connectez votre compte dans le terminal intégré, puis démarrez une conversation. Chaque outil gère ses propres identifiants.</p>
      {['codex', 'claude'].map(tool => <Button key={tool} variant="primary" disabled={!desktop} onClick={() => onConnect(tool)}>
        Se connecter à {tool === 'codex' ? 'Codex' : 'Claude Code'}
      </Button>)}
      <Text tone="muted" className="small-copy">L’outil doit être installé. Suivez le lien et les instructions affichés dans le terminal pour terminer la connexion.</Text>
    </section>
    <div className="tools-filters">
      <label>Outil<Select aria-label="Outil à configurer" value={provider} disabled={saving} onChange={event => {
        if (!discard()) return; setProvider(event.target.value); void refresh(event.target.value);
      }}><option value="codex">Codex</option><option value="claude">Claude Code</option></Select></label>
      <label>Type<Select aria-label="Type de configuration" value={category} onChange={event => setCategory(event.target.value)}><option value="">Tous les types</option>{Object.entries(categories).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</Select></label>
      <label>Portée<Select aria-label="Portée de configuration" value={scope} onChange={event => setScope(event.target.value)}><option value="">Toutes les portées</option><option>Projet</option><option>Utilisateur</option><option value="Plugin">Plugins installés</option></Select></label>
      <TextInput aria-label="Rechercher une configuration" placeholder="Rechercher un nom ou un chemin…" value={query} onChange={event => setQuery(event.target.value)} />
      <Button className="text-button" disabled={loading || saving} onClick={() => { if (discard()) void refresh(); }}>Actualiser</Button>
    </div>
    <Text tone="muted" className="small-copy">Les hooks et serveurs MCP peuvent être définis dans les réglages. Cette liste montre les fichiers présents ; leur chargement dépend de la version de l’outil, du projet et de ses règles.</Text>
    {limited ? <p role="status">Inventaire limité à 600 fichiers et 4 000 dossiers. Certaines sources peuvent manquer.</p> : null}
    {error ? <p role="alert" className="inline-error">{error}</p> : null}
    {notice ? <p role="status">{notice}</p> : null}
    <div className="tools-browser">
      <div className="tools-sources" aria-label="Sources de configuration">
        {loading && !selected ? <p className="muted">Recherche des sources de configuration…</p> : null}
        {filtered.map(source => <Button className={`tool-source ${selected?.id === source.id ? 'active' : ''}`} key={source.id} disabled={saving} aria-pressed={selected?.id === source.id} onClick={() => void open(source)}>
          <strong>{source.name}</strong><span>{categories[source.category] ?? source.category} · {source.scope}</span><small>{source.path}</small>{!source.editable ? <small>Consultation uniquement</small> : null}
        </Button>)}
        {!loading && !filtered.length ? <p className="muted">Aucune source trouvée pour ces critères.</p> : null}
      </div>
      <section className="tools-document" aria-label="Fichier de configuration">
        {selected ? <>
          <h2>{selected.name}</h2><p className="small-copy tools-path">{selected.path}</p>
          <Text tone="muted" className="small-copy">{selected.scope}{!selected.editable ? ` · ${selected.reason}` : ' · Enregistrement explicite dans le fichier source.'}</Text>
          {loading ? <p>Lecture du fichier…</p> : null}
          {document ? <>
            <label className="tools-content-label">Contenu du fichier<TextArea aria-label="Contenu de la configuration" spellCheck={false} readOnly={!selected.editable || saving} value={content} onChange={event => { setContent(event.target.value); setNotice(''); }} /></label>
            <div className="tools-filters"><Button variant="primary" disabled={!dirty || saving || !selected.editable} onClick={() => {
              setSaving(true); setError('');
              void request<Document>('tools.config.write', { provider, id: selected.id, content, stamp: document.stamp })
                .then(value => { setDocument(value); setContent(value.content); setNotice('Fichier enregistré. Ouvrez une nouvelle session de l’outil pour prendre en compte les changements.'); })
                .catch(fail).finally(() => setSaving(false));
            }}>{saving ? 'Enregistrement…' : 'Enregistrer'}</Button>
            <Button className="text-button" disabled={saving} onClick={() => void open(selected)}>Recharger le fichier</Button>
            {dirty ? <span className="muted small-copy">Modifications non enregistrées</span> : null}</div>
            <Text tone="muted" className="small-copy">JSON et TOML sont vérifiés avant l’écriture. La compatibilité des options reste celle de l’outil installé.</Text>
          </> : null}
        </> : <p className="muted">Choisissez une source pour consulter son contenu, sa portée et ses possibilités de modification.</p>}
      </section>
    </div>
  </section>;
}
