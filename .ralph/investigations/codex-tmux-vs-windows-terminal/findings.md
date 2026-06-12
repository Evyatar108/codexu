# Codex under tmux/WSL vs Windows Terminal/PowerShell

## Verdict for the operator

If "run codex in tmux" means what it almost certainly means on this Windows machine - running the Linux Codex build under WSL (or another POSIX layer) inside tmux - then **yes, it would remove the specific Windows console input-leak bug** that produced raw `[O[I` and `[6~` tails. The committed root-cause work shows that bug is a Windows console / crossterm WinAPI-path problem, while the Unix path parses VT focus and special-key sequences correctly instead of leaking their tails into the composer (`.ralph/investigations/codex-tui-focus-event-leak\windows-path-verification.md:5-13`; `.ralph/investigations/codex-tui-focus-event-leak\fix-design.md:14-45,64-77`). But tmux/WSL would **not** fix the resize-reprint bug or `/resume` slowness: resize reflow is cross-platform, and `/resume` is slow because the picker deliberately uses a filesystem-first scan/repair path rather than a DB-only path (`.ralph/investigations/codex-tui-resize-reprints-history\findings.md:95-105`; `.ralph/investigations/codex-resume-slow-conversation-list\findings.md:136-149`). So the honest answer is "fewer bugs of one particular Windows-console class, not fewer bugs overall."

Switching also adds new tmux-specific behavior and operating cost. Focus events are off by default in tmux unless you enable them, PageUp/PageDown and mouse behavior are mediated by tmux copy-mode and alternate-screen semantics, and Codex's terminal heuristics may see the tmux client terminal or fall back to a generic `xterm-256color` / `Unknown` view (`codex\external\repos\codex-patched\codex-rs\cli\src\doctor.rs:135-141,2053-2060`; `codex\external\repos\codex-patched\codex-rs\terminal-detection\src\terminal_tests.rs:385-430,894-940`). The WSL route also implies a separate Linux install, Linux-side `~/.codex` session/SQLite state unless you deliberately share paths, and possible performance loss if you point that Linux build back at `/mnt/c/...` to reuse the Windows store (`codex\external\repos\codex-patched\codex-rs\rollout\src\config.rs:5-18,24-33`; `codex\external\repos\codex-patched\codex-rs\rollout\src\metadata.rs:213-226`; `codex\external\repos\codex-patched\codex-rs\rollout\src\state_db.rs:38-48,64-72,104-120`; <https://learn.microsoft.com/en-us/windows/wsl/filesystems>). Net: **worth it as a workaround if the Windows input leak is your main pain; not the right answer if your goal is to make Codex broadly less buggy.**

## 1. Platform mapping: "tmux on Windows" really means a Unix Codex path

tmux itself is a POSIX terminal multiplexer, not a native Windows console app. The upstream tmux README lists supported platforms as OpenBSD, FreeBSD, NetBSD, Linux, macOS, and Solaris, not Windows (<https://raw.githubusercontent.com/tmux/tmux/master/README>). In practice on this machine, "Codex in tmux" means one of:

1. **WSL + tmux** (most likely), or
2. a POSIX compatibility layer such as **Cygwin/MSYS**, which is still a Unix-ish terminal stack rather than the Windows console API (<https://github.com/tmux/tmux#installing>; <https://learn.microsoft.com/en-us/windows/wsl/>).

That platform shift matters because Codex does ship Linux builds and release artifacts. The CLI source explicitly notes platform-specific binary names like `codex-x86_64-unknown-linux-musl`, and the release workflow builds MUSL-linked Linux artifacts for both x64 and arm64 (`codex\external\repos\codex-patched\codex-rs\cli\src\main.rs:95-99`; `codex\external\repos\codex-patched\.github\workflows\rust-release.yml:182-206`). The install-context code and tests also model standalone Linux release directories under `~/.codex/packages/standalone/releases/...-x86_64-unknown-linux-musl` (`codex\external\repos\codex-patched\codex-rs\install-context\src\lib.rs:43-54`; `codex\external\repos\codex-patched\codex-rs\install-context\src\lib.rs:289-326`).

So the operator is not comparing "same Windows Codex, different tab manager." The real comparison is:

- **today:** Windows Codex build + Windows Terminal / PowerShell + Windows console input path;
- **tmux route:** Linux Codex build + tmux + Unix PTY/VT input path, probably under WSL.

## 2. Per-bug verdict

### A. Focus leak (`[O[I` / `[6~`)

**Verdict:** **this specific bug should go away under tmux/WSL**, because its root cause is Windows-specific.

The merged investigation corrected the earlier Unix-path theory for Windows and showed that the operator's leak is produced by the Windows console path: Codex uses crossterm's Windows `INPUT_RECORD` reader, not the Unix byte parser, and when VT-style input leaks into that path the leading `ESC` can disappear while the printable tail becomes `[` / `O` / `I` / `6` / `~` characters in the composer (`.ralph/investigations/codex-tui-focus-event-leak\windows-path-verification.md:5-13,21-28,47-55`; `.ralph/investigations/codex-tui-focus-event-leak\fix-design.md:14-45,47-77`). The same fix-design document is explicit that Unix/macOS use the normal VT byte-stream parser, where `ESC[I`, `ESC[O`, and `ESC[6~` are the expected encoding and are assembled correctly (`.ralph/investigations/codex-tui-focus-event-leak\fix-design.md:64-77`).

The tmux wrinkle is **focus forwarding**, not the original bug. Codex's own `doctor` command treats the tmux options `extended-keys`, `xterm-keys`, `allow-passthrough`, `set-clipboard`, and `focus-events` as first-class diagnostics when it detects tmux (`codex\external\repos\codex-patched\codex-rs\cli\src\doctor.rs:135-141,1653-1657,2053-2060`). In tmux, focus reporting is off by default unless `focus-events` is enabled, so there are two realistic outcomes:

1. **`focus-events` off:** Codex likely stops receiving focus notifications entirely, which also prevents the `[I` / `[O` leak but gives up focus-based behavior.
2. **`focus-events` on:** Codex receives focus notifications again, but now via the Unix VT path rather than the Windows console-record path, so the Windows-specific leak mechanism should not apply.

So tmux/WSL is a plausible workaround for this bug class, but partly because it either removes focus events or routes them through a different parser stack.

### B. Resize reprint / "slowly reprints the whole history"

**Verdict:** **tmux/WSL does not fix this bug.**

The merged OS-dependence follow-up is explicit: resize-reprint is **not Windows-only**. `TerminalResizeReflow` is default-on with no OS gate, and the resize path always rebuilds Codex-owned history from `transcript_cells` instead of repainting only the current viewport (`.ralph/investigations/codex-tui-resize-reprints-history\findings.md:95-105`). The base resize investigation traced the exact path: a `Resize` event schedules transcript rebuild work, Codex clears its terminal history surface, and then `reflow_transcript_now()` re-emits reflowed lines back into scrollback, making the work O(history) rather than O(viewport) (`.ralph/investigations/codex-tui-resize-reprints-history\findings.md:7-18,21-35,38-59,63-89`).

What changes under tmux is mostly **presentation and severity**, not root cause. The outer terminal, tmux pane, and Codex can each have their own resize/redraw semantics, so the effect may look somewhat different. But Codex itself still performs the same retained-history rebuild. The previous follow-up only singled out Windows Terminal because its default auto cap is high (9,001 rows) compared with many other terminals, making the same cross-platform algorithm more visible there (`.ralph/investigations/codex-tui-resize-reprints-history\findings.md:95-105`).

### C. `/resume` slowness

**Verdict:** **tmux/WSL does not fix this, and can make it worse if you reuse the Windows store through `/mnt/c`.**

The merged follow-up says this one plainly: `/resume` slowness is **not OS-related**. The picker hard-codes `use_state_db_only: false`, the thread store just forwards that flag, and the rollout layer chooses between `StateDbOnly` and `ScanAndRepair` strictly from that request bool rather than any Windows-vs-Unix branch (`.ralph/investigations/codex-resume-slow-conversation-list\findings.md:136-149`). The slow path is expensive because it performs a filesystem-first scan/repair walk over rollout files before the first page renders (`.ralph/investigations/codex-resume-slow-conversation-list\findings.md:61-103,106-149`).

If the operator runs Linux Codex under WSL and points it at a Linux-side `~/.codex`, `/resume` remains logically the same bug - only now against a different store. If they instead try to reuse the current Windows `.codex` tree from WSL via `/mnt/c/...`, Microsoft explicitly recommends against that for performance-sensitive Linux CLI work: WSL is fastest when the project/data live in the Linux filesystem, not on mounted Windows drives (<https://learn.microsoft.com/en-us/windows/wsl/filesystems>). That means the tmux/WSL route can preserve the bug and add cross-filesystem I/O overhead at the same time.

## 3. New tmux-specific risks and behavior changes

Switching to tmux/WSL trades one class of Windows-console bugs for a new set of tmux-specific moving parts.

### A. Focus events become configuration-dependent

As noted above, tmux forwarding of focus notifications is not automatic. Codex itself treats `focus-events` as a tmux setting worth diagnosing (`codex\external\repos\codex-patched\codex-rs\cli\src\doctor.rs:135-141,2053-2060`). So if the operator wants focus-based behavior such as "unfocused" notification logic, they need tmux configured compatibly; if they only care about suppressing the leak, leaving `focus-events` off is probably safer.

### B. PageUp/PageDown, copy-mode, and alternate-screen mediation

tmux is not a transparent pipe for navigation keys. It has its own copy-mode and alternate-screen behavior, so PageUp/PageDown can be handled by tmux, by the full-screen app inside the pane, or by Codex depending on pane state and tmux config (<https://man7.org/linux/man-pages/man1/tmux.1.html>). That means the operator could easily eliminate the exact Windows `[6~` leak but still find key behavior "different" or "wrong" because tmux intercepts or reroutes those keys before Codex sees them.

### C. Mouse and scroll handling

Mouse behavior also becomes tmux-mediated. Codex's `doctor` diagnostic treats tmux as a special environment and surfaces tmux options such as `allow-passthrough`, while tmux mouse support itself is opt-in and interacts with app-level mouse reporting (`codex\external\repos\codex-patched\codex-rs\cli\src\doctor.rs:135-141,2053-2060`; <https://man7.org/linux/man-pages/man1/tmux.1.html>). So if the operator uses wheel scroll or click behaviors in Codex, this is another surface where tmux can help or hurt depending on config.

### D. Terminal heuristics and `$TERM` become less direct

Codex has explicit tmux-aware terminal detection tests. When tmux exposes client termtype info, Codex can still identify the outer terminal (for example WezTerm); when it only sees a generic termname such as `xterm-256color`, it falls back to a more generic/unknown classification (`codex\external\repos\codex-patched\codex-rs\terminal-detection\src\terminal_tests.rs:385-430,894-940`). That means features keyed off terminal identity - palette behavior, diagnostics, and potentially terminal-specific heuristics - may become less precise inside tmux than in a direct Windows Terminal session.

## 4. Costs and trade-offs of switching

### A. Separate install and state

Codex state is rooted in `codex_home` and `sqlite_home`, and session backfill walks `codex_home/sessions/...` while SQLite state initializes from `sqlite_home` (`codex\external\repos\codex-patched\codex-rs\rollout\src\config.rs:5-18,24-33`; `codex\external\repos\codex-patched\codex-rs\rollout\src\metadata.rs:213-226`; `codex\external\repos\codex-patched\codex-rs\rollout\src\state_db.rs:38-48,64-72,104-120`). In other words, a Linux Codex install under WSL naturally wants its **own** Linux-side `~/.codex` state. Unless the operator deliberately shares state paths, they should expect a separate login flow, separate session history, and separate SQLite DB from the Windows install.

### B. Cross-filesystem performance traps

If the operator does share the existing Windows store into WSL via `/mnt/c`, Microsoft says that is the slower choice for Linux command-line workloads; storing files directly in the Linux filesystem is the recommended fast path (<https://learn.microsoft.com/en-us/windows/wsl/filesystems>). For a feature like `/resume` that already does filesystem-heavy enumeration and repair work, that matters.

### C. Operational complexity

Running tmux/WSL also means the operator is no longer debugging one environment. They now have:

1. the outer Windows terminal,
2. WSL itself,
3. tmux as a multiplexer/config layer,
4. a Linux Codex install and Linux-side state.

That can be worth it for a known Windows console bug, but it is a real cost if the goal is simply "make Codex less weird."

## 5. Net verdict

| Surface | Under tmux/WSL | Why |
| --- | --- | --- |
| `[O[I` / `[6~` input leak | **Likely goes away** | Windows-only console-record / VT-input mismatch disappears when Codex runs on the Unix VT path (`.ralph/investigations/codex-tui-focus-event-leak\windows-path-verification.md:5-13`; `.ralph/investigations/codex-tui-focus-event-leak\fix-design.md:14-45,64-77`). |
| Resize reprint | **Stays** | Cross-platform Codex resize-reflow design; tmux changes environment, not the algorithm (`.ralph/investigations/codex-tui-resize-reprints-history\findings.md:7-18,38-59,95-105`). |
| `/resume` slowness | **Stays** | DB-vs-filesystem listing policy bug, not terminal/OS bug (`.ralph/investigations/codex-resume-slow-conversation-list\findings.md:61-149`). |
| Focus behavior | **Becomes config-dependent** | tmux can suppress or forward focus events depending on config; Codex treats `focus-events` as a tmux-relevant diagnostic (`codex\external\repos\codex-patched\codex-rs\cli\src\doctor.rs:135-141,2053-2060`). |
| Key/mouse behavior | **May change** | tmux copy-mode, alternate-screen, and mouse mediation sit between Codex and the outer terminal. |
| Session/auth/state reuse | **Not automatic** | Linux build naturally uses Linux-side Codex home/state unless paths are deliberately shared (`codex\external\repos\codex-patched\codex-rs\rollout\src\config.rs:5-18,24-33`; `codex\external\repos\codex-patched\codex-rs\rollout\src\metadata.rs:213-226`). |

Bottom line: **yes, tmux/WSL is a reasonable workaround for the Windows input-leak bug; no, it is not a general "Codex will have fewer bugs" answer.** If the operator's top pain is raw `[O[I` / `[6~` garbage in the composer, switching to tmux/WSL is likely to help immediately. If the goal is broader stability, the better plan is to keep using the normal Windows path and fix the Windows-only input bug in place, because the other major problems they hit are not solved by changing terminal stacks.
