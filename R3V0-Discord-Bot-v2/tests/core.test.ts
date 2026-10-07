import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { assertPersistentDatabase, config, resolveDatabasePath } from '../src/core/config.js';
import { allowed } from '../src/core/access.js';
import { Store } from '../src/core/store.js';
import { InstanceLease } from '../src/core/lease.js';
import { parseDuration, periodStart, nicknameWithSuffix } from '../src/core/util.js';
import { publishThenDelete } from '../src/services/usernames.js';
import { giveawayModal } from '../src/services/giveaways.js';
import { commandDefinitions } from '../src/commands/definitions.js';
import type { MessageSnapshot } from '../src/core/types.js';

const snapshot = (id = '1550000000000000001'): MessageSnapshot => ({ id, guildId: '1550000000000000010', channelId: '1550000000000000011',
  authorId: '1550000000000000012', username: 'account', displayName: 'Upper Display Name', avatarUrl: 'https://cdn.discordapp.com/embed/avatars/0.png',
  content: 'my_roblox_name', embeds: [], attachments: [], stickers: [], bot: false, createdAt: Date.now() - 1000, editedAt: Date.now() - 1000 });

test('database uses the hosting volume when no explicit path is supplied and keeps local defaults', () => {
  assert.equal(resolveDatabasePath({}), resolve('data/goat.sqlite'));
  assert.equal(resolveDatabasePath({ DATABASE_PATH: '  ', RAILWAY_VOLUME_MOUNT_PATH: '/app/data' }), resolve('/app/data/goat.sqlite'));
  assert.equal(resolveDatabasePath({ DATABASE_PATH: '/app/data/custom.sqlite', RAILWAY_VOLUME_MOUNT_PATH: '/app/data' }), resolve('/app/data/custom.sqlite'));
});
test('Railway startup refuses missing volumes and database paths outside persistent storage', () => {
  const railway = { RAILWAY_ENVIRONMENT_ID: 'test-environment' };
  assert.throws(() => assertPersistentDatabase(railway), /attach a Railway volume/);
  for (const databasePath of ['/app/temporary.sqlite', '/app/data-other/goat.sqlite', '/app/data/../goat.sqlite', '/app/data']) {
    assert.throws(() => assertPersistentDatabase({ ...railway, RAILWAY_VOLUME_MOUNT_PATH: '/app/data', DATABASE_PATH: databasePath }), /inside the attached Railway volume/);
  }
  assert.doesNotThrow(() => assertPersistentDatabase({ ...railway, RAILWAY_VOLUME_MOUNT_PATH: '/app/data', DATABASE_PATH: '/app/data/goat.sqlite' }));
  assert.doesNotThrow(() => assertPersistentDatabase({ ...railway, RAILWAY_VOLUME_MOUNT_PATH: '/app/data' }));
  assert.doesNotThrow(() => assertPersistentDatabase({ DATABASE_PATH: './data/goat.sqlite' }));
});

test('duration inputs include seconds, words and compound units; invalid or excessive values are rejected', () => {
  for (const [text, ms] of [['1s', 1000], ['10s', 10000], ['1m', 60000], ['1 minute', 60000], ['1h 30m', 5400000], ['2 weeks', 1209600000], ['1.5 minutes', 90000]] as const) assert.equal(parseDuration(text), ms);
  for (const text of ['', '0s', '-1s', '1', '1m garbage', '1month', 'Infinitys', '0.001s', '1m / 1s']) assert.throws(() => parseDuration(text), text);
  assert.throws(() => parseDuration('29 days', 28 * 86400000));
});
test('activity periods use Warsaw calendar boundaries and Monday weeks, including DST', () => {
  const now = Date.parse('2026-10-07T11:14:24Z');
  assert.equal(periodStart('daily', 'Europe/Warsaw', now), Date.parse('2026-10-06T22:00:00Z'));
  assert.equal(periodStart('weekly', 'Europe/Warsaw', now), Date.parse('2026-10-04T22:00:00Z'));
  assert.equal(periodStart('monthly', 'Europe/Warsaw', now), Date.parse('2026-09-30T22:00:00Z'));
  assert.equal(periodStart('daily', 'Europe/Warsaw', Date.parse('2026-03-30T10:00:00Z')) - periodStart('daily', 'Europe/Warsaw', Date.parse('2026-03-29T10:00:00Z')), 23 * 3600000);
});
test('owner retains access without roles; unrelated roles and Discord administrator status do not imply access', () => {
  assert.equal(allowed(config.access.ownerUserIds[0], [], config), true);
  assert.equal(allowed('1550000000000000044', [config.access.staffRoleIds[1]], config), true);
  assert.equal(allowed('1550000000000000044', ['1550000000000000099'], config), false);
});
test('nickname uses the upper display name, adds one tag and fits Discord’s limit', () => {
  assert.equal(nicknameWithSuffix('Stormy', ' | GOAT'), 'Stormy | GOAT');
  assert.equal(nicknameWithSuffix('Stormy | GOAT | goat', ' | GOAT'), 'Stormy | GOAT');
  assert.ok(nicknameWithSuffix('😎'.repeat(40), ' | GOAT').length <= 32);
});
test('historical/live duplicates count once, edits do not increment totals, deleted observations remain counted', () => {
  const dir = mkdtempSync(join(tmpdir(), 'goat-db-')); const file = join(dir, 'test.sqlite');
  try {
    let db = new Store(file); const s = snapshot();
    assert.equal(db.recordMessage(s, 'history'), true);
    assert.equal(db.recordMessage(s, 'live'), false);
    db.recordMessage({ ...s, content: 'edited', editedAt: s.editedAt + 100 }, 'live');
    assert.equal(db.snapshot(s.id)?.content, 'edited');
    db.markDeleted(s.id); db.recordMessage({ ...s, content: 'stale history' }, 'history');
    assert.equal(db.count(s.guildId, s.authorId), 1);
    assert.equal(db.snapshot(s.id)?.content, 'edited');
    db.close(); db = new Store(file);
    assert.equal(db.count(s.guildId, s.authorId), 1); db.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('username copy failure never deletes the source', async () => {
  let deleted = false;
  await assert.rejects(publishThenDelete({ publish: async () => { throw new Error('Discord unavailable'); }, savePublication: () => {}, deleteSource: async () => { deleted = true; }, saveDeleted: () => {} }));
  assert.equal(deleted, false);
});
test('publication must be saved before deletion; a delete retry reuses the existing copy', async () => {
  const order: string[] = [];
  let savedId: string | undefined; let failDelete = true;
  const steps = { publish: async () => { order.push('send'); return '1550000000000000022'; }, savePublication: (id: string) => { order.push('save'); savedId = id; },
    deleteSource: async () => { order.push('delete'); if (failDelete) throw new Error('No permission'); }, saveDeleted: () => { order.push('done'); } };
  await assert.rejects(publishThenDelete(steps)); assert.deepEqual(order, ['send', 'save', 'delete']);
  failDelete = false; await publishThenDelete({ ...steps, publishedId: savedId });
  assert.deepEqual(order, ['send', 'save', 'delete', 'save', 'delete', 'done']);
});
test('failed database publication write does not delete the original', async () => {
  let deleted = false;
  await assert.rejects(publishThenDelete({ publish: async () => 'id', savePublication: () => { throw new Error('DB error'); }, deleteSource: async () => { deleted = true; }, saveDeleted: () => {} }));
  assert.equal(deleted, false);
});
test('giveaway modal contains four text fields and a mandatory native role picker', () => {
  const data = giveawayModal('draft').toJSON();
  assert.equal(data.components.length, 5);
  assert.ok(data.components.every(c => c.type === 18));
  const picker = data.components[4] as { component: { type: number; min_values: number; required: boolean } };
  assert.equal(picker.component.type, 6); assert.equal(picker.component.required, true); assert.equal(picker.component.min_values, 1);
  for (const c of commandDefinitions) assert.ok(c.toJSON().name);
});
test('only one process can own a database; stale leases can be recovered', () => {
  const db = new Store(':memory:'); const one = new InstanceLease(db); const two = new InstanceLease(db);
  one.acquire(1000); assert.throws(() => two.acquire(2000)); two.acquire(62000); one.release();
  assert.equal(db.get<{ token: string }>('SELECT token FROM instance_lease')?.token, two.token); two.release(); db.close();
});
