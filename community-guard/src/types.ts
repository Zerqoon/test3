import type { Client } from "discord.js";
import type { Store } from "./services/store.js";
import type { Logs } from "./services/logs.js";
export interface Context {
  client: Client;
  store: Store;
  logs: Logs;
  startedAt: number;
}
