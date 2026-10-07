import { AuditLogEvent, ChannelType, PermissionsBitField } from 'discord.js';
import { clip, humanDuration, safeText, stamp } from '../core/util.js';

export interface AuditChange { key: string; old?: unknown; new?: unknown; }
const labels: Record<string, string> = {
  name: 'Name', type: 'Channel Type', topic: 'Topic', parent_id: 'Category', nick: 'Server Nickname',
  communication_disabled_until: 'Timeout Until', permissions: 'Role Permissions', permission_overwrites: 'Channel Access',
  allow: 'Allowed Permissions', deny: 'Denied Permissions', color: 'Role Color', position: 'Position',
  nsfw: 'Age Restricted', rate_limit_per_user: 'Slowmode', flags: 'Settings', hoist: 'Separate Role Display',
  mentionable: 'Mentionable Role', bitrate: 'Voice Bitrate', user_limit: 'Voice User Limit',
  archived: 'Archived', locked: 'Locked', available_tags: 'Forum Tags', description: 'Description',
  default_auto_archive_duration: 'Thread Auto Archive', verification_level: 'Verification Level',
  mfa_level: 'Moderator Two-Factor Requirement', explicit_content_filter: 'Media Filter',
  afk_timeout: 'AFK Timeout', afk_channel_id: 'AFK Channel', system_channel_id: 'System Channel',
  rules_channel_id: 'Rules Channel', public_updates_channel_id: 'Updates Channel',
  '$add': 'Roles Added', '$remove': 'Roles Removed'
};
const channelNames: Record<number, string> = {
  [ChannelType.GuildText]: 'Text channel', [ChannelType.GuildVoice]: 'Voice channel',
  [ChannelType.GuildCategory]: 'Category', [ChannelType.GuildAnnouncement]: 'Announcement channel',
  [ChannelType.AnnouncementThread]: 'Announcement thread', [ChannelType.PublicThread]: 'Public thread',
  [ChannelType.PrivateThread]: 'Private thread', [ChannelType.GuildStageVoice]: 'Stage channel',
  [ChannelType.GuildForum]: 'Forum', [ChannelType.GuildMedia]: 'Media channel'
};
const words = (text: string) => text.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ').replace(/^./, char => char.toUpperCase());
export function permissionNames(value: unknown): string {
  try { return new PermissionsBitField(BigInt(String(value ?? 0))).toArray().map(words).join(', ') || 'None'; }
  catch { return 'Unavailable'; }
}
function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}
export function readableAuditValue(value: unknown, key: string, action: AuditLogEvent, depth = 0): string {
  if (value === null || value === undefined) return 'Not set';
  if (['permissions', 'allow', 'deny'].includes(key)) return permissionNames(value);
  if (key === 'type') {
    if ([AuditLogEvent.ChannelOverwriteCreate, AuditLogEvent.ChannelOverwriteUpdate, AuditLogEvent.ChannelOverwriteDelete].includes(action)) return Number(value) === 0 ? 'Role' : 'Member';
    return channelNames[Number(value)] ?? 'Other channel';
  }
  if (key === 'permission_overwrites' && Array.isArray(value)) return value.map(item => {
    const rule = object(item);
    if (!rule) return 'Unavailable access rule';
    const target = Number(rule.type) === 0 ? `<@&${rule.id}>` : `<@${rule.id}>`;
    return `${target}\nAllow: ${permissionNames(rule.allow)}\nDeny: ${permissionNames(rule.deny)}`;
  }).join('\n\n') || 'No channel overrides';
  if ((key === '$add' || key === '$remove') && Array.isArray(value)) return value.map(item => `<@&${object(item)?.id ?? ''}>`).join(' ') || 'None';
  if (key === 'parent_id' || key.endsWith('_channel_id')) return `<#${String(value)}>`;
  if (key === 'communication_disabled_until') {
    const at = Date.parse(String(value));
    return Number.isFinite(at) ? `${stamp(at)} (${stamp(at, 'R')})` : 'Removed';
  }
  if (key === 'color') return `#${Number(value).toString(16).padStart(6, '0').toUpperCase()}`;
  if (key === 'rate_limit_per_user' || key === 'afk_timeout') return Number(value) ? humanDuration(Number(value) * 1000) : 'Off';
  if (key === 'default_auto_archive_duration') return humanDuration(Number(value) * 60000);
  if (key === 'bitrate') return `${Number(value) / 1000} kbps`;
  if (key === 'flags') return Number(value) === 0 ? 'Default' : 'Channel settings changed';
  if (key === 'verification_level') return ['None', 'Verified email', 'Account age check', 'Server membership age check', 'Verified phone'][Number(value)] ?? 'Updated';
  if (key === 'explicit_content_filter') return ['Off', 'Members without roles', 'All members'][Number(value)] ?? 'Updated';
  if (key === 'mfa_level') return Number(value) ? 'Required' : 'Not required';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (Array.isArray(value)) return value.map(item => readableAuditValue(item, key, action, depth + 1)).join('\n') || 'None';
  const record = object(value);
  if (record) {
    if (record.name) return safeText(String(record.name), 200);
    if (depth >= 3) return 'Nested settings updated';
    return Object.entries(record).map(([name, v]) => `${labels[name] ?? words(name)}: ${readableAuditValue(v, name, action, depth + 1)}`).join('\n') || 'Not set';
  }
  return safeText(String(value), 4000);
}
export function formatAuditChanges(action: AuditLogEvent, changes: AuditChange[]): { fields: { name: string; value: string }[]; details: string; overflow: boolean } {
  const create = [AuditLogEvent.ChannelCreate, AuditLogEvent.RoleCreate, AuditLogEvent.ThreadCreate].includes(action);
  const fields: { name: string; value: string }[] = [];
  const all: string[] = [];
  let budget = 3400, overflow = false;
  for (const change of changes) {
    if (JSON.stringify(change.old, (_, value) => typeof value === 'bigint' ? String(value) : value) === JSON.stringify(change.new, (_, value) => typeof value === 'bigint' ? String(value) : value)) continue;
    if (create && ['flags', 'nsfw', 'rate_limit_per_user', 'position'].includes(change.key) && !change.new) continue;
    const name = labels[change.key] ?? words(change.key);
    const value = create || change.key.startsWith('$') ? readableAuditValue(change.new, change.key, action) :
      `Before: ${readableAuditValue(change.old, change.key, action)}\nAfter: ${readableAuditValue(change.new, change.key, action)}`;
    all.push(`${name}\n${value}`);
    if (fields.length >= 14 || budget < 100) { overflow = true; continue; }
    if (change.key === 'permission_overwrites' && value.length > 900) {
      const count = Array.isArray(change.new) ? change.new.length : 0;
      const short = `${count} access rules. Full permissions are included in the attached details.`;
      fields.push({ name, value: short }); budget -= name.length + short.length; overflow = true; continue;
    }
    const fitted = clip(value, Math.min(950, budget));
    if (fitted !== value) overflow = true;
    fields.push({ name, value: fitted || 'Not set' }); budget -= name.length + fitted.length;
  }
  return { fields, details: all.join('\n\n'), overflow };
}
