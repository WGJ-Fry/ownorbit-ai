# LifeOS AI

> **一个本地优先的个人 AI 系统：记忆、行动和自动生成解决问题的程序。**
>
> 电脑端运行私有 AI 核心，手机端成为日常使用入口。

[English](README.md) | [快速开始](#2-分钟启动) | [自动生成程序](#自动生成解决问题的程序) | [远程访问](#远程与-vpn-访问) | [当前限制](#当前-alpha-限制)

[![Quality Gate](https://github.com/WGJ-Fry/lifeos-ai/actions/workflows/quality.yml/badge.svg)](https://github.com/WGJ-Fry/lifeos-ai/actions/workflows/quality.yml)
[![Docker Image](https://github.com/WGJ-Fry/lifeos-ai/actions/workflows/docker.yml/badge.svg)](https://github.com/WGJ-Fry/lifeos-ai/actions/workflows/docker.yml)
[![Release](https://img.shields.io/github/v/release/WGJ-Fry/lifeos-ai?include_prereleases&label=release)](https://github.com/WGJ-Fry/lifeos-ai/releases)
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)

<p align="center">
  <img src="docs/assets/readme/lifeos-readme-hero-zh.svg" alt="LifeOS AI 本地优先个人 AI 管家" width="100%">
</p>

LifeOS 先从一个很小但有用的工作流开始：

```text
我是不是忘了什么？
```

它读取本地 Markdown 笔记，在 alpha 演示里使用本地 Ollama 运行，并从笔记里找出可能被遗漏的承诺、截止日期、续期事项和未完成任务。

它不只是一个云端聊天框。更大的方向是一个私有个人 AI 操作层：记忆提醒、桌面管理端、手机绑定访问、安全本地动作、VPN/隧道异地连接，以及根据当前问题自动生成可运行程序。

## 10 秒看懂

- **个人 AI 管家：** 帮你记住、规划、连接和行动。
- **本地优先 alpha：** 读取你自己控制的 `.md` 文件夹。
- **最快演示路径：** Docker Compose + Ollama `llama3.2`。
- **手机方向：** 电脑端私有核心 + 手机 PWA 随身入口。
- **远程方向：** 局域网、Tailscale/VPN、Cloudflare Tunnel 连接向导。
- **Studio 方向：** 为记账、规划、查询、整理、表单、计算和流程面板生成可运行工具。

当前 alpha 的承诺很克制：把 Markdown 笔记放进文件夹，本地启动 LifeOS，然后问它你可能漏掉了什么。

## 选择你的体验路径

| 路径 | 适合你在什么时候用 | 当前公开状态 |
| --- | --- | --- |
| **Docker Compose alpha** | 想最快体验 Ollama + Markdown 本地记忆演示。 | 推荐第一次体验使用。镜像是 `ghcr.io/wgj-fry/lifeos-ai:v0.1.2-alpha`。 |
| **macOS 桌面 ZIP** | 想试用早期桌面端壳。 | 已在 [`v0.1.0` Release](https://github.com/WGJ-Fry/lifeos-ai/releases/tag/v0.1.0) 提供：`LifeOS.AI-0.1.0-arm64-unsigned.zip`。 |
| **Windows / Linux 桌面包** | 想要 Windows 或 Linux 原生安装包。 | 打包脚本和 CI smoke 已接入，但公开 EXE/AppImage 还没有上传。 |

如果你是第一次看这个项目，建议从下面的 Docker Compose 开始。如果你明确想试桌面 App，请使用 macOS ZIP Release，并在首次启动前阅读 `INSTALL-unsigned-mac.md`。

## 真实产品界面

下面是真实项目截图，不是概念图。

<p align="center">
  <img src="public/screenshots/real-admin-onboarding.jpg" alt="LifeOS 电脑端首次启动与安全检查" width="49%">
  <img src="public/screenshots/real-mobile-device.jpg" alt="LifeOS 手机端设备与连接页面" width="24%">
</p>

<p align="center">
  <img src="public/screenshots/real-connection-tunnel-vpn.jpg" alt="LifeOS 远程连接向导，包含 Cloudflare Tunnel 与 Tailscale VPN" width="74%">
</p>

## 为什么值得 Star

很多 AI 工具等你想起正确的问题。LifeOS 面向的是你已经拥有的混乱现实：散落的笔记、日期、承诺、续期、想法和未完成事项。

LifeOS 有意思的地方在于它把三条线放在一起：

1. **记忆发现：** 从你自己的数据里找出可能忘掉的承诺和截止日期。
2. **本地优先 AI：** 第一个可用工作流在你自己的电脑上运行，不强制需要云端 API Key。
3. **生成工具：** 从“AI 告诉我一件事”，进一步走向“AI 生成一个小工具帮我处理它”。

当前公开 alpha 只验证第一小段能力。项目更长期的方向，是一个私有个人 AI 操作层。

## 功能地图

<p align="center">
  <img src="docs/assets/readme/lifeos-feature-map-zh.svg" alt="LifeOS AI 从个人记忆到可执行行动的功能地图" width="100%">
</p>

| 模块 | 当前状态 |
| --- | --- |
| 本地 Markdown 读取 | Docker alpha 路径可用 |
| Ollama 本地模型 | 通过 Docker Compose 可用 |
| “我是不是忘了什么？”聊天 | 可基于挂载的 Markdown 笔记回答 |
| 管理员登录和安全诊断 | 桌面端/server 路径已包含 |
| 桌面端壳 | 早期分发路径 |
| 手机端伴侣 | 进行中 / 早期路径 |
| 远程访问向导 | 正在完善 LAN、Tailscale/VPN、Cloudflare Tunnel 诊断 |
| 自动生成程序 | Studio 实验路径 |

请把当前 alpha 理解为一个已经能跑的本地记忆演示，而不是完整的个人操作系统。

## 自动生成解决问题的程序

<p align="center">
  <img src="docs/assets/readme/lifeos-generated-programs-zh.svg" alt="LifeOS 自动生成解决问题的程序" width="100%">
</p>

LifeOS Studio 是实验路径：把一个具体需求变成一个小型可运行程序。

这不只是“根据一句话生成一个 app”。目标更实际：

> 当 LifeOS 发现或接收到一个真实问题时，它应该能生成一个聚焦的小工具，帮你把这件事处理下去。

例子：

- 从零散订阅笔记生成续期追踪器。
- 从旅行计划生成行前清单。
- 为某个月生成预算计算器。
- 为答应联系的人生成 follow-up 面板。
- 为重复的本地动作生成一个小流程工具。

状态：这是桌面端 Studio 实验路径，不属于最小 Docker Markdown 演示能力。

## 2 分钟启动

需要准备：

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

打开：

```text
http://localhost:8080/admin/login
```

演示密码：

```text
lifeos-local-demo
```

输入：

```text
What am I forgetting?
```

预期结果：LifeOS 应该从 `lifeos_vault/demo.md` 中提到护照过期、Tom 的项目提案和报税截止日期。

首次启动可能需要几分钟，因为 Ollama 会下载 `llama3.2`。

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

这个 Docker quickstart 是电脑本机浏览器演示。它不会自动让手机在外网访问你的电脑。

## 远程与 VPN 访问

<p align="center">
  <img src="docs/assets/readme/lifeos-remote-access-zh.svg" alt="LifeOS 手机异地连接：局域网、Tailscale VPN、Cloudflare Tunnel" width="100%">
</p>

LifeOS 设计的连接模型是：

```text
你的电脑 = 私有 AI 核心
你的手机 = 随身客户端
连接方式 = 局域网、VPN，或谨慎配置的 Tunnel
```

| 模式 | 适合场景 | 说明 |
| --- | --- | --- |
| 同 Wi-Fi / 局域网 | 在家快速用手机测试 | 手机和电脑必须在同一个网络。 |
| Tailscale / VPN | 推荐的长期个人异地访问 | 服务仍只对你的设备私有可见，更适合长期使用。 |
| Cloudflare Tunnel | HTTPS 远程测试 | 有用，但需要认真配置认证和公网暴露提示。 |
| 直接开放公网端口 | 不推荐 | 不要把电脑端核心直接裸露到公网。 |

安全原则：远程访问前，应启用管理员认证，使用 HTTPS 或私有 VPN 路径，确认哪个 URL 是公网入口，并保留备份与诊断能力。

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

## AI Provider

Docker alpha 默认使用本地 Ollama：

```text
LIFEOS_ACTIVE_AI_PROVIDER=local
LOCAL_MODEL_NAME=llama3.2
LOCAL_MODEL_BASE_URL=http://ollama:11434/v1
```

桌面/管理端路径包含本地模型、Gemini、OpenAI、OpenRouter 风格 endpoint 的配置能力。敏感 Key 设计目标是只留在后端，不进入前端存储、备份明文、日志和 API 响应。

## 当前 Alpha 限制

LifeOS 仍是 alpha 软件。

- 主 Docker 演示目前只读取 Markdown。
- 还没有接入真实日历。
- 还不会写回日历或任务系统。
- 它不是完美的截止日期检测器。
- 为了速度和上下文长度，只读取有限数量的文件。
- 桌面端、手机端、远程访问和 Studio 生成程序，比 Docker 演示路径更早期。

## 长期平台愿景

LifeOS 的长期愿景，是成为一个私有的个人 AI 操作层：

- 从你自己的数据里记住重要信息；
- 发现可能需要你处理的事项；
- 让电脑端和手机端安全连接；
- 支持本地模型或你选择的 AI provider；
- 为具体问题生成聚焦的小工具；
- 最终把提醒连接到安全的本地动作。

alpha 先从“记忆”开始，因为记忆是根问题：在 AI 替你行动之前，它应该先帮你发现什么事情值得注意。

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
ghcr.io/wgj-fry/lifeos-ai:v0.1.2-alpha
```

说明：release tag 是 `v0.1.2-alpha`；package version 是 `0.1.2-alpha.0`。

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
