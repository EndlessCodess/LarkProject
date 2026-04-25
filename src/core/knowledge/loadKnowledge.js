import { loadLocalKnowledge } from "../../adapters/knowledge-source/localKnowledgeSource.js";
import { loadLarkDocsKnowledge } from "../../adapters/knowledge-source/larkDocsKnowledgeSource.js";

export async function loadKnowledge(options) {
  if (options.knowledgeSource === "lark-docs") {
    return loadLarkDocsKnowledge({
      docs: options.docs || [],
      timeoutMs: options.larkCliTimeoutMs,
    });
  }

  return loadLocalKnowledge({ path: options.knowledge });
}
