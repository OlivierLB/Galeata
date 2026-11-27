[Français](installation.md) · [English](../en/installation.md)

# Installer Galeata

Une seule commande, sans sudo ni dépendance à installer (Linux x86_64) :

```sh
curl -fsSL https://raw.githubusercontent.com/OlivierLB/Galeata/main/install.sh | sh
```

Galeata apparaît dans le menu des applications et la commande `galeata` est ajoutée dans `~/.local/bin`. Relancer la même commande met Galeata à jour ; `sh install.sh --uninstall` la retire en conservant vos projets, plans et préférences.

Il vous faut **Claude Code ou Codex** : un seul des deux suffit. Galeata les détecte et vous guide au premier lancement s’il n’en trouve aucun.

<details>
<summary>Ce que fait l’installateur</summary>

- Il télécharge l’AppImage de la dernière [Release](https://github.com/OlivierLB/Galeata/releases) (toutes les bibliothèques sont incluses) et vérifie son empreinte SHA-256.
- Il l’extrait dans `~/.local/share/galeata`, sans FUSE, ce qui donne aussi un démarrage plus rapide qu’une AppImage montée. Il garde la version précédente pour pouvoir revenir en arrière.
- Il conserve aussi les versions utilisées par une fenêtre ou un processus auxiliaire encore ouvert, afin de préserver leurs bibliothèques. Elles seront nettoyées lors d’une installation ultérieure, après leur fermeture. Relancez Galeata pour utiliser la nouvelle version.
- Il ne remplace jamais un fichier qu’il n’a pas créé, et ne touche pas aux données de l’application (`~/.local/share/dev.olivierlb.galeata`).
- Variables : `GALEATA_VERSION=v0.2.0` pour installer une version précise, `GALEATA_BIN_DIR` pour un autre dossier de commande.

Construite sur Ubuntu 22.04 : fonctionne sur Pop!_OS 22.04 et les distributions plus récentes. Chaque Release contient aussi un paquet `.deb` (`sudo apt install ./galeata-linux-amd64.deb`).
</details>

Pour les développeurs, `python3 scripts/install-linux.py` installe la dernière compilation de la CI (nécessite GitHub CLI connecté).
