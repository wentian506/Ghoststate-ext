use crate::crypto::{self, Envelope, Grant, Hello, Keypair, Session};
use anyhow::{anyhow, ensure, Result};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

#[derive(Serialize, Deserialize)]
#[serde(tag = "op", rename_all = "snake_case", deny_unknown_fields)]
pub enum Wire {
    Hello { hello: Hello },
    Confirm { proof: String },
    Grant { envelope: Envelope },
}
#[derive(Default)]
pub struct Server {
    pub session: Option<Session>,
    pub local_confirmed: bool,
    pub remote_confirmed: bool,
    pub created: u64,
    pub pending: Vec<Grant>,
}
impl Server {
    fn current(&self) -> Result<&Session> {
        let s = self.session.as_ref().ok_or_else(|| anyhow!("No pairing"))?;
        ensure!(
            crypto::now().saturating_sub(self.created) <= 300,
            "Pairing expired"
        );
        Ok(s)
    }
    pub fn process(&mut self, bytes: &[u8]) -> Vec<u8> {
        let result = self.handle(bytes);
        let value = match result {
            Ok(v) => json!({"ok":true,"data":v}),
            Err(e) => json!({"ok":false,"error":e.to_string()}),
        };
        serde_json::to_vec(&value).unwrap_or_else(|_| b"{\"ok\":false}".to_vec())
    }
    fn handle(&mut self, bytes: &[u8]) -> Result<Value> {
        let req: Wire = serde_json::from_slice(bytes)?;
        match req {
            Wire::Hello { hello } => {
                ensure!(
                    self.session.is_none(),
                    "A pairing is already in progress; restart discovery"
                );
                let pair = Keypair::new();
                let my_hello = pair.hello.clone();
                let session = pair.establish(&hello, false)?;
                self.created = crypto::now();
                self.session = Some(session);
                Ok(json!({"hello":my_hello}))
            }
            Wire::Confirm { proof } => {
                ensure!(
                    !self.remote_confirmed || self.local_confirmed,
                    "Waiting for local verification"
                );
                let s = self.current()?;
                s.verify_proof("client-confirm", &proof)?;
                self.remote_confirmed = true;
                if self.local_confirmed {
                    let s = self.current()?;
                    Ok(json!({"ready":true,"proof":s.proof("server-confirm")}))
                } else {
                    Ok(json!({"ready":false}))
                }
            }
            Wire::Grant { envelope } => {
                self.current()?;
                ensure!(
                    self.local_confirmed && self.remote_confirmed,
                    "Both users must confirm pairing"
                );
                self.purge_expired(crypto::now());
                ensure!(self.pending.len() < 8, "Too many pending transfers");
                let grant = self
                    .session
                    .as_mut()
                    .unwrap()
                    .decrypt(&envelope, crypto::now())?;
                let id = grant.id.clone();
                self.pending.push(grant);
                let proof = self.current()?.proof(&format!("grant-accepted:{id}"));
                Ok(json!({"pending":true,"id":id,"proof":proof}))
            }
        }
    }
    /// Drop expired plaintext grants promptly; Grant zeroizes its strings on drop.
    pub fn purge_expired(&mut self, timestamp: u64) {
        self.pending.retain(|grant| grant.expires >= timestamp);
    }
    pub fn confirm(&mut self) -> Result<()> {
        self.current()?;
        ensure!(
            crypto::now().saturating_sub(self.created) <= 120,
            "Pairing confirmation expired"
        );
        self.local_confirmed = true;
        Ok(())
    }
    pub fn status(&self) -> Value {
        let valid = self.session.is_some() && crypto::now().saturating_sub(self.created) <= 300;
        json!({"pairing": if valid {self.session.as_ref().map(|s|json!({"code":s.code,"peerFingerprint":s.peer_fingerprint,"localConfirmed":self.local_confirmed,"remoteConfirmed":self.remote_confirmed,"verified":self.local_confirmed&&self.remote_confirmed,"role":"receiver"}))} else {None},
          "incoming":self.pending.iter().filter(|g|g.expires>=crypto::now()).map(|g|json!({"id":g.id,"origin":g.origin,"expires":g.expires})).collect::<Vec<_>>()})
    }
    pub fn take(&mut self, id: &str) -> Result<Grant> {
        let index = self
            .pending
            .iter()
            .position(|g| g.id == id)
            .ok_or_else(|| anyhow!("Transfer not found"))?;
        let grant = self.pending.remove(index);
        ensure!(grant.expires >= crypto::now(), "Transfer expired");
        Ok(grant)
    }
    pub fn reject(&mut self, id: &str) -> Result<()> {
        let index = self
            .pending
            .iter()
            .position(|g| g.id == id)
            .ok_or_else(|| anyhow!("Transfer not found"))?;
        self.pending.remove(index);
        Ok(())
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use crate::crypto::{make_grant, Keypair};
    fn message(w: Wire) -> Vec<u8> {
        serde_json::to_vec(&w).unwrap()
    }
    fn response(s: &mut Server, w: Wire) -> Value {
        serde_json::from_slice(&s.process(&message(w))).unwrap()
    }
    #[test]
    fn eight_recipients_are_independently_verified_and_ciphertexts_do_not_cross() {
        let mut servers: Vec<Server> = Vec::new();
        let mut clients = Vec::new();
        for _ in 0..crate::peers::MAX_PEERS {
            let mut server = Server::default();
            let key = Keypair::new();
            let r = response(
                &mut server,
                Wire::Hello {
                    hello: key.hello.clone(),
                },
            );
            let hello: Hello = serde_json::from_value(r["data"]["hello"].clone()).unwrap();
            let client = key.establish(&hello, true).unwrap();
            assert_eq!(client.code, server.session.as_ref().unwrap().code);
            server.confirm().unwrap();
            let r = response(
                &mut server,
                Wire::Confirm {
                    proof: client.proof("client-confirm"),
                },
            );
            client
                .verify_proof("server-confirm", r["data"]["proof"].as_str().unwrap())
                .unwrap();
            servers.push(server);
            clients.push(client);
        }
        for i in 0..clients.len() {
            let g = make_grant(
                &clients[i],
                "https://example.org".into(),
                format!("user-{i}"),
                format!("secret-{i}"),
            )
            .unwrap();
            let encoded = serde_json::to_vec(&clients[i].encrypt(&g).unwrap()).unwrap();
            let other = (i + 1) % clients.len();
            assert_eq!(
                response(
                    &mut servers[other],
                    Wire::Grant {
                        envelope: serde_json::from_slice(&encoded).unwrap()
                    }
                )["ok"],
                false
            );
            let r = response(
                &mut servers[i],
                Wire::Grant {
                    envelope: serde_json::from_slice(&encoded).unwrap(),
                },
            );
            assert_eq!(r["ok"], true);
            clients[i]
                .verify_proof(
                    &format!("grant-accepted:{}", g.id),
                    r["data"]["proof"].as_str().unwrap(),
                )
                .unwrap();
            assert_eq!(
                response(
                    &mut servers[i],
                    Wire::Grant {
                        envelope: serde_json::from_slice(&encoded).unwrap()
                    }
                )["ok"],
                false
            );
            assert_eq!(
                servers[i].take(&g.id).unwrap().password,
                format!("secret-{i}")
            );
        }
    }
    #[test]
    fn receiver_pending_queue_is_bounded_at_eight() {
        let mut server = Server::default();
        let key = Keypair::new();
        let reply = response(
            &mut server,
            Wire::Hello {
                hello: key.hello.clone(),
            },
        );
        let hello: Hello = serde_json::from_value(reply["data"]["hello"].clone()).unwrap();
        let client = key.establish(&hello, true).unwrap();
        server.confirm().unwrap();
        response(
            &mut server,
            Wire::Confirm {
                proof: client.proof("client-confirm"),
            },
        );
        let mut ids = Vec::new();
        for _ in 0..8 {
            let grant = make_grant(
                &client,
                "https://example.org".into(),
                "synthetic".into(),
                "secret".into(),
            )
            .unwrap();
            let result = response(
                &mut server,
                Wire::Grant {
                    envelope: client.encrypt(&grant).unwrap(),
                },
            );
            assert_eq!(result["ok"], true);
            ids.push(grant.id.clone());
        }
        let extra = make_grant(
            &client,
            "https://example.org".into(),
            "synthetic".into(),
            "secret".into(),
        )
        .unwrap();
        let envelope = serde_json::to_vec(&client.encrypt(&extra).unwrap()).unwrap();
        assert_eq!(
            response(
                &mut server,
                Wire::Grant {
                    envelope: serde_json::from_slice(&envelope).unwrap()
                }
            )["ok"],
            false
        );
        server.reject(&ids[0]).unwrap();
        assert_eq!(
            response(
                &mut server,
                Wire::Grant {
                    envelope: serde_json::from_slice(&envelope).unwrap()
                }
            )["ok"],
            true
        );
    }
    #[test]
    fn expired_pending_grants_are_purged() {
        let client = Keypair::new();
        let server = Keypair::new();
        let session = client.establish(&server.hello, true).unwrap();
        let mut expired = make_grant(
            &session,
            "https://example.org".into(),
            "u".into(),
            "p".into(),
        )
        .unwrap();
        expired.expires = 2;
        let mut state = Server::default();
        state.pending.push(expired);
        state.purge_expired(3);
        assert!(state.pending.is_empty());
    }
    #[test]
    fn both_sides_must_confirm_and_replay_rejected() {
        let mut server = Server::default();
        let client = Keypair::new();
        let hello = client.hello.clone();
        let reply = response(&mut server, Wire::Hello { hello });
        let h: Hello = serde_json::from_value(reply["data"]["hello"].clone()).unwrap();
        let client = client.establish(&h, true).unwrap();
        assert_eq!(client.code, server.session.as_ref().unwrap().code);
        let grant = make_grant(
            &client,
            "https://example.org".into(),
            "u".into(),
            "p".into(),
        )
        .unwrap();
        let env = client.encrypt(&grant).unwrap();
        let cloned = serde_json::to_vec(&env).unwrap();
        assert_eq!(
            response(&mut server, Wire::Grant { envelope: env })["ok"],
            false
        );
        assert_eq!(
            response(
                &mut server,
                Wire::Confirm {
                    proof: client.proof("client-confirm")
                }
            )["data"]["ready"],
            false
        );
        server.confirm().unwrap();
        let r = response(
            &mut server,
            Wire::Confirm {
                proof: client.proof("client-confirm"),
            },
        );
        assert_eq!(r["data"]["ready"], true);
        client
            .verify_proof("server-confirm", r["data"]["proof"].as_str().unwrap())
            .unwrap();
        assert_eq!(
            response(
                &mut server,
                Wire::Grant {
                    envelope: serde_json::from_slice(&cloned).unwrap()
                }
            )["ok"],
            true
        );
        assert_eq!(
            response(
                &mut server,
                Wire::Grant {
                    envelope: serde_json::from_slice(&cloned).unwrap()
                }
            )["ok"],
            false
        );
        assert_eq!(server.take(&grant.id).unwrap().password, "p");
    }
}
