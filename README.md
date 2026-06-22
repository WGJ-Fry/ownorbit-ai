# LifeOS AI

> **A local-first personal AI memory assistant.**
> It reads your own Markdown notes, runs with local Ollama, and answers one useful question:
> **“What am I forgetting?”**

[中文说明](README.zh-CN.md) | [Quick Start](#quick-start-docker--ollama--markdown) | [Feature Map](#feature-map) | [Remote Phone Access](#remote-phone-access) | [Current Limits](#current-limits)

[![Quality Gate](https://github.com/WGJ-Fry/lifeos-ai/actions/workflows/quality.yml/badge.svg)](https://github.com/WGJ-Fry/lifeos-ai/actions/workflows/quality.yml)
[![Docker Image](https://github.com/WGJ-Fry/lifeos-ai/actions/workflows/docker.yml/badge.svg)](https://github.com/WGJ-Fry/lifeos-ai/actions/workflows/docker.yml)
[![Release](https://img.shields.io/github/v/release/WGJ-Fry/lifeos-ai?include_prereleases&label=release)](https://github.com/WGJ-Fry/lifeos-ai/releases)
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)

<p align="center">
  <img src="docs/assets/readme/lifeos-readme-hero-en.svg" alt="LifeOS AI local-first personal AI memory assistant" width="100%">
</p>

## 10-Second Summary

LifeOS AI is not another empty chat box. It is a private AI core that helps you discover the commitments, deadlines, renewals, and loose ends already scattered through your own notes.

- **Input:** plain `.md` files in a local Markdown vault.
- **Runtime:** Docker Compose + Ollama `llama3.2` for the fastest alpha demo.
- **Output:** practical reminders for things you may have forgotten.
- **Direction:** desktop private core + paired mobile PWA + safe local actions.

The current public alpha is intentionally narrow: put notes in a folder, run LifeOS locally, and ask:

```text
What am I forgetting?
```

## Why LifeOS Is Different

Most AI assistants wait for you to remember the right prompt. LifeOS starts from a messier, more realistic place: your personal memory is spread across notes, dates, promises, and half-finished thoughts.

LifeOS is designed to become the **forgotten-item discovery layer** over your own data:

- You do not need to migrate into a proprietary note system.
- You do not need to upload your private notes to a cloud AI service for the alpha demo.
- You do not need to remember to create a reminder before LifeOS can help.

## Feature Map

<p align="center">
  <img src="docs/assets/readme/lifeos-feature-map-en.svg" alt="LifeOS AI feature map" width="100%">
</p>

LifeOS is being built as a full personal AI system, but the README separates **what works today** from **where the platform is going**:

| Area | Status | What it means |
| --- | --- | --- |
| Markdown memory recall | Alpha path | Ask what you may be forgetting from local notes. |
| Local model quickstart | Alpha path | Docker Compose starts Ollama and LifeOS locally. |
| Desktop private core | Early release path | Admin auth, SQLite, AI provider settings, backups, diagnostics. |
| Mobile PWA companion | Early release path | Paired phone, offline queue, device page, local action center. |
| Remote phone access | In progress | LAN, Tailscale/VPN, Cloudflare Tunnel guidance and diagnostics. |
| Generated problem-solving programs | Experimental Studio path | Generate runnable tools for specific problems, then keep refining them. |

## Quick Start: Docker + Ollama + Markdown

Use this path if you want the fastest reproducible alpha experience.

### Requirements

- Git
- Docker
- Docker Compose

First startup can take several minutes because `ollama-pull` downloads `llama3.2`. The `lifeos` service waits until the model pull service completes.

```bash
git clone https://github.com/WGJ-Fry/lifeos-ai.git
cd lifeos-ai

mkdir -p lifeos_vault lifeos_data

cat > lifeos_vault/demo.md <<'EOF'
# Demo memory

- Passport expires in 47 days.
- Project proposal for Tom is due tomorrow.
- Tax filing deadline is in 12 days.
EOF

docker compose up -d
```

Open:

```text
http://localhost:8080/admin/login
```

Default demo password:

```text
lifeos-local-demo
```

Then open chat and ask:

```text
What am I forgetting?
```

Expected result: LifeOS should mention the passport expiry, Tom’s project proposal, and the tax filing deadline from `lifeos_vault/demo.md`.

<p align="center">
  <img src="docs/assets/real-demo.gif" alt="LifeOS local Markdown demo asking what am I forgetting" width="420">
</p>

## What Starts In Docker

| Service | Purpose |
| --- | --- |
| `ollama` | Runs the local model server. |
| `ollama-pull` | Downloads `llama3.2` once before LifeOS starts. |
| `lifeos` | Runs the LifeOS web UI and API server. |

The default Compose file binds LifeOS to the local computer:

```text
127.0.0.1:8080 -> lifeos:3000
```

This Docker quickstart is for a local browser demo. For phone access outside the same network, use the desktop/mobile connection guide described below.

## Markdown Vault Contract

LifeOS reads your mounted Markdown folder. It does not write back to the vault in this alpha path.

| Item | Current behavior |
| --- | --- |
| Host folder | `./lifeos_vault` |
| Container path | `/app/vault` |
| File type | `.md` |
| Hidden folders | Skipped |
| `node_modules` | Skipped |
| Default max files | `30` |
| Default chars per file | `3000` |
| Default total chars | `60000` |

Relevant environment variables:

```text
LIFEOS_VAULT_DIR=/app/vault
LIFEOS_VAULT_MAX_FILES=30
LIFEOS_VAULT_MAX_CHARS_PER_FILE=3000
LIFEOS_VAULT_MAX_TOTAL_CHARS=60000
```

## Generated Problem-Solving Programs

<p align="center">
  <img src="docs/assets/readme/lifeos-generated-programs-en.svg" alt="LifeOS generates runnable programs for concrete problems" width="100%">
</p>

LifeOS Studio is the experimental workbench for turning a real need into a small runnable tool.

This is not just “generate a small app from a prompt.” The goal is:

> When you have a concrete need like budgeting, planning, lookup, sorting, check-ins, calculations, forms, or workflow panels, LifeOS generates a runnable program that helps you solve that problem and lets you keep debugging it.

This feature is part of the desktop Studio path, not the minimal Docker Markdown demo.

## Remote Phone Access

<p align="center">
  <img src="docs/assets/readme/lifeos-remote-access-en.svg" alt="LifeOS remote phone access with LAN, Tailscale VPN, and Cloudflare Tunnel" width="100%">
</p>

The long-term product direction is: your computer runs the private AI core, and your phone connects back as the everyday companion.

Supported and planned connection modes:

- **LAN:** fastest when the phone and computer are on the same Wi-Fi.
- **Tailscale / VPN:** recommended for long-term personal remote access.
- **Cloudflare Tunnel:** useful for HTTPS public entry testing and remote access setup.

Safety rule: do not expose the desktop core directly to the public internet without admin auth, HTTPS, backups, and diagnostics. LifeOS includes public-mode warnings, URL safety checks, device binding, and connection diagnostics to reduce accidental exposure.

## AI Providers

The Docker alpha uses local Ollama by default:

```text
LIFEOS_ACTIVE_AI_PROVIDER=local
LOCAL_MODEL_NAME=llama3.2
LOCAL_MODEL_BASE_URL=http://ollama:11434/v1
```

The desktop/admin path includes provider configuration work for local models, Gemini, OpenAI, and OpenRouter-style endpoints. Sensitive keys are intended to stay server-side and out of frontend storage, backups, logs, and API responses.

## Desktop App Status

LifeOS also includes an Electron desktop shell and mobile PWA companion.

Current public status:

- Docker Compose is the recommended first alpha experience.
- macOS unsigned ZIP has been used as the early desktop distribution path.
- Windows NSIS and Linux AppImage packaging are wired up but still require real install verification before being promoted as the main user path.
- Signed and notarized macOS distribution is a later release step.

## Troubleshooting

Check containers:

```bash
docker compose ps
```

View logs:

```bash
docker compose logs -f ollama
docker compose logs -f lifeos
```

Restart from scratch:

```bash
docker compose down -v
rm -rf lifeos_data lifeos_vault
```

Common issues:

- **The page is not ready yet:** wait for `ollama-pull` to finish downloading `llama3.2`.
- **Port conflict:** change the host side of `127.0.0.1:8080:3000` in `docker-compose.yml`.
- **The answer ignores the demo notes:** confirm `lifeos_vault/demo.md` exists before starting Compose.

## Current Limits

This is an alpha release.

- The Docker demo focuses on local Markdown memory recall.
- It does not connect to your real calendar yet.
- It does not write back to calendars or task managers.
- It is not a perfect deadline detector.
- It reads a limited number of Markdown files for speed and context size.
- Desktop/mobile remote use is more advanced than the Docker local demo.

## Development

```bash
npm ci
npm run build
npm test
```

Quality gate:

```bash
npm run quality:gate
```

Docker image tag:

```text
ghcr.io/wgj-fry/lifeos-ai:v0.1.1-alpha
```

Note: the release tag is `v0.1.1-alpha`; the package version is `0.1.1-alpha.0`.

## Roadmap

Near-term:

- Better Markdown memory extraction and source references.
- Weekly and monthly “what am I forgetting?” summaries.
- Reminder status: handled, snoozed, ignored.
- Calendar read-only ingestion.
- Stronger desktop distribution for macOS, Windows, and Linux.
- Safer remote phone setup through Tailscale/VPN and Cloudflare Tunnel.

Later:

- Calendar/task write-back.
- More local action integrations.
- Studio-generated tools as a bridge from reminder to action.
- Plugin-style memory sources and action outputs.

## License

MIT
