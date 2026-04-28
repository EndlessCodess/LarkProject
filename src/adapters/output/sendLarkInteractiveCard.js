import { spawn } from "node:child_process";

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

  return new Promise((resolve, reject) => {
    const child = spawn("lark-cli", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ ok: true, code, stdout, stderr });
        return;
      }

      reject(new Error(`lark-cli send failed (${code})\nstdout:\n${stdout}\nstderr:\n${stderr}`));
    });
  });
}
