const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');

test('two fast touchscreen presses fire twice, without duplicate synthetic clicks',()=>{
  const start=html.indexOf('let lastLauncherPointerAt=-Infinity;');
  const end=html.indexOf('// battle buttons react on touch-down',start);
  assert.ok(start>0 && end>start);
  let now=1000,fired=0,prevented=0,stopped=0;
  const button={};
  const context={
    $:()=>button,
    game:{fireLauncher(){fired++;}},
    performance:{now:()=>now},
  };
  vm.runInNewContext(html.slice(start,end),context);
  const touch=()=>({pointerType:'touch',button:0,preventDefault(){prevented++;},stopPropagation(){stopped++;}});
  const click=detail=>({detail,stopPropagation(){stopped++;}});
  button.onpointerdown(touch());button.onclick(click(1));
  assert.equal(fired,1,'first tap fires once');
  now+=130;
  button.onpointerdown(touch());button.onclick(click(1));
  assert.equal(fired,2,'second quick tap fires exactly one more shot');
  assert.equal(prevented,2);
  assert.equal(stopped,4);
  now+=600;
  button.onclick(click(0));
  assert.equal(fired,3,'keyboard activation still uses the click fallback');
});

test('launcher button remains visible after the first of two shots',()=>{
  const start=html.indexOf('function showLauncherAmmo(n, cost=0){');
  const end=html.indexOf('function openPlayer(',start);
  const button={hidden:true,textContent:'',setAttribute(k,v){this[k]=v;}};
  const context={$:()=>button};
  vm.runInNewContext(html.slice(start,end),context);
  context.showLauncherAmmo(2);
  assert.equal(button.hidden,false);assert.match(button.textContent,/×2/);
  context.showLauncherAmmo(1);
  assert.equal(button.hidden,false);assert.match(button.textContent,/×1/);
  context.showLauncherAmmo(0);
  assert.equal(button.hidden,true);
  context.showLauncherAmmo(7,2);assert.equal(button.hidden,false);assert.equal(button['aria-label'],'どんぐりを前方に発射（ライフ2消費）');
});
