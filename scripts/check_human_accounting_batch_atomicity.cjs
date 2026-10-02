#!/usr/bin/env node
'use strict';
// Fictional PGlite transaction simulation of the expense approval update path.
// The production RPC body is not versioned here; this verifies the same
// before-update guard and Postgres all-or-nothing behavior, not the full RPC.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');

const root=path.resolve(__dirname,'..');
const baseline=fs.readFileSync(path.join(root,'supabase/migrations/20260902054834_preserve_human_accounting_authority_v1.sql'),'utf8');
const migration=fs.readFileSync(path.join(root,'supabase/migrations/20261002035707_finance_human_accounting_float_residue_20261002.sql'),'utf8');
const helperNames=[
  'finance_accounting_manual_fields','finance_accounting_line_is_human',
  'finance_merge_human_accounting_line','finance_merge_human_accounting_lines',
  'finance_preserve_human_accounting_authority'
];
const guardSql=helperNames.map(name=>{
  const match=baseline.match(new RegExp('create or replace function private\\.'+name+'\\([\\s\\S]*?\\$function\\$;','i'));
  assert(match,'baseline contains '+name);
  return match[0];
}).join('\n');
function line(id,net,tax,gross){
  return {id,netAmount:net,taxAmount:tax,grossAmount:gross,
    debitAccount:'6217',creditAccount:'1112',manualOverride:true,valueAuthority:'human',
    manualFields:['netAmount','taxAmount','grossAmount','debitAccount','creditAccount'],
    manualOverrideBy:{id:'fictional-reviewer'},
    manualOverrideHistory:[{at:'2026-10-01T00:00:00Z',changes:{}}]};
}
async function state(db,ids){
  const result=await db.query('select id,revision,form_payload from public.expense_requests where id=any($1::text[]) order by id',[ids]);
  return result.rows;
}

(async()=>{
  const db=new PGlite();
  try{
    await db.exec('create schema private; create table public.expense_requests (id text primary key, revision integer not null default 0, form_payload jsonb not null);');
    await db.exec(guardSql);
    await db.exec('create trigger trg_zz_finance_preserve_human_accounting_authority before update on public.expense_requests for each row execute function private.finance_preserve_human_accounting_authority();');
    await db.exec(migration);
    // Equivalent two-row SQL transaction: the first row is updated before the
    // second is checked, so a later trigger rejection must undo the first.
    await db.exec(`create function public.fixture_bulk_expense_act_active_step(p_ids text[]) returns integer
      language plpgsql as $function$
      declare v_id text; v_count integer := 0;
      begin
        foreach v_id in array p_ids loop
          update public.expense_requests set revision=revision+1 where id=v_id;
          if not found then raise exception 'fixture request not found' using errcode='P0002'; end if;
          v_count := v_count+1;
        end loop;
        return v_count;
      end;
      $function$;`);
    const goodA=line('a',12.1,0.30000000000000004,12.4);
    const goodB=line('b',25.4,1.5999999999999979,27);
    const bad=line('bad',100,5,105.01);
    for(const [id,value] of [['good-a',goodA],['good-b',goodB],['bad-b',bad]]){
      await db.query('insert into public.expense_requests(id,form_payload) values ($1,$2::jsonb)',
        [id,JSON.stringify({accountingLines:[value]})]);
    }
    const success=await db.query('select public.fixture_bulk_expense_act_active_step($1::text[]) as count',
      [['good-a','good-b']]);
    assert.equal(success.rows[0].count,2);
    const approved=await state(db,['good-a','good-b']);
    assert(approved.every(row=>row.revision===1));
    assert.deepEqual(approved[0].form_payload.accountingLines[0].manualOverrideHistory,goodA.manualOverrideHistory);
    assert.deepEqual(approved[1].form_payload.accountingLines[0].manualOverrideHistory,goodB.manualOverrideHistory);
    console.log('PASS fictional two-row approval updates both tiny-residue requests');

    const before=await state(db,['good-a','bad-b']);
    let rejected;
    try{await db.query('select public.fixture_bulk_expense_act_active_step($1::text[]) as count',
      [['good-a','bad-b']]);}catch(error){rejected=error;}
    assert.equal(rejected&&rejected.code,'23514');
    assert.deepEqual(await state(db,['good-a','bad-b']),before);
    console.log('PASS later material mismatch rolls back the first update and preserves both requests');
  }finally{await db.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
