# Framework integration

The [vanilla browser reference app](../examples/vanilla-js/) is the canonical small integration. Use the same reviewed flows in React, Next.js or Vite; do not maintain separate wallet implementations.

**React / Vite:** bundle SDK on the browser side. Open only after an explicit connect action and a selected EIP-1193 provider. Store the client in a ref, not a render body. On account/chain/provider change or component cleanup, dispose the old instance. Avoid creating two workers under StrictMode or issuing writes in an effect. Serve both worker files from public/stealthos, and build before deploy.

**Next.js:** use a client component ('use client') for wallet UI; import/open the SDK in a browser-only event or effect with cleanup. Do not open it in server components, route handlers or during SSR. Build worker files into public/stealthos ahead of next build. Host public config on the registered deployment origin; never copy private runtime credentials to NEXT_PUBLIC variables.

**Partner wallet connector:** pass the selected connected EIP-1193 provider exposed by the integration's connector, rather than guessing window.ethereum in a multi-wallet app. The SDK calls eth_accounts and personal_sign for session authentication, and the connected wallet for public transaction requests. Test the actual connector and mobile return-to-app lifecycle. The reference app permits explicit provider selection for injected wallets; replace this with your existing connector for wallet SDK/WalletConnect flows.


## React and Next.js reference

See the [React reference application](../examples/react/) and its reusable client-only WalletPanel component. For Next.js, pass the provider from your existing client connector and build the worker files before next build. The React example uses the same reviewed SDK operations as the vanilla reference. The 0.4.66 candidate adds an optional progress callback and worker installation command; see [developer experience](DEVELOPER_EXPERIENCE.md).
