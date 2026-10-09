import { test } from 'node:test';
import assert from 'node:assert/strict';

import { MemoryStore } from '../../core/memory-store.js';

test('mark then has within ttl returns true', () => {
  const store = new MemoryStore();
  const now = Date.now();
  assert.equal(store.has('k', now), false);
  store.mark('k', 100, now);
  assert.equal(store.has('k', now + 99), true);
});

test('has returns false once ttl expires and purges the entry', () => {
  const store = new MemoryStore();
  const now = Date.now();
  store.mark('k', 100, now);
  assert.equal(store.has('k', now + 100), false);
  assert.equal(store.size, 0);
  assert.equal(store.has('k', now + 500), false);
});

test('mark renews ttl on an existing key', () => {
  const store = new MemoryStore();
  const now = Date.now();
  store.mark('k', 100, now);
  store.mark('k', 100, now + 50);
  assert.equal(store.has('k', now + 149), true);
  assert.equal(store.has('k', now + 150), false);
});

test('incr creates a window counter starting at 1', () => {
  const store = new MemoryStore();
  const now = Date.now();
  assert.equal(store.incr('w', 100, now), 1);
  assert.equal(store.incr('w', 100, now + 10), 2);
  assert.equal(store.incr('w', 100, now + 20), 3);
  assert.equal(store.has('w', now + 99), true);
});

test('incr uses a fixed window: ttl does not renew on each hit', () => {
  const store = new MemoryStore();
  const now = Date.now();
  store.incr('b', 100, now);
  store.incr('b', 100, now + 99);
  assert.equal(store.has('b', now + 100), false);
  assert.equal(store.incr('b', 100, now + 101), 1);
});

test('incr on an expired entry restarts the count at 1', () => {
  const store = new MemoryStore();
  const now = Date.now();
  store.incr('w', 50, now);
  store.incr('w', 50, now + 10);
  assert.equal(store.incr('w', 50, now + 60), 1);
});

test('counters are independent per key', () => {
  const store = new MemoryStore();
  const now = Date.now();
  store.incr('a', 100, now);
  store.incr('b', 100, now);
  assert.equal(store.incr('a', 100, now), 2);
  assert.equal(store.incr('b', 100, now), 2);
});

test('respects max capacity and evicts the oldest inserted key', () => {
  const store = new MemoryStore({ max: 3 });
  const now = Date.now();
  store.mark('a', 10_000, now);
  store.mark('b', 10_000, now);
  store.mark('c', 10_000, now);
  store.mark('d', 10_000, now);
  assert.equal(store.size, 3);
  assert.equal(store.has('a', now), false);
  assert.equal(store.has('b', now), true);
  assert.equal(store.has('d', now), true);
});

test('expired entries are purged before evicting live ones', () => {
  const store = new MemoryStore({ max: 2 });
  const now = Date.now();
  store.mark('old', 10, now);
  store.mark('live', 10_000, now);
  store.mark('new', 10_000, now + 100);
  assert.equal(store.size, 2);
  assert.equal(store.has('old', now + 100), false);
  assert.equal(store.has('live', now + 100), true);
  assert.equal(store.has('new', now + 100), true);
});

test('default ttl argument works without explicit now (smoke)', () => {
  const store = new MemoryStore();
  store.mark('k', 60_000);
  assert.equal(store.has('k'), true);
  store.incr('w', 60_000);
  assert.equal(store.incr('w', 60_000), 2);
  assert.ok(store.size >= 2);
});
