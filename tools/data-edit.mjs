#!/usr/bin/env node
// Thin wrapper that dispatches to the installed/in-tree ralph-overview `data-edit`.
// As of ralph-overview 2.12.0 the store is two shards: the HOT `.ralph-overview/data.json`
// (tracked tasks + metadata) + the COLD `.ralph-overview/data.archived.json`
// (merged/archived). `mark-shipped`/`set-lifecycle` move tasks between shards crash-safely
// under one store lock; the loader auto-detects single-file (legacy) vs split.
import { spawn } from 'node:child_process'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dispatcher = path.join(repoRoot, 'bin', 'ralph-overview.mjs')

const argv = normalizeRepoEquals(process.argv.slice(2))
const finalArgs = argvHasRepo(argv) ? argv : ['--repo', repoRoot, ...argv]

const child = spawn(process.execPath, [dispatcher, 'data-edit', ...finalArgs], {
    stdio: 'inherit',
    cwd: process.cwd(),
    env: process.env,
})

child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)))
process.on('SIGINT', () => child.kill('SIGINT'))
process.on('SIGTERM', () => child.kill('SIGTERM'))

function argvHasRepo(args) {
    return args.some((arg) => arg === '--repo' || arg === '--cwd')
}

function normalizeRepoEquals(args) {
    const normalized = []
    for (const arg of args) {
        if (arg.startsWith('--repo=')) {
            normalized.push('--repo', arg.slice('--repo='.length))
        } else if (arg.startsWith('--cwd=')) {
            normalized.push('--cwd', arg.slice('--cwd='.length))
        } else {
            normalized.push(arg)
        }
    }
    return normalized
}
