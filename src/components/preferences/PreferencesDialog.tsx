import type { Theme } from '../../theme.ts';
import type { Provider } from '../../agents/types.ts';
import type { Provider as ProviderInfo } from '../../types.ts';
import ModalDialog from '../ModalDialog.tsx';
import AppearancePreferences from './AppearancePreferences.tsx';
import AgentPreferences from './AgentPreferences.tsx';

export default function PreferencesDialog({ theme, defaultAgent, providers, onThemeChange, onAgentChange, onClose }: {
  theme: Theme; defaultAgent: Provider; providers: ProviderInfo[];
  onThemeChange: (theme: Theme) => void; onAgentChange: (provider: Provider) => void; onClose: () => void;
}) {
  return <ModalDialog title="Préférences" closeLabel="Fermer les préférences" onClose={onClose}>
    <AppearancePreferences theme={theme} onChange={onThemeChange} />
    <AgentPreferences defaultAgent={defaultAgent} providers={providers} onChange={onAgentChange} />
    <footer className="preferences-footer muted small-copy">Les réglages sont enregistrés automatiquement.</footer>
  </ModalDialog>;
}
