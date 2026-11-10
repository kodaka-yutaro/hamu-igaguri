const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const Boss=require('../boss.js');
const config=(extra={})=>({...Boss.defaults,...extra});
const advance=(b,seconds,player)=>{for(let i=0;i<Math.round(seconds*120);i++)b.update(1/120,player);};
test('configuration accepts authored cycles and rejects malformed or unbounded settings',()=>{
 assert.deepEqual(Boss.cycle('1,2,2,1,5'),[1,2,2,1,5]);
 for(const change of [{hp:0},{hp:Infinity},{hp:1.1},{cycle:'1,0'},{cycle:''},{rageCycle:'8'},{interval:0},{rageInterval:61}])assert.equal(Boss.normalize(config(change)),null);
});
test('telegraph precedes attacks and the normal cycle repeats at six-second starts',()=>{
 const b=Boss.create(config());advance(b,5.3);assert.equal(b.state.warning.id,1);assert.equal(b.state.executed.length,0);
 advance(b,.8);assert.deepEqual(b.state.executed,[1]);advance(b,24);assert.deepEqual(b.state.executed,[1,2,2,1,5]);
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
 const ctx={HamuBoss:Boss,T:32,ROWS:16,VIEW_W:320,VIEW_H:512,PX:2,itemByCh:{},decorByKey:{},WARP_ENTRIES:'pqrst',WARP_EXITS:'uvwxy',performance:{now:()=>1},cancelAnimationFrame(){},sfx(){}};vm.createContext(ctx);vm.runInContext(engine,ctx);
 const rows=Array.from({length:16},(_,y)=>Array(40).fill(y>=13?'#':'.'));rows[12][2]='S';rows[12][3]='G';
 return ctx.makeGame(null,rows.map(r=>r.join('')),{headless:true,silent:true,manual:true,rewind:true,boss:config({hp:1,interval:60}),...extra});
}
test('boss engine ignores goals, has unlimited shots, wins on hit and reproduces a legal replay',()=>{
 const g=game();g.jump();for(let i=0;i<36;i++)g.replayEvent({type:'frame',dt:.05});assert.equal(g.state,'run');assert.equal(g.snap.life,15);assert.equal(g.launcherCharges,Infinity);
 assert.equal(g.fireLauncher(),true);assert.equal(g.fireLauncher(),false);
 for(let i=0;i<15&&g.state==='run';i++)g.replayEvent({type:'frame',dt:.05});assert.equal(g.state,'clear');assert.equal(g.bossState.hp,0);
 // Live recorded frame events are exercised in rewind.test; replay receives the exact same manual inputs here.
 const replay=game({rewind:false});replay.replayEvent({type:'jump'});for(let i=0;i<36;i++)replay.replayEvent({type:'frame',dt:.05});replay.replayEvent({type:'launcher'});for(let i=0;i<15&&replay.state==='run';i++)replay.replayEvent({type:'frame',dt:.05});assert.equal(replay.state,'clear');
});
test('ordinary courses retain finite ammo and jump cost',()=>{const g=game({boss:null});g.jump();assert.equal(g.snap.life,14);assert.equal(g.launcherCharges,0);assert.equal(g.fireLauncher(),false);});
test('boss configuration participates in cloud draft conflict detection',()=>{
 const ctx={window:{},setTimeout,clearTimeout};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../backend.js'),'utf8').split('// Private, revision-checked')[0],ctx);
 const f={title:'Boss',rows:Array(16).fill('.'.repeat(40)),boss:config()};const a={format:2,files:{a:f}},b=JSON.parse(JSON.stringify(a));b.files.a.boss.hp=50;assert.notEqual(ctx.window.HamuCourseLibrary.signature(a),ctx.window.HamuCourseLibrary.signature(b));
});
