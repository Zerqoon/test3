import { EventEmitter } from 'node:events';
import pino from 'pino';
import { ChannelType, Collection, PermissionsBitField, IntentsBitField, GatewayIntentBits,
  type ButtonInteraction, type GuildMember, type Message, type MessageCreateOptions,
  type ModalSubmitInteraction, type OverwriteData } from 'discord.js';
import { config } from '../src/core/config.js';
import { Store } from '../src/core/store.js';
import type { Context } from '../src/core/types.js';
import { LogService } from '../src/services/logs.js';
import { AuditService } from '../src/services/audit.js';
import { MemberService } from '../src/services/members.js';
import { TicketService } from '../src/services/tickets.js';
import { GiveawayService } from '../src/services/giveaways.js';
import { EmbedService } from '../src/services/custom-embeds.js';
import { LinkFilterService } from '../src/services/link-filter.js';
import { UsernameService } from '../src/services/usernames.js';
import { HistoryService } from '../src/services/history.js';
import { RoleReminderService } from '../src/services/role-reminders.js';
import { FilterNoticeService } from '../src/services/filter-notices.js';
import { TemporaryMessageService } from '../src/services/temporary-messages.js';
import { BoostService } from '../src/services/boosts.js';
import { RulesService } from '../src/services/rules.js';

export const GUILD = '1550000000000000100', ALICE = '1550000000000000101', BOB = '1550000000000000102',
  BOT = '1550000000000000103', STAFF = '1550000000000000104';
export const avatar = () => 'https://cdn.discordapp.com/embed/avatars/0.png';
export const json = <T>(value: T): T => (value && typeof value === 'object' && 'toJSON' in value ?
  (value as { toJSON(): T }).toJSON() : value);

export function fixture(options: { filter?: boolean } = {}) {
  const db = new Store(':memory:'); const settings = structuredClone(config); settings.logging.batchWindowMs = 0; settings.linkFilter.enabled = options.filter ?? false;
  // Existing ticket tests do not depend on the real clock; dedicated schedule tests enable it.
  settings.tickets.supportHours.enabled = false;
  const ctx = { db, config: settings, logger: pino({ level: 'silent' }), stopping: false, startedAt: Date.now(),
    client: Object.assign(new EventEmitter(), { user: { id: BOT }, options: { intents: new IntentsBitField([GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]) }, ws: { ping: 0 }, users: { fetch: async (id: string) => ({ send: async (payload: MessageCreateOptions) => {
      if (dmError !== undefined) throw Object.assign(new Error('DM failure'), { code: dmError }); dms.push({ userId: id, payload });
      return { id: String(++serial) };
    } }) } }) } as unknown as Context;
  const members = new Collection<string, GuildMember>(); const channels = new Collection<string, ReturnType<typeof makeChannel>>();
  const sent: { channelId: string; payload: MessageCreateOptions }[] = [], roleAdds: string[] = [], deletes: string[] = [];
  const dms: { userId: string; payload: MessageCreateOptions }[] = []; let dmError: number | undefined;
  let serial = 1550000000000100000n, failSend = false, failHistory = false, rolePosition = 1, failPermissions = false;
  function addMember(id: string, roles: string[] = [], bot = false, joined = Date.now() - 86400000) {
    const cache = new Collection(roles.map(role => [role, { id: role }]));
    const member = { id, guild: ctx.guild, partial: false, joinedTimestamp: joined, displayName: id === ALICE ? 'Stormy' : 'GOAT Member', displayAvatarURL: avatar,
      premiumSinceTimestamp: null,
      user: { id, bot, createdTimestamp: Date.now() - 365 * 86400000, username: `user_${id}`, displayName: 'GOAT Member', displayAvatarURL: avatar },
      permissions: new PermissionsBitField(), roles: { cache, add: async (role: string) => { roleAdds.push(id); cache.set(role, { id: role }); return member; } }
    } as unknown as GuildMember;
    members.set(id, member); return member;
  }
  function makeChannel(id: string, name = 'test', type = ChannelType.GuildText, topic: string | null = null) {
    const messages = new Collection<string, Message>();
    const channel = { id, name, type, topic, overwrites: [] as OverwriteData[],
      isTextBased: () => type !== ChannelType.GuildCategory, isThread: () => false,
      permissionsFor: () => ({ has: () => true }),
      permissionOverwrites: { set: async (rows: OverwriteData[]) => {
        if (failPermissions) throw new Error('Permission update interrupted'); channel.overwrites = rows; return channel;
      } },
      setName: async (value: string) => { channel.name = value; return channel; },
      delete: async () => { deletes.push(id); channels.delete(id); return channel; },
      send: async (payload: MessageCreateOptions) => {
        if (failSend) throw new Error('Simulated REST interruption');
        sent.push({ channelId: id, payload }); const messageId = String(++serial);
        const rowComponents = (payload.components ?? []).map(row => {
          const value = json(row) as { components?: { custom_id?: string }[] };
          return { components: (value.components ?? []).map(component => ({ customId: component.custom_id })) };
        });
        const message = { id: messageId, guildId: GUILD, channelId: id, webhookId: null, nonce: payload.nonce ?? null,
          createdTimestamp: Date.now(), editedTimestamp: null, content: payload.content ?? '',
          author: members.get(BOT)!.user, member: members.get(BOT), attachments: new Collection(), stickers: new Collection(),
          embeds: (payload.embeds ?? []).map(embed => ({ ...json(embed), toJSON: () => json(embed) })), components: rowComponents,
          edit: async (edited: MessageCreateOptions) => {
            if (edited.embeds) message.embeds = edited.embeds.map(embed => ({ ...json(embed), toJSON: () => json(embed) })) as unknown as Message['embeds'];
            if (edited.components) message.components = edited.components.map(row => {
              const value = json(row) as { components?: { custom_id?: string }[] };
              return { components: (value.components ?? []).map(component => ({ customId: component.custom_id })) };
            }) as unknown as Message['components'];
            return message;
          }
        } as unknown as Message;
        messages.set(messageId, message); return message;
      },
      messages: { cache: messages, fetch: async (arg: string | { message?: string; before?: string; limit?: number }) => {
        if (typeof arg !== 'string' && arg.message) arg = arg.message;
        if (typeof arg === 'string') {
          if (!messages.has(arg)) throw Object.assign(new Error('Unknown message'), { code: 10008 }); return messages.get(arg)!;
        }
        if (failHistory && name.startsWith('clan-')) throw new Error('History unavailable');
        const rows = [...messages.values()].filter(m => !arg.before || BigInt(m.id) < BigInt(arg.before))
          .sort((a, b) => BigInt(a.id) > BigInt(b.id) ? -1 : 1).slice(0, arg.limit ?? 100);
        return new Collection(rows.map(m => [m.id, m]));
      }, delete: async (messageId: string) => { deletes.push(messageId); messages.delete(messageId); } },
      messageCache: messages
    };
    channels.set(id, channel); return channel;
  }
  const guild = { id: GUILD, name: 'GOAT Tests', channels: { cache: channels,
    fetch: async (id?: string) => {
      if (!id) return channels;
      if (!channels.has(id)) throw Object.assign(new Error('Unknown channel'), { code: 10003 }); return channels.get(id)!;
    },
    create: async (options: { name: string; type: ChannelType; topic?: string; permissionOverwrites: OverwriteData[] }) => {
      const channel = makeChannel(String(++serial), options.name, options.type, options.topic ?? null);
      channel.overwrites = options.permissionOverwrites; return channel;
    }
  }, roles: { fetch: async (id: string) => ({ id, managed: false }) }, members: {
    cache: members, fetchMe: async () => ({ permissions: { has: () => true }, roles: { highest: { comparePositionTo: () => rolePosition } } }),
    fetch: async (arg?: string | { user: string; force?: boolean }) => {
      if (!arg) return members;
      const id = typeof arg === 'string' ? arg : arg.user;
      if (!members.has(id)) throw Object.assign(new Error('Unknown member'), { code: 10007 }); return members.get(id)!;
    }
  } };
  ctx.guild = guild as unknown as Context['guild'];
  addMember(ALICE); addMember(BOB); addMember(BOT, [], true); addMember(STAFF, [settings.access.staffRoleIds[0]]);
  addMember(settings.access.ownerUserIds[0]);
  for (const id of [settings.channels.logs, settings.channels.usernames, settings.channels.messageLogs, settings.channels.memberLogs, settings.tickets.logChannelId, settings.tickets.panelChannelId, settings.tickets.voting.channelId, settings.rules.channelId, settings.boosts.channelId, ...settings.linkFilter.unrestrictedGifChannelIds]) makeChannel(id);
  ctx.roleReminders = new RoleReminderService(ctx); ctx.temporary = new TemporaryMessageService(ctx); ctx.filterNotices = new FilterNoticeService(ctx);
  ctx.logs = new LogService(ctx); ctx.members = new MemberService(ctx); ctx.tickets = new TicketService(ctx);
  ctx.boosts = new BoostService(ctx); ctx.rules = new RulesService(ctx);
  ctx.audit = new AuditService(ctx); ctx.giveaways = new GiveawayService(ctx); ctx.embeds = new EmbedService(ctx);
  ctx.linkFilter = new LinkFilterService(ctx); ctx.usernames = new UsernameService(ctx); ctx.history = new HistoryService(ctx);
  function interaction(userId = ALICE, channelId = settings.tickets.panelChannelId, messageId = db.meta('ticket_panel_message_id')) {
    const replies: unknown[] = [];
    const acknowledgements: unknown[] = [];
    const result = { user: members.get(userId)?.user ?? { id: userId }, guild: ctx.guild, guildId: GUILD, channelId,
      message: { id: messageId }, replies, acknowledgements, deferred: false, replied: false,
      deferReply: async (options: unknown) => { result.deferred = true; acknowledgements.push(options); },
      editReply: async (payload: unknown) => { replies.push(payload); },
      reply: async (payload: unknown) => { result.replied = true; replies.push(payload); },
      showModal: async (payload: unknown) => { result.replied = true; replies.push(payload); }
    };
    return result as unknown as ButtonInteraction;
  }
  async function form(kind: 'application' | 'support', userId = ALICE, username = 'Stormy_123') {
    const button = interaction(userId); await ctx.tickets.open(button, kind);
    const replies = (button as unknown as { replies: { toJSON(): { custom_id: string } }[] }).replies;
    const customId = replies[0].toJSON().custom_id;
    const modal = Object.assign(interaction(userId), { customId, fields: { getTextInputValue: () => username } }) as unknown as ModalSubmitInteraction;
    return { modal, requestId: customId.split(':')[3] };
  }
  async function openTicket(kind: 'application' | 'support', userId = ALICE, username = 'Stormy_123') {
    const request = await form(kind, userId, username); await ctx.tickets.openModal(request.modal, request.requestId);
    const ticket = ctx.db.get<{ id: number }>('SELECT id FROM tickets WHERE owner_id=? ORDER BY id DESC LIMIT 1', userId)!;
    return ctx.tickets.get(ticket.id);
  }
  async function startVote(id = 1, userId = STAFF) {
    const ticket = ctx.tickets.get(id);
    await ctx.tickets.votes.start(interaction(userId, ticket.channel_id!, ticket.opening_message_id!), id);
  }
  function voteInteraction(userId: string, id = 1) {
    const review = ctx.tickets.votes.get(id)!; return interaction(userId, review.channel_id, review.message_id!);
  }
  function original(channelId: string, index: number, content = `Human message ${index}`) {
    return { id: String(1550000000001000000n + BigInt(index)), guildId: GUILD, channelId, webhookId: null,
      createdTimestamp: Date.now() - (1000 - index) * 1000, editedTimestamp: null, content,
      author: members.get(ALICE)!.user, member: members.get(ALICE), embeds: [], attachments: new Collection(), stickers: new Collection(), components: []
    } as unknown as Message;
  }
  return { ctx, members, channels, sent, deletes, roleAdds, dms, interaction, original, addMember, form, openTicket, startVote, voteInteraction,
    setDmError: (code?: number) => { dmError = code; },
    setSendFailure: (value: boolean) => { failSend = value; }, setHistoryFailure: (value: boolean) => { failHistory = value; },
    setRolePosition: (value: number) => { rolePosition = value; }, setPermissionFailure: (value: boolean) => { failPermissions = value; } };
}

