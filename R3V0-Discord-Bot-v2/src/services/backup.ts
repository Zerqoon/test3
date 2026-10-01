import { mkdir, readdir, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { config, env } from "../config.js";
import type { Store } from "./store.js";
let busy = false;
export async function backup(store: Store) {
  if (busy) return null;
  busy = true;
  try {
    const folder = join(dirname(env.DATABASE_PATH), "backups");
    await mkdir(folder, { recursive: true });
    const file = join(
      folder,
      `community-${new Date().toISOString().replace(/[:.]/g, "-")}.sqlite`,
    );
    await store.db.backup(file);
    const files = (await readdir(folder))
      .filter((f) => /^community-.*\.sqlite$/.test(f))
      .sort()
      .reverse();
    for (const old of files.slice(config.retention.backupCount))
      await unlink(join(folder, old));
    return file;
  } finally {
    busy = false;
  }
}
