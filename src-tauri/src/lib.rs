mod atlas;
mod bundle;
mod commands;
mod doom;
mod error;
mod gif_codec;
mod png_codec;
mod sink;

pub use error::Error;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // dialog + fs are registered on every platform: both ship Android
    // implementations (SAF-backed save/open, content:// reads and writes).
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            commands::ping,
            commands::selftest_flag,
            commands::selftest_done,
            commands::echo_bytes,
            commands::encode_png,
            commands::export_bundle,
            commands::probe_dir
        ]);

    // Reveal-in-folder is a desktop concept; the plugin has no mobile build.
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_opener::init());

    builder
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
