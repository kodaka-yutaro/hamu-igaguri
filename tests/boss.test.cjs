const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const Boss=require('../boss.js');
const config=(extra={})=>({...Boss.defaults,...extra});
const advance=(b,seconds,player)=>{for(let i=0;i<Math.round(seconds*120);i++)b.update(1/120,player);};
test('configuration accepts authored cycles and rejects malformed or unbounded settings',()=>{
 assert.deepEqual(Boss.cycle('1,2,2,1,5'),[1,2,2,1,5]);
 for(const change of [{hp:0},{hp:Infinity},{hp:1.1},{cycle:'1,0'},{cycle:''},{rageCycle:'8'},{interval:0},{rageInterval:61}])assert.equal(Boss.normalize(config(change)),null);
});
test('telegraph precedes attacks and the next burst waits six seconds after the final shot',()=>{
 const b=Boss.create(config());advance(b,5.3);assert.equal(b.state.warning.id,1);assert.equal(b.state.executed.length,0);
 advance(b,.8);assert.deepEqual(b.state.executed,[1]);advance(b,6.2);assert.deepEqual(b.state.executed,[1]);assert.equal(b.state.warning.id,2);
 advance(b,.2);assert.deepEqual(b.state.executed,[1,2]);
});
for(const [id,count,kind] of [[1,3,'burr'],[2,16,'block'],[3,1,'burr'],[6,80,'block'],[7,10,'burr']])test(`attack ${id} emits ${count} ${kind} objects`,()=>{
 const b=Boss.create(config({cycle:[id],interval:6}));advance(b,6+(id===7?2.1:.6));assert.equal(b.state.seq,count);assert.ok(b.state.bullets.every(x=>x.kind===kind));if(id===3)assert.equal(b.state.bullets[0].w,64);
 if(id===6)assert.equal(new Set(b.state.bullets.map(x=>Math.round(x.x))).size,5);
});
test('rush is absent for two seconds then returns from the right; sweep leaves a vertical trail',()=>{
 const b=Boss.create(config({cycle:[5],interval:10}));advance(b,10.6);assert.equal(b.state.active.phase,'wait');assert.ok(b.state.x<0);advance(b,1.7);assert.ok(b.state.x<0);advance(b,.5);assert.ok(b.state.x>=320);advance(b,.5);assert.equal(b.state.x,320);
 const a=Boss.create(config({cycle:[4],interval:6}));advance(a,7.3);assert.equal(a.state.seq,15);assert.ok(new Set(a.state.bullets.map(x=>Math.round(x.y))).size>10);
});
test('HP strictly below half enters rage, resets its sequence, and death stops attacking',()=>{
 const b=Boss.create(config({hp:4,rageCycle:[7],rageInterval:3}));b.hit(280,b.state.y);b.hit(280,b.state.y);assert.equal(b.state.rage,false);b.hit(280,b.state.y);assert.equal(b.state.rage,true);advance(b,3.1);assert.deepEqual(b.state.executed,[7]);b.hit(280,b.state.y);assert.equal(b.state.hp,0);const n=b.state.seq;advance(b,10);assert.equal(b.state.seq,n);
});
test('body contact has a damage grace period and launcher blasts open block walls',()=>{
 const b=Boss.create(config({cycle:[2]}));const p={x:280,y:250,w:22,h:22};assert.equal(b.update(.01,p),3);assert.equal(b.update(.01,p),0);advance(b,6);const wall=b.state.bullets[5],n=b.state.bullets.length;assert.equal(b.hit(wall.x+16,wall.y+16),'block');assert.ok(b.state.bullets.length<n);
});
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
const engine=html.slice(html.indexOf('function makeGame(canvas, rows, hooks){'),html.indexOf('\nif (window.__hamuTest) Object.assign(window, {__makeGame'));
function game(extra={}){
 const ctx={HamuBoss:Boss,T:32,ROWS:16,VIEW_W:320,VIEW_H:512,PX:2,itemByCh:{},decorByKey:{},WARP_ENTRIES:'pqrst',WARP_EXITS:'uvwxy',performance:{now:()=>1},cancelAnimationFrame(){},sfx(){}};vm.createContext(ctx);vm.runInContext(engine.replace('return { jump, reset,', 'return { inspect:()=>({shots:launcherShots,camX,blocks:boss?.state.bullets.filter(b=>b.kind===\'block\')}), placeBlock:(x,y)=>boss.state.bullets.push({id:++boss.state.seq,kind:\'block\',terrain:true,x,y,w:32,h:32,vx:0,age:0}), hurt:takeBossHit, jump, reset,'),ctx);
 const rows=Array.from({length:16},(_,y)=>Array(40).fill(y>=13?'#':'.'));rows[12][2]='S';rows[12][3]='G';
 return ctx.makeGame(null,rows.map(r=>r.join('')),{headless:true,silent:true,manual:true,rewind:true,boss:config({hp:1,interval:60}),...extra});
}
test('boss engine ignores goals, fires without life cost, wins on hit and reproduces a legal replay',()=>{
 const g=game();g.jump();for(let i=0;i<36;i++)g.replayEvent({type:'frame',dt:.05});assert.equal(g.state,'run');assert.equal(g.snap.life,20);assert.equal(g.launcherCharges,Infinity);
 assert.equal(g.fireLauncher(),true);assert.equal(g.fireLauncher(),false);
 assert.equal(g.snap.life,20);
 for(let i=0;i<15&&g.state==='run';i++)g.replayEvent({type:'frame',dt:.05});assert.equal(g.state,'clear');assert.equal(g.bossState.hp,0);
 // Live recorded frame events are exercised in rewind.test; replay receives the exact same manual inputs here.
 const replay=game({rewind:false});replay.replayEvent({type:'jump'});for(let i=0;i<36;i++)replay.replayEvent({type:'frame',dt:.05});replay.replayEvent({type:'launcher'});for(let i=0;i<15&&replay.state==='run';i++)replay.replayEvent({type:'frame',dt:.05});assert.equal(replay.state,'clear');
});
test('ordinary courses retain finite ammo and jump cost',()=>{const g=game({boss:null});g.jump();assert.equal(g.snap.life,14);assert.equal(g.launcherCharges,0);assert.equal(g.fireLauncher(),false);});
test('boss configuration participates in cloud draft conflict detection',()=>{
 const ctx={window:{},setTimeout,clearTimeout};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../backend.js'),'utf8').split('// Private, revision-checked')[0],ctx);
 const f={title:'Boss',rows:Array(16).fill('.'.repeat(40)),boss:config()};const a={format:2,files:{a:f}},b=JSON.parse(JSON.stringify(a));b.files.a.boss.hp=50;assert.notEqual(ctx.window.HamuCourseLibrary.signature(a),ctx.window.HamuCourseLibrary.signature(b));
});

const frame=g=>g.replayEvent({type:'frame',dt:.05});
function pickup(g,x){g.rows[12]=g.rows[12].slice(0,x)+'W'+g.rows[12].slice(x+1);g._warp(x*32,394);frame(g);}
test('evolution pickups cap at two and shots use the launcher muzzle with the battle spread',()=>{
 const g=game();g.begin();pickup(g,4);assert.equal(g.power,1);pickup(g,6);pickup(g,8);assert.equal(g.power,2);
 const before=g.snap;g.fireLauncher();const shots=g.inspect().shots;assert.equal(shots.length,3);assert.deepEqual(Array.from(shots,s=>s.vy),[-90,0,90]);assert.ok(shots.every(s=>s.pw===2&&Math.abs(s.x-before.x-27)<1&&Math.abs(s.y-before.y-11)<1));
});
test('damage removes one evolution, grace prevents multiple losses, and level zero dies',()=>{
 const g=game();g.begin();pickup(g,4);pickup(g,6);g.hurt('test');assert.equal(g.power,1);g.hurt('test');assert.equal(g.power,1);
 for(let i=0;i<19;i++)frame(g);g.hurt('test');assert.equal(g.power,0);assert.equal(g.state,'run');for(let i=0;i<19;i++)frame(g);g.hurt('test');assert.equal(g.state,'dead');
});
test('terrain burrs use the same evolution damage rule',()=>{
 const g=game();g.begin();pickup(g,4);g.rows[12]=g.rows[12].slice(0,6)+'*'+g.rows[12].slice(7);g._warp(192,394);frame(g);assert.equal(g.power,0);assert.equal(g.state,'run');
 const zero=game();zero.begin();zero.rows[12]=zero.rows[12].slice(0,6)+'*'+zero.rows[12].slice(7);zero._warp(192,394);frame(zero);assert.equal(zero.state,'dead');
});
test('boss course traverses the last columns and wraps full width retaining evolution and boss',()=>{
 const g=game();g.begin();pickup(g,4);g._warp(39*32,394);frame(g);assert.ok(g.snap.x>=39*32);assert.equal(g.state,'run');const hp=g.bossState.hp;
 g._warp(1279,394);frame(g);assert.ok(g.snap.x<16);assert.equal(g.power,1);assert.equal(g.bossState.hp,hp);assert.equal(g.state,'run');assert.ok(g.inspect().camX<0);
});

for(const id of [1,4,5,7])test(`attack ${id} waits the configured recovery after completion, including rage transitions`,()=>{
 const b=Boss.create(config({hp:4,cycle:[id],interval:1,rageCycle:[1],rageInterval:1}));
 assert.ok(Boss.normalize(config({cycle:[id],interval:1})));
 while(!b.state.active)b.update(1/120);
 // Enter rage during a long attack: preserve the active attack and give it its full recovery.
 for(let i=0;i<3;i++)b.hit(b.state.x,b.state.y);
 while(b.state.active)b.update(1/120);
 const end=b.state.time,n=b.state.executed.length;
 advance(b,.95);assert.equal(b.state.executed.length,n);assert.equal(b.state.warning.id,1);
 advance(b,.1);assert.equal(b.state.executed.length,n+1);assert.ok(b.state.time-end>=1);
});
for(const id of [1,7])test(`burst ${id} moves continuously and fires from the current boss height`,()=>{
 const b=Boss.create(config({cycle:[id],interval:2})),ys=[];
 for(let i=0;i<550;i++){
  const seq=b.state.seq,prevY=b.state.y;b.update(1/120);
  assert.ok(Math.abs(b.state.y-prevY)<=150*.55/120+.001);
  if(b.state.seq>seq){const bullet=b.state.bullets.find(x=>x.id===b.state.seq);assert.ok(bullet.projectile);assert.ok(Math.abs(bullet.y+bullet.h/2-b.state.y-6)<.001);ys.push(b.state.y);}
 }
 assert.ok(ys.length>=3);assert.ok(Math.max(...ys)-Math.min(...ys)>2,'burst height must not freeze');
});
test('sweep and rush resume from a continuous height instead of snapping to the global clock',()=>{
 const b=Boss.create(config({cycle:[4,5,7],interval:1}));
 for(let i=0;i<3600;i++){
  const y=b.state.y;b.update(1/120);
  assert.ok(Math.abs(b.state.y-y)<=150*9/120+.001,`vertical teleport at ${b.state.time}`);
 }
 assert.ok(b.state.executed.includes(4)&&b.state.executed.includes(5)&&b.state.executed.includes(7));
});
test('walls cause no damage or invulnerability; flying burrs still hit',()=>{
 const b=Boss.create(config()),p={x:90,y:200,w:22,h:22};
 b.state.bullets.push({kind:'block',terrain:true,x:90,y:200,w:32,h:32,vx:0,age:0});
 assert.equal(b.update(.01,p),0);assert.equal(b.state.invincible,0);
 b.state.bullets.push({kind:'burr',projectile:true,x:90,y:200,w:32,h:32,vx:-170,age:0});
 assert.equal(b.update(.01,p),3);
});
test('boss wall stops the hamster as solid terrain without consuming life or evolution',()=>{
 const g=game({boss:config({cycle:[2],interval:1,hp:999})});g.begin();
 for(let i=0;i<90;i++)frame(g);
 assert.equal(g.state,'run');assert.equal(g.snap.life,20);assert.equal(g.power,0);
 const before=g.snap.x;for(let i=0;i<15;i++)frame(g);
 assert.equal(g.snap.x,before,'must not pass through a wall');
 const {camX,blocks}=g.inspect();assert.ok(blocks.some(b=>Math.abs(b.x+camX-g.snap.x-22)<1));
 assert.equal(g.fireLauncher(),true);
 for(let i=0;i<20;i++)frame(g);
 assert.ok(g.snap.x>before+20,'breaking the wall opens the path');
});
test('boss blocks support landing and stop an upward jump just like course blocks',()=>{
 const g=game({boss:config({hp:999,interval:60})});g.begin();g._warp(69,150);g.replayEvent({type:'frame',dt:0});
 for(const x of [96,128,160])g.placeBlock(x,200);
 for(let i=0;i<6;i++)frame(g);assert.equal(g.snap.y,178);assert.equal(g.snap.life,20);
 g._warp(69,232);g.replayEvent({type:'frame',dt:0});g.jump();frame(g);
 assert.ok(g.snap.y>=232);assert.ok(g.snap.vy>=0);assert.equal(g.snap.life,20);
});
test('boss shooting is free even with three projectiles and still respects the cooldown',()=>{
 const g=game({boss:config({hp:999,interval:60})});g.begin();pickup(g,4);pickup(g,6);
 assert.equal(g.fireLauncher(),true);assert.equal(g.snap.life,20);assert.equal(g.inspect().shots.length,3);
 assert.equal(g.fireLauncher(),false);assert.equal(g.snap.life,20);
});
test('boss jumps and shots never exhaust life or ammo; damage still follows evolution',()=>{
 const jumper=game();for(let i=0;i<100;i++)jumper.jump();assert.equal(jumper.state,'run');assert.equal(jumper.snap.life,20);
 const g=game({boss:config({hp:999,interval:60})});g.begin();
 for(let i=0;i<30;i++){
  g.rows[13]='M'.repeat(40);assert.equal(g.fireLauncher(),true,`shot ${i+1}: ${g.state}`);
  for(let j=0;j<17;j++)frame(g);
 }
 assert.equal(g.state,'run');assert.equal(g.snap.life,20);assert.equal(g.launcherCharges,Infinity);
 g.hurt('test');assert.equal(g.state,'dead');assert.equal(g.fireLauncher(),false);
});
test('placed hazards follow the course while flying shots use their own trajectory',()=>{
 const b=Boss.create(config({cycle:[4,1],interval:1}));advance(b,2.3);
 const fixed=b.state.bullets.find(x=>x.terrain),x=fixed.x;b.scrollTerrain(20);assert.equal(fixed.x,x-20);
 advance(b,1);const flying=b.state.bullets.find(x=>x.projectile),fx=flying.x;b.scrollTerrain(20);assert.equal(flying.x,fx);
});
test('legacy intervals migrate per step and normalized cycles survive a save/load round trip',()=>{
 const old=Boss.normalize(config());assert.deepEqual(old.intervals,[6,6,6,6,6]);assert.deepEqual(old.rageIntervals,[4,4,4,4,4]);
 const c=Boss.normalize({...old,intervals:[1,2.5,3,4,5],rageIntervals:[6,7,8,9,10]});
 assert.deepEqual(Boss.normalize(JSON.parse(JSON.stringify(c))),c);
 for(const intervals of [[],[1],Array(5).fill(0),Array(5).fill(61),Array(5).fill(Infinity)])assert.equal(Boss.normalize({...old,intervals}),null);
 const ctx={window:{},setTimeout,clearTimeout};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../backend.js'),'utf8').split('// Private, revision-checked')[0],ctx);
 const original={format:2,files:{a:{rows:Array(16).fill('.'.repeat(40)),title:'Boss',boss:c}}},saved=ctx.window.HamuCourseLibrary.normalize(JSON.parse(JSON.stringify(original)));
 assert.deepEqual(Array.from(saved.files.a.boss.intervals),c.intervals);
 const edited=JSON.parse(JSON.stringify(original));edited.files.a.boss.intervals[2]=9;
 assert.notEqual(ctx.window.HamuCourseLibrary.signature(original),ctx.window.HamuCourseLibrary.signature(edited));
});
test('each attack uses its own post-attack delay across long attacks and cycle wraparound',()=>{
 const b=Boss.create(config({cycle:[1,7,5],intervals:[1,2,3]})),starts=[],ends=[];
 for(let i=0;i<2100;i++){
  const count=b.state.executed.length,active=b.state.active;b.update(1/120);
  if(b.state.executed.length>count)starts.push({id:b.state.executed.at(-1),time:b.state.time});
  if(active&&!b.state.active)ends.push({id:active.id,time:b.state.time});
 }
 assert.deepEqual(starts.slice(0,4).map(x=>x.id),[1,7,5,1]);
 for(let i=0;i<3;i++)assert.ok(Math.abs(starts[i+1].time-ends[i].time-[1,2,3][i])<.02);
});
test('entering rage preserves the active step recovery then uses rage step delays',()=>{
 const b=Boss.create(config({hp:4,cycle:[7],intervals:[3],rageCycle:[1,7],rageIntervals:[1,2]}));
 advance(b,3.2);assert.equal(b.state.active.id,7);for(let i=0;i<3;i++)b.hit(b.state.x,b.state.y);
 while(b.state.active)b.update(1/120);advance(b,2.95);assert.deepEqual(b.state.executed,[7]);
 advance(b,.1);assert.deepEqual(b.state.executed,[7,1]);while(b.state.active)b.update(1/120);
 advance(b,.95);assert.deepEqual(b.state.executed,[7,1]);advance(b,.1);assert.deepEqual(b.state.executed,[7,1,7]);
});
