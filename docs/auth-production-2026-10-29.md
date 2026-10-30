# DuoYu ID 线上接入结果（2026-10-29）

- issuer：https://id.duoyu.link；线上 Discovery 已验证一致，支持 RS256、S256 和公共客户端。
- 项目 / client ID：app_RZ_RomO8Ov4odhcHmIo_
- 类型：extension，public=true，无客户端密钥。
- 回调：https://kklcklehkoeinjgfekeogcokngihdbmh.chromiumapp.org/oidc
- origin：chrome-extension://kklcklehkoeinjgfekeogcokngihdbmh
- refresh_enabled=true；scope=openid profile email offline_access。
- 已上传本扩展 PNG Logo，创建后 GET 回读确认配置。旧本地 client 在新服务返回403，搜索无匹配项目，因此创建线上项目。
- 管理凭证仅用于本次服务端请求，未写入前端、构建配置或报告。MCP 未配置到当前工具环境，本次使用文档指定的管理 REST API。

## 代码与验证

本机 .env 与 .env.example 已更新。保留原有 Discovery、PKCE、state/nonce、JWKS 验签及刷新轮换。会话新增 clientId 绑定，issuer 或 clientId 变化时清除旧会话。

通过：类型检查、认证协议回归、生产构建。协议回归覆盖错误 state、重复参数、回调路径、拒绝授权、签名、nonce、issuer、audience、azp、过期、未来 iat、刷新 subject、UserInfo subject、头像来源及 Discovery 能力缺失。

未完成真实账号交互验收：重新加载扩展，核对 chrome.identity.getRedirectURL('oidc') 与上述登记一致，再人工完成登录、头像昵称、退出、后台重启、刷新轮换与扫码/通行密钥。协议回归使用测试令牌，不代表线上真实登录已通过。未发送验证码邮件。原本的本地认证集成脚本会创建本地数据库测试账号，未用它代替线上验收。

## 升级建议

1. 管理 API 的403同时可能表示项目不存在或无权访问，建议提供明确且安全的项目查找/迁移指引，避免重复登记。
2. 为扩展提供回调及 origin 的诊断页面，并说明开发目录变化会影响未打包扩展 ID；发布后使用稳定商店 ID 单独登记。
3. 提供无需邮件的官方测试租户/测试账号与验收流程，覆盖一次性刷新、项目停用、CORS 和用户停用。
4. 角色属于项目权限快照；业务端如新增权限功能，应在线读取并由可保密服务端执行鉴权，不能依赖界面隐藏。
5. 管理凭证建议按项目及最小 scope 分配，接入完成后撤销临时凭证；不要将开发者凭证放进扩展。
