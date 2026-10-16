/**
 * dsh-bili-scroll —— 浏览器半端（**面板挂在右侧栏**）
 * ============================================================================
 * ⭐ **client bundle 不是 ESM，是自注册脚本**（2026-10-14 从官方包里挖到的约定）：
 *
 *     window.__ModuleLoader__.load({
 *       id: '<包名>',                       // 必须等于 package.json 的 name
 *       factory: (require) => { ... return { inject: [...], apply(ctx) {...} } },
 *     })
 *
 * ⭐ **入口：右侧栏**（2026-10-16 从「设置页」搬过来的）
 *
 * 原来是注册成 `settings.section`（设置里的一页）。搬到右侧栏是因为
 * 使用者更希望它**随手就能开**：右侧栏是常驻的，设置页要专门点进去。
 *
 * 右侧栏要注册**三处**（两阶段注册，少一处就点不动或没标题）：
 *
 *   ① tab 类型定义   `ctx.sidebarRightTabs.register({ id, kind, title, guide })`
 *      —— `guide` 让它在右侧栏「开始」页出现一张卡
 *   ② tab 本体       `slots.register('sidebar.right.pane.tab', { key: <①的 id> })`
 *      —— 🔴 **只注册①的卡是点不动的**：卡片的点击行为被官方写死成
 *         `openTab(selected.kind, { replaceTab: true })`，必须真有这个 kind 的页面
 *   ③ tab 标题芯片   `slots.register('sidebar.right.pane.tab.title', { key: <①的 id> })`
 *      —— 可选，不注册就用 ① 里的 `title()`
 *
 * ⚠️ **两个 inject 是两回事**（极易错）：
 *   · 本文件 `inject`（下面是 `['slots', 'sidebarRightTabs']`）= **客户端服务短名**
 *   · `package.json` 的 `dsh.client.inject` = **模块包名**（预加载哪些 client 模块）
 *   填错任一处 ⇒ 该 entry 永远 pending ⇒ **整页 `Failed to load plugins`**（不是局部失效）。
 *   ⚠️ 改 `package.json` 那处属于**包元数据** ⇒ **必须重启宿主**才生效（JS 那处走 HMR）。
 *
 * ⚠️ **id / kind 撞车会 throw**，而 throw 同样拖垮整个 entry ⇒ 已扫过：
 *   内置 kind 有 keyed/list/plan/subagentchat/terminal，第三方见过 wb-switch；
 *   本插件用 `bili-scroll`，未占用。
 *
 * 这一页要满足使用者说的形状：
 *   · **总开关 → 打开之后下面才展开子开关**（峰谷自动刷 → 中午 / 晚上）
 *   · **数字项要能自己填**（定量刷：每天几条）
 *   · **账号绑定必须在面板里**（扫码登录 + 二维码直接显示在页里）
 *   · 会发东西出去的（自动评论）、要下大模型的（本地转写）**默认关**
 * ============================================================================
 */
window.__ModuleLoader__.load({
  id: 'dsh-bili-scroll',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement

    const API = '/api/bili-duty'
    const jget = async (p) => (await fetch(API + p, { credentials: 'same-origin' })).json()
    const jpost = async (p, body) => (await fetch(API + p, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body || {}),
    })).json()

    const CSS = `
/* 右侧栏 tab 的外层：撑满并自己滚（右侧栏比设置页窄得多，别写死 max-width） */
[data-bd-tabwrap]{display:block;height:100%;overflow:auto;box-sizing:border-box;padding:14px 12px 24px;}
[data-bd-page]{display:flex;flex-direction:column;gap:18px;padding:2px 2px 8px;}
[data-bd-sec]{display:flex;flex-direction:column;gap:8px;}
[data-bd-h]{font-size:11px;font-weight:600;letter-spacing:.04em;color:var(--dsw-alias-label-tertiary,#9aa0a6);}
[data-bd-row]{display:flex;align-items:center;gap:10px;}
[data-bd-grow]{flex:1;min-width:0;}
[data-bd-label]{font-size:13px;}
[data-bd-note]{font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary,#9aa0a6);}
[data-bd-sw]{flex:none;width:38px;height:22px;border-radius:11px;border:0;cursor:pointer;position:relative;
  background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.35));transition:background .15s;padding:0;}
[data-bd-sw][data-on]{background:#3b82f6;}
[data-bd-sw] i{position:absolute;top:3px;left:3px;width:16px;height:16px;border-radius:50%;background:#fff;
  transition:left .15s;display:block;}
[data-bd-sw][data-on] i{left:19px;}
[data-bd-sw][disabled]{opacity:.45;cursor:default;}
[data-bd-sub]{margin-left:14px;padding-left:12px;border-left:2px solid var(--dsw-alias-border-l2,rgba(255,255,255,.1));
  display:flex;flex-direction:column;gap:10px;}
[data-bd-input]{width:100%;box-sizing:border-box;padding:7px 9px;border-radius:8px;font-size:12px;
  border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.14));
  background:var(--dsw-alias-bg-overlay,rgba(128,128,128,.12));color:inherit;font-family:inherit;}
[data-bd-input]:focus{outline:none;border-color:#3b82f6;}
[data-bd-num]{width:88px;text-align:center;}
[data-bd-select]{width:100%;box-sizing:border-box;padding:7px 9px;border-radius:8px;font-size:12px;
  border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.14));
  background:var(--dsw-alias-bg-overlay,rgba(128,128,128,.12));color:inherit;font-family:inherit;cursor:pointer;}
[data-bd-select]:focus{outline:none;border-color:#3b82f6;}
[data-bd-persona]{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;line-height:1.5;resize:vertical;}
[data-bd-row2]{display:flex;gap:8px;}
[data-bd-row2]>*{flex:1;min-width:0;}
[data-bd-btn]{padding:7px 12px;border-radius:8px;font-size:12px;cursor:pointer;font-family:inherit;
  border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.16));
  background:var(--dsw-alias-bg-overlay,rgba(128,128,128,.14));color:inherit;}
[data-bd-btn]:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.24));}
[data-bd-btn][data-primary]{background:#3b82f6;border-color:#3b82f6;color:#fff;}
[data-bd-btn][disabled]{opacity:.5;cursor:default;}
[data-bd-msg]{font-size:11px;line-height:16px;padding:7px 9px;border-radius:8px;word-break:break-all;
  background:var(--dsw-alias-bg-overlay,rgba(128,128,128,.12));color:var(--dsw-alias-label-tertiary,#9aa0a6);}
[data-bd-msg][data-warn]{color:#f59e0b;}
[data-bd-msg][data-good]{color:#22c55e;}
[data-bd-qr]{display:flex;gap:14px;align-items:flex-start;}
[data-bd-qr] img{width:150px;height:150px;border-radius:8px;background:#fff;padding:6px;}
[data-bd-pre]{margin:6px 0 0;padding:8px 9px;border-radius:8px;max-height:170px;overflow:auto;font-size:11px;
  line-height:15px;white-space:pre-wrap;word-break:break-all;
  background:var(--dsw-alias-bg-overlay,rgba(0,0,0,.25));color:var(--dsw-alias-label-secondary,#c9ccd1);}
[data-bd-kv]{font-size:11px;line-height:18px;color:var(--dsw-alias-label-tertiary,#9aa0a6);word-break:break-all;}
[data-bd-badge]{font-size:11px;padding:2px 7px;border-radius:6px;
  background:var(--dsw-alias-bg-overlay,rgba(128,128,128,.14));color:var(--dsw-alias-label-secondary,#c9ccd1);}
`

    // ⚠️ 与 lib/state.mjs 的 WINDOWS 保持一致（官方口径：工作日 9–12、14–18 是高峰，其余都是谷时）
    const DEFAULT_WINDOWS = {
      noon: { label: '中午谷时', start: '12:00', end: '14:00' },
      night: { label: '晚上/夜间谷时', start: '18:00', end: '09:00' },
    }

    /* ────────────── 小组件 ────────────── */

    function Switch({ on, onChange, disabled }) {
      return h('button', {
        'data-bd-sw': '',
        'data-on': on ? '' : undefined,
        disabled: Boolean(disabled),
        title: on ? '已开' : '已关',
        onClick: () => { if (!disabled) onChange(!on) },
      }, h('i'))
    }

    function ToggleRow({ label, note, on, onChange, disabled }) {
      return h('div', { 'data-bd-row': '' },
        h('div', { 'data-bd-grow': '' },
          h('div', { 'data-bd-label': '' }, label),
          note ? h('div', { 'data-bd-note': '' }, note) : null),
        h(Switch, { on, onChange, disabled }))
    }

    function useStatus(intervalMs) {
      const [st, setSt] = React.useState(null)
      React.useEffect(() => {
        let alive = true
        const tick = async () => {
          try {
            const d = await jget('/status')
            if (alive && d?.ok) setSt(d)
          } catch { /* 网络抖动就下次再问 */ }
        }
        tick()
        const t = setInterval(tick, intervalMs || 5000)
        return () => { alive = false; clearInterval(t) }
      }, [intervalMs])
      return [st, setSt]
    }

    /* ────────────── 设置页正文 ────────────── */

    function Panel(props) {
      // ⭐ 跳会话的能力由 apply() 注入。**传的是解析函数**（点击时才取服务）——
      //    因为 `uiWorkspace` 是异步 inject 上来的，按值捕获会拿到 null（真机踩过）。
      //    解析不出来返回 null ⇒ 面板**如实显示"这个环境不支持跳转"**，而不是点了没反应。
      const resolveOpenSession = (props && props.resolveOpenSession) || (() => null)
      // ⭐ 目录选择器（给「前台工作区」用）；拿不到就是 null
      const doPickDirectory = (props && props.doPickDirectory) || null
      const [st, setSt] = useStatus(5000)
      const [busy, setBusy] = React.useState('')
      const [msg, setMsg] = React.useState('')
      const [msgTone, setMsgTone] = React.useState('')
      const [kws, setKws] = React.useState(null)
      // ⭐ 搜索相关的四个新设置（2026-10-16 加）：草稿存在本地 state，
      //    与 kws 一样**不能直接绑 cfg**（会被 5 秒轮询冲掉）
      const [kwMode, setKwMode] = React.useState(null)   // llm=按主题让模型自己组合搜索词 / fixed=每行原样当词
      const [sOrder, setSOrder] = React.useState(null)   // 搜索排序
      const [sDays, setSDays] = React.useState(null)     // 只看最近几天（0=不过滤）
      const [sNum, setSNum] = React.useState(null)       // 看多少条
      const [seenNote, setSeenNote] = React.useState(null) // 判重表条数（从 /status 拿）
      // ⭐ 前台/后台（2026-10-16 加）：决定它跑在一个你看得见的会话里、还是后台子进程
      const [runMode, setRunMode] = React.useState(null)
      // ⭐ 前台会话的工作区（2026-10-16 加）：空 = 用默认（家目录下的 front-sessions）
      const [wsPath, setWsPath] = React.useState(null)
      const [wsBusy, setWsBusy] = React.useState(false)
      // ⭐ 产物清单（2026-10-16 加：改成每条一份 md，不再是汇总日报）
      const [reports, setReports] = React.useState(null)
      const [reportFile, setReportFile] = React.useState(null)
      const [rl, setRl] = React.useState(null)          // 日报形态：full / brief / off
      const [newVer, setNewVer] = React.useState('')    // 发现的新版本号（空 = 没发现）
      // ⚠️ 输入框必须绑"本地草稿"：页面每 5 秒轮询 /status，服务端那份会把 config 盖掉
      //    ⇒ 直接绑 cfg 的话，用户打字打到一半就被冲没了 ✗（2026-10-14 陌生人验收时抓到）
      const [perDay, setPerDay] = React.useState(null)
      const [perRound, setPerRound] = React.useState(null)
      const [replyPer, setReplyPer] = React.useState(null)
      const [mention, setMention] = React.useState(null)
      const [login, setLogin] = React.useState(null)
      const [runNote, setRunNote] = React.useState(null)
      // （旧的「报告展开态」已删 —— 日报不写了，见下面的产物清单）底下，看不见）
      const [loginState, setLoginState] = React.useState('')
      const [loginTone, setLoginTone] = React.useState('')
      // ── 人设（2026-10-15 新增）──
      // ⭐ 人设**不走 /status 轮询**，只在挂载时 GET /persona 一次，之后完全由本地草稿管；
      //    否则每 5 秒的轮询会把用户正在编辑的正文冲掉（与上面输入框同一个教训）。
      const [persona, setPersona] = React.useState(null)
      const [personaSaved, setPersonaSaved] = React.useState(null)   // 服务端那份（用来判"有没有未保存改动"）
      const [personaFile, setPersonaFile] = React.useState('')
      const [personaChars, setPersonaChars] = React.useState(null)
      const [personaMsg, setPersonaMsg] = React.useState('')
      const [personaTone, setPersonaTone] = React.useState('')
      // ── 模型（2026-10-15 新增）──
      // 清单从 /models 拉（**不硬编码**：DSH 的 provider/模型由使用者装的路由决定）
      const [models, setModels] = React.useState(null)          // [{id,name,models:[{id,name}]}]
      const [modelsNote, setModelsNote] = React.useState('')
      const [mProvider, setMProvider] = React.useState(null)
      const [mModel, setMModel] = React.useState(null)
      const [mEffort, setMEffort] = React.useState(null)

      const cfg = st?.config
      React.useEffect(() => {
        if (cfg && kws === null) setKws((cfg.keywords || []).join('\n'))
        if (cfg && rl === null) setRl(cfg.reportLevel || 'full')
        if (cfg && perDay === null) setPerDay(String(cfg.perDay ?? 5))
        if (cfg && perRound === null) setPerRound(String(cfg.commentPerRound ?? 1))
        if (cfg && replyPer === null) setReplyPer(String(cfg.replyPerRound ?? 1))
        if (cfg && mention === null) setMention(cfg.mentionName || '')
        if (cfg && kwMode === null) setKwMode(cfg.keywordMode || 'llm')
        if (cfg && sOrder === null) setSOrder(cfg.searchOrder || 'totalrank')
        if (cfg && sDays === null) setSDays(String(cfg.searchDays ?? 0))
        if (cfg && sNum === null) setSNum(String(cfg.searchNum ?? 20))
        if (st && seenNote === null) setSeenNote(Number(st.seenCount) || 0)
        if (cfg && runMode === null) setRunMode(cfg.runMode || 'headless')
        if (st && wsPath === null) setWsPath(String(st.frontWorkspace || ''))
      }, [cfg])

      const win = { ...DEFAULT_WINDOWS, ...(st?.windows || {}) }

      // ⭐ 人设：挂载时取一次（**不进轮询**，免得冲掉正在编辑的草稿）
      React.useEffect(() => {
        let alive = true
        ;(async () => {
          try {
            const d = await jget('/persona')
            if (!alive || !d?.ok) return
            setPersona((cur) => (cur === null ? (d.text || '') : cur))
            setPersonaSaved(d.text || '')
            setPersonaFile(d.file || '')
            setPersonaChars(d.chars ?? (d.text || '').length)
          } catch { /* 取不到就等用户点保存 */ }
        })()
        return () => { alive = false }
      }, [])

      // ⭐ 模型清单：同样只在挂载时取一次（providers/模型不会天天变）
      React.useEffect(() => {
        let alive = true
        ;(async () => {
          try {
            const d = await jget('/models')
            if (!alive) return
            if (Array.isArray(d?.providers)) setModels(d.providers)
            if (d?.note) setModelsNote(d.note)
            else if (d && d.ok === false && d.error) setModelsNote(d.error)
            const cur = d?.current || {}
            setMProvider((v) => (v === null ? (cur.provider || '') : v))
            setMModel((v) => (v === null ? (cur.model || '') : v))
            setMEffort((v) => (v === null ? (cur.reasoningEffort || '') : v))
          } catch (e) { setModelsNote(String(e?.message ?? e)) }
        })()
        return () => { alive = false }
      }, [])

      const say = (text, tone) => {
        setMsg(text); setMsgTone(tone || '')
        setRunNote(text ? { t: text, tone: tone || '' } : null)   // ⭐ 同时镜像到顶部，免得提示掉到页面最底下看不见
      }

      const patch = async (p, what) => {
        setBusy(JSON.stringify(p))
        try {
          const r = await jpost('/config', p)
          if (r?.config) setSt((old) => ({ ...old, config: r.config }))
          say(what ? `${what}：已保存` : '已保存', 'good')
        } catch (e) { say(String(e?.message ?? e), 'warn') }
        finally { setBusy('') }
      }

      /** ⭐ 列产物（每条一份 md；2026-10-16 加，取代「看今天的报告」）。 */
      const onListReports = async () => {
        if (reports !== null) { setReports(null); setReportFile(null); return }  // 再点一次收起
        setBusy('reports')
        try {
          const r = await jget('/reports')
          setReports(r && r.ok ? r : { ok: false, files: [], count: 0 })
          setReportFile(null)
        } catch (e) { say('读不到产物清单：' + String(e?.message ?? e), 'warn') } finally { setBusy('') }
      }

      // ⚠️ 旧的 `onShowReport`（读「今天的报告」）**已删**（2026-10-16）：
      //    日报不再写了，那个按钮也换成了「看产物」。`/report` 路由留着兼容旧文件。

      const copyText = async (text) => {
        const v = String(text || '')
        try {
          await navigator.clipboard.writeText(v)
          say('已复制：' + v, 'good')
        } catch {
          say('复制失败 —— 路径是：' + v)       // 兜底：至少把路径显示出来，手动选中也能复制
        }
      }

      const onOpenFolder = async (what) => {
        try {
          const r = await jpost('/open', { what })
          if (r && r.ok) say('已请系统打开：' + (r.opened || '') + '（要是没看到窗口，用旁边的「复制报告路径」——那个一定成）', 'good')
          else say('打不开（' + ((r && r.error) || '未知原因') + '）—— 你可以手动打开这个路径：' + ((r && r.dir) || ''))
        } catch (e) { say(String(e?.message ?? e), 'warn') }
      }

      const onUpgrade = async () => {
        setBusy('upgrade')
        try {
          const r = await jpost('/upgrade', {})
          say((r && r.hint) || '正在升级', 'good')
          say('升级过程写在下面的「主依赖的日志」里 —— 完了记得重启一次 dsh（不重启还是旧版）', 'warn')
        } catch (e) { say(String(e?.message ?? e), 'warn') } finally { setBusy('') }
      }

      const onCheckUpdate = async () => {
        setBusy('update')
        try {
          const r = await jget('/update')
          if (r && r.ok && r.latest) {
            if (r.hasNew) {
              setNewVer(r.latest)
              say('有新版 v' + r.latest + '（你的是 v' + r.current + '）—— 点右边的「一键升级」，完了重启一次 dsh', 'warn')
            } else say('已经是最新版 v' + r.current, 'good')
          } else {
            say('查不到最新版（可能网络不通）—— 你现在的版本是 v' + ((r && r.current) || '?'))
          }
        } catch (e) { say(String(e?.message ?? e), 'warn') } finally { setBusy('') }
      }

      const onCheck = async () => {
        setBusy('check')
        say('')
        try {
          const r = await jpost('/check', {})
          if (r && r.ok) say('能用！' + (r.steps || []).join('、'))
          else say('还不能用：' + (r && r.error ? r.error : '没拿到结果'))
        } catch (e) { say(String(e?.message ?? e), 'warn') } finally { setBusy('') }
      }

      const onInstallAsr = async () => {
        setBusy('asr')
        say('')
        try {
          const r = await jpost('/install-asr', {})
          say(r?.started ? '开始装转写依赖 —— 进度显示在下面（要下模型，慢一点正常）' : (r?.hint || '没起来'),
            r?.started ? 'good' : 'warn')
        } catch (e) { say(String(e?.message ?? e), 'warn') } finally { setBusy('') }
      }

      const onInstall = async () => {
        setBusy('install')
        say('')
        try {
          const r = await jpost('/install', {})
          say(r?.hint || '已经在后台开始装了', '')
        } catch (e) { say(String(e?.message ?? e), 'warn') }
        finally { setBusy('') }
      }

      const onRun = async () => {
        setBusy('run')
        try {
          const r = await jpost('/run', {})
          if (r?.started) {
            if (r.mode === 'front') {
              // ⭐ 前台：会话已经建好了。**直接跳过去**，你就能看着它跑
              //    （这正是前台模式的意义 —— 后台那轮你看不见）。
              setRunNote({ tone: 'good', t: `已建前台会话（${r.sessionId || ''}），正在跳过去…` })
              const openSession = resolveOpenSession()   // 点击时才取服务
              if (openSession && r.sessionId) {
                try { openSession(r.sessionId) } catch (e) { setRunNote({ tone: 'warn', t: `会话建好了，但跳转失败：${String(e?.message ?? e)}` }) }
              } else if (r.sessionId) {
                setRunNote({ tone: 'warn', t: `会话建好了（${r.sessionId}），但这个环境拿不到跳转能力 —— 去左侧会话列表里找「刷B站 …」` })
              }
            } else {
              say('已经在后台跑一轮了，报告会写在 out/ 里', 'good')
            }
          } else {
            // ⚠️ 如实回显失败原因（前台模式失败的原因往往是"服务拿不到"，不是"跑挂了"）
            setRunNote({ tone: 'warn', t: r?.error ? `没起来：${r.error}` : '没起来，看 duty.log' })
          }
        } catch (e) { say(String(e?.message ?? e), 'warn') }
        finally { setBusy('') }
      }

      const onLoginStart = async () => {
        setBusy('login')
        setLoginTone('')
        setLoginState('正在出码…')
        try {
          const r = await jpost('/login/start', {})
          if (!r?.ok) { setLoginTone('warn'); setLoginState(r?.error || '出码失败'); return }
          setLogin({ key: r.key, qr: r.qr })
          if (!r.qr) { setLoginTone('warn'); setLoginState('没画出二维码 —— 先点上面的「重装依赖」（venv 里要有 qrcode）') }
          else setLoginState('用手机 B站 扫这张码')
          let n = 0
          const timer = setInterval(async () => {
            n += 1
            try {
              const p = await jpost('/login/poll', { key: r.key })
              if (p?.state === 'ok') {
                clearInterval(timer); setLogin(null)
                setLoginTone('good'); setLoginState('登录成功')
                setSt((old) => ({ ...old, loggedIn: true }))
              } else if (p?.state === 'scanned') { setLoginTone(''); setLoginState('扫到了，请在手机上确认') }
              else if (p?.state === 'expired') { clearInterval(timer); setLogin(null); setLoginTone('warn'); setLoginState('二维码过期了，再点一次「扫码登录」') }
              else { setLoginTone(''); setLoginState('等扫码…') }
            } catch { /* 抖动就下次再问 */ }
            if (n > 90) { clearInterval(timer); setLogin(null); setLoginTone('warn'); setLoginState('超时了，再点一次「扫码登录」') }
          }, 2000)
        } catch (e) { setLoginTone('warn'); setLoginState(String(e?.message ?? e)) }
        finally { setBusy('') }
      }

      const onSaveText = async () => {
        const list = String(kws || '').split('\n').map((s) => s.trim()).filter(Boolean)
        await patch({ keywords: list }, '关键词')
      }

      // ⭐ 保存人设：POST /persona ⇒ 落盘 persona.md。下一轮 promptFor() 现读 ⇒ 即时生效
      const onSavePersona = async () => {
        const text = String(persona || '')
        setBusy('persona')
        setPersonaMsg('')
        try {
          const r = await jpost('/persona', { text })
          if (r?.ok) {
            setPersonaSaved(text)
            setPersonaChars(r.chars ?? text.length)
            setPersonaTone('good')
            setPersonaMsg('人设已保存 —— 下一轮就用新的（不用重启）')
            say('人设已保存', 'good')
          } else {
            setPersonaTone('warn'); setPersonaMsg(r?.error || '保存失败')
          }
        } catch (e) { setPersonaTone('warn'); setPersonaMsg(String(e?.message ?? e)) }
        finally { setBusy('') }
      }

      // ⭐ 保存模型选择：写进 config，下一轮 overlay 会把它覆盖进那一轮
      const onSaveModel = async () => {
        await patch({
          llmProvider: String(mProvider || '').trim(),
          llmModel: String(mModel || '').trim(),
          llmReasoningEffort: String(mEffort || '').trim(),
        }, '模型')
      }

      if (!cfg) {
        return h('div', { 'data-bd-page': '' }, h('div', { 'data-bd-note': '' }, '读设置中…'))
      }

      const sw = (k) => Boolean(cfg[k])

      return h('div', { 'data-bd-page': '' },

        /* ── 今天 ── */
        h('div', { 'data-bd-row': '' },
          h('span', { 'data-bd-badge': '' }, `今天已挑 ${st.ranToday} / ${cfg.perDay} 条`),
          h('span', { 'data-bd-badge': '' }, '环境' + (st.venvReady ? '已就绪' : (st.installing ? '正在装' : '未装'))),
          h('span', { 'data-bd-badge': '' }, st.loggedIn ? 'B站已登录' : 'B站未登录'),
            h('span', { 'data-bd-badge': '' }, 'v' + (st.version || '?')),
          h('div', { 'data-bd-grow': '' }),
          h('button', { 'data-bd-btn': '', disabled: busy === 'run', onClick: onRun }, '现在跑一轮')),
          runNote ? h('div', { 'data-bd-msg': '', 'data-good': runNote.tone === 'good' ? '' : undefined,
            'data-warn': runNote.tone === 'warn' ? '' : undefined }, runNote.t) : null,

        /* ── 跑在哪（2026-10-16 新增） ── */
      h('div', { 'data-bd-sec': '' },
        h('div', { 'data-bd-h': '' }, '跑在哪'),
        h('select', {
          'data-bd-input': '', value: runMode ?? 'headless',
          onChange: (e) => { setRunMode(e.target.value); patch({ runMode: e.target.value }, '跑在哪') },
        },
          h('option', { value: 'front' }, '前台 —— 在主应用里开一个会话（能看、能追溯）'),
          h('option', { value: 'headless' }, '后台 —— 另起一个子进程（只留日报）')),
        h('div', { 'data-bd-note': '' }, runMode === 'front'
          ? '跑一轮会在主应用里**新建一个真实会话**（固定工作区 front-sessions），点「现在跑一轮」之后自动跳过去 —— '
            + '你能看着它搜、看着它判断，会话也留在列表里能回看。定时器也会走这条。'
          : '跑一轮会另起一个 dsh 子进程，你看不见它；跑完只留一份日报在 out/ 里。'
            + '（这条需要下面那些「装依赖 / 登录 / 模型」都配好。）'),
        st.lastFrontSessionId && (runMode ?? 'headless') === 'front'
          ? h('div', { 'data-bd-row': '' },
              h('div', { 'data-bd-grow': '' },
                h('div', { 'data-bd-note': '' }, `最近一次前台会话：${st.lastFrontSessionId}`)),
              h('button', {
                'data-bd-btn': '',
                onClick: () => {
                  const openSession = resolveOpenSession()
                  if (!openSession) { setRunNote({ tone: 'warn', t: '这个环境拿不到跳转能力（缺 uiWorkspace 服务）' }); return }
                  try { openSession(st.lastFrontSessionId) } catch (e) { setRunNote({ tone: 'warn', t: `跳转失败：${String(e?.message ?? e)}` }) }
                },
              }, '去到那个会话'))
          : null,

        /* ⭐ 前台会话的工作区（只有前台模式才显示；2026-10-16 加） */
        (runMode ?? 'headless') === 'front'
          ? h('div', { 'data-bd-sub': '' },
              h('div', { 'data-bd-row': '' },
                h('div', { 'data-bd-grow': '' },
                  h('div', { 'data-bd-label': '' }, '会话建在哪个目录'),
                  h('div', { 'data-bd-note': '' },
                    (cfg && cfg.frontWorkspace ? '你自己选的目录' : '默认（插件家目录下的 front-sessions）'))),
                h('button', {
                  'data-bd-btn': '', disabled: wsBusy,
                  onClick: async () => {
                    if (!doPickDirectory) { setRunNote({ tone: 'warn', t: '这个环境拿不到目录选择器（缺 uiWorkspace 服务）' }); return }
                    setWsBusy(true)
                    try {
                      const picked = await doPickDirectory()
                      if (picked === null) return              // 用户取消
                      await patch({ frontWorkspace: picked }, '会话目录')
                      setWsPath(picked)
                      setRunNote({ tone: 'good', t: `会话目录已设为：${picked}` })
                    } catch (e) { setRunNote({ tone: 'warn', t: String(e?.message ?? e) }) }
                    finally { setWsBusy(false) }
                  },
                }, wsBusy ? '正在选…' : (cfg && cfg.frontWorkspace ? '改目录' : '选择目录'))),
              h('div', { 'data-bd-note': '' },
                `当前：${st.frontWorkspace || '（读不到）'}`),
              (cfg && cfg.frontWorkspace)
                ? h('div', { 'data-bd-row': '' },
                    h('div', { 'data-bd-grow': '' },
                      h('div', { 'data-bd-note': '' }, '想用回默认目录就点右边')),
                    h('button', {
                      'data-bd-btn': '', disabled: wsBusy,
                      onClick: async () => {
                        setWsBusy(true)
                        try { await patch({ frontWorkspace: '' }, '会话目录'); setWsPath(''); setRunNote({ tone: 'good', t: '已改回默认目录（家目录下的 front-sessions）' }) }
                        catch (e) { setRunNote({ tone: 'warn', t: String(e?.message ?? e) }) }
                        finally { setWsBusy(false) }
                      },
                    }, '用默认'))
                : null,
              h('div', { 'data-bd-note': '' },
                '⚠️ 必须是绝对路径；每轮会在这里**新建一个会话**（工作区本身不变）。'))
          : null),

      /* ── 定时 ── */
        h('div', { 'data-bd-sec': '' },
          h('div', { 'data-bd-h': '' }, '什么时候自己跑'),
          h(ToggleRow, {
            label: '峰谷时段自动刷',
            note: '只在谷时跑 —— 工作日 12:00–14:00 与 18:00 之后（整个周末也算谷时）；关了就只能手动跑',
            on: sw('peakValley'),
            onChange: (v) => patch({ peakValley: v }, '峰谷时段自动刷'),
          }),
          sw('peakValley') ? h('div', { 'data-bd-sub': '' },
            ...['noon', 'night'].map((k) => h(ToggleRow, {
              key: k,
              label: win[k].label,
              note: `${win[k].start} – ${win[k].end}`,
              on: sw(k),
              onChange: (v) => patch({ [k]: v }, win[k].label),
            }))) : null),

        /* ── 一轮挑几条 ── */
        h('div', { 'data-bd-sec': '' },
          h('div', { 'data-bd-h': '' }, '一轮挑几条'),
          h('div', { 'data-bd-row': '' },
            h('div', { 'data-bd-grow': '' },
              h('div', { 'data-bd-label': '' }, '每天最多挑几条'),
              h('div', { 'data-bd-note': '' }, '填 0 = 不自动刷（还是能手动跑）')),
            h('input', {
              'data-bd-input': '', 'data-bd-num': '', type: 'number', min: 0, max: 50,
              value: perDay ?? '',
              onChange: (e) => setPerDay(e.target.value),
              onBlur: () => { const n = Math.max(0, Math.min(Number(perDay) || 0, 50)); setPerDay(String(n)); patch({ perDay: n }, '每天挑几条') },
            })),
          st.lastRunAt ? h('div', { 'data-bd-note': '' }, `上次跑：${new Date(st.lastRunAt).toLocaleString('zh-CN')}`) : null),

        /* ── 发言与转写 ── */
        h('div', { 'data-bd-sec': '' },
          h('div', { 'data-bd-h': '' }, '它会不会替你说话'),
          h(ToggleRow, {
            label: '回复评论（只回楼中楼）',
            note: '默认关；开了之后它只回「直接回复到你那条评论下面的人」，不参与讨论',
            on: sw('replyToComments'),
            onChange: (v) => patch({ replyToComments: v }, '回复评论'),
          }),
          sw('replyToComments') ? h('div', { 'data-bd-sub': '' },
            h('div', { 'data-bd-row': '' },
              h('div', { 'data-bd-grow': '' },
                h('div', { 'data-bd-label': '' }, '每轮最多回几条'),
                h('div', { 'data-bd-note': '' }, '只回直接回在你那条评论下面的人')),
              h('input', {
                'data-bd-input': '', 'data-bd-num': '', type: 'number', min: 1, max: 10,
                value: replyPer ?? '',
                onChange: (e) => setReplyPer(e.target.value),
                onBlur: () => { const n = Math.max(1, Math.min(Number(replyPer) || 1, 10)); setReplyPer(String(n)); patch({ replyPerRound: n }, '每轮几条回复') },
              }))) : null,
          h(ToggleRow, {
            label: '自动评论并 @ 你',
            note: '默认关；开了之后它会在挑中的视频下面留评论，并 @ 你填的那个人',
            on: sw('autoComment'),
            onChange: (v) => patch({ autoComment: v }, '自动评论'),
          }),
          sw('autoComment') ? h('div', { 'data-bd-sub': '' },
            h('div', { 'data-bd-row': '' },
              h('div', { 'data-bd-grow': '' },
                h('div', { 'data-bd-label': '' }, '每轮最多发几条评论'),
                h('div', { 'data-bd-note': '' }, '每条评论里 @ 一次下面那个人')),
              h('input', {
                'data-bd-input': '', 'data-bd-num': '', type: 'number', min: 1, max: 20,
                value: perRound ?? '',
                onChange: (e) => setPerRound(e.target.value),
                onBlur: () => { const n = Math.max(1, Math.min(Number(perRound) || 1, 20)); setPerRound(String(n)); patch({ commentPerRound: n }, '每轮几条评论') },
              })),
            h('div', { 'data-bd-label': '' }, '要 @ 谁（B站 昵称）'),
            h('input', {
              'data-bd-input': '', value: mention ?? '',
              placeholder: '填你要 @ 的那个人的 B站 昵称；留空 = 只写报告、不发评论',
              onChange: (e) => setMention(e.target.value),
              onBlur: () => { const v = String(mention || '').trim(); setMention(v); patch({ mentionName: v }, '要 @ 谁') },
            }),
            h('div', { 'data-bd-note': '' }, '留空的话它就不发评论了 —— 因为评论存在的意义就是 @ 那一下')) : null,
          h(ToggleRow, {
            label: '本地转写没字幕的视频',
            note: '默认关；开了以后，没字幕的视频会在本机转写一遍（不花 API 钱）',
            on: sw('transcribe'),
            onChange: (v) => patch({ transcribe: v }, '本地转写'),
          }),
          sw('transcribe') ? h('div', { 'data-bd-sub': '' },
            h('div', { 'data-bd-row': '' },
              h('button', { 'data-bd-btn': '', disabled: busy === 'asr', onClick: onInstallAsr },
                st.asrReady ? '重装转写依赖' : '装转写依赖'),
              h('div', { 'data-bd-note': '' },
                !st.asrReady ? '还没装 —— 没装的话转写用不了'
                  : (st.asrModelReady ? '环境和模型都好了' : '环境好了；模型会在第一次转写时自动下（几百 MB）'))),
            h('div', { 'data-bd-note': '' },
              '点一下就好：建一个独立环境、装 faster-whisper + yt-dlp，并把 Whisper 模型也下好',
              h('br'),
              '（模型默认 small，几百 MB，走国内镜像；装一次就够了）'),
            st.asrTail ? h('div', null,
              h('div', { 'data-bd-note': '' }, st.asrInstalling ? '正在装转写依赖（进度）：' : '转写依赖的日志（末尾）—— 只有「没字幕的视频」用得到它：'),
              h('pre', { 'data-bd-pre': '' }, st.asrTail)) : null) : null),

        /* ── 关注什么 ── */
        h('div', { 'data-bd-sec': '' },
          h('div', { 'data-bd-h': '' }, '关注什么'),
          h('textarea', {
            'data-bd-input': '', rows: 5,
            placeholder: '一行一个主题；留空用内置那几组\n例：\n有关大模型的论文\nDSH 插件',
            value: kws ?? '', onChange: (e) => setKws(e.target.value),
          }),
          h('div', { 'data-bd-label': '' }, '这些字怎么用'),
          h('select', {
            'data-bd-input': '', value: kwMode ?? 'llm',
            onChange: (e) => { setKwMode(e.target.value); patch({ keywordMode: e.target.value }, '关键词用法') },
          },
            h('option', { value: 'llm' }, '当「主题」—— 让模型自己组合出多种搜索词（推荐）'),
            h('option', { value: 'fixed' }, '当「现成搜索词」—— 每行原样拿去搜')),
          h('div', { 'data-bd-note': '' }, kwMode === 'fixed'
            ? '每行会原样当搜索词。宽泛的词（如「有关大模型的论文」）搜回来多半是入门教程和水论文技巧。'
            : '模型会按这些主题自己编几个更具体的搜索词、一轮里换 2~4 组去搜 —— 比原样丢一个宽泛词召回到的东西好得多。'),
          h('div', { 'data-bd-label': '' }, '日报写多细'),
          h('select', {
            'data-bd-input': '', value: rl ?? 'full',
            onChange: (e) => { setRl(e.target.value); patch({ reportLevel: e.target.value }, '日报形态') },
          },
            h('option', { value: 'full' }, '完整 —— 每条：标题 / UP / 为什么值得（默认）'),
            h('option', { value: 'brief' }, '薄 —— 每条一两行，只留值不值得 + 链接'),
            h('option', { value: 'off' }, '不写 —— 只发评论，不生成日报文件')),
          h('div', { 'data-bd-row': '' },
            h('button', { 'data-bd-btn': '', 'data-primary': '', disabled: Boolean(busy), onClick: onSaveText }, '保存'),
            msg ? h('div', { 'data-bd-msg': '', 'data-good': msgTone === 'good' ? '' : undefined, 'data-warn': msgTone === 'warn' ? '' : undefined }, msg) : null)),

        /* ── 怎么搜（2026-10-16 新增） ── */
        h('div', { 'data-bd-sec': '' },
          h('div', { 'data-bd-h': '' }, '怎么搜'),
          h('div', { 'data-bd-note': '' }, '决定它从 B站 捞回什么。改完下一轮生效。'),

          h('div', { 'data-bd-row': '' },
            h('div', { 'data-bd-grow': '' },
              h('div', { 'data-bd-label': '' }, '看多少条'),
              h('div', { 'data-bd-note': '' }, '每搜一轮取回几条来读；再从中挑「每天最多挑几条」')),
            h('input', {
              'data-bd-input': '', 'data-bd-num': '', type: 'number', min: 1, max: 50,
              value: sNum ?? '', onChange: (e) => setSNum(e.target.value),
              onBlur: () => { const n = Math.max(1, Math.min(Number(sNum) || 20, 50)); setSNum(String(n)); patch({ searchNum: n }, '看多少条') },
            })),

          h('div', { 'data-bd-label': '' }, '按什么排序'),
          h('select', {
            'data-bd-input': '', value: sOrder ?? 'totalrank',
            onChange: (e) => { setSOrder(e.target.value); patch({ searchOrder: e.target.value }, '搜索排序') },
          },
            h('option', { value: 'totalrank' }, '综合（B站 默认，偏热度）'),
            h('option', { value: 'pubdate' }, '最新（按发布时间）'),
            h('option', { value: 'click' }, '播放量'),
            h('option', { value: 'dm' }, '弹幕数')),

          h('div', { 'data-bd-row': '' },
            h('div', { 'data-bd-grow': '' },
              h('div', { 'data-bd-label': '' }, '只看最近几天'),
              h('div', { 'data-bd-note': '' }, '0 = 不过滤（默认）。要按时间筛只能在这里设 —— B站 搜索结果里不带发布时间，捞回来本地没法再筛')),
            h('input', {
              'data-bd-input': '', 'data-bd-num': '', type: 'number', min: 0, max: 365,
              value: sDays ?? '', onChange: (e) => setSDays(e.target.value),
              onBlur: () => { const n = Math.max(0, Math.min(Number(sDays) || 0, 365)); setSDays(String(n)); patch({ searchDays: n }, '只看最近几天') },
            })),

          h('div', { 'data-bd-note': '' },
            `判重表：已经记了 ${seenNote === null ? '…' : seenNote} 个视频`
            + ' —— 发过评论的会自动记进家目录的 seen.md，同一个视频不会再评论一次。')),

        /* ── 用哪个模型（2026-10-15 新增） ── */
        (() => {
          const provs = models || []
          const cur = provs.find((p) => p.id === mProvider)
          const mlist = cur?.models || []
          const isCustom = Boolean(mProvider) && !cur            // 存着一个下拉里没有的 provider（自定义/已下线）
          return h('div', { 'data-bd-sec': '' },
            h('div', { 'data-bd-h': '' }, '用哪个模型'),
            h('div', { 'data-bd-note': '' },
              '跑一轮时会用这里选的模型（覆盖 headless profile 的默认）。留空 = 用那个 profile 原本的默认。'),
            modelsNote ? h('div', { 'data-bd-note': '', 'data-warn': '' }, modelsNote) : null,
            h('div', { 'data-bd-row2': '' },
              h('select', {
                'data-bd-select': '',
                value: mProvider ?? '',
                onChange: (e) => { setMProvider(e.target.value); setMModel('') },   // 换 provider 要清掉 model
              },
                h('option', { value: '' }, '（不指定，用 profile 默认）'),
                ...provs.map((p) => h('option', { key: p.id, value: p.id }, `${p.name}（${p.id}）`)),
                isCustom ? h('option', { value: mProvider }, `${mProvider}（当前值，已不在清单里）`) : null),
              h('select', {
                'data-bd-select': '',
                value: mModel ?? '',
                disabled: !mProvider,
                onChange: (e) => setMModel(e.target.value),
              },
                h('option', { value: '' }, mProvider ? '（该 provider 默认）' : '（先选 provider）'),
                ...mlist.map((m) => h('option', { key: m.id, value: m.id }, m.name && m.name !== m.id ? `${m.name}（${m.id}）` : m.id)),
                (mModel && !mlist.some((m) => m.id === mModel))
                  ? h('option', { value: mModel }, `${mModel}（当前值，已不在清单里）`) : null)),
            h('div', { 'data-bd-row2': '' },
              h('select', {
                'data-bd-select': '',
                value: mEffort ?? '',
                onChange: (e) => setMEffort(e.target.value),
              },
                h('option', { value: '' }, '（思考档位：不指定）'),
                ...['off', 'low', 'medium', 'high', 'max'].map((x) => h('option', { key: x, value: x }, x))),
              h('button', { 'data-bd-btn': '', 'data-primary': '', disabled: Boolean(busy), onClick: onSaveModel }, '保存模型')),
            h('div', { 'data-bd-note': '' },
              mProvider && mModel ? `当前：${mProvider} / ${mModel}${mEffort ? ` · ${mEffort}` : ''}`
                : '当前：未指定（用 profile 默认）'))
        })(),

        /* ── 人设（2026-10-15 新增：不再用 AGENTS.md，改插件自己的文本框） ── */
        h('div', { 'data-bd-sec': '' },
          h('div', { 'data-bd-h': '' }, '它的人设'),
          h(ToggleRow, {
            label: '启用下面这份人设',
            note: '默认开；关掉的话它就中性出场，不扮演任何人格',
            on: sw('personaEnabled'),
            onChange: (v) => patch({ personaEnabled: v }, '启用人设'),
          }),
          sw('personaEnabled') ? h('div', { 'data-bd-sub': '' },
            h('textarea', {
              'data-bd-input': '', 'data-bd-persona': '', rows: 12,
              placeholder: '写它的说话方式与准则。例如：\n· 叫我「老板」，说话短、别客套\n· 只推我看得懂的技术内容，别推营销号\n· 拿不准的事就说没查到，不许编',
              value: persona ?? '',
              onChange: (e) => setPersona(e.target.value),
            }),
            h('div', { 'data-bd-row': '' },
              h('button', { 'data-bd-btn': '', 'data-primary': '', disabled: busy === 'persona', onClick: onSavePersona }, '保存人设'),
              h('button', {
                'data-bd-btn': '', disabled: busy === 'persona' || !(persona || '').trim(),
                onClick: () => { setPersona(''); },
              }, '清空'),
              (persona !== null && personaSaved !== null && persona !== personaSaved)
                ? h('span', { 'data-bd-note': '' }, '有未保存的改动') : null),
            h('div', { 'data-bd-note': '' },
              personaChars != null ? `当前 ${personaChars} 字符` : '',
              personaChars != null ? h('br') : null,
              '存本地：', h('code', null, personaFile || ''),
              h('br'),
              '每一轮开始前现读这个文件 —— 保存后**立刻生效**，不用重启 dsh。'),
            personaMsg ? h('div', {
              'data-bd-msg': '',
              'data-good': personaTone === 'good' ? '' : undefined,
              'data-warn': personaTone === 'warn' ? '' : undefined,
            }, personaMsg) : null) : null),

        /* ── 环境与账号 ── */
        h('div', { 'data-bd-sec': '' },
          h('div', { 'data-bd-h': '' }, '环境与账号'),
          h('div', { 'data-bd-row': '' },
            h('button', { 'data-bd-btn': '', disabled: busy === 'install', onClick: onInstall },
              st.venvReady ? '重装主依赖' : '装主依赖（建 venv）'),
            h('button', { 'data-bd-btn': '', disabled: busy === 'check', onClick: onCheck }, '测一下'),
            h('button', { 'data-bd-btn': '', disabled: busy === 'update', onClick: onCheckUpdate }, '检查更新'),
            newVer ? h('button', { 'data-bd-btn': '', 'data-primary': '', disabled: busy === 'upgrade', onClick: onUpgrade }, '一键升级到 v' + newVer) : null,
            h('button', { 'data-bd-btn': '', disabled: busy === 'login', onClick: onLoginStart }, '扫码登录'),
            h('div', { 'data-bd-note': '' },
              !st.venvReady ? (st.installFailed ? '上次没装成 → 看下面日志' : '还没装 → 先点「装主依赖」')
                : (st.loggedIn ? '装好了 → 下一步「扫码登录」' : '环境好了 → 点「扫码登录」'))),
          loginState ? h('div', { 'data-bd-msg': '', 'data-good': loginTone === 'good' ? '' : undefined, 'data-warn': loginTone === 'warn' ? '' : undefined }, loginState) : null,
          st.installTail ? h('div', null,
            h('div', { 'data-bd-note': '' }, st.installing ? '正在装主依赖（进度）：' : '主依赖的日志（B站 搜索 / 字幕 / 评论 用得到，末尾）：'),
            h('pre', { 'data-bd-pre': '' }, st.installTail)) : null,
          login?.qr ? h('div', { 'data-bd-qr': '' },
            h('img', { src: login.qr, alt: 'B站登录二维码' }),
            h('div', { 'data-bd-note': '' },
              '手机 B站 → 我的 → 扫一扫。',
              h('br'),
              '确认时选「记住我 / 长期」那张 —— 选 24 小时的话，明天就得重扫。')) : null),

        /* ── 它是怎么干活的（给他看的） ── */
        h('div', { 'data-bd-sec': '' },
          h('div', { 'data-bd-h': '' }, '它的地盘'),
          h('div', { 'data-bd-kv': '' },
            `家目录：${st.home}`,
            h('br'),
            `产物目录：${st.reportDir || '（读不到）'}`),
          h('div', { 'data-bd-note': '' },
            '挑中的每条视频各写一份 md（文件名：标题-YYMMDD），不再是汇总日报。'),
          h('div', { 'data-bd-row': '' },
            h('button', { 'data-bd-btn': '', disabled: busy === 'reports', onClick: onListReports },
              reports !== null ? '收起清单' : '看产物'),
            h('button', { 'data-bd-btn': '', onClick: () => onOpenFolder('out') }, '打开报告文件夹'),
            h('button', { 'data-bd-btn': '', onClick: () => onOpenFolder('home') }, '打开家目录')),
          reports !== null
            ? (reports.files?.length
              ? h('div', null,
                  h('div', { 'data-bd-note': '' }, `共 ${reports.count} 份，最近的排前面（点一行看内容）：`),
                  h('div', null, reports.files.map((f) => h('div', { 'data-bd-row': '', key: f.name },
                    h('div', { 'data-bd-grow': '' },
                      h('div', { 'data-bd-note': '' }, `${f.name}　${Math.round(f.size / 1024)}KB`)),
                    h('button', {
                      'data-bd-btn': '',
                      onClick: async () => {
                        try { const r = await jget('/report-file?name=' + encodeURIComponent(f.name)); setReportFile(r?.text || '（空的）') }
                        catch (e) { setReportFile('读不到：' + String(e?.message ?? e)) }
                      },
                    }, '看')))),
                  reportFile !== null ? h('pre', { 'data-bd-pre': '' }, reportFile) : null)
              : h('div', { 'data-bd-note': '' }, '还没有产物 —— 跑一轮之后，挑中的每条会各写一份 md。'))
            : null),
      )
    }

    /** 右侧栏 tab 类型 id；也是 `sidebar.right.pane.tab` 那个 keyed 槽的键。 */
    const TAB_ID = 'bili-scroll'
    /** tab 类型的 kind：openTab 用它指名；不能与内置重名（见文件头）。 */
    const TAB_KIND = 'bili-scroll'

    /**
     * 右侧栏 tab 的本体 = 当前这个面板组件（**不是 iframe**）。
     *
     * 为什么不像别的插件那样嵌 iframe：本插件的面板**本来就是 React 组件**
     * （`Panel` 就在本文件里），直接复用最省事 —— 没有 iframe 的高度/滚动条打架问题，
     * 也不用再发一份页面出去。（若面板是独立 HTML，那才该用 iframe。）
     *
     * 🔴 **它必须定义在 `apply()` 里面**（2026-10-16 真机抓到的 bug）：
     *    第一版把它放在这里（模块顶层），而 `openSession` 是 `apply()` 里的局部变量
     *    ⇒ 渲染时抛 `ReferenceError: openSession is not defined`，
     *    表现为 **右侧栏那个 tab 整块崩掉**（`slot entry crashed in 'sidebar.right.pane.tab'`）。
     *    ⚠️ 离线探针与 `selfcheck` **都抓不到这个**（它们不渲染组件）——
     *       只有真机点开面板才会暴露。⇒ 这类"作用域/渲染"问题**必须真机验**。
     *    ⇒ 现在改成：`makeTab(resolveOpenSession)` 在 `apply()` 里调用，
     *      而且传的是**解析函数**（点击时现取服务），不是那一刻的值。
     */
    function makeTab(resolveOpenSession, doPickDirectory) {
      return function BiliScrollTab() {
        // 🔴 **必须现取，不能按值捕获**（2026-10-16 真机抓到）：
        //    `openSession` 由 `ctx.inject(['uiWorkspace'], cb)` **异步**填上，
        //    而 tab 本体在 `apply()` 里**同步**注册
        //    ⇒ 按值传的话注册那刻拿到 `null`，之后填上也改不了已捕获那份
        //      ⇒ 按钮永远说"拿不到跳转能力"。
        //    ⚠️ 所以这里传的是**解析函数**，按钮**点击时**才真正取服务。
        return h('div', { 'data-bd-tabwrap': '' }, h(Panel, { resolveOpenSession, doPickDirectory }))
      }
    }

    return {
      /**
       * ⚠️ 这里是**客户端服务短名**，不是包名。
       *    包名那份在 package.json 的 `dsh.client.inject`（两处含义不同）。
       *    `sidebarRightTabs` 由 `@deepseek-ai/dsh-client-ui-sidebar-right` 提供。
       *    ⭐ `uiWorkspace`（2026-10-16 加）—— 前台跑完之后用它 `openSession()` 跳到那个会话。
       *       ⚠️ 它由 `@deepseek-ai/dsh-client-ui-workspace` 提供 ⇒ package.json 那份也要加。
       */
      inject: ['slots', 'sidebarRightTabs', 'uiWorkspace'],
      apply(ctx) {
        const style = document.createElement('style')
        style.setAttribute('data-plugin-css', 'dsh-bili-duty')
        style.textContent = CSS
        document.head.appendChild(style)
        ctx.effect(() => () => style.remove(), 'dsh-bili-duty: 面板样式')

        /**
         * ⭐ **打开 DSH 原生的目录选择器**（2026-10-16 加，给"前台工作区"用）。
         *
         * 照 `dsh-workspace-auto` 的现成做法（`src/client/WorkspaceRootSetting.tsx`）：
         *   目录选择器挂在 **`ctx.uiWorkspace.pickDirectory()`** ——
         *   ⚠️ **不是** `ctx.workspaces`（那个在新版只剩纯数据命令 list/create/rename…）。
         *   签名 `pickDirectory(): Promise<string | null>`（null = 用户取消）。
         *
         * ⚠️ 与 `openSession` 同样：**异步 inject** ⇒ 每次现取，别按值捕获。
         */
        const pickDirectory = async () => {
          const ws = ctx.get('uiWorkspace')
          if (ws && typeof ws.pickDirectory === 'function') return await ws.pickDirectory()
          throw new Error('这个环境拿不到目录选择器（缺 uiWorkspace 服务）')
        }

        /**
         * ⭐ **跳到某个会话**（前台跑完之后用）。
         *
         * 照 memj 的做法（库内条目 `8be4b18d`）：**必须走 `ctx.inject` + `scope.get`**，
         * 不能 `ctx.uiWorkspace`（属性访问是 undefined）。
         * `openSession(target: SessionTarget)` 是**同步**的、直接传 id 字符串即可
         * —— 它就是"点侧栏里那条会话"走的那条路。
         *
         * 🔴 **这里是异步填上的**（inject 回调何时跑由 DSH 定）⇒ 不能按值传给组件，
         *    必须给一个**解析函数**，点击时现取（真机踩过：按值传永远是 null）。
         */
        /** inject 那条路填上的跳转函数（可能一直是 null）。 */
        let injectedOpenSession = null
        const resolveOpenSession = () => {
          if (injectedOpenSession) return injectedOpenSession
          // 兜底：有些版本 `ctx.get` 直接拿得到
          try {
            const ws = ctx.get('uiWorkspace')
            if (ws && typeof ws.openSession === 'function') return (id) => ws.openSession(id)
          } catch { /* 取不到就是 null */ }
          return null
        }
        // ⚠️ 两条路都试，谁先能拿到就用谁（`resolveOpenSession` 每次现查 ⇒ 后填上的也能用）。
        try {
          ctx.inject(['uiWorkspace'], (scope) => {
            const ws = scope.get('uiWorkspace')
            if (ws && typeof ws.openSession === 'function') {
              injectedOpenSession = (id) => ws.openSession(id)
            }
          })
        } catch (e) {
          // ⚠️ 拿不到不算致命：面板上那个按钮会显示"这个环境不支持跳转"，而不是静默没反应。
          console.warn('[dsh-bili-scroll] inject uiWorkspace 失败，改用 ctx.get 兜底：', e)
        }

        const slots = (typeof ctx.get === 'function' ? ctx.get('slots') : undefined) || ctx.slots
        if (!slots) return

        // ── ① tab 类型定义：让它在右侧栏「开始」页出现一张卡 ──
        //    整段包 try/catch：boot 对「任一 entry 未激活」是致命的，
        //    宁可本插件没入口，也不能把整页 boot 拖垮。
        try {
          ctx.sidebarRightTabs.register({
            id: TAB_ID,
            kind: TAB_KIND,
            // `extension` = 可被 builtin 覆盖的扩展带；三值只有 extension / builtin / fallback。
            priority: 'extension',
            keepMounted: true,                 // 切走/换会话不卸载，否则每次展开都回首页
            title: () => '刷B站',
            guide: [
              {
                id: 'panel',
                order: 40,                     // 排在 wb-switch(30) 之后
                title: () => '刷B站',
                description: () => '每天替你看一轮 B站、挑出值得的，写份日报',
              },
            ],
          })
        } catch (e) { console.error('[dsh-bili-duty] 注册右侧栏 tab 类型失败：', e) }

        // ── ② tab 本体（🔴 只注册 ① 的卡是点不动的）──
        //    key 必须是 ① 里的 `id`，不是 `kind`。
        //    ⭐ 组件在**这里**建，并把**解析函数**给它（`uiWorkspace` 是异步填上的，
        //       按值传会拿到 null ⇒ 按钮永远说"拿不到跳转能力"，真机踩过）。
        try {
          const Tab = makeTab(resolveOpenSession, pickDirectory)
          ctx.effect(() => slots.inject('sidebar.right.pane.tab', () =>
            slots.register({ name: 'sidebar.right.pane.tab', key: TAB_ID }, Tab),
          ), 'bili-duty: 右侧栏 tab 本体')
        } catch (e) { console.error('[dsh-bili-duty] 注册右侧栏 tab 本体失败：', e) }

        // ── ③ tab 标题芯片（可选；不注册会用 ① 的 title()）──
        try {
          ctx.effect(() => slots.inject('sidebar.right.pane.tab.title', () =>
            slots.register(
              { name: 'sidebar.right.pane.tab.title', key: TAB_ID },
              function BiliScrollTitle() { return h('span', null, '刷B站') },
            ),
          ), 'bili-duty: 右侧栏 tab 标题')
        } catch (e) { console.error('[dsh-bili-duty] 注册右侧栏 tab 标题失败：', e) }
      },
    }
  },
})
