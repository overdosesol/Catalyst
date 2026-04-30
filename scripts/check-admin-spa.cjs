// One-shot validator for the inline React SPA inside src/admin/server.js.
// Loads the module, calls AdminServer.prototype._spa() (no this.* refs in
// that method), extracts the inline <script> body, runs it through
// vm.Script. This catches BOTH classes of trap that node --check misses:
//   1) backticks in comments inside the template literal
//   2) escape sequences (\n \t \r \u \x \/) inside SPA strings — the outer
//      template literal eats them before the browser sees them
//
// The previous version did manual escape unwinding (\\ → \, \` → `, \$ → $)
// which missed cases like \/\/ in a regex — the outer parser silently
// drops the backslash, the inner regex becomes unterminated. By calling
// _spa() we get exactly what the browser receives, no guesswork.
const path = require('path');
const vm = require('vm');

(async () => {
  const file = path.resolve(__dirname, '..', 'src', 'admin', 'server.js');
  const fileUrl = 'file://' + file.replace(/\\/g, '/');
  let mod;
  try {
    mod = await import(fileUrl);
  } catch (e) {
    console.error('Failed to import admin/server.js:', e.message);
    process.exit(1);
  }
  const AdminServer = mod.AdminServer || mod.default;
  if (!AdminServer || typeof AdminServer.prototype._spa !== 'function') {
    console.error('AdminServer._spa() not found on exported class');
    process.exit(1);
  }
  let html;
  try {
    html = AdminServer.prototype._spa.call({});
  } catch (e) {
    console.error('_spa() threw:', e.message);
    process.exit(1);
  }
  // Pull the LARGEST <script> block — the SPA. Skip cdnjs lines which
  // are <script src="..."> with no body.
  const scripts = [...html.matchAll(/<script(?:[^>]*)>([\s\S]*?)<\/script>/g)]
    .map(m => m[1])
    .filter(s => s.trim().length > 100);
  if (!scripts.length) { console.error('no SPA <script> found'); process.exit(1); }
  const inner = scripts[scripts.length - 1];

  try {
    new vm.Script(inner);
    console.log('SPA inner OK (' + inner.length + ' chars)');
  } catch (e) {
    console.error('SPA SyntaxError:', e.message);
    const lineMatch = e.stack && e.stack.match(/<anonymous>:(\d+)/);
    if (lineMatch) {
      const lineNo = parseInt(lineMatch[1], 10);
      const lines = inner.split('\n');
      const start = Math.max(0, lineNo - 4);
      const end = Math.min(lines.length, lineNo + 4);
      for (let i = start; i < end; i++) {
        console.error((i === lineNo - 1 ? '>>' : '  '), i + 1, lines[i]);
      }
    }
    process.exit(1);
  }
})();
