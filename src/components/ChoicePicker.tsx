import { Icon } from './Icon.tsx';
import { useEffect, useRef } from 'react';

export interface Choice { id: string; label: string; hint?: string; danger?: boolean; disabled?: boolean }
export function ChoiceGroup({ label, value, options, onChange, className = '' }: {
  label: string; value?: string; options: readonly Choice[]; onChange: (value: string) => void; className?: string;
}) {
  return <div className={className} role="radiogroup" aria-label={label} onKeyDown={event => {
    if (!['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
    if (!buttons.length) return;
    event.preventDefault();
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const direction = event.key === 'ArrowUp' || event.key === 'ArrowLeft' ? -1 : 1;
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
      : (current + direction + buttons.length) % buttons.length;
    buttons[next].focus();
  }}>
    {options.map(option => <button key={option.id} type="button" role="radio"
      aria-checked={value === option.id} disabled={option.disabled} title={option.hint}
      className={`${value === option.id ? 'active' : ''} ${option.danger ? 'danger' : ''}`}
      onClick={() => onChange(option.id)}>{option.label}</button>)}
  </div>;
}

export function ChoicePicker({ label, title, value, options, fallback = 'Choisir', disabled, onChange, className = '' }: {
  label: string; title?: string; value?: string; options: readonly Choice[]; fallback?: string;
  disabled?: boolean; onChange: (value: string) => void; className?: string;
}) {
  const picker = useRef<HTMLDetailsElement>(null);
  const trigger = useRef<HTMLElement>(null);
  useEffect(() => {
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && !picker.current?.contains(event.target) && picker.current)
        picker.current.open = false;
    };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, []);
  useEffect(() => { if (disabled && picker.current) picker.current.open = false; }, [disabled]);
  return <details className={`composer-mode-picker ${className}`} ref={picker}
    onKeyDown={event => {
      if (event.key === 'Escape') { if (picker.current) picker.current.open = false; trigger.current?.focus(); }
    }}>
    <summary ref={trigger} aria-label={label} aria-disabled={disabled || undefined} title={title}
      onClick={event => { if (disabled) event.preventDefault(); }}>
      {options.find(option => option.id === value)?.label ?? fallback}<Icon name="arrow-single-down" size={12} />
    </summary>
    <ChoiceGroup className="mode-switch" label={label} value={value}
      options={options.map(option => ({ ...option, disabled: disabled || option.disabled }))}
      onChange={next => {
        if (disabled) return;
        if (picker.current) picker.current.open = false;
        trigger.current?.focus();
        onChange(next);
      }} />
  </details>;
}
