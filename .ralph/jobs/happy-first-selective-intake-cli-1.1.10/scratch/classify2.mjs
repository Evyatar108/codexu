#!/usr/bin/env node
// Fast classification of the upstream delta per package against fork HEAD,
// using `git diff --ignore-cr-at-eol` to neutralize the Windows CRLF trap
// (no per-file blob reads). Computes for BOTH candidate bases.
import { execFileSync } from 'node:child_process';

const THEIRS = 'cli-1.1.10';
const OURS = 'HEAD';
const BASES = { 'cli-1.1.8': 'cli-1.1.8', 'df4cdae8': 'df4cdae8' };
const PKGS = ['packages/happy-server', 'packages/happy-cli', 'packages/happy-app'];

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 1 << 30 });
}
function tryGit(args) {
  try { return { ok: true, out: git(args) }; } catch (e) { return { ok: false, out: (e.stdout || '') + (e.stderr || '') }; }
}
// name-status of base->theirs for a pkg
function deltaStatus(base, pkg) {
  const out = git(['diff', '--ignore-cr-at-eol', '--name-status', '-M', base, THEIRS, '--', pkg]);
  return out.split('\n').filter(Boolean).map((line) => {
    const p = line.split('\t');
    return { status: p[0][0], path: p[p.length - 1] };
  });
}
// set of files (in pkg) where OURS differs from base, ignoring CRLF
function forkDivergedSet(base, pkg) {
  const out = git(['diff', '--ignore-cr-at-eol', '--name-only', base, OURS, '--', pkg]);
  return new Set(out.split('\n').filter(Boolean));
}
// does fork HEAD have this path?
function forkHas(path) {
  return tryGit(['cat-file', '-e', `${OURS}:${path}`]).ok;
}

const report = {};
for (const [baseName, baseRef] of Object.entries(BASES)) {
  report[baseName] = {};
  for (const pkg of PKGS) {
    const delta = deltaStatus(baseRef, pkg);
    const diverged = forkDivergedSet(baseRef, pkg);
    const buckets = { cleanAdopt: [], conflict: [], upstreamNewAdoptable: [], upstreamNewForkHas: [], upstreamDelete: [] };
    for (const f of delta) {
      if (f.status === 'A') {
        if (forkHas(f.path)) buckets.upstreamNewForkHas.push(f.path);
        else buckets.upstreamNewAdoptable.push(f.path);
      } else if (f.status === 'D') {
        buckets.upstreamDelete.push({ path: f.path, forkStillHas: forkHas(f.path) });
      } else {
        // M or R: modified upstream
        if (!forkHas(f.path)) buckets.conflict.push({ path: f.path, kind: 'fork-deleted' });
        else if (diverged.has(f.path)) buckets.conflict.push({ path: f.path, kind: 'diverged' });
        else buckets.cleanAdopt.push(f.path);
      }
    }
    report[baseName][pkg] = {
      total: delta.length,
      cleanAdopt: buckets.cleanAdopt.length,
      conflict: buckets.conflict.length,
      upstreamNewAdoptable: buckets.upstreamNewAdoptable.length,
      upstreamNewForkHas: buckets.upstreamNewForkHas.length,
      upstreamDelete: buckets.upstreamDelete.length,
      buckets,
    };
  }
}
console.log(JSON.stringify(report, null, 2));
