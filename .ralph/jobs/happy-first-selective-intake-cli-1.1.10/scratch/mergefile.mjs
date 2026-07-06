#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import path from 'node:path';

const BASE = process.argv[2] || 'cli-1.1.8';
const THEIRS = 'cli-1.1.10';
const OURS = 'HEAD';
const PKG = process.argv[3] || 'packages/happy-server';
const SCRATCH = '.ralph/jobs/happy-first-selective-intake-cli-1.1.10/scratch/mf';

function git(args) { return execFileSync('git', args, { encoding: 'buffer', maxBuffer: 1 << 30 }); }
function blob(rev, p) {
  try { return git(['show', `${rev}:${p}`]).toString('utf8').replace(/\r\n/g, '\n'); } catch { return null; }
}
const cls = JSON.parse(readFileSync('.ralph/jobs/happy-first-selective-intake-cli-1.1.10/scratch/classification.json','utf8'))[BASE][PKG];
const candidates = cls.buckets.conflict.filter(c => c.kind === 'diverged').map(c => c.path);

rmSync(SCRATCH, { recursive: true, force: true });
mkdirSync(SCRATCH, { recursive: true });

const results = [];
for (const p of candidates) {
  const ours = blob(OURS, p), base = blob(BASE, p), theirs = blob(THEIRS, p);
  if (ours === null || base === null || theirs === null) { results.push({ p, conflictHunks: 'missing-blob' }); continue; }
  const tag = p.replace(/[^A-Za-z0-9]/g, '_');
  const fo = path.join(SCRATCH, tag + '.ours'), fb = path.join(SCRATCH, tag + '.base'), ft = path.join(SCRATCH, tag + '.theirs');
  writeFileSync(fo, ours); writeFileSync(fb, base); writeFileSync(ft, theirs);
  let code = 0;
  try { git(['merge-file', '-p', '--diff3', fo, fb, ft]); code = 0; }
  catch (e) { code = (typeof e.status === 'number') ? e.status : -1; }
  results.push({ p, conflictHunks: code });
}
const hard = results.filter(r => typeof r.conflictHunks === 'number' && r.conflictHunks > 0);
const clean = results.filter(r => r.conflictHunks === 0);
console.log(`BASE=${BASE} PKG=${PKG}  candidates=${candidates.length}  HARD=${hard.length}  clean-auto=${clean.length}`);
console.log('--- HARD (conflict hunks) ---');
hard.sort((a,b)=>b.conflictHunks-a.conflictHunks).forEach(r => console.log(`  ${r.conflictHunks}\t${r.p}`));
console.log('--- CLEAN AUTO-MERGE ---');
clean.forEach(r => console.log(`  ${r.p}`));
rmSync(SCRATCH, { recursive: true, force: true });
