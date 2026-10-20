/**
 * 造一个**真正的**假版本包（测试升级用）。
 *
 * ── 它解决什么 ──────────────────────────────────────────────
 *   测「升级」必须有个"新版本"可装，而发一次真版要十几分钟。
 *   ⇒ 这个脚本造一个版本号更高的包，让 `fake-registry.mjs` 谎报成"新版"。
 *
 * ── 🔴 两个必须遵守的硬约束 ────────────────────────────────
 *
 *   ① **包内 version 必须和元数据一致**，否则 pnpm 报
 *      `ERR_PNPM_UNEXPECTED_PKG_CONTENT_IN_STORE`（它真的会打开包校验）。
 *      ⇒ 所以是"解包 → 改 version → 重打"，而不是只改元数据。
 *
 *   ② 🔴🔴 **内容必须来自【当前工作区】**，不能拿一个老的 tgz 改版本号。
 *      真机踩过两次，两次都表现成"功能没生效"，害我以为是代码 bug：
 *        · 第一次：包是 0.1.8 的老代码 ⇒ 升级=降级，新加的浮窗直接没了；
 *        · 第二次：包是**改绿标之前**打的 ⇒ 升级完顶部不出现「请重启 DSH」。
 *      ⇒ 现在默认 `npm pack` 当前目录，永远不会是旧代码。
 *
 * ── 用法 ────────────────────────────────────────────────────
 *   node tools/make-fake-pkg.mjs [假版本=0.1.99]
 *   node tools/make-fake-pkg.mjs 0.1.99 --from-tgz=0.1.8   # 老行为（不推荐）
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = dirname(dirname(fileURLToPath(import.meta.url)))
const CACHE = join(REPO, '.test-registry')
const NAME = 'dsh-bili-scroll'

const args = process.argv.slice(2)
const FAKE_VER = (args.find((a) => /^\d+\.\d+\.\d+/.test(a)) || '0.1.99').trim()
const fromTgzArg = (args.find((a) => a.startsWith('--from-tgz=')) || '').split('=')[1]

const work = join(CACHE, 'build')
const outTgz = join(CACHE, `${NAME}-${FAKE_VER}.tgz`)
rmSync(work, { recursive: true, force: true })
mkdirSync(work, { recursive: true })

/** ① 拿到内容：默认打当前工作区 */
let srcTgz
if (fromTgzArg) {
  srcTgz = join(CACHE, `${NAME}-${fromTgzArg}.tgz`)
  if (!existsSync(srcTgz)) { console.log(`缺基版包：${srcTgz}`); process.exit(1) }
  console.log(`① 用旧的 tgz 当内容：${fromTgzArg}（⚠️ 里面是旧代码，只在特殊场合用）`)
} else {
  console.log('① 打包**当前工作区**（保证内容和现在改的一致）…')
  const packed = execFileSync('npm', ['pack', '--pack-destination', work], {
    cwd: REPO, encoding: 'utf8', shell: true, timeout: 180000,
    env: {
      ...process.env,
      npm_config_update_notifier: 'false',
      npm_config_offline: 'true',      // 不联网（否则可能挂住）
      npm_config_audit: 'false',
      npm_config_fund: 'false',
    },
  })
  srcTgz = join(work, packed.trim().split(/\r?\n/).pop().trim())
}
console.log(`   → ${srcTgz.split(/[\\/]/).pop()}`)

/** ② 解包并改版本号 */
console.log('② 解包并改版本号 …')
const ex = join(work, 'ex')
mkdirSync(ex, { recursive: true })
execFileSync('tar', ['-xzf', srcTgz, '-C', ex], { stdio: 'pipe' })
const pjPath = join(ex, 'package', 'package.json')
if (!existsSync(pjPath)) { console.log(`🔴 解包后没有 package.json（包结构不对）`); process.exit(1) }
const pj = JSON.parse(readFileSync(pjPath, 'utf8'))
console.log(`   原版本 ${pj.version} → ${FAKE_VER}`)
pj.version = FAKE_VER
writeFileSync(pjPath, JSON.stringify(pj, null, 2) + '\n', 'utf8')

/** ③ 重新打包 */
console.log('③ 重新打包 …')
rmSync(outTgz, { force: true })
execFileSync('tar', ['-czf', outTgz, '-C', ex, 'package'], { stdio: 'pipe' })

/** ④ 自证：版本对、且**内容确实是当前代码** */
const chk = join(work, 'chk')
mkdirSync(chk, { recursive: true })
execFileSync('tar', ['-xzf', outTgz, '-C', chk, 'package/package.json', 'package/client.js', 'package/index.js'], { stdio: 'pipe' })
const v = JSON.parse(readFileSync(join(chk, 'package', 'package.json'), 'utf8')).version
const curCli = readFileSync(join(REPO, 'client.js'), 'utf8')
const pkgCli = readFileSync(join(chk, 'package', 'client.js'), 'utf8')
const curIdx = readFileSync(join(REPO, 'index.js'), 'utf8')
const pkgIdx = readFileSync(join(chk, 'package', 'index.js'), 'utf8')

console.log(`\n✓ 产出 ${outTgz}`)
console.log(`   包内版本 = ${v} ${v === FAKE_VER ? '✓' : '🔴 不对'}`)
console.log(`   client.js 与工作区一致 = ${pkgCli === curCli ? '✓' : '🔴 不一致（说明用的是旧代码！）'}`)
console.log(`   index.js  与工作区一致 = ${pkgIdx === curIdx ? '✓' : '🔴 不一致'}`)

rmSync(work, { recursive: true, force: true })
if (v !== FAKE_VER || pkgCli !== curCli || pkgIdx !== curIdx) {
  console.log('\n🔴 自证没过 —— **不要让 registry 用这个包**，先查为什么内容不对。')
  process.exit(1)
}
