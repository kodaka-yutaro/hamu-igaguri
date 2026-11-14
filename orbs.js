// Acorn orb economy. The playtest stores this ledger only on this browser.
(function(root){
 const LIMIT=10;
 const day=now=>new Date(now+9*60*60*1000).toISOString().slice(0,10);
 function normalize(value){
  const days={};for(const [date,ids]of Object.entries(value?.days||{}))if(/^\d{4}-\d{2}-\d{2}$/.test(date)&&Array.isArray(ids))days[date]=[...new Set(ids.filter(id=>typeof id==='string'&&id))].slice(0,LIMIT);
  return {officialClaims:structuredClone(value?.officialClaims||{}),playDays:structuredClone(value?.playDays||{}),plazaClaims:structuredClone(value?.plazaClaims||{}),eventClaims:structuredClone(value?.eventClaims||{}),visitors:structuredClone(value?.visitors||[]),earned:Math.max(Number(value?.earned)||0,Number(value?.balance)||0),claims:structuredClone(value?.claims||{}),balance:Number.isSafeInteger(value?.balance)&&value.balance>=0?value.balance:0,days};
 }
 const rewardKinds=['house-visit','plaza-play'];
 function summary(value,now=Date.now()){const state=normalize(value),date=day(now);return {earned:state.earned,stage:state.earned>=10?4:state.earned>=3?3:state.earned>=1?2:1,pending:state.visitors.filter(v=>!v.claimed&&rewardKinds.includes(v.kind)),pendingAmount:state.visitors.filter(v=>!v.claimed&&rewardKinds.includes(v.kind)&&v.reward===1).length,balance:state.balance,today:state.visitors.filter(v=>v.date===date&&v.reward===1&&rewardKinds.includes(v.kind)).length,limit:LIMIT,date};}
 function accrue(value,owner,visitor,kind,now){const state=normalize(value),date=day(now);if(!owner||!visitor||owner===visitor)return {state,recorded:false,awarded:false,reason:'self'};if(state.visitors.some(v=>v.kind===kind&&v.uid===visitor&&v.date===date))return {state,recorded:false,awarded:false,reason:'repeat'};const reward=summary(state,now).today<LIMIT?1:0;state.visitors.push({kind,uid:visitor,date,at:now,claimed:false,reward});return {state,recorded:true,awarded:false,reason:reward?kind:'limit'};}
 function play(value,owner,visitor,now=Date.now()){return accrue(value,owner,visitor,'plaza-play',now);}
 function visit(value,owner,visitor,now=Date.now()){return accrue(value,owner,visitor,'house-visit',now);}

 // Freeze a daily draw; prefer courses absent from the previous ten calendar days.
 const hash=text=>{let h=2166136261;for(const c of text)h=Math.imul(h^c.charCodeAt(0),16777619);return h>>>0;};
 function select(courses,history={},now=Date.now()){
  const date=day(now),unique=[...new Map(courses.map(c=>[c.id,c])).values()].filter(c=>c.id).sort((a,b)=>a.id.localeCompare(b.id));
  if(history[date])return structuredClone(history[date]);
  const last={};for(const [d,draw]of Object.entries(history))if(d<date)for(const id of draw.ids||[])last[id]=!last[id]||d>last[id]?d:last[id];
  const cutoff=day(now-10*86400000),recent=c=>last[c.id]&&last[c.id]>=cutoff;
  function rank(pool,salt){return [...pool].sort((a,b)=>Number(!!recent(a))-Number(!!recent(b))||(recent(a)&&recent(b)?last[a.id].localeCompare(last[b.id]):0)||hash(date+salt+a.id)-hash(date+salt+b.id)||a.id.localeCompare(b.id));}
  const qualified=unique.filter(c=>Number.isFinite(c.rate)&&c.rate>=10),first=rank(qualified.length?qualified:unique,'easy')[0],second=rank(unique.filter(c=>c.id!==first?.id),'open')[0];
  return {ids:[first?.id,second?.id].filter(Boolean),date,easyId:qualified.length?first.id:null,fallback:!qualified.length,repeated:[first,second].filter(Boolean).some(recent)};
 }
 function clear(value,cid,draw,now=Date.now()){
  const state=normalize(value),date=day(now);if(draw?.date!==date||!draw.ids.includes(cid))return {state,awarded:false};
  const claimed=state.claims[date]||[];if(claimed.includes(cid)||state.balance>Number.MAX_SAFE_INTEGER-3)return {state,awarded:false};
  state.claims[date]=[...claimed,cid];state.balance+=3;state.earned+=3;return {state,awarded:true,amount:3};
 }
 function collect(value){const state=normalize(value);let amount=0;for(const v of state.visitors)if(!v.claimed){amount+=v.reward===1&&rewardKinds.includes(v.kind)?1:0;v.claimed=true;}state.balance+=amount;state.earned+=amount;return {state,amount,awarded:amount>0};}
 function bambooClear(value,mode,floor){const state=normalize(value);if(!['challenge','marathon'].includes(mode)||!Number.isInteger(floor)||floor<1||floor>10)return {state,awarded:false};const key='bamboo-green-family-v1:'+mode+':'+floor;if(state.eventClaims[key]||state.balance>Number.MAX_SAFE_INTEGER-3)return {state,awarded:false};state.eventClaims[key]=true;state.balance+=3;state.earned+=3;return {state,awarded:true,amount:3};}
 function officialClear(value,id,amount){const state=normalize(value);if(!id||!Number.isSafeInteger(amount)||amount<=0||state.officialClaims[id]||state.balance>Number.MAX_SAFE_INTEGER-amount||state.earned>Number.MAX_SAFE_INTEGER-amount)return {state,awarded:false,amount:0};state.officialClaims[id]=true;state.balance+=amount;state.earned+=amount;return {state,awarded:true,amount};}
 function plazaClear(value,owner,draw,now=Date.now()){
  const state=normalize(value),date=day(now);
  if(!owner||draw?.date!==date||draw.plazaOwner!==owner||state.plazaClaims[date]||state.balance>Number.MAX_SAFE_INTEGER-3||state.earned>Number.MAX_SAFE_INTEGER-3)return {state,awarded:false,amount:0};
  state.plazaClaims[date]=owner;state.balance+=3;state.earned+=3;return {state,awarded:true,amount:3};
 }
 function customizedPlaza(profile){
  const c=profile?.plaza?.course;
  if(!Array.isArray(c?.rows)||c.rows.length!==16||!c.rows.every(r=>typeof r==='string'&&r.length===c.rows[0].length)||!c.rows[0].length)return false;
  const rows=Array.from({length:16},(_,y)=>y===15?'#'.repeat(40):'.'.repeat(40));rows[14]='.S'+'.'.repeat(35)+'G..';
  if(c.rows.some((r,i)=>r!==rows[i])||(c.decorations||[]).length)return true;
  const items=c.items||[];
  return items.length!==1||items[0].kind!=='soccer'||items[0].x!==7||items[0].y!==14;
 }
 function hostClear(value){return {state:normalize(value),recorded:false,amount:0};}
 function plazaReward(value){return {state:normalize(value),awarded:false,amount:0};}
 function selectPlaza(people,history={},now=Date.now()){
 const date=day(now);if(customizedPlaza(people?.[history[date]?.plazaOwner]))return history[date].plazaOwner;
 const last={};for(const [d,draw]of Object.entries(history))if(d<date&&draw.plazaOwner)last[draw.plazaOwner]=!last[draw.plazaOwner]||d>last[draw.plazaOwner]?d:last[draw.plazaOwner];
 const cutoff=day(now-10*86400000),ids=Object.entries(people||{}).filter(([,p])=>customizedPlaza(p)&&Number(p.lastActiveAt||p.createdAt)>=now-7*86400000).map(([id])=>id);
 ids.sort((a,b)=>Number(!!(last[a]&&last[a]>=cutoff))-Number(!!(last[b]&&last[b]>=cutoff))||((last[a]&&last[a]>=cutoff&&last[b]&&last[b]>=cutoff)?last[a].localeCompare(last[b]):0)||hash(date+'plaza'+a)-hash(date+'plaza'+b)||a.localeCompare(b));return ids[0]||null;
 }
 const api={LIMIT,day,summary,play,visit,select,clear,collect,bambooClear,officialClear,plazaClear,hostClear,plazaReward,selectPlaza,customizedPlaza};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.HamuOrbs=api;
})(typeof window!=='undefined'?window:globalThis);
