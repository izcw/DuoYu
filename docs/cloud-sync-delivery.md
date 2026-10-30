# 云同步交付说明

## 已实现

生产入口为 https://sync.duoyu.link，独立 Node.js 服务与 PostgreSQL `duoyu_extensions`，账号中心 `duoyu_id` 不承载业务数据。实现技术栈从设计建议的 Go 调整为 Node.js，复用本项目的 JavaScript、jose、测试工具及服务器已有 Node 24。

登录账号使用 issuer + sub 隔离 IndexedDB，访客继续使用原来的 duoyu 库。登录后先拉取云端，后续缓存支持离线修改；不会自动把访客桌面覆盖到账号中。账号面板提供 JSON 文件导入、精确到秒的同步时间、立即同步和可视化冲突处理。JSON 导入为增量添加，预览后确认，不覆盖现有收藏。

修改与 outbox 在同一个 IndexedDB 原生事务提交；覆盖现有 Dexie 写入路径，包括批量拖动及文件夹操作。每个事务一个 operation_id，本地操作时钟持久化，多个标签页使用 Web Locks 串行同步。修改约800ms防抖，连续修改最多延迟5秒开始同步，活跃页面约30秒拉取；重连和聚焦立即尝试。已准备请求原样重试，响应丢失不会重复创建。

云端以账号行锁分配提交修订号，整组布局原子提交，强制 RLS 加业务账号条件隔离。基于基础值进行字段合并；同字段、删除或布局冲突时保留云端，同时将本地原操作保存到冲突表并在应用内处理。通过三方对比界面选择本机、云端或手动修改；重新应用使用新操作 ID 和最新基础版本，保留处理历史。

同步收藏页、链接、文件夹、组件内容/位置/尺寸、Dock 链接、工作区、集合及独立标签、快捷方式、白名单设置、自定义图标和壁纸。图片按SHA-256去重，当前保存在PostgreSQL bytea；每日壁纸下载缓存、当前打开页面、原生浏览器未保存标签、登录凭证不上传。设置包括玻璃材质、搜索引擎、Dock顺序、布局模式及壁纸模式。

## 身份与秘密

扩展后台发出同步请求，前端不获取令牌。同步服务校验本项目 ID Token 的 RS256 签名、issuer、audience、azp、有效期，并用 Access Token 在线调用 UserInfo 验证相同sub。此为针对当前中心不透明Access Token和公共客户端无法进行保密introspection的双凭证适配；ID Token不是单独的API授权凭证。未来中心提供面向资源服务的受众令牌或受限introspection后，可迁移为标准资源服务鉴权。

访问令牌和ID Token留在扩展会话，刷新凭证放在可信上下文可读的扩展本地存储，不进入备份。旧会话缺少ID Token时需要重新登录；刷新响应需要返回新的ID Token才能继续同步。

`.env` 仅保存公开客户端配置；`.env.cloud.local` 是初始化数据库账号，`.env.sync-server.local` 是最小权限运行账号配置，均被Git忽略并限制文件访问。宝塔密钥Key.txt和work目录不提交。

## 部署结果

- 代码：`/www/wwwroot/duoyu-sync`。
- 私密配置：`/www/server/duoyu-sync.env`，root 600。
- 服务：`duoyu-sync.service`，独立系统用户duoyu-sync，监听127.0.0.1:5260。
- 数据库：duoyu_extensions；运行角色duoyu_sync_runtime，非超级用户/非表拥有者/无BYPASSRLS，只授予必要DML。
- 表结构：../DuoYu-Backend/server/sync/schema.sql；旧docs/cloud-sync-schema.sql仅为方案草案，不能与正式结构混用。
- Nginx：`/www/server/panel/vhost/nginx/sync.duoyu.link.conf`；使用现有有效通配符证书，不改变账号中心代理。DNS已指向129.204.50.181。
- 每日北京时间03:30运行duoyu-sync-backup.timer，AES-256-GCM加密备份保留14天。备份目录`/www/backup/duoyu-sync`，密钥`/www/server/duoyu-sync-backup.key`，root可读。

已验证线上HTTPS健康200、匿名请求401、未获允许来源403、systemd进程和备份timer active，首份备份GCM完整性校验通过。备份在同一服务器上，不等同于异地灾备；备份密钥应由管理员离线保存，异地副本和恢复演练仍需安排。没有将密钥写入Git或报告。

## 测试结果与边界

- 类型检查、扩展生产构建、原有认证协议回归通过。
- server/sync测试11项通过：双凭证校验、幂等、字段合并与冲突、原子布局、删除防复活、真实非owner角色RLS、并发修订号、账号隔离、增量完整性、附件验证。
- cloud-client：真实Dexie + fake-indexeddb验证同事务捕获、回滚、并发写、远端应用抑制、删除和独立标签变化。
- cloud-integration：实际客户端同步代码与本地测试PostgreSQL联调，验证云端初始化、离线补传、冲突副本、丢失响应重试、上传图标资源引用。身份入口在测试中模拟，不发送真实邮件。
- cloud-ui：临时Edge扩展配置验证访客启动、首页网格、登录面板，无JavaScript异常；实际扩展ID确认是kklcklehkoeinjgfekeogcokngihdbmh。

尚未替用户在生产上完成真实账号登录并修改收藏的交互验收。重新加载扩展、重新登录后，若要上传旧桌面，请先导出多鱼 JSON 备份，再在账号面板导入文件。用户真实数据未被测试脚本写入或清空。

当前限制：自动同步调度运行在打开的新标签页中；全部关闭后队列保留，下次打开恢复，不保证后台持续上传。未启用浏览器alarms或offscreen同步。图片单个20MiB、账号附件100MiB；结构数据8MiB/10000实体（含保留记录），单操作最多2000变更/4MiB，导入不覆盖已有账号。暂不自动清理历史变更、回执或删除标记，容量达到上限会明确报错并保留本地队列；没有定期删除幂等回执造成旧操作重复执行的窗口。

## 本地检查

```powershell
pnpm typecheck
pnpm build
pnpm test:auth
pnpm test:cloud:client
pnpm test:cloud:server
pnpm test:cloud:integration
pnpm test:cloud:ui
```

服务器及集成测试只连接本机55432的duoyu_sync_test测试库，需本地duoyu-postgres-dev容器及专用测试库；不允许改为生产数据库。生产迁移必须使用管理员/迁移账号，运行账号不可建表或修改RLS。

2026-10-30：后端及管理端已移至同级独立项目 DuoYu-Backend。宝塔网站的反向代理列表已登记 sync.duoyu.link，进程仍由 systemd 管理。

