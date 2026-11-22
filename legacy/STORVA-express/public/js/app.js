/* ===== CONFIG: change names, copy and prices here ===== */
const CONFIG={
 brand:'STORVA',

 features:[['💬','WhatsApp-first management','Add products, check orders and update stock by sending a message.'],['🤖','AI product creation','Send a photo or a few keywords and AI drafts the title and description for your approval.'],['⚡','Fast store setup','Guided onboarding, theme selection and ready-to-use defaults get you live in minutes.'],['🎨','Live store designer','Change colors, fonts and content while previewing desktop, tablet and mobile views.'],['🗂️','Product & catalog management','Manage products, variants, prices, images, stock and collections from one dashboard.'],['💳','Smooth checkout & payments','Cart, discounts, addresses and order placement with secure online payments via Razorpay.'],['📦','Orders & customers','Track orders and statuses, and keep customer details and order history in one place.'],['📈','Analytics & growth tools','See sales, top products and customer insights, plus discounts to bring buyers back.']],
 steps:[['Set up basics','Add your store name, business details and preferences.','images/step1.jpg',['Store name, currency and preferences','Contact info customers will see','Only the essentials to get started']],['Add your products','Upload photos, set prices and stock, or send them on WhatsApp.','images/step2.jpg',['Photos, price and stock for each item','Titles and descriptions, or let AI draft them','Group items into collections']],['Choose a template','Pick a layout and preview it on desktop and mobile.','images/step3.jpg',['Pick a clean layout from the theme library','Customize colors, fonts and homepage','Check mobile and desktop before publishing']],['Launch your store','Connect payments and delivery, then share your link.','images/step4.jpg',['Connect Razorpay to accept payments','Set shipping or local delivery details','Review checkout and policies, then publish']]],
 plans:[
  {name:'Free',m:0,y:0,desc:'Launch your first store at no cost.',items:['10 active products','Hosted storefront','WhatsApp product upload','Basic order management','QR code'],cta:'Start building'},
  {name:'Pro',m:299,y:239,pop:true,desc:'AI-assisted creation and WhatsApp commands.',items:['Everything in Free','Expanded product limit','AI product creation','WhatsApp commands','Inventory and coupons','embed.js integration','Basic analytics'],cta:'Start building'},
  {name:'Advanced',m:599,y:479,desc:'Teams, custom domains and deeper analytics.',items:['Everything in Pro','Higher AI usage','Staff accounts with roles','Custom domain','Advanced analytics','Priority support'],cta:'Start building'}],
 faq:[['Do I need coding or design skills?','No. Pick a theme, then change colors, fonts and content in the live designer without writing code.'],['What payment options can I offer?','Customers pay online through Razorpay. Gateway activation and transaction charges are set by Razorpay.'],['Can I use my own domain?','Custom domains are part of the Advanced plan. Other plans launch on a link like yourapp.com/store/your-shop.'],['Is the platform mobile-friendly?','Yes. Storefronts are responsive on mobile, tablet and desktop, and the dashboard works on your phone so you can manage orders on the go.'],['Which languages does the WhatsApp assistant support?','English, Malayalam, Tamil, Hindi, Kannada, Telugu, Arabic, Bengali and Urdu. Availability can vary by message type and WhatsApp template approval.'],['Who is this for?','Creators, beginners and small brands who want to sell online without the complexity of traditional platforms.'],['How long does setup take?','Most people add details, upload products, pick a theme and publish in under an hour.'],['Do I need to code?','No. The visual designer and ready-made themes handle layout, fonts and colours.'],['Which payments can I accept?','Connect a payment gateway of your choice, or offer cash on delivery and manual payments.'],['Can I use my own domain?','Yes, on paid plans. Free stores use a managed subdomain.']],
 products:[['Linen tote bag',799,24],['Ceramic mug',449,60],['Soy candle set',1199,8],['Notebook trio',599,41],['Brass keychain',299,0],['Jute basket',999,15]],
 orders:[['#1042','Riya S.',1249,'Paid'],['#1041','Arjun K.',799,'Shipped'],['#1040','Meera P.',2398,'Pending'],['#1039','Dev R.',449,'Paid'],['#1038','Nisha T.',1599,'Shipped']]
};
/* ===== helpers ===== */
const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
function toast(m){const t=$('#toast');t.textContent=m;t.style.opacity=1;clearTimeout(t._h);t._h=setTimeout(()=>t.style.opacity=0,2200)}
$$('[data-brand]').forEach(e=>e.textContent=CONFIG.brand);document.title=CONFIG.brand+' – Launch your online store';
const inr=n=>'₹'+n.toLocaleString('en-IN');

/* ===== router (hash: #home, #login, #app) ===== */
let authed=false; // real state: set by auth.js after /api/auth/me or login
function go(v){location.hash=v;}
function route(){
 let h=location.hash.slice(1)||'home';
 if(['about','showcase','features','steps','pricing','faq','whatsapp','solutions'].includes(h)){show('landing');return}
 if(h==='app'&&!authed)h='login';
 if(h==='app'&&authed){location.replace('/dashboard.html');return} // real dashboard (the old demo tabs below are no longer reachable)
 if(h==='signup')h='login';
 const map={home:'landing',login:'login',app:'app'};show(map[h]||'landing');
 if(h==='login'&&!authed&&typeof renderAuth==='function'&&true)renderAuth(location.hash==='#signup'?'register':'login');
 if(h==='login'&&authed){go('app');return}
 if(h==='app')renderApp(curTab);
 if(['login','app'].includes(h)||h==='home')scrollTo(0,0);
}
function show(n){['landing','login','app'].forEach(k=>$('#v-'+k).classList.toggle('hidden',k!==n))}
addEventListener('hashchange',route);

/* ===== landing ===== */
const svcCard=(f,dup)=>`<div class="w-72 shrink-0 bg-white rounded-3xl p-6 border border-black/5 hover:-translate-y-1.5 hover:shadow-xl transition"${dup?' aria-hidden="true"':''}><div class="w-12 h-12 rounded-2xl bg-mist grid place-items-center text-2xl">${f[0]}</div><h3 class="mt-4 font-bold text-lg">${f[1]}</h3><p class="mt-1.5 text-ink/65">${f[2]}</p></div>`;
$('#featGrid').innerHTML=CONFIG.features.map(f=>svcCard(f,false)).join('')+CONFIG.features.map(f=>svcCard(f,true)).join('');
$('#svcPause').onclick=e=>{const m=$('#svcMarquee'),p=m.classList.toggle('paused');e.target.textContent=p?'Play':'Pause';e.target.setAttribute('aria-pressed',p)};
$('#faqList').innerHTML=CONFIG.faq.map(q=>`<details class="group bg-white rounded-2xl border border-black/5 px-5 py-4"><summary class="cursor-pointer font-bold flex justify-between list-none">${q[0]}<span class="group-open:rotate-45 transition text-xl leading-none">+</span></summary><p class="mt-3 text-ink/65">${q[1]}</p></details>`).join('');
let bill='m';
function renderPrices(){$('#priceGrid').innerHTML=CONFIG.plans.map(p=>`<div class="rv relative rounded-3xl p-7 flex flex-col ${p.pop?'bg-ink text-white md:-translate-y-3 shadow-2xl':'bg-white border border-black/5'}">${p.pop?'<span class="absolute -top-3 left-7 bg-sun text-ink text-xs font-bold px-3 py-1 rounded-full">Most popular</span>':''}<h3 class="font-bold text-xl">${p.name}</h3><p class="mt-3"><span class="text-4xl font-extrabold">${p[bill]?inr(p[bill]):'Free'}</span>${p[bill]?'<span class="opacity-60"> /month</span>':''}</p><p class="mt-2 opacity-70">${p.desc}</p><ul class="mt-5 grid gap-2.5 flex-1">${p.items.map(i=>`<li class="flex gap-2"><span class="text-mint font-bold">✓</span>${i}</li>`).join('')}</ul><button data-action="go" data-arg="signup" class="btn mt-7 ${p.pop?'bg-iris text-white hover:bg-white hover:text-ink':'btn-g'}">${p.cta}</button></div>`).join('');observe()}
function setBill(b){bill=b;$('#bm').className='px-5 py-2 rounded-full font-bold '+(b==='m'?'bg-ink text-white':'');$('#by').className='px-5 py-2 rounded-full font-bold '+(b==='y'?'bg-ink text-white':'');renderPrices()}
const io=new IntersectionObserver(es=>es.forEach(e=>{if(e.isIntersecting){e.target.classList.add('in');io.unobserve(e.target)}}),{threshold:.15});
function observe(){$$('.rv:not(.in)').forEach(e=>io.observe(e))}
renderPrices();
/* 3D hero tilt */
const stage=$('#stage'),scene=$('#scene');
stage.addEventListener('mousemove',e=>{const r=stage.getBoundingClientRect(),x=(e.clientX-r.left)/r.width-.5,y=(e.clientY-r.top)/r.height-.5;scene.style.setProperty('--ry',(-14+x*24)+'deg');scene.style.setProperty('--rx',(8-y*20)+'deg')});
stage.addEventListener('mouseleave',()=>{scene.style.setProperty('--ry','-14deg');scene.style.setProperty('--rx','8deg')});

/* ===== dashboard ===== */
let curTab='overview';
const TABS=[['overview','▦','Overview'],['store','🏬','My store'],['customers','👥','Customers'],['whatsapp','💬','WhatsApp and AI'],['coupons','🏷','Coupons'],['embed','🧩','Website embed'],['plan','⭐','Subscription'],['products','🏷','Products'],['orders','🧾','Orders'],['designer','🎨','Store designer']];
function toggleSide(){$('#side').classList.toggle('-translate-x-full');$('#scrim').classList.toggle('hidden')}
function vStore(){return `<div class="bg-white rounded-3xl p-6 border border-black/5"><h3 class="font-bold text-lg">Your store</h3><p class="mt-2 text-ink/60">Create your store, choose its address and manage its settings.</p><a href="/dashboard.html" class="btn btn-p inline-block mt-4">Open store settings</a></div>`}
function renderApp(t){
 curTab=t;$('#appNav').innerHTML=TABS.map(x=>`<div class="nav-a ${x[0]===t?'on':''}" data-action="tab" data-arg="${x[0]}"><span>${x[1]}</span>${x[2]}</div>`).join('');
 $('#appTitle').textContent=TABS.find(x=>x[0]===t)[2];
 $('#appBody').innerHTML=({store:vStore,customers:vCustomers,whatsapp:vWhatsapp,coupons:vCoupons,embed:vEmbed,plan:vPlan,overview:vOverview,products:vProducts,orders:vOrders,designer:vDesigner})[t]();
 if(t==='overview')countUp();if(t==='designer')bindDesigner();
}
const badge=s=>`<span class="px-2.5 py-1 rounded-full text-xs font-bold ${s==='Paid'?'bg-mint/15 text-mint':s==='Shipped'?'bg-iris/15 text-iris':'bg-sun/30 text-ink'}">${s}</span>`;
function vOverview(){
 const stats=[['Revenue',48250,'₹','+12%'],['Orders',126,'','+8%'],['Visitors',3420,'','+21%'],['Conversion',3.7,'%','+0.4%']];
 const bars=[40,62,48,80,55,92,70];
 return `<div class="grid sm:grid-cols-2 xl:grid-cols-4 gap-4">${stats.map(s=>`<div class="bg-white rounded-3xl p-5 border border-black/5"><p class="text-ink/55 font-semibold">${s[0]}</p><p class="mt-2 text-3xl font-extrabold"><span class="cnt" data-v="${s[1]}" data-p="${s[2]}">0</span></p><p class="text-mint text-sm font-bold mt-1">${s[3]} this week</p></div>`).join('')}</div>
 <div class="mt-5 grid lg:grid-cols-3 gap-5">
  <div class="lg:col-span-2 bg-white rounded-3xl p-6 border border-black/5"><h3 class="font-bold text-lg">Sales this week</h3><div class="mt-6 h-48 flex items-end gap-3">${bars.map((b,i)=>`<div class="flex-1 flex flex-col items-center gap-2"><div class="w-full rounded-xl ${i===5?'bg-iris':'bg-iris/20'} transition-all duration-700" style="height:0" data-h="${b}%"></div><span class="text-xs text-ink/50">${'MTWTFSS'[i]}</span></div>`).join('')}</div></div>
  <div class="bg-white rounded-3xl p-6 border border-black/5"><h3 class="font-bold text-lg">Recent orders</h3><div class="mt-4 grid gap-3">${CONFIG.orders.slice(0,4).map(o=>`<div class="flex items-center justify-between"><div><b>${o[1]}</b><p class="text-xs text-ink/50">${o[0]}</p></div><div class="text-right"><b>${inr(o[2])}</b><div>${badge(o[3])}</div></div></div>`).join('')}</div></div>
 </div>`}
function vProducts(){return `<div class="flex justify-between items-center mb-4"><p class="text-ink/60">${CONFIG.products.length} products</p><button class="btn btn-p !py-2.5 text-sm" data-action="toast" data-arg="Add product form goes here">+ Add product</button></div>
 <div class="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">${CONFIG.products.map((p,i)=>`<div class="bg-white rounded-3xl p-4 border border-black/5"><div class="h-36 rounded-2xl" style="background:hsl(${i*47+240} 70% 85%)"></div><h3 class="mt-3 font-bold">${p[0]}</h3><div class="flex justify-between mt-1"><span>${inr(p[1])}</span><span class="${p[2]?'text-ink/55':'text-red-600 font-bold'}">${p[2]?p[2]+' in stock':'Out of stock'}</span></div></div>`).join('')}</div>`}
function vOrders(){return `<div class="bg-white rounded-3xl border border-black/5 overflow-x-auto"><table class="w-full text-left min-w-[480px]"><thead class="text-ink/50 text-sm"><tr><th class="p-4">Order</th><th>Customer</th><th>Total</th><th>Status</th></tr></thead><tbody>${CONFIG.orders.map(o=>`<tr class="border-t border-black/5"><td class="p-4 font-bold">${o[0]}</td><td>${o[1]}</td><td>${inr(o[2])}</td><td>${badge(o[3])}</td></tr>`).join('')}</tbody></table></div>`}
function countUp(){
 $$('.cnt').forEach(e=>{const v=+e.dataset.v,p=e.dataset.p,t0=performance.now();(function f(t){const k=Math.min(1,(t-t0)/900),n=v*(1-Math.pow(1-k,3));e.textContent=(p==='₹'?'₹':'')+(v%1?n.toFixed(1):Math.round(n).toLocaleString('en-IN'))+(p==='%'?'%':'');if(k<1)requestAnimationFrame(f)})(t0)});
 setTimeout(()=>$$('[data-h]').forEach(b=>b.style.height=b.dataset.h),50)}
const D={name:'Your Store',head:'Everyday things, made with care',color:'#6C4CF5',font:"'Bricolage Grotesque',sans-serif",dark:false,w:'100%'};
function vDesigner(){
 const sw=['#6C4CF5','#19B58A','#E8453C','#FFB22E','#14122B'];
 return `<div class="grid lg:grid-cols-[300px_1fr] gap-5">
 <div class="bg-white rounded-3xl p-5 border border-black/5 grid gap-4 content-start">
  <label class="font-semibold text-sm">Store name<input id="dName" class="mt-1 w-full px-3 py-2.5 rounded-xl border-2 border-[#E3E5F0] outline-none focus:border-iris font-normal" value="${D.name}"></label>
  <label class="font-semibold text-sm">Homepage headline<input id="dHead" class="mt-1 w-full px-3 py-2.5 rounded-xl border-2 border-[#E3E5F0] outline-none focus:border-iris font-normal" value="${D.head}"></label>
  <div><p class="font-semibold text-sm">Brand colour</p><div class="mt-2 flex gap-2">${sw.map(c=>`<button class="sw w-9 h-9 rounded-full border-4 ${c===D.color?'border-ink/30':'border-white shadow'}" style="background:${c}" data-c="${c}" aria-label="Colour ${c}"></button>`).join('')}</div></div>
  <label class="font-semibold text-sm">Font<select id="dFont" class="mt-1 w-full px-3 py-2.5 rounded-xl border-2 border-[#E3E5F0] font-normal"><option value="'Bricolage Grotesque',sans-serif">Modern sans</option><option value="Georgia,serif">Classic serif</option><option value="ui-monospace,monospace">Mono</option></select></label>
  <label class="flex items-center justify-between font-semibold text-sm">Dark theme<input id="dDark" type="checkbox" class="w-5 h-5 accent-iris"></label>
  <button class="btn btn-p" data-action="toast" data-arg="Published">Publish changes</button>
 </div>
 <div class="bg-white rounded-3xl p-4 border border-black/5 min-w-0">
  <div class="flex justify-center gap-2 mb-4">${[['🖥','100%'],['📱','768px'],['📞','375px']].map(d=>`<button class="dev px-4 py-2 rounded-full font-bold ${d[1]===D.w?'bg-ink text-white':'bg-mist'}" data-w="${d[1]}">${d[0]}</button>`).join('')}</div>
  <div class="bg-mist rounded-2xl p-3 sm:p-6 overflow-hidden"><div id="pv" class="mx-auto rounded-2xl overflow-hidden shadow-xl transition-all duration-500" style="max-width:${D.w}"></div></div>
 </div></div>`}
function paint(){
 const bg=D.dark?'#14122B':'#fff',fg=D.dark?'#fff':'#14122B';
 $('#pv').style.cssText+=`;max-width:${D.w};font-family:${D.font};background:${bg};color:${fg}`;
 $('#pv').innerHTML=`<div class="flex justify-between items-center px-5 py-4 border-b" style="border-color:${fg}22"><b class="text-lg">${D.name||' '}</b><span class="text-sm opacity-60">Shop · Cart (0)</span></div>
 <div class="px-6 py-12 text-center" style="background:${D.color}"><h2 class="text-2xl sm:text-4xl font-extrabold text-white max-w-lg mx-auto">${D.head||' '}</h2><span class="inline-block mt-5 px-5 py-2.5 rounded-full bg-white font-bold" style="color:${D.color}">Shop now</span></div>
 <div class="p-5 grid grid-cols-2 ${D.w==='375px'?'':'sm:grid-cols-4'} gap-3">${CONFIG.products.slice(0,4).map((p,i)=>`<div><div class="h-24 sm:h-32 rounded-xl" style="background:${D.color}${['33','55','22','44'][i]}"></div><p class="mt-2 text-sm font-bold">${p[0]}</p><p class="text-sm opacity-60">${inr(p[1])}</p></div>`).join('')}</div>`}
function bindDesigner(){
 $('#dFont').value=D.font;$('#dDark').checked=D.dark;
 $('#dName').oninput=e=>{D.name=e.target.value;paint()};$('#dHead').oninput=e=>{D.head=e.target.value;paint()};
 $('#dFont').onchange=e=>{D.font=e.target.value;paint()};$('#dDark').onchange=e=>{D.dark=e.target.checked;paint()};
 $$('.sw').forEach(b=>b.onclick=()=>{D.color=b.dataset.c;$$('.sw').forEach(x=>x.className='sw w-9 h-9 rounded-full border-4 '+(x===b?'border-ink/30':'border-white shadow'));paint()});
 $$('.dev').forEach(b=>b.onclick=()=>{D.w=b.dataset.w;$$('.dev').forEach(x=>x.className='dev px-4 py-2 rounded-full font-bold '+(x===b?'bg-ink text-white':'bg-mist'));paint()});
 paint()}


/* ===== extra modules ===== */
const stImgs=$('#stImgs'),stList=$('#stList'),stBar=$('#stBar'),stSec=$('#steps');
stImgs.innerHTML=CONFIG.steps.map((s,i)=>`<img src="${s[2]}" alt="${s[0]}" class="absolute inset-0 w-full h-full object-cover" style="opacity:${i?0:1}">`).join('');
stList.innerHTML=CONFIG.steps.map((s,i)=>`<div class="st rounded-2xl p-4 border border-white/10 transition-all duration-500"><div class="flex items-center gap-3"><span class="w-8 h-8 rounded-full grid place-items-center font-extrabold bg-white/10 transition">${i+1}</span><h3 class="font-bold text-lg">${s[0]}</h3></div><div class="grid transition-all duration-500" style="grid-template-rows:0fr"><div class="overflow-hidden pl-11"><p class="text-white/70">${s[1]}</p><ul class="mt-2 grid gap-1 text-sm text-white/60 list-disc pl-4">${s[3].map(b=>`<li>${b}</li>`).join('')}</ul></div></div></div>`).join('');
let cur=0,last=-1;
(function tick(){
 if(!$('#v-landing').classList.contains('hidden')){
  const r=stSec.getBoundingClientRect(),t=Math.max(0,Math.min(1,-r.top/(r.height-innerHeight)));
  cur+=(t-cur)*.1;const pos=Math.max(0,Math.min(3,cur*4-.5));
  stBar.style.width=(cur*100)+'%';
  [...stImgs.children].forEach((im,i)=>{const o=Math.max(0,1-Math.abs(pos-i));im.style.opacity=o;im.style.transform=`scale(${1.08-.08*o}) translateY(${(i-pos)*14}px)`});
  const a=Math.round(pos);
  if(a!==last){last=a;$$('.st').forEach((e,i)=>{const on=i===a;e.style.background=on?'rgba(255,255,255,.1)':'transparent';e.style.opacity=on?1:.5;e.firstChild.firstChild.style.cssText=on?'background:#FFB22E;color:#14122B':'';e.lastChild.style.gridTemplateRows=on?'1fr':'0fr'})}
 }
 requestAnimationFrame(tick)})();
const CHAT={Malayalam:['ഈ പ്രൊഡക്റ്റ് സ്റ്റോക്കുണ്ടോ?','ഉണ്ട്, 12 എണ്ണം സ്റ്റോക്കിലുണ്ട്. വില ₹599.'],Manglish:['Ee product stock undo?','Undu, 12 ennam stock-il und. Price ₹599.'],Tamil:['இந்த பொருள் கிடைக்குமா?','ஆம், 12 கிடைக்கிறது. விலை ₹599.'],Hindi:['क्या यह प्रोडक्ट उपलब्ध है?','हाँ, 12 उपलब्ध हैं। कीमत ₹599।'],Kannada:['ಈ ಉತ್ಪನ್ನ ಲಭ್ಯವಿದೆಯೇ?','ಹೌದು, 12 ಲಭ್ಯವಿದೆ. ಬೆಲೆ ₹599.'],English:['Is this product available?','Yes, 12 in stock. Price ₹599.']};
$('#chips').innerHTML=Object.keys(CHAT).map(k=>`<button class="chip px-4 py-2 rounded-full font-bold" data-k="${k}">${k}</button>`).join('');
function chat(k){$$('.chip').forEach(c=>c.className='chip px-4 py-2 rounded-full font-bold '+(c.dataset.k===k?'bg-ink text-white':'bg-white border border-black/5'));
 $('#chatBox').innerHTML=`<div class="pop ml-auto max-w-[80%] bg-[#DCF8C6] rounded-2xl rounded-tr-sm px-4 py-2.5">${CHAT[k][0]}</div><div id="typ" class="pop mr-auto bg-white rounded-2xl rounded-tl-sm px-4 py-3 text-ink/40">● ● ●</div>`;
 clearTimeout(chat.t);chat.t=setTimeout(()=>{const t=$('#typ');if(t)t.outerHTML=`<div class="pop mr-auto max-w-[80%] bg-white rounded-2xl rounded-tl-sm px-4 py-2.5">${CHAT[k][1]}</div>`},900)}
$('#chips').onclick=e=>{const k=e.target.dataset.k;if(k)chat(k)};chat('Malayalam');
$('#pills').innerHTML=['Bakeries','Boutiques','Grocery shops','Gift shops','Electronics','Beauty and cosmetics','Handmade sellers','Home businesses'].map(x=>`<span class="px-4 py-2 rounded-full bg-white border border-black/5 font-semibold">${x}</span>`).join('');
observe();
const CUST=[['Riya S.','+91 98765 43210',4,'Malayalam',5120],['Arjun K.','+971 50 123 4567',2,'English',1598],['Meera P.','+91 91234 56789',6,'Tamil',7240],['Dev R.','+44 7700 900123',1,'Hindi',449]];
const COUP=[['WELCOME10','10% off',true],['FESTIVE20','20% off',false]];
let prefLang='English',linkCode='';
const IN='px-3 py-2.5 rounded-xl border-2 border-[#E3E5F0] outline-none focus:border-iris';
function vCustomers(){return `<div class="bg-white rounded-3xl border border-black/5 overflow-x-auto"><table class="w-full text-left min-w-[560px]"><thead class="text-ink/50 text-sm"><tr><th class="p-4">Customer</th><th>Phone</th><th>Orders</th><th>Language</th><th>Total</th></tr></thead><tbody>${CUST.map(c=>`<tr class="border-t border-black/5"><td class="p-4 font-bold">${c[0]}</td><td>${c[1]}</td><td>${c[2]}</td><td>${c[3]}</td><td>${inr(c[4])}</td></tr>`).join('')}</tbody></table></div>`}
function vWhatsapp(){const vol=[['English',42],['Malayalam',31],['Manglish',14],['Tamil',8],['Hindi',5]],card='bg-white rounded-3xl p-6 border border-black/5';
return `<div class="grid lg:grid-cols-2 gap-5">
<div class="${card}"><h3 class="font-bold text-lg">WhatsApp connection</h3><p class="mt-2 text-ink/60">Link your business number through the official WhatsApp Cloud API flow.</p><p class="mt-4">${linkCode?`Send <b>${linkCode}</b> from your WhatsApp number within 10 minutes.`:'Status: <b>Not connected</b>'}</p><button class="btn btn-p mt-4 !py-2.5" data-action="linkCode">Generate link code</button></div>
<div class="${card}"><h3 class="font-bold text-lg">Your WhatsApp language</h3><p class="mt-2 text-ink/60">Notifications to you are sent in this language.</p><select class="mt-4 w-full ${IN}" data-change="lang">${['English','Malayalam','Tamil','Hindi','Kannada','Telugu','Arabic','Bengali','Urdu'].map(l=>`<option ${l===prefLang?'selected':''}>${l}</option>`).join('')}</select></div>
<div class="${card}"><h3 class="font-bold text-lg">Messages by language</h3><div class="mt-4 grid gap-3">${vol.map(v=>`<div><div class="flex justify-between text-sm"><span>${v[0]}</span><b>${v[1]}%</b></div><div class="h-2 rounded-full bg-mist"><div class="h-2 rounded-full bg-iris" style="width:${v[1]}%"></div></div></div>`).join('')}</div></div>
<div class="${card}"><h3 class="font-bold text-lg">AI product draft</h3><div class="mt-4 flex gap-4"><div class="w-24 h-24 rounded-2xl bg-sun/40 shrink-0"></div><div><b>Handwoven jute basket</b><p class="text-sm text-ink/60">Category: Home decor. Colour: natural.</p></div></div><label class="block mt-4 text-sm font-semibold">Your price<input class="mt-1 w-full ${IN} font-normal" placeholder="Enter price"></label><button class="btn btn-p w-full mt-4" data-action="toast" data-arg="Published to your store">Approve and publish</button></div></div>`}
function vCoupons(){return `<div class="grid lg:grid-cols-3 gap-5"><div class="lg:col-span-2 grid gap-3 content-start">${COUP.map((c,i)=>`<div class="bg-white rounded-2xl p-4 border border-black/5 flex items-center justify-between"><div><b>${c[0]}</b><p class="text-sm text-ink/60">${c[1]}</p></div><button class="px-4 py-2 rounded-full font-bold ${c[2]?'bg-mint/15 text-mint':'bg-mist'}" data-action="coupon" data-arg="${i}">${c[2]?'Active':'Paused'}</button></div>`).join('')}</div><div class="bg-white rounded-3xl p-5 border border-black/5 grid gap-3 content-start"><h3 class="font-bold">New coupon</h3><input id="cCode" placeholder="Code, e.g. SAVE15" class="${IN}"><input id="cPct" type="number" min="1" max="90" placeholder="Percent off" class="${IN}"><button class="btn btn-p" data-action="addCoupon">Create coupon</button></div></div>`}
function addCoupon(){const c=$('#cCode').value.trim().toUpperCase(),p=+$('#cPct').value;if(!c||p<1||p>90)return toast('Enter a code and a percent from 1 to 90');COUP.push([c,p+'% off',true]);renderApp('coupons')}
const EMB='<script src="https://YOUR-DOMAIN.com/embed.js" data-store="PUBLIC_STORE_ID"></'+'script>';
function vEmbed(){return `<div class="bg-white rounded-3xl p-6 border border-black/5 max-w-2xl"><h3 class="font-bold text-lg">Add your catalog to any website</h3><p class="mt-2 text-ink/60">Paste this tag where you want your products to appear.</p><pre class="mt-4 bg-ink text-white rounded-2xl p-4 overflow-x-auto text-sm">${EMB.replace(/</g,'&lt;')}</pre><button class="btn btn-p mt-4" data-action="copyEmb">Copy code</button></div>`}
function copyEmb(){try{navigator.clipboard.writeText(EMB).then(()=>toast('Copied'),()=>toast('Copy failed'))}catch(e){toast('Copy failed')}}
function vPlan(){return `<div class="bg-white rounded-3xl p-6 border border-black/5"><h3 class="font-bold text-lg">Current plan: Free</h3><p class="mt-2 text-sm text-ink/60">7 of 10 active products used</p><div class="h-2 rounded-full bg-mist mt-2 max-w-sm"><div class="h-2 rounded-full bg-iris w-[70%]"></div></div></div><div class="mt-5 grid md:grid-cols-3 gap-4">${CONFIG.plans.map(p=>`<div class="bg-white rounded-3xl p-5 border border-black/5"><b class="text-lg">${p.name}</b><p class="text-2xl font-extrabold mt-1">${p.m?inr(p.m):'Free'}<span class="text-sm font-normal text-ink/50">${p.m?' /month':''}</span></p><button class="btn btn-g w-full mt-4 !py-2" data-action="toast" data-arg="Connect your billing backend to change plans">${p.name==='Free'?'Current plan':'Switch to '+p.name}</button></div>`).join('')}</div><div class="mt-5 bg-white rounded-3xl p-6 border border-black/5"><h3 class="font-bold">Billing history</h3><p class="mt-2 text-ink/60">No invoices yet. They appear here after your first payment.</p></div>`}

observe();initAuth().then(route);

// Module 15: no inline event handlers (strict CSP: script-src-attr 'none'). Buttons declare data-action / data-arg instead.
const ACTIONS = {
  go: (t) => go(t.dataset.arg), toast: (t) => toast(t.dataset.arg), bill: (t) => setBill(t.dataset.arg), logout: () => logout(), side: () => toggleSide(),
  menu: () => document.getElementById('mnav').classList.toggle('hidden'),
  tab: (t) => { renderApp(t.dataset.arg); if (innerWidth < 1024) toggleSide(); },
  coupon: (t) => { const i = Number(t.dataset.arg); if (COUP[i]) { COUP[i][2] = !COUP[i][2]; renderApp('coupons'); } },
  addCoupon: () => addCoupon(), copyEmb: () => copyEmb(),
  linkCode: () => { linkCode = 'LINK-' + Math.random().toString(36).slice(2, 6).toUpperCase(); renderApp('whatsapp'); },
};
document.addEventListener('click', (e) => { const t = e.target.closest('[data-action]'); if (t && ACTIONS[t.dataset.action]) ACTIONS[t.dataset.action](t); });
document.addEventListener('change', (e) => { const t = e.target.closest('[data-change="lang"]'); if (t) { prefLang = t.value; toast('Language saved'); } });
