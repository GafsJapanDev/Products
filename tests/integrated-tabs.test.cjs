
'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const script=fs.readFileSync('ExtensionClient.html','utf8').match(/<script>([\s\S]*)<\/script>/)[1];
class Element{
 constructor(tag='div'){this.tag=tag;this.children=[];this.dataset={};this.value='';this.hidden=false;this.attributes={};this.classList={toggle(){}};this.style={};this.parentElement=null;}
 append(...elements){elements.forEach(e=>{if(typeof e==='string')return;if(e.parentElement)e.parentElement.children=e.parentElement.children.filter(x=>x!==e);e.parentElement=this;this.children.push(e);});}
 replaceChildren(...elements){this.children.forEach(e=>e.parentElement=null);this.children=[];this.append(...elements);}
 setAttribute(k,v){this.attributes[k]=v;}scrollIntoView(){}
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
 row(){},totals(){},PAY:[],tab:'売上',activeDate:'2026-11-20',day:{},busy:false};
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
 // Apply the actual OCR callback: keep the supplier object and remain in the purchase tab.
 el('extOcrConfirmed').checked=true;
 run("extOcrDraft={kind:'invoice',date:'2026-11-20',supplier:'キタニ水産',printedTotal:5079,lines:[]};extOcrFiles=[{id:'raw-one',url:'https://drive.google.com/file/d/raw/view',name:'original.pdf'}];");
 el('extApplyOcr').onclick();await Promise.resolve();
 assert.equal(sandbox.tab,'仕入');assert.equal(el('extSupplier').value,'キタニ水産');assert.equal(el('extTotal').value,5079);
 assert.equal(run('extInvoice.files[0].id'),'raw-one');assert.equal(el('extOcrPanel').hidden,true);
 let invoiceSaves=0;sandbox.extSaveInvoice=async()=>invoiceSaves++;
 await sandbox.save();assert.equal(invoiceSaves,1);assert.equal(calls.filter(x=>x==='legacySave').length,0);
 run("extPurchaseMode='simple';");await sandbox.save();assert.equal(calls.filter(x=>x==='legacySave').length,1);
 sandbox.tab='売上';sandbox.render();run("extOcrDraft={kind:'journal',date:'2026-11-20',tax:354,groups:1,guests:1,total:3900,payments:[]};extOcrFiles=[{id:'journal-one'}];");
 el('extOcrConfirmed').checked=true;el('extApplyOcr').onclick();
 assert.equal(sandbox.tab,'売上');assert.equal(el('tax').value,354);assert.equal(el('guests').value,1);
 assert.equal(sandbox.current().journalFiles[0],'journal-one');
 // Crossing dates must discard an old OCR candidate, never apply it to another day.
 run("extOcrDate='2026-11-20';");sandbox.activeDate='2026-11-21';sandbox.render();
 assert.equal(run('extOcrDraft'),null);
 console.log('Integrated tabs: mount, routing, draft preservation, OCR application and date isolation passed');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
