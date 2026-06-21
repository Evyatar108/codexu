// Throwaway cross-check for the codex-raw-autoconnect crypto byte-compat probe.
// Run with: npx tsx crosscheck.mts   (cwd = the cryptocompat investigation dir)
//
// 1. EMIT node-produced artifacts (via the REAL encryption.ts) to node_out.txt
// 2. VERIFY rust_out.txt (decrypt Rust bundles with node/tweetnacl, compare keys)
//
// Fixed vectors MUST match cryptocompat/src/main.rs.

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import tweetnacl from 'tweetnacl';
import {
  libsodiumPublicKeyFromSecretKey,
  libsodiumEncryptForPublicKey,
  encryptLegacy,
  decryptLegacy,
  encryptWithDataKey,
  decryptWithDataKey,
} from '../../../../packages/happy-cli/src/api/encryption';

const seed = new Uint8Array(32);
for (let i = 0; i < 32; i++) seed[i] = (i + 1) & 0xff;
const keyData = new Uint8Array(32);
for (let i = 0; i < 32; i++) keyData[i] = (i * 7 + 3) & 0xff;
const keyLegacy = new Uint8Array(32);
for (let i = 0; i < 32; i++) keyLegacy[i] = (i * 5 + 1) & 0xff;
const challenge = new Uint8Array(32);
for (let i = 0; i < 32; i++) challenge[i] = (i * 3 + 9) & 0xff;

const PLAINTEXT_OBJ = { hello: 'world', n: 42 };
const PLAINTEXT_STR = '{"hello":"world","n":42}';

const hex = (u: Uint8Array) => Buffer.from(u).toString('hex');
const unhex = (s: string) => new Uint8Array(Buffer.from(s.trim(), 'hex'));

// ---------- EMIT ----------
function emit() {
  const x25519Pub = libsodiumPublicKeyFromSecretKey(seed);
  const signKp = tweetnacl.sign.keyPair.fromSeed(seed);
  const edPub = signKp.publicKey;
  const sig = tweetnacl.sign.detached(challenge, signKp.secretKey);

  const datakey = encryptWithDataKey(PLAINTEXT_OBJ, keyData);
  const legacy = encryptLegacy(PLAINTEXT_OBJ, keyLegacy);
  const sealed = libsodiumEncryptForPublicKey(new TextEncoder().encode(PLAINTEXT_STR), x25519Pub);

  const lines = [
    `x25519_pub=${hex(x25519Pub)}`,
    `ed25519_pub=${hex(edPub)}`,
    `datakey_bundle=${hex(datakey)}`,
    `legacy_bundle=${hex(legacy)}`,
    `sealed_bundle=${hex(sealed)}`,
    `ed25519_sig=${hex(sig)}`,
    `challenge=${hex(challenge)}`,
    `plaintext=${hex(new TextEncoder().encode(PLAINTEXT_STR))}`,
  ];
  writeFileSync('node_out.txt', lines.join('\n') + '\n');
  console.log('[emit] wrote node_out.txt');
}

// ---------- VERIFY rust_out.txt ----------
function verify() {
  const m = new Map<string, Uint8Array>();
  const raw = new Map<string, string>();
  for (const line of readFileSync('rust_out.txt', 'utf8').split('\n')) {
    const t = line.trim();
    const eq = t.indexOf('=');
    if (eq <= 0) continue;
    const k = t.slice(0, eq).trim();
    const v = t.slice(eq + 1).trim();
    raw.set(k, v);
    try { m.set(k, unhex(v)); } catch {}
  }

  let pass = true;
  const check = (name: string, ok: boolean, extra = '') => {
    pass = pass && ok;
    console.log(`[verify] ${name}: ${ok ? 'PASS' : 'FAIL'}${extra ? ' ' + extra : ''}`);
  };

  // 1. pubkey derivation parity (the libsodium sha512(seed)[0:32] quirk)
  const ourPub = libsodiumPublicKeyFromSecretKey(seed);
  check('x25519_pub_match', raw.get('x25519_pub') === hex(ourPub));

  const ourEd = tweetnacl.sign.keyPair.fromSeed(seed).publicKey;
  check('ed25519_pub_match', raw.get('ed25519_pub') === hex(ourEd));

  // 2. decrypt rust dataKey bundle with the REAL decryptWithDataKey
  const dk = decryptWithDataKey(m.get('datakey_bundle')!, keyData);
  check('rust_datakey_decrypt', JSON.stringify(dk) === PLAINTEXT_STR, JSON.stringify(dk));

  // 3. decrypt rust legacy bundle
  const lg = decryptLegacy(m.get('legacy_bundle')!, keyLegacy);
  check('rust_legacy_decrypt', JSON.stringify(lg) === PLAINTEXT_STR, JSON.stringify(lg));

  // 4. open rust sealed bundle via tweetnacl.box.open + seed-derived secret
  const secret = new Uint8Array(createHash('sha512').update(seed).digest()).slice(0, 32);
  const sealed = m.get('sealed_bundle')!;
  const ephPub = sealed.slice(0, 32);
  const nonce = sealed.slice(32, 56);
  const ct = sealed.slice(56);
  const opened = tweetnacl.box.open(ct, nonce, ephPub, secret);
  const openedStr = opened ? new TextDecoder().decode(opened) : '<null>';
  check('rust_sealed_open', openedStr === PLAINTEXT_STR, openedStr);

  // 5. verify rust ed25519 signature over the challenge
  const ok = tweetnacl.sign.detached.verify(m.get('challenge')!, m.get('ed25519_sig')!, ourEd);
  check('rust_ed25519_verify', ok);

  console.log(`[verify] OVERALL: ${pass ? 'PASS' : 'FAIL'}`);
  if (!pass) process.exit(1);
}

emit();
verify();
