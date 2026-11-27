import { Text } from '../ui/Controls.tsx';
import { desktop } from '../../api.ts';
import { providerNames, type Provider } from '../../agents/types.ts';
import type { Provider as ProviderInfo } from '../../types.ts';
import { ChoiceGroup } from '../ChoicePicker.tsx';

export default function AgentPreferences({ defaultAgent, providers, onChange }: {
  defaultAgent: Provider; providers: ProviderInfo[]; onChange: (provider: Provider) => void;
}) {
  return <section className="preference-section" aria-labelledby="agent-preferences-title">
    <h3 id="agent-preferences-title">Conversations</h3>
    <div className="preference-field">
      <h4>Agent par défaut</h4>
      <Text tone="muted" className="small-copy">Proposé à l’accueil des nouvelles conversations. Si cet agent est indisponible, l’autre est utilisé.</Text>
      <ChoiceGroup className="segmented" label="Agent par défaut" value={defaultAgent}
        options={(['claude', 'codex'] as const).map(id => {
          const info = providers.find(provider => provider.id === id);
          return { id, label: providerNames[id] + (desktop && info && !info.available ? ' · indisponible' : ''), hint: info?.error ?? undefined };
        })}
        onChange={value => onChange(value as Provider)} />
    </div>
  </section>;
}
