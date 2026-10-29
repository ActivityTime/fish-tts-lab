// TTS 代理核心：封装 fish.audio 原生 TTS 与 OpenRouter TTS。
// 零外部依赖，只用 Node 内置模块。
//
// 代理说明：后端默认直连上游；若检测到代理（HTTP CONNECT），请求会经代理隧道转发，
// 解决国内直连 fish.audio / openrouter.ai 被墙导致的超时/失败。
// 代理来源优先级：opts.proxy > HTTPS_PROXY/HTTP_PROXY/ALL_PROXY 环境变量 > Windows 系统代理(注册表)。
//
// 设计要点（来自 API 实测与官方文档整理）：
//  - fish.audio 原生/兼容 API：POST /v1/tts（默认 https://api.fish.audio/v1/tts，可在前端改端点）
//      · 鉴权：Authorization: Bearer <fish_api_key>
//      · 字段：text / reference_id(voice id) / format / bitrate / sample_rate
//              / prosody{speed,pitch} / latency / normalize / references(即时克隆)
//      · 语言由文本 + 音色自动推断，无 language 参数（官方确认）
//      · [tag] 内联情感标签直接写在 text 里即可
//      · 引擎选择：通过同名 HTTP 头 `model` 指定（如 s2.1-pro / s2.1-pro-flash / s2-pro / s1）。
//        留空则服务端用默认引擎。注意该 model 头仅在支持 fish 兼容契约的端点上生效
//        （如 https://fishaudio.org/v1/tts）；api.fish.audio 上未知 model 头会被忽略。
//  - OpenRouter：POST https://openrouter.ai/api/v1/audio/speech
//      · 鉴权：Authorization: Bearer <openrouter_key>
//      · 字段：model / input(文本) / voice(voice id) / response_format
//              / instructions / input_references(即时克隆)
//      · 同一句中文只变 provider.options 实测证明透传未生效，故不依赖它
//
// input_references 的精确 JSON 结构以 OpenRouter 官方 schema 为准；
// 此处采用 { audio: <base64>, transcript } 数组（与 fish 原生 references 对齐）。
// 若 OpenRouter 要求不同结构，改 buildRequestBody 即可。

import https from 'node:https'
import net from 'node:net'
import { execSync } from 'node:child_process'
import { URL } from 'node:url'

const FISH_ENDPOINT = 'https://api.fish.audio/v1/tts'
const OPENROUTER_ENDPOINT = 'https://openrouter.ai/api/v1/audio/speech'
const DEFAULT_OR_MODEL = 'fish-audio/s2.1-pro-free:free'

// 去掉 base64 可能带的前缀（data:audio/wav;base64,）
function stripB64(input) {
  if (!input) return ''
  const i = input.indexOf(',')
  if (input.startsWith('data:') && i >= 0) return input.slice(i + 1)
  return input
}

function clean(obj) {
  // 删除 undefined / null / 空字符串，避免把无意义字段发给 API
  const out = {}
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null || v === '') continue
    out[k] = v
  }
  return out
}

// 根据前端传入的统一参数，组装对应后端的请求体
export function buildRequestBody(opts) {
  const text = (opts.text || '').toString()
  if (opts.backend === 'fish') {
    const body = {
      text,
      format: opts.format || 'mp3',
      reference_id: opts.voiceId || '',
      bitrate: opts.bitrate ? Number(opts.bitrate) : undefined,
      sample_rate: opts.sampleRate ? Number(opts.sampleRate) : undefined,
      latency: opts.latency || undefined,
      normalize: opts.normalize === false ? false : true,
    }
    if (opts.speed != null && Number(opts.speed) !== 1) {
      body.prosody = { speed: Number(opts.speed) }
    }
    const audio = stripB64(opts.referenceAudio)
    if (audio) {
      body.references = [{ audio, transcript: opts.referenceTranscript || '' }]
    }
    return clean(body)
  }

  // OpenRouter
  const body = {
    model: opts.model || DEFAULT_OR_MODEL,
    input: text,
    voice: opts.voiceId || '',
    response_format: opts.format || 'mp3',
  }
  if (opts.instructions) body.instructions = opts.instructions
  const audio = stripB64(opts.referenceAudio)
  if (audio) {
    body.input_references = [{ audio, transcript: opts.referenceTranscript || '' }]
  }
  return clean(body)
}

// ============ 代理支持 ============

// 规范化代理字符串为 { host, port }；允许 "127.0.0.1:10808" 或带 scheme 的完整 URL。
function normalizeProxy(p) {
  let s = String(p || '').trim()
  if (!s) return null
  if (!/^https?:\/\//i.test(s)) s = 'http://' + s
  let u
  try {
    u = new URL(s)
  } catch {
    return null
  }
  return { host: u.hostname, port: Number(u.port || (u.protocol === 'https:' ? 443 : 80)) }
}

// 读取 Windows 系统代理（注册表），仅 Windows 有效；读取失败返回 null。
function getWindowsSystemProxy() {
  if (process.platform !== 'win32') return null
  const key = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings'
  try {
    const out = execSync(`reg query "${key}" /v ProxyEnable`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
    if (!/0x1\b/i.test(out) && !/\b1\b/.test(out.split(/\r?\n/).filter((l) => /ProxyEnable/i.test(l)).join(' '))) {
      return null // ProxyEnable != 1，未开启系统代理
    }
    const out2 = execSync(`reg query "${key}" /v ProxyServer`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
    const line = out2.split(/\r?\n/).find((l) => /ProxyServer\s+REG_SZ/i.test(l)) || ''
    const m = /\s+(.+?)\s*$/.exec(line)
    return m ? normalizeProxy(m[1].trim()) : null
  } catch {
    return null
  }
}

// 代理来源优先级：显式 opts.proxy > 环境变量 > Windows 系统代理
function resolveProxy(opts = {}) {
  if (opts.proxy) return normalizeProxy(opts.proxy)
  const env = process.env
  const fromEnv = env.HTTPS_PROXY || env.https_proxy || env.HTTP_PROXY || env.http_proxy || env.ALL_PROXY || env.all_proxy
  if (fromEnv) return normalizeProxy(fromEnv)
  return getWindowsSystemProxy()
}

// 是否应绕过代理（NO_PROXY 逗号分隔，支持 *. 前缀；精确匹配主机名）
function shouldBypass(host) {
  const no = process.env.NO_PROXY || process.env.no_proxy
  if (!no) return false
  const h = String(host).toLowerCase()
  return no.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean).some((p) => {
    if (p === '*') return true
    if (p.startsWith('.')) return h.endsWith(p) || h === p.slice(1)
    return h === p || h.endsWith('.' + p)
  })
}

// 通过 HTTP CONNECT 代理建立到目标 host:port 的裸 TCP 隧道（TLS 由上层 https 封装）。
// 返回 callback(err, socket)；代理握手带超时保护，避免黑洞连接挂死。
function connectViaProxy(proxy, targetHost, targetPort, callback, timeoutMs = 15000) {
  const sock = net.connect(proxy.port, proxy.host)
  let settled = false
  const fail = (e) => {
    if (settled) return
    settled = true
    clearTimeout(timer)
    sock.destroy()
    callback(e)
  }
  const timer = setTimeout(() => fail(new Error('代理 CONNECT 超时（> ' + timeoutMs / 1000 + 's）: ' + proxy.host + ':' + proxy.port)), timeoutMs)
  timer.unref?.()
  sock.once('error', fail)
  sock.once('connect', () => {
    sock.write(`CONNECT ${targetHost}:${targetPort} HTTP/1.1\r\nHost: ${targetHost}:${targetPort}\r\n\r\n`)
  })
  let buf = Buffer.alloc(0)
  const onData = (c) => {
    buf = Buffer.concat([buf, c])
    const idx = buf.indexOf('\r\n\r\n')
    if (idx < 0) return
    const head = buf.slice(0, idx).toString('ascii')
    const m = /^HTTP\/1\.[01]\s+(\d{3})/.exec(head)
    const status = m ? Number(m[1]) : 0
    if (status === 200) {
      if (settled) return
      settled = true
      clearTimeout(timer)
      sock.removeListener('data', onData)
      sock.removeListener('error', fail)
      callback(null, sock)
    } else {
      fail(new Error('代理 CONNECT 失败 ' + status + ': ' + (head.split('\r\n')[0] || 'unknown')))
    }
  }
  sock.on('data', onData)
}

// 一个自定义 https.Agent：createConnection 返回经 CONNECT 隧道打通的裸 TCP socket，
// https.request 会在其上做 TLS 握手并发送请求。
class ConnectProxyAgent extends https.Agent {
  constructor(proxy) {
    super({ keepAlive: false })
    this._proxy = proxy
  }
  createConnection(options, callback) {
    const host = options.host || options.servername
    const port = Number(options.port || 443)
    connectViaProxy(this._proxy, host, port, callback)
    return undefined
  }
}

// 通用 JSON POST，返回 { status, contentType, buf }
function postJSON(endpoint, headers, bodyObj, timeoutMs = 300000) {
  return new Promise((resolve, reject) => {
    let u
    try {
      u = new URL(endpoint)
    } catch (e) {
      return reject(new Error('非法端点: ' + endpoint))
    }
    const data = JSON.stringify(bodyObj)
    const proxy = shouldBypass(u.hostname) ? null : resolveProxy()
    const reqOpts = {
      method: 'POST',
      hostname: u.hostname,
      port: u.port || 443,
      path: u.pathname + u.search,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
        ...headers,
      },
    }
    let agent = null
    if (proxy) {
      agent = new ConnectProxyAgent(proxy)
      reqOpts.agent = agent
    }
    const req = https.request(reqOpts, (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          contentType: res.headers['content-type'] || '',
          buf: Buffer.concat(chunks),
        })
      })
    })
    req.on('error', reject)
    req.setTimeout(timeoutMs, () => req.destroy(new Error('请求超时（> ' + timeoutMs / 1000 + 's）')))
    req.write(data)
    req.end()
  })
}

// 主入口：opts 见 buildRequestBody 的参数 + fishKey / orKey / endpoint / model
// 返回 Promise<{ ok, audio?, contentType?, status?, error? }>
export async function synth(opts) {
  const backend = opts.backend === 'openrouter' ? 'openrouter' : 'fish'
  // 端点可被前端覆盖（如自建代理 / fishaudio.org 兼容端点），否则用官方默认
  const endpoint = opts.endpoint || (backend === 'fish' ? FISH_ENDPOINT : OPENROUTER_ENDPOINT)
  const headers = { Authorization: 'Bearer ' + (backend === 'fish' ? opts.fishKey : opts.orKey || opts.fishKey) }
  // fish 原生：model 走同名 HTTP 头（兼容契约）；留空则服务端用默认引擎
  if (backend === 'fish' && opts.model) headers.model = String(opts.model)

  if (!opts.text || !opts.text.trim()) {
    return { ok: false, status: 400, error: '文本不能为空' }
  }
  if (!opts.voiceId && !opts.referenceAudio) {
    return { ok: false, status: 400, error: '需要 voice id（参考音频）或上传即时克隆参考音频' }
  }

  const body = buildRequestBody({ ...opts, backend })
  let res
  try {
    res = await postJSON(endpoint, headers, body)
  } catch (e) {
    return { ok: false, status: 0, error: '网络错误: ' + e.message }
  }

  const isJson = res.contentType.includes('json') || res.contentType.includes('application/json')
  if (res.status >= 200 && res.status < 300 && !isJson && res.buf.length > 0) {
    return { ok: true, audio: res.buf, contentType: res.contentType || 'audio/mpeg' }
  }

  // 失败：尝试解析 JSON 错误，否则回退原始文本
  let message = res.buf.toString('utf-8').slice(0, 800)
  try {
    const j = JSON.parse(res.buf.toString('utf-8'))
    message = j?.error?.message || j?.message || j?.detail || j?.error || message
  } catch {
    /* 非 JSON，用原文 */
  }
  return { ok: false, status: res.status, error: message }
}

export const ENDPOINTS = { FISH_ENDPOINT, OPENROUTER_ENDPOINT, DEFAULT_OR_MODEL }
