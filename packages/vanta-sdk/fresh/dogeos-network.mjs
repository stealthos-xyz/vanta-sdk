import {getAddress,Interface,Transaction} from "ethers";

/** Connection metadata only. This is NOT a ceremony activation or release pin.
 * Mainnet must get its own independently reviewed network identity and release.
 */
export const DOGEOS_CHIKYU_NETWORK=Object.freeze({
  id:6281971,networkId:"eip155:6281971",name:"DogeOS Chikyū Testnet",
  nativeCurrency:Object.freeze({name:"DOGE",symbol:"DOGE",decimals:18}),
  rpcUrl:"https://rpc.testnet.dogeos.com/",
  explorerUrl:"https://dogeos-testnet.l2scan.co",
  nativeTokenAlias:"0x530000000000000000000000000000000000d09e",
  feeOracle:"0x5300000000000000000000000000000000000002",
  testnet:true,
});

const ZERO="0x0000000000000000000000000000000000000000";
const MAX=(1n<<256n)-1n;
const WORD=/^0x[0-9a-fA-F]{64}$/u;
const ORACLE=new Interface(["function getL1Fee(bytes) view returns(uint256)"]);
const fail=message=>{throw Error("DogeOS: "+message);};
const check=(ok,message)=>{if(!ok)fail(message);};
function chikyu(chainId){
  check(chainId===6281971||chainId===6281971n,
    "only the documented Chikyu network is configured");
}
function units(value,label){
  check(typeof value==="bigint"&&value>=0n&&value<=MAX,
    label+" must be uint256 base units");
  return value;
}

/** An inventory key, never a selector for the pool's transfer path or proof
 * token domain. Native DOGE, zero-address notation and the ERC-20 alias are
 * one balance. Wrapped DOGE remains a different ERC-20 asset.
 */
export function dogeOsAssetKey(chainId,tokenAddress=null){
  chikyu(chainId);
  const address=tokenAddress===null?ZERO:getAddress(tokenAddress).toLowerCase();
  return address===ZERO||address===DOGEOS_CHIKYU_NETWORK.nativeTokenAlias
    ?DOGEOS_CHIKYU_NETWORK.networkId+"/native:DOGE"
    :DOGEOS_CHIKYU_NETWORK.networkId+"/erc20:"+address;
}

/** Merge duplicate representations, never their amounts. The caller must
 * collect every balance at the same verified block. Conflicting snapshots
 * require a fresh read, not guessing or adding the two DOGE balances.
 */
export function mergeDogeOsBalances({chainId,balances}={}){
  chikyu(chainId);
  check(Array.isArray(balances),"balance snapshots are required");
  const inventory=new Map();
  for(const entry of balances){
    check(entry&&typeof entry==="object","invalid balance snapshot");
    const assetId=dogeOsAssetKey(chainId,entry.tokenAddress??null);
    const balance=units(entry.balance,"balance");
    const existing=inventory.get(assetId);
    if(existing){
      check(existing.balance===balance,"conflicting duplicate asset balances");
      continue;
    }
    const native=assetId.endsWith("/native:DOGE");
    inventory.set(assetId,Object.freeze({assetId,balance,
      tokenAddress:native?null:getAddress(entry.tokenAddress),
      kind:native?"native":"erc20"}));
  }
  return Object.freeze([...inventory.values()]);
}

/** Read-only fee budgeting for the exact signed transaction. The oracle
 * receives the complete signed serialization, not tx.data or unsigned RLP.
 * Execution uses the signed gas limit and fee cap. Data/Finality is an
 * estimate at the returned block, so totalFeeBudgetUnits is NOT a future
 * inclusion guarantee. No transaction is submitted by this helper.
 *
 * A host that exposes only eth_sendTransaction must supply its own complete
 * preapproval fee estimate. Never export the EVM key to obtain raw bytes.
 * This helper does not substitute for signed family activation validation.
 */
export async function quoteDogeOsSignedTransactionFees({provider,
  signedTransaction,signal}={}){
  check(provider&&typeof provider.getNetwork==="function"&&
    typeof provider.getBlock==="function"&&typeof provider.call==="function",
  "read RPC provider required");
  check(typeof signedTransaction==="string"&&
    /^0x(?:[0-9a-fA-F]{2})+$/u.test(signedTransaction)&&
    signedTransaction.length<=2+2*1024*1024,
  "bounded signed serialized transaction required");
  signal?.throwIfAborted();
  let tx;
  try{tx=Transaction.from(signedTransaction);}
  catch{fail("invalid signed transaction serialization");}
  check(tx.isSigned()&&tx.isValid()&&tx.from!==null,
    "a valid transaction signature is required");
  chikyu(tx.chainId);
  check([0,1,2].includes(tx.type),"unsupported DogeOS transaction type");
  check(tx.serialized.toLowerCase()===signedTransaction.toLowerCase(),
    "noncanonical transaction serialization");
  const gasLimit=units(tx.gasLimit,"gas limit");
  const gasPriceCap=units(tx.type===2?tx.maxFeePerGas:tx.gasPrice,
    "execution gas price cap");
  check(gasLimit>0n&&gasPriceCap>0n,"positive execution fee budget required");
  const executionFeeCapUnits=units(gasLimit*gasPriceCap,"execution fee cap");
  const network=await provider.getNetwork();
  signal?.throwIfAborted();
  chikyu(network?.chainId);
  const anchor=await provider.getBlock("latest");
  signal?.throwIfAborted();
  check(anchor&&Number.isSafeInteger(anchor.number)&&anchor.number>=0&&
    WORD.test(anchor.hash??""),"fee estimation block unavailable");
  const result=await provider.call({to:DOGEOS_CHIKYU_NETWORK.feeOracle,
    data:ORACLE.encodeFunctionData("getL1Fee",[signedTransaction]),
    blockTag:anchor.number});
  signal?.throwIfAborted();
  check(typeof result==="string"&&WORD.test(result),
    "Data/Finality fee oracle returned invalid data");
  const dataAndFinalityFeeUnits=units(BigInt(result),"Data/Finality fee");
  const current=await provider.getBlock(anchor.number);
  signal?.throwIfAborted();
  check(current?.number===anchor.number&&
    current.hash?.toLowerCase()===anchor.hash.toLowerCase(),
  "fee estimation block changed; retry");
  return Object.freeze({chainId:6281971,transactionHash:tx.hash,
    blockNumber:anchor.number,blockHash:anchor.hash.toLowerCase(),
    gasLimit,gasPriceCap,executionFeeCapUnits,dataAndFinalityFeeUnits,
    totalFeeBudgetUnits:units(executionFeeCapUnits+dataAndFinalityFeeUnits,
      "total fee budget")});
}
