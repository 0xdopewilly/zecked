// Drives one long-lived `zingo-cli` interactive session through pipes.
//
// Why a long-lived session instead of one process per command: every online
// zingo-cli session bootstraps the Nym mixnet (sends are forced over it) and
// binds an indexer, which takes seconds to minutes. One session keeps the
// mixnet warm, keeps the wallet loaded, and is the single owner of the wallet
// file, so nothing else can write it concurrently.
//
// Protocol: rustyline prints no prompt when stdin is not a TTY, so each
// command is followed by `help <sentinel>`, which prints
// "Command <sentinel> not found" on stdout. Everything on stdout before that
// line is the command's output. Command errors go to stderr as lines that
// begin with "Error: " (zingo-cli ADR 0031); stderr is collected from the
// moment the command is written until shortly after the sentinel arrives.
//
// Nothing read from the child is ever logged verbatim, and the vault never
// sends `recovery_info` (which would print the seed phrase).
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomBytes } from "node:crypto";
import { EventEmitter } from "node:events";

export interface EngineOptions {
  bin: string;
  dataDir: string;
  server: string;
  nymProxy?: string;
  logFile: string;
  /** Time allowed for the session to come up (mixnet bootstrap, indexer bind). */
  startupTimeoutMs?: number;
  env?: NodeJS.ProcessEnv;
}

export class EngineError extends Error {
  readonly stderr: string;
  readonly code: string;
  constructor(message: string, code: string, stderr = "") {
    super(message);
    this.code = code;
    this.stderr = stderr;
  }
}

export interface CommandResult {
  stdout: string;
  stderr: string;
}

/** Commands that must never be sent: they reveal or destroy key material. */
const FORBIDDEN = new Set(["recovery_info", "delete", "export_ufvk", "clear", "quit", "exit"]);

/** Quotes one token for the `shellwords` splitter zingo-cli uses on each line. */
function quote(token: string): string {
  if (/[\r\n\0]/.test(token)) throw new EngineError("argument contains a line break", "bad_argument");
  if (/^[A-Za-z0-9_:.,@%+=\/-]+$/.test(token)) return token;
  return `'${token.replace(/'/g, `'\\''`)}'`;
}

const STDERR_SETTLE_MS = 60;

type Pending = {
  sentinelLine: string;
  resolve: (r: CommandResult) => void;
  reject: (e: Error) => void;
  timer: NodeJS.Timeout;
  stderrStart: number;
};

export class ZingoEngine extends EventEmitter {
  private readonly opts: EngineOptions;
  private child?: ChildProcessWithoutNullStreams;
  private stdoutBuf = "";
  private stderrBuf = "";
  private pending?: Pending;
  private readonly staleSentinels = new Set<string>();
  private chain: Promise<unknown> = Promise.resolve();
  private stopping = false;
  private restartDelayMs = 2_000;
  ready = false;
  lastError?: string;
  startedAt?: number;
  /** The last "Sync error: …" zingo-cli narrated on stderr (its background sync task died). It prints it only
   *  at the next prompt, interleaved with whatever command runs then, so it is caught here, not per command. */
  syncError?: { message: string; at: number };

  constructor(opts: EngineOptions) {
    super();
    this.opts = opts;
  }

  /** Spawns the session and resolves once it answers its first command. */
  async start(): Promise<void> {
    this.stopping = false;
    this.spawnChild();
    await this.run(["height"], { timeoutMs: this.opts.startupTimeoutMs ?? 10 * 60_000, allowNotReady: true });
    this.ready = true;
    this.lastError = undefined;
    this.restartDelayMs = 2_000;
    this.emit("ready");
  }

  private spawnChild(): void {
    const args = [
      "--chain", "testnet",
      "--data-dir", this.opts.dataDir,
      "--server", this.opts.server,
      "--log-file", this.opts.logFile,
    ];
    if (this.opts.nymProxy) args.push("--nym-proxy", this.opts.nymProxy);
    this.stdoutBuf = "";
    this.stderrBuf = "";
    this.staleSentinels.clear();
    this.ready = false;
    this.startedAt = Date.now();
    const child = spawn(this.opts.bin, args, {
      cwd: this.opts.dataDir,
      env: { ...process.env, ...this.opts.env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.child = child;
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (d: string) => {
      this.stdoutBuf += d;
      this.checkSentinel();
    });
    child.stderr.on("data", (d: string) => {
      this.stderrBuf += d;
      const m = /Sync error:[\s\S]*?(?=Please restart sync|$)/.exec(d) ?? /thread '.*' panicked at[^\n]*/.exec(d);
      if (m) this.syncError = { message: m[0].replace(/\s+/g, " ").trim().slice(0, 600), at: Date.now() };
      // Keep memory bounded when idle: nothing is waiting on old stderr.
      if (!this.pending && this.stderrBuf.length > 1_000_000) this.stderrBuf = this.stderrBuf.slice(-100_000);
    });
    child.stdin.on("error", () => {});
    child.on("exit", (code, signal) => {
      this.ready = false;
      this.child = undefined;
      const tail = lastErrorLine(this.stderrBuf);
      this.lastError = `zingo-cli exited (code ${code}, signal ${signal})${tail ? `: ${tail}` : ""}`;
      this.emit("exit", this.lastError);
      if (this.pending) {
        const p = this.pending;
        this.pending = undefined;
        clearTimeout(p.timer);
        p.reject(new EngineError(this.lastError, "engine_exited", this.stderrBuf.slice(p.stderrStart)));
      }
      if (!this.stopping) {
        const delay = this.restartDelayMs;
        this.restartDelayMs = Math.min(this.restartDelayMs * 2, 60_000);
        setTimeout(() => {
          if (this.stopping) return;
          this.start().catch((e) => this.emit("error", e));
        }, delay).unref();
      }
    });
  }

  private checkSentinel(): void {
    // Output of commands that timed out: discard it up to their sentinel.
    for (const stale of [...this.staleSentinels]) {
      const i = this.stdoutBuf.indexOf(stale);
      if (i < 0) continue;
      const nl = this.stdoutBuf.indexOf("\n", i);
      this.stdoutBuf = nl < 0 ? "" : this.stdoutBuf.slice(nl + 1);
      this.staleSentinels.delete(stale);
    }
    const p = this.pending;
    if (!p) {
      // Output with nobody waiting (e.g. startup chatter): drop it.
      if (this.stdoutBuf.length > 1_000_000) this.stdoutBuf = "";
      return;
    }
    const idx = this.stdoutBuf.indexOf(p.sentinelLine);
    if (idx < 0) return;
    const stdout = this.stdoutBuf.slice(0, idx);
    const nl = this.stdoutBuf.indexOf("\n", idx);
    this.stdoutBuf = nl < 0 ? "" : this.stdoutBuf.slice(nl + 1);
    this.pending = undefined;
    clearTimeout(p.timer);
    // Errors are written to stderr before the sentinel reaches stdout; give
    // the other pipe a moment to be drained by the event loop.
    setTimeout(() => {
      const stderr = this.stderrBuf.slice(p.stderrStart);
      this.stderrBuf = "";
      p.resolve({ stdout, stderr });
    }, STDERR_SETTLE_MS);
  }

  /**
   * Runs one command in the session. Calls are serialized. Rejects with an
   * EngineError when the command reports an error (a stderr line starting
   * with "Error:") and produced no stdout, or when it times out.
   */
  run(tokens: string[], o: { timeoutMs?: number; allowNotReady?: boolean } = {}): Promise<CommandResult> {
    if (!tokens.length || FORBIDDEN.has(tokens[0])) {
      return Promise.reject(new EngineError(`command not allowed: ${tokens[0]}`, "forbidden"));
    }
    const line = tokens.map(quote).join(" ");
    const task = async (): Promise<CommandResult> => {
      if (!this.child) throw new EngineError(this.lastError ?? "zingo-cli is not running", "engine_down");
      if (!this.ready && !o.allowNotReady) throw new EngineError("zingo-cli session is still starting", "engine_starting");
      const sentinel = `__zk_${randomBytes(8).toString("hex")}`;
      const result = await new Promise<CommandResult>((resolve, reject) => {
        const timeoutMs = o.timeoutMs ?? 120_000;
        const timer = setTimeout(() => {
          if (this.pending?.sentinelLine.includes(sentinel)) {
            this.pending = undefined;
            this.staleSentinels.add(`Command ${sentinel} not found`);
          }
          // Not recycled here: during a long catch-up sync, zingo holds the wallet lock and
          // lock-taking commands legitimately wait minutes. A session that is truly wedged
          // is recycled by the vault's sync-progress watchdog instead.
          reject(new EngineError(`zingo-cli command '${tokens[0]}' timed out after ${timeoutMs}ms`, "timeout"));
        }, timeoutMs);
        this.pending = {
          sentinelLine: `Command ${sentinel} not found`,
          resolve,
          reject,
          timer,
          stderrStart: this.stderrBuf.length,
        };
        this.child!.stdin.write(`${line}\nhelp ${sentinel}\n`);
      });
      const errLine = lastErrorLine(result.stderr);
      if (errLine && !result.stdout.trim()) throw new EngineError(errLine.replace(/^Error:\s*/, ""), "command_failed", result.stderr);
      if (!result.stdout.trim() && result.stderr.trim()) {
        // e.g. a clap usage error, rendered without the "Error:" prefix
        throw new EngineError(firstLine(result.stderr), "command_failed", result.stderr);
      }
      return result;
    };
    const next = this.chain.then(task, task);
    this.chain = next.catch(() => {});
    return next;
  }

  /** Kills a wedged or stalled session (SIGTERM, then SIGKILL); the exit handler restarts it. */
  recycle(reason: string): void {
    const child = this.child;
    if (!child || this.stopping) return;
    this.ready = false;
    this.emit("recycle", reason);
    child.kill("SIGTERM");
    const t = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    }, 10_000);
    t.unref();
    child.once("exit", () => clearTimeout(t));
  }

  /** Runs a command whose stdout is a JSON document and parses it. */
  async json<T = unknown>(tokens: string[], o: { timeoutMs?: number } = {}): Promise<T> {
    const { stdout, stderr } = await this.run(tokens, o);
    const start = stdout.search(/[\[{]/);
    const end = Math.max(stdout.lastIndexOf("}"), stdout.lastIndexOf("]"));
    if (start < 0 || end < start) throw new EngineError(`'${tokens[0]}' returned no JSON`, "bad_output", stderr);
    try {
      return JSON.parse(stdout.slice(start, end + 1)) as T;
    } catch {
      throw new EngineError(`'${tokens[0]}' returned malformed JSON`, "bad_output", stderr);
    }
  }

  /** Asks the session to save and exit (the wallet is persisted on quit). */
  async stop(timeoutMs = 20_000): Promise<void> {
    this.stopping = true;
    const child = this.child;
    if (!child) return;
    await new Promise<void>((resolve) => {
      const t = setTimeout(() => {
        child.kill("SIGTERM");
        resolve();
      }, timeoutMs);
      child.once("exit", () => {
        clearTimeout(t);
        resolve();
      });
      child.stdin.write("quit\n");
    });
  }
}

function lastErrorLine(stderr: string): string | undefined {
  const lines = stderr.split("\n").map((l) => l.trim()).filter((l) => /^Error:/i.test(l));
  return lines.at(-1);
}

function firstLine(s: string): string {
  return s.split("\n").map((l) => l.trim()).find(Boolean) ?? s.trim();
}
