import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function sendLarkCard({ chatId, cardPayload, identity = "bot", debug = false }) {
  const content = JSON.stringify(cardPayload);
  const args = [
    "im",
    "+messages-send",
    "--chat-id",
    chatId,
    "--as",
    identity,
    "--msg-type",
    "interactive",
    "--content",
    content,
  ];

  if (debug) {
    console.log(`[lark-card-send] lark-cli ${args.map(quoteArg).join(" ")}`);
  }

  const { stdout, stderr } = await execFileAsync("lark-cli", args, {
    windowsHide: true,
    maxBuffer: 1024 * 1024,
  });

  return {
    stdout: stdout?.trim() || "",
    stderr: stderr?.trim() || "",
  };
}

function quoteArg(value) {
  if (/^[\w.:/@+-]+$/.test(value)) return value;
  return JSON.stringify(value);
}
