# LifeOS v0.1.2-alpha

LifeOS v0.1.2-alpha is the current public cold-launch alpha.

It keeps the one-minute Docker Compose path focused:

> Read a mounted local Markdown folder and answer: **"What am I forgetting?"**

It also includes the latest safety and mobile reliability work from the main branch.

## Included

- Docker Compose quickstart
- Bundled Ollama service
- Automatic `llama3.2` pull
- Local Markdown vault ingestion
- Quickstart onboarding mode
- Local provider forced through environment variables
- No cloud API key required
- Mobile credential expiry guidance
- IndexedDB-first mobile pairing credentials
- Redacted local action and diagnostic metadata
- First-launch handoff summary copy

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

- Markdown only in the cold-launch demo
- No calendar ingestion yet
- No calendar write-back yet
- Alpha quality
- First run can be slow because Ollama downloads the model
- Desktop installers are still tracked separately from this Docker alpha
