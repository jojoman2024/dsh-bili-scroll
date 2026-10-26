/**
 * check-tab-ownership.mjs —— 守卫：面板里每个 `data-bd-sub` / `data-bd-sec` 都必须落在某个
 * `data-bd-tabin` 的括号区间**内部**。
 *
 * ── 它解决什么问题 ────────────────────────────────────────────
 *   面板的切页是 **CSS 按属性**切的：每个小节一个
 *   `h('div', {'data-bd-sec':'', 'data-bd-tabin':'X'}, …)`，
 *   非当前 tab 的整节 `display:none`。
 *
 *   🔴 **段落若写在那小节的 `)` 之后**（或者写在两个小节之间）⇒
 *      **不属于任何 data-bd-tabin** ⇒ 不受切页规则管 ⇒ **每一页都渲染**。
 *
 *   ⚠️ 这类结构错 `node --check` 与 selfcheck **都抓不到**（语法完全合法），
 *      只有真机看截图才发现。本项目已经踩过**两次**：
 *        · 2026-10-18 私信通知的开关（那次是每页顶上都有）
 *        · 2026-10-26 评论区整理（这次是每页尾部都有）
 *      ⇒ 库里的教训原话：「这条值得做成守卫（本项目还没做）」。现在做了。
 *
 * ── 判据（照库里的做法）────────────────────────────────────
 *   从每个 `data-bd-tabin` 起点算**括号深度**，深度回到 0 那行就是它的结束。
 *   再检查每个 sub/sec 的起始行落在谁的区间里；一个都不落 ⇒ 报错。
 *
 * 用法：node tools/check-tab-ownership.mjs client.js
 * 退出码：0 = 全部有归属；1 = 有"野"段落（会每页都渲染）
 */
import { readFileSync } from 'node:fs'

const file = process.argv[2] || 'client.js'
const L = readFileSync(file, 'utf8').split(/\r?\n/)

/** 从 startLine 起算括号深度，回到 0 的那行就是结束 */
const rangeOf = (startLine) => {
  let d = 0
  for (let k = startLine; k < L.length; k++) {
    for (const c of L[k]) {
      if (c === '(') d++
      else if (c === ')') d--
    }
    if (k > startLine && d === 0) return { from: startLine, to: k }
  }
  return { from: startLine, to: L.length - 1 }
}

/* ── ① 收集所有 tab 小节区间 ── */
const secs = []
L.forEach((l, i) => {
  // 只认**代码行**（跳过注释）：`h('div', { 'data-bd-sec': '', 'data-bd-tabin': 'lab' },`
  if (/^\s*(?:\/\/|\*|\/\*)/.test(l)) return
  const m = /'data-bd-tabin':\s*'([a-zA-Z0-9_-]+)'/.exec(l)
  if (m) secs.push({ tab: m[1], line: i, ...rangeOf(i) })
})

/* ── ② 收集所有"应该归属某个 tab"的容器 ── */
const targets = []
L.forEach((l, i) => {
  if (/^\s*(?:\/\/|\*|\/\*)/.test(l)) return
  if (/'data-bd-sub':/.test(l) || (/'data-bd-sec':/.test(l) && !/'data-bd-tabin':/.test(l))) {
    targets.push({ line: i, kind: /'data-bd-sub':/.test(l) ? 'sub' : 'sec' })
  }
})

/* ── ③ 判定 ── */
const orphans = []
for (const t of targets) {
  const hit = secs.find((s) => t.line >= s.from && t.line <= s.to)
  if (!hit) orphans.push(t)
}

/* ── ④ 报告 ── */
const tabs = [...new Set(secs.map((s) => s.tab))]
console.log(`  · 找到 ${secs.length} 个 tab 小节（${tabs.join(' / ')}）`)
console.log(`  · 检查 ${targets.length} 个容器（sub / 无 tabin 的 sec）`)

if (orphans.length === 0) {
  console.log('  ✓ 全部都有归属（没有会"每页都渲染"的野段落）')
  process.exit(0)
}

console.error(`\n✗ 有 ${orphans.length} 段落在所有 tab 小节之外 —— 它们会在【每一页】都渲染：\n`)
for (const o of orphans) {
  console.error(`    L${o.line + 1}  <${o.kind}>`)
  console.error(`        ${L[o.line].trim().slice(0, 90)}`)
  // 找一下它前面最近的小节结束行，便于快速定位
  const before = secs.filter((s) => s.to < o.line).sort((a, b) => b.to - a.to)[0]
  if (before) console.error(`        ↑ 上一个结束的小节是「${before.tab}」，收尾在 L${before.to + 1}`)
}
console.error(`
  修法：把这段挪进目标小节的 h('div', …) 实参列表【里面】——
  通常是那句收尾的 "}))" 少了一个 ")"，提前把小节合上了。
  ⚠️ 别靠肉眼数括号：改完跑这个守卫 + node --check 确认。
`)
process.exit(1)
