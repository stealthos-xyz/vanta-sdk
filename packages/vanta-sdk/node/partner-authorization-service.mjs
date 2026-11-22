import {DatabaseSync} from 'node:sqlite';
import {createFamilyPartnerAuthorizationHandler} from './family-partner-auth-handler.mjs';
import {createEncryptedPartnerWalletLoader} from './partner-wallet-loader.mjs';
/** Ready-to-host partner endpoint. Only the partner's server reads its vault.
 * No protocol JWT/HMAC secret is required: sessions are checked with the broker. */
export function createStealthOSPartnerAuthorizationService({configuration:c,databasePath,readBackup,readPassword,maximumDepositAtomic,maximumSessionAtomic,fetcher=fetch}){
 if(c?.schema!=='stealthos-partner-integration-v1'||!c.application?.origins?.length||
  ![maximumDepositAtomic,maximumSessionAtomic].every(v=>/^[1-9][0-9]{0,36}$/u.test(v??''))||BigInt(maximumDepositAtomic)>BigInt(maximumSessionAtomic)||typeof databasePath!=='string'||!databasePath)throw Error('Configure app identity, durable reservations and explicit authorization limits.');
 const broker=new URL(c.serviceUrl);if(broker.protocol!=='https:'||broker.username||broker.password||broker.search||broker.hash||broker.pathname!=='/')throw Error('Invalid session broker.');
 const db=new DatabaseSync(databasePath);db.exec('PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS partner_quote_reservations(app TEXT NOT NULL,intent TEXT NOT NULL,session TEXT NOT NULL,gross TEXT NOT NULL,PRIMARY KEY(app,intent));');
 const load=createEncryptedPartnerWalletLoader({partnerHandle:c.partnerHandle,handleId:c.handleId,readBackup,readPassword});
 const handler=createFamilyPartnerAuthorizationHandler({
  verifyOrigin:req=>c.application.origins.includes(req.headers.get('Origin'))&&new URL(req.url).href===c.application.authorizationUrl,
  verifySession:async req=>{
   const token=req.headers.get('Authorization');if(!/^Bearer \S+$/u.test(token??''))return null;
   const response=await fetcher(new URL('/api/vanta-v8/session/check',broker),{method:'POST',redirect:'error',headers:{Authorization:token,Origin:req.headers.get('Origin'),'Content-Type':'application/json'},body:'{}',signal:AbortSignal.timeout(15000)});
   if(!response.ok||Number(response.headers.get('content-length'))>16384)return null;
   const text=await response.text();if(text.length>16384)return null;const session=JSON.parse(text);
   return session.partnerHandleId===c.handleId&&session.appOrigin===req.headers.get('Origin')&&session.expiresAt>Date.now()/1000?session:null;
  },
  verifyCsrf:({webRequest,session})=>Boolean(webRequest.headers.get('Authorization'))&&session.appOrigin===webRequest.headers.get('Origin'),
  approveIntent:async intent=>{
   if(intent.handleId!==c.handleId||intent.request.payer.toLowerCase()!==intent.session.wallet||BigInt(intent.request.gross)>BigInt(maximumDepositAtomic))return {approved:false,reservationId:intent.intentId};
   const key=intent.session.wallet+':'+intent.session.expiresAt;db.exec('BEGIN IMMEDIATE');
   try{const rows=db.prepare('SELECT gross FROM partner_quote_reservations WHERE app=? AND session=?').all(c.handleId,key),used=rows.reduce((n,r)=>n+BigInt(r.gross),0n);
    if(used+BigInt(intent.request.gross)>BigInt(maximumSessionAtomic))throw Error('Session authorization limit reached.');
    db.prepare('INSERT INTO partner_quote_reservations VALUES(?,?,?,?)').run(c.handleId,intent.intentId,key,intent.request.gross);db.exec('COMMIT');return {approved:true,reservationId:intent.intentId};
   }catch{db.exec('ROLLBACK');return {approved:false,reservationId:intent.intentId};}
  },loadPartnerWallet:load});
 return Object.freeze({async fetch(request){
  const origin=request.headers.get('Origin');
  if(!c.application.origins.includes(origin))return new Response(JSON.stringify({error:'Denied'}),{status:403,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
  const response=request.method==='OPTIONS'?new Response(null,{status:204}):await handler(request),headers=new Headers(response.headers);
  headers.set('Access-Control-Allow-Origin',origin);headers.set('Vary','Origin');
  headers.set('Access-Control-Allow-Methods','POST, OPTIONS');headers.set('Access-Control-Allow-Headers','Authorization, Content-Type');
  headers.set('Cache-Control','no-store');return new Response(response.body,{status:response.status,headers});
 },close:()=>db.close()});
}
