import type { GuildMember } from 'discord.js';
import type { Context } from '../core/types.js';
import { Mutex, errorText, nicknameWithSuffix } from '../core/util.js';

interface NicknameRow { original_nickname: string | null; base_name: string; decorated_name: string; }
export class NicknameService {
  private readonly mutex = new Mutex();
  constructor(private readonly ctx: Context) {}
  async apply(member: GuildMember): Promise<void> {
    await this.mutex.run(member.id, async () => {
      const fresh = await member.guild.members.fetch({ user: member.id, force: true });
      const row = this.ctx.db.get<NicknameRow>('SELECT * FROM nickname_state WHERE guild_id=? AND user_id=?', fresh.guild.id, fresh.id);
      if (fresh.roles.cache.has(this.ctx.config.nickname.roleId)) {
        const isOurName = row && fresh.nickname === row.decorated_name;
        const base = isOurName ? (row.original_nickname === null ? fresh.user.displayName : row.base_name) : fresh.displayName;
        const decorated = nicknameWithSuffix(base, this.ctx.config.nickname.suffix);
        if (fresh.nickname === decorated) {
          if (!row) this.save(fresh, decorated.slice(0, -this.ctx.config.nickname.suffix.length), decorated.slice(0, -this.ctx.config.nickname.suffix.length), decorated);
          return;
        }
        if (!fresh.manageable) {
          this.ctx.logger.warn({ userId: fresh.id }, 'GOAT cannot change this nickname; check role order / server ownership');
          return;
        }
        // Preserve the upper display name. Never substitute the account username.
        const original = isOurName ? row.original_nickname : fresh.nickname;
        this.save(fresh, original, base, decorated);
        try { await fresh.setNickname(decorated, 'GOAT • Clan nickname tag'); }
        catch (err) { this.ctx.logger.warn({ userId: fresh.id, error: errorText(err) }, 'GOAT nickname update failed'); }
      } else if (row) {
        if (fresh.nickname === row.decorated_name && fresh.manageable) await fresh.setNickname(row.original_nickname, 'GOAT • Clan role removed');
        this.ctx.db.run('DELETE FROM nickname_state WHERE guild_id=? AND user_id=?', fresh.guild.id, fresh.id);
      }
    });
  }
  private save(m: GuildMember, original: string | null, base: string, decorated: string): void {
    this.ctx.db.run(`INSERT INTO nickname_state(guild_id,user_id,original_nickname,base_name,decorated_name) VALUES(?,?,?,?,?)
      ON CONFLICT(guild_id,user_id) DO UPDATE SET original_nickname=excluded.original_nickname,base_name=excluded.base_name,decorated_name=excluded.decorated_name`,
    m.guild.id, m.id, original, base, decorated);
  }
  async syncAll(refresh = true): Promise<void> {
    const members = refresh ? await this.ctx.guild.members.fetch() : this.ctx.guild.members.cache;
    for (const member of members.values()) {
      if (this.ctx.stopping) return;
      if (member.roles.cache.has(this.ctx.config.nickname.roleId) || this.ctx.db.get('SELECT 1 FROM nickname_state WHERE guild_id=? AND user_id=?', member.guild.id, member.id)) {
        try { await this.apply(member); } catch (err) { this.ctx.logger.warn({ userId: member.id, error: errorText(err) }, 'GOAT nickname sync skipped a member'); }
      }
    }
  }
}
