import {hexlify,toUtf8Bytes,verifyMessage} from 'ethers';
import {createStealthOSAppWallet} from './app-wallet.mjs';
import {getCompiledFamilyEvmRelease} from '../fresh/family-network.mjs';
import {normalizePartnerApplication,partnerApplicationHash} from '../fresh/partner-application.mjs';
import {resolvePartnerRpcEndpoints} from '../fresh/family-rpc.mjs';
import {STEALTHOS_SDK_VERSION} from '../fresh/sdk-version.mjs';
export {STEALTHOS_SDK_VERSION};
export async function openStealthOSPartnerApp({configuration:c,provider,asset='native',workerUrl,onLocked,paymentRecipient}){
 const release=getCompiledFamilyEvmRelease(),origin=globalThis.location.origin;
 if(c?.schema!=='stealthos-partner-integration-v1'||c.sdkVersion!==STEALTHOS_SDK_VERSION||c.networkId!==release.pins.networkId||
  c.generationId!==release.pins.generationId||!/^0x[0-9a-f]{64}$/u.test(c.handleId??'')||!provider?.request)throw Error('Load the public configuration for this signed SDK release.');
 for(const key of ['serviceUrl','artifactBaseUrl','assetConfigurationUrl','rpcUrl']){const u=new URL(c[key]);if(u.protocol!=='https:'||u.username||u.password||u.hash)throw Error('HTTPS app service configuration required.');}
 if(new URL(c.assetConfigurationUrl).origin!==new URL(c.serviceUrl).origin)throw Error('App configuration service differs.');
 const rpc=resolvePartnerRpcEndpoints(c.rpcUrl,c.verificationRpcUrl);
 const application=normalizePartnerApplication(c.application);
 if(!application.origins.includes(origin))throw Error('This app origin is not registered by the partner.');
 // Presentation/login reads public settings, not the entire deployment. The
 // session service admits this registered origin/identity, and operation hosts
 // still authenticate owner policy on chain before any funded action.
 const response=await fetch(c.assetConfigurationUrl,{cache:'no-store',redirect:'error'});
 if(!response.ok)throw Error('Partner asset settings are unavailable.');
 const text=await response.text();if(text.length>16384)throw Error('Invalid partner settings.');
 const current=JSON.parse(text).authorization?.configuration;
 if(current?.handleId!==c.handleId||current.handle!==c.partnerHandle||current.networkId!==c.networkId||
  current.generationId!==c.generationId||current.setupId!==release.pins.setupId||partnerApplicationHash(current.app)!==partnerApplicationHash(application))
  throw Error('Public app configuration differs from its registered identity.');
 let token=null,expires=0,wallet=null;
 const post=async(path,body)=>{const response=await fetch(new URL('/api/vanta-v8/session/'+path,c.serviceUrl),{method:'POST',credentials:'omit',redirect:'error',
  headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const text=await response.text();if(text.length>16384)throw Error('Invalid app session response.');const value=JSON.parse(text);if(!response.ok)throw Error(value.error||'App session unavailable.');return value;};
 const getSessionToken=async()=>{
  const accounts=await provider.request({method:'eth_accounts'}),selected=accounts?.[0]?.toLowerCase();
  if(!/^0x[0-9a-f]{40}$/u.test(selected??''))throw Error('Connect your app wallet first.');
  if(token&&wallet===selected&&expires>Date.now()/1000+30)return token;
  const challenge=await post('nonce',{wallet:selected,partnerHandleId:c.handleId});
  const expected=['Sign in to StealthOS',`App: ${origin}`,`Network: ${c.networkId}`,`Generation: ${c.generationId}`,`Partner: ${c.handleId}`,`Wallet: ${selected}`].join('\n');
  if(typeof challenge.message!=='string'||!challenge.message.startsWith(expected+'\n')||challenge.message.length>1500)throw Error('Unexpected app sign-in request.');
  const signature=await provider.request({method:'personal_sign',params:[hexlify(toUtf8Bytes(challenge.message)),selected]});
  if(verifyMessage(challenge.message,signature).toLowerCase()!==selected)throw Error('App account changed.');
  const session=await post('verify',{challenge:challenge.challenge,signature});
  if(session.wallet!==selected||session.partnerHandleId!==c.handleId||typeof session.token!=='string'||session.expiresAt<=Date.now()/1000)throw Error('Unexpected app session.');
  token=session.token;expires=session.expiresAt;wallet=selected;return token;
 };
 const bridge=await createStealthOSAppWallet({provider,asset,workerUrl,getSessionToken,serviceUrl:c.serviceUrl,...(paymentRecipient?{paymentRecipient}:{}),
  rpcUrl:rpc.primary,verificationRpcUrl:rpc.verification,artifactBaseUrl:c.artifactBaseUrl,assetConfiguration:{url:c.assetConfigurationUrl,handleId:c.handleId},
  onLocked});
 let previewPending;
 async function fetchNetworkGas(){
   bridge.getEnhancedHost();
   const bearer=token,account=wallet;
   if(!bearer||expires<=Date.now()/1000+5)throw Error('Current wallet session required.');
   const accounts=await provider.request({method:'eth_accounts'});
   if(accounts?.[0]?.toLowerCase()!==account)throw Error('Wallet account changed.');
   const response=await fetch(new URL('/api/vanta-v8/normal/network-gas',c.serviceUrl),{
    method:'POST',credentials:'omit',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(8000),
    headers:{Authorization:'Bearer '+bearer,'Content-Type':'application/json'},body:'{}'});
   if(!response.ok)throw Error('Network fee preview unavailable.');
   const value=await response.json();
   bridge.getEnhancedHost();
   if(token!==bearer||wallet!==account||!Number.isSafeInteger(value?.blockNumber)||value.blockNumber<0||
    !/^0x[0-9a-f]{64}$/u.test(value.blockHash)||!/^[1-9][0-9]{0,36}$/u.test(value.gasPriceWei))throw Error('Invalid network fee preview.');
   return {gasPriceWei:value.gasPriceWei,blockNumber:value.blockNumber,blockHash:value.blockHash};
 }
 return Object.freeze({...bridge,
  previewNetworkGas(){
   return previewPending??=fetchNetworkGas().finally(()=>{previewPending=undefined;});
  },
  currentHandle:()=>bridge.currentHandle([c.partnerHandle]),
  quoteDeposit:input=>bridge.quoteDeposit({...input,partnerHandle:c.partnerHandle}),
  prepareDeposit:input=>bridge.prepareDeposit({...input,partnerHandle:c.partnerHandle}),
  quotePrivateSend:input=>bridge.quotePrivateSend({...input,partnerHandle:c.partnerHandle}),
  quoteWithdrawal:input=>bridge.quoteWithdrawal({...input,partnerHandle:c.partnerHandle}),
  quotePublicBatch:input=>bridge.quotePublicBatch({...input,partnerHandle:c.partnerHandle}),
  quoteRouteFees:input=>bridge.quoteRouteFees({...input,partnerHandle:c.partnerHandle}),
  preparePrivateSend:input=>bridge.preparePrivateSend({...input,partnerHandle:c.partnerHandle}),
  prepareRoute:input=>bridge.prepareRoute({...input,partnerHandle:c.partnerHandle})});
}
/** Pay a request from an EOA. No private identity, phrase or password is created. */
export async function openStealthOSPublicPayment({configuration,provider,recipient,workerUrl,onLocked}){
 const {decodeVantaFamilyReceivingAddress}=await import('../fresh/family-normal-address.mjs');
 const target=decodeVantaFamilyReceivingAddress(recipient),asset=BigInt(target.asset)===0n?'native':target.asset;
 const bridge=await openStealthOSPartnerApp({configuration,provider,asset,workerUrl,onLocked,paymentRecipient:target});
 try{const context=await bridge.openPublicPayment();return Object.freeze({context,recipient,
  quotePayment:input=>bridge.quoteDeposit(input),approvePaymentAsset:input=>bridge.approvePaymentAsset(input),prepareReviewedPayment:input=>bridge.prepareReviewedDeposit(input),
  executePayment:input=>bridge.executeDeposit(input),reconcilePayment:input=>bridge.reconcileDeposit(input),
  listPendingPayments:()=>bridge.listPendingDeposits(),dispose:()=>bridge.dispose()});
 }catch(error){bridge.dispose();throw error;}
}
