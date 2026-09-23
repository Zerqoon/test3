import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  EmbedBuilder,
  PermissionFlagsBits,
  type ChatInputCommandInteraction,
  type InteractionEditReplyOptions
} from 'discord.js';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { AppContext } from './context.js';
import { config } from '../config.js';
import {
  clanRepo,
  playerRepo,
  settingsRepo,
  whitelistRepo
} from '../database/repositories.js';
import {
  renderHistory,
  renderPlayerCard,
  renderRap,
  type TimeframeMode,
  type ClanRivalryInfo,
  getTimeframeConfig,
  extractBucketsForTimeframe,
  fmt
} from '../canvas/renderers.js';
import { render24hChart } from '../canvas/chart.js';
import { compact } from '../canvas/primitives.js';
import { masteryService } from '../services/MasteryService.js';
import type { ClanMember, ClanRecord } from '../types.js';

const defaultClan = () => settingsRepo.get('main_clan') ?? config.MAIN_CLAN;

function getLogoAttachment(): AttachmentBuilder | null {
  const logoPath = resolve(process.cwd(), 'assets/branding/r3v0-logo.png');
  if (existsSync(logoPath)) {
    return new AttachmentBuilder(logoPath, { name: 'r3v0-logo.png' });
  }
  return null;
}

async function editSafe(
  interaction: ChatInputCommandInteraction,
  payload: InteractionEditReplyOptions | string
) {
  try {
    return await interaction.editReply(payload);
  } catch (err) {
    console.error('[DISCORD_EDIT_ERROR]', err);
    return await interaction.followUp({
      content: 'Komenda została wykonana, ale Discord odrzucił edycję odpowiedzi.'
    }).catch(() => null);
  }
}

function historyEmbed(
  title: string,
  current: number,
  delta24h: number,
  deltaPct24h: number,
  hasLogo = false
) {
  const embed = new EmbedBuilder()
    .setColor(0x7B2CBF)
    .setTitle(`📈 ${title}`)
    .setDescription('> Historia jest generowana wyłącznie z lokalnych snapshotów bazy **SQLite**.')
    .addFields(
      { name: '🎯 Aktualne punkty', value: `\`${compact(current)}\``, inline: true },
      { name: '⏳ Zmiana 24h', value: `\`${delta24h >= 0 ? '+' : ''}${compact(delta24h)}\``, inline: true },
      { name: '📊 Zmiana %', value: `\`${deltaPct24h >= 0 ? '+' : ''}${deltaPct24h.toFixed(1)}%\``, inline: true }
    )
    .setImage('attachment://history.png')
    .setFooter({ text: 'R3V0 Tracker • SQLite Time Series' })
    .setTimestamp();

  if (hasLogo) {
    embed.setThumbnail('attachment://r3v0-logo.png');
  }

  return embed;
}

// ============================================================================
// MODUŁ INTERAKTYWNY: HISTORIA GRACZA (EMBED + DWA RZĘDY PRZYCISKÓW)
// ============================================================================
async function handleInteractivePlayerHistory(
  interaction: ChatInputCommandInteraction,
  ctx: AppContext,
  liveClan: ClanRecord,
  resolvedUser: { id: number; name: string; displayName?: string; avatarUrl?: string | null },
  liveMember?: ClanMember
) {
  ctx.history.captureClan(liveClan);
  let selectedTf: TimeframeMode = '24h';

  // 1. Sortowanie członków klanu pod kątem drabinki klanowej
  const sortedMembers = [...liveClan.members].sort((a, b) => (b.battlePoints ?? 0) - (a.battlePoints ?? 0));
  const memberIdx = sortedMembers.findIndex(m => m.userId === resolvedUser.id);
  const rankNum = memberIdx !== -1 ? memberIdx + 1 : 1;
  const totalMembers = sortedMembers.length || 1;

  // 2. Rywal wyżej (Ahead) i niżej (Behind)
  const aheadMember = memberIdx > 0 ? sortedMembers[memberIdx - 1] : null;
  const behindMember = memberIdx < totalMembers - 1 ? sortedMembers[memberIdx + 1] : null;

  const aheadUser = aheadMember ? playerRepo.get(aheadMember.userId) : null;
  const behindUser = behindMember ? playerRepo.get(behindMember.userId) : null;

  const curPts = liveMember?.battlePoints ?? 0;
  const aheadGap = aheadMember ? (aheadMember.battlePoints ?? 0) - curPts : 0;
  const behindLead = behindMember ? curPts - (behindMember.battlePoints ?? 0) : 0;
  const clanTotalPts = liveClan.battlePoints ?? sortedMembers.reduce((sum, m) => sum + (m.battlePoints ?? 0), 0);
  const contribPct = clanTotalPts > 0 ? Math.min(100, Math.round((curPts / clanTotalPts) * 100)) : 100;

  const rivalryPayload: ClanRivalryInfo = {
    rank: rankNum,
    totalMembers,
    userPoints: curPts,
    clanPoints: clanTotalPts,
    ahead: aheadMember ? {
      name: aheadUser?.username ? String(aheadUser.username) : `User_${aheadMember.userId}`,
      gap: aheadGap
    } : null,
    behind: behindMember ? {
      name: behindUser?.username ? String(behindUser.username) : `User_${behindMember.userId}`,
      lead: behindLead
    } : null
  };

  const leaderboardPayload = sortedMembers.slice(0, 3).map((entry, index) => {
    const cached = playerRepo.get(entry.userId);
    return {
      rank: index + 1,
      name: cached?.username ? String(cached.username) : `User_${entry.userId}`,
      points: entry.battlePoints ?? 0
    };
  });

  // 3. Generator widoku Embed + PNG + 2 Rzędy Przycisków
  const renderTimeframePayload = async (mode: TimeframeMode) => {
    const stats = ctx.history.player(resolvedUser.id, 24, liveClan.battleId);
    const tfConfig = getTimeframeConfig(mode);
    const buckets = extractBucketsForTimeframe(stats.points ?? [], tfConfig.totalMs, tfConfig.buckets, curPts);
    const gainInWindow = buckets.reduce((a, b) => a + b, 0);
    const hoursCount = tfConfig.totalMs / (60 * 60 * 1000);
    const pacePerHour = Math.round(gainInWindow / Math.max(1, hoursCount));
    const bestBucket = Math.max(...buckets, 0);

    const png = await renderHistory(
      resolvedUser.displayName || resolvedUser.name,
      `[${liveClan.name}] •${liveClan.battleId ?? 'SpaceMineBattle2026'}`,
      stats,
      resolvedUser.avatarUrl ?? null,
      mode,
      rivalryPayload,
      resolvedUser.id,
      { leaderboard: leaderboardPayload }
    );

    const attachment = new AttachmentBuilder(png, { name: 'history.png' });

    // Rząd 1: 30m, 1h, 3h (3 elementy <= limit 5 na rząd)
    const row1 = new ActionRowBuilder<ButtonBuilder>().addComponents(
      (['30m', '1h', '3h'] as TimeframeMode[]).map((tf) =>
        new ButtonBuilder()
          .setCustomId(`tf_${tf}`)
          .setLabel(tf.toUpperCase())
          .setStyle(tf === mode ? ButtonStyle.Primary : ButtonStyle.Secondary)
      )
    );

    // Rząd 2: 6h, 12h, 24h (3 elementy <= limit 5 na rząd)
    const row2 = new ActionRowBuilder<ButtonBuilder>().addComponents(
      (['6h', '12h', '24h'] as TimeframeMode[]).map((tf) =>
        new ButtonBuilder()
          .setCustomId(`tf_${tf}`)
          .setLabel(tf.toUpperCase())
          .setStyle(tf === mode ? ButtonStyle.Primary : ButtonStyle.Secondary)
      )
    );

    // Discord Embed
    const embed = new EmbedBuilder()
      .setColor(0x0F1626)
      .setAuthor({
        name: `${resolvedUser.name} • [${liveClan.name}] Raport Bitewny`,
        iconURL: resolvedUser.avatarUrl ?? undefined
      })
      .setTitle(`📊 Zakres analityczny: ${mode.toUpperCase()}`)
      .setDescription(
        `Wojna: **${liveClan.battleId ?? 'Brak bitwy'}** | Pozycja w klanie: **#${rankNum} /${totalMembers}**`
      )
      .addFields(
        {
          name: `⭐ Zdobyte punkty (${mode.toUpperCase()})`,
          value: `\`+${fmt(gainInWindow)}\` (${gainInWindow.toLocaleString('en-US')} ⭐)`,
          inline: true
        },
        {
          name: '⚡ Średnie tempo',
          value: `\`${fmt(pacePerHour)} /h\``,
          inline: true
        },
        {
          name: '🏆 Najlepszy skok',
          value: `\`${fmt(bestBucket)}\``,
          inline: true
        },
        {
          name: '👑 Pozycja w klanie',
          value: rankNum === 1 ? '🥇 **Lider klanu**' : (rivalryPayload.ahead ? `Do #${rankNum - 1}: **-${fmt(rivalryPayload.ahead.gap)}**` : 'Brak danych'),
          inline: true
        },
        {
          name: '🛡️ Przewaga nad rywalem',
          value: rivalryPayload.behind ? `Nad #${rankNum + 1}: **+${fmt(rivalryPayload.behind.lead)}**` : 'Ostatnia pozycja',
          inline: true
        },
        {
          name: '💎 Wkład w klan',
          value: `\`${contribPct}%\` gwiazdek klanu`,
          inline: true
        }
      )
      .setImage('attachment://history.png')
      .setFooter({ text: 'R3V0 Tracker • Wybierz zakres poniżej, aby przełączyć dane' })
      .setTimestamp();

    return {
      embeds: [embed],
      files: [attachment],
      components: [row1, row2]
    };
  };

  const initialPayload = await renderTimeframePayload(selectedTf);
  const replyMsg = await editSafe(interaction, initialPayload);
  if (!replyMsg) return;

  const collector = replyMsg.createMessageComponentCollector({
    componentType: ComponentType.Button,
    time: 180_000
  });

  collector.on('collect', async (btn) => {
    if (btn.user.id !== interaction.user.id) {
      await btn.reply({ content: 'Tylko autor komendy może zmieniać zakres czasu.', ephemeral: true });
      return;
    }

    const chosenTf = btn.customId.replace('tf_', '') as TimeframeMode;
    selectedTf = chosenTf;

    await btn.deferUpdate();
    const updatedPayload = await renderTimeframePayload(selectedTf);
    await interaction.editReply(updatedPayload);
  });

  collector.on('end', async () => {
    await interaction.editReply({ components: [] }).catch(() => {});
  });
}

// ============================================================================
// GŁÓWNA OBSŁUGA KOMEND SLASH
// ============================================================================
export async function handleCommand(interaction: ChatInputCommandInteraction, ctx: AppContext) {
  await interaction.deferReply();

  try {
    const command = interaction.commandName;
    const subcommand = command === 'history' ? null : interaction.options.getSubcommand();
    const logoAttachment = getLogoAttachment();

    // ==========================================
    // 1. WHITELIST
    // ==========================================
    if (command === 'whitelist') {
      if (subcommand === 'add') {
        const clanName = interaction.options.getString('clan', true);
        const clan = await ctx.whitelist.add(clanName, interaction.user.id);
        const capture = ctx.history.captureClan(clan);

        const embed = new EmbedBuilder()
          .setColor(0x57F287)
          .setAuthor({ name: 'R3V0 Whitelist System', iconURL: logoAttachment ? 'attachment://r3v0-logo.png' : undefined })
          .setTitle(`✅ Zaindeksowano klan: ${clan.name}`)
          .setDescription(`Pomyślnie dodano klan do monitoringu. Zarejestrowano **${clan.members.length}** członków i zapisano snapshot (ID: **#${capture.clanSnapshotId}**).`)
          .addFields(
            { name: '⚔️ Bitwa', value: `\`${clan.battleId ?? 'Brak bitwy'}\``, inline: true },
            { name: '🎯 Punkty bitwy', value: `\`${compact(clan.battlePoints)}\``, inline: true },
            { name: '🏆 Pozycja', value: clan.battlePlace ? `\`#${clan.battlePlace}\`` : '`Brak`', inline: true }
          )
          .setTimestamp();

        if (logoAttachment) embed.setThumbnail('attachment://r3v0-logo.png');

        return editSafe(interaction, {
          embeds: [embed],
          files: logoAttachment ? [logoAttachment] : []
        });
      }

      if (subcommand === 'remove') {
        const clanName = interaction.options.getString('clan', true);
        ctx.whitelist.remove(clanName);
        return editSafe(interaction, { content: `⛔ Zatrzymano monitoring klanu **${clanName}**.` });
      }

      if (subcommand === 'list') {
        const list = ctx.whitelist.list();
        const embed = new EmbedBuilder()
          .setColor(0x7B2CBF)
          .setAuthor({ name: 'R3V0 Whitelist System', iconURL: logoAttachment ? 'attachment://r3v0-logo.png' : undefined })
          .setTitle('📋 Monitorowane Klany')
          .setDescription(list.length ? list.map((name, i) => `**${i + 1}.** 🛡️ \`${name}\``).join('\n') : '*Brak zarejestrowanych klanów w bazie.*')
          .setFooter({ text: `Łącznie klanów: ${list.length}` })
          .setTimestamp();

        if (logoAttachment) embed.setThumbnail('attachment://r3v0-logo.png');

        return editSafe(interaction, {
          embeds: [embed],
          files: logoAttachment ? [logoAttachment] : []
        });
      }

      if (subcommand === 'refresh') {
        const clanName = interaction.options.getString('clan', true);
        const clan = await ctx.whitelist.refresh(clanName, false);
        await ctx.scheduler.processClanUpdates(clan);
        const capture = ctx.history.captureClan(clan);
        return editSafe(interaction, {
          content: `🔄 Odświeżono **${clan.name}** • Członków: **${clan.members.length}** • Punkty: **${compact(clan.battlePoints)}** • Snapshot: **#${capture.clanSnapshotId}**.`
        });
      }
    }

    // ==========================================
    // 2. CLAN
    // ==========================================
    if (command === 'clan') {
      if (subcommand === 'leaderboard') {
        const page = interaction.options.getInteger('page') ?? 1;
        const response = await ctx.big.clanLeaderboard(page, 20);
        const rows = response.data as Array<Record<string, unknown>>;

        const medals = ['🥇', '🥈', '🥉'];
        const formattedRows = rows.map((row, index) => {
          const rank = (page - 1) * 20 + index + 1;
          const medal = medals[rank - 1] ?? `\`#${rank}\``;
          const clanName = String(row.Name ?? 'Unknown');
          const points = Number(row.Points ?? 0);
          const members = Number(row.Members ?? 0);
          return `${medal} **${clanName}** ➔ \`${compact(points)} pts\` • \`${members} os.\``;
        }).join('\n');

        const embed = new EmbedBuilder()
          .setColor(0xFEE75C)
          .setAuthor({ name: 'BIG Games Official Leaderboard', iconURL: logoAttachment ? 'attachment://r3v0-logo.png' : undefined })
          .setTitle(`🏆 Globalny Ranking Klanów • Strona ${page}`)
          .setDescription(formattedRows || '*API nie zwróciło danych rankingu.*')
          .setFooter({ text: `Źródło: /api/clans • Odpowiedź: ${response.source}` })
          .setTimestamp();

        if (logoAttachment) embed.setThumbnail('attachment://r3v0-logo.png');

        return editSafe(interaction, {
          embeds: [embed],
          files: logoAttachment ? [logoAttachment] : []
        });
      }

      const clanName = interaction.options.getString('clan') ?? defaultClan();
      if (!whitelistRepo.has(clanName)) {
        throw new Error(`Klan **${clanName}** nie znajduje się na whitelist. Dodaj go za pomocą \`/whitelist add\`.`);
      }

      const clan = await ctx.whitelist.refresh(clanName, false);

      if (subcommand === 'info') {
        const isTop1 = clan.battlePlace === 1;
        const medals = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣'];
        const topContributors = clan.members.slice(0, 8);

        const contributorsList = topContributors.map((member, index) => {
          const medal = medals[index] ?? '▫️';
          const cachedUser = playerRepo.get(member.userId);
          const username = cachedUser ? String(cachedUser.username) : `User_${member.userId}`;
          const leaderBadge = member.isOwner ? ' 👑 `LEADER`' : '';
          return `${medal} **${username}**${leaderBadge}\n╰ ⚔️ \`${compact(member.battlePoints)} pts\` • 💎 \`${compact(member.diamonds)}\``;
        }).join('\n\n') || '*Brak zarejestrowanych kontrybucji.*';

        const embed = new EmbedBuilder()
          .setColor(isTop1 ? 0xFEE75C : 0x7B2CBF)
          .setAuthor({ name: 'R3V0 Whitelist System', iconURL: logoAttachment ? 'attachment://r3v0-logo.png' : undefined })
          .setTitle(`${isTop1 ? '👑' : '🛡️'} ${clan.name} • Clan Overview`)
          .setDescription(clan.description ? `> *„${clan.description}”*` : '> *Brak opisu klanu.*')
          .addFields(
            {
              name: '⚔️ ━━━ [ AKTYWNA BITWA ] ━━━',
              value: `**Bitwa:** \`${clan.battleId ?? 'Brak'}\`\n**Punkty:** \`${compact(clan.battlePoints)}\`\n**Miejsce:** \`${clan.battlePlace ? `#${clan.battlePlace}` : 'Brak'}\` ${isTop1 ? '🔥 **TOP 1**' : ''}`,
              inline: true
            },
            {
              name: '🏰 ━━━ [ INFORMACJE O GILDII ] ━━━',
              value: `**Członkowie:** \`${clan.members.length}/${clan.memberCapacity}\`\n**Poziom gildii:** \`Level ${clan.guildLevel}\`\n**Diamenty:** \`${compact(clan.depositedDiamonds)} 💎\``,
              inline: true
            },
            {
              name: '⭐ ━━━ [ TOP KONTRIBUTORZY ] ━━━',
              value: contributorsList,
              inline: false
            }
          )
          .setFooter({ text: 'R3V0 Tracker • Zsynchronizowano z Big Games API' })
          .setTimestamp();

        if (logoAttachment) embed.setThumbnail('attachment://r3v0-logo.png');

        return editSafe(interaction, {
          embeds: [embed],
          files: logoAttachment ? [logoAttachment] : []
        });
      }

      if (subcommand === 'members') {
        const rows = clanRepo.members(clan.name);
        const pageSize = 10;
        const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
        let currentPage = Math.min(totalPages, Math.max(1, interaction.options.getInteger('page') ?? 1));

        const renderPagePayload = (page: number) => {
          const slice = rows.slice((page - 1) * pageSize, page * pageSize);
          const list = slice.map((member, index) => {
            const rank = (page - 1) * pageSize + index + 1;
            const userId = Number(member.user_id);
            const cachedUser = playerRepo.get(userId);
            const username = cachedUser ? String(cachedUser.username) : `User_${userId}`;
            const isOwner = Number(member.is_owner) === 1;
            const points = Number(member.battle_points ?? 0);
            return `\`#${rank}\` **${username}**${isOwner ? ' 👑' : ''} ➔ \`${compact(points)} ⭐\``;
          }).join('\n') || '*Brak zarejestrowanych członków na tej stronie.*';

          const embed = new EmbedBuilder()
            .setColor(0x7B2CBF)
            .setAuthor({ name: 'R3V0 Clan Members Index', iconURL: logoAttachment ? 'attachment://r3v0-logo.png' : undefined })
            .setTitle(`🛡️ ${clan.name} • Ranking Wewnętrzny`)
            .setDescription(`**Bitwa:** \`${clan.battleId}\`\n**Suma gwiazdek:** \`${compact(clan.battlePoints)} ⭐\`\n\n${list}`)
            .setFooter({ text: `Strona ${page}/${totalPages} • Łącznie członków: ${rows.length}` })
            .setTimestamp();

          if (logoAttachment) embed.setThumbnail('attachment://r3v0-logo.png');

          const buttonsRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder()
              .setCustomId('clan_page_prev')
              .setLabel('◀')
              .setStyle(ButtonStyle.Secondary)
              .setDisabled(page <= 1),
            new ButtonBuilder()
              .setCustomId('clan_page_indicator')
              .setLabel(`${page}/${totalPages}`)
              .setStyle(ButtonStyle.Primary)
              .setDisabled(true),
            new ButtonBuilder()
              .setCustomId('clan_page_next')
              .setLabel('▶')
              .setStyle(ButtonStyle.Secondary)
              .setDisabled(page >= totalPages),
            new ButtonBuilder()
              .setCustomId('clan_page_close')
              .setLabel('❌ Zamknij')
              .setStyle(ButtonStyle.Danger)
          );

          return {
            embeds: [embed],
            components: [buttonsRow],
            files: logoAttachment ? [logoAttachment] : []
          };
        };

        const replyMsg = await editSafe(interaction, renderPagePayload(currentPage));
        if (!replyMsg) return;

        const collector = replyMsg.createMessageComponentCollector({
          componentType: ComponentType.Button,
          time: 120_000
        });

        collector.on('collect', async (btn) => {
          if (btn.user.id !== interaction.user.id) {
            await btn.reply({ content: 'Tylko autor komendy może zmieniać strony.', ephemeral: true });
            return;
          }

          if (btn.customId === 'clan_page_prev') {
            currentPage--;
          } else if (btn.customId === 'clan_page_next') {
            currentPage++;
          } else if (btn.customId === 'clan_page_close') {
            collector.stop('closed');
            await btn.update({ components: [] });
            return;
          }

          await btn.update(renderPagePayload(currentPage));
        });

        collector.on('end', async (_, reason) => {
          if (reason !== 'closed') {
            await interaction.editReply({ components: [] }).catch(() => {});
          }
        });

        return;
      }

      if (subcommand === 'history') {
        ctx.history.captureClan(clan);
        const hours = interaction.options.getInteger('hours') ?? 24;
        const stats = ctx.history.clan(clan.name, hours);
        const png = await renderHistory(`${clan.name}`, `[${clan.name}] •${clan.battleId ?? 'SpaceMineBattle2026'}`, stats, null, '24h', null);
        return editSafe(interaction, {
          files: [new AttachmentBuilder(png, { name: 'clan-history.png' })]
        });
      }
    }

    // ==========================================
    // 3. PLAYER
    // ==========================================
    if (command === 'player') {
      if (subcommand === 'tracked') {
        const rows = ctx.player.tracked();
        const list = rows.map((row) => {
          const username = row.username ? String(row.username) : `User_${String(row.user_id)}`;
          const clanName = row.clan_name ? String(row.clan_name) : 'Brak klanu';
          return `👤 **${username}** ➔ Klan: \`${clanName}\``;
        }).join('\n');

        const embed = new EmbedBuilder()
          .setColor(0x7B2CBF)
          .setAuthor({ name: 'R3V0 Whitelist System', iconURL: logoAttachment ? 'attachment://r3v0-logo.png' : undefined })
          .setTitle('📌 Priorytetowo Śledzeni Gracze')
          .setDescription(list || '*Brak priorytetowo śledzonych graczy.*')
          .setTimestamp();

        if (logoAttachment) embed.setThumbnail('attachment://r3v0-logo.png');

        return editSafe(interaction, {
          embeds: [embed],
          files: logoAttachment ? [logoAttachment] : []
        });
      }

      const input = interaction.options.getString('player', true);
      const hint = interaction.options.getString('clan') ?? undefined;
      const resolved = await ctx.player.resolve(input, hint);

      if (subcommand === 'track') {
        if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
          throw new Error('Wymagane uprawnienie: Zarządzanie Serwerem (Manage Server).');
        }
        const clanName = interaction.options.getString('clan', true);
        const tracked = await ctx.player.track(input, clanName, interaction.user.id);
        return editSafe(interaction, {
          content: `✅ Dodano priorytetowe śledzenie dla **${tracked.user.name}** w klanie **${tracked.membership?.clan_name}**.`
        });
      }

      if (subcommand === 'untrack') {
        if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
          throw new Error('Wymagane uprawnienie: Zarządzanie Serwerem (Manage Server).');
        }
        ctx.player.untrack(resolved.user.id);
        return editSafe(interaction, {
          content: `🗑️ Usunięto priorytetowe śledzenie dla gracza **${resolved.user.name}**.`
        });
      }

      if (!resolved.membership) {
        throw new Error(`Gracz **${resolved.user.name}** nie został odnaleziony w żadnym z monitorowanych klanów.`);
      }

      const liveClan = await ctx.whitelist.refresh(resolved.membership.clan_name, false);
      const liveMember = liveClan.members.find((m) => m.userId === resolved.user.id);

      if (subcommand === 'info') {
        const isOwner = liveMember?.isOwner ?? false;
        const embed = new EmbedBuilder()
          .setColor(0x7B2CBF)
          .setAuthor({ name: 'R3V0 Whitelist System', iconURL: logoAttachment ? 'attachment://r3v0-logo.png' : undefined })
          .setTitle(`👤 ${resolved.user.displayName} (@${resolved.user.name})`)
          .setDescription(`> Profil gracza powiązanego z klanem **${liveClan.name}**.`)
          .addFields(
            { name: '🛡️ Klan', value: `\`${liveClan.name}\``, inline: true },
            { name: '👑 Rola w klanie', value: isOwner ? '`OWNER / LEADER`' : `\`Poziom: ${liveMember?.permissionLevel ?? 0}\``, inline: true },
            { name: '⚔️ Punkty bitwy', value: `\`${compact(liveMember?.battlePoints ?? 0)}\``, inline: true },
            { name: '💎 Wpłacone diamenty', value: `\`${compact(liveMember?.diamonds ?? 0)} 💎\``, inline: true },
            { name: '🆔 UserID', value: `\`${resolved.user.id}\``, inline: true }
          )
          .setTimestamp();

        if (resolved.user.avatarUrl) {
          embed.setThumbnail(resolved.user.avatarUrl);
        } else if (logoAttachment) {
          embed.setThumbnail('attachment://r3v0-logo.png');
        }

        const sorted = [...liveClan.members].sort((a, b) => (b.battlePoints ?? 0) - (a.battlePoints ?? 0));
        const playerRankIndex = sorted.findIndex((entry) => entry.userId === resolved.user.id);
        const playerRank = playerRankIndex >= 0 ? playerRankIndex + 1 : null;
        const roleLabel = isOwner ? 'OWNER / LEADER' : `PERMISSION ${liveMember?.permissionLevel ?? 0}`;

        const card = await renderPlayerCard(
          resolved.user.displayName || resolved.user.name,
          `[${liveClan.name}] •${liveClan.battleId ?? 'SpaceMineBattle2026'}`,
          resolved.user.avatarUrl ?? null,
          resolved.user.id,
          { rank: playerRank, roleLabel }
        );

        embed.setImage('attachment://player-card.png');

        const filesToSend = [new AttachmentBuilder(card, { name: 'player-card.png' })];
        if (logoAttachment) filesToSend.push(logoAttachment);
        return editSafe(interaction, { embeds: [embed], files: filesToSend });
      }

      // /player history Z OBSŁUGĄ PRZYCISKÓW TIMEFRAME
      if (subcommand === 'history') {
        return await handleInteractivePlayerHistory(interaction, ctx, liveClan, resolved.user, liveMember);
      }
    }

    // ==========================================
    // 4. QUICK HISTORY
    // ==========================================
    if (command === 'history') {
      const playerInput = interaction.options.getString('player') ?? interaction.options.getString('gracz');

      if (!playerInput) {
        const clanName = defaultClan();
        if (!whitelistRepo.has(clanName)) {
          throw new Error(`Klan **${clanName}** nie jest na whitelist. Dodaj go przez \`/whitelist add\`.`);
        }

        const clan = await ctx.whitelist.refresh(clanName, false);
        ctx.history.captureClan(clan);
        const stats = ctx.history.clan24h(clan.name);
        const png = await render24hChart({
          title: `${clan.name} • Historia 24h`,
          subtitle: `${clan.battleId ?? 'Brak bitwy'} • ${clan.battlePlace ? `#${clan.battlePlace}` : 'Brak pozycji'}`,
          current: stats.current,
          delta24h: stats.gain24h,
          deltaPct24h: stats.deltaPct24h,
          points: stats.points
        });

        const files = [new AttachmentBuilder(png, { name: 'history.png' })];
        if (logoAttachment) files.push(logoAttachment);

        return editSafe(interaction, {
          embeds: [historyEmbed(`${clan.name} • Ostatnie 24h`, stats.current, stats.gain24h, stats.deltaPct24h, Boolean(logoAttachment))],
          files
        });
      }

      const resolved = await ctx.player.resolve(playerInput);
      if (!resolved.membership) {
        throw new Error(`Gracz **${resolved.user.name}** nie został odnaleziony w monitorowanych klanach.`);
      }

      const clan = await ctx.whitelist.refresh(resolved.membership.clan_name, false);
      const member = clan.members.find((item) => item.userId === resolved.user.id);
      return await handleInteractivePlayerHistory(interaction, ctx, clan, resolved.user, member);
    }

    // ==========================================
    // 5. BATTLE DASHBOARDS
    // ==========================================
    if (command === 'battle') {
      if (subcommand === 'clan') {
        const clanName = interaction.options.getString('clan') ?? defaultClan();
        if (!whitelistRepo.has(clanName)) throw new Error('Klan nie znajduje się na whitelist.');
        const clan = await ctx.whitelist.refresh(clanName, false);
        ctx.history.captureClan(clan);
        const stats = ctx.history.clan(clan.name, interaction.options.getInteger('hours') ?? 24);
        const png = await renderHistory(
          `${clan.name}`,
          `[${clan.name}] •${clan.battleId ?? 'SpaceMineBattle2026'}`,
          stats,
          null,
          '24h',
          null
        );
        return editSafe(interaction, {
          files: [new AttachmentBuilder(png, { name: 'battle-clan.png' })]
        });
      }

      if (subcommand === 'player') {
        const input = interaction.options.getString('player', true);
        const resolved = await ctx.player.resolve(input, interaction.options.getString('clan') ?? undefined);
        if (!resolved.membership) throw new Error('Gracz nie został znaleziony w monitorowanych klanach.');
        const clan = await ctx.whitelist.refresh(resolved.membership.clan_name, false);
        const liveMember = clan.members.find((m) => m.userId === resolved.user.id);
        return await handleInteractivePlayerHistory(interaction, ctx, clan, resolved.user, liveMember);
      }
    }

    // ==========================================
    // 6. GAME: RAP & MASTERY
    // ==========================================
    if (command === 'game') {
      if (subcommand === 'rap') {
        const result = await ctx.rap.find(interaction.options.getString('item', true));
        const png = await renderRap(result);
        const files = [new AttachmentBuilder(png, { name: 'rap.png' })];
        if (logoAttachment) files.push(logoAttachment);

        const embed = new EmbedBuilder()
          .setColor(0x7B2CBF)
          .setAuthor({ name: 'BIG Games RAP Tracker', iconURL: logoAttachment ? 'attachment://r3v0-logo.png' : undefined })
          .setTitle(`💎 ${result.name} • Wycena RAP`)
          .setDescription(result.variants.map((v) => {
            const deltaSign = v.delta >= 0 ? '+' : '';
            return `**${v.label}** ➔ \`${compact(v.value)} 💎\` • ${deltaSign}${compact(v.delta)} (${deltaSign}${v.deltaPct.toFixed(1)}%)`;
          }).join('\n'))
          .setImage('attachment://rap.png')
          .setFooter({ text: `${result.baselineLabel} stanowi bazę referencyjną +/-` })
          .setTimestamp();

        return editSafe(interaction, { embeds: [embed], files });
      }

      if (subcommand === 'mastery') {
        const type = interaction.options.getString('type', true);
        const startLvl = interaction.options.getInteger('start_level', true);
        const endLvl = interaction.options.getInteger('end_level', true);
        const hasClanBoost = interaction.options.getBoolean('clan_boost') ?? true;

        if (startLvl >= endLvl) {
          throw new Error('Poziom początkowy musi być mniejszy od poziomu docelowego.');
        }

        const calc = masteryService.calculate(type, startLvl, endLvl, hasClanBoost);

        const actionFields = calc.groups.map(g => {
          const list = g.items.map(it => {
            const costStr = it.estGemCost ? ` *(~${compact(it.estGemCost)} 💎)*` : '';
            return `• **${it.name}:** \`${it.amountNeeded.toLocaleString()}\` sztuk${costStr}`;
          }).join('\n');

          const rates = g.items.map(it => `**${it.name}:** \`${it.xpEach} XP\``).join('\n');

          return [
            {
              name: `│ ${g.actionName} (Wartości XP) │`,
              value: rates,
              inline: true
            },
            {
              name: `│ Wymagana Ilość Przedmiotów │`,
              value: list,
              inline: false
            }
          ];
        }).flat();

        const embed = new EmbedBuilder()
          .setColor(calc.color)
          .setTitle(calc.title)
          .setThumbnail(calc.iconUrl)
          .addFields(
            {
              name: '│ Informacje o Poziomach │',
              value: `**Poziom startowy:** \`${calc.startLevel}\`   |   **Poziom docelowy:** \`${calc.endLevel}\`\n**Wymagany XP:** \`${calc.totalXpRequired.toLocaleString('en-US', { maximumFractionDigits: 1 })}\``,
              inline: false
            },
            {
              name: 'Clan Boost',
              value: calc.hasClanBoost ? '`✅ 10% Redukcji XP (Aktywne)`' : '`❌ Brak redukcji`',
              inline: false
            },
            ...actionFields
          )
          .setFooter({ text: calc.infoNotes ?? 'R3V0 Full Mastery Calculator • PS99' })
          .setTimestamp();

        return editSafe(interaction, { embeds: [embed] });
      }
    }

    // ==========================================
    // 7. BOT & ADMIN
    // ==========================================
    if (command === 'bot' && subcommand === 'status') {
      const status = ctx.scheduler.status();
      const embed = new EmbedBuilder()
        .setColor(0x57F287)
        .setAuthor({ name: 'R3V0 Tracker System', iconURL: logoAttachment ? 'attachment://r3v0-logo.png' : undefined })
        .setTitle('🤖 Status Operacyjny Bota')
        .addFields(
          { name: '🔄 Tracker Schedulera', value: status.running ? '`🟢 Aktywny`' : '`🔴 Zatrzymany`', inline: true },
          { name: '🛡️ Monitorowane Klany', value: `\`${status.whitelist}\``, inline: true },
          { name: '💾 Baza Danych', value: '`🟢 SQLite OK`', inline: true }
        )
        .setTimestamp();

      if (logoAttachment) embed.setThumbnail('attachment://r3v0-logo.png');

      return editSafe(interaction, {
        embeds: [embed],
        files: logoAttachment ? [logoAttachment] : []
      });
    }

    if (command === 'admin') {
      if (subcommand === 'set-main-clan') {
        const clanName = interaction.options.getString('clan', true);
        if (!whitelistRepo.has(clanName)) await ctx.whitelist.add(clanName, interaction.user.id);
        settingsRepo.set('main_clan', clanName);
        return editSafe(interaction, { content: `🎯 Główny klan został ustawiony na **${clanName}**.` });
      }

      if (subcommand === 'set-logs-channel') {
        const channel = interaction.options.getChannel('channel', true);
        settingsRepo.set('logs_channel_id', channel.id);
        return editSafe(interaction, { content: `📢 Kanał alertów i logów klanowych został ustawiony na <#${channel.id}>.` });
      }

      if (subcommand === 'diagnostics') {
        const clanName = defaultClan();
        try {
          const clan = await ctx.whitelist.refresh(clanName, false);
          const history = ctx.history.captureClan(clan);
          const embed = new EmbedBuilder()
            .setColor(0x57F287)
            .setAuthor({ name: 'R3V0 Diagnostyka Systemu', iconURL: logoAttachment ? 'attachment://r3v0-logo.png' : undefined })
            .setTitle('🩺 Wyniki Diagnostyki')
            .addFields(
              { name: '🌐 BIG Games API', value: '`🟢 Połączono (OK)`', inline: true },
              { name: '🛡️ Główny klan', value: `\`${clan.name}\``, inline: true },
              { name: '👥 Zindeksowani gracze', value: `\`${clan.members.length}\``, inline: true },
              { name: '⚔️ Punkty bitwy', value: `\`${compact(clan.battlePoints)}\``, inline: true },
              { name: '🏆 Aktywna bitwa', value: `\`${clan.battleId ?? 'Brak'}\``, inline: true },
              { name: '📸 Zapis snapshotu', value: `\`#${history.clanSnapshotId} (${history.playerSnapshotsInserted} graczy)\``, inline: true }
            )
            .setTimestamp();

          if (logoAttachment) embed.setThumbnail('attachment://r3v0-logo.png');

          return editSafe(interaction, {
            embeds: [embed],
            files: logoAttachment ? [logoAttachment] : []
          });
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : String(error);
          return editSafe(interaction, {
            embeds: [new EmbedBuilder()
              .setColor(0xED4245)
              .setTitle('❌ Diagnostyka nie powiodła się')
              .setDescription(`\`\`\`\n${message.slice(0, 3900)}\n\`\`\``)]
          });
        }
      }
    }

    throw new Error('Nieznana komenda.');
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return editSafe(interaction, {
      embeds: [new EmbedBuilder()
        .setColor(0xED4245)
        .setTitle('❌ Wystąpił błąd podczas wykonywania komendy')
        .setDescription(`\`\`\`\n${message.slice(0, 3900)}\n\`\`\``)]
    });
  }
}
