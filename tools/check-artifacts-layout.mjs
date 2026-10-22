/**
 * tools/check-artifacts-layout.mjs —— 「产物报告」页的布局守卫（提交前必跑）
 *
 * 🔴 **为什么需要它**（2026-10-22，同一类错一天踩了两次）：
 *   ① 我写 padding:0 想让左右栏竖线顶到导航线，但另一条 (0,3,0) 的规则里有
 *      padding-top:20px ⇒ **被盖掉**，竖线上方留 20px 空隙。`node --check`
 *      查不到、CSS 守卫也查不到（它只查反引号和 tab 覆盖）。
 *   ② 搜索区的左右内边距与列表不一致（10 vs 8）⇒ 搜索框和列表项左边缘错开。
 *      使用者连着提了两次「左边栏的整个左右内边距看起来也有问题」。
 *   ⇒ 这两类都是**数值/权重**问题，只能用断言盯住。
 *
 * 用法：`node tools/check-artifacts-layout.mjs [client.js]`
 *   退出码 0 = 干净；1 = 有问题（逐条列出）
 */
import { readFileSync } from 'node:fs'

const file = process.argv[2] || 'client.js'
const src = readFileSync(file, 'utf8')
const m = /const CSS = `([\s\S]*?)\n`/.exec(src)
if (!m) {
  console.log('  ⚠️ 没找到 CSS 模板串 —— 若本文件不再用这种写法，可以删掉这项检查')
  process.exit(0)
}
const css = m[1].replace(/\/\*[\s\S]*?\*\//g, ' ')
const problems = []

/* ───────── ① 权重冲突：产物页那一节的 padding/margin/border-top 不能被别人盖掉 ─────────
 * 为什么只查这一节：它是唯一"要顶满边缘"的分节，也是唯一被两条规则同时点名的分节。
 */
const weight = (sel) => {
  const s = sel.trim()
  const ids = (s.match(/#[\w-]+/g) || []).length
  const cls = (s.match(/\.[\w-]+|\[[^\]]+\]|:(?!:)[\w-]+/g) || []).length
  const bare = s.replace(/\[[^\]]+\]/g, ' ').replace(/\.[\w-]+/g, ' ').replace(/::?[\w-]+(\([^)]*\))?/g, ' ')
  const els = (bare.match(/(^|[\s>+~])[a-zA-Z][\w-]*/g) || []).length
  return [ids, cls, els]
}
const cmp = (a, b) => { for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i]; return 0 }

const rules = []
const re = /([^{}]+)\{([^{}]*)\}/g
let mm
while ((mm = re.exec(css))) {
  const sels = mm[1].split(',').map((s) => s.replace(/\s+/g, ' ').trim()).filter(Boolean)
  const decls = mm[2].split(';').map((d) => d.trim()).filter(Boolean).map((d) => {
    const i = d.indexOf(':')
    return { prop: d.slice(0, i).trim(), val: d.slice(i + 1).trim() }
  })
  for (const sel of sels) rules.push({ sel, decls })
}

const TARGET = '[data-bd-page][data-bd-tab="artifacts"] [data-bd-sec][data-bd-tabin="artifacts"]'
const target = rules.find((r) => r.sel === TARGET)
if (!target) {
  problems.push(`找不到那条"贴满"规则：${TARGET}`)
} else {
  const tw = weight(TARGET)
  for (const r of rules) {
    if (r.sel === TARGET) continue
    if (!/\[data-bd-tabin="artifacts"\]$/.test(r.sel)) continue   // 只看直接指向该分节的
    if (/:not\(/.test(r.sel)) continue                            // 跳过"隐藏其它页"那条
    const rw = weight(r.sel)
    if (cmp(rw, tw) < 0) continue                                 // 权重更低 = 盖不掉
    for (const d of r.decls) {
      const mine = target.decls.find((x) => x.prop === d.prop)
      if (!mine || mine.val === d.val) continue
      problems.push(`权重更高的规则在同一属性上覆盖它：${r.sel} 的 ${d.prop}:${d.val}（目标 ${mine.val}，权重 ${JSON.stringify(rw)} > ${JSON.stringify(tw)}）`)
    }
  }
  const must = [['padding', '0'], ['margin', '0 -16px'], ['border-top', '0']]
  for (const [prop, want] of must) {
    const d = target.decls.find((x) => x.prop === prop)
    if (!d || d.val !== want) problems.push(`"贴满"规则的 ${prop} 应为 ${want}，实际 ${d ? d.val : '(没写)'}（否则竖线顶不到导航线）`)
  }
}

/* ───────── ② 搜索区与列表的左右内边距必须一致 ─────────
 * 判据是**两边数值相等**，不是各自写死一个数 —— 改一个另一个必须跟着改。
 */
/* 🔴 2026-10-22 **量出来之后重写**：原来这条比的是"搜索框 margin-right vs 列表 padding-right"，
 *    但真机上错的不是那两个数相等，而是 **input 的 width:100% + margin 让它溢出 10px**
 *    （实测搜索框 right=151、列表项 right=141 ⇒ 搜索框正好压在竖线上）。
 * ⇒ 现在断言的是**结构性**的两条：
 *    ① 搜索框必须 width:auto + align-self:stretch（不能是 100%，否则会被 margin 撑出去）；
 *    ② 搜索区盒子的 padding 与列表的左右 padding 相同（这样左边缘才对齐）。
 */
const headPad = /\[data-bd-side\]>\.bd-side-head\{[^}]*padding:(\d+)(?:px)??[;]/.exec(css)
  || /\[data-bd-side\]>\.bd-side-head\{[^}]*padding:(\d+)px;/.exec(css)
const headIn = /\[data-bd-side\]>\.bd-side-head>input\[data-bd-input\]\{([^}]*)\}/.exec(css)
const listPad = /\[data-bd-list\]\{[^}]*padding:(\d+)px (\d+)px (\d+)px(?: (\d+)px)?;/.exec(css)
if (!headPad || !headIn || !listPad) {
  problems.push('找不到左栏的 padding 声明（结构改过就要跟着改这项检查）')
} else {
  const headAll = Number(headPad[1])
  const inDecl = headIn[1]
  const listL = Number(listPad[4] ?? listPad[2])   // 简写 3 值时：上 左右 下
  const listR = Number(listPad[2])
  if (!/width\s*:\s*auto/.test(inDecl)) {
    problems.push('搜索框没有 width:auto —— 通用规则的 width:100% 会把它按 margin 撑出父盒（真机上会压在竖线上）')
  }
  if (!/align-self\s*:\s*stretch/.test(inDecl)) {
    problems.push('搜索框没有 align-self:stretch —— 右边缘不会跟着父盒 padding 收缩')
  }
  if (headAll !== listL) problems.push(`搜索区 padding ${headAll}px ≠ 列表左 padding ${listL}px（左边缘对不齐）`)
  if (headAll !== listR) problems.push(`搜索区 padding ${headAll}px ≠ 列表右 padding ${listR}px（右边缘对不齐）`)
}

/* 🔴 2026-10-22 量出来的真根因：split 被「每个直接子元素 = 一行」那条规则套了 padding。
 * 实测：SPLIT top=86 而 SIDE top=102 ⇒ 差 16px，竖线/横线都顶不到头。
 * ⇒ 断言 split 上显式写了 padding:0。
 */
const splitRule = /\[data-bd-split\]\{([^}]*)\}/.exec(css)
if (!splitRule) {
  problems.push('找不到 [data-bd-split] 规则')
} else if (!/padding\s*:\s*0/.test(splitRule[1])) {
  problems.push('split 没写 padding:0 —— 它会被「每个直接子元素 = 一行」那条规则套上 16px 上下内距，左右栏顶不到导航线')
}

/* ───────── ③ 左栏宽度照 memj 的 25% ───────── */
const sideW = /\[data-bd-side\]\{flex:0 0 (\d+)%;max-width:\1%/.exec(css)
if (!sideW) problems.push('找不到左栏宽度声明')
else if (sideW[1] !== '25') problems.push(`左栏宽度是 ${sideW[1]}%，memj 是 25%（使用者要求"参考 memj"）`)

/* ───────── ④ 不许再用 calc(100vh - N) 死估高度 ─────────
 * 顶栏高度会变（多一行提示就变），估多了空一块、估少了截断。
 */
if (/data-bd-split\]\{[^}]*calc\(100vh/.test(css)) {
  problems.push('分裂容器又用 calc(100vh - N) 估高度了 —— 改用 [data-bd-page][data-bd-fill] 的确定高度链')
}

/* ───────── ⑤ 列表项：标题 13.5px（memj 值）、不显示文件大小 ───────── */
const titleFs = /\[data-bd-item\] \.bd-item-title\{font-size:([\d.]+)px/.exec(css)
if (!titleFs) problems.push('找不到列表项标题的字号声明')
else if (titleFs[1] !== '13.5') problems.push(`列表项标题字号 ${titleFs[1]}px ≠ memj 的 13.5px（使用者说过"字体是不是有点大"）`)
if (/\[dayOf\(f\.name\), kb\(f\.size\)\]/.test(src)) {
  problems.push('列表里又显示文件大小了 —— 使用者明确说"标题下面不要去显示那个文件大小，没意义"')
}
if (css.includes('bd-detail-file')) {
  problems.push('详情顶上那行文件名的小字样式还在 —— 那一行已按使用者要求删掉')
}

if (problems.length) {
  console.log(`  ✗ 产物报告页布局有 ${problems.length} 处问题：`)
  for (const p of problems) console.log('      ' + p)
  process.exit(1)
}
console.log('  ✓ 产物报告页布局：权重无覆盖、左右内距一致、25% 宽、无 100vh 估算、标题 13.5px')
