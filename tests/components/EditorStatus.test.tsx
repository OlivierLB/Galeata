import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import EditorStatus from '../../src/components/EditorStatus';
afterEach(cleanup);
const file = { path: 'source.ts', language: 'typescript', content: 'changed', savedContent: 'initial', stamp: '1' };
const actions = { onPreferences: vi.fn(), onRetry: vi.fn(), onLanguage: vi.fn() };
test('native status follows the displayed file and exposes a retry for failed saving', () => {
  const { rerender } = render(<EditorStatus {...actions} file={file} editable native autoSave phase="error" localDraftSaved draftError="" />);
  expect(screen.getByRole('status').textContent).toBe('Échec de l’enregistrement');
  fireEvent.click(screen.getByRole('button', { name: 'Réessayer' })); expect(actions.onRetry).toHaveBeenCalledOnce();
  rerender(<EditorStatus {...actions} file={{ ...file, content: 'initial' }} editable native autoSave localDraftSaved={false} draftError="" />);
  expect(screen.getByRole('status').textContent).toBe('Enregistré');
  expect(screen.queryByRole('button', { name: 'Réessayer' })).toBeNull();
  rerender(<EditorStatus {...actions} file={file} editable native autoSave phase="saving" localDraftSaved draftError="" />);
  expect(screen.getByRole('status').textContent).toBe('Enregistrement…');
});
test('preview distinguishes local drafts from disk saving and reports draft storage failures', () => {
  render(<EditorStatus {...actions} file={file} editable native={false} autoSave localDraftSaved draftError="Brouillon indisponible" />);
  expect(screen.getByRole('status').textContent).toBe('Brouillon local non conservé');
  expect(screen.getByRole('alert').textContent).toBe('Brouillon indisponible');
  expect(screen.queryByRole('button', { name: 'Réessayer' })).toBeNull();
});
test('read-only and conflict statuses take precedence over ordinary saving states', () => {
  const { rerender } = render(<EditorStatus {...actions} file={{ ...file, external: { content: 'disk', stamp: '2' } }} editable native autoSave phase="saving" localDraftSaved draftError="" />);
  expect(screen.getByRole('status').textContent).toBe('Conflit sur disque');
  rerender(<EditorStatus {...actions} file={file} editable={false} native autoSave localDraftSaved draftError="" />);
  expect(screen.getByRole('status').textContent).toBe('Lecture seule');
});
