import "reflect-metadata";

// Patch crypto.subtle.importKey to normalize base64 → base64url in JWK data.
// privacy-kit uses standard base64 for Ed25519 JWK keys, but Bun (correctly per spec)
// requires base64url. Node.js is lenient about this, Bun is not.
const origImportKey = crypto.subtle.importKey.bind(crypto.subtle);
crypto.subtle.importKey = function (format: any, keyData: any, algorithm: any, extractable: any, keyUsages: any) {
    if (format === 'jwk' && keyData && typeof keyData === 'object') {
        const fixed = { ...keyData };
        for (const field of ['d', 'x', 'y', 'n', 'e', 'p', 'q', 'dp', 'dq', 'qi', 'k']) {
            if (typeof fixed[field] === 'string') {
                fixed[field] = fixed[field].replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
            }
        }
        return origImportKey(format, fixed, algorithm, extractable, keyUsages);
    }
    return origImportKey(format, keyData, algorithm, extractable, keyUsages);
} as any;

import * as fs from "fs";
import * as path from "path";
import { applyPGliteMigrations } from "./storage/applyPGliteMigrations";
import { createPGlite } from "./storage/pgliteLoader";

const dataDir = process.env.DATA_DIR || "./data";
const pgliteDir = process.env.PGLITE_DIR || path.join(dataDir, "pglite");

async function migrate() {
    console.log(`Migrating database in ${pgliteDir}...`);
    fs.mkdirSync(pgliteDir, { recursive: true });

    const pg = createPGlite(pgliteDir);
    const appliedCount = await applyPGliteMigrations(pg);

    if (appliedCount === 0) {
        console.log("No new migrations to apply.");
    } else {
        console.log(`Applied ${appliedCount} migration(s).`);
    }

    await pg.close();
}

async function serve() {
    // Ensure DB_PROVIDER is set for db.ts
    process.env.DB_PROVIDER = process.env.DB_PROVIDER || "pglite";
    process.env.PGLITE_DIR = process.env.PGLITE_DIR || pgliteDir;

    // Import and run the main server
    await import("./main");
}

// CLI
const command = process.argv[2];

switch (command) {
    case "migrate":
        migrate().catch(e => {
            console.error(e);
            process.exit(1);
        });
        break;
    case "serve":
        serve().catch(e => {
            console.error(e);
            process.exit(1);
        });
        break;
    default:
        console.log(`happy-server - portable distribution

Usage:
  happy-server migrate    Apply database migrations
  happy-server serve      Start the server

Environment variables:
  DATA_DIR          Base data directory (default: ./data)
  PGLITE_DIR        PGlite database directory (default: DATA_DIR/pglite)
  DATABASE_URL      PostgreSQL URL (if set, uses external Postgres instead of PGlite)
  REDIS_URL         Redis URL (optional, not required for standalone)
  PORT              Server port (default: 3005)
  HANDY_MASTER_SECRET  Required: master secret for auth/encryption
`);
        process.exit(command === "--help" || command === "-h" ? 0 : 1);
}
