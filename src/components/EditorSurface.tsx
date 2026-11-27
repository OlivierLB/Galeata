import type { EditorPreferences } from '../editorPreferences.ts';
import { readUiNumber } from '../uiTokens.ts';
import { installAdditionalLanguages } from '../editorLanguages.ts';
import { configureLanguageProject, installLanguageProviders, updateLanguageDiagnostics, requestCodeOperation, previewLanguageEdit, symbolList, getModelDiagnostics, formatLanguageModel, prepareLanguageProject, openImportAtPosition } from '../languageClient.ts';
import '../doodle-monaco.css';
import { useEffect, useRef, useState } from 'react';
import { changeMarkers, type ChangeMarker } from '../editorChanges.ts';
import ModalDialog from './ModalDialog.tsx';
import * as monaco from 'monaco-editor';
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import TypeScriptWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';
import JsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker';
import CssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker';
import HtmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker';
import { applyTextEdits, type ProposedFileEdit } from '../editorEdits.ts';
import { languageFor } from '../domain.ts';
import { loadEditorConfig } from '../editorConfig.ts';
import { request, desktop } from '../api.ts';
import type { OpenFile } from '../types.ts';

(self as unknown as { MonacoEnvironment: monaco.Environment }).MonacoEnvironment = {
  getWorker(_id: string, label: string) {
    if (label === 'typescript' || label === 'javascript') return new TypeScriptWorker();
    if (label === 'json') return new JsonWorker();
    if (label === 'css' || label === 'scss' || label === 'less') return new CssWorker();
    if (label === 'html' || label === 'handlebars' || label === 'razor') return new HtmlWorker();
    return new EditorWorker();
  },
};
for (const defaults of [monaco.languages.typescript.typescriptDefaults, monaco.languages.typescript.javascriptDefaults]) {
  // The embedded worker only sees open models, not tsconfig, node_modules or
  // ambient declarations. Project-wide semantic diagnostics belong to the LSP.
  defaults.setDiagnosticsOptions({ ...defaults.getDiagnosticsOptions(), noSemanticValidation: true, noSyntaxValidation: false });
  defaults.setCompilerOptions({ ...defaults.getCompilerOptions(), jsx: monaco.languages.typescript.JsxEmit.ReactJSX,
    allowNonTsExtensions: true, allowJs: true, moduleResolution: monaco.languages.typescript.ModuleResolutionKind.NodeJs });
}
monaco.editor.defineTheme('galeata', {
  base: 'vs',
  inherit: true,
  rules: [
    { token: 'comment', foreground: '69758D', fontStyle: 'italic' },
    { token: 'keyword', foreground: '65537D' },
    { token: 'string', foreground: '42694B' },
    { token: 'number', foreground: '88601F' },
  ],
  colors: {
    'editor.background': '#faf6eb',
    'editor.foreground': '#292c27',
    'editorLineNumber.foreground': '#68665d',
    'editorLineNumber.activeForeground': '#46614b',
    'editor.lineHighlightBackground': '#e5dece',
    'editor.selectionBackground': '#46614b2C',
    'editorCursor.foreground': '#46614b',
    'editorIndentGuide.background1': '#cec6b5',
    'editorWidget.background': '#e5dece',
    'editorOverviewRuler.border': '#faf6eb',
  },
});

monaco.editor.defineTheme('galeata-night', {
  base: 'vs-dark', inherit: true, rules: [],
  colors: { 'editor.background': '#282725', 'editor.foreground': '#eee6d5',
    'editorLineNumber.foreground': '#b2ac9c', 'editorCursor.foreground': '#c7d8a8',
    'editor.selectionBackground': '#535847', 'editor.lineHighlightBackground': '#34322f' },
});
function syncEditorTheme() {
  monaco.editor.setTheme(document.documentElement.dataset.theme === 'night' ? 'galeata-night' : 'galeata');
}
window.addEventListener('galeata:theme', syncEditorTheme);
installAdditionalLanguages();

let focusedEditor: monaco.editor.IStandaloneCodeEditor | null = null;
const retained = new Map<string, { model: monaco.editor.ITextModel; view: monaco.editor.ICodeEditorViewState | null }>();
export function retainOpenModels(paths: string[]) {
  const open = new Set(paths);
  for (const [key, entry] of retained) if (!open.has(key)) {
    entry.model.dispose(); retained.delete(key);
  }
}
let activeProject = { id: '', root: '' };
export function applyFileChanges(id: string, root: string, files: Pick<ProposedFileEdit, 'path' | 'before' | 'after'>[]) {
  for (const file of files) {
    const key = `${id}:${file.path}`;
    let entry = retained.get(key);
    if (!entry) {
      const uri = monaco.Uri.file(`${root}/${file.path}`);
      const model = monaco.editor.getModel(uri) ?? monaco.editor.createModel(file.before, languageFor(file.path, file.before), uri);
      entry = { model, view: null }; retained.set(key, entry);
    }
    const model = entry.model;
    if (model.getValue() === file.before && file.before !== file.after) {
      model.pushStackElement(); model.pushEditOperations([], [{ range: model.getFullModelRange(), text: file.after }], () => null); model.pushStackElement();
    }
  }
}
window.addEventListener('galeata:apply-model-edits', event => applyFileChanges(activeProject.id, activeProject.root, (event as CustomEvent<ProposedFileEdit[]>).detail));
window.addEventListener('galeata:open-models', event => retainOpenModels((event as CustomEvent<string[]>).detail));
export async function formatOpenFile(key: string, content: string, file: OpenFile, root: string, preferences: EditorPreferences): Promise<string> {
  prepareLanguageProject(root);
  const existing = retained.get(key)?.model ?? monaco.editor.getModel(monaco.Uri.file(`${root}/${file.path}`));
  const model = existing ?? monaco.editor.createModel(content, file.language, monaco.Uri.file(`${root}/${file.path}`));
  if (model.getValue() !== content) { if (!existing) model.dispose(); return content; }
  try {
    const options = model.getOptions();
    const config = desktop ? await loadEditorConfig(file.path, async path => (await request<{ content: string }>('workspace.read', { path })).content) : {};
    const tabSize = Number(config.indent_size === 'tab' ? config.tab_width : config.indent_size) || preferences.tabSize || options.tabSize;
    const insertSpaces = config.indent_style !== 'tab';
    const edits = await formatLanguageModel(model, { tabSize, insertSpaces });
    if (edits) return applyTextEdits(content, edits);
    return content;
  } finally { if (!existing) model.dispose(); }
}
function shortcutBinding(value: string): number {
  let modifiers = 0;
  const parts = value.split('+').map(part => part.trim());
  const key = parts.pop() ?? '';
  for (const part of parts) {
    if (/^ctrl$/i.test(part)) modifiers |= monaco.KeyMod.CtrlCmd;
    else if (/^shift$/i.test(part)) modifiers |= monaco.KeyMod.Shift;
    else if (/^alt$/i.test(part)) modifiers |= monaco.KeyMod.Alt;
    else return 0;
  }
  const name = /^[a-z]$/i.test(key) ? `Key${key.toUpperCase()}` : Object.keys(monaco.KeyCode).find(name => name.toLowerCase() === key.toLowerCase()) ?? key;
  const code = (monaco.KeyCode as unknown as Record<string, number>)[name];
  return typeof code === 'number' ? modifiers | code : 0;
}
export default function EditorSurface({
  file,
  modelKey,
  projectRoot,
  preferences,
  onOpen,
  diff,
  onChange,
  onSave,
  line,
  column,
  revealRequest,
}: {
  file: OpenFile;
  modelKey: string;
  projectRoot: string;
  preferences: EditorPreferences;
  onOpen: (path: string, line?: number, column?: number) => void;
  /** With `editable`, the right side is the working file: changes and Ctrl+S apply to it. */
  diff?: { original: string; modified: string; editable?: boolean };
  onChange: (content: string) => void;
  onSave: () => void;
  line?: number;
  column?: number;
  revealRequest?: number;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [detail, setDetail] = useState<string | null>(null);
  const markersRef = useRef<ChangeMarker[]>([]);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const changeRef = useRef(onChange);
  const saveRef = useRef(onSave);
  changeRef.current = onChange;
  saveRef.current = onSave;
  useEffect(() => {
    if (!container.current) return;
    activeProject = { id: modelKey.slice(0, modelKey.indexOf(':')), root: projectRoot };
    configureLanguageProject(projectRoot, onOpen);
    installLanguageProviders();
    const options: monaco.editor.IStandaloneEditorConstructionOptions = {
      theme: document.documentElement.dataset.theme === 'night' ? 'galeata-night' : 'galeata',
      automaticLayout: true,
      fontSize: preferences.fontSize,
      fontFamily: preferences.fontFamily,
      lineHeight: readUiNumber('--editor-line-height'),
      padding: { top: readUiNumber('--editor-padding-top') },
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      smoothScrolling: true,
      tabSize: preferences.tabSize,
      renderLineHighlight: 'line',
      wordWrap: preferences.wordWrap,
      bracketPairColorization: { enabled: true },
      glyphMargin: true,
    };
    if (diff) {
      const original = monaco.editor.createModel(
        diff.original,
        file.language,
        monaco.Uri.parse(`inmemory://galeata/original/${encodeURIComponent(file.path)}`),
      );
      const retainedModified = diff.editable ? retained.get(modelKey) : undefined;
      const modified = diff.editable ? retainedModified?.model ?? monaco.editor.getModel(monaco.Uri.file(`${projectRoot}/${file.path}`)) ?? monaco.editor.createModel(diff.modified, file.language, monaco.Uri.file(`${projectRoot}/${file.path}`)) : monaco.editor.createModel(
        diff.modified,
        file.language,
        monaco.Uri.parse(`inmemory://galeata/modified/${encodeURIComponent(file.path)}`),
      );
      if (diff.editable) {
        if (modified.getValue() !== diff.modified) modified.setValue(diff.modified);
        retained.set(modelKey, { model: modified, view: retainedModified?.view ?? null });
      }
      const editor = monaco.editor.createDiffEditor(container.current, {
        ...options,
        readOnly: !diff.editable,
        originalEditable: false,
        renderSideBySide: true,
      });
      editor.setModel({ original, modified });
      if (diff.editable) {
        editorRef.current = editor.getModifiedEditor();
        if (retainedModified?.view) editorRef.current.restoreViewState(retainedModified.view);
      }
      const listener = diff.editable
        ? modified.onDidChangeContent(() => changeRef.current(modified.getValue()))
        : null;
      if (diff.editable)
        editor
          .getModifiedEditor()
          .addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => saveRef.current());
      return () => {
        listener?.dispose();
        if (diff.editable) {
          const entry = retained.get(modelKey);
          if (entry) entry.view = editor.getModifiedEditor().saveViewState();
        }
        editorRef.current = null;
        editor.dispose();
        original.dispose();
        if (!diff.editable) modified.dispose();
      };
    }
    const previous = retained.get(modelKey);
    const model = previous?.model ?? monaco.editor.getModel(monaco.Uri.file(`${projectRoot}/${file.path}`)) ?? monaco.editor.createModel(
      file.content, file.language, monaco.Uri.file(`${projectRoot}/${file.path}`));
    if (model.getValue() !== file.content) model.setValue(file.content);
    retained.set(modelKey, { model, view: previous?.view ?? null });
    const editor = monaco.editor.create(container.current, { ...options, model });
    editorRef.current = editor;
    const importClick = editor.onMouseDown(event => {
      if (!(event.event.ctrlKey || event.event.metaKey) || event.event.altKey || !event.target.position) return;
      void openImportAtPosition(model, event.target.position).catch(error => window.dispatchEvent(new CustomEvent('galeata:language-status', { detail: String(error) })));
    });
    if (!focusedEditor) focusedEditor = editor;
    const cursorListener = editor.onDidChangeCursorPosition(event => window.dispatchEvent(new CustomEvent('galeata:cursor-position', { detail: { path: file.path, line: event.position.lineNumber, column: event.position.column } })));
    const focusListener = editor.onDidFocusEditorText(() => { focusedEditor = editor; });
    const commandListener = (event: Event) => {
      const detail = (event as CustomEvent<{ command: string; path: string }>).detail;
      if (detail.path !== file.path || (focusedEditor?.getModel() === model && focusedEditor !== editor)) return;
      const selection = editor.getSelection() ?? model.getFullModelRange();
      const p = editor.getPosition() ?? new monaco.Position(1, 1);
      if (detail.command === 'rename') { void editor.getAction('editor.action.rename')?.run(); return; }
      if (detail.command === 'structure') {
        editor.focus();
        void editor.getAction('editor.action.quickOutline')?.run();
      } else if (detail.command === 'project-symbols') {
        window.dispatchEvent(new CustomEvent('galeata:query-symbols', { detail: async (query: string) => symbolList(await requestCodeOperation(model, 'workspace/symbol', { query }) ?? [], model) }));
      } else {
        void requestCodeOperation(model, 'textDocument/codeAction', { range: { start: { line: selection.startLineNumber - 1, character: selection.startColumn - 1 }, end: { line: selection.endLineNumber - 1, character: selection.endColumn - 1 } }, context: { diagnostics: getModelDiagnostics(model), only: detail.command === 'organize-imports' ? ['source.organizeImports'] : undefined } }).then(actions => {
          const available = (Array.isArray(actions) ? actions : []).filter((action: any) => !action.disabled && (action.edit || action.data));
          window.dispatchEvent(new CustomEvent('galeata:code-action-choices', { detail: { actions: available, apply: async (index: number) => {
            const action = available[index]; if (!action) return;
            const resolved = action.edit ? action : await requestCodeOperation(model, 'codeAction/resolve', action);
            if (resolved?.edit) previewLanguageEdit(action.title, resolved.edit);
          } } }));
        });
      }
      void p;
    };
    const contextualActions = [
      { command: 'structure', label: 'Aller à un symbole dans le fichier…', key: monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyO, group: 'navigation' },
      { command: 'project-symbols', label: 'Rechercher un symbole du projet…', key: monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyT, group: 'navigation' },
      { command: 'organize-imports', label: 'Organiser les imports', key: monaco.KeyMod.Alt | monaco.KeyMod.Shift | monaco.KeyCode.KeyO, group: '1_modification' },
    ].map(action => editor.addAction({ id: `galeata.${action.command}`, label: action.label, keybindings: [action.key], contextMenuGroupId: action.group,
      run: () => commandListener(new CustomEvent('galeata:editor-command', { detail: { command: action.command, path: file.path } })),
    }));
    window.addEventListener('galeata:editor-command', commandListener);
    if (previous?.view) editor.restoreViewState(previous.view);
    const listener = model.onDidChangeContent(() => changeRef.current(model.getValue()));
    const click = editor.onMouseDown(event => {
      if (event.target.type !== monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN) return;
      const line = event.target.position?.lineNumber;
      const marker = markersRef.current.find(marker => line && line >= marker.line && line <= marker.end);
      if (marker) setDetail(marker.detail);
    });
    const diagnosticsTimer = setInterval(() => { if (!document.hidden) void updateLanguageDiagnostics(model); }, 2000);
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => saveRef.current());
    return () => {
      click.dispose();
      listener.dispose(); focusListener.dispose(); cursorListener.dispose(); importClick.dispose(); contextualActions.forEach(action => action.dispose());
      if (focusedEditor === editor) focusedEditor = null;
      window.removeEventListener('galeata:editor-command', commandListener);
      clearInterval(diagnosticsTimer);
      const entry = retained.get(modelKey);
      if (entry) entry.view = editor.saveViewState();
      editor.dispose();
      editorRef.current = null;
    };
    // The parent keys this component by workspace, file and edit/diff mode.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    const editor = editorRef.current;
    editor?.updateOptions({ fontSize: preferences.fontSize, wordWrap: preferences.wordWrap, fontFamily: preferences.fontFamily });
    const actionIds = { definition: 'editor.action.revealDefinition', rename: 'editor.action.rename', format: 'editor.action.formatDocument', completion: 'editor.action.triggerSuggest' };
    const bindings = editor ? Object.entries(preferences.shortcuts).map(([key, value]) => {
      const binding = shortcutBinding(value);
      return editor.addAction({ id: `galeata.shortcut.${key}`, label: ({ definition: 'Aller à la définition', rename: 'Renommer le symbole', format: 'Formater le document', completion: 'Compléter le code' } as Record<string, string>)[key], keybindings: binding ? [binding] : [], run: async () => { await editor.getAction(actionIds[key as keyof typeof actionIds])?.run(); } });
    }) : [];
    editorRef.current?.getModel()?.updateOptions({ tabSize: preferences.tabSize });
    let disposed = false;
    if (desktop) void loadEditorConfig(file.path, async path => (await request<{ content: string }>('workspace.read', { path })).content).then(config => {
      if (disposed) return;
      const size = Number(config.indent_size === 'tab' ? config.tab_width : config.indent_size);
      editorRef.current?.getModel()?.updateOptions({ tabSize: Number.isFinite(size) && size > 0 && size <= 16 ? size : preferences.tabSize, insertSpaces: config.indent_style !== 'tab' });
    });
    return () => { disposed = true; bindings.forEach(binding => binding.dispose()); };
  }, [preferences]);
  useEffect(() => {
    const editor = editorRef.current;
    if (editor && file.content !== editor.getValue()) editor.setValue(file.content);
  }, [file.content]);
  useEffect(() => {
    const model = editorRef.current?.getModel();
    if (model) monaco.editor.setModelLanguage(model, file.language);
  }, [file.language]);
  useEffect(() => {
    if (diff) return;
    let disposed = false;
    const editor = editorRef.current;
    const decorations = editor?.createDecorationsCollection();
    const timer = setTimeout(() => {
      void request<{ patch: string; original: string }>('git.editor_diff', { path: file.path }).then(result => {
        if (disposed || !editor) return;
        const markers = changeMarkers(result.patch);
        if (!result.original && !markers.length && file.content)
          markers.push({ line: 1, end: file.content.split('\n').length, kind: 'added', detail: file.content });
        const lastLine = editor.getModel()?.getLineCount() ?? 1;
        for (const marker of markers) {
          marker.line = Math.min(marker.line, lastLine);
          marker.end = Math.min(marker.end, lastLine);
        }
        markersRef.current = markers;
        const labels = { added: 'Code ajouté', modified: 'Code modifié', deleted: 'Code supprimé' };
        decorations?.set(markers.map(marker => ({
          range: new monaco.Range(marker.line, 1, marker.end, 1),
          options: { glyphMarginClassName: `change-marker change-${marker.kind}`,
            glyphMarginHoverMessage: { value: `${labels[marker.kind]} — cliquer pour le détail` } },
        })));
      }).catch(() => { /* A non-Git file has no comparison baseline. */ });
    }, 250);
    return () => { disposed = true; clearTimeout(timer); decorations?.clear(); };
  }, [file.path, file.content, diff]);
  useEffect(() => {
    if (line && editorRef.current) {
      editorRef.current.revealLineInCenter(line);
      editorRef.current.setPosition({ lineNumber: line, column: column ?? 1 });
      editorRef.current.focus();
    }
  }, [line, column, revealRequest]);
  return <><div className="editor-surface" ref={container} aria-label={`Éditeur ${file.path}`} />
    {detail !== null ? <ModalDialog className="editor-change-detail" title="Détail de la modification" closeLabel="Fermer le détail" onClose={() => setDetail(null)}><pre>{detail}</pre></ModalDialog> : null}</>;
}
