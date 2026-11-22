/**
 * Node-only encrypted SQLite state and atomic journal store.
 * The trusted host supplies the unlock key, never the LLM or a relayer.
 */
import {DatabaseSync} from "node:sqlite";
import {createCipheriv,createDecipheriv,randomBytes} from "node:crypto";
import {mkdirSync,chmodSync} from "node:fs";
import {dirname,resolve} from "node:path";
const MAX=16*1024*1024;
const NAME=/^[A-Za-z0-9_.:/-]{1,256}$/u;
function namespace(s) {
  if(typeof s!=="string"||!NAME.test(s))
    throw Error("Invalid Vanta encrypted-store namespace");
  return s;
}
export function createVantaEncryptedSqliteStore({filename,encryptionKey}={}) {
  if(typeof filename!=="string"||!filename.trim()||
     !(encryptionKey instanceof Uint8Array)||encryptionKey.length!==32)
    throw Error("Trusted host SQLite filename and 32-byte key required");
  const key=Buffer.from(encryptionKey),location=resolve(filename);
  mkdirSync(dirname(location),{recursive:true,mode:0o700});
  const db=new DatabaseSync(location,{timeout:5000});
  chmodSync(location,0o600);
  db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL");
  db.exec("CREATE TABLE IF NOT EXISTS vanta_sealed (namespace TEXT PRIMARY KEY NOT NULL, payload BLOB NOT NULL) STRICT");
  const readStmt=db.prepare("SELECT payload FROM vanta_sealed WHERE namespace=?");
  const writeStmt=db.prepare("INSERT INTO vanta_sealed(namespace,payload) VALUES (?,?) ON CONFLICT(namespace) DO UPDATE SET payload=excluded.payload");
  let closed=false;
  const live=()=>{if(closed)throw Error("Encrypted Vanta store is closed");};
  const seal=(name,obj)=>{
    const plain=Buffer.from(JSON.stringify(obj),"utf8");
    if(plain.length>MAX){plain.fill(0);throw Error("Vanta encrypted record too large");}
    const iv=randomBytes(12);
    try {
      const cipher=createCipheriv("aes-256-gcm",key,iv);
      cipher.setAAD(Buffer.from(name,"utf8"));
      const data=Buffer.concat([cipher.update(plain),cipher.final()]);
      return Buffer.concat([Buffer.from([1]),iv,data,cipher.getAuthTag()]);
    } finally {plain.fill(0);}
  };
  const unseal=(name,blob)=>{
    const bytes=Buffer.from(blob);
    if(bytes.length<30||bytes.length>MAX+30||bytes[0]!==1)
      throw Error("Invalid sealed Vanta record");
    let clear;
    try {
      const dec=createDecipheriv("aes-256-gcm",key,bytes.subarray(1,13));
      dec.setAAD(Buffer.from(name,"utf8"));
      dec.setAuthTag(bytes.subarray(bytes.length-16));
      clear=Buffer.concat([dec.update(bytes.subarray(13,-16)),dec.final()]);
      return JSON.parse(clear.toString("utf8"));
    } catch {throw Error("Vanta record authentication failed");}
    finally {clear?.fill(0);}
  };
  const get=(name,fallback)=>{
    live();namespace(name);
    const found=readStmt.get(name);
    return found?unseal(name,found.payload):fallback;
  };
  const put=(name,value)=>{
    live();namespace(name);writeStmt.run(name,seal(name,value));
  };
  return Object.freeze({
    async read(name){
      const v=get(name,[]);
      if(!Array.isArray(v))throw Error("Invalid Vanta atomic journal state");
      return v;
    },
    async transact(name,update){
      live();namespace(name);
      if(typeof update!=="function")throw Error("Synchronous journal update required");
      db.exec("BEGIN IMMEDIATE");
      try {
        const old=get(name,[]);
        if(!Array.isArray(old))throw Error("Invalid Vanta atomic journal state");
        const next=update(old);
        if(!next||typeof next.then==="function"||!Array.isArray(next.next))
          throw Error("Atomic journal callback must be synchronous");
        put(name,next.next);db.exec("COMMIT");return next.result;
      } catch(e){db.exec("ROLLBACK");throw e;}
    },
    async readState(name){return get("state:"+namespace(name),null);},
    async writeState(name,value){
      live();db.exec("BEGIN IMMEDIATE");
      try{put("state:"+namespace(name),value);db.exec("COMMIT");}
      catch(e){db.exec("ROLLBACK");throw e;}
    },
    close(){if(!closed){closed=true;db.close();key.fill(0);}},
  });
}
