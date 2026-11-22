import {pathToFileURL} from 'node:url';import {resolve} from 'node:path';
/** Real packaged client/session/bridge; deterministic worker and chain-read
 * transports. This tests app integration, not funded proof acceptance. */
import test from 'node:test';import assert from 'node:assert/strict';
import {Wallet,getBytes,verifyMessage} from 'ethers';
import {STEALTHOS_SDK_VERSION} from '../fresh/sdk-version.mjs';
test('an ordinary customer opens the packaged app without a partner admin and cannot redirect its fee handle',async t=>{
 if(!process.env.VANTA_BUILT_SDK_ROOT)return t.skip('Set VANTA_BUILT_SDK_ROOT to qualify the built package.');
 const packageRoot=pathToFileURL(resolve(process.env.VANTA_BUILT_SDK_ROOT)+'/');
 const {getCompiledFamilyEvmRelease}=await import(new URL('fresh/family-network.mjs',packageRoot));
 const {getCompiledVantaFamilyProofResources}=await import(new URL('fresh/family-proof-resources.mjs',packageRoot));
 const {familyBridgeRoutes}=await import(new URL('fresh/family-bridge-gateway.mjs',packageRoot));
 const chain=getCompiledFamilyEvmRelease(),customer=Wallet.createRandom(),origin='https://app.partner.example',handleId='0x'+'11'.repeat(32),generationId=chain.pins.generationId;
 const resources=getCompiledVantaFamilyProofResources(chain).funding, routes=resources.routes;
 const bridgePool=resources.pools.find(p=>p.pool===routes.bnmPool);
 const native=resources.pools.find(p=>BigInt(p.asset)===0n);
 const replacement=familyBridgeRoutes(chain,routes).gateway.address;
 assert.notEqual(replacement,routes.gateway.address);
 let transactionTarget=replacement,approvalTarget;
 const previous={window:globalThis.window,location:globalThis.location,Worker:globalThis.Worker,fetch:globalThis.fetch};
 const commands=[],signatures=[],relayPaths=[],events=new Map();let app;
 const configuration={schema:'stealthos-partner-integration-v1',sdkVersion:STEALTHOS_SDK_VERSION,networkId:chain.pins.networkId,generationId,partnerHandle:'partner.stealth',handleId,
  serviceUrl:'https://partners.stealthos.xyz',artifactBaseUrl:'https://partners.stealthos.xyz/api/vanta-v8/artifacts/',assetConfigurationUrl:'https://partners.stealthos.xyz/api/vanta-v8/partner/assets/'+handleId,rpcUrl:'https://rpc.invalid/',application:{name:'Partner app',origins:[origin]}};
 const provider={on:(n,f)=>events.set(n,f),removeListener:n=>events.delete(n),async request({method,params}){
  if(method==='eth_accounts')return [customer.address];if(method==='eth_chainId')return '0x'+BigInt(chain.pins.networkId.split(':')[1]).toString(16);
  if(method==='personal_sign'){signatures.push(params);return customer.signMessage(getBytes(params[0]));}throw Error('No transaction should be sent.');}};
 const message=['Sign in to StealthOS','App: '+origin,'Network: '+chain.pins.networkId,'Generation: '+generationId,'Partner: '+handleId,'Wallet: '+customer.address.toLowerCase(),'Nonce: fixture'].join('\n');
 globalThis.location={origin};globalThis.window={location:globalThis.location,addEventListener(){},removeEventListener(){}};
 globalThis.fetch=async(input,init)=>{const path=new URL(input).pathname;
  if(path==='/api/vanta-v8/partner/assets/'+handleId)return Response.json({authorization:{configuration:{handleId,handle:configuration.partnerHandle,networkId:configuration.networkId,generationId,setupId:chain.pins.setupId,app:configuration.application}}});
  const body=JSON.parse(init.body);
  if(path.endsWith('/nonce')){assert.equal(body.partnerHandleId,handleId);return Response.json({challenge:'fixture',message});}
  if(path.endsWith('/verify')){assert.equal(verifyMessage(message,body.signature),customer.address);return Response.json({token:'fixture-token',wallet:customer.address.toLowerCase(),partnerHandleId:handleId,expiresAt:Math.floor(Date.now()/1000)+3600});}
  assert.equal(init.headers.Authorization,'Bearer fixture-token');
  if(path==='/api/vanta-v8/normal/network-gas'){assert.deepEqual(body,{});return Response.json({gasPriceWei:'123',blockNumber:1,blockHash:'0x'+'12'.repeat(32)});}
  if(/^\/api\/vanta-v8\/(normal|routed)\//u.test(path)){relayPaths.push(path);return Response.json({verified:true});}
  assert.equal(path,'/api/vanta-v8/enhanced/session');
  return Response.json({success:true,result:{wallet:customer.address.toLowerCase(),networkId:chain.pins.networkId,subjectId:'customer-scope',sessionId:'customer-session',expiresAt:Math.floor(Date.now()/1000)+3600}});
 };
 globalThis.Worker=class{
  handlers=new Map();port=null;addEventListener(name,fn){this.handlers.set(name,fn);}terminate(){this.port?.close();}
  async postMessage(message,transfer){commands.push(message);let result;
   if(message.kind==='initialize'){this.port=transfer[0];assert.equal(message.config.session.wallet,customer.address.toLowerCase());result={hasBackup:false,release:{chainId:Number(chain.pins.networkId.split(':')[1]),generationId}};}
   else if(['create','selectAsset'].includes(message.command)){
    const pool=message.command==='create'?native:bridgePool;
    result={identity:{masterPublicKey:'1',viewingPublicKey:'0x'+'22'.repeat(32)},
     context:{networkId:chain.pins.networkId,generationId,pool:pool.pool,assetAddress:pool.asset},availability:{status:'qualified'}};
   }
   else if(message.command==='quoteDeposit')result={quoteId:'test-native-deposit',deadline:Date.now()/1000+600,payer:customer.address,pool:native.pool,asset:native.asset};
   else if(message.command==='prepareReviewedDeposit')result={preparedId:'fixture-deposit'};
   else if(message.command==='prepareReviewedRoute')result={preparedId:'bridge-fixture',operation:5,
    pool:bridgePool.pool,generationId,deadline:Date.now()/1000+600,transactionDigest:'0x'+'23'.repeat(32),transactionTarget};
   else if(message.command==='executeRoute'){
    const reviewed={preparedId:'bridge-fixture',operation:5,pool:bridgePool.pool,generationId,
     deadline:approvalTarget.deadline,transactionDigest:approvalTarget.transactionDigest,transactionTarget};
    const reply=await new Promise(resolve=>{
     this.port.onmessage=({data})=>resolve(data);this.port.start();this.port.postMessage({id:201,kind:'routedApprove',value:reviewed});
    });
    result={accepted:reply.ok&&reply.value===true};
   }
   else if(message.command==='listDeposits')result=message.payload.includeCompleted===true?[{preparedId:'completed-deposit',phase:'finalized'}]:[];
   else if(['quoteDeposit','preparePrivateSend','prepareRoute'].includes(message.command)){
    if(message.command==='preparePrivateSend'){
     let id=100;for(const lane of ['normal','routed'])for(const operation of ['gas','prequote','quote','submit','status','arbitrary-sign']){
      const path='/api/vanta-v8/'+lane+'/'+operation,reply=await new Promise(resolve=>{
       this.port.onmessage=({data})=>resolve(data);this.port.start();this.port.postMessage({id:++id,kind:'relayFetch',value:{path,body:'{}'}});
      });assert.equal(reply.ok,operation!=='arbitrary-sign',path);
     }
    }result={preparedId:'fixture-'+message.command};
   }
   else throw Error('Unexpected fixture command '+message.command);
   queueMicrotask(()=>this.handlers.get('message')?.({data:{id:message.id,kind:'result',result}}));
  }
 };
 try{const {openStealthOSPartnerApp}=await import(new URL('browser/partner-app.mjs',packageRoot));app=await openStealthOSPartnerApp({configuration,provider});
  await assert.rejects(app.previewNetworkGas());
  await app.createPrivateWallet({password:'fixture-only-password',confirmRecoveryPhrase:async()=>true});
  const gas=app.previewNetworkGas();assert.equal(app.previewNetworkGas(),gas);assert.equal((await gas).gasPriceWei,'123');
  assert.deepEqual(await app.listDepositHistory(),[{preparedId:'completed-deposit',phase:'finalized'}]);
  assert.deepEqual(await app.listPendingDeposits(),[]);
  await app.prepareDeposit({amountAtomic:'1',partnerHandle:'attacker.stealth'});
  await app.preparePrivateSend({amountAtomic:'1',partnerHandle:'attacker.stealth',recipient:{}});
  await app.prepareRoute({operation:4,amountAtomic:'1',partnerHandle:'attacker.stealth'});
  for(const name of ['quoteDeposit','preparePrivateSend','prepareRoute'])assert.equal(commands.find(c=>c.command===name).payload.partnerHandle,'partner.stealth');
  await app.selectAsset(bridgePool.asset);
  approvalTarget=await app.prepareReviewedRoute({operation:5,quoteId:'fixture'});
  assert.deepEqual(await app.executeRoute({operation:5,preparedId:'bridge-fixture'}),{accepted:true});
  transactionTarget=routes.gateway.address;
  assert.deepEqual(await app.executeRoute({operation:5,preparedId:'bridge-fixture'}),{accepted:false},'changed destination');
  approvalTarget=await app.prepareReviewedRoute({operation:5,quoteId:'fixture'});
  assert.deepEqual(await app.executeRoute({operation:5,preparedId:'bridge-fixture'}),{accepted:false},'obsolete gateway');
  assert.deepEqual(await app.listDepositHistory({historyAsset:'native'}),[{preparedId:'completed-deposit',phase:'finalized'}]);
  assert.equal(commands.at(-1).payload.historyAsset,'native');
  assert.equal(commands.filter(c=>c.command==='selectAsset').length,1);
  assert.equal(relayPaths.length,10);assert.ok(relayPaths.every(path=>!path.endsWith('/arbitrary-sign')));
  assert.equal(signatures.length,1);assert.equal(signatures[0][1],customer.address.toLowerCase());
 }finally{app?.dispose();Object.assign(globalThis,previous);}
});
