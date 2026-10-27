import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const config = JSON.parse(readFileSync(new URL('../firebase.json', import.meta.url), 'utf8'));
const hosting = config.hosting.find(entry => entry.target === 'pixtaffy');

test('hosting serves only the four SPA routes and preserves the custom 404', () => {
  assert.deepEqual(hosting.rewrites, ['/', '/pricing', '/privacy', '/terms'].map(source => ({ source, destination: '/index.html' })));
  assert.ok(!hosting.rewrites.some(entry => entry.source === '**'));
  assert.ok(existsSync(new URL('../public/404.html', import.meta.url)));
});

test('guessed hosting links redirect to the supported surfaces', () => {
  const groups = [
    ['/', 'studio app create login signin sign-in signup sign-up register home index'],
    ['/?whatsnewpage=1', 'whats-new whatsnew changelog releases updates'],
    ['/pricing', 'billing checkout plans credits buy'],
    ['/privacy', 'privacy-policy legal/privacy'],
    ['/terms', 'tos terms-of-service terms-of-use legal/terms'],
  ];
  const expected = groups.flatMap(([destination, paths]) => paths.split(' ').map(path => ({ source: `/${path}`, destination, type: 301 })));
  expected.push({ source: '/favicon.ico', destination: '/pixtaffy.png', type: 302 });
  assert.deepEqual(hosting.redirects, expected);
  assert.ok(!hosting.redirects.some(entry => entry.source.startsWith('/__')));
});
