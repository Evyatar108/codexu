# J5 app compatibility browser reproduction

The browser evidence uses the real Expo web bundle and a disposable copy of
the pinned Rust fixture. The Codex submodule is not edited.

- Codex SHA: `3ff55692e7045e85ce78ebe8337ab40b55494c9c`
- Fixture tree: `dc1e9448f3b616882abad5553b04b922754693da`
- Adapter: `app-compat-harness.patch`
- Adapter SHA-256:
  `6217F59089C8A9227EC11EB6EB1651AE5EDDE6681F377A93143A960D9ABF7638`

The adapter is default-off behind `--app-acceptance`. It adds only the
proof-authenticated app list/message routes and deterministic snapshot-to-final
delivery needed by this browser regression. Without the flag, all 15 unit and
12 compatibility tests retain the pinned fixture behavior.

## Prepare and verify the adapter

Run from
`D:\harness-efforts\codexu\.worktrees\codex-native-happy-app-compat`:

```powershell
$acceptance = '.ralph\jobs\codex-native-happy-server-local-web-dual-control\acceptance'
$source = 'codex\codex-rs-overlay\codex-happy-compat-spike'
$harness = '.app-compat-harness-work'

git -C codex rev-parse HEAD
git -C codex rev-parse HEAD:codex-rs-overlay/codex-happy-compat-spike
(Get-FileHash "$acceptance\app-compat-harness.patch" -Algorithm SHA256).Hash

Remove-Item -Recurse -Force $harness -ErrorAction SilentlyContinue
Copy-Item -Recurse -Force $source $harness
git apply --check --ignore-space-change --directory=$harness "$acceptance\app-compat-harness.patch"
git apply --ignore-space-change --directory=$harness "$acceptance\app-compat-harness.patch"

subst R: $((Get-Location).Path)
$env:PATH = 'C:\Users\evmitran\AppData\Local\Microsoft\WinGet\Packages\BrechtSanders.WinLibs.POSIX.UCRT_Microsoft.Winget.Source_8wekyb3d8bbwe\mingw64\bin;' + $env:PATH
$env:CARGO_TARGET_DIR = 'R:\app-compat-target'
cargo +stable-x86_64-pc-windows-gnu test --manifest-path "$harness\Cargo.toml"
```

The recorded result is in `app-compat-harness-tests.txt`.

## Run the production routes

Start the adapted Rust server:

```powershell
R:\app-compat-target\debug\codex-happy-compat-spike.exe server `
  --bind 127.0.0.1:43127 `
  --origin http://localhost:8081 `
  --journal R:\app-compat-auth.sqlite `
  --app-acceptance
```

Start Expo in another shell:

```powershell
pnpm --filter happy-app exec cross-env APP_ENV=development CI=1 expo start --web --port 8081
```

Use a new agent-browser session. Open `/server`, snapshot interactive elements,
paste the fresh `HAPPY_LOCAL_INVITE` value from the Rust process into the
pairing textbox, and activate **Pair with server**. Do not save the invite or
the server log.

```powershell
agent-browser --session native-happy-app-repro open http://localhost:8081/server
agent-browser --session native-happy-app-repro snapshot -i
agent-browser --session native-happy-app-repro open http://localhost:8081/
agent-browser --session native-happy-app-repro open http://localhost:8081/session/compat-machine:compat-session
```

After the initial durable message is visible, run:

```powershell
R:\app-compat-target\debug\codex-happy-compat-spike.exe rust-client `
  --url http://127.0.0.1:43127 `
  --app-acceptance
```

Verify that the final text appears exactly once, no transient snapshot text
remains, the machine label is `compat-machine`, and no machine-fetch error or
`unknown` label is visible. Then capture and close:

```powershell
agent-browser --session native-happy-app-repro screenshot "$acceptance\app-compat.png" --full
agent-browser --session native-happy-app-repro close
```

## Cleanup

Stop the two server processes by their captured process IDs, then remove only
the disposable artifacts:

```powershell
Remove-Item -Recurse -Force $harness, 'app-compat-target' -ErrorAction SilentlyContinue
Remove-Item -Force 'app-compat-auth.sqlite','app-compat-auth.sqlite-shm','app-compat-auth.sqlite-wal' -ErrorAction SilentlyContinue
subst R: /D
```

Invite tokens, pair secrets, pairing nonces, private keys, proofs,
capabilities, database files, and server logs are intentionally excluded from
the acceptance directory.
