use crate::{store::Result,State};
use serde_json::{json,Value};
use std::sync::Arc;

pub fn tools()->Value{
    let string=json!({"type":"string"});let integer=json!({"type":"integer","minimum":0});
    let definitions=vec![
        ("workspace.search_files","Rechercher des fichiers dans le projet ouvert",json!({"query":string,"offset":integer}),vec!["query"]),
        ("workspace.search_text","Rechercher du texte littéral dans le projet ouvert",json!({"query":string,"offset":integer}),vec!["query"]),
        ("workspace.get_context","Lire le projet, la branche, les instructions et le plan",json!({}),vec![]),
        ("git.get_status","Consulter les modifications Git locales",json!({}),vec![]),
        ("git.get_diff","Lire le diff d’un fichier",json!({"path":string,"staged":{"type":"boolean"}}),vec!["path"]),
        ("plan.get","Lire le plan et sa révision avant une mise à jour",json!({}),vec![]),
        ("plan.update_step","Mettre à jour une étape existante sans changer son objectif. done indique une déclaration de l’agent, pas une vérification.",json!({"revision":integer,"id":string,"status":{"type":"string","enum":["pending","in_progress","blocked","done"]},"note":string}),vec!["revision","id","status"]),
        ("plan.propose_change","Proposer un changement de périmètre à valider dans Galeata",json!({"reason":string,"objective":string,"steps":{"type":"array","items":{"type":"object"}}}),vec!["reason","objective","steps"]),
        ("activity.report","Déclarer une activité, un blocage ou une mission de sous-agent",json!({"message":string,"sessionId":string,"parentId":string,"stepId":string,"status":{"type":"string","enum":["running","blocked","done"]},"files":{"type":"array","items":string}}),vec!["message","sessionId","status"]),
        ("verification.record","Rapporter une vérification avec provenance agent_reported",json!({"message":string,"stepId":string,"command":string,"exitCode":{"type":"integer"},"sessionId":string}),vec!["message","command","exitCode"]),
        ("session.save_handoff","Enregistrer une passation pour reprendre le travail",json!({"message":string,"sessionId":string,"nextAction":string,"stepId":string}),vec!["message","sessionId","nextAction"]),
        ("ui.open_file","Présenter un fichier à l’utilisateur",json!({"path":string,"line":{"type":"integer","minimum":1}}),vec!["path"]),
        ("ui.show_diff","Présenter le diff local d’un fichier",json!({"path":string,"staged":{"type":"boolean"}}),vec!["path"]),
    ];
    json!(definitions.into_iter().map(|(name,description,properties,required)|json!({"name":name,"description":description,"inputSchema":{"type":"object","properties":properties,"required":required,"additionalProperties":false},"annotations":{"readOnlyHint":name.starts_with("workspace.")||name.starts_with("git.")||name=="plan.get","destructiveHint":false,"openWorldHint":false}})).collect::<Vec<_>>())
}
pub fn response(request:&Value,call:impl FnOnce(&str,Value)->Result<Value>)->Option<Value>{
    let id=request.get("id")?;let method=request["method"].as_str().unwrap_or("");
    let result:std::result::Result<Value,(i32,String)>=match method{
        "initialize"=>{
            let requested=request["params"]["protocolVersion"].as_str().unwrap_or("");
            let version=if ["2024-11-05","2025-03-26","2025-06-18"].contains(&requested){requested}else{"2025-06-18"};
            Ok(json!({"protocolVersion":version,"serverInfo":{"name":"galeata","version":env!("CARGO_PKG_VERSION")},"capabilities":{"tools":{"listChanged":false}},"instructions":"Utiliser plan.get avant plan.update_step. Rapporter activité et passation avec sessionId. Ne jamais déclarer une vérification observée par Galeata : les rapports MCP restent agent_reported. Les changements d’objectif passent par plan.propose_change."}))
        },
        "ping"=>Ok(json!({})),
        "tools/list"=>Ok(json!({"tools":tools()})),
        "tools/call"=>{
            let name=request["params"]["name"].as_str().unwrap_or("");
            if !tools().as_array().unwrap().iter().any(|t|t["name"]==name){Err((-32602,"Outil inconnu".into()))}
            else{let args=request["params"].get("arguments").cloned().unwrap_or(json!({}));
                let schema=tools();let definition=schema.as_array().unwrap().iter().find(|t|t["name"]==name).unwrap();
                let validation=validate(&args,&definition["inputSchema"]);
                let result=validation.and_then(|_|call(name,args));
                Ok(match result{Ok(value)=>json!({"content":[{"type":"text","text":value.to_string()}],"isError":false}),Err(error)=>json!({"content":[{"type":"text","text":error}],"isError":true})})
            }
        },
        _=>Err((-32601,"Méthode inconnue".into()))
    };
    Some(match result{Ok(result)=>json!({"jsonrpc":"2.0","id":id,"result":result}),Err((code,message))=>json!({"jsonrpc":"2.0","id":id,"error":{"code":code,"message":message}})})
}
fn validate(args:&Value,schema:&Value)->Result<()>{
    let object=args.as_object().ok_or("Arguments attendus sous forme d’objet")?;
    for key in schema["required"].as_array().unwrap(){if !object.contains_key(key.as_str().unwrap()){return Err(format!("Argument manquant : {key}"))}}
    for (key,value) in object{let rule=&schema["properties"][key];if rule.is_null(){return Err(format!("Argument inconnu : {key}"))}let valid=match rule["type"].as_str(){Some("string")=>value.is_string(),Some("integer")=>value.as_i64().is_some(),Some("boolean")=>value.is_boolean(),Some("array")=>value.is_array(),_=>true};if !valid{return Err(format!("Type invalide : {key}"))}if let Some(values)=rule["enum"].as_array(){if !values.contains(value){return Err(format!("Valeur invalide : {key}"))}}if let Some(min)=rule["minimum"].as_i64(){if value.as_i64().unwrap_or(-1)<min{return Err(format!("Valeur trop petite : {key}"))}}}
    Ok(())
}

#[cfg(unix)]
pub fn serve(app:tauri::AppHandle,state:Arc<State>)->Result<()>{
    use std::{fs,io::{BufRead,BufReader,Write,Read},os::unix::{fs::PermissionsExt,net::UnixListener},sync::atomic::{AtomicUsize,Ordering},time::Duration};
    let listener=UnixListener::bind(&state.socket).map_err(|e|e.to_string())?;
    fs::set_permissions(&state.socket,fs::Permissions::from_mode(0o600)).map_err(|e|e.to_string())?;
    let active=Arc::new(AtomicUsize::new(0));
    std::thread::spawn(move||{for stream in listener.incoming(){let Ok(mut stream)=stream else{break};if active.fetch_add(1,Ordering::SeqCst)>=16{active.fetch_sub(1,Ordering::SeqCst);continue}let count=Arc::clone(&active);let state=Arc::clone(&state);let app=app.clone();std::thread::spawn(move||{
        let _=stream.set_read_timeout(Some(Duration::from_secs(30)));let _=stream.set_write_timeout(Some(Duration::from_secs(30)));
        let mut line=String::new();let read=BufReader::new(Read::take(&mut stream,1024*1024+1)).read_line(&mut line);
        if read.is_ok()&&line.len()<=1024*1024{if let Ok(envelope)=serde_json::from_str::<Value>(&line){
            let result=(||->Result<Value>{let _gate=state.workspace_gate.read().map_err(|e|e.to_string())?;let workspace=state.current()?;if envelope["workspaceId"]!=workspace.id{return Err("WORKSPACE_CHANGED: la session est liée à un autre dossier".into())}Ok(response(&envelope["request"],|method,args|state.dispatch(&app,method,args,true)).unwrap_or(Value::Null))})();
            let value=match result{Ok(v)=>v,Err(e)=>json!({"jsonrpc":"2.0","id":envelope["request"]["id"],"error":{"code":-32001,"message":e}})};
            let _=writeln!(stream,"{value}");
        }}count.fetch_sub(1,Ordering::SeqCst);
    });}});Ok(())
}
#[cfg(not(unix))]pub fn serve(_:tauri::AppHandle,_:Arc<State>)->Result<()>{Err("MCP local disponible sur Linux uniquement pour cette version".into())}

#[cfg(test)]mod tests{
    use super::*;
    #[test]fn notifications_have_no_response(){assert!(response(&json!({"jsonrpc":"2.0","method":"notifications/initialized"}),|_,_|panic!()).is_none())}
    #[test]fn tool_errors_are_content_errors(){let reply=response(&json!({"id":1,"method":"tools/call","params":{"name":"plan.get"}}),|_,_|Err("DISCONNECTED".into())).unwrap();assert_eq!(reply["result"]["isError"],true)}
    #[test]fn rejects_extra_arguments(){let reply=response(&json!({"id":2,"method":"tools/call","params":{"name":"plan.get","arguments":{"root":"/"}}}),|_,_|panic!()).unwrap();assert_eq!(reply["result"]["isError"],true)}
    #[test]fn lists_real_tools(){let list=tools();assert_eq!(list.as_array().unwrap().len(),13);assert!(list.as_array().unwrap().iter().all(|v|v["inputSchema"]["additionalProperties"]==false));}
}
