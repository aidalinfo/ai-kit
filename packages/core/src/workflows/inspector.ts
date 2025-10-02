import type { WorkflowGraphInspection } from "./types.js";
import type { Workflow } from "./workflow.js";

const formatGraph = (graph: WorkflowGraphInspection) => JSON.stringify(graph, null, 2);

export const renderWorkflowGraphJSON = <
  Input,
  Output,
  Meta extends Record<string, unknown>,
>(workflow: Workflow<Input, Output, Meta>) => formatGraph(workflow.inspect());
