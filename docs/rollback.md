# Rollback Guide

Use this when a packaged OwnOrbit AI desktop build starts but behaves incorrectly after upgrade.

## Before Upgrade

1. Open Admin Settings.
2. Create a manual SQLite backup.
3. Download either the plain SQLite backup for local-only storage or an encrypted backup for off-device storage.
4. Confirm `release/update-feed/latest-mac.yml` points to the intended version before publishing an update feed.

## Roll Back The App

1. Quit OwnOrbit AI from the menu bar or tray.
2. Install the previous unsigned zip, DMG, NSIS installer, AppImage, or app directory from the previous GitHub Release.
3. Start OwnOrbit AI.
4. Open Admin Settings and confirm the service health, version, device count, and backup count.

## Roll Back Data

1. Open Admin Settings.
2. Preview the backup you want to restore.
3. Schedule restore.
4. Restart OwnOrbit AI.
5. Confirm the restored chat sessions, memories, devices, and audit logs.

Restore never overwrites the live database immediately. It creates a pre-restore backup and applies the selected SQLite file before the next process opens the database.

## Cancel A Mistaken Restore

If the app has not been restarted yet, open Admin Settings and use "取消恢复任务". The current SQLite database will remain active.

## Update Feed Rollback

For GitHub Releases or any HTTPS update host:

1. Re-run `npm run release:feed` against the older package artifact, or restore the previous `latest*.yml` from the release host.
2. Upload the older package and matching `latest*.yml`.
3. Keep the broken artifact available only if users need it for diagnostics; otherwise remove it from the update feed path.

Signed/notarized public releases should keep the previous signed artifact and its checksum together. Unsigned local zips can be rolled back by replacing the app directory.

