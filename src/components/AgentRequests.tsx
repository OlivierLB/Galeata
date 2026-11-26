import { Button, TextArea, TextInput } from './ui/Controls.tsx';
import { useState } from 'react';
import type { ChatItem, PlanAnswer, Question, QuestionsAnswer } from '../agents/types.ts';
import { Markdown } from './Markdown.tsx';
import { Icon } from './Icon.tsx';

export interface RequestActions {
  onAnswer: (
    item: ChatItem,
    answer: PlanAnswer | QuestionsAnswer,
    status: ChatItem['status'],
    summary?: string,
  ) => void;
  onSend: (text: string) => void;
}

const planStatus: Partial<Record<NonNullable<ChatItem['status']>, string>> = {
  approved: 'Plan approuvé : l’agent le met en œuvre.',
  refined: 'Retour envoyé : l’agent révise le plan.',
  closed: 'Demande close.',
};

/**
 * A plan proposed by the agent: readable, then approved (with or without
 * automatic file edits) or sent back with feedback.
 */
export function PlanCard({ item, actions }: { item: ChatItem; actions: RequestActions }) {
  const [feedback, setFeedback] = useState('');
  const pending = item.status === 'pending';
  // Codex plans (and plans from history) are not a request: offer to act on them.
  const ready = item.status === 'ready';
  const approve = (acceptEdits: boolean) =>
    actions.onAnswer(item, { kind: 'plan', approve: true, acceptEdits }, 'approved');
  const refine = () => {
    const text = feedback.trim();
    if (pending)
      actions.onAnswer(
        item,
        { kind: 'plan', approve: false, acceptEdits: false, feedback: text },
        'refined',
        text,
      );
    else if (text) actions.onSend(text);
    setFeedback('');
  };
  return (
    <section
      className={`chat-item plan-card ${pending || ready ? 'open' : ''}`}
      aria-label="Plan proposé"
    >
      <header>
        <Icon name="plan" size={15} />
        <strong>{pending ? 'Plan proposé : à valider' : 'Plan'}</strong>
        {item.path ? <span className="plan-path">{item.path}</span> : null}
      </header>
      <div className="plan-body">
        <Markdown text={item.text} />
      </div>
      {pending || ready ? (
        <footer>
          <div className="plan-actions">
            {pending ? (
              <>
                <Button
                  variant="primary"
                  title="Les modifications de fichiers seront acceptées automatiquement pour cette conversation"
                  onClick={() => approve(true)}
                >
                  <Icon name="check" size={14} /> Approuver et lancer
                </Button>
                <Button className="text-button" onClick={() => approve(false)}>
                  Approuver, en validant chaque modification
                </Button>
              </>
            ) : (
              <Button
                variant="primary"
                onClick={() => {
                  actions.onSend('Mets en œuvre ce plan.');
                  actions.onAnswer(
                    item,
                    { kind: 'plan', approve: true, acceptEdits: false },
                    'approved',
                  );
                }}
              >
                <Icon name="play" size={14} /> Mettre en œuvre
              </Button>
            )}
          </div>
          <div className="plan-feedback">
            <TextArea
              aria-label="Modifications à apporter au plan"
              placeholder="Que faut-il changer ? (optionnel)"
              rows={2}
              value={feedback}
              onChange={(event) => setFeedback(event.target.value)}
            />
            <Button className="text-button" disabled={ready && !feedback.trim()} onClick={refine}>
              Continuer à planifier
            </Button>
          </div>
        </footer>
      ) : item.status && planStatus[item.status] ? (
        <p className="request-status">
          <Icon name={item.status === 'approved' ? 'check' : 'history'} size={13} />
          {planStatus[item.status]}
          {item.answer ? ` « ${item.answer} »` : ''}
        </p>
      ) : null}
    </section>
  );
}

/** Questions from the agent, answered with one click when possible. */
export function QuestionCard({ item, actions }: { item: ChatItem; actions: RequestActions }) {
  const questions = item.questions ?? [];
  const [selected, setSelected] = useState<Record<string, string[]>>({});
  const [other, setOther] = useState<Record<string, string>>({});
  const pending = item.status === 'pending';
  const values = (q: Question) => {
    const free = other[q.id]?.trim();
    return [...(selected[q.id] ?? []), ...(free ? [free] : [])];
  };
  const submit = (override?: Record<string, string[]>) => {
    const answers = questions.map((q) => ({ id: q.id, values: override?.[q.id] ?? values(q) }));
    const summary = answers.map((a) => a.values.join(', ')).join(' · ');
    actions.onAnswer(item, { kind: 'questions', answers }, 'answered', summary);
  };
  // One single-choice question without free text: a click is the answer.
  const instant = questions.length === 1 && !questions[0].multiSelect;
  const complete = questions.every((q) => values(q).length > 0);

  return (
    <section className="chat-item question-card" aria-label="Question de l’agent">
      {questions.map((q) => (
        <fieldset key={q.id} disabled={!pending}>
          <legend>
            {q.header ? <span className="question-header">{q.header}</span> : null}
            {q.question}
          </legend>
          <div className="question-options" role={q.multiSelect ? 'group' : 'radiogroup'}>
            {q.options.map((option) => {
              const checked = (selected[q.id] ?? []).includes(option.label);
              return (
                <Button
                  key={option.label}
                  role={q.multiSelect ? 'checkbox' : 'radio'}
                  aria-checked={checked}
                  className={`question-option ${checked ? 'checked' : ''}`}
                  onClick={() => {
                    const next = q.multiSelect
                      ? checked
                        ? (selected[q.id] ?? []).filter((label) => label !== option.label)
                        : [...(selected[q.id] ?? []), option.label]
                      : [option.label];
                    setSelected((previous) => ({ ...previous, [q.id]: next }));
                    if (instant && !other[q.id]?.trim()) submit({ [q.id]: next });
                  }}
                >
                  <strong>{option.label}</strong>
                  {option.description ? <span>{option.description}</span> : null}
                </Button>
              );
            })}
          </div>
          {q.allowOther ? (
            <TextInput
              className="question-other"
              aria-label={`Autre réponse : ${q.question}`}
              placeholder={q.options.length ? 'Autre réponse…' : 'Votre réponse…'}
              value={other[q.id] ?? ''}
              onChange={(event) =>
                setOther((previous) => ({ ...previous, [q.id]: event.target.value }))
              }
              onKeyDown={(event) => {
                if (event.key === 'Enter' && complete) submit();
              }}
            />
          ) : null}
        </fieldset>
      ))}
      {pending ? (
        instant && !questions[0]?.allowOther ? null : (
          <Button variant="primary" disabled={!complete} onClick={() => submit()}>
            Répondre
          </Button>
        )
      ) : (
        <p className="request-status">
          <Icon name="check" size={13} />
          {item.status === 'answered' ? `Réponse : ${item.answer ?? ''}` : 'Question close.'}
        </p>
      )}
    </section>
  );
}
