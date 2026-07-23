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
    '.npmrc',
    '.pnpmfile.cjs',
    '.yarnrc',
    'credentials',
    'credentials.json',
    'providers.json'
]);
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;

function fail(message) {
    throw new Error(message);
}

function ensure(condition, message) {
    if (!condition) fail(message);
}

function isUnderOneDrive(target) {
    const candidate = `${path.resolve(target).toLowerCase()}${path.sep}`;
    return ['OneDrive', 'OneDriveCommercial', 'OneDriveConsumer']
        .map((name) => process.env[name])
        .filter(Boolean)
        .some((root) => candidate.startsWith(`${path.resolve(root).toLowerCase()}${path.sep}`));
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

function removeTree(target) {
    fs.rmSync(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
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
        removeTree(directory);
    }

    for (const packageName of DEVELOPMENT_PACKAGE_NAMES) {
        const packagePath = path.join(deployRoot, 'node_modules', ...packageName.split('/'));
        if (!fs.existsSync(packagePath)) continue;
        const files = enumerateRegularFiles(packagePath);
        removedFiles += files.length;
        removedBytes += files.reduce((sum, file) => sum + fs.statSync(file).size, 0);
        removeTree(packagePath);
    }
    const virtualStoreMetadata = path.join(deployRoot, 'node_modules', '.pnpm');
    if (fs.existsSync(virtualStoreMetadata)) {
        const files = enumerateRegularFiles(virtualStoreMetadata);
        removedFiles += files.length;
        removedBytes += files.reduce((sum, file) => sum + fs.statSync(file).size, 0);
        removeTree(virtualStoreMetadata);
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
        if (name === '.env'
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

function downloadNode(downloadRoot) {
    fs.mkdirSync(downloadRoot, { recursive: true });
    const archivePath = path.join(downloadRoot, NODE_ARCHIVE);
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

function buildSbom(deployRoot, payloadRoot, source, artifactId, outputPath, licenseInventoryPath) {
    const packages = [];
    const relationships = [];
    const licenseInventory = [];
    const seen = new Set();
    for (const item of readPackageRoots(deployRoot)) {
        const version = normalizeVersion(item.manifest.version);
        const identity = `${item.manifest.name}@${version}`;
        if (seen.has(identity)) continue;
        seen.add(identity);
        const packageRoot = path.dirname(item.file);
        const licenseFiles = fs.readdirSync(packageRoot, { withFileTypes: true })
            .filter((entry) => entry.isFile() && /^(LICENSE|LICENCE|COPYING|NOTICE)(\..*)?$/i.test(entry.name))
            .map((entry) => path.join(packageRoot, entry.name));
        const declared = typeof item.manifest.license === 'string' && item.manifest.license.trim()
            ? item.manifest.license.trim()
            : 'NOASSERTION';
        ensure(declared !== 'NOASSERTION' || licenseFiles.length > 0,
            `Package has no declared license or license file: ${identity}`);
        const id = spdxId(identity);
        packages.push({
            name: item.manifest.name,
            SPDXID: id,
            versionInfo: version,
            downloadLocation: 'NOASSERTION',
            filesAnalyzed: false,
            licenseConcluded: 'NOASSERTION',
            licenseDeclared: declared,
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
            declared,
            files: licenseFiles.map((file) => ({
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
        files: [{
            relativePath: 'payload/NODE-LICENSE.txt',
            sha256: sha256File(nodeLicense),
            length: fs.statSync(nodeLicense).size
        }]
    });
    packages.sort((left, right) => `${left.name}@${left.versionInfo}`.localeCompare(`${right.name}@${right.versionInfo}`));
    licenseInventory.sort((left, right) => `${left.name}@${left.version}`.localeCompare(`${right.name}@${right.version}`));
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
        relationships
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

function verifyAndExtractArchive(archivePath, manifestPath, extractionRoot) {
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
        extractionRoot
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

function createArchive(payloadRoot, archivePath, inventory) {
    fs.rmSync(archivePath, { force: true });
    const fileListPath = path.join(path.dirname(payloadRoot), 'archive-files.txt');
    const fileList = inventory.files.map((file) => file.relativePath).join('\n');
    fs.writeFileSync(fileListPath, `${fileList}\n`, 'utf8');
    run('tar.exe', ['-a', '-c', '-f', archivePath, '--options', 'compression-level=9', '-C',
        path.dirname(payloadRoot), '-T', fileListPath]);
    fs.unlinkSync(fileListPath);
    ensure(fs.existsSync(archivePath), 'ZIP creation did not produce an archive.');
}

function runExternalSmoke(extractionRoot, smokeRoot) {
    removeTree(smokeRoot);
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
    removeTree(happyHome);
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
    ensure(outputRoot.startsWith(`${repoRoot}${path.sep}`), 'Output must be inside the repository worktree.');
    ensure(!isUnderOneDrive(outputRoot), 'Output path must not be inside OneDrive.');
    const source = assertCleanSource(repoRoot);
    const packageManifest = JSON.parse(fs.readFileSync(path.join(repoRoot, 'packages', 'happy-cli', 'package.json'), 'utf8'));
    const lockSha256 = sha256File(path.join(repoRoot, 'pnpm-lock.yaml'));
    const startedAt = new Date().toISOString();
    const artifactId = `${startedAt.replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')}-${source.commit.slice(0, 12)}`;
    const workRoot = path.join(outputRoot, '.work');
    const deployRoot = path.join(workRoot, 'deploy');
    const payloadRoot = path.join(workRoot, 'payload');
    const artifactRoot = path.join(outputRoot, artifactId);
    const downloadRoot = path.join(outputRoot, '.downloads');
    removeTree(workRoot);
    ensure(!fs.existsSync(artifactRoot), `Immutable artifact already exists: ${artifactRoot}`);
    fs.mkdirSync(workRoot, { recursive: true });
    fs.mkdirSync(payloadRoot, { recursive: true });
    fs.mkdirSync(artifactRoot, { recursive: true });

    run('pnpm', ['--filter', '@slopus/happy-wire', 'build'], { cwd: repoRoot });
    run('pnpm', ['--filter', 'happy-server', 'build'], { cwd: repoRoot });
    run('pnpm', ['--filter', 'happy', 'build'], { cwd: repoRoot });

    const pins = createLockPins(repoRoot, workRoot);
    const deployEnv = {
        ...process.env,
        HAPPY_PORTABLE_DEPLOY_PINS: pins.pinsPath
    };
    try {
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
    } finally {
        git(repoRoot, ['checkout', '--', 'packages/happy-wire/dist']);
    }
    const deployedPackages = verifyDeployedVersions(deployRoot, pins.pairs);
    const pruning = pruneDeployment(deployRoot);
    scanForbidden(deployRoot);

    const nodeArchive = downloadNode(downloadRoot);
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
    const inventory = inventoryPayload(payloadRoot);
    const archivePath = path.join(artifactRoot, ARCHIVE_NAME);
    createArchive(payloadRoot, archivePath, inventory);
    const archiveSha256 = sha256File(archivePath);
    const archiveLength = fs.statSync(archivePath).size;
    const publishedAtUtc = new Date().toISOString();
    const manifest = {
        schemaVersion: 1,
        artifactId,
        version: artifactId,
        channel: 'local-preview',
        payloadLabel: 'unsigned-owner-only',
        platform: 'win32-x64',
        publishedAtUtc,
        happyCliVersion: packageManifest.version,
        source: {
            repository: 'Evyatar108/happy',
            commit: source.commit,
            branch: source.branch,
            dirty: false,
            pnpmLockSha256: lockSha256
        },
        node: {
            version: NODE_VERSION,
            distributionSha256: NODE_SHA256
        },
        archive: {
            name: ARCHIVE_NAME,
            sha256: archiveSha256,
            length: archiveLength,
            fileCount: inventory.files.length,
            expandedLength: inventory.expandedLength
        },
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

    const extractionRoot = path.join(outputRoot, '.external-smoke', artifactId);
    await verifyAndExtractArchive(archivePath, manifestPath, extractionRoot);
    const smokeOutput = runExternalSmoke(extractionRoot, path.join(outputRoot, '.smoke-state', artifactId));
    const manifestSha256 = sha256File(manifestPath);
    ensure(sha256File(sbomPath) === manifest.sbom.sha256, 'SBOM changed before completion.');
    ensure(sha256File(licenseInventoryPath) === manifest.licenses.sha256, 'License inventory changed before completion.');
    ensure(sha256File(archivePath) === archiveSha256, 'Archive changed before completion.');

    const report = {
        schemaVersion: 1,
        artifactId,
        localOnly: true,
        publishAttempted: false,
        oneDriveWritten: false,
        source,
        startedAtUtc: startedAt,
        completedAtUtc: new Date().toISOString(),
        archive: {
            path: archivePath,
            length: archiveLength,
            sha256: archiveSha256,
            fileCount: inventory.files.length,
            expandedLength: inventory.expandedLength
        },
        dependencies: {
            pnpmVersion: run('pnpm', ['--version'], { cwd: repoRoot, capture: true }).stdout.trim(),
            lockSha256,
            deployedPackageIdentities: deployedPackages,
            sbomPackages: packageCount
        },
        pruning,
        checks: {
            forbiddenContent: 'clean',
            archivePreflight: 'clean',
            expandedInventory: 'clean',
            externalSmoke: 'clean',
            smokeOutput
        }
    };
    writeJson(path.join(artifactRoot, 'build-report.json'), report);
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
    removeTree(workRoot);
    removeTree(path.join(outputRoot, '.smoke-state', artifactId));
    console.log(JSON.stringify(report.archive));
}

async function verify(options) {
    const artifactRoot = path.resolve(options.artifactRoot);
    const manifestPath = path.join(artifactRoot, 'manifest.json');
    const completePath = path.join(artifactRoot, 'COMPLETE.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const complete = JSON.parse(fs.readFileSync(completePath, 'utf8'));
    ensure(complete.manifestSha256 === sha256File(manifestPath), 'COMPLETE manifest hash mismatch.');
    ensure(complete.archiveSha256 === manifest.archive.sha256, 'COMPLETE archive hash mismatch.');
    ensure(manifest.sbom.sha256 === sha256File(path.join(artifactRoot, manifest.sbom.path)), 'SBOM hash mismatch.');
    ensure(manifest.licenses.sha256 === sha256File(path.join(artifactRoot, manifest.licenses.path)), 'License hash mismatch.');
    await verifyAndExtractArchive(
        path.join(artifactRoot, manifest.archive.name),
        manifestPath,
        path.resolve(options.extractionRoot)
    );
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
    console.log('ZIP path fixtures passed.');
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
        ensure(options.artifactRoot && options.extractionRoot,
            'verify requires --artifactRoot and --extractionRoot.');
        await verify(options);
    } else if (command === 'test-paths') {
        testPaths();
    } else {
        fail('Usage: portable-artifact.cjs build|verify|test-paths [options]');
    }
}

main().catch((error) => {
    console.error(error && error.stack ? error.stack : error);
    process.exitCode = 1;
});
