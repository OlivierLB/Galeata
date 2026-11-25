import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ChoiceGroup, ChoicePicker } from '../../src/components/ChoicePicker';
afterEach(cleanup);
const options = [{ id: 'a', label: 'Normal' }, { id: 'b', label: 'Avancé', danger: true }, { id: 'c', label: 'Indisponible', disabled: true }];
test('group exposes selection, danger and disabled choices without emitting for disabled options', () => {
 const change = vi.fn(); render(<ChoiceGroup label="Choix" value="a" options={options} onChange={change} />);
 expect(screen.getByRole('radio', { name: 'Normal' }).getAttribute('aria-checked')).toBe('true');
 expect(screen.getByRole('radio', { name: 'Avancé' }).className).toContain('danger');
 fireEvent.click(screen.getByRole('radio', { name: 'Indisponible' })); expect(change).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('radio', { name: 'Avancé' })); expect(change).toHaveBeenCalledWith('b');
});
test('picker closes after selection, outside click and Escape and restores focus', () => {
 const change = vi.fn(); const { container } = render(<ChoicePicker label="Modèle" value="a" options={options} onChange={change} />);
 const trigger = screen.getByText('Normal', { selector: 'summary' }); const details = container.querySelector('details')!;
 fireEvent.click(trigger); expect(details.open).toBe(true);
 fireEvent.click(screen.getByRole('radio', { name: 'Avancé' })); expect(change).toHaveBeenCalledWith('b'); expect(details.open).toBe(false); expect(document.activeElement).toBe(trigger);
 fireEvent.click(trigger); fireEvent.pointerDown(document.body); expect(details.open).toBe(false);
 fireEvent.click(trigger); fireEvent.keyDown(trigger, { key: 'Escape' }); expect(details.open).toBe(false);
});
test('picker handles unknown values and disabled transitions', () => {
 const change = vi.fn(); const { container, rerender } = render(<ChoicePicker label="Mode" fallback="Chargement" options={[]} onChange={change} />);
 const trigger = screen.getByText('Chargement', { selector: 'summary' }); fireEvent.click(trigger);
 rerender(<ChoicePicker label="Mode" fallback="Chargement" options={options} disabled onChange={change} />);
 expect(container.querySelector('details')!.open).toBe(false); fireEvent.click(trigger); expect(container.querySelector('details')!.open).toBe(false); expect(change).not.toHaveBeenCalled();
});

test('keyboard navigation skips disabled choices and supports Home and End', () => {
 render(<ChoiceGroup label="Choix" value="a" options={options} onChange={vi.fn()} />);
 const first = screen.getByRole('radio', { name: 'Normal' });
 const last = screen.getByRole('radio', { name: 'Avancé' });
 first.focus(); fireEvent.keyDown(first, { key: 'ArrowDown' }); expect(document.activeElement).toBe(last);
 fireEvent.keyDown(last, { key: 'ArrowDown' }); expect(document.activeElement).toBe(first);
 fireEvent.keyDown(first, { key: 'End' }); expect(document.activeElement).toBe(last);
 fireEvent.keyDown(last, { key: 'Home' }); expect(document.activeElement).toBe(first);
});
