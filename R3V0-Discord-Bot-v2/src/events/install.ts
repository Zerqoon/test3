import { AuditLogEvent, Events, type GuildMember } from 'discord.js';
import type { Context } from '../core/types.js';
import { colors, goatEmbed, logButtons } from '../core/embeds.js';
import { clip, errorText, humanDuration, safeText, stamp } from '../core/util.js';
import { MessageEvents } from '../services/message-events.js';
import { changeRoles } from '../services/audit.js';
import { sendWelcome } from '../services/welcome.js';
import { routeInteraction } from '../commands/router.js';

function memberDetails(member: GuildMember): string {
  return `<@${member.id}> • **${safeText(member.displayName, 150)}**\nAccount: \`@${safeText(member.user.username, 100)}\`\nUser ID: \`${member.id}\``;
}

export function installEvents(ctx: Context): void {
  const client = ctx.client;
  const protect = (name: string, fn: () => Promise<void> | void) => {
    if (ctx.stopping) return;
    void Promise.resolve().then(fn).catch(err => ctx.logger.error({ event: name, error: errorText(err) }, 'GOAT event handler failed'));
  };
  client.on(Events.InteractionCreate, i => protect('interaction', () => routeInteraction(ctx, i)));
  const messages = new MessageEvents(ctx);
  // Raw is emitted before Discord.js mutates its cache. Capture that state in the same call stack.
  client.on(Events.Raw, packet => {
    if (ctx.stopping) return;
    try { messages.raw(packet); }
    catch (err) { ctx.logger.error({ event: 'rawMessages', error: errorText(err) }, 'GOAT raw message handler failed'); }
  });
  client.on(Events.MessageCreate, message => protect('messageCreate', () => messages.created(message)));
  client.on(Events.MessageUpdate, (before, after) => protect('messageUpdate', () => messages.updated(before, after)));
  client.on(Events.MessageDelete, message => protect('messageDelete', () => messages.deletedMessage(message)));
  client.on(Events.MessageBulkDelete, (deleted, channel) => protect('messageDeleteBulk', () => {
    if (channel.guild.id === ctx.guild.id) messages.bulkMessages(channel.id, deleted.values());
  }));
  client.on(Events.GuildAuditLogEntryCreate, (entry, guild) => protect('audit', () => { if (guild.id === ctx.guild.id) ctx.audit.ingest(entry); }));
  client.on(Events.GuildMemberAdd, member => protect('memberAdd', async () => {
    if (member.guild.id !== ctx.guild.id) return;
    ctx.members.onJoin(member);
    ctx.logs.enqueue({ channelId: ctx.config.channels.memberLogs, embeds: [goatEmbed('Member Joined', colors.green).setThumbnail(member.displayAvatarURL({ extension: 'png' }))
      .setDescription(memberDetails(member)).addFields({ name: 'Account Created', value: `${stamp(member.user.createdTimestamp)}\n${stamp(member.user.createdTimestamp, 'R')}`, inline: true },
        { name: 'Joined Server', value: stamp(member.joinedTimestamp ?? Date.now()), inline: true },
        { name: 'Account Age', value: humanDuration(Date.now() - member.user.createdTimestamp), inline: true },
        { name: 'Members', value: String(member.guild.memberCount), inline: true }).toJSON()],
      components: logButtons(ctx.guild.id, undefined, member.id).map(r => r.toJSON()) }, `join:${member.id}:${member.joinedTimestamp}`);
    try { await sendWelcome(ctx, member); }
    catch (err) { ctx.logger.warn({ userId: member.id, error: errorText(err) }, 'GOAT welcome delivery failed'); }
    if (member.roles.cache.has(ctx.config.nickname.roleId)) await ctx.nicknames.apply(member);
  }));
  client.on(Events.GuildMemberRemove, member => protect('memberRemove', () => {
    if (member.guild.id !== ctx.guild.id) return;
    ctx.logs.enqueue({ channelId: ctx.config.channels.memberLogs, embeds: [goatEmbed('Member Left', colors.red).setThumbnail(member.user.displayAvatarURL({ extension: 'png' }))
      .setDescription(`<@${member.id}> • ${safeText(member.displayName)}\nUser ID: \`${member.id}\``)
      .addFields({ name: 'Account Created', value: stamp(member.user.createdTimestamp), inline: true },
        { name: 'Account Age', value: humanDuration(Date.now() - member.user.createdTimestamp), inline: true },
        { name: 'Left Server', value: stamp(Date.now()), inline: true },
        { name: 'Joined', value: member.joinedTimestamp ? `${stamp(member.joinedTimestamp)}\n${humanDuration(Date.now() - member.joinedTimestamp)} ago` : 'Not observed', inline: true },
        { name: 'Members Remaining', value: String(member.guild.memberCount), inline: true },
        { name: 'Last Known Roles', value: clip([...member.roles.cache.values()].filter(r => r.id !== ctx.guild.id).map(r => `<@&${r.id}>`).join(' ') || 'None', 1000) }).toJSON()],
      components: logButtons(ctx.guild.id, undefined, member.id).map(r => r.toJSON()) });
  }));
  client.on(Events.GuildMemberUpdate, (before, after) => protect('memberUpdate', async () => {
    if (after.guild.id !== ctx.guild.id) return;
    ctx.members.observe(after);
    const added = [...after.roles.cache.keys()].filter(id => !before.roles.cache.has(id));
    const removed = [...before.roles.cache.keys()].filter(id => !after.roles.cache.has(id));
    if (added.length || removed.length) {
      ctx.audit.fallback([AuditLogEvent.MemberRoleUpdate], after.id, 'Member Roles Updated',
        `${memberDetails(after)}\nAdded: ${added.map(id => `<@&${id}>`).join(', ') || 'None'}\nRemoved: ${removed.map(id => `<@&${id}>`).join(', ') || 'None'}`,
        entry => added.every(id => changeRoles(entry.changes.find(c => c.key === '$add')?.new).includes(id)) &&
          removed.every(id => changeRoles(entry.changes.find(c => c.key === '$remove')?.new).includes(id)));
    }
    if (before.nickname !== after.nickname) ctx.audit.fallback([AuditLogEvent.MemberUpdate], after.id, 'Nickname Updated',
      `${memberDetails(after)}\nBefore: ${safeText(before.nickname ?? before.user.displayName)}\nAfter: ${safeText(after.nickname ?? after.user.displayName)}`,
      entry => entry.changes.some(c => c.key === 'nick' && c.new === after.nickname));
    if (before.communicationDisabledUntilTimestamp !== after.communicationDisabledUntilTimestamp) ctx.audit.fallback([AuditLogEvent.MemberUpdate], after.id, 'Timeout Updated',
      `${memberDetails(after)}\nTimeout until: ${after.communicationDisabledUntilTimestamp ? stamp(after.communicationDisabledUntilTimestamp) : 'Removed'}`,
      entry => entry.changes.some(c => c.key === 'communication_disabled_until'));
    if (added.includes(ctx.config.nickname.roleId) || removed.includes(ctx.config.nickname.roleId) || before.nickname !== after.nickname || before.user.globalName !== after.user.globalName) await ctx.nicknames.apply(after);
  }));
  client.on(Events.UserUpdate, (before, after) => protect('userUpdate', async () => {
    if (before.globalName === after.globalName && before.username === after.username) return;
    const member = ctx.guild.members.cache.get(after.id);
    if (member?.roles.cache.has(ctx.config.nickname.roleId)) await ctx.nicknames.apply(member);
  }));
  client.on(Events.GuildBanAdd, ban => protect('banAdd', () => {
    if (ban.guild.id === ctx.guild.id) ctx.audit.fallback([AuditLogEvent.MemberBanAdd], ban.user.id, 'Member Banned', `<@${ban.user.id}>\nUser ID: \`${ban.user.id}\`\nReason: ${safeText(ban.reason ?? 'Not supplied')}`);
  }));
  client.on(Events.GuildBanRemove, ban => protect('banRemove', () => {
    if (ban.guild.id !== ctx.guild.id) return;
    ctx.db.run("UPDATE moderation_cases SET status='cancelled' WHERE guild_id=? AND user_id=? AND action='ban' AND status='active'", ctx.guild.id, ban.user.id);
    ctx.audit.fallback([AuditLogEvent.MemberBanRemove], ban.user.id, 'Member Unbanned', `<@${ban.user.id}>\nUser ID: \`${ban.user.id}\``);
  }));
  client.on(Events.ChannelCreate, c => protect('channelCreate', () => {
    if (c.guild.id === ctx.guild.id) ctx.audit.fallback([AuditLogEvent.ChannelCreate], c.id, 'Channel Created', `Name: **${safeText(c.name)}**`);
  }));
  client.on(Events.ChannelDelete, c => protect('channelDelete', () => {
    if ('guild' in c && c.guild.id === ctx.guild.id) {
      ctx.tickets.channelDeleted(c.id);
      ctx.audit.fallback([AuditLogEvent.ChannelDelete], c.id, 'Channel Deleted', `Name: **${safeText(c.name)}**`);
    }
  }));
  client.on(Events.ThreadCreate, (c, newlyCreated) => protect('threadCreate', () => {
    if (newlyCreated && c.guild.id === ctx.guild.id) ctx.audit.fallback([AuditLogEvent.ThreadCreate], c.id, 'Thread Created', `Name: **${safeText(c.name)}**`);
  }));
  client.on(Events.ThreadDelete, c => protect('threadDelete', () => {
    if (c.guild.id === ctx.guild.id) ctx.audit.fallback([AuditLogEvent.ThreadDelete], c.id, 'Thread Deleted', `Name: **${safeText(c.name)}**`);
  }));
  client.on(Events.ChannelUpdate, (before, after) => protect('channelUpdate', () => {
    if (!('guild' in after) || after.guild.id !== ctx.guild.id || !('name' in before)) return;
    const details: string[] = [];
    if (before.name !== after.name) details.push(`Name: ${safeText(before.name)} → ${safeText(after.name)}`);
    if ('topic' in before && 'topic' in after && before.topic !== after.topic) details.push(`Topic: ${safeText(before.topic ?? 'None')} → ${safeText(after.topic ?? 'None')}`);
    if ('parentId' in before && 'parentId' in after && before.parentId !== after.parentId) details.push(`Category: ${before.parentId ?? 'None'} → ${after.parentId ?? 'None'}`);
    if ('permissionOverwrites' in before && 'permissionOverwrites' in after) {
      const summarize = (c: typeof before) => 'permissionOverwrites' in c ? [...c.permissionOverwrites.cache.values()].map(o => `${o.id}:${o.allow.bitfield}:${o.deny.bitfield}`).sort().join('|') : '';
      if (summarize(before) !== summarize(after)) details.push('Channel permission overwrites changed.');
    }
    if (details.length) ctx.audit.fallback([AuditLogEvent.ChannelUpdate, AuditLogEvent.ChannelOverwriteCreate, AuditLogEvent.ChannelOverwriteUpdate, AuditLogEvent.ChannelOverwriteDelete], after.id, 'Channel Updated', details.join('\n'));
  }));
  client.on(Events.ThreadUpdate, (before, after) => protect('threadUpdate', () => {
    if (after.guild.id !== ctx.guild.id) return;
    if (before.name !== after.name || before.archived !== after.archived || before.locked !== after.locked) ctx.audit.fallback([AuditLogEvent.ThreadUpdate], after.id, 'Thread Updated',
      `Name: ${safeText(before.name)} → ${safeText(after.name)}\nArchived: ${before.archived} → ${after.archived}\nLocked: ${before.locked} → ${after.locked}`);
  }));
  client.on(Events.GuildRoleCreate, role => protect('roleCreate', () => { if (role.guild.id === ctx.guild.id) ctx.audit.fallback([AuditLogEvent.RoleCreate], role.id, 'Role Created', `**${safeText(role.name)}**\nRole ID: \`${role.id}\``); }));
  client.on(Events.GuildRoleDelete, role => protect('roleDelete', () => { if (role.guild.id === ctx.guild.id) ctx.audit.fallback([AuditLogEvent.RoleDelete], role.id, 'Role Deleted', `**${safeText(role.name)}**\nRole ID: \`${role.id}\``); }));
  client.on(Events.GuildRoleUpdate, (before, after) => protect('roleUpdate', () => {
    if (after.guild.id !== ctx.guild.id) return;
    if (before.name === after.name && before.color === after.color && before.permissions.bitfield === after.permissions.bitfield && before.position === after.position && before.hoist === after.hoist && before.mentionable === after.mentionable) return;
    const changes: string[] = [];
    if (before.name !== after.name) changes.push(`Name: **${safeText(before.name)}** → **${safeText(after.name)}**`);
    if (before.color !== after.color) changes.push(`Color: ${before.hexColor} → ${after.hexColor}`);
    if (before.position !== after.position) changes.push(`Position: ${before.position} → ${after.position}`);
    if (before.hoist !== after.hoist) changes.push(`Separate member list: ${after.hoist ? 'Enabled' : 'Disabled'}`);
    if (before.mentionable !== after.mentionable) changes.push(`Mentionable: ${after.mentionable ? 'Yes' : 'No'}`);
    if (before.permissions.bitfield !== after.permissions.bitfield) {
      const added = after.permissions.toArray().filter(permission => !before.permissions.has(permission, false));
      const removed = before.permissions.toArray().filter(permission => !after.permissions.has(permission, false));
      const label = (value: string) => value.replace(/([a-z])([A-Z])/g, '$1 $2');
      if (added.length) changes.push(`Granted: ${added.map(label).join(', ')}`);
      if (removed.length) changes.push(`Removed: ${removed.map(label).join(', ')}`);
    }
    ctx.audit.fallback([AuditLogEvent.RoleUpdate], after.id, 'Role Updated', changes.join('\n'));
  }));
}
