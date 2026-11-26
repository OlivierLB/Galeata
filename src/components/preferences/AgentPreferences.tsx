import { useState } from 'react';
import { desktop } from '../../api.ts';
import { agentModes, readStartMode, writeStartMode } from '../../agents/preferences.ts';
import { providerNames, type Provider } from '../../agents/types.ts';
import type { Provider as ProviderInfo } from '../../types.ts';
import { ChoiceGroup } from '../ChoicePicker.tsx';

export default function AgentPreferences({ defaultAgent, providers, onChange }: {
  defaultAgent: Provider; providers: ProviderInfo[]; onChange: (provider: Provider) => void;
}) {
  const [modes, setModes] = useState(() => ({ claude: readStartMode('claude'), codex: readStartMode('codex') }));
  return <section className="preference-section" aria-labelledby="agent-preferences-title">
    <h3 id="agent-preferences-title">Conversations</h3>
    <div className="preference-field">
      <h4>Agent par défaut</h4>
      <p className="muted small-copy">Proposé à l’accueil des nouvelles conversations. Si cet agent est indisponible, l’autre est utilisé.</p>
      <ChoiceGroup className="segmented" label="Agent par défaut" value={defaultAgent}
        options={(['claude', 'codex'] as const).map(id => {
          const info = providers.find(provider => provider.id === id);
          return { id, label: providerNames[id] + (desktop && info && !info.available ? ' · indisponible' : ''), hint: info?.error ?? undefined };
        })}
        onChange={value => onChange(value as Provider)} />
    </div>
    {(['claude', 'codex'] as const).map(provider => <div className="preference-field" key={provider}>
      <h4>Mode de {providerNames[provider]} au démarrage</h4>
      <ChoiceGroup className="segmented" label={`Mode de ${providerNames[provider]} au démarrage`}
        value={modes[provider]} options={agentModes[provider]}
        onChange={value => {
          writeStartMode(provider, value);
          setModes(previous => ({ ...previous, [provider]: value }));
        }} />
    </div>)}
    <p className="muted small-copy">Le dernier mode choisi dans une conversation devient celui des prochaines.</p>
  </section>;
}
