extern crate std;

use super::*;
use p256::ecdsa::{signature::hazmat::PrehashSigner, Signature as EcSig, SigningKey};
use soroban_sdk::{testutils::BytesN as _, vec, Bytes, BytesN, Env, IntoVal};
use std::{format, string::String};

fn b64url(data: &[u8]) -> String {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let mut s = String::new();
    for chunk in data.chunks(3) {
        let b = [chunk[0], *chunk.get(1).unwrap_or(&0), *chunk.get(2).unwrap_or(&0)];
        let n = (b[0] as u32) << 16 | (b[1] as u32) << 8 | b[2] as u32;
        for k in 0..=chunk.len() {
            s.push(T[((n >> (18 - 6 * k)) & 63) as usize] as char);
        }
    }
    s
}

fn sha256(env: &Env, d: &[u8]) -> [u8; 32] {
    env.crypto().sha256(&Bytes::from_slice(env, d)).to_array()
}

struct Setup {
    env: Env,
    wallet: soroban_sdk::Address,
    key: SigningKey,
}

fn setup() -> Setup {
    let env = Env::default();
    let key = SigningKey::from_bytes(&[7u8; 32].into()).unwrap();
    let point = key.verifying_key().to_encoded_point(false);
    let pk = BytesN::<65>::from_array(&env, point.as_bytes().try_into().unwrap());
    let wallet = env.register(PasskeyWallet, (pk,));
    Setup { env, wallet, key }
}

/// Build what a browser would return for `credentials.get({challenge})`.
fn assert_with(s: &Setup, challenge: &[u8; 32], ty: &str, flags: u8) -> Signature {
    let mut auth_data = [0u8; 37];
    auth_data[32] = flags;
    let client = format!(
        "{{\"type\":\"{ty}\",\"challenge\":\"{}\",\"origin\":\"https://ajochain.app\",\"crossOrigin\":false}}",
        b64url(challenge)
    );
    let mut msg = auth_data.to_vec();
    msg.extend_from_slice(&sha256(&s.env, client.as_bytes()));
    let sig: EcSig = s.key.sign_prehash(&sha256(&s.env, &msg)).unwrap();
    let sig = sig.normalize_s().unwrap_or(sig);
    Signature {
        authenticator_data: Bytes::from_slice(&s.env, &auth_data),
        client_data_json: Bytes::from_slice(&s.env, client.as_bytes()),
        signature: BytesN::from_array(&s.env, &sig.to_bytes().into()),
    }
}

fn check(s: &Setup, payload: &BytesN<32>, sig: Signature) -> Result<(), Result<Error, soroban_sdk::InvokeError>> {
    s.env.try_invoke_contract_check_auth::<Error>(&s.wallet, payload, sig.into_val(&s.env), &vec![&s.env])
}

#[test]
fn base64url_matches_reference() {
    for seed in 0u8..20 {
        let data: [u8; 32] = core::array::from_fn(|i| (i as u8).wrapping_mul(37).wrapping_add(seed.wrapping_mul(91)));
        let mut out = [0u8; 43];
        base64url_32(&data, &mut out);
        assert_eq!(core::str::from_utf8(&out).unwrap(), b64url(&data));
    }
}

#[test]
fn valid_passkey_signature_accepted() {
    let s = setup();
    let payload = BytesN::<32>::random(&s.env);
    let sig = assert_with(&s, &payload.to_array(), "webauthn.get", 0x05);
    assert_eq!(check(&s, &payload, sig), Ok(()));
}

#[test]
fn signature_for_other_payload_rejected() {
    let s = setup();
    let payload = BytesN::<32>::random(&s.env);
    let other = BytesN::<32>::random(&s.env);
    let sig = assert_with(&s, &other.to_array(), "webauthn.get", 0x05);
    assert_eq!(check(&s, &payload, sig), Err(Ok(Error::WrongChallenge)));
}

#[test]
fn wrong_type_and_missing_presence_rejected() {
    let s = setup();
    let payload = BytesN::<32>::random(&s.env);
    let sig = assert_with(&s, &payload.to_array(), "webauthn.create", 0x05);
    assert_eq!(check(&s, &payload, sig), Err(Ok(Error::WrongType)));
    let sig = assert_with(&s, &payload.to_array(), "webauthn.get", 0x04);
    assert_eq!(check(&s, &payload, sig), Err(Ok(Error::UserNotPresent)));
}

#[test]
fn tampered_signature_rejected() {
    let s = setup();
    let payload = BytesN::<32>::random(&s.env);
    let mut sig = assert_with(&s, &payload.to_array(), "webauthn.get", 0x05);
    // Signed by a different key.
    let other = Setup { env: s.env.clone(), wallet: s.wallet.clone(), key: SigningKey::from_bytes(&[9u8; 32].into()).unwrap() };
    sig.signature = assert_with(&other, &payload.to_array(), "webauthn.get", 0x05).signature;
    assert!(check(&s, &payload, sig).is_err());
}

#[test]
fn wallet_can_authorise_real_contract_calls() {
    // The token's `transfer` calls `from.require_auth()`, which routes to __check_auth.
    let s = setup();
    let admin = soroban_sdk::Address::generate(&s.env);
    let sac = s.env.register_stellar_asset_contract_v2(admin);
    let token = soroban_sdk::token::StellarAssetClient::new(&s.env, &sac.address());
    s.env.mock_all_auths();
    token.mint(&s.wallet, &100);
    assert_eq!(soroban_sdk::token::Client::new(&s.env, &sac.address()).balance(&s.wallet), 100);
    assert_eq!(PasskeyWalletClient::new(&s.env, &s.wallet).public_key().len(), 65);
}

use soroban_sdk::testutils::Address as _;
