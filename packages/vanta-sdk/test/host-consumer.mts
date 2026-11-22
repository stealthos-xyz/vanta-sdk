import {createEip1193HostWallet,createNativeHostWallet,
  type VantaNativeWalletHost,type VantaEip1193Provider}
  from "@stealthos/vanta-sdk/host-wallet";
import {createVantaHostAtomicStore,createVantaHostPrivacyVault,
  createVantaLocalPrivacyWallet,type VantaHostStorageBackend}
  from "@stealthos/vanta-sdk/host-storage";
import {createVantaHostWorker} from "@stealthos/vanta-sdk/host-worker";
import {createVantaFamilyHostRuntimeFactory}
  from "@stealthos/vanta-sdk/host-family-runtime";
import {DOGEOS_CHIKYU_NETWORK,dogeOsAssetKey}
  from "@stealthos/vanta-sdk/dogeos-network";

declare const provider:VantaEip1193Provider;
declare const native:VantaNativeWalletHost;
declare const storage:VantaHostStorageBackend;
const hosted=createEip1193HostWallet({provider});
const host=createNativeHostWallet({host:native});
const context=await hosted.getContext();
await hosted.personalSign({message:"exact server challenge",context});
await host.sendTransaction({context:await host.getContext(),
  transaction:{to:context.address,value:"0x0",data:"0x"}});
const store=createVantaHostAtomicStore({host:storage,scope:{accountId:"wallet-account",
  address:context.address,networkId:DOGEOS_CHIKYU_NETWORK.networkId,
  generationId:"0x"+"1".repeat(64)}});
const vault=createVantaHostPrivacyVault({store});
const wallet=createVantaLocalPrivacyWallet({vault,ui:{
  authenticate:async()=>true,confirmBackup:async(_phrase:string)=>true,
  requestRestorePhrase:async()=>"only a trusted native secret UI can provide this",
}});
wallet.lock();store.close();host.dispose();hosted.dispose();
const factory:typeof createVantaHostWorker=createVantaHostWorker;
const familyFactory:typeof createVantaFamilyHostRuntimeFactory=
  createVantaFamilyHostRuntimeFactory;
void factory;void familyFactory;void dogeOsAssetKey(DOGEOS_CHIKYU_NETWORK.id);
