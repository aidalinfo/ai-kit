import { Agent, createWorkflow } from "@ai_kit/core";
import { ServerKit } from "@ai_kit/server";

// Create a simple agent
const supportAgent = new Agent({
  name: "SupportAgent",
  description: "A helpful support agent",
  instructions: "You are a friendly support agent. Help users with their questions.",
});

// Create a workflow
const workflow = createWorkflow({
  name: "SupportWorkflow",
  agents: [supportAgent],
});

// Create and start the server
const server = new ServerKit({
  port: 3000,
  workflows: [workflow],
});

server.start().then(() => {
  console.log("🚀 Server is running on http://localhost:3000");
  console.log("📝 Try sending a POST request to http://localhost:3000/api/workflow");
});
