export interface CheckDefinition {
  id: string; name: string; program: string; args: string[]; cwd: string; timeout: number; origin: string; category: string;
}
export interface CheckConfiguration {
  custom?: CheckDefinition[]; selected?: string[]; profiles?: Record<string, string[]>;
}
export interface CheckCatalogue {
  checks: { available: boolean; definition: CheckDefinition }[];
  configuration: CheckConfiguration | null; scope: string;
}
export interface CheckJob {
  check: CheckDefinition; status: string; startedAt: number | null; finishedAt: number | null;
  exitCode: number | null; message: string; hasOutput: boolean;
}
export interface CheckRun { id: string; createdAt: number; stale: boolean; active: boolean; jobs: CheckJob[] }
export const statusLabels: Record<string, string> = {
  queued: 'En attente', waiting: 'Attend le créneau', running: 'En cours', passed: 'Réussi', failed: 'Échoué',
  blocked: 'Prérequis manquant', timeout: 'Délai dépassé', cancelled: 'Annulé', interrupted: 'Interrompu',
  no_tests: 'Aucun test trouvé', output_limit: 'Limite de sortie atteinte',
};
