import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

const scalewayModelIds = [
  "gemma-3-27b-it",
  "mistral-small-3.2-24b-instruct-2506",
  "voxtral-small-24b-2507",
  "gpt-oss-120b",
  "devstral-small-2505",
  "llama-3.3-70b-instruct",
  "llama-3.1-8b-instruct",
  "mistral-nemo-instruct-2407",
  "qwen3-235b-a22b-instruct-2507",
  "qwen3-coder-30b-a3b-instruct",
  "deepseek-r1-distill-llama-70b",
  "pixtral-12b-2409",
] as const;

type ScalewayModelId = (typeof scalewayModelIds)[number];

const baseScaleway = createOpenAICompatible({
  apiKey: process.env.SCALEWAY_API_KEY!,
  baseURL: "https://api.scaleway.ai/v1",
  name: "scaleway",
});

type BaseScalewayProvider = typeof baseScaleway;

type ScalewayProvider = BaseScalewayProvider & ((modelId: ScalewayModelId) => ReturnType<BaseScalewayProvider>);

export const scaleway: ScalewayProvider = Object.assign(
  (modelId: ScalewayModelId) => baseScaleway(modelId),
  baseScaleway,
);
