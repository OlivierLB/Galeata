export type Theme = 'paper' | 'night';
export function readTheme(): Theme {
  return localStorage.getItem('galeata:theme') === 'night' ? 'night' : 'paper';
}
export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem('galeata:theme', theme);
  window.dispatchEvent(new Event('galeata:theme'));
}
applyTheme(readTheme());
