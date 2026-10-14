import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { generateText, Output } from 'ai';
import { verdictSchema, type GenerateVerdict } from './intent';

export const DEFAULT_MODEL = 'moonshotai/kimi-k3';

export interface LlmOptions {
  apiKey?: string;
  modelId?: string;
  fetch?: typeof fetch;
}

/** Intent-check generator backed by an open-weight model served through OpenRouter. */
export function llmGenerate(opts: LlmOptions = {}): GenerateVerdict {
  const openrouter = createOpenRouter({
    apiKey: opts.apiKey ?? process.env.OPENROUTER_API_KEY,
    fetch: opts.fetch,
  });
  const model = openrouter.chat(opts.modelId ?? (process.env.LEASH_MODEL || DEFAULT_MODEL), {
    // Route only to hosts that honour response_format; zod re-validates the verdict anyway.
    provider: { require_parameters: true },
    structuredOutputs: { strict: false },
  });
  return async ({ system, prompt }) => {
    const { output } = await generateText({
      model,
      output: Output.object({ schema: verdictSchema }),
      system,
      prompt,
    });
    return output;
  };
}
