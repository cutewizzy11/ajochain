//! Passkey smart wallet: a Soroban account contract controlled by a WebAuthn
//! (secp256r1) passkey — Face ID, fingerprint or a device PIN. No seed phrase.
//!
//! The wallet stores one P-256 public key. Any contract that calls
//! `wallet.require_auth()` (AjoChain, a token, ...) makes the host call
//! `__check_auth` here, which accepts the call only if it carries a WebAuthn
//! assertion over the exact authorization payload.
#![no_std]

use soroban_sdk::{
    auth::{Context, CustomAccountInterface},
    contract, contracterror, contractimpl, contracttype,
    crypto::Hash,
    symbol_short, Bytes, BytesN, Env, Symbol, Vec,
};

const PUBLIC_KEY: Symbol = symbol_short!("pk");
const MAX_CLIENT_DATA: usize = 1024;

#[contract]
pub struct PasskeyWallet;

/// What the browser's `navigator.credentials.get()` returns, repackaged.
#[contracttype]
#[derive(Clone)]
pub struct Signature {
    pub authenticator_data: Bytes,
    pub client_data_json: Bytes,
    /// Raw `r || s`, low-S normalised.
    pub signature: BytesN<64>,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Error {
    AuthDataTooShort = 1,
    UserNotPresent = 2,
    ClientDataTooLong = 3,
    WrongType = 4,
    WrongChallenge = 5,
}

#[contractimpl]
impl PasskeyWallet {
    /// `public_key` is the uncompressed P-256 point (0x04 || x || y).
    pub fn __constructor(env: Env, public_key: BytesN<65>) {
        env.storage().instance().set(&PUBLIC_KEY, &public_key);
    }

    pub fn public_key(env: Env) -> BytesN<65> {
        env.storage().instance().get(&PUBLIC_KEY).unwrap()
    }
}

#[contractimpl]
impl CustomAccountInterface for PasskeyWallet {
    type Signature = Signature;
    type Error = Error;

    fn __check_auth(
        env: Env,
        signature_payload: Hash<32>,
        sig: Signature,
        _auth_contexts: Vec<Context>,
    ) -> Result<(), Error> {
        // authenticatorData = rpIdHash(32) | flags(1) | signCount(4) | ...
        if sig.authenticator_data.len() < 37 {
            return Err(Error::AuthDataTooShort);
        }
        if sig.authenticator_data.get_unchecked(32) & 0x01 == 0 {
            return Err(Error::UserNotPresent);
        }

        let len = sig.client_data_json.len() as usize;
        if len > MAX_CLIENT_DATA {
            return Err(Error::ClientDataTooLong);
        }
        let mut buf = [0u8; MAX_CLIENT_DATA];
        sig.client_data_json.copy_into_slice(&mut buf[..len]);
        let client_data = &buf[..len];

        if !contains(client_data, b"\"type\":\"webauthn.get\"") {
            return Err(Error::WrongType);
        }
        // The passkey must have signed *this* payload: it is the WebAuthn challenge.
        let mut expected = [0u8; 13 + 43 + 1];
        expected[..13].copy_from_slice(b"\"challenge\":\"");
        base64url_32(&signature_payload.to_array(), &mut expected[13..56]);
        expected[56] = b'"';
        if !contains(client_data, &expected) {
            return Err(Error::WrongChallenge);
        }

        // WebAuthn signs sha256(authenticatorData || sha256(clientDataJSON)).
        let mut msg = sig.authenticator_data.clone();
        msg.extend_from_array(&env.crypto().sha256(&sig.client_data_json).to_array());
        let digest = env.crypto().sha256(&msg);

        let pk: BytesN<65> = env.storage().instance().get(&PUBLIC_KEY).unwrap();
        // Traps (rejecting the auth) if the signature is invalid.
        env.crypto().secp256r1_verify(&pk, &digest, &sig.signature);
        Ok(())
    }
}

fn contains(haystack: &[u8], needle: &[u8]) -> bool {
    haystack.windows(needle.len()).any(|w| w == needle)
}

/// Unpadded base64url of 32 bytes -> 43 chars.
fn base64url_32(input: &[u8; 32], out: &mut [u8]) {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let mut o = 0;
    let mut i = 0;
    while i + 3 <= 32 {
        let n = (input[i] as u32) << 16 | (input[i + 1] as u32) << 8 | input[i + 2] as u32;
        for shift in [18, 12, 6, 0] {
            out[o] = T[((n >> shift) & 63) as usize];
            o += 1;
        }
        i += 3;
    }
    // 2 bytes left -> 3 chars
    let n = (input[30] as u32) << 16 | (input[31] as u32) << 8;
    for shift in [18, 12, 6] {
        out[o] = T[((n >> shift) & 63) as usize];
        o += 1;
    }
}

#[cfg(test)]
mod test;
