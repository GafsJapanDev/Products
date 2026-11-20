
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
function extParseInvoice_(text,supplier){
 const compact=text.replace(/[ \t]+/g,' '),dates=[...compact.matchAll(/(20\d{2}|\d{2})[\/年.-](\d{1,2})[\/月.-](\d{1,2})/g)];
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
  if(type==='return')total=extLabelNumber_(compact,'合\\s*計','');
 }else if(supplier==='maruyasu'){
  const m=compact.match(/\b(0{2,}\d{4,})\b/);invoiceNumber=m?m[1]:'';
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
 return {kind:'invoice',date,supplier,invoiceNumber,printedTotal:total,tax,taxMode,type,lines,
  warnings:['金額・税区分・納品日を原本と照合してください。',...(lines.length?[]:['明細の列を判別できませんでした。原文を確認し明細を入力してください。']),...(supplier==='maruyasu'?['複数枚を1件にまとめ、合計は1回だけ入力してください。']:[])]};
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
function readExtensionOcr(input){
 const state=locked_(()=>extState_()),file=state.file[extText_(input.fileId,100)];
 if(!file)throw Error('先に原本を保存してください');
 const kind=input.kind==='journal'?'journal':'invoice',supplier=extText_(input.supplier,100);
 let temporaryId='',text='';
 try{
  const doc=Drive.Files.create({name:'一時OCR_'+file.id,mimeType:'application/vnd.google-apps.document'},DriveApp.getFileById(file.driveId).getBlob(),{ocrLanguage:'ja',fields:'id'});
  temporaryId=doc.id;text=DocumentApp.openById(temporaryId).getBody().getText();
 }finally{if(temporaryId)Drive.Files.update({trashed:true},temporaryId);}
 if(text.length>50000)throw Error('OCR結果が長すぎます。ページを分けてください');
 return {text,draft:kind==='journal'?extParseJournal_(text):extParseInvoice_(text,supplier),source:{id:file.id,url:file.url}};
}

/** Receives diagnostic messages only. Never accepts photo data, OCR text, tokens or financial records. */
function reportExtensionClientError(input){
 extEnvironment_();
 const stage=extText_(input&&input.stage,150),message=extText_(input&&input.message,1200);
 console.error('[画面エラー] '+JSON.stringify({stage,message,at:new Date().toISOString()}));
 return {logged:true};
}
