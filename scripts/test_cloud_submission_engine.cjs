#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const engine = require('../assets/engines/cloud-submission-workspace.js');
let checks = 0;
function ok(condition, message) { assert(condition, message); checks++; }
function fixture(config = {}) {
  const items = Array.from({length: config.count || 201}, (_, index) => ({client_item_key: 'item-' + index, nested: {amount: 5, label: '測試'}}));
  let owner = 'uid|tenant|finance|production', calls = [], slots = new Map();
  const state = {ok: true, id: 'draft-stable', documentType:'invoice', files:[], dataEnvironment: 'production', revision: 1, state: 'draft', payload: {items}, expectedCount: items.length, stagedCount: 0, stagedFingerprint: null, operationKey: 'server-key'};
  const copy = () => JSON.parse(JSON.stringify(state));
  const api = engine.create({identity: () => owner, onProgress: value => { if (config.progress) config.progress.push(value); }, rpc: async (name, args) => {
    calls.push({name, args});
    if (config.delay) await new Promise(resolve => setTimeout(resolve, 1));
    if (config.onCall) config.onCall(name, () => { owner = 'different|identity'; });
    if (name === 'finance_cloud_draft_read_v1') return {data: copy()};
    if (name === 'finance_cloud_draft_save_v1') { state.payload = args.p_payload;state.files=args.p_files;state.documentType=args.p_document_type;state.revision++; return config.loseSaveReply?{error:{code:'NETWORK',message:'save reply lost'}}:{data: copy()}; }
    if (name === 'finance_cloud_submission_begin_v1') { state.state = 'staging'; return {data: copy()}; }
    if (name === 'finance_cloud_submission_stage_v1') {
      if (config.failChunk === args.p_start) return {error: {code: 'NETWORK', message: 'connection interrupted'}};
      args.p_items.forEach((item, i) => slots.set(args.p_start + i, item)); state.stagedCount = slots.size;
      if (slots.size === state.expectedCount) { state.state = 'ready'; state.stagedFingerprint = 'server-fingerprint'; }
      return {data: copy()};
    }
    if (name === 'finance_cloud_submission_commit_v1') {
      if (!config.noCommit) { state.state = 'committed'; state.result = {ok: true, count: items.length, batch_id: 'one-batch', rows: items.map((x, i) => ({id: 'formal-' + i, batch_id: 'one-batch'}))}; }
      if (config.loseCommitReply) return {error: {code: 'NETWORK', message: 'lost reply'}};
      return {data: copy()};
    }
    throw new Error('unexpected RPC ' + name);
  }});
  return {api, state, items, calls, copy, changeOwner: () => { owner = 'different'; }};
}
async function main() {
  const progress = [], f = fixture({progress, delay: true});
  // JSONB may reorder keys; this must not be mistaken for an edited draft.
  const reordered = f.items.map(x => ({nested: {label: x.nested.label, amount: x.nested.amount}, client_item_key: x.client_item_key}));
  const [a, b] = await Promise.all([f.api.stageAndCommit(f.copy(), reordered), f.api.stageAndCommit(f.copy(), reordered)]);
  ok(a.state === 'committed' && b.result.count === 201, 'double click returns same formal result');
  ok(f.calls.filter(x => x.name.endsWith('commit_v1')).length === 1, 'one commit per in-flight draft');
  assert.deepEqual(f.calls.filter(x => x.name.endsWith('stage_v1')).map(x => [x.args.p_start, x.args.p_items.length]), [[0,100],[100,100],[200,1]]);checks++;
  ok(progress.at(-1).phase === 'committed' && progress.at(-1).saved === 201, 'accurate progress');
  const before = f.calls.length; await f.api.stageAndCommit(f.copy());
  ok(f.calls.length === before + 1, 'reopened app reads original committed result without re-submit');
  const lost = fixture({loseCommitReply: true}); const recovered = await lost.api.stageAndCommit(lost.copy());
  ok(recovered.state === 'committed' && lost.calls.at(-1).name.endsWith('read_v1'), 'lost commit reply recovered by original draft');
  const uncertain = fixture({loseCommitReply: true, noCommit: true});
  await assert.rejects(uncertain.api.stageAndCommit(uncertain.copy()), e => e.resultUnknown === true && e.draftId === 'draft-stable');checks++;
  ok(uncertain.calls.filter(x => x.name.endsWith('commit_v1')).length === 1, 'unknown result does not generate replacement submission');
  const interrupted = fixture({failChunk: 100}); await assert.rejects(interrupted.api.stageAndCommit(interrupted.copy()), {code: 'NETWORK'});checks++;
  ok(!interrupted.calls.some(x => x.name.endsWith('commit_v1')) && interrupted.state.stagedCount === 100, 'partial staging never publishes');
  const changed = fixture(); await assert.rejects(changed.api.stageAndCommit(changed.copy(), [{client_item_key:'different'}]), {code:'PT409'});checks++;
  ok(changed.calls.length === 1, 'changed payload requires save before staging');
  const stale = fixture(); await assert.rejects(stale.api.stageAndCommit({...stale.copy(),revision:0}), {code:'PT409'});checks++;
  const switched = fixture({onCall(name, switchUser) { if (name.endsWith('stage_v1')) switchUser(); }});
  await assert.rejects(switched.api.stageAndCommit(switched.copy()), {code:'CLIENT_IDENTITY_CHANGED'});checks++;
  ok(!switched.calls.some(x => x.name.endsWith('commit_v1')), 'identity switch drops reply and cannot commit');
  const large = fixture({count:2001}); await assert.rejects(large.api.stageAndCommit(large.copy()),{code:'BATCH_LIMIT'});checks++;
  const files = fixture();
  await assert.rejects(files.api.save({id:'x',kind:'invoice',payload:{file:new Blob(['not uploaded'])}}),{code:'UNSAVED_FILE'});checks++;
  await assert.rejects(files.api.save({id:'x',kind:'invoice',files:[{bucket:'finance-attachments',path:'x',url:'data:private'}]}),{code:'UNSAVED_FILE'});checks++;
  const common = {unit: '共用物件'}; await files.api.save({id:'x',kind:'invoice',payload:{items:[{a:common},{b:common}]}});
  ok(files.calls.length === 1, 'shared plain references are serializable, unuploaded files are not');
  const lostSave = fixture({loseSaveReply:true});
  const saved = await lostSave.api.save({id:'draft-stable',revision:1,kind:'invoice',payload:{items:lostSave.items,ui:{title:'完整內容'}}});
  ok(saved.revision===2&&saved.reconciledSave&&lostSave.calls.at(-1).name.endsWith('read_v1'),'lost save reply reads complete saved payload and current revision');
  const exact = await lostSave.api.reconcileSave({id:'draft-stable',kind:'invoice',payload:{ui:{title:'完整內容'},items:lostSave.items},files:[]});
  ok(exact.revision===2,'reopened app compares canonical full payload, independent of stale local revision');
  await assert.rejects(lostSave.api.reconcileSave({id:'draft-stable',kind:'invoice',payload:{items:lostSave.items,ui:{title:'不同內容'}}}),{code:'PT409'});checks++;
  await assert.rejects(lostSave.api.reconcileSave({id:'draft-stable',kind:'invoice',payload:saved.payload,files:[{bucket:'finance-attachments',path:'different'}]}),{code:'PT409'});checks++;
  ok(!lostSave.calls.some(x=>x.name.endsWith('begin_v1')||x.name.endsWith('commit_v1')),'save reconciliation never creates or submits different content');
  const never = engine.create({identity: () => 'owner', timeoutMs: 5, rpc: () => new Promise(() => {})});
  const started = Date.now();
  await assert.rejects(never.read('same-draft'), e => e.code === 'CLOUD_RESULT_UNKNOWN' && e.resultUnknown && e.draftId === 'same-draft');checks++;
  ok(Date.now() - started < 1000, 'unresponsive RPC settles within configured bound');
  console.log('PASS cloud submission engine ' + checks + ' checks');
}
main().catch(error => {console.error(error);process.exitCode=1;});
