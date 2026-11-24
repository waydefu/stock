// No plugins, external URL, invoke handlers, account access or trade APIs.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("Crypto Lab failed to start");
}
