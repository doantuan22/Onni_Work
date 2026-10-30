// Prevents an extra console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    onni_desktop_lib::disclaim_exec_if_asked();
    onni_desktop_lib::run()
}
