#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::{fs, sync::Mutex};
use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::DialogExt;

macro_rules! to_err { ($e:expr) => { $e.map_err(|e| e.to_string()) }; }

fn is_deletable_upload(path: &str) -> bool {
    path.contains("uploads") && !path.starts_with("http")
}

// 💡 核心修复：绝对抛弃 current_exe，使用项目运行目录作为绝对安全的数据防空洞！
fn resolve_local_path(path: &str) -> Result<std::path::PathBuf, String> {
    let base = to_err!(std::env::current_dir())?;
    if path.contains("uploads") {
        let filename = std::path::Path::new(path).file_name().ok_or("无效文件名")?;
        Ok(base.join("uploads").join(filename))
    } else {
        Ok(std::path::PathBuf::from(path))
    }
}

#[tauri::command]
async fn get_base_dir() -> Result<String, String> {
    Ok(to_err!(std::env::current_dir())?.to_string_lossy().into_owned().replace("\\", "/"))
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Post {
    pub id: i64, pub title: String, pub tags: String, pub story: String,
    pub html: String, pub css: String, pub js: String, pub created_at: i64,
    pub is_trashed: Option<i32>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TrashedBlock {
    pub id: i64, pub post_id: i64, pub data: String, pub deleted_at: i64,
}

pub struct AppState { pub db: Mutex<Connection>, }

#[tauri::command]
async fn get_posts(state: State<'_, AppState>) -> Result<Vec<Post>, String> {
    let conn = to_err!(state.db.lock())?;
    let mut stmt = to_err!(conn.prepare("SELECT id, title, tags, story, html, css, js, created_at, is_trashed FROM posts WHERE is_trashed = 0 OR is_trashed IS NULL ORDER BY created_at DESC"))?;
    let posts = to_err!(stmt.query_map([], |row| Ok(Post {
        id: row.get(0)?, title: row.get(1)?, tags: row.get(2)?, story: row.get(3)?,
        html: row.get(4)?, css: row.get(5)?, js: row.get(6)?, created_at: row.get(7)?, is_trashed: row.get(8).unwrap_or(Some(0)),
    })))?.filter_map(|r| r.ok()).collect();
    Ok(posts)
}

#[tauri::command]
async fn get_trashed_posts(state: State<'_, AppState>) -> Result<Vec<Post>, String> {
    let conn = to_err!(state.db.lock())?;
    let mut stmt = to_err!(conn.prepare("SELECT id, title, tags, story, html, css, js, created_at FROM posts WHERE is_trashed = 1 ORDER BY created_at DESC"))?;
    let posts = to_err!(stmt.query_map([], |row| Ok(Post {
        id: row.get(0)?, title: row.get(1)?, tags: row.get(2)?, story: row.get(3)?,
        html: row.get(4)?, css: row.get(5)?, js: row.get(6)?, created_at: row.get(7)?, is_trashed: Some(1),
    })))?.filter_map(|r| r.ok()).collect();
    Ok(posts)
}

#[tauri::command]
async fn save_post(state: State<'_, AppState>, post: Post) -> Result<(), String> {
    let conn = to_err!(state.db.lock())?;
    let is_trashed = post.is_trashed.unwrap_or(0);
    to_err!(conn.execute(
        "INSERT OR REPLACE INTO posts (id, title, tags, story, html, css, js, created_at, is_trashed) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![post.id, post.title, post.tags, post.story, post.html, post.css, post.js, post.created_at, is_trashed],
    ))?;
    Ok(())
}

// 💡 帖子软删除：只改变状态，不动文件
#[tauri::command]
async fn delete_post(state: State<'_, AppState>, id: i64) -> Result<(), String> {
    to_err!(to_err!(state.db.lock())?.execute("UPDATE posts SET is_trashed = 1 WHERE id = ?1", params![id]))?;
    Ok(())
}

#[tauri::command]
async fn restore_post(state: State<'_, AppState>, id: i64) -> Result<(), String> {
    to_err!(to_err!(state.db.lock())?.execute("UPDATE posts SET is_trashed = 0 WHERE id = ?1", params![id]))?;
    Ok(())
}

// 帖子彻底删除：销毁媒体和记录
#[tauri::command]
async fn hard_delete_post(state: State<'_, AppState>, id: i64, attachments: Vec<String>) -> Result<(), String> {
    attachments.iter().filter(|p| is_deletable_upload(p)).for_each(|p| {
        if let Ok(resolved) = resolve_local_path(p) { let _ = fs::remove_file(resolved); }
    });
    to_err!(to_err!(state.db.lock())?.execute("DELETE FROM posts WHERE id = ?1", params![id]))?;
    Ok(())
}

// 💡 块级软删除
#[tauri::command]
async fn trash_block(state: State<'_, AppState>, post_id: i64, data: String) -> Result<(), String> {
    let deleted_at = chrono::Local::now().timestamp();
    to_err!(to_err!(state.db.lock())?.execute("INSERT INTO trashed_blocks (post_id, data, deleted_at) VALUES (?1, ?2, ?3)", params![post_id, data, deleted_at]))?;
    Ok(())
}

#[tauri::command]
async fn get_trashed_blocks(state: State<'_, AppState>) -> Result<Vec<TrashedBlock>, String> {
    let conn = to_err!(state.db.lock())?;
    let mut stmt = to_err!(conn.prepare("SELECT id, post_id, data, deleted_at FROM trashed_blocks ORDER BY deleted_at DESC"))?;
    let blocks = to_err!(stmt.query_map([], |row| Ok(TrashedBlock {
        id: row.get(0)?, post_id: row.get(1)?, data: row.get(2)?, deleted_at: row.get(3)?
    })))?.filter_map(|r| r.ok()).collect();
    Ok(blocks)
}

#[tauri::command]
async fn restore_block(state: State<'_, AppState>, id: i64) -> Result<String, String> {
    let conn = to_err!(state.db.lock())?;
    let data: String = to_err!(conn.query_row("SELECT data FROM trashed_blocks WHERE id = ?1", params![id], |row| row.get(0)))?;
    to_err!(conn.execute("DELETE FROM trashed_blocks WHERE id = ?1", params![id]))?;
    Ok(data)
}

#[tauri::command]
async fn hard_delete_block(state: State<'_, AppState>, id: i64, attachments: Vec<String>) -> Result<(), String> {
    attachments.iter().filter(|p| is_deletable_upload(p)).for_each(|p| {
        if let Ok(resolved) = resolve_local_path(p) { let _ = fs::remove_file(resolved); }
    });
    to_err!(to_err!(state.db.lock())?.execute("DELETE FROM trashed_blocks WHERE id = ?1", params![id]))?;
    Ok(())
}

#[tauri::command]
async fn empty_trash(state: State<'_, AppState>, attachments: Vec<String>) -> Result<(), String> {
    attachments.iter().filter(|p| is_deletable_upload(p)).for_each(|p| {
        if let Ok(resolved) = resolve_local_path(p) { let _ = fs::remove_file(resolved); }
    });
    let conn = to_err!(state.db.lock())?;
    to_err!(conn.execute("DELETE FROM posts WHERE is_trashed = 1", []))?;
    to_err!(conn.execute("DELETE FROM trashed_blocks", []))?;
    Ok(())
}

#[tauri::command]
async fn delete_media_file(path: String) -> Result<(), String> {
    if is_deletable_upload(&path) {
        if let Ok(resolved) = resolve_local_path(&path) { let _ = fs::remove_file(resolved); }
    }
    Ok(())
}

#[tauri::command]
async fn rename_media_file(old_path: String, new_name: String) -> Result<String, String> {
    let old = resolve_local_path(&old_path)?;
    if !old.exists() { return Err("文件不存在".into()); }
    let parent = old.parent().ok_or("无法获取目录")?;
    let ext = old.extension().map(|e| format!(".{}", e.to_string_lossy())).unwrap_or_default();
    let old_name = old.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
    let date_prefix = if old_name.len() > 15 && old_name.chars().nth(14) == Some('_') {
        let prefix = &old_name[..15];
        if prefix[..14].chars().all(|c| c.is_ascii_digit()) { prefix.to_string() } else { format!("{}_", chrono::Local::now().format("%Y%m%d%H%M%S")) }
    } else { format!("{}_", chrono::Local::now().format("%Y%m%d%H%M%S")) };
    let new_full_name = format!("{}{}{}", date_prefix, new_name, ext);
    let new_path = parent.join(&new_full_name);
    to_err!(fs::rename(&old, &new_path))?;
    Ok(format!("uploads/{}", new_full_name)) 
}

#[tauri::command]
async fn upload_media(app: AppHandle) -> Result<Vec<String>, String> {
    let Some(file_paths) = app.dialog().file().add_filter("Media", &["png", "jpg", "jpeg", "gif", "mp4", "webm", "webp", "txt", "mp3", "wav", "ogg", "flac", "md", "json"]).blocking_pick_files() else { return Ok(vec![]); };
    let uploads_dir = to_err!(std::env::current_dir())?.join("uploads");
    if !uploads_dir.exists() { to_err!(fs::create_dir_all(&uploads_dir))?; }
    file_paths.into_iter().map(|p| {
        let src = to_err!(p.into_path())?;
        let name = format!("{}_{}", chrono::Local::now().format("%Y%m%d%H%M%S"), src.file_name().ok_or("无效")?.to_string_lossy());
        let dest = uploads_dir.join(&name);
        to_err!(fs::copy(&src, &dest))?;
        Ok(format!("uploads/{}", name))
    }).collect()
}

#[tauri::command]
async fn save_clipboard_file(bytes: Vec<u8>, ext: String) -> Result<String, String> {
    use std::io::Write;
    let uploads_dir = to_err!(std::env::current_dir())?.join("uploads");
    if !uploads_dir.exists() { to_err!(std::fs::create_dir_all(&uploads_dir))?; }
    let filename = format!("paste_{}_{}.{}", chrono::Local::now().format("%Y%m%d%H%M%S"), std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().subsec_millis(), ext);
    let dest = uploads_dir.join(&filename);
    let mut file = to_err!(std::fs::File::create(&dest))?;
    to_err!(file.write_all(&bytes))?;
    Ok(format!("uploads/{}", filename))
}

#[tauri::command]
async fn pick_folder(app: AppHandle) -> Result<Vec<String>, String> {
    let Some(folder_path) = app.dialog().file().blocking_pick_folder() else { return Ok(vec![]); };
    let dir_path = to_err!(folder_path.into_path())?;
    let mut files = Vec::new();
    let media_exts = ["png", "jpg", "jpeg", "gif", "webp", "bmp", "mp4", "webm", "mov", "avi", "mp3", "wav", "ogg", "flac", "txt", "md", "json"];
    if let Ok(entries) = fs::read_dir(&dir_path) {
        for entry in entries.filter_map(|e| e.ok()) {
            let path = entry.path();
            if path.is_file() {
                if let Some(ext) = path.extension() {
                    let ext_lower = ext.to_string_lossy().to_lowercase();
                    if media_exts.iter().any(|e| *e == ext_lower) { files.push(path.to_string_lossy().into_owned()); }
                }
            }
        }
    }
    files.sort(); Ok(files)
}

fn init_db(_app: &AppHandle) -> Result<Connection, String> {
    let db_path = to_err!(std::env::current_dir())?.join("blog.db");
    let conn = to_err!(Connection::open(db_path))?;
    to_err!(conn.execute("CREATE TABLE IF NOT EXISTS posts (id INTEGER PRIMARY KEY, title TEXT NOT NULL, tags TEXT, story TEXT, html TEXT, css TEXT, js TEXT, created_at INTEGER NOT NULL, is_trashed INTEGER DEFAULT 0)", []))?;
    let _ = conn.execute("ALTER TABLE posts ADD COLUMN is_trashed INTEGER DEFAULT 0", []);
    to_err!(conn.execute("CREATE TABLE IF NOT EXISTS trashed_blocks (id INTEGER PRIMARY KEY AUTOINCREMENT, post_id INTEGER, data TEXT, deleted_at INTEGER)", []))?;
    Ok(conn)
}

#[tauri::command] async fn read_text_file(path: String) -> Result<String, String> { to_err!(fs::read_to_string(path)) }

#[derive(Serialize)]
struct FileMetadata { path: String, size: u64, modified: u64 }

#[tauri::command]
async fn get_files_metadata(paths: Vec<String>) -> Result<Vec<FileMetadata>, String> {
    let mut results = Vec::new();
    for path_str in paths {
        let path = std::path::Path::new(&path_str);
        if let Ok(m) = fs::metadata(path) {
            results.push(FileMetadata { path: path_str, size: m.len(), modified: m.modified().ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_secs()).unwrap_or(0) });
        }
    }
    Ok(results)
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .setup(|app| {
            let handle = app.handle();
            let conn = init_db(handle).expect("Failed to init db");
            app.manage(AppState { db: Mutex::new(conn) });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_posts, save_post, delete_post, delete_media_file, rename_media_file, upload_media, pick_folder, read_text_file, get_files_metadata,
            get_base_dir, save_clipboard_file, get_trashed_posts, restore_post, hard_delete_post, trash_block, get_trashed_blocks, restore_block, hard_delete_block, empty_trash
        ])
        .run(tauri::generate_context!())
        .expect("error");
}