import { randomInt } from "node:crypto";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  UserSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  MessageFlags,
  ChannelType,
  PermissionFlagsBits,
  Events,
  type Guild,
  type VoiceChannel,
  type GuildMember,
  type VoiceState,
  type Interaction,
  type ChatInputCommandInteraction,
} from "discord.js";
import { config, env } from "../config.js";
import type { CoreContext } from "../types.js";
import type { TempVoice } from "./store.js";
import { embed } from "../utils/embeds.js";
import { clean, stamp } from "../utils/format.js";
import { assert } from "../utils/errors.js";
import { isStaff } from "./access.js";
import { logger } from "../utils/logger.js";
import { applyLevelReward, roleXpMultiplier } from "./xp.js";
import { accountIsNew } from "./protection.js";

export function validVoiceLimit(value: string | number) {
  const n = Number(value);
  assert(
    /^\d{1,2}$/.test(String(value)) && Number.isInteger(n) && n >= 1 && n <= 99,
    "Limit kanału musi być liczbą od 1 do 99.",
  );
  return n;
}
export function validVoiceName(value: string) {
  const name = value
    .normalize("NFKC")
    .replace(/[\r\n\u0000-\u001F\u200B-\u200F\u202A-\u202E\u2066-\u2069]/g, "")
    .trim();
  assert(
    name.length >= 2 && name.length <= 100,
    "Nazwa kanału musi mieć od 2 do 100 znaków.",
  );
  return name;
}
export function voiceEligible(state: VoiceState) {
  return (
    !!state.channelId &&
    !state.member?.user.bot &&
    !state.selfMute &&
    !state.serverMute &&
    !state.selfDeaf &&
    !state.serverDeaf &&
    !state.suppress &&
    state.channelId !== state.guild.afkChannelId
  );
}
export function voicePanel(row: TempVoice, channel: VoiceChannel) {
  const button = (
    action: string,
    label: string,
    style = ButtonStyle.Secondary,
  ) =>
    new ButtonBuilder()
      .setCustomId(`voice:${action}:${channel.id}`)
      .setLabel(label)
      .setStyle(style);
  return {
    embeds: [
      embed(
        "R3V0 • Twój pokój głosowy",
        `**Kanał:** <#${channel.id}>\n**Właściciel:** <@${row.owner_id}>\n**Limit:** ${channel.userLimit || 99} osób • **Wejście:** ${row.locked ? "🔒 zablokowane" : "🔓 otwarte"} • **Widoczność:** ${row.hidden ? "ukryty" : "publiczny"}\n\nUstaw nazwę, liczbę osób i dostęp. Panel obsługuje właściciel pokoju oraz administracja. Pusty pokój usuwa się automatycznie.`,
      ),
    ],
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        button("rename", "Nazwa"),
        button("limit", "Limit 1–99"),
        button("lock", row.locked ? "Odblokuj" : "Zablokuj"),
        button("hide", row.hidden ? "Pokaż" : "Ukryj"),
        button("refresh", "Odśwież"),
      ),
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        button("kick", "Wyrzuć"),
        button("block", "Zablokuj osobę"),
        button("unblock", "Odblokuj osobę"),
        button("allow", "Zaproś osobę"),
        button("transfer", "Przekaż pokój"),
      ),
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        button("claim", "Przejmij bez właściciela"),
        button("close", "Zamknij pokój", ButtonStyle.Danger),
      ),
    ],
    allowedMentions: { parse: [] as const },
  };
}
type Session = { channel: string; since: number; paid: number };
export class VoiceManager {
  private sessions = new Map<string, Session>();
  private creating = new Set<string>();
  private acting = new Set<string>();
  private deleting = new Set<string>();
  private cooldowns = new Map<string, number>();
  private emptyTimers = new Map<string, NodeJS.Timeout>();
  private timer?: NodeJS.Timeout;
  private ticking = false;
  private reserved = new Set<string>();
  constructor(readonly ctx: CoreContext) {}
  attach() {
    this.ctx.client.on(Events.VoiceStateUpdate, (before, after) => {
      if (after.guild.id !== env.DISCORD_GUILD_ID) return;
      this.refreshEligibility(after.guild);
      void this.stateChange(before, after).catch((err) =>
        logger.warn(
          { err, userId: after.id },
          "Zmiana pokoju voice nie powiodła się",
        ),
      );
    });
    this.ctx.client.on(Events.ChannelDelete, (channel) => {
      if (!this.ctx.store.temporary(channel.id)) return;
      this.forget(channel.id);
    });
  }
  async start(guild: Guild) {
    await this.recover(guild);
    this.refreshEligibility(guild);
    this.timer = setInterval(() => {
      void this.tick(guild).catch((err) =>
        logger.warn({ err }, "Naliczanie XP voice wymaga sprawdzenia"),
      );
    }, 10000);
    this.timer.unref();
  }
  stop() {
    if (this.timer) clearInterval(this.timer);
    for (const t of this.emptyTimers.values()) clearTimeout(t);
    this.sessions.clear();
  }
  resetSessions() {
    this.sessions.clear();
  }
  private eligibleMembers(channel: VoiceChannel) {
    return channel.members.filter(
      (m) =>
        voiceEligible(m.voice) &&
        !m.pending &&
        !(
          config.protection.enabled &&
          accountIsNew(m.user.createdTimestamp) &&
          !isStaff(m)
        ) &&
        !this.ctx.store.isQuarantined(channel.guild.id, m.id) &&
        !m.roles.cache.has(config.roles.quarantine),
    );
  }
  refreshEligibility(guild: Guild, now = Date.now()) {
    const active = new Set<string>();
    for (const channel of guild.channels.cache.values()) {
      if (
        channel.type !== ChannelType.GuildVoice ||
        channel.id === config.channels.voiceCreate ||
        config.leveling.voice.ignoredChannels.includes(channel.id)
      )
        continue;
      const members = this.eligibleMembers(channel);
      if (members.size < config.leveling.voice.minimumMembers) continue;
      for (const member of members.values()) {
        active.add(member.id);
        const old = this.sessions.get(member.id);
        if (!old || old.channel !== channel.id)
          this.sessions.set(member.id, {
            channel: channel.id,
            since: now,
            paid: now,
          });
      }
    }
    for (const id of this.sessions.keys())
      if (!active.has(id)) this.sessions.delete(id);
  }
  async tick(guild: Guild, now = Date.now()) {
    if (this.ticking || !this.ctx.client.isReady()) return;
    this.ticking = true;
    try {
      this.refreshEligibility(guild, now);
      const interval = config.leveling.voice.intervalSeconds * 1000;
      for (const [id, session] of this.sessions) {
        // Gateway outages reset the interval; no catch-up XP for time when the bot was absent.
        if (now - session.paid > interval * 2) {
          session.since = now;
          session.paid = now;
          continue;
        }
        if (now - session.paid < interval) continue;
        const member = guild.members.cache.get(id);
        if (!member) continue;
        const previous = session.paid;
        session.paid = now;
        this.ctx.store.profile(guild.id, id, member.displayName);
        const result = this.ctx.store.awardVoiceXp(
          guild.id,
          id,
          `${session.channel}:${previous}`,
          now,
          randomInt(
            config.leveling.voice.minXp,
            config.leveling.voice.maxXp + 1,
          ),
          roleXpMultiplier(member),
        );
        if (result) await applyLevelReward(member, result, this.ctx);
      }
    } finally {
      this.ticking = false;
    }
  }
  private forget(channel: string) {
    this.ctx.store.db.transaction(() => {
      this.ctx.store.db
        .prepare("DELETE FROM temp_voice WHERE channel_id=?")
        .run(channel);
      this.ctx.store.db
        .prepare("DELETE FROM voice_blocks WHERE channel_id=?")
        .run(channel);
      this.ctx.store.db
        .prepare("DELETE FROM settings WHERE key IN (?,?)")
        .run(`voice-lock:${channel}`, `voice-hide:${channel}`);
    })();
    const t = this.emptyTimers.get(channel);
    if (t) clearTimeout(t);
    this.emptyTimers.delete(channel);
  }
  private async deleteEmpty(channel: VoiceChannel) {
    if (
      !this.ctx.store.temporary(channel.id) ||
      channel.members.some((m) => !m.user.bot) ||
      this.deleting.has(channel.id)
    )
      return;
    this.deleting.add(channel.id);
    try {
      await channel.delete("Pusty prywatny pokój voice");
      this.forget(channel.id);
    } finally {
      this.deleting.delete(channel.id);
    }
  }
  private scheduleEmpty(channel: VoiceChannel) {
    const old = this.emptyTimers.get(channel.id);
    if (old) clearTimeout(old);
    this.emptyTimers.delete(channel.id);
    if (channel.members.some((m) => !m.user.bot)) return;
    const timer = setTimeout(() => {
      this.emptyTimers.delete(channel.id);
      void this.deleteEmpty(channel).catch((err) =>
        logger.warn(
          { err, channelId: channel.id },
          "Nie można usunąć pustego pokoju",
        ),
      );
    }, 15000);
    timer.unref();
    this.emptyTimers.set(channel.id, timer);
  }
  private async stateChange(before: VoiceState, after: VoiceState) {
    if (
      before.channel?.type === ChannelType.GuildVoice &&
      before.channelId !== after.channelId &&
      this.ctx.store.temporary(before.channel.id)
    )
      this.scheduleEmpty(before.channel);
    if (
      after.channel?.type === ChannelType.GuildVoice &&
      this.ctx.store.temporary(after.channel.id)
    )
      this.scheduleEmpty(after.channel);
    if (
      after.member &&
      this.ctx.store.isQuarantined(after.guild.id, after.id) &&
      after.channelId
    ) {
      await after.disconnect("Kwarantanna nowego konta");
      return;
    }
    if (
      after.channelId === config.channels.voiceCreate &&
      before.channelId !== after.channelId &&
      after.member &&
      !after.member.user.bot
    )
      await this.create(after.member);
  }
  async create(member: GuildMember) {
    if (!config.temporaryVoice.enabled || this.creating.has(member.id)) return;
    this.creating.add(member.id);
    let channel: VoiceChannel | undefined;
    try {
      assert(
        !member.pending &&
          !this.ctx.store.isQuarantined(member.guild.id, member.id),
        "Pokój będzie dostępny po weryfikacji zasad i kwarantannie.",
      );
      const existing = this.ctx.store.db
        .prepare("SELECT * FROM temp_voice WHERE guild_id=? AND owner_id=?")
        .get(member.guild.id, member.id) as TempVoice | undefined;
      if (existing) {
        const old = await member.guild.channels
          .fetch(existing.channel_id)
          .catch(() => null);
        if (old?.type === ChannelType.GuildVoice) {
          await member.voice.setChannel(old, "Powrót do własnego pokoju");
          return;
        }
        this.forget(existing.channel_id);
      }
      const last = this.cooldowns.get(member.id) ?? 0;
      assert(
        Date.now() - last >=
          config.temporaryVoice.creationCooldownSeconds * 1000,
        "Poczekaj minutę przed utworzeniem kolejnego pokoju.",
      );
      const count = (
        this.ctx.store.db
          .prepare("SELECT COUNT(*) AS n FROM temp_voice WHERE guild_id=?")
          .get(member.guild.id) as { n: number }
      ).n;
      assert(
        count + this.reserved.size < config.temporaryVoice.maxChannels,
        "Wszystkie miejsca na prywatne pokoje są zajęte. Spróbuj za chwilę.",
      );
      this.reserved.add(member.id);
      const category = await member.guild.channels.fetch(
        config.channels.voiceCategory,
      );
      assert(
        category?.type === ChannelType.GuildCategory,
        "Nie znaleziono kategorii prywatnych voice.",
      );
      const overwrites = new Map(
        category.permissionOverwrites.cache.map((o) => [
          o.id,
          {
            id: o.id,
            type: o.type,
            allow: o.allow.bitfield,
            deny: o.deny.bitfield,
          },
        ]),
      );
      const ownerAllow =
        PermissionFlagsBits.ViewChannel |
        PermissionFlagsBits.Connect |
        PermissionFlagsBits.Speak |
        PermissionFlagsBits.Stream |
        PermissionFlagsBits.SendMessages |
        PermissionFlagsBits.ReadMessageHistory |
        PermissionFlagsBits.UseApplicationCommands;
      for (const id of [
        member.id,
        config.roles.owner,
        config.roles.moderator,
      ]) {
        const old = overwrites.get(id);
        overwrites.set(id, {
          id,
          type: id === member.id ? 1 : 0,
          allow: (old?.allow ?? 0n) | ownerAllow,
          deny: (old?.deny ?? 0n) & ~ownerAllow,
        });
      }
      const botAllow =
        ownerAllow |
        PermissionFlagsBits.ManageChannels |
        PermissionFlagsBits.ManageRoles |
        PermissionFlagsBits.MoveMembers |
        PermissionFlagsBits.EmbedLinks |
        PermissionFlagsBits.AttachFiles;
      overwrites.set(this.ctx.client.user!.id, {
        id: this.ctx.client.user!.id,
        type: 1,
        allow: botAllow,
        deny: 0n,
      });
      overwrites.set(config.roles.quarantine, {
        id: config.roles.quarantine,
        type: 0,
        allow: 0n,
        deny:
          PermissionFlagsBits.ViewChannel |
          PermissionFlagsBits.Connect |
          PermissionFlagsBits.SendMessages,
      });
      channel = await member.guild.channels.create({
        name: validVoiceName(`🔊 | ${member.displayName}`.slice(0, 100)),
        type: ChannelType.GuildVoice,
        parent: category.id,
        userLimit: config.temporaryVoice.defaultLimit,
        permissionOverwrites: [...overwrites.values()],
        reason: `Prywatny voice • ${member.user.tag}`,
      });
      this.ctx.store.db
        .prepare(
          "INSERT INTO temp_voice(channel_id,guild_id,owner_id,created_at) VALUES (?,?,?,?)",
        )
        .run(channel.id, member.guild.id, member.id, Date.now());
      this.reserved.delete(member.id);
      this.cooldowns.set(member.id, Date.now());
      await member.voice.setChannel(channel, "Utworzono własny pokój");
      await this.updatePanel(channel);
      this.ctx.logs.action(
        "Utworzono prywatny voice",
        channel.id,
        member.id,
        `Limit ${channel.userLimit} osób`,
      );
    } catch (err) {
      if (channel) await this.deleteEmpty(channel).catch(() => {});
      if (member.voice.channelId === config.channels.voiceCreate)
        await member.voice
          .disconnect("Nie udało się utworzyć pokoju")
          .catch(() => {});
      await member
        .send({
          embeds: [
            embed(
              "Pokój chwilowo niedostępny",
              err instanceof Error && err.name === "UserError"
                ? err.message
                : "Administracja musi sprawdzić uprawnienia bota do tworzenia i przenoszenia kanałów.",
              "#FBBF24",
            ),
          ],
        })
        .catch(() => {});
      logger.warn(
        { err, userId: member.id },
        "Nie udało się utworzyć pokoju voice",
      );
    } finally {
      this.creating.delete(member.id);
      this.reserved.delete(member.id);
    }
  }
  async updatePanel(channel: VoiceChannel) {
    const row = this.ctx.store.temporary(channel.id);
    if (!row) return;
    const message = row.panel_id
      ? await channel.messages.fetch(row.panel_id).catch(() => null)
      : null;
    try {
      if (message?.author.id === this.ctx.client.user!.id)
        await message.edit(voicePanel(row, channel));
      else {
        const msg = await channel.send(voicePanel(row, channel));
        this.ctx.store.db
          .prepare("UPDATE temp_voice SET panel_id=? WHERE channel_id=?")
          .run(msg.id, channel.id);
      }
    } catch (err) {
      logger.warn(
        { err, channelId: channel.id },
        "Panel voice wymaga View Channel, Send Messages i Embed Links",
      );
    }
  }
  async recover(guild: Guild) {
    const rows = this.ctx.store.db
      .prepare("SELECT * FROM temp_voice WHERE guild_id=?")
      .all(guild.id) as TempVoice[];
    for (const row of rows) {
      const channel = await guild.channels
        .fetch(row.channel_id)
        .catch(() => null);
      if (channel?.type !== ChannelType.GuildVoice) {
        this.forget(row.channel_id);
        continue;
      }
      if (!channel.members.some((m) => !m.user.bot))
        await this.deleteEmpty(channel).catch((err) =>
          logger.warn({ err }, "Odzyskiwanie pustego pokoju"),
        );
      else await this.updatePanel(channel);
    }
  }
  async setup(guild: Guild) {
    const entry = await guild.channels.fetch(config.channels.voiceCreate);
    const category = await guild.channels.fetch(config.channels.voiceCategory);
    assert(
      entry?.type === ChannelType.GuildVoice &&
        category?.type === ChannelType.GuildCategory,
      "Sprawdź kanał tworzenia voice oraz kategorię.",
    );
    await entry.permissionOverwrites.edit(
      config.roles.quarantine,
      { Connect: false, ViewChannel: false },
      { reason: "Nowe konta czekają na koniec kwarantanny" },
    );
    await category.permissionOverwrites.edit(
      config.roles.quarantine,
      { Connect: false, ViewChannel: false, SendMessages: false },
      { reason: "Ochrona prywatnych voice" },
    );
    const key = `voice-guide:${guild.id}`;
    const channel = await guild.channels.fetch(config.channels.commands);
    assert(channel?.isSendable(), "Kanał komend niedostępny.");
    const payload = {
      embeds: [
        embed(
          "R3V0 • Prywatne pokoje voice",
          `Wejdź na <#${entry.id}>, aby bot utworzył i przeniósł Cię do własnego pokoju w <#${category.id}>.\n\nPanel znajdziesz w **czacie Twojego kanału głosowego**. Ustawisz nazwę, limit 1–99 osób, blokadę, widoczność, dostęp dla osób i właściciela.\n\nKomenda **/voice panel** pokaże panel ponownie. Puste pokoje usuwają się po 15 sekundach.`,
        ),
      ],
    };
    const oldId = this.ctx.store.setting(key);
    const old = oldId
      ? await channel.messages.fetch(oldId).catch(() => null)
      : null;
    if (old?.author.id === this.ctx.client.user!.id) await old.edit(payload);
    else {
      const message = await channel.send(payload);
      this.ctx.store.setSetting(key, message.id);
    }
    return entry;
  }
  private async actor(
    guild: Guild,
    user: string,
    channelId: string,
    action: string,
  ) {
    const channel = await guild.channels.fetch(channelId);
    assert(
      channel?.type === ChannelType.GuildVoice,
      "Ten kanał nie jest prywatnym voice.",
    );
    const member = await guild.members.fetch({ user, force: true });
    const row = this.ctx.store.temporary(channelId);
    assert(row && row.guild_id === guild.id, "Ten pokój już nie istnieje.");
    assert(
      !this.ctx.store.isQuarantined(guild.id, user),
      "Pokój jest niedostępny podczas kwarantanny.",
    );
    if (action === "claim")
      assert(
        member.voice.channelId === channelId &&
          !channel.members.has(row.owner_id),
        "Pokój można przejąć tylko będąc na nim, gdy właściciela nie ma.",
      );
    else {
      assert(
        row.owner_id === user || isStaff(member),
        "Tylko właściciel pokoju lub administracja może używać tego panelu.",
      );
      assert(
        isStaff(member) || member.voice.channelId === channelId,
        "Dołącz do swojego pokoju, aby nim zarządzać.",
      );
    }
    return { row, channel, member };
  }
  private async visibility(
    channel: VoiceChannel,
    row: TempVoice,
    kind: "lock" | "hide",
  ) {
    const permission = kind === "lock" ? "Connect" : "ViewChannel";
    const bit = PermissionFlagsBits[permission];
    const currently = kind === "lock" ? row.locked : row.hidden;
    const key = `voice-${kind}:${channel.id}`;
    if (!currently) {
      const ids = new Set([
        channel.guild.id,
        config.roles.community,
        ...config.roles.levels.map((r) => r.id),
        ...channel.permissionOverwrites.cache
          .filter(
            (o) =>
              o.type === 0 &&
              o.id !== config.roles.owner &&
              o.id !== config.roles.moderator &&
              o.id !== config.roles.quarantine,
          )
          .map((o) => o.id),
      ]);
      const snapshot = [...ids].map((id) => {
        const old = channel.permissionOverwrites.cache.get(id);
        return {
          id,
          value: old?.allow.has(bit) ? true : old?.deny.has(bit) ? false : null,
        };
      });
      this.ctx.store.setSetting(key, JSON.stringify(snapshot));
      for (const id of ids)
        await channel.permissionOverwrites.edit(
          id,
          { [permission]: false },
          { reason: "Panel prywatnego voice" },
        );
    } else {
      const raw = this.ctx.store.setting(key);
      assert(
        raw,
        "Brak zapisanych uprawnień. Administracja musi sprawdzić ten pokój.",
      );
      for (const saved of JSON.parse(raw) as {
        id: string;
        value: boolean | null;
      }[])
        if (channel.guild.roles.cache.has(saved.id))
          await channel.permissionOverwrites.edit(
            saved.id,
            { [permission]: saved.value },
            { reason: "Przywrócenie dostępu z panelu voice" },
          );
      this.ctx.store.db.prepare("DELETE FROM settings WHERE key=?").run(key);
    }
    this.ctx.store.db
      .prepare(
        `UPDATE temp_voice SET ${kind === "lock" ? "locked" : "hidden"}=? WHERE channel_id=?`,
      )
      .run(currently ? 0 : 1, channel.id);
  }
  private async transfer(
    channel: VoiceChannel,
    row: TempVoice,
    newOwner: GuildMember,
  ) {
    assert(
      newOwner.voice.channelId === channel.id && !newOwner.user.bot,
      "Nowy właściciel musi być na tym pokoju.",
    );
    assert(
      !this.ctx.store.isQuarantined(channel.guild.id, newOwner.id),
      "Ta osoba jest w kwarantannie.",
    );
    const owns = this.ctx.store.db
      .prepare(
        "SELECT channel_id FROM temp_voice WHERE guild_id=? AND owner_id=? AND channel_id!=?",
      )
      .get(channel.guild.id, newOwner.id, channel.id);
    assert(!owns, "Ta osoba ma już własny pokój.");
    await channel.permissionOverwrites.edit(
      newOwner.id,
      {
        ViewChannel: true,
        Connect: true,
        Speak: true,
        Stream: true,
        SendMessages: true,
        ReadMessageHistory: true,
      },
      { reason: "Przekazanie własności voice" },
    );
    if (row.owner_id !== newOwner.id)
      await channel.permissionOverwrites.delete(
        row.owner_id,
        "Zmiana właściciela pokoju",
      );
    this.ctx.store.db
      .prepare("UPDATE temp_voice SET owner_id=? WHERE channel_id=?")
      .run(newOwner.id, channel.id);
    this.ctx.store.db
      .prepare("DELETE FROM voice_blocks WHERE channel_id=? AND user_id=?")
      .run(channel.id, newOwner.id);
  }
  async command(i: ChatInputCommandInteraction) {
    const member = await i.guild!.members.fetch(i.user.id);
    const channel = member.voice.channel;
    assert(
      channel?.type === ChannelType.GuildVoice,
      "Dołącz do prywatnego pokoju voice.",
    );
    const row = this.ctx.store.temporary(channel.id);
    assert(row, "Ten kanał nie jest pokojem utworzonym przez bota.");
    await i.editReply(voicePanel(row, channel));
    await this.updatePanel(channel);
  }
  async component(i: Interaction) {
    if (
      (!i.isButton() && !i.isModalSubmit() && !i.isUserSelectMenu()) ||
      !i.customId.startsWith("voice:")
    )
      return false;
    const [, action, channelId, owner] = i.customId.split(":");
    assert(/^\d{17,20}$/.test(channelId), "Nieprawidłowy panel voice.");
    if (i.isButton() && ["rename", "limit"].includes(action)) {
      const row = this.ctx.store.temporary(channelId);
      assert(row, "Pokój już nie istnieje.");
      const member = i.guild!.members.cache.get(i.user.id);
      assert(
        row.owner_id === i.user.id || (!!member && isStaff(member)),
        "Tylko właściciel lub administracja może użyć panelu.",
      );
      await i.showModal(
        new ModalBuilder()
          .setCustomId(`voice:${action}:${channelId}:${i.user.id}`)
          .setTitle(action === "rename" ? "Nazwa pokoju" : "Limit osób")
          .addComponents(
            new ActionRowBuilder<TextInputBuilder>().addComponents(
              new TextInputBuilder()
                .setCustomId("value")
                .setLabel(
                  action === "rename"
                    ? "Nowa nazwa (2–100 znaków)"
                    : "Liczba osób (1–99)",
                )
                .setStyle(TextInputStyle.Short)
                .setMinLength(1)
                .setMaxLength(action === "rename" ? 100 : 2)
                .setRequired(true),
            ),
          ),
      );
      return true;
    }
    await i.deferReply({ flags: MessageFlags.Ephemeral });
    assert(
      !owner || owner === i.user.id,
      "Ten formularz lub wybór należy do innej osoby.",
    );
    const { row, channel, member } = await this.actor(
      i.guild!,
      i.user.id,
      channelId,
      action,
    );
    if (
      i.isButton() &&
      ["kick", "block", "unblock", "allow", "transfer"].includes(action)
    ) {
      await i.editReply({
        embeds: [
          embed(
            "Wybierz osobę",
            `Działanie: **${({ kick: "Wyrzuć", block: "Zablokuj", unblock: "Odblokuj", allow: "Zaproś", transfer: "Przekaż pokój" } as Record<string, string>)[action]}**\nPokój: <#${channel.id}>`,
          ),
        ],
        components: [
          new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(
            new UserSelectMenuBuilder()
              .setCustomId(`voice:${action}:${channel.id}:${i.user.id}`)
              .setMinValues(1)
              .setMaxValues(1)
              .setPlaceholder("Wybierz osobę z serwera"),
          ),
        ],
      });
      return true;
    }
    assert(!this.acting.has(channel.id), "Trwa już zmiana tego pokoju.");
    this.acting.add(channel.id);
    try {
      let description = "Panel odświeżony.";
      if (i.isModalSubmit()) {
        const value = i.fields.getTextInputValue("value");
        if (action === "limit") {
          await channel.setUserLimit(
            validVoiceLimit(value),
            `Panel voice • ${member.id}`,
          );
          description = `Limit ustawiono na **${value} osób**.`;
        } else if (action === "rename") {
          const key = `voice-rename:${channel.id}`;
          const last = Number(this.ctx.store.setting(key) ?? 0);
          assert(
            Date.now() - last >= 300000,
            "Nazwę pokoju można zmieniać co 5 minut.",
          );
          await channel.setName(
            validVoiceName(value),
            `Panel voice • ${member.id}`,
          );
          this.ctx.store.setSetting(key, String(Date.now()));
          description = `Nazwa zmieniona na **${clean(channel.name)}**.`;
        }
      } else if (i.isUserSelectMenu()) {
        const target = await i.guild!.members.fetch(i.values[0]);
        assert(
          target.id !== row.owner_id && target.id !== this.ctx.client.user!.id,
          "Nie możesz wykonać tego działania na właścicielu pokoju ani bocie.",
        );
        if (["kick", "block"].includes(action))
          assert(
            !isStaff(target),
            "Nie można wyrzucać ani blokować administracji z panelu voice.",
          );
        if (action === "transfer") await this.transfer(channel, row, target);
        else if (action === "kick") {
          assert(
            target.voice.channelId === channel.id,
            "Ta osoba nie jest na Twoim pokoju.",
          );
          await target.voice.disconnect(
            `Wyrzucony przez właściciela pokoju ${member.id}`,
          );
        } else if (action === "block") {
          await channel.permissionOverwrites.edit(
            target.id,
            { Connect: false, ViewChannel: false },
            { reason: `Blokada w pokoju • ${member.id}` },
          );
          this.ctx.store.db
            .prepare("INSERT OR IGNORE INTO voice_blocks VALUES (?,?)")
            .run(channel.id, target.id);
          if (target.voice.channelId === channel.id)
            await target.voice.disconnect("Blokada dostępu do pokoju");
        } else if (action === "unblock") {
          await channel.permissionOverwrites.delete(
            target.id,
            "Odblokowanie w prywatnym pokoju",
          );
          this.ctx.store.db
            .prepare(
              "DELETE FROM voice_blocks WHERE channel_id=? AND user_id=?",
            )
            .run(channel.id, target.id);
        } else if (action === "allow") {
          assert(
            !this.ctx.store.isQuarantined(i.guildId!, target.id),
            "Ta osoba jest w kwarantannie.",
          );
          await channel.permissionOverwrites.edit(
            target.id,
            { Connect: true, ViewChannel: true },
            { reason: "Zaproszenie do pokoju" },
          );
          this.ctx.store.db
            .prepare(
              "DELETE FROM voice_blocks WHERE channel_id=? AND user_id=?",
            )
            .run(channel.id, target.id);
        }
        description = `Zapisano działanie **${action === "transfer" ? "przekazanie pokoju" : action === "kick" ? "wyrzucenie" : action === "block" ? "blokada" : action === "allow" ? "zaproszenie" : "odblokowanie"}** dla <@${target.id}>.`;
      } else if (action === "lock" || action === "hide") {
        await this.visibility(channel, row, action);
        description = "Ustawienia dostępu zaktualizowane.";
      } else if (action === "claim") {
        await this.transfer(channel, row, member);
        description = "Jesteś teraz właścicielem pokoju.";
      } else if (action === "close") {
        await channel.delete(`Pokój zamknięty przez ${member.id}`);
        this.forget(channel.id);
        description = "Pokój został zamknięty.";
      } else assert(action === "refresh", "Ten przycisk jest nieaktualny.");
      if (action !== "close") await this.updatePanel(channel);
      if (action !== "refresh")
        this.ctx.logs.action(
          `Panel voice • ${action}`,
          channel.id,
          member.id,
          `${channel.name} • ${description}`,
          undefined,
          "channel",
        );
      await i.editReply({
        embeds: [embed("Pokój zaktualizowany", description)],
        components: [],
      });
    } finally {
      this.acting.delete(channel.id);
    }
    return true;
  }
}
