/**
 * 本地测升级的启动器（用完可删）—— 起一个**加载本地代码**、且 registry 指向假源的实例。
 *
 * 用法：node tools/test-upgrade-env.mjs [web|desktop] [port]
 *   · web（默认）⇒ 用 CLI 的 dsh + 隔离 home，完整复刻 Web 端
 *   · desktop     ⇒ 起不了（桌面版是 GUI 应用），只打印该怎么手动做
 *
 * ⭐ 为什么能"测升级而不发版"：
 *   ① 实例加载的是**本地仓库**（不是 npm 包）⇒ 跑的是**你改到一半的新代码**；
 *      做法：把 profile 里的依赖写成 `link:<本地仓库>`。
 *   ② registry 用环境变量指到假源 ⇒ `/update` 会看到"0.1.99 可用"。
 *   ③ 升级时 pnpm 从假源装 —— tarball 是真的 0.1.8 包，**装配链路完全真实**。
 *   ④ 装完之后，profile 里的依赖会从 link 变成 "0.1.99"（正好验证"真的换掉了"）。
 */
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync, existsSync, readFileSync, rmSync, openSync, closeSync } from 'node:fs'
import { join } from 'node:path'

const REPO = 'D:\\dsh-standalone-0.1.5-rc.2\\workplaces\\2026-09-30_08-46-30-402\\ccaa-2026-10\\dsh-bili-scroll'
const DEPLOY = 'D:\\dsh-standalone-0.1.5-rc.2\\workplaces\\2026-09-28_20-21-31-362\\deploy-020rc2'
const NODE = 'C:\\Users\\jojoman\\.workbuddy\\binaries\\node\\versions\\22.22.2\\node.exe'
const BIN = join(DEPLOY, 'npm-global', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
const REGISTRY = 'http://127.0.0.1:4873'

const mode = (process.argv[2] || 'web').toLowerCase()
const PORT = Number(process.argv[3] || 3107)

if (mode === 'desktop') {
  console.log('桌面版没法用脚本起（它是 GUI 应用）。手动做：')
  console.log('  1. 把本地仓库 link 进桌面版 profile：')
  console.log(`     dsh plugin --profile desktop add "link:${REPO}"`)
  console.log('     （桌面版要么用应用内「安装第三方插件」，要么用 runtime\\cli\\bin\\dsh.cmd 且先退出应用）')
  console.log('  2. 设环境变量后启动桌面版（在启动它的那个环境里）：')
  console.log(`     BILI_DUTY_NPM_REGISTRY=${REGISTRY}`)
  console.log(`     BILI_DUTY_NPM_REGISTRY_2=${REGISTRY}`)
  console.log('  3. 面板里点「一键升级」，看它是不是真的换了版本')
  process.exit(0)
}

const HOME = join(DEPLOY, 'testhome-upgrade')
const PROF = join(HOME, 'profiles', 'web')

// 已存在就复用（别每次都重建，省时间）；加 --fresh 可强制重建
const fresh = process.argv.includes('--fresh')
if (fresh || !existsSync(join(PROF, 'package.json'))) {
  rmSync(HOME, { recursive: true, force: true })
  for (const d of ['attachments', 'cache', 'logs', 'sessions', 'storages']) mkdirSync(join(HOME, d), { recursive: true })
  mkdirSync(PROF, { recursive: true })
  writeFileSync(join(PROF, 'package.json'), JSON.stringify({
    name: 'dsh-profile-web',
    private: true,
    dependencies: { '@jojoman2024/dsh-bili-scroll': `link:${REPO}` },  // ⭐ 跑本地代码
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', '@jojoman2024/dsh-bili-scroll'] } },
  }, null, 2) + '\n', 'utf8')
  writeFileSync(join(PROF, 'cordis.patch.yml'), '# 升级测试用\n[]\n', 'utf8')
  writeFileSync(join(PROF, 'pnpm-workspace.yaml'), 'packages:\n  - .\n\nonlyBuiltDependencies: []\n', 'utf8')
  for (const f of ['.credentials.yaml', '.anonymous-user-id']) {
    const s = join(DEPLOY, 'home', f)
    if (existsSync(s)) writeFileSync(join(HOME, f), readFileSync(s))
  }
  console.log(`已建隔离 home：${HOME}`)
} else {
  console.log(`复用隔离 home：${HOME}`)
}

const pj = JSON.parse(readFileSync(join(PROF, 'package.json'), 'utf8'))
console.log(`当前依赖声明：${JSON.stringify(pj.dependencies)}`)

/**
 * 🔴🔴 **光写 package.json 不够，必须真跑一次 pnpm 安装**（2026-10-19 踩到）。
 *
 * 我第一版只把依赖写进 `package.json` 就起实例 ⇒ **`node_modules` 根本不存在**
 * ⇒ 插件压根没加载 ⇒ 面板里什么都没有（使用者："你给我开的这个浏览器就没有装插件"）。
 *
 * ⇒ 建/重建 home 之后，用**官方 CLI** 真正装一次（它同时管好 dependencies /
 *   bundles / node_modules 三处接线）。已装过（node_modules 存在）就跳过。
 */
const nmDir = join(PROF, 'node_modules', '@jojoman2024', 'dsh-bili-scroll')
if (!existsSync(nmDir)) {
  console.log('\n首次安装插件（官方 CLI，会建 node_modules）…')
  const { execFileSync } = await import('node:child_process')
  try {
    const out = execFileSync(NODE, [BIN, 'plugin', '--profile', 'web', 'add', `link:${REPO}`], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 600000,
      env: { ...process.env, DSH_HOME: HOME },
    })
    console.log(out.split('\n').slice(-6).join('\n'))
  } catch (e) {
    console.log('安装失败：' + String(e.stderr || e.message).slice(0, 600))
    process.exit(1)
  }
} else {
  console.log('插件已装（node_modules 存在）')
}

const log = join(HOME, `run-${PORT}.log`)
const err = join(HOME, `run-${PORT}.err`)
for (const f of [log, err]) { try { rmSync(f, { force: true }) } catch { /* ignore */ } }
const outFd = openSync(log, 'w')
const errFd = openSync(err, 'w')

const child = spawn(NODE, [BIN, 'web', '--port', String(PORT), '--no-open'], {
  env: {
    ...process.env,
    DSH_HOME: HOME,
    // ⭐ 关键：两个源都指到假 registry
    BILI_DUTY_NPM_REGISTRY: REGISTRY,
    BILI_DUTY_NPM_REGISTRY_2: REGISTRY,
  },
  stdio: ['ignore', outFd, errFd],
  detached: true,
  windowsHide: true,
})
child.unref()
closeSync(outFd)
closeSync(errFd)
console.log(`已启动 pid=${child.pid}，端口 ${PORT}`)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let url = ''
for (let i = 0; i < 120; i++) {
  await sleep(500)
  if (!existsSync(log)) continue
  const m = /https?:\/\/[^\s"']+/.exec(readFileSync(log, 'utf8'))
  if (m) { url = m[0]; break }
}
console.log(url ? `\n打开面板：${url}` : '\n（没等到 URL，看 err 日志）')
if (!url) console.log(readFileSync(err, 'utf8').slice(-1200))
