/**
 * Strict local contract between the verified EvCopilot launcher and Happy M1a.
 *
 * The context is intentionally path-bearing only inside this process. Callers
 * must project the returned provenance object, never the context itself, into
 * session metadata or diagnostics.
 */

import { createHash, randomUUID } from 'node:crypto';
import { lstat, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';

import { z } from 'zod';

import {
  configuration,
  type HappyPayloadIdentity,
} from '@/configuration';
import type { CopilotIntegrationProvenanceV1 } from '@/api/types';

import { COPILOT_NATIVE_VERSION } from './types';

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const SHA256_PATTERN = /^[A-F0-9]{64}$/;
const SOURCE_COMMIT_PATTERN = /^[A-Fa-f0-9]{40}$/;
const MAX_CONTEXT_BYTES = 64 * 1024;
const MAX_MANIFEST_BYTES = 4 * 1024 * 1024;
const MAX_RECEIPT_BYTES = 64 * 1024;

const identifierSchema = z.string().regex(ID_PATTERN);
const sha256Schema = z.string().regex(SHA256_PATTERN);
const boundedStringSchema = z.string().min(1).max(256);

const launchContextSchema = z.object({
  schemaVersion: z.literal(1),
  invocationId: identifierSchema,
  channel: z.literal('local-preview'),
  releaseSetId: identifierSchema,
  statusPath: z.string().min(1),
  evCopilot: z.object({
    artifactId: identifierSchema,
    manifestSha256: sha256Schema,
    packageVersion: z.string().min(1),
    executablePath: z.string().min(1),
    fixedArguments: z.tuple([z.string().min(1)]),
    edition: z.object({
      name: boundedStringSchema,
      version: boundedStringSchema,
      sourceCommit: z.string().regex(SOURCE_COMMIT_PATTERN),
    }).strict(),
  }).strict(),
  happy: z.object({
    artifactId: identifierSchema,
    manifestSha256: sha256Schema,
    cliVersion: z.string().min(1),
  }).strict(),
}).strict();

const happyCacheReceiptSchema = z.object({
  schemaVersion: z.literal(1),
  artifactId: identifierSchema,
  manifestSha256: sha256Schema,
  archiveSha256: sha256Schema,
  sbomSha256: sha256Schema,
  releaseSetId: identifierSchema,
  channelPointerSha256: sha256Schema,
  verifierVersion: boundedStringSchema,
  verifiedAtUtc: z.string().datetime(),
}).strict();

const evCopilotManifestSchema = z.object({
  copilot: z.object({
    packageVersion: z.string().min(1),
    nodeVersion: boundedStringSchema,
    executable: z.literal('payload/node.exe'),
    fixedArguments: z.tuple([z.literal('payload/dist-cli/index.js')]),
  }).strict(),
}).passthrough();

const launchFailureCodeSchema = z.enum(['startup-failure', 'runtime-failure']);

const launchStatusSchema = z.object({
  schemaVersion: z.literal(1),
  invocationId: identifierSchema,
  phase: z.enum(['initializing', 'owned', 'completed']),
  ownedAtUtc: z.string().datetime().optional(),
  targetPid: z.number().int().positive().optional(),
  exitCode: z.number().int().optional(),
  failureCode: launchFailureCodeSchema.optional(),
}).strict().superRefine((status, context) => {
  if (status.phase === 'initializing' && (status.ownedAtUtc !== undefined || status.targetPid !== undefined)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'initializing status cannot claim ownership' });
  }
  if (status.phase !== 'completed' && status.exitCode !== undefined) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'only completed status can record an exit code' });
  }
  if ((status.phase === 'owned' || status.phase === 'completed')
    && (status.ownedAtUtc === undefined || status.targetPid === undefined)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'owned status requires ownership evidence' });
  }
});

type ParsedLaunchContext = z.infer<typeof launchContextSchema>;
export type EvCopilotHappyLaunchContextV1 = Omit<ParsedLaunchContext, 'evCopilot'> & {
  evCopilot: Omit<ParsedLaunchContext['evCopilot'], 'packageVersion'> & {
    packageVersion: typeof COPILOT_NATIVE_VERSION;
  };
};
export type HappyLaunchStatusV1 = z.infer<typeof launchStatusSchema>;
export type HappyLaunchFailureCode = z.infer<typeof launchFailureCodeSchema>;

export class LaunchContextError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(`EvCopilot launch context rejected: ${code}`);
    this.name = 'LaunchContextError';
    this.code = code;
  }
}

type LaunchContextValidationOptions = {
  localAppData?: string;
  currentCliVersion?: string;
  payloadIdentity?: HappyPayloadIdentity | null;
  executingEntryPoint?: string;
};

function samePath(left: string, right: string): boolean {
  const normalize = (value: string): string => {
    const resolved = resolve(value).replace(/[\\/]+$/, '');
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  };
  return normalize(left) === normalize(right);
}

function isWithin(root: string, candidate: string): boolean {
  const child = relative(resolve(root), resolve(candidate));
  return child === '' || (!child.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`)
    && child !== '..'
    && !isAbsolute(child));
}

async function assertRegularLocalFile(
  root: string,
  file: string,
  code: string,
): Promise<void> {
  if (!isWithin(root, file)) throw new LaunchContextError(code);
  const rootPath = resolve(root);
  const segments = relative(rootPath, resolve(file)).split(/[\\/]/).filter(Boolean);
  let cursor = rootPath;
  try {
    const rootInfo = await lstat(cursor);
    if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) throw new Error('invalid root');
    if (!samePath(await realpath(cursor), cursor)) throw new Error('reparse root');
    for (let index = 0; index < segments.length; index++) {
      cursor = join(cursor, segments[index]);
      const info = await lstat(cursor);
      const isLast = index === segments.length - 1;
      if (info.isSymbolicLink()
        || (isLast ? !info.isFile() : !info.isDirectory())
        || !samePath(await realpath(cursor), cursor)) {
        throw new Error('invalid local file');
      }
    }
  } catch {
    throw new LaunchContextError(code);
  }
}

async function assertSafeStatusPath(runRoot: string, statusPath: string): Promise<void> {
  if (!isWithin(runRoot, statusPath)) throw new LaunchContextError('invalid-status-path');
  const parent = dirname(statusPath);
  try {
    const parentInfo = await lstat(parent);
    if (!parentInfo.isDirectory()
      || parentInfo.isSymbolicLink()
      || !samePath(await realpath(parent), parent)) {
      throw new Error('invalid status parent');
    }

    try {
      const statusInfo = await lstat(statusPath);
      if (!statusInfo.isFile()
        || statusInfo.isSymbolicLink()
        || !samePath(await realpath(statusPath), statusPath)) {
        throw new Error('invalid status file');
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  } catch {
    throw new LaunchContextError('invalid-status-path');
  }
}

async function readBoundedJsonFile(
  path: string,
  maxBytes: number,
  fileCode: string,
  jsonCode: string,
): Promise<unknown> {
  let source: string;
  try {
    const info = await lstat(path);
    if (info.size < 2 || info.size > maxBytes) throw new Error('invalid size');
    source = await readFile(path, 'utf8');
  } catch {
    throw new LaunchContextError(fileCode);
  }
  try {
    return JSON.parse(source);
  } catch {
    throw new LaunchContextError(jsonCode);
  }
}

async function readPinnedJsonFile(
  path: string,
  maxBytes: number,
  expectedSha256: string,
  code: string,
): Promise<unknown> {
  let source: Buffer;
  try {
    const info = await lstat(path);
    if (info.size < 2 || info.size > maxBytes) throw new Error('invalid size');
    source = await readFile(path);
  } catch {
    throw new LaunchContextError(code);
  }
  if (createHash('sha256').update(source).digest('hex').toUpperCase() !== expectedSha256) {
    throw new LaunchContextError(code);
  }
  try {
    return JSON.parse(source.toString('utf8'));
  } catch {
    throw new LaunchContextError(code);
  }
}

function parseSchema<T>(schema: z.ZodType<T>, value: unknown, code: string): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new LaunchContextError(code);
  return result.data;
}

/**
 * Reads and validates one schema-v1 context without logging path-bearing input.
 */
export async function readEvCopilotLaunchContext(
  contextPath: string,
  options: LaunchContextValidationOptions = {},
): Promise<EvCopilotHappyLaunchContextV1> {
  const localAppData = options.localAppData ?? process.env.LOCALAPPDATA;
  if (!localAppData || !isAbsolute(contextPath)) {
    throw new LaunchContextError('invalid-context-path');
  }

  const evCopilotRoot = join(resolve(localAppData), 'EvCopilot');
  const runRoot = join(evCopilotRoot, 'run');
  await assertRegularLocalFile(runRoot, contextPath, 'invalid-context-path');

  const decoded = await readBoundedJsonFile(
    contextPath,
    MAX_CONTEXT_BYTES,
    'invalid-context-file',
    'invalid-json',
  );
  const context = parseSchema(launchContextSchema, decoded, 'invalid-schema');

  const invocationRoot = join(runRoot, context.invocationId);
  if (!samePath(contextPath, join(invocationRoot, 'launch-context.json'))
    || !samePath(context.statusPath, join(invocationRoot, 'happy-status.json'))) {
    throw new LaunchContextError('invocation-path-mismatch');
  }
  await assertSafeStatusPath(runRoot, context.statusPath);

  const runtimeRoot = join(evCopilotRoot, 'versions', context.evCopilot.artifactId);
  const expectedExecutable = join(runtimeRoot, 'payload', 'node.exe');
  const expectedFixedArgument = join(runtimeRoot, 'payload', 'dist-cli', 'index.js');
  if (!samePath(context.evCopilot.executablePath, expectedExecutable)
    || !samePath(context.evCopilot.fixedArguments[0], expectedFixedArgument)) {
    throw new LaunchContextError('runtime-entrypoint-mismatch');
  }
  const runtimeManifestPath = join(runtimeRoot, 'manifest.json');
  await assertRegularLocalFile(runtimeRoot, runtimeManifestPath, 'invalid-runtime-manifest');
  const runtimeManifest = parseSchema(
    evCopilotManifestSchema,
    await readPinnedJsonFile(
      runtimeManifestPath,
      MAX_MANIFEST_BYTES,
      context.evCopilot.manifestSha256,
      'invalid-runtime-manifest',
    ),
    'invalid-runtime-manifest',
  );
  await assertRegularLocalFile(runtimeRoot, context.evCopilot.executablePath, 'invalid-runtime-executable');
  await assertRegularLocalFile(runtimeRoot, context.evCopilot.fixedArguments[0], 'invalid-runtime-entrypoint');

  if (context.evCopilot.packageVersion !== COPILOT_NATIVE_VERSION
    || runtimeManifest.copilot.packageVersion !== context.evCopilot.packageVersion) {
    throw new LaunchContextError('unsupported-copilot-package');
  }
  const currentCliVersion = options.currentCliVersion ?? configuration.currentCliVersion;
  if (context.happy.cliVersion !== currentCliVersion) {
    throw new LaunchContextError('happy-cli-version-mismatch');
  }
  const payloadIdentity = Object.prototype.hasOwnProperty.call(options, 'payloadIdentity')
    ? options.payloadIdentity
    : configuration.currentPayloadIdentity;
  if (!payloadIdentity) throw new LaunchContextError('happy-payload-identity-missing');
  if (context.happy.artifactId !== payloadIdentity.artifactId
    || context.happy.manifestSha256 !== payloadIdentity.manifestSha256) {
    throw new LaunchContextError('happy-payload-identity-mismatch');
  }

  const happyArtifactRoot = join(
    evCopilotRoot,
    'happy',
    'versions',
    context.happy.artifactId,
  );
  const expectedHappyEntryPoint = join(
    happyArtifactRoot,
    'payload',
    'happy',
    'dist',
    'index.mjs',
  );
  const executingEntryPoint = options.executingEntryPoint ?? process.argv[1];
  if (!executingEntryPoint || !samePath(executingEntryPoint, expectedHappyEntryPoint)) {
    throw new LaunchContextError('happy-payload-entrypoint-mismatch');
  }
  await assertRegularLocalFile(
    happyArtifactRoot,
    executingEntryPoint,
    'invalid-happy-payload-entrypoint',
  );
  const receiptPath = join(happyArtifactRoot, 'receipt.json');
  await assertRegularLocalFile(happyArtifactRoot, receiptPath, 'invalid-happy-payload-receipt');
  const receipt = parseSchema(
    happyCacheReceiptSchema,
    await readBoundedJsonFile(
      receiptPath,
      MAX_RECEIPT_BYTES,
      'invalid-happy-payload-receipt',
      'invalid-happy-payload-receipt',
    ),
    'invalid-happy-payload-receipt',
  );
  if (receipt.artifactId !== context.happy.artifactId
    || receipt.manifestSha256 !== context.happy.manifestSha256
    || receipt.releaseSetId !== context.releaseSetId) {
    throw new LaunchContextError('happy-payload-receipt-mismatch');
  }

  return context as EvCopilotHappyLaunchContextV1;
}

export function launchContextProvenance(
  context: EvCopilotHappyLaunchContextV1,
): CopilotIntegrationProvenanceV1 {
  return {
    schemaVersion: 1,
    launcher: {
      channel: context.channel,
      releaseSetId: context.releaseSetId,
    },
    happyPayload: {
      artifactId: context.happy.artifactId,
      manifestSha256: context.happy.manifestSha256,
      cliVersion: context.happy.cliVersion,
    },
    copilotRuntime: {
      artifactId: context.evCopilot.artifactId,
      manifestSha256: context.evCopilot.manifestSha256,
      packageVersion: context.evCopilot.packageVersion,
      editionName: context.evCopilot.edition.name,
      editionVersion: context.evCopilot.edition.version,
      sourceCommit: context.evCopilot.edition.sourceCommit,
    },
  };
}

async function readStatus(context: EvCopilotHappyLaunchContextV1): Promise<HappyLaunchStatusV1 | null> {
  await assertSafeStatusPath(dirname(context.statusPath), context.statusPath);
  try {
    return parseSchema(
      launchStatusSchema,
      JSON.parse(await readFile(context.statusPath, 'utf8')),
      'invalid-status-file',
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    if (error instanceof LaunchContextError) throw error;
    throw new LaunchContextError('invalid-status-file');
  }
}

async function writeStatus(
  context: EvCopilotHappyLaunchContextV1,
  next: HappyLaunchStatusV1,
): Promise<void> {
  const parsed = parseSchema(launchStatusSchema, next, 'invalid-status-transition');
  if (parsed.invocationId !== context.invocationId) {
    throw new LaunchContextError('status-invocation-mismatch');
  }
  await assertSafeStatusPath(dirname(context.statusPath), context.statusPath);
  const tempPath = join(
    dirname(context.statusPath),
    `.${basename(context.statusPath)}.${process.pid}.${randomUUID()}.tmp`,
  );
  try {
    await writeFile(tempPath, `${JSON.stringify(parsed, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
    });
    try {
      await rename(tempPath, context.statusPath);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (process.platform !== 'win32' || (code !== 'EEXIST' && code !== 'EPERM')) {
        throw error;
      }
      await rm(context.statusPath, { force: true });
      await rename(tempPath, context.statusPath);
    }
  } catch {
    await rm(tempPath, { force: true }).catch(() => undefined);
    throw new LaunchContextError('status-write-failed');
  }
}

export async function initializeLaunchStatus(
  context: EvCopilotHappyLaunchContextV1,
): Promise<void> {
  const current = await readStatus(context);
  if (current && (current.invocationId !== context.invocationId || current.phase !== 'initializing')) {
    throw new LaunchContextError('status-regression');
  }
  if (current) return;
  await writeStatus(context, {
    schemaVersion: 1,
    invocationId: context.invocationId,
    phase: 'initializing',
  });
}

export async function markLaunchOwned(
  context: EvCopilotHappyLaunchContextV1,
  targetPid: number,
): Promise<void> {
  const current = await readStatus(context);
  if (!current || current.invocationId !== context.invocationId) {
    throw new LaunchContextError('status-invocation-mismatch');
  }
  if (current.phase === 'completed') throw new LaunchContextError('status-regression');
  if (current.phase === 'owned') {
    if (current.targetPid !== targetPid) throw new LaunchContextError('status-ownership-mismatch');
    return;
  }
  await writeStatus(context, {
    schemaVersion: 1,
    invocationId: context.invocationId,
    phase: 'owned',
    ownedAtUtc: new Date().toISOString(),
    targetPid,
  });
}

export async function markLaunchCompleted(
  context: EvCopilotHappyLaunchContextV1,
  result: { exitCode?: number; failureCode?: HappyLaunchFailureCode } = {},
): Promise<void> {
  const current = await readStatus(context);
  if (!current || current.invocationId !== context.invocationId || current.phase === 'initializing') {
    throw new LaunchContextError('status-regression');
  }
  if (current.phase === 'completed') return;
  await writeStatus(context, {
    ...current,
    phase: 'completed',
    ...result,
  });
}

export async function markLaunchFailedBeforeOwnership(
  context: EvCopilotHappyLaunchContextV1,
  failureCode: HappyLaunchFailureCode,
): Promise<void> {
  const current = await readStatus(context);
  if (!current || current.invocationId !== context.invocationId) {
    throw new LaunchContextError('status-invocation-mismatch');
  }
  if (current.phase !== 'initializing') return;
  await writeStatus(context, { ...current, failureCode });
}
