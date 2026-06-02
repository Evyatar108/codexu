#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const repoRoot = process.cwd();
const deepMode = process.argv.includes('--deep');

const expectedSubmodule = {
    path: 'ai-developer-toolkit',
    url: 'https://github.com/evmitran_microsoft/ai-developer-toolkit.git',
};

const expectedPlugins = new Map([
    [
        'ralph-overview',
        {
            source: 'ai-developer-toolkit/plugins/ralph-overview/.claude-plugin/plugin.json',
            manifest: 'ai-developer-toolkit/plugins/ralph-overview/.claude-plugin/plugin.json',
        },
    ],
    [
        'crews',
        {
            source: 'ai-developer-toolkit/plugins/crews/.claude-plugin/plugin.json',
            manifest: 'ai-developer-toolkit/plugins/crews/.claude-plugin/plugin.json',
        },
    ],
    [
        'ralph',
        {
            manifestName: 'ralph-orchestration',
            source: 'ai-developer-toolkit/plugins/ralph/.claude-plugin/plugin.json',
            manifest: 'ai-developer-toolkit/plugins/ralph/.claude-plugin/plugin.json',
        },
    ],
]);

const semverPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const failures = [];

function readText(relativePath) {
    return readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function addMismatch(label, expected, actual) {
    failures.push(`${label}\n  - expected: ${expected}\n  + actual:   ${actual ?? '<missing>'}`);
}

function parseGitmodules(text) {
    const modules = new Map();
    let currentName = null;

    for (const rawLine of text.split(/\r?\n/)) {
        const section = rawLine.match(/^\s*\[submodule\s+"(.+)"\]\s*$/);
        if (section) {
            currentName = section[1];
            modules.set(currentName, {});
            continue;
        }

        const setting = rawLine.match(/^\s*([^=]+?)\s*=\s*(.*?)\s*$/);
        if (currentName && setting) {
            modules.get(currentName)[setting[1].trim()] = setting[2].trim();
        }
    }

    return modules;
}

function getGitlink(relativePath) {
    try {
        const output = execFileSync('git', ['ls-tree', 'HEAD', relativePath], {
            cwd: repoRoot,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
        }).trim();
        const match = output.match(/^160000 commit ([0-9a-f]{40})\t(.+)$/);
        return match ? { sha: match[1], path: match[2], raw: output } : { raw: output };
    } catch (error) {
        return { error: error.stderr?.toString().trim() || error.message };
    }
}

function parseActivePluginVersions(text) {
    const block = text.match(/<!-- BEGIN: active-plugin-versions -->([\s\S]*?)<!-- END: active-plugin-versions -->/);
    if (!block) {
        failures.push('AGENTS.md is missing the active-plugin-versions block.');
        return new Map();
    }

    const rows = new Map();
    for (const line of block[1].split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('|') || trimmed.includes('---') || trimmed.includes('Plugin')) {
            continue;
        }

        const cells = trimmed
            .slice(1, -1)
            .split('|')
            .map((cell) => cell.trim());
        if (cells.length !== 3) {
            failures.push(`Malformed active-plugin-versions table row: ${trimmed}`);
            continue;
        }

        const plugin = cells[0].match(/`([^`]+)`/)?.[1];
        const version = cells[1].match(/`?([^`\s]+)`?/)?.[1];
        const source = cells[2].match(/`([^`]+)`/)?.[1];
        if (!plugin || !version || !source) {
            failures.push(`Malformed active-plugin-versions table row: ${trimmed}`);
            continue;
        }

        rows.set(plugin, { version, source, raw: trimmed });
    }

    return rows;
}

function checkGitmodules() {
    const modules = parseGitmodules(readText('.gitmodules'));
    const moduleEntry = modules.get(expectedSubmodule.path);
    if (!moduleEntry) {
        failures.push(`.gitmodules is missing submodule "${expectedSubmodule.path}".`);
        return;
    }

    if (moduleEntry.path !== expectedSubmodule.path) {
        addMismatch('.gitmodules ai-developer-toolkit path mismatch', expectedSubmodule.path, moduleEntry.path);
    }
    if (moduleEntry.url !== expectedSubmodule.url) {
        addMismatch('.gitmodules ai-developer-toolkit url mismatch', expectedSubmodule.url, moduleEntry.url);
    }
}

function checkGitlink() {
    const gitlink = getGitlink(expectedSubmodule.path);
    if (gitlink.error) {
        failures.push(`Unable to inspect ai-developer-toolkit gitlink: ${gitlink.error}`);
        return;
    }
    if (gitlink.path !== expectedSubmodule.path || !gitlink.sha) {
        failures.push(`ai-developer-toolkit gitlink is not well-formed.\n  git ls-tree output: ${gitlink.raw || '<empty>'}`);
    }
}

function checkAgentsBlock() {
    const rows = parseActivePluginVersions(readText('AGENTS.md'));
    for (const [plugin, expected] of expectedPlugins) {
        const actual = rows.get(plugin);
        if (!actual) {
            failures.push(`AGENTS.md active-plugin-versions is missing ${plugin}.`);
            continue;
        }
        if (!semverPattern.test(actual.version)) {
            failures.push(`AGENTS.md ${plugin} version is not valid semver: ${actual.version}`);
        }
        if (actual.source !== expected.source) {
            addMismatch(`AGENTS.md ${plugin} source mismatch`, expected.source, actual.source);
        }
    }

    for (const plugin of rows.keys()) {
        if (!expectedPlugins.has(plugin)) {
            failures.push(`AGENTS.md active-plugin-versions has unexpected plugin row: ${plugin}`);
        }
    }

    return rows;
}

function checkDeepVersions(rows) {
    for (const [plugin, expected] of expectedPlugins) {
        const manifestPath = path.join(repoRoot, expected.manifest);
        if (!existsSync(manifestPath)) {
            failures.push(`--deep requires initialized submodule manifest: ${expected.manifest}`);
            continue;
        }

        const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
        const expectedName = expected.manifestName ?? plugin;
        if (manifest.name !== expectedName) {
            addMismatch(`${expected.manifest} name mismatch`, expectedName, manifest.name);
        }

        const documented = rows.get(plugin)?.version;
        if (manifest.version !== documented) {
            addMismatch(`${plugin} documented version differs from submodule manifest`, manifest.version, documented);
        }
    }
}

checkGitmodules();
checkGitlink();
const rows = checkAgentsBlock();
if (deepMode) {
    checkDeepVersions(rows);
}

if (failures.length > 0) {
    console.error('Toolkit submodule invariant check failed:');
    for (const failure of failures) {
        console.error(`\n${failure}`);
    }
    process.exit(1);
}

const mode = deepMode ? 'metadata + deep manifest' : 'metadata-only';
console.log(`Toolkit submodule invariant check passed (${mode}).`);
