import test,{mock} from 'node:test';import assert from 'node:assert/strict';
import {resolvePartnerRpcEndpoints} from '../fresh/family-rpc.mjs';
const primary='https://rpc.testnet.dogeos.com/',verification='https://rpc.ankr.com/dogeos_testnet';
test('distinct public RPC origins configure fallback and legacy callers use one endpoint',()=>{
 assert.deepEqual(resolvePartnerRpcEndpoints(primary,verification),{primary,verification,mode:'primary-fallback'});
 assert.equal(resolvePartnerRpcEndpoints(primary).mode,'single-endpoint');
});
test('same-origin paths and credentials cannot masquerade as independent providers',()=>{
 for(const bad of [primary,primary+'other','http://rpc.ankr.com/','https://user:secret@rpc.ankr.com/','https://rpc.ankr.com/?token=secret','https://rpc.ankr.com/#rpc','',null])
  assert.throws(()=>resolvePartnerRpcEndpoints(primary,bad));
});
test('actual partner app forwards the separately selected verification RPC to its worker host',async()=>{
 const word='0x'+'11'.repeat(32),gen='0x'+'22'.repeat(32),setup='0x'+'33'.repeat(32),origin='https://app.stealthos.xyz';
 const calls=[];mock.module('../fresh/family-network.mjs',{namedExports:{getCompiledFamilyEvmRelease:()=>({pins:{networkId:'eip155:6281971',generationId:gen,setupId:setup}})}});
 mock.module('../browser/app-wallet.mjs',{namedExports:{createStealthOSAppWallet:async options=>{calls.push(options);return {};}}});
 const {openStealthOSPartnerApp,STEALTHOS_SDK_VERSION}=await import('../browser/partner-app.mjs');
 const app={name:'Fixture',origins:[origin]},configuration={schema:'stealthos-partner-integration-v1',sdkVersion:STEALTHOS_SDK_VERSION,networkId:'eip155:6281971',generationId:gen,handleId:word,partnerHandle:'fixture.stealth',serviceUrl:'https://partners.stealthos.xyz',artifactBaseUrl:'https://partners.stealthos.xyz/assets/',assetConfigurationUrl:'https://partners.stealthos.xyz/assets/config',rpcUrl:primary,verificationRpcUrl:verification,application:app};
 Object.defineProperty(globalThis,'location',{value:{origin},configurable:true});
 const prev=globalThis.fetch;globalThis.fetch=async()=>Response.json({authorization:{configuration:{handleId:word,handle:configuration.partnerHandle,networkId:configuration.networkId,generationId:gen,setupId:setup,app}}});
 try{
  await openStealthOSPartnerApp({configuration,provider:{request:async()=>[]}});
  assert.equal(calls[0].rpcUrl,primary);assert.equal(calls[0].verificationRpcUrl,verification);
  await assert.rejects(openStealthOSPartnerApp({configuration:{...configuration,verificationRpcUrl:primary},provider:{request:async()=>[]}}),/distinct origin/);
  assert.equal(calls.length,1);
 }finally{globalThis.fetch=prev;delete globalThis.location;}
});
