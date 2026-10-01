import type { Client } from "discord.js";
import type { Store } from "./services/store.js";
import type { Logs } from "./services/logs.js";
import type { RobloxVerification } from "./services/verification.js";
import type { NewAccountProtection } from "./services/protection.js";
import type { VoiceManager } from "./services/voice.js";
export interface CoreContext {
  client: Client;
  store: Store;
  logs: Logs;
  startedAt: number;
}
export interface Context extends CoreContext {
  verification: RobloxVerification;
  protection: NewAccountProtection;
  voice: VoiceManager;
}
