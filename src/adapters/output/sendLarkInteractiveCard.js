import { runLarkCli } from "../lark-cli/runner.js";

export async function sendLarkInteractiveCard({ chatId, payload, as = "bot", debug = false }) {
  if (!chatId) {
    throw new Error("chatId is required for sending lark card.");
  }

  const content = JSON.stringify(payload);
  const args = [
    "im",
    "+messages-send",
    "--chat-id",
    chatId,
    "--as",
    as,
    "--msg-type",
    "interactive",
    "--content",
    content,
  ];

  if (debug) {
    console.log("[debug] lark send args:", ["lark-cli", ...args].join(" "));
  }

  const result = await runLarkCli(args, { debug });
  if (result.code !== 0) {
    throw new Error(`lark-cli send failed (${result.code})\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  }

  return {
    ok: true,
    code: result.code,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}
