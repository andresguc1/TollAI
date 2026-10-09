import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  parseCookies,
  buildCookie,
  sessionCookie,
  json,
  html,
  wantsHtml,
  looksLikeBrowser,
  getClientIp,
  headerGet,
} from '../../core/http.js';

test('parseCookies reads the cookie header into an object', () => {
  assert.deepEqual(parseCookies('a=1; b=2'), { a: '1', b: '2' });
  assert.deepEqual(parseCookies(''), {});
  assert.deepEqual(parseCookies(undefined), {});
  assert.deepEqual(parseCookies('tollai_session=abc.def; other=x'), {
    tollai_session: 'abc.def',
    other: 'x',
  });
});

test('parseCookies decodes URI components and survives malformed values', () => {
  assert.deepEqual(parseCookies('name=hello%20world'), { name: 'hello world' });
  assert.deepEqual(parseCookies('bad=%E0%A4%A'), { bad: '%E0%A4%A' });
  assert.deepEqual(parseCookies('  spaced = v  '), { spaced: 'v' });
  assert.deepEqual(parseCookies('novalue'), {});
  assert.deepEqual(parseCookies('eq=has=equals'), { eq: 'has=equals' });
});

test('buildCookie renders Path, HttpOnly, SameSite by default', () => {
  const cookie = buildCookie('tok', 'v1');
  assert.match(cookie, /^tok=v1/);
  assert.match(cookie, /Path=\//);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);
  assert.ok(!/Secure/.test(cookie));
});

test('buildCookie honours maxAge, secure and custom path', () => {
  const cookie = buildCookie('tok', 'v1', { maxAge: 900, secure: true, path: '/app' });
  assert.match(cookie, /Max-Age=900/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /Path=\/app/);
});

test('buildCookie encodes the value and escapes separators', () => {
  const cookie = buildCookie('tok', 'a b;c');
  assert.ok(cookie.startsWith('tok=' + encodeURIComponent('a b;c')));
  assert.equal(cookie.split(';')[0], 'tok=' + encodeURIComponent('a b;c'));
});

test('sessionCookie sets Max-Age from ttl and Secure on https', () => {
  const plain = sessionCookie('token-value', { ttlMs: 900000 });
  assert.match(plain, /tollai_session=token-value/);
  assert.match(plain, /Max-Age=900/);
  assert.match(plain, /HttpOnly/);
  assert.match(plain, /SameSite=Lax/);
  assert.ok(!/Secure/.test(plain));

  const secure = sessionCookie('token-value', { ttlMs: 900000, secure: true });
  assert.match(secure, /Secure/);
});

test('json builds a JSON Response with status', async () => {
  const res = json({ ok: true }, { status: 433 });
  assert.equal(res.status, 433);
  assert.match(res.headers.get('content-type'), /application\/json/);
  assert.deepEqual(await res.json(), { ok: true });
});

test('json includes extra headers', () => {
  const res = json({ a: 1 }, { headers: { 'x-tollai-decision': 'blocked' } });
  assert.equal(res.headers.get('x-tollai-decision'), 'blocked');
});

test('html builds an HTML Response', async () => {
  const res = html('<!DOCTYPE html><p>hi</p>', { status: 200 });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/html/);
  assert.equal(await res.text(), '<!DOCTYPE html><p>hi</p>');
});

test('wantsHtml is true only for html-preferring, non-json accepts', () => {
  const htmlAccept = 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,*/*;q=0.8';
  assert.equal(wantsHtml({ accept: htmlAccept }), true);
  assert.equal(wantsHtml({ accept: 'text/html' }), true);
  assert.equal(wantsHtml({ accept: 'text/html, application/json' }), false);
  assert.equal(wantsHtml({ accept: '*/*' }), false);
  assert.equal(wantsHtml({}), false);
  assert.equal(wantsHtml(new Headers({ Accept: htmlAccept })), true);
});

test('looksLikeBrowser requires a browser UA and 3+ signals', () => {
  const browser = {
    'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36',
    'accept-language': 'es-ES,es;q=0.9',
    'sec-fetch-mode': 'navigate',
    'sec-fetch-site': 'none',
    'sec-fetch-dest': 'document',
    'sec-ch-ua': '"Chromium";v="126"',
    accept: 'text/html,application/xhtml+xml,*/*;q=0.8',
  };
  assert.equal(looksLikeBrowser(browser), true);
  assert.equal(looksLikeBrowser({ 'user-agent': 'axios/1.6.2', accept: 'application/json' }), false);
  // browser UA but too few signals
  assert.equal(looksLikeBrowser({ 'user-agent': browser['user-agent'] }), false);
  assert.equal(looksLikeBrowser({}), false);
  assert.equal(looksLikeBrowser(browser), true);
});

test('getClientIp reads common proxy headers', () => {
  assert.equal(getClientIp({ 'x-forwarded-for': '1.2.3.4, 5.6.7.8' }), '1.2.3.4');
  assert.equal(getClientIp({ 'cf-connecting-ip': '9.9.9.9' }), '9.9.9.9');
  assert.equal(getClientIp({ 'x-real-ip': '7.7.7.7' }), '7.7.7.7');
  assert.equal(getClientIp({}), null);
  assert.equal(getClientIp(new Headers({ 'x-forwarded-for': ' 8.8.8.8 ' })), '8.8.8.8');
});

test('headerGet works with Headers and plain objects, case-insensitively', () => {
  assert.equal(headerGet({ 'X-Test': 'v' }, 'x-test'), 'v');
  assert.equal(headerGet(new Headers({ 'X-Test': 'v2' }), 'x-test'), 'v2');
  assert.equal(headerGet({}, 'missing'), undefined);
  assert.equal(headerGet(undefined, 'missing'), undefined);
});
