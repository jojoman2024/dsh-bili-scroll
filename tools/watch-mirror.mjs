/**
 * 临时监控：等 v0.1.10 在 npm 官方源 + npmmirror 都同步完成。
 *
 * 判据（库里那条实测过的）：
 *   ⭐ **两个条件都满足才算同步完成**：
 *      ① `<registry>/<encoded-pkg>/latest` 的 version === 目标版本
 *      ② `<registry>/<encoded-pkg>/-/<name>-<ver>.tgz` HEAD 得到 200
 *   只看 ① 会误判 —— metadata 可能先翻、tarball 还没到，
 *   那时用户点升级会失败。
 *
 * 用法：node tools/watch-mirror.mjs 0.1.10 [最多等多少分钟]
 */
const PKG = '@jojoman2024/dsh-bili-scroll'
const ENC = encodeURIComponent(PKG)
const NAME = PKG.split('/').pop()
const WANT = process.argv[2] || '0.1.10'
const MAX_MIN = Number(process.argv[3] || 20)

const REG = {
  npm: 'https://registry.npmjs.org',
  mirror: 'https://registry.npmmirror.com',
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** 查一个源的状态：{ latest, tarball } */
const probe = async (base) => {
  const out = { latest: '', tarball: 0 }
  try {
    const r = await fetch(`${base}/${ENC}/latest`, {
      headers: { 'User-Agent': 'npm/10', Accept: 'application/json' },
      signal: AbortSignal.timeout(15000),
    })
    if (r.ok) out.latest = String((await r.json()).version || '')
  } catch { /* 忽略 */ }
  try {
    const r = await fetch(`${base}/${PKG}/-/${NAME}-${WANT}.tgz`, {
      method: 'HEAD', signal: AbortSignal.timeout(15000),
    })
    out.tarball = r.status
  } catch { out.tarball = -1 }
  return out
}

const t0 = Date.now()
const deadline = t0 + MAX_MIN * 60 * 1000
let round = 0

while (Date.now() < deadline) {
  round++
  const [a, b] = await Promise.all([probe(REG.npm), probe(REG.mirror)])
  const okNpm = a.latest === WANT && a.tarball === 200
  const okMirror = b.latest === WANT && b.tarball === 200

  const el = Math.round((Date.now() - t0) / 1000)
  console.log(
    `[${String(el).padStart(4)}s] npm: ${a.latest || '?'} / tgz ${a.tarball}` +
    `   |   mirror: ${b.latest || '?'} / tgz ${b.tarball}` +
    `${okNpm ? '  ✓npm' : ''}${okMirror ? '  ✓mirror' : ''}`
  )

  if (okNpm && okMirror) {
    console.log(`\n✅ 全部同步完成（${el}s，${round} 轮）`)
    process.exit(0)
  }
  await sleep(15000)
}

console.log(`\n⏰ 等满了 ${MAX_MIN} 分钟仍未完全同步`)
process.exit(1)
