import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const wrapperPath = path.join(repoRoot, 'tools', 'data-edit.mjs')
const dispatcherPath = path.join(repoRoot, 'bin', 'ralph-overview.mjs')
const pluginRoot = path.join(repoRoot, 'ai-developer-toolkit', 'plugins', 'ralph-overview')
const pluginDispatcherPath = path.join(pluginRoot, 'bin', 'ralph-overview.mjs')
const cleanupRoots = []

function fixtureData() {
    return {
        generatedAt: '2026-01-01T00:00:00.000Z',
        tasks: [
            {
                id: 'task-alpha',
                scope: 'codexu',
                lifecycle: 'tracked',
                status: 'tracked',
                lastTouchedAt: '2026-01-01T00:00:00.000Z',
                command: {
                    name: 'alpha',
                    descriptionHtml: '<p>Alpha task.</p>',
                    prompts: { plan: 'plan alpha' },
                },
            },
            {
                id: 'task-beta',
                scope: 'codexu',
                lifecycle: 'tracked',
                status: 'tracked',
                lastTouchedAt: '2026-01-02T00:00:00.000Z',
                kanbanCards: [{ className: 'cmd-warn', html: '<p>beta warning</p>' }],
            },
        ],
        workstream: { 'task-alpha': 'core', 'task-beta': 'core' },
    }
}

function env() {
    const next = { ...process.env, RALPH_OVERVIEW_PLUGIN_ROOT: pluginRoot }
    delete next.OVERVIEW_CONFIG_PATH
    return next
}

function seedRepo(root) {
    fs.mkdirSync(path.join(root, '.ralph-overview'), { recursive: true })
    fs.mkdirSync(path.join(root, '.ralph', 'jobs'), { recursive: true })
    fs.mkdirSync(path.join(root, 'tasks'), { recursive: true })
    fs.writeFileSync(path.join(root, '.ralph-overview', 'data.json'), `${JSON.stringify(fixtureData(), null, 2)}\n`)
    fs.writeFileSync(
        path.join(root, '.ralph-overview', 'config.json'),
        `${JSON.stringify({
            dataFile: '.ralph-overview/data.json',
            ralphRoot: '.ralph',
            ralphSubdirs: { jobs: 'jobs', jobGroups: 'job-groups', brainstorms: 'brainstorms' },
            outputs: {
                sidecarJs: '.ralph-overview/generated/ralph-state.js',
                sidecarJson: '.ralph-overview/generated/ralph-state.json',
                snapshot: '.ralph-overview/generated/snapshot.json',
                activity: '.ralph-overview/generated/activity.jsonl',
                activityBackup: '.ralph-overview/generated/activity.1.jsonl',
                snapshotSchema: '.ralph-overview/generated/snapshot.schema.json',
                tasksIndex: 'tasks/INDEX.md',
                recommendationsJson: '.ralph-overview/generated/recommendations.json',
                dependencyGraphJson: '.ralph-overview/generated/dependency-graph.json',
                activeTasksJson: '.ralph-overview/generated/active-tasks.json',
                summaryProjectionJson: '.ralph-overview/generated/summary-projection.json',
                viewerHtml: '.ralph-overview/generated/overview.html',
                activityMaxLines: 1000,
            },
            recommendations: { weights: { stageUrgency: 40, dependencyState: 30, freshness: 20, priority: 10 }, topN: 20 },
            lockFile: '.ralph-overview/generated/.lock/sync.lock',
            watcher: { ignored: [] },
        }, null, 2)}\n`,
    )
}

function runNode(args, options = {}) {
    assert.ok(fs.existsSync(pluginDispatcherPath), `ralph-overview plugin dispatcher missing at ${pluginDispatcherPath}; run git submodule update --init -- ai-developer-toolkit`)
    const result = spawnSync(process.execPath, args, {
        cwd: options.cwd ?? repoRoot,
        env: env(),
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
    })
    if (result.status !== 0) {
        throw new Error(`node ${args.join(' ')} failed with ${result.status}\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`)
    }
    return result
}

function dataBytes(root) {
    return fs.readFileSync(path.join(root, '.ralph-overview', 'data.json'))
}

function extractPropertyValue(raw, propertyName) {
    const marker = `"${propertyName}":`
    const markerIndex = raw.indexOf(marker)
    assert.notEqual(markerIndex, -1, `missing property ${propertyName}`)
    let index = markerIndex + marker.length
    while (/\s/.test(raw[index])) index += 1
    const start = index
    const opener = raw[index]
    const closer = opener === '[' ? ']' : opener === '{' ? '}' : null
    assert.ok(closer, `property ${propertyName} must start with [ or {`)

    let depth = 0
    let inString = false
    let escaped = false
    for (; index < raw.length; index += 1) {
        const char = raw[index]
        if (inString) {
            if (escaped) {
                escaped = false
            } else if (char === '\\') {
                escaped = true
            } else if (char === '"') {
                inString = false
            }
            continue
        }
        if (char === '"') {
            inString = true
        } else if (char === opener) {
            depth += 1
        } else if (char === closer) {
            depth -= 1
            if (depth === 0) {
                return raw.slice(start, index + 1)
            }
        }
    }
    throw new Error(`unterminated property ${propertyName}`)
}

afterEach(() => {
    while (cleanupRoots.length > 0) {
        fs.rmSync(cleanupRoots.pop(), { recursive: true, force: true })
    }
})

describe('tools/data-edit.mjs', () => {
    it('lists the five supported verbs in help', () => {
        const result = runNode([wrapperPath, '--help'])
        for (const verb of ['upsert-task', 'mark-shipped', 'set-lifecycle', 'add-kanban-card', 'set-prompts']) {
            expect(result.stdout).toMatch(new RegExp(`\\b${verb}\\b`))
        }
    })

    it('is byte-identical to the consumer bin dispatcher for every verb', () => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'codexu-data-edit-wrapper-'))
        cleanupRoots.push(tmp)
        const cases = [
            {
                name: 'set-lifecycle',
                args: ['set-lifecycle', 'task-alpha', 'merged', '--touched-at', '2026-02-02T00:00:00.000Z'],
            },
            {
                name: 'mark-shipped',
                argsFor(root) {
                    const summaryFile = path.join(root, 'summary.txt')
                    const commitsFile = path.join(root, 'commits.json')
                    fs.writeFileSync(summaryFile, 'Shipped the thing.\nSecond line.')
                    fs.writeFileSync(commitsFile, JSON.stringify([{ sha: 'abc123', oneLine: 'feat: ship it', repo: 'codexu' }]))
                    return ['mark-shipped', 'task-beta', '--summary-file', summaryFile, '--commits-file', commitsFile, '--shipped-at', '2026-03-03T00:00:00.000Z', '--touched-at', '2026-03-04T00:00:00.000Z']
                },
            },
            {
                name: 'upsert-task',
                argsFor(root) {
                    const taskFile = path.join(root, 'task-gamma.json')
                    fs.writeFileSync(taskFile, JSON.stringify({ scope: 'codexu', id: 'task-gamma', lifecycle: 'tracked', status: 'tracked' }))
                    return ['upsert-task', 'task-gamma', '--json', taskFile]
                },
            },
            {
                name: 'add-kanban-card',
                args: ['add-kanban-card', 'task-alpha', '--class', 'cmd-ok', '--html', '<p>done</p>'],
            },
            {
                name: 'set-prompts',
                args: ['set-prompts', 'task-beta', '--plan', 'beta plan', '--impl', 'beta impl'],
            },
        ]

        for (const testCase of cases) {
            const wrapperRepo = path.join(tmp, `${testCase.name}-wrapper`)
            const dispatcherRepo = path.join(tmp, `${testCase.name}-dispatcher`)
            seedRepo(wrapperRepo)
            seedRepo(dispatcherRepo)
            const wrapperArgs = testCase.argsFor ? testCase.argsFor(wrapperRepo) : testCase.args
            const dispatcherArgs = testCase.argsFor ? testCase.argsFor(dispatcherRepo) : testCase.args

            const wrapperResult = runNode([wrapperPath, '--repo', wrapperRepo, ...wrapperArgs])
            const dispatcherResult = runNode([dispatcherPath, 'data-edit', '--repo', dispatcherRepo, ...dispatcherArgs])

            assert.equal(wrapperResult.stdout, dispatcherResult.stdout)
            expect(dataBytes(wrapperRepo).equals(dataBytes(dispatcherRepo))).toBe(true)
        }
    }, 30_000)

    it('keeps snapshot.json tasks byte-identical when no source edit occurs', () => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'codexu-snapshot-byte-guard-'))
        cleanupRoots.push(tmp)
        seedRepo(tmp)
        runNode([dispatcherPath, 'sync', '--repo', tmp], { cwd: tmp })
        const firstRaw = fs.readFileSync(path.join(tmp, '.ralph-overview', 'generated', 'snapshot.json'), 'utf8')
        const firstTasks = extractPropertyValue(firstRaw, 'tasks')

        runNode([dispatcherPath, 'sync', '--repo', tmp], { cwd: tmp })
        const secondRaw = fs.readFileSync(path.join(tmp, '.ralph-overview', 'generated', 'snapshot.json'), 'utf8')
        const secondTasks = extractPropertyValue(secondRaw, 'tasks')

        assert.equal(secondTasks, firstTasks)
    })
})
