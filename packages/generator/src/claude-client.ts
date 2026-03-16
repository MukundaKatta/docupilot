import Anthropic from "@anthropic-ai/sdk";

export interface ClaudeOptions {
  apiKey: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
}

const DEFAULT_MODEL = "claude-sonnet-4-20250514";
const DEFAULT_MAX_TOKENS = 4096;
const DEFAULT_TEMPERATURE = 0.3;

let clientInstance: Anthropic | null = null;

export function getClaudeClient(apiKey: string): Anthropic {
  if (!clientInstance || (clientInstance as unknown as { apiKey: string }).apiKey !== apiKey) {
    clientInstance = new Anthropic({ apiKey });
  }
  return clientInstance;
}

export async function generateWithClaude(
  systemPrompt: string,
  userPrompt: string,
  options: ClaudeOptions
): Promise<string> {
  const client = getClaudeClient(options.apiKey);

  const response = await client.messages.create({
    model: options.model ?? DEFAULT_MODEL,
    max_tokens: options.maxTokens ?? DEFAULT_MAX_TOKENS,
    temperature: options.temperature ?? DEFAULT_TEMPERATURE,
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("No text response from Claude");
  }

  return textBlock.text;
}

export async function generateWithClaudeStreaming(
  systemPrompt: string,
  userPrompt: string,
  options: ClaudeOptions,
  onChunk: (text: string) => void
): Promise<string> {
  const client = getClaudeClient(options.apiKey);

  const stream = client.messages.stream({
    model: options.model ?? DEFAULT_MODEL,
    max_tokens: options.maxTokens ?? DEFAULT_MAX_TOKENS,
    temperature: options.temperature ?? DEFAULT_TEMPERATURE,
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
  });

  let fullText = "";

  for await (const event of stream) {
    if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
      const text = event.delta.text;
      fullText += text;
      onChunk(text);
    }
  }

  return fullText;
}
