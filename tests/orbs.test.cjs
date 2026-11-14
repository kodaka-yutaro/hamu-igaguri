const test=require('node:test'),assert=require('node:assert/strict'),O=require('../orbs.js');
const noon=Date.parse('2026-11-12T03:00:00Z');
test('plaza plays exclude self, deduplicate by visitor and day, cap at ten, persist balance across JST midnight',()=>{
 let s;assert.equal(O.play(s,'home','home',noon).awarded,false);
 s=O.play(s,'home','one',noon).state;assert.equal(O.play(s,'home','one',noon).awarded,false);
 for(let i=2;i<=11;i++)s=O.play(s,'home','v'+i,noon).state;
 assert.equal(s.balance,0);assert.equal(O.summary(s,noon).pending.length,11);s=O.collect(s).state;assert.equal(s.balance,10);assert.equal(O.collect(s).amount,0);assert.equal(O.summary(s,noon).today,10);
 assert.equal(O.day(Date.parse('2026-11-12T14:59:59Z')),'2026-11-12');assert.equal(O.day(Date.parse('2026-11-12T15:00:00Z')),'2026-11-13');
 s=O.play(s,'home','one',noon+86400000).state;s=O.collect(s).state;assert.equal(s.balance,11);assert.equal(O.summary(s,noon+86400000).today,1);
});
test('daily draws are deterministic, unique, choose a >=10% course and avoid ten previous days when possible',()=>{
 const courses=Array.from({length:40},(_,i)=>({id:'c'+i,rate:i%2?10:0})),h={};
 for(let d=0;d<16;d++){const now=noon+d*86400000,draw=O.select(courses,h,now);assert.equal(draw.ids.length,2);assert.equal(new Set(draw.ids).size,2);assert.ok(courses.find(c=>c.id===draw.easyId).rate>=10);for(const [date,old]of Object.entries(h))if(date>=O.day(now-10*86400000))assert.ok(!draw.ids.some(id=>old.ids.includes(id)));h[draw.date]=draw;assert.deepEqual(O.select(courses.reverse(),h,now),draw);}
});
test('small pools gracefully repeat, no eligible rates use fallback, same day draw stays frozen',()=>{
 const c=[{id:'a',rate:null},{id:'b',rate:0}],h={};const a=O.select(c,h,noon);h[a.date]=a;assert.equal(a.fallback,true);const b=O.select(c,h,noon+86400000);assert.equal(b.repeated,true);assert.equal(b.ids.length,2);assert.deepEqual(O.select([{id:'new',rate:80}],h,noon),a);
});
test('daily clear grants three once per selected course, repeat slower clears still qualify independently of personal best',()=>{
 const draw={date:O.day(noon),ids:['own-course','other']};let s;
 let r=O.clear(s,'own-course',draw,noon);assert.equal(r.awarded,true);s=r.state;
 assert.equal(O.clear(s,'own-course',draw,noon).awarded,false);assert.equal(O.clear(s,'unselected',draw,noon).awarded,false);
 s=O.play(s,'home','visitor',noon).state;s=O.collect(s).state;s=O.clear(s,'other',draw,noon).state;assert.equal(s.balance,7);
 assert.equal(O.clear(s,'other',draw,noon+86400000).awarded,false);
 const tomorrow={...draw,date:O.day(noon+86400000)};assert.equal(O.clear(s,'own-course',tomorrow,noon+86400000).state.balance,10);
});
test('game clear callback awards even without a personal-best improvement',async()=>{
 const fs=require('node:fs'),vm=require('node:vm'),html=fs.readFileSync('index.html','utf8'),start=html.indexOf('async function recordClear('),end=html.indexOf('\nfunction onState(',start);let state,granted=0;
 const draw={date:O.day(Date.now()),ids:['mine']};const context={economy:{async rewardClear(uid,id){const r=O.clear(state,id,draw);state=r.state;if(r.awarded)granted++;return r;}},social:{uid:'me'},todaysRewards(){},orbGain(){},toast(){},clearCount:()=>1,myClears:()=>({mine:1})};vm.createContext(context);vm.runInContext(html.slice(start,end),context);
 await context.recordClear({id:'mine',author:'me'},12);await context.recordClear({id:'mine',author:'me'},15);assert.equal(granted,1);assert.equal(state.balance,3);
});
test('bamboo challenge and marathon each award three once per floor, remain claimed across currency operations',()=>{let s;for(const mode of ['challenge','marathon'])for(let floor=1;floor<=10;floor++){const r=O.bambooClear(s,mode,floor);assert.equal(r.awarded,true);s=r.state;assert.equal(O.bambooClear(s,mode,floor).awarded,false);}assert.equal(s.balance,60);s=O.play(s,'home','friend').state;s=O.collect(s).state;assert.equal(O.bambooClear(s,'challenge',1).awarded,false);for(const [mode,floor]of [['test',1],['challenge',0],['marathon',11]])assert.equal(O.bambooClear(s,mode,floor).awarded,false);});
test('real bamboo clear callback awards all twenty first clears, duplicate callbacks cannot award',async()=>{
 const fs=require('node:fs'),vm=require('node:vm'),B=require('../bamboo.js'),html=fs.readFileSync('index.html','utf8'),start=html.indexOf('function bambooPlayerState('),end=html.indexOf('\nlet bambooTouch=',start);let orbs,effects=0;
 const ctx={bamboo:B.create(),current:null,social:{uid:'test-self'},sheet:null,economy:{async rewardBamboo(uid,mode,floor){const r=O.bambooClear(orbs,mode,floor);orbs=r.state;return r;}},$:()=>({}),saveBamboo(){},notifyBambooReward(){},renderBamboo(){},paintBambooLives(){},showMsg(){},orbGain:n=>effects+=n,returnToBamboo(){},restartBamboo(){}};vm.createContext(ctx);vm.runInContext(html.slice(start,end),ctx);
 for(const mode of ['challenge','marathon']){if(mode==='marathon')ctx.bamboo.switchMode(mode);for(let floor=1;floor<=10;floor++){ctx.current={bambooFloor:floor,bambooMode:mode,course:{id:'course-'+floor}};ctx.bambooPlayerState('run');ctx.bambooPlayerState('clear',{sec:10});ctx.bambooPlayerState('clear',{sec:10});}}
 await Promise.resolve();assert.equal(orbs.balance,60);assert.equal(effects,60);
});
test('tree growth uses four earned-orb ranges, including the ten-orb boundary',()=>{for(const [earned,stage]of [[0,1],[1,2],[2,2],[3,3],[9,3],[10,4],[11,4]])assert.equal(O.summary({balance:0,earned}).stage,stage);});
test('house visits and plays share ten daily orbs, deduplicate separately, preserve collection and reset at JST midnight',()=>{let s;for(let i=0;i<6;i++){s=O.visit(s,'host','v'+i,noon).state;s=O.play(s,'host','v'+i,noon).state;}assert.equal(O.summary(s,noon).today,10);assert.equal(O.collect(s).amount,10);s=O.collect(s).state;assert.equal(O.visit(s,'host','v0',noon).recorded,false);assert.equal(O.play(s,'host','v0',noon).recorded,false);assert.equal(O.visit(s,'host','host',noon).recorded,false);assert.equal(O.collect(s).amount,0);s=O.visit(s,'host','v0',noon+86400000).state;assert.equal(O.collect(s).amount,1);});
test('plaza clears grant nothing and old pending clear rewards are retired without removing balances',()=>{const s={balance:8,visitors:[{kind:'plaza-clear',reward:1,claimed:false}]};assert.equal(O.summary(s).pending.length,0);assert.equal(O.collect(s).amount,0);assert.equal(O.collect(s).state.balance,8);assert.equal(O.plazaClear(s).awarded,false);assert.equal(O.plazaReward(s).amount,0);assert.equal(O.hostClear(s).recorded,false);});

test('closing an active marathon attempt counts one miss, completed attempts and challenge exits do not',()=>{const fs=require('node:fs'),vm=require('node:vm'),B=require('../bamboo.js'),html=fs.readFileSync('index.html','utf8'),start=html.indexOf('function leaveBambooAttempt('),end=html.indexOf('function retryBamboo(',start);const b=B.create({cleared:10});b.switchMode('marathon');const ctx={current:{bambooFloor:1,bambooMode:'marathon',bambooAttempt:b.begin('marathon',1,'course')},bamboo:b,sheet:null,saveBamboo(){},renderBamboo(){}};vm.createContext(ctx);vm.runInContext(html.slice(start,end),ctx);ctx.leaveBambooAttempt();assert.equal(b.state.marathon.misses,1);ctx.leaveBambooAttempt();assert.equal(b.state.marathon.misses,1);ctx.current.bambooAttempt=b.begin('marathon',1,'course');b.finish(ctx.current.bambooAttempt,'clear',5);ctx.current.bambooAttempt=null;ctx.leaveBambooAttempt();assert.equal(b.state.marathon.misses,1);});

test('course reward labels match daily and per-mode bamboo claims and never promise plaza clear orbs',()=>{const fs=require('node:fs'),vm=require('node:vm'),html=fs.readFileSync('index.html','utf8'),a=html.indexOf('function courseOrbReward('),b=html.indexOf('function courseOrbBadge(',a);let orbs={};const date=O.day(Date.now()),ctx={me:()=>({orbs}),todaysRewards:()=>({date,ids:['daily']}),HamuOrbs:O};vm.createContext(ctx);vm.runInContext(html.slice(a,b),ctx);assert.match(ctx.courseOrbReward({id:'daily'}).text,/3個/);assert.equal(ctx.courseOrbReward({id:'other'}),null);assert.equal(ctx.courseOrbReward({id:'daily',plaza:true}),null);orbs={claims:{[date]:['daily']},eventClaims:{'bamboo-green-family-v1:challenge:1':true}};assert.equal(ctx.courseOrbReward({id:'daily'}).claimed,true);assert.equal(ctx.courseOrbReward({id:'bamboo'},{bambooMode:'challenge',bambooFloor:1}).claimed,true);assert.equal(ctx.courseOrbReward({id:'bamboo'},{bambooMode:'marathon',bambooFloor:1}).claimed,false);});

test('configured official first-clear reward grants the chosen amount once, survives other orb operations, and rejects invalid or overflowing amounts',()=>{let r=O.officialClear({balance:4},'official',17);assert.equal(r.amount,17);assert.equal(r.state.balance,21);assert.equal(O.officialClear(r.state,'official',99).awarded,false);let s=O.bambooClear(r.state,'challenge',1).state;assert.equal(O.officialClear(s,'official',17).awarded,false);for(const amount of [0,-1,1.5,NaN,Infinity,'3'])assert.equal(O.officialClear(null,'x',amount).awarded,false);assert.equal(O.officialClear({balance:Number.MAX_SAFE_INTEGER},'x',1).awarded,false);});
