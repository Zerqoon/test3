import { ChannelType, type GuildTextBasedChannel, type Message } from 'discord.js';
import type { Context } from '../core/types.js';
import { snapshotMessage } from '../core/messages.js';
import { colors, goatEmbed } from '../core/embeds.js';
import { errorText, sleep } from '../core/util.js';

interface HistoryRow {
  complete: number; before_id: string | null; scan_head_id: string | null;
  checkpoint_id: string | null; imported: number;
}

export class HistoryService {
  running = false;
  progress = 'Waiting to start';
  private timer?: NodeJS.Timeout;
  constructor(private readonly ctx: Context) {}
  ingest(message: Message, origin: 'live' | 'history'): boolean {
    if (!message.guildId || message.guildId !== this.ctx.guild.id) return false;
    if (this.ctx.config.history.excludedChannelIds.includes(message.channelId)) return false;
    if (message.author.bot || message.webhookId) { this.ctx.usernames.reconcile(message); return false; }
    const s = snapshotMessage(message);
    const added = this.ctx.db.recordMessage(s, origin);
    if (message.channelId === this.ctx.config.channels.usernames &&
      (origin === 'live' || this.ctx.config.usernames.convertExistingOnStartup)) {
      this.ctx.usernames.prepare(s, origin === 'history');
    }
    return added;
  }
  startTimer(): void {
    this.timer = setInterval(() => { if (!this.running) void this.run(); }, this.ctx.config.history.syncIntervalMinutes * 60_000);
  }
  stop(): void { if (this.timer) clearInterval(this.timer); }
  summary(): { indexed: number; complete: number; pending: number; errors: number; lastFinished?: string } {
    const indexed = this.ctx.db.get<{ n: number }>('SELECT COUNT(*) n FROM messages WHERE guild_id=? AND counted=1', this.ctx.guild.id)!.n;
    const rows = this.ctx.db.all<{ complete: number; error: string | null }>('SELECT complete,error FROM history_channels WHERE guild_id=?', this.ctx.guild.id);
    return { indexed, complete: rows.filter(r => r.complete && !r.error).length, pending: rows.filter(r => !r.complete).length,
      errors: rows.filter(r => r.error).length, lastFinished: this.ctx.db.meta('history_last_finished') };
  }
  async run(): Promise<void> {
    if (this.running || this.ctx.stopping) return;
    this.running = true;
    this.ctx.db.setMeta('history_state', 'running');
    try {
      const channels = await this.discover();
      // Index the username channel before publishing its old submissions.
      channels.sort((a, b) => Number(b.id === this.ctx.config.channels.usernames) - Number(a.id === this.ctx.config.channels.usernames));
      let processed = 0;
      for (const channel of channels) {
        if (this.ctx.stopping) return;
        this.progress = `Scanning ${channel.name} (${++processed}/${channels.length})`;
        try {
          await this.importChannel(channel);
          if (channel.id === this.ctx.config.channels.usernames) this.ctx.usernames.releaseHistory();
        } catch (err) {
          this.ctx.db.run('UPDATE history_channels SET error=?,updated_at=? WHERE channel_id=?', errorText(err), Date.now(), channel.id);
          this.ctx.logger.warn({ channelId: channel.id, error: errorText(err) }, 'GOAT history channel could not be imported');
        }
      }
      const finishedAt = Date.now();
      this.ctx.db.setMeta('history_last_finished', String(finishedAt));
      const summary = this.summary();
      this.ctx.db.setMeta('history_state', summary.errors ? 'partial' : 'complete');
      this.progress = summary.errors ? 'Complete with inaccessible channels' : 'Available history indexed';
      const reportState = JSON.stringify([summary.errors, summary.pending, this.ctx.db.meta('history_thread_warning') ?? null]);
      if (this.ctx.db.meta('history_last_report') !== reportState) this.ctx.logs.enqueue({ embeds: [goatEmbed('History Sync', summary.errors ? colors.orange : colors.green)
        .setDescription('Accessible message history has been indexed. Existing message IDs are deduplicated; restarting does not reset totals.')
        .addFields({ name: 'Messages Indexed', value: summary.indexed.toLocaleString('en-US'), inline: true },
          { name: 'Channels', value: `${summary.complete} complete • ${summary.pending} unfinished • ${summary.errors} with errors`, inline: true },
          { name: 'Coverage', value: 'Messages deleted before GOAT observed them and channels the bot cannot access cannot be reconstructed.' })
        .toJSON()] }, `history:${finishedAt}`);
      this.ctx.db.setMeta('history_last_report', reportState);
    } catch (err) {
      this.ctx.db.setMeta('history_state', 'failed');
      this.progress = 'Sync failed; the next run will resume';
      this.ctx.logger.error({ error: errorText(err) }, 'GOAT history sync failed');
    } finally { this.running = false; }
  }
  private async discover(): Promise<GuildTextBasedChannel[]> {
    this.ctx.db.run("DELETE FROM meta WHERE key='history_thread_warning'");
    const result = new Map<string, GuildTextBasedChannel>();
    const add = (c: GuildTextBasedChannel) => { if (!this.ctx.config.history.excludedChannelIds.includes(c.id)) result.set(c.id, c); };
    const guildChannels = await this.ctx.guild.channels.fetch();
    for (const channel of guildChannels.values()) if (channel?.isTextBased() && 'messages' in channel) add(channel);
    try {
      const active = await this.ctx.guild.channels.fetchActiveThreads();
      for (const thread of active.threads.values()) add(thread);
    } catch (err) {
      this.ctx.logger.warn({ error: errorText(err) }, 'GOAT could not enumerate active threads');
      this.ctx.db.setMeta('history_thread_warning', 'Some active or archived threads could not be enumerated.');
    }
    if (this.ctx.config.history.includeArchivedThreads) {
      for (const channel of guildChannels.values()) {
        if (!channel || !('threads' in channel) || channel.isThread()) continue;
        try {
          let before: Date | undefined;
          for (;;) {
            const batch = await channel.threads.fetchArchived({ type: 'public', limit: 100, ...(before ? { before } : {}) });
            for (const thread of batch.threads.values()) add(thread);
            if (!batch.hasMore || !batch.threads.size) break;
            const times = [...batch.threads.values()].map(t => t.archiveTimestamp).filter((x): x is number => x !== null);
            if (!times.length) break;
            const next = Math.min(...times);
            if (before && next >= before.getTime()) break;
            before = new Date(next);
            await sleep(this.ctx.config.history.pageDelayMs);
          }
          if (channel.type === ChannelType.GuildText) {
            let cursor: string | undefined;
            for (;;) {
              const batch = await channel.threads.fetchArchived({ type: 'private', limit: 100, ...(cursor ? { before: cursor } : {}) });
              for (const thread of batch.threads.values()) add(thread);
              if (!batch.hasMore || !batch.threads.size) break;
              const times = [...batch.threads.values()].map(t => t.archiveTimestamp).filter((x): x is number => x !== null);
              if (!times.length) break;
              const next = new Date(Math.min(...times)).toISOString();
              if (cursor === next) break;
              cursor = next;
              await sleep(this.ctx.config.history.pageDelayMs);
            }
          }
        } catch (err) {
          this.ctx.logger.warn({ channelId: channel.id, error: errorText(err) }, 'GOAT could not enumerate some archived threads');
          this.ctx.db.setMeta('history_thread_warning', 'Some archived threads could not be enumerated.');
        }
      }
    }
    for (const c of result.values()) this.ctx.db.run('INSERT OR IGNORE INTO history_channels(channel_id,guild_id) VALUES(?,?)', c.id, this.ctx.guild.id);
    return [...result.values()];
  }
  private async importChannel(channel: GuildTextBasedChannel): Promise<void> {
    let row = this.ctx.db.get<HistoryRow>('SELECT * FROM history_channels WHERE channel_id=?', channel.id)!;
    if (row.complete || row.scan_head_id) await this.syncRecent(channel, row.checkpoint_id ?? row.scan_head_id);
    if (!row.complete) {
      let before = row.before_id ?? undefined;
      for (;;) {
        if (this.ctx.stopping) return;
        const page = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}), cache: false });
        const list = [...page.values()].sort((a, b) => a.createdTimestamp - b.createdTimestamp || (BigInt(a.id) < BigInt(b.id) ? -1 : 1));
        if (!list.length) break;
        this.ctx.db.transaction(() => {
          let imported = 0;
          for (const message of list) if (this.ingest(message, 'history')) imported++;
          this.ctx.db.run('UPDATE history_channels SET before_id=?,scan_head_id=COALESCE(scan_head_id,?),imported=imported+?,updated_at=?,error=NULL WHERE channel_id=?',
            list[0].id, list.at(-1)!.id, imported, Date.now(), channel.id);
        });
        before = list[0].id;
        await sleep(this.ctx.config.history.pageDelayMs);
      }
      this.ctx.db.run('UPDATE history_channels SET complete=1,checkpoint_id=COALESCE(checkpoint_id,scan_head_id),updated_at=?,error=NULL WHERE channel_id=?', Date.now(), channel.id);
      row = this.ctx.db.get<HistoryRow>('SELECT * FROM history_channels WHERE channel_id=?', channel.id)!;
      await this.syncRecent(channel, row.checkpoint_id);
    }
    this.ctx.db.run('UPDATE history_channels SET updated_at=?,error=NULL WHERE channel_id=?', Date.now(), channel.id);
  }
  private async syncRecent(channel: GuildTextBasedChannel, checkpoint: string | null): Promise<void> {
    if (!checkpoint) return;
    let before: string | undefined;
    let head: string | undefined;
    let done = false;
    while (!done && !this.ctx.stopping) {
      const page = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}), cache: false });
      const list = [...page.values()].sort((a, b) => BigInt(a.id) > BigInt(b.id) ? -1 : 1);
      if (!list.length) break;
      head ??= list[0].id;
      this.ctx.db.transaction(() => {
        for (const message of list) {
          if (BigInt(message.id) <= BigInt(checkpoint!)) { done = true; break; }
          this.ingest(message, 'history');
        }
      });
      before = list.at(-1)!.id;
      if (!done) await sleep(this.ctx.config.history.pageDelayMs);
    }
    if (head && !this.ctx.stopping) this.ctx.db.run('UPDATE history_channels SET checkpoint_id=?,updated_at=? WHERE channel_id=?', head, Date.now(), channel.id);
  }
}
