const test = require('node:test');
const assert = require('node:assert/strict');
const decoration = require('../decorations.js');

const rows = Array.from({length:16},()=>'.'.repeat(40));

test('one anchor cell holds one decoration and latest overlapping placement is on top',()=>{
  let a=[];
  a=decoration.place(rows,a,10,8,'a',5);
  a=decoration.place(rows,a,11,8,'b',3);
  assert.deepEqual(a.map(d=>d.key),['a','b']);
  a=decoration.place(rows,a,10,8,'c',1);
  assert.deepEqual(a.map(d=>d.key),['b','c']);
  assert.equal(a.length,2);
  assert.deepEqual(a[1],{x:10,y:8,key:'c',size:1});
  assert.equal(decoration.place(rows,a,10,8,'c',1),a,'unchanged stroke must not reorder');
  a=decoration.place(rows,a,11,8,'.',1);
  assert.deepEqual(a.map(d=>d.key),['c']);
  assert.equal(rows[8][11],'.','course parts remain untouched');
});

test('legacy decoration tiles become one-cell overlays without deleting any course parts',()=>{
  const original=rows.slice();
  original[5]='..a..#'+'.'.repeat(34);
  const result=decoration.fromCourse({rows:original,decorations:[{x:5,y:5,key:'n',size:5}]});
  assert.equal(result.rows[5][2],'.');
  assert.equal(result.rows[5][5],'#');
  assert.deepEqual(result.decorations,[{x:2,y:5,key:'a',size:1},{x:5,y:5,key:'n',size:5}]);
  assert.equal(original[5][2],'a','loading does not mutate saved input');
});

test('invalid positions and oversized images do not persist',()=>{
  const valid={x:4,y:8,key:'a',size:3};
  assert.deepEqual(decoration.normalize(rows,[valid,{...valid,size:2},{x:-1,y:2,key:'a',size:5},{x:3,y:16,key:'a',size:5}]),[valid]);
});

test('resizing a course moves only right-end decorations and discards cropped ones',()=>{
  const items=[{x:10,y:8,key:'a',size:1},{x:35,y:8,key:'b',size:3},{x:38,y:8,key:'c',size:5}];
  const wide=Array.from({length:16},()=>'.'.repeat(80));
  assert.deepEqual(decoration.resized(wide,items,40,80).map(d=>d.x),[10,35,78]);
  const narrow=Array.from({length:16},()=>'.'.repeat(40));
  assert.deepEqual(decoration.resized(narrow,[{x:10,y:8,key:'a',size:1},{x:75,y:8,key:'b',size:3},{x:78,y:8,key:'c',size:5}],80,40).map(d=>d.x),[10,38]);
});

test('differing overlays participate in draft synchronization conflict detection',()=>{
  const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
  const src=fs.readFileSync(path.join(__dirname,'../backend.js'),'utf8').split('// Private, revision-checked')[0];
  const ctx={window:{},setTimeout,clearTimeout};vm.runInNewContext(src,ctx);
  const {fileSignature,normalize}=ctx.window.HamuCourseLibrary;
  const base={rows,title:'Test',updatedAt:0};
  const changed={...base,decorations:[{x:10,y:8,key:'a',size:3}]};
  assert.notEqual(fileSignature(base),fileSignature(changed));
  assert.ok(normalize({format:2,files:{test:changed}}).files.test.decorations);
});
