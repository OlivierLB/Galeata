//! Turns a plan written by an agent (markdown) into Galeata's mission plan:
//! an objective and a list of steps. Pure and cheap (one pass over the lines).

/// Objective and step titles extracted from a markdown plan.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PlanDraft {
    pub objective: String,
    pub steps: Vec<String>,
}

const MAX_STEPS: usize = 30;
/// Sections that describe the work but are not steps of it.
const NOT_STEPS: &[&str] = &[
    "contexte",
    "context",
    "vérification",
    "verification",
    "hors périmètre",
    "out of scope",
    "journal",
    "risque",
    "risk",
    "question",
    "hypothèse",
    "assumption",
    "note",
    "règle",
    "résumé",
    "summary",
    "fichiers",
    "files",
];
/// Section titles that announce the list of steps.
const STEP_SECTIONS: &[&str] = &[
    "étapes",
    "etapes",
    "steps",
    "plan d’action",
    "plan d'action",
    "implémentation",
    "implementation",
    "mise en œuvre",
    "tâches",
    "tasks",
];

struct Heading {
    depth: usize,
    text: String,
    line: usize,
}

fn heading(line: &str) -> Option<(usize, String)> {
    let trimmed = line.trim_start();
    let depth = trimmed.chars().take_while(|c| *c == '#').count();
    if depth == 0 || depth > 6 || !trimmed[depth..].starts_with(' ') {
        return None;
    }
    Some((depth, clean(&trimmed[depth..])))
}

/// Top-level list item (`- x`, `* x`, `1. x`, `1) x`), not indented.
fn list_item(line: &str) -> Option<String> {
    if line.starts_with(' ') || line.starts_with('\t') {
        return None;
    }
    if let Some(rest) = line.strip_prefix("- ").or(line.strip_prefix("* ")) {
        return Some(clean(rest));
    }
    let digits = line.chars().take_while(char::is_ascii_digit).count();
    if digits > 0 {
        let rest = &line[digits..];
        if let Some(rest) = rest.strip_prefix(". ").or(rest.strip_prefix(") ")) {
            return Some(clean(rest));
        }
    }
    None
}

/// Removes markdown emphasis and step numbering ("1.", "Étape 2 —", "Step 3:").
fn clean(text: &str) -> String {
    let text = text.trim().replace("**", "").replace('`', "");
    let mut text = text.trim();
    let lower = text.to_lowercase();
    for prefix in ["étape", "etape", "step"] {
        if lower.starts_with(prefix) {
            let rest = &text[prefix.len()..].trim_start();
            let digits = rest.chars().take_while(char::is_ascii_digit).count();
            if digits > 0 {
                text = rest[digits..].trim_start_matches([' ', '—', '–', '-', ':', '.', ')']);
            }
            break;
        }
    }
    let digits = text.chars().take_while(char::is_ascii_digit).count();
    if digits > 0 && text[digits..].starts_with(['.', ')']) {
        text = text[digits + 1..].trim_start();
    }
    text.trim().to_owned()
}

fn matches_any(text: &str, words: &[&str]) -> bool {
    let lower = text.to_lowercase();
    words.iter().any(|word| lower.contains(word))
}

fn numbered(text: &str) -> bool {
    let lower = text.trim_start().to_lowercase();
    lower.starts_with(|c: char| c.is_ascii_digit())
        || lower.starts_with("étape")
        || lower.starts_with("etape")
        || lower.starts_with("step")
}

/// Extracts the objective (first title) and the steps of a markdown plan.
/// Returns `None` when no step can be found.
pub fn plan_from_markdown(markdown: &str) -> Option<PlanDraft> {
    let lines: Vec<&str> = markdown.lines().collect();
    let headings: Vec<Heading> = lines
        .iter()
        .enumerate()
        .filter_map(|(line, text)| heading(text).map(|(depth, text)| Heading { depth, text, line }))
        .collect();
    let objective = headings
        .iter()
        .find(|h| h.depth == 1)
        .map(|h| h.text.clone())
        .or_else(|| {
            lines
                .iter()
                .map(|l| l.trim())
                .find(|l| !l.is_empty())
                .map(clean)
        })
        .unwrap_or_default();
    let objective = ["Plan :", "Plan:", "Plan —", "Plan -"]
        .iter()
        .find_map(|prefix| objective.strip_prefix(prefix))
        .map(str::trim)
        .unwrap_or(&objective)
        .to_owned();

    let mut steps: Vec<String> = Vec::new();
    // 1. A section announcing the steps: its sub-sections, else its list items.
    if let Some((index, section)) = headings
        .iter()
        .enumerate()
        .find(|(_, h)| h.depth >= 2 && matches_any(&h.text, STEP_SECTIONS))
    {
        let end = headings[index + 1..]
            .iter()
            .find(|h| h.depth <= section.depth)
            .map(|h| h.line)
            .unwrap_or(lines.len());
        steps = headings[index + 1..]
            .iter()
            .take_while(|h| h.line < end)
            .filter(|h| h.depth == section.depth + 1)
            .map(|h| h.text.clone())
            .collect();
        if steps.is_empty() {
            steps = lines[section.line + 1..end]
                .iter()
                .filter_map(|l| list_item(l))
                .collect();
        }
    }
    // 2. Numbered headings ("## Étape 1 — …", "### 2. …").
    if steps.is_empty() {
        let raw: Vec<&Heading> = headings
            .iter()
            .filter(|h| h.depth >= 2 && numbered(&lines[h.line].trim_start()[h.depth..]))
            .collect();
        if let Some(depth) = raw.iter().map(|h| h.depth).min() {
            steps = raw
                .into_iter()
                .filter(|h| h.depth == depth)
                .map(|h| h.text.clone())
                .collect();
        }
    }
    // 3. Second-level sections that are not context, checks or notes.
    if steps.is_empty() {
        steps = headings
            .iter()
            .filter(|h| h.depth == 2 && !matches_any(&h.text, NOT_STEPS))
            .map(|h| h.text.clone())
            .collect();
    }
    // 4. A plain list.
    if steps.is_empty() {
        steps = lines.iter().filter_map(|l| list_item(l)).collect();
    }
    steps.retain(|s| !s.is_empty());
    steps.truncate(MAX_STEPS);
    (!steps.is_empty()).then_some(PlanDraft { objective, steps })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn numbered_step_headings() {
        let plan = "# Plan : créer notes.txt contenant « bonjour »\n\n## Contexte\nx\n\n## Étape 1 — Créer le fichier\nÉcrire.\n\n## Étape 2 — Vérifier\n`od -c`\n";
        let draft = plan_from_markdown(plan).unwrap();
        assert_eq!(draft.objective, "créer notes.txt contenant « bonjour »");
        assert_eq!(draft.steps, ["Créer le fichier", "Vérifier"]);
    }

    #[test]
    fn steps_section_with_subsections() {
        // Shape of a real plan Olivier received (Helpdesk, 2026-11-24).
        let plan = "# Helpdesk Service client : filtre « Demande précise »\n\n## Contexte\nPage.\n\n### Hypothèses retenues\n- H1\n\n## Règles reprises\n- Options\n\n## Étapes\n\n### 1. erp-server — opérateur `_taxonomy_terms_exists_in`\n- a\n\n### 2. erp-client — filtre Demande précise\n- b\n\n### 3. erp-client — Personnaliser en 2 blocs\n\n### 4. Tests\n\n## Vérification\n- PHPUnit\n\n## Hors périmètre\n- x\n";
        let draft = plan_from_markdown(plan).unwrap();
        assert_eq!(
            draft.objective,
            "Helpdesk Service client : filtre « Demande précise »"
        );
        assert_eq!(
            draft.steps,
            [
                "erp-server — opérateur _taxonomy_terms_exists_in",
                "erp-client — filtre Demande précise",
                "erp-client — Personnaliser en 2 blocs",
                "Tests"
            ]
        );
    }

    #[test]
    fn plain_lists_and_unknown_sections() {
        let list = "Plan\n\n1. Lire le code\n2. Corriger\n   - détail\n3. Tester\n";
        assert_eq!(
            plan_from_markdown(list).unwrap().steps,
            ["Lire le code", "Corriger", "Tester"]
        );
        let sections =
            "# But\n## Contexte\n## Refondre l'API\n## Migrer le client\n## Vérification\n";
        assert_eq!(
            plan_from_markdown(sections).unwrap().steps,
            ["Refondre l'API", "Migrer le client"]
        );
        assert_eq!(plan_from_markdown("Juste une phrase."), None);
    }
}
