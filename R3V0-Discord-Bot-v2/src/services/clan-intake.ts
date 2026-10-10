import type { GuildMember } from 'discord.js';
import type { Context } from '../core/types.js';
import { UserError } from '../core/util.js';

export const CLAN_CAPACITY = 20;
export class ClanBlacklistError extends UserError {}
interface IntakeRow { enabled: number; occupied: number; revision: number; updated_at: number; updated_by: string | null }
export interface ClanIntakeStatus {
  capacity: number; enabled: boolean; occupied: number; reserved: number; used: number;
  available: number; displayUsed: number; accepting: boolean; revision: number;
  updatedAt: number; updatedBy: string | null;
}

/** Count the actual occupied places separately from reservations for undecided applications. */
export class ClanIntakeService {
  constructor(private readonly ctx: Context) {
    ctx.db.transaction(() => {
      const created = ctx.db.run('INSERT OR IGNORE INTO clan_intake(guild_id,updated_at) VALUES(?,?)', ctx.guild.id, Date.now());
      if (Number(created.changes)) {
        // Upgrade without closing an existing application or losing a waiting vote.
        ctx.db.run(`INSERT OR IGNORE INTO clan_application_seats(ticket_id,guild_id,state,created_at,updated_at)
          SELECT t.id,t.guild_id,'reserved',t.created_at,? FROM tickets t
          LEFT JOIN ticket_reviews r ON r.ticket_id=t.id
          WHERE t.guild_id=? AND t.kind='application' AND t.state IN ('creating','open','reopening') AND r.decision IS NULL`, Date.now(), ctx.guild.id);
      }
    });
  }
  status(): ClanIntakeStatus {
    const row = this.ctx.db.get<IntakeRow>('SELECT * FROM clan_intake WHERE guild_id=?', this.ctx.guild.id)!;
    const reserved = this.ctx.db.get<{ n: number }>("SELECT COUNT(*) n FROM clan_application_seats WHERE guild_id=? AND state='reserved'", this.ctx.guild.id)!.n;
    const used = row.occupied + reserved;
    const available = Math.max(0, CLAN_CAPACITY - used);
    return { capacity: CLAN_CAPACITY, enabled: !!row.enabled, occupied: row.occupied, reserved, used, available,
      displayUsed: Math.min(CLAN_CAPACITY, used), accepting: !!row.enabled && available > 0,
      revision: row.revision, updatedAt: row.updated_at, updatedBy: row.updated_by };
  }
  assertMember(member: GuildMember): void {
    if (this.ctx.config.tickets.clanBlacklistRoleIds.some(id => member.roles.cache.has(id))) {
      throw new ClanBlacklistError('You cannot create a clan application. Contact Support if you need help.');
    }
  }
  assertAvailable(): void {
    const status = this.status();
    if (!status.enabled) throw new UserError('Clan applications are currently closed. Support follows its daily opening hours.');
    if (!status.available) throw new UserError('The clan is full: 20/20 places are occupied or reserved. Please try again when a place opens.');
  }
  close(actorId: string): ClanIntakeStatus {
    this.ctx.db.run('UPDATE clan_intake SET enabled=0,revision=revision+1,updated_at=?,updated_by=? WHERE guild_id=?', Date.now(), actorId, this.ctx.guild.id);
    return this.status();
  }
  open(available: number, actorId: string): ClanIntakeStatus {
    if (!Number.isInteger(available) || available < 0 || available > CLAN_CAPACITY) throw new UserError('Choose between 0 and 20 free places. Use 0 to mark the clan full.');
    return this.ctx.db.transaction(() => {
      const status = this.status();
      if (status.reserved + available > CLAN_CAPACITY) {
        throw new UserError(`There are ${status.reserved} reserved applications. You can offer at most ${Math.max(0, CLAN_CAPACITY - status.reserved)} free places. Resolve existing applications first.`);
      }
      this.ctx.db.run('UPDATE clan_intake SET enabled=1,occupied=?,revision=revision+1,updated_at=?,updated_by=? WHERE guild_id=?',
        CLAN_CAPACITY - status.reserved - available, Date.now(), actorId, this.ctx.guild.id);
      return this.status();
    });
  }
  /** Called inside the same SQLite transaction that creates or reopens the ticket. */
  reserve(ticketId: number): void {
    const seat = this.ctx.db.get<{ state: string }>('SELECT state FROM clan_application_seats WHERE ticket_id=?', ticketId);
    if (seat?.state === 'reserved' || seat?.state === 'accepted') return;
    this.assertAvailable();
    this.ctx.db.run(`INSERT INTO clan_application_seats(ticket_id,guild_id,state,created_at,updated_at) VALUES(?,?,'reserved',?,?)
      ON CONFLICT(ticket_id) DO UPDATE SET state='reserved',updated_at=excluded.updated_at`, ticketId, this.ctx.guild.id, Date.now(), Date.now());
    this.changed();
  }
  /** A saved verdict consumes or frees its reservation exactly once, before network calls. */
  settle(ticketId: number, accepted: boolean): void {
    if (accepted && this.status().occupied >= CLAN_CAPACITY && this.ctx.db.get("SELECT 1 FROM clan_application_seats WHERE ticket_id=? AND state='reserved'", ticketId)) {
      throw new UserError('The clan already has 20 occupied places. Update the number of free places before accepting this application.');
    }
    const result = this.ctx.db.run("UPDATE clan_application_seats SET state=?,updated_at=? WHERE ticket_id=? AND guild_id=? AND state='reserved'",
      accepted ? 'accepted' : 'released', Date.now(), ticketId, this.ctx.guild.id);
    if (!Number(result.changes)) return;
    if (accepted) this.ctx.db.run('UPDATE clan_intake SET occupied=occupied+1 WHERE guild_id=?', this.ctx.guild.id);
    this.changed();
  }
  release(ticketId: number): void { this.settle(ticketId, false); }
  private changed(): void {
    this.ctx.db.run('UPDATE clan_intake SET revision=revision+1 WHERE guild_id=?', this.ctx.guild.id);
  }
}
