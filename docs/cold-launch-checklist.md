# OwnOrbit v0.1.5-alpha Cold Launch Checklist

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
- [ ] `docs/assets/real-demo-en.gif` exists for the English README.
- [ ] `docs/assets/real-demo.gif` exists for the Chinese README.
- [ ] `package.json` is `0.1.5-alpha.0`, `private: false`, and `MIT`.
- [ ] GitHub repository description is set.
- [ ] GitHub Discussions is enabled.
- [ ] No older stable Release below the current recommended version appears as GitHub Latest.
- [ ] `v0.0.0` is deprecated or removed.
- [ ] `Dockerfile` exists and builds the app.
- [ ] `docker-compose.yml` points to `ghcr.io/wgj-fry/lifeos-ai:v0.1.5-alpha`.
- [ ] `LOCAL_MODEL_BASE_URL=http://ollama:11434/v1`.
- [ ] `LIFEOS_QUICKSTART=1`.
- [ ] `LIFEOS_ADMIN_PASSWORD=lifeos-local-demo`.
- [ ] `LIFEOS_VAULT_DIR=/app/vault`.

Security note: `lifeos-local-demo` is only acceptable for the local quickstart because Compose binds the app to `127.0.0.1`. Change `LIFEOS_ADMIN_PASSWORD` before LAN, VPN, tunnel, or public testing.

## Local Verification

```bash
npm ci
npm run lint
npm run build
```

Docker is required for the next checks:

```bash
docker build -t ghcr.io/wgj-fry/lifeos-ai:v0.1.5-alpha .

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
git push origin v0.1.5-alpha
```

After the tag is pushed:

- [ ] GitHub Actions -> Docker Image is green.
- [ ] GHCR package is public.
- [ ] `npm run github:public:check` passes, or `GITHUB_TOKEN=... npm run github:public:fix` has been run with sufficient permissions.
- [ ] Anonymous pull succeeds:

```bash
docker logout ghcr.io || true
docker pull ghcr.io/wgj-fry/lifeos-ai:v0.1.5-alpha
```

Automated equivalent:

```bash
LIFEOS_CHECK_GHCR=1 npm run check:cold-launch
```

Create GitHub Release:

```text
Tag: v0.1.5-alpha
Title: v0.1.5-alpha: Ask "What am I forgetting?" from local Markdown notes
Body: docs/release-notes-v0.1.5-alpha.md
```

Before announcing on Reddit, Hacker News, Product Hunt, or Chinese communities, the public Release must be visible without authentication:

```bash
LIFEOS_CHECK_GHCR=1 LIFEOS_CHECK_GITHUB_RELEASE=1 npm run check:cold-launch
```

If this fails with `GitHub public Release is not visible`, publish the generated Release draft or create the `v0.1.5-alpha` Release before sharing the README.

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
