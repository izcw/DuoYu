# 认证环境配置

项目根目录 `.env` 配置认证服务（已被 Git 忽略），新环境复制 `.env.example`。

- `VITE_AUTH_ISSUER`：OIDC issuer 根地址，不是 `/login` 页面地址。
- `VITE_AUTH_CLIENT_ID`：认证中心登记的公开客户端 ID。
- `VITE_AUTH_SCOPE`：授权范围。

修改后运行 `pnpm zip` 并在浏览器扩展管理页重新加载扩展。配置在构建时写入扩展，不能存放客户端密钥、签名私钥等秘密。本扩展使用公开客户端 + PKCE，不需要 client_secret；签名私钥只保存在 DuoYu-ID 服务端。

认证中心 discovery 的 issuer、各端点及签发令牌的 issuer 必须与配置一致。扩展 host_permissions 自动使用配置的服务 origin。认证中心还需登记本扩展的实际回调 URI 和 allowed_origins。

2026-10-28 检查：`http://192.168.1.16:5252/.well-known/openid-configuration` 可访问，但返回 issuer 及端点为 `http://localhost:5252`。需由认证服务将公开 issuer 更新为 `http://192.168.1.16:5252` 后才能完成此地址的登录联调；不能通过放宽客户端 issuer 校验绕过。
