// Throwaway crypto byte-compat probe for the codex-raw-autoconnect spike (Direction B).
// Goal: prove a Rust client can produce/consume the EXACT byte layouts that
// packages/happy-cli/src/api/encryption.ts produces/consumes, using mature
// RustCrypto crates. Cross-checked against the real encryption.ts via Node.
//
// Modes:
//   cryptocompat emit               -> prints `key=hex` lines of Rust-produced artifacts
//   cryptocompat verify <node.txt>  -> reads Node-produced artifacts, decrypts/verifies

use aes_gcm::aead::generic_array::GenericArray;
use aes_gcm::aead::Aead as GcmAead;
use aes_gcm::{Aes256Gcm, KeyInit as GcmKeyInit};
use crypto_box::aead::Aead as BoxAead;
use crypto_box::{PublicKey, SalsaBox, SecretKey};
use ed25519_dalek::{Signature, Signer, SigningKey, Verifier, VerifyingKey};
use sha2::{Digest, Sha512};
use xsalsa20poly1305::aead::Aead as SbAead;
use xsalsa20poly1305::{KeyInit as SbKeyInit, XSalsa20Poly1305};

// ---- Fixed test vectors (MUST match crosscheck.mts) ----
fn seed() -> [u8; 32] {
    let mut s = [0u8; 32];
    for i in 0..32 {
        s[i] = (i as u8).wrapping_add(1);
    }
    s
}
fn key_data() -> [u8; 32] {
    let mut s = [0u8; 32];
    for i in 0..32 {
        s[i] = ((i * 7 + 3) & 0xff) as u8;
    }
    s
}
fn key_legacy() -> [u8; 32] {
    let mut s = [0u8; 32];
    for i in 0..32 {
        s[i] = ((i * 5 + 1) & 0xff) as u8;
    }
    s
}
fn challenge() -> [u8; 32] {
    let mut s = [0u8; 32];
    for i in 0..32 {
        s[i] = ((i * 3 + 9) & 0xff) as u8;
    }
    s
}
const PLAINTEXT: &str = "{\"hello\":\"world\",\"n\":42}";

// ---- Primitives mirroring encryption.ts ----

// libsodiumPublicKeyFromSecretKey: pub = X25519_base( sha512(seed)[0:32] )
fn derive_x25519_pub(seed: &[u8]) -> [u8; 32] {
    let h = Sha512::digest(seed);
    let mut sk = [0u8; 32];
    sk.copy_from_slice(&h[0..32]);
    let secret = SecretKey::from(sk);
    *secret.public_key().as_bytes()
}

// libsodiumEncryptForPublicKey: bundle = ephPub(32) || nonce(24) || box(pt,nonce,recipientPub,ephSecret)
fn seal_for_pub(pt: &[u8], recipient_pub: &[u8; 32]) -> Vec<u8> {
    let eph_secret = SecretKey::from([0x11u8; 32]);
    let eph_pub = eph_secret.public_key();
    let recipient = PublicKey::from(*recipient_pub);
    let sbox = SalsaBox::new(&recipient, &eph_secret);
    let nonce_bytes = [0x22u8; 24];
    let nonce = GenericArray::from_slice(&nonce_bytes);
    let ct = sbox.encrypt(nonce, pt).expect("box encrypt");
    let mut out = Vec::with_capacity(32 + 24 + ct.len());
    out.extend_from_slice(eph_pub.as_bytes());
    out.extend_from_slice(&nonce_bytes);
    out.extend_from_slice(&ct);
    out
}

fn open_sealed(bundle: &[u8], seed: &[u8]) -> Vec<u8> {
    let h = Sha512::digest(seed);
    let mut sk = [0u8; 32];
    sk.copy_from_slice(&h[0..32]);
    let secret = SecretKey::from(sk);
    let mut eph = [0u8; 32];
    eph.copy_from_slice(&bundle[0..32]);
    let eph_pub = PublicKey::from(eph);
    let nonce = GenericArray::from_slice(&bundle[32..56]);
    let ct = &bundle[56..];
    let sbox = SalsaBox::new(&eph_pub, &secret);
    sbox.decrypt(nonce, ct).expect("box decrypt")
}

// encryptLegacy: bundle = nonce(24) || secretbox(pt, nonce, key)
fn secretbox_seal(pt: &[u8], key: &[u8; 32]) -> Vec<u8> {
    let cipher = XSalsa20Poly1305::new(GenericArray::from_slice(key));
    let nonce_bytes = [0x33u8; 24];
    let nonce = GenericArray::from_slice(&nonce_bytes);
    let ct = cipher.encrypt(nonce, pt).expect("secretbox encrypt");
    let mut out = Vec::with_capacity(24 + ct.len());
    out.extend_from_slice(&nonce_bytes);
    out.extend_from_slice(&ct);
    out
}
fn secretbox_open(bundle: &[u8], key: &[u8; 32]) -> Vec<u8> {
    let cipher = XSalsa20Poly1305::new(GenericArray::from_slice(key));
    let nonce = GenericArray::from_slice(&bundle[0..24]);
    cipher.decrypt(nonce, &bundle[24..]).expect("secretbox decrypt")
}

// encryptWithDataKey: bundle = version(1=0) || nonce(12) || ct || tag(16)  [aes-256-gcm encrypt returns ct||tag]
fn aesgcm_seal(pt: &[u8], key: &[u8; 32]) -> Vec<u8> {
    let cipher = Aes256Gcm::new(GenericArray::from_slice(key));
    let nonce_bytes = [0x44u8; 12];
    let nonce = GenericArray::from_slice(&nonce_bytes);
    let ct = cipher.encrypt(nonce, pt).expect("gcm encrypt");
    let mut out = Vec::with_capacity(1 + 12 + ct.len());
    out.push(0u8);
    out.extend_from_slice(&nonce_bytes);
    out.extend_from_slice(&ct);
    out
}
fn aesgcm_open(bundle: &[u8], key: &[u8; 32]) -> Vec<u8> {
    assert_eq!(bundle[0], 0, "version byte");
    let cipher = Aes256Gcm::new(GenericArray::from_slice(key));
    let nonce = GenericArray::from_slice(&bundle[1..13]);
    cipher.decrypt(nonce, &bundle[13..]).expect("gcm decrypt")
}

fn emit() {
    let seed = seed();
    let pub_x = derive_x25519_pub(&seed);
    let sk = SigningKey::from_bytes(&seed);
    let ed_pub = sk.verifying_key();
    let chal = challenge();
    let sig = sk.sign(&chal);

    let datakey_bundle = aesgcm_seal(PLAINTEXT.as_bytes(), &key_data());
    let legacy_bundle = secretbox_seal(PLAINTEXT.as_bytes(), &key_legacy());
    let sealed_bundle = seal_for_pub(PLAINTEXT.as_bytes(), &pub_x);

    println!("x25519_pub={}", hex::encode(pub_x));
    println!("ed25519_pub={}", hex::encode(ed_pub.to_bytes()));
    println!("datakey_bundle={}", hex::encode(datakey_bundle));
    println!("legacy_bundle={}", hex::encode(legacy_bundle));
    println!("sealed_bundle={}", hex::encode(sealed_bundle));
    println!("ed25519_sig={}", hex::encode(sig.to_bytes()));
    println!("challenge={}", hex::encode(chal));
    println!("plaintext={}", hex::encode(PLAINTEXT.as_bytes()));
}

fn parse_lines(path: &str) -> std::collections::HashMap<String, Vec<u8>> {
    let content = std::fs::read_to_string(path).expect("read node file");
    let mut map = std::collections::HashMap::new();
    for line in content.lines() {
        let line = line.trim();
        if let Some((k, v)) = line.split_once('=') {
            if let Ok(bytes) = hex::decode(v.trim()) {
                map.insert(k.trim().to_string(), bytes);
            }
        }
    }
    map
}

fn verify(path: &str) {
    let m = parse_lines(path);
    let seed = seed();
    let mut pass = true;

    // 1. pubkey derivation parity
    let our_pub = derive_x25519_pub(&seed);
    let node_pub = m.get("x25519_pub").expect("node x25519_pub");
    let ok = our_pub.as_slice() == node_pub.as_slice();
    println!("[verify] x25519_pub_match: {}", if ok { "PASS" } else { "FAIL" });
    pass &= ok;

    // ed25519 pub parity
    let ed_pub = SigningKey::from_bytes(&seed).verifying_key();
    let node_ed = m.get("ed25519_pub").expect("node ed25519_pub");
    let ok = ed_pub.to_bytes().as_slice() == node_ed.as_slice();
    println!("[verify] ed25519_pub_match: {}", if ok { "PASS" } else { "FAIL" });
    pass &= ok;

    // 2. decrypt node dataKey bundle
    let dk = aesgcm_open(m.get("datakey_bundle").expect("datakey"), &key_data());
    let ok = dk == PLAINTEXT.as_bytes();
    println!("[verify] node_datakey_decrypt: {} ({:?})", if ok { "PASS" } else { "FAIL" }, String::from_utf8_lossy(&dk));
    pass &= ok;

    // 3. decrypt node legacy bundle
    let lg = secretbox_open(m.get("legacy_bundle").expect("legacy"), &key_legacy());
    let ok = lg == PLAINTEXT.as_bytes();
    println!("[verify] node_legacy_decrypt: {} ({:?})", if ok { "PASS" } else { "FAIL" }, String::from_utf8_lossy(&lg));
    pass &= ok;

    // 4. open node sealed bundle
    let sl = open_sealed(m.get("sealed_bundle").expect("sealed"), &seed);
    let ok = sl == PLAINTEXT.as_bytes();
    println!("[verify] node_sealed_open: {} ({:?})", if ok { "PASS" } else { "FAIL" }, String::from_utf8_lossy(&sl));
    pass &= ok;

    // 5. verify node ed25519 signature over the challenge
    let chal = m.get("challenge").expect("challenge");
    let sig_bytes = m.get("ed25519_sig").expect("sig");
    let vk = VerifyingKey::from_bytes(&{ let mut a = [0u8; 32]; a.copy_from_slice(node_ed); a }).expect("vk");
    let sig = Signature::from_slice(sig_bytes).expect("sig parse");
    let ok = vk.verify(chal, &sig).is_ok();
    println!("[verify] node_ed25519_verify: {}", if ok { "PASS" } else { "FAIL" });
    pass &= ok;

    println!("[verify] OVERALL: {}", if pass { "PASS" } else { "FAIL" });
    if !pass {
        std::process::exit(1);
    }
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    match args.get(1).map(String::as_str) {
        Some("emit") => emit(),
        Some("verify") => verify(args.get(2).expect("node file path")),
        _ => {
            eprintln!("usage: cryptocompat <emit|verify <file>>");
            std::process::exit(2);
        }
    }
}
