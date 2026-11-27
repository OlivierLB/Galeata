export interface ChangeMarker { line: number; end: number; kind: 'added' | 'modified' | 'deleted'; detail: string }
/** Keep removed code in the detail only, never in the editable document. */
export function changeMarkers(patch: string): ChangeMarker[] {
  const markers: ChangeMarker[] = [];
  for (const hunk of patch.split(/(?=^@@ )/m).filter(part => part.startsWith('@@ '))) {
    const header = hunk.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@[^\n]*\n/);
    if (!header) continue;
    let line = Number(header[1]);
    let added = 0, removed = 0, start = line;
    let detail: string[] = [];
    const flush = () => {
      if (!added && !removed) return;
      markers.push({ line: Math.max(1, start), end: Math.max(1, start + added - 1),
        kind: removed ? added ? 'modified' : 'deleted' : 'added', detail: detail.join('\n') });
      added = removed = 0; detail = [];
    };
    for (const entry of hunk.slice(header[0].length).split('\n')) {
      if (entry.startsWith('+') || entry.startsWith('-')) {
        if (!added && !removed) start = line;
        detail.push(entry);
        if (entry[0] === '+') { added++; line++; } else removed++;
      } else if (entry.startsWith(' ')) { flush(); line++; }
    }
    flush();
  }
  return markers;
}
