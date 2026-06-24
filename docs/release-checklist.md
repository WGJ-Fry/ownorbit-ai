# Release Checklist

LifeOS AI can be packaged locally as an unsigned desktop app. There are two distribution strategies:

- `unsigned`: simplest GitHub Release/private download. No signing, notarization, or update host is required, but macOS can show a Gatekeeper warning.
- `signed`: public polished distribution. Requires platform signing certificates, macOS notarization, and optionally an HTTPS update host.

## Automated Check

Run the release gate before creating installer artifacts:

```bash
npm run release:check
```

It verifies:

- Required desktop scripts exist.
- `src/App.tsx` and `src/components/apps/StudioApp.tsx` stay below the source-size budget that keeps the app shell maintainable.
- Electron build metadata is configured.
- macOS DMG, Windows NSIS, and Linux AppImage targets are configured.
- `dist/` build output is present.
- The local Electron binary exists at `node_modules/electron/dist`.
- PWA icon and security/migration files exist.
- `electron-updater` is installed.
- Desktop startup failure window is implemented.
- Desktop diagnostic export is implemented.
- `release:feed` exists for generating update metadata.
- `release/` contains a desktop artifact when packaging has already been run.
- `release/update-feed/` contains `latest*.yml` metadata when update publishing has already been prepared.
- `release/update-feed/release-manifest.json` matches the package version, artifact names, sizes, and sha512/sha256 hashes.
- `CHANGELOG.md` mentions the current package version.
- `docs/rollback.md` exists.
- `npm audit --audit-level=high` passes.

Warnings are used for items that depend on external accounts or deployment choices. To make warnings fail CI:

```bash
LIFEOS_RELEASE_STRICT=1 npm run release:check
```

For the unsigned GitHub Release strategy, use the strict unsigned gate:

```bash
npm run release:check:unsigned
```

This sets `LIFEOS_DISTRIBUTION=unsigned` and treats signing, notarization, and `LIFEOS_UPDATE_URL` as optional.

## Local Verification Flow

```bash
npm run electron:install
npm run lint
npm test
npm run test:e2e
npm run test:desktop
npm run desktop:pack:unsigned
npm run desktop:zip:unsigned
npm run release:check:unsigned
```

For the current platform release smoke, use:

```bash
npm run desktop:release:smoke
```

This runs the quality gate, builds the current platform artifact, regenerates update metadata, blocks stale installer artifacts, verifies the packaged artifact, and runs the strict unsigned release check. In CI, set `LIFEOS_RELEASE_SMOKE_FAST=1` to use the lighter smoke gate before platform packaging.

On macOS, run the real packaged app launch smoke before handing the zip to users:

```bash
npm run desktop:artifact:smoke:launch
```

For a single local macOS release-smoke command that also launches the packaged app, run:

```bash
LIFEOS_RELEASE_SMOKE_LAUNCH=1 npm run desktop:release:smoke
```

The unsigned app directory is expected at:

```text
release/mac-arm64/LifeOS AI.app
```

The unsigned download package and mac update feed are expected at:

```text
release/LifeOS AI-<version>-<arch>-unsigned.zip
release/update-feed/latest-mac.yml
release/update-feed/release-manifest.json
```

## Platform Build Commands

Use explicit platform commands when preparing real installer artifacts:

```bash
npm run desktop:dist:mac
npm run desktop:dist:win
npm run desktop:dist:linux
```

Recommended build hosts:

- macOS DMG: build on macOS.
- Windows NSIS: build on Windows, especially when signing.
- Linux AppImage: build on Linux for the closest runtime match.

`npm run release:check` verifies that these scripts and the target configuration exist. It does not prove that another operating system's installer was built on the current machine.

The repository also includes `.github/workflows/desktop-release-smoke.yml`, which runs `npm run desktop:release:smoke` on macOS, Windows, and Linux using the fast smoke mode. The macOS job also launches the packaged `.app` and verifies the local core plus mobile install manifest. Use it before public releases to catch platform packaging regressions early.

The smoke script builds a platform artifact on each runner:

- macOS: unsigned `.app` plus `LifeOS AI-<version>-<arch>-unsigned.zip`, then `latest-mac.yml`.
- Windows: NSIS `.exe`, then `latest.yml`.
- Linux: AppImage, then `latest-linux.yml`.

`npm run release:check:unsigned` verifies that the workflow covers all three platforms, disables opportunistic signing, and that the smoke script really calls the Windows and Linux package commands. A local macOS run still only proves the macOS artifact; the GitHub Actions matrix is the cross-platform packaging proof.

For publishable CI artifacts, use the `Desktop Package Artifacts` workflow. Manual runs produce downloadable Actions artifacts for review. A `v*` tag run waits for all platform package jobs, then the `publish-draft` job aggregates the generated installers, `SHA256SUMS`, install guides, `latest*.yml`, and `release-manifest.json` into one GitHub Release draft.

## Unsigned GitHub Release Strategy

Use this path when you do not want app-store style signing:

```bash
npm run desktop:zip:unsigned
npm run release:artifacts:check
npm run release:check:unsigned
```

If `release:artifacts:check` reports stale installers from an older package version, rebuild packages for the current version. For local cleanup only, run `npm run release:artifacts:fix`; it deletes only version-mismatched package files and leaves current-version artifacts in place.

Upload these files to a GitHub Release or private HTTPS download page:

```text
release/LifeOS AI-<version>-<arch>-unsigned.zip
release/USER-INSTALL.md
release/SHA256SUMS
release/update-feed/latest-mac.yml
release/update-feed/release-manifest.json
```

Users unzip the app, move it to Applications, and open it manually. Share `release/USER-INSTALL.md` with them so first launch, phone binding, backup, update, and troubleshooting steps are clear. Publish `release/SHA256SUMS` next to the download so users or support can verify the artifact with `shasum -a 256 -c SHA256SUMS` on macOS/Linux or `Get-FileHash` on Windows. Auto-update can stay disabled unless you also publish the complete `release/update-feed/` directory to a stable HTTPS URL and set `LIFEOS_UPDATE_URL`.

Preferred GitHub Release path:

```bash
git tag v0.1.2-alpha
git push origin v0.1.2-alpha
```

Wait for `Desktop Package Artifacts`, open the generated GitHub Release draft, download the assets once for a clean install test, then publish the draft.

After publishing the draft, verify that both public launch entrypoints work without authentication:

```bash
LIFEOS_CHECK_GHCR=1 LIFEOS_CHECK_GITHUB_RELEASE=1 npm run check:cold-launch
```

## Signed macOS Distribution Strategy

Configure these before `npm run desktop:dist`:

```bash
CSC_LINK="/absolute/path/to/developer-id-application.p12"
CSC_KEY_PASSWORD="certificate-password"
APPLE_ID="apple-id@example.com"
APPLE_APP_SPECIFIC_PASSWORD="app-specific-password"
APPLE_TEAM_ID="TEAMID12345"
```

The unsigned app build is valid without these values. Use signing and notarization when you want fewer macOS warnings and a more polished public distribution.

## Required For Windows Distribution

Configure an Authenticode certificate before building the NSIS installer:

```bash
CSC_LINK="/absolute/path/to/windows-certificate.p12"
CSC_KEY_PASSWORD="certificate-password"
```

Build the Windows installer on Windows for the most reliable signing result.

## Update Feed

Set an update feed only after a release host is ready:

```bash
LIFEOS_UPDATE_URL="https://updates.example.com/lifeos-ai"
```

`LIFEOS_UPDATE_URL` must point to the HTTPS directory that contains the feed files, not to a single `.zip`, `.dmg`, `.exe`, `.AppImage`, `.yml`, or `.json` file. Do not put usernames, passwords, query tokens, or fragments in this value.

To prepare feed files:

```bash
npm run desktop:zip:unsigned
```

For signed DMG/NSIS/AppImage publishing, use the relevant `desktop:dist:*` command or `npm run desktop:dist`, then run `npm run release:feed`.

Upload the complete contents of `release/update-feed/` to the HTTPS directory used by `LIFEOS_UPDATE_URL`; keep each artifact, its matching `latest*.yml`, and `release-manifest.json` together. For GitHub Releases, use the release download directory, for example:

```bash
LIFEOS_UPDATE_URL="https://github.com/<owner>/<repo>/releases/download/v0.1.0"
```

Without this value, the packaged desktop app starts normally and skips update checks.

## Release Notes And Rollback

Every distributable build should update:

```text
CHANGELOG.md
docs/rollback.md
```

The rollback guide covers app rollback, data restore, pending restore cancellation, and update feed rollback. Keep the previous package artifact and matching `latest*.yml` together when publishing updates.
