fn main() {
    // Listing a command here generates its `allow-…` permission for capabilities/default.json.
    tauri_build::try_build(
        tauri_build::Attributes::new().app_manifest(tauri_build::AppManifest::new().commands(&["restart_app", "show_versions_menu", "send_error_report"])),
    )
    .expect("failed to run tauri-build");
}
