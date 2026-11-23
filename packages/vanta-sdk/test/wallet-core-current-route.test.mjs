import test from 'node:test';
import assert from 'node:assert/strict';
import {connectStealthOSWalletCore,STEALTHOS_WALLET_CORE_ORIGIN} from '../fresh/wallet-core-client.mjs';

test('partner popup opens the current signed wallet root and preserves origin/nonce handshake checks',async()=>{
 const listeners=new Map(),posted=[],timers=[];
 const popup={closed:false,postMessage:(message,target,ports)=>posted.push({message,target,ports})};
 let opened;
 const browser={
  crypto:{getRandomValues:bytes=>bytes.fill(0xa5)},
  location:{protocol:'https:',origin:'https://partner.example'},
  open:(href,name,features)=>{opened={href,name,features};return popup;},
  addEventListener:(kind,listener)=>listeners.set(kind,listener),
  removeEventListener:(kind)=>listeners.delete(kind),
  setTimeout:(fn)=>{timers.push(fn);return timers.length;},
  clearTimeout:()=>{},setInterval:()=>1,clearInterval:()=>{},
  MessageChannel:class{
   constructor(){this.port1={start:()=>{},close:()=>{},postMessage:message=>queueMicrotask(()=>this.port1.onmessage({data:{
    schema:'stealthos-wallet-core-channel-v1',nonce:message.nonce,id:message.id,ok:true,result:{connected:true}}}))};this.port2={};}
  }
 };
 const core=connectStealthOSWalletCore({window:browser}),url=new URL(opened.href);
 assert.equal(url.origin,STEALTHOS_WALLET_CORE_ORIGIN);
 assert.equal(url.pathname,'/');
 assert.equal(url.search,'');
 assert.equal(new URLSearchParams(url.hash.slice(1)).get('origin'),'https://partner.example');
 const nonce=new URLSearchParams(url.hash.slice(1)).get('nonce');
 assert.match(nonce,/^[0-9a-f]{64}$/u);
 assert.equal(opened.name,'stealthos-wallet-'+nonce);
 const ready={schema:'stealthos-wallet-core-channel-v1',nonce,kind:'ready'};
 listeners.get('message')({origin:'https://attacker.example',source:popup,data:ready});
 listeners.get('message')({origin:STEALTHOS_WALLET_CORE_ORIGIN,source:{},data:ready});
 listeners.get('message')({origin:STEALTHOS_WALLET_CORE_ORIGIN,source:popup,data:{...ready,nonce:'00'.repeat(32)}});
 assert.equal(posted.length,0);
 listeners.get('message')({origin:STEALTHOS_WALLET_CORE_ORIGIN,source:popup,data:ready});
 assert.equal(posted.length,1);
 assert.equal(posted[0].target,STEALTHOS_WALLET_CORE_ORIGIN);
 assert.equal(posted[0].message.nonce,nonce);
 assert.deepEqual(await core.connect(),{connected:true});
 core.close();
});
