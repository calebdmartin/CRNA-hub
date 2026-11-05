'use strict';
const KEY='crna-hub-v2',OLD='crna-hub-starter-v1',tabs=['Account','Dashboard','Facilities','PTO','Credentials','Mileage','Import & Backup','Assistant'];
const empty=()=>({shifts:[],facilities:[],pto:[],credentials:[],mileage:[],contracts:[],nbcrna:{status:'',number:'',periodStart:'',periodEnd:'',renewalDeadline:'',classA:'',classB:'',macEd:'',macDev:'',macEdRequired:60,macDevRequired:40,docNote:'',ceNote:'',reminders:'90,60,30,7'},aana:{status:'',number:'',expiration:'',docNote:'',ceNote:'',reminders:'90,60,30,7'},nbcrnaCE:[],aanaCE:[],licenses:[],documents:[],assistantChat:[],settings:{ptoAnnual:0,ptoStarting:0,ptoHoursPerPeriod:0}});
function load(){let obj;try{obj=JSON.parse(localStorage.getItem(KEY)||localStorage.getItem(OLD)||'null')}catch{}const result=empty();if(obj&&typeof obj==='object')for(const k of Object.keys(result))if((k==='settings'||k==='nbcrna'||k==='aana')?obj[k]&&typeof obj[k]==='object':Array.isArray(obj[k]))result[k]=obj[k];return result}
let db=load(),tab='Dashboard',showShiftForm=false,manualType='NBCRNA',month=new Date(),selected=localDate(new Date()),editId=null,savedShiftsYear=null;month.setDate(1);
const $=id=>document.getElementById(id),escapeHTML=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c])),currency=n=>Number(n||0).toLocaleString('en-US',{style:'currency',currency:'USD',maximumFractionDigits:2}),num=n=>Number(n||0),id=()=>crypto.randomUUID(),fmt=d=>new Date(d+'T12:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});
function localDate(d){return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-')}
// Income totals are scoped to one calendar year at a time (default: the
// current calendar year). Shifts from other years stay in the list and
// the calendar — they are simply out of that year's total, never deleted.
function currentYear(){return new Date().getFullYear()}
function shiftYears(){const ys=[...new Set((db.shifts||[]).map(x=>String(x.date||'').slice(0,4)).filter(y=>/^\d{4}$/.test(y)))].sort();if(!ys.includes(String(currentYear())))ys.push(String(currentYear()));return ys.sort()}
function selectedShiftsYear(){const y=savedShiftsYear||currentYear();return shiftYears().includes(String(y))?+y:currentYear()}
function shiftsForYear(y){const p=String(y)+'-';return (db.shifts||[]).filter(x=>String(x.date||'').startsWith(p))}
function yearGross(y){return shiftsForYear(y).reduce((s,x)=>s+num(x.pay),0)}
function persist(){try{localStorage.setItem(KEY,JSON.stringify(db))}catch(e){alert('Storage failed. Export a backup: '+e.message)}}
function setTab(t){tab=t;editId=null;showShiftForm=false;render();window.scrollTo(0,0)}
function moveMonth(n){month=new Date(month.getFullYear(),month.getMonth()+n,1);render()}
function selectDay(d){selected=d;tab='Dashboard';editId=null;showShiftForm=true;render()}
// --- Credentialing helpers (NBCRNA / AANA / state licenses) ---
// Data shape is intentionally Supabase-ready: these local records map to
// future tables nbcrna_profiles, aana_memberships, licenses and ce_records,
// each with a user_id (added at auth time). Nothing here is verified yet.
const US_STATES=['Alabama','Alaska','Arizona','Arkansas','California','Colorado','Connecticut','Delaware','District of Columbia','Florida','Georgia','Hawaii','Idaho','Illinois','Indiana','Iowa','Kansas','Kentucky','Louisiana','Maine','Maryland','Massachusetts','Michigan','Minnesota','Mississippi','Missouri','Montana','Nebraska','Nevada','New Hampshire','New Jersey','New Mexico','New York','North Carolina','North Dakota','Ohio','Oklahoma','Oregon','Pennsylvania','Rhode Island','South Carolina','South Dakota','Tennessee','Texas','Utah','Vermont','Virginia','Washington','West Virginia','Wisconsin','Wyoming'];
function daysUntil(dateStr){if(!dateStr)return null;const d=new Date(dateStr+'T12:00:00');if(Number.isNaN(d.getTime()))return null;const today=new Date(localDate(new Date())+'T12:00:00');return Math.round((d-today)/864e5)}
function parseReminders(s){const v=String(s||'90,60,30,7').split(',').map(x=>parseInt(x.trim(),10)).filter(x=>Number.isFinite(x)&&x>=0);return v.length?v:[90,60,30,7]}
function deadlineStatus(days){if(days===null)return null;if(days<0)return 'EXPIRED';return 'due'}
function portalLink(url){const u=String(url||'').trim();if(!u)return '';if(/^https?:\/\//i.test(u))return `<a href="${escapeHTML(u)}" target="_blank" rel="noopener">Official portal</a>`;return escapeHTML(u)}
function credentialDeadlines(){
  const items=[];
  const push=(label,date,reminders,source)=>{const days=daysUntil(date);if(days===null)return;if(days<0||parseReminders(reminders).some(w=>days<=w))items.push({label,date,days,source})};
  const n=db.nbcrna||{};push('NBCRNA certification',n.renewalDeadline||n.periodEnd,n.reminders,'NBCRNA');
  const a=db.aana||{};push('AANA membership',a.expiration,a.reminders,'AANA');
  (db.licenses||[]).forEach(x=>push((x.state||'License')+' '+(x.type||''),x.expiry,x.reminders,'State license'));
  (db.documents||[]).forEach(x=>push((x.certType||'Certification')+' certification',x.expiry,'90,60,30,7','Certification document · standard 3-month (90-day) reminder · '+(x.expirySource==='extracted'?'expiration extracted from document':x.expirySource==='user-entered'?'expiration entered manually':'no expiration found')));
  (db.credentials||[]).forEach(x=>{const days=daysUntil(x.expiry);if(days!==null&&(days<0||days<=90))items.push({label:x.name||'Credential',date:x.expiry,days,source:'Credential'})});
  return items.sort((a,b)=>a.date.localeCompare(b.date));
}
function credentialDeadlinesPanel(){
  const items=credentialDeadlines();
  return `<section class="panel"><h2>Credential deadlines</h2><p class="muted">Deadlines from your records — portal-pulled records are labelled with their source on the Credentials tab; the rest are user-entered, not verified by NBCRNA, AANA, or a state board. <a href="https://www.nbcrna.com/" target="_blank" rel="noopener">NBCRNA</a> · <a href="https://www.aana.com/" target="_blank" rel="noopener">AANA</a></p>${items.length?items.map(x=>`<div class="item"><strong>${escapeHTML(x.label)}</strong> · ${fmt(x.date)} <span class="${x.days<0?'expired':x.days<=7?'expired':x.days<=30?'warning':'success'}">${x.days<0?('Expired '+Math.abs(x.days)+' days ago'):(x.days===0?'Due today':('Due in '+x.days+' days'))}</span><div class="muted">${escapeHTML(x.source)}</div></div>`).join(''):'<p class="muted">No credential deadlines within their reminder windows.</p>'}</section>`;
}
function ceTotal(records,type){return records.filter(r=>!type||r.class===type).reduce((s,r)=>s+num(r.credits),0)}
function ceForm(kind,label,record){
  return `<form data-kind="${kind}"><div class="form-grid">${field('title','Course / activity','text',record.title||'','required')}${field('date','Date','date',record.date||localDate(new Date()))}${field('credits','Credits','number',record.credits??'','min="0" step="0.25"')}${kind==='nbcrnaCE'?select('class','Class',['Class A','Class B','Other'],record.class||'Class A'):field('note','Notes','text',record.note||'')}</div>${formEnd(editId?'Save CE record':'Add CE record')}</form>`;
}

// --- Ask Assistant (local-first) ---
// Local answer engine only: no network calls, no third-party AI service, no
// API key anywhere in this file. Answers about the user's own records are
// computed from the data already loaded in `db` (localStorage). Anything not
// in `db` is reported as missing, never invented. Facility notes are never
// quoted in answers (they may hold authorized facility codes), and no
// passwords or patient information are stored or shown here.
const ASSISTANT_STARTERS=['How can CRNA Hub help me?','What shifts do I have coming up?',"What's my projected income this month?",'What credentials are expiring soon?'];
function assistantClinical(q){return /\b(patient|diagnos|treatment|prescri|dosage|\bdose\b|drug interaction|intubat|airway management|anesthet\w+ (for|plan|technique)|clinical decision|symptom|disease)\b/i.test(q)}
function assistantUpcoming(){const now=localDate(new Date());return db.shifts.filter(x=>x.date>=now).sort((a,b)=>a.date.localeCompare(b.date))}
function assistantMonthShifts(){const prefix=localDate(new Date()).slice(0,7);return db.shifts.filter(x=>x.date?.startsWith(prefix))}
function answerQuestion(raw){
  const q=String(raw||'').trim();if(!q)return 'Ask me something — try one of the suggested questions below.';
  const l=q.toLowerCase();
  if(assistantClinical(q))return 'I can\'t answer clinical questions — CRNA Hub is an administrative assistant, not clinical decision support, and it holds no patient information. For a clinical question, check your facility protocols, a current clinical reference, or a qualified colleague. I can help with scheduling, income, credentials, mileage, and PTO instead.';
  if(/help me|what (can|does) (this|crna hub)|how (do|does) (this|crna hub|it) work|getting started|what is crna hub/.test(l))return 'CRNA Hub is your schedule, income, and professional life in one place. Use the Dashboard calendar to see shifts and expected gross, the Dashboard Add shift button to add shifts, Facilities to store each hospital and its rates, Credentials for NBCRNA, AANA, and state licenses with 90/60/30/7-day reminders, Mileage to log and export business trips, and PTO to track a W-2 balance. Everything in this release is stored on this device only — no cloud sync yet, so export backups regularly.';
  if(/shift.*(coming|upcoming|next)|upcoming shift/.test(l)){const up=assistantUpcoming();if(!up.length)return 'You have no upcoming shifts recorded on this device. Add one from the Dashboard, or import a schedule CSV.';const top=up.slice(0,5),total=up.reduce((s,x)=>s+num(x.pay),0);return `You have ${up.length} upcoming shift(s) recorded, worth ${currency(total)} in expected gross. Next up: ${top.map(x=>`${fmt(x.date)} at ${x.facility} (${x.type}, ${currency(x.pay)})`).join('; ')}${up.length>5?` — plus ${up.length-5} more.`:''}`}
  if(/this year|year.*(income|gross|earn|pay)|income.*year|annual (income|gross|pay)|how much.*year/.test(l)){const y=currentYear(),cur=shiftsForYear(y),gross=yearGross(y);if(!cur.length)return `No shifts are recorded for ${y} yet, so I can't project this year's income. Add shifts or import a CSV, and this answer will use them.`;return `Projected income for ${y}, from recorded shifts only: ${currency(gross)} across ${cur.length} shift(s). Shifts from other years are not included in that total. Note: this is one combined total for all recorded shifts — not the separate confirmed / submitted-inclusive / proposed-inclusive forecasts in the product plan, and not paid income.`}
  if(/income|projected|earn|gross|pay.*month|this month/.test(l)){const cur=assistantMonthShifts(),gross=cur.reduce((s,x)=>s+num(x.pay),0);if(!cur.length)return 'No shifts are recorded for this month, so I can\'t project income yet. Add shifts or import a CSV, and this answer will use them.';const by={};cur.forEach(x=>{by[x.facility||'Unknown']=(by[x.facility||'Unknown']||0)+num(x.pay)});return `Projected income this month, from recorded shifts only: ${currency(gross)} across ${cur.length} shift(s). By facility: ${Object.entries(by).map(([f,v])=>`${f} ${currency(v)}`).join('; ')}. Note: this build does not yet track confirmed vs. submitted vs. proposed status, so this is one combined total for all recorded shifts — not the separate confirmed / submitted-inclusive / proposed-inclusive forecasts in the product plan, and not paid income.`}
  if(/credential|license|nbcrna|aana|expir/.test(l)){const d=credentialDeadlines();if(!d.length)return 'No credential deadlines are inside their reminder windows right now, based on the records on this device. Check the Credentials tab to confirm your NBCRNA, AANA, and state license dates are entered.';return `Credentials needing attention: ${d.slice(0,8).map(x=>`${x.label} — ${fmt(x.date)} (${x.days<0?('expired '+Math.abs(x.days)+' days ago'):x.days===0?'due today':('due in '+x.days+' days')})`).join('; ')}. Records a portal pull brought back are labelled with their source; the rest are user-entered and not verified by NBCRNA, AANA, or a state board.`}
  if(/mileage|miles|trip/.test(l)){if(!db.mileage.length)return 'No mileage trips are logged yet. Log one from the Mileage tab, or generate schedule-based drafts there and confirm each trip.';const total=db.mileage.reduce((s,x)=>s+num(x.miles),0),draft=db.mileage.filter(x=>x.status==='draft').length;return `Mileage on this device: ${total.toFixed(1)} miles across ${db.mileage.length} trip(s), including ${draft} draft(s) still needing confirmation. Drafts are not verified trips — confirm the trip occurred and the actual miles before using them.`}
  if(/\bpto\b|time off|vacation/.test(l)){const bal=num(db.settings.ptoStarting)+db.pto.reduce((s,x)=>s+num(x.hours),0);return `Your recorded W-2 PTO balance is ${bal.toFixed(2)} hours, from ${db.pto.length} ledger entr(ies). This is what you recorded here — your employer's actual balance may differ.`}
  if(/facilit|hospital/.test(l)){if(!db.facilities.length)return 'No facilities are saved yet. Add one from the Facilities tab with its rates, and shifts can then use those rates.';return `You have ${db.facilities.length} facilit(ies) saved: ${db.facilities.map(f=>`${f.name} (8h ${currency(f.rate8)}, 24h ${currency(f.rate24)}, 2nd call ${currency(f.rateSecond)})`).join('; ')}. I don't quote facility notes here, since they may hold authorized facility codes.`}
  if(/contract|rate|pay.*(shift|call|hour)/.test(l))return 'Each facility stores a flat rate for 8-hour, 24-hour, and second-call shifts. The Import & Backup tab also has a deterministic contract import (text, CSV text, .ics, and text-based PDF): it parses facility names, dates, shift types, and stated rates, shows a preview for your approval, and links approved shifts to a saved contract record. No AI model reads the document in this release, and contract pictures are read entirely on your device with OCR (Tesseract.js) plus the same deterministic parser — no picture is sent to a server for OCR, and no AI model reads the document.';
  if(/ce |continuing education|credits/.test(l)){const a=ceTotal(db.nbcrnaCE,'Class A'),b=ceTotal(db.nbcrnaCE,'Class B'),n=db.nbcrna||{},aa=db.aana||{};return `CE recorded here — NBCRNA: ${a} Class A and ${b} Class B credits from ${db.nbcrnaCE.length} record(s); MAC Ed ${n.macEd||0} of ${n.macEdRequired||60}, MAC Dev ${n.macDev||0} of ${n.macDevRequired||40}. AANA: ${ceTotal(db.aanaCE)} credits from ${db.aanaCE.length} record(s). These are user-entered totals, not a live AANA/NBCRNA transcript.`}
  if(/sync|cloud|supabase|account|sign ?in|backup/.test(l))return cloudAssistantAnswer();
  if(/c\/s\/p|confirmed|submitted|proposed|forecast/.test(l))return 'The planned income model splits forecasts into C (confirmed shifts only), S (confirmed + submitted, if all submitted dates are approved), and P (confirmed + submitted + proposed). This build does not track shift status yet, so it can only show one combined total for recorded shifts — the C/S/P split is a planned feature, not a live one.';
  return 'I can answer from what is actually recorded on this device: upcoming shifts, this month\'s projected income, credentials expiring soon, facilities and their rates, mileage, PTO, and CE totals — plus how CRNA Hub itself works. Try one of the suggested questions, or ask about one of those topics. I won\'t guess at records that aren\'t here, and I don\'t answer clinical questions.';
}
function assistantPage(){
  const hist=db.assistantChat||[];
  return `<section class="panel"><h2>Ask Assistant</h2><p class="muted">Local assistant — answers come only from this app and the records on this device. No live AI model is connected yet, and nothing is sent to any outside service. For account and cloud-sync status, see the Account tab. It cannot answer clinical questions and never shows facility codes, passwords, or patient information.</p><div class="chat">${hist.length?hist.map(m=>`<div class="msg ${m.role==='user'?'user':'assistant'}"><strong>${m.role==='user'?'You':'Assistant'}</strong><div>${escapeHTML(m.text)}</div></div>`).join(''):'<p class="muted">Ask about your schedule, income, credentials, mileage, or how CRNA Hub works.</p>'}</div><div class="toolbar" style="margin-top:12px">${ASSISTANT_STARTERS.map(q=>`<button type="button" class="secondary tiny" data-action="ask" data-id="${escapeHTML(q)}">${escapeHTML(q)}</button>`).join('')}</div><form id="assistantForm" class="chat-form"><label for="assistantInput" class="muted">Your question</label><input id="assistantInput" name="question" type="text" placeholder="Ask about your shifts, income, or credentials…" autocomplete="off"><button type="submit">Ask</button></form><div class="toolbar"><button type="button" class="secondary tiny" data-action="clear-chat">Clear chat history</button></div></section>`;
}
function submitAssistant(e){e.preventDefault();const input=$('assistantInput');if(!input)return;const q=input.value.trim();if(!q)return;db.assistantChat=[...(db.assistantChat||[]),{role:'user',text:q},{role:'assistant',text:answerQuestion(q)}].slice(-50);persist();render();const box=document.querySelector('.chat');if(box)box.scrollTop=box.scrollHeight}

function render(){ const ss=$('storageStatus');if(ss)ss.textContent=cloudHeaderLabel();$('nav').innerHTML=tabs.map(t=>`<button class="${tab===t?'active':''}" data-tab="${escapeHTML(t)}">${escapeHTML(t)}</button>`).join('');$('app').innerHTML=({Dashboard:dashboard,Facilities:facilitiesPage,PTO:ptoPage,Credentials:credentialsPage,Mileage:mileagePage,'Import & Backup':importPage,Assistant:assistantPage,Account:accountPage}[tab])();document.querySelectorAll('[data-tab]').forEach(b=>b.addEventListener('click',()=>setTab(b.dataset.tab)));document.querySelectorAll('[data-action]').forEach(b=>b.addEventListener('click',()=>actions(b.dataset.action,b.dataset.id,b.dataset.date)));document.querySelectorAll('form[data-kind]').forEach(f=>f.addEventListener('submit',submitEntry));const mt=$('manualTypeSelect');if(mt)mt.addEventListener('change',()=>{manualType=mt.value;editId=null;render();});const ssy=$('savedShiftsYear');if(ssy)ssy.addEventListener('change',()=>{savedShiftsYear=+ssy.value;render();});const importForm=$('importForm');if(importForm)importForm.addEventListener('submit',importCsv);const restore=$('restoreFile');if(restore)restore.addEventListener('change',restoreBackup);const contractForm=$('contractForm');if(contractForm)contractForm.addEventListener('submit',importContract);const calendarForm=$('calendarForm');if(calendarForm)calendarForm.addEventListener('submit',importCalendar);document.querySelectorAll('.calEdit').forEach(el=>el.addEventListener('change',()=>{if(!calPreview)return;const r=calPreview.rows[+el.dataset.row];if(r)r[el.dataset.field]=el.value}));document.querySelectorAll('.calInclude').forEach(el=>el.addEventListener('change',()=>{if(!calPreview)return;const r=calPreview.rows[+el.dataset.row];if(r)r.include=el.checked}));document.querySelectorAll('.contractEdit').forEach(el=>el.addEventListener('change',()=>{if(!contractPreview)return;const r=contractPreview.rows[+el.dataset.row];if(r)r[el.dataset.field]=el.value}));document.querySelectorAll('.contractInclude').forEach(el=>el.addEventListener('change',()=>{if(!contractPreview)return;const r=contractPreview.rows[+el.dataset.row];if(r)r.include=el.checked}));const af=$('assistantForm');if(af)af.addEventListener('submit',submitAssistant);const cf=$('cloudAuthForm');if(cf)cf.addEventListener('submit',submitCloudAuth)}
function field(name,label,type='text',value='',extra=''){return `<div class="field"><label for="f_${name}">${label}</label><input id="f_${name}" name="${name}" type="${type}" value="${escapeHTML(value)}" ${extra}></div>`}
function area(name,label,value='',placeholder=''){return `<div class="field wide"><label for="f_${name}">${label}</label><textarea id="f_${name}" name="${name}" placeholder="${escapeHTML(placeholder)}">${escapeHTML(value)}</textarea></div>`}
function select(name,label,options,value){return `<div class="field"><label for="f_${name}">${label}</label><select name="${name}" id="f_${name}">${options.map(o=>`<option value="${escapeHTML(o)}" ${o===value?'selected':''}>${escapeHTML(o)}</option>`).join('')}</select></div>`}
function formEnd(label){return `<div class="form-actions"><button type="submit">${label}</button>${editId?'<button type="button" class="secondary" data-action="cancel">Cancel</button>':''}</div></form>`}
function list(kind,items,description){return items.length?items.map(x=>`<div class="item"><div>${description(x)}</div><div class="item-actions"><button class="tiny secondary" data-action="edit-${kind}" data-id="${escapeHTML(x.id)}">Edit</button><button class="tiny danger" data-action="delete-${kind}" data-id="${escapeHTML(x.id)}">Delete</button></div></div>`).join(''):'<p class="muted">No records yet.</p>'}
function calendar(){const y=month.getFullYear(),m=month.getMonth(),prefix=`${y}-${String(m+1).padStart(2,'0')}`,start=new Date(y,m,1).getDay(),days=new Date(y,m+1,0).getDate();let grid=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(x=>`<div class="weekday">${x}</div>`).join('');for(let n=0;n<start;n++)grid+='<div class="day blank"></div>';for(let n=1;n<=days;n++){const date=`${prefix}-${String(n).padStart(2,'0')}`,entries=db.shifts.filter(x=>x.date===date);grid+=`<button class="day ${date===localDate(new Date())?'today':''} ${date===selected?'selected':''}" data-action="day" data-date="${date}" aria-label="${fmt(date)}: ${entries.length} shifts"><span class="day-number">${n}</span>${entries.slice(0,3).map(x=>`<span class="chip ${/24.hour/i.test(x.type)?'call':/second/i.test(x.type)?'second':/off|pto/i.test(x.type)?'off':''}">${escapeHTML(x.facility||'Off')}<br>${escapeHTML(x.type||'Shift')}</span>`).join('')}${entries.length>3?`<span class="muted">+${entries.length-3}</span>`:''}</button>`}const shifts=db.shifts.filter(x=>x.date?.startsWith(prefix));return `<section class="panel"><div class="toolbar"><button class="secondary" data-action="prev" aria-label="Previous month">‹</button><h2>${month.toLocaleDateString('en-US',{month:'long',year:'numeric'})}</h2><button class="secondary" data-action="next" aria-label="Next month">›</button><button class="secondary tiny" data-action="today">Today</button></div><div class="calendar">${grid}</div><p class="muted">${shifts.length} shifts · ${currency(shifts.reduce((s,x)=>s+num(x.pay),0))} expected gross this month · Tap a day to add a shift</p></section>`}

function onboardingSteps(){
  const signedIn = (typeof cloudSession !== 'undefined') && !!cloudSession;
  const calConnected = (typeof liveSyncConnectedProviders === 'function') ? liveSyncConnectedProviders().length > 0 : false;
  const cred = (typeof cloudLocalHasRecords === 'function') ? cloudLocalHasRecords() : ((db.licenses || []).length > 0);
  const docs = (db.documents || []).length > 0;
  const contracts = (db.contracts || []).length > 0;
  return [
    {n:1, title:'Create your account', desc:'Sign in on the Account tab so credential records sync to your cloud account.', done:signedIn, tab:'Account', panel:''},
    {n:2, title:'Sync your calendars', desc:'Google connects with one click. Apple needs a one-time app-specific password created in your Apple account. Outlook is not available yet — no Microsoft Entra app is registered — so use .ics import/export for Outlook for now.', done:calConnected, tab:'Import & Backup', panel:'live-sync-panel'},
    {n:3, title:'Connect credentialing services and licenses', desc:'NBCRNA (public lookup, no password), AANA (one-time sign-in), and state licenses — the Connect cards pull what each source allows. WV and Ohio block automation, so those give the manual route. Records a portal pulls are labelled with their source; the manual-entry fallback stays user-entered, not verified. This step checks off when a credential record is on file — that does NOT mean a portal pulled it.', done:cred, tab:'Credentials', panel:''},
    {n:4, title:'Upload certifications', desc:'ACLS, BLS, PALS, NRP, or another certification. The expiration date is read from the document — text files, text-layer PDFs, and photos of cards (read on your device with OCR). Check the date it finds and correct it if it is wrong; you can edit it any time. Standard reminder: 3 months before expiration.', done:docs, tab:'Credentials', panel:'cert-documents'},
    {n:5, title:'Upload current contracts', desc:'Text, CSV, .ics, text-layer PDF, or a photo (read entirely on your device). Everything is shown in a preview first — nothing is saved until you approve it.', done:contracts, tab:'Import & Backup', panel:'contract-panel'}
  ];
}
function onboardingHTML(){
  if (db.settings && db.settings.onboardingDismissed) return '';
  const steps = onboardingSteps();
  if (steps.every(x => x.done)) return '';
  const doneCount = steps.filter(x => x.done).length;
  return `<section class="panel"><h2>Getting started</h2><p class="muted">${doneCount} of 5 done — in order. No step collects a portal password, and no step is marked done unless the record behind it actually exists.</p><ol class="onboard-steps">${steps.map(x => `<li class="onboard-step ${x.done ? 'done' : ''}"><span class="onboard-check">${x.done ? '✓' : '○'}</span><div><strong>${x.n}. ${escapeHTML(x.title)}</strong>${x.done ? ' <span class="pill">done</span>' : ''}<div class="muted">${escapeHTML(x.desc)}</div><div class="toolbar"><button type="button" class="${x.done ? 'secondary' : ''}" data-action="onboard-goto" data-id="${escapeHTML(x.tab)}"${x.panel ? ` data-date="${x.panel}"` : ''}>${x.done ? 'Review' : 'Start'} →</button></div></div></li>`).join('')}</ol><div class="toolbar"><button type="button" class="secondary tiny" data-action="onboard-dismiss">Skip for now — hide this guide</button></div><p class="muted">Hiding this guide deletes nothing. You can still reach every step from its tab above.</p></section>`;
}
function dashboard(){const now=localDate(new Date()),prefix=now.slice(0,7),current=db.shifts.filter(x=>x.date?.startsWith(prefix)),gross=current.reduce((s,x)=>s+num(x.pay),0),upcoming=db.shifts.filter(x=>x.date>=now).sort((a,b)=>a.date.localeCompare(b.date)).slice(0,6),expiring=credentialDeadlines().length;return `<section class="panel"><h2>Overview · ${new Date().toLocaleDateString('en-US',{month:'long',year:'numeric'})}</h2><div class="stats"><div class="stat"><strong>${current.length}</strong>Shifts this month</div><div class="stat"><strong>${currency(gross)}</strong>Expected gross · this month</div><div class="stat"><strong>${currency(yearGross(currentYear()))}</strong>${currentYear()} gross · planned</div><div class="stat"><strong>${db.facilities.length}</strong>Facilities</div><div class="stat"><strong>${expiring}</strong>Credential deadlines (90 days)</div></div></section>${onboardingHTML()}${(showShiftForm||editId&&db.shifts.some(x=>x.id===editId))?shiftFormHTML():''}${calendar()}${credentialDeadlinesPanel()}<div class="two"><section class="panel"><h2>Upcoming shifts</h2>${upcoming.length?upcoming.map(x=>`<div class="item"><strong>${fmt(x.date)}</strong> · ${escapeHTML(x.facility)}<div class="muted">${escapeHTML(x.type)} · ${x.pay===''||x.incomplete?'Pay not yet priced':currency(x.pay)}</div></div>`).join(''):'<p class="muted">No upcoming shifts.</p>'}</section><section class="panel"><h2>Quick actions</h2><div class="toolbar"><button data-action="add-shift">Add shift</button><button class="secondary" data-action="export-shifts">Export shifts</button><button class="secondary" data-action="backup">Back up data</button><button class="secondary" data-action="ask-assistant">Ask Assistant</button></div><p class="hint">${cloudModeHint()} Export backups regularly.</p></section></div>${savedShiftsHTML()}`}
function shiftFormHTML(){const x=db.shifts.find(x=>x.id===editId)||{},f=db.facilities;return `<section class="panel"><h2>${editId?'Edit':'Add'} shift</h2><form id="entryForm" data-kind="shifts"><div class="form-grid">${field('date','Date','date',x.date||selected,'required')}${field('facility','Hospital / facility','text',x.facility||'','list="facilityNames" required')}<datalist id="facilityNames">${f.map(a=>`<option value="${escapeHTML(a.name)}"></option>`).join('')}</datalist>${select('type','Shift type',['8-hour day','12-hour shift','24-hour call','Second call','Other','Off / PTO'],x.type||'8-hour day')}${field('pay','Expected gross pay ($)','number',x.pay??'','min="0" step="0.01" placeholder="Auto from facility"')}${area('note','Shift notes',x.note||'')}</div>${formEnd(editId?'Save changes':'Add shift')}${editId?'':''}<p class="muted">Leave pay blank to apply the saved facility rate for 8-hour, 24-hour, or second call shifts.</p>${editId?'':'<div class="toolbar"><button type="button" class="secondary" data-action="cancel">Close form</button></div>'}</section>`}
function savedShiftsHTML(){const y=selectedShiftsYear(),yearShifts=shiftsForYear(y),allGross=db.shifts.reduce((s,x)=>s+num(x.pay),0),years=shiftYears();return `<section class="panel"><h2>Saved shifts</h2><div class="toolbar"><label for="savedShiftsYear" class="muted">Year</label><select id="savedShiftsYear">${years.map(yr=>`<option value="${yr}" ${+yr===y?'selected':''}>${yr}</option>`).join('')}</select></div><div class="summary"><div><strong>${yearShifts.length}</strong><div class="muted">Shifts in ${y}</div></div><div><strong>${currency(yearGross(y))}</strong><div class="muted">${y} gross</div></div></div><p class="muted">${db.shifts.length} shifts all time · ${currency(allGross)} all recorded gross (all years). Shifts from other years stay listed below — only the total above is scoped to ${y}.</p>${list('shifts',db.shifts.slice().sort((a,b)=>b.date.localeCompare(a.date)),x=>`<div class="item-title">${fmt(x.date)} · ${escapeHTML(x.facility)}</div><div class="muted">${escapeHTML(x.type)} · ${x.pay===''||x.incomplete?'Pay not yet priced — incomplete':currency(x.pay)}${x.source==='extracted-from-contract'?' · <span class="pill">from contract</span>':x.source==='extracted-from-contract-photo'?' · <span class="pill">from contract photo</span>':x.source==='user-entered'?' · <span class="pill">user-entered</span>':x.source&&x.source.startsWith('calendar-')?' · <span class="pill">'+escapeHTML({"calendar-google":"from Google Calendar","calendar-apple":"from Apple Calendar","calendar-outlook":"from Outlook","calendar-file":"from calendar file"}[x.source]||'from calendar')+'</span>':''}</div><div class="muted"><a href="${googleCalUrl(x)}" target="_blank" rel="noopener">Add to Google</a> · <a href="${outlookCalUrl(x)}" target="_blank" rel="noopener">Add to Outlook</a></div></div>${x.note?`<p>${escapeHTML(x.note)}</p>`:''}`)}</section>`}
function facilitiesPage(){const x=db.facilities.find(x=>x.id===editId)||{};return `<section class="panel"><h2>${editId?'Edit':'Add'} hospital</h2><form id="entryForm" data-kind="facilities"><div class="form-grid">${field('name','Hospital / facility name','text',x.name||'','required')}${field('address','Address','text',x.address||'')}${field('rate8','8-hour shift rate ($)','number',x.rate8||'','min="0" step="0.01"')}${field('rate24','24-hour call rate ($)','number',x.rate24||'','min="0" step="0.01"')}${field('rateSecond','Second call rate ($)','number',x.rateSecond||'','min="0" step="0.01"')}${field('distance','One-way miles (manual)','number',x.distance||'','min="0" step="0.1"')}${area('notes','Offline facility notes',x.notes||'','Parking, protocols, phone numbers, authorized facility codes, EHR URL or username (never passwords)')}</div>${formEnd(editId?'Save facility':'Add facility')}</section><section class="panel"><h2>My facilities</h2>${list('facilities',db.facilities,x=>`<div class="item-title">${escapeHTML(x.name)}</div><div class="muted">${escapeHTML(x.address||'No address')} · 8h ${currency(x.rate8)} · 24h ${currency(x.rate24)} · 2nd ${currency(x.rateSecond)} · ${escapeHTML(x.distance||'—')} miles one-way</div>${x.notes?`<p style="white-space:pre-wrap">${escapeHTML(x.notes)}</p>`:''}`)}<p class="hint">Facility notes are stored unencrypted in this browser. Do not save passwords or patient information. Use authorized facility codes only on a trusted device.</p></section>`}
function ptoPage(){const x=db.pto.find(x=>x.id===editId)||{},balance=num(db.settings.ptoStarting)+db.pto.reduce((s,x)=>s+num(x.hours),0);return `<div class="two"><section class="panel"><h2>W-2 PTO balance</h2><div class="stat"><strong>${balance.toFixed(2)} hours</strong>Current recorded balance</div><p class="muted">Positive hours accrue; negative hours are PTO used. Your employer's actual balance may differ.</p><div class="form-grid">${field('starting','Starting balance (hours)','number',db.settings.ptoStarting||0,'step="0.25"')}${field('annual','Annual allowance (hours)','number',db.settings.ptoAnnual||0,'step="0.25"')}${field('perperiod','Accrual per pay period (hours)','number',db.settings.ptoHoursPerPeriod||0,'step="0.25"')}</div><div class="form-actions"><button data-action="save-pto-settings">Save PTO rules</button><button class="secondary" data-action="post-accrual">Post pay-period accrual</button></div></section><section class="panel"><h2>${editId?'Edit':'Record'} PTO</h2><form id="entryForm" data-kind="pto"><div class="form-grid">${field('date','Date','date',x.date||localDate(new Date()),'required')}${field('hours','Hours (+ earned / − used)','number',x.hours??'','step="0.25" required')}${field('note','Description','text',x.note||'')}</div>${formEnd(editId?'Save entry':'Record PTO')}</section></div><section class="panel"><h2>PTO ledger</h2>${list('pto',db.pto.slice().sort((a,b)=>b.date.localeCompare(a.date)),x=>`<strong>${fmt(x.date)}</strong> · <span class="${num(x.hours)<0?'expired':'success'}">${num(x.hours)>0?'+':''}${escapeHTML(x.hours)} hours</span><div class="muted">${escapeHTML(x.note||'')}</div>`)}</section>`}

// --- Certification documents (ACLS / BLS / PALS / NRP) ---
// Directly under State Licenses on the Credentials tab. Files go to private
// Supabase Storage (bucket certification-documents, path <user_id>/<file>)
// when signed in and synced; otherwise only metadata is kept on-device and
// the UI says so plainly. Never a public URL. Expiration dates are parsed
// from the document where the document actually states one, never invented:
// text files and text-layer PDFs from their text, images with on-device OCR
// (Tesseract.js, loaded only when a picture is chosen — no picture is sent
// to a server for OCR). A date the user edits by hand is stored as
// user-entered. Standard reminder: 3 months (90 days) before expiration,
// plus 60, 30 and 7 days.
let docStorageError = '';
let docOcrStatus = '';
function docEndOfMonth(y, m) { const dt = new Date(Date.UTC(y, m, 0)); return dt.toISOString().slice(0, 10); }
function addDaysISO(dateStr, n) { if (!dateStr) return ''; const d = new Date(dateStr + 'T12:00:00'); if (Number.isNaN(d.getTime())) return ''; d.setDate(d.getDate() + n); return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-'); }
function docStorageStatus() {
  if (!SUPABASE_CONFIGURED) return 'Supabase not configured — sign in and storage are unavailable, so file details here are saved on this device only and the file itself is not stored.';
  if (!cloudSession) return 'Sign in and enable document storage to upload files. Until you sign in on the Account tab, file details here are saved on this device only — the file itself is not stored.';
  if (cloudPending || !cloudActive) return 'Signed in — choose upload or load on the Account tab first. Until then, file details here are saved on this device only — the file itself is not stored.';
  return 'Signed in and syncing — uploaded files go to your private Supabase Storage folder (your user ID only, never a public URL). If an upload fails, the certification-documents bucket has probably not been created yet — see the migration 002 steps in the README.';
}
function docValidISO(y, m, d) { if (!y || m < 1 || m > 12 || d < 1 || d > 31) return ''; const dt = new Date(Date.UTC(y, m - 1, d)); if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return ''; return dt.toISOString().slice(0, 10); }
function parseDocDate(raw) {
  const s = String(raw || '').trim().replace(/\b(\d+)(st|nd|rd|th)\b/gi, '$1');
  let m;
  const months = '(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)';
  const mi = { january: 1, jan: 1, february: 2, feb: 2, march: 3, mar: 3, april: 4, apr: 4, may: 5, june: 6, jun: 6, july: 7, jul: 7, august: 8, aug: 8, september: 9, sep: 9, sept: 9, october: 10, oct: 10, november: 11, nov: 11, december: 12, dec: 12 };
  if ((m = s.match(new RegExp('^' + months + '\\s+(\\d{1,2}),?\\s+(\\d{4})$', 'i')))) return docValidISO(+m[3], mi[m[1].toLowerCase()], +m[2]);
  if ((m = s.match(new RegExp('^(\\d{1,2})\\s+' + months + '\\s+(\\d{4})$', 'i')))) return docValidISO(+m[3], mi[m[2].toLowerCase()], +m[1]);
  if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/))) return docValidISO(+m[1], +m[2], +m[3]);
  if ((m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/))) return docValidISO(+m[3], +m[1], +m[2]);
  if ((m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})$/))) return docValidISO(2000 + +m[3], +m[1], +m[2]);
  // Month/year only (common on AHA cards, e.g. "12/2027" or "Dec 2027"):
  // read as the last day of that month, and the UI asks the user to check it.
  if ((m = s.match(/^(\d{1,2})\/(\d{4})$/))) { if (+m[1] >= 1 && +m[1] <= 12) return docEndOfMonth(+m[2], +m[1]); return ''; }
  if ((m = s.match(new RegExp('^' + months + '\\s+(\\d{4})$', 'i')))) return docEndOfMonth(+m[2], mi[m[1].toLowerCase()]);
  return '';
}
function normalizeOcrDateText(t) {
  // Tesseract often reads 0 as O and 1 as l/I, and '/' as l or 1, inside dates.
  // Normalise only digit-adjacent characters so ordinary words are untouched.
  let x = String(t || '');
  // 'O' read for '0': at the start of a date token ("O6/2028"), after a digit
  // ("3O/2028"), or between digits ("2O28"). Only digit-adjacent, so words
  // like "Provider" are untouched.
  x = x.replace(/(^|[^\dA-Za-z])[Oo](\d)/g, '$10$2');
  x = x.replace(/(\d)[Oo](?![A-Za-z])/g, '$10');
  // '/' read as 'l', 'I' or '|': normalise after the O fixes above, so
  // "12l2O27" first becomes "12l2027" and then "12/2027".
  x = x.replace(/(\d{1,2})[lI|](\d{1,2})[lI|](\d{2,4})/g, '$1/$2/$3');
  x = x.replace(/(\d{1,2})[lI|](\d{4})/g, '$1/$2');
  // Remaining 'l'/'I' next to a digit is a '1' ("l5" -> "15").
  x = x.replace(/(^|[^\dA-Za-z])[lI](\d)/g, '$11$2');
  x = x.replace(/(\d)[lI](?![A-Za-z])/g, '$11');
  return x;
}
function extractExpiryDateInfo(text, opts) {
  const raw = String(text || '');
  let t = raw.replace(/\s+/g, ' ');
  if (opts && opts.ocr) t = normalizeOcrDateText(t);
  const months = '(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)';
  const datePat = '(?:' + months + '\\s+\\d{1,2},?\\s+\\d{4}|' + months + '\\s+\\d{4}|\\d{1,2}\\s+' + months + '\\s+\\d{4}|\\d{4}-\\d{2}-\\d{2}|\\d{1,2}\\/\\d{1,2}\\/\\d{2,4}|\\d{1,2}\\/\\d{4})';
  // 1) A date next to an expiration label — the confident case.
  const re = new RegExp('(?:exp\\.?\\s*(?:iration)?\\s*(?:date)?|expir\\w*(?:\\s+date)?|valid\\s+(?:thru|through|until|to)|good\\s+through|renewal\\s+date|certification\\s+expires?|card\\s+expires?)[^0-9]{0,40}(' + datePat + ')', 'gi');
  let m;
  while ((m = re.exec(t))) { const iso = parseDocDate(m[1]); if (iso) return { iso, via: 'label' }; }
  // 2) No labelled date: take the latest date in the document, but only when
  // there are at least two distinct dates — on a cert card the later one is
  // the expiration (the earlier one is the issue date). With a single date
  // there is no way to tell issue from expiration, so return nothing rather
  // than guess. The caller tells the user to check a fallback date.
  const all = new RegExp('(' + datePat + ')', 'gi');
  const seen = [];
  while ((m = all.exec(t))) { const iso = parseDocDate(m[1]); if (iso && seen.indexOf(iso) === -1) seen.push(iso); }
  if (seen.length >= 2) { seen.sort(); return { iso: seen[seen.length - 1], via: 'latest-date' }; }
  return { iso: '', via: 'none' };
}
function extractExpiryDate(text, opts) { return extractExpiryDateInfo(text, opts).iso; }
function documentsSection(doc) {
  const docs = (db.documents || []).slice().sort((a, b) => (a.expiry || '9999').localeCompare(b.expiry || '9999'));
  return `<section class="panel" id="cert-documents"><h2>Certification documents</h2><p class="muted">${escapeHTML(docStorageStatus())}</p><p class="muted">Upload a certification card or certificate for ACLS, BLS, PALS, NRP, or another certification. When the document states an expiration / valid-through date, it is read from the document and shown below — check it and correct it if it is wrong: text files and text-layer PDFs from their text, and photos of cards with on-device OCR (Tesseract.js, loaded only when you pick a picture — no picture is sent to a server for OCR). A date read from a month/year only (e.g. "Dec 2027") is taken as the last day of that month — check it. A document that states no expiration is marked "no expiration found": enter the date manually. Nothing here is invented. <strong>Standard reminder: 3 months (90 days) before expiration</strong>, plus 60, 30 and 7 days — expiring certifications appear on the Dashboard under Credential deadlines at those windows. You can edit the issue and expiration dates on any saved certification with its Edit button.</p>${docOcrStatus ? `<p class="hint" id="docOcrStatus">${escapeHTML(docOcrStatus)}</p>` : ''}${docStorageError ? `<p class="hint">Storage note: ${escapeHTML(docStorageError)}</p>` : ''}
  <form data-kind="documents"><div class="form-grid">${select('type', 'Certification type', ['ACLS', 'BLS', 'PALS', 'NRP', 'Other'], doc.certType && ['ACLS', 'BLS', 'PALS', 'NRP'].includes(doc.certType) ? doc.certType : (doc.certType ? 'Other' : 'ACLS'))}${field('otherType', 'Other certification (if Other)', 'text', doc.certType && !['ACLS', 'BLS', 'PALS', 'NRP'].includes(doc.certType) ? doc.certType : '')}${field('issue', 'Issue date', 'date', doc.issue || '')}${field('expiry', 'Expiration date (leave blank to read it from the file)', 'date', doc.expiry || '')}${field('file', 'Certification document file', 'file', '', 'accept=".pdf,.txt,.png,.jpg,.jpeg,.webp,.heic"')}</div>${formEnd(editId && db.documents.some(x => x.id === editId) ? 'Save certification document' : 'Add certification document')}</form>
  ${docs.length ? docs.map(x => { const d = daysUntil(x.expiry); const src = x.expirySource === 'extracted' ? 'Expiration extracted from document' : x.expirySource === 'user-entered' ? 'Expiration entered manually' : 'No expiration found'; return `<div class="item"><div><strong>${escapeHTML(x.certType || 'Certification')}</strong>${x.fileName ? ' · ' + escapeHTML(x.fileName) : ''}${x.issue ? ' · issued ' + fmt(x.issue) : ''}<div class="muted">${x.expiry ? ('Expires ' + fmt(x.expiry) + (d !== null ? ` <span class="${d < 0 ? 'expired' : d <= 7 ? 'expired' : d <= 30 ? 'warning' : 'success'}">${d < 0 ? ('Expired ' + Math.abs(d) + ' days ago') : d === 0 ? 'Due today' : ('Due in ' + d + ' days')}</span>` : '') + (addDaysISO(x.expiry, -90) ? ` · 3-month reminder ${fmt(addDaysISO(x.expiry, -90))}` : '')) : '<span class="warning">No expiration found — enter it manually</span>'} · ${src} · ${x.storagePath ? 'Stored in your private cloud storage' : 'File details on this device only — file not stored'}</div></div><div class="item-actions">${x.storagePath ? `<button class="tiny secondary" data-action="download-doc" data-id="${escapeHTML(x.id)}">Download</button>` : ''}<button class="tiny secondary" data-action="edit-documents" data-id="${escapeHTML(x.id)}">${x.storagePath ? 'Replace / edit' : 'Edit'}</button><button class="tiny danger" data-action="delete-documents" data-id="${escapeHTML(x.id)}">Delete</button></div></div>`; }).join('') : '<p class="muted">No certification documents yet.</p>'}</section>`;
}
async function submitDocument(e) {
  docStorageError = '';
  const form = e.currentTarget, fd = new FormData(form);
  const type = fd.get('type') || 'ACLS';
  const certType = type === 'Other' ? (String(fd.get('otherType') || '').trim() || 'Other certification') : type;
  const issue = fd.get('issue') || '', manualExpiry = fd.get('expiry') || '';
  const fileInput = form.querySelector('input[type="file"]'), file = fileInput && fileInput.files[0];
  const isEdit = editId && (db.documents || []).some(x => x.id === editId);
  const recId = isEdit ? editId : id();
  const oldRec = isEdit ? (db.documents || []).find(x => x.id === editId) : null;
  // A date the user types (or leaves as-is after changing it) is user-entered.
  // An edit that leaves the previously extracted date untouched keeps its
  // 'extracted' source; changing it flips the source to 'user-entered'.
  let expiry = manualExpiry, expirySource = manualExpiry ? ((isEdit && oldRec && manualExpiry === oldRec.expiry) ? (oldRec.expirySource || 'user-entered') : 'user-entered') : 'none', note = '';
  if (file) {
    try {
      if (/\.pdf$/i.test(file.name) || file.type === 'application/pdf') {
        const info = extractExpiryDateInfo(await extractPdfText(file));
        if (!manualExpiry && info.iso) { expiry = info.iso; expirySource = 'extracted'; if (info.via === 'latest-date') note = 'Expiration taken from the latest date in the document — please check it is the expiration date, not the issue date, and correct it if it is wrong.'; }
        else if (!manualExpiry) note = 'No expiration date found in this document — please enter it manually.';
      } else if (file.type.startsWith('text/') || /\.txt$/i.test(file.name)) {
        const info = extractExpiryDateInfo(await file.text());
        if (!manualExpiry && info.iso) { expiry = info.iso; expirySource = 'extracted'; if (info.via === 'latest-date') note = 'Expiration taken from the latest date in the document — please check it is the expiration date, not the issue date, and correct it if it is wrong.'; }
        else if (!manualExpiry) note = 'No expiration date found in this document — please enter it manually.';
      } else if (file.type.startsWith('image/') || /\.(png|jpe?g|webp|heic)$/i.test(file.name)) {
        // Photos of cards: read on this device with OCR (Tesseract.js, loaded
        // only now). No picture is sent to a server for OCR. The OCR text goes
        // through the same date extraction as text/PDFs, preferring a date
        // next to an expiration label. If OCR finds no confident date, say so
        // plainly — never invent one.
        docOcrStatus = 'Reading your picture on this device with OCR (Tesseract.js) — no picture is sent to a server for OCR. This can take a few seconds…';
        render();
        try {
          const ocrText = await ocrImageFile(file, m => { const el = document.getElementById('docOcrStatus'); if (el && m && m.status) el.textContent = `Reading your picture on this device with OCR… ${m.status}${m.progress != null ? ' ' + Math.round(m.progress * 100) + '%' : ''}`; });
          docOcrStatus = '';
          if (!ocrText.trim()) note = 'OCR read no text from this picture. Try a clearer, well-lit photo with the text upright, or enter the expiration date manually.';
          else {
            const info = extractExpiryDateInfo(ocrText, { ocr: true });
            if (!manualExpiry && info.iso) { expiry = info.iso; expirySource = 'extracted'; if (info.via === 'latest-date') note = 'Expiration taken from the latest date in the picture — please check it is the expiration date, not the issue date, and correct it if it is wrong.'; }
            else if (!manualExpiry) note = 'OCR read text from this picture but found no expiration date in it — please enter it manually.';
          }
        } catch (err) { docOcrStatus = ''; note = 'Could not read this picture with on-device OCR: ' + err.message + ' Try a clearer photo, or enter the expiration date manually.'; }
      } else { note = 'This file type could not be read for an expiration date — please enter it manually.'; }
    } catch (err) { docOcrStatus = ''; note = 'Could not read this file for an expiration date: ' + err.message + ' — please enter it manually.'; }
  } else if (!manualExpiry) note = 'No expiration entered and no file to read — enter the expiration manually.';
  let storagePath = oldRec ? oldRec.storagePath || '' : '', storageStatus = oldRec ? oldRec.storageStatus || 'local_details_only' : 'no_file', fileName = oldRec ? oldRec.fileName || '' : '';
  if (file) {
    fileName = file.name;
    if (cloudSyncEnabled()) {
      try {
        await cloudEnsureToken();
        const path = cloudUid() + '/' + recId + '-' + file.name.replace(/[^A-Za-z0-9._-]+/g, '_');
        if (oldRec && oldRec.storagePath && oldRec.storagePath !== path) { await sbStorageReq('/storage/v1/object/certification-documents/' + oldRec.storagePath.split('/').map(encodeURIComponent).join('/'), 'DELETE'); }
        const up = await sbStorageReq('/storage/v1/object/certification-documents/' + path.split('/').map(encodeURIComponent).join('/'), 'POST', file, file.type || 'application/octet-stream');
        if (!up.ok) throw new Error('Storage upload failed (' + up.status + '): ' + (await up.text()).slice(0, 200));
        storagePath = path; storageStatus = 'cloud';
      } catch (err) { docStorageError = err.message; storageStatus = 'local_details_only'; }
    } else { storageStatus = 'local_details_only'; }
  }
  const rec = { id: recId, certType, issue, expiry, expirySource, fileName, storagePath, storageStatus, uploadedAt: (oldRec && oldRec.uploadedAt) || cloudNow() };
  if (isEdit) db.documents = db.documents.map(x => x.id === recId ? rec : x); else db.documents = [...(db.documents || []), rec];
  editId = null; persist();
  // Show the saved record immediately, before the cloud round-trip: a slow or
  // failing cloud save must never leave the list looking empty after a save.
  docOcrStatus = '';
  render();
  if (cloudSyncEnabled()) { try { await sbReq('/rest/v1/documents', 'POST', cloudDocumentRow(rec)); } catch (err) { docStorageError = err.message; render(); } }
  let msg = 'Certification document saved.';
  if (expirySource === 'extracted') msg += ' Expiration extracted from the document: ' + fmt(expiry) + '. Check it and correct it if it is wrong.';
  else if (note) msg += ' ' + note;
  if (docStorageError) msg += ' Cloud storage note: ' + docStorageError + ' — the file details are saved on this device only; complete the document-storage dashboard step (see the README) and re-upload to store the file in the cloud.';
  alert(msg);
}
async function downloadDocument(entryId) {
  const rec = (db.documents || []).find(x => x.id === entryId);
  if (!rec || !rec.storagePath) return alert('This file is not stored in the cloud — only its details are saved here. Sign in, enable document storage, and re-upload the file to download it.');
  try {
    await cloudEnsureToken();
    const r = await sbStorageReq('/storage/v1/object/certification-documents/' + rec.storagePath.split('/').map(encodeURIComponent).join('/'), 'GET');
    if (!r.ok) throw new Error('Download failed (' + r.status + ')');
    const blob = await r.blob(), a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = rec.fileName || 'document'; document.body.appendChild(a); a.click(); a.remove();
  } catch (err) { alert('Download failed: ' + err.message); }
}

function credentialsPage(){
  const n=db.nbcrna||{},a=db.aana||{},lic=db.licenses.find(x=>x.id===editId)||{},doc=db.documents.find(x=>x.id===editId)||{},nce=db.nbcrnaCE.find(x=>x.id===editId)||{},ace=db.aanaCE.find(x=>x.id===editId)||{},legacy=db.credentials.find(x=>x.id===editId)||{};
  const nbcrnaDays=daysUntil(n.renewalDeadline||n.periodEnd),aanaDays=daysUntil(a.expiration);
  const connCard=(title,desc,pulls,manualNote,siteLabel,siteUrl,portalKey)=>{const st=cloudPortalState(portalKey);return `<section class="panel"><h2>${title}</h2><p><strong>Status: ${escapeHTML(st.label)}</strong>${st.detail?` — ${escapeHTML(st.detail)}`:''}</p><p class="muted">${desc}</p><p class="muted">What a portal pull covers: ${pulls}</p><p class="muted">${manualNote}</p><p class="muted">Official site: <a href="${siteUrl}" target="_blank" rel="noopener">${siteLabel}</a></p><div class="toolbar"><button type="button" class="secondary" data-action="connect-portal" data-id="${title}">Connect ${title}</button></div></section>`};
  const nbcrnaManual=(n.status||n.number||n.renewalDeadline||n.periodEnd)?'Manual fallback record on file (user-entered, not verified).':'No manual fallback record on file yet.';
  const aanaManual=(a.status||a.number||a.expiration)?'Manual fallback record on file (user-entered, not verified).':'No manual fallback record on file yet.';
  const licManual=db.licenses.length?db.licenses.length+' manual fallback license record(s) on file (user-entered, not verified).':'No manual fallback license records on file yet.';
  // One manual-entry form: the dropdown picks the type, and only that type's
  // fields are rendered. Saving uses the exact same data-kind and field names
  // as the old separate forms, so records land in the same store/table.
  const manualKind = (manualType==='NBCRNA CE')?'nbcrnaCE':(manualType==='AANA CE')?'aanaCE':(manualType==='State license')?'licenses':(manualType==='Other credential')?'credentials':(manualType==='AANA')?'aana':'nbcrna';
  let manualForm='', manualList='';
  if(manualType==='NBCRNA'){
    manualForm=`<form data-kind="nbcrna"><div class="form-grid">${select('status','Certification status',['','Certified','Pending','Expired','Not certified'],n.status||'')}${field('number','Certification number (optional)','text',n.number||'')}${field('periodStart','Certification period start','date',n.periodStart||'')}${field('periodEnd','Certification period end','date',n.periodEnd||'')}${field('renewalDeadline','Renewal / recertification deadline','date',n.renewalDeadline||'')}${field('classA','Class A credits earned','number',n.classA??'','min="0" step="0.25"')}${field('classB','Class B credits earned','number',n.classB??'','min="0" step="0.25"')}${field('macEd','MAC Ed credits earned','number',n.macEd??'','min="0" step="0.25"')}${field('macDev','MAC Dev credits earned','number',n.macDev??'','min="0" step="0.25"')}${field('macEdRequired','MAC Ed credits required','number',n.macEdRequired??60,'min="0" step="1"')}${field('macDevRequired','MAC Dev credits required','number',n.macDevRequired??40,'min="0" step="1"')}${field('reminders','Reminder windows (days, comma-separated)','text',n.reminders||'90,60,30,7')}${field('docNote','Supporting document note (filename only)','text',n.docNote||'')}${area('ceNote','CE notes',n.ceNote||'')}</div>${formEnd('Save NBCRNA record')}</form>`;
    manualList=`<p class="muted">Official site: <a href="https://www.nbcrna.com/" target="_blank" rel="noopener">nbcrna.com</a> · ${portalSourceLabel(n.source||'user_entered', cloudSyncTimes.nbcrna)} · Status shown: ${escapeHTML(n.status||'Not entered')}${nbcrnaDays!==null?` · Renewal in ${nbcrnaDays<0?Math.abs(nbcrnaDays)+' days overdue':nbcrnaDays+' days'}`:''}</p>`;
  } else if(manualType==='AANA'){
    manualForm=`<form data-kind="aana"><div class="form-grid">${select('status','Membership status',['','Active','Lapsed','Pending','Not a member'],a.status||'')}${field('number','Membership number (optional)','text',a.number||'')}${field('expiration','Membership expiration','date',a.expiration||'')}${field('reminders','Reminder windows (days, comma-separated)','text',a.reminders||'90,60,30,7')}${field('docNote','Supporting document note (filename only)','text',a.docNote||'')}${area('ceNote','CE documentation notes',a.ceNote||'')}</div>${formEnd('Save AANA record')}</form>`;
    manualList=`<p class="muted">Kept separate from NBCRNA certification. Official site: <a href="https://www.aana.com/" target="_blank" rel="noopener">aana.com</a> · ${portalSourceLabel(a.source||'user_entered', cloudSyncTimes.aana)} · Status shown: ${escapeHTML(a.status||'Not entered')}${aanaDays!==null?` · Expires in ${aanaDays<0?Math.abs(aanaDays)+' days overdue':aanaDays+' days'}`:''}</p>`;
  } else if(manualType==='State license'){
    manualForm=`<form data-kind="licenses"><div class="form-grid">${select('state','State',US_STATES,lic.state||'West Virginia')}${select('type','License type',['RN','APRN'],lic.type||'RN')}${field('number','License number','text',lic.number||'')}${field('issue','Issue date','date',lic.issue||'')}${field('expiry','Expiration date','date',lic.expiry||'','required')}${field('portal','Official board portal (URL or name)','text',lic.portal||'')}${field('reminders','Reminder windows (days, comma-separated)','text',lic.reminders||'90,60,30,7')}${area('note','Notes',lic.note||'')}</div>${formEnd(editId&&db.licenses.some(x=>x.id===editId)?'Save license':'Add license')}</form>`;
    manualList=list('licenses',db.licenses.slice().sort((a,b)=>a.expiry.localeCompare(b.expiry)),x=>{const d=daysUntil(x.expiry);return `<strong>${escapeHTML(x.state||'')} ${escapeHTML(x.type||'')}</strong> · ${x.number?escapeHTML(x.number)+' · ':''}${fmt(x.expiry)} · ${portalSourceLabel(x.source||'user_entered', '')} <span class="${d!==null&&d<0?'expired':d!==null&&d<=7?'expired':d!==null&&d<=30?'warning':'success'}">${d===null?'':d<0?('Expired '+Math.abs(d)+' days ago'):d===0?'Due today':('Due in '+d+' days')}</span><div class="muted">${portalLink(x.portal)} ${escapeHTML(x.note||'')}</div>`});
  } else if(manualType==='NBCRNA CE'){
    manualForm=ceForm('nbcrnaCE','NBCRNA CE',nce);
    manualList=`<p class="muted">Recorded totals — Class A: ${ceTotal(db.nbcrnaCE,'Class A')} · Class B: ${ceTotal(db.nbcrnaCE,'Class B')} · All: ${ceTotal(db.nbcrnaCE)}</p>`+list('nbcrnaCE',db.nbcrnaCE.slice().sort((a,b)=>b.date.localeCompare(a.date)),x=>`<strong>${escapeHTML(x.title)}</strong> · ${fmt(x.date)} · ${escapeHTML(x.credits||'—')} credits · ${escapeHTML(x.class||'')}`);
  } else if(manualType==='AANA CE'){
    manualForm=ceForm('aanaCE','AANA CE',ace);
    manualList=`<p class="muted">Recorded total: ${ceTotal(db.aanaCE)} credits</p>`+list('aanaCE',db.aanaCE.slice().sort((a,b)=>b.date.localeCompare(a.date)),x=>`<strong>${escapeHTML(x.title)}</strong> · ${fmt(x.date)} · ${escapeHTML(x.credits||'—')} credits${x.note?` · ${escapeHTML(x.note)}`:''}`);
  } else {
    manualForm=`<form data-kind="credentials"><div class="form-grid">${field('name','Credential / license','text',legacy.name||'','required')}${field('expiry','Expiration date','date',legacy.expiry||'','required')}${field('issuer','Issuer / state','text',legacy.issuer||'')}${area('note','Notes',legacy.note||'')}</div>${formEnd(editId&&db.credentials.some(x=>x.id===editId)?'Save credential':'Add credential')}</form>`;
    manualList=`<p class="muted">Generic credentials from earlier versions are preserved here, unchanged.</p>`+list('credentials',db.credentials.slice().sort((a,b)=>a.expiry.localeCompare(b.expiry)),x=>`<strong>${escapeHTML(x.name)}</strong> · ${fmt(x.expiry)} <span class="${x.expiry<localDate(new Date())?'expired':x.expiry<=localDate(new Date(Date.now()+30*864e5))?'warning':'success'}">${x.expiry<localDate(new Date())?'EXPIRED':x.expiry<=localDate(new Date(Date.now()+30*864e5))?'Due within 30 days':'Current'}</span><div class="muted">${escapeHTML(x.issuer||'')} ${escapeHTML(x.note||'')}</div>`);
  }
  return `<p class="hint">Connect-first: the Connect buttons below pull from NBCRNA, AANA, and state boards through the portal-sync function, with minimal manual entry. NBCRNA uses the <strong>public verification lookup (no password)</strong> — implemented, but its submit step is still unproven, so it may report that no record could be pulled. AANA needs a <strong>one-time member sign-in</strong> (password sent once, never stored) and its SSO page is bot-gated, so it may report that sign-in could not be completed. WV and Ohio board lookups <strong>block automation</strong>, so those buttons give you the manual lookup route instead of a fake pull. What ${cloudSession?'your signed-in account does sync':'signing in on the Account tab would sync'} is the records below, between this device and your Supabase account. Records a portal pull brings back are labelled with their source and retrieval date; everything else is <strong>user-entered, not verified</strong>. No portal passwords are stored here.</p>
  ${connCard('NBCRNA','National Board of Certification and Recertification for Nurse Anesthetists — your certification record.','certification status, certification period, renewal / recertification deadline, MAC Ed / MAC Dev progress, and CPC check-in status.',nbcrnaManual,'nbcrna.com','https://www.nbcrna.com/','nbcrna')}
  ${connCard('AANA','American Association of Nurse Anesthesiology — your membership and CE transcript. Kept separate from NBCRNA certification.','membership status, membership expiration, and CE transcript totals (Class A / Class B).',aanaManual,'aana.com','https://www.aana.com/','aana')}
  ${portalAanaForm?portalAanaFormHTML():''}
  ${connCard('State Licenses','State boards of nursing — RN and APRN licenses, one connection per state you hold a license in.','license status, license type (RN / APRN), license number, issue date, and expiration date.',licManual,'State board portals (per license, below)','https://www.nursys.com/','licenses')}
  ${documentsSection(doc)}
  <h2>Manual entry (fallback only)</h2><p class="muted">Use this single form when a portal pull is unavailable or has not run. Choose the type below — only that type's fields are shown. Records saved here are user-entered, not verified by NBCRNA, AANA, or any state board; saving here overwrites a portal-pulled record's source back to user-entered. Real document uploads live in the "Certification documents" section directly under the State Licenses connection card above — NBCRNA/AANA document fields below still hold a filename or note only. Do not store patient information or portal passwords.</p>
  <section class="panel"><h2>Manual entry</h2><div class="form-grid"><div class="field"><label for="f_manualType">Entry type</label><select id="manualTypeSelect" name="manualType"><option value="NBCRNA" ${manualType==='NBCRNA'?'selected':''}>NBCRNA</option><option value="AANA" ${manualType==='AANA'?'selected':''}>AANA</option><option value="State license" ${manualType==='State license'?'selected':''}>State license</option><option value="NBCRNA CE" ${manualType==='NBCRNA CE'?'selected':''}>NBCRNA CE record</option><option value="AANA CE" ${manualType==='AANA CE'?'selected':''}>AANA CE record</option><option value="Other credential" ${manualType==='Other credential'?'selected':''}>Other credential</option></select></div></div>
  ${manualForm}
  ${manualList}</section>`;
}
function mileagePage(){const x=db.mileage.find(x=>x.id===editId)||{},total=db.mileage.reduce((s,x)=>s+num(x.miles),0);return `<div class="two"><section class="panel"><h2>${editId?'Edit':'Log'} business mileage</h2><form id="entryForm" data-kind="mileage"><div class="form-grid">${field('date','Trip date','date',x.date||localDate(new Date()),'required')}${field('miles','Actual miles','number',x.miles??'','min="0" step="0.1" required')}${field('purpose','Business purpose','text',x.purpose||'','required')}${select('status','Verification',['verified','draft'],x.status||'verified')}</div>${formEnd(editId?'Save trip':'Log trip')}</section><section class="panel"><h2>Mileage summary</h2><div class="stat"><strong>${total.toFixed(1)} miles</strong>All logged and draft trips</div><div class="toolbar" style="margin-top:14px"><button data-action="mileage-drafts">Generate schedule-based drafts</button><button class="secondary" data-action="export-mileage">Export CSV</button></div><p class="hint">Drafts use twice the facility's manually entered one-way distance. Confirm the trip actually occurred, actual miles, and tax eligibility. Regular commuting is generally not deductible.</p></section></div><section class="panel"><h2>Trip log</h2>${list('mileage',db.mileage.slice().sort((a,b)=>b.date.localeCompare(a.date)),x=>`<strong>${fmt(x.date)}</strong> · ${escapeHTML(x.miles)} mi <span class="pill">${escapeHTML(x.status||'verified')}</span><div class="muted">${escapeHTML(x.purpose)}</div>`)}</section>`}

// --- Calendar import / export (Google / Apple / Outlook, file-based) ---
// Import and export work today, entirely in the browser, via .ics files.
// Live two-way sync does NOT exist yet: it needs a server-side Supabase Edge
// Function plus Google/Outlook OAuth registrations and Apple CalDAV with an
// app-specific password. No calendar password, OAuth secret, or app-specific
// password is ever collected or stored here, in localStorage, or in the repo.
const CAL_SOURCES={'Google Calendar':'calendar-google','Apple Calendar':'calendar-apple','Outlook':'calendar-outlook','Calendar file':'calendar-file'};
function calNextDay(iso){const d=new Date(iso+'T12:00:00');d.setDate(d.getDate()+1);return localDate(d)}
function calIcsEscape(t){return String(t??'').replace(/\\/g,'\\\\').replace(/;/g,'\\;').replace(/,/g,'\\,').replace(/\r?\n/g,'\\n')}
function calIcsDate(iso){return iso.replace(/-/g,'')}
function shiftsToICS(shifts){const lines=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//CRNA Hub//Calendar Export//EN','CALSCALE:GREGORIAN','METHOD:PUBLISH'];for(const x of shifts){if(!/^\d{4}-\d{2}-\d{2}$/.test(x.date||''))continue;const desc=[x.type, x.pay!==''&&x.pay!=null?('Expected gross: '+currency(x.pay)): 'Pay not yet priced — incomplete', x.note||'', x.source?('Source in CRNA Hub: '+x.source):''].filter(Boolean).join(' | ');lines.push('BEGIN:VEVENT','UID:'+x.id+'@crna-hub','DTSTAMP:'+new Date().toISOString().replace(/[-:]/g,'').replace(/\.\d+/,'')+'Z','DTSTART;VALUE=DATE:'+calIcsDate(x.date),'DTEND;VALUE=DATE:'+calIcsDate(calNextDay(x.date)),'SUMMARY:'+calIcsEscape((x.facility||'')+' — '+(x.type||'Shift')),'LOCATION:'+calIcsEscape(x.facility||''),'DESCRIPTION:'+calIcsEscape(desc),'END:VEVENT')}lines.push('END:VCALENDAR');return lines.join('\r\n')}
function googleCalUrl(x){const p=new URLSearchParams({action:'TEMPLATE',text:(x.facility||'')+' — '+(x.type||'Shift'),dates:calIcsDate(x.date)+'/'+calIcsDate(calNextDay(x.date)),details:[x.type, x.pay!==''&&x.pay!=null?('Expected gross: '+currency(x.pay)):'Pay not yet priced — incomplete', x.note||''].filter(Boolean).join(' | '),location:x.facility||''});return 'https://calendar.google.com/calendar/render?'+p.toString()}
function outlookCalUrl(x){const p=new URLSearchParams({subject:(x.facility||'')+' — '+(x.type||'Shift'),startdt:x.date,enddt:calNextDay(x.date),location:x.facility||'',body:[x.type, x.pay!==''&&x.pay!=null?('Expected gross: '+currency(x.pay)):'Pay not yet priced — incomplete', x.note||''].filter(Boolean).join(' | ')});return 'https://outlook.live.com/calendar/0/deeplink/compose?'+p.toString()}
function calPreviewHTML(){if(!calPreview)return '<p class="muted">No calendar file parsed yet. Choose an .ics file above, then click “Parse calendar — preview only” — nothing is saved until you approve the preview below.</p>';const rows=calPreview.rows,dup=rows.filter(r=>r.duplicate).length,need=rows.filter(r=>r.flags.length).length;return `<p><strong>Parsed from:</strong> ${escapeHTML(calPreview.fileName)} · Source: ${escapeHTML(calPreview.sourceLabel)} · ${rows.length} event(s) · ${rows.filter(r=>r.include&&!r.duplicate).length} would be added · ${dup} duplicate(s) will be skipped</p><p class="muted">Duplicates are events already in the app with the same date, facility, and shift type. Uncheck any row to leave it out. Rows with a missing date or facility block approval until fixed or unchecked.</p><table class="contract-table"><thead><tr><th></th><th>Date</th><th>Facility</th><th>Shift type</th><th>Pay</th><th>Flags</th></tr></thead><tbody>${rows.map((r,i)=>`<tr><td><input type="checkbox" class="calInclude" data-row="${i}" ${r.include?'checked':''}></td><td><input type="date" class="calEdit" data-row="${i}" data-field="date" value="${escapeHTML(r.date||'')}"></td><td><input class="calEdit" data-row="${i}" data-field="facility" value="${escapeHTML(r.facility||'')}"></td><td><input class="calEdit" data-row="${i}" data-field="type" value="${escapeHTML(r.type||'')}"></td><td><input class="calEdit" data-row="${i}" data-field="pay" value="${escapeHTML(r.pay||'')}"></td><td>${r.duplicate?'<span class="pill warn">duplicate — will be skipped</span> ':''}${r.flags.map(f=>`<span class="pill warn">${escapeHTML(f)}</span>`).join(' ')||'<span class="pill">clean</span>'}</td></tr>`).join('')}</tbody></table><div class="form-actions"><button type="button" data-action="cal-approve">Approve selected — add shifts</button><button type="button" class="secondary" data-action="cal-discard">Discard preview</button></div>`}
async function importCalendar(e){e.preventDefault();calImportError='';const f=$('f_calFile').files[0];const sourceLabel=$('f_calSource').value||'Calendar file';if(!f){calImportError='Choose an .ics calendar file first (Google, Apple, or Outlook can all export one).';return render()}let text='';try{text=await f.text()}catch(err){calImportError='Could not read that file: '+err.message;return render()}if(!/^BEGIN:VCALENDAR/i.test(text.trim())){calImportError='That file is not a calendar (.ics) file. Export your calendar as .ics from Google, Apple, or Outlook and try again. Nothing was saved.';calPreview=null;return render()}const parsed=parseICS(text,f.name);const sourceCode=CAL_SOURCES[sourceLabel]||'calendar-file';const grossByBlock=text.split(/BEGIN:VEVENT/i).slice(1).map(b=>{const m=b.match(/Expected gross:\s*\$?([\d\\,]+(?:\.\d+)?)/i);return m?m[1].replace(/[\\,]/g,''):''});const rows=parsed.rows.map((r,ri)=>{if(grossByBlock[ri])r={...r,pay:grossByBlock[ri]};const duplicate=(db.shifts||[]).some(x=>x.date===r.date&&x.facility===r.facility&&x.type===r.type);const flags=[...r.flags];if(duplicate)flags.push('already in CRNA Hub — duplicate');return {...r,source:sourceCode,sourceLabel,status:'proposed',include:!duplicate,duplicate,incomplete:!String(r.pay||'').trim(),note:'Imported from '+sourceLabel+' (.ics): '+f.name}});calPreview={fileName:f.name,sourceLabel,sourceCode,rows};if(!rows.length){calImportError='No events found in that calendar file. Nothing was saved.';calPreview=null}render()}
function approveCalendarImport(){if(!calPreview)return;const rows=calPreview.rows.filter(r=>r.include&&!r.duplicate);const blocked=rows.filter(r=>!r.date||!/^\d{4}-\d{2}-\d{2}$/.test(r.date)||!String(r.facility||'').trim());if(blocked.length){alert('Fix or uncheck these rows before approving: '+(blocked.map(r=>`${r.date||'(no date)'} ${r.facility||'(no facility)'} ${r.type}`).join('; ')));return}let created=0,skipped=0;for(const r of rows){if((db.shifts||[]).some(x=>x.date===r.date&&x.facility===r.facility&&x.type===r.type)){skipped++;continue}const pay=String(r.pay||'').trim();db.shifts.push({id:id(),date:r.date,facility:String(r.facility).trim(),type:r.type,pay,status:'proposed',source:r.source,incomplete:!pay,note:r.note});created++}const dups=calPreview.rows.filter(r=>r.duplicate).length;calPreview=null;persist();render();alert(`Added ${created} shift(s) from the calendar. Skipped ${skipped+dups} duplicate(s).`)}
function exportCalendarICS(shifts,filename){if(!shifts.length){alert('No shifts to export.');return}download(filename,shiftsToICS(shifts),'text/calendar;charset=utf-8')}
function calSyncAlert(provider){alert('Live two-way sync with '+provider+' is not connected yet — and this button does not collect any password or code.\n\nWhat it still needs:\n1. A server-side Supabase Edge Function to run the sync (a web page cannot reliably keep calendar tokens or run background sync).\n2. A provider registration: Google Cloud OAuth app for Google Calendar, Microsoft Entra app for Outlook.\n3. For Apple Calendar: CalDAV with an app-specific password created in your Apple account — never enter that password here; the future sync setup will use it only through the server-side function.\n\nUntil then, use the file-based import and export above: .ics in, .ics out, and per-shift “Add to Google / Outlook” links on the Dashboard. No calendar password, OAuth secret, or app-specific password is stored in this app, in localStorage, or in the repo, and “Last automatic sync” below is honestly “never”.')}

function importPage(){return `<section class="panel"><h2>Import a schedule</h2><p>Import a CSV file with columns <code>date,facility,type,pay</code>. The pay column is optional; missing pay uses saved facility rates. Dates must be YYYY-MM-DD.</p><form id="importForm"><div class="form-grid">${field('importFile','Choose CSV file','file','','accept=".csv,text/csv"')}${area('importText','Or paste CSV rows','','date,facility,type,pay\n2026-11-05,CAMC,8-hour day,2000')}</div><div class="form-actions"><button type="submit">Import schedule</button></div></form><p class="hint">Excel (.xlsx) is not implemented in this local-first release. Export the spreadsheet as CSV first. Contract pictures are read on-device with OCR in the contract panel below. Never upload patient information.</p></section><section class="panel" id="contract-panel"><h2>Import a contract</h2><p><strong>Deterministic parsing only — no AI model reads this document.</strong> This reads facility names, dates, shift types (8h, 10h, 12h, 24h / 1st call, 2nd call, weekday vs weekend), and rate rules stated in the text, then shows a preview for your approval. Nothing is saved until you click Approve.</p><p class="muted">Works: plain text (.txt), contract text in CSV form, calendar files (.ics), PDFs with a text layer (text is extracted in your browser with PDF.js from a CDN, loaded only when you choose a PDF), and <strong>pictures of contracts (.png, .jpg, .jpeg, .webp; .heic only where your browser can decode it)</strong>. Pictures are read <strong>entirely on your device with OCR (Tesseract.js, loaded from a CDN only when you pick a picture)</strong> — no picture is sent to a server for OCR, and no AI model reads the document. OCR rows are flagged “from photo — check carefully” because OCR can misread digits and dates. Also not built: live AI extraction and live calendar sync (see the Live calendar sync panel below).</p><form id="contractForm"><div class="form-grid">${field('contractFile','Choose contract file','file','','accept=".txt,.csv,.ics,.pdf,.png,.jpg,.jpeg,.webp,.heic,text/plain,text/csv,text/calendar,image/*"')}${area('contractText','Or paste contract / schedule text','','Facility: Holzer\nRate: $250/hr, $1,000 overnight call bonus\nJanuary 5, 2027 — Holzer 8\nJanuary 6, 2027 — Holzer 8/2nd call')}</div><div class="form-actions"><button type="submit">Parse contract — preview only (nothing saved yet)</button></div></form>${contractOcrStatus?`<p class="hint" id="contractOcrStatus">${escapeHTML(contractOcrStatus)}</p>`:''}${contractImportError?`<p class="hint">${escapeHTML(contractImportError)}</p>`:''}<div style="margin-top:14px">${contractPreviewHTML()}</div></section>${(db.contracts||[]).length?`<section class="panel"><h2>Saved contracts</h2>${(db.contracts||[]).map(x=>`<div class="item"><div class="item-title">${escapeHTML(x.facility||'(facility to confirm)')}</div><div class="muted">${x.effectiveStart?fmt(x.effectiveStart):'—'} to ${x.effectiveEnd?fmt(x.effectiveEnd):'—'} · ${(db.shifts||[]).filter(s=>s.contractId===x.id).length} linked shift(s) · Source: extracted-from-contract${x.sourceFile?` · File: ${escapeHTML(x.sourceFile)}`:''}</div><div class="muted">Rates found: ${x.rates&&Object.keys(x.rates).length?Object.entries(x.rates).map(([k,v])=>`${k} ${currency(v)}`).join(', '):'none stated'}</div>${x.imageFileName?`<div class="muted">Picture: ${escapeHTML(x.imageFileName)} · kept on this device only (cloud document storage not enabled yet) · <button type="button" data-action="view-contract-image" data-id="${x.id}">View picture</button></div>`:''}</div>`).join('')}<p class="muted">Future imports for the same facility reuse these saved rates when a new document does not state a rate — and the preview flags that reuse so you can check it.</p></section>`:''}<section class="panel"><h2>Calendar sync — import &amp; export</h2><p><strong>File-based calendar import and export work today, entirely in your browser.</strong> Google Calendar, Apple Calendar, and Outlook can all export and import .ics files, so shifts move both ways by file today — no sign-in, no credentials stored here.</p><h3>Import shifts from a calendar (.ics)</h3><p class="muted">Export your calendar as .ics (Google: Settings → Import &amp; export → Export; Apple: File → Export → Export Calendar; Outlook: Settings → General → Privacy and data → Export mailbox, or save a single calendar as .ics), then import it here. Duplicates — same date, facility, and shift type already in CRNA Hub — are detected and skipped, never doubled.</p><form id="calendarForm"><div class="form-grid">${field('calFile','Choose .ics file','file','','accept=".ics,text/calendar"')}${select('calSource','Which calendar is this from?',['Google Calendar','Apple Calendar','Outlook','Calendar file'],'Calendar file')}</div><div class="form-actions"><button type="submit">Parse calendar — preview only (nothing saved yet)</button></div></form>${calImportError?`<p class="hint">${escapeHTML(calImportError)}</p>`:''}<div style="margin-top:14px">${calPreviewHTML()}</div><h3>Export shifts to a calendar (.ics)</h3><p class="muted">Download a .ics file and import it into Google, Apple, or Outlook. All-day events, one per shift, with facility, shift type, and expected gross in the notes.</p><div class="toolbar"><button data-action="export-cal-all">Download all shifts (.ics)</button><button data-action="export-cal-month">Download this month (.ics)</button></div><p class="muted">Per-shift links are on the Dashboard Saved shifts list: “Add to Google” and “Add to Outlook” open a pre-filled calendar event in your browser — no sign-in through this app, no credentials stored.</p><section class="panel" id="live-sync-panel">${typeof liveSyncPanelHTML==='function'?liveSyncPanelHTML():'<h2>Live calendar sync</h2><p class="muted">Live calendar sync is loading…</p>'}</section></section><section class="panel"><h2>Backup & restore</h2><p class="muted">Back up before changing phones, clearing browser data, or replacing the website. Backups include saved contracts and their linked shifts.</p><p class="muted">Current mode: <strong>${escapeHTML(cloudHeaderLabel())}</strong>. A backup restores records onto this device only — it never overwrites your cloud account. To push restored records to the cloud, use "Upload my on-device records" on the Account tab.</p><div class="toolbar"><button data-action="backup">Download JSON backup</button><button class="secondary" data-action="export-shifts">Download shift CSV</button><button class="secondary" data-action="export-mileage">Download mileage CSV</button></div><label for="restoreFile">Restore a CRNA Hub JSON backup (replaces current records)</label><input id="restoreFile" type="file" accept=".json,application/json"></section><section class="panel"><h2>What comes next</h2><p class="muted">Supabase sign-in and credential sync are on the Account tab (${SUPABASE_CONFIGURED?'configured — sign in to use them':'not configured yet — paste the publishable key into supabase-config.js, see the README'}). Live NBCRNA / AANA / state portal pulls run through the portal-sync Edge Function (see the Credentials tab): NBCRNA by public lookup (implemented, submit still unproven), AANA by one-time member sign-in (SSO is bot-gated, so it may not complete), WV and Ohio board lookups block automation and give the manual route instead. Also still unbuilt: secure multi-user W-2 scheduling, live AI contract extraction, Excel (.xlsx) import, live calendar sync while the app is closed (live sync runs when the app is open — see the Live calendar sync panel in Import & Backup), commute-aware alarm rules, and automatic mileage detection. Contract pictures ARE read on-device with OCR (see the contract panel above); scanned/image-only PDFs still yield “no shifts found” rather than invented text.</p></section>`}
function submitEntry(e){e.preventDefault();const kind=e.currentTarget.dataset.kind;if(kind==='documents'){submitDocument(e);return;}if(kind==='portal-aana'){portalAanaSubmit(e);return;}record=Object.fromEntries(new FormData(e.currentTarget));if(kind==='nbcrna'||kind==='aana'){db[kind]={...(db[kind]||{}),...record,source:'user_entered'};persist();cloudSaveKind(kind);render();return;}if(kind==='licenses')record.source='user_entered';if(kind==='shifts'&&!String(record.pay).trim()){const f=db.facilities.find(x=>x.name.trim().toLowerCase()===record.facility.trim().toLowerCase());record.pay=f?(/24.hour/i.test(record.type)?num(f.rate24):/second/i.test(record.type)?num(f.rateSecond):/8.hour/i.test(record.type)?num(f.rate8):0):0}if(kind==='facilities'&&db.facilities.some(x=>x.name.toLowerCase()===record.name.toLowerCase()&&x.id!==editId)){alert('A facility with that name already exists.');return}let savedId=editId;if(editId){const i=db[kind].findIndex(x=>x.id===editId);if(i>=0)db[kind][i]={...db[kind][i],...record}}else{const rec={...record,id:id(),...(kind==='shifts'?{source:'user-entered'}:{})};db[kind].push(rec);savedId=rec.id}editId=null;if(kind==='shifts')showShiftForm=false;persist();if(kind==='shifts'&&typeof window!=='undefined'&&typeof window.liveSyncSchedulePush==='function')window.liveSyncSchedulePush();if(['licenses','nbcrnaCE','aanaCE'].includes(kind))cloudSaveKind(kind,savedId);render()}
function actions(action,entry,date){if(action.startsWith('live-')){if(typeof liveSyncAction==='function')return liveSyncAction(action,entry);}if(action==='onboard-dismiss'){db.settings.onboardingDismissed=true;persist();return render();}if(action==='onboard-goto'){setTab(entry);if(date){const el=document.getElementById(date);if(el)el.scrollIntoView({block:'start'});}return;}if(action==='prev')return moveMonth(-1);if(action==='next')return moveMonth(1);if(action==='today'){month=new Date();month.setDate(1);selected=localDate(new Date());return render()}if(action==='day')return selectDay(date);if(action==='add-shift'){tab='Dashboard';editId=null;showShiftForm=true;render();window.scrollTo(0,0);return;}if(action==='ask-assistant')return setTab('Assistant');if(action==='connect-portal'){if(!SUPABASE_CONFIGURED){alert('Supabase is not configured yet: paste the publishable key into supabase-config.js (see the Account tab and README), then redeploy. Until then this button cannot connect anything.');return setTab('Account')}if(!cloudSession){alert('Sign in on the Account tab first. Signing in syncs the records you enter here to your Supabase account — the portal pull itself runs server-side for your signed-in account.');return setTab('Account')}if(portalBusy)return;if(entry==='NBCRNA')return portalConnectNbcrna();if(entry==='AANA'){portalAanaForm=true;render();window.scrollTo(0,0);return;}if(entry==='State Licenses')return portalConnectLicense();return;}if(action==='portal-aana-cancel'){portalAanaForm=false;return render();}if(action==='ask'){db.assistantChat=[...(db.assistantChat||[]),{role:'user',text:entry},{role:'assistant',text:answerQuestion(entry)}].slice(-50);persist();return render()}if(action==='clear-chat'){db.assistantChat=[];persist();return render()}if(action==='cancel'){editId=null;showShiftForm=false;return render()}if(action.startsWith('edit-')){const kind=action.slice(5);tab=({shifts:'Dashboard',facilities:'Facilities',pto:'PTO',credentials:'Credentials',mileage:'Mileage',licenses:'Credentials',nbcrnaCE:'Credentials',aanaCE:'Credentials',documents:'Credentials'})[kind];if(['nbcrna','aana','licenses','credentials','nbcrnaCE','aanaCE'].includes(kind))manualType=({nbcrna:'NBCRNA',aana:'AANA',licenses:'State license',credentials:'Other credential',nbcrnaCE:'NBCRNA CE',aanaCE:'AANA CE'})[kind];editId=entry;if(kind==='shifts')showShiftForm=true;render();window.scrollTo(0,0);return}if(action.startsWith('delete-')){const kind=action.slice(7);if(!confirm('Delete this record?'))return;if(kind==='shifts'&&typeof window!=='undefined'&&typeof window.liveSyncRecordTombstone==='function')window.liveSyncRecordTombstone(entry);db[kind]=db[kind].filter(x=>x.id!==entry);persist();if(['licenses','nbcrnaCE','aanaCE'].includes(kind))cloudDeleteKind(kind,entry);if(kind==='documents')cloudDeleteDocument(entry);return render()}if(action==='download-doc'){downloadDocument(entry);return;}if(action==='save-pto-settings'){db.settings.ptoStarting=num($('f_starting').value);db.settings.ptoAnnual=num($('f_annual').value);db.settings.ptoHoursPerPeriod=num($('f_perperiod').value);persist();return render()}if(action==='post-accrual'){const h=num(db.settings.ptoHoursPerPeriod);if(h<=0)return alert('Set the pay-period accrual first.');db.pto.push({id:id(),date:localDate(new Date()),hours:String(h),note:'Pay-period accrual'});persist();return render()}if(action==='mileage-drafts')return makeMileageDrafts();if(action==='cloud-signup'){const em=$('f_email'),pw=$('f_password');if(!em||!pw||!em.value.trim()||!pw.value)return alert('Enter an email and password first.');cloudSignUp(em.value.trim(),pw.value);return}
if(action==='cloud-upload'){if(!confirm('Upload on-device credential records to your cloud account? This overwrites the credential records currently stored in your cloud account (NBCRNA, AANA, licenses, CE records) with the ones on this device. Shifts, facilities, mileage, and PTO are not uploaded.'))return;cloudUploadLocal();return}
if(action==='cloud-load'){if(!confirm('Load cloud credential records onto this device? This replaces the NBCRNA, AANA, license, and CE records on this device with the ones in your cloud account. Shifts, facilities, mileage, and PTO are untouched.'))return;cloudLoadIntoLocal();return}
if(action==='cloud-sync'){if(!confirm('Sync now downloads your cloud credential records onto this device, replacing the NBCRNA, AANA, license, and CE records here. Continue?'))return;cloudLoadIntoLocal();return}
if(action==='cloud-signout'){cloudSignOut();return}
if(action==='cloud-keep-local'){cloudPending=null;render();return}
if(action==='goto-account')return setTab('Account');
if(action==='contract-approve')return approveContractImport();
if(action==='contract-discard'){contractPreview=null;contractPendingImage=null;contractOcrStatus='';return render()}
if(action==='view-contract-image')return viewContractImage(entry);
if(action==='backup')return download('crna-hub-backup.json',JSON.stringify({...db,_backupMeta:{mode:cloudMode(),account:cloudSession?cloudSession.email:null,exportedAt:new Date().toISOString(),note:'Cloud vs on-device mode at export time. Restore loads records onto this device only; it never overwrites the cloud account.'}},null,2),'application/json');if(action==='cal-approve')return approveCalendarImport();if(action==='cal-discard'){calPreview=null;return render()}if(action==='export-cal-all')return exportCalendarICS(db.shifts.slice().sort((a,b)=>a.date.localeCompare(b.date)),'crna-hub-shifts.ics');if(action==='export-cal-month'){const prefix=localDate(new Date()).slice(0,7);return exportCalendarICS(db.shifts.filter(x=>x.date.startsWith(prefix)).sort((a,b)=>a.date.localeCompare(b.date)),'crna-hub-shifts-'+prefix+'.ics')}if(action==='connect-calendar')return calSyncAlert(entry);if(action==='export-shifts')return exportCsv('crna-hub-shifts.csv',['date','facility','type','pay','note'],db.shifts);if(action==='export-mileage')return exportCsv('crna-hub-mileage.csv',['date','purpose','miles','status'],db.mileage)}
function makeMileageDrafts(){let count=0;for(const x of db.shifts){if(/off|pto/i.test(x.type))continue;const f=db.facilities.find(f=>f.name.trim().toLowerCase()===String(x.facility).trim().toLowerCase());if(!f||num(f.distance)<=0)continue;const purpose='Scheduled facility trip: '+f.name;if(db.mileage.some(m=>m.date===x.date&&m.purpose===purpose))continue;db.mileage.push({id:id(),date:x.date,purpose,miles:String((num(f.distance)*2).toFixed(1)),status:'draft'});count++}persist();render();alert(`${count} mileage draft(s) created. Review every trip and tax eligibility before using them.`)}
function csvEscape(v){const s=String(v??'');return /[",\n\r]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s}
function exportCsv(filename,headers,rows){download(filename,[headers.join(','),...rows.map(r=>headers.map(h=>csvEscape(r[h])).join(','))].join('\r\n'),'text/csv;charset=utf-8')}
function download(filename,contents,mime){const a=document.createElement('a'),url=URL.createObjectURL(new Blob([contents],{type:mime}));a.href=url;a.download=filename;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),3000)}
function parseCSV(str){const rows=[],row=[];let cell='',quote=false;for(let i=0;i<str.length;i++){const c=str[i];if(c==='"'){if(quote&&str[i+1]==='"'){cell+='"';i++}else quote=!quote}else if(c===','&&!quote){row.push(cell);cell=''}else if((c==='\n'||c==='\r')&&!quote){if(c==='\r'&&str[i+1]==='\n')i++;row.push(cell);if(row.some(x=>x.trim()))rows.push(row.slice());row.length=0;cell=''}else cell+=c}row.push(cell);if(row.some(x=>x.trim()))rows.push(row);return rows}
async function importCsv(e){e.preventDefault();const f=$('f_importFile').files[0],input=f?await f.text():$('f_importText').value,rows=parseCSV(input.replace(/^\uFEFF/,''));let count=0,skipped=0;for(let i=0;i<rows.length;i++){const r=rows[i].map(x=>x.trim());if(i===0&&/date/i.test(r[0])&&!/^\d{4}-\d{2}-\d{2}$/.test(r[0]))continue;if(!/^\d{4}-\d{2}-\d{2}$/.test(r[0])||Number.isNaN(Date.parse(r[0]+'T12:00:00'))||!r[1]){skipped++;continue}const facility=r[1],type=r[2]||'Other',f=db.facilities.find(x=>x.name.toLowerCase()===facility.toLowerCase()),pay=r[3]!==undefined&&r[3]!==''?num(r[3]):f?(/24.hour/i.test(type)?num(f.rate24):/second/i.test(type)?num(f.rateSecond):/8.hour/i.test(type)?num(f.rate8):0):0;if(db.shifts.some(x=>x.date===r[0]&&x.facility===facility&&x.type===type)){skipped++;continue}db.shifts.push({id:id(),date:r[0],facility,type,pay:String(pay),note:'CSV import',source:'csv-import'});count++}persist();render();alert(`Imported ${count} shift(s); skipped ${skipped} invalid or duplicate row(s).`)}
async function restoreBackup(e){const file=e.target.files[0];if(!file)return;try{const data=JSON.parse(await file.text());for(const key of ['shifts','facilities','pto','credentials','mileage'])if(!Array.isArray(data[key]))throw Error('Missing or invalid '+key);if(!confirm('Replace all current records with this backup?'))return;const next=empty();for(const k of ['shifts','facilities','pto','credentials','mileage'])next[k]=data[k];if(data.settings&&typeof data.settings==='object')next.settings=data.settings;if(data.nbcrna&&typeof data.nbcrna==='object')next.nbcrna=data.nbcrna;if(data.aana&&typeof data.aana==='object')next.aana=data.aana;if(Array.isArray(data.nbcrnaCE))next.nbcrnaCE=data.nbcrnaCE;if(Array.isArray(data.aanaCE))next.aanaCE=data.aanaCE;if(Array.isArray(data.licenses))next.licenses=data.licenses;if(Array.isArray(data.documents))next.documents=data.documents;if(Array.isArray(data.assistantChat))next.assistantChat=data.assistantChat;if(Array.isArray(data.contracts))next.contracts=data.contracts;db=next;persist();render();alert(cloudActive&&cloudSession?'Backup restored onto this device only. It did NOT overwrite your cloud account. To push these records to the cloud, use "Upload my on-device records" on the Account tab.':'Backup restored.')}catch(err){alert('Could not restore backup: '+err.message)}}

// --- Contract import (deterministic parse + on-device OCR — no AI model) ---
// Reads text the browser can actually read client-side: .txt, .csv contract
// text, .ics calendar files, and PDF files with a text layer (via PDF.js from
// a CDN, loaded on demand only for PDFs). Pictures (.png/.jpg/.jpeg/.webp,
// .heic where the browser can decode it) are read ON-DEVICE with Tesseract.js
// (loaded on demand from a CDN only when a picture is chosen) — the picture
// is never sent to a server for OCR. OCR text then goes through the SAME
// deterministic parser and SAME preview/approval flow as text contracts,
// with every OCR row flagged lower-confidence ("from photo — check
// carefully"), because OCR can misread digits and dates.
// Nothing is saved until the user reviews the preview table and clicks
// Approve. Unpriced shifts keep pay '' and are marked incomplete, never $0.
let contractPreview=null,contractImportError='';
let calPreview=null,calImportError='';
const CMONTHS={january:1,jan:1,february:2,feb:2,march:3,mar:3,april:4,apr:4,may:5,june:6,jun:6,july:7,jul:7,august:8,aug:8,september:9,sep:9,sept:9,october:10,oct:10,november:11,nov:11,december:12,dec:12};
function contractValidISO(y,m,d){if(!y||m<1||m>12||d<1||d>31)return null;const dt=new Date(Date.UTC(y,m-1,d));if(dt.getUTCFullYear()!==y||dt.getUTCMonth()!==m-1||dt.getUTCDate()!==d)return null;return dt.toISOString().slice(0,10)}
function contractParseSingle(raw,defaultYear){const s=String(raw||'').trim().replace(/(st|nd|rd|th)\b/gi,'');let m;
 if((m=s.match(/^(\d{4})-(\d{2})-(\d{2})$/)))return {iso:contractValidISO(+m[1],+m[2],+m[3]),ambiguous:false};
 if((m=s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)))return {iso:contractValidISO(+m[3],+m[1],+m[2]),ambiguous:false};
 if((m=s.match(/^(\d{1,2})\/(\d{1,2})$/)))return {iso:contractValidISO(defaultYear||new Date().getFullYear(),+m[1],+m[2]),ambiguous:true};
 if((m=s.match(/^([A-Za-z]+)\.?\s+(\d{1,2})(?:\s*,\s*(\d{4}))?$/))&&CMONTHS[m[1].toLowerCase()])return {iso:contractValidISO(+(m[3]||defaultYear||new Date().getFullYear()),CMONTHS[m[1].toLowerCase()],+m[2]),ambiguous:!m[3]};
 if((m=s.match(/^(\d{1,2})\s+([A-Za-z]+)\.?(?:\s+(\d{4}))?$/))&&CMONTHS[m[2].toLowerCase()])return {iso:contractValidISO(+(m[3]||defaultYear||new Date().getFullYear()),CMONTHS[m[2].toLowerCase()],+m[1]),ambiguous:!m[3]};
 if((m=s.match(/^(\d{4})(\d{2})(\d{2})$/)))return {iso:contractValidISO(+m[1],+m[2],+m[3]),ambiguous:false};
 return {iso:null,ambiguous:true}}
function contractDateList(line,defaultYear){const dates=[];let m;
 const rangePatterns=[
  /([A-Za-z]+\.?\s+\d{1,2}(?:st|nd|rd|th)?)\s*(?:-|–|—|to)\s*([A-Za-z]+\.?\s+\d{1,2}(?:st|nd|rd|th)?,?\s*\d{4})/i,
  /([A-Za-z]+\.?\s+\d{1,2}(?:st|nd|rd|th)?)\s*(?:-|–|—|to)\s*(\d{1,2}(?:st|nd|rd|th)?,?\s*\d{4})/i,
  /(\d{1,2}\/\d{1,2}\/\d{4})\s*(?:-|–|—|to)\s*(\d{1,2}\/\d{1,2}\/\d{4})/,
  /(\d{4}-\d{2}-\d{2})\s*(?:-|–|—|to)\s*(\d{4}-\d{2}-\d{2})/];
 for(const rx of rangePatterns){const r=line.match(rx);if(r){const a=contractParseSingle(r[1],defaultYear);let b=contractParseSingle(r[2],defaultYear);
   if(!b.iso&&a.iso){const dm=r[2].match(/^(\d{1,2})(?:st|nd|rd|th)?,?\s*(\d{4})$/);if(dm)b={iso:contractValidISO(+dm[2],+a.iso.slice(5,7),+dm[1]),ambiguous:false}}
   if(a.iso&&b.iso){const d0=new Date(a.iso+'T12:00:00'),d1=new Date(b.iso+'T12:00:00');if(d1>=d0&&(d1-d0)/86400000<=62){for(let d=new Date(d0);d<=d1;d.setDate(d.getDate()+1))dates.push({iso:localDate(d),ambiguous:a.ambiguous||b.ambiguous});return dates}
     return [{iso:a.iso,ambiguous:true,rangeError:true}]}}}
 const pats=[/\b\d{4}-\d{2}-\d{2}\b/g,/\b\d{1,2}\/\d{1,2}\/\d{4}\b/g,/\b\d{1,2}\/\d{1,2}\b(?!\s*\/)/g,/\b(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\.?\s+\d{1,2}(?:st|nd|rd|th)?(?:\s*,\s*\d{4})?\b/gi,/\b\d{1,2}\s+(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\.?(?:\s+\d{4})?\b/gi];
 for(const rx of pats){let hit;while((hit=rx.exec(line))){const p=contractParseSingle(hit[0],defaultYear);if(p.iso&&!dates.some(x=>x.iso===p.iso))dates.push(p)}}
 return dates}
function contractMoney(s){const m=String(s||'').match(/\$([\d,]+(?:\.\d{2})?)/);return m?Number(m[1].replace(/,/g,'')):null}
function contractShiftType(line){const l=line.toLowerCase();
 if(/holzer\s+8\s*\/\s*2nd|2nd\s+call|second\s+call/.test(l))return 'Second call';
 if(/24\s*-?\s*hour|24h\b|1st\s+call|first\s+call/.test(l))return '24-hour call';
 if(/holzer\s+12\b/.test(l))return '12-hour shift';
 if(/12\s*-?\s*hour|12h\b/.test(l))return '12-hour shift';
 if(/10\s*-?\s*hour|10h\b/.test(l))return '10-hour shift';
 if(/holzer\s+10\b/.test(l))return '10-hour shift';
 if(/holzer\s+8\b/.test(l))return '8-hour day';
 if(/8\s*-?\s*hour|8h\b|day\s+shift/.test(l))return '8-hour day';
 if(/\bcall\b/.test(l))return 'Call (unclassified)';
 return ''}
function contractFacilityForLine(line,globalFacility){const l=line;
 const known=(db.facilities||[]).map(f=>f.name).filter(Boolean).sort((a,b)=>b.length-a.length).find(n=>l.toLowerCase().includes(n.toLowerCase()));
 if(known)return {name:known,fromSaved:true};
 if(/^holzer\b/i.test(l.trim())||/\bholzer\s+(8|10|12|24)\b/i.test(l))return {name:'Holzer',fromSaved:false};
 const lab=l.match(/(?:facility|hospital|location|site|work\s+at)\s*:\s*([A-Za-z][^,\n;—-]{2,60})/i);
 if(lab)return {name:lab[1].trim().replace(/\s+(shift|call|day).*$/i,'').trim(),fromSaved:false};
 const gen=l.match(/([A-Z][A-Za-z'& ]+?(?:Hospital|Medical Center|Health System|Clinic))/);
 if(gen)return {name:gen[1].trim(),fromSaved:false};
 if(globalFacility)return {name:globalFacility,fromHeader:true};
 return {name:'',fromSaved:false}}
function contractExtractRates(text){const rates={};let m;
 const textNoWeekend=String(text).split(/\r?\n/).filter(l=>!/weekend|saturday|sunday/i.test(l)).join('\n');
 const flatBase=text;
 if((m=text.match(/\$([\d,]+(?:\.\d{2})?)\s*(?:\/\s*hr|per hour|an hour|\/hour|hourly)/i)))rates.hourly=Number(m[1].replace(/,/g,''));
 const flat=(label,rx)=>{const hit=textNoWeekend.match(rx);if(hit)rates[label]=Number(hit[1].replace(/,/g,''))};
 const flatWeekend=(label,rx)=>{const hit=text.match(rx);if(hit)rates[label]=Number(hit[1].replace(/,/g,''))};
 flat('rate24',/\$([\d,]+(?:\.\d{2})?)[^$\n]{0,60}?(?:24\s*-?\s*hour|24h|1st call|first call)/i);
 flat('rate24',/(?:24\s*-?\s*hour|24h|1st call|first call)[^$\n]{0,60}?\$([\d,]+(?:\.\d{2})?)/i);
 flat('rateSecond',/\$([\d,]+(?:\.\d{2})?)[^$\n]{0,60}?(?:2nd call|second call)/i);
 flat('rateSecond',/(?:2nd call|second call)[^$\n]{0,60}?\$([\d,]+(?:\.\d{2})?)/i);
 flat('rate8',/\$([\d,]+(?:\.\d{2})?)[^$\n]{0,60}?(?:8\s*-?\s*hour|8h)/i);
 flat('rate8',/(?:8\s*-?\s*hour|8h)[^$\n]{0,60}?\$([\d,]+(?:\.\d{2})?)/i);
 flat('rate10',/\$([\d,]+(?:\.\d{2})?)[^$\n]{0,60}?(?:10\s*-?\s*hour|10h)/i);
 flat('rate12',/\$([\d,]+(?:\.\d{2})?)[^$\n]{0,60}?(?:12\s*-?\s*hour|12h)/i);
 flatWeekend('weekendRate24',/(?:weekend|saturday|sunday)[^$\n]{0,80}?(?:24\s*-?\s*hour|1st call)[^$\n]{0,40}?\$([\d,]+(?:\.\d{2})?)/i);
 flatWeekend('weekendRateSecond',/(?:weekend|saturday|sunday)[^$\n]{0,80}?(?:2nd call|second call)[^$\n]{0,40}?\$([\d,]+(?:\.\d{2})?)/i);
 if((m=text.match(/\$([\d,]+(?:\.\d{2})?)[^$\n]{0,50}?(?:call bonus|overnight call bonus)/i))||(m=text.match(/(?:call bonus|overnight[^$\n]{0,30}bonus|bonus[^$\n]{0,30}call)[^$\n]{0,40}?\$([\d,]+(?:\.\d{2})?)/i)))rates.callBonus=Number(m[1].replace(/,/g,''));
 if((m=text.match(/paid\s+for\s+(\d+(?:\.\d+)?)\s*hours/i)))rates.paidHours8=Number(m[1]);
 if((m=text.match(/\$([\d,]+(?:\.\d{2})?)\s*\/\s*hr/i)))rates.hourly=Number(m[1].replace(/,/g,''));
 return rates}
function contractResolvePay(row,rates,facilityObj,savedContract){const weekend=row.date?([0,6].includes(new Date(row.date+'T12:00:00').getDay())):false;
 const flatKey=row.type==='24-hour call'?(weekend&&rates.weekendRate24?['weekendRate24','weekend flat rate stated in document']:['rate24','flat rate stated in document'])
  :row.type==='Second call'?(weekend&&rates.weekendRateSecond?['weekendRateSecond','weekend flat rate stated in document']:['rateSecond','flat rate stated in document'])
  :row.type==='8-hour day'?['rate8','flat rate stated in document']:row.type==='10-hour shift'?['rate10','flat rate stated in document']:row.type==='12-hour shift'?['rate12','flat rate stated in document']:null;
 if(flatKey&&rates[flatKey[0]]!=null)return {pay:String(rates[flatKey[0]]),source:flatKey[1],flags:[]};
 if(rates.hourly!=null){const hours=row.type==='8-hour day'?(rates.paidHours8||8):row.type==='10-hour shift'?10:row.type==='12-hour shift'?12:row.type==='24-hour call'?null:8;
   if(hours){let pay=rates.hourly*hours,flags=[];
     if(row.type==='Second call'){if(rates.callBonus!=null)pay+=rates.callBonus;else flags.push('call bonus not stated in document — pay may be incomplete')}
     return {pay:String(Math.round(pay*100)/100),source:'hourly rate stated in document',flags}}}
 if(facilityObj){const fpay=row.type==='24-hour call'?num(facilityObj.rate24):row.type==='Second call'?num(facilityObj.rateSecond):row.type==='8-hour day'?num(facilityObj.rate8):0;
   if(fpay>0)return {pay:String(fpay),source:'saved facility rate (not stated in this document)',flags:['rate reused from saved facility — not stated in this document']}}
 if(savedContract&&savedContract.rates){const r=savedContract.rates,spay=row.type==='24-hour call'?r.rate24:row.type==='Second call'?r.rateSecond:row.type==='8-hour day'?r.rate8:row.type==='10-hour shift'?r.rate10:row.type==='12-hour shift'?r.rate12:null;
   if(spay!=null)return {pay:String(spay),source:'saved contract rate (not stated in this document)',flags:['rate reused from a saved contract — not stated in this document']}}
 return {pay:'',source:'',flags:['unknown rate — pay not yet priced (incomplete, not $0)']}}
function parseContractText(text,fileName){const clean=String(text||'').replace(/^\uFEFF/,'');const years=(clean.match(/\b(19|20)\d{2}\b/g)||[]);const defaultYear=years.length?+years[0]:new Date().getFullYear();
 const rates=contractExtractRates(clean);
 let globalFacility='';const lab=clean.match(/(?:facility|hospital|location|site)\s*:\s*([A-Za-z][^,\n;]{2,60})/i);if(lab)globalFacility=lab[1].trim();
 if(!globalFacility){const known=(db.facilities||[]).find(f=>clean.toLowerCase().includes(f.name.toLowerCase()));if(known)globalFacility=known.name}
 if(!globalFacility&&/holzer/i.test(clean))globalFacility='Holzer';
 let effStart='',effEnd='';const term=clean.match(/(?:effective|term|period)[^\n]{0,120}/i);
 if(term){const ds=contractDateList(term[0],defaultYear);if(ds.length){effStart=ds[0].iso;effEnd=ds[ds.length-1].iso}}
 const rows=[];
 for(const rawLine of clean.split(/\r?\n/)){const line=rawLine.trim();if(!line)continue;
   if(/^(effective|term|agreement date|rate|hourly rate|compensation|pay rate)\b/i.test(line)&&!/call|shift|hour\s+day/i.test(line))continue;
   const type=contractShiftType(line);if(!type)continue;
   const isRateLine=/\$/.test(line)&&/rate|hourly|per hour|\/hr|compensation/i.test(line)&&!contractDateList(line,defaultYear).length;
   if(isRateLine)continue;
   const dates=contractDateList(line,defaultYear);
   if(!dates.length){const fac=contractFacilityForLine(line,globalFacility);const flags=['missing date — fix the date or uncheck this row before approving'];
     if(!fac.name)flags.push('unknown facility');if(type==='Call (unclassified)')flags.push('shift type not classified — confirm 1st vs 2nd call');
     rows.push({date:'',facility:fac.name,type,pay:'',paySource:'',flags,include:true,source:'extracted-from-contract',status:'proposed'});continue}
   for(const d of dates){const fac=contractFacilityForLine(line,globalFacility);const flags=[];
     if(d.ambiguous)flags.push('ambiguous date — year assumed, verify it');
     if(d.rangeError)flags.push('date range could not be expanded — verify the end date');
     if(!fac.name)flags.push('unknown facility');
     if(fac.fromHeader)flags.push('facility assumed from document header — verify it');
     if(type==='Call (unclassified)')flags.push('shift type not classified — confirm 1st vs 2nd call');
     const facilityObj=(db.facilities||[]).find(f=>f.name.toLowerCase()===fac.name.toLowerCase());
     const savedContract=(db.contracts||[]).find(c=>(c.facility||'').toLowerCase()===fac.name.toLowerCase());
     const resolved=contractResolvePay({date:d.iso,type},rates,facilityObj,savedContract);flags.push(...resolved.flags);
     const dup=(db.shifts||[]).some(x=>x.date===d.iso&&x.facility===fac.name&&x.type===type)||rows.some(x=>x.date===d.iso&&x.facility===fac.name&&x.type===type);
     if(dup)flags.push('overlapping / duplicate shift already recorded or listed above');
     const lineMoney=/\$/.test(line)?contractMoney(line):null;
     let pay=resolved.pay,paySource=resolved.source;
     if(lineMoney!=null&&/(flat|for|total)/i.test(line)){pay=String(lineMoney);paySource='flat amount stated on this line in the document'}
     rows.push({date:d.iso,facility:fac.name,type,pay,paySource,flags,include:true,source:'extracted-from-contract',status:'proposed'})}}
 if(!effStart&&rows.length){const ds=rows.map(r=>r.date).filter(Boolean).sort();if(ds.length){effStart=ds[0];effEnd=ds[ds.length-1]}}
 const contract={id:id(),facility:globalFacility||(rows[0]?rows[0].facility:''),effectiveStart:effStart,effectiveEnd:effEnd,rates,source:'extracted-from-contract',sourceFile:fileName||'',method:'deterministic-parse (no AI model)',extractedAt:new Date().toISOString()};
 return {contract,rows}}
function parseICS(text,fileName){const clean=String(text||'').replace(/^\uFEFF/,'');const rates=contractExtractRates(clean);const rows=[];let globalFacility='';
 const blocks=clean.split(/BEGIN:VEVENT/i).slice(1);
 for(const b of blocks){const get=k=>{const m=b.match(new RegExp(k+':(.*)','i'));return m?m[1].trim():''};
   const dt=get('DTSTART(?:;[^:]*)?');let dateStr=dt.replace(/^(\d{4})(\d{2})(\d{2}).*$/,'$1-$2-$3');if(!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)){const p=contractParseSingle(dt);dateStr=p.iso||''}
   const summary=get('SUMMARY'),location=get('LOCATION'),desc=get('DESCRIPTION').replace(/\\n/g,' ');
   const type=contractShiftType(summary+' '+desc)||'Other';
   const facObj=contractFacilityForLine(location||summary,globalFacility);
   const facility=facObj.name||location||'';if(facility&&!globalFacility)globalFacility=facility;
   const flags=[];if(!facility)flags.push('unknown facility');if(type==='Other')flags.push('shift type not classified from event title');
   if(/RRULE/i.test(b))flags.push('recurring rule (RRULE) not expanded — only the first occurrence is listed');
   const facilityObj=(db.facilities||[]).find(f=>f.name.toLowerCase()===facility.toLowerCase());
   const savedContract=(db.contracts||[]).find(c=>(c.facility||'').toLowerCase()===facility.toLowerCase());
   const resolved=contractResolvePay({date:dateStr,type},rates,facilityObj,savedContract);flags.push(...resolved.flags);
   if((db.shifts||[]).some(x=>x.date===dateStr&&x.facility===facility&&x.type===type))flags.push('overlapping / duplicate shift already recorded');
   rows.push({date:dateStr,facility,type,pay:resolved.pay,paySource:resolved.source,flags,include:true,source:'extracted-from-contract',status:'proposed'})}
 const ds=rows.map(r=>r.date).filter(Boolean).sort();
 const contract={id:id(),facility:globalFacility||(rows[0]?rows[0].facility:''),effectiveStart:ds[0]||'',effectiveEnd:ds[ds.length-1]||'',rates,source:'extracted-from-contract',sourceFile:fileName||'',method:'deterministic-parse (no AI model)',extractedAt:new Date().toISOString()};
 return {contract,rows}}
function contractPreviewHTML(){if(!contractPreview)return '<p class="muted">No contract parsed yet. Choose a file or paste text above, then click “Parse contract” — nothing is saved until you approve the preview below.</p>';
 const c=contractPreview.contract,rows=contractPreview.rows,need=rows.filter(r=>r.flags.length).length,clean=rows.length-need;
 return `<p><strong>Parsed from:</strong> ${escapeHTML(contractPreview.fileName||'pasted text')} · <strong>Method:</strong> ${contractPreview.isPhoto?'OCR on your device (Tesseract.js) + deterministic parsing — no picture was sent to a server, and no AI model read this document. Every row below is flagged “from photo — check carefully” because OCR can misread digits and dates.':'deterministic text parsing — no AI model read this document.'}</p>
 <p class="muted">Contract on file will be: ${escapeHTML(c.facility||'(facility to confirm)')} · ${c.effectiveStart?fmt(c.effectiveStart):'—'} to ${c.effectiveEnd?fmt(c.effectiveEnd):'—'} · Rates found: ${Object.keys(c.rates||{}).length?Object.entries(c.rates).map(([k,v])=>`${k} ${currency(v)}`).join(', '):'none stated in the document'}</p>
 <p>${rows.length} shift(s) in preview · ${clean} clean · ${need} need review. <strong>Nothing has been saved yet.</strong> Edit a row, uncheck rows you do not want, then click Approve. Rows with a missing date or facility cannot be approved until fixed or unchecked.</p>
 <div style="overflow-x:auto"><table class="contract-table"><thead><tr><th>Include</th><th>Date</th><th>Facility</th><th>Shift type</th><th>Pay ($)</th><th>Flags / pricing source</th></tr></thead><tbody>
 ${rows.map((r,i)=>`<tr><td><input type="checkbox" class="contractInclude" data-row="${i}" ${r.include?'checked':''}></td>
 <td><input type="date" class="contractEdit" data-row="${i}" data-field="date" value="${escapeHTML(r.date||'')}"></td>
 <td><input type="text" class="contractEdit" data-row="${i}" data-field="facility" value="${escapeHTML(r.facility||'')}"></td>
 <td><select class="contractEdit" data-row="${i}" data-field="type">${['8-hour day','10-hour shift','12-hour shift','24-hour call','Second call','Other','Call (unclassified)'].map(o=>`<option value="${o}" ${r.type===o?'selected':''}>${o}</option>`).join('')}</select></td>
 <td><input type="number" min="0" step="0.01" class="contractEdit" data-row="${i}" data-field="pay" value="${escapeHTML(r.pay??'')}" placeholder="Not priced"></td>
 <td>${r.flags.length?`<span class="pill warn">${escapeHTML(r.flags.join(' · '))}</span>`:'<span class="pill">Clean</span>'}<div class="muted">${escapeHTML(r.paySource||'No rate found — leave pay blank to mark incomplete')}</div><div class="muted">Status: proposed · Source: ${escapeHTML(r.source||'extracted-from-contract')}</div></td></tr>`).join('')}
 </tbody></table></div>
 <div class="toolbar" style="margin-top:12px"><button data-action="contract-approve">Approve selected — create contract &amp; shifts</button><button type="button" class="secondary" data-action="contract-discard">Discard preview (save nothing)</button></div>
 <p class="hint">Unpriced rows (pay left blank) are saved as incomplete, never as $0. Approved shifts are stored on this device only, in the same shift store as CSV imports, with status “proposed” and source “extracted-from-contract” (or “extracted-from-contract-photo” for picture imports).</p>`}
async function extractPdfText(file){if(typeof window==='undefined'||!window.pdfjsLib){await new Promise((res,rej)=>{const s=document.createElement('script');s.src='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';s.onload=res;s.onerror=()=>rej(new Error('PDF library (PDF.js CDN) failed to load — check your connection and try again, or paste the text instead.'));document.head.appendChild(s)})}
 const lib=window.pdfjsLib;if(lib.GlobalWorkerOptions)lib.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
 const buf=await file.arrayBuffer();const pdf=await lib.getDocument({data:buf}).promise;let out=[];
 for(let i=1;i<=pdf.numPages;i++){const page=await pdf.getPage(i);const tc=await page.getTextContent();out.push(tc.items.map(it=>it.str).join(' '))}
 return out.join('\n')}

// --- On-device contract-picture OCR + picture storage (IndexedDB) ---
// Pictures are read with Tesseract.js loaded on demand from a CDN, only
// when a picture is chosen. No picture leaves the device for OCR.
// Pictures are kept in IndexedDB (not localStorage, which cannot hold
// photos reliably), keyed by contract id, so they stay viewable from the
// contract record. Cloud document storage is not enabled yet, so a picture
// is on-device only and the Saved contracts list says so. It is never
// served from a public URL.
let contractPendingImage=null,contractOcrStatus='';
function contractImageDb(){return new Promise((res,rej)=>{const req=indexedDB.open('crna-hub-files',1);req.onupgradeneeded=()=>{if(!req.result.objectStoreNames.contains('files'))req.result.createObjectStore('files',{keyPath:'id'})};req.onsuccess=()=>res(req.result);req.onerror=()=>rej(req.error)})}
async function saveContractImage(contractId,file){const dbx=await contractImageDb();return new Promise((res,rej)=>{const tx=dbx.transaction('files','readwrite');tx.objectStore('files').put({id:contractId,name:file.name,type:file.type,blob:file,savedAt:new Date().toISOString()});tx.oncomplete=()=>res(true);tx.onerror=()=>rej(tx.error)})}
async function getContractImage(contractId){const dbx=await contractImageDb();return new Promise((res,rej)=>{const req=dbx.transaction('files','readonly').objectStore('files').get(contractId);req.onsuccess=()=>res(req.result||null);req.onerror=()=>rej(req.error)})}
async function viewContractImage(contractId){try{const rec=await getContractImage(contractId);if(!rec||!rec.blob){alert('No picture is stored on this device for this contract.');return}const url=URL.createObjectURL(rec.blob);window.open(url,'_blank');setTimeout(()=>URL.revokeObjectURL(url),60000)}catch(err){alert('Could not open the stored picture: '+err.message)}}
async function loadTesseract(){if(window.Tesseract)return window.Tesseract;await new Promise((res,rej)=>{const sc=document.createElement('script');sc.src='https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';sc.onload=res;sc.onerror=()=>rej(new Error('OCR library (Tesseract.js CDN) failed to load — check your connection and try again, or paste the contract text instead.'));document.head.appendChild(sc)});if(!window.Tesseract)throw new Error('OCR library failed to initialise.');return window.Tesseract}
async function ocrImageFile(file,onProgress){const T=await loadTesseract();const out=await T.recognize(file,'eng',{logger:m=>{if(onProgress)onProgress(m)}});return (out&&out.data&&out.data.text)||''}
async function importContract(e){e.preventDefault();contractImportError='';contractPendingImage=null;contractOcrStatus='';const f=$('f_contractFile')?$('f_contractFile').files[0]:null;
 const name=f?f.name:'';const ext=name?('.'+name.split('.').pop().toLowerCase()):'';const mime=f?f.type:'';
 if(f&&(/image\//.test(mime)||['.png','.jpg','.jpeg','.webp','.heic'].includes(ext))){
   contractPendingImage=f;contractOcrStatus='Reading your picture on this device with OCR (Tesseract.js) — no picture is sent to a server for OCR. This can take a few seconds…';contractImportError='';contractPreview=null;render();
   try{const text=await ocrImageFile(f,m=>{const el=document.getElementById('contractOcrStatus');if(el&&m&&m.status)el.textContent=`Reading your picture on this device with OCR… ${m.status}${m.progress!=null?' '+Math.round(m.progress*100)+'%':''}`});
     contractOcrStatus='';
     if(!text.trim()){contractImportError='OCR read no text from this picture. Try a clearer, well-lit photo with the text upright, or paste the contract text instead. Nothing was saved.';contractPreview=null;contractPendingImage=null;render();return}
     const p=parseContractText(text,fileName);
     p.rows.forEach(r=>{r.source='extracted-from-contract-photo';r.flags=['from photo — check carefully (OCR can misread digits and dates)',...r.flags]});
     p.contract.method='ocr + deterministic-parse (on-device OCR, no AI model, no server upload for OCR)';p.contract.source='extracted-from-contract-photo';
     contractPreview={...p,fileName,isPhoto:true,ocrText:text,imageFileName:name};
     if(!contractPreview.rows.length){contractImportError='OCR read text, but deterministic parsing found no shifts in it (no date + shift pattern on the same line). Check the preview is not possible here — fix the photo or paste the contract text instead. Nothing was saved.';contractPreview=null;contractPendingImage=null;render();return}
     render()}catch(err){contractOcrStatus='';contractPreview=null;contractPendingImage=null;contractImportError=(ext==='.heic'?'Could not read this picture: '+err.message+' HEIC pictures cannot always be decoded in a browser — export it as JPG or PNG and try again. ':'Could not read this picture with on-device OCR: '+err.message+' Try a clearer photo, or paste the contract text instead. ')+'Nothing was saved.';render()}
   return}
 try{let text='',fileName=name||'pasted text';
   if(f){if(ext==='.pdf'){text=await extractPdfText(f)}else{text=await f.text()}}
   else{text=$('f_contractText')?$('f_contractText').value:''}
   if(!text.trim()){contractImportError='Nothing to parse: choose a file or paste contract text first. Nothing was saved.';contractPreview=null;render();return}
   if(ext==='.ics'||/^BEGIN:VCALENDAR/i.test(text.trim())){const p=parseICS(text,fileName);contractPreview={...p,fileName}}
   else{const p=parseContractText(text,fileName);contractPreview={...p,fileName}}
   if(!contractPreview.rows.length){contractImportError='No shifts were found in this document by deterministic parsing (no date + shift pattern on the same line, and no calendar events). Check the text and try again, or add the shifts manually on the Dashboard. Nothing was saved.';contractPreview=null;render();return}
   render()}catch(err){contractImportError='Could not read this file: '+err.message+' Nothing was saved.';contractPreview=null;render()}}
async function approveContractImport(){if(!contractPreview)return;const rows=contractPreview.rows.filter(r=>r.include);
 const blocked=rows.filter(r=>!r.date||!/^\d{4}-\d{2}-\d{2}$/.test(r.date)||!r.facility.trim());
 if(blocked.length){alert('Fix or uncheck these rows before approving: '+(blocked.map(r=>`${r.date||'(no date)'} ${r.facility||'(no facility)'} ${r.type}`).join('; ')));return}
 let contractId=contractPreview.contract.id;
 const existing=(db.contracts||[]).find(c=>(c.facility||'').toLowerCase()===(contractPreview.contract.facility||'').toLowerCase()&&JSON.stringify(c.rates||{})===JSON.stringify(contractPreview.contract.rates||{}));
 if(existing)contractId=existing.id;
 else{db.contracts=db.contracts||[];db.contracts.push({...contractPreview.contract,id:contractId,shiftCount:0})}
 let created=0,skipped=0,incomplete=0;
 for(const r of rows){if((db.shifts||[]).some(x=>x.date===r.date&&x.facility===r.facility&&x.type===r.type)){skipped++;continue}
   const pay=String(r.pay||'').trim();if(!pay)incomplete++;
   db.shifts.push({id:id(),date:r.date,facility:r.facility.trim(),type:r.type,pay,status:'proposed',source:r.source||'extracted-from-contract',contractId,incomplete:!pay,note:`Extracted from contract: ${contractPreview.fileName} — ${contractPreview.isPhoto?'OCR on-device (Tesseract.js) + deterministic parse — check carefully, OCR can misread digits and dates.':'deterministic parse, no AI model read this document.'}${pay?'':' Pay not yet priced — incomplete.'}`});created++}
 const c=(db.contracts||[]).find(x=>x.id===contractId);if(c){c.shiftCount=(db.shifts||[]).filter(x=>x.contractId===contractId).length;
   if(contractPreview.isPhoto&&contractPendingImage){try{await saveContractImage(contractId,contractPendingImage);c.imageFileName=contractPreview.imageFileName||contractPendingImage.name;c.imageStored='indexeddb';c.imageStorageNote='on-device only — cloud document storage not enabled yet'}catch(err){c.imageFileName=contractPreview.imageFileName||contractPendingImage.name;c.imageStored='failed';c.imageStorageNote='picture could not be stored on this device: '+err.message}}}
 contractPreview=null;contractPendingImage=null;contractOcrStatus='';persist();render();alert(`Approved: ${created} shift(s) created${incomplete?` (${incomplete} incomplete — pay not yet priced)`:''}${skipped?`; ${skipped} duplicate(s) skipped`:''}. Contract record saved and linked to the new shifts.`)}
// --- Supabase Auth + credential sync (fetch-based, no extra dependency) ---
// Reads/writes ONLY the five migration-001 tables, with user_id = auth uid.
// Row Level Security on those tables restricts every row to its owner.
// Shifts, facilities, mileage, and PTO are NOT synced in this release: they
// stay on-device, and the Account tab says so. Live NBCRNA / AANA / state
// portal pulls are NOT part of this section: they need a server-side Edge
// Function (next phase) and are never faked from the browser.
// Safety rule: cloud data is never overwritten silently. On first sign-in
// the user must explicitly choose "Upload my on-device records" or
// "Load cloud records" on the Account tab; until then edits stay local.
const SUPABASE_CFG = (typeof window !== 'undefined' && window.CRNHUB_SUPABASE) || {};
const SUPABASE_CONFIGURED = !!(SUPABASE_CFG.url && SUPABASE_CFG.anonKey && String(SUPABASE_CFG.anonKey).indexOf('PASTE') === -1);
let cloudSession = null, cloudActive = false, cloudPending = null, cloudOffline = false, cloudError = '', cloudLastSync = '', cloudSyncTimes = {}, cloudAuthStatus = '', cloudPortals = [];
try { cloudSession = JSON.parse(localStorage.getItem('crna-hub-supabase-session') || 'null'); cloudActive = localStorage.getItem('crna-hub-cloud-active') === '1'; cloudLastSync = localStorage.getItem('crna-hub-last-sync') || ''; } catch (e) {}
function cloudPersistSession() { try { if (cloudSession) localStorage.setItem('crna-hub-supabase-session', JSON.stringify(cloudSession)); else localStorage.removeItem('crna-hub-supabase-session'); localStorage.setItem('crna-hub-cloud-active', cloudActive ? '1' : '0'); if (cloudLastSync) localStorage.setItem('crna-hub-last-sync', cloudLastSync); } catch (e) {} }
function cloudMode() { if (!SUPABASE_CONFIGURED) return 'not-configured'; if (!cloudSession) return 'signed-out'; if (cloudPending) return 'pending'; if (!cloudActive) return 'signed-out'; return cloudOffline ? 'cloud-offline' : 'cloud'; }
function cloudSyncEnabled() { return SUPABASE_CONFIGURED && !!cloudSession && cloudActive && !cloudPending; }
function cloudHeaderLabel() { const m = cloudMode(); if (m === 'not-configured') return 'Supabase not configured'; if (m === 'signed-out') return cloudSession ? 'Signed in · Choose sync on Account' : 'On this device · Not signed in'; if (m === 'pending') return 'Signed in · Choose sync on Account'; if (m === 'cloud-offline') return 'Cloud (offline) · On-device copy'; return 'Cloud · ' + (cloudSession.email || 'signed in'); }
function cloudModeHint() { const m = cloudMode(); if (m === 'not-configured') return 'Supabase is not configured yet, so everything here is saved on this device only.'; if (m === 'signed-out') return 'Not signed in, so everything here is saved on this device only.'; if (m === 'pending') return 'Signed in, but you have not chosen upload or load yet, so edits here are still on-device only — choose on the Account tab.'; if (m === 'cloud-offline') return 'Cloud account is unreachable right now, so this is the on-device copy. Credential edits will retry on the next sync.'; return 'Signed in — credential records sync to your Supabase account. Shifts, facilities, mileage, and PTO stay on this device.'; }
function cloudAssistantAnswer() { if (!SUPABASE_CONFIGURED) return 'Cloud accounts and sync are not in this release on this device yet: Supabase is not configured (paste the publishable key into supabase-config.js — see the README), so data lives in this browser only (localStorage). Use Import & Backup to download a JSON backup before changing phones or clearing browser data.'; if (!cloudSession) return 'You are not signed in, so data lives in this browser only (localStorage). Sign in on the Account tab to sync NBCRNA, AANA, license, and CE records to your Supabase account. Use Import & Backup to download a JSON backup before changing phones or clearing browser data.'; if (cloudPending) return 'You are signed in, but you have not chosen how to merge yet, so records are still on-device only. Open the Account tab and choose "Upload my on-device records" or "Load cloud records".'; return 'You are signed in and credential records (NBCRNA, AANA, licenses, CE records) sync to your Supabase account; shifts, facilities, mileage, and PTO stay on this device. Portal pulls run from the Credentials tab — NBCRNA by public lookup, AANA by one-time sign-in, state boards where automation is allowed (WV and Ohio block it). Records a pull brings back are labelled with their source; the rest are user-entered, not verified.'; }
function cloudFmtWhen(iso) { try { return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }); } catch (e) { return ''; } }
async function sbAuthPost(url, body, signal) {
  // One POST attempt (no fallback here — the caller decides).
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(body), signal: signal || undefined });
  const text = await r.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (e) {}
  return { r, data };
}
async function sbAuthReq(path, body, opts) {
  // Same-origin proxy first: the browser only talks to its own origin,
  // and the Vercel function forwards to Supabase server-side. This is
  // the path that works when a direct browser-to-Supabase POST fails
  // at the network layer ("Load failed") on the user's device.
  // Fallback to direct Supabase happens ONLY on a network failure or
  // when the proxy is absent (404/501, e.g. an older preview or a
  // local file copy) — never on an upstream error status, so a
  // sign-up is never submitted twice.
  const ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), 30000) : null;
  const signal = ctrl ? ctrl.signal : undefined;
  const parsePath = (p) => {
    const q = p.indexOf('?');
    if (q === -1) return { base: p, query: {} };
    const query = {};
    p.slice(q + 1).split('&').forEach((kv) => { const e = kv.indexOf('='); if (e !== -1) query[decodeURIComponent(kv.slice(0, e))] = decodeURIComponent(kv.slice(e + 1)); });
    return { base: p.slice(0, q), query };
  };
  const fail = (e) => {
    if (timer) clearTimeout(timer);
    if (e && e.name === 'AbortError') throw new Error('Request timed out after 30 seconds — check your connection and try again.');
    throw new Error('Could not reach the sign-in service from this browser (network error: ' + (e && e.message ? e.message : 'request failed') + '). Check your connection, turn off any content blocker or VPN for this site, and try again.');
  };
  try {
    const part = parsePath(path);
    const endpoint = part.base === '/auth/v1/signup' ? 'signup' : part.base === '/auth/v1/token' ? 'token' : part.base === '/auth/v1/logout' ? 'logout' : null;
    if (endpoint) {
      const proxyBody = { endpoint, query: part.query, body };
      if (opts && opts.token) proxyBody.token = opts.token;
      let pr;
      try {
        pr = await sbAuthPost('/api/auth', proxyBody, signal);
      } catch (e) {
        // Proxy unreachable at the network layer — fall through to direct.
        pr = null;
      }
      if (pr && pr.r.status !== 404 && pr.r.status !== 501) {
        // Any non-404/501 proxy answer is final (the X-Auth-Proxy
        // header marks it when present) — never fall through to
        // direct after the proxy has answered, or a sign-up could
        // be submitted twice.
        if (timer) clearTimeout(timer);
        if (!pr.r.ok) throw new Error((pr.data && (pr.data.error_description || pr.data.msg || pr.data.message || pr.data.error)) || ('Sign-in failed (' + pr.r.status + ')'));
        return pr.data;
      }
      // pr null (network failure) or 404/501 (no proxy deployed): direct.
    }
    const sep = path.indexOf('?') === -1 ? '?' : '&';
    const url = SUPABASE_CFG.url + path + sep + 'apikey=' + encodeURIComponent(SUPABASE_CFG.anonKey);
    const direct = await sbAuthPost(url, body, signal);
    if (timer) clearTimeout(timer);
    if (!direct.r.ok) throw new Error((direct.data && (direct.data.error_description || direct.data.msg || direct.data.message || direct.data.error)) || ('Sign-in failed (' + direct.r.status + ')'));
    return direct.data;
  } catch (e) {
    if (e && e.name === 'AbortError') { if (timer) clearTimeout(timer); throw new Error('Request timed out after 30 seconds — check your connection and try again.'); }
    if (e && /Sign-in failed \(/.test(e.message || '')) { if (timer) clearTimeout(timer); throw e; }
    fail(e);
  } finally { if (timer) clearTimeout(timer); }
}

function cloudStoreSession(data) { if (!data || !data.access_token) return false; cloudSession = { access_token: data.access_token, refresh_token: data.refresh_token || (cloudSession && cloudSession.refresh_token), expires_at: Math.floor(Date.now() / 1000) + (data.expires_in || 3600), email: (data.user && data.user.email) || (cloudSession && cloudSession.email) || '', user_id: (data.user && data.user.id) || (cloudSession && cloudSession.user_id) || '' }; cloudPersistSession(); return true; }
async function cloudEnsureToken() { if (!cloudSession) throw new Error('Not signed in'); if (cloudSession.expires_at && Date.now() / 1000 < cloudSession.expires_at - 60) return; if (!cloudSession.refresh_token) throw new Error('Session expired — sign in again'); const data = await sbAuthReq('/auth/v1/token?grant_type=refresh_token', { refresh_token: cloudSession.refresh_token }); if (!cloudStoreSession(data)) throw new Error('Session expired — sign in again'); }
async function sbStorageReq(path, method, file, contentType) {
  // Same-origin proxy first for Storage objects (same reason as sbReq):
  // the browser only talks to its own origin, and /api/rest forwards to
  // Supabase server-side. Falls back to direct only on a network failure
  // or 404/501 (proxy absent) — never on an upstream error status, so a
  // file is never uploaded or deleted twice.
  await cloudEnsureToken();
  const token = cloudSession.access_token;
  const direct = () => fetch(SUPABASE_CFG.url + path, { method, headers: Object.assign({ apikey: SUPABASE_CFG.anonKey, Authorization: 'Bearer ' + token }, contentType ? { 'Content-Type': contentType } : {}), body: file || undefined });
  let proxyBody = { path, method, token };
  if (file) {
    const b64 = await new Promise((res, rej) => { const rd = new FileReader(); rd.onload = () => res(String(rd.result).split(',')[1] || ''); rd.onerror = () => rej(new Error('Could not read file')); rd.readAsDataURL(file); });
    proxyBody.bodyBase64 = b64;
    proxyBody.contentType = contentType || 'application/octet-stream';
  }
  try {
    const ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), 30000) : null;
    let pr;
    try { pr = await fetch('/api/rest', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(proxyBody), signal: ctrl ? ctrl.signal : undefined }); } catch (e) { pr = null; }
    if (timer) clearTimeout(timer);
    if (pr && pr.status !== 404 && pr.status !== 501) return pr;
  } catch (e) {}
  return direct();
}
async function sbReq(path, method, body) {
  // Same-origin proxy first (see sbStorageReq): the browser only talks to
  // its own origin, and /api/rest forwards PostgREST requests to Supabase
  // server-side with the user's token, so RLS still applies. Fallback to
  // direct Supabase happens ONLY on a network failure or when the proxy
  // is absent (404/501, e.g. an older preview) — never on an upstream
  // error status, so a record is never written twice.
  await cloudEnsureToken();
  const token = cloudSession.access_token;
  const prefer = (method === 'POST' && body) ? 'resolution=merge-duplicates,return=minimal' : null;
  const direct = () => fetch(SUPABASE_CFG.url + path, { method, headers: Object.assign({ apikey: SUPABASE_CFG.anonKey, 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, prefer ? { Prefer: prefer } : {}), body: body ? JSON.stringify(body) : undefined });
  const ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), 30000) : null;
  let r;
  try {
    let pr = null;
    try { pr = await fetch('/api/rest', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path, method, body: body === undefined ? null : body, token, prefer }), signal: ctrl ? ctrl.signal : undefined }); } catch (e) { pr = null; }
    if (pr && pr.status !== 404 && pr.status !== 501) { r = pr; } else { r = await direct(); }
  } catch (e) {
    if (timer) clearTimeout(timer);
    if (e && e.name === 'AbortError') throw new Error('Sync timed out after 30 seconds — check your connection and try again.');
    throw new Error('Could not reach the sync service from this browser (network error: ' + (e && e.message ? e.message : 'request failed') + '). Check your connection and try again.');
  } finally { if (timer) clearTimeout(timer); }
  const text = await r.text(); let data = null; try { data = text ? JSON.parse(text) : null; } catch (e) {} if (!r.ok) throw new Error((data && (data.message || data.msg || data.error_description)) || ('Sync failed (' + r.status + ')')); return data;
}
function cloudUid() { return cloudSession ? cloudSession.user_id : ''; }
async function cloudFetchAll() { const uid = cloudUid(), q = '?select=*&user_id=eq.' + encodeURIComponent(uid); const nb = await sbReq('/rest/v1/nbcrna_profiles' + q, 'GET'); const aa = await sbReq('/rest/v1/aana_memberships' + q, 'GET'); const lic = await sbReq('/rest/v1/licenses' + q, 'GET'); const ce = await sbReq('/rest/v1/ce_records' + q, 'GET'); const portals = await sbReq('/rest/v1/portal_connections' + q, 'GET'); let docs=[]; try { docs = await sbReq('/rest/v1/documents' + q, 'GET'); } catch (e) { docs = []; } return { nbcrna: (nb && nb[0]) || null, aana: (aa && aa[0]) || null, licenses: lic || [], ce: ce || [], portals: portals || [], documents: docs || [] }; }
function cloudCountsOf(data) { return { nbcrna: data.nbcrna ? 1 : 0, aana: data.aana ? 1 : 0, licenses: (data.licenses || []).length, ce: (data.ce || []).length }; }
function cloudLocalHasNbcrna() { const n = db.nbcrna || {}; return !!(n.status || n.number || n.periodStart || n.periodEnd || n.renewalDeadline); }
function cloudLocalHasAana() { const a = db.aana || {}; return !!(a.status || a.number || a.expiration); }
function cloudLocalHasRecords() { return cloudLocalHasNbcrna() || cloudLocalHasAana() || (db.licenses || []).length > 0 || (db.nbcrnaCE || []).length > 0 || (db.aanaCE || []).length > 0; }
function cloudLocalCounts() { return { nbcrna: cloudLocalHasNbcrna() ? 1 : 0, aana: cloudLocalHasAana() ? 1 : 0, licenses: (db.licenses || []).length, ce: (db.nbcrnaCE || []).length + (db.aanaCE || []).length }; }
function cloudNumOrNull(v) { if (v === '' || v === null || v === undefined) return null; const n = Number(v); return Number.isFinite(n) ? n : null; }
function cloudNow() { return new Date().toISOString(); }
function cloudNbcrnaRow() { const n = db.nbcrna || {}; return { user_id: cloudUid(), certification_status: n.status || null, certification_number: n.number || null, period_start: n.periodStart || null, period_end: n.periodEnd || null, renewal_deadline: n.renewalDeadline || null, class_a_credits: cloudNumOrNull(n.classA), class_b_credits: cloudNumOrNull(n.classB), mac_ed_credits: cloudNumOrNull(n.macEd), mac_dev_credits: cloudNumOrNull(n.macDev), mac_ed_required: cloudNumOrNull(n.macEdRequired) || 60, mac_dev_required: cloudNumOrNull(n.macDevRequired) || 40, cpc_check_in_status: null, source: n.source || 'user_entered', last_synced_at: cloudNow() }; }
function cloudAanaRow() { const a = db.aana || {}; return { user_id: cloudUid(), membership_status: a.status || null, membership_number: a.number || null, expiration: a.expiration || null, source: a.source || 'user_entered', last_synced_at: cloudNow() }; }
function cloudLicenseRow(x) { return { id: x.id, user_id: cloudUid(), state: x.state, license_type: x.type, license_number: x.number || null, issue_date: x.issue || null, expiration_date: x.expiry || null, status: null, board_portal_url: x.portal || null, notes: x.note || null, source: x.source || 'user_entered', last_synced_at: cloudNow() }; }
function cloudCeRow(x, source) { return { id: x.id, user_id: cloudUid(), source: source, title: x.title || null, credits: cloudNumOrNull(x.credits) || 0, credit_class: source === 'nbcrna' ? (x.class || null) : null, completed_date: x.date || null }; }
async function cloudUpsertPortals() { const states = []; (db.licenses || []).forEach(x => { if (x.state && states.indexOf(x.state) === -1) states.push(x.state); }); const desired = [{ portal: 'nbcrna', state: null }, { portal: 'aana', state: null }].concat(states.map(st => ({ portal: 'state_board', state: st }))); let existing = []; try { existing = await sbReq('/rest/v1/portal_connections?select=*&user_id=eq.' + encodeURIComponent(cloudUid()), 'GET'); } catch (e) { existing = []; } // Only create rows that do not exist yet, as 'not_connected' —
// NEVER overwrite an existing row's status: a portal that a live pull
// marked 'connected' (or a failed attempt marked 'failed') must not be
// reset to 'connected' by a manual upload, or vice versa.
const missing = desired.filter(d => !(existing || []).some(e => e.portal === d.portal && (e.state || null) === (d.state || null))); if (missing.length) { const rows = missing.map(d => ({ id: id(), user_id: cloudUid(), portal: d.portal, state: d.state, status: 'not_connected', last_synced_at: null, last_error: null })); await sbReq('/rest/v1/portal_connections', 'POST', rows); } }
async function cloudUploadLocal() { if (!cloudSession) return; try { const rows = []; if (cloudLocalHasNbcrna()) rows.push(sbReq('/rest/v1/nbcrna_profiles', 'POST', cloudNbcrnaRow())); if (cloudLocalHasAana()) rows.push(sbReq('/rest/v1/aana_memberships', 'POST', cloudAanaRow())); if ((db.licenses || []).length) rows.push(sbReq('/rest/v1/licenses', 'POST', (db.licenses || []).map(cloudLicenseRow))); const ceRows = (db.nbcrnaCE || []).map(x => cloudCeRow(x, 'nbcrna')).concat((db.aanaCE || []).map(x => cloudCeRow(x, 'aana'))); if ((db.documents || []).length) rows.push(sbReq('/rest/v1/documents', 'POST', (db.documents || []).map(cloudDocumentRow))); if (ceRows.length) rows.push(sbReq('/rest/v1/ce_records', 'POST', ceRows)); await Promise.all(rows); await cloudUpsertPortals(); cloudActive = true; cloudPending = null; cloudOffline = false; cloudError = ''; cloudLastSync = cloudNow(); cloudPersistSession(); render(); alert('On-device credential records uploaded to your cloud account.'); } catch (e) { cloudOffline = true; cloudError = e.message; render(); alert('Upload failed: ' + e.message); } }
function cloudApplyData(data) { const prevN = db.nbcrna || {}, prevA = db.aana || {}; cloudPortals = data.portals || []; if (data.nbcrna) { const r = data.nbcrna; db.nbcrna = { status: r.certification_status || '', number: r.certification_number || '', periodStart: r.period_start || '', periodEnd: r.period_end || '', renewalDeadline: r.renewal_deadline || r.period_end || '', source: r.source || 'user_entered', classA: r.class_a_credits === null || r.class_a_credits === undefined ? '' : String(r.class_a_credits), classB: r.class_b_credits === null || r.class_b_credits === undefined ? '' : String(r.class_b_credits), macEd: r.mac_ed_credits === null || r.mac_ed_credits === undefined ? '' : String(r.mac_ed_credits), macDev: r.mac_dev_credits === null || r.mac_dev_credits === undefined ? '' : String(r.mac_dev_credits), macEdRequired: r.mac_ed_required || 60, macDevRequired: r.mac_dev_required || 40, docNote: prevN.docNote || '', ceNote: prevN.ceNote || '', reminders: prevN.reminders || '90,60,30,7' }; cloudSyncTimes.nbcrna = r.last_synced_at || ''; } const licRem = {}; (db.licenses || []).forEach(x => { licRem[x.id] = x.reminders; }); db.licenses = (data.licenses || []).map(r => ({ id: r.id, state: r.state, type: r.license_type, number: r.license_number || '', issue: r.issue_date || '', expiry: r.expiration_date || '', portal: r.board_portal_url || '', note: r.notes || '', source: r.source || 'user_entered', reminders: licRem[r.id] || '90,60,30,7' })); if ((data.licenses || []).length) cloudSyncTimes.licenses = (data.licenses || []).map(r => r.last_synced_at || '').sort().pop(); if (data.aana) { const r = data.aana; db.aana = { status: r.membership_status || '', number: r.membership_number || '', expiration: r.expiration || '', source: r.source || 'user_entered', docNote: prevA.docNote || '', ceNote: prevA.ceNote || '', reminders: prevA.reminders || '90,60,30,7' }; cloudSyncTimes.aana = r.last_synced_at || ''; } db.nbcrnaCE = (data.ce || []).filter(r => r.source === 'nbcrna').map(r => ({ id: r.id, title: r.title || '', date: r.completed_date || '', credits: r.credits === null || r.credits === undefined ? '' : String(r.credits), class: r.credit_class || 'Class A' })); db.aanaCE = (data.ce || []).filter(r => r.source === 'aana').map(r => ({ id: r.id, title: r.title || '', date: r.completed_date || '', credits: r.credits === null || r.credits === undefined ? '' : String(r.credits), note: '' }));if (Array.isArray(data.documents)) { const cloudDocs = data.documents.map(r => ({ id: r.id, certType: r.cert_type || '', issue: r.issue_date || '', expiry: r.expiration_date || '', expirySource: r.expiry_source || 'user_entered', fileName: r.file_name || '', storagePath: r.storage_path || '', storageStatus: r.storage_path ? 'cloud' : 'local_details_only', uploadedAt: r.uploaded_at || '' })); const cloudIds = new Set(cloudDocs.map(r => r.id)); const localOnly = (db.documents || []).filter(x => !cloudIds.has(x.id)); db.documents = [...cloudDocs, ...localOnly]; }
cloudActive = true; cloudPending = null; cloudOffline = false; cloudError = ''; cloudLastSync = cloudNow(); cloudPersistSession(); persist(); }
async function cloudLoadIntoLocal() { if (!cloudSession) return; try { const data = await cloudFetchAll(); cloudApplyData(data); render(); alert('Cloud credential records loaded onto this device.'); } catch (e) { cloudOffline = true; cloudError = e.message; render(); alert('Sync failed: ' + e.message); } }
async function cloudAfterSignIn() { try { const data = await cloudFetchAll(); const counts = cloudCountsOf(data); if (cloudActive) { cloudApplyData(data); } else { cloudPending = { counts: counts, hasLocal: cloudLocalHasRecords() }; } render(); setTab('Account'); } catch (e) { cloudOffline = true; cloudError = e.message; cloudPending = { counts: null, hasLocal: cloudLocalHasRecords() }; render(); setTab('Account'); } }
async function submitCloudAuth(e) { e.preventDefault(); const fd = new FormData(e.currentTarget); const email = String(fd.get('email') || '').trim(), password = String(fd.get('password') || ''); if (!email || !password) { cloudAuthStatus = 'Enter an email and password.'; render(); return alert('Enter an email and password.'); } cloudAuthStatus = 'Signing in\u2026'; render(); try { const data = await sbAuthReq('/auth/v1/token?grant_type=password', { email: email, password: password }); if (!cloudStoreSession(data)) throw new Error('Sign-in succeeded but no session was returned. If email confirmation is required, confirm from your inbox, then sign in again.'); cloudAuthStatus = ''; await cloudAfterSignIn(); } catch (err) { let msg = err.message || ''; if (/email not confirmed/i.test(msg)) msg = 'Email not confirmed yet \u2014 check your inbox for the confirmation email, open its link, then sign in again.'; cloudAuthStatus = 'Sign-in failed: ' + msg; render(); alert('Sign-in failed: ' + msg); } }
async function cloudSignUp(email, password) { cloudAuthStatus = 'Creating account\u2026'; render(); try { const data = await sbAuthReq('/auth/v1/signup', { email: email, password: password }); if (!cloudStoreSession(data)) { cloudAuthStatus = 'Account created. If Supabase requires email confirmation, confirm from your inbox, then sign in with the form above.'; render(); alert('Account created. If Supabase requires email confirmation, confirm from your inbox, then sign in with the form above.'); return; } cloudAuthStatus = ''; await cloudAfterSignIn(); } catch (err) { let msg = err.message || ''; if (/email rate limit/i.test(msg)) msg = 'Too many confirmation emails were sent recently \u2014 wait a little while and try again, or sign in if the account was already created.'; cloudAuthStatus = 'Sign-up failed: ' + msg; render(); alert('Sign-up failed: ' + msg); } }
async function cloudSignOut() { try { if (cloudSession) await sbAuthReq('/auth/v1/logout', {}, { token: cloudSession.access_token }); } catch (e) {} cloudSession = null; cloudActive = false; cloudPending = null; cloudOffline = false; cloudError = ''; cloudPersistSession(); render(); }
function cloudDocumentRow(x) { return { id: x.id, user_id: cloudUid(), cert_type: x.certType || null, file_name: x.fileName || null, storage_path: x.storagePath || null, issue_date: x.issue || null, expiration_date: x.expiry || null, expiry_source: x.expirySource || 'user_entered', storage_status: x.storageStatus || 'local_details_only', uploaded_at: x.uploadedAt || cloudNow() }; }
async function cloudSaveDocument(rec) { if (!cloudSyncEnabled()) return; try { await sbReq('/rest/v1/documents', 'POST', cloudDocumentRow(rec)); cloudOffline = false; cloudError = ''; cloudLastSync = cloudNow(); cloudPersistSession(); } catch (e) { cloudOffline = true; cloudError = e.message; } }
function cloudDeleteDocument(entryId) { if (!cloudSyncEnabled()) return; const rec = (db.documents || []).find(x => x.id === entryId); (async () => { try { if (rec && rec.storagePath) { await cloudEnsureToken(); await sbStorageReq('/storage/v1/object/certification-documents/' + rec.storagePath.split('/').map(encodeURIComponent).join('/'), 'DELETE'); } await sbReq('/rest/v1/documents?id=eq.' + encodeURIComponent(entryId), 'DELETE'); } catch (e) { cloudOffline = true; cloudError = e.message; } })(); }

function cloudSaveKind(kind, savedId) { if (!cloudSyncEnabled()) return; (async () => { try { if (kind === 'nbcrna') { if (cloudLocalHasNbcrna()) { await sbReq('/rest/v1/nbcrna_profiles', 'POST', cloudNbcrnaRow()); await cloudUpsertPortals(); } } else if (kind === 'aana') { if (cloudLocalHasAana()) { await sbReq('/rest/v1/aana_memberships', 'POST', cloudAanaRow()); await cloudUpsertPortals(); } } else if (kind === 'licenses') { const rec = (db.licenses || []).find(x => x.id === savedId); if (rec) { await sbReq('/rest/v1/licenses', 'POST', cloudLicenseRow(rec)); await cloudUpsertPortals(); } } else if (kind === 'nbcrnaCE') { const rec = (db.nbcrnaCE || []).find(x => x.id === savedId); if (rec) await sbReq('/rest/v1/ce_records', 'POST', cloudCeRow(rec, 'nbcrna')); } else if (kind === 'aanaCE') { const rec = (db.aanaCE || []).find(x => x.id === savedId); if (rec) await sbReq('/rest/v1/ce_records', 'POST', cloudCeRow(rec, 'aana')); } else if (kind === 'documents') { const rec = (db.documents || []).find(x => x.id === savedId); if (rec) await sbReq('/rest/v1/documents', 'POST', cloudDocumentRow(rec)); } cloudOffline = false; cloudError = ''; cloudLastSync = cloudNow(); cloudPersistSession(); } catch (e) { cloudOffline = true; cloudError = e.message; } })(); }
function cloudDeleteKind(kind, entryId) { if (!cloudSyncEnabled()) return; (async () => { try { const table = kind === 'licenses' ? 'licenses' : 'ce_records'; await sbReq('/rest/v1/' + table + '?id=eq.' + encodeURIComponent(entryId), 'DELETE'); } catch (e) { cloudOffline = true; cloudError = e.message; } })(); }
function cloudPortalState(key) { if (!SUPABASE_CONFIGURED) return { label: 'Not connected', detail: 'Supabase not configured — paste the publishable key (see the Account tab)' }; if (!cloudSession) return { label: 'Not connected', detail: 'Sign in on the Account tab to sync records to your account' }; if (cloudPending || !cloudActive) return { label: 'Not connected', detail: 'Signed in — choose upload or load on the Account tab first' }; if (cloudOffline) return { label: 'Signed in (offline)', detail: 'Showing the on-device copy; the last sync attempt failed' + (cloudError ? ' (' + cloudError + ')' : '') }; // Read the real portal_connections row — never derive "Connected"
  // from having a record on file. A manual record is not a portal pull.
  const rows = cloudPortals || [];
  const row = key === 'licenses'
    ? rows.filter(r => r.portal === 'state_board').sort((a, b) => String(b.last_synced_at || '').localeCompare(String(a.last_synced_at || '')))[0]
    : rows.find(r => r.portal === key);
  if (!row) return { label: 'Not connected', detail: 'No portal pull yet — use Connect below, or the manual entry fallback' };
  const when = row.last_synced_at ? ' · last attempt ' + cloudFmtWhen(row.last_synced_at) : '';
  if (row.status === 'connected') return { label: 'Connected — live portal pull', detail: 'Verified by the portal' + when };
  if (row.status === 'needs_reauth') return { label: 'Needs sign-in again', detail: (row.last_error || 'The portal session expired — connect again') + when };
  if (row.status === 'failed') return { label: 'Connection failed', detail: (row.last_error || 'The last portal attempt failed') + when };
  return { label: 'Not connected', detail: 'No portal pull yet — use Connect below, or the manual entry fallback' }; }
function portalSourceLabel(source, when) { const labels = { 'public_verification': 'Verified — NBCRNA public lookup', 'nbcrna_portal': 'Verified — NBCRNA portal', 'aana_portal': 'Verified — AANA member sign-in', 'state_board_portal': 'Verified — state board lookup', 'user_entered': 'User-entered — not verified' }; return (labels[source] || 'User-entered — not verified') + (when ? ' · ' + cloudFmtWhen(when) : ''); }
// --- Live portal connections (portal-sync Edge Function) ---
// NBCRNA = public verification by name (no password). AANA = one-time
// member sign-in (password sent once, never stored). State boards = public
// verification attempt per state; WV and Ohio block automation, so those
// report the manual route instead of a fake pull.
let portalAanaForm = false, portalBusy = '';
async function portalRefreshStatus() { try { if (typeof liveSyncGet !== 'function') return; const data = await liveSyncGet('portal-sync', 'status'); cloudPortals = data.connections || []; } catch (e) {} }
async function portalCall(body) { await cloudEnsureToken(); return await liveSyncPost('portal-sync', body); }
function portalErrMsg(e) { return (e && e.data && e.data.message) || (e && e.message) || 'The portal check failed.'; }
async function portalConnectNbcrna() {
  const first = prompt('NBCRNA public verification — first name (as certified):', '');
  if (first === null) return;
  const last = prompt('Last name (as certified):', '');
  if (last === null) return;
  if (!first.trim() || !last.trim()) { alert('Enter both a first and last name to verify.'); return; }
  const cert = prompt('Certification number (optional — leave blank to search by name):', (db.nbcrna && db.nbcrna.number) || '');
  if (cert === null) return;
  const state = prompt('State (optional, e.g. WV):', '');
  if (state === null) return;
  portalBusy = 'nbcrna'; render();
  try {
    const data = await portalCall({ action: 'verify-nbcrna', firstName: first.trim(), lastName: last.trim(), certNumber: (cert || '').trim(), state: (state || '').trim() });
    const r = data.record || {};
    db.nbcrna = { ...(db.nbcrna || {}), status: r.certification_status || 'Certified', number: r.certification_number || (db.nbcrna && db.nbcrna.number) || '', periodEnd: r.period_end || (db.nbcrna && db.nbcrna.periodEnd) || '', renewalDeadline: r.renewal_deadline || (db.nbcrna && db.nbcrna.renewalDeadline) || '', source: 'public_verification', reminders: (db.nbcrna && db.nbcrna.reminders) || '90,60,30,7' };
    cloudSyncTimes.nbcrna = data.retrievedAt || cloudNow();
    persist();
    await portalRefreshStatus();
    render();
    alert('NBCRNA verified: ' + (r.certification_number ? 'certification ' + r.certification_number + ', ' : '') + 'expires ' + (r.period_end || 'unknown') + '.\n\n' + (r.note || ''));
  } catch (e) {
    await portalRefreshStatus();
    alert('NBCRNA check did not pull a record: ' + portalErrMsg(e) + '\n\nYour manual record (if any) is unchanged.');
  } finally { portalBusy = ''; render(); }
}
async function portalConnectLicense() {
  const defState = (db.licenses && db.licenses[0] && db.licenses[0].state) || 'West Virginia';
  const state = prompt('State license to verify (e.g. West Virginia):', defState);
  if (state === null) return;
  const first = prompt('First name (as licensed):', '');
  if (first === null) return;
  const last = prompt('Last name (as licensed):', '');
  if (last === null) return;
  if (!first.trim() || !last.trim() || !state.trim()) { alert('Enter a state, first name, and last name.'); return; }
  const num = prompt('License number (optional):', '');
  if (num === null) return;
  portalBusy = 'licenses'; render();
  try {
    const data = await portalCall({ action: 'verify-license', state: state.trim(), firstName: first.trim(), lastName: last.trim(), licenseNumber: (num || '').trim() });
    const r = data.record || {};
    if (r.license_number || r.expiration_date) {
      const rec = { id: id(), state: state.trim(), type: r.license_type || 'APRN', number: r.license_number || (num || '').trim(), issue: r.issue_date || '', expiry: r.expiration_date || '', portal: r.board_portal_url || '', note: '', source: 'state_board_portal', reminders: '90,60,30,7' };
      db.licenses.push(rec); persist(); cloudSaveKind('licenses', rec.id);
    }
    await portalRefreshStatus();
    render();
    alert('State license verified: ' + (r.license_number || '') + ' expires ' + (r.expiration_date || 'unknown') + '.');
  } catch (e) {
    await portalRefreshStatus();
    alert(portalErrMsg(e) + ((e && e.data && e.data.manualUrl) ? '\n\nManual lookup: ' + e.data.manualUrl : '') + '\n\nYour manual records are unchanged.');
  } finally { portalBusy = ''; render(); }
}
function portalAanaFormHTML() { return `<section class="panel"><h2>Connect AANA — one-time sign-in</h2><p class="muted">Your AANA username and password are sent once, over HTTPS, to the portal-sync function for this single sign-in attempt. They are <strong>never stored</strong> — not in this app, not in Supabase, not in any log. AANA sign-in runs through SSO and that page is bot-gated, so this attempt may report that sign-in could not be completed — use the AANA CE transcript upload or the manual entry below then. AANA also shares CE with NBCRNA, so NBCRNA totals may already cover the same credits.</p><form data-kind="portal-aana"><div class="form-grid">${field('username', 'AANA username / email', 'text', '', 'required autocomplete="username"')}${field('password', 'AANA password', 'password', '', 'required autocomplete="current-password"')}</div><div class="form-actions"><button type="submit">Sign in to AANA once</button><button type="button" class="secondary" data-action="portal-aana-cancel">Cancel</button></div></form></section>`; }
async function portalAanaSubmit(e) {
  e.preventDefault();
  const fd = new FormData(e.currentTarget);
  const username = String(fd.get('username') || '').trim();
  let password = String(fd.get('password') || '');
  const pwEl = e.currentTarget.querySelector('[name="password"]');
  if (pwEl) pwEl.value = '';
  portalAanaForm = false;
  if (!username || !password) { render(); alert('Enter your AANA username and password.'); return; }
  portalBusy = 'aana'; render();
  try {
    const data = await portalCall({ action: 'connect-aana', username, password });
    const r = data.record || {};
    db.aana = { ...(db.aana || {}), status: r.membership_status || 'Active', source: 'aana_portal', reminders: (db.aana && db.aana.reminders) || '90,60,30,7' };
    cloudSyncTimes.aana = data.retrievedAt || cloudNow();
    persist();
    await portalRefreshStatus();
    render();
    alert('AANA connected: membership ' + (r.membership_status || 'Active') + '.\n\n' + (r.note || ''));
  } catch (err) {
    await portalRefreshStatus();
    alert('AANA sign-in did not complete: ' + portalErrMsg(err) + '\n\nYour manual record (if any) is unchanged.');
  } finally { password = ''; portalBusy = ''; render(); }
}
function cloudCountsLine(c) { if (!c) return 'unknown'; return 'NBCRNA: ' + c.nbcrna + ' · AANA: ' + c.aana + ' · Licenses: ' + c.licenses + ' · CE records: ' + c.ce; }
function accountPage() {
  if (!SUPABASE_CONFIGURED) return `<section class="panel"><h2>Account — Supabase not configured</h2><p><strong>Sign-in and cloud sync are not available yet.</strong> The app is working on-device only, exactly as before.</p><p class="muted">To enable it, the owner pastes the project's publishable (anon) key into <code>supabase-config.js</code> (replacing <code>PASTE_PUBLISHABLE_KEY_HERE</code>) and redeploys. Find it in the Supabase dashboard: Project Settings → API → Publishable key, for project <code>xgoghgihfhtnyevgapyp</code> (<code>https://xgoghgihfhtnyevgapyp.supabase.com</code>).</p><p class="muted">The publishable key is a public client key and is safe to embed. Never paste the secret key or service-role key into this repo or any client file — those bypass Row Level Security and belong server-side only.</p><p class="muted">Until the key is filled in, nothing here fails silently: this page, the header, and the Credentials cards all say "not configured".</p></section>`;
  if (!cloudSession) return `<section class="panel"><h2>Account — sign in to sync credentials</h2><p class="muted">Signing in syncs NBCRNA, AANA, license, and CE records (and portal-connection status) between this device and your Supabase account. Shifts, facilities, mileage, and PTO stay on this device in this release. Portal pulls run from the Credentials tab once you are signed in — NBCRNA by public lookup, AANA by one-time sign-in, state boards where automation is allowed (WV and Ohio block it). Records a pull brings back are labelled with their source; the rest are user-entered, not verified, and no portal passwords are ever stored.</p><form id="cloudAuthForm"><div class="form-grid">${field('email', 'Email', 'email', '', 'required autocomplete="email"')}${field('password', 'Password', 'password', '', 'required autocomplete="current-password"')}</div>${formEnd('Sign in')}</form>${cloudAuthStatus ? `<p class="hint" id="cloudAuthStatus">${escapeHTML(cloudAuthStatus)}</p>` : ''}<div class="toolbar"><button type="button" class="secondary" data-action="cloud-signup">Create account</button></div><p class="muted">Creating an account uses Supabase Auth (email + password). If Supabase requires email confirmation, confirm from your inbox, then sign in.</p></section>`;
  if (cloudPending) { const c = cloudPending.counts; return `<section class="panel"><h2>Account — choose how to sync</h2><p><strong>Signed in as ${escapeHTML(cloudSession.email || '')}.</strong> Before anything syncs, choose one direction. Nothing has been overwritten.</p><p class="muted">Cloud records: ${escapeHTML(cloudCountsLine(c))}</p><p class="muted">On-device records: ${escapeHTML(cloudCountsLine(cloudLocalCounts()))}</p><div class="toolbar"><button data-action="cloud-upload">Upload my on-device records to my account</button><button class="secondary" data-action="cloud-load">Load cloud records onto this device</button></div><p class="muted">Upload overwrites the cloud credential records with the ones on this device. Load replaces the credential records on this device with the cloud ones. Either way, shifts, facilities, mileage, and PTO are untouched.</p><div class="toolbar"><button type="button" class="secondary tiny" data-action="cloud-keep-local">Decide later (keep working on-device for now)</button><button type="button" class="secondary tiny" data-action="cloud-signout">Sign out</button></div></section>`; }
  const lc = cloudLocalCounts(); return `<section class="panel"><h2>Account</h2><p><strong>Signed in as ${escapeHTML(cloudSession.email || '')}.</strong> Mode: <strong>${escapeHTML(cloudHeaderLabel())}</strong></p><p class="muted">On-device credential records: ${escapeHTML(cloudCountsLine(lc))}${cloudLastSync ? ' · Last sync: ' + escapeHTML(cloudFmtWhen(cloudLastSync)) : ''}</p>${cloudError ? `<p class="muted">Last sync problem: ${escapeHTML(cloudError)}</p>` : ''}<p class="muted">Credential edits here save to your cloud account automatically while signed in. Shifts, facilities, mileage, and PTO stay on this device. Portal pulls run from the Credentials tab — records a pull brings back are labelled with their source; the rest are user-entered, not verified.</p><div class="toolbar"><button data-action="cloud-sync">Sync now (download cloud records)</button><button class="secondary" data-action="cloud-upload">Upload my on-device records</button><button class="secondary" data-action="cloud-signout">Sign out</button></div><p class="muted">Sync now replaces the credential records on this device with the cloud ones. Upload overwrites the cloud credential records with the ones on this device. Both ask for confirmation first.</p></section>`;
}
async function cloudInit() { if (!SUPABASE_CONFIGURED || !cloudSession) return; try { await cloudEnsureToken(); } catch (e) { cloudSession = null; cloudActive = false; cloudPending = null; cloudPersistSession(); render(); return; } if (cloudActive) { try { const data = await cloudFetchAll(); cloudApplyData(data); render(); } catch (e) { cloudOffline = true; cloudError = e.message; render(); } } else { try { const data = await cloudFetchAll(); cloudPending = { counts: cloudCountsOf(data), hasLocal: cloudLocalHasRecords() }; render(); } catch (e) { cloudPending = { counts: null, hasLocal: cloudLocalHasRecords() }; render(); } } }

render();cloudInit();if('serviceWorker'in navigator&&location.protocol==='https:')navigator.serviceWorker.register('./sw.js').catch(()=>{});
