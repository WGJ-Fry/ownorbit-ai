# LifeOS

> A local AI that answers: **"What am I forgetting?"**

[中文说明](README.zh-CN.md) | [Quick Start](#quick-start) | [Current Limits](#current-limits) | [License](#license)

[![Quality Gate](https://github.com/WGJ-Fry/lifeos-ai/actions/workflows/quality.yml/badge.svg)](https://github.com/WGJ-Fry/lifeos-ai/actions/workflows/quality.yml)
[![Docker Image](https://github.com/WGJ-Fry/lifeos-ai/actions/workflows/docker.yml/badge.svg)](https://github.com/WGJ-Fry/lifeos-ai/actions/workflows/docker.yml)
[![Release](https://img.shields.io/github/v/release/WGJ-Fry/lifeos-ai?include_prereleases&label=release)](https://github.com/WGJ-Fry/lifeos-ai/releases)
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)

<p align="center">
  <img src="docs/assets/real-demo.gif" alt="LifeOS real demo" width="100%">
</p>

## What Is LifeOS?

LifeOS is an open-source, local-first personal AI system.

The first alpha focuses on one simple question:

> **What am I forgetting?**

It reads your mounted local Markdown folder, runs with Ollama, and surfaces forgotten deadlines, promises, renewals, and tasks.

No cloud API key required.<br>
No proprietary note format.<br>
Your notes stay as plain Markdown.

## Quick Start

Requires:

- Git
- Docker
- Docker Compose

First run may take longer because Ollama downloads `llama3.2`. After the model is cached, startup is much faster.

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

Default password:

```text
lifeos-local-demo
```

Then open chat and ask:

```text
What am I forgetting?
```

Expected result:

```text
LifeOS should mention the passport expiry, Tom's project proposal,
and the tax filing deadline from your local Markdown file.
```

## What It Does Today

LifeOS `v0.1.1-alpha` does exactly one thing:

> It scans a mounted local Markdown folder and answers: **"What am I forgetting?"**

Example:

```text
User:
What am I forgetting?

LifeOS:
You might be forgetting:

- Passport renewal: expires in 47 days.
- Project proposal for Tom: due tomorrow.
- Tax filing deadline: in 12 days.
```

## How It Works

```text
Local Markdown Notes
        |
        v
LifeOS Server
        |
        v
Local Ollama / llama3.2
        |
        v
"What am I forgetting?"
```

Docker quickstart runs three services:

```text
ollama
ollama-pull
lifeos
```

The `lifeos` container reads:

```text
./lifeos_vault
```

and stores app data in:

```text
./lifeos_data
```

## Docker Image

The quickstart uses the published GHCR image:

```text
ghcr.io/wgj-fry/lifeos-ai:v0.1.1-alpha
```

The Docker workflow builds this image from the repository Dockerfile with `docker/build-push-action@v6`.

The Dockerfile uses:

```text
node:24-bookworm-slim
npm ci
npm run build
```

## Configuration

The Docker quickstart uses:

```text
LIFEOS_QUICKSTART=1
LIFEOS_ADMIN_PASSWORD=lifeos-local-demo
LIFEOS_ACTIVE_AI_PROVIDER=local
LOCAL_MODEL_NAME=llama3.2
LOCAL_MODEL_BASE_URL=http://ollama:11434/v1
LIFEOS_VAULT_DIR=/app/vault
```

Ollama is used through its OpenAI-compatible `/v1/chat/completions` API.

## Current Limits

This is an alpha release.

- It only scans local Markdown files.
- It does not connect to your real calendar yet.
- It does not write back to your calendar or task manager.
- It is not a perfect deadline detector.
- It reads a limited number of Markdown files for speed and context size.
- The desktop app and mobile PWA still exist, but this Docker quickstart is focused on the local Markdown memory demo.

The goal of this release is simple:

```text
Write notes
|
v
Run locally
|
v
Ask "What am I forgetting?"
|
v
Get useful reminders
```

## Desktop App Status

LifeOS also includes a desktop core and a mobile PWA companion.

Current public desktop release:

- macOS Apple Silicon unsigned ZIP is available in GitHub Releases.
- Windows NSIS and Linux AppImage builds are still being verified before public upload.
- Signed and notarized macOS distribution is not ready yet.

For the first alpha experience, Docker Compose is the recommended path.

## Troubleshooting

### Check Containers

```bash
docker compose ps
```

### View Logs

```bash
docker compose logs -f lifeos
docker compose logs -f ollama
```

### Restart From Scratch

```bash
docker compose down -v
rm -rf lifeos_data lifeos_vault

mkdir -p lifeos_vault lifeos_data

cat > lifeos_vault/demo.md <<'EOF'
# Demo memory

- Passport expires in 47 days.
- Project proposal for Tom is due tomorrow.
- Tax filing deadline is in 12 days.
EOF

docker compose up -d
```

### Pull The Image Manually

```bash
docker pull ghcr.io/wgj-fry/lifeos-ai:v0.1.1-alpha
```

## Roadmap

Near-term:

- Improve Markdown memory extraction.
- Add weekly and monthly summaries.
- Add calendar ingestion.
- Add local proactive reminders.
- Improve desktop distribution for macOS, Windows, and Linux.

Not in this alpha:

- Multi-agent orchestration.
- Plugin marketplace.
- Calendar write-back.
- Mobile-first onboarding.
- Cloud sync.

## License

MIT
