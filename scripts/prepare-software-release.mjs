/** Reproducible unsigned software-only release for an already signed generation.
 * Never publish or activate here. Preserve the prior release/contract bindings. */
import assert from 'node:assert/strict';
import {readFile,writeFile,copyFile,mkdir,mkdtemp,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {resolve,join} from 'node:path';
import {build} from 'esbuild';
import {keccak256,toUtf8Bytes} from 'ethers';
import {assertSignedChikyuSdkPublication} from './sdk-publication-signature.mjs';

const root=resolve(import.meta.dirname,'..'), destination=resolve(process.argv[2]??join(root,'.release-candidate'));
const previous=JSON.parse(await readFile(join(root,'releases/0.4.65/publication.json'),'utf8'));
const priorDigest=assertSignedChikyuSdkPublication(previous);
const {signature,artifactBaseUrl,...prior}=previous;
const version=JSON.parse(await readFile(join(root,'packages/vanta-sdk/package.json'),'utf8')).version;
assert.equal(version,'0.4.66');
const wrapperSourceCommit=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
assert.match(wrapperSourceCommit,/^[a-f0-9]{40}$/u);
const archive='stealthos-vanta-sdk-'+version+'.tgz';
await mkdir(destination,{recursive:true});
const extract=await mkdtemp(join(root,'.release-0466-'));
try{
 execFileSync('tar',['-xzf',join(root,'.build',archive),'-C',extract]);
 await copyFile(join(root,'.build',archive),join(destination,archive));
 await build({entryPoints:[join(extract,'package/api/wallet.mjs')],outfile:join(destination,'sdk-browser.mjs'),
  bundle:true,platform:'browser',format:'esm',target:'es2022',minify:true,legalComments:'none',logLevel:'warning'});
 await copyFile(join(extract,'package/fresh/unified-bound4-bootstrap-worker.js'),join(destination,'sdk-worker.js'));
}finally{await rm(extract,{recursive:true,force:true});}
const pin=async(name,extension)=>{
 const bytes=await readFile(join(destination,name)),sha256=createHash('sha256').update(bytes).digest('hex');
 return {path:'objects/'+sha256+extension,bytes:bytes.length,sha256};
};
const publication={...prior,version,wrapperSourceCommit,
 sdkPackage:await pin(archive,'.tgz'),sdkBundle:await pin('sdk-browser.mjs','.mjs'),sdkWorker:await pin('sdk-worker.js','.js')};
const canonical=v=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(canonical).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';
const publicationDigest=keccak256(toUtf8Bytes('STEALTHOS_VANTA_BROWSER_SDK_PUBLICATION_V1:'+canonical(publication)));
const retained=v=>Object.fromEntries(Object.entries(v).filter(([key])=>!['version','wrapperSourceCommit','sdkPackage','sdkBundle','sdkWorker'].includes(key)));
assert.equal(canonical(retained(prior)),canonical(retained(publication)));
await writeFile(join(destination,'publication.json'),JSON.stringify(publication,null,2)+'\n');
await writeFile(join(destination,'prior-publication.json'),JSON.stringify(prior,null,2)+'\n');
const evidence={version,wrapperSourceCommit,priorDigest,publicationDigest,sdkPackage:publication.sdkPackage,sdkBundle:publication.sdkBundle,sdkWorker:publication.sdkWorker,unsigned:true,contractsUnchanged:true};
await writeFile(join(destination,'evidence.json'),JSON.stringify(evidence,null,2)+'\n');
console.log('FYEO_RELEASE_CANDIDATE '+JSON.stringify(evidence));
