import type { Plan, StepStatus } from './types.ts';

export const statusLabels: Record<StepStatus, string> = {
  pending: 'À faire',
  in_progress: 'En cours',
  blocked: 'Bloqué',
  done: 'Terminé par l’auteur',
};
export const languageExtensions: Record<string, string[]> = {
  javascript: ['js','jsx','mjs','cjs'], typescript: ['ts','tsx','mts','cts'], python: ['py','pyw'],
  java: ['java'], c: ['c','h'], cpp: ['cpp','cc','cxx','hpp'], csharp: ['cs'], go: ['go'], rust: ['rs'],
  php: ['php'], ruby: ['rb','rake'], swift: ['swift'], kotlin: ['kt','kts'], dart: ['dart'], scala: ['scala','sc'],
  r: ['r'], julia: ['jl'], matlab: ['m'], lua: ['lua'], perl: ['pl','pm'], shell: ['sh','bash','zsh'],
  powershell: ['ps1','psm1'], sql: ['sql'], 'objective-c': ['mm'], groovy: ['groovy','gradle'], vb: ['vb'],
  fsharp: ['fs','fsx'], clojure: ['clj','edn'], elixir: ['ex','exs'], erlang: ['erl','hrl'], haskell: ['hs','lhs'],
  ocaml: ['ml','mli'], lisp: ['lisp','cl'], scheme: ['scm','ss'], racket: ['rkt'], clojurescript: ['cljs','cljc'],
  coffeescript: ['coffee'], crystal: ['cr'], nim: ['nim'], zig: ['zig'], d: ['d'], fortran: ['f','f90','f95'],
  cobol: ['cob','cbl'], ada: ['adb','ads'], pascal: ['pas','pp'], asm: ['asm','s'], solidity: ['sol'],
  vhdl: ['vhd','vhdl'], verilog: ['v','sv'], tcl: ['tcl'], html: ['html','htm'], css: ['css'], scss: ['scss'],
  less: ['less'], json: ['json','jsonc'], yaml: ['yml','yaml'], toml: ['toml'], xml: ['xml','svg','xsd'],
  markdown: ['md','mdx'], dockerfile: ['dockerfile'], makefile: ['mk'], vue: ['vue'], svelte: ['svelte'], plaintext: ['txt'],
};
export function languageFor(path: string, content = ''): string {
  const name = path.split('/').pop()?.toLowerCase() ?? '';
  if (name === 'dockerfile' || name.startsWith('dockerfile.')) return 'dockerfile';
  if (['makefile','gnumakefile'].includes(name)) return 'makefile';
  const extension = name.split('.').pop() ?? '';
  for (const [language, extensions] of Object.entries(languageExtensions))
    if (extensions.includes(extension)) return language;
  const shebang = content.split('\n', 1)[0];
  if (shebang.startsWith('#!')) {
    if (/python/.test(shebang)) return 'python';
    if (/node|deno|bun/.test(shebang)) return 'javascript';
    if (/ruby/.test(shebang)) return 'ruby';
    if (/perl/.test(shebang)) return 'perl';
    if (/bash|zsh|\bsh\b/.test(shebang)) return 'shell';
  }
  return 'plaintext';
}
export function progress(plan: Plan): number {
  return plan.steps.length
    ? Math.round(
        (plan.steps.filter((step) => step.status === 'done').length / plan.steps.length) * 100,
      )
    : 0;
}
export function nextStatus(status: StepStatus): StepStatus {
  return (
    {
      pending: 'in_progress',
      in_progress: 'done',
      done: 'pending',
      blocked: 'in_progress',
    } as const
  )[status];
}
export function relativeTime(timestamp: number): string {
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60000));
  if (minutes < 1) return 'à l’instant';
  if (minutes < 60) return `il y a ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `il y a ${hours} h` : `il y a ${Math.floor(hours / 24)} j`;
}
export interface PanelBounds {
  min: number;
  max: number;
}
// Keeps a dragged or restored panel size usable: never below min, never above max,
// and falls back to the default when the stored value is not a finite number.
export function clampSize(value: unknown, bounds: PanelBounds, fallback: number): number {
  const size = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  return Math.round(Math.min(bounds.max, Math.max(bounds.min, size)));
}
