[Français](webview-recovery.md) · [English](../en/webview-recovery.md)

# Écran noir et arrêt du moteur d’affichage

Galeata surveille nativement la fin anormale du processus WebKitGTK. Une boîte de dialogue indépendante de l’interface permet alors de laisser la fenêtre ouverte ou d’arrêter les activités en cours (agents, terminaux et contrôles) et de recharger l’interface en rendu logiciel.

Le rechargement demande une confirmation : les fichiers et conversations déjà enregistrés sont conservés, mais les éléments non enregistrés peuvent être perdus. Galeata rouvre le projet courant et reprend ses sessions enregistrées. Aucun rechargement automatique n’est effectué.

L’accélération graphique reste active en fonctionnement normal. Après une récupération, elle est désactivée uniquement pour la vue concernée et jusqu’à la fermeture de l’application. Le rendu logiciel peut augmenter la consommation CPU. Il contourne le chemin de composition accélérée ; il ne garantit pas la résolution de toutes les défaillances WebKit.

Les diagnostics locaux enregistrent `webview.crashed`, `webview.memory_limit` ou `webview.terminated`, puis `webview.recovery_started` si le rechargement a été demandé à WebKit. Ce dernier événement ne prouve pas que la page a fini de se charger. Un plantage ou un dépassement de mémoire du processus web produit aussi immédiatement un rapport `webview_crash`, avant la récupération. Ces événements techniques restent sans contenu de conversation.

Pour l’issue #44, le journal noyau du 27 novembre 2026 indique à 17 h 00 min 39 une erreur `invalid opcode` du thread `eadedCompositor`, dans `libwebkit2gtk-4.1.so.0`. Le serveur répondait encore aux outils MCP après la disparition de l’affichage. L’utilisateur a ensuite tué le processus principal, ce qui a produit le rapport `abnormal_exit`. La cause interne de l’erreur WebKit reste indéterminée ; la récupération évite de devoir tuer Galeata pour sortir de cet état.

Un test natif ignoré par défaut termine réellement un processus WebKit via son API, recharge la page en rendu logiciel et attend la fin du chargement. Il doit être exécuté sur un écran virtuel isolé, avec GTK et WebKitGTK disponibles :

```sh
xvfb-run -a dbus-run-session -- cargo test --locked --manifest-path src-tauri/Cargo.toml --lib native_webkit -- --ignored --test-threads=1
```

Ce test valide le signal et le rechargement d’une page réelle dans WebKit ; il ne reproduit pas l’erreur du pilote ou du compositeur sur le poste de l’utilisateur et ne clique pas dans la boîte de dialogue native.
