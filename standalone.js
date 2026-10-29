// 独立运行入口：仅在本文件被直接执行时启动 server（不污染插件模块）。
// 用法：npm start  或  node standalone.js
// DSHT 加载的是 lib/index.js（cordis 插件），不会触发此处；二者共用同一份 server 代码。

import { ensureServer } from './lib/index.js'

const port = Number(process.env.FISH_TTS_PORT) || Number(process.env.PORT) || 18765
ensureServer()
console.log('[fish-tts-lab] 独立服务已启动: http://localhost:' + port + '/')
console.log('[fish-tts-lab] 作为 DSHT 侧边栏插件时，面板将嵌入同一地址（由 DSHT 加载 lib/index.js 启动）。')
