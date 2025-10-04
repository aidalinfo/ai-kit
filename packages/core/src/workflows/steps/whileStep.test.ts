import { describe, expect, it } from "vitest";

import { WorkflowAbortError, WorkflowExecutionError } from "../errors.js";
import type { WorkflowStepContext } from "../types.js";
import { createStep } from "./step.js";
import {
  createWhileStep,
  type WhileLoopState,
} from "./whileStep.js";

const createTestContext = (): WorkflowStepContext => {
  let metadata: Record<string, unknown> = {};

  return {
    workflowId: "workflow",
    runId: "run",
    initialInput: undefined,
    store: new Map<string, unknown>(),
    getMetadata() {
      return metadata;
    },
    updateMetadata(updater) {
      metadata = updater(metadata);
    },
    emit() {
      // no-op
    },
  };
};

describe("createWhileStep", () => {
  it("executes the body while the condition is true and returns the last output", async () => {
    const conditionStep = createStep<WhileLoopState<number, number>, boolean>({
      id: "condition",
      handler: ({ input }) => input.iteration < input.initialInput,
    });

    const bodyStep = createStep<WhileLoopState<number, number>, number>({
      id: "body",
      handler: ({ input }) => (input.lastOutput ?? 0) + 1,
    });

    const whileStep = createWhileStep<number, number, typeof conditionStep, typeof bodyStep>({
      id: "while",
      condition: conditionStep,
      body: bodyStep,
    });

    const controller = new AbortController();
    const result = await whileStep.execute({
      input: 3,
      context: createTestContext(),
      signal: controller.signal,
    });

    expect(result.output).toBe(3);
  });

  it("aggregates outputs with the collect function when provided", async () => {
    const conditionStep = createStep<WhileLoopState<number, number>, boolean>({
      id: "condition",
      handler: ({ input }) => input.iteration < input.initialInput,
    });

    const bodyStep = createStep<WhileLoopState<number, number>, number>({
      id: "body",
      handler: ({ input }) => (input.lastOutput ?? 0) + 1,
    });

    const whileStep = createWhileStep<number, number, typeof conditionStep, typeof bodyStep>({
      id: "while",
      condition: conditionStep,
      body: bodyStep,
      collect: async (outputs) => outputs.reduce((sum, value) => sum + value, 0),
    });

    const controller = new AbortController();
    const result = await whileStep.execute({
      input: 3,
      context: createTestContext(),
      signal: controller.signal,
    });

    expect(result.output).toBe(6);
  });

  it("respects abort signals between iterations", async () => {
    const controller = new AbortController();

    const conditionStep = createStep<WhileLoopState<number, number>, boolean>({
      id: "condition",
      handler: ({ input }) => input.iteration < 5,
    });

    const bodyStep = createStep<WhileLoopState<number, number>, number>({
      id: "body",
      handler: ({ input }) => {
        if (input.iteration === 0) {
          controller.abort(new WorkflowAbortError("cancelled"));
        }

        return (input.lastOutput ?? 0) + 1;
      },
    });

    const whileStep = createWhileStep<number, number, typeof conditionStep, typeof bodyStep>({
      id: "while",
      condition: conditionStep,
      body: bodyStep,
    });

    await expect(
      whileStep.execute({
        input: 3,
        context: createTestContext(),
        signal: controller.signal,
      }),
    ).rejects.toBeInstanceOf(WorkflowAbortError);
  });

  it("throws when exceeding the maximum iterations", async () => {
    const conditionStep = createStep<WhileLoopState<number, number>, boolean>({
      id: "condition",
      handler: () => true,
    });

    const bodyStep = createStep<WhileLoopState<number, number>, number>({
      id: "body",
      handler: ({ input }) => (input.lastOutput ?? 0) + 1,
    });

    const whileStep = createWhileStep<number, number, typeof conditionStep, typeof bodyStep>({
      id: "while",
      condition: conditionStep,
      body: bodyStep,
      maxIterations: 2,
    });

    const controller = new AbortController();

    await expect(
      whileStep.execute({
        input: 3,
        context: createTestContext(),
        signal: controller.signal,
      }),
    ).rejects.toBeInstanceOf(WorkflowExecutionError);
  });

  it("validates that the condition resolves to a boolean", async () => {
    const conditionStep = createStep<WhileLoopState<number, number>, boolean>({
      id: "condition",
      handler: () => "not-a-boolean" as unknown as boolean,
    });

    const bodyStep = createStep<WhileLoopState<number, number>, number>({
      id: "body",
      handler: ({ input }) => (input.lastOutput ?? 0) + 1,
    });

    const whileStep = createWhileStep<number, number, typeof conditionStep, typeof bodyStep>({
      id: "while",
      condition: conditionStep,
      body: bodyStep,
    });

    const controller = new AbortController();

    await expect(
      whileStep.execute({
        input: 3,
        context: createTestContext(),
        signal: controller.signal,
      }),
    ).rejects.toBeInstanceOf(WorkflowExecutionError);
  });
});
