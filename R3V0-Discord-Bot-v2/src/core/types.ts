import type { APIEmbed, Guild, Client } from 'discord.js';
import type { Logger } from 'pino';
import type { Config } from './config.js';
import type { Store } from './store.js';
import type { LogService } from '../services/logs.js';
import type { HistoryService } from '../services/history.js';
import type { UsernameService } from '../services/usernames.js';
import type { NicknameService } from '../services/nicknames.js';
import type { GiveawayService } from '../services/giveaways.js';
import type { ModerationService } from '../services/moderation.js';
import type { AuditService } from '../services/audit.js';
import type { MemberService } from '../services/members.js';
import type { TicketService } from '../services/tickets.js';

export interface AttachmentSnapshot { id: string; url: string; name: string; size: number; contentType: string | null; }
export interface MessageSnapshot {
  id: string; guildId: string; channelId: string; authorId: string;
  username: string; displayName: string; avatarUrl: string; content: string;
  embeds: APIEmbed[]; attachments: AttachmentSnapshot[];
  stickers: { id: string; name: string; url: string }[];
  createdAt: number; editedAt: number; bot: boolean;
}
export interface Context {
  client: Client; guild: Guild; config: Config; db: Store; logger: Logger;
  logs: LogService; history: HistoryService; usernames: UsernameService;
  nicknames: NicknameService; giveaways: GiveawayService; moderation: ModerationService; audit: AuditService;
  members: MemberService; tickets: TicketService;
  startedAt: number; stopping: boolean;
}
