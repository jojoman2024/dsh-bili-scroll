/**
 * tools/check-client-css.mjs —— 提交前必跑：查客户端插件的 CSS 模板串有没有会截断它的东西
 *
 * 🔴 **为什么需要它**（2026-10-16，同一个坑**一天踩了两次**）：
 *   `client.js` 里的 CSS 是一个**模板字符串**（`const CSS = \`...\``）。
 *   在它的注释里写一个**反引号**（比如想强调某个选择器或属性名）会**提前闭合整个串**
 *   ⇒ 后面整段 CSS 变成 JS 代码 ⇒ 真机报
 *      `dsh-bili-scroll: import failed / Unexpected token '{'`
 *      或 `Invalid left-hand side expression in postfix operation`。
 *
 * ⚠️ **`node --check` 抓不到**：模板串本身语法合法，报错在别的行、还指向不相干的词。
 *   ⇒ 只有真机能发现，或者靠这个纯文本扫描。
 *
 * 用法：`node tools/check-client-css.mjs [client.js]`
 *   退出码 0 = 干净；1 = 发现问题（附行号）
 * ⚠️ 已接进 selfcheck，别绕过它。
 */
import { readFileSync } from 'node:fs'

const file = process.argv[2] || 'client.js'
const lines = readFileSync(file, 'utf8').split('\n')

// 找 CSS 常量的起止（起点：含 `const CSS = ` 的那行；终点：一行只有反引号）
const start = lines.findIndex((l) => /const\s+CSS\s*=\s*`/.test(l))
if (start === -1) {
  console.log('  ⚠️ 没找到 CSS 模板串 —— 若本文件不再用这种写法，可以删掉这项检查')
  process.exit(0)
}
let end = -1
for (let i = start + 1; i < lines.length; i++) {
  if (/^`\s*$/.test(lines[i])) { end = i; break }
}
if (end === -1) {
  console.log('  ✗ CSS 模板串没有闭合（找不到只有反引号的那一行）')
  process.exit(1)
}

const problems = []
for (let i = start + 1; i < end; i++) {
  const l = lines[i]
  if (l.includes('`')) problems.push(`L${i + 1} 反引号（会截断 CSS 串）：${l.trim().slice(0, 100)}`)
  if (l.includes('${')) problems.push(`L${i + 1} 出现了 \${（会被当插值）：${l.trim().slice(0, 100)}`)
}

// 括号平衡（CSS 块内）
const css = lines.slice(start + 1, end).join('\n')
const open = (css.match(/\{/g) || []).length
const close = (css.match(/\}/g) || []).length
if (open !== close) problems.push(`CSS 块括号不平衡：{ ${open} 个 / } ${close} 个`)

if (problems.length) {
  console.log('  ✗ CSS 模板串有问题（' + problems.length + ' 处，L' + (start + 1) + '..L' + (end + 1) + '）：')
  for (const p of problems) console.log('      ' + p)
  console.log('  ⇒ 修法：把注释里的反引号去掉（用引号或裸词代替），别用反引号强调标识符。')
  process.exit(1)
}
console.log('  ✓ CSS 模板串干净（L' + (start + 1) + '..L' + (end + 1) + '，括号平衡 ' + open + ' 对）')

/* ────────────────────────────────────────────────────────────────────────────
 * 第二项检查：面板文案里的**裸星号**
 *
 * 🔴 为什么需要它（2026-10-16 真机截图发现的）：
 *   这个面板是**纯文本**渲染 —— 没有 markdown 渲染器（没有 dangerouslySetInnerHTML，
 *   也没有任何 Md 组件）。所以 JSX 里写 `'保存后**立刻生效**'` 会**原样显示星号**，
 *   使用者看到的是「保存后**立刻生效**」这种带星星的句子。
 *   ⚠️ 我写注释习惯用 ** 强调，写着写着就带进**面向使用者的字符串**里了
 *      —— 那次一共 3 处（其中 2 处还是**之前就存在**的旧 bug，一直没人发现）。
 *
 * 判据：**CSS 模板串之外**、**非注释行**里，出现了含 `**` 的**字符串字面量**。
 *   （注释里的 ** 无所谓 —— 那不给使用者看。）
 * ⚠️ 排除 CSS 段是关键：那段注释里全是 **，会淹没真问题。
 * ──────────────────────────────────────────────────────────────────────────── */
const ascii = String.fromCharCode(42) + String.fromCharCode(42)   // '**'（避开本文档自身的排版）
const stars = []
for (let i = 0; i < lines.length; i++) {
  const lineNo = i + 1
  if (lineNo >= start + 1 && lineNo <= end + 1) continue        // CSS 段：跳过
  const raw = lines[i]
  const t = raw.trim()
  if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) continue  // 纯注释行
  const noComment = raw.replace(/\/\/.*$/, '')                   // 去掉行尾注释
  if (!noComment.includes(ascii)) continue
  // 只在**字符串字面量**里才算（避免误报某些表达式）
  const inStr = /'[^']*\*\*[^']*'/.test(noComment) || /"[^"]*\*\*[^"]*"/.test(noComment)
  if (!inStr) continue
  stars.push(`L${lineNo} 面向使用者的文案里有裸星号（面板不渲染 markdown，会原样显示）：${t.slice(0, 90)}`)
}
if (stars.length) {
  console.log('  ✗ 面板文案里有 ' + stars.length + ' 处裸星号：')
  for (const s of stars) console.log('      ' + s)
  console.log('  ⇒ 修法：把 ** 去掉（面板是纯文本，要强调就用「」或 ! 这类符号）。')
  process.exit(1)
}
console.log('  ✓ 面板文案没有裸星号（' + ascii + ' 不会原样显示给使用者）')

/* ────────────────────────────────────────────────────────────────────────────
 * 第三项检查：**每个子导航 tab 都要在切页规则里出现**
 *
 * 🔴 为什么需要它（2026-10-17 差点栽）：
 *   切页是纯 CSS 驱动的 —— 形如
 *     [data-bd-page][data-bd-tab="settings"] [data-bd-tabin]:not([data-bd-tabin="settings"]),
 *     ...  { display:none }
 *   **每个 tab 名都要在里面列一条**。漏一个的表现是：
 *     点那个标签页 → **什么都没变**（因为没有任何规则把别的分节藏起来，
 *     于是**所有分节一起显示**），而**控制台一句错都没有**。
 *
 * 判据：从 `const TABS = [...]` 里抽出全部 `id`，逐个断言 CSS 段里出现过
 *       `data-bd-tab="<id>"`。新增一个 tab 却忘了加规则 ⇒ 这条当场拦下。
 * ──────────────────────────────────────────────────────────────────────────── */
const cssBlock = lines.slice(start + 1, end + 1).join('\n')
const tabsMatch = /const TABS\s*=\s*\[([\s\S]*?)\]/.exec(lines.join('\n'))
if (tabsMatch) {
  const ids = [...tabsMatch[1].matchAll(/id:\s*'([^']+)'/g)].map((m) => m[1])
  const missing = ids.filter((id) => !cssBlock.includes('data-bd-tab="' + id + '"'))
  if (missing.length) {
    console.log('  ✗ 有 tab 没在切页规则里出现（点它会"什么都不变"）：' + missing.join(', '))
    console.log('  ⇒ 修法：在「切页：只显示当前那一页的分节」那条规则里，给它补一条 `data-bd-tab="<id>"`。')
    process.exit(1)
  }
  console.log('  ✓ 切页规则覆盖了全部 ' + ids.length + ' 个 tab（' + ids.join(' / ') + '）')
} else {
  console.log('  ⚠️ 没找到 `const TABS = [...]` —— 若面板结构变了，这项检查要跟着改')
}
