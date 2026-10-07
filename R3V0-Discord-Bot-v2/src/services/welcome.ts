import { createCanvas, loadImage, GlobalFonts } from '@napi-rs/canvas';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { AttachmentBuilder, type GuildMember } from 'discord.js';
import type { Context } from '../core/types.js';
import { goatEmbed, noMentions } from '../core/embeds.js';
import { clip, errorText } from '../core/util.js';

const font = resolve('assets/fonts/DejaVuSans-Bold.ttf');
if (existsSync(font)) GlobalFonts.registerFromPath(font, 'GOAT Sans');
let background: Awaited<ReturnType<typeof loadImage>> | undefined;
export async function renderWelcome(name: string, memberCount: number, avatar?: Buffer): Promise<Buffer> {
  background ??= await loadImage(resolve('assets/goat-banner.png'));
  const canvas = createCanvas(1200, 675);
  const c = canvas.getContext('2d');
  c.drawImage(background, 0, 0, 1200, 675);
  c.fillStyle = 'rgba(5, 12, 25, 0.80)'; c.fillRect(0, 0, 1200, 675);
  const glow = c.createRadialGradient(600, 270, 20, 600, 270, 660);
  glow.addColorStop(0, 'rgba(41,191,211,0.16)'); glow.addColorStop(1, 'rgba(0,0,0,0.25)');
  c.fillStyle = glow; c.fillRect(0, 0, 1200, 675);
  c.beginPath(); c.roundRect(88, 56, 1024, 560, 28);
  c.fillStyle = 'rgba(9,18,32,0.58)'; c.fill();
  c.strokeStyle = 'rgba(111,228,255,0.22)'; c.lineWidth = 2; c.stroke();
  c.textAlign = 'center'; c.textBaseline = 'middle';
  c.fillStyle = '#a5f4ff'; c.font = 'bold 16px "GOAT Sans"';
  c.fillText('GOAT CLAN COMMUNITY', 600, 105);
  c.fillStyle = '#ffffff'; c.font = 'bold 43px "GOAT Sans"'; c.fillText('WELCOME TO GOAT', 600, 164);
  c.beginPath(); c.arc(600, 297, 81, 0, Math.PI * 2); c.strokeStyle = '#54e5f5'; c.lineWidth = 4; c.stroke();
  c.save(); c.beginPath(); c.arc(600, 297, 74, 0, Math.PI * 2); c.clip();
  if (avatar) {
    try { const image = await loadImage(avatar); c.drawImage(image, 526, 223, 148, 148); }
    catch { avatar = undefined; }
  }
  if (!avatar) {
    const gradient = c.createLinearGradient(526, 223, 674, 371);
    gradient.addColorStop(0, '#1c749b'); gradient.addColorStop(1, '#583bac');
    c.fillStyle = gradient; c.fillRect(526, 223, 148, 148);
    c.font = 'bold 32px "GOAT Sans"'; c.fillStyle = '#ffffff'; c.fillText('GOAT', 600, 297);
  }
  c.restore();
  let size = 40;
  const label = clip(name, 64);
  do { c.font = `bold ${size}px "GOAT Sans"`; if (c.measureText(label).width <= 850) break; size--; } while (size > 20);
  c.fillStyle = '#ffffff'; c.fillText(label, 600, 421);
  c.font = 'bold 18px "GOAT Sans"'; c.fillStyle = '#b5c7d9'; c.fillText('Make yourself at home.', 600, 467);
  c.beginPath(); c.roundRect(445, 509, 310, 47, 23);
  c.fillStyle = 'rgba(73,230,255,0.09)'; c.fill(); c.strokeStyle = 'rgba(73,230,255,0.25)'; c.lineWidth = 1; c.stroke();
  c.fillStyle = '#c5f7ff'; c.font = 'bold 16px "GOAT Sans"'; c.fillText(`${memberCount.toLocaleString('en-US')} MEMBERS`, 600, 533);
  c.font = 'bold 12px "GOAT Sans"'; c.fillStyle = 'rgba(182,209,227,0.50)'; c.fillText('GOAT • ONE CLAN. ONE COMMUNITY.', 600, 587);
  return canvas.encode('png');
}
export async function sendWelcome(ctx: Context, member: GuildMember): Promise<void> {
  const channel = await ctx.guild.channels.fetch(ctx.config.channels.welcome);
  if (!channel?.isTextBased() || !('send' in channel)) throw new Error('Welcome channel is not sendable.');
  let avatar: Buffer | undefined;
  try {
    const response = await fetch(member.displayAvatarURL({ extension: 'png', size: 256 }), { signal: AbortSignal.timeout(10_000) });
    if (response.ok) avatar = Buffer.from(await response.arrayBuffer());
  } catch (err) { ctx.logger.debug({ error: errorText(err) }, 'GOAT welcome avatar fallback'); }
  const image = await renderWelcome(member.displayName, ctx.guild.memberCount, avatar);
  await channel.send({ content: `Welcome, <@${member.id}>!`, embeds: [goatEmbed('Welcome')
    .setDescription('Welcome to the GOAT community. We are glad you are here!').setImage('attachment://goat-welcome.png')],
    files: [new AttachmentBuilder(image, { name: 'goat-welcome.png' })], allowedMentions: { ...noMentions, users: [member.id] } });
}
