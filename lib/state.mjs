/**
 * lib/state.mjs —— 插件的"家"与配置
 * ============================================================================
 * 规矩（抄 whale_craft）：**配置、凭证、报告、日志都放插件自己的家** ——
 * `$DSH_HOME/bili-duty/`，**绝不写进插件包目录**（装进 node_modules 后可能只读、升级也会被覆盖）。
 *
 * 还有一件小事但很要紧：vendored 的 `mcp_server.py` 里，凭证路径是
 * `Path(__file__).parent / "bili_credential.json"` —— 所以**运行时要把脚本拷到家目录里再跑**，
 * 这样凭证才会落在家的目录，而不是插件包里。
 * ============================================================================
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, openSync, closeSync, statSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

/**
 * 谷时窗口（北京时间）—— 想改就改这一处。
 * ⭐ 官方口径（2026-09-10 起的新定价）：**高峰 = 工作日 9:00–12:00 与 14:00–18:00，其余全是谷时**
 *    ⇒ 12:00–14:00（夹在两个高峰之间）✓、18:00 之后的一整晚 ✓、以及**整个周末** ✓ 都便宜。
 * ⚠️ 我们原来写的 00:30–08:30 是 DeepSeek **早年**的错峰优惠时段，**已经过时** ✗
 *    —— 2026-10-14 使用者在"陌生人验收"里问「晚上峰谷真的是12点半才开始的吗」才查出来 ✓。
 */
export const WINDOWS = {
  noon: { label: '中午谷时', start: '12:00', end: '14:00' },
  night: { label: '晚上/夜间谷时', start: '18:00', end: '09:00' },
}

/**
 * ⭐ 2026-10-14 真机上踩到的坑（dsh 只留一句 `warning: 1 entry did not activate` + 堆栈）：
 *    `ctx.get('dshHomePath')` 返回的是**函数**，不是字符串！
 *    形状：`dshHomePath(...segments) => join(resolveDshHome(), ...segments)`（whale_craft 就是这么用的）。
 *    我一开始当字符串用（`String(p)`），路径就成了「函数源码 + \bili-duty」⇒ mkdir ENOENT ⇒ apply 抛错 ⇒ 插件不激活。
 */
export function stateDirOf(ctx) {
  let dir = ''
  try {
    const p = ctx?.get?.('dshHomePath')
    if (typeof p === 'function') {
      const v = p('bili-duty')                       // ← 函数形态：把目录名传进去
      if (v) dir = String(v)
    } else if (typeof p === 'string' && p) {
      dir = join(p, 'bili-duty')
    }
  } catch { /* 拿不到就用下面的兜底 */ }
  if (!dir) dir = join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'bili-duty')
  mkdirSync(dir, { recursive: true })
  return dir
}

export function readJson(file, fallback) {
  try { return JSON.parse(readFileSync(file, 'utf8')) } catch { return fallback }
}

export function writeJson(file, value) {
  writeFileSync(file, JSON.stringify(value, null, 2), 'utf8')
}

/**
 * 把 vendored 的 MCP 脚本 / 值班章程 / 转写脚本拷进家里。
 *
 * 🔴 **章程（`duty.md`）也改成"内容不同就覆盖"**（2026-10-16 改，原来是 `false`）。
 *    原来写的是"章程不覆盖用户改过的"，听着合理，实际造成一个真 bug：
 *      · 章程只能从**仓库**改（面板里没有编辑章程的入口，那是人设不是章程）；
 *      · 但家里那份**永不被更新**（`overwrite: false`）⇒ 升级后家里还是旧章程；
 *      · 而 `promptFor` 当时又按 mtime 挑 → 挑到包目录那份（新的）
 *        ⇒ 而 `bili_read` 的白名单没有包目录 ⇒ **读章程那一步被当场拒掉**，
 *          实测它只好自己猜路径、白跑两轮才读到。
 *    ⇒ 现在两条一起改：**家里永远是最新的**（这里覆盖），
 *      `promptFor` **固定给家目录路径**（不再按 mtime 挑）。
 *
 * ⚠️ 判断依据是**内容**（不是 mtime）：一样就跳过，避免每次启动都白写一遍。
 *    这也顺手保留了"使用者若真改了家里那份、内容就与出厂不同 ⇒ 会被覆盖回去"的语义 ——
 *    对一个**只从仓库维护**的章程来说这是对的；真要在本机改章程，改仓库那份。
 *
 * ⭐ **两类文件、两种待遇**（2026-10-16 加了 `reply.md` 之后，这个函数同时管两种）：
 *   · **只从仓库维护的**（`mcp_server.py` / `duty.md` / `asr.py`）⇒ `overwrite: true`：
 *     家里永远与出厂一致；使用者改了会被覆盖回去。
 *   · **使用者可编辑的**（`reply.md`）⇒ `overwrite: false`：**只在缺文件时铺一次**，
 *     之后**永不覆盖**（与 `persona.md` 同样待遇）。
 *     ⚠️ 代价：出厂源升级后，使用者那份**不会自动更新** ⇒
 *        靠面板的「恢复默认」按钮（它会从出厂源重新读一份写回去）。
 */
export function ensureHomeFiles(pluginDir, stateDir, log = () => {}) {
  const copies = [
    [join(pluginDir, 'vendor', 'bilibili-mcp', 'mcp_server.py'), join(stateDir, 'mcp_server.py'), true],
    [join(pluginDir, 'prompts', 'duty.md'), join(stateDir, 'duty.md'), true],
    [join(pluginDir, 'lib', 'asr.py'), join(stateDir, 'asr.py'), true],
    // ⭐ **回复细则**（2026-10-16 加）：`overwrite: false` ⇒ **只在缺文件时铺一次**，
    //    之后**永不覆盖** —— 因为它**使用者可以在面板里改**（与人设同样待遇）。
    //    ⚠️ 与上面三条的区别就在这个布尔值，别改成 true：
    //       那样每次重启都会把使用者改过的内容冲掉。
    //    ⇒ 出厂源改了（升级插件）而使用者那份还是旧的时，靠面板的「恢复默认」按钮同步。
    [join(pluginDir, 'prompts', 'reply.md'), join(stateDir, 'reply.md'), false],
  ]
  for (const [from, to, overwrite] of copies) {
    try {
      if (!existsSync(from)) { log(`缺文件：${from}`); continue }
      if (!overwrite && existsSync(to)) continue
      if (overwrite && existsSync(to) && readFileSync(from, 'utf8') === readFileSync(to, 'utf8')) continue
      copyFileSync(from, to)
      log(`已铺好：${to}`)
    } catch (e) { log(`铺 ${to} 失败：${e?.message ?? e}`) }
  }
}

/** 'HH:MM' → 当天的分钟数 */
function minutesOf(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm).trim())
  if (!m) return null
  return Number(m[1]) * 60 + Number(m[2])
}

/** 现在在不在这个窗口里（支持跨零点，比如 23:00–02:00） */
export function inWindow(now, win) {
  const start = minutesOf(win.start); const end = minutesOf(win.end)
  if (start === null || end === null) return false
  const cur = now.getHours() * 60 + now.getMinutes()
  return start <= end ? (cur >= start && cur < end) : (cur >= start || cur < end)
}

/** 本地日期 YYYY-MM-DD */
export function dayKey(now = new Date()) {
  const p = (n) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`
}

/** 这个"窗口实例"的编号：跨零点的窗口算在前一天头上（一次窗口只跑一轮） */
export function windowKey(now, name) {
  return `${dayKey(now)}:${name}`
}

/* ══════════════════════════════════════════════════════════════════════════
 * 跨进程互斥（2026-10-18 加）
 *
 * 🔴 **为什么需要它**：`seen.md` / `accounts.md` / `replies.json` 这三个
 *    "账本"都是**读-改-写**（readFileSync 读整份 → 拼一行 → writeFileSync 整份重写）。
 *    同一时刻两个**进程**各读到同一份旧内容、各追加自己那行，后写的会**覆盖**先写的
 *    ⇒ 丢数据。实测（两个 worker 各写 50 行）：**只有 52 行活下来，丢了 48 行**。
 *
 * ⚠️ **什么时候会真的撞上**（这是判断"要不要加锁"的关键）：
 *    · 同进程内多个工具调用并发 ⇒ **不会**（Node 单线程 + 同步 IO 天然串行，实测 30/30 不丢）；
 *    · **前台跑一轮 + 后台定时器那一轮**同时进行 ⇒ **会**（两个进程）；
 *    · 两个 dsh 实例共用同一个 `$DSH_HOME` 且都在跑 ⇒ **会**；
 *    · 两个实例各自不同的 `$DSH_HOME` ⇒ **不会**（路径都不一样，互不干扰）。
 *    ⇒ 所以锁保护的是"**同一份文件被两个进程写**"，不是"同一进程内的并发"。
 *
 * ── 怎么保证原子 ──────────────────────────────────────────
 *   `openSync(path, 'wx')` —— `wx` = **不存在才创建**，这一步由操作系统保证原子
 *   （POSIX 的 O_CREAT|O_EXCL、Windows 的 CREATE_NEW）。
 *   抢到锁就写，写完 `unlinkSync` 释放。
 *
 * ── 四个必须处理的边界（都是实测/推演出来的，别删）──────────
 *   ① **陈旧锁**：进程被强杀会留下 `.lock` 文件 ⇒ 永远抢不到。
 *      做法：锁文件 mtime 超过 `staleMs`（默认 10 秒）就当它死了，强删。
 *      ⚠️ 这个兜底意味着"**锁最多被误判为陈旧一次**" —— 正常写盘只要几毫秒，
 *         10 秒阈值远大于它，不会误伤。
 *   ② **必须 try/finally 释放**：写盘抛错时不释放就是死锁。
 *   ③ **等待要加随机抖动**：两个进程同步重试会一直撞（惊群）。实测加抖动比不加快得多。
 *   ④ **必须 fail-open**：抢不到锁（超时 / 权限错）就**照样执行**。
 *      理由与整个项目一致：**账本记不上 ≠ 不该跑**。
 *      宁可偶尔丢一条记录，也不能让刷B站卡死在锁上。
 *
 * ── 代价（诚实说）──────────────────────────────────────────
 *   · 每次写多 **1 次 open + 1 次 unlink**（微秒级；正常无竞争时不用等待）。
 *   · 并发时才排队，最多等 `maxWaitMs`（默认 3 秒）然后放行。
 * ══════════════════════════════════════════════════════════════════════════ */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * 拿到锁再执行 `fn`；无论如何都会释放。
 *
 * @template T
 * @param {string} file          要保护的文件（锁文件是 `file + '.lock'`）
 * @param {() => T | Promise<T>} fn  读-改-写都在里面
 * @param {{maxWaitMs?: number, staleMs?: number}} [opt]
 * @returns {Promise<T>}
 */
export async function withFileLock(file, fn, { maxWaitMs = 3000, staleMs = 10000 } = {}) {
  const lock = String(file) + '.lock'
  const t0 = Date.now()
  let locked = false

  for (;;) {
    try {
      closeSync(openSync(lock, 'wx'))   // ⭐ 原子抢锁（不存在才创建）
      locked = true
      break
    } catch (e) {
      // ⚠️ 不是"已存在"（权限 / 磁盘满…）⇒ 别拦着，直接干（fail-open）
      if (e?.code !== 'EEXIST') break
      // ① 陈旧锁兜底（见上面注释）
      try {
        if (Date.now() - statSync(lock).mtimeMs > staleMs) {
          unlinkSync(lock)
          continue                        // 删掉后立刻重试抢
        }
      } catch { /* 锁刚好被对方释放了（ENOENT）⇒ 继续重试即可 */ }
      // 超时 ⇒ fail-open
      if (Date.now() - t0 > maxWaitMs) break
      // ③ 随机抖动，避免两个进程同步重试
      await sleep(2 + Math.random() * 3)
    }
  }

  try {
    return await fn()
  } finally {
    // ② 必须释放（没抢到锁时 `locked` 为 false，不能删别人的锁）
    if (locked) { try { unlinkSync(lock) } catch { /* 已经没了 */ } }
  }
}
