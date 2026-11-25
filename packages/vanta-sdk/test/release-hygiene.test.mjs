import test from 'node:test';
import assert from 'node:assert/strict';
import {findReleaseWording} from '../scripts/check-release-hygiene.mjs';
import {createPinnedBindings} from '../fresh/family-binding-factories.mjs';

test('release wording rejects unfinished comments, demo entry points and prototype labels', () => {
  for (const text of ['// TODO: complete later', 'FIXME', 'const createVantaDemoIdentity = null;', 'mock token', 'experimental runtime', 'synthetic result', 'placeholder', 'research release', 'not implemented']) {
    assert.equal(findReleaseWording('fresh/wallet.mjs', text).length, 1, text);
  }
});

test('release wording preserves exact protocol markers and rejects new research copy', () => {
  assert.deepEqual(findReleaseWording('fresh/family-proof-driver.mjs', 'bundle.schema === "vanta-v8-epoch-8x5-browser-three-proof-research-v1"'), []);
  assert.deepEqual(findReleaseWording('fresh/family-network.mjs', '!item.name.includes("research")'), []);
  assert.deepEqual(findReleaseWording('fresh/family-note-delivery.mjs', 'note.research_only === true && note.safe_for_funds === false'), []);
  assert.deepEqual(findReleaseWording('fresh/family-deposit-host.mjs', 'await simulate(tx); // transaction simulation'), []);
  assert.equal(findReleaseWording('fresh/family-proof-driver.mjs', 'throw Error("research release")').length, 1);
});

test('pinned binding factories do not expose unused prototype functions', () => {
  for (const pin of ['591867f0acd91e884ffa9e1f31f5e33536222c1910f028ab76fcdec8210e2187', '3a345081630a321c1426be39c8bc93ed6959b9007af401b273c8b6a2bac0675c']) {
    const bindings = createPinnedBindings(pin);
    assert.equal(typeof bindings.default, 'function');
    assert.equal(typeof bindings.createVantaFamilyOwnedNote, 'function');
    for (const name of ['createVantaDemoIdentity', 'vantaDemoPublicAction', 'buildVantaResearchWalletCache']) assert.equal(name in bindings, false);
  }
});
