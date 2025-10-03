export class WorkflowSchemaError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "WorkflowSchemaError";
  }
}

export class WorkflowAbortError extends Error {
  constructor(message = "Workflow run aborted") {
    super(message);
    this.name = "WorkflowAbortError";
  }
}

export class WorkflowExecutionError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "WorkflowExecutionError";
  }
}

export class WorkflowBranchResolutionError extends Error {
  constructor(message: string, public readonly branchId?: unknown) {
    super(message);
    this.name = "WorkflowBranchResolutionError";
  }
}

export class WorkflowResumeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkflowResumeError";
  }
}
