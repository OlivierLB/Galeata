#!/usr/bin/env python3
"""Generate English docs with a pinned, local Argos model (no API/key).

Only prose is sent to the translator. Markdown syntax and technical literals
are copied verbatim, without asking a model to preserve placeholders.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile

PIPELINE_VERSION = 1
ROOT = Path(__file__).resolve().parent.parent
NOTICE = (
    "> Automatically translated from French with Argos Translate. "
    "The French version is the reference; the application interface is currently in French.\n\n"
)
# Order matters: a code span, comment, image or destination is indivisible.
PROTECTED = re.compile(
    r"(?P<code>(?P<ticks>`+)(?!`)[\s\S]*?(?<!`)(?P=ticks)(?!`))"
    r"|(?P<comment><!--[\s\S]*?-->)"
    r"|(?P<image>!\[(?:\\.|[^\]\\])*\]\((?:\\.|[^()\n]|\([^()\n]*\))*\))"
    r"|(?P<destination>(?<=\])\((?:\\.|[^()\n]|\([^()\n]*\))*\))"
    r"|(?P<reference>(?<=\])\[[^\]\n]*\])"
    r"|(?P<html></?[A-Za-z][^>]*>|<https?://[^>]+>|<[\w.+-]+@[\w.-]+>)"
    r"|(?P<url>https?://[^\s<>]+)"
    r"|(?P<label>«[^»\n]+»)"
    r"|(?P<escape>\\.|&(?:\w+|#\d+|#x[\da-fA-F]+);)"
    r"|(?P<syntax>[\[\]*_~|<>]+)"
)


def digest(value):
    if isinstance(value, str):
        value = value.encode()
    return hashlib.sha256(value).hexdigest()


def json_text(value):
    return json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n"


def slug(text):
    text = re.sub(r"<[^>]+>", "", text).strip().lower()
    return "".join(c for c in text if c.isalnum() or c in "_ -").replace(" ", "-")


def navigation(name, lang):
    return (f"[Français]({name}) · [English](../en/{name})" if lang == "fr"
            else f"[Français](../fr/{name}) · [English]({name})")


def translate_markdown(source, translate, glossary=None):
    """Translate prose fragments while retaining original Markdown bytes."""
    glossary = glossary or {}
    terms = sorted(glossary.get("terms", {}), key=len, reverse=True)
    term_pattern = re.compile(r"(?<!\w)(?:" + "|".join(map(re.escape, terms)) + r")(?!\w)") if terms else None

    def prose(text):
        if term_pattern:
            result, start = [], 0
            for match in term_pattern.finditer(text):
                result.extend([plain(text[start:match.start()]), glossary["terms"][match[0]]])
                start = match.end()
            return "".join(result) + plain(text[start:])
        return plain(text)

    def plain(text):
        core = text.strip()
        if not any(c.isalpha() for c in core):
            return text
        prefix = text[:len(text) - len(text.lstrip())]
        suffix = text[len(text.rstrip()):]
        translated = glossary.get("phrases", {}).get(core)
        if translated is None:
            translated = translate(core)
        if not translated or "\n" in translated or "\r" in translated:
            raise ValueError(f"Invalid translation for {core!r}")
        # A translation must never introduce executable HTML or Markdown links.
        translated = re.sub(r"([\\`*_[\]<>|])", r"\\\1", translated.strip())
        return prefix + translated + suffix

    def inline(text):
        result, start = [], 0
        for match in PROTECTED.finditer(text):
            result.extend([prose(text[start:match.start()]), match[0]])
            start = match.end()
        return "".join(result) + prose(text[start:])

    # Mask multiline code spans/comments first; line processing cannot split them.
    multiline = {}
    def mask(match):
        if "\n" not in match[0]:
            return match[0]
        key = f"<!--galeata-protected-{len(multiline)}-->"
        multiline[key] = match[0]
        return key
    source = PROTECTED.sub(mask, source)
    result, fence, heading_counts = [], None, {}
    for line in source.splitlines(keepends=True):
        marker = re.match(r"^ {0,3}(`{3,}|~{3,})", line)
        if fence:
            result.append(line)
            if marker and marker[1][0] == fence[0] and len(marker[1]) >= len(fence):
                fence = None
            continue
        if marker:
            fence = marker[1]
            result.append(line)
            continue
        if (not line.strip() or line.startswith(("    ", "\t"))
                or re.match(r"^\s*\[[^\]]+\]:", line)
                or re.fullmatch(r"[\s|:\-*=]+", line)):
            result.append(line)
            continue
        # Preserve source heading anchors for links into translated pages.
        heading = re.match(r"^ {0,3}#{1,6}\s+(.+?)\s*#*\s*$", line)
        if heading:
            base = slug(heading[1])
            count = heading_counts.get(base, 0)
            heading_counts[base] = count + 1
            anchor = base + (f"-{count}" if count else "")
            result.append(f'<a id="{anchor}"></a>\n\n')
        prefix = re.match(r"^(?: {0,3}(?:#{1,6}\s+|>\s*|[-+*]\s+|\d+[.)]\s+))+", line)
        start = len(prefix[0]) if prefix else 0
        result.append(line[:start] + inline(line[start:]))
    if fence:
        raise ValueError("Unclosed Markdown code fence")
    text = "".join(result)
    for key, value in multiline.items():
        text = text.replace(key, value)
    return text


def load_backend(config, cache_dir):
    """Install one verified model in an isolated cache, never in user settings."""
    model = config["model"]
    archive = cache_dir / "fr-en.argosmodel"
    cache_dir.mkdir(parents=True, exist_ok=True)
    if not archive.exists() or digest(archive.read_bytes()) != model["sha256"]:
        temporary = archive.with_suffix(".download")
        try:
            subprocess.run(["curl", "--fail", "--location", "--retry", "3",
                            "--connect-timeout", "20", "--max-time", "300",
                            "--user-agent", "Galeata-docs/1.0", "--output", str(temporary), model["url"]], check=True)
            if digest(temporary.read_bytes()) != model["sha256"]:
                raise ValueError("Argos model SHA-256 mismatch")
            temporary.replace(archive)
        finally:
            temporary.unlink(missing_ok=True)
    os.environ["ARGOS_PACKAGES_DIR"] = str(cache_dir / model["sha256"] / "packages")
    os.environ["ARGOS_DEVICE_TYPE"] = "cpu"
    os.environ["ARGOS_CHUNK_TYPE"] = "STANZA"
    os.environ["ARGOS_MODEL_PROVIDER"] = "OPENNMT"
    os.environ["ARGOS_INTER_THREADS"] = "1"
    os.environ["ARGOS_INTRA_THREADS"] = "2"
    import argostranslate.package
    import argostranslate.translate
    import torch
    torch.set_num_threads(2)
    packages = argostranslate.package.get_installed_packages()
    if not any(p.from_code == "fr" and p.to_code == "en" for p in packages):
        argostranslate.package.install_from_path(archive)
    translation = argostranslate.translate.get_translation_from_codes("fr", "en")
    return translation.translate


def generate(root=ROOT, check=False, backend_factory=load_backend):
    docs = root / "docs"
    config = json.loads((docs / "translation.json").read_text())
    engine = digest(json_text({"version": PIPELINE_VERSION, "config": config,
                              "requirements": (root / "scripts/requirements-docs.txt").read_text()}))
    cache_file = docs / "translation-cache.json"
    old = json.loads(cache_file.read_text()) if cache_file.exists() else {}
    segments = old.get("segments", {}) if old.get("engine") == engine else {}
    used, pages, outputs = {}, {}, {}
    backend = None

    def translate(text):
        nonlocal backend
        key = digest(text)
        if key not in segments:
            if check:
                raise ValueError("Translation is stale: run npm run docs:translate")
            if backend is None:
                cache_dir = Path(os.environ.get("GALEATA_DOCS_CACHE", str(Path.home() / ".cache/galeata-docs")))
                backend = backend_factory(config, cache_dir)
            segments[key] = backend(text)
        used[key] = segments[key]
        return segments[key]

    for path in sorted((docs / "fr").glob("*.md")):
        name = path.name
        source = path.read_text()
        # Navigation is generated independently to avoid translating language names.
        nav = navigation(name, "fr") + "\n\n"
        if not source.startswith(nav):
            raise ValueError(f"Missing language navigation: {path}")
        content = navigation(name, "en") + "\n\n" + NOTICE
        content += translate_markdown(source[len(nav):], translate, config["glossary"])
        outputs[docs / "en" / name] = content
        pages[name] = {"source": digest(source), "translation": digest(content)}
        print(f"{'Check' if check else 'Translate'}: {name}", flush=True)
    if not pages:
        raise ValueError("No French documentation found")
    outputs[cache_file] = json_text({"engine": engine, "pages": pages, "segments": used})
    obsolete = set((docs / "en").glob("*.md")) - set(outputs)
    if check:
        stale = [str(path.relative_to(root)) for path, text in outputs.items()
                 if not path.exists() or path.read_text() != text]
        if stale or obsolete:
            raise ValueError("Generated docs differ: " + ", ".join(stale + [str(p) for p in obsolete]))
    else:
        # Compute everything before writing; a model failure leaves all docs untouched.
        for path, content in outputs.items():
            path.parent.mkdir(parents=True, exist_ok=True)
            with tempfile.NamedTemporaryFile(mode="w", dir=path.parent, encoding="utf-8", delete=False) as tmp:
                tmp.write(content)
                temporary = Path(tmp.name)
            temporary.replace(path)
        for path in obsolete:
            path.unlink()
    return pages


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="Verify generated docs without a model or network")
    args = parser.parse_args()
    try:
        generate(check=args.check)
    except (ValueError, OSError, subprocess.SubprocessError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
