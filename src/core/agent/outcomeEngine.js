export function buildOutcome({
  decision,
  action,
  execution,
  effectiveStatus,
  larkCardPayload = null,
  larkCardArtifactFile = null,
  pushResult = null,
}) {
  return {
    type: "agent_outcome",
    strategy: action.strategy,
    executionMode: action.executionMode,
    actualStatus: execution?.status || "not_executed",
    effectiveStatus,
    summary: execution?.summary || "No execution summary.",
    execution,
    larkCardPayload,
    larkCardArtifactFile,
    pushResult,
    finalRecommendation: {
      nextCommand: decision.guidance.nextCommand,
      routeToSkills: decision.guidance.routeToSkills,
      nextStepKind: decision.guidance.nextStepKind,
      deliveryTargets: decision.policy.deliveryTargets,
      optionalDeliveryTargets: decision.policy.optionalDeliveryTargets,
    },
  };
}
