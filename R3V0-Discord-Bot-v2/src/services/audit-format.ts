import {
  AuditLogEvent,
  PermissionsBitField,
  ChannelType,
  type GuildAuditLogsEntry,
} from "discord.js";
import { clean, stamp } from "../utils/format.js";
import { embed } from "../utils/embeds.js";
const labels: Record<string, string> = {
  name: "Nazwa",
  nick: "Pseudonim",
  permissions: "Uprawnienia",
  allow: "Dozwolone uprawnienia",
  deny: "Zabronione uprawnienia",
  color: "Kolor",
  hoist: "Osobne wyświetlanie roli",
  mentionable: "Możliwość oznaczania roli",
  position: "Pozycja",
  topic: "Temat kanału",
  nsfw: "Kanał z ograniczeniem wieku",
  bitrate: "Jakość voice",
  user_limit: "Limit osób",
  rate_limit_per_user: "Tryb powolny",
  parent_id: "Kategoria",
  communication_disabled_until: "Timeout do",
  mute: "Wyciszenie mikrofonu",
  deaf: "Wyciszenie dźwięku",
  avatar_hash: "Avatar",
  banner_hash: "Baner",
  description: "Opis",
  rules_channel_id: "Kanał regulaminu",
  system_channel_id: "Kanał systemowy",
  afk_channel_id: "Kanał AFK",
  afk_timeout: "Czas do AFK",
  verification_level: "Poziom weryfikacji",
  explicit_content_filter: "Filtr treści",
  mfa_level: "Wymagane 2FA",
  type: "Rodzaj",
  flags: "Ustawienia",
  vanity_url_code: "Własne zaproszenie",
  default_auto_archive_duration: "Archiwizacja wątków",
  archived: "Zarchiwizowany",
  locked: "Zablokowany",
  default_member_permissions: "Dostęp komendy",
};
const permissionLabels: Record<string, string> = {
  Administrator: "Administrator",
  ManageGuild: "Zarządzanie serwerem",
  ManageRoles: "Zarządzanie rolami",
  ManageChannels: "Zarządzanie kanałami",
  ViewChannel: "Widoczność kanału",
  SendMessages: "Wysyłanie wiadomości",
  ReadMessageHistory: "Historia wiadomości",
  EmbedLinks: "Osadzanie linków",
  AttachFiles: "Załączniki",
  AddReactions: "Reakcje",
  UseApplicationCommands: "Komendy aplikacji",
  ManageMessages: "Zarządzanie wiadomościami",
  ModerateMembers: "Timeouty",
  KickMembers: "Wyrzucanie członków",
  BanMembers: "Banowanie członków",
  ViewAuditLog: "Dziennik audytu",
  ManageNicknames: "Zarządzanie pseudonimami",
  ChangeNickname: "Zmiana własnego pseudonimu",
  Connect: "Wejście na voice",
  Speak: "Mówienie",
  Stream: "Udostępnianie ekranu",
  MoveMembers: "Przenoszenie osób",
  MuteMembers: "Wyciszanie mikrofonów",
  DeafenMembers: "Wyciszanie dźwięku",
  MentionEveryone: "Oznaczanie wszystkich",
  CreatePublicThreads: "Tworzenie publicznych wątków",
  CreatePrivateThreads: "Tworzenie prywatnych wątków",
  SendMessagesInThreads: "Pisanie w wątkach",
  ManageWebhooks: "Zarządzanie webhookami",
  ManageThreads: "Zarządzanie wątkami",
  UseExternalEmojis: "Zewnętrzne emoji",
  UseExternalStickers: "Zewnętrzne naklejki",
  CreateInstantInvite: "Tworzenie zaproszeń",
};
export function permissionsText(value: unknown) {
  try {
    return (
      new PermissionsBitField(BigInt(String(value)))
        .toArray()
        .map(
          (p) => permissionLabels[p] ?? p.replace(/([a-z])([A-Z])/g, "$1 $2"),
        )
        .join(", ") || "Brak"
    );
  } catch {
    return "Nieznane uprawnienia";
  }
}
export function auditValue(key: string, input: unknown): string {
  if (input === undefined || input === null) return "Nie ustawiono";
  if (
    ["permissions", "allow", "deny", "default_member_permissions"].includes(key)
  )
    return permissionsText(input).slice(0, 950);
  if (typeof input === "boolean") return input ? "Tak" : "Nie";
  if (key === "communication_disabled_until") {
    const t = Date.parse(String(input));
    return Number.isFinite(t) ? stamp(t, "F") : "Brak timeoutu";
  }
  if (key === "color" && typeof input === "number")
    return input
      ? `#${input.toString(16).padStart(6, "0").toUpperCase()}`
      : "Domyślny";
  if (key.endsWith("channel_id") || key === "parent_id")
    return `<#${String(input)}>`;
  if (key === "bitrate" && typeof input === "number")
    return `${Math.round(input / 1000)} kbps`;
  if (key === "rate_limit_per_user") return `${input} s`;
  if (key === "user_limit" && input === 0) return "Bez limitu";
  if (typeof input === "object") {
    if (Array.isArray(input))
      return (
        input
          .slice(0, 10)
          .map((x) => auditValue(key, x))
          .join(", ") || "Brak"
      );
    const obj = input as Record<string, unknown>;
    if (typeof obj.name === "string")
      return `${clean(obj.name, 100)}${obj.id ? ` (${obj.id})` : ""}`;
    if (obj.id) return `ID: ${String(obj.id)}`;
    return "Zmieniono ustawienia";
  }
  return clean(String(input), 800) || "Puste";
}
const actions: Partial<Record<AuditLogEvent, string>> = {
  [AuditLogEvent.GuildUpdate]: "Zmieniono ustawienia serwera",
  [AuditLogEvent.ChannelCreate]: "Utworzono kanał",
  [AuditLogEvent.ChannelUpdate]: "Zmieniono kanał",
  [AuditLogEvent.ChannelDelete]: "Usunięto kanał",
  [AuditLogEvent.ChannelOverwriteCreate]: "Dodano uprawnienia kanału",
  [AuditLogEvent.ChannelOverwriteUpdate]: "Zmieniono uprawnienia kanału",
  [AuditLogEvent.ChannelOverwriteDelete]: "Usunięto uprawnienia kanału",
  [AuditLogEvent.MemberKick]: "Wyrzucono członka",
  [AuditLogEvent.MemberPrune]: "Oczyszczono nieaktywnych członków",
  [AuditLogEvent.MemberBanAdd]: "Zbanowano osobę",
  [AuditLogEvent.MemberBanRemove]: "Zdjęto bana",
  [AuditLogEvent.MemberUpdate]: "Zmieniono członka",
  [AuditLogEvent.MemberRoleUpdate]: "Zmieniono role członka",
  [AuditLogEvent.MemberMove]: "Przeniesiono osoby na voice",
  [AuditLogEvent.MemberDisconnect]: "Rozłączono osoby z voice",
  [AuditLogEvent.BotAdd]: "Dodano bota",
  [AuditLogEvent.RoleCreate]: "Utworzono rolę",
  [AuditLogEvent.RoleUpdate]: "Zmieniono rolę",
  [AuditLogEvent.RoleDelete]: "Usunięto rolę",
  [AuditLogEvent.InviteCreate]: "Utworzono zaproszenie",
  [AuditLogEvent.InviteDelete]: "Usunięto zaproszenie",
  [AuditLogEvent.InviteUpdate]: "Zmieniono zaproszenie",
  [AuditLogEvent.MessageDelete]: "Usunięto wiadomości",
  [AuditLogEvent.MessageBulkDelete]: "Usunięto wiadomości zbiorczo",
  [AuditLogEvent.MessagePin]: "Przypięto wiadomość",
  [AuditLogEvent.MessageUnpin]: "Odpięto wiadomość",
  [AuditLogEvent.WebhookCreate]: "Utworzono webhook",
  [AuditLogEvent.WebhookUpdate]: "Zmieniono webhook",
  [AuditLogEvent.WebhookDelete]: "Usunięto webhook",
  [AuditLogEvent.AutoModerationBlockMessage]: "AutoMod zablokował wiadomość",
  [AuditLogEvent.AutoModerationUserCommunicationDisabled]:
    "AutoMod nadał timeout",
};
export function auditChangeFields(
  changes: { key: string; old?: unknown; new?: unknown }[],
) {
  const fields: { name: string; value: string }[] = [];
  for (const change of changes.filter(
    (c) => !/(token|secret|password|credential|application_id)/i.test(c.key),
  )) {
    if (change.key === "$add" || change.key === "$remove") {
      const roles = (change.new ?? change.old) as
        { id: string; name: string }[] | undefined;
      if (Array.isArray(roles) && roles.length)
        fields.push({
          name: change.key === "$add" ? "Dodano role" : "Odebrano role",
          value:
            roles
              .slice(0, 7)
              .map((r) => `<@&${r.id}> • ${clean(r.name, 90)}`)
              .join("\n") +
            (roles.length > 7 ? `\n… oraz ${roles.length - 7} innych ról` : ""),
        });
      continue;
    }
    if (
      change.key === "type" &&
      [change.old, change.new].every((v) => typeof v === "number")
    )
      fields.push({
        name: "Rodzaj kanału",
        value: `**Przed:** ${ChannelType[Number(change.old)]}\n**Po:** ${ChannelType[Number(change.new)]}`,
      });
    else
      fields.push({
        name: labels[change.key] ?? "Inne ustawienie",
        value:
          `**Przed:** ${auditValue(change.key, change.old)}\n**Po:** ${auditValue(change.key, change.new)}`.slice(
            0,
            1024,
          ),
      });
    if (fields.length >= 12) break;
  }
  return fields;
}
export function auditEmbed(entry: GuildAuditLogsEntry) {
  const target = entry.targetId
    ? entry.targetType === "User"
      ? `<@${entry.targetId}>`
      : entry.targetType === "Role"
        ? `<@&${entry.targetId}>`
        : entry.targetType === "Channel"
          ? `<#${entry.targetId}>`
          : `ID ${entry.targetId}`
    : "System";
  const e = embed(
    actions[entry.action] ?? "Zmiana na serwerze",
    `**Wykonał:** ${entry.executorId ? `<@${entry.executorId}>` : "System / nieznany"}\n**Cel:** ${target}\n**Powód:** ${clean(entry.reason ?? "Nie podano", 500)}\n**Czas:** ${stamp(entry.createdTimestamp, "F")}\nWpis: ${entry.id}`,
  );
  if (entry.executor) e.setThumbnail(entry.executor.displayAvatarURL());
  const fields = auditChangeFields(entry.changes ?? []);
  if (fields.length) e.addFields(fields);
  return e;
}
