# Signalement sans compte GitHub

L’application laisse un marqueur par processus et le retire à la sortie normale. Au lancement suivant, les marqueurs dont le processus a disparu deviennent des rapports en attente. Plusieurs fenêtres actives ne sont pas considérées comme des crashs. Un arrêt forcé ou système est signalé comme fermeture anormale, sans prétendre en connaître la cause.

Le rapport enrichi (schéma 2) contient :

- Un identifiant aléatoire par rapport, la version et le commit de compilation.
- Linux, l’architecture, la version numérique du noyau et le type d’affichage (Wayland/X11/inconnu).
- Les dates de démarrage et du dernier instantané, la durée de session et la mémoire RSS en Kio.
- Les 32 derniers événements techniques : nom d’opération autorisé, date, durée, résultat et code d’erreur générique.
- Pour une panique Rust : catégorie (assertion, unwrap, index, dépassement ou autre), fichier source **de Galeata** relatif au dépôt, ligne, colonne et au maximum 32 symboles d’appel Galeata.

Les messages bruts de panique, chemins absolus, noms d’utilisateur, noms de machine, arguments de commandes, contenus de fichiers et conversations sont exclus. Le jeton de démarrage utilisé pour distinguer des PID réutilisés reste uniquement dans le marqueur local et est retiré du rapport envoyé.

Un instantané atomique est enregistré toutes les 15 secondes, ainsi qu’à chaque erreur technique. Une panique provoque une capture immédiate. La pile dépend des symboles disponibles dans le binaire et peut être vide en version optimisée. Pour un SIGKILL, un plantage natif, un arrêt système ou une coupure, seul le dernier instantané disponible est récupérable : le rapport ne prétend pas connaître la cause exacte. Une panique interceptée par l’application est aussi conservée à la fermeture normale.

Les envois échoués restent en attente pour le prochain lancement (16 rapports maximum, 32 Kio par rapport). La validation du relais reconstruit un objet autorisé et refuse les champs techniques arbitraires. Les anciens rapports minimaux restent acceptés par le relais.

Déployer `server.mjs` avec Node 24 derrière un proxy HTTPS limitant le débit et la taille des requêtes. Fournir `GITHUB_TOKEN_FILE` via le coffre du serveur et `GITHUB_REPOSITORY=OlivierLB/Galeata`. Le jeton doit avoir le droit Issues en écriture sur ce seul dépôt. Il n’est jamais inclus dans l’application distribuée. Le relais regroupe pendant une heure les rapports ayant la même version, le même build et la même signature de panique (source, ligne, pile). Deux causes différentes d’une même version produisent donc deux tickets. La déduplication est en mémoire et repart à zéro si le relais redémarre.

Le relais écoute par défaut uniquement sur `127.0.0.1:8787`. `GET /health` retourne 204 si sa configuration est présente (cela ne vérifie pas les droits du jeton sur GitHub). Il ne demande aucun compte aux utilisateurs. Aucun rapport réel n’est envoyé par les tests : l’API GitHub y est simulée.

## Déploiement préparé

Les fichiers `galeata-crash-relay.service` et `nginx.conf.example` fournissent une base pour un serveur Linux avec Node 24, nginx et systemd prenant en charge `LoadCredentialEncrypted` et `%d` (systemd 252 ou plus récent).

1. Copier `server.mjs` sous `/opt/galeata-crash-relay/`, accessible en lecture par le service.
2. Créer le secret chiffré dans `/etc/credstore.encrypted/galeata-github-token` avec `systemd-creds encrypt --name=github-token - /etc/credstore.encrypted/galeata-github-token`, en fournissant le jeton sur l’entrée standard depuis le coffre du serveur. Ne pas le mettre dans l’historique du shell ni dans le dépôt.
3. Installer l’unité systemd, puis lancer `systemctl daemon-reload` et `systemctl enable --now galeata-crash-relay`.
4. Adapter le domaine et les certificats HTTPS du modèle nginx, puis vérifier `nginx -t` avant rechargement. Le modèle borne le débit et la taille des rapports ; les accès HTTP ne sont pas journalisés.
5. Vérifier `curl --fail http://127.0.0.1:8787/health`, puis configurer l’adresse publique de compilation ci-dessous. La création d’un premier ticket de test réel doit être une vérification explicite sur le dépôt choisi.

Ces modèles ne sont pas exécutés automatiquement sur le poste de développement. L’hébergement, le domaine et le coffre du serveur doivent être fournis pour activer le service.

Compiler l’application avec `GALEATA_CRASH_ENDPOINT=https://votre-service/crashes` défini dans l’environnement de compilation Rust. La variable doit aussi être transmise au conteneur si la compilation utilise Docker. Sans cette configuration, les rapports restent locaux ; aucun envoi n’est annoncé comme réussi. Le relais est fourni mais n’est pas déployé par cette modification.

Contrat GitHub : https://docs.github.com/en/rest/issues/issues#create-an-issue

Références de déploiement : [credentials systemd](https://www.freedesktop.org/software/systemd/man/latest/systemd.exec.html#Credentials), [limitation du débit nginx](https://nginx.org/en/docs/http/ngx_http_limit_req_module.html).
