// Execute the exact pre/postflight identity blocks against the reviewed runtime
// fixture and sealed successor migration. In-memory PostgreSQL only; no live
// identities, requests, credentials, or production connections.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import createFixture from './fixtures/finance_bank_fee_classification_fixture.cjs';
import guard from './finance_production_release_guard.js';

const root=path.resolve(import.meta.dirname,'..');
const read=relative=>fs.readFile(path.join(root,relative),'utf8');
const version='20261016043221',migrationName='finance_bank_fee_classification_v1';
const signature='private.finance_expense_resubmit_applicant_revision_v1_unsafe(text,text,text,integer,timestamptz,integer,text,jsonb,jsonb,text)';
const wrapper='public.finance_expense_resubmit_applicant_revision(text,text,text,integer,timestamptz,integer,text,jsonb,jsonb,text)';
const oldSha='012297096ad81638aae4fc26e9fe23a2009e576a5bff5a67ae3166eff9cac17e';
const currentSha='9dc66c49d987d7729f3d830251a7fcc71cb425f4cb60ec87bff656f741bb8562';
const beginMarker='-- FINANCE_APPLICANT_REVISION_SOURCE_IDENTITY_V2_BEGIN';
const endMarker='-- FINANCE_APPLICANT_REVISION_SOURCE_IDENTITY_V2_END';
const hash=(algorithm,source)=>crypto.createHash(algorithm).update(source,'utf8').digest('hex');
let checks=0;
const eq=(actual,expected,label)=>{assert.deepEqual(actual,expected,label);checks++;};
const ok=(value,label)=>{assert.ok(value,label);checks++;};
function exactBlock(source,label){
  eq(source.split(beginMarker).length,2,label+' has exactly one opening marker');
  eq(source.split(endMarker).length,2,label+' has exactly one closing marker');
  const start=source.indexOf(beginMarker),end=source.indexOf(endMarker,start);
  ok(end>start,label+' markers enclose a complete block');
  return source.slice(start,end+endMarker.length);
}
const sources=await Promise.all(['preflight','postflight'].map(async kind=>({
  name:kind,source:await read('scripts/finance_production_db_'+kind+'.sql')
})));
const blocks=sources.map(({name,source})=>{
  ok(!/prosrc\s*::\s*bytea/i.test(source),name+' never interprets function source as bytea escape syntax');
  const block=exactBlock(source,name);
  return {name,block,sql:'do $identity_regression$ begin\n'+block+'\nend $identity_regression$;'};
});
eq(blocks[0].block.replace(/^\s+/gm,''),blocks[1].block.replace(/^\s+/gm,''),'preflight and postflight use the same reviewed version selector');
const legacyPreflight=sources[0].source.slice(sources[0].source.indexOf("if v_phase = '20260827052447' then"),sources[0].source.indexOf('-- none is frontend-only'));
ok(legacyPreflight.includes(oldSha)&&!legacyPreflight.includes(currentSha),'installing the original v3 migration still requires only its original baseline');

const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'finance-release-fingerprint-'));
const fixture=await createFixture(root),{db,admin}=fixture;
const migration=await read('supabase/migrations/'+version+'_'+migrationName+'.sql');
// The protected release records item.source.trimEnd(), matching its atomic
// ledger insert; do not invent a different representation for the receipt.
const ledgerSource=migration.trimEnd();
const sealedLedgerMd5='de4fabd6b440789435a1ff499f20c868';
try{
  const rendered=path.join(temporary,'frontend-compat.sql');
  guard.preparePhaseQuery(path.join(root,'scripts/finance_production_db_postflight.sql'),rendered,'frontend_compat','none');
  const prepared=await fs.readFile(rendered,'utf8');
  eq(exactBlock(prepared,'rendered frontend compatibility chain'),blocks[1].block,'frontend compatibility rendering retains the exact updated source check');
  ok(prepared.startsWith('begin read only;')&&prepared.trimEnd().endsWith('rollback;'),'rendered compatibility check stays read-only and rolls back');
  const historical=path.join(temporary,'history-phase.sql');
  guard.preparePhaseQuery(path.join(root,'scripts/finance_remittance_history_postflight.sql'),historical,guard.RELEASE_PHASE_DATABASE_REMITTANCE_HISTORY,guard.REMITTANCE_HISTORY_MIGRATIONS.join(','));
  ok(!(await fs.readFile(historical,'utf8')).includes(beginMarker),'the previous history phase uses its separate scoped postflight');

  await admin('create schema supabase_migrations;create table supabase_migrations.schema_migrations(version text,name text,statements text[]);');
  eq(hash('md5',ledgerSource),sealedLedgerMd5,'reviewed release ledger representation matches the seal');
  const metadata=async sig=>{
    const row=(await db.query("select prosrc,pg_get_functiondef(oid) definition,md5(pg_get_functiondef(oid)) definition_md5,encode(extensions.digest(pg_catalog.convert_to(prosrc,'UTF8'),'sha256'),'hex') source_sha,proacl::text acl,proconfig,prosecdef from pg_proc where oid=$1::regprocedure",[sig])).rows[0];
    eq(row.source_sha,hash('sha256',row.prosrc),'PostgreSQL UTF8 source SHA matches Node UTF8 bytes');
    return row;
  };
  const original=await metadata(signature),originalWrapper=await metadata(wrapper);
  eq(original.source_sha,oldSha,'the actual pre-successor fixture has the original source SHA');
  eq(original.definition_md5,'5dedbec02d1440f855c69cdab2684515','original full definition matches reviewed predecessor');
  eq(originalWrapper.definition_md5,'6af47c58cd50b60f0a500ac8221a57e3','public wrapper remains the reviewed authoritative wrapper');
  eq(original.prosrc.includes('\\'),false,'original body contains no bytea escape characters');
  const allPass=async label=>{for(const block of blocks){await db.exec(block.sql);checks++;} };
  const allReject=async(label,message)=>{
    for(const block of blocks){
      await db.exec('savepoint exact_source_guard');
      await assert.rejects(()=>db.exec(block.sql),error=>error.code==='P0001'&&message.test(error.message),label+' '+block.name);
      await db.exec('rollback to savepoint exact_source_guard');checks++;
    }
  };
  const rolledCase=async run=>{await db.exec('begin;');try{await run();}finally{await db.exec('rollback;');}};
  const addLedger=async({name=migrationName,statements=[ledgerSource]}={})=>db.query('insert into supabase_migrations.schema_migrations(version,name,statements) values($1,$2,$3)',[version,name,statements]);

  await allPass('old body without successor ledger');
  await rolledCase(async()=>{await addLedger();await allReject('old body with new ledger',/delegate source differs/);});
  eq((await db.query("select encode(extensions.digest(prosrc::bytea,'sha256'),'hex') source_sha from pg_proc where oid=$1::regprocedure",[signature])).rows[0].source_sha,oldSha,'old cast happened to work for the original backslash-free body');

  await admin(migration);
  const installed=await metadata(signature),installedWrapper=await metadata(wrapper);
  eq(installed.source_sha,currentSha,'sealed successor replay independently derives the approved new SHA');
  eq(installed.definition_md5,'ccaad5b351be270e9597a02271518585','sealed successor derives the approved full-definition MD5');
  eq((installed.prosrc.match(/\\/g)||[]).length,8,'reviewed bank-name regular expressions introduce eight literal backslashes');
  eq([installed.acl,installed.proconfig,installed.prosecdef],[original.acl,original.proconfig,original.prosecdef],'successor preserves private authority metadata');
  eq(installedWrapper.definition,originalWrapper.definition,'successor does not change the public wrapper');
  await assert.rejects(()=>db.query("select extensions.digest(prosrc::bytea,'sha256') from pg_proc where oid=$1::regprocedure",[signature]),error=>error.code==='22P02');checks++;
  await rolledCase(async()=>{await allReject('new body without ledger',/delegate source differs/);});
  await addLedger();
  await allPass('new body with exact sealed ledger');

  for(const change of [
    "update supabase_migrations.schema_migrations set name='unreviewed_name'",
    "update supabase_migrations.schema_migrations set statements=array['tampered']",
    'update supabase_migrations.schema_migrations set statements=null',
    'insert into supabase_migrations.schema_migrations select * from supabase_migrations.schema_migrations'
  ])await rolledCase(async()=>{await db.exec(change);await allReject('invalid successor ledger',/successor ledger differs/);});
  await rolledCase(async()=>{await db.exec(original.definition);await allReject('old implementation after recorded successor',/delegate source differs/);});
  await rolledCase(async()=>{
    const definition=installed.definition.replace(installed.prosrc,()=>installed.prosrc+'\n-- deliberate synthetic source drift\n');
    assert.notEqual(definition,installed.definition);await db.exec(definition);
    await allReject('modified current implementation',/delegate source differs/);
  });
  await rolledCase(async()=>{
    await db.exec('alter function '+signature+' stable;');
    await allReject('same body but modified full definition',/delegate source differs/);
  });
  await rolledCase(async()=>{
    await db.exec(installedWrapper.definition.replace(installedWrapper.prosrc,()=>installedWrapper.prosrc+'\n-- synthetic wrapper drift\n'));
    await allReject('modified authoritative wrapper',/wrapper differs/);
  });

  for(const text of ['plain source',"select 'quoted '' text';",String.raw`regexp '\mnon[[:space:]-]*mega\M'`,'繁體中文𠮷\nline two\r\n',String.raw`literal backslash \ and double quote "`]){
    const actual=(await db.query("select encode(extensions.digest(pg_catalog.convert_to($1::text,'UTF8'),'sha256'),'hex') source_sha",[text])).rows[0].source_sha;
    eq(actual,hash('sha256',text),'UTF8 hashes exact quote, backslash and Unicode bytes');
  }
  await allPass('all negative-case transactions restore current valid identity');
  eq((await metadata(signature)).definition,installed.definition,'regression cases leave installed reviewed definition unchanged');
  eq((await metadata(wrapper)).definition,installedWrapper.definition,'regression cases leave public wrapper unchanged');
  console.log(JSON.stringify({verified:true,checks,scope:'Exact release blocks and sealed migration in isolated in-memory PostgreSQL; no production access',oldSourceSha:oldSha,currentSourceSha:currentSha,legacyCastError:'22P02'}));
}finally{
  await db.close();
  await fs.rm(temporary,{recursive:true,force:true});
}
