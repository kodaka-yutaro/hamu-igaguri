(function(root,factory){
  const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.HamuBamboo=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const FLOORS=10,MODES=['challenge','marathon'];
  const count=n=>Number.isSafeInteger(n)&&n>=0?n:0;
  const floor=n=>Number.isInteger(n)&&n>=1&&n<=FLOORS?n:1;
  const key=(mode,n,courseId)=>JSON.stringify([mode,n,String(courseId)]);
  function create(saved){
    const raw=saved&&typeof saved==='object'?saved:{};
    const state={version:1,cleared:Math.min(FLOORS,count(raw.cleared)),mode:'challenge',selected:floor(raw.selected),
      marathon:{floor:floor(raw.marathon?.floor),misses:Math.min(3,count(raw.marathon?.misses)),finished:raw.marathon?.finished===true},
      rewards:{bambooCrown:raw.rewards?.bambooCrown===true,bambooCrownPurple:(raw.rewards?.bambooCrownPurple===true||raw.rewards?.bambooAxe===true)},rewardFloors:Array.from({length:FLOORS},(_,i)=>raw.rewardFloors?.[i]===true),marathonRewardSteps:Math.min(FLOORS,count(raw.marathonRewardSteps)),stats:{},serial:count(raw.serial),active:null};
    if(state.marathon.misses===3){state.marathonRewardSteps=0;state.marathon.floor=1;state.marathon.finished=false;}
    if(state.cleared<FLOORS)state.marathon={floor:1,misses:0,finished:false};
    if(raw.mode==='marathon'&&state.cleared===FLOORS)state.mode='marathon';
    for(const [id,v] of Object.entries(raw.stats||{})){
      if(!v||typeof v!=='object')continue;
      const attempts=count(v.attempts),clears=Math.min(attempts,count(v.clears)),players={};
      for(const [uid,sec] of Object.entries(v.players||{}))if(typeof sec==='number'&&Number.isFinite(sec)&&sec>=0)players[uid]=sec;
      state.stats[id]={attempts,clears,players:clears?players:{}};
    }
    // An interrupted attempt already contributes to attempts; leaving is not a hit.
    const unlocked=()=>state.cleared===FLOORS;
    const top=(mode=state.mode)=>mode==='marathon'?state.marathon.floor:Math.min(FLOORS,state.cleared+1);
    function canPlay(mode,n){
      if(!MODES.includes(mode)||!Number.isInteger(n)||n<1||n>FLOORS)return false;
      if(mode==='challenge')return n<=top(mode);
      return unlocked()&&!state.marathon.finished&&state.marathon.misses<3&&n===state.marathon.floor;
    }
    function select(n){if(!Number.isInteger(n)||n<1||n>FLOORS)return false;state.selected=n;return true;}
    function switchMode(mode){
      if(!MODES.includes(mode)||(mode==='marathon'&&!unlocked())||state.active)return false;
      state.mode=mode;state.selected=top(mode);return true;
    }
    function stats(mode,n,courseId){
      const v=state.stats[key(mode,n,courseId)]||{attempts:0,clears:0,players:{}};
      const times=Object.values(v.players);
      return {...v,people:times.length,best:times.length?Math.min(...times):null,rate:v.attempts?v.clears/v.attempts*100:null};
    }
    function begin(mode,n,courseId,player='you',counted=true){
      if(state.active||!canPlay(mode,n))return null;
      const id=++state.serial,statKey=key(mode,n,courseId);
      state.active={id,mode,floor:n,statKey,player:String(player),counted};
      if(counted){const v=state.stats[statKey]||={attempts:0,clears:0,players:{}};v.attempts++;}
      return id;
    }
    function finish(id,result,sec=0){
      const a=state.active;if(!a||a.id!==id||!['clear','miss','abandon'].includes(result))return null;
      if(result==='clear'&&(!Number.isFinite(sec)||sec<0))return null;
      state.active=null;
      if(result==='clear'){
        if(a.counted){const v=state.stats[a.statKey];v.clears++;v.players[a.player]=Math.min(v.players[a.player]??Infinity,sec);}
        if(a.mode==='challenge'&&a.floor===state.cleared+1)state.cleared++;
        if(a.mode==='challenge'&&a.counted){state.rewardFloors[a.floor-1]=true;if(state.rewardFloors.every(Boolean))state.rewards.bambooCrown=true;}
        if(a.mode==='marathon'){
          state.marathonRewardSteps=a.counted&&state.marathonRewardSteps===a.floor-1?a.floor:0;
          if(a.floor===FLOORS&&state.marathonRewardSteps===FLOORS)state.rewards.bambooCrownPurple=true;
          if(a.floor===FLOORS)state.marathon.finished=true;else state.marathon.floor++;
        }
      }else if(result==='miss'&&a.mode==='marathon'){
        state.marathon.misses++;
        if(state.marathon.misses===3){state.marathonRewardSteps=0;state.marathon.floor=1;state.selected=1;}
      }
      return {result,mode:a.mode,floor:a.floor,gameOver:a.mode==='marathon'&&state.marathon.misses===3,
        finished:a.mode==='marathon'&&state.marathon.finished,unlocked:unlocked()};
    }
    function abandon(){return state.active?finish(state.active.id,'abandon'):null;}
    function restart(){
      if(!unlocked()||state.active)return false;
      if(state.marathon.misses<3&&!state.marathon.finished)return false;
      state.marathon={floor:1,misses:0,finished:false};state.marathonRewardSteps=0;state.selected=1;return true;
    }
    return {state,unlocked,top,canPlay,select,switchMode,stats,begin,finish,abandon,restart};
  }
  function courseLabel(title){return String(title||'').replace(/^バンブー[ 　]*[0-9０-９]+[ 　:：・.．_—－-]*/u,'').trim();}
  return {FLOORS,create,courseLabel};
});
