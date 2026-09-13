#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            db_get_default_dir,
            db_prepare_and_copy
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/// 返回默认数据库所在目录（App 数据目录），前端展示路径与计算迁移源用
#[tauri::command]
fn db_get_default_dir(app: tauri::AppHandle) -> Result<String, String> {
    use tauri::Manager;
    app.path()
        .app_config_dir()
        .map(|p| p.to_string_lossy().into_owned())
        .map_err(|e| e.to_string())
}

/// 切换存储目录时迁移数据库文件：确保目标目录存在，把 src_file（若存在）
/// 复制为 dst_dir/weread.db。返回 true 表示迁移了既有数据。
#[tauri::command]
fn db_prepare_and_copy(src_file: String, dst_dir: String) -> Result<bool, String> {
    let src = std::path::Path::new(&src_file);
    let dst = std::path::Path::new(&dst_dir).join("weread.db");
    std::fs::create_dir_all(&dst_dir).map_err(|e| e.to_string())?;
    if !src.exists() {
        return Ok(false);
    }
    std::fs::copy(src, &dst).map_err(|e| e.to_string())?;
    Ok(true)
}
