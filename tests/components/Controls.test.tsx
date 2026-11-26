import { createRef } from 'react';
import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Button, Checkbox, TextInput, Select, TextArea, Text, classNames } from '../../src/components/ui/Controls';
afterEach(cleanup);

test('class names omit absent variants', () => {
  expect(classNames('button', false, undefined, null, 'secondary')).toBe('button secondary');
});
test.each(['primary', 'secondary', 'danger', 'icon'] as const)('button supports %s and native behavior', variant => {
  const click = vi.fn();
  const ref = createRef<HTMLButtonElement>();
  const { rerender } = render(<Button ref={ref} variant={variant} onClick={click}>Action</Button>);
  expect(ref.current).toBe(screen.getByRole('button'));
  expect(ref.current!.className).toContain(variant === 'icon' ? 'icon-button' : 'button');
  fireEvent.click(ref.current!);
  expect(click).toHaveBeenCalledTimes(1);
  rerender(<Button disabled onClick={click}>Action</Button>);
  fireEvent.click(screen.getByRole('button'));
  expect(click).toHaveBeenCalledTimes(1);
});
test('button preserves submit semantics in forms', () => {
  const submit = vi.fn(event => event.preventDefault());
  render(<form onSubmit={submit}><Button>Enregistrer</Button><Button type="button">Annuler</Button></form>);
  fireEvent.click(screen.getByText('Annuler'));
  expect(submit).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText('Enregistrer'));
  expect(submit).toHaveBeenCalledTimes(1);
});
test('fields forward labels, values, constraints and change events', () => {
  const change = vi.fn();
  render(<><label>Nom<TextInput required defaultValue="initial" onChange={change} /></label>
    <label>Choix<Select defaultValue="a" onChange={change}><option value="a">A</option><option value="b">B</option></Select></label>
    <label>Description<TextArea readOnly value="Texte" /></label>
    <label>Actif<Checkbox defaultChecked onChange={change} /></label></>);
  const input = screen.getByLabelText('Nom') as HTMLInputElement;
  expect(input.required).toBe(true);
  fireEvent.change(input, { target: { value: 'nouveau' } });
  fireEvent.change(screen.getByLabelText('Choix'), { target: { value: 'b' } });
  fireEvent.click(screen.getByLabelText('Actif'));
  expect(change).toHaveBeenCalledTimes(3);
  expect((screen.getByLabelText('Actif') as HTMLInputElement).checked).toBe(false);
  expect((screen.getByLabelText('Description') as HTMLTextAreaElement).readOnly).toBe(true);
});
test('text combines semantic tone with custom classes', () => {
  render(<Text tone="error" className="custom" role="alert">Erreur</Text>);
  expect(screen.getByRole('alert').className).toBe('inline-error custom');
});
