use crate::{
    crypto::{self, Keypair, Session},
    frames::{fragment, request_frame, Reassembler},
    protocol::Wire,
};
use anyhow::{anyhow, ensure, Context, Result};
use btleplug::{
    api::{
        Central, CentralState, Characteristic, Manager as _, Peripheral as _, ScanFilter, WriteType,
    },
    platform::{Adapter, Manager, Peripheral},
};
use serde_json::{json, Value};
use std::time::Duration;
use uuid::Uuid;

pub const SERVICE: Uuid = Uuid::from_u128(0x77ec8a7c_4a0f_4b93_b9cb_613dfb0a3201);
pub const RX: Uuid = Uuid::from_u128(0x77ec8a7c_4a0f_4b93_b9cb_613dfb0a3202);
pub const TX: Uuid = Uuid::from_u128(0x77ec8a7c_4a0f_4b93_b9cb_613dfb0a3203);

pub struct CentralTransport {
    adapter: Adapter,
    discovered: Vec<Peripheral>,
}
impl CentralTransport {
    pub async fn new() -> Result<Self> {
        let manager = Manager::new().await?;
        let adapter = manager
            .adapters()
            .await?
            .into_iter()
            .next()
            .ok_or_else(|| anyhow!("No Bluetooth adapter available"))?;
        Ok(Self {
            adapter,
            discovered: vec![],
        })
    }
    pub async fn discover(&mut self) -> Result<Value> {
        self.discovered.clear(); // Never offer stale results after an unsuccessful scan.
        if matches!(
            self.adapter.adapter_state().await,
            Ok(CentralState::PoweredOff)
        ) {
            return Err(anyhow!(
                "Bluetooth is turned off. Turn it on and scan again."
            ));
        }
        self.adapter
            .start_scan(ScanFilter {
                services: vec![SERVICE],
            })
            .await
            .context(
                "Could not start Bluetooth scanning. Check Bluetooth power and OS permissions",
            )?;
        tokio::time::sleep(Duration::from_secs(4)).await;
        // Stop the scan even when retrieving its results fails.
        let found = self.adapter.peripherals().await;
        let stopped = self.adapter.stop_scan().await;
        let all = found.context("Could not read nearby Bluetooth devices")?;
        stopped.context("Could not stop Bluetooth scanning")?;
        let mut list = Vec::new();
        for p in all {
            // One inaccessible unrelated peripheral must not abort the whole result.
            if let Ok(Some(props)) = p.properties().await {
                if props.services.contains(&SERVICE) {
                    let id = p.id().to_string();
                    list.push(json!({"id":id,"name":props.local_name.unwrap_or_else(||"GhostState device".into()),"rssi":props.rssi}));
                    self.discovered.push(p);
                }
            }
        }
        Ok(json!({"devices":list}))
    }
    pub async fn pair(&self, id: &str) -> Result<Client> {
        ensure!(id.len() <= 256, "Invalid device ID");
        let peripheral = self
            .discovered
            .iter()
            .find(|p| p.id().to_string() == id)
            .ok_or_else(|| anyhow!("Device not in the last discovery result"))?
            .clone();
        peripheral.connect().await?;
        // If handshake/service discovery fails, do not leave an unusable link occupying
        // an adapter connection slot. A successful Client owns a clone of the handle.
        let result: Result<Client> = async {
            peripheral.discover_services().await?;
            let chars = peripheral.characteristics();
            let rx = chars
                .iter()
                .find(|x| x.uuid == RX && x.service_uuid == SERVICE)
                .ok_or_else(|| anyhow!("Peer lacks GhostState write characteristic"))?
                .clone();
            let tx = chars
                .iter()
                .find(|x| x.uuid == TX && x.service_uuid == SERVICE)
                .ok_or_else(|| anyhow!("Peer lacks GhostState read characteristic"))?
                .clone();
            let kp = Keypair::new();
            let res = exchange(
                &peripheral,
                &rx,
                &tx,
                &Wire::Hello {
                    hello: kp.hello.clone(),
                },
            )
            .await?;
            let peer = serde_json::from_value(
                res.get("hello")
                    .ok_or_else(|| anyhow!("Malformed peer hello"))?
                    .clone(),
            )?;
            let session = kp.establish(&peer, true)?;
            Ok(Client {
                peripheral: peripheral.clone(),
                rx,
                tx,
                session,
                created: crypto::now(),
                local_confirmed: false,
                verified: false,
            })
        }
        .await;
        if result.is_err() {
            let _ = peripheral.disconnect().await;
        }
        result
    }
}
async fn exchange(
    p: &Peripheral,
    rx: &Characteristic,
    tx: &Characteristic,
    wire: &Wire,
) -> Result<Value> {
    let serialized = serde_json::to_vec(wire)?;
    for frame in fragment(&serialized)? {
        p.write(rx, &frame, WriteType::WithResponse).await?;
    }
    let mut collector = Reassembler::default();
    let mut index = 0usize;
    let response = loop {
        ensure!(index < 800, "Too many response fragments");
        p.write(rx, &request_frame(index)?, WriteType::WithResponse)
            .await?;
        let frame = p.read(tx).await?;
        if let Some(data) = collector.push(&frame)? {
            break data;
        }
        index += 1;
    };
    let res: Value = serde_json::from_slice(&response)?;
    ensure!(
        res.get("ok").and_then(Value::as_bool) == Some(true),
        "Peer rejected request: {}",
        res.get("error")
            .and_then(Value::as_str)
            .unwrap_or("invalid response")
    );
    Ok(res.get("data").cloned().unwrap_or(Value::Null))
}
pub struct Client {
    peripheral: Peripheral,
    rx: Characteristic,
    tx: Characteristic,
    pub session: Session,
    created: u64,
    pub local_confirmed: bool,
    pub verified: bool,
}
impl Client {
    pub fn is_expired(&self) -> bool {
        crypto::now().saturating_sub(self.created) > 300
    }
    pub fn status(&self) -> Value {
        json!({"code":self.session.code,"peerFingerprint":self.session.peer_fingerprint,"localConfirmed":self.local_confirmed,"verified":self.verified&&crypto::now().saturating_sub(self.created)<=300,"role":"sender"})
    }
    pub async fn confirm(&mut self) -> Result<Value> {
        ensure!(
            crypto::now().saturating_sub(self.created) <= 120,
            "Pairing confirmation expired"
        );
        self.local_confirmed = true;
        let res = exchange(
            &self.peripheral,
            &self.rx,
            &self.tx,
            &Wire::Confirm {
                proof: self.session.proof("client-confirm"),
            },
        )
        .await?;
        if res.get("ready").and_then(Value::as_bool) == Some(true) {
            self.session.verify_proof(
                "server-confirm",
                res.get("proof")
                    .and_then(Value::as_str)
                    .ok_or_else(|| anyhow!("Missing confirmation proof"))?,
            )?;
            self.verified = true;
        }
        Ok(self.status())
    }
    pub async fn send(
        &mut self,
        origin: String,
        username: String,
        password: String,
    ) -> Result<Value> {
        ensure!(
            self.local_confirmed
                && self.verified
                && crypto::now().saturating_sub(self.created) <= 300,
            "Pairing not verified or expired"
        );
        let grant = crypto::make_grant(&self.session, origin, username, password)?;
        let envelope = self.session.encrypt(&grant)?;
        let result = exchange(
            &self.peripheral,
            &self.rx,
            &self.tx,
            &Wire::Grant { envelope },
        )
        .await?;
        ensure!(
            result.get("pending").and_then(Value::as_bool) == Some(true)
                && result.get("id").and_then(Value::as_str) == Some(grant.id.as_str()),
            "Recipient did not acknowledge transfer"
        );
        self.session.verify_proof(
            &format!("grant-accepted:{}", grant.id),
            result
                .get("proof")
                .and_then(Value::as_str)
                .ok_or_else(|| anyhow!("Missing receipt proof"))?,
        )?;
        Ok(json!({"pending":true,"id":grant.id,"expires":grant.expires}))
    }
    pub async fn disconnect(&self) {
        let _ = self.peripheral.disconnect().await;
    }
}
