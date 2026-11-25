# Galeata centré sur l'IA : chat natif Codex / Claude

## Contexte

Olivier (2026-11-24) : « le plus visible doit être par défaut l'IA, voir le code est secondaire, l'intégration Codex / Claude est la pièce maîtresse, pas une copie de VS Code ».

Aujourd'hui : l'éditeur Monaco occupe le centre ; Codex/Claude ne sont que des TUI dans le petit terminal du bas (`App.tsx::launchAgent` → `terminal.rs::start`), le lancement est caché dans le 4e onglet de la barre latérale.

Décisions d'Olivier :
- **Chat natif Galeata** : Galeata pilote les CLI en mode structuré et dessine sa propre conversation.
- **Code dans un volet à droite**, fermé par défaut, ouvert à la demande (clic, ou `ui.open_file` / `ui.show_diff` de l'agent).
- **Plusieurs agents : onglets + affichage côte à côte (2)**.

## Interfaces structurées disponibles (vérifié sur ce poste)

- **Claude Code 2.1.331** : `claude -p --input-format stream-json --output-format stream-json --include-partial-messages --permission-prompts host --mcp-config <json> [--session-id <uuid> | --resume <id>]`. Conversation multi-tours via stdin, permissions renvoyées à l'hôte (protocole de contrôle SDK). Forme exacte des messages à capturer (phase 0).
- **Codex 0.172.0** : `codex app-server` (JSON-RPC stdio, expérimental). Schéma générable localement : `codex app-server generate-json-schema --out DIR` → 110 requêtes client (`initialize`, `thread/start`, `thread/resume`, `turn/start`, `turn/steer`, `turn/interrupt`, `thread/list`…), 87 notifications (`item/started|completed`, `item/agentMessage/delta`, `item/commandExecution/outputDelta`, `turn/diff/updated`, `turn/plan/updated`, `thread/tokenUsage/updated`…), 10 requêtes serveur d'approbation (`item/commandExecution/requestApproval`, `item/fileChange/requestApproval`, `item/tool/requestUserInput`…).
- Sur ce poste `codex` est une fonction zsh → `codex-headroom` (`headroom wrap codex … -- "$@"`). Le programme lancé doit donc être **configurable**.

## Architecture cible

### Backend Rust : nouveau module `src-tauri/src/agents.rs`
- Gestionnaire de processus agents (un par conversation), arguments structurés, sans shell, arrêt du groupe de processus (réutiliser `workspace::kill_group`), lignes JSON bornées en taille.
- Adaptateurs `claude` (stream-json) et `codex` (app-server JSON-RPC) qui **normalisent** vers un modèle d'événements Galeata unique, émis par `app.emit("agent:event", …)` :
  `status` · `message_delta` · `message` · `reasoning` · `tool` (début / sortie / fin : commande, édition de fichier, appel MCP) · `file_change` (chemin + diff) · `plan` · `approval_request` · `turn_started` / `turn_completed` · `usage` · `error`.
- Méthodes `dispatch` (UI uniquement, `if !agent`) : `agent.start {provider, resumeId?}`, `agent.send {id, text}`, `agent.interrupt {id}`, `agent.respond {id, requestId, decision}`, `agent.stop {id}`, `agent.list`.
- Config MCP Galeata injectée comme pour les TUI (`terminal.rs`) → le plan et l'activité continuent de fonctionner.
- Transcription normalisée persistée en SQLite (nouvelle table) pour réafficher une conversation ; la reprise réelle passe par l'identifiant natif (session Claude / thread Codex).
- Préférences : commande de lancement par fournisseur (défaut : `claude`, `codex` ; possible `codex-headroom`).

### Front
- **Centre = `AgentWorkspace`** : onglets de conversations + bouton « côte à côte » (2 conversations). Écran d'accueil : gros boutons « Nouvelle conversation Claude / Codex » + sessions récentes à reprendre.
- **`AgentChat`** : fil de messages (texte en streaming, markdown simple), cartes d'outils (commande + sortie repliable, fichier modifié → « Voir le diff » dans le volet droit), **cartes d'approbation** (Autoriser une fois / Refuser / Toujours pour la session), composeur (Entrée envoie, Maj+Entrée nouvelle ligne, bouton Interrompre), statut et consommation.
- **Volet droit à onglets** : Plan | Changements (fichiers modifiés par le tour, Git) | Code (Monaco, ouvert à la demande). Redimensionnable (Splitter existant).
- **Barre latérale gauche par défaut = Agents** (conversations actives avec statut, sessions à reprendre). Fichiers / Recherche / Git restent accessibles mais ouvrent dans le volet droit.
- Terminal du bas : replié par défaut ; « Ouvrir en TUI » reste disponible par conversation (repli si une fonction manque au mode structuré).

## Phases (chacune vérifiée et commitable séparément)

0. **Capture des protocoles** : script rejouable `scripts/capture-agent-protocol.mjs` qui lance chaque CLI en mode structuré avec un prompt trivial, enregistre les flux bruts dans `tests/fixtures/agents/` (Claude : message simple, outil Read, demande de permission ; Codex : idem). ⚠ consomme un peu de quota sur tes comptes → accord demandé.
1. **Backend Claude** : `agents.rs` + adaptateur Claude + tests de normalisation sur les fixtures.
2. **Front chat + nouvelle disposition** : `AgentWorkspace`, `AgentChat`, volet droit à onglets, barre latérale Agents par défaut ; aperçu navigateur avec une conversation d'exemple rejouée depuis les fixtures (tests Playwright).
3. **Backend Codex** : adaptateur app-server (initialize → thread/start|resume → turn/start, approbations) + tests sur fixtures.
4. **Multi-agent et reprise** : côte à côte, transcription persistée, reprise depuis les sessions découvertes, repli TUI.
5. **Docs** : `docs/agents.md` (modèle d'événements, versions de CLI validées), README, `docs/validation.md`, `CLAUDE.md`.

## Vérification

- Rust : `cargo test` (normalisation sur fixtures, cycle de vie des processus avec un faux CLI qui rejoue une fixture), `cargo clippy`, `cargo fmt --check`. Nécessite les libs GTK/WebKit (apt, à lancer par Olivier).
- Front : `npm test`, `npm run build`, Playwright (conversation rejouée en aperçu : streaming, carte d'outil, approbation, ouverture du diff dans le volet droit, côte à côte).
- Natif : `npm run desktop`, vraie conversation Claude puis Codex, approbation, interruption, reprise.

## Questions ouvertes

- Rendu markdown : petite dépendance (`marked` + assainissement) ou rendu maison minimal ?
- Codex via Headroom par défaut sur ce poste ?

## Hors périmètre

- Autres fournisseurs (Gemini, API directe), sélection fine des modèles, statistiques de coût avancées, sync cloud.

## Journal

- 2026-11-24 : interfaces des CLI vérifiées localement, schéma Codex généré (scratchpad), plan rédigé.
- 2026-11-24 : validé par Olivier : capture lancée, Codex **brut** par défaut (pas Headroom), markdown via `marked` + DOMPurify.
- 2026-11-24 : **phase 0 faite**. `scripts/capture-agent-protocol.mjs` → `tests/fixtures/agents/claude.jsonl` (78 lignes) et `codex.jsonl` (166 lignes), 3 tours chacun, anonymisés (scan : aucune donnée personnelle). Coût Claude ≈ 0,12 $ par capture.
  - Claude : `--permission-prompts host` **ne suffit pas** (refus automatique `permission_denied`). Il faut `--permission-prompt-tool stdio` (absent de `--help`) **et** un `control_request {subtype: initialize}` en premier. Ensuite `control_request can_use_tool` → `control_response {behavior: allow, updatedInput}`. `system/init` est réémis à chaque tour. Le streaming passe par `stream_event` (text_delta, input_json_delta, thinking_delta). Fin de tour : `result` (coût, usage, session_id).
  - Codex : `initialize` → notification `initialized` → `thread/start {cwd, approvalPolicy, sandbox, ephemeral}` → `turn/start {threadId, input:[{type:text,text}]}`. Items `userMessage` / `agentMessage` (phase `commentary` | `final_answer`) / `reasoning` / `commandExecution` / `fileChange`. Approbation : requête serveur `item/fileChange/requestApproval` (id 0) → réponse `{decision: accept}`, puis `serverRequest/resolved`. `turn/diff/updated` donne le diff unifié du tour. Les hooks utilisateur sont exécutés (`hook/started|completed`).
- ~~Ajustement d'architecture proposé~~ (abandonné, voir l'entrée suivante) : la normalisation des protocoles se fait **en TypeScript** (`src/agents/claude.ts`, `src/agents/codex.ts`). Elle est testable dès maintenant avec `node --test` sur les fixtures, et l'aperçu navigateur peut rejouer une conversation. Le Rust (`agents.rs`) devient un transport : cycle de vie du processus, lignes JSON bornées, écriture sur stdin, arrêt du groupe, persistance de la transcription. Il reste la seule frontière qui lance des processus.
- Prochaine étape : phase 1 bis, adaptateurs TS + tests sur fixtures, puis UI chat en aperçu. Le transport Rust attend toujours les libs GTK/WebKit (apt par Olivier).
- 2026-11-24 : **règle d'Olivier : la performance prime sur tous les choix techniques.** La normalisation revient en **Rust**, pour filtrer le bruit et regrouper avant l'IPC ; elle vit dans une bibliothèque pure, `src-tauri/crates/agent-protocol` (serde + libc, sans Tauri), testable sans GTK.
  - `event.rs` : modèle `AgentEvent` (camelCase, ~20 variantes) et `coalesce` (fusionne les deltas adjacents, garde le dernier diff et le dernier usage).
  - `claude.rs`, `codex.rs` : adaptateurs `Protocol` (start / handle_line / send_text / respond / interrupt). Désérialisation empruntée sur le chemin chaud ; bruit (hooks, quotas, init répété, deltas d'entrée d'outil) jeté ; sorties bornées (256 Kio d'outil, 512 Kio de diff) ; requêtes non gérées refusées explicitement pour ne jamais bloquer l'agent ; Codex met les messages en file tant que le thread n'est pas prêt.
  - `process.rs` : transport `Agent` (groupe de processus, ligne max 32 Mio lue sans tout charger, lots vidés dès que le lecteur a rattrapé le flux, ou toutes les 16 ms / 512 événements, `stop` = SIGTERM puis SIGKILL sur le groupe après 3 s, `Exited` toujours en dernier avec la fin de stderr).
  - Vérifié : 15 tests (unitaires, rejeu des fixtures avec réponses identiques à celles acceptées par les vraies CLI, bout en bout avec `tests/fake_cli.py`, arrêt du groupe), stables sur 3 exécutions ; clippy `-D warnings` OK ; rustfmt OK. Débit release : Claude ≈ 590 k lignes/s, Codex ≈ 1,07 M lignes/s (> 300 Mo/s).
  - CI, `docs/validation.md`, `CLAUDE.md` : cargo test/clippy en `--workspace`, fmt en `--all`.
- Suite :
  1. Liaison Tauri dans `lib.rs` : méthodes `agent.start/send/respond/interrupt/stop/list`, émission `agent:events {agentId, events}`, programme et arguments (config MCP Galeata, `--resume` / `--session-id`). **Bloqué localement** par l'absence des libs GTK/WebKit.
  2. Front (possible dès maintenant en aperçu) : magasin externe par conversation (`useSyncExternalStore`), seul le message en cours se re-rend, regroupement par `requestAnimationFrame`, markdown seulement pour les messages terminés, `content-visibility: auto`, Monaco et xterm chargés uniquement à l'ouverture du volet. Aperçu : rejeu des événements normalisés produits par un exemple Rust à partir des fixtures.
- 2026-11-24 : Olivier : **Claude Code et Codex sont optionnels, un seul suffit**. L’accueil ne guide que si aucun n’est installé, et le choix du fournisseur pour une nouvelle conversation ne montre que ceux qui sont présents. Voir `.claude/plans/installation-simple.md`.
- 2026-11-24 : **première tranche visible livrée et installée en local.**
  - Rust : `src-tauri/src/agents.rs` (agent.start / send / respond / interrupt / close / list, événements `agent:events`, arrêt à la fermeture, changement de projet refusé si un agent tourne). Bug trouvé et corrigé : les `message_delta` de Claude n'ont pas de `type` dans `delta`, ce qui produisait un `notice` parasite par message ; les tests vérifient maintenant l'absence de ligne non comprise.
  - Front : `src/agents/` (types, magasin hors React avec copie à l'écriture, notification une fois par image, tampon des événements reçus avant la création, API, rejeu de démo), `AgentWorkspace` (onglets, côte à côte, accueil, installation guidée si aucune CLI, reprise de sessions), `AgentChat` (streaming en texte brut, markdown à la fin, cartes d'outils et d'autorisation, interruption), `Markdown` (marked + DOMPurify, liens non suivis).
  - Disposition : chat au centre ; volet de code à droite ouvert à la demande (fichier, diff, détail distant), fermable ; terminal replié par défaut (visibilité mémorisée) ; barre latérale sur Agents ; la conversation garde au moins 360 px.
  - Vérifié : 15 tests Rust + `build-linux-docker.sh check` (fmt, clippy -D warnings, tests du workspace complet), 13 tests JS, 5 Playwright (dont la conversation rejouée), build, captures, build Docker et installation par `install.sh`.
  - Pas encore vérifié : vraie conversation Claude ou Codex dans l'application installée (test d'Olivier).
- 2026-11-24 : retours d'Olivier sur la première version installée, traités :
  1. **Claude introuvable et « Reprendre » grisé** : l'AppImage injecte `PYTHONHOME`, `LD_LIBRARY_PATH`, `PERLLIB`, `GTK_*`… dans tous les sous-processus ; le `claude` d'Olivier est un lanceur Python (docker-stack), qui plantait. Correction : `galeata_agent_protocol::host_env` retire tout ce qui pointe dans `APPDIR` (agents, commandes, terminal). Preuve sur l'environnement réel : `claude --version` passe de exit 1 à exit 0. La détection garde maintenant la raison de l'échec (`error`), affichée dans l'interface.
  2. Titre « <local-command-caveat>… » : les messages techniques (balises, `isMeta`) sont ignorés pour le titre des sessions.
  3. Choix Claude/Codex en cartes → **un seul « + »** qui lance l'agent par défaut, réglable dans Préférences (« Agent par défaut », mémorisé ; repli sur l'autre si absent).
  4. **Diff éditable** : un diff non indexé ouvre le fichier de travail ; le côté droit se modifie et s'enregistre (Ctrl+S, bouton). Seul le diff indexé reste en lecture seule.
  - Vérifié : Rust (Docker : fmt, clippy, 11 + 7 + 6 + 4 tests), 13 tests JS, 7 Playwright (dont « + », préférence et diff éditable), installé (`versions/3cffe3a33ce0bc07`).
- 2026-11-24 : **« Reprendre » n'affichait rien.** La reprise de l'agent fonctionnait (`claude … --resume 6e46ad76…` lancé dans le bon projet), mais en mode structuré aucune des deux CLI ne renvoie les anciens messages. Correction :
  - Claude : `claude_history` lit `~/.claude/projects/*/<id>.jsonl` (sans sous-agents, méta, blobs de requêtes ni messages techniques) ; l'historique est envoyé avant le lancement.
  - Codex : la réponse à `thread/resume` contient les tours complets ; ils passent par l'adaptateur existant.
  - Historique borné : 1 200 derniers événements, sorties 4 Kio, diffs 16 Kio, outils sans résultat fermés.
  - Mesuré sur les vraies sessions d'Olivier (`examples/history.rs`, n'affiche aucun contenu) : Claude 6 messages / 13 réponses / 50 outils, 3,6 ms, 81 Kio ; Codex reprise réelle en 0,55 s, 7 messages / 32 réponses / 321 outils, 682 Kio.
  - Installé : `versions/3f823a1894983531`.
- 2026-11-24 : « Reprendre une session » : titre = nom donné (Claude `agent-name`/`custom-title`, Codex `~/.codex/session_index.jsonl`) sinon titre généré (`ai-title`) sinon première demande ; description = dernière demande ; branche Git (Claude) ; ligne entière cliquable. Test Rust + Playwright, installé.
- 2026-11-24 : **plans et questions repensés** (retour d'Olivier : « pas intuitif du tout », le plan Claude arrivait comme une autorisation d'outil avec du JSON brut).
  - Protocole vérifié avec Claude Code 2.1.331 (nouvelles captures `claude-plan.jsonl`, `claude-question.jsonl`, scénarios `--scenario plan|question` du script de capture) : `ExitPlanMode` → `allow` + `updatedPermissions: [{type: setMode, mode: acceptEdits|default}]` ; refus = `deny` + message (retour) ; `AskUserQuestion` → `updatedInput.answers = {<texte de la question>: "<libellé>"}`.
  - Codex : `item/tool/requestUserInput` (jusqu'ici refusé !) → carte question, réponse `{answers: {<id>: {answers: [..]}}}` ; éléments `plan` → carte « Mettre en œuvre ».
  - Événements `PlanProposal`, `Plan`, `Question` + `Protocol::answer` ; appels `ExitPlanMode`, `AskUserQuestion` et `ToolSearch` masqués des cartes d'outils (direct et historique).
  - UI : carte plan (markdown, « Approuver et lancer » = modifications acceptées pour la session, « Approuver en validant chaque modification », champ « Que faut-il changer ? » + « Continuer à planifier ») ; carte question (options cliquables avec description, réponse en un clic pour une question unique, « Autre réponse… ») ; la décision reste affichée.
  - Vérifié : Rust Docker (12 + 9 + 10 + 4 tests, dont réponses identiques octet pour octet aux captures acceptées), 15 tests JS, 9 Playwright, installé.
- 2026-11-24 : **autorisations trop fréquentes et modes « du strict à l'open bar ».**
  - Cause : dans son terminal, Olivier travaille en mode `auto` (19 des 21 dernières sessions) ; Galeata lançait Claude en mode par défaut. Ses 103 règles étaient bien chargées, mais `RTK_DISABLED=1 git diff … | head` n'en couvre aucune.
  - Vérifié avec le vrai Claude Code (capture `claude-auto.jsonl`) : en `auto`, cette commande passe sans demande. `set_permission_mode` fonctionne en cours de session (sans appel au modèle) ; `bypassPermissions` exige `--allow-dangerously-skip-permissions` au lancement (qui le rend seulement disponible).
  - Modes, mêmes identifiants pour les deux agents : Claude Plan / Demander / Modifs auto / Auto / Sans limite ; Codex Lecture seule / Demander / Auto / Accès complet (`approvalPolicy` + `sandboxPolicy` à chaque tour). Mode au démarrage dans les préférences (Auto par défaut), sélecteur par conversation, Maj+Tab (sans jamais atteindre les modes « danger »), événement `Mode` qui suit le mode réel.
  - Carte d'autorisation refaite : « Claude Code veut exécuter une commande », explication de l'agent, commande affichée une seule fois, « Toujours… » avec sa vraie portée (conversation / projet sur ce poste / tous les projets), « Refuser… » avec consigne, raccourci « Passer en mode Auto ».
  - Vérifié : Rust Docker (12 + 9 + 13 + 4), 15 tests JS, 10 Playwright, installé (`versions/d82ea58f04bdd83f`).
- 2026-11-24 : **deux modes de travail** (demande d’Olivier) : mode IA = conversation au centre, fichiers à la demande dans le volet de droite ; mode Git (panneau Contrôle de source) = relecture du code au centre, conversation masquée mais intacte (agents actifs, brouillon conservé), volet de code refermé en revenant. Implémentation : `codeArea` unique affiché à droite ou au centre. Vérifié : 15 tests JS, 11 Playwright (dont le passage IA → Git → IA), installé.
- 2026-11-24 : **plan de mission automatique** (demande d'Olivier : se remplir avec les plans proposés et se mettre à jour à chaque message).
  - Constat sur ses 80 dernières sessions : Claude n'utilise jamais d'outil de tâches, Codex jamais `update_plan`. Capture `claude-todo` : Claude Code 2.1.331 piloté n'a **aucun** outil de tâches. Les outils natifs ne sont donc pas exploitables.
  - Retenu : les outils MCP de Galeata. Sondes réelles (`scripts/probe/`) : Claude voit `mcp__galeata__plan_get` (points → `_`) et les appelle sans demande en mode Auto ; Codex demandait une autorisation (`mcpServer/elicitation/request`, que Galeata refusait), réglé par `-c mcp_servers.galeata.default_tools_approval_mode="approve"` (le réglage par outil ne marche pas).
  - Ajouts : `plan_from_markdown` (crate, testé sur la capture et le vrai plan Helpdesk), `Store::set_plan` (garde l'état des étapes inchangées), outil MCP `plan.set`, consigne `PLAN_INSTRUCTIONS` (Claude `--append-system-prompt` + `--allowedTools mcp__galeata` ; Codex `developerInstructions`), plan proposé → plan de mission côté Rust, appels `plan.*` masqués de la conversation.
  - Vérifié en réel, tâche sans rapport avec le plan : Claude et Codex font plan.get → plan.set → update_step début/fin pour chaque étape, sans aucune demande. Batterie : Rust Docker (13 + 12 + 14 + 4), 15 JS, 11 Playwright. Installé (`versions/5c089f374bb5d86f`).
  - Aussi : le mode choisi à la main dans une conversation devient celui des suivantes (préférences mises à jour).
- 2026-11-24 : plan de la conversation reprise absent du panneau : l’historique Claude était envoyé sans passer par la synchronisation ; corrigé (dernier plan de l’historique → plan). Vérifié sur la vraie session « Filtres customer-service et personnalisation » (33cc21a5…) : objectif + 4 étapes (outil `examples/plan.rs`). Panneau renommé « Avancement » et refait (objectif, source et date de mise à jour, barre, étape en cours mise en avant, liste à cocher compacte, état vide explicite, vérifications en simple lien). Installé.
- 2026-11-24 : le panneau (renommé « Plan ») affiche le **plan complet** (champ `document` du plan, rempli par le plan proposé ou par `plan.set`), avec l’état de chaque étape à sa place dans le texte (`src/planDocument.ts`, même nettoyage des titres que le Rust) ; étapes non décrites par le texte listées en dessous. Le texte est gardé lors des mises à jour d’avancement, abandonné si l’objectif change. Vérifié : Rust Docker, 17 JS (dont découpage du plan), 12 Playwright ; capture avec le vrai plan Helpdesk. Installé.
