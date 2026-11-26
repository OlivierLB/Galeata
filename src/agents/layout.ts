export interface ConversationLayoutState {
  active: string;
  pairs: [string, string][];
}

export function normalizeLayout(saved: unknown, ids: string[]): ConversationLayoutState {
  const value = saved && typeof saved === 'object' ? saved as Record<string, unknown> : {};
  const used = new Set<string>();
  const pairs: [string, string][] = [];
  const candidates = Array.isArray(value.pairs) ? value.pairs
    : value.split === true ? [[value.active, value.right]] : [];
  for (const pair of candidates) {
    if (!Array.isArray(pair) || pair.length !== 2) continue;
    const [left, right] = pair;
    if (typeof left !== 'string' || typeof right !== 'string' || left === right
      || !ids.includes(left) || !ids.includes(right) || used.has(left) || used.has(right)) continue;
    pairs.push([left, right]); used.add(left); used.add(right);
  }
  const active = value.active === '' ? '' : typeof value.active === 'string' && ids.includes(value.active)
    ? value.active : ids.at(-1) ?? '';
  return { active, pairs };
}

export function visiblePair(layout: ConversationLayoutState) {
  return layout.pairs.find(pair => pair.includes(layout.active));
}

export function placeConversation(layout: ConversationLayoutState, id: string, side: 'left' | 'right', ids: string[]): ConversationLayoutState {
  if (!ids.includes(id)) return layout;
  const current = visiblePair(layout);
  const target = current?.[side === 'left' ? 1 : 0];
  const companion = [target, ...(current ?? []), layout.active, ...[...ids].reverse()]
    .find(candidate => candidate && candidate !== id && ids.includes(candidate));
  if (!companion) return { active: id, pairs: layout.pairs };
  const pair: [string, string] = side === 'left' ? [id, companion] : [companion, id];
  return { active: id, pairs: [...layout.pairs.filter(existing => !existing.includes(id) && !existing.includes(companion)), pair] };
}

export function togglePair(layout: ConversationLayoutState, ids: string[]): ConversationLayoutState {
  const current = visiblePair(layout);
  if (current) return { ...layout, pairs: layout.pairs.filter(pair => pair !== current) };
  const companion = [...ids].reverse().find(id => id !== layout.active);
  if (!layout.active || !companion) return layout;
  return { ...placeConversation(layout, companion, 'right', ids), active: layout.active };
}

export function reconcileLayout(layout: ConversationLayoutState, previousIds: string[], ids: string[]): ConversationLayoutState {
  const added = [...ids].reverse().find(id => !previousIds.includes(id));
  const partner = visiblePair(layout)?.find(id => id !== layout.active && ids.includes(id));
  const active = added ?? (layout.active && !ids.includes(layout.active) ? partner ?? ids.at(-1) ?? '' : layout.active);
  return normalizeLayout({ ...layout, active }, ids);
}
