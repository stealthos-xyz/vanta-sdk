import {AbiCoder, Interface, SigningKey, TypedDataEncoder, ZeroAddress, getAddress, getCreate2Address, id, keccak256, recoverAddress} from 'ethers';
import {depositPoolAbi} from './family-deposit-wire.mjs';
import {FAMILY_NORMAL_QUOTE,familyNormalProofType} from './family-normal-wire.mjs';
export const PRIVATE_SWAP_ROUTE='(uint8 operation,address sourcePool,address sourceAsset,address payer,address receiver,uint128 amount,uint128 minimumOutput,uint64 deadline,bytes32 nonce,uint256 maximumDeliveryFee,address outputPool,address owner,bytes32 salt)';
const coder=AbiCoder.defaultAbiCoder(),address=v=>getAddress(v).toLowerCase();
const fail=()=>{throw Error('Private swap output: the receiver, private note or signed release binding differs.');};
const word=v=>typeof v==='string'&&/^0x[0-9a-f]{64}$/u.test(v);
export const privateSwapOutputAbi=new Interface([
 ...[8,32].map(w=>`function execute${w}(${FAMILY_NORMAL_QUOTE},${familyNormalProofType(w)},bytes,${PRIVATE_SWAP_ROUTE})`),
 `function predictFundingEscrow(${PRIVATE_SWAP_ROUTE}) view returns(address)`,
 `function routeHash(${PRIVATE_SWAP_ROUTE}) view returns(bytes32)`,
 'function claim(bytes32 creditId,uint256 nonce,uint64 deadline,address relayer,uint128 reimbursement,bytes depositData,bytes ownerSignature) returns(uint256 checkpoint)',
 'function predictEscrow(address pool,address owner,bytes32 salt) view returns(address)',
 'function claimDigest(bytes32 creditId,uint256 nonce,uint64 deadline,address relayer,uint128 reimbursement,bytes32 depositHash) view returns(bytes32)',
 'function credits(bytes32) view returns(address pool,address owner,bytes32 salt,uint128 amount,bool claimed)',
 'function poolCodeHash(address) view returns(bytes32)', 'function poolAsset(address) view returns(address)',
 'function escrowImplementation() view returns(address)', 'function escrowCodehash() view returns(bytes32)',
 'function usedNonce(bytes32,uint256) view returns(bool)',
 'event RoutedSettlement(bytes32 indexed quoteNonce,bytes32 indexed routeHash,address indexed sourcePool,uint8 operation,address receiver,uint256 inputAmount,uint256 outputAmount,bytes32 messageId,uint256 deliveryFee)',
 'event PrivateSwapOutputReady(bytes32 indexed creditId,address indexed pool,address indexed owner,bytes32 salt,address escrow,uint128 amount,bytes32 sourceNonce)',
 'event PrivateSwapOutputDeposited(address indexed escrow,address indexed pool,bytes32 indexed depositNonce,uint256 gross,uint128 reimbursement,uint256 checkpoint,bytes32 depositHash)',
]);
export const privateSwapOutputClaimTypes={PrivateSwapOutput:[['creditId','bytes32'],['nonce','uint256'],['deadline','uint64'],['relayer','address'],['reimbursement','uint128'],['depositHash','bytes32']].map(([name,type])=>({name,type}))};
export function privateSwapOutputScope(release,deployment){
 if(!deployment){
  const pin=name=>{const rows=release.lock.contracts.filter(p=>p.name===name);if(rows.length!==1)fail();return rows[0];};
  const gateway=pin('private-swap-gateway'),escrow=pin('private-swap-output-escrow');
  deployment={networkId:release.pins.networkId,genesisHash:release.pins.genesisHash,generationId:release.pins.generationId,setupId:release.pins.setupId,
   familyTag:release.setup.family.tag,gateway:address(gateway.address),gatewayCodehash:gateway.codehash,
   escrowImplementation:address(escrow.address),escrowCodehash:escrow.codehash};
 }
 if(deployment.networkId!==release.pins.networkId||deployment.genesisHash!==release.pins.genesisHash||
  deployment.generationId!==release.pins.generationId||deployment.setupId!==release.pins.setupId||deployment.familyTag!==release.setup.family.tag||
  !word(deployment.gatewayCodehash)||!word(deployment.escrowCodehash)||address(deployment.gateway)===ZeroAddress||address(deployment.escrowImplementation)===ZeroAddress)fail();
 return Object.freeze(deployment);
}
export const hasPrivateSwapOutput=release=>release.lock.contracts.some(p=>p.name==='private-swap-gateway');
export const privateSwapOutputDomain=scope=>({name:'StealthOS Private Swap Output',version:'2',chainId:Number(scope.networkId.split(':')[1]),verifyingContract:scope.gateway});
export function privateSwapOutputEscrow(scope,{pool,owner,salt}){
 if(!word(salt)||BigInt(salt)===0n||address(owner)===ZeroAddress)fail();
 const hash=keccak256(coder.encode(['bytes32','uint256','address','address','address','bytes32'],
  [id('STEALTHOS_FAMILY_PRIVATE_SWAP_OUTPUT_V1'),privateSwapOutputDomain(scope).chainId,scope.gateway,pool,owner,salt]));
 const code='0x3d602d80600a3d3981f3363d3d373d3d3d363d73'+address(scope.escrowImplementation).slice(2)+'5af43d82803e903d91602b57fd5bf3';
 return getCreate2Address(scope.gateway,hash,keccak256(code)).toLowerCase();
}
/** A separate one-time key, never the connected EOA or the partner's wallet. */
export async function derivePrivateSwapOutputSigner(wallet,scope,{pool,salt}){
 if(typeof wallet?.privateWalletKeys!=='function'||!word(salt))fail();
 const seed=new Uint8Array((await wallet.privateWalletKeys()).masterSeed??[]);if(seed.length!==32)fail();
 let material;
 try{
  material=keccak256(coder.encode(['bytes32','bytes32','bytes32','uint256','address','address','bytes32','bytes32'],
   [id('STEALTHOS_PRIVATE_SWAP_OUTPUT_CLAIM_KEY_V1'),scope.setupId,scope.generationId,privateSwapOutputDomain(scope).chainId,scope.gateway,pool,salt,seed]));
  const key=new SigningKey(material);material=undefined;
  return Object.freeze({owner:address(recoverAddress(id('STEALTHOS_SWAP_CLAIM_KEY_CHECK'),key.sign(id('STEALTHOS_SWAP_CLAIM_KEY_CHECK')))),
   sign:digest=>key.sign(digest).serialized});
 }finally{seed.fill(0);material=undefined;}
}

export async function verifyPrivateSwapOutput(provider,scope,pool,poolCodehash,blockTag){
 const read=(method,args)=>provider.call({to:scope.gateway,data:privateSwapOutputAbi.encodeFunctionData(method,args),blockTag});
 const [gateway,escrow,pinned,implementation]=await Promise.all([provider.getCode(scope.gateway,blockTag),provider.getCode(scope.escrowImplementation,blockTag),read('poolCodeHash',[pool]),read('escrowImplementation',[])]);
 if(keccak256(gateway)!==scope.gatewayCodehash||keccak256(escrow)!==scope.escrowCodehash||privateSwapOutputAbi.decodeFunctionResult('poolCodeHash',pinned)[0]!==poolCodehash||
  address(privateSwapOutputAbi.decodeFunctionResult('escrowImplementation',implementation)[0])!==address(scope.escrowImplementation))fail();
}
export function inspectPrivateSwapOutputClaim(scope,calldata,credit){
 const call=privateSwapOutputAbi.parseTransaction({data:calldata});
 if(call?.name!=='claim'||privateSwapOutputAbi.encodeFunctionData(call.fragment,call.args)!==calldata||!credit)fail();
 const [creditId,nonce,deadline,relayer,reimbursement,depositData,ownerSignature]=call.args;
 const deposit=depositPoolAbi.parseTransaction({data:depositData});
 if(deposit?.name!=='depositWithPrivateFeeNotes'||depositPoolAbi.encodeFunctionData(deposit.fragment,deposit.args)!==depositData)fail();
 const q=deposit.args[0],escrow=privateSwapOutputEscrow(scope,credit),pool=address(credit.pool),owner=address(credit.owner);
 if(address(q.pool)!==pool||address(q.payer)!==escrow||q.chainId!==BigInt(privateSwapOutputDomain(scope).chainId)||q.nonce!==creditId||
  q.deadline>deadline||q.gross<=0n||q.count!==1n||q.protocolFeeCap!==0n||q.partnerFeeCap!==0n||q.gross+reimbursement!==BigInt(credit.amount))fail();
 const claim={creditId,nonce,deadline,relayer,reimbursement,depositHash:keccak256(depositData)},digest=TypedDataEncoder.hash(privateSwapOutputDomain(scope),privateSwapOutputClaimTypes,claim);
 if(address(recoverAddress(digest,ownerSignature))!==owner)fail();
 return {pool,owner,salt:credit.salt,...claim,depositData,ownerSignature,q,escrow,deposit};
}
