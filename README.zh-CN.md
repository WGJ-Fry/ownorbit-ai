# LifeOS AI

> **本地优先的个人 AI 记忆管家。**
> 它读取你自己的 Markdown 笔记，使用本地 Ollama 运行，并先回答一个最有用的问题：
> **“我是不是忘了什么？”**

[English](README.md) | [快速开始](#快速开始docker--ollama--markdown) | [功能地图](#功能地图) | [手机异地连接](#手机异地连接) | [当前限制](#当前限制)

[![Quality Gate](https://github.com/WGJ-Fry/lifeos-ai/actions/workflows/quality.yml/badge.svg)](https://github.com/WGJ-Fry/lifeos-ai/actions/workflows/quality.yml)
[![Docker Image](https://github.com/WGJ-Fry/lifeos-ai/actions/workflows/docker.yml/badge.svg)](https://github.com/WGJ-Fry/lifeos-ai/actions/workflows/docker.yml)
[![Release](https://img.shields.io/github/v/release/WGJ-Fry/lifeos-ai?include_prereleases&label=release)](https://github.com/WGJ-Fry/lifeos-ai/releases)
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)

<p align="center">
  <img src="docs/assets/readme/lifeos-readme-hero-zh.svg" alt="LifeOS AI 本地优先个人 AI 记忆管家" width="100%">
</p>

## 10 秒看懂

LifeOS AI 不是一个空白聊天框。它是一个私有 AI 核心，帮助你从自己的笔记里发现可能被遗漏的承诺、截止日期、续期事项和未完成任务。

- **输入：** 本地 Markdown vault 里的普通 `.md` 文件。
- **运行：** 最快体验路径使用 Docker Compose + Ollama `llama3.2`。
- **输出：** 帮你找出可能忘掉的现实事项。
- **方向：** 电脑端私有核心 + 手机 PWA 随身入口 + 安全本地动作。

当前公开 alpha 版本刻意收窄：把笔记放进一个文件夹，本地启动 LifeOS，然后问：

```text
What am I forgetting?
```

## 为什么不一样

很多 AI 助手等你想起正确的问题。LifeOS 面向的是更真实的个人记忆场景：事情散落在笔记、日期、承诺和半完成想法里。

LifeOS 想成为你个人数据上的 **遗忘事项发现层**：

- 不需要迁移到专有笔记系统。
- alpha 演示不需要把私人笔记上传到云端 AI。
- 不需要你先想起要创建提醒，LifeOS 才能帮你。

## 功能地图

<p align="center">
  <img src="docs/assets/readme/lifeos-feature-map-zh.svg" alt="LifeOS AI 功能地图" width="100%">
</p>

LifeOS 正在被构建成一个完整的个人 AI 系统，但 README 会区分 **当前能跑什么** 和 **平台方向是什么**：

| 模块 | 状态 | 含义 |
| --- | --- | --- |
| Markdown 记忆提醒 | Alpha 路径 | 从本地笔记里询问“我是不是忘了什么”。 |
| 本地模型快速体验 | Alpha 路径 | Docker Compose 本地启动 Ollama 和 LifeOS。 |
| 电脑端私有核心 | 早期发布路径 | 管理员认证、SQLite、AI provider、备份、诊断。 |
| 手机 PWA 入口 | 早期发布路径 | 手机绑定、离线队列、设备页、本地动作中心。 |
| 手机异地连接 | 持续完善 | 局域网、Tailscale/VPN、Cloudflare Tunnel 向导和诊断。 |
| 自动生成解决问题的程序 | Studio 实验路径 | 针对当前问题生成可运行工具，并继续调试。 |

## 快速开始：Docker + Ollama + Markdown

如果你想最快跑通可复现的 alpha 体验，走这条路径。

### 需要准备

- Git
- Docker
- Docker Compose

首次启动可能需要几分钟，因为 `ollama-pull` 会下载 `llama3.2`。`lifeos` 服务会等模型拉取完成后再启动。

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

打开：

```text
http://localhost:8080/admin/login
```

默认演示密码：

```text
lifeos-local-demo
```

进入聊天后输入：

```text
What am I forgetting?
```

预期结果：LifeOS 应该从 `lifeos_vault/demo.md` 里提到护照过期、Tom 的项目提案和报税截止日期。

<p align="center">
  <img src="docs/assets/real-demo.gif" alt="LifeOS 本地 Markdown 演示，询问我是不是忘了什么" width="420">
</p>

## Docker 会启动什么

| 服务 | 作用 |
| --- | --- |
| `ollama` | 运行本地模型服务。 |
| `ollama-pull` | 启动前下载一次 `llama3.2`。 |
| `lifeos` | 运行 LifeOS Web UI 和 API server。 |

默认 Compose 只绑定到本机电脑：

```text
127.0.0.1:8080 -> lifeos:3000
```

这个 Docker quickstart 是电脑本机浏览器演示。如果要让手机在不同网络下访问，请使用下面的桌面端/手机端连接向导。

## Markdown Vault 读取规则

LifeOS 会读取你挂载的 Markdown 文件夹。当前 alpha 路径不会写回你的 vault。

| 项目 | 当前行为 |
| --- | --- |
| 电脑端文件夹 | `./lifeos_vault` |
| 容器内路径 | `/app/vault` |
| 文件类型 | `.md` |
| 隐藏文件夹 | 跳过 |
| `node_modules` | 跳过 |
| 默认最多文件数 | `30` |
| 默认每文件字符数 | `3000` |
| 默认总字符数 | `60000` |

相关环境变量：

```text
LIFEOS_VAULT_DIR=/app/vault
LIFEOS_VAULT_MAX_FILES=30
LIFEOS_VAULT_MAX_CHARS_PER_FILE=3000
LIFEOS_VAULT_MAX_TOTAL_CHARS=60000
```

## 自动生成解决问题的程序

<p align="center">
  <img src="docs/assets/readme/lifeos-generated-programs-zh.svg" alt="LifeOS 自动生成解决问题的程序" width="100%">
</p>

LifeOS Studio 是实验性的工作台，用来把一个真实需求变成一个小型可运行工具。

这不是“根据描述生成一个小程序”。目标是：

> 当你有记账、规划、查询、整理、打卡、计算、表单、流程面板等具体需求时，LifeOS 会根据当前问题生成可运行的程序来帮你处理，并支持继续调试。

这个能力属于桌面 Studio 路径，不是最小 Docker Markdown 演示路径。

## 手机异地连接

<p align="center">
  <img src="docs/assets/readme/lifeos-remote-access-zh.svg" alt="LifeOS 手机异地连接：局域网、Tailscale VPN、Cloudflare Tunnel" width="100%">
</p>

长期产品方向是：电脑运行私有 AI 核心，手机作为日常入口连接回来。

支持和规划中的连接模式：

- **局域网：** 手机和电脑在同一个 Wi-Fi 时最快。
- **Tailscale / VPN：** 推荐作为长期自用的异地连接方式。
- **Cloudflare Tunnel：** 适合 HTTPS 公网入口测试和远程访问配置。

安全原则：不要在没有管理员认证、HTTPS、备份和诊断的情况下直接把电脑端核心暴露到公网。LifeOS 已加入公网模式提示、URL 安全检查、设备绑定和连接诊断，用来降低误暴露风险。

## AI Provider

Docker alpha 默认使用本地 Ollama：

```text
LIFEOS_ACTIVE_AI_PROVIDER=local
LOCAL_MODEL_NAME=llama3.2
LOCAL_MODEL_BASE_URL=http://ollama:11434/v1
```

桌面/管理端路径包含本地模型、Gemini、OpenAI、OpenRouter 风格 endpoint 的配置能力。敏感 Key 设计目标是只留在后端，不进入前端存储、备份明文、日志和 API 响应。

## 桌面端状态

LifeOS 也包含 Electron 桌面壳和手机 PWA 伴侣。

当前公开状态：

- Docker Compose 是推荐的第一条 alpha 体验路径。
- macOS unsigned ZIP 是早期桌面分发路径。
- Windows NSIS 和 Linux AppImage 打包链路已接入，但还需要真实安装验证后再作为主路径推广。
- macOS 正式签名和公证是后续发布步骤。

## 常见排查

查看容器：

```bash
docker compose ps
```

查看日志：

```bash
docker compose logs -f ollama
docker compose logs -f lifeos
```

从零重启：

```bash
docker compose down -v
rm -rf lifeos_data lifeos_vault
```

常见问题：

- **页面还没打开：** 等 `ollama-pull` 下载完 `llama3.2`。
- **端口冲突：** 修改 `docker-compose.yml` 中 `127.0.0.1:8080:3000` 的 `8080`。
- **回答没有提到 demo 笔记：** 确认启动前已经创建 `lifeos_vault/demo.md`。

## 当前限制

这是 alpha 版本。

- Docker 演示聚焦本地 Markdown 记忆提醒。
- 还没有连接真实日历。
- 还不会写回日历或任务系统。
- 它不是完美的截止日期检测器。
- 为了速度和上下文长度，它只读取有限数量的 Markdown 文件。
- 桌面端/手机端异地使用比 Docker 本地演示更进阶。

## 开发

```bash
npm ci
npm run build
npm test
```

质量门禁：

```bash
npm run quality:gate
```

Docker 镜像：

```text
ghcr.io/wgj-fry/lifeos-ai:v0.1.1-alpha
```

说明：release tag 是 `v0.1.1-alpha`；package version 是 `0.1.1-alpha.0`。

## Roadmap

近期：

- 改进 Markdown 记忆提取和来源引用。
- 增加每周/月度“我是不是忘了什么”总结。
- 增加提醒状态：已处理、稍后、忽略。
- 增加日历只读接入。
- 强化 macOS、Windows、Linux 桌面分发。
- 通过 Tailscale/VPN 和 Cloudflare Tunnel 做更安全的手机异地连接。

更长期：

- 日历/任务写回。
- 更多本地动作集成。
- Studio 生成工具作为“从提醒到行动”的桥。
- 围绕记忆来源和行动出口的插件机制。

## License

MIT
