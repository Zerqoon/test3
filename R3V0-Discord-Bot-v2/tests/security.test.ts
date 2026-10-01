import test from "node:test";
import assert from "node:assert/strict";
import {
  containsDiscordInvite,
  linkViolation,
  urlsIn,
  gifReference,
  safeGif,
  searchGifs,
  curateTenor,
  blockGif,
} from "../src/services/media.js";
import {
  verificationNickname,
  ownsChallenge,
  RobloxVerification,
} from "../src/services/verification.js";
import { Store } from "../src/services/store.js";
import { config, env } from "../src/config.js";
import type { CoreContext } from "../src/types.js";
import type { GuildMember } from "discord.js";
import { Collection } from "discord.js";

test("Antylink wykrywa zaproszenia, maskowanie, Unicode, procenty i edytowane warianty", () => {
  for (const value of [
    "discord.gg/test",
    "https://discord.com/invite/abc",
    "discordapp.com/invite/abc",
    "d i s c o r d . g g / abc",
    "https://discord[.]gg/a",
    "https://dіscоrd.gg/a",
    "discord\u200B.gg/a",
    "https://discord%2Egg%2Fa",
    "[Roblox](https://discord.gg/a)",
    "https://www.roblox.com/?next=https%253A%252F%252Fdiscord.gg%252Fa",
  ])
    assert.equal(containsDiscordInvite(value), true, value);
  assert.equal(
    containsDiscordInvite("Rozmawiamy o Discord i naszych nickach."),
    false,
  );
  assert.equal(
    containsDiscordInvite("https://discord.com/developers/docs"),
    false,
  );
});
test("Lista domen nie akceptuje podszywania się pod host ani skracaczy", () => {
  assert.equal(linkViolation("https://www.roblox.com/users/1/profile"), null);
  for (const value of [
    "https://roblox.com.evil.com/a",
    "https://www.roblox.com@evil.com/a",
    "https://tinyurl.com/abc",
    "https://example.xyz/a",
    "https://disboard.org/server/1",
  ])
    assert.ok(linkViolation(value), value);
  assert.ok(linkViolation("https://github.com/?target=discord.gg/abc"));
});
test("Identyfikatory GIPHY zachowują wielkość liter, a podrobione Tenor są odrzucane", () => {
  const url = urlsIn("https://giphy.com/gifs/cat-xT4uQulxzV39haRFjG")[0];
  assert.equal(gifReference(url)?.id, "xT4uQulxzV39haRFjG");
  assert.equal(
    gifReference(new URL("https://tenor.com/view/cat-12345678"))?.id,
    "12345678",
  );
  assert.equal(
    gifReference(new URL("https://tenor.com.evil.com/view/cat-12345678")),
    null,
  );
});
test("Pseudonim bierze nazwę wyświetlaną Discord, zachowuje @Roblox i limit 32", () => {
  assert.equal(
    verificationNickname("Zerqon", "B3sttiee"),
    "Zerqon (@b3sttiee)",
  );
  const result = verificationNickname(
    "👨‍👩‍👧‍👦 Łąka Bardzo Bardzo Długa",
    "TwentyCharacterName_",
  );
  assert.ok(result.length <= 32);
  assert.ok(result.endsWith(" (@twentycharactername_)"));
  assert.equal(
    ownsChallenge("Kod R3V0-ABC123 proszę sprawdzić", "R3V0-ABC123"),
    true,
  );
  assert.equal(ownsChallenge("R3V0-ABC123FAKE", "R3V0-ABC123"), false);
});
test("Weryfikacja nie wystarcza bez kodu; prawdziwe potwierdzenie zostaje mimo blokady nicku Ownera", async () => {
  const store = new Store(":memory:");
  const original = globalThis.fetch;
  let description = "";
  const guild = "1540000000000000000",
    id = "1540000000000000001";
  const member = {
    id,
    guild: { id: guild },
    nickname: "Zerqon",
    displayName: "Zerqon",
    user: { username: "zerqoon", globalName: "Zerqon" },
    pending: false,
    manageable: false,
    roles: {
      cache: new Collection([
        [config.roles.community, {}],
        [config.roles.owner, {}],
      ]),
    },
  } as unknown as GuildMember;
  const core = {
    store,
    client: { user: { id: "bot" } },
    logs: { audit: () => {} },
    startedAt: Date.now(),
  } as unknown as CoreContext;
  const verify = new RobloxVerification(core);
  globalThis.fetch = async (input) => {
    const url = String(input);
    return new Response(
      JSON.stringify(
        url.includes("usernames/users")
          ? { data: [{ id: 12345678, name: "B3sttiee" }] }
          : {
              id: 12345678,
              name: "B3sttiee",
              displayName: "Other Display Name",
              description,
              created: "2020-01-01T00:00:00Z",
              isBanned: false,
            },
      ),
      { status: 200 },
    );
  };
  try {
    await verify.begin(member, "B3sttiee");
    await assert.rejects(() => verify.check(member), /Kod nie jest/);
    assert.equal(store.link(guild, id), undefined);
    const challenge = store.challenge(guild, id)!;
    description = challenge.code;
    store.db.prepare("UPDATE verification_challenges SET last_check=0").run();
    const reply = await verify.check(member);
    assert.equal(store.link(guild, id)?.nickname, "Zerqon (@b3sttiee)");
    assert.equal(store.link(guild, id)?.discord_name, "Zerqon");
    assert.match(reply.embeds[0].data.description!, /Discord nie pozwala/);
    assert.equal(store.challenge(guild, id), undefined);
  } finally {
    globalThis.fetch = original;
    store.close();
  }
});
test("GIPHY odrzuca rating R, a Tenor wymaga zatwierdzenia bez wywołań wyłączonego API", async () => {
  const store = new Store(":memory:");
  const original = globalThis.fetch;
  const oldG = env.GIPHY_API_KEY;
  env.GIPHY_API_KEY = "test";
  const requests: string[] = [];
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    requests.push(url.href);
    return new Response(
      JSON.stringify(
        url.hostname === "api.giphy.com"
          ? { data: { id: "ABCxyz", rating: "r" } }
          : url.pathname.endsWith("posts")
            ? {
                results: [
                  { id: "12345678", content_description: "Unsafe GIF" },
                ],
              }
            : { results: [] },
      ),
      { status: 200 },
    );
  };
  try {
    assert.equal(
      await safeGif(new URL("https://giphy.com/gifs/ABCxyz"), store),
      false,
    );
    assert.equal(
      await safeGif(new URL("https://tenor.com/view/12345678"), store),
      false,
    );
    assert.equal(requests.length, 1);
    curateTenor(
      store,
      new URL("https://tenor.com/view/cat-12345678"),
      "Kot",
      "mod",
    );
    assert.equal(
      await safeGif(new URL("https://tenor.com/view/12345678"), store),
      true,
    );
    blockGif(
      store,
      new URL("https://tenor.com/view/12345678"),
      "mod",
      "Cofnięta akceptacja",
    );
    assert.equal(
      await safeGif(new URL("https://tenor.com/view/12345678"), store),
      false,
    );
    assert.ok(
      requests.some((url) => new URL(url).searchParams.get("rating") === "g"),
    );
    assert.equal(
      (
        store.db.prepare("SELECT COUNT(*) AS n FROM gif_approvals").get() as {
          n: number;
        }
      ).n,
      0,
    );
  } finally {
    globalThis.fetch = original;
    env.GIPHY_API_KEY = oldG;
    store.close();
  }
});
test("Wyszukiwanie ścisłe dopuszcza tylko wyniki klasy G i korzysta z zapisanej kontroli bez ponownego API", async () => {
  const store = new Store(":memory:");
  const original = globalThis.fetch,
    old = env.GIPHY_API_KEY;
  env.GIPHY_API_KEY = "test";
  let called = 0;
  globalThis.fetch = async () => {
    called++;
    return new Response(
      JSON.stringify({
        data: [
          { id: "CaseSensitiveID", rating: "g", title: "Cat" },
          { id: "bad", rating: "r", title: "Bad" },
        ],
      }),
      { status: 200 },
    );
  };
  try {
    const results = await searchGifs("cat", "giphy", store);
    assert.equal(results.length, 1);
    assert.equal(await safeGif(new URL(results[0].url), store), true);
    assert.equal(called, 1);
  } finally {
    globalThis.fetch = original;
    env.GIPHY_API_KEY = old;
    store.close();
  }
});

test("Edycja na kanale logów także podlega antyzaproszeniom", async () => {
  const { messageEvents } = await import("../src/events/messages.js");
  const { Events } = await import("discord.js");
  const guildId = "1540000000000000000";
  const oldGuild = env.DISCORD_GUILD_ID;
  env.DISCORD_GUILD_ID = guildId;
  const s = new Store(":memory:");
  const handlers = new Map<string, Function>();
  let deleted = false;
  const user = {
    id: "1540000000000000001",
    bot: false,
    tag: "User",
    createdTimestamp: Date.now() - 864000000,
    displayAvatarURL: () => "https://cdn.discordapp.com/embed/avatars/0.png",
    send: async () => {},
  };
  const guild = { id: guildId, ownerId: "owner" };
  const member = {
    id: user.id,
    user,
    guild,
    pending: false,
    roles: { cache: new Collection() },
    moderatable: true,
    send: async () => {},
  };
  const message = {
    id: "1550000000000000000",
    guildId,
    channelId: config.channels.generalLogs,
    partial: false,
    guild,
    author: user,
    member,
    content: "discord.gg/evil",
    attachments: new Collection(),
    embeds: [],
    delete: async () => {
      deleted = true;
    },
    channel: {
      isSendable: () => true,
      send: async () => ({ delete: async () => {} }),
    },
  };
  const ctx = {
    store: s,
    client: {
      user: { id: "bot" },
      on: (event: string, fn: Function) => handlers.set(event, fn),
    },
    logs: { audit: () => {}, general: () => {} },
    protection: { apply: async () => false },
  } as unknown as import("../src/types.js").Context;
  try {
    messageEvents(ctx);
    await handlers.get(Events.MessageUpdate)!(
      { content: "Niewinna poprzednia wiadomość" },
      message,
    );
    assert.equal(deleted, true);
    assert.equal(s.warningPoints(guildId, user.id), 2);
  } finally {
    s.close();
    env.DISCORD_GUILD_ID = oldGuild;
  }
});
