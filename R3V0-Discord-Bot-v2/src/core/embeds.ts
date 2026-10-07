import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import { clip } from './util.js';

export const colors = { cyan: 0x49e6ff, green: 0x5ce5ad, orange: 0xffb85c, red: 0xff647b, purple: 0x9b8dff, dark: 0x18222f };
export function goatEmbed(title: string, color: number = colors.cyan): EmbedBuilder {
  return new EmbedBuilder().setTitle(clip(`GOAT • ${title}`, 256)).setColor(color)
    .setFooter({ text: 'GOAT • Clan Community' }).setTimestamp();
}
export const noMentions = { parse: [] as ('roles' | 'users' | 'everyone')[], repliedUser: false };
export function logButtons(guildId: string, channelId?: string, _userId?: string, messageId?: string): ActionRowBuilder<ButtonBuilder>[] {
  const row = new ActionRowBuilder<ButtonBuilder>();
  if (channelId) row.addComponents(new ButtonBuilder().setLabel(messageId ? 'Jump to Message' : 'Open Channel')
    .setStyle(ButtonStyle.Link).setURL(`https://discord.com/channels/${guildId}/${channelId}${messageId ? `/${messageId}` : ''}`));
  return row.components.length ? [row] : [];
}
