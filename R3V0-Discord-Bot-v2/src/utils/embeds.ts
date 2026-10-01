import { EmbedBuilder, type APIEmbed } from "discord.js";
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
export function boundedEmbed(e: EmbedBuilder): APIEmbed {
  const data = structuredClone(e.data) as APIEmbed;
  if (data.title) data.title = data.title.slice(0, 256);
  if (data.description) data.description = data.description.slice(0, 4096);
  if (data.footer) data.footer.text = data.footer.text.slice(0, 2048);
  if (data.author) data.author.name = data.author.name.slice(0, 256);
  let left =
    6000 -
    (data.title?.length ?? 0) -
    (data.description?.length ?? 0) -
    (data.footer?.text.length ?? 0) -
    (data.author?.name.length ?? 0);
  const fields = [];
  for (const field of data.fields ?? []) {
    if (left < 4 || fields.length >= 25) break;
    const name = field.name.slice(0, Math.min(256, left - 1)) || "Informacja";
    left -= name.length;
    const value = field.value.slice(0, Math.min(1024, left)) || "—";
    left -= value.length;
    fields.push({ ...field, name, value });
  }
  data.fields = fields;
  return data;
}
