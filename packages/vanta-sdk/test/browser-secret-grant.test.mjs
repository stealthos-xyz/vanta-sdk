// Exercise the exact host credential grant and actual message-handler branch.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {transform} from 'esbuild';
const source=await readFile(new URL('../browser/app-wallet.ts',import.meta.url),'utf8');
const slice=(from,to)=>{const a=source.indexOf(from),b=source.indexOf(to,a);assert(a>=0&&b>a);return source.slice(a,b);};
const grant=slice('function createWalletSecretGrant(', 'export async function createStealthOSAppWallet');
const dispatch=slice('        if (["password", "restorePhrase", "confirmBackup"].includes(data.kind)) {','        else if (data.kind === "relayFetch"');
const js=await transform(`const unavailable=()=>Error('Unauthorized wallet credential request');
${grant}
export {createWalletSecretGrant};
export function harness(name,ui){
 let secretGrant=createWalletSecretGrant(name,ui),revision=1,session={wallet:'wallet',expiresAt:Date.now()/1000+60},port={},sessionBearer='session';
 let current=session, selectedWallet='wallet', token='session';
 const selected=async()=>selectedWallet,authorization=async()=>token;
 return {revoke(){secretGrant=null;},changeWallet(){selectedWallet='other';},changeToken(){token='other';},lock(){revision++;secretGrant=null;},async request(kind,value){
   const active=revision,target=port,data={kind,value};let result;
   ${dispatch}
   return result;
 }};
}`,{loader:'ts',format:'esm',target:'es2022'});
const {harness}=await import('data:text/javascript;base64,'+Buffer.from(js.code).toString('base64'));
const ui={password:'synthetic-password',phrase:'synthetic-recovery-phrase',confirm:async()=>true};
test('restore grant is ordered, one-shot and rejects repeated credential requests',async()=>{
 const h=harness('restore',ui);
 await assert.rejects(h.request('restorePhrase'),/Unauthorized/);
 assert.equal(await h.request('password'),ui.password);
 await assert.rejects(h.request('password'),/Unauthorized/);
 assert.equal(await h.request('restorePhrase'),ui.phrase);
 await assert.rejects(h.request('restorePhrase'),/Unauthorized/);
 await assert.rejects(h.request('confirmBackup','synthetic'),/Unauthorized/);
});
test('unlock and autoUnlock cannot request recovery phrases or backup approval',async()=>{
 const h=harness('unlock',ui);assert.equal(await h.request('password'),ui.password);
 await assert.rejects(h.request('restorePhrase'),/Unauthorized/);
 await assert.rejects(h.request('confirmBackup','synthetic'),/Unauthorized/);
 const auto=harness('autoUnlock',ui);
 for(const kind of ['password','restorePhrase','confirmBackup'])await assert.rejects(auto.request(kind,'synthetic'),/Unauthorized/);
});
test('create confirmation requires a password and may run once',async()=>{
 let count=0;const h=harness('create',{...ui,confirm:async()=>{count++;return true;}});
 await assert.rejects(h.request('confirmBackup','synthetic'),/Unauthorized/);
 const requests=await Promise.allSettled([h.request('password'),h.request('password')]);
 assert.equal(requests.filter(x=>x.status==='fulfilled').length,1);
 await assert.rejects(h.request('restorePhrase'),/Unauthorized/);
 assert.equal(await h.request('confirmBackup','synthetic'),true);
 await assert.rejects(h.request('confirmBackup','synthetic'),/Unauthorized/);
 assert.equal(count,1);
});
test('grant revocation and context changes deny credentials',async()=>{
 const h=harness('restore',ui);h.revoke();await assert.rejects(h.request('password'),/Unauthorized/);
 const wallet=harness('restore',ui);wallet.changeWallet();await assert.rejects(wallet.request('password'),/Unauthorized/);
 const token=harness('restore',ui);token.changeToken();await assert.rejects(token.request('password'),/Unauthorized/);
 const locked=harness('restore',ui);const pending=locked.request('password');locked.lock();await assert.rejects(pending,/Unauthorized/);
});
test('late asynchronous backup confirmation is not returned after revocation',async()=>{
 let resolve,entered;const called=new Promise(r=>{entered=r;});
 const h=harness('create',{...ui,confirm:()=>{entered();return new Promise(r=>{resolve=r;});}});
 await h.request('password');const pending=h.request('confirmBackup','synthetic');await called;
 h.revoke();resolve(true);await assert.rejects(pending,/Unauthorized/);
});
test('host installs a grant only in the queued command and clears it on completion or stop',()=>{
 assert.match(source,/const operation = queue\.then\(async \(\) => \{[\s\S]*?const grant = ui \? createWalletSecretGrant\(name, ui\) : null;[\s\S]*?if \(grant\) secretGrant = grant;[\s\S]*?await send\(\{kind: "invoke", command: name, payload\}\)[\s\S]*?finally \{\s*if \(grant && secretGrant === grant\) secretGrant = null;/);
 assert.match(source,/revision\+\+; worker\?\.terminate\(\);[^\n]*secretGrant = null/);
 assert.match(source,/opened = await command<OpenedWallet>\(name, \{\}, ui\)/);
 assert.doesNotMatch(source,/secretUi/);
});
