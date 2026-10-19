/**
 * 造一个**真正**的假版本包（测试升级用）—— 用完可删。
 *
 * 🔴 上一版踩的坑（pnpm 报 `ERR_PNPM_UNEXPECTED_PKG_CONTENT_IN_STORE`）：
 *   我让 metadata 声称 0.1.99、但 tarball 里其实是 0.1.8 的包
 *   ⇒ pnpm 会**校验包内 package.json 的 version 和元数据是否一致**
 *   ⇒ 名字/版本对不上直接拒绝安装。
 *
 * ✅ 正确做法：**解包 → 把 package.json 的 version 改成 0.1.99 → 重新打 tgz**
 *   ⇒ 包是真的、版本也是真的，pnpm 挑不出毛病。
 *
 * 用法：node tools/make-fake-pkg.mjs [基版本=0.1.8] [假版本=0.1.99]
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs'
import { join } from 'node:path'

const CACHE = 'D:\\dsh-standalone-0.1.5-rc.2\\workplaces\\2026-09-30_08-46-30-402\\ccaa-2026-10\\dsh-bili-scroll\\.test-registry'
const PKG = '@jojoman2024/dsh-bili-scroll'
const NAME = PKG.split('/').pop()
const BASE_VER = process.argv[2] || '0.1.8'
const FAKE_VER = process.argv[3] || '0.1.99'

const work = join(CACHE, 'build')
const baseTgz = join(CACHE, `${NAME}-${BASE_VER}.tgz`)
const outTgz = join(CACHE, `${NAME}-${FAKE_VER}.tgz`)

if (!existsSync(baseTgz)) {
  console.log(`缺基版包：${baseTgz}`)
  console.log('先跑一次 tools/fake-registry.mjs 让它下载。')
  process.exit(1)
}

rmSync(work, { recursive: true, force: true })
mkdirSync(work, { recursive: true })

console.log(`解包 ${BASE_VER} …`)
execFileSync('tar', ['-xzf', baseTgz, '-C', work], { stdio: 'inherit' })

// npm 包的 tgz 里统一是 package/ 目录
const pkgDir = join(work, 'package')
const pjPath = join(pkgDir, 'package.json')
if (!existsSync(pjPath)) { console.log(`解包后没有 ${pjPath}`); process.exit(1) }

const pj = JSON.parse(readFileSync(pjPath, 'utf8'))
console.log(`  原版本 = ${pj.version}`)
pj.version = FAKE_VER
writeFileSync(pjPath, JSON.stringify(pj, null, 2) + '\n', 'utf8')
console.log(`  改成了 = ${FAKE_VER}`)

/** 重新打包（必须在 package 的**父目录**里打，且用 package 这个目录名） */
console.log('重新打包 …')
rmSync(outTgz, { force: true })
execFileSync('tar', ['-czf', outTgz, '-C', work, 'package'], { stdio: 'inherit' })

if (!existsSync(outTgz)) { console.log('打包失败'); process.exit(1) }
console.log(`\n✓ 已生成 ${outTgz}（${(readFileSync(outTgz).length / 1024).toFixed(0)}KB）`)

/** 顺手校验：解出来的 package.json 版本是不是 FAKE_VER */
const verify = join(CACHE, 'verify')
rmSync(verify, { recursive: true, force: true })
mkdirSync(verify, { recursive: true })
execFileSync('tar', ['-xzf', outTgz, '-C', verify, 'package/package.json'], { stdio: 'inherit' })
const vp = JSON.parse(readFileSync(join(verify, 'package', 'package.json'), 'utf8'))
console.log(`校验：包内 version = ${vp.version}  ${vp.version === FAKE_VER ? '✓' : '✗ 不对'}`)
rmSync(verify, { recursive: true, force: true })
rmSync(work, { recursive: true, force: true })
