'use strict';
const assert=require('node:assert/strict');
const engine=require('../assets/engines/employee-form-ux');
(async()=>{
  let checks=0;function equal(actual,expected,label){assert.deepEqual(actual,expected,label);checks++;}
  equal(engine.sizeLabel(0),'0 B','zero-byte file remains explicit');
  equal(engine.sizeLabel(undefined),'大小未提供','missing size is never a claimed zero');
  equal(engine.sizeLabel(1024),'1.0 KB','typed sizes');
  const small={name:'有效.pdf',size:100},exact={name:'最大.pdf',size:engine.MAX_BYTES},large={name:'超大.pdf',size:engine.MAX_BYTES+1};
  const result=engine.selectFiles([small,large,exact]);
  equal(result.accepted,[small,exact],'partial selection keeps both valid files in order');equal(result.rejected.map(x=>x.name),['超大.pdf'],'exact 50MB allowed, plus one rejected');
  const validation=engine.selectFiles([small,{name:'bad.html',size:1}],f=>{if(f.name.endsWith('.html'))throw Error('不支援');});
  equal(validation.accepted,[small],'reuse upload MIME/type validation without losing valid files');equal(validation.rejected.length,1,'unsupported rejected immediately');
  for(const [type,content,expected] of [['application/pdf','%PDF-1.4\n',true],['application/pdf','<script>bad</script>',false],['image/png','<svg onload=bad()>',false],['image/svg+xml','<svg/>',false],['text/html','%PDF-1.4',false],['image/gif','GIF89a',true],['image/webp','RIFF1234WEBP',true],['image/jpeg',new Uint8Array([255,216,255]),true],['image/png',new Uint8Array([137,80,78,71,13,10,26,10]),true]]){
    const blob=new Blob([content],{type});equal(!!await engine.safePreviewBlob(blob),expected,'preview MIME and signature '+type);
  }
  for(const url of ['https://example.invalid/private.pdf','javascript:alert(1)','blob:unowned','data:image/svg+xml,<svg/>','data:application/pdf;base64,%%%'])equal(await engine.safePreviewBlob({url}),null,'no remote fetch or active content');
  equal(!!await engine.safePreviewBlob({url:'data:application/pdf;base64,JVBERi0xLjQK'}),true,'restored local data PDF is verified');
  console.log('employee form UX: '+checks+' checks PASS');
})().catch(error=>{console.error(error);process.exitCode=1;});
