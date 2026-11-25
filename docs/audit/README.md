# Vanta DOGE audit report and findings

**Report date:** 24 November 2026. **Network:** DogeOS Chikyu (6281971).

[Read the complete 28-page audit report (PDF)](Vanta_DOGE_Audit_Report_2026-11-24.pdf) · [Download PDF](https://raw.githubusercontent.com/stealthos-xyz/vanta-sdk/main/docs/audit/Vanta_DOGE_Audit_Report_2026-11-24.pdf)

The agreed internal fund-safety audit register is closed with **0 assigned audit items outstanding**. This summary is a navigation aid to the full report, not a separate audit or a guarantee of safety for real funds. The report is a first-party, AI-assisted engineering assessment, not independent third-party certification or a formal proof of soundness.

## External FYEO security code review

[View the seven-page FYEO report with remediation results (PDF)](FYEO_StealthOS_Audit_with_Remediation_Results.pdf) · [Download PDF](https://raw.githubusercontent.com/stealthos-xyz/vanta-sdk/main/docs/audit/FYEO_StealthOS_Audit_with_Remediation_Results.pdf)

The original FYEO scan (24 November 2026, `stealthos-xyz/vanta-audit`, main, `44fcb59`, 97 files) recorded 14 findings. The follow-up dashboard supplied by StealthOS lists all 14 original findings as no longer reported, plus the scan-summary entry (15 fixed entries). The PDF preserves the original six report pages and appends a StealthOS-prepared, selectable-text remediation record dated 25 November 2026. The rescan result is not a claim that a later scan found no other issues or that the revised immutable contracts are already deployed.

PDF SHA-256: `073c8bf689ade59dac2e8a29bafdae6127e901381f992b606314d794c987aea7` (5,562,694 bytes).

## Key evidence

| Control group | Recorded result | Report pages |
| --- | --- | --- |
| Circuit and ceremony qualification | 11/11 relations, 44/44 fresh qualification artifacts | 6-10 |
| Verifier replay | 536/536 expected outcomes: 22 honest accepts, 514 expected rejections | 8 |
| Adversarial circuit testing | 18/18 native adversarial tests, 40 rejected witness mutations, 7/7 supplemental properties | 8-9 |
| Adversarial security register | 43 named adversarial and structural controls | 24-25 |
| Deployment and bootstrap checks | 38/38 local deployment envelopes; 19/19 offline binding checks | 10 |
| SDK candidate testing | 100/100 on 0.4.61; subsequent signed SDK and consumer remediation tracked separately | 14-16, 23 |
| Funded swap candidate | 13 targeted SDK checks, 16 new funded checks, both directions, two proof-backed recipient spends | 13, 20 |
| CCIP recovery | Historical DogeOS route, forced destination failure, permissionless retry, exact delivery and replay rejection | 21 |
| Recovery | Retained PostgreSQL and five SQLite restores; separate-instance disposable chain snapshot, 3/3 pending payments mined once | 17, 22 |

These groups can overlap. Do not add the counts to claim a total number of independent tests.

## Findings register

Historical severity and scoped disposition are retained from the report's pages 4-5.

| ID | Original severity | Finding | Disposition |
| --- | --- | --- | --- |
| F1 | Medium | Selected balance isolation | Closed |
| F2 | Medium | RPC independence | Closed (tested scope) |
| F3 | High | Swap output custody and recovery | Closed (candidate) |
| F4 | High conditional | Authority continuity | Closed (mechanism) |
| F5 | High | Pending enhanced payments | Closed (accepted evidence) |
| F6 | Low | Metadata and privacy | Privacy scope |
| F7 | High | Independent wallet recovery | Closed |
| F8 | Low | Finality presentation | Closed (tested scope) |
| F9 | Medium | Screening retention | Privacy scope |
| F10 | High | Backup reliability | Closed (accepted evidence) |
| F11 | Low | Exact amount display | Closed |
| F12 | Medium | Route and review controls | Closed (tested scope) |
| F13 | Medium | Pending intent recovery | Closed (accepted evidence) |
| F14 | High | Backup service protection | Closed (accepted evidence) |
| F15 | Low | Tenant isolation | Closed (custody scope) |
| F16 | Medium provisional | Gas reserve custody | Closed (mechanism) |
| F17 | High | Recovery proof assets | Closed |
| F18 | Low | Expired review | Closed |
| F19 | Medium | CCIP finality and retry | Closed (tested scope) |

See the PDF for the evidence behind each finding. "Closed" means scoped evidence was accepted for the internal register. Privacy-specific observations and residual operational limitations are not equivalent to proved absence of risk.

## Scope and release boundary

The report distinguishes historical signed releases, local/fork tests, disposable ceremony evidence and new candidate contract tests. The current signed partner SDK is [0.4.65](../../releases/0.4.65/publication.json). The candidate swap recovery correction does not alter an existing immutable deployment; the matching candidate code must be incorporated in the approved future deployment. Current coordinated live restoration of the operational data stores is not independently established by retained restore and disposable failover evidence. Final ceremony, final keys and deployment validation are separate release requirements. No third-party certification or blanket mainnet fund-safety conclusion is asserted.

## Report integrity

The PDF is the exact 28-page adversarial-security edition. Its SHA-256 is:

`40a27aae389ae1bc564affb6b44c8bc0c3bfd6008f40f9e7f794724adeda2d6d`

Size: 1,247,061 bytes. Partner integration instructions: [Partner integration guide](../PARTNER_INTEGRATION.md).
