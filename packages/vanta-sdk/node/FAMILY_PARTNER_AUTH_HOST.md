# Current family partner authorization host

Mount `createFamilyPartnerAuthorizationHandler` from `@stealthos/vanta-sdk/node/family-partner-auth-handler` at `POST /api/vanta-v8/partner/authorize` on the trusted HTTPS partner host. The constructor requires the compiled current release and proof resources, plus `verifyOrigin`, `verifySession`, `verifyCsrf`, `approveIntent` and `loadPartnerWallet` gates. All gates must validate the actual request; none is an activation override.

The exact body is `{networkId,generationId,asset,handleId,request}`. The asset is the signed display symbol. The request binds payer, count three, gross amount, zero protocol and partner fee caps, outputs, envelopes, fee slots, fee terms and the authenticated KZG partner root. The response contains `{handleId,signerSalt,requestNonce,deadline,signature}` for the exact current registrar EIP-712 domain.

The application gateway authenticates the wallet, Origin and CSRF before forwarding over HTTPS with its server-only `X-StealthOS-Partner-Proxy` secret. `verifyFamilyPartnerProxySecret` checks that secret. Do not forward browser cookies or recovery phrases. The partner wallet signs through `signFamilyDepositQuoteAuthorization`; wallet secrets remain on the partner host.
