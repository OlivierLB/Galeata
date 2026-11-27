export interface LanguageToolConfiguration {
  command?: string;
  args?: string[];
  rootMarkers?: string[];
  settings?: Record<string, unknown>;
  initializationOptions?: unknown;
  formatter?: { command: string; args: string[] };
}
export type LanguageConfiguration = Record<string, LanguageToolConfiguration>;
export interface LanguageCapabilities {
  [capability: string]: unknown;
  definitionProvider?: boolean | object;
  referencesProvider?: boolean | object;
  completionProvider?: { triggerCharacters?: string[]; resolveProvider?: boolean };
  renameProvider?: boolean | { prepareProvider?: boolean };
  codeActionProvider?: boolean | { resolveProvider?: boolean };
  documentFormattingProvider?: boolean | object;
  documentRangeFormattingProvider?: boolean | object;
}
export interface LanguageToolStatus {
  language: string;
  program: string | null;
  installed: boolean;
  formatter: string | null;
}
