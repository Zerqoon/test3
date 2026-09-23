import Database from 'better-sqlite3';
import { mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';
import { logger } from '../logger.js';

const dbDir = dirname(config.DATABASE_PATH);
mkdirSync(dbDir, { recursive: true });

export const db = new Database(config.DATABASE_PATH);
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('busy_timeout = 5000');
db.pragma('foreign_keys = ON');

export function migrate() {
  const here = dirname(fileURLToPath(import.meta.url));
  const migrationsDir = join(here, 'migrations');
  const migrations = readdirSync(migrationsDir)
    .filter(file => /^\d+.*\.sql$/i.test(file))
    .sort((a, b) => a.localeCompare(b, 'en'));

  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename TEXT PRIMARY KEY,
      applied_at INTEGER NOT NULL
    );
  `);

  const applied = db.prepare('SELECT 1 FROM schema_migrations WHERE filename=?');
  const mark = db.prepare('INSERT INTO schema_migrations(filename,applied_at) VALUES(?,?)');

  const runMigration = db.transaction((filename: string, sql: string) => {
    db.exec(sql);
    mark.run(filename, Date.now());
  });

  for (const filename of migrations) {
    if (applied.get(filename)) continue;
    const sql = readFileSync(join(migrationsDir, filename), 'utf8');
    runMigration(filename, sql);
    logger.info({ filename }, '[DB] migration applied');
  }
}
