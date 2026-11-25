//! Diagnostic: what the mission plan would show for a markdown plan file.
//!
//! cargo run -q -p galeata-agent-protocol --example plan -- path/to/plan.md

use galeata_agent_protocol::plan_from_markdown;

fn main() {
    let path = std::env::args().nth(1).expect("usage : plan <fichier.md>");
    let text = std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{path} : {e}"));
    match plan_from_markdown(&text) {
        Some(draft) => {
            println!("Objectif : {}", draft.objective);
            for (index, step) in draft.steps.iter().enumerate() {
                println!("{:>2}. {step}", index + 1);
            }
        }
        None => println!("Aucune étape trouvée."),
    }
}
