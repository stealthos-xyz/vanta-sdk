/** Transport metadata. It does not authorize any privacy deployment. */
export declare const DOGEOS_CHIKYU_NETWORK:Readonly<{
  id:6281971;networkId:"eip155:6281971";name:string;
  nativeCurrency:Readonly<{name:"DOGE";symbol:"DOGE";decimals:18}>;
  rpcUrl:string;explorerUrl:string;nativeTokenAlias:string;feeOracle:string;
  testnet:true;
}>;

/** An inventory key only, never a proof token domain or transfer selector. */
export declare function dogeOsAssetKey(chainId:number|bigint,
  tokenAddress?:string|null):string;
export declare function mergeDogeOsBalances(input:Readonly<{
  chainId:number|bigint;
  /** All snapshots must have been read at the same verified block. */
  balances:ReadonlyArray<Readonly<{tokenAddress?:string|null;balance:bigint}>>;
}>):ReadonlyArray<Readonly<{
  assetId:string;tokenAddress:string|null;kind:"native"|"erc20";balance:bigint;
}>>;

/** Exact signed bytes are required. This never signs or sends a transaction.
 * Total budget uses the execution cap plus the oracle estimate at blockNumber;
 * it is not a guarantee of the fee at future inclusion. A host exposing only
 * eth_sendTransaction must provide a separate complete preapproval estimate.
 */
export declare function quoteDogeOsSignedTransactionFees(input:Readonly<{
  provider:{
    getNetwork():Promise<{chainId:bigint}>;
    getBlock(tag:"latest"|number):Promise<{
      number:number;hash:string|null;
    }|null>;
    call(tx:{to:string;data:string;blockTag:number}):Promise<string>;
  };
  signedTransaction:string;signal?:AbortSignal;
}>):Promise<Readonly<{
  chainId:6281971;transactionHash:string;
  blockNumber:number;blockHash:string;gasLimit:bigint;gasPriceCap:bigint;
  executionFeeCapUnits:bigint;dataAndFinalityFeeUnits:bigint;
  totalFeeBudgetUnits:bigint;
}>>;
