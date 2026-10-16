/**
 * lib/hostdeps.mjs —— 从宿主那棵树里取 `@deepseek-ai/*`（拿不到就退到"自己的依赖"）
 * ============================================================================
 * 🔴 为什么要有它（来自上游 0.1.4 的修复，一位用户递来的完整报告）：
 *   `index.js` 顶部裸 import 这些包，而它们在 package.json 里是 **optional peer**
 *   ⇒ 桌面版 profile（`autoInstallPeers: false`）**永远不装它们**
 *   ⇒ 插件整条不激活，DSH 只留一句
 *     `warning: 1 entry did not activate … failed to import` ✓
 *   （web profile 上之所以一直没事，是因为 profile 树里恰好有别的插件把它们
 *     hoist 上来了 —— **那是运气** ✗）
 *   ⚠️ `dsh-tools` 自己还有一堆 peer（本机数到 11 个）⇒ 光把它装上**也救不回来** ✗。
 *
 * ⭐ 策略（两条一起走）：
 *   ① **优先从宿主那棵树里解析**（跟宿主用同一份，行为最一致）；
 *   ② 解析不到就 **bare import**（靠我们自己 package.json 的 `dependencies` 装一份保底）；
 *   ③ 拿不到也**不让插件不激活**：
 *      · `schemastery` 拿不到 ⇒ 返回 null，**只是没有 Config、设置页降级** ✓
 *      · `dsh-tools` 拿不到 ⇒ 用**本地等价实现**顶上 ✓
 *      · `dsh-llm` 拿不到 ⇒ 也只有前台会话那一路用得到它，
 *        调用点会自己判断（见 `index.js` 里 createUserMessage 的用法）✓
 *
 * 🔴 **我们这一版比上游多一个包**（2026-10-16）：
 *   上游只处理 `schemastery` + `dsh-tools` —— 因为上游**根本不 import `dsh-llm`**。
 *   而我们的「前台跑」用了 `createUserMessage`（`@deepseek-ai/dsh-llm`）来造那条开场消息，
 *   那个包在**我们自己的 node_modules 里是没有的**（本机核实过）
 *   ⇒ 不一起兜住的话，**我们比上游还多炸一个**。
 * ============================================================================
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'

/** 插件自己那棵树（`dependencies` 装出来的那份）—— 用模块位置算，别依赖 cwd */
const SELF_MODULES = join(dirname(fileURLToPath(import.meta.url)), '..', 'node_modules', '@deepseek-ai')

/** 可能藏着宿主 `@deepseek-ai` 包的地方（不写死某一台机器，按可能性排序） */
export function candidateRoots() {
  const out = []
  const push = (p) => { if (p && !out.includes(p)) out.push(p) }
  push(process.env.DSH_HOST_MODULES)

  const appdata = process.env.APPDATA
  if (appdata) {
    const npm = join(appdata, 'npm', 'node_modules')
    push(join(npm, '@deepseek-ai', 'dsh', 'node_modules', '@deepseek-ai'))
    push(join(npm, '@deepseek-ai'))
    // 桌面版可能叫别的包名（dsh-desktop / dsh-next…）⇒ 逐个看它们的 node_modules
    try {
      for (const n of readdirSync(join(npm, '@deepseek-ai'))) {
        push(join(npm, '@deepseek-ai', n, 'node_modules', '@deepseek-ai'))
      }
    } catch { /* 没有就算了 */ }
  }
  push('/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai')
  push('/usr/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai')
  push('/usr/local/lib/node_modules/@deepseek-ai')
  push('/usr/lib/node_modules/@deepseek-ai')

  // profile 树：有些机器上这些包是被别的插件 hoist 到 profile 根上的
  try {
    const dshHome = process.env.DSH_HOME || join(homedir(), '.dsh')
    for (const p of readdirSync(join(dshHome, 'profiles'))) {
      push(join(dshHome, 'profiles', p, 'node_modules', '@deepseek-ai'))
    }
  } catch { /* 没有就算了 */ }

  // 插件自己那份（package.json 的 dependencies 装出来的）—— 放最后，前面优先"跟宿主同一份"
  push(SELF_MODULES)
  return out
}

/** 按包的 exports['.'] 找入口文件，返回 file:// URL */
function entryUrlFor(root, name) {
  try {
    const dir = join(root, name)
    const pkgFile = join(dir, 'package.json')
    if (!existsSync(pkgFile)) return null
    const pkg = JSON.parse(readFileSync(pkgFile, 'utf8'))
    const dot = pkg.exports?.['.']
    const rel = typeof dot === 'string'
      ? dot
      : (dot?.import || dot?.default || pkg.module || pkg.main)
    if (!rel) return null
    const file = join(dir, String(rel).replace(/^\.\//, ''))
    return existsSync(file) ? pathToFileURL(file).href : null
  } catch { return null }
}

/** 试从宿主树里 import 一个包；拿不到返回 null（失败原因写进 notes，方便远程排查） */
async function fromHostTree(name, log) {
  const fails = []
  for (const root of candidateRoots()) {
    if (root === SELF_MODULES) continue          // 自己那份交给下面的 bare import 处理
    const url = entryUrlFor(root, name)
    if (!url) continue
    try {
      const mod = await import(url)
      log(`${name}：从宿主树取到（${url.replace(/^file:\/\/\//, '')}）`)
      return mod
    } catch (e) { fails.push(`${e?.code || 'ERR'}:${root}`) }
  }
  if (fails.length) log(`${name}：宿主树里都不行（${fails.slice(0, 3).join(' ')}）`)
  return null
}

/**
 * 取一个包：先宿主树、再 bare import。拿不到返回 null（**不抛**）。
 * @param {string} name 包名（如 'dsh-tools'）
 * @param {string[]} notes 日志收集
 */
async function loadPkg(name, notes) {
  const log = (m) => notes.push(m)
  const full = '@deepseek-ai/' + name
  const fromHost = await fromHostTree(name, log)
  if (fromHost) return fromHost
  try {
    const mod = await import(full)
    log(`${name}：宿主树里没有，用自己依赖里那份`)
    return mod
  } catch (e) {
    log(`${name}：拿不到（${e?.code || ''} ${String(e?.message || '').slice(0, 100)}）`)
    return null
  }
}

/** 兜底：这是**我们自己的等价实现**，只在拿不到宿主的 dsh-tools 时用 */
function localDefineTool(options, log) {
  // 宿主的 defineTool 会做 spec→JSONSchema 转换 + 参数校验；我们的 parameters / output.schema
  // **本来就是标准 JSON Schema**（2026-10-14 那次 additionalProperties 报错就是被它校验出来的），
  // 所以这里只补一条同样的校验，别的原样返回。
  const check = (schema, where) => {
    if (!schema || typeof schema !== 'object') return
    if (schema.type === 'object' && schema.additionalProperties === undefined) {
      throw new Error(`defineTool(${options.name}): ${where} 是 object 却没写 additionalProperties`)
    }
    for (const [k, v] of Object.entries(schema.properties || {})) check(v, `${where}.properties.${k}`)
  }
  check(options.parameters, 'parameters')
  check(options.output?.schema, 'output.schema')
  log?.(`dsh-tools 拿不到 —— 用本地等价实现顶上了（工具 ${options.name}）`)
  return options
}

/**
 * 取回宿主半端要用的一点点东西。
 *
 * @returns {Promise<{
 *   z:any,                       // schemastery（拿不到是 null ⇒ Config 为 undefined，设置页降级）
 *   defineTool:Function,         // 永远有值（拿不到宿主那份就用本地等价实现）
 *   createUserMessage:Function|null,  // 前台会话那一路用；拿不到是 null（调用点自己判）
 *   notes:string[]
 * }>}
 */
export async function loadHostDeps() {
  const notes = []
  const log = (m) => notes.push(m)

  // ① schemastery（Config 要用；宿主设置层要用**它自己那份**读 volatile 字段）
  const zMod = await loadPkg('schemastery', notes)
  const z = zMod?.default ?? zMod ?? null
  if (!z) log('⚠️ schemastery 彻底拿不到 —— 这一份插件没有 Config，设置页会降级（插件本体照常跑）✓')

  // ② dsh-tools 的 defineTool（拿不到就用本地等价实现 —— 上游桌面版修复的关键一步）
  const dtMod = await loadPkg('dsh-tools', notes)
  const defineTool = dtMod?.defineTool || ((options) => localDefineTool(options, log))

  // ③ dsh-llm 的 createUserMessage（⭐ 我们比上游多的那一处 —— 前台会话造开场消息要用）
  const llmMod = await loadPkg('dsh-llm', notes)
  const createUserMessage = llmMod?.createUserMessage || null
  if (!createUserMessage) log('⚠️ dsh-llm 拿不到 —— 前台会话那一路不可用（后台跑不受影响）✓')

  return { z, defineTool, createUserMessage, notes }
}
