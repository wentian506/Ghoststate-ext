use aes_gcm::{
    aead::{Aead, KeyInit, Payload},
    Aes256Gcm, Nonce,
};
use anyhow::{anyhow, ensure, Result};
use base64::{engine::general_purpose::STANDARD, Engine};
use hkdf::Hkdf;
use hmac::{Hmac, Mac};
use rand::{rngs::OsRng, RngCore};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use x25519_dalek::{PublicKey, StaticSecret};
use zeroize::{Zeroize, ZeroizeOnDrop, Zeroizing};

type HmacSha256 = Hmac<Sha256>;
const DOMAIN: &[u8] = b"ghoststate/ble/v2";
const VERSION: u8 = 2;
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Hello {
    pub version: u8,
    pub public_key: String,
    pub nonce: String,
}
#[derive(Debug, Serialize, Deserialize, Zeroize, ZeroizeOnDrop)]
#[serde(deny_unknown_fields)]
pub struct Grant {
    pub version: u8,
    pub purpose: String,
    pub id: String,
    pub session: String,
    pub origin: String,
    pub username: String,
    pub password: String,
    pub issued: u64,
    pub expires: u64,
}
#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Envelope {
    pub version: u8,
    pub session: String,
    pub nonce: String,
    pub ciphertext: String,
}
pub struct Keypair {
    secret: StaticSecret,
    pub hello: Hello,
}
pub struct Session {
    key: Zeroizing<[u8; 32]>,
    confirmation_key: Zeroizing<[u8; 32]>,
    pub id: String,
    pub code: String,
    pub peer_fingerprint: String,
    seen: HashSet<String>,
}

pub fn now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}
fn b64(v: &[u8]) -> String {
    STANDARD.encode(v)
}
fn bytes<const N: usize>(s: &str) -> Result<[u8; N]> {
    ensure!(s.len() <= 8_000, "Invalid encoded field");
    let v = STANDARD.decode(s)?;
    v.try_into().map_err(|_| anyhow!("Invalid field length"))
}
impl Keypair {
    pub fn new() -> Self {
        let secret = StaticSecret::random_from_rng(OsRng);
        let public = PublicKey::from(&secret);
        let mut nonce = [0u8; 16];
        OsRng.fill_bytes(&mut nonce);
        Self {
            secret,
            hello: Hello {
                version: VERSION,
                public_key: b64(public.as_bytes()),
                nonce: b64(&nonce),
            },
        }
    }
    pub fn establish(self, other: &Hello, initiator: bool) -> Result<Session> {
        ensure!(other.version == VERSION, "Protocol version mismatch");
        let peer = PublicKey::from(bytes::<32>(&other.public_key)?);
        let peer_nonce = bytes::<16>(&other.nonce)?;
        let my_pub = bytes::<32>(&self.hello.public_key)?;
        let my_nonce = bytes::<16>(&self.hello.nonce)?;
        let shared = self.secret.diffie_hellman(&peer);
        ensure!(
            shared.as_bytes().iter().any(|x| *x != 0),
            "Invalid peer public key"
        );
        let (cp, sp, cn, sn) = if initiator {
            (my_pub, *peer.as_bytes(), my_nonce, peer_nonce)
        } else {
            (*peer.as_bytes(), my_pub, peer_nonce, my_nonce)
        };
        let mut hasher = Sha256::new();
        hasher.update(DOMAIN);
        hasher.update([VERSION]);
        hasher.update(cp);
        hasher.update(sp);
        hasher.update(cn);
        hasher.update(sn);
        let transcript = hasher.finalize();
        let hk = Hkdf::<Sha256>::new(Some(&transcript), shared.as_bytes());
        let mut key = Zeroizing::new([0u8; 32]);
        let mut confirmation_key = Zeroizing::new([0u8; 32]);
        let mut sas = [0u8; 8];
        hk.expand(b"ghoststate/v2/aes-gcm", &mut *key)
            .map_err(|_| anyhow!("KDF failure"))?;
        hk.expand(b"ghoststate/v2/confirmation-hmac", &mut *confirmation_key)
            .map_err(|_| anyhow!("KDF failure"))?;
        hk.expand(b"ghoststate/v2/sas", &mut sas)
            .map_err(|_| anyhow!("KDF failure"))?;
        let code = format!("{:08}", u64::from_be_bytes(sas) % 100_000_000);
        Ok(Session {
            key,
            confirmation_key,
            id: hex::encode(transcript),
            code,
            peer_fingerprint: hex::encode(Sha256::digest(peer.as_bytes()))[..16].to_string(),
            seen: HashSet::new(),
        })
    }
}
impl Session {
    pub fn proof(&self, role: &str) -> String {
        let mut h = <HmacSha256 as Mac>::new_from_slice(&*self.confirmation_key).expect("HMAC key");
        h.update(DOMAIN);
        h.update(role.as_bytes());
        h.update(self.id.as_bytes());
        b64(&h.finalize().into_bytes())
    }
    pub fn verify_proof(&self, role: &str, proof: &str) -> Result<()> {
        let bytes = STANDARD.decode(proof)?;
        let mut h = <HmacSha256 as Mac>::new_from_slice(&*self.confirmation_key).expect("HMAC key");
        h.update(DOMAIN);
        h.update(role.as_bytes());
        h.update(self.id.as_bytes());
        h.verify_slice(&bytes)
            .map_err(|_| anyhow!("Invalid confirmation proof"))
    }
    pub fn encrypt(&self, grant: &Grant) -> Result<Envelope> {
        ensure!(grant.session == self.id, "Session mismatch");
        let mut nonce = [0u8; 12];
        OsRng.fill_bytes(&mut nonce);
        let plain = Zeroizing::new(serde_json::to_vec(grant)?);
        let cipher = Aes256Gcm::new_from_slice(&*self.key).map_err(|_| anyhow!("Invalid key"))?;
        let aad = format!("ghoststate/v2/grant/{}", self.id);
        let ciphertext = cipher
            .encrypt(
                Nonce::from_slice(&nonce),
                Payload {
                    msg: &plain,
                    aad: aad.as_bytes(),
                },
            )
            .map_err(|_| anyhow!("Encryption failed"))?;
        Ok(Envelope {
            version: VERSION,
            session: self.id.clone(),
            nonce: b64(&nonce),
            ciphertext: b64(&ciphertext),
        })
    }
    pub fn decrypt(&mut self, env: &Envelope, timestamp: u64) -> Result<Grant> {
        ensure!(
            env.version == VERSION && env.session == self.id,
            "Session/version mismatch"
        );
        let nonce = bytes::<12>(&env.nonce)?;
        ensure!(env.ciphertext.len() <= 16_000, "Payload too large");
        let cipher = Aes256Gcm::new_from_slice(&*self.key).map_err(|_| anyhow!("Invalid key"))?;
        let aad = format!("ghoststate/v2/grant/{}", self.id);
        let plain = Zeroizing::new(
            cipher
                .decrypt(
                    Nonce::from_slice(&nonce),
                    Payload {
                        msg: &STANDARD.decode(&env.ciphertext)?,
                        aad: aad.as_bytes(),
                    },
                )
                .map_err(|_| anyhow!("Invalid authenticated payload"))?,
        );
        let grant: Grant = serde_json::from_slice(&plain)?;
        ensure!(
            grant.version == VERSION
                && grant.purpose == "credential-reauthentication"
                && grant.session == self.id,
            "Invalid grant purpose"
        );
        ensure!(
            grant.id.len() >= 20 && grant.id.len() <= 64 && !self.seen.contains(&grant.id),
            "Duplicate or invalid grant"
        );
        ensure!(self.seen.len() < 1024, "Replay cache full");
        self.seen.insert(grant.id.clone());
        ensure!(
            grant.issued <= timestamp + 5
                && grant.expires >= timestamp
                && grant.expires >= grant.issued
                && grant.expires - grant.issued <= 120,
            "Expired or invalid grant"
        );
        validate_origin(&grant.origin)?;
        ensure!(
            !grant.username.is_empty()
                && grant.username.len() <= 512
                && !grant.password.is_empty()
                && grant.password.len() <= 4096,
            "Invalid credential size"
        );
        Ok(grant)
    }
}
pub fn validate_origin(s: &str) -> Result<()> {
    let u = url::Url::parse(s)?;
    ensure!(
        u.username().is_empty() && u.password().is_none(),
        "Invalid origin"
    );
    let local = matches!(u.host_str(), Some("localhost") | Some("127.0.0.1"));
    ensure!(
        u.scheme() == "https" || (u.scheme() == "http" && local),
        "HTTPS origin required"
    );
    ensure!(
        u.origin().ascii_serialization() == s,
        "Expected an exact origin without a path"
    );
    Ok(())
}
pub fn make_grant(
    session: &Session,
    origin: String,
    username: String,
    password: String,
) -> Result<Grant> {
    validate_origin(&origin)?;
    ensure!(
        !username.is_empty()
            && username.len() <= 512
            && !password.is_empty()
            && password.len() <= 4096,
        "Invalid credential size"
    );
    let mut id = [0u8; 16];
    OsRng.fill_bytes(&mut id);
    let timestamp = now();
    Ok(Grant {
        version: VERSION,
        purpose: "credential-reauthentication".into(),
        id: b64(&id),
        session: session.id.clone(),
        origin,
        username,
        password,
        issued: timestamp,
        expires: timestamp + 120,
    })
}
#[cfg(test)]
mod tests {
    use super::*;
    fn pair() -> (Session, Session) {
        let a = Keypair::new();
        let b = Keypair::new();
        let ah = a.hello.clone();
        let bh = b.hello.clone();
        (
            a.establish(&bh, true).unwrap(),
            b.establish(&ah, false).unwrap(),
        )
    }
    #[test]
    fn handshake_and_proof() {
        let (a, b) = pair();
        assert_eq!(a.id, b.id);
        assert_eq!(a.code, b.code);
        assert_eq!(a.code.len(), 8);
        assert_ne!(*a.key, *a.confirmation_key);
        b.verify_proof("client-confirm", &a.proof("client-confirm"))
            .unwrap();
        assert!(b
            .verify_proof("server-confirm", &a.proof("client-confirm"))
            .is_err());
    }
    #[test]
    fn rejects_v1_hello_without_downgrade() {
        let client = Keypair::new();
        let mut old = Keypair::new().hello;
        old.version = 1;
        assert!(client.establish(&old, true).is_err());
    }
    #[test]
    fn encrypted_grant_replay_and_expiry() {
        let (a, mut b) = pair();
        let grant = make_grant(
            &a,
            "https://example.org".into(),
            "user".into(),
            "secret".into(),
        )
        .unwrap();
        let env = a.encrypt(&grant).unwrap();
        assert!(!env.ciphertext.contains("secret"));
        let decoded = b.decrypt(&env, now()).unwrap();
        assert_eq!(decoded.password, "secret");
        assert!(b.decrypt(&env, now()).is_err());
        let (a, mut b) = pair();
        let mut grant =
            make_grant(&a, "https://example.org".into(), "u".into(), "p".into()).unwrap();
        grant.issued = 1;
        grant.expires = 2;
        let env = a.encrypt(&grant).unwrap();
        assert!(b.decrypt(&env, now()).is_err());
    }
    #[test]
    fn ciphertext_tampering_and_wrong_purpose_are_rejected() {
        let (a, mut b) = pair();
        let grant = make_grant(&a, "https://example.org".into(), "u".into(), "p".into()).unwrap();
        let mut tampered = a.encrypt(&grant).unwrap();
        let mut ciphertext = STANDARD.decode(&tampered.ciphertext).unwrap();
        ciphertext[0] ^= 1;
        tampered.ciphertext = b64(&ciphertext);
        assert!(b.decrypt(&tampered, now()).is_err());
        // An invalid ciphertext must not prevent an intact message from being accepted.
        assert_eq!(
            b.decrypt(&a.encrypt(&grant).unwrap(), now())
                .unwrap()
                .password,
            "p"
        );
        let (a, mut b) = pair();
        let mut wrong_purpose =
            make_grant(&a, "https://example.org".into(), "u".into(), "p".into()).unwrap();
        wrong_purpose.purpose = "session-copy".into();
        assert!(b
            .decrypt(&a.encrypt(&wrong_purpose).unwrap(), now())
            .is_err());
    }
    #[test]
    fn reject_wrong_peer_tamper_and_invalid_origins() {
        let (a, _) = pair();
        let (_, mut wrong) = pair();
        let grant = make_grant(&a, "https://example.org".into(), "u".into(), "p".into()).unwrap();
        let mut env = a.encrypt(&grant).unwrap();
        assert!(wrong.decrypt(&env, now()).is_err());
        env.version = 1;
        let (_, mut another) = pair();
        assert!(another.decrypt(&env, now()).is_err());
        assert!(validate_origin("https://example.org/path").is_err());
        assert!(validate_origin("http://example.org").is_err());
        assert!(validate_origin("http://127.0.0.1:8080").is_ok());
    }
}
