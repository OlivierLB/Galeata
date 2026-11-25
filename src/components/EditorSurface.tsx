import { useEffect, useRef } from 'react';
import * as monaco from 'monaco-editor';
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import TypeScriptWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';
import JsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker';
import CssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker';
import HtmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker';
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

export default function EditorSurface({
  file,
  diff,
  onChange,
  onSave,
  line,
}: {
  file: OpenFile;
  /** With `editable`, the right side is the working file: changes and Ctrl+S apply to it. */
  diff?: { original: string; modified: string; editable?: boolean };
  onChange: (content: string) => void;
  onSave: () => void;
  line?: number;
}) {
  const container = useRef<HTMLDivElement>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const changeRef = useRef(onChange);
  const saveRef = useRef(onSave);
  changeRef.current = onChange;
  saveRef.current = onSave;
  useEffect(() => {
    if (!container.current) return;
    const options: monaco.editor.IStandaloneEditorConstructionOptions = {
      theme: document.documentElement.dataset.theme === 'night' ? 'galeata-night' : 'galeata',
      automaticLayout: true,
      fontSize: 13,
      fontFamily: '"JetBrains Mono", "Cascadia Code", "DejaVu Sans Mono", monospace',
      lineHeight: 23,
      padding: { top: 22 },
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      smoothScrolling: true,
      tabSize: 2,
      renderLineHighlight: 'line',
      wordWrap: 'off',
      bracketPairColorization: { enabled: true },
    };
    if (diff) {
      const original = monaco.editor.createModel(
        diff.original,
        file.language,
        monaco.Uri.parse(`inmemory://galeata/original/${encodeURIComponent(file.path)}`),
      );
      const modified = monaco.editor.createModel(
        diff.modified,
        file.language,
        monaco.Uri.parse(`inmemory://galeata/modified/${encodeURIComponent(file.path)}`),
      );
      const editor = monaco.editor.createDiffEditor(container.current, {
        ...options,
        readOnly: !diff.editable,
        originalEditable: false,
        renderSideBySide: true,
      });
      editor.setModel({ original, modified });
      const listener = diff.editable
        ? modified.onDidChangeContent(() => changeRef.current(modified.getValue()))
        : null;
      if (diff.editable)
        editor
          .getModifiedEditor()
          .addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => saveRef.current());
      return () => {
        listener?.dispose();
        editor.dispose();
        original.dispose();
        modified.dispose();
      };
    }
    const model = monaco.editor.createModel(
      file.content,
      file.language,
      monaco.Uri.parse(`inmemory://galeata/editor/${encodeURIComponent(file.path)}`),
    );
    const editor = monaco.editor.create(container.current, { ...options, model });
    editorRef.current = editor;
    const listener = model.onDidChangeContent(() => changeRef.current(model.getValue()));
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => saveRef.current());
    return () => {
      listener.dispose();
      editor.dispose();
      model.dispose();
      editorRef.current = null;
    };
    // The parent keys this component by workspace, file and edit/diff mode.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    const editor = editorRef.current;
    if (editor && file.content !== editor.getValue()) editor.setValue(file.content);
  }, [file.content]);
  useEffect(() => {
    if (line && editorRef.current) {
      editorRef.current.revealLineInCenter(line);
      editorRef.current.setPosition({ lineNumber: line, column: 1 });
    }
  }, [line]);
  return <div className="editor-surface" ref={container} aria-label={`Éditeur ${file.path}`} />;
}
