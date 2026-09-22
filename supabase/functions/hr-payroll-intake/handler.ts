import {allowKeys,BridgeError,cors,HR_URL,parseBody,postSigned,readBody,requireUUID,response,safeCode,token,verifySignature,type BridgeDeps} from '../_shared/hr-finance-protocol.ts';
async function flush(deps:BridgeDeps,obligationId:string):Promise<boolean>{
 for(let attempt=0;attempt<10;attempt++){
  const events=await deps.service('finance_hr_callback_claim',{p_obligation_id:obligationId,p_limit:1});
  if(!Array.isArray(events))throw new BridgeError('BRIDGE_INVALID_RESPONSE',502);if(!events.length)return false;
  for(const ev of events){requireUUID(ev.eventId);requireUUID(ev.leaseId);let success=false;
   try{const result=await postSigned(deps,HR_URL,'callback',{type:'callback',event:ev.payload});success=result.accepted===true;}catch{/* No salary data or raw remote errors are logged. */}
   const ack=await deps.service('finance_hr_callback_ack',{p_event_id:ev.eventId,p_lease_id:ev.leaseId,p_success:success,p_error_code:success?null:'HR_CALLBACK_UNAVAILABLE'});
   if(ack!==true||!success)return true;
  }
 }
 return true;
}
export function createHandler(deps:BridgeDeps){return async(req:Request):Promise<Response>=>{
 const preflight=cors(req,['https://finance.suiyuecare.com']);if(preflight)return preflight;const origin=req.headers.get('origin')??undefined;
 try{
  const raw=await readBody(req);const body=parseBody(raw);
  if(body.type==='callback.flush'){
   allowKeys(body,['type','obligationId']);requireUUID(body.obligationId);const user=await deps.user(token(req));
   if(await user('finance_hr_callback_authorize',{p_obligation_id:body.obligationId})!==true)throw new BridgeError('BRIDGE_FORBIDDEN',403);
   return response({accepted:true,callbackPending:await flush(deps,body.obligationId)},200,origin);
  }
  await verifySignature(req.headers,'intake',raw,deps.secret('intake'),deps.now?.());
  requireUUID(body.eventId);requireUUID(body.obligationId);if(body.schemaVersion!==1||typeof body.sourceHash!=='string'||!/^([0-9a-f]{64})$/.test(body.sourceHash))throw new BridgeError('BRIDGE_INVALID_INPUT');
  if(body.type==='intake'){
   allowKeys(body,['type','schemaVersion','eventId','obligationId','sourceHash']);
   const result=await postSigned(deps,HR_URL,'export',{type:'export',obligationId:body.obligationId,eventId:body.eventId});const e=result.envelope;
   if(!e||e.obligationId!==body.obligationId||e.sourceHash!==body.sourceHash)throw new BridgeError('BRIDGE_SOURCE_MISMATCH');
   await deps.service('finance_hr_intake',{p_event_id:body.eventId,p_envelope:e});
  }else if(body.type==='applicant_confirmed'){
   allowKeys(body,['type','schemaVersion','eventId','obligationId','sourceHash','financeVersion','hrActorId','evidence']);requireUUID(body.hrActorId);
   if(!Number.isInteger(body.financeVersion)||body.financeVersion<1)throw new BridgeError('BRIDGE_INVALID_INPUT');
   await deps.service('finance_hr_applicant_confirm',{p_obligation_id:body.obligationId,p_expected_version:body.financeVersion,p_request_id:body.eventId,p_hr_actor_id:body.hrActorId,p_evidence:body.evidence,p_source_hash:body.sourceHash});
  }else throw new BridgeError('BRIDGE_INVALID_INPUT');
  let pending=true;try{pending=await flush(deps,body.obligationId);}catch{/* Intake remains durable even if callback delivery is interrupted. */}
  return response({accepted:true,callbackPending:pending},200);
 }catch(error){return response({error:safeCode(error)},error instanceof BridgeError?error.status:400,origin);}
};}
