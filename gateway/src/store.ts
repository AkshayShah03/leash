import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import type {
  LedgerEvent, Mandate, MandateInput, Proposal, ProposalInput, ProposalStatus, SpendHistory,
} from './types';

export const COMMITTED_STATUSES: ProposalStatus[] = ['auto_approved', 'human_approved', 'captured', 'tracked'];

export type ProposalPatch = Partial<Pick<Proposal, 'status' | 'reasons' | 'intent' | 'paypal' | 'committedAt'>>;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS mandates (id TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS proposals (
  id TEXT PRIMARY KEY, mandate_id TEXT NOT NULL, status TEXT NOT NULL,
  price_cents INTEGER NOT NULL, created_at TEXT NOT NULL, committed_at TEXT, data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS proposals_by_mandate ON proposals (mandate_id, created_at);
CREATE TABLE IF NOT EXISTS events (
  seq INTEGER PRIMARY KEY AUTOINCREMENT, proposal_id TEXT NOT NULL, mandate_id TEXT NOT NULL,
  status TEXT NOT NULL, actor TEXT NOT NULL, detail TEXT NOT NULL, at TEXT NOT NULL
);
`;

const inList = (statuses: ProposalStatus[]) => statuses.map((s) => `'${s}'`).join(', ');

export class Store {
  private db: DatabaseSync;

  constructor(path = ':memory:') {
    this.db = new DatabaseSync(path);
    this.db.exec(SCHEMA);
    const cols = this.db.prepare('PRAGMA table_info(proposals)').all() as Array<{ name: string }>;
    if (!cols.some((c) => c.name === 'committed_at')) this.db.exec('ALTER TABLE proposals ADD COLUMN committed_at TEXT');
    if (!cols.some((c) => c.name === 'idempotency_key')) this.db.exec('ALTER TABLE proposals ADD COLUMN idempotency_key TEXT');
    const mcols = this.db.prepare('PRAGMA table_info(mandates)').all() as Array<{ name: string }>;
    if (!mcols.some((c) => c.name === 'created_at')) this.db.exec('ALTER TABLE mandates ADD COLUMN created_at TEXT');
    this.db.exec(
      'CREATE UNIQUE INDEX IF NOT EXISTS proposals_idem ON proposals (mandate_id, idempotency_key) WHERE idempotency_key IS NOT NULL',
    );
  }

  createMandate(input: MandateInput): Mandate {
    const m: Mandate = { ...input, id: randomUUID(), vaultId: null, setupTokenId: null };
    this.db.prepare('INSERT INTO mandates (id, created_at, data) VALUES (?, ?, ?)').run(m.id, new Date().toISOString(), JSON.stringify(m));
    return m;
  }

  getMandate(id: string): Mandate | undefined {
    const row = this.db.prepare('SELECT data FROM mandates WHERE id = ?').get(id) as { data: string } | undefined;
    return row ? (JSON.parse(row.data) as Mandate) : undefined;
  }

  /** Newest first; rows created before created_at existed (NULL) sort last. */
  listMandates(): Mandate[] {
    const rows = this.db.prepare('SELECT data FROM mandates ORDER BY created_at DESC, rowid DESC').all() as Array<{ data: string }>;
    return rows.map((r) => JSON.parse(r.data) as Mandate);
  }

  /** Patches spending rules only; vaultId/setupTokenId are never touched, whatever the patch contains. */
  updateMandateRules(id: string, patch: Partial<MandateInput>): Mandate {
    const m = this.getMandate(id);
    if (!m) throw new Error(`Mandate ${id} not found`);
    const { vaultId: _v, setupTokenId: _s, id: _id, ...rules } = patch as Partial<Mandate>;
    const next: Mandate = { ...m, ...rules, vaultId: m.vaultId, setupTokenId: m.setupTokenId, id: m.id };
    this.db.prepare('UPDATE mandates SET data = ? WHERE id = ?').run(JSON.stringify(next), id);
    return next;
  }

  updateMandate(id: string, patch: Partial<Pick<Mandate, 'vaultId' | 'setupTokenId'>>): Mandate {
    const m = this.getMandate(id);
    if (!m) throw new Error(`Mandate ${id} not found`);
    const next = { ...m, ...patch };
    this.db.prepare('UPDATE mandates SET data = ? WHERE id = ?').run(JSON.stringify(next), id);
    return next;
  }

  createProposal(mandateId: string, input: ProposalInput, at: Date, idempotencyKey?: string): Proposal {
    const p: Proposal = {
      id: randomUUID(), mandateId, input, status: 'proposed', reasons: [], intent: null, paypal: {},
      createdAt: at.toISOString(), committedAt: null,
    };
    this.db
      .prepare('INSERT INTO proposals (id, mandate_id, status, price_cents, created_at, idempotency_key, data) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(p.id, mandateId, p.status, Number.isFinite(input.priceCents) ? input.priceCents : 0, p.createdAt, idempotencyKey ?? null, JSON.stringify(p));
    return p;
  }

  listProposals(mandateId: string, status?: ProposalStatus): Proposal[] {
    const rows = (
      status
        ? this.db.prepare('SELECT data FROM proposals WHERE mandate_id = ? AND status = ? ORDER BY created_at DESC, rowid DESC').all(mandateId, status)
        : this.db.prepare('SELECT data FROM proposals WHERE mandate_id = ? ORDER BY created_at DESC, rowid DESC').all(mandateId)
    ) as Array<{ data: string }>;
    return rows.map((r) => JSON.parse(r.data) as Proposal);
  }

  findByIdempotencyKey(mandateId: string, key: string): Proposal | undefined {
    const row = this.db.prepare('SELECT data FROM proposals WHERE mandate_id = ? AND idempotency_key = ?').get(mandateId, key) as
      | { data: string }
      | undefined;
    return row ? (JSON.parse(row.data) as Proposal) : undefined;
  }

  getProposal(id: string): Proposal | undefined {
    const row = this.db.prepare('SELECT data FROM proposals WHERE id = ?').get(id) as { data: string } | undefined;
    return row ? (JSON.parse(row.data) as Proposal) : undefined;
  }

  updateProposal(id: string, patch: ProposalPatch): Proposal {
    const p = this.getProposal(id);
    if (!p) throw new Error(`Proposal ${id} not found`);
    const next: Proposal = { ...p, ...patch, paypal: { ...p.paypal, ...patch.paypal } };
    this.db.prepare('UPDATE proposals SET status = ?, committed_at = ?, data = ? WHERE id = ?').run(next.status, next.committedAt ?? null, JSON.stringify(next), id);
    return next;
  }

  appendEvent(e: Omit<LedgerEvent, 'seq'>): LedgerEvent {
    const r = this.db
      .prepare('INSERT INTO events (proposal_id, mandate_id, status, actor, detail, at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(e.proposalId, e.mandateId, e.status, e.actor, e.detail, e.at);
    return { ...e, seq: Number(r.lastInsertRowid) };
  }

  listEvents(mandateId?: string): LedgerEvent[] {
    const cols = 'seq, proposal_id AS proposalId, mandate_id AS mandateId, status, actor, detail, at';
    const rows = mandateId
      ? this.db.prepare(`SELECT ${cols} FROM events WHERE mandate_id = ? ORDER BY seq`).all(mandateId)
      : this.db.prepare(`SELECT ${cols} FROM events ORDER BY seq`).all();
    return rows.map((r) => ({ ...r }) as unknown as LedgerEvent);
  }

  spendHistory(mandateId: string, now: Date, excludeProposalId = ''): SpendHistory {
    const iso = now.toISOString();
    const monthStart = `${iso.slice(0, 7)}-01T00:00:00.000Z`;
    const dayStart = `${iso.slice(0, 10)}T00:00:00.000Z`;
    const spent = this.db
      .prepare(
        `SELECT COALESCE(SUM(price_cents), 0) AS s FROM proposals
         WHERE mandate_id = ? AND id != ? AND committed_at >= ? AND committed_at <= ? AND status IN (${inList(COMMITTED_STATUSES)})`,
      )
      .get(mandateId, excludeProposalId, monthStart, iso) as { s: number };
    const orders = this.db
      .prepare(
        `SELECT COUNT(*) AS n FROM proposals
         WHERE mandate_id = ? AND id != ? AND committed_at >= ? AND committed_at <= ? AND status IN (${inList([...COMMITTED_STATUSES, 'refunded'])})`,
      )
      .get(mandateId, excludeProposalId, dayStart, iso) as { n: number };
    return { monthSpentCents: Number(spent.s), ordersToday: Number(orders.n) };
  }
}
