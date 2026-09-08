'use strict';
// Local HTTPS origins reproduce browser cross-origin download behavior. Only
// anonymous fixture data and shipped download functions are used; no live API.
const fs=require('node:fs'),path=require('node:path'),https=require('node:https'),crypto=require('node:crypto');
const assert=require('node:assert/strict'),{execFile}=require('node:child_process'),{promisify}=require('node:util');
const run=promisify(execFile),root=path.resolve(__dirname,'..'),source=fs.readFileSync(path.join(root,'index.html'),'utf8');
const out=fs.mkdtempSync('/tmp/finance-download-browser-'),downloads=path.join(out,'downloads');fs.mkdirSync(downloads);
const session='finance-download-'+process.pid,servers=[];
const checkedSources=['index.html','assets/engines/attachment-engine.js','assets/templates/hr_expense_template.xlsx','scripts/check_attachment_download_browser.cjs'];
function sha256(bytes){return crypto.createHash('sha256').update(bytes).digest('hex');}
function sourceHashes(){return Object.fromEntries(checkedSources.map(file=>[file,sha256(fs.readFileSync(path.join(root,file)))]));}
const sourceBefore=sourceHashes();
async function browser(...args){return (await run('agent-browser',['--session',session,'--ignore-https-errors','--download-path',downloads,...args],{timeout:25000,maxBuffer:2*1024*1024})).stdout;}
async function waitForDownload(filename,expectedBytes){
 const target=path.join(downloads,filename),deadline=Date.now()+15000;
 while(Date.now()<deadline){
  if(fs.existsSync(target)&&fs.statSync(target).size===expectedBytes)return;
  await new Promise(resolve=>setTimeout(resolve,100));
 }
 throw new Error('Browser did not finish the expected download within 15 seconds: '+filename);
}
function sourceRange(start,end){const a=source.indexOf(start),b=source.indexOf(end,a);assert.ok(a>=0&&b>a);return source.slice(a,b);}
(async()=>{
 await run('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',path.join(out,'key.pem'),'-out',path.join(out,'cert.pem'),'-subj','/CN=localhost','-days','1'],{timeout:10000});
 const tls={key:fs.readFileSync(path.join(out,'key.pem')),cert:fs.readFileSync(path.join(out,'cert.pem'))};
 const content=fs.readFileSync(path.join(root,'assets/templates/hr_expense_template.xlsx')),requests=[];
 const storage=https.createServer(tls,(req,res)=>{const u=new URL(req.url,'https://localhost');requests.push({path:u.pathname,download:u.searchParams.get('download')});if(!u.pathname.startsWith('/storage/v1/object/sign/')||u.searchParams.get('token')!=='local-fixture'){res.writeHead(403);res.end();return;}const name=u.searchParams.get('download')||'1788888888888_abcd_PUR-001.xlsx';res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');res.setHeader('Content-Disposition',"attachment; filename=\"internal.xlsx\"; filename*=UTF-8''"+encodeURIComponent(name));res.end(content);});servers.push(storage);await new Promise(resolve=>storage.listen(0,'127.0.0.1',resolve));
 const storageOrigin='https://127.0.0.1:'+storage.address().port;
 const js=[fs.readFileSync(path.join(root,'assets/engines/finance-v4-engine-registry.js'),'utf8'),fs.readFileSync(path.join(root,'assets/engines/attachment-engine.js'),'utf8'),`
 var SUPABASE_URL=${JSON.stringify(storageOrigin)},SUPABASE_ATTACHMENT_BUCKET='finance-attachments';
 var engine=window.FinanceAttachmentEngine;function financeAttachmentEngine(){return engine;}
 var normalizeFileMeta=engine.normalizeFileMeta,uniqueAttachments=engine.uniqueFiles,attachmentStoragePath=engine.storagePath,fileIdentity=engine.fileIdentity,attachmentRecordNoFromPath=engine.recordNoFromPath;
 var file={n:'1788888888888_abcd_PUR-001.xlsx',bucket:SUPABASE_ATTACHMENT_BUCKET,path:'anonymous-original.xlsx'};
 var record={no:'PUR-001',formPayload:{requestPurpose:'採購照護耗材 & 清潔用品'},files:[file],steps:[]};
 function findAttachmentOwner(){return {type:'expense_requests',record:record};}function canDownloadAttachment(){return true;}function isReceiptBundleAttachment(){return false;}
 function hasSupabase(){return true;}function num(v){return Number(v||0);}function recordAttachmentAccess(){}
 function getSb(){return {storage:{from:function(){return {createSignedUrl:async function(){return {data:{signedUrl:SUPABASE_URL+'/storage/v1/object/sign/finance-attachments/anonymous-original.xlsx?token=local-fixture'}};}};}}};}
 `,sourceRange('function attachmentSignedDownloadUrl(','function storagePublicUrl('),sourceRange('function attachmentDownloadFileName(','function stepAttachmentHtml(')].join('\n');
 const app=https.createServer(tls,(req,res)=>{res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<!doctype html><meta charset="utf-8"><title>匿名跨網域下載驗收</title><h1>下載檔名驗收</h1><p>單號 PUR-001；申請目的：採購照護耗材 &amp; 清潔用品</p><button id="download" onclick="downloadFileMeta(file,{})">下載 Excel</button><script>'+js.replace(/<\/script/gi,'<\\/script')+'</script>');});servers.push(app);await new Promise(resolve=>app.listen(0,'127.0.0.1',resolve));
 await browser('open','https://127.0.0.1:'+app.address().port+'/');
 // Let eval return before the download starts: the driver can otherwise wait
 // for a document navigation that a Content-Disposition download never commits.
 await browser('eval',"setTimeout(function(){document.getElementById('download').click();},100);'download scheduled'");
 const expectedFilename='PUR-001_採購照護耗材 & 清潔用品.xlsx';
 await waitForDownload(expectedFilename,content.length);
 const saved=fs.readdirSync(downloads);assert.deepEqual(saved,[expectedFilename]);
 const originalSha256=sha256(content),downloadedSha256=sha256(fs.readFileSync(path.join(downloads,saved[0])));
 assert.equal(downloadedSha256,originalSha256,'Downloaded bytes equal the original XLSX; naming never changes file contents');
 assert.deepEqual(requests,[{path:'/storage/v1/object/sign/finance-attachments/anonymous-original.xlsx',download:saved[0]}]);
 assert.equal((await browser('errors')).trim(),'');
 const sourceAfter=sourceHashes();assert.deepEqual(sourceAfter,sourceBefore,'Reviewed source and original attachment remain unchanged');
 fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({ok:true,filename:saved[0],bytes:content.length,originalSha256,downloadedSha256,sourceBefore,sourceAfter,requests},null,2));
 console.log('PASS browser saved exact cross-origin request-purpose filename and original XLSX bytes: '+path.join(downloads,saved[0]));
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{await browser('close').catch(()=>{});for(const server of servers)await new Promise(resolve=>server.close(resolve));});
