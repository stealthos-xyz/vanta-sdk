# Quickstart

1. Register a test HTTPS origin and assets at https://partners.stealthos.xyz.
2. Download the signed 0.4.66 public partner configuration.
3. Clone the repo and follow the [reference application README](../examples/vanilla-js/README.md). Install the exact archive, place your downloaded config in public/stealthos-partner-config.json, build and host public/ on the registered origin.
4. Connect your wallet on the supported network (Chikyu for 0.4.66); create or restore the local private wallet; refresh verified balance and receiving identity.
5. Use testnet funds to quote, explicitly approve, submit and reconcile a direct deposit; then try a private transfer and public withdrawal. Test other enabled routes and recoveries using [TRANSACTIONS.md](TRANSACTIONS.md).
6. Complete the [partner implementation guide](PARTNER_IMPLEMENTATION_GUIDE.md) acceptance checklist before exposing the integration to users.
