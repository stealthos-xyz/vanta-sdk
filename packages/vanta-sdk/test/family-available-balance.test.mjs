import test from 'node:test';import assert from 'node:assert/strict';
import {availableFamilyDebit,selectEnhancedNotes} from '../fresh/family-enhanced-plan.mjs';
import {expireEnhancedUnsignedPreparations} from '../fresh/family-enhanced-runtime.mjs';
import {depositFailure,publicDepositFailure,readDepositFailure} from '../fresh/family-deposit-errors.mjs';
const note=(id,n,epoch=0)=>({epoch,row:id,status:'spendable',nullifier:String(id),opening:{amount_units:String(n)}});
const inventory=notes=>({complete:true,publicCommitments:[],epochs:[{epoch:0},{epoch:1}],notes});
test('MAX excludes pending notes, keeps per-epoch/32-note limits and atomic change headroom',()=>{
 const i=inventory([note(1,30n*10n**18n),note(2,60n*10n**18n),note(3,3),note(4,100n*10n**18n,1)]),blocked=new Set(['2','4']);
 const max=availableFamilyDebit(i,blocked);assert.equal(max,'30000000000000000001');
 assert.ok(selectEnhancedNotes(i,blocked,BigInt(max)+1n,32));assert.equal(availableFamilyDebit(i,new Set()),'99999999999999999998');
 const many=inventory(Array.from({length:40},(_,id)=>note(id,100)));assert.equal(availableFamilyDebit(many,new Set()),'3198');
 assert.equal(availableFamilyDebit(inventory([note(1,2)]),new Set()),'0');
});
test('only expired unsigned prepared rows release locks; proving and armed submissions survive',()=>{
 const base={intentId:'unsigned',phase:'prepared',expiresAt:100,journalArmed:false,calldata:null};
 const rows=[base,{...base,intentId:'fresh',expiresAt:101},{...base,intentId:'proving',phase:'proving'},{...base,intentId:'armed',journalArmed:true},{...base,intentId:'sent',calldata:'0x1234'}];
 const result=expireEnhancedUnsignedPreparations(rows,100);assert.deepEqual(result.result,['unsigned']);assert.equal(result.next[0].phase,'failed');assert.equal(rows[0].phase,'prepared');
 assert.deepEqual(expireEnhancedUnsignedPreparations(result.next,100).result,['unsigned']);
 for(let n=1;n<rows.length;n++)assert.equal(result.next[n],rows[n]);
});
test('batch failures retain the correct safe operation label across the worker boundary',()=>{
 for(const stage of ['Batch fee review','Batch preparation','Batch submission']){
  const failure=depositFailure(Error('Family fee review: The entered amount does not cover the network fee.'),stage);
  assert.ok(failure.message.startsWith(stage+': '));assert.equal(failure.code,'TRANSACTION_FAILED');
  assert.equal(readDepositFailure(publicDepositFailure(failure)).message,failure.message);
 }
});
