import { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { desktop, request, subscribe } from '../api.ts';

export interface TerminalLaunch { key: string; kind: string; sessionId?: string; }
export default function TerminalView({ launch, onReady, onExit, active }: { launch: TerminalLaunch; onReady: (key: string, id: string) => void; onExit: (key: string) => void; active: boolean }) {
  const container = useRef<HTMLDivElement>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const [error, setError] = useState('');
  const callbacks = useRef({ onReady, onExit }); callbacks.current = { onReady, onExit };
  useEffect(() => {
    if (!desktop || !container.current) return;
    let disposed = false; let id = ''; let cleanOutput: (() => void) | undefined; let cleanExit: (() => void) | undefined;
    const pending: { id: string; data: string }[] = [];
    const pendingExits: { id: string; code: number }[] = [];
    const term = new Terminal({ cursorBlink: true, fontSize: 12, fontFamily: '"DejaVu Sans Mono", monospace', scrollback: 5000, theme: { background: '#11131c', foreground: '#cdd3e3', cursor: '#bfa9f6', selectionBackground: '#bfa9f640', black: '#252938', red: '#ec939b', green: '#95c7a9', yellow: '#e6c38e', blue: '#8ea9e8', magenta: '#bfa9f6', cyan: '#88c9d0', white: '#dce0ec' } });
    const fit = new FitAddon(); fitRef.current = fit; term.loadAddon(fit); term.open(container.current);
    const resize = () => { try { fit.fit(); if (id) void request('terminal.resize', { id, cols: term.cols, rows: term.rows }).catch(() => {}); } catch { /* Hidden tabs have no layout. */ } };
    const observer = new ResizeObserver(resize); observer.observe(container.current);
    const input = term.onData(data => { if (id) void request('terminal.input', { id, data }).catch(e => setError(String(e))); });
    void (async () => {
      cleanOutput = await subscribe<{ id: string; data: string }>('terminal:output', event => { if (!id) { if (pending.length < 200) pending.push(event); } else if (event.id === id) term.write(event.data); });
      if (disposed) { cleanOutput(); return; }
      const exited = (event: { id: string; code: number }) => { if (!id) { pendingExits.push(event); return; } if (event.id === id) { term.writeln(`\r\n\x1b[90mProcessus terminé · code ${event.code}\x1b[0m`); callbacks.current.onExit(launch.key); } };
      cleanExit = await subscribe<{ id: string; code: number }>('terminal:exit', exited);
      if (disposed) { cleanExit(); return; }
      const result = await request<{ id: string; mcpConnected: boolean }>('terminal.start', { kind: launch.kind, sessionId: launch.sessionId }); id = result.id;
      if (disposed) { void request('terminal.close', { id }); return; }
      callbacks.current.onReady(launch.key, id); if (launch.kind !== 'shell' && !result.mcpConnected) term.writeln('\x1b[33mMCP interne indisponible : compilez le binaire galeata-mcp.\x1b[0m'); pending.filter(event => event.id === id).forEach(event => term.write(event.data)); pending.length = 0; resize(); term.focus();
      pendingExits.forEach(exited); pendingExits.length = 0;
    })().catch(e => { if (!disposed) setError(String(e)); });
    return () => { disposed = true; cleanOutput?.(); cleanExit?.(); observer.disconnect(); input.dispose(); term.dispose(); if (id) void request('terminal.close', { id }).catch(() => {}); };
  }, [launch]);
  useEffect(() => { if (active) requestAnimationFrame(() => { try { fitRef.current?.fit(); } catch { /* Layout settles on next resize. */ } }); }, [active]);
  if (!desktop) return <div className="terminal-placeholder"><span className="prompt-symbol">❯</span><span>Le terminal et les agents sont disponibles dans l’application de bureau.</span></div>;
  return <div className="terminal-view">{error ? <div className="inline-error" role="alert">{error}</div> : null}<div ref={container} className="terminal-container" /></div>;
}
