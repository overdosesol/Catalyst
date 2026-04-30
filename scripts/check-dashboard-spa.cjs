// Sister validator for src/dashboard/server.js inline React SPA. Same idea
// as check-admin-spa.cjs: load the module, call _buildSPA() (no this.* deps),
// extract the largest <script> body, run vm.Script — catches both
// backticks-in-comments and backslash-eat traps that node --check misses.
const path = require('path');
const vm = require('vm');

(async () => {
  const file = path.resolve(__dirname, '..', 'src', 'dashboard', 'server.js');
  const fileUrl = 'file://' + file.replace(/\\/g, '/');
  let mod;
  try { mod = await import(fileUrl); }
  catch (e) {
    console.error('Failed to import dashboard/server.js:', e.message);
    process.exit(1);
  }
  const DashboardServer = mod.DashboardServer || mod.default;
  if (!DashboardServer || typeof DashboardServer.prototype._buildSPA !== 'function') {
    console.error('DashboardServer._buildSPA() not found on exported class');
    process.exit(1);
  }
  let html;
  try { html = DashboardServer.prototype._buildSPA.call({}); }
  catch (e) { console.error('_buildSPA() threw:', e.message); process.exit(1); }

  const scripts = [...html.matchAll(/<script(?:[^>]*)>([\s\S]*?)<\/script>/g)]
    .map(m => m[1])
    .filter(s => s.trim().length > 100);
  if (!scripts.length) { console.error('no SPA <script> found'); process.exit(1); }
  const inner = scripts[scripts.length - 1];

  try {
    new vm.Script(inner);
    console.log('Dashboard SPA inner OK (' + inner.length + ' chars)');
  } catch (e) {
    console.error('Dashboard SPA SyntaxError:', e.message);
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
