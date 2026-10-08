import { ActionRowBuilder, ButtonBuilder, ButtonStyle, LabelBuilder, MessageFlags, ModalBuilder, TextInputBuilder,
  TextInputStyle, type ButtonInteraction, type ChatInputCommandInteraction, type GuildTextBasedChannel, type ModalSubmitInteraction } from 'discord.js';
import type { Context } from '../core/types.js';
import { requireStaff } from '../core/access.js';
import { colors, goatEmbed, noMentions } from '../core/embeds.js';
import { clip, errorCode, errorText, Mutex, safeText, stamp, UserError } from '../core/util.js';
import type { TicketRow } from './tickets.js';

export type ApplicationDecision = 'accepted' | 'rejected';
export const VOTE_DURATION_MS = 180000;
export const VOTE_TARGET = 3;
export interface TicketReview {
  ticket_id: number; channel_id: string; message_id: string | null; state: string; ends_at: number;
  started_at: number | null;
  minimum_votes: number; voter_roles: string; decision: ApplicationDecision | null; decided_by: string | null;
  decided_at: number | null; reason: string | null; yes_count: number; no_count: number; dirty: number;
  last_update: number; dm_status: string; dm_attempts: number; retry_at: number; error: string | null;
}
export function majorityDecision(yes: number, no: number): ApplicationDecision | null {
  if (yes === no) return null;
  return yes > no ? 'accepted' : 'rejected';
}
export function votePanel(ticket: TicketRow, review: TicketReview) {
  const voting = review.state === 'voting' && Date.now() < review.ends_at;
  const status = review.decision === 'accepted' ? 'Accepted' : review.decision === 'rejected' ? 'Rejected' :
    review.state === 'cancelled' ? 'Cancelled' : review.state === 'waiting' ? 'Waiting for Start Vote' : voting ? 'Voting open' : 'Awaiting review';
  const color = review.decision === 'accepted' ? colors.green : review.decision === 'rejected' ? colors.red : colors.cyan;
  const embed = goatEmbed(safeText(ticket.owner_name ?? 'Clan Applicant', 100), color)
    .setDescription(`## @${ticket.roblox_username ?? 'Not supplied'}\n<@${ticket.owner_id}> · **${status}**`)
    .addFields({ name: 'Yes', value: `**${review.yes_count} / 3**`, inline: true }, { name: 'No', value: `**${review.no_count} / 3**`, inline: true });
  if (voting) embed.addFields({ name: 'Closes', value: `${stamp(review.ends_at, 'R')}\nFirst to **3 Yes** or **3 No** decides immediately. Otherwise the majority wins when time ends.` });
  else if (review.state === 'review') embed.addFields({ name: 'Result', value: review.reason ? safeText(review.reason, 900) : review.yes_count + review.no_count === 0 ? 'No votes — awaiting a decision.' : 'Tie — awaiting a decision.' });
  if (review.decision && review.reason) embed.addFields({ name: 'Reason', value: safeText(review.reason, 900) });
  embed.setFooter({ text: `Application #${String(ticket.id).padStart(4, '0')}` });
  return { embeds: [embed], components: [new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`goat:ticket:vote-yes:${ticket.id}`).setLabel('Vote Yes').setStyle(ButtonStyle.Success).setDisabled(!voting),
    new ButtonBuilder().setCustomId(`goat:ticket:vote-no:${ticket.id}`).setLabel('Vote No').setStyle(ButtonStyle.Danger).setDisabled(!voting))], allowedMentions: noMentions };
}
export class TicketVoteService {
  private readonly mutex = new Mutex();
  private readonly panelMutex = new Mutex();
  private timer?: NodeJS.Timeout;
  private busy = false;
  constructor(private readonly ctx: Context) {}
  startWorker(): void { this.timer = setInterval(() => { void this.tick(); }, 500); }
  stop(): void { if (this.timer) clearInterval(this.timer); }
  private wake(): void {
    // The interaction acknowledgement never waits for a transcript or Discord REST.
    if (this.timer) setImmediate(() => { void this.tick(); });
  }
  get(id: number): TicketReview | undefined { return this.ctx.db.get<TicketReview>('SELECT * FROM ticket_reviews WHERE ticket_id=?', id); }
  private counts(id: number): { yes: number; no: number } {
    const rows = this.ctx.db.all<{ choice: string; n: number }>('SELECT choice,COUNT(*) n FROM ticket_votes WHERE ticket_id=? GROUP BY choice', id);
    return { yes: rows.find(r => r.choice === 'yes')?.n ?? 0, no: rows.find(r => r.choice === 'no')?.n ?? 0 };
  }
  async start(interaction: ButtonInteraction | ChatInputCommandInteraction, id: number): Promise<void> {
    if (!interaction.deferred && !interaction.replied) await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    await requireStaff(interaction, this.ctx.config);
    await this.mutex.run(`review:${id}`, async () => {
      const ticket = this.ctx.tickets.get(id);
      if (!this.ctx.config.tickets.voting.enabled) throw new UserError('Application voting is disabled.');
      if (ticket.kind !== 'application' || ticket.state !== 'open' || interaction.channelId !== ticket.channel_id) throw new UserError('Use Start Vote inside an open clan application.');
      if ('message' in interaction && interaction.message.id !== ticket.opening_message_id) throw new UserError('Use the current ticket controls.');
      const review = this.get(id);
      if (review?.decision) throw new UserError('This application has already been decided.');
      if (review?.started_at != null) throw new UserError('Voting has already started. Its original deadline remains unchanged.');
      const now = Date.now();
      this.ctx.db.transaction(() => {
        this.ctx.db.run(`INSERT INTO ticket_reviews(ticket_id,channel_id,state,started_at,ends_at,minimum_votes,voter_roles)
          VALUES(?,?,'voting',?,?,?,'[]') ON CONFLICT(ticket_id) DO UPDATE SET state='voting',started_at=excluded.started_at,
          ends_at=excluded.ends_at,minimum_votes=excluded.minimum_votes,voter_roles='[]',dirty=1,last_update=0,retry_at=0,error=NULL,dm_status='pending'`,
          id, this.ctx.config.tickets.voting.channelId, now, now + VOTE_DURATION_MS, VOTE_TARGET);
        // Old, undecided votes remain available when upgrading from the automatic voting system.
        const counts = this.counts(id);
        this.ctx.db.run('UPDATE ticket_reviews SET yes_count=?,no_count=? WHERE ticket_id=?', counts.yes, counts.no, id);
        if (counts.yes !== counts.no && (counts.yes >= VOTE_TARGET || counts.no >= VOTE_TARGET)) this.saveDecision(id, counts.yes > counts.no ? 'accepted' : 'rejected', this.ctx.client.user!.id, `Community vote: ${counts.yes} Yes / ${counts.no} No.`);
        this.ctx.db.run('UPDATE tickets SET embed_dirty=1,retry_at=0 WHERE id=?', id);
      });
      await interaction.editReply({ content: `Voting started in <#${this.ctx.config.tickets.voting.channelId}>. It ends in 3 minutes or when either choice reaches 3 votes.`, allowedMentions: noMentions });
    });
    this.wake();
  }
  private async channel(id: string): Promise<GuildTextBasedChannel> {
    const channel = await this.ctx.guild.channels.fetch(id);
    if (!channel?.isTextBased() || !('send' in channel)) throw new Error('GOAT application voting channel is unavailable.');
    return channel;
  }
  private async syncPanel(id: number): Promise<void> {
    const review = this.get(id); if (!review) return;
    const channel = await this.channel(review.channel_id);
    let message;
    if (review.message_id) {
      try { message = await channel.messages.fetch(review.message_id); }
      catch (err) { if (errorCode(err) !== 10008) throw err; }
    }
    if (!message) {
      const recent = await channel.messages.fetch({ limit: 100 });
      message = [...recent.values()].find(m => m.author.id === this.ctx.client.user?.id && m.components.some(row =>
        'components' in row && row.components.some(c => 'customId' in c && c.customId === `goat:ticket:vote-yes:${id}`)));
    }
    const payload = votePanel(this.ctx.tickets.get(id), review);
    if (message) await message.edit(payload);
    else message = await channel.send({ ...payload, nonce: `goat-vote-${id}`, enforceNonce: true });
    this.ctx.db.run(`UPDATE ticket_reviews SET message_id=?,last_update=?,error=NULL,
      dirty=CASE WHEN state=? AND yes_count=? AND no_count=? AND ends_at=? AND decision IS ? THEN 0 ELSE 1 END WHERE ticket_id=?`,
      message.id, Date.now(), review.state, review.yes_count, review.no_count, review.ends_at, review.decision, id);
  }
  async vote(interaction: ButtonInteraction, id: number, choice: 'yes' | 'no'): Promise<void> {
    const original = this.get(id);
    if (!original || original.channel_id !== interaction.channelId || original.message_id !== interaction.message.id) throw new UserError('Use the current GOAT voting panel.');
    if (original.state !== 'voting' || Date.now() >= original.ends_at) throw new UserError('Voting on this application has ended.');
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    await this.mutex.run(`review:${id}`, async () => {
      const review = this.get(id)!; const ticket = this.ctx.tickets.get(id);
      if (review.state !== 'voting' || Date.now() >= review.ends_at || ticket.state !== 'open') throw new UserError('Voting on this application has ended.');
      if (ticket.owner_id === interaction.user.id) throw new UserError('You cannot vote on your own application.');
      if (interaction.guild?.id !== this.ctx.guild.id) throw new UserError('Use the voting panel in this server.');
      if (interaction.user.bot || this.ctx.guild.members.cache.get(interaction.user.id)?.user.bot) throw new UserError('Bots cannot vote.');
      const previous = this.ctx.db.get<{ choice: string }>('SELECT choice FROM ticket_votes WHERE ticket_id=? AND user_id=?', id, interaction.user.id);
      if (previous?.choice !== choice) this.ctx.db.transaction(() => {
        this.ctx.db.run(`INSERT INTO ticket_votes VALUES(?,?,?,?) ON CONFLICT(ticket_id,user_id) DO UPDATE SET choice=excluded.choice,voted_at=excluded.voted_at`, id, interaction.user.id, choice, Date.now());
        const counts = this.counts(id);
        this.ctx.db.run('UPDATE ticket_reviews SET yes_count=?,no_count=?,dirty=1 WHERE ticket_id=?', counts.yes, counts.no, id);
        if (counts.yes >= VOTE_TARGET || counts.no >= VOTE_TARGET) this.saveDecision(id, counts.yes >= VOTE_TARGET ? 'accepted' : 'rejected', this.ctx.client.user!.id, `Community vote: ${counts.yes} Yes / ${counts.no} No.`);
      });
      const decision = this.get(id)?.decision;
      await interaction.editReply({ content: decision ? `Your vote: **${choice === 'yes' ? 'Yes' : 'No'}**. Application **${decision}**.` : `Your vote: **${choice === 'yes' ? 'Yes' : 'No'}**. You can change it before voting closes.`, allowedMentions: noMentions });
    });
    this.wake();
  }
  async decisionModal(interaction: ButtonInteraction, id: number, decision: ApplicationDecision): Promise<void> {
    await requireStaff(interaction, this.ctx.config);
    const ticket = this.ctx.tickets.get(id);
    if (interaction.channelId !== ticket.channel_id || ticket.kind !== 'application' || ticket.state !== 'open') throw new UserError('Use the controls inside an open application ticket.');
    await interaction.showModal(new ModalBuilder().setCustomId(`goat:ticket:${decision === 'accepted' ? 'approve-modal' : 'reject-modal'}:${id}`)
      .setTitle(`${decision === 'accepted' ? 'Approve' : 'Reject'} Application`).addLabelComponents(new LabelBuilder().setLabel('Reason')
        .setTextInputComponent(new TextInputBuilder().setCustomId('reason').setStyle(TextInputStyle.Paragraph).setRequired(true)
          .setMaxLength(1000).setPlaceholder('This reason will be included in the applicant’s DM.'))));
  }
  async submitDecision(interaction: ModalSubmitInteraction, id: number, decision: ApplicationDecision): Promise<void> {
    await requireStaff(interaction, this.ctx.config);
    const ticket = this.ctx.tickets.get(id);
    if (interaction.channelId !== ticket.channel_id) throw new UserError('Use the controls inside this application ticket.');
    const reason = interaction.fields.getTextInputValue('reason').trim();
    if (!reason) throw new UserError('Enter a decision reason.');
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    await this.decide(id, decision, interaction.user.id, reason);
    await interaction.editReply({ content: `Application ${decision}. The ticket is being closed and the applicant will receive a DM.`, allowedMentions: noMentions });
  }
  async decide(id: number, decision: ApplicationDecision, actorId: string, reason: string): Promise<void> {
    await this.mutex.run(`review:${id}`, async () => {
      const ticket = this.ctx.tickets.get(id);
      if (ticket.kind !== 'application' || ticket.state !== 'open') throw new UserError('Only an open clan application can be decided.');
      this.ctx.db.run(`INSERT OR IGNORE INTO ticket_reviews(ticket_id,channel_id,ends_at,minimum_votes,voter_roles,state) VALUES(?,?,?,?,?,'review')`,
        id, this.ctx.config.tickets.voting.channelId, Date.now(), VOTE_TARGET, '[]');
      const review = this.get(id)!;
      if (review.decision) throw new UserError('This application has already been decided.');
      if (decision === 'accepted' && this.ctx.tickets.intake.status().occupied >= 20) throw new UserError('The clan already has 20 occupied places. Update recruitment before accepting another application.');
      this.ctx.db.transaction(() => this.saveDecision(id, decision, actorId, reason));
      await this.completeDecision(id);
    });
  }
  private saveDecision(id: number, decision: ApplicationDecision, actorId: string, reason: string): void {
    const counts = this.counts(id);
    if (decision === 'accepted' && this.ctx.tickets.intake.status().occupied >= 20) {
      this.ctx.db.run("UPDATE ticket_reviews SET state='review',reason=?,yes_count=?,no_count=?,dirty=1 WHERE ticket_id=?", 'The clan is full. This vote is waiting for a free place and a decision.', counts.yes, counts.no, id);
      return;
    }
    this.ctx.tickets.intake.settle(id, decision === 'accepted');
    this.ctx.db.run(`UPDATE ticket_reviews SET state='deciding',decision=?,decided_by=?,decided_at=?,reason=?,yes_count=?,no_count=?,dirty=1,retry_at=0 WHERE ticket_id=?`,
      decision, actorId, Date.now(), clip(reason, 1000), counts.yes, counts.no, id);
    this.ctx.tickets.intakeChanged();
  }
  cancel(id: number): void {
    this.ctx.db.run("UPDATE ticket_reviews SET state='cancelled',dirty=1,dm_status='not_required' WHERE ticket_id=? AND decision IS NULL AND state IN ('waiting','voting','counting','review')", id);
  }
  private async evaluate(id: number): Promise<void> {
    if (this.ctx.tickets.get(id).state !== 'open') { this.cancel(id); return; }
    this.ctx.db.run("UPDATE ticket_reviews SET state='counting',dirty=1 WHERE ticket_id=?", id);
    const counts = this.counts(id); const decision = majorityDecision(counts.yes, counts.no);
    if (this.get(id)?.state !== 'counting' || this.ctx.tickets.get(id).state !== 'open') { this.cancel(id); return; }
    if (!decision) this.ctx.db.run("UPDATE ticket_reviews SET state='review',yes_count=?,no_count=?,dirty=1 WHERE ticket_id=?", counts.yes, counts.no, id);
    else {
      this.ctx.db.transaction(() => this.saveDecision(id, decision, this.ctx.client.user!.id, `Community vote: ${counts.yes} Yes / ${counts.no} No.`));
      if (this.get(id)?.decision) await this.completeDecision(id);
    }
  }
  private async completeDecision(id: number): Promise<void> {
    const review = this.get(id)!; let ticket = this.ctx.tickets.get(id);
    if (ticket.state === 'open') {
      await this.ctx.tickets.close(id, review.decided_by!, `${review.decision === 'accepted' ? 'Accepted' : 'Rejected'} — ${review.reason}`, true);
      ticket = this.ctx.tickets.get(id);
    }
    if (ticket.state === 'creating' || ticket.state === 'closing' || ticket.state === 'reopening') return;
    // A deleted channel also preserves the durable decision and still permits its DM.
    if (!['closed', 'deleted'].includes(ticket.state)) throw new Error('Application closure is not complete.');
    this.ctx.db.run('UPDATE ticket_reviews SET state=?,dirty=1 WHERE ticket_id=?', review.decision!, id);
    await this.deliverDm(id);
  }
  private async deliverDm(id: number): Promise<void> {
    const review = this.get(id)!;
    if (review.dm_status !== 'pending' || !review.decision || !['accepted', 'rejected'].includes(review.state)) return;
    const ticket = this.ctx.tickets.get(id);
    const approved = review.decision === 'accepted';
    const embed = goatEmbed(approved ? 'Application Accepted' : 'Application Rejected', approved ? colors.green : colors.red)
      .setDescription(approved ? 'Your GOAT clan application has been accepted. Welcome to GOAT!' : 'Your GOAT clan application has been rejected.')
      .addFields({ name: 'Roblox', value: `\`@${ticket.roblox_username ?? 'Not supplied'}\`` },
        { name: 'Reason', value: safeText(review.reason ?? 'Application reviewed.', 1000) },
        { name: 'Decided By', value: review.decided_by === this.ctx.client.user!.id ? 'Community vote' : `<@${review.decided_by}>` })
      .setFooter({ text: `Application #${String(id).padStart(4, '0')}` });
    try {
      const user = await this.ctx.client.users.fetch(ticket.owner_id);
      await user.send({ embeds: [embed], allowedMentions: noMentions, nonce: `goat-decision-${id}`, enforceNonce: true });
      this.ctx.db.run("UPDATE ticket_reviews SET dm_status='sent',error=NULL WHERE ticket_id=?", id);
    } catch (err) {
      const code = errorCode(err);
      if ([50007, 50013, 10013].includes(Number(code))) this.ctx.db.run("UPDATE ticket_reviews SET dm_status='unavailable',error=? WHERE ticket_id=?", errorText(err), id);
      else { this.ctx.db.run('UPDATE ticket_reviews SET dm_attempts=dm_attempts+1 WHERE ticket_id=?', id); throw err; }
    }
  }
  async tick(now = Date.now()): Promise<void> {
    if (this.busy || this.ctx.stopping) return;
    this.busy = true;
    try {
      const rows = this.ctx.db.all<TicketReview>(`SELECT r.* FROM ticket_reviews r JOIN tickets t ON t.id=r.ticket_id
        WHERE t.guild_id=? AND r.retry_at<=? AND (r.state IN ('voting','counting','deciding') OR r.dirty=1 OR (r.decision IS NOT NULL AND r.dm_status='pending')) ORDER BY r.ticket_id LIMIT 30`, this.ctx.guild.id, now);
      await Promise.allSettled(rows.map(async row => {
        if (this.ctx.stopping) return;
        let updatePanel = false;
        await this.mutex.run(`review:${row.ticket_id}`, async () => {
          try {
            let review = this.get(row.ticket_id)!;
            if ((review.state === 'voting' && now >= review.ends_at) || review.state === 'counting') await this.evaluate(row.ticket_id);
            else if (review.state === 'deciding') await this.completeDecision(row.ticket_id);
            review = this.get(row.ticket_id)!;
            // DM and closure progress never depend on the public vote channel being accessible.
            await this.deliverDm(row.ticket_id);
            updatePanel = !review.message_id || !!(review.dirty && now - review.last_update >= 1000);
            this.ctx.db.run('UPDATE ticket_reviews SET retry_at=0,error=CASE WHEN dm_status=\'unavailable\' THEN error ELSE NULL END WHERE ticket_id=?', row.ticket_id);
          } catch (err) {
            this.ctx.db.run('UPDATE ticket_reviews SET retry_at=?,error=? WHERE ticket_id=?', now + 30000, errorText(err), row.ticket_id);
            this.ctx.logger.warn({ ticketId: row.ticket_id, error: errorText(err) }, 'GOAT application review will retry');
          }
        });
        // Rendering a rate-limited panel must not lock out incoming votes.
        if (updatePanel) await this.panelMutex.run(`panel:${row.ticket_id}`, async () => {
          try { await this.syncPanel(row.ticket_id); }
          catch (err) {
            this.ctx.db.run('UPDATE ticket_reviews SET retry_at=?,error=? WHERE ticket_id=?', now + 30000, errorText(err), row.ticket_id);
            this.ctx.logger.warn({ ticketId: row.ticket_id, error: errorText(err) }, 'GOAT vote panel will retry');
          }
        });
      }));
    } catch (err) { this.ctx.logger.error({ error: errorText(err) }, 'GOAT application vote worker failed'); }
    finally { this.busy = false; }
  }
}
