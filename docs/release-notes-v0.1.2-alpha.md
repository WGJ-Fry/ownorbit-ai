# LifeOS v0.1.2-alpha

LifeOS v0.1.2-alpha is a previous public cold-launch alpha. It is superseded by [`v0.1.3-alpha`](https://github.com/WGJ-Fry/lifeos-ai/releases/tag/v0.1.3-alpha).

It keeps the one-minute Docker Compose path focused:

> Read a mounted local Markdown folder, optionally include local `.ics` calendar/task files, and answer: **"What am I forgetting?"**

It also includes the latest safety and mobile reliability work from the main branch.

Note: the source line now includes additional local memory and Studio blueprint hardening. If you are using an older downloaded desktop asset from this same alpha line, rebuild from source or wait for refreshed release assets before expecting those source-only additions in the desktop package.

## Included

- Docker Compose quickstart
- Bundled Ollama service
- Automatic `llama3.2` pull
- Local Markdown vault ingestion
- Structured Markdown memory signals for deadlines, renewals, promises, tasks, and appointments
- Optional read-only local `.ics` calendar/task ingestion for upcoming `VEVENT` events and open dated `VTODO` tasks
- Quickstart onboarding mode
- Local provider forced through environment variables
- No cloud API key required
- Mobile credential expiry guidance
- IndexedDB-first mobile pairing credentials
- Redacted local action and diagnostic metadata
- First-launch handoff summary copy
- Source-line Studio blueprint confirmation checklist, permission notes, and failure recovery guidance
- Long-term remote acceptance now tracks real phone cellular use, phone Wi-Fi/cellular switching, stale QR/home-screen repair, restart restore, network interruption, and diagnostic export evidence

## Try It

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

This demo password is only for the local Docker quickstart. The Compose file binds LifeOS to `127.0.0.1`; change `LIFEOS_ADMIN_PASSWORD` before any LAN, VPN, tunnel, or public exposure test.

Ask:

```text
What am I forgetting?
```

LifeOS should mention the passport expiry, Tom's project proposal, and the tax filing deadline from `./lifeos_vault/demo.md`.

## Current Limits

- Markdown and optional local `.ics` calendar/task files only in the cold-launch memory demo
- No Apple Calendar, Google Calendar, or system reminders account sync yet
- No calendar write-back yet
- Studio generated programs still run as alpha helper apps, not a full native automation system
- Alpha quality
- First run can be slow because Ollama downloads the model
- Desktop installers are still tracked separately from this Docker alpha
