import type { Plan, StepStatus } from './types.ts';

export const statusLabels: Record<StepStatus, string> = {
  pending: 'À faire', in_progress: 'En cours', blocked: 'Bloqué', done: 'Terminé par l’auteur',
};
export function languageFor(path: string): string {
  const extension = path.split('.').pop()?.toLowerCase();
  return ({ ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript', rs: 'rust', json: 'json', md: 'markdown', css: 'css', html: 'html', py: 'python', yml: 'yaml', yaml: 'yaml', sh: 'shell', sql: 'sql', toml: 'ini', svg: 'xml' } as Record<string, string>)[extension ?? ''] ?? 'plaintext';
}
export function progress(plan: Plan): number {
  return plan.steps.length ? Math.round(plan.steps.filter(step => step.status === 'done').length / plan.steps.length * 100) : 0;
}
export function nextStatus(status: StepStatus): StepStatus {
  return ({ pending: 'in_progress', in_progress: 'done', done: 'pending', blocked: 'in_progress' } as const)[status];
}
export function relativeTime(timestamp: number): string {
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60000));
  if (minutes < 1) return 'à l’instant';
  if (minutes < 60) return `il y a ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `il y a ${hours} h` : `il y a ${Math.floor(hours / 24)} j`;
}
