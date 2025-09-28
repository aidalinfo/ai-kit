import { createOpenAI } from "@ai-sdk/openai";

export const scaleway = createOpenAI({
  apiKey: process.env.SCALEWAY_API_KEY!,
  baseURL: "https://api.scaleway.ai/v1",
});
