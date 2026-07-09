#!/usr/bin/env node
// Advisory audit: cross-check `// FORK PATCH:` markers in the happy-* packages
// against the invariant catalogue at docs/happy-patch-surface.md.
//
// Reports drift in both directions:
//   - orphan marker  : a marker in code whose invariant ID has no catalogue row
//   - undermarked row: a catalogue row that claims an inline marker but none is
//                      found in code
//   - unexpected marker: a guard-by-absence row (marker column ❌) that
//                      nonetheless has a marker in code
//
// M0 contract: ADVISORY — exits 0 and prints a report regardless of drift.
// Pass `--strict` to exit 1 when any drift is found (for future CI use).
//
// This script has NO runtime dependencies and reads only tracked source.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');
const cataloguePath = join(repoRoot, 'docs', 'happy-patch-surface.md');

const strict = process.argv.includes('--strict');

// Package source roots to scan for markers.
const scanRoots = [
    'packages/happy-server/sources',
    'packages/happy-cli/src',
    'packages/happy-app/sources',
];
const scanExts = new Set(['.ts', '.tsx', '.mts', '.cts', '.prisma']);
const skipDirs = new Set(['node_modules', 'dist', '.git', '__snapshots__']);

const ID_RE = /\b(H[SCA]-\d+)\b/;
const INVARIANT_RE = /\(invariant\s+(H[SCA]-\d+)\)/;

function walk(dir, out) {
    let entries;
    try {
        entries = readdirSync(dir, { withFileTypes: true });
    } catch {
        return out;
    }
    for (const e of entries) {
        if (e.isDirectory()) {
            if (skipDirs.has(e.name)) continue;
            walk(join(dir, e.name), out);
        } else if (e.isFile()) {
            const dot = e.name.lastIndexOf('.');
            const ext = dot >= 0 ? e.name.slice(dot) : '';
            if (scanExts.has(ext)) out.push(join(dir, e.name));
        }
    }
    return out;
}

// --- 1. Parse the catalogue table rows ---------------------------------------
/** @type {Map<string, {hasMarker: boolean, file: string}>} */
const catalogue = new Map();
const catalogueText = readFileSync(cataloguePath, 'utf8');
for (const rawLine of catalogueText.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line.startsWith('| H')) continue; // only HS-/HC-/HA- data rows
    const cols = line.split('|').map((c) => c.trim());
    // cols: ['', id, file, bucket, invariant, marker, test, replant, '']
    const id = cols[1];
    if (!/^H[SCA]-\d+$/.test(id)) continue;
    const markerCol = cols[5] || '';
    const hasMarker = markerCol.includes('\u2705'); // ✅
    catalogue.set(id, { hasMarker, file: cols[2] || '' });
}

// --- 2. Collect markers from source ------------------------------------------
/** @type {Map<string, string[]>} id -> list of "path:line" */
const markers = new Map();
const filesWithMarkers = new Set();
for (const root of scanRoots) {
    const abs = join(repoRoot, root);
    const files = walk(abs, []);
    for (const file of files) {
        let content;
        try {
            content = readFileSync(file, 'utf8');
        } catch {
            continue;
        }
        if (!content.includes('FORK PATCH:')) continue;
        const rel = relative(repoRoot, file).replace(/\\/g, '/');
        const lines = content.split(/\r?\n/);
        for (let i = 0; i < lines.length; i++) {
            if (!lines[i].includes('FORK PATCH:')) continue;
            filesWithMarkers.add(rel);
            const m = lines[i].match(INVARIANT_RE) || lines[i].match(ID_RE);
            const id = m ? m[1] : '(no-id)';
            if (!markers.has(id)) markers.set(id, []);
            markers.get(id).push(`${rel}:${i + 1}`);
        }
    }
}

// --- 3. Cross-check ----------------------------------------------------------
const drift = [];

for (const [id, meta] of catalogue) {
    const found = markers.has(id);
    if (meta.hasMarker && !found) {
        drift.push(`undermarked row: ${id} claims an inline marker but none was found in code (${meta.file})`);
    }
    if (!meta.hasMarker && found) {
        drift.push(`unexpected marker: ${id} is a guard-by-absence row (❌) but has marker(s) at ${markers.get(id).join(', ')}`);
    }
}
for (const [id, locs] of markers) {
    if (id === '(no-id)') {
        drift.push(`marker with no (invariant <ID>): ${locs.join(', ')}`);
        continue;
    }
    if (!catalogue.has(id)) {
        drift.push(`orphan marker: ${id} appears in code (${locs.join(', ')}) with no catalogue row`);
    }
}

// --- 4. Report ---------------------------------------------------------------
const byBucket = { HS: 0, HC: 0, HA: 0 };
const markedByBucket = { HS: 0, HC: 0, HA: 0 };
for (const [id, meta] of catalogue) {
    const b = id.slice(0, 2);
    byBucket[b] = (byBucket[b] || 0) + 1;
    if (meta.hasMarker) markedByBucket[b] = (markedByBucket[b] || 0) + 1;
}

console.log('happy fork-patch audit');
console.log('----------------------');
console.log(`catalogue: ${catalogue.size} invariant rows` +
    `  (HS ${byBucket.HS}, HC ${byBucket.HC}, HA ${byBucket.HA})`);
console.log(`inline-marker rows: HS ${markedByBucket.HS}, HC ${markedByBucket.HC}, HA ${markedByBucket.HA}`);
console.log(`markers in code: ${[...markers.values()].reduce((n, l) => n + l.length, 0)} across ${filesWithMarkers.size} files`);

if (drift.length === 0) {
    console.log('\nresult: OK — zero drift between markers and catalogue.');
    process.exit(0);
}

console.log(`\nresult: ${drift.length} drift item(s):`);
for (const d of drift) console.log(`  - ${d}`);
process.exit(strict ? 1 : 0);
