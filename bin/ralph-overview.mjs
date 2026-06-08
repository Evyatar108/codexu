#!/usr/bin/env node
// Consumer-side resolver wrapper for the ralph-overview plugin.
//
// THIS FILE IS GENERATED. It is emitted verbatim (with two emit-time name
// substitutions) into a consumer repo by `ralph-overview init`
// (scripts/init-consumer.mjs). Do not hand-edit the copy in a consumer repo;
// re-run `overview-init` to refresh it. The canonical source lives at
// `templates/consumer-ralph-overview.mjs` in the ralph-overview plugin.
//
// Why this file exists: the ralph-overview plugin is installed via Claude Code
// (`/plugin install ralph-overview@ai-developer-toolkit`) or Copilot CLI
// (`copilot plugin install ralph-overview@ai-developer-toolkit`), but plugin
// install does NOT put `ralph-overview` on PATH, and the install path differs
// between the two engines (neither exposes a stable env var a Copilot consumer
// can rely on — `$CLAUDE_PLUGIN_ROOT` is Claude-only). This wrapper resolves the
// plugin's location at runtime so a consumer's package.json scripts (and any
// human terminal user in the checkout) can write
// `node bin/ralph-overview.mjs <subcommand>` and have it work under either
// engine. Once located, it spawns the plugin's own `bin/ralph-overview.mjs`
// dispatcher with the original argv and forwards stdio/signals/exit code.
//
// Resolution order (first usable install wins; "usable" = has the plugin
// manifest AND the bin dispatcher):
//   1. RALPH_OVERVIEW_PLUGIN_ROOT env var
//   2. CLAUDE_PLUGIN_ROOT/ralph-overview (Claude Code harness-set)
//   3. CLAUDE_PLUGIN_ROOT/cache/ai-developer-toolkit/ralph-overview/<newest>
//   4. ~/.claude/plugins/cache/ai-developer-toolkit/ralph-overview/<newest>
//   5. ~/.copilot/installed-plugins/ai-developer-toolkit/ralph-overview/
//      (Copilot CLI install layout; single live copy, no per-version subdir)
//   6. consumerWrapper.localDevPluginRootRel from .ralph-overview/config.json
//      (optional in-tree / submodule local-dev fallback, repoRoot-relative)
//
// A located install missing its runtime `node_modules` is STILL selected and
// dispatched; the wrapper only prints a precise "dependencies missing"
// diagnostic. It never runs `npm install` itself (diagnostic-only by design).

import { execFileSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

// Emit-time substitution: init-consumer replaces these tokens with the real
// marketplace + plugin names so there is a single source of truth. The raw
// template carries placeholders (kept syntactically valid for editors/CI).
const MARKETPLACE_NAME = 'ai-developer-toolkit'
const PLUGIN_NAME = 'ralph-overview'

const SELF = 'bin/ralph-overview.mjs'
const MANIFEST_REL = path.join('.claude-plugin', 'plugin.json')
const DISPATCHER_REL = path.join('bin', 'ralph-overview.mjs')
// chokidar is the only runtime dependency the plugin needs that is NOT part of
// the install manifest; its presence is the deps-installed sentinel. It is only
// required for the `watch` subcommand (one-shot sync/build lazy-load it).
const DEPS_SENTINEL_REL = path.join('node_modules', 'chokidar')

function hasManifest(dir) {
    return Boolean(dir) && fs.existsSync(path.join(dir, MANIFEST_REL))
}

function hasDispatcher(dir) {
    return Boolean(dir) && fs.existsSync(path.join(dir, DISPATCHER_REL))
}

function hasDeps(dir) {
    return Boolean(dir) && fs.existsSync(path.join(dir, DEPS_SENTINEL_REL))
}

function isUsable(dir) {
    return hasManifest(dir) && hasDispatcher(dir)
}

// Parse a directory name as a strict `<major>.<minor>.<patch>` triple. Names
// with any suffix (e.g. prerelease `2.9.0-rc.1`) are treated as non-semver and
// fall to the lexical tie-break below, so a clean stable version always
// outranks a same-core prerelease dir.
function parseSemver(name) {
    const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(name)
    return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null
}

// Descending comparator: newest version first. Numeric semver beats lexical;
// non-semver names sort after semver names; equal/both-non-semver use lexical.
function compareDirsDesc(a, b) {
    const pa = parseSemver(a)
    const pb = parseSemver(b)
    if (pa && pb) {
        for (let index = 0; index < 3; index += 1) {
            if (pa[index] !== pb[index]) {
                return pb[index] - pa[index]
            }
        }
        return 0
    }
    if (pa) return -1
    if (pb) return 1
    return a < b ? 1 : a > b ? -1 : 0
}

// Return the newest usable versioned subdir under `base`, or null. A broken
// newest (manifest but no dispatcher) is skipped in favor of an older usable
// install, so `2.10.0`-without-dispatcher does not shadow a working `2.9.0`.
function newestVersionedSubdir(base) {
    if (!base || !fs.existsSync(base)) {
        return null
    }
    const names = fs.readdirSync(base, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort(compareDirsDesc)
    for (const name of names) {
        const dir = path.join(base, name)
        if (isUsable(dir)) {
            return dir
        }
    }
    return null
}

function usableResult(pluginRoot, source, warnings) {
    return { pluginRoot, source, depsMissing: !hasDeps(pluginRoot), warnings }
}

// Pure resolver. Inputs are injected so the function is unit-testable without
// touching the real process env/home. Returns one of:
//   { pluginRoot, source, depsMissing, warnings }    -- usable install selected
//   { error: 'missing-dispatcher', pluginRoot, source, warnings } -- explicit
//        RALPH_OVERVIEW_PLUGIN_ROOT had the manifest but no bin dispatcher
//   { error: 'not-found', warnings }                 -- total cascade miss
export function resolvePluginRoot({ env = {}, homedir, cwd, config = {} } = {}) {
    void cwd
    const warnings = []

    // 1. Explicit override.
    const explicit = env.RALPH_OVERVIEW_PLUGIN_ROOT
    if (explicit) {
        if (hasManifest(explicit)) {
            if (hasDispatcher(explicit)) {
                return usableResult(explicit, 'RALPH_OVERVIEW_PLUGIN_ROOT', warnings)
            }
            // The operator explicitly pointed at a real plugin dir, but it is
            // broken (no dispatcher). Fail loudly instead of silently falling
            // through to a different install they did not choose.
            return { error: 'missing-dispatcher', pluginRoot: explicit, source: 'RALPH_OVERVIEW_PLUGIN_ROOT', warnings }
        }
        warnings.push(`${SELF}: RALPH_OVERVIEW_PLUGIN_ROOT=${explicit} is not a usable plugin install (missing ${MANIFEST_REL}); falling through`)
    }

    // 2-3. Claude Code harness-set plugin root.
    const claudePluginRoot = env.CLAUDE_PLUGIN_ROOT
    if (claudePluginRoot) {
        const direct = path.join(claudePluginRoot, PLUGIN_NAME)
        if (isUsable(direct)) {
            return usableResult(direct, 'CLAUDE_PLUGIN_ROOT', warnings)
        }
        const versioned = newestVersionedSubdir(path.join(claudePluginRoot, 'cache', MARKETPLACE_NAME, PLUGIN_NAME))
        if (versioned) {
            return usableResult(versioned, 'CLAUDE_PLUGIN_ROOT/cache', warnings)
        }
    }

    if (homedir) {
        // 4. Claude Code user-scope plugin cache.
        const userVersioned = newestVersionedSubdir(path.join(homedir, '.claude', 'plugins', 'cache', MARKETPLACE_NAME, PLUGIN_NAME))
        if (userVersioned) {
            return usableResult(userVersioned, '~/.claude/cache', warnings)
        }
        // 5. Copilot CLI install layout (single live copy, no version subdir).
        const copilotInstall = path.join(homedir, '.copilot', 'installed-plugins', MARKETPLACE_NAME, PLUGIN_NAME)
        if (isUsable(copilotInstall)) {
            return usableResult(copilotInstall, '~/.copilot', warnings)
        }
    }

    // 6. Consumer-configured local-dev fallback (e.g. an in-tree submodule).
    if (config.localDevPluginRoot && isUsable(config.localDevPluginRoot)) {
        return usableResult(config.localDevPluginRoot, 'localDev', warnings)
    }

    return { error: 'not-found', warnings }
}

// Resolve the consumer config path with the SAME precedence the plugin uses
// (explicit OVERVIEW_CONFIG_PATH repoRoot-relative, else
// <repoRoot>/.ralph-overview/config.json) so the wrapper and the plugin always
// read one config source. A minimal JSON read — the wrapper cannot call the
// plugin's loadConfig() before it has located the plugin.
export function loadConsumerWrapperConfig(repoRoot, env = {}) {
    const configPath = env.OVERVIEW_CONFIG_PATH
        ? path.resolve(repoRoot, env.OVERVIEW_CONFIG_PATH)
        : path.join(repoRoot, '.ralph-overview', 'config.json')
    let configExists = false
    let localDevPluginRootRel = null
    try {
        if (fs.existsSync(configPath)) {
            configExists = true
            const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8'))
            const rel = parsed?.consumerWrapper?.localDevPluginRootRel
            if (typeof rel === 'string' && rel.length > 0) {
                localDevPluginRootRel = rel
            }
        }
    } catch {
        // Tolerate an unreadable/invalid config: the wrapper still resolves via
        // the install cascade. (The plugin's own loadConfig surfaces config
        // errors with full diagnostics once it runs.)
    }
    const localDevPluginRoot = localDevPluginRootRel ? path.resolve(repoRoot, localDevPluginRootRel) : null
    return { configPath, configExists, localDevPluginRootRel, localDevPluginRoot }
}

function gitRepoRoot(cwd) {
    try {
        return execFileSync('git', ['-C', cwd, 'rev-parse', '--show-toplevel'], {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
        }).trim()
    } catch {
        return cwd
    }
}

function argvHasRepo(argv) {
    return argv.some((arg) => arg === '--repo' || arg.startsWith('--repo='))
}

function writeCascadeError() {
    process.stderr.write(`${SELF}: could not locate the ${PLUGIN_NAME} plugin.\n`)
    process.stderr.write('  Tried:\n')
    process.stderr.write('    1. $RALPH_OVERVIEW_PLUGIN_ROOT\n')
    process.stderr.write(`    2. $CLAUDE_PLUGIN_ROOT/${PLUGIN_NAME}\n`)
    process.stderr.write(`    3. $CLAUDE_PLUGIN_ROOT/cache/${MARKETPLACE_NAME}/${PLUGIN_NAME}/<newest>\n`)
    process.stderr.write(`    4. ~/.claude/plugins/cache/${MARKETPLACE_NAME}/${PLUGIN_NAME}/<newest>\n`)
    process.stderr.write(`    5. ~/.copilot/installed-plugins/${MARKETPLACE_NAME}/${PLUGIN_NAME}/\n`)
    process.stderr.write('    6. consumerWrapper.localDevPluginRootRel (.ralph-overview/config.json)\n')
    process.stderr.write(`  Fix: install the plugin via \`/plugin install ${PLUGIN_NAME}@${MARKETPLACE_NAME}\`\n`)
    process.stderr.write('       (or `copilot plugin install`), or set RALPH_OVERVIEW_PLUGIN_ROOT to an absolute path.\n')
}

function main() {
    const argv = process.argv.slice(2)
    const hasRepo = argvHasRepo(argv)
    let repoRoot
    if (hasRepo) {
        const flagIndex = argv.findIndex((arg) => arg === '--repo' || arg.startsWith('--repo='))
        const flag = argv[flagIndex]
        repoRoot = flag.startsWith('--repo=')
            ? path.resolve(flag.slice('--repo='.length))
            : path.resolve(argv[flagIndex + 1] ?? process.cwd())
    } else {
        repoRoot = gitRepoRoot(process.cwd())
    }

    const { configPath, configExists, localDevPluginRoot } = loadConsumerWrapperConfig(repoRoot, process.env)

    const result = resolvePluginRoot({
        env: process.env,
        homedir: os.homedir(),
        cwd: process.cwd(),
        config: { localDevPluginRoot },
    })

    for (const warning of result.warnings ?? []) {
        process.stderr.write(`${warning}\n`)
    }

    if (result.error === 'not-found') {
        writeCascadeError()
        process.exit(2)
    }
    if (result.error === 'missing-dispatcher') {
        process.stderr.write(`${SELF}: plugin found at ${result.pluginRoot} but missing ${DISPATCHER_REL}\n`)
        process.exit(3)
    }
    if (result.depsMissing) {
        process.stderr.write(`${SELF}: plugin at ${result.pluginRoot} is installed but dependencies missing — run \`copilot plugin update\` / \`npm install\` in ${result.pluginRoot}\n`)
    }

    const dispatcher = path.join(result.pluginRoot, 'bin', 'ralph-overview.mjs')
    // Default --repo to the consumer git root when not supplied, so `pnpm
    // overview` in any subdir of the consumer repo still targets the right root.
    const finalArgs = argv.length === 0
        ? []
        : hasRepo
            ? argv
            : [argv[0], '--repo', repoRoot, ...argv.slice(1)]

    const childEnv = { ...process.env, RALPH_OVERVIEW_PLUGIN_ROOT: result.pluginRoot }
    // Pass the resolved config path down so the wrapper and plugin read ONE
    // config source. We set it only when that file EXISTS: the plugin's
    // loadConfig treats an explicit OVERVIEW_CONFIG_PATH as REQUIRED (throws if
    // missing), so forcing a non-existent path would break a generic consumer
    // that has no .ralph-overview/config.json. An OVERVIEW_CONFIG_PATH the
    // caller already exported is inherited unchanged via { ...process.env }
    // (strict explicit override: if the caller points it at a missing file, the
    // plugin surfaces a clear "Config file not found" error rather than the
    // wrapper silently dropping the caller's explicit choice).
    if (configExists) {
        childEnv.OVERVIEW_CONFIG_PATH = configPath
    }

    const child = spawn(process.execPath, [dispatcher, ...finalArgs], {
        stdio: 'inherit',
        env: childEnv,
    })
    child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)))
    // Forward interrupt/terminate to the child. On Windows these signals are
    // best-effort: Node maps child.kill('SIGINT'/'SIGTERM') onto a terminate,
    // which is sufficient to tear down the spawned dispatcher.
    process.on('SIGINT', () => child.kill('SIGINT'))
    process.on('SIGTERM', () => child.kill('SIGTERM'))
}

// Correct ESM main-module guard: compare the resolved file path to argv[1].
// `import.meta.url === process.argv[1]` (a file:// URL vs a path) is ALWAYS
// false, so the historical wrapper bug never dispatched under that form.
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
    main()
}
