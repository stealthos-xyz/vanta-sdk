# Package release procedure

The immutable signed release is the distribution authority. Publish only the exact archive whose version, digest and operator-signed publication match the approved configuration and deployment. Do not use npm publishing to bypass activation or release checks.

## Candidate verification

Use the repository's pinned Node 24.14.1/npm 11.11.0 environment. Run:

- `npm ci`
- `npm run verify:release -- 0.4.65` (verify the existing signed artifact remains intact)
- `npm test` (runtime tests and TypeScript consumers)
- `npm run build` (development candidate archive)
- Install the candidate into the two example applications, build the workers and execute testnet acceptance under an approved matching configuration.

GitHub Actions performs the non-funded checks without publishing or deployment credentials. Record build, test, type and package results. Run the real registered-origin/browser testnet acceptance separately.

## Public npm rollout

After the owner confirms the first-party license, npm organization ownership and publication policy, remove the private package guard in the final approved release preparation. Rebuild and requalify the exact archive, obtain the required operator signature, publish it and activate the matching partner configuration using the normal release process. Then publish **that exact signed archive** to the controlled `@stealthos/vanta-sdk` npm scope using authorized registry credentials (prefer scoped publishing/trusted publishing where supported). Verify registry tarball bytes against the signed publication digest before recommending the version to partners. Keep the existing signed archive download as an immutable alternative.

Do not publish credentials, candidates or mutable rebuilt copies. No registry credentials or package publishing authority are supplied by this repository.
