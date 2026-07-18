# Plan review

## Revision trigger

Independent audit of commit `06312dd910cb19efea38c7cf38269ef6915c0ece`
returned **REVISE**.

The prior plan over-scoped its first milestone and used an incorrect event-log
bootstrap: Copilot's ephemeral event-log buffer starts on the first
`session.eventLog.read`, not on `session.resume`.

## Audit findings and planned resolutions

### High - gap-free relay

Resolution:

- install a validating `session.event` prebuffer before routing resume;
- resume, then start event-log history from no cursor;
- keep the prebuffer open through persisted backfill and a non-blocking
  frontier read;
- close/drain atomically;
- deduplicate overlap by event id;
- preserve persisted and prebuffer lane order independently;
- add races before/during/after resume, first read, frontier, and close.

### High - independently executable M1a

Resolution:

- split M0 from M1a;
- make M1a direct-spawn-only, read-only, and default-off;
- add no external attach, re-adoption, persistent cursor, phone input,
  receipt, steering, or interactive capability;
- use a small durable event allowlist;
- replay from start on relay restart;
- require deterministic oldest-first Happy delivery and >200-row pagination
  acceptance;
- request ownership of `packages/happy-cli/src/index.ts` directly.

### Medium - ownership and dependencies

Resolution:

- remove `happy-copilot-cli-entry-dispatch` as a proposed architecture task;
- state the `src/index.ts` edit as a coordinator-owned path grant;
- remove `happy-copilot-message-consumption-flavor` from M1a blockers.

### Medium - codec and receive state

Resolution:

- M0 parses plaintext first, falls back to legacy decryption, and defines
  malformed-row behavior;
- M0 adds only the deterministic oldest-first delivery seam;
- M1a adds no durable receive cursor or consumption receipt.

### Medium - ordering

Resolution:

- remove timestamp/parent partial-order merging;
- preserve each source lane's order;
- deduplicate overlaps only by event id.

### Medium - event policy

Resolution:

- replace exhaustive generated-union policy with a small closed projection;
- omit all unlisted events;
- include tool arguments only after named schema validation and redaction.

### Medium - misplaced prerequisites

Resolution:

- gate on registry schema, protocol, tested version, foreground identity, and
  required method behavior;
- move exact optional resume payload identity, SEA/artifact attestation,
  DACL/reparse, environment, OOP, external attach, and re-adoption to hardening.

## Independent review/fix convergence

Fresh standard reviewers will use `gpt-5.6-sol` at `xhigh` and will be
constrained to the narrow task: verify source correctness, M0/M1a
executability, security boundary, history/frontier races, repository ownership,
tests, and proportionality without inventing another control plane.

### Round 1

Two fresh independent standard reviewers (`gpt-5.6-sol`, `xhigh`) returned
Medium+ findings:

- the production M1a target has no event producer because `--managed-server`
  cannot take an initial prompt and production `session.send` is excluded;
- managed spawn omitted `COPILOT_RUN_APP=1` and the source-enforced
  `COPILOT_AGENTS_TAB` feature input;
- the app currently renders an active composer/control callbacks, so a CLI-only
  no-forward guard is not a truthful no-phone-action product boundary;
- Happy wire requires `description` and `args` on `tool-call-start`, and
  shell-class arguments must not be projected;
- synthetic monotonic timestamps would invent chronology;
- live cursor expiry needed explicit replay-from-start recovery.

Fixes applied:

- reclassified M1a as an independently executable transport/projection slice;
  production remains idle until M2, while a separate test-only local stimulus
  client drives the managed-server smoke;
- added canonical managed-child env and the Agents-tab feature prerequisite;
- added coordinator path grants and exact app gating for composer and controls;
- required `description:""` and `args:{}` fallback, with shell-class args always
  empty;
- preserved only validated native timestamps;
- made expired continuation re-enter replay from the start.

### Round 2

Two fresh independent standard re-reviewers (`gpt-5.6-sol`, `xhigh`) found
three remaining Medium issues:

- routing resume needed the minimal `disableResume:true` behavior and an exact
  handshake order;
- managed spawn needed the pinned helper's loader/detached-attribution env
  scrubs and forced Agents-tab enablement;
- the new app gating tests themselves needed exact path grants.

Fixes applied:

- specified `connect -> getForeground -> install prebuffer -> resume`, with
  verified session id, `disableResume:true`, no prompt observation/interactive
  callbacks, and behavioral routing verification without a synthetic resume
  row;
- added `COPILOT_LOADER_PID` and the three `COPILOT_DETACHED_*` scrubs and
  normalized `COPILOT_CLI_ENABLED_FEATURE_FLAGS` to force the prerequisite;
- named and granted the two exact Copilot read-only app test paths.

### Round 3

Two further fresh independent standard reviewers (`gpt-5.6-sol`, `xhigh`)
found two remaining Medium issues:

- enabled-list inclusion could still lose to inherited direct
  `COPILOT_AGENTS_TAB=false` or a later config-level explicit false;
- controlled shutdown stopped reads before the promised native
  `session.shutdown` projection could arrive.

Fixes applied:

- set direct child `COPILOT_AGENTS_TAB=true`, normalize the enabled list, and
  fail precisely before spawn when canonical config explicitly disables the
  flag; added both precedence cases to tests;
- keep a final event-log read active through `runtime.shutdown`, wait within a
  bound for native shutdown → deterministic Happy stop ACK, then close; use the
  same deterministic controller-local stop only on timeout.

### Round 4

Two fresh independent standard reviewers (`gpt-5.6-sol`, `xhigh`) found four
remaining Medium lifecycle/frontier issues:

- one frontier read could itself return `hasMore:true`;
- `session.error` service text alone left Happy in a thinking state;
- native and timeout shutdown paths could emit different stop ids;
- `stop` envelopes do not finalize the Happy server lifecycle without archived
  metadata and `sendSessionDeath()`.

Fixes applied:

- loop non-blocking frontier reads until `hasMore:false`, bounded fail-closed,
  with a >200-event frontier race;
- map a primary-turn `session.error` to redacted service text plus one failed
  turn end, using deterministic first-terminal-wins state shared with abort and
  canonical turn end;
- make native shutdown and timeout compete through one atomic latch and the
  same deterministic stop envelope/localId, including late-event/ACK races;
- archive Happy metadata, call `sendSessionDeath()`, flush, and close on every
  exit path.

### Round 5

Two fresh independent standard reviewers (`gpt-5.6-sol`, `xhigh`) found four
remaining Medium implementation-contract issues:

- shutdown stop identity still depended on a native event id unavailable to the
  timeout path;
- a shutdown read can wake on filtered hook events or reject once shutdown
  starts, so native observation cannot be the required completion signal;
- racing terminal causes needed one global finalization promise;
- spawn needed package-version equality, non-piped stdio, and persistent child
  error/exit handling.

Fixes applied:

- capture one controller-derived stop id/time at quiesce start; native and
  timeout paths call the same `emitStopOnce()` and never use native event id;
- treat native shutdown as best-effort early completion from the current read
  and timeout as authoritative after filtered wake/read rejection/delay;
- route controlled stop, archive, child exit, RPC failure, and post-publication
  startup failure through one memoized `finalizeOnce()` promise;
- require `registry.copilotVersion === connect.version`, use non-piped stdio,
  and install persistent child `error`/`exit` listeners immediately.

### Round 6

One of two fresh independent standard reviewers returned clean; the other found
two remaining Medium issues:

- option chips/session-file links in `MessageView` bypassed composer gating;
- finalization could wait forever for stop delivery and let an archival/flush
  failure skip `sendSessionDeath()`.

Fixes applied:

- added `MessageView.tsx` and an exact Copilot read-only test path to the
  ownership/edit budget; Copilot rows expose no option-send,
  session-file/link, or fork action;
- made finalization stage-bounded and failure-safe: stop ACK and flush have
  deadlines, metadata archival is best-effort, `sendSessionDeath()` runs from
  `finally`, close always runs, and the memoized promise always settles after
  categorized diagnostics.

### Round 7

Two fresh independent standard reviewers found five remaining Medium
specificity gaps:

- archival still used the current unbounded metadata update;
- the Copilot integration test was excluded by Vitest project selection;
- the initial accepted package version was unnamed;
- hiding send alone left attachment/drop/paste actions mounted;
- grouped chat views could bypass MessageView option/file-link gating.

Fixes applied:

- require a cancellable, ACK-deadlined, bounded-retry metadata update that
  releases its lock before finalization continues;
- add `packages/happy-cli/vitest.config.ts` to grants/budget and register a
  gated one-worker Copilot integration project;
- accept only registry schema 2, protocol 3, and
  `registry.copilotVersion === connect.version === "0.0.1"` for M1a
  (**superseded by Round 12** after verifying that `0.0.1` is only the source
  development fallback);
- do not mount `AgentInput` for Copilot, eliminating attachment/drop/paste and
  all composer controls;
- add ChatList ownership/test coverage and force flat Copilot MessageView
  rendering.

### Round 8

One fresh reviewer returned clean; the other found seven Medium omissions:

- session-scoped native wrappers did not explicitly inject the verified id;
- real smoke tool execution could block on permissions;
- the files sidebar remained reachable;
- rollback could remove UI guards before retained sessions disappeared;
- M0's accepted decoded shape was unnamed;
- multiple final assistant messages per turn were not explicit;
- the existing metadata test path was not named/granted.

Fixes applied:

- privately store/inject the foreground id into every session-scoped request
  and reject caller overrides;
- require only real assistant output in the managed-server smoke and keep tool
  lifecycle/name/args tests hermetic;
- suppress SessionView's files-sidebar state/toggle/wrapper for Copilot;
- retain read-only UI compatibility guards through rollback until all Copilot
  sessions are archived;
- validate both codec paths with shared `MessageContentSchema`;
- project every durable final assistant message in persisted order under its
  turn id;
- name and grant
  `packages/happy-cli/src/utils/createSessionMetadata.test.ts`.

### Round 9

One fresh reviewer returned clean; the other found two remaining Medium
contract gaps:

- tool-only final `assistant.message` events can have empty content and would
  otherwise create blank text rows;
- the read-only app change omitted the changelog files required by the
  package's release-artifact convention.

Fixes applied:

- project final assistant text only when trimmed content is non-empty and add
  explicit mapper coverage for the tool-only case;
- request coordinator ownership of `packages/happy-app/CHANGELOG.md` and
  regenerated `packages/happy-app/sources/changelog/changelog.json`, and add
  both to the implementation edit budget.

Status: **pending final clean re-review**.

### Round 11

Two fresh independent standard reviewers (`gpt-5.6-sol`, `xhigh`) found four
Medium boundary defects:

- the token-at-rest text incorrectly treated Unix mode bits as a Windows
  user-only DACL;
- context-drawer, archived-resume, pending-switch, and placeholder quick-action
  surfaces remained interactive;
- allowed Details reached an independently mounted info route with Delete and
  other control/copy actions;
- generic Archive could run worktree cleanup and then force-archive storage
  without waking a still-live relay.

Fixes applied:

- state that Windows inherits ambient ACLs, make current-account/local-host
  integrity an explicit M1a trust assumption, and retain DACL/reparse work for
  hardening;
- suppress drawer/resume/switch/avatar/action surfaces for Copilot and
  incomplete placeholders, with empty placeholder actions;
- gate the Details route to display-only metadata plus safe Archive and remove
  its copy/plugin/skill/agent/machine/resume/Delete bypasses;
- define a Copilot-specific Archive: no worktree cleanup, no server
  force-archive fallback, and one parameterless lifecycle `killSession` that
  latches the existing memoized finalizer before replying.

Status: **pending final clean re-review**.

### Round 10

Two fresh independent standard reviewers (`gpt-5.6-sol`, `xhigh`) returned
six Medium findings:

- the CLI-local `MessageContentSchema` excluded typed `role:"session"` history;
- frontier retirement needed repeated no-more proof;
- the named tool-argument schemas/redaction policy remained underspecified;
- optimistic session placeholders and header/list quick actions could fail open;
- source-valid message/tool events can omit optional `turnId`, while Happy drops
  ordinary agent envelopes without a turn;
- controller death left the owned child unbounded, and the plan did not state
  that the runtime registry stores the full token plaintext.

Fixes applied:

- make canonical `@slopus/happy-wire` `MessageContentSchema` the M0 source of
  truth, including `SessionProtocolMessageSchema`, and replace the stale local
  two-role union with a re-export;
- require two consecutive empty non-blocking `hasMore:false` reads, resetting
  on any event or `hasMore:true`;
- limit argument preservation to a validated bounded workspace-relative `view`
  path; every other tool retains only a validated real name with `args:{}`;
- make incomplete optimistic placeholders non-interactive and restrict the
  shared quick-action hook to Details/Archive for Copilot;
- define one primary-turn association state machine for missing/mismatched
  optional ids and stored tool-call turns;
- spawn with a 300-second runtime idle timeout, no detach/unref, document the
  pinned five-minute sweep, and explicitly acknowledge the source-owned
  plaintext token registry while forbidding every secondary copy.

Status: **pending final clean re-review**.

### Round 12

The independent audit requested three corrections:

- the compact session list mounted its own swipe Archive without consuming the
  planned quick-action gate;
- native `session.error.message` can contain provider identifiers or arbitrary
  formatted errors and was unsafe to forward even after ad hoc redaction;
- source `package.json` version `0.0.1` is only the development fallback, not
  the installed artifact version.

Fixes applied:

- grant and budget `ActiveSessionsGroupCompact.tsx` plus its existing focused
  test; require the swipe wrapper to consume `canArchive`, expose the safe
  provider Archive only for active Copilot rows, and mount no swipe action for
  placeholders or inactive Copilot rows;
- project `session.error` as the exact controller-owned service text
  `Copilot session failed.` plus first-terminal-wins failed turn closure, never
  forwarding any native error field or formatted error;
- pin M1a to the installed SEA artifact/build label `1.0.71-3`, require
  registry/connect equality, and explicitly reject source fallback `0.0.1`;
  binary/filesystem attestation remains later hardening.

The first fresh review pair then returned one CLEAN verdict and two Medium
documentation consistency findings:

- the top-level ownership sections omitted the newly budgeted compact-list
  source/test paths;
- Round 7's historical `0.0.1` decision lacked an explicit supersession note.

Both consistency defects were corrected. Status: **pending final clean
re-review**.

### Round 13

The next fresh review pair returned one CLEAN verdict and two Medium findings:

- millisecond native timestamps could tie, while app storage sorted only by
  `createdAt`, so reducer/display order was not proven to follow Happy `seq`;
- hiding spawn-child from quick actions did not block its independently
  routable screen.

Fixes applied:

- grant and budget `storage.ts` plus a focused sequence-order test; retain
  native timestamps, use Happy's monotonic `seq` only as the equal-timestamp
  reducer/display tie-break, and add same-millisecond live/tail/range coverage
  without changing pagination APIs or window sizes;
- make hidden links explicitly non-authoritative and grant/budget route-level
  fail-closed tests for spawn-child and every sibling excluded child route:
  fork-composer, files/file, plugins, skills, and agents. Copilot or incomplete
  placeholders reach no spawn, send, worktree, filesystem, shell, search,
  prefetch, catalog, or render effect.

Status: **pending final clean re-review**.

### Round 14

Two fresh independent standard reviewers (`gpt-5.6-sol`, `xhigh`) agreed on
one Medium finding: the independently routable nested
`session/[id]/message/[messageId]` screen was missing from the fail-closed
inventory and could reach message prefetch plus `ToolFullView`.

Fix applied: grant and budget that route plus a focused test, and require
Copilot/incomplete-placeholder rejection before message lookup, prefetch,
`ToolFullView`, permission/footer, or content rendering. The permitted child
route remains read-only `info` only.

Final acceptance: two fresh independent standard reviewers
(`gpt-5.6-sol`, `xhigh`) returned **CLEAN** with no Medium+ findings.

Status: **CLEAN**.
