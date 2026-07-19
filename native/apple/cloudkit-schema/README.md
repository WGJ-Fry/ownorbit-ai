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

在真机验收矩阵通过并完成发布复核前，不要把架构变更部署到 Production。
