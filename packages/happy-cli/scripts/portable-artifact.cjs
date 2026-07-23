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

function ordinalCompare(left, right) {
    return left < right ? -1 : left > right ? 1 : 0;
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
    try {
        fs.lstatSync(fullPath);
        return fs.realpathSync.native(fullPath);
    } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
    }
    let existing = fullPath;
    while (true) {
        try {
            fs.lstatSync(existing);
            break;
        } catch (error) {
            if (error?.code !== 'ENOENT') throw error;
        }
        const parent = path.dirname(existing);
        ensure(parent !== existing, `Unable to find an existing parent for ${fullPath}.`);
        existing = parent;
    }
    return path.resolve(fs.realpathSync.native(existing), path.relative(existing, fullPath));
}

function inspectPathComponents(target, inspect = (component) => {
    const stats = fs.lstatSync(component);
    if (stats.isSymbolicLink()) {
        return { isReparse: true, resolved: null };
    }
    const resolved = fs.realpathSync.native(component);
    return {
        isReparse: pathKey(resolved) !== pathKey(component),
        resolved
    };
}) {
    const fullPath = path.resolve(target);
    const parsed = path.parse(fullPath);
    const components = [];
    let current = parsed.root;
    try {
        fs.lstatSync(current);
        components.push({ path: current, ...inspect(current) });
    } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
        return components;
    }
    for (const segment of fullPath.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
        current = path.join(current, segment);
        try {
            fs.lstatSync(current);
        } catch (error) {
            if (error?.code === 'ENOENT') break;
            throw error;
        }
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

function assertCanonicalArtifactRelativePath(value, label) {
    ensure(typeof value === 'string' && value.length > 0,
        `${label} must be a non-empty relative path.`);
    ensure(!value.includes('\\'), `${label} must use canonical forward slashes.`);
    ensure(!value.startsWith('/') && !value.startsWith('//') && !/^[A-Za-z]:/.test(value),
        `${label} must not be rooted.`);
    const segments = value.split('/');
    ensure(segments.every((segment) => segment !== '' && segment !== '.' && segment !== '..'),
        `${label} contains an empty or dot segment.`);
    for (const segment of segments) {
        ensure(!segment.includes(':'), `${label} contains ADS or URI syntax.`);
        ensure(!/[\u0000-\u001F<>"|?*]/.test(segment), `${label} contains an invalid Windows character.`);
        ensure(!/[ .]$/.test(segment), `${label} has a trailing dot or space.`);
        ensure(!WINDOWS_RESERVED.test(segment), `${label} contains a reserved Windows name.`);
    }
    ensure(path.posix.normalize(value) === value, `${label} is not canonical.`);
    return value;
}

function resolveArtifactFile(artifactRoot, relativePath, label) {
    const canonical = assertCanonicalArtifactRelativePath(relativePath, label);
    const target = path.resolve(artifactRoot, ...canonical.split('/'));
    ensure(isPathInside(target, artifactRoot, false), `${label} escapes the artifact root.`);
    assertSafeOwnedPath(target, artifactRoot, { allowRoot: false });
    let stats;
    try {
        stats = fs.lstatSync(target);
    } catch (error) {
        if (error?.code === 'ENOENT') fail(`${label} does not exist: ${canonical}`);
        throw error;
    }
    ensure(!stats.isSymbolicLink() && stats.isFile(), `${label} must be a regular non-reparse file.`);
    return target;
}

function isUnderOneDrive(target) {
    const candidate = realpathOrResolved(target);
    return ['OneDrive', 'OneDriveCommercial', 'OneDriveConsumer']
        .map((name) => process.env[name])
        .filter(Boolean)
        .some((root) => isPathInside(candidate, realpathOrResolved(root), true));
}

function lstatIfPresent(target) {
    try {
        return fs.lstatSync(target);
    } catch (error) {
        if (error?.code === 'ENOENT') return null;
        throw error;
    }
}

function assertNoAncestorNodeModules(target) {
    let current = path.resolve(target);
    while (true) {
        ensure(path.basename(current).toLowerCase() !== 'node_modules',
            `External smoke path is inside node_modules: ${target}`);
        const candidate = path.join(current, 'node_modules');
        const stats = lstatIfPresent(candidate);
        ensure(!stats, `External smoke ancestor exposes node_modules: ${candidate}`);
        const parent = path.dirname(current);
        if (parent === current) break;
        current = parent;
    }
}

function createExternalSmokeSession(repoRoot, artifactId) {
    const externalParent = path.parse(repoRoot).root;
    const baseRoot = path.join(externalParent, '.happy-portable-smoke');
    const sessionRoot = path.join(baseRoot, `${artifactId}-${crypto.randomUUID()}`);
    ensure(!isPathInside(baseRoot, repoRoot, true) && !isPathInside(repoRoot, baseRoot, true),
        'External smoke root must be disjoint from the repository.');
    assertSafeOwnedPath(baseRoot, externalParent, { allowRoot: false });
    assertNoAncestorNodeModules(baseRoot);
    fs.mkdirSync(sessionRoot, { recursive: true });
    assertSafeOwnedPath(sessionRoot, baseRoot, { allowRoot: false });
    assertNoAncestorNodeModules(baseRoot);
    return {
        externalParent,
        baseRoot,
        sessionRoot,
        extractionRoot: path.join(sessionRoot, 'extracted'),
        smokeRoot: path.join(sessionRoot, 'state')
    };
}

function cleanupExternalSmokeSession(session) {
    if (!session) return;
    removeTree(session.sessionRoot, session.baseRoot);
    if (lstatIfPresent(session.baseRoot)) {
        assertSafeOwnedPath(session.baseRoot, session.externalParent, { allowRoot: false });
        try {
            fs.rmdirSync(session.baseRoot);
        } catch (error) {
            if (error?.code !== 'ENOTEMPTY' && error?.code !== 'ENOENT') throw error;
        }
    }
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

function gitOptional(repoRoot, args) {
    const result = spawnSync('git', ['--no-pager', ...args], {
        cwd: repoRoot,
        encoding: 'utf8',
        shell: false,
        windowsHide: true
    });
    if (result.error) throw result.error;
    return result.status === 0 ? (result.stdout || '').trim() : '';
}

function normalizeGitHubRemote(remoteUrl) {
    ensure(typeof remoteUrl === 'string' && remoteUrl.trim() !== '',
        'Git remote URL is empty.');
    const value = remoteUrl.trim();
    let repositoryPath;
    if (/^https:\/\/github\.com\//i.test(value)) {
        const parsed = new URL(value);
        ensure(parsed.protocol === 'https:' && parsed.hostname.toLowerCase() === 'github.com'
            && !parsed.username && !parsed.password && !parsed.search && !parsed.hash,
        `Unsupported GitHub remote URL: ${value}`);
        repositoryPath = parsed.pathname.replace(/^\/+|\/+$/g, '');
    } else {
        const scp = /^git@github\.com:([^?#]+)$/i.exec(value);
        const ssh = /^ssh:\/\/git@github\.com\/([^?#]+)$/i.exec(value);
        ensure(scp || ssh, `Only GitHub HTTPS or git SSH remotes are approved: ${value}`);
        repositoryPath = (scp || ssh)[1].replace(/^\/+|\/+$/g, '');
    }
    repositoryPath = repositoryPath.replace(/\.git$/i, '');
    const parts = repositoryPath.split('/');
    ensure(parts.length === 2
        && parts.every((part) => /^[A-Za-z0-9_.-]+$/.test(part) && part !== '.' && part !== '..'),
    `GitHub remote must identify one owner/repository pair: ${value}`);
    return {
        repository: `${parts[0]}/${parts[1]}`,
        repositoryUrl: `https://github.com/${parts[0]}/${parts[1]}`
    };
}

function selectCanonicalRepository(remotes, preferences = []) {
    const approvedNames = new Set(['origin', 'personal']);
    const orderedNames = [...preferences, 'origin', 'personal']
        .filter((name, index, values) => approvedNames.has(name) && values.indexOf(name) === index);
    for (const name of orderedNames) {
        const urls = remotes[name];
        if (!urls || urls.length === 0) continue;
        const normalized = urls.map(normalizeGitHubRemote);
        const identities = new Map(normalized.map((item) => [
            item.repository.toLowerCase(),
            item
        ]));
        ensure(identities.size === 1,
            `Approved remote "${name}" has ambiguous repository URLs.`);
        return { remote: name, ...identities.values().next().value };
    }
    fail('No approved GitHub provenance remote is configured (expected origin or personal).');
}

function deriveCanonicalRepository(repoRoot, branch) {
    const remotes = {};
    for (const name of ['origin', 'personal']) {
        const urls = gitOptional(repoRoot, ['remote', 'get-url', '--all', name])
            .split(/\r?\n/)
            .filter(Boolean);
        if (urls.length) remotes[name] = urls;
    }
    const preferences = [
        gitOptional(repoRoot, ['config', '--get', `branch.${branch}.pushRemote`]),
        gitOptional(repoRoot, ['config', '--get', `branch.${branch}.remote`]),
        gitOptional(repoRoot, ['config', '--get', 'remote.pushDefault'])
    ].filter(Boolean);
    return selectCanonicalRepository(remotes, preferences);
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
    const provenance = deriveCanonicalRepository(repoRoot, branch);
    return { commit, branch, ...provenance };
}

function assertSourceUnchanged(repoRoot, expected) {
    const commit = git(repoRoot, ['rev-parse', 'HEAD']);
    const branch = git(repoRoot, ['branch', '--show-current']);
    const status = git(repoRoot, ['status', '--porcelain=v1', '--untracked-files=all']);
    ensure(commit === expected.commit, `Source HEAD drifted during build: ${commit}`);
    ensure(branch === expected.branch, `Source branch drifted during build: ${branch || '<detached>'}`);
    ensure(status === '', 'Source worktree changed during build; refusing artifact completion.');
    const provenance = deriveCanonicalRepository(repoRoot, branch);
    ensure(provenance.remote === expected.remote
        && provenance.repository.toLowerCase() === expected.repository.toLowerCase()
        && provenance.repositoryUrl.toLowerCase() === expected.repositoryUrl.toLowerCase(),
    'Source repository provenance changed during build.');
}

function materializeSourceSnapshot(repoRoot, source, workRoot) {
    const archivePath = path.join(workRoot, 'source.tar');
    const snapshotRoot = path.join(workRoot, 'source');
    fs.mkdirSync(snapshotRoot, { recursive: true });
    run('git', [
        'archive',
        '--format=tar',
        `--output=${archivePath}`,
        source.commit
    ], { cwd: repoRoot });
    run('tar.exe', ['-xf', archivePath, '-C', snapshotRoot], { cwd: workRoot });
    fs.rmSync(archivePath, { force: true });
    for (const entry of git(repoRoot, [
        'ls-tree',
        '-r',
        '-z',
        source.commit
    ]).split('\0').filter(Boolean)) {
        const match = /^([0-9]{6})\s+blob\s+[0-9a-f]+\t(.+)$/.exec(entry);
        if (!match || match[1] !== '120000') continue;
        const linkPath = path.join(snapshotRoot, ...match[2].split('/'));
        const stats = fs.lstatSync(linkPath);
        ensure(stats.isSymbolicLink(), `Snapshot link was not materialized as a link: ${match[2]}`);
        fs.unlinkSync(linkPath);
    }
    for (const required of [
        'pnpm-lock.yaml',
        'pnpm-workspace.yaml',
        'packages/happy-cli/package.json',
        'packages/happy-server/package.json',
        'packages/happy-wire/package.json'
    ]) {
        const snapshotFile = path.join(snapshotRoot, ...required.split('/'));
        ensure(fs.existsSync(snapshotFile), `Immutable source snapshot is missing ${required}.`);
        const expectedBlob = git(repoRoot, ['rev-parse', `${source.commit}:${required}`]);
        const actualBlob = run('git', ['hash-object', snapshotFile], {
            cwd: repoRoot,
            capture: true
        }).stdout.trim();
        ensure(actualBlob === expectedBlob, `Immutable source snapshot mismatch: ${required}`);
    }
    fs.writeFileSync(path.join(snapshotRoot, 'pnpm-workspace.yaml'), [
        'packages:',
        '  - "packages/happy-cli"',
        '  - "packages/happy-server"',
        '  - "packages/happy-wire"',
        ''
    ].join('\n'), 'ascii');
    return snapshotRoot;
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

function generateDeployedPrismaClient(deployRoot) {
    const prismaCli = path.join(deployRoot, 'node_modules', 'prisma', 'build', 'index.js');
    const serverRoot = path.join(deployRoot, 'node_modules', 'happy-server');
    const schemaPath = path.join(serverRoot, 'prisma', 'schema.prisma');
    ensure(fs.existsSync(prismaCli) && fs.existsSync(schemaPath),
        'Deployed Prisma generator or happy-server schema is missing.');
    run(process.execPath, [prismaCli, 'generate', '--schema', schemaPath], {
        cwd: serverRoot,
        env: {
            ...process.env,
            PATH: `${path.join(deployRoot, 'node_modules', '.bin')}${path.delimiter}${process.env.PATH || ''}`
        }
    });
    const generatedRoot = path.join(deployRoot, 'node_modules', '.prisma', 'client');
    ensure(fs.existsSync(path.join(generatedRoot, 'index.js')),
        'Prisma generate did not produce the deployed runtime client.');
    const replacements = new Map([
        [path.join(deployRoot, 'node_modules', '@prisma', 'client'), 'payload/happy/node_modules/@prisma/client'],
        [schemaPath, 'payload/happy/node_modules/happy-server/prisma/schema.prisma']
    ]);
    for (const file of enumerateRegularFiles(generatedRoot)) {
        if (!/\.(?:js|mjs|json|prisma)$/i.test(file)) continue;
        let text = fs.readFileSync(file, 'utf8');
        const original = text;
        for (const [machinePath, portablePath] of replacements) {
            text = text.split(machinePath).join(portablePath);
            const escapedMachinePath = JSON.stringify(machinePath).slice(1, -1);
            text = text.split(escapedMachinePath).join(portablePath);
        }
        if (text !== original) fs.writeFileSync(file, text, 'utf8');
    }
    ensure(
        enumerateRegularFiles(generatedRoot).some((file) => path.basename(file) === 'query_engine-windows.dll.node'),
        'Generated Prisma client is missing the Windows query engine.'
    );
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
    return roots.sort((left, right) => ordinalCompare(left.relative, right.relative));
}

function spdxId(value) {
    const clean = value.replace(/[^A-Za-z0-9.-]/g, '-');
    return `SPDXRef-Package-${clean}-${sha256Bytes(value).slice(0, 12)}`;
}

function npmPurl(name, version) {
    ensure(typeof name === 'string' && name.length > 0, 'npm package name is missing.');
    let packagePath;
    if (name.startsWith('@')) {
        const separator = name.indexOf('/');
        ensure(separator > 1 && separator < name.length - 1,
            `Invalid scoped npm package name: ${name}`);
        packagePath = `${encodeURIComponent(name.slice(0, separator))}/${encodeURIComponent(name.slice(separator + 1))}`;
    } else {
        ensure(!name.includes('/'), `Invalid unscoped npm package name: ${name}`);
        packagePath = encodeURIComponent(name);
    }
    return `pkg:npm/${packagePath}@${encodeURIComponent(version)}`;
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
        .map((entry) => path.join(packageRoot, entry.name))
        .sort(ordinalCompare);
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
    const uniqueEvidence = [...new Map(evidenceFiles.map((file) => [pathKey(file), file])).values()]
        .sort(ordinalCompare);
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
                referenceLocator: npmPurl(item.manifest.name, version)
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
    packages.sort((left, right) => ordinalCompare(
        `${left.name}@${left.versionInfo}`,
        `${right.name}@${right.versionInfo}`
    ));
    relationships.sort((left, right) => ordinalCompare(
        `${left.spdxElementId}\u0000${left.relationshipType}\u0000${left.relatedSpdxElement}`,
        `${right.spdxElementId}\u0000${right.relationshipType}\u0000${right.relatedSpdxElement}`
    ));
    licenseInventory.sort((left, right) => ordinalCompare(
        `${left.name}@${left.version}`,
        `${right.name}@${right.version}`
    ));
    extractedLicenses.sort((left, right) => ordinalCompare(left.licenseId, right.licenseId));
    const created = new Date().toISOString();
    const sbom = {
        spdxVersion: 'SPDX-2.3',
        dataLicense: 'CC0-1.0',
        SPDXID: 'SPDXRef-DOCUMENT',
        name: `Happy portable ${artifactId}`,
        documentNamespace: `${source.repositoryUrl}/spdx/${source.commit}/${artifactId}`,
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

function verifyAndExtractArchive(
    archivePath,
    manifestPath,
    extractionRoot,
    confinementRoot,
    zipHelperPath = path.join(__dirname, 'portable-zip.ps1')
) {
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
        zipHelperPath,
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

function createArchive(
    payloadRoot,
    archivePath,
    inventory,
    entryTimestampUtc,
    confinementRoot,
    zipHelperPath = path.join(__dirname, 'portable-zip.ps1')
) {
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
            zipHelperPath,
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

function runExternalSmoke(extractionRoot, smokeRoot, confinementRoot, repoRoot) {
    ensure(!isPathInside(extractionRoot, repoRoot, true),
        'External smoke extraction must be outside the repository.');
    assertSafeOwnedPath(extractionRoot, confinementRoot, { allowRoot: false });
    assertNoAncestorNodeModules(confinementRoot);
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
    const isolatedEnvironment = {
        SystemRoot: process.env.SystemRoot,
        ComSpec: process.env.ComSpec,
        TEMP: smokeRoot,
        TMP: smokeRoot,
        USERPROFILE: home,
        HOMEDRIVE: path.parse(home).root.replace(/\\$/, ''),
        HOMEPATH: home.slice(path.parse(home).root.length - 1),
        HOME: home,
        PATH: emptyPath,
        NODE_PATH: '',
        HAPPY_HOME_DIR: happyHome,
        HAPPY_ENABLE_COPILOT_NATIVE: '1',
        NODE_OPTIONS: '--no-addons'
    };
    const spawnNode = (args, cwd = smokeRoot) => spawnSync(node, [
        '--no-global-search-paths',
        ...args
    ], {
        cwd,
        env: isolatedEnvironment,
        encoding: 'utf8',
        shell: false,
        windowsHide: true,
        timeout: 60000
    });
    const probeScript = [
        "const Module = require('node:module');",
        "const paths = require.resolve.paths('__happy_portable_missing_probe__') || [];",
        'console.log(JSON.stringify({ paths, globalPaths: Module.globalPaths }));'
    ].join('');
    const probe = spawnNode(['-e', probeScript], path.dirname(happy));
    if (probe.error) throw probe.error;
    ensure(probe.status === 0, `External resolution probe failed: ${probe.stderr || ''}`);
    const resolution = JSON.parse((probe.stdout || '').trim());
    ensure(Array.isArray(resolution.paths) && Array.isArray(resolution.globalPaths),
        'External resolution probe returned malformed output.');
    ensure(resolution.globalPaths.length === 0,
        `External smoke retained Node global search paths: ${resolution.globalPaths.join(', ')}`);
    const allowedNodeModules = path.join(payload, 'happy', 'node_modules');
    for (const candidate of resolution.paths) {
        ensure(!isPathInside(candidate, repoRoot, true),
            `External smoke resolution reaches the repository: ${candidate}`);
        const stats = lstatIfPresent(candidate);
        if (stats) {
            ensure(pathKey(candidate) === pathKey(allowedNodeModules),
                `External smoke resolution reaches non-payload node_modules: ${candidate}`);
            assertSafeOwnedPath(candidate, confinementRoot, { allowRoot: false });
        }
    }
    ensure(resolution.paths.some((candidate) => pathKey(candidate) === pathKey(allowedNodeModules)),
        'External smoke resolution probe omitted the payload node_modules.');

    const requiredDependency = path.join(allowedNodeModules, 'zod');
    const hiddenDependency = path.join(payload, 'happy', '.negative-smoke-zod');
    ensure(lstatIfPresent(requiredDependency)?.isDirectory(),
        'Negative smoke fixture requires payload dependency zod.');
    ensure(!lstatIfPresent(hiddenDependency), 'Negative smoke fixture destination already exists.');
    let negative;
    fs.renameSync(requiredDependency, hiddenDependency);
    try {
        negative = spawnNode([happy, 'copilot', '--help']);
    } finally {
        fs.renameSync(hiddenDependency, requiredDependency);
    }
    if (negative.error) throw negative.error;
    ensure(negative.status !== 0,
        'External negative smoke unexpectedly resolved missing zod from outside the payload.');
    ensure(/(?:zod|ERR_MODULE_NOT_FOUND|Cannot find package)/i.test(
        `${negative.stdout || ''}${negative.stderr || ''}`
    ), 'External negative smoke failed without proving the required dependency was unavailable.');

    const result = spawnNode([happy, 'copilot', '--help']);
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
    return {
        output: `${result.stdout || ''}${result.stderr || ''}`.trim(),
        resolutionPathCount: resolution.paths.length,
        outsideRepository: true,
        globalSearchPathsDisabled: true,
        existingResolutionRootsPayloadOnly: true,
        negativeDependencyFallbackBlocked: true
    };
}

function inventoryPayload(payloadRoot) {
    const files = enumerateRegularFiles(payloadRoot)
        .map((file) => ({
            relativePath: `payload/${path.relative(payloadRoot, file).split(path.sep).join('/')}`,
            length: fs.statSync(file).size,
            sha256: sha256File(file)
        }))
        .sort((left, right) => ordinalCompare(left.relativePath, right.relativePath));
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
    const startedAt = new Date().toISOString();
    const artifactId = `${startedAt.replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')}-${source.commit.slice(0, 12)}`;
    const workRoot = path.join(outputRoot, '.work');
    const deployRoot = path.join(workRoot, 'deploy');
    const payloadRoot = path.join(workRoot, 'payload');
    const artifactRoot = path.join(outputRoot, artifactId);
    const downloadRoot = path.join(outputRoot, '.downloads');
    for (const ownedPath of [workRoot, artifactRoot, downloadRoot]) {
        assertSafeOwnedPath(ownedPath, repoRoot, { allowRoot: false });
    }
    removeTree(workRoot, repoRoot);
    ensure(!fs.existsSync(artifactRoot), `Immutable artifact already exists: ${artifactRoot}`);
    fs.mkdirSync(workRoot, { recursive: true });
    fs.mkdirSync(payloadRoot, { recursive: true });
    fs.mkdirSync(artifactRoot, { recursive: true });
    let externalSmokeSession;
    let result;
    let completed = false;
    try {
        const snapshotRoot = materializeSourceSnapshot(repoRoot, source, workRoot);
        const snapshotZipHelper = path.join(
            snapshotRoot,
            'packages',
            'happy-cli',
            'scripts',
            'portable-zip.ps1'
        );
        const packageManifest = JSON.parse(fs.readFileSync(
            path.join(snapshotRoot, 'packages', 'happy-cli', 'package.json'),
            'utf8'
        ));
        const lockSha256 = sha256File(path.join(snapshotRoot, 'pnpm-lock.yaml'));
        const pnpmStorePath = run('pnpm', ['store', 'path'], {
            cwd: snapshotRoot,
            capture: true
        }).stdout.trim();
        const installArgs = [
            'install',
            '--frozen-lockfile',
            '--filter',
            'happy...'
        ];
        installArgs.push(options.offlineInstall === 'true' ? '--offline' : '--prefer-offline');
        run('pnpm', installArgs, {
            cwd: snapshotRoot,
            env: { ...process.env, CI: '1' }
        });

        run('pnpm', ['--filter', '@slopus/happy-wire', 'build'], { cwd: snapshotRoot });
        run('pnpm', ['--filter', 'happy-server', 'build'], { cwd: snapshotRoot });
        run('pnpm', ['--filter', 'happy', 'build'], { cwd: snapshotRoot });

        const pins = createLockPins(snapshotRoot, workRoot);
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
        ], { cwd: snapshotRoot, env: deployEnv });

        const deployedPackages = verifyDeployedVersions(deployRoot, pins.pairs);
        generateDeployedPrismaClient(deployRoot);
        const pruning = pruneDeployment(deployRoot);
        const machineMarkers = [
            repoRoot,
            snapshotRoot,
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
        run('tar.exe', ['-xf', nodeArchive, '-C', nodeExtractRoot], { cwd: snapshotRoot });
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
        createArchive(
            payloadRoot,
            archivePath,
            inventory,
            source.timestampUtc,
            repoRoot,
            snapshotZipHelper
        );
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
        let smoke;
        try {
            externalSmokeSession = createExternalSmokeSession(repoRoot, artifactId);
            await verifyAndExtractArchive(
                archivePath,
                verificationManifestPath,
                externalSmokeSession.extractionRoot,
                externalSmokeSession.sessionRoot,
                snapshotZipHelper
            );
            smoke = runExternalSmoke(
                externalSmokeSession.extractionRoot,
                externalSmokeSession.smokeRoot,
                externalSmokeSession.sessionRoot,
                repoRoot
            );
        } finally {
            cleanupExternalSmokeSession(externalSmokeSession);
            externalSmokeSession = null;
        }

        assertSourceUnchanged(repoRoot, source);
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
                pnpmVersion: run('pnpm', ['--version'], {
                    cwd: snapshotRoot,
                    capture: true
                }).stdout.trim(),
                lockSha256,
                deployedPackageIdentities: deployedPackages,
                sbomPackages: packageCount
            },
            pruning,
            checks: {
                immutableSourceSnapshot: 'clean',
                sourceIdentityRevalidated: 'clean',
                forbiddenContent: 'clean',
                machineMetadata: 'clean',
                reproducibleZipMetadata: 'clean',
                archivePreflight: 'clean',
                expandedInventory: 'clean',
                externalSmoke: 'clean',
                externalSmokeCleanup: 'clean',
                externalSmokeLocation: 'outside-repository',
                externalSmokeResolution: 'payload-only-no-global-paths',
                negativeDependencyFallback: 'blocked',
                smokeResolutionPathCount: smoke.resolutionPathCount,
                smokeOutput: smoke.output
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
                repository: source.repository,
                repositoryUrl: source.repositoryUrl,
                remote: source.remote,
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
        assertSourceUnchanged(repoRoot, source);
        result = {
            schemaVersion: 1,
            artifactId,
            artifactRoot,
            sourceCommit: source.commit,
            archive: archiveEvidence
        };
        completed = true;
    } finally {
        cleanupExternalSmokeSession(externalSmokeSession);
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
    const manifestPath = resolveArtifactFile(artifactRoot, 'manifest.json', 'Manifest path');
    const completePath = resolveArtifactFile(artifactRoot, 'COMPLETE.json', 'Completion path');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const complete = JSON.parse(fs.readFileSync(completePath, 'utf8'));
    ensure(manifest.report && manifest.sbom && manifest.licenses && manifest.archive,
        'Manifest sidecar declarations are incomplete.');
    const reportPath = resolveArtifactFile(artifactRoot, manifest.report.path, 'Build report path');
    const sbomPath = resolveArtifactFile(artifactRoot, manifest.sbom.path, 'SBOM path');
    const licensesPath = resolveArtifactFile(artifactRoot, manifest.licenses.path, 'License inventory path');
    const archivePath = resolveArtifactFile(artifactRoot, manifest.archive.name, 'Archive path');
    ensure(complete.manifestSha256 === sha256File(manifestPath), 'COMPLETE manifest hash mismatch.');
    ensure(complete.archiveSha256 === manifest.archive.sha256, 'COMPLETE archive hash mismatch.');
    ensure(manifest.report.sha256 === sha256File(reportPath),
        'Build report hash mismatch.');
    ensure(manifest.sbom.sha256 === sha256File(sbomPath), 'SBOM hash mismatch.');
    ensure(manifest.licenses.sha256 === sha256File(licensesPath), 'License hash mismatch.');
    const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    ensure(report.artifactId === manifest.artifactId && report.evidenceOnly === true,
        'Build report identity or evidence role mismatch.');
    const sbom = JSON.parse(fs.readFileSync(sbomPath, 'utf8'));
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
        archivePath,
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
    for (const unsafeSidecar of [
        '../report.json',
        'C:/outside/report.json',
        '/absolute/report.json',
        '//server/share/report.json',
        'mixed\\separator.json',
        'nested/../report.json',
        'report.json:stream'
    ]) {
        let rejected = false;
        try {
            assertCanonicalArtifactRelativePath(unsafeSidecar, 'Fixture sidecar');
        } catch {
            rejected = true;
        }
        ensure(rejected, `Unsafe manifest sidecar path was accepted: ${unsafeSidecar}`);
    }
    ensure(
        npmPurl('@anthropic-ai/claude-agent-sdk', '0.2.96')
            === 'pkg:npm/%40anthropic-ai/claude-agent-sdk@0.2.96',
        'Scoped npm PURL fixture was encoded incorrectly.'
    );
    ensure(
        JSON.stringify(normalizeGitHubRemote('git@github.com:evmitran_microsoft/codexu.git'))
            === JSON.stringify({
                repository: 'evmitran_microsoft/codexu',
                repositoryUrl: 'https://github.com/evmitran_microsoft/codexu'
            }),
        'GitHub SSH provenance normalization fixture changed.'
    );
    const originSelected = selectCanonicalRepository({
        origin: ['https://github.com/evmitran_microsoft/codexu.git'],
        personal: ['https://github.com/Evyatar108/codexu.git']
    });
    ensure(originSelected.remote === 'origin'
        && originSelected.repository === 'evmitran_microsoft/codexu',
    'Origin provenance preference fixture changed.');
    const personalSelected = selectCanonicalRepository({
        origin: ['https://github.com/evmitran_microsoft/codexu.git'],
        personal: ['git@github.com:Evyatar108/codexu.git']
    }, ['personal']);
    ensure(personalSelected.remote === 'personal'
        && personalSelected.repository === 'Evyatar108/codexu',
    'Personal provenance preference fixture changed.');
    for (const invalidRemotes of [
        { origin: ['https://gitlab.com/example/codexu.git'] },
        {
            origin: [
                'https://github.com/evmitran_microsoft/codexu.git',
                'https://github.com/Evyatar108/codexu.git'
            ]
        },
        {}
    ]) {
        let rejected = false;
        try {
            selectCanonicalRepository(invalidRemotes);
        } catch {
            rejected = true;
        }
        ensure(rejected, 'Unavailable, ambiguous, or non-GitHub provenance fixture was accepted.');
    }
    const turkishFixture = ['I', '\u0130', 'i', '\u0131', 'alpha', 'Z'];
    const ordinalFixture = [...turkishFixture].sort(ordinalCompare);
    ensure(
        JSON.stringify(ordinalFixture) === JSON.stringify(['I', 'Z', 'alpha', 'i', '\u0130', '\u0131']),
        'Ordinal integrity ordering fixture changed.'
    );
    ensure(
        sha256Bytes(ordinalFixture.join('\n'))
            === 'B324FE4AA2D7D34190FEA00FBBC23E064548ECF1734904E6F01240661A83BEBF',
        'Ordinal Turkish-locale hash-input fixture changed.'
    );
    ensure(
        JSON.stringify([...turkishFixture].sort(new Intl.Collator('tr').compare))
            !== JSON.stringify(ordinalFixture),
        'Turkish-locale regression fixture no longer distinguishes locale ordering.'
    );
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

    const sourceRepo = path.join(testRoot, 'source-repo');
    const sourceWork = path.join(testRoot, 'source-work');
    fs.mkdirSync(path.join(sourceRepo, 'packages', 'happy-cli'), { recursive: true });
    fs.mkdirSync(path.join(sourceRepo, 'packages', 'happy-server'), { recursive: true });
    fs.mkdirSync(path.join(sourceRepo, 'packages', 'happy-wire', 'dist'), { recursive: true });
    fs.writeFileSync(path.join(sourceRepo, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n', 'ascii');
    fs.writeFileSync(path.join(sourceRepo, 'pnpm-workspace.yaml'), 'packages: []\n', 'ascii');
    for (const packageName of ['happy-cli', 'happy-server', 'happy-wire']) {
        fs.writeFileSync(
            path.join(sourceRepo, 'packages', packageName, 'package.json'),
            `${JSON.stringify({ name: packageName, version: '1.0.0' })}\n`,
            'ascii'
        );
    }
    const trackedFixture = path.join(sourceRepo, 'packages', 'happy-wire', 'dist', 'fixture.txt');
    fs.writeFileSync(trackedFixture, 'committed\n', 'ascii');
    run('git', ['init', '--initial-branch=main'], { cwd: sourceRepo });
    run('git', ['config', 'user.email', 'portable-fixture@example.invalid'], { cwd: sourceRepo });
    run('git', ['config', 'user.name', 'Portable Fixture'], { cwd: sourceRepo });
    run('git', ['remote', 'add', 'origin', 'https://github.com/example/portable-fixture.git'], {
        cwd: sourceRepo
    });
    run('git', ['add', '.'], { cwd: sourceRepo });
    run('git', ['commit', '-m', 'fixture'], { cwd: sourceRepo });
    const selectedSource = assertCleanSource(sourceRepo);
    const snapshotRoot = materializeSourceSnapshot(sourceRepo, selectedSource, sourceWork);
    ensure(
        fs.readFileSync(
            path.join(snapshotRoot, 'packages', 'happy-wire', 'dist', 'fixture.txt'),
            'utf8'
        ).trim() === 'committed',
        'Immutable source snapshot did not preserve the selected commit.'
    );
    fs.writeFileSync(trackedFixture, 'concurrent modification\n', 'ascii');
    let modificationRejected = false;
    try {
        assertSourceUnchanged(sourceRepo, selectedSource);
    } catch {
        modificationRejected = true;
    }
    ensure(modificationRejected
        && fs.readFileSync(trackedFixture, 'utf8') === 'concurrent modification\n',
    'Tracked source modification was reset, deleted, or not rejected.');
    run('git', ['add', 'packages/happy-wire/dist/fixture.txt'], { cwd: sourceRepo });
    run('git', ['commit', '-m', 'drift'], { cwd: sourceRepo });
    let headDriftRejected = false;
    try {
        assertSourceUnchanged(sourceRepo, selectedSource);
    } catch {
        headDriftRejected = true;
    }
    ensure(headDriftRejected, 'Source HEAD drift was not rejected.');
    const helperSource = fs.readFileSync(__filename, 'utf8');
    ensure(!/git\s*\([^)]*\[\s*['"](?:checkout|reset|clean|restore)['"]/s.test(helperSource),
        'Portable builder contains a destructive git worktree command.');

    const junctionTarget = path.join(testRoot, 'junction-target');
    const junctionPath = path.join(testRoot, 'junction');
    fs.mkdirSync(junctionTarget, { recursive: true });
    fs.writeFileSync(path.join(junctionTarget, 'report.json'), '{}\n', 'ascii');
    const junction = spawnSync(process.env.ComSpec || 'cmd.exe', [
        '/d', '/s', '/c', 'mklink', '/J', junctionPath, junctionTarget
    ], { encoding: 'utf8', windowsHide: true, shell: false });
    if (junction.status === 0) {
        let junctionRejected = false;
        let reparseSidecarRejected = false;
        try {
            assertSafeOwnedPath(path.join(junctionPath, 'child'), repoRoot, { allowRoot: false });
        } catch {
            junctionRejected = true;
        }
        ensure(junctionRejected, 'Live Windows junction output path was accepted.');
        try {
            resolveArtifactFile(testRoot, 'junction/report.json', 'Reparse sidecar fixture');
        } catch {
            reparseSidecarRejected = true;
        }
        ensure(reparseSidecarRejected, 'Manifest sidecar under a live junction was accepted.');

        const cleanupTree = path.join(testRoot, 'cleanup-tree-with-link');
        const cleanupLink = path.join(cleanupTree, 'workspace-link');
        fs.mkdirSync(cleanupTree, { recursive: true });
        const cleanupJunction = spawnSync(process.env.ComSpec || 'cmd.exe', [
            '/d', '/s', '/c', 'mklink', '/J', cleanupLink, junctionTarget
        ], { encoding: 'utf8', windowsHide: true, shell: false });
        ensure(cleanupJunction.status === 0, 'Unable to create nested cleanup junction fixture.');
        removeTree(cleanupTree, repoRoot);
        ensure(fs.existsSync(path.join(junctionTarget, 'report.json')),
            'Disposable tree cleanup traversed a nested workspace junction.');

        removeTree(junctionTarget, repoRoot);
        ensure(!fs.existsSync(junctionPath),
            'Dangling junction fixture unexpectedly resolves through existsSync.');
        let danglingLstatSucceeded = false;
        try {
            fs.lstatSync(junctionPath);
            danglingLstatSucceeded = true;
        } catch {
            // The deterministic component fixture below remains the fallback.
        }
        let danglingRejected = false;
        try {
            assertSafeOwnedPath(path.join(junctionPath, 'child'), repoRoot, { allowRoot: false });
        } catch {
            danglingRejected = true;
        } finally {
            fs.rmdirSync(junctionPath);
        }
        ensure(danglingLstatSucceeded && danglingRejected,
            'Dangling Windows junction bypass regression was not rejected.');
        console.log('Live Windows junction, dangling-junction, and sidecar probes passed.');
    } else {
        let deterministicDanglingRejected = false;
        try {
            assertPathComponentsSafe([
                { path: 'C:\\safe', isReparse: false },
                { path: 'C:\\safe\\dangling', isReparse: true, resolved: null }
            ]);
        } catch {
            deterministicDanglingRejected = true;
        }
        ensure(deterministicDanglingRejected,
            'Deterministic dangling-junction component fixture was accepted.');
        console.log('Live Windows junction probe unavailable; deterministic dangling fixture passed.');
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
