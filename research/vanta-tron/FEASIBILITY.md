# Vanta TRON feasibility (research only)

2026-11-27. Branch: vanta-tron. No broadcast, public testnet deployment, signing, production credentials, activation, ceremony contribution, SDK publication, PR or merge. No changes to existing DogeOS/Base/Solana runtime. All conclusions are provisional until TVM execution. Keep research files outside production paths.

Central work: https://github.com/stealthos-xyz/privacy-protocol/tree/vanta-tron/research/vanta-tron

## Source-level review
docs/ARCHITECTURE.md and packages/vanta-sdk/browser/app-wallet.d.mts currently expect EIP-1193 selected wallet and 0x-prefixed token addresses. Propose a minimal chain adapter for canonical TRON address conversion (20-byte ABI vs 21-byte 0x41/API/Base58Check), provider/signature semantics, native transaction creation/TAPOS expiration, solidified receipt/readback and Energy/Bandwidth fee quotes. Verify TRX/USDT six decimals without EVM 18-decimal assumptions; no signer keys or witnesses sent to backend. Preserve independent RPC and signed generation checks, browser worker/prover and mnemonic recovery. Tests: deterministic encoding, network/genesis mismatch, signature/replay, transaction expiry, failed/missing receipts, recovery and precision. Keep network unavailable until verifier and release gates pass. No dependencies installed, signed SDK release, config or package changes.
