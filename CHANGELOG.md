# Changelog

## 0.1.6-alpha.0 (Unreleased source candidate)

- Simplified first launch to three visible actions: set the administrator password, configure one AI provider key, then scan the phone pairing QR and send the first message. Advanced connection and safety diagnostics remain available without blocking the normal path.
- Added tested Alibaba Qwen3.7-Max compatibility through the Model Studio OpenAI-compatible Chat Completions endpoint, including the stable alias, dated snapshots, explicit hybrid-thinking request parameters, structured output, and final-answer-only response handling.
- Added a private CloudKit chat request/response channel for the native iPhone shell. The phone can queue a text prompt while away from the Mac, and the Mac processes it through the configured AI provider without granting tools or native actions.
- Added dedicated P-256 device identities for CloudKit chat. The iPhone private key stays in the device-only Keychain, CloudKit receives only the public key, and the Mac verifies every signed request before creating a job.
- Added durable SQLite chat jobs, leases, bounded retries, expiry, idempotent response export, and visible waiting, Mac unavailable, processing, retrying, completed, failed, and timed-out states.
- Added CloudKit schema records for device keys, chat requests, and chat responses, plus migrations, server tests, native Swift tests, and a real-device acceptance item for one signed iPhone-to-Mac-to-iPhone roundtrip.
- Completed that real-device acceptance on a signed iPhone over 5G: the Mac text-only AI worker produced exactly one visible response, CloudKit push evidence arrived while the app was backgrounded/locked, and only a redacted local summary was retained.
- Added an explicit source/public release-state file so candidate source versions cannot silently overwrite the version advertised by existing GitHub downloads.
- Added a reproducible Developer ID Production export and Apple notarization path for the embedded macOS CloudKit Helper, plus packaging and artifact-smoke gates that reject device-limited, entitlement-drifted, or unnotarized helpers while keeping the outer alpha desktop package explicitly unsigned.

- Added a guarded native iPhone install command that verifies the signed app bundle, CloudKit container, APNs entitlement, and connected-device readiness before installation, then launches the app and writes path-free, identifier-free local evidence.
- Expanded the real Apple-device acceptance matrix with required native iPhone CloudKit read/write-back and locked-background push or `BGAppRefreshTask` recovery evidence.
- Replaced verbose known Xcode provisioning failures with one actionable Apple Developer agreement or profile-repair step while preserving full diagnostics for unknown build failures.
- Renamed the user-facing product from **LifeOS AI** to **OwnOrbit AI**, including the desktop shell, mobile PWA, native Apple shell, bilingual UI, documentation, repository metadata, and README visuals.
- Added upgrade compatibility for the former desktop user-data directory and iCloud Drive handoff folder so existing SQLite data, device bindings, settings, and phone entries remain usable after the rename.
- Kept published compatibility identifiers such as `LIFEOS_*`, `ai.lifeos.desktop`, `lifeos-mobile-entry.*`, CloudKit record identifiers, and the existing `ghcr.io/wgj-fry/lifeos-ai` image path stable.
- Added bilingual brand migration documentation and clearly labeled the public `v0.1.5-alpha` package filenames and product videos as pre-rename assets.

## 0.1.5-alpha.0

- Added privacy-safe iOS local notifications for expiring iCloud phone entries and repeated connection failures, with automatic cleanup after recovery.
- Corrected native iOS CloudKit background-fetch reporting so genuine failures return `failed` instead of being collapsed into `noData`.

Release candidate for the next public alpha. Do not advertise as publicly available until the tag, packages, Docker image, and release notes are published.

- Added bilingual README product videos with matching English and Chinese MP4/GIF/cover assets.
- Reworked first launch into a single-active-step setup flow: model key first, phone QR second, first chat third; backups, remote access, safety details, recovery tools, and diagnostics now live behind an advanced disclosure unless a critical security issue blocks setup.
- Expanded AI provider coverage across Mainland China and international model services, including DeepSeek, Qwen/DashScope, Kimi, GLM, Qianfan/ERNIE, Hunyuan, Doubao, MiniMax, StepFun, SiliconFlow, Baichuan, OpenAI, Gemini, Claude, Mistral, Groq, Perplexity, Together, xAI, OpenRouter, and local OpenAI-compatible endpoints.
- Added broader built-in model catalogs plus provider `/models` live refresh and manual model-ID entry so newly released model versions can be used before a LifeOS update ships.
- Added mobile offline recovery evidence for foreground, background, network, and timer recovery attempts.
- Added public-release review diagnostics for GitHub Latest, old releases, clean-machine SHA256 checks, anonymous GHCR pulls, and README/Release/Discussions truthfulness.
- Tightened signed/unsigned desktop update diagnostics so signed distributions can use a safe HTTPS feed by default while unsigned alpha builds remain manual unless explicitly opted in.
- Added the source-only native iOS CloudKit data browser with guarded normal-memory creation and task completion; existing memory, chat, generated-app, and device-trust records remain read-only on iPhone.
- Tightened the opt-in Mac CloudKit safe-cycle scheduler to check new installations every 15 minutes, queue local changes within 15 seconds, continue remote pages within 15 seconds, retry temporary failures after 5 minutes, and check again after server startup or desktop wake without exposing payloads or change tokens.
- Added a source-level persistent macOS CloudKit push-listener path: a provisioned `.app` helper registers for APNs, verifies the private database subscription, emits only fixed redacted lifecycle events, and lets Electron queue the existing guarded sync cycle after a matched database-change notification.
- Split CloudKit push evidence into subscription registration, listener readiness, and real delivery. Saving a subscription no longer counts as push delivery, and LifeOS never persists the APNs device token, notification payload, or CloudKit change token through this path.
- Added guarded desktop packaging for the native CloudKit helper: only a signed `.app` whose CloudKit container, team, and APNs entitlements pass verification can be staged outside `app.asar`; packaged apps auto-discover it through a redacted manifest, while unsigned builds keep the polling fallback without bundling an unverified helper.
- Updated README, Docker Compose, user install guide, release notes, promotion kit, security policy, and roadmap to the `v0.1.5-alpha` release line.

## 0.1.4-alpha.0

Release candidate for the next public alpha. Do not advertise as publicly available until the tag, packages, Docker image, and release notes are published.

- Expanded Studio problem blueprints with a larger template variant library for ledgers, planners, organizers, habits, calculators, forms, workflows, lookups, and general tasks.
- Added generated-tool quality scoring, acceptance criteria, failure triggers, and guarded auto-repair/manual-review boundaries before app generation.
- Added Studio UI and i18n coverage for quality score, automatic repair limits, manual-review signals, and post-repair verification.
- Added a structured Studio auto-repair readiness gate so each queued repair records passed checks, failed checks, rollback readiness, and whether Studio may safely resume it.
- Added a structured Studio auto-repair execution session for low-risk repairs, including worker steps, completion endpoint, rollback version, smoke checks, and blocked-session metadata for high-risk or retry-limited repairs.
- Added Studio auto-repair smoke review records so applied repairs stay visible until a passed/failed smoke check is audited; failed smoke checks recommend rollback and block further unattended repair.
- Added a conservative server-side static smoke gate for low-risk Studio auto-repairs; when requested, completion can automatically record pass/fail smoke evidence, clear safe repairs from the queue, and keep unsafe repairs in review.
- Added automatic rollback for failed server-side static smoke reviews so a low-risk Studio auto-repair can restore the recorded safe version without waiting for manual cleanup.
- Added mobile offline queue sync identity with mutation IDs, idempotency keys, client sequence numbers, visible sync stages, and backup metadata for weak-network recovery.
- Added duplicate-safe chat write-back so replayed offline messages with the same idempotency key return the existing SQLite message instead of creating duplicates.
- Added an opt-in macOS Apple Calendar/System Reminders connector path with explicit admin confirmation, rollback guidance, audit logging, and tests; Apple Calendar now supports gated create/update/delete, Reminders supports gated create/update/complete/delete.
- Added a guarded Google Calendar/Google Tasks connector path with OAuth refresh-token reads, explicitly confirmed create/update/delete/complete operations, rollback guidance, audit summaries, and a `calendar:acceptance` runbook for real-account evidence before public sync claims.
- Added read-only macOS Apple Calendar/System Reminders external preview so connector-enabled diagnostics can inspect upcoming events and open reminders without enabling external writes.
- Added persistent SQLite calendar/task write history and a guarded rollback API/UI so explicitly confirmed external writes keep a reviewable record, rollback availability, and automatic rollback for safe create/update/delete reversals.
- Added persistent calendar/task sync run evidence with conflict summaries, blocked-write reasons, rollback-review signals, and next-step guidance without claiming full unattended two-way sync.
- Added two-way calendar/task acceptance evidence gates so a sync run is completed only after external read, guarded write, rollback evidence, connector readiness, and conflict review are all proven.
- Added guarded task-completion rollback so completed Google Tasks and system Reminders can be restored through an audited update that brings back the captured title, time, notes, and unfinished status.
- Added a guarded native automation path for opening allowlisted macOS app bundle IDs with explicit consent, exact allowlist matching, audit logging, and blocked malformed bundle IDs.
- Added release-check and smoke-test guards so README/Release communication cannot claim fully automatic unattended repair, native automation, or calendar/task write-back before matching code, tests, cleanup evidence, and release assets exist.
- Added a stricter release-promotion truth guard that requires a complete macOS, Windows, and Linux artifact manifest plus `SHA256SUMS` before public upload.
- Tightened long-term remote acceptance records so each real-world scenario requires scenario-specific proof instead of accepting generic notes.
- Added a release-promotion remote acceptance evidence guard so public promotion requires stable HTTPS plus cellular, network-switch, restart, stale-QR, tunnel-interruption, and diagnostic-export evidence.
- Tightened the remote acceptance promotion gate so every real-world scenario must have fresh coverage, useful proof text, and a diagnostic-bundle redaction review before public release.
- Added remote long-run health samples so scheduled/manual remote checks keep recent pass/fail, recovery, consecutive-success, and observed-duration evidence in diagnostics without replacing the required real phone acceptance checks.
- Added explicit desktop auto-update feed opt-in state: safe `LIFEOS_UPDATE_URL` alone keeps manual updates, while `LIFEOS_ENABLE_DESKTOP_AUTO_UPDATE=1` marks the HTTPS feed as ready in diagnostics and the admin update card.
- Extended `calendar:acceptance` with a macOS Apple Calendar/System Reminders provider so real-account/device read/write evidence can be generated for both Google and macOS connector paths.

## 0.1.3-alpha.0

Public alpha aligned to the latest main branch and prepared for a fresh `v0.1.3-alpha` Release.

- Bumped the public Docker alpha path to `v0.1.3-alpha`.
- Added Studio generated-program template matching, version/rollback planning, and category-specific repair prompts.
- Added offline queue duplicate/conflict-risk detection, visible mobile health guidance, and conflict counts in queue backups.
- Added a local-action capability matrix so URL Scheme, browser, and iOS Shortcuts bridge boundaries are visible before use.
- Kept desktop distribution unsigned by policy for this alpha and documented manual download plus SHA256 verification.
- Clarified that automatic updates, formal signing/notarization, Apple/Google/system reminder write-back, and full native automation remain future work.

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
