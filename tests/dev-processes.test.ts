import assert from "node:assert/strict";
import { test } from "node:test";
import { superviseProcesses, type DevProcess } from "../src/dev-processes.js";

/** A child running `script` under this Node, so the tests need no real `pnpm api`. */
function nodeProcess(name: string, script: string): DevProcess {
  return { name, command: process.execPath, args: ["-e", script] };
}

/** Prints "ready", exits 0 on SIGTERM/SIGINT, and otherwise runs until killed. */
const LONG_RUNNING = `
  const stop = () => { console.log("stopping"); process.exit(0); };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  console.log("ready");
  setInterval(() => {}, 1000);
`;

function collectOutput() {
  const lines: string[] = [];
  const write = (line: string) => {
    lines.push(line);
  };
  const waitFor = async (expected: string) => {
    while (!lines.includes(expected)) {
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  };
  return { lines, write, waitFor };
}

test("prefixes each line of stdout and stderr, including a partial last line", async () => {
  const output = collectOutput();
  const supervised = superviseProcesses(
    [nodeProcess("one", `console.log("a\\nb"); console.error("c"); process.stdout.write("d");`)],
    output.write,
  );

  await supervised.exited;

  assert.deepEqual(output.lines.toSorted(), [
    "[one] a",
    "[one] b",
    "[one] c",
    "[one] d",
    "[one] exited with code 0",
  ]);
});

test("stop() signals every process and resolves 0 once they've all exited", async () => {
  const output = collectOutput();
  const supervised = superviseProcesses(
    [nodeProcess("one", LONG_RUNNING), nodeProcess("two", LONG_RUNNING)],
    output.write,
  );
  await output.waitFor("[one] ready");
  await output.waitFor("[two] ready");

  supervised.stop("SIGTERM");

  assert.equal(await supervised.exited, 0);
  assert.ok(output.lines.includes("[one] stopping"));
  assert.ok(output.lines.includes("[two] stopping"));
});

test("stop() reaches grandchildren, as `pnpm` runs the real process a level down", async () => {
  const grandchild = LONG_RUNNING.replaceAll('"', "'").replaceAll("\n", " ");
  const output = collectOutput();
  const supervised = superviseProcesses(
    [
      nodeProcess(
        "parent",
        // The parent ignores signals, so only a signal to the whole group stops the grandchild.
        `
          process.on("SIGTERM", () => {});
          const child = require("node:child_process").spawn(
            process.execPath,
            ["-e", ${JSON.stringify(grandchild)}],
            { stdio: "inherit" },
          );
          child.on("exit", () => process.exit(0));
        `,
      ),
    ],
    output.write,
  );
  await output.waitFor("[parent] ready");

  supervised.stop("SIGTERM");

  assert.equal(await supervised.exited, 0);
  assert.ok(output.lines.includes("[parent] stopping"));
});

test("a repeated stop() leaves a slow shutdown to finish", async () => {
  const output = collectOutput();
  const supervised = superviseProcesses(
    [
      nodeProcess(
        "slow",
        `
          process.on("SIGTERM", () => {
            setTimeout(() => { console.log("finished"); process.exit(0); }, 100);
          });
          console.log("ready");
          setInterval(() => {}, 1000);
        `,
      ),
    ],
    output.write,
  );
  await output.waitFor("[slow] ready");

  supervised.stop("SIGTERM");
  supervised.stop("SIGTERM");

  assert.equal(await supervised.exited, 0);
  assert.ok(output.lines.includes("[slow] finished"));
});

test("one process exiting on its own stops the others and resolves non-zero", async () => {
  const output = collectOutput();
  const supervised = superviseProcesses(
    [nodeProcess("one", LONG_RUNNING), nodeProcess("two", `process.exit(3);`)],
    output.write,
  );

  assert.equal(await supervised.exited, 1);
  assert.ok(output.lines.includes("[two] exited with code 3"));
  assert.ok(!output.lines.some((line) => line.startsWith("[one] exited")));
});

test("a command that can't be spawned resolves non-zero instead of crashing", async () => {
  const output = collectOutput();
  const supervised = superviseProcesses(
    [{ name: "missing", command: "ci-radar-no-such-command", args: [] }],
    output.write,
  );

  assert.equal(await supervised.exited, 1);
  assert.ok(output.lines.some((line) => line.startsWith("[missing] couldn't start:")));
});
