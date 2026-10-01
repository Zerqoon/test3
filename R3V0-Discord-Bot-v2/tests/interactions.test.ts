import test from "node:test";
import assert from "node:assert/strict";
import {
  Events,
  Collection,
  PermissionFlagsBits,
  PermissionsBitField,
  MessageFlags,
  type Interaction,
  type GuildMember,
} from "discord.js";
import { interactionEvents } from "../src/events/interactions.js";
import { Store } from "../src/services/store.js";
import { config, env } from "../src/config.js";
import type { Context } from "../src/types.js";
import { moderation } from "../src/commands/moderation.js";
const g = "1540000000000000000";
env.DISCORD_GUILD_ID = g;
let userSequence = 100;
function harness(role: string | undefined, channel = config.channels.commands) {
  const store = new Store(":memory:");
  let listener: (i: Interaction) => Promise<void>;
  const userId = String(BigInt("1540000000000000100") + BigInt(userSequence++));
  const targetId = "1540000000000000002",
    botId = "1540000000000000003";
  const client = {
    user: { id: botId },
    ws: { ping: 34 },
    on: (event: string, callback: typeof listener) => {
      if (event === Events.InteractionCreate) listener = callback;
    },
  };
  const guild: any = {
    id: g,
    ownerId: "real-owner",
    members: {
      fetch: async (value: any) =>
        typeof value === "string"
          ? value === targetId
            ? target
            : actor
          : value.user === targetId
            ? target
            : actor,
      fetchMe: async () => ({
        permissions: new PermissionsBitField(PermissionFlagsBits.Administrator),
      }),
    },
  };
  const actor = {
    id: userId,
    user: { tag: "Actor", username: "Actor" },
    guild,
    client,
    pending: false,
    roles: {
      cache: new Collection(role ? [[role, {}]] : []),
      highest: { position: 10, comparePositionTo: () => 9 },
    },
  } as unknown as GuildMember;
  const target = {
    id: targetId,
    guild,
    client,
    user: {
      username: "User",
      displayAvatarURL: () => "https://cdn.discordapp.com/embed/avatars/0.png",
    },
    roles: { cache: new Collection(), highest: { position: 1 } },
    moderatable: true,
    communicationDisabledUntilTimestamp: null,
    disableCommunicationUntil: async () => {},
    send: async () => {},
  } as unknown as GuildMember;
  const context = {
    client,
    store,
    logs: { audit: () => {}, action: () => {} },
    voice: { component: async () => false },
    verification: { component: async () => false },
    protection: {},
    startedAt: Date.now(),
  } as unknown as Context;
  interactionEvents(context);
  const outputs: { kind: string; payload: any }[] = [];
  function interaction(
    name: string,
    sub?: string,
    options: Record<string, any> = {},
  ) {
    const i: any = {
      id: `${userId}${Math.random()}`,
      guild,
      guildId: g,
      user: { id: userId },
      channelId: channel,
      createdTimestamp: Date.now(),
      commandName: name,
      deferred: false,
      replied: false,
      ephemeral: false,
      isAutocomplete: () => false,
      isChatInputCommand: () => true,
      isButton: () => false,
      isModalSubmit: () => false,
      isUserSelectMenu: () => false,
      isMessageComponent: () => false,
      isRepliable: () => true,
      options: {
        getSubcommand: () => sub,
        getUser: (key: string) => options[key] ?? { id: targetId },
        getString: (key: string) => options[key],
        getInteger: (key: string) => options[key],
        getChannel: () => null,
      },
      deferReply: async (payload: any) => {
        i.deferred = true;
        i.ephemeral = payload.flags === MessageFlags.Ephemeral;
        outputs.push({ kind: "defer", payload });
      },
      editReply: async (payload: any) => {
        i.replied = true;
        outputs.push({ kind: "edit", payload });
      },
      deleteReply: async () => {
        outputs.push({ kind: "delete", payload: null });
      },
      reply: async (payload: any) => {
        i.replied = true;
        outputs.push({ kind: "reply", payload });
      },
      followUp: async (payload: any) => {
        outputs.push({ kind: "follow", payload });
      },
    };
    return i;
  }
  return {
    store,
    outputs,
    userId,
    interaction,
    run: async (i: any) => listener(i),
  };
}
test("Zwykła komenda jest publiczna, a odmowa poza kanałem komend jest prywatna", async () => {
  const normal = harness(undefined);
  const wrong = harness(undefined, "1550000000000000000");
  try {
    await normal.run(normal.interaction("ping"));
    assert.equal(normal.outputs[0].payload.flags, undefined);
    assert.match(
      normal.outputs[1].payload.embeds[0].data.description,
      /Gateway/,
    );
    await wrong.run(wrong.interaction("ping"));
    assert.equal(wrong.outputs.at(-1)!.kind, "follow");
    assert.equal(wrong.outputs.at(-1)!.payload.flags, MessageFlags.Ephemeral);
    assert.match(
      wrong.outputs.at(-1)!.payload.embeds[0].data.description,
      /Używaj komend/,
    );
  } finally {
    normal.store.close();
    wrong.store.close();
  }
});
test("Moderator używa ostrzeżenia poza kanałem komend; wynik widać publicznie", async () => {
  const h = harness(config.roles.moderator, "1550000000000000000");
  try {
    await h.run(
      h.interaction("moderacja", "warn", { powod: "Test", punkty: 2 }),
    );
    assert.equal(h.outputs[0].payload.flags, undefined);
    assert.match(h.outputs.at(-1)!.payload.embeds[0].data.title, /Ostrzeżenie/);
    assert.equal(h.store.warningPoints(g, "1540000000000000002"), 2);
  } finally {
    h.store.close();
  }
});
test("Zakup nie uruchamia boostera; /uzyj jest osobną publiczną transakcją", async () => {
  const h = harness(undefined);
  try {
    h.store.adjustMoney(g, h.userId, 1000, "fund", "Test");
    await h.run(h.interaction("ekonomia", "kup", { produkt: "xp-2-5" }));
    assert.equal(h.outputs[0].payload.flags, undefined);
    assert.equal(h.store.profile(g, h.userId).xp_boost_until, 0);
    assert.equal(h.store.inventory(g, h.userId)[0].quantity, 1);
  } finally {
    h.store.close();
  }
});
test("Kwarantanna blokuje ekonomię oraz nie zapisuje transakcji", async () => {
  const h = harness(undefined);
  try {
    h.store.startQuarantine(g, h.userId, []);
    await h.run(h.interaction("ekonomia", "praca"));
    assert.match(
      h.outputs.at(-1)!.payload.embeds[0].data.description,
      /kwarantanny/,
    );
    assert.equal(h.store.history(g, h.userId).length, 0);
  } finally {
    h.store.close();
  }
});

test("Publiczne clear pomija własną odpowiedź i pobiera 100 pozostałych wiadomości", async () => {
  const h = harness(config.roles.moderator);
  const replyId = "reply";
  let deleted: string[] = [];
  const recent = new Collection<string, any>([[replyId, { id: replyId }]]);
  for (let n = 0; n < 99; n++) recent.set(`m${n}`, { id: `m${n}` });
  const channel: any = {
    id: "channel",
    name: "test",
    permissionsFor: () =>
      new PermissionsBitField(PermissionFlagsBits.Administrator),
    messages: {
      fetch: async (options: any) =>
        options.before ? new Collection([["older", { id: "older" }]]) : recent,
    },
    bulkDelete: async (selected: any[]) => {
      deleted = selected.map((m) => m.id);
      return new Collection(selected.map((m) => [m.id, m]));
    },
  };
  const i: any = h.interaction("moderacja", "clear", {
    powod: "Porządek",
    ilosc: 100,
  });
  i.channel = channel;
  i.fetchReply = async () => ({ id: replyId });
  const actor = await i.guild.members.fetch({ user: h.userId });
  const ctx = {
    client: i.guild.client,
    store: h.store,
    logs: { action: () => {} },
  } as unknown as Context;
  try {
    await moderation(i, actor, ctx);
    assert.equal(deleted.length, 100);
    assert.equal(deleted.includes(replyId), false);
    assert.equal(deleted.includes("older"), true);
    assert.match(h.outputs.at(-1)!.payload.embeds[0].data.description, /100/);
  } finally {
    h.store.close();
  }
});
