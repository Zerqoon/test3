import { EmbedBuilder } from "discord.js";
import { config } from "../config.js";
export function embed(
  title: string,
  description?: string,
  color = config.brand.accent,
) {
  const e = new EmbedBuilder()
    .setColor(color as `#${string}`)
    .setTitle(title.slice(0, 256))
    .setFooter({ text: config.brand.footer })
    .setTimestamp();
  if (description) e.setDescription(description.slice(0, 4096));
  return e;
}
