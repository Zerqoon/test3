import { UserError } from "../utils/errors.js";
// Requests are constructed only from fixed provider hosts, never a user's URL.
export async function jsonRequest(
  url: URL | string,
  init: RequestInit = {},
): Promise<any> {
  try {
    const response = await fetch(url, {
      ...init,
      headers: { Accept: "application/json", ...init.headers },
      redirect: "error",
      signal: AbortSignal.timeout(6000),
      cache: "no-store",
    });
    if (!response.ok || !response.body) throw new Error("provider unavailable");
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const r = await reader.read();
      if (r.done) break;
      size += r.value.byteLength;
      if (size > 1500000) {
        await reader.cancel();
        throw new Error("response too large");
      }
      chunks.push(r.value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new UserError(
      "Usługa zewnętrzna jest chwilowo niedostępna. Spróbuj ponownie za minutę.",
    );
  }
}
