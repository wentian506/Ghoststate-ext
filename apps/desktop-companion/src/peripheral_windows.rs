//! Experimental Windows GATT peripheral. Cross-compiled, but not yet radio-tested.
//! GATT events use the same bounded, peer-owned framing and protocol as BlueZ.
use crate::{
    ble::{RX, SERVICE, TX},
    transport::TransportState,
};
use anyhow::{anyhow, ensure, Result};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use std::time::Duration;
use tokio::sync::Mutex;
use windows::{
    core::GUID,
    Devices::Bluetooth::{
        BluetoothError,
        GenericAttributeProfile::{
            GattCharacteristicProperties, GattLocalCharacteristic,
            GattLocalCharacteristicParameters, GattProtectionLevel, GattReadRequestedEventArgs,
            GattServiceProvider, GattServiceProviderAdvertisementStatus,
            GattServiceProviderAdvertisingParameters, GattWriteOption, GattWriteRequestedEventArgs,
        },
    },
    Foundation::{Deferral, TypedEventHandler},
    Storage::Streams::{DataReader, DataWriter},
};

// ATT error 0x0e means the request could not be completed. Do not reflect details
// or secrets to a remote central. 0x07 is an invalid offset.
const UNLIKELY_ERROR: u8 = 0x0e;
const INVALID_OFFSET: u8 = 0x07;

struct CompleteOnDrop(Deferral);
impl Drop for CompleteOnDrop {
    fn drop(&mut self) {
        let _ = self.0.Complete();
    }
}

pub struct Listener {
    provider: GattServiceProvider,
    rx: GattLocalCharacteristic,
    tx: GattLocalCharacteristic,
    write_token: i64,
    read_token: i64,
    active: Arc<AtomicBool>,
}
impl Listener {
    pub fn is_running(&self) -> bool {
        self.active.load(Ordering::Acquire)
            && self.provider.AdvertisementStatus().ok()
                == Some(GattServiceProviderAdvertisementStatus::Started)
    }
}
impl Drop for Listener {
    fn drop(&mut self) {
        self.active.store(false, Ordering::Release);
        let _ = self.provider.StopAdvertising();
        let _ = self.rx.RemoveWriteRequested(self.write_token);
        let _ = self.tx.RemoveReadRequested(self.read_token);
    }
}

async fn write_request(
    args: GattWriteRequestedEventArgs,
    state: Arc<Mutex<TransportState>>,
    active: Arc<AtomicBool>,
) -> Result<()> {
    let request = args.GetRequestAsync()?.await?;
    let respond = request.Option()? == GattWriteOption::WriteWithResponse;
    if request.Offset()? != 0 {
        if respond {
            let _ = request.RespondWithProtocolError(INVALID_OFFSET);
        }
        return Err(anyhow!("Invalid write offset"));
    }
    let attempt: Result<()> = async {
        ensure!(active.load(Ordering::Acquire), "Listener stopped");
        // The OS session identifies the requesting central; never accept a caller-supplied ID.
        let owner = args.Session()?.DeviceId()?.Id()?.to_string();
        ensure!(!owner.is_empty() && owner.len() <= 1024, "Invalid BLE peer");
        // IBuffer is not Send; consume it before awaiting the shared-state lock.
        let bytes = {
            let value = request.Value()?;
            let length = value.Length()? as usize;
            ensure!((1..=20).contains(&length), "Invalid BLE frame size");
            let reader = DataReader::FromBuffer(&value)?;
            let mut bytes = vec![0u8; length];
            reader.ReadBytes(&mut bytes)?;
            bytes
        };
        let mut shared = state.lock().await;
        ensure!(active.load(Ordering::Acquire), "Listener stopped");
        shared.write(owner, &bytes)
    }
    .await;
    if respond {
        if attempt.is_ok() {
            request.Respond()?;
        } else {
            let _ = request.RespondWithProtocolError(UNLIKELY_ERROR);
        }
    }
    attempt
}

async fn read_request(
    args: GattReadRequestedEventArgs,
    state: Arc<Mutex<TransportState>>,
    active: Arc<AtomicBool>,
) -> Result<()> {
    let request = args.GetRequestAsync()?.await?;
    if request.Offset()? != 0 {
        let _ = request.RespondWithProtocolError(INVALID_OFFSET);
        return Err(anyhow!("Invalid read offset"));
    }
    let attempt: Result<()> = async {
        ensure!(active.load(Ordering::Acquire), "Listener stopped");
        let owner = args.Session()?.DeviceId()?.Id()?.to_string();
        ensure!(!owner.is_empty() && owner.len() <= 1024, "Invalid BLE peer");
        let shared = state.lock().await;
        ensure!(active.load(Ordering::Acquire), "Listener stopped");
        let bytes = shared.read(owner)?;
        ensure!(
            bytes.len() <= request.Length()? as usize,
            "Peer read buffer too small"
        );
        let writer = DataWriter::new()?;
        writer.WriteBytes(&bytes)?;
        request.RespondWithValue(&writer.DetachBuffer()?)?;
        Ok(())
    }
    .await;
    if attempt.is_err() {
        let _ = request.RespondWithProtocolError(UNLIKELY_ERROR);
    }
    attempt
}

pub async fn start(state: Arc<Mutex<TransportState>>) -> Result<Listener> {
    let result = GattServiceProvider::CreateAsync(GUID::from_u128(SERVICE.as_u128()))?.await?;
    ensure!(
        result.Error()? == BluetoothError::Success,
        "Windows could not create the Bluetooth service: {:?}",
        result.Error()?
    );
    let provider = result.ServiceProvider()?;
    let service = provider.Service()?;

    let write_params = GattLocalCharacteristicParameters::new()?;
    write_params.SetCharacteristicProperties(GattCharacteristicProperties::Write)?;
    write_params.SetWriteProtectionLevel(GattProtectionLevel::Plain)?;
    let write_result = service
        .CreateCharacteristicAsync(GUID::from_u128(RX.as_u128()), &write_params)?
        .await?;
    ensure!(
        write_result.Error()? == BluetoothError::Success,
        "Windows could not create the Bluetooth write characteristic"
    );
    let rx = write_result.Characteristic()?;

    let read_params = GattLocalCharacteristicParameters::new()?;
    read_params.SetCharacteristicProperties(GattCharacteristicProperties::Read)?;
    read_params.SetReadProtectionLevel(GattProtectionLevel::Plain)?;
    let read_result = service
        .CreateCharacteristicAsync(GUID::from_u128(TX.as_u128()), &read_params)?
        .await?;
    ensure!(
        read_result.Error()? == BluetoothError::Success,
        "Windows could not create the Bluetooth read characteristic"
    );
    let tx = read_result.Characteristic()?;

    let active = Arc::new(AtomicBool::new(true));
    let handle = tokio::runtime::Handle::current();
    let write_state = state.clone();
    let write_active = active.clone();
    let write_token = rx.WriteRequested(&TypedEventHandler::<
        GattLocalCharacteristic,
        GattWriteRequestedEventArgs,
    >::new(move |_sender, args| {
        let Some(args) = args.cloned() else {
            return Ok(());
        };
        let deferral = args.GetDeferral()?;
        let state = write_state.clone();
        let active = write_active.clone();
        handle.spawn(async move {
            let _complete = CompleteOnDrop(deferral);
            let _ = write_request(args, state, active).await;
        });
        Ok(())
    }))?;
    let handle = tokio::runtime::Handle::current();
    let read_active = active.clone();
    let read_token = tx.ReadRequested(&TypedEventHandler::<
        GattLocalCharacteristic,
        GattReadRequestedEventArgs,
    >::new(move |_sender, args| {
        let Some(args) = args.cloned() else {
            return Ok(());
        };
        let deferral = args.GetDeferral()?;
        let state = state.clone();
        let active = read_active.clone();
        handle.spawn(async move {
            let _complete = CompleteOnDrop(deferral);
            let _ = read_request(args, state, active).await;
        });
        Ok(())
    }))?;
    let listener = Listener {
        provider,
        rx,
        tx,
        write_token,
        read_token,
        active,
    };
    let advertising = GattServiceProviderAdvertisingParameters::new()?;
    advertising.SetIsConnectable(true)?;
    advertising.SetIsDiscoverable(true)?;
    listener
        .provider
        .StartAdvertisingWithParameters(&advertising)?;
    // Windows reports advertising asynchronously. A partial advertisement may omit
    // the service UUID that GhostState discovery filters on, so fail closed.
    for _ in 0..50 {
        match listener.provider.AdvertisementStatus()? {
            GattServiceProviderAdvertisementStatus::Started => return Ok(listener),
            GattServiceProviderAdvertisementStatus::Aborted => return Err(anyhow!("Windows stopped Bluetooth advertising. Check the adapter, Bluetooth permissions and peripheral-role support.")),
            GattServiceProviderAdvertisementStatus::StartedWithoutAllAdvertisementData => return Err(anyhow!("Windows could not advertise the complete GhostState service UUID.")),
            _ => tokio::time::sleep(Duration::from_millis(100)).await,
        }
    }
    Err(anyhow!("Windows did not confirm Bluetooth advertising. Check that Bluetooth is on and this adapter supports the peripheral role."))
}
