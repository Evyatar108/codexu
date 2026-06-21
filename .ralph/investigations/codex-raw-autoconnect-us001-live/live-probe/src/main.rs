// THROWAWAY US-001 live round-trip probe (native Rust client).
// Proves, against a live canonical happy-server tunnel listener on 127.0.0.1:
//   1. reqwest can POST /v1/sessions (create, no auth header) and /v3 messages
//   2. rust-socketio can connect to /v1/updates (user-scoped, auth {}) and
//      receive the server's `update` events (the new-session broadcast)
//   3. AES-256-GCM dataKey content (spike-proven byte layout 0||nonce12||ct||tag16)
//      round-trips through /v3 send -> /v3 fetch and decrypts byte-identical.
//
// Usage: us001-live-probe <base_url>   e.g. http://127.0.0.1:4599

use aes_gcm::aead::generic_array::GenericArray;
use aes_gcm::aead::Aead;
use aes_gcm::{Aes256Gcm, KeyInit};
use base64::Engine as _;
use base64::engine::general_purpose::STANDARD as B64;
use rust_socketio::{ClientBuilder, Payload, TransportType};
use serde_json::json;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

// encryptWithDataKey: bundle = version(0) || nonce(12) || ct||tag  (aes-256-gcm)
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

fn main() {
    let base = std::env::args().nth(1).unwrap_or_else(|| "http://127.0.0.1:4599".to_string());
    let mut pass = true;
    let http = reqwest::blocking::Client::new();

    // unique tag so we create a fresh session this run
    let tag = format!("codex-us001-live-{}", Instant::now().elapsed().as_nanos());
    let tag = format!("{}-{}", tag, std::process::id());

    // --- 1. Socket connect FIRST (so we catch the new-session broadcast) ---
    let updates: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
    let connected = Arc::new(Mutex::new(false));
    let updates_cb = updates.clone();
    let connected_cb = connected.clone();

    let socket_url = format!("{}/v1/updates/", base);
    let socket = ClientBuilder::new(&socket_url)
        .transport_type(TransportType::Websocket)
        .auth(json!({}))
        .on("open", move |_p, _c| { *connected_cb.lock().unwrap() = true; })
        .on("update", move |payload, _c| {
            let s = match payload {
                Payload::Text(v) => serde_json::to_string(&v).unwrap_or_default(),
                Payload::String(s) => s,
                Payload::Binary(_) => "<binary>".to_string(),
            };
            updates_cb.lock().unwrap().push(s);
        })
        .on_any(|event, payload, _c| {
            let ev: String = String::from(event);
            if ev != "update" && ev != "open" {
                eprintln!("[socket] event={} payload={:?}", ev, payload);
            }
        })
        .connect();

    let socket = match socket {
        Ok(s) => { println!("[1] socket connect: OK -> {}", socket_url); s }
        Err(e) => { println!("[1] socket connect: FAIL ({})", e); pass = false; print_overall(false); std::process::exit(1); }
    };
    std::thread::sleep(Duration::from_millis(800));

    // --- 2. Create a session via /v1/sessions (no auth header, tunnel mode) ---
    let create_body = json!({
        "tag": tag,
        "metadata": "{\"path\":\"/derisk\",\"host\":\"codex-us001\"}",
        "agentState": serde_json::Value::Null,
        "dataEncryptionKey": serde_json::Value::Null, // hardcoded null quirk (api.ts:70)
    });
    let resp = http.post(format!("{}/v1/sessions", base))
        .header("Content-Type", "application/json")
        .header("X-Happy-Client", "codex-us001-live/0.0.0")
        .body(create_body.to_string())
        .send().expect("create send");
    let status = resp.status();
    let cjson: serde_json::Value = resp.json().expect("create json");
    let session_id = cjson["session"]["id"].as_str().unwrap_or("").to_string();
    let ok = status.is_success() && !session_id.is_empty();
    println!("[2] POST /v1/sessions (no auth): {} status={} id={}", yn(ok), status, session_id);
    pass &= ok;

    // --- 3. Encrypt a content with AES-256-GCM dataKey, POST via /v3 ---
    let content_key = [0x37u8; 32];
    let plaintext = b"{\"role\":\"user\",\"content\":\"us001 live round-trip\"}";
    let bundle = aesgcm_seal(plaintext, &content_key);
    let content_b64 = B64.encode(&bundle);
    let local_id = format!("us001-{}", std::process::id());
    let send_body = json!({ "messages": [ { "content": content_b64, "localId": local_id } ] });
    let resp = http.post(format!("{}/v3/sessions/{}/messages", base, session_id))
        .header("Content-Type", "application/json")
        .header("X-Happy-Client", "codex-us001-live/0.0.0")
        .body(send_body.to_string())
        .send().expect("v3 send");
    let ok = resp.status().is_success();
    println!("[3] POST /v3/.../messages (encrypted): {} status={}", yn(ok), resp.status());
    pass &= ok;

    // --- 4. Fetch it back and decrypt, asserting byte-identity ---
    let resp = http.get(format!("{}/v3/sessions/{}/messages?after_seq=0&limit=10", base, session_id))
        .header("X-Happy-Client", "codex-us001-live/0.0.0")
        .send().expect("v3 get");
    let gjson: serde_json::Value = resp.json().expect("v3 get json");
    let fetched_c = gjson["messages"][0]["content"]["c"].as_str().unwrap_or("");
    let mut decrypt_ok = false;
    if !fetched_c.is_empty() {
        if let Ok(raw) = B64.decode(fetched_c) {
            let pt = aesgcm_open(&raw, &content_key);
            decrypt_ok = pt == plaintext;
        }
    }
    println!("[4] /v3 fetch + AES-256-GCM decrypt byte-identical: {}", yn(decrypt_ok));
    pass &= decrypt_ok;

    // --- 5. Confirm the socket received a broadcast referencing the new session ---
    let mut got_update = false;
    let deadline = Instant::now() + Duration::from_secs(4);
    while Instant::now() < deadline {
        {
            let u = updates.lock().unwrap();
            if u.iter().any(|s| s.contains(&session_id)) { got_update = true; break; }
        }
        std::thread::sleep(Duration::from_millis(150));
    }
    let total = updates.lock().unwrap().len();
    println!("[5] socket received update referencing session: {} (total updates seen={})", yn(got_update), total);
    if let Some(first) = updates.lock().unwrap().first() {
        let snippet: String = first.chars().take(220).collect();
        println!("    first update snippet: {}", snippet);
    }
    pass &= got_update;

    let _ = socket.disconnect();
    print_overall(pass);
    if !pass { std::process::exit(1); }
}

fn yn(b: bool) -> &'static str { if b { "PASS" } else { "FAIL" } }
fn print_overall(b: bool) { println!("[verify] OVERALL: {}", if b { "PASS" } else { "FAIL" }); }
