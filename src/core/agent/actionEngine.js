export function selectAction(decision) {
  return {
    type: "agent_action",
    strategy: decision.policy.canAutoExecute ? "execute_readonly_plan" : "present_guidance_only",
    executionMode: decision.policy.canAutoExecute ? "auto_readonly" : "manual_or_blocked",
    toolPlan: decision.toolPlan,
    reasoning: {
      nextStepKind: decision.guidance.nextStepKind,
      riskLevel: decision.policy.riskLevel,
      requiresConfirmation: decision.policy.requiresConfirmation,
    },
  };
}
