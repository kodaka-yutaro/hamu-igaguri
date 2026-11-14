// Online house economy. All writes stay within the signed-in player's document.
(function(root){
 function create({social,onChange,onError}){
  const O=root.HamuOrbs,S=root.HamuShop;let chain=Promise.resolve(),drawCache=null;
  function profile(uid,base=social.people.get(uid)){
   if(!base)return null;const p=structuredClone(base),events=[];
   for(const [visitor,v]of social.people)for(const e of Object.values(v.houseActivity||{}))if(e.owner===uid&&visitor!==uid&&['house-visit','plaza-play'].includes(e.kind)&&Number.isFinite(e.at))events.push({...e,uid:visitor});
   events.sort((a,b)=>a.at-b.at||a.uid.localeCompare(b.uid)||a.kind.localeCompare(b.kind));
   for(const e of events){const r=(e.kind==='house-visit'?O.visit:O.play)(p.orbs,uid,e.uid,e.at);p.orbs=r.state;}
   p.plazaPlays=(Number(p.plazaPlays)||0)+[...social.people.values()].reduce((n,v)=>n+(Number(v.plazaPlayCounts?.[uid])||0),0);
   return p;
  }
  function mutate(uid,fn){
   const run=async()=>{
    if(!uid||uid!==social.uid||!social.db||!social.peopleLoaded)throw Error('ログインと通信を確認してください');
    const ref=social.db.doc('people/'+uid);
    const result=await ref.mutate(base=>{const out=fn(profile(uid,base));return {data:out.profile||{...base,...out.patch},result:out.result};});
    social.people.set(uid,result.data);onChange();return result.result;
   };
   const task=chain.then(run).catch(e=>{onError(e);return {ok:false,awarded:false,amount:0,message:'保存できませんでした。もう一度お試しください'};});chain=task;return task;
  }
  function activity(uid,owner,kind){
   if(!owner||owner===uid||!social.people.has(owner))return Promise.resolve({recorded:false});
   const at=Date.now(),date=O.day(at),key=date+':'+kind+':'+owner;
   return mutate(uid,p=>({patch:{houseActivity:{...(p.houseActivity||{}),[key]:p.houseActivity?.[key]||{owner,kind,at}},...(kind==='plaza-play'?{plazaPlayCounts:{...(p.plazaPlayCounts||{}),[owner]:(Number(p.plazaPlayCounts?.[owner])||0)+1}}:{})},result:{recorded:true}}));
  }
  return {
   profile,
   dailyCourses(courses){const date=O.day(Date.now());if(drawCache?.date===date&&O.customizedPlaza(social.people.get(drawCache.plazaOwner)))return drawCache;const history={};for(const p of social.people.values())Object.assign(history,p.orbDraws||{});drawCache=structuredClone(history[date]||O.select(courses,history));drawCache.plazaOwner=O.selectPlaza(Object.fromEntries(social.people),history);return drawCache;},
   rewardClear(uid,cid){return mutate(uid,p=>{const c=social.courses.find(c=>c.id===cid),first=c?.official?O.officialClear(p.orbs,cid,c.orbReward):{state:p.orbs,amount:0},daily=O.clear(first.state,cid,drawCache),owner=cid.startsWith('plaza-')?cid.slice(6):null,plaza=O.plazaClear(daily.state,O.customizedPlaza(social.people.get(owner))?owner:null,drawCache),amount=(first.amount||0)+(daily.amount||0)+(plaza.amount||0);return {patch:{orbs:plaza.state,...(drawCache?{orbDraws:{...(p.orbDraws||{}),[drawCache.date]:drawCache}}:{})},result:{awarded:amount>0,amount}};});},
   rewardBamboo(uid,mode,floor){return mutate(uid,p=>{const r=O.bambooClear(p.orbs,mode,floor);return {patch:{orbs:r.state},result:r};});},
   buyFurniture(uid,kind,options){const id='furniture-'+crypto.randomUUID();return mutate(uid,p=>{const r=S.purchase(p,kind,options,id);return {patch:r.ok?{orbs:r.profile.orbs,furnitureInventory:r.profile.furnitureInventory||[],plazaParts:r.profile.plazaParts||{}}:{},result:{ok:r.ok,message:r.message,cost:r.cost}};});},
   collectVisits(uid){return mutate(uid,p=>{const r=O.collect(p.orbs);return {patch:{orbs:r.state},result:r};});},
   visitHouse:(owner,uid)=>activity(uid,owner,'house-visit'),
   recordPlazaPlay:(uid,owner)=>activity(uid,owner,'plaza-play')
  };
 }
 const api={create};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.HamuEconomy=api;
})(typeof window!=='undefined'?window:globalThis);
