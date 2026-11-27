[Français](../fr/translation.md) · [English](translation.md)

> Automatically translated from French with Argos Translate. The French version is the reference; the application interface is currently in French.

<a id="traduction-de-la-documentation"></a>

# Translation of documentation

French in `docs/fr/` is the editable source. Pages of `docs/en/` are generated automatically with Argos Translate, then published in the wiki. The application interface remains in French for the moment; the translation of the guides does not change the labels of the buttons.

<a id="fonctionnement-automatique"></a>

## Automatic operation

On `main`, each modification of French sources, glossary or generator launches workflow `Documentation and wiki`. Manual launch is also possible since `main`. Workflow only translates fragments missing from the cache, controls documents, records English and its cache in the repository, then publish the wiki in the same execution. No second workflow triggered by the commit the bot is necessary.

This operation uses free standard Linux runners for repositories public. It does not require a key toAPI No subscription, no personal computer on. The token Temporary GitHub Existing actions is only used to save files and publish the wiki. A rule of protection `main` establishing a commits of the bot can block this writing: failure will be visible in Actions, without publishing a partially translated version.

The English-French 1.9 model is downloaded from Argos and checked by SHA-256 before installation in an isolated cache. Dependencies are pinned in `scripts/requirements-docs.txt`. The model uses the CPU. Texts are not sent to API remote; only the initial download of dependencies and model requires the network.

<a id="modifier-ou-ajouter-une-page"></a>

## Edit or add a page

1. Edit page in `docs/fr/`. For a new page, choose a stable technical name and add the links in the summary.
2. Start each page with the language navigation, replacing the file name:

```md
[Français](example.md) · [English](../en/example.md)
```

3. Keep the commands, paths, identifiers and exact names of the buttons between serious accents. The texts in French quotation marks are also preserved.
4. Check sources with `npm run docs:check`. The CI of the pull requests checks the sources and tests of the generator without downloading a model; publication workflow regenerates and then checks English in full after integration.

To correct a translated term, amend the glossary in `docs/translation.json`then regenerate. The entries `terms` replace exact terms; entries `phrases` correct full fragments. Do not change the English pages directly or `docs/translation-cache.json`.

<a id="générer-et-vérifier-en-local"></a>

## Generate and verify locally

With Python 3.11 and curl, create a dedicated environment:

```sh
python3.11 -m venv .venv-docs
. .venv-docs/bin/activate
python -m pip install -r scripts/requirements-docs.txt
npm run docs:translate
npm run docs:check
npm run docs:check-translations
python -m unittest discover -s tests -p 'test_translate_docs.py' -v
```

The first generation installs a model of about 67 MB. His cache is in `~/.cache/galeata-docs`, editable with `GALEATA_DOCS_CACHE`. Python environment and templates remain out of the files tracked. The cache of the translated fragments is followed to avoid retracing the unchanged text between two machines or executions. Delete a source removes its translation in the next generation.

`docs:check-translations` works without Argos or network when translations are up to date. It compares the documents and cache expected from the sources; A manual change of English is detected.

<a id="contrôles-et-limites"></a>

## Controls and limits

The generator protects code blocks, online code, link destinations, images and HTML tags. Checks check targeted files, local anchors and page correspondence. The English pages retain explicit French anchors for links between guides. The wiki receives two sets of separate pages, a language navigation and references from the old French pages. Manual wiki pages are kept.

Machine translation does not guarantee fidelity of meaning. Review in particular the safety instructions and licence summaries before being proud; the official text of [LICENSE](../../LICENSE) That's true. Fragments separated by technical elements may lack context. Images and their possible text are not translated.

<a id="attribution-du-modèle"></a>

## Attribution of the model

Argos Translate is MIT licensed software. The English-French packaged model is derived from the CC BY 4.0 licensed model OPUS-MT: Jörg Tiedemann and Santhosh Shottingal, « OPUS-MT — Building open translation services for the World »EAMT 2020. Translations are generated from French sources Galeata ; the model is used without modification.

Sources: [Argos Translate](https://github.com/argosopentech/argos-translate), [OPUS-MT](https://github.com/Helsinki-NLP/OPUS-MT), [CC BY 4.0 license](https://creativecommons.org/licenses/by/4.0/), [billing GitHub Actions](https://docs.github.com/en/actions/concepts/billing-and-usage).
