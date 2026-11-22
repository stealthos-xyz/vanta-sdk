import type {Provider} from "ethers";
import {createVantaFamilyProofRuntime,type VantaFamilyProofRuntime} from "../fresh/index.mjs";
import {selectVantaFamilyBound4Driver,type VantaFamilyBound4Descriptor} from "../fresh/family-proof-driver.mjs";
declare const provider:Provider;
declare const descriptor:VantaFamilyBound4Descriptor;
const selected=selectVantaFamilyBound4Driver(descriptor,"payout-aggregate",0);
const enhanced=selectVantaFamilyBound4Driver(descriptor,"enhanced-fee-partner",8);
void enhanced;
const engine:"STREAM_BOUND4"=selected.engine;
const count:4=selected.workerCount;
const pending:Promise<Readonly<VantaFamilyProofRuntime>>=createVantaFamilyProofRuntime({
  provider,artifactBaseUrl:"https://wallet.example/pinned/",onSelectedDriver(value){
    const localCount:4=value.workerCount;void localCount;
  }});
void engine;void count;void pending;
