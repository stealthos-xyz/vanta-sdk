import {openStealthOSPartnerApp, openStealthOSPublicPayment, decodeVantaFamilyReceivingAddress,
  encodeVantaFamilyReceivingAddress, normalizeFamilyPrivateMemo} from '@stealthos/vanta-sdk';
import {createReview, readHistory, reconcile} from './flows.mjs';

const $ = id => document.getElementById(id);
const workerUrl = '/stealthos/app-wallet-worker.mjs';
const providers = window.ethereum?.providers?.length ? [...window.ethereum.providers] : window.ethereum ? [window.ethereum] : [];
providers.forEach((p, i) => $('provider').add(new Option('Injected wallet ' + (i + 1) + (p.isMetaMask ? ' (MetaMask)' : ''), String(i))));
let client = null, configuration, mode = null, unlocked = false, busy = false, epoch = 0, review = null, selectedAsset = 'native';
const result = value => { if (!client) return; $('result').textContent = JSON.stringify(value, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2) ?? ''; };
const status = value => { $('status').textContent = value; };
function invalidateReview() { review = null; $('review').textContent = 'No active review.'; $('approved').checked = false; $('submit').disabled = true; }
function clearSecrets() { $('password').value = ''; $('phrase').value = ''; $('backupFile').value = ''; }
function clearPrivateUI() { clearSecrets(); invalidateReview(); $('result').textContent = ''; for (const id of ['historyId','memo','destination','amount','payments','handle','paymentRecipient']) $(id).value = ''; }
function drop(message = 'Wallet locked.') {
  epoch++; const old = client; client = null; mode = null; unlocked = false;
  clearPrivateUI(); old?.dispose(); status(message);
}
function sync() {
  for (const el of document.querySelectorAll('button,input,select,textarea')) el.disabled = busy;
  $('walletPanel').disabled = busy || mode !== 'wallet';
  $('txPanel').disabled = busy || !client || (mode === 'wallet' && !unlocked);
  $('historyPanel').disabled = $('txPanel').disabled;
  $('submit').disabled = busy || !review || !$('approved').checked;
  for (const id of ['balance','receive','selectAsset','checkHandle','claimHandle','currentHandle','backup','importBackup']) $(id).disabled = busy || !unlocked;
  $('recoverEnhanced').disabled = busy || mode !== 'wallet' || !unlocked || $('kind').value !== 'enhanced';
}
function safeError(error) {
  const code = typeof error?.code === 'string' && /^[A-Z_]{1,64}$/.test(error.code) ? error.code : error?.code === 4001 ? 'USER_REJECTED' : 'REQUEST_FAILED';
  return code + '. Check the selected account, config and original journal. Do not automatically resend.';
}
function run(id, task) {
  $(id).addEventListener('click', async () => {
    if (busy) return;
    busy = true; sync();
    try { await task(); } catch (error) { invalidateReview(); status(safeError(error)); }
    finally { busy = false; sync(); }
  });
}
async function connect(nextMode) {
  const provider = providers[Number($('provider').value)];
  const paymentRecipient = $('paymentRecipient').value.trim();
  drop('Opening wallet...');
  if (!provider?.request) throw new Error('Choose an injected EIP-1193 provider.');
  const revision = epoch;
  await provider.request({method:'eth_requestAccounts'});
  if (BigInt(await provider.request({method:'eth_chainId'})) !== 6281971n) throw new Error('Switch your wallet to DogeOS Chikyu.');
  const response = await fetch('/stealthos-partner-config.json', {cache:'no-store', redirect:'error'});
  if (!response.ok) throw new Error('Download your portal configuration.');
  configuration = await response.json();
  if (configuration.sdkVersion !== '0.4.65' || configuration.networkId !== 'eip155:6281971' || !configuration.verificationRpcUrl) throw new Error('Use matching testnet configuration and independent RPC.');
  const onLocked = () => {
    if (revision !== epoch) return;
    const previous = client; client = null; mode = null; unlocked = false; epoch++;
    clearPrivateUI(); status('Wallet context changed. Reconnect and reconcile.');
    queueMicrotask(() => previous?.dispose()); sync();
  };
  const options = {configuration, provider, workerUrl, onLocked};
  const opened = nextMode === 'payment' ? await openStealthOSPublicPayment({...options, recipient:paymentRecipient}) : await openStealthOSPartnerApp(options);
  if (revision !== epoch) { opened.dispose(); return; }
  client = opened; mode = nextMode; unlocked = nextMode === 'payment'; selectedAsset = 'native'; $('asset').value = 'native';
  $('kind').value = nextMode === 'payment' ? 'payment' : 'deposit';
  status(nextMode === 'payment' ? 'Public payment connected. Review a testnet payment.' : 'Connected. Create or restore the private wallet.');
  if (mode === 'wallet') result({hasBackup:client.hasBackup, requirePassword:client.requirePassword, canUnlockWithoutPassword:client.canUnlockWithoutPassword});
  else result(client.context);
}
async function walletOpen(action) {
  const current = client, rev = epoch;
  if (!current || mode !== 'wallet') throw new Error('Connect wallet.');
  const password = $('password').value, phrase = $('phrase').value.trim();
  clearSecrets();
  try { await action(current, password, phrase); }
  finally { clearSecrets(); }
  if (rev !== epoch || current !== client) return;
  unlocked = true; status('Wallet open. Cached balance is display-only. Recover verified notes next.');
  result({cached:current.getCachedBalance()});
}
run('connect', () => connect('wallet'));
run('connectPayment', () => connect('payment'));
run('lock', () => drop());
run('create', () => walletOpen((w,password) => w.createPrivateWallet({
  password, confirmRecoveryPhrase:async phrase => window.confirm('Store this recovery phrase safely offline. Never share it.\n\n'+phrase+'\n\nConfirm only after you have recorded it.')
})));
run('restore', () => walletOpen((w,password,phrase) => w.restoreWallet({password, ...(phrase ? {phrase} : {})})));
run('remembered', () => walletOpen(w => w.unlockRememberedWallet()));
run('selectAsset', async () => { invalidateReview(); await client.selectAsset($('asset').value.trim().toLowerCase()); selectedAsset = $('asset').value.trim().toLowerCase(); result({cached:client.getCachedBalance()}); status('Asset selected. Recover verified balance.'); });
run('balance', async () => { const cached = client.getCachedBalance(); result({displayOnly:cached}); const value = await client.recoverNotes(); result(value); status('Recovery response. Inspect verified and available balances.'); });
run('receive', async () => result({address:encodeVantaFamilyReceivingAddress(await client.receivingAddress())}));
run('checkHandle', async () => result(await client.handleAvailable($('handle').value.trim())));
run('claimHandle', async () => { if (window.confirm('Claim this handle for the connected private wallet?')) result(await client.claimHandle($('handle').value.trim())); });
run('currentHandle', async () => result(await client.currentHandle()));
run('backup', async () => {
  const encrypted = await client.exportRecoveryBackup();
  const url = URL.createObjectURL(new Blob([encrypted], {type:'application/json'}));
  const a = document.createElement('a'); a.href=url; a.download='vanta-encrypted-backup.json'; a.click(); URL.revokeObjectURL(url);
  status('Encrypted backup exported. Store securely.');
});
run('importBackup', async () => { const file = $('backupFile').files[0]; if (!file) throw new Error('Select backup.'); result(await client.importRecoveryBackup(file)); $('backupFile').value=''; });
const selectedKind = () => {
  const kind = $('kind').value;
  if ((mode === 'payment') !== (kind === 'payment')) throw new Error('Connect the matching wallet/payment mode.');
  return kind;
};
run('quote', async () => {
  invalidateReview();
  const current = client, rev = epoch, kind = selectedKind();
  if (mode === 'wallet' && $('asset').value.trim().toLowerCase() !== selectedAsset) throw new Error('Select the entered asset before quoting.');
  const input = {kind, amountAtomic:$('amount').value.trim(), destination:$('destination').value.trim(), partnerHandle:configuration.partnerHandle, slippageBps:Number($('slippage').value)};
  if (kind === 'batch') input.payments = JSON.parse($('payments').value);
  if (kind === 'private') {
    input.recipient = $('recipientKind').value === 'handle' ? await current.resolveHandle(input.destination) : decodeVantaFamilyReceivingAddress(input.destination);
    input.memo = normalizeFamilyPrivateMemo($('memo').value);
  }
  const next = await createReview(current,input);
  if (rev !== epoch || client !== current) return;
  review = next;
  $('review').textContent = JSON.stringify({...next.display, expiresAtIso:new Date(next.display.expiry * 1000).toISOString(), selectedAsset:mode === 'wallet' ? selectedAsset : client.context.assetAddress}, null, 2);
  status('Review exact terms and approve explicitly.');
});
run('submit', async () => {
  const active = review;
  if (!active || !$('approved').checked) throw new Error('Approve a fresh review.');
  invalidateReview();
  const rev=epoch;
  status('Preparing and submitting. Keep this page open; do not repeat the action.');
  const state = await active.submit(true);
  if (rev !== epoch) return;
  result(state); status('Latest SDK response. Check the operation-specific phase and delivery/finality; reconcile history if pending.');
});
run('history', async () => { invalidateReview(); result(await readHistory(client, selectedKind())); status('Local history returned. Reconcile the original ID if uncertain.'); });
run('reconcile', async () => { invalidateReview(); result(await reconcile(client, selectedKind(), $('historyId').value)); status('Canonical reconciliation response. Inspect operation-specific completion.'); });
run('recoverEnhanced', async () => { invalidateReview(); result(await client.getEnhancedHost().recover({transactionId:$('historyId').value.trim()})); });
for (const id of ['kind','amount','destination','recipientKind','memo','slippage','payments','asset','provider','paymentRecipient']) {
  $(id).addEventListener('input', () => { invalidateReview(); sync(); });
}
$('approved').addEventListener('change', sync);
window.addEventListener('pagehide', () => drop());
sync();
