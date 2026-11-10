const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const html=fs.readFileSync(require('node:path').join(__dirname,'../index.html'),'utf8');
test('PC shortcuts respect typing, overlays and held keys',()=>{
 let handler,jumps=0,shots=0,erases=0;
 const nodes={'overlay':{hidden:false},'sheet-bg':{hidden:true},'course-editor':{hidden:false},'ed-eraser':{click(){erases++;}}};
 const ctx={$:id=>nodes[id],tab:'make',addEventListener:(_,fn)=>handler=fn,inBattle:()=>false,game:{fireLauncher(){shots++;}},press(){jumps++;},closePlayer(){},closeSheet(){}};
 const start=html.indexOf("addEventListener('keydown', e => {");
 vm.runInNewContext(html.slice(start,html.indexOf('/* ---------- sheets',start)),ctx);
 const key=(code,extra={})=>handler({code,target:{closest:()=>false},preventDefault(){},...extra});
 key('Space');key('Space',{repeat:true});key('KeyG');key('KeyG',{repeat:true});
 assert.equal(jumps,1);assert.equal(shots,1);key('KeyE');assert.equal(erases,0);
 nodes.overlay.hidden=true;key('KeyE');assert.equal(erases,1);
 key('KeyE',{target:{closest:()=>true}});key('KeyE',{ctrlKey:true});key('KeyE',{isComposing:true});
 nodes['sheet-bg'].hidden=false;key('KeyE');assert.equal(erases,1);
});
test('right dragging pans at the current zoom without painting or saving edits',()=>{
 const handlers={},canvas={style:{},getBoundingClientRect:()=>({width:640,left:0}),setPointerCapture(){},addEventListener:(name,fn)=>handlers[name]=fn};
 let painted=0,saved=0,undone=0;
 const ctx={$:()=>canvas,editor:{cam:100,cols:10,rows:['...'],mode:'course',tool:'#'},viewW:()=>320,drawEditor(){ctx.editor.cam=Math.max(0,Math.min(500,ctx.editor.cam));},paintEditorCell(){painted++;},editorSnapshot:()=>({rows:['...']}),cellFrom:()=>[0,0],pushUndo(){undone++;},saveDraft(){saved++;},updatePubBtn(){}};
 const start=html.indexOf('let painting = false,');
 vm.runInNewContext(html.slice(start,html.indexOf("edCv.addEventListener('wheel'",start)),ctx);
 const event=(extra={})=>({pointerId:1,pointerType:'mouse',button:2,buttons:2,clientX:200,clientY:100,preventDefault(){},...extra});
 handlers.pointerdown(event());handlers.pointermove(event({clientX:100}));assert.equal(ctx.editor.cam,150);
 handlers.pointerup(event());handlers.pointermove(event({clientX:0}));assert.equal(ctx.editor.cam,150);
 assert.equal(painted,0);assert.equal(saved,0);assert.equal(undone,0);assert.equal(canvas.style.cursor,'');
 handlers.pointerdown(event());handlers.lostpointercapture(event());handlers.pointermove(event({clientX:0}));assert.equal(ctx.editor.cam,150);
 handlers.pointerdown(event({button:0,buttons:1}));handlers.pointerup(event({button:0,buttons:0}));assert.equal(painted,1);assert.equal(saved,1);
});
