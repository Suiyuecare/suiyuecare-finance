import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { makeSyntheticBackup,restoreRehearsal } from './finance_restore_rehearsal.mjs';
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const root=await fs.mkdtemp(path.join(os.tmpdir(),'finance-restore-tests-')),source=path.join(root,'backup'),built=await makeSyntheticBackup(source);
let n=0;function pass(s){n++;console.log('PASS '+s);}
const result=await restoreRehearsal({input:source,output:path.join(root,'valid'),...built});assert.equal(result.productionRecoveryProven,false);assert.equal(result.storageObjectsVerified,1);assert.equal(result.persistedDatabaseReopened,true);assert.equal(result.rpoSeconds,60);assert.deepEqual(result.accessQueries.map(c=>c.actualCount),[2,1,0]);assert.equal(result.tables.find(t=>t.name==='public.ledger_entries').centsSums.debit,'20346');pass('actual isolated SQL, persisted reopen, original file hash, money totals and restored RLS queries');
await assert.rejects(()=>restoreRehearsal({input:source,output:path.join(root,'bad-manifest'),manifestSha256:'0'.repeat(64),asOf:built.asOf}),/manifest SHA/);pass('independent manifest hash rejects modified manifest');
async function scenario(name,change,expected){const input=path.join(root,name);await fs.cp(source,input,{recursive:true});let m=JSON.parse(await fs.readFile(path.join(input,'manifest.json'),'utf8'));await change(input,m);const text=JSON.stringify(m);await fs.writeFile(path.join(input,'manifest.json'),text);const output=path.join(root,name+'-restored');await assert.rejects(()=>restoreRehearsal({input,output,manifestSha256:sha(text),asOf:built.asOf}),expected);assert.equal(await fs.access(path.join(output,'evidence.json')).then(()=>true,()=>false),false);pass(name+' fails closed without success evidence');}
await scenario('corrupt-storage',async(input,m)=>{await fs.appendFile(path.join(input,m.files.find(f=>f.path.startsWith('storage/')).path),'corruption');},/hash\/size mismatch/);
await scenario('missing-storage',async(input,m)=>{await fs.unlink(path.join(input,m.files.find(f=>f.path.startsWith('storage/')).path));},/ENOENT/);
await scenario('omitted-identity-coverage',async(input,m)=>{m.tables=m.tables.filter(t=>t.name!=='auth.users');},/Identity, settings/);
await scenario('wrong-money-total',async(input,m)=>{m.tables.find(t=>t.name==='public.ledger_entries').centsSums.debit='20347';},/monetary total mismatch/);
await scenario('modified-permission-with-valid-file-hash',async(input,m)=>{const file=m.files.find(f=>f.path==='database.sql');const text=(await fs.readFile(path.join(input,file.path),'utf8')).replace("'synthetic-disabled','accountant',false","'synthetic-disabled','accountant',true");await fs.writeFile(path.join(input,file.path),text);file.sha256=sha(text);file.sizeBytes=Buffer.byteLength(text);},/row content mismatch/);
await scenario('missing-permission-denial',async(input,m)=>{m.accessCases=m.accessCases.filter(c=>c.expectedCount>0);},/deny\/allow/);
await assert.rejects(()=>restoreRehearsal({input:source,output:source,...built}),/independent/);pass('cannot restore into backup source');
console.log('PASS '+n+' restore cases; evidence '+path.join(root,'valid/evidence.json'));
