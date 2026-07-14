# LifeOS v0.1.1-alpha

LifeOS v0.1.1-alpha is a focused local-first alpha release.

It does one thing:

> Read a mounted local Markdown folder and answer: **"What am I forgetting?"**

## Included

- Docker Compose quickstart
- Bundled Ollama service
- Automatic `llama3.2` pull
- Local Markdown vault ingestion
- Quickstart onboarding mode
- Local provider forced through environment variables
- No cloud API key required

## Try It

```bash
git clone https://github.com/WGJ-Fry/ownorbit-ai.git
cd ownorbit-ai

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

Ask:

```text
What am I forgetting?
```

LifeOS should mention the passport expiry, Tom's project proposal, and the tax filing deadline from `./lifeos_vault/demo.md`.

## Current Limits

- Markdown only
- No calendar ingestion yet
- No calendar write-back
- Alpha quality
- First run can be slow because Ollama downloads the model

