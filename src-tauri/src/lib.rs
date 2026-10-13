mod project_files;
mod system_fonts;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            project_files::save_project_file,
            project_files::load_project_file,
            project_files::rename_project_file,
            project_files::write_export_file,
            system_fonts::list_system_fonts
        ])
        .run(tauri::generate_context!())
        .expect("error while running Drafiqo");
}
