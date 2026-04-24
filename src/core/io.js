import fs from "node:fs/promises";

export async function readJsonFile(path) {
  const content = await fs.readFile(path, "utf8");
  return JSON.parse(content);
}

export async function readJsonLines(path) {
  const content = await fs.readFile(path, "utf8");
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}
