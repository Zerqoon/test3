import {
  AttachmentBuilder,
  Events,
  type Message,
  type PartialMessage,
  type GuildMember,
} from "discord.js";
import { randomInt } from "node:crypto";
import { config, env } from "../config.js";
import type { Context } from "../types.js";
import type { MessageSnapshot } from "../services/store.js";
import { isStaff } from "../services/access.js";
import { syncLevelRoles } from "../services/roles.js";
import { renderCard } from "../canvas/cards.js";
import { embed } from "../utils/embeds.js";
import { clean, stamp } from "../utils/format.js";
import { logger } from "../utils/logger.js";

const notices = new Map<string, number>();
const deletionReasons = new Map<string, { reason: string; at: number }>();
function cache(m: Message, ctx: Context) {
  ctx.store.cacheMessage({
    id: m.id,
    guild_id: m.guildId!,
    channel_id: m.channelId,
    user_id: m.author.id,
    name: m.author.tag,
    avatar: m.author.displayAvatarURL(),
    content: m.content,
    attachments: JSON.stringify(
      m.attachments.map((a) => ({ name: a.name, url: a.url })),
    ),
    timestamp: Date.now(),
  });
}
function noLog(channelId: string) {
  return [config.channels.generalLogs, config.channels.auditLogs].includes(
    channelId,
  );
}
export function forbiddenMedia(
  m: Pick<Message, "attachments" | "content" | "embeds">,
  member: GuildMember,
) {
  if (!config.moderation.mediaGuard || isStaff(member)) return null;
  const photoRole = config.roles.levels.find((r) => r.level === 10)?.id;
  const gifRole = config.roles.levels.find((r) => r.level === 20)?.id;
  const gifs =
    m.attachments.some(
      (a) => a.contentType?.startsWith("image/gif") || /\.gif$/i.test(a.name),
    ) ||
    /(?:tenor\.com|giphy\.com|gifer\.com)\//i.test(m.content) ||
    /https?:\/\/\S+\.gif(?:\?|\s|$)/i.test(m.content) ||
    m.embeds.some((e) => e.data.type === "gifv");
  const images =
    m.attachments.some(
      (a) =>
        a.contentType?.startsWith("image/") ||
        /\.(png|jpe?g|webp|avif|bmp|gif)$/i.test(a.name),
    ) ||
    /https?:\/\/\S+\.(png|jpe?g|webp|avif)(?:\?|\s|$)/i.test(m.content) ||
    m.embeds.some((e) => e.data.type === "image" || e.data.type === "gifv");
  if (gifs && gifRole && !member.roles.cache.has(gifRole))
    return "GIF-y są dostępne od poziomu 20.";
  if (
    images &&
    photoRole &&
    !member.roles.cache.has(photoRole) &&
    !(gifRole && member.roles.cache.has(gifRole))
  )
    return "Zdjęcia są dostępne od poziomu 10.";
  return null;
}
async function deleteRestricted(m: Message, reason: string, ctx: Context) {
  deletionReasons.set(m.id, { reason, at: Date.now() });
  if (deletionReasons.size > 2000)
    for (const [id, r] of deletionReasons)
      if (Date.now() - r.at > 60000) deletionReasons.delete(id);
  try {
    await m.delete();
  } catch (err) {
    deletionReasons.delete(m.id);
    logger.warn(
      { err, channelId: m.channelId },
      "Nie można usunąć wiadomości naruszającej ograniczenia",
    );
    return;
  }
  const now = Date.now();
  if (now - (notices.get(m.author.id) ?? 0) < 60000) return;
  if (notices.size > 10000) notices.clear();
  notices.set(m.author.id, now);
  await m.author
    .send({
      embeds: [
        embed(
          "Zasady kanału",
          `${reason}\nKomendy bota: <#${config.channels.commands}>.`,
        ),
      ],
      allowedMentions: { parse: [] },
    })
    .catch(() => {});
}
async function logDelete(m: Message | PartialMessage, ctx: Context) {
  if (
    m.guildId !== env.DISCORD_GUILD_ID ||
    noLog(m.channelId) ||
    m.author?.id === ctx.client.user?.id
  )
    return;
  const saved = ctx.store.message(m.id);
  const reason = deletionReasons.get(m.id)?.reason;
  deletionReasons.delete(m.id);
  const authorId = saved?.user_id ?? m.author?.id;
  const content = saved?.content ?? m.content;
  const e = embed(
    "Wiadomość usunięta",
    `**Autor:** ${authorId ? `<@${authorId}> (${authorId})` : "Nieznany — wiadomość poza cache"}\n**Kanał:** <#${m.channelId}>\n**ID:** ${m.id}${reason ? `\n**Ograniczenie bota:** ${clean(reason)}` : ""}`,
    "#FB7185",
  ).addFields({
    name: "Treść",
    value: content
      ? clean(content, 1000)
      : "Brak treści w cache; mogła pochodzić sprzed uruchomienia lub retencji.",
  });
  const avatar = saved?.avatar ?? m.author?.displayAvatarURL();
  if (avatar) e.setThumbnail(avatar);
  if (saved) {
    const attachments = JSON.parse(saved.attachments) as {
      name: string;
      url: string;
    }[];
    if (attachments.length)
      e.addFields({
        name: "Załączniki",
        value: attachments
          .map((a) => `[${clean(a.name, 100)}](${a.url})`)
          .join("\n")
          .slice(0, 1000),
      });
  }
  ctx.logs.general(
    e,
    content && content.length > 1000
      ? [
          {
            name: `wiadomosc-${m.id}.txt`,
            text: `Autor: ${authorId ?? "nieznany"}\nKanał: ${m.channelId}\nID: ${m.id}\n\n${content}`,
          },
        ]
      : undefined,
  );
  ctx.store.deleteMessage(m.id);
}
export function messageEvents(ctx: Context) {
  ctx.client.on(Events.MessageCreate, async (m) => {
    if (m.guildId !== env.DISCORD_GUILD_ID || m.author.bot || m.webhookId)
      return;
    try {
      cache(m, ctx);
      const member = m.member ?? (await m.guild!.members.fetch(m.author.id));
      if (
        config.moderation.deleteChatInCommandChannel &&
        m.channelId === config.channels.commands
      ) {
        await deleteRestricted(
          m,
          "Kanał komend przyjmuje wyłącznie komendy slash. Zwykłe wiadomości są usuwane.",
          ctx,
        );
        return;
      }
      const reason = forbiddenMedia(m, member);
      if (reason) {
        await deleteRestricted(m, reason, ctx);
        return;
      }
      if (
        [
          config.channels.commands,
          config.channels.generalLogs,
          config.channels.auditLogs,
          config.channels.levels,
          ...config.leveling.ignoredChannels,
        ].includes(m.channelId)
      )
        return;
      ctx.store.profile(m.guildId!, m.author.id, member.displayName);
      const result = ctx.store.awardXp(
        m.guildId!,
        m.author.id,
        m.content,
        m.id,
        Date.now(),
        randomInt(config.leveling.minXp, config.leveling.maxXp + 1),
      );
      if (!result) return;
      let gainedRoles: string[] = [];
      try {
        gainedRoles = await syncLevelRoles(member, ctx.store);
      } catch (err) {
        logger.warn(
          { err, userId: member.id },
          "Poziom zapisano, ale synchronizacja ról się nie udała",
        );
      }
      if (result.newLevel <= result.oldLevel) return;
      const channel = await m.guild!.channels.fetch(config.channels.levels);
      if (!channel?.isSendable()) return;
      const rolesText = config.roles.levels
        .filter((r) => gainedRoles.includes(r.id))
        .map((r) => r.label)
        .join(" • ");
      try {
        const png = await renderCard({
          kind: "levelup",
          profile: ctx.store.profile(m.guildId!, member.id),
          rank: ctx.store.rank(m.guildId!, member.id),
          avatarUrl: m.author.displayAvatarURL({ extension: "png", size: 256 }),
          subtitle: rolesText
            ? `Odblokowano: ${rolesText}`
            : "Kolejny poziom zdobyty. Tak trzymaj!",
        });
        await channel.send({
          content: `<@${member.id}> awansuje na **poziom ${result.newLevel}**!`,
          files: [new AttachmentBuilder(png, { name: "awans.png" })],
          allowedMentions: { users: [member.id] },
        });
      } catch {
        await channel.send({
          embeds: [
            embed(
              "Nowy poziom!",
              `<@${member.id}> • Poziom **${result.newLevel}**${rolesText ? `\n${rolesText}` : ""}`,
            ),
          ],
          allowedMentions: { users: [member.id] },
        });
      }
    } catch (err) {
      logger.error({ err, messageId: m.id }, "Błąd obsługi wiadomości");
    }
  });
  ctx.client.on(Events.MessageDelete, (m) => {
    void logDelete(m, ctx).catch((err) =>
      logger.error({ err }, "Błąd logowania usunięcia wiadomości"),
    );
  });
  ctx.client.on(Events.MessageBulkDelete, (messages, channel) => {
    if (channel.guild.id !== env.DISCORD_GUILD_ID || noLog(channel.id)) return;
    const rows = messages
      .map((m) => ctx.store.message(m.id))
      .filter((r): r is MessageSnapshot => Boolean(r));
    ctx.logs.general(
      embed(
        "Wiadomości usunięte zbiorczo",
        `Kanał: <#${channel.id}>\nLiczba: **${messages.size}**\nTreść znana: **${rows.length}**\nPełna znana treść w załączniku.\n\n${rows
          .slice(0, 12)
          .map((r) => `**${clean(r.name, 50)}**: ${clean(r.content, 150)}`)
          .join("\n")}`.slice(0, 3900),
        "#FB7185",
      ),
      rows.length
        ? [
            {
              name: `usuniete-${Date.now()}.txt`,
              text: rows
                .map(
                  (r) =>
                    `[${r.id}] ${r.name} (${r.user_id})\n${r.content}\nZałączniki: ${r.attachments}`,
                )
                .join("\n\n---\n\n"),
            },
          ]
        : undefined,
    );
    for (const id of messages.keys()) ctx.store.deleteMessage(id);
  });
  ctx.client.on(Events.MessageUpdate, async (before, after) => {
    if (after.guildId !== env.DISCORD_GUILD_ID || noLog(after.channelId))
      return;
    try {
      const old = ctx.store.message(after.id);
      const m = after.partial ? await after.fetch() : after;
      if (m.author.bot) return;
      const oldContent = old?.content ?? before.content;
      // Embed hydration is not a text edit; still run media guard when previews arrive.
      const member = m.member ?? (await m.guild!.members.fetch(m.author.id));
      const reason = forbiddenMedia(m, member);
      if (reason) {
        cache(m, ctx);
        await deleteRestricted(m, reason, ctx);
        return;
      }
      cache(m, ctx);
      if (oldContent === m.content) return;
      ctx.logs.general(
        embed(
          "Wiadomość edytowana",
          `**Autor:** <@${m.author.id}>\n**Kanał:** <#${m.channelId}>\n[Otwórz wiadomość](${m.url})\nZmiana ${stamp(m.editedTimestamp ?? Date.now())}`,
          "#FBBF24",
        )
          .setThumbnail(m.author.displayAvatarURL())
          .addFields(
            {
              name: "Przed",
              value: oldContent
                ? clean(oldContent, 1000)
                : "Brak wcześniejszej treści w cache.",
            },
            { name: "Po", value: clean(m.content, 1000) },
          ),
        (oldContent?.length ?? 0) > 1000 || m.content.length > 1000
          ? [
              {
                name: `edycja-${m.id}.txt`,
                text: `Autor: ${m.author.id}\nKanał: ${m.channelId}\n\nPRZED:\n${oldContent ?? "Brak w cache"}\n\nPO:\n${m.content}`,
              },
            ]
          : undefined,
      );
    } catch (err) {
      logger.warn({ err }, "Nie można zalogować edycji wiadomości");
    }
  });
}
