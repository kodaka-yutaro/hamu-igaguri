const assert = require('node:assert/strict');
const {test} = require('node:test');
const {readFileSync} = require('node:fs');
const vm = require('node:vm');
const code = readFileSync(require('node:path').join(__dirname, '../backend.js'), 'utf8');
const copy = x => JSON.parse(JSON.stringify(x));
function setup(){
  let row = {id:'a', data:{name:'ハム', courseRuns:{c:{one:{attempts:2,clears:1}}}}, updated_at:'1'};
  let race = true, updates = 0;
  const sb = {from(){
    let next, version;
    const q = {
      select(){ return next ? Promise.resolve(commit()) : q; },
      eq(k,v){if(k === 'updated_at') version = v; return q;},
      maybeSingle: async () => ({data:copy(row)}),
      update(v){next=v.data; return q;}
    };
    function commit(){
      updates++;
      if(race){race=false; row.data.name='別端末の名前'; row.data.courseRuns.c.two={attempts:3,clears:2}; row.updated_at='2';}
      if(version !== row.updated_at) return {data:[]};
      row={...row, data:copy(next), updated_at:String(+row.updated_at+1)};
      return {data:[{id:'a'}]};
    }
    return q;
  }};
  const ctx = {sb, bump(){}, listen(){}, uid:'a'}; vm.createContext(ctx);
  vm.runInContext(code.slice(code.indexOf('    const clone ='),code.indexOf('    // live updates:')),ctx);
  vm.runInContext(code.slice(code.indexOf('    function doc(path)'),code.indexOf('    const collection =')),ctx);
  return {ctx, row:()=>row, updates:()=>updates};
}
test('concurrent profile edits and another device count survive a write collision', async()=>{
  const h=setup();
  await h.ctx.doc('people/a').update({courseRuns:{c:{one:{attempts:3,clears:2}}}});
  assert.equal(h.updates(),2);
  assert.deepEqual(h.row().data,{name:'別端末の名前',courseRuns:{c:{one:{attempts:3,clears:2},two:{attempts:3,clears:2}}}});
});
test('late retry with older counters never lowers the persisted counts', async()=>{
  const h=setup();
  await h.ctx.doc('people/a').update({courseRuns:{c:{one:{attempts:1,clears:0}}}});
  assert.deepEqual(h.row().data.courseRuns.c.one,{attempts:2,clears:1});
});
test('people pagination includes players beyond the first 1000 rows',async()=>{
  const all=Array.from({length:2105},(_,i)=>({id:String(i),data:{}}));
  const ranges=[];
  const ctx={sb:{from(){const q={select(){return q},eq(){return q},order(){return q},async range(a,b){ranges.push([a,b]);return {data:all.slice(a,b+1)}}};return q;}},err:e=>e};
  vm.createContext(ctx);vm.runInContext(code.slice(code.indexOf('    async function readCol('),code.indexOf('    function query(')),ctx);
  assert.equal((await ctx.readCol('people')).length,2105);
  assert.deepEqual(ranges,[[0,999],[1000,1999],[2000,2999]]);
});
