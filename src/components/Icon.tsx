import type { CSSProperties, ReactNode } from 'react';

const paths: Record<string, ReactNode> = {
  files: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6M8 13h8M8 17h5"/></>,
  search: <><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4.5 4.5"/></>,
  git: <><circle cx="6" cy="5" r="3"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="19" r="3"/><path d="M6 8v8M18 9a9 9 0 0 1-9 9"/></>,
  agents: <><rect x="4" y="7" width="16" height="13" rx="4"/><path d="M12 3v4M2 12h2m16 0h2M8 16h8"/><circle cx="8.5" cy="12" r=".5"/><circle cx="15.5" cy="12" r=".5"/></>,
  cloud: <><path d="M6 18a5 5 0 0 1-.5-10A7 7 0 0 1 19 9a4.5 4.5 0 0 1-.5 9H15M12 13v9m-3-6 3-3 3 3"/></>,
  settings: <><path d="m9 3-1 3-3 1-2 4 2 3v4l4 2 3-1 3 1 4-2v-4l2-3-2-4-3-1-1-3Z"/><circle cx="12" cy="11.5" r="3"/></>,
  folder: <path d="M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v11H3Z"/>,
  terminal: <><rect x="3" y="4" width="18" height="16" rx="3"/><path d="m7 9 3 3-3 3m6 0h4"/></>,
  chevron: <path d="m9 5 7 7-7 7"/>, plus: <path d="M12 5v14M5 12h14"/>,
  close: <path d="m6 6 12 12M6 18 18 6"/>, check: <path d="m5 12 4 4L19 6"/>,
  play: <path d="m8 4 13 8-13 8Z"/>, refresh: <><path d="M20 7V2l-3 3a8 8 0 1 0 3 9M20 7h-5"/></>,
  arrow: <path d="M4 12h16m-6-6 6 6-6 6"/>, history: <><path d="M3 11a9 9 0 1 1 2 7M3 4v7h7m2-5v6l4 2"/></>,
  plan: <><rect x="4" y="3" width="16" height="19" rx="2"/><path d="m7 8 1 1 2-2m2 1h5m-10 5h2m3 0h5m-10 5h2m3 0h5"/></>,
  branch: <><circle cx="6" cy="5" r="2"/><circle cx="6" cy="19" r="2"/><circle cx="18" cy="5" r="2"/><path d="M6 7v10m12-10a9 9 0 0 1-9 9H6"/></>,
  spark: <><path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z"/></>,
  warning: <><path d="m12 3 10 18H2Z"/><path d="M12 9v5m0 3v1"/></>,
  panel: <><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16"/></>,
  save: <><path d="M4 3h13l4 4v14H3V3Z"/><path d="M8 3v6h8V3M7 21v-8h10v8"/></>,
  link: <><path d="m10 7 3-3a5 5 0 0 1 7 7l-3 3M7 10l-3 3a5 5 0 0 0 7 7l3-3m-6-1 8-8"/></>,
  edit: <><path d="m15 4 5 5-11 11H4v-5ZM13 6l5 5"/></>,
  trash: <><path d="M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7"/></>,
};
export function Icon({ name, size = 18, className, style }: { name: string; size?: number; className?: string; style?: CSSProperties }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" className={className} style={style} aria-hidden="true">{paths[name] ?? paths.files}</svg>;
}
