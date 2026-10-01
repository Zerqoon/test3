import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Events,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  type Interaction,
  type EmbedBuilder,
} from "discord.js";
import type { Context } from "../types.js";
import { env, shop } from "../config.js";
import { assert, UserError } from "../utils/errors.js";
import { embed } from "../utils/embeds.js";
import { logger } from "../utils/logger.js";
import {
  commandLocationAllowed,
  getActor,
  requireStaff,
} from "../services/access.js";
import { general } from "../commands/general.js";
import { economy, shopPage } from "../commands/economy.js";
import { moderation } from "../commands/moderation.js";
import { admin } from "../commands/admin.js";
import { config } from "../config.js";
import { setup } from "../commands/setup.js";
import { warningCommand } from "../services/warnings.js";
import { searchGifs } from "../services/media.js";
import { isStaff } from "../services/access.js";
import { clean } from "../utils/format.js";

const commandCooldowns = new Map<string, number>();
const commandRunning = new Set<string>();
const announcements = new Map<
  string,
  {
    userId: string;
    guildId: string;
    channelId: string;
    e: EmbedBuilder;
    expires: number;
  }
>();
async function fail(i: Interaction, err: unknown) {
  if (!i.isRepliable()) return;
  const code =
    typeof err === "object" && err && "code" in err
      ? Number(err.code)
      : undefined;
  let message =
    err instanceof UserError
      ? err.message
      : "Nie udało się wykonać akcji. Sprawdź /admin diagnostyka lub logi Railway.";
  if (code === 50013 || code === 50001)
    message =
      "Bot nie ma dostępu lub uprawnień. Sprawdź role, kanał i hierarchię.";
  if (code === 10007) message = "Ta osoba nie jest członkiem serwera.";
  if (code === 10026) message = "Nie znaleziono bana tej osoby.";
  if (!(err instanceof UserError))
    logger.error({ err, interactionId: i.id }, "Błąd komendy");
  const payload = {
    embeds: [embed("Akcja niedostępna", message, "#F87171")],
    allowedMentions: { parse: [] as const },
  };
  try {
    if (i.deferred && i.isMessageComponent() && !i.ephemeral)
      await i.followUp({ ...payload, flags: MessageFlags.Ephemeral });
    else if (i.deferred && !i.ephemeral) {
      await i.deleteReply().catch(() => {});
      await i.followUp({ ...payload, flags: MessageFlags.Ephemeral });
    } else if (i.deferred) await i.editReply({ ...payload, components: [] });
    else if (i.replied)
      await i.followUp({ ...payload, flags: MessageFlags.Ephemeral });
    else await i.reply({ ...payload, flags: MessageFlags.Ephemeral });
  } catch (replyError) {
    logger.warn({ err: replyError }, "Nie można odpowiedzieć na interakcję");
  }
}
async function component(i: Interaction, ctx: Context) {
  if (await ctx.verification.component(i)) return;
  if (await ctx.voice.component(i)) return;
  if (i.isButton() && i.customId.startsWith("shop:")) {
    const [, page, user] = i.customId.split(":");
    assert(
      i.user.id === user,
      "Ten widok należy do innej osoby. Otwórz własny przez /ekonomia sklep.",
    );
    assert(
      !ctx.store.isQuarantined(i.guildId!, i.user.id),
      "Sklep jest dostępny po kwarantannie.",
    );
    await i.deferUpdate();
    await i.editReply(shopPage(Number(page), user));
    return;
  }
  if (!i.isButton() && !i.isModalSubmit()) return;
  if (i.isButton() && i.customId.startsWith("rules:accept:")) {
    assert(
      i.customId.slice("rules:accept:".length) === config.panels.rulesVersion,
      "Ten panel ma starszą wersję regulaminu. Wyświetl aktualny przez /regulamin w kanale komend.",
    );
    ctx.store.acceptRules(i.guildId!, i.user.id);
    await i.reply({
      embeds: [
        embed(
          "Regulamin zaakceptowany",
          `Zapisano akceptację wersji **${config.panels.rulesVersion}**. Dziękujemy!`,
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  if (i.isModalSubmit() && i.customId.startsWith("announcement:")) {
    const [, channelId, userId] = i.customId.split(":");
    assert(i.user.id === userId, "Ten formularz należy do innej osoby.");
    await i.deferReply({ flags: MessageFlags.Ephemeral });
    const actor = await i.guild!.members.fetch({
      user: i.user.id,
      force: true,
    });
    requireStaff(actor);
    const title = i.fields.getTextInputValue("title").trim();
    const body = i.fields.getTextInputValue("body").trim();
    assert(title && body, "Tytuł i treść nie mogą być puste.");
    const e = embed(title, body).setAuthor({
      name: actor.displayName,
      iconURL: i.user.displayAvatarURL(),
    });
    for (const [key, draft] of announcements)
      if (draft.expires < Date.now()) announcements.delete(key);
    assert(
      announcements.size < 200,
      "Zbyt wiele aktywnych szkiców. Spróbuj za kilka minut.",
    );
    announcements.set(i.id, {
      userId,
      guildId: i.guildId!,
      channelId,
      e,
      expires: Date.now() + 300000,
    });
    await i.editReply({
      content: `Podgląd ogłoszenia do <#${channelId}>. Podgląd wygasa po 5 minutach.`,
      embeds: [e],
      components: [
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId(`publish:${i.id}`)
            .setLabel("Opublikuj")
            .setStyle(ButtonStyle.Primary),
          new ButtonBuilder()
            .setCustomId(`cancel:${i.id}`)
            .setLabel("Anuluj")
            .setStyle(ButtonStyle.Secondary),
        ),
      ],
      allowedMentions: { parse: [] },
    });
    return;
  }
  if (i.isButton() && /^(publish|cancel):/.test(i.customId)) {
    const [action, id] = i.customId.split(":");
    const draft = announcements.get(id);
    assert(
      draft && draft.expires > Date.now() && draft.guildId === i.guildId,
      "Podgląd wygasł. Utwórz ogłoszenie ponownie.",
    );
    assert(
      draft.userId === i.user.id,
      "Tylko autor może opublikować ten podgląd.",
    );
    await i.deferUpdate();
    const actor = await i.guild!.members.fetch({
      user: i.user.id,
      force: true,
    });
    requireStaff(actor);
    if (action === "cancel") {
      announcements.delete(id);
      await i.editReply({
        content: "Ogłoszenie anulowano.",
        embeds: [],
        components: [],
      });
      return;
    }
    // Reserve before the network call to prevent two button clicks publishing twice.
    announcements.delete(id);
    const channel = await i.guild!.channels.fetch(draft.channelId);
    assert(channel?.isSendable(), "Nie można wysłać wiadomości na ten kanał.");
    const msg = await channel.send({
      embeds: [draft.e],
      allowedMentions: { parse: [] },
      nonce: id,
      enforceNonce: true,
    });
    ctx.logs.action("OGŁOSZENIE", channel.id, actor.id, msg.url);
    await i.editReply({ content: `Opublikowano: ${msg.url}`, components: [] });
  }
}
export function interactionEvents(ctx: Context) {
  ctx.client.on(Events.InteractionCreate, async (i) => {
    if (i.guildId !== env.DISCORD_GUILD_ID) {
      if (i.isRepliable())
        await i
          .reply({
            content: "Bot działa na skonfigurowanym serwerze.",
            flags: MessageFlags.Ephemeral,
          })
          .catch(() => {});
      return;
    }
    try {
      if (i.isAutocomplete()) {
        if (i.commandName !== "ekonomia") {
          await i.respond([]);
          return;
        }
        const actor = i.guild?.members.cache.get(i.user.id);
        if (
          !actor ||
          !commandLocationAllowed(actor, i.channelId) ||
          ctx.store.isQuarantined(i.guildId!, i.user.id)
        ) {
          await i.respond([]);
          return;
        }
        const query = i.options.getFocused().toLowerCase();
        const sub = i.options.getSubcommand();
        const owned = new Set(
          ctx.store.inventory(i.guildId!, i.user.id).map((r) => r.item_id),
        );
        await i.respond(
          shop
            .filter(
              (item) =>
                (sub !== "uzyj" || owned.has(item.id)) &&
                (item.name
                  .toLowerCase()
                  .replace("×", "x")
                  .includes(query.replace("×", "x")) ||
                  item.id.includes(query)),
            )
            .slice(0, 25)
            .map((item) => ({
              name: `${item.name} • ${item.price.toLocaleString("pl-PL")} ${config.brand.currency}`.slice(
                0,
                100,
              ),
              value: item.id,
            })),
        );
        return;
      }
      if (!i.isChatInputCommand()) {
        await component(i, ctx);
        return;
      }
      if (i.commandName !== "ogloszenie") {
        const privateReply =
          i.commandName === "weryfikacja" ||
          (i.commandName === "ekonomia" &&
            i.options.getSubcommand() === "historia") ||
          (i.commandName === "ostrzezenia" &&
            i.options.getSubcommand() === "lista") ||
          (i.commandName === "moderacja" &&
            i.options.getSubcommand() === "sprawy");
        await i.deferReply({
          flags: privateReply ? MessageFlags.Ephemeral : undefined,
        });
      }
      // A modal must be shown within three seconds; its submission fetches and rechecks the member.
      const actor =
        i.commandName === "ogloszenie"
          ? i.guild!.members.cache.get(i.user.id)
          : await getActor(i);
      assert(
        actor,
        "Profil członka jest jeszcze wczytywany. Spróbuj za chwilę.",
      );
      assert(
        commandLocationAllowed(actor, i.channelId),
        `Używaj komend w <#${config.channels.commands}>. Owner i Moderator mają dostęp na całym serwerze.`,
      );
      assert(
        !ctx.store.isQuarantined(i.guildId!, i.user.id) &&
          !actor.roles.cache.has(config.roles.quarantine),
        "Komendy będą dostępne po zakończeniu kwarantanny nowych kont.",
      );
      assert(
        !actor.pending,
        "Najpierw ukończ weryfikację zasad Discord (Membership Screening).",
      );
      const key = `${i.guildId}:${i.user.id}`;
      const now = Date.now();
      assert(
        now - (commandCooldowns.get(key) ?? 0) >= 2000,
        "Poczekaj 2 sekundy między komendami.",
      );
      if (commandCooldowns.size > 10000)
        for (const [k, t] of commandCooldowns)
          if (now - t > 60000) commandCooldowns.delete(k);
      commandCooldowns.set(key, now);
      assert(
        !commandRunning.has(key),
        "Twoja poprzednia komenda jeszcze trwa.",
      );
      commandRunning.add(key);
      try {
        if (i.commandName === "ogloszenie") {
          requireStaff(actor);
          const channelId = i.options.getChannel("kanal")?.id ?? i.channelId;
          const modal = new ModalBuilder()
            .setCustomId(`announcement:${channelId}:${actor.id}`)
            .setTitle("Nowe ogłoszenie")
            .addComponents(
              new ActionRowBuilder<TextInputBuilder>().addComponents(
                new TextInputBuilder()
                  .setCustomId("title")
                  .setLabel("Tytuł ogłoszenia")
                  .setStyle(TextInputStyle.Short)
                  .setRequired(true)
                  .setMaxLength(150),
              ),
              new ActionRowBuilder<TextInputBuilder>().addComponents(
                new TextInputBuilder()
                  .setCustomId("body")
                  .setLabel("Treść ogłoszenia")
                  .setStyle(TextInputStyle.Paragraph)
                  .setRequired(true)
                  .setMaxLength(3500),
              ),
            );
          await i.showModal(modal);
          return;
        }
        if (i.commandName === "ekonomia") await economy(i, ctx);
        else if (i.commandName === "moderacja") await moderation(i, actor, ctx);
        else if (i.commandName === "admin") await admin(i, actor, ctx);
        else if (i.commandName.startsWith("setup")) await setup(i, actor, ctx);
        else if (i.commandName === "weryfikacja")
          await ctx.verification.command(i, actor);
        else if (i.commandName === "ostrzezenia")
          await warningCommand(i, actor, ctx);
        else if (i.commandName === "voice") await ctx.voice.command(i);
        else if (i.commandName === "gif") {
          const role = config.roles.levels.find((r) => r.level === 20)?.id;
          assert(
            isStaff(actor) || (!!role && actor.roles.cache.has(role)),
            "GIF-y są dostępne od poziomu 20.",
          );
          const results = await searchGifs(
            i.options.getString("szukaj", true),
            (i.options.getString("zrodlo") ?? "giphy") as "tenor" | "giphy",
            ctx.store,
          );
          await i.editReply({
            embeds: [
              embed(
                "GIF-y • sprawdzony katalog",
                results
                  .map(
                    (r, index) =>
                      `**${index + 1}.** [${clean(r.name)}](${r.url})\n${r.url}`,
                  )
                  .join("\n\n") || "Brak wyników. Spróbuj innego hasła.",
              ),
            ],
          });
        } else await general(i, ctx);
      } finally {
        commandRunning.delete(key);
      }
    } catch (err) {
      if (i.isAutocomplete()) {
        await i.respond([]).catch(() => {});
        return;
      }
      await fail(i, err);
    }
  });
}
