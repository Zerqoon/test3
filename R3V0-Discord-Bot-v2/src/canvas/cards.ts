import {
  createCanvas,
  GlobalFonts,
  loadImage,
  type SKRSContext2D,
  type Image,
} from "@napi-rs/canvas";
import { resolve } from "node:path";
import { config, shop } from "../config.js";
import type { Profile } from "../services/store.js";
import { progressForXp } from "../services/levels.js";
import { number, shortNumber, duration } from "../utils/format.js";
import { logger } from "../utils/logger.js";

GlobalFonts.registerFromPath(
  resolve("assets/fonts/Community-Regular.ttf"),
  "Community",
);
GlobalFonts.registerFromPath(
  resolve("assets/fonts/Community-Bold.ttf"),
  "Community",
);
const accent = config.brand.accent;
const muted = "#9995B0";
const avatars = new Map<string, { image: Image; expires: number }>();
const pending = new Map<string, Promise<Image | undefined>>();
let rendering = 0;
const waiters: (() => void)[] = [];

async function avatar(url?: string): Promise<Image | undefined> {
  if (!url) return;
  const parsed = new URL(url);
  if (
    parsed.protocol !== "https:" ||
    !["cdn.discordapp.com", "media.discordapp.net"].includes(parsed.hostname)
  )
    return;
  const cached = avatars.get(url);
  if (cached && cached.expires > Date.now()) return cached.image;
  if (pending.has(url)) return pending.get(url);
  const task = (async () => {
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(5000),
        redirect: "error",
      });
      if (!res.ok || !res.body) return;
      const reader = res.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      while (true) {
        const r = await reader.read();
        if (r.done) break;
        size += r.value.byteLength;
        if (size > 3e6) {
          await reader.cancel();
          return;
        }
        chunks.push(r.value);
      }
      const img = await loadImage(Buffer.concat(chunks));
      if (img.width > 2048 || img.height > 2048) return;
      if (avatars.size >= 80) avatars.delete(avatars.keys().next().value!);
      avatars.set(url, { image: img, expires: Date.now() + 900000 });
      return img;
    } catch {
      return;
    } finally {
      pending.delete(url);
    }
  })();
  pending.set(url, task);
  return task;
}
function box(
  ctx: SKRSContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  radius = 20,
  fill = "#181527",
) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, radius);
  ctx.fillStyle = fill;
  ctx.fill();
}
function text(
  ctx: SKRSContext2D,
  value: string,
  x: number,
  y: number,
  size = 24,
  color = "#F6F3FF",
  weight = 400,
  maxWidth?: number,
) {
  ctx.font = `${weight} ${size}px Community`;
  ctx.fillStyle = color;
  let fitted = value;
  if (maxWidth) {
    const parts = [
      ...new Intl.Segmenter("pl", { granularity: "grapheme" }).segment(value),
    ].map((p) => p.segment);
    while (ctx.measureText(fitted).width > maxWidth && parts.length > 0) {
      parts.pop();
      fitted = parts.join("").trimEnd() + "…";
    }
  }
  ctx.fillText(fitted, x, y);
}
function diamond(
  ctx: SKRSContext2D,
  x: number,
  y: number,
  size: number,
  color = accent,
) {
  ctx.beginPath();
  ctx.moveTo(x, y - size);
  ctx.lineTo(x + size, y);
  ctx.lineTo(x, y + size);
  ctx.lineTo(x - size, y);
  ctx.closePath();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x - size, y);
  ctx.lineTo(x + size, y);
  ctx.moveTo(x, y - size);
  ctx.lineTo(x, y + size);
  ctx.strokeStyle = `${color}88`;
  ctx.stroke();
}
function background(ctx: SKRSContext2D, width: number, height: number) {
  const bg = ctx.createLinearGradient(0, 0, width, height);
  bg.addColorStop(0, "#171225");
  bg.addColorStop(0.6, "#0D0C17");
  bg.addColorStop(1, "#1C1030");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);
  const glow = ctx.createRadialGradient(width - 70, 0, 0, width - 70, 0, 500);
  glow.addColorStop(0, `${accent}28`);
  glow.addColorStop(1, `${accent}00`);
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = "#FFFFFF08";
  ctx.lineWidth = 1;
  for (let x = 0; x < width; x += 60) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }
  for (let y = 0; y < height; y += 60) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }
  ctx.strokeStyle = `${accent}30`;
  ctx.beginPath();
  ctx.roundRect(18, 18, width - 36, height - 36, 28);
  ctx.stroke();
  diamond(ctx, 66, 64, 17);
  text(ctx, config.brand.name.toUpperCase(), 101, 73, 24, "#EDE8FA", 700, 700);
  ctx.textAlign = "right";
  text(ctx, "COMMUNITY / 01", width - 52, 70, 16, muted, 700);
  ctx.textAlign = "left";
  box(ctx, 50, height - 3, width - 100, 3, 1, accent);
}
async function portrait(
  ctx: SKRSContext2D,
  name: string,
  url: string | undefined,
  x: number,
  y: number,
  size: number,
) {
  const img = await avatar(url);
  const gradient = ctx.createLinearGradient(x, y, x + size, y + size);
  gradient.addColorStop(0, accent);
  gradient.addColorStop(1, "#F0ABFC");
  ctx.beginPath();
  ctx.arc(x + size / 2, y + size / 2, size / 2 + 7, 0, Math.PI * 2);
  ctx.fillStyle = gradient;
  ctx.fill();
  ctx.save();
  ctx.beginPath();
  ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = "#272039";
  ctx.fillRect(x, y, size, size);
  if (img) {
    const s = Math.min(img.width, img.height);
    ctx.drawImage(
      img,
      (img.width - s) / 2,
      (img.height - s) / 2,
      s,
      s,
      x,
      y,
      size,
      size,
    );
  } else {
    ctx.textAlign = "center";
    text(
      ctx,
      Array.from(name)[0]?.toUpperCase() ?? "?",
      x + size / 2,
      y + size * 0.67,
      size * 0.55,
      "#E9D5FF",
      700,
    );
    ctx.textAlign = "left";
  }
  ctx.restore();
}
export interface CardInput {
  kind: "rank" | "profile" | "levelup" | "wallet" | "welcome";
  profile: Profile;
  rank: number;
  avatarUrl?: string;
  subtitle?: string;
  reward?: number;
  memberCount?: number;
  boostMultiplier?: number;
  robloxName?: string;
  quarantineUntil?: number;
  now?: number;
}
async function draw(input: CardInput) {
  const { kind, profile: p } = input;
  const width = 1200;
  const height =
    kind === "profile"
      ? 770
      : kind === "rank"
        ? 580
        : kind === "levelup"
          ? 470
          : kind === "wallet"
            ? 520
            : 400;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  background(ctx, width, height);
  const pr = progressForXp(p.xp);
  const title = shop.find((i) => i.kind === "title" && i.id === p.title);
  if (kind === "profile") {
    const now = input.now ?? Date.now();
    const boost =
      input.boostMultiplier ??
      (p.xp_boost_until > now ? p.xp_boost_multiplier : 1);
    const name = input.robloxName
      ? p.name.replace(` (@${input.robloxName.toLowerCase()})`, "")
      : p.name;
    box(ctx, 52, 108, 290, 540, 26, "#151E32");
    await portrait(ctx, name, input.avatarUrl, 112, 142, 170);
    text(ctx, name, 76, 366, 30, "#FFFFFF", 700, 243);
    text(ctx, `RANKING #${number(input.rank)}`, 76, 406, 17, accent, 700);
    box(ctx, 74, 438, 245, 80, 15, "#0C1323");
    text(ctx, "KONTO ROBLOX", 91, 466, 12, muted, 700);
    text(
      ctx,
      input.robloxName ? `@${input.robloxName}` : "Jeszcze niepołączone",
      91,
      496,
      19,
      input.robloxName ? accent : "#A0AEC8",
      700,
      210,
    );
    text(
      ctx,
      input.quarantineUntil && input.quarantineUntil > now
        ? "KWARANTANNA"
        : input.robloxName
          ? "ZWERYFIKOWANY"
          : "CZŁONEK SPOŁECZNOŚCI",
      76,
      566,
      15,
      input.quarantineUntil ? "#FBBF24" : accent,
      700,
      235,
    );
    text(ctx, "PISANIE + VOICE", 76, 608, 13, muted, 700);
    text(ctx, "POZIOM AKTYWNOŚCI", 378, 147, 17, muted, 700);
    text(
      ctx,
      String(pr.level).padStart(2, "0"),
      370,
      271,
      pr.level >= 100 ? 92 : 117,
      "#FFFFFF",
      700,
    );
    const tier =
      pr.level >= 50
        ? "LEGENDA"
        : pr.level >= 30
          ? "WETERAN"
          : pr.level >= 20
            ? "GIF-Y ODBLOKOWANE"
            : pr.level >= 10
              ? "ZDJĘCIA ODBLOKOWANE"
              : "POCZĄTEK DROGI";
    box(ctx, 585, 202, 328, 47, 22, "#153147");
    text(ctx, tier, 606, 233, 17, accent, 700, 280);
    text(
      ctx,
      pr.needed
        ? `${number(pr.current)} / ${number(pr.needed)} XP`
        : "MAKSYMALNY POZIOM",
      378,
      315,
      22,
      "#E4EFFF",
      700,
    );
    ctx.textAlign = "right";
    text(ctx, `${Math.floor(pr.ratio * 100)}%`, 1138, 315, 20, accent, 700);
    ctx.textAlign = "left";
    box(ctx, 378, 336, 758, 16, 8, "#212B42");
    if (pr.ratio > 0) {
      const grad = ctx.createLinearGradient(378, 0, 1136, 0);
      grad.addColorStop(0, accent);
      grad.addColorStop(1, "#A9F1FF");
      ctx.beginPath();
      ctx.roundRect(378, 336, Math.max(16, 758 * pr.ratio), 16, 8);
      ctx.fillStyle = grad;
      ctx.fill();
    }
    const stats = [
      [
        "XP ZA PISANIE",
        number(p.text_xp),
        `${number(p.messages)} nagrodzonych wiadomości`,
      ],
      [
        "XP ZA VOICE",
        number(p.voice_xp),
        `${Math.floor(p.voice_seconds / 3600)} h ${Math.floor((p.voice_seconds % 3600) / 60)} min aktywnego voice`,
      ],
      [
        "ŁĄCZNE XP",
        number(p.xp),
        pr.needed
          ? `${number(pr.next - p.xp)} XP do poziomu ${pr.level + 1}`
          : "Osiągnięto maksimum",
      ],
      [
        "MNOŻNIK XP",
        `×${boost}`,
        p.xp_boost_until > now
          ? `Booster: jeszcze ${duration(p.xp_boost_until - now)}`
          : "Pisanie oraz voice",
      ],
    ];
    stats.forEach(([label, value, detail], idx) => {
      const x = 378 + (idx % 2) * 388;
      const y = 381 + Math.floor(idx / 2) * 130;
      box(ctx, x, y, 370, 110, 18, "#141E31");
      text(ctx, label, x + 21, y + 29, 12, muted, 700);
      text(
        ctx,
        value,
        x + 21,
        y + 69,
        31,
        idx === 3 ? accent : "#FFFFFF",
        700,
        328,
      );
      text(ctx, detail, x + 21, y + 96, 13, muted, 400, 328);
    });
    const used = p.day_base_xp;
    const ratio = Math.min(1, used / config.leveling.dailyCap);
    text(
      ctx,
      `DZIENNY LIMIT BAZOWEGO XP: ${number(used)} / ${number(config.leveling.dailyCap)}`,
      378,
      648,
      14,
      muted,
      700,
    );
    box(ctx, 378, 668, 758, 8, 4, "#212B42");
    if (ratio > 0)
      box(ctx, 378, 668, Math.max(8, 758 * ratio), 8, 4, "#7491B3");
    box(ctx, 52, 701, 1084, 41, 12, "#151E32");
    text(
      ctx,
      `${config.brand.currency.toUpperCase()}: ${number(p.balance)}`,
      74,
      727,
      15,
      "#C8D8ED",
      700,
      515,
    );
    ctx.textAlign = "right";
    text(ctx, "R3V0  •  TWÓJ PROFIL AKTYWNOŚCI", 1117, 727, 14, accent, 700);
    ctx.textAlign = "left";
  } else if (kind === "rank") {
    box(ctx, 52, 108, 284, 370, 26, "#201A31");
    await portrait(ctx, p.name, input.avatarUrl, 108, 141, 172);
    text(
      ctx,
      input.robloxName
        ? p.name.replace(` (@${input.robloxName.toLowerCase()})`, "")
        : p.name,
      77,
      354,
      27,
      "#FFFFFF",
      700,
      230,
    );
    text(
      ctx,
      input.robloxName
        ? `@${input.robloxName}`
        : title?.kind === "title"
          ? title.label
          : "CZŁONEK SPOŁECZNOŚCI",
      77,
      393,
      15,
      title?.kind === "title" ? title.color : accent,
      700,
      234,
    );
    text(ctx, `MIEJSCE #${number(input.rank)}`, 77, 438, 18, muted, 700);
    text(ctx, "POZIOM AKTYWNOŚCI", 377, 148, 17, muted, 700);
    text(
      ctx,
      String(pr.level).padStart(2, "0"),
      370,
      275,
      pr.level >= 100 ? 88 : 116,
      "#FFFFFF",
      700,
    );
    box(ctx, 561, 210, 238, 48, 24, "#28203C");
    text(
      ctx,
      pr.level >= 50
        ? "LEGENDA SERWERA"
        : pr.level >= 30
          ? "WETERAN SERWERA"
          : pr.level >= 20
            ? "DOSTĘP DO GIF-ÓW"
            : pr.level >= 10
              ? "DOSTĘP DO ZDJĘĆ"
              : "TWOJA DROGA",
      580,
      241,
      17,
      accent,
      700,
    );
    text(
      ctx,
      pr.needed
        ? `${number(pr.current)} / ${number(pr.needed)} XP`
        : "MAKSYMALNY POZIOM",
      377,
      321,
      24,
      "#E9E2F4",
      700,
    );
    box(ctx, 377, 346, 756, 18, 9, "#292234");
    if (pr.ratio > 0) {
      const grad = ctx.createLinearGradient(377, 0, 1133, 0);
      grad.addColorStop(0, accent);
      grad.addColorStop(1, "#E0AAFF");
      ctx.beginPath();
      ctx.roundRect(377, 346, Math.max(18, pr.ratio * 756), 18, 9);
      ctx.fillStyle = grad;
      ctx.fill();
    }
    text(
      ctx,
      pr.needed
        ? `Do poziomu ${pr.level + 1}: ${number(pr.next - p.xp)} XP`
        : "Osiągnięto szczyt. Gratulacje!",
      377,
      401,
      20,
      muted,
    );
    text(ctx, `Łącznie zdobyte: ${number(p.xp)} XP`, 377, 444, 18, muted);
    const stats = [
      [
        "PISANIE / VOICE XP",
        `${shortNumber(p.text_xp)} / ${shortNumber(p.voice_xp)}`,
      ],
      [
        "AKTYWNY VOICE",
        `${Math.floor(p.voice_seconds / 3600)} h ${Math.floor((p.voice_seconds % 3600) / 60)} min`,
      ],
      [
        "DZIŚ / BAZOWY LIMIT XP",
        `${p.day_base_xp} / ${config.leveling.dailyCap}`,
      ],
    ];
    stats.forEach(([label, value], i) => {
      const x = 52 + i * 370;
      box(ctx, x, 496, 354, 54, 15, "#201A31");
      text(ctx, label, x + 18, 520, 12, muted, 700);
      text(ctx, value, x + 18, 541, 19, "#F6F3FF", 700);
    });
  } else if (kind === "levelup") {
    await portrait(ctx, p.name, input.avatarUrl, 70, 142, 172);
    text(ctx, "NOWY POZIOM", 308, 158, 22, accent, 700);
    text(
      ctx,
      String(pr.level).padStart(2, "0"),
      296,
      294,
      pr.level >= 100 ? 90 : 125,
      "#FFFFFF",
      700,
    );
    text(ctx, p.name, 506, 245, 39, "#FFFFFF", 700, 613);
    text(ctx, "Twoja aktywność ma znaczenie.", 508, 286, 23, muted);
    box(ctx, 65, 345, 1070, 77, 21, "#251B38");
    text(
      ctx,
      input.subtitle ?? "Kolejny krok za Tobą. Tak trzymaj!",
      94,
      392,
      24,
      "#EBDFFF",
      400,
      1000,
    );
    diamond(ctx, 1052, 178, 31);
    diamond(ctx, 1110, 261, 14);
  } else if (kind === "wallet") {
    await portrait(ctx, p.name, input.avatarUrl, 70, 126, 88);
    text(ctx, p.name, 193, 165, 28, "#FFFFFF", 700, 870);
    text(ctx, input.subtitle ?? "TWÓJ PORTFEL", 193, 199, 17, accent, 700, 870);
    text(ctx, number(p.balance), 71, 326, 78, "#FFFFFF", 700, 1010);
    text(ctx, config.brand.currency.toUpperCase(), 77, 366, 19, muted, 700);
    diamond(ctx, 1050, 297, 51);
    box(ctx, 65, 400, 1070, 74, 21, "#251B38");
    text(
      ctx,
      input.reward
        ? `+${number(input.reward)} ${config.brand.currency}  •  Wypłata zapisana`
        : `Seria daily: ${p.streak} / ${config.economy.dailyMaxStreak}  •  Ranking: #${input.rank}`,
      94,
      446,
      24,
      "#EBDFFF",
      400,
      1000,
    );
  } else {
    await portrait(ctx, p.name, input.avatarUrl, 69, 129, 150);
    text(ctx, "WITAJ W SPOŁECZNOŚCI", 273, 160, 20, accent, 700);
    text(ctx, p.name, 271, 220, 43, "#FFFFFF", 700, 852);
    text(
      ctx,
      "Nowe rozmowy. Nowe znajomości. Twój kolejny rozdział.",
      274,
      266,
      23,
      muted,
      400,
      850,
    );
    box(ctx, 64, 315, 1070, 44, 16, "#251B38");
    text(
      ctx,
      `COMMUNITY  •  Członkowie: ${number(input.memberCount ?? 0)}  •  Miło Cię widzieć!`,
      87,
      344,
      18,
      "#D7C9EF",
    );
  }
  return canvas.encode("png");
}
export async function renderCard(input: CardInput) {
  if (waiters.length >= 30)
    throw new Error("Canvas zajęty; dostępna jest odpowiedź tekstowa.");
  if (rendering >= 2)
    await new Promise<void>((resolve) => waiters.push(resolve));
  else rendering++;
  try {
    return await draw(input);
  } catch (err) {
    logger.warn({ err }, "Nie udało się wygenerować karty Canvas");
    throw err;
  } finally {
    const next = waiters.shift();
    if (next) next();
    else rendering--;
  }
}
