import { spawn } from "node:child_process";

export function runLarkCli(args, options = {}) {
  const { timeoutMs = 30000, cwd = process.cwd() } = options;
  const command = process.platform === "win32" ? "cmd.exe" : "lark-cli";
  const commandArgs = process.platform === "win32" ? ["/d", "/s", "/c", buildWindowsCommand(args)] : args;

  return new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, {
      cwd,
      shell: false,
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`lark-cli timed out after ${timeoutMs}ms: ${args.join(" ")}`));
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, args });
    });
  });
}

function buildWindowsCommand(args) {
  return ["lark-cli", ...args].map(quoteWindowsArg).join(" ");
}

function quoteWindowsArg(value) {
  const text = String(value);
  if (!/[\s"&|<>^]/.test(text)) return text;
  return `"${text.replace(/"/g, '\\"')}"`;
}
