import test from'node:test';import assert from'node:assert/strict';import{assertFamilyReviewedFees,familyTotalSpendAmounts}from'../fresh/family-operation-review.mjs';
const quote={amountAtomic:'100',protocolFeeAtomic:'3',partnerFeeAtomic:'2',totalDebitAtomic:'105',feePolicyHash:'fixed',partnerId:'0x'+('01'.repeat(32)),policyVersion:'1',receiverCommitment:'2',authorizationKey:'3',deadline:Math.floor(Date.now()/1000)+300};
test('reviewed operation fees reject every changed fee, policy or receiving identity before proving',()=>{assert.doesNotThrow(()=>assertFamilyReviewedFees(quote,{...quote}));for(const key of Object.keys(quote).filter(k=>k!=='deadline'))assert.throws(()=>assertFamilyReviewedFees(quote,{...quote,[key]:'changed'}),/fees or receiving policy changed/);assert.throws(()=>assertFamilyReviewedFees({...quote,deadline:1},quote),/expired/);});

test('decimal and fixed-width hexadecimal public commitments denote the same reviewed policy',()=>{assert.doesNotThrow(()=>assertFamilyReviewedFees(quote,{...quote,receiverCommitment:'0x02',authorizationKey:'0x03',policyVersion:'0x01'}));});

const rules={protocolBps:15,protocolMinimum:'0',partnerBps:20,partnerMinimum:'0',partnerMaximum:((1n<<120n)-1n).toString()};
test('entered totals include all fees for native and ERC20 precisions, including full-balance sends',()=>{
 for(const decimals of[6,8,18])for(const units of[9n,100n,12345n]){
  const budget=units*10n**BigInt(decimals),gas=budget/5n;
  const q=familyTotalSpendAmounts({maximumDebitAtomic:budget.toString(),gasReserveAtomic:gas.toString(),feeRules:rules});
  const net=BigInt(q.amountAtomic),p=BigInt(q.protocolFeeAtomic),a=BigInt(q.partnerFeeAtomic),debit=BigInt(q.totalDebitAtomic);
  assert.equal(p,(net*15n+9999n)/10000n);assert.equal(a,(net*20n+9999n)/10000n);
  assert.equal(debit,net+p+a+gas);assert.ok(debit<=budget);assert.ok(budget-debit<=2n);
  const next=net+1n;assert.ok(next+(next*15n+9999n)/10000n+(next*20n+9999n)/10000n+gas>budget);
 }
});
test('fee minima, maxima, zero rates and fees exceeding the entered budget remain enforced',()=>{
 const q=familyTotalSpendAmounts({maximumDebitAtomic:'100',gasReserveAtomic:'10',feeRules:{...rules,protocolBps:0,partnerBps:0,protocolMinimum:'3',partnerMinimum:'2'}});
 assert.deepEqual(q,{amountAtomic:'85',protocolFeeAtomic:'3',partnerFeeAtomic:'2',gasReserveAtomic:'10',totalDebitAtomic:'100',unspentAmountAtomic:'0'});
 for(const maximumDebitAtomic of['1','10','14'])assert.throws(()=>familyTotalSpendAmounts({maximumDebitAtomic,gasReserveAtomic:'10',feeRules:{...rules,protocolMinimum:'3',partnerMinimum:'2'}}),/does not cover/);
 assert.throws(()=>familyTotalSpendAmounts({maximumDebitAtomic:'1000000',gasReserveAtomic:'1',feeRules:{...rules,partnerMaximum:'1'}}),/registered maximum/);
 assert.throws(()=>assertFamilyReviewedFees({...quote,grossAmountAtomic:'104'},quote),/total spend/);
});
