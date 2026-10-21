# dsh-penpot

[![License: MIT](https://img.shields.io/badge/license-MIT-black.svg)](LICENSE)
[![DSH](https://img.shields.io/badge/DSH-%3E%3D0.2.1--rc.1-7c6cf5)](https://github.com/deepseek-ai)

把自托管的 [Penpot](https://penpot.app) 变成 DSH 的一个侧边栏插件：**右侧栏多一个「Penpot」标签页，里面就是完整的 Penpot 编辑器**；同时宿主注册 11 个模型工具——文件级增删改查、画板导出 PNG/JPEG/SVG，以及**通过 Penpot 内建 MCP 在在线文件里跑代码**（建画板、改样式、量尺寸都行）。不用手搓 HTTP，也不用再装 Penpot 侧插件。

> **English** — dsh-penpot embeds a self-hosted Penpot into the DSH web GUI sidebar: a same-origin reverse proxy (strips `X-Frame-Options` / CSP, rewrites `penpotPublicURI`, injects the auth cookie), 11 model-facing tools for file CRUD and board export, and an MCP client that talks to Penpot's **built-in** MCP plugin so the model can run code on the open canvas. MIT licensed; requires Penpot ≥ 2.17 and `dsh-better-sidebar` ≥ 0.28.

## 特性

- **内嵌编辑器**：侧栏 tab 里就是 Penpot 本体，和原站同源，登录态自动带过去。
- **文件级工具**：列团队/项目/文件、新建、改名、复制、删除（回收站，可恢复），不需要浏览器。
- **画板导出**：逐板导出 PNG/JPEG/SVG（1–4x），落盘并返回本地路径与可点开的链接。
- **画布级编辑**：接 Penpot 2.17 自带的 MCP 插件，在**当前打开的文件**里执行代码，结果以 JSON 回传。
- **零 Penpot 侧安装**：不需要往 Penpot 里装任何插件。

## 它是怎么拼起来的

| 半侧 | 文件 | 作用 |
| --- | --- | --- |
| 宿主 | `lib/index.js` | ① 注册 `/penpot/status`、`/penpot/files`、`/penpot/open`、`/penpot/refresh` 四条只读 JSON 路由，外加 `POST /penpot/files/{create,rename,duplicate,delete}` 四条变更路由（与 GUI 同源）；② 注册 11 个 `penpot_*` 模型工具；③ 另起一个反向代理端口（默认 `9002`）把 Penpot 整站转发过来，**并且正确转发 WebSocket upgrade**（Penpot 的 `/ws/notifications` 与 MCP 的 `/mcp/ws` 都要用）；④ 导出：`GET /penpot/file-info`、`POST /penpot/files/export`、`GET /penpot/exports/<file>`，把 Penpot exporter 的图落到磁盘再回发给浏览器；⑤ MCP：`GET /penpot/mcp/status`、`POST /penpot/mcp/call`，宿主自己当 MCP 客户端，走 `POST <origin>/mcp/stream?userToken=…`（JSON + SSE） |
| 浏览器 | `lib/client.js` | 通过 `ctx.betterSidebar.registerTab` 注册 tab `dsh-penpot:design`，顶栏带状态点、文件下拉、新建/改名/复制/删除、导出、MCP、刷新、外部打开，用 iframe 内嵌代理后的编辑器 |
| 清单 | `cordis.patch.yml` | 只 insert 一行宿主插件 `id: penpot` |
| 编解码 | `lib/transit.js` | 无依赖的 transit+json 实现（Penpot RPC 与 `/api/export` 都是 transit） |

### 为什么需要一个反代端口

Penpot 响应头带 `X-Frame-Options: SAMEORIGIN`，并且把公开地址（`PENPOT_PUBLIC_URI`）写死在 `/js/config.js` 里，前端所有 API 调用都走这个绝对地址。直接 iframe 会被拒；从别的端口打开又会因为跨源被 CORS 挡住。代理做三件事：

1. 剥掉 `X-Frame-Options` / CSP / COOP / COEP 等禁止嵌入的响应头；
2. 把 `config.js` 里的 `penpotPublicURI` 改写成代理自己的 origin，让 SPA 同源调用 API；
3. 给每个请求补上 `auth-token` cookie，免登录——cookie 取自 `~/.penpot-auth.json`（也支持环境变量或手填）。

另外：请求上游时强制 identity 编码（代理要改写 `config.js`，不能直接透传 gzip/br）；`index.html` 里的 `config.js?version=` 会加固定后缀 `-pcfg1`，避免浏览器缓存住早期指向原端口的旧配置（白屏的元凶）。

## 前置条件

- 自托管 **Penpot ≥ 2.17**（内建 MCP 插件从 2.17 开始有）。
- **`dsh-better-sidebar` ≥ 0.28**（侧栏 tab 注册 API）。
- 两种票据，按需准备：
  - **access token**（文件级 RPC 用）：Penpot 设置 → 访问令牌，或环境变量 `PENPOT_ACCESS_TOKEN`；
  - **MCP key**（画布级代码执行用）：Penpot 设置 → 集成（Integrations）→ MCP key，会同时把 profile 的 `mcp-enabled` 置为 true。

## 安装

本插件是标准的 DSH 插件包（npm 包 + `cordis.patch.yml`）。还没发包到 npm 时用本地链接：

```powershell
git clone https://github.com/qunanchang/dsh-penpot.git
# 1) 在 profile 的 package.json 里加一条 link 依赖，并加入 dsh.profile.bundles
#    ~/.dsh/profiles/web/package.json
#    "dependencies": { "dsh-penpot": "link:./dsh-penpot" }
#    "dsh": { "profile": { "bundles": ["dsh-better-sidebar", "dsh-penpot"] } }

# 2) 安装到 profile
dsh plugin --profile web install

# 3) 宿主半侧改动必须重启
dsh web
```

浏览器半侧跟着 GUI 刷新即可；宿主半侧（反代、`/penpot/*` 路由、模型工具）只在启动时加载。

## 配置

在 `~/.dsh/profiles/web/cordis.patch.yml` 里给 `penpot` 行加 `config`（全部可省略，默认值如下）：

```yaml
- id: penpot
  name: 'dsh-penpot'
  config:
    penpotOrigin: 'http://localhost:9001'   # 自托管 Penpot 地址
    proxyPort: 9002                          # 反向代理端口（占用时自动 9003..9006 再退到随机）
    proxyHost: '0.0.0.0'                     # 让局域网其它机器也能嵌入
    accessTokenFile: '~/.penpot-access-token'
    authCookieFile: '~/.penpot-auth.json'
    rpcTimeoutMs: 20000
    cacheMs: 20000                           # 文件列表缓存
    exportDir: '~/.dsh/penpot-exports'       # PNG/JPEG/SVG 落盘目录
    exportTimeoutMs: 120000                  # 单次导出的传输超时
    mcpTokenFile: '~/.penpot-mcp-token'      # Penpot 设置→集成→MCP key
    mcpToken: ''                             # 也可以直接给值（优先于文件）
    mcpTimeoutMs: 60000                      # 单次 execute_code 的超时
```

识别登录态的顺序：`penpotOrigin` 显式配置 → 环境变量 `PENPOT_URL`；access token：环境变量 `PENPOT_ACCESS_TOKEN` → 配置的 `accessTokenFile` → `~/.penpot-access-token`。

## 模型工具

重启后在任意 DSH 会话里可用（参数与 Penpot RPC 的字段一一对应，返回都是扁平 JSON）：

| 工具 | 参数 | 作用 |
| --- | --- | --- |
| `penpot_status` | — | Penpot 可达性、登录态、代理端口、profile 邮箱 |
| `penpot_files` | `refresh?` | 跨团队/项目列出文件（按 modifiedAt 倒序），默认走 20s 缓存 |
| `penpot_open` | `file_id`（必填）、`team_id?`、`page_id?` | 返回可直接嵌入的 `url` 与原站 `externalUrl`；缺 teamId/pageId 时自动补 |
| `penpot_create_file` | `name`、`project_id?` | 建文件；缺省落到第一个团队的第一个项目 |
| `penpot_rename_file` | `file_id`、`name` | 改名 |
| `penpot_duplicate_file` | `file_id`、`name?` | 复制（RPC 参数键是 `file-id`） |
| `penpot_delete_file` | `file_id` | 移到回收站（Penpot 里可恢复） |
| `penpot_export` | `file_id`、`page_id?`、`object_ids?`、`scale?`、`format?` | 把画板导出成 PNG/JPEG/SVG 落到 `exportDir`，返回本地路径与 `/penpot/exports/...` 链接；缺省导出该页全部根画板 |
| `penpot_mcp_status` | — | 浏览器里那个 Penpot 文件是否已连上 MCP：`{ok, connected, file, page, selection, error, tokenPresent}` |
| `penpot_run_code` | `code`（必填） | 在**当前打开的文件**里同步执行代码（函数体，可用 `penpot` / `penpotUtils` / `storage`），`return` 的值以 pretty JSON 返回，附 `log` |
| `penpot_api_info` | `type`（必填）、`member?` | 查 Penpot 插件 API 文档：`api_info('Board')`、`api_info('Board','width')` |

工具与 HTTP 路由共用同一层 `core*()` 实现，两边行为一致。文件级操作走 access token，不需要浏览器；**画板级编辑（`penpot_run_code`）走 Penpot 内建 MCP**，需要浏览器里那个文件是打开的。

## 侧栏使用

1. 打开 DSH Web GUI，点右上角「打开右侧边栏」（或 `+` 新建标签页）；
2. 在标签列表里选 **Penpot**；
3. 顶部横条：状态圆点（绿=在线）、文件下拉、**＋ 新建**、**✎ 改名**、**⧉ 复制**、**🗑 删除**（移入回收站）、**导出**、**MCP**、刷新、外部打开；
4. 新建/改名/复制/删除都会弹模态框（Enter 确定、Esc 取消），成功后自动刷新列表并选中目标文件；
5. 选中的文件记在 `localStorage` 的 `dsh-penpot:selected-file`，下次进来直接打开；
6. 「导出」弹窗：选页面（下拉显示每页画板数）、倍率 1–4x、格式 PNG/JPEG/SVG，点「开始导出」逐板导出，结果显示文件名、体积和可点开的链接；
7. 「MCP」弹窗：查看连接状态（绿点 = 已连上浏览器里的那个文件），写一段代码点「运行」，结果与 `log` 直接回显。

## Penpot 内建 MCP（在画布上跑代码）

Penpot 2.17 自带一个 MCP 插件：工作区打开时，只要 profile 里 `mcp-enabled=true` 且存在 `type=mcp` 的 access token，前端会自己把插件装进 SPA，并连到 `ws://<public-uri>/mcp/ws?userToken=…`。宿主是这条 WebSocket 的另一端——它用 `POST /mcp/stream?userToken=…`（MCP streamable HTTP）发 `execute_code`，插件在页面里执行并回结果。

**这就是「无需再装 Penpot 侧插件」的原因**：浏览器端那半个插件是 Penpot 自己带的，我们只负责把 WS 代理出去，并在宿主里实现 MCP 客户端。

前置条件（一次性）：

1. Penpot 里打开 设置 → 集成（Integrations），生成 **MCP key**（会同时把 `mcp-enabled` 置为 true）；
2. 把 key 写进 `~/.penpot-mcp-token`（纯文本一行，JWE）；
3. 浏览器里那个 Penpot 文件要**开着**（插件永远跟着当前打开的文件走，同一 token 只允许一条连接）。

反代必须转发 WebSocket 握手头（`Connection: Upgrade` / `Upgrade: websocket`），否则插件连不上、`penpot_mcp_status` 会一直 `connected:false`——这条在 `lib/index.js` 的 `server.on('upgrade', …)` 里已处理，并顺带修好了 Penpot 自身的 `/ws/notifications`。

## 自检脚本

需要本机有跑着的 Penpot（默认 `http://localhost:9001`）与对应凭证；假 ctx 的那几个不需要。

```powershell
node .\test\harness.mjs           # 假 ctx 起宿主：验 status/files/open + 代理头 + cookie 注入
node .\test\client-harness.mjs    # 假 ModuleLoader 验浏览器半侧的 tab 注册
node .\test\smoke-mutations.mjs   # 打真实实例的 /penpot/files/* 变更路由（会建/删探针文件）
node .\test\tools-smoke.mjs       # 假 ctx 收集 11 个工具并逐条 execute（含探针文件清理）
node .\test\open-smoke.mjs        # 验 penpot_open 的 teamId/url
node .\test\core-export.mjs       # 真实例：get-file 解析页面/根画板并导出前两块画板
node .\test\export-ui.mjs         # 假 React 跑侧栏导出弹窗：开窗→选页→POST→结果链接
node .\test\mcp-core.mjs          # 直测 internals：MCP status / run_code / api_info
node .\test\mcp-call.mjs          # 走 HTTP MCP 协议：initialize → tools/list → execute_code
node .\test\mcp-tools.mjs         # 拉四个 Penpot MCP 子工具的 inputSchema
node .\test\mcp-ui.mjs            # 假 React 跑侧栏 MCP 弹窗：状态行→改代码→POST→结果渲染
node .\test\proxy-ws.mjs          # 验反代 WebSocket upgrade 能连上（101）
node .\test\profile-props.mjs     # 验 transit 编解码与 profile 属性读取
```

`test/serve.mjs` + `test/embed.html` 是调试用的常驻代理和跨源 iframe 验证页（把里面的 `<team-id>` / `<file-id>` 换成自己的）。

## 排障

| 现象 | 原因 / 处理 |
| --- | --- |
| tab 有、编辑器白屏 | 先看 `/penpot/status` 的 `proxy.ready`、`penpot.reachable`；白屏九成是 `config.js` 里 URI 没改写成功（编码问题）或 URL 缺 `team-id` |
| 401 / 未登录 | `~/.penpot-auth.json` 过期；重新从浏览器 cookie 里取 `auth-token` 写回去，或只靠 access token 走 RPC |
| 改名/复制/删除按钮灰 | `/penpot/status` 的 `proxy.ready` 或文件选择缺失；客户端读的是嵌套的 `status.proxy.*` / `status.penpot.*` |
| 反代未就绪 | 9002–9006 都被占；看宿主日志里的 `proxy failed` |
| `+` 菜单里没有 Penpot | 宿主半侧没加载（没重启）或 `dsh-better-sidebar` 版本过旧（需 ≥ 0.28） |
| 工具列表里看不到 `penpot_*` | 同上：宿主没重启；启动日志应有 `[dsh-penpot] registered 11 penpot_* tools` |
| `penpot_mcp_status` 一直 `connected:false` | ① 浏览器里没开该 Penpot 文件；② `~/.penpot-mcp-token` 缺失/过期；③ 反代没转发 WS upgrade（看 Penpot 容器日志有没有 `New WebSocket connection established`） |
| MCP 报 `No Penpot instance connected for user token` | token 与「当前打开的标签页」不是同一个 Penpot profile；在设置→集成里重新生成 key 并更新文件 |
| 图片/字体 404 | 代理只转发不改路径；Penpot 前端用绝对路径，直连原站正常就说明是代理没起来 |

## 设计取舍与踩过的坑

- **反代不能复用 `HOP_BY_HOP` 头过滤**：那个列表里含 `connection` / `upgrade`，把握手必需的 `Connection: Upgrade` 删掉后 nginx 直接回非 101，MCP 与 `/ws/notifications` 全断。正确做法是跳过这两个头再显式写回。
- **导出路由绝不能写保活字节**：早期用 `setInterval` + `res.write(' ')` 防止长导出超时，结果在真正 `sendJson` 之前就把响应头发出去了，content-type/status 全失效、连接半途断。正解是只 `res.setTimeout(0)`。
- **不依赖 `@deepseek-ai/dsh-tools` 的 `defineTool`**：插件常以 junction 链到别的盘，realpath 落在 profile 作用域外，`dsh-app-boot` 的解析拦截不覆盖，裸 import 会 `ERR_MODULE_NOT_FOUND`。所以自带一个等价的 `defineLocalTool`（参数 spec → JSON Schema，`output.schema` 透传），只依赖 `ctx.tools.register` 的公开契约。
- **`/penpot/status` 同时返回扁平与嵌套字段**：扁平字段给老客户端，嵌套 `penpot{} / proxy{} / profile{}` 给新客户端，避免半截升级时按钮全灰。
- **`transit+json` 自己实现**：Penpot 的 RPC 与 `/api/export` 都是 transit，`~u` uuid、缓存码、tagged shape 三个点错一个就解不出数据结构，故在 `lib/transit.js` 里做了一份无依赖实现并与参考实现逐条对比验证。

## 路线图

- [x] PNG/JPEG/SVG 导出走模型工具与侧栏（Penpot 后端没有 export RPC：改走 nginx 暴露的 `POST /api/export` → exporter:6061，请求/响应都是 transit；宿主编解码后下载 `/assets/by-id/...` 落盘）
- [ ] 支持多 Penpot 实例（配置数组）
- [ ] 导出进度条（大文件多画板一次导出时目前只有「导出中…」）
- [ ] 侧栏内文件搜索

## 许可

[MIT](LICENSE)。与 Penpot、DeepSeek、dsh-better-sidebar 均无隶属关系；Penpot 是其各自所有者的商标。
