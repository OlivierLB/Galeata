[Français](../fr/webview-recovery.md) · [English](webview-recovery.md)

> Automatically translated from French with Argos Translate. The French version is the reference; the application interface is currently in French.

<a id="écran-noir-et-arrêt-du-moteur-daffichage"></a>

# Black screen and engine shutdown display

Galeata Natively monitor the abnormal end of the WebKitGTK process. An interface-independent dialog box allows you to leave the window open or stop the current activities (agents, terminals and controls) and reload the interface in software rendering.

Reloading requires confirmation: already saved files and conversations are kept, but unrecorded items can be lost. Galeata reopens the current project and resumes its recorded sessions. No automatic reloading is carried out.

Graphic acceleration remains active in normal operation. After recovery, it is disabled only for the view concerned and until the application is closed. Software rendering can increase CPU consumption. It bypasses the path of accelerated composition; it does not guarantee the resolution of all WebKit failures.

Local diagnostics record `webview.crashed`, `webview.memory_limit` or `webview.terminated`then `webview.recovery_started` if reloading has been requested from WebKit. This last event does not prove that the page has finished loading. A crash or memory overrun of the web process also immediately produces a report `webview_crash`, before recovery. These technical events remain unconversial.

Forissue #44, the kernel newspaper of November 27, 2026 indicates at 17:00:39 an error `invalid opcode` Thread `eadedCompositor`, in `libwebkit2gtk-4.1.so.0`. The server still responded to the tools MCP after the display disappears. The user then killed the main process, which produced the report `abnormal_exit`. The internal cause of WebKit error remains undetermined; Recovery avoids killing Galeata to get out of this state.

A native test ignored by default actually ends a WebKit process via its API, reload the page in software rendering and wait for the end of the load. It must be executed on an isolated virtual screen, with GTK and WebKitGTK available:

```sh
xvfb-run -a dbus-run-session -- cargo test --locked --manifest-path src-tauri/Cargo.toml --lib native_webkit -- --ignored --test-threads=1
```

This test validates the signal and reloading of a real page in WebKit; it does not reproduce the error of the driver or composer on the user's post and does not click in the native dialog box.
