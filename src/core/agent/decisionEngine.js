export function buildDecision({ event, picked, toolPlan, options = {} }) {
  const suggestedActions = picked.suggested_actions || [picked.suggestion].filter(Boolean);
  const routeToSkills = picked.route_to_skills || [];

  return {
    type: "knowledge_decision",
    mode: "single-agent-layered",
    scenario: "cli_error_guidance",
    trigger: {
      type: event.type || "cli_error",
      mode: event.trigger_mode || event.triggerMode || "event_driven",
      text: event.text,
      source: event.source || "",
    },
    match: {
      ruleId: picked.id,
      category: picked.category || picked.type || "unknown",
      severity: picked.severity || "info",
      matchedSignal: picked._matchedSignal,
      confidence: inferDecisionConfidence(picked, event),
      retrieval: picked._retrieval || null,
    },
    diagnosis: picked.diagnosis || picked.title || "No diagnosis provided.",
    guidance: {
      suggestedActions,
      routeToSkills,
      nextCommand: picked.next_command_template || "",
      nextStepKind: inferNextStepKind(toolPlan),
    },
    policy: {
      riskLevel: inferRiskLevel(toolPlan),
      autoReadonlyEnabled: Boolean(options.autoReadonly),
      requiresConfirmation: Boolean(toolPlan?.requires_confirmation),
      canAutoExecute: Boolean(toolPlan?.executable),
      deliveryTargets: ["terminal_local"],
      optionalDeliveryTargets: ["lark_card"],
    },
    toolPlan,
  };
}

function inferDecisionConfidence(picked, event) {
  if (picked?._matchedSignal && event?.text?.includes(picked._matchedSignal)) return "high";
  if (picked?._matchedSignal) return "medium";
  return "low";
}

function inferRiskLevel(toolPlan) {
  if (!toolPlan) return "unknown";
  if (toolPlan.requires_confirmation) return "high";
  if (!toolPlan.readonly) return "high";
  if (!toolPlan.executable) return "medium";
  return "low";
}

function inferNextStepKind(toolPlan) {
  if (!toolPlan) return "guidance_only";
  if (toolPlan.mode === "manual_auth") return "authorization";
  if (toolPlan.mode === "readonly_help") return "help_check";
  if (toolPlan.mode === "readonly_check") return "readonly_verification";
  return "guidance_only";
}
