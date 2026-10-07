import { AuditLogEvent, PermissionsBitField, type GuildAuditLogsEntry } from 'discord.js';
import type { Context } from '../core/types.js';
import { colors, goatEmbed, logButtons } from '../core/embeds.js';
import { clip, errorText, safeText, sleep, stamp } from '../core/util.js';

type AuditEntry = GuildAuditLogsEntry;
type Change = { key: string; old?: unknown; new?: unknown };
const titles = new Map<number, string>([
  [AuditLogEvent.ChannelCreate, 'Channel Created'], [AuditLogEvent.ChannelUpdate, 'Channel Updated'], [AuditLogEvent.ChannelDelete, 'Channel Deleted'],
  [AuditLogEvent.ChannelOverwriteCreate, 'Channel Permissions Added'], [AuditLogEvent.ChannelOverwriteUpdate, 'Channel Permissions Updated'],
  [AuditLogEvent.ChannelOverwriteDelete, 'Channel Permissions Removed'], [AuditLogEvent.RoleCreate, 'Role Created'],
  [AuditLogEvent.RoleUpdate, 'Role Updated'], [AuditLogEvent.RoleDelete, 'Role Deleted'], [AuditLogEvent.MemberRoleUpdate, 'Member Roles Updated'],
  [AuditLogEvent.MemberUpdate, 'Member Updated'], [AuditLogEvent.MemberKick, 'Member Kicked'], [AuditLogEvent.MemberBanAdd, 'Member Banned'],
  [AuditLogEvent.MemberBanRemove, 'Member Unbanned'], [AuditLogEvent.ThreadCreate, 'Thread Created'],
  [AuditLogEvent.ThreadUpdate, 'Thread Updated'], [AuditLogEvent.ThreadDelete, 'Thread Deleted'], [AuditLogEvent.GuildUpdate, 'Server Updated']
]);
export function changeRoles(value: unknown): string[] {
  return Array.isArray(value) ? value.map(v => typeof v === 'object' && v !== null && 'id' in v ? String(v.id) : '').filter(Boolean) : [];
}
function display(value: unknown, key: string): string {
  if (value === null || value === undefined) return 'Not set';
  if (['permissions', 'allow', 'deny'].includes(key) && /^\d+$/.test(String(value))) {
    try { return clip(new PermissionsBitField(BigInt(String(value))).toArray().join(', ') || 'None', 550); } catch { /* Fall through to literal value. */ }
  }
  if ((key === '$add' || key === '$remove') && Array.isArray(value)) return changeRoles(value).map(id => `<@&${id}> (\`${id}\`)`).join('\n') || 'None';
  if (typeof value === 'object') return safeText(JSON.stringify(value, (_, v) => typeof v === 'bigint' ? String(v) : v), 550);
  return safeText(String(value), 550);
}

export class AuditService {
  private entries: AuditEntry[] = [];
  constructor(private readonly ctx: Context) {}
  ingest(entry: AuditEntry): void {
    this.entries = [entry, ...this.entries.filter(e => e.id !== entry.id)].slice(0, 250);
    const title = titles.get(entry.action);
    if (!title || this.ctx.db.get('SELECT id FROM audit_seen WHERE id=?', entry.id)) return;
    const embed = goatEmbed(title, entry.action === AuditLogEvent.MemberBanAdd ? colors.red : colors.orange);
    const actor = entry.executorId ? `<@${entry.executorId}>\nID: \`${entry.executorId}\`` : 'Unknown — no executor supplied by Discord';
    embed.addFields({ name: 'Performed By', value: actor, inline: true },
      { name: 'Target', value: entry.targetId ? `ID: \`${entry.targetId}\`` : 'Not supplied', inline: true },
      { name: 'Audit Time', value: stamp(entry.createdTimestamp), inline: true });
    const target = entry.target as { name?: string; displayName?: string; username?: string } | null;
    if (target?.name || target?.displayName || target?.username) embed.setDescription(`**${safeText(target.name ?? target.displayName ?? target.username!, 220)}**`);
    if (entry.reason) embed.addFields({ name: 'Reason', value: clip(entry.reason, 700) });
    let budget = 3600;
    for (const change of entry.changes as Change[]) {
      const label = change.key === '$add' ? 'Roles Added' : change.key === '$remove' ? 'Roles Removed' : change.key === 'nick' ? 'Server Nickname' : change.key === 'communication_disabled_until' ? 'Timeout' : change.key.replace(/_/g, ' ');
      const value = change.key.startsWith('$') ? display(change.new, change.key) : `Before: ${display(change.old, change.key)}\nAfter: ${display(change.new, change.key)}`;
      if (budget <= 0 || embed.data.fields!.length >= 20) break;
      const fitted = clip(value, Math.min(900, budget));
      budget -= fitted.length;
      embed.addFields({ name: clip(label, 256), value: fitted });
    }
    embed.setFooter({ text: `GOAT • Audit ID: ${entry.id}` });
    this.ctx.db.transaction(() => {
      this.ctx.logs.enqueue({ embeds: [embed.toJSON()], components: logButtons(this.ctx.guild.id, undefined, entry.executorId ?? undefined).map(r => r.toJSON()) }, `audit:${entry.id}`);
      this.ctx.db.run('INSERT OR IGNORE INTO audit_seen(id,created_at) VALUES(?,?)', entry.id, Date.now());
    });
  }
  async find(types: readonly AuditLogEvent[], targetId: string, at: number, predicate?: (entry: AuditEntry) => boolean): Promise<AuditEntry | undefined> {
    const matches = (e: AuditEntry) => types.includes(e.action) && e.targetId === targetId &&
      Math.abs(e.createdTimestamp - at) <= 10_000 && (!predicate || predicate(e));
    const cached = this.entries.filter(matches);
    if (cached.length === 1) return cached[0];
    for (const type of types) {
      try {
        const logs = await this.ctx.guild.fetchAuditLogs({ type, limit: 15 });
        const candidates = [...logs.entries.values()].filter(matches);
        if (candidates.length === 1) { this.entries = [candidates[0], ...this.entries].slice(0, 250); return candidates[0]; }
      } catch (err) { this.ctx.logger.debug({ error: errorText(err) }, 'GOAT audit lookup unavailable'); }
    }
    return undefined;
  }
  fallback(types: readonly AuditLogEvent[], targetId: string, title: string, details: string, predicate?: (entry: AuditEntry) => boolean): void {
    const at = Date.now();
    void (async () => {
      await sleep(1800);
      if (this.ctx.stopping) return;
      const entry = await this.find(types, targetId, at, predicate);
      if (entry) { this.ingest(entry); return; }
      this.ctx.logs.enqueue({ embeds: [goatEmbed(title, colors.orange).setDescription(clip(details, 3500))
        .addFields({ name: 'Target ID', value: `\`${targetId}\`` },
          { name: 'Performed By', value: 'Unknown — no unique matching audit entry was available.' }).toJSON()] }, `fallback:${title}:${targetId}:${at}`);
    })().catch(err => this.ctx.logger.error({ error: errorText(err) }, 'GOAT audit fallback failed'));
  }
  async deletionAttribution(authorId: string, channelId: string, at: number): Promise<string> {
    await sleep(1200);
    if (this.ctx.stopping) return 'Unavailable';
    const candidate = await this.find([AuditLogEvent.MessageDelete], authorId, at, entry => {
      const extra = entry.extra as { channel?: { id?: string }; channelId?: string } | null;
      return (extra?.channel?.id ?? extra?.channelId) === channelId;
    });
    if (!candidate?.executorId) return 'Unknown — self-deletions and some bot deletions have no per-message audit entry.';
    return `Audit candidate: <@${candidate.executorId}> (\`${candidate.executorId}\`)\nDiscord links this audit entry to the author and channel, not to a specific message ID.`;
  }
}
