import type { CSSProperties } from 'react';
import { doodleIcons } from '../doodleIcons.ts';

const aliases: Record<string, string> = {
  "files": "file-text",
  "search": "search",
  "git": "tree",
  "agents": "bot",
  "cloud": "cloud-up",
  "settings": "setting",
  "folder": "folder",
  "terminal": "file-code",
  "chevron": "arrow-single-right",
  "plus": "cross",
  "close": "cross",
  "check": "tick",
  "play": "play",
  "refresh": "sync",
  "arrow": "arrow-right",
  "history": "clock",
  "plan": "checklist",
  "branch": "tree",
  "spark": "star",
  "warning": "caution",
  "panel": "dashboard",
  "save": "floppy",
  "link": "link",
  "edit": "pencil",
  "trash": "delete",
  "pause": "pause",
  "question": "question",
  "code": "file-code"
};
const catalogue = new Set<string>(doodleIcons);

/** All product icons come from the local Khushmeen Doodle Icons catalogue. */
export function Icon({ name, size = 18, className, style }: {
  name: string; size?: number; className?: string; style?: CSSProperties;
}) {
  const icon = aliases[name] ?? (catalogue.has(name) ? name : 'file');
  const displaySize = name === 'git' || name === 'branch' ? Math.max(size, 14) : size;
  const iconStyle = { '--icon-size': `var(--icon-size-${displaySize}, calc(var(--icon-unit) * ${displaySize}))`, ...style,
    ...(name === 'plus' ? { rotate: '45deg' } : {}) } as CSSProperties;
  return <svg width={displaySize} height={displaySize} className={className} style={iconStyle}
    aria-hidden="true" focusable="false" data-icon={icon}>
    <use href={`/icons/doodle.svg#${icon}`} />
  </svg>;
}
