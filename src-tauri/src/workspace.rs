use crate::store::Result;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{fs, path::{Path, PathBuf}, process::{Command, Stdio}, io::Read, time::Duration};

#[derive(Clone, Serialize, Deserialize)]
pub struct Workspace { pub id: String, pub root: PathBuf, pub name: String }
impl Workspace {
    pub fn open(path: &str) -> Result<Self> {
        let root = fs::canonicalize(path).map_err(|e| e.to_string())?;
        if !root.is_dir() { return Err("Sélectionnez un dossier".into()); }
        let id = format!("{:x}",Sha256::digest(root.to_string_lossy().as_bytes()));
        let name = root.file_name().unwrap_or_default().to_string_lossy().into_owned();
        Ok(Self{id,root,name})
    }
    pub fn resolve(&self, relative: &str, create: bool) -> Result<PathBuf> {
        Self::validate_relative(relative)?;
        let path = Path::new(relative);
        let joined=self.root.join(path);
        let canonical = if create && !joined.exists() {
            let parent=joined.parent().ok_or("Parent invalide")?.canonicalize().map_err(|e|e.to_string())?;
            parent.join(joined.file_name().ok_or("Nom invalide")?)
        } else { joined.canonicalize().map_err(|e|e.to_string())? };
        if !canonical.starts_with(&self.root) { return Err("Lien symbolique hors du projet".into()); }
        Ok(canonical)
    }
    pub fn validate_relative(relative:&str)->Result<()>{
        let path=Path::new(relative);
        if relative.contains('\0')||path.is_absolute()||path.components().any(|p|matches!(p,std::path::Component::ParentDir|std::path::Component::Prefix(_))){return Err("Chemin hors du projet".into())}
        if path.components().any(|p|p.as_os_str()==".git"){return Err("L’accès direct aux métadonnées Git est interdit".into())}Ok(())
    }
    pub fn list(&self, path: &str, offset: usize) -> Result<Value> {
        let directory=self.resolve(path,false)?;
        let mut entries=Vec::new();
        for entry in fs::read_dir(directory).map_err(|e|e.to_string())? {
            let entry=entry.map_err(|e|e.to_string())?; let name=entry.file_name().to_string_lossy().into_owned();
            if name==".git" { continue; }
            let kind=entry.file_type().map_err(|e|e.to_string())?;
            let directory=if kind.is_symlink(){entry.path().canonicalize().map(|p|p.starts_with(&self.root)&&p.is_dir()).unwrap_or(false)}else{kind.is_dir()};
            let relative=entry.path().strip_prefix(&self.root).map_err(|e|e.to_string())?.to_string_lossy().into_owned();
            entries.push(json!({"name":name,"path":relative,"directory":directory,"symlink":kind.is_symlink()}));
        }
        entries.sort_by(|a,b| b["directory"].as_bool().cmp(&a["directory"].as_bool()).then_with(||a["name"].as_str().cmp(&b["name"].as_str())));
        let total=entries.len(); let items=entries.into_iter().skip(offset).take(500).collect::<Vec<_>>();
        Ok(json!({"items":items,"total":total,"nextOffset":if offset+500<total {Some(offset+500)}else{None}}))
    }
    pub fn read(&self,path:&str)->Result<Value>{
        let path=self.resolve(path,false)?;let meta=fs::metadata(&path).map_err(|e|e.to_string())?;
        if !meta.is_file()||meta.len()>2*1024*1024{return Err("Fichier binaire ou supérieur à 2 Mio : ouvrez-le avec un outil adapté".into())}
        let bytes=fs::read(&path).map_err(|e|e.to_string())?;
        if bytes.contains(&0){return Err("Fichier binaire".into())}
        let stamp=format!("{:x}",Sha256::digest(&bytes));
        let content=String::from_utf8(bytes).map_err(|_|"Encodage non UTF-8".to_string())?;
        Ok(json!({"content":content,"stamp":stamp}))
    }
    pub fn entry_path(&self,relative:&str)->Result<PathBuf>{
        self.resolve(relative,false)?;
        let joined=self.root.join(relative);
        if joined==self.root{return Err("Action interdite sur la racine".into())}
        let parent=joined.parent().ok_or("Parent invalide")?.canonicalize().map_err(|e|e.to_string())?;
        Ok(parent.join(joined.file_name().ok_or("Nom invalide")?))
    }
    pub fn write(&self,path:&str,content:&str,stamp:&str)->Result<Value>{
        if content.len()>2*1024*1024 {return Err("Fichier supérieur à 2 Mio".into())}
        let target=self.resolve(path,false)?;
        if self.read(path)?["stamp"].as_str()!=Some(stamp){return Err("FILE_CONFLICT: le fichier a changé sur disque. Rechargez-le ou comparez avant de sauvegarder.".into())}
        // Write beside the destination, preserve permissions, then replace atomically.
        let temp=target.with_file_name(format!(".galeata-{}.tmp",uuid::Uuid::new_v4()));
        let result=(||->Result<()>{use std::io::Write;let mut f=fs::OpenOptions::new().write(true).create_new(true).open(&temp).map_err(|e|e.to_string())?;f.write_all(content.as_bytes()).map_err(|e|e.to_string())?;f.set_permissions(fs::metadata(&target).map_err(|e|e.to_string())?.permissions()).map_err(|e|e.to_string())?;f.sync_all().map_err(|e|e.to_string())?;fs::rename(&temp,&target).map_err(|e|e.to_string())?;Ok(())})();
        if result.is_err(){let _=fs::remove_file(temp);} result?; self.read(path)
    }
    pub fn search(&self, query:&str, files:bool, offset:usize)->Result<Value>{
        if query.is_empty() || query.len()>500 || offset>10_000{return Err("Recherche invalide".into())}
        let args=if files{vec!["--files","--hidden","-g","!.git","-g","!node_modules","-g","!target"]}else{vec!["--json","--line-number","--fixed-strings","--hidden","--max-columns","500","-g","!.git","-g","!node_modules","-g","!target","--",query,"."]};
        let output=run(&self.root,"rg",&args,&[0,1],Duration::from_secs(15),16*1024*1024)?;
        let mut items=Vec::new();
        if files {for line in output.lines().filter(|p|p.to_lowercase().contains(&query.to_lowercase())).skip(offset).take(201){items.push(json!({"path":line,"line":0,"text":""}));}}
        else {for line in output.lines(){if let Ok(v)=serde_json::from_str::<Value>(line){if v["type"]=="match"{items.push(json!({"path":v["data"]["path"]["text"].as_str().unwrap_or("").trim_start_matches("./"),"line":v["data"]["line_number"],"text":v["data"]["lines"]["text"].as_str().unwrap_or("").trim_end()}));}}} items=items.into_iter().skip(offset).take(201).collect();}
        let more=items.len()>200;items.truncate(200);Ok(json!({"items":items,"nextOffset":if more{Some(offset+200)}else{None}}))
    }
}

/// Bounded, timed subprocess capture. Arguments never pass through a shell.
pub fn run(root:&Path,program:&str,args:&[&str],codes:&[i32],timeout:Duration,limit:usize)->Result<String>{
    run_outcome(root,program,args,codes,timeout,limit).map(|(output,_)|output)
}
pub fn run_outcome(root:&Path,program:&str,args:&[&str],codes:&[i32],timeout:Duration,limit:usize)->Result<(String,i32)>{
    let mut child=Command::new(program).args(args).current_dir(root).env("GIT_TERMINAL_PROMPT","0").stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn().map_err(|e|format!("{program}: {e}"))?;
    let stdout=child.stdout.take().ok_or("stdout indisponible")?;let stderr=child.stderr.take().ok_or("stderr indisponible")?;
    let out=std::thread::spawn(move||{let mut v=Vec::new();stdout.take(limit as u64+1).read_to_end(&mut v).map(|_|v)});
    let err=std::thread::spawn(move||{let mut v=Vec::new();stderr.take(65537).read_to_end(&mut v).map(|_|v)});
    let started=std::time::Instant::now();
    let status=loop{if let Some(s)=child.try_wait().map_err(|e|e.to_string())?{break s}if started.elapsed()>timeout{let _=child.kill();let _=child.wait();return Err(format!("{program}: délai dépassé"))}std::thread::sleep(Duration::from_millis(20));};
    let bytes=out.join().map_err(|_|"Lecture interrompue")?.map_err(|e|e.to_string())?;
    let errors=err.join().map_err(|_|"Lecture interrompue")?.map_err(|e|e.to_string())?;
    if !codes.contains(&status.code().unwrap_or(-1)){return Err(format!("{program}: {}",String::from_utf8_lossy(&errors).chars().take(2000).collect::<String>()))}
    if bytes.len()>limit{return Err("Résultat trop volumineux : affinez la recherche ou sélectionnez un fichier".into())}
    Ok((String::from_utf8_lossy(&bytes).into_owned(),status.code().unwrap_or(-1)))
}

#[cfg(test)] mod tests{
    use super::*;
    #[test]fn confines_paths_and_detects_external_changes(){let dir=tempfile::tempdir().unwrap();fs::write(dir.path().join("a.txt"),"one").unwrap();let w=Workspace::open(dir.path().to_str().unwrap()).unwrap();assert!(w.resolve("../etc",false).is_err());assert!(w.resolve("/etc/passwd",false).is_err());let file=w.read("a.txt").unwrap();fs::write(dir.path().join("a.txt"),"two").unwrap();assert!(w.write("a.txt","three",file["stamp"].as_str().unwrap()).is_err());assert_eq!(w.read("a.txt").unwrap()["content"],"two");}
    #[cfg(unix)]#[test]fn rejects_external_symlink(){let dir=tempfile::tempdir().unwrap();std::os::unix::fs::symlink("/etc/passwd",dir.path().join("secret")).unwrap();let w=Workspace::open(dir.path().to_str().unwrap()).unwrap();assert!(w.resolve("secret",false).is_err());}
}
