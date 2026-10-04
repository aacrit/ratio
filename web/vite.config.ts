import { defineConfig } from "vite";
import { renderRulebook } from "./src/rules/render";

// Run with cwd set to web/ (scripts/build.mjs and scripts/dev.mjs both do
// this), so `root` defaults to this directory and `outDir` below lands at
// the repo root's dist/, matching wrangler.jsonc's assets.directory.
export default defineConfig({
  publicDir: "public",
  // The Rulebook page is rendered from RULEBOOK at build time (and on each
  // dev request), so its words and edges are the engine's own and the page
  // reads in full before any script runs.
  plugins: [
    {
      name: "ratio-rulebook",
      transformIndexHtml: {
        order: "pre",
        handler: (html, ctx) => (/[\\/]rules\.html$/.test(ctx.filename) ? html.replace("<!--rulebook-->", renderRulebook()) : html),
      },
    },
  ],
  // The read worker (src/read.worker.ts) is a module worker in dev and in
  // the build alike, so MediaPipe loads the same module runtime both ways
  // (one numeric path, the determinism law).
  worker: { format: "es" },
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    // Fonts are always separate files, never inlined as data: URLs: the CSP
    // (scripts/lib/csp.mjs) allows fonts from this origin only.
    assetsInlineLimit: (file) => (file.endsWith(".woff2") ? false : undefined),
    rollupOptions: {
      input: {
        main: "index.html",
        rules: "rules.html",
        privacy: "privacy.html",
      },
    },
  },
});
