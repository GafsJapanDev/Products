
'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const script=fs.readFileSync('ExtensionClient.html','utf8').match(/<script>([\s\S]*)<\/script>/)[1];
class Element{
 constructor(tag='div'){this.tag=tag;this.children=[];this.dataset={};this.value='';this.hidden=false;this.attributes={};this.classList={toggle(){}};this.style={};this.parentElement=null;}
 append(...elements){elements.forEach(e=>{if(typeof e==='string')return;if(e.parentElement)e.parentElement.children=e.parentElement.children.filter(x=>x!==e);e.parentElement=this;this.children.push(e);});}
 replaceChildren(...elements){this.children.forEach(e=>e.parentElement=null);this.children=[];this.append(...elements);}
 setAttribute(k,v){this.attributes[k]=v;}removeAttribute(k){delete this.attributes[k];}addEventListener(){}scrollIntoView(){}showModal(){this.open=true;}close(){this.open=false;}remove(){if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(e=>e!==this);}
 querySelectorAll(selector){const all=this.children.flatMap(e=>[e,...e.querySelectorAll('*')]);if(selector==='*')return all;
 if(selector==='[data-key]')return all.filter(e=>e.dataset.key);return all.filter(e=>e.tag===selector);}
}
const elements={},el=id=>elements[id]||(elements[id]=new Element()),nav=new Element('nav'),actions=new Element();
const sections=['売上','仕入','小口','入金','棚卸','AI'].map(id=>el(id));
const calls=[];
const context={suppliers:['キタニ水産'],products:[],invoices:[],legacy:[],taxes:[]};
const sandbox={window:{addEventListener(){}},console,crypto,structuredClone,$:el,document:{getElementById:el,createElement:t=>new Element(t),
 querySelector:s=>s==='nav'?nav:actions,
 querySelectorAll:s=>s==='section'?sections:s==='nav button'?nav.children:[]},
 render(){sections.forEach(e=>e.hidden=e!==el(sandbox.tab));},capture(){},current(){return {date:sandbox.activeDate};},
 save(){calls.push('legacySave');},setBusy:v=>{sandbox.busy=v;},showStatus:(...v)=>calls.push(v),confirm:()=>true,
 rpc:async(name,arg)=>{calls.push({name,arg});return name==='extensionContext'?structuredClone(context):{};},
 row(){},totals(){},PAY:['現金','クレジット'],tab:'売上',activeDate:'2026-11-20',day:{},busy:false};
vm.createContext(sandbox);vm.runInContext(script,sandbox);
const run=s=>vm.runInContext(s,sandbox);
async function main(){
 assert.equal(el('extInvoicePanel').parentElement,el('extPurchaseInvoiceHost'));
 assert.deepEqual(nav.children.map(e=>e.dataset.tab),['棚卸','AI']);
 sandbox.render();await Promise.resolve();
 assert.equal(el('extOcrPanel').parentElement,el('extJournalOcrHost'));
 assert.equal(el('extOcrKind').value,'journal');assert.equal(el('extOcrSupplierLabel').hidden,true);
 sandbox.tab='仕入';sandbox.render();await Promise.resolve();
 assert.equal(el('extOcrPanel').parentElement,el('extPurchaseOcrHost'));assert.equal(el('extOcrKind').value,'invoice');
 run("extEditInvoice(null);extPurchaseMode='invoice';extSyncPurchaseMode();");
 assert.equal(el('extSimplePurchase').hidden,true);assert.equal(el('extInvoicePanel').hidden,false);assert.equal(actions.hidden,false);
 assert.equal(el('save').textContent,'仕入れを保存');
 el('extSupplier').value='キタニ水産';el('extTotal').value='5079';
 sandbox.capture();sandbox.tab='売上';sandbox.render();sandbox.tab='仕入';sandbox.render();await Promise.resolve();
 assert.equal(el('extTotal').value,'5079');

 // Different dates remain independent; the modal renders editable table rows.
 run("extReceiptQueue.push({id:'receipt_oct',kind:'invoice',status:'ready',uploads:[{file:{name:'oct.jpg'}}],sources:[{id:'raw_oct',url:'https://drive.google.com/file/d/oct/view'}],texts:['原文'],draft:{kind:'invoice',date:'2026-10-31',supplier:'キタニ水産',printedTotal:100,type:'delivery',taxMode:'gross',tax:null,lines:[],warnings:[]}});");
 run("extOpenReceiptReview('receipt_oct')");
 assert.equal(el('extReceiptDialog').open,true);assert.equal(el('extReviewDate').value,'2026-10-31');
 assert.equal(el('extReviewHead').children[0].children[0].textContent,'品名');
 await el('extReviewConfirm').onclick();
 assert.equal(run("extReceiptQueue[0].status"),'confirmed');
 run("extReceiptQueue.push({id:'receipt_nov',kind:'invoice',status:'confirmed',uploads:[{file:{name:'nov.jpg'}}],sources:[{id:'raw_nov'}],texts:[],draft:{kind:'invoice',date:'2026-11-02',supplier:'西原',printedTotal:200,type:'delivery',taxMode:'gross',tax:null,adjustment:0,reason:'',lines:[],warnings:[]}})");
 const requests=[];let attempts=0;
 sandbox.rpc=async(name,arg)=>{
  if(name==='saveExtensionReceiptBatch'){
   requests.push(structuredClone(arg));attempts++;
   return {results:arg.records.map((r,i)=>attempts===1&&i===1?{id:r.id,status:'failed',error:'一時エラー'}:{id:r.id,status:'saved',invoice:{...r,version:1}})};
  }
  return name==='extensionContext'?structuredClone(context):{};
 };
 await el('extSaveBatch').onclick();
 assert.equal(requests[0].records[0].date,'2026-10-31');assert.equal(requests[0].records[1].date,'2026-11-02');
 assert.equal(run('extReceiptQueue[0].status'),'saved');assert.equal(run('extReceiptQueue[1].status'),'saveFailed');
 const retryToken=requests[0].records[1].opId;
 await el('extSaveBatch').onclick();assert.equal(requests[1].records.length,1);
 assert.equal(requests[1].records[0].opId,retryToken);assert.equal(run('extReceiptQueue[1].status'),'saved');
 // Grouping is explicit and never sums all printed totals.
 const page=(id,total,date='2026-10-31')=>({id,kind:'invoice',uploads:[],sources:[],texts:[],draft:{date,supplier:'maruyasu',printedTotal:total,tax:null,invoiceNumber:'001',lines:[],warnings:[]}});
 const grouped=sandbox.extMergeReceiptModels([page('p1',null),page('p2',2640)],'grouped');
 assert.equal(grouped.draft.printedTotal,2640);
 const ambiguous=sandbox.extMergeReceiptModels([page('p1',100),page('p2',200,'2026-11-01')],'ambiguous');
 assert.equal(ambiguous.draft.printedTotal,null);assert.equal(ambiguous.draft.date,'');
 const firstPage=page('page-one',null),lastPage=page('page-two',5018);
 Object.assign(firstPage.draft,{pageNumber:1,pageCount:2});
 Object.assign(lastPage.draft,{pageNumber:2,pageCount:2});
 firstPage.draft.lines=[{name:'first'}];lastPage.draft.lines=[{name:'last'}];
 const complete=sandbox.extMergeReceiptModels([lastPage,firstPage],'complete');
 assert.equal(complete.draft.printedTotal,5018);
 assert.equal(complete.draft.lines.map(line=>line.name).join(','),'first,last');
 assert.throws(()=>sandbox.extMergeReceiptModels([firstPage,firstPage],'duplicate'),/重複なし/);
 lastPage.draft.type='return';
 assert.throws(()=>sandbox.extMergeReceiptModels([firstPage,lastPage],'mixed'),/容器回収票/);
 const word=(text,x,y,width=12)=>({text,bbox:{x0:x,y0:y,x1:x+width,y1:y+12}});
 const dateData={blocks:[{paragraphs:[{lines:[{words:[
  word('26/10/31',694,304,32),word('26/10/31',800,304,32)
 ]}]}]}]};
 const dateOffset=sandbox.extKakuyasuDateOffset(dateData,1000,1000);
 assert.ok(Math.abs(dateOffset.x-0.04)<0.001&&Math.abs(dateOffset.y-0.03)<0.001);
 assert.equal(sandbox.extKakuyasuDateOffset(dateData,1000,400),null);
 const fields=sandbox.extKakuyasuFields({blocks:[{paragraphs:[{lines:[{words:[
  word('商品',100,40),word('名',113,40),word('規格',200,40),
  word('バラ',350,40),word('数',363,40),word('単価',410,40),
  word('ビール',110,70,40),word('中瓶',152,70,24),word('286',413,70,18),word('858',476,70,18)
 ]}]}]}]});
 assert.equal(fields.length,1);
 assert.equal(fields[0].name,'ビール 中瓶');
 assert.equal(fields[0].amount,'858');
 assert.ok(fields[0].left<355&&fields[0].right>365);
 assert.throws(()=>sandbox.extValidateReviewDraft({
  date:'2026-10-31',supplier:'カクヤス',type:'delivery',taxMode:'monthly',printedTotal:858,adjustment:0,
  requiresQuantityReview:true,lines:[{name:'ビール',qty:null,amount:858,unit:'本',price:286}]
 },'invoice'),/数量が空欄/);
 // Pool starts at most two jobs and makes progress while another job is unfinished.
 let active=0,max=0,done=0;const releases=[];
 const pool=sandbox.extReceiptPool([1,2,3],()=>new Promise(resolve=>{active++;max=Math.max(max,active);releases.push(()=>{active--;done++;resolve();});}));
 assert.equal(active,2);releases[1]();for(let i=0;i<10;i++)await Promise.resolve();
 assert.equal(done,1);assert.equal(releases.length,3);assert.equal(active,2);
 releases[0]();releases[2]();await pool;assert.equal(max,2);assert.equal(done,3);
 // A failed browser OCR can retry through Drive using the original already in storage.
 const previousRpc=sandbox.rpc;
 const retryCalls=[];
 sandbox.extReadFile=async()=> 'fixture-bytes';
 sandbox.extReadBrowserInvoice=async()=>{throw Error('worker unavailable');};
 sandbox.rpc=async(name,arg)=>{
  retryCalls.push(name);
  if(name==='archiveExtensionDocument')return {id:arg.id,name:arg.name};
  if(name==='readExtensionOcr')return {source:{id:arg.fileId},text:'読取結果',draft:{warnings:[]}};
 };
 const retryEntry={id:'retry',kind:'invoice',engine:'browser',uploads:[{id:'fixture',file:{name:'fixture.png',type:'image/png'}}],sources:[]};
 await sandbox.extProcessReceipt(retryEntry);
 assert.equal(retryEntry.status,'failed');
 assert.equal(retryEntry.sources[0].id,'fixture');
 retryEntry.engine='drive';
 await sandbox.extProcessReceipt(retryEntry);
 assert.equal(retryEntry.status,'ready');
 assert.deepEqual(retryCalls.filter(name=>name!=='reportExtensionClientError'),['archiveExtensionDocument','readExtensionOcr']);

 sandbox.rpc=previousRpc;

 // Journal confirmation writes to the existing form and retains the source link.
 sandbox.tab='売上';sandbox.render();
 run("extReceiptQueue.push({id:'journal_one',kind:'journal',status:'ready',uploads:[],sources:[{id:'raw_journal'}],texts:[],draft:{date:'2026-11-20',total:3900,tax:354,groups:1,guests:1,payments:[{name:'現金',amount:3900}],warnings:[]}});extOpenReceiptReview('journal_one');");
 await el('extReviewConfirm').onclick();
 assert.equal(el('tax').value,354);assert.equal(el('guests').value,1);assert.equal(sandbox.current().journalFiles[0],'raw_journal');
 assert.equal(run("extReceiptQueue.find(r=>r.id==='journal_one').status"),'applied');

 // Automatic merging runs when the last page arrives, in either upload order.
 sandbox.tab='仕入';
 const previousProcess=sandbox.extProcessReceipt;
 sandbox.extProcessReceipt=async entry=>{entry.status='ready';};
 const queue=run('extReceiptQueue');
 const a=page('auto-one',null),b=page('auto-two',5018);
 for(const [index,entry] of [a,b].entries()){
  entry.status='ready';
  Object.assign(entry.draft,{type:'delivery',taxMode:'monthly',pageNumber:index+1,pageCount:2,invoiceNumber:'auto-001'});
 }
 a.draft.lines=[{name:'first'}];
 b.draft.lines=[{name:'last'}];
 queue.push(b);
 await sandbox.extReadReceiptEntries([b]);
 assert.equal(b.status,'ready');
 queue.push(a);
 await sandbox.extReadReceiptEntries([a]);
 const merged=queue[queue.length-1];
 assert.equal(merged.status,'ready');
 assert.equal(merged.draft.printedTotal,5018);
 assert.equal(merged.draft.lines.map(line=>line.name).join(','),'first,last');
 assert.equal(a.status,'merged');assert.equal(b.status,'merged');
 assert.equal(run('extReceiptReviewId'),merged.id);
 await el('extUnmergeReceipt').onclick();
 assert.equal(sandbox.extGroupNumberedReceipts([a,b]).length,0);
 sandbox.extProcessReceipt=previousProcess;
 console.log('Batch UI: table modal, cross-month dates, partial saves, retry IDs, manual grouping, bounded parallelism and journal reflection passed');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
