(function(root){
 const bodyColors=[['#f0b56a','ゴールデン'],['#f4efe6','ホワイト'],['#a9a9b3','グレー'],['#8a5a3c','チョコ'],['#f2a7b8','ピンク'],['#9fd8c0','ミント'],['#9cc3ef','そら'],['#4a4040','ブラック']];
 const outfitColors=[['#d9412b','あか'],['#2f6fd0','あお'],['#3f9a4a','みどり'],['#f0c050','きいろ'],['#8c4fc0','むらさき'],['#2b2620','くろ'],['#f7f2ea','しろ']];
 const colors=[...bodyColors,...outfitColors];
 const normalizeLetter=text=>String(text||'').normalize('NFKC').normalize('NFC');
 const validLetter=text=>/^[ぁ-ゖァ-ヺー]$/u.test(normalizeLetter(text));
 const rotation=value=>{const n=Number(value);return Number.isFinite(n)?((n%360)+360)%360:0;};
 const furnitureScale=value=>{const n=Number(value);return Number.isFinite(n)&&n>0?Math.min(2.5,Math.max(.4,n)):1;};
 const pinchScale=(initial,start,current)=>furnitureScale(furnitureScale(initial)*(start>0?current/start:1));
 function groupFurniture(items,placed=[]){const groups=new Map();for(const item of items){const key=JSON.stringify([item.kind,item.color||'',item.text||'']);if(!groups.has(key))groups.set(key,{key,items:[],available:[]});const group=groups.get(key);group.items.push(item);if(!placed.some(p=>p.id===item.id))group.available.push(item);}return [...groups.values()];}
 const furnitureTransform=(item,placed=false)=>(placed?'translate(-50%,-50%) ':'')+'rotate('+(rotation(item.rotation)+(item.kind==='seed'?-20:0))+'deg)'+(furnitureScale(item.scale)!==1?' scale('+furnitureScale(item.scale)+')':'');
 const prices={seed:3,ring:5,letter:7,goldBurr:100,lightSet:15,darkness:50};
 function purchase(profile,kind,options={},id){
  if(!Object.hasOwn(prices,kind))return {ok:false,message:'商品が見つかりません'};
  const p=structuredClone(profile||{});if(['lightSet','darkness'].includes(kind)&&p.plazaParts?.[kind])return {ok:false,message:'購入済みです'};const balance=Number.isSafeInteger(p.orbs?.balance)?p.orbs.balance:0;
  if(balance<prices[kind])return {ok:false,message:'どんぐりオーブが足りません'};
  const color=String(options.color||bodyColors[0][0]).toLowerCase();if(['ring','letter'].includes(kind)&&!colors.some(([value])=>value===color))return {ok:false,message:'色を選んでください'};
  const text=normalizeLetter(options.text);if(kind==='letter'&&!validLetter(text))return {ok:false,message:'ひらがな・カタカナを1文字選んでください'};
  if(!id)return {ok:false,message:'もう一度お試しください'};
  if(['lightSet','darkness'].includes(kind)){p.plazaParts={...p.plazaParts,[kind]:true};p.orbs={...p.orbs,earned:Math.max(Number(p.orbs?.earned)||0,balance),balance:balance-prices[kind]};return {ok:true,profile:p,cost:prices[kind],part:kind};}
  p.furnitureInventory||=[];if(p.furnitureInventory.some(i=>i.id===id))return {ok:false,message:'購入済みです'};
  const item={id,kind,...(['ring','letter'].includes(kind)?{color}:{}),...(kind==='letter'?{text}:{})};p.furnitureInventory.push(item);p.orbs={...(p.orbs||{}),earned:Math.max(Number(p.orbs?.earned)||0,balance),balance:balance-prices[kind]};return {ok:true,profile:p,item,cost:prices[kind]};
 }
 const api={prices,purchase,bodyColors,outfitColors,colors,normalizeLetter,validLetter,rotation,furnitureTransform,furnitureScale,pinchScale,groupFurniture};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.HamuShop=api;
})(typeof window!=='undefined'?window:globalThis);
