# User Install Guide / 用户安装使用指南

中文 | [English](#english)

LifeOS AI 是电脑端应用 + 手机端 PWA。电脑端负责运行本地核心、保存数据、连接 AI；手机端通过浏览器扫码绑定后使用。

## 先看这里：当前公开版本状态

| 项目 | 当前状态 | 用户应该怎么做 |
| --- | --- | --- |
| Docker Compose alpha | 已使用 `ghcr.io/wgj-fry/lifeos-ai:v0.1.2-alpha` | 推荐第一次体验使用。先确认 GitHub Packages 页面已经公开，并用 `docker pull ghcr.io/wgj-fry/lifeos-ai:v0.1.2-alpha` 验证能拉取。 |
| macOS 桌面包 | `v0.1.2-alpha` 已上传 `LifeOS.AI-0.1.2-alpha.0-arm64-unsigned.zip` | 适合早期桌面测试。它是 unsigned ZIP，不是签名公证 DMG。 |
| Windows 桌面包 | `v0.1.2-alpha` 已上传 `LifeOS.AI.Setup.0.1.2-alpha.0.exe` | 适合早期桌面测试。当前 EXE 未做正式 Authenticode 签名，SmartScreen 可能提示未知发布者。 |
| Linux 桌面包 | `v0.1.2-alpha` 已上传 `LifeOS.AI-0.1.2-alpha.0.AppImage` | 适合早期桌面测试。运行前请赋予可执行权限，并按 `SHA256SUMS` 校验。 |
| 自动更新 | 当前未启用 | 先按手动下载、校验 SHA256、覆盖安装的方式更新。 |

请使用明确的 `v0.1.2-alpha` Release 链接，不要依赖 GitHub 通用的 Latest release 标签；旧的 `v0.1.0` / `v0.0.0` 只应作为历史记录保留。

发布前必须保证 README、Release 说明、`docker-compose.yml`、`release-manifest.json` 和真实 GitHub Release/GHCR 资产一致。只写已经存在并能被干净机器下载的资产。

## 下载安装

### macOS Apple Silicon

文件：

```text
LifeOS.AI-0.1.2-alpha.0-arm64-unsigned.zip
```

安装：

1. 下载 unsigned ZIP。
2. 解压 ZIP。
3. 把 `LifeOS AI.app` 拖到 Applications。
4. 从 Applications 打开。

当前 `v0.1.2-alpha` 公开 macOS 资产是 unsigned ZIP，不是已签名公证 DMG。macOS 可能提示 Gatekeeper，需要按 Release 里的 `INSTALL-unsigned-mac.md` 继续打开。后续如果发布带签名环境构建的 macOS DMG，它会是 Developer ID 签名、Apple 公证、并完成 stapled。

如果你习惯用终端复制 `.app`，优先使用 `ditto`，不要用 `cp -R`。`ditto` 更接近 Finder 拖拽安装，能更稳定地保留 macOS 对签名应用需要的元数据：

```bash
ditto "/path/to/LifeOS AI.app" "/Applications/LifeOS AI.app"
```

兼容说明：`macOS Unsigned Zip` 仍可用于私有测试；无签名包可能需要在系统设置中选择 `Open Anyway`。面向普通用户公开分发时，推荐使用带 Developer ID 签名和 Apple 公证的 DMG。

### Windows x64

文件：

```text
LifeOS.AI.Setup.0.1.2-alpha.0.exe
```

安装：

1. 下载 EXE。
2. 对照 `SHA256SUMS` 校验文件。
3. 双击运行安装器。
4. 如果 Windows SmartScreen 提示未知发布者，请确认下载来源是官方 GitHub Release。
5. 安装后从开始菜单或桌面快捷方式打开。

当前 Windows NSIS 安装包是 alpha 测试包，尚未做正式 Authenticode 签名，因此 SmartScreen 可能提示未知发布者。

这是 `Windows NSIS Installer` 路线。

### Linux x64

文件：

```text
LifeOS.AI-0.1.2-alpha.0.AppImage
```

运行：

```bash
chmod +x "LifeOS.AI-0.1.2-alpha.0.AppImage"
./"LifeOS.AI-0.1.2-alpha.0.AppImage"
```

如果 AppImage 无法启动，请确认系统有 FUSE/AppImage 支持，或从终端启动查看缺失依赖。

当前 Linux AppImage 是 alpha 测试包。运行前建议先按 Release 附件里的 `SHA256SUMS` 校验文件。

## 首次启动

1. 打开 LifeOS AI。
2. 设置管理员密码。
3. 进入设置页，配置 AI provider 和 API Key。
4. 创建一次手动备份。
5. 打开手机绑定页面。
6. 用手机扫码完成绑定。
7. 手机进入已绑定页面后，再添加到主屏幕。
8. 完成首次向导后会直接进入第一次聊天；建议立刻发送一条测试消息，确认 AI、本地核心和聊天链路都正常。

不要在绑定成功前把未绑定页面添加到手机主屏幕，否则可能丢失绑定参数。

关键规则：`Wait until the phone shows the bound chat or device page`。`Do not add the unbound QR page to the home screen`。如果已经添加错了，`delete the old home-screen icon` 后重新扫码绑定。

这一流程也叫 `Bind The Phone PWA`。

如果首次启动时桌面窗口没有正常打开，但本地核心已经启动，不用重新安装。桌面失败页会提供 `Retry LifeOS AI`、`Open Local Console In Browser`、`Copy Local Address`、`Open Logs Folder`、`Copy Logs Path`、`Export Desktop Diagnostics`。这时可以先点 `Open Local Console In Browser`，继续完成管理员设置、AI Key、手机绑定和第一次聊天，再回头导出日志或诊断包排查桌面壳问题。

## 手机连接

同一 Wi-Fi 下，使用管理端推荐的局域网地址。

异地使用建议：

- Tailscale：适合长期自用。
- Cloudflare Tunnel：适合临时或固定 HTTPS 入口。

不要直接把 LifeOS AI 暴露到公网 IP。开启 LAN/公网模式前，请确认管理员密码已设置，并在连接向导里查看安全提示。

这一流程也叫 `Use It Away From Home`。桌面版推荐在连接向导里使用 `Save to desktop startup configuration`，它会写入 `desktop startup configuration`，重启后继续使用推荐地址。

### 不在同一局域网的推荐做法

长期自用优先用 Tailscale：

1. 在电脑和手机上安装 Tailscale。
2. 两台设备登录同一个 Tailnet。
3. 在 Tailscale 管理后台启用 MagicDNS。
4. 打开 LifeOS AI 电脑端的“手机连接向导”。
5. 优先选择 `Tailscale HTTPS Serve` 推荐地址。
6. 点击“一键启动 Tailscale HTTPS Serve”。成功后系统会把 `https://<device>.<tailnet>` 保存为手机绑定地址。
7. 如果一键启动不可用，再在电脑终端执行页面给出的命令，例如：

   ```bash
   tailscale serve --bg https:443 http://127.0.0.1:3000
   ```

8. 点击连接测试，测试通过后保存到桌面启动配置。
9. 退出并重新打开 LifeOS AI，然后重新生成手机绑定二维码。
10. 发布或长期使用前，从电脑终端跑一次远程验收：

   ```bash
   npm run remote:smoke
   LIFEOS_REMOTE_ACCEPTANCE_OUT="./remote-acceptance.json" npm run remote:acceptance
   # 或手动指定入口：
   LIFEOS_REMOTE_BASE_URL="https://<device>.<tailnet>" npm run remote:smoke
   LIFEOS_REMOTE_ACCEPTANCE_OUT="./remote-acceptance.json" LIFEOS_REMOTE_BASE_URL="https://<device>.<tailnet>" npm run remote:acceptance
   ```

   `remote:smoke` 会同时验证 `/api/v1/health`、`/mobile/chat` 和 `/api/v1/ws`。`remote:acceptance` 会在此基础上生成长期验收步骤和 `remote-acceptance.json` 证据文件。三项都通过后，再让手机扫码绑定或重新绑定。
   如果你用源码运行，请先 `npm run build`，再用 `npm run start` 或桌面 App 做远程验收；`npm run dev` 的 Vite 开发服务器可能会拒绝临时 Cloudflare 域名，不能代表安装包效果。
11. 关闭手机 Wi-Fi，用蜂窝网络打开 `/mobile/chat` 并发送一条消息；确认成功后，在管理端“长期异地验收清单”点击“我已真实验收”。
12. 退出并重新打开电脑端 LifeOS AI，再运行“立即检查异地健康”；确认恢复后，在同一清单记录“重启后自动恢复”。
13. 从“设置”导出诊断包。诊断包会包含远程健康报告、验收清单和最近的真实验收记录，便于以后排查或发布前复盘。

Tailscale HTTPS Serve 会给手机一个 `https://<device>.<tailnet>` 入口，更适合 PWA、Service Worker 和 WebCrypto 设备签名。只有在 HTTPS Serve 不可用时，才退回 Tailnet IP 或 HTTP MagicDNS。

需要 HTTPS 公网入口时用 Cloudflare Tunnel：

1. 安装 `cloudflared`。
2. 打开 LifeOS AI 电脑端的“手机连接向导”。
3. 点击“一键启动 Cloudflare Tunnel”。
4. 等待页面显示 `trycloudflare.com` 地址。
5. 用新的二维码或手机入口完成绑定。
6. 发布或给别人测试前，跑一次远程验收：

   ```bash
   npm run remote:smoke
   LIFEOS_REMOTE_ACCEPTANCE_OUT="./remote-acceptance.json" npm run remote:acceptance
   # 或手动指定入口：
   LIFEOS_REMOTE_BASE_URL="https://<your-tunnel>.trycloudflare.com" npm run remote:smoke
   LIFEOS_REMOTE_ACCEPTANCE_OUT="./remote-acceptance.json" LIFEOS_REMOTE_BASE_URL="https://<your-tunnel>.trycloudflare.com" npm run remote:acceptance
   ```

`trycloudflare.com` 快速隧道是临时地址。LifeOS AI 会在下次启动时自动重新创建 Tunnel 并刷新二维码地址，但已经添加到手机主屏幕的旧临时域名可能失效。需要长期固定入口时，请使用 Tailscale、Cloudflare Named Tunnel，或自己的可信 HTTPS 反向代理。

## AI Key

推荐在电脑管理端设置 AI Key。Key 保存在电脑端安全存储或本地加密存储，不会保存到手机端。

支持/预留：

- Gemini
- OpenAI
- OpenRouter
- 本地模型接口

## 备份与恢复

建议：

1. 首次配置完成后创建手动备份。
2. 开启自动备份计划，也就是 daily automatic backups。
3. 升级前下载一份备份。
4. 重要数据可导出加密备份。

恢复不会立刻覆盖当前数据库。恢复任务会安排到下次启动执行，并会先创建恢复前备份。重启前可以取消待恢复任务。

## 校验下载文件

macOS/Linux：

```bash
shasum -a 256 "LifeOS.AI-0.1.2-alpha.0-arm64-unsigned.zip"
shasum -a 256 "LifeOS.AI-0.1.2-alpha.0.AppImage"
```

GitHub 下载资产名使用点号，`SHA256SUMS` 里可能保留构建器生成的空格文件名。如果 `shasum -a 256 -c SHA256SUMS` 因文件名不同失败，请直接比对 SHA256 值。

Windows PowerShell：

```powershell
Get-FileHash ".\LifeOS.AI.Setup.0.1.2-alpha.0.exe" -Algorithm SHA256
```

当前 SHA256 见 [release-assets.md](release-assets.md)。

## 更新

当前版本暂未启用自动更新。更新方式：

1. 退出 LifeOS AI。
2. 下载新版安装包。
3. 校验 SHA256。
4. 安装新版。
5. 打开后确认管理端、手机绑定和备份列表正常。

自动更新以后需要配置 `LIFEOS_UPDATE_URL`，并发布 `release-manifest.json` 和对应 `latest*.yml`。

## 常见问题

- 管理端打不开：先用桌面失败页里的 `Open Local Console In Browser` 或 `Copy Local Address`。如果本地核心已经起来了，可以先在浏览器完成管理员设置、AI Key 配置和手机绑定；再用 `Open Logs Folder` 或 `Export Desktop Diagnostics` 导出桌面 diagnostic bundle，并排查桌面壳本身的问题。
- 手机扫不到/打不开：确认手机和电脑网络互通，优先使用连接向导推荐地址。
- AI 不回复：检查 AI provider 是否配置，API Key 是否有效。
- 手机主屏幕打开后丢绑定：删除旧图标，重新扫码绑定，进入已绑定页面后再添加到主屏幕。
- 更新后数据不对：进入设置页预览备份并恢复，或查看 [rollback.md](rollback.md)。

---

# English

LifeOS AI is a desktop app plus a mobile PWA. The desktop app runs the local core, stores data, and connects to AI providers. The phone connects through a paired browser/PWA.

## Read This First: Current Public Release Status

| Item | Current status | What users should do |
| --- | --- | --- |
| Docker Compose alpha | Uses `ghcr.io/wgj-fry/lifeos-ai:v0.1.2-alpha` | Recommended first try. Confirm the GitHub Packages page is public and verify `docker pull ghcr.io/wgj-fry/lifeos-ai:v0.1.2-alpha` works before promoting it. |
| macOS desktop package | `v0.1.2-alpha` uploads `LifeOS.AI-0.1.2-alpha.0-arm64-unsigned.zip` | Good for early desktop testing. It is an unsigned ZIP, not a signed and notarized DMG. |
| Windows desktop package | `v0.1.2-alpha` uploads `LifeOS.AI.Setup.0.1.2-alpha.0.exe` | Good for early desktop testing. It is not Authenticode signed yet, so SmartScreen may warn about an unknown publisher. |
| Linux desktop package | `v0.1.2-alpha` uploads `LifeOS.AI-0.1.2-alpha.0.AppImage` | Good for early desktop testing. Mark it executable and verify it with `SHA256SUMS`. |
| Auto-update | Not enabled yet | Update manually by downloading the new build, verifying SHA256, and installing it. |

Use the explicit `v0.1.2-alpha` Release link instead of relying on GitHub's generic Latest release label; older `v0.1.0` / `v0.0.0` releases should remain historical only.

Before publishing, README, Release notes, `docker-compose.yml`, `release-manifest.json`, and the real GitHub Release/GHCR assets must agree. Only claim assets that already exist and can be downloaded from a clean machine.

## Download And Install

### macOS Apple Silicon

File:

```text
LifeOS.AI-0.1.2-alpha.0-arm64-unsigned.zip
```

Install:

1. Download the unsigned ZIP.
2. Unzip it.
3. Drag `LifeOS AI.app` to Applications.
4. Open it from Applications.

The current `v0.1.2-alpha` public macOS asset is an unsigned ZIP, not a signed and notarized DMG. macOS can trigger Gatekeeper and may require the `INSTALL-unsigned-mac.md` flow from the Release. When a future macOS DMG is built with the signing environment configured, it will be Developer ID signed, Apple notarized, and stapled.

If you prefer installing from Terminal, use `ditto` instead of `cp -R`. `ditto` is closer to the Finder drag-and-drop flow and preserves the metadata macOS expects for signed apps more reliably:

```bash
ditto "/path/to/LifeOS AI.app" "/Applications/LifeOS AI.app"
```

Compatibility note: the earlier `macOS Unsigned Zip` path is still useful for private testing. Unsigned builds may require the macOS `Open Anyway` flow. For public distribution to ordinary users, the signed and notarized DMG is the recommended path.

### Windows x64

File:

```text
LifeOS.AI.Setup.0.1.2-alpha.0.exe
```

Install:

1. Download the EXE.
2. Verify it against `SHA256SUMS`.
3. Run the installer.
4. If SmartScreen warns about an unknown publisher, verify that the file came from the official GitHub Release.
5. Open LifeOS AI from the Start Menu or desktop shortcut.

The current Windows NSIS installer is an alpha test package and is not Authenticode signed yet, so SmartScreen may warn about an unknown publisher.

This is the `Windows NSIS Installer` path.

### Linux x64

File:

```text
LifeOS.AI-0.1.2-alpha.0.AppImage
```

Run:

```bash
chmod +x "LifeOS.AI-0.1.2-alpha.0.AppImage"
./"LifeOS.AI-0.1.2-alpha.0.AppImage"
```

If it does not start, make sure your distribution has FUSE/AppImage support, or run it from a terminal to see missing dependency messages.

The current Linux AppImage is an alpha test package. Verify it with the Release `SHA256SUMS` before running it.

## First Launch

1. Open LifeOS AI.
2. Set an administrator password.
3. Configure an AI provider and API key in Settings.
4. Create a manual backup.
5. Open the phone pairing page.
6. Scan the QR code with the phone.
7. Add the PWA to the home screen only after the phone shows the paired page.
8. After finishing the first launch guide, LifeOS AI now opens the first chat directly. Send one test message right away to confirm the AI provider, local core, and chat path are working.

Do not add the unpaired page to the phone home screen before pairing succeeds.

Key rule: `Wait until the phone shows the bound chat or device page`. `Do not add the unbound QR page to the home screen`. If it was added too early, `delete the old home-screen icon` and pair again.

This flow is also called `Bind The Phone PWA`.

If the desktop window does not open correctly during first launch but the local core is already running, you do not need to reinstall. The desktop failure page now offers `Retry LifeOS AI`, `Open Local Console In Browser`, `Copy Local Address`, `Open Logs Folder`, `Copy Logs Path`, and `Export Desktop Diagnostics`. Use `Open Local Console In Browser` first so you can still finish admin setup, AI key configuration, phone pairing, and the first chat, then export logs or a diagnostic bundle to investigate the desktop shell.

## Phone Connection

On the same Wi-Fi, use the LAN address recommended by the admin connection guide.

For remote access, prefer:

- Tailscale for long-term personal use.
- Cloudflare Tunnel for HTTPS access.

Do not expose LifeOS AI directly to a public IP. Before enabling LAN/public mode, set an admin password and review the security hints in the connection guide.

This flow is also called `Use It Away From Home`. In the desktop app, prefer `Save to desktop startup configuration`; it writes the selected address to the `desktop startup configuration` for future launches.

### Recommended Remote Setup

For long-term personal use, prefer Tailscale:

1. Install Tailscale on the desktop and the phone.
2. Sign both devices into the same Tailnet.
3. Enable MagicDNS in the Tailscale admin console.
4. Open the LifeOS AI desktop connection guide.
5. Prefer the `Tailscale HTTPS Serve` recommended address.
6. Click `Start Tailscale HTTPS Serve`. On success, LifeOS saves `https://<device>.<tailnet>` as the mobile pairing address.
7. If one-click start is unavailable, run the command shown by LifeOS AI, for example:

   ```bash
   tailscale serve --bg https:443 http://127.0.0.1:3000
   ```

8. Run the connection test, then save it to the desktop startup configuration.
9. Quit and reopen LifeOS AI, then generate a fresh mobile pairing QR code.
10. Before publishing or relying on remote access long-term, run the remote smoke check from the desktop:

   ```bash
   npm run remote:smoke
   LIFEOS_REMOTE_ACCEPTANCE_OUT="./remote-acceptance.json" npm run remote:acceptance
   # or set the entry manually:
   LIFEOS_REMOTE_BASE_URL="https://<device>.<tailnet>" npm run remote:smoke
   LIFEOS_REMOTE_ACCEPTANCE_OUT="./remote-acceptance.json" LIFEOS_REMOTE_BASE_URL="https://<device>.<tailnet>" npm run remote:acceptance
   ```

   `remote:smoke` verifies `/api/v1/health`, `/mobile/chat`, and `/api/v1/ws`. `remote:acceptance` also generates the long-term acceptance steps and a `remote-acceptance.json` evidence file. Pair or re-pair the phone after all three checks pass.
   If you are running from source, build first and use `npm run start` or the desktop app for remote checks. The Vite dev server behind `npm run dev` may reject temporary Cloudflare hostnames and does not represent the packaged app.

Tailscale HTTPS Serve gives the phone an `https://<device>.<tailnet>` entry, which is better for PWA, Service Worker, and WebCrypto device signing. Fall back to Tailnet IP or HTTP MagicDNS only when HTTPS Serve is unavailable.

For an HTTPS public entry, use Cloudflare Tunnel:

1. Install `cloudflared`.
2. Open the LifeOS AI desktop connection guide.
3. Click `Start Cloudflare Tunnel`.
4. Wait for a `trycloudflare.com` address.
5. Pair the phone with the new QR code or mobile entry URL.
6. Before publishing or sharing the build, run the remote smoke check:

   ```bash
   npm run remote:smoke
   LIFEOS_REMOTE_ACCEPTANCE_OUT="./remote-acceptance.json" npm run remote:acceptance
   # or set the entry manually:
   LIFEOS_REMOTE_BASE_URL="https://<your-tunnel>.trycloudflare.com" npm run remote:smoke
   LIFEOS_REMOTE_ACCEPTANCE_OUT="./remote-acceptance.json" LIFEOS_REMOTE_BASE_URL="https://<your-tunnel>.trycloudflare.com" npm run remote:acceptance
   ```

Quick `trycloudflare.com` tunnels are temporary. LifeOS AI can recreate a Tunnel on the next launch and refresh QR addresses, but an old home-screen icon that points to the previous temporary domain may stop working. For a stable long-term entry, use Tailscale, Cloudflare Named Tunnel, or your own trusted HTTPS reverse proxy.

For long-term acceptance, turn off phone Wi-Fi, open `/mobile/chat` over cellular data, send a message, and mark the cellular item as verified in the desktop `Long-Term Remote Acceptance Checklist`. Then quit and reopen the desktop app, run `Run Remote Health Check`, and mark restart restore as verified. Export a diagnostic bundle from Settings afterward; it includes the remote health summary, latest remote smoke report, acceptance checklist, and recent manual acceptance records.

## AI Keys

Configure AI keys in the desktop admin UI. Keys are stored on the computer in secure storage or encrypted local fallback storage, not on the phone.

Supported or prepared providers:

- Gemini
- OpenAI
- OpenRouter
- Local model endpoint

## Backups And Restore

Recommended:

1. Create a manual backup after first setup.
2. Enable daily automatic backups.
3. Download a backup before upgrades.
4. Export an encrypted backup for important data.

Restore does not immediately overwrite the current database. It schedules a restore for the next startup and creates a pre-restore backup first. Pending restores can be cancelled before restarting.

## Verify Downloads

macOS/Linux:

```bash
shasum -a 256 "LifeOS.AI-0.1.2-alpha.0-arm64-unsigned.zip"
shasum -a 256 "LifeOS.AI-0.1.2-alpha.0.AppImage"
```

GitHub asset URLs use dot-separated filenames. The uploaded `SHA256SUMS` file may keep the original builder filenames with spaces. If `shasum -a 256 -c SHA256SUMS` fails because of a filename mismatch, compare the SHA256 value directly.

Windows PowerShell:

```powershell
Get-FileHash ".\LifeOS.AI.Setup.0.1.2-alpha.0.exe" -Algorithm SHA256
```

Current SHA256 values are listed in [release-assets.md](release-assets.md).

## Updates

Auto-update is not enabled in the current build. Manual update flow:

1. Quit LifeOS AI.
2. Download the newer package.
3. Verify SHA256.
4. Install the newer package.
5. Open the app and confirm admin, phone pairing, and backups still look correct.

Future auto-update requires `LIFEOS_UPDATE_URL`, `release-manifest.json`, and the matching `latest*.yml` feed files.

## Troubleshooting

- Admin does not open: first try `Open Local Console In Browser` or `Copy Local Address` from the desktop failure page. If the local core is already running, you can still finish admin setup, AI key configuration, and phone pairing in the browser, then use `Open Logs Folder` or `Export Desktop Diagnostics` to export a desktop diagnostic bundle and debug the desktop shell itself.
- Phone cannot connect: confirm network reachability and use the recommended address from the connection guide.
- AI does not answer: check provider configuration and API key validity.
- Home-screen icon loses pairing: delete the old icon, scan a fresh QR code, pair first, then add the paired page to the home screen.
- Data looks wrong after an update: preview and restore a backup, or see [rollback.md](rollback.md).
