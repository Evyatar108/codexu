#!/usr/bin/env node
// codexu-side resolver wrapper for the ralph-overview plugin.
//
// Why this file exists: the ralph-overview plugin is installed via Claude Code
// (`/plugin install ralph-overview@ai-developer-toolkit`) or Copilot CLI
// (`copilot plugin install ralph-overview@ai-developer-toolkit`) but plugin
// install does NOT put `ralph-overview` on PATH. The plugin's bin dispatcher
// must be invoked via absolute path, and the install path differs between the
// two engines (and neither engine exposes a stable env var that Copilot
// consumers can rely on — `$CLAUDE_PLUGIN_ROOT` is Claude-only). This wrapper
// resolves the plugin's location at runtime so codexu's package.json scripts
// (and any human terminal user in this checkout) can write
// `node bin/ralph-overview.mjs <subcommand>` and have it just work under
// either engine.
//
// Resolution order (first existing wins):
//   1. RALPH_OVERVIEW_PLUGIN_ROOT env var
//   2. CLAUDE_PLUGIN_ROOT/ralph-overview (Claude Code harness-set)
//   3. CLAUDE_PLUGIN_ROOT/cache/ai-developer-toolkit/ralph-overview/<latest>
//      (the typical Claude Code `/plugin install` cache layout)
//   4. ~/.claude/plugins/cache/ai-developer-toolkit/ralph-overview/<latest>
//   5. ~/.copilot/installed-plugins/ai-developer-toolkit/ralph-overview/
//      (Copilot CLI install layout; non-versioned subdir, single live copy)
//   6. D:/ai-developer-toolkit/plugins/ralph-overview/ (local-dev fallback)
//
// Once located, this wrapper spawns the plugin's bin/ralph-overview.mjs
// with the original argv and forwards stdio.
//
// The local-dev fallback (step 6) is intentionally an absolute, machine-
// specific path. It is useful when iterating on the ralph-overview plugin
// itself without re-installing on every change. It is harmless on machines
// where that path does not exist: `existsPluginAt(localDev)` returns false
// and the cascade falls through to `resolvePluginRoot() === null`, which
// surfaces a friendly error pointing the developer at the install command.
// See the long-term plan to push this resolution upstream into the plugin's
// own `scripts/init-consumer.mjs` so future consumers do not each need a
// copy of this wrapper: `ralph-overview-init-consumer-cross-engine-wrapper`
// in `plans/overview-data.js`.

import { execFileSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

const PLUGIN_NAME = 'ralph-overview'
const MANIFEST_REL = '.claude-plugin/plugin.json'

function existsPluginAt(dir) {
    return fs.existsSync(path.join(dir, MANIFEST_REL))
}

function newestVersionedSubdir(base) {
    if (!fs.existsSync(base)) return null
    const entries = fs.readdirSync(base, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name)
        .filter((name) => existsPluginAt(path.join(base, name)))
    if (entries.length === 0) return null
    // Lexical sort = semver-ish ordering for `<major>.<minor>.<patch>` dirs.
    entries.sort()
    return path.join(base, entries[entries.length - 1])
}

function resolvePluginRoot() {
    if (process.env.RALPH_OVERVIEW_PLUGIN_ROOT) {
        const explicit = process.env.RALPH_OVERVIEW_PLUGIN_ROOT
        if (existsPluginAt(explicit)) return explicit
        process.stderr.write(`bin/ralph-overview.mjs: RALPH_OVERVIEW_PLUGIN_ROOT=${explicit} but no ${MANIFEST_REL} found there\n`)
    }

    const claudePluginRoot = process.env.CLAUDE_PLUGIN_ROOT
    if (claudePluginRoot) {
        const direct = path.join(claudePluginRoot, PLUGIN_NAME)
        if (existsPluginAt(direct)) return direct
        const versioned = newestVersionedSubdir(path.join(claudePluginRoot, 'cache', 'ai-developer-toolkit', PLUGIN_NAME))
        if (versioned) return versioned
    }

    const userCache = path.join(os.homedir(), '.claude', 'plugins', 'cache', 'ai-developer-toolkit', PLUGIN_NAME)
    const userVersioned = newestVersionedSubdir(userCache)
    if (userVersioned) return userVersioned

    // Copilot CLI install layout: a single live copy at
    // ~/.copilot/installed-plugins/<marketplace>/<plugin>/ (no per-version
    // subdir — the install is overwritten in place on update).
    const copilotInstall = path.join(os.homedir(), '.copilot', 'installed-plugins', 'ai-developer-toolkit', PLUGIN_NAME)
    if (existsPluginAt(copilotInstall)) return copilotInstall

    const localDev = 'D:/ai-developer-toolkit/plugins/ralph-overview'
    if (existsPluginAt(localDev)) return localDev

    return null
}

function gitRepoRoot() {
    try {
        return execFileSync('git', ['-C', process.cwd(), 'rev-parse', '--show-toplevel'], {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
        }).trim()
    } catch {
        return process.cwd()
    }
}

const pluginRoot = resolvePluginRoot()
if (!pluginRoot) {
    process.stderr.write(`bin/ralph-overview.mjs: could not locate the ralph-overview plugin.\n`)
    process.stderr.write(`  Tried:\n`)
    process.stderr.write(`    1. $RALPH_OVERVIEW_PLUGIN_ROOT\n`)
    process.stderr.write(`    2. $CLAUDE_PLUGIN_ROOT/${PLUGIN_NAME}\n`)
    process.stderr.write(`    3. $CLAUDE_PLUGIN_ROOT/cache/ai-developer-toolkit/${PLUGIN_NAME}/<latest>\n`)
    process.stderr.write(`    4. ~/.claude/plugins/cache/ai-developer-toolkit/${PLUGIN_NAME}/<latest>\n`)
    process.stderr.write(`    5. ~/.copilot/installed-plugins/ai-developer-toolkit/${PLUGIN_NAME}/\n`)
    process.stderr.write(`    6. D:/ai-developer-toolkit/plugins/${PLUGIN_NAME}/\n`)
    process.stderr.write(`  Fix: install the plugin via \`/plugin install ${PLUGIN_NAME}@ai-developer-toolkit\`,\n`)
    process.stderr.write(`       or set RALPH_OVERVIEW_PLUGIN_ROOT to an absolute path.\n`)
    process.exit(2)
}

const dispatcher = path.join(pluginRoot, 'bin', 'ralph-overview.mjs')
if (!fs.existsSync(dispatcher)) {
    process.stderr.write(`bin/ralph-overview.mjs: plugin found at ${pluginRoot} but missing ${dispatcher}\n`)
    process.exit(3)
}

// Default --repo to consumer git root if not already supplied. Lets `pnpm overview`
// in any subdir of the consumer repo still target the right repoRoot.
const argv = process.argv.slice(2)
const hasRepo = argv.some((a) => a === '--repo')
const finalArgs = hasRepo ? argv : [argv[0], '--repo', gitRepoRoot(), ...argv.slice(1)]

const child = spawn(process.execPath, [dispatcher, ...finalArgs], {
    stdio: 'inherit',
    env: { ...process.env, RALPH_OVERVIEW_PLUGIN_ROOT: pluginRoot },
})
child.on('exit', (code, sig) => process.exit(code ?? (sig ? 1 : 0)))
process.on('SIGINT', () => child.kill('SIGINT'))
process.on('SIGTERM', () => child.kill('SIGTERM'))
