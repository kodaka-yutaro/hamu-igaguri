/* Deterministic boss combat. Positions are viewport coordinates; no account state is read here. */
(function(root){
'use strict';
const attacks=['','イガグリ砲3発','縦一列ブロック','巨大イガグリ','急加速イガグリ配置','突進','ブロック壁5列','イガグリ砲10発'];
// Intervals measure the recovery after an attack, so even long attacks can use one second.
const minimumInterval = () => 1;
const defaults={hp:30,cycle:[1,2,2,1,5],interval:6,rageCycle:[7,6,4,3,5],rageInterval:4,look:{}};
function cycle(v){const a=Array.isArray(v)?v:String(v||'').trim().split(/[,、\s]+/).map(Number);return a.length>0&&a.length<=32&&a.every(n=>Number.isInteger(n)&&n>=1&&n<=7)?a.slice():null;}
function normalize(v){
 if(!v||typeof v!=='object')return null;
 const a=cycle(v.cycle),b=cycle(v.rageCycle),hp=Number(v.hp);
 if(!a||!b||!Number.isInteger(hp)||hp<1||hp>999)return null;
 // Read older courses by expanding their shared interval, without rewriting stored records.
 const waits=(values,legacy,n)=>{
  const xs=values===undefined?Array(n).fill(Number(legacy)):Array.isArray(values)?values.map(Number):[];
  return xs.length===n&&xs.every(x=>Number.isFinite(x)&&x>=1&&x<=60)?xs:null;
 };
 const intervals=waits(v.intervals,v.interval,a.length),rageIntervals=waits(v.rageIntervals,v.rageInterval,b.length);
 if(!intervals||!rageIntervals)return null;
 const look={};if(v.look&&typeof v.look==='object')for(const [k,x] of Object.entries(v.look))if(typeof x==='string'&&x.length<=32)look[k]=x;
 return {hp,cycle:a,intervals,rageCycle:b,rageIntervals,look};
}
const overlap=(a,b)=>a.x<b.x+b.w&&a.x+a.w>b.x&&a.y<b.y+b.h&&a.y+a.h>b.y;
function create(config){
 const c=normalize(config);if(!c)throw new Error('Invalid boss configuration');
 let s;
 function reset(){s={hp:c.hp,maxHp:c.hp,time:0,motionPhase:0,x:320,y:256,rage:false,rageFlash:0,hitFlash:0,invincible:0,index:0,next:c.intervals[0],warning:null,active:null,bullets:[],seq:0,executed:[]};}
 function rect(){return {x:s.x-48,y:s.y-48,w:96,h:96};}
 function shoot(size=32){s.bullets.push({id:++s.seq,kind:'burr',projectile:true,x:s.x-48-size,y:s.y-size/2+6,w:size,h:size,vx:-170,age:0});}
 function wall(count){for(let col=0;col<count;col++)for(let row=0;row<16;row++){
  const x=320+col*32,y=row*32;
  if(!s.bullets.some(b=>b.kind==='block'&&Math.abs(b.x-x)<1&&b.y===y))s.bullets.push({id:++s.seq,kind:'block',terrain:true,x,y,w:32,h:32,vx:0,age:0});
 }}
 function finish(){const wait=s.active.wait;s.active=null;s.next=s.time+wait;}
 function launch(id,wait){s.executed.push(id);if(s.executed.length>32)s.executed.shift();s.next=Infinity;s.active={id,wait,time:0,sent:0,started:s.time,phase:'attack'};if(id===2||id===6){wall(id===6?5:1);finish();}if(id===3){shoot(64);finish();}}
 // Placed walls and burrs share the course's scroll. Flying shots keep their own screen velocity.
 function scrollTerrain(dx){for(const b of s.bullets)if(b.terrain)b.x-=dx;}
 function update(dt,player){
  if(s.hp<=0)return 0;
  s.time+=dt;s.invincible=Math.max(0,s.invincible-dt);s.hitFlash=Math.max(0,s.hitFlash-dt);s.rageFlash=Math.max(0,s.rageFlash-dt);
  // Keep one continuous phase through bursts, sweeps, rage and rush recovery.
  // Pausing a rush's height also pauses its phase, so resuming cannot teleport vertically.
  if(s.active?.id!==5 && s.warning?.id!==5){s.motionPhase+=dt*(s.active?.id===4?9:.55);s.y=256+Math.sin(s.motionPhase)*150;}
  if(!s.active && !s.warning && s.time>=s.next-0.8){const list=s.rage?c.rageCycle:c.cycle,waits=s.rage?c.rageIntervals:c.intervals,i=s.index%list.length;s.warning={id:list[i],wait:waits[i],until:s.next};}
  if(s.warning && s.time>=s.warning.until){const {id,wait}=s.warning;s.warning=null;s.index++;launch(id,wait);}
  const a=s.active;
  if(a){a.time=s.time-a.started;
   if(a.id===1||a.id===7){const count=a.id===1?3:10;while(a.sent<count&&a.time>=a.sent*.22){shoot();a.sent++;}if(a.sent===count)finish();}
   if(a.id===4){while(a.sent<15&&a.time>=a.sent*.08){s.bullets.push({id:++s.seq,kind:'burr',terrain:true,x:s.x-64,y:s.y-10,w:32,h:32,vx:0,age:0});a.sent++;}if(a.time>=1.2)finish();}
   if(a.id===5){
    if(a.phase==='attack'){s.x-=760*dt;if(s.x<-48){s.x=-60;a.phase='wait';a.started=s.time;a.time=0;}}
    else if(a.phase==='wait'){if(a.time>=2){s.x=380;a.phase='return';}}
    else {s.x=Math.max(320,s.x-180*dt);if(s.x===320)finish();}
   }
  }
  let damage=0;
  for(const b of s.bullets){b.x+=b.vx*dt;b.age+=dt;if(b.kind!=='block'&&player&&s.invincible<=0&&overlap(player,b)){damage=3;s.invincible=.9;if(b.projectile)b.gone=true;}}
  if(player&&s.invincible<=0&&overlap(player,rect())){damage=3;s.invincible=.9;}
  s.bullets=s.bullets.filter(b=>!b.gone&&b.x+b.w>-40&&(b.terrain||b.age<12));
  return damage;
 }
 function hit(x,y,r=7){
  if(s.hp<=0)return false;
  const shot={x:x-r,y:y-r,w:r*2,h:r*2};
  const target=s.bullets.find(b=>!b.gone&&overlap(shot,b));
  if(target&&target.kind!=='block'){s.bullets=s.bullets.filter(b=>b!==target);return 'burr';}
  const block=target;
  if(block){s.bullets=s.bullets.filter(b=>b.kind!=='block'||Math.hypot(b.x+16-x,b.y+16-y)>55);return 'block';}
  if(overlap(shot,rect())){s.hp=Math.max(0,s.hp-1);s.hitFlash=.16;
   if(!s.rage && s.hp>0 && s.hp<c.hp/2){s.rage=true;s.rageFlash=1.3;s.index=0;s.warning=null;if(!s.executed.length)s.next=s.time+c.rageIntervals[0];}
   return 'boss';
  }return false;
 }
 reset();return {reset,update,hit,rect,scrollTerrain,get state(){return s;},config:c};
}
// Orange motion trails and a rotating red shell distinguish shots from brown course burrs.
function drawBurrShot(ctx,x,y,time,size=32){
 ctx.save();ctx.translate(x,y);ctx.scale(size/32,size/32);
 ctx.strokeStyle='#ffbc62';ctx.lineWidth=2.5;
 for(let i=-1;i<=1;i++){ctx.beginPath();ctx.moveTo(12,i*6);ctx.lineTo(25+Math.sin(time*22+i)*3,i*6);ctx.stroke();}
 ctx.rotate(-time*5);ctx.beginPath();
 for(let i=0;i<24;i++){const a=i*Math.PI/12,r=i%2?10:16;const px=Math.cos(a)*r,py=Math.sin(a)*r;if(i)ctx.lineTo(px,py);else ctx.moveTo(px,py);}
 ctx.closePath();ctx.fillStyle='#b83b26';ctx.strokeStyle='#622719';ctx.lineWidth=1.6;ctx.fill();ctx.stroke();
 ctx.beginPath();ctx.arc(0,0,7,0,Math.PI*2);ctx.fillStyle='#ffbc62';ctx.fill();ctx.stroke();
 ctx.fillStyle='#622719';ctx.fillRect(-3,-2,6,4);ctx.restore();
}
function draw(ctx,boss,paintHam,look,drawBurr,drawBlock){
 const s=boss.state;
 for(const b of s.bullets){if(b.kind==='block')drawBlock(ctx,b.x,b.y,true);else if(b.projectile)drawBurrShot(ctx,b.x+b.w/2,b.y+b.h/2,s.time,b.w);else{ctx.save();ctx.translate(b.x+b.w/2,b.y+b.h/2);ctx.scale(b.w/32,b.h/32);drawBurr(ctx,0,0,s.time);ctx.restore();}}
 if(s.hp<=0)return;
 ctx.save();ctx.translate(s.x,s.y);if(s.warning?.id===4)ctx.translate(0,Math.sin(s.time*95)*5);
 if(s.rage){ctx.shadowColor='#ff422b';ctx.shadowBlur=18;ctx.strokeStyle='#ff6c38';ctx.lineWidth=3;ctx.beginPath();ctx.ellipse(0,0,51,52,0,0,7);ctx.stroke();}
 if(s.active?.id===5&&s.active.phase==='attack'){ctx.fillStyle='#fff6';for(let i=0;i<4;i++)ctx.fillRect(20+i*12,-30+i*18,80,3);}
 // Fit the full costume into the 3x3 tile silhouette, facing left.
 ctx.scale(3.2,3.2);if(s.hitFlash>0)ctx.globalAlpha=.5;paintHam(ctx,look,false);ctx.restore();
 if(s.rage){ctx.fillStyle='#ff3929';ctx.font='bold 24px sans-serif';ctx.fillText('怒',Math.min(282,s.x-36),s.y-55);}
 const warn=s.warning;
 if(warn){const x=240,y=Math.max(90,s.y-85);ctx.save();ctx.fillStyle='#fffef2';ctx.strokeStyle='#4b3525';ctx.lineWidth=2;ctx.beginPath();ctx.ellipse(x,y,37,28,0,0,7);ctx.fill();ctx.stroke();for(let i=0;i<2;i++){ctx.beginPath();ctx.arc(x+20+i*9,y+25+i*9,5-i*2,0,7);ctx.fill();ctx.stroke();}
  if([1,3,7].includes(warn.id)){drawBurrShot(ctx,x,y,0,warn.id===3?38:24);if(warn.id!==3){ctx.fillStyle='#4b3525';ctx.font='bold 11px sans-serif';ctx.fillText('×'+(warn.id===7?10:3),x+10,y+17);}}
  else if(warn.id===2||warn.id===6){ctx.save();ctx.translate(x-10,y-14);ctx.scale(.65,.65);drawBlock(ctx,0,0,true);ctx.restore();ctx.fillStyle='#4b3525';ctx.font='bold 10px sans-serif';ctx.fillText(warn.id===6?'壁×5':'壁×1',x-14,y+20);}
  else{ctx.fillStyle='#d9412b';ctx.font='bold 25px sans-serif';ctx.fillText(warn.id===4?'↕':'!',x-9,y+8);}ctx.restore();
 }
 if(s.rageFlash>0){ctx.fillStyle=`rgba(255,60,20,${s.rageFlash*.1})`;ctx.fillRect(0,0,320,512);ctx.fillStyle='#fff';ctx.strokeStyle='#a52117';ctx.lineWidth=4;ctx.font='bold 27px sans-serif';ctx.strokeText('怒りモード！',76,130);ctx.fillText('怒りモード！',76,130);}
}
function drawHud(ctx,boss){
 const s=boss.state;ctx.save();ctx.fillStyle='#24191cdd';ctx.fillRect(204,12,108,30);
 ctx.fillStyle='#655454';ctx.fillRect(210,32,96,5);ctx.fillStyle=s.rage?'#fa593e':'#9bc553';ctx.fillRect(210,32,96*s.hp/s.maxHp,5);
 ctx.fillStyle='#fff';ctx.font='bold 9px sans-serif';ctx.fillText(`${s.rage?'怒 BOSS':'BOSS'}  ${s.hp}/${s.maxHp}`,210,25);ctx.restore();
}
function playerHp(power,dead=false){return dead?0:1+Math.max(0,Math.min(2,Math.floor(Number(power)||0)));}
function drawPlayerHud(ctx,power,dead=false){
 const hp=playerHp(power,dead),color=hp===3?'#b982ff':hp===2?'#ff756d':'#96d86a';
 ctx.save();ctx.fillStyle='#24191cdd';ctx.fillRect(8,12,180,47);
 ctx.fillStyle='#fff';ctx.font='bold 10px sans-serif';ctx.fillText(`ハム HP ${hp}/3`,14,26);
 for(let i=0;i<3;i++){ctx.fillStyle=i<hp?color:'#655454';ctx.fillRect(14+i*55,32,51,7);}
 ctx.fillStyle='#fff';ctx.font='bold 9px sans-serif';ctx.fillText(`進化 ${Math.max(0,hp-1)}/2 · ${hp===3?'3方向発射':hp===2?'大きなどんぐり':'通常どんぐり'}`,14,51);ctx.restore();
}
const api={attacks,minimumInterval,defaults,cycle,normalize,create,draw,drawHud,playerHp,drawPlayerHud};if(typeof module!=='undefined')module.exports=api;root.HamuBoss=api;
})(typeof window!=='undefined'?window:globalThis);
