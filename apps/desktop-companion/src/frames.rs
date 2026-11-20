use anyhow::{bail, ensure, Result};
const CHUNK: usize = 15;
pub const MAX_MESSAGE: usize = 12_000;
/// ATT payloads never exceed 20 bytes, including the five-byte fragment header.
pub fn fragment(data: &[u8]) -> Result<Vec<Vec<u8>>> {
    ensure!(
        !data.is_empty() && data.len() <= MAX_MESSAGE,
        "Invalid message size"
    );
    let total = data.len().div_ceil(CHUNK);
    ensure!(total <= u16::MAX as usize, "Too many fragments");
    Ok(data
        .chunks(CHUNK)
        .enumerate()
        .map(|(i, c)| {
            let mut f = vec![1, (i >> 8) as u8, i as u8, (total >> 8) as u8, total as u8];
            f.extend_from_slice(c);
            f
        })
        .collect())
}
#[derive(Default)]
pub struct Reassembler {
    next: usize,
    total: usize,
    buffer: Vec<u8>,
}
impl Reassembler {
    pub fn push(&mut self, frame: &[u8]) -> Result<Option<Vec<u8>>> {
        ensure!(
            (6..=20).contains(&frame.len()) && frame[0] == 1,
            "Invalid fragment"
        );
        let i = u16::from_be_bytes([frame[1], frame[2]]) as usize;
        let total = u16::from_be_bytes([frame[3], frame[4]]) as usize;
        ensure!(
            total > 0 && total <= MAX_MESSAGE.div_ceil(CHUNK),
            "Invalid fragment count"
        );
        if i == 0 {
            self.next = 0;
            self.total = total;
            self.buffer.clear();
        }
        ensure!(
            i == self.next && total == self.total,
            "Out-of-order fragment"
        );
        ensure!(
            i == total - 1 || frame.len() == 20,
            "Short intermediate fragment"
        );
        self.buffer.extend_from_slice(&frame[5..]);
        ensure!(self.buffer.len() <= MAX_MESSAGE, "Message too large");
        self.next += 1;
        if self.next == total {
            let out = std::mem::take(&mut self.buffer);
            self.next = 0;
            self.total = 0;
            return Ok(Some(out));
        }
        Ok(None)
    }
}
pub fn request_frame(index: usize) -> Result<Vec<u8>> {
    if index > u16::MAX as usize {
        bail!("Invalid frame index")
    }
    Ok(vec![2, (index >> 8) as u8, index as u8])
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn fragments_round_trip_and_reorder_rejected() {
        let data = vec![42; 451];
        let frames = fragment(&data).unwrap();
        assert!(frames.iter().all(|f| f.len() <= 20));
        let mut r = Reassembler::default();
        assert!(r.push(&frames[1]).is_err());
        let mut out = None;
        for f in frames {
            out = r.push(&f).unwrap();
        }
        assert_eq!(out.unwrap(), data);
        assert!(fragment(&vec![0; MAX_MESSAGE + 1]).is_err());
    }
}
