import { useCheckRuns } from '../../checks/useCheckRuns.ts';
import { Icon } from '../Icon.tsx';

export default function ChecksStatusButton({ workspaceId, open, onClick }: {
  workspaceId?: string; open: boolean; onClick: () => void;
}) {
  const { runs } = useCheckRuns(workspaceId, !open, false);
  const active = runs.some(run => run.active);
  return <button title="Choisir les tests, analyses et compilations du projet" disabled={!workspaceId} onClick={onClick}>
    <Icon name="check" size={12} />Tests et contrôles{active ? ' · en cours' : ''}
  </button>;
}
