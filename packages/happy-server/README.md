# Happy Server

Embeddable backend library for the open-source end-to-end encrypted Claude Code clients.

## What is Happy?

Happy Server is the synchronization backbone for secure Claude Code clients. In the per-machine architecture it ships as a library that `happy-cli` embeds inside the daemon: each operator's machine runs its own `createHappyServer()` instance, exposes itself to mobile clients through a Microsoft Dev Tunnel, and pushes notifications directly to Expo. There is no shared cloud relay — multiple devices share encrypted conversations while the embedded server never sees plaintext, only encrypted blobs it cannot read.

## Features

- 🔐 **Zero Knowledge** - The server stores encrypted data but has no ability to decrypt it
- 🎯 **Minimal Surface** - Only essential features for secure sync, nothing more
- 🕵️ **Privacy First** - No analytics, no tracking, no data mining
- 📖 **Open Source** - Transparent implementation you can audit and self-host
- 🔑 **Cryptographic Auth** - No passwords stored, only TOFU-pinned public keys + Dev Tunnel-scoped claims
- ⚡ **Real-time Sync** - WebSocket-based synchronization across all your devices
- 📱 **Multi-device** - Seamless session management across phones, tablets, and computers
- 🔔 **Push Notifications** - Sent directly from the embedded server to Expo when Claude Code finishes tasks or needs permissions (encrypted, we can't see the content)
- 🧩 **Library Shape** - Side-effect free imports, explicit `start()` / `stop()` lifecycle so it can run inside the CLI daemon

## How It Works

Your Claude Code clients generate encryption keys locally. `happy-cli` boots an embedded `happy-server` on a loopback port via `createHappyServer({ ... })` and publishes it through a Microsoft Dev Tunnel for mobile clients to reach. Mobile pairs via GitHub device flow and pins the machine's TOFU public keys on first contact. Messages are end-to-end encrypted before leaving your device — the embedded server's job is simply to store encrypted blobs and sync them between your devices in real time.

## Embedding the Server

The library entry point is `createHappyServer(config)`:

```ts
import { createHappyServer } from "happy-server";

const server = createHappyServer({
  dataDir: "/path/to/.happy",      // base data directory; server writes under <dataDir>/happy-server
  port: 3005,                       // loopback port to listen on
  host: "127.0.0.1",                // optional, default 127.0.0.1
  machineKey: "<base64-or-string>", // master secret for auth/encryption
  localUserId: "local-user",        // single-tenant user id assigned to tunnel-listener requests (after Dev Tunnels gateway auth)
  publicUrl: "https://<tunnel>.devtunnels.ms", // public Dev Tunnel URL announced to clients
  tofuPublicKeys: {
    ed25519PublicKey: "<base64>",
    x25519PublicKey: "<base64>",
    x25519SecretKey: new Uint8Array(/* ... */),
    ed25519Fingerprint: "<sha256>",
  },
});

await server.start();
// later
await server.stop();
```

`createHappyServer` returns `{ app, start, stop }`. Public library imports are side-effect free: timers, DB clients, file storage clients, logger transports, and process handlers are wired up only when `start()` is called and torn down by `stop()`. The `happy-cli` daemon owns this lifecycle.

## Standalone Mode

A thin `main.ts` entry point wraps `createHappyServer` for hosts that want to run it as a standalone process (Docker image, debugging, integration tests). The standalone Docker image runs everything in a single container with no external dependencies (no Postgres, no Redis, no S3).

```bash
docker build -t happy-server -f Dockerfile .
```

Run from the monorepo root:

```bash
docker run -p 3005:3005 \
  -e HANDY_MASTER_SECRET=<your-secret> \
  -v happy-data:/data \
  happy-server
```

This uses:
- **PGlite** - embedded PostgreSQL (data stored in `/data/pglite`)
- **Local filesystem** - for file uploads (stored in `/data/files`)
- **In-memory event bus** - no Redis needed

Data persists in the `happy-data` Docker volume across container restarts.

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `HANDY_MASTER_SECRET` | Yes | - | Master secret for auth/encryption |
| `PUBLIC_URL` | No | `http://localhost:3005` | Public base URL for file URLs sent to clients |
| `PORT` | No | `3005` | Server port |
| `DATA_DIR` | No | `/data` | Base data directory |
| `PGLITE_DIR` | No | `/data/pglite` | PGlite database directory |

### Optional: External Services

To use external Postgres or Redis instead of the embedded defaults, set:

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection URL (bypasses PGlite) |
| `REDIS_URL` | Redis connection URL |
| `S3_HOST` | S3/MinIO host (bypasses local file storage) |

### S3 bucket configuration (when self-hosting with S3)

When `S3_HOST` is set, image attachments and other blobs land in S3 under
`sessions/<sessionId>/attachments/<id>.enc`. Two bucket-level settings are
not configured by the server itself and must be applied once at deploy
time:

**1. Lifecycle rule for attachment TTL.** Encrypted blobs are deleted when
their session is deleted, but a long-lived session would otherwise keep
its blobs forever. Add a lifecycle rule on the attachments prefix so
objects age out automatically. Pick a TTL that matches your retention
policy (30 days is a reasonable default).

```bash
# AWS CLI
aws s3api put-bucket-lifecycle-configuration --bucket happy-blobs \
  --lifecycle-configuration '{
    "Rules": [{
      "ID": "session-attachments-ttl",
      "Status": "Enabled",
      "Filter": { "Prefix": "sessions/" },
      "Expiration": { "Days": 30 }
    }]
  }'

# MinIO
mc ilm rule add myminio/happy-blobs \
  --expire-days 30 \
  --prefix "sessions/"
```

**2. Server-side encryption (defense-in-depth).** Blobs are already
end-to-end encrypted by the client, but enabling AES-256 SSE on the
bucket protects against an attacker who somehow obtains raw object
storage access without the keys.

```bash
# AWS CLI
aws s3api put-bucket-encryption --bucket happy-blobs \
  --server-side-encryption-configuration '{
    "Rules": [{
      "ApplyServerSideEncryptionByDefault": {
        "SSEAlgorithm": "AES256"
      }
    }]
  }'

# MinIO
mc encrypt set sse-s3 myminio/happy-blobs
```

Local-storage mode (no `S3_HOST`) writes blobs under
`<DATA_DIR>/files/sessions/<sessionId>/attachments/`. There is no
lifecycle equivalent — clean up old session directories on a cron if
you want a TTL story.

## License

MIT - Use it, modify it, deploy it anywhere.
