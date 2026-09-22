/** Shared server-only protocol. Secrets are never imported by the web application. */
export const HR_URL='https://eswdhynrbzrjgetnmhit.supabase.co/functions/v1/hr-finance-bridge';
export const FINANCE_URL='https://udtlppnrugmtzhigdsxo.supabase.co/functions/v1/hr-payroll-intake';
export const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export type Purpose='intake'|'export'|'callback';
export class BridgeError extends Error {constructor(public code:string,public status=400){super(code);}}
const encoder=new TextEncoder();
const hex=(bytes:ArrayBuffer)=>Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
async function key(secret:string){if(!/^[0-9a-f]{64}$/.test(secret))throw new BridgeError('BRIDGE_NOT_CONFIGURED',503);return crypto.subtle.importKey('raw',Uint8Array.from(secret.match(/../g)!,x=>parseInt(x,16)),{name:'HMAC',hash:'SHA-256'},false,['sign','verify']);}
function signing(purpose:Purpose,timestamp:string,nonce:string,raw:string){return encoder.encode(`v1\n${purpose}\n${timestamp}\n${nonce}\n${raw}`);}
export async function signedHeaders(purpose:Purpose,raw:string,secret:string,now=Date.now(),nonce:string=crypto.randomUUID()):Promise<Record<string,string>>{
 const timestamp=String(Math.floor(now/1000));return {'content-type':'application/json','x-hr-bridge-timestamp':timestamp,'x-hr-bridge-nonce':nonce,'x-hr-bridge-signature':hex(await crypto.subtle.sign('HMAC',await key(secret),signing(purpose,timestamp,nonce,raw)))};
}
export async function verifySignature(headers:Headers,purpose:Purpose,raw:string,secret:string,now=Date.now()):Promise<void>{
 const timestamp=headers.get('x-hr-bridge-timestamp')??'',nonce=headers.get('x-hr-bridge-nonce')??'',signature=headers.get('x-hr-bridge-signature')??'';
 if(!/^\d{10}$/.test(timestamp)||!UUID.test(nonce)||!/^\p{ASCII}{64}$/u.test(signature)||!/^[0-9a-f]{64}$/.test(signature)||Math.abs(now/1000-Number(timestamp))>300)throw new BridgeError('BRIDGE_UNAUTHENTICATED',401);
 const bytes=Uint8Array.from(signature.match(/../g)!,x=>parseInt(x,16));
 if(!await crypto.subtle.verify('HMAC',await key(secret),bytes,signing(purpose,timestamp,nonce,raw)))throw new BridgeError('BRIDGE_UNAUTHENTICATED',401);
}
export async function readBody(req:Request):Promise<string>{
 if(!/^application\/json(?:\s*;|$)/i.test(req.headers.get('content-type')??''))throw new BridgeError('BRIDGE_JSON_REQUIRED',415);
 if(Number(req.headers.get('content-length')??0)>524288)throw new BridgeError('BRIDGE_TOO_LARGE',413);
 const reader=req.body?.getReader();if(!reader)throw new BridgeError('BRIDGE_INVALID_INPUT');let size=0;const parts:Uint8Array[]=[];
 while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>524288){await reader.cancel();throw new BridgeError('BRIDGE_TOO_LARGE',413);}parts.push(value);}
 const bytes=new Uint8Array(size);let offset=0;for(const p of parts){bytes.set(p,offset);offset+=p.length;}return new TextDecoder('utf-8',{fatal:true}).decode(bytes);
}
export function parseBody(raw:string):Record<string,any>{let body;try{body=JSON.parse(raw);}catch{throw new BridgeError('BRIDGE_INVALID_INPUT');}if(!body||typeof body!=='object'||Array.isArray(body))throw new BridgeError('BRIDGE_INVALID_INPUT');return body;}
export function allowKeys(body:Record<string,any>,keys:string[]){if(Object.keys(body).some(k=>!keys.includes(k)))throw new BridgeError('BRIDGE_INVALID_INPUT');}
export function requireUUID(value:unknown):asserts value is string{if(typeof value!=='string'||!UUID.test(value))throw new BridgeError('BRIDGE_INVALID_INPUT');}
export function safeCode(error:unknown){const text=error instanceof Error?error.message:String((error as any)?.message??'');return text.match(/\b(?:HR_|FINANCE_HR_|BRIDGE_)[A-Z0-9_]+\b/)?.[0]??'BRIDGE_OPERATION_FAILED';}
export type Rpc=(name:string,args:Record<string,unknown>)=>Promise<any>;
export interface BridgeDeps {service:Rpc;user:(jwt:string)=>Promise<Rpc>;secret:(purpose:Purpose)=>string;fetch:typeof fetch;now?:()=>number;}
export function token(req:Request){const match=/^Bearer ([^\s]+)$/i.exec(req.headers.get('authorization')??'');if(!match)throw new BridgeError('BRIDGE_UNAUTHENTICATED',401);return match[1];}
export async function postSigned(deps:BridgeDeps,url:string,purpose:Purpose,body:unknown){
 if(url!==HR_URL&&url!==FINANCE_URL)throw new BridgeError('BRIDGE_TARGET_INVALID');const raw=JSON.stringify(body);
 const res=await deps.fetch(url,{method:'POST',headers:await signedHeaders(purpose,raw,deps.secret(purpose),deps.now?.()),body:raw,redirect:'error',signal:AbortSignal.timeout(20000)});
 const text=await readBody(res as unknown as Request);const result=parseBody(text);if(!res.ok)throw new BridgeError(safeCode({message:result.error}),res.status>=500?502:400);return result;
}
export function response(body:unknown,status=200,origin?:string){return new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json','cache-control':'no-store',...(origin?{'access-control-allow-origin':origin,'vary':'Origin'}:{})}});}
export function cors(req:Request,origins:string[]):Response|undefined{const origin=req.headers.get('origin');if(origin&&!origins.includes(origin))return response({error:'BRIDGE_ORIGIN_FORBIDDEN'},403);if(req.method==='OPTIONS')return new Response(null,{status:204,headers:{...(origin?{'access-control-allow-origin':origin,'vary':'Origin'}:{}),'access-control-allow-methods':'POST, OPTIONS','access-control-allow-headers':'authorization, apikey, content-type, x-client-info','access-control-max-age':'600'}});if(req.method!=='POST')return response({error:'BRIDGE_METHOD_NOT_ALLOWED'},405,origin??undefined);}
