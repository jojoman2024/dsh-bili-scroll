/**
 * lib/mcp.mjs —— 一个极小的 MCP stdio 客户端（只做我们需要的三件事）
 * ============================================================================
 * 为什么不用 `@deepseek-ai/dsh-mcp-client`：那是个"把 MCP 挂成 dsh 工具"的完整插件，
 * 而我们要的是**插件内部自己起这个 Python MCP**（用户选了 A 方案：装完就能用，
 * Python 路径和登录都在设置页里，不用去改 profile 的 patch）。
 *
 * 协议就三句话：`initialize` → `notifications/initialized` → `tools/call`，
 * stdio 上是**一行一个 JSON-RPC**。
 * ============================================================================
 */
import { spawn } from 'node:child_process'
import { pyEnv } from './pyenv.mjs'

export class McpClient {
  constructor({ command, args = [], cwd, env, log = () => {} }) {
    this.cfg = { command, args, cwd, env, log }
    this.proc = null
    this.buf = ''
    this.nextId = 1
    this.pending = new Map()
    this.stderr = ''
    this.starting = null
  }

  get running() { return Boolean(this.proc) }

  async start() {
    if (this.proc) return
    if (this.starting) return this.starting
    this.starting = (async () => {
      const { command, args, cwd, env, log } = this.cfg
      this.proc = spawn(command, args, {
        cwd,
        // ⭐ 统一钉 UTF-8（Windows 的 Python 默认 GBK，会把中文标题/报错打成乱码，
        //    甚至 UnicodeDecodeError）—— 见 lib/pyenv.mjs
        env: pyEnv(command, env),
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      })
      this.proc.stdout.setEncoding('utf8')
      this.proc.stdout.on('data', (chunk) => this.#onData(chunk))
      this.proc.stderr.setEncoding('utf8')
      this.proc.stderr.on('data', (c) => { this.stderr = (this.stderr + c).slice(-4000) })
      /**
       * 🔴 **spawn 失败要立刻 reject 掉所有 pending**（2026-10-18 修，方案 E）。
       *
       * 原来的写法只 `log(...)` 一句就完了 ⇒ 那个 `initialize` 请求**没人 reject**，
       * 只能等到 **60 秒超时**才抛，而错误信息是
       * `MCP initialize 超时（60000ms）` —— **完全看不出真正的原因是「python 不存在」**。
       *
       * 实测（python 命令写错）：用户要看着转圈等满 **60 秒**，最后拿到一句
       * "超时"，然后被告知"去装依赖" —— 而它缺的根本不是依赖，是那个可执行文件。
       *
       * ⚠️ 这里**故意不改 `this.proc`**：`exit` 事件里会处理，两个事件谁先来都行；
       *    只 reject pending 就是幂等的（reject 过的 Promise 再 reject 也不会炸）。
       */
      this.proc.on('error', (e) => {
        const msg = `MCP 子进程启动失败：${e?.message ?? e}`
        log(msg)
        for (const [, p] of this.pending) p.reject(new Error(msg))
        this.pending.clear()
      })
      this.proc.on('exit', (code) => {
        log(`MCP 子进程退出（code=${code}）`)
        for (const [, p] of this.pending) p.reject(new Error(`MCP 子进程退出（code=${code}）${this.stderr ? '：' + this.stderr.slice(-300) : ''}`))
        this.pending.clear()
        this.proc = null
      })
      await this.#request('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'dsh-bili-duty', version: '0.1.0' },
      })
      this.#notify('notifications/initialized', {})
      log('MCP 已就绪')
    })()
    try { await this.starting } finally { this.starting = null }
  }

  stop() {
    try { this.proc?.kill() } catch { /* 已经没了 */ }
    this.proc = null
  }

  /** 调一个 MCP 工具：能解析成 JSON 就返回对象，否则返回字符串 */
  async call(name, args = {}, { timeoutMs = 180000 } = {}) {
    await this.start()
    const result = await this.#request('tools/call', { name, arguments: args }, timeoutMs)
    const text = (result?.content ?? []).map((c) => c?.text ?? '').join('\n').trim()
    if (result?.isError) throw new Error(text || `MCP 工具 ${name} 报错`)
    try { return text ? JSON.parse(text) : {} } catch { return text }
  }

  #onData(chunk) {
    this.buf += chunk
    let idx
    while ((idx = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, idx).trim()
      this.buf = this.buf.slice(idx + 1)
      if (!line) continue
      let msg
      try { msg = JSON.parse(line) } catch { continue }   // 非 JSON 行（有些库会往 stdout 打日志）忽略
      if (msg.id !== undefined && this.pending.has(msg.id)) {
        const p = this.pending.get(msg.id)
        this.pending.delete(msg.id)
        if (msg.error) p.reject(new Error(msg.error?.message ? String(msg.error.message) : JSON.stringify(msg.error)))
        else p.resolve(msg.result)
      }
    }
  }

  #send(obj) {
    if (!this.proc?.stdin?.writable) throw new Error('MCP 子进程不在运行')
    this.proc.stdin.write(JSON.stringify(obj) + '\n')
  }

  #notify(method, params) { this.#send({ jsonrpc: '2.0', method, params }) }

  #request(method, params, timeoutMs = 60000) {
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`MCP ${method} 超时（${timeoutMs}ms）${this.stderr ? '：' + this.stderr.slice(-200) : ''}`))
      }, timeoutMs)
      this.pending.set(id, {
        resolve: (v) => { clearTimeout(timer); resolve(v) },
        reject: (e) => { clearTimeout(timer); reject(e) },
      })
      try { this.#send({ jsonrpc: '2.0', id, method, params }) } catch (e) {
        clearTimeout(timer); this.pending.delete(id); reject(e)
      }
    })
  }
}
