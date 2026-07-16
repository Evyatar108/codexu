import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

describe('default Claude command daemon startup', () => {
  it('handles daemon startup failures through the user-facing command error boundary', () => {
    const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8')

    expect(source).toMatch(
      /try\s*\{\s*await ensureDaemonRunning\(\)\s*await runClaude\(credentials, options\);\s*\}\s*catch \(error\)/,
    )
  })
})
