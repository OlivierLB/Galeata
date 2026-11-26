import { ChoiceGroup } from '../ChoicePicker.tsx';
import type { Theme } from '../../theme.ts';

export default function AppearancePreferences({ theme, onChange }: {
  theme: Theme; onChange: (theme: Theme) => void;
}) {
  return <section className="preference-section" aria-labelledby="appearance-title">
    <h3 id="appearance-title">Apparence</h3>
    <ChoiceGroup className="segmented" label="Apparence" value={theme}
      options={[{ id: 'paper', label: 'Papier' }, { id: 'night', label: 'Charbon' }]}
      onChange={value => onChange(value as Theme)} />
  </section>;
}
