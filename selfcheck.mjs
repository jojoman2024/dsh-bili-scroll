/**
 * selfcheck.mjs —— 插件的"预检"：**两个半端都在本地真跑一遍**，不靠"重启一次才知道错哪"
 *
 * 为什么要有它（2026-10-14 连栽两次，都是重启后翻 `.dsh-web.err.log` 才发现）：
 *   ① `config` 的值是对象 ⇒ 定时器里 TypeError ⇒ **把整个 dsh 带走**；
 *   ② `parameters.patch` 是 `{ type:'object' }` ⇒ `defineTool` 抛 JsonSchemaError ⇒ **插件整条不激活**。
 *
 * 用法：`node --import ./tools/register.mjs selfcheck.mjs`（解析钩子见 tools/host-resolver.mjs）
 * 退出码：0 = 两个半端都正常；1 = 有问题（宿主里就会 "entry did not activate" / 设置页空白）
 */
import { mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const SANDBOX_HOME = join(tmpdir(), 'dsh-bili-duty-selfcheck')
const fail = (msg, e) => {
  console.error(`\n✗ ${msg}`)
  if (e) console.error(`  ${e?.name}: ${e?.message}`)
  const frame = String(e?.stack ?? '').split('\n').slice(1, 4).join('\n')
  if (frame) console.error(frame)
  process.exit(1)
}

/* ────────────── ① host 半端：假 ctx 上真跑 apply() ────────────── */

let mod
try {
  mod = await import('./index.js')
} catch (e) {
  fail('连 import index.js 都失败（依赖没解析？检查 tools/host-resolver.mjs）', e)
}

const registered = []
const fakeCtx = {
  // ⭐ 宿主给的是**函数**（`dshHomePath(...segments)`），这里照样给函数 —— 别用字符串
  get: (k) => (k === 'dshHomePath' ? (...seg) => join(SANDBOX_HOME, ...seg) : undefined),
  logger: { info: () => {}, warn: () => {} },
  tools: { register: (t) => { registered.push(t?.name ?? String(t)); return t } },
  webServer: { register: () => ({ dispose() {} }) },
  effect: (fn) => { try { return fn() } catch { return undefined } },
  settings: { register: () => ({}) },
  slots: { inject: () => {}, register: () => ({}) },
}

try { rmSync(SANDBOX_HOME, { recursive: true, force: true }) } catch { /* 清不掉就留着 */ }
mkdirSync(SANDBOX_HOME, { recursive: true })

try {
  mod.apply(fakeCtx, {})
} catch (e) {
  fail('host 半端 apply() 抛错了 —— 宿主里就是那句 `warning: 1 entry did not activate`', e)
}
console.log(`✓ host 半端 OK：name=${mod.name}  inject=${JSON.stringify(mod.inject)}  工具 ${registered.length} 个`)
for (const n of registered) console.log(`    - ${n}`)

/* ────────────── ② client 半端：假 window.__ModuleLoader__ 上真跑 factory() ────────────── */

// 🔴 **先查 CSS 模板串**（2026-10-16 加）：`client.js` 的 CSS 是一个模板字符串，
//    在它的注释里写**反引号**会提前闭合整个串 ⇒ 真机 `import failed`，
//    而 `node --check` **完全查不到**（模板串本身语法合法）。
//    这个坑一天踩了两次，所以提到最前面、做成硬检查。
try {
  const { execFileSync } = await import('node:child_process')
  execFileSync(process.execPath, ['tools/check-client-css.mjs', 'client.js'], { stdio: 'pipe' })
  console.log('✓ CSS 模板串 OK（没有会截断它的反引号）')
} catch (e) {
  const out = String(e?.stdout ?? '') + String(e?.stderr ?? '')
  fail('CSS 模板串有问题 —— 真机里会是 `import failed`（把注释里的反引号去掉）', { message: out.trim() })
}

/**
 * 🔴 **再查「产物报告」页的布局数值**（2026-10-22 加）。
 *
 * 为什么单独一条：那一页的错**全都是"数值/权重"型的**，而且**不报错**——
 *   ① 我写的 padding:0 被另一条权重更高的规则盖回 padding-top:20px
 *      ⇒ 左右栏竖线上方多 20px 空隙；
 *   ② 搜索区左右内距与列表不一致（10 vs 8）⇒ 左边缘错开、搜索框贴着竖线。
 * `node --check` 与上面那条 CSS 守卫**都查不到**这两类。使用者连着提了两次，
 * 所以做成硬检查（它会算 CSS 权重、比对两处数值是否相等）。
 */
try {
  const { execFileSync } = await import('node:child_process')
  const out = execFileSync(process.execPath, ['tools/check-artifacts-layout.mjs', 'client.js'],
    { stdio: 'pipe', encoding: 'utf8' })
  for (const line of String(out).split('\n')) if (line.trim()) console.log(line)
} catch (e) {
  const out = String(e?.stdout ?? '') + String(e?.stderr ?? '')
  fail('「产物报告」页布局不对（权重被覆盖 / 左右内距不一致 / 宽度或字号偏离 memj）',
    { message: out.trim() })
}

const pkg = JSON.parse(readFileSync('./package.json', 'utf8'))
let loaded = null
const prevWindow = globalThis.window
globalThis.window = { __ModuleLoader__: { load: (spec) => { loaded = spec } } }
try {
  await import(`./client.js?selfcheck=${Date.now()}`)
} catch (e) {
  globalThis.window = prevWindow
  fail('client.js 一 import 就抛错（浏览器里会是一片空白）', e)
}
globalThis.window = prevWindow

if (!loaded) fail('client.js 没有调用 window.__ModuleLoader__.load({...}) —— 那它不会被挂上')
if (loaded.id !== pkg.name) fail(`client.js 的 id（${loaded.id}）必须等于 package.json 的 name（${pkg.name}）`)
if (typeof loaded.factory !== 'function') fail('client.js 的 load({...}) 里没有 factory 函数')

const fakeReact = {
  createElement: (...a) => ({ tag: a[0], props: a[1] }),
  useState: (v) => [v, () => {}],
  useEffect: () => {},
  Fragment: 'Fragment',
}
let clientMod
try {
  clientMod = loaded.factory((name) => {
    if (name === 'react') return fakeReact
    throw new Error(`client.js require 了没预料到的包：${name}`)
  })
} catch (e) {
  fail('client.js 的 factory(require) 抛错', e)
}
if (typeof clientMod?.apply !== 'function') fail('client.js 的 factory 必须返回带 apply() 的对象')

// 真调一次 apply（假 DOM + 假 slots），把拼错的名字、漏掉的 ctx 方法都逼出来
const slotsReg = []
const styleNodes = []
const prevDoc = globalThis.document
globalThis.document = {
  createElement: () => ({ setAttribute() {}, remove() {}, textContent: '' }),
  head: { appendChild: (n) => styleNodes.push(n) },
}
try {
  clientMod.apply({
    effect: (fn) => { try { return fn() } catch { return undefined } },
    slots: {
      inject: (name, fn) => { fn() },
      register: (opts, Component) => { slotsReg.push({ ...opts, hasComponent: typeof Component === 'function' }); return {} },
    },
  })
} catch (e) {
  globalThis.document = prevDoc
  fail('client.js 的 apply(ctx) 抛错', e)
}
globalThis.document = prevDoc

if (!slotsReg.length) fail('client.js 的 apply 没有往任何 slot 注册组件')
if (!styleNodes.length) fail('client.js 的 apply 没有把样式挂上（页面会没样子）')
console.log(`✓ client 半端 OK：id=${loaded.id}  注入=${JSON.stringify(clientMod.inject)}`)
for (const s of slotsReg) console.log(`    slot ${s.name}  id=${s.id}  order=${s.order}  组件=${s.hasComponent ? '有' : '无 ✗'}`)

/* ────────────── ③ README 引用的图必须在包里（2026-10-17 加）────────────── */

// 🔴 为什么也要在这儿查一遍（不只是 CI 里）：
//    README 的相对路径图**本地看、GitHub 看都是绿的**，只有 **npm 页面**会裂 ——
//    而那个用户不会来告诉你 ⇒ **越早在本地拦住越好**。
//    ⚠️ 它要真跑一次 `npm pack --dry-run`（几百毫秒），所以放在最后、且失败也只告警不拦：
//       本地可能还没登录 npm / 没网络 —— 那种情况下不该让预检整个挂掉。
//       （CI 里那条是**硬失败**，见 .github/workflows/publish.yml）
try {
  const { execFileSync } = await import('node:child_process')
  const out = execFileSync(process.execPath, ['tools/check-readme-images.mjs'], { stdio: 'pipe', encoding: 'utf8' })
  for (const line of String(out).split('\n')) if (line.trim()) console.log(line)
} catch (e) {
  const out = String(e?.stdout ?? '') + String(e?.stderr ?? '')
  console.log('⚠️ README 图片检查没过（CI 里会硬失败）:')
  for (const line of out.split('\n')) if (line.trim()) console.log('    ' + line)
  process.exitCode = 1
}

try { rmSync(SANDBOX_HOME, { recursive: true, force: true }) } catch { /* 留着也无所谓 */ }
console.log(`\n（预检不碰真家目录：host 用 ${SANDBOX_HOME}）`)
