import { randomUUID } from 'node:crypto';
import type { Store } from './store.js';

/** One running process per database. Prevents duplicate schedulers and reposts. */
export class InstanceLease {
  readonly token = randomUUID();
  private timer?: NodeJS.Timeout;
  constructor(private readonly db: Store) {
    db.sqlite.exec('CREATE TABLE IF NOT EXISTS instance_lease(id INTEGER PRIMARY KEY CHECK(id=1),token TEXT NOT NULL,expires_at INTEGER NOT NULL)');
  }
  acquire(now = Date.now()): void {
    const r = this.db.run('INSERT INTO instance_lease VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET token=excluded.token,expires_at=excluded.expires_at WHERE instance_lease.expires_at<?', this.token, now + 60_000, now);
    if (!r.changes) throw new Error('GOAT is already running on this database. Stop the other process, or wait 60 seconds after a crash.');
  }
  heartbeat(onLost: () => void): void {
    this.timer = setInterval(() => {
      const r = this.db.run('UPDATE instance_lease SET expires_at=? WHERE id=1 AND token=?', Date.now() + 60_000, this.token);
      if (!r.changes) onLost();
    }, 10_000);
  }
  release(): void {
    if (this.timer) clearInterval(this.timer);
    this.db.run('DELETE FROM instance_lease WHERE id=1 AND token=?', this.token);
  }
}
