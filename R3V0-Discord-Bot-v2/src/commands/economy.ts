import {
  AttachmentBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type ChatInputCommandInteraction,
} from "discord.js";
import type { Context } from "../types.js";
import { config, shop } from "../config.js";
import { assert } from "../utils/errors.js";
import { number, stamp } from "../utils/format.js";
import { embed } from "../utils/embeds.js";
import { renderCard } from "../canvas/cards.js";
export function shopPage(page: number, userId: string) {
  assert(
    Number.isInteger(page) && page >= 1 && page <= 5,
    "Strona sklepu: 1–5.",
  );
  const multiplier = [1.5, 2, 3, 4, 5][page - 1];
  const items = shop.filter(
    (item) => item.kind === "xp_boost" && item.multiplier === multiplier,
  );
  return {
    embeds: [
      embed(
        `R3V0 • Sklep XP ×${multiplier}`,
        `**Strona ${page}/5** • Waluta: ${config.brand.currency}\nKup przez **/ekonomia kup** i aktywuj przez **/ekonomia uzyj**.\nBooster działa na pisanie i voice, również z rolą Booster ×1.5. Czas biegnie także po wyjściu z serwera.`,
      ).addFields(
        ...items.map((item) => ({
          name: `${item.name} • ${number(item.price)}`,
          value: item.description,
          inline: true,
        })),
      ),
    ],
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`shop:${page - 1}:${userId}`)
          .setLabel("Poprzednia")
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(page === 1),
        new ButtonBuilder()
          .setCustomId(`shop:${page + 1}:${userId}`)
          .setLabel("Następna")
          .setStyle(ButtonStyle.Primary)
          .setDisabled(page === 5),
      ),
    ],
  };
}

export async function economy(i: ChatInputCommandInteraction, ctx: Context) {
  const sub = i.options.getSubcommand();
  const guild = i.guild!;
  const me = i.user;
  ctx.store.profile(
    guild.id,
    me.id,
    i.member && "displayName" in i.member ? i.member.displayName : me.username,
  );
  if (sub === "sklep") {
    await i.editReply(shopPage(i.options.getInteger("strona") ?? 1, me.id));
    return;
  }
  if (sub === "ekwipunek") {
    const rows = ctx.store.inventory(guild.id, me.id);
    const p = ctx.store.profile(guild.id, me.id);
    await i.editReply({
      embeds: [
        embed(
          "Twój ekwipunek",
          rows
            .map(
              (r) =>
                `**${shop.find((s) => s.id === r.item_id)?.name ?? r.item_id}** × ${r.quantity} • \`${r.item_id}\``,
            )
            .join("\n")
            .slice(0, 3800) ||
            "Ekwipunek jest pusty. Zajrzyj do /ekonomia sklep.",
        ).addFields({
          name: "Aktywny booster XP",
          value:
            p.xp_boost_until > Date.now()
              ? `XP ×${p.xp_boost_multiplier}, koniec ${stamp(p.xp_boost_until)}`
              : "Brak",
        }),
      ],
    });
    return;
  }
  if (sub === "historia") {
    const rows = ctx.store.history(guild.id, me.id);
    await i.editReply({
      embeds: [
        embed(
          "Historia Twojego konta",
          rows
            .map(
              (r) =>
                `${r.delta >= 0 ? "+" : ""}${number(r.delta)} • ${r.reason}\nSaldo: **${number(r.balance)}** • ${stamp(r.created_at)}`,
            )
            .join("\n\n") || "Brak transakcji.",
        ),
      ],
    });
    return;
  }
  if (sub === "kup") {
    const r = ctx.store.buy(
      guild.id,
      me.id,
      i.options.getString("produkt", true),
      i.id,
    );
    await i.editReply({
      embeds: [
        embed(
          "Zakup zakończony",
          `**${shop.find((s) => s.id === r.itemId)!.name}** jest w Twoim ekwipunku.\nSaldo: **${number(r.balance)} ${config.brand.currency}**.`,
        ),
      ],
    });
    return;
  }
  if (sub === "uzyj") {
    const r = ctx.store.use(
      guild.id,
      me.id,
      i.options.getString("produkt", true),
      i.id,
    );
    await i.editReply({ embeds: [embed("Produkt aktywowany", r.description)] });
    return;
  }
  if (sub === "przelew") {
    const to = i.options.getUser("osoba", true);
    assert(!to.bot, "Nie możesz wysyłać waluty botom.");
    const member = await guild.members.fetch(to.id).catch(() => null);
    assert(member, "Odbiorca musi należeć do serwera.");
    assert(
      !ctx.store.isQuarantined(guild.id, to.id),
      "Odbiorca ma aktywną kwarantannę.",
    );
    ctx.store.profile(guild.id, to.id, member.displayName);
    const r = ctx.store.transfer(
      guild.id,
      me.id,
      to.id,
      i.options.getInteger("kwota", true),
      i.id,
    );
    await i.editReply({
      embeds: [
        embed(
          "Przelew wykonany",
          `<@${to.id}> otrzymał **${number(r.amount)} ${config.brand.currency}**.\nOpłata: **${number(r.fee)}** • Twoje saldo: **${number(r.balance)}**.`,
        ),
      ],
    });
    return;
  }
  const user = sub === "saldo" ? (i.options.getUser("osoba") ?? me) : me;
  assert(!user.bot, "Boty nie mają kont ekonomii.");
  const member = await guild.members.fetch(user.id);
  ctx.store.profile(guild.id, user.id, member.displayName);
  let reward: number | undefined;
  let subtitle = "TWÓJ PORTFEL";
  let detail = "";
  if (sub === "praca") {
    const r = ctx.store.work(guild.id, me.id, i.id);
    reward = r.gain;
    subtitle = "PRACA ZAKOŃCZONA";
    detail = `Następna praca ${stamp(r.next)}.`;
  } else if (sub === "daily") {
    const r = ctx.store.daily(guild.id, me.id, i.id);
    reward = r.gain;
    subtitle = `DAILY • SERIA ${r.streak}`;
    detail = `Następna nagroda ${stamp(r.next)}.`;
  }
  const p = ctx.store.profile(guild.id, user.id);
  try {
    const png = await renderCard({
      kind: "wallet",
      profile: p,
      rank: ctx.store.rank(guild.id, user.id, "balance"),
      avatarUrl: user.displayAvatarURL({ extension: "png", size: 256 }),
      reward,
      subtitle,
    });
    await i.editReply({
      content: detail || undefined,
      files: [new AttachmentBuilder(png, { name: "portfel.png" })],
    });
  } catch {
    await i.editReply({
      embeds: [
        embed(
          subtitle,
          `Saldo: **${number(p.balance)} ${config.brand.currency}**${reward ? `\nNagroda: +${number(reward)}` : ""}\n${detail}`,
        ),
      ],
    });
  }
}
