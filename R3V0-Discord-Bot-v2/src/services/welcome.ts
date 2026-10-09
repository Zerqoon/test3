import { createCanvas, loadImage, GlobalFonts } from '@napi-rs/canvas';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { AttachmentBuilder, type GuildMember } from 'discord.js';
import type { Context } from '../core/types.js';
import { goatEmbed, noMentions } from '../core/embeds.js';
import { errorText } from '../core/util.js';

const font = resolve('assets/fonts/DejaVuSans-Bold.ttf');
if (existsSync(font)) GlobalFonts.registerFromPath(font, 'GOAT Sans');
const emojiFont = resolve('assets/fonts/NotoEmoji-Regular.ttf');
if (existsSync(emojiFont)) GlobalFonts.registerFromPath(emojiFont, 'GOAT Emoji');
let background: Awaited<ReturnType<typeof loadImage>> | undefined;
export const WELCOME_WIDTH = 1920;
export const WELCOME_HEIGHT = 1080;
const nameSegments = new Intl.Segmenter('en', { granularity: 'grapheme' });

export async function renderWelcome(name: string, memberCount: number, avatar?: Buffer): Promise<Buffer> {
  background ??= await loadImage(resolve('assets/goat-banner.png'));
  const canvas = createCanvas(WELCOME_WIDTH, WELCOME_HEIGHT);
  const c = canvas.getContext('2d');
  // Draw at a logical size, then export sharp text and rings at Full HD.
  c.scale(WELCOME_WIDTH / 1200, WELCOME_HEIGHT / 675);
  c.imageSmoothingEnabled = true;
  c.imageSmoothingQuality = 'high';
  c.drawImage(background, 0, 0, 1200, 675);
  const shade = c.createLinearGradient(0, 0, 1200, 0);
  shade.addColorStop(0, 'rgba(3,15,23,0.57)');
  shade.addColorStop(0.43, 'rgba(3,13,22,0.90)');
  shade.addColorStop(1, 'rgba(3,9,17,0.96)');
  c.fillStyle = shade; c.fillRect(0, 0, 1200, 675);
  const vignette = c.createLinearGradient(0, 0, 0, 675);
  vignette.addColorStop(0, 'rgba(3,9,17,0.32)');
  vignette.addColorStop(0.55, 'rgba(3,9,17,0)');
  vignette.addColorStop(1, 'rgba(3,9,17,0.50)');
  c.fillStyle = vignette; c.fillRect(0, 0, 1200, 675);

  const rim = c.createLinearGradient(44, 46, 1156, 629);
  rim.addColorStop(0, 'rgba(73,230,255,0.65)');
  rim.addColorStop(0.52, 'rgba(73,230,255,0.12)');
  rim.addColorStop(1, 'rgba(92,229,173,0.40)');
  const panel = c.createLinearGradient(44, 46, 1156, 629);
  panel.addColorStop(0, 'rgba(5,19,28,0.18)');
  panel.addColorStop(1, 'rgba(5,13,22,0.75)');
  c.beginPath(); c.roundRect(44, 46, 1112, 583, 30);
  c.fillStyle = panel; c.fill(); c.lineWidth = 1.5; c.strokeStyle = rim; c.stroke();

  // A quiet grid behind the text, leaving the original GOAT artwork visible.
  c.save(); c.beginPath(); c.roundRect(44, 46, 1112, 583, 30); c.clip();
  c.strokeStyle = 'rgba(73,230,255,0.025)'; c.lineWidth = 0.6;
  c.beginPath();
  for (let x = 460; x <= 1160; x += 40) { c.moveTo(x, 132); c.lineTo(x, 555); }
  for (let y = 155; y <= 555; y += 40) { c.moveTo(460, y); c.lineTo(1156, y); }
  c.stroke(); c.restore();

  const divider = c.createLinearGradient(80, 0, 1120, 0);
  divider.addColorStop(0, 'rgba(73,230,255,0.40)');
  divider.addColorStop(1, 'rgba(92,229,173,0.07)');
  c.strokeStyle = divider; c.lineWidth = 1;
  for (const y of [132, 555]) { c.beginPath(); c.moveTo(80, y); c.lineTo(1120, y); c.stroke(); }
  c.textBaseline = 'middle'; c.textAlign = 'left';
  c.font = 'bold 29px "GOAT Sans"'; c.fillStyle = '#ffffff'; c.fillText('GOAT', 82, 96);
  c.fillStyle = 'rgba(73,230,255,0.45)'; c.fillRect(187, 82, 1, 27);
  c.font = 'bold 13px "GOAT Sans"'; c.fillStyle = '#a7d8e0'; c.fillText('CLAN COMMUNITY', 206, 97);
  c.lineCap = 'round'; c.lineWidth = 3;
  for (let i = 0; i < 3; i++) {
    c.strokeStyle = i === 2 ? '#5ce5ad' : i === 1 ? '#49e6ff' : 'rgba(73,230,255,0.32)';
    c.beginPath(); c.moveTo(1068 + i * 18, 108); c.lineTo(1080 + i * 18, 84); c.stroke();
  }

  // The portrait stays circular and uses a centered square crop, never a stretch.
  const cx = 250, cy = 322, radius = 110;
  const aura = c.createRadialGradient(cx, cy, 75, cx, cy, 186);
  aura.addColorStop(0, 'rgba(73,230,255,0.24)');
  aura.addColorStop(0.7, 'rgba(73,230,255,0.07)'); aura.addColorStop(1, 'rgba(73,230,255,0)');
  c.fillStyle = aura; c.fillRect(cx - 186, cy - 186, 372, 372);
  c.beginPath(); c.arc(cx, cy, 143, 0, Math.PI * 2);
  c.lineWidth = 1; c.strokeStyle = 'rgba(73,230,255,0.17)'; c.stroke();
  c.beginPath(); c.arc(cx, cy, 126, 0, Math.PI * 2); c.fillStyle = '#071520'; c.fill();
  const avatarRim = c.createLinearGradient(cx - 125, cy - 125, cx + 125, cy + 125);
  avatarRim.addColorStop(0, '#49e6ff'); avatarRim.addColorStop(1, '#5ce5ad');
  c.save(); c.shadowColor = 'rgba(73,230,255,0.40)'; c.shadowBlur = 20;
  c.beginPath(); c.arc(cx, cy, 120, 0, Math.PI * 2);
  c.lineWidth = 4; c.strokeStyle = avatarRim; c.stroke(); c.restore();
  let portrait: Awaited<ReturnType<typeof loadImage>> | undefined;
  if (avatar) { try { portrait = await loadImage(avatar); } catch { /* Render the branded fallback. */ } }
  c.save(); c.beginPath(); c.arc(cx, cy, radius, 0, Math.PI * 2); c.clip();
  if (portrait) {
    const side = Math.min(portrait.width, portrait.height);
    c.drawImage(portrait, (portrait.width - side) / 2, (portrait.height - side) / 2, side, side,
      cx - radius, cy - radius, radius * 2, radius * 2);
  } else {
    const fallback = c.createLinearGradient(cx - radius, cy - radius, cx + radius, cy + radius);
    fallback.addColorStop(0, '#124657'); fallback.addColorStop(1, '#146c64');
    c.fillStyle = fallback; c.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);
    c.textAlign = 'center'; c.font = 'bold 98px "GOAT Sans"';
    c.fillStyle = '#e8fbff'; c.fillText('G', cx, cy + 3);
  }
  c.restore();

  c.beginPath(); c.roundRect(169, 474, 162, 35, 17.5);
  c.fillStyle = '#102c35'; c.fill(); c.strokeStyle = 'rgba(73,230,255,0.32)'; c.lineWidth = 1; c.stroke();
  c.textAlign = 'center'; c.font = 'bold 12px "GOAT Sans"'; c.fillStyle = '#a9f4ff';
  c.fillText('NEW MEMBER', cx, 492);

  c.textAlign = 'left'; c.fillStyle = '#70e9e6'; c.font = 'bold 15px "GOAT Sans"';
  c.fillText('WELCOME TO THE CLAN', 474, 182);
  c.font = 'bold 72px "GOAT Sans"'; c.fillStyle = '#ffffff'; c.fillText('WELCOME', 469, 247);
  const cleanName = name.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim() || 'New Member';
  const letters = Array.from(nameSegments.segment(cleanName), part => part.segment).slice(0, 80);
  let label = letters.join(''), size = 46;
  do { c.font = `bold ${size}px "GOAT Sans", "GOAT Emoji"`; if (c.measureText(label).width <= 638) break; size--; } while (size >= 28);
  while (c.measureText(label).width > 638 && letters.length > 1) { letters.pop(); label = letters.join('') + '…'; }
  c.fillStyle = '#e7fafc'; c.fillText(label, 474, 323);
  c.font = 'bold 18px "GOAT Sans"'; c.fillStyle = '#abc1ce'; c.fillText('Make yourself at home.', 476, 369);

  c.beginPath(); c.roundRect(474, 423, 312, 78, 18);
  c.fillStyle = 'rgba(73,230,255,0.055)'; c.fill();
  c.strokeStyle = 'rgba(73,230,255,0.21)'; c.lineWidth = 1; c.stroke();
  c.strokeStyle = '#5ce5ad'; c.lineWidth = 2; c.lineCap = 'round';
  c.beginPath(); c.arc(514, 451, 6, 0, Math.PI * 2); c.stroke();
  c.beginPath(); c.arc(526, 454, 4.5, -Math.PI / 2, Math.PI / 2); c.stroke();
  c.beginPath(); c.moveTo(504, 475); c.lineTo(504, 472); c.quadraticCurveTo(504, 462, 514, 462);
  c.quadraticCurveTo(524, 462, 524, 472); c.lineTo(524, 475); c.stroke();
  c.beginPath(); c.moveTo(529, 465); c.quadraticCurveTo(536, 467, 536, 474); c.stroke();
  const count = Number.isSafeInteger(memberCount) && memberCount >= 0 ? memberCount.toLocaleString('en-US') : '—';
  let countSize = 28;
  do { c.font = `bold ${countSize}px "GOAT Sans"`; if (c.measureText(count).width <= 202) break; countSize--; } while (countSize > 16);
  c.fillStyle = '#ecfcff'; c.fillText(count, 557, 450);
  c.font = 'bold 11px "GOAT Sans"'; c.fillStyle = '#79c9d5'; c.fillText('COMMUNITY MEMBERS', 558, 478);

  c.font = 'bold 13px "GOAT Sans"'; c.fillStyle = '#839ead';
  c.fillText('ONE CLAN. ONE COMMUNITY.', 82, 591);
  c.textAlign = 'right'; c.fillStyle = '#85cbb7'; c.fillText('GLAD YOU\'RE HERE.', 1118, 591);
  return canvas.encode('png');
}
export async function sendWelcome(ctx: Context, member: GuildMember): Promise<void> {
  const channel = await ctx.guild.channels.fetch(ctx.config.channels.welcome);
  if (!channel?.isTextBased() || !('send' in channel)) throw new Error('Welcome channel is not sendable.');
  let avatar: Buffer | undefined;
  try {
    const response = await fetch(member.displayAvatarURL({ extension: 'png', size: 512 }), { signal: AbortSignal.timeout(10_000) });
    if (response.ok) avatar = Buffer.from(await response.arrayBuffer());
  } catch (err) { ctx.logger.debug({ error: errorText(err) }, 'GOAT welcome avatar fallback'); }
  const image = await renderWelcome(member.displayName, ctx.guild.memberCount, avatar);
  await channel.send({ content: `Welcome, <@${member.id}>!`, embeds: [goatEmbed('Welcome')
    .setDescription('Welcome to the GOAT community. We are glad you are here!').setImage('attachment://goat-welcome.png')],
    files: [new AttachmentBuilder(image, { name: 'goat-welcome.png' })], allowedMentions: { ...noMentions, users: [member.id] } });
}
