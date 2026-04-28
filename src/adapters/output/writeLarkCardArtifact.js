import { writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export async function writeLarkCardArtifact(payload, options = {}) {
  const outputPath = resolve(options.larkCardArtifactFile || "tmp/lark-card-artifact.json");
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return outputPath;
}
