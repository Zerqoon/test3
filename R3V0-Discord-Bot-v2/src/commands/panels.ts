import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  AttachmentBuilder,
} from "discord.js";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "../config.js";
import { embed } from "../utils/embeds.js";
import { number } from "../utils/format.js";
import { xpForLevel } from "../services/levels.js";

export function rulesPanel() {
  const banner = resolve(config.panels.rulesBanner);
  const e = embed(
    config.panels.rulesTitle,
    `**Witaj w R3V0. Przeczytaj zasady przed rozpoczęciem rozmów.**\n\n${config.panels.rules.map((r, i) => `**${String(i + 1).padStart(2, "0")} •** ${r}`).join("\n\n")}\n\n**Akceptacja**\nKlikając przycisk, potwierdzasz znajomość zasad. Wersja **${config.panels.rulesVersion}**.`,
  );
  if (existsSync(banner)) e.setImage("attachment://rules-banner.png");
  return {
    embeds: [e],
    files: existsSync(banner)
      ? [new AttachmentBuilder(banner, { name: "rules-banner.png" })]
      : [],
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`rules:accept:${config.panels.rulesVersion}`)
          .setLabel("Akceptuję regulamin")
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setLabel("Weryfikacja Roblox")
          .setStyle(ButtonStyle.Link)
          .setURL(
            `https://discord.com/channels/${process.env.DISCORD_GUILD_ID ?? "@me"}/${config.channels.verification}`,
          ),
      ),
    ],
    allowedMentions: { parse: [] as const },
  };
}
export function infoPanel() {
  return {
    embeds: [
      embed(
        config.panels.infoTitle,
        `${config.panels.infoDescription}\n\n${config.panels.customInfo}`,
      ).addFields(
        {
          name: "Komendy",
          value: `<#${config.channels.commands}>`,
          inline: true,
        },
        {
          name: "Poziomy",
          value: `<#${config.channels.levels}>`,
          inline: true,
        },
        {
          name: "Administracja",
          value: `<@&${config.roles.owner}> • <@&${config.roles.moderator}>`,
        },
      ),
    ],
    allowedMentions: { parse: [] as const },
  };
}
export function guidePanel() {
  const l = config.leveling;
  return {
    embeds: [
      embed(
        "Poziomy i ekonomia",
        `**Pisanie:** ${l.minXp}–${l.maxXp} bazowego XP za sensowne, różne wiadomości co **${l.cooldownSeconds} s**. Minimum **${l.minCharacters} liter/cyfr**.\n**Voice:** ${l.voice.minXp}–${l.voice.maxXp} XP co **${l.voice.intervalSeconds} s** z minimum **${l.voice.minimumMembers} niewyciszonymi osobami**. AFK, samotni uczestnicy i boty nie dają XP.\n**Limit wspólny:** ${number(l.dailyCap)} bazowego XP / dzień (Europe/Warsaw), przed mnożnikami.\n\n**Booster serwera:** <@&${config.roles.booster}> daje **×1.5** XP. Sklep: ×1.5 / ×2 / ×3 / ×4 / ×5 na 5 min–24 h. Maksymalnie jeden kupiony booster aktywny; mnoży się z rolą Booster.\n\n**Progi ról:**\n${config.roles.levels.map((r) => `**Poziom ${r.level}** — <@&${r.id}> • ${number(xpForLevel(r.level))} XP`).join("\n")}\n\n**Ekonomia:**\n\`/ekonomia praca\` co ${config.economy.workCooldownMinutes} min\n\`/ekonomia daily\` co 24 h i bonus za serię\n\`/ekonomia przelew\` z opłatą ${config.economy.transferTaxPercent}%\n\`/ekonomia sklep\` — wyłącznie boostery XP\n\nKomendy: <#${config.channels.commands}>. Owner i Moderator mają dostęp wszędzie.`,
      ),
    ],
    allowedMentions: { parse: [] as const },
  };
}
