import type { LanguageCapabilities, LanguageToolStatus } from './languageTypes.ts';
import type { TextEdit } from './editorEdits.ts';
import { importReferences, relativeImportCandidates, type ImportReference } from './importNavigation.ts';
import * as monaco from 'monaco-editor';
import { languageExtensions } from './domain.ts';
import { request, desktop } from './api.ts';
const registrations: monaco.IDisposable[] = [];
const importCache = new WeakMap<monaco.editor.ITextModel, { version: number; references: ImportReference[] }>();
function referencesFor(model: monaco.editor.ITextModel): ImportReference[] {
  const version = model.getVersionId(), cached = importCache.get(model);
  if (cached?.version === version) return cached.references;
  const references = importReferences(model.getValue()); importCache.set(model, { version, references }); return references;
}
let root = '';
let open: (path: string, line?: number, column?: number) => void = () => {};
const unavailable = new Set<string>();
const capabilities = new Map<string, LanguageCapabilities>();
const synchronized = new Map<string, number>();
const diagnosticItems = new Map<string, unknown[]>();
const navigationModels = new Map<string, monaco.editor.ITextModel>();
window.addEventListener('galeata:open-models', event => {
  const paths = (event as CustomEvent<string[]>).detail;
  if (desktop) for (const model of monaco.editor.getModels()) {
    if (!model.uri.path.startsWith(root + '/')) continue;
    const path = model.uri.path.slice(root.length + 1), uri = model.uri.toString();
    if (synchronized.has(uri) && !paths.some(key => key.endsWith(':' + path))) {
      synchronized.delete(uri); diagnosticItems.delete(uri);
      void request('language.request', { language: model.getLanguageId(), method: 'close', path }).catch(() => {});
    }
  }
  for (const [uri, model] of navigationModels) {
    const relative = model.uri.path.slice(root.length + 1);
    if (!paths.some(key => key.endsWith(':' + relative))) { model.dispose(); navigationModels.delete(uri); }
  }
});
export function getModelDiagnostics(model: monaco.editor.ITextModel): unknown[] { return diagnosticItems.get(model.uri.toString()) ?? []; }
const supported = Object.keys(languageExtensions).filter(language => language !== 'plaintext');
const position = (p: monaco.Position) => ({ line: p.lineNumber - 1, character: p.column - 1 });
interface LspRange { start: { line: number; character: number }; end: { line: number; character: number } }
interface Location { uri?: string; targetUri?: string; range?: LspRange; targetSelectionRange?: LspRange }
const range = (r: LspRange): monaco.IRange => ({ startLineNumber: r.start.line + 1, startColumn: r.start.character + 1, endLineNumber: r.end.line + 1, endColumn: r.end.character + 1 });
async function call(model: monaco.editor.ITextModel, method: string, params: object = {}): Promise<any> {
  const language = model.getLanguageId();
  const cacheKey = `${language}:${model.uri.path.slice(0, model.uri.path.lastIndexOf('/'))}`;
  if (!desktop || !root || !model.uri.path.startsWith(root + '/') || unavailable.has(cacheKey)) return null;
  const projectRoot = root;
  const version = model.getVersionId();
  const content = model.getValue();
  const inspected = new Map<monaco.editor.ITextModel, number>([[model, version]]);
  const path = model.uri.path.slice(root.length + 1);
  try {
    if (!capabilities.has(cacheKey)) {
      const status = await request<LanguageToolStatus>('language.status', { language, path });
      window.dispatchEvent(new CustomEvent('galeata:language-info', { detail: { language, message: status.program ? `${status.program} · ${status.installed ? 'disponible' : 'à installer'}` : 'Serveur à configurer pour les fonctions sémantiques' } }));
      if (!status.installed) { unavailable.add(cacheKey); return null; }
      capabilities.set(cacheKey, await request<LanguageCapabilities>('language.request', { language, method: 'capabilities', path }));
    }
    const capability: Record<string, string> = { 'textDocument/definition':'definitionProvider', 'textDocument/implementation':'implementationProvider',
      'textDocument/rename':'renameProvider', 'textDocument/codeAction':'codeActionProvider', 'workspace/symbol':'workspaceSymbolProvider', 'textDocument/references':'referencesProvider', 'textDocument/hover':'hoverProvider', 'textDocument/completion':'completionProvider',
      'textDocument/signatureHelp':'signatureHelpProvider', 'textDocument/documentSymbol':'documentSymbolProvider',
      'textDocument/formatting':'documentFormattingProvider', 'textDocument/rangeFormatting':'documentRangeFormattingProvider' };
    if (root !== projectRoot || (capability[method] && !capabilities.get(cacheKey)?.[capability[method]])) return null;
    if (method !== 'diagnostics') {
      const family = (value: string) => ['typescript','javascript'].includes(value) ? 'typescript' : value;
      for (const document of monaco.editor.getModels()) {
        if (document === model || !document.uri.path.startsWith(root + '/') || family(document.getLanguageId()) !== family(language)) continue;
        const currentVersion = document.getVersionId();
        inspected.set(document, currentVersion);
        if (synchronized.get(document.uri.toString()) === currentVersion) continue;
        await request('language.request', { language: document.getLanguageId(), method: 'diagnostics', path: document.uri.path.slice(root.length + 1), content: document.getValue() });
        synchronized.set(document.uri.toString(), currentVersion);
      }
    }
    if (root !== projectRoot || model.isDisposed() || model.getVersionId() !== version) return null;
    const result = await request('language.request', { language, method, path, content, params });
    if (root !== projectRoot || model.isDisposed() || model.getVersionId() !== version) return null;
    if ([...inspected].some(([document, version]) => document.isDisposed() || document.getVersionId() !== version)) return null;
    synchronized.set(model.uri.toString(), version);
    return result;
  } catch (error) {
    if (root !== projectRoot) return null;
    unavailable.add(cacheKey);
    window.dispatchEvent(new CustomEvent('galeata:language-status', { detail: String(error) }));
    return null;
  }
}
async function locations(value: Location | Location[] | null): Promise<monaco.languages.Location[]> {
  const result = (Array.isArray(value) ? value : value ? [value] : []).flatMap(item => {
    const uri = item.uri ?? item.targetUri;
    const r = item.range ?? item.targetSelectionRange;
    return uri && r ? [{ uri: monaco.Uri.parse(uri), range: range(r) }] : [];
  });
  for (const location of result.slice(0, 20)) {
    if (monaco.editor.getModel(location.uri) || !location.uri.path.startsWith(root + '/') || navigationModels.size >= 32) continue;
    const project = root;
    try {
      const path = location.uri.path.slice(root.length + 1);
      const file = await request<{ content: string }>('workspace.read', { path });
      if (root !== project || monaco.editor.getModel(location.uri)) continue;
      const { languageFor } = await import('./domain.ts');
      const model = monaco.editor.createModel(file.content, languageFor(path, file.content), location.uri);
      navigationModels.set(location.uri.toString(), model);
    } catch { /* A deleted or inaccessible reference still has its navigable location. */ }
  }
  return result;
}
export function prepareLanguageProject(projectRoot: string) {
  if (root !== projectRoot) { root = projectRoot; unavailable.clear(); capabilities.clear(); synchronized.clear(); diagnosticItems.clear(); }
 }
export function configureLanguageProject(projectRoot: string, onOpen: typeof open) {
  prepareLanguageProject(projectRoot); open = onOpen;
}
export function restartLanguageServices() { unavailable.clear(); capabilities.clear(); synchronized.clear(); diagnosticItems.clear(); }
export async function openImportAtPosition(model: monaco.editor.ITextModel, at: monaco.Position): Promise<boolean> {
  if (!['typescript', 'javascript'].includes(model.getLanguageId())) return false;
  const offset = model.getOffsetAt(at);
  const reference = referencesFor(model).find(reference => offset >= reference.start && offset <= reference.end);
  if (!reference) return false;
  const [definition] = await importDefinition(model, reference);
  if (definition?.uri.path.startsWith(root + '/')) open(definition.uri.path.slice(root.length + 1), definition.range.startLineNumber, definition.range.startColumn);
  return true;
}
async function importDefinition(model: monaco.editor.ITextModel, reference: ImportReference): Promise<monaco.languages.Location[]> {
  const project = root, version = model.getVersionId();
  const binding = reference.bindingOffset === undefined ? undefined : model.getPositionAt(reference.bindingOffset);
  if (binding) {
    const resolved = await locations(await call(model, 'textDocument/definition', { position: position(binding) }));
    const definitions = resolved.filter(location => location.uri.toString() !== model.uri.toString() || !monaco.Range.containsPosition(location.range, binding));
    if (root === project && !model.isDisposed() && model.getVersionId() === version && definitions.length) return definitions;
  }
  if (!project || model.isDisposed() || model.getVersionId() !== version) return [];
  for (const path of relativeImportCandidates(model.uri.path.slice(project.length + 1), reference.specifier)) {
    const uri = monaco.Uri.file(`${project}/${path}`);
    let target = monaco.editor.getModel(uri);
    if (!target) {
      try {
        const file = await request<{ content: string }>('workspace.read', { path });
        if (root !== project || model.isDisposed() || model.getVersionId() !== version) return [];
        target = monaco.editor.getModel(uri);
        if (!target) {
          const { languageFor } = await import('./domain.ts');
          target = monaco.editor.createModel(file.content, languageFor(path, file.content), uri);
          navigationModels.set(uri.toString(), target);
        }
      } catch { continue; }
    }
    if (binding && ['typescript', 'javascript'].includes(target.getLanguageId())) {
      const factory = await (model.getLanguageId() === 'typescript' ? monaco.languages.typescript.getTypeScriptWorker() : monaco.languages.typescript.getJavaScriptWorker());
      const worker = await factory(model.uri, target.uri);
      const definitions = await worker.getDefinitionAtPosition(model.uri.toString(), reference.bindingOffset!);
      for (const definition of definitions ?? []) {
        const definitionUri = definition.fileName.startsWith('file:') ? monaco.Uri.parse(definition.fileName) : monaco.Uri.file(definition.fileName);
        const destination = monaco.editor.getModel(definitionUri);
        if (!destination || !definitionUri.path.startsWith(project + '/') || definitionUri.toString() === model.uri.toString()) continue;
        const start = destination.getPositionAt(definition.textSpan.start), end = destination.getPositionAt(definition.textSpan.start + definition.textSpan.length);
        if (root !== project || model.isDisposed() || model.getVersionId() !== version) return [];
        return [{ uri: definitionUri, range: new monaco.Range(start.lineNumber, start.column, end.lineNumber, end.column) }];
      }
    }
    return [{ uri, range: new monaco.Range(1, 1, 1, 1) }];
  }
  return [];
}
export async function requestCodeOperation(model: monaco.editor.ITextModel, method: string, params: object = {}) { return call(model, method, params); }
export function previewLanguageEdit(title: string, edit: unknown) {
  window.dispatchEvent(new CustomEvent('galeata:workspace-edit', { detail: { title, edit, snapshots: Object.fromEntries(monaco.editor.getModels().filter(model => model.uri.path.startsWith(root + '/')).map(model => [model.uri.path.slice(root.length + 1), model.getValue()])) } }));
}
export function symbolList(value: any[], model: monaco.editor.ITextModel): { name: string; path: string; line: number }[] {
  const result: { name: string; path: string; line: number }[] = [];
  function visit(items: any[]) {
    for (const item of items ?? []) {
      const uri = item.location?.uri ? monaco.Uri.parse(item.location.uri) : model.uri;
      const selection = item.selectionRange ?? item.range ?? item.location?.range;
      if (selection && uri.path.startsWith(root + '/')) result.push({ name: item.name, path: uri.path.slice(root.length + 1), line: selection.start.line + 1 });
      if (item.children) visit(item.children);
    }
  }
  visit(value); return result;
}
interface NativeFormatter { format(uri: string, range: unknown, options: object): Promise<TextEdit[]> }
const nativeFormatters = new Map<string, { worker: monaco.editor.MonacoWebWorker<NativeFormatter>; used: number }>();
export async function formatLanguageModel(model: monaco.editor.ITextModel, options: { tabSize: number; insertSpaces: boolean }, selection?: monaco.IRange): Promise<TextEdit[] | null> {
  const content = model.getValue(), version = model.getVersionId();
  const convert = (p: monaco.Position) => ({ line: p.lineNumber - 1, character: p.column - 1 });
  const selectedRange = selection ? { start: { line: selection.startLineNumber - 1, character: selection.startColumn - 1 }, end: { line: selection.endLineNumber - 1, character: selection.endColumn - 1 } } : undefined;
  if (desktop && !selection) {
    const formatted = await request<string | null>('language.format', { language: model.getLanguageId(), path: model.uri.path.slice(root.length + 1), content });
    if (model.isDisposed() || model.getVersionId() !== version) return null;
    if (typeof formatted === 'string') return [{ range: { start: { line: 0, character: 0 }, end: convert(model.getPositionAt(content.length)) }, newText: formatted }];
  }
  const edits = await call(model, selection ? 'textDocument/rangeFormatting' : 'textDocument/formatting', { options, range: selectedRange });
  if (model.isDisposed() || model.getVersionId() !== version) return null;
  if (Array.isArray(edits)) return edits;
  const language = model.getLanguageId();
  if (['typescript','javascript'].includes(language)) {
    const factory = await (language === 'typescript' ? monaco.languages.typescript.getTypeScriptWorker() : monaco.languages.typescript.getJavaScriptWorker());
    const worker = await factory(model.uri);
    const settings = { tabSize: options.tabSize, indentSize: options.tabSize, convertTabsToSpaces: options.insertSpaces, newLineCharacter: '\n', insertSpaceAfterCommaDelimiter: true, insertSpaceAfterSemicolonInForStatements: true, insertSpaceBeforeAndAfterBinaryOperators: true, insertSpaceAfterKeywordsInControlFlowStatements: true, insertSpaceAfterFunctionKeywordForAnonymousFunctions: true };
    const native = selection ? await worker.getFormattingEditsForRange(model.uri.toString(), model.getOffsetAt(new monaco.Position(selection.startLineNumber, selection.startColumn)), model.getOffsetAt(new monaco.Position(selection.endLineNumber, selection.endColumn)), settings) : await worker.getFormattingEditsForDocument(model.uri.toString(), settings);
    if (model.isDisposed() || model.getVersionId() !== version) return null;
    return native.map(edit => ({ range: { start: convert(model.getPositionAt(edit.span.start)), end: convert(model.getPositionAt(edit.span.start + edit.span.length)) }, newText: edit.newText }));
  }
  if (['json','css','scss','less','html'].includes(language)) {
    const family = ['css','scss','less'].includes(language) ? 'css' : language;
    let entry = nativeFormatters.get(language);
    if (!entry) {
      const worker = monaco.editor.createWebWorker<NativeFormatter>({ moduleId: `vs/language/${family}/${family}Worker`, label: language, createData: { languageId: language, options: {}, languageSettings: {} } });
      entry = { worker, used: Date.now() }; nativeFormatters.set(language, entry);
    }
    entry.used = Date.now();
    const proxy = await entry.worker.withSyncedResources([model.uri]);
    const native = await proxy.format(model.uri.toString(), selectedRange ?? null, options);
    if (model.isDisposed() || model.getVersionId() !== version) return null;
    return native;
  }
  return null;
}
export function installLanguageProviders() {
  if (registrations.length) return;
  const timer = setInterval(() => { for (const [language, entry] of nativeFormatters) if (Date.now() - entry.used > 60000) { entry.worker.dispose(); nativeFormatters.delete(language); } }, 30000);
  registrations.push({ dispose: () => clearInterval(timer) });
  for (const language of supported) {
    if (['javascript', 'typescript'].includes(language)) registrations.push(monaco.languages.registerLinkProvider(language, {
      provideLinks: model => ({ links: referencesFor(model).map(reference => {
        const start = model.getPositionAt(reference.start), end = model.getPositionAt(reference.end);
        return { range: new monaco.Range(start.lineNumber, start.column, end.lineNumber, end.column), url: `galeata-import:${encodeURIComponent(model.uri.toString())}?at=${reference.start}&v=${model.getVersionId()}`, tooltip: 'Ouvrir la déclaration importée' };
      }) }),
    }));
    registrations.push(monaco.languages.registerRenameProvider(language, {
      provideRenameEdits: async (model, p, newName) => {
        const edit = await call(model, 'textDocument/rename', { position: position(p), newName });
        if (!edit) return { edits: [], rejectReason: 'Renommage indisponible : vérifiez le serveur de langage.' };
        previewLanguageEdit(`Renommer en ${newName}`, edit);
        return { edits: [] };
      },
    }));
    registrations.push(monaco.languages.registerCodeActionProvider(language, {
      provideCodeActions: async (model, selection, context) => {
        const actions = await call(model, 'textDocument/codeAction', { range: {
          start: { line: selection.startLineNumber - 1, character: selection.startColumn - 1 },
          end: { line: selection.endLineNumber - 1, character: selection.endColumn - 1 },
        }, context: { diagnostics: getModelDiagnostics(model), only: context.only ? [context.only] : undefined } });
        return { actions: (Array.isArray(actions) ? actions : []).filter((action: any) => !action.disabled && (action.edit || action.data)).map((action: any) => ({
          title: action.title, kind: action.kind, command: { id: 'galeata.previewCodeAction', title: action.title, arguments: [model.uri.toString(), action] },
        })), dispose() {} };
      },
    }));
    registrations.push(monaco.languages.registerDefinitionProvider(language, {
      provideDefinition: async (model, p) => {
        if (['javascript', 'typescript'].includes(language)) {
          const offset = model.getOffsetAt(p);
          const reference = referencesFor(model).find(reference => offset >= reference.start && offset <= reference.end);
          if (reference) return importDefinition(model, reference);
        }
        return locations(await call(model, 'textDocument/definition', { position: position(p) }));
      },
    }));
    registrations.push(monaco.languages.registerImplementationProvider(language, {
      provideImplementation: async (model, p) => locations(await call(model, 'textDocument/implementation', { position: position(p) })),
    }));
    registrations.push(monaco.languages.registerReferenceProvider(language, {
      provideReferences: async (model, p, context) => locations(await call(model, 'textDocument/references', { position: position(p), context })),
    }));
    registrations.push(monaco.languages.registerHoverProvider(language, {
      provideHover: async (model, p) => {
        const result = await call(model, 'textDocument/hover', { position: position(p) });
        if (!result?.contents) return null;
        const values = Array.isArray(result.contents) ? result.contents : [result.contents];
        return { contents: values.map((value: string | { value: string }) => ({ value: typeof value === 'string' ? value : value.value, isTrusted: false })), range: result.range ? range(result.range) : undefined };
      },
    }));
    registrations.push(monaco.languages.registerCompletionItemProvider(language, {
      triggerCharacters: ['.', ':'],
      provideCompletionItems: async (model, p) => {
        const result = await call(model, 'textDocument/completion', { position: position(p) });
        const word = model.getWordUntilPosition(p);
        const fallback = new monaco.Range(p.lineNumber, word.startColumn, p.lineNumber, word.endColumn);
        const items = Array.isArray(result) ? result : result?.items ?? [];
        return { suggestions: items.map((item: any) => ({ label: item.label, detail: item.detail,
          kind: ([monaco.languages.CompletionItemKind.Text, monaco.languages.CompletionItemKind.Method, monaco.languages.CompletionItemKind.Function, monaco.languages.CompletionItemKind.Constructor, monaco.languages.CompletionItemKind.Field, monaco.languages.CompletionItemKind.Variable, monaco.languages.CompletionItemKind.Class, monaco.languages.CompletionItemKind.Interface, monaco.languages.CompletionItemKind.Module, monaco.languages.CompletionItemKind.Property, monaco.languages.CompletionItemKind.Unit, monaco.languages.CompletionItemKind.Value, monaco.languages.CompletionItemKind.Enum, monaco.languages.CompletionItemKind.Keyword, monaco.languages.CompletionItemKind.Snippet, monaco.languages.CompletionItemKind.Color, monaco.languages.CompletionItemKind.File, monaco.languages.CompletionItemKind.Reference, monaco.languages.CompletionItemKind.Folder, monaco.languages.CompletionItemKind.EnumMember, monaco.languages.CompletionItemKind.Constant, monaco.languages.CompletionItemKind.Struct, monaco.languages.CompletionItemKind.Event, monaco.languages.CompletionItemKind.Operator, monaco.languages.CompletionItemKind.TypeParameter][(item.kind ?? 1) - 1] ?? monaco.languages.CompletionItemKind.Text), insertText: item.textEdit?.newText ?? item.insertText ?? item.label,
          range: item.textEdit?.range ? range(item.textEdit.range) : fallback,
          documentation: typeof item.documentation === 'string' ? item.documentation : item.documentation?.value,
          sortText: item.sortText, filterText: item.filterText,
          additionalTextEdits: item.additionalTextEdits?.map((edit: any) => ({ range: range(edit.range), text: edit.newText })),
        })) };
      },
    }));
    registrations.push(monaco.languages.registerSignatureHelpProvider(language, {
      signatureHelpTriggerCharacters: ['(', ','],
      provideSignatureHelp: async (model, p) => {
        const result = await call(model, 'textDocument/signatureHelp', { position: position(p) });
        return result ? { value: { ...result, activeSignature: result.activeSignature ?? 0, activeParameter: result.activeParameter ?? 0 }, dispose() {} } : null;
      },
    }));
    registrations.push(monaco.languages.registerDocumentSymbolProvider(language, {
      provideDocumentSymbols: async model => {
        const result = await call(model, 'textDocument/documentSymbol');
        const convert = (item: any): monaco.languages.DocumentSymbol => ({
          name: item.name, detail: item.detail ?? '', kind: Math.max(0, item.kind - 1), tags: [],
          range: range(item.range ?? item.location.range), selectionRange: range(item.selectionRange ?? item.range ?? item.location.range),
          children: item.children?.map(convert),
        });
        return Array.isArray(result) ? result.map(convert) : [];
      },
    }));
    registrations.push(monaco.languages.registerDocumentRangeFormattingEditProvider(language, {
      provideDocumentRangeFormattingEdits: async (model, selection, options) => {
        const edits = await formatLanguageModel(model, options, selection);
        return edits?.map(edit => ({ range: range(edit.range), text: edit.newText })) ?? [];
      },
    }));
    registrations.push(monaco.languages.registerDocumentFormattingEditProvider(language, {
      provideDocumentFormattingEdits: async (model, options) => {
        const edits = await formatLanguageModel(model, options);
        return edits?.map(edit => ({ range: range(edit.range), text: edit.newText })) ?? [];
      },
    }));
  }
  registrations.push(monaco.editor.registerCommand('galeata.previewCodeAction', async (_accessor, uri: string, action: any) => {
    const model = monaco.editor.getModel(monaco.Uri.parse(uri));
    if (!model) return;
    const resolved = action.edit ? action : await call(model, 'codeAction/resolve', action);
    if (resolved?.edit) previewLanguageEdit(resolved.title, resolved.edit);
  }));
  registrations.push(monaco.editor.registerLinkOpener({ open: async resource => {
    if (resource.scheme !== 'galeata-import') return false;
    const source = monaco.Uri.parse(decodeURIComponent(resource.path));
    const model = monaco.editor.getModel(source);
    const query = new URLSearchParams(resource.query);
    if (!model || model.getVersionId() !== Number(query.get('v'))) return true;
    const reference = referencesFor(model).find(reference => reference.start === Number(query.get('at')));
    if (!reference) return true;
    const [definition] = await importDefinition(model, reference);
    if (definition?.uri.path.startsWith(root + '/')) open(definition.uri.path.slice(root.length + 1), definition.range.startLineNumber, definition.range.startColumn);
    return true;
  } }));
  registrations.push(monaco.editor.registerEditorOpener({
    openCodeEditor: (_source, resource, selection) => {
      if (resource.scheme !== 'file' || !resource.path.startsWith(root + '/')) return false;
      open(resource.path.slice(root.length + 1), selection && 'startLineNumber' in selection ? selection.startLineNumber : selection?.lineNumber, selection && 'startColumn' in selection ? selection.startColumn : selection?.column);
      return true;
    },
  }));
}

const diagnosing = new Set<string>();
export async function updateLanguageDiagnostics(model: monaco.editor.ITextModel) {
  const key = model.uri.toString();
  if (!supported.includes(model.getLanguageId()) || diagnosing.has(key)) return;
  diagnosing.add(key);
  const version = model.getVersionId();
  const diagnostics = await call(model, 'diagnostics').finally(() => diagnosing.delete(key));
  if (model.isDisposed() || model.getVersionId() !== version || !Array.isArray(diagnostics)) return;
  diagnosticItems.set(key, diagnostics);
  monaco.editor.setModelMarkers(model, 'galeata-language', diagnostics.map((item: any) => ({
    ...range(item.range), message: item.message, source: item.source,
    severity: item.severity === 1 ? monaco.MarkerSeverity.Error : item.severity === 2 ? monaco.MarkerSeverity.Warning : item.severity === 4 ? monaco.MarkerSeverity.Hint : monaco.MarkerSeverity.Info,
  })));
}
