# LifeOS

> 一个本地 AI，回答一个问题：**“我是不是忘了什么？”**

[English](README.md) | [快速开始](#快速开始) | [当前限制](#当前限制) | [License](#license)

[![Quality Gate](https://github.com/WGJ-Fry/lifeos-ai/actions/workflows/quality.yml/badge.svg)](https://github.com/WGJ-Fry/lifeos-ai/actions/workflows/quality.yml)
[![Docker Image](https://github.com/WGJ-Fry/lifeos-ai/actions/workflows/docker.yml/badge.svg)](https://github.com/WGJ-Fry/lifeos-ai/actions/workflows/docker.yml)
[![Release](https://img.shields.io/github/v/release/WGJ-Fry/lifeos-ai?include_prereleases&label=release)](https://github.com/WGJ-Fry/lifeos-ai/releases)
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)

<p align="center">
  <img src="docs/assets/real-demo.gif" alt="LifeOS 真实演示" width="100%">
</p>

## LifeOS 是什么？

LifeOS 是一个开源、本地优先的个人 AI 系统。

当前 alpha 版本只聚焦一个问题：

> **我是不是忘了什么？**

它会读取你挂载的本地 Markdown 文件夹，使用本地 Ollama 模型，从笔记里找出可能被你遗忘的截止日期、承诺、续期事项和未完成任务。

不需要云端 API Key。<br>
不需要专有笔记格式。<br>
你的数据仍然是普通 Markdown 文件。

## 快速开始

需要：

- Git
- Docker
- Docker Compose

首次运行会下载 `llama3.2`，所以第一次启动可能会久一点。模型缓存后，后续启动会快很多。

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

打开浏览器：

```text
http://localhost:8080/admin/login
```

默认密码：

```text
lifeos-local-demo
```

进入聊天页面后输入：

```text
What am I forgetting?
```

预期结果：

```text
LifeOS 应该会从你的本地 Markdown 文件里提到护照过期、Tom 的项目提案和报税截止日期。
```

## 当前能做什么？

LifeOS `v0.1.1-alpha` 现在只做一件事：

> 扫描挂载的本地 Markdown 文件夹，回答：**“我是不是忘了什么？”**

示例：

```text
用户：
What am I forgetting?

LifeOS：
你可能忘了：

- 护照续期：47 天后过期。
- Tom 的项目提案：明天截止。
- 报税截止日期：12 天后。
```

## 工作原理

```text
本地 Markdown 笔记
        |
        v
LifeOS Server
        |
        v
本地 Ollama / llama3.2
        |
        v
“我是不是忘了什么？”
```

Docker 快速体验会启动三个服务：

```text
ollama
ollama-pull
lifeos
```

LifeOS 会读取：

```text
./lifeos_vault
```

并把应用数据保存在：

```text
./lifeos_data
```

## Docker 镜像

快速体验默认使用：

```text
ghcr.io/wgj-fry/lifeos-ai:v0.1.1-alpha
```

Docker workflow 会通过仓库里的 Dockerfile 和 `docker/build-push-action@v6` 构建并发布镜像。

Dockerfile 使用：

```text
node:24-bookworm-slim
npm ci
npm run build
```

## Docker 配置

Docker quickstart 默认使用：

```text
LIFEOS_QUICKSTART=1
LIFEOS_ADMIN_PASSWORD=lifeos-local-demo
LIFEOS_ACTIVE_AI_PROVIDER=local
LOCAL_MODEL_NAME=llama3.2
LOCAL_MODEL_BASE_URL=http://ollama:11434/v1
LIFEOS_VAULT_DIR=/app/vault
```

Ollama 通过 OpenAI-compatible 的 `/v1/chat/completions` 接口调用。

## 当前限制

这是 alpha 版本。

- 当前只扫描本地 Markdown 文件。
- 还没有连接你的真实日历。
- 还不会写回日历或任务系统。
- 它不是完美的截止日期检测器。
- 为了速度和上下文长度，它只读取有限数量的 Markdown 文件。
- 桌面端和手机 PWA 仍然存在，但这个 Docker quickstart 只聚焦本地 Markdown 记忆演示。

这个版本的目标非常简单：

```text
写笔记
|
v
本地运行
|
v
问“我是不是忘了什么？”
|
v
得到有用提醒
```

## 桌面端状态

LifeOS 也包含桌面核心和手机 PWA 入口。

当前公开桌面版状态：

- GitHub Releases 中已有 macOS Apple Silicon unsigned ZIP。
- Windows NSIS 和 Linux AppImage 构建链路已接入，但公开资产仍需真实安装验证后再上传。
- macOS 正式签名和公证版本还没有准备好。

如果只是想体验 alpha 能力，推荐优先使用 Docker Compose。

## 常见排查

### 查看容器状态

```bash
docker compose ps
```

### 查看日志

```bash
docker compose logs -f lifeos
docker compose logs -f ollama
```

### 从零重启

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

### 手动拉取镜像

```bash
docker pull ghcr.io/wgj-fry/lifeos-ai:v0.1.1-alpha
```

## Roadmap

近期方向：

- 改进 Markdown 记忆提取。
- 增加周报和月报总结。
- 增加日历读取。
- 增加本地主动提醒。
- 改进 macOS、Windows、Linux 桌面端分发。

当前 alpha 暂不包含：

- 多 Agent 编排。
- 插件市场。
- 日历写回。
- 手机端优先 onboarding。
- 云同步。

## License

MIT
