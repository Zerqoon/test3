import { type Message, type GuildMember } from "discord.js";
import { config, env } from "../config.js";
import { isStaff } from "./access.js";
import type { Store } from "./store.js";
import { jsonRequest } from "./http.js";
import { assert, UserError } from "../utils/errors.js";

export function normalizeLinks(value: string, lower = true) {
  let normalized = value
    .normalize("NFKC")
    .replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]/g, "");
  if (lower) normalized = normalized.toLowerCase();
  for (let i = 0; i < 2; i++)
    try {
      normalized = decodeURIComponent(normalized);
    } catch {
      break;
    }
  return normalized
    .replace(/hxxps?/g, (m) => (m.length === 5 ? "https" : "http"))
    .replace(/\[\.\]|\(\.\)|\[dot\]|\(dot\)|\s+kropka\s+/g, ".")
    .replace(/[。｡．]/g, ".")
    .replace(/d[іi]sc[оo]rd/g, "discord");
}
export function containsDiscordInvite(value: string) {
  const normalized = normalizeLinks(value);
  const compact = normalized.replace(/[\s`*_~|\\]/g, "");
  return (
    /(?:^|[^a-z0-9])(?:www\.)?discord\s*(?:\.(?:gg|me|io|link)\s*[/:]|\.(?:com|app\.com)\s*[/:]\s*(?:invite|invites)\s*[/:])/i.test(
      normalized,
    ) ||
    /(?:discord\.(?:gg|me|io|link)[/:]|discord(?:app)?\.com[/:]invites?[/:])/i.test(
      compact,
    )
  );
}
export function hostMatches(host: string, allowed: string) {
  return host === allowed || host.endsWith(`.${allowed}`);
}
export function urlsIn(value: string) {
  const normalized = normalizeLinks(value, false);
  const urls: URL[] = [];
  const matches = normalized.match(/(?:https?:\/\/|www\.)[^\s<>"`]+/gi) ?? [];
  for (let candidate of matches.slice(0, 20)) {
    candidate = candidate.replace(/[),.!;]+$/g, "");
    try {
      const url = new URL(
        candidate.toLowerCase().startsWith("www.")
          ? `https://${candidate}`
          : candidate,
      );
      urls.push(url);
    } catch {}
  }
  // Also inspect bare domains to stop advertising without a scheme.
  const bare =
    normalized.match(
      /(?<![@\w/])(?:[a-z0-9-]+\.)+(?:com|gg|io|net|org|me|link|ly|co|ru|xyz|pl)(?:\/[^\s<>"`]*)?/gi,
    ) ?? [];
  for (const raw of bare.slice(0, 20))
    try {
      const url = new URL(`https://${raw.replace(/[),.!;]+$/g, "")}`);
      if (
        !urls.some(
          (u) => u.hostname === url.hostname && u.pathname === url.pathname,
        )
      )
        urls.push(url);
    } catch {}
  return urls;
}
const gifHost = (host: string) =>
  ["tenor.com", "giphy.com"].some((h) => hostMatches(host, h));
const shorteners = [
  "bit.ly",
  "tinyurl.com",
  "t.co",
  "cutt.ly",
  "rb.gy",
  "shorturl.at",
  "is.gd",
  "v.gd",
  "rebrand.ly",
  "discord.gift",
];
export function linkViolation(content: string) {
  if (!config.moderation.antiLink.enabled) return null;
  if (containsDiscordInvite(content))
    return "Zaproszenia do innych serwerów Discord są zabronione.";
  for (const url of urlsIn(content)) {
    const host = url.hostname.replace(/^www\./, "");
    if (url.username || url.password)
      return "Ukrywanie adresów w linkach jest zabronione.";
    if (url.port && url.port !== "443" && url.port !== "80")
      return "Linki do niestandardowych portów są niedozwolone.";
    if (
      config.moderation.antiLink.blockedDomains.some((h) =>
        hostMatches(host, h),
      )
    )
      return "Reklamy i katalogi serwerów Discord są zabronione.";
    if (
      config.moderation.antiLink.blockShorteners &&
      shorteners.some((h) => hostMatches(host, h))
    )
      return "Skracacze i ukryte przekierowania są zabronione.";
    if (
      config.moderation.antiLink.strictExternalLinks &&
      !gifHost(host) &&
      !config.moderation.antiLink.allowedDomains.some((h) =>
        hostMatches(host, h),
      )
    )
      return "Ten adres nie znajduje się na liście dopuszczonych stron.";
  }
  return null;
}
export type MediaMessage = Pick<Message, "content" | "attachments" | "embeds">;
export function forbiddenMedia(m: MediaMessage, member: GuildMember) {
  if (!config.moderation.mediaGuard || isStaff(member)) return null;
  const photoRole = config.roles.levels.find((r) => r.level === 10)?.id;
  const gifRole = config.roles.levels.find((r) => r.level === 20)?.id;
  const gifs =
    m.attachments.some(
      (a) => a.contentType?.startsWith("image/gif") || /\.gif$/i.test(a.name),
    ) ||
    urlsIn(m.content).some(
      (u) => gifHost(u.hostname) || /\.gif(?:$|[/?])/i.test(u.pathname),
    ) ||
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
export function gifReference(
  url: URL,
): { provider: "tenor" | "giphy"; id: string } | null {
  if (hostMatches(url.hostname, "tenor.com")) {
    const match = url.pathname.match(
      /(?:view\/(?:[a-z0-9-]*-)?|\/)(\d{5,22})\/?$/i,
    );
    return match ? { provider: "tenor", id: match[1] } : null;
  }
  if (hostMatches(url.hostname, "giphy.com")) {
    const match = url.pathname.match(
      /(?:gifs\/(?:[a-z0-9-]*-)?|media\/|embed\/)([a-zA-Z0-9]+)(?:\/(?:giphy|\d+)\.(?:gif|webp|mp4))?\/?$/,
    );
    return match ? { provider: "giphy", id: match[1] } : null;
  }
  return null;
}
export function gifKey(reference: { provider: string; id: string }) {
  return `${reference.provider}:${reference.id}`;
}
export function approveGif(store: Store, url: string, now = Date.now()) {
  const reference = gifReference(new URL(url));
  assert(reference, "Nieprawidłowy link do GIF-a.");
  store.db
    .prepare("INSERT OR REPLACE INTO gif_approvals VALUES (?,?)")
    .run(gifKey(reference), now + 86400000);
}
function approved(store: Store, reference: { provider: string; id: string }) {
  return !!store.db
    .prepare("SELECT 1 FROM gif_approvals WHERE url=? AND expires_at>?")
    .get(gifKey(reference), Date.now());
}
export function deniedGif(
  store: Store,
  reference: { provider: string; id: string },
) {
  return !!store.db
    .prepare("SELECT 1 FROM gif_denials WHERE reference=?")
    .get(gifKey(reference));
}
export async function safeGif(url: URL, store: Store) {
  const reference = gifReference(url);
  if (!reference || deniedGif(store, reference)) return false;
  const { provider, id } = reference;
  if (provider === "tenor") {
    // Tenor's public API was discontinued on 2026-06-30. Only a moderator-reviewed ID is accepted.
    return !!store.db
      .prepare(
        "SELECT 1 FROM curated_gifs WHERE provider='tenor' AND id=? AND expires_at>?",
      )
      .get(id, Date.now());
  }
  if (approved(store, reference)) return true;
  assert(
    env.GIPHY_API_KEY,
    "Kontrola GIF-ów GIPHY wymaga GIPHY_API_KEY. Administracja musi uzupełnić konfigurację.",
  );
  const api = new URL(
    `https://api.giphy.com/v1/gifs/${encodeURIComponent(id)}`,
  );
  api.searchParams.set("api_key", env.GIPHY_API_KEY);
  api.searchParams.set("rating", "g");
  const data = await jsonRequest(api);
  if (data.data?.id !== id || data.data?.rating !== "g") return false;
  approveGif(store, url.href);
  return true;
}
export function curateTenor(
  store: Store,
  url: URL,
  label: string,
  moderator: string,
) {
  const reference = gifReference(url);
  assert(
    reference?.provider === "tenor" &&
      url.protocol === "https:" &&
      !url.username &&
      !url.password,
    "Podaj bezpośredni link HTTPS do konkretnego GIF-a Tenor. GIPHY jest kontrolowane automatycznie.",
  );
  const canonical = `https://tenor.com/view/${reference.id}`;
  store.db.transaction(() => {
    store.db
      .prepare("INSERT OR REPLACE INTO curated_gifs VALUES ('tenor',?,?,?,?,?)")
      .run(
        reference.id,
        label.slice(0, 100),
        canonical,
        moderator,
        Date.now() + 30 * 86400000,
      );
    store.db
      .prepare("DELETE FROM gif_denials WHERE reference=?")
      .run(gifKey(reference));
  })();
  return canonical;
}
export function blockGif(
  store: Store,
  url: URL,
  moderator: string,
  reason: string,
) {
  const reference = gifReference(url);
  assert(
    reference,
    "Podaj bezpośredni link do konkretnego GIF-a Tenor lub GIPHY.",
  );
  store.db.transaction(() => {
    store.db
      .prepare("INSERT OR REPLACE INTO gif_denials VALUES (?,?,?)")
      .run(gifKey(reference), moderator, reason);
    store.db
      .prepare("DELETE FROM gif_approvals WHERE url=?")
      .run(gifKey(reference));
    store.db
      .prepare("DELETE FROM curated_gifs WHERE provider=? AND id=?")
      .run(reference.provider, reference.id);
  })();
  return reference;
}
export async function gifViolation(
  m: MediaMessage,
  store: Store,
): Promise<{ reason: string; points: number } | null> {
  const attachmentGif = m.attachments.some(
    (a) => a.contentType?.startsWith("image/gif") || /\.gif$/i.test(a.name),
  );
  const allUrls = urlsIn(m.content);
  const urls = allUrls.filter(
    (u) => gifHost(u.hostname) || /\.gif$/i.test(u.pathname),
  );
  const hydratedGif = m.embeds.some((e) => e.data.type === "gifv");
  if (!attachmentGif && !urls.length && !hydratedGif) return null;
  if (attachmentGif)
    return {
      reason:
        "Własne pliki GIF wymagają ręcznej moderacji. Użyj sprawdzonego GIF-a z Tenor lub GIPHY przez /gif.",
      points: 0,
    };
  if (!urls.length)
    return {
      reason: "Ten GIF nie pochodzi ze sprawdzonego źródła. Użyj /gif.",
      points: 0,
    };
  if (urls.length > 3)
    return {
      reason: "W jednej wiadomości możesz wysłać maksymalnie 3 GIF-y.",
      points: 1,
    };
  for (const url of urls) {
    if (!gifHost(url.hostname))
      return {
        reason: "Dozwolone źródła GIF-ów: Tenor oraz GIPHY.",
        points: 1,
      };
    if (config.moderation.antiLink.strictGifSafety) {
      try {
        if (!(await safeGif(url, store)))
          return {
            reason:
              gifReference(url)?.provider === "tenor"
                ? "Ten GIF Tenor nie jest zatwierdzony przez administrację. Wybierz GIF przez /gif lub zgłoś go moderatorowi."
                : "Nie udało się potwierdzić klasyfikacji G tego GIF-a. Wybierz inny przez /gif.",
            points: 0,
          };
      } catch (err) {
        return {
          reason:
            err instanceof UserError
              ? err.message
              : "Kontrola GIF-ów jest chwilowo niedostępna. Spróbuj później.",
          points: 0,
        };
      }
    }
  }
  return null;
}
export async function searchGifs(
  query: string,
  provider: "tenor" | "giphy",
  store: Store,
) {
  assert(
    query.trim().length >= 2 && query.length <= 80,
    "Wyszukiwanie GIF: 2–80 znaków.",
  );
  if (provider === "tenor") {
    return store.db
      .prepare(
        "SELECT label AS name,url FROM curated_gifs WHERE provider='tenor' AND expires_at>? AND (label LIKE ? OR id LIKE ?) ORDER BY label LIMIT 5",
      )
      .all(Date.now(), `%${query}%`, `%${query}%`) as {
      name: string;
      url: string;
    }[];
  }
  assert(
    env.GIPHY_API_KEY,
    "Administracja musi ustawić GIPHY_API_KEY, aby włączyć bezpieczne wyszukiwanie GIF-ów.",
  );
  const url = new URL("https://api.giphy.com/v1/gifs/search");
  url.search = new URLSearchParams({
    api_key: env.GIPHY_API_KEY,
    q: query,
    rating: "g",
    limit: "5",
    lang: "pl",
  }).toString();
  const data = await jsonRequest(url);
  const results = (data.data ?? [])
    .filter(
      (p: any) =>
        p.rating === "g" &&
        /^[A-Za-z0-9]+$/.test(p.id) &&
        !deniedGif(store, { provider: "giphy", id: p.id }),
    )
    .map((p: any) => ({
      name: String(p.title || "GIF").slice(0, 100),
      url: `https://giphy.com/gifs/${p.id}`,
    }));
  for (const r of results) approveGif(store, r.url);
  return results as { name: string; url: string }[];
}
