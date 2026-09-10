(function(global){
  'use strict';
  // Search only the text and monetary fields supplied by the caller's authorized rows.
  function normalize(value){
    var text=String(value==null?'':value);
    if(text.normalize)text=text.normalize('NFKC');
    return text.toLowerCase().replace(/\u2212/g,'-').replace(/\s+/g,' ').trim();
  }
  function ungroup(text){
    return text.replace(/(^|[^\d,])([+-]?\d{1,3}(?:,\d{3})+)(?![\d,])/g,function(_,prefix,number){return prefix+number.replace(/,/g,'');});
  }
  function monetaryText(value){
    return ungroup(normalize(value).replace(/(?:nt\$|ntd|twd|新臺幣|新台幣|\$)\s*([+-]?\d[\d,]*(?:\.\d+)?)/g,'$1').replace(/(\d)\s*元/g,'$1'));
  }
  function amountText(value){
    if(value==null||typeof value==='boolean'||typeof value==='object')return null;
    if(typeof value==='number'&&!Number.isFinite(value))return null;
    if(typeof value==='number'){
      var cents=Math.round(value*100);
      // Remove only binary floating-point noise from sums, not real fractions.
      if(Number.isSafeInteger(cents)&&Math.abs(value*100-cents)<0.000001)value=(cents/100).toFixed(2);
    }
    var raw=monetaryText(value);
    if(!/^[+-]?\d+(?:\.\d+)?$/.test(raw))return null;
    var sign=raw.charAt(0)==='-'?'-':'',parts=raw.replace(/^[+-]/,'').split('.');
    var whole=parts[0].replace(/^0+(?=\d)/,''),fraction=(parts[1]||'').replace(/0+$/,'');
    if(whole==='0'&&!fraction)sign='';
    return sign+whole+(fraction?'.'+fraction:'');
  }
  function tokens(query){
    return monetaryText(query).split(' ').filter(Boolean).map(function(text){return{text:text,amount:amountText(text),decimal:text.indexOf('.')>=0};});
  }
  function compact(text){return text.replace(/[\s\-_/\\.,，。:：;；()（）\[\]{}〈〉《》「」『』【】·‧•]+/g,'');}
  function createIndex(record){
    record=record||{};
    return {texts:(record.texts||[]).filter(function(v){return v!=null;}).map(monetaryText),amounts:(record.amounts||[]).map(amountText).filter(function(v){return v!==null;}),compactText:record.compactText===true};
  }
  function matchesIndex(query,index){
    var words=tokens(query);if(!words.length)return true;
    var texts=index.texts,amounts=index.amounts;
    return words.every(function(word){
      if(texts.some(function(text){
        if(word.amount!==null&&word.decimal){
          var escaped=word.text.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
          return new RegExp('(^|[^\\d.+-])'+escaped+'(?![\\d.])').test(text);
        }
        return text.indexOf(word.text)>=0;
      }))return true;
      if(word.amount!==null)return amounts.some(function(amount){
        // Decimal queries identify an exact amount, so 12.00 cannot match 1,250.
        return word.decimal?amount===word.amount:amount.indexOf(word.amount)>=0;
      });
      var short=compact(word.text);
      return index.compactText===true&&short!==''&&texts.some(function(text){return compact(text).indexOf(short)>=0;});
    });
  }
  function matches(query,record){return matchesIndex(query,createIndex(record));}
  var api=Object.freeze({matches:matches,createIndex:createIndex,matchesIndex:matchesIndex,normalize:normalize,amountText:amountText,tokens:tokens});
  global.FinanceDocumentSearch=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
