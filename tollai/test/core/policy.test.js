import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  compilePatterns,
  matchPath,
  createPolicy,
  createScenarioMatcher,
} from '../../core/policy.js';

test('compilePatterns + matchPath with double-star matches any depth', () => {
  const pattern = compilePatterns(['/api/**']);
  assert.equal(matchPath(pattern, '/api/news'), true);
  assert.equal(matchPath(pattern, '/api/a/b/c'), true);
  assert.equal(matchPath(pattern, '/api/'), true);
  assert.equal(matchPath(pattern, '/api'), true);
  assert.equal(matchPath(pattern, '/news'), false);
  assert.equal(matchPath(pattern, '/other/api/news'), false);
});

test('single-star matches exactly one path segment', () => {
  const pattern = compilePatterns(['/api/*']);
  assert.equal(matchPath(pattern, '/api/news'), true);
  assert.equal(matchPath(pattern, '/api/a/b'), false);
  const middle = compilePatterns(['/api/*/page']);
  assert.equal(matchPath(middle, '/api/1/page'), true);
  assert.equal(matchPath(middle, '/api/1/2/page'), false);
});

test('exact patterns match their own path only', () => {
  const pages = compilePatterns(['/news', '/finance', '/health-portal']);
  assert.equal(matchPath(pages, '/news'), true);
  assert.equal(matchPath(pages, '/news/'), false);
  assert.equal(matchPath(pages, '/newsletter'), false);
  assert.equal(matchPath(pages, '/finance'), true);
});

test('regex special characters are treated literally', () => {
  const pattern = compilePatterns(['/api/v1.0/**', '/fin(x]']);
  assert.equal(matchPath(pattern, '/api/v1.0/x'), true);
  assert.equal(matchPath(pattern, '/api/v1X0/x'), false);
  assert.equal(matchPath(pattern, '/fin(x]'), true);
});

test('bare double-star matches any path', () => {
  const pattern = compilePatterns(['**']);
  assert.equal(matchPath(pattern, '/'), true);
  assert.equal(matchPath(pattern, '/anything/at/all'), true);
});

test('compilePatterns handles empty and unusual input gracefully', () => {
  assert.equal(compilePatterns([]).length, 0);
  const pattern = compilePatterns(['/unprotected/*', '/favicon.ico']);
  assert.equal(matchPath(pattern, '/unprotected/x'), true);
  assert.equal(matchPath(pattern, '/favicon.ico'), true);
});

test('createPolicy tolls protected paths in api mode', () => {
  const policy = createPolicy({ mode: 'api', protect: ['/api/**'], exclude: [] });
  assert.equal(policy.shouldToll('/api/news'), true);
  assert.equal(policy.shouldToll('/api/'), true);
  assert.equal(policy.shouldToll('/'), false);
  assert.equal(policy.shouldToll('/news'), false);
});

test('createPolicy honours exclude over protect', () => {
  const policy = createPolicy({
    mode: 'api',
    protect: ['/api/**'],
    exclude: ['/api/public/**'],
  });
  assert.equal(policy.shouldToll('/api/private'), true);
  assert.equal(policy.shouldToll('/api/public/x'), false);
});

test('createPolicy in off mode never tolls', () => {
  const policy = createPolicy({ mode: 'off', protect: ['/api/**'], exclude: [] });
  assert.equal(policy.shouldToll('/api/news'), false);
});

test('createPolicy in gate mode tolls everything except excludes', () => {
  const policy = createPolicy({
    mode: 'gate',
    protect: [],
    exclude: ['/assets/*', '/favicon.ico', '/robots.txt'],
  });
  assert.equal(policy.shouldToll('/'), true);
  assert.equal(policy.shouldToll('/api/news'), true);
  assert.equal(policy.shouldToll('/assets/img.png'), false);
  assert.equal(policy.shouldToll('/favicon.ico'), false);
  assert.equal(policy.shouldToll('/robots.txt'), false);
});

test('default policy is api mode over /api/*', () => {
  const policy = createPolicy({});
  assert.equal(policy.shouldToll('/api/x'), true);
  assert.equal(policy.shouldToll('/'), false);
});

test('createScenarioMatcher maps paths to scenarios by order', () => {
  const matcher = createScenarioMatcher([
    { pattern: '/api/news', scenario: 'news-portal' },
    { pattern: '/api/chat', scenario: 'corporate-chatbot' },
    { pattern: '/api/paper/page/*', scenario: 'papers' },
    { pattern: '/api/**', scenario: 'generic' },
  ]);
  assert.equal(matcher('/api/news'), 'news-portal');
  assert.equal(matcher('/api/chat'), 'corporate-chatbot');
  assert.equal(matcher('/api/paper/page/3'), 'papers');
  assert.equal(matcher('/api/whatever'), 'generic');
  assert.equal(matcher('/'), 'generic');
});

test('createScenarioMatcher accepts an object table', () => {
  const matcher = createScenarioMatcher({ '/api/news': 'news-portal', '/news': 'news-portal' });
  assert.equal(matcher('/api/news'), 'news-portal');
  assert.equal(matcher('/news'), 'news-portal');
  assert.equal(matcher('/'), 'generic');
});