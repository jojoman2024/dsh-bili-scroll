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

/* ───────── ②-b 导航标签条必须可横向滑动 ─────────
 * 🔴 2026-10-22（使用者：「导航标签应该是可左右滑动的…否则移动端的显示会很奇怪」）：
 *    光把 overflow-x 设成 auto **不够** —— flex 子项的 flex-shrink 默认是 1，
 *    标签会自己缩、scrollWidth 永远等于 clientWidth ⇒ **滑动不触发**、文字还被挤断。
 *    实测四档宽度：加 overflow 但没 flex:0 0 auto 时 scrollWidth 跟着 328→288→268→248 一路缩。
 *  ⇒ 断言三件事：容器 overflow-x:auto、标签 flex:0 0 auto、标签 nowrap。
 */
const tabsRule = /\[data-bd-tabs\]\{([^}]*)\}/.exec(css)
if (!tabsRule) {
  problems.push('找不到 [data-bd-tabs] 规则')
} else {
  if (!/overflow-x\s*:\s*auto/.test(tabsRule[1])) problems.push('[data-bd-tabs] 没有 overflow-x:auto —— 标签超出时滑不动')
  if (!/flex-wrap\s*:\s*nowrap/.test(tabsRule[1])) problems.push('[data-bd-tabs] 没有 flex-wrap:nowrap —— 标签会折成两行')
}
const tabBtn = /\[data-bd-tabs\]>button\{([^}]*)\}/.exec(css)
if (!tabBtn) {
  problems.push('找不到 [data-bd-tabs]>button 规则')
} else {
  if (!/flex\s*:\s*0\s+0\s+auto/.test(tabBtn[1])) {
    problems.push('[data-bd-tabs]>button 没有 flex:0 0 auto —— flex-shrink 默认 1 会让标签自己缩，滑动永远不触发')
  }
  if (!/white-space\s*:\s*nowrap/.test(tabBtn[1])) {
    problems.push('[data-bd-tabs]>button 没有 white-space:nowrap —— 文字会被挤成两行')
  }
}
/* ───────── ②-c 窄屏两级导航（2026-10-22 加）─────────
 * 使用者：窄屏默认只看列表、点条目详情滑出占满、展开时留返回列表按钮。
 * 三条容易「写了但不生效」的地方，逐条断言：
 *  ① 返回按钮必须用**后代**选择器（它在 [data-bd-detail] 里面，不是 split 的直接子元素）
 *     —— 写成 ">" 时 matches() 返回 false、按钮永不出现，**且不报错**（实测抓到过）。
 *  ② 必须有 `.bd-narrow-back{display:none}` 的**全局兜底**，且在媒体查询**外面**
 *     —— 否则宽屏下它没有任何 display 声明、退回默认值 ⇒ 按钮冒出来。
 *  ③ 详情栏收起态必须 `pointer-events:none` —— 否则移出屏幕看不见却仍能点到。
 */
const narrow = /@media \(max-width:640px\)\{([\s\S]*?)\n\}/.exec(css)
if (!narrow) {
  problems.push('找不到窄屏的 @media (max-width:640px) 块')
} else {
  const nb = narrow[1]
  /* 🔴 **必须把每个声明的范围限制在它自己的 {} 里**（2026-10-22 反证抓到的）：
   *    我第一版写的是 /\[data-bd-detail\]\{[\s\S]*?pointer-events:none/ ——
   *    `[\s\S]*?` 会**跨过块边界**，于是把别处的 pointer-events:none 也算进来
   *    ⇒ 故意删掉详情栏那条时**依然报绿**（假绿）。这正是"守卫要验反证"的理由。
   */
  const blockOf = (sel) => {
    const re = new RegExp(sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\{([^}]*)\\}')
    const mm = re.exec(nb)
    return mm ? mm[1] : null
  }
  const detailBase = blockOf('[data-bd-detail]')
  if (detailBase === null) {
    problems.push('窄屏块里找不到 [data-bd-detail] 的基础规则')
  } else {
    if (!/transform\s*:\s*translateX\(100%\)/.test(detailBase)) {
      problems.push('窄屏下详情栏没有 translateX(100%) 收起态 —— 它不会"默认隐藏"')
    }
    if (!/pointer-events\s*:\s*none/.test(detailBase)) {
      problems.push('窄屏下收起态的详情栏没有 pointer-events:none —— 看不见却能点到')
    }
    if (!/position\s*:\s*absolute/.test(detailBase)) {
      problems.push('窄屏下详情栏没有 position:absolute —— 它无法"占满屏幕覆盖列表"')
    }
  }
  if (!/\[data-bd-split\]\[data-narrow-open\] \[data-bd-detail\]/.test(nb)) {
    problems.push('窄屏展开态没写「[data-bd-split][data-narrow-open] [data-bd-detail]」（中间是空格=后代），否则滑不进来')
  }
  /* 🔴🔴 **返回按钮必须是 split 的直接子元素**（2026-10-22 二次修正）：
   *    第一版放在 [data-bd-detail] 里 ⇒ 详情栏的 transform 成了它 fixed 的**包含块**
   *    ⇒ ① 跟着详情栏一起横向滑动；② bottom:33vh 变成"距详情栏底"（实测偏 33px）；
   *    ③ 半透明看不出（透的是详情栏的不透明白底）。
   *    ⇒ 所以现在**必须是子选择器 >**，写后代（空格）反而是错的（那意味着它可能挂在更深处）。
   */
  if (!/\[data-bd-split\]\[data-narrow-open\]>\.bd-narrow-back/.test(nb)) {
    problems.push('返回按钮必须写成 [data-bd-split][data-narrow-open]>.bd-narrow-back（子选择器）—— 它必须挂在 split 下；放进详情栏里会因祖先 transform 变成 fixed 的包含块，跟着滑动且位置偏')
  }
  // 按钮块里必须有 fixed + bottom:33vh + 半透明背景
  const backBlock = /\[data-bd-split\]\[data-narrow-open\]>\.bd-narrow-back\{([^}]*)\}/.exec(nb)
  if (!backBlock) {
    problems.push('找不到返回按钮的规则块')
  } else {
    const bb = backBlock[1]
    /* ⭐ **无边框、无阴影**（2026-10-22 使用者明确要求：「按钮不要边框，不要阴影」）。
     *    它本来就靠"半透明底 + 毛玻璃"从正文里浮出来；加边框/阴影反而显重。
     *    ⚠️ 以后想加回来之前先确认使用者是不是改主意了 —— 这是他的原话要求。 */
    if (/border\s*:\s*(?!none)[^;]*solid/.test(bb)) problems.push('返回按钮又加了边框 —— 使用者要求"不要边框"')
    /* ⚠️ **判据：取 box-shadow 的实际值**，不是"有没有写"。
     *    第一版写的是"把 box-shadow:none 删掉再看还剩不剩" —— 那样写
     *    对 `box-shadow:none` 会删成空串、对真阴影又删不掉，逻辑绕且易错。
     *    ⇒ 直接读出值来断言它必须是 none。
     *    （反证时才发现第一版**假绿**：加了真阴影它仍报通过。） */
    const shadowVal = (/box-shadow\s*:\s*([^;]+)/.exec(bb) || [])[1]
    if (shadowVal === undefined) {
      problems.push('返回按钮没有显式写 box-shadow:none —— 会继承/默认出阴影，使用者要求"不要阴影"')
    } else if (shadowVal.trim() !== 'none') {
      problems.push(`返回按钮又加了阴影（box-shadow:${shadowVal.trim()}）—— 使用者要求"不要阴影"`)
    }    if (!/position\s*:\s*fixed/.test(bb)) problems.push('返回按钮不是 position:fixed —— 它不会悬浮')
    if (!/bottom\s*:\s*33vh/.test(bb)) problems.push('返回按钮不是 bottom:33vh（距底边三分之一屏高）')
    // 半透明：rgba 且 alpha < 1；纯白半透明在白色详情栏上等于没有背景
    const alpha = /background\s*:\s*rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/.exec(bb)
    if (!alpha) problems.push('返回按钮的背景不是 rgba 半透明')
    else if (Number(alpha[4]) >= 1) problems.push('返回按钮的背景不透明（alpha=' + alpha[4] + '）')
    else if (Number(alpha[1]) > 200 && Number(alpha[2]) > 200 && Number(alpha[3]) > 200) {
      problems.push('返回按钮是"白色半透明" —— 它浮在详情栏的白色底上，看不出半透明（实测踩过）')
    } else {
      /* 🔴 **alpha 要按对比度卡**（2026-10-22 加）：
       *    使用者说"透明度再低一点"时，很容易一路调小直到白字糊掉。
       *    实测：0.38 → 2.68（连 AA 大字线 3.0 都不到）；0.45 → 3.35（刚够）。
       *    ⇒ 断言"白字压在按钮上、按钮叠在白底上"的对比度 ≥ 3.0。
       *    ⚠️ 这里只覆盖"叠白底"这一种情况（详情栏就是白底），够用。
       */
      /* 🔴 **对比度要按【实际文字色】算，不能写死白字**（2026-10-22 二次修正）：
       *    第一版这里是 `const L1 = lum(255,255,255)`（写死白字）——
       *    后来使用者把 alpha 调到 0.2，我同时把文字换成深色（白字在
       *    rgb(204,204,204) 上只有 1.61，根本看不见），
       *    结果这条守卫还在按白字报错，**报了个早就不存在的问题**。
       *    ⭐ 判据：断言里的"常量"如果来自被测代码，就必须**从代码里读**，不能写死。
       */
      const lum = (r, g, b) => {
        const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) }
        return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
      }
      const a2 = Number(alpha[4])
      // 文字色：优先从规则里读 color:，认 #fff / #ffffff / var(...,#0f1115) 三种常见写法
      const cm = /color\s*:\s*(#[0-9a-fA-F]{3,8}|var\([^)]*?(#[0-9a-fA-F]{3,8})\))/.exec(bb)
      let fg = [15, 17, 21]        // 兜底用面板主文字色
      if (cm) {
        let hex = cm[1].startsWith('var') ? cm[2] : cm[1]
        hex = hex.replace('#', '')
        if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('')
        fg = [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)]
      }
      const bgComp = [255 * (1 - a2), 255 * (1 - a2), 255 * (1 - a2)]   // 黑 a 叠白底
      const L1 = lum(...fg)
      const L2 = lum(...bgComp)
      const cr = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05)
      if (cr < 3.0) {
        problems.push(`返回按钮文字（rgb ${fg.join(',')}）对比度只有 ${cr.toFixed(2)}（alpha=${a2}）—— 低于 AA 大字线 3.0，字会糊；换文字色或调 alpha`)
      }
    }
  }
}
if (!/\.bd-narrow-back\{display:none;\}/.test(css)) {
  problems.push('缺 `.bd-narrow-back{display:none}` 全局兜底 —— 宽屏下返回按钮会冒出来')
}
// 兜底那行必须在媒体查询之外（简单判据：它的位置在 @media 块结束之后）
{
  const mediaEnd = css.indexOf('@media (max-width:640px)')
  const fallbackIdx = css.indexOf('.bd-narrow-back{display:none;}')
  if (mediaEnd >= 0 && fallbackIdx >= 0 && fallbackIdx > mediaEnd) {
    // 还要确认它不在那个 media 块的 {} 里面
    const bodyStart = css.indexOf('{', mediaEnd)
    let depth = 0, end = -1
    for (let i = bodyStart; i < css.length; i++) { if (css[i] === '{') depth++; else if (css[i] === '}') { depth--; if (depth === 0) { end = i; break } } }
    if (fallbackIdx < end) problems.push('`.bd-narrow-back{display:none}` 被写进了媒体查询里 —— 宽屏下就不会生效')
  }
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
