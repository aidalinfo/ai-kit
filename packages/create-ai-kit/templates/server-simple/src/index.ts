import { Agent, createStep, createWorkflow } from "@ai_kit/core";
import { ServerKit } from "@ai_kit/server";

type SupportInput = {
  message: string;
};

// Create a simple agent exposed at /api/agents/support/*
const supportAgent = new Agent({
  name: "support",
  description: "A helpful support agent",
  instructions: "You are a friendly support agent. Help users with their questions.",
  // Replace with the model of your choice (e.g. openai("gpt-4o-mini"))
  model: {} as any,
});

// Build a trivial workflow that just echoes the message back
const supportWorkflow = createWorkflow<SupportInput, { reply: string }>({
  id: "support-workflow",
  description: "Echoes user messages so you can test the API quickly.",
})
  .then(
    createStep({
      id: "format-reply",
      handler: async ({ input }) => ({
        reply: `Thanks for reaching out! You said: "${input.message}". We'll get back to you shortly.`,
      }),
    }),
  )
  .commit();

const server = new ServerKit({
  agents: { support: supportAgent },
  workflows: { "support-workflow": supportWorkflow },
});

const port = Number(process.env.PORT ?? 3000);
server.listen({ port });

console.log(`🚀 Server is running on http://localhost:${port}`);
console.log(
  `📝 POST http://localhost:${port}/api/workflows/support-workflow/run with {"inputData":{"message":"Hello"}}`,
);
