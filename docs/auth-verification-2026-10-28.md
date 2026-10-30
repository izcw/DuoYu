# DuoYu-ID 升级后的扩展适配与测试结果

日期：2026-10-28。以 DuoYu-ID 当前 `docs/extension-integration.md` 和实际本机服务为准；前一日的建议报告是历史记录。

## 本轮完善

- 复用已有登录和刷新流程，保留账号中心新增的 refreshPending 持久标记、后台串行续期与 Worker 恢复保护。
- Discovery 除校验 issuer 和端点外，增加公共客户端、code、authorization_code / refresh_token、S256 及请求范围能力检查；不满足条件时明确提示配置问题。
- UserInfo 错误按新版协议分类：401 invalid_token 清除会话；403 origin_not_allowed、403 insufficient_scope 保留会话并给出对应的来源登记或重新授权提示；503 和网络故障保留尚未过期的账号展示。
- 登录兑换遇到来源拒绝时显示准确的 allowed_origins 提示；登录后资料检查的具体错误不再统一掩盖为“身份校验失败”。
- 非法的可选头像 URL 回退到默认图标，不使已验证账号的资料加载失败。
- 用户主动退出时，即使存在刷新 pending 标记，也尝试撤销已有 Access Token 与 Refresh Token。撤销不是重新兑换，不重放刷新操作。
- 保留约 1100 × 840px 的居中授权窗口、小窗口边距适配及工作区账号入口。

## 实际配置

本地 issuer 为 `http://localhost:8080`，client_id 为 `duoyu_extensions_local`，平台为 `extension`、公共客户端、允许续期。

- 回调：`https://kklcklehkoeinjgfekeogcokngihdbmh.chromiumapp.org/oidc`
- 请求来源：`chrome-extension://kklcklehkoeinjgfekeogcokngihdbmh`
- 范围：`openid profile email offline_access`

已确认运行服务的 Discovery 仅公布实际支持的 code、两种 grant 和四个范围；已确认独立 allowed_origins 配置生效。没有修改 DuoYu-ID 源码或放宽其来源策略。

## 本轮执行结果

| 检查                         | 结果                                                                         |
| ---------------------------- | ---------------------------------------------------------------------------- |
| `pnpm typecheck`             | 通过                                                                         |
| `pnpm zip`                   | 通过，更新 `.output/chrome-mv3` 与 ZIP                                       |
| `pnpm test:auth`             | 通过：回调参数、签名/claims、UserInfo 错误分类、Discovery 能力缺失、头像异常 |
| `pnpm test:auth:integration` | 通过，Edge 真实扩展和本机认证服务                                            |
| `git diff --check`           | 通过                                                                         |

集成测试通过的 14 组场景：

1. 授权窗口尺寸及相对来源浏览器居中。
2. 真实 identity 窗口、密码表单、PKCE、验签与 UserInfo。
3. 多个新标签页共享登录。
4. 来源错误、权限范围不足、503 时保留会话并准确提示。
5. 实际服务接受已登记扩展 Origin、拒绝未登记 Origin。
6. 并发请求串行轮换刷新令牌。
7. 实际终止 Service Worker 后恢复会话并在线复核。
8. 本扩展退出、多标签页同步及服务端拒绝已撤销令牌。
9. 账号停用后清除扩展身份。
10. SSO 再次登录与中心会话撤销。
11. 关闭授权窗口后可以再次登录。
12. 标签工作区账号入口可访问。
13. 持久 pending 刷新标记导致重新登录，不重放旧刷新令牌。
14. 扩展 runtime.reload 后清空 session 存储。

第 4 项在一次性测试浏览器的 Worker 内注入 HTTP 错误响应，没有中断真实认证服务或数据库；第 5 项向真实 UserInfo 端点发送 Origin 请求。pending 中断用标记模拟，Worker 休眠另有真实终止测试。续期通过调整客户端缓存时间触发，不是等待自然过期。协议负向用临时 RSA 密钥和模拟响应，正常集成使用真实认证。

测试账号为随机临时数据，结束清理。没有读取中心 `.env.local`，没有发送真实邮件，没有修改真实用户的账号或会话。

## 使用与范围

在扩展管理页重新加载当前 `.output/chrome-mv3`，保持本机账号服务运行即可。重新加载会清空浏览器 session 登录状态，需再次授权；中心 Cookie 有效时可 SSO。

当前仍是本机服务接入，不包含公网 HTTPS、商店 ID 发布、Firefox、实体 Passkey/手机或真实邮件验收。登录不会自动同步本地收藏数据。中心退出在扩展下一次在线检查时生效，不宣称所有项目即时退出。源代码尚未提交或推送。
