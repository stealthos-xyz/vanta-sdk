const ADDRESS=/^0x[0-9a-f]{40}$/u,WORD=/^0x[0-9a-f]{64}$/u;
const check=(ok,message)=>{if(!ok)throw Error('Family routes: '+message);};
const exact=(v,keys)=>check(v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join()===keys.slice().sort().join(),'unexpected fields');
export function validateFamilyRoutedResources(raw,release,pools){
 exact(raw,['schema','gateway','sourceSelector','nativePool','usdcPool','bnmPool','usdc','bnm','muchFi','ccip','wrappedDoge','maximumDeliveryFee','destination']);
 check(raw.schema==='vanta-family-chikyu-routes-v1'&&release.pins.networkId==='eip155:6281971'&&raw.sourceSelector==='7254999290874773717','wrong route network');
 const pin=(value,name,deployed=false)=>{
  exact(value,deployed?['address','codehash','deploymentBlock']:['address','codehash']);
  const rows=release.lock.contracts.filter(c=>c.name===name);
  check(ADDRESS.test(value.address)&&BigInt(value.address)>0n&&WORD.test(value.codehash)&&BigInt(value.codehash)>0n&&rows.length===1&&
   rows[0].address.toLowerCase()===value.address&&rows[0].codehash.toLowerCase()===value.codehash,'unsigned route pin');
  if(deployed)check(Number.isSafeInteger(value.deploymentBlock)&&value.deploymentBlock>0,'missing deployment block');return Object.freeze({...value});
 };
 const gateway=pin(raw.gateway,'route-gateway',true),venues=Object.fromEntries(['muchFi','ccip','wrappedDoge'].map(n=>[n,pin(raw[n],'route-'+n.toLowerCase())]));
 check([raw.nativePool,raw.usdcPool,raw.bnmPool,raw.usdc,raw.bnm].every(v=>ADDRESS.test(v)&&BigInt(v)>0n)&&raw.usdc!==raw.bnm,'invalid route assets');
 for(const [pool,asset]of [[raw.nativePool,'0x'+'00'.repeat(20)],[raw.usdcPool,raw.usdc],[raw.bnmPool,raw.bnm]])
  check(pools.filter(p=>p.pool===pool&&p.asset===asset).length===1,'route pool differs from signed inventory');
 for(const [name,asset]of [['usdc-asset',raw.usdc],['ccip-bnm-asset',raw.bnm]])check(release.lock.contracts.filter(c=>c.name===name&&c.address.toLowerCase()===asset).length===1,'unsigned token');
 check(typeof raw.maximumDeliveryFee==='string'&&/^[1-9][0-9]{0,20}$/u.test(raw.maximumDeliveryFee)&&BigInt(raw.maximumDeliveryFee)<=100n*10n**18n,'invalid delivery fee bound');
 const d=raw.destination;exact(d,['chainId','selector','genesisHash','rpcUrl','token','tokenCodehash','router','routerCodehash','offRamp','offRampCodehash']);
 check(d.chainId===11155111&&d.selector==='16015286601757825753'&&WORD.test(d.genesisHash)&&[d.token,d.router,d.offRamp].every(v=>ADDRESS.test(v)&&BigInt(v)>0n)&&
  [d.tokenCodehash,d.routerCodehash,d.offRampCodehash].every(v=>WORD.test(v)&&BigInt(v)>0n),'invalid destination pins');
 const url=new URL(d.rpcUrl);check(url.protocol==='https:'&&!url.username&&!url.password&&!url.hash&&!url.search,'invalid destination RPC');
 return Object.freeze({...raw,gateway,...venues,destination:Object.freeze({...d})});
}
