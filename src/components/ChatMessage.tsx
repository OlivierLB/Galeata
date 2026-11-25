import type { ReactNode } from 'react';

/** Shared message shell: outgoing on the right, incoming on the left. */
export default function ChatMessage({ side, children }: { side: 'user' | 'assistant'; children: ReactNode }) {
  return <div className={`chat-item chat-message chat-${side}`} aria-label={side === 'user' ? 'Votre message' : 'Message de l’agent'}>
    <div className="chat-bubble">{children}</div>
  </div>;
}
