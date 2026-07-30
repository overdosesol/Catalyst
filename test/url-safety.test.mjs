import test from 'node:test';
import assert from 'node:assert/strict';

import { escHtmlAttr, parseRequestTarget, safeHref, safeUrl } from '../src/utils/url-safety.js';

test('safeUrl accepts only http and https URLs', () => {
  assert.equal(safeUrl('https://example.com/a?b=1'), 'https://example.com/a?b=1');
  assert.equal(safeUrl('http://localhost:8080/api/health'), 'http://localhost:8080/api/health');
  assert.equal(safeUrl('javascript:alert(1)'), null);
  assert.equal(safeUrl('data:text/html,<script>alert(1)</script>'), null);
  assert.equal(safeUrl('/relative/path'), null);
});

test('safeHref escapes valid URLs and falls back for unsafe values', () => {
  assert.equal(
    safeHref('https://example.com/?q="x"&tag=<meme>'),
    'https://example.com/?q=&quot;x&quot;&amp;tag=&lt;meme&gt;',
  );
  assert.equal(safeHref('file:///etc/passwd'), '#');
});

test('escHtmlAttr escapes attribute-sensitive characters', () => {
  assert.equal(escHtmlAttr(`"'><&`), '&quot;&#39;&gt;&lt;&amp;');
});

test('parseRequestTarget parses ordinary request targets', () => {
  const u = parseRequestTarget('/api/trends?limit=20&preset=general');
  assert.equal(u.pathname, '/api/trends');
  assert.equal(u.searchParams.get('limit'), '20');
  assert.equal(u.searchParams.get('preset'), 'general');
});

test('parseRequestTarget returns null for malformed targets instead of throwing', () => {
  // Every one of these makes `new URL(target, base)` throw "Invalid URL".
  // Port scanners and proxy probes send them at any public HTTP port.
  for (const target of ['//', '/\\', '//%', '//[/', '//user@', 'http://', 'http://h:99999/', 'http://[::1']) {
    assert.equal(parseRequestTarget(target), null, `expected null for ${JSON.stringify(target)}`);
  }
});

test('parseRequestTarget returns null for missing or non-string targets', () => {
  assert.equal(parseRequestTarget(undefined), null);
  assert.equal(parseRequestTarget(null), null);
  assert.equal(parseRequestTarget(''), null);
  assert.equal(parseRequestTarget(42), null);
});
