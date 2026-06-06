Lenses: ran=[codex, devils-advocate]; skipped=[copilot] (not launched; Codex member has no Agent tool surface for Ralph's dedicated Devil's Advocate runner, so synthesis used local code inspection plus inline adversarial review)

Copilot was skipped because this Codex-engine validation run confirmed the CLI is reachable but did not safely launch nested lens agents inside the active crews member session.

### D-001: Fail-loud redirected immediate-return arm envelopes
- Contributing lenses: [codex, devils-advocate]
- Why this might work: The actual silent footgun is not the long-running listener loop; it is the immediate-return path in `lib/listener-loop.js` where `markArmed(... requireFreshArm: true)` returns `arm-skipped` and the process writes one JSON envelope to stdout with exit code 0. If stdout is piped to `Out-Null`, that envelope disappears and a chained command can continue with no visible signal. Add a narrow guard around `finish()` calls for no-new-listener outcomes: when stdout is redirected or non-interactive and the result means this process did not become the live listener, also write a human-readable warning to stderr and return non-zero unless an explicit machine-mode opt-in is set. Keep the normal foreground/async arm loop unchanged because it must continue blocking until mail, timeout, or error.
- Risks / friction: `spawnSync` tests and any scripts that intentionally parse stdout from redundant arm calls currently rely on status 0 plus JSON. The edit needs an explicit escape hatch such as `--allow-piped-arm-json` or `CREWS_ARM_ALLOW_REDIRECTED_STDOUT=1`, and tests should exercise both the default fail-loud behavior and the opt-in machine-readable behavior. PowerShell `;` does not stop on native non-zero exit by itself, so stderr visibility is the reliable "not silent" layer; non-zero mainly helps `&&`, CI, and wrappers that check `$LASTEXITCODE`.
- Cheapest validation: Extend `tests/listener-redundant-arm-skip.test.js` with a custom stdout stream whose `isTTY` is false and assert that `session-mismatch` and `recoverable-pending-takeover` produce a loud stderr message plus non-zero by default, while `already-active-listener` either stays status 0 with a visible stderr advisory or remains explicitly documented as safe because an existing live listener owns the mailbox. Add an opt-in assertion that the old JSON/status behavior is still available for scripted callers.
- Disconfirming observation: If real lead arming from Codex/Copilot/Claude always presents non-TTY stdout even for the required background/async arm call, a broad non-TTY guard would become noisy or break normal startup. The implementation must therefore gate on immediate-return/no-new-listener outcomes, not on stdout shape alone.

### D-002: Hook-level chained-arm detector and verifier
- Contributing lenses: [devils-advocate]
- Why this might work: The PreToolUse arm recognizer already sees the shell command string and could reject suspicious patterns such as `| Out-Null`, `>`, or chained `; <next cmd>` when the command includes `crews.js arm`.
- Risks / friction: This is shell-syntax fragile across PowerShell, Git Bash, Claude, Copilot, and Codex. The code comments in `hooks/listener-protocol.js` explicitly document that earlier deep shell parsing was removed because it kept hitting edge cases. Reintroducing command parsing would expand the highest-risk surface for a problem that is already localized to `arm`'s own return path.
- Cheapest validation: Add recognizer-only tests for PowerShell pipelines and separators, then prove legitimate background arm commands still pass. This is cheaper than a full runtime change but less reliable.
- Disconfirming observation: A false negative leaves the footgun unchanged; a false positive blocks valid arming before `markArmed` has a chance to perform authoritative manifest/session checks.

### D-003: Documentation and command-shape hardening only
- Contributing lenses: [codex]
- Why this might work: Update briefing text and hook guidance to say that `arm` must be launched as the first standalone background/async tool call and must never be piped or chained. The suggested command can be rendered in a form that discourages `| Out-Null`.
- Risks / friction: The bug is specifically a silent operator footgun. Documentation reduces recurrence only when read at the right moment and cannot protect a lead under time pressure.
- Cheapest validation: Snapshot tests for briefing/help text and one manual smoke test that the suggested command still arms correctly.
- Disconfirming observation: If the same operator repeats `arm | Out-Null; <next cmd>`, the product still silently allows it.

Recommended direction: D-001.
