import * as monaco from 'monaco-editor';
import { languageExtensions } from './domain.ts';
// Supplement Monaco's bundled grammars for less common languages. These grammars
// provide lexical editing; semantic features always come from a language server.
const words: Record<string, string> = {
  matlab: 'function end if else elseif for while switch case otherwise try catch return break continue classdef properties methods',
  ocaml: 'let rec in match with type module struct end fun function if then else begin exception try open include val mutable',
  lisp: 'defun defmacro defvar defparameter let let* lambda if cond progn setq quote function loop do dolist dotimes car cdr cons list nil t',
  c: 'auto break case char const continue default do double else enum extern float for goto if inline int long register restrict return short signed sizeof static struct switch typedef union unsigned void volatile while',
  racket: 'define lambda let let* letrec cond if else begin set! quote require provide module struct match',
  clojurescript: 'def defn fn let if when cond do loop recur ns require true false nil',
  crystal: 'class module def end if elsif else unless while until do return yield require include extend struct enum',
  nim: 'proc func method iterator template macro type object ref var let const if elif else when for while case of return import from',
  zig: 'const var fn pub export extern struct enum union opaque if else switch while for return try catch defer errdefer comptime',
  d: 'module import class struct interface union enum template mixin auto immutable shared const void int if else while for foreach return',
  fortran: 'program module subroutine function end implicit none integer real complex logical character type do if then else select case call return use',
  cobol: 'IDENTIFICATION DIVISION PROGRAM-ID ENVIRONMENT DATA WORKING-STORAGE PROCEDURE SECTION MOVE TO PERFORM UNTIL IF ELSE END-IF DISPLAY ACCEPT STOP RUN',
  ada: 'with use package body procedure function begin end is type subtype record array access declare if then elsif else loop for while return exception when',
  asm: 'mov lea push pop call ret jmp je jne jz jnz cmp test add sub mul div and or xor nop section global extern db dw dd dq',
  tcl: 'proc set unset if elseif else switch for foreach while break continue return namespace variable global source package',
  toml: 'true false',
  makefile: 'include ifeq ifneq ifdef ifndef else endif define endef export override private vpath',
  vue: 'template script style setup export default import from const let function return',
  svelte: 'script style if else each await then catch import from export let const function return',
};
export function installAdditionalLanguages() {
  const available = new Set(monaco.languages.getLanguages().map(item => item.id));
  for (const id of Object.keys(languageExtensions)) {
    if (available.has(id)) continue;
    monaco.languages.register({ id, extensions: languageExtensions[id].map(extension => `.${extension}`) });
    const lisp = ['lisp','racket','clojurescript'].includes(id);
    const lineComment = lisp || id === 'asm' ? ';' : ['nim','crystal','toml','makefile','tcl'].includes(id) ? '#' : ['ada','vhdl'].includes(id) ? '--' : id === 'matlab' ? '%' : id === 'fortran' ? '!' : id === 'cobol' ? '*>' : '//';
    monaco.languages.setLanguageConfiguration(id, {
      comments: { lineComment }, brackets: [['{','}'],['[',']'],['(',')']],
      autoClosingPairs: [{ open:'(', close:')' },{ open:'[', close:']' },{ open:'{', close:'}' },{ open:'"', close:'"' },{ open:"'", close:"'" }],
    });
    const comment = new RegExp(lineComment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '.*$');
    monaco.languages.setMonarchTokensProvider(id, {
      ignoreCase: ['cobol','fortran','ada','pascal'].includes(id),
      keywords: (words[id] ?? '').toLowerCase().split(' '),
      tokenizer: { root: [
        [comment, 'comment'], [/\/\*/, 'comment', '@comment'],
        [/"([^"\\]|\\.)*"/, 'string'], [/'([^'\\]|\\.)*'/, 'string'],
        [/\b(?:0[xX][0-9a-fA-F]+|\d+(?:\.\d+)?)\b/, 'number'],
        [/[a-zA-Z_$][\w$!-]*/, { cases: { '@keywords':'keyword', '@default':'identifier' } }],
        [/[{}()[\]]/, '@brackets'], [/[+*=<>!&|:-]+/, 'operator'],
      ], comment: [[/[^*]+/,'comment'],[/\*\//,'comment','@pop'],[/\*/,'comment']] },
    });
  }
  for (const id of ['vue', 'svelte']) {
    monaco.languages.setLanguageConfiguration(id, { comments: { blockComment: ['<!--', '-->'] }, brackets: [['{','}'], ['[',']'], ['(',')']], autoClosingPairs: [{ open: '{', close: '}' }, { open: '"', close: '"' }] });
    monaco.languages.setMonarchTokensProvider(id, {
      defaultToken: '', tokenPostfix: `.${id}`,
      tokenizer: {
        root: [
          [/<!--/, 'comment', '@htmlComment'],
          [/<script\b[^>]*\blang\s*=\s*["'](?:ts|typescript)["'][^>]*>/i, { token: 'tag', next: '@script', nextEmbedded: 'typescript' }],
          [/<script\b[^>]*>/i, { token: 'tag', next: '@script', nextEmbedded: 'javascript' }],
          [/<style\b[^>]*\blang\s*=\s*["']scss["'][^>]*>/i, { token: 'tag', next: '@style', nextEmbedded: 'scss' }],
          [/<style\b[^>]*\blang\s*=\s*["']less["'][^>]*>/i, { token: 'tag', next: '@style', nextEmbedded: 'less' }],
          [/<style\b[^>]*>/i, { token: 'tag', next: '@style', nextEmbedded: 'css' }],
          [id === 'vue' ? /\{\{/ : /\{(?![#:/@])/, { token: 'delimiter', next: '@expression', nextEmbedded: 'javascript' }],
          [/\{[#:/@][a-z]+/, 'keyword'],
          [/<\/?[\w:.-]+/, 'tag', '@tag'],
          [/[^<{]+/, ''], [/./, ''],
        ],
        script: [[/<\/script\s*>/i, { token: '@rematch', next: '@pop', nextEmbedded: '@pop' }]],
        style: [[/<\/style\s*>/i, { token: '@rematch', next: '@pop', nextEmbedded: '@pop' }]],
        expression: [[id === 'vue' ? /\}\}/ : /\}/, { token: 'delimiter', next: '@pop', nextEmbedded: '@pop' }]],
        tag: [[/\s+/, ''], [/[\w:@#.[\]-]+/, 'attribute.name'], [/=/, 'delimiter'], [/"[^"]*"|'[^']*'/, 'attribute.value'], [/\/?>/, 'tag', '@pop'], [/./, '']],
        htmlComment: [[/-->/, 'comment', '@pop'], [/[^-]+/, 'comment'], [/./, 'comment']],
      },
    });
  }
}
