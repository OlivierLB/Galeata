# Gérer Git dans Galeata

Cliquez sur le nom de branche **en bas à gauche** pour ouvrir « Branches et stash », depuis n’importe quelle page. La page Git propose les mêmes accès au-dessus de la vue d’ensemble et du comparateur.

## Branches et fusion

- La liste sépare les branches locales et distantes. Le filtre permet de retrouver une branche par son nom.
- **Activer** change la branche courante. Pour une branche distante, Galeata réutilise sa branche locale de suivi ou la crée. Une branche utilisée dans un autre worktree ne peut pas être activée ici.
- **Créer et activer** crée une branche depuis la position actuelle et bascule dessus.
- **Fusionner** intègre la branche choisie dans la branche active. La confirmation affiche explicitement la source et la destination. Pour changer de destination, activez d’abord cette branche.

Git conserve ses protections contre l’écrasement des modifications locales. Galeata demande d’enregistrer ou fermer les onglets modifiés avant une opération qui change les fichiers. Les fichiers ouverts sont relus après l’opération ; une modification saisie pendant l’opération est conservée et signalée comme externe.

En cas de conflit, ouvrez les fichiers concernés, corrigez-les puis indexez-les. « Terminer la fusion » est disponible une fois les conflits indexés. « Annuler la fusion » revient à l’état précédent ; une confirmation prévient de l’abandon des corrections de cette fusion. Les conflits issus d’un stash ne sont pas présentés comme une fusion annulable.

## Mettre des modifications de côté

L’onglet **Stash** propose un message facultatif. « Créer le stash » met de côté les changements suivis et les fichiers non suivis, sans inclure les fichiers ignorés par Git.

Après avoir activé la branche souhaitée, choisissez :

- **Appliquer et conserver** : restaure les fichiers et conserve le stash.
- **Restaurer et retirer (pop)** : restaure les fichiers puis retire le stash si l’opération réussit. Git conserve le stash en cas de conflit.

La restauration rétablit aussi les changements indexés. L’identifiant du contenu est revérifié au moment de l’action pour éviter de restaurer un autre stash si la liste a changé dans un terminal.

## Synchroniser

- **Récupérer (fetch)** actualise les références de tous les dépôts distants, sans modifier les fichiers de travail.
- **Mettre à jour (pull)** avance la branche depuis son suivi distant, uniquement si une avance rapide est possible. Une divergence reste à traiter explicitement.
- **Publier (push)** envoie les commits. Pour le premier push, choisissez le dépôt distant dans « Branches et stash » : le suivi distant est alors configuré.

Le gestionnaire affiche le suivi distant et les nombres de commits à publier et à récupérer. Ces nombres reflètent les références connues localement ; fetch les actualise.

L’aperçu navigateur simule ces actions sur ses exemples en mémoire. Il n’accède jamais au dépôt local. Les commandes réelles nécessitent l’application de bureau.
