import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // Vite externalizes Node builtins by looking them up without the `node:`
    // prefix, and `sqlite` is not in module.builtinModules — only `node:sqlite`
    // is. Without this, any test that reaches the connection store fails to
    // resolve it.
    server: { deps: { external: [/^node:sqlite$/] } },
  },
});
