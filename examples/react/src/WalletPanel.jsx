'use client';
import React,{useEffect,useRef,useState} from 'react';
import {openStealthOSPartnerApp,STEALTHOS_SDK_VERSION} from '@stealthos/vanta-sdk';

// Pass the selected EIP-1193 connector from your existing app.
export function WalletPanel({provider}){
 const client=useRef(null),epoch=useRef(0),working=useRef(false),password=useRef(null),phrase=useRef(null);
 const [busy,setBusy]=useState(false),[ready,setReady]=useState(false),[connected,setConnected]=useState(false);
 const [message,setMessage]=useState('Connect a supported testnet wallet.'),[amount,setAmount]=useState(''),[quote,setQuote]=useState(null),[approved,setApproved]=useState(false),[balance,setBalance]=useState(null),[history,setHistory]=useState(null);
 function clearReview(){setQuote(null);setApproved(false);}
 function reset(text){
  epoch.current++;const old=client.current;client.current=null;
  old?.dispose();setConnected(false);setReady(false);clearReview();setBalance(null);setHistory(null);
  if(password.current)password.current.value='';if(phrase.current)phrase.current.value='';
  setMessage(text);
 }
 useEffect(()=>{setConnected(false);setReady(false);clearReview();setBalance(null);setHistory(null);setMessage('Connect a supported testnet wallet.');return()=>{epoch.current++;const old=client.current;client.current=null;old?.dispose();};},[provider]);
 async function run(fn){
  if(working.current)return;
  working.current=true;setBusy(true);const stamp=epoch.current;
  try{await fn(stamp);}catch(error){if(stamp===epoch.current){clearReview();setMessage((typeof error?.code==='string'&&/^[A-Z_]{1,64}$/.test(error.code)?error.code:'REQUEST_FAILED')+'. Check wallet context and original history. Do not resend automatically.');}}
  finally{working.current=false;setBusy(false);}
 }
 function current(stamp){if(stamp!==epoch.current||!client.current)throw Error('Wallet context changed.');return client.current;}
 const connect=()=>run(async stamp=>{
  if(!provider?.request)throw Error('Select a compatible provider.');
  if(client.current)throw Error('Disconnect before switching.');
  await provider.request({method:'eth_requestAccounts'});
  const response=await fetch('/stealthos-partner-config.json',{cache:'no-store',redirect:'error'});
  if(!response.ok)throw Error('Partner configuration unavailable.');
  const configuration=await response.json();
  if(configuration.sdkVersion!==STEALTHOS_SDK_VERSION||!/^eip155:[1-9][0-9]*$/.test(configuration.networkId)||!configuration.verificationRpcUrl)throw Error('Use matching signed configuration and independent RPC.');
  if(BigInt(await provider.request({method:'eth_chainId'}))!==BigInt(configuration.networkId.split(':')[1]))throw Error('Switch to configured network.');
  const opened=await openStealthOSPartnerApp({configuration,provider,workerUrl:'/stealthos/app-wallet-worker.mjs',onLocked:()=>{
   if(stamp!==epoch.current)return;const old=client.current;client.current=null;epoch.current++;
   queueMicrotask(()=>old?.dispose());setConnected(false);setReady(false);clearReview();setBalance(null);setHistory(null);setMessage('Wallet locked. Reconnect and reconcile.');
   if(password.current)password.current.value='';if(phrase.current)phrase.current.value='';
  },onProgress:event=>{if(stamp===epoch.current&&event.state==='started')setMessage(event.stage+'...');}});
  if(stamp!==epoch.current){opened.dispose();return;}
  client.current=opened;setConnected(true);setMessage('Create or unlock the local wallet.');
 });
 const openWallet=create=>run(async stamp=>{
  const w=current(stamp),pw=password.current.value,recovery=phrase.current.value.trim();
  password.current.value='';phrase.current.value='';
  if(create)await w.createPrivateWallet({password:pw,confirmRecoveryPhrase:async words=>stamp===epoch.current&&window.confirm('Record these recovery words offline, then confirm.\n\n'+words)});
  else await w.restoreWallet({password:pw,...(recovery?{phrase:recovery}:{})});
  current(stamp);setReady(true);setMessage('Wallet open. Recover the canonical balance.');
 });
 const refresh=()=>run(async stamp=>{
  const w=current(stamp),state=await w.recoverNotes();current(stamp);
  setBalance(state.pools.map(p=>({asset:p.asset,decimals:p.assetDecimals,spendable:p.spendableBalanceUnits,available:p.availableBalanceUnits,verifiedEmpty:p.verifiedEmpty})));
  setMessage('Latest verified wallet response.');
 });
 const requestQuote=()=>run(async stamp=>{
  clearReview();if(!/^[1-9][0-9]{0,35}$/.test(amount)||BigInt(amount)>=2n**120n)throw Error('Positive atomic integer required.');
  const w=current(stamp),q=await w.quoteDeposit({amountAtomic:amount});current(stamp);
  setQuote(q);setMessage('Review exact fees, asset and amount.');
 });
 const submit=()=>run(async stamp=>{
  if(!quote||!approved||Date.now()/1000>=quote.deadline)throw Error('Review expired or not approved.');
  const q=quote,w=current(stamp);clearReview();
  setMessage('Preparing reviewed deposit. Keep this page open.');
  const p=await w.prepareReviewedDeposit({quoteId:q.quoteId});current(stamp);
  const sent=await w.executeDeposit({preparedId:p.preparedId});current(stamp);
  const state=await w.reconcileDeposit({preparedId:p.preparedId,transactionHash:sent.transactionHash});current(stamp);
  setHistory([{preparedId:state.preparedId,phase:state.phase,transactionHash:state.transactionHash}]);setMessage('Latest SDK response. Check finality; reconcile if pending.');
 });
 const readHistory=()=>run(async stamp=>{
  const w=current(stamp),rows=await w.listDepositHistory();current(stamp);setHistory(rows.map(r=>({preparedId:r.preparedId,phase:r.phase,transactionHash:r.transactionHash})));setMessage('Deposit history. Reconcile the original record.');
 });
 const reconcile=id=>run(async stamp=>{
  const w=current(stamp),r=await w.reconcileDeposit({preparedId:id});current(stamp);setHistory([{preparedId:r.preparedId,phase:r.phase,transactionHash:r.transactionHash}]);setMessage('Latest canonical reconciliation response.');
 });
 return <main><h1>Vanta React partner reference</h1><p>SDK {STEALTHOS_SDK_VERSION}. Registered test origin and test funds only. This small example demonstrates connection, wallet creation/recovery and reviewed deposits. Never screen-share private wallet details.</p>
 <p role="status">{message}</p><fieldset disabled={busy}><legend>Connect</legend><button disabled={connected||!provider} onClick={connect}>Connect</button><button disabled={!connected} onClick={()=>reset('Disconnected.')}>Lock / disconnect</button>{!provider&&<small>Select a wallet provider in your application.</small>}</fieldset>
 <fieldset disabled={busy||!connected||ready}><legend>Local wallet</legend><label>Password<input ref={password} type="password" autoComplete="off"/></label><label>Recovery phrase (restore only)<input ref={phrase} type="password" autoComplete="off"/></label><button onClick={()=>openWallet(true)}>Create</button><button onClick={()=>openWallet(false)}>Restore / unlock</button></fieldset>
 <fieldset disabled={busy||!ready}><legend>Balance</legend><button onClick={refresh}>Recover notes</button><pre>{balance&&JSON.stringify(balance,null,2)}</pre></fieldset>
 <fieldset disabled={busy||!ready}><legend>Deposit native asset</legend><label>Amount (atomic units)<input inputMode="numeric" value={amount} onChange={e=>{setAmount(e.target.value);clearReview();}}/></label><button onClick={requestQuote}>Get fee review</button>{quote&&<><pre>{JSON.stringify({amountAtomic:quote.amountAtomic,protocolFeeAtomic:quote.protocolFeeAtomic,partnerFeeAtomic:quote.partnerFeeAtomic,netAmountAtomic:quote.netAmountAtomic,asset:quote.asset,pool:quote.pool,deadline:quote.deadline},null,2)}</pre><p>Public wallet network gas is additional.</p><label><input type="checkbox" checked={approved} onChange={e=>setApproved(e.target.checked)}/> Approve these exact terms</label><button disabled={!approved} onClick={submit}>Prepare and submit</button></>}</fieldset>
 <fieldset disabled={busy||!ready}><legend>Reconciliation</legend><button onClick={readHistory}>Read deposit history</button>{history?.map(r=><div key={r.preparedId}><pre>{JSON.stringify(r,null,2)}</pre><button onClick={()=>reconcile(r.preparedId)}>Reconcile original</button></div>)}</fieldset></main>;
}
