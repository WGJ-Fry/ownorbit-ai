# LifeOS AI

> **A local-first personal AI system for memory, action, and problem-solving tools.**
>
> Your computer runs the private AI core. Your phone becomes the everyday companion.

[中文说明](README.zh-CN.md) | [Quick Start](#2-minute-quick-start) | [Generated Programs](#generated-problem-solving-programs) | [Remote Access](#remote--vpn-access) | [Current Limits](#current-alpha-limits)

[![Quality Gate](https://github.com/WGJ-Fry/lifeos-ai/actions/workflows/quality.yml/badge.svg)](https://github.com/WGJ-Fry/lifeos-ai/actions/workflows/quality.yml)
[![Docker Image](https://github.com/WGJ-Fry/lifeos-ai/actions/workflows/docker.yml/badge.svg)](https://github.com/WGJ-Fry/lifeos-ai/actions/workflows/docker.yml)
[![Release](https://img.shields.io/github/v/release/WGJ-Fry/lifeos-ai?include_prereleases&label=release)](https://github.com/WGJ-Fry/lifeos-ai/releases)
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)

<p align="center">
  <img src="docs/assets/readme/lifeos-readme-hero-en.svg" alt="LifeOS AI local-first personal AI assistant" width="100%">
</p>

LifeOS starts with one small but useful workflow:

```text
What am I forgetting?
```

It reads local Markdown notes, runs with local Ollama in the alpha demo, and surfaces commitments, deadlines, renewals, and unfinished work that might otherwise slip through the cracks.

It is not just a hosted chatbot. The larger direction is a private personal AI layer: memory recall, desktop admin, paired phone access, safe local actions, VPN/tunnel remote use, and small programs generated for the problem you are solving now.

## 10-Second Summary

- **Personal AI assistant:** helps you remember, plan, connect, and act.
- **Local-first alpha:** reads `.md` files from a folder you control.
- **Fastest demo path:** Docker Compose + Ollama `llama3.2`.
- **Phone direction:** desktop core + mobile PWA companion.
- **Remote direction:** LAN, Tailscale/VPN, and Cloudflare Tunnel setup guidance.
- **Studio direction:** generate runnable tools for budgeting, planning, lookup, sorting, forms, calculation, and workflow panels.

Current alpha promise: put Markdown notes in a folder, run LifeOS locally, and ask what you may have missed.

## Choose Your Path

| Path | Use this when | Current public status |
| --- | --- | --- |
| **Docker Compose alpha** | You want the fastest local demo with Ollama and Markdown notes. | Recommended first try. Uses `ghcr.io/wgj-fry/lifeos-ai:v0.1.1-alpha`. |
| **macOS desktop ZIP** | You want to try the early desktop shell. | Available in the [`v0.1.0` Release](https://github.com/WGJ-Fry/lifeos-ai/releases/tag/v0.1.0): `LifeOS.AI-0.1.0-arm64-unsigned.zip`. |
| **Windows / Linux desktop packages** | You want native installers for those systems. | Packaging and CI smoke checks exist, but public EXE/AppImage downloads are not uploaded yet. |

If you are new, start with Docker Compose below. If you specifically want the desktop app, use the macOS ZIP release and read `INSTALL-unsigned-mac.md` before first launch.

## Real Product Screens

These are real screens from the current project, not concept art.

<p align="center">
  <img src="public/screenshots/en-admin-onboarding.jpg" alt="LifeOS desktop first launch guide and security check" width="49%">
  <img src="public/screenshots/en-mobile-device.jpg" alt="LifeOS mobile device and connection page" width="24%">
</p>

<p align="center">
  <img src="public/screenshots/en-connection-tunnel-vpn.jpg" alt="LifeOS remote connection guide with Cloudflare Tunnel and Tailscale VPN" width="74%">
</p>

## Why Star This

Most AI tools wait for you to remember the right prompt. LifeOS starts from the mess you already have: scattered notes, dates, promises, renewals, ideas, and unfinished work.

LifeOS is interesting because it combines three directions:

1. **Memory discovery:** find forgotten commitments and deadlines from your own data.
2. **Local-first AI:** keep the first useful workflow on your machine without requiring a cloud API key.
3. **Generated tools:** move from “the AI told me something” to “the AI made a small tool that helps me handle it.”

The public alpha proves the first slice. The project direction is larger: a private personal AI operating layer.

## Feature Map

<p align="center">
  <img src="docs/assets/readme/lifeos-feature-map-en.svg" alt="LifeOS AI feature map from personal memory to useful action" width="100%">
</p>

| Area | Current status |
| --- | --- |
| Local Markdown reading | Works in the Docker alpha path |
| Ollama local model | Works through Docker Compose |
| “What am I forgetting?” chat | Works for mounted Markdown notes |
| Admin login and security diagnostics | Included in the desktop/server path |
| Desktop app shell | Early distribution path |
| Mobile companion | In progress / early path |
| Remote access guidance | LAN, Tailscale/VPN, Cloudflare Tunnel diagnostics are being built out |
| Generated programs | Experimental Studio path |

The alpha is best understood as a working local memory demo, not a finished personal operating system.

## Generated Problem-Solving Programs

<p align="center">
  <img src="docs/assets/readme/lifeos-generated-programs-en.svg" alt="LifeOS generates runnable programs for concrete problems" width="100%">
</p>

LifeOS Studio is the experimental path for turning a concrete need into a small runnable program.

This is not just “generate an app from a prompt.” The goal is more practical:

> When LifeOS finds or receives a real problem, it should be able to create a focused tool that helps you work through it.

Examples:

- A renewal tracker from scattered subscription notes.
- A trip checklist from messages and plans.
- A budget calculator for a specific month.
- A follow-up board for people you promised to contact.
- A tiny workflow panel for repeated local actions.

Status: experimental desktop Studio path. It is not part of the minimal Docker Markdown demo yet.

## 2-Minute Quick Start

Requirements:

- Git
- Docker
- Docker Compose

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

Demo password:

```text
lifeos-local-demo
```

Ask:

```text
What am I forgetting?
```

Expected result: LifeOS should mention the passport expiry, Tom’s proposal, and the tax filing deadline from `lifeos_vault/demo.md`.

First startup can take several minutes because Ollama downloads `llama3.2`.

<p align="center">
  <img src="docs/assets/real-demo-en.gif" alt="LifeOS local Markdown demo asking what am I forgetting" width="420">
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

This Docker quickstart is for a local browser demo. It does not automatically make the system reachable from your phone outside the local machine.

## Remote & VPN Access

<p align="center">
  <img src="docs/assets/readme/lifeos-remote-access-en.svg" alt="LifeOS remote phone access with LAN, Tailscale VPN, and Cloudflare Tunnel" width="100%">
</p>

LifeOS is designed for this model:

```text
Your computer = private AI core
Your phone = companion client
Connection = LAN, VPN, or a carefully configured tunnel
```

| Mode | Best for | Notes |
| --- | --- | --- |
| Same Wi-Fi / LAN | Quick phone testing at home | Phone and computer must be on the same network. |
| Tailscale / VPN | Recommended personal remote access | Safer long-term option because the service stays private to your devices. |
| Cloudflare Tunnel | HTTPS remote testing | Useful, but should be configured carefully with auth and public exposure warnings. |
| Direct public port | Not recommended | Do not expose the desktop core directly to the internet. |

Safety rule: before remote access, enable admin auth, use HTTPS or a private VPN path, understand which URL is public, and keep backups/diagnostics available.

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

## AI Providers

The Docker alpha uses local Ollama by default:

```text
LIFEOS_ACTIVE_AI_PROVIDER=local
LOCAL_MODEL_NAME=llama3.2
LOCAL_MODEL_BASE_URL=http://ollama:11434/v1
```

The desktop/admin path includes provider configuration work for local models, Gemini, OpenAI, and OpenRouter-style endpoints. Sensitive keys are intended to stay server-side and out of frontend storage, backups, logs, and API responses.

## Current Alpha Limits

LifeOS is alpha software.

- Markdown only in the main Docker demo.
- No real calendar ingestion yet.
- No calendar/task write-back yet.
- Not a perfect deadline detector.
- Reads a limited number of files for speed and context size.
- Desktop, mobile, remote access, and Studio-generated programs are earlier than the Docker demo path.

## Platform Vision

The long-term vision is a private personal AI operating layer:

- remembers what matters from your own data,
- notices what may need attention,
- connects safely from desktop to phone,
- runs local or user-chosen AI providers,
- generates focused tools for concrete problems,
- and eventually bridges reminders into safe local actions.

The alpha starts with memory because memory is the root problem: before an AI can act for you, it should help you notice what matters.

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

Docker image:

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
