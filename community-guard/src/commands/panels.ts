import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import { config } from "../config.js";
import { embed } from "../utils/embeds.js";
import { number } from "../utils/format.js";
import { xpForLevel } from "../services/levels.js";

export function rulesPanel() {
  return {
    embeds: [
      embed(
        config.panels.rulesTitle,
        config.panels.rules.map((r, i) => `**${i + 1}.** ${r}`).join("\n\n") +
          `\n\nWersja **${config.panels.rulesVersion}** • Akceptacja zapisuje się na Twoim koncie.`,
      ),
    ],
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`rules:accept:${config.panels.rulesVersion}`)
          .setLabel("Akceptuję regulamin")
          .setStyle(ButtonStyle.Success),
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
        `Zdobywaj **${l.minXp}–${l.maxXp} XP** za sensowne, różne wiadomości. Odstęp: **${l.cooldownSeconds} sekund**. Minimum **${l.minCharacters} liter/cyfr**. Limit: **${number(l.dailyCap)} XP dziennie** (Europe/Warsaw). Spam, same linki i boty nie dają XP.\n\n**Progi ról:**\n${config.roles.levels.map((r) => `**Poziom ${r.level}** — <@&${r.id}> • ${number(xpForLevel(r.level))} XP`).join("\n")}\n\n**Ekonomia:**\n\`/ekonomia praca\` — wypłata co ${config.economy.workCooldownMinutes} min\n\`/ekonomia daily\` — nagroda co 24h i bonus za serię\n\`/ekonomia przelew\` — opłata ${config.economy.transferTaxPercent}% doliczana do kwoty\n\`/ekonomia sklep\` — tytuły i eliksiry\n\nKomendy: <#${config.channels.commands}>. Owner i Moderator mogą używać ich na całym serwerze.`,
      ),
    ],
    allowedMentions: { parse: [] as const },
  };
}
