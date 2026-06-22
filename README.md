# LifeOS

> LifeOS helps you answer one question every day: **"What am I forgetting?"**

[![Quality Gate](https://github.com/WGJ-Fry/lifeos-ai/actions/workflows/quality.yml/badge.svg)](https://github.com/WGJ-Fry/lifeos-ai/actions/workflows/quality.yml)
[![Release](https://img.shields.io/github/v/release/WGJ-Fry/lifeos-ai?include_prereleases&label=release)](https://github.com/WGJ-Fry/lifeos-ai/releases)
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)

<p align="center">
  <img src="docs/assets/real-demo.gif" alt="LifeOS real demo" width="100%">
</p>

<p align="center">
  <a href="#quick-start">Quick Start</a> -
  <a href="#what-it-does-today">What It Does Today</a> -
  <a href="#how-it-works">How It Works</a> -
  <a href="#current-limits">Current Limits</a>
</p>

---

## Your notes remember nothing. LifeOS does.

You have fragments of tasks, promises, renewals, and dates scattered across Markdown files.

LifeOS runs locally with Ollama, reads your mounted Markdown folder, and helps surface the things slipping through the cracks.

No cloud required. No API key required. Your notes stay plain Markdown.

## Quick Start

Requires Docker and Docker Compose.

First run may take longer while Ollama downloads `llama3.2`. After the model is cached, startup is much faster.

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

Password:

```text
lifeos-local-demo
```

Then go to chat and ask:

```text
What am I forgetting?
```

Expected result:

```text
LifeOS should mention the passport expiry, Tom's project proposal,
and the tax filing deadline from your local Markdown file.
```

## What It Does Today

LifeOS v0.1.1-alpha does exactly one thing:

> It scans your mounted local Markdown folder and answers: **"What am I forgetting?"**

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
LifeOS + Ollama
        |
        v
"What am I forgetting?"
```

Under the hood:

```text
./lifeos_vault/*.md
        |
        v
LifeOS server reads local Markdown
        |
        v
Prompt context is sent to local Ollama
        |
        v
llama3.2 returns likely forgotten items
```

The Docker quickstart starts three services:

- `ollama`: local model runtime.
- `ollama-pull`: one-shot `llama3.2` downloader.
- `lifeos`: the LifeOS web app and local core.

All exposed ports are bound to `127.0.0.1` by default.

## Current Limits

This is an alpha release.

- It only scans local Markdown files.
- It does not connect to your real calendar yet.
- It does not write back to your calendar or tasks.
- It is not a perfect deadline detector.
- It reads a limited number of Markdown files for speed and context size.

The goal of this release is simple:

```text
Write notes -> run locally -> ask "What am I forgetting?" -> get useful reminders.
```

## Configuration

The default `docker-compose.yml` uses:

```text
LIFEOS_QUICKSTART=1
LIFEOS_ADMIN_PASSWORD=lifeos-local-demo
LIFEOS_ACTIVE_AI_PROVIDER=local
LOCAL_MODEL_NAME=llama3.2
LOCAL_MODEL_BASE_URL=http://ollama:11434/v1
LIFEOS_VAULT_DIR=/app/vault
```

Your notes live in:

```text
./lifeos_vault
```

LifeOS data lives in:

```text
./lifeos_data
```

## Docker Image

After the `v0.1.1-alpha` tag is published, the image will be:

```text
ghcr.io/wgj-fry/lifeos-ai:v0.1.1-alpha
```

## Future Direction

- Weekly and monthly timeline summaries.
- Calendar ingestion.
- Local proactive reminders.
- Better structured memory extraction.

## License

MIT
