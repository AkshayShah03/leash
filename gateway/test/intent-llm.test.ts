import { describe, expect, it } from 'vitest';
import { DEFAULT_MODEL, llmGenerate } from '../src/intent-llm';

function openRouterFetch(content: string) {
  const calls: Array<{ url: string; body: any; headers: Record<string, string> }> = [];
  const fn = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(url),
      body: JSON.parse(String(init?.body)),
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
    });
    return new Response(
      JSON.stringify({
        id: 'gen-1',
        object: 'chat.completion',
        created: 0,
        model: DEFAULT_MODEL,
        choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }) as typeof fetch;
  return { fn, calls };
}

describe('llmGenerate (OpenRouter)', () => {
  it('requests a JSON-schema verdict from the configured open model and returns the parsed object', async () => {
    const { fn, calls } = openRouterFetch('{"score":0.91,"reason":"Matches the request"}');
    const generate = llmGenerate({ apiKey: 'or-key', modelId: 'qwen/qwen3.8-flash', fetch: fn });
    const out = await generate({ system: 'SYS', prompt: 'PROMPT' });

    expect(out).toEqual({ score: 0.91, reason: 'Matches the request' });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(calls[0].headers.authorization).toBe('Bearer or-key');
    expect(calls[0].body.model).toBe('qwen/qwen3.8-flash');
    expect(calls[0].body.response_format.type).toBe('json_schema');
    expect(calls[0].body.provider).toMatchObject({ require_parameters: true });
    expect(calls[0].body.max_tokens).toBe(1024);
    expect(JSON.stringify(calls[0].body.messages)).toContain('SYS');
    expect(JSON.stringify(calls[0].body.messages)).toContain('PROMPT');
  });

  it('defaults to Kimi K3', async () => {
    const { fn, calls } = openRouterFetch('{"score":0.5,"reason":"ok"}');
    await llmGenerate({ apiKey: 'k', fetch: fn })({ system: 's', prompt: 'p' });
    expect(DEFAULT_MODEL).toBe('moonshotai/kimi-k3');
    expect(calls[0].body.model).toBe('moonshotai/kimi-k3');
  });

  it('rejects when the model output is not valid JSON for the verdict schema', async () => {
    const { fn } = openRouterFetch('not json at all');
    await expect(llmGenerate({ apiKey: 'k', fetch: fn })({ system: 's', prompt: 'p' })).rejects.toThrow();
  });
});
