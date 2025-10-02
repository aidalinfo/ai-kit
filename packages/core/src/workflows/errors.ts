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
