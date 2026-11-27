[Français](../fr/mascot.md) · [English](mascot.md)

> Automatically translated from French with Argos Translate. The French version is the reference; the application interface is currently in French.

<a id="mascotte-tortue"></a>

# Turtle mascot

The turtle appears small at the bottom of the navigation bar, instead of the old personal space. It remains visible on each page and follows the actual actions of the application. An authorization, question or plan to be validated remain a priority, even in another conversation. Its condition is available on the fly-by and for screen readers, without wording under the character. The events of Claude Code and Codex remain taken into account when the commands are hidden in mode « Texte uniquement ».

| Event | Animation |
| --- | --- |
| Rest | Eyes around her |
| Reflecting or starting the agent | Reflection |
| Answer or change of text | Writing |
| Writing a file by theAI | Writing |
| Play files or search by lAI | Reflection |
| Execution of a tool | Breakdance |
| Git command in progress (fetch, pull, push, commit, branch, merger, stash, index...) | Breakdance until end of request |
| Commit, push successful merger | Great celebration |
| Other successful Git action | Jump |
| Creating, renaming, deleting or saving a file | Writing then jumping |
| Open a file or end of a search | Eyes around her |
| Search the project or open a comparator | Reflection |
| Verification started since Galeata | Breakdance and then celebration or dishonest depending on the result |
| Opening the terminal | Breakdance then celebration |
| Authorization, question or plan to be validated | Expectation |
| End of reply | Celebration |
| File saved or step completed | Jump |
| Final stage of the plan completed | Great celebration |
| Error | Maladdress |

A celebration reflects an event received; it does not certify the quality of the work or the success of the tests.

Clicking on the turtle makes her dance. The small pause button memorizes the animation choice in the browser. Setting animation reduction system is a priority. Animations stop when the page or mascot is hidden.

<a id="déclencher-une-réaction-depuis-le-code"></a>

## Trigger a reaction from code

```ts
import { mascot } from './mascot/store.ts';

mascot.react('file-saved'); // Réaction globale temporaire.
mascot.react('text-edit', conversationId); // Une conversation seulement.
```

The actions available are: `text-edit`, `file-opened`, `file-changed`, `file-saved`, `step-completed`, `plan-completed`, `play` and `error`. Standardized events of agents automatically feed `onAgentEvents`. A new response cancels the previous reaction of this conversation.

Requests go through `src/mascot/requests.ts` : Activity animation remains displayed until the resolution or rejection of the true promise. Competitive transactions have independent identifiers. Background readings (`git.status`, `git.overview`, files reviewed periodically, preferences... remain silent.

To link another asynchronous operation:

```ts
const finish = mascot.begin(
  { animation: 'working', label: 'Traitement en cours…' },
  { animation: 'success', label: 'Traitement terminé' },
);
try {
  await operation();
  finish('success');
} catch (error) {
  finish('error');
  throw error;
}
```

`getOverview(conversationId)` selects the state of the global mascot: waiting for a AI, error, ongoing operation, temporary reaction and activity AI. The project change cancels the reactions and ignores the late responses of the old project. Commands typed freely in a terminal are not guessed from its text; known commands come from Git actions and agent tools.

The register `src/mascot/animations.ts` defines the board, poses, rate and duration of reactions. The component `TurtleMascot` accept a `agentId` and one alternative `compact` for the navigation bar.

<a id="images"></a>

## Images

The 33 PNGs provided in the file `turtle` contain eight distinct boards. They are copied without modification in `public/mascot/turtle`under explicit names. `manifest.json` combines each original with its board and retains its own SHA-256 checksum ; identical copies share the same file.

The cyan background is made transparent in memory. The poses are separated and prepared once per board, then shared between conversations. The rendering uses a canvas and does not cause React to be returned to each image or fragment of response. The animation follows the clock of the screen, with a limited rendering of 30 images per second and a short melt between the poses to soften the movements.
