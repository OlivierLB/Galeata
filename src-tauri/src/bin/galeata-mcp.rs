//! MCP stdio transport only. All workspace operations stay inside the running IDE.
#[cfg(unix)]
fn main() {
    use serde_json::{json, Value};
    use std::{
        io::{BufRead, BufReader, Read, Write},
        os::unix::net::UnixStream,
        time::Duration,
    };
    let args = std::env::args().skip(1).collect::<Vec<_>>();
    let value = |flag: &str| {
        args.windows(2)
            .find(|pair| pair[0] == flag)
            .map(|pair| pair[1].clone())
    };
    let Some(socket) = value("--socket") else {
        eprintln!("Usage: galeata-mcp --socket PATH --workspace ID");
        std::process::exit(2)
    };
    let Some(workspace) = value("--workspace") else {
        eprintln!("--workspace requis");
        std::process::exit(2)
    };
    let stdin = std::io::stdin();
    let mut input = BufReader::new(stdin.lock());
    let mut stdout = std::io::stdout().lock();
    loop {
        let mut line = String::new();
        let read = Read::take(&mut input, 1024 * 1024 + 1).read_line(&mut line);
        if matches!(read, Ok(0)) {
            break;
        }
        if read.is_err() || line.len() > 1024 * 1024 {
            eprintln!("Message MCP trop volumineux ou entrée interrompue");
            break;
        }
        let request = match serde_json::from_str::<Value>(&line) {
            Ok(v) => v,
            Err(_) => {
                let _ = writeln!(
                    stdout,
                    "{}",
                    json!({"jsonrpc":"2.0","id":null,"error":{"code":-32700,"message":"JSON invalide"}})
                );
                let _ = stdout.flush();
                continue;
            }
        };
        if request.get("id").is_none() {
            continue;
        }
        let result = (|| -> std::result::Result<String, String> {
            let mut stream = UnixStream::connect(&socket)
                .map_err(|_| "Galeata n’est pas démarré ou le socket n’est plus disponible")?;
            stream
                .set_read_timeout(Some(Duration::from_secs(35)))
                .map_err(|e| e.to_string())?;
            stream
                .set_write_timeout(Some(Duration::from_secs(5)))
                .map_err(|e| e.to_string())?;
            writeln!(
                stream,
                "{}",
                json!({"workspaceId":workspace,"request":request})
            )
            .map_err(|e| e.to_string())?;
            let mut reply = String::new();
            BufReader::new(stream.take(4 * 1024 * 1024 + 1))
                .read_line(&mut reply)
                .map_err(|e| e.to_string())?;
            if reply.is_empty() || reply.len() > 4 * 1024 * 1024 {
                return Err("Réponse MCP absente ou trop volumineuse".into());
            }
            serde_json::from_str::<Value>(&reply).map_err(|_| "Réponse MCP invalide")?;
            Ok(reply)
        })();
        match result {
            Ok(reply) => {
                let _ = write!(stdout, "{reply}");
            }
            Err(error) => {
                let _ = writeln!(
                    stdout,
                    "{}",
                    json!({"jsonrpc":"2.0","id":request["id"],"error":{"code":-32001,"message":error}})
                );
            }
        }
        if stdout.flush().is_err() {
            break;
        }
    }
}
#[cfg(not(unix))]
fn main() {
    eprintln!("Galeata MCP nécessite Linux pour cette version");
    std::process::exit(1)
}
