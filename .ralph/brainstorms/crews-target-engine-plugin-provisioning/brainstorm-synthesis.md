Lenses: ran=[codex, copilot, devils-advocate]; skipped=[] (full mode)

<!-- ralph-meta {"overviewTaskId":"crews-target-engine-plugin-provisioning"} -->

# Brainstorm synthesis — crews target-engine plugin provisioning

**Decided direction (NOT relitigated):** a LEAD/BOOKKEEPER-invoked, ON-DEMAND crews
skill to install a missing plugin into a target engine (copilot | claude | codex).
NOT auto-provision-at-spawn. This brainstorm designs the DETAILS: command surface,
per-engine install mechanism, idempotency/version, verification, and a discovery helper.

All three lenses (codex xhigh, copilot xhigh, devil's-advocate) ran in full mode and
converged hard. Note: the codex lens was first reaped at the v5.54.0 `DEFAULT_TIMEOUT_MS`
240s default (a *premature* reap of a healthy xhigh run, per the standing operator
timeout directive); it was re-run with `--timeout-ms 1200000` and completed cleanly (exit 0).

## Cross-lens convergence (the strongly-agreed spine)

1. **Thin wrapper over each engine's NATIVE plugin CLI — never a reimplementation.**
   codex `Preferred CLI-backed install-plugin adapter`, copilot `Thin native-CLI
   install-and-verify skill`, devils `thin wrapper … never a reimplementation of cache/config writes`.
2. **Two-layer surface: a crews CLI subcommand owns the logic; a thin skill wraps it.**
   Durable, testable behavior lives in `tools/crews.js` / `lib/plugin-provisioning/<engine>.js`
   (structured JSON output, per-engine adapters, version checks); the `/crews-install-plugin`
   skill collects intent, calls the CLI, and explains the result.
3. **An explicit RESTART / RESPAWN-REQUIRED verdict is the load-bearing feature.** Install
   success != the currently-blocked member can use the plugin: codex loads skills/hooks at
   thread start, so a running codex member still can't see a freshly-installed skill until a
   FRESH thread. The skill must return a hard `restartRequired` / `currentThreadUsable`
   verdict and tell the lead the exact respawn action. (devils disconfirming-observation +
   copilot `Recovery workflow…` + codex problem-framing all name this.)
4. **A discovery / verification companion** (`/crews-list-plugins --engine X`, or a
   `--status` / `--dry-run` mode) so the lead SEES installed/enabled/version/source BEFORE
   installing and so install can verify AFTER. (codex D2, copilot D2, devils D3.)
5. **Structured, non-opaque result.** Mandatory fields across engines:
   `installedVersion, sourceVersion, enabled, installPath, marketplaceSource, status
   (installed|no-op|upgraded|failed), restartRequired`. (devils + codex both enumerate.)
6. **Codex specifics are firm:** local-source ONLY (reject git-source unconditionally — it
   triggers the codex auto-upgrade marketplace-corruption bug, see
   `.ralph/investigations/codex-git-marketplace-snapshot-tmp-ephemeral`); refresh local-source
   version-lag by re-running `codex plugin add <plugin>@<marketplace>` (PROVEN by the
   `codex-engine-ralph-member-enablement` spike to re-copy current source into a new cache
   version subdir); a fresh codex thread is required to load new skills.
7. **crews version bump = 3.13.0** (minor; new user-visible lead-facing capability) — codex
   and copilot independently landed on 3.13.0.

## Genuine open questions (carry into planning)

- `--engine` **required** vs default-to-caller-engine? Safety risk: the blocked member is
  frequently a DIFFERENT engine than the lead, so a silent caller-engine default can install
  into the wrong engine. (all 3 lenses raise this.)
- Discovery as a **standalone** `/crews-list-plugins` vs an `install-plugin --status/--dry-run`
  mode vs both.
- Restart handling: **report-only** "respawn-required" vs an optional `--respawn-member <name>`
  follow-up. (Hidden auto-restart of a running member is surprising; lead lifecycle should stay explicit.)
- Claude scope: native non-interactive install may not exist -> **detect-only/experimental** vs a
  `settings.json`-edit fallback in v1.
- `--version` = **exact required** vs **minimum acceptable** (no-op if installed >= required).
- Verification depth: install-state cross-check (list + cache + config) sufficient vs an
  optional `--verify-skills` that boots a fresh engine session.

---

## Candidate directions

### D-001: Two-layer native-CLI-wrapper installer + discovery companion, with explicit restart/respawn verdict
- Contributing lenses: [codex, copilot, devils-advocate]
- Why this might work: It is the package all three lenses actually recommend. A crews CLI
  subcommand (`tools/crews.js install-plugin`) with per-engine adapters
  (`lib/plugin-provisioning/{copilot,codex,claude}.js`) shells out to each engine's NATIVE
  installer (copilot `plugin marketplace add` + `plugin install <id>@<mp>`; codex
  `plugin marketplace add <local-abs-path>` + `plugin add <id>@<mp>`), computes
  install-vs-no-op-vs-upgrade idempotently, refreshes codex local-source lag, and returns a
  structured result including `restartRequired` / `currentThreadUsable`. A thin
  `/crews-install-plugin` skill (+ `.copilot-plugin` mirror) wraps it; a companion
  `/crews-list-plugins` (or `--status`/`--dry-run`) gives pre/post visibility. crews -> 3.13.0.
- Risks / friction: Three CLIs expose install-state very differently (copilot single-copy dir;
  codex versioned cache + config.toml + `plugin list`; claude settings.json + versioned cache) —
  the cross-engine verification layer is the hard part. Claude may lack a non-interactive path.
  Scope is the biggest one (all 3 engines + install + discovery in one ship).
- Cheapest validation: Prototype `crews.js install-plugin ralph-orchestration --engine codex
  --marketplace ai-developer-toolkit` as a pure wrapper around the native commands and confirm
  `codex plugin list` + cache + config show ralph-orchestration >=5.54.0 and the result reports
  "fresh codex session required" — against the exact blocked-codex-member scenario.
- Disconfirming observation: In a real blocked-member incident, if the wrapper cannot identify
  installed/right-version state or its errors are no clearer than the raw CLI, leads keep
  copy-pasting manual commands and the skill is dead weight.

### D-002: Codex-first minimal unblock (install-only; defer copilot/claude + discovery)
- Contributing lenses: [devils-advocate] (with copilot/codex "ship something small" support)
- Why this might work: The ONLY scenario actually driving this task is a blocked codex member
  that can't run Ralph skills. Codex is also the highest-risk engine (local-source-only, cache
  lag, config.toml, fresh-thread). Shipping a tight `--engine codex`-only installer with the
  restart verdict first avoids designing to the least-common-denominator of three dissimilar
  CLIs and de-risks the one path that matters; copilot/claude/discovery follow once the codex
  adapter is proven.
- Risks / friction: A second ship is needed for the other engines; the command surface must be
  designed up-front so adding engines later isn't a breaking change. Some lead value (copilot
  self-heal, pre-install discovery) is deferred.
- Cheapest validation: Same codex prototype as D-001 but explicitly refuse non-codex `--engine`
  with a "not yet supported" message; confirm the blocked codex member is unblocked after a respawn.
- Disconfirming observation: If, in practice, copilot/claude members get blocked just as often as
  codex, a codex-only v1 forces leads back to manual commands for the other two engines anyway.

### D-003: Direct config/cache reconciler (bypass native CLIs; edit settings.json/config.toml + cache)
- Contributing lenses: [codex] (single-lens; the other two treat this as an anti-pattern)
- Why this might work: It side-steps any missing/interactive native installer (notably Claude)
  by writing `~/.claude/settings.json` / `~/.copilot/settings.json` / `~/.codex/config.toml`
  plus seeding the cache directly — full control, no TTY dependency.
- Risks / friction: High. Hand-written state can diverge from what the engine's own installer
  produces (missed hook registration, wrong cache layout, codex sentinel/`last_revision`
  semantics), reintroducing exactly the corruption classes the native path avoids. devils and
  copilot both flag settings-file mutation as unsafe when a native CLI exists.
- Cheapest validation: Only as a NARROW Claude fallback — edit `~/.claude/settings.json`
  `enabledPlugins` + ensure marketplace/cache, then confirm a fresh Claude session sees the
  plugin's skills; compare against a native `/plugin install` result.
- Disconfirming observation: If the reconciled state ever differs from the native-installer state
  (hooks not firing, skills not advertised), the fallback is strictly worse than telling the lead
  to run the native command by hand.

## Recommendation

**D-001** is the clear multi-lens lead and the recommended direction, with two scoping guards
pulled from D-002/D-003 to keep v1 shippable: (a) land the **codex** adapter first and most
rigorously (it is the driver and the riskiest), with **copilot** as the second native adapter;
(b) treat **claude** as detect-only / experimental (D-003's direct-edit only as an explicit,
clearly-labelled Claude fallback, never the default). Ship the discovery companion as at least a
`--status`/`--dry-run` mode in the same bump (3.13.0). The non-negotiable feature is the explicit
`restartRequired` / respawn-required verdict.
