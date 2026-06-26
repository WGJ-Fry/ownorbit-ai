# Changelog

## 0.1.2-alpha.0

Current cold-launch alpha aligned to the latest main branch safety and onboarding work.

- Bumped the public Docker alpha path to `v0.1.2-alpha`.
- Updated README, Docker Compose, release docs, support templates, and release checks to use the current alpha tag.
- Added release notes for the current alpha cold-launch path.
- Rebuilt local unsigned macOS release metadata for `0.1.2-alpha.0`.
- Included the latest mobile credential expiry guidance, IndexedDB-first pairing storage, redacted action metadata, and first-launch handoff summary copy in the current alpha line.
- Added structured Markdown memory signals for deadlines, renewals, promises, tasks, and appointments.
- Added optional read-only local `.ics` calendar/task ingestion for upcoming `VEVENT` events and open dated `VTODO` tasks in the local memory context.
- Added Studio generated-program blueprint confirmation checklists, permission notes, and failure recovery guidance.
- Added backward-compatible blueprint hydration so older SQLite problem blueprints gain the new Studio guidance fields when read.
- Clarified that Apple Calendar, Google Calendar, and system reminders account sync/write-back are not yet shipped.

## 0.1.1-alpha.0

Focused Docker quickstart alpha for the local Markdown memory loop.

- Added Docker Compose quickstart with LifeOS, Ollama, automatic `llama3.2` pull, local vault, and local data mounts.
- Added GHCR Docker image workflow for tagged releases.
- Added quickstart mode so env-managed local installs can log in once and go straight to `/chat`.
- Added local Markdown vault ingestion for `/api/chat` with prompt-injection guardrails.
- Changed the local model default to `llama3.2` and made quickstart/local env settings override frontend provider/model hints.
- Changed repository metadata and license to MIT for a real open-source release path.
- Rewrote README around the single verifiable promise: ask "What am I forgetting?" from local Markdown notes.

## 0.1.0

Initial local-first LifeOS AI desktop/PWA release.

- Added admin authentication, CSRF protection, login lockout, device binding, WebSocket device authentication, and public/LAN safety gates.
- Moved core data to SQLite with migrations, backups, restore scheduling, automatic backup plans, encrypted backup export/import, cleanup, and redacted diagnostics.
- Added mobile PWA chat, offline queue retry state, device credential migration, device management, and local URL Scheme action controls.
- Added secure AI provider configuration for Gemini, OpenAI, OpenRouter, and local OpenAI-compatible models.
- Added per-provider AI model catalogs, persisted default model selection, validation, audit logging, and admin UI controls.
- Added AI model selection to the first-start onboarding flow.
- Added connection diagnostics for LAN, Cloudflare Tunnel, and Tailscale with copyable setup commands.
- Added unsigned macOS packaging, update feed generation, desktop smoke tests, release checks, and documentation for signing/notarization paths.
- Added recursive audit metadata redaction for admin APIs and diagnostics.
- Added desktop-shell diagnostic export that works from the Electron menu without an admin web session.
- Redacted local data directory paths from admin configuration diagnostics.
- Expanded the mobile device and connection page with network status, offline queue counts, retry, and clear actions.
- Added AI provider runtime coverage for OpenAI, OpenRouter, local model routing, headers, and model selection.
- Hardened desktop diagnostic logs so startup log tails do not expose local data directory paths.
- Added the mobile device and connection page to the PWA offline shell cache.
- Added configurable cleanup policy controls for backup retention, audit log age, and chat history age.
- Hardened backup restore smoke tests by selecting verified open ports for each local server run.
- Redacted audit log target URLs and free-form string values to avoid leaking query tokens or local paths.
- Added mobile weak-network/offline status detection and clearer offline queue messaging.
- Added recommended-base-url pairing links so mobile binding QR codes can use LAN, Tailscale, or public tunnel addresses safely.
- Added scoped data exports for chat, memories, devices, and audit logs.
- Added Cloudflare Tunnel URL detection from running cloudflared process details.
- Expanded mobile local-action logs with source, target, parameters, risk level, timestamp, and result.
- Added explicit unsigned release strategy checks for strict GitHub Release/private download distribution.
- Added explicit macOS, Windows, and Linux desktop distribution scripts and release documentation.
