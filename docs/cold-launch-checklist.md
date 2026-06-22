# LifeOS v0.1.1-alpha Cold Launch Checklist

This checklist is intentionally narrow. The alpha launch only needs to prove one path:

```text
git clone
docker compose up -d
login
ask "What am I forgetting?"
read ./lifeos_vault/demo.md
return passport, proposal, and tax deadline
```

## Repository Checks

- [ ] `README.md` is the focused English quickstart.
- [ ] `README.zh-CN.md` is the focused Chinese quickstart.
- [ ] `README.md` and `README.zh-CN.md` link to each other.
- [ ] `docs/assets/real-demo.gif` exists.
- [ ] `package.json` is `0.1.1-alpha.0`, `private: false`, and `MIT`.
- [ ] `Dockerfile` exists and builds the app.
- [ ] `docker-compose.yml` points to `ghcr.io/wgj-fry/lifeos-ai:v0.1.1-alpha`.
- [ ] `LOCAL_MODEL_BASE_URL=http://ollama:11434/v1`.
- [ ] `LIFEOS_QUICKSTART=1`.
- [ ] `LIFEOS_ADMIN_PASSWORD=lifeos-local-demo`.
- [ ] `LIFEOS_VAULT_DIR=/app/vault`.

## Local Verification

```bash
npm ci
npm run lint
npm run build
```

Docker is required for the next checks:

```bash
docker build -t ghcr.io/wgj-fry/lifeos-ai:v0.1.1-alpha .

docker compose down -v
rm -rf lifeos_vault lifeos_data

mkdir -p lifeos_vault lifeos_data

cat > lifeos_vault/demo.md <<'EOF'
# Demo memory

- Passport expires in 47 days.
- Project proposal for Tom is due tomorrow.
- Tax filing deadline is in 12 days.
EOF

docker compose up -d
docker compose ps
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

Required answer evidence:

- [ ] Passport expiry
- [ ] Tom proposal
- [ ] Tax deadline
- [ ] No `Gemini not configured` error
- [ ] Response comes from `./lifeos_vault/demo.md`

## GitHub Release Steps

```bash
git push origin main
git push origin v0.1.1-alpha
```

After the tag is pushed:

- [ ] GitHub Actions -> Docker Image is green.
- [ ] GHCR package is public.
- [ ] Anonymous pull succeeds:

```bash
docker logout ghcr.io || true
docker pull ghcr.io/wgj-fry/lifeos-ai:v0.1.1-alpha
```

Create GitHub Release:

```text
Tag: v0.1.1-alpha
Title: v0.1.1-alpha: Ask "What am I forgetting?" from local Markdown notes
Body: docs/release-notes-v0.1.1-alpha.md
```

## Blind Test

Use a clean machine with only:

- Git
- Docker
- Docker Compose

Do not install:

- Node
- Python
- Ollama
- API keys

Blind test passes only when the Docker quickstart works and returns the demo Markdown reminders.

