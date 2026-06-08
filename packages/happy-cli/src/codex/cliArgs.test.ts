import { describe, expect, it } from 'vitest';

import {
    extractCodexArgFlag,
    extractCodexEffortFlag,
    extractCodexIdleTimeoutFlag,
    extractCodexProjectDocFlag,
    extractCodexResumeFlag,
    extractCodexTransportFlag,
} from './cliArgs';

describe('extractCodexResumeFlag', () => {
    it('returns null and preserves args when resume flag is absent', () => {
        const parsed = extractCodexResumeFlag(['--started-by', 'terminal']);

        expect(parsed.resumeThreadId).toBeNull();
        expect(parsed.args).toEqual(['--started-by', 'terminal']);
    });

    it('extracts an explicit resume thread ID', () => {
        const parsed = extractCodexResumeFlag(['--resume', 'thread-123', '--started-by', 'daemon']);

        expect(parsed.resumeThreadId).toBe('thread-123');
        expect(parsed.args).toEqual(['--started-by', 'daemon']);
    });

    it('supports equals syntax', () => {
        const parsed = extractCodexResumeFlag(['--resume=thread-456', '--started-by', 'terminal']);

        expect(parsed.resumeThreadId).toBe('thread-456');
        expect(parsed.args).toEqual(['--started-by', 'terminal']);
    });

    it('throws when resume flag is missing a thread ID', () => {
        expect(() => extractCodexResumeFlag(['--resume'])).toThrow(
            'Codex resume requires a thread ID: happy codex --resume <thread-id>',
        );
    });
});

describe('extractCodexEffortFlag', () => {
    it('returns undefined and preserves args when effort flag is absent', () => {
        const parsed = extractCodexEffortFlag(['--started-by', 'terminal']);

        expect(parsed.effortLevel).toBeUndefined();
        expect(parsed.args).toEqual(['--started-by', 'terminal']);
    });

    it('extracts an explicit effort level', () => {
        const parsed = extractCodexEffortFlag(['--effort', 'high', '--started-by', 'daemon']);

        expect(parsed.effortLevel).toBe('high');
        expect(parsed.args).toEqual(['--started-by', 'daemon']);
    });

    it('supports equals syntax', () => {
        const parsed = extractCodexEffortFlag(['--effort=xhigh', '--started-by', 'terminal']);

        expect(parsed.effortLevel).toBe('xhigh');
        expect(parsed.args).toEqual(['--started-by', 'terminal']);
    });

    it('throws for an invalid effort value', () => {
        expect(() => extractCodexEffortFlag(['--effort=extreme'])).toThrow(
            'Codex effort must be one of: none, minimal, low, medium, high, xhigh',
        );
    });

    it('throws when effort flag is missing a value', () => {
        expect(() => extractCodexEffortFlag(['--effort'])).toThrow(
            'Codex effort requires a value: happy codex --effort <level>',
        );
    });
});

describe('extractCodexTransportFlag', () => {
    it('returns undefined and preserves args when transport flag is absent', () => {
        const parsed = extractCodexTransportFlag(['--started-by', 'terminal']);

        expect(parsed.transport).toBeUndefined();
        expect(parsed.args).toEqual(['--started-by', 'terminal']);
    });

    it('supports equals syntax for ws', () => {
        const parsed = extractCodexTransportFlag(['--codex-transport=ws', '--started-by', 'terminal']);

        expect(parsed.transport).toBe('ws');
        expect(parsed.args).toEqual(['--started-by', 'terminal']);
    });

    it('supports equals syntax for stdio', () => {
        const parsed = extractCodexTransportFlag(['--codex-transport=stdio', '--started-by', 'terminal']);

        expect(parsed.transport).toBe('stdio');
        expect(parsed.args).toEqual(['--started-by', 'terminal']);
    });

    it('supports space-separated syntax for ws', () => {
        const parsed = extractCodexTransportFlag(['--codex-transport', 'ws', '--started-by', 'terminal']);

        expect(parsed.transport).toBe('ws');
        expect(parsed.args).toEqual(['--started-by', 'terminal']);
    });

    it('supports space-separated syntax for stdio', () => {
        const parsed = extractCodexTransportFlag(['--codex-transport', 'stdio', '--started-by', 'terminal']);

        expect(parsed.transport).toBe('stdio');
        expect(parsed.args).toEqual(['--started-by', 'terminal']);
    });

    it('throws for an invalid transport value', () => {
        expect(() => extractCodexTransportFlag(['--codex-transport=tcp'])).toThrow(
            'Codex transport must be one of: stdio, ws',
        );
    });

    it('throws for an empty transport value', () => {
        expect(() => extractCodexTransportFlag(['--codex-transport='])).toThrow(
            'Codex transport must be one of: stdio, ws',
        );
    });

    it('throws when transport flag is missing a value', () => {
        expect(() => extractCodexTransportFlag(['--codex-transport'])).toThrow(
            'Codex transport requires a value: happy codex --codex-transport <stdio|ws>',
        );
    });
});

describe('extractCodexProjectDocFlag', () => {
    it('returns an empty fallback and preserves args when project-doc flag is absent', () => {
        const parsed = extractCodexProjectDocFlag(['--started-by', 'terminal']);

        expect(parsed.projectDocFallback).toEqual([]);
        expect(parsed.args).toEqual(['--started-by', 'terminal']);
    });

    it('extracts a single project-doc fallback', () => {
        const parsed = extractCodexProjectDocFlag(['--codex-project-doc', 'CLAUDE.md', '--started-by', 'daemon']);

        expect(parsed.projectDocFallback).toEqual(['CLAUDE.md']);
        expect(parsed.args).toEqual(['--started-by', 'daemon']);
    });

    it('preserves repeatable project-doc fallback order', () => {
        const parsed = extractCodexProjectDocFlag([
            '--codex-project-doc',
            'CLAUDE.md',
            '--codex-project-doc',
            'AGENTS.md',
            '--codex-project-doc',
            'README.md',
        ]);

        expect(parsed.projectDocFallback).toEqual(['CLAUDE.md', 'AGENTS.md', 'README.md']);
        expect(parsed.args).toEqual([]);
    });

    it('supports equals syntax', () => {
        const parsed = extractCodexProjectDocFlag(['--codex-project-doc=CLAUDE.md', '--started-by', 'terminal']);

        expect(parsed.projectDocFallback).toEqual(['CLAUDE.md']);
        expect(parsed.args).toEqual(['--started-by', 'terminal']);
    });

    it('throws when project-doc flag is missing a value', () => {
        expect(() => extractCodexProjectDocFlag(['--codex-project-doc'])).toThrow(
            'Codex project-doc requires a value: happy codex --codex-project-doc <name>',
        );
        expect(() => extractCodexProjectDocFlag(['--codex-project-doc='])).toThrow(
            'Codex project-doc requires a value: happy codex --codex-project-doc <name>',
        );
    });
});


describe('extractCodexArgFlag (Gap 9)', () => {
    it('returns empty array and preserves args when flag is absent', () => {
        const parsed = extractCodexArgFlag(['--effort', 'high']);
        expect(parsed.codexArgs).toEqual([]);
        expect(parsed.args).toEqual(['--effort', 'high']);
    });

    it('collects a single space-separated flag', () => {
        const parsed = extractCodexArgFlag(['--codex-arg', '--some-flag']);
        expect(parsed.codexArgs).toEqual(['--some-flag']);
        expect(parsed.args).toEqual([]);
    });

    it('collects multiple flags in argv order', () => {
        const parsed = extractCodexArgFlag([
            '--codex-arg', '--flag-a',
            '--effort', 'low',
            '--codex-arg', 'value-b',
            '--codex-arg=flag-c',
        ]);
        expect(parsed.codexArgs).toEqual(['--flag-a', 'value-b', 'flag-c']);
        expect(parsed.args).toEqual(['--effort', 'low']);
    });

    it('accepts equals syntax', () => {
        const parsed = extractCodexArgFlag(['--codex-arg=--rust-log=debug']);
        expect(parsed.codexArgs).toEqual(['--rust-log=debug']);
        expect(parsed.args).toEqual([]);
    });

    it('throws when --codex-arg has no value', () => {
        expect(() => extractCodexArgFlag(['--codex-arg'])).toThrow(/Codex-arg requires a value/);
        expect(() => extractCodexArgFlag(['--codex-arg='])).toThrow(/Codex-arg requires a value/);
    });

    it('preserves leading-dash values (does NOT treat them as missing)', () => {
        // Unlike the structured flags (e.g. --effort), --codex-arg is a verbatim
        // passthrough and MUST accept values that start with '-' so users can
        // forward things like `--codex-arg --some-codex-flag`.
        const parsed = extractCodexArgFlag(['--codex-arg', '--leading-dash']);
        expect(parsed.codexArgs).toEqual(['--leading-dash']);
    });
});

describe('extractCodexIdleTimeoutFlag', () => {
    it('returns undefined and preserves args when idle-timeout is absent', () => {
        const parsed = extractCodexIdleTimeoutFlag(['--started-by', 'terminal']);

        expect(parsed.idleTimeoutSec).toBeUndefined();
        expect(parsed.args).toEqual(['--started-by', 'terminal']);
    });

    it('extracts a positive integer timeout from space-separated syntax', () => {
        const parsed = extractCodexIdleTimeoutFlag(['--idle-timeout', '300', '--started-by', 'daemon']);

        expect(parsed.idleTimeoutSec).toBe(300);
        expect(parsed.args).toEqual(['--started-by', 'daemon']);
    });

    it('extracts a positive integer timeout from equals syntax', () => {
        const parsed = extractCodexIdleTimeoutFlag(['--idle-timeout=60']);

        expect(parsed.idleTimeoutSec).toBe(60);
        expect(parsed.args).toEqual([]);
    });

    it('throws for missing, duplicate, zero, or non-integer values', () => {
        expect(() => extractCodexIdleTimeoutFlag(['--idle-timeout'])).toThrow(
            'Codex idle-timeout requires a value: happy codex --idle-timeout <seconds>',
        );
        expect(() => extractCodexIdleTimeoutFlag(['--idle-timeout=0'])).toThrow(
            'Codex idle-timeout must be a positive integer number of seconds',
        );
        expect(() => extractCodexIdleTimeoutFlag(['--idle-timeout=1.5'])).toThrow(
            'Codex idle-timeout must be a positive integer number of seconds',
        );
        expect(() => extractCodexIdleTimeoutFlag(['--idle-timeout=9007199254740992'])).toThrow(
            'Codex idle-timeout must be a positive integer number of seconds',
        );
        expect(() => extractCodexIdleTimeoutFlag(['--idle-timeout=1', '--idle-timeout=2'])).toThrow(
            'Codex idle-timeout flag can only be provided once.',
        );
    });
});
