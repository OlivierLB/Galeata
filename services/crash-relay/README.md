# Signalement sans compte GitHub

L’application laisse un marqueur par processus et le retire à la sortie normale. Au lancement suivant, les marqueurs dont le processus a disparu deviennent des rapports en attente. Plusieurs fenêtres actives ne sont pas considérées comme des crashs. Un arrêt forcé ou système est signalé comme fermeture anormale, sans prétendre en connaître la cause.

Le rapport contient uniquement la version, la plateforme Linux et le motif `abnormal_exit`. Aucun code, chemin ou conversation ne quitte le poste. Les envois échoués restent en attente pour le prochain lancement.

Déployer `server.mjs` avec Node 24 derrière un proxy HTTPS limitant le débit et la taille des requêtes. Fournir `GITHUB_TOKEN` via le coffre du serveur et `GITHUB_REPOSITORY=OlivierLB/Galeata`. Le jeton doit avoir le droit Issues en écriture sur ce seul dépôt. Le relais regroupe les rapports par version pendant une heure et ne demande aucun compte aux utilisateurs.

Compiler l’application avec `GALEATA_CRASH_ENDPOINT=https://votre-service/crashes` défini dans l’environnement de compilation Rust. La variable doit aussi être transmise au conteneur si la compilation utilise Docker. Sans cette configuration, les rapports restent locaux ; aucun envoi n’est annoncé comme réussi. Le relais est fourni mais n’est pas déployé par cette modification.

Contrat GitHub : https://docs.github.com/en/rest/issues/issues#create-an-issue
