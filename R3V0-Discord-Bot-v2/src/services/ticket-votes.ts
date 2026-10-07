import { ActionRowBuilder, ButtonBuilder, ButtonStyle, LabelBuilder, MessageFlags, ModalBuilder, TextInputBuilder,
  TextInputStyle, type ButtonInteraction, type GuildTextBasedChannel, type ModalSubmitInteraction } from 'discord.js';
import type { Context } from '../core/types.js';
import { requireStaff } from '../core/access.js';
import { colors, goatEmbed, noMentions } from '../core/embeds.js';
import { clip, errorCode, errorText, Mutex, safeText, stamp, UserError } from '../core/util.js';
import type { TicketRow } from './tickets.js';

export type ApplicationDecision = 'accepted' | 'rejected';
export interface TicketReview {
  ticket_id: number; channel_id: string; message_id: string | null; state: string; ends_at: number;
  minimum_votes: number; voter_roles: string; decision: ApplicationDecision | null; decided_by: string | null;
  decided_at: number | null; reason: string | null; yes_count: number; no_count: number; dirty: number;
  last_update: number; dm_status: string; dm_attempts: number; retry_at: number; error: string | null;
}
export function majorityDecision(yes: number, no: number, minimum: number): ApplicationDecision | null {
  if (yes + no < minimum || yes === no) return null;
  return yes > no ? 'accepted' : 'rejected';
}
export function votePanel(ticket: TicketRow, review: TicketReview) {
  const voting = review.state === 'voting' && Date.now() < review.ends_at;
  const status = review.decision === 'accepted' ? 'Accepted' : review.decision === 'rejected' ? 'Rejected' :
    review.state === 'cancelled' ? 'Cancelled' : voting ? 'Voting open' : 'Awaiting review';
  const color = review.decision === 'accepted' ? colors.green : review.decision === 'rejected' ? colors.red : colors.cyan;
  const embed = goatEmbed('Clan Application', color).setTitle(`GOAT • ${safeText(ticket.owner_name ?? 'Clan Applicant', 100)}`)
    .setDescription(`**Roblox:** \`@${ticket.roblox_username ?? 'Not supplied'}\`\n**${status}**`)
    .addFields({ name: 'Yes', value: String(review.yes_count), inline: true }, { name: 'No', value: String(review.no_count), inline: true });
  if (voting) embed.addFields({ name: 'Closes', value: `${stamp(review.ends_at, 'R')} • ${review.minimum_votes} votes required` });
  else if (review.state === 'review') embed.addFields({ name: 'Result', value: review.yes_count + review.no_count < review.minimum_votes ? 'Not enough votes — a decision is pending.' : 'Tie — a decision is pending.' });
  if (review.decision && review.reason) embed.addFields({ name: 'Reason', value: safeText(review.reason, 900) });
  embed.setFooter({ text: `GOAT • Application #${String(ticket.id).padStart(4, '0')}` });
  return { embeds: [embed], components: [new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`goat:ticket:vote-yes:${ticket.id}`).setLabel('Vote Yes').setStyle(ButtonStyle.Success).setDisabled(!voting),
    new ButtonBuilder().setCustomId(`goat:ticket:vote-no:${ticket.id}`).setLabel('Vote No').setStyle(ButtonStyle.Danger).setDisabled(!voting))], allowedMentions: noMentions };
}
export class TicketVoteService {
  private readonly mutex = new Mutex();
  constructor(private readonly ctx: Context) {}
  get(id: number): TicketReview | undefined { return this.ctx.db.get<TicketReview>('SELECT * FROM ticket_reviews WHERE ticket_id=?', id); }
  private counts(id: number): { yes: number; no: number } {
    const rows = this.ctx.db.all<{ choice: string; n: number }>('SELECT choice,COUNT(*) n FROM ticket_votes WHERE ticket_id=? GROUP BY choice', id);
    return { yes: rows.find(r => r.choice === 'yes')?.n ?? 0, no: rows.find(r => r.choice === 'no')?.n ?? 0 };
  }
  queue(ticket: TicketRow): void {
    const config = this.ctx.config.tickets.voting;
    if (!config.enabled || ticket.kind !== 'application' || !ticket.roblox_username || ticket.state !== 'open') return;
    this.ctx.db.run(`INSERT OR IGNORE INTO ticket_reviews(ticket_id,channel_id,ends_at,minimum_votes,voter_roles) VALUES(?,?,?,?,?)`,
      ticket.id, config.channelId, Date.now() + config.durationSeconds * 1000, config.minimumVotes, JSON.stringify(config.voterRoleIds));
  }
  async ensure(ticket: TicketRow): Promise<void> {
    this.queue(ticket);
    if (this.get(ticket.id)) await this.mutex.run(`review:${ticket.id}`, () => this.syncPanel(ticket.id));
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
    this.ctx.db.run('UPDATE ticket_reviews SET message_id=?,dirty=0,last_update=?,error=NULL WHERE ticket_id=?', message.id, Date.now(), id);
  }
  async vote(interaction: ButtonInteraction, id: number, choice: 'yes' | 'no'): Promise<void> {
    const original = this.get(id);
    if (!original || original.channel_id !== interaction.channelId || original.message_id !== interaction.message.id) throw new UserError('Use the current GOAT voting panel.');
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    await this.mutex.run(`review:${id}`, async () => {
      const review = this.get(id)!; const ticket = this.ctx.tickets.get(id);
      if (review.state !== 'voting' || Date.now() >= review.ends_at || ticket.state !== 'open') throw new UserError('Voting on this application has ended.');
      if (ticket.owner_id === interaction.user.id) throw new UserError('You cannot vote on your own application.');
      const member = await this.ctx.guild.members.fetch({ user: interaction.user.id, force: true });
      if (member.user.bot) throw new UserError('Bots cannot vote.');
      const roles = JSON.parse(review.voter_roles) as string[];
      if (roles.length && !roles.some(role => member.roles.cache.has(role))) throw new UserError('You do not meet the voting requirement.');
      if (Date.now() >= review.ends_at) throw new UserError('Voting on this application has ended.');
      if (this.get(id)?.state !== 'voting' || this.ctx.tickets.get(id).state !== 'open') throw new UserError('This application has closed.');
      const previous = this.ctx.db.get<{ choice: string }>('SELECT choice FROM ticket_votes WHERE ticket_id=? AND user_id=?', id, member.id);
      if (previous?.choice !== choice) this.ctx.db.transaction(() => {
        this.ctx.db.run(`INSERT INTO ticket_votes VALUES(?,?,?,?) ON CONFLICT(ticket_id,user_id) DO UPDATE SET choice=excluded.choice,voted_at=excluded.voted_at`, id, member.id, choice, Date.now());
        const counts = this.counts(id);
        this.ctx.db.run('UPDATE ticket_reviews SET yes_count=?,no_count=?,dirty=1 WHERE ticket_id=?', counts.yes, counts.no, id);
      });
      await interaction.editReply({ content: `Your vote: **${choice === 'yes' ? 'Yes' : 'No'}**. You can change it before voting closes.`, allowedMentions: noMentions });
    });
  }
  async decisionModal(interaction: ButtonInteraction, id: number, decision: ApplicationDecision): Promise<void> {
    await requireStaff(interaction, this.ctx.config);
    const ticket = this.ctx.tickets.get(id);
    if (interaction.channelId !== ticket.channel_id || ticket.kind !== 'application' || ticket.state !== 'open') throw new UserError('Use the controls inside an open application ticket.');
    await interaction.showModal(new ModalBuilder().setCustomId(`goat:ticket:${decision === 'accepted' ? 'approve-modal' : 'reject-modal'}:${id}`)
      .setTitle(`GOAT • ${decision === 'accepted' ? 'Approve' : 'Reject'} Application`).addLabelComponents(new LabelBuilder().setLabel('Reason')
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
        id, this.ctx.config.tickets.voting.channelId, Date.now(), this.ctx.config.tickets.voting.minimumVotes, '[]');
      const review = this.get(id)!;
      if (review.decision) throw new UserError('This application has already been decided.');
      this.saveDecision(id, decision, actorId, reason);
      await this.completeDecision(id);
    });
  }
  private saveDecision(id: number, decision: ApplicationDecision, actorId: string, reason: string): void {
    const counts = this.counts(id);
    this.ctx.db.run(`UPDATE ticket_reviews SET state='deciding',decision=?,decided_by=?,decided_at=?,reason=?,yes_count=?,no_count=?,dirty=1,retry_at=0 WHERE ticket_id=?`,
      decision, actorId, Date.now(), clip(reason, 1000), counts.yes, counts.no, id);
  }
  cancel(id: number): void {
    this.ctx.db.run("UPDATE ticket_reviews SET state='cancelled',dirty=1,dm_status='not_required' WHERE ticket_id=? AND decision IS NULL AND state IN ('voting','counting','review')", id);
  }
  private async evaluate(id: number): Promise<void> {
    let review = this.get(id)!;
    if (this.ctx.tickets.get(id).state !== 'open') { this.cancel(id); return; }
    this.ctx.db.run("UPDATE ticket_reviews SET state='counting',dirty=1 WHERE ticket_id=?", id);
    const roles = JSON.parse(review.voter_roles) as string[];
    for (const row of this.ctx.db.all<{ user_id: string }>('SELECT user_id FROM ticket_votes WHERE ticket_id=?', id)) {
      let member;
      try { member = await this.ctx.guild.members.fetch({ user: row.user_id, force: true }); }
      catch (err) { if (errorCode(err) !== 10007) throw err; }
      if (!member || member.user.bot || (roles.length && !roles.some(role => member.roles.cache.has(role)))) this.ctx.db.run('DELETE FROM ticket_votes WHERE ticket_id=? AND user_id=?', id, row.user_id);
    }
    const counts = this.counts(id); const decision = majorityDecision(counts.yes, counts.no, review.minimum_votes);
    if (this.get(id)?.state !== 'counting' || this.ctx.tickets.get(id).state !== 'open') { this.cancel(id); return; }
    if (!decision) this.ctx.db.run("UPDATE ticket_reviews SET state='review',yes_count=?,no_count=?,dirty=1 WHERE ticket_id=?", counts.yes, counts.no, id);
    else {
      this.saveDecision(id, decision, this.ctx.client.user!.id, `Community vote: ${counts.yes} Yes / ${counts.no} No.`);
      await this.completeDecision(id);
    }
    review = this.get(id)!;
    if (review.state === 'review') await this.syncPanel(id);
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
        { name: 'Decided By', value: review.decided_by === this.ctx.client.user!.id ? 'GOAT • Community vote' : `<@${review.decided_by}>` })
      .setFooter({ text: `GOAT • Application #${String(id).padStart(4, '0')}` });
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
    const rows = this.ctx.db.all<TicketReview>(`SELECT r.* FROM ticket_reviews r JOIN tickets t ON t.id=r.ticket_id
      WHERE t.guild_id=? AND r.retry_at<=? AND (r.state IN ('voting','counting','deciding') OR r.dirty=1 OR (r.decision IS NOT NULL AND r.dm_status='pending')) ORDER BY r.ticket_id LIMIT 30`, this.ctx.guild.id, now);
    for (const row of rows) {
      if (this.ctx.stopping) return;
      await this.mutex.run(`review:${row.ticket_id}`, async () => {
        try {
          let review = this.get(row.ticket_id)!;
          if ((review.state === 'voting' && now >= review.ends_at) || review.state === 'counting') await this.evaluate(row.ticket_id);
          else if (review.state === 'deciding') await this.completeDecision(row.ticket_id);
          review = this.get(row.ticket_id)!;
          // DM and closure progress never depend on the public vote channel being accessible.
          await this.deliverDm(row.ticket_id);
          if (!review.message_id || (review.dirty && now - review.last_update >= 3000)) await this.syncPanel(row.ticket_id);
          this.ctx.db.run('UPDATE ticket_reviews SET retry_at=0,error=CASE WHEN dm_status=\'unavailable\' THEN error ELSE NULL END WHERE ticket_id=?', row.ticket_id);
        } catch (err) {
          this.ctx.db.run('UPDATE ticket_reviews SET retry_at=?,error=? WHERE ticket_id=?', now + 30000, errorText(err), row.ticket_id);
          this.ctx.logger.warn({ ticketId: row.ticket_id, error: errorText(err) }, 'GOAT application review will retry');
        }
      });
    }
  }
}
