export const animations = {
  idle: { file: 'turtle-look.png', columns: 4, frames: [0, 0, 1, 1, 2, 2, 3, 3, 2, 1], fps: 2 },
  thinking: { file: 'turtle-think.png', columns: 8, frames: [0, 1, 2, 3, 4, 5, 6, 7, 6, 5, 4, 3, 2, 1], fps: 7 },
  responding: { file: 'turtle-respond.png', columns: 8, frames: [0, 1, 2, 3, 4, 5, 6, 7, 6, 5, 4, 3, 2, 1], fps: 9 },
  working: { file: 'turtle-dance.png', columns: 4, frames: [0, 1, 2, 3], fps: 6 },
  waiting: { file: 'turtle-look.png', columns: 4, frames: [1, 1, 3, 3], fps: 1 },
  success: { file: 'turtle-celebrate.png', columns: 4, frames: [0, 1, 2, 3], fps: 6 },
  step: { file: 'turtle-jump.png', columns: 5, frames: [0, 1, 2, 3, 4], fps: 7 },
  goal: { file: 'turtle-goal.png', columns: 5, frames: [0, 1, 2, 3, 4], fps: 7 },
  error: { file: 'turtle-oops.png', columns: 8, frames: [0, 1, 2, 3, 4, 5, 6, 7], fps: 5 },
} as const;

export type AnimationName = keyof typeof animations;
export type MascotAction = 'text-edit' | 'file-saved' | 'step-completed' | 'plan-completed' | 'play' | 'error';

export const reactions: Record<MascotAction, { animation: AnimationName; label: string; duration: number }> = {
  'text-edit': { animation: 'responding', label: 'À l’écriture…', duration: 1200 },
  'file-saved': { animation: 'step', label: 'Fichier enregistré', duration: 1800 },
  'step-completed': { animation: 'step', label: 'Étape terminée', duration: 1800 },
  'plan-completed': { animation: 'goal', label: 'Plan terminé', duration: 2800 },
  play: { animation: 'working', label: 'Petite pause !', duration: 2200 },
  error: { animation: 'error', label: 'Un petit souci…', duration: 3200 },
};
