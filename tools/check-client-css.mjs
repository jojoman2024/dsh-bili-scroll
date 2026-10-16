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
