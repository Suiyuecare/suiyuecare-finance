import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
const require=createRequire(import.meta.url),guard=require('./finance_production_release_guard.js');
const root=path.resolve(new URL('..',import.meta.url).pathname),temp=fs.mkdtempSync(path.join(os.tmpdir(),'finance-apm-source-seal-'));
const entries=guard.APM_SOURCE_REMOTE_MANIFEST,ledger=path.join(temp,'ledger.txt'),evidence=ledger+'.apm-sources.txt',directory=path.join(temp,'migrations');
fs.mkdirSync(directory);let checks=0;
const verify=()=>guard.verifyApmProductionSources(ledger,directory);
const reject=(pattern)=>{assert.throws(verify,pattern);checks++;};
const writeLedger=rows=>fs.writeFileSync(ledger,rows.join('\n')+'\n');
const validRows=entries.map(x=>x.remoteVersion+':'+x.sha256);
try{
 assert.deepEqual(entries.map(x=>[x.sourceFile.slice(0,14),x.remoteVersion]),[['20261019043031','20261020022748'],['20261020011825','20261020022750'],['20261020014611','20261020022751'],['20261020021355','20261020023444'],['20261020024107','20261020025210']]);checks++;
 for(const item of entries)fs.copyFileSync(path.join(root,'supabase/migrations',item.sourceFile),path.join(directory,item.sourceFile));
 writeLedger(entries.map(x=>x.remoteVersion));reject(/evidence is missing/);
 fs.writeFileSync(evidence,validRows.join('\n')+'\n');assert.equal(verify(),true);checks++;
 for(let i=0;i<entries.length;i++){
  writeLedger(entries.filter((_,index)=>index!==i).map(x=>x.remoteVersion));reject(/missing the exact production ledger version/);
 }
 writeLedger(entries.map(x=>x.remoteVersion));
 for(let i=0;i<entries.length;i++){
  const tampered=validRows.slice();tampered[i]=entries[i].remoteVersion+':'+('0'.repeat(64));fs.writeFileSync(evidence,tampered.join('\n'));reject(/live ledger statement hashes/);
 }
 for(const rows of[validRows.slice(0,3),[...validRows,validRows[0]],[...validRows].reverse()]){fs.writeFileSync(evidence,rows.join('\n'));reject(/live ledger statement hashes/);}
 fs.writeFileSync(evidence,validRows.join('\n'));
 for(const item of entries){const file=path.join(directory,item.sourceFile),source=fs.readFileSync(file);fs.appendFileSync(file,'\n-- unreviewed change');reject(/local source differs/);fs.writeFileSync(file,source);}
 writeLedger([...entries.map(x=>x.remoteVersion),entries[0].sourceFile.slice(0,14)].sort());reject(/must not masquerade/);
 writeLedger(entries.map(x=>x.remoteVersion));
 const cli=spawnSync(process.execPath,[path.join(root,'scripts/finance_production_release_guard.js'),'verify-apm-sources','--ledger',ledger,'--migration-dir',directory],{encoding:'utf8'});assert.equal(cli.status,0,cli.stderr);checks++;
 fs.writeFileSync(evidence,validRows.slice(0,3).join('\n'));
 for(const command of['classify-ledger','verify-ledger']){const result=spawnSync(process.execPath,[path.join(root,'scripts/finance_production_release_guard.js'),command,'--ledger',ledger,'--migration-dir',directory,'--release-phase','frontend_compat','--migration-versions','none','--mode','post'],{encoding:'utf8'});assert.notEqual(result.status,0);assert.match(result.stderr,/live ledger statement hashes/);checks++;}
 const workflow=fs.readFileSync(path.join(root,'.github/workflows/finance-production-release.yml'),'utf8');
 assert.equal((workflow.match(/cp scripts\/finance_apm_source_manifest.sql/g)||[]).length,1);checks++;
 assert.equal((workflow.match(/--file scripts\/finance_apm_source_manifest.sql/g)||[]).length,2);checks++;
 const query=fs.readFileSync(path.join(root,'scripts/finance_apm_source_manifest.sql'),'utf8');
 assert.match(query,/convert_to\(array_to_string\(statements, E'\\n'\),'UTF8'\)/);checks++;
 for(const item of entries){assert.ok(query.includes("'"+item.remoteVersion+"'"));checks++;}
 console.log(JSON.stringify({checks,failed:0,scope:'exact local source to actual MCP ledger version mapping; synthetic hash evidence negatives; no remote writes'}));
}finally{fs.rmSync(temp,{recursive:true,force:true});}
