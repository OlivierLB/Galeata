import { mascot, type MascotSnapshot, type MascotStore } from './store.ts';

type RequestReaction = { start: MascotSnapshot; completed: MascotSnapshot };
const gitLabels: Record<string, [string, string]> = {
  fetch: ['Récupération des branches distantes…', 'Références Git actualisées'],
  pull: ['Mise à jour de la branche…', 'Branche mise à jour'],
  push: ['Publication des commits…', 'Commits publiés'],
  commit: ['Création du commit…', 'Commit créé'],
  branch: ['Création d’une branche…', 'Nouvelle branche activée'],
  switch: ['Changement de branche…', 'Branche activée'],
  merge: ['Fusion des branches…', 'Fusion terminée'],
  mergeAbort: ['Annulation de la fusion…', 'Fusion annulée'],
  mergeContinue: ['Finalisation de la fusion…', 'Fusion terminée'],
  stash: ['Mise de côté des modifications…', 'Modifications mises de côté'],
  stashApply: ['Application du stash…', 'Stash appliqué et conservé'],
  stashPop: ['Restauration du stash…', 'Stash restauré'],
  stage: ['Indexation du fichier…', 'Fichier indexé'],
  unstage: ['Retrait du fichier de l’index…', 'Fichier désindexé'],
  worktree: ['Création d’un worktree…', 'Worktree créé'],
};

function reactionFor(method: string, args: Record<string, unknown>): RequestReaction | undefined {
  if (method === 'git.mutate') {
    const action = String(args.action);
    const [start, completed] = gitLabels[action] ?? [
      'Commande Git en cours…',
      'Commande Git terminée',
    ];
    return {
      start: { animation: 'working', label: start },
      completed: {
        animation: ['commit', 'push', 'merge', 'mergeContinue'].includes(action) ? 'goal' : 'step',
        label: completed,
      },
    };
  }
  const files: Record<string, [string, string]> = {
    'workspace.write': ['Enregistrement du fichier…', 'Fichier enregistré'],
    'workspace.create': [
      args.directory ? 'Création du dossier…' : 'Création du fichier…',
      args.directory ? 'Dossier créé' : 'Fichier créé',
    ],
    'workspace.rename': ['Renommage du fichier…', 'Fichier renommé'],
    'workspace.delete': ['Suppression du fichier…', 'Fichier supprimé'],
  };
  if (files[method])
    return {
      start: { animation: 'responding', label: files[method][0] },
      completed: { animation: 'step', label: files[method][1] },
    };
  if (method === 'workspace.search_files' || method === 'workspace.search_text')
    return {
      start: { animation: 'thinking', label: 'Recherche dans le projet…' },
      completed: { animation: 'idle', label: 'Résultats de recherche prêts' },
    };
  if (method === 'git.diff')
    return {
      start: { animation: 'thinking', label: 'Lecture des différences…' },
      completed: { animation: 'idle', label: 'Comparaison prête' },
    };
  if (method === 'verification.run')
    return {
      start: { animation: 'working', label: 'Vérification en cours…' },
      completed: { animation: 'success', label: 'Vérification réussie' },
    };
  if (method === 'terminal.start')
    return {
      start: { animation: 'working', label: 'Ouverture du terminal…' },
      completed: { animation: 'success', label: 'Terminal ouvert' },
    };
  // Background polling (status, overview, file reads, preferences…) stays quiet.
}

/** One connection point for real requests, with an operation lasting until completion. */
export async function trackMascotRequest<T>(
  method: string,
  args: Record<string, unknown>,
  run: () => Promise<T> | T,
  store: MascotStore = mascot,
): Promise<T> {
  const reaction = reactionFor(method, args);
  if (!reaction) return run();
  const finish = store.begin(reaction.start, reaction.completed);
  try {
    const result = await run();
    const data = (result as { data?: { exitCode?: number; error?: unknown } } | null)?.data;
    const failed =
      method === 'verification.run' && (!data || data.error !== undefined || data.exitCode !== 0);
    finish(failed ? 'error' : 'success');
    return result;
  } catch (error) {
    finish('error');
    throw error;
  }
}
