import { superviseProcesses, type DevProcess } from "../dev-processes.js";
import { missingGithubCredentials } from "../env.js";

function pnpmScript(name: string): DevProcess {
  return { name, command: "pnpm", args: ["--silent", name] };
}

const API = pnpmScript("api");
const SERVE = pnpmScript("serve");

function main() {
  const missing = missingGithubCredentials(process.env);
  if (missing.length > 0) {
    console.warn(`${missing.join(", ")} not set — ingest is not running, starting only api.`);
  }

  const supervised = superviseProcesses(missing.length > 0 ? [API] : [API, SERVE], console.log);

  process.on("SIGINT", () => supervised.stop("SIGINT"));
  process.on("SIGTERM", () => supervised.stop("SIGTERM"));
  // Closing the terminal. `onShutdown` doesn't handle SIGHUP, so turn it into a SIGTERM.
  process.on("SIGHUP", () => supervised.stop("SIGTERM"));

  void supervised.exited.then((code) => process.exit(code));
}

main();
