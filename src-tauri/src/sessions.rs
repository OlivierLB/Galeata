use crate::{store::Result,workspace::{run,Workspace}};
use serde_json::{json,Value};
use std::{fs,io::{Read,Seek,SeekFrom},path::{Path,PathBuf},time::Duration};

fn home()->PathBuf{std::env::var_os("HOME").map(PathBuf::from).unwrap_or_default()}
pub fn providers()->Value{
    let providers=["codex","claude"].iter().map(|provider|{
        let version=run(&home(),provider,&["--version"],&[0],Duration::from_secs(5),8192);
        json!({"id":provider,"available":version.is_ok(),"version":version.unwrap_or_default().lines().filter(|l|!l.starts_with("WARNING")).collect::<Vec<_>>().join(" "),"capabilities":["terminal","resume","mcp","session_discovery"],"subagents":"historical_metadata_only"})
    }).collect::<Vec<_>>();json!(providers)
}
fn collect(path:&Path,depth:usize,out:&mut Vec<PathBuf>){
    if depth==0||out.len()>=5000{return}
    if let Ok(entries)=fs::read_dir(path){for entry in entries.flatten(){let p=entry.path();let Ok(t)=entry.file_type()else{continue};if t.is_dir(){collect(&p,depth-1,out)}else if t.is_file()&&p.extension().is_some_and(|s|s=="jsonl"){out.push(p)}if out.len()>=5000{break}}}
}
pub fn discover(w:&Workspace)->Result<Value>{
    let mut files=vec![];
    let codex=std::env::var_os("CODEX_HOME").map(PathBuf::from).unwrap_or_else(||home().join(".codex"));
    collect(&codex.join("sessions"),5,&mut files);
    let claude=std::env::var_os("CLAUDE_CONFIG_DIR").map(PathBuf::from).unwrap_or_else(||home().join(".claude"));
    collect(&claude.join("projects"),4,&mut files);
    files.sort_by_key(|p|std::cmp::Reverse(p.metadata().and_then(|m|m.modified()).ok()));
    let mut sessions=vec![];
    for path in files.iter().take(3000){if let Some(session)=parse(path,w){sessions.push(session)}if sessions.len()>=100{break}}
    Ok(json!(sessions))
}
fn parse(path:&Path,w:&Workspace)->Option<Value>{
    let mut f=fs::File::open(path).ok()?;let metadata=f.metadata().ok()?;
    let mut head=Vec::new();Read::by_ref(&mut f).take(64*1024).read_to_end(&mut head).ok()?;
    let mut tail=vec![];if metadata.len()>64*1024{f.seek(SeekFrom::End(-65536)).ok()?;f.read_to_end(&mut tail).ok()?;}
    let text=String::from_utf8_lossy(&head);let end=String::from_utf8_lossy(&tail);
    let mut cwd=None;let mut id=None;let mut provider="claude";let mut title=String::new();let mut summary=String::new();let mut parent=None;
    for line in text.lines().chain(end.lines()){
        let Ok(v)=serde_json::from_str::<Value>(line)else{continue};
        if v["type"]=="session_meta"{provider="codex";let p=&v["payload"];cwd=p["cwd"].as_str().map(str::to_owned);id=p["id"].as_str().map(str::to_owned);parent=p["source"]["subagent"]["thread_spawn"]["parent_thread_id"].as_str().map(str::to_owned);}
        if provider=="claude"{if cwd.is_none(){cwd=v["cwd"].as_str().map(str::to_owned)}if id.is_none(){id=v["sessionId"].as_str().map(str::to_owned)}}
        if v["type"]=="summary"{if let Some(s)=v["summary"].as_str(){summary=s.chars().take(2000).collect()}}
        if title.is_empty(){let msg=if provider=="codex"&&v["payload"]["type"]=="user_message"{v["payload"]["message"].as_str()}else if provider=="claude"&&v["type"]=="user"{v["message"]["content"].as_str()}else{None};if let Some(s)=msg{title=s.lines().find(|l|!l.trim().is_empty()).unwrap_or("").chars().take(120).collect()}}
    }
    if Path::new(&cwd?).canonicalize().ok()?!=w.root{return None}
    let id=id?;if uuid::Uuid::parse_str(&id).is_err(){return None}
    if title.is_empty(){title=format!("Session {}",&id[..8])}
    let modified=metadata.modified().ok()?.duration_since(std::time::UNIX_EPOCH).ok()?.as_millis() as u64;
    Some(json!({"id":id,"provider":provider,"title":title,"summary":summary,"path":path.to_string_lossy(),"modifiedAt":modified,"parentId":parent}))
}
