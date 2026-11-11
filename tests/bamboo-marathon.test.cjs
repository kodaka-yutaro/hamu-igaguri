const {test}=require('node:test'),assert=require('node:assert/strict');
const Bamboo=require('../bamboo.js');
const unlocked=()=>Bamboo.create({cleared:10,mode:'marathon'});
function play(b,mode,n,result='clear',who='you',course='same-course',sec=3){const id=b.begin(mode,n,course,who);assert.ok(id);return b.finish(id,result,sec);}
test('all floors are browsable but challenge play and marathon switching respect unlocks',()=>{
 const b=Bamboo.create();for(let n=1;n<=10;n++){assert.equal(b.select(n),true);assert.equal(b.canPlay('challenge',n),n===1);}
 assert.equal(b.switchMode('marathon'),false);assert.equal(b.begin('challenge',2,'course'),null);
 for(let n=1;n<=10;n++){play(b,'challenge',n);assert.equal(b.unlocked(),n===10);}
 assert.equal(b.switchMode('marathon'),true);assert.equal(b.state.selected,1);
});
test('hamster progress is independent of selected floor, including locked and already cleared floors',()=>{
 const b=Bamboo.create();play(b,'challenge',1);play(b,'challenge',2);
 for(const n of [1,10,2,8]){b.select(n);assert.equal(b.top(),3);}
 play(b,'challenge',1);assert.equal(b.top(),3);
});
test('marathon only permits its current floor and retains misses between floors',()=>{
 const b=unlocked();assert.equal(b.begin('marathon',2,'course'),null);
 play(b,'marathon',1,'miss');play(b,'marathon',1);assert.equal(b.top(),2);assert.equal(b.state.marathon.misses,1);
 for(const n of [1,3,10])assert.equal(b.canPlay('marathon',n),false);
 assert.equal(b.canPlay('marathon',2),true);
});
test('third miss blocks retries, shows all three crosses, and requires a new run from floor one',()=>{
 const b=unlocked();play(b,'marathon',1);play(b,'marathon',2,'miss');play(b,'marathon',2,'miss');
 assert.equal(b.state.marathon.misses,2);assert.equal(b.top(),2);
 const over=play(b,'marathon',2,'miss');assert.equal(over.gameOver,true);assert.equal(b.top(),1);assert.equal(b.state.marathon.misses,3);
 assert.equal(b.begin('marathon',1,'course'),null);assert.equal(b.restart(),true);assert.equal(b.top(),1);assert.equal(b.state.marathon.misses,0);
 assert.equal(b.state.cleared,10);assert.equal(b.stats('marathon',2,'same-course').attempts,3);
});
test('mode switching and reload preserve a run and its mistakes, including game over',()=>{
 let b=unlocked();play(b,'marathon',1);play(b,'marathon',2,'miss');
 b.switchMode('challenge');b.switchMode('marathon');b=Bamboo.create(JSON.parse(JSON.stringify(b.state)));
 assert.equal(b.top(),2);assert.equal(b.state.marathon.misses,1);
 play(b,'marathon',2,'miss');play(b,'marathon',2,'miss');b=Bamboo.create(b.state);
 assert.equal(b.state.marathon.misses,3);assert.equal(b.canPlay('marathon',1),false);
});
test('same source course has independent stats per mode and floor; repeat clears count one clearer',()=>{
 const b=Bamboo.create();play(b,'challenge',1,'miss');play(b,'challenge',1,'clear','you','same-course',5);play(b,'challenge',1,'clear','you','same-course',4);
 assert.deepEqual([b.stats('challenge',1,'same-course').attempts,b.stats('challenge',1,'same-course').clears,b.stats('challenge',1,'same-course').people,b.stats('challenge',1,'same-course').best],[3,2,1,4]);
 assert.equal(b.stats('marathon',1,'same-course').rate,null);assert.equal(b.stats('challenge',7,'same-course').rate,null);
 for(let n=2;n<=10;n++)play(b,'challenge',n);
 b.switchMode('marathon');play(b,'marathon',1,'clear','other','same-course',2);
 assert.equal(b.stats('marathon',1,'same-course').rate,100);assert.ok(Math.abs(b.stats('challenge',1,'same-course').rate-200/3)<1e-10);
 assert.equal(b.stats('challenge',1,'new-course').rate,null);
});
test('duplicate callbacks do not duplicate misses, statistics, or progress',()=>{
 const b=unlocked(),id=b.begin('marathon',1,'course');assert.equal(b.begin('marathon',1,'course'),null);
 b.finish(id,'miss');assert.equal(b.finish(id,'miss'),null);assert.equal(b.finish(id,'clear'),null);
 assert.equal(b.state.marathon.misses,1);assert.equal(b.stats('marathon',1,'course').attempts,1);assert.equal(b.stats('marathon',1,'course').clears,0);
});
test('an abandoned or refreshed attempt is counted once without using a life or clearing the floor',()=>{
 let b=unlocked();b.begin('marathon',1,'course');b.abandon();assert.equal(b.state.marathon.misses,0);
 b.begin('marathon',1,'course');b=Bamboo.create(b.state);assert.equal(b.state.active,null);
 assert.equal(b.stats('marathon',1,'course').attempts,2);assert.equal(b.stats('marathon',1,'course').clears,0);assert.equal(b.top(),1);
});
test('tenth-floor marathon clear finishes the run; replay starts a fresh run without erasing records',()=>{
 const b=unlocked();for(let n=1;n<=10;n++)play(b,'marathon',n);
 assert.equal(b.state.marathon.finished,true);assert.equal(b.top(),10);assert.equal(b.canPlay('marathon',10),false);
 assert.equal(b.restart(),true);assert.equal(b.state.marathon.finished,false);assert.equal(b.top(),1);
 assert.equal(b.stats('marathon',10,'same-course').people,1);
});
test('preview operations exercise progression and misses without affecting stats',()=>{
 const b=Bamboo.create();for(let n=1;n<=10;n++){const id=b.begin('challenge',n,'c','preview',false);b.finish(id,'clear');}
 b.switchMode('marathon');for(let i=0;i<3;i++){const id=b.begin('marathon',1,'c','preview',false);b.finish(id,'miss');}
 assert.equal(b.state.marathon.misses,3);assert.deepEqual(b.state.stats,{});
});
test('invalid saved progression never opens locked marathon or out-of-range floors',()=>{
 const b=Bamboo.create({cleared:-4,mode:'marathon',selected:100,marathon:{floor:40,misses:-1}});
 assert.equal(b.state.mode,'challenge');assert.equal(b.state.selected,1);assert.equal(b.canPlay('marathon',1),false);
 for(const n of [0,11,NaN,1.5])assert.equal(b.select(n),false);
});
