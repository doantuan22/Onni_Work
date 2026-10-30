//! Onni Work desktop: a native window around a locally built onni.
//!
//! The shell is deliberately thin. It resolves the entry file of the engine it will run — a
//! checkout named by `ONNI_DESKTOP_ENTRY`, else the active link (`~/.onni/versions/current` that
//! `onni link --use` set) — runs it as a sidecar through the user's login shell (so the
//! `node`, `claude`, `gh` on their PATH are the ones onni sees — a GUI app inherits none of
//! that), waits for `/api/v1/health`, and points the webview at the cockpit.
//!
//! Onni Work ships no signed update channel, so the shell never downloads, installs or replaces
//! onni; updating the engine is a rebuild plus `onni link --use` in the checkout. What the
//! shell does on its own is the SUPERVISOR's job: launch whatever `current` points at, relaunch
//! it when the Versions menu switches the link, and say plainly when no built engine is there.
//!
//! Commands exposed over Tauri IPC — `restart_app` and `show_versions_menu` — beside window
//! dragging. The capability has to name loopback with a port wildcard (the
//! cockpit's port is picked at launch), so the narrowing happens HERE: every command refuses a
//! caller that is not the splash or the cockpit on the port this shell spawned
//! (`caller_is_trusted`) — the failure page's `restart_app` the splash
//! alone (`caller_is_splash`) — and the window itself never stays on another local server
//! (`is_own_origin`, enforced at page load: the navigation hook also sees the Preview's iframes). A dev server on `localhost:3000` is somebody else's page.

use std::collections::VecDeque;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU16, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

mod disclaim;
pub use disclaim::disclaim_exec_if_asked;

#[cfg(any(target_os = "windows", test))]
use tauri::image::Image;
use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::tray::{MouseButton, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, RunEvent, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent};

const HEALTH_TIMEOUT: Duration = Duration::from_secs(60);
const LOG_TAIL: usize = 60;
/// The cockpit's conventional port, tried first so `http://localhost:4321` works in a browser
/// beside the app whenever it can; a busy one falls through to the next few, then to any.
const PREFERRED_PORTS: std::ops::Range<u16> = 4321..4331;

/// Everything the supervisor thread and the menu handler share.
struct Shell {
    child: Mutex<Option<Child>>,
    port: AtomicU16,
    /// Set by the Versions menu before it kills the sidecar: the supervisor loop treats the
    /// resulting exit as "relaunch" instead of "crashed".
    restart_requested: AtomicBool,
    /// "Versions" submenu — one check item per managed install, rebuilt whenever the set or the
    /// active one changes. Switching is the recovery path from ANY version, however old.
    versions_menu: Mutex<Option<Submenu<tauri::Wry>>>,
    /// Set on every move/resize; a background writer persists the geometry shortly after.
    geometry_dirty: AtomicBool,
    /// The running sidecar's version (from health) — what the title strip's version chip
    /// (legacy cockpits) is driven by.
    running_version: Mutex<Option<String>>,
    /// True while a supervisor thread is alive.
    supervising: AtomicBool,
    /// Set once the failure page's "Restart Onni Work" is under way; a second click does nothing.
    restarting: AtomicBool,
    /// The last page of ours the window finished loading — where it returns after a foreign page.
    cockpit_url: Mutex<Option<url::Url>>,
}

/// Runs at document start on EVERY page the window loads — the splash and, after navigation,
/// the cockpit. The cockpit reads `data-onni-desktop` to paint the title band the traffic lights
/// sit in (see `packages/web/src/components/app-shell.tsx`); a browser tab on the same server
/// never sees it.
const INIT_SCRIPT: &str = r#"
  (function () {
    var platform = "__PLATFORM__";
    // `microphone`: this shell is entitled to it. An older macOS shell refuses every
    // dictation, so the cockpit disables the mic there instead.
    window.__ONNI_DESKTOP__ = { platform: platform, microphone: true };
    // At document start the root element may not exist yet; the flag is a convenience, the
    // rest of this script is not.
    if (document.documentElement) document.documentElement.dataset.cezDesktop = platform;
    if (platform !== "macos" || location.protocol !== "http:") return;

    // What the shell adds to the title strip of a cockpit that predates the desktop-aware build
    // (a desktop-aware one paints its own from health): a VERSION chip that opens the list of
    // installed versions — always there, so no version is ever a dead end. It lives after the
    // traffic lights.
    var pendingVersion = null;
    function items() {
      var strip = document.querySelector('[data-onni-legacy-titlebar]');
      if (!strip) return null;
      var row = document.querySelector('[data-onni-titlebar-items]');
      if (row) return row;
      row = document.createElement('div');
      row.setAttribute('data-onni-titlebar-items', '');
      row.style.cssText = 'position:fixed;top:5px;left:80px;height:18px;z-index:2147483001;display:flex;' +
        'align-items:center;gap:6px;color:inherit;' +
        'font:600 11px/1 -apple-system,BlinkMacSystemFont,Inter,system-ui,sans-serif;';
      var style = document.createElement('style');
      style.textContent =
        '[data-onni-titlebar-items] button{appearance:none;height:18px;display:inline-flex;align-items:center;' +
        'gap:6px;padding:0 8px;border-radius:999px;color:inherit;font:inherit;cursor:pointer;-webkit-app-region:no-drag}' +
        '[data-onni-version-chip]{border:1px solid color-mix(in srgb,currentColor 22%,transparent);background:transparent;opacity:.75}' +
        '[data-onni-version-chip]:hover{opacity:1;background:color-mix(in srgb,currentColor 10%,transparent)}';
      document.head.appendChild(style);
      (document.querySelector('[data-slot="app-shell"]') || document.body).appendChild(row);
      return row;
    }
    function invoke(command) {
      if (window.__TAURI_INTERNALS__) window.__TAURI_INTERNALS__.invoke(command);
    }
    function renderVersion(version) {
      var row = items();
      if (!row) { pendingVersion = version; return; }
      var chip = row.querySelector('[data-onni-version-chip]');
      if (!chip) {
        chip = document.createElement('button');
        chip.type = 'button';
        chip.setAttribute('data-onni-version-chip', '');
        chip.title = 'Switch Onni Work version';
        chip.onclick = function () { invoke('show_versions_menu'); };
        row.insertBefore(chip, row.firstChild);
      }
      chip.innerHTML = '<span style="font-family:ui-monospace,Menlo,monospace;font-weight:500">v' + version +
        '</span><span style="font-size:8px;opacity:.7">▼</span>';
    }
    function legacy() {
      // A desktop-aware cockpit shows its own controls — never two sets.
      return !document.querySelector('[data-slot="desktop-titlebar"]');
    }
    // `offer_version` (Rust) calls this once the shell knows.
    window.__ONNI_DESKTOP__.showVersion = function (version) {
      if (version && legacy()) renderVersion(version);
    };

    // A cockpit that knows about the shell paints its own transparent title strip
    // (`data-slot="desktop-titlebar"`). One that predates it does not, and the traffic lights
    // would land on its brand row — so once the page has rendered, give it a transparent strip
    // and inset its columns 28px, so they paint the band in their own (live) theme colours.
    var attempts = 0;
    var timer = setInterval(function () {
      attempts += 1;
      if (document.querySelector('[data-slot="desktop-titlebar"]')) { clearInterval(timer); return; }
      var shell = document.querySelector('[data-slot="app-shell"]');
      if (!shell) { if (attempts > 40) clearInterval(timer); return; }
      clearInterval(timer);
      // Transparent strip + each column padded 28px: the columns paint the band in their OWN
      // theme colours, so a light/dark switch in the cockpit changes the band with it — a
      // colour read once here would not.
      var strip = document.createElement('div');
      strip.setAttribute('data-tauri-drag-region', '');
      strip.setAttribute('data-onni-legacy-titlebar', '');
      strip.style.cssText = 'position:fixed;top:0;left:0;right:0;height:28px;z-index:2147483000;' +
        '-webkit-user-select:none;user-select:none;';
      shell.appendChild(strip);
      var style = document.createElement('style');
      style.textContent =
        // The cockpit's columns — never the strip and the row this script adds beside them,
        // which are `div`s under the same parent: inset too, the row grew to 28px and pushed
        // the version chip out of the band, onto the brand row.
        '[data-slot="app-shell"]>aside[data-slot="sidebar"],' +
        '[data-slot="app-shell"]>div:not([data-onni-legacy-titlebar]):not([data-onni-titlebar-items]){padding-top:28px!important}' +
        '[data-slot="sidebar-content"]>div:first-child{padding-top:6px!important}';
      document.head.appendChild(style);
      if (pendingVersion) { var v = pendingVersion; pendingVersion = null; renderVersion(v); }
    }, 100);
  })();
"#;

/// Runs in every frame; acts only in a DIRECT child of the cockpit — the task Preview's page. It
/// reports where that page is after it moves without a load (`pushState`, `replaceState`, a hash
/// change), so the Preview's address bar and Reload follow it. Same protocol as the Design Mode
/// picker's copy (`packages/work/src/server/preview/location-reporter.ts`); it only reports,
/// to the parent's own origin, and only when that parent is a cockpit origin.
const FRAME_SCRIPT: &str = r#"
  (function () {
    if (window.parent === window || window.parent !== window.top || window.__onniLocation) return;
    var ancestors = location.ancestorOrigins;
    var parentOrigin = ancestors && ancestors.length > 0 ? ancestors[0] : null;
    if (!parentOrigin || !/^(https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?|tauri:\/\/localhost|https?:\/\/tauri\.localhost)$/.test(parentOrigin)) return;
    window.__onniLocation = true;
    var last = null;
    var length = history.length;
    function report(how) {
      var url = location.href;
      if (url === last) return;
      last = url;
      length = history.length;
      try { window.parent.postMessage({ source: 'onni-preview', type: 'location', url: url, how: how }, parentOrigin); } catch (e) {}
    }
    function wrap(name, how) {
      var original = history[name];
      if (typeof original !== 'function') return;
      history[name] = function () {
        var result = original.apply(this, arguments);
        report(how);
        return result;
      };
    }
    wrap('pushState', 'push');
    wrap('replaceState', 'replace');
    function moved() { report(history.length > length ? 'push' : 'pop'); }
    window.addEventListener('popstate', moved);
    window.addEventListener('hashchange', moved);
    report('load');
  })();
"#;

fn platform_name() -> &'static str {
    if cfg!(target_os = "macos") {
        "macos"
    } else if cfg!(windows) {
        "windows"
    } else {
        "linux"
    }
}

fn build_main_window(app: &AppHandle, shell: &Arc<Shell>) -> tauri::Result<WebviewWindow> {
    let shell_for_navigation = shell.clone();
    let shell_for_page_load = shell.clone();
    let builder = WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
        .title("Onni Work")
        .inner_size(1360.0, 900.0)
        .min_inner_size(720.0, 480.0)
        .center()
        // Hidden until the saved geometry is applied, so the window never flashes at the
        // default size and position before jumping to where the user left it.
        .visible(false)
        .initialization_script(INIT_SCRIPT.replace("__PLATFORM__", platform_name()))
        .initialization_script_for_all_frames(FRAME_SCRIPT)
        // The cockpit's own drag-and-drop (view tabs onto the workspace, column headers, files into
        // the composer) is HTML5; Tauri's native file-drop handler swallows those events on macOS.
        .disable_drag_drop_handler()
        // One window, on purpose. Anything that asks for another — `target="_blank"` links (the
        // cockpit's PR and tracker links), `window.open`, the context menu's "Open Link in New
        // Window" — goes to the default browser instead of silently doing nothing.
        .on_new_window(|url, _features| {
            open_url(url.as_str());
            tauri::webview::NewWindowResponse::Deny
        })
        // wry asks this for EVERY frame on macOS and Linux, with no way to tell which one — so a
        // web address must pass here, or the task Preview's iframe can never load. A web page
        // reaching the WINDOW itself is caught at `on_page_load` below instead.
        .on_navigation(move |url| {
            if is_own_origin(url, shell_for_navigation.port.load(Ordering::SeqCst)) || may_be_a_frame(url) {
                return true;
            }
            open_url(url.as_str());
            false
        })
        // Main frame only. The window stays the cockpit (and the splash): any other page —
        // another server on this machine included — is handed to the browser and the window goes
        // back to where it was. The shell is not a general browser.
        .on_page_load(move |window, payload| {
            let url = payload.url();
            if is_own_origin(url, shell_for_page_load.port.load(Ordering::SeqCst)) {
                if matches!(payload.event(), tauri::webview::PageLoadEvent::Finished) {
                    *shell_for_page_load.cockpit_url.lock().unwrap() = Some(url.clone());
                }
                return;
            }
            open_url(url.as_str());
            let back = shell_for_page_load.cockpit_url.lock().unwrap().clone();
            if let Some(back) = back.or_else(|| url::Url::parse(app_origin()).ok()) {
                let _ = window.navigate(back);
            }
        });
    // macOS: no title text; the traffic lights keep their NATIVE placement (a standard title bar
    // is 28pt tall and puts them at the system offset) and float over the 28px band the cockpit
    // paints at the top (`data-slot="desktop-titlebar"`). Native geometry, not ours — the
    // lights then sit exactly where every other app's do.
    #[cfg(target_os = "macos")]
    let builder = builder
        .title_bar_style(tauri::TitleBarStyle::Overlay)
        .hidden_title(true);
    let window = builder.build()?;
    let restored = apply_saved_geometry(&window);
    let _ = window.show();
    // macOS resolves a hidden window's screen lazily; re-assert the position once it is on
    // screen so the first paint lands where it should, not where AppKit cascaded it.
    if let Some((x, y)) = restored {
        let _ = window.set_position(tauri::LogicalPosition::new(x, y));
    }
    if cfg!(debug_assertions) {
        let probe = window.clone();
        std::thread::spawn(move || {
            for delay in [0u64, 500, 1500, 4000] {
                std::thread::sleep(Duration::from_millis(delay));
                if let (Ok(position), Ok(size), Ok(scale)) = (probe.outer_position(), probe.inner_size(), probe.scale_factor()) {
                    let position = position.to_logical::<f64>(scale);
                    let size = size.to_logical::<f64>(scale);
                    eprintln!("[geometry] +{delay}ms at ({}, {}) {}x{} scale {scale}", position.x, position.y, size.width, size.height);
                }
            }
        });
    }
    Ok(window)
}

fn build_menu(app: &AppHandle, shell: &Shell) -> tauri::Result<()> {
    let versions_menu = Submenu::with_id(app, "versions", "Versions", true)?;
    *shell.versions_menu.lock().unwrap() = Some(versions_menu.clone());
    refresh_versions_menu(app, shell);
    let app_menu = Submenu::with_items(
        app,
        "Onni Work",
        true,
        &[
            &PredefinedMenuItem::about(app, None, None)?,
            &PredefinedMenuItem::separator(app)?,
            &versions_menu,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::hide(app, None)?,
            &PredefinedMenuItem::hide_others(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::quit(app, None)?,
        ],
    )?;
    // Without an Edit menu the webview has no Cmd+C / Cmd+V on macOS.
    let edit_menu = Submenu::with_items(
        app,
        "Edit",
        true,
        &[
            &PredefinedMenuItem::undo(app, None)?,
            &PredefinedMenuItem::redo(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, None)?,
            &PredefinedMenuItem::copy(app, None)?,
            &PredefinedMenuItem::paste(app, None)?,
            &PredefinedMenuItem::select_all(app, None)?,
        ],
    )?;
    let window_menu = Submenu::with_items(
        app,
        "Window",
        true,
        &[
            &PredefinedMenuItem::minimize(app, None)?,
            &PredefinedMenuItem::maximize(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::close_window(app, None)?,
        ],
    )?;
    app.set_menu(Menu::with_items(app, &[&app_menu, &edit_menu, &window_menu])?)?;
    Ok(())
}

/// The app's home when its window is closed: closing hides, only Quit (or Cmd/Ctrl+Q) exits.
/// Without a tray that would be a window nobody can bring back.
fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "tray-open", "Open Onni Work", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "tray-quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &quit])?;
    let mut builder = TrayIconBuilder::with_id("onni")
        .tooltip("Onni Work")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "tray-open" => show_main_window(app),
            "tray-quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: tauri::tray::MouseButtonState::Up, .. } = event {
                show_main_window(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    Ok(())
}

fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

/// One installed managed version, as the Versions submenu lists it.
struct InstalledVersion {
    id: String,
    label: String,
    active: bool,
}

/// Every complete install under `~/.onni/versions` (a manifest AND an entry file), newest
/// install first.
fn installed_versions() -> Vec<InstalledVersion> {
    let dir = onni_home().join("versions");
    let active = active_id(&dir);
    let mut rows: Vec<(String, InstalledVersion)> = Vec::new();
    if let Ok(entries) = std::fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let id = entry.file_name().to_string_lossy().into_owned();
            if id == "current" || id.starts_with('.') {
                continue;
            }
            let manifest = std::fs::read_to_string(entry.path().join(".onni-install.json"))
                .ok()
                .and_then(|raw| serde_json::from_str::<serde_json::Value>(&raw).ok());
            let Some(manifest) = manifest else { continue };
            if !entry.path().join("node_modules").join("@onni").join("work").join("dist").join("index.js").is_file() {
                continue;
            }
            let version = manifest.get("version").and_then(|v| v.as_str()).unwrap_or(&id).to_string();
            let source = manifest.get("source").and_then(|v| v.as_str()).unwrap_or("registry");
            let installed_at = manifest.get("installedAt").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let label = version_label(&version, source, manifest.get("branch").and_then(|v| v.as_str()));
            rows.push((installed_at, InstalledVersion { active: active.as_deref() == Some(id.as_str()), id, label }));
        }
    }
    rows.sort_by(|a, b| b.0.cmp(&a.0));
    rows.into_iter().map(|(_, row)| row).collect()
}

/// How the Versions submenu names an install: a local build says so, and a linked checkout
/// (`onni link`, a worktree run in place) reads as its branch — that is what a developer
/// switching between task worktrees is looking for.
fn version_label(version: &str, source: &str, branch: Option<&str>) -> String {
    match (source, branch) {
        ("local", _) => format!("{version} (local build)"),
        ("link", Some(branch)) => format!("{branch} — {version} (worktree)"),
        ("link", None) => format!("{version} (worktree)"),
        _ => version.to_string(),
    }
}

/// Rebuild the Versions submenu from disk: a check item per install, the active one checked.
fn refresh_versions_menu(app: &AppHandle, shell: &Shell) {
    let guard = shell.versions_menu.lock().unwrap();
    let Some(menu) = guard.as_ref() else { return };
    if let Ok(items) = menu.items() {
        for item in items {
            let _ = menu.remove(&item);
        }
    }
    let versions = installed_versions();
    if versions.is_empty() {
        if let Ok(item) = MenuItem::with_id(app, "versions-none", "No versions installed", false, None::<&str>) {
            let _ = menu.append(&item);
        }
        return;
    }
    for version in versions {
        if let Ok(item) = CheckMenuItem::with_id(app, format!("use-version:{}", version.id), &version.label, !version.active, version.active, None::<&str>) {
            let _ = menu.append(&item);
        }
    }
}

/// How long a stopping sidecar gets to run its own shutdown before it is killed. onni's SIGTERM
/// handler flushes run state, bounded at 1.5 s.
#[cfg(target_os = "macos")]
const SIDECAR_STOP_GRACE: Duration = Duration::from_secs(2);

/// Stop the sidecar the way Ctrl-C in a terminal would: SIGTERM first, so onni's own shutdown
/// runs (`store.flush()`), then SIGKILL if it is still there after `SIDECAR_STOP_GRACE`. A bare
/// `kill()` is SIGKILL — it skipped all of that. Only macOS links `libc` (Cargo.toml); elsewhere
/// this keeps the hard kill.
fn stop_sidecar(child: &mut Child) {
    #[cfg(target_os = "macos")]
    {
        // SAFETY: `kill(2)` on our own child's pid; a pid that already exited is a harmless ESRCH.
        if unsafe { libc::kill(child.id() as libc::pid_t, libc::SIGTERM) } == 0 {
            let deadline = Instant::now() + SIDECAR_STOP_GRACE;
            while Instant::now() < deadline {
                if matches!(child.try_wait(), Ok(Some(_))) {
                    return;
                }
                std::thread::sleep(Duration::from_millis(50));
            }
        }
    }
    let _ = child.kill();
}

/// Point `current` at an installed id (atomic rename over the old link) and relaunch.
fn switch_version(shell: &Shell, id: &str) -> bool {
    let dir = onni_home().join("versions");
    if !dir.join(id).join("node_modules").join("@onni").join("work").join("dist").join("index.js").is_file() {
        return false;
    }
    if activate(&dir, id).is_err() {
        return false;
    }
    let mut guard = shell.child.lock().unwrap();
    if let Some(child) = guard.as_mut() {
        shell.restart_requested.store(true, Ordering::SeqCst);
        stop_sidecar(child);
    }
    true
}

/// Whether the legacy strip's version chip has anything to offer.
fn switcher_has_choices(installed: usize) -> bool {
    installed > 1
}

/// Tell the page which version runs. The desktop-aware cockpit ignores this (it paints its own
/// chip); a legacy one grows the switcher in its strip.
fn offer_version(window: &WebviewWindow, version: &str) {
    let _ = window.eval(&format!(
        "window.__ONNI_DESKTOP__ && window.__ONNI_DESKTOP__.showVersion && window.__ONNI_DESKTOP__.showVersion({})",
        js_string(version)
    ));
}

/// The title strip's version chip (legacy cockpits) lands here: pop the Versions list up as a
/// native menu at the pointer. Menus are main-thread objects, commands are not.
#[tauri::command]
fn show_versions_menu(app: AppHandle, window: WebviewWindow, shell: tauri::State<'_, Arc<Shell>>) {
    if !caller_is_trusted(&window, &shell) {
        return;
    }
    use tauri::menu::ContextMenu;
    let shell = shell.inner().clone();
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || {
        refresh_versions_menu(&handle, &shell);
        if let Some(menu) = shell.versions_menu.lock().unwrap().as_ref() {
            let _ = menu.popup(window.as_ref().window().clone());
        }
    });
}

pub fn run() {
    let shell = Arc::new(Shell {
        child: Mutex::new(None),
        port: AtomicU16::new(0),
        restart_requested: AtomicBool::new(false),
        versions_menu: Mutex::new(None),
        geometry_dirty: AtomicBool::new(false),
        running_version: Mutex::new(None),
        supervising: AtomicBool::new(false),
        restarting: AtomicBool::new(false),
        cockpit_url: Mutex::new(None),
    });
    let shell_for_setup = shell.clone();
    let shell_for_menu = shell.clone();
    let shell_for_run = shell.clone();
    let shell_for_events = shell.clone();
    // SIGTERM/SIGINT (a `kill`, a logout, a supervisor of our own) never reach Tauri's Exit
    // event, and an onni older than the parent watch would then outlive us — take the sidecar
    // down here, then leave.
    let shell_for_signal = shell.clone();
    let _ = ctrlc::set_handler(move || {
        if let Some(mut child) = shell_for_signal.child.lock().unwrap().take() {
            stop_sidecar(&mut child);
            let _ = child.wait();
        }
        std::process::exit(0);
    });

    let shell_for_state = shell.clone();
    tauri::Builder::default()
        // First: a second launch must reach the RUNNING app, never start a second sidecar.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| show_main_window(app)))
        .invoke_handler(tauri::generate_handler![restart_app, show_versions_menu])
        .setup(move |app| {
            app.manage(shell_for_state.clone());
            let handle = app.handle().clone();
            build_main_window(&handle, &shell_for_setup)?;
            build_menu(&handle, &shell_for_setup)?;
            build_tray(&handle)?;
            let shell = shell_for_setup.clone();
            let supervisor_handle = handle.clone();
            std::thread::spawn(move || supervise(supervisor_handle, shell));
            let shell = shell_for_setup.clone();
            let badge_handle = handle.clone();
            std::thread::spawn(move || monitor_badge(badge_handle, shell));
            // Geometry writer: coalesces the burst of move/resize events into one file write.
            let shell = shell_for_setup.clone();
            let writer_handle = handle.clone();
            std::thread::spawn(move || loop {
                std::thread::sleep(Duration::from_millis(400));
                if shell.geometry_dirty.swap(false, Ordering::SeqCst) {
                    if let Some(window) = writer_handle.get_webview_window("main") {
                        save_geometry(&window);
                    }
                }
            });
            Ok(())
        })
        .on_menu_event(move |app, event| match event.id().as_ref() {
            id if id.starts_with("use-version:") => {
                let target = id["use-version:".len()..].to_string();
                let app = app.clone();
                let shell = shell_for_menu.clone();
                std::thread::spawn(move || {
                    if let Some(window) = app.get_webview_window("main") {
                        splash_reset(&window, "Switching Onni Work…", &format!("Activating {target}."));
                    }
                    if !switch_version(&shell, &target) {
                        refresh_versions_menu(&app, &shell);
                    }
                });
            }
            _ => {}
        })
        .on_window_event(move |window, event| {
            match event {
                WindowEvent::Moved(position) => {
                    if cfg!(debug_assertions) {
                        eprintln!("[geometry] moved to physical ({}, {}) scale {:?}", position.x, position.y, window.scale_factor().ok());
                    }
                    shell_for_events.geometry_dirty.store(true, Ordering::SeqCst);
                }
                WindowEvent::Resized(size) => {
                    if cfg!(debug_assertions) {
                        eprintln!("[geometry] resized to physical {}x{}", size.width, size.height);
                    }
                    shell_for_events.geometry_dirty.store(true, Ordering::SeqCst);
                }
                // `onni link` / `onni use` in a terminal change what is installed behind the
                // app's back; coming back to the window is the moment the list must be true.
                WindowEvent::Focused(true) => {
                    let app = window.app_handle().clone();
                    let shell = shell_for_events.clone();
                    let _ = window.app_handle().run_on_main_thread(move || refresh_versions_menu(&app, &shell));
                }
                WindowEvent::CloseRequested { .. } => {
                    if let Some(webview) = window.get_webview_window("main") {
                        save_geometry(&webview);
                    }
                }
                _ => {}
            }
            // Closing the window hides it; the app (and the agents it is running) keep going
            // until Quit in the tray or the app menu. Cmd/Q closes a task's tab, never the app.
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .build(tauri::generate_context!())
        .expect("failed to build the onni desktop shell")
        .run(move |app, event| match event {
            #[cfg(target_os = "macos")]
            RunEvent::Reopen { .. } => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            RunEvent::Exit => {
                if let Some(window) = app.get_webview_window("main") {
                    save_geometry(&window);
                }
                if let Some(mut child) = shell_for_run.child.lock().unwrap().take() {
                    stop_sidecar(&mut child);
                    let _ = child.wait();
                }
            }
            _ => {}
        });
}

/// Spawn → wait for health → show cockpit → wait for exit → relaunch on a requested restart,
/// report otherwise. With no built engine in place, show the page that says how to provide one.
fn supervise(app: AppHandle, shell: Arc<Shell>) {
    if shell.supervising.swap(true, Ordering::SeqCst) {
        return;
    }
    struct Done<'a>(&'a Shell);
    impl Drop for Done<'_> {
        fn drop(&mut self) {
            self.0.supervising.store(false, Ordering::SeqCst);
        }
    }
    let _done = Done(&shell);
    let window = loop {
        if let Some(window) = app.get_webview_window("main") {
            break window;
        }
        std::thread::sleep(Duration::from_millis(50));
    };

    // The sidecar needs Node 20+: the engine is a Node program, and nothing is downloaded on its
    // behalf. Without it the honest answer is a page that says so and offers a retry.
    if !require_node(&window) {
        return;
    }

    loop {
        let entry = match resolve_entry() {
            Some(entry) => entry,
            None => {
                engine_missing(&window);
                return;
            }
        };
        let port = pick_port();
        shell.port.store(port, Ordering::SeqCst);
        let project = pick_project();
        refresh_versions_menu(&app, &shell);
        splash_reset(&window, "Starting Onni Work…", &entry.to_string_lossy());

        let log: Arc<Mutex<VecDeque<String>>> = Arc::new(Mutex::new(VecDeque::new()));
        let mut child = match spawn_sidecar(&entry, port, project.as_deref(), log.clone()) {
            Ok(child) => child,
            Err(error) => {
                fail(&window, "Onni Work could not start", &error, "");
                return;
            }
        };
        let pid = child.id();

        let url = format!("http://127.0.0.1:{port}");
        if let Some(version) = wait_for_health(port, &mut child, HEALTH_TIMEOUT) {
            *shell.running_version.lock().unwrap() = Some(version);
            if let Ok(parsed) = url::Url::parse(&url) {
                let _ = window.navigate(parsed);
            }
            probe_ipc(&window);
            // The legacy strip's version chip: offered once the cockpit has loaded, then again
            // every half hour (a reload may have replaced the strip).
            let app = app.clone();
            let shell = shell.clone();
            let generation = pid;
            std::thread::spawn(move || loop {
                std::thread::sleep(Duration::from_secs(4));
                // The chip is a SWITCHER: with one version installed it would open a list of
                // one. The version itself is already in the cockpit's sidebar and in the menu.
                if switcher_has_choices(installed_versions().len()) {
                    if let (Some(version), Some(window)) = (shell.running_version.lock().unwrap().clone(), app.get_webview_window("main")) {
                        offer_version(&window, &version);
                    }
                }
                std::thread::sleep(Duration::from_secs(30 * 60));
                // A new sidecar starts its own offer loop; this one retires.
                let current = shell.child.lock().unwrap().as_ref().map(|child| child.id());
                if current != Some(generation) {
                    return;
                }
            });
        } else {
            let tail = log.lock().unwrap().iter().cloned().collect::<Vec<_>>().join("\n");
            fail(&window, "Onni Work did not come up", &format!("No answer on {url} within {}s (pid {pid}).", HEALTH_TIMEOUT.as_secs()), &tail);
            let _ = child.kill();
            return;
        }

        *shell.child.lock().unwrap() = Some(child);
        let status = loop {
            let mut guard = shell.child.lock().unwrap();
            match guard.as_mut() {
                Some(child) => match child.try_wait() {
                    Ok(Some(status)) => break Some(status),
                    Ok(None) => {}
                    Err(_) => break None,
                },
                None => break None, // taken by Exit — the app is quitting
            }
            drop(guard);
            std::thread::sleep(Duration::from_millis(250));
        };
        *shell.child.lock().unwrap() = None;

        let requested = shell.restart_requested.swap(false, Ordering::SeqCst);
        match status.and_then(|s| s.code()) {
            _ if requested => {
                splash_reset(&window, "Restarting Onni Work…", "Switching to the newly installed version.");
                continue;
            }
            Some(code) => {
                let tail = log.lock().unwrap().iter().cloned().collect::<Vec<_>>().join("\n");
                fail(&window, "Onni Work stopped", &stopped_detail(code), &tail);
                return;
            }
            None => return,
        }
    }
}

// ---- Node.js — the one prerequisite ---------------------------------------------------------

/// The `node` the shell runs: `ONNI_DESKTOP_NODE` when set (a path, or a bogus one to test the
/// missing-Node page), else whatever the user's PATH resolves.
fn node_program() -> String {
    std::env::var("ONNI_DESKTOP_NODE").ok().filter(|v| !v.is_empty()).unwrap_or_else(|| "node".into())
}

/// Node 20+ reachable? Returns its version, or the reason it is not. Also decides the PATH every
/// later `tool_command` gets, so the sidecar runs the same Node this check found:
/// 1. the PATH the user's shell reports (cached from the first call);
/// 2. that PATH resolved AGAIN — Node may have been installed since (the splash's "Try again");
/// 3. the folders installers and version managers use, each `node` asked directly — a lazy nvm,
///    an rc file a login shell skips, an old system Node shadowing a new one.
fn check_node() -> Result<String, String> {
    let first = node_version(tool_command(&node_program(), &["-p", "process.versions.node"]));
    if first.is_ok() || std::env::var_os("ONNI_DESKTOP_NODE").is_some_and(|v| !v.is_empty()) {
        return first;
    }
    set_tool_path(ToolPath { node_dir: None, base: resolve_base_path() });
    if let Ok(version) = node_version(tool_command(&node_program(), &["-p", "process.versions.node"])) {
        return Ok(version);
    }
    let env = |name: &str| std::env::var(name).ok().filter(|v| !v.is_empty());
    match find_node_in(&candidate_node_dirs(&env)) {
        Some((dir, version)) => {
            let base = tool_path().base;
            set_tool_path(ToolPath { node_dir: Some(dir), base });
            Ok(version)
        }
        None => first,
    }
}

/// Runs `node -p process.versions.node` and judges the answer.
fn node_version(mut command: Command) -> Result<String, String> {
    let not_found = || "Node.js was not found on your PATH.".to_string();
    let (success, stdout) = output_with_timeout(command.stdin(Stdio::null()), Duration::from_secs(30)).ok_or_else(not_found)?;
    let version = stdout.trim().to_string();
    if !success || version.is_empty() {
        return Err(not_found());
    }
    let major = version.split('.').next().and_then(|m| m.parse::<u32>().ok()).unwrap_or(0);
    if major < 20 {
        return Err(format!("Node.js {version} is installed, but Onni Work needs 20 or newer."));
    }
    Ok(version)
}

/// The first folder whose own `node` is 20+, asked directly rather than through any PATH.
fn find_node_in(dirs: &[PathBuf]) -> Option<(PathBuf, String)> {
    dirs.iter().find_map(|dir| {
        let mut command = Command::new(dir.join(NODE_EXE));
        command.arg("-p").arg("process.versions.node");
        hide_console(&mut command);
        node_version(command).ok().map(|version| (dir.clone(), version))
    })
}

const NODE_EXE: &str = if cfg!(windows) { "node.exe" } else { "node" };

/// Waits at most `timeout` for `command`; `(exit success, stdout)`, or `None` when it could not
/// start or ran out of time (then it is killed). Stderr is discarded.
fn output_with_timeout(command: &mut Command, timeout: Duration) -> Option<(bool, String)> {
    let mut child = command.stdout(Stdio::piped()).stderr(Stdio::null()).spawn().ok()?;
    let mut stdout = child.stdout.take()?;
    let (sender, output) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let mut out = String::new();
        let _ = stdout.read_to_string(&mut out);
        let _ = sender.send(out);
    });
    let deadline = Instant::now() + timeout;
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(25)),
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                return None;
            }
        }
    };
    // A background job the child started can hold stdout open past its exit.
    let out = output.recv_timeout(deadline.saturating_duration_since(Instant::now()).max(Duration::from_millis(500))).ok()?;
    Some((status.success(), out))
}

/// The failure page's "Restart Onni Work": stop the sidecar, then start the whole app again from a
/// fresh process.
#[tauri::command]
fn restart_app(app: AppHandle, window: WebviewWindow, shell: tauri::State<'_, Arc<Shell>>) {
    if !caller_is_splash(&window) || shell.restarting.swap(true, Ordering::SeqCst) {
        return;
    }
    let shell = shell.inner().clone();
    std::thread::spawn(move || {
        splash_reset(&window, "Restarting Onni Work…", "");
        if let Some(mut child) = shell.child.lock().unwrap().take() {
            stop_sidecar(&mut child);
            let _ = child.wait();
        }
        app.restart();
    });
}

/// The sidecar is a Node program: with no Node 20+ anywhere the honest answer is a page that
/// says so, names where to get one, and offers the Restart button. Nothing is downloaded here.
fn require_node(window: &WebviewWindow) -> bool {
    match check_node() {
        Ok(_) => true,
        Err(reason) => {
            fail(
                window,
                "Onni Work could not start Node.js",
                &format!("{reason} Install Node.js 20 or newer from https://nodejs.org, then press Restart."),
                "",
            );
            false
        }
    }
}

// ---- telling the user there is no engine ------------------------------------------------

/// The page every launch without a built engine shows: there is no network install to fall back
/// on, so it names the build and the link that put one in place.
fn engine_missing(window: &WebviewWindow) {
    fail(
        window,
        "No Onni Work engine found",
        "In this repository run npm install once, then npm run build, and register the build with \
         node packages/work/dist/index.js link --use. Alternatively set ONNI_DESKTOP_ENTRY to \
         packages/work/dist/index.js and ONNI_DESKTOP_CWD to the repository. Then press Restart.",
        "",
    );
}

// ---- process -------------------------------------------------------------------------------

fn spawn_sidecar(entry: &Path, port: u16, project: Option<&Path>, log: Arc<Mutex<VecDeque<String>>>) -> Result<Child, String> {
    let args = sidecar_args(entry, port, project);
    let mut command = tool_command(&node_program(), &args.iter().map(String::as_str).collect::<Vec<_>>());
    command
        // Never the project itself: on macOS a project under Desktop/Documents/Downloads the app may
        // not read fails getcwd, and onni exited 1 before answering.
        .current_dir(home_dir())
        .env("ONNI_DESKTOP", "1")
        .env("ONNI_SUPERVISED", "1")
        // onni polls this pid and exits when it is gone — a force-quit of the shell never
        // leaves a headless cockpit behind (the Exit handler only runs on a clean quit).
        .env("ONNI_SUPERVISOR_PID", std::process::id().to_string())
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    // onni starts agents through this binary so macOS privacy prompts name the agent, not the
    // app (`disclaim.rs`). The cockpit server itself stays the app's own.
    if cfg!(target_os = "macos") {
        if let Ok(exe) = std::env::current_exe() {
            command.env("ONNI_DISCLAIM_EXEC", exe);
        }
    }
    let mut child = command.spawn().map_err(|error| format!("could not start node: {error}"))?;
    for reader in [
        child.stdout.take().map(|out| Box::new(out) as Box<dyn Read + Send>),
        child.stderr.take().map(|err| Box::new(err) as Box<dyn Read + Send>),
    ]
    .into_iter()
    .flatten()
    {
        let log = log.clone();
        std::thread::spawn(move || {
            for line in BufReader::new(reader).lines().map_while(Result::ok) {
                let mut log = log.lock().unwrap();
                if log.len() >= LOG_TAIL {
                    log.pop_front();
                }
                log.push_back(line);
            }
        });
    }
    Ok(child)
}

/// `program` with `args`, the way this platform finds the user's tools.
///
/// macOS and Linux: through the user's LOGIN shell, because a GUI app inherits none of the PATH
/// their terminal has — nvm, volta and homebrew entries only exist after the profile ran.
/// Windows: directly. There is no login shell, the PATH a GUI process gets is the user's own
/// (installers write it to the registry), and `cmd` understands none of POSIX quoting — so
/// nothing here is ever a script on Windows, only a program and its arguments.
/// Either way the PATH is the one `check_node` settled on (`ToolPath`).
fn tool_command(program: &str, args: &[&str]) -> Command {
    let path = tool_path();
    #[cfg(windows)]
    {
        let mut command = Command::new(program);
        command.args(args);
        hide_console(&mut command);
        if path.node_dir.is_some() || path.base.is_some() {
            let base = path.base.map(std::ffi::OsString::from).or_else(|| std::env::var_os("PATH")).unwrap_or_default();
            if let Ok(joined) = std::env::join_paths(path.node_dir.into_iter().chain(std::env::split_paths(&base))) {
                command.env("PATH", joined);
            }
        }
        command
    }
    #[cfg(not(windows))]
    {
        let node_dir = path.node_dir.map(|dir| dir.to_string_lossy().into_owned());
        let mut command = Command::new(user_shell());
        command.args(["-lc", &posix_script(node_dir.as_deref(), path.base.as_deref(), program, args)]);
        command
    }
}

/// No console window flashing up behind the app for every node and npm call.
fn hide_console(command: &mut Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    #[cfg(not(windows))]
    let _ = command;
}

/// The PATH every tool command runs with.
#[derive(Clone, Default)]
struct ToolPath {
    /// A Node 20+ folder found outside the PATH, put FIRST so npm and the sidecar use it too.
    node_dir: Option<PathBuf>,
    /// The PATH to use instead of the inherited one: an interactive login shell's (macOS, Linux)
    /// or the registry's (Windows). `None` keeps the profile's / the process's own.
    base: Option<String>,
}

static TOOL_PATH: Mutex<Option<ToolPath>> = Mutex::new(None);

/// Resolved on first use, then kept — a shell start per npm call would be slow.
fn tool_path() -> ToolPath {
    let mut guard = TOOL_PATH.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    guard
        .get_or_insert_with(|| ToolPath { node_dir: None, base: if cfg!(windows) { None } else { resolve_base_path() } })
        .clone()
}

fn set_tool_path(path: ToolPath) {
    *TOOL_PATH.lock().unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(path);
}

/// The user's PATH as of NOW. macOS/Linux: an interactive login shell's — a login shell alone
/// skips `~/.zshrc`/`~/.bashrc`, where nvm, fnm and most version managers put Node. Windows: the
/// registry's machine + user PATH, because a GUI process keeps the PATH Explorer had when the
/// user logged in, from before Node was installed. `None` when it cannot be read: a hung or
/// noisy rc file degrades to the inherited PATH, never blocks boot.
fn resolve_base_path() -> Option<String> {
    #[cfg(windows)]
    {
        let system_root = std::env::var("SystemRoot").unwrap_or_else(|_| r"C:\Windows".into());
        let powershell = Path::new(&system_root).join(r"System32\WindowsPowerShell\v1.0\powershell.exe");
        let mut command = Command::new(if powershell.is_file() { powershell } else { PathBuf::from("powershell.exe") });
        command.args([
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            "[Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')",
        ]);
        command.stdin(Stdio::null());
        hide_console(&mut command);
        let (success, stdout) = output_with_timeout(&mut command, Duration::from_secs(10))?;
        let inherited = std::env::var("PATH").unwrap_or_default();
        (success && !stdout.trim().trim_matches(';').is_empty()).then(|| merge_paths(stdout.trim(), &inherited, ';'))
    }
    #[cfg(not(windows))]
    {
        resolve_interactive_path(&user_shell(), Duration::from_secs(10))
    }
}

/// `first`'s entries, then `second`'s that `first` lacks — order kept, empties dropped.
#[cfg(any(windows, test))]
fn merge_paths(first: &str, second: &str, separator: char) -> String {
    let mut seen = std::collections::HashSet::new();
    first
        .split(separator)
        .chain(second.split(separator))
        .map(str::trim)
        .filter(|entry| !entry.is_empty() && seen.insert(entry.to_ascii_lowercase()))
        .collect::<Vec<_>>()
        .join(&separator.to_string())
}

#[cfg(not(windows))]
fn user_shell() -> String {
    std::env::var("SHELL").ok().filter(|v| !v.is_empty()).unwrap_or_else(|| if cfg!(target_os = "macos") { "/bin/zsh".into() } else { "/bin/bash".into() })
}

#[cfg(any(not(windows), test))]
const PATH_MARKER: &str = "__ONNI_DESKTOP_PATH__";

#[cfg(not(windows))]
fn resolve_interactive_path(shell: &str, timeout: Duration) -> Option<String> {
    let script = format!("echo; echo {PATH_MARKER}; printenv PATH; echo {PATH_MARKER}");
    let mut command = Command::new(shell);
    command.args(["-ilc", &script]).stdin(Stdio::null());
    parse_marked_path(&output_with_timeout(&mut command, timeout)?.1)
}

/// The line between the two markers — whatever an rc file printed around it is ignored.
#[cfg(any(not(windows), test))]
fn parse_marked_path(output: &str) -> Option<String> {
    let mut lines = output.lines().map(str::trim);
    lines.find(|line| *line == PATH_MARKER)?;
    let path = lines.next()?;
    (lines.next()? == PATH_MARKER && !path.is_empty()).then(|| path.to_string())
}

/// Every folder an installer or version manager puts a `node` in, most deliberate first: the
/// version managers (newest 20+ install first), then package managers, then the system. Only
/// folders that hold a `node` survive. `check_node` asks each one in turn.
fn candidate_node_dirs(env: &dyn Fn(&str) -> Option<String>) -> Vec<PathBuf> {
    let mut dirs: Vec<PathBuf> = Vec::new();
    let dir_of = |name: &str| env(name).map(PathBuf::from);
    if cfg!(windows) {
        let local = dir_of("LOCALAPPDATA");
        let roaming = dir_of("APPDATA");
        let profile = dir_of("USERPROFILE");
        let program_data = dir_of("ProgramData").unwrap_or_else(|| r"C:\ProgramData".into());
        // nvm-windows: the active version's symlink, then every install (`v22.11.0\node.exe`).
        dirs.extend(dir_of("NVM_SYMLINK"));
        for nvm in [dir_of("NVM_HOME"), roaming.as_ref().map(|r| r.join("nvm"))].into_iter().flatten() {
            dirs.extend(node_versions(&nvm, None));
        }
        for fnm in [dir_of("FNM_DIR"), roaming.as_ref().map(|r| r.join("fnm")), local.as_ref().map(|l| l.join("fnm"))].into_iter().flatten() {
            dirs.push(fnm.join("aliases").join("default"));
            dirs.extend(node_versions(&fnm.join("node-versions"), Some("installation")));
        }
        for volta in [dir_of("VOLTA_HOME").map(|v| v.join("bin")), local.as_ref().map(|l| l.join(r"Volta\bin"))].into_iter().flatten() {
            dirs.push(volta);
        }
        for nvs in [dir_of("NVS_HOME"), local.as_ref().map(|l| l.join("nvs"))].into_iter().flatten() {
            dirs.push(nvs.join("default"));
        }
        if let Some(local) = &local {
            dirs.push(local.join(r"mise\shims"));
            dirs.extend(node_versions(&local.join(r"mise\installs\node"), None));
            dirs.push(local.join("pnpm"));
        }
        dirs.extend(dir_of("PNPM_HOME"));
        for scoop in [dir_of("SCOOP"), profile.as_ref().map(|p| p.join("scoop")), dir_of("SCOOP_GLOBAL"), Some(program_data.join("scoop"))].into_iter().flatten() {
            dirs.push(scoop.join(r"apps\nodejs\current"));
            dirs.push(scoop.join(r"apps\nodejs-lts\current"));
            dirs.push(scoop.join("shims"));
        }
        dirs.push(dir_of("ChocolateyInstall").unwrap_or_else(|| program_data.join("chocolatey")).join("bin"));
        for files in [dir_of("ProgramFiles"), dir_of("ProgramW6432"), dir_of("ProgramFiles(x86)")].into_iter().flatten() {
            dirs.push(files.join("nodejs"));
            dirs.push(files.join("Volta"));
        }
    } else {
        let home = dir_of("HOME");
        let at_home = |rel: &str| home.as_ref().map(|h| h.join(rel));
        let xdg_config = dir_of("XDG_CONFIG_HOME").or_else(|| at_home(".config"));
        let xdg_data = dir_of("XDG_DATA_HOME").or_else(|| at_home(".local/share"));
        for nvm in [dir_of("NVM_DIR"), at_home(".nvm"), xdg_config.as_ref().map(|c| c.join("nvm"))].into_iter().flatten() {
            dirs.extend(node_versions(&nvm.join("versions").join("node"), Some("bin")));
        }
        for fnm in [dir_of("FNM_DIR"), xdg_data.as_ref().map(|d| d.join("fnm")), at_home("Library/Application Support/fnm"), at_home(".fnm")].into_iter().flatten() {
            dirs.push(fnm.join("aliases/default/bin"));
            dirs.extend(node_versions(&fnm.join("node-versions"), Some("installation/bin")));
        }
        dirs.extend(dir_of("VOLTA_HOME").map(|v| v.join("bin")).into_iter().chain(at_home(".volta/bin")));
        for mise in [dir_of("MISE_DATA_DIR"), xdg_data.as_ref().map(|d| d.join("mise"))].into_iter().flatten() {
            dirs.push(mise.join("shims"));
            dirs.extend(node_versions(&mise.join("installs/node"), Some("bin")));
        }
        for asdf in [dir_of("ASDF_DATA_DIR"), at_home(".asdf")].into_iter().flatten() {
            dirs.push(asdf.join("shims"));
            dirs.extend(node_versions(&asdf.join("installs/nodejs"), Some("bin")));
        }
        if let Some(nodenv) = dir_of("NODENV_ROOT").or_else(|| at_home(".nodenv")) {
            dirs.push(nodenv.join("shims"));
            dirs.extend(node_versions(&nodenv.join("versions"), Some("bin")));
        }
        // n: its prefix, then the versions it keeps.
        for prefix in [dir_of("N_PREFIX"), at_home("n"), Some("/usr/local".into())].into_iter().flatten() {
            dirs.push(prefix.join("bin"));
            dirs.extend(node_versions(&prefix.join("n/versions/node"), Some("bin")));
        }
        dirs.extend(at_home(".nodebrew/current/bin"));
        dirs.extend(dir_of("PNPM_HOME").into_iter().chain(at_home("Library/pnpm")).chain(xdg_data.as_ref().map(|d| d.join("pnpm"))));
        dirs.extend(at_home(".vite-plus/bin"));
        // Homebrew, including the keg-only `node@22` a `brew install node@22` never links.
        for brew in ["/opt/homebrew", "/usr/local", "/home/linuxbrew/.linuxbrew"].map(PathBuf::from).into_iter().chain(at_home(".linuxbrew")) {
            dirs.push(brew.join("bin"));
            dirs.extend(node_versions(&brew.join("opt"), Some("bin")));
        }
        dirs.push("/opt/local/bin".into()); // MacPorts
        dirs.extend(at_home(".nix-profile/bin"));
        dirs.extend(dir_of("USER").map(|user| PathBuf::from("/etc/profiles/per-user").join(user).join("bin")));
        dirs.extend(["/nix/var/nix/profiles/default/bin", "/run/current-system/sw/bin", "/snap/bin", "/usr/bin"].map(PathBuf::from));
        dirs.extend(at_home(".local/bin"));
    }
    let mut seen = std::collections::HashSet::new();
    dirs.retain(|dir| dir.join(NODE_EXE).is_file() && seen.insert(dir.clone()));
    dirs
}

/// Node 20+ installs under `parent` — `v22.11.0`, `22.11.0` or Homebrew's `node@22` — newest
/// first, each joined with `sub` (`bin`, `installation/bin`, …).
fn node_versions(parent: &Path, sub: Option<&str>) -> Vec<PathBuf> {
    let Ok(entries) = std::fs::read_dir(parent) else { return Vec::new() };
    let mut found: Vec<((u32, u32, u32), PathBuf)> = entries
        .filter_map(|entry| {
            let entry = entry.ok()?;
            let version = parse_node_version(&entry.file_name().to_string_lossy())?;
            let dir = sub.map_or_else(|| entry.path(), |sub| entry.path().join(sub));
            (version.0 >= 20).then_some((version, dir))
        })
        .collect();
    found.sort_by_key(|(version, _)| std::cmp::Reverse(*version));
    found.into_iter().map(|(_, dir)| dir).collect()
}

fn parse_node_version(name: &str) -> Option<(u32, u32, u32)> {
    if let Some(major) = name.strip_prefix("node@") {
        return Some((major.parse().ok()?, 0, 0));
    }
    let mut parts = name.strip_prefix('v').unwrap_or(name).split('.').map(|part| part.parse::<u32>().ok());
    let version = (parts.next()??, parts.next()??, parts.next()??);
    parts.next().is_none().then_some(version)
}

/// `[export PATH=…; ]exec 'program' 'arg' …` — every word single-quoted, so a path with a space
/// or a quote in it stays one argument. The export runs after the profile, so it wins; `node_dir`
/// goes first, ahead of `base` or, without one, the profile's own `$PATH`.
#[cfg(any(not(windows), test))]
fn posix_script(node_dir: Option<&str>, base: Option<&str>, program: &str, args: &[&str]) -> String {
    let mut script = match (node_dir, base) {
        (Some(dir), Some(base)) => format!("export PATH={}; ", shell_quote(&format!("{dir}:{base}"))),
        (Some(dir), None) => format!("export PATH={}:\"$PATH\"; ", shell_quote(dir)),
        (None, Some(base)) => format!("export PATH={}; ", shell_quote(base)),
        (None, None) => String::new(),
    };
    script.push_str(&format!("exec {}", shell_quote(program)));
    for arg in args {
        script.push(' ');
        script.push_str(&shell_quote(arg));
    }
    script
}

#[cfg(any(not(windows), test))]
fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

// ---- the managed layout --------------------------------------------------------------------
//
// The same layout and rules as packages/work/src/self-update/layout.ts. Written against the
// filesystem rather than as a shell script, so one implementation — and one set of tests —
// serves macOS, Linux and Windows.

fn entry_under(root: &Path) -> PathBuf {
    root.join("node_modules").join("@onni").join("work").join("dist").join("index.js")
}

/// A version id becomes a directory name under `versions/`: a plain version and nothing else.
/// The rule of `assertSafeId` in layout.ts.
fn valid_version_id(id: &str) -> bool {
    id.chars().next().is_some_and(|first| first.is_ascii_alphanumeric())
        && id.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '+' | '-'))
        && !id.contains("..")
        && id.len() <= 64
}

/// The id `current` points at: a link (a symlink, or a junction on Windows), else a text file
/// holding the id — what onni writes where it could create neither.
fn active_id(versions: &Path) -> Option<String> {
    let current = versions.join("current");
    std::fs::read_link(&current)
        .ok()
        .and_then(|target| target.file_name().map(|name| name.to_string_lossy().into_owned()))
        .or_else(|| std::fs::read_to_string(&current).ok().map(|raw| raw.trim().to_string()))
        .filter(|id| valid_version_id(id))
}

/// The active version's entry file, or None when nothing usable is installed.
fn managed_entry(versions: &Path) -> Option<PathBuf> {
    let through_link = entry_under(&versions.join("current"));
    if through_link.is_file() {
        return Some(through_link);
    }
    let by_id = entry_under(&versions.join(active_id(versions)?));
    by_id.is_file().then_some(by_id)
}

/// Point `current` at an installed id.
fn activate(versions: &Path, id: &str) -> Result<(), String> {
    if !valid_version_id(id) || !entry_under(&versions.join(id)).is_file() {
        return Err(format!("version {id} is not installed"));
    }
    let current = versions.join("current");
    #[cfg(unix)]
    {
        // Atomic: the new link is made beside the old one and renamed over it.
        let tmp = versions.join(format!(".current.{}.tmp", std::process::id()));
        let _ = std::fs::remove_file(&tmp);
        std::os::unix::fs::symlink(id, &tmp).map_err(|error| error.to_string())?;
        std::fs::rename(&tmp, &current).map_err(|error| {
            let _ = std::fs::remove_file(&tmp);
            error.to_string()
        })
    }
    #[cfg(windows)]
    {
        // A junction: a directory link that needs no privilege (a symlink needs developer mode
        // or an elevated process). Windows will not rename one over another, so the old link
        // goes first — `remove_dir` on a link removes the link, never what it points at.
        if std::fs::remove_dir(&current).is_err() {
            let _ = std::fs::remove_file(&current);
        }
        junction::create(versions.join(id), &current).map_err(|error| error.to_string())
    }
}

/// The bundled splash (`tauri://` / `http://tauri.localhost`) and the cockpit — loopback http on
/// the port THIS shell spawned it on, and no other. `port` 0 means no sidecar yet: nothing on
/// loopback is ours.
fn is_own_origin(url: &url::Url, port: u16) -> bool {
    match (url.scheme(), url.host_str()) {
        ("tauri", _) => true,
        ("http" | "https", Some("tauri.localhost")) => true,
        ("http", Some("127.0.0.1" | "localhost")) => port != 0 && url.port_or_known_default() == Some(port),
        _ => false,
    }
}

/// What an iframe of the cockpit may load — the task Preview frames any web page. Everything
/// else (`mailto:`, `file:`, …) is the browser's or the OS's to open.
fn may_be_a_frame(url: &url::Url) -> bool {
    matches!(url.scheme(), "http" | "https" | "about" | "blob" | "data")
}

/// The guard every IPC command starts with: the page asking must be one of ours. The capability
/// cannot express this (it grants loopback on any port), so the commands do.
fn caller_is_trusted(window: &WebviewWindow, shell: &Shell) -> bool {
    window.url().map(|url| is_own_origin(&url, shell.port.load(Ordering::SeqCst))).unwrap_or(false)
}

/// The failure page's command (`restart_app`): the splash only, never the
/// cockpit — port 0 trusts nothing on loopback.
fn caller_is_splash(window: &WebviewWindow) -> bool {
    window.url().is_ok_and(|url| is_own_origin(&url, 0))
}

fn open_url(url: &str) {
    #[cfg(target_os = "macos")]
    let _ = Command::new("open").arg(url).spawn();
    #[cfg(windows)]
    let _ = Command::new("cmd").args(["/C", "start", "", url]).spawn();
    #[cfg(all(unix, not(target_os = "macos")))]
    let _ = Command::new("xdg-open").arg(url).spawn();
}

/// A one-shot loopback HTTP GET without an HTTP client dependency. Answers the body of a 200,
/// None otherwise. The caller is this shell, so the Host header is always its own loopback.
fn http_get(port: u16, path: &str) -> Option<String> {
    let mut stream = TcpStream::connect_timeout(&format!("127.0.0.1:{port}").parse().ok()?, Duration::from_millis(500)).ok()?;
    let _ = stream.set_read_timeout(Some(Duration::from_millis(1500)));
    let request = format!("GET {path} HTTP/1.0\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n");
    stream.write_all(request.as_bytes()).ok()?;
    let mut buffer = Vec::new();
    let _ = stream.read_to_end(&mut buffer);
    let text = String::from_utf8_lossy(&buffer);
    if !(text.starts_with("HTTP/1.0 200") || text.starts_with("HTTP/1.1 200")) {
        return None;
    }
    text.split("\r\n\r\n").nth(1).map(str::to_owned)
}

/// Answers the `version` `/api/v1/health` reports on a 200, None otherwise.
fn health_version(port: u16) -> Option<String> {
    let body = http_get(port, "/api/v1/health")?;
    let version = serde_json::from_str::<serde_json::Value>(&body)
        .ok()
        .and_then(|json| json.get("version").and_then(|v| v.as_str()).map(str::to_owned));
    Some(version.unwrap_or_default())
}

// ---- taskbar badge -------------------------------------------------------------------------

/// Tasks the window's project is running. The badge follows the boot project, which is the one
/// the window opens; a task in a project the window never visited is not counted.
fn running_run_count(port: u16) -> usize {
    http_get(port, "/api/v1/runs").as_deref().map(count_running).unwrap_or(0)
}

fn count_running(body: &str) -> usize {
    serde_json::from_str::<Vec<serde_json::Value>>(body)
        .map(|runs| runs.iter().filter(|run| run.get("status").and_then(|s| s.as_str()) == Some("running")).count())
        .unwrap_or(0)
}

/// Polls the runs list: the shell has no SSE client, and a badge one poll late matters far less
/// than a taskbar icon that never stops blinking.
fn monitor_badge(app: AppHandle, shell: Arc<Shell>) {
    let mut shown: Option<usize> = None;
    loop {
        std::thread::sleep(Duration::from_secs(10));
        let port = shell.port.load(Ordering::SeqCst);
        if port == 0 {
            continue;
        }
        let count = running_run_count(port);
        if shown == Some(count) {
            continue;
        }
        shown = Some(count);
        if let Some(window) = app.get_webview_window("main") {
            set_badge(&window, count);
        }
    }
}

fn set_badge(window: &WebviewWindow, count: usize) {
    let count = (count <= 99).then_some(count as i64);
    // Windows has no badge count; its taskbar takes an overlay icon instead.
    #[cfg(target_os = "windows")]
    let _ = window.set_overlay_icon(count.map(|n| badge_image(n as usize)));
    #[cfg(not(target_os = "windows"))]
    let _ = window.set_badge_count(count);
}

#[cfg(any(target_os = "windows", test))]
fn badge_image(count: usize) -> Image<'static> {
    Image::new_owned(badge_pixels(count), 16, 16)
}

/// 16×16 RGBA: a red square with cut corners and the count in white. Windows scales the overlay
/// to the taskbar's DPI, so the digits are 2× a 3×5 glyph — legible at 100%, a dot above that.
#[cfg(any(target_os = "windows", test))]
fn badge_pixels(count: usize) -> Vec<u8> {
    const SIZE: usize = 16;
    const GLYPHS: [[u8; 5]; 10] = [
        [0b111, 0b101, 0b101, 0b101, 0b111],
        [0b010, 0b110, 0b010, 0b010, 0b111],
        [0b111, 0b001, 0b111, 0b100, 0b111],
        [0b111, 0b001, 0b111, 0b001, 0b111],
        [0b101, 0b101, 0b111, 0b001, 0b001],
        [0b111, 0b100, 0b111, 0b001, 0b111],
        [0b111, 0b100, 0b111, 0b101, 0b111],
        [0b111, 0b001, 0b001, 0b001, 0b001],
        [0b111, 0b101, 0b111, 0b101, 0b111],
        [0b111, 0b101, 0b111, 0b001, 0b111],
    ];
    let mut rgba = vec![0u8; SIZE * SIZE * 4];
    for y in 0..SIZE {
        for x in 0..SIZE {
            let cut_corner = (x < 3 || x >= SIZE - 3) && (y < 3 || y >= SIZE - 3);
            if !cut_corner {
                let i = (y * SIZE + x) * 4;
                rgba[i] = 220;
                rgba[i + 1] = 38;
                rgba[i + 2] = 38;
                rgba[i + 3] = 255;
            }
        }
    }
    let count = count.min(99);
    let digits: Vec<usize> = if count < 10 { vec![count] } else { vec![count / 10, count % 10] };
    let scale = 2;
    let glyph_w = 3 * scale;
    let gap = if digits.len() > 1 { scale } else { 0 };
    let total_w = digits.len() * glyph_w + (digits.len() - 1) * gap;
    let x0 = (SIZE - total_w) / 2;
    let y0 = (SIZE - 5 * scale) / 2;
    for (index, digit) in digits.iter().enumerate() {
        let gx = x0 + index * (glyph_w + gap);
        for (row, bits) in GLYPHS[*digit].iter().enumerate() {
            for col in 0..3 {
                if bits & (0b100 >> col) == 0 {
                    continue;
                }
                for sy in 0..scale {
                    for sx in 0..scale {
                        let px = gx + col * scale + sx;
                        let py = y0 + row * scale + sy;
                        if px < SIZE && py < SIZE {
                            let i = (py * SIZE + px) * 4;
                            rgba[i] = 255;
                            rgba[i + 1] = 255;
                            rgba[i + 2] = 255;
                            rgba[i + 3] = 255;
                        }
                    }
                }
            }
        }
    }
    rgba
}

fn wait_for_health(port: u16, child: &mut Child, timeout: Duration) -> Option<String> {
    let start = Instant::now();
    while start.elapsed() < timeout {
        if let Some(version) = health_version(port) {
            return Some(version);
        }
        if let Ok(Some(_)) = child.try_wait() {
            return None; // died while starting
        }
        std::thread::sleep(Duration::from_millis(300));
    }
    None
}

/// 4321 first (the port every README names), the next few when it is busy, then anything free.
fn pick_port() -> u16 {
    for port in PREFERRED_PORTS {
        if TcpListener::bind(("127.0.0.1", port)).is_ok() {
            return port;
        }
    }
    TcpListener::bind("127.0.0.1:0").and_then(|listener| listener.local_addr()).map(|addr| addr.port()).unwrap_or(4321)
}

// ---- window geometry -----------------------------------------------------------------------
//
// Position and size are remembered in LOGICAL points (`~/.onni/desktop-window.json`), never
// physical pixels: macOS's global coordinate space is in points, so a logical rectangle means
// the same thing on a Retina laptop panel and a 1x external display. (tauri-plugin-window-state
// saves physical pixels and restores the position before the size, so a window carried to a
// monitor with a different scale came back at the wrong size — the bug this replaces.)

fn geometry_path() -> PathBuf {
    onni_home().join("desktop-window.json")
}

fn save_geometry(window: &WebviewWindow) {
    if window.is_minimized().unwrap_or(false) || !window.is_visible().unwrap_or(true) {
        return;
    }
    let Ok(scale) = window.scale_factor() else { return };
    let Ok(position) = window.outer_position() else { return };
    let Ok(size) = window.inner_size() else { return };
    let maximized = window.is_maximized().unwrap_or(false);
    let mut json = std::fs::read_to_string(geometry_path())
        .ok()
        .and_then(|raw| serde_json::from_str::<serde_json::Value>(&raw).ok())
        .unwrap_or_else(|| serde_json::json!({}));
    if !maximized {
        let position = position.to_logical::<f64>(scale);
        let size = size.to_logical::<f64>(scale);
        json["x"] = serde_json::json!(position.x);
        json["y"] = serde_json::json!(position.y);
        json["width"] = serde_json::json!(size.width);
        json["height"] = serde_json::json!(size.height);
    }
    json["maximized"] = serde_json::json!(maximized);
    let path = geometry_path();
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let tmp = path.with_extension("json.tmp");
    if std::fs::write(&tmp, format!("{}\n", serde_json::to_string_pretty(&json).unwrap_or_default())).is_ok() {
        let _ = std::fs::rename(&tmp, &path);
    }
}

/// Apply the saved rectangle when it still lands on a connected display; otherwise keep the
/// builder's centred default. Size first, then position, both logical.
fn apply_saved_geometry(window: &WebviewWindow) -> Option<(f64, f64)> {
    let raw = std::fs::read_to_string(geometry_path()).ok()?;
    let json = serde_json::from_str::<serde_json::Value>(&raw).ok()?;
    let read = |key: &str| json.get(key).and_then(|value| value.as_f64());
    let (x, y, width, height) = (read("x")?, read("y")?, read("width")?, read("height")?);
    if !(width >= 720.0 && height >= 480.0) {
        return None;
    }
    let mut on_screen = false;
    if let Ok(monitors) = window.available_monitors() {
        for monitor in &monitors {
            let scale = monitor.scale_factor();
            let origin = monitor.position().to_logical::<f64>(scale);
            let extent = monitor.size().to_logical::<f64>(scale);
            // At least a title bar's worth of the window must be visible on this display.
            let hit = x + width > origin.x + 40.0
                && x < origin.x + extent.width - 40.0
                && y + 28.0 > origin.y
                && y < origin.y + extent.height - 40.0;
            if cfg!(debug_assertions) {
                eprintln!("[geometry] monitor at ({}, {}) {}x{} scale {scale} — saved ({x}, {y}) {width}x{height} hits: {hit}", origin.x, origin.y, extent.width, extent.height);
            }
            on_screen |= hit;
        }
    }
    let _ = window.set_size(tauri::LogicalSize::new(width, height));
    if on_screen {
        let _ = window.set_position(tauri::LogicalPosition::new(x, y));
    } else {
        let _ = window.center();
    }
    if json.get("maximized").and_then(|value| value.as_bool()).unwrap_or(false) {
        let _ = window.maximize();
    }
    on_screen.then_some((x, y))
}

// ---- locations -----------------------------------------------------------------------------

fn home_dir() -> PathBuf {
    std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE")).map(PathBuf::from).unwrap_or_else(|| PathBuf::from("."))
}

fn onni_home() -> PathBuf {
    std::env::var_os("ONNI_HOME").filter(|value| !value.is_empty()).map(PathBuf::from).unwrap_or_else(|| home_dir().join(".onni"))
}

/// `ONNI_DESKTOP_ENTRY` (a checkout's `packages/work/dist/index.js` while developing), else the
/// `current` entry `onni link --use` registered under `~/.onni/versions`.
fn resolve_entry() -> Option<PathBuf> {
    if let Some(explicit) = std::env::var_os("ONNI_DESKTOP_ENTRY").map(PathBuf::from) {
        if explicit.is_file() {
            return Some(explicit);
        }
    }
    managed_entry(&onni_home().join("versions"))
}

/// `serve` on `port`, booting into `project` through `--repo` (the sidecar's cwd is always home).
fn sidecar_args(entry: &Path, port: u16, project: Option<&Path>) -> Vec<String> {
    let mut args = vec![entry.to_string_lossy().into_owned(), "serve".into(), "--no-open".into(), "--port".into(), port.to_string()];
    if let Some(project) = project {
        args.push("--repo".into());
        args.push(project.to_string_lossy().into_owned());
    }
    args
}

/// The boot folder: `ONNI_DESKTOP_CWD`, else the most recently opened registered project, else
/// none — onni boots in the home directory, which it never registers as a project, and the
/// cockpit shows the registry.
fn pick_project() -> Option<PathBuf> {
    if let Some(explicit) = std::env::var_os("ONNI_DESKTOP_CWD").map(PathBuf::from) {
        if explicit.is_dir() {
            return Some(explicit);
        }
    }
    let config = onni_home().join("config.json");
    let raw = std::fs::read_to_string(config).ok()?;
    let json = serde_json::from_str::<serde_json::Value>(&raw).ok()?;
    let mut best: Option<(String, PathBuf)> = None;
    if let Some(projects) = json.get("projects").and_then(|value| value.as_array()) {
        for project in projects {
            let Some(root) = project.get("root").and_then(|value| value.as_str()) else { continue };
            let opened = project.get("lastOpenedAt").and_then(|value| value.as_str()).unwrap_or("").to_string();
            let path = PathBuf::from(root);
            if !path.is_dir() {
                continue;
            }
            if best.as_ref().map(|(when, _)| opened > *when).unwrap_or(true) {
                best = Some((opened, path));
            }
        }
    }
    best.map(|(_, path)| path)
}

/// Debug builds with `ONNI_DESKTOP_DEBUG_IPC=1`: after the cockpit loads, exercise the two
/// things window dragging needs from the cockpit's (remote) origin — a direct IPC call, and
/// Tauri's injected drag handler reacting to a double-click on the title band — and print
/// whether each actually maximized the window. A drag that silently does nothing is otherwise
/// undiagnosable, and the page cannot report back any other way (document.title is not the
/// native title).
fn probe_ipc(window: &WebviewWindow) {
    if !cfg!(debug_assertions) || std::env::var_os("ONNI_DESKTOP_DEBUG_IPC").is_none() {
        return;
    }
    let window = window.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_secs(3));
        let _ = window.unmaximize();
        std::thread::sleep(Duration::from_millis(500));
        let _ = window.eval("window.__TAURI_INTERNALS__ && window.__TAURI_INTERNALS__.invoke('plugin:window|internal_toggle_maximize')");
        std::thread::sleep(Duration::from_millis(1500));
        let direct = window.is_maximized().unwrap_or(false);
        let _ = window.unmaximize();
        std::thread::sleep(Duration::from_millis(500));
        let _ = window.eval(
            r#"(function(){
              var el = document.querySelector('[data-slot=desktop-titlebar]') || document.body;
              var o = { bubbles: true, cancelable: true, button: 0, detail: 2, clientX: 400, clientY: 10 };
              el.dispatchEvent(new MouseEvent('mousedown', o));
              el.dispatchEvent(new MouseEvent('mouseup', o));
            })()"#,
        );
        std::thread::sleep(Duration::from_millis(1500));
        let via_drag_script = window.is_maximized().unwrap_or(false);
        let _ = window.unmaximize();
        std::thread::sleep(Duration::from_millis(500));
        // Legacy strip present? Signal it the same way (a maximize) — the only channel we have.
        let _ = window.eval("document.querySelector('[data-onni-legacy-titlebar]') && window.__TAURI_INTERNALS__.invoke('plugin:window|internal_toggle_maximize')");
        std::thread::sleep(Duration::from_millis(1500));
        let legacy_strip = window.is_maximized().unwrap_or(false);
        let _ = window.unmaximize();
        let own_strip_probe = window.eval("document.querySelector('[data-slot=desktop-titlebar]') && window.__TAURI_INTERNALS__.invoke('plugin:window|internal_toggle_maximize')");
        std::thread::sleep(Duration::from_millis(1500));
        let own_strip = own_strip_probe.is_ok() && window.is_maximized().unwrap_or(false);
        let _ = window.unmaximize();
        std::thread::sleep(Duration::from_secs(6));
        let _ = window.eval("document.querySelector('[data-onni-update-pill]') && window.__TAURI_INTERNALS__.invoke('plugin:window|internal_toggle_maximize')");
        std::thread::sleep(Duration::from_millis(1500));
        let legacy_update = window.is_maximized().unwrap_or(false);
        let _ = window.unmaximize();
        eprintln!("[probe] direct invoke maximized: {direct}; drag-region double-click maximized: {via_drag_script}; legacy strip injected: {legacy_strip}; cockpit's own strip: {own_strip}; legacy update button: {legacy_update}");
    });
}

// ---- splash page ---------------------------------------------------------------------------

/// Back to the splash from the cockpit (a different origin), then set the message.
fn splash_reset(window: &WebviewWindow, title: &str, detail: &str) {
    if let Ok(url) = url::Url::parse(&format!("{}?title={}&detail={}", app_origin(), urlencode(title), urlencode(detail))) {
        let _ = window.navigate(url);
        // Navigation is asynchronous; give the page a beat before the first `eval` lands.
        std::thread::sleep(Duration::from_millis(400));
    }
}

/// A failure page: what went wrong, and its log.
fn fail(window: &WebviewWindow, title: &str, detail: &str, log: &str) {
    if let Ok(url) = url::Url::parse(&format!(
        "{}?error={}&title={}&log={}",
        app_origin(),
        urlencode(detail),
        urlencode(title),
        urlencode(log)
    )) {
        let _ = window.navigate(url);
    }
}

/// onni exits 0 only through its own graceful shutdown — a SIGINT or SIGTERM from outside the
/// shell. That is a stop someone asked for, not a crash: the page still offers a restart.
fn stopped_detail(code: i32) -> String {
    if code == 0 {
        "The cockpit process was stopped from outside the app (it shut down cleanly).".into()
    } else {
        format!("The cockpit process exited with status {code}.")
    }
}

fn app_origin() -> &'static str {
    if cfg!(windows) {
        "http://tauri.localhost/index.html"
    } else {
        "tauri://localhost/index.html"
    }
}

fn js_string(value: &str) -> String {
    serde_json::to_string(value).unwrap_or_else(|_| "\"\"".into())
}

fn urlencode(value: &str) -> String {
    url::form_urlencoded::byte_serialize(value.as_bytes()).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn url(raw: &str) -> url::Url {
        url::Url::parse(raw).unwrap()
    }

    /// The boot project rides `--repo`, never the cwd: a cwd the app may not read made onni
    /// exit 1 before answering.
    #[test]
    fn the_sidecar_boots_its_project_through_repo() {
        let entry = Path::new("/c/index.js");
        assert_eq!(sidecar_args(entry, 4321, None), ["/c/index.js", "serve", "--no-open", "--port", "4321"]);
        assert_eq!(
            sidecar_args(entry, 4321, Some(Path::new("/Users/o/Documents/my app"))),
            ["/c/index.js", "serve", "--no-open", "--port", "4321", "--repo", "/Users/o/Documents/my app"]
        );
    }

    #[test]
    fn a_clean_exit_reads_as_a_stop() {
        assert!(stopped_detail(0).contains("stopped from outside"));
        assert_eq!(stopped_detail(1), "The cockpit process exited with status 1.");
    }

    #[test]
    fn a_linked_worktree_reads_as_its_branch() {
        assert_eq!(version_label("0.13.0", "link", Some("cez/cb28888e")), "cez/cb28888e — 0.13.0 (worktree)");
        assert_eq!(version_label("0.13.0", "link", None), "0.13.0 (worktree)");
        assert_eq!(version_label("0.13.0", "local", None), "0.13.0 (local build)");
        assert_eq!(version_label("0.13.0", "registry", None), "0.13.0");
    }

    #[test]
    fn the_version_switcher_needs_something_to_switch_to() {
        assert!(!switcher_has_choices(0));
        assert!(!switcher_has_choices(1));
        assert!(switcher_has_choices(2));
    }

    #[test]
    fn the_bundle_may_use_the_microphone_it_advertises() {
        // Hardened runtime + no usage strings = every dictation `not-allowed`.
        let dir = env!("CARGO_MANIFEST_DIR");
        let read = |name: &str| std::fs::read_to_string(format!("{dir}/{name}")).unwrap();
        let conf: serde_json::Value = serde_json::from_str(&read("tauri.conf.json")).unwrap();
        let entitlements = conf["bundle"]["macOS"]["entitlements"].as_str().unwrap();
        assert!(read(entitlements).contains("com.apple.security.device.audio-input"));
        let info = read("Info.plist");
        assert!(info.contains("NSMicrophoneUsageDescription"));
        assert!(info.contains("NSSpeechRecognitionUsageDescription"));
        assert!(INIT_SCRIPT.contains("microphone: true"));
    }

    /// The legacy inset rule matches `div`s under the app shell, and the strip and the row this
    /// script adds ARE `div`s under the app shell. Inset too, the row pushed the version chip
    /// onto the brand row (shell 0.1.1).
    #[test]
    fn the_legacy_inset_spares_what_the_shell_adds() {
        let rule = INIT_SCRIPT.split("padding-top:28px!important").next().unwrap();
        let selector = rule.rsplit("style.textContent").next().unwrap();
        assert!(selector.contains(":not([data-onni-legacy-titlebar])"), "{selector}");
        assert!(selector.contains(":not([data-onni-titlebar-items])"), "{selector}");
    }

    #[test]
    fn own_origin_is_the_splash_and_the_cockpit_on_the_spawned_port() {
        assert!(is_own_origin(&url("tauri://localhost/index.html"), 0));
        assert!(is_own_origin(&url("http://tauri.localhost/"), 4321));
        assert!(is_own_origin(&url("http://127.0.0.1:4321/p/x/tasks"), 4321));
        assert!(is_own_origin(&url("http://localhost:4321/"), 4321));
    }

    /// The splash's script runs only inside the app, so nothing else would notice a syntax error
    /// that leaves every failure page without its message and Restart button.
    #[test]
    #[ignore = "needs node"]
    fn the_splash_script_parses() {
        let html = include_str!("../../ui/index.html");
        let script = html.split("<script>").nth(1).and_then(|rest| rest.split("</script>").next()).expect("an inline script");
        let file = std::env::temp_dir().join(format!("onni-splash-{}.js", std::process::id()));
        std::fs::write(&file, script).unwrap();
        let output = Command::new("node").arg("--check").arg(&file).output().expect("node on PATH");
        let _ = std::fs::remove_file(&file);
        assert!(output.status.success(), "{}", String::from_utf8_lossy(&output.stderr));
    }

    #[test]
    fn another_local_server_is_not_ours() {
        assert!(!is_own_origin(&url("http://localhost:3000/"), 4321));
        assert!(!is_own_origin(&url("http://127.0.0.1:4322/"), 4321));
        assert!(!is_own_origin(&url("http://localhost/"), 4321));
        assert!(!is_own_origin(&url("https://localhost:4321/"), 4321));
        assert!(!is_own_origin(&url("https://example.com/"), 4321));
        // No sidecar yet: nothing on loopback is trusted.
        assert!(!is_own_origin(&url("http://127.0.0.1:4321/"), 0));
    }

    /// The Preview's iframe goes through the navigation hook too; refusing it there left every
    /// framed dev server blank in the app while it worked in a browser.
    #[test]
    fn a_frame_may_load_any_web_page_but_not_other_schemes() {
        assert!(may_be_a_frame(&url("http://localhost:5177/#1")));
        assert!(may_be_a_frame(&url("https://example.com/")));
        assert!(may_be_a_frame(&url("about:blank")));
        assert!(!may_be_a_frame(&url("mailto:someone@example.com")));
        assert!(!may_be_a_frame(&url("file:///etc/passwd")));
    }

    #[test]
    fn count_running_counts_only_running_runs() {
        assert_eq!(count_running(r#"[{"status":"running"},{"status":"done"},{"status":"review"}]"#), 1);
        assert_eq!(count_running(r#"[{"status":"running"},{"status":"running"}]"#), 2);
        assert_eq!(count_running("[]"), 0);
        // A 403 body, an HTML error page, a body without `status`: no badge rather than a panic.
        assert_eq!(count_running("not json"), 0);
        assert_eq!(count_running("[{}]"), 0);
    }

    #[test]
    fn badge_pixels_draw_a_red_square_with_white_digits() {
        let pixels = badge_pixels(3);
        assert_eq!(pixels.len(), 16 * 16 * 4);
        let red = pixels.chunks(4).filter(|p| p[0] == 220 && p[1] == 38).count();
        let white = pixels.chunks(4).filter(|p| p[0] == 255 && p[1] == 255 && p[2] == 255).count();
        // Corners stay transparent so the icon reads as a badge on any taskbar colour.
        assert_eq!(&pixels[0..4], &[0, 0, 0, 0]);
        assert!(red > 100);
        assert!(white > 10);
        // Three digits do not fit: everything above 99 renders as 99.
        assert_eq!(badge_pixels(100), badge_pixels(99));
        assert_ne!(badge_pixels(7), badge_pixels(8));
    }

    // ---- the managed layout ------------------------------------------------------------------

    struct Scratch(PathBuf);
    impl Scratch {
        fn new(name: &str) -> Self {
            let dir = std::env::temp_dir().join(format!("onni-desktop-test-{name}-{}", std::process::id()));
            let _ = std::fs::remove_dir_all(&dir);
            std::fs::create_dir_all(&dir).unwrap();
            Scratch(dir)
        }
    }
    impl Drop for Scratch {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn version_ids_are_plain_versions() {
        for id in ["0.12.0", "0.12.0+local", "0.12.0-nightly.20260927.60"] {
            assert!(valid_version_id(id), "{id}");
        }
        for id in ["", "..", "a..b", ".hidden", "-weird", "/etc", "a/b", "a\\b", "has space", "0.1.0;rm"] {
            assert!(!valid_version_id(id), "{id}");
        }
    }

    #[test]
    fn a_current_link_points_at_an_installed_version() {
        let scratch = Scratch::new("current");
        let versions = scratch.0.join("versions");
        assert_eq!(managed_entry(&versions), None);
        fake_version(&versions, "0.12.0");
        assert_eq!(managed_entry(&versions), None, "no link yet");
        activate(&versions, "0.12.0").unwrap();
        assert_eq!(active_id(&versions).as_deref(), Some("0.12.0"));
        assert_eq!(std::fs::read_to_string(managed_entry(&versions).unwrap()).unwrap(), "// 0.12.0
");
        assert!(activate(&versions, "1.0.0").is_err(), "activated a version that is not installed");
        assert!(activate(&versions, "..").is_err());
    }

    /// What `onni link` leaves behind: a manifest, a built entry, and no `current` until the
    /// version is activated.
    fn fake_version(versions: &Path, id: &str) {
        let entry = entry_under(&versions.join(id));
        std::fs::create_dir_all(entry.parent().unwrap()).unwrap();
        std::fs::write(&entry, format!("// {id}
")).unwrap();
        std::fs::write(versions.join(id).join(".onni-install.json"), format!("{{\"version\":\"{id}\",\"source\":\"link\"}}
")).unwrap();
    }

    #[test]
    fn current_as_a_text_file_is_followed() {
        let scratch = Scratch::new("textfile");
        let versions = scratch.0.join("versions");
        fake_version(&versions, "0.12.0");
        let current = versions.join("current");
        std::fs::write(&current, "0.12.0
").unwrap();
        assert_eq!(active_id(&versions).as_deref(), Some("0.12.0"));
        assert_eq!(managed_entry(&versions), Some(entry_under(&versions.join("0.12.0"))));
        // And a link replaces the text file on the next switch.
        activate(&versions, "0.12.0").unwrap();
        assert!(entry_under(&current).is_file());
    }

    #[test]
    fn a_posix_command_keeps_every_argument_whole() {
        assert_eq!(
            posix_script(None, None, "node", &["/Users/o'neil/my app/index.js", "serve", "--port", "4321"]),
            r#"exec 'node' '/Users/o'\''neil/my app/index.js' 'serve' '--port' '4321'"#
        );
        assert_eq!(
            posix_script(None, Some("/Users/o'neil/.nvm/bin:/usr/bin"), "node", &["-v"]),
            r#"export PATH='/Users/o'\''neil/.nvm/bin:/usr/bin'; exec 'node' '-v'"#
        );
        assert_eq!(posix_script(Some("/h/.nvm/v22/bin"), Some("/usr/bin"), "npm", &["-v"]), r#"export PATH='/h/.nvm/v22/bin:/usr/bin'; exec 'npm' '-v'"#);
        assert_eq!(posix_script(Some("/h/.nvm/v22/bin"), None, "node", &[]), r#"export PATH='/h/.nvm/v22/bin':"$PATH"; exec 'node'"#);
    }

    #[cfg(unix)]
    fn fake_node(dir: &Path, prints: &str) {
        use std::os::unix::fs::PermissionsExt;
        std::fs::create_dir_all(dir).unwrap();
        let node = dir.join("node");
        std::fs::write(&node, format!("#!/bin/sh\necho {prints}\n")).unwrap();
        std::fs::set_permissions(&node, std::fs::Permissions::from_mode(0o755)).unwrap();
    }

    /// Lazy-loaded nvm and friends: `node` is on no PATH a shell reports, but it is installed.
    #[cfg(unix)]
    #[test]
    fn known_install_folders_are_listed_newest_manager_install_first() {
        let home = std::env::temp_dir().join(format!("onni-desktop-dirs-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&home);
        for dir in [
            ".nvm/versions/node/v18.20.0/bin",
            ".nvm/versions/node/v20.9.0/bin",
            ".nvm/versions/node/v22.11.0/bin",
            ".local/share/fnm/aliases/default/bin",
            ".local/share/mise/installs/node/22.1.0/bin",
            ".asdf/installs/nodejs/21.0.0/bin",
            "n/bin",
        ] {
            fake_node(&home.join(dir), "x");
        }
        std::fs::create_dir_all(home.join(".volta/bin")).unwrap(); // no node in it
        let home_str = home.to_string_lossy().into_owned();
        let dirs = candidate_node_dirs(&|name| (name == "HOME").then(|| home_str.clone()));
        let ours = dirs.into_iter().filter(|dir| dir.starts_with(&home)).collect::<Vec<_>>();
        assert_eq!(
            ours,
            [
                ".nvm/versions/node/v22.11.0/bin",
                ".nvm/versions/node/v20.9.0/bin",
                ".local/share/fnm/aliases/default/bin",
                ".local/share/mise/installs/node/22.1.0/bin",
                ".asdf/installs/nodejs/21.0.0/bin",
                "n/bin",
            ]
            .map(|dir| home.join(dir))
        );
        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn install_folder_names_read_as_versions() {
        assert_eq!(parse_node_version("v22.11.0"), Some((22, 11, 0)));
        assert_eq!(parse_node_version("20.9.1"), Some((20, 9, 1)));
        assert_eq!(parse_node_version("node@22"), Some((22, 0, 0)));
        for junk in ["lts", "22", "node", "v22.1", "v22.1.0.1", "node@", ".DS_Store"] {
            assert_eq!(parse_node_version(junk), None, "{junk}");
        }
    }

    /// An old Node first on PATH must not hide a newer one a version manager installed.
    #[cfg(unix)]
    #[test]
    fn the_first_install_folder_with_node_20_wins() {
        let root = std::env::temp_dir().join(format!("onni-desktop-find-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        fake_node(&root.join("old"), "18.19.0");
        fake_node(&root.join("broken"), "");
        fake_node(&root.join("good"), "22.11.0");
        fake_node(&root.join("later"), "24.0.0");
        let dirs = ["missing", "old", "broken", "good", "later"].map(|name| root.join(name));
        assert_eq!(find_node_in(&dirs), Some((root.join("good"), "22.11.0".to_string())));
        assert_eq!(find_node_in(&dirs[..3]), None);
        let _ = std::fs::remove_dir_all(&root);
    }

    /// npm and the sidecar run the Node `check_node` found, not an older one later on PATH.
    #[cfg(unix)]
    #[test]
    fn the_found_node_folder_goes_first_on_path() {
        let root = std::env::temp_dir().join(format!("onni-desktop-prefix-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        fake_node(&root.join("system"), "old");
        fake_node(&root.join("nvm"), "new");
        let base = format!("{}:/usr/bin:/bin", root.join("system").display());
        let script = posix_script(Some(&root.join("nvm").to_string_lossy()), Some(&base), "node", &[]);
        let output = Command::new("/bin/sh").args(["-c", &script]).output().unwrap();
        assert_eq!(String::from_utf8_lossy(&output.stdout).trim(), "new");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn a_fresh_registry_path_keeps_what_the_process_added() {
        assert_eq!(merge_paths(r"C:\nodejs;;C:\Windows", r"c:\windows;C:\Tools;", ';'), r"C:\nodejs;C:\Windows;C:\Tools");
    }

    #[test]
    fn the_interactive_path_ignores_whatever_rc_files_print() {
        let noisy = format!("Welcome!\n\n{PATH_MARKER}\n/a/.nvm/bin:/usr/bin\n{PATH_MARKER}\nbye\n");
        assert_eq!(parse_marked_path(&noisy).as_deref(), Some("/a/.nvm/bin:/usr/bin"));
        assert_eq!(parse_marked_path("no markers here"), None);
        assert_eq!(parse_marked_path(&format!("{PATH_MARKER}\n/usr/bin\n")), None, "truncated output");
        assert_eq!(parse_marked_path(&format!("{PATH_MARKER}\n\n{PATH_MARKER}\n")), None, "empty PATH");
    }

    /// The Intel report: nvm lives in ~/.zshrc, which a login-only shell never reads.
    #[cfg(not(windows))]
    #[test]
    fn the_interactive_path_sees_what_only_an_rc_file_adds() {
        let home = std::env::temp_dir().join(format!("onni-desktop-rc-{}", std::process::id()));
        std::fs::create_dir_all(&home).unwrap();
        std::fs::write(home.join(".zshrc"), "echo noise; export PATH=\"/from/zshrc:$PATH\"\n").unwrap();
        let script = format!("ZDOTDIR={} exec /bin/zsh \"$@\"", shell_quote(&home.to_string_lossy()));
        let shim = home.join("shell");
        std::fs::write(&shim, format!("#!/bin/sh\n{script}\n")).unwrap();
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&shim, std::fs::Permissions::from_mode(0o755)).unwrap();
        if Path::new("/bin/zsh").exists() {
            let path = resolve_interactive_path(&shim.to_string_lossy(), Duration::from_secs(10)).expect("a PATH");
            assert!(path.starts_with("/from/zshrc:"), "{path}");
        }
        let _ = std::fs::remove_dir_all(&home);
    }

    #[cfg(not(windows))]
    #[test]
    fn a_hung_rc_file_degrades_instead_of_blocking() {
        use std::os::unix::fs::PermissionsExt;
        let shim = std::env::temp_dir().join(format!("onni-desktop-hung-{}", std::process::id()));
        std::fs::write(&shim, "#!/bin/sh\nexec sleep 30\n").unwrap();
        std::fs::set_permissions(&shim, std::fs::Permissions::from_mode(0o755)).unwrap();
        let started = Instant::now();
        assert_eq!(resolve_interactive_path(&shim.to_string_lossy(), Duration::from_millis(200)), None);
        assert!(started.elapsed() < Duration::from_secs(5));
        let _ = std::fs::remove_file(&shim);
    }

    // ---- against the real tools (CI runs these with `--ignored`; they need Node on PATH) ------

    /// The reviewer's dead screen: on Windows the shell asked `cmd` to run a POSIX script and
    /// reported a missing Node with Node installed.
    #[test]
    #[ignore = "needs Node.js on PATH"]
    fn finds_the_node_on_path() {
        let version = check_node().expect("Node 20+ on PATH");
        assert!(version.split('.').next().unwrap().parse::<u32>().unwrap() >= 20, "{version}");
    }

    /// The sidecar's whole launch: node is started with the entry and the arguments onni
    /// expects, the project as `--repo` (not the cwd), the right environment, and its health
    /// answers on the port.
    #[test]
    #[ignore = "needs Node.js on PATH"]
    fn starts_a_sidecar_and_hears_its_health() {
        let scratch = Scratch::new("side car");
        // `.cjs`: a temp dir can sit under a package.json that says "type": "module".
        let entry = scratch.0.join("index.cjs");
        std::fs::write(
            &entry,
            r#"const args = process.argv.slice(2);
const port = Number(args[args.indexOf('--port') + 1]);
const ok = args[0] === 'serve' && args.includes('--no-open') && process.env.ONNI_DESKTOP === '1'
  && process.env.ONNI_SUPERVISED === '1' && Number(process.env.ONNI_SUPERVISOR_PID) > 0
  && require('node:fs').realpathSync(args[args.indexOf('--repo') + 1]) === __dirname && process.cwd() !== __dirname;
require('node:http').createServer((req, res) => {
  res.writeHead(ok ? 200 : 500, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ version: '9.9.9-test' }));
}).listen(port, '127.0.0.1');
"#,
        )
        .unwrap();
        let port = TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port();
        let log = Arc::new(Mutex::new(VecDeque::new()));
        let mut child = spawn_sidecar(&entry, port, Some(&scratch.0), log.clone()).expect("node starts");
        let version = wait_for_health(port, &mut child, Duration::from_secs(20));
        let _ = child.kill();
        let _ = child.wait();
        assert_eq!(version.as_deref(), Some("9.9.9-test"), "sidecar output: {:?}", log.lock().unwrap());
    }

}
