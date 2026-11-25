# Partner configuration

Use the public JSON downloaded from the portal, not a hand-built substitute. The type is [StealthOSPartnerConfiguration](../packages/vanta-sdk/browser/partner-app.d.mts).

| Field | Meaning |
| --- | --- |
| schema | stealthos-partner-integration-v1 |
| sdkVersion | Exact signed package version, 0.4.65 |
| networkId | eip155:6281971 for Chikyu |
| generationId | Signed deployment generation; must match compiled release |
| partnerHandle | Registered partner identity; wrapper binds this to quotes |
| handleId | Registered 0x-prefixed 32-byte identity |
| application | Registered name and origins; optional authorizationUrl is defined by the type, not a requirement to host a custom auth service |
| serviceUrl | HTTPS authenticated StealthOS service |
| artifactBaseUrl | HTTPS signed public proof resource base |
| rpcUrl | Credential-free HTTPS primary RPC |
| verificationRpcUrl | Credential-free HTTPS independent verification RPC; optional for legacy single-endpoint mode only |
| assetConfigurationUrl | HTTPS current signed partner asset configuration, same origin as serviceUrl |

The application origin must exactly match the registered origin (scheme, hostname and port, not a URL path). RPC URLs must have no embedded credentials, query or fragment; second endpoint must use a distinct origin and independent backend. Do not embed private API keys or tokens in public configuration. The SDK reads current registered settings and validates the application, identity and release; never suppress validation or override policy. Serve configuration without stale caches; pair it with the exact package and worker assets on rollout. Register newly enabled assets; hiding an asset does not revoke historical recovery. Use `native`, `token` or the supported asset address as defined in FamilyAsset; explicit registered address is preferable for additional tokens.

Source: [partner wrapper](../packages/vanta-sdk/browser/partner-app.mjs), [RPC validation](../packages/vanta-sdk/fresh/family-rpc.mjs), [signed publication](../releases/0.4.65/publication.json).
