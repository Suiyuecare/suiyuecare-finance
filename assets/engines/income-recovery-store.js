(function(root){
  'use strict';
  // Web Storage holds only an opaque recovery receipt. Private form snapshots
  // use IndexedDB so large batches never consume the small sessionStorage quota.
  var database='finance-income-recovery-v1',storeName='snapshots',epochs=Object.create(null),generations=Object.create(null);
  function open(){return new Promise(function(resolve,reject){
    if(!root.indexedDB||!root.crypto||!root.crypto.subtle){var e=new Error('Encrypted recovery storage unavailable');e.code='RECOVERY_STORAGE_UNAVAILABLE';reject(e);return;}
    var request=root.indexedDB.open(database,1),abandoned=false;
    request.onupgradeneeded=function(){request.result.createObjectStore(storeName,{keyPath:'id'});};
    request.onerror=function(){reject(request.error);};request.onblocked=function(){abandoned=true;reject(new Error('Recovery storage upgrade blocked'));};
    request.onsuccess=function(){if(abandoned)request.result.close();else resolve(request.result);};
  });}
  async function transaction(mode,run){var db=await open();try{return await new Promise(function(resolve,reject){
    var tx=db.transaction(storeName,mode),result;tx.oncomplete=function(){resolve(result);};tx.onerror=function(){reject(tx.error);};tx.onabort=function(){reject(tx.error||new Error('Recovery storage transaction aborted'));};
    run(tx.objectStore(storeName),function(value){result=value;});
  });}finally{db.close();}}
  function id(owner,kind){return JSON.stringify([owner,kind]);}
  function epochId(owner){return id(owner,'__logout_epoch');}
  function storedEpoch(owner){return transaction('readonly',function(store,done){var request=store.get(epochId(owner));request.onsuccess=function(){done(request.result?request.result.epoch:0);};});}
  var api={
    async save(owner,kind,operationKey,payload){
      var epoch=epochs[owner]||0,scopeId=id(owner,kind),generation=(generations[scopeId]||0)+1;generations[scopeId]=generation;
      var durableEpoch=await storedEpoch(owner);
      var key=await root.crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']),iv=root.crypto.getRandomValues(new Uint8Array(12));
      var aad=new TextEncoder().encode(id(owner,kind)+'|'+operationKey);
      var bytes=new TextEncoder().encode(JSON.stringify(payload));
      var encrypted=await root.crypto.subtle.encrypt({name:'AES-GCM',iv:iv,additionalData:aad},key,bytes);
      if((epochs[owner]||0)!==epoch||generations[scopeId]!==generation)throw new Error('Recovery owner signed out');
      var written=await transaction('readwrite',function(store,done){var request=store.get(epochId(owner));request.onsuccess=function(){
        // The check and write share a transaction: logout from another tab
        // cannot delete private data and then have this in-flight save recreate it.
        if((request.result?request.result.epoch:0)!==durableEpoch){done(false);return;}
        store.put({id:id(owner,kind),owner:owner,kind:kind,operationKey:operationKey,key:key,iv:iv,encrypted:encrypted});done(true);
      };});
      if(!written)throw new Error('Recovery owner signed out');
      // A completed IDB transaction is the durability boundary. Verify that
      // the exact operation can be read before a financial write is dispatched.
      if((epochs[owner]||0)!==epoch||generations[scopeId]!==generation){await api.remove(owner,kind,operationKey);throw new Error('Recovery owner signed out');}
      var saved=await api.load(owner,kind,operationKey);if(!saved)throw new Error('Recovery snapshot readback failed');return true;
    },
    async load(owner,kind,operationKey){
      var row=await transaction('readonly',function(store,done){var request=store.get(id(owner,kind));request.onsuccess=function(){done(request.result);};});
      if(!row)return null;
      if(row.owner!==owner||row.kind!==kind||row.operationKey!==operationKey)throw new Error('Recovery snapshot scope mismatch');
      var aad=new TextEncoder().encode(id(owner,kind)+'|'+operationKey);
      var decoded=await root.crypto.subtle.decrypt({name:'AES-GCM',iv:row.iv,additionalData:aad},row.key,row.encrypted);
      return JSON.parse(new TextDecoder().decode(decoded));
    },
    async remove(owner,kind,operationKey){return transaction('readwrite',function(store){var request=store.get(id(owner,kind));request.onsuccess=function(){if(request.result&&request.result.operationKey===operationKey)store.delete(request.result.id);};});},
    async clearOwner(owner){epochs[owner]=(epochs[owner]||0)+1;return transaction('readwrite',function(store){
      var epochRequest=store.get(epochId(owner));epochRequest.onsuccess=function(){
        var nextEpoch=(epochRequest.result?epochRequest.result.epoch:0)+1;
        var request=store.openCursor();request.onsuccess=function(){var cursor=request.result;
          if(cursor){if(cursor.value.owner===owner)cursor.delete();cursor.continue();}
          else store.put({id:epochId(owner),owner:owner,epoch:nextEpoch});
        };
      };
    });}
  };
  root.FinanceIncomeRecoveryStore=api;
})(typeof window==='object'?window:globalThis);
