import { spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import type { Readable } from "node:stream";

export interface DevProcess {
  name: string;
  command: string;
  args: string[];
}

/** Signals the child's whole process group. It may already be gone, which is fine. */
function signalGroup(child: ChildProcess, signal: NodeJS.Signals) {
  if (child.pid === undefined) return;
  try {
    process.kill(-child.pid, signal);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
  }
}

/**
 * Runs `processes` together, passing each output line to `write` with a
 * `[name]` prefix. They all go down together: on `stop()`, or when any of them
 * exits on its own. `exited` resolves once all are gone, to 0 after a `stop()`
 * and 1 otherwise.
 *
 * Each process leads its own group because `pnpm` and `tsx` sit between us and
 * the real process, and signalling only the top of that chain doesn't reliably
 * reach the bottom. It also means nothing but `stop()` reaches them, so the
 * caller must call it for every signal that would otherwise end this process.
 */
export function superviseProcesses(processes: DevProcess[], write: (line: string) => void) {
  let stopping = false;
  let unexpectedExit = false;

  const signalAll = (signal: NodeJS.Signals) => {
    for (const child of children) signalGroup(child, signal);
  };

  const prefixLines = (stream: Readable, name: string) => {
    createInterface({ input: stream, crlfDelay: Infinity }).on("line", (line) => {
      write(`[${name}] ${line}`);
    });
  };

  // `tsx` relays signals the terminal already sent us, so repeats are routine.
  const stop = (signal: NodeJS.Signals) => {
    if (stopping) return;
    stopping = true;
    signalAll(signal);
  };

  const children = processes.map(({ command, args }) =>
    spawn(command, args, { detached: true, stdio: ["ignore", "pipe", "pipe"] }),
  );

  const closed = children.map(
    (child, index) =>
      new Promise<void>((resolve) => {
        const { name } = processes[index]!;
        prefixLines(child.stdout, name);
        prefixLines(child.stderr, name);

        child.on("error", (error) => {
          write(`[${name}] couldn't start: ${error.message}`);
        });

        child.on("close", (code, signal) => {
          if (!stopping && !unexpectedExit) {
            unexpectedExit = true;
            if (child.pid !== undefined) {
              write(`[${name}] exited with ${signal ? `signal ${signal}` : `code ${code}`}`);
            }
            signalAll("SIGTERM");
          }
          resolve();
        });
      }),
  );

  const exited = Promise.all(closed).then(() => (unexpectedExit ? 1 : 0));

  return { stop, exited };
}
