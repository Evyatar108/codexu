import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  initializeLaunchStatus,
  launchContextProvenance,
  markLaunchCompleted,
  markLaunchFailedBeforeOwnership,
  markLaunchOwned,
  readEvCopilotLaunchContext,
} from './launchContext';

const scratchRoots: string[] = [];
const HASH_B = 'B'.repeat(64);

async function fixture(overrides: Record<string, unknown> = {}): Promise<{
  localAppData: string;
  contextPath: string;
  statusPath: string;
  executingEntryPoint: string;
  happyManifestPath: string;
  happyManifestSha256: string;
  context: Record<string, unknown>;
}> {
  const localAppData = join(process.cwd(), '.test-artifacts', `launch-context-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  scratchRoots.push(localAppData);
  const invocationId = 'invocation-1';
  const run = join(localAppData, 'EvCopilot', 'run', invocationId);
  const runtime = join(localAppData, 'EvCopilot', 'versions', 'ev-artifact', 'payload');
  const runtimeRoot = join(localAppData, 'EvCopilot', 'versions', 'ev-artifact');
  await mkdir(join(runtime, 'dist-cli'), { recursive: true });
  await mkdir(run, { recursive: true });
  const contextPath = join(run, 'launch-context.json');
  const statusPath = join(run, 'happy-status.json');
  await writeFile(join(runtime, 'node.exe'), 'node', 'utf8');
  await writeFile(join(runtime, 'dist-cli', 'index.js'), 'entry', 'utf8');
  const runtimeManifest = JSON.stringify({
    schemaVersion: 2,
    artifactId: 'ev-artifact',
    version: 'ev-artifact',
    channel: 'local-preview',
    platform: 'win32-x64',
    edition: {
      name: 'owner-preview',
      version: '2026.07',
    },
    source: {
      head: 'a'.repeat(40),
    },
    copilot: {
      packageVersion: '1.0.71-3',
      nodeVersion: '22.17.0',
      executable: 'payload/node.exe',
      fixedArguments: ['payload/dist-cli/index.js'],
    },
  });
  await writeFile(join(runtimeRoot, 'manifest.json'), runtimeManifest, 'utf8');
  const runtimeManifestSha256 = createHash('sha256')
    .update(runtimeManifest)
    .digest('hex')
    .toUpperCase();
  const happyRoot = join(localAppData, 'EvCopilot', 'happy', 'versions', 'happy-artifact');
  const executingEntryPoint = join(happyRoot, 'payload', 'happy', 'dist', 'index.mjs');
  await mkdir(join(happyRoot, 'payload', 'happy', 'dist'), { recursive: true });
  await writeFile(executingEntryPoint, 'happy', 'utf8');
  const happyManifestPath = join(happyRoot, 'manifest.json');
  const happyManifest = JSON.stringify({
    schemaVersion: 1,
    artifactId: 'happy-artifact',
    version: 'happy-artifact',
    channel: 'local-preview',
    payloadLabel: 'unsigned-owner-only',
    platform: 'win32-x64',
    publishedAtUtc: '2026-07-22T00:00:00.000Z',
    happyCliVersion: '1.2.3',
    source: {
      repository: 'Evyatar108/happy',
      commit: 'b'.repeat(40),
      branch: 'main',
      dirty: false,
    },
    node: {
      version: '22.17.0',
      distributionSha256: 'C'.repeat(64),
    },
    archive: {
      name: 'happy-win32-x64.zip',
      sha256: 'D'.repeat(64),
      length: 100,
      fileCount: 1,
      expandedLength: 200,
    },
    entrypoints: {
      node: 'payload/node.exe',
      happy: 'payload/happy/dist/index.mjs',
    },
    files: [{
      relativePath: 'payload/happy/dist/index.mjs',
      length: 5,
      sha256: 'E'.repeat(64),
    }],
    compatibility: {
      launcherSchemaVersions: [1],
      evCopilot: [{
        artifactId: 'ev-artifact',
        manifestSha256: runtimeManifestSha256,
        copilotPackageVersion: '1.0.71-3',
      }],
      controller: {
        registrySchema: 2,
        protocolVersion: 3,
        copilotPackageVersions: ['1.0.71-3'],
      },
    },
    capabilities: ['copilot-terminal-route-v1'],
    sbom: {
      path: 'sbom.spdx.json',
      sha256: 'F'.repeat(64),
    },
  });
  await writeFile(happyManifestPath, happyManifest, 'utf8');
  const happyManifestSha256 = createHash('sha256')
    .update(happyManifest)
    .digest('hex')
    .toUpperCase();
  await writeFile(join(happyRoot, 'receipt.json'), JSON.stringify({
    schemaVersion: 1,
    artifactId: 'happy-artifact',
    manifestSha256: happyManifestSha256,
    archiveSha256: 'C'.repeat(64),
    sbomSha256: 'D'.repeat(64),
    releaseSetId: 'release-1',
    channelPointerSha256: 'E'.repeat(64),
    verifierVersion: '1.0.0',
    verifiedAtUtc: '2026-07-22T00:00:00.000Z',
  }), 'utf8');
  const context = {
    schemaVersion: 1,
    invocationId,
    channel: 'local-preview',
    releaseSetId: 'release-1',
    statusPath,
    evCopilot: {
      artifactId: 'ev-artifact',
      manifestSha256: runtimeManifestSha256,
      packageVersion: '1.0.71-3',
      executablePath: join(runtime, 'node.exe'),
      fixedArguments: [join(runtime, 'dist-cli', 'index.js')],
      edition: {
        name: 'owner-preview',
        version: '2026.07',
        sourceCommit: 'a'.repeat(40),
      },
    },
    happy: {
      artifactId: 'happy-artifact',
      manifestSha256: happyManifestSha256,
      cliVersion: '1.2.3',
    },
    ...overrides,
  };
  await writeFile(contextPath, JSON.stringify(context), 'utf8');
  return {
    localAppData,
    contextPath,
    statusPath,
    executingEntryPoint,
    happyManifestPath,
    happyManifestSha256,
    context,
  };
}

function validationOptions(
  value: Awaited<ReturnType<typeof fixture>>,
  overrides: Record<string, unknown> = {},
) {
  return {
    localAppData: value.localAppData,
    currentCliVersion: '1.2.3',
    payloadIdentity: {
      artifactId: 'happy-artifact',
      manifestSha256: value.happyManifestSha256,
    },
    executingEntryPoint: value.executingEntryPoint,
    ...overrides,
  };
}

async function rewriteHappyManifest(
  value: Awaited<ReturnType<typeof fixture>>,
  update: (manifest: Record<string, any>) => void,
): Promise<void> {
  const manifest = JSON.parse(await readFile(value.happyManifestPath, 'utf8')) as Record<string, any>;
  update(manifest);
  const source = JSON.stringify(manifest);
  await writeFile(value.happyManifestPath, source, 'utf8');
  value.happyManifestSha256 = createHash('sha256').update(source).digest('hex').toUpperCase();
  const happy = value.context.happy as Record<string, unknown>;
  happy.manifestSha256 = value.happyManifestSha256;
  await writeFile(value.contextPath, JSON.stringify(value.context), 'utf8');
  const receiptPath = join(
    value.localAppData,
    'EvCopilot',
    'happy',
    'versions',
    'happy-artifact',
    'receipt.json',
  );
  const receipt = JSON.parse(await readFile(receiptPath, 'utf8')) as Record<string, unknown>;
  receipt.manifestSha256 = value.happyManifestSha256;
  await writeFile(receiptPath, JSON.stringify(receipt), 'utf8');
}

async function rewriteRuntimeManifest(
  value: Awaited<ReturnType<typeof fixture>>,
  update: (manifest: Record<string, any>) => void,
): Promise<void> {
  const path = join(
    value.localAppData,
    'EvCopilot',
    'versions',
    'ev-artifact',
    'manifest.json',
  );
  const manifest = JSON.parse(await readFile(path, 'utf8')) as Record<string, any>;
  update(manifest);
  const source = JSON.stringify(manifest);
  await writeFile(path, source, 'utf8');
  const manifestSha256 = createHash('sha256').update(source).digest('hex').toUpperCase();
  const evCopilot = value.context.evCopilot as Record<string, unknown>;
  evCopilot.manifestSha256 = manifestSha256;
  await writeFile(value.contextPath, JSON.stringify(value.context), 'utf8');
  await rewriteHappyManifest(value, (happyManifest) => {
    happyManifest.compatibility.evCopilot[0].manifestSha256 = manifestSha256;
  });
}

afterEach(async () => {
  await Promise.all(scratchRoots.splice(0).map((root) => rm(root, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 50,
  })));
});

describe('EvCopilot launch context', () => {
  it('accepts one exact compatible local context and projects path-free provenance', async () => {
    const value = await fixture();
    const context = await readEvCopilotLaunchContext(value.contextPath, validationOptions(value));

    const provenance = launchContextProvenance(context);
    expect(provenance).toMatchObject({
      launcher: { channel: 'local-preview', releaseSetId: 'release-1' },
      happyPayload: {
        artifactId: 'happy-artifact',
        manifestSha256: value.happyManifestSha256,
        cliVersion: '1.2.3',
      },
      copilotRuntime: { artifactId: 'ev-artifact', packageVersion: '1.0.71-3' },
    });
    const serialized = JSON.stringify(provenance);
    expect(serialized).not.toContain(value.localAppData);
    expect(serialized).not.toContain('fixedArguments');
    expect(serialized).not.toContain('token');
  });

  it('rejects unknown fields, unsupported package, payload mismatch, and misplaced context', async () => {
    const extra = await fixture({ secret: 'must-not-pass' });
    await expect(readEvCopilotLaunchContext(extra.contextPath, validationOptions(extra)))
      .rejects.toMatchObject({ code: 'invalid-schema' });

    const extraFixedArgument = await fixture();
    const invalidFixedArguments = {
      ...extraFixedArgument.context,
      evCopilot: {
        ...(extraFixedArgument.context.evCopilot as Record<string, unknown>),
        fixedArguments: ['first.js', 'second.js'],
      },
    };
    await writeFile(
      extraFixedArgument.contextPath,
      JSON.stringify(invalidFixedArguments),
      'utf8',
    );
    await expect(readEvCopilotLaunchContext(
      extraFixedArgument.contextPath,
      validationOptions(extraFixedArgument),
    )).rejects.toMatchObject({ code: 'invalid-schema' });

    const lowercaseHash = await fixture();
    const invalidHash = {
      ...lowercaseHash.context,
      happy: {
        ...(lowercaseHash.context.happy as Record<string, unknown>),
        manifestSha256: 'b'.repeat(64),
      },
    };
    await writeFile(lowercaseHash.contextPath, JSON.stringify(invalidHash), 'utf8');
    await expect(readEvCopilotLaunchContext(
      lowercaseHash.contextPath,
      validationOptions(lowercaseHash),
    )).rejects.toMatchObject({ code: 'invalid-schema' });

    const packageMismatch = await fixture();
    const changedPackage = {
      ...packageMismatch.context,
      evCopilot: {
        ...(packageMismatch.context.evCopilot as Record<string, unknown>),
        packageVersion: '1.0.72-0',
      },
    };
    await writeFile(packageMismatch.contextPath, JSON.stringify(changedPackage), 'utf8');
    await expect(readEvCopilotLaunchContext(
      packageMismatch.contextPath,
      validationOptions(packageMismatch),
    )).rejects.toMatchObject({ code: 'unsupported-copilot-package' });

    const manifestMismatch = await fixture();
    await writeFile(join(
      manifestMismatch.localAppData,
      'EvCopilot',
      'versions',
      'ev-artifact',
      'manifest.json',
    ), '{}', 'utf8');
    await expect(readEvCopilotLaunchContext(
      manifestMismatch.contextPath,
      validationOptions(manifestMismatch),
    )).rejects.toMatchObject({ code: 'invalid-runtime-manifest' });

    const payloadMismatch = await fixture();
    await expect(readEvCopilotLaunchContext(
      payloadMismatch.contextPath,
      validationOptions(payloadMismatch, {
        payloadIdentity: {
          artifactId: 'other-happy',
          manifestSha256: payloadMismatch.happyManifestSha256,
        },
      }),
    )).rejects.toMatchObject({ code: 'happy-payload-identity-mismatch' });

    const misplaced = await fixture();
    const otherPath = join(misplaced.localAppData, 'context.json');
    await writeFile(otherPath, JSON.stringify(misplaced.context), 'utf8');
    await expect(readEvCopilotLaunchContext(otherPath, validationOptions(misplaced)))
      .rejects.toMatchObject({ code: 'invalid-context-path' });

    const wrongEntryPoint = await fixture();
    await expect(readEvCopilotLaunchContext(
      wrongEntryPoint.contextPath,
      validationOptions(wrongEntryPoint, {
        executingEntryPoint: join(wrongEntryPoint.localAppData, 'other', 'index.mjs'),
      }),
    )).rejects.toMatchObject({ code: 'happy-payload-entrypoint-mismatch' });

    const receiptMismatch = await fixture();
    const receiptPath = join(
      receiptMismatch.localAppData,
      'EvCopilot',
      'happy',
      'versions',
      'happy-artifact',
      'receipt.json',
    );
    const receipt = JSON.parse(await readFile(receiptPath, 'utf8'));
    await writeFile(receiptPath, JSON.stringify({ ...receipt, releaseSetId: 'other-release' }), 'utf8');
    await expect(readEvCopilotLaunchContext(
      receiptMismatch.contextPath,
      validationOptions(receiptMismatch),
    )).rejects.toMatchObject({ code: 'happy-payload-receipt-mismatch' });
  });

  it('rejects non-v2 or identity-mismatched EvCopilot manifests', async () => {
    const wrongSchema = await fixture();
    await rewriteRuntimeManifest(wrongSchema, (manifest) => {
      manifest.schemaVersion = 1;
    });
    await expect(readEvCopilotLaunchContext(wrongSchema.contextPath, validationOptions(wrongSchema)))
      .rejects.toMatchObject({ code: 'invalid-runtime-manifest' });

    const wrongArtifact = await fixture();
    await rewriteRuntimeManifest(wrongArtifact, (manifest) => {
      manifest.artifactId = 'another-ev-artifact';
      manifest.version = 'another-ev-artifact';
    });
    await expect(readEvCopilotLaunchContext(wrongArtifact.contextPath, validationOptions(wrongArtifact)))
      .rejects.toMatchObject({ code: 'runtime-manifest-identity-mismatch' });
  });

  it('rejects same-package runtime artifacts not cross-bound by the Happy manifest', async () => {
    const value = await fixture();
    await rewriteHappyManifest(value, (manifest) => {
      manifest.compatibility.evCopilot[0].artifactId = 'different-ev-artifact';
    });

    await expect(readEvCopilotLaunchContext(value.contextPath, validationOptions(value)))
      .rejects.toMatchObject({ code: 'release-set-incompatible' });
  });

  it('rejects invalid Happy identity, controller compatibility, and route capability', async () => {
    const wrongSchema = await fixture();
    await rewriteHappyManifest(wrongSchema, (manifest) => {
      manifest.schemaVersion = 2;
    });
    await expect(readEvCopilotLaunchContext(
      wrongSchema.contextPath,
      validationOptions(wrongSchema),
    )).rejects.toMatchObject({ code: 'invalid-happy-payload-manifest' });

    const wrongIdentity = await fixture();
    await rewriteHappyManifest(wrongIdentity, (manifest) => {
      manifest.version = 'different-happy-artifact';
    });
    await expect(readEvCopilotLaunchContext(
      wrongIdentity.contextPath,
      validationOptions(wrongIdentity),
    )).rejects.toMatchObject({ code: 'happy-manifest-identity-mismatch' });

    const wrongController = await fixture();
    await rewriteHappyManifest(wrongController, (manifest) => {
      manifest.compatibility.controller.protocolVersion = 4;
    });
    await expect(readEvCopilotLaunchContext(
      wrongController.contextPath,
      validationOptions(wrongController),
    )).rejects.toMatchObject({ code: 'invalid-happy-payload-manifest' });

    const wrongRegistry = await fixture();
    await rewriteHappyManifest(wrongRegistry, (manifest) => {
      manifest.compatibility.controller.registrySchema = 1;
    });
    await expect(readEvCopilotLaunchContext(
      wrongRegistry.contextPath,
      validationOptions(wrongRegistry),
    )).rejects.toMatchObject({ code: 'invalid-happy-payload-manifest' });

    const unsupportedPackage = await fixture();
    await rewriteHappyManifest(unsupportedPackage, (manifest) => {
      manifest.compatibility.controller.copilotPackageVersions = ['1.0.72-0'];
    });
    await expect(readEvCopilotLaunchContext(
      unsupportedPackage.contextPath,
      validationOptions(unsupportedPackage),
    )).rejects.toMatchObject({ code: 'release-set-incompatible' });

    const missingCapability = await fixture();
    await rewriteHappyManifest(missingCapability, (manifest) => {
      manifest.capabilities = [];
    });
    await expect(readEvCopilotLaunchContext(
      missingCapability.contextPath,
      validationOptions(missingCapability),
    )).rejects.toMatchObject({ code: 'terminal-route-capability-missing' });
  });

  it('keeps ownership monotonic and records only stable failure codes', async () => {
    const value = await fixture();
    const context = await readEvCopilotLaunchContext(value.contextPath, validationOptions(value));
    await initializeLaunchStatus(context);
    await markLaunchFailedBeforeOwnership(context, 'startup-failure');
    expect(JSON.parse(await readFile(value.statusPath, 'utf8'))).toMatchObject({
      phase: 'initializing',
      failureCode: 'startup-failure',
    });

    await initializeLaunchStatus(context);
    expect(JSON.parse(await readFile(value.statusPath, 'utf8'))).toMatchObject({
      phase: 'initializing',
      failureCode: 'startup-failure',
    });
    await markLaunchOwned(context, 4242);
    await markLaunchFailedBeforeOwnership(context, 'startup-failure');
    await markLaunchCompleted(context, { exitCode: 7, failureCode: 'runtime-failure' });
    expect(JSON.parse(await readFile(value.statusPath, 'utf8'))).toMatchObject({
      phase: 'completed',
      targetPid: 4242,
      exitCode: 7,
      failureCode: 'runtime-failure',
    });
    await expect(initializeLaunchStatus(context)).rejects.toMatchObject({ code: 'status-regression' });
  });
});
