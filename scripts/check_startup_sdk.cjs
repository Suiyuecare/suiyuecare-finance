'use strict';
// Real build transform and official UMD; all Auth targets are fictional and no
// network request is allowed. Mutations apply only to a temporary source fixture.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),vm=require('node:vm'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {createStartupBundle,pinnedSupabaseSdk,SDK}=require('./finance_startup_bundle');
const {applyBuildEnvironment}=require('./finance_build_environment');
const root=path.resolve(__dirname,'..'),html=fs.readFileSync(path.join(root,'index.html'),'utf8');
let count=0;function check(name,fn){fn();count++;console.log('PASS '+name);}
(async()=>{
 const sdk=pinnedSupabaseSdk(root);
 check('official version and SHA stay fixed',()=>{assert.equal(SDK.version,'2.111.0');assert.equal(crypto.createHash('sha256').update(sdk.code).digest('hex'),'7396012594aa6d23bb373ebc25d1080bf3672fa847c3713f756520b40fd13453');assert.equal(sdk.code.length,210547);});
 check('official license and npm integrity proof are present',()=>{assert.match(sdk.license.toString(),/MIT License/);assert.equal(sdk.provenance.dist.integrity,'sha512-9q0\/AULthQnWeiDh1vGyjoJZbSY04bu6qHcWit70pqEYn5Kv/dkCPY62Ja1123jEnJbB9Vd2pjY7Kvk/lK3peA==');});
 check('only content-hash startup paths gain immutable caching',()=>{
  const headers=JSON.parse(fs.readFileSync(path.join(root,'vercel.json'),'utf8')).headers;
  for(const source of ['/assets/finance-startup-:hash([a-f0-9]{16}).js','/assets/supabase-js-2.111.0-:hash([a-f0-9]{16}).js'])assert.equal(headers.find(h=>h.source===source).headers.find(h=>h.key==='Cache-Control').value,'public, max-age=31536000, immutable');
  for(const source of ['/','/:path*.html'])assert.equal(headers.find(h=>h.source===source).headers.find(h=>h.key==='Cache-Control').value,'no-store, max-age=0');
  assert(!headers.some(h=>h.source.includes('release-manifest')&&h.headers.some(v=>/immutable/.test(v.value))));
 });
 for(const target of ['local','preview','production']){
  const source=applyBuildEnvironment(html,{target,runtimeMode:target==='production'?'production-supabase':'local-test',supabaseUrl:target==='production'?'https://fixture.supabase.co':'',supabaseAnonKey:target==='production'?'fictional-public-key':''});
  const first=createStartupBundle(source,root),second=createStartupBundle(source,root);
  check(target+' uses deterministic same-origin preload and one synchronous SDK before app',()=>{
   assert.equal(first.html,second.html);assert.equal(first.file,second.file);assert.equal(first.code,second.code);assert(first.sdk.code.equals(second.sdk.code));
   assert(!first.html.includes(SDK.url));assert.equal(first.html.split('src="'+sdk.file+'"').length-1,1);assert.equal(first.html.split('href="'+sdk.file+'"').length-1,1);
   assert(first.html.indexOf('href="'+sdk.file+'"')<first.html.indexOf('</head>'));assert(first.html.includes('<script src="'+sdk.file+'"></script>\n<script>\n(function(){'));
   assert(first.html.indexOf('finance-v4-engine-registry.js')<0);assert.equal(first.sources[0],'assets/engines/finance-v4-engine-registry.js');
  });
 }
 for(const changed of [html.replace(SDK.url,SDK.url.replace('2.111.0','2.112.0')),html.replace('<script src="'+SDK.url+'"></script>',''),html+'<script src="'+SDK.url+'"></script>'])check('missing/duplicate/upgraded CDN source refuses build',()=>assert.throws(()=>createStartupBundle(changed,root),/exactly one pinned/));
 const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'finance-sdk-fixture-'));
 try{
  for(const file of [SDK.source,SDK.license,SDK.provenance]){fs.mkdirSync(path.dirname(path.join(temporary,file)),{recursive:true});fs.copyFileSync(path.join(root,file),path.join(temporary,file));}
  for(const file of [SDK.source,SDK.license,SDK.provenance]){
   const full=path.join(temporary,file),original=fs.readFileSync(full);fs.unlinkSync(full);check('missing '+file+' refuses build',()=>assert.throws(()=>pinnedSupabaseSdk(temporary)));
   fs.writeFileSync(full,file===SDK.provenance?JSON.stringify({...sdk.provenance,version:'2.112.0'}):Buffer.concat([original,Buffer.from('\nchanged')]));check('altered '+file+' refuses build',()=>assert.throws(()=>pinnedSupabaseSdk(temporary),/invalid/));fs.writeFileSync(full,original);
  }
 }finally{fs.rmSync(temporary,{recursive:true,force:true});}
 let calls=0;const c={console,URL,URLSearchParams,Headers,Request,Response,TextEncoder,TextDecoder,AbortController,crypto:crypto.webcrypto,atob,btoa,setTimeout,clearTimeout,setInterval,clearInterval,WebSocket:class{constructor(){throw Error('WebSocket connections forbidden by SDK fixture');}},fetch:async()=>{calls++;throw Error('Network forbidden by SDK fixture');}};c.globalThis=c;vm.createContext(c);vm.runInContext(sdk.code.toString(),c);
 check('actual official UMD exposes client and Auth entry',()=>{assert.equal(typeof c.supabase.createClient,'function');assert.equal(typeof c.supabase.SupabaseClient,'function');});
 const client=c.supabase.createClient('https://sdk-fixture.invalid','fictional-public-key',{auth:{autoRefreshToken:false,persistSession:false,detectSessionInUrl:false}});
 const oauth=await client.auth.signInWithOAuth({provider:'google',options:{skipBrowserRedirect:true,redirectTo:'https://finance-fixture.invalid/'}});
 check('real SDK constructs Google kickoff URL without navigating or issuing a request',()=>{assert.equal(oauth.error,null);const u=new URL(oauth.data.url);assert.equal(u.origin,'https://sdk-fixture.invalid');assert.equal(u.pathname,'/auth/v1/authorize');assert.equal(u.searchParams.get('provider'),'google');assert.equal(u.searchParams.get('redirect_to'),'https://finance-fixture.invalid/');assert.equal(calls,0);});
 const session=await client.auth.getSession();check('real SDK starts with no invented session',()=>{assert.equal(session.error,null);assert.equal(session.data.session,null);assert.equal(calls,0);});
 console.log('Startup SDK: '+count+' checks PASS');
})().catch(e=>{console.error(e);process.exitCode=1;});
