import { seedDemo } from '../src/seed';
import { Store } from '../src/store';

const store = new Store(process.env.LEASH_DB_PATH || 'leash.db');
const m = seedDemo(store, { vaultId: process.env.DEMO_VAULT_ID || undefined });
console.log(m ? 'Demo rules seeded' : 'Store already has rules; nothing to seed');
