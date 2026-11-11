const {test}=require('node:test'),assert=require('node:assert/strict'),B=require('../bamboo.js');
const clear=(b,mode,n,counted=true)=>b.finish(b.begin(mode,n,'course-'+n,'you',counted),'clear',5);
test('challenge crown requires every real floor; debug completion cannot award it',()=>{
 const b=B.create();for(let n=1;n<=10;n++)clear(b,'challenge',n,false);
 assert.equal(b.state.rewards.bambooCrown,false);
 for(let n=1;n<10;n++)clear(b,'challenge',n);assert.equal(b.state.rewards.bambooCrown,false);
 clear(b,'challenge',10);assert.equal(b.state.rewards.bambooCrown,true);
 assert.equal(B.create(JSON.parse(JSON.stringify(b.state))).state.rewards.bambooCrown,true);
});
test('axe requires a complete genuine run, survives restart and reload',()=>{
 const b=B.create({cleared:10});b.switchMode('marathon');
 for(let n=1;n<=10;n++)clear(b,'marathon',n,n!==5);
 assert.equal(b.state.rewards.bambooCrownPurple,false);b.restart();
 for(let n=1;n<=10;n++){
  if(n===4||n===8)b.finish(b.begin('marathon',n,'course-'+n),'miss');
  clear(b,'marathon',n);
 }
 assert.equal(b.state.marathon.misses,2);assert.equal(b.state.rewards.bambooCrownPurple,true);
 b.restart();assert.equal(B.create(JSON.parse(JSON.stringify(b.state))).state.rewards.bambooCrownPurple,true);
});
test('three misses reset reward run progress and require all floors again',()=>{
 const b=B.create({cleared:10});b.switchMode('marathon');clear(b,'marathon',1);
 for(let i=0;i<3;i++)b.finish(b.begin('marathon',2,'course-2'),'miss');
 b.restart();assert.equal(b.state.marathonRewardSteps,0);assert.equal(b.state.rewards.bambooCrownPurple,false);
});
test('course display names strip only the bamboo floor prefix',()=>{
 assert.equal(B.courseLabel('バンブー1 竹の子'),'竹の子');
 assert.equal(B.courseLabel('バンブー１０　竹の頂'),'竹の頂');
 assert.equal(B.courseLabel('竹の子'),'竹の子');
});
