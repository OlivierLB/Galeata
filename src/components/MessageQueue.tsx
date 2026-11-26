import { Button } from './ui/Controls.tsx';
import { Icon } from './Icon.tsx';

export default function MessageQueue({ messages, paused, exited, onPause, onRemove }: {
  messages: readonly { id: string; text: string }[]; paused: boolean; exited: boolean;
  onPause: (paused: boolean) => void; onRemove: (id: string) => void;
}) {
  if (!messages.length) return null;
  return <section className="composer-queue" aria-label="File d’attente des messages" data-paused={paused || exited}>
    <header>
      <div className="queue-heading">
        <strong>File d’attente <span className="queue-total">{String(messages.length).padStart(2, '0')}</span></strong>
        <span role="status">{exited ? 'Agent arrêté' : paused ? 'En pause' : 'Envoi à la fin du tour'}</span>
      </div>
      <Button type="button" className="queue-toggle" disabled={exited}
        aria-label={paused ? 'Reprendre la file' : 'Mettre la file en pause'} onClick={() => onPause(!paused)}>
        {paused ? 'Reprendre' : 'Pause'}
      </Button>
    </header>
    <ol>{messages.map((message, index) => <li key={message.id}>
      <span className="queue-order" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
      <p>{message.text}</p>
      <Button type="button" className="icon-button queue-remove" aria-label={`Retirer le message ${index + 1} de la file`}
        onClick={() => onRemove(message.id)}><Icon name="close" size={14} /></Button>
    </li>)}</ol>
  </section>;
}
