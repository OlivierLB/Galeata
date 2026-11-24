use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Value};
use std::path::Path;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use uuid::Uuid;

pub type Result<T> = std::result::Result<T, String>;
pub fn now() -> u64 { SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis() as u64 }

pub struct Store(pub Mutex<Connection>);
impl Store {
    pub fn open(path: &Path) -> Result<Self> {
        let connection = Connection::open(path).map_err(|e| e.to_string())?;
        connection.execute_batch("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
          CREATE TABLE IF NOT EXISTS plans (workspace TEXT PRIMARY KEY, revision INTEGER NOT NULL, body TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, workspace TEXT NOT NULL, kind TEXT NOT NULL, author TEXT NOT NULL, message TEXT NOT NULL, created_at INTEGER NOT NULL, data TEXT NOT NULL);
          CREATE INDEX IF NOT EXISTS events_workspace ON events(workspace, created_at DESC);
          CREATE TABLE IF NOT EXISTS preferences (workspace TEXT NOT NULL, key TEXT NOT NULL, body TEXT NOT NULL, PRIMARY KEY(workspace,key));").map_err(|e| e.to_string())?;
        Ok(Self(Mutex::new(connection)))
    }
    pub fn plan(&self, workspace: &str) -> Result<Value> {
        let db = self.0.lock().map_err(|e| e.to_string())?;
        let body: Option<String> = db.query_row("SELECT body FROM plans WHERE workspace=?1", [workspace], |r| r.get(0)).optional().map_err(|e| e.to_string())?;
        body.map(|v| serde_json::from_str(&v).map_err(|e| e.to_string())).unwrap_or_else(|| Ok(json!({"revision":0,"objective":"","steps":[]})))
    }
    pub fn update_plan(&self, workspace: &str, expected: u64, mut body: Value, author: &str, message: &str) -> Result<Value> {
        validate_plan(&body)?;
        let mut db = self.0.lock().map_err(|e| e.to_string())?;
        let tx = db.transaction().map_err(|e| e.to_string())?;
        let current: u64 = tx.query_row("SELECT revision FROM plans WHERE workspace=?1", [workspace], |r| r.get(0)).optional().map_err(|e| e.to_string())?.unwrap_or(0);
        if expected != current { return Err(format!("REVISION_CONFLICT: le plan a changé (révision {current}). Rechargez-le avant de réessayer.")); }
        body["revision"] = json!(current + 1);
        tx.execute("INSERT INTO plans VALUES (?1,?2,?3) ON CONFLICT(workspace) DO UPDATE SET revision=excluded.revision, body=excluded.body", params![workspace, current + 1, body.to_string()]).map_err(|e| e.to_string())?;
        tx.execute("INSERT INTO events VALUES (?1,?2,'plan',?3,?4,?5,?6)",params![Uuid::new_v4().to_string(),workspace,author,message,now(),body.to_string()]).map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())?;
        Ok(body)
    }
    pub fn record(&self, workspace: &str, kind: &str, author: &str, message: &str, data: Value) -> Result<Value> {
        if message.len() > 16_384 || data.to_string().len() > 131_072 { return Err("Événement trop volumineux".into()); }
        let event = json!({"id":Uuid::new_v4().to_string(),"kind":kind,"author":author,"message":message,"createdAt":now(),"data":data});
        self.0.lock().map_err(|e|e.to_string())?.execute("INSERT INTO events VALUES (?1,?2,?3,?4,?5,?6,?7)",params![event["id"].as_str(),workspace,kind,author,message,event["createdAt"].as_u64(),event["data"].to_string()]).map_err(|e|e.to_string())?;
        Ok(event)
    }
    pub fn events(&self, workspace: &str) -> Result<Value> {
        let db = self.0.lock().map_err(|e| e.to_string())?;
        let mut query = db.prepare("SELECT id,kind,author,message,created_at,data FROM events WHERE workspace=?1 ORDER BY created_at DESC, rowid DESC LIMIT 100").map_err(|e| e.to_string())?;
        let rows = query.query_map([workspace], |r| Ok(json!({"id":r.get::<_,String>(0)?,"kind":r.get::<_,String>(1)?,"author":r.get::<_,String>(2)?,"message":r.get::<_,String>(3)?,"createdAt":r.get::<_,u64>(4)?,"data":serde_json::from_str::<Value>(&r.get::<_,String>(5)?).unwrap_or(Value::Null)}))).map_err(|e| e.to_string())?;
        Ok(Value::Array(rows.collect::<std::result::Result<Vec<_>,_>>().map_err(|e|e.to_string())?))
    }
    pub fn preference(&self, workspace: &str, key: &str) -> Result<Value> {
        let db = self.0.lock().map_err(|e|e.to_string())?;
        let body: Option<String> = db.query_row("SELECT body FROM preferences WHERE workspace=?1 AND key=?2",params![workspace,key],|r|r.get(0)).optional().map_err(|e|e.to_string())?;
        Ok(body.and_then(|s|serde_json::from_str(&s).ok()).unwrap_or(Value::Null))
    }
    pub fn set_preference(&self, workspace: &str, key: &str, value: &Value) -> Result<()> {
        self.0.lock().map_err(|e|e.to_string())?.execute("INSERT INTO preferences VALUES (?1,?2,?3) ON CONFLICT(workspace,key) DO UPDATE SET body=excluded.body",params![workspace,key,value.to_string()]).map_err(|e|e.to_string())?;
        Ok(())
    }
}

fn validate_plan(body: &Value) -> Result<()> {
    let objective = body["objective"].as_str().ok_or("Objectif attendu")?;
    let steps = body["steps"].as_array().ok_or("Étapes attendues")?;
    if objective.len() > 16_384 || steps.len() > 500 { return Err("Plan trop volumineux".into()); }
    let mut ids = std::collections::HashSet::new();
    for step in steps {
        let id = step["id"].as_str().filter(|s| !s.is_empty()).ok_or("Identifiant d’étape attendu")?;
        if !ids.insert(id) { return Err("Identifiant d’étape dupliqué".into()); }
        if step["title"].as_str().filter(|s| !s.trim().is_empty() && s.len() <= 1000).is_none() { return Err("Titre d’étape invalide".into()); }
        if !matches!(step["status"].as_str(),Some("pending"|"in_progress"|"blocked"|"done")) { return Err("État d’étape invalide".into()); }
        if step["note"].as_str().filter(|s|s.len()<=16_384).is_none()||step["author"].as_str().filter(|s|s.len()<=200).is_none()||step["updatedAt"].as_u64().is_none(){return Err("Métadonnées d’étape invalides".into())}
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn revision_and_event_are_atomic_and_survive_reopening() {
        let temp = tempfile::tempdir().unwrap(); let path=temp.path().join("test.sqlite");
        let store=Store::open(&path).unwrap(); let body=json!({"objective":"Mission","steps":[]});
        assert_eq!(store.update_plan("w",0,body.clone(),"user","creation").unwrap()["revision"],1);
        assert!(store.update_plan("w",0,body,"agent","stale").unwrap_err().starts_with("REVISION_CONFLICT"));
        assert_eq!(store.events("w").unwrap().as_array().unwrap().len(),1);
        drop(store); assert_eq!(Store::open(&path).unwrap().plan("w").unwrap()["objective"],"Mission");
    }
    #[test] fn rejects_duplicate_steps() {
        let s=json!({"id":"a","title":"A","status":"pending","note":"","author":"test","updatedAt":0});
        assert!(validate_plan(&json!({"objective":"","steps":[s.clone(),s]})).is_err());
    }
}
