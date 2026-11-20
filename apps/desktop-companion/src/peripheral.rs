//! Linux/BlueZ GATT adapter. The protocol state is shared with the Windows adapter.
use crate::{
    ble::{RX, SERVICE, TX},
    transport::TransportState,
};
use anyhow::{ensure, Result};
use bluer::{
    adv::Advertisement,
    gatt::local::{
        Application, ApplicationHandle, Characteristic, CharacteristicRead, CharacteristicWrite,
        CharacteristicWriteMethod, ReqError, Service,
    },
};
use futures::FutureExt;
use std::sync::Arc;
use tokio::sync::Mutex;

pub struct Listener {
    _advertisement: bluer::adv::AdvertisementHandle,
    _application: ApplicationHandle,
    _session: bluer::Session,
    _adapter: bluer::Adapter,
}
impl Listener {
    // BlueZ owns the advertisement handle until it is dropped. Radio loss still
    // requires a real-hardware test; this only reports that the handle is held.
    pub fn is_running(&self) -> bool {
        true
    }
}
pub async fn start(shared: Arc<Mutex<TransportState>>) -> Result<Listener> {
    let session = bluer::Session::new().await?;
    let adapter = session.default_adapter().await?;
    ensure!(
        adapter.is_powered().await?,
        "Bluetooth adapter is powered off"
    );
    let write_state = shared.clone();
    let read_state = shared;
    let application = Application {
        services: vec![Service {
            uuid: SERVICE,
            primary: true,
            characteristics: vec![
                Characteristic {
                    uuid: RX,
                    write: Some(CharacteristicWrite {
                        write: true,
                        method: CharacteristicWriteMethod::Fun(Box::new(move |value, req| {
                            let state = write_state.clone();
                            async move {
                                if req.offset != 0 {
                                    return Err(ReqError::InvalidOffset);
                                };
                                state
                                    .lock()
                                    .await
                                    .write(req.device_address.to_string(), &value)
                                    .map_err(|_| ReqError::Failed)
                            }
                            .boxed()
                        })),
                        ..Default::default()
                    }),
                    ..Default::default()
                },
                Characteristic {
                    uuid: TX,
                    read: Some(CharacteristicRead {
                        read: true,
                        fun: Box::new(move |req| {
                            let state = read_state.clone();
                            async move {
                                if req.offset != 0 {
                                    return Err(ReqError::InvalidOffset);
                                };
                                state
                                    .lock()
                                    .await
                                    .read(req.device_address.to_string())
                                    .map_err(|_| ReqError::Failed)
                            }
                            .boxed()
                        }),
                        ..Default::default()
                    }),
                    ..Default::default()
                },
            ],
            ..Default::default()
        }],
        ..Default::default()
    };
    let app = adapter.serve_gatt_application(application).await?;
    let adv = adapter
        .advertise(Advertisement {
            service_uuids: [SERVICE].into_iter().collect(),
            discoverable: Some(true),
            ..Default::default()
        })
        .await?;
    Ok(Listener {
        _advertisement: adv,
        _application: app,
        _session: session,
        _adapter: adapter,
    })
}
