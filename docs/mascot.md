# Mascotte tortue

La tortue apparaît en petit en bas de la barre de navigation, à la place de l’ancien espace personnel. Elle reste visible sur chaque page et suit la conversation active. Son état est disponible au survol et pour les lecteurs d’écran, sans libellé sous le personnage. Elle réagit aux événements de Claude Code et Codex, même lorsque les commandes sont masquées en mode « Texte uniquement ».

| Événement | Animation |
| --- | --- |
| Au repos | Regards autour d’elle |
| Réflexion ou démarrage de l’agent | Réflexion |
| Réponse ou modification de texte | Écriture |
| Exécution d’un outil | Breakdance |
| Autorisation, question ou plan à valider | Attente |
| Fin d’une réponse | Célébration |
| Fichier enregistré ou étape terminée | Saut |
| Dernière étape du plan terminée | Grande célébration |
| Erreur | Maladresse |

Une célébration reflète un événement reçu ; elle ne certifie pas la qualité du travail ni la réussite des tests.

Cliquer sur la tortue la fait danser. Le petit bouton de pause mémorise le choix d’animation dans le navigateur. Le réglage système de réduction des animations est prioritaire. Les animations s’arrêtent lorsque la page ou la mascotte est masquée.

## Déclencher une réaction depuis le code

```ts
import { mascot } from './mascot/store.ts';

mascot.react('file-saved'); // Réaction globale temporaire.
mascot.react('text-edit', conversationId); // Une conversation seulement.
```

Les actions disponibles sont `text-edit`, `file-saved`, `step-completed`, `plan-completed`, `play` et `error`. Les événements normalisés des agents alimentent automatiquement `onAgentEvents`. Les demandes de décision restent prioritaires sur les célébrations. Une nouvelle réponse annule la réaction précédente de cette conversation.

Le registre `src/mascot/animations.ts` définit la planche, les poses, la cadence et la durée des réactions. Le composant `TurtleMascot` accepte un `agentId` facultatif et une variante `compact` pour la barre de navigation.

## Images

Les 33 PNG fournis dans le dossier `turtle` contiennent huit planches distinctes. Elles sont copiées sans modification dans `public/mascot/turtle`, sous des noms explicites. `manifest.json` associe chaque original à sa planche et conserve son empreinte SHA-256 ; les copies identiques partagent le même fichier.

Le fond cyan est rendu transparent en mémoire. Les poses sont séparées et préparées une seule fois par planche, puis partagées entre les conversations. Le rendu utilise un canvas et ne provoque pas de nouveau rendu React à chaque image ou fragment de réponse. L’animation suit l’horloge de l’écran, avec un rendu limité à 30 images par seconde et un fondu bref entre les poses pour adoucir les mouvements.
