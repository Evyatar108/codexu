# Investigation — git-sourced marketplace snapshot is "ephemeral" under `~/.codex/.tmp/marketplaces/<name>`

- **Task:** `codex-git-marketplace-snapshot-tmp-ephemeral`
- **Date:** 2026-06-05
- **Mode:** READ-ONLY diagnosis (no implementation; lead commits findings)
- **Codex submodule:** `codex/external/repos/codex-patched/codex-rs` (gim-home/codex fork, `0.135.0-copilot-api.1`)
- **Status:** HOLD for operator review.

## TL;DR

The "marketplace root does not contain a supported manifest" failure is **not** because
git snapshots are written to an OS-temp / per-process scratch path. They are written to a
**durable** path (`~/.codex/.tmp/marketplaces/<name>`) via clone-into-staging + atomic
rename, and that path *does* persist across processes.

The directory gets **destroyed** by a separate mechanism: a **fire-and-forget startup
"auto-upgrade" thread** that, on essentially every interactive `codex` launch, **moves the
live `<name>` directory aside and re-clones it** — a non-crash-safe operation running on a
detached thread that the host process can (and does) kill mid-flight. Combined with a no-op
short-circuit that the `add` path can never satisfy, the git marketplace dir is re-activated
far more often than it should be, and each re-activation is a window in which the live
directory can be left moved-away / removed.

**Local-source marketplaces are immune** (and that is exactly why the operator's workaround
works): auto-upgrade only processes `source_type = "git"` entries, and local sources are
never materialized into `.tmp` at all — they are read directly from the user's durable
checkout.

This is **upstream-canonical code, unpatched by the fork** (upstream PR #17425
"Auto-upgrade configured marketplaces"). The fork's only marketplace-adjacent patches are
`${CLAUDE_PLUGIN_ROOT}` substitution and ChatGPT-plugin network suppression — none touch the
materialization or auto-upgrade paths.

---

## 1. Where git-sourced marketplaces are materialized (and why it *looks* like `.tmp`)

### Install root
```
core-plugins/src/installed_marketplaces.rs:11
    pub const INSTALLED_MARKETPLACES_DIR: &str = ".tmp/marketplaces";
core-plugins/src/installed_marketplaces.rs:13-15
    pub fn marketplace_install_root(codex_home) -> codex_home.join(".tmp/marketplaces")
```
So a git marketplace named `ai-developer-toolkit` resolves to
`~/.codex/.tmp/marketplaces/ai-developer-toolkit`. The `.tmp` name is misleading: this is a
**codex-managed, persistent** directory (the curated-plugins SHA cache `.tmp/plugins.sha`
also lives here and relies on persistence across runs). It is **not** the system temp dir and
is **not** reaped by Windows.

### Add path (`codex plugin marketplace add <git-url>`)
`core-plugins/src/marketplace_add.rs:96-187`
1. `install_root = ~/.codex/.tmp/marketplaces` (`:96`)
2. stage into `.staging/marketplace-add-XXXX` tempdir, then `.keep()` it so it is **not**
   auto-deleted (`:147-163`)
3. `clone_git_source(...)` → full `git clone` into the staged dir
   (`marketplace_add/install.rs:7-43`)
4. `destination = install_root.join(<safe-name>)` (`:174`)
5. `replace_marketplace_root(staged, destination)` = `fs::rename(staged, destination)`
   (`:182`, `marketplace_add/install.rs:99-107`)

→ The destination is a real, persisted directory after `add`. ✔

### Upgrade path (`codex plugin marketplace upgrade` and the startup auto-upgrade)
`core-plugins/src/marketplace_upgrade.rs:168-243`
1. `git_remote_revision` (network `git ls-remote`) (`:174-178`)
2. **no-op short-circuit** (`:180-185`) — see §3
3. stage into `.staging/marketplace-upgrade-XXXX`, clone, validate, write sentinel
   (`:187-219`)
4. `activate_marketplace_root(destination, staged_dir, after_activate)` (`:230-238`)

### `activate_marketplace_root` — the non-crash-safe replace
`core-plugins/src/marketplace_upgrade/activation.rs:57-150`
When `destination` already exists (the steady-state re-activation case):
```
:77   create marketplace-backup-XXXX TempDir in parent
:87   fs::rename(destination -> backup_root)          # <-- live dir moved AWAY here
:94   fs::rename(staged_root -> destination)          # <-- new dir moved INTO place here
:112  after_activate()  (record config)              # <-- can fail -> rollback
        on failure: remove_dir_all(destination) + rename(backup -> destination)
:129  return Ok  -> backup TempDir drops -> remove_dir_all(backup)  (best-effort)
```
The interval between `:87` and `:94` is a window where **`<name>` does not exist**. If the
process dies in that window, or `after_activate` fails and the rollback rename also fails
(see §4), `<name>` is left **gone**.

### Loader (the error site)
`core-plugins/src/marketplace.rs:237-258`
```
validate_marketplace_root(root):
    find_marketplace_manifest_path(root)  // checks root/.agents/plugins/marketplace.json
                                          //   then root/.claude-plugin/marketplace.json
    -> None => "marketplace root does not contain a supported manifest"   (:241)
```
`find_marketplace_manifest_path` only does `path.is_file()` checks (`:248-258`). If the dir
was moved aside / removed, both candidates are absent → exactly the reported error. The
loader resolves the *same* `.tmp/marketplaces/<name>` path for the git entry via
`installed_marketplaces.rs:63-76` (`source_type != "local"` ⇒ `default_install_root.join(name)`).

---

## 2. Why local sources are immune (why the workaround works)

`core-plugins/src/installed_marketplaces.rs:68-73` — for `source_type = "local"`,
`resolve_configured_marketplace_root` returns the **user's own `source` path** directly. No
`.tmp` materialization. `marketplace_add.rs:122-145` short-circuits local sources without any
copy/clone.

Crucially, the startup auto-upgrade **skips non-git marketplaces entirely**:
`core-plugins/src/marketplace_upgrade.rs:149-151`
```
if source_type != Some(MarketplaceSourceType::Git) { return None; }
```
So a `source_type = "local"` entry is **never re-activated, never moved aside, never wiped**.
It reads straight from the durable checkout at
`\\?\D:\harness-efforts\codexu\ai-developer-toolkit`. This is precisely why
`crews@ai-developer-toolkit` installed and stayed working when added as a local source.

---

## 3. The amplifier — the `add` path can never satisfy the auto-upgrade no-op check

`marketplace_upgrade.rs:180-185`:
```
if find_marketplace_manifest_path(&destination).is_some()
    && marketplace.last_revision.as_deref() == Some(remote_revision)   // (A)
    && installed_marketplace_metadata_matches(&destination, ...)        // (B)
{ return Ok(None); }   // no-op: leave the dir untouched
```
- (A) needs `last_revision` recorded in config. **The `add` path hard-codes
  `last_revision: None`** — `marketplace_add/metadata.rs:41`. So after a plain `add`,
  (A) is `None == Some(rev)` → **false**.
- (B) needs a `.codex-marketplace-install.json` sentinel inside the dir. **The `add` path
  never writes it** — only the upgrade path does
  (`marketplace_upgrade/activation.rs:45-55`, written at `marketplace_upgrade.rs:219`).
  So after a plain `add`, (B) is also **false**.

Net: after `codex plugin marketplace add <git>`, **every** subsequent startup auto-upgrade
takes the destructive re-clone+`activate_marketplace_root` path instead of the safe no-op.

Even after a manual `codex plugin marketplace upgrade` (which *does* persist `last_revision`
+ sentinel), the no-op only holds while the remote HEAD stays equal to the recorded revision.
During active development of `gim-home/ai-developer-toolkit` (this session's context), the
remote HEAD advances, so (A) flips false again and re-activation resumes on each launch.

---

## 4. The trigger — a detached auto-upgrade thread racing process exit / concurrent config edits

`core-plugins/src/manager.rs:1470-1528` (`maybe_start_plugin_startup_tasks_for_config`):
- gated only by `config.plugins_enabled` and a per-process `in_flight` flag (`:1476-1489`)
- spawns a **detached `std::thread`** named `plugins-marketplace-auto-upgrade` (`:1493-1519`)
  that runs `upgrade_configured_marketplaces_for_config` and is **never joined** to the host
  process lifetime.

Call site: `app-server/src/message_processor.rs:448-458` —
`maybe_start_plugin_startup_tasks_for_config` runs at **app-server session startup**, i.e.
on every interactive `codex` / `codex exec` launch (anything that boots the app-server). The
standalone `codex plugin marketplace add/upgrade` CLI subcommands call the add/upgrade
functions directly and do **not** spawn this thread — which is why those commands materialize
the dir cleanly and the operator saw "33 items" right after.

The destructive sequence:
1. `codex plugin marketplace add/upgrade` (CLI) → dir materialized, 33 items. ✔
2. A later interactive `codex` launch → app-server startup → detached auto-upgrade thread →
   git marketplace is **not** at the no-op state (§3) → re-clone into `.staging` → enter
   `activate_marketplace_root` → `rename(destination → backup)` … and then one of:
   - the host process exits (short session / the thread is still doing the seconds-long
     network re-clone or is in the `:87`→`:94` window) → thread killed → `<name>` left
     moved-away; orphan `marketplace-backup-*` / `marketplace-upgrade-*` dirs never cleaned
     (their `TempDir` guards never drop); **OR**
   - `after_activate()` fails because the config changed mid-flight
     (`ensure_configured_git_marketplace_unchanged`, `marketplace_upgrade.rs:244-260`) — e.g.
     the operator re-ran `add <local-path>` to apply the workaround, rewriting the
     `[marketplaces.ai-developer-toolkit]` entry to `source_type = "local"` — →
     `remove_dir_all(destination)` + rollback `rename(backup → destination)`
     (`activation.rs:112-127`); on Windows the rollback can itself fail (read-only
     `.git/objects` packed files defeat `remove_dir_all`/rename ordering), leaving `<name>`
     **gone**.
3. Next `codex plugin list` / `add` → loader resolves `.tmp/marketplaces/<name>` → no
   manifest → **"marketplace root does not contain a supported manifest"**.

### Ground-truth confirmation (this machine, 2026-06-05)
- `~/.codex/.tmp/marketplaces/` — **MISSING entirely** (and `~/.codex/.tmp` itself is gone).
- `~/.codex/config.toml` now records `ai-developer-toolkit` as
  `source_type = "local", source = '\\?\D:\harness-efforts\codexu\ai-developer-toolkit'`
  → the operator already applied the local-source workaround, which overwrote the original
  git entry. (So the git entry / `last_revision = fe1a30bf…` snapshot the brainstorm cites is
  no longer present in config — consistent with the local re-add.)

---

## 5. Fork vs. upstream

**Upstream.** The materialization (`marketplace_add.rs`, `marketplace_add/*`,
`installed_marketplaces.rs`), the auto-upgrade (`marketplace_upgrade.rs`,
`marketplace_upgrade/activation.rs`, `manager.rs:1470-1528`), and the loader
(`marketplace.rs`) are all upstream-canonical and carry **no `// SANDBOX PATCH:` markers**.
`activation.rs` traces to upstream commit `faf48489` "Auto-upgrade configured marketplaces
(#17425)". The only fork patches in `core-plugins` are `${CLAUDE_PLUGIN_ROOT}` substitution
(`loader.rs:1069`, `mcp_substitution.rs`) and ChatGPT-plugin network suppression
(`remote.rs`, `remote_legacy.rs`) — orthogonal. The earlier `OFF → ON_INSTALL` fix the
brainstorm mentions was in **the toolkit's `marketplace.json`**, not in codex.

Implication for the fork (codex/CLAUDE.md tenet #1): a code fix here would land on
upstream-canonical files → rebase conflict surface + SANDBOX-PATCH bookkeeping. The bug is
not fork-specific, so the cleanest disposition is to **fix upstream / report upstream** and
keep the fork on the zero-conflict local-source path in the meantime.

---

## 6. Recommended fix

### Interim (already in place; zero codex conflict surface) — recommended for the fork now
Keep `ai-developer-toolkit` as a **`source_type = "local"`** marketplace pointing at the
durable checkout `D:\harness-efforts\codexu\ai-developer-toolkit`. It is structurally immune
(§2): never materialized into `.tmp`, and explicitly skipped by the git-only auto-upgrade.
This is the robust path for the fork's own toolkit consumption.

> Note: the brainstorm's proposed fix — *relocate `.tmp/marketplaces/<name>` to a "durable"
> path like `~/.codex/plugins/marketplaces/<name>`* — is **cosmetic and insufficient on its
> own**. The current path already persists; renaming it does not stop the detached
> auto-upgrade from moving the live dir aside and racing process exit. The root cause is the
> non-crash-safe re-activation + never-satisfiable no-op, not the directory name.

### Durable fix (upstream-first; if/when a code fix is wanted), lowest-conflict first
1. **Make `add` persist the no-op state (smallest, highest-leverage).** In the git branch of
   `marketplace_add.rs`, after a successful clone, record `last_revision` (the cloned HEAD)
   in config and write the `.codex-marketplace-install.json` sentinel — mirroring the upgrade
   path. This makes the auto-upgrade no-op short-circuit (`marketplace_upgrade.rs:180-185`)
   reachable, so steady-state launches stop re-activating and never touch the live dir.
   (`clone_git_source` in `marketplace_add/install.rs` would need to return the resolved sha,
   like the upgrade variant already does.) Eliminates the common-case wipe; does **not** by
   itself fix the legitimate-remote-drift re-activation race.
2. **Make `activate_marketplace_root` crash-safe.** Do not move the live `<name>` to a
   throwaway `TempDir` before the replacement is staged in place. Prefer: stage the new tree
   as a sibling (e.g. `<name>.new`), then a single atomic `rename(<name>.new → <name>)` with
   replace semantics; move the old copy to `<name>.old` and prune it only after success; and
   on startup, reconcile a missing `<name>` from a leftover `<name>.old`/backup. This closes
   the `:87`→`:94` and `after_activate`-failure windows so an interrupted re-activation can
   never leave `<name>` absent. Also clean orphaned `.staging/marketplace-*` and
   `marketplace-backup-*` dirs on startup.
3. **Don't run a destructive re-activation from a detached, process-exit-racing thread.**
   Either gate the startup auto-upgrade behind an interval / explicit opt-in, or make the
   replacement step itself fully atomic+crash-safe (covered by #2) so the detached lifetime
   is harmless.

Minor latent inconsistencies worth folding in if #1/#2 are done: the `add`-path
`clone_git_source` (`marketplace_add/install.rs`) lacks the Windows verbatim-path strip
(`\\?\…`), the 30s timeout, and `GIT_OPTIONAL_LOCKS=0` that the upgrade-path `git.rs` has
(`marketplace_upgrade/git.rs:136-164`); aligning them removes a separate Windows failure
surface for `add`.

---

## 7. Reproduction (optional; mutates `~/.codex` config + `.tmp`, so left for the operator)

1. `codex plugin marketplace add https://github.com/gim-home/ai-developer-toolkit.git`
   → inspect `~/.codex/.tmp/marketplaces/ai-developer-toolkit` (≈33 items, manifest present).
2. Confirm `~/.codex/config.toml` has `[marketplaces.ai-developer-toolkit]` with **no**
   `last_revision` (the §3 amplifier).
3. Launch an interactive `codex` session (boots the app-server → detached auto-upgrade) and
   exit quickly; repeat 1–2×.
4. `codex plugin marketplace list` → observe "marketplace root does not contain a supported
   manifest" and the now-missing/empty `.tmp/marketplaces/ai-developer-toolkit`; look for
   orphaned `.tmp/marketplaces/.staging/marketplace-*` or `marketplace-backup-*` dirs as the
   smoking gun for an interrupted `activate_marketplace_root`.

## File:line index
- `core-plugins/src/installed_marketplaces.rs:11,13-15,63-76` — install root + git-vs-local resolution
- `core-plugins/src/marketplace_add.rs:96,122-145,147-187` — add: local short-circuit / git materialize
- `core-plugins/src/marketplace_add/metadata.rs:32-53` (esp. `:41 last_revision: None`)
- `core-plugins/src/marketplace_add/install.rs:7-43,99-111` — add clone (no verbatim-strip/timeout)
- `core-plugins/src/marketplace_upgrade.rs:149-151,168-243` (no-op check `:180-185`)
- `core-plugins/src/marketplace_upgrade/activation.rs:45-55,57-150` — sentinel + non-crash-safe replace
- `core-plugins/src/marketplace_upgrade/git.rs:136-164` — upgrade clone (has verbatim-strip + timeout)
- `core-plugins/src/manager.rs:1470-1528,1571-1615` — detached auto-upgrade thread
- `app-server/src/message_processor.rs:448-458` — auto-upgrade fires at app-server session startup
- `core-plugins/src/marketplace.rs:237-258` — loader + the error string (`:241`)
