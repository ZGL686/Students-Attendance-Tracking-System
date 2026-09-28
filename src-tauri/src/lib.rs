use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde::Serialize;
use std::{path::PathBuf, sync::Mutex};
use tauri::{Manager, State};

struct Store {
    conn: Mutex<Connection>,
    path: PathBuf,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Stored {
    revision: i64,
    payload: String,
    saved_at: String,
}

fn open_store(path: &std::path::Path) -> Result<Connection, String> {
    let conn = Connection::open(path).map_err(|e| e.to_string())?;
    conn.busy_timeout(std::time::Duration::from_secs(10))
        .map_err(|e| e.to_string())?;
    conn.execute_batch(
        "PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
        CREATE TABLE IF NOT EXISTS snapshots (
          revision INTEGER PRIMARY KEY, payload TEXT NOT NULL,
          saved_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
        );",
    )
    .map_err(|e| e.to_string())?;
    let integrity: String = conn
        .query_row("PRAGMA quick_check", [], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    if integrity != "ok" {
        return Err("数据库完整性检查失败，请保留数据文件并从备份恢复。".into());
    }
    Ok(conn)
}

fn read_latest(conn: &Connection) -> Result<Option<Stored>, String> {
    conn.query_row(
        "SELECT revision,payload,saved_at FROM snapshots ORDER BY revision DESC LIMIT 1",
        [],
        |r| {
            Ok(Stored {
                revision: r.get(0)?,
                payload: r.get(1)?,
                saved_at: r.get(2)?,
            })
        },
    )
    .optional()
    .map_err(|e| e.to_string())
}

fn commit(conn: &mut Connection, expected: i64, payload: &str) -> Result<i64, String> {
    let parsed: serde_json::Value =
        serde_json::from_str(payload).map_err(|_| "数据格式错误，保存已取消。".to_string())?;
    if !matches!(
        parsed.get("schemaVersion").and_then(|v| v.as_u64()),
        Some(1 | 2 | 3)
    ) || !parsed.get("workspaces").is_some_and(|v| v.is_array())
    {
        return Err("不支持的数据版本，未更改原数据。".into());
    }
    let tx = conn
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|e| e.to_string())?;
    let current: i64 = tx
        .query_row("SELECT COALESCE(MAX(revision),0) FROM snapshots", [], |r| {
            r.get(0)
        })
        .map_err(|e| e.to_string())?;
    if current != expected {
        return Err("数据已在其他窗口更新，请重新打开应用后再操作。".into());
    }
    let revision = current + 1;
    tx.execute(
        "INSERT INTO snapshots(revision,payload) VALUES (?1,?2)",
        params![revision, payload],
    )
    .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(revision)
}

#[tauri::command]
fn load_data(store: State<Store>) -> Result<Option<Stored>, String> {
    let conn = store.conn.lock().map_err(|e| e.to_string())?;
    read_latest(&conn)
}
#[tauri::command]
fn save_data(store: State<Store>, expected_revision: i64, payload: String) -> Result<i64, String> {
    let mut conn = store.conn.lock().map_err(|e| e.to_string())?;
    commit(&mut conn, expected_revision, &payload)
}
#[tauri::command]
fn data_location(store: State<Store>) -> String {
    store.path.to_string_lossy().to_string()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SnapshotInfo {
    revision: i64,
    saved_at: String,
}
#[tauri::command]
fn list_snapshots(store: State<Store>) -> Result<Vec<SnapshotInfo>, String> {
    let conn = store.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT revision,saved_at FROM snapshots ORDER BY revision DESC LIMIT 30")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            Ok(SnapshotInfo {
                revision: r.get(0)?,
                saved_at: r.get(1)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}
#[tauri::command]
fn read_snapshot(store: State<Store>, revision: i64) -> Result<String, String> {
    store
        .conn
        .lock()
        .map_err(|e| e.to_string())?
        .query_row(
            "SELECT payload FROM snapshots WHERE revision=?1",
            [revision],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, _, _| {
        if let Some(w) = app.get_webview_window("main") {
            let _ = w.unminimize();
            let _ = w.set_focus();
        }
    }));
    builder
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            let dir = match std::env::var_os("GUILU_DATA_DIR") {
                Some(value) => {
                    let p = PathBuf::from(value);
                    if !p.is_absolute() {
                        return Err("GUILU_DATA_DIR 必须为绝对路径".into());
                    }
                    p
                }
                None => app.path().app_data_dir()?,
            };
            std::fs::create_dir_all(&dir)?;
            let path = dir.join("attendance.sqlite3");
            let conn = open_store(&path).map_err(std::io::Error::other)?;
            app.manage(Store {
                conn: Mutex::new(conn),
                path,
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            load_data,
            save_data,
            data_location,
            list_snapshots,
            read_snapshot
        ])
        .run(tauri::generate_context!())
        .expect("Ludian启动失败：请保留数据文件，检查文件权限或数据库完整性。");
}

#[cfg(test)]
mod tests {
    use super::*;
    const DATA: &str = r#"{"schemaVersion":1,"workspaces":[]}"#;
    #[test]
    fn persistence_cas_and_snapshot_retention() {
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("data.db");
        {
            let mut c = open_store(&p).unwrap();
            assert!(read_latest(&c).unwrap().is_none());
            assert_eq!(commit(&mut c, 0, DATA).unwrap(), 1);
            assert!(commit(&mut c, 0, DATA).is_err());
            assert!(commit(&mut c, 1, "invalid").is_err());
            assert_eq!(read_latest(&c).unwrap().unwrap().revision, 1);
            assert_eq!(commit(&mut c, 1, DATA).unwrap(), 2);
        }
        let c = open_store(&p).unwrap();
        assert_eq!(read_latest(&c).unwrap().unwrap().revision, 2);
        assert_eq!(
            c.query_row("SELECT COUNT(*) FROM snapshots", [], |r| r.get::<_, i64>(0))
                .unwrap(),
            2
        );
    }
    #[test]
    fn corrupt_database_is_not_replaced() {
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("data.db");
        std::fs::write(&p, b"damaged database").unwrap();
        assert!(open_store(&p).is_err());
        assert_eq!(std::fs::read(&p).unwrap(), b"damaged database");
    }
    #[test]
    fn upgrades_keep_original_snapshots_and_reject_future_versions() {
        let d = tempfile::tempdir().unwrap();
        let mut c = open_store(&d.path().join("data.db")).unwrap();
        commit(&mut c, 0, DATA).unwrap();
        let v2 = r#"{"schemaVersion":2,"workspaces":[{"databases":{"students":{"views":["saved view"]}}}]}"#;
        assert_eq!(commit(&mut c, 1, v2).unwrap(), 2);
        assert_eq!(read_latest(&c).unwrap().unwrap().payload, v2);
        assert_eq!(
            c.query_row("SELECT payload FROM snapshots WHERE revision=1", [], |r| {
                r.get::<_, String>(0)
            })
            .unwrap(),
            DATA
        );
        let v3 = r#"{"schemaVersion":3,"workspaces":[{"deletedAt":"2026-09-24T00:00:00Z"}]}"#;
        assert_eq!(commit(&mut c, 2, v3).unwrap(), 3);
        assert_eq!(read_latest(&c).unwrap().unwrap().payload, v3);
        assert_eq!(
            c.query_row("SELECT payload FROM snapshots WHERE revision=2", [], |r| {
                r.get::<_, String>(0)
            })
            .unwrap(),
            v2
        );
        assert!(commit(&mut c, 3, r#"{"schemaVersion":4,"workspaces":[]}"#).is_err());
        assert_eq!(read_latest(&c).unwrap().unwrap().revision, 3);
    }
}
