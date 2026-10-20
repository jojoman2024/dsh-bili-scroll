/**
 * dsh-bili-scroll —— 浏览器半端（**面板挂在右侧栏**）
 * ============================================================================
 * ⭐ **client bundle 不是 ESM，是自注册脚本**（2026-10-14 从官方包里挖到的约定）：
 *
 *     window.__ModuleLoader__.load({
 *       id: '<包名>',                       // 必须等于 package.json 的 name
 *       factory: (require) => { ... return { inject: [...], apply(ctx) {...} } },
 *     })
 *
 * ⭐ **入口：右侧栏**（2026-10-16 从「设置页」搬过来的）
 *
 * 原来是注册成 `settings.section`（设置里的一页）。搬到右侧栏是因为
 * 使用者更希望它**随手就能开**：右侧栏是常驻的，设置页要专门点进去。
 *
 * 右侧栏要注册**三处**（两阶段注册，少一处就点不动或没标题）：
 *
 *   ① tab 类型定义   `ctx.sidebarRightTabs.register({ id, kind, title, guide })`
 *      —— `guide` 让它在右侧栏「开始」页出现一张卡
 *   ② tab 本体       `slots.register('sidebar.right.pane.tab', { key: <①的 id> })`
 *      —— 🔴 **只注册①的卡是点不动的**：卡片的点击行为被官方写死成
 *         `openTab(selected.kind, { replaceTab: true })`，必须真有这个 kind 的页面
 *   ③ tab 标题芯片   `slots.register('sidebar.right.pane.tab.title', { key: <①的 id> })`
 *      —— 可选，不注册就用 ① 里的 `title()`
 *
 * ⚠️ **两个 inject 是两回事**（极易错）：
 *   · 本文件 `inject`（下面是 `['slots', 'sidebarRightTabs']`）= **客户端服务短名**
 *   · `package.json` 的 `dsh.client.inject` = **模块包名**（预加载哪些 client 模块）
 *   填错任一处 ⇒ 该 entry 永远 pending ⇒ **整页 `Failed to load plugins`**（不是局部失效）。
 *   ⚠️ 改 `package.json` 那处属于**包元数据** ⇒ **必须重启宿主**才生效（JS 那处走 HMR）。
 *
 * ⚠️ **id / kind 撞车会 throw**，而 throw 同样拖垮整个 entry ⇒ 已扫过：
 *   内置 kind 有 keyed/list/plan/subagentchat/terminal，第三方见过 wb-switch；
 *   本插件用 `bili-scroll`，未占用。
 *
 * 这一页要满足使用者说的形状：
 *   · **总开关 → 打开之后下面才展开子开关**（峰谷自动刷 → 中午 / 晚上）
 *   · **数字项要能自己填**（定量刷：每天几条）
 *   · **账号绑定必须在面板里**（扫码登录 + 二维码直接显示在页里）
 *   · 会发东西出去的（自动评论）、要下大模型的（本地转写）**默认关**
 * ============================================================================
 */
window.__ModuleLoader__.load({
  // 🔴 **这里必须是【完整包名】**（含 scope 与斜杠），不能写短名 ——
  //    2026-10-16 发 npm 时改名成 `@jojoman2024/dsh-bili-scroll`，
  //    同时把这一行跟着改。依据：官方那几个 scoped 插件（`dsh-client-modules` /
  //    `dsh-client-ui-sidebar-right` / `dsh-api-job-controller` …）的 `lib/client.js`
  //    里写的都是**完整包名**（探针逐个核对过）。
  //    服务端拼 client 资源 URL 用的也是包名（`??<包名>/client.js`，见 dsh-client-modules）。
  id: '@jojoman2024/dsh-bili-scroll',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement

    const API = '/api/bili-scroll-jojo'
    const jget = async (p) => (await fetch(API + p, { credentials: 'same-origin' })).json()
    const jpost = async (p, body) => (await fetch(API + p, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body || {}),
    })).json()

    /**
     * 面板样式 —— ⭐ **2026-10-16 全面改用官方设计令牌**。
     *
     * 规格来源：从运行中的官方实例**实测**读出（隔离实例 3110，getComputedStyle），
     * 不是猜的。官方「设置行」的真实排版是：
     *   display:flex / align-items:center / gap:8px / padding:16px 0
     *   + 底部 1px 分隔线 var(--dsw-alias-border-l2)
     *   标题 14px/400/行高22 用 label-primary；说明 12px/400/行高18 用 label-tertiary；
     *   文字列 gap 4px、flex:1。
     *
     * 🔴 改之前的老样式有 6 处**明显偏离官方**（这就是"看起来不像官方"的主因）：
     *   ① 主按钮 / 开关打开用 `#3b82f6`（蓝）—— 官方品牌色其实是 **`#0f1115`（近黑）**！
     *   ② 聚焦边框用蓝色 —— 应用 `var(--dsw-focus-ring-color)`，它可能为空 ⇒ 退到品牌色
     *   ③ `#22c55e` / `#f59e0b` 写死 —— 官方有 `state-success-primary` / `state-warn-primary`
     *   ④ 圆角写死 `8px` —— 官方有 `radius-sm`(8) / `radius-md`(12)
     *   ⑤ 字号写死 `11/12/13px` —— 官方是成套的 `font-xxs-12` / `-xs-13`（**含配套行高**）
     *   ⑥ 分节标题做成 11px + 字距 + 像全大写 —— 官方分节是 sentence-case、正常字重
     *
     * ⚠️ 每个 var() 都留了 fallback（官方若改了令牌名，也不会整片失色）。
     * ⚠️ 模板字符串里**不要写裸反引号**（会截断整个 CSS；库内 `a641d97c` 记过这个坑）。
     */
    const CSS = `
/* ══════════════════════════════════════════════════════════════════════════
 * 间距体系 —— **只有一条规则**（2026-10-16 第三次改，照官方实测值重做）
 *
 * 🔴 **上一版为什么"间隔全都不统一"**（使用者截图指出）：
 *    我在**枚举「行型」** —— data-bd-row 给一套 padding、row2 给另一套、
 *    foot 又一套，而**裸平铺的 label / textarea / select 什么都没有**
 *    ⇒ 留白取决于"这一项恰好用了哪个包装"，于是有的挤成一团、有的空一块。
 *
 * ⭐ **官方的做法（从运行实例量出来的）**：**根本没有多种行型** ——
 *    每一行都是同一个模板，只有一种间距：
 *      padding: 16px 0  +  border-bottom: 1px solid rgba(0,0,0,.1)
 *    行与行之间 margin = 0（节奏完全由 padding + 分隔线给出）。
 *    实测：连续 6 行高 77/69/147/77/77/75，而行间距恒为 0、padding 恒为 16px 0、
 *    底线恒为 1px rgba(0,0,0,0.1)。
 *
 * ⇒ **改法**：不再枚举「行型」，改成「**分节里的每个直接子元素都算一行**」——
 *    不管它是 row / label / textarea / select / 按钮组，**一律**拿同一个间距。
 *    这样"整齐"由**结构**保证，不靠我记得给每个新加的项套对包装。
 *
 * ⚠️ 例外只有两个：分节标题（data-bd-h）与紧跟它的那句说明 —— 它们是**标题**不是行。
 * ⚠️ 本段注释**不能出现反引号**：那会提前闭合整个 CSS 模板串
 *    （本文件踩过三次，所以有 tools/check-client-css.mjs 那道硬检查）。
 * ══════════════════════════════════════════════════════════════════════════ */

/* 外层：撑满并自己滚（右侧栏比设置页窄，别写死 max-width）
   ⚠️ 上下 padding 交给**顶栏自己**给：见下面 [data-bd-top] 的注释。
   这里只留左右与底部。 */
[data-bd-tabwrap]{display:block;height:100%;overflow:auto;box-sizing:border-box;padding:0 16px 32px;}

/* ── 顶栏：**固定在面板顶部、不跟着滚**（2026-10-16 使用者要求：
 *    "现在跑一轮和几个状态标识，应该固定浮在顶部不跟着滑动，看要不要有顶满宽度的线分隔"）。
 *
 * 为什么要它：状态徽章 + 「现在跑一轮」是**随时要按/要看**的东西，
 *   滚到下面改设置时就够不着了 ⇒ 钉在顶上。
 *
 * 🔴 **它必须占掉自己在文档流里的高度，不能只靠负 margin 提上去**
 *    （2026-10-16 实测踩到）：第一版写的是
 *      position:sticky; top:0; margin:-16px -16px 0; padding:16px 16px 12px
 *    ⇒ 负 margin 把它"提"到了内容流的上方，可 **sticky 仍然占着原来的位置**，
 *      于是它**盖住了第一个分节的标题**（量出来重叠 16px，「怎么跑」只露半截）。
 *    ⇒ 现在改为：**tabwrap 不再给上下 padding**（见上），
 *      由顶栏自己给 padding:16px 0 12px，并**只左右出边**（负 margin 左右各 -16）。
 *      这样它在流里占的就是自己真实的高度，下面的内容自然排在它下方、不会被盖。
 * ⭐ 顶满宽度的分隔线：用 box-shadow 画 —— 它**不吃布局**，
 *   而 border-bottom 会让这一行的宽度比别的行少 1px（右边就露不出头了）；
 *   而且 sticky 元素的线要跟着它一起走，shadow 最省事。
 * ⚠️ 背景必须给不透明色：否则下面的内容会从它底下透出来（sticky 经典坑）。
 * ⚠️ 下面还要留 8px：顶栏与第一个分节的标题紧贴会显得挤（实测量过，原来是 0px）。
 *
 * 🔴 **2026-10-16 改成 [data-bd-head]（顶栏 + 子导航包一层）**：
 *    原来这个 [data-bd-top] 是**自己 sticky**；现在多了一条子导航，
 *    若两个都写 top:0 会**互相盖住**（后一个滑到前一个底下）。
 *    ⇒ 包成一个 [data-bd-head]，**只有它 sticky**，也不用去猜顶栏到底多高。
 *    [data-bd-top] 从此只是个普通 flex 行（见下面那条规则）。
 * ⚠️ 背景必须给不透明色，分隔线用 box-shadow（不吃布局、能顶满宽度）。
 */
[data-bd-head]{position:sticky;top:0;z-index:6;
  margin:0 -16px 8px;padding:16px 16px 0;
  background:var(--dsw-alias-bg-base,#fff);
  box-shadow:0 1px 0 0 var(--dsw-alias-border-l2,#0000001a);}
[data-bd-top]{display:flex;align-items:center;gap:8px;}

/* ── 子导航标签条 ──
   ⭐ 样式**照抄官方那个「对话 / 轨迹」**（2026-10-16 从 dsh-client-ui-conversation
   的 CSS modules 里读出来的原样值）：
     .tabs   display:flex; gap:36px; margin-top:10px; padding-left:8px; position:relative
     .tab    color:--dsw-alias-label-tertiary; cursor:pointer; background:none; border:none;
             padding:0 0 9px; font-size:13px; font-weight:500; line-height:16px; position:relative
     .tab:after  content:''; background:none; border-radius:2px; height:2px;
                 position:absolute; bottom:-1px; left:0; right:0
     .tabActive:after  background:--dsw-alias-state-business-primary
   ⚠️ 选中态那根 **2px 线是伪元素**（bottom:-1px 让它压住下面那条分隔线），
      **不是 border-bottom** —— 照抄，别自己换（换了会改行高、与官方不一致）。
   ⚠️ font-family:inherit 要显式给：button 默认用系统 UI 字体，与旁边文字不一致。
   🔴 **'padding-left' 用 0 而不是官方的 8px**（2026-10-16 使用者要求：
      "让 sub 比如标题能够和子导航标签的功能设置按钮，看起来是左对齐的"）。
      官方那份 8px 是在它自己的上下文里（与它旁边的标题对齐）；
      在我们这儿，右边的内容从 tabwrap 的 16px 内距开始
      ⇒ 标签再缩 8px 就会**比下面的标题多出 8px**，看着不齐。
      ⚠️ 所以这里是**有意偏离官方那 8px 的**，理由写在上面。 */
[data-bd-tabs]{display:flex;gap:36px;margin-top:10px;padding-left:0;position:relative;}
[data-bd-tabs]>button{color:var(--dsw-alias-label-tertiary,#81858c);cursor:pointer;
  background:none;border:none;padding:0 0 9px;font-size:13px;font-weight:500;
  line-height:16px;position:relative;font-family:inherit;}
[data-bd-tabs]>button:after{content:'';background:none;border-radius:2px;height:2px;
  position:absolute;bottom:-1px;left:0;right:0;}
[data-bd-tabs]>button[data-on]{color:var(--dsw-alias-state-business-primary,#0f1115);}
[data-bd-tabs]>button[data-on]:after{background:var(--dsw-alias-state-business-primary,#0f1115);}

/* ── 页面 ──
   ⭐ 子导航这一版**没有新增内容容器** —— 分节仍直接排在 page 下，
      切页靠 CSS 按 page 上的 data-bd-tab 隐藏非当前页的分节。
   🔴 **这是有意避开一个已知坑**（库内 b15ee951）：只要多插一层容器，
      就会把 flex 上下文断掉（flex:1 不是"我要占满"，而是"在**父容器的**分配里占 1 份"）
      ⇒ 内层 flex:1 / min-height:0 全失效 ⇒ 高度被内容撑开 ⇒ overflow:auto 永不触发、
      **滚不动**。而且这错**成对出现**（结构复制到第二处时遗漏跟着复制）。
      ⇒ 所以：能不加容器就不加；真加的话，那一层必须自己写 display:flex + min-height:0。 */
[data-bd-page]{display:flex;flex-direction:column;min-height:0;}
[data-bd-sec]{display:flex;flex-direction:column;}

/* ── 切页：只显示当前那一页的分节 ──
   ⚠️ 用分节上的 data-bd-tabin 标注归属，隐藏规则集中在这一处、好找；
      不要给「不要的分节」加类去关 display（那会让分节自己的 display:flex 也要跟着改）。
   🔴 **每个 tab 名都要在这里列一条** —— 漏一个的表现是"点那个标签页什么都没变"
      （因为没有任何规则把它隐藏掉，于是**所有分节都还在**）。
      ⚠️ 2026-10-17 加「实验功能」时就差点漏掉这条（当时只有 settings/prompt/env）。 */
[data-bd-page][data-bd-tab="settings"] [data-bd-tabin]:not([data-bd-tabin="settings"]),
[data-bd-page][data-bd-tab="prompt"]   [data-bd-tabin]:not([data-bd-tabin="prompt"]),
[data-bd-page][data-bd-tab="env"]      [data-bd-tabin]:not([data-bd-tabin="env"]),
[data-bd-page][data-bd-tab="lab"]      [data-bd-tabin]:not([data-bd-tabin="lab"]){display:none;}

/* ⭐⭐⭐ **唯一那条间距规则**：分节 / 子块里的每个直接子元素 = 一行。
   ⚠️ 顺序要紧：后面几条覆盖必须写在它**之后**才生效。 */
[data-bd-sec]>*,[data-bd-sub]>*{
  padding:16px 0;
  border-bottom:1px solid var(--dsw-alias-border-l2,#0000001a);}
/* 一节的最后一项不拖线：否则它会和下一节的上边线贴成"双线" */
[data-bd-sec]>*:last-child{border-bottom:0;}

/* 🔴 **sub 内部的每一行都要有线**（2026-10-16 修：使用者截图指出
 *    「最近一次」和「峰谷时段自动刷」之间没有分隔线）。
 *    原来这条写的是 [data-bd-sub]>*:last-child **也去线**，
 *    但 sub 常常**在分节的中间**（它后面还有别的行）⇒ 那条线一去掉就**断了**。
 *    ⚠️ 只有 sub 本身就是**这一节的最后一项**时，它的最后一行才不该有线
 *       （否则会和下一节的上边线贴成双线）。这一条已由上面那句覆盖不到，
 *       所以在这里补一条精确的。
 */
[data-bd-sec]>[data-bd-sub]:last-child>*:last-child{border-bottom:0;}

/* 🔴 **[data-bd-sub] 只是个分组壳，不吃行间距、也不画线**（2026-10-16 使用者截图指出
 *    "上下两条灰边的距离不一样"）：
 *    它是上面那条规则的直接子元素 ⇒ **自己也会拿到 padding:16px 0 + 底线**，
 *    而它内部的每个行**又各拿一次** ⇒ 上下叠加成：
 *      上面 = 16(sub) + 16(row) = 32，下面 = 16(row)（最后一行不画线）
 *    ⇒ 视觉上就是"上面空一大截、下面贴着线"。
 *    ⇒ 把它自己的那份去掉，只让**内部的行走那一套规则**。
 */
[data-bd-sec]>[data-bd-sub]{padding:0;border-bottom:0;}

/* 🔴 **分节标题上方要有一条线，把"新的一块"隔开**（2026-10-16 使用者要求：
 *    "大标题跟前面板块的分隔也应该有灰线" → 后来又说"干脆顶满宽度用来做区分"）。
 *    原来只靠 28px 的空隙区分，太弱、扫一眼看不出换节了。
 * ⭐ **顶满宽度**：分节本身左右出边（负 margin 抵消 tabwrap 的左右 padding），
 *    这样那条 border-top 就从面板最左画到最右。
 *    ⚠️ 出边后要把左右内边距补回来，否则文字会贴到面板边缘。
 *    ⚠️ 这条要用 border-top 而不是给上一节的最后一行加底线 ——
 *      后者会让"一节的最后一项不拖线"那条失效、又变成双线。
 */
[data-bd-sec]{margin:28px -16px 0;padding:20px 16px 0;
  border-top:1px solid var(--dsw-alias-border-l2,#0000001a);}
/* 第一个分节上面不画（它上面是固定的顶栏，已经有自己的线了） */
/* 顶栏（现在包在 [data-bd-head] 里）下面的第一个分节：不画上边线（它上面是那根顶栏的分隔线）。
   ⚠️ 2026-10-16 加了子导航 ⇒ 选择器要跟着改：head 后面那个分节才是"第一个"。
   🔴 **只去掉那条线，'padding-top' 要跟别的分节一样**（2026-10-16 使用者指出：
      "每页第一个 sub 的标题距离上面灰线的初始间隔应该等于其他大标题距离上面灰线的间隔，
      现在就现在留的间隔太小了"）。
      原来这里写了 'padding:0 16px' ⇒ 首节标题距上边只有 8px（头里给的 margin-bottom），
      而其它分节是 padding-top:20px ⇒ **两种间距**。现在统一成下面那条同样的 20px。 */
[data-bd-head]+[data-bd-sec]{border-top:0;margin:0 -16px;padding:20px 16px 0;}

/* 🔴 **子导航页里"可见的第一个分节"也不该有上边线**（2026-10-16 使用者指出：
 *    "提示词和环境与账号的子页，sub 上的灰线去掉啊，它们已经是页面里唯一的 sub 了"）。
 *
 * 根因：上面那条 [data-bd-head]+[data-bd-sec] 只认得**紧跟顶栏的那一个**，
 *   而这两个页里唯一的可见分节在 DOM 里排在**很后面**（前面那些都被 display:none 藏了）——
 *   ⚠️ **display:none 不影响兄弟选择器**：它仍然按 DOM 相邻关系算，
 *   于是那条"第一个分节不画线"的规则**匹配不上**，线就露出来了。
 *
 * ⇒ 按 tab 点名去掉：这几个页**各自只有一个分节**，所以"第一个"就是"它自己"。
 *    ⚠️ 同样**只去线、不动 padding**（理由见上一条注释）。
 *    🔴 **2026-10-18 补上 lab（实验功能）** —— 加第四个 tab 时漏了这一页，
 *       表现就是使用者说的"大标题上面多了 sub 上的一条灰线"。
 *       ⇒ **新增 tab 时，只要它整页只有一个分节，就必须往这条规则里加一条**。
 *       这类"漏一个 tab"原先没有守卫能查（工具只查"每个 tab 有没有切页规则"），
 *       所以更容易漏 —— 现已补进 tools/check-client-css.mjs 的第四项检查。
 *    ⚠️ 若以后这些页里加了第二个分节，要把它改成"该 tab 的第一个分节"：
 *       纯 CSS 表达不了"第一个可见的"（没有反向兄弟选择器），
 *       那时更稳的做法是渲染时给每个 tab 的首个分节打个标记属性。
 */
[data-bd-page][data-bd-tab="prompt"] [data-bd-tabin="prompt"],
[data-bd-page][data-bd-tab="env"] [data-bd-tabin="env"],
[data-bd-page][data-bd-tab="lab"] [data-bd-tabin="lab"]{border-top:0;margin-top:0;padding-top:20px;}

/* ── 分节大标题 ──
   ⭐ **比正文大一号**（2026-10-16 使用者要求："所有大标题的字号都大一号"）。
      正文那档是官方 font-s-14（14px/22）⇒ 标题用**下一档** font-base-16（16px/24）。
      ⚠️ 用令牌而不是写死 px —— 尺寸跟着官方设计系统走。
   ⚠️ 它「不算一行」：不画线、不吃 16px 上下留白（见下面两条覆盖）。 */
[data-bd-h]{font-size:var(--dsw-font-base-16-font-size,16px);
  line-height:var(--dsw-font-base-16-line-height,24px);font-weight:600;
  color:var(--dsw-alias-label-primary,#0f1115);}
/* 分节标题 + 紧随其后的说明：不算「行」（不画线、不吃 16px 上下留白）
   🔴 **标题↔说明的间距也要跟别处一样是 4px**（2026-10-16 使用者指出：
      "大标题和他的描述的间隔也要和其他区统一"）。
      原来这里写的是标题 padding-bottom:10px + 说明 padding-bottom:2px ⇒ 实际 12px，
      而普通的「标签↔描述」是 4px ⇒ 大小标题的间距**不是一个数**。
      ⇒ 改成用与下面那条**同一条规则**（[data-bd-label]+[data-bd-note] 的 4px），
        这里只管"不画线、不占行间距"。 */
[data-bd-sec]>[data-bd-h],[data-bd-sub]>[data-bd-h]{padding:0;border-bottom:0;}
[data-bd-sec]>[data-bd-h]+[data-bd-note],[data-bd-sub]>[data-bd-h]+[data-bd-note]{
  padding:0;border-bottom:0;margin-top:4px;}
/* 标题下面到第一个设置项之间留一点，别和上一条混在一起 */
[data-bd-sec]>[data-bd-h]+[data-bd-note]+*,[data-bd-sec]>[data-bd-h]+*:not([data-bd-note]){
  margin-top:8px;}

/* ⭐ **「标签 + 描述」这一对，间距恒为 4px**（2026-10-16 实测官方值，修不统一）。
 *
 * 🔴 之前的问题是**这个间距取决于 label 恰好被放在哪个容器里**：
 *      · 放在 [data-bd-row] 的 grow 里 ⇒ 容器是 block、**没有任何间距（0px）**；
 *      · 放在 [data-bd-field] 里           ⇒ 容器 gap 6px；
 *      · 官方实测却是恒定的 **4px**（连量 6 行，flex-direction:column 且 gap:4px）。
 *   ⇒ 所以截图里"标题与描述的间距不统一"—— 有的贴着、有的空一截。
 *
 * 现在**不再依赖容器**：直接用相邻兄弟选择器给这一对固定间距。
 *   · 父容器一律 flex column、**gap 归零**，把间距的职责收回到这里一处；
 *   · 用 margin-top 而不是 gap，这样 label 后面**没有**描述时不留多余的 4px。
 *
 * 🔴🔴 **flex:1 1 0% 是必须的，千万别弄丢**（2026-10-16 我就在这里翻过车）：
 *    这一条同时管着 grow 与 field 两个容器，我上一版**漏写了 flex:1**
 *    ⇒ 文字列不再撑满剩余空间 ⇒ **右边的控件（下拉 / 数字框 / 开关）全部左移**、
 *      各自停在不同位置 —— 截图里一眼就是"全都没右对齐"。
 *    ⇒ [data-bd-grow] 必须 flex:1（撑满、把控件顶到最右）；
 *      [data-bd-field] 是**竖排**（控件在下面占满整行），本来就不需要 flex:1。
 */
[data-bd-grow],[data-bd-field]{display:flex;flex-direction:column;gap:0;min-width:0;}
[data-bd-grow]{flex:1 1 0%;}
[data-bd-label]+[data-bd-note]{margin-top:4px;}
/* label 后面直接跟控件（field 里那种）：控件与文字之间留 8px */
[data-bd-label]+[data-bd-ctl],[data-bd-note]+[data-bd-ctl]{margin-top:8px;}

/* 行 / 并排组 / 竖排项：只负责**内部排布**，间距一律由上面那条「唯一规则」给。
   ⚠️ 这里**不要再写 padding/margin** —— 那正是上一版"间隔不统一"的病根。 */
[data-bd-row]{display:flex;align-items:center;gap:8px;}
/* ⭐ 输入框 + 开关并排（「要通知谁」那一行，2026-10-19 加）：
   输入框吃掉剩余宽度；开关那一组宽度由内容决定，被挤到最右。
   🔴 **必须自己撑满 [data-bd-ctl]**（2026-10-19 截图修正）：
      Field 的 stack 模式结构是
        [data-bd-field]（竖排）> [data-bd-ctl]（**横排 flex**）> 我们的 inline
      而 [data-bd-ctl] 没有给子元素 flex:1（它默认是"控件有多大就多宽"）
      ⇒ 不写 width:100% / flex:1 时，这一行只占**内容宽度**，
        输入框铺不满、开关也到不了行右边界（实测就是这个症状）。
      ⚠️ 用 width:100% 而不是 flex:1：ctl 可能还有别的子元素，
        它们不该被我们这一条连带改动。 */
[data-bd-ctl]>[data-bd-inline]{flex:1 1 auto;width:100%;min-width:0;}
[data-bd-inline]{display:flex;align-items:center;gap:8px;}
/* ⚠️ 顺序要紧：先让所有子项不伸缩，**再**把输入框单独放开**
   （反过来写会被 >* 那条盖掉 —— 同权重、后者胜）。
   🔴 inline 里的输入框还要 **width:auto**（2026-10-19 截图修正）：
      上面那条 [data-bd-field] [data-bd-input]{width:100%} 权重更高（0,2,0），
      会让输入框抢满整行、把右边的开关挤出去。
      这里补 width:auto 之后，宽度完全由 flex:1 1 0% 分配。
   ⚠️ 选择器**必须写全 [data-bd-field] [data-bd-inline]>[data-bd-input]**（0,3,0）
      才压得过那条；只写两段会打平、然后按顺序赌，不可靠。 */
[data-bd-inline]>*{flex:0 0 auto;}
[data-bd-field] [data-bd-inline]>[data-bd-input]{flex:1 1 0%;min-width:0;width:auto;}
/* ⭐ 「名字 + 开关」的一小组，**横排、同一水平线**（2026-10-19 使用者要求）：
   「开关要跟面板里其他开关右边缘对齐；开关的名字肯定要和开关在一条水平线上」
   · 横排：名字在左、开关在右（**不要竖排**）；
   · align-items:center ⇒ 名字与开关**垂直居中对齐**（同一水平线）；
   · flex:0 0 auto ⇒ 不伸缩，宽度由内容决定 ⇒ 右边自然就是行右边界。
   ⚠️ **不要加 margin-left:auto**：
      输入框已经是 flex:1 1 0%（吃掉全部剩余空间）⇒ 剩余空间为 0，
      auto 外边距没有东西可推；真推起来反而会把 gap 挤掉、
      让「输入框 ↔ 开关组」的间隔从 8px 变成不确定值。
      靠「输入框撑满」这一条就够了 —— 开关组被挤到最右是它的结果，不是另一条规则。
   ⭐ **为什么右边缘能跟别的开关对齐**：
      [data-bd-sec] 有 padding:20px 16px 0（左右各 16px），
      而 [data-bd-sub] 是它的子元素、padding:0（不额外缩进）
      ⇒ **sub 里的元素与 sec 直属元素的左右内边界完全相同**
      ⇒ 都顶到右边界时，右边缘自然一致。
   ⚠️ 不要用 ToggleRow：它自带 [data-bd-row]+grow+label+note，塞进 inline 行会撑歪。 */
[data-bd-switchgroup]{display:flex;align-items:center;gap:8px;flex:0 0 auto;}
/* ⚠️ 不要 white-space:nowrap —— 右侧栏窄，「评论时 @ 他」六个字会顶出去。 */
[data-bd-swlabel]{min-width:0;}
[data-bd-row2]{display:flex;gap:20px;}
[data-bd-row2]>*{flex:1;min-width:0;}
/* ⭐ 三等分一行（模型那三个下拉用）：provider / 模型 / 思考档位 各占 1/3。
   ⚠️ gap 给 8px（比 row2 的 20px 小）—— 右侧栏窄，三个一起排要省地方。
   ⚠️ 每个 min-width:0 是必须的：不然 select 的长 option 会把格子撑开、挤出容器。 */
[data-bd-trio]{display:flex;gap:8px;padding-top:8px;}
[data-bd-trio]>*{flex:1 1 0%;min-width:0;}
[data-bd-foot]{display:flex;align-items:center;gap:8px;flex-wrap:wrap;}
[data-bd-foot] [data-bd-msg]{flex:1 1 100%;}

/* 「竖排项」：label+note 在上、控件占满整行在下（长文本 / 文本域用）。
   它与 [data-bd-row] 的外间距**完全一样**（同属分节的直接子元素）⇒ 两种形状混着排也齐。
   ⚠️ 这里**不给 gap** —— 文字与控件之间的间距由上面那条
      「[data-bd-label]+[data-bd-note] / +[data-bd-ctl]」统一负责，
      否则这一处又会和别处不一样（这正是上一版"间距不统一"的成因）。 */
[data-bd-field]{display:flex;flex-direction:column;}
[data-bd-ctl]{display:flex;gap:8px;}
[data-bd-ctl]>*{min-width:0;}
/* 控件在竖排项里可以占满（不像行内那样要跟文字抢宽度） */
[data-bd-field] [data-bd-input],[data-bd-field] [data-bd-select]{width:100%;}

/* 🔴 行内的控件**不能 width:100%**（2026-10-16 真机截图抓到的布局 bug）：
   那个 width 会抢满整行宽，把左边的文字列挤到只剩一个字宽
   ⇒ 标题与说明**竖着排成一列字**（截图里「跑在哪」就是那样）。
   ⇒ 行内一律「按内容宽度、可缩、带上下限」，把剩余空间留给文字。
   ⚠️ 本注释里**不能写反引号** —— 它会提前闭合整个 CSS 模板串，
      而且报错指向不相干的词（本文件踩过三次，见库内 a641d97c）。 */
[data-bd-row]>[data-bd-input],[data-bd-row]>[data-bd-select]{width:auto;flex:0 1 auto;
  min-width:104px;max-width:54%;}
[data-bd-row]>[data-bd-num]{width:92px;min-width:92px;max-width:92px;text-align:center;}
/* ⚠️ 行内的按钮**不许被挤到换行**（真机截图抓到过：路径一长，「选择目录」就掉到下一行）。
   ⇒ 给按钮 flex:none（不参与压缩）+ 让左边的文字列自己缩、自己断词。 */
[data-bd-row]>[data-bd-btn]{flex:none;}
[data-bd-row] [data-bd-grow],[data-bd-row] [data-bd-label],[data-bd-row] [data-bd-note]{
  min-width:0;overflow-wrap:anywhere;}

/* ── 文字：官方那两档（标题 14/22 主色，说明 12/18 三级色） ── */
[data-bd-label]{font-size:var(--dsw-font-s-14-font-size,14px);line-height:var(--dsw-font-s-14-line-height,22px);
  color:var(--dsw-alias-label-primary,#0f1115);}
[data-bd-note]{font-size:var(--dsw-font-xxs-12-font-size,12px);line-height:var(--dsw-font-xxs-12-line-height,18px);
  color:var(--dsw-alias-label-tertiary,#81858c);}
[data-bd-note] code{font-size:11px;padding:1px 4px;border-radius:var(--dsw-radius-xs,4px);
  background:var(--dsw-alias-bg-module-platform,#f5f6f7);}
[data-bd-kv]{font-size:var(--dsw-font-xxs-12-font-size,12px);line-height:var(--dsw-font-xxs-12-line-height,18px);
  color:var(--dsw-alias-label-secondary,#61666b);word-break:break-all;}

/* ── 徽章：胶囊，用官方圆角与底色 ── */
[data-bd-badge]{font-size:var(--dsw-font-xxs-12-font-size,12px);line-height:18px;padding:2px 8px;
  border-radius:var(--dsw-radius-sm,8px);white-space:nowrap;
  background:var(--dsw-alias-bg-module-platform,#f5f6f7);
  color:var(--dsw-alias-label-secondary,#61666b);}

/* ── ⭐「正在后台运行…」绿标（2026-10-16 加）──
   它复用了上面那个胶囊徽章的形状（同一个 data-bd-badge），只把颜色换成**绿**，
   所以在顶栏里与「环境已就绪 / B站已登录 / v0.1.3」排在一起是**同一套长相**。
   ⚠️ 但它是个 **button**（可点击）⇒ 要把浏览器给 button 的默认样式全抹掉，
      否则会多出一圈边框、字体也变成系统 UI 字体（与旁边不一致）。
   ⚠️ 绿色用 **state-success 令牌**（不是写死 #0f0）：换主题/暗色时它跟着变。
   ⭐ 小圆点用伪元素画 —— 一眼看出"活着"，且不用额外 DOM。 */
[data-bd-badge][data-bd-run]{border:none;font-family:inherit;cursor:pointer;
  display:inline-flex;align-items:center;gap:6px;
  background:color-mix(in srgb, var(--dsw-alias-state-success-primary,#22c55e) 14%, transparent);
  color:var(--dsw-alias-state-success-primary,#22c55e);}
[data-bd-badge][data-bd-run]:before{content:'';width:6px;height:6px;border-radius:50%;
  background:currentColor;flex:none;}
[data-bd-badge][data-bd-run]:hover{background:color-mix(in srgb, var(--dsw-alias-state-success-primary,#22c55e) 22%, transparent);}

/* ── ⭐「检测到有新版本」黑底白字胶囊（2026-10-18 加）──
   使用者要求：「以同样的样式提示用户【检测到有新版本】用黑底白字，可点击」。
   ⚠️ **同样的样式** = 与前面三个徽章**同尺寸同圆角同字号**（都走 [data-bd-badge]），
      只把配色换成**黑底白字**（跟"绿标"同一个思路：形状一样、颜色区分性质）。
   ⚠️ 黑底用 label-primary 那个令牌（官方近黑 #0f1115），不是写死 #000 ——
      暗色主题下它会自动变成浅色底深字，否则黑底在深色背景上看不见。
   ⚠️ 它是 button ⇒ 要抹掉浏览器默认样式（同 [data-bd-run] 那套理由）。 */
[data-bd-badge][data-bd-new]{border:none;font-family:inherit;cursor:pointer;
  background:var(--dsw-alias-label-primary,#0f1115);color:#fff;}
[data-bd-badge][data-bd-new]:hover{opacity:.86;}
/* ⚠️ 暗色主题下 label-primary 是**浅色**，白字会看不见 ⇒ 此时把字色反过来 */
@media (prefers-color-scheme: dark){
  [data-bd-badge][data-bd-new]{color:var(--dsw-alias-bg-base,#111);}
}

/* ── 子区块（开关打开后展开的那些）──
 *
 * 🔴 **不再缩进、也不再画左侧竖线**（2026-10-16 使用者要求："去掉这种缩进，不要他"）。
 *    旧写法是 margin-left:6px / padding-left:12px / border-left:2px solid …
 *    ⇒ 展开项被推进去一截、左边多一条灰线，跟官方「平铺 + 细分隔线」的观感不一致。
 *
 * ⚠️ **这里也不再自带 border-top**：它的每一行都已被上面那条「唯一规则」
 *    给了 16px 上下留白 + 底线 ⇒ 展开块的边界本来就清楚。
 *    再加一条顶线只会和「开关那一行的底线」贴成**双线**。
 */
[data-bd-sub]{display:flex;flex-direction:column;}

/* ── 输入类：统一高度/圆角/描边，聚焦用官方焦点环 ── */
[data-bd-input],[data-bd-select]{width:100%;box-sizing:border-box;padding:7px 12px;
  border-radius:var(--dsw-radius-sm,8px);font-family:inherit;
  font-size:var(--dsw-font-xxs-12-font-size,12px);line-height:18px;
  border:1px solid var(--dsw-alias-border-l3,#0000001f);
  background:var(--dsw-alias-bg-layer-1,#fff);color:var(--dsw-alias-label-primary,#0f1115);}

/* ── 下拉：**不用原生箭头，自绘一个 chevron**（2026-10-16 使用者指出：
 *    "所有的下拉…这个下箭头离右边太近了，应该和左边的间隔差不多才对吧，现在就很难看"）。
 *
 * 🔴 根因：原生 '<select>' 的下拉箭头**位置由浏览器定**（贴着右边缘），
 *    CSS 里只能靠 'padding-right' 把它"推"进来一点点，**控不准、也不对称**。
 *    官方那套（.xxx_selector）是 'appearance:none' + 自己画图标：
 *      'gap:12px; padding:0 14px; height:36px; border-radius:var(--dsw-radius-md)'
 *    —— 左右内距**完全对称**，箭头是 flex 里的一个独立元素。
 *
 * ⭐ 这里用同一个思路，但**保持我们自己的尺寸**（面板窄，不做 36px 高）：
 *    'appearance:none' 去掉原生箭头，用 'background-image' 画一个 SVG chevron，
 *    位置用 'background-position: right 10px center' 与左边内距**对称**。
 *    ⚠️ 'padding-right' 要留出箭头的位置（10 + 图标宽 16 + 一道间距 ≈ 36），
 *       否则长文字会压到箭头上。
 *    ⚠️ 图标用 'stroke=%2381858c'（label-tertiary）—— **SVG 在 data-URI 里拿不到 CSS 变量**，
 *       只能写死颜色；选了中性灰，亮/暗色下都看得见。
 *
 * 🔴🔴 **选择器必须按【元素名】写，不能只写 [data-bd-select]**（2026-10-16 我在这儿栽过）：
 *    这个面板里 **7 个 <select> 只有 3 个挂 data-bd-select**，另外 4 个挂的是
 *    'data-bd-input'（那是"输入类"的通用属性，select 也复用了它）。
 *    ⇒ 只写 [data-bd-select] 的结果是**只改了模型那三个**，别处四个下拉还是原生箭头
 *      —— 使用者一眼就看出来了（"我是说所有的下拉列表，你都去改一下啊"）。
 *    ⇒ 正解：select[data-bd-input], [data-bd-select] —— **按元素类型匹配**，
 *      这样不管它挂哪个属性都被覆盖，以后多加一个下拉也不会漏。
 *    ⚠️ 同理，下面的 :focus 与后续任何"只对 select 生效"的规则都要用这个组合选择器。
 */
select[data-bd-input],[data-bd-select]{cursor:pointer;appearance:none;-webkit-appearance:none;
  padding-right:36px;
  background-image:url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 16 16' fill='none'%3E%3Cpath d='M4 6.5L8 10.5L12 6.5' stroke='%2381858c' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
  background-repeat:no-repeat;
  background-position:right 10px center;
  background-size:16px 16px;}
/* ⚠️ 上面这条要写在通用规则**之后**：它覆盖 padding 与 background-image，
   顺序反了就被通用那条盖掉（这两条权重相同）。 */
[data-bd-input]:focus,[data-bd-select]:focus{outline:none;
  border-color:var(--dsw-focus-ring-color,var(--dsw-alias-brand-primary,#0f1115));}
[data-bd-input]::placeholder{color:var(--dsw-alias-label-tertiary,#81858c);}
[data-bd-num]{width:92px;text-align:center;}
[data-bd-persona]{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
  line-height:1.55;resize:vertical;min-height:120px;}

/* ── 确认浮层（「恢复默认」那种破坏性操作）──
   ⚠️ 用 position:fixed（常规模态）而不是 absolute —— absolute 会**跟着内容滚**：
      这个面板的祖先是个 overflow:auto 滚动容器，inset:0 会铺满整个**可滚区域**
      （比视口高得多）⇒ 浮层被撑开、还可能滚出视野。
   ⚠️ 背景用**半透明黑**，不用模糊：省一层合成，也避开"祖先有 backdrop-filter 时
      fixed 会退化成相对该祖先定位"那个坑（库内记过）。
   ⚠️ 若在真机上发现它被限制在某个祖先里（就是上面那个坑），改成在 JS 里量面板 rect。 */
[data-bd-confirm]{position:fixed;inset:0;z-index:60;display:flex;
  align-items:center;justify-content:center;padding:16px;
  background:rgba(0,0,0,.38);}
[data-bd-confirm-box]{width:min(86vw,320px);border-radius:var(--dsw-radius-md,12px);
  background:var(--dsw-alias-bg-base,#fff);padding:16px;
  box-shadow:0 8px 28px rgba(0,0,0,.22);display:flex;flex-direction:column;gap:10px;}
[data-bd-confirm-title]{font-size:var(--dsw-font-s-14-font-size,14px);font-weight:600;
  line-height:22px;color:var(--dsw-alias-label-primary,#0f1115);}
[data-bd-confirm-body]{font-size:var(--dsw-font-xxs-12-font-size,12px);line-height:18px;
  color:var(--dsw-alias-label-secondary,#61666b);}
[data-bd-confirm-foot]{display:flex;justify-content:flex-end;gap:8px;}
/* ⚠️ 危险动作：用官方那个"警示"色（琥珀），别写死红色 —— 主题换色时红色会很突兀 */
[data-bd-btn][data-danger]{border-color:var(--dsw-alias-state-warn-primary,#f0a020);
  color:var(--dsw-alias-state-warn-primary,#f0a020);}

/* ── 按钮：主要动作 = 官方主按钮色（近黑），次要 = 描边 ── */
[data-bd-btn]{padding:7px 12px;border-radius:var(--dsw-radius-sm,8px);cursor:pointer;font-family:inherit;
  font-size:var(--dsw-font-xxs-12-font-size,12px);line-height:18px;white-space:nowrap;
  border:1px solid var(--dsw-alias-border-l3,#0000001f);
  background:var(--dsw-alias-bg-module-platform,#f5f6f7);
  color:var(--dsw-alias-label-primary,#0f1115);transition:background .15s;}
[data-bd-btn]:hover:not([disabled]){background:var(--dsw-alias-interactive-bg-hover,#2631480f);}
[data-bd-btn][data-primary]{background:var(--dsw-alias-button-primary-fill,#0f1115);
  border-color:var(--dsw-alias-button-primary-fill,#0f1115);
  color:var(--dsw-alias-label-primary-inverted,#fff);}
[data-bd-btn][data-primary]:hover:not([disabled]){background:var(--dsw-alias-button-primary-hover,#43454a);
  border-color:var(--dsw-alias-button-primary-hover,#43454a);}
[data-bd-btn][disabled]{opacity:.45;cursor:default;}

/* ── 开关：官方品牌色（近黑），不是蓝 ── */
[data-bd-sw]{flex:none;width:38px;height:22px;border-radius:11px;padding:0;cursor:pointer;position:relative;
  border:1px solid var(--dsw-alias-border-l3,#0000001f);
  background:var(--dsw-alias-interactive-bg-hover,#2631480f);transition:background .15s;}
[data-bd-sw][data-on]{background:var(--dsw-alias-brand-primary,#0f1115);
  border-color:var(--dsw-alias-brand-primary,#0f1115);}
[data-bd-sw] i{position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;
  background:var(--dsw-alias-switch-thumb,#fff);transition:left .15s;display:block;
  box-shadow:var(--dsw-shadow-lv1,0 2px 4px 0 #0000000d);}
[data-bd-sw][data-on] i{left:18px;}
[data-bd-sw][disabled]{opacity:.45;cursor:default;}

/* ── 时间点行里的 input[type=time] 与「删除」图标按钮（2026-10-19 加）
   ⚠️ 那个 input 同时挂了 data-bd-input（复用基础样式）和 data-bd-grow（撑满剩余宽度）
      ⇒ 右侧的开关与删除按钮**始终贴右边缘**，横向对齐不靠逐个调 margin。
   ⚠️ 只调**内部**（字体/内边距），**不写 margin** —— 行间距由结构规则统一给。 */
input[type="time"][data-bd-input]{min-width:0;font-family:inherit;}
input[type="time"][data-bd-input]::-webkit-calendar-picker-indicator{opacity:.55;cursor:pointer;}

/* ── 时间点行：小时/分钟两个数字框 + 中间的冒号（2026-10-19）
   ⚠️ 不用原生 input[type=time] —— 那个的 12/24 制跟系统区域设置走，
      DOM 上的 lang 改不了它（实测真机仍显示上午/下午）。

   🔴 三个必须覆盖的规则（都是被通用规则坑出来的）：
   ① **flex-direction:row** —— 该元素同时挂了 data-bd-grow，
      而通用规则是 display:flex + flex-direction:column（用于"标题上、控件下"）
      ⇒ 不覆盖就**竖排**（冒号和两个框上下叠）。
   ② **flex:none（只占内容宽度）** —— ⚠️ 这里**不要**让它 flex:1 吃剩余空间！
      要让"吃掉剩余空间"的是 **X 与开关之间那个空 [data-bd-spacer]**，
      这样 X 才会紧跟着时间框（使用者要求："X 要跟着时间设置，不靠右"），
      而开关仍被推到最右。两件事各由一个元素负责，不会互相牵制。
      ⚠️ 我先后写错过两次：flex:none ⇒ 开关贴时间框；flex:1 ⇒ X 贴开关。
   ③ 两个 input 固定 46px —— data-bd-num 的默认 92px 太宽，
      两个就 184px，窄侧栏里会把 X 挤出行外。 */
[data-bd-time]{display:flex !important;flex-direction:row !important;align-items:center;
  flex:0 0 auto !important;gap:6px;min-width:0;}
[data-bd-time] input[type="number"]{width:46px !important;min-width:46px !important;
  max-width:46px !important;flex:none;text-align:center;padding-left:4px;padding-right:4px;
  -moz-appearance:textfield;appearance:textfield;}
/* 去掉 number 的上下箭头（窄框里它们会把数字挤没了） */
[data-bd-time] input[type="number"]::-webkit-outer-spin-button,
[data-bd-time] input[type="number"]::-webkit-inner-spin-button{-webkit-appearance:none;margin:0;}
[data-bd-time-sep]{flex:none;color:var(--dsw-alias-label-tertiary,#81858c);font-size:13px;line-height:20px;}

/* 删除按钮：**无外框、无底色**，只有一个大一点的 ×。
   ⚠️ 必须**显式清掉** [data-bd-btn] 基础样式给的 border 与 background
      （基础样式是 padding 7px 12px + 描边 + 浅底）⇒ 否则会是一个带框小方块。

   ⭐ × 是**内联 SVG 的两条对角线**（见下面那段 JSX），不用字符 ×：
      字符的字形随字体变（粗细/端点/倾斜角都不受控），
      而使用者要的是"互相垂直的那种" —— 两条 45° 线交叉、端点圆头、粗细一致。
   🔴 那段 SVG 的属性名**必须是 React 驼峰**（strokeWidth / strokeLinecap / viewBox）：
      写成连字符（stroke-width）会被 React 丢弃 ⇒ stroke 无值 ⇒ **X 透明看不见**（真机踩过）。
   ⚠️ stroke 用 currentColor ⇒ 颜色跟按钮走，hover 变色自动生效。

   ⚠️ 尺寸 30px 是为了与开关（22px 高）在同一行**垂直居中**，不是随手给的。 */
[data-bd-btn][data-bd-icon]{flex:none;width:30px;height:30px;padding:0;
  display:inline-flex;align-items:center;justify-content:center;
  border:0;background:none;border-radius:var(--dsw-radius-sm,8px);
  color:var(--dsw-alias-label-tertiary,#81858c);transition:color .15s,background .15s;}
[data-bd-btn][data-bd-icon]:hover{color:var(--dsw-alias-state-warn-primary,#f0a020);
  background:var(--dsw-alias-interactive-bg-hover,#2631480f);}
/* 图标尺寸：跟着按钮的 currentColor 走，不用单独写颜色 */
[data-bd-btn][data-bd-icon] svg{width:18px;height:18px;display:block;}

/* ── 提示条：**浮现式 toast**（2026-10-16）
 *
 * 🔴 改之前：提示是**塞在面板里的整块绿条**（runNote / msg / personaMsg 各占一行）
 *    ⇒ ① 它自己**占排版**，弹一条就把下面的设置往下推、点一次跳一下；
 *      ② 只有当前滚动到的地方看得见，别处触发的提示等于白弹。
 *
 * ⭐ 现在：**浮在面板正中偏下**、**不吃排版**、2.6 秒自动消失（见 say()）。
 *
 * 🎨 **样式不沿用它自己那套官方配色**（2026-10-16 使用者要求：
 *    "不用沿用他之前的风格，就最常见的圆角黑底白字，黑底半透明的那种"）
 *    ⇒ 半透明黑底 + 白字 + 圆角 + 一点模糊，就是最常见那种 toast。
 *
 * 📍 **位置**：横向在**面板**中心、纵向在**屏幕 2/3 处**（= 距屏幕底部 1/3 屏高）。
 *    这两个尺子不一样，必须靠 JS 量（见 say() 的注释）——
 *    面板只是屏幕右半边，纯 CSS 的 50% 会落到聊天区。
 *    ⚠️ 这里 CSS 里的 50% / 66.7% 只是**兜底**（JS 量不到时用）：
 *      absolute 会被面板那个**滚动容器**带着滚走，所以用 fixed。
 *    ⚠️ transform 是 -50%,-50%（以 JS 给的坐标为**中心**），与那边算法配套。
 */
[data-bd-toast]{position:fixed;z-index:9999;pointer-events:none;
  left:50%;top:66.667%;transform:translate(-50%,-50%);
  max-width:min(78%,440px);display:flex;justify-content:center;}
[data-bd-toast]>div{
  font-size:var(--dsw-font-xxs-12-font-size,12px);line-height:18px;
  padding:9px 16px;border-radius:10px;text-align:center;word-break:break-word;
  color:#fff;background:rgba(0,0,0,.78);
  -webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px);
  box-shadow:0 6px 20px rgba(0,0,0,.22);
  animation:bd-toast-in .16s ease-out;}
@keyframes bd-toast-in{from{opacity:0;transform:translateY(6px) scale(.96);}to{opacity:1;transform:none;}}

/* 旧的「占排版的提示条」还留着 —— 少数地方需要**常驻**（比如二维码过期、
   安装日志这种要看一会儿的），那些仍用 data-bd-msg。 */
[data-bd-msg]{font-size:var(--dsw-font-xxs-12-font-size,12px);line-height:18px;padding:8px 10px;
  border-radius:var(--dsw-radius-sm,8px);word-break:break-word;
  background:var(--dsw-alias-bg-module-platform,#f5f6f7);color:var(--dsw-alias-label-secondary,#61666b);}
[data-bd-msg][data-good]{color:var(--dsw-alias-state-success-primary,#22c55e);}
[data-bd-msg][data-warn]{color:var(--dsw-alias-state-warn-primary,#f59e0b);}

/* ── 二维码 ── */
[data-bd-qr]{display:flex;gap:14px;align-items:flex-start;}
[data-bd-qr] img{width:150px;height:150px;border-radius:var(--dsw-radius-md,12px);background:#fff;padding:6px;}

/* ── 日志块 ── */
[data-bd-pre]{margin:0;padding:10px;border-radius:var(--dsw-radius-sm,8px);max-height:180px;
  overflow:auto;font-size:11px;line-height:16px;white-space:pre-wrap;word-break:break-all;
  background:var(--dsw-alias-bg-module-platform,#f5f6f7);color:var(--dsw-alias-label-secondary,#61666b);}

/* ── 弹窗里的「更新内容」正文（2026-10-18 加）──
   它复用 [data-bd-pre] 的样子，但要**更高一点**：更新日志比日志块长得多，
   180px 只能看到两三行 ⇒ 单独把上限提到 46vh（视口的 46%，不撑破弹窗）。
   ⚠️ white-space:pre-wrap 由 [data-bd-pre] 那份给了 —— 这里**不要**重复写，
      也**不要**改成 nowrap：正文的换行就是 readability 的一部分。 */
[data-bd-pre][data-bd-clog]{max-height:46vh;font-size:12px;line-height:18px;word-break:normal;}
`

    // ⚠️ 与 lib/state.mjs 的 WINDOWS 保持一致（官方口径：工作日 9–12、14–18 是高峰，其余都是谷时）
    const DEFAULT_WINDOWS = {
      noon: { label: '中午谷时', start: '12:00', end: '14:00' },
      night: { label: '晚上/夜间谷时', start: '18:00', end: '09:00' },
    }

    /* ────────────── 小组件 ────────────── */

    function Switch({ on, onChange, disabled }) {
      return h('button', {
        'data-bd-sw': '',
        'data-on': on ? '' : undefined,
        disabled: Boolean(disabled),
        title: on ? '已开' : '已关',
        onClick: () => { if (!disabled) onChange(!on) },
      }, h('i'))
    }

    function ToggleRow({ label, note, on, onChange, disabled }) {
      return h('div', { 'data-bd-row': '' },
        h('div', { 'data-bd-grow': '' },
          h('div', { 'data-bd-label': '' }, label),
          note ? h('div', { 'data-bd-note': '' }, note) : null),
        h(Switch, { on, onChange, disabled }))
    }

    /**
     * ⭐ **一个设置项 = 一个行容器**（2026-10-16 加，修「间隔全都不统一」的结构病根）
     *
     * 🔴 **为什么需要它**：原来的面板里，一个设置项有时写成
     *    `label` + `控件` **两个平级子元素**（比如「关注什么」是一个 label 加一个 textarea）。
     *    而间距是按「分节的直接子元素」给的 ⇒ **一项被拆成两行、各画一条分隔线**，
     *    看起来就像两个不相干的设置项；另一些项（ToggleRow）又自带行包装 ⇒ 间距对不上。
     *
     * ⇒ 用它把所有项包成**同一个形状**：
     *    · `row`    —— 一行：左边 label+note，右边控件（开关 / 数字 / 下拉）
     *    · `stack`  —— 一行：label+note 在上，控件占满整行在下（长文本 / 文本域用）
     *    两条路的**外间距完全一样**（都由 CSS 那条「唯一规则」给），所以怎么混都齐。
     *
     * ⚠️ 别在调用处再写 padding/margin —— 那正是上一版乱掉的原因。
     */
    function Field({ label, note, children, stack }) {
      const text = h('div', { 'data-bd-grow': '' },
        h('div', { 'data-bd-label': '' }, label),
        note ? h('div', { 'data-bd-note': '' }, note) : null)
      if (stack) {
        return h('div', { 'data-bd-field': '' },
          h('div', { 'data-bd-label': '' }, label),
          note ? h('div', { 'data-bd-note': '' }, note) : null,
          h('div', { 'data-bd-ctl': '' }, children))
      }
      return h('div', { 'data-bd-row': '' }, text, children)
    }

    /* ════════ 面板界面状态：跨会话共享（2026-10-20 加）════════
     *
     * 🔴 **为什么要做**（使用者的原话）：
     *    「右侧栏是跟会话的。可能会导致不同页面面板的设置显示不一样，
     *      搞得用户也弄不清楚到底设置的是啥。应该要保持统一，不跟会话。」
     *
     * ── 根因（DSH 的架构，不是我们的 bug）──────────────
     *   右侧栏的停靠面是**按会话存的**（`bySession[sessionId]`）：
     *     · 没开过右栏的会话是空的；
     *     · **同一个面板在不同会话是各自实例**；
     *     · 切到新会话时面板是**新建**的 ⇒ 内存里的 state 回到默认值。
     *    ⇒ 看起来就像「设置跟着会话变」。
     *
     * ── 但"看起来一份"做得到（不改内核）──────────────
     *    ⭐ **真正的配置本来就只有一份**（`config.json`）：
     *      面板每 5 秒轮询 `/status`，所以**配置值**其实会在 5 秒内自动对齐。
     *    ⚠️ 真正"不一样"的是**纯界面状态**：
     *       · 当前在第几个标签页（`tab`）；
     *       · 输入框里的**本地草稿**（`mention` / `kws` 那些，还没提交的）。
     *
     * ── 做法（照 memj 插件验证过的那套）──────────────────
     *    · **localStorage 存一份共享**（新面板启动时"收养"它）；
     *    · **BroadcastChannel 广播**（别的面板改了 ⇒ 这边立刻跟上）；
     *    · ⚠️ **应用"来自别处"的状态期间要置标志、不广播** ——
     *      否则 A→B→A 来回弹（memj 那条知识里明写的坑）。
     *
     * ⚠️ 只共享**界面**状态，**不共享服务端配置**（那个本来就只有一份，
     *   再存一份到 localStorage 反而会跟轮询打架）。
     */
    const UI_SHARE_KEY = 'bili-scroll-jojo/ui-state'
    const UI_SHARE_CH = 'bili-scroll-jojo/ui'

    /** 读共享状态（读不到/坏了都返回 {}，绝不抛） */
    const readSharedUI = () => {
      try {
        const raw = localStorage.getItem(UI_SHARE_KEY)
        if (!raw) return {}
        const o = JSON.parse(raw)
        return o && typeof o === 'object' ? o : {}
      } catch { return {} }
    }

    /**
     * 写共享状态 + 广播。
     * @param patch 要合并进去的字段（只写这几个，别整份替换 —— 多面板并发时整份会互相踩）
     */
    const writeSharedUI = (patch) => {
      try {
        const next = { ...readSharedUI(), ...patch, at: Date.now() }
        localStorage.setItem(UI_SHARE_KEY, JSON.stringify(next))
        // ⚠️ 广播失败不能影响界面（某些环境没有 BroadcastChannel）
        try { uiChannel?.postMessage(next) } catch { /* 忽略 */ }
      } catch { /* 存储不可用（隐私模式/配额满）也不能崩 */ }
    }

    /**
     * 共享通道。**模块级单例** —— 每个面板实例都在同一个 document 里，
     * 但各会话的面板是独立 React 树；用 BroadcastChannel 让它们互相同步。
     * ⚠️ 没有 BroadcastChannel 的环境下退化成"只有 localStorage"（切过去才生效）。
     *
     * 🔴🔴 **必须 `unref()`**（2026-10-20 CI 真卡死，等了 20 分钟超时）。
     *
     * ── 症状 ──────────────────────────────────────────────
     *   发布流水线停在「本地预检」那一步、`updated_at` 再也不动；
     *   而日志里**已经打到最后一行**了（`（预检不碰真家目录…）`）。
     *   ⇒ 说明 **selfcheck 跑完了、但 Node 进程不退出**。
     *
     * ── 根因 ──────────────────────────────────────────────
     *   我在模块顶层 `new BroadcastChannel(...)`，而 **BroadcastChannel 会保持
     *   事件循环活跃** ⇒ Node 进程**永不退出**（实测：`node -e "new BroadcastChannel('x')"`
     *   打印完就一直挂着；加 `unref()` 才正常退）。
     *   `selfcheck.mjs` 会 import 这个文件并执行 `apply()` ⇒ 被一起挂死。
     *
     * ⚠️ 只判断 `typeof BroadcastChannel === 'function'` 不够 —— **Node 22 也有它**，
     *    所以"有就建"在服务端预检里也会命中。
     * ✅ 正解：建完立刻 `unref()`（浏览器里是 no-op，不影响同步能力）。
     */
    let uiChannel = null
    try {
      if (typeof BroadcastChannel === 'function') {
        uiChannel = new BroadcastChannel(UI_SHARE_CH)
        // ⚠️ 关键：让通道**不阻止进程退出**。
        //    浏览器里没有 unref，用可选调用兜住；Node 里这是必需的。
        try { uiChannel.unref?.() } catch { /* 浏览器里没有 unref，忽略 */ }
      }
    } catch { uiChannel = null }

    /**
     * ⭐ **「后台跑要用哪个 dsh」那一块** —— 抽成纯函数（2026-10-18）。
     *
     * 为什么抽出来（两个理由，都实在）：
     *  ① 使用者原话：「这个没有办法自动获取的吗？如果有的话，这个东西是不应该让用户自己设置的啊」
     *     ⇒ 这块的**核心任务是"报告自动探测的结果"**，输入框只是探测失败时的兜底。
     *  ② 原来它是内联在 Panel 里的一坨 IIFE ⇒ **测不了**（组件内部自己 fetch，SSR 拿不到 st）。
     *     抽成纯函数之后，`tmp-probe-ui.mjs` 能把 5 个分支逐个渲染出来验。
     *
     * @param st   `/status` 的响应（`st.dsh` 是后端算的探测结果；旧版宿主没有这个字段）
     * @param cfg  配置（只看 `dshBin`）
     * @param ui   `{ draft, setDraft, patch }` —— 输入框的草稿与落盘
     */
    function renderDshBlock(st, cfg, ui) {
      const d = st && st.dsh
      const saved = String((cfg && cfg.dshBin) || '').trim()
      const draft = ui && ui.draft
      /**
       * 三种情形分开显示：
       *   ① 探测成功 ⇒ 只说"自动找到 X"，**不出现输入框**（绝大多数人都停在这里）；
       *   ② 探测失败 ⇒ 明说失败 + 给输入框让它手动指；
       *   ③ `st.dsh` 读不到（旧版宿主还没重启）⇒ **不说成"失败"** —— 那会让人去改
       *      一个根本不需要改的设置。🔴 ③ 与 ② 必须分开。
       */
      const head = (() => {
        if (!d) {
          return h('div', { 'data-bd-note': '' },
            '（这一版面板拿不到自动探测的结果 —— 宿主那边要重启一次才会给。）')
        }
        if (d.ok) {
          // 让使用者知道"它是怎么自己找到的"，而不是只看到一个路径
          const VIA = {
            argv: '它自己就住在这个 dsh 里，所以不用配',
            asar: '桌面版内置的那份 dsh（自动找到的）',
            cfg: '按你填的路径',
            guess: '在常见的全局安装位置上找到的',
          }
          return h('div', null,
            h('div', { 'data-bd-msg': '', 'data-good': '' }, '✓ 已自动找到，不用你设置'),
            h('div', { 'data-bd-note': '' },
              (VIA[d.via] || '自动探测') + (d.electron ? '（桌面版：会带上 ELECTRON_RUN_AS_NODE）' : '')),
            h('div', { 'data-bd-kv': '' }, d.bin || ''),
            // 只有"这个值不是自动来的"才多解释一句 —— 免得它以为是自己配的
            d.via === 'cfg'
              ? h('div', { 'data-bd-note': '' }, '这一条是按你填的路径用的。清空下面的输入框就会回到自动探测。')
              : null)
        }
        return h('div', null,
          h('div', { 'data-bd-msg': '', 'data-warn': '' }, '✗ 自动探测没成功 —— 需要你指一下'),
          h('div', { 'data-bd-note': '' }, String(d.error || '')))
      })()

      /**
       * 输入框**只在需要手填时才出现**：
       *   · 探测失败 ⇒ 一定要给（否则没别的办法）；
       *   · 已经填过 ⇒ 也要给（否则想改 / 想清空都做不到）。
       * 其余情况（探测成功 + 没填过）⇒ **一个字都不显示**。
       */
      const needInput = (d && !d.ok) || saved.length > 0
      const input = needInput
        ? h(Field, {
          label: '手动指定（一般用不到）',
          note: '填 <dsh 安装目录>\\lib\\bin.js 的完整路径。清空 = 回到自动探测。改完即时生效，不用重启。',
          stack: true,
          children: h('input', {
            'data-bd-input': '', type: 'text',
            placeholder: '例如 C:\\...\\npm-global\\node_modules\\@deepseek-ai\\dsh\\lib\\bin.js',
            value: draft ?? saved,
            onChange: (e) => ui.setDraft(e.target.value),
            onBlur: () => {
              const v = String(draft ?? saved).trim()
              ui.setDraft(v)
              ui.patch({ dshBin: v }, 'dsh 启动器路径')
            },
          }),
        })
        : null

      return h('div', { 'data-bd-sec': '', 'data-bd-tabin': 'env' },
        h('div', { 'data-bd-h': '' }, '后台跑要用哪个 dsh'),
        head,
        input)
    }

    /**
     * ⭐ **「关注什么」这一项** —— 抽成纯函数（2026-10-18），理由与 `renderDshBlock` 同：
     *  组件内部拿不到 st（要 effect + fetch），离线渲染测不了分支；
     *  抽出来之后 `tmp-probe-ui2.mjs` 能把两种模式各渲染一次、逐条比对文案。
     *
     * 两种模式的**语义差别**（不只是控件不同）：
     *   · 一行一个（默认）= 好几件**独立**的事，模型逐行拆搜索词；
     *   · 自由描述         = **一段话**，模型先读懂"几件事 / 是什么事"，
     *                        能表达**账号**、**排除条件**、**背景** —— 一行一个写不了。
     *
     * ⚠️ 它只返回**这一项**（Field + 可选的说明），**不含分节外壳** ——
     *    分节里还有「按什么排序」等几项，那些与模式无关、留在外面。
     *
     * @param cfgState `{ freeformWatch, watchNote }`（来自 `/status` 的 config）
     * @param ui       `{ kws, setKws, kwMode, setKwMode, patch, watchDraft, setWatchDraft, onSaveWatch }`
     */
    function renderWatchBlock(cfgState, ui) {
      const free = Boolean(cfgState && cfgState.freeformWatch)
      const kwMode = ui.kwMode
      return h(React.Fragment, null,
        free
          // ── 自由描述模式 ──
          ? h(Field, {
            label: '关注什么（随便写，一段话就行）',
            note: '不用分行、不用列点。模型会自己读懂你要关注几件事、每件是什么。'
              + '也能写「顺便看看某位 UP 主」「不要入门教程那种」「最近在搞 RAG」这类 —— '
              + '账号和主题它会分开处理。',
            stack: true,
            children: h('textarea', {
              'data-bd-input': '', rows: 6,
              placeholder: '例：\n最近在看大模型相关的论文解读和工程实践，特别是 RAG 和多智能体。\n'
                + '顺便关注一下「闲人JOJO」这个 UP 主的更新。\n入门教程那种就别给我了。',
              value: ui.watchDraft ?? '',
              onChange: (e) => ui.setWatchDraft(e.target.value),
              onBlur: ui.onSaveWatch,
            }),
          })
          // ── 一行一个（原来的写法）──
          : h(Field, {
            label: '关注什么（一行一个）',
            stack: true,
            children: h('textarea', {
              'data-bd-input': '', rows: 5,
              placeholder: '一行一个主题；留空用内置那几组\n例：\n有关大模型的论文\nDSH 插件',
              value: ui.kws ?? '', onChange: (e) => ui.setKws(e.target.value),
            }),
          }),

        /*
         * ⚠️ **「这些字怎么用」那个下拉只在「一行一个」模式下出现**。
         * 为什么：自由描述**本来就隐含"让模型自己组合搜索词"**（那正是它的用法），
         * 再暴露成「当主题 / 当现成搜索词」会让人困惑 ——
         * 而且「当现成搜索词」对一段话**根本没有意义**（没有"每行"这回事）。
         */
        free
          ? h('div', { 'data-bd-note': '' },
            '它会拿这段话自己去组合搜索词、分批搜（跟原来的「当主题」一个路子）—— '
            + '你写的是想关注什么，不是搜索词。')
          : h(Field, {
            label: '这些字怎么用',
            note: kwMode === 'fixed'
              ? '每行会原样当搜索词。宽泛的词（如「有关大模型的论文」）搜回来多半是入门教程和水论文技巧。'
              : '模型会按这些主题自己编几个更具体的搜索词、一轮里换 3~5 组去搜，攒够候选才开始筛。',
            stack: true,
            children: h('select', {
              'data-bd-input': '', value: kwMode ?? 'llm',
              onChange: (e) => { ui.setKwMode(e.target.value); ui.patch({ keywordMode: e.target.value }, '关键词用法') },
            },
              h('option', { value: 'llm' }, '当「主题」—— 让模型自己组合出多种搜索词（推荐）'),
              h('option', { value: 'fixed' }, '当「现成搜索词」—— 每行原样拿去搜')),
          }),
      )
    }

    /**
     * ⭐ **顶栏那一排徽章**（状态 + 版本 + 新版本 + 后台运行）—— 抽成纯函数（2026-10-18）。
     *
     * 为什么抽：与 `renderDshBlock` / `renderWatchBlock` 同一个理由 ——
     *   组件内部拿不到 `st`（要靠 effect + fetch），离线渲染**测不了分支**；
     *   而"有新版本"这条分支在真机上要等真出新版才看得到 ⇒ **不抽出来就永远没验过**。
     *
     * 顺序（使用者要求「后台任务提示往后挤」）：
     *   ① 环境  ② B站登录  ③ 版本号  ④ **新版本标**  ⑤ **后台运行标**
     * ⚠️ **间隔统一靠 `[data-bd-top]` 的 `gap:8px`**（父容器管），
     *    这里**不要**给任何徽章单独写 margin —— 那会破坏"和前面几个块保持统一"。
     *
     * @param st     `/status` 响应
     * @param onOpen 点「检测到有新版本」时的回调（打开弹窗）
     * @param onRunLog 点「正在后台运行…」时的回调（默认走 say，测试时可注入）
     */
    function renderVersionBadges(st, onOpen, onRunLog) {
      const showRun = (msg, tone) => {
        if (typeof onRunLog === 'function') return onRunLog(msg, tone)
        return undefined
      }
      return h(React.Fragment, null,
        h('span', { 'data-bd-badge': '' }, '环境' + (st.venvReady ? '已就绪' : (st.installing ? '正在装' : '未装'))),
        h('span', { 'data-bd-badge': '' }, st.loggedIn ? 'B站已登录' : 'B站未登录'),
        h('span', { 'data-bd-badge': '' }, 'v' + (st.version || '?')),
        /**
         * ⭐⭐ **「检测到有新版本」黑底白字胶囊**（2026-10-18 加，使用者要求）。
         *   · 位置：**紧跟版本号**（它是"版本相关"的提示）
         *   · `st.update` 为 null（还没查过）⇒ 什么都不显示，**不要闪"检查中"**
         *   · 只在真有新版时出现（不常驻"已是最新"）
         */
        st.update?.hasNew
          ? h('button', {
            'data-bd-badge': '', 'data-bd-new': '', type: 'button',
            title: '有新版本，点一下看怎么升',
            onClick: () => { if (typeof onOpen === 'function') onOpen() },
          }, '检测到有新版本')
          : null,
        // ⭐ 「正在后台运行…」绿标（2026-10-16）。**2026-10-18 起排在新版本标之后**。
        st.headless?.running
          ? h('button', {
            'data-bd-badge': '', 'data-bd-run': '', type: 'button',
            title: '点一下看日志在哪',
            onClick: () => showRun(
              '正在后台跑 —— 日志：' + (st.log || '（读不到路径）')
              + '（用「打开家目录」按钮能找到它；跑完这个标会自己消失）', 'good'),
          }, '正在后台运行…')
          : null,
      )
    }


    function useStatus(intervalMs) {
      const [st, setSt] = React.useState(null)
      React.useEffect(() => {
        let alive = true
        const tick = async () => {
          try {
            const d = await jget('/status')
            if (alive && d?.ok) setSt(d)
          } catch { /* 网络抖动就下次再问 */ }
        }
        tick()
        const t = setInterval(tick, intervalMs || 5000)
        return () => { alive = false; clearInterval(t) }
      }, [intervalMs])
      return [st, setSt]
    }

    /* ────────────── 设置页正文 ────────────── */

    function Panel(props) {
      // ⭐ 跳会话的能力由 apply() 注入。**传的是解析函数**（点击时才取服务）——
      //    因为 `uiWorkspace` 是异步 inject 上来的，按值捕获会拿到 null（真机踩过）。
      //    解析不出来返回 null ⇒ 面板**如实显示"这个环境不支持跳转"**，而不是点了没反应。
      const resolveOpenSession = (props && props.resolveOpenSession) || (() => null)
      // ⚠️ **`doPickDirectory` 已删**（2026-10-18）：它唯一的消费者是「会话建在哪个目录」
      //    那个按钮，而那一整块已按使用者要求从面板去掉。
      const [st, setSt] = useStatus(5000)
      const [busy, setBusy] = React.useState('')
      // （旧的 msg/msgTone 已删：提示统一走 runNote 那个浮现式 toast，见 say()）

      /**
       * ⭐ **子导航当前页**（2026-10-16 加）。
       * 三页：settings（功能设置）/ prompt（提示词）/ env（环境与账号）。
       * ⚠️ 只存在**内存**里，不落盘 —— 面板重开回到第一页。这是有意的：
       *    它是"分类浏览"而非"用户偏好"，记住反而让人找不到东西。
       */
      /**
       * ⭐⭐ **当前标签页改成"跨会话共享"**（2026-10-20 使用者要求：
       *    「不同页面面板的设置显示不一样，用户也弄不清楚到底设置的是啥，应该保持统一」）。
       *
       * 原来注释写的是"只存在内存里、面板重开回到第一页，这是有意的"——
       * **那个决定现在被推翻了**：右侧栏是**按会话一份**的（DSH 架构），
       * 切会话就新建面板 ⇒ 每份都回到第一页 ⇒ 用户以为"设置变了"。
       *
       * ⇒ 初始值从 `localStorage` 的共享状态里"收养"，变了再写回去 + 广播。
       * ⚠️ 真正的**配置值**不用共享（`config.json` 本来就一份，5 秒轮询会对齐）；
       *    这里只共享"界面在哪一页"这种纯 UI 状态。
       */
      const [tab, setTab] = React.useState(() => {
        const v = readSharedUI().tab
        return v === 'settings' || v === 'prompt' || v === 'env' || v === 'lab' ? v : 'settings'
      })

      const [kws, setKws] = React.useState(null)
      // ⭐ 搜索相关的四个新设置（2026-10-16 加）：草稿存在本地 state，
      //    与 kws 一样**不能直接绑 cfg**（会被 5 秒轮询冲掉）
      const [kwMode, setKwMode] = React.useState(null)   // llm=按主题让模型自己组合搜索词 / fixed=每行原样当词
      const [sOrder, setSOrder] = React.useState(null)   // 搜索排序
      const [sDays, setSDays] = React.useState(null)     // 只看最近几天（0=不过滤）
      const [sNum, setSNum] = React.useState(null)       // 看多少条
      const [seenNote, setSeenNote] = React.useState(null) // 判重表条数（从 /status 拿）
      // ⭐ 前台/后台（2026-10-16 加）：决定它跑在一个你看得见的会话里、还是后台子进程
      const [runMode, setRunMode] = React.useState(null)
      // ⚠️ `wsPath` / `wsBusy` 已删（2026-10-18）：随「会话建在哪个目录」那块一起去掉。
      //    🔴 后端仍然支持 `frontWorkspace`（老配置照旧生效），只是**面板不再提供入口**。
      // ⭐ 产物清单（2026-10-16 加：改成每条一份 md，不再是汇总日报）
      const [reports, setReports] = React.useState(null)
      const [reportFile, setReportFile] = React.useState(null)
      const [rl, setRl] = React.useState(null)          // 日报形态：full / brief / off
      const [newVer, setNewVer] = React.useState('')    // 发现的新版本号（空 = 没发现）
      /**
       * ⭐ **「有新版本」弹窗是否打开**（2026-10-18 加）。
       * 点顶栏那个黑标才开；不点就一直只是个小胶囊（不打扰）。
       */
      const [showUpdateDlg, setShowUpdateDlg] = React.useState(false)
      /**
       * ⭐ **「更新内容」正文的状态**（2026-10-18 加）：
       *   `null` = 还没点；`{loading:true}` = 正在拉；
       *   `{text,version}` = 拿到了；`{error}` = 拉失败。
       * ⚠️ 用一个对象装四种状态，而不是四个独立 state ——
       *    独立 state 很容易出现"loading 还是 true 但 text 已有"这种自相矛盾的组合。
       */
      const [showChangelog, setShowChangelog] = React.useState(null)
      // ⚠️ 输入框必须绑"本地草稿"：页面每 5 秒轮询 /status，服务端那份会把 config 盖掉
      //    ⇒ 直接绑 cfg 的话，用户打字打到一半就被冲没了 ✗（2026-10-14 陌生人验收时抓到）
      const [perDay, setPerDay] = React.useState(null)
      const [perRound, setPerRound] = React.useState(null)
      /**
       * 🥚 **彩蛋用：记住「每条最多发几条」在**输入暗号之前**那个合法值**（2026-10-18）。
       *
       * 为什么不能用 `1` 兜底（第一版就是这么写的，被使用者指出来）：
       *   5299 只是暗号，不该覆盖使用者原来的设置 ——
       *   他原本填 3，输完暗号就该还是 3，而**不是**被我改成 1。
       *
       * ⚠️ 用 ref 而不是 state：它只是"记一下上次的值"，不参与渲染，
       *    用 state 反而会多一次重渲染、也更容易和 5 秒轮询打架。
       */
      const perRoundBeforeEgg = React.useRef(null)
      const [replyPer, setReplyPer] = React.useState(null)
      // ⭐ dsh 启动器路径的草稿（2026-10-17 加）。
      //    ⚠️ 与其它输入框同理：**不能让 5 秒轮询直接绑 cfg**，否则你打字打到一半会被冲掉。
      const [dshBinDraft, setDshBinDraft] = React.useState(null)
      const [mention, setMention] = React.useState(null)
      const [login, setLogin] = React.useState(null)
      const [runNote, setRunNote] = React.useState(null)

      /* ⭐⭐ **所有浮现式提示的统一入口 —— 一律会自己消失**（2026-10-18 修）。
       *
       * 🔴 修的是什么 bug（使用者截图报的）：
       *   点「现在跑一轮」→ 前台跳过去 → 回到发起那一轮 ⇒
       *   那条「已建前台会话（…），正在跳过去…」**一直挂在屏幕上不走**。
       *
       * 根因：提示有**两条互不相干的写入路径** ——
       *   · `say(...)`        ⇒ 带 `setTimeout` 自动清掉（2.6s / 6s）；
       *   · `setRunNote(...)` ⇒ **直接 set，没有任何定时器** ⇒ 永不消失。
       *   而"正在跳过去…"和另外 9 处（目录选择、跳转失败…）走的都是后者。
       *
       * ⚠️ **修法不是"给那 10 处各补一个定时器"** —— 那样以后新加一处又忘。
       *    ⇒ 把自动清理**收进唯一的写入函数**：`note()` 只管显示+计时，
       *      `say()` 变成它的一层薄包装（保留原来的"量面板/量屏幕"定位）。
       *      并且**把 `setRunNote` 从 render 作用域里"私有化"**：本文件其余地方
       *      一律用 `note()` / `say()`；只有 `note` 自己碰 state。
       *
       * ⚠️ 计时器存进 ref，**新提示要清掉旧的** ——
       *    否则连续保存两次时，第一条的定时器会把第二条提前收走。
       */
      const toastTimer = React.useRef(null)
      const toastBox = React.useRef(null)

      /**
       * 显示一条提示，**到期自动消失**（这是唯一该被别处调用的入口之一）。
       * @param {string} text  正文；传空 = 立刻清掉
       * @param {string} tone  '' | 'good' | 'warn'（warn 留久一点，要看清）
       * @param {object} [style] 定位样式（只有 say() 会传；不传就用 CSS 默认）
       */
      const note = (text, tone, style) => {
        if (!text) { setRunNote(null); return }
        // ⚠️ 每次覆盖前先清旧计时器（见上面那条注释）
        if (toastTimer.current) { clearTimeout(toastTimer.current); toastTimer.current = null }
        setRunNote({ t: String(text), tone: tone || '', style: style || null })
        // 错误提示留久一点（要看清），成功提示 2.6s 够读
        const ms = (tone === 'warn' ? 6000 : 2600)
        toastTimer.current = setTimeout(() => { setRunNote(null); toastTimer.current = null }, ms)
      }

      const say = (text, tone) => {
        if (!text) { note(''); return }
        // ⭐ 横向量面板、纵量屏幕（两把尺子，见 say 上面那段长注释）
        let style = null
        try {
          const el = toastBox.current?.closest('[data-bd-tabwrap]') || document.querySelector('[data-bd-tabwrap]')
          const r = el?.getBoundingClientRect()
          if (r && r.width > 0) {
            style = {
              left: Math.round(r.left + r.width / 2) + 'px',
              // 距屏幕底部 1/3 屏高 ⇒ 屏幕从上往下 2/3 的位置
              top: Math.round(window.innerHeight * (2 / 3)) + 'px',
            }
          }
        } catch { /* 量不到就用 CSS 默认（视口居中偏下） */ }
        note(text, tone, style)
      }
      // 组件卸载时清掉定时器（不清的话，卸载后 setState 会报警告）
      React.useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current) }, [])

      /* ════════ 面板界面状态：跨会话共享 —— 双向同步（2026-10-20）════════
       *
       * 三条规矩（照 memj 插件验证过的那套）：
       *  ① **本面板自己的变化 ⇒ 写盘 + 广播**；
       *  ② **别的面板广播过来 ⇒ 应用，但期间置标志、不再广播回去**
       *     （否则 A→B→A 来回弹，memj 那条知识里明写就是这个坑）；
       *  ③ 卸载时**断开通道**（每会话一份面板，会话切多了会堆一堆监听）。
       *
       * ⚠️ `applying` 用 `useRef` 而不是 state —— 它只在回调里同步判断，
       *    进 state 会多一次无意义的重渲染，而且读到的是旧值。
       */
      const applyingRemote = React.useRef(false)

      /* ① **挂载时主动对齐一次**（= 每次切会话就对齐一次）
       *
       * 使用者明确要求：「不要 5 秒内自动对齐，而是**每次切换会话的时候做一次主动对齐**」。
       *
       * ⭐ 为什么"挂载"正好等于"切会话"：
       *    右侧栏面板是**按会话一份**的（DSH 架构）⇒
       *    切到一个新会话时，这一份面板是**新建**的 ⇒ 这个 effect 就会跑一次。
       *    ⇒ 不需要定时器、不需要轮询，天然"每次切换都对齐"。
       *
       * ⭐ 对齐什么：
       *    · **本地界面状态**（`tab` 等）—— 从 `localStorage` 那份共享里读回来；
       *    · **服务端配置**（`cfg`）—— `useStatus()` 在挂载时已经 `tick()` 过一次了
       *      （见它的实现：`tick(); setInterval(...)`），所以配置本身就是"当场拉一次"。
       *    ⇒ 这里只补前者，不重复拉后者。
       */
      React.useEffect(() => {
        const shared = readSharedUI()
        if (shared.tab && shared.tab !== tab) {
          applyingRemote.current = true
          setTab(shared.tab)
        }
        // ⚠️ 依赖故意留空：**只在挂载时**对齐一次。
        //    若把 tab 放进依赖，每次本地切页都会再对齐一次 ⇒ 跟自己打架。
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [])

      // ② 本地 tab 变了 ⇒ 推给别的面板（让它们立刻跟上，不用等切会话）
      React.useEffect(() => {
        if (applyingRemote.current) { applyingRemote.current = false; return }
        writeSharedUI({ tab })
      }, [tab])

      // ③ 收到别的面板的广播 ⇒ 跟上（只认它管的字段）
      React.useEffect(() => {
        if (!uiChannel) return undefined
        const onMsg = (ev) => {
          const d = ev?.data
          if (!d || typeof d !== 'object') return
          if (d.tab && d.tab !== tab) {
            applyingRemote.current = true
            setTab(d.tab)
          }
        }
        uiChannel.addEventListener('message', onMsg)
        return () => uiChannel.removeEventListener('message', onMsg)
      }, [tab])

      /**
       * ④ 卸载：**只摘监听，不要关通道**（2026-10-20 修）。
       *
       * 🔴 我第一版写的是 `uiChannel?.close(); uiChannel = null` —— 那是**错的**：
       *    `uiChannel` 是**模块级单例**，多个会话的面板共用它；
       *    任意一个面板卸载（切会话就会卸载）就把通道关了、还置空
       *    ⇒ **剩下所有面板从此收不到广播**，而且再也没人重建它。
       * ⇒ 只移除本面板的 message listener（上面那个 effect 的 cleanup 已经在做了），
       *    通道本身留给进程/页面活到最后。
       */
      React.useEffect(() => () => {
        /* 通道是共享的，这里什么都不做 —— 见上面那段注释 */
      }, [])

      // （旧的「报告展开态」已删 —— 日报不写了，见下面的产物清单）底下，看不见）
      const [loginState, setLoginState] = React.useState('')
      const [loginTone, setLoginTone] = React.useState('')
      // ── 人设（2026-10-15 新增）──
      // ⭐ 人设**不走 /status 轮询**，只在挂载时 GET /persona 一次，之后完全由本地草稿管；
      //    否则每 5 秒的轮询会把用户正在编辑的正文冲掉（与上面输入框同一个教训）。
      const [persona, setPersona] = React.useState(null)
      const [personaSaved, setPersonaSaved] = React.useState(null)   // 服务端那份（用来判"有没有未保存改动"）
      const [personaFile, setPersonaFile] = React.useState('')
      const [personaChars, setPersonaChars] = React.useState(null)
      // （旧的 personaMsg/personaTone 已删：保存结果统一走浮现式 toast）
      // ── 回复细则（2026-10-16 新增）──
      // ⭐ 与人设同一套路（挂载时 GET 一次，之后本地草稿管，不参与 /status 轮询）；
      //    **唯一不同**：它还有**出厂源** ⇒ 多一个「恢复默认」（要确认）。
      const [reply, setReply] = React.useState(null)
      const [replySaved, setReplySaved] = React.useState(null)
      const [replyFile, setReplyFile] = React.useState('')
      const [replyChars, setReplyChars] = React.useState(null)
      // ⭐ 出厂源正文（GET /reply 的 defaultText 字段带回来）：用来**就地判断**草稿等不等于默认。
      //    🔴 这里踩过一次坑（2026-10-16 真机测出来的）：
      //       原来只存服务端算好的 `isDefault` 布尔值 ⇒ **它是一个快照**。
      //       使用者改了文本框里的内容后，按钮还写着「已是默认」且是禁用的 ——
      //       想恢复默认都点不了（而那正是最需要点它的时候）。
      //    ⇒ 正解：把**出厂正文**也存下来，渲染时拿**草稿**跟它比 ⇒ 改了立刻就能点。
      //    ⚠️ 所以**不要**再引入一个 isDefault 的 state —— 那个值注定会过期。
      const [replyDefaultText, setReplyDefaultText] = React.useState('')
      // ⭐ 确认弹层（不是 window.confirm —— panel 里用原生弹框在不同宿主下表现不一）
      const [confirmReset, setConfirmReset] = React.useState(false)
      // ── 模型（2026-10-15 新增）──
      // 清单从 /models 拉（**不硬编码**：DSH 的 provider/模型由使用者装的路由决定）
      const [models, setModels] = React.useState(null)          // [{id,name,models:[{id,name}]}]
      const [modelsNote, setModelsNote] = React.useState('')
      const [mProvider, setMProvider] = React.useState(null)
      const [mModel, setMModel] = React.useState(null)
      const [mEffort, setMEffort] = React.useState(null)
      /**
       * ⭐ **自由描述「关注什么」的草稿**（2026-10-18 加）。
       * 与 `kws` 一样是**草稿**（独立于 5 秒轮询，否则打字会被冲掉）——
       * 落盘时机见 `onSaveWatch`。
       */
      const [watchDraft, setWatchDraft] = React.useState(null)

      const cfg = st?.config
      React.useEffect(() => {
        if (cfg && kws === null) setKws((cfg.keywords || []).join('\n'))
        if (cfg && watchDraft === null) setWatchDraft(String(cfg.watchNote || ''))
        if (cfg && rl === null) setRl(cfg.reportLevel || 'full')
        if (cfg && perDay === null) setPerDay(String(cfg.perDay ?? 5))
        if (cfg && perRound === null) setPerRound(String(cfg.commentPerRound ?? 1))
        if (cfg && replyPer === null) setReplyPer(String(cfg.replyPerRound ?? 1))
        if (cfg && mention === null) setMention(cfg.mentionName || '')
        if (cfg && kwMode === null) setKwMode(cfg.keywordMode || 'llm')
        if (cfg && sOrder === null) setSOrder(cfg.searchOrder || 'totalrank')
        if (cfg && sDays === null) setSDays(String(cfg.searchDays ?? 0))
        if (cfg && sNum === null) setSNum(String(cfg.searchNum ?? 20))
        if (st && seenNote === null) setSeenNote(Number(st.seenCount) || 0)
        if (cfg && runMode === null) setRunMode(cfg.runMode || 'headless')
        // ⚠️ 原来这里还有一行给 wsPath 赋初值 —— 随那块 UI 一起去掉了（2026-10-18）
      }, [cfg])

      const win = { ...DEFAULT_WINDOWS, ...(st?.windows || {}) }

      // ⭐ 人设：挂载时取一次（**不进轮询**，免得冲掉正在编辑的草稿）
      React.useEffect(() => {
        let alive = true
        ;(async () => {
          try {
            const d = await jget('/persona')
            if (!alive || !d?.ok) return
            setPersona((cur) => (cur === null ? (d.text || '') : cur))
            setPersonaSaved(d.text || '')
            setPersonaFile(d.file || '')
            setPersonaChars(d.chars ?? (d.text || '').length)
          } catch { /* 取不到就等用户点保存 */ }
        })()
        return () => { alive = false }
      }, [])

      // ⭐ 回复细则：同样只在挂载时取一次（不进轮询，理由同人设）
      React.useEffect(() => {
        let alive = true
        ;(async () => {
          try {
            const d = await jget('/reply')
            if (!alive || !d?.ok) return
            setReply((cur) => (cur === null ? (d.text || '') : cur))
            setReplySaved(d.text || '')
            setReplyFile(d.file || '')
            setReplyChars(d.chars ?? (d.text || '').length)
            setReplyDefaultText(String(d.defaultText ?? ''))
          } catch { /* 取不到就等用户点保存 */ }
        })()
        return () => { alive = false }
      }, [])

      // ⭐ 模型清单：同样只在挂载时取一次（providers/模型不会天天变）
      React.useEffect(() => {
        let alive = true
        ;(async () => {
          try {
            const d = await jget('/models')
            if (!alive) return
            if (Array.isArray(d?.providers)) setModels(d.providers)
            if (d?.note) setModelsNote(d.note)
            else if (d && d.ok === false && d.error) setModelsNote(d.error)
            const cur = d?.current || {}
            setMProvider((v) => (v === null ? (cur.provider || '') : v))
            setMModel((v) => (v === null ? (cur.model || '') : v))
            setMEffort((v) => (v === null ? (cur.reasoningEffort || '') : v))
          } catch (e) { setModelsNote(String(e?.message ?? e)) }
        })()
        return () => { alive = false }
      }, [])

      /**
       * ⭐ **统一的「浮现式」提示**（2026-10-16）。
       *
       * 改之前：提示是**塞在面板里的整块绿条**，两个毛病 ——
       *   ① 它自己**占排版**，弹一条就把下面的设置往下推、点一次跳一下；
       *   ② 只有当前滚动到的地方看得见，别处触发的提示等于白弹
       *      （原来还要"镜像到顶部"来打补丁，那正是因为块状提示的毛病）。
       *
       * 现在：浮在**面板**正中偏下、**不吃排版**、几秒后自己消失。
       *
       * 📍 **为什么坐标要 JS 算**：面板是**右边栏**（只占屏幕右半边）。
       *    若用纯 CSS 的 `top:68%`，那是**视口**的 68% —— 中间那块是聊天区，
       *    不是面板。⇒ 先量面板外框（`[data-bd-tabwrap]`），
       * 📍 **坐标为什么要 JS 算**（横向和纵向用的尺子**不是同一个**，别混）：
       *    · **横向 = 面板的中心** —— 面板是**右边栏**（只占屏幕右半边）。
       *      若用 CSS 的 50%，那是**视口**的 50%，落点在聊天区、不是面板。
       *    · **纵向 = 屏幕的 2/3 处**（即**距屏幕底部 1/3 屏高**，2026-10-16 使用者指定：
       *      "再往下，应该距离底部 1/3 屏幕高度"）⇒ 这里用 **window.innerHeight**，
       *      而**不是**面板高度 —— 使用者说的是**屏幕**高度。
       *    ⚠️ 量不到时（还没挂载完）退回 CSS 里那组默认值，不要不显示。
       *
       * ⚠️ 计时器存进 ref，**新提示要清掉旧的** ——
       *    否则连续保存两次时，第一条的定时器会把第二条提前收走。
       *
       * ⭐ **2026-10-18：这段逻辑已经搬到文件更上面的 `note()` / `say()`**
       *    （因为原来有两条写入路径，而只有 `say` 带定时器 ⇒ 另一条会一直留在屏幕上）。
       *    ⚠️ 这里只保留坐标说明；**不要**再在这里写一份实现。
       */

      const patch = async (p, what) => {
        setBusy(JSON.stringify(p))
        try {
          const r = await jpost('/config', p)
          if (r?.config) setSt((old) => ({ ...old, config: r.config }))
          say(what ? `${what}：已保存` : '已保存', 'good')
        } catch (e) { say(String(e?.message ?? e), 'warn') }
        finally { setBusy('') }
      }

      /** ⭐ 列产物（每条一份 md；2026-10-16 加，取代「看今天的报告」）。 */
      const onListReports = async () => {
        if (reports !== null) { setReports(null); setReportFile(null); return }  // 再点一次收起
        setBusy('reports')
        try {
          const r = await jget('/reports')
          setReports(r && r.ok ? r : { ok: false, files: [], count: 0 })
          setReportFile(null)
        } catch (e) { say('读不到产物清单：' + String(e?.message ?? e), 'warn') } finally { setBusy('') }
      }

      // ⚠️ 旧的 `onShowReport`（读「今天的报告」）**已删**（2026-10-16）：
      //    日报不再写了，那个按钮也换成了「看产物」。`/report` 路由留着兼容旧文件。

      const copyText = async (text) => {
        const v = String(text || '')
        try {
          await navigator.clipboard.writeText(v)
          say('已复制：' + v, 'good')
        } catch {
          say('复制失败 —— 路径是：' + v)       // 兜底：至少把路径显示出来，手动选中也能复制
        }
      }

      const onOpenFolder = async (what) => {
        try {
          const r = await jpost('/open', { what })
          if (r && r.ok) say('已请系统打开：' + (r.opened || '') + '（要是没看到窗口，用旁边的「复制报告路径」——那个一定成）', 'good')
          else say('打不开（' + ((r && r.error) || '未知原因') + '）—— 你可以手动打开这个路径：' + ((r && r.dir) || ''))
        } catch (e) { say(String(e?.message ?? e), 'warn') }
      }

      /**
       * ⭐⭐ **「怎么重启」要分端说**（2026-10-19，使用者要求）。
       *
       * 为什么：普通用户**只会点面板上的「一键升级」**，不会用命令行。
       *   而两端"重启"的动作完全不同：
       *     · **Web 端**：dsh 是个后台进程 ⇒「重启 dsh」他能照做；
       *     · **桌面版**：他只有应用窗口，**没有"dsh 进程"这个东西** ⇒
       *       跟他说"重启 dsh"，他会去找一个不存在的东西。
       *
       * ⚠️ 桌面版的说法是使用者自己定的：「**完全退出（含托盘图标）再重新打开**」。
       * ⚠️ 判据来自 `/status` 的 `isDesktop`（面板没法直接读宿主的 `process.versions.electron`）；
       *    `st` 还没到（首屏）就当作非桌面版 —— 文案最坏情况是"重启 dsh"，不会误导得更糟。
       */
      const isDesktop = Boolean(st && st.isDesktop)
      /** 拼在句子里的说法，例如「装完{重启 dsh}」 */
      const restartWord = () => (isDesktop
        ? '要完全退出桌面版（托盘图标也要退出）再重新打开'
        : '要重启一次 dsh')
      /** 完整句子（用在不跟宾语的场合） */
      const restartSentence = () => (isDesktop
        ? '完全退出桌面版（托盘图标也要退出）再重新打开，新版才生效'
        : '重启一次 dsh 才生效')

      const onUpgrade = async () => {
        setBusy('upgrade')
        /**
         * ⭐⭐ **升级时把面板切到「环境与账号」页**（2026-10-18 使用者提，这里做双保险）。
         *
         * 为什么：升级是**异步**的，过程写进 `<家>\install.log`，
         * 而那段日志就在「环境与账号」页。**不跳的话用户点完什么都看不见**
         * ⇒ 以为按钮没反应。
         *
         * ⚠️ 弹窗里的「直接升级」已经会 `setTab('env')`；这里再切一次是因为
         *   「环境与账号」页上也有一个「一键升级」按钮 —— 从那里点同样应该停在那一页。
         *   （重复 `setTab('env')` 是幂等的，没有副作用。）
         */
        setTab('env')
        try {
          /**
           * ⭐⭐ **必须把目标版本号一起传过去**（2026-10-19 修）。
           *
           * 为什么：后端拼的是 `包名@版本`。只给包名的话，pnpm 看到
           * profile 的 `package.json` 里已经有这个包（精确版本）就说
           * `Already up to date` —— **看起来成功、版本却没变**。
           *
           * 版本从哪来：`/status` 里的 `update.latest`（就是「检测到有新版本」用的那个）；
           * 拿不到就**不传**（后端会退回裸包名，老行为）。
           */
          const ver = String((st && st.update && st.update.latest) || newVer || '').trim()
          const r = await jpost('/upgrade', ver ? { version: ver } : {})
          say((r && r.hint) || '正在升级', 'good')
          /**
           * ⭐ 说明**走的是国内镜像**（2026-10-18）。
           * 为什么要说：升级要下载包，使用者看着日志长时间没动静时，
           *   知道"它在从 npmmirror 拉"总比不知道强（而且镜像是国内直连，通常很快）。
           * ⚠️ 这句必须与后端 `runUpgrade` 里那个 `MIRROR` 一致，否则是假信息。
           */
          say('正在从国内镜像（npmmirror）装 —— 日志在下面「主依赖的日志」里；'
            + '镜像失败会自动改用官方源再试一次。装完' + restartWord() + '（不重启还是旧版）', 'warn')
        } catch (e) { say(String(e?.message ?? e), 'warn') } finally { setBusy('') }
      }

      /**
       * 「检查更新」—— ⭐ **2026-10-18 起比的是 npm 上的版本号**（走国内镜像）。
       *
       * ── 为什么换（实测数据）────────────────────────────────
       *   同一台国内机器：npmmirror 55ms / npm 官方 1860ms → 镜像快 30 倍。
       *   而且 GitHub 那条路有硬伤：**本地 commit 必须已推到远端**，
       *   否则 `compare` 直接 404（本机实测：领先 fork/main 16 个提交时必然 404）。
       *
       * ⚠️ 旧注释写的是「判据是 commit sha（不是版本号：fork 之后 version 一直没动）」——
       *    那句话**当时对、现在不对了**：现在每个版本都改了 `package.json` 的 version。
       *
       * 🔴 `direction` 的语义（**现在指版本号**，不再是 commit）：
       *    `ahead`     = npm 上的版本更新 ⇒ **有新版**
       *    `behind`    = 本地版本更新     ⇒ 改过还没发版（`localAhead: true`）
       *    `identical` = 版本号一样       ⇒ 最新
       */
      const onCheckUpdate = async () => {
        setBusy('update')
        try {
          const r = await jget('/update')
          /**
           * 🔴 **别再一律说"可能网络不通"**（2026-10-18 修）。
           * 后端会区分 `errorKind`（network / rate-limit / http），各给一句能指导下一步的话。
           * 旧代码那句「可能网络不通」把一个 HTTP 404（本地没推上去）说成了网络故障。
           */
          if (!r || !r.ok) {
            const kind = r && r.errorKind
            const prefix = kind === 'rate-limit' ? '查不了（限流）：'
              : kind === 'http' ? '查不了（registry 拒绝了请求）：'
                : '查不了（网络问题）：'
            say(prefix + ((r && r.error) || '未知原因'), 'warn')
            return
          }
          /**
           * ⚠️ **每次检查结果都要重置 `newVer`**（2026-10-18 补）。
           * 原来只有 `setNewVer(...)` 没有清空 ⇒ 一旦发现过新版，
           * 即使后来收敛了（或本地变得超前），**「升级到 xxx」按钮会一直挂着**。
           */
          setNewVer('')
          /**
           * ⭐ **2026-10-18 起，比对对象改成 npm 版本号**（走国内镜像）。
           * 所以这段文案整个重写了 —— 不再有"领先你几个提交"（版本号说不出这个）。
           * ⚠️ 要在提示里**带上版本号和来源**，否则看的人不知道自己在比什么。
           */
          const src = r.via === 'npm'
            ? 'npm' + (r.registry ? `（${String(r.registry).replace('https://', '')}）` : '')
            : 'GitHub'
          if (r.hasNew) {
            setNewVer(r.latest || '有新版')
            say(`有新版本 ${r.latest}（现在 ${r.current}，比的是 ${src}）`
              + ' —— 点右边的「一键升级」，装完' + restartWord(), 'warn')
            /**
             * ⭐ **顺手把顶栏那个「检测到有新版本」点亮**（2026-10-18）。
             * 为什么要写：`/status` 每 5 秒才轮询一次，而手动点完「检查更新」
             *   如果顶栏没跟着变，使用者会觉得"它没查到"。这里直接改本地状态，
             *   不用等那 5 秒。（后端那边缓存也已经写好了，轮询回来是同一个结果。）
             */
            setSt((old) => (old ? {
              ...old,
              update: {
                hasNew: true, latest: r.latest || '', current: r.current,
                page: r.page || 'https://github.com/jojoman2024/dsh-bili-scroll/releases',
              },
            } : old))
          } else if (r.localAhead) {
            /**
             * ⭐ **本地版本号比 npm 上的还新** ⇒ 改过还没发版。
             * 这时既不能说"有新版本"，也不能说"已是最新"（它明明更新）。
             */
            say(r.note || `你本地是 ${r.current}，npm 上最新是 ${r.latest} —— 你比它新，不用升级`, 'good')
          } else if (r.direction === 'identical') {
            say(`已经是最新版 ${r.current}（比的是 ${src}）`, 'good')
          } else {
            // ⚠️ 兜底：**别把它说成"有新版本"**，也别说"最新" —— 只说看到了什么
            say(`当前 ${r.current}，${src} 上最新是 ${r.latest || '?'}`, 'good')
          }
        } catch (e) { say(String(e?.message ?? e), 'warn') } finally { setBusy('') }
      }

      const onCheck = async () => {
        setBusy('check')
        say('')
        try {
          const r = await jpost('/check', {})
          if (r && r.ok) say('能用！' + (r.steps || []).join('、'))
          else say('还不能用：' + (r && r.error ? r.error : '没拿到结果'))
        } catch (e) { say(String(e?.message ?? e), 'warn') } finally { setBusy('') }
      }

      const onInstallAsr = async () => {
        setBusy('asr')
        say('')
        try {
          const r = await jpost('/install-asr', {})
          say(r?.started ? '开始装转写依赖 —— 进度显示在下面（要下模型，慢一点正常）' : (r?.hint || '没起来'),
            r?.started ? 'good' : 'warn')
        } catch (e) { say(String(e?.message ?? e), 'warn') } finally { setBusy('') }
      }

      const onInstall = async () => {
        setBusy('install')
        say('')
        try {
          const r = await jpost('/install', {})
          say(r?.hint || '已经在后台开始装了', '')
        } catch (e) { say(String(e?.message ?? e), 'warn') }
        finally { setBusy('') }
      }

      const onRun = async () => {
        setBusy('run')
        try {
          const r = await jpost('/run', {})
          /**
           * 🔴 **2026-10-18 改：把"没起跑"和"起来了"分开说。**
           *
           * 原来这里只看 `r.started` —— 而**没装环境的用户点下去也是 `started:true`**
           * （它只代表"子进程 spawn 成功了"），于是面板显示绿色
           * 「已经在后台跑一轮了」，实际上那一轮跑完什么也没干。
           * ⇒ 现在后端会先做体检：缺环境/没登录就 `started:false` + `problems`。
           *    面板照实说**为什么没跑**，并把"下一步点哪里"顶在前面。
           */
          if (!r?.started) {
            // ⚠️ 优先显示 `hint`（下一步做什么），而不是 `error`（一句话结论）——
            //    用户需要的是"我该点哪儿"，不是"它失败了"。
            const why = r?.hint || r?.error || '没起来，看日志'
            note(why, 'warn')
            return
          }
          if (r.mode === 'front') {
            // ⭐ 前台：会话已经建好了。**直接跳过去**，你就能看着它跑
            //    （这正是前台模式的意义 —— 后台那轮你看不见）。
            note(`已建前台会话（${r.sessionId || ''}），正在跳过去…`, 'good')
            const openSession = resolveOpenSession()   // 点击时才取服务
            if (openSession && r.sessionId) {
              try { openSession(r.sessionId) } catch (e) { note(`会话建好了，但跳转失败：${String(e?.message ?? e)}`, 'warn') }
            } else if (r.sessionId) {
              note(`会话建好了（${r.sessionId}），但这个环境拿不到跳转能力 —— 去左侧会话列表里找「刷B站 …」`, 'warn')
            }
          } else {
            // ⚠️ 文案要说**真正的产物目录**（2026-10-16 修）。
            //    原来写的是"报告会写在 out/ 里"—— 那是**汇总日报时代**的目录，
            //    产物早就统一到 `<家>\reports\` 了 ⇒ 使用者按它去 out/ 找会扑空。
            //    ⚠️ 所以这里不写死路径，而是用状态里那份真值（读不到就退化成不带路径的说法）。
            say(`已经在后台跑一轮了 —— 挑中的每条会各写一份 md 到 ${st?.reportDir || '产物目录'}`, 'good')
          }
        } catch (e) { say(String(e?.message ?? e), 'warn') }
        finally { setBusy('') }
      }

      const onLoginStart = async () => {
        setBusy('login')
        setLoginTone('')
        setLoginState('正在出码…')
        try {
          const r = await jpost('/login/start', {})
          if (!r?.ok) { setLoginTone('warn'); setLoginState(r?.error || '出码失败'); return }
          setLogin({ key: r.key, qr: r.qr })
          if (!r.qr) { setLoginTone('warn'); setLoginState('没画出二维码 —— 先点上面的「重装依赖」（venv 里要有 qrcode）') }
          else setLoginState('用手机 B站 扫这张码')
          let n = 0
          const timer = setInterval(async () => {
            n += 1
            try {
              const p = await jpost('/login/poll', { key: r.key })
              if (p?.state === 'ok') {
                clearInterval(timer); setLogin(null)
                setLoginTone('good'); setLoginState('登录成功')
                setSt((old) => ({ ...old, loggedIn: true }))
              } else if (p?.state === 'scanned') { setLoginTone(''); setLoginState('扫到了，请在手机上确认') }
              else if (p?.state === 'expired') { clearInterval(timer); setLogin(null); setLoginTone('warn'); setLoginState('二维码过期了，再点一次「扫码登录」') }
              else { setLoginTone(''); setLoginState('等扫码…') }
            } catch { /* 抖动就下次再问 */ }
            if (n > 90) { clearInterval(timer); setLogin(null); setLoginTone('warn'); setLoginState('超时了，再点一次「扫码登录」') }
          }, 2000)
        } catch (e) { setLoginTone('warn'); setLoginState(String(e?.message ?? e)) }
        finally { setBusy('') }
      }

      const onSaveText = async () => {
        const list = String(kws || '').split('\n').map((s) => s.trim()).filter(Boolean)
        await patch({ keywords: list }, '关键词')
      }

      /**
       * ⭐ 保存「自由描述」（2026-10-18）。
       * ⚠️ **原样存**（不 split、不 trim 成数组）—— 使用者要的就是"一段话，不用管分行"。
       *    只把首尾空白去掉，中间怎么断句、怎么换行都**原样保留**给模型读。
       */
      const onSaveWatch = async () => {
        await patch({ watchNote: String(watchDraft ?? '') }, '关注什么（自由描述）')
      }

      // ⭐ 保存人设：POST /persona ⇒ 落盘 persona.md。下一轮 promptFor() 现读 ⇒ 即时生效
      const onSavePersona = async () => {
        const text = String(persona || '')
        setBusy('persona')
        try {
          const r = await jpost('/persona', { text })
          if (r?.ok) {
            setPersonaSaved(text)
            setPersonaChars(r.chars ?? text.length)
            // ⭐ 走统一的浮现式提示（原来这里还塞了个常驻的 personaMsg 绿条，已去掉）
            say('人设已保存 —— 下一轮就用新的（不用重启）', 'good')
          } else {
            say(r?.error || '人设保存失败', 'warn')
          }
        } catch (e) { say(String(e?.message ?? e), 'warn') }
        finally { setBusy('') }
      }

      // ⭐ 保存回复细则：POST /reply ⇒ 落盘 reply.md（下一轮 promptFor 现读 ⇒ 即时生效）
      const onSaveReply = async () => {
        const text = String(reply || '')
        setBusy('reply')
        try {
          const r = await jpost('/reply', { text })
          if (r?.ok) {
            setReplySaved(text)
            setReplyChars(r.chars ?? text.length)
            // ⚠️ 这里**不要**动 replyDefaultText —— 出厂源没变。
            //    「是否等于默认」现在由渲染时拿草稿现比（见按钮那段注释）。
            say('回复细则已保存 —— 下一轮就用新的（不用重启）', 'good')
          } else {
            say(r?.error || '回复细则保存失败', 'warn')
          }
        } catch (e) { say(String(e?.message ?? e), 'warn') }
        finally { setBusy('') }
      }

      // ⭐ **恢复默认**：POST /reply/reset ⇒ 用**出厂源**覆盖家目录那份。
      //    ⚠️ 破坏性（会冲掉使用者改的内容）⇒ 面板先弹确认（confirmReset）。
      const onResetReply = async () => {
        setConfirmReset(false)
        setBusy('reply')
        try {
          const r = await jpost('/reply/reset', {})
          if (r?.ok) {
            // 直接把服务端回写的内容灌回草稿（不用再 GET 一次）
            const text = String(r.text ?? '')
            setReply(text)
            setReplySaved(text)
            setReplyChars(r.chars ?? text.length)
            // ⭐ 服务端把出厂正文也回给我们了 ⇒ 顺手刷新它（升级后出厂源会变）
            if (r.defaultText) setReplyDefaultText(String(r.defaultText))
            say('已恢复出厂那份回复细则', 'good')
          } else {
            say(r?.error || '恢复默认失败', 'warn')
          }
        } catch (e) { say(String(e?.message ?? e), 'warn') }
        finally { setBusy('') }
      }

      const onSaveModel = async () => {
        await patch({
          llmProvider: String(mProvider || '').trim(),
          llmModel: String(mModel || '').trim(),
          llmReasoningEffort: String(mEffort || '').trim(),
        }, '模型')
      }

      if (!cfg) {
        return h('div', { 'data-bd-page': '' }, h('div', { 'data-bd-note': '' }, '读设置中…'))
      }

      const sw = (k) => Boolean(cfg[k])

      /* ══════════════════════════════════════════════════════════════════
       * 面板正文（2026-10-16 重排）
       *
       * 使用者反馈三件事：① 设置项看起来乱、逻辑上该在一块的没在一块；
       * ② 保存到底该点哪个看不清；③ 样式要与官方统一。
       *
       * ── ① 重排的依据：按【这件事属于哪一步】分组，不按"哪个控件"分组 ──
       *   旧的分节是零散长出来的，有两处明显错位：
       *     · 「日报写多细」被塞在「关注什么」里 —— 它跟关键词毫无关系，是**产物**的事；
       *     · 「本地转写」被塞在「它会不会替你说话」里 —— 那是**读**的事，不是**说**的事。
       *   ⇒ 现在按一轮的流程排：**怎么跑 → 怎么找 → 怎么写 → 说不说话 → 怎么读 → 模型 → 人设 → 环境 → 地盘**。
       *
       * ── ② 保存的判据（库内 `3205d68e` 裁定过，不是我拍的）──
       *   · **即时生效**（无按钮）= 「一个勾选就是全部语义」的**独立**开关 / 选完即定的下拉；
       *   · **必须留保存按钮** = 带**配套参数**的组（长文本、模型三件套）。
       *   ⇒ 现在只有 **3 个**保存按钮：关键词 / 模型 / 人设 —— 且**名字各自说清在存什么**。
       *   ⚠️ 数字项走 onBlur（改完离开才写），不是每敲一个字符写一次盘。
       *   ⚠️ 每个自动保存的分节都标了「改完即时生效」，免得使用者到处找保存按钮。
       * ── ③ 子导航（2026-10-16 加，使用者要求）──
       *   面板太长，按**你此刻在干什么**分三页：
       *     · **功能设置** = 怎么跑 → 用哪个模型 → 怎么找 → 怎么写 → 说不说话 → 怎么读 → 它的地盘
       *     · **提示词**   = 它的人设
       *     · **环境与账号** = 环境与账号
       *   样式**照抄官方那个「对话 / 轨迹」的标签条**（原样 CSS 见上面 [data-bd-tabs] 的注释）。
       *   ⚠️ 归属写在分节的 data-bd-tabin 上，切页由 CSS 负责（见上面那条规则）——
       *      **没有新增内容容器**，就是为了不把 flex 上下文断掉（那个坑见 CSS 注释里引的 b15ee951）。
       * ══════════════════════════════════════════════════════════════════ */
      /** 子导航三页；顺序即显示顺序。 */
      const TABS = [
        { id: 'settings', label: '功能设置' },
        { id: 'prompt', label: '提示词' },
        { id: 'env', label: '环境与账号' },
        // ⭐ 「实验功能」放最后（2026-10-17 加）—— 里面是那种"打开就会改变安全边界"的开关，
        //    不该排在最显眼的位置，但也不能藏。放这最后一页正合适。
        { id: 'lab', label: '实验功能' },
      ]
      return h('div', { 'data-bd-page': '', 'data-bd-tab': tab },

        /* ⭐ **浮现式提示**：整块面板共用**一个** toast。
           半透明黑底白字、浮在**面板**正中偏下（屏幕 2/3 处）、不吃排版、2.6 秒自己消失
           —— 坐标是 say() 量了面板外框与屏幕高度算出来的（见那边的注释）。 */
        runNote ? h('div', { 'data-bd-toast': '', ref: toastBox, style: runNote.style || undefined },
          h('div', null, runNote.t)) : null,

        /* ── 顶栏 + 子导航：**包在同一个 sticky 容器里**（不跟着滚）──
           ⚠️ 两个 sticky 元素都写 top:0 会互相盖住 ⇒ 包一层、只有它 sticky。 */
        h('div', { 'data-bd-head': '' },
          // ⚠️ [data-bd-top] 现在自己就是 flex 行（不再套一层 row）—— 见上面 CSS 注释
          h('div', { 'data-bd-top': '' },
            /* ⭐ 顶栏那一排徽章 —— 已抽成 renderVersionBadges（可离线验的分支）。
               顺序：环境 → B站 → 版本号 → 新版本 → 后台运行。
               ⚠️ 间隔靠 [data-bd-top] 的 gap:8px 统一管，别给单个徽章补 margin。
               ⚠️ 「今天已挑 N/M」那个计数已按使用者要求去掉（st.ranToday 后端仍在）。 */
            renderVersionBadges(st, () => setShowUpdateDlg(true), say),
            h('div', { 'data-bd-grow': '' }),
            h('button', { 'data-bd-btn': '', 'data-primary': '', disabled: busy === 'run', onClick: onRun }, '现在跑一轮')),

          /*
           * ⭐ **点之前就把"现在点了也没用"讲清楚**（2026-10-18 加）。
           *
           * 为什么加：后端已经会拦（`preflight`），但**等点下去才告知**体验很差 ——
           * 用户会以为按钮坏了。这里用顶栏那两个徽章本来就在说的信息
           * （`st.venvReady` / `st.loggedIn`）提前提示一句，并告诉它去哪个页修。
           * ⚠️ 判据与后端 `preflight()` 保持一致：环境 + 登录。
           *    （后台模式还要 dsh，那个正常环境里总是有的，不在这儿重复提示。）
           */
          (!st.venvReady || !st.loggedIn)
            ? h('div', { 'data-bd-note': '' },
              '⚠️ 现在点「现在跑一轮」跑不了：',
              !st.venvReady ? '运行环境还没装好（去「环境与账号」点「装主依赖」）。' : '',
              !st.loggedIn ? '还没登录 B站（去「环境与账号」点「扫码登录」）。' : '')
            : null,

          /* ── 子导航标签条（样式照抄官方「对话 / 轨迹」）──
             ⚠️ 用 role=tablist/tab + aria-selected，与官方那个结构一致（无障碍/测试都对得上）。 */
          h('div', { 'data-bd-tabs': '', role: 'tablist' },
            TABS.map((t) => h('button', {
              key: t.id, type: 'button', role: 'tab',
              'data-on': tab === t.id ? '' : undefined,
              'aria-selected': tab === t.id,
              onClick: () => setTab(t.id),
            }, t.label)))),

        /* ════════ 一、怎么跑（跑在哪 / 什么时候跑 / 一轮挑几条 —— 都是"运行"）════════ */
        h('div', { 'data-bd-sec': '', 'data-bd-tabin': 'settings' },
          h('div', { 'data-bd-h': '' }, '怎么跑'),
          h('div', { 'data-bd-note': '' }, '改完即时生效，不用点保存。'),

          h('div', { 'data-bd-row': '' },
            h('div', { 'data-bd-grow': '' },
              h('div', { 'data-bd-label': '' }, '跑在哪'),
              h('div', { 'data-bd-note': '' }, runMode === 'front'
                ? '在主应用里新建一个真实会话：能看它搜、能看它判断，会话留在列表里能回看。'
                : '另起一个 dsh 子进程，你看不见它；跑完只留产物。')),
            h('select', {
              'data-bd-input': '', value: runMode ?? 'headless',
              onChange: (e) => { setRunMode(e.target.value); patch({ runMode: e.target.value }, '跑在哪') },
            },
              h('option', { value: 'front' }, '前台（能看、能追溯）'),
              h('option', { value: 'headless' }, '后台（另起子进程）'))),

          /**
           * ⚠️ **原来这里还有两块，2026-10-18 按使用者要求去掉了**：
           *   ① 「会话建在哪个目录」（选目录 / 改目录 / 用默认 三个按钮）
           *   ② 「最近一次：<sessionId>」+「去到那个会话」
           *
           * 为什么去掉（使用者原话）：「把这两个设置从面板里去掉吧」。
           * 判断：这两项都是**调试/诊断用**的，不是正常使用要调的东西 ——
           *   · 会话目录一般就用默认的（家目录下 front-sessions），
           *     放出来反而让人以为"必须选一个"；
           *   · 「去到那个会话」更是排查时才用。
           * ⇒ 面板只留使用者真正要决定的事。
           *
           * 🔴 **后端没动**：`cfg.frontWorkspace` / `st.frontWorkspace` /
           *    `st.lastFrontSessionId` 在 `/status` 里照旧给，
           *    `POST /config {frontWorkspace}` 也照旧接受 ——
           *    所以老配置仍然生效，只是**面板不再提供改它的入口**。
           *    ⚠️ 要恢复入口：把这两块 JSX 加回 `runMode === 'front'` 的分支里即可。
           */


          h(ToggleRow, {
            label: '峰谷时段自动刷',
            /**
             * ⚠️ 文案已随「自定义时间点」一起改（2026-10-19）：
             *    原来只说"只在谷时跑"，现在下面还能加精确时间点 ⇒ 说明要把两种模式都讲清。
             */
            note: '打开后可以自己加时间点（精确到分钟）；一个都不加才按谷时跑 —— '
              + '工作日 12:00–14:00 与 18:00 之后（整个周末也算谷时）。关了就只能手动跑',
            on: sw('peakValley'),
            onChange: (v) => patch({ peakValley: v }, '峰谷时段自动刷'),
          }),

          /**
           * ⭐⭐ **自定义时间点**（2026-10-19 加，使用者要求）。
           *
           * 原话：「改成开启后，展开设置项，可直接设置具体时间，精确到分钟。
           *   且可以自主添加多个时间。」「就已设置的时间行，应该有开关和删除按钮。」
           *
           * ── 设计（对齐库里的官方规范）──────────────────────
           *   · 每行 = **一个 `[data-bd-row]`**（官方设置行形状：
           *     `display:flex; align-items:center; gap:8px`），**不自己写 padding/margin**
           *     —— 间距统一由 `[data-bd-sub] > *` 那条结构规则给（库里那条 trap 讲的就是这个）。
           *   · 行内：`<input type="time">` + 开关 + 删除按钮，三者 `gap:8px`；
           *     时间控件用 `data-bd-grow` 撑满 ⇒ 右侧两个图标始终贴右边缘（横向对齐不靠猜）。
           *   · 「添加」按钮单独一行（`data-bd-row`）。
           *
           * ── 存储编码 ──────────────────────────────────────
           *   `["09:30", "21:00!off"]` —— 见 `index.js` 里 schema 那段注释
           *   （为什么不用对象数组：`normalize()` 会把非字符串元素过滤掉）。
           */
          sw('peakValley') ? (() => {
            /**
             * 把 `cfg.scheduleTimes` 解成 `[{ at, on }]`。
             * ⚠️ 这里**必须自己再解一遍**（不能直接用 `cfg` 原样）：
             *    面板拿到的是盘上那份编码串，解析规则要与后端 `readSchedule()` 一致。
             *    容错同上：读不懂的跳过，绝不抛。
             */
            const parseTimes = (arr) => {
              const out = []
              const seen = new Set()
              for (const s of (Array.isArray(arr) ? arr : [])) {
                if (typeof s !== 'string') continue
                const m = /^(\d{1,2}):(\d{2})(!off)?$/.exec(s.trim())
                if (!m) continue
                const hh = Number(m[1]); const mm = Number(m[2])
                if (!(hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59)) continue
                const at = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
                if (seen.has(at)) continue
                seen.add(at)
                out.push({ at, on: !m[3] })
              }
              return out.sort((a, b) => a.at.localeCompare(b.at))
            }
            /** 编码回存储形态 */
            const encodeTimes = (list) => list.map((x) => (x.on ? x.at : x.at + '!off'))

            const list = parseTimes(cfg.scheduleTimes)
            /** 写回：**整份替换**（后端 normalize 只做类型过滤，不会合并数组） */
            const save = (next) => patch({ scheduleTimes: encodeTimes(next) }, '自定义时间点')

            return h('div', { 'data-bd-sub': '' },
              /* ① 已设置的时间行（每行：时间 + 开关 + 删除） */
              ...list.map((row, i) => h('div', { 'data-bd-row': '', key: 't' + i },
                /* 🔴🔴 **不用原生 input[type=time]**（2026-10-19 第二次修）。
                   第一版加了 lang=zh-CN，真机上**仍然显示上午/下午** ——
                   原生 time 控件的 12/24 制跟的是**浏览器/系统区域设置**，
                   DOM 上的 lang 属性**不生效**（Chrome/Electron 实测）。
                   ⇒ 改成**两个数字框自己拼 24 小时制**：[0-23] : [0-59]，
                     完全不依赖任何 locale，永远 24 小时制。
                   ⚠️ 另外两个好处：宽度可控（原生控件在窄侧栏里会被压变形）、
                     没有那个时钟弹层（面板里不需要）。 */
                h('div', { 'data-bd-grow': '', 'data-bd-time': '' },
                  h('input', {
                    'data-bd-input': '', 'data-bd-num': '', type: 'number',
                    min: 0, max: 23, inputMode: 'numeric',
                    'aria-label': '小时（0-23）',
                    value: row.at.slice(0, 2),
                    onChange: (e) => {
                      const raw = String(e.target.value || '').replace(/\D/g, '')
                      if (raw === '') return
                      const hh = Math.max(0, Math.min(23, Number(raw)))
                      const next = list.slice()
                      next[i] = { ...next[i], at: String(hh).padStart(2, '0') + ':' + String(next[i].at).slice(3) }
                      save(next)
                    },
                  }),
                  h('span', { 'data-bd-time-sep': '' }, ':'),
                  h('input', {
                    'data-bd-input': '', 'data-bd-num': '', type: 'number',
                    min: 0, max: 59, inputMode: 'numeric',
                    'aria-label': '分钟（0-59）',
                    value: row.at.slice(3),
                    onChange: (e) => {
                      const raw = String(e.target.value || '').replace(/\D/g, '')
                      if (raw === '') return
                      const mm = Math.max(0, Math.min(59, Number(raw)))
                      const next = list.slice()
                      next[i] = { ...next[i], at: String(next[i].at).slice(0, 2) + ':' + String(mm).padStart(2, '0') }
                      save(next)
                    },
                  })),
                /* 删除这一行（X 紧跟时间输入）
                   🔴 **SVG 的属性名必须用 React 的驼峰写法**（真机踩过）：
                   第一版写成 `'stroke-width': '1.6'` / `'stroke-linecap': 'round'`
                   ⇒ React 丢弃这两个未知属性 ⇒ **X 完全看不见**（stroke 无值 = 透明）。
                   正确写法：`strokeWidth` / `strokeLinecap` / `strokeLinejoin`。
                   ⚠️ 另外 `viewBox` 本身就是驼峰（写 `viewbox` 也会失效）。
                   外观：两条对角线各一条 path，+45° 与 -45° 交叉，端点圆头
                   —— 这就是使用者要的「互相垂直的那种 X」。 */
                h('button', {
                  'data-bd-btn': '', 'data-bd-icon': '', type: 'button',
                  title: '删掉这个时间',
                  'aria-label': '删掉这个时间',
                  onClick: () => save(list.filter((_, k) => k !== i)),
                },
                h('svg', {
                  viewBox: '0 0 16 16',
                  fill: 'none',
                  stroke: 'currentColor',
                  strokeWidth: 1.6,
                  strokeLinecap: 'round',
                  'aria-hidden': 'true',
                },
                h('path', { d: 'M4 4 L12 12' }),
                h('path', { d: 'M12 4 L4 12' }))),
                /* ⭐ 中间这层空白：把开关推到最右，同时**让 X 紧跟着时间**。
                   🔴 为什么需要它（使用者第二次指出）：
                      上一版让 `[data-bd-time]` 自己有 `flex:1`，
                      于是"吃掉剩余空间"的是时间容器本身 ⇒ X 被推到时间框右边很远、
                      贴着开关，看起来像"X 属于开关"。
                      正确做法：时间容器只占内容宽度（flex:none），
                      再插一个**空的 grow 元素**承担"吃掉剩余空间"的职责
                      ⇒ X 紧贴时间、开关仍贴右，两件事同时成立。 */
                h('div', { 'data-bd-grow': '', 'data-bd-spacer': '' }),
                /* ⭐ 这一行自己的开关 —— 放在**最末尾** ⇒ 贴右边缘，
                   与上面「峰谷时段自动刷」那行的开关**右对齐**。 */
                h(Switch, {
                  on: row.on,
                  onChange: (v) => {
                    const next = list.slice()
                    next[i] = { ...next[i], on: v }
                    save(next)
                  },
                }))),

              /* ② 添加一行 */
              h('div', { 'data-bd-row': '' },
                h('button', {
                  'data-bd-btn': '', type: 'button',
                  /**
                   * ⚠️ 新加的行**默认给一个不与现有冲突的时间**，而不是固定 09:00 ——
                   *    固定值会让用户连点两次"添加"得到两行一样的时间，
                   *    而后端 `readSchedule()` 会**按时间去重** ⇒ 第二行存了也不生效，
                   *    看起来像"添加没反应"。
                   *    策略：从 09:00 起每次 +1 小时，找第一个没被占用的。
                   */
                  onClick: () => {
                    const used = new Set(list.map((x) => x.at))
                    let hh = 9
                    let pick = '09:00'
                    for (let n = 0; n < 24; n++) {
                      const cand = `${String((hh + n) % 24).padStart(2, '0')}:00`
                      if (!used.has(cand)) { pick = cand; break }
                    }
                    save([...list, { at: pick, on: true }])
                  },
                }, '＋ 添加时间点'),
                h('div', { 'data-bd-grow': '' })),

              /* ③ 说明（讲清"加了时间点就不按谷时跑了"这条关键语义） */
              h('div', { 'data-bd-note': '' },
                list.length
                  ? '加了时间点就「只按这些时间跑」，不再看上面那两条谷时窗口。'
                    + '关掉某一行 = 暂时不跑它（不用删）。'
                  : '还没有时间点 ⇒ 现在按谷时窗口跑。加一个时间点就改成按它跑。'),
            )
          })() : null,
          // ⭐「每天最多挑几条」已挪到「怎么找」那一节的「每次搜取回几条」下面
          //   （2026-10-16 使用者要求：它与"捞回来怎么挑"是一件事，和"什么时候跑"不是）
          ),

        /* ════════ 二、用哪个模型（成组 ⇒ 留保存按钮；2026-10-16 挪到「怎么跑」下面）════════
         *
         * 挪动的理由（使用者要求）：它和「怎么跑」是一件事 —— 都是"这一轮怎么起"。
         * 而「怎么找」是"捞回什么"，中间夹着一个模型选择很跳。
         * ⭐ 同时**压缩成一行**：provider 与模型**并排**、思考档位单独一行，
         *    不再三项各占一整行（右侧栏窄，三项各一行太占地方）。
         */
        (() => {
          const provs = models || []
          const cur = provs.find((p) => p.id === mProvider)
          const mlist = cur?.models || []
          const isCustom = Boolean(mProvider) && !cur            // 存着一个下拉里没有的 provider（自定义/已下线）
          return h('div', { 'data-bd-sec': '', 'data-bd-tabin': 'settings' },
            h('div', { 'data-bd-h': '' }, '用哪个模型'),
            h('div', { 'data-bd-note': '' },
              '跑一轮时用这里选的模型（覆盖 profile 的默认）。留空 = 用 profile 原本的默认。'),
            modelsNote ? h('div', { 'data-bd-note': '', 'data-warn': '' }, modelsNote) : null,

            /* ⭐⭐ **三个下拉并排一行**（2026-10-16 使用者要求：
             *    "模型选择和思考档位并排放一行"、"紧凑一点"）。
             *    provider / 模型 / 思考档位 各占 1/3 宽。
             *    ⚠️ 右侧栏窄 ⇒ 每个只有 ~170px，长模型名会被 select 自己截断
             *      （`title` 属性给了悬停提示，所以不至于看不全）。
             *    ⚠️ 不再给每个加 label —— 那样又变回三行。
             *      它是什么，靠下拉里的第一个 option 文字说
             *      （"（provider 默认）" / "（该 provider 默认）" / "（不指定）"）。
             */
            h('div', { 'data-bd-trio': '' },
              h('select', {
                'data-bd-select': '', title: 'provider',
                value: mProvider ?? '',
                onChange: (e) => { setMProvider(e.target.value); setMModel('') },   // 换 provider 要清掉 model
              },
                h('option', { value: '' }, '（provider 默认）'),
                ...provs.map((p) => h('option', { key: p.id, value: p.id }, `${p.name}（${p.id}）`)),
                isCustom ? h('option', { value: mProvider }, `${mProvider}（当前值，已不在清单里）`) : null),
              h('select', {
                'data-bd-select': '', title: '模型',
                value: mModel ?? '',
                disabled: !mProvider,
                onChange: (e) => setMModel(e.target.value),
              },
                h('option', { value: '' }, mProvider ? '（该 provider 默认）' : '（先选 provider）'),
                ...mlist.map((m) => h('option', { key: m.id, value: m.id }, m.name && m.name !== m.id ? `${m.name}（${m.id}）` : m.id)),
                (mModel && !mlist.some((m) => m.id === mModel))
                  ? h('option', { value: mModel }, `${mModel}（当前值，已不在清单里）`) : null),
              h('select', {
                'data-bd-select': '', title: '思考档位',
                value: mEffort ?? '',
                onChange: (e) => setMEffort(e.target.value),
              },
                h('option', { value: '' }, '（思考档位）'),
                ...['off', 'low', 'medium', 'high', 'max'].map((x) => h('option', { key: x, value: x }, x)))),

            h('div', { 'data-bd-foot': '' },
              h('button', { 'data-bd-btn': '', 'data-primary': '', disabled: Boolean(busy), onClick: onSaveModel }, '保存模型'),
              h('div', { 'data-bd-note': '' },
                mProvider && mModel ? `当前：${mProvider} / ${mModel}${mEffort ? ` · ${mEffort}` : ''}`
                  : '当前：未指定（用 profile 默认）')))
        })(),
        /* ════════ 二、怎么找（关注什么 + 怎么搜 —— 都是"捞什么回来"）════════ */
        h('div', { 'data-bd-sec': '', 'data-bd-tabin': 'settings' },
          h('div', { 'data-bd-h': '' }, '怎么找'),
          h('div', { 'data-bd-note': '' }, '决定它从 B站 捞回什么。改完下一轮生效。'),

          /* ⭐ 两种「关注什么」的写法（2026-10-18 加，由实验功能的开关切换）。
             **语义也不一样**，详见 renderWatchBlock 的注释。 */
          renderWatchBlock(cfg, {
            kws, setKws, kwMode, setKwMode, patch,
            watchDraft, setWatchDraft, onSaveWatch,
          }),

          h(Field, {
            label: '按什么排序',
            stack: true,
            children: h('select', {
              'data-bd-input': '', value: sOrder ?? 'totalrank',
              onChange: (e) => { setSOrder(e.target.value); patch({ searchOrder: e.target.value }, '搜索排序') },
            },
              h('option', { value: 'totalrank' }, '综合（B站 默认，偏热度）'),
              h('option', { value: 'pubdate' }, '最新（按发布时间）'),
              h('option', { value: 'click' }, '播放量'),
              h('option', { value: 'dm' }, '弹幕数')),
          }),
          h(Field, {
            label: '只看最近几天',
            note: '0 = 不过滤。要按时间筛只能在这里设 —— B站 搜索结果里不带发布时间，捞回来本地没法再筛。',
            children: h('input', {
              'data-bd-input': '', 'data-bd-num': '', type: 'number', min: 0, max: 365,
              value: sDays ?? '', onChange: (e) => setSDays(e.target.value),
              onBlur: () => { const n = Math.max(0, Math.min(Number(sDays) || 0, 365)); setSDays(String(n)); patch({ searchDays: n }, '只看最近几天') },
            }),
          }),

          h('div', { 'data-bd-row': '' },
            h('div', { 'data-bd-grow': '' },
              h('div', { 'data-bd-label': '' }, '每次搜取回几条'),
              h('div', { 'data-bd-note': '' }, '每搜一组取回几条来读')),
            h('input', {
              'data-bd-input': '', 'data-bd-num': '', type: 'number', min: 1, max: 50,
              value: sNum ?? '', onChange: (e) => setSNum(e.target.value),
              onBlur: () => { const n = Math.max(1, Math.min(Number(sNum) || 20, 50)); setSNum(String(n)); patch({ searchNum: n }, '每次取回几条') },
            })),

          /* ⭐ 「每天最多挑几条」从「怎么跑」挪到这儿（2026-10-16 使用者要求）：
             它与上面那条是**同一件事的两端**（捞回来多少 → 最后留下几条），
             而和「什么时候跑」不是一回事。
             ⚠️ 标题按使用者后来指定的叫法改成「**每次**最多记几条」（2026-10-16）。
                注意语义：`perDay` 在后端其实仍是**每日**上限
                （`ranToday` 是当天计数、跨天清零），
                所以这个"每次"是**使用者的叫法**，不是后端行为。
                真要改成"每轮"上限，得同时改后端计数器。 */
          h('div', { 'data-bd-row': '' },
            h('div', { 'data-bd-grow': '' },
              h('div', { 'data-bd-label': '' }, '每次最多记几条'),
              h('div', { 'data-bd-note': '' }, '填 0 = 不自动跑（还是能手动跑）'
                + (st.lastRunAt ? `　·　上次跑：${new Date(st.lastRunAt).toLocaleString('zh-CN')}` : ''))),
            h('input', {
              'data-bd-input': '', 'data-bd-num': '', type: 'number', min: 0, max: 50,
              value: perDay ?? '',
              onChange: (e) => setPerDay(e.target.value),
              onBlur: () => { const n = Math.max(0, Math.min(Number(perDay) || 0, 50)); setPerDay(String(n)); patch({ perDay: n }, '每次最多记几条') },
            })),

          h('div', { 'data-bd-note': '' },
            `判重表：已经记了 ${seenNote === null ? '…' : seenNote} 个视频`
            + ' —— 读过字幕 / 挑中 / 发过评论的都会记进去（`seen.md`），下次不再占候选预算。'),

          h('div', { 'data-bd-foot': '' },
            h('button', { 'data-bd-btn': '', 'data-primary': '', disabled: Boolean(busy), onClick: onSaveText }, '保存关键词'),
            h('div', { 'data-bd-note': '' }, '（上面这些是长文本 / 成组的，所以要点保存；其余改完即时生效）'))),

        /* ════════ 三、怎么写（产物形态 —— 独立一档，不再塞在「关注什么」里）════════ */
        h('div', { 'data-bd-sec': '', 'data-bd-tabin': 'settings' },
          h('div', { 'data-bd-h': '' }, '怎么写'),
          h('div', { 'data-bd-note': '' }, '挑中的每条视频各写一份 md 笔记；改完即时生效。'),
          h(Field, {
            label: '写多细',
            note: rl === 'off'
              ? '不写任何文件（挑中仍会记进判重表）。'
              : '写进产物目录，文件名是「标题-YYMMDD.md」。',
            stack: true,
            children: h('select', {
              'data-bd-input': '', value: rl ?? 'full',
              onChange: (e) => { setRl(e.target.value); patch({ reportLevel: e.target.value }, '产物形态') },
            },
              h('option', { value: 'full' }, '完整笔记 —— 讲了什么 / 关键点 / 为什么值得（默认）'),
              h('option', { value: 'brief' }, '薄 —— 结构保留，但正文各压到两三行'),
              h('option', { value: 'off' }, '不写 —— 只发评论，不生成文件')),
          })),

        /* ════════ 四、说不说话（评论 —— 纯"说"的事）════════ */
        h('div', { 'data-bd-sec': '', 'data-bd-tabin': 'settings' },
          h('div', { 'data-bd-h': '' }, '说不说话'),
          h('div', { 'data-bd-note': '' }, '这两项默认都关 —— 打开就是拿你的号说话。'),

          h(ToggleRow, {
            label: '自动评论并 @ 你',
            note: '在挑中的视频下面留一条 150 字内的评论，并 @ 你填的那个人',
            on: sw('autoComment'),
            onChange: (v) => patch({ autoComment: v }, '自动评论'),
          }),
          /**
           * ⭐⭐ **「每轮最多发几条」+「要 @ 谁」的展开条件**（2026-10-19 扩）。
           *
           * 原来只在「自动评论」开着时展开。使用者提：
           *   「私信通知开关开启时，不管自动评论开关是否开启，截图中的这两项，也需要展开的。」
           *
           * 为什么合理：**这两项私信也要用** ——
           *   · `commentPerRound` 是"每轮最多发几条评论"；
           *   · `mentionName` 是"发给/ @ 谁"，私信也发给他（`dm.md` 的规矩就是发这个人的）。
           * 只开私信、不开评论时，用户同样需要填这两项 ⇒ 不给展开他就没地方填。
           *
           * ⚠️ 判据是 `sw('dmNotify')`（私信开关当前是否打开），
           *    不是 `cfg.dmUnlocked`（那个只管"彩蛋有没有解锁、要不要显示私信开关本身"）。
           */
          (sw('autoComment') || sw('dmNotify')) ? h('div', { 'data-bd-sub': '' },
            h('div', { 'data-bd-row': '' },
              h('div', { 'data-bd-grow': '' },
                h('div', { 'data-bd-label': '' }, '每轮最多发几条'),
                /**
                 * ⚠️ 这一项现在在「只开私信」时也会显示（2026-10-19）⇒ 说明要讲清它管什么。
                 * 🔴 但**别写"私信也按这个数"** —— 私信的条数**没有代码硬闸**
                 *    （只在 `dm.md` 的提示词里约束），那样写是假承诺。
                 */
                h('div', { 'data-bd-note': '' }, '每条评论里 @ 一次下面那个人；私信也读这两项')),
              h('input', {
                'data-bd-input': '', 'data-bd-num': '', type: 'number', min: 1, max: 20,
                value: perRound ?? '',
                onChange: (e) => setPerRound(e.target.value),
                /**
                 * 🥚 **彩蛋：在这里输入 5299 解锁私信通知**（2026-10-18 使用者要求）。
                 *
                 * 使用者原话：「私信通知的开关和他的描述，应该是默认隐藏的。
                 *   只有当用户在每轮最多发几条那里，第一次输入 5299 的时候，才会显示出来，
                 *   并且就一直显示了，应该有个本地去记这件事的。」
                 *
                 * ⚠️ **只在 onBlur 判**，不在 onChange 判：
                 *    onChange 是逐字符触发的 —— 打 "5299" 会经过 "5" "52" "529"，判早了没用；
                 *    而且用 onChange 的话，把数字改成 5299 以外的合法值也会反复触发。
                 *    onBlur 是"输完离开"那一刻，语义正好。
                 *
                 * ⚠️ **解锁后立刻回填成正常值**：5299 显然不是"每轮想发 5299 条评论"，
                 *    那是输入这个暗号的副作用。所以解锁的同时把它改回原来的 1（或当前值），
                 *    否则配置里会留下一个荒唐的 commentPerRound=5299，
                 *    真跑一轮时会试图发 5299 条评论。
                 *    ⭐ 这是这个彩蛋**最容易埋雷**的地方 —— 别忘了。
                 */
                onBlur: () => {
                  const raw = String(perRound ?? '').trim()
                  if (raw === '5299' && !cfg.dmUnlocked) {
                    /**
                     * ⭐ 还原成**输入暗号之前那个值**（不是写死 1）。
                     *    使用者的原话：「输入完 5299 之后，commentPerRound
                     *    应该回归输入之前的设定才对。」
                     *    ⇒ 他原本填 3，输完暗号就该还是 3。
                     *    ⚠️ 兜底顺序：ref 记的 → 盘上 cfg 的 → 最后才 1。
                     *        （ref 可能是 null：比如页面刚开、还没离开过这个输入框。）
                     */
                    const prevRaw = perRoundBeforeEgg.current ?? cfg.commentPerRound
                    const prev = Math.max(1, Number(prevRaw) || 1)
                    // ① 解锁（持久化在 config.json，换浏览器也在）
                    patch({ dmUnlocked: true }, '私信通知')
                    // ② 把暗号从"条数"里清掉，还原成输入前的值
                    setPerRound(String(prev))
                    patch({ commentPerRound: prev }, '每轮几条评论')
                    note('已解锁「私信通知」—— 往下翻，在「说不说话」最下面', 'good')
                    return
                  }
                  const n = Math.max(1, Number(perRound) || 1)
                  setPerRound(String(n))
                  // ⭐ 记下"这次合法值"，供暗号命中时还原
                  perRoundBeforeEgg.current = n
                  patch({ commentPerRound: n }, '每轮几条评论')
                },
              })),
            h(Field, {
              label: '要通知谁（B站 昵称）',
              /**
               * ⭐ 文案要覆盖**两种用途**（2026-10-19 改）。
               *
               * 原来只写「留空就不发评论了」—— 那是**只想着评论**的说法。
               * 现在这一项在「只开私信、不开评论」时也会显示，而私信**也发给这个人**
               * （`prompts/dm.md` 的规矩就是发给 `mentionName`）⇒
               * 只说评论会让人以为"不开评论就不用填"，于是私信发不出去。
               *
               * ⭐ 2026-10-19 再改：字段名从「要 @ 谁」改成「**要通知谁**」——
               *    因为它现在管**两件事**（评论 @ 谁 / 私信发给谁），
               *    而"@ 谁"这个叫法只描述得了前一半。
               */
              /**
               * ⭐ 说明并进这一行（使用者要求「描述放到小节描述里」）：
               * 原来「评论时 @ 他」那个开关自带一行 note，把行撑歪 ⇒
               * 现在它的意思合到这里，开关本身**不再带说明文字**。
               */
              note: '评论里 @ 的、私信发的，都是这个人。⚠️ 要跟 B站 昵称逐字一致；留空 = 评论和私信都发不出去。'
                + '\n右边那个开关只影响「评论里要不要 @ 他」——关掉后评论照发、私信照发。',
              stack: true,
              children: h('div', { 'data-bd-inline': '' },
                h('input', {
                  'data-bd-input': '', value: mention ?? '',
                  placeholder: '填 B站 昵称；留空 = 评论和私信都不发',
                  onChange: (e) => setMention(e.target.value),
                  onBlur: () => { const v = String(mention || '').trim(); setMention(v); patch({ mentionName: v }, '要通知谁') },
                }),
                /**
                 * ⭐⭐ **「评论时 @ 人」开关**（2026-10-19 加，使用者要求）。
                 *
                 * 起因：一个字段管两件事（评论 @ 谁 / 私信发给谁）⇒
                 * 「开评论 + 开私信 + 评论不 @ 人」这个组合**表达不了**：
                 *   · 填名字 ⇒ 评论会 @ 他；
                 *   · 不填名字 ⇒ 评论被准入闸拦住。
                 * ⇒ 拆出这个开关：**收件人不变，只是评论正文里不去 @ 他。**
                 *
                 * ⚠️ **默认开** —— 老用户升级过来不会发现评论突然不 @ 了。
                 * ⚠️ 关掉**不影响私信**（私信照发给他）。
                 */
                /**
                 * ⭐⭐ **「评论时 @ 人」开关**（2026-10-19 加，使用者要求）。
                 *
                 * 起因：一个字段管两件事（评论 @ 谁 / 私信发给谁）⇒
                 * 「开评论 + 开私信 + 评论不 @ 人」这个组合**表达不了**：
                 *   · 填名字 ⇒ 评论会 @ 他；
                 *   · 不填名字 ⇒ 评论被准入闸拦住。
                 * ⇒ 拆出这个开关：**收件人不变，只是评论正文里不去 @ 他。**
                 *
                 * ⚠️ **默认开** —— 老用户升级过来不会发现评论突然不 @ 了。
                 * ⚠️ 关掉**不影响私信**（私信照发给他）。
                 *
                 * 🔴 **不能用 ToggleRow**（2026-10-19 使用者三次纠正后定稿）：
                 *    「你不觉的丑吗？开关靠右对齐啊」
                 *    「我就是要这个开关和要通知谁的输入框在一行。并排」
                 *    「开关要跟面板里其他开关右边缘对齐；开关的名字肯定要和开关
                 *      在一条水平线上，不是说他俩右对齐」
                 *    `ToggleRow` 自带 `[data-bd-row]` + grow + label + note，
                 *    塞进这个 inline 行里会把输入框挤歪、开关也不靠右。
                 * ⇒ 用**名字 + 光开关**的一小组（`[data-bd-switchgroup]`）：
                 *    · **横排**（`align-items:center`）⇒ 名字与开关同一水平线；
                 *    · 宽度由内容决定（`flex:0 0 auto`）⇒ 被输入框挤到最右；
                 *    · 这里**不加 `margin-left:auto`** —— 输入框已吃满剩余空间，
                 *      再加 auto 会把 gap 挤掉、间隔变得不确定。
                 * ⚠️ 说明文字已并进上面 `note`（使用者要求"描述放到小节描述里"）⇒
                 *    这里**不给 note**。
                 */
                h('div', { 'data-bd-switchgroup': '' },
                  h('div', { 'data-bd-swlabel': '' }, '评论时 @ 他'),
                  h(Switch, {
                    on: cfg.mentionInComment !== false,
                    onChange: (v) => patch({ mentionInComment: v }, '评论时 @ 人'),
                  }))),
            })) : null,

          /**
           * ⭐⭐ **私信通知**（2026-10-18 加，使用者要求）。
           *
           * 使用者原话：「加发私信通知的功能吧，**只需要一个开关**，
           *   所用的设置与自动评论 @ 一致，就最多发几条，以及发给谁。
           *   放在说不说话小节的最下面。」
           *
           * ⇒ 所以这里**只有一个开关**，不重复放"几条 / 发给谁"两个输入框 ——
           *   它们直接沿用上面「自动评论并 @ 你」那组（`commentPerRound` / `mentionName`）。
           *   ⚠️ 那样两个旋钮会打架：用户不知道该填哪个，而实际只有一个生效。
           *   ⇒ 说明里明确写"沿用上面那两项"，让人知道去哪改。
           *
             * ⚠️ 说明里还要写清它与评论的**关键差别**（私聊 vs 公开）——
             *   ⚠️ **但这条已被使用者推翻（2026-10-18）**：他不要在面板上解释这件事。
             *      那条规矩留在 `dm.md` 里给模型看就够了。
             *
             * ⚠️⚠️ **描述现在只剩两句**（使用者两次要求精简）：
             *    「挑中的视频会私信发给你，附视频链接。」
             *    「条数与收件人沿用上面那两项 —— 所以那个开关关着时同样生效。」
             *
             * 🔴 被删掉的是（**别再写回来**，使用者已明确否掉）：
             *    ·「和评论不一样：私信是私聊（只有你看到），正文里不会再 @ 你」
             *    ·「默认关；开关是独立的（可以只私信、不发公开评论，反之亦然）」
             *    ·「具体怎么写由家目录的 dm.md 规定，模型发之前会先读它」
             * ⇒ 判据：**开关本身就说明了默认状态与独立性**，再解释一遍就是复述；
             *    那几句把一条简短说明撑成了四行。
             */
          cfg.dmUnlocked ? h(ToggleRow, {
            label: '私信通知（发给你自己）',
            note: '挑中的视频会「私信」发给你，附视频链接。'
              + '\n条数与收件人「沿用上面『自动评论并 @ 你』那两项」 —— '
              + '所以那个开关关着时，这里的「最多几条」和「发给谁」同样生效。',
            on: sw('dmNotify'),
            onChange: (v) => patch({ dmNotify: v }, '私信通知'),
          }) : null,

          h(ToggleRow, {
            label: '回复评论（只回楼中楼）',
            note: '只回「直接回复到你那条评论下面的人」，不参与讨论',
            on: sw('replyToComments'),
            onChange: (v) => patch({ replyToComments: v }, '回复评论'),
          }),
          sw('replyToComments') ? h('div', { 'data-bd-sub': '' },
            h('div', { 'data-bd-row': '' },
              h('div', { 'data-bd-grow': '' },
                h('div', { 'data-bd-label': '' }, '每轮最多回几条')),
              h('input', {
                'data-bd-input': '', 'data-bd-num': '', type: 'number', min: 1,
                value: replyPer ?? '',
                onChange: (e) => setReplyPer(e.target.value),
                onBlur: () => { const n = Math.max(1, Number(replyPer) || 1); setReplyPer(String(n)); patch({ replyPerRound: n }, '每轮几条回复') },
              }))) : null),

        /* ════════ 五、怎么读（本地转写 —— 从「说不说话」里搬出来：这是"读"的事）════════ */
        h('div', { 'data-bd-sec': '', 'data-bd-tabin': 'settings' },
          h('div', { 'data-bd-h': '' }, '怎么读'),
          h(ToggleRow, {
            label: '没字幕的视频在本机转写',
            note: '默认关；开了以后没字幕的会在本机转一遍（不花 API 钱，但要下几百 MB 模型）',
            on: sw('transcribe'),
            onChange: (v) => patch({ transcribe: v }, '本地转写'),
          }),
          sw('transcribe') ? h('div', { 'data-bd-sub': '' },
            h('div', { 'data-bd-row': '' },
              h('button', { 'data-bd-btn': '', disabled: busy === 'asr', onClick: onInstallAsr },
                st.asrReady ? '重装转写依赖' : '装转写依赖'),
              h('div', { 'data-bd-grow': '' },
                h('div', { 'data-bd-note': '' },
                  !st.asrReady ? '还没装 —— 没装的话转写用不了'
                    : (st.asrModelReady ? '环境和模型都好了' : '环境好了；模型第一次转写时自动下')))),
            h('div', { 'data-bd-note': '' },
              '建一个独立环境、装 faster-whisper + yt-dlp，并把 Whisper 模型也下好（默认 small，走国内镜像）。'),
            st.asrTail ? h('div', null,
              h('div', { 'data-bd-note': '' }, st.asrInstalling ? '正在装（进度）：' : '转写依赖的日志（末尾）：'),
              h('pre', { 'data-bd-pre': '' }, st.asrTail)) : null) : null),


        /* ════════ 七、它的人设（长文本 ⇒ 留保存按钮）════════ */
        /* ════════ 七、它的人设（→ 子导航「提示词」页）════════ */
        h('div', { 'data-bd-sec': '', 'data-bd-tabin': 'prompt' },
          h('div', { 'data-bd-h': '' }, '它的人设'),
          h(ToggleRow, {
            label: '启用下面这份人设',
            note: '关掉的话它就中性出场，不扮演任何人格',
            on: sw('personaEnabled'),
            onChange: (v) => patch({ personaEnabled: v }, '启用人设'),
          }),
          sw('personaEnabled') ? h('div', { 'data-bd-sub': '' },
            h('textarea', {
              'data-bd-input': '', 'data-bd-persona': '', rows: 12,
              placeholder: '写它的说话方式与准则。例如：\n· 叫我「老板」，说话短、别客套\n· 只推我看得懂的技术内容，别推营销号\n· 拿不准的事就说没查到，不许编',
              value: persona ?? '',
              onChange: (e) => setPersona(e.target.value),
            }),
            h('div', { 'data-bd-foot': '' },
              h('button', { 'data-bd-btn': '', 'data-primary': '', disabled: busy === 'persona', onClick: onSavePersona }, '保存人设'),
              h('button', {
                'data-bd-btn': '', disabled: busy === 'persona' || !(persona || '').trim(),
                onClick: () => { setPersona('') },
              }, '清空'),
              (persona !== null && personaSaved !== null && persona !== personaSaved)
                ? h('span', { 'data-bd-note': '' }, '有未保存的改动') : null),
            h('div', { 'data-bd-note': '' },
              personaChars != null ? `当前 ${personaChars} 字符` : '',
              personaChars != null ? h('br') : null,
              '存本地：', h('code', null, personaFile || ''),
              h('br'),
              '每一轮开始前现读这个文件 —— 保存后立刻生效，不用重启 dsh。')) : null),

        /* ════════ 七之二、回复评论的细则（→ 子导航「提示词」页）════════
           ⭐ 与人设同一套路，但**多一个「恢复默认」**（它有出厂源）。
           ⚠️ 只有「回复评论」开着时**才会注入到提示词里** —— 那个开关在「功能设置」页，
              所以这里要说明归属，免得使用者找不着。 */
        h('div', { 'data-bd-sec': '', 'data-bd-tabin': 'prompt' },
          h('div', { 'data-bd-h': '' }, '回复评论的细则'),
          h('div', { 'data-bd-note': '' },
            '这份只在「回复评论」开着时起作用（那个开关在「功能设置」页）—— '
            + '开着时它会在每一轮开头整份注入给模型，所以这里写的东西一定会被看到。'),

          h('div', { 'data-bd-sub': '' },
            h('textarea', {
              'data-bd-input': '', 'data-bd-persona': '', rows: 16,
              placeholder: '（读不到 reply.md —— 点「恢复默认」拿一份出厂的回来）',
              value: reply ?? '',
              onChange: (e) => setReply(e.target.value),
            }),
            h('div', { 'data-bd-foot': '' },
              h('button', { 'data-bd-btn': '', 'data-primary': '', disabled: busy === 'reply', onClick: onSaveReply }, '保存细则'),
              h('button', {
                'data-bd-btn': '', disabled: busy === 'reply' || !(reply || '').trim(),
                onClick: () => { setReply('') },
              }, '清空'),
              // ⭐ **恢复默认**：会覆盖你改过的内容 ⇒ 先弹确认（见下面那个浮层）
              //    🔴 禁用判据必须用**当前草稿**跟出厂正文比，不能用服务端那个快照
              //       （快照在"改了没存"时是过期值 ⇒ 按钮会卡在禁用，反而没法恢复）。
              h('button', {
                'data-bd-btn': '',
                disabled: busy === 'reply'
                  || !replyDefaultText
                  || String(reply ?? '').trim() === replyDefaultText.trim(),
                onClick: () => setConfirmReset(true),
              }, (replyDefaultText && String(reply ?? '').trim() === replyDefaultText.trim())
                ? '已是默认' : '恢复默认'),
              (reply !== null && replySaved !== null && reply !== replySaved)
                ? h('span', { 'data-bd-note': '' }, '有未保存的改动') : null),
            h('div', { 'data-bd-note': '' },
              replyChars != null ? `当前 ${replyChars} 字符` : '',
              replyChars != null ? h('br') : null,
              '存本地：', h('code', null, replyFile || ''),
              h('br'),
              '每一轮开始前现读这个文件 —— 保存后立刻生效，不用重启 dsh。',
              h('br'),
              '⚠️ 「恢复默认」会覆盖你现在这份（从插件自带的出厂那份重新读），不可撤销。')),

          /* ── 确认弹层（恢复默认是破坏性操作）──
             ⚠️ 用自绘浮层而不是 window.confirm：面板在不同宿主里的原生弹框表现不一，
                而且这个面板本来就是右栏里的一块，原生弹框会脱离上下文。 */
          confirmReset ? h('div', { 'data-bd-confirm': '' },
            h('div', { 'data-bd-confirm-box': '' },
              h('div', { 'data-bd-confirm-title': '' }, '恢复成出厂的细则？'),
              h('div', { 'data-bd-confirm-body': '' },
                '你现在这份会被覆盖，改过的内容找不回来。',
                h('br'),
                '（要留个底的话，先复制上面的正文再点。）'),
              h('div', { 'data-bd-confirm-foot': '' },
                h('button', { 'data-bd-btn': '', onClick: () => setConfirmReset(false) }, '取消'),
                h('button', { 'data-bd-btn': '', 'data-danger': '', onClick: onResetReply }, '覆盖并恢复')))) : null),

        /* ════════ 有新版本的弹窗（2026-10-18 加）════════
           ⭐ 复用的是「恢复默认」那个确认弹层（`data-bd-confirm`）——
              自绘浮层而不是 window.confirm，理由见上面那段注释。
           ⭐ 使用者要求：弹窗里要有「查看更新内容」按钮，点了跳转去看更新内容。 */
        showUpdateDlg && st.update?.hasNew
          ? h('div', { 'data-bd-confirm': '' },
            h('div', { 'data-bd-confirm-box': '' },
              h('div', { 'data-bd-confirm-title': '' }, '检测到有新版本'),
              h('div', { 'data-bd-confirm-body': '' },
                `新版 ${st.update.latest || '?'}（你现在 ${st.update.current || st.version || '?'}）。`,
                h('br'),
                '升级会从国内镜像（npmmirror）装新版，装完' + restartSentence() + '。'),
              /**
               * ⭐⭐ **更新内容直接在弹窗里显示**（2026-10-18 改）。
               *
               * 为什么改：原来点「查看更新内容」是**跳去 GitHub Releases** ——
               *   ① 国内打开 GitHub 不稳；② 那个页面的正文当时还是**空的**。
               * ⇒ 现在：点按钮 ⇒ 后端从 **jsDelivr**（有国内 CDN）拉仓库里的
               *   `CHANGELOG.md`、切出这一版 ⇒ **正文直接铺在弹窗里**，不跳走。
               *
               * ⚠️ 正文是 markdown 的**纯文本**：面板没有 markdown 渲染器（本项目既有事实），
               *    所以用 `white-space:pre-wrap` 保留换行，不硬塞 HTML。
               */
              showChangelog
                ? h('div', null,
                  h('div', { 'data-bd-note': '' },
                    showChangelog.loading ? '正在取更新内容…'
                      : showChangelog.error ? ('取不到：' + showChangelog.error)
                        : `这一版（${showChangelog.version || '?'}）改了什么：`),
                  showChangelog.text
                    ? h('pre', { 'data-bd-pre': '', 'data-bd-clog': '' }, showChangelog.text)
                    : null)
                : null,
              h('div', { 'data-bd-confirm-foot': '' },
                h('button', { 'data-bd-btn': '', onClick: () => { setShowUpdateDlg(false); setShowChangelog(null) } }, '以后再说'),
                h('button', {
                  'data-bd-btn': '', 'data-primary': '',
                  /**
                   * ⭐ 「查看更新内容」：**在弹窗里展开**（不跳走）。
                   * ⚠️ 只在需要时拉一次（`showChangelog.text` 有值就不再请求）。
                   * ⚠️ `?version=` 明确指定要哪一版 —— 否则后端会退化成"当前版本"，
                   *    而使用者想看的是**新版**改了什么。
                   */
                  disabled: Boolean(showChangelog?.loading),
                  onClick: async () => {
                    if (showChangelog?.text) return   // 已经拿到了，不用再拉
                    setShowChangelog({ loading: true })
                    try {
                      const r = await jget('/changelog?version=' + encodeURIComponent(st.update.latest || ''))
                      if (r?.ok) setShowChangelog({ text: r.text || '', version: r.version })
                      else setShowChangelog({ error: r?.error || '没拿到内容' })
                    } catch (e) { setShowChangelog({ error: String(e?.message ?? e) }) }
                  },
                }, showChangelog?.text ? '已显示在下面' : '查看更新内容'),
                h('button', {
                  'data-bd-btn': '',
                  /**
                   * ⭐⭐ **点「直接升级」后要跳到「环境与账号」页**（2026-10-18 使用者提）。
                   *
                   * 为什么：升级是**异步**的，它把过程写进 `<家>\install.log`，
                   * 而那段滚动的日志**就在「环境与账号」页**。
                   * 不跳的话，用户点完只看到弹窗关了 -> **什么都看不见**
                   * ⇒ 以为按钮没反应（这正是"好像也没升级"那类误解的来源之一）。
                   *
                   * ⚠️ 顺序：**先关弹窗 -> 切页 -> 再触发升级**。
                   *    先切页后关弹窗的话，弹窗会盖在新页面上，看着像"没反应"。
                   */
                  onClick: () => { setShowUpdateDlg(false); setShowChangelog(null); setTab('env'); onUpgrade() },
                }, '直接升级')))) : null,
        /* ════════ 八、环境与账号（→ 子导航「环境与账号」页）════════ */
        h('div', { 'data-bd-sec': '', 'data-bd-tabin': 'env' },
          h('div', { 'data-bd-h': '' }, '环境与账号'),
          h('div', { 'data-bd-note': '' },
            !st.venvReady ? (st.installFailed ? '上次没装成 → 看下面日志' : '还没装 → 先点「装主依赖」')
              : (st.loggedIn ? '装好了、也登录了' : '环境好了 → 点「扫码登录」')),
          h('div', { 'data-bd-row': '' },
            h('button', { 'data-bd-btn': '', disabled: busy === 'install', onClick: onInstall },
              st.venvReady ? '重装主依赖' : '装主依赖'),
            h('button', { 'data-bd-btn': '', disabled: busy === 'login', onClick: onLoginStart }, '扫码登录'),
            h('button', { 'data-bd-btn': '', disabled: busy === 'check', onClick: onCheck }, '测一下'),
            h('button', { 'data-bd-btn': '', disabled: busy === 'update', onClick: onCheckUpdate }, '检查更新'),
            /**
             * ⚠️ **`newVer` 现在装的是【版本号】了**（2026-10-18 改）。
             *    旧注释写的是"装着 commit sha 前 7 位、所以别写 v 前缀"——
             *    那是 sha 时代的话。现在 `checkUpdate` 比的是 npm 版本号，
             *    给它加 `v` 前缀反而更清楚（和顶栏那个 `v0.1.4` 同一个写法）。
             */
            newVer ? h('button', { 'data-bd-btn': '', 'data-primary': '', disabled: busy === 'upgrade', onClick: onUpgrade }, '升级到 v' + newVer) : null),
          loginState ? h('div', { 'data-bd-msg': '', 'data-good': loginTone === 'good' ? '' : undefined, 'data-warn': loginTone === 'warn' ? '' : undefined }, loginState) : null,
          login?.qr ? h('div', { 'data-bd-qr': '' },
            h('img', { src: login.qr, alt: 'B站登录二维码' }),
            h('div', { 'data-bd-note': '' },
              '手机 B站 → 我的 → 扫一扫。',
              h('br'),
              '确认时选「记住我 / 长期」那张 —— 选 24 小时的话，明天就得重扫。')) : null,
          st.installTail ? h('div', null,
            h('div', { 'data-bd-note': '' }, st.installing ? '正在装主依赖（进度）：' : '主依赖的日志（末尾）：'),
            h('pre', { 'data-bd-pre': '' }, st.installTail)) : null),

        /* ════════ 实验功能（→ 子导航「实验功能」页，2026-10-17 加）════════
           ⭐ 这一页放"打开就会改变行为边界"的开关。 */
        h('div', { 'data-bd-sec': '', 'data-bd-tabin': 'lab' },
          h('div', { 'data-bd-h': '' }, '实验功能'),
          h('div', { 'data-bd-note': '' },
            '这里的开关会改变它的行为边界 —— 打开前先读完说明。'),

          h(ToggleRow, {
            label: '管理员权限',
            // ⚠️ 面板是**纯文本**（不渲染 markdown）⇒ 这里**不能写星号**（会被原样显示）。
            //    守卫 tools/check-client-css.mjs 会查这个。
            note: '默认关闭。关着时：刷B站那套限制（评论开关 / 判重 / 每轮额度）无论如何都绕不过去，'
              + '工具里的 force、repeat 参数也完全失效。'
              + '打开后：在这个会话里，使用者本人亲口说的话就是最高指令 —— 包括"多发一条""重发""换个做法"，'
              + '工具被打回时也可以让它带着参数再试。',
            on: sw('adminMode'),
            onChange: (v) => patch({ adminMode: v }, '管理员权限'),
          }),

          /*
           * ⭐⭐ **自由描述「关注什么」**（2026-10-18 加）。
           *
           * 使用者要的是：「用户就纯自然语言写一段话，也不需要考虑换行分隔，
           *   让模型自己去理解用户需要关注哪些东西，关注一件事还是多件事。
           *   另外比如用户指定去关注某些账号的内容而不是主题的时候，模型也应该能够理解和区分。」
           *
           * ⚠️ 说明里要讲清**两种模式真正的差别**（不是"写法不同"，是"表达力不同"）：
           *   一行一个只能写"搜索主题"；一段话能写账号、排除条件、背景。
           */
          h(ToggleRow, {
            label: '自由描述关注点',
            /**
             * ⚠️ 文案里的「默认开启」必须与 `index.js` 的 schema 默认值**一致** ——
             *    两处不同步时，用户会看到"写着默认开、实际却是关"，那比不说更糟。
             *    （2026-10-18 晚：使用者定「这个功能应该默认开启」⇒ 默认值已改 true。）
             */
            note: '默认开启。开着时：「关注什么」可以随便写一段话，不用分行 —— '
              + '模型会自己判断你要关注几件事、分别是什么。'
              + '一段话还能写进"一行一个"表达不了的东西：'
              + '「顺便看看某个 UP 主」（会按账号去取他的投稿，而不是搜他的名字）、'
              + '「不要入门教程那种」（当作筛选条件）、「最近在搞 RAG」（当背景）。'
              + '关掉则回到「一行一个主题」的写法，适合"我要关注这几件事"。'
              + '⚠️ 两种模式都仍然是让模型自己组合搜索词去搜，区别只在"你能把意思说多清楚"。',
            on: sw('freeformWatch'),
            onChange: (v) => patch({ freeformWatch: v }, '自由描述关注点'),
          })),

          /* ⚠️ 这里原来有三块「开关状态」条件渲染，2026-10-18 按使用者要求全部删掉 ——
             使用者原话：「开关下面的状态那些都不要。3 行已打开都不要。」
             删的是：① / ② 「已打开 —— 去「功能设置 → 怎么找」里写…」（同一句复制了两遍）
                     ③ 「⚠️ 已打开。这个会话是标准模式…建议关掉。」
             ⭐ 判据：这些报的是**开关的当前状态**（开关本身就是状态），
                而「去哪写」已经写在开关的说明里 ⇒ 重复且吵。
             要恢复：在 lab 那段里加回 sw(名字) ? h(...) : null 即可。 */

        /* ════════ dsh 启动器（→「环境与账号」页）════════
           ⭐ 2026-10-17 加这一项（以前面板里根本没有，只能手工改 config.json）。
           🔴 2026-10-18 改：**默认不让人填**。
           使用者原话：「这个没有办法自动获取的吗？如果有的话，这个东西是不应该让用户自己设置的啊」。
           ⇒ 他是对的：自动探测**本来就有**（插件自己就住在 dsh 里 ⇒ `process.argv[1]`；
             桌面版走 `resourcesPath` 里的 app.asar），所以这一块现在**先报自动找到的是什么**，
             输入框只在探测失败（或已经手填过）时才出现。详见 `renderDshBlock`。
           ⚠️ 只影响**后台**模式（前台是在主应用里建会话，不 spawn 子进程）。 */
        renderDshBlock(st, cfg, { draft: dshBinDraft, setDraft: setDshBinDraft, patch }),

        /* ════════ 九、它的地盘（产物与路径 → 子导航「功能设置」页）════════ */
        h('div', { 'data-bd-sec': '', 'data-bd-tabin': 'settings' },
          h('div', { 'data-bd-h': '' }, '它的地盘'),
          h('div', { 'data-bd-kv': '' },
            `家目录：${st.home}`,
            h('br'),
            `产物目录：${st.reportDir || '（读不到）'}`),
          h('div', { 'data-bd-row': '' },
            h('button', { 'data-bd-btn': '', disabled: busy === 'reports', onClick: onListReports },
              reports !== null ? '收起清单' : '看产物'),
            h('button', { 'data-bd-btn': '', onClick: () => onOpenFolder('out') }, '打开产物文件夹'),
            h('button', { 'data-bd-btn': '', onClick: () => onOpenFolder('home') }, '打开家目录')),
          reports !== null
            ? (reports.files?.length
              ? h('div', null,
                  h('div', { 'data-bd-note': '' }, `共 ${reports.count} 份，最近的排前面（点「看」打开内容）：`),
                  h('div', null, reports.files.map((f) => h('div', { 'data-bd-row': '', key: f.name },
                    h('div', { 'data-bd-grow': '' },
                      h('div', { 'data-bd-note': '' }, `${f.name}　${Math.round(f.size / 1024)}KB`)),
                    h('button', {
                      'data-bd-btn': '',
                      onClick: async () => {
                        try { const r = await jget('/report-file?name=' + encodeURIComponent(f.name)); setReportFile(r?.text || '（空的）') }
                        catch (e) { setReportFile('读不到：' + String(e?.message ?? e)) }
                      },
                    }, '看')))),
                  reportFile !== null ? h('pre', { 'data-bd-pre': '' }, reportFile) : null)
              : h('div', { 'data-bd-note': '' }, '还没有产物 —— 跑一轮之后，挑中的每条会各写一份 md。'))
            : null),
      )
    }

    /** 右侧栏 tab 类型 id；也是 `sidebar.right.pane.tab` 那个 keyed 槽的键。 */
    const TAB_ID = 'bili-scroll'
    /** tab 类型的 kind：openTab 用它指名；不能与内置重名（见文件头）。 */
    const TAB_KIND = 'bili-scroll'

    /**
     * 右侧栏 tab 的本体 = 当前这个面板组件（**不是 iframe**）。
     *
     * 为什么不像别的插件那样嵌 iframe：本插件的面板**本来就是 React 组件**
     * （`Panel` 就在本文件里），直接复用最省事 —— 没有 iframe 的高度/滚动条打架问题，
     * 也不用再发一份页面出去。（若面板是独立 HTML，那才该用 iframe。）
     *
     * 🔴 **它必须定义在 `apply()` 里面**（2026-10-16 真机抓到的 bug）：
     *    第一版把它放在这里（模块顶层），而 `openSession` 是 `apply()` 里的局部变量
     *    ⇒ 渲染时抛 `ReferenceError: openSession is not defined`，
     *    表现为 **右侧栏那个 tab 整块崩掉**（`slot entry crashed in 'sidebar.right.pane.tab'`）。
     *    ⚠️ 离线探针与 `selfcheck` **都抓不到这个**（它们不渲染组件）——
     *       只有真机点开面板才会暴露。⇒ 这类"作用域/渲染"问题**必须真机验**。
     *    ⇒ 现在改成：`makeTab(resolveOpenSession)` 在 `apply()` 里调用，
     *      而且传的是**解析函数**（点击时现取服务），不是那一刻的值。
     */
    function makeTab(resolveOpenSession) {
      return function BiliScrollTab() {
        // 🔴 **必须现取，不能按值捕获**（2026-10-16 真机抓到）：
        //    `openSession` 由 `ctx.inject(['uiWorkspace'], cb)` **异步**填上，
        //    而 tab 本体在 `apply()` 里**同步**注册
        //    ⇒ 按值传的话注册那刻拿到 `null`，之后填上也改不了已捕获那份
        //      ⇒ 按钮永远说"拿不到跳转能力"。
        //    ⚠️ 所以这里传的是**解析函数**，按钮**点击时**才真正取服务。
        return h('div', { 'data-bd-tabwrap': '' }, h(Panel, { resolveOpenSession }))
      }
    }

    return {
      /**
       * ⭐ **给探针用**（不是 DSH 认的字段，纯导出）——
       *    「dsh 那一块」是个纯函数才能被离线渲染验证。
       *    ⚠️ DSH 只读 `inject` / `apply`，多一个字段不影响加载。
       */
      renderDshBlock,
      /** ⭐ 给探针用（同上）：两种「关注什么」模式的分支要能被离线渲染验证。 */
      renderWatchBlock,
      /**
       * ⭐ 给探针用（同上）：顶栏徽章那几个分支（有新版本 / 没新版 / 还没查过 / 后台在跑）。
       *    靠真机验是"要等真出新版才看得到" ⇒ 必须能离线渲染。
       */
      renderVersionBadges,
      /**
       * ⚠️ 这里是**客户端服务短名**，不是包名。
       *    包名那份在 package.json 的 `dsh.client.inject`（两处含义不同）。
       *    `sidebarRightTabs` 由 `@deepseek-ai/dsh-client-ui-sidebar-right` 提供。
       *    ⭐ `uiWorkspace`（2026-10-16 加）—— 前台跑完之后用它 `openSession()` 跳到那个会话。
       *       ⚠️ 它由 `@deepseek-ai/dsh-client-ui-workspace` 提供 ⇒ package.json 那份也要加。
       */
      inject: ['slots', 'sidebarRightTabs', 'uiWorkspace'],
      apply(ctx) {
        const style = document.createElement('style')
        style.setAttribute('data-plugin-css', 'dsh-bili-duty')
        style.textContent = CSS
        document.head.appendChild(style)
        ctx.effect(() => () => style.remove(), 'dsh-bili-duty: 面板样式')

        /**
         * ⚠️ **`pickDirectory` 已删**（2026-10-18）。
         *
         * 它原来只为「会话建在哪个目录」那个按钮服务（走 `ctx.uiWorkspace.pickDirectory()`），
         * 而那一整块已按使用者要求从面板去掉 ⇒ 这段没有消费者了。
         *
         * ⭐ 要恢复的话（比如以后又想让用户选目录）：
         *   `const ws = ctx.get('uiWorkspace'); ws.pickDirectory()   // Promise<string|null>，null=取消`
         *   ⚠️ 与 `openSession` 同样要**每次现取**（它是异步 inject 填上的）。
         */

        /**
         * ⭐ **跳到某个会话**（前台跑完之后用）。
         *
         * 照 memj 的做法（库内条目 `8be4b18d`）：**必须走 `ctx.inject` + `scope.get`**，
         * 不能 `ctx.uiWorkspace`（属性访问是 undefined）。
         * `openSession(target: SessionTarget)` 是**同步**的、直接传 id 字符串即可
         * —— 它就是"点侧栏里那条会话"走的那条路。
         *
         * 🔴 **这里是异步填上的**（inject 回调何时跑由 DSH 定）⇒ 不能按值传给组件，
         *    必须给一个**解析函数**，点击时现取（真机踩过：按值传永远是 null）。
         */
        /** inject 那条路填上的跳转函数（可能一直是 null）。 */
        let injectedOpenSession = null
        const resolveOpenSession = () => {
          if (injectedOpenSession) return injectedOpenSession
          // 兜底：有些版本 `ctx.get` 直接拿得到
          try {
            const ws = ctx.get('uiWorkspace')
            if (ws && typeof ws.openSession === 'function') return (id) => ws.openSession(id)
          } catch { /* 取不到就是 null */ }
          return null
        }
        // ⚠️ 两条路都试，谁先能拿到就用谁（`resolveOpenSession` 每次现查 ⇒ 后填上的也能用）。
        try {
          ctx.inject(['uiWorkspace'], (scope) => {
            const ws = scope.get('uiWorkspace')
            if (ws && typeof ws.openSession === 'function') {
              injectedOpenSession = (id) => ws.openSession(id)
            }
          })
        } catch (e) {
          // ⚠️ 拿不到不算致命：面板上那个按钮会显示"这个环境不支持跳转"，而不是静默没反应。
          console.warn('[dsh-bili-scroll] inject uiWorkspace 失败，改用 ctx.get 兜底：', e)
        }

        const slots = (typeof ctx.get === 'function' ? ctx.get('slots') : undefined) || ctx.slots
        if (!slots) return

        // ── ① tab 类型定义：让它在右侧栏「开始」页出现一张卡 ──
        //    整段包 try/catch：boot 对「任一 entry 未激活」是致命的，
        //    宁可本插件没入口，也不能把整页 boot 拖垮。
        try {
          ctx.sidebarRightTabs.register({
            id: TAB_ID,
            kind: TAB_KIND,
            // `extension` = 可被 builtin 覆盖的扩展带；三值只有 extension / builtin / fallback。
            priority: 'extension',
            keepMounted: true,                 // 切走/换会话不卸载，否则每次展开都回首页
            title: () => '刷B站',
            guide: [
              {
                id: 'panel',
                order: 40,                     // 排在 wb-switch(30) 之后
                title: () => '刷B站',
                description: () => '每天替你看一轮 B站、挑出值得的，每条各写一份笔记',
              },
            ],
          })
        } catch (e) { console.error('[dsh-bili-duty] 注册右侧栏 tab 类型失败：', e) }

        // ── ② tab 本体（🔴 只注册 ① 的卡是点不动的）──
        //    key 必须是 ① 里的 `id`，不是 `kind`。
        //    ⭐ 组件在**这里**建，并把**解析函数**给它（`uiWorkspace` 是异步填上的，
        //       按值传会拿到 null ⇒ 按钮永远说"拿不到跳转能力"，真机踩过）。
        try {
          const Tab = makeTab(resolveOpenSession)
          ctx.effect(() => slots.inject('sidebar.right.pane.tab', () =>
            slots.register({ name: 'sidebar.right.pane.tab', key: TAB_ID }, Tab),
          ), 'bili-duty: 右侧栏 tab 本体')
        } catch (e) { console.error('[dsh-bili-duty] 注册右侧栏 tab 本体失败：', e) }

        // ── ③ tab 标题芯片（可选；不注册会用 ① 的 title()）──
        try {
          ctx.effect(() => slots.inject('sidebar.right.pane.tab.title', () =>
            slots.register(
              { name: 'sidebar.right.pane.tab.title', key: TAB_ID },
              function BiliScrollTitle() { return h('span', null, '刷B站') },
            ),
          ), 'bili-duty: 右侧栏 tab 标题')
        } catch (e) { console.error('[dsh-bili-duty] 注册右侧栏 tab 标题失败：', e) }
      },
    }
  },
})
