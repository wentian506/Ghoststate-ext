//! Shared framed GATT receiver state. Platform adapters must supply a stable peer ID.
use crate::{
    frames::{fragment, Reassembler},
    protocol::Server,
};
use anyhow::{anyhow, ensure, Result};

#[derive(Default)]
pub struct TransportState {
    pub server: Server,
    owner: Option<String>,
    input: Reassembler,
    outgoing: Vec<Vec<u8>>,
    current: Vec<u8>,
}
impl TransportState {
    pub fn write(&mut self, owner: String, value: &[u8]) -> Result<()> {
        ensure!(
            !owner.is_empty() && owner.len() <= 1024,
            "Invalid peer identity"
        );
        let new_owner = self.owner.is_none();
        if let Some(existing) = &self.owner {
            ensure!(existing == &owner, "Listener is in use");
        } else {
            ensure!(
                value.first() == Some(&1) && value.get(1..3) == Some(&[0, 0]),
                "Expected initial fragment"
            );
        }
        match value.first() {
            Some(1) => {
                let data = self.input.push(value)?;
                // A malformed first frame must not reserve the receiver forever.
                if new_owner {
                    self.owner = Some(owner);
                }
                if let Some(data) = data {
                    let response = self.server.process(&data);
                    self.outgoing = fragment(&response)?;
                    self.current.clear();
                }
                Ok(())
            }
            Some(2) => {
                ensure!(value.len() == 3, "Invalid read control");
                let index = u16::from_be_bytes([value[1], value[2]]) as usize;
                self.current = self
                    .outgoing
                    .get(index)
                    .ok_or_else(|| anyhow!("Invalid response frame"))?
                    .clone();
                Ok(())
            }
            _ => Err(anyhow!("Unknown fragment")),
        }
    }
    pub fn read(&self, owner: String) -> Result<Vec<u8>> {
        ensure!(
            self.owner.as_ref() == Some(&owner) && !self.current.is_empty(),
            "No response for this peer"
        );
        Ok(self.current.clone())
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        crypto::{make_grant, Hello, Keypair},
        frames::{fragment, request_frame, Reassembler},
        protocol::Wire,
    };
    use serde_json::Value;
    fn exchange(t: &mut TransportState, w: Wire) -> Value {
        let bytes = serde_json::to_vec(&w).unwrap();
        for f in fragment(&bytes).unwrap() {
            t.write("peer-A".into(), &f).unwrap();
        }
        let mut r = Reassembler::default();
        let mut i = 0;
        loop {
            t.write("peer-A".into(), &request_frame(i).unwrap())
                .unwrap();
            let f = t.read("peer-A".into()).unwrap();
            if let Some(v) = r.push(&f).unwrap() {
                return serde_json::from_slice(&v).unwrap();
            }
            i += 1;
        }
    }
    #[test]
    fn invalid_initial_fragment_does_not_reserve_receiver() {
        let mut t = TransportState::default();
        assert!(t.write("bad".into(), &[1, 0, 0]).is_err());
        assert!(t.write("bad".into(), &[1, 0, 1, 0, 2, 0]).is_err());
        let frames = fragment(
            &serde_json::to_vec(&Wire::Hello {
                hello: Keypair::new().hello,
            })
            .unwrap(),
        )
        .unwrap();
        for f in frames {
            t.write("good".into(), &f).unwrap();
        }
        assert!(t.read("bad".into()).is_err());
        assert!(t.write("bad".into(), &request_frame(0).unwrap()).is_err());
        assert!(t.write("good".into(), &request_frame(0).unwrap()).is_ok());
        assert!(t.read("good".into()).is_ok());
    }
    #[test]
    fn framed_ble_protocol_pairing_and_transfer_without_hardware() {
        let mut t = TransportState::default();
        let key = Keypair::new();
        let hello = key.hello.clone();
        let r = exchange(&mut t, Wire::Hello { hello });
        let remote: Hello = serde_json::from_value(r["data"]["hello"].clone()).unwrap();
        let session = key.establish(&remote, true).unwrap();
        assert_eq!(session.code, t.server.session.as_ref().unwrap().code);
        assert!(t.read("other-peer".into()).is_err());
        assert!(t
            .write("other-peer".into(), &request_frame(0).unwrap())
            .is_err());
        t.server.confirm().unwrap();
        let r = exchange(
            &mut t,
            Wire::Confirm {
                proof: session.proof("client-confirm"),
            },
        );
        session
            .verify_proof("server-confirm", r["data"]["proof"].as_str().unwrap())
            .unwrap();
        let grant = make_grant(
            &session,
            "https://example.org".into(),
            "synthetic".into(),
            "secret".into(),
        )
        .unwrap();
        let r = exchange(
            &mut t,
            Wire::Grant {
                envelope: session.encrypt(&grant).unwrap(),
            },
        );
        assert_eq!(r["data"]["pending"], true);
        session
            .verify_proof(
                &format!("grant-accepted:{}", grant.id),
                r["data"]["proof"].as_str().unwrap(),
            )
            .unwrap();
        assert_eq!(t.server.take(&grant.id).unwrap().password, "secret");
    }
}
