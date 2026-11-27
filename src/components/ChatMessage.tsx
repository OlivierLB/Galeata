import type { ReactNode } from 'react';

/** Shared message shell: outgoing on the right, incoming on the left. */
export default function ChatMessage({ side, children, createdAt }: { side: 'user' | 'assistant'; children: ReactNode; createdAt?: number }) {
  return <div className={`chat-item chat-message chat-${side}`} aria-label={side === 'user' ? 'Votre message' : 'Message de l’agent'}>
    <div className="chat-bubble">{children}</div>
    {createdAt ? <time className="chat-time" dateTime={new Date(createdAt).toISOString()} title={new Date(createdAt).toLocaleString('fr-FR')}>{new Date(createdAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</time> : null}
  </div>;
}
