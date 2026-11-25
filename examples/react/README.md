# React reference integration

This small ESM React application reuses the SDK's existing reviewed deposit flow, wallet lifecycle and recovery APIs. It defaults to the immutable signed 0.4.66 archive; install a different signed package only with its matching configuration. The expanded 0.4.66 API is signed and active.

1. Register a test HTTPS origin at https://partners.stealthos.xyz; download its matching configuration and save it as `public/stealthos-partner-config.json`.
2. In this directory run `npm install` and `npm run build`; host `public/` at the registered HTTPS origin. The build uses the same worker setup as the vanilla example, resolving the installed package from the React project.
3. Pass the wallet provider selected by your application's connector to `WalletPanel`. The standalone entry supports a single injected wallet; multiple-wallet applications must explicitly select one.
4. Connect, create or restore locally, recover the balance, review a native deposit and reconcile its original ID. Never use real funds in a testnet exercise.

For **Next.js**, use `src/WalletPanel.jsx` as a client component (it includes `'use client'`). Supply the selected provider from your client-only connector; do not create wallets during SSR. Build both workers into `public/stealthos` before deployment. Use your trusted recovery phrase UI rather than the reference confirmation dialog. No separate wallet implementation is required.

For **Vite**, the same component can be imported from a browser entry. Build and copy the workers before Vite builds the app. See [framework notes](../../docs/FRAMEWORKS.md) and the [full operation reference](../vanilla-js/README.md) for all supported operations.
