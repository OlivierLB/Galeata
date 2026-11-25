import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import MessageQueue from '../../src/components/MessageQueue';
afterEach(cleanup);
const messages = [{ id: 'first', text: 'Premier message' }, { id: 'second', text: 'Deuxième\nligne' }];
test('queue preserves order and removes by stable id', () => {
 const remove = vi.fn(); render(<MessageQueue messages={messages} paused={false} exited={false} onPause={vi.fn()} onRemove={remove} />);
 expect(screen.getAllByRole('listitem').map(row => row.querySelector('p')!.textContent)).toEqual(messages.map(message => message.text));
 fireEvent.click(screen.getByRole('button', { name: 'Retirer le message 2 de la file' })); expect(remove).toHaveBeenCalledWith('second');
});
test('pause and resume expose the next state; stopped agents cannot resume', () => {
 const pause = vi.fn(); const props = { messages, onPause: pause, onRemove: vi.fn() };
 const { rerender } = render(<MessageQueue {...props} paused={false} exited={false} />);
 fireEvent.click(screen.getByRole('button', { name: 'Mettre la file en pause' })); expect(pause).toHaveBeenLastCalledWith(true);
 rerender(<MessageQueue {...props} paused exited={false} />); expect(screen.getByRole('status').textContent).toBe('En pause');
 fireEvent.click(screen.getByRole('button', { name: 'Reprendre la file' })); expect(pause).toHaveBeenLastCalledWith(false);
 pause.mockClear(); rerender(<MessageQueue {...props} paused exited />);
 expect(screen.getByRole('status').textContent).toBe('Agent arrêté');
 fireEvent.click(screen.getByRole('button', { name: 'Reprendre la file' })); expect(pause).not.toHaveBeenCalled();
});
test('empty queue does not leave a frame', () => {
 const { container } = render(<MessageQueue messages={[]} paused={false} exited={false} onPause={vi.fn()} onRemove={vi.fn()} />);
 expect(container.innerHTML).toBe('');
});
