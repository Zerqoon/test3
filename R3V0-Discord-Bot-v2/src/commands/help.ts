import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { goatEmbed, noMentions } from '../core/embeds.js';

const pages = {
  activity: { title: 'Activity', description: '**/messages** `[user]`\nToday, this week, this month and all indexed history.\n\n**/leaderboard** `[period] [page]`\nCompare message totals. `/leadboard` works too.\n\nHistory is imported in the background. Previously deleted messages can only be counted if the bot observed them.' },
  tickets: { title: 'Tickets', description: 'Use **Clan Application** or **Support** on the ticket panel. Enter your Roblox **@username** before opening. The clan has **20 places**. Each active application reserves one. **Recruitment Status** shows availability privately.\n\nApplications need **Mastery, Gamepasses, Inventory and Stats** screenshots, plus an answer to **Can you be AFK 24/7?**\n\n**Start Vote** opens a 3-minute vote. The first side to 3 wins; otherwise the majority wins at the deadline. A tie waits for a decision.\n\n**Recruitment commands**\n`/clan-off` — pause new applications; Support stays available.\n`/open-ticket count:5` — offer 5 free places; the button shows 15/20.\n`/clan-status` — inspect places and reservations.\n\n**Ticket commands**\n`/ticket panel` · `/ticket list` · `/ticket add` · `/ticket remove`\n`/ticket close` · `/ticket start-vote` · `/ticket approve` · `/ticket reject` · `/ticket repair`' },
  giveaways: { title: 'Giveaways', description: 'Press **Enter Giveaway** to join. You need its selected role and any listed message requirement. Your private confirmation includes **Leave Giveaway**.\n\n**Creation**\n`/giveway-create` or `/giveaway-create`\nThe form has duration, prize, title, description and a role picker.\n\n**Management**\n`/giveaway-list` · `/giveaway-end` · `/giveaway-reroll` · `/giveaway-cancel`\n\nDuration examples: `10s`, `1m`, `1 minute`, `1h 30m`.' },
  tools: { title: 'Tools', description: '**Pet Universe Values**\n`/value name` — current value, artwork, rarity and optional Golden / Diamond. Use category for Charms, Eggs or Items.\n\n**Messages**\n`/embed` — title, message, outside text, image, color and optional selected ping.\n`/message-logs status` · `/message-logs test` · `/message-logs retry`\n`/link-filter status` · `/link-filter allow-role` · `/link-filter remove-role`\n\n**Moderation**\n`/ban` · `/unban` · `/mute` · `/unmute` · `/warn` · `/warnings` · `/case`\n\n**Maintenance**\n`/history-sync` · `/username-retry` · `/username-remove`\n`/nickname-sync` · `/autorole-sync` · `/welcome-preview` · `/goat-status`' }
};
export function helpPanel(category?: string) {
  const page = category && category in pages ? pages[category as keyof typeof pages] : undefined;
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    ...Object.entries(pages).map(([id, item]) => new ButtonBuilder().setCustomId(`goat:help:page:${id}`)
      .setLabel(item.title).setStyle(category === id ? ButtonStyle.Primary : ButtonStyle.Secondary)));
  return { embeds: [goatEmbed(page ? page.title : 'Commands').setDescription(page?.description ??
    'Choose a category below to find commands and instructions.\n\n**Activity** · message totals and rankings\n**Tickets** · applications and private support\n**Giveaways** · entry and creation\n**Tools** · embeds, moderation and diagnostics').setTimestamp(null)],
  components: [row], allowedMentions: noMentions };
}
