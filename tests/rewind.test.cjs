const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
let engine = html.slice(html.indexOf('function makeGame(canvas, rows, hooks){'), html.indexOf('\nif (window.__hamuTest) Object.assign(window, {__makeGame'));
// Inspect closure state only in the test harness; production exports no checkpoint mutation API.
engine = engine.replace('return { jump, reset,', 'return { inspect: () => ({p: {...p}, life, taken: [...taken], springs: [...springs], cannon: cannon && {...cannon}, kvx, t, elapsed, maxLife, stocks, power, myW: [...myW], ghostT, hoverT, rear}), jump, reset,');
const verify = html.slice(html.indexOf('async function verifyCourseRoute('), html.indexOf('\nif (window.__hamuTest) window.__verifyCourseRoute'));
const plain = x => JSON.parse(JSON.stringify(x));
function course(tiles = []) {
  const rows = Array.from({length: 16}, (_, y) => Array(40).fill(y >= 14 ? '#' : '.'));
  rows[13][2] = 'S'; rows[13][37] = 'G';
  for (const [x, y, ch] of tiles) rows[y][x] = ch;
  return rows.map(r => r.join(''));
}
function setup(rows = course(), options = {}) {
  let now = 1, next = 0; const scheduled = new Map(), states = [];
  const ctx = {T:32, ROWS:16, VIEW_W:320, VIEW_H:512, PX:2, itemByCh:{},
    performance:{now: () => now}, sfx(){}, setTimeout,
    requestAnimationFrame(fn){scheduled.set(++next, fn); return next;},
    cancelAnimationFrame(id){scheduled.delete(id);}};
  vm.createContext(ctx); vm.runInContext(engine + '\n' + verify, ctx);
  const game = ctx.makeGame(null, rows, {headless:true, silent:true, rewind:true, onState:(s,i) => states.push([s, i]), ...options});
  const tick = (count = 1, ms = 1000/60) => { for (let i=0;i<count;i++){now += ms; const work=[...scheduled.values()];scheduled.clear();work.forEach(fn=>fn(now));} };
  const until = (condition, max = 3000) => {let n=0; while (!condition() && n++<max) tick(); assert.ok(condition(), 'condition reached before frame limit');};
  tick();
  return {game, tick, until, states, verify: (r, log, cancel) => ctx.verifyCourseRoute(r, log, cancel), scheduled};
}
function exhaust(g){for(let i=0;i<20 && g.state==='run';i++) g.jump(); assert.equal(g.state,'dead');}
test('each successful segment joins into one legal ordinary run without fatal attempts', async () => {
  const rows=course(), h=setup(rows), g=h.game; g.jump();h.tick(25);assert.equal(g.mark(),true);
  const first=plain(g.inspect());exhaust(g);assert.equal(g.restoreCheckpoint(),true);
  assert.equal(g.state,'paused');assert.deepEqual(plain(g.inspect()),first);g.resume();h.tick(70);g.mark();
  const second=plain(g.inspect());exhaust(g);g.restoreCheckpoint();assert.deepEqual(plain(g.inspect()),second);g.resume();
  h.until(()=>g.state==='clear');assert.equal(g.rewindInfo.count,2);
  assert.equal(g.route.filter(e=>e.type==='jump').length,1,'failed jump attempts were removed');
  assert.equal(await h.verify(rows,g.route),true);
});
test('checkpoint restores the reduced life, never a fresh life bar', () => {
  const h=setup(),g=h.game;g.jump();h.tick(20);g.jump();g.jump();g.mark();const life=g.snap.life;
  assert.equal(life,12);exhaust(g);g.restoreCheckpoint();assert.equal(g.snap.life,life);
});
test('a collected acorn stays collected and its consumed life cannot be farmed at a saved point', () => {
  const h=setup(course([[6,13,'A']])),g=h.game;g.jump();h.until(()=>g.inspect().taken.length>0);
  g.jump();g.mark();const before=plain(g.inspect());assert.equal(before.life,14);
  exhaust(g);g.restoreCheckpoint();assert.deepEqual(plain(g.inspect()),before);assert.equal(g.inspect().taken.length,1);
});
test('rewinding to before an acorn restores both the earlier life and uncollected acorn', () => {
  const h=setup(course([[6,13,'A']])),g=h.game;g.jump();h.tick(12);g.mark();const before=plain(g.inspect());
  h.until(()=>g.inspect().taken.length>0);assert.equal(g.snap.life,15);g.restoreCheckpoint();
  assert.deepEqual(plain(g.inspect()),before);assert.equal(g.snap.life,14);assert.equal(g.inspect().taken.length,0);
});
for(const tile of ['O','C','J'])test(`${tile}: momentum, activation cooldown and cannon hold state survive rewind exactly`, () => {
  const h=setup(course([[5,13,tile]])),g=h.game;g.jump();
  h.until(()=>tile==='C' ? !!g.inspect().cannon : g.inspect().springs.length>0);
  g.mark();const before=plain(g.inspect());assert.ok(tile!=='C'||before.cannon.t>0);
  exhaust(g);g.restoreCheckpoint();assert.deepEqual(plain(g.inspect()),before);
});
test('2-second rewind goes back along the actual run and freezes until resumed', () => {
  const h=setup(),g=h.game;g.jump();h.tick(190);const old=g.time;
  assert.equal(g.rewind(2),true);assert.equal(g.state,'paused');assert.ok(Math.abs(g.time-(old-2))<.02);
  const before=plain(g.inspect());h.tick(100);assert.deepEqual(plain(g.inspect()),before);
  g.resume();h.tick(2);assert.equal(g.state,'run');assert.ok(g.time>before.elapsed);
});
test('rewinding past a saved point keeps its independent legal path', () => {
  const h=setup(),g=h.game;g.jump();h.tick(180);g.mark();h.tick(10);g.rewind(2);
  assert.ok(g.rewindInfo.checkpoint);assert.equal(g.restoreCheckpoint(),true);assert.equal(g.state,'paused');
});
test('restart keeps checkpoint while clearing current path and rewind count', () => {
  const h=setup(),g=h.game;g.jump();h.tick(80);g.mark();g.rewind(1);g.reset();
  assert.equal(g.state,'ready');assert.equal(g.rewindInfo.count,0);assert.ok(g.rewindInfo.checkpoint);assert.equal(g.route.length,0);assert.equal(g.restoreCheckpoint(),true);
});
test('ordinary play does not expose usable checkpoint or rewind controls', () => {
  const h=setup(course(),{rewind:false}),g=h.game;g.jump();h.tick(100);
  assert.equal(g.rewindInfo.enabled,false);assert.equal(g.mark(),false);assert.equal(g.rewind(2),false);assert.equal(g.restoreCheckpoint(),false);assert.equal(g.route,null);
});
test('battle and endless engines cannot enable rewind even when requested', () => {
  const rows=course();
  const battle=setup(rows,{battle:{rival:null}}).game;
  assert.equal(battle.rewindInfo.enabled,false);assert.equal(battle.mark(),false);
  const endless=setup(rows,{endless:()=>({rows,extend(){}})}).game;
  assert.equal(endless.rewindInfo.enabled,false);assert.equal(endless.rewind(1),false);
});
test('reconstruction emits no duplicate gameplay effects or intermediate state callbacks', () => {
  const h=setup(),g=h.game;g.jump();h.tick(50);g.mark();exhaust(g);const n=h.states.length;g.restoreCheckpoint();
  assert.deepEqual(h.states.slice(n).map(x=>x[0]),['rewound']);
});
test('a warp-assisted apparent clear is rejected by fresh ordinary replay', async () => {
  const rows=course(),h=setup(rows),g=h.game;g.jump();h.tick(5);g._warp(37*32,400);h.tick(1);
  assert.equal(g.state,'clear');assert.equal(await h.verify(rows,g.route),false);
});
test('a witness stops validating as soon as the course changes into an impossible wall', async () => {
  const rows=course(),h=setup(rows),g=h.game;g.jump();h.until(()=>g.state==='clear');
  const blocked=rows.map(r=>r.slice(0,10)+'#'+r.slice(11));assert.equal(await h.verify(blocked,g.route),false);
  assert.equal(await h.verify(rows,g.route),true);
});
test('fatal, truncated, malformed and illegally timed routes never validate', async () => {
  const rows=course(),h=setup(rows),g=h.game;g.jump();h.until(()=>g.state==='clear');const good=g.route;
  assert.equal(await h.verify(rows,good.slice(0,20)),false);
  assert.equal(await h.verify(rows,[{type:'warp',x:9999}]),false);
  for(const dt of [-1,1,Infinity,NaN])assert.equal(await h.verify(rows,[{type:'jump'},{type:'frame',dt}]),false);
  assert.equal(await h.verify(rows,[...Array(16)].map(()=>({type:'jump'}))),false);
  assert.equal(await h.verify(rows,[...good,{type:'frame',dt:.01}]),false);
});
test('cancelled or stale verification cannot grant a clear and leaves no animation task', async () => {
  const rows=course(),h=setup(rows),g=h.game;g.jump();h.until(()=>g.state==='clear');const count=h.scheduled.size;
  assert.equal(await h.verify(rows,g.route,()=>true),false);assert.equal(h.scheduled.size,count);
});
function openHooks(isOwner, mode){
  let captured;
  const nodes = new Map();
  const ctx = {social:{isOwner}, activeDraftId:'draft-a', game:null, current:null,
    $:id=>{if(!nodes.has(id))nodes.set(id,{style:{},focus(){}});return nodes.get(id);},
    document:{body:{style:{}}}, fitPlayer(){},renderRewindControls(){},savedTestCheckpoint(){return null;},saveTestCheckpoint(){},myLook:()=>({}),onState(){},
    makeGame(_cv,_rows,hooks){captured=hooks;return {stop(){}};}};
  vm.createContext(ctx);
  vm.runInContext(html.slice(html.indexOf('function openPlayer('),html.indexOf('function savedTestCheckpoint(')),ctx);
  ctx.openPlayer({rows:course(),title:'確認用'},mode);return captured;
}
test('the actual player enables rewind only for an operator editing their test course', () => {
  assert.equal(openHooks(true,'test').rewind,true);
  assert.equal(openHooks(false,'test').rewind,false);
  assert.equal(openHooks(true,'course').rewind,false);
  assert.equal(openHooks(false,'course').rewind,false);
});
function publisher(rows, route, verify){
  const nodes = new Map([['ed-pub',{disabled:false}],['ed-title',{value:'確認コース'}]]);
  const added=[], messages=[];
  const ctx = {$:id=>nodes.get(id),editor:{rows:rows.slice(),cleared:true,clearProof:{rows:rows.join('\n'),route,method:'ordinary-replay-v1'}},
    activeDraftId:'a',social:{uid:'operator',isOwner:true,db:{collection:()=>({add:async doc=>added.push(doc)})}},
    verifyCourseRoute:verify,updatePubBtn(){},toast:t=>messages.push(t),edKind:()=>'',setTab(){},setSort(){},showAccountHint(){}};
  vm.createContext(ctx);vm.runInContext(html.slice(html.indexOf('async function publishCourse(){'),html.indexOf('/* ---------- course list ---------- */')),ctx);
  return {ctx,added,messages};
}
test('publication replays the witness and blocks a forged shortcut despite a prior clear flag', async () => {
  const rows=course(),h=setup(rows),g=h.game;g.jump();h.tick(5);g._warp(37*32,400);h.tick(1);
  const p=publisher(rows,g.route,h.verify);await p.ctx.publishCourse();
  assert.equal(p.added.length,0);assert.equal(p.ctx.editor.cleared,false);
});
test('publication accepts a verified continuous ordinary route', async () => {
  const rows=course(),h=setup(rows),g=h.game;g.jump();h.until(()=>g.state==='clear');
  const p=publisher(rows,g.route,h.verify);await p.ctx.publishCourse();
  assert.equal(p.added.length,1);assert.deepEqual(plain(p.added[0].rows),rows);
});
test('a course edit, account switch or role loss during publication cancels it', async () => {
  for(const change of [p=>p.ctx.editor.rows[5]='.'.repeat(39)+'#',p=>p.ctx.activeDraftId='other',p=>p.ctx.social.uid='other',p=>p.ctx.social.isOwner=false]){
    let p; p=publisher(course(),[{type:'jump'}],async (_r,_log,stale)=>{change(p);return !stale();});
    await p.ctx.publishCourse();assert.equal(p.added.length,0);
  }
});

test('saved checkpoint survives a fresh engine and completes a legal ordinary route', async () => {
  let saved;const rows=course(),h=setup(rows,{onSaveCheckpoint:p=>{saved=plain(p);}}),g=h.game;
  g.jump();h.tick(80);g.jump();g.mark();const expected=plain(g.inspect());
  const next=setup(rows,{checkpoint:JSON.parse(JSON.stringify(saved))});
  assert.equal(next.game.state,'ready');assert.ok(next.game.rewindInfo.checkpoint);
  assert.equal(next.game.restoreCheckpoint(),true);assert.deepEqual(plain(next.game.inspect()),expected);
  next.game.resume();next.until(()=>next.game.state==='clear');
  assert.equal(await next.verify(rows,next.game.route),true);
  next.game.reset();assert.equal(next.game.restoreCheckpoint(),true);
});
test('only a successful explicit save replaces the saved checkpoint', () => {
  let allow=true;const h=setup(course(),{onSaveCheckpoint:()=>allow}),g=h.game;
  g.jump();h.tick(40);g.mark();const first=plain(g.inspect());
  h.tick(50);allow=false;assert.equal(g.mark(),false);g.restoreCheckpoint();assert.deepEqual(plain(g.inspect()),first);
  g.resume();h.tick(30);allow=true;assert.equal(g.mark(),true);const second=plain(g.inspect());
  g.reset();g.restoreCheckpoint();assert.deepEqual(plain(g.inspect()),second);
});
test('changed courses and corrupt saved routes cannot restore a checkpoint', () => {
  let saved;const rows=course(),h=setup(rows,{onSaveCheckpoint:p=>saved=plain(p)});
  h.game.jump();h.tick(40);h.game.mark();
  const changed=rows.slice();changed[0]='#'.repeat(40);
  assert.equal(setup(changed,{checkpoint:saved}).game.restoreCheckpoint(),false);
  for(const route of [[{type:'frame',dt:100}], [{type:'warp'}], []]){
    assert.equal(setup(rows,{checkpoint:{...saved,route}}).game.restoreCheckpoint(),false);
  }
});

test('saved points persist per course and account, and quota errors keep the previous point', () => {
  const values=new Map(), messages=[];
  let fail=false;
  const ctx={current:{mode:'test',draftId:'a'},social:{isOwner:true},localOwner:'owner',localMemory:new Map(),
    hamsterKey:(uid,key)=>`${uid}:${key}`,toast:m=>messages.push(m),
    localStorage:{setItem(k,v){if(fail)throw Error('quota');values.set(k,v);}},
    store:{get(k){return JSON.parse(values.get(`${ctx.localOwner}:${k}`)||'null');}}};
  vm.createContext(ctx);vm.runInContext(html.slice(html.indexOf('function savedTestCheckpoint('),html.indexOf('function closePlayer()')),ctx);
  assert.equal(ctx.saveTestCheckpoint({dist:12}),true);
  ctx.current.draftId='b';assert.equal(ctx.saveTestCheckpoint({dist:24}),true);
  assert.equal(ctx.savedTestCheckpoint('a').dist,12);assert.equal(ctx.savedTestCheckpoint('b').dist,24);
  ctx.localOwner='other';assert.equal(ctx.savedTestCheckpoint('a'),null);ctx.localOwner='owner';
  ctx.current.draftId='a';fail=true;assert.equal(ctx.saveTestCheckpoint({dist:99}),false);
  assert.equal(ctx.savedTestCheckpoint('a').dist,12);
  fail=false;assert.equal(ctx.saveTestCheckpoint({dist:99}),true);assert.equal(ctx.savedTestCheckpoint('a').dist,99);
  ctx.social.isOwner=false;assert.equal(ctx.saveTestCheckpoint({dist:100}),false);
});
