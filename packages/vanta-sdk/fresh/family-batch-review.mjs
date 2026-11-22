/** Allocate a reviewed net payout across gross recipient budgets, conserving every unit. */
export function allocateFamilyBatchPayouts(payments,netPayoutAtomic){
  if(!Array.isArray(payments)||payments.length<2||payments.length>32)throw Error('Batch sends require 2 to 32 recipients.');
  const atomic=value=>{if(typeof value!=='string'||!/^([1-9][0-9]{0,36})$/u.test(value)||BigInt(value)>=(1n<<120n))throw Error('Invalid batch amount.');return BigInt(value);};
  const gross=payments.map(payment=>atomic(payment.amountAtomic)),total=gross.reduce((a,b)=>a+b,0n),net=atomic(netPayoutAtomic);
  if(total>=(1n<<120n)||net>total)throw Error('Invalid batch total.');
  const values=gross.map(value=>value*net/total),fractions=gross.map((value,index)=>({index,remainder:value*net%total}));
  let remaining=net-values.reduce((a,b)=>a+b,0n);
  fractions.sort((a,b)=>a.remainder===b.remainder?a.index-b.index:a.remainder>b.remainder?-1:1);
  for(const {index} of fractions)if(remaining>0n){values[index]++;remaining--;}
  if(remaining!==0n||values.some((value,index)=>value<=0n||value>gross[index]))throw Error('Each recipient must receive a positive amount after fees.');
  return Object.freeze(payments.map((payment,index)=>Object.freeze({recipient:payment.recipient,grossAmountAtomic:gross[index].toString(),amountAtomic:values[index].toString()})));
}
