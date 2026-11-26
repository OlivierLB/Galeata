import { TextArea } from './ui/Controls.tsx';
import { useRef } from 'react';
import type { OpenFile } from '../types.ts';

/** Recovery view if a worker or editor asset cannot load. Never discards the open buffer. */
export default function SimpleEditor({
  file,
  diff,
  onChange,
}: {
  file: OpenFile;
  diff?: { original: string; modified: string };
  onChange: (content: string) => void;
  onSave: () => void;
  line?: number;
}) {
  const numbers = useRef<HTMLPreElement>(null);
  if (diff)
    return (
      <div className="simple-diff">
        <p className="editor-fallback-notice">Éditeur simplifié · Monaco n’a pas pu être chargé.</p>
        <div>
          <section>
            <h3>Version de référence</h3>
            <pre>{diff.original}</pre>
          </section>
          <section>
            <h3>Version modifiée</h3>
            <pre>{diff.modified}</pre>
          </section>
        </div>
      </div>
    );
  return (
    <div className="simple-editor">
      <div className="editor-fallback-notice">
        Éditeur simplifié · Monaco n’a pas pu être chargé.
      </div>
      <div className="simple-editor-body">
        <pre ref={numbers} aria-hidden="true">
          {file.content
            .split('\n')
            .map((_, index) => index + 1)
            .join('\n')}
        </pre>
        <TextArea
          spellCheck={false}
          aria-label={`Éditeur ${file.path}`}
          value={file.content}
          onScroll={(event) => {
            if (numbers.current) numbers.current.scrollTop = event.currentTarget.scrollTop;
          }}
          onChange={(event) => onChange(event.target.value)}
        />
      </div>
    </div>
  );
}
