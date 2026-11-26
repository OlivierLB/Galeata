import { Button, Select, TextArea, TextInput } from './ui/Controls.tsx';
import { useEffect, useRef, useState } from 'react';
import { Icon } from './Icon.tsx';

export interface DialogField {
  name: string;
  label: string;
  value?: string;
  placeholder?: string;
  type?: string;
  required?: boolean;
  options?: { value: string; label: string }[];
}
export interface DialogSpec {
  title: string;
  description?: string;
  fields: DialogField[];
  submit?: string;
  danger?: boolean;
  onSubmit: (values: Record<string, string>) => Promise<void>;
}
export default function Dialog({ spec, onClose }: { spec: DialogSpec; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      spec.fields.map((field) => [field.name, field.value ?? field.options?.[0]?.value ?? '']),
    ),
  );
  const updateField = (name: string, value: string) =>
    setValues(previous => ({ ...previous, [name]: value }));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  return (
    <dialog
      ref={dialog}
      className="dialog"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          setBusy(true);
          setError('');
          void spec
            .onSubmit(values)
            .then(onClose)
            .catch((e) => setError(String(e)))
            .finally(() => setBusy(false));
        }}
      >
        <div className="dialog-heading">
          <h2>{spec.title}</h2>
          <Button
            type="button"
            variant="icon"
            aria-label="Fermer"
            onClick={onClose}
            disabled={busy}
          >
            <Icon name="close" />
          </Button>
        </div>
        {spec.description ? <p className="dialog-description">{spec.description}</p> : null}
        {spec.fields.map((field) => (
          <label key={field.name} className="form-field">
            <span>{field.label}</span>
            {field.options ? (
              <Select
                value={values[field.name]}
                onChange={(event) =>
                  updateField(field.name, event.target.value)
                }
              >
                {field.options.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            ) : field.type === 'textarea' ? (
              <TextArea
                value={values[field.name]}
                required={field.required}
                placeholder={field.placeholder}
                onChange={(event) =>
                  updateField(field.name, event.target.value)
                }
                rows={4}
              />
            ) : (
              <TextInput
                type={field.type ?? 'text'}
                value={values[field.name]}
                required={field.required}
                placeholder={field.placeholder}
                autoComplete="off"
                onChange={(event) =>
                  updateField(field.name, event.target.value)
                }
              />
            )}
          </label>
        ))}
        {error ? (
          <p role="alert" className="inline-error">
            {error}
          </p>
        ) : null}
        <div className="dialog-actions">
          <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
            Annuler
          </Button>
          <Button className={`button ${spec.danger ? 'danger' : ''}`} disabled={busy}>
            {busy ? 'En cours…' : spec.submit ?? 'Enregistrer'}
          </Button>
        </div>
      </form>
    </dialog>
  );
}
