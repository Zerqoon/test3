import { type ChatInputCommandInteraction, type GuildMember } from "discord.js";
import type { Context } from "../types.js";
import { requireOwner } from "../services/access.js";
import { assert } from "../utils/errors.js";
import { embed } from "../utils/embeds.js";
import { rulesPanel } from "./panels.js";
export async function setup(
  i: ChatInputCommandInteraction,
  actor: GuildMember,
  ctx: Context,
) {
  requireOwner(actor);
  const guild = i.guild!;
  if (i.commandName === "setup-regulamin") {
    const channel = await guild.channels.fetch(
      i.options.getChannel("kanal")?.id ?? i.channelId,
    );
    assert(
      channel?.isSendable(),
      "Wybierz zwykły kanał tekstowy do regulaminu.",
    );
    const key = `rules-panel:${guild.id}`;
    const previousChannel = ctx.store.setting(`rules-channel:${guild.id}`);
    const oldId =
      previousChannel === channel.id ? ctx.store.setting(key) : undefined;
    const old = oldId
      ? await channel.messages.fetch(oldId).catch(() => null)
      : null;
    const message =
      old?.author.id === ctx.client.user!.id
        ? await old.edit({ ...rulesPanel(), attachments: [] })
        : await channel.send(rulesPanel());
    ctx.store.setSetting(key, message.id);
    ctx.store.setSetting(`rules-channel:${guild.id}`, channel.id);
    await ctx.protection.configureChannel(channel).catch(() => {});
    ctx.logs.action(
      "Opublikowano regulamin",
      channel.id,
      actor.id,
      message.url,
    );
    await i.editReply({
      embeds: [
        embed(
          "Regulamin gotowy",
          `[Otwórz regulamin](${message.url})\nPanel zawiera zasady, przycisk akceptacji i Twój baner R3V0 na dole.`,
        ),
      ],
    });
    return;
  }
  if (i.commandName === "setup-weryfikacja") {
    const msg = await ctx.verification.setup(guild);
    await i.editReply({
      embeds: [embed("Weryfikacja gotowa", `[Otwórz panel](${msg.url})`)],
    });
    return;
  }
  if (i.commandName === "setup-voice") {
    const entry = await ctx.voice.setup(guild);
    await i.editReply({
      embeds: [
        embed(
          "Pokoje voice gotowe",
          `Wejdź na <#${entry.id}>. Panel znajdziesz w czacie utworzonego pokoju.`,
        ),
      ],
    });
    return;
  }
  const protection = await ctx.protection.setup(guild);
  const verification = await ctx.verification.setup(guild);
  const voice = await ctx.voice.setup(guild);
  await ctx.protection.sweep(guild);
  ctx.logs.action(
    "Konfiguracja modułów",
    guild.id,
    actor.id,
    `Ochrona ${protection} kanałów, weryfikacja Roblox, prywatny voice`,
  );
  await i.editReply({
    embeds: [
      embed(
        "Konfiguracja gotowa",
        `✅ Ochrona nowych kont: **${protection} kanałów**\n✅ [Panel weryfikacji](${verification.url})\n✅ Tworzenie voice: <#${voice.id}>\n\nRegulamin z banerem opublikujesz komendą **/setup-regulamin kanal:**.\nUprawnienia i klucz GIPHY sprawdzisz przez **/admin diagnostyka**.`,
      ),
    ],
  });
}
