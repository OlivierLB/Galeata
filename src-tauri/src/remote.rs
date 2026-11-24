use crate::{store::{Result,Store},workspace::Workspace};
use serde_json::{json,Value};
use std::time::Duration;

fn encode(value:&str)->String{url::form_urlencoded::byte_serialize(value.as_bytes()).collect::<String>().replace('+',"%20")}
fn credential(w:&Workspace)->Result<keyring::Entry>{keyring::Entry::new("dev.olivierlb.galeata",&w.id).map_err(|e|format!("Coffre système : {e}"))}
pub fn connection(store:&Store,w:&Workspace)->Result<Value>{store.preference(&w.id,"remote")}
pub fn connect(store:&Store,w:&Workspace,args:&Value)->Result<Value>{
    let provider=args["provider"].as_str().ok_or("Fournisseur requis")?;
    if !matches!(provider,"github"|"gitlab"){return Err("Fournisseur inconnu".into())}
    let host=args["host"].as_str().unwrap_or(if provider=="github"{"https://api.github.com"}else{"https://gitlab.com"}).trim_end_matches('/');
    let url=url::Url::parse(host).map_err(|_|"URL invalide")?;
    if url.scheme()!="https"||url.host_str().is_none()||!url.username().is_empty()||url.password().is_some()||url.query().is_some()||url.fragment().is_some()||url.path()!="/"{return Err("Utilisez une origine HTTPS sans chemin ni identifiants".into())}
    let project=args["project"].as_str().filter(|p|!p.is_empty()&&p.len()<512&&!p.split('/').any(|s|s.is_empty()||s==".."||s==".")).ok_or("Projet attendu : propriétaire/dépôt ou groupe/projet")?;
    let token=args["token"].as_str().filter(|s|!s.trim().is_empty()).ok_or("Jeton requis")?;
    let config=json!({"provider":provider,"host":host,"project":project,"connected":true});
    api(&config,token,"")?;
    credential(w)?.set_password(token).map_err(|e|format!("Impossible d’enregistrer le jeton dans le coffre système : {e}"))?;
    store.set_preference(&w.id,"remote",&config)?;Ok(config)
}
pub fn disconnect(store:&Store,w:&Workspace)->Result<Value>{let _=credential(w)?.delete_credential();store.set_preference(&w.id,"remote",&Value::Null)?;Ok(Value::Null)}
fn api(config:&Value,token:&str,suffix:&str)->Result<Value>{
    let host=config["host"].as_str().ok_or("Connexion absente")?;let project=config["project"].as_str().ok_or("Projet absent")?;
    let base=if config["provider"]=="github"{let parts=project.split('/').map(encode).collect::<Vec<_>>().join("/");format!("{host}/repos/{parts}")}else{format!("{host}/api/v4/projects/{}",encode(project))};
    let agent=ureq::AgentBuilder::new().timeout(Duration::from_secs(20)).redirects(0).build();
    let mut req=agent.get(&format!("{base}{suffix}")).set("User-Agent","Galeata/0.1").set("Accept","application/json");
    req=if config["provider"]=="github"{req.set("Authorization",&format!("Bearer {token}"))}else{req.set("PRIVATE-TOKEN",token)};
    let response=req.call().map_err(|e|match e{ureq::Error::Status(code,_)=>format!("Service distant : HTTP {code}. Vérifiez la connexion et les permissions du jeton."),_=>"Service distant inaccessible (réseau, certificat ou délai)".into()})?;
    use std::io::Read;let mut bytes=Vec::new();response.into_reader().take(4*1024*1024+1).read_to_end(&mut bytes).map_err(|_|"Lecture distante impossible")?;
    if bytes.len()>4*1024*1024{return Err("Réponse distante trop volumineuse".into())}serde_json::from_slice(&bytes).map_err(|_|"Réponse distante invalide".into())
}
pub fn list(store:&Store,w:&Workspace)->Result<Value>{
    let config=connection(store,w)?;let token=credential(w)?.get_password().map_err(|_|"Jeton absent ou coffre verrouillé. Reconnectez le service.".to_string())?;
    let github=config["provider"]=="github";let response=api(&config,&token,if github{"/pulls?state=open&per_page=50"}else{"/merge_requests?state=opened&per_page=50"})?;
    Ok(json!(response.as_array().ok_or("Liste distante invalide")?.iter().map(|v|json!({"id":if github{&v["number"]}else{&v["iid"]},"title":v["title"],"url":if github{&v["html_url"]}else{&v["web_url"]},"state":v["state"],"source":if github{&v["head"]["ref"]}else{&v["source_branch"]},"target":if github{&v["base"]["ref"]}else{&v["target_branch"]}})).collect::<Vec<_>>()))
}
pub fn detail(store:&Store,w:&Workspace,id:u64)->Result<Value>{
    let config=connection(store,w)?;let token=credential(w)?.get_password().map_err(|_|"Coffre verrouillé ou jeton absent")?;let github=config["provider"]=="github";
    if github{
        let files=api(&config,&token,&format!("/pulls/{id}/files?per_page=100"))?;
        let pr=api(&config,&token,&format!("/pulls/{id}"))?;let sha=pr["head"]["sha"].as_str().ok_or("Référence distante absente")?;
        let checks=api(&config,&token,&format!("/commits/{}/check-runs?per_page=100",encode(sha)))?;
        Ok(json!({"changes":files.as_array().unwrap_or(&vec![]).iter().map(|v|json!({"path":v["filename"],"patch":v["patch"].as_str().unwrap_or("Diff indisponible (binaire ou limite du fournisseur)")})).collect::<Vec<_>>(),"checks":checks["check_runs"].as_array().unwrap_or(&vec![]).iter().map(|v|json!({"name":v["name"],"status":v["conclusion"].as_str().unwrap_or(v["status"].as_str().unwrap_or("unknown")),"url":v["html_url"]})).collect::<Vec<_>>()}))
    }else{
        let files=api(&config,&token,&format!("/merge_requests/{id}/diffs?per_page=100"))?;
        let pipelines=api(&config,&token,&format!("/merge_requests/{id}/pipelines?per_page=100"))?;
        Ok(json!({"changes":files.as_array().unwrap_or(&vec![]).iter().map(|v|json!({"path":v["new_path"],"patch":v["diff"]})).collect::<Vec<_>>(),"checks":pipelines.as_array().unwrap_or(&vec![]).iter().map(|v|json!({"name":format!("Pipeline #{}",v["id"]),"status":v["status"],"url":v["web_url"]})).collect::<Vec<_>>()}))
    }
}
