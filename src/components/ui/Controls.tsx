import type { ComponentProps } from 'react';

export function classNames(...values: (string | false | null | undefined)[]) {
  return values.filter(Boolean).join(' ');
}

export function Button({ variant, className, ...props }: ComponentProps<'button'> & {
  variant?: 'primary' | 'secondary' | 'danger' | 'icon';
}) {
  return <button {...props} className={classNames(variant === 'icon' ? 'icon-button' : variant && 'button',
    variant && variant !== 'primary' && variant !== 'icon' && variant, className)} />;
}

export function Checkbox(props: Omit<ComponentProps<'input'>, 'type'>) {
  return <input {...props} type="checkbox" />;
}

export function TextInput(props: ComponentProps<'input'>) {
  return <input {...props} />;
}

export function Select(props: ComponentProps<'select'>) {
  return <select {...props} />;
}

export function TextArea(props: ComponentProps<'textarea'>) {
  return <textarea {...props} />;
}

export function Text({ tone = 'default', className, ...props }: ComponentProps<'p'> & {
  tone?: 'default' | 'muted' | 'error';
}) {
  return <p {...props} className={classNames(tone === 'muted' && 'muted',
    tone === 'error' && 'inline-error', className)} />;
}
