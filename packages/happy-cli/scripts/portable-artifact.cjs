#!/usr/bin/env node

/**
 * Builds and verifies the local-only Windows Happy portable artifact.
 *
 * This helper deliberately has no publishing or OneDrive code. The PowerShell
 * entry point supplies a repository root and a local staging directory; every
 * write is confined to that staging directory.
 */

'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const yaml = require('yaml');

const NODE_VERSION = 'v22.23.1';
const NODE_ARCHIVE = `node-${NODE_VERSION}-win-x64.zip`;
const NODE_URL = `https://nodejs.org/dist/${NODE_VERSION}/${NODE_ARCHIVE}`;
const NODE_SHA256 = '7DF0BC9375723F4A86B3AA1B7CC73342423D9677A8DF4538ACA31A049E309C29';
const ARCHIVE_NAME = 'happy-win32-x64.zip';
const MAX_FILES = 100000;
const MAX_FILE_BYTES = 1024 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 4 * 1024 * 1024 * 1024;
const NON_RUNTIME_DIRECTORY_NAMES = new Set([
    'test',
    'tests',
    '__tests__',
    'fixture',
    'fixtures',
    '__fixtures__',
    'example',
    'examples',
    'bench',
    'benchmark',
    'benchmarks',
    'coverage'
]);
const DEVELOPMENT_PACKAGE_NAMES = [
    '@esbuild',
    '@rollup',
    '@vitest',
    'typescript',
    'vitest',
    'tsx',
    'vite',
    'vite-node',
    'esbuild',
    'rollup',
    'vite-tsconfig-paths',
    'tsconfck'
];
const FORBIDDEN_EXACT_NAMES = new Set([
    '.env',
    '.modules.yaml',
    '.npmrc',
    '.pnpmfile.cjs',
    '.pnpm-workspace-state-v1.json',
    '.yarnrc',
    'credentials',
    'credentials.json',
    'lock.yaml',
    'providers.json'
]);
const PNPM_METADATA_NAMES = new Set([
    '.modules.yaml',
    '.pnpm-workspace-state-v1.json',
    'lock.yaml'
]);
const SPDX_LICENSE_IDS = new Set([
    '0BSD',
    'AFL-2.1',
    'Apache-2.0',
    'BlueOak-1.0.0',
    'BSD-2-Clause',
    'BSD-3-Clause',
    'CC0-1.0',
    'ISC',
    'LGPL-3.0-or-later',
    'MIT',
    'Unlicense'
]);
const SPDX_EXCEPTION_IDS = new Set([
    'Autoconf-exception-3.0',
    'Bison-exception-2.2',
    'Classpath-exception-2.0',
    'LLVM-exception'
]);
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;

function fail(message) {
    throw new Error(message);
}

function ensure(condition, message) {
    if (!condition) fail(message);
}

function pathKey(target) {
    return path.resolve(target).replace(/[\\/]+$/, '').toLowerCase();
}

function isPathInside(target, root, allowRoot = false) {
    const candidate = pathKey(target);
    const parent = pathKey(root);
    return (allowRoot && candidate === parent) || candidate.startsWith(`${parent}${path.sep}`);
}

function realpathOrResolved(target) {
    const fullPath = path.resolve(target);
    if (fs.existsSync(fullPath)) return fs.realpathSync.native(fullPath);
    let existing = fullPath;
    while (!fs.existsSync(existing)) {
        const parent = path.dirname(existing);
        ensure(parent !== existing, `Unable to find an existing parent for ${fullPath}.`);
        existing = parent;
    }
    return path.resolve(fs.realpathSync.native(existing), path.relative(existing, fullPath));
}

function inspectPathComponents(target, inspect = (component) => {
    const stats = fs.lstatSync(component);
    const resolved = fs.realpathSync.native(component);
    return {
        isReparse: stats.isSymbolicLink() || pathKey(resolved) !== pathKey(component),
        resolved
    };
}) {
    const fullPath = path.resolve(target);
    const parsed = path.parse(fullPath);
    const components = [];
    let current = parsed.root;
    if (fs.existsSync(current)) components.push({ path: current, ...inspect(current) });
    for (const segment of fullPath.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
        current = path.join(current, segment);
        if (!fs.existsSync(current)) break;
        components.push({ path: current, ...inspect(current) });
    }
    return components;
}

function assertPathComponentsSafe(components) {
    const redirected = components.find((component) => component.isReparse);
    ensure(!redirected, `Reparse/junction path component is forbidden: ${redirected?.path}`);
}

function assertSafeOwnedPath(target, repoRoot, options = {}) {
    const fullPath = path.resolve(target);
    const fullRoot = path.resolve(repoRoot);
    ensure(isPathInside(fullPath, fullRoot, Boolean(options.allowRoot)),
        `Path must be inside the repository worktree: ${fullPath}`);
    const components = inspectPathComponents(fullPath);
    assertPathComponentsSafe(components);
    const resolvedRoot = fs.realpathSync.native(fullRoot);
    const resolvedTarget = realpathOrResolved(fullPath);
    ensure(isPathInside(resolvedTarget, resolvedRoot, Boolean(options.allowRoot)),
        `Resolved path escapes the repository worktree: ${resolvedTarget}`);
    ensure(!isUnderOneDrive(resolvedTarget), `Resolved path must not be inside OneDrive: ${resolvedTarget}`);
    return { path: fullPath, resolvedPath: resolvedTarget };
}

function isUnderOneDrive(target) {
    const candidate = realpathOrResolved(target);
    return ['OneDrive', 'OneDriveCommercial', 'OneDriveConsumer']
        .map((name) => process.env[name])
        .filter(Boolean)
        .some((root) => isPathInside(candidate, realpathOrResolved(root), true));
}

function isTypeScriptSource(name) {
    return /\.(?:ts|mts|cts)$/i.test(name)
        && !/\.d\.(?:ts|mts|cts)$/i.test(name);
}

function sha256File(filePath) {
    const hash = crypto.createHash('sha256');
    const descriptor = fs.openSync(filePath, 'r');
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    try {
        let count;
        do {
            count = fs.readSync(descriptor, buffer, 0, buffer.length, null);
            if (count) hash.update(buffer.subarray(0, count));
        } while (count);
    } finally {
        fs.closeSync(descriptor);
    }
    return hash.digest('hex').toUpperCase();
}

function sha256Bytes(bytes) {
    return crypto.createHash('sha256').update(bytes).digest('hex').toUpperCase();
}

function writeJson(filePath, value) {
    fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function run(command, args, options = {}) {
    const isPnpmOnWindows = process.platform === 'win32' && command === 'pnpm';
    const executable = isPnpmOnWindows ? process.env.ComSpec || 'cmd.exe' : command;
    const executableArgs = isPnpmOnWindows ? ['/d', '/s', '/c', 'pnpm.cmd', ...args] : args;
    const result = spawnSync(executable, executableArgs, {
        cwd: options.cwd,
        env: options.env || process.env,
        encoding: 'utf8',
        shell: false,
        stdio: options.capture ? 'pipe' : 'inherit',
        windowsHide: true,
        maxBuffer: 64 * 1024 * 1024
    });
    if (result.error) throw result.error;
    if (result.status !== 0) {
        const detail = options.capture ? `\n${result.stdout || ''}${result.stderr || ''}` : '';
        fail(`${command} exited with code ${result.status}${detail}`);
    }
    return result;
}

function git(repoRoot, args) {
    return run('git', ['--no-pager', ...args], { cwd: repoRoot, capture: true }).stdout.trim();
}

function assertCleanSource(repoRoot) {
    const resolvedGitRoot = path.resolve(git(repoRoot, ['rev-parse', '--show-toplevel']));
    ensure(resolvedGitRoot.toLowerCase() === repoRoot.toLowerCase(),
        `Repository root mismatch: ${repoRoot}`);
    const status = git(repoRoot, ['status', '--porcelain=v1', '--untracked-files=all']);
    ensure(status === '', 'The source commit must be clean before building the portable artifact.');
    const commit = git(repoRoot, ['rev-parse', 'HEAD']);
    const branch = git(repoRoot, ['branch', '--show-current']);
    ensure(/^[0-9a-f]{40}$/i.test(commit), 'Unable to resolve a full source commit.');
    ensure(branch.length > 0, 'Detached HEAD builds are not allowed.');
    return { commit, branch };
}

function enumerateRegularFiles(root) {
    const output = [];
    const pending = [root];
    while (pending.length) {
        const current = pending.pop();
        for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
            const absolute = path.join(current, entry.name);
            const stats = fs.lstatSync(absolute);
            ensure(!stats.isSymbolicLink(), `Reparse/symbolic link is forbidden: ${absolute}`);
            if (stats.isDirectory()) {
                pending.push(absolute);
            } else {
                ensure(stats.isFile(), `Non-regular payload entry is forbidden: ${absolute}`);
                output.push(absolute);
            }
        }
    }
    return output;
}

function removeTree(target, confinementRoot) {
    assertSafeOwnedPath(target, confinementRoot, { allowRoot: false });
    if (fs.existsSync(target)) {
        const stats = fs.lstatSync(target);
        ensure(!stats.isSymbolicLink(), `Refusing to delete a reparse/junction root: ${target}`);
        if (stats.isDirectory()) enumerateRegularFiles(target);
    }
    fs.rmSync(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}

function cleanupExternalPaths(paths, confinementRoot) {
    for (const target of paths) removeTree(target, confinementRoot);
}

function pruneDeployment(deployRoot) {
    let removedFiles = 0;
    let removedBytes = 0;
    const directories = [];
    const pending = [deployRoot];
    while (pending.length) {
        const current = pending.pop();
        for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
            if (!entry.isDirectory()) continue;
            const absolute = path.join(current, entry.name);
            if (NON_RUNTIME_DIRECTORY_NAMES.has(entry.name.toLowerCase())
                || entry.name.toLowerCase() === '.cache') {
                directories.push(absolute);
            } else {
                pending.push(absolute);
            }
        }
    }
    directories.sort((left, right) => right.length - left.length);
    for (const directory of directories) {
        if (!fs.existsSync(directory)) continue;
        const files = enumerateRegularFiles(directory);
        removedFiles += files.length;
        removedBytes += files.reduce((sum, file) => sum + fs.statSync(file).size, 0);
        removeTree(directory, deployRoot);
    }

    for (const packageName of DEVELOPMENT_PACKAGE_NAMES) {
        const packagePath = path.join(deployRoot, 'node_modules', ...packageName.split('/'));
        if (!fs.existsSync(packagePath)) continue;
        const files = enumerateRegularFiles(packagePath);
        removedFiles += files.length;
        removedBytes += files.reduce((sum, file) => sum + fs.statSync(file).size, 0);
        removeTree(packagePath, deployRoot);
    }
    const virtualStoreMetadata = path.join(deployRoot, 'node_modules', '.pnpm');
    if (fs.existsSync(virtualStoreMetadata)) {
        const files = enumerateRegularFiles(virtualStoreMetadata);
        removedFiles += files.length;
        removedBytes += files.reduce((sum, file) => sum + fs.statSync(file).size, 0);
        removeTree(virtualStoreMetadata, deployRoot);
    }
    for (const builderScript of ['portable-artifact.cjs', 'portable-zip.ps1']) {
        const builderPath = path.join(deployRoot, 'scripts', builderScript);
        if (!fs.existsSync(builderPath)) continue;
        removedFiles += 1;
        removedBytes += fs.statSync(builderPath).size;
        fs.unlinkSync(builderPath);
    }

    const archives = path.join(deployRoot, 'tools', 'archives');
    if (fs.existsSync(archives)) {
        for (const file of fs.readdirSync(archives)) {
            if (/-(?:arm64|x64)-(?:darwin|linux)\.tar\.gz$/i.test(file)
                || /-arm64-win32\.tar\.gz$/i.test(file)) {
                const absolute = path.join(archives, file);
                removedFiles += 1;
                removedBytes += fs.statSync(absolute).size;
                fs.unlinkSync(absolute);
            }
        }
    }

    for (const file of enumerateRegularFiles(deployRoot)) {
        const name = path.basename(file).toLowerCase();
        const removeCompiledSource = name.endsWith('.map') || isTypeScriptSource(name);
        const removeTestFile = /\.(test|spec)\.[^.]+$/i.test(name)
            || /\.spec\.json$/i.test(name);
        if (PNPM_METADATA_NAMES.has(name)
            || name === '.env'
            || name.startsWith('.env.')
            || name.endsWith('.log')
            || name.endsWith('.tmp')
            || removeTestFile
            || removeCompiledSource) {
            removedFiles += 1;
            removedBytes += fs.statSync(file).size;
            fs.unlinkSync(file);
        }
    }
    return { removedFiles, removedBytes };
}

function scanForbidden(root) {
    const findings = [];
    const secretPatterns = [
        /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
        /\bgh[oprsu]_[A-Za-z0-9]{30,}\b/,
        /\bsk-(?:ant-)?[A-Za-z0-9_-]{20,}\b/,
        /\bAKIA[0-9A-Z]{16}\b/
    ];
    for (const file of enumerateRegularFiles(root)) {
        const relative = path.relative(root, file).split(path.sep).join('/');
        const segments = relative.toLowerCase().split('/');
        const base = segments.at(-1);
        if (segments.includes('.git')
            || segments.includes('.pnpm')
            || segments.includes('.cache')
            || segments.includes('.happy')
            || segments.includes('.claude')
            || segments.includes('.codex')
            || segments.includes('coverage')
            || NON_RUNTIME_DIRECTORY_NAMES.has(segments.at(-2))
            || FORBIDDEN_EXACT_NAMES.has(base)
            || base.startsWith('.env.')
            || base.endsWith('.log')
            || base.endsWith('.tmp')
            || base.endsWith('.map')
            || isTypeScriptSource(base)
            || /\.(test|spec)\.[^.]+$/i.test(base)) {
            findings.push(relative);
            continue;
        }
        const stats = fs.statSync(file);
        if (stats.size <= 5 * 1024 * 1024
            && /\.(?:json|txt|yaml|yml|ini|cfg|conf)$/i.test(base)) {
            const text = fs.readFileSync(file, 'utf8');
            if (secretPatterns.some((pattern) => pattern.test(text))) findings.push(`${relative} (secret pattern)`);
        }
    }
    ensure(findings.length === 0, `Forbidden payload content:\n${findings.slice(0, 30).join('\n')}`);
}

function scanMachineMetadata(root, markers) {
    const findings = [];
    const normalizedMarkers = [...new Set(markers
        .filter(Boolean)
        .flatMap((marker) => {
            const resolved = path.resolve(marker);
            return [resolved, resolved.replace(/\\/g, '/'), resolved.replace(/\//g, '\\')];
        })
        .map((marker) => marker.toLowerCase()))];
    for (const file of enumerateRegularFiles(root)) {
        const relative = path.relative(root, file).split(path.sep).join('/');
        const base = path.basename(file).toLowerCase();
        if (PNPM_METADATA_NAMES.has(base)) {
            findings.push(`${relative} (pnpm metadata)`);
            continue;
        }
        const stats = fs.statSync(file);
        if (stats.size > 5 * 1024 * 1024
            || !/\.(?:json|ya?ml|ini|cfg|conf|txt|cjs|mjs|js)$/i.test(base)) continue;
        const text = fs.readFileSync(file, 'utf8').toLowerCase();
        if (normalizedMarkers.some((marker) => marker.length >= 3 && text.includes(marker))) {
            findings.push(`${relative} (machine path)`);
        }
        if (/(?:storeDir|virtualStoreDir)\s*[:=]/i.test(text)
            || /node_modules[\\/]\.pnpm[\\/](?:store|v\d+)/i.test(text)) {
            findings.push(`${relative} (pnpm store path)`);
        }
    }
    ensure(findings.length === 0,
        `Machine-specific package-manager metadata found:\n${findings.slice(0, 30).join('\n')}`);
}

function createLockPins(repoRoot, workRoot) {
    const lockPath = path.join(repoRoot, 'pnpm-lock.yaml');
    const lock = yaml.parse(fs.readFileSync(lockPath, 'utf8'));
    const importerNames = ['packages/happy-cli', 'packages/happy-server', 'packages/happy-wire'];
    const importerPins = {};
    for (const importerName of importerNames) {
        const importer = lock.importers[importerName];
        ensure(importer, `pnpm-lock.yaml is missing importer ${importerName}.`);
        const packageName = JSON.parse(fs.readFileSync(path.join(repoRoot, importerName, 'package.json'), 'utf8')).name;
        importerPins[packageName] = {};
        for (const field of ['dependencies', 'optionalDependencies']) {
            for (const [name, record] of Object.entries(importer[field] || {})) {
                importerPins[packageName][name] = String(record.version).replace(/\(.+$/, '');
            }
        }
    }
    const maps = {};
    const pairs = {};
    const versionFromSnapshotReference = (reference) => {
        const value = String(reference);
        if (value.startsWith('link:') || value.startsWith('workspace:')) return value;
        return value.replace(/\(.+$/, '');
    };
    for (const [snapshotKey, snapshot] of Object.entries(lock.snapshots || {})) {
        const peerStart = snapshotKey.indexOf('(');
        const baseKey = peerStart === -1 ? snapshotKey : snapshotKey.slice(0, peerStart);
        const separator = baseKey.lastIndexOf('@');
        const name = baseKey.slice(0, separator);
        const version = versionFromSnapshotReference(baseKey.slice(separator + 1));
        const key = `${name}@${version}`;
        pairs[key] = true;
        maps[key] ||= {};
        for (const field of ['dependencies', 'optionalDependencies']) {
            for (const [dependencyName, reference] of Object.entries(snapshot[field] || {})) {
                const dependencyVersion = versionFromSnapshotReference(reference);
                if (!dependencyVersion.startsWith('link:') && !dependencyVersion.startsWith('workspace:')) {
                    maps[key][dependencyName] = dependencyVersion;
                }
            }
        }
    }

    const peerPins = {
        '@types/node': versionFromSnapshotReference(
            lock.importers['packages/happy-cli'].devDependencies['@types/node'].version
        ),
        yaml: versionFromSnapshotReference(
            lock.importers['packages/happy-server'].devDependencies.yaml.version
        )
    };
    const pinsPath = path.join(workRoot, 'deploy-pins.json');
    writeJson(pinsPath, { maps, pairs, importerPins, peerPins });
    const hookPath = path.join(workRoot, 'pnpmfile.cjs');
    fs.writeFileSync(hookPath, [
        "'use strict';",
        "const data = require(process.env.HAPPY_PORTABLE_DEPLOY_PINS);",
        'module.exports = { hooks: { readPackage(pkg) {',
        "  const pins = data.importerPins[pkg.name] || data.maps[`${pkg.name}@${String(pkg.version).replace(/^v(?=\\d)/, '')}`];",
        '  if (pins) {',
        "    for (const field of ['dependencies', 'optionalDependencies']) {",
        '      for (const name of Object.keys(pkg[field] || {})) {',
        "        if (pins[name] && !String(pkg[field][name]).startsWith('workspace:')) pkg[field][name] = pins[name];",
        '      }',
        '    }',
        '  }',
        "  for (const [name, version] of Object.entries(data.peerPins)) {",
        "    if (pkg.peerDependencies && pkg.peerDependencies[name]) { pkg.peerDependencies[name] = version; }",
        '  }',
        '  return pkg;',
        '} } };',
        ''
    ].join('\n'), 'ascii');
    return { pinsPath, hookPath, pairs };
}

function normalizeVersion(version) {
    return String(version).replace(/^v(?=\d)/, '');
}

function verifyDeployedVersions(deployRoot, expectedPairs) {
    const allowedByName = {};
    for (const pair of Object.keys(expectedPairs)) {
        const separator = pair.lastIndexOf('@');
        const name = pair.slice(0, separator);
        const version = normalizeVersion(pair.slice(separator + 1));
        allowedByName[name] ||= new Set();
        allowedByName[name].add(version);
    }
    const workspaceVersions = new Map([
        ['happy', normalizeVersion(JSON.parse(fs.readFileSync(path.join(deployRoot, 'package.json'), 'utf8')).version)],
        ['happy-server', '0.0.0'],
        ['@slopus/happy-wire', '0.1.0']
    ]);
    const mismatches = [];
    const seen = new Set();
    for (const file of enumerateRegularFiles(deployRoot).filter((item) => path.basename(item) === 'package.json')) {
        const relative = path.relative(deployRoot, file).split(path.sep).join('/');
        if (relative !== 'package.json'
            && !/(?:^|\/)node_modules\/(?:@[^/]+\/)?[^/]+\/package\.json$/.test(relative)) continue;
        let manifest;
        try {
            manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
        } catch {
            continue;
        }
        if (!manifest.name || !manifest.version) continue;
        const version = normalizeVersion(manifest.version);
        const key = `${manifest.name}@${version}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const allowed = allowedByName[manifest.name];
        const workspaceVersion = workspaceVersions.get(manifest.name);
        if ((!allowed || !allowed.has(version)) && workspaceVersion !== version) {
            mismatches.push(`${key} (${relative})`);
        }
    }
    ensure(mismatches.length === 0,
        `Legacy deploy resolved versions outside pnpm-lock.yaml:\n${mismatches.slice(0, 30).join('\n')}`);
    return seen.size;
}

function downloadNode(downloadRoot, confinementRoot) {
    assertSafeOwnedPath(downloadRoot, confinementRoot, { allowRoot: false });
    fs.mkdirSync(downloadRoot, { recursive: true });
    const archivePath = path.join(downloadRoot, NODE_ARCHIVE);
    assertSafeOwnedPath(archivePath, confinementRoot, { allowRoot: false });
    if (!fs.existsSync(archivePath) || sha256File(archivePath) !== NODE_SHA256) {
        fs.rmSync(archivePath, { force: true });
        const response = spawnSync('curl.exe', [
            '--fail',
            '--location',
            '--proto',
            '=https',
            '--tlsv1.2',
            '--output',
            archivePath,
            NODE_URL
        ], { stdio: 'inherit', windowsHide: true });
        if (response.error) throw response.error;
        ensure(response.status === 0, `Unable to download pinned Node from ${NODE_URL}.`);
    }
    ensure(sha256File(archivePath) === NODE_SHA256, 'Pinned Node distribution hash mismatch.');
    return archivePath;
}

function readPackageRoots(deployRoot) {
    const roots = [];
    for (const file of enumerateRegularFiles(deployRoot).filter((item) => path.basename(item) === 'package.json')) {
        const relative = path.relative(deployRoot, file).split(path.sep).join('/');
        if (relative !== 'package.json'
            && !/(?:^|\/)node_modules\/(?:@[^/]+\/)?[^/]+\/package\.json$/.test(relative)) continue;
        try {
            const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
            if (manifest.name && manifest.version) roots.push({ file, relative, manifest });
        } catch {
            // Broken nested fixture manifests are pruned and are not package roots.
        }
    }
    return roots;
}

function spdxId(value) {
    const clean = value.replace(/[^A-Za-z0-9.-]/g, '-');
    return `SPDXRef-Package-${clean}-${sha256Bytes(value).slice(0, 12)}`;
}

function isValidSpdxExpression(expression) {
    if (typeof expression !== 'string' || expression.trim() === '') return false;
    const tokens = [];
    for (let index = 0; index < expression.length;) {
        if (/\s/.test(expression[index])) {
            index += 1;
            continue;
        }
        if (expression[index] === '(' || expression[index] === ')') {
            tokens.push(expression[index]);
            index += 1;
            continue;
        }
        const match = /^[A-Za-z0-9.+-]+/.exec(expression.slice(index));
        if (!match) return false;
        tokens.push(match[0]);
        index += match[0].length;
    }
    let position = 0;
    const parsePrimary = () => {
        if (tokens[position] === '(') {
            position += 1;
            if (!parseOr() || tokens[position] !== ')') return false;
            position += 1;
            return true;
        }
        const license = tokens[position];
        if (!license || (!SPDX_LICENSE_IDS.has(license) && !/^LicenseRef-[A-Za-z0-9.-]+$/.test(license))) {
            return false;
        }
        position += 1;
        if (tokens[position] === 'WITH') {
            position += 1;
            if (!SPDX_EXCEPTION_IDS.has(tokens[position])) return false;
            position += 1;
        }
        return true;
    };
    const parseAnd = () => {
        if (!parsePrimary()) return false;
        while (tokens[position] === 'AND') {
            position += 1;
            if (!parsePrimary()) return false;
        }
        return true;
    };
    const parseOr = () => {
        if (!parseAnd()) return false;
        while (tokens[position] === 'OR') {
            position += 1;
            if (!parseAnd()) return false;
        }
        return true;
    };
    return parseOr() && position === tokens.length;
}

function normalizeLicense(packageRoot, manifest, identity) {
    const rawDeclared = typeof manifest.license === 'string' && manifest.license.trim()
        ? manifest.license.trim()
        : null;
    const evidenceFiles = fs.readdirSync(packageRoot, { withFileTypes: true })
        .filter((entry) => entry.isFile() && /^(LICENSE|LICENCE|COPYING|NOTICE)(\..*)?$/i.test(entry.name))
        .map((entry) => path.join(packageRoot, entry.name));
    const referenced = rawDeclared && /^SEE LICEN[CS]E IN (.+)$/i.exec(rawDeclared);
    if (referenced) {
        const reference = referenced[1].trim();
        const referencedPath = path.resolve(packageRoot, reference);
        if (isPathInside(referencedPath, packageRoot, false)
            && fs.existsSync(referencedPath)
            && fs.lstatSync(referencedPath).isFile()) {
            evidenceFiles.push(referencedPath);
        }
    }
    const uniqueEvidence = [...new Map(evidenceFiles.map((file) => [pathKey(file), file])).values()];
    if (!rawDeclared) {
        ensure(uniqueEvidence.length > 0, `Package has no declared license or license evidence: ${identity}`);
        return {
            declared: 'NOASSERTION',
            rawDeclared: null,
            normalization: 'missing-declaration',
            evidenceFiles: uniqueEvidence,
            extractedLicense: null
        };
    }
    if (isValidSpdxExpression(rawDeclared)) {
        return {
            declared: rawDeclared,
            rawDeclared,
            normalization: 'valid-spdx',
            evidenceFiles: uniqueEvidence,
            extractedLicense: null
        };
    }
    const licenseId = `LicenseRef-Npm-${sha256Bytes(`${identity}\n${rawDeclared}`).slice(0, 16)}`;
    const evidenceText = uniqueEvidence.map((file) => {
        const relative = path.relative(packageRoot, file).split(path.sep).join('/');
        const content = fs.readFileSync(file, 'utf8');
        return `--- ${relative} ---\n${content}`;
    }).join('\n\n');
    return {
        declared: licenseId,
        rawDeclared,
        normalization: 'invalid-npm-declaration',
        evidenceFiles: uniqueEvidence,
        extractedLicense: {
            licenseId,
            extractedText: evidenceText || rawDeclared,
            comment: `Normalized invalid npm license declaration: ${rawDeclared}`
        }
    };
}

function buildSbom(deployRoot, payloadRoot, source, artifactId, outputPath, licenseInventoryPath) {
    const packages = [];
    const relationships = [];
    const licenseInventory = [];
    const extractedLicenses = [];
    const seen = new Set();
    for (const item of readPackageRoots(deployRoot)) {
        const version = normalizeVersion(item.manifest.version);
        const identity = `${item.manifest.name}@${version}`;
        if (seen.has(identity)) continue;
        seen.add(identity);
        const packageRoot = path.dirname(item.file);
        const license = normalizeLicense(packageRoot, item.manifest, identity);
        if (license.extractedLicense) extractedLicenses.push(license.extractedLicense);
        const id = spdxId(identity);
        packages.push({
            name: item.manifest.name,
            SPDXID: id,
            versionInfo: version,
            downloadLocation: 'NOASSERTION',
            filesAnalyzed: false,
            licenseConcluded: 'NOASSERTION',
            licenseDeclared: license.declared,
            copyrightText: 'NOASSERTION',
            externalRefs: [{
                referenceCategory: 'PACKAGE-MANAGER',
                referenceType: 'purl',
                referenceLocator: `pkg:npm/${encodeURIComponent(item.manifest.name)}@${encodeURIComponent(version)}`
            }]
        });
        relationships.push({
            spdxElementId: 'SPDXRef-DOCUMENT',
            relationshipType: 'DESCRIBES',
            relatedSpdxElement: id
        });
        licenseInventory.push({
            name: item.manifest.name,
            version,
            declared: license.declared,
            rawDeclared: license.rawDeclared,
            normalization: license.normalization,
            files: license.evidenceFiles.map((file) => ({
                relativePath: `payload/${path.relative(payloadRoot, file).split(path.sep).join('/')}`,
                sha256: sha256File(file),
                length: fs.statSync(file).size
            }))
        });
    }
    const nodeLicense = path.join(payloadRoot, 'NODE-LICENSE.txt');
    ensure(fs.existsSync(nodeLicense), 'Payload is missing the portable Node license.');
    const nodeIdentity = `node@${NODE_VERSION.slice(1)}`;
    const nodeId = spdxId(nodeIdentity);
    packages.push({
        name: 'node',
        SPDXID: nodeId,
        versionInfo: NODE_VERSION.slice(1),
        downloadLocation: NODE_URL,
        filesAnalyzed: false,
        licenseConcluded: 'NOASSERTION',
        licenseDeclared: 'MIT',
        copyrightText: 'NOASSERTION',
        externalRefs: [{
            referenceCategory: 'PACKAGE-MANAGER',
            referenceType: 'purl',
            referenceLocator: `pkg:generic/node@${NODE_VERSION.slice(1)}`
        }]
    });
    relationships.push({
        spdxElementId: 'SPDXRef-DOCUMENT',
        relationshipType: 'DESCRIBES',
        relatedSpdxElement: nodeId
    });
    licenseInventory.push({
        name: 'node',
        version: NODE_VERSION.slice(1),
        declared: 'MIT',
        rawDeclared: 'MIT',
        normalization: 'valid-spdx',
        files: [{
            relativePath: 'payload/NODE-LICENSE.txt',
            sha256: sha256File(nodeLicense),
            length: fs.statSync(nodeLicense).size
        }]
    });
    packages.sort((left, right) => `${left.name}@${left.versionInfo}`.localeCompare(`${right.name}@${right.versionInfo}`));
    licenseInventory.sort((left, right) => `${left.name}@${left.version}`.localeCompare(`${right.name}@${right.version}`));
    extractedLicenses.sort((left, right) => left.licenseId.localeCompare(right.licenseId));
    const created = new Date().toISOString();
    const sbom = {
        spdxVersion: 'SPDX-2.3',
        dataLicense: 'CC0-1.0',
        SPDXID: 'SPDXRef-DOCUMENT',
        name: `Happy portable ${artifactId}`,
        documentNamespace: `https://github.com/Evyatar108/happy/spdx/${source.commit}/${artifactId}`,
        creationInfo: {
            created,
            creators: ['Tool: happy-portable-artifact-builder']
        },
        packages,
        relationships,
        hasExtractedLicensingInfos: extractedLicenses
    };
    writeJson(outputPath, sbom);
    writeJson(licenseInventoryPath, {
        schemaVersion: 1,
        artifactId,
        generatedAtUtc: created,
        packages: licenseInventory
    });
    return packages.length;
}

function assertZipPath(entryName, seen) {
    ensure(typeof entryName === 'string' && entryName.length > 0, 'ZIP entry name is empty.');
    const name = entryName.replace(/\\/g, '/');
    ensure(name === entryName, `ZIP entry uses a backslash: ${entryName}`);
    ensure(!name.startsWith('/') && !name.startsWith('//'), `ZIP entry is rooted: ${entryName}`);
    ensure(!/^[A-Za-z]:/.test(name), `ZIP entry uses a drive: ${entryName}`);
    const segments = name.split('/');
    const contentSegments = name.endsWith('/') ? segments.slice(0, -1) : segments;
    ensure(contentSegments.length > 0 && contentSegments.every((segment) => segment !== '' && segment !== '.' && segment !== '..'),
        `ZIP entry has an unsafe segment: ${entryName}`);
    for (const segment of contentSegments) {
        ensure(!segment.includes(':'), `ZIP entry uses ADS syntax: ${entryName}`);
        ensure(!/[ .]$/.test(segment), `ZIP entry has a trailing dot/space: ${entryName}`);
        ensure(!WINDOWS_RESERVED.test(segment), `ZIP entry uses a reserved device name: ${entryName}`);
    }
    const key = name.toLowerCase();
    ensure(!seen.has(key), `ZIP entry collides case-insensitively: ${entryName}`);
    seen.add(key);
    return name;
}

function verifyAndExtractArchive(archivePath, manifestPath, extractionRoot, confinementRoot) {
    assertSafeOwnedPath(extractionRoot, confinementRoot, { allowRoot: false });
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    ensure(fs.statSync(archivePath).size === manifest.archive.length, 'Archive length mismatch.');
    ensure(sha256File(archivePath) === manifest.archive.sha256, 'Archive SHA-256 mismatch.');
    const declared = new Map(manifest.files.map((file) => [file.relativePath.toLowerCase(), file]));
    run('pwsh', [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        path.join(__dirname, 'portable-zip.ps1'),
        '-ArchivePath',
        archivePath,
        '-ManifestPath',
        manifestPath,
        '-ExtractionRoot',
        extractionRoot,
        '-ConfinementRoot',
        confinementRoot,
        '-ExpectedTimestampUtc',
        manifest.archive.entryTimestampUtc
    ]);

    const actualFiles = enumerateRegularFiles(extractionRoot);
    ensure(actualFiles.length === manifest.files.length, 'Extracted file count mismatch.');
    for (const file of actualFiles) {
        const relative = path.relative(extractionRoot, file).split(path.sep).join('/');
        const expected = declared.get(relative.toLowerCase());
        ensure(expected && expected.relativePath === relative, `Extracted undeclared file: ${relative}`);
        ensure(fs.statSync(file).size === expected.length, `Extracted file length mismatch: ${relative}`);
        ensure(sha256File(file) === expected.sha256, `Extracted file hash mismatch: ${relative}`);
    }
}

function normalizePayloadMetadata(payloadRoot, timestampUtc) {
    const timestamp = new Date(timestampUtc);
    ensure(Number.isFinite(timestamp.getTime()), `Invalid source timestamp: ${timestampUtc}`);
    const paths = enumerateRegularFiles(payloadRoot);
    const directories = [];
    const pending = [payloadRoot];
    while (pending.length) {
        const current = pending.pop();
        directories.push(current);
        for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
            if (entry.isDirectory()) pending.push(path.join(current, entry.name));
        }
    }
    for (const file of paths) {
        fs.chmodSync(file, 0o644);
        fs.utimesSync(file, timestamp, timestamp);
    }
    directories.sort((left, right) => right.length - left.length);
    for (const directory of directories) fs.utimesSync(directory, timestamp, timestamp);
}

function createArchive(payloadRoot, archivePath, inventory, entryTimestampUtc, confinementRoot) {
    assertSafeOwnedPath(archivePath, confinementRoot, { allowRoot: false });
    fs.rmSync(archivePath, { force: true });
    const fileListPath = path.join(path.dirname(payloadRoot), 'archive-files.txt');
    const fileList = inventory.files.map((file) => file.relativePath).join('\n');
    fs.writeFileSync(fileListPath, `${fileList}\n`, 'utf8');
    try {
        run('pwsh', [
            '-NoProfile',
            '-ExecutionPolicy',
            'Bypass',
            '-File',
            path.join(__dirname, 'portable-zip.ps1'),
            '-Create',
            '-PayloadRoot',
            payloadRoot,
            '-ArchivePath',
            archivePath,
            '-FileListPath',
            fileListPath,
            '-ConfinementRoot',
            confinementRoot,
            '-ExpectedTimestampUtc',
            entryTimestampUtc
        ]);
    } finally {
        fs.rmSync(fileListPath, { force: true });
    }
    ensure(fs.existsSync(archivePath), 'ZIP creation did not produce an archive.');
}

function runExternalSmoke(extractionRoot, smokeRoot, confinementRoot) {
    removeTree(smokeRoot, confinementRoot);
    fs.mkdirSync(smokeRoot, { recursive: true });
    const payload = path.join(extractionRoot, 'payload');
    const node = path.join(payload, 'node.exe');
    const happy = path.join(payload, 'happy', 'dist', 'index.mjs');
    ensure(fs.existsSync(node) && fs.existsSync(happy), 'Portable entry points are missing.');
    const emptyPath = path.join(smokeRoot, 'empty-path');
    const home = path.join(smokeRoot, 'home');
    const happyHome = path.join(smokeRoot, 'happy-home');
    fs.mkdirSync(emptyPath);
    fs.mkdirSync(home);
    fs.mkdirSync(happyHome);
    const result = spawnSync(node, [happy, 'copilot', '--help'], {
        cwd: smokeRoot,
        env: {
            SystemRoot: process.env.SystemRoot,
            ComSpec: process.env.ComSpec,
            TEMP: smokeRoot,
            TMP: smokeRoot,
            USERPROFILE: home,
            HOMEDRIVE: path.parse(home).root.replace(/\\$/, ''),
            HOMEPATH: home.slice(path.parse(home).root.length - 1),
            HOME: home,
            PATH: emptyPath,
            HAPPY_HOME_DIR: happyHome,
            HAPPY_ENABLE_COPILOT_NATIVE: '1',
            NODE_OPTIONS: '--no-addons'
        },
        encoding: 'utf8',
        shell: false,
        windowsHide: true,
        timeout: 60000
    });
    if (result.error) throw result.error;
    ensure(result.status === 0, `External smoke failed (${result.status}):\n${result.stdout || ''}${result.stderr || ''}`);
    ensure((result.stdout || '').includes('Usage: HAPPY_ENABLE_COPILOT_NATIVE=1 happy copilot'),
        `External smoke did not print the expected help text:\n${result.stdout || ''}${result.stderr || ''}`);
    const stateFiles = enumerateRegularFiles(happyHome);
    const unexpectedState = stateFiles.filter((file) => {
        const relative = path.relative(happyHome, file).split(path.sep).join('/');
        return !/^logs\/[^/]+\.log$/i.test(relative);
    });
    ensure(unexpectedState.length === 0, `Help smoke wrote unexpected Happy state: ${unexpectedState.join(', ')}`);
    removeTree(happyHome, smokeRoot);
    return `${result.stdout || ''}${result.stderr || ''}`.trim();
}

function inventoryPayload(payloadRoot) {
    const files = enumerateRegularFiles(payloadRoot)
        .map((file) => ({
            relativePath: `payload/${path.relative(payloadRoot, file).split(path.sep).join('/')}`,
            length: fs.statSync(file).size,
            sha256: sha256File(file)
        }))
        .sort((left, right) => left.relativePath.localeCompare(right.relativePath));
    const expandedLength = files.reduce((sum, file) => sum + file.length, 0);
    ensure(files.length > 0 && files.length <= MAX_FILES, 'Payload file count is outside the allowed range.');
    ensure(expandedLength <= MAX_EXPANDED_BYTES, 'Payload expanded size exceeds the allowed range.');
    return { files, expandedLength };
}

async function build(options) {
    const repoRoot = path.resolve(options.repoRoot);
    const outputRoot = path.resolve(options.outputRoot);
    assertSafeOwnedPath(outputRoot, repoRoot, { allowRoot: false });
    fs.mkdirSync(outputRoot, { recursive: true });
    assertSafeOwnedPath(outputRoot, repoRoot, { allowRoot: false });
    const resultPath = options.resultPath ? path.resolve(options.resultPath) : null;
    if (resultPath) assertSafeOwnedPath(resultPath, repoRoot, { allowRoot: false });
    if (resultPath) ensure(!fs.existsSync(resultPath), `Result path already exists: ${resultPath}`);
    const source = assertCleanSource(repoRoot);
    const commitEpochSeconds = Number(git(repoRoot, ['show', '-s', '--format=%ct', source.commit]));
    ensure(Number.isSafeInteger(commitEpochSeconds), 'Unable to resolve the source commit timestamp.');
    source.timestampUtc = new Date(Math.floor(commitEpochSeconds / 2) * 2000).toISOString();
    const packageManifest = JSON.parse(fs.readFileSync(path.join(repoRoot, 'packages', 'happy-cli', 'package.json'), 'utf8'));
    const lockSha256 = sha256File(path.join(repoRoot, 'pnpm-lock.yaml'));
    const pnpmStorePath = run('pnpm', ['store', 'path'], { cwd: repoRoot, capture: true }).stdout.trim();
    const startedAt = new Date().toISOString();
    const artifactId = `${startedAt.replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')}-${source.commit.slice(0, 12)}`;
    const workRoot = path.join(outputRoot, '.work');
    const deployRoot = path.join(workRoot, 'deploy');
    const payloadRoot = path.join(workRoot, 'payload');
    const artifactRoot = path.join(outputRoot, artifactId);
    const downloadRoot = path.join(outputRoot, '.downloads');
    const extractionRoot = path.join(outputRoot, '.external-smoke', artifactId);
    const smokeRoot = path.join(outputRoot, '.smoke-state', artifactId);
    for (const ownedPath of [workRoot, artifactRoot, downloadRoot, extractionRoot, smokeRoot]) {
        assertSafeOwnedPath(ownedPath, repoRoot, { allowRoot: false });
    }
    removeTree(workRoot, repoRoot);
    ensure(!fs.existsSync(artifactRoot), `Immutable artifact already exists: ${artifactRoot}`);
    fs.mkdirSync(workRoot, { recursive: true });
    fs.mkdirSync(payloadRoot, { recursive: true });
    fs.mkdirSync(artifactRoot, { recursive: true });
    let result;
    let completed = false;
    try {
        run('pnpm', ['--filter', '@slopus/happy-wire', 'build'], { cwd: repoRoot });
        run('pnpm', ['--filter', 'happy-server', 'build'], { cwd: repoRoot });
        run('pnpm', ['--filter', 'happy', 'build'], { cwd: repoRoot });

        const pins = createLockPins(repoRoot, workRoot);
        const deployEnv = {
            ...process.env,
            HAPPY_PORTABLE_DEPLOY_PINS: pins.pinsPath
        };
        run('pnpm', [
            '--prefer-offline',
            '--config.auto-install-peers=false',
            '--pnpmfile',
            pins.hookPath,
            '--filter',
            'happy',
            'deploy',
            '--prod',
            '--legacy',
            deployRoot
        ], { cwd: repoRoot, env: deployEnv });
        git(repoRoot, ['checkout', '--', 'packages/happy-wire/dist']);

        const deployedPackages = verifyDeployedVersions(deployRoot, pins.pairs);
        const pruning = pruneDeployment(deployRoot);
        const machineMarkers = [
            repoRoot,
            pnpmStorePath,
            process.env.USERPROFILE,
            process.env.LOCALAPPDATA,
            process.env.APPDATA
        ];
        scanForbidden(deployRoot);
        scanMachineMetadata(deployRoot, machineMarkers);

        assertSafeOwnedPath(downloadRoot, repoRoot, { allowRoot: false });
        const nodeArchive = downloadNode(downloadRoot, repoRoot);
        const nodeExtractRoot = path.join(workRoot, 'node');
        fs.mkdirSync(nodeExtractRoot, { recursive: true });
        run('tar.exe', ['-xf', nodeArchive, '-C', nodeExtractRoot], { cwd: repoRoot });
        const nodeDirectory = path.join(nodeExtractRoot, NODE_ARCHIVE.replace(/\.zip$/, ''));
        const nodeExecutable = path.join(nodeDirectory, 'node.exe');
        const nodeLicense = path.join(nodeDirectory, 'LICENSE');
        ensure(fs.existsSync(nodeExecutable), 'Pinned Node archive did not contain node.exe.');
        ensure(fs.existsSync(nodeLicense), 'Pinned Node archive did not contain its LICENSE.');
        fs.copyFileSync(nodeExecutable, path.join(payloadRoot, 'node.exe'));
        fs.copyFileSync(nodeLicense, path.join(payloadRoot, 'NODE-LICENSE.txt'));
        fs.renameSync(deployRoot, path.join(payloadRoot, 'happy'));
        scanForbidden(payloadRoot);
        scanMachineMetadata(payloadRoot, machineMarkers);

        const licenseInventoryPath = path.join(artifactRoot, 'licenses.json');
        const sbomPath = path.join(artifactRoot, 'sbom.spdx.json');
        const packageCount = buildSbom(
            path.join(payloadRoot, 'happy'),
            payloadRoot,
            source,
            artifactId,
            sbomPath,
            licenseInventoryPath
        );
        normalizePayloadMetadata(payloadRoot, source.timestampUtc);
        const inventory = inventoryPayload(payloadRoot);
        const archivePath = path.join(artifactRoot, ARCHIVE_NAME);
        createArchive(payloadRoot, archivePath, inventory, source.timestampUtc, repoRoot);
        const archiveSha256 = sha256File(archivePath);
        const archiveLength = fs.statSync(archivePath).size;
        const archiveEvidence = {
            name: ARCHIVE_NAME,
            sha256: archiveSha256,
            length: archiveLength,
            fileCount: inventory.files.length,
            expandedLength: inventory.expandedLength,
            entryTimestampUtc: source.timestampUtc,
            entryExternalAttributes: 0
        };
        const verificationManifestPath = path.join(workRoot, 'verification-manifest.json');
        writeJson(verificationManifestPath, {
            schemaVersion: 1,
            artifactId,
            archive: archiveEvidence,
            files: inventory.files
        });
        let smokeOutput;
        try {
            await verifyAndExtractArchive(
                archivePath,
                verificationManifestPath,
                extractionRoot,
                repoRoot
            );
            smokeOutput = runExternalSmoke(extractionRoot, smokeRoot, repoRoot);
        } finally {
            cleanupExternalPaths([extractionRoot, smokeRoot], repoRoot);
        }

        const completedAtUtc = new Date().toISOString();
        const report = {
            schemaVersion: 1,
            artifactId,
            evidenceOnly: true,
            localOnly: true,
            publishAttempted: false,
            oneDriveWritten: false,
            source,
            startedAtUtc: startedAt,
            completedAtUtc,
            archive: archiveEvidence,
            dependencies: {
                pnpmVersion: run('pnpm', ['--version'], { cwd: repoRoot, capture: true }).stdout.trim(),
                lockSha256,
                deployedPackageIdentities: deployedPackages,
                sbomPackages: packageCount
            },
            pruning,
            checks: {
                forbiddenContent: 'clean',
                machineMetadata: 'clean',
                reproducibleZipMetadata: 'clean',
                archivePreflight: 'clean',
                expandedInventory: 'clean',
                externalSmoke: 'clean',
                externalSmokeCleanup: 'clean',
                smokeOutput
            }
        };
        const reportPath = path.join(artifactRoot, 'build-report.json');
        writeJson(reportPath, report);
        const manifest = {
            schemaVersion: 1,
            artifactId,
            version: artifactId,
            channel: 'local-preview',
            payloadLabel: 'unsigned-owner-only',
            platform: 'win32-x64',
            publishedAtUtc: completedAtUtc,
            happyCliVersion: packageManifest.version,
            source: {
                repository: 'Evyatar108/happy',
                commit: source.commit,
                branch: source.branch,
                timestampUtc: source.timestampUtc,
                dirty: false,
                pnpmLockSha256: lockSha256
            },
            node: {
                version: NODE_VERSION,
                distributionSha256: NODE_SHA256
            },
            archive: archiveEvidence,
            entrypoints: {
                node: 'payload/node.exe',
                happy: 'payload/happy/dist/index.mjs'
            },
            files: inventory.files,
            compatibility: {
                launcherSchemaVersions: [1],
                evCopilot: [],
                controller: {
                    registrySchema: 2,
                    protocolVersion: 3,
                    copilotPackageVersions: ['1.0.71-3']
                }
            },
            capabilities: ['copilot-terminal-route-v1'],
            report: {
                path: 'build-report.json',
                sha256: sha256File(reportPath)
            },
            sbom: {
                path: 'sbom.spdx.json',
                sha256: sha256File(sbomPath)
            },
            licenses: {
                path: 'licenses.json',
                sha256: sha256File(licenseInventoryPath)
            }
        };
        const manifestPath = path.join(artifactRoot, 'manifest.json');
        writeJson(manifestPath, manifest);
        ensure(sha256File(reportPath) === manifest.report.sha256, 'Build report changed before completion.');
        ensure(sha256File(sbomPath) === manifest.sbom.sha256, 'SBOM changed before completion.');
        ensure(sha256File(licenseInventoryPath) === manifest.licenses.sha256, 'License inventory changed before completion.');
        ensure(sha256File(archivePath) === archiveSha256, 'Archive changed before completion.');
        const manifestSha256 = sha256File(manifestPath);
        const completePath = path.join(artifactRoot, 'COMPLETE.json');
        writeJson(completePath, {
            schemaVersion: 1,
            artifactId,
            version: artifactId,
            channel: 'local-preview',
            payloadLabel: 'unsigned-owner-only',
            manifestSha256,
            archiveSha256,
            completedAtUtc: new Date().toISOString()
        });
        result = {
            schemaVersion: 1,
            artifactId,
            artifactRoot,
            sourceCommit: source.commit,
            archive: archiveEvidence
        };
        completed = true;
    } finally {
        git(repoRoot, ['checkout', '--', 'packages/happy-wire/dist']);
        cleanupExternalPaths([extractionRoot, smokeRoot], repoRoot);
        removeTree(workRoot, repoRoot);
        if (!completed) removeTree(artifactRoot, repoRoot);
    }
    if (resultPath) {
        assertSafeOwnedPath(resultPath, repoRoot, { allowRoot: false });
        writeJson(resultPath, result);
    }
    console.log(`HAPPY_PORTABLE_RESULT=${JSON.stringify(result)}`);
}

async function verify(options) {
    const repoRoot = path.resolve(options.repoRoot);
    const artifactRoot = path.resolve(options.artifactRoot);
    const extractionRoot = path.resolve(options.extractionRoot);
    assertSafeOwnedPath(artifactRoot, repoRoot, { allowRoot: false });
    assertSafeOwnedPath(extractionRoot, repoRoot, { allowRoot: false });
    const manifestPath = path.join(artifactRoot, 'manifest.json');
    const completePath = path.join(artifactRoot, 'COMPLETE.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const complete = JSON.parse(fs.readFileSync(completePath, 'utf8'));
    ensure(complete.manifestSha256 === sha256File(manifestPath), 'COMPLETE manifest hash mismatch.');
    ensure(complete.archiveSha256 === manifest.archive.sha256, 'COMPLETE archive hash mismatch.');
    ensure(manifest.report.sha256 === sha256File(path.join(artifactRoot, manifest.report.path)),
        'Build report hash mismatch.');
    ensure(manifest.sbom.sha256 === sha256File(path.join(artifactRoot, manifest.sbom.path)), 'SBOM hash mismatch.');
    ensure(manifest.licenses.sha256 === sha256File(path.join(artifactRoot, manifest.licenses.path)), 'License hash mismatch.');
    const report = JSON.parse(fs.readFileSync(path.join(artifactRoot, manifest.report.path), 'utf8'));
    ensure(report.artifactId === manifest.artifactId && report.evidenceOnly === true,
        'Build report identity or evidence role mismatch.');
    const sbom = JSON.parse(fs.readFileSync(path.join(artifactRoot, manifest.sbom.path), 'utf8'));
    const extractedLicenseIds = new Set(
        (sbom.hasExtractedLicensingInfos || []).map((item) => item.licenseId)
    );
    for (const item of sbom.packages || []) {
        ensure(item.licenseDeclared === 'NOASSERTION' || isValidSpdxExpression(item.licenseDeclared),
            `Invalid SPDX licenseDeclared value: ${item.name}@${item.versionInfo} (${item.licenseDeclared})`);
        if (String(item.licenseDeclared).startsWith('LicenseRef-')) {
            ensure(extractedLicenseIds.has(item.licenseDeclared),
                `SPDX LicenseRef has no extracted evidence: ${item.licenseDeclared}`);
        }
    }
    await verifyAndExtractArchive(
        path.join(artifactRoot, manifest.archive.name),
        manifestPath,
        extractionRoot,
        repoRoot
    );
    scanForbidden(extractionRoot);
    scanMachineMetadata(extractionRoot, [
        repoRoot,
        run('pnpm', ['store', 'path'], { cwd: repoRoot, capture: true }).stdout.trim(),
        process.env.USERPROFILE,
        process.env.LOCALAPPDATA,
        process.env.APPDATA
    ]);
}

function testPaths() {
    const accepted = new Set();
    assertZipPath('payload/happy/dist/index.mjs', accepted);
    const rejected = [
        '../escape',
        '/rooted',
        '//server/share',
        'C:/drive',
        'payload/a:b',
        'payload//empty',
        'payload/./dot',
        'payload/../up',
        'payload/trailing. ',
        'payload/CON',
        'payload/lpt1.txt',
        'payload\\backslash'
    ];
    for (const item of rejected) {
        let failed = false;
        try {
            assertZipPath(item, new Set());
        } catch {
            failed = true;
        }
        ensure(failed, `Unsafe ZIP path fixture was accepted: ${item}`);
    }
    const duplicates = new Set();
    assertZipPath('payload/A.txt', duplicates);
    let duplicateFailed = false;
    try {
        assertZipPath('payload/a.txt', duplicates);
    } catch {
        duplicateFailed = true;
    }
    ensure(duplicateFailed, 'Case-colliding ZIP fixture was accepted.');
    let mockedReparseRejected = false;
    try {
        assertPathComponentsSafe([
            { path: 'C:\\safe', isReparse: false },
            { path: 'C:\\safe\\redirect', isReparse: true }
        ]);
    } catch {
        mockedReparseRejected = true;
    }
    ensure(mockedReparseRejected, 'Mocked reparse path component was accepted.');
    ensure(isValidSpdxExpression('(MIT OR CC0-1.0)'), 'Valid SPDX expression fixture was rejected.');
    ensure(!isValidSpdxExpression('SEE LICENSE IN README.md'),
        'Invalid Anthropic npm license declaration was accepted as SPDX.');
    console.log('ZIP path fixtures passed.');
}

function testSecurity(options) {
    const repoRoot = path.resolve(options.repoRoot);
    const testRoot = path.resolve(options.testRoot);
    assertSafeOwnedPath(testRoot, repoRoot, { allowRoot: false });
    removeTree(testRoot, repoRoot);
    fs.mkdirSync(testRoot, { recursive: true });
    const cleanupProbe = path.join(testRoot, 'cleanup-probe');
    const cleanupExtraction = path.join(cleanupProbe, 'external-smoke');
    const cleanupState = path.join(cleanupProbe, 'smoke-state');
    fs.mkdirSync(cleanupExtraction, { recursive: true });
    fs.mkdirSync(cleanupState, { recursive: true });
    let expectedFailure = false;
    try {
        throw new Error('cleanup fixture');
    } catch {
        expectedFailure = true;
    } finally {
        cleanupExternalPaths([cleanupExtraction, cleanupState], repoRoot);
    }
    ensure(expectedFailure && !fs.existsSync(cleanupExtraction) && !fs.existsSync(cleanupState),
        'External smoke cleanup did not run after a failure.');

    const junctionTarget = path.join(testRoot, 'junction-target');
    const junctionPath = path.join(testRoot, 'junction');
    fs.mkdirSync(junctionTarget, { recursive: true });
    const junction = spawnSync(process.env.ComSpec || 'cmd.exe', [
        '/d', '/s', '/c', 'mklink', '/J', junctionPath, junctionTarget
    ], { encoding: 'utf8', windowsHide: true, shell: false });
    if (junction.status === 0) {
        let junctionRejected = false;
        try {
            assertSafeOwnedPath(path.join(junctionPath, 'child'), repoRoot, { allowRoot: false });
        } catch {
            junctionRejected = true;
        } finally {
            fs.rmdirSync(junctionPath);
        }
        ensure(junctionRejected, 'Live Windows junction output path was accepted.');
        console.log('Live Windows junction confinement probe passed.');
    } else {
        console.log('Live Windows junction probe unavailable; deterministic reparse fixture passed.');
    }
    removeTree(testRoot, repoRoot);
    console.log('Output confinement and cleanup fixtures passed.');
}

function parseArguments(argv) {
    const command = argv[2];
    const options = {};
    for (let index = 3; index < argv.length; index += 2) {
        const key = argv[index];
        const value = argv[index + 1];
        ensure(key && key.startsWith('--') && value, `Invalid argument: ${key || '<missing>'}`);
        options[key.slice(2)] = value;
    }
    return { command, options };
}

async function main() {
    const { command, options } = parseArguments(process.argv);
    if (command === 'build') {
        ensure(options.repoRoot && options.outputRoot, 'build requires --repoRoot and --outputRoot.');
        await build(options);
    } else if (command === 'verify') {
        ensure(options.repoRoot && options.artifactRoot && options.extractionRoot,
            'verify requires --repoRoot, --artifactRoot, and --extractionRoot.');
        await verify(options);
    } else if (command === 'test-paths') {
        testPaths();
    } else if (command === 'test-security') {
        ensure(options.repoRoot && options.testRoot,
            'test-security requires --repoRoot and --testRoot.');
        testSecurity(options);
    } else if (command === 'assert-output') {
        ensure(options.repoRoot && options.target,
            'assert-output requires --repoRoot and --target.');
        console.log(JSON.stringify(assertSafeOwnedPath(options.target, options.repoRoot, { allowRoot: false })));
    } else if (command === 'cleanup-output') {
        ensure(options.repoRoot && options.target,
            'cleanup-output requires --repoRoot and --target.');
        removeTree(options.target, options.repoRoot);
    } else {
        fail('Usage: portable-artifact.cjs build|verify|test-paths|test-security|assert-output|cleanup-output [options]');
    }
}

main().catch((error) => {
    console.error(error && error.stack ? error.stack : error);
    process.exitCode = 1;
});
