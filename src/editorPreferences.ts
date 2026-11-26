import { readUiNumber, readUiToken } from './uiTokens.ts';
export interface EditorPreferences {
  fontSize: number; tabSize: number; wordWrap: 'on' | 'off'; fontFamily: string; formatOnSave: boolean;
  shortcuts: { definition: string; rename: string; format: string; completion: string };
}
export const defaultEditorPreferences: EditorPreferences = {
  fontSize: readUiNumber('--editor-font-size'), tabSize: 2, wordWrap: 'off', fontFamily: readUiToken('--editor-font-family'), formatOnSave: false,
  shortcuts: { definition: 'F12', rename: 'F2', format: 'Alt+Shift+F', completion: 'Ctrl+Space' },
};
export function readEditorPreferences(project: string): EditorPreferences {
  try {
    const value = JSON.parse(localStorage.getItem(`galeata:editor-preferences:${project}`) ?? '{}');
    return { fontSize: Math.min(32, Math.max(10, Number(value.fontSize) || defaultEditorPreferences.fontSize)),
      tabSize: [2,4,8].includes(value.tabSize) ? value.tabSize : 2, wordWrap: value.wordWrap === 'on' ? 'on' : 'off',
      fontFamily: typeof value.fontFamily === 'string' && value.fontFamily.length < 256 ? value.fontFamily : defaultEditorPreferences.fontFamily,
      formatOnSave: value.formatOnSave === true,
      shortcuts: Object.fromEntries(Object.entries(defaultEditorPreferences.shortcuts).map(([key, fallback]) => [key, typeof value.shortcuts?.[key] === 'string' ? value.shortcuts[key] : fallback])) as EditorPreferences['shortcuts'],
    };
  } catch { return defaultEditorPreferences; }
}
