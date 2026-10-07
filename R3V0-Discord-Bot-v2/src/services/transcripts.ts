import type { GuildTextBasedChannel } from 'discord.js';
import type { Context, MessageSnapshot } from '../core/types.js';
import { snapshotMessage } from '../core/messages.js';
import { textEvidence } from './logs.js';

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
}
function safeLink(url: string): string {
  try { const value = new URL(url); return ['http:', 'https:'].includes(value.protocol) ? escapeHtml(value.href) : ''; }
  catch { return ''; }
}
export function transcriptDocument(title: string, metadata: string, snapshots: MessageSnapshot[], deletedIds: Set<string> = new Set()): string {
  const messages = [...snapshots].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  const rows = messages.map(message => {
    const attachments = message.attachments.map(file => {
      const url = safeLink(file.url);
      return url ? `<a href="${url}" rel="noreferrer">${escapeHtml(file.name)}</a>` : escapeHtml(file.name);
    }).join(' · ');
    const embeds = message.embeds.map(embed => `${embed.title ?? ''}\n${embed.description ?? ''}\n${embed.fields?.map(field => `${field.name}: ${field.value}`).join('\n') ?? ''}`).join('\n\n');
    return `<article><header><strong>${escapeHtml(message.displayName)}</strong> <span>@${escapeHtml(message.username)} · ${escapeHtml(new Date(message.createdAt).toISOString())}</span></header><small>User ${escapeHtml(message.authorId)} · Message ${escapeHtml(message.id)}${deletedIds.has(message.id) ? ' · Deleted after observation' : ''}</small><pre>${escapeHtml(message.content || '')}</pre>${embeds.trim() ? `<pre class="embed">${escapeHtml(embeds)}</pre>` : ''}${attachments ? `<div class="files">Attachments: ${attachments}</div>` : ''}</article>`;
  }).join('\n');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>${escapeHtml(title)}</title><style>body{margin:0;background:#10141c;color:#e8edf5;font:15px/1.55 system-ui,sans-serif}main{max-width:1000px;margin:auto;padding:32px 20px}h1{color:#49e6ff;margin-bottom:8px}.meta{color:#bbc5d3;white-space:pre-wrap}article{margin:18px 0;padding:18px;background:#1a2230;border:1px solid #2c394d;border-radius:12px}header span,small{color:#a7b5c9;font-size:12px}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:inherit}.embed{border-left:3px solid #49e6ff;padding:10px;color:#bfeef5}.files{font-size:13px}a{color:#49e6ff}footer{margin-top:28px;color:#a7b5c9;font-size:12px}</style></head><body><main><h1>${escapeHtml(title)}</h1><div class="meta">${escapeHtml(metadata)}</div>${rows || '<p>No messages were available.</p>'}<footer>GOAT · Attachments are external Discord links and may expire. Message text and observed deletions are preserved in this document.</footer></main></body></html>`;
}
export async function captureTranscript(ctx: Context, channel: GuildTextBasedChannel, ticketId: number, metadata: string): Promise<{ name: string; base64: string }[]> {
  const snapshots = new Map<string, MessageSnapshot>();
  const deleted = new Set<string>();
  for (const row of ctx.db.all<{ snapshot: string; deleted_at: number | null }>('SELECT snapshot,deleted_at FROM messages WHERE channel_id=? AND snapshot IS NOT NULL', channel.id)) {
    const snapshot = JSON.parse(row.snapshot) as MessageSnapshot;
    snapshots.set(snapshot.id, snapshot);
    if (row.deleted_at) deleted.add(snapshot.id);
  }
  let before: string | undefined;
  for (;;) {
    if (ctx.stopping) throw new Error('GOAT transcript capture paused for restart.');
    const page = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}), cache: false });
    const list = [...page.values()].sort((a, b) => b.createdTimestamp - a.createdTimestamp);
    for (const message of list) {
      const snapshot = snapshotMessage(message);
      ctx.db.recordMessage(snapshot, 'history');
      snapshots.set(snapshot.id, snapshot);
    }
    if (!list.length) break;
    const next = list.at(-1)!.id;
    if (before === next) throw new Error('GOAT transcript pagination did not advance.');
    before = next;
  }
  const all = [...snapshots.values()].sort((a, b) => a.createdAt - b.createdAt);
  // Split very large transcripts into independent HTML files below upload limits.
  const groups: MessageSnapshot[][] = [];
  let current: MessageSnapshot[] = [], size = 0;
  for (const snapshot of all) {
    const bytes = Buffer.byteLength(JSON.stringify(snapshot), 'utf8');
    if (current.length && size + bytes > 600000) { groups.push(current); current = []; size = 0; }
    current.push(snapshot); size += bytes;
  }
  groups.push(current);
  return groups.map((group, index) => textEvidence(`goat-ticket-${ticketId}${groups.length > 1 ? `-part-${index + 1}` : ''}.html`,
    transcriptDocument(`GOAT · Ticket #${ticketId}`, metadata, group, deleted)));
}
