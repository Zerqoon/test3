import type { Context } from '../core/types.js';
export function maintain(ctx: Context): void {
  const now = Date.now();
  ctx.db.transaction(() => {
    if (ctx.config.logging.retainMessageContentDays > 0) {
      ctx.db.run('UPDATE messages SET snapshot=NULL WHERE created_at<? AND snapshot IS NOT NULL', now - ctx.config.logging.retainMessageContentDays * 86400000);
    }
    // Message ledger and moderation / archive / giveaway history are never removed.
    ctx.db.run("DELETE FROM log_outbox WHERE status='sent' AND sent_at<?", now - 7 * 86400000);
    ctx.db.run("DELETE FROM log_outbox WHERE status='superseded' AND created_at<?", now - 7 * 86400000);
    ctx.db.run("DELETE FROM log_batches WHERE status='sent' AND sent_at<? AND NOT EXISTS(SELECT 1 FROM log_outbox WHERE batch_id=log_batches.id)", now - 7 * 86400000);
    ctx.db.run("DELETE FROM temporary_messages WHERE status='deleted' AND delete_at<?", now - 30 * 86400000);
    ctx.db.run('DELETE FROM audit_seen WHERE created_at<?', now - 45 * 86400000);
    ctx.db.run("DELETE FROM giveaway_drafts WHERE expires_at<? AND status IN ('draft','review','discarded')", now - 86400000);
  });
}
