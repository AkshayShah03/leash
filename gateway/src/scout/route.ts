import { Hono } from 'hono';
import { z } from 'zod';
import type { ScoutTurnResult } from './agent';

export const chatSchema = z.object({
  mandateId: z.string().min(1).max(200),
  conversationId: z.string().min(1).max(100),
  messages: z
    .array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().min(1).max(4000) }))
    .min(1)
    .max(40),
});

export type ScoutChatArgs = z.infer<typeof chatSchema>;
export type RunScoutTurn = (args: ScoutChatArgs) => Promise<ScoutTurnResult>;

/**
 * Sub-app with no auth of its own: createApp mounts it behind allow('owner')
 * (`app.use('/api/scout/*', allow('owner'))`), so it must not be mounted elsewhere.
 */
export function createScoutRoute(runTurn: RunScoutTurn, requireMandate: (id: string) => unknown): Hono {
  const route = new Hono();
  route.post('/chat', async (c) => {
    const args = chatSchema.parse(await c.req.json());
    requireMandate(args.mandateId); // 404 before spending LLM credits
    try {
      return c.json(await runTurn(args));
    } catch (err) {
      console.error('scout turn failed', err);
      return c.json({ error: 'scout_unavailable' }, 502);
    }
  });
  return route;
}
