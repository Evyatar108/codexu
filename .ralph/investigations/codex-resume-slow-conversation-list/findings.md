# Codex `/resume` slow conversation-list load

## Summary for the operator

The slow path is real: the resume picker opens with `UpdatedAt` sorting and asks `thread/list` with `use_state_db_only = false`, so the backend does a filesystem-first scan/repair walk instead of a SQLite-only list. The expensive branch walks rollout directories, stats rollout files for mtimes, opens candidate JSONL files, and parses their heads to extract preview/cwd/provider before page 1 can render. Because the picker always supplies interactive `sourceKinds` and usually also provider/cwd filters, the backend treats the request as metadata-filtered and stays on the scan path even when SQLite is available. The cheapest correct speedup is at `tui/src/resume_picker.rs:1818-1831`: send `use_state_db_only: true` for picker listings (at least initial page load), and if needed preserve repair semantics by reconciling selected/visible rows lazily after first paint.

There is also a separate startup cost before the picker even asks for page 1 in embedded mode: the picker starts an embedded app-server, and embedded startup runs `state_db::try_init(...)`, which waits for backfill completion and can spend up to the configured startup wait window there (`tui/src/lib.rs:337-350,560-568`; `rollout/src/state_db.rs:38-57,136-197`). That startup latency stacks with the per-page listing latency below.

**Fork/upstream note:** I did not find any `// SANDBOX PATCH` markers in the traced resume/list files, so this path appears upstream-native rather than fork-local.

## 1. The `/resume` list path

The picker entry point is the TUI `--resume` branch, which calls `run_resume_picker_with_app_server(...)` (`tui/src/lib.rs:1580-1591`). That builds the picker state and immediately calls `start_initial_load()`, which sends the first `PickerLoadRequest::Page` with `cursor: None`, the active cwd/provider filters, and the current sort key (`tui/src/resume_picker.rs:341-385,440-455,1251-1284`).

The picker does **not** load that page inline on the render loop. It spawns a background loader task with `tokio::spawn`, and page requests flow through `load_app_server_page(...)` into `app_server.thread_list(...)` (`tui/src/resume_picker.rs:556-611,739-768`). The event loop keeps rendering while waiting for `BackgroundEvent::Page`, so the UI is not hard-blocked on the main thread, but the list content cannot appear until this background request completes (`tui/src/resume_picker.rs:433-499`).

From there the call chain is:

1. `thread_list(...)` RPC on the TUI app-server client (`tui/src/app_server_session.rs:522-528`).
2. App-server `thread_list_response_inner(...)`, which forwards into `list_threads_common(...)` (`app-server/src/request_processors/thread_processor.rs:1798-1876`).
3. `list_threads_common(...)`, which calls `thread_store.list_threads(...)` with the requested page size, cursor, sort, filters, and `use_state_db_only` flag (`app-server/src/request_processors/thread_processor.rs:3467-3569`).
4. Local thread store `list_threads(...)`, which forwards into `list_rollout_threads(...)` and then overlays titles/names (`thread-store/src/local/list_threads.rs:21-107,110-183`).
5. `RolloutRecorder::{list_threads,list_threads_with_db_fallback}` in the rollout layer (`rollout/src/recorder.rs:191-255,323-559`).

That rollout-layer function is where the expensive scan/repair behavior is selected.

## 2. Where session metadata comes from

### Page rows

For the file-backed path, each visible row is built by `build_thread_item(...)` (`rollout/src/list.rs:736-810`). That function opens the rollout JSONL and calls `read_head_summary(...)` (`rollout/src/list.rs:745-747,1075-1160`).

`read_head_summary(...)` does **not** parse the whole rollout file for the normal list row, but it still opens the file, reads line-by-line from the head, and JSON-parses each non-empty line until it has enough data. The loop reads at least `HEAD_RECORD_LIMIT = 10` records and may keep going for up to `HEAD_RECORD_LIMIT + USER_EVENT_SCAN_LIMIT` records (10 + 200) if it still needs preview / first-user-message data after seeing `SessionMeta` (`rollout/src/list.rs:106-110,1084-1088`). The extracted row metadata comes from `SessionMeta` plus the first preview-bearing events (`rollout/src/list.rs:1100-1157`).

So the row metadata sources are:

- `thread_id`, `cwd`, `git_*`, `source`, `agent_*`, `model_provider`, `cli_version`, `created_at`: head `SessionMeta` (`rollout/src/list.rs:1100-1124`).
- `preview` and `first_user_message`: first matching `EventMsg` preview extracted from early rollout events (`rollout/src/list.rs:1138-1157,1210-1232`).
- `updated_at`: filesystem mtime fallback if the summary did not provide one (`rollout/src/list.rs:789-807,1253-1265`).

### Sorting metadata

For `UpdatedAt` sorting, the rollout code first gathers file candidates and their mtimes via `file_modified_time(...)`, then sorts those candidates by `(updated_at desc, uuid desc)` before opening candidate files for row metadata (`rollout/src/list.rs:256-279,518-579,953-1007,1253-1265`). The code explicitly documents that `updated_at` is not in the filename, so this path must scan all files up to the cap and then sort them (`rollout/src/list.rs:518-525`).

### Thread titles / names

After the thread store gets the page, it tries to fill titles from SQLite first by calling `state_db_ctx.get_thread(thread_id)` for each page item (`thread-store/src/local/list_threads.rs:78-92`). If some titles are still missing, it falls back to `find_thread_names_by_ids(...)` (`thread-store/src/local/list_threads.rs:93-105`).

That fallback reads `session_index.jsonl` line-by-line from the start and keeps the latest name per matching id (`rollout/src/session_index.rs:83-112`). So page load can also include an O(size of session_index.jsonl) pass when titles are not already populated in SQLite.

### Full-file repair path

When the backend decides it needs a full reconcile, it escalates from lightweight head reads to full rollout parsing:

- `read_repair_rollout_path(...)` does a fast SQLite path repair if a row already exists; otherwise it falls back to `reconcile_rollout(...)` (`rollout/src/state_db.rs:591-655`).
- `reconcile_rollout(...)` calls `metadata::extract_metadata_from_rollout(...)` when it does not already have incremental items (`rollout/src/state_db.rs:505-589`).
- `extract_metadata_from_rollout(...)` loads the rollout items with `RolloutRecorder::load_rollout_items(...)` and then walks **all** items to rebuild metadata (`rollout/src/metadata.rs:97-132`).

So the normal list row is head-only, but repair/missing-row cases become full-file reads/parses.

## 3. Why it is slow

### A. The picker defaults to the expensive `UpdatedAt` sort

The picker's default sort key is `ThreadSortKey::UpdatedAt` (`tui/src/resume_picker.rs:939`). `start_initial_load()` forwards that sort key into the initial `thread/list` request (`tui/src/resume_picker.rs:1251-1284`), and `thread_list_params(...)` forwards it into `ThreadListParams` (`tui/src/resume_picker.rs:1811-1831`).

That matters because the rollout scanner's `UpdatedAt` path is O(N scanned files): it collects candidates for every rollout file, reads each file's mtime, sorts the candidate list, and only then opens candidate files for row summaries (`rollout/src/list.rs:518-579,953-1007`). The code explicitly says this path "must scan all files up to the scan cap" because `updated_at` is not encoded in filenames (`rollout/src/list.rs:521-525`).

The scan is bounded, but still large: `MAX_SCAN_FILES = 10000` (`rollout/src/list.rs:106-107`), and directory walking visits rollout files newest-first across `~/.codex/sessions/YYYY/MM/DD/...` (`rollout/src/list.rs:397-404,1009-1047`).

### B. The picker always asks for the scan/repair listing mode

The picker sends `use_state_db_only: false` in `thread_list_params(...)` (`tui/src/resume_picker.rs:1818-1831`). That means the rollout layer uses `ThreadListRepairMode::ScanAndRepair` instead of the SQLite-only fast path (`rollout/src/recorder.rs:185-189,194-255,347-364`).

The picker also always supplies interactive `sourceKinds` through `resume_source_kinds(...)` (`tui/src/lib.rs:654-662`), and local picker requests also usually carry provider and cwd filters (`tui/src/resume_picker.rs:351-359,523-549,1818-1831`). In `list_threads_with_db_fallback(...)`, **any** non-empty source/provider/cwd/search filter sets `listing_has_metadata_filters = true` (`rollout/src/recorder.rs:366-369`), which keeps the request on the filesystem-first path even when SQLite is available.

For descending sort (the default), that filesystem-first path even overfetches at `page_size * 2` before truncating back to the requested page (`rollout/src/recorder.rs:389-403,549-559`; `tui/src/resume_picker.rs:67`).

### C. Per-candidate work is still non-trivial

Once candidates are ordered, each candidate row still requires:

1. `metadata(path)` / `modified()` for mtime (`rollout/src/list.rs:237-247,271-277,1253-1265`).
2. Opening the rollout JSONL file (`rollout/src/list.rs:1078-1080`).
3. Parsing head JSON lines until `SessionMeta` + preview are found, potentially up to 210 parsed records per file (`rollout/src/list.rs:106-110,1084-1157`).

That is much more expensive than a pure SQLite page read.

### D. The scan path still does DB repair work before returning

Even after the filesystem page is built, `list_threads_with_db_fallback(...)` warms/repairs SQLite for every filesystem hit before asking SQLite for a page (`rollout/src/recorder.rs:430-469`). For non-search listings it uses `read_repair_rollout_path(...)`; if the row is missing or unreadable, that path falls back to `reconcile_rollout(...)`, which can fully parse the rollout file (`rollout/src/state_db.rs:591-655,505-589`; `rollout/src/metadata.rs:97-132`).

For filtered listings, after the DB query it may also reconcile DB-only hits before returning the filesystem-backed page (`rollout/src/recorder.rs:503-534`). So page 1 is not just "scan some files and return"; it is "scan files, repair DB, query DB, maybe reconcile more."

### E. Startup can add another delay before page 1

When the picker is launched in embedded mode, the TUI starts an embedded app-server for the picker and initializes local state DB first (`tui/src/lib.rs:560-568`). Embedded startup uses `state_db::try_init(...)` (`tui/src/lib.rs:337-350`), and that initialization waits for the SQLite backfill gate, polling and potentially running `backfill_sessions(...)` before returning (`rollout/src/state_db.rs:38-57,136-197`; `rollout/src/metadata.rs:149-300`).

So if the user's complaint is "there is a long pause before the picker even fills," the pause may be a combination of:

1. startup backfill gate, then
2. filesystem-first `thread/list` scan/repair for page 1.

## 4. Fix direction (do not implement)

### Cheapest correct speedup

The most surgical fix is in `tui/src/resume_picker.rs:1818-1831`: set `use_state_db_only: true` for picker `thread/list` requests, at least for the initial page load.

Why this is the cheapest lever:

- The embedded picker already initializes SQLite and waits for backfill completion before starting the app-server (`tui/src/lib.rs:337-350,560-568`; `rollout/src/state_db.rs:136-197`).
- The SQLite-only path already exists: `list_threads_with_db_fallback(...)` returns directly from `state_db::list_threads_db(...)` when `repair_mode == StateDbOnly` (`rollout/src/recorder.rs:347-364`).
- `list_threads_db(...)` is much cheaper than the rollout scan path: it does a DB list query plus a per-row `try_exists(...)` check to drop stale rollout paths (`rollout/src/state_db.rs:351-438`).

In other words, the fast path is already implemented; the picker is simply opting out of it today.

### Tradeoff to document

The current slow path preserves "scan-and-repair" semantics inline. Flipping the picker to `use_state_db_only = true` would stop repairing stale metadata during picker open, so title/provider/cwd drift would rely on the existing backfill/live-write pipeline instead of being fixed synchronously during listing (`rollout/src/recorder.rs:430-534`; `rollout/src/state_db.rs:591-655`).

If that tradeoff feels too risky, the next-best variant is:

1. Use `state_db_only` for the first page so the picker paints quickly.
2. Reconcile lazily for the selected row, or background-reconcile visible rows after first paint.

That keeps UX fast while preserving eventual metadata repair.

### Secondary / structural improvements

1. **Default to `CreatedAt` instead of `UpdatedAt`** in the picker (`tui/src/resume_picker.rs:939`). This would avoid the "scan every file for mtime, then sort" path because `CreatedAt` traversal can stop once the page fills in directory/filename order (`rollout/src/list.rs:471-516`). The downside is UX: you would no longer sort by most recently active session.
2. **Make `thread/list` DB-first for picker-style metadata filters**. Right now `listing_has_metadata_filters` treats any non-empty `allowed_sources` as enough to force filesystem-first scan/repair (`rollout/src/recorder.rs:366-369`), and the picker always supplies interactive source filters (`tui/src/lib.rs:654-662`). A smarter split would let SQLite satisfy common source/provider/cwd filters and reserve filesystem reconcile for clear stale-row cases.
3. **Persist / index `updated_at` for the file fallback path**. The code already calls this out as a future optimization: the updated-at path is expensive because the timestamp is not encoded in filenames and "can be optimized in the future if we store additional state on disk" (`rollout/src/list.rs:521-525`).
4. **Reduce fallback title scans**. If picker titles matter and SQLite sometimes lacks them, `find_thread_names_by_ids(...)` currently scans `session_index.jsonl` line-by-line (`rollout/src/session_index.rs:83-112`). That is secondary to the rollout scan cost, but it is still avoidable if thread names are made reliably present in SQLite.

## OS-relation + why use_state_db_only is false by default

**Verdict.** **Not OS-related.** `use_state_db_only` is a plain request boolean on `ThreadListParams`; omitted input deserializes to `false`, and the wire-level doc comment explicitly says omitted/false preserves scan-and-repair behavior (`app-server-protocol/src/protocol/v2/thread.rs:955-992`; `app-server-protocol/src/protocol/v2/tests.rs:153-189`). The picker hard-codes `false`, the thread store just forwards that flag, and the rollout layer switches between `StateDbOnly` and `ScanAndRepair` strictly from that flag rather than from platform checks (`tui/src/resume_picker.rs:1811-1832`; `thread-store/src/local/list_threads.rs:110-183`; `rollout/src/recorder.rs:185-255,323-364`).

The SQLite location is also configured the same way everywhere in this path: `sqlite_home` comes from config, then `SQLITE_HOME_ENV`, else falls back to `CODEX_HOME`; `CODEX_HOME` itself is either the `CODEX_HOME` env var or `~/.codex` (`core/src/config/mod.rs:203-215,3284-3289,3906-3908`; `utils/home-dir/src/lib.rs:5-18,20-63`). State-DB optionality is about availability/completeness, not OS: local init creates/opens the SQLite runtime under that path, while read-only/non-owning contexts return `None` if the DB file is absent, fails to open, or has not finished backfill yet (`state/src/runtime.rs:155-199,306-383`; `rollout/src/state_db.rs:210-280`).

**Why false by default.** The correctness rationale is explicit in the list path. The rollout layer's non-DB-only mode intentionally does a filesystem-first overfetch so it can repair stale or missing SQLite rows before returning results (`rollout/src/recorder.rs:370-372,430-453`). For metadata-filtered listings, it also treats SQLite-only hits as potentially stale and fully reconciles those before returning the filesystem-backed page (`rollout/src/recorder.rs:503-534`). When a row is missing or unreadable, `read_repair_rollout_path(...)` drops to a slow path that rebuilds metadata from the rollout contents and reconciles it back into SQLite (`rollout/src/state_db.rs:591-655`). In other words, the DB is treated as a derived index that may need repair; the filesystem path is the correctness source of truth, so the conservative default is scan-and-repair.

The test suite demonstrates the exact risk of flipping the default: after manually poisoning SQLite with a stale `cwd`, a `use_state_db_only: true` request still returns the thread for that stale cwd filter, but `use_state_db_only: false` rescans the rollout head and returns zero rows (`app-server/tests/suite/v2/thread_list.rs:877-938`). So the DB-only path can surface stale metadata/filter matches, while the filesystem path catches and repairs them.

**Reconcile with the proposed picker fix.** Flipping the picker to `use_state_db_only: true` makes first paint faster, but the first page can be incomplete or stale: `list_threads_db(...)` only validates that a stored rollout path still exists, dropping rows whose paths are gone, and otherwise returns SQLite metadata without rebuilding it from rollout heads inline (`rollout/src/state_db.rs:351-438`). Combined with the repair logic above, that means DB-only first paint can miss sessions whose SQLite row is missing and can temporarily show stale metadata-derived filter matches until reconciliation runs (`rollout/src/state_db.rs:591-655`; `rollout/src/recorder.rs:430-453,503-534`).

That is why the base recommendation still makes sense: use DB-only for initial picker paint, then lazily reconcile the selected row or visible rows after first paint. That preserves the current filesystem-backed repair path as the eventual-correctness mechanism, but moves it off the critical path for opening `/resume` (`rollout/src/state_db.rs:591-655`; `rollout/src/recorder.rs:430-453,511-532`).
