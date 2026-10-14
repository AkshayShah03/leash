import { anthropic } from '@ai-sdk/anthropic';
import { generateText, Output } from 'ai';
import { verdictSchema, type GenerateVerdict } from './intent';

export function claudeGenerate(modelId = process.env.LEASH_MODEL || 'claude-sonnet-5-5'): GenerateVerdict {
  return async ({ system, prompt }) => {
    const { output } = await generateText({
      model: anthropic(modelId),
      output: Output.object({ schema: verdictSchema }),
      system,
      prompt,
    });
    return output;
  };
}
