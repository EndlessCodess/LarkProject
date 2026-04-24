import { readJsonFile, readJsonLines } from "../core/io.js";
import { matchKnowledge } from "../core/matcher.js";
import { renderTerminalCard } from "../adapters/output/terminalCard.js";

export async function runDemo({ source, knowledge }) {
  const [events, kb] = await Promise.all([readJsonLines(source), readJsonFile(knowledge)]);

  console.log(`Loaded ${events.length} events, ${kb.items.length} knowledge items.\n`);

  for (const event of events) {
    const picked = matchKnowledge(event, kb.items);
    if (!picked) continue;
    const card = {
      title: picked.title,
      why: `matched by keyword: ${picked._matchedKeyword}`,
      suggestion: picked.suggestion,
      source: picked.source,
      context: event.text,
    };
    renderTerminalCard(card);
  }
}
