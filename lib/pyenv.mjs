/**
 * lib/pyenv.mjs —— 给 Python 子进程统一钉上 UTF-8
 * ============================================================================
 * 🔴 为什么要有它（来自上游 0.1.4 的修复，有用户实测）：
 *   Windows 的 Python **默认用 GBK** 读写标准输出/错误，而我们的 `.py` 往回打的是
 *   UTF-8（还有 B站 的中文标题）⇒ 会 `UnicodeDecodeError`。
 *   上游收到的反馈是**装依赖时报**这个错（所以用户直接卡在第一步）。
 *
 * ⭐ 做法：两个环境变量一起钉
 *   · `PYTHONUTF8=1`      —— Python 3.7+ 的 UTF-8 模式（一次管住所有 I/O）
 *   · `PYTHONIOENCODING=utf-8` —— 老版本 Python 不认上面那个时的兜底
 *   ⚠️ 顺带把 `PYTHONUNBUFFERED=1` 也带上：否则 Python 会**攒着输出**再吐，
 *      我们这边"边跑边看进度"就变成"最后一次性出来"（用户以为卡住了）。
 *
 * ⚠️ **只加在 Python 上**，不要无差别加到所有子进程：
 *   我们还会 spawn `cmd.exe` / `explorer.exe` / `uv` —— 给它们塞 Python 变量没意义，
 *   而且会污染 `dsh` 自己那一轮的环境（那一路是别的进程，别越界）。
 * ============================================================================
 */

/** 认出这是不是一个 Python 进程（按可执行文件名判断） */
export function looksLikePython(cmd) {
  const base = String(cmd || '').split(/[\\/]/).pop().toLowerCase()
  return base === 'python' || base === 'python.exe'
    || base === 'python3' || base === 'python3.exe'
    || base.startsWith('python3.')          // python3.12 / python3.12.exe
    || base.startsWith('python3.exe')
}

/**
 * 给一个 spawn 的 options 补上 UTF-8 环境变量。
 * @param {string} cmd 要执行的命令
 * @param {object|null} extra 调用方自己的 env（会被标量覆盖）
 * @returns {object} 合并好的 env
 */
export function pyEnv(cmd, extra = null) {
  const base = { ...process.env }
  if (looksLikePython(cmd)) {
    base.PYTHONUTF8 = '1'
    base.PYTHONIOENCODING = 'utf-8'
    base.PYTHONUNBUFFERED = '1'
  }
  return extra ? { ...base, ...extra } : base
}
