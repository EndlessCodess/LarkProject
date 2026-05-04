import { runLarkCli } from "../../adapters/lark-cli/runner.js";
import { interpretToolResult } from "./resultInterpreter.js";

export async function collectLiveCliEvidence(event, options = {}) {
  if (options.liveHelp === false) return null;

  const command = extractCommand(event);
  const service = extractService(command);
  if (!service) return null;

  const args = [service, "--help"];

  try {
    const result = await runLarkCli(args, {
      timeoutMs: Math.min(Number(options.liveHelpTimeoutMs || 8000), Number(options.larkCliTimeoutMs || 30000)),
      cwd: event?.cwd || process.cwd(),
      debug: options.debugLarkCli,
    });
    const interpreted = interpretToolResult(result);
    return {
      kind: "cli_help",
      command: `lark-cli ${service} --help`,
      service,
      status: interpreted.status,
      summary: interpreted.summary,
      usage: interpreted.analysis?.usage || "",
      flags: interpreted.analysis?.flags || [],
      conclusions: interpreted.analysis?.conclusions || [],
    };
  } catch (error) {
    return {
      kind: "cli_help",
      command: `lark-cli ${service} --help`,
      service,
      status: "failed",
      summary: error?.message || "live help failed",
      usage: "",
      flags: [],
      conclusions: [],
    };
  }
}

function extractCommand(event = {}) {
  if (event.command) return String(event.command);
  const match = String(event.text || "").match(/(?:terminal command:\s*)?(lark-cli[^\n]+)/i);
  return match?.[1] || "";
}

function extractService(command) {
  const match = String(command || "").match(/^lark-cli\s+([a-z0-9_-]+)/i);
  return match?.[1] || "";
}
