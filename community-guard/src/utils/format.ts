import { escapeMarkdown } from "discord.js";
export const number = (n: number) => new Intl.NumberFormat("pl-PL").format(n);
export const shortNumber = (n: number) =>
  new Intl.NumberFormat("pl-PL", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(n);
export const clean = (text: string, max = 1000) =>
  escapeMarkdown(text).slice(0, max) || "—";
export const stamp = (ms: number, style = "R") =>
  `<t:${Math.floor(ms / 1000)}:${style}>`;
export function duration(ms: number) {
  const minutes = Math.max(1, Math.ceil(ms / 60000));
  return minutes >= 60
    ? `${Math.floor(minutes / 60)} godz. ${minutes % 60} min`
    : `${minutes} min`;
}
export function dayKey(ms: number) {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Warsaw",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(ms);
}
