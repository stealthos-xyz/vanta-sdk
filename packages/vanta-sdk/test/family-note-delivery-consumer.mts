import { JsonRpcProvider } from "ethers";
import { restoreVantaFreshPrivateWallet } from "../fresh/wallet-runtime.mjs";
import { createFamilyNoteDelivery, type FamilyNoteDomain, type FamilyNoteEngine } from "../fresh/family-note-delivery.mjs";
import { recoverFamilyCanonicalNotes } from "../fresh/family-note-recovery.mjs";

declare const domain: FamilyNoteDomain;
declare const engine: FamilyNoteEngine;
declare const phrase: string;
declare const provider: JsonRpcProvider;

const wallet = await restoreVantaFreshPrivateWallet(phrase);
const delivery = createFamilyNoteDelivery({ domain, engine });
const recipient = await delivery.walletRecipient(wallet);
const note = delivery.createRecipientNote({ recipient, amountAtomic: "0" });
const envelope = await delivery.encrypt({ recipient, note });
const decoded = await delivery.decrypt({ wallet, envelope, commitment: note.commitment });
const recovery = await recoverFamilyCanonicalNotes({ provider, delivery, wallet, deploymentBlock: 0 });
const ownedNullifier: string | null | undefined = decoded?.verification.nullifier;
const finalBalance: string | null = recovery.balanceAtomicAtAnchor;
const complete: boolean = recovery.complete;
void [ownedNullifier, finalBalance, complete];

// Atomic values must remain canonical decimal strings, including above u64.
// @ts-expect-error Numeric amounts are not accepted.
delivery.createRecipientNote({ recipient, amountAtomic: 1 });
// @ts-expect-error Family qualification cannot opt into production custody.
createFamilyNoteDelivery({ domain: { ...domain, safeForFunds: true }, engine });
