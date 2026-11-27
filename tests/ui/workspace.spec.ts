import { expect, test } from '@playwright/test';

for (const provider of ['claude', 'codex'] as const) {
  test(`select the ${provider} model independently for each AI conversation`, async ({ page }) => {
    await page.addInitScript(
      (preferred) => localStorage.setItem('galeata:default-agent', preferred),
      provider,
    );
    await page.goto('/');
    await page
      .getByRole('button', { name: 'Nouvelle conversation de démonstration', exact: true })
      .click();
    const name = provider === 'claude' ? 'Modèle Claude Code' : 'Modèle Codex';
    const picker = page.locator('summary').and(page.getByLabel(name, { exact: true }));
    await picker.click();
    await page.getByRole('radiogroup', { name, exact: true }).getByRole('radio', { name: provider === 'claude' ? 'Opus (démo)' : 'Codex rapide (démo)', exact: true }).click();
    await expect(picker).toContainText(provider === 'claude' ? 'Opus' : 'Codex rapide');
    const other = provider === 'claude' ? 'Modèle Codex' : 'Modèle Claude Code';
    await expect(page.locator('summary').and(page.getByLabel(other, { exact: true }))).toHaveCount(0);
    await page.getByRole('button', { name: 'Nouvelle conversation', exact: true }).click();
    await page.getByRole('button', { name: 'Nouvelle conversation de démonstration', exact: true }).click();
    await expect(picker).toContainText(provider === 'claude' ? 'Sonnet' : 'Codex');
    await page.getByRole('tablist', { name: 'Conversations' }).getByRole('tab').first().click();
    await expect(picker).toContainText(provider === 'claude' ? 'Opus' : 'Codex rapide');
    const composer = page.getByRole('textbox', { name: 'Message à l’agent' });
    await composer.fill('Réponds exactement : ok');
    await composer.press('Enter');
    await expect(page.locator('.chat-assistant')).toHaveText('ok');
    await expect(picker).toContainText(provider === 'claude' ? 'Opus' : 'Codex rapide');
  });
}

test('explorer, rechercher et ouvrir un fichier sans annoncer de connexion locale', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByText('APERÇU INTERFACE')).toBeVisible();
  await expect(page.getByRole('complementary', { name: 'Plan', exact: true })).toBeVisible();
  await page.keyboard.press('Control+p');
  await page.getByRole('textbox', { name: 'Fichier ou action' }).fill('App.tsx');
  await page.getByRole('button', { name: 'src/App.tsx', exact: true }).click();
  await expect(page.getByRole('tab', { name: /App.tsx/ })).toBeVisible();
  await page.getByRole('button', { name: 'Agents et sessions', exact: true }).click();
  await expect(page.locator('.agent-home')).toBeVisible();
  expect(errors).toEqual([]);
});

test('modifier le plan, retrouver son historique et le conserver après rechargement', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Modifier l’objectif' }).click();
  await page
    .getByRole('textbox', { name: 'Objectif', exact: true })
    .fill('Livrer une mission vérifiable');
  await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Livrer une mission vérifiable' })).toBeVisible();
  await page.getByRole('button', { name: 'Ajouter une étape' }).click();
  await page.getByRole('textbox', { name: 'Nouvelle étape' }).fill('Relire les changements');
  await page.getByRole('button', { name: 'Ajouter', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Relire les changements' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Livrer une mission vérifiable' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Relire les changements' })).toBeVisible();
});

test('le plan reste visible et les actions sont accessibles au clavier', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('complementary', { name: 'Plan', exact: true })).toBeVisible();
  await page.keyboard.press('Control+p');
  await expect(page.getByRole('dialog', { name: 'Fichiers et actions' })).toBeVisible();
});

test('le plan se redimensionne au clavier', async ({ page }) => {
  await page.goto('/');
  const separator = page.getByRole('separator', { name: 'Largeur du plan' });
  await expect(separator).toBeVisible();
  await separator.focus();
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByRole('complementary', { name: 'Plan', exact: true })).toBeVisible();
});

test('l’IA au centre : conversation rejouée, outil, autorisation et code à la demande', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  // Code and terminal are secondary: hidden until asked for.
  await expect(page.getByRole('region', { name: 'Volet de code' })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Terminal et activité' })).toHaveCount(0);
  // One "+" (and the home button) starts the default agent; the preview replays a demo.
  await expect(
    page.getByRole('button', { name: 'Nouvelle conversation', exact: true }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Nouvelle conversation de démonstration', exact: true })
    .click();
  const chat = page.getByRole('region', { name: 'Conversation Claude Code' });
  await expect(chat).toBeVisible();
  const composer = page.getByRole('textbox', { name: 'Message à l’agent' });
  await expect(composer).toBeFocused();
  const mascot = page
    .getByRole('navigation', { name: 'Navigation principale' })
    .locator('.turtle-mascot');
  await expect(mascot).toHaveAttribute('data-animation', 'idle');

  await composer.fill('Réponds exactement : ok');
  await expect(mascot).toHaveAttribute('data-animation', 'responding');
  await composer.press('Enter');
  await expect(chat.getByText('Réponds exactement : ok')).toBeVisible();
  await expect(chat.locator('.chat-assistant').getByText('ok', { exact: true })).toBeVisible();
  await expect(mascot).toHaveAttribute('data-animation', 'success');

  await composer.fill('Lis hello.txt');
  await composer.press('Enter');
  await expect(chat.locator('.chat-tool').filter({ hasText: 'hello.txt' })).toBeVisible();
  await expect(
    chat.locator('.chat-assistant').getByText('Bonjour depuis Galeata', { exact: true }),
  ).toBeVisible();

  const textOnly = page.getByRole('button', { name: 'Texte uniquement', exact: true });
  await textOnly.click();
  await expect(textOnly).toHaveAttribute('aria-pressed', 'true');
  await expect(chat.locator('.chat-tool')).toHaveCount(0);
  await expect(
    chat.locator('.chat-assistant').getByText('Bonjour depuis Galeata', { exact: true }),
  ).toBeVisible();

  await composer.fill('Crée out.txt');
  await composer.press('Enter');
  const approval = chat.getByRole('region', { name: 'Autorisation demandée' });
  await expect(approval).toContainText('out.txt');
  await expect(mascot).toHaveAttribute('data-animation', 'waiting');
  await expect(chat.getByText('Attend votre accord')).toBeVisible();
  await approval.getByRole('button', { name: 'Autoriser', exact: true }).click();
  await expect(approval).toHaveCount(0);
  await expect(chat.getByText(/J'ai créé/)).toBeVisible();
  await expect(chat.locator('.markdown code', { hasText: 'out.txt' })).toBeVisible();

  // Requests stay actionable while tool events keep arriving out of view.
  await expect(chat.locator('.chat-tool')).toHaveCount(0);
  await textOnly.click();
  await expect(textOnly).toHaveAttribute('aria-pressed', 'false');
  await expect(chat.locator('.chat-tool').filter({ hasText: 'hello.txt' })).toBeVisible();
  await expect(chat.locator('.chat-tool').filter({ hasText: 'out.txt' })).toBeVisible();

  // Files owns the central editor; the running conversation stays mounted.
  await page.getByRole('button', { name: 'Fichiers', exact: true }).click();
  await page.getByRole('treeitem', { name: /README.md/ }).click();
  const code = page.getByRole('region', { name: 'Volet de code' });
  await expect(code).toHaveCount(0);
  const files = page.getByRole('region', { name: 'Fichiers du projet' });
  await expect(files).toBeVisible();
  await expect(files.getByRole('tab', { name: 'README.md', exact: true })).toBeVisible();
  await expect(chat).toBeHidden();
  await page.getByRole('button', { name: 'Agents et sessions', exact: true }).click();
  await expect(chat).toBeVisible();
  expect(errors).toEqual([]);
});

test('l’agent par défaut se choisit dans les préférences et reste mémorisé', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Préférences', exact: true }).click();
  const choice = page.getByRole('radiogroup', { name: 'Agent par défaut' });
  await expect(
    choice.getByRole('radio', { includeHidden: true, name: /Claude Code/ }),
  ).toHaveAttribute('aria-checked', 'true');
  await choice.getByRole('radio', { includeHidden: true, name: /Codex/ }).click();
  await page.reload();
  await page.getByRole('button', { name: 'Préférences', exact: true }).click();
  await expect(
    page
      .getByRole('radiogroup', { name: 'Agent par défaut' })
      .getByRole('radio', { includeHidden: true, name: /Codex/ }),
  ).toHaveAttribute('aria-checked', 'true');
});

test('le diff de travail se modifie directement', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Git', exact: true }).click();
  await page
    .getByRole('button', { name: /README\.md/ })
    .first()
    .click();
  const code = page.getByRole('region', { name: 'Relecture du code' });
  await expect(code.getByRole('tab', { name: /README\.md · diff/ })).toBeVisible();
  // Right side = working file: typing is accepted (no read-only message) and marks the tab dirty.
  const modified = code.locator('.editor.modified .view-lines');
  await modified.click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type('Ligne ajoutée depuis le diff');
  await expect(code.locator('.editor.modified')).toContainText('Ligne ajoutée depuis le diff');
  await expect(page.getByText('Cannot edit in read-only editor')).toHaveCount(0);
  // Preview edits are recoverable local drafts; it cannot write to the user's disk.
  await expect(code.getByRole('button', { name: 'Enregistrer le fichier' })).toBeDisabled();
  await expect(code.locator('.editor-tab .dirty-dot')).toHaveCount(1);
});

test('les sessions à reprendre montrent leur nom, la dernière demande et la branche', async ({
  page,
}) => {
  await page.goto('/');
  const resume = page.locator('.agent-resume');
  const row = resume.locator('.resume-row').first();
  await expect(row.locator('.resume-title')).toHaveText('presentation-theme-shopify');
  await expect(row.locator('.resume-description')).toHaveText(
    'Ajoute le header sticky et vérifie le menu mobile',
  );
  await expect(row.locator('.resume-meta')).toContainText('Claude Code');
  await expect(row.locator('.resume-meta')).toContainText('theme');
  await expect(row.locator('.resume-meta')).toContainText('il y a 2 h');
});

test('questions et plan proposés : options cliquables, plan lisible et décision claire', async ({
  page,
}) => {
  await page.goto('/');
  await page
    .getByRole('button', { name: 'Nouvelle conversation de démonstration', exact: true })
    .click();
  const chat = page.getByRole('region', { name: 'Conversation Claude Code' });
  const composer = page.getByRole('textbox', { name: 'Message à l’agent' });
  // The demo replays recorded turns in order: skip to the question and the plan.
  for (const text of ['un', 'deux']) {
    await composer.fill(text);
    await composer.press('Enter');
    await expect(chat.locator('.chat-assistant').last()).not.toHaveText('');
  }
  await composer.fill('trois');
  await composer.press('Enter');
  await chat
    .getByRole('region', { name: 'Autorisation demandée' })
    .getByRole('button', { name: 'Autoriser', exact: true })
    .click();

  await composer.fill('Quelle couleur ?');
  await composer.press('Enter');
  const question = chat.getByRole('region', { name: 'Question de l’agent' });
  await expect(question).toContainText('Quelle est ta couleur préférée ?');
  await expect(question.getByRole('radio', { includeHidden: true, name: /Rouge/ })).toContainText(
    'La couleur rouge',
  );
  await expect(chat.getByText('AskUserQuestion')).toHaveCount(0);
  await question.getByRole('radio', { includeHidden: true, name: /Bleu/ }).click();
  await expect(question).toContainText('Réponse : Bleu');
  await expect(chat.locator('.chat-assistant').getByText('Bleu', { exact: true })).toBeVisible();

  await composer.fill('Prépare un plan');
  await composer.press('Enter');
  const plan = chat.getByRole('region', { name: 'Plan proposé' });
  await expect(plan.locator('.plan-body h1')).toContainText('Plan');
  await expect(plan).toContainText('Plan proposé : à valider');
  await expect(chat.getByText('ExitPlanMode')).toHaveCount(0);
  await plan.getByRole('button', { name: /Approuver et lancer/ }).click();
  await expect(plan).toContainText('Plan approuvé');
  await expect(chat.locator('.chat-assistant').last()).toContainText('notes.txt');
});

test('modes d’autorisation du plus strict à « Sans limite », et autorisation lisible', async ({
  page,
}) => {
  await page.goto('/');
  await page
    .getByRole('button', { name: 'Nouvelle conversation de démonstration', exact: true })
    .click();
  const chat = page.getByRole('region', { name: 'Conversation Claude Code' });
  const modes = chat.getByRole('radiogroup', { name: 'Mode d’autorisation', includeHidden: true });
  // Auto by default, like the user's terminal.
  await expect(
    modes.getByRole('radio', { includeHidden: true, name: 'Auto', exact: true }),
  ).toHaveAttribute('aria-checked', 'true');
  await expect(modes.getByRole('radio', { includeHidden: true })).toHaveText([
    'Plan',
    'Demander',
    'Modifs auto',
    'Auto',
    'Sans limite',
  ]);
  const composer = page.getByRole('textbox', { name: 'Message à l’agent' });
  // Shift+Tab cycles but never lands on "Sans limite".
  await composer.press('Shift+Tab');
  await expect(
    modes.getByRole('radio', { includeHidden: true, name: 'Plan', exact: true }),
  ).toHaveAttribute('aria-checked', 'true');
  await chat.locator('summary').and(chat.getByLabel('Mode d’autorisation', { exact: true })).click();
  await modes.getByRole('radio', { includeHidden: true, name: 'Sans limite' }).click();
  await expect(
    modes.getByRole('radio', { includeHidden: true, name: 'Sans limite' }),
  ).toHaveAttribute('aria-checked', 'true');
  await chat.locator('summary').and(chat.getByLabel('Mode d’autorisation', { exact: true })).click();
  await modes.getByRole('radio', { includeHidden: true, name: 'Demander' }).click();

  for (const text of ['un', 'deux', 'trois']) {
    await composer.fill(text);
    await composer.press('Enter');
    if (text !== 'trois') await expect(chat.locator('.chat-assistant').last()).not.toHaveText('');
  }
  const approval = chat.getByRole('region', { name: 'Autorisation demandée' });
  await expect(approval).toContainText('Claude Code veut modifier un fichier');
  await expect(approval.locator('.approval-file')).toHaveText('out.txt');
  await expect(
    approval.getByRole('button', { name: /Accepter toutes les modifications/ }),
  ).toBeVisible();
  await expect(
    approval.getByRole('button', { name: 'Passer cette conversation en mode Auto' }),
  ).toBeVisible();
  await approval.getByRole('button', { name: 'Refuser…' }).click();
  await expect(
    approval.getByRole('textbox', { name: 'Que doit faire l’agent à la place ?' }),
  ).toBeFocused();
  await approval.getByRole('button', { name: 'Annuler' }).click();
  await approval.getByRole('button', { name: 'Autoriser', exact: true }).click();
  await expect(approval).toHaveCount(0);

  // The last mode chosen by hand is the one of the next conversations.
  await page.getByRole('button', { name: 'Nouvelle conversation', exact: true }).click();
    await page.getByRole('button', { name: 'Nouvelle conversation de démonstration', exact: true }).click();
  const next = page.locator('.agent-chat').last();
  await expect(
    next
      .getByRole('radiogroup', { name: 'Mode d’autorisation', includeHidden: true })
      .getByRole('radio', { includeHidden: true, name: 'Demander', exact: true }),
  ).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('button', { name: 'Préférences', exact: true }).click();
  await expect(
    page
      .getByRole('radiogroup', { name: 'Mode de Claude Code au démarrage' })
      .getByRole('radio', { includeHidden: true, name: 'Demander', exact: true }),
  ).toHaveAttribute('aria-checked', 'true');
});

test('conversation drafts survive tab changes and split view', async ({ page }) => {
  await page.goto('/');
  await page
    .getByRole('button', { name: 'Nouvelle conversation de démonstration', exact: true })
    .click();
  const composer = () => page.getByRole('textbox', { name: 'Message à l’agent' });
  await composer().fill('First conversation draft');
  await page.getByRole('button', { name: 'Nouvelle conversation', exact: true }).click();
    await page.getByRole('button', { name: 'Nouvelle conversation de démonstration', exact: true }).click();
  await expect(composer()).toHaveValue('');
  await composer().fill('Second conversation draft');
  const tabs = page.getByRole('tablist', { name: 'Conversations' }).getByRole('tab');
  await tabs.nth(0).click();
  await expect(composer()).toHaveValue('First conversation draft');
  await tabs.nth(1).click();
  await expect(composer()).toHaveValue('Second conversation draft');
  await tabs.nth(0).click();
  await composer().fill('First draft edited in split view');
  await composer().press('Enter');
  await expect(composer()).toHaveValue('');
  await tabs.nth(1).click();
  await tabs.nth(0).click();
  await expect(composer()).toHaveValue('');
});

test('mode IA : la conversation ; mode Git : la relecture du code au centre', async ({ page }) => {
  await page.goto('/');
  await page
    .getByRole('button', { name: 'Nouvelle conversation de démonstration', exact: true })
    .click();
  const chat = page.getByRole('region', { name: 'Conversation Claude Code' });
  const composer = page.getByRole('textbox', { name: 'Message à l’agent' });
  await composer.fill('Réponds exactement : ok');
  await composer.press('Enter');
  await expect(chat.locator('.chat-assistant')).toHaveText('ok');
  await composer.fill('brouillon en cours');

  // Git mode: code review takes the center, the conversation is hidden.
  await page.getByRole('button', { name: 'Git', exact: true }).click();
  await expect(chat).toBeHidden();
  const review = page.getByRole('region', { name: 'Relecture du code' });
  await page
    .getByRole('button', { name: /README\.md/ })
    .first()
    .click();
  await expect(review.getByRole('tab', { name: /README\.md · diff/ })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Volet de code' })).toHaveCount(0);

  // Back to AI mode: the same conversation (and draft), files closed until asked.
  await page.getByRole('button', { name: 'Agents et sessions', exact: true }).click();
  await expect(chat).toBeVisible();
  await expect(chat.locator('.chat-assistant')).toHaveText('ok');
  await expect(composer).toHaveValue('brouillon en cours');
  await expect(review).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Volet de code' })).toHaveCount(0);
});

test('le plan affiche son texte complet avec l’état de chaque étape', async ({ page }) => {
  await page.addInitScript(() => {
    const step = (id: string, title: string, status: string) => ({
      id,
      title,
      status,
      note: '',
      author: 'agent:claude',
      updatedAt: Date.now(),
    });
    localStorage.setItem(
      'galeata:preview-plan:empty',
      JSON.stringify({
        revision: 2,
        objective: 'Filtre « Demande précise »',
        document:
          '# Filtre « Demande précise »\n\n## Contexte\n\nDeux besoins.\n\n## Étapes\n\n### 1. erp-server — opérateur\n- Ajouter l’opérateur.\n\n### 2. erp-client — filtre\n- Champ après Typologie(s).\n\n## Vérification\n- PHPUnit.\n',
        steps: [
          step('s1', 'erp-server — opérateur', 'done'),
          step('s2', 'erp-client — filtre', 'in_progress'),
        ],
      }),
    );
  });
  await page.goto('/');
  const plan = page.getByRole('complementary', { name: 'Plan', exact: true });
  await expect(plan.getByRole('heading', { name: 'Filtre « Demande précise »' })).toBeVisible();
  await expect(plan).toContainText('Claude Code · mis à jour');
  await expect(plan.getByRole('heading', { name: 'Contexte' })).toBeVisible();
  await expect(plan.getByRole('heading', { name: 'Vérification' })).toBeVisible();
  const current = plan.getByRole('region', { name: 'Étape : erp-client — filtre' });
  await expect(current).toContainText('En cours');
  await expect(current).toContainText('Champ après Typologie(s).');
  await expect(
    plan.getByRole('button', { name: 'erp-server — opérateur : Terminé par l’auteur' }),
  ).toBeVisible();
  await expect(plan.getByRole('region', { name: 'Étape en cours' })).toContainText(
    'erp-client — filtre',
  );
});

test('un plan repris d’une conversation n’affiche pas un faux avancement', async ({ page }) => {
  await page.addInitScript(() => {
    const step = (id: string, title: string) => ({
      id,
      title,
      status: 'pending',
      note: '',
      author: 'galeata',
      updatedAt: Date.now(),
    });
    localStorage.setItem(
      'galeata:preview-plan:empty',
      JSON.stringify({
        revision: 1,
        objective: 'Filtre « Demande précise »',
        tracked: false,
        proposedAt: '2026-11-24T10:12:00Z',
        document:
          '# Filtre « Demande précise »\n\n## Étapes\n\n### 1. Serveur\n- a\n\n### 2. Client\n- b\n',
        steps: [step('s1', 'Serveur'), step('s2', 'Client')],
      }),
    );
  });
  await page.goto('/');
  const plan = page.getByRole('complementary', { name: 'Plan', exact: true });
  await expect(plan.getByRole('region', { name: 'Avancement non suivi' })).toBeVisible();
  await expect(plan).toContainText('Repris d’une conversation · plan proposé le 24 nov.');
  await expect(plan).not.toContainText('0 / 2');
  await expect(plan.getByRole('button', { name: 'Serveur : état inconnu' })).toBeVisible();
  // Without a running conversation, "Faire le point" explains what to do.
  await plan.getByRole('button', { name: 'Faire le point maintenant' }).click();
  await expect(page.getByText('Reprenez la conversation de ce plan')).toBeVisible();
  // A real status change (here by hand) starts tracking.
  await plan.getByRole('button', { name: 'Serveur : état inconnu' }).click();
  await expect(plan.getByRole('region', { name: 'Avancement non suivi' })).toHaveCount(0);
  await expect(plan).toContainText('0 / 2');
});
