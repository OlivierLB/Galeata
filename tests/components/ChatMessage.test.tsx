import { afterEach, expect, test } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import ChatMessage from '../../src/components/ChatMessage';
afterEach(cleanup);
test('outgoing messages preserve text without an extra header or actions', () => {
 const text = 'Première ligne\nDeuxième ligne <script>texte</script>';
 const { container } = render(<ChatMessage side="user">{text}</ChatMessage>);
 expect(screen.getByLabelText('Votre message').className).toContain('chat-user');
 expect(container.querySelector('.chat-bubble')!.textContent).toBe(text);
 expect(container.querySelector('script, button, header')).toBeNull();
});
test('incoming messages keep their rich content in the shared shell', () => {
 const { rerender } = render(<ChatMessage side="assistant"><pre>const value = 1;</pre></ChatMessage>);
 expect(screen.getByLabelText('Message de l’agent').className).toContain('chat-assistant');
 expect(screen.getByText('const value = 1;').tagName).toBe('PRE');
 rerender(<ChatMessage side="assistant"><p>Réponse complète</p></ChatMessage>);
 expect(screen.getByText('Réponse complète').tagName).toBe('P');
});
