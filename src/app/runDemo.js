import { readJsonLines } from "../core/io.js";
import { matchKnowledge } from "../core/matcher.js";
import { loadKnowledge } from "../core/knowledge/loadKnowledge.js";
import { renderTerminalCard, renderNoMatch } from "../adapters/output/terminalCard.js";

export async function runDemo(options) {
  const [events, kb] = await Promise.all([readJsonLines(options.source), loadKnowledge(options)]);

  console.log(`Loaded ${events.length} events, ${kb.items.length} knowledge rules.`);
  console.log(`Knowledge source: ${kb.meta?.sourceType || options.knowledgeSource}\n`);

  for (const event of events) {
    const picked = matchKnowledge(event, kb.items);

    if (!picked) {
      renderNoMatch(event);
      continue;
    }

    const card = {
      category: picked.category || picked.type || "unknown",
      severity: picked.severity || "info",
      diagnosis: picked.diagnosis || picked.title || "No diagnosis provided.",
      matchedSignal: picked._matchedSignal,
      suggestedActions: picked.suggested_actions || [picked.suggestion].filter(Boolean),
      routeToSkills: picked.route_to_skills || [],
      nextCommand: picked.next_command_template || "",
      source: picked.source || "",
      context: event.text,
    };

    renderTerminalCard(card);
  }
}
