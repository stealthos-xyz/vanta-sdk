# Errors and safe recovery

Use the returned phase/status, error.code and sanitized error.depositFailure when available. Not all errors are typed; treat unknown exceptions conservatively. Do not send raw errors, raw RPC bodies, proofs, seeds, keys, private memos, private IDs or stack traces to support/analytics.

| SDK/provider signal | User action |
| --- | --- |
| USER_REJECTED / explicit 4001 | Show wallet cancellation; reconcile history before retrying if submission may have started |
| INSUFFICIENT_FUNDS | Check public balance and gas; obtain fresh review |
| WALLET_SUBMISSION_REJECTED | Confirm correct account and reviewed transaction, then reconcile |
| AUTHORIZATION_UNCERTAIN / timeout / lost transport | Do not resubmit; retain reservations and reconcile original ID/history |
| AUTHORIZATION_ALREADY_ATTEMPTED | Monitor/recover original authorization, never call authorize again blindly |
| INTENT_EXPIRED / INVALID_REVIEW / STATE_CHANGED | Reconcile old intent, discard review, get a new quote and consent |
| SESSION_EXPIRED / PASSWORD_REQUIRED / PERMISSION_DENIED | Reconnect or unlock; clear stale reviews |
| NOT_READY / RUNTIME_UNAVAILABLE / STORE_UNAVAILABLE | Disable funded action, preserve state and diagnose service/local storage |
| LOCAL_PROOF_FAILED / LOCAL_PROOF_RUNTIME_FAILED / LOCAL_PROOF_WORKER_FAILED | Check browser resources and worker deployment; reconcile before attempting new action |
| LOCAL_PROOF_ARTIFACT_UNAVAILABLE | Check pinned worker/artifact URLs and hashes; do not bypass verification |
| LOCAL_PROOF_INPUT_REJECTED | Recover verified notes and review; do not force the proof |
| DEPOSIT_FAILED / TRANSACTION_FAILED / unknown | Show safe failure, check journal and canonical receipt; no automatic resubmission |

Sources: [deposit error implementation](../packages/vanta-sdk/fresh/family-deposit-errors.mjs) and [enhanced host errors](../packages/vanta-sdk/fresh/enhanced-host.d.mts).

For wrong origin/configuration, use the portal's correct public configuration. For CSP/worker failures, verify MIME types, HTTPS, network permissions and pinned asset names. For RPC rate limiting, use backoff for read-only reconciliation, not automatic transaction replay. On account/network changes cancel UI state and reopen, never sign for the old context. Duplicate click protection must span quote/preparation/submission; the SDK journal is authoritative after reload. Support tickets should include version, chain ID, public transaction hash if appropriate, sanitized error code/stage and time.
