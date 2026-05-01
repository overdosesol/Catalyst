# Brand assets

Static files baked into the Docker image at `/app/assets/` via the
`COPY --chown=node:node . .` step in `Dockerfile`. Served by the dashboard
on simple public routes (no auth, no rate limit — the content is brand-safe).

## Files

| File          | Route                  | Notes                                                                |
|---------------|------------------------|----------------------------------------------------------------------|
| `logo.png`    | `GET /assets/logo.png` | Nav logo. PNG, square (recommended 128×128 or 256×256), transparent. |

## Adding / replacing the logo

1. Drop the PNG at `assets/logo.png` (this directory).
2. Run `.\deploy.ps1` (Windows) or `./deploy.sh` (Linux/macOS) — Docker rebuild
   bakes the new file into the image.
3. Hard-refresh the dashboard (`Ctrl+F5`) — the `Cache-Control: max-age=86400`
   header means the browser may serve a stale copy for up to a day otherwise.

## Fallback behaviour

If `assets/logo.png` is missing at request time, `_handleBrandLogo` returns 404
and the SPA's `onError` handler swaps the `<img>` for a 🐱 emoji. So the nav
never looks broken — but **you don't see the new logo until the file is
present and the Docker image is rebuilt**.

## Why a static file (not an inline SVG)?

The current logo is a flat outline cat that could be redrawn as SVG, but
inlining one in the SPA template literal would mean either embedding raw SVG
markup (extra parsing surface for the dashboard SPA validator) or base64-ing
a binary PNG (bloats the HTML payload on every page load). A separate route
also lets us swap the asset without touching the SPA bundle.
