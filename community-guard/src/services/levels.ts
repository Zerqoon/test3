import { createHash } from "node:crypto";
import { config } from "../config.js";
export function xpForLevel(level: number) {
  return (
    config.leveling.curveQuadratic * level * level +
    config.leveling.curveLinear * level
  );
}
export function levelForXp(xp: number) {
  let low = 0;
  let high = config.leveling.maxLevel;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (xpForLevel(mid) <= xp) low = mid;
    else high = mid - 1;
  }
  return low;
}
export function progressForXp(xp: number) {
  const level = levelForXp(xp);
  const floor = xpForLevel(level);
  const next =
    level >= config.leveling.maxLevel ? floor : xpForLevel(level + 1);
  return {
    level,
    floor,
    next,
    current: xp - floor,
    needed: Math.max(0, next - floor),
    ratio: next === floor ? 1 : Math.min(1, (xp - floor) / (next - floor)),
  };
}
export function normalizeMessage(content: string) {
  return content
    .normalize("NFKC")
    .toLowerCase()
    .replace(/https?:\/\/\S+|<[^>]*>/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}
export function messageHash(content: string) {
  return createHash("sha256").update(content).digest("hex").slice(0, 24);
}
export function isMeaningful(content: string) {
  const normalized = normalizeMessage(content);
  return (
    normalized.replace(/\s/g, "").length >= config.leveling.minCharacters &&
    new Set(normalized.replace(/\s/g, "")).size >= 5
  );
}
