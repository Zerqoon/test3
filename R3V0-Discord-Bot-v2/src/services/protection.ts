import {
  Events,
  PermissionFlagsBits,
  type Guild,
  type GuildMember,
  type GuildBasedChannel,
} from "discord.js";
import { config } from "../config.js";
import type { CoreContext } from "../types.js";
import type { Quarantine } from "./store.js";
import { giveCommunity, syncLevelRoles } from "./roles.js";
import { dangerousPermissions, isStaff } from "./access.js";
import { assert } from "../utils/errors.js";
import { embed } from "../utils/embeds.js";
import { stamp } from "../utils/format.js";
import { logger } from "../utils/logger.js";

export function accountIsNew(created: number, now = Date.now()) {
  return now - created < config.protection.newAccountHours * 3600000;
}
export class NewAccountProtection {
  private busy = new Set<string>();
  private scanning = false;
  constructor(readonly ctx: CoreContext) {}
  async configureChannel(channel: GuildBasedChannel) {
    if (!("permissionOverwrites" in channel)) return;
    // Individual role denies complement a native Discord timeout; timeout also defeats other role allows.
    const view =
      channel.id === config.channels.verification ||
      channel.id ===
        this.ctx.store.setting(`rules-channel:${channel.guild.id}`);
    await channel.permissionOverwrites.edit(
      config.roles.quarantine,
      {
        ViewChannel: view,
        SendMessages: false,
        SendMessagesInThreads: false,
        AddReactions: false,
        Connect: false,
        Speak: false,
        CreatePublicThreads: false,
        CreatePrivateThreads: false,
        UseApplicationCommands: false,
        AttachFiles: false,
        EmbedLinks: false,
      },
      { reason: "R3V0 • kwarantanna nowych kont" },
    );
  }
  async setup(guild: Guild) {
    const role = await guild.roles.fetch(config.roles.quarantine);
    assert(
      role?.editable,
      "Rola kwarantanny musi istnieć i znajdować się pod rolą bota.",
    );
    assert(
      (role.permissions.bitfield & dangerousPermissions) === 0n,
      "Rola kwarantanny nie może mieć uprawnień administracji.",
    );
    const me = await guild.members.fetchMe();
    assert(
      me.permissions.has([
        PermissionFlagsBits.ManageChannels,
        PermissionFlagsBits.ManageRoles,
        PermissionFlagsBits.ModerateMembers,
      ]),
      "Ochrona wymaga Manage Channels, Manage Roles i Moderate Members.",
    );
    const channels = await guild.channels.fetch();
    let count = 0;
    for (const channel of channels.values())
      if (channel) {
        await this.configureChannel(channel);
        count++;
      }
    this.ctx.store.setSetting(`quarantine-ready:${guild.id}`, "true");
    return count;
  }
  async apply(member: GuildMember) {
    if (
      !config.protection.enabled ||
      member.user.bot ||
      isStaff(member) ||
      this.busy.has(member.id)
    )
      return false;
    const existing = this.ctx.store.quarantine(member.guild.id, member.id);
    if (existing?.released_at) return false;
    if (!existing && !accountIsNew(member.user.createdTimestamp)) return false;
    this.busy.add(member.id);
    try {
      const q =
        existing ??
        this.ctx.store.startQuarantine(
          member.guild.id,
          member.id,
          member.roles.cache
            .filter((r) => r.id !== member.guild.id && !r.managed)
            .map((r) => r.id),
          member.joinedTimestamp ?? Date.now(),
        );
      if (q.until_at <= Date.now()) {
        await this.release(member, q);
        return false;
      }
      const role = member.guild.roles.cache.get(config.roles.quarantine);
      assert(
        role?.editable,
        "Nie można nadać roli kwarantanny. Sprawdź hierarchię bota.",
      );
      assert(
        (role.permissions.bitfield & dangerousPermissions) === 0n,
        "Rola kwarantanny ma niebezpieczne uprawnienia.",
      );
      if (!member.roles.cache.has(role.id))
        await member.roles.add(role, "Kwarantanna • konto młodsze niż 72h");
      const normal = [
        config.roles.community,
        ...config.roles.levels.map((r) => r.id),
      ].filter((id) => member.roles.cache.has(id));
      if (normal.length)
        await member.roles.remove(normal, "Kwarantanna • dostęp po 3 dniach");
      assert(
        member.moderatable,
        "Kwarantanna zapisana, ale nie można nadać timeoutu. Sprawdź uprawnienia i hierarchię.",
      );
      if ((member.communicationDisabledUntilTimestamp ?? 0) < q.until_at - 1000)
        await member.disableCommunicationUntil(
          q.until_at,
          "Kwarantanna nowego konta • 3 dni od pierwszego wejścia",
        );
      if (member.voice.channelId)
        await member.voice.disconnect("Kwarantanna nowego konta");
      if (!existing) {
        const e = embed(
          "Nowe konto • kwarantanna",
          `<@${member.id}>\nKonto utworzone ${stamp(member.user.createdTimestamp, "F")}\nDostęp wróci ${stamp(q.until_at, "F")}\nRola: <@&${config.roles.quarantine}>. Wyjście i powrót nie skraca czasu.`,
          "#FBBF24",
        ).setThumbnail(member.user.displayAvatarURL());
        this.ctx.logs.general(e);
        await member
          .send({ embeds: [e], allowedMentions: { parse: [] } })
          .catch(() => {});
      }
      return true;
    } finally {
      this.busy.delete(member.id);
    }
  }
  async release(member: GuildMember, q: Quarantine, early = false) {
    assert(
      !early || !member.pending,
      "Najpierw osoba musi zaakceptować zasady Discord (Membership Screening).",
    );
    if (member.pending) return;
    if (member.roles.cache.has(config.roles.quarantine))
      await member.roles.remove(config.roles.quarantine, "Koniec kwarantanny");
    // Never remove a longer moderator timeout. Native quarantine timeout expires itself.
    if (
      (member.communicationDisabledUntilTimestamp ?? 0) <= q.until_at + 1000 &&
      member.isCommunicationDisabled() &&
      member.moderatable
    )
      await member.timeout(null, "Koniec kwarantanny");
    this.ctx.store.db
      .prepare(
        "UPDATE quarantines SET released_at=? WHERE guild_id=? AND user_id=?",
      )
      .run(Date.now(), member.guild.id, member.id);
    try {
      await giveCommunity(member, this.ctx.store);
      await syncLevelRoles(member, this.ctx.store);
    } catch (err) {
      logger.warn(
        { err, userId: member.id },
        "Koniec kwarantanny: role wymagają synchronizacji",
      );
    }
    this.ctx.logs.general(
      embed(
        "Kwarantanna zakończona",
        `<@${member.id}> otrzymuje standardowy dostęp.\n${early ? "Owner zakończył kwarantannę wcześniej." : `Kwarantanna trwała ${config.protection.quarantineHours} godzin.`}`,
        "#6EE7B7",
      ),
    );
    await member
      .send({
        embeds: [
          embed(
            "Masz już dostęp",
            `Kwarantanna zakończona. Połącz konto Roblox w <#${config.channels.verification}> i korzystaj z komend w <#${config.channels.commands}>.`,
          ),
        ],
      })
      .catch(() => {});
  }
  async sweep(guild: Guild) {
    if (this.scanning) return;
    this.scanning = true;
    try {
      const rows = this.ctx.store.db
        .prepare("SELECT * FROM quarantines WHERE guild_id=? AND released_at=0")
        .all(guild.id) as Quarantine[];
      for (const q of rows) {
        const member = await guild.members.fetch(q.user_id).catch(() => null);
        if (member)
          await this.apply(member).catch((err) =>
            logger.warn(
              { err, userId: q.user_id },
              "Ochrona konta wymaga sprawdzenia",
            ),
          );
      }
    } finally {
      this.scanning = false;
    }
  }
}
