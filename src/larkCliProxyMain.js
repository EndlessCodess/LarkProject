import { spawn } from "node:child_process";
import { loadProjectEnv } from "./bootstrap/loadEnv.js";

loadProjectEnv();

function main() {
  const { commandArgs, agentArgs } = splitArgs(process.argv.slice(2));
  if (!commandArgs.length) {
    console.error("[fatal] 用法: node src/larkCliProxyMain.js <lark-cli args...> [--agent <watch args...>]");
    process.exit(1);
  }

  const observedCommand = buildObservedCommand(commandArgs);
  const cliWatchArgs = [
    "src/cliWatchMain.js",
    "--command",
    observedCommand,
    "--preserve-exit-code",
    ...agentArgs,
  ];

  const child = spawn(process.execPath, cliWatchArgs, {
    stdio: "inherit",
    shell: false,
  });

  child.on("error", (error) => {
    console.error(`[fatal] ${error.message}`);
    process.exit(1);
  });

  child.on("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 1);
  });
}

function splitArgs(argv) {
  const divider = argv.indexOf("--agent");
  if (divider < 0) {
    return { commandArgs: argv, agentArgs: [] };
  }

  return {
    commandArgs: argv.slice(0, divider),
    agentArgs: argv.slice(divider + 1),
  };
}

function buildObservedCommand(commandArgs) {
  return ["lark-cli", ...commandArgs].map(quoteForShell).join(" ");
}

function quoteForShell(value) {
  const text = String(value ?? "");
  if (!text) return '""';
  if (process.platform === "win32") {
    if (!/[\s"&|<>^]/.test(text)) return text;
    return `"${text.replace(/"/g, '\\"')}"`;
  }
  if (!/[\s"'$`\\!&|<>*?()[\]{};]/.test(text)) return text;
  return `'${text.replace(/'/g, `'\"'\"'`)}'`;
}

main();
