//! Bounded sender-side connections. Peer handles are routing identifiers, not identities.
use anyhow::{ensure, Result};
use std::collections::BTreeMap;

pub const MAX_PEERS: usize = 8;

pub struct PeerSlots<T> {
    entries: BTreeMap<String, T>,
}
impl<T> Default for PeerSlots<T> {
    fn default() -> Self {
        Self {
            entries: BTreeMap::new(),
        }
    }
}
impl<T> PeerSlots<T> {
    pub fn ensure_available(&self, id: &str) -> Result<()> {
        ensure!(!id.is_empty() && id.len() <= 256, "Invalid device ID");
        ensure!(
            !self.entries.contains_key(id),
            "This device is already paired"
        );
        ensure!(
            self.entries.len() < MAX_PEERS,
            "Maximum of eight sender connections reached"
        );
        Ok(())
    }
    pub fn insert(&mut self, id: String, client: T) -> Result<()> {
        self.ensure_available(&id)?;
        self.entries.insert(id, client);
        Ok(())
    }
    pub fn get_mut(&mut self, id: &str) -> Option<&mut T> {
        self.entries.get_mut(id)
    }
    pub fn remove(&mut self, id: &str) -> Option<T> {
        self.entries.remove(id)
    }
    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }
    pub fn iter(&self) -> impl Iterator<Item = (&String, &T)> {
        self.entries.iter()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn independent_peer_routing_is_bounded_and_explicit() {
        let mut peers = PeerSlots::default();
        for n in 0..MAX_PEERS {
            peers.insert(format!("peer-{n}"), n).unwrap();
        }
        assert!(peers.insert("ninth".into(), 9).is_err());
        assert!(peers.insert("peer-0".into(), 99).is_err());
        assert!(peers.get_mut("missing").is_none());
        assert_eq!(*peers.get_mut("peer-4").unwrap(), 4);
        assert_eq!(peers.remove("peer-4"), Some(4));
        assert!(peers.get_mut("peer-4").is_none());
        assert_eq!(*peers.get_mut("peer-3").unwrap(), 3);
        peers.insert("new-peer".into(), 44).unwrap();
        assert_eq!(peers.iter().count(), MAX_PEERS);
    }
}
