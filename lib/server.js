// HTTP server：静态资源 + /api/tts 代理 + /health。
// 零外部依赖，只用 Node 内置 http / fs / path / url。
// 独立运行与 DSHT 插件共用同一份 server —— 一套前端，两种运行模式。

import http from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { join, extname, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'
import { synth } from './tts.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PUBLIC_DIR = join(__dirname, '..', 'public')

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
}

function setCORS(res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
}

function sendJSON(res, status, obj) {
  const data = JSON.stringify(obj)
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(data)
}

async function serveStatic(req, res, pathname) {
  let rel = pathname === '/' ? '/index.html' : pathname
  // 防目录穿越
  const safe = normalize(rel).replace(/^(\.\.[/\\])+/, '')
  const filePath = join(PUBLIC_DIR, safe)
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403)
    return res.end('Forbidden')
  }
  try {
    const s = await stat(filePath)
    if (s.isDirectory()) throw new Error('is dir')
    const buf = await readFile(filePath)
    res.writeHead(200, {
      'Content-Type': MIME[extname(filePath)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    })
    res.end(buf)
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end('Not Found: ' + pathname)
  }
}

async function handleTTS(req, res) {
  let raw = ''
  for await (const chunk of req) raw += chunk
  let opts
  try {
    opts = JSON.parse(raw || '{}')
  } catch {
    return sendJSON(res, 400, { ok: false, error: '请求体不是合法 JSON' })
  }
  // 敏感字段只用于发起请求，不回传
  const result = await synth(opts)
  if (result.ok) {
    res.writeHead(200, {
      'Content-Type': result.contentType || 'audio/mpeg',
      'Content-Length': result.audio.length,
      'X-Tts-Backend': opts.backend || 'fish',
    })
    return res.end(result.audio)
  }
  sendJSON(res, result.status || 500, { ok: false, status: result.status, error: result.error })
}

export function startServer({ port = 18765, host = '0.0.0.0' } = {}) {
  const server = http.createServer(async (req, res) => {
    setCORS(res)
    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      return res.end()
    }
    const { pathname } = new URL(req.url, 'http://localhost')
    try {
      if (pathname === '/health') {
        return sendJSON(res, 200, { ok: true, service: 'fish-tts-lab', port })
      }
      if (pathname === '/api/tts' && req.method === 'POST') {
        return await handleTTS(req, res)
      }
      if (req.method === 'GET' || req.method === 'HEAD') {
        return await serveStatic(req, res, pathname)
      }
      res.writeHead(405)
      res.end('Method Not Allowed')
    } catch (e) {
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' })
      }
      res.end(JSON.stringify({ ok: false, error: '服务器内部错误: ' + e.message }))
    }
  })

  server.on('error', (e) => {
    console.error('[fish-tts-lab] 服务监听失败:', e.message)
  })
  server.listen(port, host, () => {
    const shown = host === '0.0.0.0' ? 'localhost' : host
    console.log('[fish-tts-lab] 服务已启动: http://' + shown + ':' + port + '/')
    console.log('[fish-tts-lab] 作为 DSHT 侧边栏插件时，面板将嵌入同一地址。')
  })
  return server
}
