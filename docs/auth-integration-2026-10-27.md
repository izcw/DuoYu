# 多鱼扩展登录接入与 DuoYu-ID 升级建议

> 历史记录：DuoYu-ID 已完成后续升级，当前扩展适配与测试结果见 [2026-10-28 验证报告](auth-verification-2026-10-28.md)。以下问题与配置描述保留当日事实。

日期：2026-10-27。范围：本机 DuoYu-ID 与 Chrome MV3 扩展，真实联调使用 Microsoft Edge。没有修改认证中心源代码，没有读取 `.env.local`，没有发送真实邮件。

## 已接入的功能

- 右上角账号入口，未登录使用提供的 `用户.png`，与玻璃模式切换错开；首页、收藏页、标签工作区均可访问。
- 点击入口打开账号悬浮面板，点击“前往登录”通过浏览器 `identity.launchWebAuthFlow` 打开账号中心原有登录页。密码、验证码和通行密钥页面由 DuoYu-ID 维护，扩展不接触密码或自行复制登录表单。
- Authorization Code + S256 PKCE；每次随机 state、nonce、verifier；精确校验回调 origin/path、state、参数重复与返回错误。
- 使用 jose 验证 RS256 签名、JWKS、issuer、audience、azp、时间及 nonce；UserInfo 的 sub 必须与 ID Token 一致。账号以 issuer + sub 标识，头像仅接受认证中心同源 URL，支持其相对头像路径。
- 后台 Service Worker 统一兑换和刷新令牌，多标签页串行续期，避免同一刷新令牌被并发消费。资料、退出状态同步到已打开的新标签页。
- 页面恢复可见、获得焦点及可见状态下每 60 秒在线验证 UserInfo；接近过期时轮换刷新令牌。中心撤销会话后在下一次检查清除本地登录，不承诺即时退出。
- “账号与安全”打开中心个人资料页；“退出登录”清除本地会话并撤销本扩展令牌，不退出其他项目或中心 Cookie。
- 令牌保存在 `storage.session`，仅受信任的扩展上下文可访问，不写入网页 localStorage、同步存储或桌面备份。关闭浏览器、重新加载或更新扩展后需再次点击登录，中心 Cookie 有效时可复用 SSO。
- 普通 UserInfo 网络故障不立刻销毁尚未过期的会话，界面显示验证失败提示；刷新结果不确定时要求重新登录，不盲目重试已可能被消费的刷新令牌。

登录本身不上传或同步收藏、工作区、壁纸等业务数据；这些仍保留在当前扩展的本地数据库。

## 当前接入配置

| 项目            | 值                                                              |
| --------------- | --------------------------------------------------------------- |
| issuer          | `http://localhost:8080`                                         |
| client_id       | `duoyu_extensions_local`                                        |
| 名称            | 多鱼新标签页（本地）                                            |
| 类型 / 平台     | 公共客户端 / SPA                                                |
| scope           | `openid profile email offline_access`                           |
| refresh_enabled | true                                                            |
| 当前回调        | `https://kklcklehkoeinjgfekeogcokngihdbmh.chromiumapp.org/oidc` |

本地开发数据库已登记该项目。没有创建或嵌入 client_secret，公共扩展不应持有此秘密。修改配置入口是 `src/features/auth/config.ts`，认证域名的 host permission 位于 `wxt.config.ts`。

当前加载目录为 `D:\Users\Administrator\桌面\DuoYu\DuoYu-Extensions\.output\chrome-mv3`。在浏览器扩展管理页重新加载该目录即可使用；需保持本机账号服务运行。

没有向 manifest 添加新的 key，以避免改变现有扩展 ID 和本地数据命名空间。解压 ZIP 到其他目录或更换扩展安装方式，未打包扩展 ID 可能变化；应在该扩展后台控制台执行 `chrome.identity.getRedirectURL('oidc')`，将实际地址登记为精确回调。正式商店发布时使用真实商店 ID/对应公钥稳定开发与发布身份，不要临时生成另一个 key 来掩盖回调不一致。

生产切换需要：部署 HTTPS 账号服务、验证证书及 Discovery issuer、单独注册生产公共客户端、登记正式扩展 ID 回调、替换 issuer/client_id 和 host permission，再做跨环境验收。本次没有接入公网域名。

## 测试结果

| 测试           | 结果 / 边界                                                                                                                                                                             |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 类型检查       | `pnpm typecheck` 通过                                                                                                                                                                   |
| 构建打包       | `pnpm zip` 通过                                                                                                                                                                         |
| 实际浏览器登录 | Edge 加载真实扩展；真实 identity 窗口、密码表单、授权确认、PKCE 兑换、验签、UserInfo 全链路通过                                                                                         |
| 多标签页       | 第二个新标签页识别登录状态；同时请求续期只串行消费，刷新令牌发生轮换                                                                                                                    |
| 本地退出       | 两页恢复未登录；退出后的 Access Token 被中心拒绝                                                                                                                                        |
| SSO / 中心撤销 | 本地退出后再次通过中心会话授权；删除临时用户中心会话后，下次状态检查清除扩展登录                                                                                                        |
| 用户取消       | 关闭授权窗口后出现明确提示，可以重新发起登录                                                                                                                                            |
| 页面入口       | 标签工作区打开后账号入口仍可见、可访问                                                                                                                                                  |
| 协议负向测试   | 拒绝伪造 state、重复参数、错误回调路径/issuer、拒绝授权；拒绝错误签名、nonce、issuer、audience、azp、过期、未来 iat、刷新后的身份切换；UserInfo sub 不匹配拒绝；401/403 与 503 分开处理 |

协议负向测试使用本地生成的 RSA 测试密钥和模拟 HTTP 响应；正常登录、续期、退出和中心撤销使用真实服务，不是 mock 登录。续期通过将扩展缓存过期时间调到过去触发，没有等待自然经过五分钟。中心撤销测试只删除临时账号的会话，不触碰真实用户。

浏览器测试创建随机临时账号及密码摘要，结束清理账号、会话和授权记录。测试不读取中心环境秘密，拦截邮件发送接口；没有实测真实邮箱投递、实体 Passkey/iPhone、Firefox 或公网 HTTPS。

复现：

```powershell
pnpm typecheck
pnpm zip
node scripts/auth-protocol.mjs
node scripts/auth-integration.mjs
```

`auth-integration.mjs` 仅用于本地开发：需要现有 `duoyu-postgres-dev` 容器及本地已登记项目，会更新 `duoyu_extensions_local` 的回调为被测试构建的实际地址。不要将此测试指向生产数据库。截图在忽略目录 `work/auth-entry.png`、`work/auth-account.png`。

## DuoYu-ID 建议：按优先级处理

### 1. 修正 Discovery 与真实能力不一致（优先）

实测 `/.well-known/openid-configuration` 宣告 `id_token`、`id_token token`、`implicit`、JWT bearer grant，以及 phone/address 范围，还公布 device_authorization_endpoint。源码 `server/oidc.go` 的 `ResponseTypes`、`GrantTypes` 与 `CreateAuthRequest` 则限制为 code、可选 refresh 和 openid/profile/email/offline_access；文档也明确不支持设备码流程。

这是能力声明问题，不代表已证明存在绕过。建议显式限制 provider 的 discovery 配置；添加契约测试，确保每个公布的 grant、response_type、scope、端点均有实现和测试。不支持的能力不要出现在发现文档，减少标准 SDK 自动选择不受支持流程的机会。

### 2. 增加“浏览器扩展”接入模板

当前仅 web/spa/native 分类。扩展可按公共 SPA 成功接入，但开发者容易误填 `chrome-extension://...`，或错误生成客户端密钥。建议增加预设，生成公共客户端、S256、可选离线访问和 `https://<扩展ID>.chromiumapp.org/oidc` 精确回调说明。

回调地址、浏览器请求来源、退出回调分别管理，不能把允许的 CORS Origin 等同于 redirect URI。当前 `SetUserinfoFromToken` 由 redirects 推导 Origin 白名单；本次后台 GET 在扩展 host permission 下成功，但这不等于所有浏览器、其他客户端或携带 Origin 的请求都能成功。建议独立的精确 allowed_origins 配置，并覆盖 Chrome/Edge/Firefox 的扩展接入测试，禁止通配符放行。

### 3. 明确令牌错误的 HTTP 状态和错误码

本次已撤销 Access Token 调 UserInfo 返回 403，扩展兼容 401/403。建议对无效、过期、撤销令牌统一返回标准 Bearer invalid_token 响应，权限不足才区分 insufficient_scope；数据库/上游不可用保留 5xx，不混成账号失效。

尤其应检查 `token()`、`SetUserinfoFromToken`、刷新查询中数据库错误经过 OIDC 库后是否被折叠成 invalid_token/invalid_grant。此项是源码审阅建议，本次没有停数据库做故障注入；应补充协议端点的故障测试，而不仅是管理 API 的 503 测试。

### 4. 文档解释刷新令牌的生命周期和响应丢失策略

当前轮换、并发锁及重放撤销是已有能力，应该保留。需要给公共客户端提供“单一刷新协调者、原子保存新令牌、刷新请求响应丢失时不要盲目重试”的完整示例。本扩展用 Service Worker 串行刷新，并在不确定时要求重新登录。

中心会话当前绝对 12 小时，刷新不能延长；它不等同于用户理解的“记住登录”。建议后台和文档明确这一区别。如升级长期登录，另行设计可撤销的设备授权、最大寿命、闲置超时与设备管理，不能只扩大 Access Token 生命周期。

### 5. 给无后端客户端定义退出一致性方案

中心已支持 back-channel logout，但扩展不能提供公网接收端。本次用可见页面定期 UserInfo 复核，因此中心退出到扩展 UI 变化存在检查间隔，浏览器关闭时也不会持续检查。

建议接入文档按“有后端 / SPA / 扩展”分别描述退出保证，提供短会话与在线检查范例。“退出当前项目”和“退出所有中心会话”在 API 与 UI 上明确区分，不宣称所有项目瞬时退出。后续业务 API 应独立校验访问令牌，不能把头像显示已登录当授权依据。

### 6. 维护可运行的扩展参考客户端与文档一致性

现有 Go、SPA 与原生协议测试已很丰富，本次可补为正式的扩展参考实现，覆盖 Service Worker 休眠、多标签页刷新、关闭登录窗口、扩展重新加载、安装目录/ID 改变、头像相对 URL 和账号停权。

README 部分段落仍描述 Mailpit 默认/验证码只到 Mailpit，而当前 AGENTS 明确已经启用真实 QQ SMTP。`architecture.md` 的固定签名 key、清理、列表上限描述也与后续升级报告冲突。建议把“当前能力与当前运行配置”集中为一份维护文档，旧交付记录标为历史，避免接入方照旧文档误发邮件或重复实现已有功能。

## 已有优点与后续边界

DuoYu-ID 已有 PKCE、Argon2id、精确回调、刷新轮换、准入撤销、签名退出通知、密钥轮换、持久队列、角色控制及多项目协议测试，升级应复用这些基础，不需要重新设计一套私有登录协议。

这份报告是一次真实扩展接入后的工程评估，不是完整安全审计或 OIDC conformance 认证。生产 TLS、真实跨站 Cookie、实体设备、压力容量和独立安全评估仍需另外验收。

参考：

- DuoYu-ID：`README.md`、`docs/architecture.md`、`docs/session-upgrade-2026-10-27.md`、`docs/roadmap-implementation-and-tests-2026-10-27.md`、`server/oidc.go`、`server/refresh.go`、`server/main.go`。
- [Chrome Identity API](https://developer.chrome.com/docs/extensions/reference/api/identity)：授权窗口与 chromiumapp.org 回调。
- [Chrome Storage API](https://developer.chrome.com/docs/extensions/reference/api/storage)：session 存储生命周期及访问范围。
