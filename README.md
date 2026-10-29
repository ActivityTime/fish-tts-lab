# Fish TTS Lab · 鱼音色测试

一个带 WebUI 的 **fish.audio 原生 TTS / OpenRouter TTS** 音频测试工具。可在浏览器里调参、试听、下载合成音频；既可以作为**独立 Node 服务**运行，也可以打包为 **DSHT（DeepSeek Harness）侧边栏插件**直接嵌在酒馆面板里使用。

> 设计目标：一套前端、两种模式。同一个 `public/` 静态 WebUI，独立运行时浏览器直开 `localhost:18765`；作为 DSHT 插件时由侧边栏 tab 内嵌一个 iframe 指向同一地址。

---

## 特性

- **零外部依赖**：只用 Node 内置 `node:http / node:https / node:fs / node:path / node:url`，`npm install` 都不需要。
- **双后端**：
  - `fish` —— fish.audio 原生 TTS（`POST /v1/tts`，高质量、支持即时克隆 `references`）。
  - `openrouter` —— OpenRouter TTS（`POST /api/v1/audio/speech`，可用免费模型 `fish-audio/s2.1-pro-free:free`）。
- **调参可视化**：后端切换、API key、voice id、文本（`[tag]` 内联情感）、参考音频即时克隆、format / bitrate / sampleRate / speed / latency / normalize、OpenRouter 的 model / instructions、fish 的端点 URL / model 选择。
- **试听 + 下载**：内置 `<audio>` 播放器，一键下载；**完成后自动播放**（生成按钮旁勾选，可在历史点击时同样生效）。
- **本地历史记录**：最多 30 条，以 base64 dataURL 存浏览器 localStorage（可跨刷新/重开持久回放与下载，总量约 3.5MB 上限，超出丢最旧）。
- **API key 不落盘**：key 仅在请求时存在于内存，经后端转发给上游，服务端不回传、不写文件。
- **结构化错误回传**：上游返回的错误（如 401 鉴权失败、 quotas）会被解析成 `{ ok:false, status, error }` 在前端提示，不会把原始 HTML 甩给用户。

---

## 目录结构

```
fish-tts-lab/
├─ lib/
│  ├─ tts.js        # TTS 代理核心：请求体组装 + https POST + 错误解析（零依赖）
│  ├─ server.js     # HTTP 服务：静态资源 + /api/tts 代理 + /health
│  ├─ index.js      # DSHT cordis 插件入口：export apply(ctx) 启动 server（无 import 期副作用）；独立运行走 standalone.js
│  └─ client.js     # DSHT 客户端入口：betterSidebar.registerTab + iframe 嵌入 WebUI
├─ public/          # 前端 WebUI（原生 HTML/CSS/JS，零 CDN）
│  ├─ index.html
│  ├─ style.css
│  └─ app.js
├─ cordis.patch.yml # DSHT bundle 挂载声明（标准 insert 格式）
├─ package.json     # type:module / main / dsh.client 声明 / engines.node>=22
└─ README.md
```

---

## 运行模式一：独立运行

需要 **Node.js ≥ 22**（已实测 v22.22.2）。

```bash
cd fish-tts-lab
npm start          # = node standalone.js
# 或
node standalone.js
```

启动后浏览器打开 **http://localhost:18765/** 即可。

可用环境变量改端口（优先级：`FISH_TTS_PORT` > `PORT` > 默认 `18765`）：

```bash
FISH_TTS_PORT=18080 node lib/index.js
```

> 改端口时 `lib/client.js` 里的 `SERVER_PORT` 常量需同步修改（独立模式通常不必改）。

---

## 运行模式二：作为 DSHT 侧边栏插件

参考 `narrative-anchor`（NA）插件的纯 JS 客户端包装模式，无需构建步骤。

### 安装方式（⚠️ 只能用官方通道，禁止手改 DSHT 配置）

> 🔴 **红线**：**绝不要**手动编辑 DSHT 的 `profiles/tavern/package.json`、`cordis.patch.yml`，也**不要**自己建符号链接 / junction 到 `node_modules`。这些文件由 DSHT 官方安装器维护；手改不仅违反红线，还可能在崩溃恢复时被重置、甚至把 `bundles` 截断，导致整个 profile 起不来。装插件只走下面两条官方通道之一：

**方式 A（推荐，开发版软链，源码改动重启即生效）：DSHT 官方 CLI**

```bash
dsh plugin --profile tavern add link:I:/Users/ACTIM/Downloads/工作目录/DSHT-prog-mine/DSH酒馆插件开发/fish-tts-lab
```

（`link:` 指向源码目录，改完重启 DSH 即可；具体 `spec` 语法以你本地 DSHT 版本为准。）

**方式 B（零 CLI，官方的 folder-drop 自动发现）**

把整个 `fish-tts-lab` 目录复制到 DSHT 的插件目录 `<data>/plugins/<folder>/`（即 `profile-data/tavern/data/plugins/fish-tts-lab/`），重启 DSH。DSHT 会自动发现并注册，无需碰任何配置文件。

### 侧边栏挂载机制

- `package.json` 的 `dsh.client.inject: ["dsh-better-sidebar"]` 声明本包提供一个注入到 better-sidebar 的客户端模块。
- `lib/client.js` 用 DSHT 客户端模块格式：`window.__ModuleLoader__.load({ id, factory(require){...} })`；factory 内 `require('react')` 取 React + `h`，`module.exports.inject=['betterSidebar']`、`module.exports.apply(ctx)` 里调 `ctx.betterSidebar.registerTab({ id, title, order, single, createTab, component })`。
- `component` 返回一个**全尺寸 iframe**，`src` 指向本机已启动的 server（`http://127.0.0.1:18765/`）。即「侧边栏页面 = 同一个 WebUI 的 iframe」。
- `lib/index.js` 是**纯 cordis 插件**：只 `export const name` + `export function apply(ctx)`，**没有任何 import 期副作用**；DSHT 加载插件时调用 `apply(ctx)` 启动 server（或复用已起的实例）并挂 `dispose` 清理。

> ⚠️ iframe 与 server 同为 `127.0.0.1` 同源，前端 `fetch('/api/tts')` 无需跨域。**前提是 server 已经起来**——DSHT 加载插件时会由 `apply()` 自动起服务；若你只想用独立模式，运行 `npm start`（= `node standalone.js`）。两种模式共用同一份 server 代码，但**同一时刻只允许一个进程占 18765 端口**。

---

## 参数说明

### 公共字段

| 字段 | 含义 |
|------|------|
| `text` | 合成文本。**fish 支持 `[tag]` 内联情感标签**（如 `[happy]你好`），直接写进文本即可。 |
| `voiceId` | 音色 id。fish 叫 `reference_id`，OpenRouter 叫 `voice`。 |
| `referenceAudio` | 即时克隆参考音频（前端 FileReader 读成 dataURL，后端自动剥离 `data:` 前缀）。 |
| `referenceTranscript` | 参考音频对应的文本（即时克隆用，可选）。 |
| `format` | 输出格式，默认 `mp3`。 |

### fish 专属

| 字段 | 说明 |
|------|------|
| `fishUrl` | **API 端点 URL**，默认 `https://api.fish.audio/v1/tts`；可改自建代理或 `https://fishaudio.org/v1/tts` 等兼容端点。⚠️ 服务端用 `https.request` 转发，自定义端点**必须是 https**。 |
| `fishModel` | **模型选择**，经 `model:` HTTP 头下发（如 `s2.1-pro` / `s2.1-pro-flash` / `s2-pro` / `s1`）；留空用服务端默认引擎。 |
| `bitrate` | CBR 码率（如 `128`/`320`），单位 kbps。 |
| `sampleRate` | 采样率（如 `44100`/`48000`）。 |
| `speed` | 语速倍率（`prosody.speed`），非 1 时才下发。 |
| `latency` | 延迟档（`balanced`/`normal` 等，按 fish 文档）。 |
| `normalize` | 是否归一化响度，默认开。 |

**fish 没有 `language` 参数**——语言由文本 + 音色自动推断（官方确认）。不要自己拼 language，会导致多余字段或误用。

### OpenRouter 专属

| 字段 | 说明 |
|------|------|
| `model` | 默认 `fish-audio/s2.1-pro-free:free`；可换其他 TTS 模型。 |
| `instructions` | 风格指令（对应 OpenRouter 的 `instructions`）。 |
| `input_references` | 即时克隆参考（由 `referenceAudio` 自动组装）。 |

> 实测：同一句中文只调 `provider.options` 透传未生效，故本工具不强依赖它。即时克隆保真度通常**低于直接用 voice id**——要稳定音色优先用 voice id。

---

## 代理

后端默认**直连**上游；若检测到代理则经 **HTTP CONNECT 隧道**转发，解决国内直连 `fish.audio` / `openrouter.ai` 被墙导致的超时/失败。

代理来源优先级：
1. 请求体 `opts.proxy`（未来前端可透传）；
2. 环境变量 `HTTPS_PROXY` / `HTTP_PROXY` / `ALL_PROXY`（含小写）；
3. **Windows 系统代理**（注册表 `ProxyEnable` + `ProxyServer`，自动读取）。

`NO_PROXY`（逗号分隔）可指定直连域名。自定义端点需走代理时，请确保代理软件处于运行状态。

---

## API key 管理

- 前端把 key 填在表单里，随请求发到本机 server；server 仅用于转发给上游，**不写入任何文件、不回传前端**。
- key 只活在浏览器 localStorage（你的偏好缓存）和一次请求的内存里。
- 切换机器 / 清缓存时注意：localStorage 里的 key 是明文存在你本地浏览器，敏感场景记得清掉。
- 本工具**不代理**任何鉴权转发到第三方，只发往 `api.fish.audio` 与 `openrouter.ai`。

---

## HTTP 接口

| 路由 | 方法 | 说明 |
|------|------|------|
| `/` | GET | 返回 `public/index.html`（WebUI）。 |
| `/health` | GET | 健康检查：`{ ok:true, service:"fish-tts-lab", port }`。 |
| `/api/tts` | POST | 合成请求，body 为上述统一参数 JSON。成功返回音频流（audio/mpeg 或 audio/wav），失败返回 `{ ok:false, status, error }`。 |
| 其他静态资源 | GET | `public/` 下的 `*.js / *.css / *.svg / *.ico` 等，带 `no-cache`。 |

请求示例：

```bash
curl -X POST http://127.0.0.1:18765/api/tts \
  -H 'Content-Type: application/json' \
  -d '{"backend":"fish","fishKey":"YOUR_KEY","voiceId":"YOUR_VOICE","text":"[happy]你好，世界"}' \
  --output out.mp3
```

---

## 故障排查

| 现象 | 可能原因 / 处置 |
|------|----------------|
| 启动报 `EADDRINUSE` | 端口被占用。用 `FISH_TTS_PORT` 换端口，并同步 `lib/client.js` 的 `SERVER_PORT`。 |
| 启动日志里 `服务监听失败: ...` | 端口权限/占用，见上。 |
| 前端点生成一直「生成中」最后超时 | 网络不通：代理未运行，或 `NO_PROXY` 把目标域名排除了。工具会自动读 Windows 系统代理 / `HTTPS_PROXY` 等环境变量，经 HTTP CONNECT 隧道转发；确认代理软件在跑。 |
| 提示 `401` / 鉴权失败 | key 错误或过期，去对应平台核对。 |
| DSHT 侧边栏看不到「鱼音色测试」 | 确认插件已安装并重启 DSH；确认 `lib/index.js` 已被加载（server 在后台跑着）；iframe 依赖 `127.0.0.1:18765` 可达。 |
| 改了端口侧边栏空白 | `lib/client.js` 的 `SERVER_PORT` 没同步。 |

---

## 已知限制

- **即时克隆保真度**：fish 的 `references` / OpenRouter 的 `input_references` 保真度通常低于直接用 voice id；追求稳定音色优先用 voice id。
- **fish 无 language 字段**：语言自动推断，别硬加。
- **OpenRouter `provider.options` 透传实测失效**：本工具不依赖它。
- **DSHT 侧边栏依赖本机 server**：插件形态下，iframe 仍指向 `127.0.0.1`，需保证 Node 服务在跑。
- **沙箱 / 代理环境**：若运行环境禁外网，只能验证本地校验与静态页面，真实合成需在能联网的机器上跑。

---

## 技术栈与约定

- 纯 Node ESM，零外部依赖，folder-drop 安装不踩「找不到宿主 `@deepseek-ai/*`」的坑。
- 前端零框架、零 CDN，原生 HTML/CSS/JS。
- `type:module`、`main: lib/index.js`、DSHT 客户端模块用 `__ModuleLoader__` factory 格式（参考 NA）。

---

## License

MIT
