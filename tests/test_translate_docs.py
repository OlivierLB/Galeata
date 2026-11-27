"""Offline tests of Markdown protection and incremental generation."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

SPEC = importlib.util.spec_from_file_location("translate_docs", Path(__file__).resolve().parents[1] / "scripts/translate-docs.py")
docs = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(docs)


class TranslationTests(unittest.TestCase):
    def test_markdown_keeps_code_destinations_images_and_html(self):
        source = '''# Bonjour

Bonjour **monde** et `npm test`.
[Bonjour](other.md#bonjour) ![image française](img.png)
<details><summary>Bonjour</summary>

```sh
echo "Bonjour"
```

~~~python
print('Bonjour')
~~~

<!-- Bonjour
commentaire -->
    echo Bonjour
| Bonjour | monde |
| --- | --- |
[ref]: other.md "Bonjour"
« Ouvrir un dossier »
</details>
'''
        result = docs.translate_markdown(source, lambda text: text.replace('Bonjour', 'Hello').replace('monde', 'world'))
        self.assertIn('# Hello', result)
        self.assertIn('**world**', result)
        self.assertIn('[Hello](other.md#bonjour)', result)
        self.assertIn('<summary>Hello</summary>', result)
        self.assertIn('<a id="bonjour"></a>', result)
        for literal in ['`npm test`', '![image française](img.png)', 'echo "Bonjour"', "print('Bonjour')",
                        '<!-- Bonjour\ncommentaire -->', '    echo Bonjour', '[ref]: other.md "Bonjour"', '« Ouvrir un dossier »']:
            self.assertIn(literal, result)

    def test_duplicate_anchors_nested_destinations_and_multiline_code(self):
        source = '# Même titre\n# Même titre\n[A](file_(x).md)\n``code\nBonjour `x` code``\n'
        result = docs.translate_markdown(source, lambda text: 'English')
        self.assertIn('id="même-titre"', result)
        self.assertIn('id="même-titre-1"', result)
        self.assertIn('(file_(x).md)', result)
        self.assertIn('``code\nBonjour `x` code``', result)

    def test_translation_cannot_create_markup(self):
        result = docs.translate_markdown('Bonjour\n', lambda text: '<script>x</script> [x](evil)')
        self.assertNotIn('<script>', result)
        self.assertNotIn('[x](evil)', result)
        with self.assertRaises(ValueError):
            docs.translate_markdown('Bonjour\n', lambda text: 'Hello\n# injected')

    def test_glossary_and_terms(self):
        result = docs.translate_markdown('Bonjour Galeata\n', lambda text: 'BAD',
                                         {'terms': {'Galeata': 'Galeata'}, 'phrases': {'Bonjour': 'Hello'}})
        self.assertEqual(result, 'Hello Galeata\n')

    def test_incremental_cache_check_tamper_detection_and_deletion(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'docs/fr').mkdir(parents=True)
            (root / 'docs/en').mkdir()
            (root / 'scripts').mkdir()
            (root / 'scripts/requirements-docs.txt').write_text('fake==1\n')
            (root / 'docs/translation.json').write_text('{"model": {}, "glossary": {}}')
            def source(name, text):
                (root / 'docs/fr' / name).write_text(docs.navigation(name, 'fr') + '\n\n' + text)
            calls = []
            def factory(*args):
                def translate(text):
                    calls.append(text)
                    return text.replace('Bonjour', 'Hello').replace('Nouveau', 'New')
                return translate
            def no_backend(*args):
                self.fail('Unexpected model/network access')
            source('a.md', '# Bonjour\n')
            docs.generate(root, backend_factory=factory)
            self.assertEqual(calls, ['Bonjour'])
            docs.generate(root, check=True, backend_factory=no_backend)
            source('b.md', '# Bonjour\n\nNouveau\n')
            docs.generate(root, backend_factory=factory)
            self.assertEqual(calls, ['Bonjour', 'Nouveau'])
            translated = root / 'docs/en/a.md'
            translated.write_text(translated.read_text() + 'manual edit\n')
            with self.assertRaises(ValueError):
                docs.generate(root, check=True, backend_factory=no_backend)
            docs.generate(root, backend_factory=no_backend)
            (root / 'docs/fr/b.md').unlink()
            docs.generate(root, backend_factory=no_backend)
            self.assertFalse((root / 'docs/en/b.md').exists())
            docs.generate(root, check=True, backend_factory=no_backend)
            source('a.md', '# Texte changé\n')
            with self.assertRaisesRegex(ValueError, 'stale'):
                docs.generate(root, check=True, backend_factory=no_backend)

    def test_model_failure_leaves_previous_docs_untouched(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'docs/fr').mkdir(parents=True)
            (root / 'docs/en').mkdir()
            (root / 'scripts').mkdir()
            (root / 'scripts/requirements-docs.txt').write_text('fake==1\n')
            (root / 'docs/translation.json').write_text('{"model": {}, "glossary": {}}')
            (root / 'docs/fr/a.md').write_text(docs.navigation('a.md', 'fr') + '\n\nBonjour\n')
            old = root / 'docs/en/a.md'
            old.write_text('previous version')
            def fail(*args):
                raise OSError('model unavailable')
            with self.assertRaises(OSError):
                docs.generate(root, backend_factory=fail)
            self.assertEqual(old.read_text(), 'previous version')
            self.assertFalse((root / 'docs/translation-cache.json').exists())


if __name__ == '__main__':
    unittest.main()
