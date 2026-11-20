mod ble;
mod crypto;
mod frames;
mod peers;
#[cfg(target_os = "linux")]
mod peripheral;
#[cfg(target_os = "windows")]
#[path = "peripheral_windows.rs"]
mod peripheral;
mod protocol;
#[cfg(any(target_os = "linux", target_os = "windows"))]
mod transport;

use anyhow::{anyhow, ensure, Result};
use serde::Deserialize;
use serde_json::{json, Value};
#[cfg(any(target_os = "linux", target_os = "windows"))]
use std::sync::Arc;
use std::{path::PathBuf, time::Duration};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
#[cfg(any(target_os = "linux", target_os = "windows"))]
use tokio::sync::Mutex;
const MAX_NATIVE: usize = 65536;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Request {
    id: u64,
    op: String,
    #[serde(default)]
    payload: Value,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Empty {}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Id {
    id: String,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct SendGrant {
    #[serde(rename = "peerId")]
    peer_id: String,
    origin: String,
    username: String,
    password: String,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct PeerChoice {
    #[serde(rename = "peerId", default)]
    peer_id: Option<String>,
}
fn parse<T: serde::de::DeserializeOwned>(value: Value) -> Result<T> {
    Ok(serde_json::from_value(value)?)
}
fn config_path() -> Result<PathBuf> {
    // Match the installer: USERPROFILE wins on Windows even if another tool set HOME.
    #[cfg(target_os = "windows")]
    let home = std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME"));
    #[cfg(not(target_os = "windows"))]
    let home = std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE"));
    let home = home.ok_or_else(|| anyhow!("User profile directory is not set"))?;
    Ok(PathBuf::from(home).join(".config/ghoststate/allowed-callers.json"))
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Allowlist {
    allowed: Vec<String>,
}
fn authorize(args: &[String], path: &std::path::Path) -> Result<()> {
    let metadata = std::fs::metadata(path)?;
    ensure!(
        metadata.is_file() && metadata.len() <= 8192,
        "Invalid caller configuration"
    );
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        ensure!(
            metadata.permissions().mode() & 0o022 == 0,
            "Caller configuration is writable by another user"
        );
    }
    let allowed: Allowlist = serde_json::from_slice(&std::fs::read(path)?)?;
    ensure!(
        !allowed.allowed.is_empty() && allowed.allowed.len() <= 20,
        "Empty or oversized allowlist"
    );
    let caller = if args
        .first()
        .is_some_and(|a| a.starts_with("chrome-extension://"))
    {
        args.first()
    } else {
        args.get(1)
    }
    .ok_or_else(|| anyhow!("Missing browser caller identity"))?;
    ensure!(
        allowed.allowed.iter().any(|x| x == caller),
        "Unauthorized native messaging caller"
    );
    Ok(())
}
struct Backend {
    central: Option<ble::CentralTransport>,
    clients: peers::PeerSlots<ble::Client>,
    #[cfg(any(target_os = "linux", target_os = "windows"))]
    listener: Option<peripheral::Listener>,
    #[cfg(any(target_os = "linux", target_os = "windows"))]
    shared: Arc<Mutex<transport::TransportState>>,
    listen_started: u64,
}
impl Backend {
    fn new() -> Self {
        Self {
            central: None,
            clients: peers::PeerSlots::default(),
            #[cfg(any(target_os = "linux", target_os = "windows"))]
            listener: None,
            #[cfg(any(target_os = "linux", target_os = "windows"))]
            shared: Arc::new(Mutex::new(transport::TransportState::default())),
            listen_started: 0,
        }
    }
    async fn expire(&mut self) {
        let mut stop =
            self.listen_started > 0 && crypto::now().saturating_sub(self.listen_started) > 300;
        #[cfg(any(target_os = "linux", target_os = "windows"))]
        {
            stop = stop
                || self
                    .listener
                    .as_ref()
                    .is_some_and(|listener| !listener.is_running());
        }
        if stop {
            self.stop_listen().await;
        }
        #[cfg(any(target_os = "linux", target_os = "windows"))]
        self.shared.lock().await.server.purge_expired(crypto::now());
        let expired: Vec<String> = self
            .clients
            .iter()
            .filter(|(_, c)| c.is_expired())
            .map(|(id, _)| id.clone())
            .collect();
        for id in expired {
            if let Some(c) = self.clients.remove(&id) {
                c.disconnect().await;
            }
        }
    }
    async fn stop_listen(&mut self) {
        #[cfg(any(target_os = "linux", target_os = "windows"))]
        {
            self.listener = None;
            self.shared = Arc::new(Mutex::new(transport::TransportState::default()));
        }
        self.listen_started = 0;
    }
    async fn disconnect_all(&mut self) {
        let ids: Vec<String> = self.clients.iter().map(|(id, _)| id.clone()).collect();
        for id in ids {
            if let Some(c) = self.clients.remove(&id) {
                c.disconnect().await;
            }
        }
    }
    async fn status(&self) -> Value {
        #[cfg(any(target_os = "linux", target_os = "windows"))]
        let receiver = self.shared.lock().await.server.status();
        #[cfg(not(any(target_os = "linux", target_os = "windows")))]
        let receiver = json!({"pairing":null,"incoming":[]});
        let pairings: Vec<Value> = self
            .clients
            .iter()
            .map(|(id, c)| {
                let mut status = c.status();
                status["peerId"] = json!(id);
                status
            })
            .collect();
        json!({"version":env!("CARGO_PKG_VERSION"),"bleProtocol":2,"platform":std::env::consts::OS,"centralSupported":true,"peripheralSupported":cfg!(any(target_os="linux",target_os="windows")),"listening":self.listen_started>0,
            "connectionLimit":peers::MAX_PEERS,"pairings":pairings,"receiverPairing":receiver["pairing"],"incoming":receiver["incoming"]})
    }
    async fn handle(&mut self, op: &str, payload: Value) -> Result<Value> {
        self.expire().await;
        match op {
            "status" => {
                let _: Empty = parse(payload)?;
                Ok(self.status().await)
            }
            "discover" => {
                let _: Empty = parse(payload)?;
                ensure!(self.listen_started == 0, "Stop listening before scanning");
                if self.central.is_none() {
                    self.central = Some(ble::CentralTransport::new().await?);
                }
                self.central.as_mut().unwrap().discover().await
            }
            "listen" => {
                let _: Empty = parse(payload)?;
                ensure!(
                    self.clients.is_empty(),
                    "Disconnect sender pairings before listening"
                );
                ensure!(self.listen_started == 0, "Already listening");
                #[cfg(any(target_os = "linux", target_os = "windows"))]
                {
                    let shared = Arc::new(Mutex::new(transport::TransportState::default()));
                    let listener = peripheral::start(shared.clone()).await?;
                    self.shared = shared;
                    self.listener = Some(listener);
                    self.listen_started = crypto::now();
                    return Ok(self.status().await);
                }
                #[cfg(not(any(target_os = "linux", target_os = "windows")))]
                {
                    Err(anyhow!(
                        "BLE peripheral advertising is currently implemented only for Linux and Windows"
                    ))
                }
            }
            "stop_listen" => {
                let _: Empty = parse(payload)?;
                self.stop_listen().await;
                Ok(self.status().await)
            }
            "pair" => {
                let args: Id = parse(payload)?;
                ensure!(
                    self.listen_started == 0,
                    "Stop listening before pairing as sender"
                );
                self.clients.ensure_available(&args.id)?;
                let c = self
                    .central
                    .as_ref()
                    .ok_or_else(|| anyhow!("Discover devices first"))?
                    .pair(&args.id)
                    .await?;
                let mut status = c.status();
                status["peerId"] = json!(&args.id);
                self.clients.insert(args.id, c)?;
                Ok(status)
            }
            "confirm_pair" => {
                let choice: PeerChoice = parse(payload)?;
                if let Some(id) = choice.peer_id {
                    let c = self
                        .clients
                        .get_mut(&id)
                        .ok_or_else(|| anyhow!("Pairing not found"))?;
                    return c.confirm().await;
                }
                #[cfg(any(target_os = "linux", target_os = "windows"))]
                {
                    ensure!(
                        self.listen_started > 0,
                        "Choose a sender pairing to confirm"
                    );
                    self.shared.lock().await.server.confirm()?;
                    return Ok(self.status().await);
                }
                #[cfg(not(any(target_os = "linux", target_os = "windows")))]
                {
                    Err(anyhow!("Choose a sender pairing to confirm"))
                }
            }
            "cancel_pair" => {
                let choice: PeerChoice = parse(payload)?;
                if let Some(id) = choice.peer_id {
                    let c = self
                        .clients
                        .remove(&id)
                        .ok_or_else(|| anyhow!("Pairing not found"))?;
                    c.disconnect().await;
                } else {
                    ensure!(self.listen_started > 0, "Choose a pairing to end");
                    self.stop_listen().await;
                }
                Ok(self.status().await)
            }
            "send_grant" => {
                let p: SendGrant = parse(payload)?;
                ensure!(
                    !p.peer_id.is_empty() && p.peer_id.len() <= 256,
                    "Choose a verified recipient"
                );
                let c = self
                    .clients
                    .get_mut(&p.peer_id)
                    .ok_or_else(|| anyhow!("No verified recipient with that ID"))?;
                c.send(p.origin, p.username, p.password).await
            }
            "incoming" => {
                let _: Empty = parse(payload)?;
                Ok(self.status().await)
            }
            "accept_transfer" => {
                let p: Id = parse(payload)?;
                ensure!(!p.id.is_empty() && p.id.len() <= 64, "Invalid transfer ID");
                #[cfg(any(target_os = "linux", target_os = "windows"))]
                {
                    let g = self.shared.lock().await.server.take(&p.id)?;
                    Ok(
                        json!({"id":g.id,"origin":g.origin,"username":g.username,"password":g.password}),
                    )
                }
                #[cfg(not(any(target_os = "linux", target_os = "windows")))]
                {
                    Err(anyhow!("Receiving is not supported on this platform"))
                }
            }
            "reject_transfer" => {
                let p: Id = parse(payload)?;
                #[cfg(any(target_os = "linux", target_os = "windows"))]
                {
                    self.shared.lock().await.server.reject(&p.id)?;
                    return Ok(self.status().await);
                }
                #[cfg(not(any(target_os = "linux", target_os = "windows")))]
                {
                    let _ = p;
                    Err(anyhow!("Receiving is not supported on this platform"))
                }
            }
            _ => Err(anyhow!("Unknown native command")),
        }
    }
}
async fn read_messages(tx: tokio::sync::mpsc::Sender<Vec<u8>>) {
    let mut stdin = tokio::io::stdin();
    loop {
        let mut header = [0u8; 4];
        if stdin.read_exact(&mut header).await.is_err() {
            break;
        }
        let n = u32::from_ne_bytes(header) as usize;
        if n == 0 || n > MAX_NATIVE {
            break;
        }
        let mut data = vec![0u8; n];
        if stdin.read_exact(&mut data).await.is_err() {
            break;
        }
        if tx.send(data).await.is_err() {
            break;
        }
    }
}
async fn run() -> Result<()> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    authorize(&args, &config_path()?)?;
    let (tx, mut rx) = tokio::sync::mpsc::channel::<Vec<u8>>(8);
    tokio::spawn(read_messages(tx));
    let mut backend = Backend::new();
    let mut stdout = tokio::io::stdout();
    let mut interval = tokio::time::interval(Duration::from_secs(5));
    loop {
        tokio::select! {
         _=interval.tick()=>backend.expire().await,
         message=rx.recv()=>{let Some(mut message)=message else{break};let parsed=serde_json::from_slice::<Request>(&message);use zeroize::Zeroize;message.zeroize();
          let response=match parsed {Ok(req) if req.id>0&&req.id<=9_007_199_254_740_991&&req.op.len()<=64=>match backend.handle(&req.op,req.payload).await{Ok(data)=>json!({"id":req.id,"ok":true,"data":data}),Err(e)=>json!({"id":req.id,"ok":false,"error":e.to_string().chars().take(300).collect::<String>()})},_=>json!({"id":0,"ok":false,"error":"Invalid native request"})};
          let mut bytes=serde_json::to_vec(&response)?;ensure!(bytes.len()<=MAX_NATIVE,"Native response too large");stdout.write_all(&(bytes.len() as u32).to_ne_bytes()).await?;stdout.write_all(&bytes).await?;stdout.flush().await?;bytes.zeroize();
         }
        }
    }
    backend.stop_listen().await;
    backend.disconnect_all().await;
    Ok(())
}
#[tokio::main]
async fn main() {
    if let Err(e) = run().await {
        eprintln!("GhostState companion: {}", e);
        std::process::exit(1);
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn native_caller_allowlist_rejects_unknown() {
        let dir = std::env::temp_dir().join(format!("gs-auth-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&dir).unwrap();
        let file = dir.join("allowed.json");
        std::fs::write(&file,r#"{"allowed":["chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/","ghoststate@local.invalid"]}"#).unwrap();
        assert!(authorize(
            &["chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/".into()],
            &file
        )
        .is_ok());
        assert!(authorize(
            &["chrome-extension://bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb/".into()],
            &file
        )
        .is_err());
        assert!(authorize(
            &["/manifest/path".into(), "ghoststate@local.invalid".into()],
            &file
        )
        .is_ok());
        assert!(authorize(&[], &file).is_err());
        std::fs::remove_dir_all(dir).unwrap();
    }
}
