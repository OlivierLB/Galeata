[Français](translation.md) · [English](../en/translation.md)

# Traduction de la documentation

Le français dans `docs/fr/` est la source éditable. Les pages de `docs/en/` sont générées automatiquement avec Argos Translate, puis publiées dans le wiki. L’interface de l’application reste en français pour le moment ; la traduction des guides ne change pas les libellés des boutons.

## Fonctionnement automatique

Sur `main`, chaque modification des sources françaises, du glossaire ou du générateur lance le workflow `Documentation and wiki`. Un lancement manuel est aussi possible depuis `main`. Le workflow traduit uniquement les fragments absents du cache, contrôle les documents, enregistre l’anglais et son cache dans le dépôt, puis publie le wiki dans la même exécution. Aucun second workflow déclenché par le commit du bot n’est nécessaire.

Ce fonctionnement utilise les runners Linux standards gratuits pour les dépôts publics. Il ne nécessite ni clé d’API de traduction, ni abonnement, ni ordinateur personnel allumé. Le jeton temporaire GitHub Actions existant sert uniquement à enregistrer les fichiers et publier le wiki. Une règle de protection de `main` interdisant les commits du bot peut bloquer cette écriture : l’échec sera visible dans Actions, sans publier une version partiellement traduite.

Le modèle français–anglais 1.9 est téléchargé depuis Argos, puis vérifié par SHA-256 avant installation dans un cache isolé. Les dépendances sont épinglées dans `scripts/requirements-docs.txt`. Le modèle utilise le CPU. Les textes ne sont pas envoyés à une API distante ; seul le téléchargement initial des dépendances et du modèle nécessite le réseau.

## Modifier ou ajouter une page

1. Modifier la page dans `docs/fr/`. Pour une nouvelle page, choisir un nom technique stable et ajouter les liens dans le sommaire.
2. Commencer chaque page par la navigation de langue, en remplaçant le nom du fichier :

```md
[Français](example.md) · [English](../en/example.md)
```

3. Conserver les commandes, chemins, identifiants et noms exacts des boutons entre accents graves. Les textes entre guillemets français sont également préservés.
4. Vérifier les sources avec `npm run docs:check`. La CI des pull requests vérifie les sources et les tests du générateur sans télécharger de modèle ; le workflow de publication régénère puis vérifie intégralement l’anglais après intégration.

Pour corriger un terme traduit, modifier le glossaire dans `docs/translation.json`, puis régénérer. Les entrées `terms` remplacent des termes exacts ; les entrées `phrases` corrigent des fragments complets. Ne pas modifier directement les pages anglaises ni `docs/translation-cache.json`.

## Générer et vérifier en local

Avec Python 3.11 et curl, créer un environnement dédié :

```sh
python3.11 -m venv .venv-docs
. .venv-docs/bin/activate
python -m pip install -r scripts/requirements-docs.txt
npm run docs:translate
npm run docs:check
npm run docs:check-translations
python -m unittest discover -s tests -p 'test_translate_docs.py' -v
```

La première génération installe un modèle d’environ 67 Mo. Son cache est dans `~/.cache/galeata-docs`, modifiable avec `GALEATA_DOCS_CACHE`. L’environnement Python et les modèles restent hors des fichiers suivis. Le cache des fragments traduits est suivi pour éviter de retraduire le texte inchangé entre deux machines ou exécutions. Supprimer une source retire sa traduction à la prochaine génération.

`docs:check-translations` fonctionne sans Argos ni réseau quand les traductions sont à jour. Il compare les documents et le cache attendus à partir des sources ; une modification manuelle de l’anglais est détectée.

## Contrôles et limites

Le générateur protège les blocs de code, le code en ligne, les destinations des liens, les images et les balises HTML. Les contrôles vérifient les fichiers ciblés, les ancres locales et la correspondance des pages. Les pages anglaises conservent des ancres françaises explicites pour les liens entre guides. Le wiki reçoit deux ensembles de pages distincts, une navigation par langue et des renvois depuis les anciennes pages françaises. Les pages manuelles du wiki sont conservées.

La traduction automatique ne garantit pas la fidélité du sens. Relire en particulier les consignes de sécurité et les résumés de licence avant de s’y fier ; le texte officiel de [LICENSE](../../LICENSE) fait foi. Les fragments séparés par des éléments techniques peuvent manquer de contexte. Les images et leur texte éventuel ne sont pas traduits.

## Attribution du modèle

Argos Translate est un logiciel sous licence MIT. Le modèle français–anglais empaqueté est dérivé du modèle OPUS-MT sous licence CC BY 4.0 : Jörg Tiedemann et Santhosh Thottingal, « OPUS-MT — Building open translation services for the World », EAMT 2020. Les traductions sont générées à partir des sources françaises de Galeata ; le modèle est utilisé sans modification.

Sources : [Argos Translate](https://github.com/argosopentech/argos-translate), [OPUS-MT](https://github.com/Helsinki-NLP/OPUS-MT), [licence CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), [facturation GitHub Actions](https://docs.github.com/en/actions/concepts/billing-and-usage).
