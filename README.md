# 多鱼 DuoYu

基于 Vue 3、TypeScript、WXT 和 GridStack 的 Chrome Manifest V3 新标签页扩展。

业务后端与管理端使用 Go、PostgreSQL、Vue 3、Element Plus 和 ECharts。正式入口：[多鱼管理系统](https://sync.duoyu.link/admin/)，仅 DuoYu-ID 账号8888888888可登录。用户文件、配额、用户数据模板、官方默认模板及部署测试见 [后端与管理说明](../DuoYu-Backend/README.md)。

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
`test:search` 使用固定接口响应验证 14 个交互场景，不依赖外部联想或壁纸服务：
中文输入法、清空、过期响应、长句回退缓存、空响应、异常响应、超时、
键盘滚动、Esc、按钮搜索和窄屏触摸。
`test:engines` 验证四个引擎的新标签页跳转、查询编码、轮盘反向动画、
快速开合、键盘操作、窄屏触摸、减少动态效果及引擎选择持久化。

开发模式由 WXT 启动 Chrome 并热更新。生产构建后，在 Chrome 打开
`chrome://extensions`，开启开发者模式，点击「加载已解压的扩展程序」，
选择 `.output/chrome-mv3`。打开新标签页即可使用。

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

- Vue 管理组件内容；GridStack 管理网格位置。桌面提供分类网址卡片，工作区提供标签页集合；暂未接入云同步。
- 时间遵循设备本地时区，24 小时制，秒级更新。
- 搜索默认使用 Bing，可通过轮盘选择 Google、百度或 GitHub。
  搜索结果通过 `chrome.tabs.create` 打开独立标签页，保留当前页和输入。
  引擎偏好保存在 `chrome.storage.local`，申请 `storage` 权限；创建标签页无需 `tabs` 权限。
  联想统一由 Bing 提供，切换引擎后会显示来源提示，
  联想请求仅申请 `https://api.bing.com/*` 主机权限。
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
- 后端尚未选型，前端不绑定后端供应商。

## 发布前

执行 `pnpm check` 与 `pnpm build`，检查生产扩展的新标签页、Bing 搜索、
断网背景、窗口缩放及刷新行为。`pnpm zip` 生成商店提交包；不会自动发布。

## 标签页工作区

工作区采用空间 / 集合 / 标签页三级结构。左侧可新建、切换、重命名空间，中间只显示当前空间的集合，右侧保留浏览器实时标签页。Dexie v6 将已有集合迁入「个人空间」，记住当前设备上次选择的空间；删除自定义空间会将其集合移回默认空间，不删除标签页记录，默认空间不可删除。

左键点击壁纸空白区域进入工作区；点击右上角关闭按钮、页面外围留白或按 Escape 退出，保留原有淡入淡出动画。轮盘展开时，第一次空白点击只关闭轮盘。

- 左侧管理集合：新建、重命名、折叠、排序、删除和撤销；收藏可拖拽排序、跨集合移动，也可使用移动菜单。一键在后台打开整个集合。
- 右侧读取真实浏览器标签页，支持当前窗口/所有窗口切换、激活、关闭、拖拽调整浏览器顺序、单独保存及全部保存。拖入左侧集合即可收藏，同一集合重复保存同一 URL 会去重；保存不会自动关闭原标签页。
- 顶部搜索同时匹配集合名称、网页标题和网址。浏览器内部页面可以显示和切换，但只收藏 HTTP/HTTPS 网页；多鱼自身页面不列入待保存标签页。
- Dexie v4 新增 `tabCollections`，保留已有壁纸、轮盘及桌面布局数据。写入使用事务，多鱼页面间通过 `liveQuery` 更新集合；目前仅保存在当前设备，卸载或清除扩展数据会删除收藏。
- 新增 `tabs` 权限以读取标题、URL 和 favicon。更新后需重新加载扩展，并接受浏览器提示的权限变更。没有新增全站主机访问权限，也不会向服务器上传标签页。
- `pnpm test:workspace` 验证进入/退出、焦点和轮盘优先级；`pnpm test:workspace-collections` 使用独立浏览器资料验证真实标签页、拖拽保存、排序、跨集合移动、去重、撤销、搜索、批量打开、刷新恢复、跨页面更新、多窗口和窄屏布局。

## 通用轮盘实现

快捷轮盘新增两个内置功能入口，使用用户提供的 `label.png` 和 `Collection.png`：

- **标签工作区**：管理当前打开的标签页、保存浏览任务并整组恢复。
- **收藏库**：参考应用启动台，长期保存网址；图标网格与文件夹预览、全库搜索、添加/编辑/删除、拖拽排序及拖入文件夹。整理模式可通过编辑表单更换文件夹，支持键盘操作；删除文件夹只移除分类，内部网址返回首页。

收藏库使用独立的 Dexie v5 `libraryItems` 表，与工作区的 `tabCollections` 分开；升级保留现有记录。轮盘加载时按固定 ID 补齐功能入口，不重置用户自定义网址或排序。
收藏图标支持自定义图片 URL，默认使用 Chrome 的本地 favicon 接口（新增 `favicon` 权限），无需第三方图标代理；加载失败显示名称首字。实现依据 [Chrome favicon 文档](https://developer.chrome.com/docs/extensions/how-to/ui/favicons)。目前收藏库管理多鱼自己的网址，不修改浏览器原生书签。
`pnpm test:library` 验证轮盘兼容、两个入口、收藏增删改查、文件夹拖拽与排序、数据隔离、持久化和窄屏布局。

`src/shared/components/composite/RadialWheel.vue` 统一处理圆周布局、白点就近吸附、反向收起动画、拖拽排序和键盘操作。
`shape` 区分完整圆周与左侧半圆弧；`interaction` 预留 `clickButton`、`holdButton`、`dragButton`（0 左键、2 右键），入口组件按各自触发区域使用配置。
搜索引擎采用左键点击/长按，壁纸快捷轮盘采用右键点击/长按；两者都用左键拖拽图标排序。快捷轮盘中心不显示，保留直径 44px 的判定区域，中心范围内不会切换白点，展开后再次右键关闭。排序分别保存在 Dexie `shortcuts` 表的 `engines` 和 `wallpaper` 记录中。
`pnpm test:radial` 检查左右键差异、中心锁定、最近图标预览、关闭行为与搜索引擎排序持久化；`pnpm test:shortcuts` 覆盖网址添加、拖拽、长按跳转和空白区域限制。

组件分层：`shared/components/base` 存放基础 UI（如 BaseDialog），`shared/components/composite` 存放组合交互组件（如 RadialWheel），功能专用组件放在 `features/<功能>/components`（如 AddShortcutDialog）。基础弹窗统一处理遮罩、焦点限制、Escape 与焦点恢复，业务表单负责验证并提交数据。

## WebGL 玻璃

卡片上方可选择真实、自然、柔和，偏好保存在 `chrome.storage.local`。`desktop/glass/renderer.ts` 使用单个低功耗 WebGL2 上下文：连续边缘法线与有界平滑位移表现折射，只保留细窄的方向性外缘高光，去除环状内高光和暗槽；模糊半径使用 CSS 像素换算纹理 mip 级别，图标和文字仍为 DOM。这是实时材质近似，不是品牌系统渲染器的复刻。
保留壁纸原始纹理尺寸（包括 4K）和设备原生 DPR，不再自动降分辨率。WebGL2 直接上传原图并生成 mipmap，无需 CPU 中间缩放；真实档每像素一次纹理采样，自然/柔和档五次。画布裁剪到可见卡片范围，以 64px 网格量化边界减少拖动中的重新分配；scissor 进一步限制片元覆盖。材质、纹理及位置未变化时跳过绘制。只在壁纸变化时上传纹理，静止与后台标签不持续渲染。WebGL2 不支持、纹理超出硬件限制或上下文丢失时明确使用 CSS 回退，不悄悄降低 GPU 画质；上下文恢复后重建资源。
`pnpm test:glass` 检查三档输出、偏好恢复、DPR 2 原生清晰度、画布裁剪、静止及无关鼠标移动零重绘、真实位置变化后的停止及上下文丢失回退，记录实际绘制中的测试环境帧间隔；该数据不是所有设备的帧率保证。

### 统一玻璃样式

- `src/styles/tokens.css`：颜色、透明度、模糊档位、饱和度、高光和交互底色的唯一参数入口。WebGL 在初始化时通过 `src/shared/glass-material.ts` 读取同一组参数。
- `glass-surface`：常驻玻璃背景；`liquid-glass`：具有 WebGL 折射与 CSS 降级的背景。组件仅负责尺寸、圆角和布局。联想框、轮盘和弹窗也跟随全局玻璃档位（真实 3px、自然 10px、柔和 20px）。
- `glass-control`：默认透明的控件；与 `glass-interactive` 配合，统一 hover、按下、键盘焦点以及 ARIA 展开/选中状态。禁用控件不触发交互底色。
- 交互效果以引擎中心按钮为准：`#efefed`、16% 不透明度；不叠加额外模糊。移动、缩放等与几何相关的动画仍由具体组件负责。图标图片本身的底色不属于玻璃材质。

图标加文字的链接使用 `glass-interaction-owner` 包裹 `glass-interaction-target`，交互底色仅绘制在图标底座上，文字保持透明；该规则复用同一个交互材质。

壁纸首屏采用两级缓存：Dexie 保存完整原图；`wallpaper-preview.ts` 额外保存最长边 960px、最多 180 KB 的 JPEG 预览到 localStorage。`public/wallpaper-startup.js` 在应用脚本之前同步读取预览，填补 IndexedDB 与原图解码的等待时间；原图解码后直接显示，不做首次淡入。预览不可用时走原有默认背景，存储限制不会阻止原图显示。

后端与管理端已拆分到同级独立项目 DuoYu-Backend，本仓库仅保留扩展源码。

