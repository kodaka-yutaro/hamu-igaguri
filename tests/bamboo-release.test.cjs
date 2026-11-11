const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const html=fs.readFileSync(__dirname+'/../index.html','utf8'),B=require('../bamboo.js');
const data={window:{}};vm.runInNewContext(fs.readFileSync(__dirname+'/../bamboo-courses.js','utf8'),data);const courses=data.window.HAMU_BAMBOO_COURSES;
function setup(now){
 const nodes=new Map(),avatars=[];const el=(tag,p={},...children)=>Object.assign({children,style:{},dataset:{},classList:{toggle(){}},setAttribute(){},append(...xs){this.children.push(...xs)},replaceChildren(...xs){this.children=xs},addEventListener(){},scrollIntoView(){}},p);
 const $=id=>{if(!nodes.has(id))nodes.set(id,el('div'));return nodes.get(id)};
 const floors=Array.from({length:10},(_,i)=>el('button',{dataset:{floor:10-i}}));$('bamboo-tower').querySelectorAll=()=>floors;
 const ctx={window:{HAMU_BAMBOO_COURSES:courses},HamuBamboo:B,Date:class extends Date{static now(){return now}},$ ,el,store:{get:()=>null,set(){}},setInterval(){},requestAnimationFrame:f=>f(),document:{querySelector:()=>({})},social:{people:new Map()},paintAvatar:(cv,look)=>avatars.push({cv,look}),myLook:()=>({hat:'none'}),cleanBossLook:x=>x,courseCard:(c,context)=>({c,context}),toast(){},performance:{now:()=>0}};
 vm.createContext(ctx);vm.runInContext(html.slice(html.indexOf('/* ---------- Bamboo house event sample ---------- */'),html.indexOf('/* ---------- tabs & render ---------- */')),ctx);return {ctx,$,avatars};
}
test('all ten operator courses retain stable identities and the final boss settings',()=>{
 assert.equal(courses.length,10);assert.equal(new Set(courses.map(c=>c.id)).size,10);
 courses.forEach((c,i)=>{assert.equal(c.floor,i+1);assert.equal(c.rows.length,16);assert.ok(c.rows.every(r=>r.length===c.rows[0].length));assert.ok(!c.title.startsWith('バンブー'));});
 assert.equal(courses[0].title,'竹の子');assert.equal(courses[9].title,'竹になったあの子');assert.equal(courses[9].boss.hp,30);
});
test('release opens exactly at November 15 10:00 JST, with no premature floor play',()=>{
 const at=Date.parse('2026-11-15T10:00:00+09:00');
 let h=setup(at-1);assert.equal(vm.runInContext('bambooReleased()',h.ctx),false);h.ctx.openBamboo();assert.equal(vm.runInContext("bambooCanPlay('challenge',1)",h.ctx),false);
 h=setup(at);assert.equal(vm.runInContext('bambooReleased()',h.ctx),true);assert.equal(vm.runInContext("bambooCanPlay('challenge',1)",h.ctx),true);
 h.ctx.openBamboo();assert.deepEqual(h.avatars.find(x=>x.cv===h.$('bamboo-boss-marker')).look,courses[9].boss.look);
 assert.equal(h.$('bamboo-marker').style.bottom,'5%');h.ctx.selectBambooFloor(10);assert.equal(h.$('bamboo-marker').style.bottom,'5%');
});
test('shared course statistics remain separate by event mode',()=>{
 const h=setup(Date.parse('2026-11-16T00:00Z')),key=JSON.stringify(['challenge',1,courses[0].id]);
 h.ctx.social.people.set('other',{bambooGreenFamily:{stats:{[key]:{attempts:4,clears:1,players:{other:12}}}}});
 assert.equal(h.ctx.bambooCombinedStats('challenge',1,courses[0].id).people,1);assert.equal(h.ctx.bambooCombinedStats('marathon',1,courses[0].id).attempts,0);
});

test('operator settings save all floors and selected boss appearance, reject non-operator writes',async()=>{
 const h=setup(Date.parse('2026-11-16T00:00Z'));h.ctx.HamuBoss=require('../boss.js');h.ctx.HamuDecorations=require('../decorations.js');h.ctx.renderAll=()=>{};
 const boss=JSON.parse(JSON.stringify(courses[9]));boss.id='custom-boss';boss.boss.look.body='#112233';boss.official=true;
 let saved=null;Object.assign(h.ctx.social,{isOwner:true,canWrite:true,courses:[boss],db:{doc:p=>{assert.equal(p,'meta/bamboo-green-family');return {set:async data=>{saved=data;}};}}});
 vm.runInContext('bambooSettingsLoaded=true;renderBambooSettings()',h.ctx);
 h.$('bamboo-setting-10').value=boss.id;
 // The minimal DOM mock indexes nodes separately from el().
 for(let n=1;n<10;n++)h.$('bamboo-setting-'+n).value=courses[n-1].id;
 await h.$('bamboo-settings-save').onclick();assert.equal(Object.keys(saved.courses).length,10);
 h.ctx.renderBamboo();assert.equal(h.avatars.findLast(x=>x.cv===h.$('bamboo-boss-marker')).look.body,'#112233');
 h.ctx.social.isOwner=false;saved=null;await h.$('bamboo-settings-save').onclick();assert.equal(saved,null);
});
test('invalid final floor and failed save preserve existing assignments',async()=>{
 const h=setup(Date.parse('2026-11-16T00:00Z'));h.ctx.HamuBoss=require('../boss.js');h.ctx.HamuDecorations=require('../decorations.js');h.ctx.renderAll=()=>{};
 assert.equal(h.ctx.normalizeBambooCourse(courses[0],10),null);
 Object.assign(h.ctx.social,{isOwner:true,canWrite:true,courses:[],db:{doc:()=>({set:async()=>{throw Error('offline')}})}});
 vm.runInContext('bambooSettingsLoaded=true;bambooSettingsDirty=true',h.ctx);
 for(let n=1;n<=10;n++)h.$('bamboo-setting-'+n).value=courses[n-1].id;
 await h.$('bamboo-settings-save').onclick();assert.match(h.$('bamboo-settings-status').textContent,/保存できません/);assert.equal(vm.runInContext('bambooSettingsDirty',h.ctx),true);assert.equal(vm.runInContext('bambooCourse(10).id',h.ctx),courses[9].id);
});
