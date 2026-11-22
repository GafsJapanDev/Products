
/** Printed-label mapping lives here. OCR is a draft, never a save/confirmation. */
const EXT_JOURNAL_LABELS={total:'総売上',net:'純売上',tax:'消費税総額',groups:'会計回数'};
const EXT_PAYMENT_LABELS={'現金':'現金','クレジット':'クレジット','カード':'クレジット','交通系電子マネー':'交通系電子マネー','iD':'iD','QUICPay':'QUICPay','銀聯':'UnionPay 銀聯','世田谷ペイ':'世田谷ペイ'};
function extOcrMoney_(s){const m=String(s||'').replace(/,/g,'').match(/(?:¥|￥)?\s*(-?\d+(?:\.\d+)?)/);return m?Number(m[1]):null;}
function extLabelNumber_(text,label,suffix){
 const escaped=label.replace(/[.*+?^$()|[\]\\]/g,'\\$&');
 const match=text.match(new RegExp(escaped+'\\s*[:：]?\\s*([\\d,]+)\\s*'+(suffix||'円')));
 return match?extOcrMoney_(match[1]):null;
}
function extParseJournal_(text){
 const dates=[...text.matchAll(/(20\d{2})[\/年.-](\d{1,2})[\/月.-](\d{1,2})/g)].map(m=>m[1]+'-'+m[2].padStart(2,'0')+'-'+m[3].padStart(2,'0'));
 const payments=[];Object.entries(EXT_PAYMENT_LABELS).forEach(([label,name])=>{
  const line=text.split('\n').find(l=>new RegExp('^\\s*'+label+'\\s').test(l));
  const m=line&&line.match(/([\d,]+)\s*円/);if(m&&!payments.some(p=>p.name===name))payments.push({name,amount:extOcrMoney_(m[1])});
 });
 const people=text.match(/(?:^|\n)\s*(\d+)\s*人(?:\s|$)/);
 return {kind:'journal',date:dates.length?dates[dates.length-1]:'',total:extLabelNumber_(text,EXT_JOURNAL_LABELS.total),
  tax:extLabelNumber_(text,EXT_JOURNAL_LABELS.tax),groups:extLabelNumber_(text,EXT_JOURNAL_LABELS.groups,'件'),
  guests:people?Number(people[1]):null,payments,warnings:['読取候補です。原本と照合してから売上フォームへ反映してください。日計のみのため時間帯別の値は補いません。']};
}
function extParseInvoice_(text,supplier,rowText,crops){
 text=text.normalize('NFKC');
 const aligned=(rowText||text).normalize('NFKC');
 const metadata=text+'\n'+aligned;
 const amountAfter=(pattern,source)=>extOcrMoney_(source.match(pattern)?.[1]);
 const isReturn=/^\s*容\s*器\s*回\s*収\s*票\s*$/m.test(metadata);
 if(isReturn&&(supplier==='カクヤス'||/カ[ \t]*ク[ \t]*ヤ[ \t]*ス/.test(metadata))){
  const parts=metadata.match(/(20\d{2})\s*\/\s*(\d{1,2})\s*\/\s*(\d{1,2})/);
  const date=parts?parts[1]+'-'+parts[2].padStart(2,'0')+'-'+parts[3].padStart(2,'0'):'';
  return {kind:'invoice',type:'return',supplier:'カクヤス',date,taxMode:'monthly',tax:null,lines:[],
   invoiceNumber:metadata.match(/^\s*No\.?[ \t]*([0-9]+)\s*$/im)?.[1]||'',
   printedTotal:amountAfter(/^[ \t]*合[ \t]*計[ \t]+¥?[ \t]*([\d,]+)[ \t]*(?:円)?[ \t]*$/m,aligned),
   warnings:['容器回収票です。印字合計を正の金額で確認してください。集計時に差し引きます。']};
 }
 const detected=[['キタニ水産',/キタニ水産/],['maruyasu',/maruyasu|丸安商店/i],['プレコフーズ',/プレコ|PRECO/i],['西原',/西原商会/],['カクヤス',/カクヤス/]].filter(([,pattern])=>pattern.test(text));
 if(detected.length===1)supplier=detected[0][0];
 let pageNumber=null,pageCount=null;
 const returnWarnings=[];
 const compact=text.replace(/\r/g,''),dates=[...compact.matchAll(/(20\d{2}|\d{2})[\/年.-](\d{1,2})[\/月.-](\d{1,2})/g)];
 const first=dates[0],date=first?(first[1].length===2?'20':'')+first[1]+'-'+first[2].padStart(2,'0')+'-'+first[3].padStart(2,'0'):'';
 let total=extLabelNumber_(compact,'合計金額')??extLabelNumber_(compact,'差引合計')??extLabelNumber_(compact,'合計');
 let invoiceNumber='',tax=null,taxMode='monthly',type=/容器回収票/.test(compact)?'return':'delivery';
 if(supplier==='キタニ水産'){
  const m=compact.match(/本日お買上額[（(]税抜[）)]\s*[¥￥]?([\d,]+)/);total=m?extOcrMoney_(m[1]):null;
  const no=compact.match(/伝票番号\s*(\d+)/);invoiceNumber=no?no[1]:'';
  taxMode='net';tax=extLabelNumber_(compact,'消費税');
 } else if(supplier==='プレコフーズ'){
  taxMode='net';tax=extLabelNumber_(compact,'消費税');total=extLabelNumber_(compact,'納品額','');
  const m=compact.match(/伝票\s*N[oO][.．:]?\s*([0-9-]+)/);invoiceNumber=m?m[1]:'';
 }else if(supplier==='カクヤス'){
  taxMode='monthly';
  const m=compact.match(/(?:伝票\s*N[oO][.．:]?|No[.．]?)\s*(\d+)/);invoiceNumber=m?m[1]:'';
  if(type==='delivery'){
   if(!invoiceNumber){
    // The printed header and its values often arrive on separate OCR lines.
    const header=/日[ \t]*付[^\n]*伝[ \t]*票[ \t]*No\.?[^\n]*\n[ \t]*(\d{2,4}\/\d{1,2}\/\d{1,2})(?:[ \t|]+\d{1,4}){0,2}[ \t|]+(\d{8})[ \t|]+\1(?:[ \t|]|$)/im;
    const numbers=[...new Set([compact,aligned].map(source=>source.match(header)?.[2]).filter(Boolean))];
    if(numbers.length===1)invoiceNumber=numbers[0];
   }
   for(const source of [crops?.totals,aligned]){
    if(!source)continue;
    const totals=[...source.normalize('NFKC').matchAll(/^[ \t]*(差引|売上)?合[ \t]*計[ \t]+¥?[ \t]*([\d,]+)[ \t]*(?:円)?[ \t]*$/gm)];
    const printed=['差引',undefined,'売上'].map(label=>totals.filter(candidate=>candidate[1]===label)).find(matches=>matches.length);
    if(!printed)continue;
    if(printed.length===1)total=extOcrMoney_(printed[0][2]);
    break;
   }
   if(/廃油回収/.test(metadata))returnWarnings.push('納品書に廃油回収があります。印字合計に含まれるマイナス分を確認し、必要なら調整額に入力してください。');
  }
  if(type==='return')total=extLabelNumber_(compact,'合\\s*計','');
 }else if(supplier==='maruyasu'){
  const m=metadata.match(/\b(0{2,}\d{4,})\b/);invoiceNumber=m?m[1]:'';
  const page=metadata.match(/\([ \t]*(\d{1,2})[ \t]*\/[ \t]*(\d{1,2})[ \t]*\)/);
  if(page&&+page[1]>0&&+page[1]<=+page[2]){pageNumber=+page[1];pageCount=+page[2];}
  total=amountAfter(/(?:^|[ \t])合[ \t]*計[ \t]*(?:[▶►▷>]|:)?[ \t]*([\d,]+)[ \t]*(?:円)?[ \t]*$/m,aligned);
 }else if(supplier==='西原'){
  const m=compact.match(/伝票番号\s*(\d+)/);invoiceNumber=m?m[1]:'';
 }
 // Only tabular rows with explicit delimiters are extracted automatically.
 // Drive OCR often destroys columns: in that case retain text and require manual detail entry.
 const lines=[];
 compact.split('\n').forEach(raw=>{
  const cells=raw.split(/\t+|\s*[|｜]\s*/).map(s=>s.trim()).filter(Boolean);
  if(cells.length<5)return;
  const offset=/^\d+$/.test(cells[0])?1:0,name=cells[offset],qty=extOcrMoney_(cells[offset+1]),unit=cells[offset+2],
   price=extOcrMoney_(cells[offset+3]),amount=extOcrMoney_(cells[offset+4]);
  if(name&&qty!==null&&price!==null&&amount!==null&&/^(kg|Kg|KG|g|本|缶|袋|個|パック|P|箱|L|ml|ケース)$/i.test(unit))
   lines.push({name,sku:'',qty,unit,price,amount,rate:'',category:supplier==='カクヤス'?'飲料':'食材',reason:''});
 });
 if(typeof rowText==='string'){
  const browserLines=crops&&supplier==='カクヤス'&&type==='delivery'
   ?extParseKakuyasuCrop_(crops.items)
   :extParseBrowserInvoiceLines_(rowText,supplier);
  lines.splice(0,lines.length,...browserLines);
 }
 return {kind:'invoice',date,supplier,invoiceNumber,printedTotal:total,tax,taxMode,type,lines,pageNumber,pageCount,
  warnings:['金額・税区分・納品日を原本と照合してください。',...returnWarnings,...(lines.length?[]:['明細の列を判別できませんでした。原文を確認し明細を入力してください。']),...(supplier==='maruyasu'?[pageCount>1?('このページは '+pageNumber+'/'+pageCount+'。全ページをまとめて確認してください。'):'複数枚の場合は1件にまとめ、合計は1回だけ入力してください。']:[])]};
}
/** The browser supplies one line of text per visually aligned row. */
function extParseBrowserInvoiceLines_(rowText,supplier){
 const decimal='[+]?(?:\\d{1,3}(?:,\\d{3})+|\\d+)(?:\\.\\d{1,6})?';
 const units='kg|ml|g|l|本|缶|袋|個|枚|パック|箱|ケース|束|玉|尾|丁|点|P';
 const row=new RegExp('^(.+?)\\s+('+decimal+')\\s*(?:('+units+')\\s+|\\s+)'+
  '[¥]?('+decimal+')(?:円)?\\s+[¥]?('+decimal+')(?:円)?$','i');
 const summary=/^(?:税込合計|税抜合計|小計|合計(?:金額)?|消費税(?:額)?|値引(?:き)?|伝票番号|納品日|伝票日付)(?:[ :]|$)/;
 return rowText.split(/\r?\n/).flatMap(raw=>{
  const normalized=raw.normalize('NFKC');
  const cells=normalized.split('|');
  const text=(supplier==='maruyasu'&&cells.length===6?cells.slice(0,5):cells).join(' ').trim();
  const match=text.match(row);
  if(!match||summary.test(text)||/数量.*(?:単価|金額)/.test(text))return [];
  const [,name,quantity,unit,price,amount]=match;
  const values=[quantity,price,amount].map(value=>Number(value.replace(/,/g,'')));
  if(values.some(value=>!Number.isFinite(value)||value>1e10))return [];
  return [{name:name.trim(),sku:'',qty:values[0],unit:unit||'',price:values[1],amount:values[2],
   rate:'',category:supplier==='カクヤス'?'飲料':'食材',reason:''}];
 });
}

function extParseKakuyasuCrop_(text){
 const number='(?:\\d{1,3}(?:,\\d{3})+|\\d+)';
 const row=new RegExp('^(.+?)\\s+外\\s*(8|10)\\s*%\\s+('+number+')\\s+('+number+')'+
  '(?:\\s+('+number+'))?\\s+('+number+')\\s+('+number+')$');
 return text.normalize('NFKC').split(/\r?\n/).flatMap(raw=>{
  const match=raw.replace(/[|│]/g,' ').trim().match(row);
  if(!match)return [];
  const [,label,rate,packText,countText,looseText,priceText,amountText]=match;
  const name=label.replace(/^\d{2}(?:-\d{2}){3}\s+/, '').replace(/\s+\d+(?:\.\d+)?\s*(?:ML|L)$/i,'').trim();
  if(!/[\p{L}]/u.test(name))return [];
  const [pack,count,loose,price,amount]=[packText,countText,looseText,priceText,amountText].map(value=>extOcrMoney_(value));
  if([pack,count,price,amount].some(value=>!Number.isSafeInteger(value)||value<=0))return [];
  // A missing column cannot be guessed. Compare the possible bottle counts to the printed amount.
  const quantities=loose===null?[count,pack*count]:[pack*count+loose];
  const valid=[...new Set(quantities)].filter(qty=>Number.isSafeInteger(qty)&&qty*price===amount);
  if(valid.length!==1)return [];
  const unit=/缶/.test(name)?'缶':/瓶|ペ[ \t]*ッ[ \t]*ト/.test(name)?'本':'';
  return [{name,sku:'',qty:valid[0],unit,price,amount,rate:Number(rate),category:'飲料',reason:''}];
 });
}

function parseExtensionBrowserInvoice(input){
 const started=Date.now(),state=locked_(()=>extState_());
 const file=state.file[extText_(input.fileId,100)];
 if(!file||!['image/jpeg','image/png'].includes(file.mime))throw Error('先に写真の原本を保存してください');
 const text=extText_(input.text,50000),rowText=extText_(input.rowText,50000);
 if(!text||!rowText)throw Error('OCRの読み取り結果が空です');
 const crops=input.crops?{items:extText_(input.crops.items,50000),totals:extText_(input.crops.totals,50000)}:null;
 const draft=extParseInvoice_(text,extText_(input.supplier,100),rowText,crops);
 if(crops&&draft.supplier==='カクヤス'&&draft.type==='delivery')draft.warnings.push('明細表と合計欄を別々に読み直しました。数量・単位を原本と確認してください。');
 draft.warnings.push('試験中のTesseract.jsで抽出した候補です。読み漏れがないか、原本の全明細を確認してください。');
 return {text:crops?[text,'明細表の再 OCR\n'+crops.items,'合計欄の再 OCR\n'+crops.totals].join('\n\n'):text,draft,source:{id:file.id,url:file.url,name:file.name},
  timings:{ocrMs:Date.now()-started,cached:false}};
}

function archiveExtensionDocument(input){return locked_(()=>{
 const month=extMonth_(input.month),p=extEnvironment_(),id=extText_(input.id,100);
 if(!/^[a-zA-Z0-9_-]{8,100}$/.test(id))throw Error('原本IDが不正です');
 const mime=extText_(input.mime),allowed=['image/jpeg','image/png','application/pdf'];
 if(!allowed.includes(mime))throw Error('JPEG・PNG・PDFを選択してください');
 const encoded=extText_(input.base64,12000000),bytes=Utilities.base64Decode(encoded);
 if(bytes.length>8*1024*1024||!bytes.length)throw Error('原本は8MB以内です');
 const hash=extHash_(encoded),state=extState_(),old=state.file[id];
 if(old){if(old.hash!==hash)throw Error('別の原本IDを使用してください');return old;}
 const root=DriveApp.getFolderById(p.getProperty('TEST_ROOT_ID')||p.getProperty('FOLDER_ID'));
 const folders=root.getFoldersByName('原本_'+month),folder=folders.hasNext()?folders.next():root.createFolder('原本_'+month);
 const name=extText_(input.name,150)||id,existing=folder.getFilesByName(id+'_'+name);
 const file=existing.hasNext()?existing.next():folder.createFile(Utilities.newBlob(bytes,mime,id+'_'+name));
 const value={id,month,name,mime,driveId:file.getId(),url:file.getUrl(),hash};
 return extWrite_('file',id,0,{opId:'file_'+id,hash},value).value;
 });}

function extOcrResult_(text,kind,supplier,file,cached,started){
 return {text,draft:kind==='journal'?extParseJournal_(text):extParseInvoice_(text,supplier),
  source:{id:file.id,url:file.url,name:file.name},timings:{ocrMs:Date.now()-started,cached}};
}
function readExtensionOcr(input){
 const started=Date.now(),state=locked_(()=>extState_()),file=state.file[extText_(input.fileId,100)];
 if(!file)throw Error('先に原本を保存してください');
 const kind=input.kind==='journal'?'journal':'invoice',supplier=extText_(input.supplier,100);
 const raw=DriveApp.getFileById(file.driveId),parents=raw.getParents();
 if(!parents.hasNext())throw Error('原本の保存先が見つかりません');
 const folder=parents.next(),cacheName='ocr_v2_'+(file.hash||file.id)+'.txt',cachedFiles=folder.getFilesByName(cacheName);
 if(!input.force&&cachedFiles.hasNext()){
  const text=cachedFiles.next().getBlob().getDataAsString('UTF-8');
  if(text.length<=50000)return extOcrResult_(text,kind,supplier,file,true,started);
 }
 let temporaryId='',text='',failure=null;
 try{
  const doc=Drive.Files.create({name:'一時OCR_'+file.id,mimeType:'application/vnd.google-apps.document'},raw.getBlob(),{ocrLanguage:'ja',fields:'id'});
  temporaryId=doc.id;text=DocumentApp.openById(temporaryId).getBody().getText();
 }catch(error){failure=error;}
 finally{if(temporaryId){try{Drive.Files.update({trashed:true},temporaryId);}catch(error){if(!failure)failure=error;else console.error('OCR一時ファイル後片付け失敗 '+temporaryId);}}}
 if(failure)throw failure;
 if(text.length>50000)throw Error('OCR結果が長すぎます。ページを分けてください');
 if(!text.trim())throw Error('文字を読み取れませんでした。写真の向き・明るさを確認するか手入力してください');
 // Cache raw text only; supplier-specific interpretation is recomputed on each request.
 try{if(!folder.getFilesByName(cacheName).hasNext())folder.createFile(cacheName,text,MimeType.PLAIN_TEXT);}catch(error){console.warn('OCR結果キャッシュ保存失敗');}
 return extOcrResult_(text,kind,supplier,file,false,started);
}
function processExtensionReceipt(input){
 const started=Date.now();let source=null,stage='原本保存';
 try{
  source=archiveExtensionDocument(input);stage='OCR';
  const result=readExtensionOcr({fileId:source.id,kind:input.kind,supplier:input.supplier,force:input.force===true});
  return {ok:true,...result,timings:{...result.timings,totalMs:Date.now()-started}};
 }catch(error){
  const message=error&&error.message||String(error||'処理結果を取得できませんでした');
  console.error(JSON.stringify({stage,message,fileId:source&&source.id}));
  return {ok:false,stage,error:message,source:source?{id:source.id,url:source.url,name:source.name}:null};
 }
}

/** Receives diagnostic messages only. Never accepts photo data, OCR text, tokens or financial records. */
function reportExtensionClientError(input){
 extEnvironment_();
 const stage=extText_(input&&input.stage,150),message=extText_(input&&input.message,1200);
 console.error('[画面エラー] '+JSON.stringify({stage,message,at:new Date().toISOString()}));
 return {logged:true};
}
