/* Deterministic boss combat. Positions are viewport coordinates; no account state is read here. */
(function(root){
'use strict';
const attacks=['','イガグリ砲3発','縦一列ブロック','巨大イガグリ','急加速イガグリ配置','突進','ブロック壁5列','イガグリ砲10発'];
const minimumInterval = list => Math.max(...list.map(id=>id===5?4:id===7?3:id===4?2:id===1?1.3:1));
const defaults={hp:30,cycle:[1,2,2,1,5],interval:6,rageCycle:[7,6,4,3,5],rageInterval:4,look:{}};
function cycle(v){const a=Array.isArray(v)?v:String(v||'').trim().split(/[,、\s]+/).map(Number);return a.length>0&&a.length<=32&&a.every(n=>Number.isInteger(n)&&n>=1&&n<=7)?a.slice():null;}
function normalize(v){if(!v||typeof v!=='object')return null;const a=cycle(v.cycle),b=cycle(v.rageCycle),hp=Number(v.hp),interval=Number(v.interval),rageInterval=Number(v.rageInterval);if(!a||!b||!Number.isInteger(hp)||hp<1||hp>999||!Number.isFinite(interval)||interval<1||interval>60||!Number.isFinite(rageInterval)||rageInterval<1||rageInterval>60||interval<minimumInterval(a)||rageInterval<minimumInterval(b))return null;const look={};if(v.look&&typeof v.look==='object')for(const [k,x] of Object.entries(v.look))if(typeof x==='string'&&x.length<=32)look[k]=x;return {hp,cycle:a,interval,rageCycle:b,rageInterval,look};}
const overlap=(a,b)=>a.x<b.x+b.w&&a.x+a.w>b.x&&a.y<b.y+b.h&&a.y+a.h>b.y;
function create(config){
 const c=normalize(config);if(!c)throw new Error('Invalid boss configuration');
 let s;
 function reset(){s={hp:c.hp,maxHp:c.hp,time:0,x:320,y:256,rage:false,rageFlash:0,hitFlash:0,invincible:0,index:0,next:c.interval,warning:null,active:null,bullets:[],seq:0,executed:[]};}
 function rect(){return {x:s.x-48,y:s.y-48,w:96,h:96};}
 function shoot(size=32){s.bullets.push({id:++s.seq,kind:'burr',x:s.x-48-size,y:s.y-size/2+6,w:size,h:size,vx:-170,age:0});}
 function wall(count){for(let col=0;col<count;col++)for(let row=0;row<16;row++)s.bullets.push({id:++s.seq,kind:'block',x:320+col*32,y:row*32,w:32,h:32,vx:-85,age:0});}
 function launch(id){s.executed.push(id);if(s.executed.length>32)s.executed.shift();s.active={id,time:0,sent:0,y:s.y,phase:'attack'};if(id===2||id===6){wall(id===6?5:1);s.active=null;}if(id===3){shoot(64);s.active=null;}}
 function update(dt,player){
  if(s.hp<=0)return 0;
  s.time+=dt;s.invincible=Math.max(0,s.invincible-dt);s.hitFlash=Math.max(0,s.hitFlash-dt);s.rageFlash=Math.max(0,s.rageFlash-dt);
  if(!s.active && !(s.warning&&s.warning.id===5))s.y=256+Math.sin(s.time*.55)*150;
  if(!s.active && !s.warning && s.time>=s.next-0.8){const list=s.rage?c.rageCycle:c.cycle;s.warning={id:list[s.index%list.length],until:s.next};}
  if(s.warning && s.time>=s.warning.until){const id=s.warning.id;s.warning=null;s.index++;s.next+=s.rage?c.rageInterval:c.interval;launch(id);}
  const a=s.active;
  if(a){a.time+=dt;
   if(a.id===1||a.id===7){const count=a.id===1?3:10;while(a.sent<count&&a.time>=a.sent*.22){shoot();a.sent++;}if(a.sent===count)s.active=null;}
   if(a.id===4){s.y=256+Math.sin(a.time*9)*150;while(a.sent<15&&a.time>=a.sent*.08){s.bullets.push({id:++s.seq,kind:'burr',x:s.x-64,y:s.y-10,w:32,h:32,vx:-110,age:0});a.sent++;}if(a.time>=1.2)s.active=null;}
   if(a.id===5){
    if(a.phase==='attack'){s.x-=760*dt;if(s.x<-48){s.x=-60;a.phase='wait';a.time=0;}}
    else if(a.phase==='wait'){if(a.time>=2){s.x=380;a.phase='return';}}
    else {s.x=Math.max(320,s.x-180*dt);if(s.x===320)s.active=null;}
   }
  }
  // A long attack finishes before the next wind-up; missed starts are not replayed in a burst.
  if(!s.active&&!s.warning&&s.next<s.time+.8)s.next=s.time+.8;
  let damage=0;
  for(const b of s.bullets){b.x+=b.vx*dt;b.age+=dt;if(player&&s.invincible<=0&&overlap(player,b)){damage=3;s.invincible=.9;if(b.kind==='burr')b.gone=true;}}
  if(player&&s.invincible<=0&&overlap(player,rect())){damage=3;s.invincible=.9;}
  s.bullets=s.bullets.filter(b=>!b.gone&&b.x+b.w>-40&&b.age<12);
  return damage;
 }
 function hit(x,y,r=7){
  if(s.hp<=0)return false;
  const shot={x:x-r,y:y-r,w:r*2,h:r*2};
  const block=s.bullets.find(b=>b.kind==='block'&&overlap(shot,b));
  if(block){s.bullets=s.bullets.filter(b=>b.kind!=='block'||Math.hypot(b.x+16-x,b.y+16-y)>55);return 'block';}
  if(overlap(shot,rect())){s.hp=Math.max(0,s.hp-1);s.hitFlash=.16;
   if(!s.rage && s.hp>0 && s.hp<c.hp/2){s.rage=true;s.rageFlash=1.3;s.index=0;s.warning=null;s.next=s.time+c.rageInterval;}
   return 'boss';
  }return false;
 }
 reset();return {reset,update,hit,rect,get state(){return s;},config:c};
}
function draw(ctx,boss,paintHam,look,drawBurr,drawBlock){
 const s=boss.state;
 for(const b of s.bullets){if(b.kind==='block')drawBlock(ctx,b.x,b.y,true);else{ctx.save();ctx.translate(b.x+b.w/2,b.y+b.h/2);ctx.scale(b.w/32,b.h/32);drawBurr(ctx,0,0,s.time);ctx.restore();}}
 if(s.hp<=0)return;
 ctx.save();ctx.translate(s.x,s.y);if(s.warning?.id===4)ctx.translate(0,Math.sin(s.time*95)*5);
 if(s.rage){ctx.shadowColor='#ff422b';ctx.shadowBlur=18;ctx.strokeStyle='#ff6c38';ctx.lineWidth=3;ctx.beginPath();ctx.ellipse(0,0,51,52,0,0,7);ctx.stroke();}
 if(s.active?.id===5&&s.active.phase==='attack'){ctx.fillStyle='#fff6';for(let i=0;i<4;i++)ctx.fillRect(20+i*12,-30+i*18,80,3);}
 // Fit the full costume into the 3x3 tile silhouette, facing left.
 ctx.scale(3.2,3.2);if(s.hitFlash>0)ctx.globalAlpha=.5;paintHam(ctx,look,false);ctx.restore();
 if(s.rage){ctx.fillStyle='#ff3929';ctx.font='bold 24px sans-serif';ctx.fillText('怒',Math.min(282,s.x-36),s.y-55);}
 const warn=s.warning;
 if(warn){const x=240,y=Math.max(90,s.y-85);ctx.save();ctx.fillStyle='#fffef2';ctx.strokeStyle='#4b3525';ctx.lineWidth=2;ctx.beginPath();ctx.ellipse(x,y,37,28,0,0,7);ctx.fill();ctx.stroke();for(let i=0;i<2;i++){ctx.beginPath();ctx.arc(x+20+i*9,y+25+i*9,5-i*2,0,7);ctx.fill();ctx.stroke();}
  if([1,3,7].includes(warn.id)){ctx.save();ctx.translate(x,y);ctx.scale(warn.id===3?1.35:.8,warn.id===3?1.35:.8);drawBurr(ctx,0,0,0);ctx.restore();if(warn.id!==3){ctx.fillStyle='#4b3525';ctx.font='bold 11px sans-serif';ctx.fillText('×'+(warn.id===7?10:3),x+10,y+17);}}
  else if(warn.id===2||warn.id===6){ctx.save();ctx.translate(x-10,y-14);ctx.scale(.65,.65);drawBlock(ctx,0,0,true);ctx.restore();ctx.fillStyle='#4b3525';ctx.font='bold 10px sans-serif';ctx.fillText(warn.id===6?'壁×5':'壁×1',x-14,y+20);}
  else{ctx.fillStyle='#d9412b';ctx.font='bold 25px sans-serif';ctx.fillText(warn.id===4?'↕':'!',x-9,y+8);}ctx.restore();
 }
 ctx.fillStyle='#24191cdd';ctx.fillRect(10,51,300,30);ctx.fillStyle=s.rage?'#fa593e':'#9bc553';ctx.fillRect(14,70,292*s.hp/s.maxHp,6);ctx.fillStyle='#fff';ctx.font='bold 11px sans-serif';ctx.fillText(`${s.rage?'怒りのボス':'BOSS'}  ${s.hp} / ${s.maxHp}`,17,64);
 if(s.rageFlash>0){ctx.fillStyle=`rgba(255,60,20,${s.rageFlash*.1})`;ctx.fillRect(0,0,320,512);ctx.fillStyle='#fff';ctx.strokeStyle='#a52117';ctx.lineWidth=4;ctx.font='bold 27px sans-serif';ctx.strokeText('怒りモード！',76,130);ctx.fillText('怒りモード！',76,130);}
}
const api={attacks,minimumInterval,defaults,cycle,normalize,create,draw};if(typeof module!=='undefined')module.exports=api;root.HamuBoss=api;
})(typeof window!=='undefined'?window:globalThis);
