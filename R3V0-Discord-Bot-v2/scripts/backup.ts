import { DatabaseSync, backup } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { env } from '../src/core/config.js';
const directory = resolve(dirname(env.databasePath), 'backups');
mkdirSync(directory, { recursive: true });
const path = resolve(directory, `goat-${new Date().toISOString().replace(/[:.]/g, '-')}.sqlite`);
const db = new DatabaseSync(env.databasePath, { readOnly: true });
try { await backup(db, path); console.log(`GOAT database backup: ${path}`); }
finally { db.close(); }
