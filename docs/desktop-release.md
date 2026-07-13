# Desktop Release Plan / 桌面发布说明

LifeOS AI desktop uses Electron to start the local core and open the admin console.

## Current Scripts

```bash
npm run desktop
npm run desktop:pack
npm run desktop:pack:unsigned
npm run desktop:zip:unsigned
npm run desktop:dist
npm run desktop:dist:mac
npm run desktop:dist:win
npm run desktop:dist:linux
npm run electron:install
npm run desktop:release:smoke
npm run release:check
npm run release:check:unsigned
npm run release:feed
```

- `desktop`: builds and starts Electron in development.
- `desktop:pack`: creates an app directory with `electron-builder --dir`; macOS may auto-detect a signing identity.
- `desktop:pack:unsigned`: creates an unsigned app directory and disables auto signing with `CSC_IDENTITY_AUTO_DISCOVERY=false`.
- `desktop:zip:unsigned`: creates an unsigned macOS `.app`, zips it with `ditto`, and generates update-feed metadata plus a release manifest.
- `desktop:dist`: creates installer artifacts such as `.dmg`, NSIS, or AppImage.
- `desktop:dist:mac`: builds macOS targets from the Electron Builder config.
- `desktop:dist:win`: builds Windows targets from the Electron Builder config.
- `desktop:dist:linux`: builds Linux targets from the Electron Builder config.
- `electron:install`: installs Electron from a configurable mirror into `node_modules/electron/dist`.
- `desktop:release:smoke`: runs the quality gate, builds the current platform desktop artifact, regenerates update feed metadata, and runs the strict unsigned release check. On macOS it produces the unsigned zip; on Windows it produces the NSIS `.exe`; on Linux it produces the AppImage.
- `release:check`: verifies packaging prerequisites, security baseline files, Electron binary, audit status, and release artifact presence.
- `release:feed`: copies desktop artifacts into `release/update-feed/` and generates `latest*.yml` metadata for `electron-updater` plus `release-manifest.json` for artifact/hash verification.

## Current Packaging Status

Current verified path:

- Electron is upgraded to `42.3.3`.
- `electron-builder` is upgraded to `26.15.2`.
- `npm audit` reports `0 vulnerabilities`.
- `npm run electron:install` verifies or installs `node_modules/electron/dist`.
- when signing variables are configured, `desktop:dist:mac` can produce `release/LifeOS AI-0.1.5-alpha.0-arm64.dmg`.
- the signed macOS target is intended to be Developer ID signed, Apple notarized, and stapled; unsigned local builds still need the Gatekeeper fallback path.
- Windows x64 NSIS succeeds and creates `release/LifeOS AI Setup 0.1.5-alpha.0.exe`.
- Linux x64 AppImage succeeds and creates `release/LifeOS AI-0.1.5-alpha.0.AppImage`.
- `package.json` sets `build.electronDist=node_modules/electron/dist` for macOS local builds. Windows/Linux scripts override it with `-c.electronDist=` so electron-builder downloads the correct target runtime.
- `npm run release:check` provides an automated pre-release gate. Use `LIFEOS_RELEASE_STRICT=1 npm run release:check` when warnings should fail CI.
- `npm run desktop:release:smoke` provides a current-platform packaging smoke. The GitHub Actions workflow `.github/workflows/desktop-release-smoke.yml` runs it on macOS, Windows, and Linux with `LIFEOS_RELEASE_SMOKE_FAST=1`. The release check verifies that this workflow and script still cover macOS zip, Windows NSIS, Linux AppImage, and update-feed regeneration.

The Electron binary download path is handled by `scripts/install-electron.mjs`. It uses:

```text
ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
```

Override it when a different mirror is needed:

```bash
ELECTRON_MIRROR=https://github.com/electron/electron/releases/download/ npm run electron:install
```

Current known distribution gap:

- Windows is not Authenticode signed yet. The NSIS installer is usable, but SmartScreen may warn about an unknown publisher.
- Current public unsigned alpha packages use manual download plus SHA256 verification. Signed distributions can use a safe HTTPS `LIFEOS_UPDATE_URL` as the default update path; unsigned alpha builds require `LIFEOS_ENABLE_DESKTOP_AUTO_UPDATE=1` before feed checks run.
- The macOS artifact is arm64 only. Intel Mac users need a separate x64 or universal build.

## macOS Signing Path

For local unsigned testing:

```bash
npm run desktop:pack:unsigned
```

For a simple GitHub Releases download without Apple signing:

```bash
npm run desktop:zip:unsigned
npm run release:check:unsigned
```

Upload the generated zip. Users can unzip it, move `LifeOS AI.app` to Applications, and open it manually. macOS may show a Gatekeeper warning because the app is unsigned.

For signed distribution:

1. Enroll in Apple Developer Program.
2. Create Developer ID Application certificate.
3. Create `.env.signing.local` in the repo root, or export the same values in your shell:

   ```bash
   CSC_LINK="/absolute/path/to/certificate.p12"
   CSC_KEY_PASSWORD="certificate-password"
   APPLE_ID="apple-id@example.com"
   APPLE_APP_SPECIFIC_PASSWORD="app-specific-password"
   APPLE_TEAM_ID="TEAMID12345"
   ```

4. Run the signing preflight:

   ```bash
   npm run signing:check:mac:file
   ```

5. Run:

   ```bash
   npm run desktop:dist:mac:signed
   npm run release:check:signed:file
   ```

`scripts/with-signing-env.mjs` loads `.env.signing.local` automatically before running the check or packaging step. Electron Builder 26 can notarize automatically when those Apple environment variables are present.

## Windows Signing Path

1. Buy or provision an Authenticode code signing certificate.
2. Configure the Windows certificate path and password. Prefer a Windows-specific environment file or CI secrets so it does not conflict with the macOS `.p12`.
3. Run:

   ```bash
   npm run desktop:dist:win
   ```

The current local package is unsigned on Windows.

## Linux AppImage Path

Build on Linux for the closest runtime match:

```bash
npm run desktop:dist:linux
```

Unsigned AppImage artifacts can be distributed directly. If you publish an update feed, run `npm run release:feed` after the AppImage exists in `release/`.

When cross-building from macOS, use the configured script, which downloads the Linux x64 Electron runtime instead of reusing the macOS runtime:

```bash
ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ npm run desktop:dist:linux
```

## Update Channel

The desktop shell includes an optional `electron-updater` feed check. It requires a packaged app and a safe HTTPS `LIFEOS_UPDATE_URL`. Signed distributions can use the safe feed as the default update path; unsigned alpha builds still require explicit opt-in with `LIFEOS_ENABLE_DESKTOP_AUTO_UPDATE=1`:

```bash
LIFEOS_UPDATE_URL="https://updates.example.com/lifeos-ai"
LIFEOS_DISTRIBUTION=signed
```

`LIFEOS_UPDATE_URL` must be an HTTPS directory URL. Do not point it at a single installer/feed file, and do not include credentials, query tokens, or fragments.

Recommended release channels:

1. Unsigned manual updates: run `npm run desktop:zip:unsigned`, upload the zip, and leave `LIFEOS_UPDATE_URL` unset.
2. Unsigned optional feed checks: upload every file in `release/update-feed/` to a static HTTPS directory, set `LIFEOS_UPDATE_URL`, then set `LIFEOS_ENABLE_DESKTOP_AUTO_UPDATE=1`.
3. Signed installer updates: run the relevant `desktop:dist:*` command or `npm run desktop:dist`, then `npm run release:feed`, upload the installer plus `latest*.yml` and `release-manifest.json`, set `LIFEOS_UPDATE_URL`, and set `LIFEOS_DISTRIBUTION=signed` for safe default update checks.

Feed file mapping:

- macOS: `latest-mac.yml`
- Windows: `latest.yml`
- Linux: `latest-linux.yml`

For GitHub Releases, the practical value is usually:

```bash
LIFEOS_UPDATE_URL="https://github.com/<owner>/<repo>/releases/download/v0.1.5-alpha"
LIFEOS_DISTRIBUTION=signed
```

For an unsigned alpha feed test, use the same safe HTTPS directory and explicitly set `LIFEOS_ENABLE_DESKTOP_AUTO_UPDATE=1`. For a private update host, use the HTTPS folder that contains `latest-mac.yml`, `latest.yml`, or `latest-linux.yml` next to the installer artifact. Keep `release-manifest.json` in the same folder so release checks and support diagnostics can verify exactly which files were published.

## Optional Signed CloudKit Helper

The persistent macOS CloudKit notification listener is a separately signed Xcode app. It is never copied into a desktop package merely because a local build folder exists. To include it in a signed macOS package:

```bash
LIFEOS_CLOUDKIT_HELPER_APP="/absolute/path/LifeOSCloudKitHelper.app" \
LIFEOS_REQUIRE_BUNDLED_CLOUDKIT_HELPER=1 \
npm run desktop:dist:mac
```

Before electron-builder starts, `desktop:resources:prepare` verifies the helper signature and requires signed CloudKit container, CloudKit service, Apple team, bundle ID, and APNs environment entitlements. It then writes a redacted resource manifest and stages the verified app outside `app.asar`. A required helper that is missing, unsigned, or configured for the wrong container stops the package build.

Unsigned packages intentionally ship no native helper. They contain an `included: false` manifest, keep the 15-minute guarded polling and wake recovery path, and must not be described as push-delivery capable. `npm run desktop:artifact:smoke` verifies the packaged manifest, rejects unsafe relative paths, checks any declared helper files, and confirms that no local source path or raw secret flag entered the artifact.

## Startup Failure Experience

If the desktop shell starts but the local core cannot become healthy, LifeOS AI opens a startup failure window instead of quitting silently. The window shows the log directory and the startup error. The app menu remains available with "打开日志目录" and "退出 LifeOS AI".

The smoke test forces this path with:

```bash
LIFEOS_DESKTOP_FORCE_CORE_FAILURE=1
```

This is only for automated testing; normal users do not need to set it.

## Packaged App Launch Smoke

Before handing a macOS zip to a user, run the launch smoke once on a real macOS machine:

```bash
npm run desktop:artifact:smoke:launch
```

This mounts the signed DMG, installs `LifeOS AI.app` with `ditto`, removes transient provenance metadata if needed, opens the installed app through LaunchServices, waits for the local core health endpoint, and verifies that the mobile install manifest still preserves the pairing token inside the packaged desktop app. The default `npm run desktop:artifact:smoke` keeps launch optional so CI can still run on hosts where GUI app launch is unavailable.

## Desktop Diagnostics

The desktop menu and tray expose "导出桌面诊断包". This writes a redacted JSON file that does not require the admin web session. It includes the desktop shell version, platform, local core port, local core health snapshot, admin setup/auth status snapshot, update configuration status, log file summary, and recent log tail. It reports whether sensitive paths are configured without writing the full data directory path into the bundle.

The smoke test uses:

```bash
LIFEOS_DESKTOP_EXPORT_DIAGNOSTIC_ON_START=/tmp/lifeos-desktop-diagnostics.json
```

This is only for automated testing; regular users export from the menu.

## Installer Experience

First launch should open:

```text
/admin/login
```

The user sets the admin password, then binds the mobile PWA from:

```text
/admin/devices/pair
```

SQLite data is stored in Electron `userData`:

```text
<system app data>/LifeOS AI/data/lifeos.db
```

Backups can be created through the admin API:

```http
POST /api/v1/backups
GET /api/v1/backups
GET /api/v1/backups/schedule
PUT /api/v1/backups/schedule
POST /api/v1/backups/:file/encrypted-export
POST /api/v1/backups/encrypted-import
DELETE /api/v1/backups/pending-restore
POST /api/v1/backups/:file/restore
```

Admin dashboard also exposes backup creation and restore. Restore creates a pre-restore backup and schedules the selected SQLite file for the next app start, so the database is replaced before the runtime opens a SQLite connection. Pending restore tasks can be cancelled before restart.

Admin settings also exposes automatic backup scheduling, encrypted backup export/import, a public-mode security self-check, and a diagnostics export. Encrypted backup export uses AES-256-GCM with PBKDF2-derived keys; the passphrase is never stored. Imported encrypted backups are validated and saved as regular previewable SQLite backups before the user schedules restore. The downloaded diagnostics JSON is redacted and includes service status, network tunnel detection, device counts, backup summaries, pending restore state, and recent audit events. It does not include AI keys, admin passwords, device private keys, or absolute backup paths.

The connection guide detects LAN addresses, `cloudflared`, and `tailscale`, then shows copyable commands for LAN mode, temporary Cloudflare Tunnel, and Tailscale/Tailnet URLs. Public/LAN mode still requires `LIFEOS_ALLOW_PUBLIC=1`.

The mobile local-actions page includes a URL Scheme permission center. Allowed schemes, saved launch actions, and recent action records are synced through SQLite `client_state`; dangerous actions are confirmed before navigation, and blocked schemes are recorded.

Audit log metadata is redacted recursively before it is returned by admin APIs. Sensitive key names such as token, password, api key, secret, hash, ciphertext, private key, authorization, cookie, and local path are replaced with `[redacted]`.

The mobile chat page monitors online/offline and browser network quality signals. Offline or weak network conditions are surfaced in the chat UI, and failed messages remain in the offline queue with per-message retry, remove, retry-all, and clear actions.

Backup retention defaults to the newest 20 SQLite backups. Override it with:

```bash
LIFEOS_BACKUP_RETENTION_COUNT=50
```

Set it to `0` to disable automatic pruning.
