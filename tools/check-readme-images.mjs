/**
 * tools/check-readme-images.mjs —— 发布前检查：README 引用的图**必须在包里**
 *
 * 🔴 为什么需要它（2026-10-17 加）：
 *   README 里的**相对路径图片**在**三个地方被三套解析器读**：
 *     ① 本地编辑器预览   ② GitHub 仓库页   ③ **npm 包页面**
 *   而 ①② **永远是绿的**（文件就在仓库里）⇒ **只有"从 npm 装这个包的人"看得见图裂**，
 *   且**那个人不会来告诉你**。⇒ 靠肉眼、靠"本地看着挺好"永远发现不了。
 *
 * ⭐ 判据（比"files 里有没有 docs"更硬）：
 *   把 README 里所有相对路径的**图片**引用抽出来，逐条断言它真在
 *   **本次实际打出来的 tarball 清单**里 —— 不看 `files` 字段（那是声明，不是事实）。
 *
 * 用法：
 *   node tools/check-readme-images.mjs <pack 清单文件>
 *   例：npm pack --dry-run > pack.txt; node tools/check-readme-images.mjs pack.txt
 *   不给参数 ⇒ 自己跑一次 `npm pack --dry-run`（本地方便）
 *
 * 退出码：0 = 都命中（或 README 没有相对图）；1 = 有图不在包里
 */
import { readFileSync, existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

const packFile = process.argv[2]

/** 取 pack 清单文本 */
function packText() {
  if (packFile) {
    if (!existsSync(packFile)) {
      console.error(`  ✗ 找不到 pack 清单：${packFile}`)
      process.exit(1)
    }
    return readFileSync(packFile, 'utf8')
  }
  // 🔴 **`npm pack --dry-run` 的清单是写到 `stderr` 的**（前缀 `npm notice`），
  //    不是 stdout —— 我第一版用 `execFileSync` 只拿到 stdout，于是"自己跑"时
  //    **永远拿不到任何路径**，5 张图全被判成"不在包里"（而传一个真的 pack.txt 进来又是对的）。
  //    ⇒ 那种**假失败**很危险：真出问题时你会以为是环境问题而忽略它。
  //    ⚠️ 而且 **`execFileSync` 成功时只返回 stdout**（stderr 拿不到）—— 必须用 `spawnSync`。
  //  🔴 **Windows 上还必须 `shell: true`**：`npm` 在那是 `npm.cmd`，
  //    不加 shell 会 `ENOENT`（**而且是静默的** —— `status: null` + `error.code='ENOENT'`，
  //    stdout/stderr 全空 ⇒ 又落回"5 张图都不在包里"那个假报告）。
  //    shell 模式在 POSIX 上也正常，所以这一条**两平台通用**。
  // 🔴 **必须加 timeout，而且必须禁止 npm 联网**（2026-10-20 CI 真卡住过）。
  //
  // 事故：v0.1.10 的 CI 在「本地预检」这一步**卡了 7 分钟没动**，
  //   `run_started_at` 之后再没 updated ⇒ 整个发布流程停在原地。
  //   根因就是这一行：`spawnSync('npm', ['pack', '--dry-run'])` **没有 timeout**，
  //   而 npm 在这种环境里会去做网络检查（更新通知 / registry 探测）⇒ 挂住不返回。
  //   ⚠️ 本地跑 `node selfcheck.mjs` 也会同样卡住（同一个函数）。
  //
  // ⇒ 三件事一起做：
  //   ① `timeout` —— 卡住就杀掉，别让整条发布流程陪着等；
  //   ② `npm_config_update_notifier=false` + `npm_config_offline=true` —— 让它**不联网**；
  //   ③ 超时/非 0 退出都**明确报出来**，别静默当成"图不在包里"。
  //
  // ⭐ 判据：**任何 `spawnSync` 调外部命令都必须带 timeout** ——
  //   最糟的表现不是报错，而是**无声地挂住**（这一步是发布流水线的一部分）。
  const r = spawnSync('npm', ['pack', '--dry-run'], {
    encoding: 'utf8',
    shell: true,
    timeout: 120000,                  // 2 分钟足够 —— 纯本地列文件，不该更久
    killSignal: 'SIGKILL',
    env: {
      ...process.env,
      npm_config_update_notifier: 'false',
      npm_config_offline: 'true',     // ★ 不联网
      npm_config_audit: 'false',
      npm_config_fund: 'false',
    },
  })
  if (r?.error) {
    // ⚠️ **绝不静默**：拿不到清单时必须说"我拿不到清单"，而不是"图都不在包里"
    console.error(`  ✗ 跑不起来 \`npm pack --dry-run\`：${r.error.code ?? ''} ${r.error.message ?? r.error}`)
    console.error('    ⇒ 请确认 npm 在 PATH 里；或先自己跑一次并把输出文件当参数传进来：')
    console.error('       npm pack --dry-run > pack.txt 2>&1  &&  node tools/check-readme-images.mjs pack.txt')
    process.exit(1)
  }
  /**
   * ⚠️ **超时被杀**时 `spawnSync` 不设 `error`，而是 `signal` 有值、`status` 为 null
   *    （库里那条「`spawnSync` 的 timeout 会杀掉子进程，但 status 是 null」讲的就是这个）。
   * ⇒ 不显式判它，就会拿着半份 stdout 去匹配 ⇒ 又是一次"图不在包里"的假失败。
   */
  if (r?.signal || (r?.status !== 0 && r?.status !== null)) {
    console.error(`  ✗ \`npm pack --dry-run\` 没正常结束（signal=${r?.signal} status=${r?.status}）`)
    console.error('    ⇒ 可能是超时（2 分钟）或被中断。先手工跑一次，再把输出文件当参数传进来。')
    process.exit(1)
  }
  // 两路都拼上（顺序无所谓，后面只做子串匹配）
  return String(r?.stdout ?? '') + String(r?.stderr ?? '')
}

/**
 * 抽 README 里**相对路径的图片**。
 * ⚠️ 只认 markdown 图片语法 `![alt](path)` —— 普通链接 `[x](path)` 不算
 *    （链接裂了不影响观感，图裂了很难看）。
 */
function readmeImages(file = 'README.md') {
  if (!existsSync(file)) return []
  const md = readFileSync(file, 'utf8')
  const out = new Set()
  // 允许 alt 里有任意字符（含 ]），路径里不含 )
  for (const m of md.matchAll(/!\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
    const p = m[1].trim()
    if (/^(https?:|data:|\/)/i.test(p)) continue          // 外部/绝对路径不归我们管
    if (!/\.(png|jpe?g|gif|webp|svg|avif)$/i.test(p)) continue  // 只查图片
    out.add(p)
  }
  return [...out]
}

const imgs = readmeImages()
if (imgs.length === 0) {
  console.log('  ✓ README 没有相对路径的图（这项跳过）')
  process.exit(0)
}

const text = packText()

// ⚠️ 判据与发布脚本一致：npm pack 的输出是 `<大小>  <路径>` ⇒ 用「空格 + 路径 + 行尾」锚定，
//    避免 `a/b.png` 误配到 `x/a/b.png`（后缀相同的另一个文件）。
const inPack = (p) => text.split('\n').some((l) => l.replace(/\r$/, '').trimEnd().endsWith(' ' + p))

console.log(`  README 引用了 ${imgs.length} 张相对路径的图：`)
let bad = 0
for (const p of imgs) {
  if (inPack(p)) {
    console.log(`      ✓ ${p}`)
  } else {
    console.log(`      ✗ ${p}  ← 不在包里！npm 页面上这张图会裂`)
    bad++
  }
}
if (bad) {
  console.log('')
  console.log(`  ✗ ${bad} 张图不在包里 ⇒ 把它加进 package.json 的 files（通常是把 docs 或 images 目录列进去）`)
  process.exit(1)
}
console.log('  ✓ 引用的图都在包里（npm 页面上不会裂）')
