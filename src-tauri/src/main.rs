// Prevents an extra console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
// The binary is named "Drafiqo" so the Dock shows the product name.
#![allow(non_snake_case)]

fn main() {
    drafiqo_lib::run()
}
