// URL safety helpers — Bundle #3 (2026-06-07)
//
// Server-side use: import { escHtmlAttr, safeUrl, safeHref } from '../utils/url-safety.js'
//
// Client-side dashboard SPA (src/dashboard/server.js inline template literal):
// the same 3 functions are duplicated inline in `_buildSPA()` because the SPA
// runs in browser and cannot ESM-import. Keep duplicates in sync (current
// versions match this file; quarterly drill can diff them if drift is suspected).

/**
 * Escape a value safe for use inside a double-quoted HTML attribute.
 * Escapes 5 chars: &, ", ', <, >. Coerces non-strings.
 *
 * Use whenever an untrusted string is interpolated into <tag attr="VALUE">.
 *
 * @param {*} s - any value (null/undefined → empty string)
 * @returns {string}
 */
export function escHtmlAttr(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Validate a URL has the http(s) protocol. Returns the original URL string if
 * valid, or null if missing / unparseable / not http(s).
 *
 * Explicitly rejects: javascript:, data:, file:, mailto:, vbscript:, blob:,
 * about:, and any other scheme. Empty string and null/undefined → null.
 *
 * @param {*} url - any value
 * @returns {string|null}
 */
export function safeUrl(url) {
  if (!url) return null;
  try {
    const u = new URL(String(url));
    return /^https?:$/.test(u.protocol) ? String(url) : null;
  } catch {
    return null;
  }
}

/**
 * Combined: validate protocol AND escape for HTML attribute.
 * Returns escaped URL string if valid http(s), or the literal '#' fallback.
 *
 * Use as a drop-in for any untrusted URL going into <a href="...">.
 *
 * @param {*} url - any value
 * @returns {string} escaped safe URL, or '#' fallback
 */
export function safeHref(url) {
  const safe = safeUrl(url);
  return safe ? escHtmlAttr(safe) : '#';
}
