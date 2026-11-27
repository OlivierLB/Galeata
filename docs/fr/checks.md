[Français](checks.md) · [English](../en/checks.md)

# Tests et contrôles

Le bouton **`Tests et contrôles`** ouvre une fenêtre utilisant le composant et le style des Préférences. Sélectionnez un ou plusieurs contrôles, puis lancez la sélection. Les commandes utilisent les fichiers enregistrés sur disque. Fermer la fenêtre ne les interrompt pas ; le bouton du pied de page signale une exécution active.

## Catalogue et configuration

La découverte est passive : elle lit les fichiers du projet sans lancer de commande. Elle reconnaît les scripts npm/pnpm/yarn/bun de test, build, lint et typage, Cargo, Go, certaines configurations Python, les scripts Composer, Maven et .NET. Les scripts de surveillance ou de correction automatique sont exclus. La présence de l’exécutable est contrôlée ; les dépendances du projet seront réellement vérifiées au lancement.

La recherche est bornée à trois niveaux et mille entrées, hors dépendances et dossiers de compilation. Un contrôle peut être ajouté ou modifié dans l’interface : programme, arguments séparés ligne par ligne, dossier relatif et délai maximal. Les sélections et profils sont enregistrés par projet. Une sélection contient au plus 32 contrôles, avec 64 commandes personnalisées et 20 profils maximum.

Un projet peut aussi fournir `.galeata/checks.json` :

```json
{
  "custom": [{
    "id": "unit-tests",
    "name": "Tests unitaires",
    "program": "npm",
    "args": ["run", "test:unit"],
    "cwd": "",
    "timeout": 600,
    "origin": "Projet",
    "category": "test"
  }]
}
```

Les chemins restent confinés au projet. Une modification locale portant le même identifiant remplace la définition du projet.

## Exécution et résultats

Une seule commande s’exécute à la fois entre les fenêtres Galeata d’une même installation. Les arguments sont transmis directement au programme. Le délai par défaut est de 600 secondes, configurable entre 1 et 3 600 secondes. L’annulation termine le groupe de processus ; quitter l’application interrompt ses contrôles.

Les résultats indiquent la commande, le dossier, la durée, le code de sortie et l’état : succès, échec, blocage, annulation, expiration ou sortie excessive. Les erreurs d’exécutable et certains cas Python sans tests sont distingués. Les résultats sont présentés par commande ; il n’y a pas encore d’explorateur de chaque test ni d’analyseur universel JUnit/JSON.

Les sorties sont chargées à la demande, limitées aux derniers 16 Kio. Une commande dépassant 8 Mio de sortie totale est arrêtée. Huit exécutions récentes sont conservées par projet. Un résultat d’une session précédente ou antérieur à une modification du projet est signalé. Les échecs peuvent être resélectionnés.

Le suivi repose sur les événements, sans interrogation périodique au repos. Le verrou limite le nombre de commandes simultanées ; chaque outil reste responsable de ses propres processus parallèles. Le mode aperçu navigateur permet de découvrir la sélection et les profils, mais n’exécute aucun contrôle.

Les méthodes `checks.*` sont réservées à l’interface native. L’historique de l’ancien mécanisme de vérification reste conservé séparément.
