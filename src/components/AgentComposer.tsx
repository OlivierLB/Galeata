import { Button, TextArea, TextInput } from './ui/Controls.tsx';
import Subagents from './Subagents.tsx';
import MessageQueue from './MessageQueue.tsx';
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { request } from '../api.ts';
import { compactAgent, listAgentSkills, setAgentMode, type SkillOption } from '../agents/api.ts';
import { agentStore } from '../agents/store.ts';
import { agentModes } from '../agents/preferences.ts';
import type { Conversation } from '../agents/types.ts';
import { mascot } from '../mascot/store.ts';
import { Icon } from './Icon.tsx';

type Menu = 'commands' | 'files' | 'skills';
type Choice = { id: string; label: string; detail: string; disabled?: boolean; run: () => void };

/** Completion is local to this composer, including in split view. */
export function AgentComposer({
  conversation,
  onSend,
  children,
}: {
  conversation: Conversation;
  onSend: (text: string, images?: string[]) => Promise<void>;
  children: ReactNode;
}) {
  const { id, provider, state, busy, mode } = conversation;
  const [draft, setDraft] = useState(() => agentStore.getDraft(id));
  const [images, setImages] = useState<string[]>(() => agentStore.getImageDraft(id));
  useEffect(() => { agentStore.setImageDraft(id, images); }, [id, images]);
  const imageInput = useRef<HTMLInputElement>(null);
  async function addImages(files: File[]) {
    try {
      if (files.length + images.length > 4) throw new Error('Maximum 4 images par message.');
      const added = await Promise.all(files.map(file => new Promise<string>((resolve, reject) => {
        if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type) || file.size > 5 * 1024 * 1024) {
          reject(new Error('Images PNG, JPEG, WebP ou GIF de 5 Mo maximum.')); return;
        }
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error('Lecture de l’image impossible.'));
        reader.readAsDataURL(file);
      })));
      setImages(previous => [...previous, ...added].slice(0, 4));
    } catch (reason) { setError(String(reason)); }
  }
  const [menu, setMenu] = useState<Menu | null>(null);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const [skills, setSkills] = useState<SkillOption[]>([]);
  const [files, setFiles] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const [compacting, setCompacting] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const palette = useRef<HTMLElement>(null);
  const range = useRef<{ start: number; end: number } | null>(null);
  const listId = useId();
  const exited = state === 'exited';
  const canCompact = state === 'idle' && !busy && !compacting;

  useEffect(() => input.current?.focus(), [id]);
  useEffect(() => {
    if (!menu) return;
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && !palette.current?.contains(event.target)) {
        setMenu(null);
      }
    };
    document.addEventListener('pointerdown', dismiss, true);
    return () => document.removeEventListener('pointerdown', dismiss, true);
  }, [menu]);
  useEffect(() => {
    if (!menu || menu === 'commands') return;
    let cancelled = false;
    setLoading(true);
    setError('');
    const timer = window.setTimeout(
      () => {
        const action =
          menu === 'skills'
            ? listAgentSkills(provider).then((items) => {
                if (!cancelled) setSkills(items);
              })
            : request<{ items: { path: string }[] }>('workspace.search_files', { query }).then(
                (result) => {
                  if (!cancelled) setFiles(result.items.map((item) => item.path));
                },
              );
        void action
          .catch((reason) => {
            if (!cancelled) setError(String(reason));
          })
          .finally(() => {
            if (!cancelled) setLoading(false);
          });
      },
      menu === 'files' ? 120 : 0,
    );
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [menu, menu === 'files' ? query : '', provider]);

  function update(text: string) {
    agentStore.setDraft(id, text);
    setDraft(text);
    if (text) mascot.react('text-edit', id);
  }
  function close() {
    setMenu(null);
    setError('');
  }
  function open(next: Menu, start?: number) {
    range.current = {
      start: start ?? input.current?.selectionStart ?? draft.length,
      end: input.current?.selectionEnd ?? draft.length,
    };
    setMenu(next);
    setQuery('');
    setSelected(0);
    setError('');
    if (next === 'files') setFiles([]);
    if (start === undefined) window.requestAnimationFrame(() => search.current?.focus());
  }
  function insert(text: string) {
    const at = range.current ?? { start: draft.length, end: draft.length };
    const prefix = draft.slice(0, at.start);
    const value = `${prefix}${prefix && !/\s$/.test(prefix) ? ' ' : ''}${text} `;
    update(value + draft.slice(at.end));
    close();
    window.requestAnimationFrame(() => {
      input.current?.focus();
      input.current?.setSelectionRange(value.length, value.length);
    });
  }
  function consumeCommand() {
    const at = range.current;
    if (menu === 'commands' && at && draft[at.start] === '/') {
      update(draft.slice(0, at.start) + draft.slice(at.end));
    }
  }
  async function changeMode(next: string) {
    consumeCommand();
    close();
    try {
      await setAgentMode(id, next);
    } catch (reason) {
      setError(String(reason));
    }
    input.current?.focus();
  }
  async function compact() {
    if (!canCompact) return;
    consumeCommand();
    close();
    setCompacting(true);
    try {
      await compactAgent(id);
    } catch (reason) {
      setError(String(reason));
    } finally {
      setCompacting(false);
      input.current?.focus();
    }
  }
  const commands: Choice[] = [
    {
      id: 'compact',
      label: '/compact',
      detail: 'Compacter le contexte · Ctrl+Alt+C',
      disabled: !canCompact,
      run: () => void compact(),
    },
    {
      id: 'plan',
      label: '/plan',
      detail: 'Préparer un plan avant d’agir · Ctrl+Alt+P',
      run: () => void changeMode('plan'),
    },
    {
      id: 'files',
      label: '@ Fichier',
      detail: 'Citer un fichier du projet · Ctrl+Alt+F',
      run: () => open('files', range.current?.start),
    },
    {
      id: 'skills',
      label: '$ Skill',
      detail: 'Appeler un skill installé · Ctrl+Alt+S',
      run: () => open('skills', range.current?.start),
    },
  ];
  const choices: Choice[] =
    menu === 'files'
      ? files.map((path) => ({
          id: path,
          label: path,
          detail: 'Fichier du projet',
          run: () => insert(`[${path.replaceAll(']', '\\]')}](<${path.replaceAll('>', '%3E')}>)`),
        }))
      : menu === 'skills'
        ? skills
            .filter((skill) =>
              `${skill.name} ${skill.description}`.toLowerCase().includes(query.toLowerCase()),
            )
            .map((skill) => ({
              id: skill.path,
              label: skill.name,
              detail: skill.description || skill.path,
              run: () =>
                insert(
                  `Utilise le skill [${skill.name.replaceAll(']', '\\]')}](<${skill.path.replaceAll('>', '%3E')}>) pour cette demande.`,
                ),
            }))
        : commands.filter((command) =>
            `${command.label} ${command.detail}`.toLowerCase().includes(query.toLowerCase()),
          );
  const index = Math.min(selected, Math.max(0, choices.length - 1));
  useEffect(() => {
    if (menu) document.getElementById(`${listId}-${index}`)?.scrollIntoView({ block: 'nearest' });
  }, [menu, listId, index]);

  async function send() {
    const text = draft.trim();
    if ((!text && !images.length) || exited || sending) return;
    if (text === '/compact') {
      if (canCompact) {
        update('');
        await compact();
      }
      return;
    }
    if (text === '/plan') {
      update('');
      await changeMode('plan');
      return;
    }
    setSending(true);
    setError('');
    update('');
    close();
    try {
      await onSend(text, images);
      setImages([]);
    } catch (reason) {
      if (!agentStore.getDraft(id)) update(text);
      setError(String(reason));
    } finally {
      setSending(false);
    }
  }
  function enqueue() {
    if (!draft.trim() || images.length || exited || sending) return;
    try {
      agentStore.enqueue(id, draft);
      update('');
      close();
      input.current?.focus();
    } catch (reason) {
      setError(String(reason));
    }
  }
  function keys(event: KeyboardEvent<HTMLTextAreaElement | HTMLInputElement>) {
    if (event.nativeEvent.isComposing) return;
    if (
      event.key === 'Tab' &&
      !event.shiftKey &&
      !event.ctrlKey &&
      !event.altKey &&
      !event.metaKey &&
      event.currentTarget === input.current &&
      draft.trim()
    ) {
      event.preventDefault();
      enqueue();
      return;
    }
    if (event.ctrlKey && event.altKey && !event.metaKey) {
      const shortcut = event.key.toLowerCase();
      if (['f', 's', 'p', 'c', '/'].includes(shortcut)) {
        event.preventDefault();
        event.stopPropagation();
        if (shortcut === 'f') open('files');
        if (shortcut === 's') open('skills');
        if (shortcut === '/') open('commands');
        if (shortcut === 'p') void changeMode(mode === 'plan' ? 'auto' : 'plan');
        if (shortcut === 'c') void compact();
        return;
      }
    }
    if (menu) {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        close();
        input.current?.focus();
        return;
      }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        setSelected(
          (index + (event.key === 'ArrowDown' ? 1 : choices.length - 1)) %
            Math.max(choices.length, 1),
        );
        return;
      }
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        if (!loading && !choices[index]?.disabled) choices[index]?.run();
        return;
      }
    }
    if (event.key === 'Tab' && event.shiftKey) {
      event.preventDefault();
      const modes = agentModes[provider].filter((option) => !option.danger);
      void changeMode(
        modes[(modes.findIndex((option) => option.id === mode) + 1) % modes.length].id,
      );
      return;
    }
    if (event.key === 'Enter' && !event.shiftKey && event.currentTarget === input.current) {
      event.preventDefault();
      void send();
    }
  }
  return (
    <div className={`chat-composer ${mode === 'plan' ? 'composer-planning' : ''}`}
      onDragOver={event => { if (event.dataTransfer.types.includes('Files')) event.preventDefault(); }}
      onDrop={event => { event.preventDefault(); if (!exited && !sending) void addImages(Array.from(event.dataTransfer.files)); }}
      onPaste={event => {
        const files = Array.from(event.clipboardData.files);
        if (files.length && !exited && !sending) { event.preventDefault(); void addImages(files); }
      }}>
      <input type="file" ref={imageInput} hidden accept="image/png,image/jpeg,image/webp,image/gif" multiple onChange={event => { void addImages(Array.from(event.target.files ?? [])); event.target.value = ''; }} />
      {images.length ? <div className="composer-images">{images.map((src, index) => <div key={index}><img src={src} alt={`Image jointe ${index + 1}`} /><Button aria-label={`Retirer l’image ${index + 1}`} onClick={() => setImages(previous => previous.filter((_, i) => i !== index))}>Retirer</Button></div>)}</div> : null}
      {conversation.queuedMessages.length ? (
        <MessageQueue messages={conversation.queuedMessages} paused={conversation.queuePaused} exited={exited}
          onPause={paused => agentStore.pauseQueue(id, paused)}
          onRemove={messageId => agentStore.removeQueued(id, messageId)} />
      ) : null}
      {menu ? (
        <section
          className="composer-palette"
          ref={palette}
          aria-label={
            menu === 'files'
              ? 'Citer un fichier'
              : menu === 'skills'
                ? 'Appeler un skill'
                : 'Commandes du message'
          }
        >
          <header>
            <strong>
              {menu === 'files'
                ? 'Fichiers du projet'
                : menu === 'skills'
                  ? 'Skills installés'
                  : 'Commandes'}
            </strong>
            <Button
              className="text-button"
              onClick={() => {
                close();
                input.current?.focus();
              }}
              aria-label="Fermer les suggestions"
            >
              Échap
            </Button>
          </header>
          <TextInput
            ref={search}
            aria-label="Rechercher une suggestion"
            placeholder={
              menu === 'files'
                ? 'Rechercher un fichier…'
                : menu === 'skills'
                  ? 'Rechercher un skill…'
                  : 'Rechercher une commande…'
            }
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setSelected(0);
            }}
            onKeyDown={keys}
            aria-controls={listId}
            aria-activedescendant={choices[index] ? `${listId}-${index}` : undefined}
          />
          <div id={listId} role="listbox" aria-label="Suggestions">
            {loading ? (
              <p role="status">Recherche…</p>
            ) : choices.length ? (
              choices.map((choice, i) => (
                <Button
                  key={choice.id}
                  id={`${listId}-${i}`}
                  role="option"
                  aria-selected={i === index}
                  disabled={choice.disabled}
                  onMouseEnter={() => setSelected(i)}
                  onClick={choice.run}
                >
                  <strong>{choice.label}</strong>
                  <span>{choice.detail}</span>
                </Button>
              ))
            ) : (
              <p role="status">
                {menu === 'skills'
                  ? 'Aucun skill trouvé dans les dossiers de cet agent.'
                  : 'Aucun résultat.'}
              </p>
            )}
          </div>
          <footer>
            ↑ ↓ parcourir · Entrée choisir · Échap fermer
            {menu === 'skills' ? ' · Instructions ajoutées au message' : ''}
          </footer>
        </section>
      ) : null}
      {mode === 'plan' ? (
        <div className="composer-plan-hint">
          <Icon name="spark" size={12} /> Mode Plan · explorer, clarifier et proposer avant d’agir
        </div>
      ) : null}
      <div className="composer-input-row">
        <TextArea
          ref={input}
          aria-label="Message à l’agent"
          placeholder={
            exited ? 'Conversation terminée' : 'Décrivez la tâche… / commandes, @ fichier, $ skill'
          }
          value={draft}
          disabled={exited || sending}
          rows={Math.min(8, Math.max(2, draft.split('\n').length))}
          onKeyDown={keys}
          onChange={(event) => {
            const text = event.target.value;
            update(text);
            const caret = event.target.selectionStart;
            const match = /(?:^|\s)([@$\/])([^\s]*)$/.exec(text.slice(0, caret));
            if (match) {
              const start = caret - match[2].length - 1;
              range.current = { start, end: caret };
              setMenu(match[1] === '@' ? 'files' : match[1] === '$' ? 'skills' : 'commands');
              setQuery(match[2]);
              setSelected(0);
              setError('');
            } else close();
          }}
          aria-controls={menu ? listId : undefined}
          aria-expanded={!!menu}
          aria-activedescendant={menu && choices[index] ? `${listId}-${index}` : undefined}
        />
      </div>
      {error ? (
        <p className="composer-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="composer-bar">
        <div className="composer-tools" aria-label="Actions du message">
          <Button disabled={exited || sending || images.length >= 4} onClick={() => imageInput.current?.click()}>Image</Button>
          <Button
            type="button"
            disabled={exited}
            onClick={() => open('commands')}
            title="Commandes (Ctrl+Alt+/)"
          >
            <span>/</span> Commandes
          </Button>
          <Button
            type="button"
            disabled={exited}
            onClick={() => open('files')}
            title="Citer un fichier (Ctrl+Alt+F)"
          >
            <span>@</span> Fichier
          </Button>
          <Button
            type="button"
            disabled={exited}
            onClick={() => open('skills')}
            title="Appeler un skill (Ctrl+Alt+S)"
          >
            <Icon name="spark" size={13} /> Skill
          </Button>
        </div>
        {children}
        <Button
          className="text-button composer-context"
          disabled={!canCompact}
          onClick={() => void compact()}
          title={
            canCompact
              ? 'Compacter le contexte (Ctrl+Alt+C)'
              : 'Compaction disponible après la fin du tour'
          }
          aria-label="Compacter le contexte"
        >
          {compacting
            ? 'Compaction…'
            : conversation.usage?.contextWindow
              ? `Contexte ${Math.round((conversation.usage.inputTokens / conversation.usage.contextWindow) * 100)} %`
              : 'Contexte'}
        </Button>
        <div className="composer-send-actions">
          <Button
            className="text-button"
            title="Envoyer après la fin complète du tour précédent (Tab)"
            disabled={!draft.trim() || images.length > 0 || exited || sending}
            onClick={enqueue}
          >
            Mettre en file <kbd>Tab</kbd>
          </Button>
          <Button
            variant="primary"
            disabled={(!draft.trim() && !images.length) || exited || sending}
            onClick={() => void send()}
          >
            Envoyer <Icon name="arrow" size={14} />
          </Button>
        </div>
      </div>
      <div className="composer-meta">
        <Subagents conversation={conversation} />
        <details className="composer-help">
          <summary>Raccourcis</summary>
          <p>
            Maj+Entrée : nouvelle ligne · Maj+Tab : mode
            <br />
            Ctrl+Alt+F : fichier · Ctrl+Alt+S : skill
            <br />
            Ctrl+Alt+P : Plan · Ctrl+Alt+C : compacter
          </p>
        </details>
      </div>
    </div>
  );
}
