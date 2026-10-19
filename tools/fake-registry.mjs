/**
 * 本地假 npm registry（测试升级用）—— 用完可删。
 *
 * 目的：让「检查更新 → 一键升级」这条链路**不用发版就能端到端跑**。
 *
 * 做法：
 *   ① 从真 registry 下载某个版本的 tgz（默认 0.1.8）
 *   ② 起一个极简 HTTP 服务，冒充 npm registry：
 *        GET /<encoded-pkg>            → 全量 metadata（含 versions / dist-tags）
 *        GET /<pkg>/-/<file>.tgz       → 那个 tgz
 *   ③ 把"假版本号"写进 metadata 的 latest ⇒ 插件就会认为"有新版本"
 *
 * ⭐ 关键点：**tarball 是真的**（真 0.1.8 的包），只是版本号被我们说成 0.1.99。
 *    这样 pnpm 能真的装进去，整条链路（含 pnpm 装配）都是真的。
 */
import { createServer } from 'node:http'
import { mkdirSync, existsSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const CACHE = 'D:\\dsh-standalone-0.1.5-rc.2\\workplaces\\2026-09-30_08-46-30-402\\ccaa-2026-10\\dsh-bili-scroll\\.test-registry'
const PKG = '@jojoman2024/dsh-bili-scroll'
const ENC = encodeURIComponent(PKG)
const NAME = PKG.split('/').pop()
const REAL_VER = process.env.REAL_VER || '0.1.8'
/** 假装出来的"新版"版本号 —— 插件检测到它就会提示有新版本 */
const FAKE_NEXT = process.env.FAKE_NEXT || '0.1.99'
const PORT = Number(process.env.PORT || 4873)

mkdirSync(CACHE, { recursive: true })
const tgzPath = join(CACHE, `${NAME}-${REAL_VER}.tgz`)
const fakeTgzPath = join(CACHE, `${NAME}-${FAKE_NEXT}.tgz`)

/**
 * 🔴 **假版本必须是一个"真的"包**（2026-10-19 踩到）。
 *
 * 第一版我让 metadata 声称 0.1.99、但 tarball 里是 0.1.8 的包 ⇒ pnpm 报：
 *   `ERR_PNPM_UNEXPECTED_PKG_CONTENT_IN_STORE`
 *   `Expected @jojoman2024/dsh-bili-scroll@0.1.99. Actual: 0.1.8`
 * ⇒ pnpm 会**校验包内 package.json 的 version 与元数据是否一致**，对不上就拒绝装。
 *
 * ✅ 所以：先下真 0.1.8，再用 `tools/make-fake-pkg.mjs` 解包改版本号重新打包，
 *    得到一个"内容是真的、版本号也是真的 0.1.99"的包。
 */
if (!existsSync(fakeTgzPath)) {
  console.log(`缺假版本包 ${FAKE_NEXT}，先跑：node tools/make-fake-pkg.mjs ${REAL_VER} ${FAKE_NEXT}`)
  process.exit(1)
}

/** ① 下载真 tgz（只下一次） */
if (!existsSync(tgzPath)) {
  console.log(`下载真包 ${PKG}@${REAL_VER} …`)
  const url = `https://registry.npmmirror.com/${PKG}/-/${NAME}-${REAL_VER}.tgz`
  const r = await fetch(url)
  if (!r.ok) { console.log(`下载失败 HTTP ${r.status}`); process.exit(1) }
  const buf = Buffer.from(await r.arrayBuffer())
  writeFileSync(tgzPath, buf)
  console.log(`  已保存 ${(buf.length / 1024).toFixed(0)}KB → ${tgzPath}`)
} else {
  console.log(`复用已下载的 tgz: ${tgzPath}`)
}
const tgzBuf = readFileSync(tgzPath)
const fakeTgzBuf = readFileSync(fakeTgzPath)

/** 算 integrity（`sha512-<base64>`）—— pnpm 会校验它；给错了会报 integrity 不符 */
const integrityOf = async (buf) => {
  const { createHash } = await import('node:crypto')
  return 'sha512-' + createHash('sha512').update(buf).digest('base64')
}
const realIntegrity = await integrityOf(tgzBuf)
const fakeIntegrity = await integrityOf(fakeTgzBuf)

/**
 * ② metadata：**谎报一个更高的版本**，但 tarball 是那个"真的 0.1.99 包"
 * ⚠️ `dist.tarball` 必须是我们自己的地址，否则 pnpm 会去真 registry 下。
 */
const BASE = `http://127.0.0.1:${PORT}`
const realTarballUrl = `${BASE}/${PKG}/-/${NAME}-${REAL_VER}.tgz`
const fakeTarballUrl = `${BASE}/${PKG}/-/${NAME}-${FAKE_NEXT}.tgz`

const versions = {
  // 让"当前装的版本"也在列表里（免得升级逻辑以为它不存在）
  [REAL_VER]: {
    name: PKG, version: REAL_VER,
    dist: { tarball: realTarballUrl, integrity: realIntegrity },
  },
  // ⭐ 真版本号的真包：内容与元数据一致 ⇒ pnpm 不会拒绝
  [FAKE_NEXT]: {
    name: PKG, version: FAKE_NEXT,
    dist: { tarball: fakeTarballUrl, integrity: fakeIntegrity },
  },
}
const metadata = {
  name: PKG,
  'dist-tags': { latest: FAKE_NEXT },
  versions,
}

const srv = createServer((req, res) => {
  const url = decodeURIComponent(req.url || '/')
  console.log(`  ${req.method} ${url}`)

  /**
   * 🔴 **只有我们自己的包才特殊处理，其它一律转发**（2026-10-19 修）。
   *
   * 第一版写成 `if (url.endsWith('/latest'))` ⇒ **任何**包的 `/latest`
   * 都返回我们的假数据（实测 `dsh-memj/latest` 也回了 0.1.99）✗
   * ⇒ 必须先判断"路径里是不是我们的包"。
   */
  const isOurs = url.includes(PKG) || url.includes(ENC)

  if (isOurs) {
    // tgz：按文件名给对应的包（真版 / 假版）
    if (url.endsWith('.tgz')) {
      const buf = url.includes(`${NAME}-${FAKE_NEXT}.tgz`) ? fakeTgzBuf : tgzBuf
      res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': buf.length })
      res.end(buf)
      return
    }
    if (url.endsWith('/latest')) {
      const body = JSON.stringify(versions[FAKE_NEXT])
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(body)
      return
    }
    if (url === `/${PKG}` || url === `/${ENC}` || url === `/${PKG}/`) {
      const body = JSON.stringify(metadata)
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(body)
      return
    }
  }

  /**
   * ⭐⭐ **其它包一律转发给真镜像**（2026-10-19 补，否则升级会 404）。
   *
   * 为什么会需要：`dsh plugin add` 不只解析我们这一个包 ——
   * 它还会**重新解析 profile 里的全部依赖**（桌面版 profile 里就有 `dsh-memj`）。
   * 假 registry 若只认自己的包，其它包就 404：
   *   `ERR_PNPM_FETCH_404 GET http://127.0.0.1:4873/dsh-memj`
   * ⇒ 做成**反向代理**：不认识的路径透传到真镜像。
   */
  const upstream = `https://registry.npmmirror.com${url}`
  console.log(`    ↪ 转发到 ${upstream}`)
  fetch(upstream, {
    headers: { 'user-agent': 'fake-registry-proxy', accept: req.headers.accept || 'application/json' },
    redirect: 'follow',
  })
    .then(async (r) => {
      const ct = r.headers.get('content-type') || 'application/json'
      const buf = Buffer.from(await r.arrayBuffer())
      // ⚠️ tarball 的 URL 我们会原样返回（它指向真镜像），pnpm 能直接下 —— 不用改
      res.writeHead(r.status, { 'content-type': ct, 'content-length': buf.length })
      res.end(buf)
    })
    .catch((e) => {
      console.log(`    ✗ 转发失败: ${e.message}`)
      res.writeHead(502, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: 'upstream failed', url }))
    })
})

srv.listen(PORT, '127.0.0.1', () => {
  console.log(`\n假 registry 已起：${BASE}`)
  console.log(`  包        = ${PKG}`)
  console.log(`  谎报新版  = ${FAKE_NEXT}`)
  console.log(`  真包      = ${REAL_VER}（${(tgzBuf.length / 1024).toFixed(0)}KB）`)
  console.log(`\n用它起 DSH 实例：`)
  console.log(`  $env:BILI_DUTY_NPM_REGISTRY   = '${BASE}'`)
  console.log(`  $env:BILI_DUTY_NPM_REGISTRY_2 = '${BASE}'`)
  console.log('\n（Ctrl+C 停止）')
})
