/** Public application connector. This module holds no wallet, password,
 * recovery phrase, prover or executable update loader. */
export const STEALTHOS_WALLET_CORE_ORIGIN='https://wallet.stealthos.xyz';
const schema='stealthos-wallet-core-channel-v1',methods=new Set(['connect','balance','withdraw','status']);
export function connectStealthOSWalletCore({window:browser=globalThis.window}={}){
 if(!browser?.crypto?.getRandomValues||browser.location.protocol!=='https:')throw Error('Open the partner app over HTTPS.');
 const nonce=Array.from(browser.crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join(''),
  url=new URL('/',STEALTHOS_WALLET_CORE_ORIGIN);
 url.hash=new URLSearchParams({origin:browser.location.origin,nonce}).toString();
 const popup=browser.open(url.href,'stealthos-wallet-'+nonce,'popup,width=540,height=780');
 if(!popup)throw Error('Allow the StealthOS wallet window to open.');
 let port,closed=false,serial=0,readyResolve,readyReject,handshakeTimer,closeTimer;
 const pending=new Map(),ready=new Promise((resolve,reject)=>{readyResolve=resolve;readyReject=reject;});
 const close=()=>{if(closed)return;closed=true;browser.removeEventListener('message',handshake);
  browser.clearTimeout(handshakeTimer);browser.clearInterval(closeTimer);port?.close();
  const error=Error('StealthOS wallet connection closed.');readyReject(error);for(const p of pending.values())p.reject(error);pending.clear();};
 function handshake(event){
  if(event.origin!==STEALTHOS_WALLET_CORE_ORIGIN||event.source!==popup||event.data?.schema!==schema||
   event.data?.nonce!==nonce||event.data?.kind!=='ready'||port||closed)return;
  try{
  const channel=new (browser.MessageChannel??globalThis.MessageChannel)();port=channel.port1;
  port.onmessage=({data})=>{
   if(!data||data.schema!==schema||data.nonce!==nonce||!Number.isSafeInteger(data.id))return;
   const p=pending.get(data.id);if(!p)return;pending.delete(data.id);
   if(data.ok===true)p.resolve(data.result);else p.reject(Error(typeof data.error==='string'?data.error:'Wallet request declined.'));
  };port.onmessageerror=close;port.start();
  popup.postMessage({schema,nonce,kind:'bind'},STEALTHOS_WALLET_CORE_ORIGIN,[channel.port2]);
  browser.clearTimeout(handshakeTimer);readyResolve();
  }catch{close();}
 }
 browser.addEventListener('message',handshake);
 handshakeTimer=browser.setTimeout(close,30000);
 closeTimer=browser.setInterval(()=>{if(popup.closed)close();},500);
 const request=async(method,params={})=>{
  if(!methods.has(method)||JSON.stringify(params).length>4096)throw Error('Unsupported wallet request.');
  await ready;if(closed||popup.closed){close();throw Error('Reopen your StealthOS wallet.');}
  return new Promise((resolve,reject)=>{const id=++serial;pending.set(id,{resolve,reject});
   try{port.postMessage({schema,nonce,id,method,params});}catch{close();}});
 };
 // No automatic timeout while the user is reviewing a wallet action.
 ready.catch(()=>{});
 return Object.freeze({connect:()=>request('connect'),balance:selection=>request('balance',selection),
  withdraw:selection=>request('withdraw',selection),status:selection=>request('status',selection),close});
}
