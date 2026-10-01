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
import { applyLevelReward, roleXpMultiplier } from "../services/xp.js";
import {
  forbiddenMedia,
  linkViolation,
  gifViolation,
  containsDiscordInvite,
} from "../services/media.js";
import { issueWarning } from "../services/warnings.js";
import { accountIsNew } from "../services/protection.js";
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
export { forbiddenMedia } from "../services/media.js";
const processing = new Set<string>();
async function deleteRestricted(
  m: Message,
  reason: string,
  ctx: Context,
  points = 0,
  category = "zasady",
) {
  deletionReasons.set(m.id, { reason, at: Date.now() });
  for (const [id, r] of deletionReasons)
    if (Date.now() - r.at > 60000) deletionReasons.delete(id);
  try {
    await m.delete();
  } catch (err) {
    const code =
      typeof err === "object" && err && "code" in err ? Number(err.code) : 0;
    if (code === 10008) return;
    deletionReasons.delete(m.id);
    logger.warn(
      { err, channelId: m.channelId },
      "Nie można usunąć naruszającej wiadomości",
    );
    ctx.logs.audit(
      embed(
        "Antymoderacja • potrzebna interwencja",
        `Nie można usunąć wiadomości w <#${m.channelId}>.\nAutor: <@${m.author.id}>\nPowód: ${clean(reason)}`,
        "#F87171",
      ),
    );
  }
  const now = Date.now();
  let notice = embed(
    "Wiadomość zablokowana",
    `<@${m.author.id}> • ${clean(reason, 600)}`,
    "#FBBF24",
  );
  const key = `auto-warn:${m.guildId}:${m.author.id}:${category}`;
  if (
    points > 0 &&
    now - Number(ctx.store.setting(key) ?? 0) >=
      config.moderation.warnings.autoWarningCooldownSeconds * 1000
  ) {
    const member = m.member ?? (await m.guild!.members.fetch(m.author.id));
    const result = await issueWarning(
      ctx,
      member,
      ctx.client.user!.id,
      reason,
      points,
      `automod:${m.id}`,
    );
    ctx.store.setSetting(key, String(now));
    notice = result.embed;
  } else if (now - (notices.get(m.author.id) ?? 0) < 10000) return;
  if (notices.size > 10000) notices.clear();
  notices.set(m.author.id, now);
  if (m.channel.isSendable()) {
    const posted = await m.channel
      .send({ embeds: [notice], allowedMentions: { users: [m.author.id] } })
      .catch(() => null);
    if (posted) {
      const timer = setTimeout(
        () => {
          void posted.delete().catch(() => {});
        },
        points > 0 ? 60000 : 15000,
      );
      timer.unref();
    }
  }
}
async function enforce(m: Message, member: GuildMember, ctx: Context) {
  if (
    config.protection.enabled &&
    accountIsNew(member.user.createdTimestamp) &&
    !isStaff(member)
  )
    await ctx.protection.apply(member);
  if (
    ctx.store.isQuarantined(m.guildId!, member.id) ||
    member.roles.cache.has(config.roles.quarantine)
  ) {
    await deleteRestricted(
      m,
      "Dostęp jest wstrzymany do końca kwarantanny nowych kont.",
      ctx,
    );
    return true;
  }
  if (
    config.moderation.deleteChatInCommandChannel &&
    m.channelId === config.channels.commands
  ) {
    await deleteRestricted(m, "Ten kanał przyjmuje tylko komendy slash.", ctx);
    return true;
  }
  if (isStaff(member)) return false;
  const link = linkViolation(m.content);
  if (link) {
    await deleteRestricted(
      m,
      link,
      ctx,
      containsDiscordInvite(m.content)
        ? config.moderation.antiLink.invitePoints
        : 1,
      "link",
    );
    return true;
  }
  const media = forbiddenMedia(m, member);
  if (media) {
    await deleteRestricted(m, media, ctx);
    return true;
  }
  const gif = await gifViolation(m, ctx.store);
  if (gif) {
    await deleteRestricted(m, gif.reason, ctx, gif.points, "gif");
    return true;
  }
  return false;
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
      if (processing.has(m.id)) return;
      processing.add(m.id);
      try {
        if (await enforce(m, member, ctx)) return;
      } finally {
        processing.delete(m.id);
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
        roleXpMultiplier(member),
      );
      if (!result) return;
      await applyLevelReward(member, result, ctx);
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
    if (after.guildId !== env.DISCORD_GUILD_ID) return;
    try {
      const old = ctx.store.message(after.id);
      const m = after.partial ? await after.fetch() : after;
      if (m.author.bot) return;
      const oldContent = old?.content ?? before.content;
      // Embed hydration is not a text edit; still run media guard when previews arrive.
      const member = m.member ?? (await m.guild!.members.fetch(m.author.id));
      if (processing.has(m.id)) return;
      processing.add(m.id);
      try {
        if (await enforce(m, member, ctx)) return;
      } finally {
        processing.delete(m.id);
      }
      cache(m, ctx);
      if (noLog(m.channelId)) return;
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
