# Relais de plantages : signalement sans compte GitHub

Code : [`services/crash-relay/`](../services/crash-relay/).

## Hébergement retenu : Cloudflare Workers Free

Le relais privilégié est désormais dans [`services/crash-relay/cloudflare/`](../services/crash-relay/cloudflare/). Il utilise un sous-domaine HTTPS gratuit `galeata-crashes.<compte>.workers.dev` : aucun serveur ni domaine acheté n’est nécessaire. Conserver le compte sur **Workers Free** ; les quotas gratuits du Worker et du Durable Object bloquent les opérations au-delà des limites. Ne pas souscrire de plan payant pour ce service.

Le Worker utilise le même validateur et le même format de ticket que le relais Node. Un Durable Object avec stockage **SQLite** conserve jusqu’à 10 000 signatures sans expiration, même après redémarrage, et borne globalement les tentatives d’écriture GitHub (créations et compteurs) à **25 par jour UTC**, erreurs comprises. Une limite de stockage atteinte refuse les nouvelles signatures avec 429, sans effacer les groupes existants. Les demandes supplémentaires reçoivent 429 et restent sur le poste pour un prochain envoi. Les signatures déjà transmises reçoivent 204 sans nouveau ticket. Le stockage ne contient que les signatures, numéros d’issues, identifiants aléatoires des rapports, états et compteurs ; les rapports complets sont transmis directement à GitHub.

Une limitation Cloudflare de cinq requêtes par minute et par IP protège l’entrée (compteur approximatif par point de présence). L’IP n’est pas ajoutée au rapport ni stockée par le code du relais. Les corps sont limités à 32 Kio. L’observabilité applicative du Worker est désactivée. Un quota atteint ne produit jamais une fausse confirmation d’envoi.

### Ce qui remonte (rapports schéma 3)

- **Panique Rust** : catégorie, fichier et ligne Galeata, pile limitée aux symboles Galeata.
- **Signal fatal** (`SIGSEGV`, `SIGABRT`, `SIGBUS`, `SIGILL`, `SIGFPE`, `SIGQUIT`) : enregistré par un gestionnaire de signal sûr, puis le comportement d’origine reprend.
- **Plantage de l’affichage WebKit** : le processus web meurt alors que la fenêtre survit (page blanche). Le rapport part aussitôt, sans attendre le relancement.
- **Erreur native GTK/GLib** : au relancement, le journal système du processus mort est relu (`journalctl --user _PID=…`, borné à 200 lignes et 3 s). Seuls des identifiants sont gardés : domaine (`Gtk`), niveau, fichier C et ligne, fonction, noms de bibliothèques (`libpixbufloader-svg.so`) et indices (`missing_library`, `gtk_assertion`, `x_io_error`…). Aucun message brut ni chemin.
- Un arrêt demandé (`SIGTERM`, `SIGHUP`, `SIGINT` : déconnexion, `kill`, Ctrl+C) n’est **pas** un crash : il est noté localement (`local-*.json`) et jamais transmis.

Les rapports schéma 2 restent acceptés, avec les mêmes signatures de regroupement.

### Vérifications locales sans compte Cloudflare

```sh
npm ci --prefix services/crash-relay/cloudflare
npm test --prefix services/crash-relay/cloudflare
```

Le test compile avec Wrangler épinglé puis utilise le véritable runtime `workerd` via Miniflare. L’API GitHub est simulée : validation, refus des corps trop gros, échecs/reprise, déduplication après redémarrage, concurrence, limite par client et plafond quotidien. Aucun ticket réel n’est créé.

### Activation dans ton compte

1. Créer ou utiliser un compte **Cloudflare Workers Free** et choisir son sous-domaine `workers.dev`.
2. Autoriser le déploiement par un jeton Cloudflare limité aux Workers et Durable Objects du compte. Conserver le jeton dans le coffre système et le fournir temporairement à Wrangler via `CLOUDFLARE_API_TOKEN`, avec `CLOUDFLARE_ACCOUNT_ID`. Ne pas créer de fichier de jeton local, `.env` ou `.dev.vars` en clair. Aucun jeton n’est requis pour les vérifications locales ci-dessus.
3. Lancer `npm run deploy --prefix services/crash-relay/cloudflare`. La configuration crée uniquement le Worker, son limiteur et le Durable Object SQLite disponible dans l’offre gratuite.
4. Dans le tableau de bord Cloudflare, ajouter la variable **secrète** `GITHUB_TOKEN` (chiffrée), avec le droit Issues en écriture sur `OlivierLB/Galeata` uniquement. `GITHUB_REPOSITORY` est déjà configuré sans secret. Jusqu’à l’ajout du jeton, le relais répond 503.
5. Vérifier `/health` (configuration présente), puis `/ready` : lecture GitHub authentifiée sans création de ticket, résultat mis en cache 15 minutes dans le Durable Object. Un jeton révoqué ou expirant dans moins de 14 jours produit 503. Le droit Issues en écriture n’est pas prouvé par cette lecture ; le valider une fois par un ticket de test explicite. Si GitHub ne fournit pas l’en-tête d’expiration, renseigner `GITHUB_TOKEN_EXPIRES_AT` (date ISO) dans les variables Cloudflare. Sans date disponible, seule la validité actuelle est contrôlée.
6. Enregistrer l’adresse `https://galeata-crashes.<compte>.workers.dev/crashes` dans le secret GitHub `GALEATA_CRASH_ENDPOINT` (releases) et dans la **variable** Actions du même nom : `scripts/install-local.sh` la lit avec `gh` pour les compilations locales, sans l’écrire dans les sources. Elle reste surchargeable par la variable d’environnement de compilation. Le client utilise un User-Agent Galeata explicite pour les clients automatisés sur `workers.dev`.

Le déploiement n’est pas activé par la simple compilation locale. Il nécessite ton compte et le secret GitHub côté Cloudflare. Une réponse GitHub perdue après création d’un ticket peut exceptionnellement produire un doublon à la reprise ; le protocole de création d’issue n’est pas strictement idempotent.

Références : [Workers Free](https://developers.cloudflare.com/workers/platform/pricing/), [SQLite Durable Objects gratuits](https://developers.cloudflare.com/durable-objects/platform/pricing/), [adresse workers.dev et User-Agent](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/).

## Exploitation automatisée sans abonnement supplémentaire

Le dépôt public utilise les runners Linux standards de GitHub Actions et le compte Cloudflare **Workers Free** existant. Ne pas activer Workers Paid, de runner payant ni de produit payant. Les limites gratuites restent applicables.

Dans GitHub → Settings → Secrets and variables → Actions, configurer :

- `GALEATA_CRASH_ENDPOINT` : adresse HTTPS finissant par `/crashes`, transmise à la compilation des releases (elle prime sur l’adresse par défaut). Une publication par tag échoue si elle manque.
- `CLOUDFLARE_ACCOUNT_ID` : identifiant du seul compte de déploiement.
- `CLOUDFLARE_API_TOKEN` : jeton dédié au compte, droits Workers Scripts Edit et Account Settings Read. Le limiter à ce compte et lui donner une expiration. Ne pas réutiliser une clé globale ni transmettre le jeton dans une conversation.

Ces valeurs ne sont pas enregistrées dans les fichiers suivis. L’adresse du relais devient nécessairement visible dans le binaire distribué. `GITHUB_TOKEN` demeure exclusivement dans les secrets du Worker ; le workflow de déploiement ne le remplace pas.

Le workflow `Crash relay` teste les PR sans secrets, puis déploie les modifications du relais sur `main` seulement après ses tests. Un lancement manuel depuis `main` permet un redéploiement. Le contrôle quotidien appelle `/ready` et échoue en cas d’indisponibilité, de jeton invalide ou d’expiration proche. Activer les notifications personnelles GitHub Actions pour recevoir les échecs : GitHub → Settings → Notifications → Actions. Les exécutions planifiées dépendent de GitHub ; elles peuvent être retardées et désactivées après une longue inactivité du dépôt public.

Les occurrences alimentent une même issue, même fermée, sans la rouvrir automatiquement. Une alarme regroupe les mises à jour du compteur à intervalle horaire, avec reprise en cas d’échec ou de quota atteint. Elle conserve le texte de l’issue et remplace seulement le bloc de compteur. Les rapports de schéma 2 sont dédupliqués par identifiant pendant 30 jours (100 000 identifiants maximum). Les anciens rapports sans identifiant peuvent compter leurs réessais. Le compteur indique donc les rapports reçus, pas un nombre garanti de plantages distincts. Aucun rapport complet n’est conservé dans le Durable Object.

Lors de la migration, les anciennes signatures sans numéro d’issue restent dédupliquées pendant leur heure de validité ; leur issue n’est pas importée automatiquement. Une réponse GitHub perdue après création peut encore exceptionnellement produire un doublon.

Références : [déploiement GitHub Actions](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/), [quotas Workers](https://developers.cloudflare.com/workers/platform/limits/), [notifications Actions](https://docs.github.com/en/account-and-profile/managing-subscriptions-and-notifications-on-github/setting-up-notifications/configuring-notifications).

## Rapports et détection

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

Déployer [`services/crash-relay/server.mjs`](../services/crash-relay/server.mjs) avec Node 24 derrière un proxy HTTPS limitant le débit et la taille des requêtes. Fournir `GITHUB_TOKEN_FILE` via le coffre du serveur et `GITHUB_REPOSITORY=OlivierLB/Galeata`. Le jeton doit avoir le droit Issues en écriture sur ce seul dépôt. Il n’est jamais inclus dans l’application distribuée. Le relais regroupe pendant une heure les rapports ayant la même version, le même build et la même signature de panique (source, ligne, pile). Deux causes différentes d’une même version produisent donc deux tickets. La déduplication est en mémoire et repart à zéro si le relais redémarre.

Le relais écoute par défaut uniquement sur `127.0.0.1:8787`. `GET /health` retourne 204 si sa configuration est présente (cela ne vérifie pas les droits du jeton sur GitHub). Il ne demande aucun compte aux utilisateurs. Aucun rapport réel n’est envoyé par les tests : l’API GitHub y est simulée.

## Déploiement préparé

Les fichiers [`galeata-crash-relay.service`](../services/crash-relay/galeata-crash-relay.service) et [`nginx.conf.example`](../services/crash-relay/nginx.conf.example) de `services/crash-relay/` fournissent une base pour un serveur Linux avec Node 24, nginx et systemd prenant en charge `LoadCredentialEncrypted` et `%d` (systemd 252 ou plus récent).

1. Copier `services/crash-relay/server.mjs` et `services/crash-relay/core.mjs` sous `/opt/galeata-crash-relay/`, accessibles en lecture par le service.
2. Créer le secret chiffré dans `/etc/credstore.encrypted/galeata-github-token` avec `systemd-creds encrypt --name=github-token - /etc/credstore.encrypted/galeata-github-token`, en fournissant le jeton sur l’entrée standard depuis le coffre du serveur. Ne pas le mettre dans l’historique du shell ni dans le dépôt.
3. Installer l’unité systemd, puis lancer `systemctl daemon-reload` et `systemctl enable --now galeata-crash-relay`.
4. Adapter le domaine et les certificats HTTPS du modèle nginx, puis vérifier `nginx -t` avant rechargement. Le modèle borne le débit et la taille des rapports ; les accès HTTP ne sont pas journalisés.
5. Vérifier `curl --fail http://127.0.0.1:8787/health`, puis configurer l’adresse publique de compilation ci-dessous. La création d’un premier ticket de test réel doit être une vérification explicite sur le dépôt choisi.

Ces modèles ne sont pas exécutés automatiquement sur le poste de développement. L’hébergement, le domaine et le coffre du serveur doivent être fournis pour activer le service.

Compiler l’application avec `GALEATA_CRASH_ENDPOINT=https://votre-service/crashes` défini dans l’environnement de compilation Rust. La variable doit aussi être transmise au conteneur si la compilation utilise Docker. Sans cette configuration, les rapports restent locaux ; aucun envoi n’est annoncé comme réussi. Le relais est fourni mais n’est pas déployé par cette modification.

Contrat GitHub : https://docs.github.com/en/rest/issues/issues#create-an-issue

Références de déploiement : [credentials systemd](https://www.freedesktop.org/software/systemd/man/latest/systemd.exec.html#Credentials), [limitation du débit nginx](https://nginx.org/en/docs/http/ngx_http_limit_req_module.html).
