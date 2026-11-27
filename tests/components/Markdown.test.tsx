import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

const openExternal = vi.fn(async (_url: string) => {});
vi.mock('../../src/api.ts', () => ({
  openExternal: (url: string) => openExternal(url),
  getActiveWorkspace: () => ({ id: 'w', root: '/home/me/project' }),
}));
const { Markdown } = await import('../../src/components/Markdown');
const { classifyLink, fileReference } = await import('../../src/links');

afterEach(() => {
  cleanup();
  openExternal.mockClear();
});

test('classifies web links, workspace paths and ignores the rest', () => {
  expect(classifyLink('https://example.com/a')).toEqual({ kind: 'external', url: 'https://example.com/a' });
  expect(classifyLink('mailto:a@b.c')).toEqual({ kind: 'external', url: 'mailto:a@b.c' });
  expect(classifyLink('src/App.tsx')).toEqual({ kind: 'file', path: 'src/App.tsx' });
  expect(classifyLink('./src/App.tsx:42')).toEqual({ kind: 'file', path: 'src/App.tsx', line: 42 });
  expect(classifyLink('src/App.tsx#L12-L20')).toEqual({ kind: 'file', path: 'src/App.tsx', line: 12 });
  expect(classifyLink('/home/me/project/src/a%20b.ts', '/home/me/project')).toEqual({ kind: 'file', path: 'src/a b.ts' });
  expect(classifyLink('/etc/passwd', '/home/me/project')).toBeNull();
  expect(classifyLink('../outside.ts')).toBeNull();
  expect(classifyLink('javascript:alert(1)')).toBeNull();
  expect(classifyLink('#section')).toBeNull();
});

test('web links open in the system browser, never in the app window', () => {
  render(<Markdown text="Voir [la doc](https://example.com/doc)." />);
  const link = screen.getByText('la doc');
  const event = new MouseEvent('click', { bubbles: true, cancelable: true });
  link.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
  expect(openExternal).toHaveBeenCalledWith('https://example.com/doc');
});

test('workspace paths open in the editor at the given line', () => {
  const onOpenFile = vi.fn();
  render(<Markdown text="Corrigé dans [App.tsx](src/App.tsx#L42)." onOpenFile={onOpenFile} />);
  fireEvent.click(screen.getByText('App.tsx'));
  expect(onOpenFile).toHaveBeenCalledWith('src/App.tsx', 42);
  expect(openExternal).not.toHaveBeenCalled();
});

test('bare URLs are autolinked and clickable', () => {
  render(<Markdown text="Lien : https://example.com/x" />);
  fireEvent.click(screen.getByText('https://example.com/x'));
  expect(openExternal).toHaveBeenCalledWith('https://example.com/x');
});

test('inline code file references open on Ctrl+click only', () => {
  const onOpenFile = vi.fn();
  render(<Markdown text="Bouton : `src/components/TurtleMascot.tsx:118-122` et `npm test`." onOpenFile={onOpenFile} />);
  const path = screen.getByText('src/components/TurtleMascot.tsx:118-122');
  fireEvent.click(path);
  expect(onOpenFile).not.toHaveBeenCalled();
  fireEvent.click(path, { ctrlKey: true });
  expect(onOpenFile).toHaveBeenCalledWith('src/components/TurtleMascot.tsx', 118);
  fireEvent.click(screen.getByText('npm test'), { ctrlKey: true });
  expect(onOpenFile).toHaveBeenCalledTimes(1);
});

test('only path-shaped inline code counts as a file reference', () => {
  expect(fileReference('src/styles.css:2697')).toEqual({ kind: 'file', path: 'src/styles.css', line: 2697 });
  expect(fileReference('/home/me/project/src/App.tsx:12', '/home/me/project')).toEqual({ kind: 'file', path: 'src/App.tsx', line: 12 });
  expect(fileReference('mascot.react')).toBeNull();
  expect(fileReference('TurtleMascot.tsx')).toBeNull();
  expect(fileReference('a / b.c')).toBeNull();
  expect(fileReference('../secret/x.ts')).toBeNull();
});
