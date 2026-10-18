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
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, cpSync, openSync, closeSync, statSync, unlinkSync } from 'node:fs'
import { join, dirname } from 'node:path'
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
 * ⭐ **家目录名**（2026-10-18 从 `bili-duty` 改成 `bili-scroll-jojo`）。
 *
 * 🔴 **为什么必须改名**（实测出来的，不是担心）：
 *   上游 `c1overzz/dsh-bili-scroll`（v0.1.8）的 `stateDirOf` 与改名前我们这份
 *   **字节级相同** —— 都调 `p('bili-duty')`。⇒ 两个插件装在同一台机器上会
 *   **共用同一个家目录**，而两者的 `seen.md` 格式**完全不同**：
 *     · 上游：`## 评论记录` / `## 看过的视频` 两节 + **一行一个裸 BV**
 *     · 我们：单张五列表格 `| BV | 日期 | 怎么来的 | rpid | 备注 |`
 *   实测（轮流写同一份文件）：
 *     · 我们跑一轮 ⇒ **上游的记录被整份重写掉**（因为它写的裸 BV 行
 *       过不了我们的 `/^\|\s*BV...\s*\|/` 过滤 ⇒ 换目录 = 换名字，互不相干）
 *
 * ⚠️ 改名会**让老用户看起来"数据没了"** ⇒ 所以下面 `stateDirOf` 里有**自动迁移**
 *    （从旧目录复制，**不删旧的**）。
 */
const HOME_DIR_NAME = 'bili-scroll-jojo'
/** 改名前的目录名 —— 只用于**迁移时读旧的**，不要拿它当新路径 */
const LEGACY_DIR_NAME = 'bili-duty'

/**
 * ⭐ 2026-10-14 真机上踩到的坑（dsh 只留一句 `warning: 1 entry did not activate` + 堆栈）：
 *    `ctx.get('dshHomePath')` 返回的是**函数**，不是字符串！
 *    形状：`dshHomePath(...segments) => join(resolveDshHome(), ...segments)`（whale_craft 就是这么用的）。
 *    我一开始当字符串用（`String(p)`），路径就成了「函数源码 + \bili-duty」⇒ mkdir ENOENT ⇒ apply 抛错 ⇒ 插件不激活。
 */
export function stateDirOf(ctx) {
  /** 解出 `$DSH_HOME`（不含最后那级目录名），供三条分支与迁移共用 */
  let base = ''
  try {
    const p = ctx?.get?.('dshHomePath')
    if (typeof p === 'function') {
      // ⚠️ 先拿到 `.../<HOME_DIR_NAME>`，再去掉末级（迁移要的是父目录）
      const v = p(HOME_DIR_NAME)
      if (v) base = dirname(String(v))
    } else if (typeof p === 'string' && p) {
      base = String(p)
    }
  } catch { /* 拿不到就用下面的兜底 */ }
  if (!base) base = process.env.DSH_HOME || join(homedir(), '.dsh')

  const dir = join(base, HOME_DIR_NAME)
  mkdirSync(dir, { recursive: true })
  migrateFromLegacy(base, dir)
  return dir
}

/**
 * ⭐ **把旧家目录（`bili-duty`）里的用户数据搬到新家目录**（2026-10-18）。
 *
 * 规则（**保守优先，绝不毁数据**）：
 *   · 只**复制**，**绝不删除/移动**旧的（使用者确认过："q2 不删"）
 *   · **新目录里已存在的不覆盖** ⇒ 迁移只发生一次，之后新目录说了算
 *   · 触发条件：新目录**还没有 `seen.md`**（= 从没迁移过 / 也从没跑过）
 *     ⚠️ 用 `seen.md` 当哨兵而不是"目录是空的" ——
 *        因为 `ensureHomeFiles` 会在启动时先铺几个文件进去（mcp_server.py 等），
 *        那时目录已经"不空"了，但它不代表"迁移过"。
 *   · 只搬**用户数据**，不搬 `ensureHomeFiles` 管的那些（它们会自己铺最新的）
 *
 * ⚠️ 为什么复制而不是移动：万一新版有问题，旧目录还在，可以立刻回滚。
 */
function migrateFromLegacy(base, newDir) {
  try {
    const oldDir = join(base, LEGACY_DIR_NAME)
    if (oldDir === newDir) return                       // 名字没变过（理论上不会）
    if (!existsSync(oldDir)) return                     // 没有旧目录 ⇒ 全新用户
    if (existsSync(join(newDir, 'seen.md'))) return     // 已经迁移过 / 新目录已用过

    /**
     * 要搬的东西 = **用户数据**。
     * ⚠️ 不含 `mcp_server.py` / `duty.md` / `asr.py` / `reply.md` ——
     *    那四个由 `ensureHomeFiles` 负责，而且**应当用新版**（旧的会被覆盖，搬了也白搬）。
     */
    const FILES = [
      'seen.md', 'config.json', 'accounts.md', 'replies.json', 'round.json',
      'persona.md', 'bili_credential.json', 'state.json', 'duty.log', 'install.log',
    ]
    let n = 0
    for (const f of FILES) {
      const from = join(oldDir, f)
      const to = join(newDir, f)
      try {
        if (!existsSync(from) || existsSync(to)) continue
        copyFileSync(from, to)
        n++
      } catch { /* 单个文件失败不影响其它 */ }
    }
    // 产物目录整份复制（reports 是我们这版的；out 是上游/旧时代的，也带上以免丢东西）
    for (const sub of ['reports', 'out', 'front-sessions', 'tmp']) {
      const from = join(oldDir, sub)
      const to = join(newDir, sub)
      try {
        if (!existsSync(from) || existsSync(to)) continue
        cpSync(from, to, { recursive: true })
        n++
      } catch { /* ignore */ }
    }

    /**
     * ⭐⭐ **把 Python 运行环境也搬过去**（2026-10-18 补，使用者提问后加的）。
     *
     * ── 为什么可以搬（实测过，不是推测）─────────────────────
     *   把生产那份 `.venv` 复制到临时目录后：
     *     · `python.exe --version` 正常（3.12.4）
     *     · **`sys.prefix` 跟着新路径走** —— 说明它**没有**硬编码旧目录
     *     · `bilibili_api` / `mcp` / `aiohttp` / `qrcode` **四个都能 import**
     *     · 连 `search.SearchObjectType.VIDEO` 这种真实逻辑也能跑
     *   ⚠️ 唯一写死路径的是 `Scripts\activate.bat` 里的 `VIRTUAL_ENV` ——
     *     但**插件根本不走 activate**，它直接调 `Scripts\python.exe`
     *     （见 index.js 的 `venvPython()`）⇒ 不影响。
     *   ⏱ 复制 82MB 约 **10 秒**（一次性，可接受）。
     *
     * ── 不搬会怎样 ────────────────────────────────────────
     *   老用户升级后**显示"环境未装"**，必须自己再点「装主依赖」
     *   （还要重新下载几十 MB）⇒ 升级体验很差，而且容易以为"数据丢了"。
     *
     * ⚠️ 这是**大目录**（.venv 82MB + bin 30MB），所以：
     *   · 只在**迁移时**搬一次（有新目录 seen.md 当哨兵，见上面的 return）
     *   · 失败就跳过（外层有 try/catch），**绝不能让搬依赖把插件搞挂**
     *   · 并发/耗时都不影响启动正确性 —— 它只是把文件复制过去
     */
    /**
     * ⭐ 迁移**大目录之前**先喊一声（2026-10-18 加）。
     * ⚠️ 为什么要喊：带 `.venv` 的迁移实测要 **10.5 秒**，
     *    而这段是**同步**的（在 `stateDirOf` 里，apply 之前）⇒
     *    期间 dsh 启动会**看起来卡住**。不提前说一句，使用者会以为挂了。
     */
    const bigDirs = ['.venv', '.venv-asr', '.hf-cache', 'bin']
      .filter((d) => existsSync(join(oldDir, d)) && !existsSync(join(newDir, d)))
    if (bigDirs.length) {
      console.log(`[bili-scroll] 首次启动：正在从旧目录迁移数据与运行环境（${bigDirs.join(', ')}，约 100MB，可能需要 10 秒左右）…`)
    }

    for (const sub of bigDirs) {
      const from = join(oldDir, sub)
      const to = join(newDir, sub)
      try {
        cpSync(from, to, { recursive: true })
        n++
      } catch { /* 搬不动就算了 —— 使用者还能点「重装主依赖」 */ }
    }

    if (n > 0) {
      // ⚠️ 用 console 而不是 log 回调：这个函数在 stateDirOf 里，没有 log 可用
      console.log(`[bili-scroll] 已从旧目录迁移 ${n} 项（含运行环境）：${oldDir} -> ${newDir}（旧目录保留，确认没问题后可自行删除）`)
    }
  } catch { /* 迁移失败也不能拦住插件加载 —— 宁可数据留在旧目录，也不能不启动 */ }
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

  /* ⭐⭐ **把使用者那份 `reply.md` 里的旧工具名换成新的**（2026-10-18 加）。
   *
   * 🔴 为什么必须做（真实用户会遇到，不是假想）：
   *   `reply.md` 是 `overwrite: false` —— **永不覆盖**（因为使用者可以在面板里改它）。
   *   而 0.1.3 / 0.1.4 / 0.1.5 那几版的 `reply.md` 里写的是**旧工具名**：
   *     「插件已经把该给的筛好递给你了（`bili_replies` 的返回值）」
   *     「调 `bili_reply`，四个参数照抄 `bili_replies` 给的那条」
   *   ⇒ 那些是**模型照着执行的操作指令**。新版把工具改成了 `bilij_*`，
   *     老用户升级后模型**照旧名字调 ⇒ tool not found**，而且它多半会自己乱猜参数。
   *
   * ── 为什么是"改"而不是"覆盖" ──────────────────────────
   *   使用者改过这份文档（可能加了自己的回复风格要求）⇒ 覆盖会**冲掉他的东西**。
   *   ⇒ 只**替换工具名**，其余内容一字不动。
   *
   * ⚠️ 只替换**已知的旧工具名**，且用词边界（避免 `bili_reply` 匹配到 `bili_replies` 的中间）。
   * ⚠️ 幂等：已经是新名字的文件里一个都匹配不到 ⇒ 不动它（也不会每次都重写）。
   */
  try {
    const replyDst = join(stateDir, 'reply.md')
    if (existsSync(replyDst)) {
      const before = readFileSync(replyDst, 'utf8')
      let after = before
      // ⚠️ 长名优先（`bili_replies` 比 `bili_reply` 长 ⇒ 先换，否则会把长名拆坏）
      for (const old of ['bili_replies', 'bili_reply']) {
        const nu = old.replace(/^bili_/, 'bilij_')
        after = after.replace(new RegExp(`(?<![\\w])${old}(?![\\w])`, 'g'), nu)
      }
      if (after !== before) {
        writeFileSync(replyDst, after, 'utf8')
        log(`已把 reply.md 里的旧工具名换成新的（bili_* → bilij_*）；你自己的内容没动`)
      }
    }
  } catch (e) { log(`更新 reply.md 里的工具名失败（不影响其它）：${e?.message ?? e}`) }
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
