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
  await writeFile(join(happyRoot, 'receipt.json'), JSON.stringify({
    schemaVersion: 1,
    artifactId: 'happy-artifact',
    manifestSha256: HASH_B,
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
      manifestSha256: HASH_B,
      cliVersion: '1.2.3',
    },
    ...overrides,
  };
  await writeFile(contextPath, JSON.stringify(context), 'utf8');
  return { localAppData, contextPath, statusPath, executingEntryPoint, context };
}

function validationOptions(
  value: Awaited<ReturnType<typeof fixture>>,
  overrides: Record<string, unknown> = {},
) {
  return {
    localAppData: value.localAppData,
    currentCliVersion: '1.2.3',
    payloadIdentity: { artifactId: 'happy-artifact', manifestSha256: HASH_B },
    executingEntryPoint: value.executingEntryPoint,
    ...overrides,
  };
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
      happyPayload: { artifactId: 'happy-artifact', manifestSha256: HASH_B, cliVersion: '1.2.3' },
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
        payloadIdentity: { artifactId: 'other-happy', manifestSha256: HASH_B },
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
