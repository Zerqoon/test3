import test from "node:test";
import assert from "node:assert/strict";
import {
  Collection,
  GuildMember,
  type Message,
  type Attachment,
} from "discord.js";
import { forbiddenMedia } from "../src/events/messages.js";
import { config } from "../src/config.js";
function member(roleIds: string[] = []) {
  return {
    id: "user",
    guild: { ownerId: "owner" },
    roles: { cache: new Collection(roleIds.map((r) => [r, {}])) },
  } as unknown as GuildMember;
}
function message(
  content: string,
  attachment?: { name: string; contentType: string },
) {
  return {
    content,
    attachments: new Collection(
      attachment ? [["file", attachment as Attachment]] : [],
    ),
    embeds: [],
  } as Pick<Message, "attachments" | "content" | "embeds">;
}
test("Zdjęcia wymagają roli 10, a pliki GIF i Tenor roli 20; administracja ma wyjątek", () => {
  const photo = message("", { name: "cat.png", contentType: "image/png" });
  const gif = message("", { name: "cat.gif", contentType: "image/gif" });
  const ten = message("https://tenor.com/view/cat-example");
  const r10 = config.roles.levels.find((r) => r.level === 10)!.id;
  const r20 = config.roles.levels.find((r) => r.level === 20)!.id;
  assert.match(forbiddenMedia(photo, member())!, /10/);
  assert.equal(forbiddenMedia(photo, member([r10])), null);
  assert.match(forbiddenMedia(gif, member([r10]))!, /20/);
  assert.match(forbiddenMedia(ten, member([r10]))!, /20/);
  assert.equal(forbiddenMedia(gif, member([r10, r20])), null);
  assert.equal(forbiddenMedia(gif, member([config.roles.moderator])), null);
});
