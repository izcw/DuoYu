# 账号接入升级（2026-10-28）

DuoYu-ID 已增加 extension 平台、独立 allowed_origins 与精确 Discovery；本机开发项目已登记实际回调与 chrome-extension 来源。使用现有扩展 ID，不添加 manifest key。

本次扩展修改：刷新请求发出前在 storage.session 保存 refreshPending，Worker 重启或后续状态请求遇到未完成标记时清理本地会话并要求重新授权，避免重放已被消费的刷新令牌。成功后原子替换整份会话并清除标记。不会改变业务数据或上传收藏。

复现命令：pnpm typecheck、pnpm zip、pnpm test:auth、pnpm test:auth:integration。测试在 Edge 的真实扩展窗口完成，新增 Worker 终止恢复、账号停权、标准 401、pending 恢复和 runtime.reload 清空检查。脚本使用临时账号，不读取中心 .env、不发送真实邮件；只可用于现有本地开发数据库。

重新加载 .output/chrome-mv3 后使用新版本；重载会清空 session 存储，需要重新点击登录，中心 Cookie 有效时可复用 SSO。

完整配置规范见同级 DuoYu-ID/docs/extension-integration.md；完整验收报告见 DuoYu-ID/docs/extension-upgrade-2026-10-28.md。Firefox 仅协议来源检查，未完成真实授权窗口验收；生产 HTTPS、正式商店身份与实体设备仍需单独验收。2026-10-27 的报告属于历史记录，以新规范为当前接入依据。
