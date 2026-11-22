/** Wallet-local construction using the typed note, Gate0 and enhanced APIs.
 * The authenticated relayer receives reservation capabilities for its three
 * execution slots; wallet spending keys and proof witnesses stay local. */
import { Interface, recoverAddress } from "ethers";
import { ENHANCED_FIELD, enhancedField as field, enhancedAmount as amount, enhancedRandomField as random,
  enhancedAddress as address, enhancedFail as fail, enhancedHashOutputs, enhancedHashNullifiers,
  enhancedHashEnvelopes, enhancedFundingDigest, enhancedPoolAbi, enhancedSame,
  enhancedPublicBatch, enhancedPublicBatchDigest } from "./family-enhanced-wire.mjs";

let poseidon;
async function dummyPrefix() {
  poseidon ??= import("#vanta-circom-crypto").then(module => module.buildPoseidon());
  const H = await poseidon;
  return Array.from({ length: 32 }, (_, i) => field(H.F.toObject(H([0x564c4b5044554d59n, BigInt(i + 1)]))));
}
export async function readEnhancedPool(provider, pool, name, args = [], blockTag = "latest") {
  const result = await provider.call({ to: pool, data: enhancedPoolAbi.encodeFunctionData(name, args), blockTag });
  return enhancedPoolAbi.decodeFunctionResult(name, result);
}
export async function enhancedPartnerMembership(fees,quote,domain,isBatch) {
  const p=quote.policy,collector=quote.collectors[1];
  const membership=await fees.inspectMembership({asset:BigInt(domain.asset)===0n?"native":domain.asset,
    basePartnerId:BigInt(collector.handleId),operation:isBatch?3:0});
  if(address(membership.pool)!==domain.pool||address(membership.asset)!==domain.asset||
    field(membership.root)!==p.partnerRegistryRoot||membership.partnerId!==p.partnerId||
    membership.version.toString()!==p.partnerVersion||field(membership.receiverCommitment)!==collector.receiverCommitment||
    membership.feeBps!==p.partnerBps||membership.feeMinimum.toString()!==p.partnerMinimum||membership.feeMaximum.toString()!==p.partnerMaximum||
    field(membership.authorizationKey)!==p.authorizationCommitment)fail();
  return membership;
}

export function validateEnhancedFeeReview(quote, net, width, publicBatch = false) {
  if (!quote || quote.safeForFunds !== false || quote.width !== width || quote.netPayoutAtomic !== net ||
      !/^[A-Za-z0-9_-]{1,128}$/u.test(quote.id ?? "") || !Number.isSafeInteger(quote.deadline) ||
      !Array.isArray(quote.notes) || quote.notes.length !== 3 || !Array.isArray(quote.collectors) || quote.collectors.length !== 3 ||
      !enhancedSame(quote.feeSlots, [1, 2, 3])) fail();
  const p = quote.policy, n = amount(net);
  for (const bps of [p.protocolBps, p.partnerBps]) if (!Number.isInteger(bps) || bps < 0 || bps > 10000) fail();
  const rate = bps => (n * BigInt(bps) + 9999n) / 10000n;
  const protocol = rate(p.protocolBps) > amount(p.protocolMinimum, true) ? rate(p.protocolBps) : amount(p.protocolMinimum, true);
  const partner = rate(p.partnerBps) > amount(p.partnerMinimum, true) ? rate(p.partnerBps) : amount(p.partnerMinimum, true);
  if (partner > amount(p.partnerMaximum, true) || amount(quote.protocolFeeAtomic, true) !== protocol ||
      amount(quote.partnerFeeAtomic, true) !== partner || (!publicBatch && quote.gas?.claimsWei?.length !== 3) ||
      (publicBatch && quote.operation !== "public-batch")) fail();
  const gas = (publicBatch?[quote.gas.settlementWei]:[quote.gas.authorizationWei,...quote.gas.claimsWei]).map(v=>amount(v)).reduce((a,b)=>a+b,0n);
  const reserve = (gas * 12000n + 9999n) / 10000n;
  if (amount(quote.gasReserveAtomic) !== reserve || quote.gas.collectedWei !== reserve.toString() ||
      amount(quote.totalDebitAtomic) !== n + protocol + partner + reserve) fail();
  return quote;
}

export function selectEnhancedNotes(inventory, blocked, debit, width) {
  if (!inventory.complete || !Array.isArray(inventory.publicCommitments)) fail();
  // One Gate0 consumes one authenticated source epoch. Prefer older rows so
  // historical balances are spent without changing the contract or circuit.
  for (const epoch of inventory.epochs) {
    const candidates = inventory.notes.filter(n => n.epoch === epoch.epoch && n.status === "spendable" && !blocked.has(n.nullifier))
      .sort((a, b) => BigInt(a.opening.amount_units) === BigInt(b.opening.amount_units) ? a.row - b.row :
        BigInt(a.opening.amount_units) > BigInt(b.opening.amount_units) ? -1 : 1);
    const notes = []; let total = 0n;
    for (const note of candidates.slice(0, width)) {
      notes.push(note); total += amount(note.opening.amount_units);
      if (total >= debit) return { width, notes, source: epoch, totalAtomic: total.toString() };
    }
  }
  return null;
}

/** Amount that one existing Gate0 can spend, excluding local reservations.
 * Keep the two atomic units required by the normal public-exit change outputs.
 * The owned balance remains separate and includes pending/other-epoch notes. */
export function availableFamilyDebit(inventory, blocked) {
  if (!inventory.complete || !Array.isArray(inventory.epochs)) fail();
  let maximum = 0n;
  for (const epoch of inventory.epochs) {
    const values = inventory.notes.filter(n => n.epoch === epoch.epoch && n.status === 'spendable' && !blocked.has(n.nullifier))
      .map(n => amount(n.opening.amount_units)).sort((a,b) => a > b ? -1 : a < b ? 1 : 0).slice(0,32);
    const total = values.reduce((sum,n) => sum+n,0n);
    if (total > maximum) maximum = total;
  }
  return (maximum > 2n ? maximum-2n : 0n).toString();
}

export async function buildEnhancedPrivatePlan({ provider, domain, wallet, delivery, funding, components, fees, relay,
  request, quote, selected, inventory, policy }) {
  const { context, input, schedule } = request;
  const isBatch = request.operation === "public-batch";
  if (selected.width !== quote.width || (!isBatch && schedule.netPayoutAtomic !== input.amountAtomic)) fail();
  const targetBlock = await provider.getBlock("latest");
  if (!targetBlock?.hash || !Number.isSafeInteger(targetBlock.number)) fail();
  const [active, protocolRecipient, partnerRecipient, feeSigner, feePolicy] = await Promise.all([
    readEnhancedPool(provider, domain.pool, "activeGeneration", [], targetBlock.number),
    readEnhancedPool(provider, domain.pool, "protocolFeeRecipient", [], targetBlock.number),
    readEnhancedPool(provider, domain.pool, "partnerFeeRecipient", [], targetBlock.number),
    readEnhancedPool(provider, domain.pool, "feeSigner", [], targetBlock.number),
    readEnhancedPool(provider, domain.pool, "feePolicyHash", [], targetBlock.number),
    enhancedPartnerMembership(fees, quote, domain, isBatch),
  ]);
  const targetEpoch = Number(active.id), targetRows = Number(active.rows);
  if (targetRows + 5 > 65536 || feePolicy[0] !== quote.policy.feePolicyHash || (!isBatch && (
      schedule.authorizationEpoch > Math.floor(targetBlock.timestamp / 60) ||
      Math.floor(targetBlock.timestamp / 60) - schedule.authorizationEpoch > policy.maximumAuthorizationAgeEpochs))) fail();
  const recipient = await delivery.walletRecipient(wallet);
  const zero = await delivery.createOwnedNote({ wallet, amountAtomic: "0" });
  const change = await delivery.createOwnedNote({ wallet,
    amountAtomic: (amount(selected.totalAtomic) - amount(quote.totalDebitAtomic)).toString() });
  const outputs = [zero, ...quote.notes.map((entry, i) => {
    if (entry.slot !== i + 1 || entry.role !== ["protocol", "partner", "gas"][i] ||
        entry.masterPublicKey !== quote.collectors[i].masterPublicKey ||
        entry.opening.amount_units !== [quote.protocolFeeAtomic, quote.partnerFeeAtomic, quote.gasReserveAtomic][i]) fail();
    return delivery.verifyRecipientNote({ recipient: quote.collectors[i].recipient, note: entry.opening });
  }), change];
  const envelopes = [await delivery.encrypt({ recipient, note: zero }), ...quote.notes.map(n => n.envelope),
    await delivery.encrypt({ recipient, note: change })];
  const commitments = outputs.map(note => note.commitment);
  const terms = await relay.terms({ requestId: quote.requestId, outputs: commitments });
  if (!enhancedSame(terms.outputs, commitments) || terms.outputsHash !== enhancedHashOutputs(commitments)) fail();
  const amountSalt = random();
  const authorizationWitness = isBatch ? null : { schema: "vanta-enhanced-authorization-witness-v1", familyTag:domain.familyTag,
    context: { chainId: String(domain.chainId), pool: domain.pool, asset: domain.asset, genesisHash: domain.genesisHash,
      generationId: domain.generationId, recipient: address(input.destination), feePolicyHash: quote.policy.feePolicyHash,
      feeTermsHash: field(terms.feeTermsHash), nonce: quote.nonce, width: String(selected.width),
      authorizationEpoch: String(schedule.authorizationEpoch), maximumWindowEpochs: String(policy.windowEpochs),
      minimumDelayEpochs: String(policy.minimumDelayEpochs), windowEnd: String(schedule.authorizationEpoch + schedule.windowEpochs) },
    claimKey: random(), reservationSalt: random(), payoutAtomic: input.amountAtomic, amountSalt,
    legs: schedule.claims.map(c => ({ amountAtomic: c.amountAtomic, notBeforeEpoch: String(c.releaseEpoch), notAfterEpoch: String(c.windowEndEpoch) })) };
  let signals, claims, batch, aggregateWitness, preparedAuthorization;
  if (isBatch) {
    const publicIntent = enhancedPublicBatch(input.payments, domain.pool); batch = publicIntent.batch;
    const digest = enhancedPublicBatchDigest({ domain, policyHash: quote.policy.feePolicyHash, nonce: quote.nonce, width: selected.width, batch });
    const canonical = await readEnhancedPool(provider, domain.pool, "publicBatchDigest", [quote.nonce, selected.width, batch], targetBlock.number);
    if (publicIntent.totalAtomic !== input.amountAtomic || field(canonical.digest) !== digest || canonical.total.toString() !== input.amountAtomic ||
        quote.batchDigest !== digest || !enhancedSame(quote.batch, batch)) fail();
    const hash = await funding.amountCommitment({ amountAtomic: input.amountAtomic, amountSalt, digest });
    signals = [field(0, true), digest, hash, field(0, true)]; claims = [];
    aggregateWitness = { schema: "vanta-v8-aggregate-payout-witness-v1", chain_id: domain.chainId,
      batch_digest_field: digest, salted_amount_hash: hash, public_payout_units: input.amountAtomic, private_amount_salt: amountSalt };
  } else {
    preparedAuthorization = await components.prepareAuthorization({ witness: authorizationWitness });
    if (preparedAuthorization.safeForFunds !== false || preparedAuthorization.role !== "enhanced-authorization" || preparedAuthorization.publicSignals?.length !== 19 ||
        preparedAuthorization.claimCapabilities?.claims?.length !== 3) fail();
    signals = preparedAuthorization.publicSignals; claims = preparedAuthorization.claimCapabilities.claims;
  }
  const header = { width: selected.width, sourceEpoch: selected.source.epoch, sourceCheckpoint: selected.source.checkpoint,
    targetEpoch, targetCheckpoint: field(active.checkpoint), reservationCommitment: field(signals[0], true), authorizationDigest: field(signals[1]),
    amountHash: field(signals[2]), scopeDigest: field(signals[3], true), feeTermsHash: terms.feeTermsHash,
    partnerRegistryRoot: quote.policy.partnerRegistryRoot, authorizationEpoch: isBatch ? 0 : schedule.authorizationEpoch,
    nonce: quote.nonce, deadline: Math.min(request.expiresAt, quote.deadline), relayer: address(quote.relayerAddress),
    nullifiersHash: "", outputsHash: terms.outputsHash, envelopesHash: enhancedHashEnvelopes(envelopes), feeSlots: [1, 2, 3] };
  const privatePlan = { domain, operation: isBatch ? "public-batch" : "enhanced", quote, selected, outputs, envelopes, header, amountSalt, authorizationWitness,
    authorizationSignals: signals, claims, publicBatch: batch ?? null, aggregateWitness: aggregateWitness ?? null,
    protocolRecipient: address(protocolRecipient[0]), partnerRecipient: address(partnerRecipient[0]),
    feeSigner: address(feeSigner[0]), padSeed: random(), targetRows, anchorBlock: targetBlock.number,
    review: { intentId: request.intentId, netPayoutAtomic: input.amountAtomic,
      protocolFeeAtomic: quote.protocolFeeAtomic, partnerFeeAtomic: quote.partnerFeeAtomic, gasReserveAtomic: quote.gasReserveAtomic,
      totalDebitAtomic: quote.totalDebitAtomic, asset: context.assetSymbol, windowSeconds: isBatch ? 0 : schedule.windowEpochs * 60,
      ...(isBatch ? { payments: input.payments.map(p => ({ ...p })) } : {}),
      expiresAt: Math.min(request.expiresAt, quote.deadline) } };
  const first = await enhancedWalletWitness({ wallet, plan: privatePlan, quoteDigest: field(1) });
  const preview = await funding.preview({ width: selected.width, ...first });
  if (!enhancedSame(preview.action.output_commitments, commitments) ||
      selected.notes.some((note, i) => preview.action.nullifiers[i] !== note.nullifier || preview.action.input_commitments[i] !== note.commitment)) fail();
  header.nullifiersHash = enhancedHashNullifiers(preview.action.nullifiers, selected.width);
  const digest = enhancedFundingDigest(header, domain, quote.policy.feePolicyHash);
  const [canonicalDigest] = await readEnhancedPool(provider, domain.pool, "enhancedFundingDigest", [header], targetBlock.number);
  if (canonicalDigest !== digest || (await provider.getBlock(targetBlock.number))?.hash !== targetBlock.hash) fail();
  privatePlan.signedDigest = digest; privatePlan.preview = preview.action;
  return {plan:privatePlan, preparedAuthorization};
}

export async function enhancedWalletWitness({ wallet, plan, quoteDigest = plan.signedDigest }) {
  const keys = await wallet.privateWalletKeys(), h = plan.header;
  const walletWitness = { schema: "vanta-wallet-witness-v1", checkpoint_ref: plan.selected.source.checkpoint,
    inputs: plan.selected.notes.map(({ opening: n }) => ({ npk: n.npk, token_hash: n.token_hash, value: field(n.amount_units), random: n.random,
      nullifying_key: field(keys.nullifyingKey), pub_key_x: field(keys.spendingPublicKey[0]), pub_key_y: field(keys.spendingPublicKey[1]) })),
    outputs: plan.outputs.map(n => ({ npk: n.npk, token_hash: n.token_hash, value: field(n.amount_units, true) })),
    withdraw_amount: field(plan.review.netPayoutAtomic), action_token_hash: plan.outputs[0].token_hash,
    spend_secret_scalar: field(keys.spendSecretScalar), pad_seed: plan.padSeed,
    action: { chain_id: field(plan.domain.chainId), pool: field(plan.domain.pool), action_type: field(6),
      source_table: field(h.sourceEpoch, true), target_table: field(h.targetEpoch, true), token_address: field(plan.domain.asset, true),
      recipient: field(plan.domain.pool), protocol_fee: field(0, true), protocol_fee_recipient: field(plan.protocolRecipient),
      partner_fee: field(0, true), partner_fee_recipient: field(plan.partnerRecipient, true), aux_data_hash: field(0, true) } };
  const hashBinding = { public_amount_hash: h.amountHash, private_amount_salt: plan.amountSalt,
    batch_digest_field: h.authorizationDigest, fee_quote_digest_field: field(BigInt(quoteDigest) % ENHANCED_FIELD),
    protocol_fee_cap: field(0, true), partner_fee_cap: field(0, true), leg_index: 0, fee_leg_index: 0, leg_count: 1 };
  return { walletWitness, hashBinding };
}
export function enhancedFeeWitness(plan) {
  const { quote: q, header: h, domain: d } = plan, p = q.policy, partner = q.collectors[1];
  const mode = plan.operation === "public-batch" ? 3 : 0;
  return { asset:BigInt(d.asset)===0n?"native":d.asset,basePartnerId:BigInt(partner.handleId),operation:mode,width:h.width,
    protocolBps: p.protocolBps, fee: { schema: "vanta-v8-unified-private-fee-witness-v1", chain_id: d.chainId, pool: d.pool, asset: d.asset,
      fee_policy_hash: p.feePolicyHash, minimum_protocol_fee_units: p.protocolMinimum,
      fee_caps_units: [q.protocolFeeAtomic, q.partnerFeeAtomic, q.gasReserveAtomic],
      collector_mpks: q.collectors.map(c => c.masterPublicKey), collector_salts: [q.collectors[0].collectorSalt, q.collectors[2].collectorSalt],
      fee_slots: [1, 2, 3], mode, width: h.width, gross_deposit_units: "0",
      outputs: plan.outputs.map(n => ({ npk: n.npk, value_units: n.amount_units, random: n.random })),
      terms_blinding: q.feeTermsBlinding, signed_quote_digest: plan.signedDigest, expected_fee_terms_hash: field(h.feeTermsHash) },
    partner: { schema: "vanta-v8-kzg-partner-witness-v1", signed_quote_digest: plan.signedDigest, signed_partner_nonce: q.nonce,
      partner_output_commitment: plan.outputs[2].commitment, private_fee_terms_hash: field(h.feeTermsHash),
      mode, width: h.width, gross_deposit_units: "0", amount_hash: h.amountHash, batch_digest: h.authorizationDigest,
      fee_leg_index: 0, base_partner_id: partner.handleId, partner_id: p.partnerId, version: field(p.partnerVersion),
      receiver_commitment: partner.receiverCommitment, collector_mpk: partner.masterPublicKey, receiver_salt: partner.receiverSalt,
      fee_bps: p.partnerBps, fee_minimum_units: p.partnerMinimum, fee_maximum_units: p.partnerMaximum,
      authorization_key: p.authorizationCommitment, quote_nonce_salt: q.nonceSalt, registry_slot: p.partnerSlot,
      fee_note_random: plan.outputs[2].random, fee_note_amount_units: q.partnerFeeAtomic,
      reference_amount_units: plan.review.netPayoutAtomic, amount_salt: plan.amountSalt } };
}
// Prepare fees during the local authorization proof. Start the four-shard
// work after that worker exits, overlapping the authorization's RPC checks.
// Wait for every job before returning control of the notes and runtimes.
export async function runEnhancedProofJobs({ sign, schedule, prepareFee, proveFee, fund, assertAuthority }) {
  const signing = sign();
  let authorizationProved;
  const localProof = new Promise(resolve => { authorizationProved = resolve; });
  const authorization = schedule(authorizationProved);
  const results = await Promise.allSettled([
    signing, authorization, (async () => {
      const [prepared] = await Promise.all([prepareFee(), Promise.race([localProof, authorization])]);
      assertAuthority();
      const feeProof = await proveFee(prepared);
      assertAuthority();
      return { ...feeProof, ...await fund() };
    })(),
  ]);
  for (const result of results) if (result.status === "rejected") throw result.reason;
  assertAuthority();
  return { signature: results[0].value, authorization: results[1].value, ...results[2].value };
}

export async function proveEnhancedPrivatePlan({ wallet, funding, components, fees, relay, plan, inventory, assertAuthority, preparedAuthorization }) {
  const witness = await enhancedWalletWitness({ wallet, plan });
  const preview = await funding.preview({ width: plan.header.width, ...witness });
  if (!enhancedSame(preview.action.nullifiers, plan.preview.nullifiers) ||
      !enhancedSame(preview.action.output_commitments, plan.preview.output_commitments)) fail();
  assertAuthority();
  const isBatch = plan.operation === "public-batch";
  async function sign() {
    const binding = { requestId: plan.quote.requestId, header: plan.header, nullifiers: preview.action.nullifiers, envelopes: plan.envelopes };
    const bound = isBatch ? await relay.bindBatch({ ...binding, batch: plan.publicBatch }) :
      await relay.bind({ ...binding, capabilities: plan.claims.map(c => c.capability) });
    if (bound.digest !== plan.signedDigest) fail();
    assertAuthority();
    const signed = await relay.sign({ requestId: plan.quote.requestId });
    if (signed.digest !== plan.signedDigest || address(recoverAddress(signed.digest, signed.signature)) !== plan.feeSigner) fail();
    return signed.signature;
  }
  async function prepareFee() {
    const prepared = await fees.prepare(enhancedFeeWitness(plan));
    if (prepared.role !== "enhanced-fee-partner" || prepared.safeForFunds !== false || prepared.publicSignals?.length !== 41) fail();
    return prepared;
  }
  async function proveFee(prepared) {
    return { fee: await fees.provePrepared({ prepared }), feeSignals: prepared.publicSignals };
  }
  async function schedule(onLocalProof) {
    const prepared = preparedAuthorization ?? await components.prepareAuthorization({ witness: plan.authorizationWitness });
    if (!enhancedSame(prepared.publicSignals, plan.authorizationSignals)) fail();
    return components.proveAuthorization({ authorization: prepared, onLocalProof });
  }
  async function fund() {
    const rows = [...await dummyPrefix(), ...inventory.publicCommitments
      .filter(row => row.epoch === plan.selected.source.epoch && row.row < plan.selected.source.rows).map(row => row.commitment)];
    if (rows.length !== plan.selected.source.rows) fail();
    const queryRows = [...plan.selected.notes.map(n => n.row),
      ...Array.from({ length: plan.header.width - plan.selected.notes.length }, (_, i) => i + plan.selected.notes.length)];
    if (queryRows.some((row, i) => rows[row] !== preview.action.input_commitments[i])) fail();
    const cache = await funding.publicCache({ snapshot: plan.selected.source, rows, queryRows });
    const bundle = await funding.prove({ width: plan.header.width, walletWitness: preview.walletWitness, hashBinding: witness.hashBinding,
      authenticatedWalletCache: cache, expectedPublicStatement: preview.action.public_statement,
      expectedCheckpointRef: plan.selected.source.checkpoint, expectedSourceEpoch: plan.selected.source.epoch });
    return { bundle, rowKeys: await funding.rowKeys(plan.targetRows) };
  }
  const common = { preview: preview.action, authorizationSignals: plan.authorizationSignals, publicPayoutAtomic: plan.review.netPayoutAtomic };
  if (!isBatch) return { ...common, ...await runEnhancedProofJobs({ sign, schedule, prepareFee, proveFee, fund, assertAuthority }) };
  const signature = await sign();
  const feeProof = await proveFee(await prepareFee());
  const aggregate = await funding.provePublicTotal({ walletWitness: plan.aggregateWitness,
    expectedPublicSignals: [plan.header.authorizationDigest, field(1), field(plan.review.netPayoutAtomic), plan.header.amountHash,
      ...Array(7).fill(field(0, true)), plan.domain.familyTag, field(plan.domain.chainId)] });
  const funded = await fund();
  assertAuthority();
  return { ...common, signature, ...feeProof, aggregate, ...funded };
}
