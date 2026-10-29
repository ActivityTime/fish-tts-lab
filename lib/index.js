// DSHT 插件 Node 端入口 + 独立运行入口。
//
// 关键约束（踩过崩溃的坑）：本文件必须是「纯 cordis 插件」——只导出 name / apply，
// 绝不做任何 import 期副作用。DSHT 在 web-boot 阶段会 import 本模块来取插件对象；
// 一旦顶层代码抛错或启动 server，模块评估失败，导出的 apply 就会变成 undefined，
// 触发 `invalid plugin, expect function or object with an "apply" method, received undefined`。
// server 的启动统一放在 apply(ctx) 内（DSHT 加载插件时调用）；独立运行走 standalone.js。
//
// 零外部依赖，只用 node: 内置模块，folder-drop 安装不踩「找不到宿主 @deepseek-ai/*」的坑。

import { startServer } from './server.js'

export const name = 'fish-tts-lab'

function resolvePort() {
  return Number(process.env.FISH_TTS_PORT) || Number(process.env.PORT) || 18765
}

let serverInstance = null
export function ensureServer() {
  if (serverInstance && serverInstance.listening) return serverInstance
  serverInstance = startServer({ port: resolvePort() })
  return serverInstance
}

// DSHT 插件入口。宿主加载 lib/index.js 后调用 apply(ctx)，在此启动（或复用）server。
export function apply(ctx) {
  const server = ensureServer()
  const dispose = () => {
    try {
      serverInstance?.close()
      serverInstance = null
    } catch {
      /* 已关闭 */
    }
  }
  try {
    ctx?.on?.('dispose', dispose)
  } catch {
    /* 不支持则仅靠返回 disposer */
  }
  return dispose
}
