import { randomBytes } from "node:crypto";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  MessageFlags,
  type Guild,
  type GuildMember,
  type Interaction,
  type ChatInputCommandInteraction,
} from "discord.js";
import { config } from "../config.js";
import type { CoreContext } from "../types.js";
import { embed } from "../utils/embeds.js";
import { clean, stamp } from "../utils/format.js";
import { assert } from "../utils/errors.js";
import { jsonRequest } from "./http.js";
import { logger } from "../utils/logger.js";
import { giveCommunity, syncLevelRoles } from "./roles.js";

export interface RobloxUser {
  id: number;
  name: string;
  displayName: string;
  description: string;
  created: string;
  isBanned: boolean;
}
export function verificationNickname(
  discordDisplayName: string,
  robloxUsername: string,
) {
  const suffix = ` (@${robloxUsername.toLowerCase()})`;
  const max = 32 - suffix.length;
  const raw =
    discordDisplayName
      .replace(/[\r\n\u200B-\u200F\u202A-\u202E\u2066-\u2069]/g, "")
      .trim() || "Gracz";
  let base = "";
  for (const { segment } of new Intl.Segmenter("pl", {
    granularity: "grapheme",
  }).segment(raw)) {
    if (base.length + segment.length > max) break;
    base += segment;
  }
  return (base.trim() || "?") + suffix;
}
export function ownsChallenge(description: string, code: string) {
  return description.split(/[^A-Za-z0-9-]+/).includes(code);
}
export async function lookupRoblox(username: string): Promise<RobloxUser> {
  assert(
    /^[A-Za-z0-9_]{1,20}$/.test(username),
    "Wpisz nazwę użytkownika Roblox, bez @ i bez nazwy wyświetlanej.",
  );
  const lookup = await jsonRequest(
    "https://users.roblox.com/v1/usernames/users",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ usernames: [username], excludeBannedUsers: true }),
    },
  );
  const id = lookup.data?.[0]?.id;
  assert(
    Number.isSafeInteger(id) && id > 0,
    "Nie znaleziono tego użytkownika Roblox. Sprawdź nazwę użytkownika.",
  );
  return fetchRoblox(String(id));
}
export async function fetchRoblox(id: string): Promise<RobloxUser> {
  assert(/^\d{1,16}$/.test(id), "Nieprawidłowe ID Roblox.");
  const data = await jsonRequest(`https://users.roblox.com/v1/users/${id}`);
  assert(
    String(data.id) === id &&
      typeof data.name === "string" &&
      /^[A-Za-z0-9_]{1,20}$/.test(data.name) &&
      typeof data.description === "string" &&
      Number.isFinite(Date.parse(data.created)),
    "Roblox zwrócił niepełny profil. Spróbuj ponownie później.",
  );
  assert(!data.isBanned, "To konto Roblox jest zbanowane.");
  return data;
}
export function verificationPanel() {
  return {
    embeds: [
      embed(
        "R3V0 • Weryfikacja Roblox",
        `Połącz **własne konto Roblox** ze swoim profilem Discord.\n\n**1.** Kliknij „Zweryfikuj konto” i podaj nazwę użytkownika Roblox.\n**2.** Wstaw otrzymany kod do opisu profilu Roblox.\n**3.** Kliknij „Sprawdź kod”.\n\nPseudonim po weryfikacji: **Twój pseudonim Discord (@roblox)**.\nPrzykład: **Zerqon (@b3sttiee)**.\n\nKod wygasa po ${config.verification.challengeMinutes} minutach. Nowe konta Discord mają 3 dni kwarantanny. Konto Roblox musi mieć przynajmniej ${config.verification.minRobloxAgeDays} dni.`,
      ),
    ],
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId("verify:start")
          .setLabel("Zweryfikuj konto")
          .setStyle(ButtonStyle.Primary)
          .setEmoji("✅"),
        new ButtonBuilder()
          .setCustomId("verify:status")
          .setLabel("Moje połączenie")
          .setStyle(ButtonStyle.Secondary),
      ),
    ],
    allowedMentions: { parse: [] as const },
  };
}
export class RobloxVerification {
  private checking = new Set<string>();
  constructor(readonly ctx: CoreContext) {}
  async setup(guild: Guild) {
    const channel = await guild.channels.fetch(config.channels.verification);
    assert(channel?.isSendable(), "Kanał weryfikacji nie jest dostępny.");
    const key = `verification-panel:${guild.id}`;
    const oldId = this.ctx.store.setting(key);
    const old = oldId
      ? await channel.messages.fetch(oldId).catch(() => null)
      : null;
    if (old && old.author.id === this.ctx.client.user!.id) {
      await old.edit(verificationPanel());
      return old;
    }
    const message = await channel.send(verificationPanel());
    this.ctx.store.setSetting(key, message.id);
    return message;
  }
  private assertAvailable(member: GuildMember) {
    assert(
      !this.ctx.store.isQuarantined(member.guild.id, member.id) &&
        !member.roles.cache.has(config.roles.quarantine),
      "Weryfikacja będzie dostępna po zakończeniu kwarantanny nowych kont.",
    );
    assert(
      !member.pending,
      "Najpierw ukończ weryfikację zasad Discord (Membership Screening).",
    );
  }
  private modal(userId: string) {
    return new ModalBuilder()
      .setCustomId(`verify:username:${userId}`)
      .setTitle("Połącz konto Roblox")
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId("username")
            .setLabel("Nazwa użytkownika Roblox (bez @)")
            .setPlaceholder("B3sttiee")
            .setStyle(TextInputStyle.Short)
            .setMinLength(1)
            .setMaxLength(20)
            .setRequired(true),
        ),
      );
  }
  async begin(member: GuildMember, username: string) {
    this.assertAvailable(member);
    const current = this.ctx.store.challenge(member.guild.id, member.id);
    assert(
      !current ||
        current.expires_at - Date.now() <
          config.verification.challengeMinutes * 60000 - 10000,
      "Poczekaj 10 sekund przed utworzeniem kolejnego kodu.",
    );
    const user = await lookupRoblox(username.trim());
    assert(
      Date.now() - Date.parse(user.created) >=
        config.verification.minRobloxAgeDays * 86400000,
      `Konto Roblox musi mieć co najmniej ${config.verification.minRobloxAgeDays} dni.`,
    );
    const existing = this.ctx.store.db
      .prepare(
        "SELECT user_id FROM roblox_links WHERE guild_id=? AND roblox_id=?",
      )
      .get(member.guild.id, String(user.id)) as { user_id: string } | undefined;
    assert(
      !existing || existing.user_id === member.id,
      "To konto Roblox jest przypisane do innej osoby na serwerze.",
    );
    const link = this.ctx.store.link(member.guild.id, member.id);
    const base =
      link && member.nickname === link.nickname
        ? link.discord_name
        : (member.nickname ?? member.user.globalName ?? member.user.username);
    const code = `R3V0-${randomBytes(10).toString("hex").toUpperCase()}`;
    this.ctx.store.db
      .prepare(
        "INSERT INTO verification_challenges(guild_id,user_id,roblox_id,roblox_name,code,discord_name,expires_at,last_check) VALUES (?,?,?,?,?,?,?,0) ON CONFLICT(guild_id,user_id) DO UPDATE SET roblox_id=excluded.roblox_id,roblox_name=excluded.roblox_name,code=excluded.code,discord_name=excluded.discord_name,expires_at=excluded.expires_at,last_check=0",
      )
      .run(
        member.guild.id,
        member.id,
        String(user.id),
        user.name,
        code,
        base,
        Date.now() + config.verification.challengeMinutes * 60000,
      );
    return this.challengePayload(member.guild.id, member.id);
  }
  challengePayload(guild: string, user: string) {
    const c = this.ctx.store.challenge(guild, user);
    assert(
      c && c.expires_at > Date.now(),
      "Kod wygasł. Utwórz nowy przez przycisk weryfikacji.",
    );
    return {
      embeds: [
        embed(
          "Potwierdź własność konta",
          `**Roblox:** [${clean(c.roblox_name)}](https://www.roblox.com/users/${c.roblox_id}/profile)\n\nW ustawieniach Roblox, w sekcji **Account Info → Personal / About**, wklej poniższy kod do opisu profilu i zapisz.\n\n\`${c.code}\`\n\nNastępnie kliknij **Sprawdź kod**. Po weryfikacji możesz usunąć kod z opisu.\nWygasa ${stamp(c.expires_at)}.\n\nPseudonim: **${clean(verificationNickname(c.discord_name, c.roblox_name))}**`,
        ),
      ],
      components: [
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId(`verify:check:${user}`)
            .setLabel("Sprawdź kod")
            .setStyle(ButtonStyle.Success),
          new ButtonBuilder()
            .setLabel("Otwórz profil Roblox")
            .setStyle(ButtonStyle.Link)
            .setURL(`https://www.roblox.com/users/${c.roblox_id}/profile`),
        ),
      ],
    };
  }
  async check(member: GuildMember) {
    this.assertAvailable(member);
    assert(!this.checking.has(member.id), "Sprawdzenie już trwa.");
    const c = this.ctx.store.challenge(member.guild.id, member.id);
    assert(
      c && c.expires_at > Date.now(),
      "Kod wygasł. Utwórz nowy przez przycisk weryfikacji.",
    );
    assert(
      Date.now() - c.last_check >= 5000,
      "Roblox potrzebuje chwili na aktualizację. Poczekaj 5 sekund.",
    );
    this.ctx.store.db
      .prepare(
        "UPDATE verification_challenges SET last_check=? WHERE guild_id=? AND user_id=?",
      )
      .run(Date.now(), member.guild.id, member.id);
    this.checking.add(member.id);
    try {
      const user = await fetchRoblox(c.roblox_id);
      assert(
        ownsChallenge(user.description, c.code),
        "Kod nie jest jeszcze widoczny w opisie Roblox. Zapisz opis, odczekaj chwilę i kliknij ponownie „Sprawdź kod”.",
      );
      const nickname = verificationNickname(c.discord_name, user.name);
      const link = this.ctx.store.completeVerification(c, user.name, nickname);
      const notices = await this.sync(member);
      this.ctx.logs.audit(
        embed(
          "Konto Roblox zweryfikowane",
          `**Discord:** <@${member.id}>\n**Roblox:** [${clean(link.roblox_name)}](https://www.roblox.com/users/${link.roblox_id}/profile)\n**Pseudonim:** ${clean(nickname)}${notices ? `\n${notices}` : ""}`,
          "#6EE7B7",
        ),
      );
      return {
        embeds: [
          embed(
            "Weryfikacja zakończona",
            `Połączono konto **${clean(user.name)}**.\nPseudonim: **${clean(nickname)}**.\nMożesz usunąć kod z opisu Roblox.${notices ? `\n\n${notices}` : ""}`,
            "#6EE7B7",
          ),
        ],
        components: [],
      };
    } finally {
      this.checking.delete(member.id);
    }
  }
  async sync(member: GuildMember) {
    const link = this.ctx.store.link(member.guild.id, member.id);
    if (!link) return "";
    const notices: string[] = [];
    if (member.nickname !== link.nickname) {
      if (!member.manageable)
        notices.push(
          "Połączenie zapisano. Discord nie pozwala botowi zmienić Twojego pseudonimu przy obecnej hierarchii ról.",
        );
      else
        try {
          await member.setNickname(
            link.nickname,
            "Weryfikacja Roblox • pseudonim Discord + nazwa Roblox",
          );
        } catch (err) {
          logger.warn(
            { err, userId: member.id },
            "Pseudonim po weryfikacji czeka na synchronizację",
          );
          notices.push(
            "Połączenie zapisano. Pseudonim czeka na /weryfikacja odswiez.",
          );
        }
    }
    try {
      await giveCommunity(member, this.ctx.store);
      await syncLevelRoles(member, this.ctx.store);
    } catch (err) {
      logger.warn(
        { err, userId: member.id },
        "Role po weryfikacji wymagają synchronizacji",
      );
      notices.push(
        "Połączenie zapisano. Administracja musi sprawdzić uprawnienia do nadawania ról.",
      );
    }
    return notices.join("\n");
  }
  async status(member: GuildMember) {
    const link = this.ctx.store.link(member.guild.id, member.id);
    return {
      embeds: [
        embed(
          "Twoje połączenie Roblox",
          link
            ? `**Roblox:** [${clean(link.roblox_name)}](https://www.roblox.com/users/${link.roblox_id}/profile)\n**Pseudonim:** ${clean(link.nickname)}\nZweryfikowano ${stamp(link.verified_at, "F")}`
            : `Nie masz połączonego konta. Użyj przycisku w <#${config.channels.verification}>.`,
        ),
      ],
    };
  }
  async command(i: ChatInputCommandInteraction, member: GuildMember) {
    const sub = i.options.getSubcommand();
    if (sub === "polacz")
      await i.editReply(
        await this.begin(member, i.options.getString("roblox", true)),
      );
    else if (sub === "sprawdz") await i.editReply(await this.check(member));
    else if (sub === "odswiez") {
      this.assertAvailable(member);
      const link = this.ctx.store.link(member.guild.id, member.id);
      assert(link, "Najpierw połącz konto Roblox.");
      const user = await fetchRoblox(link.roblox_id);
      const base =
        member.nickname === link.nickname
          ? link.discord_name
          : (member.nickname ?? member.user.globalName ?? member.user.username);
      const nickname = verificationNickname(base, user.name);
      this.ctx.store.db
        .prepare(
          "UPDATE roblox_links SET roblox_name=?,discord_name=?,nickname=? WHERE guild_id=? AND user_id=?",
        )
        .run(user.name, base, nickname, member.guild.id, member.id);
      const notices = await this.sync(member);
      await i.editReply({
        embeds: [
          embed(
            "Połączenie odświeżone",
            `Pseudonim: **${clean(nickname)}**.${notices ? `\n${notices}` : ""}`,
          ),
        ],
      });
    } else await i.editReply(await this.status(member));
  }
  async component(i: Interaction) {
    if (
      (!i.isButton() && !i.isModalSubmit()) ||
      !i.customId.startsWith("verify:")
    )
      return false;
    if (i.isButton() && i.customId === "verify:start") {
      assert(
        !this.ctx.store.isQuarantined(i.guildId!, i.user.id),
        "Weryfikacja będzie dostępna po kwarantannie.",
      );
      await i.showModal(this.modal(i.user.id));
      return true;
    }
    await i.deferReply({ flags: MessageFlags.Ephemeral });
    const member = await i.guild!.members.fetch({
      user: i.user.id,
      force: true,
    });
    if (i.isModalSubmit()) {
      assert(
        i.customId === `verify:username:${i.user.id}`,
        "Ten formularz należy do innej osoby.",
      );
      await i.editReply(
        await this.begin(member, i.fields.getTextInputValue("username")),
      );
    } else if (i.customId === "verify:status")
      await i.editReply(await this.status(member));
    else {
      assert(
        i.customId === `verify:check:${i.user.id}`,
        "Ten kod należy do innej osoby.",
      );
      await i.editReply(await this.check(member));
    }
    return true;
  }
}
