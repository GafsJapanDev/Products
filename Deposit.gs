// Code.gsと同じプロジェクトに追加してください。
function dayAfter_(s,n){const d=date_(s);d.setUTCDate(d.getUTCDate()+n);return Utilities.formatDate(d,'Asia/Tokyo','yyyy-MM-dd');}
function depositHistory_(date){
 const p=PropertiesService.getScriptProperties().getProperties(),sales=[],deposits=[];
 Object.keys(p).filter(k=>/^MONTH_\d{4}-\d{2}$/.test(k)&&k.slice(6)<=date.slice(0,7)).sort().forEach(k=>{
  const b=SpreadsheetApp.openById(p[k]);sales.push(...records_(b,'売上'));deposits.push(...records_(b,'入金'));
 });return {sales,deposits};
}
function depositCalculation_(date,start,history){
 date_(date);const previous=history.deposits.filter(r=>r.date<date).sort((a,b)=>b.date.localeCompare(a.date))[0];
 start=previous?previous.date:start;
 if(!start)return {previousDate:'',start:'',end:dayAfter_(date,-1),expected:null,days:[],missing:[]};
 date_(start);if(start>=date)throw Error('計算開始日は入金日の前日以前を指定してください');
 const days=[];for(let d=start;d<date;d=dayAfter_(d,1)){if(days.length>=366)throw Error('計算期間は366日以内にしてください');days.push(d);}
 const cash={};history.sales.forEach(r=>{cash[r.date]=(r.payments||[]).filter(x=>x.name==='現金').reduce((sum,x)=>sum+Number(x.amount),0);});
 return {previousDate:previous?previous.date:'',start,end:dayAfter_(date,-1),expected:days.reduce((sum,d)=>sum+(cash[d]||0),0),days,missing:days.filter(d=>!Object.prototype.hasOwnProperty.call(cash,d))};
}
function getDepositContext(input){date_(input.date);return locked_(()=>depositCalculation_(input.date,input.start||'',depositHistory_(input.date)));}
function depositMessage_(r){return '◆入金報告◆\n入金日：'+r.date.replace(/-/g,'/')+'\n対象営業日：'+r.targetDates.map(d=>d.replace(/-/g,'/')).join('、')+'\n報告者：'+r.reporter+'\n入金予定額：'+r.expected.toLocaleString('ja-JP')+'円\n実入金額：'+r.amount.toLocaleString('ja-JP')+'円\n差異：'+(r.difference>0?'+':'')+r.difference.toLocaleString('ja-JP')+'円\n備考：'+r.note;}
function saveDeposit_(input){return locked_(()=>{
 const date=String(input.date);date_(date);if(input.amount==='')throw Error('実入金額を入力してください');
 const reporter=text_(input.reporter).trim();if(!reporter)throw Error('報告者を入力してください');
 const calc=depositCalculation_(date,input.start||'',depositHistory_(date));
 if(calc.expected===null)throw Error('初回の計算開始日を指定してください');
 if(Number(input.expected)!==calc.expected||input.start!==calc.start)throw Error('予定額・計算期間が変わりました。「予定額を再計算」を押して確認してください');
 if(!Array.isArray(input.targetDates)||!input.targetDates.length)throw Error('対象営業日を選択してください');
 const targets=[...new Set(input.targetDates)].sort();if(targets.some(d=>!calc.days.includes(d)))throw Error('対象営業日は計算期間内を選択してください');
 const amount=amount_(input.amount),r={id:date,date,reporter,amount,note:text_(input.note),start:calc.start,end:calc.end,expected:calc.expected,difference:amount-calc.expected,targetDates:targets};
 if(r.difference!==0&&!r.note.trim())throw Error('入金差異があるため、備考に理由を入力してください');
 const b=month_(date.slice(0,7),true),s=b.getSheetByName('_入金記録'),rows=records_(b,'入金'),index=rows.findIndex(x=>x.date===date),message=depositMessage_(r),old=index>=0?rows[index]:null;
 r.line=old&&old.line&&old.line.message===message?old.line:{message,retryKey:Utilities.getUuid(),status:'pending'};
 const row=index>=0?index+2:s.getLastRow()+1;s.getRange(row,1,1,3).setValues([[date,date,JSON.stringify(r)]]);rebuild_(b,date.slice(0,7));
 const notification=notifySavedRecord_(r,input.sendLine,'入金');
 s.getRange(row,3).setValue(JSON.stringify(r));depositReportSheet_(b,records_(b,'入金'));
 return {id:date,notification};
});}
function depositReportSheet_(b,rows){
 const s=b.getSheetByName('入金報告')||b.insertSheet('入金報告');
 s.getRange(1,1,1,10).setValues([['入金日','計算開始日','計算終了日','対象営業日','報告者','入金予定額','実入金額','差異','備考','LINE通知状態']]);
 if(s.getLastRow()>1)s.getRange(2,1,s.getLastRow()-1,10).clearContent();
 const data=rows.slice().sort((a,b)=>a.date.localeCompare(b.date)).map(r=>[r.date,r.start||'',r.end||'',(r.targetDates||[]).join('、'),safe_(r.reporter||''),r.expected??'',r.amount,r.difference??'',safe_(r.note||''),({accepted:'LINE受付済み',failed:'通知失敗',unconfigured:'未設定',pending:'未送信'})[r.line&&r.line.status]||'未送信']);
 if(data.length){s.getRange(2,1,data.length,10).setValues(data);s.getRange(2,6,data.length,3).setNumberFormat('#,##0');s.getRange(2,4,data.length,1).setWrap(true);}
 s.setFrozenRows(1);s.setColumnWidth(4,320);s.setColumnWidth(9,300);
}
