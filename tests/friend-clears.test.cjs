const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const html=require('node:fs').readFileSync(require('node:path').join(__dirname,'../index.html'),'utf8');
function setup(){
  const social={uid:'me',people:new Map([['me',{following:['me','friend','oneway','uncleared','invalid'],clears:{c:1}}],
    ['friend',{name:'ハム',following:['me'],clears:{c:12}}],['oneway',{following:[],clears:{c:2}}],
    ['follower',{following:['me'],clears:{c:3}}],['uncleared',{following:['me'],clears:{other:1}}],
    ['invalid',{following:['me'],clears:{c:false}}]])};
  const c={social,personOf:id=>social.people.get(id),nameOf:id=>social.people.get(id)?.name||id,
    whoChip:id=>({profile:id}),el:(tag,props,...children)=>({tag,props,children})};
  vm.createContext(c);vm.runInContext(html.slice(html.indexOf('const following = uid'),html.indexOf('// how many players cleared')),c);return c;
}
test('only mutual friends with an actual clear of this course appear',()=>{
  const c=setup();assert.deepEqual(Array.from(c.friendsWhoCleared('c')),['friend']);
  for(const invalid of [null,false,true,'',Infinity,NaN,-1,'3']){
    c.social.people.get('invalid').clears.c=invalid;assert.equal(c.friendsWhoCleared('c').length,1);
  }
  c.social.uid=null;assert.equal(c.friendClearDisplay('c'),null);
});
test('new clears, unfriending and account changes update the next render',()=>{
  const c=setup();c.social.people.get('uncleared').clears.c=0;assert.equal(c.friendsWhoCleared('c').length,2);
  c.social.people.get('friend').following=[];assert.deepEqual(Array.from(c.friendsWhoCleared('c')),['uncleared']);
  c.social.uid='follower';assert.equal(c.friendClearDisplay('c'),null);
});
test('cards summarize names while course details include every friend profile',()=>{
  const c=setup();for(let i=0;i<5;i++){
    const id='extra'+i;c.social.people.get('me').following.push(id);c.social.people.set(id,{name:id,following:['me'],clears:{c:5}});
  }
  const card=c.friendClearDisplay('c'),detail=c.friendClearDisplay('c',true);
  assert.equal(card.children[0].props.text,'ともだち 6人がクリア！');
  assert.match(card.children[1].props.text,/ほか3人/);
  assert.equal(detail.children[1].children.length,6);
  assert.equal(c.friendClearDisplay('unknown'),null);
});
