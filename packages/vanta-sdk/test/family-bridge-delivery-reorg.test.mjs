import test from 'node:test';
import assert from 'node:assert/strict';
import {Interface,keccak256,zeroPadValue} from 'ethers';
import {composeFamilyBridgeDeliveryMonitor} from '../fresh/family-bridge-delivery.mjs';

const address=n=>'0x'+n.toString(16).padStart(40,'0');
const word=n=>'0x'+n.toString(16).padStart(64,'0');
const code='0x6000',genesis=word(1),startHash=word(100),oldHash=word(200),oldHeadHash=word(201),deliveryHash=word(300),newHeadHash=word(301),laterHash=word(302);
const token=address(10),router=address(11),offRamp=address(12),receiver=address(13),sender=address(14),messageId=word(15),txHash=word(16),amount=123n;
const routes={sourceSelector:'7254999290874773717',destination:{chainId:11155111,genesisHash:genesis,token,router,offRamp,
 tokenCodehash:keccak256(code),routerCodehash:keccak256(code),offRampCodehash:keccak256(code)}};
const rampAbi=new Interface(['event ExecutionStateChanged(uint64 indexed sourceChainSelector,uint64 indexed sequenceNumber,bytes32 indexed messageId,uint8 state,bytes returnData)']);
const tokenAbi=new Interface(['event Transfer(address indexed from,address indexed to,uint256 value)']);
const routerAbi=new Interface(['function isOffRamp(uint64,address) view returns(bool)']);
const rampEvent=rampAbi.encodeEventLog(rampAbi.getEvent('ExecutionStateChanged'),[routes.sourceSelector,1n,messageId,2n,'0x']);
const tokenEvent=tokenAbi.encodeEventLog(tokenAbi.getEvent('Transfer'),[sender,receiver,amount]);
const event={address:offRamp,topics:rampEvent.topics,data:rampEvent.data,transactionHash:txHash,blockNumber:102,blockHash:deliveryHash,removed:false};
const transfer={address:token,topics:tokenEvent.topics,data:tokenEvent.data,transactionHash:txHash,blockNumber:102,blockHash:deliveryHash,removed:false};
const receipt={hash:txHash,status:1,blockNumber:102,blockHash:deliveryHash,logs:[event,transfer]};

test('saved scan anchor rewinds after a reorg; a saved delivery is checked again',async()=>{
 let branch='old';const ranges=[];
 const provider={
  getNetwork:async()=>({chainId:11155111n}),
  getBlock:async height=>{
   if(height===0)return {number:0,hash:genesis};
   if(height===100)return {number:100,hash:startHash};
   if(branch==='old'){
    if(height==='latest'||height===103)return {number:103,hash:oldHeadHash,parentHash:oldHash};
    if(height===102)return {number:102,hash:oldHash};
   }else{
    if(height==='latest'||height===104)return {number:104,hash:laterHash,parentHash:newHeadHash};
    if(height===103)return {number:103,hash:newHeadHash,parentHash:deliveryHash};
    if(height===102)return {number:102,hash:deliveryHash};
   }
   throw Error('Unexpected block '+height);
  },
  getCode:async()=>code,
  call:async()=>routerAbi.encodeFunctionResult('isOffRamp',[true]),
  getLogs:async filter=>{ranges.push({branch,from:filter.fromBlock,to:filter.toBlock});return branch==='delivered'&&filter.fromBlock<=102&&filter.toBlock>=102?[event]:[];},
  getTransactionReceipt:async hash=>branch==='delivered'&&hash===txHash?receipt:null,
  destroy(){}
 };
 const monitor=composeFamilyBridgeDeliveryMonitor({routes,provider});
 const input={messageId,receiver,amountAtomic:String(amount),start:{number:100,hash:startHash}};
 const old=await monitor.monitor(input);assert.equal(old.phase,'awaiting-delivery');assert.equal(old.scanBlock,103);assert.deepEqual(old.scanAnchor,{number:102,hash:oldHash});
 branch='delivered';const restarted=composeFamilyBridgeDeliveryMonitor({routes,provider});
 const afterReorg=await restarted.monitor({...input,scanBlock:old.scanBlock,scanAnchor:old.scanAnchor});
 assert.equal(afterReorg.phase,'delivered-finalized');assert.equal(afterReorg.transactionHash,txHash);
 assert.ok(ranges.some(x=>x.branch==='delivered'&&x.from===100),'replacement block was rescanned');
 const again=await restarted.monitor({...input,scanBlock:afterReorg.scanBlock,scanAnchor:afterReorg.scanAnchor});
 assert.equal(again.phase,'delivered-finalized');
 branch='removed';const removed=await monitor.monitor({...input,scanBlock:again.scanBlock,scanAnchor:again.scanAnchor});
 assert.equal(removed.phase,'awaiting-delivery','orphaned delivery is not retained');
 assert.equal(removed.scanBlock,104);
});

test('a legacy height without a hash is rescanned and wrong delivery credit fails closed',async()=>{
 let credited=true;const ranges=[];
 const provider={
  getNetwork:async()=>({chainId:11155111n}),
  getBlock:async height=>height===0?{number:0,hash:genesis}:height===100?{number:100,hash:startHash}:
   height==='latest'||height===104?{number:104,hash:laterHash,parentHash:newHeadHash}:
   height===103?{number:103,hash:newHeadHash,parentHash:deliveryHash}:
   height===102?{number:102,hash:deliveryHash}:null,
  getCode:async()=>code,call:async()=>routerAbi.encodeFunctionResult('isOffRamp',[true]),
  getLogs:async filter=>{ranges.push(filter.fromBlock);return filter.fromBlock<=102&&filter.toBlock>=102?[event]:[];},
  getTransactionReceipt:async()=>({...receipt,logs:[event,credited?transfer:{...transfer,topics:[transfer.topics[0],transfer.topics[1],zeroPadValue(address(99),32)]}]}),destroy(){}
 };
 const monitor=composeFamilyBridgeDeliveryMonitor({routes,provider}),input={messageId,receiver,amountAtomic:String(amount),start:{number:100,hash:startHash}};
 assert.equal((await monitor.monitor({...input,scanBlock:103})).phase,'delivered-finalized');
 assert.equal(ranges[0],100,'legacy checkpoint is not trusted');
 credited=false;await assert.rejects(monitor.monitor(input),/CCIP destination evidence/);
});

test('a failed OffRamp attempt stays visible and a later successful retry is recognized after restart',async()=>{
 const failedTx=word(30),successTx=word(31),failureHash=word(32),successHash=word(33),headHash=word(34);
 const failureEncoded=rampAbi.encodeEventLog(rampAbi.getEvent('ExecutionStateChanged'),[routes.sourceSelector,2n,messageId,3n,'0xdead']);
 const successEncoded=rampAbi.encodeEventLog(rampAbi.getEvent('ExecutionStateChanged'),[routes.sourceSelector,2n,messageId,2n,'0x']);
 const failedEvent={address:offRamp,topics:failureEncoded.topics,data:failureEncoded.data,transactionHash:failedTx,blockNumber:102,blockHash:failureHash,removed:false};
 const successEvent={address:offRamp,topics:successEncoded.topics,data:successEncoded.data,transactionHash:successTx,blockNumber:103,blockHash:successHash,removed:false};
 const paidTransfer={...transfer,transactionHash:successTx,blockNumber:103,blockHash:successHash};
 let retry=false;const provider={
  getNetwork:async()=>({chainId:11155111n}),
  getBlock:async height=>height===0?{number:0,hash:genesis}:height===100?{number:100,hash:startHash}:
   height==='latest'?retry?{number:104,hash:headHash,parentHash:successHash}:{number:103,hash:successHash,parentHash:failureHash}:
   height===102?{number:102,hash:failureHash}:
   height===103?{number:103,hash:successHash,parentHash:failureHash}:null,
  getCode:async()=>code,call:async()=>routerAbi.encodeFunctionResult('isOffRamp',[true]),
  getLogs:async filter=>[failedEvent,...(retry?[successEvent]:[])].filter(e=>e.blockNumber>=filter.fromBlock&&e.blockNumber<=filter.toBlock),
  getTransactionReceipt:async hash=>hash===failedTx?{hash,status:1,blockNumber:102,blockHash:failureHash,logs:[failedEvent]}:
   hash===successTx?{hash,status:1,blockNumber:103,blockHash:successHash,logs:[successEvent,paidTransfer]}:null,
  destroy(){}
 };
 const input={messageId,receiver,amountAtomic:String(amount),start:{number:100,hash:startHash}};
 const initial=await composeFamilyBridgeDeliveryMonitor({routes,provider}).monitor(input);
 assert.equal(initial.phase,'delivery-failed');assert.equal(initial.transactionHash,failedTx);assert.equal(initial.scanBlock,103);
 retry=true;
 const recovered=await composeFamilyBridgeDeliveryMonitor({routes,provider}).monitor({...input,scanBlock:initial.scanBlock,scanAnchor:initial.scanAnchor});
 assert.equal(recovered.phase,'delivered-finalized');assert.equal(recovered.transactionHash,successTx);
});
