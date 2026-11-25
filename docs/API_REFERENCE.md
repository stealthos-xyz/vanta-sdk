# Public API reference (0.4.66)

The type declarations are authoritative. Import from supported package exports, never private file paths.

| Entry | Purpose |
| --- | --- |
| @stealthos/vanta-sdk | [Wallet and payment client, address/handle/memo helpers and types](../packages/vanta-sdk/api/wallet.d.mts) |
| /worker | Browser wallet worker bundle |
| /proof-worker | Standalone proof worker |
| /network | [Signed metadata, fee and confirmation helpers](../packages/vanta-sdk/api/network.d.mts) |
| /setup | [Partner enrollment and registry helpers](../packages/vanta-sdk/api/setup.d.mts) |
| /recovery | [Local storage and generation recovery helpers](../packages/vanta-sdk/api/recovery.d.mts) |

[Partner wrapper signatures](../packages/vanta-sdk/browser/partner-app.d.mts) and [wallet client signatures](../packages/vanta-sdk/browser/app-wallet.d.mts) define input and return types. Key quote/status types: [deposit](../packages/vanta-sdk/fresh/family-deposit-host.d.mts), [private send](../packages/vanta-sdk/fresh/family-normal-host.d.mts), [withdrawal/batch](../packages/vanta-sdk/fresh/family-enhanced-host.d.mts), [enhanced status](../packages/vanta-sdk/fresh/enhanced-host.d.mts), [routes](../packages/vanta-sdk/fresh/family-routed-host.d.mts), [fee quote](../packages/vanta-sdk/fresh/family-operation-review.d.mts). Some lower-level methods are exposed for compatibility; use the reviewed methods in [TRANSACTIONS.md](TRANSACTIONS.md). Do not depend on undocumented object internals, raw worker commands or a generic authorization bypass.

Wallet methods: createPrivateWallet, restoreWallet, getPasswordSettings, selectAsset, getCachedBalance, recoverNotes, receivingAddress, publicReceivingIdentity, handleAvailable, claimHandle, checkHandle, currentHandle, findHandle, resolveHandle, lockWallet and dispose. Private-wallet passwords are mandatory. Legacy remembered-unlock methods cannot enable passwordless access. The wrapper additionally provides previewNetworkGas for a session-authenticated estimate, not a spend authorization.

All funded methods and readback methods are documented in [TRANSACTIONS.md](TRANSACTIONS.md). The partner wrapper's typed overloads distinguish regular withdrawal authorization/monitor (normal review with preparedId/phase) from enhanced authorization (transactionId/status) and monitoring (enhanced claim status). For historical-generation recovery, use [WALLET_RECOVERY.md](WALLET_RECOVERY.md).


## Developer API

See [developer experience](DEVELOPER_EXPERIENCE.md) for the new public types, VANTA_ROUTE, normalized error/status helpers, lifecycle events and uniform reconcileTransaction entry point. These additions are available in the signed 0.4.66 archive.
