// Only build the runtime and workers reachable by the partner entry points.
await import('./build-runtime.mjs');
await import('./build-family-proof-driver.mjs');
await import('./build-fresh-wallet.mjs');
await import('./build-browser.mjs');
