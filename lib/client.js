/**
 * fish-tts-lab - DSH 客户端入口（侧边栏页面）
 *
 * 使用 DSH 客户端模块系统的 factory 格式（与 narrative-anchor / dsh-pocket-console 一致），
 * 无需构建步骤即可安装。
 *
 * 机制：
 *  - inject: ['betterSidebar'] → 拿到 ctx.betterSidebar 服务
 *  - ctx.betterSidebar.registerTab(...) 注册一个侧边栏 tab
 *  - tab 内用一个全尺寸 iframe 嵌入本机 server 提供的 WebUI（http://127.0.0.1:PORT）
 *
 * 这样「一套前端，两种模式」：独立运行时浏览器直接开 localhost:PORT；
 * 作为 DSHT 插件时，侧边栏页面就是同一个 WebUI 的 iframe。
 *
 * 与后端通信：iframe 内页面自行 fetch('/api/tts')（同源，无需 CORS）。
 */
window.__ModuleLoader__.load({
  id: 'fish-tts-lab',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports

    const React = require('react')
    const h = React.createElement

    // 与 lib/server.js / lib/index.js 的默认端口保持一致；改端口时三处需同步。
    const SERVER_PORT = 18765

    function FishTtsLabTab() {
      return h(
        'div',
        {
          style: {
            width: '100%',
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            background: '#fff',
          },
        },
        h('iframe', {
          src: 'http://127.0.0.1:' + SERVER_PORT + '/',
          title: 'Fish TTS Lab',
          // 不设 sandbox：iframe 加载本机 trusted 服务，需要脚本运行与同源 fetch。
          style: { width: '100%', flex: '1 1 auto', border: 'none' },
        })
      )
    }

    module.exports.inject = ['betterSidebar']
    module.exports.apply = (ctx) => {
      // 注意：与 NA 一致，ctx.effect 只传回调（无第二参数）。
      ctx.effect(() =>
        ctx.betterSidebar.registerTab({
          id: 'fish-ts-lab:main',
          title: '鱼音色测试',
          order: 50,
          single: true,
          createTab: () => ({
            tab: { id: 'fish-ts-lab:main', type: 'fish-ts-lab:main', title: '鱼音色测试' },
            patch: { panelOpen: true },
          }),
          component: (p) => h(FishTtsLabTab, p),
        })
      )
    }

    // 关键：factory 必须返回 module.exports，DSHT 客户端运行时才能拿到 inject/apply。
    // 之前漏了 return，__ModuleLoader__ 拿到 undefined → 侧边栏永远不注册（已修复）。
    return module.exports
  },
})
