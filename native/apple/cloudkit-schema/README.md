# OwnOrbit CloudKit schema

`OwnOrbit.ckdb` is the source-controlled private CloudKit record schema for the
OwnOrbit Apple clients. It intentionally grants no public-database access and
contains no credentials, user records, tokens, or environment-specific values.

Import it only into the **Development** environment first:

1. Open CloudKit Database for `iCloud.ai.lifeos.desktop`.
2. Confirm the environment is Development.
3. Choose **Import Schema** and select `OwnOrbit.ckdb`.
4. Review and save the proposed changes.
5. Run the signed helper roundtrip before deploying schema changes to Production.

The schema defines the record types, while OwnOrbit creates private custom zones
at runtime. The default Apple-only chat path uses `LifeOSChatRelayZone` and only
these records:

- `LifeOSDeviceKey`
- `LifeOSChatRequest`
- `LifeOSChatResponse`
- `LifeOSChatReceipt`

The Mac also uses one deterministic `LifeOSChatClaim` in the private
`LifeOSChatRelayControlZone` while a request is being processed. This claim
prevents two Macs signed into the same iCloud account from generating the same
answer twice. After the phone pins a Mac, its signed request carries that Mac
fingerprint and the claim stores the same `trustedMacFingerprint`; another Mac
cannot acquire or process the request. After a verified phone receipt, the Mac removes that request's
request, response, receipt, and claim records with an idempotent bounded cleanup
job. Unacknowledged replies are never removed by lifecycle cleanup.

It does not use `LifeOSChatZone`, `LifeOSMemoryZone`, `LifeOSTaskZone`, or
`LifeOSGeneratedAppZone` unless the owner separately enables the advanced
full-data sync feature. AI keys, passwords, device private keys, cookies,
tokens, SQLite files, backups, local paths, and complete local chat history are
not valid relay payloads.

Do not deploy the schema to Production until the real-device acceptance matrix
passes and the release owner has reviewed the pending changes.

## 中文

`OwnOrbit.ckdb` 是 OwnOrbit Apple 客户端使用的私有 CloudKit 记录架构。它不授予
公共数据库权限，也不包含凭证、用户数据、令牌或环境专属配置。

首次只导入到 **Development（开发）** 环境：

1. 打开 `iCloud.ai.lifeos.desktop` 的 CloudKit Database。
2. 确认当前环境为 Development。
3. 点击“导入架构”，选择 `OwnOrbit.ckdb`。
4. 检查并保存待应用的变更。
5. 部署到 Production 前，先运行签名辅助程序的真实读写往返测试。

架构文件负责定义记录类型，OwnOrbit 会在首次运行时自动创建私有自定义区域。默认的
Apple 手机问答只使用 `LifeOSChatRelayZone`，并且只允许四种记录：

- `LifeOSDeviceKey`
- `LifeOSChatRequest`
- `LifeOSChatResponse`
- `LifeOSChatReceipt`

Mac 在处理请求期间还会在私有 `LifeOSChatRelayControlZone` 中使用一条确定性的
`LifeOSChatClaim`。它用于避免同一 iCloud 账号下的两台 Mac 重复生成同一个回答。
手机固定信任某台 Mac 后，每个签名请求都会携带该 Mac 指纹，claim 也会保存相同的
`trustedMacFingerprint`；其他 Mac 不能领取或处理这个请求。
手机签名回执通过验证后，Mac 才会通过可重试、可幂等的清理任务删除这次请求对应的
request、response、receipt 和 claim；未确认的回复不会被生命周期清理。

除非用户另外开启高级“完整数据同步”，默认流程不会使用 `LifeOSChatZone`、
`LifeOSMemoryZone`、`LifeOSTaskZone` 或 `LifeOSGeneratedAppZone`。AI Key、
密码、设备私钥、Cookie、Token、SQLite、备份、本地路径和完整本地聊天历史都不是
合法的中继数据。

在真机验收矩阵通过并完成发布复核前，不要把架构变更部署到 Production。
