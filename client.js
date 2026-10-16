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

    const API = '/api/bili-duty'
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
 */
[data-bd-top]{position:sticky;top:0;z-index:6;
  margin:0 -16px 8px;padding:16px 16px 12px;
  background:var(--dsw-alias-bg-base,#fff);
  box-shadow:0 1px 0 0 var(--dsw-alias-border-l2,#0000001a);}

/* ── 页面 ── */
[data-bd-page]{display:flex;flex-direction:column;}
[data-bd-sec]{display:flex;flex-direction:column;}

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
[data-bd-top]+[data-bd-sec]{border-top:0;margin:0 -16px;padding:0 16px;}

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
[data-bd-input],[data-bd-select]{width:100%;box-sizing:border-box;padding:7px 10px;
  border-radius:var(--dsw-radius-sm,8px);font-family:inherit;
  font-size:var(--dsw-font-xxs-12-font-size,12px);line-height:18px;
  border:1px solid var(--dsw-alias-border-l3,#0000001f);
  background:var(--dsw-alias-bg-layer-1,#fff);color:var(--dsw-alias-label-primary,#0f1115);}
[data-bd-select]{cursor:pointer;}
[data-bd-input]:focus,[data-bd-select]:focus{outline:none;
  border-color:var(--dsw-focus-ring-color,var(--dsw-alias-brand-primary,#0f1115));}
[data-bd-input]::placeholder{color:var(--dsw-alias-label-tertiary,#81858c);}
[data-bd-num]{width:92px;text-align:center;}
[data-bd-persona]{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
  line-height:1.55;resize:vertical;min-height:120px;}

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
      // ⭐ 目录选择器（给「前台工作区」用）；拿不到就是 null
      const doPickDirectory = (props && props.doPickDirectory) || null
      const [st, setSt] = useStatus(5000)
      const [busy, setBusy] = React.useState('')
      // （旧的 msg/msgTone 已删：提示统一走 runNote 那个浮现式 toast，见 say()）
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
      // ⭐ 前台会话的工作区（2026-10-16 加）：空 = 用默认（家目录下的 front-sessions）
      const [wsPath, setWsPath] = React.useState(null)
      const [wsBusy, setWsBusy] = React.useState(false)
      // ⭐ 产物清单（2026-10-16 加：改成每条一份 md，不再是汇总日报）
      const [reports, setReports] = React.useState(null)
      const [reportFile, setReportFile] = React.useState(null)
      const [rl, setRl] = React.useState(null)          // 日报形态：full / brief / off
      const [newVer, setNewVer] = React.useState('')    // 发现的新版本号（空 = 没发现）
      // ⚠️ 输入框必须绑"本地草稿"：页面每 5 秒轮询 /status，服务端那份会把 config 盖掉
      //    ⇒ 直接绑 cfg 的话，用户打字打到一半就被冲没了 ✗（2026-10-14 陌生人验收时抓到）
      const [perDay, setPerDay] = React.useState(null)
      const [perRound, setPerRound] = React.useState(null)
      const [replyPer, setReplyPer] = React.useState(null)
      const [mention, setMention] = React.useState(null)
      const [login, setLogin] = React.useState(null)
      const [runNote, setRunNote] = React.useState(null)
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
      // ── 模型（2026-10-15 新增）──
      // 清单从 /models 拉（**不硬编码**：DSH 的 provider/模型由使用者装的路由决定）
      const [models, setModels] = React.useState(null)          // [{id,name,models:[{id,name}]}]
      const [modelsNote, setModelsNote] = React.useState('')
      const [mProvider, setMProvider] = React.useState(null)
      const [mModel, setMModel] = React.useState(null)
      const [mEffort, setMEffort] = React.useState(null)

      const cfg = st?.config
      React.useEffect(() => {
        if (cfg && kws === null) setKws((cfg.keywords || []).join('\n'))
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
        if (st && wsPath === null) setWsPath(String(st.frontWorkspace || ''))
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
       */
      const toastTimer = React.useRef(null)
      const toastBox = React.useRef(null)
      const say = (text, tone) => {
        if (!text) { setRunNote(null); return }
        // ⭐ 横向量面板、纵向量屏幕（两把尺子，见上面的注释）
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
        setRunNote({ t: text, tone: tone || '', style })
        if (toastTimer.current) { clearTimeout(toastTimer.current); toastTimer.current = null }
        // 错误提示留久一点（要看清），成功提示 2.6s 够读
        const ms = (tone === 'warn' ? 6000 : 2600)
        toastTimer.current = setTimeout(() => { setRunNote(null); toastTimer.current = null }, ms)
      }
      // 组件卸载时清掉定时器（不清的话，卸载后 setState 会报警告）
      React.useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current) }, [])

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

      const onUpgrade = async () => {
        setBusy('upgrade')
        try {
          const r = await jpost('/upgrade', {})
          say((r && r.hint) || '正在升级', 'good')
          say('升级过程写在下面的「主依赖的日志」里 —— 完了记得重启一次 dsh（不重启还是旧版）', 'warn')
        } catch (e) { say(String(e?.message ?? e), 'warn') } finally { setBusy('') }
      }

      /**
       * 「检查更新」—— ⭐ 查的是**我们自己的仓库**（`jojoman2024/dsh-bili-scroll`），
       * 判据是 **commit sha**（不是版本号：fork 之后 version 一直没动，比不出来）。
       *
       * 🔴 `direction` 的语义（后端实测确认，别凭直觉改）：
       *    `ahead`     = 仓库 main 领先本地 ⇒ **有新版**
       *    `behind`    = main 落后本地     ⇒ 本地更超前，不用升
       *    `identical` = 一样             ⇒ 最新
       */
      const onCheckUpdate = async () => {
        setBusy('update')
        try {
          const r = await jget('/update')
          if (!r || !r.ok) {
            say('查不到最新版（可能网络不通）：' + ((r && r.error) || '未知原因'), 'warn')
            return
          }
          const mine = r.currentSha ? '（你这版 ' + r.currentSha + '）' : ''
          if (r.hasNew) {
            setNewVer(r.latest || '有新版')
            say('仓库有新版' + (r.latest ? ' ' + r.latest : '') + (r.aheadBy ? '，领先你 ' + r.aheadBy + ' 个提交' : '')
              + ' —— 点右边的「一键升级」，完了重启一次 dsh', 'warn')
          } else if (!r.currentSha) {
            // 没有本地 git（比如从 npm 装的）⇒ 只能说"仓库最新到哪儿"
            say('你这版没带 git 信息，没法比新旧；仓库 main 最新是 ' + (r.latest || '?'), 'warn')
          } else if (r.direction === 'identical') {
            say('已经是最新版' + mine, 'good')
          } else if (r.direction === 'behind') {
            // main 落后本地（自己改过还没推）⇒ 别谎报"有新版本"
            say('你这版比仓库 main 还超前' + (r.behindBy ? ' ' + r.behindBy + ' 个提交' : '') + ' —— 不用升级', 'good')
          } else {
            say('当前状态：' + (r.direction || '未知') + mine, 'good')
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
          if (r?.started) {
            if (r.mode === 'front') {
              // ⭐ 前台：会话已经建好了。**直接跳过去**，你就能看着它跑
              //    （这正是前台模式的意义 —— 后台那轮你看不见）。
              setRunNote({ tone: 'good', t: `已建前台会话（${r.sessionId || ''}），正在跳过去…` })
              const openSession = resolveOpenSession()   // 点击时才取服务
              if (openSession && r.sessionId) {
                try { openSession(r.sessionId) } catch (e) { setRunNote({ tone: 'warn', t: `会话建好了，但跳转失败：${String(e?.message ?? e)}` }) }
              } else if (r.sessionId) {
                setRunNote({ tone: 'warn', t: `会话建好了（${r.sessionId}），但这个环境拿不到跳转能力 —— 去左侧会话列表里找「刷B站 …」` })
              }
            } else {
              say('已经在后台跑一轮了，报告会写在 out/ 里', 'good')
            }
          } else {
            // ⚠️ 如实回显失败原因（前台模式失败的原因往往是"服务拿不到"，不是"跑挂了"）
            setRunNote({ tone: 'warn', t: r?.error ? `没起来：${r.error}` : '没起来，看 duty.log' })
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

      // ⭐ 保存模型选择：写进 config，下一轮 overlay 会把它覆盖进那一轮
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
       * ══════════════════════════════════════════════════════════════════ */
      return h('div', { 'data-bd-page': '' },

        /* ⭐ **浮现式提示**：整块面板共用**一个** toast。
           半透明黑底白字、浮在**面板**正中偏下（屏幕 2/3 处）、不吃排版、2.6 秒自己消失
           —— 坐标是 say() 量了面板外框与屏幕高度算出来的（见那边的注释）。 */
        runNote ? h('div', { 'data-bd-toast': '', ref: toastBox, style: runNote.style || undefined },
          h('div', null, runNote.t)) : null,

        /* ── 顶栏：状态 + 手动跑（⭐ sticky，不跟着滚）── */
        h('div', { 'data-bd-top': '' },
          h('div', { 'data-bd-row': '' },
            // ⭐ 「今天已挑 N / M 条」那个计数据使用者要求**去掉了**（2026-10-16）——
            //    它每天归零、又和「拉多少次/记多少条」不是一回事，摆在这儿反而费解。
            //    ⚠️ `st.ranToday` 后端仍照常统计（`/status` 里有），只是面板不显示了。
            h('span', { 'data-bd-badge': '' }, '环境' + (st.venvReady ? '已就绪' : (st.installing ? '正在装' : '未装'))),
            h('span', { 'data-bd-badge': '' }, st.loggedIn ? 'B站已登录' : 'B站未登录'),
            h('span', { 'data-bd-badge': '' }, 'v' + (st.version || '?')),
            h('div', { 'data-bd-grow': '' }),
            h('button', { 'data-bd-btn': '', 'data-primary': '', disabled: busy === 'run', onClick: onRun }, '现在跑一轮'))),

        /* ════════ 一、怎么跑（跑在哪 / 什么时候跑 / 一轮挑几条 —— 都是"运行"）════════ */
        h('div', { 'data-bd-sec': '' },
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

          (runMode ?? 'headless') === 'front'
            ? h('div', { 'data-bd-sub': '' },
                h('div', { 'data-bd-row': '' },
                  h('div', { 'data-bd-grow': '' },
                    h('div', { 'data-bd-label': '' }, '会话建在哪个目录'),
                    // 🔴 **这句是上面那项的描述，不是独立一项**（2026-10-16 使用者指出：
                    //    "下面那句跟上面的设置是一个语义的，不应该被分隔"）。
                    //    原来它是 sub 的直接子元素 ⇒ 被当成一行、还画了分隔线 ⇒ 看着像两个设置。
                    //    ⇒ 收进同一个 grow 里，与 label 就是"标题 + 描述"这一对，
                    //      间距由那条统一的 4px 规则给；没设过目录时才显示。
                    (cfg.frontWorkspace
                      ? h('div', { 'data-bd-note': '' }, st.frontWorkspace || '（读不到）')
                      : h('div', { 'data-bd-note': '' },
                          '默认放插件家目录下的 front-sessions。',
                          h('br'),
                          st.frontWorkspace || ''))),
                  h('button', {
                    'data-bd-btn': '', disabled: wsBusy,
                    onClick: async () => {
                      if (!doPickDirectory) { setRunNote({ tone: 'warn', t: '这个环境拿不到目录选择器（缺 uiWorkspace 服务）' }); return }
                      setWsBusy(true)
                      try {
                        const picked = await doPickDirectory()
                        if (picked === null) return              // 用户取消
                        await patch({ frontWorkspace: picked }, '会话目录')
                        setWsPath(picked)
                        setRunNote({ tone: 'good', t: `会话目录已设为：${picked}` })
                      } catch (e) { setRunNote({ tone: 'warn', t: String(e?.message ?? e) }) }
                      finally { setWsBusy(false) }
                    },
                  }, wsBusy ? '正在选…' : (cfg.frontWorkspace ? '改目录' : '选择目录')),
                  cfg.frontWorkspace
                    ? h('button', {
                        'data-bd-btn': '', disabled: wsBusy,
                        onClick: async () => {
                          setWsBusy(true)
                          try { await patch({ frontWorkspace: '' }, '会话目录'); setWsPath(''); setRunNote({ tone: 'good', t: '已改回默认目录' }) }
                          catch (e) { setRunNote({ tone: 'warn', t: String(e?.message ?? e) }) }
                          finally { setWsBusy(false) }
                        },
                      }, '用默认')
                    : null),
                st.lastFrontSessionId
                  ? h('div', { 'data-bd-row': '' },
                      h('div', { 'data-bd-grow': '' },
                        h('div', { 'data-bd-note': '' }, `最近一次：${st.lastFrontSessionId}`)),
                      h('button', {
                        'data-bd-btn': '',
                        onClick: () => {
                          const openSession = resolveOpenSession()
                          if (!openSession) { setRunNote({ tone: 'warn', t: '这个环境拿不到跳转能力（缺 uiWorkspace 服务）' }); return }
                          try { openSession(st.lastFrontSessionId) } catch (e) { setRunNote({ tone: 'warn', t: `跳转失败：${String(e?.message ?? e)}` }) }
                        },
                      }, '去到那个会话'))
                  : null)
            : null,

          h(ToggleRow, {
            label: '峰谷时段自动刷',
            note: '只在谷时跑 —— 工作日 12:00–14:00 与 18:00 之后（整个周末也算谷时）；关了就只能手动跑',
            on: sw('peakValley'),
            onChange: (v) => patch({ peakValley: v }, '峰谷时段自动刷'),
          }),
          sw('peakValley') ? h('div', { 'data-bd-sub': '' },
            ...['noon', 'night'].map((k) => h(ToggleRow, {
              key: k,
              label: win[k].label,
              note: `${win[k].start} – ${win[k].end}`,
              on: sw(k),
              onChange: (v) => patch({ [k]: v }, win[k].label),
            }))) : null,
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
          return h('div', { 'data-bd-sec': '' },
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
        h('div', { 'data-bd-sec': '' },
          h('div', { 'data-bd-h': '' }, '怎么找'),
          h('div', { 'data-bd-note': '' }, '决定它从 B站 捞回什么。改完下一轮生效。'),

          h(Field, {
            label: '关注什么（一行一个）',
            stack: true,
            children: h('textarea', {
              'data-bd-input': '', rows: 5,
              placeholder: '一行一个主题；留空用内置那几组\n例：\n有关大模型的论文\nDSH 插件',
              value: kws ?? '', onChange: (e) => setKws(e.target.value),
            }),
          }),
          h(Field, {
            label: '这些字怎么用',
            note: kwMode === 'fixed'
              ? '每行会原样当搜索词。宽泛的词（如「有关大模型的论文」）搜回来多半是入门教程和水论文技巧。'
              : '模型会按这些主题自己编几个更具体的搜索词、一轮里换 3~5 组去搜，攒够候选才开始筛。',
            stack: true,
            children: h('select', {
              'data-bd-input': '', value: kwMode ?? 'llm',
              onChange: (e) => { setKwMode(e.target.value); patch({ keywordMode: e.target.value }, '关键词用法') },
            },
              h('option', { value: 'llm' }, '当「主题」—— 让模型自己组合出多种搜索词（推荐）'),
              h('option', { value: 'fixed' }, '当「现成搜索词」—— 每行原样拿去搜')),
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
            note: '0 = 不过滤。要按时间筛**只能**在这里设 —— B站 搜索结果里不带发布时间，捞回来本地没法再筛。',
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
        h('div', { 'data-bd-sec': '' },
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
        h('div', { 'data-bd-sec': '' },
          h('div', { 'data-bd-h': '' }, '说不说话'),
          h('div', { 'data-bd-note': '' }, '这两项默认都关 —— 打开就是拿你的号说话。'),

          h(ToggleRow, {
            label: '自动评论并 @ 你',
            note: '在挑中的视频下面留一条 150 字内的评论，并 @ 你填的那个人',
            on: sw('autoComment'),
            onChange: (v) => patch({ autoComment: v }, '自动评论'),
          }),
          sw('autoComment') ? h('div', { 'data-bd-sub': '' },
            h('div', { 'data-bd-row': '' },
              h('div', { 'data-bd-grow': '' },
                h('div', { 'data-bd-label': '' }, '每轮最多发几条'),
                h('div', { 'data-bd-note': '' }, '每条评论里 @ 一次下面那个人')),
              h('input', {
                'data-bd-input': '', 'data-bd-num': '', type: 'number', min: 1, max: 20,
                value: perRound ?? '',
                onChange: (e) => setPerRound(e.target.value),
                onBlur: () => { const n = Math.max(1, Math.min(Number(perRound) || 1, 20)); setPerRound(String(n)); patch({ commentPerRound: n }, '每轮几条评论') },
              })),
            h(Field, {
              label: '要 @ 谁（B站 昵称）',
              note: '留空就不发评论了 —— 评论存在的意义就是 @ 那一下。⚠️ 要跟 B站 昵称**逐字一致**。',
              stack: true,
              children: h('input', {
                'data-bd-input': '', value: mention ?? '',
                placeholder: '填 B站 昵称；留空 = 不发评论',
                onChange: (e) => setMention(e.target.value),
                onBlur: () => { const v = String(mention || '').trim(); setMention(v); patch({ mentionName: v }, '要 @ 谁') },
              }),
            })) : null,

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
                'data-bd-input': '', 'data-bd-num': '', type: 'number', min: 1, max: 10,
                value: replyPer ?? '',
                onChange: (e) => setReplyPer(e.target.value),
                onBlur: () => { const n = Math.max(1, Math.min(Number(replyPer) || 1, 10)); setReplyPer(String(n)); patch({ replyPerRound: n }, '每轮几条回复') },
              }))) : null),

        /* ════════ 五、怎么读（本地转写 —— 从「说不说话」里搬出来：这是"读"的事）════════ */
        h('div', { 'data-bd-sec': '' },
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
        h('div', { 'data-bd-sec': '' },
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
              '每一轮开始前现读这个文件 —— 保存后**立刻生效**，不用重启 dsh。')) : null),

        /* ════════ 八、环境与账号 ════════ */
        h('div', { 'data-bd-sec': '' },
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
            // ⚠️ `newVer` 现在装的是 **commit sha 前 7 位**（不是版本号）——
            //    所以按钮上**不要**再写 "v" 前缀（那会看着像个版本号）。
            newVer ? h('button', { 'data-bd-btn': '', 'data-primary': '', disabled: busy === 'upgrade', onClick: onUpgrade }, '升级到 ' + newVer) : null),
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

        /* ════════ 九、它的地盘（产物与路径）════════ */
        h('div', { 'data-bd-sec': '' },
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
    function makeTab(resolveOpenSession, doPickDirectory) {
      return function BiliScrollTab() {
        // 🔴 **必须现取，不能按值捕获**（2026-10-16 真机抓到）：
        //    `openSession` 由 `ctx.inject(['uiWorkspace'], cb)` **异步**填上，
        //    而 tab 本体在 `apply()` 里**同步**注册
        //    ⇒ 按值传的话注册那刻拿到 `null`，之后填上也改不了已捕获那份
        //      ⇒ 按钮永远说"拿不到跳转能力"。
        //    ⚠️ 所以这里传的是**解析函数**，按钮**点击时**才真正取服务。
        return h('div', { 'data-bd-tabwrap': '' }, h(Panel, { resolveOpenSession, doPickDirectory }))
      }
    }

    return {
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
         * ⭐ **打开 DSH 原生的目录选择器**（2026-10-16 加，给"前台工作区"用）。
         *
         * 照 `dsh-workspace-auto` 的现成做法（`src/client/WorkspaceRootSetting.tsx`）：
         *   目录选择器挂在 **`ctx.uiWorkspace.pickDirectory()`** ——
         *   ⚠️ **不是** `ctx.workspaces`（那个在新版只剩纯数据命令 list/create/rename…）。
         *   签名 `pickDirectory(): Promise<string | null>`（null = 用户取消）。
         *
         * ⚠️ 与 `openSession` 同样：**异步 inject** ⇒ 每次现取，别按值捕获。
         */
        const pickDirectory = async () => {
          const ws = ctx.get('uiWorkspace')
          if (ws && typeof ws.pickDirectory === 'function') return await ws.pickDirectory()
          throw new Error('这个环境拿不到目录选择器（缺 uiWorkspace 服务）')
        }

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
                description: () => '每天替你看一轮 B站、挑出值得的，写份日报',
              },
            ],
          })
        } catch (e) { console.error('[dsh-bili-duty] 注册右侧栏 tab 类型失败：', e) }

        // ── ② tab 本体（🔴 只注册 ① 的卡是点不动的）──
        //    key 必须是 ① 里的 `id`，不是 `kind`。
        //    ⭐ 组件在**这里**建，并把**解析函数**给它（`uiWorkspace` 是异步填上的，
        //       按值传会拿到 null ⇒ 按钮永远说"拿不到跳转能力"，真机踩过）。
        try {
          const Tab = makeTab(resolveOpenSession, pickDirectory)
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
