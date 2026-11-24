import { useEffect, useRef } from 'react';
import * as monaco from 'monaco-editor';
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import TypeScriptWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';
import JsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker';
import type { OpenFile } from '../types.ts';

(self as unknown as { MonacoEnvironment: monaco.Environment }).MonacoEnvironment = { getWorker(_id: string, label: string) {
  if (label === 'typescript' || label === 'javascript') return new TypeScriptWorker();
  if (label === 'json') return new JsonWorker();
  return new EditorWorker();
} };
monaco.editor.defineTheme('galeata', {
  base: 'vs-dark', inherit: true,
  rules: [{ token: 'comment', foreground: '69758D', fontStyle: 'italic' }, { token: 'keyword', foreground: 'BFA9F6' }, { token: 'string', foreground: '9CCAB3' }, { token: 'number', foreground: 'E5B88A' }],
  colors: { 'editor.background': '#141620', 'editor.foreground': '#CDD3E3', 'editorLineNumber.foreground': '#4B5369', 'editorLineNumber.activeForeground': '#BFA9F6', 'editor.lineHighlightBackground': '#1B1E2C', 'editor.selectionBackground': '#BFA9F62C', 'editorCursor.foreground': '#BFA9F6', 'editorIndentGuide.background1': '#252938', 'editorWidget.background': '#1B1E2C', 'editorOverviewRuler.border': '#141620' },
});

export default function EditorSurface({ file, diff, onChange, onSave, line }: { file: OpenFile; diff?: { original: string; modified: string }; onChange: (content: string) => void; onSave: () => void; line?: number }) {
  const container = useRef<HTMLDivElement>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const changeRef = useRef(onChange); const saveRef = useRef(onSave);
  changeRef.current = onChange; saveRef.current = onSave;
  useEffect(() => {
    if (!container.current) return;
    const options: monaco.editor.IStandaloneEditorConstructionOptions = { theme: 'galeata', automaticLayout: true, fontSize: 13, fontFamily: '"JetBrains Mono", "Cascadia Code", "DejaVu Sans Mono", monospace', lineHeight: 23, padding: { top: 22 }, minimap: { enabled: false }, scrollBeyondLastLine: false, smoothScrolling: true, tabSize: 2, renderLineHighlight: 'line', wordWrap: 'off', bracketPairColorization: { enabled: true } };
    if (diff) {
      const original = monaco.editor.createModel(diff.original, file.language);
      const modified = monaco.editor.createModel(diff.modified, file.language);
      const editor = monaco.editor.createDiffEditor(container.current, { ...options, readOnly: true, renderSideBySide: true });
      editor.setModel({ original, modified });
      return () => { editor.dispose(); original.dispose(); modified.dispose(); };
    }
    const model = monaco.editor.createModel(file.content, file.language);
    const editor = monaco.editor.create(container.current, { ...options, model }); editorRef.current = editor;
    const listener = model.onDidChangeContent(() => changeRef.current(model.getValue()));
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => saveRef.current());
    return () => { listener.dispose(); editor.dispose(); model.dispose(); editorRef.current = null; };
    // The parent keys this component by workspace, file and edit/diff mode.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    const editor = editorRef.current;
    if (editor && file.content !== editor.getValue()) editor.setValue(file.content);
  }, [file.content]);
  useEffect(() => { if (line && editorRef.current) { editorRef.current.revealLineInCenter(line); editorRef.current.setPosition({ lineNumber: line, column: 1 }); } }, [line]);
  return <div className="editor-surface" ref={container} aria-label={`Éditeur ${file.path}`} />;
}
