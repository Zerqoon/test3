import { EmbedBuilder, type Client } from "discord.js";
import { config } from "../config.js";
import type { Store } from "./store.js";
import { logger } from "../utils/logger.js";
import { embed } from "../utils/embeds.js";
import { clean } from "../utils/format.js";

type OutboxRow = {
  id: number;
  channel_id: string;
  payload: string;
  created_at: number;
  attempts: number;
};
export class Logs {
  private busy = false;
  private stopped = false;
  private timer?: NodeJS.Timeout;
  constructor(
    readonly client: Client,
    readonly store: Store,
  ) {}
  general(e: EmbedBuilder, files?: { name: string; text: string }[]) {
    this.enqueue(config.channels.generalLogs, e, files);
  }
  audit(e: EmbedBuilder) {
    this.enqueue(config.channels.auditLogs, e);
  }
  private enqueue(
    channel: string,
    e: EmbedBuilder,
    files?: { name: string; text: string }[],
  ) {
    this.store.enqueueLog(channel, {
      embeds: [e.toJSON()],
      allowedMentions: { parse: [] },
      files: files?.map((f) => ({
        name: f.name,
        attachment: Buffer.from(f.text, "utf8").toString("base64"),
      })),
    });
    void this.flush();
  }
  action(
    type: string,
    user: string,
    actor: string,
    reason: string,
    caseId?: number,
  ) {
    this.audit(
      embed(
        `Administracja • ${type}`,
        `**Osoba:** <@${user}> (${user})\n**Administrator:** <@${actor}>\n**Powód:** ${clean(reason, 800)}${caseId ? `\n**Sprawa:** #${caseId}` : ""}`,
      ),
    );
  }
  start() {
    this.timer = setInterval(() => {
      void this.flush();
    }, 5000);
    this.timer.unref();
    void this.flush();
  }
  stop() {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
  }
  async flush() {
    if (this.busy || this.stopped || !this.client.isReady()) return;
    this.busy = true;
    try {
      const rows = this.store.db
        .prepare(
          "SELECT * FROM log_outbox WHERE retry_at<=? ORDER BY id LIMIT 10",
        )
        .all(Date.now()) as OutboxRow[];
      for (const row of rows) {
        if (this.stopped) break;
        try {
          const channel = await this.client.channels.fetch(row.channel_id);
          if (!channel?.isSendable())
            throw new Error(
              `Kanał logów ${row.channel_id} nie jest dostępny do wysyłania.`,
            );
          // Discord nonce prevents duplicate log sends during immediate delivery retries.
          const payload = JSON.parse(row.payload);
          if (payload.files)
            payload.files = payload.files.map(
              (f: { name: string; attachment: string }) => ({
                name: f.name,
                attachment: Buffer.from(f.attachment, "base64"),
              }),
            );
          await channel.send({
            ...payload,
            nonce: `${row.created_at}${row.id}`.slice(0, 25),
            enforceNonce: true,
          });
          if (!this.stopped)
            this.store.db
              .prepare("DELETE FROM log_outbox WHERE id=?")
              .run(row.id);
        } catch (err) {
          logger.warn({ err, logId: row.id }, "Log czeka na ponowne wysłanie");
          if (!this.stopped)
            this.store.db
              .prepare(
                "UPDATE log_outbox SET attempts=attempts+1,retry_at=? WHERE id=?",
              )
              .run(
                Date.now() +
                  Math.min(3600000, 15000 * 2 ** Math.min(row.attempts, 8)),
                row.id,
              );
        }
      }
    } catch (err) {
      logger.error({ err }, "Błąd kolejki logów");
    } finally {
      this.busy = false;
    }
  }
}
