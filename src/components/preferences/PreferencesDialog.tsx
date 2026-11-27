import type { Theme } from '../../theme.ts';
import type { Provider } from '../../agents/types.ts';
import type { Provider as ProviderInfo } from '../../types.ts';
import ModalDialog from '../ModalDialog.tsx';
import AppearancePreferences from './AppearancePreferences.tsx';
import { useState, type ReactNode } from 'react';
import { Button } from '../ui/Controls.tsx';

export default function PreferencesDialog({ theme, onThemeChange, onClose, editor, initialSection = 'general' }: {
  theme: Theme; defaultAgent: Provider; providers: ProviderInfo[];
  onThemeChange: (theme: Theme) => void; onAgentChange: (provider: Provider) => void; onClose: () => void;
  editor?: ReactNode; initialSection?: 'general' | 'editor';
}) {
  const [section, setSection] = useState(initialSection);
  return <ModalDialog title="Préférences" closeLabel="Fermer les préférences" onClose={onClose}>
    {editor ? <div className="preferences-tabs" role="tablist" aria-label="Catégorie de préférences" onKeyDown={event => {
      if (['ArrowLeft', 'ArrowRight'].includes(event.key)) { event.preventDefault(); const next = section === 'general' ? 'editor' : 'general'; setSection(next); event.currentTarget.querySelector<HTMLButtonElement>(`[data-section="${next}"]`)?.focus(); }
    }}>{(['general', 'editor'] as const).map(id => <Button key={id} role="tab" data-section={id} aria-selected={section === id} tabIndex={section === id ? 0 : -1} onClick={() => setSection(id)}>{id === 'general' ? 'Général' : 'Éditeur'}</Button>)}</div> : null}
    {section === 'editor' && editor ? <section role="tabpanel" aria-label="Éditeur">{editor}</section> : <section role="tabpanel" aria-label="Général">
    <AppearancePreferences theme={theme} onChange={onThemeChange} />
    </section>}
    <footer className="preferences-footer muted small-copy">{section === 'editor' ? 'Les options sont appliquées immédiatement. Validez les champs avec Entrée ou en quittant le champ.' : 'Les réglages sont enregistrés automatiquement.'}</footer>
  </ModalDialog>;
}
