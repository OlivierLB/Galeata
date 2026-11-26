//! Mechanical wire-content conversions shared by live adapters and history.
use crate::QuestionOption;
use serde_json::Value;

pub(crate) fn question_options(value: &Value) -> Vec<QuestionOption> {
    value
        .as_array()
        .into_iter()
        .flatten()
        .map(|option| QuestionOption {
            label: option["label"].as_str().unwrap_or_default().to_owned(),
            description: option["description"]
                .as_str()
                .unwrap_or_default()
                .to_owned(),
        })
        .collect()
}

pub(crate) fn tool_text(value: &Value) -> String {
    match value {
        Value::String(text) => text.clone(),
        Value::Array(parts) => parts
            .iter()
            .filter_map(|part| part["text"].as_str())
            .collect::<Vec<_>>()
            .join(
                "
",
            ),
        _ => String::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn options_preserve_order_and_missing_field_defaults() {
        let options = question_options(&json!([
            {"label":"Oui","description":"Continuer"},
            {"label":"Non"}, {"label":42,"description":false}, null
        ]));
        assert_eq!(options.len(), 4);
        assert_eq!(options[0].label, "Oui");
        assert_eq!(options[0].description, "Continuer");
        assert_eq!(options[1].label, "Non");
        assert!(options[1].description.is_empty());
        assert!(options[2].label.is_empty());
        assert!(options[3].description.is_empty());
        for value in [json!(null), json!({}), json!("text"), json!([])] {
            assert!(question_options(&value).is_empty());
        }
    }

    #[test]
    fn tool_content_keeps_only_text_without_truncation() {
        assert_eq!(
            tool_text(&json!(
                "écrit
"
            )),
            "écrit
"
        );
        assert_eq!(
            tool_text(
                &json!([{"text":"a"},{"image":"ignored"},{"text":4},{"text":""},{"text":"é"}])
            ),
            "a

é"
        );
        for value in [json!(null), json!({}), json!(42), json!([])] {
            assert_eq!(tool_text(&value), "");
        }
        let long = "é".repeat(crate::MAX_TOOL_OUTPUT);
        assert_eq!(tool_text(&json!(long)), long);
    }
}
