import { defineConfig } from "vite";

// Run with cwd set to web/ (scripts/build.mjs and scripts/dev.mjs both do
// this), so `root` defaults to this directory and `outDir` below lands at
// the repo root's dist/, matching wrangler.jsonc's assets.directory.
export default defineConfig({
  publicDir: "public",
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
        privacy: "privacy.html",
      },
    },
  },
});
