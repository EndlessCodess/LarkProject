export function renderTerminalCard(card) {
  console.log("=".repeat(72));
  console.log(`[Knowledge Card] ${card.title}`);
  console.log(`Why: ${card.why}`);
  console.log(`Suggestion: ${card.suggestion}`);
  console.log(`Source: ${card.source}`);
  console.log(`Context: ${card.context}`);
  console.log("=".repeat(72));
  console.log("");
}
