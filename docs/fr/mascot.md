[Français](mascot.md) · [English](../en/mascot.md)

# Mascotte tortue

La tortue apparaît en petit en bas de la barre de navigation, à la place de l’ancien espace personnel. Elle reste visible sur chaque page et suit les actions réelles de l’application. Une autorisation, une question ou un plan à valider restent prioritaires, même dans une autre conversation. Son état est disponible au survol et pour les lecteurs d’écran, sans libellé sous le personnage. Les événements de Claude Code et Codex restent pris en compte lorsque les commandes sont masquées en mode « Texte uniquement ».

| Événement | Animation |
| --- | --- |
| Au repos | Regards autour d’elle |
| Réflexion ou démarrage de l’agent | Réflexion |
| Réponse ou modification de texte | Écriture |
| Écriture d’un fichier par l’IA | Écriture |
| Lecture de fichiers ou recherche par l’IA | Réflexion |
| Exécution d’un outil | Breakdance |
| Commande Git en cours (fetch, pull, push, commit, branche, fusion, stash, index…) | Breakdance jusqu’à la fin de la requête |
| Commit, push ou fusion réussis | Grande célébration |
| Autre action Git réussie | Saut |
| Création, renommage, suppression ou enregistrement d’un fichier | Écriture puis saut |
| Ouverture d’un fichier ou fin d’une recherche | Regards autour d’elle |
| Recherche dans le projet ou ouverture d’un comparateur | Réflexion |
| Vérification lancée depuis Galeata | Breakdance puis célébration ou maladresse selon le résultat |
| Ouverture du terminal | Breakdance puis célébration |
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

Les actions disponibles sont `text-edit`, `file-opened`, `file-changed`, `file-saved`, `step-completed`, `plan-completed`, `play` et `error`. Les événements normalisés des agents alimentent automatiquement `onAgentEvents`. Une nouvelle réponse annule la réaction précédente de cette conversation.

Les requêtes passent par `src/mascot/requests.ts` : l’animation d’activité reste affichée jusqu’à la résolution ou au rejet de la vraie promesse. Les opérations concurrentes ont des identifiants indépendants. Les lectures de fond (`git.status`, `git.overview`, fichiers relus périodiquement, préférences…) restent silencieuses.

Pour relier une autre opération asynchrone :

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

`getOverview(conversationId)` sélectionne l’état de la mascotte globale : attente d’une IA, erreur, opération en cours, réaction temporaire et activité IA. Le changement de projet annule les réactions et ignore les réponses tardives de l’ancien projet. Les commandes tapées librement dans un terminal ne sont pas devinées à partir de son texte ; les commandes connues viennent des actions Git et des outils des agents.

Le registre `src/mascot/animations.ts` définit la planche, les poses, la cadence et la durée des réactions. Le composant `TurtleMascot` accepte un `agentId` facultatif et une variante `compact` pour la barre de navigation.

## Images

Les 33 PNG fournis dans le dossier `turtle` contiennent huit planches distinctes. Elles sont copiées sans modification dans `public/mascot/turtle`, sous des noms explicites. `manifest.json` associe chaque original à sa planche et conserve son empreinte SHA-256 ; les copies identiques partagent le même fichier.

Le fond cyan est rendu transparent en mémoire. Les poses sont séparées et préparées une seule fois par planche, puis partagées entre les conversations. Le rendu utilise un canvas et ne provoque pas de nouveau rendu React à chaque image ou fragment de réponse. L’animation suit l’horloge de l’écran, avec un rendu limité à 30 images par seconde et un fondu bref entre les poses pour adoucir les mouvements.
