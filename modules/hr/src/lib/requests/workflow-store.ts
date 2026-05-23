export {
  buildRequestId,
  createWorkflowRequest,
  demoWorkflowChangedEvent,
  demoWorkflowStorageKey,
  getDefaultTimeline,
  getInitialWorkflowRequests,
  loadWorkflowRequests,
  saveWorkflowDecision,
  saveWorkflowRequests,
} from "@/lib/demo/workflow-store";

export type {
  DemoApprovalStep,
  DemoRequestStatus,
  DemoRequestType,
  DemoStepState,
  DemoWorkflowRequest,
  WorkflowDecisionAction,
  WorkflowDecisionEventInput,
} from "@/lib/demo/workflow-store";
