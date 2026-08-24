import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // Marking node:sqlite external does not actually work under vite-node —
    // confirmed by trying it: even matched correctly, externalizing drops the
    // `node:` prefix and Node then fails to find a bare "sqlite" package. The
    // real fix is keeping test-imported logic out of any file that imports
    // connections/store.ts, the way varMasking.ts and connections/input.ts do.
    // This is left as a documented dead end so nobody re-discovers it the hard
    // way; delete once nothing needs it.
    server: { deps: { external: [/^(node:)?sqlite$/] } },
  },
});
