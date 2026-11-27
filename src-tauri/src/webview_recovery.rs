//! Recover a lost WebKit process without silently discarding frontend state.
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use std::time::{Duration, Instant};
use tauri::Manager;
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
use webkit2gtk::{
    HardwareAccelerationPolicy, SettingsExt, WebProcessTerminationReason, WebViewExt,
};

fn failure_operation(reason: WebProcessTerminationReason) -> &'static str {
    match reason {
        WebProcessTerminationReason::Crashed => "webview.crashed",
        WebProcessTerminationReason::ExceededMemoryLimit => "webview.memory_limit",
        _ => "webview.terminated",
    }
}

fn reload_without_acceleration(view: &webkit2gtk::WebView) -> Result<(), &'static str> {
    let settings = view.settings().ok_or("Réglages WebKit indisponibles")?;
    settings.set_hardware_acceleration_policy(HardwareAccelerationPolicy::Never);
    // Let WebKit finish handling termination before starting the next load.
    let view = view.clone();
    webkit2gtk::glib::idle_add_local_once(move || view.reload());
    Ok(())
}

fn stop_activities(state: &crate::State) -> Result<(), &'static str> {
    state.checks.cancel_all();
    let terminals = state
        .terminals
        .lock()
        .map_err(|_| "Les terminaux ne sont pas accessibles.")?
        .drain()
        .map(|(_, terminal)| terminal)
        .collect::<Vec<_>>();
    for mut terminal in terminals {
        terminal.killer.kill().map_err(|_| {
            "Un terminal ne s’est pas arrêté. Fermez Galeata avant de reprendre le projet."
        })?;
    }
    crate::language::stop_all();
    let agents = state
        .agents
        .lock()
        .map_err(|_| "Les conversations ne sont pas accessibles.")?
        .drain()
        .map(|(_, running)| running.agent)
        .collect::<Vec<_>>();
    for agent in &agents {
        agent.stop();
    }
    // stop() returns before SIGTERM/SIGKILL completes. Session restoration must
    // not restart the same conversations while their old processes still run.
    let deadline = Instant::now() + Duration::from_secs(5);
    while agents.iter().any(|agent| agent.is_alive()) || state.checks.is_running() {
        if Instant::now() >= deadline {
            return Err("Certaines activités ne se sont pas arrêtées. Fermez Galeata avant de reprendre le projet.");
        }
        std::thread::sleep(Duration::from_millis(25));
    }
    Ok(())
}

fn recover(handle: tauri::Webview, pending: Arc<AtomicBool>) {
    // Stopping agents must not block GTK's main loop.
    tauri::async_runtime::spawn_blocking(move || {
        let state = handle.app_handle().state::<Arc<crate::State>>();
        if let Err(message) = stop_activities(&state) {
            crate::diagnostics::record("webview.recovery_failed", 0, false);
            handle
                .app_handle()
                .dialog()
                .message(message)
                .title("Galeata — récupération interrompue")
                .kind(MessageDialogKind::Error)
                .show(move |_| pending.store(false, Ordering::Release));
            return;
        }
        let finished = Arc::clone(&pending);
        let result = handle.with_webview(move |platform| {
            let ok = reload_without_acceleration(&platform.inner()).is_ok();
            let operation = if ok {
                "webview.recovery_started"
            } else {
                "webview.recovery_failed"
            };
            crate::diagnostics::record(operation, 0, ok);
            finished.store(false, Ordering::Release);
        });
        if result.is_err() {
            crate::diagnostics::record("webview.recovery_failed", 0, false);
            pending.store(false, Ordering::Release);
        }
    });
}

fn prompt_recovery(handle: &tauri::Webview, pending: Arc<AtomicBool>) {
    let recovery = handle.clone();
    handle.app_handle().dialog()
        .message("Le moteur d’affichage s’est arrêté. Vous pouvez recharger l’interface en rendu logiciel pour contourner les problèmes de composition graphique.\n\nCette action arrêtera les agents, les terminaux et les contrôles en cours. Les fichiers et conversations enregistrés sont conservés ; les éléments non enregistrés peuvent être perdus. Le projet sera rouvert et ses sessions enregistrées seront reprises.")
        .title("Galeata — moteur d’affichage arrêté")
        .kind(MessageDialogKind::Error)
        .buttons(MessageDialogButtons::OkCancelCustom(
            "Arrêter et recharger".into(), "Laisser ouvert".into(),
        ))
        .show(move |reload| {
            if reload {
                recover(recovery, pending);
            } else {
                pending.store(false, Ordering::Release);
            }
        });
}

pub fn init() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    tauri::plugin::Builder::new("webview-recovery")
        .on_webview_ready(|webview| {
            let app = webview.app_handle().clone();
            let label = webview.label().to_owned();
            let result = webview.with_webview(move |platform| {
                // This signal is native: it still works when JavaScript and the
                // renderer have disappeared. Do not reload without consent.
                let prompt_open = Arc::new(AtomicBool::new(false));
                platform
                    .inner()
                    .connect_web_process_terminated(move |_, reason| {
                        crate::diagnostics::record(failure_operation(reason), 0, false);
                        match reason {
                            WebProcessTerminationReason::Crashed => {
                                crate::crash::webview_terminated(false);
                            }
                            WebProcessTerminationReason::ExceededMemoryLimit => {
                                crate::crash::webview_terminated(true);
                            }
                            _ => {}
                        }
                        let Some(handle) = app.get_webview_window(&label) else {
                            return;
                        };
                        if !prompt_open.swap(true, Ordering::AcqRel) {
                            prompt_recovery(handle.as_ref(), Arc::clone(&prompt_open));
                        }
                    });
            });
            if result.is_err() {
                crate::diagnostics::record("webview.monitor_failed", 0, false);
            }
        })
        .build()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn termination_metadata_is_fixed_and_distinguishes_memory_pressure() {
        assert_eq!(
            failure_operation(WebProcessTerminationReason::Crashed),
            "webview.crashed"
        );
        assert_eq!(
            failure_operation(WebProcessTerminationReason::ExceededMemoryLimit),
            "webview.memory_limit"
        );
        assert_eq!(
            failure_operation(WebProcessTerminationReason::TerminatedByApi),
            "webview.terminated"
        );
    }

    #[test]
    #[ignore = "Requires an isolated GTK display: xvfb-run cargo test --lib native_webkit -- --ignored"]
    fn native_webkit_termination_can_reload_with_software_rendering() {
        use gtk::prelude::*;
        use std::{
            cell::Cell,
            rc::Rc,
            time::{Duration, Instant},
        };
        gtk::init().unwrap();
        let view = webkit2gtk::WebView::new();
        let window = gtk::Window::new(gtk::WindowType::Toplevel);
        window.add(&view);
        window.show_all();
        let loaded = Rc::new(Cell::new(0));
        let count = Rc::clone(&loaded);
        view.connect_load_changed(move |_, event| {
            if event == webkit2gtk::LoadEvent::Finished {
                count.set(count.get() + 1);
            }
        });
        let terminated = Rc::new(Cell::new(false));
        let observed = Rc::clone(&terminated);
        view.connect_web_process_terminated(move |view, _| {
            observed.set(true);
            reload_without_acceleration(view).unwrap();
        });
        let wait_for = |phase: &str, condition: &dyn Fn() -> bool| {
            let deadline = Instant::now() + Duration::from_secs(15);
            let context = webkit2gtk::glib::MainContext::default();
            while !condition() {
                assert!(
                    Instant::now() < deadline,
                    "WebKit did not respond during {phase} before the deadline"
                );
                context.iteration(false);
                std::thread::sleep(Duration::from_millis(5));
            }
        };
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("index.html");
        std::fs::write(&path, "<html><body>Recovery fixture</body></html>").unwrap();
        view.load_uri(url::Url::from_file_path(path).unwrap().as_str());
        wait_for("initial load", &|| loaded.get() == 1);
        view.terminate_web_process();
        wait_for("software recovery", &|| {
            terminated.get() && loaded.get() >= 2
        });
        assert_eq!(
            WebViewExt::settings(&view)
                .unwrap()
                .hardware_acceleration_policy(),
            HardwareAccelerationPolicy::Never
        );
        window.close();
    }
}
