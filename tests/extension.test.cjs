
'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const sourceFiles=['Code.gs','ExtensionStore.gs','ExtensionPurchases.gs','ExtensionInventory.gs','ExtensionAssistant.gs','ExtensionOcr.gs'];
function harness(){
 const sheets=new Map(),props={APP_ENV:'test',TEST_ROOT_ID:'root',FOLDER_ID:'root',EXTENSION_BOOK_ID:'master'};
 class Sheet{
  constructor(){this.data=[];}getLastRow(){return this.data.length;}getMaxRows(){return 1000;}getMaxColumns(){return 50;}
  setFrozenRows(){}clearContents(){this.data=[];}appendRow(r){this.data.push(r);}
  getRange(row,col,count=1,width=1){const self=this;return {getValues:()=>Array.from({length:count},(_,i)=>Array.from({length:width},(_,j)=>self.data[row+i-1]?.[col+j-1]??'')),
   setValues:values=>values.forEach((r,i)=>{self.data[row+i-1]||=[];r.forEach((v,j)=>self.data[row+i-1][col+j-1]=v);})};}
 }
 const book={getSheetByName:n=>sheets.get(n),insertSheet:n=>{const s=new Sheet();sheets.set(n,s);return s;}};
 book.insertSheet('変更履歴').appendRow(['op','kind','id','version','at','hash','json']);
 let fetches=0;
 const ctx=vm.createContext({console,Date,JSON,Math,Set,Map,Number,String,Object,Array,Error,MimeType:{PLAIN_TEXT:'text/plain'},
  Utilities:{DigestAlgorithm:{SHA_256:'sha256'},Charset:{UTF_8:'utf8'},computeDigest:(_,s)=>[...crypto.createHash('sha256').update(s).digest()],getUuid:()=>crypto.randomUUID(),
   formatDate:(d,tz,pattern)=>{const text=new Date(d.getTime()+9*3600000).toISOString();return pattern==='yyyy-MM'?text.slice(0,7):text.slice(0,10);}},
  PropertiesService:{getScriptProperties:()=>({getProperty:k=>props[k],getProperties:()=>({...props})})},
  DriveApp:{getFileById:()=>({getParents:()=>{let used=false;return {hasNext:()=>!used,next:()=>{used=true;return {getId:()=> 'root',getFilesByName:()=>({hasNext:()=>false}),createFile(){}};}};},getBlob:()=>({})})},
  SpreadsheetApp:{flush:()=>{},openById:()=>book},LockService:{getScriptLock:()=>({waitLock(){},releaseLock(){}})},
  UrlFetchApp:{fetch:()=>{fetches++;throw Error('offline');}}
 });
 sourceFiles.forEach(f=>vm.runInContext(fs.readFileSync(f,'utf8'),ctx,{filename:f}));
 ctx.month_=()=>null;ctx.records_=()=>[];ctx.rebuild_=()=>{};
 ctx.testBook=book;ctx.testSheets=sheets;ctx.testProps=props;ctx.fetchCount=()=>fetches;
 return ctx;
}
function invoiceInput(ctx,overrides={}){
 return {opId:crypto.randomUUID(),id:crypto.randomUUID(),version:0,date:'2026-11-02',supplier:'キタニ水産',invoiceNumber:crypto.randomUUID(),
  type:'delivery',taxMode:'gross',printedTotal:200,tax:'',adjustment:0,reason:'',status:'confirmed',fileIds:[],
  lines:[{name:'ぶり',sku:'001',qty:2,unit:'kg',price:100,amount:200,rate:8,category:'食材',reason:''}],...overrides};
}
let passed=0;
function test(name,fn){fn();passed++;console.log('OK '+name);}
test('supplier-specific products, invoice totals and detail comparison use different data',()=>{
 const c=harness(),a=invoiceInput(c,{printedTotal:300,reason:'送料100',adjustment:100});
 c.saveExtensionInvoice(a);c.saveExtensionInvoice(invoiceInput(c,{supplier:'西原',printedTotal:200}));
 const state=c.extState_(),ids=Object.values(state.invoice).map(i=>i.lines[0].productId);
 assert.notEqual(ids[0],ids[1]);
 const monthly=c.extRunQuery_('monthlyTotals',{supplier:'キタニ水産'},state,'2026-11-19');
 assert.equal(monthly.rows[2].total,300);
 const compare=c.extRunQuery_('itemComparison',{supplier:'キタニ水産'},state,'2026-11-19');
 assert.equal(compare.rows[0].current,200);
 assert.equal(c.extRunQuery_('latestPrices',{item:'鰤'},state,'2026-11-19').rows.length,2);
});
test('zero amount is different from no data; totals-only invoices mark missing detail',()=>{
 const c=harness();c.saveExtensionInvoice(invoiceInput(c,{printedTotal:0,lines:[]}));
 const state=c.extState_(),r=c.extRunQuery_('monthlyTotals',{supplier:'キタニ水産'},state,'2026-11-19');
 assert.equal(r.rows[0].total,null);assert.equal(r.rows[2].total,0);
 assert.equal(c.extRunQuery_('latestPrices',{item:'ぶり'},state,'2026-11-19').missingDetails,1);
});
test('save operation is idempotent and stale edits fail',()=>{
 const c=harness(),i=invoiceInput(c);c.saveExtensionInvoice(i);c.saveExtensionInvoice(i);
 assert.equal(c.extEvents_().filter(e=>e.kind==='invoice').length,1);
 assert.throws(()=>c.saveExtensionInvoice({...i,opId:crypto.randomUUID(),printedTotal:201,reason:'修正'}),/内容が変わりました/);
});
test('linked legacy amount is replaced once; cancelling excludes only that invoice',()=>{
 const c=harness(),item={kind:'食材',name:'キタニ水産',amount:200},legacy={id:'legacy-id',date:'2026-11-02',items:[item]};
 c.records_=()=>[legacy];const i=invoiceInput(c,{legacyLink:{month:'2026-11',recordId:legacy.id,itemIndex:0,fingerprint:JSON.stringify(item)}});
 const saved=c.saveExtensionInvoice(i).invoice;
 const fake={getSheetByName:()=>({getRange:()=>({setValues:v=>{fake.matrix=v;}})})};
 const matrix=()=>{const v=Array.from({length:31},()=>Array(9).fill(0));v[1][0]=200;return v;};
 c.extOverlayPurchases_(fake,'2026-11',matrix());assert.equal(fake.matrix[1][0],200);
 c.saveExtensionInvoice({...i,opId:crypto.randomUUID(),version:saved.version,status:'cancelled'});
 c.extOverlayPurchases_(fake,'2026-11',matrix());assert.equal(fake.matrix[1][0],0);
});
test('mixed expenses are separated; container return reduces total',()=>{
 const c=harness(),i=invoiceInput(c,{supplier:'西原',printedTotal:300,lines:[
 {name:'食材',qty:1,unit:'本',price:200,amount:200,rate:8,category:'食材'},
 {name:'袋',qty:1,unit:'P',price:100,amount:100,rate:10,category:'雑費'}]});
 const inv=c.saveExtensionInvoice(i).invoice,b=c.extInvoiceBuckets_(inv);assert.equal(b.食材,200);assert.equal(b.雑費,100);
 c.saveExtensionInvoice(invoiceInput(c,{supplier:'カクヤス',type:'return',printedTotal:5,lines:[{name:'容器',qty:1,unit:'本',price:5,amount:5,rate:0,category:'容器'}]}));
 assert.equal(c.extRunQuery_('monthlyTotals',{supplier:'カクヤス'},c.extState_(),'2026-11-19').rows[2].total,-5);
});
test('monthly tax pending is not zero; stale tax is not silently reused',()=>{
 const c=harness(),i=invoiceInput(c,{taxMode:'monthly'});c.saveExtensionInvoice(i);
 let r=c.extRunQuery_('monthlyTotals',{supplier:'キタニ水産'},c.extState_(),'2026-11-19');assert.equal(r.rows[2].state,'tax_pending');
 c.saveExtensionMonthlyTax({opId:crypto.randomUUID(),month:'2026-11',supplier:'キタニ水産',version:0,foodTax:16,drinkTax:0,miscTax:0});
 r=c.extRunQuery_('monthlyTotals',{supplier:'キタニ水産'},c.extState_(),'2026-11-19');assert.equal(r.rows[2].total,216);
 const old=c.extState_().invoice[i.id];c.saveExtensionInvoice({...i,opId:crypto.randomUUID(),version:old.version});
 assert.equal(c.extRunQuery_('monthlyTotals',{supplier:'キタニ水産'},c.extState_(),'2026-11-19').rows[2].state,'tax_pending');
});
test('inventory excludes two consecutive confirmed zero months and returns on repurchase',()=>{
 const c=harness();c.saveExtensionInvoice(invoiceInput(c,{date:'2026-09-20'}));
 function confirmMonth(month,qty){
  let s=c.getExtensionStock({month});const input={opId:crypto.randomUUID(),month,version:s.version,sourceFingerprint:s.sourceFingerprint,implementer:'高杉',reviewer:'荒川',rows:s.rows.map(r=>({...r,qty})),action:'review'};
  s=c.saveExtensionStock(input);const confirm={...input,opId:crypto.randomUUID(),version:s.version,action:'confirm'};s=c.saveExtensionStock(confirm);
  c.saveExtensionStock(confirm);return s;
 }
 const sep=confirmMonth('2026-09',0);assert.equal(sep.rows[0].zeroStreak,1);
 const oct=confirmMonth('2026-10',0);assert.equal(oct.rows[0].zeroStreak,2);
 assert.equal(c.getExtensionStock({month:'2026-11'}).rows.length,0);
 c.saveExtensionInvoice(invoiceInput(c,{date:'2026-11-04'}));
 assert.equal(c.getExtensionStock({month:'2026-11'}).rows.length,1);
 assert.equal(c.extState_().stock['2026-09'].date,'2026-09-30');
});
test('blank quantity, same reviewer, missing conversion cannot finalize; latest gross price wins',()=>{
 const c=harness();c.saveExtensionInvoice(invoiceInput(c,{taxMode:'net',tax:16}));
 let s=c.getExtensionStock({month:'2026-11'});assert.equal(s.rows[0].price,108);
 const base={opId:crypto.randomUUID(),month:s.month,version:0,sourceFingerprint:s.sourceFingerprint,action:'review',implementer:'高杉',reviewer:'荒川',rows:s.rows};
 assert.throws(()=>c.saveExtensionStock(base),/全品目/);
 assert.throws(()=>c.saveExtensionStock({...base,reviewer:'高杉',rows:s.rows.map(r=>({...r,qty:0}))}),/異なる2名/);
 const p=s.rows[0];c.saveExtensionProduct({opId:crypto.randomUUID(),supplier:p.supplier,name:p.name,sku:'001',unit:'g',aliases:[],conversions:{}});
 s=c.getExtensionStock({month:s.month});assert.equal(s.rows[0].problem,'単位換算未登録');
 c.saveExtensionProduct({opId:crypto.randomUUID(),version:1,supplier:p.supplier,name:p.name,sku:'001',unit:'g',aliases:[],conversions:{kg:1000}});
 s=c.getExtensionStock({month:s.month});assert.equal(s.rows[0].price,0.108);
});
test('confirmed snapshot becomes stale after source edit',()=>{
 const c=harness(),i=invoiceInput(c);const saved=c.saveExtensionInvoice(i).invoice;let s=c.getExtensionStock({month:'2026-11'});
 const input={opId:crypto.randomUUID(),month:s.month,version:0,sourceFingerprint:s.sourceFingerprint,action:'review',implementer:'高杉',reviewer:'荒川',rows:s.rows.map(r=>({...r,qty:1}))};
 s=c.saveExtensionStock(input);s=c.saveExtensionStock({...input,opId:crypto.randomUUID(),version:s.version,action:'confirm'});
 c.saveExtensionInvoice({...i,version:saved.version,opId:crypto.randomUUID()});
 s=c.getExtensionStock({month:s.month});assert.equal(s.fresh,false);assert.equal(s.rows[0].amount,100);
});
test('AI unavailable leaves deterministic query and manual save working; compound tools both execute',()=>{
 const c=harness(),i=invoiceInput(c);c.saveExtensionInvoice(i);
 const unavailable=c.askExtensionAssistant({question:'ぶりは？',asOf:'2026-11-19'});assert.equal(unavailable.available,false);
 c.saveExtensionInvoice(invoiceInput(c));assert.equal(Object.keys(c.extState_().invoice).length,2);
 c.extCF_=()=>({tool_calls:[{name:'monthlyTotals',arguments:{supplier:'キタニ水産'}},{name:'itemComparison',arguments:{supplier:'キタニ水産'}}]});
 const result=c.askExtensionAssistant({question:'推移と増えた品目',asOf:'2026-11-19'});assert.equal(result.results.length,2);
 assert.equal(result.results[0].tool,'monthlyTotals');assert.equal(result.results[1].tool,'itemComparison');
 assert.throws(()=>c.extRunQuery_('deleteAll',{},c.extState_(),'2026-11-19'),/許可/);
 c.testProps.CF_ACCOUNT_ID='a'.repeat(32);c.testProps.CF_API_TOKEN='fake';c.extCF_=undefined;
});
test('test build blocks LINE even with token; foreign month files are blocked',()=>{
 const c=harness();c.testProps.LINE_CHANNEL_ACCESS_TOKEN='test';c.testProps.LINE_GROUP_ID='C'+'a'.repeat(32);
 assert.equal(c.notifyLine_({line:{status:'pending'}}).status,'skipped');assert.equal(c.fetchCount(),0);
 c.testProps.FOLDER_ID='foreign';assert.throws(()=>c.extEnvironment_(),/テスト/);
});
test('journal labels distinguish item count and people; uncertain invoice columns stay empty',()=>{
 const c=harness(),j=c.extParseJournal_('対象期間 2026/11/03 21:57\n2026/11/05 22:09\n総売上 3,900円\n9個\n純売上 3,546円\n1人\n消費税総額 354円\n現金 1件 3,900円\n会計回数 1件');
 assert.equal(j.date,'2026-11-05');assert.equal(j.total,3900);assert.equal(j.guests,1);assert.equal(j.groups,1);
 assert.equal(j.payments[0].amount,3900);
 const draft=c.extParseInvoice_('納品日 2026年10月27日\n品名 数量 単価\n合計 1,765円','西原');assert.equal(draft.lines.length,0);
});

test('browser invoice OCR uses the stored image and rejects ambiguous numeric values',()=>{
 const c=harness();
 const input={fileId:'browser-image',supplier:'西原',text:'納品日 2026/11/22\n伝票番号 0071\n合計 1,800円',
  rowText:'商品名 数量 単価 金額\n豚 肩ロース｜１.５kg｜￥１,２００｜１,８００円\n豆腐 2 個 1O0 200\n合計 1,800円'};
 assert.throws(()=>c.parseExtensionBrowserInvoice(input),/先に写真/);
 c.extWrite_('file','browser-image',0,{opId:'browser-image-op'},{id:'browser-image',mime:'image/png',name:'fixture.png'});
 const result=c.parseExtensionBrowserInvoice(input);
 assert.equal(result.source.id,'browser-image');
 assert.equal(result.draft.date,'2026-11-22');
 assert.equal(result.draft.invoiceNumber,'0071');
 assert.equal(result.draft.printedTotal,1800);
 assert.equal(result.draft.lines.length,1);
 const [line]=result.draft.lines;
 assert.deepEqual([line.name,line.qty,line.unit,line.price,line.amount],['豚 肩ロース',1.5,'kg',1200,1800]);
});

test('supplier rules keep a blank page total and distinguish separate container returns',()=>{
 const c=harness(),heading='MARUYASU 2026年10月6日 0000123456';
 const first=c.extParseInvoice_(heading+' (1/2)','', '茄子|1.0|パック|330|330|5本いり\n合 計 ▶');
 const last=c.extParseInvoice_(heading+' (2/2)','', '合 計 ▶ 5,018');
 assert.equal(first.pageNumber,1);assert.equal(first.pageCount,2);assert.equal(first.printedTotal,null);
 assert.equal(first.lines[0].amount,330);assert.equal(last.printedTotal,5018);
 const receipt=c.extParseInvoice_('容 器 回 収 票\nカクヤス\n2026/10/19\nNo. 12345678','','合 計 20');
 assert.equal(receipt.type,'return');assert.equal(receipt.printedTotal,20);assert.equal(receipt.invoiceNumber,'12345678');
 const saved=c.saveExtensionInvoice(invoiceInput(c,receipt)).invoice;
 assert.equal(c.extInvoiceBuckets_(saved).飲料,-20);
});

test('Kakuyasu invoice number can follow the header on the next line',()=>{
 const c=harness();
 const text='株式会社 カクヤス\n日 付 |倉庫 伝票 No. @\n取引先名 様 26/10/31 790 83701234 26/10/31\n外10%| 20\n不明 | 858';
 const draft=c.extParseInvoice_(text,'',text);
 assert.equal(draft.invoiceNumber,'83701234');
 assert.equal(draft.printedTotal,null);
 assert.equal(draft.lines.length,0);
 assert.equal(c.extParseInvoice_(text.replace('伝票 No.','区分'),'').invoiceNumber,'');
});

test('Kakuyasu crop separates item counts from case size and reads only labeled totals',()=>{
 const c=harness();
 const text='カクヤス\n日 付 伝票 No.\n26/10/31 790 83701234 26/10/31';
 const items='33-33-33-33 テストビール 中瓶 500ML | 外10% | 20 | 3 | 286 | 858';
 const draft=c.extParseInvoice_(text,'',text,{items,totals:'売上合計 858\n| 合 計 | 858 |'});
 assert.equal(draft.printedTotal,858);
 assert.equal(draft.lines.length,1);
 const [line]=draft.lines;
 assert.deepEqual([line.name,line.qty,line.unit,line.price,line.amount],['テストビール 中瓶',null,'',286,858]);
 const incomplete=c.extParseInvoice_(text,'',text,{items:items.replace('286 | ',''),totals:'858'});
 assert.equal(incomplete.printedTotal,null);
 assert.equal(incomplete.lines.length,0);
 const cases=c.extParseInvoice_(text,'',text,{items:'テストビール 缶 外10% 20 2 3 10 430',totals:''});
 assert.equal(cases.lines[0].qty,3);
 assert.equal(cases.lines[0].unit,'');
});

test('Kakuyasu reread accepts an observed quantity only when it matches the row amount',()=>{
 const c=harness();
 c.extWrite_('file','crop-test',0,{opId:'crop-test-op'},{id:'crop-test',mime:'image/png',name:'test.png'});
 const read=qty=>c.parseExtensionBrowserInvoice({fileId:'crop-test',supplier:'カクヤス',text:'カクヤス',rowText:'カクヤス',
  crops:{items:'中瓶',totals:'',cells:[{name:'テストビール 中瓶',qty,price:'286',amount:'858'}]}});
 assert.equal(read('3').draft.lines[0].qty,3);
 assert.equal(read('20').draft.lines[0].qty,null);
 assert.equal(read('').draft.lines[0].qty,null);
 assert.equal(read('').draft.requiresQuantityReview,true);
 assert.equal(read('3').draft.printedTotal,null);
});

test('wrapped Kakuyasu OCR keeps partial items without inferring quantities or totals',()=>{
 const c=harness(),text='カクヤス';
 const items='33-33-33-33 テス トビ 500ML\nー ル hik\n98 外 10% 286 858\n摘要';
 const parse=items=>c.extParseInvoice_(text,'',text,{items,totals:'容器 数量 金額 | 858'});
 const draft=parse(items);
 assert.equal(draft.lines.length,1);
 assert.deepEqual([draft.lines[0].qty,draft.lines[0].price,draft.lines[0].amount],[null,286,858]);
 assert.equal(draft.printedTotal,null);
 assert.equal(draft.requiresQuantityReview,true);
 assert.equal(parse(items.replace('ー ル hik','摘要')).lines.length,0);
});

test('Kakuyasu deliveries save loose quantity without a unit',()=>{
 const c=harness();
 const input=invoiceInput(c,{supplier:'カクヤス',printedTotal:858});
 Object.assign(input.lines[0],{name:'テストビール',qty:3,price:286,amount:858,unit:'',category:'飲料'});
 const saved=c.saveExtensionInvoice(input).invoice;
 assert.equal(saved.lines[0].unit,'');
 assert.equal(saved.lines[0].qty,3);
 assert.throws(()=>c.saveExtensionInvoice(invoiceInput(c,{lines:input.lines,printedTotal:858})),/単位/);
});

test('OCR temporary documents are trashed on both success and text-read failure',()=>{
 const c=harness();c.extWrite_('file','file-test',0,{opId:'file-op'},{id:'file-test',driveId:'drive-file',url:'https://drive.google.com/file/d/drive-file/view'});
 let trashed=0;c.Drive={Files:{create:()=>({id:'temporary'}),update:(metadata,id)=>{assert.equal(metadata.trashed,true);assert.equal(id,'temporary');trashed++;}}};
 c.DocumentApp={openById:()=>({getBody:()=>({getText:()=> '総売上 0円'})})};
 assert.equal(c.readExtensionOcr({fileId:'file-test',kind:'journal'}).draft.total,0);assert.equal(trashed,1);
 c.DocumentApp.openById=()=>{throw Error('OCR read failed');};
 assert.throws(()=>c.readExtensionOcr({fileId:'file-test',kind:'journal'}),/OCR read failed/);assert.equal(trashed,2);
});
test('explicit periods are applied and historical simple entries are included once',()=>{
 const c=harness();c.testProps['MONTH_2026-10']='copy';
 c.month_=()=>({getId:()=> 'copy'});c.records_=()=>[{id:'old',date:'2026-10-02',items:[{kind:'食材',name:'キタニ水産',amount:500}]}];
 const result=c.queryExtensionData({name:'monthlyTotals',args:{supplier:'キタニ水産',start:'2026-10-01',end:'2026-10-31'},asOf:'2026-11-19'});
 assert.equal(result.rows.length,1);assert.equal(result.rows[0].total,500);
});

test('batch saves isolate failure and reuse stable operation IDs across months',()=>{
 const c=harness(),oct=invoiceInput(c,{date:'2026-10-31'}),nov=invoiceInput(c,{date:'2026-11-02',supplier:''});
 let result=c.saveExtensionReceiptBatch({records:[oct,nov]});
 assert.equal(result.results[0].status,'saved');assert.equal(result.results[1].status,'failed');
 result=c.saveExtensionReceiptBatch({records:[oct,{...nov,supplier:'西原'}]});
 assert.equal(result.results[0].status,'saved');assert.equal(result.results[1].status,'saved');
 const values=Object.values(c.extState_().invoice);assert.equal(values.length,2);
 assert.equal(values.find(i=>i.id===oct.id).date,'2026-10-31');assert.equal(values.find(i=>i.id===nov.id).date,'2026-11-02');
});
test('OCR text cache skips Drive conversion and reinterprets results per kind',()=>{
 const c=harness(),cache=new Map();
 c.extWrite_('file','cached-file',0,{opId:'cache-file-op'},{id:'cached-file',hash:'content-hash',driveId:'drive-file',url:'https://drive.google.com/file/d/x/view'});
 const folder={getId:()=> 'root',getFilesByName:name=>({hasNext:()=>cache.has(name),next:()=>({getBlob:()=>({getDataAsString:()=>cache.get(name)})})}),createFile:(name,text)=>cache.set(name,text)};
 c.DriveApp.getFileById=()=>({getBlob:()=>({}),getParents:()=>{let used=false;return {hasNext:()=>!used,next:()=>{used=true;return folder;}};}});
 let conversions=0,trashed=0;
 c.Drive={Files:{create:()=>{conversions++;return {id:'temp'};},update:()=>trashed++}};
 c.DocumentApp={openById:()=>({getBody:()=>({getText:()=> '総売上 0円'})})};
 assert.equal(c.readExtensionOcr({fileId:'cached-file',kind:'journal'}).timings.cached,false);
 assert.equal(c.readExtensionOcr({fileId:'cached-file',kind:'invoice',supplier:'西原'}).timings.cached,true);
 assert.equal(conversions,1);assert.equal(trashed,1);
 c.readExtensionOcr({fileId:'cached-file',kind:'journal',force:true});assert.equal(conversions,2);assert.equal(trashed,2);
});
console.log(passed+' tests passed');


