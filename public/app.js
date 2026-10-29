// Fish TTS Lab 前端逻辑（原生 JS，零依赖）。
// 与后端约定：POST /api/tts（同源自本机 server），返回音频或 { ok:false, error }。
(function () {
  const $ = (s) => document.querySelector(s)
  const $$ = (s) => Array.from(document.querySelectorAll(s))
  const LS_KEY = 'fish-tts-lab:prefs'
  const LS_HISTORY = 'fish-tts-lab:history'
  const HIST_MAX = 30
  const HIST_MAX_BYTES = 3_500_000 // localStorage 安全上限，超出丢最旧

  const state = { refBase64: '', refName: '', history: [] }

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader()
      fr.onload = () => resolve(fr.result)
      fr.onerror = () => reject(fr.error)
      fr.readAsDataURL(blob)
    })
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]))
  }
  function loadPrefs() {
    try { return JSON.parse(localStorage.getItem(LS_KEY)) || {} } catch { return {} }
  }
  function savePrefs(p) {
    try { localStorage.setItem(LS_KEY, JSON.stringify(p)) } catch { /* 隐私模式忽略 */ }
  }
  function setStatus(msg, kind) {
    const el = $('#status')
    el.textContent = msg || ''
    el.className = 'status' + (kind ? ' ' + kind : '')
  }

  function applyBackendVisibility() {
    const b = $('input[name=backend]:checked').value
    $$('.group-fish').forEach((el) => (el.hidden = b !== 'fish'))
    $$('.group-or').forEach((el) => (el.hidden = b !== 'openrouter'))
  }

  function fillPrefs(p) {
    if (p.backend) {
      const r = document.querySelector('input[name=backend][value="' + p.backend + '"]')
      if (r) r.checked = true
    }
    if (p.fishKey) $('#fishKey').value = p.fishKey
    if (p.fishUrl) $('#fishUrl').value = p.fishUrl
    if (p.fishModel) $('#fishModel').value = p.fishModel
    if (p.orKey) $('#orKey').value = p.orKey
    if (p.voiceId) $('#voiceId').value = p.voiceId
    if (p.format) $('#format').value = p.format
    if (p.bitrate) $('#bitrate').value = p.bitrate
    if (p.sampleRate) $('#sampleRate').value = p.sampleRate
    if (p.speed) $('#speed').value = p.speed
    if (p.latency != null) $('#latency').value = p.latency
    if (typeof p.normalize === 'boolean') $('#normalize').checked = p.normalize
    if (typeof p.autoPlay === 'boolean') $('#autoPlay').checked = p.autoPlay
    if (p.model) $('#model').value = p.model
    if (p.instructions) $('#instructions').value = p.instructions
  }

  function collectPrefs() {
    return {
      backend: $('input[name=backend]:checked').value,
      fishKey: $('#fishKey').value.trim(),
      fishUrl: $('#fishUrl').value.trim(),
      fishModel: $('#fishModel').value,
      orKey: $('#orKey').value.trim(),
      voiceId: $('#voiceId').value.trim(),
      format: $('#format').value,
      bitrate: $('#bitrate').value,
      sampleRate: $('#sampleRate').value,
      speed: $('#speed').value,
      latency: $('#latency').value.trim(),
      normalize: $('#normalize').checked,
      autoPlay: $('#autoPlay').checked,
      model: $('#model').value.trim(),
      instructions: $('#instructions').value,
    }
  }

  function playCurrent(url, ext, backend, text) {
    $('#player').src = url
    const dl = $('#dl')
    dl.href = url
    dl.download = 'fish-tts-lab-' + Date.now() + '.' + ext
    dl.hidden = false
    $('#meta').textContent = backend + ' · ' + (text || '').slice(0, 40)
  }

  function addHistory(item) {
    state.history.unshift(item)
    // 数量上限
    if (state.history.length > HIST_MAX) state.history.length = HIST_MAX
    // 体积上限：从最旧开始丢，直到低于阈值
    let total = state.history.reduce((s, it) => s + (it.dataUrl ? it.dataUrl.length : 0), 0)
    while (state.history.length > 1 && total > HIST_MAX_BYTES) {
      const gone = state.history.pop()
      if (gone && gone.dataUrl) total -= gone.dataUrl.length
    }
    try { localStorage.setItem(LS_HISTORY, JSON.stringify(state.history)) } catch { /* 隐私模式/超限忽略 */ }
    renderHistory()
  }

  function loadHistory() {
    try {
      const raw = JSON.parse(localStorage.getItem(LS_HISTORY)) || []
      state.history = Array.isArray(raw) ? raw.filter((it) => it && it.dataUrl) : []
    } catch { state.history = [] }
    renderHistory()
  }

  function playItem(it) {
    $('#player').src = it.dataUrl
    const dl = $('#dl')
    dl.href = it.dataUrl
    dl.download = 'fish-tts-lab-' + it.ts + '.' + it.ext
    dl.hidden = false
    $('#meta').textContent = it.backend + ' · ' + (it.text || '').slice(0, 40)
    if ($('#autoPlay').checked) { const pr = $('#player').play(); if (pr && pr.catch) pr.catch(() => {}) }
  }

  function renderHistory() {
    const ul = $('#history')
    ul.innerHTML = ''
    $('#historyEmpty').hidden = state.history.length > 0
    state.history.forEach((it) => {
      const li = document.createElement('li')
      const d = new Date(it.ts)
      const badge = it.backend === 'fish' ? 'fish' : 'OpenRouter'
      li.innerHTML =
        '<div class="h-top"><span class="h-badge">' + esc(badge) + '</span><span>' + esc(d.toLocaleTimeString()) + '</span></div>' +
        '<div class="h-text">' + esc(it.text) + '</div>' +
        '<div class="h-top"><span>' + esc(it.voiceId || '(即时克隆)') + '</span></div>'
      li.addEventListener('click', () => playItem(it))
    })
  }

  async function generate() {
    const p = collectPrefs()
    savePrefs(p)
    const backend = p.backend
    const opts = {
      backend,
      text: $('#text').value,
      voiceId: p.voiceId,
      format: p.format,
      bitrate: p.bitrate,
      sampleRate: p.sampleRate,
      speed: p.speed,
      latency: p.latency,
      normalize: p.normalize,
      model: p.model,
      instructions: p.instructions,
      referenceAudio: state.refBase64,
      referenceTranscript: $('#refTranscript').value.trim(),
    }
    if (backend === 'fish') {
      opts.fishKey = p.fishKey
      opts.endpoint = p.fishUrl
      opts.model = p.fishModel
    } else {
      opts.orKey = p.orKey
    }

    if (!opts.text.trim()) { setStatus('文本不能为空', 'err'); return }
    if (!opts.voiceId && !state.refBase64) { setStatus('需要 voice id 或上传参考音频', 'err'); return }

    const btn = $('#genBtn')
    btn.disabled = true
    setStatus('生成中…', 'busy')
    const t0 = Date.now()
    try {
      const res = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(opts),
      })
      if (res.ok) {
        const blob = await res.blob()
        const ct = res.headers.get('content-type') || ''
        const ext = ct.includes('wav') ? 'wav' : 'mp3'
        const dataUrl = await blobToDataUrl(blob)
        const blobUrl = URL.createObjectURL(blob)
        playCurrent(blobUrl, ext, backend, opts.text)
        if ($('#autoPlay').checked) { const pr = $('#player').play(); if (pr && pr.catch) pr.catch(() => {}) }
        setStatus('成功 · ' + ((Date.now() - t0) / 1000).toFixed(1) + 's', 'ok')
        addHistory({ backend, text: opts.text, voiceId: opts.voiceId, ts: Date.now(), dataUrl, ext })
      } else {
        let msg = 'HTTP ' + res.status
        try { const j = await res.json(); msg = j.error || msg } catch { /* 非 JSON */ }
        setStatus('失败：' + msg, 'err')
      }
    } catch (e) {
      setStatus('请求失败：' + e.message, 'err')
    } finally {
      btn.disabled = false
    }
  }

  function init() {
    fillPrefs(loadPrefs())
    loadHistory()
    applyBackendVisibility()
    $$('input[name=backend]').forEach((r) => r.addEventListener('change', applyBackendVisibility))
    $('#genBtn').addEventListener('click', generate)
    $('#refClear').addEventListener('click', () => {
      state.refBase64 = ''
      state.refName = ''
      $('#refFile').value = ''
      $('#refInfo').textContent = '未选择'
    })
    $('#refFile').addEventListener('change', (e) => {
      const f = e.target.files[0]
      if (!f) return
      const reader = new FileReader()
      reader.onload = () => {
        state.refBase64 = reader.result // data URL，后端会剥离前缀
        state.refName = f.name
        $('#refInfo').textContent = f.name + ' (' + (f.size / 1024).toFixed(0) + ' KB)'
      }
      reader.readAsDataURL(f)
    })
  }

  document.addEventListener('DOMContentLoaded', init)
})()
