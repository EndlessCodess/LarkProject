import { spawn } from "node:child_process";

export function runLarkCli(args, options = {}) {
  const { timeoutMs = 30000, cwd = process.cwd(), debug = false } = options;
  const command = "lark-cli";
  const commandArgs = args;

  if (debug) {
    console.error(`[lark-cli runner] ${command} ${commandArgs.join(" ")}`);
  }

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
      resolve({ code, stdout, stderr, args, command });
    });
  });
}

export async function preflightLarkCliCommand(args, options = {}) {
  const tokens = Array.isArray(args) ? args : [];
  if (!tokens.length) {
    return { ok: false, status: "invalid_command", summary: "命令参数为空，无法执行预检。" };
  }

  const [service, second, third] = tokens;
  if (service !== "lark-cli") {
    return { ok: false, status: "invalid_command", summary: "仅支持对 lark-cli 命令做预检。" };
  }

  if (!second) {
    return { ok: false, status: "invalid_command", summary: "缺少 lark-cli service，无法执行预检。" };
  }

  const timeoutMs = Math.min(options.timeoutMs || 30000, 10000);
  const baseOptions = { ...options, timeoutMs, debug: false };

  const serviceCheck = await safeRun([second, "--help"], baseOptions);
  if (!serviceCheck.ok) {
    return {
      ok: false,
      status: "cli_unavailable",
      summary: serviceCheck.summary,
      probe: serviceCheck.error || null,
    };
  }
  if (!looksLikeValidHelp(serviceCheck.result, second)) {
    return {
      ok: false,
      status: "service_not_found",
      summary: `service 预检失败：${second}`,
      probe: serviceCheck.result,
    };
  }

  if (!third) {
    return { ok: true, status: "service_exists", summary: `已确认 service 存在：${second}` };
  }

  if (isShortcut(second, third)) {
    const shortcutCheck = await safeRun([second, third, "--help"], baseOptions);
    if (!shortcutCheck.ok) {
      return {
        ok: false,
        status: "cli_unavailable",
        summary: shortcutCheck.summary,
        probe: shortcutCheck.error || null,
      };
    }
    if (!looksLikeValidHelp(shortcutCheck.result, third)) {
      return {
        ok: false,
        status: "shortcut_not_found",
        summary: `shortcut 预检失败：${second} ${third}`,
        probe: shortcutCheck.result,
      };
    }

    return { ok: true, status: "shortcut_exists", summary: `已确认 shortcut 存在：${second} ${third}` };
  }

  const resourceCheck = await safeRun([second, third, "--help"], baseOptions);
  if (!resourceCheck.ok) {
    return {
      ok: false,
      status: "cli_unavailable",
      summary: resourceCheck.summary,
      probe: resourceCheck.error || null,
    };
  }
  if (!looksLikeValidHelp(resourceCheck.result, third)) {
    return {
      ok: false,
      status: "resource_not_found",
      summary: `resource/method 预检失败：${second} ${third}`,
      probe: resourceCheck.result,
    };
  }

  return { ok: true, status: "resource_exists", summary: `已确认 resource 存在：${second} ${third}` };
}

function isShortcut(service, token) {
  return service !== "schema" && typeof token === "string" && token.startsWith("+");
}

function looksLikeValidHelp(result, expectedToken) {
  const text = `${result?.stdout || ""}\n${result?.stderr || ""}`.trim();
  if (result?.code !== 0) return false;
  if (!text) return false;
  if (/Unknown service|unknown command|Error:/i.test(text)) return false;
  if (/Usage:/i.test(text)) return true;
  if (expectedToken && new RegExp(`\\b${escapeRegExp(expectedToken)}\\b`, "i").test(text)) return true;
  return false;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function safeRun(args, options) {
  try {
    const result = await runLarkCli(args, options);
    return { ok: true, result };
  } catch (error) {
    return {
      ok: false,
      error,
      summary: error?.message || `lark-cli 执行失败：${args.join(" ")}`,
    };
  }
}
