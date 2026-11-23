
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
  const result=extParseKakuyasuReturn_(aligned),fallback=aligned===text?result:extParseKakuyasuReturn_(text);
  const totals=[...new Set([result.total,fallback.total].filter(value=>value!==null))];
  return {kind:'invoice',type:'return',supplier:'カクヤス',date,taxMode:'monthly',tax:null,
   lines:result.lines.length>=fallback.lines.length?result.lines:fallback.lines,
   invoiceNumber:metadata.match(/^\s*No\.?[ \t]*([0-9]+)\s*$/im)?.[1]||'',
   printedTotal:totals.length===1?totals[0]:null,
   warnings:['容器回収票です。印字合計を正の金額で確認してください。集計時に差し引きます。']};
 }
 const detected=[['キタニ水産',/キタニ水産/],['maruyasu',/maruyasu|丸安商店/i],['プレコフーズ',/プレコ|PRECO/i],['西原',/西原商会/],['カクヤス',/カクヤス/]].filter(([,pattern])=>pattern.test(text));
 if(detected.length===1)supplier=detected[0][0];
 let pageNumber=null,pageCount=null,requiresQuantityReview=false;
 const returnWarnings=[];
 const compact=text.replace(/\r/g,''),dates=[...compact.matchAll(/(20\d{2}|\d{2})[ \t]*[\/年.-][ \t]*(\d{1,2})[ \t]*[\/月.-][ \t]*(\d{1,2})/g)];
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
   if(!/^\d{8}$/.test(invoiceNumber))invoiceNumber='';
   if(!invoiceNumber){
    const splitNumber=compact.match(/^[^\n]*?伝[ \t]*票[ \t]*No\.?(?:[ \t]+\d{2,4}\/\d{1,2}\/\d{1,2})?[ \t]*\n(?:[ \t]*[O○◎][ \t]*\n)?[ \t]*(\d{8})[ \t]*$/im);
    const separated=compact.match(/^[ \t]*伝[ \t]*票[ \t]*No\.?[ \t]*\n[ \t]*(\d{2,4}\/\d{1,2}\/\d{1,2})[ \t]*\n[ \t]*\d{1,4}[ \t]*\n[ \t]*(\d{8})[ \t]*\n[ \t]*\1[ \t]*$/im);
    invoiceNumber=splitNumber?.[1]||separated?.[2]||'';
   }
   if(!invoiceNumber){
    // The printed header and its values often arrive on separate OCR lines.
    const header=/日[ \t]*付[^\n]*伝[ \t]*票[ \t]*No\.?[^\n]*\n[^\n]*?[ \t|]?(\d{2,4}\/\d{1,2}\/\d{1,2})(?:[ \t|]+\d{1,4}){0,2}[ \t|]+(\d{8})[ \t|]+\1(?:[ \t|]|$)/im;
    const numbers=[...new Set([compact,aligned].map(source=>source.match(header)?.[2]).filter(Boolean))];
    if(numbers.length===1)invoiceNumber=numbers[0];
   }
   for(const source of [crops?.totals,aligned]){
    if(!source)continue;
    const totals=[...source.normalize('NFKC').matchAll(/^[ \t|│]*(差引|売上)?合[ \t]*計[ \t|│]+¥?[ \t]*([\d,]+)[ \t]*(?:円)?[ \t|│]*$/gm)];
    const printed=['差引',undefined,'売上'].map(label=>totals.filter(candidate=>candidate[1]===label)).find(matches=>matches.length);
    if(!printed)continue;
    if(printed.length===1)total=extOcrMoney_(printed[0][2]);
    break;
   }

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
  if(crops&&supplier==='カクヤス'&&type==='delivery'){
   for(const cell of crops.cells||[]){
    const {name,qty,price,amount}=cell;
    if(!/[\p{L}]/u.test(name)||![price,amount].every(value=>Number.isSafeInteger(value)&&value>0))continue;
    const verifiedQty=Number.isSafeInteger(qty)&&qty>0&&qty*price===amount?qty:null;
    if(verifiedQty===null)requiresQuantityReview=true;
    const matches=lines.filter(line=>line.price===price&&line.amount===amount);
    if(matches.length===1&&matches[0].qty===null&&verifiedQty!==null)matches[0].qty=verifiedQty;
    if(!browserLines.length&&!matches.length)lines.push({name,sku:'',qty:verifiedQty,unit:'',price,amount,rate:'',category:'飲料',reason:''});
   }
  }
 }
 if(!lines.length&&crops&&supplier==='カクヤス'&&type==='delivery'){
  lines.push(...extParseKakuyasuWrappedRows_(crops.items));
  requiresQuantityReview=lines.length>0;
 }
 if(typeof rowText!=='string'&&supplier==='maruyasu'){
  const drive=extParseMaruyasuDrive_(compact);
  if(!lines.length)lines.push(...drive.lines);
  if(drive.total!==null)total=drive.total;
 }
 if(typeof rowText!=='string'&&supplier==='カクヤス'&&type==='delivery'){
  const drive=extParseKakuyasuDrive_(compact);
  if(!lines.length)lines.push(...drive.lines);
  if(drive.total!==null)total=drive.total;
 }
 if(supplier==='カクヤス'&&type==='delivery'){
  if(/廃油回収/.test(metadata))returnWarnings.push(lines.some(line=>line.amount<0&&/廃油回収/.test(line.name))
   ?'廃油回収はマイナス明細に含まれています。調整額で重ねて差し引かないでください。'
   :'廃油回収の金額を原本で確認し、マイナス明細として追加してください。');
  lines.forEach(line=>{line.unit='';});
  requiresQuantityReview=lines.some(line=>line.qty===null);
 }
 return {kind:'invoice',date,supplier,invoiceNumber,printedTotal:total,tax,taxMode,type,lines,pageNumber,pageCount,requiresQuantityReview,
  warnings:['金額・税区分・納品日を原本と照合してください。',...returnWarnings,...(requiresQuantityReview?['数量を読み取れない明細があります。必要に応じて原本を見て補ってください。']:[]),...(lines.length?[]:['明細の列を判別できませんでした。原文を確認し明細を入力してください。']),...(supplier==='maruyasu'?[pageCount>1?('このページは '+pageNumber+'/'+pageCount+'。全ページをまとめて確認してください。'):'複数枚の場合は1件にまとめ、合計は1回だけ入力してください。']:[])]};
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

function extParseMaruyasuDrive_(text){
 const rows=text.split(/\r?\n/).map(row=>row.trim().replace(/,(?=[ \t]+\d{3}\b)[ \t]+/g,',')).filter(Boolean);
 const money=/^\d+(?:,\d{3})*$/;
 const totalLabel=/^合[ \t]*計[ \t]*(?:[▶▸►▷▹>›→:]?[ \t]*)(?:(\d+(?:,\d{3})*)[ \t]*円?)?$/;
 const end=rows.findIndex(row=>totalLabel.test(row));
 const totals=new Set();
 rows.forEach((row,index)=>{
  const match=row.match(totalLabel);
  if(!match) return;
  const value=match[1]||rows[index+1];
  if(money.test(value||''))totals.add(extOcrMoney_(value));
 });
 const body=rows.slice(0,end===-1?rows.length:end);
 const table=body.findIndex((row,index)=>/品名.*数量.*[単单]位.*金額/.test(
  body.slice(Math.max(0,index-12),index+1).join('').replace(/\s/g,'')
 ));
 const lines=[];
 if(table!==-1){
  for(let index=table+1;index+3<body.length;index++){
   const [name,quantity,unitPrice,amountRow]=body.slice(index,index+4);
   const amount=amountRow.match(/^(\d+(?:,\d{3})*)(?:[ \t]+[^\n]+)?$/)?.[1];
   const qty=quantity.match(/^(\d+(?:\.\d+)?)[ \t]*([^\d\r\n]{1,12})$/);
   if(!/[\p{L}]/u.test(name)||!qty||!money.test(unitPrice)||!amount)continue;
   const count=Number(qty[1]),price=extOcrMoney_(unitPrice),value=extOcrMoney_(amount);
   if(!Number.isFinite(count)||count<=0||!Number.isSafeInteger(price)||!Number.isSafeInteger(value)||Math.abs(count*price-value)>1)continue;
   const recognizedUnit=qty[2].replace(/[ \t]/g,'').replace(/^[パバ][ッツ]ク$/,'パック').toLowerCase();
   const unit=/^(?:kg|g|ml|l|パック|束|袋|個|本|枚|箱|玉)$/.test(recognizedUnit)?recognizedUnit:'';
   lines.push({name,sku:'',qty:count,unit,price,amount:value,rate:'',category:'食材',reason:''});
   index+=3;
  }
 }
 return {lines,total:totals.size===1?[...totals][0]:null};
}

function extParseKakuyasuReturn_(text){
 const cleaned=text.replace(/\r/g,'').replace(/,(?=[ \t]+\d{3}\b)[ \t]+/g,',');
 const totalPattern=/^[ \t|]*合[ \t]*計[ \t|]*(?:\n[ \t|]*)?¥?[ \t]*(\d+(?:,\d{3})*)[ \t]*円?[ \t|]*$/gm;
 const totals=[...new Set([...cleaned.matchAll(totalPattern)].map(match=>extOcrMoney_(match[1])))];
 const body=cleaned.split(/^[ \t|]*合[ \t]*計/m)[0];
 const item=/^[ \t|]*([^\n|]*空[ \t]*容[ \t]*器[^\n|]*?)[ \t|]*(?:\n[ \t|]*)?(\d+)[ \t]*バ[ \t]*ラ[ \t|]*(?:\n[ \t|]*)?(\d+(?:,\d{3})*)[ \t]*円?[ \t|]*$/gm;
 const lines=[...body.matchAll(item)].flatMap(([,name,count,amount])=>{
  const qty=Number(count),value=extOcrMoney_(amount);
  if(!Number.isSafeInteger(qty)||qty<=0||!Number.isSafeInteger(value))return [];
  return [{name:name.trim(),sku:'',qty,unit:'',price:null,amount:value,rate:'',category:'容器',reason:''}];
 });
 return {lines,total:totals.length===1?totals[0]:null};
}

function extParseKakuyasuDrive_(text){
 const rows=text.split(/\r?\n/).map(row=>row.trim().replace(/^[−–—](?=\d)/,'-').replace(/,(?=[ \t]+\d{3}(?:\D|$))[ \t]+/g,',')).filter(Boolean);
 const code=/^\d{2}(?:-\d{2}){3}$/;
 const amount=/^\d+(?:,\d{3})*$/;
 const first=rows.findIndex(row=>code.test(row));
 if(first===-1)return {lines:[],total:null};
 const heading=rows.slice(Math.max(0,first-12),first+10).join('').replace(/\s/g,'');
 const footer=rows.findIndex((row,index)=>index>first&&/^(?:摘\s*要|(?:売上|差引)?合\s*計(?:$|[ \t]))/.test(row));
 const body=rows.slice(first,footer===-1?rows.length:footer);
 const lines=[];
 if(/商品名.*税区.*入数.*ケース数.*バラ数.*金額/.test(heading)){
  const starts=body.flatMap((row,index)=>code.test(row)?[index]:[]);
  for(const [number,index] of starts.entries()){
   const item=body.slice(index+1,starts[number+1]);
   const name=item[0]?.replace(/^商\s*品\s*名\s+/,'');
   const taxIndex=item.findIndex(row=>/^(?:[外内][ \t]*)?(?:[0-9A-Za-z-]+)[ \t]*%$/.test(row));
   if(!name||!/[\p{L}]/u.test(name)||taxIndex<2)continue;
   const values=item.slice(taxIndex+1);
   const numeric=count=>{
    if(![4,5].includes(count.length)||!count.slice(0,-2).every(value=>amount.test(value))||
     !count.slice(-2).every(value=>amount.test(value.replace(/^-/,''))))return null;
    const [qty,price,lineAmount]=count.slice(-3).map(extOcrMoney_);
    const validSign=/廃油回収/.test(name)?price<0&&lineAmount<0:price>0&&lineAmount>0;
    return [qty,price,lineAmount].every(Number.isSafeInteger)&&qty>0&&validSign&&qty*price===lineAmount
     ?[qty,price,lineAmount]:null;
   };
   const last=values[values.length-1]||'';
   const trailingSku=/^\d{5,8}$/.test(last)?last:'';
   const full=numeric(values),withoutSku=trailingSku?numeric(values.slice(0,-1)):null;
   if(Boolean(full)===Boolean(withoutSku))continue;
   const [qty,price,lineAmount]=full||withoutSku;
   const tax=item[taxIndex].match(/^(?:(?:外|内)\s*|[0-9A-Za-z]+-\s*)?(8|10)\s*%$/);
   lines.push({name,sku:withoutSku?trailingSku:'',qty,unit:'',price,amount:lineAmount,rate:tax?Number(tax[1]):'',category:lineAmount<0?'雑費':'飲料',reason:''});
  }
 }
 const totals=new Map();
 for(let index=footer;index>=0&&index<rows.length;index++){
  const match=rows[index].match(/^(差引|売上)?合[ \t]*計(?:[ \t]+([\d,]+)[ \t]*円?)?$/);
  if(!match)continue;
  const value=match[2]||rows[index+1];
  if(!amount.test(value||''))continue;
  const label=match[1]||'合計';
  if(!totals.has(label))totals.set(label,new Set());
  totals.get(label).add(extOcrMoney_(value));
 }
 const preferred=['差引','合計','売上'].map(label=>totals.get(label)).find(Boolean);
 return {lines,total:preferred?.size===1?[...preferred][0]:null};
}

function extParseKakuyasuCrop_(text){
 const number='(?:\\d{1,3}(?:,\\d{3})+|\\d+)';
 const row=new RegExp('^(.+?)\\s+外\\s*(8|10)\\s*%\\s+('+number+')\\s+('+number+')'+
  '(?:\\s+('+number+'))?\\s+('+number+')\\s+('+number+')$');
 return text.normalize('NFKC').split(/\r?\n/).flatMap(raw=>{
  const match=raw.replace(/[|│]/g,' ').trim().match(row);
  if(!match)return [];
  const [,label,rate,,,looseText,priceText,amountText]=match;
  const name=label.replace(/^\d{2}(?:-\d{2}){3}\s+/, '').replace(/\s+\d+(?:\.\d+)?\s*(?:ML|L)$/i,'').trim();
  if(!/[\p{L}]/u.test(name))return [];
  const [qty,price,amount]=[looseText,priceText,amountText].map(value=>extOcrMoney_(value));
  if([price,amount].some(value=>!Number.isSafeInteger(value)||value<=0))return [];
  // One surviving count could be the case count. Require a separate observation of the loose-count cell.
  return [{name,sku:'',qty,unit:'',price,amount,rate:Number(rate),category:'飲料',reason:''}];
 });
}

function extParseKakuyasuWrappedRows_(text){
 const rows=text.normalize('NFKC').split(/\r?\n/).map(row=>row.replace(/[|│]/g,' ').trim());
 const start=/^(\d{2}(?:-\d{2}){3})\s+(.+?)\s+\d+(?:\.\d+)?\s*(?:ML|L)$/i;
 const numericTail=/^(?:\d{1,6}[ \t]+)?外[ \t]*(8|10)[ \t]*%[ \t]+([\d,]+)[ \t]+([\d,]+)$/;
 const result=[];
 for(let index=0;index<rows.length;index++){
  const item=rows[index].match(start);
  if(!item||!/[\p{Script=Han}\p{Script=Katakana}\p{Script=Hiragana}]/u.test(item[2]))continue;
  for(const row of rows.slice(index+1,index+4)){
   if(/^\d{2}(?:-\d{2}){3}|^摘\s*要|合\s*計/.test(row))break;
   const values=row.match(numericTail);
   if(!values)continue;
   const price=extOcrMoney_(values[2]),amount=extOcrMoney_(values[3]);
   if(price>0&&amount>=price&&amount%price===0){
    result.push({name:item[2],sku:'',qty:null,unit:'',price,amount,rate:Number(values[1]),category:'飲料',reason:''});
   }
   break;
  }
 }
 return result;
}

function parseExtensionBrowserInvoice(input){
 const started=Date.now(),state=locked_(()=>extState_());
 const file=state.file[extText_(input.fileId,100)];
 if(!file||!['image/jpeg','image/png'].includes(file.mime))throw Error('先に写真の原本を保存してください');
 const text=extText_(input.text,50000),rowText=extText_(input.rowText,50000);
 if(!text||!rowText)throw Error('OCRの読み取り結果が空です');
 const crops=input.crops?{items:extText_(input.crops.items,50000),totals:extText_(input.crops.totals,50000)}:null;
 if(crops&&Array.isArray(input.crops.cells)){
  crops.cells=input.crops.cells.slice(0,20).map(cell=>({
   name:extText_(cell.name,150),qty:extOcrMoney_(cell.qty),price:extOcrMoney_(cell.price),amount:extOcrMoney_(cell.amount)
  }));
 }
 const draft=extParseInvoice_(text,extText_(input.supplier,100),rowText,crops);
 if(crops&&draft.supplier==='カクヤス'&&draft.type==='delivery')draft.warnings.push('明細表と合計欄を別々に読み直しました。数量・単位を原本と確認してください。');
 draft.warnings.push('試験中のTesseract.jsで抽出した候補です。読み漏れがないか、原本の全明細を確認してください。');
 return {text:crops?[text,'明細表の再 OCR\n'+crops.items,'合計欄の再 OCR\n'+crops.totals,...(crops.cells?.length?['バラ数セルの再 OCR\n'+crops.cells.map(cell=>[cell.name,cell.qty,cell.price,cell.amount].join(' / ')).join('\n')]:[])].join('\n\n'):text,draft,source:{id:file.id,url:file.url,name:file.name},
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
