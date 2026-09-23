import {
  type Client,
  EmbedBuilder,
  type TextChannel,
  AttachmentBuilder
} from 'discord.js';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { config } from '../config.js';
import { logger } from '../logger.js';
import {
  clanRepo,
  playerRepo,
  settingsRepo,
  whitelistRepo
} from '../database/repositories.js';
import { WhitelistService } from '../services/WhitelistService.js';
import { HistoryService } from '../services/HistoryService.js';
import { compact } from '../canvas/primitives.js';
import type { ClanRecord } from '../types.js';

const TARGET_LOGS_CHANNEL_ID = '1549346632515063810';

interface ClanMemberState {
  diamonds: number;
  battlePoints: number;
}

interface ClanTrackState {
  place: number;
  battleId: string;
  totalDiamonds: number;
  totalPoints: number;
  members: Map<number, ClanMemberState>;
}

export class TrackerScheduler {
  private timer: NodeJS.Timeout | null = null;
  private lastRun = new Map<string, number>();
  private running = false;
  private lastSeenState = new Map<string, ClanTrackState>();

  constructor(
    private whitelist: WhitelistService,
    private history: HistoryService,
    private client?: Client
  ) {}

  public setClient(client: Client): void {
    this.client = client;
    logger.info({ channelId: TARGET_LOGS_CHANNEL_ID }, '[TRACKER] Discord client attached. Clan logs channel ready.');
  }

  async start(): Promise<void> {
    if (this.timer) return;

    if (!settingsRepo.get('logs_channel_id')) {
      settingsRepo.set('logs_channel_id', TARGET_LOGS_CHANNEL_ID);
      logger.info({ channelId: TARGET_LOGS_CHANNEL_ID }, '[TRACKER] Default clan logs channel registered in SQLite.');
    }

    logger.info('[TRACKER] Starting scheduler daemon. Initial snapshot executing immediately.');
    await this.tick(true, 'startup');

    this.timer = setInterval(() => {
      void this.tick(false, 'interval');
    }, config.TRACKER_TICK_SECONDS * 1000);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    logger.info('[TRACKER] Scheduler daemon stopped.');
  }

  status(): { running: boolean; busy: boolean; whitelist: number } {
    return {
      running: Boolean(this.timer),
      busy: this.running,
      whitelist: whitelistRepo.list().length
    };
  }

  // ==========================================
  // HELPERY ASSETÓW I AWATARÓW
  // ==========================================
  private getClanLogoAttachment(): { file: AttachmentBuilder; url: string } | null {
    const logoPath = resolve(process.cwd(), 'assets/branding/r3v0-logo.png');
    if (existsSync(logoPath)) {
      return {
        file: new AttachmentBuilder(logoPath, { name: 'r3v0-logo.png' }),
        url: 'attachment://r3v0-logo.png'
      };
    }
    return null;
  }

  private getUserAvatarUrl(userId: number): string {
    const cached = playerRepo.get(userId);
    if (cached && typeof cached.avatar_url === 'string' && cached.avatar_url.startsWith('http')) {
      return cached.avatar_url;
    }
    return `https://www.roblox.com/headshot-thumbnail/image?userId=${userId}&width=150&height=150&format=png`;
  }

  private async sendLogEmbed(embed: EmbedBuilder, files: AttachmentBuilder[] = []): Promise<void> {
    if (!this.client) {
      logger.warn('[TRACKER_LOGS] Cannot send alert: Client instance not provided.');
      return;
    }

    const channelId = settingsRepo.get('logs_channel_id') || TARGET_LOGS_CHANNEL_ID;

    try {
      const channel = await this.client.channels.fetch(channelId);
      if (channel && channel.isTextBased()) {
        await (channel as TextChannel).send({ embeds: [embed], files });
        logger.info({ channelId }, '[TRACKER_LOGS] Clan alert successfully dispatched.');
      } else {
        logger.warn({ channelId }, '[TRACKER_LOGS] Specified channel is not text-based.');
      }
    } catch (err) {
      logger.error({ error: String(err), channelId }, '[TRACKER_LOGS] Failed to send clan alert to Discord.');
    }
  }

  // ==========================================
  // NOTYFIKACJE CLAN LOGS (NOWOCZESNE EMBEDY)
  // ==========================================

  // 1. Zmiana pozycji w rankingu bitwy
  private async notifyPositionChange(
    clanName: string,
    battleId: string,
    oldPlace: number,
    newPlace: number,
    totalPoints: number
  ): Promise<void> {
    const isPromotion = newPlace < oldPlace;
    logger.info({ clanName, oldPlace, newPlace }, '[TRACKER_LOGS] Clan position change detected.');

    const logo = this.getClanLogoAttachment();
    const files: AttachmentBuilder[] = logo ? [logo.file] : [];

    const embed = new EmbedBuilder()
      .setColor(isPromotion ? 0x10B981 : 0xF43F5E)
      .setAuthor({
        name: `${clanName} • Battle Standing Update`,
        iconURL: logo ? logo.url : undefined
      })
      .setTitle(isPromotion ? '🚀 Position Promoted!' : '🔻 Position Demoted')
      .setDescription(`Clan placement has shifted in **${battleId}**.`)
      .addFields(
        {
          name: '📊 Rank Movement',
          value: `\`#${oldPlace}\` ➔ **\`#${newPlace}\`** ${isPromotion ? '▲ *(Ahead)*' : '▼ *(Behind)*'}`,
          inline: true
        },
        {
          name: '⭐ Current Stars',
          value: `\`${compact(totalPoints)}\` (${totalPoints.toLocaleString('en-US')})`,
          inline: true
        },
        {
          name: '⚔️ Battle Event',
          value: `\`${battleId}\``,
          inline: false
        }
      )
      .setFooter({ text: `R3V0 Live War Telemetry • [${clanName}]` })
      .setTimestamp();

    if (logo) {
      embed.setThumbnail(logo.url);
    }

    await this.sendLogEmbed(embed, files);
  }

  // 2. Wpłata diamentów do banku klanu
  private async notifyDiamondDonation(
    clanName: string,
    username: string,
    userId: number,
    donatedGems: number,
    clanTotalGems: number
  ): Promise<void> {
    logger.info({ clanName, username, donatedGems }, '[TRACKER_LOGS] New diamond contribution detected.');

    const logo = this.getClanLogoAttachment();
    const files: AttachmentBuilder[] = logo ? [logo.file] : [];
    const userAvatar = this.getUserAvatarUrl(userId);

    const embed = new EmbedBuilder()
      .setColor(0x38BDF8)
      .setAuthor({
        name: `${username} contributed diamonds!`,
        iconURL: userAvatar
      })
      .setTitle('💎 Diamond Contribution Received')
      .setDescription(`**${username}** has just deposited diamonds into the clan vault!`)
      .addFields(
        {
          name: '💰 Deposited Amount',
          value: `\`+${donatedGems.toLocaleString('en-US')}\` 💎 *(+${compact(donatedGems)})*`,
          inline: true
        },
        {
          name: '🏦 Total Vault Balance',
          value: `\`${clanTotalGems.toLocaleString('en-US')}\` 💎 *(~${compact(clanTotalGems)})*`,
          inline: true
        },
        {
          name: '👤 Member Info',
          value: `**${username}** (ID: \`${userId}\`)`,
          inline: false
        }
      )
      .setFooter({ text: `R3V0 Vault Ledger • [${clanName}]` })
      .setTimestamp();

    if (logo) {
      embed.setThumbnail(logo.url);
    }

    await this.sendLogEmbed(embed, files);
  }

  // 3. Przyrost gwiazdek bitewnych
  private async notifyStarsGain(
    clanName: string,
    contributions: Array<{ username: string; userId: number; gain: number; total: number }>,
    clanTotalPoints: number,
    battleId: string
  ): Promise<void> {
    logger.info({ clanName, count: contributions.length }, '[TRACKER_LOGS] Star point surge detected.');

    const logo = this.getClanLogoAttachment();
    const files: AttachmentBuilder[] = logo ? [logo.file] : [];
    const topContributor = contributions[0];
    const topAvatar = topContributor ? this.getUserAvatarUrl(topContributor.userId) : (logo ? logo.url : undefined);

    const list = contributions.map(c =>
      `• **${c.username}**: \`+${compact(c.gain)} ⭐\` ➔ Total: \`${compact(c.total)} ⭐\``
    ).join('\n');

    const totalSurge = contributions.reduce((acc, c) => acc + c.gain, 0);

    const embed = new EmbedBuilder()
      .setColor(0xF59E0B)
      .setAuthor({
        name: `${clanName} • Battle Velocity Surge`,
        iconURL: topAvatar
      })
      .setTitle('⭐ Battle Stars Surge Detected')
      .setDescription(`Recent contributions recorded in **${battleId}**:\n\n${list}`)
      .addFields(
        {
          name: '🔥 Batch Surge Gain',
          value: `\`+${compact(totalSurge)} ⭐\` (${totalSurge.toLocaleString('en-US')})`,
          inline: true
        },
        {
          name: '🛡️ Clan War Total',
          value: `\`${compact(clanTotalPoints)} ⭐\` (${clanTotalPoints.toLocaleString('en-US')})`,
          inline: true
        }
      )
      .setFooter({ text: `R3V0 Battle Tracker • [${clanName}]` })
      .setTimestamp();

    if (logo) {
      embed.setThumbnail(logo.url);
    }

    await this.sendLogEmbed(embed, files);
  }

  // ==========================================
  // SILNIK PORÓWNYWANIA ZMIAN (DIFF ENGINE)
  // ==========================================
  public async processClanUpdates(clan: ClanRecord): Promise<void> {
    const clanKey = clan.name.toLowerCase();
    const prevState = this.lastSeenState.get(clanKey);

    const currentPlace = clan.battlePlace ? Number(clan.battlePlace) : 0;
    const currentPoints = Number(clan.battlePoints ?? 0);
    const currentDiamonds = Number(clan.depositedDiamonds ?? 0);
    const currentBattleId = clan.battleId ?? 'UnknownBattle';

    const currentMembersMap = new Map<number, ClanMemberState>();
    for (const m of clan.members) {
      currentMembersMap.set(Number(m.userId), {
        diamonds: Number(m.diamonds ?? 0),
        battlePoints: Number(m.battlePoints ?? 0)
      });
    }

    // Pierwszy przebieg: rejestrujemy stan odniesienia bez spamu
    if (!prevState) {
      this.lastSeenState.set(clanKey, {
        place: currentPlace,
        battleId: currentBattleId,
        totalDiamonds: currentDiamonds,
        totalPoints: currentPoints,
        members: currentMembersMap
      });
      logger.info({ clan: clan.name }, '[TRACKER] Baseline state indexed. Alert monitoring active.');
      return;
    }

    // 1. Detekcja zmiany pozycji w bitwie
    if (prevState.place > 0 && currentPlace > 0 && prevState.place !== currentPlace) {
      await this.notifyPositionChange(clan.name, currentBattleId, prevState.place, currentPlace, currentPoints);
    }

    // 2. Detekcja wpłat diamentów
    for (const member of clan.members) {
      const prev = prevState.members.get(Number(member.userId));
      const curGems = Number(member.diamonds ?? 0);

      if (prev && curGems > prev.diamonds) {
        const diff = curGems - prev.diamonds;
        const cachedUser = playerRepo.get(member.userId);
        const username = cachedUser?.username ? String(cachedUser.username) : `User_${member.userId}`;
        await this.notifyDiamondDonation(clan.name, username, member.userId, diff, currentDiamonds);
      }
    }

    // 3. Detekcja przyrostu gwiazdek w bitwie
    const starGains: Array<{ username: string; userId: number; gain: number; total: number }> = [];
    for (const member of clan.members) {
      const prev = prevState.members.get(Number(member.userId));
      const curPts = Number(member.battlePoints ?? 0);

      if (prev && curPts > prev.battlePoints) {
        const diff = curPts - prev.battlePoints;
        if (diff >= 1000) {
          const cachedUser = playerRepo.get(member.userId);
          const username = cachedUser?.username ? String(cachedUser.username) : `User_${member.userId}`;
          starGains.push({ username, userId: member.userId, gain: diff, total: curPts });
        }
      }
    }

    if (starGains.length > 0) {
      starGains.sort((a, b) => b.gain - a.gain);
      await this.notifyStarsGain(clan.name, starGains, currentPoints, currentBattleId);
    }

    // Aktualizacja bufora pamięci
    this.lastSeenState.set(clanKey, {
      place: currentPlace,
      battleId: currentBattleId,
      totalDiamonds: currentDiamonds,
      totalPoints: currentPoints,
      members: currentMembersMap
    });
  }

  // ==========================================
  // GŁÓWNA PĘTLA POBIERANIA DANYCH
  // ==========================================
  async tick(force = false, reason = 'manual'): Promise<void> {
    if (this.running) {
      logger.warn({ reason }, '[TRACKER] Previous cycle still running. Skipping overlapping tick.');
      return;
    }

    this.running = true;

    try {
      let clans = whitelistRepo.list();

      if (!clans.length && config.MAIN_CLAN) {
        whitelistRepo.add(config.MAIN_CLAN);
        clans = [config.MAIN_CLAN];
      }

      if (!clans.length) return;

      for (const clanName of clans) {
        try {
          const last = this.lastRun.get(clanName) ?? 0;
          const now = Date.now();
          const stored = clanRepo.get(clanName);
          const intervalMs = (stored?.battle_id ? config.TRACKER_ACTIVE_SECONDS : config.TRACKER_IDLE_SECONDS) * 1000;

          if (!force && now - last < intervalMs) continue;

          let clan: ClanRecord;
          try {
            clan = await this.whitelist.refresh(clanName, false);
          } catch (error) {
            logger.error({ clan: clanName, error: String(error) }, '[TRACKER] BIG Games API fetch failed.');
            continue;
          }

          await this.processClanUpdates(clan);
          this.history.captureClan(clan);
          this.lastRun.set(clanName, Date.now());
        } catch (error) {
          logger.error({ clan: clanName, error: String(error) }, '[TRACKER] Error processing clan.');
        }
      }
    } finally {
      this.running = false;
    }
  }
}
