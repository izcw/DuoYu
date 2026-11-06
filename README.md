# 多鱼 DuoYu

基于 Vue 3、TypeScript、WXT 和 GridStack 的 Chrome Manifest V3 新标签页扩展。

业务后端与管理端使用 Go、PostgreSQL、Vue 3、Element Plus 和 ECharts。正式入口：[多鱼管理系统](https://sync.duoyu.link/)，仅 DuoYu-ID 账号8888888888可登录。用户文件、配额、用户数据模板、官方默认模板及部署测试见 [后端与管理说明](../DuoYu-Backend/README.md)。

## 环境与命令

- Node.js 22+
- pnpm 10.18.0（仓库提交锁文件）

```sh
pnpm install
pnpm dev
pnpm check
pnpm build
pnpm zip
```

浏览器冒烟测试（先执行 `pnpm build`）：

```sh
pnpm exec playwright install chromium
pnpm test:smoke
pnpm test:search
pnpm test:engines
pnpm test:wallpaper
```

可用 `TEST_BROWSER_CHANNEL=msedge` 或 `chrome` 指定已安装的浏览器
（PowerShell：`$env:TEST_BROWSER_CHANNEL = 'msedge'`）。
测试使用独立临时用户目录，不接触个人浏览器资料；验证尺寸、壁纸分辨率、
时钟更新、窄屏、壁纸失败回退和 Bing 搜索。冒烟测试依赖外部壁纸服务。
`test:search` 使用固定接口响应验证 15 个交互场景，不依赖外部联想或壁纸服务：
中文输入法、清空、过期响应、长句回退缓存、空响应、异常响应、超时、
键盘滚动、Esc、按钮搜索和窄屏触摸。
`test:engines` 验证五个引擎的新标签页跳转、查询编码、轮盘反向动画、
快速开合、键盘操作、窄屏触摸、减少动态效果及引擎选择持久化。

`pnpm test:review` 在生产构建后运行三端回归脚本，默认使用 Edge，
也可通过 `TEST_BROWSER_CHANNEL` 设置支持该变量的用例。每项输出和退出状态写入
`work/review-regression-时间戳/`，任意失败都会使汇总命令失败。
该入口覆盖两端管理 API 错误响应、扩展认证协议、本地数据、搜索、引擎、收藏、
桌面多选/碰撞/尺寸边界、文件夹排序/分页/删除恢复、工作区 CRUD/拖拽/跨窗口/键盘焦点、离线背景可读性、认证会话恢复、资源清理、冲突处理、壁纸缓存/上传/选择竞争、商店分类竞态/分页重试、快捷轮盘、Dock 排序与转移，以及认证等待期间的退出和跨页面账号隔离；
不包含真实 OIDC 登录、服务器数据库测试和依赖外网的冒烟测试。三端源码需按当前同级目录存放。

`pnpm test:import:race` 验证 JSON 导入关闭重开、旧预览/提交反馈、选项快照及卸载边界，
`cloud-account-ui.mjs` 额外通过真实浏览器验证取消后重新打开、旧文件延迟读取和数据库持久化。

`pnpm test:linux` 需要运行中的 Docker、Go 编译器和 `GO_BINARY` 环境变量。
它交叉编译两套 Go 服务及测试，在专属 PostgreSQL 容器内运行 Node/Go 全套测试，
再启动真实 Linux 服务入口，验证发现文档、迁移、非法配置/端口占用退出码及 SIGTERM。
三服务各执行 200 次、并发 8 的健康检查并保存延迟；这是连通性检查，不是业务容量结论。
只挂载此次复制的源码/产物，不映射宿主端口、不使用已有数据卷，也不启动邮件工作器。
结束时按专属标签核验并清理容器；证据、运行时版本、镜像摘要和二进制 SHA-256 保存在
`work/linux-release-*/`。首次需要下载镜像和锁文件中的同步服务依赖。

`pnpm test:restore` 在 Windows PowerShell 7、Docker 与 `GO_BINARY` 环境下执行真实隔离恢复：
ID 备份脚本 → 新数据库恢复 → 全表/序列/文件核对 → 恢复后的 ID API/JWKS；
业务全量与增量加密快照 → `pg_restore` → 表数据、RLS 策略和文件哈希核对。
异常检查覆盖已有目标、清单漏列、错误密钥及密文损坏。仅使用合成数据，无宿主端口和邮件 worker；
容器按专属标签清理，证据保存在 `work/restore-drill-*/results.json`。
该演练不替代实际生产备份、生产数据规模下的恢复耗时和业务切换验收。

`node scripts/source-review-inventory.mjs` 生成源码审阅台账 `work/review-2026-11-04/SOURCE-REVIEW.json`。
盘点包含源码、配置、依赖清单、脚本与文档，排除秘密、生成目录和二进制资产。
文件哈希只用于标识版本；有范围和证据的审阅记录单独标记，修改后会转为待复审。
未登记完整逐文件记录不代表此前没有阅读或测试，也不能把已盘点数当成已审完数。

`pnpm test:auth:isolated` 验证真实 ID → 扩展 → HTTPS → Go 业务入口 → Node 同步 → PostgreSQL 链路：
OIDC 登录、并发续期、来源限制、收藏上传、新浏览器资料下载恢复、浏览器重启、退出撤销及业务账号停用。
运行前设置 `DUOYU_TEST_DATABASE_URL`（仅接受本机 `duoyu_sync_test` 数据库）与
`GO_BINARY`（Go 可执行文件路径），并先构建 ID 登录前端。脚本需要 Node.js 24 的 Argon2 支持。
脚本在随机 schema 中创建临时账号，启动仅监听本机的 API 服务，单独构建测试扩展；
使用临时浏览器资料，不读取 `.env.local`、不启动邮件工作进程，结束后删除 schema。
本机 TLS 使用一次性证书，仅让测试浏览器信任其公钥，不修改系统证书库或放宽产品 HTTPS 要求。
证据保存在 `work/auth-isolated-*/`；构建、失败截图、服务日志与清理结果保留，临时凭据不用于生产。
`pnpm test:id:pages` 在这条链路后检查身份中心 20 个管理/账号页面的 1440/390px 布局与访问权限，
并通过真实界面验证昵称持久化、项目角色创建/改名/默认值、成员分配和删除后的角色转移，
项目 Logo 上传与创建/修改、准入名单去重/清空、黑名单保存/清空、开发者凭证 HTTP/MCP 权限变更与轮换/撤销，
以及注册开关恢复、邮件模板预览的 503 错误提示和重试。预览不会发送邮件。
`pnpm test:id:role-race` 单独验证真实角色组件逻辑的乱序请求、过期失败、成员路由切换和卸载隔离。
`pnpm test:id:management-race` 验证开发者凭证、项目 Logo/配置检查和邮件预览的异步隔离。
也验证旧保存/删除确认/凭据轮换响应不会污染新项目页面或改变当前路由。
`pnpm test:admin:management-race` 验证业务管理的上传、保存、删除确认、默认模板和概览加载在路由切换及卸载时的行为。
`pnpm test:admin:isolated` 增加真实业务管理 OIDC 登录、13 个页面的 1440/390px 检查、配额保存与 CSRF 拒绝，
以及组件创建/修改/发布/删除、真实同步模板快照发布和删除、壁纸上传/草稿隐私/发布预览/删除。
还会延迟真实上传请求并通过侧栏切换编辑页，验证过期结果不污染新草稿、资源不存在时禁止保存。
所有写操作均使用临时 schema 与专属文件目录。`test:auth:integration` 也指向隔离入口；旧脚本保留作历史参考。
这两项需先构建相应管理前端；页面显示检查不等同于每个按钮和业务操作全部验收。

`pnpm test:id:security` 在同一隔离链路后验证虚拟 WebAuthn 注册、二维码图像解码、
独立浏览器扫码确认与一次性授权、TOTP 绑定/登录/重放拒绝、恢复码消费和解绑后的跨浏览器会话撤销。
邮箱验证码直接写入临时测试 schema，不发送邮件；通行密钥使用 CDP 虚拟认证器，不能代替实体手机/硬件验收。
可以将 `--id-pages --admin-pages --id-security` 合并传给 `scripts/auth-isolated.mjs`。
增加 `--without-refresh-scope` 可验证公开构建配置遗漏续期 scope 时，认证配置会补齐请求，并通过真实用户同意、续期、重启和退出流程。
增加 `--large-restore` 可验证真实备份恢复界面：通过扩展后台和 Go/Node 服务创建、修改 2,001 条临时书签，再从界面恢复并核对 PostgreSQL 与 IndexedDB 内容。该检查使用隔离账号，不能代替生产备份恢复演练。
`--import-boundaries --export-boundaries` 在同一个隔离环境中验证便携 JSON。账号切换或 IndexedDB 中断时，导入的图片、收藏、同步记录和文件凭据一起回滚；重新预览同一文件后可重试。游客导出使用游客偏好，登录后导出使用当前账号的偏好和布局，过期页面会提示重新导出。
`--import-layout` 验证来源页的续页复用、文件夹关系、网格边界及 2,000 条变更上限。`--large-restore --sync-sustained` 可单独进行十分钟持续读取，使用隔离账号的 2,001 条书签，并记录每批延迟、页面内存和同步服务测试进程的连接池状态。
`node scripts/capture-io.mjs` 检查真实 IndexedDB 的同步发件箱读取成本与原子性。`--large-restore --device-write-load` 可在隔离联调中打开两个独立浏览器资料，持续五分钟并发修改收藏，核验单端离线保存、重新联网及两端收敛。

三仓库审查台账可依次用 `node scripts/source-review-inventory.mjs` 和 `node scripts/module-inventory.mjs` 重建。前者按文件内容标记已有的定向审阅，后者核对静态本地导入和引用资源，用于查找缺失依赖。模板自动注册、动态加载与跨端运行时消息还需结合实际入口测试。

`node scripts/preference-account-ui.mjs` 验证旧标签页切换账号时的布局和玻璃设置，`node scripts/startup-account-isolation-ui.mjs` 验证退出与较早登录结果的到达顺序。两个脚本都支持用 `TEST_EXTENSION_PATH` 指向解压后的发行目录。隔离联调的 `--id-pages` 同时检查身份管理路由对匿名、普通账号及管理员跨来源写请求的拒绝行为。
ID 管理端须使用完整 `pnpm build`（包含独立登录组件）；只运行 `vite build` 会清掉登录组件目录，联调脚本会在创建测试数据前检查必需产物。

`pnpm test:browser:compatibility` 在本机 Edge 与 Chrome 的独立资料中检查 MV3 后台消息、
搜索、1440/390px 布局和必要 API。Chrome 使用 CDP 安装本次扩展，调试开关只作用于该测试进程。
`pnpm test:workspace:stability` 在 Edge 预热后循环开关、搜索工作区 40 次，记录 GC 后堆内存、
DOM 和事件监听器；阈值用于发现本机短时资源累积，不是生产容量或长期无泄漏保证。

开发模式由 WXT 启动 Chrome 并热更新。生产构建后，在 Chrome 打开
`chrome://extensions`，开启开发者模式，点击「加载已解压的扩展程序」，
选择 `.output/chrome-mv3`。打开新标签页即可使用。

ZIP 解压分发默认使用仓库根目录 `extension-identity.json` 中的公开公钥。构建后的固定 ID 为
`ckibhfgimlfmnmlpdnjgpofdddchkalh`。账号中心项目登记该 ID 的 `https://ckibhfgimlfmnmlpdnjgpofdddchkalh.chromiumapp.org/oidc` 回调，账号中心、业务 Go 和 Node 同步服务均允许对应的 `chrome-extension://ckibhfgimlfmnmlpdnjgpofdddchkalh` 来源。
未来创建商店条目时，可以用对应商店的公开 `VITE_EXTENSION_PUBLIC_KEY` 覆盖构建身份，并为该商店登记其精确的回调和来源。

从旧版迁移时，先在旧版完成同步。游客或只保存在本机的数据，在旧版的「设置 → 备份与恢复」导出 JSON。将新版解压到另一目录后加载，登录原账号并核对云端数据。需要迁移游客收藏时，在新版「备份与恢复」导入旧版导出的 JSON。导入会添加收藏，已云同步的数据请先核对，避免再次导入相同内容。确认数据齐全后再停用旧版。

`node scripts/extension-identity-ui.mjs <ZIP解压目录>` 验证实际交付包与仓库公钥一致，并在 Chrome/Edge 的两个目录核对 ID 和回调。省略目录时验证临时公钥覆盖和无效配置拒绝。
公钥获取方法见 [Chrome 官方文档](https://developer.chrome.com/docs/extensions/reference/manifest/key)。

## 目录

```text
public/                  原始 Logo、favicon 和扩展尺寸图标
src/entrypoints/newtab/   新标签页入口与界面组装
src/features/clock/      本地时间与日期
src/features/search/     搜索表单与浏览器搜索
src/features/wallpaper/  每日 4K 壁纸
src/features/desktop/    GridStack 生命周期与桌面适配
src/features/workspace/ 标签页工作区、集合与浏览器标签页同步
src/styles/              全局样式与设计变量
src/shared/storage/      Dexie 本地数据库与版本化表结构
wxt.config.ts            扩展构建、权限及 Manifest 配置
```

## 实现约定

- Vue 管理组件内容；GridStack 管理网格位置。桌面提供分类网址卡片，工作区提供标签页集合；登录 DuoYu-ID 后通过业务后端进行云同步，本地数据由 Dexie 持久化。
- 时间遵循设备本地时区，24 小时制，秒级更新。
- 搜索默认使用 Bing，可通过轮盘选择 Google、百度、GitHub 或 Yandex。
  搜索结果通过 `chrome.tabs.create` 打开独立标签页，保留当前页和输入。
  引擎偏好保存在 `chrome.storage.local`，申请 `storage` 权限；创建标签页无需 `tabs` 权限。
  联想统一由 Bing 提供，切换引擎后会显示来源提示，
  联想请求访问 `https://api.bing.com/`；完整主机权限范围见下方“扩展权限”。
  输入后立即请求 Bing 获取最多 10 条建议，并提前建立连接。最近查询在当前页面内存
  缓存 5 分钟（最多 100 条查询），不写入磁盘；重复输入直接命中缓存。
  连续输入时保留仍匹配的真实建议，取消旧请求并防止过期响应覆盖新结果；
  中文输入法组词期间不请求。失败时仍可直接搜索。
  首行始终提供完整输入的搜索入口。Bing 对部分长句返回 204 或空列表时，
  最多尝试两次较短前缀，并将返回内容标注为「相关」；不会截断实际搜索词。
  原始响应和最终回退结果各自使用有界内存缓存；整条请求链共享 4 秒超时。
  键盘选中项按文字而非数组下标保留，避免更新建议后误搜另一条。
- 壁纸文档：https://api-bimg-cc.apifox.cn/
- 壁纸接口：`https://api.bimg.cc/today?uhd=true&mkt=zh-CN`。
  直接加载图片，不读取网页或用户浏览记录；日期查询参数用于每日更新缓存。
  使用 Dexie（IndexedDB，数据库名 `duoyu`）持久化最近一张有效图片的 Blob、
  来源 URL 和保存时间。启动始终显示最近成功缓存的壁纸，不按日期隐藏缓存。后台获取壁纸时以 SHA-256 比较图片内容，图片未变则复用缓存；原图与首屏预览在同一跨标签页锁内更新，旧页面不会通过图片加载事件回写旧预览。日期参数只用于触发每日接口更新，不决定显示哪张缓存；
  断网或接口错误保留旧图；没有可用缓存时，按系统色彩模式显示白色或黑色背景，无法检测时按本地时间切换。
  Web Locks 合并多个标签页的下载；图片解码验证成功才覆盖缓存，
  失败后每 5 分钟重试，恢复联网时立即重试。只保存一张，避免缓存无限增长。
  壁纸下载申请 `api.bimg.cc` 和其图片重定向域名 `bing.com` 的主机权限。
  `test:wallpaper` 验证离线重载、浏览器重启、跨日更新失败、损坏图片、
  恢复联网及多个标签页并发。缓存依赖浏览器资料目录，清除扩展数据或卸载会丢失。
  当前搜索引擎偏好仍保留在 `chrome.storage.local`，后续业务表通过 Dexie 版本迁移添加。
- Logo 来自用户提供的 `duoyu.png`，favicon 保留原始文件。扩展图标按 Chrome 尺寸生成。
- 业务后端位于 `../DuoYu-Backend`：Go 负责业务 API、管理和资源，Node 负责同步事务，PostgreSQL 保存服务端数据。身份认证由独立的 `../DuoYu-ID` 提供。

### 扩展权限

当前 Manifest 申请 `http://*/*` 和 `https://*/*`，用于用户添加的任意网站标题、图标读取，以及认证、同步和壁纸请求；并非只访问 Bing。后台元数据消息校验扩展 ID 和新标签页来源，远程读取省略 Cookie 并限制响应大小。`tabs` 和 `tabGroups` 用于工作区标签页读取与分组，`storage` 用于设置与会话，`identity` 用于认证，`favicon` 用于网站图标。权限收窄需同步设计按站点授权和失败回退，不能直接删除现有权限。

## 发布前

执行 `pnpm check` 与 `pnpm build`，检查生产扩展的新标签页、Bing 搜索、
断网背景、窗口缩放及刷新行为。`pnpm zip` 生成商店提交包；不会自动发布。

## 标签页工作区

工作区采用空间 / 集合 / 标签页三级结构。每次打开按侧栏顺序进入第一个实际空间。在搜索框外，W/S 或 ↑/↓ 按侧栏顺序循环切换，包含置顶的“标记”视图。Ctrl/Cmd+F 聚焦工作区搜索。删除自定义空间会将其集合移回默认空间，默认空间不可删除。

在首页或收藏页，焦点离开搜索框后，滚轮、W/S 或 ↑/↓ 可循环翻页。D 或 → 打开标签工作区，A、← 或 Esc 返回首页。输入框、菜单和弹窗优先处理自己的按键。首页右下角显示操作提示。

也可以通过快捷 Dock 或壁纸轮盘的“标签工作区”进入；点击工作区外围留白可退出。普通壁纸空白左键不会进入工作区；轮盘展开时空白点击关闭轮盘。

- 左侧管理集合：新建、重命名、折叠、排序、删除和撤销；收藏可拖拽排序、跨集合移动，也可使用移动菜单。一键在后台打开整个集合。
- 右侧读取真实浏览器标签页，支持当前窗口/所有窗口切换、激活、关闭、拖拽调整浏览器顺序、单独保存及全部保存。拖入左侧集合即可收藏，同一集合重复保存同一 URL 会去重；保存不会自动关闭原标签页。
- 顶部搜索同时匹配集合名称、网页标题和网址。浏览器内部页面可以显示和切换，但只收藏 HTTP/HTTPS 网页；多鱼自身页面不列入待保存标签页。
- Dexie 保存集合及收藏，写入使用事务，多鱼页面间通过 `liveQuery` 更新。游客数据保留在本机；登录后的已保存集合按账号同步，浏览器实时打开的标签页列表与已保存集合分开处理。清除扩展资料会删除本机缓存。
- `tabs` 和 `tabGroups` 权限用于读取标题、URL、favicon 及管理原生群组；主机权限范围和用途见上文“扩展权限”。
- `pnpm test:workspace` 验证进入/退出、焦点和轮盘优先级；`pnpm test:workspace-collections` 使用独立浏览器资料验证真实标签页、拖拽保存、排序、跨集合移动、去重、撤销、搜索、批量打开、刷新恢复、跨页面更新、多窗口和窄屏布局。

## 通用轮盘实现

快捷轮盘保留用户网址及内置动作：

- **标签工作区**：管理当前打开的标签页、保存浏览任务并整组恢复。
- **翻译**：在新标签页打开翻译网站。“便签”和“画布”为现有预留动作，尚无独立功能页面；桌面组件商店中的便签可以正常保存内容。

收藏页通过左侧菜单进入，使用16列网格：首页5行，其他收藏页8行。支持图标/组件/文件夹、全库搜索、增删改、跨页与Dock拖拽、批量选择、尺寸调整和持久化。文件夹详情每页50项；删除文件夹保留内部网址。

收藏库使用独立的 Dexie v5 `libraryItems` 表，与工作区的 `tabCollections` 分开；升级保留现有记录。轮盘加载时按固定 ID 补齐功能入口，不重置用户自定义网址或排序。
收藏图标支持自定义图片 URL，默认使用 Chrome 的本地 favicon 接口（新增 `favicon` 权限），无需第三方图标代理；加载失败显示名称首字。实现依据 [Chrome favicon 文档](https://developer.chrome.com/docs/extensions/how-to/ui/favicons)。目前收藏库管理多鱼自己的网址，不修改浏览器原生书签。
`pnpm test:library` 验证轮盘兼容、两个入口、收藏增删改查、文件夹拖拽与排序、数据隔离、持久化和窄屏布局。

`src/shared/components/composite/RadialWheel.vue` 统一处理圆周布局、白点就近吸附、反向收起动画、拖拽排序和键盘操作。
`shape` 区分完整圆周与左侧半圆弧；`interaction` 预留 `clickButton`、`holdButton`、`dragButton`（0 左键、2 右键），入口组件按各自触发区域使用配置。
搜索引擎采用左键点击/长按，壁纸快捷轮盘采用右键点击/长按；两者都用左键拖拽图标排序。快捷轮盘中心不显示，保留直径 44px 的判定区域，中心范围内不会切换白点，展开后再次右键关闭。排序分别保存在 Dexie `shortcuts` 表的 `engines` 和 `wallpaper` 记录中。
`pnpm test:radial` 检查左右键差异、中心锁定、最近图标预览、关闭行为与搜索引擎排序持久化；`pnpm test:shortcuts` 覆盖网址添加、拖拽、长按跳转和空白区域限制。

组件分层：`shared/components/base` 存放基础 UI（如 BaseDialog），`shared/components/composite` 存放组合交互组件（如 RadialWheel），功能专用组件放在 `features/<功能>/components`（如 AddShortcutDialog）。基础弹窗统一处理遮罩、焦点限制、Escape 与焦点恢复，业务表单负责验证并提交数据。

## 玻璃材质

当前入口使用 CSS `backdrop-filter`，从已合成的局部背景采样，不再挂载旧 WebGL 画布。右上角提供真实、自然、柔和三档，并通过账号偏好保存。`desktop/glass/renderer.ts` 和 `LiquidGlassLayer.vue` 为历史实现，不能把它们的GPU指标当成当前页面指标。
`pnpm test:glass` 检查首页/收藏页的局部背景、三档材质、离线文字可读性及工作区焦点/动画。旧 `scripts/glass.mjs`、`workspace.mjs`、`widgets.mjs`、`widget-links.mjs`、`library.mjs` 保留历史模型参考；相应 package 命令已指向当前功能回归，不再要求不存在的 WebGL 或旧独立收藏弹窗。

### 统一玻璃样式

- `src/styles/tokens.css`：颜色、透明度、模糊档位、饱和度、高光和交互底色的唯一参数入口。WebGL 在初始化时通过 `src/shared/glass-material.ts` 读取同一组参数。
- `glass-surface`、`liquid-glass`：共用 CSS 背景与模糊材质，组件负责尺寸、圆角和布局。联想框与轮盘跟随全局玻璃档位；实色管理弹窗保留自己的外观。
- `glass-control`：默认透明的控件；与 `glass-interactive` 配合，统一 hover、按下、键盘焦点以及 ARIA 展开/选中状态。禁用控件不触发交互底色。
- 交互效果以引擎中心按钮为准：`#efefed`、16% 不透明度；不叠加额外模糊。移动、缩放等与几何相关的动画仍由具体组件负责。图标图片本身的底色不属于玻璃材质。

图标加文字的链接使用 `glass-interaction-owner` 包裹 `glass-interaction-target`，交互底色仅绘制在图标底座上，文字保持透明；该规则复用同一个交互材质。

壁纸首屏采用两级缓存：Dexie 保存完整原图；`wallpaper-preview.ts` 额外保存最长边 960px、最多 180 KB 的 JPEG 预览到 localStorage。`public/wallpaper-startup.js` 在应用脚本之前同步读取预览，填补 IndexedDB 与原图解码的等待时间；原图解码后直接显示，不做首次淡入。预览不可用时走原有默认背景，存储限制不会阻止原图显示。

后端与管理端已拆分到同级独立项目 DuoYu-Backend，本仓库仅保留扩展源码。
