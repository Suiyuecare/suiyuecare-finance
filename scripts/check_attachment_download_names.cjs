'use strict';
// Run shipped helpers and download/signing functions with anonymous local fixtures.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8'),source=read('index.html');
let checks=0;function check(label,ok){assert.ok(ok,label);checks++;}
function sourceRange(start,end){const a=source.indexOf(start),b=source.indexOf(end,a);assert.ok(a>=0&&b>a);return source.slice(a,b);}
const context={URL,console};context.window=context;
vm.runInNewContext(read('assets/engines/finance-v4-engine-registry.js'),context);
vm.runInNewContext(read('assets/engines/attachment-engine.js'),context);
const engine=context.FinanceAttachmentEngine;
const origin='https://private-storage.example.invalid';
const signed=origin+'/storage/v1/object/sign/finance-attachments/path/1788888888888_abcd_PUR-001.xlsx?token=fixture-only&other=a%26b';
const file={n:'1788888888888_abcd_PUR-001.xlsx',path:'expense_requests/production/PUR-001/original.xlsx',bucket:'finance-attachments'};
const record={id:'request-fixture',no:'PUR-001',desc:'次選說明',formPayload:{requestPurpose:'購買照護耗材'},files:[file],steps:[]};
check('single attachment uses request number + purpose with original XLSX extension',engine.downloadName(file,{recordNo:record.no,purpose:'購買照護耗材'})==='PUR-001_購買照護耗材.xlsx');
check('multiple attachments retain readable stable numbering',engine.downloadName(file,{recordNo:record.no,purpose:'耗材',fileCount:2,fileIndex:2})==='PUR-001_耗材_附件02.xlsx');
const unsafe=engine.downloadName({n:'original.PDF'},{recordNo:'../PUR:001',purpose:'夜班\r\n採購\u0000/補充\\?*"<>|\u202e'});
check('path/control/bidi characters are excluded and PDF extension preserved',!/[\\/:*?"<>|\u0000-\u001f\u202e]/.test(unsafe)&&!unsafe.startsWith('.')&&unsafe.endsWith('.pdf'));
check('URL-only legacy metadata never copies a signed token into filename',engine.downloadName(signed,{})==='1788888888888_abcd_PUR-001.xlsx');
check('already-normalized legacy URL basename loses query without losing XLSX',engine.downloadName({n:'original.xlsx?token=fixture-only',t:'xlsx'})==='original.xlsx');
check('missing display filename derives extension from original path',engine.downloadName({n:'附件',path:'private/object.docx'},{recordNo:'REQ-1',purpose:'文件'})==='REQ-1_文件.docx');
check('illegal characters in a real local filename do not erase its extension',engine.downloadName({n:'re?port.xlsx'},{recordNo:'REQ-1',purpose:'檔案'})==='REQ-1_檔案.xlsx');
check('MIME fallback preserves generated spreadsheet extension',engine.downloadName({n:'附件',mime:'application/vnd.ms-excel'},{recordNo:'REQ-1',purpose:'匯出'})==='REQ-1_匯出.xls');
check('invalid metadata cannot create blob/data URL filenames',engine.downloadName('data:application/pdf;base64,SECRET')==='附件');
const long=engine.downloadName(file,{recordNo:'PUR-001',purpose:'中🙂'.repeat(200),fileCount:22,fileIndex:22});
check('long Unicode filename stays below filesystem byte limit with intact extension',Buffer.byteLength(long)<=240&&long.endsWith('_附件22.xlsx')&&!/[\ud800-\udbff]$/.test(long));
check('reserved Windows filename receives a safe prefix',engine.downloadName({n:'CON.xlsx'})==='_CON.xlsx');
const encoded=engine.signedDownloadUrl(signed,'PUR-001_研發 & 100%+#.xlsx',origin),url=new URL(encoded);
check('signed download preserves token and exact custom Unicode filename',url.searchParams.get('token')==='fixture-only'&&url.searchParams.get('download')==='PUR-001_研發 & 100%+#.xlsx');
check('reserved query characters cannot add download URL parameters',url.searchParams.get('other')==='a&b'&&Array.from(url.searchParams.keys()).length===3);
for(const blocked of [signed.replace(origin,'https://attacker.example.invalid'),origin+'/storage/v1/object/public/private/file.xlsx?token=fixture-only','blob:'+origin+'/uuid','data:text/plain,hello',signed.replace('https:','http:')]){
 check('download renaming never rewrites untrusted/public/blob/data URL '+blocked.split(':')[0],engine.signedDownloadUrl(blocked,'safe.xlsx',origin)===blocked);
}
check('preview without a download name preserves URL byte-for-byte',engine.signedDownloadUrl(signed,'',origin)===signed);
function fixture(extra={}){
 const anchors=[],calls=[],alerts=[],audits=[],failures=[];
 class ObjectURL extends URL{static createObjectURL(){return 'blob:https://finance.example.invalid/local-only';}static revokeObjectURL(){}}
 const c={URL:ObjectURL,Blob,console:{warn(){},error(){},info(){}},window:null,REQS:[record],INVS:[],BILLS:[],SUPABASE_URL:origin,SUPABASE_ANON_KEY:'anonymous-fixture',SUPABASE_ATTACHMENT_BUCKET:'finance-attachments',STEP_DOWNLOADS:[file],
  financeAttachmentEngine:()=>engine,normalizeFileMeta:engine.normalizeFileMeta,normalizeFiles:engine.normalizeFiles,uniqueAttachments:engine.uniqueFiles,attachmentStoragePath:engine.storagePath,
  attachmentRecordNoFromPath:engine.recordNoFromPath,attachmentRecordTypeFromPath:engine.recordTypeFromPath,attachmentInList:engine.inList,fileIdentity:engine.fileIdentity,
  num:Number,hasSupabase:()=>true,getSb:()=>({storage:{from:bucket=>({createSignedUrl:async(p,expires,options)=>{calls.push({bucket,path:p,expires,options});return {data:{signedUrl:signed}};}})}}),
  canDownloadAttachment:()=>true,recordAttachmentAccess:(f,a,ctx)=>audits.push({f,a,ctx}),isReceiptBundleAttachment:()=>false,
  attachmentDownloadFailureKind:()=> 'permission',markAttachmentDownloadFailure:(f,kind,button)=>failures.push({kind,button}),attachmentDownloadFailureMessage:()=> 'Denied',rawErrorText:e=>e.message,
  dataUrlToBlob:()=>new Blob(['generated fixture']),alert:t=>alerts.push(t),setTimeout:fn=>fn(),
  document:{createElement:()=>({style:{},click(){anchors.push({href:this.href,download:this.download});}}),body:{appendChild(){},removeChild(){}}},...extra};c.window=c;
 vm.runInNewContext(sourceRange('function findAttachmentOwner(','function currentUserDownloadIds('),c);
 vm.runInNewContext(sourceRange('function attachmentSignedDownloadUrl(','function storagePublicUrl('),c);
 vm.runInNewContext(sourceRange('function attachmentDownloadFileName(','function stepAttachmentHtml('),c);
 return {c,anchors,calls,alerts,audits,failures};
}
(async()=>{
 let f=fixture();await f.c.downloadStepAttachment(0,{id:'real-download-button'});
 check('real step downloader resolves the request context and custom filename',f.anchors[0].download==='PUR-001_購買照護耗材.xlsx');
 check('real private signer receives unchanged bucket/path/expiry and download mode',f.calls.length===1&&f.calls[0].bucket==='finance-attachments'&&f.calls[0].path===file.path&&f.calls[0].expires===60&&f.calls[0].options.download===true);
 check('real cross-origin href carries custom Content-Disposition filename',new URL(f.anchors[0].href).searchParams.get('download')===f.anchors[0].download);
 check('naming never mutates stored metadata or storage key',record.files[0]===file&&file.n==='1788888888888_abcd_PUR-001.xlsx');
 const proof={n:'proof.pdf',path:'expense_requests/production/PUR-001/proof.pdf'};
 f=fixture({REQS:[{...record,files:[file],steps:[{files:[proof,file]}]}],STEP_DOWNLOADS:[proof]});await f.c.downloadStepAttachment(0);
 check('step proof is uniquely numbered against all request attachments',f.anchors[0].download==='PUR-001_購買照護耗材_附件02.pdf');
 f=fixture({canDownloadAttachment:()=>false});await f.c.downloadStepAttachment(0);
 check('denied access causes no signing and no browser download',f.calls.length===0&&f.anchors.length===0&&f.alerts.length===1);
 const oldUrlFile={...file,url:signed};
 f=fixture({STEP_DOWNLOADS:[oldUrlFile],getSb:()=>({storage:{from:()=>({createSignedUrl:async()=>({error:{message:'permission denied',status:403}})})}})});await f.c.downloadStepAttachment(0);
 check('failed current signing never falls back to a stale URL or success',f.anchors.length===0&&f.failures.length===1&&f.alerts[0]==='Denied');
 f=fixture();await f.c.signAttachmentUrl(file,300);
 check('image/PDF preview signature remains non-download and keeps expiry',f.calls[0].options===undefined&&f.calls[0].expires===300);
 const local={n:'匯出原名.xls',t:'xls',url:'data:application/vnd.ms-excel,fixture'};
 f=fixture();await f.c.downloadFileMeta(local,{type:'expense_requests',record:{...record,files:[local]}});
 check('generated local Excel uses same name with a local blob and no Storage call',f.calls.length===0&&f.anchors[0].href.startsWith('blob:')&&f.anchors[0].download==='PUR-001_購買照護耗材.xls');
 f=fixture({isReceiptBundleAttachment:()=>true,receiptBundleSourceFiles:()=>[file],receiptPdfAttachment:async()=>({n:'merged.pdf',t:'pdf',url:'data:application/pdf,fixture'}),friendlyErrorMessage:e=>e.message});await f.c.downloadFileMeta(file,{type:'expense_requests',record});
 check('reconstructed PDF bundle retains request purpose and PDF extension',f.anchors[0].download==='PUR-001_購買照護耗材.pdf');
 let requests=[];f=fixture({hasSupabase:()=>false,fetch:async(url,args)=>{requests.push({url,args});return {ok:true,json:async()=>({signedURL:'/object/sign/finance-attachments/original.xlsx?token=rest-fixture'})};}});
 const rest=await f.c.signAttachmentUrl(file,60,'PUR-001_耗材.xlsx');
 check('existing REST signing fallback safely names its private signed URL',new URL(rest).searchParams.get('token')==='rest-fixture'&&new URL(rest).searchParams.get('download')==='PUR-001_耗材.xlsx'&&requests[0].args.method==='POST');
 console.log('PASS '+checks+' actual attachment name/signing/download checks; anonymous fixtures, no live writes');
})().catch(error=>{console.error(error);process.exitCode=1;});
