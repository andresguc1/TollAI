import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createShell } from '../../core/shell.js';

test('createShell renders the attestation page with scenario and client script', () => {
  const shell = createShell({ scenario: 'news-portal', reloadUrl: '/api/news' });
  assert.match(shell, /TollAI/);
  assert.match(shell, /Paying the cognitive toll for <code>news-portal<\/code>/);
  assert.match(shell, /<script src="\/tollai\/client\.js"><\/script>/);
  assert.ok(shell.includes('window.TOLLAI_RELOAD_URL'));
});

test('createShell embeds the reload URL as JSON', () => {
  const shell = createShell({ scenario: 'finance', reloadUrl: '/api/finance/transfer?amount=100' });
  assert.ok(shell.includes(JSON.stringify('/api/finance/transfer?amount=100')));
});

test('createShell default clientPath is the protocol route', () => {
  const shell = createShell({ scenario: 'generic' });
  assert.match(shell, /\/tollai\/client\.js/);
});

test('createShell accepts a custom clientPath', () => {
  const shell = createShell({ scenario: 'generic', clientPath: 'https://cdn.example/tollai.js' });
  assert.ok(shell.includes('<script src="https://cdn.example/tollai.js"></script>'));
});