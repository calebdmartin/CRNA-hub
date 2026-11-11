'use strict';
const KEY='crna-hub-v2',OLD='crna-hub-starter-v1',tabs=['Account','Dashboard','Facilities','Credentials','Mileage','Assistant'];
const empty=()=>({shifts:[],facilities:[],pto:[],credentials:[],mileage:[],vehicles:[],contracts:[],payStubs:[],nbcrna:{status:'',number:'',periodStart:'',periodEnd:'',renewalDeadline:'',classA:'',classB:'',macEd:'',macDev:'',macEdRequired:60,macDevRequired:40,docNote:'',ceNote:'',reminders:'90,60,30,7',source:'user_entered'},aana:{status:'',number:'',expiration:'',docNote:'',ceNote:'',reminders:'90,60,30,7',source:'user_entered'},nbcrnaCE:[],aanaCE:[],licenses:[],documents:[],assistantChat:[],portalChecks:[],portalMonitoring:[],hotelStays:[],facilitySuggestions:[],settings:{monthlyIncomeGoal:0,employmentType:'',scheduleName:'',scheduleImported:false,scheduleImportFile:'',scheduleImportedAt:'',qgendaConnected:false,qgendaMasked:'',qgendaLastCheckedAt:'',ptoAnnual:0,ptoStarting:0,ptoHoursPerPeriod:0,namePicks:{},homeAddress:'',hotelAddress:'',homeLat:'',homeLng:'',homeGeocodedAddress:'',lastHotelAddress:'',mileageTripType:'round-trip',deleteAlsoFromCalendar:false,featureMileage:true,featurePaychecks:true,featureCredentials:true,featureQgenda:true,featurePush:true}});
// --- Facility rates: blank means "doesn't apply / not taken here", never $0.
// rateOrNull returns the rate as a positive number, or null when the field
// is blank, 0, or negative. A stored 0 (e.g. a "24-hour call rate ($)" of 0
// entered before this change) is treated exactly like a blank field, so a
// shift type with no rate stays unpriced/incomplete instead of becoming a
// $0 shift. This mirrors the server-side ruleNum in
// supabase/functions/_shared/calendar.ts, which also drops 0 to null.
function rateOrNull(v){const s=String(v??'').trim();if(!s)return null;const n=Number(s);return (Number.isFinite(n)&&n>0)?n:null}
const RATE_FIELDS=['hourlyRate','rate8','rate10','rate12','rate24','rateSecond','weekendRateSecond','callBonus','hourlyCall1st','weekendRate24'];
function normalizeStoredRates(obj){
  if(!obj||typeof obj!=='object')return obj;
  for(const f of (obj.facilities||[])){
    if(!f||typeof f!=='object')continue;
    for(const k of RATE_FIELDS)if(rateOrNull(f[k])==null)f[k]='';
    if(rateOrNull(f.paidHours8)==null)f.paidHours8='';
    if(rateOrNull(f.distance)==null)f.distance='';
  }
  for(const x of (obj.payStubs||[])){
    if(!x||typeof x!=='object')continue;
    if(String(x.gross??'').trim()!==''&&num(x.gross)===0)x.gross='';
    if(String(x.net??'').trim()!==''&&num(x.net)===0)x.net='';
    x.frequency=normalizePayFrequency(x.frequency);
  }
  for(const x of (obj.shifts||[])){
    if(!x||typeof x!=='object')continue;
    // A stored pay of 0 / "0" is not a priced shift: it is unpriced.
    if(String(x.pay??'').trim()!==''&&num(x.pay)===0){x.pay='';x.incomplete=true}
    // Older shifts may have no status: they default to proposed, never
    // silently to confirmed.
    x.status=normalizeShiftStatus(x.status);
  }
  normalizeMileageTripTypes(obj);
  normalizeFeatureFlags(obj);
  return obj;
}

// --- Optional features (Nov 7, 2026) --------------------------------
// Every optional feature can be turned off by the user: Mileage
// tracking, Paycheck estimates, Credential tracking & portal
// monitoring, and the QGenda feed. Core scheduling/calendar and
// facilities/contracts are the app's spine and stay always-on.
// Off means COLLAPSED, never gone: the tab/panel shrinks to one quiet
// line with a Turn on button, all data is preserved untouched, and the
// feature's automations and prompts go quiet. The flags live in
// db.settings as plain booleans, so they ride the existing
// user_settings cloud sync and survive clear-device -> sign-in.
// A missing flag means ON, so existing users lose nothing.
const FEATURE_DEFS=[
  {key:'featureMileage',label:'Mileage tracking',blurb:'Track drives to your facilities for taxes.'},
  {key:'featurePaychecks',label:'Paycheck estimates',blurb:'Pay dates and paycheck estimates from your pay stubs.'},
  {key:'featureCredentials',label:'Credential tracking & portal monitoring',blurb:'Licenses, certifications, and automatic portal checks.'},
  {key:'featureQgenda',label:'QGenda feed',blurb:'Pull your shifts straight from your QGenda schedule.'},
 {key:'featurePush',label:'Push notifications',blurb:'Get pinged only when something needs your action.'}
];
function featureDef(key){return FEATURE_DEFS.find(f=>f.key===key)||null}
function featureOn(key){return !db||!db.settings||db.settings[key]!==false}
function normalizeFeatureFlags(obj){if(!obj||typeof obj!=='object')return obj;if(!obj.settings||typeof obj.settings!=='object')obj.settings={};for(const f of FEATURE_DEFS)if(typeof obj.settings[f.key]!=='boolean')obj.settings[f.key]=true;return obj}
function setFeature(key,on){db.settings=db.settings||{};db.settings[key]=!!on;persist();if(typeof cloudUploadSynced==='function'&&typeof cloudSyncEnabled==='function'&&cloudSyncEnabled()){try{const p=cloudUploadSynced();if(p&&p.catch)p.catch(()=>{})}catch(e){}}render()}
function featureOffHTML(key){const f=featureDef(key);return `<section class="panel"><p>${escapeHTML(f.label)} is off. Your data is saved \u2014 turn it back on any time. <button type="button" class="secondary tiny" data-action="feature-toggle" data-id="${f.key}">Turn on</button></p></section>`}
function featureTurnOffLineHTML(key){const f=featureDef(key);return `<p class="muted" style="margin-top:14px">Don\u2019t need this? <button type="button" class="secondary tiny" data-action="feature-toggle" data-id="${f.key}">Turn off ${escapeHTML(f.label.toLowerCase())}</button> \u2014 it just tucks away; nothing is deleted.</p>`}
// Features panel collapse state (Nov 11, 2026, v127 — Caleb: "Features
// needs to be collapsible"): the panel is a collapsePanelHTML card like
// its Account neighbours (Notifications, Live calendar sync), so it
// rests collapsed on a fresh open instead of eating the whole tab. The
// open state is session-only UI state, never persisted: render()
// snapshots the live panel before rebuilding (the same capture pattern
// as the mileage log form's draft) so the panel reopens exactly as the
// user left it while they work — tapping a feature toggle re-renders
// the page and must not slam the panel shut mid-task. A fresh app open
// starts collapsed again, matching the neighbours' rendered default.
let featuresPanelOpen=false;
function captureFeaturesPanelState(){try{const el=document.getElementById('features-panel');if(el)featuresPanelOpen=!!el.open}catch(e){}}
function featuresSectionHTML(){const body=`<p class="muted">Use what you need \u2014 turn the rest off and they just tuck away. Nothing is ever deleted.</p>${FEATURE_DEFS.map(f=>{const on=featureOn(f.key);return `<div class="item"><div><div class="item-title">${escapeHTML(f.label)}</div><div class="muted">${escapeHTML(f.blurb)}</div></div><div class="item-actions"><button type="button" class="${on?'secondary ':''}tiny" data-action="feature-toggle" data-id="${f.key}">${on?'On \u2014 tap to turn off':'Off \u2014 tap to turn on'}</button></div></div>`}).join('')}`;return collapsePanelHTML('features-panel','Features',body,featuresPanelOpen)}

// --- Push notifications (v118) --------------------------------------
// Caleb's north star (Nov 11, 2026): everything runs in the background
// and the app only interrupts when a human action is genuinely needed.
// The panel below manages THIS device's subscription; the server-side
// watchdog (push-watchdog Edge Function) evaluates every trigger —
// credential/CE deadlines, empty next month, QGenda link health,
// portal sign-in, calendar-sync health — from the synced records and
// sends at most once per threshold/episode, never in quiet hours
// (22:00-06:00 your time), and taps open the exact screen to act on.
const PUSH_TYPES=[
 {key:'cert',label:'Certification & license expirations'},
 {key:'ce',label:'Education / CE requirements'},
 {key:'calendar',label:'Empty calendar — no shifts next month'},
 {key:'qgenda',label:'QGenda link needs a refresh'},
 {key:'portal',label:'Portal check needs your sign-in'},
 {key:'sync',label:'Calendar sync needs reconnecting'}
];
function pushSupported(){try{return 'serviceWorker' in navigator&&'PushManager' in window&&'Notification' in window}catch(e){return false}}
function pushTypeOn(k){const t=db&&db.settings&&db.settings.pushTypes;return !t||t[k]!==false}
function pushLocalState(){try{return JSON.parse(localStorage.getItem('crna-hub-push')||'{}')}catch(e){return{}}}
function pushLocalSet(x){try{localStorage.setItem('crna-hub-push',JSON.stringify(x||{}))}catch(e){}}
// iPhone/iPad outside the Home Screen install (a Safari tab or an
// in-app webview) can never receive push: PushManager is absent or
// the subscription can never be granted there. The panel LEADS with
// the fix (v120) instead of discovering it after a failed enable.
function pushIosNeedsHomeScreen(){try{const ua=navigator.userAgent||'';const ios=/iPhone|iPad|iPod/i.test(ua)||(/Macintosh/.test(ua)&&'ontouchend' in document);if(!ios)return false;const standalone=(typeof window!=='undefined'&&window.navigator&&window.navigator.standalone===true)||(typeof window!=='undefined'&&typeof window.matchMedia==='function'&&window.matchMedia('(display-mode: standalone)').matches);return !standalone}catch(e){return false}}
// Server-confirmed subscription state for THIS device (v120): the
// local 'crna-hub-push' flag alone is not proof — before the REST
// proxy allowlisted push_subscriptions, enables wrote locally while
// the server write was rejected, so devices claimed "on" with no
// server row and the watchdog had nobody to send to. The panel may
// only say "on" after a read-back finds the row.
let pushServerCheck={state:'idle',subId:'',at:0};
async function pushReconcile(){const st=pushLocalState();if(!st.enabled||!st.subId||typeof cloudSession==='undefined'||!cloudSession)return;if(pushServerCheck.subId===st.subId&&(pushServerCheck.state==='checking'||((pushServerCheck.state==='on'||pushServerCheck.state==='missing')&&Date.now()-pushServerCheck.at<60000)))return;pushServerCheck={state:'checking',subId:st.subId,at:Date.now()};try{const rows=await sbReq('/rest/v1/push_subscriptions?select=id,endpoint&id=eq.'+encodeURIComponent(st.subId),'GET');pushServerCheck={state:(Array.isArray(rows)&&rows.some(r=>r&&r.id===st.subId))?'on':'missing',subId:st.subId,at:Date.now()}}catch(e){pushServerCheck={state:'error',subId:st.subId,at:Date.now()}}render()}
async function pushConfirmOnServer(id){const rows=await sbReq('/rest/v1/push_subscriptions?select=id,endpoint&id=eq.'+encodeURIComponent(id),'GET');return Array.isArray(rows)&&rows.some(r=>r&&r.id===id)}
let pushStatusMsg='';
function urlB64ToUint8Array(s){const pad='='.repeat((4-String(s).length%4)%4);const raw=atob((String(s)+pad).replace(/-/g,'+').replace(/_/g,'/'));const out=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)out[i]=raw.charCodeAt(i);return out}
function pushSubscriptionId(endpoint){let h=5381;const s=String(endpoint||'');for(let i=0;i<s.length;i++)h=((h<<5)+h+s.charCodeAt(i))>>>0;return 'push-'+h.toString(36)+'-'+s.length}
function pushTypesSave(){persist();if(typeof cloudSyncEnabled==='function'&&cloudSyncEnabled()&&cloudSession){try{cloudUploadSynced()}catch(e){}}}
function pushWatch(){const s=db&&db.settings;return s&&s.watch&&typeof s.watch==='object'&&!Array.isArray(s.watch)?s.watch:{}}
function pushWatchSet(patch){if(!db||!db.settings)return;const cur=pushWatch();const next=Object.assign({},cur,patch);if(JSON.stringify(cur)===JSON.stringify(next))return;db.settings.watch=next;pushTypesSave()}
// Mirror the portal monitors' "needs your sign-in" state into the
// synced watch summary the watchdog reads (portal monitor detail
// itself stays on-device by design).
function pushWatchRefreshPortal(){try{if(typeof ensurePortalMonitoring!=='function')return;const today=localDate(new Date());const mons=ensurePortalMonitoring();const list=mons.filter(m=>monitorPromptVisible(m,today)).map(m=>({key:m.key,label:m.label,cycle:monitorNextDue(m,today)}));pushWatchSet({portalSignin:list})}catch(e){}}
// One QGenda link episode at a time: the first rejected-link failure
// opens an episode (the watchdog notifies once for it); the next
// successful check closes it.
function pushWatchQgenda(state){const cur=pushWatch().qgendaLink||{};const now=new Date().toISOString();if(state==='ok'){if(cur.state==='auth_failed')pushWatchSet({qgendaLink:{state:'ok',at:now}});return}if(state==='auth_failed'){const ep=cur.state==='auth_failed'&&cur.episode?cur.episode:now;pushWatchSet({qgendaLink:{state:'auth_failed',episode:ep,at:now}});return}if(state==='disconnected'){pushWatchSet({qgendaLink:{state:'disconnected',at:now}})}}
// Calendar-sync health: any connected calendar in needs_reauth opens
// one episode per provider set; recovery closes it.
function pushWatchSyncHealth(){try{if(typeof liveSyncConnections==='undefined'||!liveSyncConnections)return;const need=Object.keys(liveSyncConnections).filter(pr=>liveSyncConnections[pr]&&liveSyncConnections[pr].status==='needs_reauth');const cur=pushWatch().syncHealth||{};const now=new Date().toISOString();if(!need.length){if(cur.state&&cur.state!=='ok')pushWatchSet({syncHealth:{state:'ok',at:now}});return}const key=need.slice().sort().join(',');const ep=cur.state==='needs_reauth'&&cur.providers===key&&cur.episode?cur.episode:now;pushWatchSet({syncHealth:{state:'needs_reauth',providers:key,episode:ep,at:now}})}catch(e){}}
if(typeof window!=='undefined')window.__crnaWatchSyncHealth=function(){pushWatchSyncHealth()};
async function pushEnable(){if(!pushSupported()){pushStatusMsg='Push is not available in this browser.';render();return}if(!cloudSession){pushStatusMsg='Sign in first — notifications are tied to your account.';render();return}try{const perm=await Notification.requestPermission();if(perm!=='granted'){pushStatusMsg='Notifications are off for this site — you can allow them in your browser settings.';render();return}const reg=await navigator.serviceWorker.ready;const cfg=await liveSyncPost('push-watchdog',{action:'config'});if(!cfg||!cfg.configured||!cfg.vapidPublicKey)throw new Error('push_not_configured');let sub=await reg.pushManager.getSubscription();if(!sub)sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:urlB64ToUint8Array(cfg.vapidPublicKey)});const j=sub.toJSON();const row={id:pushSubscriptionId(sub.endpoint),user_id:cloudUid(),endpoint:sub.endpoint,keys:j.keys||{},tz:(Intl.DateTimeFormat().resolvedOptions().timeZone||''),ua:(navigator.userAgent||'').slice(0,300),updated_at:new Date().toISOString()};await sbReq('/rest/v1/push_subscriptions','POST',row);const confirmed=await pushConfirmOnServer(row.id);if(!confirmed){pushServerCheck={state:'missing',subId:row.id,at:Date.now()};pushStatusMsg='That didn\'t stick \u2014 the server has no subscription for this device, so notifications can\'t reach it. Try turning push on again.';render();return}pushServerCheck={state:'on',subId:row.id,at:Date.now()};pushLocalSet({enabled:true,subId:row.id,endpoint:sub.endpoint,at:new Date().toISOString()});pushStatusMsg='Push is on for this device.'}catch(e){pushStatusMsg=String(e&&e.message)==='push_not_configured'?'Push is not switched on for CRNA Hub yet — your account is fine, this is a setup step on our side.':'Could not turn on push: '+((e&&e.message)||'please try again')}render()}
async function pushDisable(){try{const reg=await navigator.serviceWorker.ready;const sub=await reg.pushManager.getSubscription();const st=pushLocalState();if(sub)await sub.unsubscribe();if(st.subId)await sbReq('/rest/v1/push_subscriptions?id=eq.'+encodeURIComponent(st.subId),'DELETE');}catch(e){}pushLocalSet({});pushServerCheck={state:'idle',subId:'',at:0};pushStatusMsg='Push is off for this device.';render()}
async function pushTest(){if(!cloudSession){pushStatusMsg='Sign in first, then try the test.';render();return}try{const r=await liveSyncPost('push-watchdog',{action:'test'});const st=pushLocalState();const mine=r&&Array.isArray(r.results)?r.results.find(x=>x&&x.id===st.subId):null;if(mine&&mine.pruned){pushLocalSet({});pushServerCheck={state:'idle',subId:'',at:0};pushStatusMsg='Apple says this device\'s subscription is gone \u2014 turn push off and on again.'}else if(r&&r.delivered){pushStatusMsg='Test sent \u2014 it should land on this device in a moment.'}else if(mine&&mine.status){pushStatusMsg='Test could not be delivered to this device \u2014 the push service answered '+mine.status+'.'}else{pushStatusMsg='Test could not be delivered \u2014 check that push is on for this device.'}}catch(e){pushStatusMsg='Test failed: '+((e&&e.message)||'please try again')}render()}
function notificationsPanelHTML(){if(!featureOn('featurePush'))return featureOffHTML('featurePush');const st=pushLocalState();const localOn=!!(st.enabled&&st.subId);let body='';const iosLead=pushIosNeedsHomeScreen();if(iosLead){body+='<p class="small"><strong>Add CRNA Hub to your Home Screen, then open it there and turn push on.</strong></p><p class="small">On iPhone, notifications can only reach CRNA Hub from the Home Screen app: tap the Share button, then \u201cAdd to Home Screen\u201d, then open CRNA Hub from there.</p>'}if(!cloudSession){if(!iosLead)body+='<p class="small">Sign in to turn on push notifications for this device.</p>'}else if(!localOn){if(pushSupported()||iosLead){body+='<p class="small">CRNA Hub keeps an eye on things for you \u2014 renewals, education hours, your schedule \u2014 and only pings you when something needs your action.</p><button class="primary" data-action="push-enable">Turn on push notifications</button>'}else{body+='<p class="small">Push is not available in this browser.</p>'}}else if(pushServerCheck.state==='on'&&pushServerCheck.subId===st.subId){body+='<p class="small ok">\u2713 Push is on for this device.</p><div class="push-types">'+PUSH_TYPES.map(t=>'<div class="row push-type-row"><span>'+escapeHTML(t.label)+'</span><button type="button" class="tiny '+(pushTypeOn(t.key)?'':'secondary')+'" data-action="push-type-toggle" data-id="'+t.key+'">'+(pushTypeOn(t.key)?'On':'Off')+'</button></div>').join('')+'</div><div class="toolbar"><button class="secondary" data-action="push-test">Send a test notification</button><button class="secondary" data-action="push-disable">Turn off on this device</button></div>'}else if(pushServerCheck.state==='missing'&&pushServerCheck.subId===st.subId){body+='<p class="small"><strong>This device says push is on, but there\'s no subscription on the server \u2014 notifications can\'t reach this device.</strong></p><div class="toolbar"><button class="primary" data-action="push-enable">Turn push on again</button><button class="secondary" data-action="push-disable">Turn off on this device</button></div>'}else if(pushServerCheck.state==='error'&&pushServerCheck.subId===st.subId){body+='<p class="small">Couldn\'t check this device\'s subscription just now. If notifications don\'t arrive, turn push off and on again.</p><div class="toolbar"><button class="secondary" data-action="push-test">Send a test notification</button><button class="secondary" data-action="push-disable">Turn off on this device</button></div>'}else{pushReconcile();body+='<p class="small">Checking this device\'s subscription\u2026</p><div class="toolbar"><button class="secondary" data-action="push-disable">Turn off on this device</button></div>'}body+='<p class="small muted">Checks run on our side on a schedule, any time of day \u2014 but nothing is ever sent between 10 PM and 6 AM your time. A check that needs your sign-in still starts when you open the app; the notification is what reaches you wherever you are.</p><p class="small muted">Beta note: on iPhone, push works when CRNA Hub is added to your Home Screen \u2014 that step is only for this web version; in the final app notifications just work.</p>';if(pushStatusMsg)body+='<p class="small">'+escapeHTML(pushStatusMsg)+'</p>';return collapsePanelHTML('notifications-panel','Notifications',body,false)}
// --- Mileage trip type: round trip (default) or one way ---
// Mileage defaults to round trip: the stored miles for a trip are the
// full there-and-back distance. The choice lives in settings
// (mileageTripType) as the per-user default and on each trip record
// (tripType) as the per-trip choice. oneWayMiles is the one-way leg
// stored alongside, so flipping the choice re-calculates exactly
// (round trip = 2 x one-way) instead of halving/doubling a rounded
// total twice. Totals always sum the stored miles once - a round-trip
// value is never doubled again.
function mileageTripType(){return (db.settings&&db.settings.mileageTripType)==='one-way'?'one-way':'round-trip'}
function tripTypeLabel(t){return t==='one-way'?'one way':'round trip'}
function tripMilesFor(oneWay,t){const ow=Number(oneWay||0);if(!(ow>0))return null;return t==='one-way'?Math.round(ow*10)/10:roundTripMiles(ow)}
function oneWayFromTripMiles(miles,t){const m=Number(miles||0);if(!(m>0))return null;return t==='one-way'?Math.round(m*10)/10:Math.round(m/2*10)/10}
function normalizeMileageTripTypes(obj){
  if(!obj||typeof obj!=='object')return obj;
  if(!obj.settings||typeof obj.settings!=='object')obj.settings={};
  if(obj.settings.mileageTripType!=='one-way'&&obj.settings.mileageTripType!=='round-trip')obj.settings.mileageTripType='round-trip';
  for(const m of (obj.mileage||[])){
    if(!m||typeof m!=='object')continue;
    // Trips auto-calculated before this change were always round trip;
    // a plain manual trip takes the current default.
    if(m.tripType!=='one-way'&&m.tripType!=='round-trip')m.tripType=(m.milesSource==='auto'||m.milesSource==='manual-override')?'round-trip':obj.settings.mileageTripType;
    if(!(Number(m.oneWayMiles)>0))m.oneWayMiles=oneWayFromTripMiles(m.miles,m.tripType);
  }
  return obj;
}
function load(){let obj;try{obj=JSON.parse(localStorage.getItem(KEY)||localStorage.getItem(OLD)||'null')}catch{}const result=empty();if(obj&&typeof obj==='object')for(const k of Object.keys(result))if((k==='settings'||k==='nbcrna'||k==='aana')?obj[k]&&typeof obj[k]==='object':Array.isArray(obj[k]))result[k]=obj[k];return normalizeStoredRates(result)}
const SHIFT_STATUSES=['proposed','confirmed','rejected','canceled','completed'];
// Helpers MUST be declared before load() runs below: load() ->
// normalizeStoredRates() calls num() on any stored shift/pay stub, so
// declaring these consts after `let db=load()` was a temporal-dead-zone
// crash ("Cannot access 'num' before initialization") for every user
// with saved data — the app only booted on empty storage (Nov 6, 2026).
const $=id=>document.getElementById(id),escapeHTML=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c])),currency=n=>Number(n||0).toLocaleString('en-US',{style:'currency',currency:'USD',maximumFractionDigits:2}),num=n=>Number(n||0),id=()=>crypto.randomUUID(),fmt=d=>new Date(d+'T12:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});
let db=load(),tab='Dashboard',showShiftForm=false,dayViewOpen=false,manualType='NBCRNA',month=new Date(),selected=localDate(new Date()),editId=null,savedShiftsYear=null,facilitySuggestionPrefill=null;month.setDate(1);
// Open paycheck editor (Nov 7, 2026): {stubId, schedDate, from} — from
// is 'panel' (Upcoming paychecks row) or 'day' (calendar day sheet);
// the editor renders as an overlay sheet in both cases.
let paycheckEdit=null;
// Delete confirmation for a shift (Nov 7, 2026): {id, also} while the
// confirmation sheet is open. `also` is the delete-time choice "Also
// remove it from my <calendar> calendar" — shown only for shifts
// imported from a live synced calendar, unticked by default, and
// initialised from the user's remembered choice
// (settings.deleteAlsoFromCalendar, cloud-synced with settings).
let shiftDeleteConfirm=null;
// Post-sync facility handoff (Nov 11, 2026, v121): a MANUAL calendar
// sync that finishes with shifts held for hospitals the app has no
// facility for shows its result as a SHEET (not an alert) whose
// primary action walks the user straight to those hospitals on the
// Facilities tab — Caleb's fresh-setup sync held 253 shifts behind
// one lumped sentence and left him hunting for the tab himself.
// syncResultSheet = {provider, message, suggestions:[{id,name,count}]}
// while the sheet is open. facilityRescanResult = {name, imported,
// provider} after a suggestion-born facility save re-ran the sync by
// itself. suggestionBornProviders maps a facility created from a
// suggestion card's words path to its sync provider, so confirming
// the words triggers the same automatic re-check.
let syncResultSheet=null;
let facilityRescanResult=null;
let expandedSuggestionId=null;
const suggestionBornProviders={};
function showSyncResultDialog(provider,message,suggestions){syncResultSheet={provider:provider||'',message:String(message||''),suggestions:Array.isArray(suggestions)?suggestions:[]};render()}
function syncResultSheetHTML(){
  if(!syncResultSheet)return '';
  const s=syncResultSheet;
  const list=s.suggestions.map(x=>`<div class="item"><div class="item-title">${escapeHTML(x.name)}</div><div class="muted">${x.count?x.count+' shift(s) waiting':'Shifts waiting'}</div></div>`).join('');
  return `<div class="sheet-backdrop" data-action="sync-result-close"></div><div class="sheet" role="dialog" aria-label="Sync result"><div class="sheet-head"><h2>Sync finished</h2><button type="button" class="sheet-close" data-action="sync-result-close" aria-label="Close">×</button></div><p>${escapeHTML(s.message)}</p>${list?`<p><strong>These hospitals are waiting for their rates:</strong></p>${list}<p class="muted">Add one and its waiting shifts import right away, priced from its rates.</p>`:''}<div class="toolbar">${list?`<button type="button" data-action="sync-result-setup">Set up facilities</button>`:''}<button type="button" class="secondary" data-action="sync-result-close">Close</button></div></div>`;
}
function facilityRescanResultHTML(){
  if(!facilityRescanResult)return '';
  const r=facilityRescanResult;
  const remaining=activeFacilitySuggestions();
  return `<section class="panel" id="facility-rescan-panel"><p><strong>${escapeHTML(r.name)} added — ${r.imported>0?r.imported+' shift(s) imported':'we re-checked, and no waiting shifts were left to import'}.</strong></p>${remaining.length?`<p class="muted">${remaining.length===1?'Another hospital is':'More hospitals are'} still waiting below — set up the next one whenever you're ready.</p>`:`<p><strong>All set</strong> — every hospital from your calendar is set up.</p>`}<div class="toolbar"><button type="button" class="secondary" data-action="facility-rescan-dismiss">Close</button></div></section>`;
}
// Boot cleanup (cross-source dedupe, Nov 6, 2026): data stored before
// the identity rule existed can already hold the same shift two or
// three times (calendar + QGenda + upload). Collapse exact identity
// matches once at load — richest data, best status, and every source
// survive on the one record. Guarded: a failure here must never block
// the app from booting.
try{const bootDedupe=dedupeShiftsInPlace();if(bootDedupe.collapsed)persist()}catch(e){}
try{const bootPairs=healDayCallShiftPairs();if(bootPairs.merged)persist()}catch(e){}
try{const bootFold=healVariantFacilityRecords();if(bootFold)persist()}catch(e){}
try{const bootStubs=healPaystubRecordShapes();if(bootStubs)persist()}catch(e){}
try{const bootPrices=healUnpricedShiftPays();if(bootPrices)persist()}catch(e){}
function localDate(d){return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-')}
// Income totals are scoped to one calendar year at a time (default: the
// current calendar year). Shifts from other years stay in the list and
// the calendar — they are simply out of that year's total, never deleted.
function currentYear(){return new Date().getFullYear()}
function shiftYears(){const ys=[...new Set((db.shifts||[]).map(x=>String(x.date||'').slice(0,4)).filter(y=>/^\d{4}$/.test(y)))].sort();if(!ys.includes(String(currentYear())))ys.push(String(currentYear()));return ys.sort()}
function selectedShiftsYear(){const y=savedShiftsYear||currentYear();return shiftYears().includes(String(y))?+y:currentYear()}
function shiftsForYear(y){const p=String(y)+'-';return (db.shifts||[]).filter(x=>String(x.date||'').startsWith(p))}
// --- Shift status: confirmed / proposed (C/P) ---
// TWO working statuses only (Caleb, Nov 6, 2026): 'confirmed' and
// 'proposed'. 'submitted' is ELIMINATED — a stored 'submitted' value
// (older data, local or cloud) normalizes to 'confirmed' below,
// because every submitted shift originated from a real schedule.
// 'rejected' and 'canceled' remain as record-keeping outcomes and
// count in NO total; 'completed' is confirmed work already done and
// counts with confirmed. A missing or unknown status defaults to
// 'proposed' — never silently treated as confirmed income.
//   * SOURCED shifts save as CONFIRMED: anything arriving from a
//     calendar sync, a contract, QGenda, or a schedule upload is on
//     a real schedule somewhere, so the app treats it as real —
//     see importStatusForDate below.
//   * MANUAL adds ASK: the add form carries an explicit
//     "Confirmed or proposed?" choice (default proposed).
const SHIFT_STATUS_LABELS={proposed:'Proposed',confirmed:'Confirmed',rejected:'Rejected',canceled:'Canceled',completed:'Completed'};
function normalizeShiftStatus(s){const v=String(s||'').trim().toLowerCase();if(v==='submitted')return 'confirmed';return SHIFT_STATUSES.includes(v)?v:'proposed'}
// Status a SOURCED shift arrives with (Nov 6, 2026 status model):
// confirmed, whatever its date — it is on a real schedule (calendar,
// contract, QGenda feed, or an uploaded schedule the user approved).
// This supersedes the Bug 1 date rule (past = confirmed, future =
// proposed). An invalid or missing date still stays 'proposed':
// never confirm a shift with no date. Only the import stamp uses
// this — a stored status is never rewritten by a later sync, and the
// user can still change any shift's status by hand.
function importStatusForDate(date,todayStr){const d=String(date||'').trim();if(!/^\d{4}-\d{2}-\d{2}$/.test(d))return 'proposed';return 'confirmed'}
function shiftStatusLabel(s){return SHIFT_STATUS_LABELS[normalizeShiftStatus(s)]||'Proposed'}
function shiftStatusOptions(current){const c=normalizeShiftStatus(current);return SHIFT_STATUSES.map(s=>`<option value="${s}" ${s===c?'selected':''}>${SHIFT_STATUS_LABELS[s]}</option>`).join('')}
// A W-2 salary day (Off / PTO) is paid through W-2 salary, not as a
// billable 1099 shift — it is excluded from every income total even if a
// pay value was ever stored on it, so W-2 salary is never double-counted.
// The type-text match is a guess, and a user-confirmed UNPAID stamp
// (payUnit 'unpaid' — the user stated in their own words that this
// agency code pays nothing, e.g. a post-call day off) outranks it:
// that shift is an agency code known to pay $0, not a salary day.
function isW2SalaryShift(x){return !!x&&x.payUnit!=='unpaid'&&/off|pto/i.test(String(x.type||''))}
// A shift is priced when it has a pay amount and is not flagged incomplete.
// Unpriced shifts are never $0 - they are excluded from every total and
// counted separately so a total is never silently low. The one known $0
// is an UNPAID shift: pay '0' stamped payUnit 'unpaid' from a confirmed
// no-pay definition — priced at exactly $0, complete, never unpriced.
function isPricedShift(x){return !!x && x.pay!=='' && x.pay!=null && !x.incomplete && (num(x.pay)>0 || (x.payUnit==='unpaid' && num(x.pay)===0))}
// Billable = priced AND not a W-2 salary day AND the user's work includes
// 1099 work. Employment type (step 1, settings.employmentType) drives it:
// '1099' and 'both' price shifts from contracts/facilities as before;
// 'w2' (W-2 only) means pay comes as salary, so no shift is billable
// income here — counting per-shift pay would double-count the salary.
// Unset ('') keeps the legacy behaviour (billable) so existing users'
// totals do not change until they pick a type.
function isBillableShift(x){return isPricedShift(x)&&!isW2SalaryShift(x)&&employmentIncludes1099()}
function sumByStatus(list,statuses){return list.filter(x=>statuses.includes(normalizeShiftStatus(x.status))).reduce((a,x)=>a+num(x.pay),0)}
function countByStatus(list,statuses){return list.filter(x=>statuses.includes(normalizeShiftStatus(x.status))).length}
// --- Cross-source shift dedupe (Nov 6, 2026) ---
// One real-world shift can arrive from several sources at once: the
// user syncs a calendar, connects QGenda, AND uploads a schedule (or a
// contract names the same dates). Without a shared identity rule each
// source minted its own record and the shift was placed — and priced —
// two or three times. The rule now, applied at every door a shift
// enters by (live calendar sync, QGenda via the schedule preview,
// schedule upload, .ics/CSV import, contract import, manual add, the
// cloud merge, and a cleanup pass over already-stored data):
//   * Identity: same date + same facility + same shift type/code —
//     facility compared by its canonical saved name (aliases resolve),
//     type compared case/space-insensitively — and, when BOTH records
//     carry a start time, the same start time. Same day but a different
//     facility or a different type is a DIFFERENT shift, untouched.
//   * On a match there is ONE record: the survivor keeps its id (ids
//     are the calendar_sync_map pairing key — sync never mints a new
//     id for an existing shift), and fields merge richest-first: a
//     priced copy beats an unpriced one, a status never downgrades
//     (completed > confirmed > proposed), and the record
//     remembers EVERY source it came from in `sources`.
//   * Source memory drives removal: when one source drops the shift
//     (e.g. the calendar sync reports it gone) only that source is
//     unlinked — the record stays while another source still shows
//     it. It is deleted only when its last source goes.
// Pay-stub estimated paychecks are not shifts and never enter here.
function shiftStatusRank(s){const v=normalizeShiftStatus(s);return v==='completed'?4:v==='confirmed'?3:v==='proposed'?1:0}
function shiftStartOf(x){return String((x&&(x.startTime||x.start))||'').trim()}
function shiftFacilityKeyOf(x){const raw=String((x&&x.facility)||'');let f=null;try{f=facilityByNameOrAlias(raw)}catch(e){}return normFacilityName(f?f.name:raw).replace(/\s+/g,' ')}
function shiftTypeKeyOf(x){return normalizeCodeKey(String((x&&x.type)||'').toLowerCase())}
// v115 (Nov 10, 2026): shift identity rebuilt after Caleb's phone
// doubled every November day. The two copies of one real shift —
// the phone's own and a cloud copy minted by another device's
// import — differ in exactly the fields the old identity compared:
// the TYPE WORDING ("8-hour day" on one, the clarified label
// "8hr day shift" on the other, or the raw code carried AS the
// type by older imports), the FACILITY TEXT ("Holzer" vs the
// feed's "HOLZ", sometimes pointing at two variant facility
// records), a bracketed assignee remnant in one stored code
// ("HOLZ - G Main (8) [Martin]"), and the stored start time. The
// new identity is date + TOLERANT facility + code/kind:
//  - facility: resolved keys equal, same resolved record, or the
//    two names are variants of one another (facilityNameVariantOf
//    — the pay-stub claiming resolver's rule);
//  - kind: when both copies carry a code, the codes must agree
//    (loose-normalized: brackets/assignee-insensitive, asterisks
//    preserved) or match the other copy's type text (code-as-type
//    copies); when either code is missing, the kind-key sets —
//    code, type text, and canonical type from each — must share
//    a key. Different real codes (G Main (8) vs (10), day vs
//    call) never share a key, so different shifts never merge.
// Start time no longer vetoes identity: a calendar copy's 06:30
// and a feed copy's all-day stamp are the same shift.
function shiftCodeKeyLoose(x){let s=normalizeCodeKey(String((x&&x.code)||'').toLowerCase());const m=s.match(/^(.*?)\s*\[[^\]]+\]\s*$/);if(m&&m[1].trim())s=m[1].trim();return s}
function shiftKindKeys(x){const out=new Set();const ck=shiftCodeKeyLoose(x);if(ck)out.add('x:'+ck);const tk=shiftTypeKeyOf(x);if(tk)out.add('x:'+tk);const canon=(()=>{try{return canonicalTypeOf(String((x&&x.code)||x&&x.type||''))||canonicalTypeOf(String((x&&x.type)||''))}catch(e){return ''}})();if(canon)out.add('k:'+canon.toLowerCase());return out}
function shiftFacilitiesMatch(a,b){
  if(shiftFacilityKeyOf(a)===shiftFacilityKeyOf(b))return true;
  let fa=null,fb=null;try{fa=facilityByNameOrAlias(String((a&&a.facility)||''));fb=facilityByNameOrAlias(String((b&&b.facility)||''))}catch(e){}
  if(fa&&fb&&fa.id&&fa.id===fb.id)return true;
  const names=new Set();
  const addN=v=>{const s=String(v||'').trim();if(s)names.add(s)};
  addN(a&&a.facility);addN(fa&&fa.name);addN(b&&b.facility);addN(fb&&fb.name);
  const arr=[...names];
  for(let i=0;i<arr.length;i++)for(let j=i+1;j<arr.length;j++){try{if(facilityNameVariantOf(arr[i],arr[j]))return true}catch(e){}}
  return false;
}
// Renamed-code identity (Nov 10, 2026, v116): two records are the
// same shift under different code NAMES only when everything else
// the app knows agrees — the canonical KIND matches (both records
// are the same sort of shift: an 8-hour day, a Second call, ...),
// neither code is a separately DEFINED code at the facility (two
// codes the user defined side by side in the facility's own rules
// are two different assignments, never one shift), and any pay
// both records state agrees. Anything less stays two shifts.
function shiftKindRenameMatch(a,b){
  const ka=shiftKindKeys(a),kb=shiftKindKeys(b);
  let sharedKind=false;for(const k of ka)if(k.startsWith('k:')&&kb.has(k)){sharedKind=true;break}
  if(!sharedKind)return false;
  let fac=null;try{fac=facilityByNameOrAlias(String((a&&a.facility)||''))||facilityByNameOrAlias(String((b&&b.facility)||''))}catch(e){}
  if(fac){
    const da=codeDefFor(fac,String((a&&a.code)||'')),dbb=codeDefFor(fac,String((b&&b.code)||''));
    if(da&&dbb&&da!==dbb)return false;
  }
  const pa=String((a&&a.pay)??'').trim(),pb=String((b&&b.pay)??'').trim();
  if(pa!==''&&pb!==''){const na=num(pa),nb=num(pb);if(isFinite(na)&&isFinite(nb)&&Math.abs(na-nb)>=0.005)return false}
  return true;
}
function shiftsSameShift(a,b){
  if(!a||!b)return false;
  const da=String(a.date||''),dbb=String(b.date||'');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(da)||da!==dbb)return false;
  if(!shiftFacilitiesMatch(a,b))return false;
  const ca=shiftCodeKeyLoose(a),cb=shiftCodeKeyLoose(b);
  if(ca&&cb){
    if(ca===cb)return true;
    // An older copy may carry the code AS its type while the newer
    // copy stores it in code with a label type (or vice versa).
    if(ca===shiftTypeKeyOf(b)||cb===shiftTypeKeyOf(a))return true;
    // The same shift under a RENAMED code (v116): feeds rename
    // their task codes over time — the QGenda parser eras are the
    // proven case ("Holzer 8" / "8/2nd call" in one era, the raw
    // "HOLZ - G Main (8)" / "HOLZ - Call 2" in the next). Two
    // records whose codes merely differ used to be declared
    // different shifts outright, so a second generation of the
    // same schedule survived every dedupe and doubled the totals.
    if(shiftKindRenameMatch(a,b))return true;
    return false;
  }
  const ka=shiftKindKeys(a),kb=shiftKindKeys(b);
  for(const k of ka)if(kb.has(k))return true;
  return false;
}
function findSameShift(rec,list){return (list||[]).find(y=>y&&y!==rec&&shiftsSameShift(y,rec))||null}
function shiftSourcesList(x){const out=[];const add=v=>{const s=String(v||'').trim();if(s&&!out.includes(s))out.push(s)};if(x){if(Array.isArray(x.sources))x.sources.forEach(add);add(x.source)}return out}
// The live calendar a shift was imported from, when that source is a
// synced calendar whose paired source event the app can actually
// remove: today only the Apple import source pairs shifts with source
// events (calendar_import_map, keyed by the 'apple-import' source
// tag). .ics file imports ('calendar-*'), QGenda, contracts, schedule
// uploads and manual entries have no live source event, so they get
// no delete-from-calendar choice; Google/Outlook connections sync
// only the app-owned calendar and have no import source at all. For
// a multi-source shift (dedupe keeps a sources list), only the
// calendar source counts — the delete-time choice targets that
// calendar's event and nothing else.
function shiftLiveCalendarSource(x){
  if(!x)return null;
  if(!shiftSourcesList(x).includes('apple-import'))return null;
  let name='';
  try{const c=(typeof liveSyncConnections!=='undefined'&&liveSyncConnections)?liveSyncConnections.apple:null;if(c&&c.sourceCalendarName)name=String(c.sourceCalendarName).trim()}catch(e){}
  if(!name){const m=String(x.note||'').match(/Imported from (.+?)\s*$/);if(m)name=m[1].trim()}
  return {provider:'apple',calendarName:name||'your work calendar'};
}
function shiftIsPricedRaw(x){return !!x&&String(x.pay??'').trim()!==''&&!x.incomplete&&num(x.pay)>0}
function mergeShiftInto(keep,inc){
  if(!keep||!inc||keep===inc)return keep;
  const sources=shiftSourcesList(keep);shiftSourcesList(inc).forEach(s=>{if(!sources.includes(s))sources.push(s)});
  if(sources.length)keep.sources=sources;
  if(!String(keep.source||'').trim()&&inc.source)keep.source=inc.source;
  if(!shiftIsPricedRaw(keep)&&shiftIsPricedRaw(inc)){keep.pay=String(inc.pay);keep.incomplete=false}
  else if(!shiftIsPricedRaw(keep)&&String(keep.pay??'').trim()===''&&String(inc.pay??'').trim()!==''){keep.pay=String(inc.pay);if(inc.incomplete!==undefined)keep.incomplete=!!inc.incomplete}
  // Newest edit wins (Nov 7, 2026): when the surviving record carries a
  // STRICTLY NEWER manual-edit stamp than the incoming copy, the
  // incoming copy is the pre-edit version being re-offered by a sync —
  // it must not silently raise the status (or, per the callers' use, resurrect any edited field).
  const keepNewer=!!(String(keep.updatedAt||'')&&String(inc.updatedAt||'')&&String(keep.updatedAt)>String(inc.updatedAt));
  if(!keepNewer&&shiftStatusRank(inc.status)>shiftStatusRank(keep.status))keep.status=normalizeShiftStatus(inc.status);
  let kf=null,inf=null;try{kf=facilityByNameOrAlias(keep.facility);inf=facilityByNameOrAlias(inc.facility)}catch(e){}
  if(String(inc.facility||'').trim()&&(!String(keep.facility||'').trim()||(!kf&&inf)))keep.facility=String(inc.facility).trim();
  if(!String(keep.type||'').trim()&&inc.type)keep.type=inc.type;
  if(!String(keep.note||'').trim()&&inc.note)keep.note=inc.note;
  if(!keep.contractId&&inc.contractId)keep.contractId=inc.contractId;
  if(!String(keep.code||'').trim()&&String(inc.code||'').trim())keep.code=String(inc.code).trim();
  if(!shiftStartOf(keep)&&shiftStartOf(inc)){if(inc.startTime)keep.startTime=inc.startTime;else if(inc.start)keep.start=inc.start}
  const kt=String(keep.updatedAt||''),it=String(inc.updatedAt||'');
  if(it&&(!kt||it>kt))keep.updatedAt=inc.updatedAt;
  if(shiftIsPricedRaw(keep))keep.incomplete=false;
  else if(keep.incomplete===undefined)keep.incomplete=!String(keep.pay??'').trim();
  return keep;
}
function shiftBaseScore(x){const srcs=shiftSourcesList(x);let s=shiftStatusRank(x&&x.status);if(srcs.some(v=>v.startsWith('calendar-')||v==='apple-import'||v==='google-import'||v==='outlook-import'))s+=8;if(shiftIsPricedRaw(x))s+=4;return s}
function addShiftDeduped(rec){
  db.shifts=Array.isArray(db.shifts)?db.shifts:[];
  if(!Array.isArray(rec.sources))rec.sources=shiftSourcesList(rec);
  const ex=findSameShift(rec,db.shifts);
  if(ex){mergeShiftInto(ex,rec);return {shift:ex,merged:true}}
  db.shifts.push(rec);return {shift:rec,merged:false};
}
// Collapse identity duplicates already sitting in db.shifts into one
// record each. onAbsorb(absorbedId, survivorId) fires per collapsed
// record (the cloud merge uses it to tombstone the absorbed cloud id
// so the duplicate cannot resurrect on the next sync).
function dedupeShiftsInPlace(onAbsorb){
  const list=Array.isArray(db.shifts)?db.shifts:[];
  if(list.length<2)return {collapsed:0,absorbedIds:[]};
  const survivors=[],absorbedIds=[];
  for(const rec of list){
    if(!rec||!rec.id){survivors.push(rec);continue}
    const idx=survivors.findIndex(s=>s&&s.id&&shiftsSameShift(s,rec));
    if(idx===-1){survivors.push(rec);continue}
    let base=survivors[idx],other=rec;
    if(shiftBaseScore(rec)>shiftBaseScore(survivors[idx])){base=rec;other=survivors[idx];survivors[idx]=rec}
    mergeShiftInto(base,other);
    absorbedIds.push(other.id);
    if(typeof onAbsorb==='function')onAbsorb(other.id,base.id);
  }
  if(absorbedIds.length)db.shifts=survivors;
  return {collapsed:absorbedIds.length,absorbedIds};
}
// Variant-shell facility fold (Nov 10, 2026, v116): an import era
// can leave a second, EMPTY facility record whose name is only a
// variant of the real one (the feed-era "Holzer" beside the saved
// "HOLZ") — it holds no rates, no code definitions, no address, and
// exists only because an approve on another device created it
// before the names were linked. Such a shell folds into the ONE
// ruled facility it variants: the shell's name becomes an alias of
// the real facility (so its shifts keep resolving), shifts still
// naming the shell are re-pointed at the real name, and the shell
// record goes away. A facility with any rates, definitions or an
// address is a real record and is NEVER folded; a shell with zero
// or several ruled variant twins is left alone. onFold(shellId,
// twin) fires per fold so the cloud merge can tombstone the shell.
function facilityIsShell(f){
  if(!f)return false;
  const money=['hourlyRate','paidHours8','rate8','rate10','rate12','rate24','weekendRate24','rateSecond','weekendRateSecond','hourlyCall1st','callBonus'];
  if(money.some(k=>rateOrNull(f[k])!=null))return false;
  if(Object.keys(facilityCodeDefs(f)).length)return false;
  if(String(f.address||'').trim())return false;
  if(String(f.notes||'').trim())return false;
  return true;
}
function healVariantFacilityRecords(onFold){
  let folded=0;
  for(const shell of [...(db.facilities||[])]){
    if(!shell||!facilityIsShell(shell))continue;
    const twins=(db.facilities||[]).filter(g=>g&&g!==shell&&facilityHasPayRules(g)&&(facilityNameKey(g.name)===facilityNameKey(shell.name)||facilityNameVariantOf(g.name,shell.name)));
    if(twins.length!==1)continue;
    const twin=twins[0];
    for(const x of (db.shifts||[])){
      if(x&&String(x.facility||'').trim()&&facilityNameKey(x.facility)===facilityNameKey(shell.name))x.facility=twin.name;
    }
    addFacilityAlias(twin,shell.name);
    db.facilities=(db.facilities||[]).filter(g=>g!==shell);
    folded++;
    if(typeof onFold==='function')onFold(shell.id,twin);
  }
  return folded;
}
// Post-materialization heal (Nov 10, 2026, v116): the dedupe pass
// used to run only at script load and inside the cloud merge, so a
// duplicate pair landing MID-SESSION (a calendar sync applying
// after the merge, a cloud download racing the boot check) survived
// until the next full reload while the totals read doubled. Every
// path that can materialize shifts now ends with this one pass —
// identity dedupe, day+call pair heal, variant-shell fold.
// Idempotent and cheap on clean data; safe to run often.
function healShiftsAfterChange(onAbsorb,onFold){
  let changed=false;
  try{const d=dedupeShiftsInPlace(onAbsorb);if(d&&d.collapsed)changed=true}catch(e){}
  try{const p=healDayCallShiftPairs(onAbsorb);if(p&&p.merged)changed=true}catch(e){}
  try{if(healVariantFacilityRecords(onFold))changed=true}catch(e){}
  if(changed)persist();
  return changed;
}
// --- Double-booking guard (v115, Nov 10, 2026) ---
// Caleb's ask, verbatim intent: "There needs to be a hard stop or
// a message that comes up to the user 'looks like you are double
// booking yourself'." Every door shifts enter (import previews,
// calendar .ics, contracts, CSV, manual add) classifies each
// incoming record against ALL saved shifts — any facility, any
// source — plus the records already accepted from the same batch:
//  - EXACT duplicate (v115 identity): never added; counted as
//    already-on-your-calendar (the add path merges its sources
//    into the existing record — never a second shift).
//  - CONFLICT: a different shift on a date that already has one —
//    above all a SECOND hospital's schedule landing on the first
//    hospital's days. The approve STOPS, the preview shows the
//    warning below naming both sides, and nothing conflicting is
//    added unless the user ticks that conflict's "Add it anyway".
//  - NOT a conflict: a day shift + a call at the SAME facility —
//    the December combining rule treats them as one assignment.
let pendingManualShift=null;
function shiftGuardKindOf(x){
  let canon='';try{canon=canonicalTypeOf(String((x&&x.type)||''))||canonicalTypeOf(String((x&&x.code)||''))}catch(e){}
  if(canon==='24-hour call'||canon==='Second call')return 'call';
  if(canon)return 'day';
  if(String((x&&x.code)||'').trim())return 'day';
  return '';
}
function shiftsCombinablePair(a,b){
  const ka=shiftGuardKindOf(a),kb=shiftGuardKindOf(b);
  if(!ka||!kb||ka===kb)return false;
  return shiftFacilitiesMatch(a,b);
}
function shiftConflictCandidate(rec,pool){
  for(const x of (pool||[])){
    if(!x||x===rec)continue;
    if(String(x.date||'')!==String(rec.date||''))continue;
    // A facility-less side cannot be judged: grid uploads print no
    // facility, and a row that names no hospital is never evidence
    // of a second hospital booking the same day.
    if(!String(rec.facility||'').trim()||!String(x.facility||'').trim())continue;
    const st=normalizeShiftStatus(x.status);
    if(st==='rejected'||st==='canceled')continue;
    if(shiftsSameShift(x,rec))continue;
    if(shiftsCombinablePair(x,rec))continue;
    return x;
  }
  return null;
}
function importConflictKey(rec){return [String(rec.date||''),shiftFacilityKeyOf(rec),shiftCodeKeyLoose(rec)||shiftTypeKeyOf(rec)].join('|')}
function conflictSideLabel(x,incoming){
  const code=String((x&&x.code)||'').trim(),type=String((x&&x.type)||'').trim();
  if(incoming)return (String((x&&x.facility)||'').trim()+' '+(code||type)).trim();
  return code||type;
}
function conflictTextFor(rec,against){
  const d=new Date(String(rec.date||'')+'T12:00:00').toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'});
  return `${d} — ${conflictSideLabel(rec,true)} vs ${conflictSideLabel(against,false)} already on your calendar`;
}
function classifyImportRecords(records){
  const dups=[],conflicts=[],clean=[],accepted=[];
  const saved=Array.isArray(db.shifts)?db.shifts:[];
  for(const rec of (records||[])){
    if(!rec)continue;
    if(findSameShift(rec,saved)||findSameShift(rec,accepted)){dups.push(rec);continue}
    const against=shiftConflictCandidate(rec,saved)||shiftConflictCandidate(rec,accepted);
    if(against){conflicts.push({rec,against,key:importConflictKey(rec),date:String(rec.date||''),text:conflictTextFor(rec,against)});continue}
    clean.push(rec);accepted.push(rec);
  }
  return {dups,conflicts,clean};
}
// Drives one preview's approve: returns the classification. When
// conflicts exist and the warning has not been shown yet, the
// classification carries stopped:true and the caller must return
// without adding anything (the preview stays up with the warning
// rendered). On the next approve, per-conflict overrides the user
// ticked decide: addAnyway records are added, the rest are left
// out and counted in skippedConflicts.
function importGateCheck(preview,records){
  const cls=classifyImportRecords(records);
  if(!cls.conflicts.length)return cls;
  if(preview&&preview.conflictGateShown){
    const over=preview.conflictOverrides||{};
    cls.addAnyway=cls.conflicts.filter(c=>over[c.key]);
    cls.skippedConflicts=cls.conflicts.filter(c=>!over[c.key]);
    return cls;
  }
  if(preview){preview.pendingConflicts=cls.conflicts.map(c=>({key:c.key,date:c.date,text:c.text}));preview.conflictGateShown=true}
  cls.stopped=true;
  return cls;
}
const DOUBLE_BOOKING_HEADING='Looks like you\u2019re double-booking yourself';
function importConflictsHTML(preview,kind){
  if(!preview||!Array.isArray(preview.pendingConflicts)||!preview.pendingConflicts.length)return '';
  const over=preview.conflictOverrides||{};
  return `<div class="conflict-warning" style="border:2px solid #b45309;border-radius:10px;padding:12px;margin:12px 0"><h3 style="margin-top:0">${DOUBLE_BOOKING_HEADING}</h3><p class="muted">These shifts land on days that already have a shift. They won't be added unless you tick "Add it anyway" for them — then press Approve again. Everything else in this preview imports as usual.</p>${preview.pendingConflicts.map(c=>`<div class="item"><div>${escapeHTML(c.text)}</div><label class="muted"><input type="checkbox" class="importConflictOverride" data-kind="${escapeHTML(kind)}" data-key="${escapeHTML(c.key)}" ${over[c.key]?'checked':''}> Add it anyway — I really have both</label></div>`).join('')}</div>`;
}
function gateStopAlert(){
  alert(DOUBLE_BOOKING_HEADING+' — a few of these shifts land on days that already have a shift, so nothing was added yet. The preview lists each clash: tick "Add it anyway — I really have both" for any that are real, then press Approve again. The rest import as usual.');
}
// --- Cross-hospital day alerts (Nov 10, 2026, v116) ---
// The v115 guard stops conflicting imports at the door, but a
// clash can also LAND through a door with no preview to stop at:
// a cloud download from another device, a backup restore, a sync
// that applied while the day was still empty on this device.
// Whenever two shifts from DIFFERENT hospitals sit on the same
// day, the Dashboard says so — prominently, naming the date and
// both shifts — and the calendar flags the day, until the user
// dismisses it or the clash goes away on its own (deleting or
// editing one side clears it: the list is computed live from the
// saved shifts on every render, so it can never go stale or
// repeat itself). Never flagged: same-facility pairs (a day shift
// plus call at one hospital is one assignment) and exact
// duplicates (identity merges those silently before this runs).
function conflictSideShort(x){
  const fac=String((x&&x.facility)||'').trim(),code=String((x&&x.code)||'').trim(),type=String((x&&x.type)||'').trim();
  if(code){if(fac&&normFacilityName(code).startsWith(normFacilityName(fac)))return code;return (fac?fac+' '+code:code)}
  return (fac+' '+type).trim();
}
function conflictPairSignature(date,a,b){
  const side=x=>[shiftFacilityKeyOf(x),shiftCodeKeyLoose(x)||shiftTypeKeyOf(x)].join('/');
  return [String(date||''),...[side(a),side(b)].sort()].join('|');
}
function crossFacilityDayConflicts(){
  const byDate=new Map();
  for(const x of (db.shifts||[])){
    if(!x||!psValidISO(x.date)||!String(x.facility||'').trim())continue;
    const st=normalizeShiftStatus(x.status);if(st==='rejected'||st==='canceled')continue;
    if(!byDate.has(x.date))byDate.set(x.date,[]);
    byDate.get(x.date).push(x);
  }
  const out=[];
  for(const [date,list] of byDate){
    let pair=null;
    for(let i=0;i<list.length&&!pair;i++)for(let j=i+1;j<list.length;j++){if(!shiftFacilitiesMatch(list[i],list[j])){pair=[list[i],list[j]];break}}
    if(pair)out.push({date,a:pair[0],b:pair[1],signature:conflictPairSignature(date,pair[0],pair[1])});
  }
  return out.sort((x,y)=>x.date.localeCompare(y.date));
}
function activeDayConflicts(){
  const dis=(db.settings&&db.settings.conflictAlertsDismissed)||{};
  const bySig=new Map();
  for(const c of crossFacilityDayConflicts())bySig.set(c.signature,c);
  // Held sync clashes (below) alert through the same banner while
  // their saved side is still on the calendar.
  const held=(db.settings&&db.settings.heldDayConflicts)||{};
  for(const sig of Object.keys(held)){
    if(bySig.has(sig))continue;
    const h=held[sig];if(!h||!h.date||!h.a||!h.b)continue;
    const savedSide=(db.shifts||[]).some(x=>x&&x.date===h.date&&shiftFacilityKeyOf(x)===shiftFacilityKeyOf(h.b)&&(shiftCodeKeyLoose(x)||shiftTypeKeyOf(x))===(shiftCodeKeyLoose(h.b)||shiftTypeKeyOf(h.b)));
    if(!savedSide)continue;
    bySig.set(sig,{date:h.date,a:h.a,b:h.b,signature:sig,held:true});
  }
  return [...bySig.values()].filter(c=>!dis[c.signature]).sort((x,y)=>x.date.localeCompare(y.date));
}
// A calendar sync that meets a cross-hospital clash HOLDS the
// incoming shift out (v115 guard) — but the user is still booked
// at two hospitals that day in the real world, so the clash is
// remembered here and the banner above alerts on it until it is
// dismissed or the saved side goes away. Same-facility holds are
// not recorded: those are one hospital's own double-stacking,
// already named in the sync result.
function recordHeldDayConflict(incoming,against){
  if(!incoming||!against)return;
  let cross=true;try{cross=!shiftFacilitiesMatch(incoming,against)}catch(e){}
  if(!cross)return;
  const sig=conflictPairSignature(incoming.date,incoming,against);
  db.settings=db.settings||{};
  const held={...(db.settings.heldDayConflicts||{})};
  if(held[sig])return;
  const side=x=>({facility:String(x.facility||''),code:String(x.code||''),type:String(x.type||'')});
  held[sig]={date:String(incoming.date||''),a:side(incoming),b:side(against)};
  db.settings.heldDayConflicts=held;persist();
}
function dismissDayConflict(signature){
  if(!signature)return;
  db.settings=db.settings||{};
  const dis={...(db.settings.conflictAlertsDismissed||{})};
  if(dis[signature])return;
  dis[signature]=true;db.settings.conflictAlertsDismissed=dis;persist();
}
// A clash the user JUST chose at an import door ("Add it anyway —
// I really have both") was decided with the warning in front of
// them; the banner does not re-ask about that same pair.
function acknowledgeImportConflicts(gate){
  for(const c of ((gate&&gate.addAnyway)||[])){
    if(c&&c.rec&&c.against)dismissDayConflict(conflictPairSignature(c.rec.date,c.rec,c.against));
  }
}
// Price wording for one banner shift line — the same convention
// the day sheet uses for the same shift: its priced amount, or
// "not priced yet" while no rule has priced it.
function conflictShiftPriceLabel(x){
  if(!x||x.pay===''||x.pay==null||x.incomplete)return 'not priced yet';
  return currency(x.pay);
}
// One saved shift's own line inside a conflict banner (Nov 10,
// 2026, v117 — Caleb: "show the shifts and give the option to
// delete one or the other right from that notification"). The
// delete button is the shared delete flow's own trigger — the
// day sheet's data-action="delete-shifts" — so the banner gets
// the identical confirmation sheet, the remembered
// remove-from-my-calendar choice, the tombstones and the live
// reprice for free (one component, never a second delete path).
// Deleting one side resolves the pair on the next render: the
// conflict list is computed live, so the banner and the
// calendar's ⚠ flag clear themselves.
function conflictBannerSavedLineHTML(x){
  if(!x)return '';
  const del=x.id?`<button type="button" class="tiny danger" data-action="delete-shifts" data-id="${escapeHTML(x.id)}">Delete this shift</button>`:'';
  return `<div class="item" style="margin-top:8px"><div>${escapeHTML(conflictSideShort(x))} · ${escapeHTML(conflictShiftPriceLabel(x))}</div><div class="item-actions">${del}</div></div>`;
}
// A held conflict stores only a plain side summary of its saved
// side, not the shift record — find the record itself (the same
// match activeDayConflicts uses to know the clash is still real)
// so its banner line can show the real price and carry the
// delete button.
function heldConflictSavedShift(c){
  if(!c||!c.held||!c.b)return null;
  return (db.shifts||[]).find(x=>x&&x.date===c.date&&shiftFacilityKeyOf(x)===shiftFacilityKeyOf(c.b)&&(shiftCodeKeyLoose(x)||shiftTypeKeyOf(x))===(shiftCodeKeyLoose(c.b)||shiftTypeKeyOf(c.b)))||null;
}
function dashboardConflictAlertsHTML(){
  const list=activeDayConflicts();if(!list.length)return '';
  return list.map(c=>{
    const d=new Date(c.date+'T12:00:00').toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'});
    let lines;
    if(c.held){
      // Only the saved side (c.b) is a real shift: it gets the
      // delete line. The incoming side (c.a) was held OUT by the
      // sync guard — labeled as held out, dismissed with
      // "Keep it out", and never offered a delete (it isn't
      // saved). Deleting the saved side clears the banner too:
      // nothing is left to conflict.
      const heldLine=`<div class="item" style="margin-top:8px"><div>${escapeHTML(conflictSideShort(c.a))} · held out — not on your calendar</div><div class="item-actions"><button type="button" class="tiny secondary" data-action="conflict-held-keep-out" data-id="${escapeHTML(c.signature)}">Keep it out</button></div></div>`;
      lines=conflictBannerSavedLineHTML(heldConflictSavedShift(c))+heldLine;
    }else{
      lines=conflictBannerSavedLineHTML(c.a)+conflictBannerSavedLineHTML(c.b);
    }
    return `<section class="panel conflict-day-alert" style="border:2px solid #b45309"><p style="margin:0"><strong>Heads up — you’re booked at two hospitals on ${escapeHTML(d)}: ${escapeHTML(conflictSideShort(c.a))} and ${escapeHTML(conflictSideShort(c.b))}.</strong></p>${lines}<div class="toolbar" style="margin-top:8px"><button type="button" class="secondary" data-action="conflict-alert-dismiss" data-id="${escapeHTML(c.signature)}">Got it — leave both</button></div></section>`;
  }).join('');
}
// Saved day+call pairs (Nov 9, 2026, December round): imports
// approved before the combining rule could store a day shift AND
// a call shift for the same facility on the same date — one
// assignment as two records, pricing the day twice in every
// total. Absorb the day record into the call record: sources
// merge (the dedupe survivor rules), the call keeps its own
// price, and a call that had no price of its own is priced from
// the facility rule. Manual entries are the correction layer
// (source-priority ladder) and are never merged away; neither are
// rejected/canceled records. onAbsorb(absorbedId, survivorId)
// fires per absorbed record so the cloud merge can tombstone it.
function healDayCallShiftPairs(onAbsorb){
  const list=Array.isArray(db.shifts)?db.shifts:[];
  if(list.length<2)return {merged:0};
  const manual=x=>{const s=shiftSourcesList(x);return s.length>0&&s.every(v=>v==='user-entered')};
  const kind=x=>{
    if(!x)return '';
    const ct=canonicalTypeOf(x.type)||canonicalTypeOf(x.code);
    if(ct==='Second call'||ct==='24-hour call')return 'call';
    if(ct)return 'day';
    return /\(\d{1,2}\)\s*$/.test(String(x.code||''))?'day':'';
  };
  const dead=x=>{const st=normalizeShiftStatus(x.status);return st==='rejected'||st==='canceled'};
  const groups=new Map();
  for(const x of list){
    if(!x||!x.id||!psValidISO(x.date))continue;
    const k=x.date+'|'+shiftFacilityKeyOf(x);
    if(!groups.has(k))groups.set(k,[]);
    groups.get(k).push(x);
  }
  const absorbedIds=new Set();
  let merged=0;
  for(const g of groups.values()){
    if(g.length<2)continue;
    const calls=g.filter(x=>kind(x)==='call'&&!manual(x)&&!dead(x));
    const days=g.filter(x=>kind(x)==='day'&&!manual(x)&&!dead(x));
    if(!calls.length||!days.length)continue;
    const host=calls[0];
    for(const d of days){
      if(d===host||absorbedIds.has(d.id))continue;
      const hostWasPriced=shiftIsPricedRaw(host);
      mergeShiftInto(host,d);
      if(!hostWasPriced){
        const f=facilityByNameOrAlias(host.facility);
        if(f){
          const cp=clarifiedRowPricing(f,host);
          if(cp&&cp.pay){host.pay=cp.pay;host.payRate=cp.payRate;host.payUnit=cp.payUnit;host.incomplete=false}
          else{const p=facilityPayFor(f,host.type,host.date);if(p>0){host.pay=String(Math.round(p*100)/100);host.payRate='';host.payUnit='facility';host.incomplete=false}}
        }
      }
      host.updatedAt=new Date().toISOString();
      absorbedIds.add(d.id);merged++;
      if(typeof onAbsorb==='function')onAbsorb(d.id,host.id);
    }
  }
  if(absorbedIds.size)db.shifts=list.filter(x=>!absorbedIds.has(x.id));
  return {merged};
}
// Split one calendar year's billable shifts at today into two totals:
//   C = confirmed only (confirmed + completed — completed is confirmed
//       work already done),
//   P = proposed-inclusive (C + proposed — possible income, not
//       confirmed).
// Each total has a year-to-date part (dated today or earlier) and a
// predicted-annual part (YTD + still scheduled). Rejected and canceled
// shifts count in no total. Unpriced and W-2 salary shifts are excluded
// from both totals and counted separately. Deterministic: plain sums
// over the stored shifts, no model arithmetic. The legacy
// ytd/futureGross/predicted fields stay mapped to P (proposed-
// inclusive), the single combined total this function used to return,
// so existing callers keep working.
function yearIncomeSplit(y,todayStr){const today=todayStr||localDate(new Date());const shifts=shiftsForYear(y);const priced=shifts.filter(isBillableShift);const unpriced=shifts.filter(x=>!isPricedShift(x)&&!isW2SalaryShift(x));const w2=shifts.filter(isW2SalaryShift);const bucket=statuses=>{const inB=priced.filter(x=>statuses.includes(normalizeShiftStatus(x.status)));const past=inB.filter(x=>String(x.date||'')<=today);const future=inB.filter(x=>String(x.date||'')>today);const ytd=past.reduce((a,x)=>a+num(x.pay),0);const fut=future.reduce((a,x)=>a+num(x.pay),0);return {ytd:ytd,future:fut,predicted:ytd+fut,pastCount:past.length,futureCount:future.length,count:inB.length}};const c=bucket(['confirmed','completed']);const p=bucket(['confirmed','completed','proposed']);return {c:c,p:p,ytd:p.ytd,futureGross:p.future,predicted:p.predicted,futureCount:p.futureCount,pastCount:p.pastCount,unpriced:unpriced.length,unpricedFuture:unpriced.filter(x=>String(x.date||'')>today).length,w2Salary:w2.length,w2SalaryPriced:w2.filter(isPricedShift).length,proposedFuture:priced.filter(x=>String(x.date||'')>today&&normalizeShiftStatus(x.status)==='proposed').length,byStatus:{proposed:countByStatus(priced,['proposed']),confirmed:countByStatus(priced,['confirmed']),completed:countByStatus(priced,['completed']),rejected:countByStatus(priced,['rejected']),canceled:countByStatus(priced,['canceled'])},total:shifts.length}}
// Same C/P split for one calendar month (prefix 'YYYY-MM'), whole month
// (no past/future split — the month is the unit the income goal tracks).
function monthIncomeSplit(prefix){const shifts=(db.shifts||[]).filter(x=>String(x.date||'').startsWith(prefix));const priced=shifts.filter(isBillableShift);return {c:sumByStatus(priced,['confirmed','completed']),p:sumByStatus(priced,['confirmed','completed','proposed']),byStatus:{proposed:countByStatus(priced,['proposed']),confirmed:countByStatus(priced,['confirmed']),completed:countByStatus(priced,['completed'])},unpriced:shifts.filter(x=>!isPricedShift(x)&&!isW2SalaryShift(x)).length,w2Salary:shifts.filter(isW2SalaryShift).length,total:shifts.length}}
// Per-facility year-to-date income for the My facilities cards (Nov 8,
// 2026). Same semantics as yearIncomeSplit's P (proposed-inclusive)
// YTD bucket, narrowed to one facility: this year's shifts dated
// today or earlier, billable only (isBillableShift — priced, not
// incomplete, not Off/PTO, 1099 employment), statuses confirmed /
// completed / proposed. Worked basis only — pay-stub actuals are
// per-agency paycheck figures and are never attributed to a facility.
// Attribution goes through facilityForRecord (facilityId first, then
// the tolerant name/alias matcher), so a shift recorded as "Holzer"
// counts toward the fuller-named Holzer facility record. Derived live
// from db.shifts on every render — nothing new is stored.
function facilityYearToDate(f,todayStr){if(!f)return 0;const today=todayStr||localDate(new Date());const prefix=String(currentYear())+'-';let total=0;for(const x of (db.shifts||[])){const d=String(x.date||'');if(!d.startsWith(prefix)||d>today)continue;if(!isBillableShift(x))continue;if(!['confirmed','completed','proposed'].includes(normalizeShiftStatus(x.status)))continue;let m=null;try{m=facilityForRecord(x)}catch(e){}if(m&&m.id===f.id)total+=num(x.pay)}return total}
// --- Pay stubs: one pay schedule per agency / employer (Nov 5, 2026;
// paycheck engine rebuilt Nov 6, 2026 on Caleb's rule) ---
// One stub per agency: the user uploads a pay stub (photo or PDF, or
// pastes its text) and the app reads the pay frequency, pay period,
// pay date, and gross/net — AI vision first (extract-contract mode
// 'paystub', same server function and key as contracts), deterministic
// text parsing for pasted text / text-layer PDFs. NOTHING is saved until
// the user checks the preview and approves it; the stub photo/PDF itself
// is never stored — the extracted schedule is what is saved, and, since
// migration 010, pay-stub schedules sync to the user's account with the
// rest of their records (pay_stubs table). A stub is optional:
// facilities and contracts work without one.
// WHAT A STUB MEANS (Caleb, Nov 6, 2026): the stub is a calendar of
// paydays, not an amount template. It contributes ONLY the pay
// frequency, the pay-period pattern, and the lag from period end to
// payday (his Premier cycle: two-week Mon–Sun periods, paid the Tuesday
// 9 days after the period ends — the stub's own period Oct 19 – Nov 1,
// 2026 demonstrates it, paid Nov 10). Its gross/net is NEVER projected
// forward: every paycheck after the stub's own is CALCULATED from the
// user's actual shifts inside that pay period (calendar sync, QGenda,
// schedule uploads), priced by the same income engine as the C/P
// totals — and a paycheck counts ALL of the period's shifts, confirmed
// and proposed alike (status is a forecast split, not a pay split), so
// a paycheck can never disagree with the period's shift sum. The ONE exception is the stub's own check: that payday shows
// the stub's amount as the ACTUAL for its period (reconciliation — see
// paystubReconciliations), because the stub is the real record of what
// was paid for that period. The actual influences nothing beyond its
// own period — no forward rule is ever built from it.
// Each agency gets its own schedule — never merged into one combined
// paycheck. Two agencies paying on the same date show as two separate
// entries, each labelled with its agency. Re-uploading a stub for an
// agency replaces only that agency's schedule; deleting a stub removes
// only that agency's paychecks. Generated paychecks are labelled
// estimates (or "actual" for a stub's own check) on the calendar and in
// the list, with the paystub disclaimer — paychecks themselves are
// never added into the C/P shift-income totals as separate items, so the same pay is never
// counted twice (the Dashboard YTD figures reconcile stubbed periods
// at the presentation layer instead: stub actual in, the period's
// shift sum out — see reconciledYearSplit). Paychecks appear on the
// in-app Dashboard calendar only; they are NOT pushed to Google /
// Apple / Outlook — estimates do not belong in the user's real
// calendar unasked.
const PAY_FREQUENCIES=['weekly','biweekly','semi-monthly','monthly'];
const PAY_FREQUENCY_LABELS={weekly:'Weekly',biweekly:'Every 2 weeks','semi-monthly':'Twice a month (semi-monthly)',monthly:'Monthly'};
const PAYSTUB_DISCLAIMER='Paycheck amounts are calculated from your shifts for each pay period; a pay stub sets the pay dates and, for its own check, the actual amount. Always double-check them against your actual paystubs. CRNA Hub is not liable for mistakes.';
function normalizePayFrequency(v){const t=String(v||'').trim().toLowerCase().replace(/_/g,' ').replace(/\s+/g,' ');if(t==='weekly')return 'weekly';if(t==='biweekly'||t==='bi-weekly'||t==='bi weekly'||t==='every 2 weeks'||t==='every two weeks'||t==='fortnightly')return 'biweekly';if(t==='semi-monthly'||t==='semi monthly'||t==='semimonthly'||t==='semi-monthly' ||t==='twice a month'||t==='twice-monthly'||t==='twice monthly'||t==='2x per month')return 'semi-monthly';if(t==='monthly')return 'monthly';return ''}
function psValidISO(s){const v=String(s||'').trim();if(!/^\d{4}-\d{2}-\d{2}$/.test(v))return '';const d=new Date(v+'T12:00:00');return Number.isNaN(d.getTime())?'':v}
function psAddDays(iso,n){const d=new Date(iso+'T12:00:00');d.setDate(d.getDate()+n);return localDate(d)}
function psDaysInMonth(y,m){return new Date(y,m,0).getDate()}
function psAddMonths(iso,n,anchorDay){const y=+iso.slice(0,4),m=+iso.slice(5,7);const total=(y*12+(m-1))+n;const ty=Math.floor(total/12),tm=total%12+1;const day=Math.min(anchorDay||+iso.slice(8,10),psDaysInMonth(ty,tm));return ty+'-'+String(tm).padStart(2,'0')+'-'+String(day).padStart(2,'0')}
// Semi-monthly paydays are two fixed days of the month, anchored on the
// stub's own pay date: the 7th and 22nd, the 5th and 20th, the 1st and
// 16th, and so on. The second day is the anchor + 15 days when the
// anchor is in the first half of the month, else the anchor - 15 days.
function paystubSemiMonthlyDays(anchorDay){const a=anchorDay||1;return a<=15?[a,a+15]:[a-15,a]}
function paystubSemiMonthlyNext(iso,anchorDay){const days=paystubSemiMonthlyDays(anchorDay);for(let step=0;step<3;step++){const base=new Date(iso.slice(0,4)+'-'+iso.slice(5,7)+'-01T12:00:00');base.setMonth(base.getMonth()+step);const y=base.getFullYear(),m=base.getMonth()+1,dim=psDaysInMonth(y,m);for(const ad of days){const day=Math.min(ad,dim);const cand=y+'-'+String(m).padStart(2,'0')+'-'+String(day).padStart(2,'0');if(cand>iso)return cand}}return ''}
function paystubStepDate(iso,freq,anchorDay){const f=normalizePayFrequency(freq);if(f==='weekly')return psAddDays(iso,7);if(f==='biweekly')return psAddDays(iso,14);if(f==='monthly')return psAddMonths(iso,1,anchorDay);if(f==='semi-monthly')return paystubSemiMonthlyNext(iso,anchorDay||+iso.slice(8,10));return ''}
function paystubFrequencyFromPeriod(start,end){const s=psValidISO(start),e=psValidISO(end);if(!s||!e)return '';const days=Math.round((new Date(e+'T12:00:00')-new Date(s+'T12:00:00'))/864e5)+1;if(days===7)return 'weekly';if(days===14)return 'biweekly';if(days===15||days===16)return 'semi-monthly';if(days>=28&&days<=31)return 'monthly';return ''}
// Next expected pay date: the stub's pay date stepped forward by its
// frequency until it is today or later. A pay date of today IS the next
// payday. Guarded: bad data can never loop forever.
function paystubNextPayDate(stub,todayStr){if(!stub||!stub.payDate||!normalizePayFrequency(stub.frequency))return '';const today=todayStr||localDate(new Date());let d=psValidISO(stub.payDate);if(!d)return '';let guard=0;while(d<today&&guard++<400){const n=paystubStepDate(d,stub.frequency,+stub.payDate.slice(8,10));if(!n||n<=d)return '';d=n}return d}
// The next paydays that will actually PAY (Nov 11, 2026, v124):
// read off the occurrence engine instead of the bare cadence, so a
// projected payday is listed only when its period holds shifts for
// this schedule (or the check is an actual). The bare cadence
// (paystubNextPayDate above) still describes a schedule's rhythm
// where nothing is saved yet — the stub preview — where no shifts
// can be claimed to an unsaved record.
function paystubNextPaydays(stub,count,todayStr){const today=todayStr||localDate(new Date());if(!stub||!psValidISO(stub.payDate)||!normalizePayFrequency(stub.frequency))return [];const occ=paystubOccurrences(stub,today,psAddDays(today,400));const out=[],seen=new Set();for(const o of occ){if(!o||seen.has(o.date))continue;seen.add(o.date);out.push(o.date);if(out.length>=(count||3))break}return out}
// --- Paycheck calculation engine (Nov 6, 2026) ---
// A stub's pay period, anchored on the stub itself. When the stub
// states its period, that IS the anchor. When it does not, the period
// for the stub's own check is the window between the previous payday
// and this payday (periods tile by payday) — a deterministic fallback,
// never an invented lag.
function paystubStepBackDate(iso,freq,anchorDay){const f=normalizePayFrequency(freq);if(!psValidISO(iso))return '';if(f==='weekly')return psAddDays(iso,-7);if(f==='biweekly')return psAddDays(iso,-14);if(f==='monthly')return psAddMonths(iso,-1,anchorDay);if(f==='semi-monthly'){const days=paystubSemiMonthlyDays(anchorDay||+iso.slice(8,10));let best='';for(let back=0;back<2;back++){const base=new Date(iso.slice(0,4)+'-'+iso.slice(5,7)+'-01T12:00:00');base.setMonth(base.getMonth()-back);const y=base.getFullYear(),m=base.getMonth()+1,dim=psDaysInMonth(y,m);for(const ad of days){const cand=y+'-'+String(m).padStart(2,'0')+'-'+String(Math.min(ad,dim)).padStart(2,'0');if(cand<iso&&cand>best)best=cand}}return best}return ''}
function paystubAnchorPeriod(stub){if(!stub)return null;const s=psValidISO(stub.periodStart),e=psValidISO(stub.periodEnd);if(s&&e&&e>=s)return {start:s,end:e};const pd=psValidISO(stub.payDate);if(!pd)return null;const prev=paystubStepBackDate(pd,stub.frequency,+pd.slice(8,10));if(!prev)return null;return {start:psAddDays(prev,1),end:pd}}
// The period a given payday covers: the anchor period shifted by the
// exact number of days between the stub's payday and this payday, so
// the lag the stub demonstrated (period end -> payday) is preserved
// exactly for every frequency.
function paystubPeriodForPayday(stub,payday,anchor){const a=anchor||paystubAnchorPeriod(stub);if(!a||!psValidISO(payday)||!psValidISO(stub.payDate))return null;const delta=Math.round((new Date(payday+'T12:00:00')-new Date(stub.payDate+'T12:00:00'))/864e5);return {start:psAddDays(a.start,delta),end:psAddDays(a.end,delta)}}
// Which stub a shift belongs to. Shifts carry a facility name, stubs an
// agency and (usually) the facility the stub names. Tier 1: the stub
// names the shift's facility. Tier 2: the agency name and the facility
// name contain each other ("Holzer Locums" paying for Holzer). Tier 3:
// a stub naming no facility and matching no name claims whatever no
// other stub claimed — the common single-agency case. Every shift is
// claimed by at most one stub, so two agencies can never both count
// the same shift in their paychecks.
function paystubFacilityKey(raw){const f=raw?facilityByNameOrAlias(raw):null;return normFacilityName(f?f.name:(raw||'')).replace(/\s+/g,' ')}
function paystubShiftClaimTier(stub,x){
  const fk=shiftFacilityKeyOf(x);
  const sf=String(stub.facility||'').trim();
  if(sf){
    // Identity before strings (Nov 10, 2026, v111): when both the
    // stub's facility text and the shift's facility text resolve
    // to a saved facility — exactly OR by the one tolerant variant
    // rule — the claim is decided by facility identity, so a stub
    // naming "Holzer" claims the shifts of the facility saved as
    // "HOLZ" (live bug: the keys "holzer"/"holz" never equalled,
    // the tier came back 0, and every paycheck for the period
    // reported "no shifts recorded"). Resolved to two DIFFERENT
    // facilities is a hard no — a stub never claims another
    // facility's shifts, which keeps two payers at one hospital
    // distinct. Unresolved text keeps the legacy key comparison.
    const sFac=facilityByNameOrVariant(sf);
    const xFac=x&&x.facility?facilityByNameOrVariant(x.facility):null;
    if(sFac&&xFac)return sFac.id===xFac.id?1:0;
    return paystubFacilityKey(sf)===fk?1:0;
  }
  const ak=normFacilityName(stub.agency||'').replace(/\s+/g,' ');
  if(ak&&fk&&(ak===fk||(ak.length>=3&&fk.length>=3&&(ak.includes(fk)||fk.includes(ak)))))return 2;
  return 3;
}
// --- One effective schedule per payer (Nov 9, 2026) ---
// One payer can hold more than one stored record. A pay schedule
// entered at import is saved under the name the import knew — the
// facility ("Holzer"); a pay stub uploaded later is saved under
// the payer named on the document ("Premier Anesthesia Group,
// PC"). The save flows' one-schedule-per-agency guard matches the
// agency string exactly, so the two records never saw each other —
// and each generated its OWN paycheck series: on Nov 10 the stub's
// actual ($12,757.50) and the schedule's estimate ($11,000) stacked
// as two chips, and the month headline counted both ($49,957.50
// for a month whose real figure is $39,832.50). Caleb's rule: "If
// a paystub is uploaded it should always be the default."
// The fix is a read-time unification — stored records are never
// rewritten, so nothing needs migrating and the result is the same
// whichever flow ran first: records that are the same payer
// collapse into ONE effective schedule for everything the paycheck
// engine does (shift claims, occurrences on every surface,
// reconciliations). Merging money needs stricter evidence than
// the forgiving matching claims use — two DIFFERENT agencies can
// pay for the same facility, so a shared facility never links
// records on its own. Two records are the same payer when their
// AGENCY names identify them (equal, or one containing the other —
// the same payer named slightly differently on two documents), or
// when their series are identical (same frequency, paydays on the
// same rhythm, anchor periods tiling identically) and nothing
// contradicts it: at most one of them states an amount (two
// uploaded stubs with no name in common stay two payers), and
// they do not resolve to two different facilities. The bug pair
// links by series: the import record's agency is just the facility
// placeholder, but its cadence and period tiling are the stub's
// own. In a unified group the record that states an amount — a
// real stub — is canonical: its agency label, pay date, period
// anchor and actual win (the stub is the default); blanks fill
// from the others, per-check corrections from every record carry
// over, and a second stub's amount is carried as a stub actual
// for its own payday, so two stubs for one payer both show as
// actuals. The Pay schedules list still shows the stored records
// as saved; only the paycheck math unifies them.
function paystubNameKey(v){return String(v||'').trim().toLowerCase().replace(/\s+/g,' ')}
function paystubFacilityOf(rec){
  if(!rec)return null;
  try{return facilityByNameOrAlias(String(rec.facility||'').trim())||facilityByNameOrVariant(String(rec.facility||'').trim())||facilityByNameOrAlias(String(rec.agency||'').trim())||facilityByNameOrVariant(String(rec.agency||'').trim())||null}catch(e){return null}
}
function paystubPaydaysCongruent(a,b){
  const e=String(a.payDate)<=String(b.payDate)?a:b,l=e===a?b:a;
  let d=e.payDate,guard=0;
  while(d&&d<l.payDate&&guard++<400){const n=paystubStepDate(d,e.frequency,+String(e.payDate).slice(8,10));if(!n||n<=d)return false;d=n}
  return d===l.payDate;
}
function paystubSameTiling(a,b){
  // A record that never stated its period has no tiling to contradict
  // (Nov 9, 2026, live trace): the import form invites leaving the
  // period blank, and the fallback anchor derived from the payday
  // alone (period ending ON the payday) can never tile with a real
  // stub's stated period (ending days before it) — so an unstated
  // period must not veto a link the paydays, frequency and facility
  // all support. Two STATED periods that do not tile still veto:
  // that is the two-different-payers discriminator.
  if(!a.periodStated||!b.periodStated)return true;
  const pa=paystubAnchorPeriod(a),pb=paystubAnchorPeriod(b);if(!pa||!pb)return false;
  const delta=Math.round((new Date(String(b.payDate)+'T12:00:00')-new Date(String(a.payDate)+'T12:00:00'))/864e5);
  return psAddDays(pa.start,delta)===pb.start&&psAddDays(pa.end,delta)===pb.end;
}
// Stored-record hygiene (Nov 9, 2026, live trace): a pay-stub record
// whose payDate is not a strict ISO date — '11/10/2026' from an older
// build's serialization, an ISO datetime, a long-form date — is
// INVISIBLE to the paycheck engine (every occurrence guard requires
// psValidISO), so the stub silently stopped existing: no series, no
// unification, no actual, while its amount sat in storage unread.
// Caleb's live account matched that shape exactly (single "Holzer
// est." chip, headline = estimates only). Records are therefore
// normalized at READ time (loose date parsing, canonical frequency,
// canonical amount strings) — value-preserving only, never invented:
// a field that does not parse is left exactly as stored. The boot
// heal below also writes the normalized shape back once, so the
// stored record itself recovers on plain app open.
function paystubLooseISO(v){
  const raw=String(v||'').trim();if(!raw)return '';
  const strict=psValidISO(raw);if(strict)return strict;
  const dt=raw.match(/^(\d{4}-\d{2}-\d{2})[T ]/);if(dt){const d=psValidISO(dt[1]);if(d)return d}
  return paystubParseDateStr(raw);
}
function paystubNormalizeRecord(r){
  if(!r||typeof r!=='object')return r;
  const out={...r};
  const pd=paystubLooseISO(r.payDate),ps=paystubLooseISO(r.periodStart),pe=paystubLooseISO(r.periodEnd);
  out.periodStated=!!(ps&&pe);
  if(pd)out.payDate=pd;
  if(ps)out.periodStart=ps;
  if(pe)out.periodEnd=pe;
  const fq=normalizePayFrequency(r.frequency);if(fq)out.frequency=fq;
  const g=rateOrNull(r.gross),n=rateOrNull(r.net);
  if(g!=null)out.gross=String(g);
  if(n!=null)out.net=String(n);
  return out;
}
function healPaystubRecordShapes(){
  let changed=0;
  for(const r of (db.payStubs||[])){
    if(!r||typeof r!=='object'||!r.id)continue;
    const norm=paystubNormalizeRecord(r);
    let touched=false;
    for(const k of ['payDate','periodStart','periodEnd','frequency','gross','net']){
      if(String(norm[k]??'')!==String(r[k]??'')){r[k]=norm[k];touched=true}
    }
    if(touched){r.updatedAt=new Date().toISOString();changed++;try{if(typeof cloudSaveKind==='function')cloudSaveKind('payStubs',r.id)}catch(_){}}
  }
  return changed;
}
// THE pricing resolution order (Nov 10, 2026 — the Edit-form round):
// every pass that prices or re-prices a shift resolves the same way,
// so the rate card and the per-shift rules captured in the user's own
// words can never disagree between screens: (1) an unpaid code
// definition is final — $0 on purpose; (2) the clarified per-code
// definition (it carries the user's weekday/weekend amounts and
// paid-hours answers); (3) the facility rate card by the shift's
// type. Returns {pay,payRate,payUnit}, or null when nothing can
// price the shift.
function resolveShiftPrice(fac,x){
  if(!fac||!x)return null;
  const udef=x.code?codeDefFor(fac,x.code):null;
  if(udef&&udef.unpaid)return{pay:'0',payRate:'',payUnit:'unpaid'};
  const cp=clarifiedRowPricing(fac,x);
  if(cp&&cp.pay!=null&&String(cp.pay).trim()!=='')return{pay:String(cp.pay),payRate:cp.payRate||'',payUnit:cp.payUnit||''};
  const p=facilityPayFor(fac,x.type,x.date);
  if(p>0)return{pay:String(Math.round(p*100)/100),payRate:'',payUnit:'facility'};
  return null;
}
// Live price for a shift whose stored pay cannot be used (Nov 10,
// 2026 — the $0.00 paycheck bug): the paycheck estimate is DEFINED
// as the period's shifts priced at the facility rate card, so a
// blank (or incomplete-flagged) stored stamp must never read as $0
// when the card can price the shift. Delegates to the one resolution
// order above; returns 0 only when no rule can price the shift.
function paystubLiveShiftPrice(x){
  const fac=x&&x.facility?facilityByNameOrAlias(x.facility):null;
  if(!fac)return 0;
  const res=resolveShiftPrice(fac,x);
  return res?num(res.pay):0;
}
// Was this shift's stored pay CALCULATED from the facility's rules
// (a formula result that must follow when the rules are corrected),
// rather than typed by the user as a fact? Amounts the user typed as
// per-shift totals (payUnit 'daily') and manual edits are never
// derived — with one December-round exception below, where a
// feed-priced total stamped 'daily' at approve is recognisably the
// old formula's output (hourly x the definition's shift hours,
// exactly) and follows a paid-hours correction.
function shiftPayIsDerived(f,x){
  if(!f||!x)return false;
  if(x.payUnit==='hourly'||x.payUnit==='facility'||x.payUnit==='unpaid')return true;
  if(!x.payUnit&&String(x.code||'').trim()!==''&&!!codeDefFor(f,x.code))return true;
  if(x.payUnit==='daily'&&String(x.code||'').trim()){
    const def=codeDefFor(f,x.code);
    const srcs=shiftSourcesList(x);
    if(def&&srcs.length&&!srcs.every(v=>v==='user-entered')){
      const canon=String(def.canonicalType||'').trim()||canonicalTypeOf(def.label||'');
      const hr=rateOrNull(f.hourlyRate),dh=rateOrNull(def.hours);
      if(canon&&/hour/i.test(canon)&&!/call/i.test(canon)&&hr!=null&&dh!=null&&Math.abs(num(x.pay)-Math.round(hr*dh*100)/100)<0.005)return true;
    }
  }
  return false;
}
// Repair every shift of one facility against the CURRENT rules, in
// the one resolution order (resolveShiftPrice). Blank pays are
// stamped; derived stamps follow corrected rules; a stamped amount
// still flagged incomplete is restamped when it is a formula result,
// and its flag clears when it already equals the resolved price; an
// unpaid code is stamped $0/unpaid and stays there. A number the
// user typed as a per-shift total is a fact — never moved (while it
// is flagged, the paycheck layer live-prices around it). A shift no
// rule can price is left exactly as stored, so it keeps surfacing as
// incomplete instead of hiding. Returns {priced, updated}: shifts
// that were unpriced and now hold a price, and already-priced shifts
// whose amount followed a rule change.
function repairShiftPaysForFacility(f){
  const out={priced:0,updated:0};
  if(!f)return out;
  // Misread-flat heal (Nov 10, 2026, v111): a card saved by the
  // bad parse can carry the paid-hours figure AS a flat day rate
  // (rate8 '8.5' beside paidHours8 '8.5'). The flat outranks the
  // hourly rule in every pricing path, so the shifts below would
  // restamp at $8.50 forever — the parse-side screen can only
  // stop NEW cards. The signature is exact: the flat's value IS
  // a paid-hours figure on this card (the facility's paidHours8
  // or a day code's own paid-hours answer) AND it is below the
  // hourly rate — no genuine per-shift flat looks like that.
  // Clearing exactly that signature lets the corrected rules
  // (hourly x paid hours) price the derived stamps below; a
  // user-typed per-shift total is a stored shift amount, not a
  // card field, and is never touched here.
  {
    const phNums=new Set();
    const fph=rateOrNull(f.paidHours8);if(fph!=null)phNums.add(fph);
    for(const d of Object.values(facilityCodeDefs(f)||{})){const dp=d?rateOrNull(d.paidHours):null;if(dp!=null)phNums.add(dp)}
    const hrF=rateOrNull(f.hourlyRate);
    if(phNums.size)for(const k of ['rate8','rate10','rate12']){
      const v=rateOrNull(f[k]);
      if(v!=null&&phNums.has(v)&&(hrF==null||v<hrF)){f[k]='';f.updatedAt=new Date().toISOString()}
    }
  }
  // Residue paid-hours heal (Nov 10, 2026, v112): the same
  // misread also lived one level down — the buggy words parse
  // stamped the facility's paidHours8 onto NON-8-hour day
  // codes' DEFINITIONS as per-code paidHours, and no pass ever
  // looked at a definition's paidHours, so clarifiedRowPricing
  // priced the code at hourly x the 8-hour figure ($2,125 on
  // a 10-hour day) on every open, forever. The signature is
  // the same exact one, one level down: a words-created
  // (viaWords — the import approve saves through the same
  // applyDescribedRules) non-8-hour day definition whose
  // paidHours EQUALS the facility's paidHours8 and carries no
  // own-statement marker (paidHoursOwn — set when the code's
  // OWN statement stated the figure). Retracting exactly that
  // lets the shifts below reprice through the generic path in
  // this same pass. A code whose own words stated paid hours
  // keeps them even when they happen to equal the facility
  // figure (the marker is the difference); field-captured
  // definitions are never words-created and are untouched;
  // 8-hour definitions are the figure's rightful home and are
  // untouched. Runs before the shift loop so the retraction
  // prices in the same pass.
  {
    const fph=rateOrNull(f.paidHours8);
    if(fph!=null)for(const d of Object.values(facilityCodeDefs(f)||{})){
      if(!d||d.viaWords!==true||d.paidHoursOwn)continue;
      const dph=rateOrNull(d.paidHours);if(dph==null||dph!==fph)continue;
      const ct=String(d.canonicalType||'').trim()||canonicalTypeOf(d.label||'');
      if(!ct||!/hour/.test(ct)||/call/i.test(ct)||/8-hour/.test(ct))continue;
      delete d.paidHours;f.updatedAt=new Date().toISOString();
    }
  }
  for(const x of (db.shifts||[])){
    if(!x||!x.facility)continue;
    const match=facilityByNameOrAlias(x.facility);if(!match||match.id!==f.id)continue;
    const res=resolveShiftPrice(f,x);if(!res)continue;
    const wasPriced=isPricedShift(x);
    const blank=String(x.pay||'').trim()==='';
    const stamp=()=>{x.pay=res.pay;x.payRate=res.payRate;x.payUnit=res.payUnit;x.incomplete=false;x.updatedAt=new Date().toISOString()};
    if(res.payUnit==='unpaid'){
      // $0 on purpose is final. A hand-typed per-shift total with a
      // real amount is the user's correction layer and is left
      // alone; any derived or blank stamp becomes the unpaid $0.
      const derivedStamp=blank||x.incomplete||x.payUnit==='hourly'||x.payUnit==='facility'||x.payUnit==='unpaid'||!x.payUnit;
      if(!derivedStamp)continue;
      if(String(x.pay||'')!=='0'||x.payUnit!=='unpaid'||x.incomplete){const changed=String(x.pay||'')!==res.pay||x.payUnit!==res.payUnit;stamp();if(wasPriced){if(changed)out.updated++}else out.priced++}
      continue;
    }
    if(blank){stamp();out.priced++;continue}
    if(!wasPriced){
      if(shiftPayIsDerived(f,x)){stamp();out.priced++}
      else if(Math.abs(num(x.pay)-num(res.pay))<0.005){x.incomplete=false;x.updatedAt=new Date().toISOString();out.priced++}
      continue;
    }
    if(shiftPayIsDerived(f,x)&&String(x.pay)!==res.pay){stamp();out.updated++}
  }
  return out;
}
// Boot heal (Nov 10, 2026 — the $0.00 paycheck bug; unified with
// the save-time pass Nov 10, 2026 — the Edit-form round): shifts
// saved with a blank stored pay (an older build's import, a cloud
// download shape the paycheck layer reads as unpriced) are priced
// from their facility's rules and stamped, on plain open — no
// re-import, no re-upload, no manual rate edit. This runs the SAME
// repair pass a facility save runs (repairShiftPaysForFacility):
// the earlier heal stamped blanks and cleared an incomplete flag
// whose amount already equalled the price, but a DERIVED stamp that
// disagreed with the current rules kept its flag forever — the
// shift counted as unpriced on every open until the day a facility
// edit happened to reprice it (Caleb's nine HOLZ shifts). Derived
// stamps now follow the rules here too; a number the user typed
// stays exactly as stored.
function facilityHasPayRules(f){
  if(!f)return false;
  const money=['hourlyRate','rate8','rate10','rate12','rate24','weekendRate24','rateSecond','weekendRateSecond','hourlyCall1st','callBonus'];
  if(money.some(k=>rateOrNull(f[k])!=null))return true;
  return Object.keys(facilityCodeDefs(f)).length>0;
}
function facilityNameVariantOf(a,b){
  const x=facilityNameKey(a),y=facilityNameKey(b);
  if(!x||!y||x===y)return false;
  const s=x.length<=y.length?x:y,l=x.length<=y.length?y:x;
  return s.length>=4&&(l.length-s.length)<=3&&l.startsWith(s);
}
// Facility-identity heal (Nov 10, 2026): an unpriced shift whose
// facility TEXT is a name variant of the facility that holds the
// rules ("HOLZ" vs "Holzer" — a feed's short code vs the full name)
// resolves nowhere: the paycheck claim path still claims the shift,
// but the ONE matcher every path shares (facilityByNameOrAlias)
// cannot price it, so the check reports "incomplete" forever. When
// exactly ONE facility with rules is a close prefix variant of the
// shift's facility text — or of the blank facility record that text
// resolves to — link them the way the app always links name
// variants: an alias when the text resolves nowhere; a re-point of
// the unpriced shifts when the text resolves to a blank record of
// its own. Only unpriced shifts are touched and no stored amount
// ever changes here; the repair pass below then prices them through
// the same matcher as everything else.
function healFacilityIdentities(){
  let linked=0;
  for(const x of (db.shifts||[])){
    if(!x||!String(x.facility||'').trim())continue;
    if(isPricedShift(x))continue;
    const resolved=facilityByNameOrAlias(x.facility);
    if(resolved&&resolveShiftPrice(resolved,x))continue;
    const probe=(resolved&&resolved.name)||x.facility;
    const cands=(db.facilities||[]).filter(g=>g&&(!resolved||g.id!==resolved.id)&&facilityHasPayRules(g)&&facilityNameVariantOf(g.name,probe)&&resolveShiftPrice(g,x));
    if(cands.length!==1)continue;
    const g=cands[0];
    if(!resolved){if(addFacilityAlias(g,x.facility)){try{cloudSaveKind('facilities',g.id)}catch(e){}linked++}}
    else if(!facilityHasPayRules(resolved)){x.facility=g.name;x.updatedAt=new Date().toISOString();linked++}
  }
  return linked;
}
function healUnpricedShiftPays(){
  try{healFacilityIdentities()}catch(e){}
  let n=0;
  for(const f of (db.facilities||[])){const r=repairShiftPaysForFacility(f);n+=r.priced+r.updated}
  return n;
}
function paystubSamePayer(a,b){
  if(!a||!b)return false;
  if(a.id&&b.id&&a.id===b.id)return true;
  const an=paystubNameKey(a.agency),bn=paystubNameKey(b.agency);
  if(an&&bn&&(an===bn||(an.length>=3&&bn.length>=3&&(an.includes(bn)||bn.includes(an)))))return true;
  if(paystubStubActual(a)&&paystubStubActual(b))return false;
  const fa=paystubFacilityOf(a),fb=paystubFacilityOf(b);
  if(fa&&fb&&fa.id!==fb.id)return false;
  if(!normalizePayFrequency(a.frequency)||a.frequency!==b.frequency)return false;
  if(!psValidISO(a.payDate)||!psValidISO(b.payDate))return false;
  return paystubPaydaysCongruent(a,b)&&paystubSameTiling(a,b);
}
function paystubUnifiedRecord(group){
  const sorted=group.slice().sort((a,b)=>{
    const aa=paystubStubActual(a)?1:0,bb=paystubStubActual(b)?1:0;
    if(aa!==bb)return bb-aa;
    if(aa)return String(b.payDate||'').localeCompare(String(a.payDate||''));
    return String(a.id||'').localeCompare(String(b.id||''));
  });
  const base={...sorted[0]};
  const rest=sorted.slice(1);
  for(const r of rest){
    if(!String(base.facility||'').trim()){
      if(String(r.facility||'').trim())base.facility=r.facility;
      else{const f=paystubFacilityOf(r);if(f)base.facility=f.name}
    }
    if(!psValidISO(base.periodStart)&&psValidISO(r.periodStart))base.periodStart=r.periodStart;
    if(!psValidISO(base.periodEnd)&&psValidISO(r.periodEnd))base.periodEnd=r.periodEnd;
  }
  const ovs={};
  for(const r of rest)if(r.occOverrides&&typeof r.occOverrides==='object')for(const k of Object.keys(r.occOverrides))if(!(k in ovs))ovs[k]=r.occOverrides[k];
  if(base.occOverrides&&typeof base.occOverrides==='object')for(const k of Object.keys(base.occOverrides))ovs[k]=base.occOverrides[k];
  if(Object.keys(ovs).length)base.occOverrides=ovs;else delete base.occOverrides;
  // Another stub in the group (same payer, a different check): its
  // amount is carried as a stub actual for its own payday
  // (stubActualDates), so two uploaded stubs both show as actuals
  // on the one series — stub-backed like the canonical stub's own
  // check, not a per-check correction the editor can clear.
  const sads={};
  for(const r of rest){
    const act=paystubStubActual(r);
    if(act&&psValidISO(r.payDate)&&r.payDate!==base.payDate)sads[r.payDate]=String(act.amount);
  }
  if(Object.keys(sads).length)base.stubActualDates=sads;
  base.mergedFrom=group.map(r=>r.id||'');
  return base;
}
function paystubSchedules(){
  const recs=(db.payStubs||[]).filter(x=>x&&typeof x==='object').map(paystubNormalizeRecord);
  if(recs.length<2)return recs.slice();
  const parent=new Map();
  const find=id=>{let p=parent.get(id);while(parent.get(p)!==p)p=parent.get(p);let c=id;while(parent.get(c)!==p){const n=parent.get(c);parent.set(c,p);c=n}return p};
  for(const r of recs)if(r.id)parent.set(r.id,r.id);
  for(let i=0;i<recs.length;i++)for(let j=i+1;j<recs.length;j++){
    const a=recs[i],b=recs[j];if(!a.id||!b.id)continue;
    if(paystubSamePayer(a,b)){const ra=find(a.id),rb=find(b.id);if(ra!==rb)parent.set(ra,rb)}
  }
  const groups=new Map();
  for(const r of recs){
    const k=r.id?find(r.id):('noid:'+recs.indexOf(r));
    if(!groups.has(k))groups.set(k,[]);
    groups.get(k).push(r);
  }
  const out=[];
  for(const g of groups.values())out.push(g.length===1?g[0]:paystubUnifiedRecord(g));
  return out;
}
function paystubShiftClaims(){const claims=new Map();const stubs=paystubSchedules().slice().sort((a,b)=>String(a.agency||'').localeCompare(String(b.agency||''))||String(a.id||'').localeCompare(String(b.id||'')));const shifts=(db.shifts||[]).filter(x=>x&&x.id&&psValidISO(x.date));for(const tier of [1,2,3]){for(const stub of stubs){if(!stub.id)continue;for(const x of shifts){if(claims.has(x.id))continue;if(paystubShiftClaimTier(stub,x)===tier)claims.set(x.id,stub.id)}}}return claims}
// One period's shifts for one stub, priced exactly like the C/P totals
// (same isBillableShift pricing — call rates and all — and the same
// unpriced rule: an unpriced shift is counted and flagged, never
// silently $0). Rejected/canceled and W-2 salary shifts never count.
// THE PAYCHECK AMOUNT IS `total`: every priced shift in the period,
// confirmed and proposed alike. Confirmed/proposed is a forecasting
// split (will it happen?), not a pay split — a shift on the schedule
// inside the period lands in that period's check, so the check must
// equal the whole period sum, exactly like the calendar's month total
// (which also sums every status). Bug, Nov 6, 2026: the paycheck
// displayed only the confirmed slice (gross) — Caleb's Nov 24 check
// read $9,375 because his Nov 6–13 shifts were still stored as
// "proposed" from the pre-two-status import rule, while the real
// period sum (and his forecast) was $27,075. gross / grossWithProposed
// are kept for the C/P reconciliation deltas only; grossWithProposed
// equals total by construction.
function paystubPeriodTotals(stub,periodStart,periodEnd,claims){
  const out={gross:0,grossWithProposed:0,total:0,shiftCount:0,pricedCount:0,unpriced:0};
  if(!stub||!periodStart||!periodEnd)return out;
  for(const x of (db.shifts||[])){
    if(!x||!x.id||claims.get(x.id)!==stub.id)continue;
    const d=String(x.date||'');if(d<periodStart||d>periodEnd)continue;
    const st=normalizeShiftStatus(x.status);if(st==='rejected'||st==='canceled')continue;
    if(isW2SalaryShift(x))continue;
    out.shiftCount++;
    if(!isPricedShift(x)){
      // A shift whose code the user defined as UNPAID (Nov 10,
      // 2026) is a KNOWN $0: it counts as priced, adds nothing to
      // the check, and is never live-priced from the card — the
      // one $0 the live-pricing rule below must not "fix".
      const ufac=x.facility?facilityByNameOrAlias(x.facility):null;
      const udef=ufac&&x.code?codeDefFor(ufac,x.code):null;
      if(udef&&udef.unpaid){out.pricedCount++;continue}
      // Nov 10, 2026 ($0.00 paycheck bug): an unusable stored stamp
      // is not a $0 shift. Price the shift live from its facility's
      // rate card before counting it unpriced — a state whose stored
      // pays never landed showed "est. $0.00" for a fully priceable
      // period and dropped the whole check out of the month
      // headline. The stored record is also healed on open
      // (healUnpricedShiftPays); this read-time pass covers anything
      // that reaches the paycheck layer unhealed. Only a shift no
      // card can price stays unpriced.
      const live=paystubLiveShiftPrice(x);
      // (isBillableShift embeds isPricedShift, so it cannot gate
      // this branch; W-2 salary shifts were already skipped above —
      // what remains of the billable rule here is the 1099 check.)
      if(!(live>0)||!employmentIncludes1099()){out.unpriced++;continue}
      out.pricedCount++;
      out.total+=live;
      if(st==='confirmed'||st==='completed')out.gross+=live;
      else if(st==='proposed')out.grossWithProposed+=live;
      continue;
    }
    if(!isBillableShift(x))continue;
    out.pricedCount++;
    out.total+=num(x.pay);
    if(st==='confirmed'||st==='completed')out.gross+=num(x.pay);
    else if(st==='proposed')out.grossWithProposed+=num(x.pay);
  }
  out.gross=Math.round(out.gross*100)/100;
  out.total=Math.round(out.total*100)/100;
  out.grossWithProposed=Math.round((out.grossWithProposed+out.gross)*100)/100;
  return out;
}
// The stub's own amount, when the stub states one: gross wins (it is
// the figure comparable to the shift sums); net is the fallback. This
// amount is the ACTUAL for the stub's own period only — it never
// feeds any other period's paycheck.
function paystubStubActual(stub){if(!stub)return null;const g=rateOrNull(stub.gross);if(g!=null&&g>0)return {amount:g,basis:'gross'};const n=rateOrNull(stub.net);if(n!=null&&n>0)return {amount:n,basis:'net'};return null}
// Reconciliation (Caleb, Nov 6, 2026): one record per stub that states
// an amount — the stub's own period contributes its ACTUAL instead of
// its shift sum. delta is what the swap moves a total by; deltaC uses
// the confirmed shift sum, deltaP the proposed-inclusive one, matching
// what each total actually contained for that period.
function paystubReconciliations(){const out=[];const claims=paystubShiftClaims();for(const stub of paystubSchedules()){const act=paystubStubActual(stub);const anchor=paystubAnchorPeriod(stub);if(act&&anchor){const totals=paystubPeriodTotals(stub,anchor.start,anchor.end,claims);out.push({stubId:stub.id||'',agency:stub.agency||'',facility:stub.facility||'',payday:stub.payDate||'',periodStart:anchor.start,periodEnd:anchor.end,actual:act.amount,actualBasis:act.basis,shiftSum:totals.gross,shiftSumP:totals.grossWithProposed,shiftCount:totals.shiftCount,delta:Math.round((act.amount-totals.gross)*100)/100,deltaP:Math.round((act.amount-totals.grossWithProposed)*100)/100})}
  // Entered actuals (calendar corrections, Nov 7, 2026): the same
  // reconciliation, one check each — the entered amount replaces that
  // period's shift sum in the YTD figures, exactly like a stub actual,
  // and teaches the schedule nothing (no forward rule is built).
  const ovs=(stub.occOverrides&&typeof stub.occOverrides==='object')?stub.occOverrides:{};
  for(const sd of Object.keys(ovs)){if(sd===stub.payDate)continue;const oa=rateOrNull(ovs[sd]&&ovs[sd].actual);if(oa==null||oa<=0||!anchor)continue;const period=paystubPeriodForPayday(stub,sd,anchor);if(!period)continue;const totals=paystubPeriodTotals(stub,period.start,period.end,claims);out.push({stubId:stub.id||'',agency:stub.agency||'',facility:stub.facility||'',payday:psValidISO(ovs[sd].payDate)||sd,periodStart:period.start,periodEnd:period.end,actual:oa,actualBasis:'entered',shiftSum:totals.gross,shiftSumP:totals.grossWithProposed,shiftCount:totals.shiftCount,delta:Math.round((oa-totals.gross)*100)/100,deltaP:Math.round((oa-totals.grossWithProposed)*100)/100})}
  // Carried stub actuals on a unified schedule (Nov 9, 2026): a
  // second stub for the same payer reconciles its own period the
  // same way — its actual replaces that period's shift sum in the
  // year figures, exactly like the canonical stub's own check.
  const sads=(stub.stubActualDates&&typeof stub.stubActualDates==='object')?stub.stubActualDates:{};
  for(const sd of Object.keys(sads)){if(sd===stub.payDate)continue;const sa=rateOrNull(sads[sd]);if(sa==null||sa<=0||!anchor)continue;const period=paystubPeriodForPayday(stub,sd,anchor);if(!period)continue;const totals=paystubPeriodTotals(stub,period.start,period.end,claims);out.push({stubId:stub.id||'',agency:stub.agency||'',facility:stub.facility||'',payday:sd,periodStart:period.start,periodEnd:period.end,actual:sa,actualBasis:'gross',shiftSum:totals.gross,shiftSumP:totals.grossWithProposed,shiftCount:totals.shiftCount,delta:Math.round((sa-totals.gross)*100)/100,deltaP:Math.round((sa-totals.grossWithProposed)*100)/100})}
  }return out}
// yearIncomeSplit with stubbed periods reconciled — presentation layer
// only (the raw engine and the stored shifts are untouched). A period
// counts as realized once it has fully ended (period end <= today);
// its actual then replaces its shift sum in C and P, YTD and predicted
// alike, so the same pay is never in a total twice.
function reconciledYearSplit(y,todayStr){const split=yearIncomeSplit(y,todayStr);const today=todayStr||localDate(new Date());const applied=[];for(const r of paystubReconciliations()){if(!r.periodEnd||r.periodEnd>today||r.periodEnd.slice(0,4)!==String(y))continue;split.c.ytd=Math.round((split.c.ytd+r.delta)*100)/100;split.c.predicted=Math.round((split.c.predicted+r.delta)*100)/100;split.p.ytd=Math.round((split.p.ytd+r.deltaP)*100)/100;split.p.predicted=Math.round((split.p.predicted+r.deltaP)*100)/100;applied.push(r)}split.stubActuals=applied;return split}
// Every paycheck for one stub inside [fromISO, toISO]. Paydays step
// from the stub's own pay date, so the cadence never drifts from what
// the stub actually showed; each payday's amount is calculated from
// the shifts in the period it covers — except the stub's own payday,
// which shows the stub's actual.
// SHIFT-DERIVED PAYDATES (Nov 11, 2026, v124 — Caleb: "if there are
// no dates with a facility then the calendar should not populate
// paydates moving forward... stop populating a pay schedule after
// the last paycheck"): an ESTIMATED occurrence exists only when its
// period holds at least one shift claimed by this schedule
// (confirmed or proposed — status is a forecast split, not a pay
// split). A period with no shifts produces NO occurrence — no
// paydate on the calendar, no row in Upcoming paychecks, no empty
// placeholder — however far the cadence would project, and a gap
// period between two worked periods is skipped the same way.
// Occurrences were always derived at render from (schedule x
// shifts), never stored, so the series self-adjusts: adding a
// shift in a later period brings its paydate back, and deleting a
// period's last shift removes its projected paydate on the next
// render. No "closed" flag, no toggle. ACTUALS are exempt: a
// stub-backed check (the stub's own, or a carried second-stub
// actual) and a check with an entered actual are real money that
// landed, so they show even when their period ends up holding no
// recorded shifts.
// Per-check corrections the user enters from the calendar (Nov 7,
// 2026) live ON the stub record — stub.occOverrides[scheduledPayday] =
// {actual:'27950.00', payDate:'2026-11-25'} — so they ride the stub's
// cloud row (the full record is the payload) and backups exactly like
// every other stub field, and survive clear-device -> sign-in. A
// correction changes ONE check only; the schedule's rhythm is never
// touched. The stub's OWN check is exempt: the stub is that check's
// source of truth, so an override keyed to the stub's payday is never
// applied over it (the editor refuses to create one, too).
function paystubOccurrenceOverride(stub,schedDate){if(!stub||!stub.occOverrides||typeof stub.occOverrides!=='object')return null;const o=stub.occOverrides[schedDate];return o&&typeof o==='object'?o:null}
function paystubStubBackedOccurrence(stub,schedDate){if(!stub||!schedDate)return false;if(schedDate===stub.payDate&&paystubStubActual(stub))return true;return !!(stub.stubActualDates&&typeof stub.stubActualDates==='object'&&rateOrNull(stub.stubActualDates[schedDate])!=null)}
function paystubOccurrences(stub,fromISO,toISO,claimsIn){const out=[];if(!stub||!psValidISO(stub.payDate)||!normalizePayFrequency(stub.frequency))return out;const claims=claimsIn||paystubShiftClaims();const anchor=paystubAnchorPeriod(stub);const act=paystubStubActual(stub);const anchorDay=+stub.payDate.slice(8,10);
// Generate over a WIDENED scheduled window and filter on the DISPLAY
// date: a one-off pay-date correction can pull a check across a month
// boundary in either direction, and the check belongs to the month it
// now lands in.
const lo=psAddDays(fromISO,-70),hi=psAddDays(toISO,70);let d=stub.payDate,guard=0;while(d>lo&&guard++<400){const p=paystubStepBackDate(d,stub.frequency,anchorDay);if(!p||p>=d)break;d=p}guard=0;while(d<=hi&&guard++<300){const period=anchor?paystubPeriodForPayday(stub,d,anchor):null;const totals=period?paystubPeriodTotals(stub,period.start,period.end,claims):{gross:0,grossWithProposed:0,total:0,shiftCount:0,pricedCount:0,unpriced:0};const ownStubBacked=!!(act&&d===stub.payDate);const extraStubAmt=!ownStubBacked&&stub.stubActualDates&&typeof stub.stubActualDates==='object'?rateOrNull(stub.stubActualDates[d]):null;const stubBacked=ownStubBacked||extraStubAmt!=null;const ov=stubBacked?null:paystubOccurrenceOverride(stub,d);let date=d,enteredActual=null;if(ov){const od=psValidISO(ov.payDate);if(od)date=od;const oa=rateOrNull(ov.actual);if(oa!=null&&oa>0)enteredActual=oa}const isActual=stubBacked||enteredActual!=null;if(date>=fromISO&&date<=toISO&&(isActual||totals.shiftCount>0))out.push({date,schedDate:d,dateOverridden:date!==d,periodStart:period?period.start:'',periodEnd:period?period.end:'',gross:totals.gross,grossWithProposed:totals.grossWithProposed,total:totals.total,unpriced:totals.unpriced,shiftCount:totals.shiftCount,agency:stub.agency||'',facility:stub.facility||'',stubId:stub.id||'',isActual,actual:ownStubBacked?act.amount:(extraStubAmt!=null?extraStubAmt:enteredActual),actualBasis:ownStubBacked?act.basis:(extraStubAmt!=null?'gross':(enteredActual!=null?'entered':'')),enteredActual:enteredActual!=null,stubBacked});const n=paystubStepDate(d,stub.frequency,anchorDay);if(!n||n<=d)break;d=n}return out}
function paystubOccurrencesOn(dateISO){const claims=paystubShiftClaims();const all=[];for(const s of paystubSchedules())all.push(...paystubOccurrences(s,dateISO,dateISO,claims));all.sort((a,b)=>String(a.agency).localeCompare(String(b.agency)));return all}
function paystubOccurrencesInMonth(prefix){if(!featureOn('featurePaychecks'))return[];const y=+prefix.slice(0,4),m=+prefix.slice(5,7),from=prefix+'-01',to=prefix+'-'+String(psDaysInMonth(y,m)).padStart(2,'0');const claims=paystubShiftClaims();const all=[];for(const s of paystubSchedules())all.push(...paystubOccurrences(s,from,to,claims));all.sort((a,b)=>a.date.localeCompare(b.date)||String(a.agency).localeCompare(String(b.agency)));return all}
// --- One headline number per month (Caleb, Nov 7, 2026) ---
// A month has two honest gross figures and they are NOT the same
// number: the WORKED basis (shifts worked in the month, paid whenever
// their period pays) and the PAYCHECK basis (paychecks landing in the
// month — stub actuals + per-period shift calculations). Showing both
// side by side as competing "expected gross" totals reads as an error
// (his November: $39,825 worked vs $39,832.50 landing — a $7.50 gap
// with no explanation). So every month surface — the calendar banner,
// the Dashboard stat card, the assistant — speaks with ONE voice via
// this helper: when a pay schedule has paychecks landing in the
// month, the headline is the paycheck basis for those agencies
// (what actually lands); shifts no covering schedule claims still
// count once, on the worked basis (partial coverage combines the two,
// never double-counts — a claimed shift is in its paycheck's period
// total or in the worked sum, never both). With no covering schedule
// the headline is the plain worked sum, exactly as before. Year/YTD
// figures are untouched — they keep the reconciled treatment in
// reconciledYearSplit.
function monthHeadline(prefix){
  const occ=paystubOccurrencesInMonth(prefix);
  const covering=new Set();let paycheckTotal=0,anyActual=false;
  for(const o of occ){if(o.stubId)covering.add(o.stubId);const a=paystubOccurrenceAmount(o);if(a!=null)paycheckTotal+=a;if(o.isActual)anyActual=true}
  const scheduled=covering.size>0;
  const claims=scheduled?paystubShiftClaims():new Map();
  let worked=0,workedShifts=0;
  for(const x of (db.shifts||[])){
    if(!x||!String(x.date||'').startsWith(prefix))continue;
    if(scheduled&&covering.has(claims.get(x.id)))continue;
    worked+=num(x.pay);workedShifts++;
  }
  paycheckTotal=Math.round(paycheckTotal*100)/100;
  worked=Math.round(worked*100)/100;
  return {gross:Math.round((paycheckTotal+worked)*100)/100,paycheckTotal,worked,paychecks:occ.length,anyActual,scheduled,partial:scheduled&&worked>0,workedShifts};
}
function paystubUpcoming(limit,todayStr){const today=todayStr||localDate(new Date());const to=psAddDays(today,120);const claims=paystubShiftClaims();const all=[];for(const s of paystubSchedules())all.push(...paystubOccurrences(s,today,to,claims));all.sort((a,b)=>a.date.localeCompare(b.date)||String(a.agency).localeCompare(String(b.agency)));return all.slice(0,limit||6)}
// A paycheck's calculated amount: EVERY priced shift in its period
// (confirmed + proposed — see paystubPeriodTotals). Falls back to the
// proposed-inclusive figure on any occurrence built without `total`.
function paystubOccurrenceTotal(x){if(!x)return 0;if(x.total!=null)return x.total;if(x.grossWithProposed!=null)return x.grossWithProposed;return x.gross||0}
// The amount a paycheck displays: the stub actual for a stub's own
// check, the calculated period total otherwise, null when no shifts
// are recorded for the period yet (never a fake $0 from the stub).
function paystubOccurrenceAmount(x){if(!x)return null;if(x.isActual)return x.actual;if(!x.shiftCount)return null;
// Nov 10, 2026: a period whose counted shifts are ALL unpriceable
// (no rate card can price any of them) has no amount — null, so
// surfaces render "incomplete" / "—", never a false "est. $0.00".
if(x.total===0&&(x.unpriced||0)>0&&(x.unpriced||0)>=(x.shiftCount||0))return null;
return paystubOccurrenceTotal(x)}
function paystubForAgency(agency){const n=String(agency||'').trim().toLowerCase();if(!n)return null;return (db.payStubs||[]).find(x=>String(x.agency||'').trim().toLowerCase()===n)||null}
function paystubNextDatesText(p){if(!p||!normalizePayFrequency(p.frequency)||!psValidISO(p.payDate))return 'Add a pay frequency and a pay date to see the next expected pay dates.';const fake={...p};const first=paystubNextPayDate(fake);if(!first)return 'Add a pay frequency and a pay date to see the next expected pay dates.';const dates=[first];let d=first;for(let i=0;i<2;i++){const n=paystubStepDate(d,fake.frequency,+fake.payDate.slice(8,10));if(!n||n<=d)break;dates.push(n);d=n}return 'Next expected pay dates (estimates): '+dates.map(x=>fmt(x)).join(' · ')+'.'}
// --- Deterministic pay-stub text parsing (pasted text / text-layer PDF) ---
// No AI, no network: label-anchored regexes over the text the user
// pasted or the PDF's own text layer. A field the text does not state
// stays blank for the preview — never invented, never $0. Amounts come
// from the FIRST $ amount on the labelled line (the current-period
// column; a YTD column after it is ignored). Frequency is inferred
// from the pay-period length when the stub does not state it.
function paystubMoneyOnLine(text,labelRx){for(const ln of String(text||'').split(/\r?\n/)){if(!labelRx.test(ln))continue;const m=ln.match(/\$?\s*([\d,]+\.\d{2})/);if(m)return Number(m[1].replace(/,/g,''))}return null}
function paystubParseDateStr(s){if(!s)return '';const p=contractParseSingle(String(s).trim());return p.iso||''}
function parsePaystubText(text){const t=String(text||'');const out={agency:'',facility:'',frequency:'',periodStart:'',periodEnd:'',payDate:'',gross:null,net:null,found:[]};
  const ag=t.match(/(?:employer|employer name|company name|company|agency|payroll company|organization)\s*[:\-]\s*([A-Za-z0-9][^\n\r]{1,70})/i);
  if(ag){out.agency=ag[1].trim().replace(/\s{2,}.*$/,'').trim();out.found.push('Agency / employer')}
  const per=t.match(/(?:pay period|period)\s*(?:ending|ended)?\s*[:\-]?\s*(\d{1,2}\/\d{1,2}\/\d{4}|\d{4}-\d{2}-\d{2}|[A-Za-z]+\.?\s+\d{1,2},?\s+\d{4})\s*(?:-|–|—|to|through|thru)\s*(\d{1,2}\/\d{1,2}\/\d{4}|\d{4}-\d{2}-\d{2}|[A-Za-z]+\.?\s+\d{1,2},?\s+\d{4})/i);
  if(per){out.periodStart=paystubParseDateStr(per[1]);out.periodEnd=paystubParseDateStr(per[2]);if(out.periodStart&&out.periodEnd)out.found.push('Pay period')}
  const pd=t.match(/(?:pay date|check date|payment date|date paid)\s*[:\-]?\s*(\d{1,2}\/\d{1,2}\/\d{4}|\d{4}-\d{2}-\d{2}|[A-Za-z]+\.?\s+\d{1,2},?\s+\d{4})/i);
  if(pd){out.payDate=paystubParseDateStr(pd[1]);if(out.payDate)out.found.push('Pay date')}
  const g=paystubMoneyOnLine(t,/gross\s+(pay|earnings|amount)|total\s+gross/i);
  if(g!=null){out.gross=g;out.found.push('Gross pay')}
  const n=paystubMoneyOnLine(t,/net\s+(pay|amount|earnings|check)|take[\s\-]?home/i);
  if(n!=null){out.net=n;out.found.push('Net pay')}
  const fq=t.match(/(?:pay frequency|frequency)\s*[:\-]?\s*(weekly|biweekly|bi-weekly|semi-monthly|semimonthly|monthly|every\s+2\s+weeks|twice\s+a\s+month)/i);
  if(fq)out.frequency=normalizePayFrequency(fq[1]);
  if(!out.frequency&&out.periodStart&&out.periodEnd)out.frequency=paystubFrequencyFromPeriod(out.periodStart,out.periodEnd);
  return out}
function paystubPreviewFromParsed(parsed,fileName,method,aiRead){const clean={agency:String(parsed.agency||'').trim(),facility:String(parsed.facility||'').trim(),frequency:normalizePayFrequency(parsed.frequency),periodStart:psValidISO(parsed.periodStart),periodEnd:psValidISO(parsed.periodEnd),payDate:psValidISO(parsed.payDate),gross:rateOrNull(parsed.gross)==null?'':String(rateOrNull(parsed.gross)),net:rateOrNull(parsed.net)==null?'':String(rateOrNull(parsed.net))};const pv={...clean,id:'',fileName:fileName||'',method:method||'',aiRead:!!aiRead,source:aiRead?'ai-vision':'text-parse',found:(parsed.found||[]).slice()};
  // Card binding (Nov 10, 2026): every read path (AI vision,
  // on-device, pasted text / PDF) funnels through here, so this is
  // the one place a card-started read picks up its facility. The
  // payer the stub itself names always wins; what the card supplies
  // is only what the stub left blank — the facility the schedule
  // belongs to, and, when the stub names no payer at all, the
  // facility's own name as the schedule's agency (the same default
  // an import-time schedule uses). The flags keep the preview
  // honest about which values came from the card, and stay on the
  // preview only — approvePaystub saves the plain record.
  if(paystubCardFacId){const f=(db.facilities||[]).find(x=>x.id===paystubCardFacId);if(f){pv.cardFacId=f.id;pv.cardFacName=f.name;if(!pv.facility){pv.facility=f.name;pv.facilityFromCard=true}if(!pv.agency){pv.agency=f.name;pv.agencyFromCard=true}}}
  if(paystubImportCtx){const c=paystubImportCtx;pv.importKind=c.kind;pv.importAgency=c.agency||'';pv.importFacility=c.facility||'';if(!pv.facility&&c.facility){pv.facility=c.facility;pv.facilityFromImport=true}if(!pv.agency&&c.agency){pv.agency=c.agency;pv.agencyFromImport=true}}
  return pv}
let paystubPreview=null,paystubError='',paystubStatus='',paystubBusy=false;
let paystubPendingImages=[];
// Pay-stub upload from a facility's own card (Nov 10, 2026, Caleb:
// "Under facilities I entered the pay rules but I would like to be
// able to upload the pay stub in that section as well."). One read
// pipeline, two front doors: the general panel below the cards and
// a section on each facility card. paystubCardFacId is the facility
// whose card started the CURRENT read/preview ('' = the general
// panel); paystubCardOpenFac is the card whose upload section is
// open. A card-started preview is BOUND to that facility: the stub
// read still names the payer, but the saved schedule's facility is
// the card's, so the read-time unification and the shift claims
// link it to that facility's shifts instead of floating as a
// second, unlinked schedule (the Nov 9 agency-string bug shape).
let paystubCardFacId='',paystubCardOpenFac='';
// The import-time sibling of the card binding (Nov 10, 2026): a
// stub read started inside an import preview's pay-schedule section
// binds to THAT import (paystubImportCtx = {kind, agency, facility}
// from the section). Exactly one read context is live at a time —
// starting a read from any surface clears the other bindings — and
// a preview renders only on the surface that started it.
let paystubImportCtx=null;
// Where a finished stub read lands (Nov 11, 2026, v131): a read
// started inside an import's pay-schedule section does NOT become
// a second, stacked preview form under the section's own fields
// (Caleb's live screenshots: the import form kept its prefill —
// agency "Holzer", no amounts — while a separate stub form below
// it held the stub's payer with frequency and period EMPTY, and
// the import's Save reads only the section's draft, so the stub's
// values could never reach it). ONE pay schedule = ONE form: the
// read lands IN the section's form — stub-stated values fill the
// draft (the payer wins for the agency, the facility stays
// linked, the frequency arrived derived from the period, the
// period dates ride along complete), the stub's gross/net appear
// in that same form as this check's actual, and the import's Save
// stores exactly ONE stub-backed schedule. Reads started from a
// facility card or the general panel land in the shared preview
// exactly as before.
function landPaystubPreview(pv){
  if(pv&&pv.importKind&&paystubImportCtx&&paystubImportCtx.kind===pv.importKind){
    const kind=pv.importKind;
    const p=kind==='cal'?calPreview:kind==='contract'?contractPreview:kind==='faccontract'?facilityContractPreview:schedulePreview;
    if(p){
      const d=p.paySchedDraft=p.paySchedDraft||{};
      const setD=(k,v)=>{if(v!=null&&String(v).trim()!=='')d[k]=String(v)};
      setD('agency',pv.agency);setD('facility',pv.facility);setD('frequency',pv.frequency);
      setD('payDate',pv.payDate);setD('periodStart',pv.periodStart);setD('periodEnd',pv.periodEnd);
      setD('gross',pv.gross);setD('net',pv.net);
      p.paySchedStub={source:pv.source||'text-parse',fileName:pv.fileName||'',found:(pv.found||[]).slice(),agencyFromImport:!!pv.agencyFromImport,facilityFromImport:!!pv.facilityFromImport,stubAgency:String(pv.agency||'').trim()};
      paystubPreview=null;
      paystubStatus='Read from your pay stub — its values are in the pay-schedule form above. Check them, then approve the import to save this one schedule.';
      return;
    }
  }
  paystubPreview=pv;
}
// The one note under the import section's form after a stub read
// (v131): where the values came from and how the schedule binds —
// the same honesty the stub preview form used to carry, now on
// the section itself.
function paySchedStubNote(preview){
  const d=(preview&&preview.paySchedDraft)||{};const stub=(preview&&preview.paySchedStub)||{};
  const agency=String(d.agency||'').trim(),facility=String(d.facility||'').trim();
  let bind='';
  if(stub.agencyFromImport)bind=`This stub didn't name a payer, so the schedule is saved under ${agency||'the agency on this import'} — the agency on this import — and its paychecks come from your ${facility||'these'} shifts.`;
  else if(agency&&facility&&paystubNameKey(agency)!==paystubNameKey(facility))bind=`This stub names ${agency} as the payer; the schedule is linked to ${facility}, so its paychecks are calculated from your ${facility} shifts.`;
  else bind=`This pay schedule is for ${facility||agency}.`;
  const amt=rateOrNull(d.gross)!=null?rateOrNull(d.gross):rateOrNull(d.net);
  const pd=psValidISO(d.payDate);
  return `Filled in from your pay stub${stub.fileName?` (${stub.fileName})`:''}. ${bind} Check the values above — saving this import saves this ONE pay schedule${amt!=null&&pd?`, and this check (${fmt(pd)}) counts as the actual ${currency(amt)} from the stub`:''}.`;
}
function paystubPreviewHTML(){
  if(paystubError)return `<p class="hint">${escapeHTML(paystubError)}</p>`;
  if(!paystubPreview)return '<p class="muted">No pay stub read yet. Upload a photo or PDF, or paste its text below, then check the preview — nothing is saved until you approve it.</p>';
  const p=paystubPreview;
  const ex=p.agency?paystubForAgency(p.agency):null;
  const replaces=ex&&ex.id!==p.id;
  // Card binding, stated plainly (Nov 10, 2026): which payer the
  // stub names, which card it was uploaded from, and which of the
  // values below the card supplied because the stub left them blank.
  let cardNote='';
  if(p.cardFacId){
    const fac=p.cardFacName||p.facility||'this facility';
    if(p.agencyFromCard)cardNote=`<p class="hint">Uploaded from the ${escapeHTML(fac)} card. This stub didn't name a payer, so the schedule is saved under ${escapeHTML(fac)} — the facility you uploaded it from — and its paychecks come from your ${escapeHTML(fac)} shifts.</p>`;
    else if(p.facilityFromCard&&paystubNameKey(p.agency)!==paystubNameKey(fac))cardNote=`<p class="hint">Uploaded from the ${escapeHTML(fac)} card. This stub names ${escapeHTML(p.agency)} as the payer; the schedule is linked to ${escapeHTML(fac)}, so its paychecks are calculated from your ${escapeHTML(fac)} shifts.</p>`;
    else cardNote=`<p class="hint">Uploaded from the ${escapeHTML(fac)} card — this pay schedule is for ${escapeHTML(fac)}.</p>`;
  }
  else if(p.importKind){
    const fac=p.importFacility||p.facility||'this facility';
    if(p.agencyFromImport)cardNote=`<p class="hint">Uploaded with this import. This stub didn't name a payer, so the schedule is saved under ${escapeHTML(p.agency)} — the agency on this import — and its paychecks come from your ${escapeHTML(fac)} shifts.</p>`;
    else if(p.facilityFromImport&&paystubNameKey(p.agency)!==paystubNameKey(fac))cardNote=`<p class="hint">Uploaded with this import. This stub names ${escapeHTML(p.agency)} as the payer; the schedule is linked to ${escapeHTML(fac)}, so its paychecks are calculated from your ${escapeHTML(fac)} shifts.</p>`;
    else cardNote=`<p class="hint">Uploaded with this import — this pay schedule is for ${escapeHTML(fac)}.</p>`;
  }
  return `<p><strong>Read from:</strong> ${escapeHTML(p.fileName||'pasted text')}</p><p><strong>Nothing is saved yet.</strong> Correct anything wrong below, then save. Fields the stub did not state are left blank — blank means “not stated”, never $0. ${p.found&&p.found.length?('Found: '+escapeHTML(p.found.join(', '))+'.'):''}</p>${replaces?`<p class="hint">This will replace the existing pay schedule for ${escapeHTML(p.agency)} — the old schedule is removed when you save. Other agencies are untouched.</p>`:''}${cardNote}<div class="form-grid"><div class="field"><label for="f_payPrev_agency">Agency / employer *</label><input id="f_payPrev_agency" class="paystubEdit" data-field="agency" type="text" value="${escapeHTML(p.agency||'')}" placeholder="e.g. Example Anesthesia Group"></div><div class="field"><label for="f_payPrev_facility">Facility (if the stub names one)</label><input id="f_payPrev_facility" class="paystubEdit" data-field="facility" type="text" value="${escapeHTML(p.facility||'')}" placeholder="e.g. Riverside General"></div><div class="field"><label for="f_payPrev_frequency">Pay frequency *</label><select id="f_payPrev_frequency" class="paystubEdit" data-field="frequency"><option value="">— choose —</option>${PAY_FREQUENCIES.map(f=>`<option value="${f}" ${f===p.frequency?'selected':''}>${PAY_FREQUENCY_LABELS[f]}</option>`).join('')}</select></div><div class="field"><label for="f_payPrev_payDate">Pay date (this check) *</label><input id="f_payPrev_payDate" class="paystubEdit" data-field="payDate" type="date" value="${escapeHTML(p.payDate||'')}"></div><div class="field"><label for="f_payPrev_periodStart">Pay period start</label><input id="f_payPrev_periodStart" class="paystubEdit" data-field="periodStart" type="date" value="${escapeHTML(p.periodStart||'')}"></div><div class="field"><label for="f_payPrev_periodEnd">Pay period end</label><input id="f_payPrev_periodEnd" class="paystubEdit" data-field="periodEnd" type="date" value="${escapeHTML(p.periodEnd||'')}"></div><div class="field"><label for="f_payPrev_gross">Gross on this stub ($)</label><input id="f_payPrev_gross" class="paystubEdit" data-field="gross" type="number" min="0" step="0.01" value="${escapeHTML(p.gross||'')}" placeholder="Not stated"></div><div class="field"><label for="f_payPrev_net">Net on this stub ($)</label><input id="f_payPrev_net" class="paystubEdit" data-field="net" type="number" min="0" step="0.01" value="${escapeHTML(p.net||'')}" placeholder="Not stated"></div></div><p class="muted">The amounts on this stub are the actual for this check's pay period only — they are never copied onto later checks. Later paychecks are calculated from your shifts in each period.</p><p class="muted" id="paystubNextDates">${escapeHTML(paystubNextDatesText(p))}</p><div class="toolbar" style="margin-top:12px"><button data-action="paystub-approve">Save pay schedule — I checked this</button><button type="button" class="secondary" data-action="paystub-discard">Discard preview (save nothing)</button></div>`;
}
function paystubListHTML(){
  const stubs=(db.payStubs||[]).slice().sort((a,b)=>String(a.agency||'').localeCompare(String(b.agency||'')));
  if(!stubs.length)return '<p class="muted">No pay stubs yet — optional. Add one per agency below and each agency gets its own estimated pay schedule on the calendar.</p>';
  const unifiedNote=paystubSchedules().length<stubs.length?'<p class="muted">Some schedules below are the same payer saved two ways (a pay schedule plus a pay stub). CRNA Hub treats them as one schedule — and the pay stub is always the default, so its check shows the stub amount, not an estimate.</p>':'';
  return unifiedNote+stubs.map(x=>{
    const eff=paystubSchedules().find(s=>s.id===x.id||(s.mergedFrom||[]).includes(x.id))||x;
    const dates=paystubNextPaydays(eff,3);
    const hasRhythm=!!(normalizePayFrequency(x.frequency)&&psValidISO(x.payDate));
    const src=x.source==='ai-vision'?'Read from pay stub with AI':x.source==='device-ocr'?'Read from pay stub on this device':x.source==='text-parse'?'Read from pasted text / PDF':x.source==='manual'?'Entered manually':'Saved pay schedule';
    return `<div class="item"><div><div class="item-title">${escapeHTML(x.agency||'Unnamed agency')}${x.facility?` <span class="muted">(${escapeHTML(x.facility)})</span>`:''}</div><div class="muted">${PAY_FREQUENCY_LABELS[x.frequency]||'Frequency not set'} · Last pay date ${x.payDate?fmt(x.payDate):'not set'}${x.periodStart&&x.periodEnd?` · Period ${fmt(x.periodStart)} – ${fmt(x.periodEnd)}`:''}</div><div class="muted">${(()=>{const act=paystubStubActual(x);return act?`This stub's own check (${x.payDate?fmt(x.payDate):'pay date not set'}): ${currency(act.amount)} ${act.basis} — the actual for its period. Every other paycheck is calculated from your shifts in that period.`:'No amount on this stub — every paycheck is calculated from your shifts in that period.'})()}</div><div class="muted">Next expected pay dates: ${dates.length?dates.map(z=>fmt(z)).join(' · '):(hasRhythm?'none coming up — a pay date appears when a pay period has shifts recorded':'set a pay frequency and pay date to see them')}</div><div class="muted">${escapeHTML(src)}${x.fileName?` · ${escapeHTML(x.fileName)}`:''}</div></div><div class="item-actions"><button class="tiny secondary" data-action="edit-paystub" data-id="${escapeHTML(x.id)}">Edit</button><button class="tiny danger" data-action="delete-paystub" data-id="${escapeHTML(x.id)}">Delete</button></div></div>`;
  }).join('');
}
// --- Pay stub on a facility's own card (Nov 10, 2026) ---
// The effective (unified) schedule that pays for a facility's
// shifts: the one whose own facility/agency resolves to it, or —
// for a stub that names only an outside payer (a Premier stub with
// the facility blank) — the one the read-time shift claims say is
// paying for this facility's shifts.
function paystubScheduleForFacility(f){
  if(!f)return null;
  const scheds=paystubSchedules();
  const own=scheds.find(s=>{const sf=paystubFacilityOf(s);return !!sf&&sf.id===f.id});
  if(own)return own;
  const claims=paystubShiftClaims();
  for(const x of (db.shifts||[])){
    if(!x||!x.id||!String(x.facility||'').trim())continue;
    const xf=facilityByNameOrAlias(x.facility);if(!xf||xf.id!==f.id)continue;
    const sid=claims.get(x.id);if(!sid)continue;
    const s=scheds.find(z=>z.id===sid||(z.mergedFrom||[]).includes(sid));
    if(s)return s;
  }
  return null;
}
// One-line card state (Nov 10, 2026): when a pay schedule is on
// file for this facility, the card says so the same way the rest
// of the app talks about it — payer, rhythm, next payday, and the
// stub's own actual when a stub backs it. Nothing new invented;
// the full list stays in the panel below the cards.
function facilityPaystubLineHTML(f){
  if(!featureOn('featurePaychecks'))return '';
  const s=paystubScheduleForFacility(f);if(!s)return '';
  const act=paystubStubActual(s);
  const next=paystubNextPaydays(s,1)[0]||'';
  return `<div class="muted">Pay schedule: ${escapeHTML(s.agency||'Unnamed agency')}${PAY_FREQUENCY_LABELS[s.frequency]?` · ${escapeHTML(PAY_FREQUENCY_LABELS[s.frequency])}`:''}${next?` · next payday ${fmt(next)}`:''}${act?` · pay stub on file — ${currency(act.amount)} actual for the ${fmt(s.payDate)} check`:''}</div>`;
}
// A preview belongs to exactly one surface: a card-started preview
// renders on its card, never duplicated here (the preview's fields
// carry fixed ids, so two copies would fight) — this panel points
// up at the card instead. A card read's error likewise stays on
// its card and is not repeated here.
function paystubPanelPreviewHTML(){
  if(paystubPreview&&paystubPreview.cardFacId){
    const f=(db.facilities||[]).find(x=>x.id===paystubPreview.cardFacId);
    return `<p class="muted">A pay stub preview is waiting on the ${escapeHTML(f?f.name:'facility')} card above — review it and save it there.</p>`;
  }
  if(paystubPreview&&paystubPreview.importKind){
    return `<p class="muted">A pay stub preview is waiting in the import preview — review it and save it there.</p>`;
  }
  if((paystubCardFacId||paystubImportCtx)&&paystubError)return '';
  return paystubPreviewHTML();
}
const PAYSTUB_TEXT_PLACEHOLDER='Employer: Example Anesthesia Group\nPay Period: 09/07/2026 - 09/20/2026\nPay Date: 09/29/2026\nGross Pay: $3,200.00\nNet Pay: $2,400.00';
const PAYSTUB_INTRO='One stub per agency — it sets the pay dates, and each paycheck is calculated from your shifts in that period. The stub itself is never stored.';
// ONE pay-stub upload component (Nov 10, 2026 — Caleb's rule: anywhere
// the app repeats a function it is ONE component that looks and feels
// the same everywhere). The general Facilities panel, every facility
// card, and every import pay-schedule section render THIS form — same
// labels, same layout, same "Read my pay stub" — and the same preview
// (paystubPreviewHTML). Surfaces differ only in the binding context a
// read starts from (see paystubPreviewFromParsed) and the note that
// states it.
function paystubUploadFormHTML(formAttrs,fileId,textId){
  return `<form ${formAttrs}><div class="form-grid"><div class="field"><label for="${fileId}">Choose a pay stub — photo or PDF (several photos for a multi-page stub)</label><input id="${fileId}" type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,.heic,image/*" multiple></div><div class="field wide"><label for="${textId}">Or paste the pay stub text</label><textarea id="${textId}" placeholder="${escapeHTML(PAYSTUB_TEXT_PLACEHOLDER)}"></textarea></div></div><div class="form-actions"><button type="submit">Read my pay stub</button></div></form>`;
}
// Card section (Nov 10, 2026): the same stub pipeline as the
// general panel — same reader, same preview, same approve — opened
// in place on the facility's own card. Collapsed to one button by
// default; a read started here binds its preview to this facility
// (see paystubPreviewFromParsed). With Paycheck estimates off the
// entry point collapses to the off line, like every other
// paycheck surface.
function paystubCardSectionHTML(f){
  if(!featureOn('featurePaychecks'))return `<div class="muted" style="margin-top:10px">Paycheck estimates are off. Your data is saved — turn it back on any time. <button type="button" class="secondary tiny" data-action="feature-toggle" data-id="featurePaychecks">Turn on</button></div>`;
  const mine=paystubCardFacId===f.id;
  const open=paystubCardOpenFac===f.id||(paystubPreview&&paystubPreview.cardFacId===f.id)||(mine&&(!!paystubError||!!paystubStatus||paystubBusy));
  // The stub upload is OPTIONAL and sits under its own
  // collapsible header saying so (Nov 11, 2026, v129 — Caleb:
  // "Upload a paystub under this section can be optional"),
  // the same collapse pattern as the general "Upload a pay
  // stub (optional)" panel: a tappable header, collapsed by
  // default, never a required step of saving pay rules. It
  // force-opens only while a card-started read is in flight
  // or waiting (status / preview / error), exactly as the old
  // toggle section did.
  return `<details class="collapse-sub paystub-card-panel" id="paystub-card-${escapeHTML(f.id)}"${open?' open':''}><summary class="collapse-head"><span class="collapse-title">Upload a pay stub (optional)</span><span class="collapse-chevron" aria-hidden="true">▾</span></summary><div class="item" style="display:block;margin-top:10px"><p class="muted">${PAYSTUB_INTRO}</p>${paystubUploadFormHTML(`class="paystubCardForm" data-fac="${escapeHTML(f.id)}"`,`f_paystubCardFile_${escapeHTML(f.id)}`,`f_paystubCardText_${escapeHTML(f.id)}`)}${mine&&paystubStatus?`<p class="hint">${escapeHTML(paystubStatus)}</p>`:''}${paystubPreview&&paystubPreview.cardFacId===f.id?`<div style="margin-top:14px">${paystubPreviewHTML()}</div>`:''}${mine&&!paystubPreview&&paystubError?`<p class="hint">${escapeHTML(paystubError)}</p>`:''}</div></details>`;
}
// The card stub panels are native <details>: a tap toggles
// them without a re-render, so render() snapshots the live
// open card back into paystubCardOpenFac first (the Features
// panel's v127 pattern) — a re-render never slams a panel the
// user just opened, nor resurrects one they just closed.
function capturePaystubCardPanelState(){try{for(const f of (db.facilities||[])){const el=document.getElementById('paystub-card-'+f.id);if(!el||typeof el.open!=='boolean')continue;if(el.open)paystubCardOpenFac=f.id;else if(paystubCardOpenFac===f.id)paystubCardOpenFac=''}}catch(e){}}
function paystubPanelHTML(){
  if(!featureOn('featurePaychecks'))return collapsePanelHTML('paystub-panel','Paycheck estimates',featureOffHTML('featurePaychecks'),false);
  const px=db.payStubs.find(x=>x.id===editId)||{};
  return collapsePanelHTML('paystub-panel','Upload a pay stub (optional)',`<p class="muted">${PAYSTUB_INTRO}</p>${paystubUploadFormHTML('id="paystubForm"','f_paystubFile','f_paystubText')}${paystubStatus?`<p class="hint" id="paystubStatus">${escapeHTML(paystubStatus)}</p>`:''}<div style="margin-top:14px">${paystubPanelPreviewHTML()}</div><h3>Saved pay schedules — one per agency</h3>${paystubListHTML()}<details class="collapse-sub" id="paystub-manual"${editId&&px.id?' open':''}><summary class="collapse-head"><span class="collapse-title">${editId&&px.id?'Edit pay schedule':'Add a pay schedule manually'}</span><span class="collapse-chevron" aria-hidden="true">▾</span></summary><form id="entryForm" data-kind="payStubs"><div class="form-grid">${field('agency','Agency / employer','text',px.agency||'','required')}${field('facility','Facility (if it applies)','text',px.facility||'')}${select('frequency','Pay frequency',PAY_FREQUENCIES,px.frequency||'')}${field('payDate','Pay date (this check)','date',px.payDate||'','required')}${field('periodStart','Pay period start','date',px.periodStart||'')}${field('periodEnd','Pay period end','date',px.periodEnd||'')}${field('gross','Gross on this check ($)','number',px.gross??'','min="0" step="0.01"')}${field('net','Net on this check ($)','number',px.net??'','min="0" step="0.01"')}</div><p class="muted">Amounts belong to this check only — later paychecks are calculated from your shifts.</p>${formEnd(editId&&px.id?'Save pay schedule':'Add pay schedule')}</details>`,!!(paystubPreview||paystubError||paystubStatus||(editId&&px.id)));
}
function paystubPaycheckLineHTML(x){
  if(x.isActual&&x.actualBasis==='entered')return `<div class="muted">${currency(x.actual)} actual · entered from calendar <span class="pill">actual</span></div>${x.shiftCount?`<div class="muted">Your shifts for ${fmt(x.periodStart)} – ${fmt(x.periodEnd)} added up to ${currency(paystubOccurrenceTotal(x))} — the amount you entered replaces the estimate for this check only.</div>`:`<div class="muted">No shifts recorded for ${fmt(x.periodStart)} – ${fmt(x.periodEnd)} — the amount you entered is counted for this check.</div>`}`;
  if(x.isActual)return `<div class="muted">${currency(x.actual)} actual · from pay stub <span class="pill">actual</span></div>${x.shiftCount?`<div class="muted">Your shifts for ${fmt(x.periodStart)} – ${fmt(x.periodEnd)} added up to ${currency(paystubOccurrenceTotal(x))} — the stub is the actual for this period.</div>`:`<div class="muted">No shifts recorded for ${fmt(x.periodStart)} – ${fmt(x.periodEnd)} — this is income the calendar didn't see, counted from the stub alone.</div>`}`;
  if(!x.shiftCount)return `<div class="muted">No shifts recorded for this pay period yet — its amount is calculated once shifts are on the calendar. <span class="pill">estimate</span></div>`;
  if(paystubOccurrenceTotal(x)===0&&(x.unpriced||0)>0&&(x.unpriced||0)>=(x.shiftCount||0))return `<div class="muted">Not priced yet — the ${x.shiftCount} shift${x.shiftCount===1?'':'s'} in this period need pay rules before this check can be estimated. <span class="pill">estimate</span></div>`;
  return `<div class="muted">Estimated ${currency(paystubOccurrenceTotal(x))} gross${paystubOccurrenceTotal(x)>x.gross?` · includes ${currency(paystubOccurrenceTotal(x)-x.gross)} from proposed shifts`:''} · <span class="pill">estimate</span></div>${x.unpriced?`<div class="muted">${x.unpriced} shift${x.unpriced===1?'':'s'} in this period ${x.unpriced===1?'is':'are'} not priced yet — this estimate may be low.</div>`:''}`;
}
// Short pay-period range for the condensed paycheck row:
// "Nov 2 – Nov 15" (the year is added only if the range crosses one).
function paystubRangeShort(x){if(!x||!psValidISO(x.periodStart)||!psValidISO(x.periodEnd))return '';const f=iso=>new Date(iso+'T12:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric'});return f(x.periodStart)+' – '+f(x.periodEnd)+(x.periodStart.slice(0,4)!==x.periodEnd.slice(0,4)?', '+x.periodEnd.slice(0,4):'')}
// One condensed paycheck row (Caleb, Nov 7, 2026): pay date, the
// pay-period range in parentheses beside it, then the total — slightly
// larger and bolder than the rest of the row and never pushed off the
// line (the date/range side shrinks first). The pill keeps actuals
// reading differently from estimates. Everything else about the check
// — agency, breakdown, corrections — lives in the paycheck editor a
// tap on the row opens.
function paycheckRowHTML(x,from){
  const amt=paystubOccurrenceAmount(x);
  const range=paystubRangeShort(x);
  return `<button type="button" class="paycheck-row" data-action="edit-paycheck" data-id="${escapeHTML(x.stubId)}" data-date="${escapeHTML(x.schedDate||x.date)}" data-from="${from||'panel'}" aria-label="Paycheck ${fmt(x.date)}, ${escapeHTML(x.agency)} — tap for detail"><span class="pc-date">${fmt(x.date)}${range?` <span class="pc-range">(${range})</span>`:''}</span><span class="pc-right"><span class="pc-total">${amt!=null?currency(amt):'—'}</span> <span class="pill">${x.isActual?'actual':'estimate'}</span></span></button>`;
}
// The day sheet's paycheck section (Nov 7, 2026 discoverability fix):
// the calendar-editing build DID put the condensed paycheck row in the
// day sheet, but it was an unlabelled tappable line — Caleb opened the
// sheet on a payday and reported "I don't see where I can edit a
// paycheck on that screen." So in the sheet the check gets its own
// labelled section, ABOVE the shift list: a "Paycheck" heading, the
// check in the same condensed format (pay date, period range in
// parentheses, prominent total, estimate/actual pill), the agency, and
// a visible "Edit paycheck" button that opens the same paycheck editor
// — stacked over the day sheet, returning to it on cancel. Days with
// no paycheck landing on them render no section at all.
function dayPaycheckSectionHTML(pays){
  if(!pays||!pays.length)return '';
  const rows=pays.map(x=>{
    const amt=paystubOccurrenceAmount(x);
    const range=paystubRangeShort(x);
    return `<div class="day-paycheck"><div class="day-paycheck-line"><span class="pc-date">${fmt(x.date)}${range?` <span class="pc-range">(${range})</span>`:''}</span><span class="pc-right"><span class="pc-total">${amt!=null?currency(amt):'—'}</span> <span class="pill">${x.isActual?'actual':'estimate'}</span></span></div><div class="muted">${escapeHTML(x.agency)}${x.facility?` (${escapeHTML(x.facility)})`:''}</div><button type="button" class="day-paycheck-edit" data-action="edit-paycheck" data-id="${escapeHTML(x.stubId)}" data-date="${escapeHTML(x.schedDate||x.date)}" data-from="day">Edit paycheck</button></div>`;
  }).join('');
  return `<div class="day-pays"><h3 class="day-pays-title">Paycheck</h3>${rows}</div>`;
}
// The paycheck editor (Nov 7, 2026): opened by tapping a paycheck row
// in Upcoming paychecks or in the calendar day sheet. Shows the
// calculated estimate with its breakdown, plus the two corrections a
// user actually needs — enter the real amount when the check differed,
// and move THIS check's pay date. Saved as a per-occurrence override
// on the stub record (see paystubOccurrenceOverride). A check backed
// by an uploaded stub cannot be corrected here: the stub is its
// source of truth, and the editor says so instead of fighting it.
function paycheckEditorHTML(x,from){
  if(!x)return '';
  const head=`<div class="paycheck-editor"><div class="item-title">${escapeHTML(x.agency)}${x.facility?` <span class="muted">(${escapeHTML(x.facility)})</span>`:''} · ${fmt(x.date)}</div>${x.dateOverridden?`<div class="muted">Pay date moved from ${fmt(x.schedDate)} — this check only.</div>`:''}${paystubPaycheckLineHTML(x)}`;
  if(x.stubBacked)return `${head}<p class="hint">This check comes from the pay stub you uploaded — the stub is the source of truth for it. To change the amount, update the stub under Pay schedules (Facilities tab).</p><div class="toolbar"><button type="button" class="secondary" data-action="paycheck-edit-cancel">Close</button></div></div>`;
  return `${head}<form data-kind="paycheck-edit"><input type="hidden" name="stubId" value="${escapeHTML(x.stubId)}"><input type="hidden" name="schedDate" value="${escapeHTML(x.schedDate||x.date)}"><div class="form-grid">${field('payDate','Pay date for this check','date',x.date)}${field('actual','Actual amount ($) — if the real check differed','number',x.enteredActual?String(x.actual):'','min="0" step="0.01" placeholder="Blank keeps the estimate"')}</div><p class="muted">This changes this check only — later checks keep the schedule's rhythm. To change the schedule itself, edit it in Facilities.</p><div class="form-actions"><button type="submit">Save this check</button><button type="button" class="secondary" data-action="paycheck-edit-cancel">Cancel</button></div></form>${x.enteredActual?`<div class="toolbar"><button type="button" class="secondary" data-action="paycheck-clear-actual" data-id="${escapeHTML(x.stubId)}" data-date="${escapeHTML(x.schedDate||x.date)}" data-from="${from||'panel'}">Use the calculated estimate instead</button></div>`:''}</div>`;
}
// Find one occurrence by its identity (stub + SCHEDULED payday),
// wherever a date correction has moved it to.
function paycheckOccurrenceByKey(stubId,schedDate){
  // Look the check up on the effective (unified) schedule, so the
  // editor sees the same occurrence the calendar showed — a merged
  // group's member id resolves to the group, too.
  const stub=paystubSchedules().find(s=>s.id===stubId||(s.mergedFrom||[]).includes(stubId));if(!stub||!psValidISO(schedDate))return null;
  return paystubOccurrences(stub,psAddDays(schedDate,-90),psAddDays(schedDate,90)).find(o=>(o.schedDate||o.date)===schedDate)||null;
}
// The paycheck editor opens as a sheet OVER whatever is beneath it
// (Nov 7, 2026 overlay model) — over the Dashboard from an Upcoming
// paychecks row, or stacked over the day sheet from the calendar;
// closing it returns to the day sheet when one is open.
function paycheckOverlayHTML(){
  if(!paycheckEdit)return '';
  const x=paycheckOccurrenceByKey(paycheckEdit.stubId,paycheckEdit.schedDate);
  if(!x)return '';
  return `<div class="sheet-backdrop sheet-backdrop-over" data-action="paycheck-edit-cancel"></div><div class="sheet sheet-over" role="dialog" aria-label="Paycheck detail">${paycheckEditorHTML(x,paycheckEdit.from)}</div>`;
}
// Delete confirmation for a shift (Nov 7, 2026): a sheet, not a
// browser confirm(), because a shift imported from the user's own
// calendar carries one extra choice at delete time — "Also remove it
// from my <calendar> calendar" — unticked by default and remembered
// per user. Without the tick, Delete is exactly the long-standing
// behaviour: removed here right away, its CRNA Hub calendar copy
// removed at the next sync, the import flagged so it does not come
// back, and the source calendar never touched.
function shiftDeleteOverlayHTML(){
  if(!shiftDeleteConfirm)return '';
  const x=(db.shifts||[]).find(s=>s.id===shiftDeleteConfirm.id);
  if(!x)return '';
  const src=shiftLiveCalendarSource(x);
  const line=src
    ?`Deleting removes it here and from your CRNA Hub calendar — your ${escapeHTML(src.calendarName)} calendar isn't touched, and it won't be imported again.`
    :'Deleting removes it here and from your CRNA Hub calendar right away.';
  const box=src?`<label class="delete-src-check"><input type="checkbox" id="f_deleteAlsoFromCalendar"${shiftDeleteConfirm.also?' checked':''}> <span>Also remove it from my ${escapeHTML(src.calendarName)} calendar</span></label>`:'';
  return `<div class="sheet-backdrop sheet-backdrop-over" data-action="shift-delete-cancel"></div><div class="sheet sheet-over" role="dialog" aria-label="Delete shift"><div class="sheet-head"><h2>Delete this shift?</h2><button type="button" class="sheet-close" data-action="shift-delete-cancel" aria-label="Close">×</button></div><p><strong>${fmt(x.date)}</strong> · ${escapeHTML(shiftFacilityLabel(x))} · ${escapeHTML(x.type||'')}</p><p class="muted">${line}</p>${box}<div class="toolbar"><button type="button" class="danger" data-action="shift-delete-confirm" data-id="${escapeHTML(x.id)}">Delete shift</button><button type="button" class="secondary" data-action="shift-delete-cancel">Cancel</button></div></div>`;
}
// Confirm a shift deletion. The remembered choice is saved whether
// or not the box was ticked (it is the default next time, still
// changeable on every delete). When the box IS ticked, the paired
// source event is deleted through the live-sync path FIRST; any
// failure — read-only connection, provider error — still completes
// the in-app delete and earns one honest line, never a block and
// never a false claim.
async function confirmShiftDelete(shiftId){
  const x=(db.shifts||[]).find(s=>s.id===shiftId);
  const alsoWanted=!!(shiftDeleteConfirm&&shiftDeleteConfirm.id===shiftId&&shiftDeleteConfirm.also);
  shiftDeleteConfirm=null;
  if(!x){render();return}
  const src=shiftLiveCalendarSource(x);
  const also=!!(src&&alsoWanted);
  if(src){db.settings=db.settings||{};db.settings.deleteAlsoFromCalendar=also;}
  let notice='';
  if(also){
    let ok=false;
    try{ok=!!(typeof window!=='undefined'&&typeof window.liveSyncDeleteSourceEvent==='function'&&await window.liveSyncDeleteSourceEvent(src.provider,shiftId))}catch(e){ok=false}
    if(!ok)notice='Removed here — couldn\'t remove it from '+src.calendarName+', so it may still show there.';
  }
  if(typeof window!=='undefined'&&typeof window.liveSyncRecordTombstone==='function')window.liveSyncRecordTombstone(shiftId);
  if(Array.isArray(db.mileage))db.mileage=db.mileage.filter(m=>!(m.status==='draft'&&mileageTripMatchesShift(m,x)));
  db.shifts=db.shifts.filter(s=>s.id!==shiftId);
  persist();
  cloudRecordTombstone('shifts',shiftId);
  render();
  // A deletion changes the calendar payload like any other shift
  // change — schedule the same silent push (Nov 7, 2026) instead of
  // waiting for the next app open to remove the CRNA Hub copy.
  if(typeof window!=='undefined'&&typeof window.liveSyncSchedulePush==='function')window.liveSyncSchedulePush();
  if(notice)alert(notice);
}
// Save/clear one per-occurrence paycheck correction. Stamps the stub's
// updatedAt and pushes the stub through the normal cloud save, so the
// correction syncs with the record and survives clear-device ->
// sign-in. A stub-backed check refuses here too (defense in depth —
// the editor never offers the fields for it).
function savePaycheckOverride(stub,patch){
  if(!stub||!patch||!patch.schedDate)return false;
  if(paystubStubBackedOccurrence(stub,patch.schedDate))return false;
  const ovs={...(stub.occOverrides&&typeof stub.occOverrides==='object'?stub.occOverrides:{})};
  const next={...(ovs[patch.schedDate]||{})};
  if('actual' in patch){if(patch.actual)next.actual=String(patch.actual);else delete next.actual}
  if('payDate' in patch){if(patch.payDate&&patch.payDate!==patch.schedDate)next.payDate=patch.payDate;else delete next.payDate}
  if(Object.keys(next).length)ovs[patch.schedDate]=next;else delete ovs[patch.schedDate];
  stub.occOverrides=ovs;stub.updatedAt=new Date().toISOString();
  persist();
  try{if(typeof cloudSaveKind==='function')cloudSaveKind('payStubs',stub.id)}catch(_){}
  return true;
}
function submitPaycheckEdit(e){
  e.preventDefault();
  const record=Object.fromEntries(new FormData(e.currentTarget));
  const stub=(db.payStubs||[]).find(s=>s.id===record.stubId);
  if(!stub){paycheckEdit=null;render();return}
  if(paystubStubBackedOccurrence(stub,record.schedDate)){alert('This check comes from the pay stub you uploaded — the stub is the source of truth for it. To change the amount, update the stub under Pay schedules (Facilities tab).');return}
  const amt=String(record.actual||'').trim();
  const parsed=amt?rateOrNull(amt):null;
  savePaycheckOverride(stub,{schedDate:record.schedDate,actual:(parsed!=null&&parsed>0)?String(parsed):'',payDate:psValidISO(record.payDate)||record.schedDate});
  paycheckEdit=null;render();
}
function paystubUpcomingHTML(){
  if(!featureOn('featurePaychecks'))return (db.payStubs||[]).length?featureOffHTML('featurePaychecks'):'';
  const stubs=db.payStubs||[];
  if(!stubs.length)return '';
  const up=paystubUpcoming(4);
  // Collapsible like every other panel (Nov 7, 2026): the collapsed
  // header still carries the next check — "Upcoming paychecks · next
  // Nov 24 — $27,075.00" — so collapsing never hides it. Open by
  // default: it's the fresh thing to check; the header collapses it
  // anytime.
  const next=up[0];
  const nextAmt=next?paystubOccurrenceAmount(next):null;
  const nextShort=next?new Date(next.date+'T12:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric'}):'';
  const title='Upcoming paychecks'+(next?` · next ${nextShort} — ${nextAmt!=null?currency(nextAmt):'—'}`:'');
  const inner=`${up.length?up.map(x=>paycheckRowHTML(x,'panel')).join(''):'<p class="muted">No upcoming paycheck could be worked out — check each stub has a pay frequency and a pay date (Facilities tab).</p>'}<details class="collapse-sub"><summary class="collapse-head"><span class="collapse-title">How paychecks are calculated</span><span class="collapse-chevron" aria-hidden="true">▾</span></summary><p class="muted">${PAYSTUB_DISCLAIMER}</p></details>`;
  return collapsePanelHTML('upcoming-paychecks',title,inner+featureTurnOffLineHTML('featurePaychecks'),true);
}

function persist(){try{localStorage.setItem(KEY,JSON.stringify(db))}catch(e){alert('Storage failed. Export a backup: '+e.message)}}
// Sheets close on swipe-down too (Nov 7, 2026): a downward drag that
// starts while the sheet is scrolled to its top dismisses the topmost
// sheet — the paycheck/shift editor first, then the day sheet — like
// the backdrop tap and the × button. Guarded: some embed/test
// contexts expose no document listener API.
if(typeof document!=='undefined'&&document.addEventListener){
  let sheetTouchY=null;
  document.addEventListener('touchstart',e=>{try{const sh=e.target&&e.target.closest?e.target.closest('.sheet'):null;sheetTouchY=(sh&&sh.scrollTop<=0&&e.touches&&e.touches[0])?e.touches[0].clientY:null}catch(_){sheetTouchY=null}},{passive:true});
  document.addEventListener('touchend',e=>{if(sheetTouchY==null)return;const dy=(e.changedTouches&&e.changedTouches[0]?e.changedTouches[0].clientY:sheetTouchY)-sheetTouchY;sheetTouchY=null;if(dy>72){if(paycheckEdit){paycheckEdit=null;render()}else if(shiftDeleteConfirm){shiftDeleteConfirm=null;render()}else if(dayViewOpen){dayViewOpen=false;render()}}},{passive:true});
}
// Assistant sheet vs the iOS keyboard (Nov 7, 2026): when the software
// keyboard opens, the visual viewport shrinks — pin the sheet's height
// to the visible viewport so the question input stays above the
// keyboard instead of hiding behind it. No-op where visualViewport
// is unavailable and whenever the sheet is closed.
if(typeof window!=='undefined'&&window.visualViewport&&typeof document!=='undefined'&&document.addEventListener){
  const vvSync=()=>{try{const sh=document.querySelector('.assistant-sheet');if(sh)sh.style.maxHeight=assistantSheetOpen?Math.max(280,Math.round(window.visualViewport.height*0.92))+'px':'';}catch(_){}};
  window.visualViewport.addEventListener('resize',vvSync);
  document.addEventListener('focusin',e=>{if(e.target&&e.target.id==='assistantInput')setTimeout(vvSync,60)});
}
function setTab(t){onboardStep=0;assistantSheetOpen=false;tab=t;editId=null;showShiftForm=false;dayViewOpen=false;render();window.scrollTo(0,0)}
function moveMonth(n){month=new Date(month.getFullYear(),month.getMonth()+n,1);render()}
function selectDay(d){selected=d;tab='Dashboard';editId=null;showShiftForm=false;dayViewOpen=true;render()}
// --- Credentialing helpers (NBCRNA / AANA / state licenses) ---
// Data shape is intentionally Supabase-ready: these local records map to
// future tables nbcrna_profiles, aana_memberships, licenses and ce_records,
// each with a user_id (added at auth time). Nothing here is verified yet.
const US_STATES=['Alabama','Alaska','Arizona','Arkansas','California','Colorado','Connecticut','Delaware','District of Columbia','Florida','Georgia','Hawaii','Idaho','Illinois','Indiana','Iowa','Kansas','Kentucky','Louisiana','Maine','Maryland','Massachusetts','Michigan','Minnesota','Mississippi','Missouri','Montana','Nebraska','Nevada','New Hampshire','New Jersey','New Mexico','New York','North Carolina','North Dakota','Ohio','Oklahoma','Oregon','Pennsylvania','Rhode Island','South Carolina','South Dakota','Tennessee','Texas','Utah','Vermont','Virginia','Washington','West Virginia','Wisconsin','Wyoming'];
function daysUntil(dateStr){if(!dateStr)return null;const d=new Date(dateStr+'T12:00:00');if(Number.isNaN(d.getTime()))return null;const today=new Date(localDate(new Date())+'T12:00:00');return Math.round((d-today)/864e5)}
function parseReminders(s){const v=String(s||'90,60,30,7').split(',').map(x=>parseInt(x.trim(),10)).filter(x=>Number.isFinite(x)&&x>=0);return v.length?v:[90,60,30,7]}
function deadlineStatus(days){if(days===null)return null;if(days<0)return 'EXPIRED';return 'due'}
function portalLink(url){const u=String(url||'').trim();if(!u)return '';if(/^https?:\/\//i.test(u))return `<a href="${escapeHTML(u)}" target="_blank" rel="noopener">Official portal</a>`;return escapeHTML(u)}
function collectDeadlineItems(){
  const items=[];
  const add=(label,date,reminders,source)=>{const days=daysUntil(date);if(days===null)return;items.push({label,date,days,source,reminders})};
  const n=db.nbcrna||{};add('NBCRNA certification',n.renewalDeadline||n.periodEnd,n.reminders,'NBCRNA');
  const a=db.aana||{};add('AANA membership',a.expiration,a.reminders,'AANA');
  (db.licenses||[]).forEach(x=>add((x.state||'License')+' '+(x.type||''),x.expiry,x.reminders,'State license'));
  (db.documents||[]).forEach(x=>add((x.certType||'Certification')+' certification',x.expiry,'90,60,30,7','Certification document · standard 3-month (90-day) reminder · '+(x.expirySource==='extracted'?'expiration extracted from document':x.expirySource==='user-entered'?'expiration entered manually':'no expiration found')));
  (db.credentials||[]).forEach(x=>add(x.name||'Credential',x.expiry,'90,60,30,7','Credential'));
  return items;
}
// The same real-world deadline can be recorded twice — e.g. an ACLS
// expiration both as an uploaded certification document ("ACLS
// certification") and as a hand-entered credential ("ACLS"). One
// deadline must count once everywhere it is presented.
function deadlineDedupeKey(x){return String(x.date||'')+'|'+String(x.label||'').toLowerCase().replace(/\s+/g,' ').replace(/\s+(certification|membership)$/,'').trim()}
function dedupeDeadlines(items){const seen=new Set(),out=[];for(const x of items){const k=deadlineDedupeKey(x);if(seen.has(k))continue;seen.add(k);out.push(x)}return out}
function credentialDeadlines(){
  const items=collectDeadlineItems().filter(x=>x.days<0||parseReminders(x.reminders).some(w=>x.days<=w));
  return dedupeDeadlines(items).sort((a,b)=>a.date.localeCompare(b.date));
}
// Dashboard stat (Nov 7, 2026): credential AND certification deadlines
// due within 90 days — one deduped count on the plain 90-day window the
// card label promises (per-record reminder settings govern the reminder
// list, not this headline number). Expired items count, as before.
function deadlinesWithin90(){
  return dedupeDeadlines(collectDeadlineItems().filter(x=>x.days<=90)).sort((a,b)=>a.date.localeCompare(b.date));
}
function credentialDeadlinesPanel(){
  const items=credentialDeadlines();
  return `<section class="panel"><h2>Credential & certification deadlines</h2><p class="muted">Deadlines from your records — portal-pulled records are labelled with their source on the Credentials tab; the rest are user-entered, not verified. <a href="https://www.nbcrna.com/" target="_blank" rel="noopener">NBCRNA</a> · <a href="https://www.aana.com/" target="_blank" rel="noopener">AANA</a></p>${items.length?items.map(x=>`<div class="item"><strong>${escapeHTML(x.label)}</strong> · ${fmt(x.date)} <span class="${x.days<0?'expired':x.days<=7?'expired':x.days<=30?'warning':'success'}">${x.days<0?('Expired '+Math.abs(x.days)+' days ago'):(x.days===0?'Due today':('Due in '+x.days+' days'))}</span><div class="muted">${escapeHTML(x.source)}</div></div>`).join(''):'<p class="muted">No credential deadlines within their reminder windows.</p>'}</section>`;
}
function ceTotal(records,type){return records.filter(r=>!type||r.class===type).reduce((s,r)=>s+num(r.credits),0)}
function ceForm(kind,label,record){
  return `<form data-kind="${kind}"><div class="form-grid">${field('title','Course / activity','text',record.title||'','required')}${field('date','Date','date',record.date||localDate(new Date()))}${field('credits','Credits','number',record.credits??'','min="0" step="0.25"')}${kind==='nbcrnaCE'?select('class','Class',['Class A','Class B','Other'],record.class||'Class A'):field('note','Notes','text',record.note||'')}</div>${formEnd(editId?'Save CE record':'Add CE record')}</form>`;
}

// --- Ask Assistant: deterministic answer engine (FALLBACK) ---
// This is the OFFLINE / fallback engine only — the live model is
// askAssistantLive()/callAssistantChat() below. No network calls, no
// third-party AI service, no API key anywhere in this function. Answers
// about the user's own records are computed from the data already loaded
// in `db` (localStorage). Anything not in `db` is reported as missing,
// never invented. Facility notes are never quoted in answers (they may
// hold authorized facility codes), and no passwords or patient
// information are stored or shown here. A reply produced by this engine
// is labelled "On-device answer" in the chat, never presented as live.
const ASSISTANT_STARTERS=['Ask the assistant to check my portals','What is the assistant monitoring?','How can CRNA Hub help me?','What shifts do I have coming up?',"What's my projected income this month?",'What credentials are expiring soon?'];
// Quick prompts shown at the top of the floating assistant sheet
// (Nov 7, 2026): short forms of the everyday questions, asked through
// the exact same askAssistantLive() path as the Assistant tab starters
// — one assistant, one conversation, no second engine.
const ASSISTANT_QUICK_CHIPS=["What's my next paycheck?","What do I make this month?","What's expiring soon?","What shifts do I have coming up?"];
function assistantClinical(q){return /\b(patient|diagnos|treatment|prescri|dosage|\bdose\b|drug interaction|intubat|airway management|anesthet\w+ (for|plan|technique)|clinical decision|symptom|disease)\b/i.test(q)}
function assistantUpcoming(){const now=localDate(new Date());return db.shifts.filter(x=>x.date>=now).sort((a,b)=>a.date.localeCompare(b.date))}
function assistantMonthShifts(){const prefix=localDate(new Date()).slice(0,7);return db.shifts.filter(x=>x.date?.startsWith(prefix))}
function answerQuestion(raw){
  const q=String(raw||'').trim();if(!q)return 'Ask me something — try one of the suggested questions below.';
  const l=q.toLowerCase();
  if(assistantClinical(q))return 'I can\'t answer clinical questions — CRNA Hub is an administrative assistant, not clinical decision support, and it holds no patient information. For a clinical question, check your facility protocols, a current clinical reference, or a qualified colleague. I can help with scheduling, income, credentials, and mileage instead.';
  if(/help me|what (can|does) (this|crna hub)|how (do|does) (this|crna hub|it) work|getting started|what is crna hub/.test(l))return 'CRNA Hub is your schedule, income, and professional life in one place. Use the Dashboard calendar to see shifts and expected gross, the Dashboard Add shift button to add shifts, Facilities to store each hospital and its rates, Credentials for NBCRNA, AANA, and state licenses with 90/60/30/7-day reminders, Mileage to log and export business trips. When you are signed in, your records sync to your account automatically; signed out, everything is stored on this device only, so export backups regularly.';
  if(/\b(w-2|1099|employment type|how (am i|do i get) paid)\b/.test(l)){const t=employmentType();if(!t)return 'No employment type is set yet — pick W-2, 1099, or both on the Account tab (onboarding step 1). It drives the income totals: W-2 salary days are never double-counted, 1099 shifts price from contracts and facilities, and hybrid does both.';return `Employment type: ${employmentTypeLabel()}${t==='w2'?' — your pay comes as salary, so per-shift totals do not apply here and no shift counts as billable income; Off / PTO days are salary days.':t==='1099'?' — shifts price from your contracts and facilities; Off / PTO days are W-2 salary days and are excluded from every total, never double-counted.':' — W-2 salary days are excluded from every total and never double-counted; 1099 shifts price from your contracts and facilities.'} Change it on the Account tab.`}
  if(/pay ?stub|paycheck|next (pay|paycheck)|when (do|will) i get paid|pay ?day/.test(l)){const up=paystubUpcoming(6);if(!(db.payStubs||[]).length)return 'No pay stubs are saved yet — upload one per agency on the Facilities tab and the app will read the pay frequency and pay date and show each agency\'s estimated paychecks on the calendar. A stub is optional; facilities work without one.';if(!up.length)return 'Pay stubs are saved, but no upcoming paycheck could be worked out — check that each stub has a pay frequency and a pay date on the Facilities tab.';return `Next paychecks, one per agency — each is calculated from your shifts in its pay period; a check whose pay stub you uploaded shows the stub's actual amount. Always double-check against your actual paystubs; CRNA Hub is not liable for mistakes: ${up.map(x=>x.isActual?`${fmt(x.date)} — ${x.agency}${x.facility?` (${x.facility})`:''} · ${currency(x.actual)} actual (${x.actualBasis==='entered'?'entered from the calendar':'from your pay stub'})`:x.shiftCount?`${fmt(x.date)} — ${x.agency}${x.facility?` (${x.facility})`:''} · est. ${currency(paystubOccurrenceTotal(x))} gross from your shifts${x.unpriced?` (${x.unpriced} shift(s) not priced yet — may be low)`:''}`:`${fmt(x.date)} — ${x.agency}${x.facility?` (${x.facility})`:''} · no shifts recorded for that period yet`).join('; ')}.`}
  if(/shift.*(coming|upcoming|next)|upcoming shift/.test(l)){const up=assistantUpcoming();if(!up.length)return 'You have no upcoming shifts recorded on this device. Add one from the Dashboard, or import a schedule CSV.';const top=up.slice(0,5),total=up.filter(isBillableShift).reduce((s,x)=>s+num(x.pay),0),conf=up.filter(x=>isBillableShift(x)&&['confirmed','completed'].includes(normalizeShiftStatus(x.status))).reduce((s,x)=>s+num(x.pay),0);return `You have ${up.length} upcoming shift(s) recorded, worth ${currency(total)} in expected gross (proposed-inclusive; ${currency(conf)} of that is confirmed). Next up: ${top.map(x=>`${fmt(x.date)} at ${x.facility} (${x.type}, ${x.pay===''||x.incomplete?'pay not yet priced':currency(x.pay)}, ${shiftStatusLabel(x.status)})`).join('; ')}${up.length>5?` — plus ${up.length-5} more.`:''}`}
  if(/this year|year.*(income|gross|earn|pay)|income.*year|annual (income|gross|pay)|how much.*year/.test(l)){const y=currentYear(),cur=shiftsForYear(y);if(!cur.length)return `No shifts are recorded for ${y} yet, so I can't project this year's income. Add shifts or import a CSV, and this answer will use them.`;const split=yearIncomeSplit(y);return `Income for ${y}, from recorded shifts only — two totals, same split as the Dashboard: C (confirmed only) ${currency(split.c.ytd)} year to date and ${currency(split.c.predicted)} predicted annual; P (proposed-inclusive — C plus proposed shifts you might pick up) ${currency(split.p.ytd)} year to date and ${currency(split.p.predicted)} predicted annual. None of these is paid income — they are estimates from scheduled shifts. Shifts from other years are not included.${split.unpriced?` ${split.unpriced} shift(s) in ${y} are unpriced and are not included in either total.`:''}${split.w2Salary?` ${split.w2Salary} W-2 salary day(s) are excluded — paid through W-2 salary, never double-counted.`:''}`}
  if(/income|projected|earn|gross|pay.*month|this month/.test(l)){const cur=assistantMonthShifts();if(!cur.length)return 'No shifts are recorded for this month, so I can\'t project income yet. Add shifts or import a CSV, and this answer will use them.';const prefix=localDate(new Date()).slice(0,7);const m=monthIncomeSplit(prefix);const head=monthHeadline(prefix);const by={};cur.filter(x=>isBillableShift(x)&&['confirmed','completed'].includes(normalizeShiftStatus(x.status))).forEach(x=>{by[x.facility||'Unknown']=(by[x.facility||'Unknown']||0)+num(x.pay)});const byFac=`By facility (confirmed only): ${Object.keys(by).length?Object.entries(by).map(([f,v])=>`${f} ${currency(v)}`).join('; '):'no confirmed shifts yet'}`;const unpricedNote=m.unpriced?` ${m.unpriced} shift(s) this month are unpriced and are not included in any total.`:'';if(head.scheduled)return `Expected gross this month: ${currency(head.gross)} — the Dashboard headline, on the paycheck basis: the paychecks landing this month${head.anyActual?', including the actual amount from your pay stub':''}${head.partial?`, plus ${currency(head.worked)} from shifts not on a pay schedule`:''}. The shifts themselves split C (confirmed only) ${currency(m.c)}; P (proposed-inclusive) ${currency(m.p)}, across ${cur.length} shift(s). ${byFac}.${unpricedNote}`;return `Projected income this month, from recorded shifts only — two totals, same split as the Dashboard: C (confirmed only) ${currency(m.c)}; P (proposed-inclusive) ${currency(m.p)}, across ${cur.length} shift(s). ${byFac}. None of these is paid income.${unpricedNote}`}
  if(/check (my )?(portal|nbcrna|aana|license)|portal check|ask.*assistant.*(nbcrna|aana|license|portal)/.test(l))return 'One tap: tap “I signed in — check it” on the portal’s Connect card (or a Check button below), then show me the page that lists your record — I read it and show you the report, and nothing is saved until you approve it.';
  if(/monitor|watch.*portal|what.*(monitoring|watching)|active.*check|check.*(weekly|regular|automatic|automatically)/.test(l)){const mons=ensurePortalMonitoring(),today=localDate(new Date()),due=mons.filter(m=>monitorIsDue(m,today));return `Portal monitoring — the assistant watches NBCRNA, AANA, and your state licenses on a schedule, not just when you ask. ${mons.map(m=>`${m.label}: last checked ${m.lastChecked?String(m.lastChecked).slice(0,10):'never'}, next due ${monitorNextDue(m,today)}, ${m.enabled?(monitorIsDue(m,today)?'due now':'on schedule'):'paused'}, last outcome ${m.lastOutcome||'not checked yet'}`).join('; ')}.${due.length?` ${due.length} check(s) are due — sign in from the prompt on the Credentials tab and the guided check runs.`:''} Public checks run automatically where the source allows it; private portals run when you sign in yourself, and the assistant prompts you when a sign-in is due.`;}
  if(/credential|license|nbcrna|aana|expir/.test(l)){const d=credentialDeadlines();if(!d.length)return 'No credential or certification deadlines are inside their reminder windows right now, based on the records on this device. Check the Credentials tab to confirm your NBCRNA, AANA, state license, and certification dates are entered.';return `Credentials & certifications needing attention: ${d.slice(0,8).map(x=>`${x.label} — ${fmt(x.date)} (${x.days<0?('expired '+Math.abs(x.days)+' days ago'):x.days===0?'due today':('due in '+x.days+' days')})`).join('; ')}. Records a portal pull brought back are labelled with their source; the rest are user-entered and not verified by NBCRNA, AANA, or a state board.`}
  if(/mileage|miles|trip/.test(l)){if(!db.mileage.length)return 'No mileage trips are logged yet. Log one from the Mileage tab, or generate schedule-based drafts there and confirm each trip.';const total=verifiedMileageTotal(),verified=verifiedMileageTrips().length,draft=db.mileage.filter(x=>x.status==='draft').length;return `Mileage on this device: ${total.toFixed(1)} verified miles across ${verified} confirmed trip(s), including ${draft} draft(s) still needing confirmation (drafts are not counted until the weekly review confirms them). Mileage defaults to ${tripTypeLabel(mileageTripType())}, and each trip shows whether it is round trip or one way — a round-trip trip is counted once, never doubled. Drafts are not verified trips — confirm the trip occurred and the actual miles before using them.`}
  if(/facilit|hospital/.test(l)){if(!db.facilities.length)return 'No facilities are saved yet. Add one from the Facilities tab with its rates, and shifts can then use those rates.';return `You have ${db.facilities.length} facilit(ies) saved: ${db.facilities.map(f=>`${f.name} (8h ${currency(f.rate8)}, 24h ${currency(f.rate24)}, 2nd call ${currency(f.rateSecond)})`).join('; ')}. I don't quote facility notes here, since they may hold authorized facility codes.`}
  if(/contract|rate|pay.*(shift|call|hour)/.test(l))return 'Each facility stores a flat rate for 8-hour, 24-hour, and second-call shifts. The Facilities tab has a contract import (text, CSV text, .ics, and text-based PDF): it parses facility names, dates, shift types, and stated rates, shows a preview for your approval, and links approved shifts to a saved contract record. Contract pictures are read with “Read with AI” (recommended) on the Facilities tab and show the same preview for your approval. On-device reading is the fallback for when you have no connection — less accurate on rate tables.';
  if(/ce |continuing education|credits/.test(l)){const a=ceTotal(db.nbcrnaCE,'Class A'),b=ceTotal(db.nbcrnaCE,'Class B'),n=db.nbcrna||{},aa=db.aana||{};return `CE recorded here — NBCRNA: ${a} Class A and ${b} Class B credits from ${db.nbcrnaCE.length} record(s); MAC Ed ${n.macEd||0} of ${n.macEdRequired||60}, MAC Dev ${n.macDev||0} of ${n.macDevRequired||40}. AANA: ${ceTotal(db.aanaCE)} credits from ${db.aanaCE.length} record(s). These are user-entered totals, not a live AANA/NBCRNA transcript.`}
  if(/sync|cloud|supabase|account|sign ?in|backup/.test(l))return cloudAssistantAnswer();
  if(/c\/p|confirmed|proposed|forecast/.test(l)){const y=currentYear(),split=yearIncomeSplit(y);return `Income split for ${y} — C (confirmed only) ${currency(split.c.ytd)} year to date, ${currency(split.c.predicted)} predicted annual; P (proposed-inclusive — C plus proposed shifts you might pick up) ${currency(split.p.ytd)} year to date, ${currency(split.p.predicted)} predicted annual. Tap a shift's day on the Dashboard calendar to change its status, and these totals re-price immediately. None of these is paid income.${split.unpriced?` ${split.unpriced} shift(s) in ${y} are unpriced and are not included in any total.`:''}`}
  return 'I can answer from what is actually recorded on this device: upcoming shifts, this month\'s projected income, upcoming paychecks (estimates from pay stubs), credentials expiring soon, facilities and their rates, mileage, and CE totals — plus how CRNA Hub itself works. Try one of the suggested questions, or ask about one of those topics. I won\'t guess at records that aren\'t here, and I don\'t answer clinical questions.';
}
// --- Ask Assistant: live AI model FIRST, deterministic answers as fallback ---
// FINAL native-app form. The Assistant is a live AI model reached through
// the `assistant-chat` Supabase Edge Function (gpt-4o-mini, key server-side
// only — see supabase/functions/assistant-chat/index.ts), called through
// the same-origin proxy (api/fn.js) with the user's own Supabase auth
// token — the same pattern as extract-contract. The model gets ONLY the
// user's question plus a minimal structured summary built by
// buildAssistantSummary(): counts, totals, and the next few shifts —
// never facility notes/codes, never shift notes, never documents, never
// patient information, never passwords, never addresses or emails.
//   * Live answer: the model answers from that summary; the reply is
//     labelled "Live AI" in the chat.
//   * Fallback: when the model is unavailable (not signed in, key not
//     set, function not deployed, network error, or the client rate
//     limit below), the deterministic answerQuestion() answers from the
//     records on this device, and the reply is labelled "On-device
//     answer" with a note that the live model was unavailable. The
//     fallback never pretends to be live.
//   * The deterministic engine stays as the fallback and as the offline
//     path — it is not removed, and it is never presented as a live model.
// Rate limits: the client sends at most one live call per 10 seconds and
// never more than one in flight (ASSISTANT_MIN_INTERVAL_MS /
// assistantChatBusy); the Edge Function enforces its own best-effort
// per-user throttle (1 per 10s, 30 per rolling hour) and documents the
// durable per-user cap (assistant_chat_log table) as final-only, not
// yet built. No clinical advice: the model is instructed to refuse
// clinical questions, and answerQuestion() refuses them locally too.
// The finished native app runs this same path with background execution;
// this web preview runs it while the app is open.
const ASSISTANT_MODEL='gpt-4o-mini';
const ASSISTANT_MAX_QUESTION_CHARS=500;
const ASSISTANT_MIN_INTERVAL_MS=10000;
let assistantChatBusy=false,assistantChatLastLiveAt=0;
let assistantSheetOpen=false;
// Minimal structured summary for the live model. Numbers and counts only,
// built from the same helpers the deterministic answers use. Deliberately
// EXCLUDED, by construction (no such field is ever read here): facility
// notes, shift notes, document text or filenames, facility codes,
// passwords, patient information, addresses, emails, phone numbers.
function buildAssistantSummary(){
  const now=localDate(new Date());
  const month=assistantMonthShifts();
  const y=currentYear();
  const split=yearIncomeSplit(y);
  const monthIncome=monthIncomeSplit(now.slice(0,7));
  const monthHead=monthHeadline(now.slice(0,7));
  const byFacility={};
  month.filter(isBillableShift).forEach(x=>{const f=x.facility||'Unknown';byFacility[f]=(byFacility[f]||0)+num(x.pay)});
  return {
    today: now,
    profile:{name: profileName(), employmentType: employmentType()||null, monthlyIncomeGoal: monthlyIncomeGoal()},
    month:{label: now.slice(0,7), shiftCount: month.length, gross: monthHead.gross, basis: monthHead.scheduled?'paycheck':'worked', confirmed: monthIncome.c, proposedInclusive: monthIncome.p, monthlyIncomeGoal: monthlyIncomeGoal(), byFacility: Object.entries(byFacility).map(([facility,gross])=>({facility,gross}))},
    year:{year: y, ytd: split.ytd, predicted: split.predicted, futureCount: split.futureCount, futureGross: split.futureGross, unpriced: split.unpriced||0, w2Salary: split.w2Salary||0, c:{ytd: split.c.ytd, predicted: split.c.predicted}, p:{ytd: split.p.ytd, predicted: split.p.predicted}},
    upcoming: assistantUpcoming().slice(0,5).map(x=>({date:x.date, facility:x.facility||'', type:x.type||'', pay: (x.pay===''||x.pay==null)?null:num(x.pay)})),
    credentials: credentialDeadlines().slice(0,8).map(x=>({label:x.label, date:x.date, days:x.days})),
    facilities: (db.facilities||[]).map(f=>({name:f.name||'', rate8: num(f.rate8)||null, rate24: num(f.rate24)||null, rateSecond: num(f.rateSecond)||null})),
    mileage:{verifiedMiles: verifiedMileageTotal(), verifiedTrips: verifiedMileageTrips().length, drafts: (db.mileage||[]).filter(x=>x.status==='draft').length},
    ce:{nbcrnaClassA: ceTotal(db.nbcrnaCE,'Class A'), nbcrnaClassB: ceTotal(db.nbcrnaCE,'Class B'), macEd: num((db.nbcrna||{}).macEd), macDev: num((db.nbcrna||{}).macDev), aanaCredits: ceTotal(db.aanaCE)}
  };
}
// One live call: question + minimal summary -> assistant-chat Edge Function
// via the same-origin proxy. Throws on any failure; the caller falls back.
async function callAssistantChat(question){
  const q=String(question||'').trim();
  if(!q)throw new Error('empty_question');
  if(q.length>ASSISTANT_MAX_QUESTION_CHARS)throw new Error('question_too_long');
  if(!SUPABASE_CONFIGURED)throw new Error('Supabase is not configured yet.');
  if(!cloudSession)throw new Error('Not signed in — sign in on the Account tab first.');
  const data=await liveSyncPost('assistant-chat',{action:'chat', question:q, summary:buildAssistantSummary()});
  if(!data||data.ok===false)throw new Error((data&&data.message)||(data&&data.error)||'Assistant unavailable.');
  if(typeof data.answer!=='string'||!data.answer.trim())throw new Error('Assistant answered without text.');
  return data.answer.trim();
}
// Ask the assistant: live model first, deterministic fallback on any failure.
// The user's question is stored immediately with a "Thinking…" placeholder
// (source 'pending'), then the placeholder is replaced in place by the real
// answer — labelled 'live' or 'local'. Nothing here ever claims a local
// answer came from the model.
async function askAssistantLive(raw){
  const q=String(raw||'').trim();if(!q)return;
  if(assistantChatBusy)return;
  assistantChatBusy=true;
  db.assistantChat=[...(db.assistantChat||[]),{role:'user',text:q}].slice(-50);
  const pending={role:'assistant',text:'Thinking…',source:'pending'};
  db.assistantChat=[...db.assistantChat,pending].slice(-50);
  persist();render();
  let answer=null,source='local';
  try{
    if(Date.now()-assistantChatLastLiveAt<ASSISTANT_MIN_INTERVAL_MS)throw new Error('rate_limited_client');
    answer=await callAssistantChat(q);
    assistantChatLastLiveAt=Date.now();source='live';
  }catch(e){
    answer=answerQuestion(q)+'\n\n— Live AI was unavailable, so this is the on-device answer from your records.';
    source='local';
  }finally{assistantChatBusy=false}
  const hist=db.assistantChat||[];
  const i=hist.lastIndexOf(pending);
  if(i>-1)hist[i]={role:'assistant',text:answer,source};
  else hist.push({role:'assistant',text:answer,source});
  db.assistantChat=hist.slice(-50);
  persist();render();
  const box=document.querySelector('.chat');if(box)box.scrollTop=box.scrollHeight;
}
// --- Assistant-driven portal checks ---
// The portal check is the assistant's job, for every user — not a background
// server scraper and not a personal service. The flow, per source:
//   1. The assistant explains it, and the user signs in to the portal
//      THEMSELVES. Finished native app: Apple's system sign-in sheet, so
//      iPhone Passwords + Face ID fill the login. This web preview: the
//      portal opens in a new tab and the user signs in there.
//   2. The user shows the assistant the record page — a screenshot, or the
//      copied text. Pictures are read on this device with OCR (Tesseract.js,
//      loaded only when a picture is chosen); nothing is sent to a server
//      for OCR, and no live AI model reads the page.
//   3. The assistant parses the page deterministically, shows a preview of
//      exactly what it will save (with source + retrieval date), and saves
//      NOTHING until the user checks the preview and approves it.
// A portal password is never collected, sent, or stored — not in the app,
// not in Supabase, not in any log. Anything the assistant did not actually
// read is left blank, never guessed, and labelled user-entered, not verified.
//
// --- FINAL native portal sign-in design (spec, agreed Nov 4-5, 2026) ---
// The finished product is a native iOS App Store app. This web preview
// CANNOT do the final flow, so everything below is the designed path the
// preview stands in for — the new-tab sign-in + screenshot check is a
// clearly-labelled PREVIEW STAND-IN, not the design. Do not present the
// stand-in as the final flow, and do not build preview-only workarounds
// into the native layer.
//
// FINAL FLOW (native layer — what the iOS app must do):
//   1. Connect opens the portal in Apple's system sign-in sheet
//      (ASWebAuthenticationSession). The sheet is Apple's UI, not the
//      app's: iPhone Passwords + Face ID fill the login, the user sees
//      the portal's own domain, and the app never receives the password.
//   2. The sheet returns to the app with an authenticated session only
//      (cookies / tokens held by the system, scoped to that portal).
//      CRNA Hub never sees, stores, logs, or syncs a portal password —
//      not in the app, not in Supabase, not in any log. There is no
//      username/password box anywhere in the app, now or in the final
//      product.
//   3. With the session, the assistant reads the record page (status,
//      numbers, dates, CE credits) — server-side through the portal-sync
//      Edge Function where a pull is possible, or from the record page
//      the user shows the assistant where it is not — and shows a
//      preview of exactly what it will save. NOTHING is saved until the
//      user checks the preview and approves it.
//   4. A record is labelled Verified ONLY when a pull/check actually
//      returned a record from the portal (source + retrieval date).
//      Anything else stays user-entered or assistant-portal-check —
//      never upgraded, never faked.
//   5. Monitoring runs on schedule in the background (weekly by
//      default, escalating to every 3 days inside 90 days, every 2 days
//      inside 30 days, daily inside 7 days / once expired). Public
//      checks run automatically; private portals run when the user is
//      signed in, and the assistant PROMPTS the user to sign in again
//      (system sheet) when a check is due and no session exists. It
//      never silently logs in as the user and never stores a portal
//      password.
//
// SERVER (portal-sync Edge Function — what the server still owns):
//   * NBCRNA public verification pull (no login) — implemented, UNPROVEN:
//     the APEX submit endpoint 404s server-side (Nov 5, 2026).
//   * Honest blocked/unsupported answers for WV / Ohio lookups, with
//     the manual route + Nursys e-Notify pointer.
//   * portal_connections status rows (connected / needs_reauth / failed)
//     so a stale "connected" label can never survive a failed pull.
//   * It does NOT own sign-in: the legacy connect-aana endpoint (server
//     took a username/password for one AANA attempt) was DELETED
//     Nov 5, 2026 (audit F9) — the final product never hands the server
//     a portal password, even transiently.
//
// PER-SOURCE honest status (Nov 5, 2026 — re-check before claiming more):
//   * NBCRNA: public verification UNPROVEN (submit 404s); member-portal
//     record (MAC Ed / MAC Dev / CPC check-in) needs the signed-in sheet.
//   * AANA: member sign-in is SSO + Incapsula bot-gated — LIKELY BLOCKED
//     even from the sheet; the sheet is still the correct attempt, and a
//     blocked sheet falls back to the assistant reading the member page.
//   * WV Board lookup: BLOCKED (Imperva Incapsula). Ohio eLicense:
//     BLOCKED (Salesforce Lightning app, no public API). Manual route
//     only, plus Nursys e-Notify for push alerts. Nursys does NOT verify
//     APRN licenses and is never claimed as a pull.
const PORTAL_NATIVE_SPEC={
  model:'system_signin_sheet',
  sheet:'ASWebAuthenticationSession — Apple system sign-in sheet, iPhone Passwords + Face ID',
  neverStoresPasswords:true,
  previewBeforeSave:true,
  monitoring:{baseCadenceDays:7,escalation:{inside90:3,inside30:2,inside7:1,expired:1},publicChecks:'automatic',privatePortals:'re-sign-in prompt via system sheet, never silent login'},
  sources:{
    nbcrna:{status:'unproven',note:'Public verification submit 404s server-side (Nov 5, 2026); member-portal record needs the signed-in sheet.'},
    aana:{status:'likely_blocked',note:'SSO + Incapsula bot-gated; the sheet is the correct attempt, blocked sheet falls back to the assistant reading the member page.'},
    wv:{status:'blocked',note:'WV Board lookup Imperva Incapsula-blocked; manual route + Nursys e-Notify.'},
    ohio:{status:'blocked',note:'Ohio eLicense is a Salesforce Lightning app with no public API; manual route + Nursys e-Notify.'},
    licenses:{status:'blocked',note:'WV and Ohio board lookups block automation; manual route + Nursys e-Notify. Nursys does not verify APRN licenses and is never claimed as a pull.'}
  },
  serverOwns:['NBCRNA public verification pull (unproven)','honest blocked/unsupported answers for WV/OH with manual route + Nursys pointer','portal_connections status rows'],
  nativeOwns:['system sign-in sheet (ASWebAuthenticationSession)','Face ID / iPhone Passwords fill','assistant record-page read + preview-before-save','background monitoring schedule + re-sign-in prompts']
};
// Exact stand-in label used everywhere the preview flow appears. Keep the
// wording identical so a search for it finds every stand-in surface.
const PORTAL_CHECK_SOURCES={
  nbcrna:{title:'NBCRNA',short:'NBCRNA',url:'https://portal.nbcrna.com/',siteLabel:'portal.nbcrna.com',
    what:'certification status, certification period, renewal / recertification deadline, MAC Ed / MAC Dev progress, and CPC check-in status',
    how:'NBCRNA has its own sign-in portal. Open portal.nbcrna.com and sign in yourself, then screenshot the page that shows your certification timeline / record — status, period, and MAC progress.',
    limit:'Honest limit: NBCRNA’s public verification submit does not answer (404), so the assistant cannot pull NBCRNA directly — it reads the page you show it instead.'},
  aana:{title:'AANA',short:'AANA',url:'https://www.aana.com/login',siteLabel:'aana.com/login',
    what:'membership status, membership expiration, and CE transcript totals (Class A / Class B)',
    how:'AANA needs a member sign-in. Open aana.com/login and sign in yourself, then screenshot your membership page or CE transcript — the page that shows your status and totals.',
    limit:'Honest limit: AANA sign-in runs through SSO and that page is bot-gated, so the assistant cannot sign in for you — it reads the member page you show it instead. AANA also shares CE with NBCRNA, so NBCRNA totals may already cover the same credits.'},
  licenses:{title:'State Licenses',short:'a state license',url:'https://www.nursys.com/',siteLabel:'your official state board lookup',
    what:'license status, license type (RN / APRN), license number, issue date, and expiration date',
    how:'Open the official lookup for the license — WV Board License Lookup for West Virginia (RN and APRN; Nursys does not verify APRN licenses) or Ohio eLicense for Ohio — look yourself up, and screenshot the result page that shows your license.',
    limit:'Honest limit: WV and Ohio board lookups block automation, so the assistant cannot pull them directly — it reads the lookup page you show it instead. Nursys e-Notify can alert you when a license changes.'}
};

// --- Assistant-guided portal navigation (Nov 6, 2026) ---
// The check is a guided walk, not one generic upload: each portal has
// a navigation map — the ordered pages the assistant needs, each with
// one short direction line. The step engine's only input is "pages
// shown to the assistant" (a screenshot or pasted text here; in the
// finished native app the in-app browser feeds the same engine the
// page it is showing after the system sign-in sheet returns). After
// each page is read, the fields it gave are checked off; the engine
// advances to the next page that can still give something required,
// re-asks BY NAME when a page gave nothing new (wrong page), and
// finishes at the preview report once the required fields are in or
// every needed page has been shown or skipped. Nothing saves before
// approval — unchanged.
const PORTAL_FIELD_LABELS={
  nbcrna:[['status','Certification status'],['number','License / certification number'],['periodStart','Certification period start'],['periodEnd','Certification period end'],['renewalDeadline','Renewal / recertification deadline'],['checkStatus','CPC / MAC Check status'],['classA','Class A credits'],['classB','Class B credits'],['macEd','MAC Ed credits'],['macDev','MAC Dev credits']],
  aana:[['status','Membership status'],['number','Membership number'],['expiration','Membership expiration'],['classA','Class A credits'],['classB','Class B credits']],
  licenses:[['status','License status'],['number','License / certification number'],['type','License type'],['issue','Issue date'],['expiry','Expiration date']]
};
const PORTAL_NAV_MAPS={
  nbcrna:{required:['status','periodEnd'],pages:[
    {key:'record',name:'certification record / timeline',direction:'Open your certification record on your timeline — that’s the page I need.',fields:['status','number','periodStart','periodEnd','renewalDeadline']},
    {key:'progress',name:'CPC / MAC progress',direction:'Now open your CPC / MAC progress — the page showing MAC Check, MAC Ed and MAC Dev — that’s the page I need.',fields:['checkStatus','classA','classB','macEd','macDev']}]},
  aana:{required:['status','expiration'],pages:[
    {key:'membership',name:'Member Dashboard — My AANA Membership Information',direction:'Open your Member Dashboard, then My AANA Membership Information — that’s the page I need. I read the “Dues paid through” date as your membership expiration.',fields:['status','number','expiration']},
    {key:'transcript',name:'CE transcript',direction:'Now open your CE transcript — that’s the page I need.',fields:['classA','classB']}]},
  licenses:{required:['status','expiry'],pages:[
    {key:'license',name:'license lookup result',direction:'Open ONE license result — the WV Board License Lookup for a West Virginia license (RN or APRN), or your Ohio eLicense verification details for an Ohio license — that’s the page I need.',fields:['status','number','type','issue','expiry']}]}
};
function portalNavMap(source){ return PORTAL_NAV_MAPS[source]||{required:[],pages:[{key:'record',name:'record page',direction:'Open the page that lists your record — that’s the page I need.',fields:[]}]}; }
const PORTAL_LOOKUP_LINKS={
  licenses:'<p class="muted">Official lookups: <a href="https://wvrn.boardsofnursing.org/licenselookup" target="_blank" rel="noopener">WV Board License Lookup</a> (West Virginia RN + APRN) · <a href="https://elicense.ohio.gov/oh_verifylicense" target="_blank" rel="noopener">Ohio eLicense</a> (Ohio licenses) · <a href="https://www.nursys.com/" target="_blank" rel="noopener">Nursys</a> (RN licenses in other states only — it does not verify APRN licenses).</p>'
};
function portalGuidePage(pc){ const map=portalNavMap(pc.source); return map.pages[Math.min(pc.page||0,map.pages.length-1)]; }
// After a page is read (or skipped): finish at the preview when the
// required fields are all in, or when no unshown page can still give
// a required field; otherwise advance to the next such page.
function portalGuideAdvance(pc){
  const map=portalNavMap(pc.source);
  const has=(k)=>pc.fields&&String(pc.fields[k]||'').trim()!=='';
  const missingReq=map.required.filter(k=>!has(k));
  if(missingReq.length){
    for(let i=(pc.page||0)+1;i<map.pages.length;i++){
      if((pc.skippedPages||[]).includes(i)) continue;
      if(map.pages[i].fields.some(k=>missingReq.includes(k))){ pc.page=i; return 'next'; }
    }
    return 'preview';
  }
  // Required is complete: still offer remaining pages that could add
  // optional detail, unless every one has been shown or skipped.
  for(let i=(pc.page||0)+1;i<map.pages.length;i++){
    if((pc.skippedPages||[]).includes(i)) continue;
    if(map.pages[i].fields.some(k=>!has(k))){ pc.page=i; return 'next'; }
  }
  return 'preview';
}
// Feed one read page into the guided check. Returns 'next' (advanced
// to the next needed page), 'preview' (record complete — show the
// report), or 'wrong' (the page gave nothing new — re-ask by name).
function portalGuideIngest(parsed,via,state){
  const pc=portalCheck; if(!pc) return 'wrong';
  const page=portalGuidePage(pc);
  const before={...(pc.fields||{})};
  const merged={...before};
  for(const k of Object.keys(parsed.fields||{})){ const v=parsed.fields[k]; if(v!==undefined&&String(v).trim()!=='') merged[k]=String(v); }
  const newKeys=Object.keys(merged).filter(k=>String(before[k]||'')!==String(merged[k]||''));
  pc.fields=merged; pc.state=state||pc.state;
  const fm=portalCheckFoundMissing(pc.source,merged); pc.found=fm.found; pc.missing=fm.missing;
  if(!newKeys.length){
    portalCheckError='That page doesn’t show your '+page.name+' — open your '+page.name+' and show me that one.';
    portalCheckOcrStatus=''; return 'wrong';
  }
  pc.pagesShown=(pc.pagesShown||0)+1; pc.via=via; pc.retrievedAt=cloudNow();
  portalCheckError='';
  const where=portalGuideAdvance(pc);
  if(where==='preview'){ pc.step='preview'; }
  else { pc.notice='Got it — '+newKeys.length+' new detail'+(newKeys.length>1?'s':'')+' checked off.'; }
  portalStatePersist();
  return where;
}
function portalGuideSkip(){
  const pc=portalCheck; if(!pc) return;
  pc.skippedPages=[...new Set([...(pc.skippedPages||[]),pc.page||0])];
  portalCheckError='';
  if(portalGuideAdvance(pc)==='preview'){ pc.step='preview'; }
  portalStatePersist();
  render();
}

const PORTAL_VERIFIED_SOURCES=['public_verification','nbcrna_portal','aana_portal','state_board_portal'];
// --- Active portal monitoring (assistant's job, for every user) ---
// The assistant ACTIVELY watches NBCRNA, AANA, and state licenses on a
// schedule — it does not wait to be asked. Cadence: weekly by default,
// escalating inside the renewal windows (every 3 days inside 90 days,
// every 2 days inside 30 days, daily inside 7 days, daily once expired).
//   * Public checks (NBCRNA public verification) the assistant runs
//     automatically where the source allows it — no login, no password.
//   * Private portals (AANA member portal, state board member pages) run
//     only when the user is signed in; when a check is due and no signed-in
//     session exists, the assistant PROMPTS the user to sign in again.
//     It never silently logs in as the user and never stores a portal
//     password.
//   * A check that finds a change (status, dates, CE totals) is flagged on
//     the Dashboard and in the Assistant tab, with what changed and when it
//     was read. A check that finds nothing records "checked, no change"
//     with the date. A source that blocks automation is recorded honestly
//     as blocked — never faked.
//   * There is no "run check now": the cadence is the only trigger.
//     When a check comes due, public-route sources are attempted
//     automatically (monitorBackgroundSweep — on app open / sign-in here,
//     a background task in the finished native app); sources that need a
//     signed-in session surface ONE prompt per due cycle, which launches
//     the guided check. Dismissing snoozes the prompt to the next cycle.
// Monitoring state lives on this device (db.portalMonitoring, included in
// JSON backups); the check log reuses db.portalChecks (last 20).
const MONITOR_SOURCES={
  nbcrna:{title:'NBCRNA',method:'public',blocked:'Checks read the page you show the assistant.'},
  aana:{title:'AANA',method:'signed_in',blocked:'Checks run when you sign in yourself.'},
  licenses:{title:'State Licenses',method:'signed_in',blocked:'Checks read the lookup page you show the assistant.'}
};
function monitorKey(source,state,type){return source==='licenses'?('licenses:'+(state||'')+':'+(type||'APRN')):source}
function monitorLabel(mon){return mon.source==='licenses'?((mon.state||'State license')+' '+(mon.type||'')):((MONITOR_SOURCES[mon.source]||{}).title||mon.source)}
function monitorDeadline(mon){
  if(mon.source==='nbcrna'){const n=db.nbcrna||{};return n.renewalDeadline||n.periodEnd||''}
  if(mon.source==='aana'){return (db.aana||{}).expiration||''}
  const lic=(db.licenses||[]).find(x=>String(x.state||'')===(mon.state||'')&&String(x.type||'').toUpperCase()===String(mon.type||'APRN').toUpperCase());
  return lic?lic.expiry||'':'';
}
function monitorBaseCadence(mon){const v=parseInt(mon.cadenceDays,10);return Number.isFinite(v)&&v>0?v:7}
function monitorCadence(mon){
  const d=daysUntil(monitorDeadline(mon));
  if(d!==null&&d<0)return 1;
  if(d!==null&&d<=7)return 1;
  if(d!==null&&d<=30)return 2;
  if(d!==null&&d<=90)return 3;
  return monitorBaseCadence(mon);
}
function addDaysStr(iso,n){const d=new Date(iso+'T12:00:00');d.setDate(d.getDate()+n);return localDate(d)}
function monitorNextDue(mon,todayStr){
  const today=todayStr||localDate(new Date());
  let due;
  // A failed / blocked attempt retries on the same cadence measured from
  // the attempt — it stays "not checked", but it is not retried on every
  // app open either.
  const failedAttempt=mon.lastAttempt&&(!mon.lastChecked||mon.lastAttempt>mon.lastChecked)&&['blocked','failed','needs_signin'].includes(mon.lastOutcome);
  const base=failedAttempt?mon.lastAttempt:mon.lastChecked;
  if(!base)due=today;
  else due=addDaysStr(String(base).slice(0,10),monitorCadence(mon));
  if(mon.snoozeUntil&&mon.snoozeUntil>due)due=mon.snoozeUntil;
  return due;
}
function monitorMethod(mon){return (MONITOR_SOURCES[mon.source]||{}).method||'signed_in'}
// Names for the public check come from the monitor (asked once) or the
// step-1 profile name; with a signed-in app session the public check can
// run on its own. Without them it falls back to the due prompt.
function monitorPublicReady(mon){
  if(mon.source!=='nbcrna')return monitorMethod(mon)==='public';
  if(typeof cloudSession==='undefined'||!cloudSession)return false;
  const named=((mon.firstName||'')+' '+(mon.lastName||'')).trim();
  return !!(named||String(profileName()||'').trim().split(/\s+/).filter(Boolean).length>=2);
}
// One prompt per due cycle for checks that need the user: visible while
// the check is due and this cycle has not been dismissed. Dismissing
// snoozes to the next cadence (a new due date = a new cycle).
function monitorPromptVisible(mon,todayStr){
  if(!monitorIsDue(mon,todayStr))return false;
  if(monitorMethod(mon)==='public'&&monitorPublicReady(mon))return false;
  return mon.promptDismissedCycle!==monitorNextDue(mon,todayStr);
}
function monitorIsDue(mon,todayStr){if(mon.enabled===false)return false;return monitorNextDue(mon,todayStr)<=(todayStr||localDate(new Date()))}
function ensurePortalMonitoring(){
  if(!Array.isArray(db.portalMonitoring))db.portalMonitoring=[];
  let added=false;
  const ensure=(key,source,state,type)=>{
    if(!db.portalMonitoring.some(m=>m.key===key)){
      db.portalMonitoring.push({key,source,state:state||'',type:type||'',label:'',enabled:true,cadenceDays:7,lastChecked:'',lastAttempt:'',lastOutcome:'',lastSummary:'',lastMethod:'',changeFlag:false,firstName:'',lastName:''});
      added=true;
    }
  };
  ensure('nbcrna','nbcrna');ensure('aana','aana');
  (db.licenses||[]).forEach(x=>ensure(monitorKey('licenses',x.state,x.type),'licenses',x.state,x.type));
  db.portalMonitoring.forEach(m=>{m.label=monitorLabel(m)});
  if(added)persist();
  return db.portalMonitoring;
}
// Snapshot of the fields a check can change, for change detection: compare
// before and after a check and flag only a real difference.
function monitorSnapshot(source,state,type){
  if(source==='nbcrna'){const n=db.nbcrna||{};return [n.status,n.number,n.periodStart,n.periodEnd,n.renewalDeadline,n.checkStatus,n.classA,n.classB,n.macEd,n.macDev].map(v=>String(v??'')).join('|')}
  if(source==='aana'){const a=db.aana||{};return [a.status,a.number,a.expiration,a.classA,a.classB].map(v=>String(v??'')).join('|')}
  const lic=(db.licenses||[]).find(x=>String(x.state||'')===String(state||'')&&String(x.type||'').toUpperCase()===String(type||'APRN').toUpperCase());
  return lic?[lic.status||'',lic.number,lic.issue,lic.expiry].map(v=>String(v??'')).join('|'):'';
}
function monitorSnapshotChanged(before,after){return String(before||'')!==String(after||'')}
function recordMonitorCheck(key,outcome,summary,method){
  const mons=ensurePortalMonitoring();
  const mon=mons.find(m=>m.key===key);if(!mon)return null;
  const when=cloudNow();
  // A source counts as CHECKED only when a check returned data: successful
  // outcomes (changed / no_change) move lastChecked. Blocked, failed and
  // needs-sign-in attempts are logged as attempts — they never stamp a
  // check that did not happen.
  mon.lastAttempt=when;
  if(outcome==='changed'||outcome==='no_change')mon.lastChecked=when;
  mon.lastOutcome=outcome;mon.lastSummary=summary||'';mon.lastMethod=method||'';
  mon.snoozeUntil='';mon.promptDismissedCycle='';mon.autoAttemptCycle='';
  if(outcome==='changed')mon.changeFlag=true;
  db.portalChecks=[{source:mon.source,state:mon.state||'',retrievedAt:when,status:outcome,summary:summary||''},...(db.portalChecks||[])].slice(0,20);
  persist();
  pushWatchRefreshPortal();
  return mon;
}
function monitorOutcomeLabel(o){return {'no_change':'Checked — no change','changed':'Changed','needs_signin':'Needs sign-in','blocked':'Blocked — automation not allowed','failed':'Check failed','not_checked':'Not checked yet'}[o]||o||'Not checked yet'}
function monitorDuePromptHTML(mon){
  return `<div class="item"><strong>${escapeHTML(mon.label)} check due — sign in to run it.</strong><div class="toolbar"><button type="button" data-action="monitor-assistant" data-id="${escapeHTML(mon.key)}">Run my check</button><button type="button" class="secondary" data-action="monitor-prompt-dismiss" data-id="${escapeHTML(mon.key)}">Not now</button></div></div>`;
}
// The reminder surface: due-check prompts at the top of the Credentials
// tab — one per due cycle, next to the credential deadline notices.
function monitorDuePromptsHTML(){
  const mons=ensurePortalMonitoring(),today=localDate(new Date());
  const due=mons.filter(m=>monitorPromptVisible(m,today));
  if(!due.length)return '';
  return `<section class="panel"><h2>Checks due</h2>${due.map(m=>monitorDuePromptHTML(m)).join('')}</section>`;
}
function portalMonitoringHTML(){
  const mons=ensurePortalMonitoring(),today=localDate(new Date());
  const log=(db.portalChecks||[]).slice(0,8);
  const monOpen=!!(mons.some(m=>monitorPromptVisible(m,today))||mons.some(m=>monitorIsDue(m,today))||mons.some(m=>m.changeFlag));
  const monLastChecked=mons.map(m=>m.lastChecked||'').filter(Boolean).sort().pop()||'';
  const monTitle='Portal monitoring'+(monLastChecked?(' · checked '+fmt(String(monLastChecked).slice(0,10))):'');
  return collapsePanelHTML('credentials-monitoring-panel',monTitle,`<p class="muted">Checks run on their own every 7 days — faster near renewal. If a check needs your sign-in, you get one prompt here. We never store a portal password.</p>${mons.map(m=>{const cad=monitorCadence(m),next=monitorNextDue(m,today),isDue=monitorIsDue(m,today),prompt=monitorPromptVisible(m,today);return `<div class="item"><strong>${escapeHTML(m.label)}</strong> · ${m.enabled?'Monitoring on':'Paused'} · every ${cad} day${cad>1?'s':''}${cad!==monitorBaseCadence(m)?' (faster — renewal is near)':''}<div class="muted">Last checked: ${m.lastChecked?fmt(String(m.lastChecked).slice(0,10)):'never'}${m.lastAttempt&&m.lastAttempt!==m.lastChecked?` · Last attempt: ${fmt(String(m.lastAttempt).slice(0,10))}`:''} · Next due: ${fmt(next)}${isDue?' · <strong>due now</strong>':''} · Outcome: ${escapeHTML(monitorOutcomeLabel(m.lastOutcome))}${m.lastSummary?` — ${escapeHTML(m.lastSummary)}`:''}</div>${prompt?monitorDuePromptHTML(m):''}<div class="toolbar">${isDue&&monitorMethod(m)!=='public'?`<button type="button" class="secondary" data-action="monitor-assistant" data-id="${escapeHTML(m.key)}">Check with assistant</button>`:''}<button type="button" class="secondary" data-action="monitor-toggle" data-id="${escapeHTML(m.key)}">${m.enabled?'Pause monitoring':'Resume monitoring'}</button>${m.changeFlag?`<button type="button" class="secondary" data-action="monitor-ack" data-id="${escapeHTML(m.key)}">Mark change reviewed</button>`:''}</div><details><summary class="muted">Cadence</summary><form data-kind="monitor-cadence"><input type="hidden" name="key" value="${escapeHTML(m.key)}"><div class="form-grid"><div class="field"><label>Base cadence</label><select name="cadenceDays">${[1,3,7,14].map(v=>`<option value="${v}" ${monitorBaseCadence(m)===v?'selected':''}>Every ${v} day${v>1?'s':''}${v===7?' (weekly)':''}</option>`).join('')}</select></div></div><div class="form-actions"><button type="submit">Save cadence</button></div></form></details></div>`}).join('')}${log.length?`<h3>Monitoring log</h3>${log.map(c=>`<div class="item"><strong>${escapeHTML((PORTAL_CHECK_SOURCES[c.source]||{}).short||c.source)}</strong> · ${c.retrievedAt?fmt(String(c.retrievedAt).slice(0,10)):''} · ${escapeHTML(monitorOutcomeLabel(c.status))}<div class="muted">${escapeHTML(c.summary||'')}</div></div>`).join('')}`:'<p class="muted">No checks logged yet — they will appear here as monitoring runs.</p>'}` ,monOpen);
}
// Dashboard portal-monitoring card removed (Nov 6, 2026): monitoring
// lives on the Credentials tab; the Dashboard no longer repeats it.
// The monitoring engine, Credentials panel, and Assistant checks
// are untouched.
// Automatic public check — the background path. When a check comes due,
// a source with a working public route (NBCRNA public verification) is
// attempted on its own: no prompt, no alert. Names come from the monitor
// (asked once in the guided flow) or the step-1 profile name. Outcomes —
// including blocked / failed — are recorded in the monitoring log, and
// lastChecked only moves when a check returned data. Nothing is faked.
async function monitorAttemptPublic(mon){
  if(!SUPABASE_CONFIGURED||!cloudSession)return false;
  let first=mon.firstName||'',last=mon.lastName||'';
  if(!first||!last){
    const parts=String(profileName()||'').trim().split(/\s+/).filter(Boolean);
    if(parts.length>=2){first=parts[0];last=parts.slice(1).join(' ');mon.firstName=first;mon.lastName=last;persist();}
  }
  if(!first||!last)return false;
  const before=monitorSnapshot('nbcrna');
  try{
    const data=await portalCall({action:'verify-nbcrna',firstName:first,lastName:last,certNumber:((db.nbcrna||{}).number||''),state:''});
    const r=data.record||{};
    if(!r.certification_number&&!r.period_end&&!r.period_start) throw new Error('NBCRNA public verification returned no record data');
    db.nbcrna={...(db.nbcrna||{}),status:r.certification_status||'Certified',number:r.certification_number||(db.nbcrna&&db.nbcrna.number)||'',periodEnd:r.period_end||(db.nbcrna&&db.nbcrna.periodEnd)||'',renewalDeadline:r.renewal_deadline||(db.nbcrna&&db.nbcrna.renewalDeadline)||'',source:'public_verification',reminders:(db.nbcrna&&db.nbcrna.reminders)||'90,60,30,7'};
    cloudSyncTimes.nbcrna=data.retrievedAt||cloudNow();
    delete portalAttemptFailed['nbcrna'];delete portalHealed['nbcrna'];
    persist();cloudSaveKind('nbcrna');await portalRefreshStatus();
    const changed=monitorSnapshotChanged(before,monitorSnapshot('nbcrna'));
    recordMonitorCheck(mon.key,changed?'changed':'no_change',changed?('NBCRNA record changed on public check — '+(r.certification_number||'certification')+' expires '+(r.period_end||'unknown')):'NBCRNA public check: no change','public');
    return true;
  }catch(e){
    const msg=portalErrMsg(e);portalNoteFailed('nbcrna',msg);
    recordMonitorCheck(mon.key,/404|did not answer|unavailable|not answer/i.test(msg)?'blocked':'failed','NBCRNA public check could not run: '+msg,'public');
    await portalRefreshStatus();
    return true;
  }
}
// The background cadence sweep: the only way monitoring checks start.
// Runs when the app opens and after sign-in (in the finished native app
// this is a background task on the same schedule). Public-route sources
// are attempted automatically, once per due cycle; sources that need a
// signed-in session are left due — the one prompt per cycle (panel +
// Credentials reminder surface) is how they run, via the guided flow.
let monitorSweepRunning=false;
async function monitorBackgroundSweep(){
  if(!featureOn('featureCredentials'))return;
  if(monitorSweepRunning)return;monitorSweepRunning=true;
  try{
    const today=localDate(new Date());let attempted=false;
    for(const mon of ensurePortalMonitoring()){
      if(!monitorIsDue(mon,today))continue;
      if(monitorMethod(mon)!=='public')continue;
      const cycle=monitorNextDue(mon,today);
      if(mon.autoAttemptCycle===cycle)continue;
      mon.autoAttemptCycle=cycle;persist();
      if(await monitorAttemptPublic(mon))attempted=true;
    }
    pushWatchRefreshPortal();
    if(attempted)render();
  }catch(e){}finally{monitorSweepRunning=false;}
}
function monitorAssistantCheck(mon){
  const src=mon.source;
  startPortalCheck(src);
  if(src==='licenses'&&mon.state)portalCheck.state=mon.state;
  render();
}

let portalCheck=null, portalCheckError='', portalCheckOcrStatus='';
// In-progress portal-check state is persisted on this device (Nov 6,
// 2026): leaving for a portal — a new tab, Safari, or even the app tab
// being replaced — must never lose his place. The guided check (and
// which portals he has opened) is saved on every step and restored at
// boot, so returning resumes the check at the same step. Cleared when
// a check is approved, cancelled, or discarded. Holds only fields the
// assistant read from pages he showed it — never a portal password.
const PORTAL_CHECK_STORAGE='crna-hub-portal-check';
function portalStatePersist(){
  try{
    if(portalCheck||Object.keys(portalOpened||{}).length) localStorage.setItem(PORTAL_CHECK_STORAGE,JSON.stringify({check:portalCheck||null,opened:portalOpened||{}}));
    else localStorage.removeItem(PORTAL_CHECK_STORAGE);
  }catch(e){}
}
function portalCheckRestore(){
  try{
    const raw=localStorage.getItem(PORTAL_CHECK_STORAGE); if(!raw) return;
    const saved=JSON.parse(raw); if(!saved||typeof saved!=='object') return;
    if(saved.opened&&typeof saved.opened==='object') portalOpened=saved.opened;
    const pc=saved.check;
    if(pc&&PORTAL_CHECK_SOURCES[pc.source]&&(pc.step==='collect'||pc.step==='preview')){
      portalCheck={source:pc.source,state:pc.state||'West Virginia',step:pc.step,page:pc.page||0,pagesShown:pc.pagesShown||0,skippedPages:Array.isArray(pc.skippedPages)?pc.skippedPages:[],notice:'',fields:pc.fields||{},found:Array.isArray(pc.found)?pc.found:[],missing:Array.isArray(pc.missing)?pc.missing:[],retrievedAt:pc.retrievedAt||'',via:pc.via||''};
    }
  }catch(e){}
}
const PORTAL_DATE_PAT='(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\\s+\\d{1,2},?\\s+\\d{4}|(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\\s+\\d{4}|\\d{1,2}\\s+(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\\s+\\d{4}|\\d{4}-\\d{2}-\\d{2}|\\d{1,2}/\\d{1,2}/\\d{2,4}|\\d{1,2}/\\d{4}';
function portalCheckDateNear(t,labelRe){
  const m=t.match(new RegExp('(?:'+labelRe+')[^0-9]{0,40}('+PORTAL_DATE_PAT+')','i'));
  return m?parseDocDate(m[1]):'';
}
function portalCheckStatus(t,source){
  const m=t.match(/(?:status|certification status|membership status|license status)\s*[:\-]?\s*([A-Za-z][A-Za-z ]{2,24})/i);
  const raw=m?m[1].trim():'';
  const map=[[/not certified/i,'Not certified'],[/expired/i,'Expired'],[/lapsed/i,'Lapsed'],[/pending/i,'Pending'],[/certified/i,'Certified'],[/active/i,'Active']];
  for(const [re,v] of map) if(re.test(raw)) return v;
  if(source==='nbcrna'){ if(/not certified/i.test(t)) return 'Not certified'; if(/\bcertified\b/i.test(t)) return 'Certified'; }
  if(/expired/i.test(t)) return 'Expired'; if(/lapsed/i.test(t)) return 'Lapsed';
  if(/pending/i.test(t)) return 'Pending'; if(/\bactive\b/i.test(t)) return 'Active';
  return '';
}
function portalCheckNumber(t,source){
  const pats=source==='aana'
    ?[/(?:member(?:ship)?|aana)\s*(?:no\.?|number|#|id)\s*[:#]?\s*(\d{4,})/i]
    :[/(?:certification|certificate|license|lic\.?)\s*(?:no\.?|number|#)\s*[:#]?\s*([A-Za-z0-9][A-Za-z0-9.-]{3,30})/i,
      /(?:cert|lic)\s*#\s*[:#]?\s*([A-Za-z0-9][A-Za-z0-9.-]{3,30})/i];
  for(const re of pats){ const m=t.match(re); if(m) return m[1].replace(/\.+$/,''); }
  return '';
}
function portalCheckStatusText(t){
  const m=t.match(/(?:CPC\s*(?:check[\- ]?in)?|MAC\s*Check)\s*(?:status)?\s*[:\-]\s*([A-Za-z0-9][A-Za-z0-9 /-]{1,40})/i);
  if(m){ const v=m[1].trim().replace(/\s+(?:Class|MAC|Certification|Period)\b.*$/i,'').trim(); if(v) return v; }
  if(/CPC\s*check[\- ]?in[^.]{0,40}\bcomplete\b/i.test(t)||/\bcheck[\- ]?in complete\b/i.test(t)) return 'Complete';
  return '';
}
function portalCheckCredits(t,label){
  const m=t.match(new RegExp('(?:'+label+')[^0-9]{0,30}(\\d+(?:\\.\\d+)?)','i'));
  return m?m[1]:'';
}
// Deterministic parse of a portal page (screenshot OCR text or pasted text).
// Only fields actually present on the page are filled; everything else stays
// blank for the user to fill in by hand. Never invents a value.
function parsePortalCheckText(text,source,opts){
  let t=String(text||'').replace(/\s+/g,' ');
  if(opts&&opts.ocr) t=normalizeOcrDateText(t);
  const fields={},found=[],missing=[];
  const take=(key,label,val)=>{ if(val){fields[key]=val;found.push(label);} else missing.push(label); };
  take('status',source==='nbcrna'?'Certification status':source==='aana'?'Membership status':'License status',portalCheckStatus(t,source));
  take('number',source==='aana'?'Membership number':'License / certification number',portalCheckNumber(t,source));
  if(source==='nbcrna'){
    // "Certification Period: May 1, 2023 - April 30, 2027" style ranges.
    const range=t.match(new RegExp('(?:certification\\s+)?period\\s*[:\\-]?\\s*('+PORTAL_DATE_PAT+')\\s*(?:-|–|—|to)\\s*('+PORTAL_DATE_PAT+')','i'));
    take('periodStart','Certification period start',range?parseDocDate(range[1]):portalCheckDateNear(t,'period\\s+(?:start|from|begin)|certified\\s+(?:since|from)|effective\\s+(?:date|from)'));
    take('periodEnd','Certification period end',range?parseDocDate(range[2]):portalCheckDateNear(t,'period\\s+(?:end|through|to)|certified\\s+through|valid\\s+through'));
    const exp=extractExpiryDateInfo(t,opts);
    take('renewalDeadline','Renewal / recertification deadline',exp.iso||fields.periodEnd||'');
    take('classA','Class A credits',portalCheckCredits(t,'class\\s*A(?:\\s+credits?)?'));
    take('classB','Class B credits',portalCheckCredits(t,'class\\s*B(?:\\s+credits?)?'));
    take('checkStatus','CPC / MAC Check status',portalCheckStatusText(t));
    take('macEd','MAC Ed credits',portalCheckCredits(t,'MAC\\s*Ed(?:ucation)?(?:\\s+credits?)?'));
    take('macDev','MAC Dev credits',portalCheckCredits(t,'MAC\\s*Dev(?:elopment)?(?:\\s+credits?)?'));
  } else if(source==='aana'){
    const dues=portalCheckDateNear(t,'dues\\s+paid\\s+through|paid\\s+through');
    const exp=extractExpiryDateInfo(t,opts);
    take('expiration','Membership expiration',dues||exp.iso||'');
    take('classA','Class A credits',portalCheckCredits(t,'class\\s*A(?:\\s+credits?)?'));
    take('classB','Class B credits',portalCheckCredits(t,'class\\s*B(?:\\s+credits?)?'));
  } else {
    take('type','License type',(/\bAPRN\b/i.test(t)||/\bCRNA\b/i.test(t)||/certified registered nurse anesthetist/i.test(t))?'APRN':(/\bRN\b/i.test(t)?'RN':''));
    take('issue','Issue date',portalCheckDateNear(t,'issue(?:d)?(?:\\s+date)?|issued'));
    const exp=extractExpiryDateInfo(t,opts);
    take('expiry','Expiration date',exp.iso||'');
  }
  return {fields,found,missing};
}
function startPortalCheck(source){
  const meta=PORTAL_CHECK_SOURCES[source]; if(!meta) return;
  // Straight to the check step (Nov 6, 2026): the button promises a
  // check, so it opens the upload/paste panel for THIS portal — no
  // canned instruction essay, no restart of step 1. One short chat
  // line points at the panel; the panel IS the check.
  portalCheck={source,state:'West Virginia',step:'collect',page:0,pagesShown:0,skippedPages:[],notice:'',fields:{},found:[],missing:[],retrievedAt:'',via:''};
  portalCheckError=''; portalCheckOcrStatus='';
  db.assistantChat=[...(db.assistantChat||[]),
    {role:'assistant',text:'Portal check — '+meta.title+'. Show me the page that lists your record below and I’ll read it and show you the report — nothing is saved until you approve it.'}].slice(-50);
  portalStatePersist(); persist(); assistantSheetOpen=false; tab='Assistant'; render();
}
function portalCheckFieldRows(source,f){
  if(source==='nbcrna') return field('status','Certification status','text',f.status||'')+field('number','Certification number','text',f.number||'')+field('periodStart','Certification period start','date',f.periodStart||'')+field('periodEnd','Certification period end','date',f.periodEnd||'')+field('renewalDeadline','Renewal / recertification deadline','date',f.renewalDeadline||f.periodEnd||'')+field('checkStatus','CPC / MAC Check status','text',f.checkStatus||'')+field('classA','Class A credits','number',f.classA??'','min="0" step="0.25"')+field('classB','Class B credits','number',f.classB??'','min="0" step="0.25"')+field('macEd','MAC Ed credits','number',f.macEd??'','min="0" step="1"')+field('macDev','MAC Dev credits','number',f.macDev??'','min="0" step="1"');
  if(source==='aana') return field('status','Membership status','text',f.status||'')+field('number','Membership number','text',f.number||'')+field('expiration','Membership expiration','date',f.expiration||'')+field('classA','Class A credits','number',f.classA??'','min="0" step="0.25"')+field('classB','Class B credits','number',f.classB??'','min="0" step="0.25"');
  return select('state','State',US_STATES,f.state||(portalCheck&&portalCheck.state)||'West Virginia')+select('type','License type',['RN','APRN'],f.type||'APRN')+field('status','License status','text',f.status||'')+field('number','License number','text',f.number||'')+field('issue','Issue date','date',f.issue||'')+field('expiry','Expiration date','date',f.expiry||'','required');
}
function portalCheckHTML(){
  const checks=(db.portalChecks||[]);
  let inner='';
  if(!portalCheck){
    inner=`<p class="muted">Sign in on the portal’s own page, then show me the page that lists your record — I read it, and nothing is saved until you approve.</p><div class="toolbar">${['nbcrna','aana','licenses'].map(s=>`<button type="button" data-action="assistant-portal-check" data-id="${s}">Check ${PORTAL_CHECK_SOURCES[s].short}</button>`).join('')}</div>${checks.length?`<p class="muted">Recent assistant portal checks: ${checks.slice(0,3).map(c=>`${PORTAL_CHECK_SOURCES[c.source]?PORTAL_CHECK_SOURCES[c.source].short:c.source} · ${c.retrievedAt?String(c.retrievedAt).slice(0,10):''} · ${escapeHTML(c.summary||c.status||'')}`).join('; ')}</p>`:''}`;
  } else if(portalCheck.step==='collect'){
    const m=PORTAL_CHECK_SOURCES[portalCheck.source];
    const map=portalNavMap(portalCheck.source), page=portalGuidePage(portalCheck);
    const stepNo=(portalCheck.page||0)+1, stepCount=map.pages.length;
    const rows=(PORTAL_FIELD_LABELS[portalCheck.source]||[]).map(([k,l])=>{ const got=portalCheck.fields&&String(portalCheck.fields[k]||'').trim()!==''; return `<div>${got?'✓':'○'} ${escapeHTML(l)}${got?' — got it':''}</div>`; }).join('');
    inner=`<h3>${m.title} — step ${stepNo} of ${stepCount}</h3><p><strong>${escapeHTML(page.direction)}</strong></p>${PORTAL_LOOKUP_LINKS[portalCheck.source]||''}<p class="muted">📸 On your phone: screenshot that page over there, come back to this tab, then upload it below.</p><p class="muted">No screenshot handy? Paste the page's text below instead.</p>${portalCheck.notice?`<p class="hint">${escapeHTML(portalCheck.notice)}</p>`:''}<div class="item"><strong>Your record so far</strong>${rows}</div><form data-kind="portal-check"><div class="form-grid">${portalCheck.source==='licenses'?select('state','State',US_STATES,portalCheck.state||'West Virginia'):''}${field('shotFile','Screenshot of that page (PNG/JPG)','file','','accept=".png,.jpg,.jpeg,.webp,.heic,image/*"')}${area('pasted','Or paste that page’s text','','Status: Certified\nCertification expires: June 30, 2028')}</div><div class="form-actions"><button type="submit">Read it</button>${stepCount>1?`<button type="button" class="secondary" data-action="portal-guide-skip">Skip this page</button>`:''}${(portalCheck.pagesShown||0)>0?`<button type="button" class="secondary" data-action="portal-guide-finish">That’s everything — show my report</button>`:''}<button type="button" class="secondary" data-action="portal-check-cancel">Cancel</button></div></form>${portalCheckOcrStatus?`<p class="hint" id="portalCheckOcrStatus">${escapeHTML(portalCheckOcrStatus)}</p>`:''}${portalCheckError?`<p class="hint">${escapeHTML(portalCheckError)}</p>`:''}`;
  } else {
    const m=PORTAL_CHECK_SOURCES[portalCheck.source], f=portalCheck.fields||{};
    inner=`<h3>Preview — ${m.title} portal check</h3><p class="muted">Read from the portal page you showed the assistant on ${portalCheck.retrievedAt?String(portalCheck.retrievedAt).slice(0,10):'today'} (${portalCheck.via==='ai'?'read with AI from your screenshot':portalCheck.via==='ocr'?'on-device OCR':portalCheck.via==='pdf'?'PDF text':portalCheck.via==='file'?'uploaded file':'pasted text'} · ${(portalCheck.pagesShown||0)} page${(portalCheck.pagesShown||0)===1?'':'s'} shown). <strong>Check every field — correct anything wrong.</strong> Nothing is saved until you approve below.</p><p class="muted">Found: ${(portalCheck.found||[]).join(', ')||'nothing recognised'}.${(portalCheck.missing||[]).length?(' Not found on the page — fill in by hand if you know it: '+(portalCheck.missing||[]).join(', ')+'.'):''}</p><form data-kind="portal-check-approve"><input type="hidden" name="source" value="${portalCheck.source}"><div class="form-grid">${portalCheckFieldRows(portalCheck.source,f)}</div><div class="form-actions"><button type="submit">Save — I checked this</button><button type="button" class="secondary" data-action="portal-check-cancel">Discard — save nothing</button></div></form>`;
  }
  return `<section class="panel"><h2>Ask the assistant to check my portals</h2>${inner}</section>`;
}
// Live-AI read of a portal record page (extract-contract mode
// 'portal' — the same vision path as contracts and pay stubs). The
// model returns the record's structured fields + the page's raw
// text; the caller merges both and shows the preview report.
async function callExtractPortalCheck(files, source){
  if(!SUPABASE_CONFIGURED) throw new Error('Supabase is not configured yet.');
  if(!cloudSession) throw new Error('Not signed in — sign in on the Account tab first.');
  const images=await aiContractImagesDataURLs(files);
  if(!images.length) throw new Error('Could not read these photos in this browser — try JPG or PNG exports.');
  let data;
  try{ data=await liveSyncPost('extract-contract',{action:'extract-contract',mode:'portal',portalSource:source,images}); }
  catch(e){ if(e&&e.data&&e.data.error==='openai_key_missing'){ const k=new Error(AI_KEY_MISSING_MESSAGE); k.data=e.data; throw k; } throw e; }
  if(data&&data.error==='openai_key_missing') throw new Error(AI_KEY_MISSING_MESSAGE);
  if(!data||data.ok===false) throw new Error((data&&data.message)||(data&&data.error)||'AI reading failed.');
  return data;
}
// Found / missing labels for a merged field set — the same labels the
// deterministic text parser reports, so the preview reads the same
// however the page was read.
function portalCheckFoundMissing(source, fields){
  const has=(k)=>fields[k]!==undefined&&String(fields[k]).trim()!=='';
  const rows=PORTAL_FIELD_LABELS[source]||[];
  const found=[], missing=[];
  rows.forEach(([k,l])=>{ (has(k)?found:missing).push(l); });
  return {found, missing};
}
// Merge an AI portal read with the deterministic parse of its raw
// text: the union of both, the AI's structured fields winning where
// both read a value. Nothing is invented — a field neither read
// stays absent and is reported missing.
function portalCheckFieldsFromAi(portal, rawText, source){
  const fromText=rawText?parsePortalCheckText(rawText,source,{}):{fields:{}};
  const fields={...fromText.fields};
  const map={status:'status',number:'number',periodStart:'period_start',periodEnd:'period_end',renewalDeadline:'renewal_deadline',checkStatus:'check_status',classA:'class_a',classB:'class_b',macEd:'mac_ed',macDev:'mac_dev',expiration:'expiration',type:'license_type',issue:'issue_date',expiry:'expiry',state:'state'};
  for(const k of Object.keys(map)){
    const v=portal?portal[map[k]]:null;
    if(v!==null&&v!==undefined&&String(v).trim()!=='') fields[k]=String(v);
  }
  const fm=portalCheckFoundMissing(source,fields);
  return {fields,found:fm.found,missing:fm.missing};
}
function portalAiHasContent(portal,rawText){
  if(String(rawText||'').trim()) return true;
  if(!portal||typeof portal!=='object') return false;
  return ['status','number','period_start','period_end','renewal_deadline','check_status','class_a','class_b','mac_ed','mac_dev','expiration','license_type','issue_date','expiry','state'].some(k=>portal[k]!==null&&portal[k]!==undefined&&String(portal[k]).trim()!=='');
}
async function submitPortalCheck(e){
  if(!portalCheck) return;
  const form=e.currentTarget, fd=new FormData(form);
  const fileInput=form.querySelector('input[type="file"]'), file=fileInput&&fileInput.files[0];
  const pasted=String(fd.get('pasted')||'').trim();
  const state=String(fd.get('state')||portalCheck.state||'West Virginia');
  let text='', via='';
  if(file){
    try{
      if(file.type.startsWith('image/')||/\.(png|jpe?g|webp|heic)$/i.test(file.name)){
        portalCheckOcrStatus='Reading your screenshot — this can take a few seconds…';
        render();
        // Live AI first (the same vision path as contracts / certs):
        // its structured read IS the check's report. On-device OCR
        // is the automatic fallback when the AI read is unavailable
        // (signed out, key missing, network) — with an honest status
        // line saying so, never a silent downgrade.
        let aiParsed=null, aiFailed=false, aiBlank=false;
        try{
          const data=await callExtractPortalCheck([file],portalCheck.source);
          if(portalAiHasContent(data.portal||{},data.raw_text||'')) aiParsed=portalCheckFieldsFromAi(data.portal||{},data.raw_text||'',portalCheck.source);
          else aiBlank=true;
        }catch(aiErr){ aiFailed=true; }
        if(aiParsed){
          portalCheckOcrStatus='';
          portalGuideIngest(aiParsed,'ai',state);
          render(); return;
        }
        if(aiBlank){
          portalCheckOcrStatus='';
          portalCheckError='The AI reader came back blank from that page — nothing was read, and nothing was saved. Try showing the page again, or paste its text below instead.';
          render(); return;
        }
        if(aiFailed) portalCheckOcrStatus='AI reading isn’t available right now — reading on this device instead…';
        render();
        try{ text=await ocrImageFile(file); }catch(err){ portalCheckOcrStatus=''; portalCheckError='Could not read this picture: '+err.message+' Try a clearer screenshot, or paste the portal text instead. Nothing was saved.'; render(); return; }
        portalCheckOcrStatus='';
        if(!text.trim()){ portalCheckError='OCR read no text from this screenshot. Try a clearer, well-lit screenshot with the text upright, or paste the portal text instead. Nothing was saved.'; render(); return; }
        via='ocr';
      } else if(/\.pdf$/i.test(file.name)||file.type==='application/pdf'){ text=await extractPdfText(file); via='pdf'; }
      else { text=await file.text(); via='file'; }
    }catch(err){ portalCheckOcrStatus=''; portalCheckError='Could not read that file: '+err.message+' — try a clearer screenshot, or paste the portal text instead. Nothing was saved.'; render(); return; }
  } else if(pasted){ text=pasted; via='pasted'; }
  else { portalCheckError='Upload a screenshot of the portal page, or paste the portal text — nothing was read yet, and nothing was saved.'; render(); return; }
  const parsed=parsePortalCheckText(text,portalCheck.source,{ocr:via==='ocr'});
  portalGuideIngest(parsed,via,state);
  render();
}
// Save an approved assistant portal check into the same records manual entry
// uses (NBCRNA / AANA / licenses), with provenance
// source='assistant_portal_check' + retrieval date. Rules: only fields the
// assistant actually read (or the user corrected in the preview) are written,
// blank fields never clear an existing value, and a record a server portal
// pull already verified is NEVER downgraded to the assistant source.
function applyPortalCheckRecord(source,f,when){
  // Provenance follows what actually happened: a page was shown and read
  // -> assistant check; every page skipped and values typed by hand ->
  // the user's own entry. A server-verified record is never downgraded.
  const prov=(portalCheck&&(portalCheck.pagesShown||0)>0)?'assistant_portal_check':'user_entered';
  const keep=(cur)=>PORTAL_VERIFIED_SOURCES.includes(cur&&cur.source)?cur.source:prov;
  if(source==='nbcrna'){
    const cur=db.nbcrna||{};
    db.nbcrna={...cur,status:f.status||cur.status||'',number:f.number||cur.number||'',periodStart:f.periodStart||cur.periodStart||'',periodEnd:f.periodEnd||cur.periodEnd||'',renewalDeadline:f.renewalDeadline||f.periodEnd||cur.renewalDeadline||'',checkStatus:f.checkStatus||cur.checkStatus||'',classA:f.classA!==undefined?f.classA:(cur.classA??''),classB:f.classB!==undefined?f.classB:(cur.classB??''),macEd:f.macEd!==undefined?f.macEd:(cur.macEd??''),macDev:f.macDev!==undefined?f.macDev:(cur.macDev??''),macEdRequired:cur.macEdRequired||60,macDevRequired:cur.macDevRequired||40,docNote:cur.docNote||'',ceNote:cur.ceNote||'',reminders:cur.reminders||'90,60,30,7',source:keep(cur),updatedAt:new Date().toISOString()};
    cloudSyncTimes.nbcrna=when; cloudSaveKind('nbcrna');
    return 'NBCRNA '+(f.status||db.nbcrna.status||'')+' · expires '+(db.nbcrna.renewalDeadline||db.nbcrna.periodEnd||'unknown');
  }
  if(source==='aana'){
    const cur=db.aana||{};
    db.aana={...cur,status:f.status||cur.status||'',number:f.number||cur.number||'',expiration:f.expiration||cur.expiration||'',classA:f.classA!==undefined?f.classA:(cur.classA??''),classB:f.classB!==undefined?f.classB:(cur.classB??''),docNote:cur.docNote||'',ceNote:cur.ceNote||'',reminders:cur.reminders||'90,60,30,7',source:keep(cur),updatedAt:new Date().toISOString()};
    cloudSyncTimes.aana=when; cloudSaveKind('aana');
    return 'AANA '+(f.status||db.aana.status||'')+' · expires '+(db.aana.expiration||'unknown');
  }
  const state=String(f.state||portalCheck&&portalCheck.state||'West Virginia'), type=f.type||'APRN';
  const existing=(db.licenses||[]).find(x=>String(x.state||'').toLowerCase()===state.toLowerCase()&&String(x.type||'').toUpperCase()===type.toUpperCase());
  let recId;
  if(existing){
    recId=existing.id;
    Object.assign(existing,{status:f.status||existing.status||'',number:f.number||existing.number||'',issue:f.issue||existing.issue||'',expiry:f.expiry||existing.expiry||'',source:keep(existing),reminders:existing.reminders||'90,60,30,7'});
  } else {
    recId=id();
    (db.licenses=db.licenses||[]).push({id:recId,state,type,status:f.status||'',number:f.number||'',issue:f.issue||'',expiry:f.expiry||'',portal:'',note:'',source:prov,reminders:'90,60,30,7'});
  }
  cloudSaveKind('licenses',recId);
  return state+' '+type+' '+(f.number||'')+' · expires '+(f.expiry||'unknown');
}
function approvePortalCheck(e){
  const f=Object.fromEntries(new FormData(e.currentTarget));
  const source=f.source||(portalCheck&&portalCheck.source);
  if(!source) return;
  const fields={};
  for(const k of ['status','number','periodStart','periodEnd','renewalDeadline','checkStatus','classA','classB','macEd','macDev','expiration','state','type','issue','expiry'])
    if(String(f[k]||'').trim()) fields[k]=String(f[k]).trim();
  if(!Object.keys(fields).length){ alert('Nothing to save — every field is blank. Fill in at least one detail, or discard this check.'); return; }
  const when=(portalCheck&&portalCheck.retrievedAt)||cloudNow();
  const monKey=monitorKey(source,fields.state||(portalCheck&&portalCheck.state)||'',fields.type||'APRN');
  const beforeSnap=monitorSnapshot(source,fields.state||(portalCheck&&portalCheck.state)||'',fields.type||'APRN');
  const summary=applyPortalCheckRecord(source,fields,when);
  const changed=monitorSnapshotChanged(beforeSnap,monitorSnapshot(source,fields.state||(portalCheck&&portalCheck.state)||'',fields.type||'APRN'));
  // A check counts as checked only when a portal page was actually shown
  // and read. A preview reached by skipping every page and typing values
  // in by hand still saves the record — as a manual save — but it does
  // not stamp the monitor as checked.
  const pagesShown=portalCheck?(portalCheck.pagesShown||0):0;
  if(pagesShown>0) recordMonitorCheck(monKey,changed?'changed':'no_change',(changed?'Changed on assistant check — ':'Checked, no change — ')+summary,'signed_in');
  portalCheck=null; portalCheckError=''; portalCheckOcrStatus=''; portalStatePersist(); persist(); render();
  alert(pagesShown>0?('Saved from the assistant portal check ('+String(when).slice(0,10)+'): '+summary+'\n\nSource: assistant portal check — read from the portal page you showed the assistant. It is not a server portal pull, and nothing was stored from your sign-in.'):('Saved what you typed in: '+summary+'\n\nNo portal page was shown for this check, so it is saved as your own entry — not counted as a portal check.'));
}

function assistantChatInner(){
  const hist=db.assistantChat||[];
  return `<div class="chat">${hist.length?hist.map(m=>`<div class="msg ${m.role==='user'?'user':'assistant'}"><strong>${m.role==='user'?'You':'Assistant'}${m.role==='assistant'?(m.source==='live'?' · Live AI':m.source==='pending'?' · …':' · On-device answer'):''}</strong><div>${escapeHTML(m.text)}</div></div>`).join(''):'<p class="muted">Ask about your schedule, income, credentials, mileage, or how CRNA Hub works.</p>'}</div>`;
}
// Shared assistant panel (Nov 7, 2026): ONE conversation, two surfaces.
// The Assistant tab and the floating assistant sheet both render this
// exact panel from db.assistantChat — ask in either place and the same
// history shows in both. Chips/quick prompts call askAssistantLive()
// through the same 'ask' action; the form submits through the same
// submitAssistant() (its one #assistantForm exists once per render:
// the sheet replaces the tab when both would be on screen).
function assistantPanelHTML(chips){
  return `<p class="muted">Your admin assistant — answers from your records in this app. No clinical questions, and no patient information.</p>${assistantChatInner()}<div class="toolbar" style="margin-top:12px">${chips.map(q=>`<button type="button" class="secondary tiny" data-action="ask" data-id="${escapeHTML(q)}">${escapeHTML(q)}</button>`).join('')}</div><form id="assistantForm" class="chat-form"><label for="assistantInput" class="muted">Your question</label><input id="assistantInput" name="question" type="text" placeholder="Ask about your shifts, income, or credentials…" autocomplete="off"><button type="submit">Ask</button></form><div class="toolbar"><button type="button" class="secondary tiny" data-action="clear-chat">Clear chat history</button></div>`;
}
function assistantPage(){
  return `<section class="panel"><h2>Ask Assistant</h2>${assistantPanelHTML(ASSISTANT_STARTERS)}</section>${portalCheckHTML()}${portalMonitoringHTML()}`;
}
function submitAssistant(e){e.preventDefault();const input=$('assistantInput');if(!input)return;const q=input.value.trim();if(!q)return;input.value='';askAssistantLive(q)}
// Floating assistant (Nov 7, 2026): a button on every tab except the
// Assistant tab itself (you are already there), opening the SAME
// assistant as a sheet over whatever is on screen. Hidden whenever any
// other overlay is up — day sheet, editors, delete confirmation — so
// it never floats over a modal's buttons; those flows keep the screen
// until they close, and the button comes back. The sheet stacks ABOVE
// the base sheet layer (same tier as the stacked editors): opening it
// can cover the day sheet without closing it, and closing returns to
// the day sheet exactly as left. Close never touches page state: no tab
// change, scroll and in-progress forms preserved underneath (render()
// only rebuilds from state; opening/closing changes only
// assistantSheetOpen).
function assistantFabHTML(){
  if(tab==='Assistant'||assistantSheetOpen)return '';
  if(dayViewOpen||paycheckEdit||shiftDeleteConfirm||showShiftForm||editId)return '';
  return `<button type="button" class="assistant-fab" data-action="assistant-open" aria-label="Ask the assistant"><svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/><path d="M8.5 10.2l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z" fill="currentColor" stroke="none"/><path d="M15.6 5.4l.45 1.15 1.15.45-1.15.45-.45 1.15-.45-1.15-1.15-.45 1.15-.45z" fill="currentColor" stroke="none"/></svg></button>`;
}
function assistantSheetHTML(){
  if(!assistantSheetOpen)return '';
  return `<div class="sheet-backdrop assistant-backdrop" data-action="assistant-close"></div><div class="sheet assistant-sheet" role="dialog" aria-label="Assistant"><div class="sheet-head"><h2>Assistant</h2><button type="button" class="sheet-close" data-action="assistant-close" aria-label="Close">×</button></div>${assistantPanelHTML(ASSISTANT_QUICK_CHIPS)}</div>`;
}
function assistantOverlayHTML(){
  // Rendered at the END of every page's HTML (see render()) so the
  // sheet stacks above page content and the base day sheet.
  return assistantFabHTML()+assistantSheetHTML()+syncResultSheetHTML()+qgendaPreviewSheetHTML();
}
// Snapshot the mileage log form (values + panel open state) before any
// re-render wipes the DOM. No-ops when the form is not on screen; the
// hold flag lets a completed save / a cancelled edit skip one capture
// so stale values are never resurrected as a draft.
function captureMileageLogDraft(){
  if(mileageDraftHold){mileageDraftHold=false;return}
  try{
    if(typeof document==='undefined'||!document.querySelector||typeof FormData==='undefined')return;
    const form=document.querySelector('form[data-kind="mileage"]');
    if(!form)return;
    const panel=document.getElementById?document.getElementById('mileage-log-panel'):null;
    mileageFormDraft={forEditId:mileageFormRenderedFor||'',values:Object.fromEntries(new FormData(form)),open:!!(panel&&panel.open)};
  }catch(_){}
}
function render(){ captureMileageLogDraft(); captureCloudAuthDraft(); captureFeaturesPanelState(); capturePaystubCardPanelState(); if(window.__crnaBootWatch){clearTimeout(window.__crnaBootWatch);window.__crnaBootWatch=null} const ss=$('storageStatus');if(ss)ss.textContent=cloudHeaderLabel();$('nav').innerHTML=tabs.map(t=>`<button class="${tab===t?'active':''}" data-tab="${escapeHTML(t)}">${escapeHTML(t)}</button>`).join('');$('app').innerHTML=({Dashboard:dashboard,Facilities:facilitiesPage,Credentials:credentialsPage,Mileage:mileagePage,Assistant:assistantPage,Account:accountPage}[tab]||dashboard)()+assistantOverlayHTML();document.querySelectorAll('[data-tab]').forEach(b=>b.addEventListener('click',()=>setTab(b.dataset.tab)));document.querySelectorAll('[data-action]').forEach(b=>b.addEventListener('click',()=>actions(b.dataset.action,b.dataset.id,b.dataset.date,b.dataset.from)));document.querySelectorAll('[data-portal-connect]').forEach(a=>a.addEventListener('click',e=>portalConnectClick(a.dataset.portalConnect,e)));document.querySelectorAll('[data-shift-status]').forEach(el=>el.addEventListener('change',()=>{setShiftStatus(el.dataset.shiftStatus,el.value)}));document.querySelectorAll('[data-shift-origin]').forEach(el=>el.addEventListener('change',()=>{setShiftTripOrigin(el.dataset.shiftOrigin,el.value)}));document.querySelectorAll('form[data-kind]').forEach(f=>f.addEventListener('submit',submitEntry));const mt=$('manualTypeSelect');if(mt)mt.addEventListener('change',()=>{manualType=mt.value;editId=null;render();});const ssy=$('savedShiftsYear');if(ssy)ssy.addEventListener('change',()=>{savedShiftsYear=+ssy.value;render();});const dac=$('f_deleteAlsoFromCalendar');if(dac)dac.addEventListener('change',()=>{if(shiftDeleteConfirm)shiftDeleteConfirm.also=!!dac.checked});const mrw=$('mileageReviewWeekSelect');if(mrw)mrw.addEventListener('change',()=>{mileageReviewWeek=mrw.value;render();});const mrv=$('mileageReviewVehicleSelect');if(mrv)mrv.addEventListener('change',()=>{const wk=selectedMileageReviewWeek();mileageReviewVehicleWeek=wk;mileageReviewVehicleId=mrv.value;});const mlm=$('mileageLogMonthSelect');if(mlm)mlm.addEventListener('change',()=>{mileageLogMonth=mlm.value;render();});const mey=$('mileageExportYearSelect');if(mey)mey.addEventListener('change',()=>{mileageExportYear=mey.value;mileageExportSel=new Set();render();});document.querySelectorAll('.mileageExportMonth').forEach(el=>el.addEventListener('change',()=>{if(el.checked)mileageExportSel.add(el.value);else mileageExportSel.delete(el.value);const tot=$('mileageExportTotals');if(tot)tot.textContent=mileageExportTotalsLine();const dl=document.querySelector('[data-action="mileage-export-download"]');if(dl)dl.disabled=!mileageExportSelected().length;}));const schedForm=$('scheduleForm');if(schedForm)schedForm.addEventListener('submit',importSchedule);const qf=$('qgendaForm');if(qf)qf.addEventListener('submit',saveQgendaFeed);if(tab==='Account'||tab==='Facilities')qgendaStatusRefresh();const restore=$('restoreFile');if(restore)restore.addEventListener('change',restoreBackup);const facilityContractForm=$('facilityContractForm');if(facilityContractForm)facilityContractForm.addEventListener('submit',importFacilityContract);const paystubForm=$('paystubForm');if(paystubForm)paystubForm.addEventListener('submit',importPaystub);document.querySelectorAll('form.paystubCardForm').forEach(fm=>fm.addEventListener('submit',e=>importPaystubCard(e,fm.dataset.fac)));document.querySelectorAll('form.paystubImportForm').forEach(fm=>fm.addEventListener('submit',e=>importPaystubImport(e,fm.dataset.kind)));document.querySelectorAll('.paystubEdit').forEach(el=>el.addEventListener('change',()=>{if(!paystubPreview)return;paystubPreview[el.dataset.field]=el.value;const nd=$('paystubNextDates');if(nd)nd.textContent=paystubNextDatesText(paystubPreview)}));document.querySelectorAll('.cropRegionSelect').forEach(el=>{const k=el.dataset.kind+':'+el.dataset.i;if(cropRegionByPage[k])el.value=cropRegionByPage[k];el.addEventListener('change',()=>{cropRegionByPage[k]=el.value})});document.querySelectorAll('.facContractEdit').forEach(el=>el.addEventListener('change',()=>{if(!facilityContractPreview)return;const f=facilityContractPreview.facilities[+el.dataset.i];if(!f)return;if(FACILITY_RATE_KEYS.includes(el.dataset.field)){f.rates=f.rates||{};f.rates[el.dataset.field]=el.value}else f[el.dataset.field]=el.value}));document.querySelectorAll('.facContractInclude').forEach(el=>el.addEventListener('change',()=>{if(!facilityContractPreview)return;const f=facilityContractPreview.facilities[+el.dataset.i];if(f)f.include=el.checked}));const calendarForm=$('calendarForm');if(calendarForm)calendarForm.addEventListener('submit',importCalendar);document.querySelectorAll('.calEdit').forEach(el=>el.addEventListener('change',()=>{if(!calPreview)return;const r=calPreview.rows[+el.dataset.row];if(r){r[el.dataset.field]=el.value;if(el.dataset.field==='type'&&r.code!==undefined)r.code=el.value;if(el.dataset.field==='facility')r._userTypedFacility=!!String(el.value||'').trim()}}));document.querySelectorAll('.calFacilityAll').forEach(el=>el.addEventListener('change',()=>{if(calPreview){calPreview.facilityAll=el.value;render()}}));document.querySelectorAll('.calInclude').forEach(el=>el.addEventListener('change',()=>{if(!calPreview)return;const r=calPreview.rows[+el.dataset.row];if(r)r.include=el.checked}));document.querySelectorAll('.schedEdit').forEach(el=>el.addEventListener('change',()=>{if(!schedulePreview)return;const r=schedulePreview.rows[+el.dataset.row];if(r){r[el.dataset.field]=el.value;if(el.dataset.field==='type'&&r.code!==undefined)r.code=el.value;if(el.dataset.field==='facility')r._userTypedFacility=!!String(el.value||'').trim()}}));document.querySelectorAll('.schedFacilityAll').forEach(el=>el.addEventListener('change',()=>{if(schedulePreview){schedulePreview.facilityAll=el.value;render()}}));document.querySelectorAll('.schedInclude').forEach(el=>el.addEventListener('change',()=>{if(!schedulePreview)return;const r=schedulePreview.rows[+el.dataset.row];if(r)r.include=el.checked}));document.querySelectorAll('.importConflictOverride').forEach(el=>el.addEventListener('change',()=>{const p=el.dataset.kind==='cal'?calPreview:el.dataset.kind==='contract'?contractPreview:schedulePreview;if(!p)return;p.conflictOverrides=p.conflictOverrides||{};p.conflictOverrides[el.dataset.key]=!!el.checked}));
document.querySelectorAll('.previewPayUnit').forEach(el=>el.addEventListener('change',()=>{const p=el.dataset.kind==='cal'?calPreview:schedulePreview;if(p){p.payUnit=el.value==='hourly'?'hourly':'daily';render()}}));
document.querySelectorAll('.impPaySched').forEach(el=>el.addEventListener('change',()=>{const p=el.dataset.kind==='cal'?calPreview:el.dataset.kind==='contract'?contractPreview:el.dataset.kind==='faccontract'?facilityContractPreview:schedulePreview;if(p){p.paySchedDraft=p.paySchedDraft||{};p.paySchedDraft[el.dataset.field]=el.value}}));document.querySelectorAll('.facPaySched').forEach(el=>el.addEventListener('change',()=>{const f=(db.facilities||[]).find(x=>x.id===el.dataset.fac);if(f){facPaySchedDrafts[f.id]=facPaySchedDrafts[f.id]||{};facPaySchedDrafts[f.id][el.dataset.field]=el.value}}));document.querySelectorAll('.clarifyHourly').forEach(el=>el.addEventListener('change',()=>{const p=el.dataset.kind==='cal'?calPreview:schedulePreview;if(p){p.clarifyDraft=p.clarifyDraft||{hourlyRate:'',codes:{}};p.clarifyDraft.hourlyRate=el.value}}));document.querySelectorAll('.clarifyCodeLabel').forEach(el=>el.addEventListener('change',()=>{const p=el.dataset.kind==='cal'?calPreview:schedulePreview;if(p){p.clarifyDraft=p.clarifyDraft||{hourlyRate:'',codes:{}};p.clarifyDraft.codes=p.clarifyDraft.codes||{};const c=p.clarifyDraft.codes[el.dataset.code]=p.clarifyDraft.codes[el.dataset.code]||{};c.label=el.value}}));document.querySelectorAll('.clarifyCodeHours').forEach(el=>el.addEventListener('change',()=>{const p=el.dataset.kind==='cal'?calPreview:schedulePreview;if(p){p.clarifyDraft=p.clarifyDraft||{hourlyRate:'',codes:{}};p.clarifyDraft.codes=p.clarifyDraft.codes||{};const c=p.clarifyDraft.codes[el.dataset.code]=p.clarifyDraft.codes[el.dataset.code]||{};c.hours=el.value}}));document.querySelectorAll('.clarifyCodeWeekday').forEach(el=>el.addEventListener('change',()=>{const p=el.dataset.kind==='cal'?calPreview:schedulePreview;if(p){p.clarifyDraft=p.clarifyDraft||{hourlyRate:'',codes:{}};p.clarifyDraft.codes=p.clarifyDraft.codes||{};const c=p.clarifyDraft.codes[el.dataset.code]=p.clarifyDraft.codes[el.dataset.code]||{};c.weekdayPay=el.value}}));document.querySelectorAll('.clarifyCodeWeekend').forEach(el=>el.addEventListener('change',()=>{const p=el.dataset.kind==='cal'?calPreview:schedulePreview;if(p){p.clarifyDraft=p.clarifyDraft||{hourlyRate:'',codes:{}};p.clarifyDraft.codes=p.clarifyDraft.codes||{};const c=p.clarifyDraft.codes[el.dataset.code]=p.clarifyDraft.codes[el.dataset.code]||{};c.weekendPay=el.value}}));document.querySelectorAll('.clarifyCodePaidHours').forEach(el=>el.addEventListener('change',()=>{const p=el.dataset.kind==='cal'?calPreview:schedulePreview;if(p){p.clarifyDraft=p.clarifyDraft||{hourlyRate:'',codes:{}};p.clarifyDraft.codes=p.clarifyDraft.codes||{};const c=p.clarifyDraft.codes[el.dataset.code]=p.clarifyDraft.codes[el.dataset.code]||{};c.paidHours=el.value}}));document.querySelectorAll('.describeText').forEach(el=>el.addEventListener('change',()=>{const st=describeState(el.dataset.key);if(st){st.text=el.value;st.parsed=null;st.confirmed=false;st.error=''}}));const af=$('assistantForm');if(af)af.addEventListener('submit',submitAssistant);if(assistantSheetOpen){const ai=$('assistantInput');if(ai&&ai.focus)ai.focus();const sc=document.querySelector('.assistant-sheet .chat');if(sc)sc.scrollTop=sc.scrollHeight;}const cf=$('cloudAuthForm');if(cf)cf.addEventListener('submit',submitCloudAuth);const mi=$('f_miles');if(mi)mi.addEventListener('change',()=>{const s=$('f_milesSource');if(s&&s.value==='auto'){s.value='manual-override';const st=$('mileageCalcStatus');if(st)st.textContent='Miles edited — this trip is now your manual override of the auto-calculated distance.'}});const tt=$('f_tripType');if(tt)tt.addEventListener('change',()=>{const owEl=$('f_oneWayMiles'),milesEl=$('f_miles'),srcEl=$('f_milesSource'),t=tt.value==='one-way'?'one-way':'round-trip';let m=null;const ow=owEl&&Number(owEl.value)>0?Number(owEl.value):null;if(ow!=null&&srcEl&&srcEl.value==='auto')m=tripMilesFor(ow,t);else if(milesEl&&Number(milesEl.value)>0)m=t==='one-way'?Math.round(Number(milesEl.value)/2*10)/10:roundTripMiles(milesEl.value);if(m!=null&&milesEl){milesEl.value=String(m);const st=$('mileageCalcStatus');if(st){st.textContent='Mileage type changed — miles updated to '+m.toFixed(1)+' mi '+tripTypeLabel(t)+'.';mileageCalcStatus=st.textContent}}});const mtt=$('mileageTripTypeSelect');if(mtt)mtt.addEventListener('change',()=>{db.settings.mileageTripType=mtt.value==='one-way'?'one-way':'round-trip';persist();render();});const di=$('f_distance');if(di)di.addEventListener('change',()=>{const s=$('f_distanceSource');if(s&&s.value==='auto'){s.value='manual';const st=$('facilityDistanceStatus');if(st)st.textContent='Distance edited — now saved as a manual distance.'}})}
function field(name,label,type='text',value='',extra=''){return `<div class="field"><label for="f_${name}">${label}</label><input id="f_${name}" name="${name}" type="${type}" value="${escapeHTML(value)}" ${extra}></div>`}
function area(name,label,value='',placeholder=''){return `<div class="field wide"><label for="f_${name}">${label}</label><textarea id="f_${name}" name="${name}" placeholder="${escapeHTML(placeholder)}">${escapeHTML(value)}</textarea></div>`}
function select(name,label,options,value){return `<div class="field"><label for="f_${name}">${label}</label><select name="${name}" id="f_${name}">${options.map(o=>`<option value="${escapeHTML(o)}" ${o===value?'selected':''}>${escapeHTML(o)}</option>`).join('')}</select></div>`}
function selectLabeled(name,label,pairs,value){return `<div class="field"><label for="f_${name}">${label}</label><select name="${name}" id="f_${name}">${pairs.map(([v,l])=>`<option value="${escapeHTML(v)}" ${v===value?'selected':''}>${escapeHTML(l)}</option>`).join('')}</select></div>`}
function formEnd(label){return `<div class="form-actions"><button type="submit">${label}</button>${editId?'<button type="button" class="secondary" data-action="cancel">Cancel</button>':''}</div></form>`}
function list(kind,items,description){return items.length?items.map(x=>`<div class="item"><div>${description(x)}</div><div class="item-actions"><button class="tiny secondary" data-action="edit-${kind}" data-id="${escapeHTML(x.id)}">Edit</button><button class="tiny danger" data-action="delete-${kind}" data-id="${escapeHTML(x.id)}">Delete</button></div></div>`).join(''):'<p class="muted">No records yet.</p>'}
function calendar(){const y=month.getFullYear(),m=month.getMonth(),prefix=`${y}-${String(m+1).padStart(2,'0')}`,start=new Date(y,m,1).getDay(),days=new Date(y,m+1,0).getDate();let grid=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(x=>`<div class="weekday">${x}</div>`).join('');for(let n=0;n<start;n++)grid+='<div class="day blank"></div>';const paysByMonth=paystubOccurrencesInMonth(prefix);const conflictDates=new Set(activeDayConflicts().map(c=>c.date));for(let n=1;n<=days;n++){const date=`${prefix}-${String(n).padStart(2,'0')}`,entries=shiftsOnDay(date),pays=paysByMonth.filter(p=>p.date===date);grid+=`<button class="day ${date===localDate(new Date())?'today':''} ${date===selected?'selected':''}" data-action="day" data-date="${date}" aria-label="${fmt(date)}: ${entries.length} shifts${pays.length?`, ${pays.length} estimated paycheck(s)`:''}"><span class="day-number">${n}</span>${conflictDates.has(date)?`<span class="chip conflict-flag" title="Booked at two hospitals this day">⚠ 2 hospitals</span>`:''}${entries.slice(0,3).map(x=>`<span class="chip ${/24.hour/i.test(x.type)?'call':/second/i.test(x.type)?'second':/off|pto/i.test(x.type)?'off':''}">${escapeHTML(shiftChipLabel(x))}</span>`).join('')}${pays.slice(0,2).map(p=>{const amt=paystubOccurrenceAmount(p);return `<span class="chip paycheck" title="${p.isActual?`Paycheck — ${escapeHTML(p.agency)} — ${currency(p.actual)} actual ${p.actualBasis==='entered'?'you entered from the calendar':'from your pay stub'} for ${fmt(p.periodStart)} – ${fmt(p.periodEnd)}.`:`Estimated paycheck — ${escapeHTML(p.agency)} — calculated from your shifts in ${fmt(p.periodStart)} – ${fmt(p.periodEnd)}${p.shiftCount?`: ${currency(paystubOccurrenceTotal(p))} gross${p.unpriced?`, ${p.unpriced} shift(s) not priced yet — may be low`:''}`:' — no shifts recorded for this period yet'}. Always double-check against your actual paystubs.`}">💰 ${escapeHTML(p.agency||'Paycheck')}<br>${p.isActual?'actual '+currency(p.actual):amt!=null?'est. '+currency(amt):p.shiftCount?'incomplete':'payday'}</span>`}).join('')}${entries.length+pays.length>3?`<span class="muted">+${entries.length+pays.length-3}</span>`:''}</button>`}const shifts=db.shifts.filter(x=>x.date?.startsWith(prefix));const head=monthHeadline(prefix);const bannerQual=head.anyActual?'incl. actual from pay stub':head.partial?'paychecks + other shifts':'';const banner=`<div class="month-banner"><span>${month.toLocaleDateString('en-US',{month:'long',year:'numeric'})}</span><span>Expected gross <strong>${currency(head.gross)}</strong>${bannerQual?` <span class="mb-qual">· ${bannerQual}</span>`:''}</span></div>`;return `<section class="panel"><div class="toolbar"><button class="secondary" data-action="prev" aria-label="Previous month">‹</button><h2>${month.toLocaleDateString('en-US',{month:'long',year:'numeric'})}</h2><button class="secondary" data-action="next" aria-label="Next month">›</button><button class="secondary tiny" data-action="today">Today</button></div>${banner}<div class="calendar">${grid}</div><p class="muted">${shifts.length} shifts · Tap a day to see its shifts, add one, or delete one</p>${paysByMonth.length?`<p class="muted">💰 = paycheck calculated from your shifts in its pay period (a stub's own check shows its actual) — ${PAYSTUB_DISCLAIMER}</p>`:''}</section>`}

function onboardingSteps(){
  const signedIn = (typeof cloudSession !== 'undefined') && !!cloudSession;
  const calConnected = (typeof liveSyncConnectedProviders === 'function') ? liveSyncConnectedProviders().length > 0 : false;
  const scheduleImported = !!(db.settings && db.settings.scheduleImported);
  const qgendaConnected = !!(db.settings && db.settings.qgendaConnected);
  const cred = (typeof cloudLocalHasRecords === 'function') ? cloudLocalHasRecords() : ((db.licenses || []).length > 0);
  const docs = (db.documents || []).length > 0;
  const facilitiesDone = (db.facilities || []).some(facilityHasRateOrContract);
  return [
    {n:1, title:'Create your account', direction:'Create your account, add the name as it appears on your schedule and licenses, pick W-2, 1099, or both, and set a monthly income goal — or skip it.', done:signedIn, tab:'Account', panel:''},
    {n:2, title:'Sync calendars or upload a schedule', direction:'Connect a calendar once, or upload a schedule — the app picks out only your shifts.', done:calConnected||scheduleImported||qgendaConnected, tab:'Account', panel:'live-sync-panel'},

    {n:3, title:'Add facilities & contracts', direction:'Upload your contract and we’ll extract your dates and pay — or enter a facility by hand; a pay stub is optional.', done:facilitiesDone, tab:'Facilities', panel:''},
    {n:4, title:'Connect credentialing services and licenses', direction:'Connect NBCRNA, AANA, and your state licenses — sign in on the portal’s own page, never a password here.', done:cred, tab:'Credentials', panel:''},
    {n:5, title:'Upload certifications', direction:'Upload a cert and we’ll read its expiration date.', done:docs, tab:'Credentials', panel:'cert-documents'}
  ];
}
// A facility counts for the facilities step when it has a pay rate or a
// contract on file — a bare name with neither is not a usable facility,
// so it does not check the step off.
function facilityHasRateOrContract(f){
  if(!f||typeof f!=='object')return false;
  if(facilityRateSummary(f).set.length>0)return true;
  const nm=String(f.name||'').trim().toLowerCase();
  if(!nm)return false;
  return (db.contracts||[]).some(c=>String(c.facility||'').trim().toLowerCase()===nm);
}

function onboardingHTML(){
  if (db.settings && db.settings.onboardingDismissed) return '';
  const steps = onboardingSteps();
  if (steps.every(x => x.done)) return '';
  const doneCount = steps.filter(x => x.done).length;
  return `<section class="panel"><h2>Getting started</h2><p class="muted">${doneCount} of ${steps.length} done — in order.</p><ol class="onboard-steps">${steps.map(x => `<li class="onboard-step ${x.done ? 'done' : ''}"><span class="onboard-check">${x.done ? '✓' : '○'}</span><div><strong>${x.n}. ${escapeHTML(x.title)}</strong>${x.done ? ' <span class="pill">done</span>' : ''}<div class="toolbar"><button type="button" class="${x.done ? 'secondary' : ''}" data-action="onboard-goto" data-id="${escapeHTML(x.tab)}"${x.panel ? ` data-date="${x.panel}"` : ''}>${x.done ? 'Review' : 'Start'} →</button></div></div></li>`).join('')}</ol><div class="toolbar"><button type="button" class="secondary tiny" data-action="onboard-dismiss">Skip for now — hide this guide</button></div><p class="muted">Hiding this guide deletes nothing — every step is still on its tab.</p></section>`;
}
// Getting-started direction (Nov 6, 2026): the guide list carries no
// paragraphs — just step number, title, done check, and Start/Review.
// Each step's one-to-two-line direction lives on the step as
// `direction` and is shown only on that step's own page, only after the
// user taps Start/Review for it, and only while the step is still undone.
let onboardStep=0;
function onboardDirectionHTML(n){
  const s=onboardingSteps().find(x=>x.n===n);
  if(onboardStep!==n||!s||s.done)return '';
  return `<p class="hint" data-onboard-direction="${n}"><strong>Step ${n} — ${escapeHTML(s.title)}:</strong> ${escapeHTML(s.direction)}</p>`;
}
// --- Confirmed / proposed income panel (Dashboard + Saved shifts) ---
// One table per selected year: YTD and predicted-annual for each of C, P.
function incomeCSPTableHTML(y,split){
  const row=(label,key)=>`<tr><td>${label}</td><td><strong>${currency(split.c[key])}</strong></td><td><strong>${currency(split.p[key])}</strong></td></tr>`;
  // One-tap fix for pre-Bug-1 imports (Nov 6, 2026): past shifts still
  // proposed count in P only, so C year-to-date reads $0. The button
  // shows only while such shifts exist in this year.
  const pastN=pastProposedShifts(y).length;
  // Unrecognized calendar events (Nov 6, 2026): sync already tracks
  // held events per hospital that is not a facility yet, in
  // db.facilitySuggestions (each carries a count). Those shifts are
  // in no total — the "Why might these totals be off?" toggle below
  // says so, with the live count when there is one.
  const unrecogN=(db.facilitySuggestions||[]).reduce((n,sg)=>n+(Number(sg&&sg.count)||0),0);
  // Dashboard cleanup (Nov 6, 2026): the table alone shows by default.
  // The C/P explanation, the priced-shift counts, and the paystub
  // disclaimer moved behind a collapsed "What do C, S and P mean?"
  // toggle on this card — out of the main Dashboard flow. The
  // disclaimer also lives in small print on the Account tab. A second
  // collapsed toggle, "Why might these totals be off?", explains that
  // the totals only count shifts the app could see and recognize.
  // Stub reconciliation note (Nov 6, 2026): when the Dashboard split
  // carries applied stub actuals (reconciledYearSplit), say exactly
  // what was swapped, with the numbers, so the user can verify a total
  // against their stub — e.g. predicted $11,500, stub actual
  // $12,757.50, so the period contributes +$1,257.50 over its shifts.
  const stubNotes=(split.stubActuals||[]).map(r=>r.actualBasis==='entered'?`<p class="muted">Actual you entered included: ${currency(r.actual)} for ${escapeHTML(r.agency)} (${fmt(r.periodStart)} – ${fmt(r.periodEnd)}) replaces that period's shift sum (${currency(r.shiftSum)}) in the totals above — ${r.delta>=0?'+':'−'}${currency(Math.abs(r.delta))} vs the shifts alone. Every other period counts its shifts as usual — never both.</p>`:`<p class="muted">Pay stub actual included: ${currency(r.actual)} from your ${escapeHTML(r.agency)} pay stub for ${fmt(r.periodStart)} – ${fmt(r.periodEnd)} replaces that period's shift sum (${currency(r.shiftSum)}) in the totals above — ${r.delta>=0?'+':'−'}${currency(Math.abs(r.delta))} vs the shifts alone.${r.shiftCount===0?' No shifts were recorded for that period, so the stub amount is counted on its own.':''} Every other period counts its shifts as usual — never both.</p>`).join('');
  const explain=`C is confirmed income you can plan on — shifts from your calendar, a contract, QGenda, or an upload arrive confirmed, because they are on a real schedule. P adds proposed shifts too — possible income you are still lining up, not confirmed. ${split.byStatus?`Priced shifts in ${y}: ${split.byStatus.confirmed+split.byStatus.completed} confirmed/completed, ${split.byStatus.proposed} proposed${split.byStatus.rejected||split.byStatus.canceled?`, ${split.byStatus.rejected} rejected, ${split.byStatus.canceled} canceled (counted in no total)`:''}.`:''}${split.unpriced?` ${split.unpriced} shift(s) in ${y} unpriced — not included in any total, never $0.`:''}${split.w2Salary?` ${split.w2Salary} W-2 salary day(s) (Off / PTO) excluded — paid through W-2 salary, never double-counted.`:''}${pastN?` ${pastN} shift${pastN===1?'':'s'} in ${y} dated before today ${pastN===1?'is':'are'} still proposed, so ${pastN===1?'it counts':'they count'} in P only — not in Confirmed (C) year to date. The button above marks ${pastN===1?'it':'them'} confirmed in one tap; manually added future shifts stay as you set them, and unpriced shifts stay unpriced (never $0).`:''}`;
  return `<div class="table-scroll"><table class="csp-table"><thead><tr><th></th><th>C — Confirmed only</th><th>P — Proposed-inclusive</th></tr></thead><tbody>${row('Year to date','ytd')}${row('Predicted '+y+' annual','predicted')}</tbody></table></div>${stubNotes}${pastN?`<div class="toolbar"><button type="button" data-action="confirm-past-shifts" data-id="${y}">Mark ${pastN} past shift${pastN===1?'':'s'} as confirmed</button></div>`:''}${!employmentIncludes1099()?`<p class="muted">Employment type: W-2 only — your pay comes as salary, so these per-shift totals are $0 and do not apply. Change the employment type on the Account tab if you also work 1099.</p>`:''}<details class="csp-info"><summary>What do C and P mean?</summary><p class="muted">${explain}</p><p class="muted">${INCOME_DISCLAIMER}</p></details><details class="csp-info"><summary>Why might these totals be off?</summary><p class="muted">These totals are built only from the shifts CRNA Hub can see in your calendar. Any shift that wasn't recognized or imported isn't counted, so the totals can understate your real income — mostly when you're first starting out. The longer you use the app, the better our information gets. Always check against your paystubs.</p>${unrecogN?`<p class="muted">${unrecogN===1?`1 calendar event wasn't recognized as a shift and isn't counted yet — add the hospital on the Facilities tab to include it.`:`${unrecogN} calendar events weren't recognized as shifts and aren't counted yet — add the hospital on the Facilities tab to include them.`}</p>`:''}</details>`;
}
function incomeCSPHTML(y,split){return `<section class="panel"><h2>Income · ${y} — confirmed vs proposed</h2>${incomeCSPTableHTML(y,split)}</section>`}
// --- Step 1 profile: name, employment type, monthly income goal ---
// One profile, collected in onboarding step 1 and editable on the Account
// tab. The name is stored once (settings.scheduleName) and labelled to
// cover both uses: it is the name as it appears on the schedule AND on
// licenses — schedule import picks only that person's shifts, and portal
// records are matched to the same name. Employment type drives the income
// engine (see isBillableShift): W-2 salary is never double-counted,
// 1099 shifts price from contracts/facilities, hybrid does both.
// The income goal is optional: 0 means unset (skipped), never $0.
// Profile fields sync to Supabase Auth user_metadata when signed in
// (cloudSaveProfile / signup data) — no new table, no migration.
const EMPLOYMENT_TYPES=['w2','1099','both'];
function employmentType(){const v=String((db.settings&&db.settings.employmentType)||'').trim().toLowerCase();return EMPLOYMENT_TYPES.includes(v)?v:''}
function employmentTypeLabel(){return {w2:'W-2', '1099':'1099', both:'W-2 + 1099'}[employmentType()]||'Not set'}
function employmentIncludes1099(){const t=employmentType();return t===''||t==='1099'||t==='both'}
function profileName(){return scheduleName()}
// Apply profile values from a form. A key left undefined is left alone;
// name/employment are only saved when non-empty (a blank form field must
// never wipe a saved value on sign-in); monthlyIncomeGoal 0 unsets the
// goal, a positive number sets it.
function applyProfileValues(v,opts){
  db.settings=db.settings||{};
  if(v&&typeof v.name==='string'&&v.name.trim())db.settings.scheduleName=v.name.trim();
  if(v&&typeof v.employmentType==='string'&&EMPLOYMENT_TYPES.includes(v.employmentType))db.settings.employmentType=v.employmentType;
  if(v&&typeof v.monthlyIncomeGoal==='number'&&Number.isFinite(v.monthlyIncomeGoal))db.settings.monthlyIncomeGoal=v.monthlyIncomeGoal>0?Math.round(v.monthlyIncomeGoal*100)/100:0;
  persist();
}
function profileMetadata(){
  // user_metadata payload for Supabase Auth (signup data + profile save).
  // Only non-empty values are sent; the goal is sent as a number when
  // set, or null when unset so a cleared goal clears server-side too.
  const data={};
  const nm=profileName();if(nm)data.schedule_name=nm;
  const et=employmentType();if(et)data.employment_type=et;
  data.monthly_income_goal=monthlyIncomeGoal()>0?monthlyIncomeGoal():null;
  return data;
}
// --- Monthly income goal (step 1 profile only — removed from Dashboard Nov 5, 2026) ---
// A monthly $ goal, stored per user in settings. Set / edited on the
// Account tab (Profile — step 1); the Assistant still reads it from here
// (buildAssistantSummary month context). No Dashboard widget any more.
function monthlyIncomeGoal(){return num(db.settings&&db.settings.monthlyIncomeGoal)}

function dashboard(){const now=localDate(new Date()),prefix=now.slice(0,7),current=db.shifts.filter(x=>x.date?.startsWith(prefix)),gross=monthHeadline(prefix).gross,upcoming=db.shifts.filter(x=>x.date>=now).sort((a,b)=>a.date.localeCompare(b.date)).slice(0,6),expiring=deadlinesWithin90().length,ytdSplit=reconciledYearSplit(currentYear());return `<section class="panel"><h2>Overview · ${new Date().toLocaleDateString('en-US',{month:'long',year:'numeric'})}</h2><div class="stats"><div class="stat"><strong>${current.length}</strong>Shifts this month</div><div class="stat"><strong>${currency(gross)}</strong>Expected gross · this month (all statuses)</div><div class="stat"><strong>${db.facilities.length}</strong>Facilities</div>${featureOn('featureCredentials')?`<div class="stat"><strong>${expiring}</strong>Credential & certification deadlines (90 days)</div>`:''}</div></section>${dashboardConflictAlertsHTML()}${dashboardFacilitySuggestionsHTML()}${dashboardRulesHealHTML()}${dashboardQgendaNoticeHTML()}${onboardingHTML()}${calendar()}${dayViewHTML()}${paystubUpcomingHTML()}${incomeCSPHTML(currentYear(),ytdSplit)}<div class="two"><section class="panel"><h2>Upcoming shifts</h2>${upcoming.length?upcoming.map(x=>`<div class="item"><strong>${fmt(x.date)}</strong> · ${escapeHTML(shiftFacilityLabel(x))}<div class="muted">${escapeHTML(x.type)} · ${x.pay===''||x.incomplete?'Pay not yet priced':currency(x.pay)} · ${shiftStatusLabel(x.status)}</div></div>`).join(''):'<p class="muted">No upcoming shifts.</p>'}</section><section class="panel"><h2>Quick actions</h2><div class="toolbar"><button data-action="add-shift">Add shift</button><button class="secondary" data-action="export-shifts">Export shifts</button><button class="secondary" data-action="backup">Back up data</button><button class="secondary" data-action="ask-assistant">Ask Assistant</button><button class="secondary" data-action="proposed-email">Email proposed shifts</button></div><p class="hint">${cloudModeHint()} Export backups regularly.</p></section></div>${shiftFormOverlayHTML()}${paycheckOverlayHTML()}${shiftDeleteOverlayHTML()}${proposedEmailSheetHTML()}`}
// The shift editor opens as a sheet over the page (Nov 7, 2026 overlay
// model), stacked over the day sheet when one is open; Cancel or a
// backdrop tap closes it back to the day sheet.
function shiftFormOverlayHTML(){if(!(showShiftForm||(editId&&db.shifts.some(x=>x.id===editId))))return '';return `<div class="sheet-backdrop sheet-backdrop-over" data-action="cancel"></div><div class="sheet sheet-over" role="dialog" aria-label="Shift editor">${shiftFormHTML()}</div>`}
// Manual adds ASK (Nov 6, 2026 status model): a shift added by hand
// is the one place a status is a real question — sourced shifts all
// arrive confirmed on their own. The picker is a required, visible
// two-option choice at the top level of the add form (default
// Proposed), never a buried default.
function manualStatusPickerHTML(){return `<div class="field"><label for="f_status">Confirmed or proposed?</label><select name="status" id="f_status" required><option value="proposed" selected>Proposed — still lining it up</option><option value="confirmed">Confirmed — it is on a real schedule</option></select></div>`}
function manualShiftConflictHTML(){if(!pendingManualShift)return '';const rec=pendingManualShift.record,ag=pendingManualShift.against;return `<div class="conflict-warning" style="border:2px solid #b45309;border-radius:10px;padding:12px;margin-bottom:12px"><h3 style="margin-top:0">${DOUBLE_BOOKING_HEADING}</h3><p>${escapeHTML(conflictTextFor(rec,ag))}.</p><p class="muted">Your entry is still filled in below — pick another day, or add it anyway if you really have both.</p><div class="toolbar"><button type="button" data-action="manual-shift-anyway">Add it anyway — I really have both</button><button type="button" class="secondary" data-action="manual-shift-cancel">Not now</button></div></div>`}
function shiftFormHTML(){const x=db.shifts.find(x=>x.id===editId)||(!editId&&pendingManualShift?pendingManualShift.record:{}),f=db.facilities;const statusField=editId?select('status','Status',SHIFT_STATUSES,normalizeShiftStatus(x.status)):manualStatusPickerHTML();return `<section class="panel"><h2>${editId?'Edit':'Add'} shift</h2>${!editId?manualShiftConflictHTML():''}<form id="entryForm" data-kind="shifts"><div class="form-grid">${field('date','Date','date',x.date||selected,'required')}${field('facility','Hospital / facility','text',x.facility||'','list="facilityNames" required')}<datalist id="facilityNames">${f.map(a=>`<option value="${escapeHTML(a.name)}"></option>`).join('')}</datalist>${select('type','Shift type',['8-hour day','12-hour shift','24-hour call','Second call','Other','Off / PTO'],x.type||'8-hour day')}${statusField}${field('pay','Expected gross pay ($)','number',x.pay??'','min="0" step="0.01" placeholder="Auto from facility"')}${area('note','Shift notes',x.note||'')}</div>${formEnd(editId?'Save changes':'Add shift')}${editId?'':''}<p class="muted">Leave pay blank to use the saved facility rate.</p>${!employmentIncludes1099()?'<p class="muted">Employment type: W-2 only — pay entered here is not counted as billable income, because your pay comes as salary. Off / PTO days are salary days.</p>':''}${editId?'<p class="muted">Changing the status re-prices the totals right away.</p>':'<p class="muted">Shifts you sync or import arrive Confirmed on their own — this choice is only for shifts you add by hand.</p>'}${editId?'':'<div class="toolbar"><button type="button" class="secondary" data-action="cancel">Close form</button></div>'}</section>`}
// One day selection for every surface (Nov 7, 2026 day-sheet fix):
// the calendar grid and the day sheet both take a day's shifts from
// shiftsOnDay, so they can never disagree about what a day holds.
function shiftsOnDay(dateStr){return (db.shifts||[]).filter(x=>x.date===dateStr)}
// One facility label for every surface: the saved facility name; for a
// shift with NO facility (a grid-schedule upload — grids print none),
// "Off" only when the shift really is an Off / PTO day, otherwise
// "No facility yet". Never a blank title and never a false "Off":
// a facility-less worked shift used to render as an "Off" chip on the
// calendar and a blank row in the day sheet, so next to a labelled
// Holzer shift the uploaded shift was effectively invisible.
function shiftFacilityLabel(x){const f=String((x&&x.facility)||'').trim();if(f)return f;if(x&&/off|pto/i.test(String(x.type||'')))return 'Off';return 'No facility yet'}
// Calendar grid chip label (Nov 8, 2026, Caleb): "once it's placed on
// the calendar, only put what the shift is, like 5** or 7. Too much
// info on the calendar." The month-grid chip shows ONLY the shift's
// code / short type — no facility name, no times, no rate, no call
// notes. The code is the original code as read at import (stored on
// the shift as `code` at approve time); for a clarified code the CODE
// shows, never the label the user typed — the label and hours live in
// the day sheet and the facility's codeMap. A shift saved before codes
// were stored still resolves through its facility's codeMap when its
// type IS a clarified label. Shifts with no code at all (calendar
// sync, manual entry) show their short type text alone — that text is
// what the shift is. Full detail stays in the day sheet, the shift
// editor, and the paycheck views, which are unchanged. (The titles
// pushed to the external "CRNA Hub" calendar come from a separate
// server-side builder — shiftTitle in supabase/functions/_shared —
// and are deliberately NOT changed here.)
function shiftChipLabel(x){
  if(!x)return 'Shift';
  let code=normalizeCodeKey(x.code||'');
  // A trailing bracketed assignee the name cleaner could not judge
  // (this device does not know the schedule name yet, so "[Martin]"
  // survived normalizeCodeKey) is still never part of what the shift
  // IS — the chip drops a trailing name-like bracket group (letters
  // and spaces only). A bracket holding digits or symbols is real
  // code text and stays. Display only: the stored code is untouched,
  // and every lookup normalizes both sides identically either way.
  if(code)code=code.replace(/\s*\[[A-Za-z][A-Za-z\s,.'-]*\]$/,'').trim();
  if(code)return code;
  const fac=x.facility?facilityByNameOrAlias(x.facility):null;
  if(fac){const defs=facilityCodeDefs(fac);const t=String(x.type||'').trim();for(const k of Object.keys(defs)){const lab=String((defs[k]&&defs[k].label)||'').trim();if(lab&&lab===t)return k}}
  return shiftShortTypeLabel(x.type);
}
function shiftShortTypeLabel(type){
  let t=String(type||'').trim();if(!t)return 'Shift';
  t=t.replace(/\$\s?[\d,]+(\.\d+)?(\s?\/\s?(hr|hour))?/gi,'').replace(/\s+/g,' ').trim();
  const first=(t.split(/[.\n—–|]/)[0]||'').trim()||t;
  if(first.length<=20)return first;
  let out='';for(const w of first.split(' ')){if(!w)continue;const cand=out?out+' '+w:w;if(cand.length>20)break;out=cand}
  return out||first.slice(0,20);
}
function dayViewHTML(){
  if(!dayViewOpen)return '';
  const rows=shiftsOnDay(selected).slice().sort((a,b)=>String(a.facility||'').localeCompare(String(b.facility||'')));
  // The day detail is a bottom-sheet OVERLAY (Nov 7, 2026): it used to
  // render as a section below the calendar in the page flow, so on a
  // phone a tap looked like nothing happened — the sheet was several
  // screens down. Now it pops up in front of the calendar: dimmed
  // backdrop (tap to close), an × button, swipe-down to close.
  const head=`<div class="sheet-backdrop" data-action="close-day"></div><section class="sheet" id="day-view" role="dialog" aria-label="Day detail"><div class="sheet-head"><h2>${fmt(selected)}</h2><button type="button" class="sheet-close" data-action="close-day" aria-label="Close">×</button></div>`;
  // Paychecks landing on this day get their own labelled section at
  // the TOP of the sheet (above the shifts), with a visible Edit
  // paycheck button into the same editor the Upcoming paychecks panel
  // uses — a payday is exactly where a user goes to correct a check,
  // shifts or no shifts. Hidden entirely when the Paycheck estimates
  // feature is off, like the calendar chips and the panel.
  const pays=featureOn('featurePaychecks')?paystubOccurrencesOn(selected):[];
  const paysSection=dayPaycheckSectionHTML(pays);
  if(!rows.length)return `${head}${paysSection}<p class="muted">No shifts on this day yet.</p><div class="toolbar"><button data-action="add-shift">Add a shift on this day</button></div></section>`;
  return `${head}${paysSection}${list('shifts',rows,x=>`<div class="item-title">${escapeHTML(shiftFacilityLabel(x))}</div><div class="muted">${escapeHTML(x.type)} · ${x.pay===''||x.incomplete?'Pay not yet priced — incomplete':currency(x.pay)}${isW2SalaryShift(x)?' · <span class="pill">W-2 salary day — excluded from income totals</span>':''}${x.source==='extracted-from-contract'?' · <span class="pill">from contract</span>':x.source==='extracted-from-contract-photo'?' · <span class="pill">from contract photo</span>':x.source==='user-entered'?' · <span class="pill">user-entered</span>':x.source&&x.source.startsWith('calendar-')?' · <span class="pill">'+escapeHTML({"calendar-google":"from Google Calendar","calendar-apple":"from Apple Calendar","calendar-outlook":"from Outlook","calendar-file":"from calendar file"}[x.source]||'from calendar')+'</span>':''}${typeof liveSyncShiftSyncLabel==='function'?liveSyncShiftSyncLabel(x):''}</div><div class="muted"><label>Status <select data-shift-status="${escapeHTML(x.id)}" aria-label="Status for shift on ${escapeHTML(x.date)}">${shiftStatusOptions(x.status)}</select></label></div>${shiftTripOriginHTML(x)}<div class="muted"><a href="${googleCalUrl(x)}" target="_blank" rel="noopener">Add to Google</a> · <a href="${outlookCalUrl(x)}" target="_blank" rel="noopener">Add to Outlook</a></div>${x.note?`<p>${escapeHTML(x.note)}</p>`:''}`)}<div class="toolbar"><button data-action="add-shift">Add a shift on this day</button></div><p class="muted">${(()=>{const s=rows.map(r=>shiftLiveCalendarSource(r)).find(Boolean);return s?('Deleting removes it here and from your CRNA Hub calendar — your '+escapeHTML(s.calendarName)+' calendar isn\'t touched, and it won\'t be imported again.'):'Deleting removes it here and from your CRNA Hub calendar right away.'})()}</p></section>`;
}
// Per-shift mileage origin (Nov 6, 2026): in the tap-a-day view each
// shift shows a "Drive from" picker — Home / Hotel / Other — bound to
// that shift's own mileage trip. The pre-selection is only a starting
// point (the trip's saved origin, else Hotel when a hotel stay the user
// saved covers the shift, else Home); the user's pick is saved on the
// trip and is what the distance calculates from. A call shift is NEVER
// forced to Hotel — the shift type plays no part here.
function shiftTripOriginHTML(x){
  if(!featureOn('featureMileage'))return '';
  if(/off|pto/i.test(x.type||''))return '';
  const m=(db.mileage||[]).find(mm=>mileageTripMatchesShift(mm,x));
  if(m&&(m.status==='verified'||m.status==='skipped'))return `<div class="muted">Drive from: ${escapeHTML(mileageOriginLabel(m))}</div>`;
  const stay=hotelStayFor(x.date,x.facility);
  const cur=m?(m.origin==='hotel'?'hotel':m.origin==='other'?'other':'home'):(stay?'hotel':'home');
  const addr=cur==='hotel'?tripOriginAddress(m||{origin:'hotel',date:x.date,facility:x.facility,hotelAddress:''}):'';
  const picker=`<div class="muted"><label>Drive from <select data-shift-origin="${escapeHTML(x.id)}" aria-label="Mileage starting point for shift on ${escapeHTML(x.date)}"><option value="home" ${cur==='home'?'selected':''}>Home</option><option value="hotel" ${cur==='hotel'?'selected':''}>Hotel</option><option value="other" ${cur==='other'?'selected':''}>Other address</option></select></label>${cur==='hotel'&&addr?` <span>${escapeHTML(addr)}</span>`:''}</div>`;
  // Call shift? Friendly one-line prompt with a quick Home / Hotel
  // choice — an offer, never an automatic switch. It shows until the
  // user picks a location for this shift or taps "Not now" (which
  // changes nothing). The standing picker below stays either way.
  const isCall=/call/i.test(x.type||'');
  if(isCall&&String(x.date||'')>=currentMonthStart()&&!(m&&m.originChosen)&&!callOriginPromptDismissed.has(x.id)){
    return `<div class="hint" style="margin:8px 0">🚗 I see you’re on call — want to change your driving location? <button type="button" class="tiny" data-action="shift-origin-quick" data-id="${escapeHTML(x.id)}" data-date="home">Home</button> <button type="button" class="tiny" data-action="shift-origin-quick" data-id="${escapeHTML(x.id)}" data-date="hotel">Hotel</button> <button type="button" class="tiny secondary" data-action="shift-origin-dismiss" data-id="${escapeHTML(x.id)}">Not now</button></div>`+picker;
  }
  return picker;
}
function setShiftTripOrigin(shiftId,origin){
  const x=(db.shifts||[]).find(s=>s.id===shiftId);if(!x)return;
  const o=origin==='hotel'?'hotel':origin==='other'?'other':'home';
  let m=(db.mileage||[]).find(mm=>mileageTripMatchesShift(mm,x));
  if(!m){
    const stay=hotelStayFor(x.date,x.facility);
    m=blankMileageDraftForShift(x,o==='hotel'?'hotel':'home',o==='hotel'?((stay&&stay.hotelAddress)||(db.settings&&db.settings.hotelAddress)||''):'');
    if(o==='other'){m.origin='other';m.hotelAddress=''}
    m.originChosen=true;
    db.mileage.push(m);
  }else{
    if(m.origin===o){m.originChosen=true;persist();render();return}
    m.origin=o;m.originChosen=true;
    if(o==='home')m.hotelAddress='';
    else if(o==='hotel'&&!String(m.hotelAddress||'').trim()){const stay=hotelStayFor(x.date,x.facility);m.hotelAddress=(stay&&stay.hotelAddress)||(db.settings&&db.settings.hotelAddress)||''}
    if(m.milesSource==='auto'||num(m.miles)>0){m.miles='';m.oneWayMiles='';m.milesSource='needs-manual'}
  }
  persist();render();
}
function facilityAliases(f){return String((f&&f.aliases)||'').split(',').map(s=>s.trim()).filter(Boolean)}
// Canonical key for facility-name matching (Nov 7, 2026): a name match
// must survive case, spacing and punctuation differences — the calendar
// says "Holzer", the saved hospital is "Holzer Health", a contract says
// "Holzer — Gallipolis". Apostrophes are dropped ("St. Mary's" = "St
// Marys"), other punctuation becomes a space, whitespace collapses.
// Exact-key equality against the saved name or any alias is a MATCH.
// Anything looser (one name containing the other's words) is only a
// near-match the user confirms with a tap — never a silent merge. The
// old resolver compared raw trimmed-lowercase strings, so "Holzer"
// never matched a facility saved as "Holzer Health": every mileage
// calculation for Caleb's trips failed with a false "No facility named
// Holzer is saved yet" even though the hospital was saved, address and
// all — the short name on his shifts vs the full name on the record.
function facilityNameKey(v){return String(v||'').toLowerCase().replace(/[’‘]/g,"'").replace(/'/g,'').replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim()}
function facilityByNameOrAlias(name){const k=facilityNameKey(name);if(!k)return null;return (db.facilities||[]).find(f=>facilityNameKey(f.name)===k||facilityAliases(f).some(a=>facilityNameKey(a)===k))||null}
// Tolerant identity (Nov 10, 2026, v111): exact name/alias first;
// otherwise, when EXACTLY ONE saved facility is a close name
// variant of the text (the prefix rule healFacilityIdentities
// uses — "HOLZ" the feed's short code vs "Holzer" the full name
// a pay stub states), that facility. Ambiguity resolves to null:
// two candidate facilities means the name is genuinely someone
// else's, and guessing would put money on the wrong facility.
// Records that NAME a facility (pay stubs above all) resolve
// through this, so a payer's schedule claims its facility's
// shifts whichever of the facility's names the document used.
function facilityByNameOrVariant(name){
  const exact=facilityByNameOrAlias(name);if(exact)return exact;
  if(!String(name||'').trim())return null;
  const cands=(db.facilities||[]).filter(f=>f&&facilityNameVariantOf(f.name,name)||(f&&facilityAliases(f).some(a=>facilityNameVariantOf(a,name))));
  return cands.length===1?cands[0]:null;
}
// Resolution for a record that names a facility (a shift or a mileage
// trip): a stored facility link wins when present, then name/alias.
function facilityForRecord(rec){if(rec&&rec.facilityId){const byId=(db.facilities||[]).find(f=>f.id===rec.facilityId);if(byId)return byId}return facilityByNameOrAlias(rec&&rec.facility)}
// An obvious near-match for a name that does NOT resolve: exactly one
// saved facility whose name (or an alias) contains the other name's
// words, or is contained by them. Ambiguous or unrelated -> null, so
// the review can offer a one-tap link instead of claiming the facility
// is not saved — and unrelated names never prompt.
function facilityNearMatch(name){
  const k=facilityNameKey(name);if(!k||k.length<3)return null;
  if(facilityByNameOrAlias(name))return null;
  const kt=k.split(' ');
  const cands=(db.facilities||[]).filter(f=>[f.name,...facilityAliases(f)].map(facilityNameKey).filter(Boolean).some(nk=>{
    const nt=nk.split(' ');
    return kt.every(t=>nt.includes(t))||nt.every(t=>kt.includes(t));
  }));
  return cands.length===1?cands[0]:null;
}
// Record `name` as a short name (alias) for facility f, unless f's name
// or an existing alias already covers it. Returns true when added.
function addFacilityAlias(f,name){
  const raw=String(name||'').trim();if(!f||!raw)return false;
  if(facilityNameKey(f.name)===facilityNameKey(raw))return false;
  if(facilityAliases(f).some(a=>facilityNameKey(a)===facilityNameKey(raw)))return false;
  f.aliases=facilityAliases(f).concat([raw]).join(', ');
  return true;
}
// --- Facility suggestions from calendar sync (ask-first, Nov 5, 2026) ---
// The server holds shifts at a hospital with no saved facility rule and
// reports the hospital as a suggestion instead of importing the shifts
// or creating the facility. Nothing is added without the user's tap:
// the suggestion asks "We noticed shifts at <Hospital> in your
// calendar. Add it as a facility?" and offers the three paths together,
// in this order (Caleb's wording): "Sync your calendar, upload a
// contract, or manually enter a facility's hourly rate." Manual fields
// are the fallback for rates the other two paths did not provide.
// "Not now" dismisses that hospital: the dismissal is remembered (the
// suggestion stays, flagged dismissed, and the next sync only refreshes
// its counts — it never re-asks), and dismissed suggestions stay
// visible below with an "Ask again" button. Adding the facility clears
// its suggestion; the next sync then re-scans the held events and
// imports them, priced. Bug 2 (Nov 6, 2026): a bare facility title
// ("CAMC") is held and suggested too, and a legacy-skipped row at an
// unsaved facility is suggested rather than buried — so past shifts at
// a hospital the user has not added yet always surface, and adding the
// facility arms the one-shot repair when the last import reported
// legacy skips, so those shifts re-import on the next sync as well.
function normFacilityName(v){return String(v||'').trim().toLowerCase()}
function activeFacilitySuggestions(){return (db.facilitySuggestions||[]).filter(x=>x&&!x.dismissed&&!facilityByNameOrAlias(x.name))}
function dismissedFacilitySuggestions(){return (db.facilitySuggestions||[]).filter(x=>x&&x.dismissed&&!facilityByNameOrAlias(x.name))}
function facilitySuggestionRange(x){if(!x)return '';if(x.firstDate&&x.lastDate&&x.firstDate!==x.lastDate)return fmt(x.firstDate)+' – '+fmt(x.lastDate);if(x.firstDate)return fmt(x.firstDate);return ''}
function mergeFacilitySuggestions(provider,suggestions,sourceCalendarName){
  // The server-side parser is the guard (personal events never parse
  // as shifts); the client also drops obviously personal names, so a
  // stale or hand-made payload can never suggest a lunch or a dentist.
  const personal=/\b(lunch|dinner|breakfast|brunch|meeting|appointment|dentist|doctor|birthday|holiday|vacation|church|school|wedding|party)\b/i;
  db.facilitySuggestions=db.facilitySuggestions||[];
  for(const sg of (suggestions||[])){
    const name=String((sg&&sg.name)||'').trim();
    if(!name||name.length>80||personal.test(name))continue;
    if(facilityByNameOrAlias(name)){db.facilitySuggestions=db.facilitySuggestions.filter(x=>normFacilityName(x.name)!==normFacilityName(name));continue}
    const ex=db.facilitySuggestions.find(x=>normFacilityName(x.name)===normFacilityName(name));
    const count=Number((sg&&sg.count)||0)||0,first=String((sg&&sg.firstDate)||''),last=String((sg&&sg.lastDate)||'');
    if(ex){
      if(count>Number(ex.count||0))ex.count=count;
      if(first&&(!ex.firstDate||first<ex.firstDate))ex.firstDate=first;
      if(last&&(!ex.lastDate||last>ex.lastDate))ex.lastDate=last;
      if(sg.address&&!ex.address)ex.address=String(sg.address);
      ex.lastSeenAt=new Date().toISOString();ex.provider=provider||ex.provider||'';
      if(sourceCalendarName)ex.sourceCalendarName=sourceCalendarName;
    }else{
      db.facilitySuggestions.push({id:id(),name:name,address:String((sg&&sg.address)||''),count:count,firstDate:first,lastDate:last,provider:provider||'',sourceCalendarName:sourceCalendarName||'',dismissed:false,createdAt:new Date().toISOString(),lastSeenAt:new Date().toISOString(),sampleTitles:Array.isArray(sg&&sg.sampleTitles)?sg.sampleTitles.slice(0,3):[]});
    }
  }
  persist();
}
function clearFacilitySuggestion(name){
  const before=(db.facilitySuggestions||[]).length;
  db.facilitySuggestions=(db.facilitySuggestions||[]).filter(x=>!facilityByNameOrAlias(x.name)&&normFacilityName(x.name)!==normFacilityName(name));
  const removed=(db.facilitySuggestions||[]).length!==before;
  if(removed)persist();
  return removed;
}
// The three ways to give a noticed hospital its rates — ONE button
// row, used on the suggestion card and on the facility form once a
// path is picked (one-component rule). Nov 11, 2026 (v121) replaced
// the old numbered list (sync / manual) with Caleb's three paths:
// upload a contract, describe the rates in your own words, or enter
// the hourly rate manually. Whichever path saves the facility, the
// app then re-checks the calendar by itself and pulls the hospital's
// waiting shifts in — no manual re-sync (see the rescan in
// live-sync.js).
function facilityThreePathsHTML(s){
  const sid=s&&s.id?String(s.id):'';
  return `<div class="toolbar"><button type="button" class="tiny" data-action="facility-suggestion-path" data-id="${escapeHTML(sid)}" data-date="contract">Upload a contract</button><button type="button" class="tiny" data-action="facility-suggestion-words" data-id="${escapeHTML(sid)}">Describe rates in your words</button><button type="button" class="tiny" data-action="facility-suggestion-path" data-id="${escapeHTML(sid)}" data-date="manual">Enter hourly rate manually</button></div>`;
}
function facilityThreeWaysHTML(pre){
  return `<section class="panel" id="facility-three-ways-panel"><h2>Add ${escapeHTML(pre.name||'a facility')} — pick a path</h2>${facilityThreePathsHTML({id:(db.facilitySuggestions||[]).find(x=>normFacilityName(x.name)===normFacilityName(pre.name))?.id||'',name:pre.name})}<p class="muted">Nothing is saved until you add the facility — from a contract (above), in your own words, or by hand below. As soon as it's saved, we re-check your calendar and pull in the shifts it held for this hospital.</p></section>`;
}
function dismissedSuggestionItemHTML(sg){
  return `<div class="item"><div class="item-title">${escapeHTML(sg.name)}</div><div class="muted">${sg.count?sg.count+' shift(s) · ':''}${facilitySuggestionRange(sg)}${sg.sourceCalendarName?` · from “${escapeHTML(sg.sourceCalendarName)}”`:''}</div><div class="item-actions"><button type="button" class="tiny secondary" data-action="facility-suggestion-undismiss" data-id="${escapeHTML(sg.id)}">Ask again</button></div></div>`;
}
function facilitySuggestionsHTML(){
  const active=activeFacilitySuggestions(),dismissed=dismissedFacilitySuggestions();
  // No active suggestions -> no card at all. A dismissed suggestion leaves
  // nothing visible at the top of the page; it stays recoverable from the
  // collapsed block at the bottom of the Facilities page (below).
  if(!active.length)return '';
  // One card per hospital (Nov 11, 2026, v121): the hospital's name,
  // how many of its shifts are waiting, and — on the expanded card —
  // the three rate paths inline. The first card is expanded (or the
  // one the post-sync handoff / a "Set up" tap chose); "Not a
  // hospital" sits on every card, as prominent as the add paths —
  // a training event or a trip can parse as a hospital name, and
  // dismissing it is a first-class answer, never re-asked.
  const expId=expandedSuggestionId&&active.some(x=>x.id===expandedSuggestionId)?expandedSuggestionId:active[0].id;
  let html=`<section class="panel" id="facility-suggestions-panel"><h2>Hospitals noticed in your calendar</h2><p class="muted">Add a hospital and its waiting shifts import right away, priced from its rates.</p>`;
  for(const sg of active){
    const range=facilitySuggestionRange(sg);
    const open=sg.id===expId;
    html+=`<div class="item"><div class="item-title">${escapeHTML(sg.name)}</div><div class="muted">${sg.count?sg.count+' shift(s) waiting':'Shifts waiting'}${range?' · '+range:''}${sg.sourceCalendarName?` · from “${escapeHTML(sg.sourceCalendarName)}”`:''}${sg.address?` · ${escapeHTML(sg.address)}`:''}</div><div class="item-actions">${open?facilityThreePathsHTML(sg):`<button type="button" class="tiny" data-action="facility-suggestion-expand" data-id="${escapeHTML(sg.id)}">Set up ${escapeHTML(sg.name)}</button>`}<button type="button" class="tiny secondary" data-action="facility-suggestion-dismiss" data-id="${escapeHTML(sg.id)}">Not a hospital</button></div></div>`;
  }
  if(dismissed.length){
    html+=`<details><summary>Dismissed suggestions (${dismissed.length}) — not asked again on sync</summary>${dismissed.map(dismissedSuggestionItemHTML).join('')}</details>`;
  }
  return html+'</section>';
}
function dismissedFacilitySuggestionsHTML(){
  // Bottom-of-page home for dismissed suggestions when nothing is active:
  // collapsed and out of the way, but "Ask again" is never lost.
  if(activeFacilitySuggestions().length)return '';
  const dismissed=dismissedFacilitySuggestions();
  if(!dismissed.length)return '';
  return `<section class="panel" id="facility-dismissed-panel"><details><summary>Dismissed suggestions (${dismissed.length}) — not asked again on sync</summary>${dismissed.map(dismissedSuggestionItemHTML).join('')}</details></section>`;
}
// Dashboard flag for a QGenda preview the boot check left waiting
// (Nov 7, 2026): one short line + a jump to the preview. "Not now"
// hides only this notice — the preview stays put until the user
// approves or discards it.
function dashboardQgendaNoticeHTML(){
  if(!featureOn('featureQgenda'))return '';
  if(!(qgendaPendingNew>0&&qgendaPendingPreview())||qgendaNoticeDismissed)return '';
  return `<section class="panel"><p><strong>QGenda: ${qgendaPendingNew} new shift${qgendaPendingNew===1?'':'s'} ready to review.</strong> <span class="muted">We checked your feed when you opened the app — nothing is saved until you approve the preview.</span></p><div class="toolbar"><button type="button" data-action="qgenda-review">Review shifts</button><button type="button" class="secondary" data-action="qgenda-notice-dismiss">Not now</button></div></section>`;
}
function dashboardFacilitySuggestionsHTML(){
  const active=activeFacilitySuggestions();
  if(!active.length)return '';
  const sg=active[0];
  return `<section class="panel"><h2>New hospital noticed in your calendar</h2><p>We noticed shifts at <strong>${escapeHTML(sg.name)}</strong>${sg.count?` (${sg.count} shift(s)${facilitySuggestionRange(sg)?', '+facilitySuggestionRange(sg):''})`:''} — add it as a facility?</p><p class="muted">Sync your calendar, upload a contract, or manually enter a facility's hourly rate.</p><div class="toolbar"><button type="button" data-action="facility-suggestion-review">Review on Facilities tab</button></div></section>`;
}
function collapsePanelHTML(id,title,inner,open){return `<details class="panel collapse-panel" id="${id}"${open?' open':''}><summary class="collapse-head"><span class="collapse-title">${escapeHTML(title)}</span><span class="collapse-chevron" aria-hidden="true">▾</span></summary><div class="collapse-body">${inner}</div></details>`}
function facilityScrollTo(elId){try{const el=document.getElementById(elId);if(el){if(el.tagName==='DETAILS')el.open=true;if(el.scrollIntoView)el.scrollIntoView({block:'start'})}}catch(e){}}
// Weekend is PER-FACILITY DATA (Caleb, Nov 9, 2026: "That's just
// my rule. Idk what other users' rules will be."): a facility's
// weekendDays lists the weekday numbers (0=Sunday … 6=Saturday)
// that count as weekend FOR THAT FACILITY's call pricing. Unset or
// malformed means the common default, Saturday and Sunday only.
// It is captured in the user's own words through the describe-rules
// flow ("weekend includes Friday") and stated back in the read-back
// summary — never a silent constant in a pricing path.
const WEEKDAY_NAMES=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const WEEKDAY_SHORT=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
function facilityWeekendDays(f){const raw=f&&Array.isArray(f.weekendDays)?f.weekendDays:[];const days=[...new Set(raw.map(n=>Number(n)).filter(n=>Number.isInteger(n)&&n>=0&&n<=6))].sort((a,b)=>a-b);return days.length?days:[0,6]}
function isFacilityWeekend(f,date){if(!f||!psValidISO(date))return false;return facilityWeekendDays(f).includes(new Date(date+'T12:00:00').getDay())}
function weekendDaysText(f){return facilityWeekendDays(f).slice().sort((a,b)=>((a+6)%7)-((b+6)%7)).map(d=>WEEKDAY_NAMES[d]).join(' and ')}
function weekendDayListLabel(days){return (days||[]).slice().sort((a,b)=>((a+6)%7)-((b+6)%7)).map(d=>WEEKDAY_NAMES[d]).join(' and ')}
// Weekend provenance (Nov 11, 2026, v122): a facility's weekend
// definition is either STATED (the user wrote it in their words,
// or saved it before provenance existed — a saved weekendDays
// array with no source marker is the user's captured rule) or
// DEFAULTED (the Sat/Sun working default the pricer falls back
// to when weekend pricing exists but no definition was ever
// stated — recorded as weekendDaysSource:'default' at save, so
// no read-back or prefill ever presents it as the user's own
// words). Absent both, there is no provenance to claim.
function facilityWeekendStated(f){if(!f)return false;if(f.weekendDaysSource)return f.weekendDaysSource==='stated';return Array.isArray(f.weekendDays)&&f.weekendDays.length>0}
// Does anything in these rules price weekends DIFFERENTLY? Only
// then can a weekend definition move money: a weekend-specific
// call flat, a per-code weekend amount, or a 1st call priced
// from the hourly split (firstCallPay computes the weekend day
// from the call rate, so its price turns on which days count).
function facilityWeekendMatters(f){
  if(!f)return false;
  if(rateOrNull(f.weekendRate24)!=null||rateOrNull(f.weekendRateSecond)!=null)return true;
  const defs=facilityCodeDefs(f);let has24=false;
  for(const d of Object.values(defs)){if(!d)continue;if(d.weekendPay!=null)return true;if(d.canonicalType==='24-hour call')has24=true}
  if(has24&&rateOrNull(f.hourlyCall1st)!=null)return true;
  return false;
}
function describeWeekendMatters(parsed,fac){
  const merged={};
  if(fac)for(const k of RATE_FIELDS)merged[k]=fac[k];
  if(parsed&&parsed.rates)for(const k of Object.keys(parsed.rates))if(parsed.rates[k]!=null)merged[k]=parsed.rates[k];
  if(rateOrNull(merged.weekendRate24)!=null||rateOrNull(merged.weekendRateSecond)!=null)return true;
  const defs=(parsed&&parsed.defs)||{};let has24=false;
  for(const d of Object.values(defs)){if(!d)continue;if(d.weekendPay!=null)return true;if(d.canonicalType==='24-hour call')has24=true}
  if(has24&&rateOrNull(merged.hourlyCall1st)!=null)return true;
  return false;
}
function facilityPayFor(f,type,date){if(!f)return 0;const hourly=rateOrNull(f.hourlyRate),hours8=rateOrNull(f.paidHours8)||8;if(/24-hour/i.test(type)){const weekend=date?isFacilityWeekend(f,date):false;if(weekend){const wknd24=rateOrNull(f.weekendRate24);if(wknd24!=null)return wknd24}const flat=rateOrNull(f.rate24);if(flat!=null)return flat;const h=rateOrNull(f.hourlyCall1st);if(h==null)return 0;const fc=firstCallPay(h,hourly,weekend);return fc?fc.pay:0;}if(/second/i.test(type)){const weekend=date?isFacilityWeekend(f,date):false;if(weekend){const wknd=rateOrNull(f.weekendRateSecond);if(wknd!=null)return wknd}const flat=rateOrNull(f.rateSecond);if(flat!=null)return flat;const base=rateOrNull(f.rate8)!=null?rateOrNull(f.rate8):(hourly!=null?hourly*hours8:null);const bonus=rateOrNull(f.callBonus);return (base!=null&&bonus!=null)?base+bonus:0}if(/10-hour/i.test(type)){const flat=rateOrNull(f.rate10);return flat!=null?flat:(hourly!=null?hourly*10:0)}if(/12-hour/i.test(type)){const flat=rateOrNull(f.rate12);return flat!=null?flat:(hourly!=null?hourly*12:0)}if(/8-hour/i.test(type)){const flat=rateOrNull(f.rate8);return flat!=null?flat:(hourly!=null?hourly*hours8:0)}return 0}
// Price every still-unpriced shift for this facility from its (new or
// edited) pay rule. Returns how many were priced. Called when a
// facility is saved, so shifts imported unpriced get priced on the
// device at once; the next calendar sync re-prices the rest server-side.
// --- Import previews: pay unit + first-time facility rates ---
// A preview row's Pay cell is an EDITABLE per-row override. The shift
// record's `pay` is always the TOTAL for that shift (every total in
// the app sums shift.pay directly), so the preview now states the
// unit up front: Pay amounts are either per-shift totals ("daily" —
// the long-standing meaning of a typed amount) or an hourly rate the
// approve step converts using the shift's hours. The entered amount
// and unit ride along on the shift as payRate/payUnit so the basis
// is never lost.
function payUnitHoursFor(type,f){const t=String(type||'');if(/24-hour|24 hour/i.test(t))return 24;if(/12-hour/i.test(t))return 12;if(/10-hour/i.test(t))return 10;if(/8-hour|second/i.test(t))return (f&&rateOrNull(f.paidHours8))||8;return null}
function previewPayConversion(rawPay,unit,type,f){const raw=String(rawPay||'').trim();const amt=Number(raw.replace(/[^0-9.]/g,''));if(!raw||!isFinite(amt)||amt<=0)return{pay:raw,payRate:'',payUnit:''};if(unit==='hourly'){const h=payUnitHoursFor(type,f);if(h)return{pay:String(Math.round(amt*h*100)/100),payRate:String(amt),payUnit:'hourly'};return{pay:String(amt),payRate:String(amt),payUnit:'daily'}}return{pay:String(amt),payRate:String(amt),payUnit:'daily'}}
function facilityHasUsableRates(f){return !!f&&FACILITY_RATE_KEYS.some(k=>rateOrNull(f[k])!=null)}
function payUnitControlHTML(preview,kind){const u=preview&&preview.payUnit==='hourly'?'hourly':'daily';return `<div class="form-grid"><div class="field"><label for="payUnit_${kind}">Pay amounts in this preview are</label><select id="payUnit_${kind}" class="previewPayUnit" data-kind="${kind}"><option value="daily" ${u==='daily'?'selected':''}>Per shift — the total for that shift</option><option value="hourly" ${u==='hourly'?'selected':''}>Hourly — a rate, times the shift's hours</option></select></div></div><p class="muted">${u==='hourly'?'Each Pay amount is an hourly rate — approving multiplies it by the shift\u2019s hours (8-hour shifts use the facility\u2019s paid hours). Leave Pay blank to price from the facility\u2019s rates.':'Each Pay amount is the total pay for that one shift. Leave Pay blank to price from the facility\u2019s rates.'}</p>`}
// First-time clarification prompt (narrowed Nov 8, 2026, Caleb):
// "Make the prompt specific to the shifts that the AI reads — only
// ask clarification of the shifts it sees." When the facility these
// shifts belong to is new, or has shift codes on this import it
// cannot price yet, the preview asks ONLY about the distinct codes
// actually present in the included rows: ONE shared hourly rate for
// the facility, plus per code a label ("what is 5**?") and its
// hours — nothing more. The full FACILITY_RATE_KEYS grid stays on
// the Facilities tab and the contract flow. On approve the answers
// persist through the existing facility record: the hourly rate
// lands in hourlyRate, and each clarified code is remembered in the
// facility's codeMap ({code: {label, hours}}) so a later import of
// the same code prices automatically and never re-asks. Skipping is
// remembered per facility (ratesPromptSkipped) so imports don't nag.
function facilityCodeDefs(f){const cm=f&&f.codeMap;return (cm&&typeof cm==='object'&&!Array.isArray(cm))?cm:{}}
// Feed housekeeping (Nov 9, 2026): QGenda feeds carry sync-marker
// events that are not shifts — "AutoSync from QGenda: 2:11PM", the
// time being when the feed last synced. The server parser filters
// them before they become rows (qgenda-feed parse.ts,
// isQgendaHousekeepingSummary — keep the two in sync); this client
// mirror guards previews or saved data an older parser let through,
// so the pattern can never be prompted about or (re)imported.
// Narrow by design: an explicit marker only — an unusual real shift
// name never matches and still lands as a raw row.
function isHousekeepingShiftName(s){const t=String(s||'').trim();if(!t)return false;return /\bautosync\s+from\s+qgenda\b/i.test(t)||/^autosync\b/i.test(t)}
// Code keys ignore assignee-bracket noise: QGenda appends the
// assignee in brackets, and feeds parsed before the server cleaner
// dropped the emptied brackets left codes like "HOLZ - Call 2 [ ]"
// behind — in saved codeMap keys, shift codes and shift types
// alike. A bracket group is dropped when it is the emptied shell,
// or when its content is composed of the assignee's name parts
// (first, last, full name, initials — the name the client holds is
// the schedule name it sends with the fetch), mirroring the server
// cleaner in qgenda-feed parse.ts (cleanQgendaShiftName). A bracket
// group with unrelated content is real text and stays, so an old
// key and its cleaned re-read still find each other.
function codeKeyBracket(m){
  const content=m.slice(1,-1);
  if(!/[A-Za-z0-9]/.test(content))return ' ';
  const parts=String(scheduleName()||'').split(/[\s,]+/).map(p=>p.replace(/\.+$/,'').toLowerCase()).filter(p=>p.length>=3);
  if(parts.length){
    const partSet=new Set(parts);
    const tokens=content.split(/[\s,]+/).filter(Boolean);
    if(tokens.length&&tokens.every(tok=>partSet.has(tok.toLowerCase().replace(/\.+$/,''))||/^[A-Za-z]\.?$/.test(tok)))return ' ';
    let stripped=content;
    for(const p of parts)stripped=stripped.replace(new RegExp('\\b'+p.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'\\b','gi'),' ');
    if(stripped.replace(/\s+/g,' ').trim()!==content.replace(/\s+/g,' ').trim()&&/^[A-Za-z][A-Za-z\s,]*$/.test(stripped))return ' ';
  }
  return m;
}
function normalizeCodeKey(code){return String(code||'').replace(/\[[^\[\]]*\]/g,codeKeyBracket).replace(/\s+/g,' ').trim()}
// ONE code identity (Nov 11, 2026, v131): the same code reaches the
// app spelled many ways — the contract document's "HOLZ - PCDO",
// the saved facility's "Holz PCDO", the calendar's "Holzer PCDO" —
// and every surface must treat them as ONE code (the same tolerant
// identity the shift dedupe uses for facility names: case,
// punctuation and dash-vs-space variants all fold away). Before
// this, the contract preview handed the pay-words reader no code
// universe at all and identity comparisons were exact-string, so
// a code statement in the user's words ("Holz PCDO=post call day
// off=no pay") resolved on the facility card but not in the
// preview, and a def saved under the document spelling could not
// price a calendar-spelled shift.
function codeIdentityKey(code){return normalizeCodeKey(String(code||'').toLowerCase()).replace(/[^a-z0-9*]+/g,' ').replace(/\s+/g,' ').trim()}
// Dedupe key for a code WITHIN one facility's universe: the
// identity above with a leading facility-prefix token sequence
// (the facility's name or one of its aliases, e.g. "HOLZ -" /
// "Holzer") stripped, so "HOLZ - PCDO" and "Holzer PCDO" collapse
// to the same key while the task part — which is what makes codes
// distinct — is untouched ("8" never merges with "G Main (8)").
function codeStripKey(code,fac){
  const idk=codeIdentityKey(code);if(!idk)return '';
  const toks=idk.split(' ');
  const prefixes=[];
  if(fac){const nm=codeIdentityKey(fac.name);if(nm)prefixes.push(nm.split(' '));for(const a of facilityAliases(fac)){const ak=codeIdentityKey(a);if(ak)prefixes.push(ak.split(' '))}}
  let i=0;
  outer:while(i<toks.length-1){
    let advanced=false;
    for(const p of prefixes){if(p.length&&i+p.length<=toks.length-1&&p.every((tk,j)=>toks[i+j]===tk)){i+=p.length;advanced=true;continue outer}}
    if(!advanced)break;
  }
  return toks.slice(i).join(' ');
}
function codeDefFor(f,code){const k=String(code||'').trim();if(!k)return null;const defs=facilityCodeDefs(f);if(defs[k])return defs[k];const nk=normalizeCodeKey(k);if(nk){for(const key of Object.keys(defs)){if(normalizeCodeKey(key)===nk)return defs[key]}
  // Last resort (Nov 10, 2026): a trailing name-like bracket group
  // (the feed's assignee annotation, "[Martin]") is not part of a
  // code's identity — when this device did not know the schedule
  // name, normalizeCodeKey kept it on one side only, and the def
  // missed. Compare once more with that suffix dropped from both
  // sides; a bracket holding digits or symbols still distinguishes.
  const loose=s=>s.replace(/\s*\[[A-Za-z][A-Za-z\s,.'-]*\]$/,'').trim();
  const lk=loose(nk);if(lk&&lk!==nk){for(const key of Object.keys(defs)){if(loose(normalizeCodeKey(key))===lk)return defs[key]}}}
  // One identity (Nov 11, 2026, v131): the same code spelled the
  // way another surface spells it — different case, dashes for
  // spaces, the facility prefix present or absent — is the same
  // code. The def saved from the contract preview ("HOLZ - PCDO")
  // must answer a shift the calendar spelled "Holzer PCDO", and a
  // bare "PCDO" must find it too: identity equality first, then a
  // UNIQUE token-suffix match (the dropped head is the facility
  // prefix). An ambiguous suffix matches nothing.
  const ik=codeIdentityKey(k);
  if(ik){
    for(const key of Object.keys(defs)){if(codeIdentityKey(key)===ik)return defs[key]}
    // The facility's own prefix spellings differ across surfaces
    // (the document's "HOLZ", the calendar's "Holzer"): compare
    // with the facility prefix stripped from BOTH sides.
    const sk=codeStripKey(k,f);
    if(sk&&sk!==ik){let sFound=null,sCount=0;for(const key of Object.keys(defs)){if(codeStripKey(key,f)===sk){sFound=defs[key];sCount++}}if(sCount===1)return sFound}
    const qt=ik.split(' ');let found=null,count=0;
    for(const key of Object.keys(defs)){const dt=codeIdentityKey(key).split(' ');if(dt.length>qt.length&&dt.length-qt.length<=3&&dt.slice(dt.length-qt.length).join(' ')===ik){found=defs[key];count++}}
    if(count===1)return found;
  }
  return null}
// The canonical shift type a free-text label names, when it names
// one the facility pay rule prices directly ("Second call",
// "24-hour call", "8-hour day", ...). Generic patterns only — a
// facility's own numbers always come from its saved rates.
function canonicalTypeOf(text){const t=String(text||'').toLowerCase().replace(/\bhousr\b/g,'hour').replace(/\bhuor\b/g,'hour');if(!t)return '';if(/call/.test(t)&&(/second/.test(t)||/(?:^|\D)2nd\b/.test(t)||/\bcall\s*2\b/.test(t)))return 'Second call';if(/call/.test(t)&&(/\b24\b/.test(t)||/\b24\s*-?\s*h(?:ou)?r\b/.test(t)||/first/.test(t)||/(?:^|\D)1st\b/.test(t)||/\bcall\s*1\b/.test(t)))return '24-hour call';const m=t.match(/(\d{1,2})\s*-\s*hour|(\d{1,2})\s*hour|(\d{1,2})\s*-?\s*hrs?\b|\((\d{1,2})\)\s*$/);if(m){const n=+(m[1]||m[2]||m[3]||m[4]);if(n===8)return '8-hour day';if(n===10)return '10-hour shift';if(n===12)return '12-hour shift';if(n===24)return '24-hour call'}return ''}
// True when a call type's weekday/weekend split is nowhere in the
// facility's saved rates — no weekend flat, no weeknight flat, no
// call-bonus structure the pricer could apply by day of week. Only
// then does the clarification prompt ask the weekend question.
function callSplitMissing(f,ctype){if(ctype==='Second call'){if(!f)return true;return rateOrNull(f.weekendRateSecond)==null&&rateOrNull(f.rateSecond)==null&&rateOrNull(f.callBonus)==null}if(ctype==='24-hour call'){if(!f)return true;return rateOrNull(f.weekendRate24)==null&&rateOrNull(f.rate24)==null&&rateOrNull(f.hourlyCall1st)==null}return false}
function rowCodeKey(r){return String((r&&(r.code!=null&&String(r.code).trim()))?r.code:(r?r.type:'')||'').trim()}
function importTargetRows(preview,name){
  const rows=(preview.rows||[]).filter(r=>r.match!=='other');
  const cand=rows.filter(r=>facilityNameKey(r.facility)===facilityNameKey(name)||!scheduleRowFacilityResolved(r));
  return cand.length?cand:rows;
}
// What one import row IS, for the day/call combining rule and the
// clarification prompt: 'call' for a call assignment (Second call
// / 24-hour call — its price already includes the day), 'day' for
// a plain day shift (8/10/12-hour, including the QGenda grammar
// "(N)" suffix the canonical patterns don't spell out), '' for
// anything else (never combined, never hidden from the prompt).
function importRowKind(r){
  if(!r)return '';
  const code=rowCodeKey(r);
  const ct=canonicalTypeOf(r.type)||canonicalTypeOf(code);
  if(ct==='Second call'||ct==='24-hour call')return 'call';
  if(ct)return 'day';
  if(/\(\d{1,2}\)\s*$/.test(code))return 'day';
  return '';
}
// One assignment per day (Nov 9, 2026, December round): QGenda
// lists a combined day as TWO tasks — the day task (G Main (8))
// and the call task (Call 1 / Call 2) — but they are ONE
// assignment, and the call price already includes the day:
// weekday 1st call ($4,800) is the whole 24 hours, weekday 2nd
// call ($3,000) is the day base plus the call bonus, weekend 2nd
// call is a flat $2,000 with no day base at all (Caleb's contract
// addendum + his stated rules). Saving both rows prices the day
// twice — his December showed a $45,600 headline against a
// $40,600 truth. So within one preview, a day row sharing a date
// + facility with a call row is absorbed into the call row
// (flagged on it, never silently dropped); a day row with no call
// beside it that day stands on its own and prices normally. This
// runs centrally — when the QGenda preview is built and in the
// shared approve paths — so the prompt, the preview and the saved
// shifts all see the same single assignment (source-priority
// ladder: imports own shift facts; combining is a fact about the
// day, applied once, not per path).
function combineDayCallRows(rows){
  if(!Array.isArray(rows)||rows.length<2)return rows;
  const hostByKey=new Map();
  for(const r of rows){
    if(!r||r.include===false)continue;
    if(importRowKind(r)==='call'){
      const k=String(r.date||'')+'|'+facilityNameKey(r.facility||'');
      if(!hostByKey.has(k))hostByKey.set(k,r);
    }
  }
  if(!hostByKey.size)return rows;
  const out=[];
  for(const r of rows){
    if(r&&r.include!==false&&importRowKind(r)==='day'){
      const host=hostByKey.get(String(r.date||'')+'|'+facilityNameKey(r.facility||''));
      if(host&&host!==r){
        host.absorbedCodes=host.absorbedCodes||[];
        const code=rowCodeKey(r);
        if(code&&!host.absorbedCodes.includes(code))host.absorbedCodes.push(code);
        host.flags=host.flags||[];
        const fl='includes the '+(code||'day')+' day shift — one assignment, priced as the call';
        if(!host.flags.includes(fl))host.flags.push(fl);
        continue;
      }
    }
    out.push(r);
  }
  return out;
}
function unclarifiedCodes(preview,target){
  // Distinct codes/types among the INCLUDED rows for this facility
  // that the facility cannot price yet: facilityPayFor says 0 and no
  // saved code definition covers the code. A code is also priced when
  // the facility can price the row by its canonical type (r.type) —
  // e.g. a QGenda code "8/2nd call" whose type is "Second call".
  // Order of first appearance. Each returned code carries the first
  // included row's non-null hours for that code (as a string), so the
  // clarification prompt can pre-fill hours the feed already gave.
  // A code ALSO comes back — flagged splitType — when it is a call
  // type (Second call / 24-hour call) whose price does not come from
  // a weekday/weekend split in the facility's saved rates: hourly x
  // hours can never express "3,000 on a weekday, 2,000 on a weekend"
  // (Caleb, Nov 9, 2026 — his QGenda Call 2 priced $6,000 flat on
  // both), so the prompt asks the one weekend question for that
  // code. Once the split is saved the code never re-asks.
  const seen=new Map();
  const priced=new Set();
  const rulePriced=new Set();
  const daySpan=new Map();
  const targetRows=importTargetRows(preview,target.name);
  // Days where a call row stands beside a day row: the day row is
  // absorbed into the call (one assignment — see combineDayCallRows),
  // so a code whose rows are ALL absorbed is never a prompt
  // question; it needs no price of its own. A mixed code (some days
  // absorbed, some standalone) still asks: the standalone days
  // price from its answers.
  const callDays=new Set();
  for(const r of targetRows){if(r.include&&importRowKind(r)==='call')callDays.add(String(r.date||'')+'|'+facilityNameKey(r.facility||''))}
  for(const r of targetRows){
    if(!r.include)continue;
    const code=rowCodeKey(r);if(!code)continue;
    if(importRowKind(r)==='day'&&callDays.has(String(r.date||'')+'|'+facilityNameKey(r.facility||'')))continue;
    // Housekeeping is never a question (Nov 9, 2026): a sync-marker
    // row from a stale preview is skipped here even if it is priced
    // or unpriced — the prompt asks about real shifts only.
    if(isHousekeepingShiftName(code)||isHousekeepingShiftName(r.type))continue;
    const rowHours=(typeof r.hours==='number'&&isFinite(r.hours))?String(r.hours):(r.hours!=null&&String(r.hours).trim()!==''?String(r.hours).trim():'');
    if(!seen.has(code))seen.set(code,{code,hours:rowHours,ctype:canonicalTypeOf(r.type)});
    else{if(!seen.get(code).hours&&rowHours)seen.get(code).hours=rowHours;if(!seen.get(code).ctype)seen.get(code).ctype=canonicalTypeOf(r.type)}
    if(psValidISO(r.date)){const dow=new Date(r.date+'T12:00:00').getDay();const sp=daySpan.get(code)||{wd:false,we:false};const wkndDays=target.fac?facilityWeekendDays(target.fac):[0,6];if(wkndDays.includes(dow))sp.we=true;else sp.wd=true;daySpan.set(code,sp)}
    if(target.fac){
      if(facilityPayFor(target.fac,code,r.date)>0){priced.add(code);rulePriced.add(code)}
      else if(facilityPayFor(target.fac,r.type,r.date)>0){priced.add(code);rulePriced.add(code)}
      else if(codeDefFor(target.fac,code))priced.add(code);
    }
  }
  const out=[];
  for(const e of seen.values()){
    const def=target.fac?codeDefFor(target.fac,e.code):null;
    const ctype=e.ctype||(def?canonicalTypeOf(def.canonicalType||def.label||''):'');
    const sp=daySpan.get(e.code)||{wd:false,we:false};
    // The split question fires when the facility's rates cannot
    // express one AND the code's price does not already come from
    // the facility rule on both kinds of days: a fresh code (asked
    // anyway), a code spanning weekdays and weekends, or a code the
    // rule prices on NO date (a definition's flat hourly x hours is
    // the only price it has — the Nov 9, 2026 bug shape).
    const splitType=(ctype==='Second call'||ctype==='24-hour call')&&callSplitMissing(target.fac,ctype)&&(!priced.has(e.code)||(sp.wd&&sp.we)||!rulePriced.has(e.code))?ctype:'';
    // Paid-hours question (Nov 9, 2026, December round): a DAY
    // code priced as hourly x some hour count — no flat day rate
    // on the facility — still has one unanswered question after
    // its first clarification: how many hours one such shift PAYS
    // (an 8-hour shift can pay 8.5). The prompt only ever captured
    // the shift's own hours, so the price stuck at hourly x shift
    // hours ($2,000 where the truth was $2,125). The question
    // fires until the code's definition carries a paidHours
    // answer; a flat day rate from a contract, or the answer
    // itself, closes it for good.
    let paidHoursAsk=false;
    if(target.fac&&ctype&&/hour/i.test(ctype)&&!/call/i.test(ctype)){
      const flatKey=/8-hour/i.test(ctype)?'rate8':/10-hour/i.test(ctype)?'rate10':/12-hour/i.test(ctype)?'rate12':'';
      // A facility-level paid-hours figure (paidHours8 — set by a
      // contract read or by hand) is also an answer, EXCEPT when
      // it merely echoes the clarified shift hours: the old
      // clarification flow copied the shift's hours into
      // paidHours8, which is exactly the unverified case (an
      // 8-hour shift recorded as paying 8 when it pays 8.5). A
      // figure that differs from the shift hours is real
      // knowledge; so is any figure on a code never clarified.
      const facPaid=flatKey==='rate8'?rateOrNull(target.fac.paidHours8):null;
      const defHrs=def?rateOrNull(def.hours):null;
      const facKnows=facPaid!=null&&!(def&&defHrs!=null&&Math.abs(facPaid-defHrs)<0.001);
      // Only a code WITH a saved definition is re-asked: a
      // never-clarified code priced by its canonical type is
      // settled (round-1 rule), and a fresh code sees the
      // paid-hours field inside its first clarification, whose
      // approval records the answer (see applyImportClarifyDraft).
      // A definition WITHOUT paidHours is one saved before the
      // question existed — exactly the December case.
      if(flatKey&&def&&rateOrNull(target.fac[flatKey])==null&&!facKnows&&rateOrNull(target.fac.hourlyRate)!=null&&rateOrNull(def.paidHours)==null)paidHoursAsk=true;
    }
    if(!priced.has(e.code)||splitType||paidHoursAsk)out.push({...e,ctype:ctype||'',splitType,...(paidHoursAsk?{paidHoursAsk:true}:{})});
  }
  return out;
}
function importRatesTarget(preview){
  if(!preview||preview.ratesSkipped)return null;
  const rows=(preview.rows||[]).filter(r=>r.match!=='other');
  if(!rows.length)return null;
  const fill=String(preview.facilityAll||'').trim();
  let name=fill;
  if(!name){const names=[...new Set(rows.map(r=>String(r.facility||'').trim()).filter(Boolean))];if(names.length===1)name=names[0];else return null}
  const fac=facilityByNameOrAlias(name);
  if(fac&&fac.ratesPromptSkipped)return null;
  const codes=unclarifiedCodes(preview,{name,fac:fac||null});
  if(!codes.length)return null;
  return {name,fac:fac||null,codes};
}
function clarifyDraftOf(preview){return (preview&&preview.clarifyDraft)||{hourlyRate:'',codes:{}}}
function clarifyEntryFor(preview,code,suggestedHours){
  // Effective clarification for one code: what the user typed, or —
  // for a code that already reads as a known shift type ("8-hour
  // day") — the obvious default the prompt pre-fills, so entering
  // just the hourly rate is enough for those. A grid code ("5**")
  // has no default: it counts only when the user actually types.
  // Hours default: typed hours first, then the suggested (row-
  // derived) hours when the caller passes them, then the known-type
  // default from payUnitHoursFor. Label default is unchanged.
  const d=clarifyDraftOf(preview);const e=(d.codes||{})[code]||{};
  const typedLabel=String(e.label!=null?e.label:'').trim();
  const typedHours=e.hours!=null&&String(e.hours).trim()!==''?String(e.hours).trim():'';
  const suggHours=suggestedHours!=null&&String(suggestedHours).trim()!==''?String(suggestedHours).trim():'';
  const defLabel=/hour|call/i.test(code)?code:'';
  const defHours=payUnitHoursFor(code,null);
  const label=typedLabel||defLabel;
  const hours=typedHours||suggHours||(defHours!=null?String(defHours):'');
  const typedPaid=e.paidHours!=null&&String(e.paidHours).trim()!==''?String(e.paidHours).trim():'';
  return {label,hours,touched:!!(typedLabel||typedHours||typedPaid),answered:!!(label||hours),weekdayPay:e.weekdayPay!=null?String(e.weekdayPay):'',weekendPay:e.weekendPay!=null?String(e.weekendPay):'',paidHours:typedPaid};
}
// --- Pay rules in your own words (Nov 9, 2026) ---
// Caleb: "I think we replace all of the shift fill in blank spaces
// as one 'describe in your own words' — I feel like there are too
// many wires getting crossed trying to fill out all of those
// shifts." Every clarification surface that used to render per-code
// field grids (label / hours / paid hours / weekday-weekend boxes)
// is now ONE free-text box — the Nov 6 contract rule box
// generalized, not a second variant: the user writes the facility's
// pay rules in plain sentences; the app parses them into the rate
// card + code definitions (the deterministic contract-text reader
// first, the AI rule read merged over it when signed in) and reads
// back ONE plain-language summary ("Here's what I'll use: …") the
// user confirms or edits before anything saves. A code the text
// does not cover gets ONE follow-up question in words, never a
// field. Facilities with field-captured definitions keep working —
// this box is their editing surface too, prefilled with a generated
// sentence describing the current rules. The weekend definition is
// one of the rules the box captures (per facility — see
// facilityWeekendDays): it is exactly the kind of rule a user
// states in a sentence, and it was a silent constant in pricing
// paths until now.
let describeStates={},describeOpenFac=null,describeSavedFlashFac=null;
function describeState(key){
  const p=key==='imp:schedule'?schedulePreview:key==='imp:cal'?calPreview:null;
  if(p)return (p.describe=p.describe||{text:null,parsed:null,error:'',busy:false,confirmed:false});
  // The facility contract preview (Nov 11, 2026, v123): each
  // preview facility carries its own words-box state under
  // 'imp:facprev:<i>' — the box is that surface's only
  // clarification path, so its state lives and dies with the
  // preview entry it describes.
  const fm=/^imp:facprev:(\d+)$/.exec(key);
  if(fm&&typeof facilityContractPreview!=='undefined'&&facilityContractPreview){const f=facilityContractPreview.facilities[+fm[1]];if(f)return (f.describe=f.describe||{text:null,parsed:null,error:'',busy:false,confirmed:false})}
  return (describeStates[key]=describeStates[key]||{text:null,parsed:null,error:'',busy:false,confirmed:false});
}
function moneyShort(n){return '$'+Number(n||0).toLocaleString('en-US',{maximumFractionDigits:2})}
const WEEKDAY_ALIASES={sunday:0,sundays:0,sun:0,saturday:6,saturdays:6,sat:6,monday:1,mon:1,tuesday:2,tue:2,tues:2,wednesday:3,wed:3,thursday:4,thu:4,thur:4,thurs:4,friday:5,fri:5};
function weekendDayNums(s){const out=[];for(const m of String(s||'').toLowerCase().matchAll(/\b(sundays?|saturdays?|mondays?|tuesdays?|wednesdays?|thursdays?|fridays?|sun|sat|mon|tue|tues|wed|thu|thur|thurs|fri)\b/g)){const n=WEEKDAY_ALIASES[m[1]];if(n!=null&&!out.includes(n))out.push(n)}return out}
function parseWeekendDaysText(text){
  const t=' '+String(text||'').toLowerCase()+' ';
  let days=null;
  const defM=t.match(/weekends?\s+(?:is|are|means?|counts? as)\s+([^.;\n]{3,60})/);
  if(defM){const found=weekendDayNums(defM[1]);if(found.length)days=found}
  const incM=t.match(/weekends?\s+(?:only\s+)?(?:also\s+)?(?:includes?|including|starts?\s+on)\s+([^.;\n]{3,40})/);
  if(incM){const found=weekendDayNums(incM[1]);if(found.length)days=[...new Set([...(days||[0,6]),...found])]}
  const wdM=t.match(/\b(sundays?|saturdays?|mondays?|tuesdays?|wednesdays?|thursdays?|fridays?|sun|sat|mon|tue|tues|wed|thu|thur|thurs|fri)\b[^.;\n]{0,24}?\b(?:is|counts? as|treated as|considered)\s+a\s+weekday/);
  if(wdM){const n=WEEKDAY_ALIASES[wdM[1]];if(n!=null){days=(days||[0,6]).filter(d=>d!==n);if(!days.length)days=null}}
  return days&&days.length?[...new Set(days)].sort((a,b)=>a-b):null;
}
// One call statement in the user's words: "Call 2 is $3,000 on
// weekdays, $2,000 on weekends" → {wd:3000, we:2000}. The amount
// before the word "weekend" is the weekday figure, the one after
// it the weekend figure; a statement that only mentions weekends
// yields only the weekend figure.
function describeCallAmounts(text,n){
  const src=String(text||'');
  const m=new RegExp('call\\s*'+n+'\\b','i').exec(src);if(!m)return null;
  // The statement window (Nov 11, 2026, v125): from the call
  // mention to the end of its line, the next call mention, or
  // 200 chars — and a '.' inside the window ends the statement
  // only when what follows is a genuinely new sentence. The
  // old window ([^.;\n]{0,140}) stopped at ANY '.', which
  // amputated "Holz-call 1=24hr call. Weekday=$4,800 weekend
  // $4,200" at "call" — the amounts live in the clause AFTER
  // the period, so Call 1 read as nothing on every surface
  // without a code list (the contract import preview), while
  // the facility card survived on its code blocks (Caleb's
  // live screenshot: the read-back accounted for his 2nd call
  // and day shifts but not the 24hr call rates he had priced
  // in plain sight). A '.' followed by a day-scope word
  // ("…call. Weekday=$4,800"), an amount ("…call. $4,200 on
  // weekends") or a digit with no space (a decimal, "$4.80")
  // CONTINUES the statement; a '.' followed by anything else
  // ("…call. The stipend is $500") ends it, so a neighbouring
  // sentence's money is never swept in. A ';' still ends the
  // statement outright, as before.
  let end=Math.min(src.length,m.index+200);
  const nl=src.indexOf('\n',m.index);if(nl>=0&&nl<end)end=nl;
  const nx=new RegExp('call\\s*\\d','ig');nx.lastIndex=m.index+m[0].length;
  const nm=nx.exec(src);if(nm&&nm.index<end)end=nm.index;
  let segEnd=end;
  for(let i=m.index;i<end;i++){
    if(src[i]===';'){segEnd=i;break}
    if(src[i]==='.'&&i+1<end){
      if(/\d/.test(src[i+1]))continue;
      const after=src.slice(i+1,end).replace(/^[\s=:\-]*/,'');
      if(after&&!/^(?:weekends?|weekdays?|weeknights?|wknds?|wkdys?|wknights?|\$)/i.test(after)){segEnd=i;break}
    }
  }
  const seg=src.slice(m.index,segEnd),low=seg.toLowerCase(),weIdx=low.indexOf('weekend');
  const amountsIn=s=>[...s.matchAll(/\$([\d,]+(?:\.\d{1,2})?)/g)].map(x=>Number(x[1].replace(/,/g,''))).filter(v=>isFinite(v)&&v>0);
  // A trailing second figure with NO day qualifier ("Call 2 is
  // $3,000, $2,000 on weekends" puts the weekend figure FIRST in
  // the after-part) still needs the weekday/weekend split: when
  // two amounts appear and neither the text nor the second amount
  // says which days it belongs to, the standard statement order
  // (Caleb's own phrasing) is weekday first, weekend second.
  if(weIdx<0){const a=amountsIn(seg);return a.length?(a.length>1?{wd:a[0],we:a[1]}:{wd:a[0]}):null}
  const before=amountsIn(seg.slice(0,weIdx)),after=amountsIn(seg.slice(weIdx));
  const out={};
  if(before.length>1){out.wd=before[0];out.we=before[before.length-1]}
  else if(before.length){
    // A SINGLE amount sitting immediately BEFORE the weekend
    // keyword, with no scope word of its own before it, belongs
    // to that keyword (Nov 11, 2026, v125): "$4,200 on weekends"
    // is the weekend figure — this function's own header has
    // always promised "a statement that only mentions weekends
    // yields only the weekend figure", but the before/after
    // split filed the amount as the weekday rate. An amount a
    // weekday word already claimed ("weekday=$3,000 weekend
    // $2,000") keeps its scope: a scope keyword anywhere before
    // the amount, or anything but "on"-style glue between the
    // amount and the keyword, leaves the weekday reading.
    const head=seg.slice(0,weIdx);
    const amts=[...head.matchAll(/\$([\d,]+(?:\.\d{1,2})?)/g)];
    const last=amts[amts.length-1];
    const claimedByWeekend=!!last&&
      !/\b(?:weekdays?|weeknights?|wkdys?|wknights?)\b/i.test(head.slice(0,last.index))&&
      /^[\s=:\-,]*(?:on|at)?[\s=:\-,]*$/i.test(head.slice(last.index+last[0].length));
    if(claimedByWeekend&&!after.length)out.we=before[0];
    else out.wd=before[0];
  }
  if(after.length&&out.we==null)out.we=after[0];
  if(!before.length&&!after.length)return null;
  if(!before.length&&after.length>1){out.wd=after[0];out.we=after[after.length-1]}
  return Object.keys(out).length?out:null;
}
// --- Code statements in the user's own words (Nov 10, 2026) ---
// The reader's unit is the STATEMENT, not the field: the text is
// cut into clauses (on . ; and line breaks); a clause that NAMES
// a code binds that code, and a clause that names no code carries
// forward to the most recently named one — so "Weekend=$4,200"
// on its own line still belongs to the Call 1 named above it.
// Naming is tolerant: case, punctuation, hyphen spacing and the
// facility prefix are all optional ("Holz-call 1" names the code
// "HOLZ - Call 1"), and a clause may put its amounts BEFORE the
// name ("$3,000 weekdays for Call 2"). Inside a clause, a
// weekday/weekend keyword (incl. wknd / wkdy / weeknights) scopes
// the amount nearest to it, so "weekday=$4,800" and "$4,800
// weekdays" both work, in either order. A clause that prices per
// hour ("$250/hour") contributes no flat amount — the hourly
// figure is the contract reader's job. Nothing here knows any
// facility's codes, names or amounts: the code list is whatever
// the schedule being clarified actually carries.
function describeCodeBlocks(text,codes){
  // Decimals are not clause boundaries (Nov 10, 2026, v111):
  // cutting "paid for 8.5 hours" at the '.' orphaned the "5
  // hours" tail onto whatever code came next and left the
  // paid-hours figure unreadable as a unit — live, the number
  // resurfaced as an $8.50 flat rate on the 8-hour code. Digit
  // '.' digit is protected while clauses are cut and restored
  // in addChunk. Thousands commas get the same protection
  // (\u0002, Nov 11, 2026, v128): "$2,000" otherwise reads as
  // the bare number "2" followed by ",000", and a code named
  // "2" — or the final token of "Call 2" — matched INSIDE
  // the amount and inherited money that was never its own.
  // A "/" set off by spaces is a clause boundary
  // too: Caleb writes his statements separated by " / " on one
  // line, and without the cut a carry-forward clause ("Weekday=
  // $4,800 weekend $4,200") sweeps into the NEXT named code's
  // chunk and donates its amounts to it.
  const t=String(text||'').replace(/(\d)\.(\d)/g,'$1\u0001$2').replace(/(\d),(\d)/g,'$1\u0002$2');
  // Asterisks are part of a code's name, not punctuation (Nov
  // 10, 2026, v113): real grids carry codes like "5*" and "5**"
  // side by side, and tokenizing on [^a-z0-9]+ collapsed BOTH
  // to ["5"] — one shared name form, so every mention was
  // attributed to whichever code came first, the other code
  // never got a block, and the "5**" match ended after the "5",
  // leaving the definition label "** = 10 hour shift". Tokens
  // keep their asterisks (a bare "*" carries no identity and is
  // dropped), and the match boundaries treat "*" as a name
  // character, so "5*" never matches inside "5**" or vice versa.
  const toks=s=>String(s||'').toLowerCase().split(/[^a-z0-9*]+/).filter(tk=>/[a-z0-9]/.test(tk));
  const escRx=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const forms=[];
  for(const c of (codes||[])){
    const code=String(c&&c.code||'');if(!code)continue;
    const full=toks(code);if(!full.length)continue;
    const tailSrc=code.includes(' - ')?code.slice(code.lastIndexOf(' - ')+3):code;
    const seen=new Set();
    const pushForm=(tk,prio)=>{
      if(!tk.length)return;
      const key=tk.join(' ')+'|'+prio;if(seen.has(key))return;seen.add(key);
      // A lone generic word ("call", "day") is not a name — it
      // would match everywhere. Distinctive single tokens
      // ("PCDO", "NOC") and any multi-token form are fine.
      if(tk.length===1&&/^(call|day|shift|first|second)$/.test(tk[0]))return;
      forms.push({code,prio:prio||0,rx:new RegExp('(?<![a-z0-9*])'+tk.map(escRx).join('[^a-z0-9*]+')+'(?![a-z0-9*])','gi')});
    };
    const pushName=tk=>{
      if(!tk.length)return;
      pushForm(tk,0);
      // Plural spelling (Nov 11, 2026, v128): schedules print
      // codes both ways — "8" on one row, "8s" on the next —
      // and users write the name they saw. A code whose last
      // token ends in a digit or asterisk also answers to its
      // plural ("8s", "10s"), at LOWER priority than any exact
      // form, so a code literally named "8s" keeps its own
      // mentions. The trailing lookahead keeps the plural's
      // "s" from being read out of a longer word ("shifts",
      // "hrs" are never code names).
      const last=tk[tk.length-1];
      if(last&&/[0-9*]$/.test(last)&&!/s$/.test(last))pushForm(tk.slice(0,-1).concat(last+'s'),1);
    };
    // Standard call synonyms (Nov 11, 2026, v128): a code the
    // app knows as first or second call (its saved type says
    // so) also answers to the names schedules and contracts
    // use for it — "first call", "1st call", "second call",
    // "2nd call" — the same synonyms canonicalTypeOf already
    // recognizes. Without them, "First call (24 hour) pays
    // $4,800…" named nothing the reader knew, and its amounts
    // were free to slide onto the next code the text named.
    const ct0=String(c&&c.ctype||'');
    if(ct0==='24-hour call'){pushName(toks('call 1'));pushName(toks('1st call'));pushName(toks('first call'))}
    else if(ct0==='Second call'){pushName(toks('call 2'));pushName(toks('2nd call'));pushName(toks('second call'))}
    for(const tk of [full,toks(tailSrc)]){
      if(!tk.length)continue;
      pushName(tk);
      // Shortened names (Nov 11, 2026, v128): users abbreviate
      // a code to its tail end — "Main 8" for "G Main (8)",
      // "8" for "CAMC 8". Every token suffix of two or more,
      // and the final token on its own when it carries the
      // identity (a digit or asterisk, or a distinctive word),
      // is also a name for the code. This generalizes the old
      // ' - ' tail rule, which only fired when the code's name
      // happened to contain a dash: "CAMC 8" had NO short form
      // at all, so a user writing "8=…" named nothing the
      // reader knew and every definition dropped silently.
      for(let k=1;k<=tk.length-2;k++)pushName(tk.slice(k));
      const last=tk[tk.length-1];
      if(tk.length>1&&last&&(/[0-9*]/.test(last)||(last.length>=4&&!/^(call|day|shift|first|second|main)$/.test(last))))pushName([last]);
    }
  }
  const scopeRx=/\b(weekends?|wknds?|weekdays?|wkdys?|weeknights?|wknights?)\b/i;
  const out={};
  const addChunk=(code,chunk,after)=>{
    chunk=String(chunk||'').replace(/\u0001/g,'.').replace(/\u0002/g,',');
    if(after!=null)after=String(after).replace(/\u0001/g,'.').replace(/\u0002/g,',');
    const e=out[code]||(out[code]={phrase:'',amounts:[],text:''});
    e.text=(e.text?e.text+' ':'')+chunk;
    if(!e.phrase){
      let p=String(after!=null?after:chunk||'').replace(/^[\s=:\-–—.()]+/,'').replace(/^(?:is|are|means|called|pays?|at)\s+/i,'');
      p=p.split(/\b(?:weekends?|wknds?|weekdays?|wkdys?|weeknights?|wknights?)\b/i)[0].split(/[.;\n$,]/)[0].trim().replace(/\s+/g,' ').replace(/[\s\-–—:\/]+$/,'');
      // Glue is not a phrase (Nov 11, 2026, v128): a subject
      // list's first name is followed by nothing but the
      // conjunction ("5* or 5**=…" leaves "or" as the first
      // code's trailing text), and that word used to become
      // the code's "phrase" — an unresolvable label that
      // priced nothing and blocked the real definition.
      if(p&&!/[a-z0-9*$]/.test(p.replace(/\b(?:and|or)\b/gi,'')))p='';
      if(p)e.phrase=p;
    }
    {
      // Per-amount hourly exclusion (Nov 11, 2026, v128): a
      // dollar figure is the hourly rate only when the hourly
      // unit rides on THAT figure — "$250/hr", "$250 per
      // hour", "hourly is $250". The old chunk-level test
      // dropped EVERY amount in a statement that mentioned an
      // hourly rate anywhere: "$250/hr" held as a lead-in
      // poisoned the next clause, and "8 is $2,000 a shift"
      // lost its $2,000 without a trace.
      const amounts=[...String(chunk).matchAll(/\$([\d,]+(?:\.\d{1,2})?)/g)].map(x=>({v:Number(x[1].replace(/,/g,'')),start:x.index,end:x.index+x[0].length,scope:null}))
        .filter(a=>!/^\s*(?:\/|per\s+)?(?:hrs?|hours?|hourly)\b/i.test(String(chunk).slice(a.end,a.end+12))&&!/hourly(?:\s+rate)?\s*(?:is|:|=)?\s*$/i.test(String(chunk).slice(Math.max(0,a.start-16),a.start)));
      const kws=[...String(chunk).matchAll(new RegExp(scopeRx.source,'gi'))].map(x=>({kind:/^(?:weeke|wknd)/i.test(x[1])?'we':'wd',start:x.index,end:x.index+x[0].length}));
      for(const kw of kws){let best=null,bd=Infinity;for(const a of amounts){const d=kw.start>=a.end?kw.start-a.end:(kw.end<=a.start?a.start-kw.end:0);if(d<bd){bd=d;best=a}}if(best&&!best.scope)best.scope=kw.kind}
      for(const a of amounts)if(isFinite(a.v)&&a.v>0)e.amounts.push(a);
    }
  };
  const segCodes=seg=>{
    const ms=[];
    for(const f of forms){let m;f.rx.lastIndex=0;while((m=f.rx.exec(seg))!==null){
      // A mention ending right at a protected decimal point
      // is a number fragment, not a name (Nov 11, 2026,
      // v128): "paid for 8.5 hours" protects to "8\u00015",
      // and the bare "8" a shortened-name form sees there is
      // the paid-hours figure, never a code mention.
      if(seg[m.index+m[0].length]!=='\u0001'&&seg[m.index+m[0].length]!=='\u0002')ms.push({code:f.code,start:m.index,end:m.index+m[0].length,len:m[0].length,prio:f.prio||0});
      if(m.index===f.rx.lastIndex)f.rx.lastIndex++}}
    // Longest match wins a span; at equal span an exact form
    // beats a plural variant, so a code literally named "8s"
    // keeps the mentions its own name earns.
    ms.sort((a,b)=>a.start-b.start||b.len-a.len||a.prio-b.prio);
    const acc=[];let cov=-1;for(const mn of ms){if(mn.start<cov)continue;acc.push(mn);cov=mn.end}
    return acc;
  };
  // Duration mentions (Nov 11, 2026, v128): a bare number
  // immediately followed by an hour unit is a DURATION, not
  // a code reference — "5** are 10 hour shifts" matched the
  // code "10" inside the definition itself, cut the phrase
  // down to "are", and orphaned the subject. The clause's
  // FIRST mention is exempt: a statement may open with its
  // subject ("10 = 10hr shifts" — that restatement is the
  // collapse's business, below).
  const dropDurations=(seg,list)=>list.filter((mn,i)=>{
    if(i===0)return true;
    if(!/^\d+$/.test(seg.slice(mn.start,mn.end)))return true;
    return !/^\s*-?\s*(?:hrs?|hours?)\b/i.test(seg.slice(mn.end,mn.end+12));
  });
  let current=null,lead='',leadCodes='';
  const mentionOrder=[];
  const pendingRefs={};
  const listGroups=[];
  const segParts=t.split(/([.;\n;]+|\s+\/\s+)/);
  for(let si=0;si<segParts.length;si+=2){
    let rawSeg=segParts[si];
    const sepAfter=si+1<segParts.length?segParts[si+1]:'';
    if(!rawSeg.trim())continue;
    // A spaced slash is a LIST joiner, not a sentence break
    // (Nov 11, 2026, v128): "5* / 5** = 10hr shifts" was cut
    // into a bare "5*" clause and a defining "5**" clause,
    // and the first code got an empty block. A clause that
    // names codes but says nothing about them (names and
    // joiners only — see the hold below) is the head of the
    // list the slash joins; it is prepended here so the two
    // halves read as one statement.
    if(leadCodes){rawSeg=leadCodes+rawSeg;leadCodes=''}
    // A clause naming no code carries FORWARD to the most
    // recently named one — but a clause before ANY code has been
    // named can only be a lead-in for the statement that follows
    // ("$4,800 weekdays / $4,200 weekends for Call 1" — the "/"
    // cut must not orphan the weekday amount from its code), so
    // leading code-less clauses are held and prepended to the
    // first code-naming clause instead of being dropped. Only
    // amount-bearing clauses are held: a definition sentence
    // ("Weekend is Friday and Saturday") carries no money, is
    // read at text level elsewhere, and its stray day keywords
    // would poison the nearest-amount scoping if prepended.
    let seg=rawSeg,acc=dropDurations(seg,segCodes(seg));
    if(!acc.length&&current==null&&/\$/.test(rawSeg)){lead+=rawSeg+' ';continue}
    if(lead){seg=lead+rawSeg;acc=dropDurations(seg,segCodes(seg));lead=''}
    // A code restated as the first words of its own definition
    // is not a second subject (Nov 11, 2026, v122): "12=12 hr
    // shifts" matched the code TWICE — the space in "12 hr"
    // let the restatement stand as its own mention, the chunk
    // split there, and the phrase came out as "hr shifts",
    // which reads as nothing. ("8=8hr" survived only because
    // "8hr" cannot re-match.) When the gap between two mentions
    // of the SAME code is nothing but separators, the second
    // mention is the definition restating the code — collapse
    // it so the phrase survives whole.
    if(acc.length>1){
      const kept=[acc[0]];
      for(let i=1;i<acc.length;i++){
        const prev=kept[kept.length-1];
        if(acc[i].code===prev.code){
          const gap=seg.slice(prev.end,acc[i].start);
          // Separators only (v122) — or separators plus the
          // assignment's own small words (v128): "8 is an 8
          // hour shift" restates the code after "is an", and
          // keeping the second mention cut the phrase down to
          // the article ("an"), which reads as nothing.
          if(/^(?:[\s=:\-–—.,&]|\b(?:and|or)\b|\b(?:is|are|means|an?|the)\b)*$/.test(gap))continue;
          // Alias list (Nov 11, 2026, v128): the SAME code
          // named twice with only a conjunction between —
          // "8s or 8=8hr shifts" offers the plural and the
          // plain spelling as ONE subject — and an assignment
          // right after the second name. One subject: the
          // mention extends over both spellings, so the
          // definition that follows binds a single time.
          if(/^(?:[\s=:\-–—.,&]|\b(?:and|or)\b)+$/i.test(gap)&&/^\s*[=:]/.test(seg.slice(acc[i].end,acc[i].end+3))){prev.end=acc[i].end;prev.len=prev.end-prev.start;continue}
        }
        kept.push(acc[i]);
      }
      acc=kept;
    }
    // Glue-only clause before a slash (Nov 11, 2026, v128):
    // the segment names codes but says nothing about them —
    // outside the mentions there is only joiner glue, and no
    // money. When the boundary after it is the spaced slash,
    // it is a list head: hold it and let the next clause read
    // as its continuation. After any other boundary the same
    // shape just leaves empty blocks, which the parse then
    // surfaces as unanswered — named, never silent.
    if(acc.length&&!/\$/.test(seg)&&/^\s*\/\s*$/.test(sepAfter)){
      let stripped='',pos=0;for(const mn of acc){stripped+=seg.slice(pos,mn.start);pos=mn.end}stripped+=seg.slice(pos);
      if(/^(?:[\s=:\-–—.,&\/]|\b(?:and|or)\b)*$/i.test(stripped)){leadCodes=seg+' ';continue}
    }
    if(!acc.length){if(current)addChunk(current,seg,null);continue}
    for(let i=0;i<acc.length;i++){
      const mn=acc[i];
      const from=i===0?0:mn.start,to=i+1<acc.length?acc[i+1].start:seg.length;
      let afterTxt=seg.slice(mn.end,to);
      // A numeric code IS the hour count of its own definition
      // when the definition continues the number ("8-hour
      // shift" — the "8" was consumed as the code mention, so
      // the phrase that remains is "-hour shift"). Fold the
      // code's digits back in so the phrase reads whole.
      const numTail=String(mn.code).match(/(\d+)\s*$/);
      if(numTail&&/^\s*-?\s*h(?:ou)?rs?\b/i.test(afterTxt))afterTxt=numTail[1]+afterTxt;
      addChunk(mn.code,seg.slice(from,to),afterTxt);
      current=mn.code;
      if(!mentionOrder.includes(mn.code))mentionOrder.push(mn.code);
    }
    // Reference recording (Nov 10, 2026, v113): the slicing
    // above cuts the referenced code's NAME out of the subject's
    // chunks, so a "same as" reference has to be recorded here,
    // at statement level, where both names are still present —
    // a reference relation between two codes named in one
    // statement points the first at the second, and the
    // inheritance pass at the end resolves it.
    for(let i=0;i+1<acc.length;i++){
      const rel=seg.slice(acc[i].end,acc[i+1].start);
      if(/(?:=|\bsame\s+as\b|\bidentical\s+to\b|\bditto\b|\blike\b)/i.test(rel)&&!pendingRefs[acc[i].code])pendingRefs[acc[i].code]=acc[i+1].code;
      // A subject LIST shares one definition (Nov 11, 2026,
      // v122): "5* and 5**=10hr shifts" names two codes joined
      // by a bare conjunction, with the assignment after the
      // second — the first code is a subject of the same
      // statement, not a bystander. The slicing hands the
      // definition to the code it follows, so record the first
      // code as pointing at the second and let the inheritance
      // pass below share the read — the same machinery "same
      // as" uses. Scoped to a glue-only gap followed by an
      // assignment, so an incidental "and" between unrelated
      // statements binds nothing. (v128: the gap is the whole
      // glue family — and / or / & / comma / slash / bare
      // space after a slash-joined list head — and the
      // assignment may be a verb: "5* or 5** are 10hr shifts"
      // binds exactly like "5* and 5**=10hr shifts". Caleb's
      // CAMC card text used "or" throughout and every listed
      // code but the last dropped.)
      if(!pendingRefs[acc[i].code]&&/^(?:[\s:.,&\/]|\b(?:and|or)\b)+$/i.test(rel)){
        const afterNext=seg.slice(acc[i+1].end,i+2<acc.length?acc[i+2].start:seg.length);
        if(/^\s*(?:[=:]|\bis\b|\bare\b|\bmeans?\b)/.test(afterNext))pendingRefs[acc[i].code]=acc[i+1].code;
      }
    }
    // List group (Nov 11, 2026, v128): every gap in the
    // statement is glue and each code is named once — the
    // codes were offered as ONE subject. The group is
    // remembered so the sharing pass below can give every
    // member the read, wherever the slicing put it.
    if(acc.length>=2&&new Set(acc.map(mn2=>mn2.code)).size===acc.length){
      let allGlue=true;
      for(let i=0;i+1<acc.length;i++){if(!/^(?:[\s:.,&\/]|\b(?:and|or)\b)*$/i.test(seg.slice(acc[i].end,acc[i+1].start))){allGlue=false;break}}
      if(allGlue)listGroups.push(acc.map(mn2=>mn2.code));
    }
    // Subject binding (Nov 10, 2026, v113): a statement can name
    // TWO codes — "5* = same as 5**: 10 hour shift, $250/hr" —
    // where the FIRST code is the subject and the second is only
    // a reference. The slicing above hands the definition after
    // the colon to the code it follows (the reference), so the
    // subject kept nothing but "same as". When the words between
    // the subject and the referenced code are a reference
    // relation ("=", "same as", "identical to", "like", "ditto")
    // and a ":" follows the referenced code, the definition
    // after that colon ALSO binds to the subject.
    if(acc.length>=2){
      const rel=seg.slice(acc[0].end,acc[1].start);
      if(/(?:=|\bsame\s+as\b|\bidentical\s+to\b|\bditto\b|\blike\b)/i.test(rel)){
        const colon=seg.indexOf(':',acc[1].end);
        if(colon>acc[1].end){const defText=seg.slice(colon+1);if(defText.trim())addChunk(acc[0].code,defText,null)}
      }
    }
  }
  for(const code of Object.keys(out)){
    const e=out[code];let wd=null,we=null;
    for(const a of e.amounts){if(a.scope==='we'){if(we==null)we=a.v;else if(wd==null)wd=a.v}else if(a.scope==='wd'){if(wd==null)wd=a.v;else if(we==null)we=a.v}else{if(wd==null)wd=a.v;else if(we==null)we=a.v}}
    e.wd=wd;e.we=we;e.hasAmounts=e.amounts.length>0;delete e.amounts;
    // No-pay statements (Nov 10, 2026): the user's words can DENY
    // pay, not just state it — "post call day off=no pay" was read
    // as a label and the facility hourly default filled in $2,000
    // the user had explicitly ruled out. The block's own text is
    // the evidence: an explicit denial ("no pay", "unpaid", "not
    // paid", a stated $0 — which the amount capture above drops,
    // since it keeps only positive figures) or a day-off meaning
    // ("day off", "PTO", "time off") with NO positive amount
    // attached resolves the code UNPAID. A positive amount outranks
    // a bare day-off phrase ("post call day off, paid $500 flat"
    // pays $500 — "paid $" settles it); a positive amount beside
    // an explicit denial with nothing settling which governs is a
    // genuine conflict, left for the one follow-up question.
    const lt=' '+(e.text||'').toLowerCase()+' ';
    const zeroAmt=/\$\s*0(?:\.0{1,2})?\b/.test(e.text||'');
    const noPay=/\b(?:no\s+pay(?:ment)?|unpaid|not\s+paid|isn'?t\s+paid|aren'?t\s+paid|doesn'?t\s+pay|does\s+not\s+pay|non-?billable)\b/.test(lt);
    const dayOff=/\b(?:day\s+off|off\s+day|days?\s+off|pto|paid\s+time\s+off|time\s+off)\b/.test(lt);
    const paidStmt=/(?:\bpaid\s+\$|\bpays?\s+\$|\bpay\s+of\s+\$|\bflat\s+\$)/.test(lt);
    e.noPay=noPay||zeroAmt;e.dayOff=dayOff;
    if(e.hasAmounts){if(e.noPay&&!paidStmt)e.conflict=true}
    else if(e.noPay||dayOff)e.unpaid=true;
    // Paid hours stated in THIS code's own statement (Nov 10,
    // 2026, v111): they belong to this code alone. The text's
    // first paid-hours figure also lands in the facility-level
    // paidHours8 via the generic extraction, and that field used
    // to be stamped onto EVERY day code's definition — a 10-hour
    // code inherited the 8-hour shift's 8.5 and priced $2,125.
    // A code that states its own ("paid for 10.5 hours") keeps
    // its own; a code that states none gets none from here.
    const phM=(e.text||'').match(/paid\s+(?:for\s+)?(\d+(?:\.\d+)?)\s*hours?\b/i)||(e.text||'').match(/(\d+(?:\.\d+)?)\s*paid\s*hours?\b/i);
    e.paidHours=phM?Number(phM[1]):null;
    // Cross-code references (Nov 10, 2026, v113): "5* = same as
    // 5**" states no definition of its own — it POINTS at
    // another code's. Record the reference while the block's
    // text is still at hand: the code a reference word ("same
    // as", "identical to", "like", "=") directly precedes, or —
    // for "same as above" / a bare "ditto" — a marker the
    // inheritance pass below resolves against the order codes
    // were first named in. Resolution happens after every
    // block is built, so a reference to a code defined LATER
    // in the text resolves exactly like one defined earlier.
    e.sameAs=null;e.sameAsAbove=false;
    {
      const raw=String(e.text||'');
      if(/\b(?:same\s+as|identical\s+to|ditto|same\s+deal|just\s+like|like)\b/i.test(raw)){
        for(const f of forms){
          if(f.code===code)continue;
          f.rx.lastIndex=0;let m,hit=false;
          while((m=f.rx.exec(raw))!==null){
            const before=raw.slice(Math.max(0,m.index-28),m.index);
            if(/(?:same\s+as|identical\s+to|ditto|like|=)\s*$/i.test(before)){e.sameAs=f.code;hit=true;break}
            if(m.index===f.rx.lastIndex)f.rx.lastIndex++;
          }
          if(hit)break;
        }
        if(!e.sameAs&&/\b(?:same\s+as\s+(?:the\s+)?above|ditto)\b/i.test(raw))e.sameAsAbove=true;
      }
    }
    // The statement-level record (both names present when it
    // was taken) outranks the block-text search above.
    if(pendingRefs[code])e.sameAs=pendingRefs[code];
    delete e.text;
  }
  // Reference inheritance (Nov 10, 2026, v113): a block whose
  // statement only points at another code inherits that code's
  // read — phrase, split amounts, paid hours, no-pay — once
  // every statement has been read. Its OWN stated definition
  // always wins: a block that prices or denies pay itself is
  // never overwritten. Chains resolve by repetition, and a
  // reference cycle, or a reference to a code with no read of
  // its own, leaves the block for the one follow-up question,
  // exactly as an unstated code was handled before.
  {
    const hasOwn=e=>!!(e&&(canonicalTypeOf(e.phrase||'')||e.hasAmounts||e.unpaid||e.conflict));
    for(let pass=0;pass<=(codes||[]).length;pass++){
      let changed=false;
      for(const code of Object.keys(out)){
        const e=out[code];if(hasOwn(e))continue;
        let tgt=e.sameAs||null;
        if(!tgt&&e.sameAsAbove){const i=mentionOrder.indexOf(code);if(i>0)tgt=mentionOrder[i-1]}
        if(!tgt||tgt===code)continue;
        const tb=out[tgt];if(!tb||!hasOwn(tb))continue;
        e.phrase=tb.phrase;e.wd=tb.wd;e.we=tb.we;e.hasAmounts=tb.hasAmounts;
        e.paidHours=tb.paidHours;e.noPay=tb.noPay;e.dayOff=tb.dayOff;e.unpaid=tb.unpaid;e.conflict=tb.conflict;
        changed=true;
      }
      if(!changed)break;
    }
    // List sharing (Nov 11, 2026, v128): codes named as ONE
    // glue-joined subject share the statement's read wherever
    // the slicing happened to put it. The slicing hands
    // content to the code it follows — for "5* and 5**=10hr
    // shifts" that is the second name; for "$2,500 for 5* and
    // 5**" the amount precedes both names and lands on the
    // first. Either way the sentence defines the LIST, so a
    // member with no read of its own takes the read of a
    // member that has one — the reference rule, applied to
    // the group. A member with its own read is never touched.
    for(const group of listGroups){
      const src=group.map(c=>out[c]).find(e=>hasOwn(e));
      if(!src)continue;
      for(const code of group){
        const e=out[code];if(!e||hasOwn(e))continue;
        e.phrase=src.phrase;e.wd=src.wd;e.we=src.we;e.hasAmounts=src.hasAmounts;
        e.paidHours=src.paidHours;e.noPay=src.noPay;e.dayOff=src.dayOff;e.unpaid=src.unpaid;e.conflict=src.conflict;
      }
    }
    for(const code of Object.keys(out)){delete out[code].sameAs;delete out[code].sameAsAbove}
  }
  return out;
}
// Misread day flats (Nov 10, 2026, v111): a flat DAY rate in a
// words parse is only ever as trustworthy as its statement. The
// generic extractors (and the AI rule read that merges over this
// parse) can borrow a nearby NUMBER and file it as a per-shift
// flat — live, "paid for 8.5 hours" came back as an $8.50 rate8
// flat, and a flat outranks the hourly rule everywhere, so the
// misread silently priced every 8-hour shift at $8.50. When the
// text states NO per-day/flat phrasing at all, a day flat is
// dropped when it is recognisably not a per-shift amount: it
// equals the paid-hours figure, it equals the shift's own hour
// count, it is smaller than the hourly rate (no facility pays
// less for a whole shift than for one hour), or its value is an
// amount the text ties to a DIFFERENT code (a call split, another
// code's stated pay) and no code of this flat's own type states
// it. Genuine flats survive untouched: they arrive with per-day
// phrasing ("$2,000 per day", "flat"), or stand as their own
// code's stated amount.
function describeSanitizeRates(rates,text,blocks,codes){
  if(!rates||/(?:per\s+day|a\s+day|daily|per\s+shift|flat)/i.test(String(text||'')))return;
  const ph=rateOrNull(rates.paidHours8),hr=rateOrNull(rates.hourlyRate);
  const other=new Set();
  for(const k of ['rate24','weekendRate24','rateSecond','weekendRateSecond','callBonus']){const v=rateOrNull(rates[k]);if(v!=null)other.add(v)}
  const own={rate8:new Set(),rate10:new Set(),rate12:new Set()};
  for(const c of (codes||[])){
    const b=blocks&&blocks[c.code];if(!b)continue;
    const bt=canonicalTypeOf(b.phrase||'')||c.ctype||'';
    const key=/8-hour/.test(bt)?'rate8':/10-hour/.test(bt)?'rate10':/12-hour/.test(bt)?'rate12':'';
    for(const v of [b.wd,b.we]){if(v==null)continue;if(key)own[key].add(v);else other.add(v)}
  }
  for(const k of ['rate8','rate10','rate12']){
    const v=rateOrNull(rates[k]);if(v==null)continue;
    if((ph!=null&&v===ph)||v===Number(k.slice(4))||(hr!=null&&v<hr)||(other.has(v)&&!own[k].has(v)))delete rates[k];
  }
}
function describeParseLocal(text,fac,codes){
  const t=String(text||'');
  // Code-universe augmentation (Nov 10, 2026, v114): when a
  // facility is in hand, its known codes (saved definitions
  // UNION the codes on its saved shifts — facilityDescribeCodes)
  // join the caller's list, so a code the caller did not list
  // but the facility carries can still be read when the text
  // names it. Codes that exist ONLY as shift codes (no saved
  // definition — facilityDescribeCodes marks them shiftOnly)
  // are mention-gated in the unanswered list below, however
  // they arrived: they are asked about only when the text
  // actually names them — an unmentioned code the facility
  // happens to carry must not invent a question (confusion
  // budget). Defined codes and caller-listed import codes keep
  // the existing semantics (on an import, every listed code is
  // on the schedule being imported, so each is asked about).
  const codeList=(codes||[]).slice();
  if(fac){
    const callerKeys=new Set(codeList.map(c=>codeStripKey(c&&c.code,fac)));
    for(const e of facilityDescribeCodes(fac)){
      const k=codeStripKey(e.code,fac);
      if(!k||callerKeys.has(k))continue;
      callerKeys.add(k);codeList.push(e);
    }
  }
  const ex=contractExtractRates(t);
  const rates={};
  const put=(k,v)=>{const n=rateOrNull(v);if(n!=null)rates[k]=n};
  put('hourlyRate',ex.hourly);put('paidHours8',ex.paidHours8);
  // (Flat day rates come from contractExtractRates, whose day-rate
  // patterns require a per-day statement in the amount's own
  // clause — an hourly figure standing near an "8-hour" mention
  // never becomes a flat rate that would outrank the hourly rule.)
  put('rate8',ex.rate8);put('rate10',ex.rate10);put('rate12',ex.rate12);
  put('rate24',ex.rate24);put('weekendRate24',ex.weekendRate24);put('rateSecond',ex.rateSecond);put('weekendRateSecond',ex.weekendRateSecond);put('callBonus',ex.callBonus);put('hourlyCall1st',ex.hourlyCall1st);
  // A flat day rate equal to the hourly figure, with no per-day/flat
  // phrasing anywhere in the text, is the hourly figure misread by
  // the generic per-line fallback ("$250 … 8-hour") — a flat rate
  // outranks the hourly rule in the pricer, so the misread would
  // silently win. Genuine flats (CAMC $2,000/day ≠ $250/hr) survive.
  {const hr=rates.hourlyRate;if(hr!=null&&!/(?:per\s+day|a\s+day|daily|per\s+shift|flat)/i.test(t)){for(const fk of ['rate8','rate10','rate12']){if(rates[fk]!=null&&rates[fk]===hr)delete rates[fk]}}}
  const cs2=describeCallAmounts(t,2);if(cs2){if(cs2.wd!=null)rates.rateSecond=cs2.wd;if(cs2.we!=null)rates.weekendRateSecond=cs2.we}
  const cs1=describeCallAmounts(t,1);if(cs1){if(cs1.wd!=null)rates.rate24=cs1.wd;if(cs1.we!=null)rates.weekendRate24=cs1.we}
  // Code statements are the most specific signal in the text —
  // amounts the user tied to a code they NAMED land on that
  // code's rate fields ahead of the generic extraction above.
  const blocks=describeCodeBlocks(t,codeList);
  for(const c of codeList){
    const blk=blocks[c.code];if(!blk||(blk.wd==null&&blk.we==null))continue;
    const bt=canonicalTypeOf(blk.phrase)||c.ctype||'';
    if(bt==='24-hour call'){if(blk.wd!=null)rates.rate24=blk.wd;if(blk.we!=null)rates.weekendRate24=blk.we}
    else if(bt==='Second call'){if(blk.wd!=null)rates.rateSecond=blk.wd;if(blk.we!=null)rates.weekendRateSecond=blk.we}
  }
  describeSanitizeRates(rates,t,blocks,codeList);
  const weekendDays=parseWeekendDaysText(t);
  const low=' '+t.toLowerCase()+' ';
  const eff={};for(const k of ['hourlyRate','paidHours8','rate8','rate10','rate12','rate24','weekendRate24','hourlyCall1st','rateSecond','weekendRateSecond','callBonus']){const v=rates[k]!=null?rates[k]:(fac?rateOrNull(fac[k]):null);if(v!=null)eff[k]=v}
  const defs={},unanswered=[];
  for(const c of codeList){
    const existing=fac?codeDefFor(fac,c.code):null;
    const codeStr=String(c.code||'').toLowerCase();
    const codeHit=codeStr.trim().length>=3&&low.includes(codeStr);
    // A statement about the code itself — "5** is an 8-hour day
    // shift", "STM - Backup is Backup call, 4 hours": the label the
    // user gives this code (their case preserved) and the hours
    // when they state them in words. The character after the code
    // must not continue it ("5*" must not match inside "5**").
    let stmtLabel='',stmtHours=null;
    if(codeStr){
      const idx=low.indexOf(' '+codeStr)>=0?low.indexOf(' '+codeStr)+1:(low.startsWith(codeStr)?0:-1);
      if(idx>=0&&!/[a-z0-9*]/.test(low.charAt(idx+codeStr.length))){
        const seg=t.slice(Math.max(0,idx-1),Math.max(0,idx-1)+140).split(/[.;\n]/)[0],segLow=seg.toLowerCase();
        const lm=seg.match(/(?:is|means|called)\s+(?:an?\s+|the\s+)?([A-Za-z][A-Za-z0-9 /-]{2,40})/);
        if(lm)stmtLabel=lm[1].trim().replace(/\s+/g,' ').replace(/[\s-]+$/,'').replace(/^(?:a|an|the)\s+/i,'');
        const hm=segLow.match(/(\d+(?:\.\d+)?)\s+hours?\b/);if(hm)stmtHours=Number(hm[1]);
      }
    }
    // The user's own statement ABOUT this code (found by the
    // tolerant statement matcher, not just the verbatim string):
    // its phrase is the label when the strict extraction found
    // none, and its amounts are this code's own pay.
    const blk=blocks[c.code]||null;
    if(blk&&blk.phrase&&!stmtLabel)stmtLabel=blk.phrase;
    const ct=canonicalTypeOf(stmtLabel)||c.ctype||(existing&&existing.canonicalType)||'';
    let hit=false;
    if(ct==='Second call')hit=/\b(call\s*2|2nd\s+call|second\s+call)\b/.test(low)||codeHit||!!stmtLabel||rates.rateSecond!=null||rates.weekendRateSecond!=null;
    else if(ct==='24-hour call')hit=/\b(call\s*1|1st\s+call|first\s+call|24\s*-?\s*h(?:ou)?r\s+call)\b/.test(low)||codeHit||!!stmtLabel||rates.rate24!=null||rates.weekendRate24!=null;
    else if(ct)hit=/\b(day\s+shifts?|day|main|8[\s-]?hour|10[\s-]?hour|12[\s-]?hour)\b/.test(low)||codeHit||!!stmtLabel||rates.hourlyRate!=null||rates.rate8!=null||rates.rate10!=null||rates.rate12!=null;
    else hit=codeHit||!!stmtLabel;
    // Naming the code in the text is itself the hit — the user
    // plainly stated something about it; only COVERAGE (a price
    // the statement or the rates can produce) may still ask.
    if(blk)hit=true;
    let defHours=stmtHours!=null?String(stmtHours):((existing&&existing.hours)||c.hours||'');
    if((defHours===''||defHours==null)&&ct){const im=ct.match(/(\d+)-hour (?:day|shift)/);if(im)defHours=im[1]}
    // An explicit no-pay statement is a COMPLETE answer, not a gap
    // (Nov 10, 2026): the code resolves to an UNPAID definition.
    // No priced canonical type may attach — the feed's own guess
    // (an '8-hour day' for a PCDO row) must not fill the vacuum
    // the way it did when "no pay" was read as a mere label — and
    // the label keeps the user's meaning with the denial itself
    // trimmed off ("post call day off=no pay" → "post call day
    // off"). It never lands in unanswered: nothing is unknown.
    if(blk&&blk.unpaid){
      const cleanLbl=String(stmtLabel||'').replace(/\s*(?:=|:|—|–|-)?\s*(?:no\s+pay(?:ment)?|unpaid|not\s+paid)\b.*$/i,'').replace(/[\s=:\-–—]+$/,'').trim();
      defs[c.code]={label:cleanLbl||(blk.dayOff?'Day off':'No pay'),hours:defHours,canonicalType:'',paidHours:null,unpaid:true};
      continue;
    }
    // A positive amount AND an explicit denial for the same code,
    // with no wording settling which governs ("paid $500" settles
    // it for the amount), is the one genuine conflict: the code
    // stays unanswered so the follow-up question asks in words.
    if(blk&&blk.conflict){unanswered.push(c.code);continue}
    const covers=(ct==='Second call'?(eff.rateSecond!=null||eff.weekendRateSecond!=null||eff.callBonus!=null)
      :ct==='24-hour call'?(eff.rate24!=null||eff.weekendRate24!=null||eff.hourlyCall1st!=null)
      :ct?(eff.hourlyRate!=null||eff.rate8!=null||eff.rate10!=null||eff.rate12!=null)
      :(eff.hourlyRate!=null&&rateOrNull(defHours)!=null&&rateOrNull(defHours)>0))
      ||!!(blk&&(blk.wd!=null||blk.we!=null));
    if(hit&&covers){
      const isDay=!!ct&&/hour/.test(ct)&&!/call/i.test(ct);
      // Paid hours are PER-CODE knowledge (Nov 10, 2026, v111):
      // the figure in this code's own statement wins; the
      // facility-level paidHours8 is BY DEFINITION the 8-hour
      // shift's paid hours, so it may only fill an 8-hour code's
      // definition — stamping it onto a 10-hour code priced that
      // code at the 8-hour product ($250 x 8.5 = $2,125 on a
      // 10-hour day that states no paid hours of its own).
      const blkPh=blk?rateOrNull(blk.paidHours):null;
      // Inheriting the SAVED definition's paid hours for a
      // non-8-hour code (Nov 10, 2026, v112): the saved figure
      // is this code's own answer only when it is not the
      // residue signature — a words-created definition whose
      // paidHours EQUALS the facility's paidHours8, with no
      // own-statement marker, is the v110 misread itself (the
      // 8-hour figure stamped onto a code that never stated
      // it), and inheriting it re-supplied the residue on
      // every re-parse: the read-back showed it, and the save
      // retraction (which fires only when the parse states no
      // paid hours) never fired. A figure the code's own
      // statement stated (paidHoursOwn) or one that differs
      // from the facility figure is the code's own and is
      // inherited as before; field-captured definitions are
      // never words-created, so they inherit as before too.
      const exPh=existing?rateOrNull(existing.paidHours):null;
      const exResidue=!!(existing&&existing.viaWords&&!existing.paidHoursOwn&&eff.paidHours8!=null&&exPh!=null&&exPh===eff.paidHours8);
      const inheritPh=exPh!=null&&!exResidue?exPh:null;
      const newDef={label:stmtLabel||(existing&&existing.label)||ct||c.code,hours:defHours,canonicalType:ct,paidHours:isDay?(blkPh!=null?blkPh:(ct==='8-hour day'?(rateOrNull(rates.paidHours8)!=null?rateOrNull(rates.paidHours8):(existing?rateOrNull(existing.paidHours):null)):inheritPh)):null};
      // Paid hours stated in THIS code's own statement are the
      // code's own (marked, so no heal can mistake them for
      // the facility figure's residue); an inherited own
      // figure keeps its marker.
      if(blkPh!=null)newDef.paidHoursOwn=true;
      else if(newDef.paidHours!=null&&existing&&existing.paidHoursOwn)newDef.paidHoursOwn=true;
      // A figure inherited from a definition that is NOT
      // words-created is a field-captured answer for this
      // code (the clarification fields) — also the code's own,
      // however the save that preserves it gets stamped.
      else if(newDef.paidHours!=null&&existing&&!existing.viaWords&&exPh!=null&&newDef.paidHours===exPh)newDef.paidHoursOwn=true;
      // Amounts stated for a code whose type has no facility
      // split fields (a night call, a flat day code) stay ON the
      // definition — they are this code's own clarified pay.
      if(blk&&(blk.wd!=null||blk.we!=null)&&ct!=='Second call'&&ct!=='24-hour call'){if(blk.wd!=null)newDef.weekdayPay=blk.wd;if(blk.we!=null)newDef.weekendPay=blk.we}
      defs[c.code]=newDef;
    }else if(!c.shiftOnly||blk||codeHit||stmtLabel)unanswered.push(c.code);
  }
  // Unknown-subject net (Nov 11, 2026, v128): the confusion
  // budget must hold for ANY text — including text naming
  // codes this facility has never carried (a fresh facility
  // whose shifts have not imported yet, or a code the app
  // only knows under a longer name). Everything above can
  // only resolve names already in the reader's universe; a
  // statement whose subject matches NO known code used to
  // vanish without a trace — live, a CAMC text naming five
  // codes read back as a bare "Day shifts pay $250/hr."
  // because none of the five were in the universe on that
  // surface. An assignment-shaped subject ("NAME = …",
  // "NAME is …") that looks like a code (carries a digit or
  // an asterisk, or an all-caps word) and that nothing
  // resolved — no definition, no rate, no known-code match
  // in any spelling — is therefore named in unanswered
  // exactly as written, so the read-back asks about it
  // instead of dropping it. Descriptor phrases ("the 8-hour
  // shift rate is …") are descriptions, not code names, and
  // never trip the net.
  {
    const normS=s=>String(s||'').toLowerCase().replace(/[^a-z0-9*]+/g,' ').trim();
    const knownForms=new Set(),knownLast=new Set();
    for(const c of codeList){
      const tk=String(c&&c.code||'').toLowerCase().split(/[^a-z0-9*]+/).filter(x=>/[a-z0-9]/.test(x));
      if(!tk.length)continue;
      knownForms.add(tk.join(' '));
      for(let k=1;k<tk.length;k++)knownForms.add(tk.slice(k).join(' '));
      const last=tk[tk.length-1];knownLast.add(last);knownLast.add(last+'s');
      if(last.endsWith('s'))knownLast.add(last.slice(0,-1));
    }
    const answeredS=new Set([...Object.keys(defs),...unanswered].map(normS));
    const isKnownS=subj=>{
      const ns=normS(subj);if(!ns)return true;
      if(knownForms.has(ns)||answeredS.has(ns))return true;
      const tk=ns.split(' ');
      if(tk.length===1)return knownLast.has(tk[0]);
      for(let k=1;k<tk.length;k++)if(knownForms.has(tk.slice(k).join(' ')))return true;
      // A subject LIST of known spellings ("8s or 8",
      // "12s or 12s") is known when every name in it is.
      const parts=tk.filter(w=>w!=='and'&&w!=='or');
      if(parts.length&&parts.length<=tk.length&&parts.every(w=>knownLast.has(w)||knownForms.has(w)))return true;
      return false;
    };
    const callCoveredS=subj=>{
      const ns=normS(subj);
      if(/\bcall 1\b|1st call|first call/.test(ns))return rates.rate24!=null||rates.weekendRate24!=null||rates.hourlyCall1st!=null;
      if(/\bcall 2\b|2nd call|second call/.test(ns))return rates.rateSecond!=null||rates.weekendRateSecond!=null||rates.callBonus!=null;
      return false;
    };
    for(const clause of t.split(/[.;\n;]+|\s+\/\s+/)){
      if(unanswered.length>=12)break;
      const m=clause.match(/^\s*"?\(?\s*([A-Za-z0-9][A-Za-z0-9*()\- ]{0,26}?)\s*(?:=|:|\bis\b|\bare\b|\bmeans\b|\bpays?\b)/);
      if(!m)continue;
      const subj=m[1].replace(/\s+/g,' ').replace(/[\s()]+$/,'').trim();
      if(!subj||subj.split(' ').length>4)continue;
      if(!(/\d|\*/.test(subj)||/(?:^|\s)[A-Z]{2,}(?:\s|$)/.test(subj)))continue;
      if(/(?:^|\s)(?:shifts?|rates?|pay|hours?|days?|per)(?:\s|$)/i.test(subj))continue;
      if(isKnownS(subj)||callCoveredS(subj)||answeredS.has(normS(subj)))continue;
      answeredS.add(normS(subj));unanswered.push(subj);
    }
  }
  const question=unanswered.length?('One thing I couldn\'t tell from that: what '+(unanswered.length===1?'is':'are')+' '+unanswered.map(c=>'“'+c+'”').join(', ')+' — and how does it pay? Add a sentence about '+(unanswered.length===1?'it':'them')+' and make the rules again, or use these rules as-is.'):'';
  // weekendStated (Nov 11, 2026, v122): whether the TEXT ITSELF
  // stated a weekend definition. weekendDays is null when it did
  // not — the read-back and the save provenance key on this, so
  // an unstated weekend is never dressed up as the user's rule.
  return {rates,defs,weekendDays,weekendStated:!!(weekendDays&&weekendDays.length),unanswered,question};
}
// The follow-up question under a describe read-back (Nov 10,
// 2026, v113): the LOCAL question names the codes the text did
// not cover AND states how to answer ("Add a sentence about it
// and make the rules again, or use these rules as-is"). The AI
// rule read can add a clarifying question of its own — live, in
// the CAMC import gate, its "Does this rule apply on
// weekends?" REPLACED the local question wholesale, leaving a
// yes/no-shaped question in the yellow box with the answer
// path deleted (no Yes/No controls exist in this surface by
// design — answers are sentences in the same box). Compose,
// never replace: the local question always stands, and the
// AI's question is appended with the answer cue restored.
function describeFollowUpQuestion(localQ,aiQ){
  const lq=String(localQ||'').trim(),aq=String(aiQ||'').trim();
  if(!aq)return lq;
  if(!lq)return 'One thing I couldn\'t tell from that: '+aq+' Add a sentence about it in the box above and make the rules again, or use these rules as-is.';
  if(lq.includes(aq))return lq;
  return lq+' The rule reader also asked: '+aq+' You can answer that in the box above too.';
}
function describeSummaryText(facName,parsed,fac){
  const eff={};for(const k of ['hourlyRate','paidHours8','rate8','rate10','rate12','rate24','weekendRate24','hourlyCall1st','rateSecond','weekendRateSecond','callBonus']){const v=parsed.rates[k]!=null?parsed.rates[k]:(fac?rateOrNull(fac[k]):null);if(v!=null)eff[k]=v}
  const bits=[];
  const flatFor=ct=>/8-hour/.test(ct||'')?eff.rate8:/10-hour/.test(ct||'')?eff.rate10:/12-hour/.test(ct||'')?eff.rate12:null;
  for(const [code,d] of Object.entries(parsed.defs||{})){
    const ct=d.canonicalType||'';
    if(d.unpaid){
      bits.push('“'+code+'”: no pay — '+(d.label||'day off')+'.');
    }else if(ct==='Second call'){
      const parts=[];if(eff.rateSecond!=null)parts.push(moneyShort(eff.rateSecond)+' on weekdays');if(eff.weekendRateSecond!=null)parts.push(moneyShort(eff.weekendRateSecond)+' on weekends');if(!parts.length&&eff.callBonus!=null)parts.push('the day rate plus a '+moneyShort(eff.callBonus)+' overnight bonus');
      bits.push('“'+code+'” (2nd call): '+(parts.length?parts.join(', '):'priced from the rates below')+'.');
    }else if(ct==='24-hour call'){
      const parts=[];if(eff.rate24!=null)parts.push(moneyShort(eff.rate24)+' on weekdays');if(eff.weekendRate24!=null)parts.push(moneyShort(eff.weekendRate24)+' on weekends');
      if(!parts.length&&eff.hourlyCall1st!=null&&eff.hourlyRate!=null){const fcW=firstCallPay(eff.hourlyCall1st,eff.hourlyRate,false),fcE=firstCallPay(eff.hourlyCall1st,eff.hourlyRate,true);if(fcW&&fcE)parts.push(moneyShort(fcW.pay)+' on weekdays',moneyShort(fcE.pay)+' on weekends')}
      bits.push('“'+code+'” (1st call): '+(parts.length?parts.join(', '):'priced from the rates below')+'.');
    }else if(ct){
      const flat=flatFor(ct),hr=eff.hourlyRate,ph=rateOrNull(d.paidHours)!=null?rateOrNull(d.paidHours):(/8-hour/.test(ct)&&eff.paidHours8!=null?eff.paidHours8:rateOrNull(d.hours));
      if(flat!=null)bits.push('“'+code+'” ('+ct+'): '+moneyShort(flat)+' per shift.');
      else if(hr!=null&&ph!=null)bits.push('“'+code+'” ('+ct+'): '+moneyShort(hr)+'/hr × '+ph+' paid hours = '+moneyShort(hr*ph)+'.');
      else if(hr!=null)bits.push('“'+code+'” ('+ct+'): '+moneyShort(hr)+'/hr.');
      else if(d.weekdayPay!=null||d.weekendPay!=null){const parts=[];if(d.weekdayPay!=null)parts.push(moneyShort(d.weekdayPay)+' on weekdays');if(d.weekendPay!=null)parts.push(moneyShort(d.weekendPay)+' on weekends');bits.push('“'+code+'” ('+ct+'): '+parts.join(', ')+'.')}
      else bits.push('“'+code+'” ('+ct+').');
    }else if(d.weekdayPay!=null||d.weekendPay!=null){const parts=[];if(d.weekdayPay!=null)parts.push(moneyShort(d.weekdayPay)+' on weekdays');if(d.weekendPay!=null)parts.push(moneyShort(d.weekendPay)+' on weekends');bits.push('“'+code+'” ('+(d.label||'as described')+'): '+parts.join(', ')+'.')}
    else bits.push('“'+code+'”: '+(d.label||'as described')+'.');
  }
  const hasDefCt=ct=>Object.values(parsed.defs||{}).some(d=>d.canonicalType===ct);
  if(!hasDefCt('Second call')&&(parsed.rates.rateSecond!=null||parsed.rates.weekendRateSecond!=null||parsed.rates.callBonus!=null)){const parts=[];if(eff.rateSecond!=null)parts.push(moneyShort(eff.rateSecond)+' on weekdays');if(eff.weekendRateSecond!=null)parts.push(moneyShort(eff.weekendRateSecond)+' on weekends');if(!parts.length&&eff.callBonus!=null)parts.push('the day rate plus a '+moneyShort(eff.callBonus)+' overnight bonus');if(parts.length)bits.push('2nd call: '+parts.join(', ')+'.')}
  if(!hasDefCt('24-hour call')&&(parsed.rates.rate24!=null||parsed.rates.weekendRate24!=null)){const parts=[];if(eff.rate24!=null)parts.push(moneyShort(eff.rate24)+' on weekdays');if(eff.weekendRate24!=null)parts.push(moneyShort(eff.weekendRate24)+' on weekends');if(parts.length)bits.push('1st call: '+parts.join(', ')+'.')}
  if(!Object.keys(parsed.defs||{}).length&&eff.hourlyRate!=null)bits.push('Day shifts pay '+moneyShort(eff.hourlyRate)+'/hr'+(eff.paidHours8!=null?' and are paid for '+eff.paidHours8+' hours':'')+'.');
  // The weekend line obeys the same rule as every other line
  // (Nov 11, 2026, v122): stated = fact; unstated-but-material
  // = a labeled default the user can override with a sentence;
  // unstated-and-immaterial = silence. The old code appended
  // "Weekend means Saturday and Sunday." unconditionally, from
  // the pricer's built-in default — asserting, as the user's
  // own rule, a definition a CAMC user never wrote (his words:
  // "I didn't include weekend includes Saturday and Sunday for
  // CAMC"). A weekend the user stated EARLIER and saved still
  // reads as fact: it is his captured rule, not a default.
  const statedDays=(parsed.weekendDays&&parsed.weekendDays.length)?parsed.weekendDays:(facilityWeekendStated(fac)?facilityWeekendDays(fac):null);
  if(statedDays)bits.push('Weekend means '+weekendDayListLabel(statedDays)+'.');
  else if(describeWeekendMatters(parsed,fac))bits.push('You didn\'t say which days count as the weekend — I\'ll use '+weekendDayListLabel(facilityWeekendDays(fac||{weekendDays:null}))+' unless you tell me otherwise.');
  if(parsed.unanswered&&parsed.unanswered.length)bits.push('I still don\'t know about: '+parsed.unanswered.map(c=>'“'+c+'”').join(', ')+'.');
  return bits.join(' ');
}
function shortCallName(code,n){const m=String(code||'').match(new RegExp('call\\s*'+n,'i'));return m?'Call '+n:null}
// One saved definition as its own prefill sentence(s), in
// shapes the words reader round-trips (pinned in
// test-v129-describe-flow.js): a split-pay definition states
// its hours and both figures; a plain day definition states
// its hours and its OWN paid hours when it has them. Returns
// [] when the definition carries nothing this form can say.
function describePrefillDefSentences(code,def,ct){
  const out=[];
  const wd=rateOrNull(def.weekdayPay),we=rateOrNull(def.weekendPay),ph=rateOrNull(def.paidHours);
  const hm=String(ct||'').match(/(\d+(?:\.\d+)?)\s*-\s*hour/i);
  const h=rateOrNull(def.hours)!=null?rateOrNull(def.hours):(hm?Number(hm[1]):null);
  const hourBit=h!=null?(' is '+(h===8||h===11||h===18?'an':'a')+' '+h+'-hour shift'):'';
  if(wd!=null||we!=null){
    const head=code+hourBit,joiner=hourBit?' and pays ':' pays ';
    if(wd!=null&&we!=null)out.push(head+joiner+moneyShort(wd)+' on weekdays and '+moneyShort(we)+' on weekends.');
    else if(wd!=null)out.push(head+joiner+moneyShort(wd)+' per shift.');
    else out.push(head+joiner+moneyShort(we)+' on weekends.');
    if(ph!=null)out.push(code+' is paid for '+ph+' hours.');
    return out;
  }
  if(h!=null)out.push(code+hourBit+(ph!=null?', paid for '+ph+' hours':'')+'.');
  return out;
}
function describePrefillText(fac,codes){
  if(!fac)return '';
  const hr=rateOrNull(fac.hourlyRate);
  const defs=facilityCodeDefs(fac);
  const codeList=(codes&&codes.length)?codes:Object.keys(defs).map(code=>({code,ctype:(defs[code]||{}).canonicalType||canonicalTypeOf((defs[code]||{}).label||''),hours:(defs[code]||{}).hours}));
  const isDayCt=ct=>!!ct&&/hour/.test(ct)&&!/call/i.test(ct);
  const sentences=[];
  let anyDay=false,defStatesPaid8=false;
  for(const c of codeList){
    const def=codeDefFor(fac,c.code);
    const d=def||{};
    const ct=c.ctype||d.canonicalType||canonicalTypeOf(d.label||'');
    const nm2=shortCallName(c.code,2),nm1=shortCallName(c.code,1);
    if(isDayCt(ct))anyDay=true;
    let said=false;
    if(def&&def.unpaid){
      sentences.push(c.code+' is '+(def.label||'a day off')+' — no pay.');
      said=true;
    }
    if(!said&&ct==='Second call'&&nm2){
      const wd=rateOrNull(fac.rateSecond),we=rateOrNull(fac.weekendRateSecond),bonus=rateOrNull(fac.callBonus);
      if(wd!=null&&we!=null){sentences.push(nm2+' is '+moneyShort(wd)+' on weekdays and '+moneyShort(we)+' on weekends.');said=true}
      else if(wd!=null){sentences.push(nm2+' is '+moneyShort(wd)+' on weekdays.');said=true}
      else if(bonus!=null&&hr!=null){sentences.push(nm2+' pays the day rate plus a '+moneyShort(bonus)+' overnight bonus.');said=true}
    }
    if(!said&&ct==='24-hour call'&&nm1){
      const wd=rateOrNull(fac.rate24),we=rateOrNull(fac.weekendRate24),h1=rateOrNull(fac.hourlyCall1st);
      if(wd!=null&&we!=null){sentences.push(nm1+' is '+moneyShort(wd)+' on weekdays and '+moneyShort(we)+' on weekends.');said=true}
      else if(h1!=null&&hr!=null){sentences.push(nm1+' pays '+moneyShort(hr)+'/hr for the first 8 hours, then '+moneyShort(h1)+'/hr after that.');said=true}
      else if(wd!=null){sentences.push(nm1+' is '+moneyShort(wd)+'.');said=true}
    }
    // Every saved definition gets its own sentence (Nov 11,
    // 2026, v129). The old loop collapsed ALL day definitions
    // into one "Day shifts pay $X/hr." line at the first day
    // code: reopening the box on a facility whose code map held
    // five definitions (CAMC's 8/10/5*/5**/12) showed ONLY the
    // hourly rate — the user could not see or edit the code
    // meanings they had saved, even though pricing used them.
    if(!said&&def){
      const ss=describePrefillDefSentences(c.code,d,ct);
      if(ss.length){sentences.push(...ss);said=true;if(/8-hour/.test(ct)&&ss.some(s=>/paid for/.test(s)))defStatesPaid8=true}
    }
    if(!said&&def&&(d.label||ct)){
      sentences.push(c.code+' is '+(d.label||ct)+'.');
      said=true;
    }
  }
  const bits=[];
  // The day-rate line leads whenever day rules are in play (or
  // there are no codes at all): the hourly rate is part of the
  // user's rules and belongs in the box where they can edit
  // it. Its paid-hours rider survives only when no saved
  // definition states the 8-hour paid hours itself — per-code
  // sentences carry those now, and the rider's job was
  // carrying a facility-level figure nothing else stated.
  if(hr!=null&&(anyDay||!codeList.length)){
    const ph8=rateOrNull(fac.paidHours8);
    bits.push('Day shifts pay '+moneyShort(hr)+'/hr'+(ph8!=null&&!defStatesPaid8?' and I\'m paid for '+ph8+' hours':'')+'.');
  }
  bits.push(...sentences);
  // The prefill is the user's words box wearing their saved
  // rules — it must not write an unstated weekend into the box
  // as if summarizing what they said (Nov 11, 2026, v122). A
  // stated weekend is restated as theirs; a defaulted one is
  // labeled as a default (and the sentence invites the fix —
  // stating it in the box makes it stated); when nothing at
  // this facility prices weekends differently, the weekend
  // cannot move any price and the prefill says nothing.
  if(facilityWeekendMatters(fac)){
    if(facilityWeekendStated(fac))bits.push('Weekend is '+weekendDaysText(fac)+'.');
    else bits.push('You didn\'t say which days count as the weekend — '+weekendDaysText(fac)+' are being used unless you say otherwise.');
  }
  return bits.join(' ');
}
// Saving described rules: stated rates land on the facility card
// (the same fields a contract read fills), stated code meanings
// land in the codeMap as CONFIRMED definitions (rulesConfirmed —
// the user read them back in the summary and approved them), the
// weekend definition lands as facility data, and every derived pay
// the new rules cover reprices. Nothing unstated is touched.
function applyDescribedRules(fac,parsed){
  if(!fac||!parsed)return 0;
  for(const k of Object.keys(parsed.rates||{})){const n=rateOrNull(parsed.rates[k]);if(n!=null)fac[k]=String(n)}
  // Weekend provenance (Nov 11, 2026, v122): stated words save
  // the definition AS STATED; weekend-priced rules with no
  // stated definition save the working default marked as
  // defaulted, so no later surface presents it as the user's
  // own words. A previously stated definition is never
  // downgraded by a silent re-describe — silence touches
  // nothing unstated, per this function's standing rule.
  if(parsed.weekendDays&&parsed.weekendDays.length){fac.weekendDays=parsed.weekendDays.slice();fac.weekendDaysSource='stated'}
  else if(describeWeekendMatters(parsed,fac)&&!facilityWeekendStated(fac))fac.weekendDaysSource='default';
  fac.codeMap=facilityCodeDefs(fac);
  for(const [code,d] of Object.entries(parsed.defs||{})){
    const key=normalizeCodeKey(code)||code;
    const ex=fac.codeMap[key]||{};
    const merged={...ex,label:d.label||ex.label||code,hours:d.hours!=null&&String(d.hours)!==''?String(d.hours):(ex.hours||''),rulesConfirmed:true,viaWords:true};
    const ct=d.canonicalType||ex.canonicalType||'';if(ct)merged.canonicalType=ct;
    if(d.paidHours!=null&&rateOrNull(d.paidHours)!=null){merged.paidHours=String(rateOrNull(d.paidHours));if(d.paidHoursOwn)merged.paidHoursOwn=true;else delete merged.paidHoursOwn}
    // A words-created definition whose newest confirmed words
    // state NO paid hours for the code keeps none (Nov 10, 2026,
    // v111): the buggy parse stamped the 8-hour figure onto a
    // 10-hour code's definition, and merely overwriting stated
    // fields would leave that residue pricing $2,125 forever —
    // the words are this definition's editing surface, so what
    // they no longer say, they retract. Scoped to viaWords
    // definitions (the only ones a words parse can have poisoned);
    // field-captured definitions are untouched, and a code whose
    // own statement names paid hours always restates them above.
    // (v112: the parse no longer re-inherits the residue into
    // d.paidHours — see describeParseLocal — so this branch is
    // what the live re-confirm actually reaches; the own-
    // statement marker goes with the figure it marked.)
    else if(ex.viaWords){delete merged.paidHours;delete merged.paidHoursOwn}
    // A figure preserved from a definition that was NOT
    // words-created is field-captured — the code's own answer.
    // Mark it so, because the merge stamps viaWords on the
    // definition as a whole (its label/meaning were just
    // confirmed in words) and the residue heal keys on the
    // FIGURE's provenance, not the definition's (Nov 10, 2026,
    // v112 — without this, the repair pass inside this very
    // save retracted a preserved field figure).
    else if(!ex.viaWords&&rateOrNull(ex.paidHours)!=null)merged.paidHoursOwn=true;
    if(d.weekdayPay!=null&&rateOrNull(d.weekdayPay)!=null)merged.weekdayPay=String(rateOrNull(d.weekdayPay));
    if(d.weekendPay!=null&&rateOrNull(d.weekendPay)!=null)merged.weekendPay=String(rateOrNull(d.weekendPay));
    // The unpaid marker (Nov 10, 2026) persists like any other
    // stated rule — and clears the priced residue a buggy read
    // may have saved for the code earlier (a priced canonical
    // type, per-code amounts, paid hours), so nothing downstream
    // can resurrect pay from the saved definition. A later
    // confirmed parse that prices the code clears the marker:
    // the user's newest words govern.
    if(d.unpaid){merged.unpaid=true;merged.canonicalType='';delete merged.weekdayPay;delete merged.weekendPay;delete merged.paidHours}
    else{delete merged.unpaid}
    fac.codeMap[key]=merged;
    if(/8-hour/i.test(merged.canonicalType||merged.label||'')){const ph=rateOrNull(merged.paidHours);if(ph!=null)fac.paidHours8=String(ph)}
  }
  fac.ratesPromptSkipped=false;fac.updatedAt=new Date().toISOString();
  return repriceUnpricedShiftsForFacility(fac);
}
async function submitDescribe(key){
  const st=describeState(key);if(!st||st.busy)return;
  const ctx=st.ctx||{};
  const text=String(st.text||'').trim();
  if(!text){st.error='Type the pay rules first — nothing was sent.';render();return}
  st.busy=true;st.error='';render();
  try{
    const parsed=describeParseLocal(text,ctx.fac||null,ctx.codes||[]);
    // The AI rule read (the Nov 6 box's engine) merges over the
    // deterministic parse when the user is signed in: fields the AI
    // states win; fields it does not state keep the local read.
    if(typeof SUPABASE_CONFIGURED!=='undefined'&&SUPABASE_CONFIGURED&&typeof cloudSession!=='undefined'&&cloudSession){
      try{
        const data=await liveSyncPost('extract-contract',{action:'extract-contract',mode:'rule',ruleText:text,ruleHistory:[]});
        if(data&&data.rule){
          const aiRates=ruleToFacilityRates(data.rule);
          const merged={...parsed.rates};for(const k of Object.keys(aiRates)){const n=rateOrNull(aiRates[k]);if(n!=null)merged[k]=n}
          // Prefer the reading that accounts for MORE of what
          // the user actually stated (Nov 10, 2026): if merging
          // the AI read over the local parse would lose a stated
          // amount the local parse captured, the local values
          // stand and the AI only fills gaps.
          const statedAmts=[...new Set([...text.matchAll(/\$([\d,]+(?:\.\d{1,2})?)/g)].map(x=>Number(x[1].replace(/,/g,''))))];
          const coverOf=r=>{const vals=new Set(Object.values(r).map(v=>rateOrNull(v)).filter(v=>v!=null));return statedAmts.filter(a=>vals.has(a)).length};
          if(coverOf(merged)>=coverOf(parsed.rates))parsed.rates=merged;
          else for(const k of Object.keys(merged))if(parsed.rates[k]==null)parsed.rates[k]=merged[k];
          // The coverage check above only counts stated $ amounts
          // — it cannot see a NON-amount the AI files as money
          // (live, Nov 10, 2026: the rule read returned the "8.5"
          // of "paid for 8.5 hours" as an 8-hour flat rate, the
          // merge adopted it, and the read-back priced 8-hour
          // shifts at $8.50). The same misread screen the local
          // parse runs therefore runs on the merged rates too.
          describeSanitizeRates(parsed.rates,text,null,ctx.codes||[]);
          // Code-level UNION of the two readings (Nov 10,
          // 2026, v114): the rates merge above can only add or
          // refine facility rates — definitions are recomputed
          // once with the merged rates standing behind the
          // parse, and the two definition sets are unioned with
          // the LOCAL reading winning per code. A code the
          // local parse resolved can therefore never be lost
          // to the merge, and a code only the merged (AI-
          // supplied) rates can price resolves too, instead of
          // staying "still don't know" over rates the app is
          // about to save anyway. A code resolved by NEITHER
          // reading stays unanswered — named, asked about,
          // never silently dropped.
          {
            const localDefs=parsed.defs,localUnanswered=parsed.unanswered.slice();
            const overlay=ctx.fac?{...ctx.fac}:{codeMap:{}};
            for(const k of Object.keys(parsed.rates))overlay[k]=String(parsed.rates[k]);
            const re=describeParseLocal(text,overlay,ctx.codes||[]);
            const unionDefs={...re.defs};
            for(const k of Object.keys(localDefs))unionDefs[k]=localDefs[k];
            parsed.defs=unionDefs;
            // Union semantics for the unanswered list too
            // (Nov 11, 2026, v128): a name is asked about iff
            // EITHER reading left it unresolved and NEITHER
            // resolved it. The old recompute iterated only the
            // caller's code list, so a name the facility's own
            // universe contributed — or a name neither reading
            // could attach to a known code at all (the
            // unknown-subject net) — was filtered out of the
            // question and dropped silently by the merge.
            parsed.unanswered=[...new Set([...localUnanswered,...re.unanswered])].filter(code=>!(code in unionDefs));
            parsed.question=parsed.unanswered.length?('One thing I couldn\'t tell from that: what '+(parsed.unanswered.length===1?'is':'are')+' '+parsed.unanswered.map(c=>'“'+c+'”').join(', ')+' — and how does it pay? Add a sentence about '+(parsed.unanswered.length===1?'it':'them')+' and make the rules again, or use these rules as-is.'):'';
          }
          if(data.rule.clarifying_question&&parsed.unanswered.length)parsed.question=describeFollowUpQuestion(parsed.question,data.rule.clarifying_question);
        }
      }catch(aiErr){/* the deterministic parse stands on its own */}
    }
    if(!Object.keys(parsed.rates).length&&!Object.keys(parsed.defs).length&&!parsed.weekendDays&&!(parsed.unanswered&&parsed.unanswered.length)){
      st.error='I couldn\'t pull any rates from that — try plainer sentences, e.g. “Day shifts pay $200/hr and I\'m paid for 8 hours. Call 2 is $2,400 on weekdays, $1,800 on weekends.” Nothing was saved.';
      st.parsed=null;
    }else{st.parsed=parsed;st.confirmed=false;st.collapsed=false}
  }finally{st.busy=false;render()}
}
// Stage a facility-preview words parse onto its preview entry
// (Nov 11, 2026, v123): the parsed rates join f.rates (the same
// staging Save reads) and the full parse is kept for the code
// definitions + weekend rule, which land on the saved facility
// at approve. Used by the box's confirm AND by Save itself, so
// a parse the user made but never confirmed can never be
// discarded by saving (the v110 lesson, now structural).
function stageFacPreviewDescribe(i){
  if(!facilityContractPreview)return false;
  const f=facilityContractPreview.facilities[i];if(!f)return false;
  const st=f.describe;if(!st||!st.parsed)return false;
  f.rates=f.rates||{};
  for(const k of FACILITY_RATE_KEYS){const n=rateOrNull(st.parsed.rates&&st.parsed.rates[k]);if(n!=null)f.rates[k]=String(n)}
  f.describedParsed=st.parsed;
  st.confirmed=true;
  return true;
}
function confirmDescribe(key){
  const st=describeState(key);if(!st||!st.parsed)return;
  if(key.indexOf('imp:facprev:')===0){
    // The facility contract preview (v123): confirming stages
    // the rules into the preview entry; the preview's own
    // "Save facilities" button is the save. Confirming also
    // collapses the box to its "Rules set" line (v129).
    stageFacPreviewDescribe(+key.split(':')[2]);
    st.collapsed=true;
    render();return;
  }
  if(key.indexOf('imp:')===0){
    st.confirmed=true;
    // On the import surfaces the box's button and the preview's
    // approve used to be one gesture (the field draft applied AT
    // approve). Two clicks to save one import would read as a
    // step backwards, so confirming the read-back completes that
    // surface's approve in the same tap.
    if(key==='imp:schedule'&&schedulePreview){render();approveScheduleImport();return}
    if(key==='imp:cal'&&calPreview){render();approveCalendarImport();return}
    render();return;
  }
  const ctx=st.ctx||{};
  const fac=ctx.fac||(db.facilities||[]).find(x=>key==='dash:'+x.id||key==='fac:'+x.id);
  if(!fac){st.error='That facility is no longer there — nothing was saved.';render();return}
  applyDescribedRules(fac,st.parsed);
  try{if(typeof cloudSaveKind==='function')cloudSaveKind('facilities',fac.id)}catch(_){}
  describeStates[key]={text:null,parsed:null,error:'',busy:false,confirmed:false};
  // A successful save on a facility CARD closes the pay-rules
  // section back to the card's resting state by itself (Nov 11,
  // 2026, v129 — Caleb: "Once it has read the rule and its save
  // this section should close"). The saved confirmation stays
  // visible as a flash line in the resting card until the
  // section is reopened. The Dashboard quick-check surface
  // needs no close: confirming there resolves the prompt and
  // it removes itself.
  if(key==='fac:'+fac.id){describeOpenFac=null;describeSavedFlashFac=fac.id}
  persist();render();
  // A facility born from a suggestion card's words path: confirming
  // the words IS its save — re-check the calendar by itself so the
  // hospital's held shifts import priced, with the plain result on
  // the Facilities tab (Nov 11, 2026, v121).
  const bornProvider=suggestionBornProviders[fac.id];
  if(bornProvider){delete suggestionBornProviders[fac.id];if(typeof window!=='undefined'&&typeof window.liveSyncRescanAfterFacilitySave==='function')window.liveSyncRescanAfterFacilitySave(bornProvider,fac.name);}
}
function describeRulesHTML(key,opts){
  const o=opts||{};
  const st=describeState(key);
  st.ctx={fac:o.fac||null,facName:o.facName||(o.fac?o.fac.name:''),codes:o.codes||[]};
  if(st.text==null)st.text=o.prefill!=null?o.prefill:describePrefillText(o.fac||null,o.codes||[]);
  const fieldId='describe_'+key.replace(/[^A-Za-z0-9]/g,'_');
  const p=st.parsed;
  // The facility contract preview's box (v123) confirms INTO the
  // preview — the preview's own Save is what saves — so its
  // button and footnote say exactly that, not the shift-import
  // surfaces' "approve import in one go".
  const isFacPrev=key.indexOf('imp:facprev:')===0;
  // A confirmed facility-preview box collapses to a one-line
  // "Rules set" summary (Nov 11, 2026, v129 — the same
  // close-on-save Caleb asked for on the facility card): the
  // full box has done its job once the rules are staged, and
  // "Edit rules" reopens it with the text intact.
  if(isFacPrev&&st.confirmed&&st.collapsed&&p){
    return `<div class="item" style="display:block"><p><strong>${escapeHTML(o.heading||'Pay rules — in your words')}</strong></p><p class="muted"><strong>Rules set.</strong> ${escapeHTML(describeSummaryText(st.ctx.facName,p,o.fac||null))}</p><div class="toolbar"><button type="button" class="secondary" data-action="describe-edit" data-id="${escapeHTML(key)}">Edit rules</button></div></div>`;
  }
  const confirmLabel=isFacPrev?'Use these rules':(key.indexOf('imp:')===0?'Use these rules & approve import':'Use these rules — save & reprice');
  const confirmNote=isFacPrev?'These rules join the preview — “Save facilities” below saves them with the facility.':(key.indexOf('imp:')===0?'Approving saves these rules and imports the shifts above in one go.':'Saving updates the rate card and reprices the shifts these rules cover.');
  return `<div class="item" style="display:block"><p><strong>${escapeHTML(o.heading||'Describe the pay rules in your own words')}</strong></p><p class="muted">One box — no forms. Write how ${escapeHTML(st.ctx.facName||'this facility')} pays in plain sentences, and we\'ll turn it into the rate card. We only use what you write.${(o.codes&&o.codes.length)?' On this schedule: '+o.codes.map(c=>'“'+escapeHTML(c.code)+'”').join(' · ')+'.':''}</p><div class="form-grid"><div class="field"><label for="${fieldId}">Pay rules at ${escapeHTML(st.ctx.facName||'this facility')}</label><textarea id="${fieldId}" class="describeText" data-key="${escapeHTML(key)}" rows="4">${escapeHTML(st.text||'')}</textarea></div></div>${st.error?`<p class="hint">${escapeHTML(st.error)}</p>`:''}${st.busy?'<p class="hint">Reading your rules…</p>':''}<div class="toolbar"><button type="button" data-action="describe-parse" data-id="${escapeHTML(key)}">Make my rules</button></div>${p?`<div style="margin-top:10px"><p><strong>Here\'s what I\'ll use:</strong> ${escapeHTML(describeSummaryText(st.ctx.facName,p,o.fac||null))}</p>${p.question?`<p class="hint">${escapeHTML(p.question)}</p>`:''}<div class="toolbar"><button type="button" data-action="describe-confirm" data-id="${escapeHTML(key)}">${confirmLabel}</button></div><p class="muted">${confirmNote}</p></div>`:''}</div>`;
}
// A facility whose priced shifts rest on rules the user never
// confirmed in the read-back sense: a day code defined by the old
// field flow (its paid-hours answer was a copied default, never a
// confirmed statement), or a call code whose weekday/weekend split
// was never stated. Money is at stake — the facility has priced
// shifts — so the Dashboard asks ONCE, in words, with the current
// beliefs prefilled for correction. Confirming through the words
// box marks the definitions confirmed and the prompt never returns
// (dismissing it records the same signature).
function rulesHealSignature(fac){return JSON.stringify(facilityCodeDefs(fac))+'|'+JSON.stringify(fac.weekendDays||null)+'|'+String(fac.paidHours8||'')+'|'+String(fac.hourlyRate||'')}
function facilityRulesUnverified(fac){
  if(!fac)return null;
  const defs=facilityCodeDefs(fac);
  const codes=Object.keys(defs);
  if(!codes.length)return null;
  const hasPriced=(db.shifts||[]).some(x=>{if(!isPricedShift(x))return false;let m=null;try{m=facilityForRecord(x)}catch(e){}return !!m&&m.id===fac.id});
  if(!hasPriced)return null;
  const open=[];
  for(const code of codes){
    const def=defs[code];if(!def||def.rulesConfirmed)continue;
    const ct=String(def.canonicalType||'').trim()||canonicalTypeOf(def.label||'');
    if(ct&&/hour/i.test(ct)&&!/call/i.test(ct)){
      const flatKey=/8-hour/i.test(ct)?'rate8':/10-hour/i.test(ct)?'rate10':/12-hour/i.test(ct)?'rate12':'';
      if(flatKey&&rateOrNull(fac[flatKey])==null&&rateOrNull(fac.hourlyRate)!=null)open.push({code,ctype:ct,hours:def.hours||''});
    }else if(ct==='Second call'&&typeof callSplitMissing==='function'&&callSplitMissing(fac,ct))open.push({code,ctype:ct,hours:def.hours||''});
    else if(ct==='24-hour call'&&typeof callSplitMissing==='function'&&callSplitMissing(fac,ct))open.push({code,ctype:ct,hours:def.hours||''});
  }
  if(!open.length)return null;
  const dis=(db.settings&&db.settings.rulesHealDismissed&&typeof db.settings.rulesHealDismissed==='object')?db.settings.rulesHealDismissed:{};
  if(dis[fac.id]===rulesHealSignature(fac))return null;
  return {fac,codes:open};
}
function dashboardRulesHealHTML(){
  for(const fac of (db.facilities||[])){
    const un=facilityRulesUnverified(fac);if(!un)continue;
    return `<section class="panel"><h2>Quick check — pay rules at ${escapeHTML(fac.name)}</h2><p class="muted">Some ${escapeHTML(fac.name)} shifts are priced from rules that were never confirmed — if one number below is off, every total using it is off too. Correct it in your own words and we\'ll reprice.</p>${describeRulesHTML('dash:'+fac.id,{facName:fac.name,codes:un.codes,fac})}<div class="toolbar"><button type="button" class="secondary" data-action="describe-dismiss" data-id="${escapeHTML(fac.id)}">These rules are right — don\'t ask again</button></div></section>`;
  }
  return '';
}
function facilityDescribeCodes(fac){
  const defs=facilityCodeDefs(fac||{});
  const out=Object.keys(defs).map(code=>({code,ctype:String(defs[code].canonicalType||'').trim()||canonicalTypeOf(defs[code].label||''),hours:defs[code].hours||''}));
  // The code universe is the saved definitions UNION the codes
  // the facility's saved shifts actually carry (Nov 10, 2026,
  // v114): a code can sit on the calendar with NO definition —
  // that is exactly what an unresolved code looks like (the
  // import gate could not price it, so nothing was ever saved
  // for it). Listing only definition keys made such a code
  // invisible to the words parse on this card: it got no block,
  // no definition, and — unanswered being built from the same
  // list — not even a "still don't know" line. Live, CAMC's
  // "5*" (Dec 2/4 shifts, no def) vanished from the read-back
  // while "5**" and "7" resolved. Shift codes join the list
  // verbatim (asterisks and all), deduped against the defined
  // keys by the same tolerant key the def lookup uses.
  if(fac&&fac.id){
    // One identity (Nov 11, 2026, v131): dedupe on the strip key,
    // so a def saved as "HOLZ - PCDO" and a shift coded "Holzer
    // PCDO" are ONE universe entry, not two.
    const seen=new Set(out.map(c=>codeStripKey(c.code,fac)));
    let shifts=[];try{shifts=db.shifts||[]}catch(e){}
    for(const x of shifts){
      const code=String((x&&x.code)||'').trim();if(!code)continue;
      const k=codeStripKey(code,fac);if(!k||seen.has(k))continue;
      let owner=null;try{owner=facilityForRecord(x)}catch(e){}
      if(!owner||owner.id!==fac.id)continue;
      seen.add(k);
      const xt=String(x.type||'').trim();
      out.push({code,ctype:xt&&xt!==code?canonicalTypeOf(xt):'',hours:'',shiftOnly:true});
    }
  }
  return out;
}
function applyImportDescribed(preview,target){
  // The import approve path's rate save. Nov 9, 2026: only a
  // confirmed words-box parse applied, so a default could never slip
  // in as an "answer". Nov 10, 2026 (Caleb's live bug — "it didn't
  // calculate any pay after I uploaded my rules"): that gate made
  // the preview's own "Approve selected" button silently DISCARD
  // the typed rules — the read-back was on screen, the shifts saved
  // with no rate card behind them, and the paycheck that claimed
  // them honestly reported "incomplete" with no hint why. A parse
  // is not a default: every amount in it traces to a number the
  // user typed, and the read-back is the confirmation surface — so
  // a present parse now applies on EVERY approve path. Two things
  // still save no rules, exactly as before: no parse at all (nothing
  // typed, or the text was edited after parsing, which clears the
  // parse), and an explicit "Skip for now" on this prompt.
  if(!target)return{fac:null,saved:false};
  const st=preview&&preview.describe;
  if(!st||!st.parsed||preview.ratesSkipped)return{fac:target.fac||null,saved:false};
  let fac=target.fac;
  if(!fac){fac={id:id(),name:target.name,aliases:'',address:'',distance:'',notes:'',rate8:'',rate10:'',rate12:'',rate24:'',rateSecond:'',hourlyRate:'',paidHours8:'',callBonus:'',hourlyCall1st:'',weekendRate24:'',weekendRateSecond:'',codeMap:{},ratesPromptSkipped:false};db.facilities=db.facilities||[];db.facilities.push(fac)}
  applyDescribedRules(fac,st.parsed);
  return{fac,saved:true};
}
function importRatesPromptHTML(preview,kind){
  const t=importRatesTarget(preview);if(!t)return '';
  const key=kind==='cal'?'imp:cal':'imp:schedule';
  const reask=t.fac&&t.codes.every(c=>codeDefFor(t.fac,c.code));
  const heading=reask?`Quick check — pay at ${escapeHTML(t.name)}`:`First time at ${escapeHTML(t.name)}? Tell us how it pays`;
  return describeRulesHTML(key,{facName:t.name,codes:t.codes,fac:t.fac,heading})+`<div class="toolbar" style="margin-top:8px"><button type="button" class="secondary" data-action="import-rates-skip" data-id="${kind}">Skip for now</button></div>`;
}
function applyImportClarifyDraft(preview,target){
  // Applies the preview's clarification draft to the target facility:
  // creates it when new (with the hourly rate and code definitions);
  // merges onto a saved facility otherwise. Only codes the user
  // actually clarified get a saved definition — an untouched code
  // keeps asking next time. Returns {fac, saved} — saved=false when
  // no hourly rate was entered (nothing can price without one).
  if(!target)return{fac:null,saved:false};
  const d=clarifyDraftOf(preview);
  // The hourly rate may already live on the facility (a re-ask only
  // about a call split leaves the field blank) — fall back to it. A
  // brand-new facility still needs one entered: nothing can price
  // without it, which is the saved=false case below.
  const hourly=rateOrNull(d.hourlyRate)!=null?rateOrNull(d.hourlyRate):(target.fac?rateOrNull(target.fac.hourlyRate):null);
  if(hourly==null&&!target.fac)return{fac:null,saved:false};
  let fac=target.fac;
  if(!fac){fac={id:id(),name:target.name,aliases:'',address:'',distance:'',notes:'',rate8:'',rate10:'',rate12:'',rate24:'',rateSecond:'',hourlyRate:'',paidHours8:'',callBonus:'',hourlyCall1st:'',weekendRate24:'',weekendRateSecond:'',codeMap:{},ratesPromptSkipped:false};db.facilities=db.facilities||[];db.facilities.push(fac)}
  if(hourly!=null)fac.hourlyRate=String(hourly);
  fac.codeMap=facilityCodeDefs(fac);
  for(const c of target.codes){
    const e=clarifyEntryFor(preview,c.code,c.hours);
    const dc=(d.codes||{})[c.code]||{};
    const wd=rateOrNull(dc.weekdayPay),we=rateOrNull(dc.weekendPay);
    const dph=rateOrNull(dc.paidHours);
    const existing=codeDefFor(fac,c.code);
    if(!e.answered&&!existing&&wd==null&&we==null&&dph==null)continue;
    // Untouched fields keep the saved definition's answers — a
    // re-ask about only the weekend split must not blank the label
    // or hours the user gave last time.
    const touchedLabel=String(dc.label!=null?dc.label:'').trim()!=='';
    const touchedHours=dc.hours!=null&&String(dc.hours).trim()!=='';
    const label=touchedLabel?(e.label||c.code):((existing&&String(existing.label||'').trim())||e.label||c.code);
    const hours=touchedHours?(rateOrNull(e.hours)!=null?rateOrNull(e.hours):payUnitHoursFor(label,fac)):((existing&&rateOrNull(existing.hours)!=null)?rateOrNull(existing.hours):(rateOrNull(e.hours)!=null?rateOrNull(e.hours):payUnitHoursFor(label,fac)));
    const canonical=c.ctype||canonicalTypeOf(label);
    const key=normalizeCodeKey(c.code)||c.code;
    // Paid hours (Nov 9, 2026, December round): the hours one of
    // these shifts PAYS, answered separately from the shift's own
    // hours and remembered per code. An untouched re-ask keeps the
    // saved answer; a first clarification of a DAY code records
    // the default the prompt showed (the shift's hours) as the
    // answer — approving the prompt confirms what was on screen,
    // so the question never nags. Call codes never carry it.
    const paidHours=dph!=null?dph:(existing&&rateOrNull(existing.paidHours)!=null?rateOrNull(existing.paidHours):(canonical&&!/call/i.test(canonical)?hours:null));
    // Provenance (Nov 10, 2026, v112): a per-code paid-hours
    // figure the user TYPED into this clarification field is
    // field-captured — marked, so words/heal passes that
    // retract the words parse's residue can tell it apart from
    // a stamped figure. A figure carried over untouched keeps
    // whatever provenance it already had.
    fac.codeMap[key]={label,hours:hours!=null?String(hours):'',...(canonical?{canonicalType:canonical}:{}),...(paidHours!=null?{paidHours:String(paidHours)}:{}),...(dph!=null?{paidHoursFrom:'field'}:(existing&&existing.paidHoursFrom==='field'&&paidHours!=null?{paidHoursFrom:'field'}:{})),...(existing&&existing.paidHoursOwn&&paidHours!=null&&dph==null?{paidHoursOwn:true}:{})};
    if(key!==c.code&&fac.codeMap[c.code])delete fac.codeMap[c.code];
    // The facility-level paid-hours for 8-hour days follows the
    // PAID hours answer when there is one (it used to migrate the
    // shift's own hours, which is exactly how an 8-hour shift
    // paying 8.5 got stuck pricing at 8).
    if(/8-hour/i.test(label)){const ph8=paidHours!=null?paidHours:hours;if(ph8!=null)fac.paidHours8=String(ph8)}
    // The weekday/weekend answers land in the facility's own split
    // rate fields — the same fields a contract read fills — so the
    // ordinary pricer applies them by day of week from here on.
    if(canonical==='Second call'){if(wd!=null)fac.rateSecond=String(wd);if(we!=null)fac.weekendRateSecond=String(we)}
    else if(canonical==='24-hour call'){if(wd!=null)fac.rate24=String(wd);if(we!=null)fac.weekendRate24=String(we)}
  }
  fac.ratesPromptSkipped=false;fac.updatedAt=new Date().toISOString();
  return{fac,saved:true};
}
function clarifiedRowPricing(fac,row){
  // Prices a row from the facility's saved code definition for the
  // row's code, and the shift takes the clarified label as its type.
  // When the definition names a canonical type the facility's own
  // pay rule prices (an 8-hour day, a Second call, ...), the
  // facility pricer decides — it is the only path that can apply a
  // weekday/weekend split by the row's own date, and it keeps the
  // facility's flat rates and paid-hours rules in charge. Hourly x
  // the definition's hours remains the price for codes whose label
  // names no canonical type ("Night float"). Returns null when the
  // code has no definition; {type} alone when a definition exists
  // but cannot price (no hourly rate / no hours known).
  if(!fac)return null;
  const key=rowCodeKey(row);if(!key)return null;
  const def=codeDefFor(fac,key);if(!def)return null;
  const label=String(def.label||'').trim()||key;
  // An unpaid definition is FINAL (Nov 10, 2026): the user stated
  // in their own words that this code pays nothing ("post call
  // day off — no pay"). It prices exactly $0 as a COMPLETE price,
  // stamped payUnit 'unpaid' so no heal or live-pricing pass can
  // mistake the $0 for a missing stamp and reprice it from the
  // card (the trap the v106 $0.00 fix would otherwise spring).
  // Stated per-code amounts, canonical types and facility
  // formulas never see an unpaid code.
  if(def.unpaid)return{type:label,pay:'0',payRate:'',payUnit:'unpaid'};
  const canonical=String(def.canonicalType||'').trim()||canonicalTypeOf(label);
  // Per-code stated amounts (Nov 10, 2026): pay the user tied to
  // THIS code in their own words, saved on the definition. A
  // contract flat rate on the facility outranks them
  // (source-priority ladder); otherwise they beat the generic
  // facility formula, which knows nothing about this code.
  const dwd=rateOrNull(def.weekdayPay),dwe=rateOrNull(def.weekendPay);
  if(dwd!=null||dwe!=null){
    const flatKey=/8-hour/i.test(canonical)?'rate8':/10-hour/i.test(canonical)?'rate10':/12-hour/i.test(canonical)?'rate12':'';
    if(!(flatKey&&rateOrNull(fac[flatKey])!=null)){
      const weD=row&&row.date?isFacilityWeekend(fac,row.date):false;
      const v=weD?(dwe!=null?dwe:dwd):(dwd!=null?dwd:dwe);
      if(v!=null)return{type:label,pay:String(Math.round(v*100)/100),payRate:'',payUnit:'facility'};
    }
  }
  if(canonical){const p=facilityPayFor(fac,canonical,row&&row.date);if(p>0){
    // Per-code paid hours (Nov 9, 2026, December round): for a DAY
    // type with no flat rate, the facility price is hourly x some
    // hour count. When that count is just the generic fallback
    // (the shift's own hours — the facility applied no paid-hours
    // knowledge of its own) and the code's definition carries a
    // paidHours answer, the answer prices: hourly x paid hours.
    // A flat rate, or a facility paid-hours figure that already
    // differs from the shift hours (a contract's), always wins —
    // rates outrank clarified answers (source-priority ladder).
    const dph=rateOrNull(def.paidHours),hr=rateOrNull(fac.hourlyRate);
    const flatKey=/8-hour/i.test(canonical)?'rate8':/10-hour/i.test(canonical)?'rate10':/12-hour/i.test(canonical)?'rate12':'';
    if(flatKey&&dph!=null&&hr!=null&&rateOrNull(fac[flatKey])==null){
      const shiftHrs=rateOrNull(def.hours)!=null?rateOrNull(def.hours):payUnitHoursFor(canonical,fac);
      if(shiftHrs!=null&&Math.abs(p-hr*shiftHrs)<0.005&&Math.abs(dph-shiftHrs)>0.001)return{type:label,pay:String(Math.round(hr*dph*100)/100),payRate:String(hr),payUnit:'hourly'};
    }
    return{type:label,pay:String(Math.round(p*100)/100),payRate:'',payUnit:'facility'}}}
  const hourly=rateOrNull(fac.hourlyRate);
  const hours=rateOrNull(def.hours)!=null?rateOrNull(def.hours):payUnitHoursFor(label,fac);
  if(hourly==null||hours==null)return{type:label};
  return{type:label,pay:String(Math.round(hourly*hours*100)/100),payRate:String(hourly),payUnit:'hourly'};
}
// --- Import previews: optional pay-schedule setup (Nov 8, 2026) ---
// Caleb: "give the user an opportunity to put in the pay schedule
// when a schedule, QGenda or contract is uploaded so it automatically
// puts the pay checks into the calendar." When the agency/facility an
// import belongs to has NO pay schedule on file, the preview offers
// one optional section with the EXISTING pay-schedule fields (the
// db.payStubs record the pay-stub flow saves: agency, facility, pay
// frequency, a known pay date, and the optional period start/end that
// anchor the lag). Saving stores that same record — so the existing
// paycheck engine generates the estimated paychecks on the calendar,
// in Upcoming paychecks, and in the month headline exactly as it does
// for stub-derived schedules. Fully optional: Skip (or leaving the
// frequency / pay date blank) imports exactly as before, and a skip
// is remembered per agency in settings (paySchedPromptDismissed) so
// later imports for that agency don't nag — a schedule can still be
// added any time from the pay-stub panel on the Facilities tab.
function importPaySchedDismissed(){const s=(db.settings&&db.settings.paySchedPromptDismissed);return (s&&typeof s==='object'&&!Array.isArray(s))?s:{}}
function paySchedAgencyKey(a){return String(a||'').trim().toLowerCase()}
function importPaySchedCtx(preview,kind){
  if(!preview)return null;
  if(kind==='contract'){const c=preview.contract||{};const rows=(preview.rows||[]).filter(r=>r.include);const names=[...new Set(rows.map(r=>String(r.facility||'').trim()).filter(Boolean))];const agency=String(c.facility||'').trim()||(names.length===1?names[0]:'');return agency?{agency,facility:String(c.facility||'').trim()||agency}:null}
  if(kind==='faccontract'){const e=(preview.facilities||[]).find(f=>f.include&&String(f.name||'').trim());if(!e)return null;const n=String(e.name).trim();return {agency:n,facility:n}}
  const rows=(preview.rows||[]).filter(r=>r.match!=='other');
  let name=String(preview.facilityAll||'').trim();
  if(!name){const names=[...new Set(rows.map(r=>String(r.facility||'').trim()).filter(Boolean))];if(names.length===1)name=names[0]}
  return name?{agency:name,facility:name}:null;
}
function importPaySchedTarget(preview,kind){
  if(!preview||preview.paySchedSkipped)return null;
  // A stub approved from this section already saved the schedule —
  // the manual fields never double-save on top of it.
  if(preview.paySchedStubSaved)return null;
  const ctx=importPaySchedCtx(preview,kind);if(!ctx)return null;
  if(paySchedCoveredCtx(ctx))return null;
  if(importPaySchedDismissed()[paySchedAgencyKey(ctx.agency)])return null;
  preview._paySchedAgency=ctx.agency;
  return ctx;
}
// ONE pay-schedule fields block (Nov 10, 2026 — Caleb's rule: a
// repeated function is one component, identical everywhere). The
// import pay-schedule section and the facility card's pay-schedule
// offer render THIS grid — same six fields, same labels, same
// order, same helper copy — differing only in the data they bind
// to (an import preview's draft vs a facility card's draft). The
// surfaces keep their own heading and commit row, because those
// genuinely differ: an import saves its schedule when the import
// is approved (its only action is Skip), the card saves on its own
// button. The intro sentence is shared too.
const PAYSCHED_PERIOD_HINT='The period dates anchor how long after a period ends the check lands — leave them blank and the schedule still works from the pay date and frequency alone.';
function paySchedIntroHTML(name){return `<p class="muted">Tell us how ${escapeHTML(name)} pays you and we'll put the paychecks on your calendar automatically — each one calculated from your shifts in its pay period.</p>`}
function paySchedFieldsGridHTML(o){
  const d=o.draft||{};
  const val=(k,fb)=>escapeHTML(d[k]!=null&&String(d[k])!==''?d[k]:(fb||''));
  const F=(field,label,inner)=>`<div class="field"><label for="${o.prefix}_${field}">${label}</label>${inner}</div>`;
  const attrs=(field)=>`class="${o.cls}" ${o.dataFor(field)}`;
  return `<div class="form-grid">${F('agency','Agency / employer',`<input id="${o.prefix}_agency" ${attrs('agency')} type="text" value="${val('agency',o.agency)}">`)}${F('facility','Facility (if it applies)',`<input id="${o.prefix}_facility" ${attrs('facility')} type="text" value="${val('facility',o.facility)}">`)}${F('frequency','Pay frequency',`<select id="${o.prefix}_frequency" ${attrs('frequency')}><option value="">— choose —</option>${PAY_FREQUENCIES.map(fr=>`<option value="${fr}" ${d.frequency===fr?'selected':''}>${PAY_FREQUENCY_LABELS[fr]}</option>`).join('')}</select>`)}${F('payDate','A pay date you know (one real payday)',`<input id="${o.prefix}_payDate" ${attrs('payDate')} type="date" value="${val('payDate','')}">`)}${F('periodStart','Pay period start (for that payday, if you know it)',`<input id="${o.prefix}_periodStart" ${attrs('periodStart')} type="date" value="${val('periodStart','')}">`)}${F('periodEnd','Pay period end (for that payday, if you know it)',`<input id="${o.prefix}_periodEnd" ${attrs('periodEnd')} type="date" value="${val('periodEnd','')}">`)}${o.stubAmounts?`${F('gross','Gross on this stub ($)',`<input id="${o.prefix}_gross" ${attrs('gross')} type="number" min="0" step="0.01" value="${val('gross','')}" placeholder="Not stated">`)}${F('net','Net on this stub ($)',`<input id="${o.prefix}_net" ${attrs('net')} type="number" min="0" step="0.01" value="${val('net','')}" placeholder="Not stated">`)}`:''}</div><p class="muted">${PAYSCHED_PERIOD_HINT}</p>`;
}
function importPaySchedHTML(preview,kind){
  if(!preview)return '';
  // A stub approved from THIS section earlier in this preview's
  // life already saved the schedule: the section says so instead of
  // asking again, and the import's approve finishes normally with
  // paychecks generated from that schedule.
  if(preview.paySchedStubSaved){
    const sv=preview.paySchedStubSaved;
    return `<div class="item" style="display:block"><p><strong>Pay schedule on file for these shifts.</strong></p><p class="muted">Saved from the pay stub you uploaded here — ${escapeHTML(sv.agency||'your agency')}${PAY_FREQUENCY_LABELS[sv.frequency]?` · ${escapeHTML(PAY_FREQUENCY_LABELS[sv.frequency])}`:''}. Paychecks for these shifts show on your calendar, and the stub's own check counts as the actual.</p></div>`;
  }
  const ctx=importPaySchedTarget(preview,kind);if(!ctx)return '';
  const d=preview.paySchedDraft||{};
  const mine=paystubImportCtx&&paystubImportCtx.kind===kind;
  return `<div class="item" style="display:block"><p><strong>Want paychecks for these shifts on your calendar?</strong></p>${paySchedIntroHTML(ctx.agency)}${paySchedFieldsGridHTML({prefix:'impPaySched_'+kind,cls:'impPaySched',dataFor:(f)=>`data-kind="${kind}" data-field="${f}"`,draft:d,agency:ctx.agency,facility:ctx.facility,stubAmounts:!!preview.paySchedStub})}${preview.paySchedStub?`<p class="hint">${escapeHTML(paySchedStubNote(preview))}</p>`:''}<p class="muted">— or upload a pay stub and we'll fill this in from it —</p>${paystubUploadFormHTML(`class="paystubImportForm" data-kind="${kind}"`,'f_paystubImpFile_'+kind,'f_paystubImpText_'+kind)}${mine&&paystubStatus?`<p class="hint">${escapeHTML(paystubStatus)}</p>`:''}${mine&&paystubError?`<p class="hint">${escapeHTML(paystubError)}</p>`:''}<div class="toolbar"><button type="button" class="secondary" data-action="import-paysched-skip" data-id="${kind}">Skip — no pay schedule</button></div></div>`;
}
function applyImportPaySched(preview,kind){
  // Stores the preview's pay-schedule draft as a normal pay schedule
  // (db.payStubs) for the import's agency. Returns the saved record,
  // or null when the section was skipped / left incomplete (no
  // frequency or no pay date) / a schedule already exists — in every
  // null case the import proceeds exactly as it did before.
  if(!preview||preview.paySchedSkipped)return null;
  // A stub approved from this section already saved the schedule —
  // the manual fields never double-save on top of it.
  if(preview.paySchedStubSaved)return null;
  const ctx=importPaySchedCtx(preview,kind);if(!ctx)return null;
  const d=preview.paySchedDraft||{};
  const agency=String(d.agency||ctx.agency||'').trim();if(!agency)return null;
  if(paystubForAgency(agency))return null;
  // The draft still carrying the import's own agency name means
  // the section's identity is the import's facility — a schedule
  // already covering that facility (under any of its names)
  // blocks a duplicate save. A deliberately renamed agency is a
  // different payer and is governed by the exact check above.
  if(paySchedAgencyKey(agency)===paySchedAgencyKey(ctx.agency)&&paySchedCoveredCtx(ctx))return null;
  const frequency=normalizePayFrequency(d.frequency);const payDate=psValidISO(d.payDate);
  if(!frequency||!payDate)return null;
  // A stub read in this section (v131) filled the SAME draft: the
  // record then carries the stub's gross/net as this check's
  // actual and the stub read's provenance, so exactly ONE
  // stub-backed schedule saves — the user's edits in the one form
  // (amounts included) are the values that land.
  const stub=preview.paySchedStub||null;
  const amt=v=>{const n=rateOrNull(v);return n==null?'':String(n)};
  const rec={id:id(),agency,facility:String(d.facility||ctx.facility||'').trim(),frequency,periodStart:psValidISO(d.periodStart),periodEnd:psValidISO(d.periodEnd),payDate,gross:stub?amt(d.gross):'',net:stub?amt(d.net):'',source:stub?(stub.source||'text-parse'):'import',fileName:stub?(stub.fileName||''):'',updatedAt:new Date().toISOString()};
  db.payStubs=db.payStubs||[];db.payStubs.push(rec);
  if(stub){paystubImportCtx=null;paystubStatus=''}
  try{if(typeof cloudSaveKind==='function')cloudSaveKind('payStubs',rec.id)}catch(_){}
  return rec;
}
// --- Recovery: add a pay schedule AFTER an import (Nov 8, 2026) ---
// The preview offer only helps if the user actually sees it. Caleb's
// CAMC import was approved minutes BEFORE the v93 build carrying the
// section deployed (his calendar screenshot predates the commit), so
// his shifts landed with no pay schedule and no way back short of
// hunting down the pay-stub panel. Diagnosis (same day): the preview
// gating itself is sound — a test shaped exactly like his flow (grid
// rows, "check this one" flags, facility only from the schedule-level
// answer, facility not yet created) shows the section reliably under
// v93. So this is the recoverable path, not a gating rewrite: a
// facility that HAS shifts but no covering pay schedule gets the same
// offer on its own card in My facilities — same fields, same
// db.payStubs record, same per-agency dismissal, so a Skip in either
// place silences both. The covering check looks at BOTH a stub's
// agency and its facility, so a schedule saved under an agency name
// still covers the facility it pays for.
let facPaySchedDrafts={};
function payStubCoversFacility(f){
  if(!f)return false;
  const names=[f.name,...facilityAliases(f)].map(n=>normFacilityName(String(n||''))).filter(Boolean);
  if(names.length&&(db.payStubs||[]).some(p=>[p.agency,p.facility].some(v=>{const n=normFacilityName(String(v||''));return !!n&&names.includes(n)})))return true;
  // Tolerant identity (Nov 10, 2026, v111): a record that names
  // this facility by a close variant of its name ("Holzer" for
  // the facility saved as "HOLZ") covers it too — the card must
  // not offer a second schedule under the line that already
  // shows the first. Resolution goes through paystubFacilityOf
  // (the same identity the claiming path uses); a record that
  // resolves nowhere covers nothing here.
  return (db.payStubs||[]).some(p=>{const pf=paystubFacilityOf(p);return !!pf&&pf.id===f.id});
}
// Does an effective pay schedule already exist for an import's
// agency/facility? The exact agency string is only one of the
// names a schedule can live under — the same payer's records may
// sit under the payer's own name with the facility stated in a
// different one of its names (v111: "Premier Anesthesia Group,
// PC" / facility "Holzer" for the facility saved as "HOLZ"), and
// re-offering the setup there would stack a duplicate record
// the unification then has to absorb.
function paySchedCoveredCtx(ctx){
  if(!ctx)return false;
  if(paystubForAgency(ctx.agency))return true;
  const f=facilityByNameOrVariant(ctx.facility||ctx.agency);
  return !!(f&&payStubCoversFacility(f));
}
function facilityHasShifts(f){
  if(!f)return false;
  return (db.shifts||[]).some(x=>{if(!String(x.facility||'').trim())return false;const m=facilityByNameOrAlias(x.facility);return !!m&&m.id===f.id});
}
function facilityPaySchedMissing(f){
  if(!f||!featureOn('featurePaychecks'))return false;
  if(!facilityHasShifts(f))return false;
  if(payStubCoversFacility(f))return false;
  if(importPaySchedDismissed()[paySchedAgencyKey(f.name)])return false;
  return true;
}
function facilityPaySchedHTML(f){
  if(!facilityPaySchedMissing(f))return '';
  const d=facPaySchedDrafts[f.id]||{};
  return `<div class="item" style="display:block;margin-top:10px"><p><strong>Want paychecks for ${escapeHTML(f.name)} on your calendar?</strong></p>${paySchedIntroHTML(f.name)}${paySchedFieldsGridHTML({prefix:'facPaySched_'+f.id,cls:'facPaySched',dataFor:(fld)=>`data-fac="${escapeHTML(f.id)}" data-field="${fld}"`,draft:d,agency:f.name,facility:f.name})}<div class="toolbar"><button type="button" data-action="facility-paysched-save" data-id="${escapeHTML(f.id)}">Save pay schedule</button><button type="button" class="secondary" data-action="facility-paysched-dismiss" data-id="${escapeHTML(f.id)}">No thanks</button></div></div>`;
}
function importPaySchedHint(preview,kind,saved){
  // Approval-message pointer for an import that finished WITHOUT a
  // pay schedule: where to add one after the fact (the facility card).
  if(saved)return '';
  if(preview&&preview.paySchedStubSaved)return '';
  const ctx=importPaySchedCtx(preview,kind);if(!ctx)return '';
  if(paySchedCoveredCtx(ctx))return '';
  if(importPaySchedDismissed()[paySchedAgencyKey(ctx.agency)])return '';
  return ` No pay schedule for ${ctx.agency} yet — add one any time on its card on the Facilities tab and its paychecks will show on your calendar.`;
}
function repriceUnpricedShiftsForFacility(f){
  // The one repair pass (Nov 10, 2026 — the Edit-form round): blank
  // pays price in the shared resolution order — per-code definitions
  // first, then the card (the old first loop here priced blanks from
  // the card alone, so a code whose only price was its own stated
  // amount stayed blank at save while the boot heal priced it) —
  // and derived pays re-price too (Nov 9, 2026): a shift whose amount
  // was CALCULATED from this facility's clarification answers or
  // rate rule holds a formula result, not a fact, so when the rates
  // behind the formula are corrected (a weekday/weekend split
  // answered, paid hours fixed), the saved amounts follow. Amounts
  // the user typed as per-shift totals and manual edits are never
  // touched; a pay stub's actual lives on the stub record, not the
  // shift, so actuals still win at the paycheck layer no matter what
  // this pass does. Callers that only need a count get priced +
  // updated; the facility save uses repairShiftPaysForFacility
  // directly for the breakdown its message reports.
  const r=repairShiftPaysForFacility(f);return r.priced+r.updated;
}
// The per-shift rules captured in the user's own words, shown inside
// the facility Edit form (Nov 10, 2026 — Caleb: "We need to have the
// shift rules communicate over to this section"). The form edits the
// rate card; these definitions live on the same facility record and
// price shifts together with the card (per-code definitions first —
// see resolveShiftPrice). Read-only here: the editing surface stays
// "Pay rules in your words" on the facility card, and saving this
// form never removes them.
function facilityCodeRulesHTML(f){
  const defs=facilityCodeDefs(f);const codes=Object.keys(defs);if(!codes.length)return '';
  const lines=codes.map(code=>{
    const d=defs[code];const label=String(d.label||code).trim();
    let price='';
    if(d.unpaid)price='no pay';
    else{
      const parts=[];
      const wd=rateOrNull(d.weekdayPay),we=rateOrNull(d.weekendPay);
      if(wd!=null)parts.push(currency(wd)+' on weekdays');
      if(we!=null)parts.push(currency(we)+' on weekends');
      const ph=rateOrNull(d.paidHours);if(ph!=null)parts.push('paid for '+ph+' hours');
      price=parts.join(' · ');
    }
    return `<li>“${escapeHTML(code)}” — ${escapeHTML(label)}${price?': '+escapeHTML(price):''}</li>`;
  }).join('');
  return `<div class="item" style="display:block"><p><strong>Shift rules from your words</strong></p><p class="muted">Captured with “Pay rules in your words” on the facility card — they price your shifts together with the rates above, and saving here never removes them.</p><ul style="margin:6px 0 0;padding-left:18px">${lines}</ul></div>`;
}
// One-line rate summary for the facilities list. Only rates that are set
// are shown as amounts; a blank rate is shown as "not set", never $0.00.
function facilityRateSummary(x){
  const set=[];
  if(JSON.stringify(facilityWeekendDays(x))!==JSON.stringify([0,6]))set.push('Weekend: '+facilityWeekendDays(x).map(d=>WEEKDAY_SHORT[d]).join(' & '));
  if(rateOrNull(x.hourlyRate)!=null)set.push(currency(rateOrNull(x.hourlyRate))+'/hr');
  if(rateOrNull(x.rate8)!=null)set.push('8h '+currency(rateOrNull(x.rate8)));
  if(rateOrNull(x.rate10)!=null)set.push('10h '+currency(rateOrNull(x.rate10)));
  if(rateOrNull(x.rate12)!=null)set.push('12h '+currency(rateOrNull(x.rate12)));
  if(rateOrNull(x.rate24)!=null)set.push('24h call '+currency(rateOrNull(x.rate24)));
  if(rateOrNull(x.hourlyCall1st)!=null)set.push('1st call '+currency(rateOrNull(x.hourlyCall1st))+'/hr');
  if(rateOrNull(x.rateSecond)!=null)set.push('2nd call '+currency(rateOrNull(x.rateSecond)));
  if(rateOrNull(x.weekendRateSecond)!=null)set.push('2nd call wknd '+currency(rateOrNull(x.weekendRateSecond)));
  if(rateOrNull(x.callBonus)!=null)set.push('+'+currency(rateOrNull(x.callBonus))+' call bonus');
  const missing=[];
  if(rateOrNull(x.rate24)==null&&rateOrNull(x.hourlyCall1st)==null)missing.push('24-hour call');
  if(rateOrNull(x.rateSecond)==null&&rateOrNull(x.weekendRateSecond)==null&&!(rateOrNull(x.callBonus)!=null&&(rateOrNull(x.rate8)!=null||rateOrNull(x.hourlyRate)!=null)))missing.push('second call');
  return {set:set,missing:missing};
}
// The contract preview's clarification surface (Nov 11, 2026,
// v123 — Caleb: "Just replace the individual shift boxes with
// this"): the per-line field grids that used to sit here (a
// "What is this rate?" selector + $ input per extracted line)
// are GONE. The only clarification path is the same describe-
// in-your-own-words component the facility card uses, one per
// preview facility, prefilled with what the read extracted
// written as plain sentences — the user edits prose, and
// "Make my rules" re-derives the rate card through the one
// read-back before Save applies it. Amounts the read could not
// attach to any rate are never silently dropped: they are
// listed under the box as one words-level line.
// The extracted rates as plain sentences — phrasings the words
// reader itself parses back to the same fields (round-trip
// pinned in test-v123-import-preview-words.js), so an edited
// box re-derives the same card the read produced.
function contractRatesProse(f){
  const r=(f&&f.rates)||{};const g=k=>rateOrNull(r[k]);const bits=[];
  if(g('hourlyRate')!=null)bits.push('Day shifts pay '+moneyShort(g('hourlyRate'))+'/hr'+(g('paidHours8')!=null?(' and I\'m paid for '+g('paidHours8')+' hours'):'')+'.');
  else if(g('paidHours8')!=null)bits.push('I\'m paid for '+g('paidHours8')+' hours on an 8-hour shift.');
  if(g('rate8')!=null)bits.push('An 8-hour shift pays '+moneyShort(g('rate8'))+' per shift.');
  if(g('rate10')!=null)bits.push('A 10-hour shift pays '+moneyShort(g('rate10'))+' per shift.');
  if(g('rate12')!=null)bits.push('A 12-hour shift pays '+moneyShort(g('rate12'))+' per shift.');
  if(g('hourlyCall1st')!=null)bits.push('The 1st call hourly rate is '+moneyShort(g('hourlyCall1st'))+'/hr.');
  const c1w=g('rate24'),c1e=g('weekendRate24');
  if(c1w!=null&&c1e!=null)bits.push('Call 1 is '+moneyShort(c1w)+' on weekdays and '+moneyShort(c1e)+' on weekends.');
  else if(c1w!=null)bits.push('Call 1 is '+moneyShort(c1w)+' on weekdays.');
  else if(c1e!=null)bits.push('Call 1 is '+moneyShort(c1e)+' on weekends.');
  const c2w=g('rateSecond'),c2e=g('weekendRateSecond');
  if(c2w!=null&&c2e!=null)bits.push('Call 2 is '+moneyShort(c2w)+' on weekdays and '+moneyShort(c2e)+' on weekends.');
  else if(c2w!=null)bits.push('Call 2 is '+moneyShort(c2w)+' on weekdays.');
  else if(c2e!=null)bits.push('Call 2 is '+moneyShort(c2e)+' on weekends.');
  if(g('callBonus')!=null)bits.push('Overnight call bonus is '+moneyShort(g('callBonus'))+'.');
  return bits.join(' ');
}
// $ amounts named in the source text that no extracted rate
// accounts for. Value-based: an amount equal to any extracted
// rate value counts as attached (the same figure can serve two
// lines — better one missed duplicate than a dropped amount
// never mentioned at all; the confusion budget errs toward
// asking).
function contractUnattachedAmounts(text,rates){
  const attached=new Set();
  for(const v of Object.values(rates||{})){const n=rateOrNull(v);if(n!=null)attached.add(n)}
  const out=new Set();
  for(const m of String(text||'').matchAll(/\$([\d,]+(?:\.\d{1,2})?)/g)){const n=Number(m[1].replace(/,/g,''));if(isFinite(n)&&n>0&&!attached.has(n))out.add(n)}
  return [...out].sort((a,b)=>a-b);
}
// The facility-shaped overlay the words box reads against for a
// preview entry: its extracted rates at top level (the shape
// describePrefillText / describeParseLocal / the read-back
// summary all expect from a facility record).
// The saved facility a preview entry resolves to, by name or by
// any of its short names — the same resolution the approve path
// uses (Nov 11, 2026, v131).
function facPreviewSaved(f){
  if(!f)return null;
  const byName=facilityByNameOrAlias(String(f.name||'').trim());
  if(byName)return byName;
  const byAlias=String(f.aliases||'').split(',').map(a=>facilityByNameOrAlias(a.trim())).find(Boolean);
  return byAlias||null;
}
// The code universe for a preview entry's words reader (v131):
// the codes the CONTRACT names, plus — when the entry resolves
// to a saved facility — that facility's own codes, deduped on the
// one strip-key identity so the same code spelled two ways
// ("HOLZ - PCDO" in the document, "Holzer PCDO" on a shift) is
// one universe entry. Before v131 the preview passed NO codes
// and the reader's per-code machinery never ran on this surface.
function facPreviewCodes(f){
  const out=[];const seen=new Set();
  const saved=facPreviewSaved(f);
  const ctx={name:(f&&f.name)||(saved&&saved.name)||'',aliases:(f&&f.aliases)||''};
  if(saved)ctx.aliases=[...new Set([...facilityAliases(saved),...String(ctx.aliases).split(',').map(s=>s.trim()).filter(Boolean)])].join(', ');
  const push=e=>{if(!e||!String(e.code||'').trim())return;const k=codeStripKey(e.code,ctx);if(!k||seen.has(k))return;seen.add(k);out.push(e)};
  for(const e of (f&&f.codes)||[])push(e);
  if(saved)for(const e of facilityDescribeCodes(saved))push(e);
  return out;
}
function facPreviewOverlay(f){
  // The overlay the preview's words reader sees (v131): when the
  // entry resolves to a saved facility, the saved facility is the
  // base — its definitions, its weekend rule, its rates — with
  // the contract's extracted rates laid on top (a blank extracted
  // rate never wipes a saved one). With no saved facility the
  // overlay is the entry alone, exactly as before.
  const saved=facPreviewSaved(f);
  const o={name:(f&&f.name)||'',aliases:(f&&f.aliases)||'',codeMap:{}};
  if(saved){
    o.id=saved.id;o.codeMap=facilityCodeDefs(saved);
    if(saved.weekendDays)o.weekendDays=saved.weekendDays.slice();
    if(saved.weekendDaysSource)o.weekendDaysSource=saved.weekendDaysSource;
    const al=[...facilityAliases(saved)];for(const a of String((f&&f.aliases)||'').split(',').map(s=>s.trim()).filter(Boolean))if(!al.includes(a))al.push(a);
    o.aliases=al.join(', ');
    for(const k of FACILITY_RATE_KEYS){const sv=rateOrNull(saved[k]);if(sv!=null)o[k]=String(sv)}
  }
  for(const k of FACILITY_RATE_KEYS)o[k]=(f&&f.rates&&f.rates[k]!=null&&String(f.rates[k])!=='')?String(f.rates[k]):(o[k]!=null?o[k]:'');
  return o;
}
function facilityContractPreviewHTML(){
  if(facilityContractError)return `<p class="hint">${escapeHTML(facilityContractError)}</p>`;
  if(!facilityContractPreview)return '<p class="muted">No contract read yet. Upload a contract or paste its text above, then tap “Read my contract” — nothing is saved until you approve the preview below.</p>';
  const p=facilityContractPreview;
  let out=(p.isPhoto?ocrDiagnosticsHTML(facilityContractOcrPages,facilityContractPendingImages,p.ocrText||''):'' )+`<p><strong>Read from:</strong> ${escapeHTML(p.fileName||'pasted text')} — ${p.aiRead?'read with AI from your photo':p.isPhoto?'read from your photo on this device':'read from the text you pasted'}. Check the name and address, and the pay rules in your own words below — a read can misread digits and dates.</p><p><strong>Nothing is saved yet.</strong> Uncheck any facility you do not want, then save. Rates the contract did not state stay blank — blank means “not taken here / not applicable”, never $0.</p>${p.aiNote?`<p class="hint">${escapeHTML(p.aiNote)}</p>`:''}`;
  if(facilityContractConfirmCreate){
    const newOnes=(p.facilities||[]).filter(f=>f.include&&String(f.name||'').trim()&&!facilityByNameOrAlias(String(f.name).trim())&&!String(f.aliases||'').split(',').map(a=>facilityByNameOrAlias(a.trim())).find(Boolean));
    if(newOnes.length)out+=`<div class="item" style="display:block"><p><strong>New facility — not one of your saved facilities:</strong> ${newOnes.map(f=>escapeHTML(String(f.name).trim())).join(', ')}. Saving will create ${newOnes.length===1?'it':'them'} as a new facilit${newOnes.length===1?'y':'ies'} with the rates below. If this contract is really for a facility you already have, fix the name above or add the short name under Short names / abbreviations — then save again and it will update that facility instead.</p><div class="toolbar"><button data-action="facility-contract-approve">Yes — create the new facilit${newOnes.length===1?'y':'ies'} and save</button></div></div>`;
  }
  if(p.isPhoto)out+=`<div class="toolbar"><button type="button" data-action="facility-reread-rates">Re-read just the rates table</button><span class="muted">Crops the bottom half of each photo and reads only that — the rates table sits at the bottom of this addendum. New rates are merged into the preview below; nothing is saved yet. No picture leaves this device.</span></div>${facilityContractCropNote?`<p class="hint">${escapeHTML(facilityContractCropNote)}</p>`:''}`;
  p.facilities.forEach((f,i)=>{
    const un=(f.unattached||[]).filter(n=>rateOrNull(n)!=null);
    const unLine=un.length?`<p class="hint">Your contract also mentions ${un.map(n=>moneyShort(n)).join(' and ')} — I couldn\'t tell what ${un.length===1?'it\'s':'they\'re'} for. Add a sentence about ${un.length===1?'it':'them'} in the box above if it matters.</p>`:'';
    const smallBits=[];
    if(f.rates&&f.rates._includedNote)smallBits.push(escapeHTML(f.rates._includedNote)+'.');
    if((f.unreadable||[]).length)smallBits.push('Not readable from the photos (see above): '+escapeHTML((f.unreadable||[]).map(k=>FACILITY_RATE_LABELS[k]||k).join(', '))+'.');
    if(f.effectiveStart)smallBits.push('Contract dates: '+fmt(f.effectiveStart)+' to '+fmt(f.effectiveEnd||f.effectiveStart)+'.');
    if(p.shiftCount)smallBits.push('This document also lists '+p.shiftCount+' shift(s) — shifts are not created here; use Upload a schedule on this tab to import them from the same contract.');
    out+=`<div class="item" style="display:block"><label><input type="checkbox" class="facContractInclude" data-i="${i}" ${f.include?'checked':''}> Save this facility</label>
    <div class="form-grid">
    <div class="field"><label for="f_facPrev_${i}_name">Facility name</label><input id="f_facPrev_${i}_name" class="facContractEdit" data-i="${i}" data-field="name" type="text" value="${escapeHTML(f.name||'')}" placeholder="Not found — type the facility name"></div>
    <div class="field"><label for="f_facPrev_${i}_aliases">Short names / abbreviations</label><input id="f_facPrev_${i}_aliases" class="facContractEdit" data-i="${i}" data-field="aliases" type="text" value="${escapeHTML(f.aliases||'')}" placeholder="e.g. RGH"></div>
    <div class="field"><label for="f_facPrev_${i}_address">Address</label><input id="f_facPrev_${i}_address" class="facContractEdit" data-i="${i}" data-field="address" type="text" value="${escapeHTML(f.address||'')}" placeholder="Not stated in contract"></div>
    </div>
    ${describeRulesHTML('imp:facprev:'+i,{facName:String(f.name||'').trim(),fac:facPreviewOverlay(f),codes:facPreviewCodes(f),heading:String(f.name||'').trim()?('Pay rules at '+String(f.name).trim()+' — in your words'):'Pay rules — in your words',prefill:contractRatesProse(f)})}
    ${unLine}${unreadableRatesWarningHTML(f.unreadable||[])}
    ${smallBits.length?`<p class="muted">${smallBits.join(' ')}</p>`:''}</div>`;
  });
  out+=importPaySchedHTML(facilityContractPreview,'faccontract');
  out+=`<div class="toolbar" style="margin-top:12px"><button data-action="facility-contract-approve">Save facilities — I checked this</button><button type="button" class="secondary" data-action="facility-contract-discard">Discard preview (save nothing)</button></div>`;
  return out;
}
// Map a structured AI rule (extract-contract 'rule' mode) onto the
// facility rate fields the deterministic engine prices from. Only the
// fields the rule actually states are set — never $0, never a guess.
function ruleToFacilityRates(rule){
  const out={};
  const set=(k,v)=>{const n=rateOrNull(v);if(n!=null)out[k]=String(n)};
  if(!rule||typeof rule!=='object')return out;
  const segs=(Array.isArray(rule.segments)?rule.segments:[]).filter(s=>s&&rateOrNull(s.rate)!=null);
  if(rule.shift_type==='24-hour call'){
    set('hourlyRate',rule.hourly_rate);set('hourlyCall1st',rule.first_call_hourly_rate);
    set('rate24',rule.flat_rate);set('weekendRate24',rule.weekend_flat_rate);set('callBonus',rule.call_bonus);
    if(segs.length>=2){
      if(out.hourlyRate==null)set('hourlyRate',segs[0].rate);
      if(out.hourlyCall1st==null)set('hourlyCall1st',segs[segs.length-1].rate);
    }else if(segs.length===1&&out.hourlyCall1st==null&&out.rate24==null){
      set('hourlyCall1st',segs[0].rate);
    }
  }else if(rule.shift_type==='Second call'){
    set('rateSecond',rule.second_call_rate);set('weekendRateSecond',rule.weekend_second_call_rate);set('callBonus',rule.call_bonus);
    if(rule.flat_rate!=null){if(rule.applies_to==='weekend')set('weekendRateSecond',rule.flat_rate);else set('rateSecond',rule.flat_rate)}
    set('hourlyRate',rule.hourly_rate);
  }else if(rule.shift_type==='8-hour day'||rule.shift_type==='10-hour shift'||rule.shift_type==='12-hour shift'){
    const key=rule.shift_type==='8-hour day'?'rate8':rule.shift_type==='10-hour shift'?'rate10':'rate12';
    set(key,rule.flat_rate);set('hourlyRate',rule.hourly_rate);set('callBonus',rule.call_bonus);
  }else{
    set('hourlyRate',rule.hourly_rate);set('callBonus',rule.call_bonus);set('rateSecond',rule.second_call_rate);set('hourlyCall1st',rule.first_call_hourly_rate);
  }
  return out;
}
function facilityAddressLine(x){const a=String((x&&x.address)||'').trim();if(a)return `<div class="muted facility-addr" data-action="edit-facilities" data-id="${escapeHTML(x.id)}" title="Tap to edit this facility">${escapeHTML(a)}</div>`;return `<div class="warning facility-addr" data-action="edit-facilities" data-id="${escapeHTML(x.id)}">No address saved — mileage can’t calculate for this facility. Tap to add it.</div>`}
function myFacilitiesHTML(){return `<section class="panel" id="my-facilities-panel"><h2>My facilities</h2>${list('facilities',db.facilities,x=>{const s=facilityRateSummary(x);return `<div class="item-title">${escapeHTML(x.name)}${facilityAliases(x).length?` <span class="muted">(${escapeHTML(facilityAliases(x).join(', '))})</span>`:''}</div><div class="facility-ytd"><strong>${currentYear()} YTD ${currency(facilityYearToDate(x))}</strong></div>${facilityAddressLine(x)}<div class="muted">${s.set.length?s.set.join(' · '):'No rates set'}${s.missing.length?` · <span class="warning">Not taken here: ${escapeHTML(s.missing.join(', '))}</span>`:''} · ${x.distance?escapeHTML(x.distance)+' miles one-way ('+roundTripMiles(x.distance).toFixed(1)+' round trip)'+(x.distanceSource==='auto'?' (auto-calculated from home)':' (manual)'):'distance not set'}</div>${x.ratesSource?`<div class="muted">Rates from ${escapeHTML(x.ratesSource)}${x.ratesSourceFile?` · ${escapeHTML(x.ratesSourceFile)}`:''}${x.ratesSourceDate?` · ${escapeHTML(x.ratesSourceDate)}`:''}</div>`:'<div class="muted">Rates entered manually.</div>'}${s.set.length===0?'<div class="muted">No pay rule yet — shifts for this facility import unpriced until you set one.</div>':''}${x.notes?`<p style="white-space:pre-wrap">${escapeHTML(x.notes)}</p>`:''}${facilityPaySchedHTML(x)}${facilityPaystubLineHTML(x)}<div class="toolbar"><button type="button" class="tiny secondary" data-action="describe-facility" data-id="${escapeHTML(x.id)}">${describeOpenFac===x.id?'Close pay rules':'Pay rules in your words'}</button>${upcomingProposedShifts(x).length?`<button type="button" class="tiny secondary" data-action="proposed-email" data-id="${escapeHTML(x.id)}">Email proposed shifts (${upcomingProposedShifts(x).length})</button>`:''}</div>${describeOpenFac===x.id?describeRulesHTML('fac:'+x.id,{facName:x.name,codes:facilityDescribeCodes(x),fac:x,heading:'Pay rules at '+x.name+' — in your words'}):(describeSavedFlashFac===x.id?'<p class="hint">Pay rules saved.</p>':'')}${paystubCardSectionHTML(x)}`})}<p class="hint">Facility notes are stored unencrypted in this browser — no passwords or patient information.</p></section>`}
// QGenda and Upload a schedule live at the bottom of this tab too
// (Nov 7, 2026) — the same qgendaFeedHTML()/scheduleImportHTML()
// components as the Account sync area, not copies: one tab renders at
// a time, so the shared state (connect form, upload preview, panel
// open logic, feature toggle) is identical from either home.
// --- Proposed-shifts email (v118) ------------------------------------
// Caleb remembered testing an email function for proposed shifts; a
// full sweep of this codebase and the branch's git history found no
// email/mailto implementation ever shipped (the per-shift Google/
// Outlook calendar links are the closest relative). Built new here:
// pick a facility, tick the proposed shifts, and the app composes a
// plain-text email in the user's OWN mail app (mailto:) — the user
// reviews and sends; the app never sends on its own. (No "sent"
// marker exists in the shift data model, so none is offered —
// statuses stay confirmed/proposed only.)
let propEmailOpen=false,propEmailFacId='';
function upcomingProposedShifts(fac){if(!fac)return[];const today=localDate(new Date());return (db.shifts||[]).filter(x=>{if(normalizeShiftStatus(x.status)!=='proposed')return false;if(!x.date||x.date<today)return false;const f=facilityForRecord(x);return f&&f.id===fac.id}).sort((a,b)=>a.date.localeCompare(b.date)||String(a.type||'').localeCompare(String(b.type||'')))}
function propEmailPrice(fac,x){try{const r=resolveShiftPrice(fac,x);if(!r)return'';const n=Number(r.pay);return isFinite(n)?currency(n):''}catch(e){return''}}
function facilitiesWithProposedShifts(){return (db.facilities||[]).filter(f=>upcomingProposedShifts(f).length)}
function proposedEmailFacility(){const list=facilitiesWithProposedShifts();if(!list.length)return null;return list.find(f=>f.id===propEmailFacId)||list[0]}
function composeProposedEmail(fac,shifts,name){const lines=shifts.map(x=>{const p=propEmailPrice(fac,x);return '• '+fmt(x.date)+' — '+(x.type||'Shift')+(p?' · '+p:'')});const subject='Proposed shifts — '+name+' — '+fac.name;const body='Hello,\n\nI\'d like to propose the following shifts at '+fac.name+':\n\n'+lines.join('\n')+'\n\nPlease let me know if these work, or if anything needs to change.\n\nThanks,\n'+name;return{subject,body}}
function proposedEmailSheetHTML(){if(!propEmailOpen)return'';const list=facilitiesWithProposedShifts();if(!list.length)return `<div class="sheet-backdrop"><section class="sheet"><div class="row"><h3>Email proposed shifts</h3><button class="ghost" data-action="proposed-email-close" aria-label="Close">✕</button></div><p class="small">No proposed shifts to email right now — shifts you mark as proposed will show up here.</p><button class="secondary" data-action="proposed-email-close">Close</button></section></div>`;const fac=proposedEmailFacility();const shifts=upcomingProposedShifts(fac);const opts=list.map(f=>`<option value="${f.id}" ${f.id===fac.id?'selected':''}>${escapeHTML(f.name)} (${upcomingProposedShifts(f).length} proposed)</option>`).join('');const rows=shifts.map(x=>{const p=propEmailPrice(fac,x);return `<label class="row checkline"><input type="checkbox" class="propEmailInclude" value="${x.id}" checked> <span>${escapeHTML(fmt(x.date))} · ${escapeHTML(x.type||'Shift')}${p?' · '+escapeHTML(p):''}</span></label>`}).join('');return `<div class="sheet-backdrop"><section class="sheet"><div class="row"><h3>Email proposed shifts</h3><button class="ghost" data-action="proposed-email-close" aria-label="Close">✕</button></div><label class="fld">Facility<select id="f_propEmailFacility">${opts}</select></label><label class="fld">Scheduling contact email<input id="f_propEmailContact" type="email" value="${escapeHTML(fac.contactEmail||'')}" placeholder="scheduling@hospital.org"></label><p class="small">These proposed shifts will be listed in the email:</p><div class="prop-email-list">${rows}</div><p class="small muted">Opens in your own mail app, ready to review and send — CRNA Hub never sends email for you.</p><div class="toolbar"><button class="primary" data-action="proposed-email-send">Open in my mail app</button><button class="secondary" data-action="proposed-email-close">Cancel</button></div></section></div>`}
function openProposedEmailSheet(facId){propEmailOpen=true;const list=facilitiesWithProposedShifts();propEmailFacId=facId||(list.length?list[0].id:'');render()}
function sendProposedEmail(){const fac=proposedEmailFacility();if(!fac)return;const sel=$('f_propEmailFacility');const facNow=(db.facilities||[]).find(f=>f.id===(sel?sel.value:fac.id))||fac;const contact=($('f_propEmailContact')||{}).value||'';const to=String(contact).trim();if(!to){alert('Add the scheduling contact email first — we will remember it for '+facNow.name+'.');return}const checked=Array.from(document.querySelectorAll('.propEmailInclude:checked')).map(el=>el.value);const shifts=upcomingProposedShifts(facNow).filter(x=>checked.includes(String(x.id)));if(!shifts.length){alert('Tick at least one shift to include.');return}if(String(facNow.contactEmail||'')!==to){facNow.contactEmail=to;facNow.updatedAt=cloudNow();persist();cloudSaveKind('facilities',facNow.id)}const name=profileName()||'CRNA';const c=composeProposedEmail(facNow,shifts,name);propEmailOpen=false;render();window.location.href='mailto:'+encodeURIComponent(to)+'?subject='+encodeURIComponent(c.subject)+'&body='+encodeURIComponent(c.body)}
function facilitiesPage(){const x=db.facilities.find(x=>x.id===editId)||{};const pre=(!editId&&facilitySuggestionPrefill)?facilitySuggestionPrefill:null;const blankHint='placeholder="Leave blank if not taken here"';return `${myFacilitiesHTML()}${onboardDirectionHTML(3)}${facilityRescanResultHTML()}${facilitySuggestionsHTML()}${pre?facilityThreeWaysHTML(pre):''}${collapsePanelHTML('facility-contract-panel','Add a facility from a contract',`<form id="facilityContractForm"><div class="form-grid">${field('facilityContractFile','Choose contract file(s) — select several pictures for a multi-page contract','file','','accept=".txt,.csv,.ics,.pdf,.png,.jpg,.jpeg,.webp,.heic,text/plain,text/csv,text/calendar,image/*" multiple')}${area('facilityContractText','Or paste contract text','','Facility: Riverside General\nRate: $200/hr, $800 overnight call bonus\n24-hour / 1st call: $4,000')}</div><div class="form-actions"><button type="submit">Read my contract</button></div></form>${contractPagesHTML('facility')}${facilityContractOcrStatus?`<p class="hint" id="facilityContractOcrStatus">${escapeHTML(facilityContractOcrStatus)}</p>`:''}${facilityContractError&&!facilityContractPreview?`<p class="hint">${escapeHTML(facilityContractError)}</p>`:''}<div style="margin-top:14px">${facilityContractPreviewHTML()}</div>`,!!((db.facilities||[]).length===0||facilityContractPreview||facilityContractError||facilityContractOcrStatus||(facilityContractPendingImages||[]).length>0||pre))}${paystubPanelHTML()}${qgendaFeedHTML()}${scheduleImportHTML()}${collapsePanelHTML('facility-manual-panel',(editId&&x.id)?'Edit hospital':'Add a facility manually',`<p class="muted">Type the hospital and its rates — every rate is optional; leave blank what you don’t take here.</p><form id="entryForm" data-kind="facilities"><div class="form-grid">${field('name','Hospital / facility name','text',x.name||(pre&&pre.name)||'','required')}${field('aliases','Short names / abbreviations (comma-separated)','text',x.aliases||'','placeholder="e.g. RGH"')}${field('address','Address','text',x.address||(pre&&pre.address)||'','placeholder="Street, City, State ZIP — used to calculate mileage"')}${field('contactEmail','Scheduling contact email (optional)','email',x.contactEmail||'','placeholder="scheduling@hospital.org"')}${field('hourlyRate','Hourly rate ($)','number',x.hourlyRate||'','min="0" step="0.01" '+blankHint)}${field('paidHours8','Paid hours for an 8-hour shift','number',x.paidHours8||'','min="0" step="0.5" placeholder="8"')}${field('rate8','8-hour shift rate ($)','number',x.rate8||'','min="0" step="0.01" '+blankHint)}${field('rate10','10-hour shift rate ($)','number',x.rate10||'','min="0" step="0.01" '+blankHint)}${field('rate12','12-hour shift rate ($)','number',x.rate12||'','min="0" step="0.01" '+blankHint)}${field('rate24','24-hour call rate ($)','number',x.rate24||'','min="0" step="0.01" '+blankHint)}${field('weekendRate24','Weekend 24-hour call rate ($)','number',x.weekendRate24||'','min="0" step="0.01" '+blankHint)}${field('hourlyCall1st','1st call hourly rate ($/hr)','number',x.hourlyCall1st||'','min="0" step="0.01" '+blankHint)}${field('rateSecond','Second call rate — weeknight ($)','number',x.rateSecond||'','min="0" step="0.01" '+blankHint)}${field('weekendRateSecond','Second call rate — weekend ($)','number',x.weekendRateSecond||'','min="0" step="0.01" '+blankHint)}${field('callBonus','Overnight call bonus ($)','number',x.callBonus||'','min="0" step="0.01" '+blankHint)}${field('distance','One-way miles','number',x.distance||'','min="0" step="0.1" placeholder="Auto from home, or enter manually"')}<input type="hidden" name="distanceSource" id="f_distanceSource" value="${escapeHTML(x.distanceSource||(x.distance?'manual':''))}">${area('notes','Offline facility notes',x.notes||'','Parking, protocols, phone numbers, authorized facility codes, EHR URL or username (never passwords)')}</div>${(editId&&x.id)?facilityCodeRulesHTML(x):''}<p class="hint" id="facilityDistanceStatus">${escapeHTML(facilityDistanceStatus)}</p><div class="toolbar"><button type="button" class="secondary" data-action="facility-distance">Calculate one-way distance from home</button></div>${formEnd(editId?'Save facility':'Add facility')}`,!!((editId&&x.id)||pre))}${dismissedFacilitySuggestionsHTML()}${proposedEmailSheetHTML()}`}
// PTO tab removed (Nov 6, 2026): Caleb wasn't sure it earned its place;
// it can come back later. The tab, page, and its actions are gone,
// but the data model stays — db.pto and the pto* settings fields
// remain in empty()/load()/backup/restore untouched, so existing
// accounts keep their recorded PTO data and old backups restore.

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
  if (!SUPABASE_CONFIGURED) return 'File details are saved on this device only — the file itself is not stored.';
  if (!cloudSession) return 'Sign in and enable document storage to upload files. Until you sign in on the Account tab, file details here are saved on this device only — the file itself is not stored.';
  if (!cloudActive) return 'Signed in — your records are merging with your account automatically. Until that finishes, file details here are saved on this device only — the file itself is not stored.';
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
  const docNext = docs.find(x => x.expiry);
  const docSummary = docs.length ? (' · ' + docs.length + ' on file' + (docNext ? (' · next expires ' + fmt(docNext.expiry)) : '')) : '';
  const docNeedsAction = docs.some(x => { const d = daysUntil(x.expiry); return d !== null && d <= 90; });
  const docOpen = !!(onboardStep === 5 || (editId && docs.some(x => x.id === editId)) || docOcrStatus || docStorageError || docNeedsAction || !docs.length);
  return collapsePanelHTML('cert-documents', 'Certification documents' + docSummary, `${onboardDirectionHTML(5)}<p class="muted">${escapeHTML(docStorageStatus())}</p><p class="muted">Upload a cert and we’ll read its expiration date — fix it if we misread.</p>${docOcrStatus ? `<p class="hint" id="docOcrStatus">${escapeHTML(docOcrStatus)}</p>` : ''}${docStorageError ? `<p class="hint">Storage note: ${escapeHTML(docStorageError)}</p>` : ''}
  <form data-kind="documents"><div class="form-grid">${select('type', 'Certification type', ['ACLS', 'BLS', 'PALS', 'NRP', 'Other'], doc.certType && ['ACLS', 'BLS', 'PALS', 'NRP'].includes(doc.certType) ? doc.certType : (doc.certType ? 'Other' : 'ACLS'))}${field('otherType', 'Other certification (if Other)', 'text', doc.certType && !['ACLS', 'BLS', 'PALS', 'NRP'].includes(doc.certType) ? doc.certType : '')}${field('issue', 'Issue date', 'date', doc.issue || '')}${field('expiry', 'Expiration date (leave blank to read it from the file)', 'date', doc.expiry || '')}${field('file', 'Certification document file', 'file', '', 'accept=".pdf,.txt,.png,.jpg,.jpeg,.webp,.heic"')}</div>${formEnd(editId && db.documents.some(x => x.id === editId) ? 'Save certification document' : 'Add certification document')}</form>
  ${docs.length ? docs.map(x => { const d = daysUntil(x.expiry); const src = x.expirySource === 'extracted' ? 'Expiration extracted from document' : x.expirySource === 'user-entered' ? 'Expiration entered manually' : 'No expiration found'; return `<div class="item"><div><strong>${escapeHTML(x.certType || 'Certification')}</strong>${x.fileName ? ' · ' + escapeHTML(x.fileName) : ''}${x.issue ? ' · issued ' + fmt(x.issue) : ''}<div class="muted">${x.expiry ? ('Expires ' + fmt(x.expiry) + (d !== null ? ` <span class="${d < 0 ? 'expired' : d <= 7 ? 'expired' : d <= 30 ? 'warning' : 'success'}">${d < 0 ? ('Expired ' + Math.abs(d) + ' days ago') : d === 0 ? 'Due today' : ('Due in ' + d + ' days')}</span>` : '') + (addDaysISO(x.expiry, -90) ? ` · 3-month reminder ${fmt(addDaysISO(x.expiry, -90))}` : '')) : '<span class="warning">No expiration found — enter it manually</span>'} · ${src} · ${x.storagePath ? 'Stored in your private cloud storage' : 'File details on this device only — file not stored'}</div></div><div class="item-actions">${x.storagePath ? `<button class="tiny secondary" data-action="download-doc" data-id="${escapeHTML(x.id)}">Download</button>` : ''}<button class="tiny secondary" data-action="edit-documents" data-id="${escapeHTML(x.id)}">${x.storagePath ? 'Replace / edit' : 'Edit'}</button><button class="tiny danger" data-action="delete-documents" data-id="${escapeHTML(x.id)}">Delete</button></div></div>`; }).join('') : '<p class="muted">No certification documents yet.</p>'}` , docOpen);
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
        docOcrStatus = 'Reading your picture — this can take a few seconds…';
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
        } catch (err) { docOcrStatus = ''; note = 'Could not read this picture: ' + err.message + ' Try a clearer photo, or enter the expiration date manually.'; }
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
  if(!featureOn('featureCredentials'))return featureOffHTML('featureCredentials');
  const n=db.nbcrna||{},a=db.aana||{},lic=db.licenses.find(x=>x.id===editId)||{},doc=db.documents.find(x=>x.id===editId)||{},nce=db.nbcrnaCE.find(x=>x.id===editId)||{},ace=db.aanaCE.find(x=>x.id===editId)||{},legacy=db.credentials.find(x=>x.id===editId)||{};
  const nbcrnaDays=daysUntil(n.renewalDeadline||n.periodEnd),aanaDays=daysUntil(a.expiration);
  // Connect card: the FINAL model leads — system sign-in sheet, Face ID,
  // no passwords in the app. The new-tab sign-in below it is a
  // clearly-labelled preview stand-in (class "standin"), not the design.
  const connCard=(title,desc,pulls,manualNote,siteLabel,siteUrl,portalKey,summary,forceOpen)=>{const st=cloudPortalState(portalKey);const meta=PORTAL_CHECK_SOURCES[portalKey]||{};const opened=portalOpened[portalKey];const duePrompt=ensurePortalMonitoring().some(m=>m.source===portalKey&&monitorPromptVisible(m,localDate(new Date())));const checkActive=!!(portalCheck&&portalCheck.source===portalKey);const panelOpen=!!(forceOpen||opened||portalLeaveSheet===portalKey||duePrompt||checkActive);return collapsePanelHTML('credentials-'+portalKey+'-panel',summary?title+' · '+summary:title,`<p><strong>Status: ${escapeHTML(st.label)}</strong>${st.detail?` — ${escapeHTML(st.detail)}`:''}</p><p class="muted">${desc}</p><p class="muted">${manualNote}</p><p class="muted">Sign in on the portal's own page: <a href="${siteUrl}" target="_blank" rel="noopener">${siteLabel}</a>. We never ask for your portal password.</p>${opened?`<p><strong>Signed in over there?</strong> One tap brings you back and starts your check.</p>`:''}<div class="toolbar"><a class="button" href="${siteUrl}" target="_blank" rel="noopener" data-portal-connect="${portalKey}">Connect ${title} — open portal</a>${opened?`<button type="button" data-action="portal-return" data-id="${portalKey}">I’m back — run my check</button>`:''}<button type="button" class="secondary" data-action="assistant-portal-check" data-id="${title}">I signed in — check it</button><a class="button secondary" href="${siteUrl}" target="_blank" rel="noopener">Open in Safari</a></div>${portalLeaveSheet===portalKey?`<div class="item"><p><strong>One sec — the portal opens outside CRNA Hub.</strong></p><p class="muted">Over there: sign in, then screenshot the page that shows your record.</p><p class="muted">CRNA Hub stays right here — come back to this tab and your check picks up where you left off.</p><div class="toolbar"><button type="button" data-action="portal-leave-go" data-id="${portalKey}">Take me to ${title}</button><button type="button" class="secondary" data-action="portal-leave-cancel">Not now</button></div></div>`:''}`,panelOpen)};
  const nbcrnaManual=(n.status||n.number||n.renewalDeadline||n.periodEnd)?'Record on file — entered by hand, not verified.':'No record on file yet.';
  const aanaManual=(a.status||a.number||a.expiration)?'Record on file — entered by hand, not verified.':'No record on file yet.';
  const licManual=db.licenses.length?db.licenses.length+' license record(s) on file — entered by hand, not verified.':'No license records on file yet.';
  // One manual-entry form: the dropdown picks the type, and only that type's
  // fields are rendered. Saving uses the exact same data-kind and field names
  // as the old separate forms, so records land in the same store/table.
  const manualKind = (manualType==='NBCRNA CE')?'nbcrnaCE':(manualType==='AANA CE')?'aanaCE':(manualType==='State license')?'licenses':(manualType==='Other credential')?'credentials':(manualType==='AANA')?'aana':'nbcrna';
  let manualForm='', manualList='';
  if(manualType==='NBCRNA'){
    manualForm=`<form data-kind="nbcrna"><div class="form-grid">${select('status','Certification status',['','Certified','Pending','Expired','Not certified'],n.status||'')}${field('number','Certification number (optional)','text',n.number||'')}${field('periodStart','Certification period start','date',n.periodStart||'')}${field('periodEnd','Certification period end','date',n.periodEnd||'')}${field('renewalDeadline','Renewal / recertification deadline','date',n.renewalDeadline||'')}${field('checkStatus','CPC / MAC Check status','text',n.checkStatus||'')}${field('classA','Class A credits earned','number',n.classA??'','min="0" step="0.25"')}${field('classB','Class B credits earned','number',n.classB??'','min="0" step="0.25"')}${field('macEd','MAC Ed credits earned','number',n.macEd??'','min="0" step="0.25"')}${field('macDev','MAC Dev credits earned','number',n.macDev??'','min="0" step="0.25"')}${field('macEdRequired','MAC Ed credits required','number',n.macEdRequired??60,'min="0" step="1"')}${field('macDevRequired','MAC Dev credits required','number',n.macDevRequired??40,'min="0" step="1"')}${field('reminders','Reminder windows (days, comma-separated)','text',n.reminders||'90,60,30,7')}${field('docNote','Supporting document note (filename only)','text',n.docNote||'')}${area('ceNote','CE notes',n.ceNote||'')}</div>${formEnd('Save NBCRNA record')}</form>`;
    manualList=`<p class="muted">Official site: <a href="https://www.nbcrna.com/" target="_blank" rel="noopener">nbcrna.com</a> · ${portalSourceLabel(n.source||'user_entered', cloudSyncTimes.nbcrna)} · Status shown: ${escapeHTML(n.status||'Not entered')}${nbcrnaDays!==null?` · Renewal in ${nbcrnaDays<0?Math.abs(nbcrnaDays)+' days overdue':nbcrnaDays+' days'}`:''}</p>`;
  } else if(manualType==='AANA'){
    manualForm=`<form data-kind="aana"><div class="form-grid">${select('status','Membership status',['','Active','Lapsed','Pending','Not a member'],a.status||'')}${field('number','Membership number (optional)','text',a.number||'')}${field('expiration','Membership expiration','date',a.expiration||'')}${field('reminders','Reminder windows (days, comma-separated)','text',a.reminders||'90,60,30,7')}${field('docNote','Supporting document note (filename only)','text',a.docNote||'')}${area('ceNote','CE documentation notes',a.ceNote||'')}</div>${formEnd('Save AANA record')}</form>`;
    manualList=`<p class="muted">Kept separate from NBCRNA certification. Official site: <a href="https://www.aana.com/" target="_blank" rel="noopener">aana.com</a> · ${portalSourceLabel(a.source||'user_entered', cloudSyncTimes.aana)} · Status shown: ${escapeHTML(a.status||'Not entered')}${aanaDays!==null?` · Expires in ${aanaDays<0?Math.abs(aanaDays)+' days overdue':aanaDays+' days'}`:''}</p>`;
  } else if(manualType==='State license'){
    manualForm=`<form data-kind="licenses"><div class="form-grid">${select('state','State',US_STATES,lic.state||'West Virginia')}${select('type','License type',['RN','APRN'],lic.type||'RN')}${select('status','License status',['','Active','Expired','Lapsed','Pending'],lic.status||'')}${field('number','License number','text',lic.number||'')}${field('issue','Issue date','date',lic.issue||'')}${field('expiry','Expiration date','date',lic.expiry||'','required')}${field('portal','Official board portal (URL or name)','text',lic.portal||'')}${field('reminders','Reminder windows (days, comma-separated)','text',lic.reminders||'90,60,30,7')}${area('note','Notes',lic.note||'')}</div>${formEnd(editId&&db.licenses.some(x=>x.id===editId)?'Save license':'Add license')}</form>`;
    manualList=list('licenses',db.licenses.slice().sort((a,b)=>a.expiry.localeCompare(b.expiry)),x=>{const d=daysUntil(x.expiry);return `<strong>${escapeHTML(x.state||'')} ${escapeHTML(x.type||'')}</strong>${x.status?' · '+escapeHTML(x.status):''} · ${x.number?escapeHTML(x.number)+' · ':''}${fmt(x.expiry)} · ${portalSourceLabel(x.source||'user_entered', '')} <span class="${d!==null&&d<0?'expired':d!==null&&d<=7?'expired':d!==null&&d<=30?'warning':'success'}">${d===null?'':d<0?('Expired '+Math.abs(d)+' days ago'):d===0?'Due today':('Due in '+d+' days')}</span><div class="muted">${portalLink(x.portal)} ${escapeHTML(x.note||'')}</div>`});
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
  return `${onboardDirectionHTML(4)}<p class="hint">Tap Connect and sign in on the portal’s own page — we never see your password.${profileName()?` Portal records are matched to the name from step 1 — “${escapeHTML(profileName())}”.`:``} Records a check brings back are labelled with their source; the rest is user-entered, not verified.</p>
  ${monitorDuePromptsHTML()}
  ${connCard('NBCRNA','National Board of Certification and Recertification for Nurse Anesthetists — your certification record.','certification status, certification period, renewal / recertification deadline, MAC Ed / MAC Dev progress, and CPC check-in status.',nbcrnaManual,'portal.nbcrna.com','https://portal.nbcrna.com/','nbcrna',[n.status,(n.periodEnd||n.renewalDeadline)?('ends '+fmt(n.periodEnd||n.renewalDeadline)):''].filter(Boolean).join(' · '),!(n.status||n.number||n.periodEnd||n.renewalDeadline))}
  ${connCard('AANA','American Association of Nurse Anesthesiology — your membership and CE transcript. Kept separate from NBCRNA certification.','membership status, membership expiration, and CE transcript totals (Class A / Class B).',aanaManual,'aana.com/login','https://www.aana.com/login','aana',[a.status,a.expiration?('expires '+fmt(a.expiration)):''].filter(Boolean).join(' · '),!(a.status||a.number||a.expiration))}
  ${portalMonitoringHTML()}
  ${connCard('State Licenses','State boards of nursing — RN and APRN licenses, one connection per state you hold a license in.','license status, license type (RN / APRN), license number, issue date, and expiration date.',licManual,'State board portals (per license, below)','https://www.nursys.com/','licenses',db.licenses.length?(db.licenses.length+' on file'+(()=>{const e=db.licenses.map(x=>x.expiry).filter(Boolean).sort()[0];return e?(' · next expiry '+fmt(e)):''})()):'',!db.licenses.length)}
  ${documentsSection(doc)}
  ${collapsePanelHTML('credentials-manual-panel','Manual entry',`<p class="muted">The backup path — for when a portal check hasn't run. Records saved here are user-entered, not verified.</p>
  <div class="form-grid"><div class="field"><label for="f_manualType">Entry type</label><select id="manualTypeSelect" name="manualType"><option value="NBCRNA" ${manualType==='NBCRNA'?'selected':''}>NBCRNA</option><option value="AANA" ${manualType==='AANA'?'selected':''}>AANA</option><option value="State license" ${manualType==='State license'?'selected':''}>State license</option><option value="NBCRNA CE" ${manualType==='NBCRNA CE'?'selected':''}>NBCRNA CE record</option><option value="AANA CE" ${manualType==='AANA CE'?'selected':''}>AANA CE record</option><option value="Other credential" ${manualType==='Other credential'?'selected':''}>Other credential</option></select></div></div>
  ${manualForm}
  ${manualList}`,!!(editId&&((db.licenses||[]).some(x=>x.id===editId)||(db.nbcrnaCE||[]).some(x=>x.id===editId)||(db.aanaCE||[]).some(x=>x.id===editId)||(db.credentials||[]).some(x=>x.id===editId))))}`+featureTurnOffLineHTML('featureCredentials');
}
// --- Home address + automatic mileage ---
// The user enters a home address once (Account tab, also shown here); the
// app then calculates round-trip driving mileage from home to a facility's
// saved address. Distances come from public, no-key services the web
// preview can actually reach: Nominatim (OpenStreetMap), falling back to
// Esri ArcGIS World Geocoding, for geocoding, and OSRM for driving
// distance. No distance is ever invented: if either
// address cannot be geocoded or the route cannot be computed, the result
// is null and the mileage is left blank / flagged for manual entry.
// Auto-calculated mileage is always editable per trip — editing it marks
// the trip as a manual override — and it feeds the same totals and CSV
// export as manually entered miles. Geocoded coordinates are cached on
// the facility record and in settings so repeat calculations do not
// re-query; the home address syncs with the user's settings, and is
// sent only to those two public services when a calculation is
// requested.
let mileageCalcStatus='',facilityDistanceStatus='',homeGeocodeStatus='',mileageClearStatus='';
// Session-only snapshot of the Log business mileage form (Caleb, Nov 7,
// 2026): render() snapshots the live form before rebuilding the page so
// a half-filled form survives re-renders (assistant sheet, sync merges)
// and its collapse panel reopens exactly as the user left it. Keyed by
// the edit context it was rendered for; never persisted.
let mileageFormDraft=null,mileageFormRenderedFor='',mileageDraftHold=false;
// Account-tab collapse state (Nov 6, 2026): the Profile and Addresses
// sections collapse to a one-line summary once filled in; Edit reopens
// the form, saving re-collapses. Session-only UI state, never persisted.
let profileEditing=false,addressesEditing=false;
const _geocodeCache=new Map();
async function geocodeAddress(addr){
  const q=String(addr||'').trim();if(!q)return null;
  if(_geocodeCache.has(q))return _geocodeCache.get(q);
  let out=null;
  try{
    const r=await fetch('https://nominatim.openstreetmap.org/search?format=json&limit=1&addressdetails=0&q='+encodeURIComponent(q),{headers:{'Accept':'application/json'}});
    if(r.ok){const j=await r.json(),hit=Array.isArray(j)&&j[0];
      if(hit&&Number.isFinite(Number(hit.lat))&&Number.isFinite(Number(hit.lon)))out={lat:Number(hit.lat),lon:Number(hit.lon),display:hit.display_name||q}}
  }catch(e){}
  if(!out){
    // Fallback: Esri ArcGIS World Geocoding (anonymous, no key). Nominatim
    // misses some newer US street addresses — a new subdivision, for
    // example — that ArcGIS finds exactly. Only a strong match (score 80+)
    // is accepted; anything weaker leaves the address unlocated rather
    // than guessing a nearby one.
    try{
      const r=await fetch('https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/findAddressCandidates?f=json&singleLine='+encodeURIComponent(q)+'&maxLocations=1&outFields=Match_addr');
      if(r.ok){const j=await r.json(),c=j&&j.candidates&&j.candidates[0];
        if(c&&c.location&&Number.isFinite(Number(c.location.y))&&Number.isFinite(Number(c.location.x))&&(c.score==null||c.score>=80))out={lat:Number(c.location.y),lon:Number(c.location.x),display:c.address||q}}
    }catch(e){}
  }
  _geocodeCache.set(q,out);return out;
}
async function drivingMilesOneWay(a,b){
  try{
    const r=await fetch('https://router.project-osrm.org/route/v1/driving/'+a.lon+','+a.lat+';'+b.lon+','+b.lat+'?overview=false');
    if(!r.ok)return null;
    const j=await r.json(),route=j&&j.routes&&j.routes[0];
    if(!route||typeof route.distance!=='number')return null;
    const miles=route.distance/1609.344;
    return (Number.isFinite(miles)&&miles>0)?Math.round(miles*10)/10:null;
  }catch(e){return null}
}
function roundTripMiles(oneWay){return Math.round(Number(oneWay||0)*2*10)/10}
function canAutoMileage(f,originAddr){const origin=String(originAddr!==undefined?originAddr:(db.settings&&db.settings.homeAddress)||'').trim();return !!origin&&!!String((f&&f.address)||'').trim()}
// One-way driving miles from an origin address to a facility, or null when
// it cannot be computed (missing address, geocode failure, or routing
// failure). The origin defaults to the saved home address; pass a hotel
// address to calculate hotel-based mileage instead. Never falls back to a
// straight-line estimate — a guessed number is worse than a blank one.
// The diagnostic twin reports WHY a calculation failed, so the weekly
// review can tell the user exactly which address is missing or could not
// be found instead of silently producing nothing. (Found live, Nov 7,
// 2026: all 7 of Caleb's Holzer trips calculated 0 with no reason given —
// his Holzer facility record, auto-created from his calendar, had never
// been given an address, and every failure path swallowed that fact.)
// Resolves {oneWay} on success, or {error} with one of: 'origin-missing'
// (no home/hotel address to start from), 'address-missing' (the facility
// has no address saved), 'origin-not-found' / 'address-not-found' (the
// geocoder could not locate that address; the address is included), or
// 'route-failed' (both endpoints located but no driving route came back).
async function mileageRouteDiagnostic(f,originAddr){
  const home=String(originAddr!==undefined?originAddr:(db.settings&&db.settings.homeAddress)||'').trim();
  const dest=String((f&&f.address)||'').trim();
  if(!home)return {error:'origin-missing'};
  if(!dest)return {error:'address-missing'};
  const isHome=!originAddr||home===String((db.settings&&db.settings.homeAddress)||'').trim();
  let h=null;
  if(isHome&&db.settings.homeLat&&db.settings.homeLng&&db.settings.homeGeocodedAddress===home)h={lat:+db.settings.homeLat,lon:+db.settings.homeLng};
  else{h=await geocodeAddress(home);if(!h)return {error:'origin-not-found',address:home};if(isHome){db.settings.homeLat=String(h.lat);db.settings.homeLng=String(h.lon);db.settings.homeGeocodedAddress=home;persist()}}
  let d=null;
  if(f&&f.lat&&f.lng&&f.geocodedAddress===dest)d={lat:+f.lat,lon:+f.lng};
  else{d=await geocodeAddress(dest);if(!d)return {error:'address-not-found',address:dest};if(f){f.lat=String(d.lat);f.lng=String(d.lon);f.geocodedAddress=dest;persist()}}
  const miles=await drivingMilesOneWay(h,d);
  return miles==null?{error:'route-failed'}:{oneWay:miles};
}
async function homeToFacilityMiles(f,originAddr){
  const r=await mileageRouteDiagnostic(f,originAddr);
  return r&&r.oneWay!=null?{oneWay:r.oneWay}:null;
}
// One plain sentence naming what a failed calculation needs, so a result
// dialog or the review itself can say it instead of a bare "0 created".
// fail: {reason, facility, address, origin} — origin 'home'|'hotel'|'other'.
function mileageCalcFailureText(fail){
  const fname=String((fail&&fail.facility)||'This facility');
  const originWord=fail&&fail.origin==='hotel'?'hotel':(fail&&fail.origin==='other'?'starting':'home');
  switch(fail&&fail.reason){
    case 'address-missing':return fname+' has no address saved — add it below and tap Calculate again.';
    case 'origin-missing':return 'No '+originWord+' address is saved — add it below and tap Calculate again.';
    case 'address-not-found':return 'The address saved for '+fname+' (“'+String(fail.address||'')+'”) could not be found — fix it below and tap Calculate again.';
    case 'origin-not-found':return 'Your '+originWord+' address (“'+String(fail.address||'')+'”) could not be found — fix it below and tap Calculate again.';
    case 'route-failed':return 'The driving route to '+fname+' could not be calculated just now — tap Calculate again, or enter the miles manually.';
    case 'facility-missing':{const near=facilityNearMatch(fname);if(near)return 'These trips say “'+fname+'”, which is not a saved facility name — but “'+near.name+'” is saved and looks like the match. Link them in the review below to calculate.';return 'No facility named '+fname+' is saved yet — add it on the Facilities tab.'}
    default:return 'Miles for '+fname+' could not be calculated.';
  }
}
// --- Hotel stays (one address reused for a whole block of shifts) ---
// A stay covers a date range (check-in to check-out) and optionally one
// facility; a blank facility means the stay applies to any facility in
// that range. Mileage for shifts inside a stay is calculated from the
// HOTEL address, not home. The most recently used hotel address is also
// remembered in settings so a new trip can reuse it without re-typing.
function hotelStayFor(date,facilityName){
  const d=String(date||'');if(!/^\d{4}-\d{2}-\d{2}$/.test(d))return null;
  return (db.hotelStays||[]).find(s=>{
    if(!s||!String(s.hotelAddress||'').trim())return false;
    if(s.checkIn&&d<s.checkIn)return false;
    if(s.checkOut&&d>s.checkOut)return false;
    if(String(s.facility||'').trim()){
      const f=facilityByNameOrAlias(facilityName);
      const sf=facilityByNameOrAlias(s.facility);
      if(!f||!sf||sf.id!==f.id)return false;
    }
    return true;
  })||null;
}
function knownHotelAddresses(){
  const seen=new Set(),out=[];
  const add=a=>{const s=String(a||'').trim();if(s&&!seen.has(s.toLowerCase())){seen.add(s.toLowerCase());out.push(s)}};
  add(db.settings&&db.settings.hotelAddress);
  add(db.settings&&db.settings.lastHotelAddress);
  (db.hotelStays||[]).forEach(s=>add(s.hotelAddress));
  (db.mileage||[]).forEach(m=>add(m.hotelAddress));
  return out;
}
// Synchronous fallback used by drafts and tests: the facility's manually
// entered one-way distance, or null when there is none.
function effectiveOneWayMiles(f){return rateOrNull(f&&f.distance)}
// Pure draft builder (no network): null when the trip cannot be priced
// from a distance — the caller reports the skip instead of inventing miles.
// origin is 'home' or 'hotel'; a hotel draft records the hotel address it
// was calculated from so home-based and hotel-based trips stay apart.
function mileageDraftForShift(x,f,oneWay,source,origin,hotelAddress,tripType){
  if(!f||!(oneWay>0))return null;
  if(/off|pto/i.test(x.type||''))return null;
  const o=origin==='hotel'?'hotel':origin==='other'?'other':'home';
  const t=tripType==='one-way'?'one-way':'round-trip';
  const miles=tripMilesFor(oneWay,t);
  if(miles==null)return null;
  return {id:id(),date:x.date,purpose:'Scheduled facility trip: '+f.name,facility:f.name,facilityId:f.id,...defaultVehicleStamp(),miles:String(miles),status:'draft',milesSource:source,origin:o,hotelAddress:(o==='hotel'||o==='other')?String(hotelAddress||''):'' ,tripType:t,oneWayMiles:String(Math.round(Number(oneWay)*10)/10)};
}

// --- Weekly mileage review (one screen per Mon-Sun week) ---
// Caleb chose a weekly review (Nov 5, 2026): one screen each week to
// confirm all trips, not a daily confirm. A week's trips are auto-drafted
// from that week's shifts (Mon-Sun): origin guessed home by default, or
// the hotel address when a hotel stay covers the shift date, with
// auto-calculated miles (round trip by default, per the mileage type).
// A trip whose distance cannot be computed is drafted with BLANK miles
// and milesSource 'needs-manual' — flagged for manual entry, never
// guessed. Confirming the whole week moves drafts to verified; only
// verified trips count in mileage totals and exports. A trip confirmed
// with a changed origin keeps that origin for that trip only — no hard
// rule is created. Reviews and prompts scope to the current month
// (see currentMonthStart below); past weeks stay reachable through the
// week picker, and pre-month unconfirmed trips can be cleared in one tap.
let mileageReviewWeek='';
let mileageLogMonth='';
let callOriginPromptDismissed=new Set();
function weekStartISO(dateStr){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(String(dateStr||'')))return '';
  const d=new Date(String(dateStr)+'T12:00:00');
  if(Number.isNaN(d.getTime()))return '';
  d.setDate(d.getDate()-((d.getDay()+6)%7));
  return localDate(d);
}
function weekEndISO(start){return addDaysISO(start,6)}
function weekRangeLabel(start){
  const s=new Date(String(start||'')+'T12:00:00'),e=new Date(weekEndISO(start)+'T12:00:00');
  if(Number.isNaN(s.getTime())||Number.isNaN(e.getTime()))return String(start||'');
  const mo=d=>d.toLocaleDateString('en-US',{month:'short'});
  if(s.getFullYear()===e.getFullYear()&&s.getMonth()===e.getMonth())return mo(s)+' '+s.getDate()+'\u2013'+e.getDate();
  if(s.getFullYear()===e.getFullYear())return mo(s)+' '+s.getDate()+'\u2013'+mo(e)+' '+e.getDate();
  return mo(s)+' '+s.getDate()+', '+s.getFullYear()+'\u2013'+mo(e)+' '+e.getDate()+', '+e.getFullYear();
}
function monthLabel(prefix){
  const d=new Date(String(prefix||'')+'-15T12:00:00');
  if(Number.isNaN(d.getTime()))return String(prefix||'');
  return d.toLocaleDateString('en-US',{month:'long',year:'numeric'});
}
function shiftsInWeek(start){
  const end=weekEndISO(start);
  return (db.shifts||[]).filter(x=>String(x.date||'')>=start&&String(x.date||'')<=end&&!/off|pto/i.test(x.type||'')).sort((a,b)=>String(a.date||'').localeCompare(String(b.date||'')));
}
function mileageWeeks(){
  const seen=new Set();
  for(const x of (db.shifts||[])){
    if(!x||!/^\d{4}-\d{2}-\d{2}$/.test(String(x.date||'')))continue;
    if(/off|pto/i.test(x.type||''))continue;
    const w=weekStartISO(x.date);
    if(w)seen.add(w);
  }
  return [...seen].sort().reverse();
}
function mileageTripsInWeek(start){
  const end=weekEndISO(start);
  return (db.mileage||[]).filter(x=>String(x.date||'')>=start&&String(x.date||'')<=end).sort((a,b)=>String(a.date||'').localeCompare(String(b.date||'')));
}
function mileageTripMatchesShift(m,shift){
  if(String(m.date||'')!==String(shift.date||''))return false;
  if(m.facilityId&&shift.facilityId)return m.facilityId===shift.facilityId;
  return facilityNameKey(m.facility)===facilityNameKey(shift.facility);
}
function weeklyMileageReview(start,todayStr){
  const end=weekEndISO(start),today=todayStr||localDate(new Date());
  const shifts=shiftsInWeek(start),trips=mileageTripsInWeek(start);
  const drafts=trips.filter(x=>x.status==='draft');
  const verified=trips.filter(x=>x.status==='verified');
  const skipped=trips.filter(x=>x.status==='skipped');
  const dismissed=trips.filter(x=>x.status==='dismissed');
  const missing=shifts.filter(sh=>!trips.some(t=>mileageTripMatchesShift(t,sh)));
  const needsMiles=drafts.filter(x=>!(num(x.miles)>0));
  const toReview=drafts.length+missing.length;
  return {start:start,end:end,shifts:shifts,trips:trips,drafts:drafts,verified:verified,skipped:skipped,dismissed:dismissed,missing:missing,needsMiles:needsMiles,toReview:toReview,allConfirmed:shifts.length>0&&toReview===0,due:toReview>0&&today>=end,overdue:toReview>0&&today>end};
}
// Mileage reviews and prompts look at the CURRENT month (Caleb, Nov 6,
// 2026): when the app loads, only this month's trips are presented for
// review — older unconfirmed trips stop surfacing as notifications and
// can be cleared in one tap (clearMileageBacklog below). Past weeks stay
// reachable through the review's week picker, and confirmed trips are
// never touched by the scoping or the clear.
function currentMonthStart(todayStr){
  const t=/^\d{4}-\d{2}-\d{2}$/.test(String(todayStr||''))?String(todayStr):localDate(new Date());
  return t.slice(0,7)+'-01';
}
function nextMonthStart(todayStr){
  const d=new Date(currentMonthStart(todayStr)+'T12:00:00');
  d.setMonth(d.getMonth()+1);
  return localDate(d);
}
function unconfirmedTripsBeforeMonth(todayStr){
  const start=currentMonthStart(todayStr);
  return (db.mileage||[]).filter(x=>x.status==='draft'&&/^\d{4}-\d{2}-\d{2}$/.test(String(x.date||''))&&String(x.date)<start);
}
// One-tap clear of the pre-month backlog: drafts become 'dismissed' —
// kept in the data (recoverable via Restore in the weekly review or the
// trip log's Edit), but out of review, out of prompts, and never counted
// in totals or exports (only verified trips count). Confirmed trips are
// untouched.
function clearMileageBacklog(todayStr){
  const old=unconfirmedTripsBeforeMonth(todayStr);
  for(const m of old){m.status='dismissed';m.dismissedAt=todayStr||localDate(new Date())}
  if(old.length)persist();
  return old.length;
}
function dueMileageWeeks(todayStr){
  const today=todayStr||localDate(new Date());
  const mStart=currentMonthStart(today),nStart=nextMonthStart(today);
  return mileageWeeks().map(w=>weeklyMileageReview(w,today)).filter(r=>r.due&&r.end>=mStart&&r.start<nStart).sort((a,b)=>a.start.localeCompare(b.start));
}
function mileageReviewStatusLine(start,todayStr){
  const r=weeklyMileageReview(start,todayStr);
  return r.allConfirmed?('Week of '+weekRangeLabel(start)+': All confirmed'):('Week of '+weekRangeLabel(start)+': '+r.toReview+' trip'+(r.toReview===1?'':'s')+' to review');
}
function selectedMileageReviewWeek(todayStr){
  const weeks=mileageWeeks();
  const today=todayStr||localDate(new Date());
  if(!weeks.length)return weekStartISO(today);
  if(mileageReviewWeek&&weeks.includes(mileageReviewWeek))return mileageReviewWeek;
  const due=dueMileageWeeks(today);
  if(due.length)return due[0].start;
  const cur=weekStartISO(today);
  if(weeks.includes(cur))return cur;
  return weeks[0];
}
function verifiedMileageTrips(){return (db.mileage||[]).filter(x=>x.status==='verified')}
function verifiedMileageTotal(){return verifiedMileageTrips().reduce((s,x)=>s+num(x.miles),0)}
function mileageWeekTotal(todayStr){const t=/^\d{4}-\d{2}-\d{2}$/.test(String(todayStr||''))?String(todayStr):localDate(new Date());const start=weekStartISO(t),end=weekEndISO(start);return verifiedMileageTrips().filter(m=>String(m.date||'')>=start&&String(m.date||'')<=end).reduce((s,x)=>s+num(x.miles),0)}
function mileageYearTotal(todayStr){const y=String(todayStr||localDate(new Date())).slice(0,4);return verifiedMileageTrips().filter(m=>String(m.date||'').slice(0,4)===y).reduce((s,x)=>s+num(x.miles),0)}
// Mileage header stats (Nov 7, 2026): this week + year to date at the
// very top of the Mileage tab, in the Dashboard's stat style. Confirmed
// ('verified') trips only — the standing rule — summed from ALL
// confirmed trips rather than the review's current-month presentation,
// and recomputed on every render, so confirming a week moves them.
function mileageHeaderHTML(){const wk=mileageWeekTotal(),yr=mileageYearTotal();return `<section class="panel"><div class="stats"><div class="stat"><strong>${wk.toFixed(1)} mi</strong>This week</div><div class="stat"><strong>${yr.toFixed(1)} mi</strong>Year to date</div></div><p class="muted">Confirmed trips only.</p></section>`}
// --- Vehicles (Nov 7, 2026) -------------------------------------------
// QuickBooks-style saved vehicles, managed on the Mileage tab. A trip
// carries vehicleId (the link) AND vehicleName (a text snapshot), so
// deleting a vehicle never breaks a trip's history — the name stays on
// the trip. Exactly one vehicle may be the default; NEW trips are
// stamped with it, existing trips are never backfilled. Vehicles sync
// to the cloud like facilities (migration 012).
function defaultVehicle(){return (db.vehicles||[]).find(v=>v.isDefault)||null}
function vehicleById(vid){return (db.vehicles||[]).find(v=>v.id===vid)||null}
function tripVehicleLabel(m){const v=m&&m.vehicleId?vehicleById(m.vehicleId):null;if(v)return String(v.name||'');return String((m&&m.vehicleName)||'')}
function defaultVehicleStamp(){const v=defaultVehicle();return {vehicleId:v?v.id:'',vehicleName:v?String(v.name||''):''}}
// "Same vehicle for all days" (Nov 7, 2026): the weekly review's week
// control is an explicit all-days apply. Picking a vehicle there and
// tapping Apply sets EVERY trip in the week to that vehicle —
// deliberately overriding any per-day picks for that week, because
// the user asked for all days. Per-day picks made afterwards are
// later deliberate choices and stand until the user applies all-days
// again. Applying never touches a trip's status or miles, so an
// already-confirmed week stays confirmed with its totals unchanged,
// and because a changed trip's record changes, the normal cloud sync
// re-uploads it with the vehicle set. Cleared ('dismissed') trips are
// no longer part of the week and are left alone.
let mileageReviewVehicleWeek='',mileageReviewVehicleId='';
function mileageReviewVehicleForWeek(start){return mileageReviewVehicleWeek===start?mileageReviewVehicleId:''}
function stampWeekVehicle(start,vehicleId){
  const v=vehicleById(vehicleId);if(!v)return 0;
  const end=weekEndISO(start);let n=0;const changedIds=[];
  for(const m of (db.mileage||[])){
    if(String(m.date||'')<start||String(m.date||'')>end)continue;
    if(m.status==='dismissed')continue;
    if(m.vehicleId===v.id&&String(m.vehicleName||'')===String(v.name||''))continue;
    m.vehicleId=v.id;m.vehicleName=String(v.name||'');n++;changedIds.push(m.id);
  }
  if(n>0){persist();for(const cid of changedIds)cloudSaveKind('mileage',cid)}
  return n;
}
function vehicleDetailLine(v){return [v.year,v.make,v.model].map(s=>String(s||'').trim()).filter(Boolean).join(' ')}
function mileageVehicleField(x){const vs=db.vehicles||[];if(vs.length<2)return '';const cur=(x&&x.vehicleId)||'';const val=cur||(!(x&&x.id)&&defaultVehicle()?defaultVehicle().id:'');return selectLabeled('vehicleId','Vehicle',[['','No vehicle']].concat(vs.map(v=>[v.id,String(v.name||'')])),val)}
function vehiclesPanelHTML(){const vs=db.vehicles||[];const veh=editId?vs.find(v=>v.id===editId):null;const x=veh||{};const inner=`<p class="muted">Trips use your default vehicle \u2014 change it on any trip.</p><form data-kind="vehicles"><div class="form-grid">${field('name','Vehicle name','text',x.name||'','required placeholder="e.g. 2022 Silverado"')}${field('make','Make','text',x.make||'')}${field('model','Model','text',x.model||'')}${field('year','Year','text',x.year||'','inputmode="numeric" placeholder="e.g. 2022"')}<div class="field"><label for="f_isDefault">Default vehicle</label><input id="f_isDefault" name="isDefault" type="checkbox" value="on" ${x.isDefault||(!veh&&!vs.length)?'checked':''}></div></div>${formEnd(veh?'Save vehicle':'Add vehicle')}</form>${vs.length?vs.map(v=>`<div class="item"><div><div class="item-title">${escapeHTML(v.name)}${v.isDefault?' <span class="pill">Default</span>':''}</div>${vehicleDetailLine(v)?`<div class="muted">${escapeHTML(vehicleDetailLine(v))}</div>`:''}</div><div class="item-actions">${v.isDefault?'':`<button class="tiny secondary" data-action="vehicle-default" data-id="${escapeHTML(v.id)}">Make default</button>`}<button class="tiny secondary" data-action="edit-vehicles" data-id="${escapeHTML(v.id)}">Edit</button><button class="tiny danger" data-action="delete-vehicles" data-id="${escapeHTML(v.id)}">Delete</button></div></div>`).join(''):'<p class="muted">No vehicles yet.</p>'}`;return collapsePanelHTML('vehicles-panel','Vehicles',inner,!!veh)}
// --- Mileage export: pick the months (Nov 7, 2026) ---
// The old export was one tap = every confirmed trip ever. That
// double-counts for anyone who tracked mileage elsewhere before
// starting with CRNA Hub (Caleb's case: tracked elsewhere up to
// today), so exporting now goes through ONE picker shared by the
// Mileage tab and Account > Backup & restore: choose the months,
// see the live total, then download a CSV of exactly those months'
// CONFIRMED trips. The mid-year start is the design center: the
// default is the current month only, earlier months are simply not
// selected (never nagged about), and January is never assumed.
const MILEAGE_EXPORT_HEADERS=['date','facility','purpose','miles','tripType','oneWayMiles','milesSource','origin','hotelAddress','status','vehicle'];
const MONTH_SHORT=['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
let mileageExportYear='',mileageExportSel=null,mileageExportOpen=false;
function mileageExportMonths(year){
  const y=String(year||'');
  const byMonth={};
  for(const m of (db.mileage||[])){
    const prefix=String(m.date||'').slice(0,7);
    if(prefix.slice(0,4)!==y||!/^\d{4}-\d{2}$/.test(prefix))continue;
    const e=byMonth[prefix]||(byMonth[prefix]={prefix,trips:0,confirmed:0});
    e.trips++;
    if(m.status==='verified')e.confirmed++;
  }
  return Object.values(byMonth).sort((a,b)=>a.prefix.localeCompare(b.prefix));
}
function mileageExportYears(){
  const years=new Set(mileageExportMonthsAllYears());
  years.add(localDate(new Date()).slice(0,4));
  return [...years].sort().reverse();
}
function mileageExportMonthsAllYears(){
  const s=new Set();
  for(const m of (db.mileage||[])){
    const y=String(m.date||'').slice(0,4);
    if(/^\d{4}$/.test(y))s.add(y);
  }
  return [...s];
}
function mileageExportInit(){
  const cur=localDate(new Date()).slice(0,7);
  if(!mileageExportYear)mileageExportYear=cur.slice(0,4);
  if(!mileageExportSel)mileageExportSel=new Set([cur]);
}
function mileageExportSelected(){
  mileageExportInit();
  const months=mileageExportMonths(mileageExportYear);
  const enabled=new Set(months.filter(mo=>mo.confirmed>0).map(mo=>mo.prefix));
  return [...mileageExportSel].filter(p=>enabled.has(p)).sort();
}
function mileageExportTrips(prefixes){
  const set=new Set(prefixes||[]);
  return verifiedMileageTrips().filter(m=>set.has(String(m.date||'').slice(0,7)));
}
function mileageExportSummary(prefixes){
  const trips=mileageExportTrips(prefixes);
  return {months:(prefixes||[]).length,trips:trips.length,miles:Math.round(trips.reduce((s,x)=>s+num(x.miles),0)*10)/10};
}
function mileageExportFilename(prefixes){
  const sel=[...(prefixes||[])].sort();
  if(!sel.length)return 'mileage.csv';
  const yr=sel[0].slice(0,4),sameYear=sel.every(p=>p.slice(0,4)===yr);
  if(sel.length===1)return `mileage-${yr}-${MONTH_SHORT[+sel[0].slice(5,7)-1]}.csv`;
  const contiguous=sel.every((p,i)=>i===0||p===addMonthsPrefix(sel[i-1],1));
  if(sameYear&&contiguous)return `mileage-${yr}-${MONTH_SHORT[+sel[0].slice(5,7)-1]}-${MONTH_SHORT[+sel[sel.length-1].slice(5,7)-1]}.csv`;
  return `mileage-${sel[0]}-to-${sel[sel.length-1]}.csv`;
}
function addMonthsPrefix(prefix,n){
  const d=new Date(String(prefix||'')+'-15T12:00:00');
  if(Number.isNaN(d.getTime()))return prefix;
  d.setMonth(d.getMonth()+n);
  return localDate(d).slice(0,7);
}
function mileageExportTotalsLine(){
  const s=mileageExportSummary(mileageExportSelected());
  return `${s.months} month${s.months===1?'':'s'} · ${s.trips} trip${s.trips===1?'':'s'} · ${s.miles.toFixed(1)} mi`;
}
function mileageExportPickerHTML(){
  mileageExportInit();
  const years=mileageExportYears(),months=mileageExportMonths(mileageExportYear),sel=mileageExportSel;
  const curPrefix=localDate(new Date()).slice(0,7);
  const boxes=months.map(mo=>{
    const dis=mo.confirmed===0;
    return `<label class="mileage-month${dis?' disabled':''}"><input type="checkbox" class="mileageExportMonth" value="${escapeHTML(mo.prefix)}" ${sel.has(mo.prefix)&&!dis?'checked':''} ${dis?'disabled':''}> ${escapeHTML(monthLabel(mo.prefix).split(' ')[0])} <span class="muted">${dis?'no confirmed trips':mo.confirmed+' confirmed trip'+(mo.confirmed===1?'':'s')}</span></label>`;
  }).join('');
  return `<div class="mileage-export" id="mileageExportPicker"><h3>Export mileage — pick the months</h3><p class="muted">Only confirmed trips export — drafts, skipped and cleared trips never count.</p><div class="field"><label for="mileageExportYearSelect">Year</label><select id="mileageExportYearSelect">${years.map(y=>`<option value="${y}" ${y===mileageExportYear?'selected':''}>${y}</option>`).join('')}</select></div><div class="mileage-months">${boxes||'<p class="muted">No trips logged in '+escapeHTML(mileageExportYear)+' yet.</p>'}</div><div class="toolbar"><button type="button" class="secondary tiny" data-action="mileage-export-this-month">This month</button><button type="button" class="secondary tiny" data-action="mileage-export-ytd">Year to date</button><button type="button" class="secondary tiny" data-action="mileage-export-all">All</button><button type="button" class="secondary tiny" data-action="mileage-export-none">None</button></div><p><strong id="mileageExportTotals">${escapeHTML(mileageExportTotalsLine())}</strong></p><div class="form-actions"><button type="button" data-action="mileage-export-download" ${mileageExportSelected().length?'':'disabled'}>Download mileage CSV</button><button type="button" class="secondary" data-action="mileage-export-close">Close</button></div></div>`;
}
function mileageExportApplyQuick(kind){
  mileageExportInit();
  const cur=localDate(new Date()).slice(0,7),months=mileageExportMonths(mileageExportYear);
  const enabled=months.filter(mo=>mo.confirmed>0).map(mo=>mo.prefix);
  if(kind==='this-month'){mileageExportSel=new Set(enabled.includes(cur)?[cur]:[]);return}
  if(kind==='ytd'){mileageExportSel=new Set(enabled.filter(p=>p<=cur));return}
  if(kind==='all'){mileageExportSel=new Set(enabled);return}
  if(kind==='none'){mileageExportSel=new Set();return}
}
function mileageExportDownload(){
  const sel=mileageExportSelected();
  if(!sel.length)return;
  const trips=mileageExportTrips(sel).slice().sort((a,b)=>String(a.date||'').localeCompare(String(b.date||'')));
  exportCsv(mileageExportFilename(sel),MILEAGE_EXPORT_HEADERS,trips.map(m=>({...m,vehicle:tripVehicleLabel(m)})));
}
// The address a trip's distance is calculated FROM, decided by the
// trip's own saved origin — the per-shift choice the user picked (day
// view, weekly review, or the trip form). 'home' -> the saved home
// address; 'hotel' -> the trip's hotel address, else the saved hotel
// address on the Account tab, else the covering stay's address, else
// the last-used hotel address; 'other' -> the trip's own address.
// NEVER derived from the shift type: a call shift is not assumed to
// start from a hotel.
function tripOriginAddress(m){
  if(!m)return '';
  if(m.origin==='hotel'){
    const stay=hotelStayFor(m.date,m.facility);
    return String(m.hotelAddress||'').trim()||String((db.settings&&db.settings.hotelAddress)||'').trim()||(stay?String(stay.hotelAddress||'').trim():'')||String((db.settings&&db.settings.lastHotelAddress)||'').trim();
  }
  if(m.origin==='other')return String(m.hotelAddress||'').trim();
  return String((db.settings&&db.settings.homeAddress)||'').trim();
}
function mileageOriginLabel(m){
  if(m.origin==='hotel')return 'Hotel'+(m.hotelAddress?': '+m.hotelAddress:'');
  if(m.origin==='other')return m.hotelAddress||'Other address';
  return 'Home';
}
function mileageTripLine(x){
  const miles=num(x.miles)>0?escapeHTML(x.miles)+' mi':'miles not entered';
  const type=x.tripType==='one-way'?'one way':'round trip';
  return `<strong>${fmt(x.date)}</strong> \u00b7 ${miles} <span class="pill">${escapeHTML(x.status||'verified')}</span>${x.status==='draft'?' <span class="pill warn">needs weekly review</span>':''}${x.milesSource==='auto'?' <span class="pill">auto-calculated</span>':x.milesSource==='manual-override'?' <span class="pill">auto-calculated, edited by you</span>':x.milesSource==='needs-manual'?' <span class="pill warn">miles needed</span>':''}<div class="muted">${x.facility?escapeHTML(x.facility)+' \u00b7 ':''}${escapeHTML(mileageOriginLabel(x))} \u00b7 ${type}${tripVehicleLabel(x)?' \u00b7 '+escapeHTML(tripVehicleLabel(x)):''} \u00b7 ${escapeHTML(x.purpose)}</div>`;
}
// A draft for a shift whose distance cannot be computed: blank miles,
// flagged for manual entry. Never a guessed number.
function blankMileageDraftForShift(x,origin,hotelAddress){
  const o=origin==='hotel'?'hotel':'home';
  const f=facilityForRecord(x);
  return {id:id(),date:x.date,purpose:'Scheduled facility trip: '+String(x.facility||''),facility:String(x.facility||''),facilityId:f?f.id:'',...defaultVehicleStamp(),miles:'',status:'draft',milesSource:'needs-manual',origin:o,hotelAddress:o==='hotel'?String(hotelAddress||''):'' ,tripType:mileageTripType(),oneWayMiles:''};
}
// Sync draft creation for one week: uses only the facility's saved
// one-way distance (home origin). A hotel stay's distance is NOT taken
// from the facility's home distance — a hotel draft with no auto
// calculation stays blank for manual entry. The async generator below
// tries the live geocode/route first.
function ensureWeeklyMileageDrafts(start){
  let created=0;
  for(const x of shiftsInWeek(start)){
    if((db.mileage||[]).some(m=>mileageTripMatchesShift(m,x)))continue;
    const f=facilityForRecord(x);
    const stay=hotelStayFor(x.date,x.facility);
    if(stay){
      db.mileage.push(blankMileageDraftForShift(x,'hotel',stay.hotelAddress));
    }else if(f&&effectiveOneWayMiles(f)>0){
      const draft=mileageDraftForShift(x,f,effectiveOneWayMiles(f),'manual','home','',mileageTripType());
      db.mileage.push(draft||blankMileageDraftForShift(x,'home',''));
    }else{
      db.mileage.push(blankMileageDraftForShift(x,'home',''));
    }
    created++;
  }
  if(created>0)persist();
  return created;
}
// Async draft creation for one week: tries the live driving-distance
// calculation (home, or the hotel address for a stay) first, falls back
// to the facility's saved one-way distance for home trips, and drafts
// blank for anything still uncomputable. Also upgrades blank drafts
// already in the week when the calculation now succeeds.
// The most recent Calculate run's failures for a week, kept so the
// review can show the fix (a missing/unfindable address input) right
// where the user is standing:
// {week, failures:[{reason, facility, address, origin}]}.
let mileageReviewCalcNote=null;
async function generateWeeklyMileageDrafts(start){
  weeklyMileageReview(start); // make sure every shift this week has a draft row first
  let created=0,auto=0,hotel=0,blank=0,filled=0;
  const failures=[],failSeen=new Set();
  const noteFail=(reason,facility,address,origin)=>{
    const key=reason+'|'+String(facility||'')+'|'+(origin||'home');
    if(failSeen.has(key))return;
    failSeen.add(key);
    failures.push({reason:reason,facility:String(facility||''),address:String(address||''),origin:origin==='hotel'?'hotel':(origin==='other'?'other':'home')});
  };
  // Fill one blank trip from a diagnostic result, falling back to the
  // facility's saved manual distance for home-based trips (the same
  // order the bulk generator uses). Returns true when the trip got miles.
  const fillTrip=(m,f,res)=>{
    let oneWay=null,source='';
    if(res&&res.oneWay!=null){oneWay=res.oneWay;source='auto'}
    else if(m.origin!=='hotel'&&m.origin!=='other'&&f){const man=effectiveOneWayMiles(f);if(man>0){oneWay=man;source='manual'}}
    if(!(oneWay>0))return false;
    const t=m.tripType==='one-way'?'one-way':'round-trip';
    m.oneWayMiles=String(oneWay);
    m.miles=String(tripMilesFor(oneWay,t));
    m.tripType=t;
    m.milesSource=source;
    filled++;
    if(source==='auto')auto++;
    return true;
  };
  for(const m of mileageTripsInWeek(start).filter(x=>x.status==='draft'&&!(num(x.miles)>0))){
    const f=facilityForRecord(m);
    if(!f){noteFail('facility-missing',m.facility,'',m.origin);blank++;continue}
    const addr=tripOriginAddress(m);
    if(m.origin==='hotel'&&addr&&!String(m.hotelAddress||'').trim())m.hotelAddress=addr;
    const res=await mileageRouteDiagnostic(f,addr||undefined);
    if(fillTrip(m,f,res))continue;
    noteFail(res.error||'route-failed',f.name,res.address||'',m.origin);
    blank++;
  }
  for(const x of shiftsInWeek(start)){
    if((db.mileage||[]).some(m=>mileageTripMatchesShift(m,x)))continue;
    const f=facilityForRecord(x);
    const stay=hotelStayFor(x.date,x.facility);
    let draft=null;
    if(!f)noteFail('facility-missing',x.facility,'',stay?'hotel':'home');
    else if(stay){const res=await mileageRouteDiagnostic(f,stay.hotelAddress);if(res.oneWay!=null){draft=mileageDraftForShift(x,f,res.oneWay,'auto','hotel',stay.hotelAddress,mileageTripType());if(draft){filled++;auto++;hotel++}}else noteFail(res.error||'route-failed',f.name,res.address||'','hotel')}
    else{const res=await mileageRouteDiagnostic(f);if(res.oneWay!=null){draft=mileageDraftForShift(x,f,res.oneWay,'auto','home','',mileageTripType());if(draft){filled++;auto++}}else if(effectiveOneWayMiles(f)>0){draft=mileageDraftForShift(x,f,effectiveOneWayMiles(f),'manual','home','',mileageTripType());if(draft)filled++}else noteFail(res.error||'route-failed',f.name,res.address||'','home')}
    if(draft){db.mileage.push(draft);created++;}
    else{db.mileage.push(blankMileageDraftForShift(x,stay?'hotel':'home',stay?stay.hotelAddress:''));created++;blank++;}
  }
  mileageReviewCalcNote={week:start,failures:failures};
  persist();render();
  const review=weeklyMileageReview(start);
  const scope=review.drafts.length,stillBlank=review.needsMiles.length,withMiles=scope-stillBlank;
  let msg;
  if(scope===0)msg='No trips to calculate for the week of '+weekRangeLabel(start)+'.';
  else{
    msg='Calculated miles for '+withMiles+' of '+scope+' trip(s) for the week of '+weekRangeLabel(start)+'.';
    if(stillBlank>0){
      msg+=' '+stillBlank+' still need'+(stillBlank===1?'s':'')+' miles';
      const texts=failures.map(mileageCalcFailureText);
      msg+=texts.length?(' — '+texts.join(' ')):' — enter them manually to confirm those trips.';
    }
    msg+=' Review the week and confirm all trips.';
  }
  alert(msg);
  return {created:created,auto:auto,hotel:hotel,blank:blank,calculated:filled,failures:failures};
}
function reviewInputValue(cls,tripId){
  if(typeof document==='undefined'||typeof document.querySelector!=='function')return null;
  const el=document.querySelector('.'+cls+'[data-trip="'+tripId+'"]');
  return el?el.value:null;
}
// Read the review screen's per-trip edits (origin, miles, trip type)
// into the draft records. Changing a trip's origin clears its miles —
// the old auto-calculated distance was for the old origin — unless new
// miles were typed in the same pass. No hard rule is created: the change
// applies to that trip only.
function applyMileageReviewEdits(start){
  let changed=0;const vehicleChanged=[];
  for(const m of weeklyMileageReview(start).drafts){
    const origin=reviewInputValue('reviewOrigin',m.id);
    const milesRaw=reviewInputValue('reviewMiles',m.id);
    const otherRaw=reviewInputValue('reviewOther',m.id);
    const typeRaw=reviewInputValue('reviewTripType',m.id);
    if(origin==='home'||origin==='hotel'||origin==='other'){
      if(origin!==m.origin){
        m.origin=origin;m.originChosen=true;
        m.miles='';m.oneWayMiles='';m.milesSource='needs-manual';
        const stay=hotelStayFor(m.date,m.facility);
        if(origin==='hotel')m.hotelAddress=(otherRaw!=null&&String(otherRaw).trim())?String(otherRaw).trim():(String(m.hotelAddress||'').trim()||(stay?String(stay.hotelAddress||'').trim():'')||String((db.settings&&db.settings.hotelAddress)||'').trim());
        else if(origin==='other'&&otherRaw!=null&&String(otherRaw).trim())m.hotelAddress=String(otherRaw).trim();
        else if(origin==='home')m.hotelAddress='';
        changed++;
      }else if(origin!=='home'&&otherRaw!=null&&String(otherRaw).trim()&&String(otherRaw).trim()!==String(m.hotelAddress||'')){
        m.hotelAddress=String(otherRaw).trim();changed++;
      }
    }
    if(typeRaw==='one-way'||typeRaw==='round-trip'){
      if(typeRaw!==m.tripType){
        if(Number(m.oneWayMiles)>0){m.miles=String(tripMilesFor(m.oneWayMiles,typeRaw));}
        else if(num(m.miles)>0){const ow=oneWayFromTripMiles(m.miles,m.tripType);if(ow!=null){m.oneWayMiles=String(ow);m.miles=String(tripMilesFor(ow,typeRaw));}}
        m.tripType=typeRaw;changed++;
      }
    }
    const vehRaw=reviewInputValue('reviewVehicle',m.id);
    if(vehRaw!=null&&vehRaw!==String(m.vehicleId||'')){const vv=vehicleById(vehRaw);m.vehicleId=vv?vv.id:'';m.vehicleName=vv?String(vv.name||''):'';changed++;vehicleChanged.push(m.id);}
    if(milesRaw!=null){
      const v=String(milesRaw).trim();
      if(v===''){
        if(String(m.miles||'')!==''){m.miles='';m.oneWayMiles='';changed++;}
      }else if(num(v)>0){
        const rounded=String(Math.round(num(v)*10)/10);
        if(rounded!==String(m.miles)){
          m.miles=rounded;
          m.oneWayMiles=String(oneWayFromTripMiles(rounded,m.tripType)||'');
          if(m.milesSource==='auto')m.milesSource='manual-override';
          else if(m.milesSource==='needs-manual')m.milesSource='manual';
          changed++;
        }
      }
    }
  }
  // Per-day vehicle picks apply to EVERY trip in the week, confirmed
  // trips included — the drafts above are done; this pass covers the
  // rest. A vehicle change re-labels the trip only: status and miles
  // are never touched, and the change rides the normal mileage cloud
  // save like any other trip edit.
  for(const m of weeklyMileageReview(start).trips){
    if(m.status==='draft')continue;
    const vehRaw=reviewInputValue('reviewVehicle',m.id);
    if(vehRaw==null||vehRaw===String(m.vehicleId||''))continue;
    const vv=vehicleById(vehRaw);m.vehicleId=vv?vv.id:'';m.vehicleName=vv?String(vv.name||''):'';changed++;vehicleChanged.push(m.id);
  }
  if(changed>0)persist();
  for(const vid of vehicleChanged)cloudSaveKind('mileage',vid);
  return changed;
}
function confirmWeeklyMileage(start){
  ensureWeeklyMileageDrafts(start);
  applyMileageReviewEdits(start);
  const review=weeklyMileageReview(start);
  let confirmed=0;
  for(const m of review.drafts){
    if(!(num(m.miles)>0))continue;
    m.status='verified';confirmed++;
  }
  const left=weeklyMileageReview(start);
  persist();render();
  if(left.toReview>0){
    alert('Confirmed '+confirmed+' trip(s) for the week of '+weekRangeLabel(start)+'. '+left.toReview+' trip(s) still need review'+(left.needsMiles.length?' \u2014 '+left.needsMiles.length+' still '+(left.needsMiles.length===1?'has':'have')+' no miles, so '+(left.needsMiles.length===1?'it stays':'they stay')+' a draft until miles are entered or calculated (a missing address is flagged at the top of the review)':'')+'.');
  }else{
    alert('Week of '+weekRangeLabel(start)+': all '+review.trips.length+' trip(s) confirmed.');
  }
  return {confirmed:confirmed,remaining:left.toReview};
}
function mileageReviewStep(n){
  const weeks=mileageWeeks();
  if(!weeks.length)return render();
  const cur=selectedMileageReviewWeek();
  const i=weeks.indexOf(cur);
  const next=weeks[Math.min(weeks.length-1,Math.max(0,(i<0?0:i)+n))];
  mileageReviewWeek=next;render();
}
// Reads one of the review's inline fix inputs (class + data-key), the
// same pattern reviewInputValue uses for the trip rows themselves.
function reviewFixInputValue(cls,key){
  if(typeof document==='undefined'||typeof document.querySelector!=='function')return null;
  const el=document.querySelector('.'+cls+'[data-key="'+key+'"]');
  return el?el.value:null;
}
// Save an address typed into the weekly review's fix box — a facility's
// address, or the home address — and immediately recalculate the week,
// so the user never has to leave the review to unblock a calculation.
// Saving a changed address clears its cached geocode (and a facility's
// auto-calculated distance), mirroring the facility form's own rule.
async function mileageReviewFixAddress(kind,key){
  const start=selectedMileageReviewWeek();
  if(kind==='facility'){
    const f=facilityByNameOrAlias(key);
    if(!f)return render();
    const v=reviewFixInputValue('reviewFixFacility',String(f.name));
    const addr=v!=null?String(v).trim():String(f.address||'').trim();
    if(addr&&addr!==String(f.address||'').trim()){
      f.address=addr;f.lat='';f.lng='';f.geocodedAddress='';
      if(f.distanceSource==='auto'){f.distance='';f.distanceSource=''}
      persist();
    }
  }else{
    const v=reviewFixInputValue('reviewFixHome','home');
    const addr=v!=null?String(v).trim():'';
    if(addr&&addr!==String((db.settings&&db.settings.homeAddress)||'').trim()){
      db.settings.homeAddress=addr;db.settings.homeLat='';db.settings.homeLng='';db.settings.homeGeocodedAddress='';persist();
    }
  }
  return generateWeeklyMileageDrafts(start);
}
// One tap in the weekly review: the trips' facility name does not
// resolve, but a saved facility is an obvious near-match. Confirming
// records the trips' name as an alias of that facility (so it never
// asks again and every name-based path heals), stamps the facility
// link onto the affected trips and shifts, saves the facility (the
// alias rides its cloud sync), and recalculates the week. Nothing is
// ever linked without this tap.
async function linkMileageFacility(facilityId,rawName){
  const f=(db.facilities||[]).find(x=>x.id===facilityId);
  if(!f)return render();
  const start=selectedMileageReviewWeek();
  addFacilityAlias(f,rawName);
  const k=facilityNameKey(rawName);
  for(const m of (db.mileage||[]))if(facilityNameKey(m.facility)===k&&m.facilityId!==f.id)m.facilityId=f.id;
  for(const x of (db.shifts||[]))if(facilityNameKey(x.facility)===k&&x.facilityId!==f.id)x.facilityId=f.id;
  persist();
  if(typeof cloudSaveKind==='function')cloudSaveKind('facilities',f.id);
  return generateWeeklyMileageDrafts(start);
}
// A short note under a blank trip's miles box naming the address that
// trip is waiting on, so the row itself says what is missing.
function mileageReviewRowNote(m){
  if(num(m.miles)>0)return '';
  const f=facilityForRecord(m);
  if(!f){const near=facilityNearMatch(m.facility);if(near)return `<div class="muted">“${escapeHTML(m.facility)}” is not a saved facility name — “${escapeHTML(near.name)}” looks like the match; link them above to calculate this trip.</div>`;return `<div class="muted">No facility named ${escapeHTML(m.facility)} is saved — add it on the Facilities tab.</div>`}
  if(!String(f.address||'').trim())return `<div class="muted">No address saved for ${escapeHTML(f.name)} — add it above to calculate this trip.</div>`;
  if(m.origin==='home'&&!String((db.settings&&db.settings.homeAddress)||'').trim())return `<div class="muted">No home address saved — add it above to calculate this trip.</div>`;
  if(m.origin==='hotel'&&!tripOriginAddress(m))return `<div class="muted">No hotel address for this trip — add one in the Starting point field above.</div>`;
  return '';
}
// Inline fixes at the top of the review: when trips cannot be
// calculated because an address is missing or could not be found, the
// fix sits right where the user is standing — an address input and one
// tap that saves it and recalculates — instead of a bare "0 created"
// dialog and a trip to another tab.
function mileageReviewFixHTML(start,r){
  const items=[],seen=new Set();
  const homeAddress=String((db.settings&&db.settings.homeAddress)||'').trim();
  const pushHome=(prefill,notFound)=>{
    if(seen.has('home'))return;seen.add('home');
    items.push(`<div class="item"><div class="item-title">${notFound?'Your home address could not be found':'No home address saved'}</div><div class="muted">${notFound?'Fix it here, then recalculate.':'Trips that start from home can’t be calculated without one.'}</div><div class="toolbar"><input class="reviewFixHome" data-key="home" value="${escapeHTML(prefill||'')}" placeholder="Home address — street, city, state ZIP" aria-label="Home address"><button type="button" class="tiny" data-action="mileage-review-fix-home">Save address &amp; calculate</button></div></div>`);
  };
  const pushFacility=(f,prefill,title,note)=>{
    const key='fac:'+f.name;if(seen.has(key))return;seen.add(key);
    items.push(`<div class="item"><div class="item-title">${escapeHTML(title)}</div><div class="muted">${escapeHTML(note)}</div><div class="toolbar"><input class="reviewFixFacility" data-key="${escapeHTML(f.name)}" value="${escapeHTML(prefill||'')}" placeholder="${escapeHTML(f.name)} address — street, city, state ZIP" aria-label="${escapeHTML(f.name)} address"><button type="button" class="tiny" data-action="mileage-review-fix-facility" data-id="${escapeHTML(f.name)}">Save address &amp; calculate</button></div></div>`);
  };
  const pushLine=(key,text)=>{
    if(seen.has(key))return;seen.add(key);
    items.push(`<div class="item"><div class="muted">${escapeHTML(text)}</div></div>`);
  };
  const pushLink=(rawName,f)=>{
    const key='link:'+rawName;if(seen.has(key))return;seen.add(key);
    items.push(`<div class="item"><div class="item-title">These trips say “${escapeHTML(rawName)}” — link them to “${escapeHTML(f.name)}”?</div><div class="muted">No facility has the exact name “${escapeHTML(rawName)}”, but “${escapeHTML(f.name)}”${String(f.address||'').trim()?` (${escapeHTML(f.address)})`:''} is saved. Linking remembers “${escapeHTML(rawName)}” as a short name for ${escapeHTML(f.name)} — and it only happens when you tap.</div><div class="toolbar"><button type="button" class="tiny" data-action="mileage-review-link-facility" data-id="${escapeHTML(f.id)}" data-date="${escapeHTML(rawName)}">Link to ${escapeHTML(f.name)} &amp; calculate</button></div></div>`);
  };
  for(const m of r.drafts.filter(x=>!(num(x.miles)>0))){
    const f=facilityByNameOrAlias(m.facility);
    if(f&&!String(f.address||'').trim())pushFacility(f,'',f.name+' has no address saved','Its trips can’t be calculated until an address is saved.');
    else if(!f){const near=facilityNearMatch(m.facility);if(near)pushLink(m.facility,near);else pushLine('missing:'+m.facility,'No facility named '+m.facility+' is saved — add it on the Facilities tab, then tap Calculate.')}
    if(m.origin==='home'&&!homeAddress)pushHome('',false);
  }
  const note=mileageReviewCalcNote&&mileageReviewCalcNote.week===start?mileageReviewCalcNote:null;
  if(note)for(const fail of note.failures){
    if(fail.reason==='address-missing'){const f=facilityByNameOrAlias(fail.facility);if(f)pushFacility(f,'',f.name+' has no address saved','Its trips can’t be calculated until an address is saved.')}
    else if(fail.reason==='address-not-found'){const f=facilityByNameOrAlias(fail.facility);if(f)pushFacility(f,String(f.address||''),f.name+'’s address could not be found','The saved address (“'+String(f.address||'')+'”) could not be located — fix it here, then recalculate.')}
    else if(fail.reason==='origin-missing'&&fail.origin==='home')pushHome('',false);
    else if(fail.reason==='origin-not-found'&&fail.origin==='home')pushHome(homeAddress,true);
    else if(fail.reason==='facility-missing'){const near=facilityNearMatch(fail.facility);if(near)pushLink(fail.facility,near);else pushLine('fail:facility-missing:'+fail.facility+':'+fail.origin,mileageCalcFailureText(fail))}
    else pushLine('fail:'+fail.reason+':'+fail.facility+':'+fail.origin,mileageCalcFailureText(fail));
  }
  if(!items.length)return '';
  return `<div style="border:1px solid #e3c98a;background:#fdf6e0;border-radius:10px;padding:10px 12px;margin:10px 0"><strong>Some trips can’t be calculated yet:</strong>${items.join('')}</div>`;
}
// The week's "Same vehicle for all days" control, shown at the top of
// the review whenever vehicle UI applies (>= 1 saved vehicle). The
// select's pre-picked value is the trip majority (ties and
// no-majority fall back to the default vehicle), but nothing is
// applied until the user taps Apply — choosing in the select only
// records the choice. With no vehicles at all it is just an
// Add-a-vehicle jump to the Vehicles panel — one tap, no nagging.
function mileageReviewVehicleHTML(start,rows){
  const vs=db.vehicles||[];
  if(!vs.length)return `<div class="toolbar"><span class="muted">Same vehicle for all days:</span><button type="button" class="tiny secondary" data-action="vehicles-goto">Add a vehicle</button></div>`;
  const counts={};let best='',bestN=0;
  for(const m of rows){if(m.vehicleId&&vehicleById(m.vehicleId)){counts[m.vehicleId]=(counts[m.vehicleId]||0)+1;if(counts[m.vehicleId]>bestN){bestN=counts[m.vehicleId];best=m.vehicleId}}}
  const picked=mileageReviewVehicleForWeek(start);
  const sel=picked||best||(defaultVehicle()?defaultVehicle().id:'');
  const days=rows.filter(m=>m.status!=='dismissed').length;
  return `<div class="toolbar"><label for="mileageReviewVehicleSelect">Same vehicle for all days:</label><select id="mileageReviewVehicleSelect">${vs.map(v=>`<option value="${escapeHTML(v.id)}" ${v.id===sel?'selected':''}>${escapeHTML(v.name)}</option>`).join('')}</select><button type="button" class="tiny" data-action="mileage-review-vehicle-apply">Apply</button><button type="button" class="tiny secondary" data-action="vehicles-goto">Add a vehicle</button></div><p class="muted">Applies to all ${days} day${days===1?'':'s'} in this week \u2014 you can still change single days below.</p>`;
}
function mileageReviewHTML(){
  const weeks=mileageWeeks();
  if(!weeks.length)return '';
  const start=selectedMileageReviewWeek();
  ensureWeeklyMileageDrafts(start);
  const r=weeklyMileageReview(start);
  const due=dueMileageWeeks();
  const rows=[...r.trips].sort((a,b)=>String(a.date||'').localeCompare(String(b.date||'')));
  const originOptions=m=>{const sh=(db.shifts||[]).find(s=>mileageTripMatchesShift(m,s));const callLine=(sh&&/call/i.test(sh.type||'')&&!m.originChosen&&String(m.date||'')>=currentMonthStart())?`<div class="muted">🚗 I see you’re on call — want to change your driving location? Pick here.</div>`:'';return callLine+`<select class="reviewOrigin" data-trip="${escapeHTML(m.id)}"><option value="home" ${m.origin!=='hotel'&&m.origin!=='other'?'selected':''}>Home</option><option value="hotel" ${m.origin==='hotel'?'selected':''}>Hotel</option><option value="other" ${m.origin==='other'?'selected':''}>Other address</option></select><input class="reviewOther" data-trip="${escapeHTML(m.id)}" value="${escapeHTML(m.hotelAddress||'')}" placeholder="Hotel / other address">`};
  const typeOptions=m=>`<select class="reviewTripType" data-trip="${escapeHTML(m.id)}"><option value="round-trip" ${m.tripType!=='one-way'?'selected':''}>Round trip</option><option value="one-way" ${m.tripType==='one-way'?'selected':''}>One way</option></select>`;
  // Per-day vehicle choice (Nov 7, 2026): with 2+ vehicles EVERY row
  // — drafts and confirmed trips alike — carries its own compact
  // picker, tucked under the facility name so the table keeps its
  // width on a phone (no separate Vehicle column). With exactly one
  // vehicle there is nothing to choose between, so the row just names
  // it. Changing a vehicle never touches the trip's status or miles.
  const vehicleOptions=m=>`<select class="reviewVehicle" data-trip="${escapeHTML(m.id)}"><option value="">No vehicle</option>${(db.vehicles||[]).map(v=>`<option value="${escapeHTML(v.id)}" ${m.vehicleId===v.id?'selected':''}>${escapeHTML(v.name)}</option>`).join('')}</select>`;
  const facilityCell=m=>`${escapeHTML(m.facility)}${(db.vehicles||[]).length>=2?`<div>${vehicleOptions(m)}</div>`:(db.vehicles||[]).length===1&&tripVehicleLabel(m)?`<div class="muted">${escapeHTML(tripVehicleLabel(m))}</div>`:''}`;
  const body=rows.map(m=>{
    if(m.status==='verified')return `<tr><td>${fmt(m.date)}</td><td>${facilityCell(m)}</td><td>${escapeHTML(mileageOriginLabel(m))}</td><td>${escapeHTML(m.miles)} mi</td><td>${m.tripType==='one-way'?'One way':'Round trip'}</td><td><span class="pill">Confirmed</span></td></tr>`;
    if(m.status==='skipped')return `<tr><td>${fmt(m.date)}</td><td>${facilityCell(m)}</td><td>${escapeHTML(mileageOriginLabel(m))}</td><td>${num(m.miles)>0?escapeHTML(m.miles)+' mi':'\u2014'}</td><td>${m.tripType==='one-way'?'One way':'Round trip'}</td><td><span class="pill warn">Skipped</span> <button type="button" class="tiny secondary" data-action="mileage-review-restore" data-id="${escapeHTML(m.id)}">Restore</button></td></tr>`;
    if(m.status==='dismissed')return `<tr><td>${fmt(m.date)}</td><td>${facilityCell(m)}</td><td>${escapeHTML(mileageOriginLabel(m))}</td><td>${num(m.miles)>0?escapeHTML(m.miles)+' mi':'\u2014'}</td><td>${m.tripType==='one-way'?'One way':'Round trip'}</td><td><span class="pill">Cleared</span> <button type="button" class="tiny secondary" data-action="mileage-review-restore" data-id="${escapeHTML(m.id)}">Restore</button></td></tr>`;
    return `<tr><td>${fmt(m.date)}</td><td>${facilityCell(m)}</td><td>${originOptions(m)}</td><td><input type="number" class="reviewMiles" data-trip="${escapeHTML(m.id)}" value="${escapeHTML(m.miles||'')}" min="0" step="0.1" placeholder="Enter miles">${!(num(m.miles)>0)?' <span class="pill warn">miles needed</span>':''}${mileageReviewRowNote(m)}</td><td>${typeOptions(m)}</td><td><button type="button" class="tiny secondary" data-action="mileage-review-skip" data-id="${escapeHTML(m.id)}">Skip</button></td></tr>`;
  }).join('');
  return `<section class="panel"><h2>Weekly mileage review</h2><p><strong>${escapeHTML(mileageReviewStatusLine(start))}</strong>${r.overdue?' \u00b7 <span class="expired">overdue \u2014 the week ended '+fmt(r.end)+'</span>':r.due?' \u00b7 due now':''}</p>${mileageReviewFixHTML(start,r)}${mileageReviewVehicleHTML(start,rows)}<div class="toolbar"><button type="button" class="secondary" data-action="mileage-review-prev">\u2039 Previous week</button><select id="mileageReviewWeekSelect">${weeks.map(w=>`<option value="${w}" ${w===start?'selected':''}>Week of ${weekRangeLabel(w)}${weeklyMileageReview(w).allConfirmed?' \u2014 All confirmed':' \u2014 '+weeklyMileageReview(w).toReview+' to review'}</option>`).join('')}</select><button type="button" class="secondary" data-action="mileage-review-next">Next week \u203a</button><button type="button" class="secondary" data-action="mileage-review-generate">Calculate miles for this week</button></div><p class="muted">One screen per week: check every trip, fix the starting point or miles, skip any trip that did not happen, then confirm the whole week at once. Only confirmed trips count in totals and exports. Reviews start with this month — older unconfirmed trips can be cleared in one tap in the summary below. Changing a starting point clears its miles — enter them, or tap Calculate miles for this week.</p>${rows.length?`<div class="table-scroll"><table class="contract-table"><thead><tr><th>Date</th><th>Facility</th><th>Starting point</th><th>Miles</th><th>Type</th><th></th></tr></thead><tbody>${body}</tbody></table></div>`:'<p class="muted">No trips in this week.</p>'}<div class="form-actions"><button type="button" data-action="mileage-review-confirm">Confirm all \u2014 ${r.drafts.length} trip(s)</button><button type="button" class="secondary" data-action="mileage-review-save">Save changes</button></div><p class="muted">${r.needsMiles.length?r.needsMiles.length+' trip(s) have no miles yet \u2014 add the missing address above, or enter miles, to confirm them. ':''}${due.length>1?'Other weeks still to review: '+due.filter(d=>d.start!==start).map(d=>mileageReviewStatusLine(d.start)).join('; ')+'.':''}</p></section>`;
}
function dashboardMileageNudgeHTML(){
  if(!featureOn('featureMileage'))return '';
  const due=dueMileageWeeks();
  if(!due.length)return '';
  const r=due[0],others=due.length-1;
  return `<section class="panel"><h2>Mileage review ${r.overdue?'overdue':'due'}</h2><p><strong>${escapeHTML(mileageReviewStatusLine(r.start))}</strong>${r.overdue?' \u2014 the week ended '+fmt(r.end)+' and it is still unconfirmed.':''}${others?' Plus '+others+' other week'+(others===1?'':'s')+' to review.':''}</p><div class="toolbar"><button data-action="mileage-review-goto" data-id="${escapeHTML(r.start)}">Review week of ${escapeHTML(weekRangeLabel(r.start))}</button><button class="secondary" data-action="goto-mileage">Open Mileage tab</button></div><p class="muted">One screen per week — confirm all trips at once. Only confirmed trips count in totals and exports.</p></section>`;
}
function homeAddressSection(){
  const s=db.settings||{};
  const home=String(s.homeAddress||'').trim(),hotel=String(s.hotelAddress||'').trim();
  // Collapsed once a home address is saved (Nov 6, 2026): one-line
  // summary + Edit. Stays expanded while empty so a new user filling it
  // in isn't fighting a collapsed panel.
  if(home&&!addressesEditing){
    const parts=['Home: '+home];if(hotel)parts.push('Hotel: '+hotel);
    return `<section class="panel" id="addresses-panel"><h2>Your addresses</h2><p class="muted">Save your home address and where you stay on call — we'll use them to calculate your mileage automatically.</p><p>${escapeHTML(parts.join(' · '))}</p>${homeGeocodeStatus?`<p class="hint">${escapeHTML(homeGeocodeStatus)}</p>`:''}<div class="toolbar"><button type="button" class="secondary" data-action="edit-addresses">Edit</button></div></section>`;
  }
  return `<section class="panel" id="addresses-panel"><h2>Your addresses</h2><p class="muted">Save your home address and where you stay on call — we'll use them to calculate your mileage automatically.</p><form data-kind="home-address"><div class="form-grid">${field('homeAddress','Home address','text',s.homeAddress||'','placeholder="Street, City, State ZIP"')}${field('hotelAddress','Hotel address','text',s.hotelAddress||'','placeholder="Hotel street, City, State ZIP"')}</div>${formEnd('Save addresses')}</form>${homeGeocodeStatus?`<p class="hint">${escapeHTML(homeGeocodeStatus)}</p>`:''}</section>`;
}
async function submitHomeAddress(e){
  const fd=new FormData(e.currentTarget);
  const addr=String(fd.get('homeAddress')||'').trim();
  db.settings.homeAddress=addr;
  db.settings.hotelAddress=String(fd.get('hotelAddress')||'').trim();
  addressesEditing=false;
  if(!addr){db.settings.homeLat='';db.settings.homeLng='';db.settings.homeGeocodedAddress='';homeGeocodeStatus='';persist();render();return}
  if(db.settings.homeGeocodedAddress!==addr){db.settings.homeLat='';db.settings.homeLng=''}
  homeGeocodeStatus='Checking that address…';render();
  const g=await geocodeAddress(addr);
  if(g){db.settings.homeLat=String(g.lat);db.settings.homeLng=String(g.lon);db.settings.homeGeocodedAddress=addr;homeGeocodeStatus='Address saved — found as: '+g.display}
  else homeGeocodeStatus='Address saved, but it could not be located just now — mileage auto-calculation will retry when you use it. Check the spelling and try saving again.';
  persist();render();
}
async function calcMileageForForm(){
  const setStatus=t=>{const st=$('mileageCalcStatus');if(st)st.textContent=t;mileageCalcStatus=t};
  const sel=$('f_facility'),milesEl=$('f_miles'),srcEl=$('f_milesSource'),originEl=$('f_origin'),hotelEl=$('f_hotelAddress'),typeEl=$('f_tripType'),owEl=$('f_oneWayMiles');
  const tripT=typeEl&&typeEl.value==='one-way'?'one-way':'round-trip';
  const name=sel?String(sel.value||'').trim():'';
  if(!name){setStatus('Pick a facility first.');return}
  const f=facilityByNameOrAlias(name);
  if(!f){setStatus('That facility is not saved yet — add it on the Facilities tab first.');return}
  if(!String(f.address||'').trim()){setStatus('This facility has no address saved — add one on the Facilities tab, or enter the miles manually.');return}
  const origin=originEl&&originEl.value==='hotel'?'hotel':'home';
  const originAddr=origin==='hotel'?((hotelEl?String(hotelEl.value||'').trim():'')||String((db.settings&&db.settings.hotelAddress)||'').trim()):String((db.settings&&db.settings.homeAddress)||'').trim();
  const originLabel=origin==='hotel'?'hotel':'home';
  if(!originAddr){setStatus(origin==='hotel'?'Enter the hotel address first, or save one on the Account tab — mileage is calculated from the hotel to this facility.':'Set your home address on the Account tab first — mileage is calculated from home to this facility.');return}
  setStatus('Calculating driving distance from '+originLabel+'…');
  const res=await homeToFacilityMiles(f,originAddr);
  if(!res){setStatus('Could not calculate the driving distance just now (address not found or routing unavailable). No distance was guessed — enter the miles manually.');return}
  const milesVal=tripMilesFor(res.oneWay,tripT);
  if(milesEl)milesEl.value=String(milesVal);
  if(owEl)owEl.value=String(res.oneWay);
  if(srcEl)srcEl.value='auto';
  setStatus(tripT==='one-way'
    ?'Auto-calculated: '+milesVal.toFixed(1)+' mi one way ('+roundTripMiles(res.oneWay).toFixed(1)+' mi round trip, '+originLabel+' → '+f.name+'). You can edit the miles — editing marks the trip as your override, or switch the mileage type to round trip.'
    :'Auto-calculated: '+milesVal.toFixed(1)+' mi round trip ('+res.oneWay.toFixed(1)+' mi each way, '+originLabel+' → '+f.name+'). You can edit the miles — editing marks the trip as your override, or switch the mileage type to one way.');
}
async function calcFacilityDistance(){
  const setStatus=t=>{const st=$('facilityDistanceStatus');if(st)st.textContent=t;facilityDistanceStatus=t};
  const addrEl=$('f_address'),distEl=$('f_distance'),srcEl=$('f_distanceSource');
  const addr=addrEl?String(addrEl.value||'').trim():'';
  if(!String((db.settings&&db.settings.homeAddress)||'').trim()){setStatus('Set your home address on the Account tab first.');return}
  if(!addr){setStatus('Enter the facility address first.');return}
  setStatus('Calculating driving distance from home…');
  const res=await homeToFacilityMiles({address:addr});
  if(!res){setStatus('Could not calculate the driving distance just now — no distance was guessed. Enter the one-way miles manually, or try again later.');return}
  if(distEl)distEl.value=String(res.oneWay);
  if(srcEl)srcEl.value='auto';
  setStatus('Auto-calculated: '+res.oneWay.toFixed(1)+' mi one-way from home ('+roundTripMiles(res.oneWay).toFixed(1)+' mi round trip). Save the facility to keep it — you can edit the miles, which marks it manual.');
}
function mileagePage(){if(!featureOn('featureMileage'))return featureOffHTML('featureMileage');const x=db.mileage.find(x=>x.id===editId)||{},stay=db.hotelStays.find(x=>x.id===editId)||{},total=verifiedMileageTotal(),monthPrefix=localDate(new Date()).slice(0,7),draftCount=db.mileage.filter(x=>x.status==='draft'&&String(x.date||'').startsWith(monthPrefix)).length,backlog=unconfirmedTripsBeforeMonth(),logMonths=[...new Set(db.mileage.map(m=>String(m.date||'').slice(0,7)).filter(s=>/^\d{4}-\d{2}$/.test(s)))].sort().reverse(),logMonth=(mileageLogMonth==='all'||logMonths.includes(mileageLogMonth))?mileageLogMonth:monthPrefix,logTrips=db.mileage.filter(m=>logMonth==='all'||String(m.date||'').startsWith(logMonth)),home=String((db.settings&&db.settings.homeAddress)||'').trim(),hotels=knownHotelAddresses(),isStayEdit=!!stay;const editingTrip=!!(editId&&x.id),logDraft=(mileageFormDraft&&mileageFormDraft.forEditId===(editingTrip?editId:''))?mileageFormDraft:null,fx=logDraft?{...x,...logDraft.values}:x,logPanelOpen=!!(editingTrip||mileageCalcStatus||(logDraft&&logDraft.open));mileageFormRenderedFor=editingTrip?editId:'';const tripOrigin=fx.origin==='hotel'?'hotel':fx.origin==='other'?'other':'home',tripHotel=fx.hotelAddress||((db.settings&&db.settings.hotelAddress)||'')||((db.settings&&db.settings.lastHotelAddress)||'');const tripType=fx.tripType==='one-way'?'one-way':mileageTripType(),rtCount=verifiedMileageTrips().filter(m=>m.tripType!=='one-way').length,owCount=verifiedMileageTrips().length-rtCount;return `${mileageHeaderHTML()}${vehiclesPanelHTML()}${mileageReviewHTML()}<div class="two">${collapsePanelHTML('mileage-log-panel',editingTrip?'Edit business mileage':'Log business mileage — tap to add a trip manually',`<p class="muted">${home?`Home: ${escapeHTML(home)} — mileage below can be auto-calculated from home.`:`No home address saved yet — set it on the Account tab to auto-calculate mileage.`}</p><div class="toolbar"><button type="button" class="secondary tiny" data-action="goto-account">Set home address on the Account tab</button></div><form id="entryForm" data-kind="mileage"><div class="form-grid">${field('date','Trip date','date',fx.date||localDate(new Date()),'required')}${select('facility','Hospital / facility',[''].concat((db.facilities||[]).map(f=>f.name)),fx.facility||'')}${selectLabeled('origin','Starting point',[['home','Home'],['hotel','Hotel'],['other','Other address']],tripOrigin)}${field('hotelAddress','Hotel / other address (only when starting point is Hotel or Other address)','text',tripHotel,'list="hotelAddresses" placeholder="Hotel street, city, state ZIP"')}<datalist id="hotelAddresses">${hotels.map(h=>`<option value="${escapeHTML(h)}"></option>`).join('')}</datalist>${selectLabeled('tripType','Mileage type',[['round-trip','Round trip'],['one-way','One way']],tripType)}${field('miles','Actual miles','number',fx.miles??'','min="0" step="0.1" required')}<input type="hidden" name="milesSource" id="f_milesSource" value="${escapeHTML(fx.milesSource||(fx.miles?'manual':''))}"><input type="hidden" name="oneWayMiles" id="f_oneWayMiles" value="${escapeHTML(fx.oneWayMiles||'')}">${field('purpose','Business purpose','text',fx.purpose||'','required')}${select('status','Verification',['verified','draft'],fx.status||'verified')}${mileageVehicleField(fx)}</div><p class="hint" id="mileageCalcStatus">${escapeHTML(mileageCalcStatus)}</p><div class="toolbar"><button type="button" class="secondary" data-action="mileage-autocalc">Calculate miles (from home or hotel)</button></div>${formEnd(editingTrip?'Save trip':'Log trip')}`,logPanelOpen)}<section class="panel"><h2>Mileage summary</h2><div class="stat"><strong>${total.toFixed(1)} miles</strong>Verified trips only — ${rtCount} round-trip · ${owCount} one-way${draftCount?` · ${draftCount} draft(s) this month not counted yet`:''}</div><p class="muted">Each trip is counted once. A round trip already includes the return leg, so it is never doubled.</p>${backlog.length?`<p class="muted">${backlog.length} unconfirmed trip(s) from before this month.</p><div class="toolbar"><button type="button" class="secondary" data-action="mileage-clear-backlog">Clear everything before this month</button></div>`:''}${mileageClearStatus?`<p class="hint">${escapeHTML(mileageClearStatus)}</p>`:''}<div class="field"><label for="mileageTripTypeSelect">Default mileage type for new trips and drafts</label><select id="mileageTripTypeSelect"><option value="round-trip" ${mileageTripType()==='round-trip'?'selected':''}>Round trip (default)</option><option value="one-way" ${mileageTripType()==='one-way'?'selected':''}>One way</option></select></div><div class="toolbar" style="margin-top:14px"><button data-action="mileage-drafts">Generate schedule-based drafts</button><button class="secondary" data-action="export-mileage">Export CSV</button></div>${mileageExportOpen?mileageExportPickerHTML():''}<p class="hint">Drafts use your default mileage type (currently ${tripTypeLabel(mileageTripType())}): the auto-calculated ${tripTypeLabel(mileageTripType())} distance from home when it can be computed, otherwise the facility’s saved one-way distance converted to ${tripTypeLabel(mileageTripType())}. A shift inside a saved hotel stay below is calculated from the HOTEL address instead. Trips with neither show up in the weekly review above with blank miles — the review flags the missing address so you can add it there. Confirm the trip happened, the miles, and that it counts for tax. Regular commuting is generally not deductible.</p></section></div><section class="panel"><h2>Hotel stays — one address for a whole block</h2><p class="muted">Staying in a hotel for a block of shifts? Enter the hotel address and dates once here. Drafts for shifts in that block are calculated from the hotel, not home — and when you log a trip by hand, pick “Hotel” and the address is already filled in. A hotel address you enter on a trip is remembered for the next one.</p><p class="muted">Drafts from a stay use your mileage type — currently ${tripTypeLabel(mileageTripType())} — and show as hotel-based in the trip log.</p><form id="stayForm" data-kind="hotelStays"><div class="form-grid">${field('hotelAddress','Hotel address','text',stay.hotelAddress||(db.settings&&db.settings.hotelAddress)||'','required placeholder="Hotel street, city, state ZIP"')}${field('checkIn','Check-in date','date',stay.checkIn||localDate(new Date()),'required')}${field('checkOut','Check-out date','date',stay.checkOut||localDate(new Date()),'required')}${select('facility','Facility (blank = any facility)',[''].concat((db.facilities||[]).map(f=>f.name)),stay.facility||'')}${field('note','Note','text',stay.note||'','placeholder="e.g. Call block"')}</div>${formEnd(isStayEdit?'Save hotel stay':'Add hotel stay')}</form>${list('hotelStays',(db.hotelStays||[]).slice().sort((a,b)=>(b.checkIn||'').localeCompare(a.checkIn||'')),s=>`<div class="item-title">${escapeHTML(s.hotelAddress)}</div><div class="muted">${fmt(s.checkIn)} to ${fmt(s.checkOut)}${s.facility?` · ${escapeHTML(s.facility)}`:' · any facility'}${s.note?` · ${escapeHTML(s.note)}`:''}</div>`)}</section><section class="panel"><h2>Trip log</h2><div class="toolbar"><button type="button" class="secondary" data-action="export-mileage">Export mileage</button></div>${mileageExportOpen?mileageExportPickerHTML():''}<div class="field"><label for="mileageLogMonthSelect">Showing</label><select id="mileageLogMonthSelect">${logMonths.map(mo=>`<option value="${mo}" ${mo===logMonth?'selected':''}>${escapeHTML(monthLabel(mo))}${mo===monthPrefix?' (this month)':''}</option>`).join('')}<option value="all" ${logMonth==='all'?'selected':''}>All months</option></select></div>${list('mileage',logTrips.slice().sort((a,b)=>b.date.localeCompare(a.date)),mileageTripLine)})}</section>`+featureTurnOffLineHTML('featureMileage')}

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
function calPreviewNeedsFacility(){
  return !!(calPreview&&(calPreview.rows||[]).some(r=>r.include&&!scheduleRowFacilityResolved(r)));
}
function calPreviewHTML(){if(!calPreview)return '<p class="muted">No calendar file parsed yet. Choose an .ics file above, then parse it — nothing is saved until you approve the preview.</p>';const rows=calPreview.rows,dup=rows.filter(r=>r.duplicate).length,need=rows.filter(r=>r.flags.length).length;return `<p><strong>Parsed from:</strong> ${escapeHTML(calPreview.fileName)} · Source: ${escapeHTML(calPreview.sourceLabel)} · ${rows.length} event(s) · ${rows.filter(r=>r.include&&!r.duplicate).length} would be added · ${dup} duplicate(s) will merge into the existing shift — never doubled</p><p class="muted">Duplicates are events already in the app with the same date, facility, and shift type. Uncheck any row to leave it out. Rows with a missing date or facility block approval until fixed or unchecked.</p>${calPreviewNeedsFacility()?`<div class="form-grid"><div class="field"><label for="calFacilityAll">Which facility is this schedule for?</label><input id="calFacilityAll" class="calFacilityAll" list="facilityNamesCal" value="${escapeHTML(calPreview.facilityAll||'')}" placeholder="e.g. RGH"><datalist id="facilityNamesCal">${(db.facilities||[]).map(f=>`<option value="${escapeHTML(f.name)}"></option>`).join('')}</datalist></div></div><p class="muted">Applies to any row whose facility is missing or not one of your saved facilities — each row stays editable below. A name that isn't saved yet is added to your facilities when you approve.</p>`:''}${payUnitControlHTML(calPreview,'cal')}${importRatesPromptHTML(calPreview,'cal')}${importPaySchedHTML(calPreview,'cal')}${importConflictsHTML(calPreview,'cal')}<div class="table-scroll"><table class="contract-table"><thead><tr><th></th><th>Date</th><th>Facility</th><th>Shift type</th><th>Pay ${calPreview.payUnit==='hourly'?'(\$/hr)':'(\$ per shift)'}</th><th>Flags</th></tr></thead><tbody>${rows.map((r,i)=>`<tr><td><input type="checkbox" class="calInclude" data-row="${i}" ${r.include?'checked':''}></td><td><input type="date" class="calEdit" data-row="${i}" data-field="date" value="${escapeHTML(r.date||'')}"></td><td><input class="calEdit" data-row="${i}" data-field="facility" value="${escapeHTML(r.facility||'')}"></td><td><input class="calEdit" data-row="${i}" data-field="type" value="${escapeHTML(r.code||r.type||'')}"></td><td><input class="calEdit" data-row="${i}" data-field="pay" value="${escapeHTML(r.pay||'')}"></td><td>${r.duplicate?'<span class="pill warn">duplicate — will merge</span> ':''}${r.flags.map(f=>`<span class="pill warn">${escapeHTML(f)}</span>`).join(' ')||'<span class="pill">clean</span>'}</td></tr>`).join('')}</tbody></table></div><div class="form-actions"><button type="button" data-action="cal-approve">Approve selected — add shifts</button><button type="button" class="secondary" data-action="cal-discard">Discard preview</button></div>`}
async function importCalendar(e){e.preventDefault();calImportError='';const f=$('f_calFile').files[0];const sourceLabel=$('f_calSource').value||'Calendar file';if(!f){calImportError='Choose an .ics calendar file first (Google, Apple, or Outlook can all export one).';return render()}let text='';try{text=await f.text()}catch(err){calImportError='Could not read that file: '+err.message;return render()}if(!/^BEGIN:VCALENDAR/i.test(text.trim())){calImportError='That file is not a calendar (.ics) file. Export your calendar as .ics from Google, Apple, or Outlook and try again. Nothing was saved.';calPreview=null;return render()}const parsed=parseICS(text,f.name);const sourceCode=CAL_SOURCES[sourceLabel]||'calendar-file';const grossByBlock=text.split(/BEGIN:VEVENT/i).slice(1).map(b=>{const m=b.match(/Expected gross:\s*\$?([\d\\,]+(?:\.\d+)?)/i);return m?m[1].replace(/[\\,]/g,''):''});const rows=parsed.rows.map((r,ri)=>{const gb=grossByBlock[r.blockIndex!=null?r.blockIndex:ri];if(gb)r={...r,pay:gb};const duplicate=(db.shifts||[]).some(x=>shiftsSameShift(x,r));const flags=[...r.flags];if(duplicate)flags.push('already in CRNA Hub — will merge, not double');return {...r,source:sourceCode,sourceLabel,status:importStatusForDate(r.date),include:true,duplicate,incomplete:!String(r.pay||'').trim(),note:'Imported from '+sourceLabel+' (.ics): '+f.name}});calPreview={fileName:f.name,sourceLabel,sourceCode,rows};if(!rows.length){calImportError='No events found in that calendar file. Nothing was saved.';calPreview=null}render()}
function approveCalendarImport(){if(!calPreview)return;let rows=calPreview.rows.filter(r=>r.include);const fillFac=String(calPreview.facilityAll||(($('calFacilityAll')||{}).value)||'').trim();if(fillFac){const fillTarget=facilityByNameOrAlias(fillFac);const pendingFill=rows.filter(r=>!scheduleRowFacilityResolved(r));for(const r of pendingFill){const prevFac=String(r.facility||'').trim();r.facility=fillFac;if(fillTarget&&prevFac&&prevFac.length<=12&&/^[A-Za-z0-9][A-Za-z0-9.&']*$/.test(prevFac))addFacilityAlias(fillTarget,prevFac)}}rows=combineDayCallRows(rows);let ratesSavedFor='',ratesSkippedFor='';const ratesTarget=importRatesTarget(calPreview.ratesSkipped?{...calPreview,ratesSkipped:false}:calPreview);if(ratesTarget){const applied=applyImportDescribed(calPreview,ratesTarget);if(applied.saved)ratesSavedFor=ratesTarget.name;else if(calPreview.ratesSkipped)ratesSkippedFor=ratesTarget.name}if(fillFac&&!facilityByNameOrAlias(fillFac)){db.facilities=db.facilities||[];db.facilities.push({id:id(),name:fillFac,aliases:'',address:'',rate8:'',rate10:'',rate12:'',rate24:'',rateSecond:'',hourlyRate:'',paidHours8:'',callBonus:'',distance:'',notes:'',...(calPreview.ratesSkipped?{ratesPromptSkipped:true}:{})})}const blocked=rows.filter(r=>!r.date||!/^\d{4}-\d{2}-\d{2}$/.test(r.date)||!String(r.facility||'').trim());if(blocked.length){alert('Fix or uncheck these rows before approving: '+(blocked.map(r=>`${r.date||'(no date)'} ${r.facility||'(no facility)'} ${r.type}`).join('; ')));return}const builtCal=[];for(const r of rows){const conv=previewPayConversion(r.pay,calPreview.payUnit,r.type,facilityByNameOrAlias(r.facility));let pay=conv.pay,payRate=conv.payRate,payUnit=conv.payUnit,shiftType=r.type;const facP=facilityByNameOrAlias(r.facility);if(facP){const cp=clarifiedRowPricing(facP,r);if(cp){shiftType=cp.type;if(!pay&&cp.pay){pay=cp.pay;payRate=cp.payRate;payUnit=cp.payUnit}}}if(!pay&&facP){const pp=facilityPayFor(facP,shiftType,r.date);if(pp>0){pay=String(pp);payUnit='facility'}}builtCal.push({row:r,rec:{id:id(),date:r.date,facility:String(r.facility).trim(),type:shiftType,code:String(r.code||'').trim(),pay,payRate,payUnit,status:importStatusForDate(r.date),source:r.source,sources:[r.source],incomplete:!pay,note:r.note}})}
const calGate=importGateCheck(calPreview,builtCal.map(b=>b.rec));if(calGate.stopped){render();gateStopAlert();return}
const calAddSet=new Set([...calGate.clean,...calGate.dups,...(calGate.addAnyway||[]).map(c=>c.rec)]);const calLeftOut=(calGate.skippedConflicts||[]).length;
let created=0,skipped=0,newFacilities=0;for(const b of builtCal){if(!calAddSet.has(b.rec))continue;const r=b.row;const res=addShiftDeduped(b.rec);if(res.merged){skipped++;continue}created++;if(r.facility&&!facilityByNameOrAlias(r.facility)){db.facilities.push({id:id(),name:String(r.facility).trim(),aliases:'',address:'',rate8:'',rate10:'',rate12:'',rate24:'',rateSecond:'',hourlyRate:'',paidHours8:'',callBonus:'',distance:'',notes:''});newFacilities++}}if(ratesTarget){const rf=facilityByNameOrAlias(ratesTarget.name);if(rf)repriceUnpricedShiftsForFacility(rf)}const dups=calPreview.rows.filter(r=>r.duplicate).length;acknowledgeImportConflicts(calGate);const calPaySchedSaved=applyImportPaySched(calPreview,'cal');const calPaySchedHint=importPaySchedHint(calPreview,'cal',calPaySchedSaved);calPreview=null;persist();render();if(typeof window!=='undefined'&&typeof window.liveSyncSchedulePush==='function')window.liveSyncSchedulePush();alert(`Added ${created} shift(s) from the calendar. Merged ${skipped} duplicate(s) into existing shifts — never doubled.${newFacilities&&!ratesSavedFor?` New facilit(ies) learned: set their pay rules on the Facilities tab.`:''}${ratesSavedFor?` Rates saved for ${ratesSavedFor} — these shifts priced from them.`:''}${ratesSkippedFor?` No rates for ${ratesSkippedFor} yet — its shifts are unpriced; set rates any time on the Facilities tab.`:''}${calPaySchedSaved?` Pay schedule saved for ${calPaySchedSaved.agency} — paychecks for these shifts now show on your calendar.`:''}${calPaySchedHint}${calLeftOut?` Left out ${calLeftOut} shift(s) that would double-book you — tick "Add it anyway" in the preview if you really have both.`:''}`)}
function exportCalendarICS(shifts,filename){if(!shifts.length){alert('No shifts to export.');return}download(filename,shiftsToICS(shifts),'text/calendar;charset=utf-8')}
function backupHTML(){
  return collapsePanelHTML('backup-panel','Backup & restore',`<p class="muted">${escapeHTML(cloudHeaderLabel())}</p><div class="toolbar"><button data-action="backup">Download JSON backup</button><button class="secondary" data-action="export-shifts">Download shift CSV</button><button class="secondary" data-action="export-mileage">Download mileage CSV</button></div>${mileageExportOpen?mileageExportPickerHTML():''}<label for="restoreFile">Restore a CRNA Hub JSON backup (replaces current records)</label><input id="restoreFile" type="file" accept=".json,application/json"><p class="muted" style="font-size:0.85em">${INCOME_DISCLAIMER}</p>`,false);
}

// --- Schedule name: "as it appears on the schedule" ---
// Collected at account creation (step 1) and editable on the Account tab.
// The schedule import uses it to pick only this person's shifts out of a
// staff list. Matching is forgiving about form: "C. Martin",
// "Martin, Caleb" and "Caleb Martin" are the same person; "Jordan
// Martin" and "Caleb Jones" are not. A stored name of just a last name
// ("Martin") matches on last name alone, as entered.
function scheduleName(){return String((db.settings&&db.settings.scheduleName)||'').trim()}
function scheduleNameParts(name){
  const raw=String(name||'').trim(); if(!raw) return null;
  const hasComma=raw.includes(',');
  const s=raw.toLowerCase().replace(/\./g,'').replace(/,/g,' ').replace(/\s+/g,' ').trim();
  let toks=s.split(' ').filter(Boolean);
  if(!toks.length) return null;
  if(toks.length===1) return {first:'',last:toks[0]};
  if(hasComma) return {first:toks.slice(1).join(' '),last:toks[0]};
  // No comma: a lone single-letter token is an initial, never the
  // surname — "Martin C" and "C Martin" are the same person shape
  // (Nov 10, 2026: the profile "Caleb Martin" must match a schedule
  // row labelled "Martin C" exactly as it matches "C. Martin").
  if(toks.length===2){
    if(toks[1].length===1&&toks[0].length>1) return {first:toks[1],last:toks[0]};
    return {first:toks[0],last:toks[1]};
  }
  if(toks[toks.length-1].length===1) toks=toks.slice(0,-1);
  return {first:toks.slice(0,-1).join(' '),last:toks[toks.length-1]};
}
function scheduleNamesMatch(a,b){
  const x=scheduleNameParts(a),y=scheduleNameParts(b);
  if(!x||!y) return false;
  if(x.last!==y.last) return false;
  if(!x.first||!y.first) return true;
  if(x.first===y.first) return true;
  if(x.first[0]!==y.first[0]) return false;
  return x.first.length===1||y.first.length===1;
}
// Candidate person names in a line of schedule text: "Last, First",
// "F. Last", or "First Last". Known facilities and shift words are
// excluded so "Charleston Area Medical Center" or "Second Call" never
// pose as a person.
function scheduleNameCandidates(line){
  const out=[];
  const clean=String(line||'');
  const facWords=(db.facilities||[]).map(f=>f.name).filter(Boolean);
  const isFacility=(c)=>facWords.some(fn=>fn.toLowerCase()===c.toLowerCase());
  const isShiftWord=(c)=>/^(second call|first call|8-hour day|12-hour shift|24-hour call|10-hour shift|off|pto|day shift|night shift)$/i.test(c.trim());
  const push=(c)=>{c=String(c||'').trim(); if(c&&!out.includes(c)&&!isFacility(c)&&!isShiftWord(c))out.push(c)};
  let m;
  const reComma=/([A-Z][a-z]+),\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/g;
  while((m=reComma.exec(clean)))push(m[1]+', '+m[2]);
  const reInitial=/\b([A-Z]\.\s*[A-Z][a-z]+)\b/g;
  while((m=reInitial.exec(clean)))push(m[1]);
  const reFull=/\b([A-Z][a-z]+ [A-Z][a-z]+)\b/g;
  while((m=reFull.exec(clean)))push(m[1]);
  return out;
}

// --- Schedule-file parsing (on-device) ---
// CSV, pasted text, text-layer PDF, or .xlsx (SheetJS from CDN, loaded
// only when an .xlsx is chosen — same on-demand pattern as PDF.js).
// Every row is classified before anything is saved:
//   matched   — a name in the row matches the schedule name: included.
//   other     — a name in the row is someone else: excluded, never saved.
//   uncertain — no name found in the row: UNCHECKED, user checks to include.
// If the file contains no names at all it is treated as the user's own
// schedule (a personal export has no list to pick from); the preview says
// so plainly and every row stays editable and uncheckable.
function scheduleParseDateToken(tok){
  tok=String(tok||'').trim(); if(!tok) return '';
  let m=tok.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if(m) return m[1]+'-'+m[2].padStart(2,'0')+'-'+m[3].padStart(2,'0');
  m=tok.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if(m){let y=+m[3]; if(y<100)y+=2000; return y+'-'+m[1].padStart(2,'0')+'-'+m[2].padStart(2,'0')}
  m=tok.match(/^(\d{1,2})\/(\d{1,2})$/);
  if(m){const y=new Date().getFullYear(); return y+'-'+m[1].padStart(2,'0')+'-'+m[2].padStart(2,'0')}
  const months={jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12};
  m=tok.match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?$/);
  if(m){const mo=months[m[1].slice(0,3).toLowerCase()]; if(!mo)return ''; const y=m[3]?+m[3]:new Date().getFullYear(); return y+'-'+String(mo).padStart(2,'0')+'-'+m[2].padStart(2,'0')}
  m=tok.match(/^(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\.?(?:\s+(\d{4}))?$/);
  if(m){const mo=months[m[2].slice(0,3).toLowerCase()]; if(!mo)return ''; const y=m[3]?+m[3]:new Date().getFullYear(); return y+'-'+String(mo).padStart(2,'0')+'-'+m[1].padStart(2,'0')}
  return '';
}
function scheduleFindDate(line){
  const pats=[/\b\d{4}-\d{1,2}-\d{1,2}\b/,/\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/,/\b\d{1,2}\/\d{1,2}\b/,/\b[A-Za-z]{3,9}\.?\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s+\d{4})?\b/,/\b\d{1,2}(?:st|nd|rd|th)?\s+[A-Za-z]{3,9}\.?(\s+\d{4})?\b/];
  for(const p of pats){const m=String(line||'').match(p); if(m){const iso=scheduleParseDateToken(m[0]); if(iso)return iso}}
  return '';
}
function scheduleTypeFor(text){
  if(/\boff\b|\bpto\b|vacation|holiday/i.test(String(text||'')))return 'Off / PTO';
  const st=contractShiftType(String(text||''));
  if(!st||st==='Call (unclassified)')return 'Other';
  return st;
}
function scheduleClassifyRow(r){
  const name=scheduleName();
  const cands=scheduleNameCandidates((r.name||'')+' '+(r.text||''));
  let match='uncertain',matchedName='';
  if(r.name&&name&&scheduleNamesMatch(r.name,name)){match='matched';matchedName=r.name}
  else if(cands.length){
    const hit=cands.find(c=>name&&scheduleNamesMatch(c,name));
    if(hit){match='matched';matchedName=hit}
    else if(name){match='other';matchedName=cands[0]}
    // No schedule name on file (a fresh account): a found name cannot
    // be called someone else's — 'other' asserts it is not the user's,
    // which is unknowable until they say who they are. Leave it
    // uncertain so the user checks it themselves.
  }
  return {match,matchedName,hasName:!!String(r.name||'').trim()||cands.length>0};
}
// --- Whose rows are these? (Nov 10, 2026 — Caleb's rule) ---
// Every import path decides "is this row the signed-in user?" the
// same way: scheduleNamesMatch on parsed name parts. A profile
// "Caleb Martin" matches a row labelled "Martin", "C. Martin",
// "Martin, Caleb", "MARTIN" or "Martin C" — last name equal and the
// first name compatible or absent. The ONE gap that rule can't
// close: the same import carrying two DIFFERENT people who share
// the user's last name ("Martin, Caleb" next to "Martin, Josh", or
// a bare "Martin" beside a "J. Martin"). Then the preview asks —
// once, in words, listing the labels — and remembers the answer per
// import source + last name. Unchosen labels stay out and are
// reported, never silently imported and never silently dropped; a
// bare last name with no competing same-name person resolves to the
// user without asking.
function scheduleRowSurnameIds(r){
  const pp=scheduleNameParts(scheduleName()); if(!pp)return[];
  const names=[]; const push=(n)=>{const s=String(n||'').trim(); if(s&&!names.includes(s))names.push(s)};
  push(r.name);
  for(const c of scheduleNameCandidates(r.text||''))push(c);
  return names.map(n=>({raw:n,parts:scheduleNameParts(n)})).filter(x=>x.parts&&x.parts.last===pp.last);
}
function namePartsCompatible(a,b){
  if(!a||!b||a.last!==b.last)return false;
  if(!a.first||!b.first)return true;
  if(a.first===b.first)return true;
  return a.first[0]===b.first[0]&&(a.first.length===1||b.first.length===1);
}
function scheduleNameAmbiguityOf(preview){
  const pp=scheduleNameParts(scheduleName()); if(!pp||!preview)return null;
  const byKey=new Map();
  (preview.rows||[]).forEach((r,i)=>{
    const ids=scheduleRowSurnameIds(r); if(!ids.length)return;
    const id=ids[0]; const key=id.parts.last+'|'+id.parts.first;
    if(!byKey.has(key))byKey.set(key,{key,first:id.parts.first,last:id.parts.last,rows:new Set()});
    byKey.get(key).rows.add(i);
  });
  if(!byKey.size)return null;
  const named=[...byKey.values()].filter(e=>e.first);
  const bare=[...byKey.values()].filter(e=>!e.first);
  const clusters=[];
  for(const e of named){
    const hit=clusters.find(c=>namePartsCompatible(c,e));
    if(hit){hit.entries.push(e);hit.rows=new Set([...hit.rows,...e.rows]);if(e.first.length>hit.first.length)hit.first=e.first}
    else clusters.push({first:e.first,last:e.last,entries:[e],rows:new Set(e.rows)});
  }
  if(bare.length){
    if(clusters.length===1){const c=clusters[0];c.entries.push(...bare);c.rows=new Set([...c.rows,...bare[0].rows]);if(bare.length>1)for(let k=1;k<bare.length;k++){c.entries.push(bare[k]);c.rows=new Set([...c.rows,...bare[k].rows])}}
    else if(!clusters.length)return null;
    else clusters.push({first:'',last:pp.last,entries:bare,rows:new Set(bare.flatMap(e=>[...e.rows]))});
  }
  if(clusters.length<2)return null;
  const cap=(s)=>s?s.charAt(0).toUpperCase()+s.slice(1):'';
  return clusters.map(c=>({key:c.entries.map(e=>e.key).sort().join('+'),label:cap(c.last)+(c.first?', '+cap(c.first):''),rows:[...c.rows],count:c.rows.size}));
}
function applyNameAmbiguity(preview){
  const amb=preview&&preview.nameAmb; if(!amb)return;
  const candRows=new Map(); amb.candidates.forEach(c=>c.rows.forEach(i=>candRows.set(i,c)));
  (preview.rows||[]).forEach((r,i)=>{
    const c=candRows.get(i); if(!c)return;
    r.flags=(r.flags||[]).filter(f=>f!=='other person — excluded'&&f!=='uncertain — check to include'&&!f.startsWith('same last name as you')&&!f.startsWith('left out — same last name'));
    if(!amb.picks){r.match='uncertain';r.include=false;r.flags.push('same last name as you — pick which label is you below')}
    else if(amb.picks.includes(c.key)){r.match='matched';if(!r.matchedName)r.matchedName=r.name||'';r.include=true}
    else{r.match='other';r.include=false;r.flags.push('left out — same last name, not the label you picked')}
  });
}
function finalizeScheduleNameMatching(preview){
  if(!preview)return;
  const candidates=scheduleNameAmbiguityOf(preview);
  if(!candidates){preview.nameAmb=null;return}
  const pp=scheduleNameParts(scheduleName());
  const source=preview.source||'schedule-import';
  const memKey=source+'|'+pp.last;
  const candKeys=candidates.map(c=>c.key).sort();
  const stored=(db.settings&&db.settings.namePicks&&db.settings.namePicks[memKey])||null;
  let picks=null,preselect=[];
  if(stored&&Array.isArray(stored.cands)&&stored.cands.slice().sort().join('~')===candKeys.join('~')&&Array.isArray(stored.picks))picks=stored.picks.slice();
  else if(stored&&Array.isArray(stored.picks))preselect=stored.picks.filter(k=>candKeys.includes(k));
  preview.nameAmb={surname:pp.last.charAt(0).toUpperCase()+pp.last.slice(1),memKey,candidates,picks,preselect};
  applyNameAmbiguity(preview);
}
function scheduleNameAmbiguityHTML(preview){
  const amb=preview&&preview.nameAmb; if(!amb)return'';
  const leftOut=amb.picks?amb.candidates.filter(c=>!amb.picks.includes(c.key)):[];
  const leftCount=leftOut.reduce((n,c)=>n+c.count,0);
  const checked=(c)=>amb.picks?amb.picks.includes(c.key):(amb.preselect||[]).includes(c.key);
  return `<div class="item" style="display:block"><p><strong>More than one ${escapeHTML(amb.surname)} on this schedule.</strong></p><p class="muted">Tick every label that is you — we'll remember for this kind of import, so we only ask once.</p>${amb.candidates.map(c=>`<label style="display:block;margin:4px 0"><input type="checkbox" class="nameAmbPick" data-key="${escapeHTML(c.key)}" ${checked(c)?'checked':''}> ${escapeHTML(c.label)} — ${c.count} row${c.count===1?'':'s'}</label>`).join('')}<div class="form-actions"><button type="button" data-action="name-amb-confirm">These are mine — keep going</button></div>${amb.picks&&leftCount?`<p class="hint">${leftCount} row${leftCount===1?'':'s'} under a similar name (${leftOut.map(c=>escapeHTML(c.label)).join(', ')}) ${leftCount===1?'was':'were'} left out — if one of those is you, tick it above and confirm again.</p>`:''}</div>`;
}
function parseScheduleText(text,fileName){
  const clean=String(text||'').replace(/^\uFEFF/,'');
  const name=scheduleName();
  const rows=[];
  let anyName=false;
  const pushRow=(r)=>{
    const duplicate=(db.shifts||[]).some(x=>shiftsSameShift(x,r));
    const cls=scheduleClassifyRow(r);
    if(cls.hasName)anyName=true;
    const flags=[];
    if(duplicate)flags.push('already in CRNA Hub — will merge, not double');
    if(cls.match==='other')flags.push('other person — excluded');
    if(cls.match==='uncertain')flags.push('uncertain — check to include');
    if(r.facility&&!facilityByNameOrAlias(r.facility))flags.push('new facility — will be suggested, not created');
    rows.push({...r,match:cls.match,matchedName:cls.matchedName,include:cls.match==='matched',duplicate,flags,incomplete:!String(r.pay||'').trim(),source:'schedule-import'});
  };
  // Tabular first: CSV rows (or pasted tab/comma rows) with a date.
  const csvRows=parseCSV(clean);
  const headerIdx=csvRows.findIndex(r=>r.some(c=>/^\s*date\s*$/i.test(String(c||'').trim())));
  if(headerIdx>=0){
    const header=csvRows[headerIdx].map(c=>String(c||'').trim().toLowerCase());
    const col=(...keys)=>header.findIndex(h=>keys.some(k=>h.includes(k)));
    const ciDate=col('date'),ciName=col('name','provider','staff','person','crna'),ciFac=col('facility','hospital','location','site'),ciType=col('shift','type','assignment','role'),ciPay=col('pay','rate','amount','gross');
    for(let i=headerIdx+1;i<csvRows.length;i++){
      const r=csvRows[i]; if(!r||!r.some(c=>String(c||'').trim()))continue;
      const date=ciDate>=0?scheduleParseDateToken(r[ciDate]):'';
      if(!date)continue;
      const facCell=ciFac>=0?String(r[ciFac]||'').trim():'';
      const facObj=facCell?contractFacilityForLine(facCell,''):null;
      const facility=facObj?facObj.name:facCell;
      const type=ciType>=0?scheduleTypeFor(r[ciType]):scheduleTypeFor(r.join(' '));
      const pay=ciPay>=0?String(r[ciPay]||'').replace(/[$,]/g,'').trim():'';
      const nm=ciName>=0?String(r[ciName]||'').trim():'';
      pushRow({date,facility,type,pay,name:nm,text:r.join(' ')});
    }
  } else {
    // Line-based: each line carrying a date is one shift row.
    for(const rawLine of clean.split(/\r?\n/)){
      const line=String(rawLine||'').trim(); if(!line)continue;
      const date=scheduleFindDate(line); if(!date)continue;
      const facObj=contractFacilityForLine(line,'');
      const facility=facObj?facObj.name:'';
      const type=scheduleTypeFor(line);
      const payM=line.match(/\$([\d,]+(?:\.\d{2})?)/);
      pushRow({date,facility,type,pay:payM?payM[1].replace(/,/g,''):'',name:'',text:line});
    }
  }
  // No names anywhere: a personal export, not a staff list.
  if(rows.length&&!anyName){
    for(const r of rows){r.match='matched';r.matchedName='';r.include=true;r.flags=r.flags.filter(f=>f!=='uncertain — check to include')}
  }
  const built={fileName,source:'schedule-import',matchedName:name,rows,noNamesInFile:rows.length>0&&!anyName,ai:false};
  finalizeScheduleNameMatching(built);
  return built;
}
async function loadSheetJS(){
  if(typeof window!=='undefined'&&window.XLSX)return window.XLSX;
  await new Promise((res,rej)=>{const s=document.createElement('script');s.src='https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';s.onload=res;s.onerror=()=>rej(new Error('Spreadsheet library (SheetJS CDN) failed to load — check your connection and try again, or export the sheet as CSV first.'));document.head.appendChild(s)});
  return window.XLSX;
}
async function parseScheduleXlsx(file){
  const XLSX=await loadSheetJS();
  const buf=await file.arrayBuffer();
  const wb=XLSX.read(buf,{type:'array'});
  const ws=wb.Sheets[wb.SheetNames[0]];
  if(!ws)throw new Error('That spreadsheet has no readable sheet.');
  return XLSX.utils.sheet_to_csv(ws);
}

// --- Schedule import: preview-before-save (nothing auto-saves) ---
let schedulePreview=null,scheduleImportError='',scheduleAiStatus='',scheduleImportContext='';
function scheduleImportHTML(){
  const nm=scheduleName();
  // Collapsed by default (Nov 6, 2026): once a calendar is synced (or a
  // schedule was already imported) uploading is the secondary path, so
  // it sits behind its header — one tap to expand, controls unchanged.
  // It starts open only for a fresh user with neither (onboarding
  // step 2) or while an import is mid-flight (preview/status showing),
  // so a re-render never slams it shut on an in-progress preview.
  const connected=typeof liveSyncConnectedProviders==='function'&&liveSyncConnectedProviders().length>0;
  const imported=!!(db.settings&&db.settings.scheduleImported);
  const busy=!!(schedulePreview||scheduleImportError||scheduleAiStatus||scheduleImportContext);
  const open=busy||(!connected&&!imported);
  // Upload a schedule is its own top-level panel now (Nov 6, 2026) — a
  // sibling of Live calendar sync and QGenda, same visual rank — and
  // the .ics import/export fallback lives inside it.
  const body=`<p class="muted">No live calendar? Upload a schedule instead — we’ll pick out only your shifts.</p>${scheduleImportContext==='qgenda'?'<p class="hint">Signed in to QGenda? Upload a screenshot of the schedule page or a Reports export here — the app reads it and shows a preview before saving anything. Screenshots never check themselves; if your QGenda feed is connected, the app checks it each time you open CRNA Hub and new shifts wait here for your review.</p>':''}<details class="csp-info"><summary>Taking a photo of a paper schedule?</summary><p class="muted">One photo of the whole grid is best — dates across the top and your name row both in frame.</p><p class="muted">Straight-on and sharp helps — the app zooms into your row for a close-up read, so there's no need to crop.</p><p class="muted">Check the preview before approving — cells the reads couldn't agree on are flagged for you.</p></details><form id="scheduleForm"><div class="form-grid">${field('scheduleNameUpload','Name as it appears on your schedule','text',nm,'placeholder="e.g. J. Doe"')}${field('scheduleFile','Choose a schedule file','file','','accept=".csv,.xlsx,.pdf,.png,.jpg,.jpeg,.webp,.heic,text/plain,text/csv"')}${area('scheduleText','Or paste schedule text','','2026-11-10, Riverside General, 8-hour day\nNov 12 — J. Doe — Riverside 8/2nd call')}</div><div class="form-actions"><button type="submit">Read schedule — preview only (nothing saved yet)</button><button type="button" class="secondary" data-action="save-schedule-name">Save name only</button></div></form>${scheduleAiStatus?`<p class="hint">${escapeHTML(scheduleAiStatus)}</p>`:''}${scheduleImportError?`<p class="hint">${escapeHTML(scheduleImportError)}</p>`:''}<div style="margin-top:14px">${(qgendaSheetOpen&&qgendaPendingPreview())?'<p class="muted">Your QGenda preview is open in front of you — approve it there, or close it and it will wait here.</p>':schedulePreviewHTML()}</div><details><summary>Manual fallback — import or export a .ics file</summary><h3>Import shifts from a calendar (.ics)</h3><p class="muted">Export your calendar as a .ics file and import it here — duplicates are skipped, never doubled.</p><form id="calendarForm"><div class="form-grid">${field('calFile','Choose .ics file','file','','accept=".ics,text/calendar"')}${select('calSource','Which calendar is this from?',['Google Calendar','Apple Calendar','Outlook','Calendar file'],'Calendar file')}</div><div class="form-actions"><button type="submit">Parse calendar — preview only (nothing saved yet)</button></div></form>${calImportError?`<p class="hint">${escapeHTML(calImportError)}</p>`:''}<div style="margin-top:14px">${calPreviewHTML()}</div><h3>Export shifts to a calendar (.ics)</h3><div class="toolbar"><button data-action="export-cal-all">Download all shifts (.ics)</button><button data-action="export-cal-month">Download this month (.ics)</button></div></details>`;
  return collapsePanelHTML('schedule-import-panel','Upload a schedule',body,open);
}
// A preview row's facility is RESOLVED only when it names one of the
// user's saved facilities (name or alias). A blank facility and a name
// that matches nothing saved are both unresolved: the preview asks
// once — "Which facility is this schedule for?" — and the answer
// applies to exactly the unresolved rows. A resolved row's own
// facility always wins, and a row the user hand-types a facility into
// counts as answered (their typing is their choice).
function scheduleRowFacilityResolved(r){
  if(r&&r._userTypedFacility)return true;
  return !!facilityByNameOrAlias(r&&r.facility);
}
function schedulePreviewNeedsFacility(preview){
  // Any row the user could bring in counts — not only rows already
  // checked. Rows arrive unchecked whenever the read could not match
  // them to the schedule name (a fresh account may have no schedule
  // name saved yet, and grid reads carry no name at all); gating the
  // question on `include` made it vanish in exactly those cases, and
  // the user then approved with no facility prompt at all (Caleb,
  // Nov 7, 2026, fresh start). Someone else's rows ('other') are the
  // only ones that never count — they can never be included.
  return !!preview&&(preview.rows||[]).some(r=>r.match!=='other'&&!scheduleRowFacilityResolved(r));
}
function schedulePreviewHTML(){
  if(!schedulePreview)return '<p class="muted">No schedule parsed yet. Choose a file above, then read it — nothing is saved until you approve the preview.</p>';
  const rows=schedulePreview.rows;
  const matched=rows.filter(r=>r.match==='matched').length,other=rows.filter(r=>r.match==='other').length,unc=rows.filter(r=>r.match==='uncertain').length,dup=rows.filter(r=>r.duplicate).length;
  return `<p><strong>Parsed from:</strong> ${escapeHTML(schedulePreview.fileName)} · ${rows.length} row(s) · ${rows.filter(r=>r.include&&!r.duplicate).length} would be added · ${dup} duplicate(s) will merge into the existing shift — never doubled</p><p class="muted">Matched name: <strong>${escapeHTML(schedulePreview.matchedName||'(not set — add it above)')}</strong>${schedulePreview.noNamesInFile?' — no names found in this file, so it was treated as your own schedule; uncheck anything that is not yours.':''} ${matched} row(s) matched you, ${other} row(s) for other people are excluded, ${unc} uncertain row(s) are unchecked — check one to include it. Rows with a missing date — or a missing facility with no grid code — block approval until fixed or unchecked; grid-code rows save without a facility and stay unpriced. Imported shifts arrive confirmed — they are on a real schedule.</p>${scheduleNameAmbiguityHTML(schedulePreview)}${schedulePreviewNeedsFacility(schedulePreview)?`<div class="form-grid"><div class="field"><label for="schedFacilityAll">Which facility is this schedule for?</label><input id="schedFacilityAll" class="schedFacilityAll" list="facilityNamesSched" value="${escapeHTML(schedulePreview.facilityAll||'')}" placeholder="e.g. RGH"><datalist id="facilityNamesSched">${(db.facilities||[]).map(f=>`<option value="${escapeHTML(f.name)}"></option>`).join('')}</datalist></div></div><p class="muted">Applies to any row whose facility is missing or not one of your saved facilities — each row stays editable below. A name that isn't saved yet is added to your facilities when you approve.</p>`:''}${payUnitControlHTML(schedulePreview,'sched')}${importRatesPromptHTML(schedulePreview,'sched')}${importPaySchedHTML(schedulePreview,'sched')}${importConflictsHTML(schedulePreview,'sched')}<div class="table-scroll"><table class="contract-table"><thead><tr><th></th><th>Date</th><th>Facility</th><th>Shift type</th><th>Pay ${schedulePreview.payUnit==='hourly'?'(\$/hr)':'(\$ per shift)'}</th><th>Name on row</th><th>Flags</th></tr></thead><tbody>${rows.map((r,i)=>`<tr><td><input type="checkbox" class="schedInclude" data-row="${i}" ${r.include?'checked':''} ${r.match==='other'?'disabled':''}></td><td><input type="date" class="schedEdit" data-row="${i}" data-field="date" value="${escapeHTML(r.date||'')}"></td><td><input class="schedEdit" data-row="${i}" data-field="facility" value="${escapeHTML(r.facility||'')}"></td><td><input class="schedEdit" data-row="${i}" data-field="type" value="${escapeHTML(r.code||r.type||'')}"></td><td><input class="schedEdit" data-row="${i}" data-field="pay" value="${escapeHTML(r.pay||'')}"></td><td>${escapeHTML(r.matchedName||r.name||'—')}</td><td>${r.flags.map(f=>`<span class="pill warn">${escapeHTML(f)}</span>`).join(' ')||'<span class="pill">clean</span>'}</td></tr>`).join('')}</tbody></table></div><div class="form-actions"><button type="button" data-action="schedule-approve">Approve selected — add shifts</button><button type="button" class="secondary" data-action="schedule-discard">Discard preview</button></div>`;
}
async function importSchedule(e){
  e.preventDefault(); scheduleImportError=''; scheduleAiStatus='';
  const nameField=$('f_scheduleNameUpload'); const name=nameField?String(nameField.value||'').trim():'';
  if(name){db.settings=db.settings||{}; db.settings.scheduleName=name; persist();}
  const files=$('f_scheduleFile')?Array.from($('f_scheduleFile').files||[]):[];
  const f=files[0]||null;
  const imageFiles=files.filter(isImageFile);
  if(imageFiles.length){
    if(!SUPABASE_CONFIGURED||!cloudSession){scheduleImportError='AI reading needs you signed in on the Account tab — sign in and submit again, or upload a CSV or text file instead (read on this device). Nothing was sent, nothing was saved.';render();return}
    return readScheduleWithAI(imageFiles);
  }
  try{
    let text='',fileName='pasted text';
    if(f){fileName=f.name; const ext='.'+(String(f.name.split('.').pop()||'').toLowerCase());
      if(ext==='.pdf'){text=await extractPdfText(f)}
      else if(ext==='.xlsx'){text=await parseScheduleXlsx(f)}
      else{text=await f.text()}
    } else {text=$('f_scheduleText')?$('f_scheduleText').value:''}
    if(!text.trim()){scheduleImportError='Nothing to parse: choose a schedule file or paste schedule text first. Nothing was saved.';schedulePreview=null;render();return}
    const parsed=parseScheduleText(text,fileName);
    if(!parsed.rows.length){scheduleImportError='No shifts were found in this file (no date + shift pattern). Check the file and try again, or add the shifts manually on the Dashboard. Nothing was saved.';schedulePreview=null;render();return}
    schedulePreview=parsed; scheduleAiStatus=''; render();
  }catch(err){scheduleImportError='Could not read this file: '+err.message+' Nothing was saved.';schedulePreview=null;render()}
}
function approveScheduleImport(){
  if(!schedulePreview)return;
  // Housekeeping rows are excluded at the door (Nov 9, 2026): a
  // sync-marker "shift" from a stale preview can never be saved,
  // whatever its include flag says.
  let rows=schedulePreview.rows.filter(r=>r.include&&r.match!=='other'&&!isHousekeepingShiftName(rowCodeKey(r))&&!isHousekeepingShiftName(r.type));
  // One facility for the whole schedule (a grid prints none; a feed
  // may name a facility the user has not saved): applies to exactly
  // the rows whose facility is unresolved — blank, or matching no
  // saved facility. A row's own resolved facility always wins, and a
  // facility the user typed into a row by hand is left alone.
  const fillFac=String(schedulePreview.facilityAll||(($('schedFacilityAll')||{}).value)||'').trim();
  if(fillFac){const fillTarget=facilityByNameOrAlias(fillFac);const pendingFill=rows.filter(r=>!scheduleRowFacilityResolved(r));for(const r of pendingFill){const prevFac=String(r.facility||'').trim();r.facility=fillFac;if(fillTarget&&prevFac&&prevFac.length<=12&&/^[A-Za-z0-9][A-Za-z0-9.&']*$/.test(prevFac))addFacilityAlias(fillTarget,prevFac)}}
  // One assignment per day (December round): day rows standing
  // beside a call row for the same facility are absorbed into it
  // before anything prices or saves — see combineDayCallRows.
  rows=combineDayCallRows(rows);
  // A schedule-level name that matches nothing saved is the user
  // naming the facility — create it on approve (blank rates; pay
  // rules are set on the Facilities tab) instead of saving shifts
  // that point at a facility which does not exist and only ever
  // becomes a Dashboard suggestion. Created BEFORE the row loop so
  // the rows resolve (and price, when rates exist) against it and
  // no duplicate suggestion is recorded for the same name. On a
  // fresh device with zero saved facilities this is the normal
  // path, not an edge case.
  let createdFacility='',ratesSavedFor='',ratesSkippedFor='';
  const ratesTarget=importRatesTarget(schedulePreview.ratesSkipped?{...schedulePreview,ratesSkipped:false}:schedulePreview);
  if(ratesTarget){
    const applied=applyImportDescribed(schedulePreview,ratesTarget);
    if(applied.saved){ratesSavedFor=ratesTarget.name;if(!ratesTarget.fac)createdFacility=ratesTarget.name}
    else if(schedulePreview.ratesSkipped)ratesSkippedFor=ratesTarget.name;
  }
  if(fillFac&&!facilityByNameOrAlias(fillFac)){
    db.facilities=db.facilities||[];
    db.facilities.push({id:id(),name:fillFac,aliases:'',address:'',rate8:'',rate10:'',rate12:'',rate24:'',rateSecond:'',hourlyRate:'',paidHours8:'',callBonus:'',distance:'',notes:'',...(schedulePreview.ratesSkipped?{ratesPromptSkipped:true}:{})});
    createdFacility=fillFac;
  }
  // A grid-code row may save without a facility (the grid prints
  // none) — it stays unpriced, carrying its code as the type.
  const blocked=rows.filter(r=>!r.date||!/^\d{4}-\d{2}-\d{2}$/.test(r.date)||(!String(r.facility||'').trim()&&!String(r.code||'').trim()));
  if(blocked.length){alert('Fix or uncheck these rows before approving: '+(blocked.map(r=>`${r.date||'(no date)'} ${r.facility||'(no facility)'} ${r.type}`).join('; ')));return}
  if(!rows.length){alert('Nothing selected to add — check the rows that are yours, or discard the preview.');return}
  // Build the exact records first (pricing unchanged), then run
  // the double-booking guard over them (v115): exact duplicates
  // merge as always; a DIFFERENT shift on an already-booked date
  // stops the approve until the user decides per conflict.
  const builtRows=[];
  for(const r of rows){
    let pay='',inc=true,payRate='',payUnit='',shiftType=r.type;
    const facForRow=facilityByNameOrAlias(r.facility);
    if(String(r.pay||'').trim()){const conv=previewPayConversion(r.pay,schedulePreview.payUnit,r.type,facForRow);pay=conv.pay;payRate=conv.payRate;payUnit=conv.payUnit;inc=!pay;
      // A QGenda row's pay was computed by the server FROM this
      // facility's own saved rates — it is a formula result, not a
      // number anyone typed. When it matches the rule exactly, keep
      // it marked as facility-derived so a later rate correction
      // reprices it like every other derived pay.
      if((r.source==='qgenda'||r.source==='qgenda-feed')&&facForRow){const fp=facilityPayFor(facForRow,r.type,r.date);if(fp>0&&Math.abs(fp-Number(pay))<0.005){payUnit='facility';payRate=''}}}
    if(facForRow){const cp=clarifiedRowPricing(facForRow,r);if(cp){shiftType=cp.type;if(!pay&&cp.pay){pay=cp.pay;payRate=cp.payRate;payUnit=cp.payUnit;inc=false}}}
    if(!pay&&facForRow){const p=facilityPayFor(facForRow,shiftType,r.date); if(p>0){pay=String(p);payUnit='facility';inc=false}}
    builtRows.push({row:r,noPay:!pay,rec:{id:id(),date:r.date,facility:String(r.facility).trim(),type:shiftType,code:String(r.code||'').trim(),pay,payRate,payUnit,status:importStatusForDate(r.date),source:r.source||'schedule-import',sources:[r.source||'schedule-import'],incomplete:inc,updatedAt:new Date().toISOString(),note:'Schedule import: '+schedulePreview.fileName+(schedulePreview.matchedName?(' — matched name "'+schedulePreview.matchedName+'"'):'')}});
  }
  const gate=importGateCheck(schedulePreview,builtRows.map(b=>b.rec));
  if(gate.stopped){render();gateStopAlert();return}
  const addSet=new Set([...gate.clean,...gate.dups,...(gate.addAnyway||[]).map(c=>c.rec)]);
  const leftOut=(gate.skippedConflicts||[]).length;
  let created=0,skipped=0,incomplete=0; const newNames=[];
  for(const b of builtRows){
    if(!addSet.has(b.rec))continue;
    const r=b.row;
    const res=addShiftDeduped(b.rec);
    if(res.merged){skipped++;continue}
    if(b.noPay)incomplete++;
    created++;
    if(r.facility&&!facilityByNameOrAlias(r.facility)&&!newNames.some(n=>normFacilityName(n)===normFacilityName(r.facility)))newNames.push(r.facility);
  }
  if(newNames.length)mergeFacilitySuggestions('schedule-import',newNames.map(n=>({name:n,count:(db.shifts||[]).filter(x=>normFacilityName(x.facility)===normFacilityName(n)).length,firstDate:'',lastDate:''})),schedulePreview.fileName);
  // A re-approve that just taught the facility new rates (a call
  // split, corrected hours) heals the shifts an earlier approve of
  // the same rows already saved — merges kept their old amounts, so
  // reprice the facility's derived pays before the totals are read.
  if(ratesTarget){const rf=facilityByNameOrAlias(ratesTarget.name);if(rf)repriceUnpricedShiftsForFacility(rf)}
  const paySchedSaved=applyImportPaySched(schedulePreview,'sched');
  const paySchedHint=importPaySchedHint(schedulePreview,'sched',paySchedSaved);
  const fileName=schedulePreview.fileName;
  acknowledgeImportConflicts(gate);
  schedulePreview=null; scheduleAiStatus=''; scheduleImportError=''; qgendaSheetOpen=false; qgendaClearPending(); db.settings=db.settings||{}; db.settings.scheduleImported=true; db.settings.scheduleImportFile=fileName; db.settings.scheduleImportedAt=new Date().toISOString();
  persist(); render();
  if(typeof window!=='undefined'&&typeof window.liveSyncSchedulePush==='function')window.liveSyncSchedulePush();
  alert(`Added ${created} shift(s) from the schedule.${skipped?` Merged ${skipped} duplicate(s) into existing shifts — never doubled.`:''}${createdFacility&&ratesSavedFor!==createdFacility?` Added ${createdFacility} to your facilities — set its pay rules on the Facilities tab.`:''}${ratesSavedFor?` Rates saved for ${ratesSavedFor} — these shifts priced from them.`:''}${ratesSkippedFor?` No rates for ${ratesSkippedFor} yet — its shifts are unpriced; set rates any time on the Facilities tab.`:''}${incomplete?` ${incomplete} unpriced — set the pay rule on the Facilities tab.`:''}${newNames.length?` New facilit(ies) noticed — check the suggestion on the Dashboard before their shifts are priced.`:''}${paySchedSaved?` Pay schedule saved for ${paySchedSaved.agency} — paychecks for these shifts now show on your calendar.`:''}${paySchedHint}${leftOut?` Left out ${leftOut} shift(s) that would double-book you — tick "Add it anyway" in the preview if you really have both.`:''} Imported shifts arrive confirmed — they are on a real schedule.`);
}
// Photos of a schedule go to the same AI reader as contracts, in
// "schedule" mode: the server prompt returns only shifts for the
// schedule name, and the client still classifies every row before
// showing the preview — an AI row for someone else stays excluded.
async function callExtractSchedule(files,scheduleNm,opts){
  if(!SUPABASE_CONFIGURED)throw new Error('Supabase is not configured yet.');
  if(!cloudSession)throw new Error('Not signed in — sign in on the Account tab first.');
  const o=opts||{};
  const images=o.images?o.images:await aiContractImagesDataURLs(files);
  if(!images.length)throw new Error('Could not read these photos in this browser — try JPG or PNG exports.');
  const payload={action:'extract-contract',mode:'schedule',scheduleName:scheduleNm,images};
  if(o.locate)payload.locate=true;
  if(o.band)payload.band=true;
  let data;
  try{data=await liveSyncPost('extract-contract',payload)}
  catch(e){if(e&&e.data&&e.data.error==='openai_key_missing'){const k=new Error(AI_KEY_MISSING_MESSAGE);k.data=e.data;throw k}throw e}
  if(data&&data.error==='openai_key_missing')throw new Error(AI_KEY_MISSING_MESSAGE);
  if(!data||data.ok===false)throw new Error((data&&data.message)||(data&&data.error)||'AI reading failed.');
  return data;
}
function applyAiToSchedulePreview(data,fileName){
  const shifts=Array.isArray(data&&data.shifts)?data.shifts:[];
  if(!shifts.length)return false;
  const name=scheduleName();
  // No names anywhere in the read: the server returns only the
  // schedule name's shifts, so a nameless read is the user's own
  // schedule — the same rule parseScheduleText has always applied to
  // name-free files. Without it every such row sat 'uncertain' and
  // unchecked (screenshots and personal exports often carry no name),
  // and — because the facility question keyed off included rows —
  // a fresh user was never asked for a facility at all.
  const anyNamed=shifts.some(sh=>String(sh.name||'').trim());
  const rows=shifts.map(sh=>{
    const date=String(sh.date||''); const facility=String(sh.facility||'').trim();
    // Grid schedules (Nov 6, 2026): a cell code ("5**") is carried
    // verbatim as the shift type — never interpreted, never priced
    // until the user renames it to a known shift type or maps it in
    // the preview. Grid shifts have no facility on the page.
    const code=String(sh.code||'').trim();
    const type=code||String(sh.type||'Other');
    const rowName=String(sh.name||'').trim();
    const match=!anyNamed?'matched':(rowName?(scheduleNamesMatch(rowName,name)?'matched':(name?'other':'uncertain')):'uncertain');
    const duplicate=(db.shifts||[]).some(x=>shiftsSameShift(x,{date,facility,type,code}));
    const flags=[]; if(duplicate)flags.push('already in CRNA Hub — will merge, not double'); if(match==='other')flags.push('other person — excluded'); if(match==='uncertain')flags.push('uncertain — check to include'); if(facility&&!facilityByNameOrAlias(facility))flags.push('new facility — will be suggested, not created'); if(code)flags.push('grid code "'+code+'" — not a known shift type; saved as-is, unpriced (rename it here if you know it)'); if(sh.check)flags.push('check this one — '+(sh.checkReason||'the two reads of this photo disagreed here'));
    return {date,facility,type,code,pay:String(sh.pay||''),name:rowName,matchedName:rowName,match,include:match==='matched'&&sh.includeDefault!==false,duplicate,flags,source:'schedule-import-ai',incomplete:!String(sh.pay||'').trim()};
  });
  schedulePreview={fileName,source:'schedule-import-ai',matchedName:name,rows,noNamesInFile:!anyNamed,ai:true};
  finalizeScheduleNameMatching(schedulePreview);
  return rows.length>0;
}
// The honest zero-result message for a photo read (Nov 6, 2026): a
// grid that yields nothing must say so — never present "0 shifts"
// as if it were the answer.
function scheduleGridUnreadMessage(){
  const nm=scheduleName();
  return 'No shifts could be read from these photos'+(nm?' for "'+nm+'"':'')+'. If this is a grid schedule (names down the side, dates across the top), I couldn\'t read this grid — try one straight-on photo of the whole grid, dates across the top and your name row both in frame. Check the name as it appears on the schedule (above), or paste the schedule text instead. Nothing was saved.';
}
// Evidence rule for photo reads (Nov 6, 2026): a row counts as a
// real schedule row only if something ties it to an actual schedule
// — a matched person's name, a grid code, a facility, or a real
// shift type. A bare date with type "Other" and nothing else is OCR
// noise (a stray date the linear parser swept up), never a shift.
function scheduleRowHasEvidence(r){
  return !!((r.matchedName&&String(r.matchedName).trim())||String(r.code||'').trim()||String(r.facility||'').trim()||(r.type&&r.type!=='Other'));
}
// On-device fallback when the AI read is unavailable or finds
// nothing: OCR the photos and run the linear parser. Honest status
// line says the read happened on-device. A grid read this way will
// normally still yield nothing (OCR loses the grid alignment) — the
// caller then shows the grid message above. Rows with no evidence
// (above) are dropped, and if nothing with evidence remains the
// fallback reports failure instead of presenting invented rows:
// Caleb's Nov 6 retry OCR'd a dense grid into two date-only "Other"
// rows (Dec 6 / Nov 1) that were NOT his shifts — a fallback that
// fabricates rows is worse than no result.
async function scheduleOcrFallback(images,fileName){
  try{
    let text='';
    for(const f of images.slice(0,4)){ text+='\n'+(await ocrImageFile(f)); }
    if(!text.trim())return false;
    const parsed=parseScheduleText(text,fileName);
    if(!parsed.rows.length)return false;
    parsed.rows=parsed.rows.filter(scheduleRowHasEvidence);
    if(!parsed.rows.length)return false;
    schedulePreview=parsed;
    scheduleAiStatus='AI reading wasn\'t available for these photos, so this was read on your device instead — check the rows carefully before approving.';
    scheduleImportError='';
    return true;
  }catch(e){ return false }
}
// --- Grid double-read reconciliation (Nov 6, 2026 reliability) ---
// Caleb ran the SAME grid photo three times and got three different
// answers (wrong dates twice, "no shifts" once): even pinned to
// temperature 0 server-side, a vision read of a dense grid is not
// guaranteed identical run to run. So a grid read is done TWICE and
// the two reads are reconciled cell by cell:
//   both reads agree (same column, same code, same anchored date)
//     -> solid, no flag;
//   codes differ, dates differ, or a cell appears in only one read
//     -> the cell is shown ONCE, flagged "check this one";
//   a cell whose date could not be anchored to its column header
//     -> flagged the same way.
// Same photo -> same preview; the uncertainty is surfaced on the
// exact cells that carry it, never hidden. List schedules are NOT
// double-read — their behavior is unchanged.
function scheduleReadIsGrid(data){
  const shifts=Array.isArray(data&&data.shifts)?data.shifts:[];
  const hdr=Array.isArray(data&&data.header_dates)?data.header_dates:[];
  return shifts.some(s=>String(s.code||'').trim()!=='')||hdr.filter(d=>String(d||'').trim()).length>=3;
}
function reconcileGridReads(a,b){
  const hdrCount=(d)=>(Array.isArray(d&&d.header_dates)?d.header_dates:[]).filter(x=>String(x||'').trim()).length;
  const gridSeen=hdrCount(a)>=3||(b?hdrCount(b)>=3:false);
  const keyOf=(s)=>{const c=parseInt(s&&s.column,10); if(Number.isFinite(c)&&c>0)return 'col:'+c; return 'date:'+String((s&&s.date)||'')};
  const cells=(d)=>{const m=new Map(); for(const s of (Array.isArray(d&&d.shifts)?d.shifts:[])){ if(!String(s.code||'').trim())continue; const k=keyOf(s); if(!m.has(k))m.set(k,s);} return m;};
  const A=cells(a),B=b?cells(b):new Map();
  const out=[];
  for(const k of new Set([...A.keys(),...B.keys()])){
    const x=A.get(k),y=B.get(k);
    if(x&&y){
      if(String(x.code).trim()===String(y.code).trim()&&String(x.date)===String(y.date)){
        if(x.anchored===false)out.push({...x,check:true,checkReason:'the date for this column could not be verified against the header row'});
        else out.push({...x});
      } else if(String(x.code).trim()!==String(y.code).trim()){
        out.push({...x,check:true,checkReason:'the two reads disagreed on this cell'});
      } else {
        out.push({...x,check:true,checkReason:'the two reads disagreed on the date for this column'});
      }
    } else if(x){
      out.push({...x,check:true,checkReason:b?'only one of the two reads saw this cell':'the second read did not come back, so this cell rests on a single read'});
    } else if(y){
      out.push({...y,check:true,checkReason:'only one of the two reads saw this cell'});
    }
  }
  out.sort((p,q)=>String(p.date).localeCompare(String(q.date))||((parseInt(p.column,10)||0)-(parseInt(q.column,10)||0)));
  return {shifts:out,gridSeen};
}
// --- Grid band extraction (Nov 7, 2026) ---
// Caleb: "If I crop a picture of my grid style schedule then the
// AI won't be able to see what dates I'm working those shifts."
// Right — so the user NEVER crops. The app zooms instead:
//   1. LOCATE: the server returns the grid's header dates and every
//      data row's name label, in order (structure only — measured
//      live, the model's freehand bounding boxes are far too coarse
//      to crop by, so no coordinates are ever requested).
//   2. GEOMETRY (below, on-device, deterministic): the grid's ruled
//      lines are found by pixel scanning the ORIGINAL photo; the
//      model's label list is aligned to the detected row bands,
//      with blank-label rows found by their empty label cells (the
//      model sometimes skips them when counting). That pins the
//      matched name's row band and every date column's span exactly.
//   3. COMPOSITE: the header band and the matched row band are
//      drawn from the original full-resolution photo onto one
//      canvas, columns aligned, with the column numbers burned
//      into a margin — the row is now huge and legible and the
//      dates sit right above their columns.
//   4. BAND READ (server, twice, reconciled like any grid read):
//      the model returns one cells entry per column, so a cell's
//      position comes from the array, not from counting.
//   5. CROSS-CHECK: band cells are compared with the full-photo
//      read; any cell the two methods disagree on (different code,
//      or seen by only one method) is flagged "check this one" —
//      full-photo-only cells also start UNCHECKED, because the
//      full read is the one known to bleed a neighbour's row in.
// Measured live on Caleb's fixture grid (Martin row, Dec 1-5),
// through the deployed function: full-photo read 0/5 correct cells
// with Mitchell's "endo 3" bleeding in; band read (gpt-4o, dates-
// only composite) 5/5 correct, 2/2 runs, no phantom cells. The
// cross-check below still guards every cell. Any failure anywhere
// in this pipeline falls back to the ordinary full-photo double
// read — never to invented rows.
function gridLineRuns(frac,threshold){
  // frac: dark-pixel fraction per pixel line. Returns the centre of
  // each run above threshold (a ruled line, possibly 2-3px thick).
  const runs=[]; let start=-1;
  for(let i=0;i<frac.length;i++){
    if(frac[i]>threshold&&start<0)start=i;
    else if(frac[i]<=threshold&&start>=0){runs.push(Math.round((start+i-1)/2)); start=-1;}
  }
  if(start>=0)runs.push(Math.round((start+frac.length-1)/2));
  return runs;
}
function detectGridGeometry(imgData,W,H,headerCount,labelCount){
  // imgData: Uint8ClampedArray RGBA of the full-resolution photo.
  const darkAt=(x,y)=>{const o=(y*W+x)*4; return (imgData[o]+imgData[o+1]+imgData[o+2])/3<110?1:0;};
  // Text ink for the label test: real grid text is a smooth
  // anti-aliased glyph — MANY pixels in the mid-grey band where a
  // JPEG of a ruled line is almost binary. Measured on the fixture:
  // a name cell scores 6-20% mid-grey; a blank cell ~0-1% (line
  // JPEG ringing only). Counting only near-black pixels missed
  // most glyphs, because the JPEG-soft name text peaks mid-grey.
  const midAt=(x,y)=>{const o=(y*W+x)*4; const v=(imgData[o]+imgData[o+1]+imgData[o+2])/3; return (v>=110&&v<200)?1:0;};
  const step=Math.max(1,Math.floor(Math.min(W,H)/400));
  // Horizontal lines: dark fraction across the width.
  const rowFrac=new Array(H).fill(0);
  let nx=0; for(let x=0;x<W;x+=step)nx++;
  for(let y=0;y<H;y++){let d=0; for(let x=0;x<W;x+=step)d+=darkAt(x,y); rowFrac[y]=d/nx;}
  const hLines=gridLineRuns(rowFrac,0.4);
  if(hLines.length<4)return null;
  // Typical band height from the line spacing.
  const spacings=[]; for(let i=1;i<hLines.length;i++)spacings.push(hLines[i]-hLines[i-1]);
  spacings.sort((a,b)=>a-b);
  const bandH=spacings[Math.floor(spacings.length/2)]||0;
  if(!(bandH>=8&&bandH<=H/4))return null;
  // Row bands between consecutive lines; the header band is the
  // band-height strip immediately ABOVE the first line (the dates
  // sit above the first data row's top border in these grids).
  const bands=[]; for(let i=0;i<hLines.length-1;i++)bands.push({y0:hLines[i],y1:hLines[i+1]});
  const headerBand={y0:Math.max(0,hLines[0]-bandH-2),y1:hLines[0]+2};
  // Align labels to bands: walk bands top-down; a band whose label
  // cell (left ~18% of the grid width) has almost no ink is a
  // blank-label row and consumes one label slot as "".
  const inkOf=(y0,y1,x0,x1)=>{let d=0,n=0; for(let y=y0;y<y1;y+=step)for(let x=x0;x<x1;x+=step){d+=midAt(x,y); n++;} return n?d/n:0;};
  // Vertical lines for the column spans (dark fraction down the
  // grid's vertical extent).
  const colFrac=new Array(W).fill(0);
  let ny=0; for(let y=0;y<H;y+=step)ny++;
  for(let x=0;x<W;x++){let d=0; for(let y=0;y<H;y+=step)d+=darkAt(x,y); colFrac[x]=d/ny;}
  const vLines=gridLineRuns(colFrac,0.4);
  if(vLines.length<headerCount+1)return null;
  // Column spans between consecutive vertical lines.
  const spans=[]; for(let i=0;i<vLines.length-1;i++)spans.push({x0:vLines[i],x1:vLines[i+1]});
  // Layout (measured on the fixture): ONE wide name span, then
  // the date columns; a shaded per-person sub-column hides INSIDE
  // the first date column's span (no full-height rule of its own),
  // and a trailing partial column can sit past the last date.
  // Date columns are therefore spans[1 .. headerCount] — never
  // the last headerCount spans (the trailing partial column
  // shifted those by one, putting every band cell a column
  // early), and the composite must start at the first date span,
  // not at the sub-column.
  const dateSpans=spans.slice(1,1+headerCount).length===headerCount?spans.slice(1,1+headerCount):spans.slice(Math.max(0,spans.length-headerCount));
  if(dateSpans.length<headerCount)return null;
  // The span before the dates is the per-person sub-column
  // (narrow, shaded in these exports); the span before THAT is
  // the wide name column holding the row labels. (On the fixture:
  // names at x 29-181, sub-column 181-250, dates from 250.) The
  // label cell for the ink test spans name column + sub-column.
  const nameSpan=dateSpans[0]===spans[1]?spans[0]:null;
  const labelX0=nameSpan?nameSpan.x0:dateSpans[0].x0;
  const labelX1=dateSpans[0].x0;
  // Coverage gate: a name occupies roughly a fifth of the row
  // height and most bands are empty, so a genuinely blank label
  // cell has essentially NO ink coverage, while any set name —
  // even a short one — covers several percent of its cell. Pin the
  // threshold in that measured gap.
  const aligned=[];
  let li=0;
  for(const b of bands){
    if(li>=labelCount&&aligned.length>=labelCount)break;
    const ink=inkOf(b.y0+3,b.y1-3,labelX0+3,Math.max(labelX0+4,labelX1-3));
    if(ink<0.04){ aligned.push({band:b,label:''}); }
    else { aligned.push({band:b,label:null}); li++; }
    if(aligned.filter(a=>a.label===null).length>labelCount)break;
  }
  const namedCount=aligned.filter(a=>a.label===null).length;
  if(namedCount!==labelCount)return null;
  let n=0;
  const rows=aligned.map(a=>({y0:a.band.y0,y1:a.band.y1,label:a.label===null?(''+(n++)) : ''}));
  // rows[i].label holds the INDEX (as a string) into the model's
  // label list for inked rows, '' for blank-label rows — the caller
  // maps it through the locate result.
  return {headerBand,rows,dateSpans,gridX0:labelX0,gridX1:dateSpans[dateSpans.length-1].x1};
}
async function buildGridBandComposite(file,geom,rowIndex,headerCount){
  try{
    if(typeof createImageBitmap!=='function')return null;
    const bmp=await createImageBitmap(file);
    const W=bmp.width||0,H=bmp.height||0;
    if(!W||!H){if(bmp.close)bmp.close(); return null;}
    const row=geom.rows[rowIndex]; if(!row)return null;
    // DATE COLUMNS ONLY in the composite (measured Nov 7, 2026):
    // including the wide shaded label columns made the reader
    // anchor its column positions to them and shift every code
    // ~4 columns early. The name column is identification, not
    // data — the row was already matched before we get here.
    const x0=geom.dateSpans[0].x0,x1=geom.gridX1;
    const outW=1800,scale=outW/(x1-x0);
    const margin=36,sep=8;
    // Bands are vertically stretched ~2.2x: at natural proportions
    // the composite is a very short, wide strip and the reader's
    // column placement measurably degrades.
    const hH=Math.max(10,Math.round((geom.headerBand.y1-geom.headerBand.y0)*scale*2.2));
    const rH=Math.max(10,Math.round((row.y1-row.y0)*scale*2.2));
    const cv=document.createElement('canvas'); cv.width=outW; cv.height=margin+hH+sep+rH;
    const ctx=cv.getContext('2d'); if(!ctx){if(bmp.close)bmp.close(); return null;}
    ctx.fillStyle='#ffffff'; ctx.fillRect(0,0,cv.width,cv.height);
    ctx.drawImage(bmp,x0,geom.headerBand.y0,x1-x0,geom.headerBand.y1-geom.headerBand.y0,0,margin,outW,hH);
    ctx.drawImage(bmp,x0,row.y0,x1-x0,row.y1-row.y0,0,margin+hH+sep,outW,rH);
    ctx.fillStyle='#c80000'; ctx.font='bold 24px sans-serif'; ctx.textAlign='center';
    for(let i=0;i<headerCount;i++){
      const c=geom.dateSpans[i]; if(!c)continue;
      const cx=((c.x0+c.x1)/2-x0)*scale;
      ctx.fillText(String(i+1),cx,26);
    }
    if(bmp.close)bmp.close();
    const url=typeof cv.toDataURL==='function'?cv.toDataURL('image/jpeg',0.9):null;
    return (typeof url==='string'&&url.indexOf('data:image/jpeg;base64,')===0)?url:null;
  }catch(e){ return null }
}
function crossCheckGridReads(bandShifts,fullData){
  // Compare the band read (already double-read reconciled) with the
  // full-photo read, cell by cell (keyed by column). Agreement is
  // silent; disagreement flags the cell. Band cells stand as the
  // primary read; full-photo-only cells are appended flagged and
  // UNCHECKED by default — the full read is the method known to
  // bleed the row below into this one.
  const keyOf=(s)=>{const c=parseInt(s&&s.column,10); return Number.isFinite(c)&&c>0?'col:'+c:'date:'+String((s&&s.date)||'')};
  const full=new Map();
  for(const s of (Array.isArray(fullData&&fullData.shifts)?fullData.shifts:[])){
    if(!String(s.code||'').trim())continue;
    const k=keyOf(s); if(!full.has(k))full.set(k,s);
  }
  const out=[];
  const seen=new Set();
  for(const s of bandShifts){
    const k=keyOf(s); seen.add(k);
    const f=full.get(k);
    if(!f){ out.push({...s,check:true,checkReason:'the full-photo read did not see this cell — the close-up read did'}); }
    else if(String(f.code).trim()!==String(s.code).trim()){ out.push({...s,check:true,checkReason:'the close-up read and the full-photo read disagreed on this cell'}); }
    else out.push({...s});
  }
  for(const [k,f] of full){
    if(seen.has(k))continue;
    out.push({...f,check:true,checkReason:'only the full-photo read saw this cell — the close-up read did not (it may belong to a neighbouring row)',includeDefault:false});
  }
  out.sort((p,q)=>String(p.date).localeCompare(String(q.date))||((parseInt(p.column,10)||0)-(parseInt(q.column,10)||0)));
  return out;
}
async function tryGridBandRead(images,fullData){
  // Single-photo grids only — the composite is built from one
  // original. Returns {shifts,status} or null on ANY failure (the
  // caller then uses the full-photo double read).
  try{
    if(!images||images.length!==1)return null;
    const file=images[0];
    const nm=scheduleName();
    const loc=await callExtractSchedule([file],nm,{locate:true});
    if(!loc||loc.is_grid!==true)return null;
    const labels=Array.isArray(loc.row_labels)?loc.row_labels.map(x=>String(x||'')):[];
    const headerDates=Array.isArray(loc.header_dates)?loc.header_dates.filter(d=>String(d||'').trim()):[];
    if(headerDates.length<3||!labels.length)return null;
    const matchIdx=labels.findIndex(l=>l&&scheduleNamesMatch(l,nm));
    if(matchIdx<0)return null;
    scheduleAiStatus='Found your row — zooming into it for a close-up read…'; render();
    if(typeof createImageBitmap!=='function')return null;
    const bmp=await createImageBitmap(file);
    const W=bmp.width||0,H=bmp.height||0;
    if(!W||!H){if(bmp.close)bmp.close(); return null;}
    const scv=document.createElement('canvas'); scv.width=W; scv.height=H;
    const sctx=scv.getContext('2d'); if(!sctx){if(bmp.close)bmp.close(); return null;}
    sctx.drawImage(bmp,0,0); if(bmp.close)bmp.close();
    const idata=sctx.getImageData(0,0,W,H);
    const geom=detectGridGeometry(idata.data,W,H,headerDates.length,labels.filter(l=>l.trim()).length);
    if(!geom)return null;
    // Map the model's label index to a geometry row: rows carry a
    // label-slot index for inked rows ('' = blank-label row). The
    // model's list may itself include blank rows; count inked rows
    // whose model label is non-blank.
    const inkedLabels=labels.map((l,i)=>({l,i})).filter(x=>x.l.trim());
    let rowIndex=-1,slot=-1;
    for(let r=0;r<geom.rows.length;r++){
      if(geom.rows[r].label==='')continue;
      slot++;
      const want=inkedLabels[slot];
      if(want&&want.i===matchIdx){rowIndex=r; break;}
    }
    if(rowIndex<0)return null;
    const composite=await buildGridBandComposite(file,geom,rowIndex,headerDates.length);
    if(!composite)return null;
    let b1;
    try{ b1=await callExtractSchedule([file],nm,{band:true,images:[composite]}); }
    catch(e1){ b1=await callExtractSchedule([file],nm,{band:true,images:[composite]}); }
    if(!scheduleReadIsGrid(b1)&&!(Array.isArray(b1.shifts)&&b1.shifts.length))return null;
    let b2=null;
    try{ b2=await callExtractSchedule([file],nm,{band:true,images:[composite]}); }catch(e2){ b2=null; }
    const rec=reconcileGridReads(b1,b2);
    if(!rec.shifts.length)return null;
    const shifts=crossCheckGridReads(rec.shifts,fullData);
    const checked=shifts.filter(s=>s.check).length;
    const status=checked?('Close-up read of your row, double-checked: '+checked+' cell(s) the reads could not agree on are flagged "check this one" in the preview.'):'Close-up read of your row — the reads agreed on every cell.';
    return {shifts,status};
  }catch(e){ return null }
}
async function readScheduleWithAI(images){
  scheduleImportError='';
  scheduleAiStatus='Sending '+images.length+' photo(s) to AI for reading — this can take a few seconds…'; render();
  const fileName=images.map(f=>f.name).join(', ');
  try{
    let data;
    try{
      data=await callExtractSchedule(images.slice(0,4),scheduleName());
    }catch(firstErr){
      // A schedule read is read-only, so one retry is safe. A dense
      // grid photo takes 10–30s server-side; a single stall or a
      // proxy cut mid-read (Nov 6, 2026) must not dump the user
      // straight into the on-device fallback.
      data=await callExtractSchedule(images.slice(0,4),scheduleName());
    }
    if(scheduleReadIsGrid(data)){
      // Grid band extraction (Nov 7, 2026): with ONE photo, first
      // try the close-up read of the user's own row (locate +
      // geometry + composite, above). It beats the full-photo read
      // on the fixture by a wide margin; any failure falls through
      // to the full-photo double read below, unchanged.
      if(images.length===1){
        const band=await tryGridBandRead(images,data);
        if(band&&band.shifts.length){
          const okBand=applyAiToSchedulePreview({ok:true,mode:'schedule',shifts:band.shifts},fileName);
          if(okBand){ scheduleAiStatus=band.status; scheduleImportError=''; render(); return; }
        }
      }
      // Grid: read it a second time and reconcile before showing
      // anything (see reconcileGridReads above).
      scheduleAiStatus='That looks like a grid schedule — reading it a second time to double-check…'; render();
      let data2=null;
      try{ data2=await callExtractSchedule(images.slice(0,4),scheduleName()); }catch(e2){ data2=null; }
      const rec=reconcileGridReads(data,data2);
      if(!rec.shifts.length){
        // Both reads empty. If a grid was plainly there (either read
        // transcribed its header row), the honest answer is
        // couldn't-read — not a coin flip between "some shifts" and
        // "no shifts" on the next run, and no OCR guessing.
        if(rec.gridSeen){ scheduleImportError=scheduleGridUnreadMessage(); scheduleAiStatus=''; schedulePreview=null; render(); return; }
        if(await scheduleOcrFallback(images,fileName)){render();return}
        scheduleImportError=scheduleGridUnreadMessage(); scheduleAiStatus=''; schedulePreview=null; render(); return;
      }
      const okGrid=applyAiToSchedulePreview({ok:true,mode:'schedule',shifts:rec.shifts},fileName);
      if(!okGrid){ scheduleImportError=scheduleGridUnreadMessage(); scheduleAiStatus=''; schedulePreview=null; render(); return; }
      const checked=rec.shifts.filter(s=>s.check).length;
      scheduleAiStatus=checked?('Read twice to double-check: '+checked+' cell(s) the two reads could not agree on are flagged "check this one" in the preview.'):'Read twice to double-check — both reads agreed on every cell.';
      scheduleImportError=''; render(); return;
    }
    const ok=applyAiToSchedulePreview(data,fileName);
    if(!ok){
      if(await scheduleOcrFallback(images,fileName)){render();return}
      scheduleImportError=scheduleGridUnreadMessage();scheduleAiStatus='';schedulePreview=null;render();return;
    }
    scheduleAiStatus=''; scheduleImportError=''; render();
  }catch(e){
    if(await scheduleOcrFallback(images,fileName)){render();return}
    const msg=String((e&&e.message)||e||''); scheduleAiStatus=''; schedulePreview=null;
    // A photo that neither the AI (after its retry) nor the guarded
    // on-device read could read gets the honest couldn't-read
    // message — never a raw error code and never invented rows.
    // Only the missing-key setup problem keeps its specific text.
    scheduleImportError=(msg===AI_KEY_MISSING_MESSAGE||(e&&e.data&&e.data.error==='openai_key_missing'))?AI_KEY_MISSING_MESSAGE:scheduleGridUnreadMessage(); render();
  }
}

// --- QGenda (Nov 5, 2026): easiest legal v1 ---
// Two paths, both user-driven, neither scraping nor password storage:
//   1. Subscription URL: the user copies their personal "Your
//      Subscription URL" from app.qgenda.com (Sync button) and pastes it
//      here. The server polls that ICS feed like any subscribed calendar
//      and returns only that user's shifts for preview-before-save.
//      The URL is a secret: stored encrypted server-side (AES-GCM,
//      same as other provider credentials), never stored on the device,
//      never shown in full (masked only), never logged.
//   2. Sign-in fallback: the user signs into QGenda themselves (new tab
//      here; system sign-in sheet in the finished app) and brings back a
//      screenshot of the schedule page or a Reports export through the
//      schedule upload below. The app never sees or stores the QGenda
//      password. The screenshot path never checks itself; the
//      subscription feed (path 1) is checked once each time the app
//      opens (Nov 7, 2026) and any new shifts wait in the preview for
//      the user's approval — nothing ever auto-imports.
// NOT built here: the official QGenda REST API — it needs a per-hospital
// API account + Company Key from QGenda, a written agreement, and fees.
// That is a later per-hospital step. No other user's shifts are ever
// touched: the subscription URL belongs to one person, and the sign-in
// path only reads what the signed-in user shows the app.
let qgendaStatusLoaded=false,qgendaStatusError='';
// Boot auto-check state (Nov 7, 2026): qgendaBootChecked enforces the
// once-per-open check; qgendaPendingNew counts the not-yet-imported
// shifts in a pending QGenda preview so the Dashboard notice and the
// QGenda panel can flag them; dismissing the notice only hides it —
// the preview itself is untouched until approved or discarded.
let qgendaBootChecked=false,qgendaPendingNew=0,qgendaNoticeDismissed=false;
// The QGenda preview sheet (Nov 11, 2026, v123 — Caleb: "The
// Qgenda preview needs to pop up right after the link is
// reviewed. No searching or scrolling"): when a check the user
// is present for (connect, "Check feed now", Review) finds new
// shifts, the SAME schedule preview opens in a modal sheet in
// front of them. Background/boot checks never open it — their
// findings wait behind the Dashboard notice and the panel's
// Review now button, which open the same sheet in place.
let qgendaSheetOpen=false;
function qgendaPreviewSheetHTML(){
  if(!qgendaSheetOpen||!qgendaPendingPreview())return '';
  return `<div class="sheet-backdrop" data-action="qgenda-sheet-close"></div><div class="sheet" role="dialog" aria-label="QGenda preview"><div class="sheet-head"><h2>QGenda — review new shifts</h2><button type="button" class="sheet-close" data-action="qgenda-sheet-close" aria-label="Close">×</button></div><p class="muted">Nothing is saved until you approve below. Close this and the preview waits for you in the QGenda panel.</p><div style="margin-top:10px">${schedulePreviewHTML()}</div></div>`;
}
// Stale-preview guard (Nov 8, 2026, round 2): a QGenda preview is
// parsed once and then sits in memory — if the server's shift reader
// is updated after that (it was, mid-testing, on Nov 8), the held
// preview keeps showing the old reader's rows with no sign anything
// changed. The preview now carries the parser version that produced
// it; when the status answer reports a newer one, the preview is
// silently re-read ONCE per app session (plus once per return to the
// foreground) and the panel says it was refreshed.
let qgendaParserRevalidated=false;
function qgendaPendingPreview(){return !!(schedulePreview&&schedulePreview.source==='qgenda-feed')}
function qgendaClearPending(){qgendaPendingNew=0;qgendaNoticeDismissed=false}
function qgendaFeedUrlLooksValid(url){
  try{
    const u=new URL(String(url||'').trim());
    if(u.protocol!=='https:')return false;
    const h=u.hostname.toLowerCase();
    if(!(h==='qgenda.com'||h.endsWith('.qgenda.com')))return false;
    const p=(u.pathname+u.search).toLowerCase();
    return p.includes('ical')||p.includes('ics')||p.includes('sync')||p.includes('calendar')||p.includes('subscription');
  }catch(e){return false}
}
function qgendaFeedHTML(){
  if(!featureOn('featureQgenda'))return collapsePanelHTML('qgenda-panel','QGenda',featureOffHTML('featureQgenda'),false);
  const connected=!!(db.settings&&db.settings.qgendaConnected);
  const masked=String((db.settings&&db.settings.qgendaMasked)||'');
  let inner='';
  if(connected){
    const lastChecked=String((db.settings&&db.settings.qgendaLastCheckedAt)||'');
    const lastCheckedTxt=lastChecked?new Date(lastChecked).toLocaleString('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}):'';
    const pendingLine=(qgendaPendingNew>0&&qgendaPendingPreview())?`<p class="hint"><strong>QGenda: ${qgendaPendingNew} new shift${qgendaPendingNew===1?'':'s'} ready to review</strong> — nothing is saved until you approve it.</p><div class="toolbar"><button type="button" data-action="qgenda-review">Review now</button></div>`:'';
    inner=`<p><strong>QGenda feed connected.</strong> <span class="muted">${escapeHTML(masked)}</span> — the full URL is stored encrypted on the server and is never shown here.</p><div class="toolbar"><button type="button" data-action="qgenda-fetch">Check feed now</button><button type="button" class="secondary" data-action="qgenda-disconnect">Disconnect QGenda feed</button></div><p class="muted">We check your feed each time you open the app — new shifts wait in the preview for your review, and nothing is saved until you approve.${lastCheckedTxt?` Last checked: ${escapeHTML(lastCheckedTxt)}.`:''}</p>${pendingLine}${qgendaStatusError?`<p class="hint">${escapeHTML(qgendaStatusError)}</p>`:''}`;
  } else {
    inner=`<ol class="qgenda-steps"><li>Open QGenda</li><li>Calendar sync</li><li>Copy URL</li><li>Paste URL into CRNA Hub</li></ol><p class="muted">Your URL is stored encrypted on the server and never shown in full. No QGenda password is ever asked for or stored.</p><form id="qgendaForm"><div class="form-grid">${field('qgendaUrl','Your QGenda Subscription URL','password','','placeholder="https://app.qgenda.com/… — paste from the Sync button" autocomplete="off"')}</div><div class="form-actions"><button type="submit">Connect QGenda feed</button><button type="button" class="secondary" data-action="qgenda-open">Open QGenda to copy it</button></div></form>${qgendaStatusError?`<p class="hint">${escapeHTML(qgendaStatusError)}</p>`:''}<p class="muted">No subscription URL? <button type="button" class="secondary tiny" data-action="qgenda-check-it">I signed in to QGenda — use my schedule</button> Sign in yourself in the QGenda tab (the app never sees your password), then bring back a screenshot or a Reports export in the schedule upload below — it reads it and shows a preview before saving anything. That screenshot path never checks itself — connect the feed above instead and the app checks it each time you open CRNA Hub, flagging new shifts for your review.</p>`;
  }
  // QGenda is its own top-level panel now (Nov 6, 2026) — a sibling of
  // Live calendar sync and Upload a schedule. It rests collapsed; it
  // opens when a connect/fetch just reported back, so the result is on
  // screen instead of hidden behind the header — and when the boot
  // check left new shifts waiting in the preview.
  return collapsePanelHTML('qgenda-panel','QGenda',inner+featureTurnOffLineHTML('featureQgenda'),!!qgendaStatusError||(qgendaPendingNew>0&&qgendaPendingPreview()));
}
// QGenda errors reach the user as plain next steps, never as raw
// server codes (function_not_allowed, qgenda_failed, …). The code is
// logged to the console for support; the banner says what to do.
function qgendaFriendlyError(err,phase){
  const code=String((err&&err.data&&err.data.error)||(err&&err.message)||'');
  try{console.warn('[qgenda] '+phase+' failed:',code)}catch(e){}
  const saved=phase==='save'?' Nothing was saved.':'';
  if(code==='invalid_feed_url'||code==='feed_not_ics'||code==='feed_redirected')return 'That link did not return a QGenda calendar feed — copy “Your Subscription URL” from the Sync button in QGenda and try again.'+saved;
  if(code==='feed_link_rejected')return 'Your QGenda link needs a refresh — reconnect it and checks will resume.'+saved;
  if(code==='feed_unreachable')return 'QGenda did not answer just now — try again in a minute.'+saved;
  if(code==='not_signed_in')return 'Sign in on the Account tab first — the feed URL lives on your signed-in account, never on this device.'+saved;
  if(code==='not_connected')return 'Connect your QGenda feed first, then check it.';
  if(code==='missing_url')return 'Paste your QGenda Subscription URL first (Sync button in app.qgenda.com).';
  return 'Something went wrong on our side just now — try again in a little while.'+saved;
}
async function saveQgendaFeed(e){
  e.preventDefault(); qgendaStatusError='';
  const url=String(($('f_qgendaUrl')?$('f_qgendaUrl').value:'')||'').trim();
  if(!url){qgendaStatusError='Paste your QGenda Subscription URL first (Sync button in app.qgenda.com).';render();return}
  if(!qgendaFeedUrlLooksValid(url)){qgendaStatusError='That does not look like a QGenda subscription URL — it should start with https://app.qgenda.com/ and mention ical, sync, or calendar. Copy “Your Subscription URL” from the Sync button in QGenda and try again. Nothing was saved.';render();return}
  if(!SUPABASE_CONFIGURED||!cloudSession){qgendaStatusError='Sign in on the Account tab first — the feed URL is stored on your signed-in account, never on this device. Nothing was sent.';render();return}
  try{
    qgendaStatusError='Connecting — saving the URL encrypted on the server…'; render();
    const data=await liveSyncPost('qgenda-feed',{action:'save',url});
    db.settings=db.settings||{}; db.settings.qgendaConnected=true; db.settings.qgendaMasked=String((data&&data.masked)||'');
    qgendaStatusError=''; persist(); render();
    await fetchQgendaFeed();
  }catch(err){qgendaStatusError=qgendaFriendlyError(err,'save'); render()}
}
// Fetch the QGenda feed into the shared schedule preview — the user
// always approves before anything saves. Two modes: manual (the
// connect flow / "Check feed now" / Review — status line, errors
// shown, and new shifts pop the preview open as a sheet in front
// of the user, v123) and silent (the boot auto-check — no status
// line, no error banner, no sheet, and an all-known result leaves
// no trace beyond the last-checked stamp).
async function fetchQgendaFeed(opts){
  const silent=!!(opts&&opts.silent);
  if(!featureOn('featureQgenda'))return;
  if(!SUPABASE_CONFIGURED||!cloudSession){if(!silent){qgendaStatusError='Sign in on the Account tab first.';render()}return}
  try{
    if(!silent){qgendaStatusError='Checking your QGenda feed…'; render()}
    const facilities=(db.facilities||[]).map(f=>({name:f.name,aliases:String(f.aliases||'').split(',').map(x=>x.trim()).filter(Boolean),hourlyRate:f.hourlyRate,rate8:f.rate8,rate10:f.rate10,rate12:f.rate12,rate24:f.rate24,rateSecond:f.rateSecond,weekendRateSecond:f.weekendRateSecond,callBonus:f.callBonus,paidHours8:f.paidHours8,hourlyCall1st:f.hourlyCall1st,weekendRate24:f.weekendRate24}));
    const data=await liveSyncPost('qgenda-feed',{action:'fetch',facilities,name:scheduleName()});
    qgendaStatusError=''; pushWatchQgenda('ok');
    // A successful answer — even an empty one — is a check: stamp it
    // so the panel's "Last checked" line is honest in both modes.
    db.settings=db.settings||{}; db.settings.qgendaLastCheckedAt=new Date().toISOString();
    if(!data||!Array.isArray(data.shifts)||!data.shifts.length){
      if(silent){persist(); return}
      schedulePreview=null; qgendaStatusError='The QGenda feed answered but listed no shifts. If you have no upcoming shifts in QGenda, that is correct — otherwise check the feed in QGenda.'; render(); return}
    // Housekeeping guard (Nov 9, 2026): parser v5+ already excludes
    // sync-marker events server-side; filter again here so a preview
    // built from an older response can never carry one into the
    // clarification prompt or an import. If filtering empties the
    // list, the feed effectively listed no shifts — same handling
    // as the empty answer above.
    const shiftsIn=data.shifts.filter(sh=>!isHousekeepingShiftName(sh&&sh.code)&&!isHousekeepingShiftName(sh&&sh.type));
    if(!shiftsIn.length){
      if(silent){persist(); return}
      schedulePreview=null; qgendaStatusError='The QGenda feed answered but listed no shifts. If you have no upcoming shifts in QGenda, that is correct — otherwise check the feed in QGenda.'; render(); return}
    const name=scheduleName();
    const builtRows=shiftsIn.map(sh=>{
      const date=String(sh.date||''),facility=String(sh.facility||'').trim(),type=String(sh.type||'Other');
      const duplicate=(db.shifts||[]).some(x=>shiftsSameShift(x,{date,facility,type,code:String(sh.code||'').trim()}));
      const flags=[]; if(duplicate)flags.push('already in CRNA Hub — will merge, not double'); if(!sh.facilityKnown)flags.push('new facility — will be suggested, not created');
      // Multi-day blocks (v130): the feed expands day blocks into one
      // row per day server-side; label each such row with its block,
      // and flag the rows that deliberately stayed single.
      if(sh.spanFrom&&sh.spanTo&&sh.spanFrom!==sh.spanTo){if(sh.spanKept==='call')flags.push('multi-day call ('+sh.spanFrom+' to '+sh.spanTo+') — one shift on its first day; a call is a single assignment');else if(sh.spanKept)flags.push('multi-day event ('+sh.spanFrom+' to '+sh.spanTo+') — imported on its first day only');else flags.push('one day of a '+sh.spanFrom+' to '+sh.spanTo+' block — split into one shift per day')}
      return {date,facility,type,code:String(sh.code||'').trim(),hours:(typeof sh.hours==='number'&&isFinite(sh.hours))?sh.hours:null,pay:String(sh.pay||''),name:name,matchedName:name,match:'matched',include:true,duplicate,flags,source:'qgenda-feed',incomplete:!String(sh.pay||'').trim()};
    });
    // One assignment per day (December round): a day task and a
    // call task for the same day arrive as one combined row — see
    // combineDayCallRows. The preview, the prompt and the approve
    // all work from the combined rows.
    const rows=combineDayCallRows(builtRows);
    const fresh=rows.filter(r=>!r.duplicate).length;
    // Boot check with nothing new: every returned shift is already
    // here — no preview, no notice, just the last-checked stamp.
    if(silent&&!fresh){persist(); render(); return}
    schedulePreview={fileName:'QGenda feed',source:'qgenda-feed',matchedName:name,rows,noNamesInFile:false,ai:false,parserVersion:(typeof data.parserVersion==='number')?data.parserVersion:null};
    qgendaPendingNew=fresh; qgendaNoticeDismissed=false;
    // A check the user is present for (connect / "Check feed
    // now" / Review) pops the preview sheet open the moment it
    // finds new shifts (Nov 11, 2026, v123) — no hunting under
    // another panel. Zero new shifts keeps a quiet result line
    // in the panel instead; the silent boot check never pops.
    if(!silent){if(fresh>0)qgendaSheetOpen=true;else qgendaStatusError='Checked just now — no new shifts; everything in your feed is already in CRNA Hub.'}
    db.settings.qgendaConnected=true; if(data.masked)db.settings.qgendaMasked=String(data.masked);
    persist(); render();
  }catch(err){const qCode=String((err&&err.data&&err.data.error)||(err&&err.message)||'');if(qCode==='feed_link_rejected')pushWatchQgenda('auth_failed');if(silent){qgendaFriendlyError(err,'fetch')}else{qgendaStatusError=qgendaFriendlyError(err,'fetch'); render()}}
}
// Boot auto-check (Nov 7, 2026): once per app open — wired into
// cloudInit / cloudAfterSignIn, after the session is restored and the
// cloud merge has run — quietly check a connected QGenda feed, the
// same sync-on-open contract as live calendar sync. New shifts are
// NEVER auto-imported: they wait in the schedule preview, flagged by
// the Dashboard notice and the QGenda panel. Failures stay silent
// apart from the console log inside qgendaFriendlyError, matching
// the calendar boot sync. The feature toggle gates the whole check.
async function qgendaBootCheck(){
  if(qgendaBootChecked)return; qgendaBootChecked=true;
  if(!featureOn('featureQgenda'))return;
  if(!SUPABASE_CONFIGURED||!cloudSession)return;
  if(!(db.settings&&db.settings.qgendaConnected)){
    // The local flag can lag the server (e.g. a fresh device): ask once.
    try{
      const st=await liveSyncPost('qgenda-feed',{action:'status'});
      if(st&&st.connected){db.settings=db.settings||{};db.settings.qgendaConnected=true;if(st.masked)db.settings.qgendaMasked=String(st.masked);persist()}
      else return;
    }catch(e){return}
  }
  await fetchQgendaFeed({silent:true});
}
async function disconnectQgendaFeed(){
  if(!confirm('Disconnect the QGenda feed? The stored URL is deleted from the server. Shifts already imported stay.'))return;
  try{if(SUPABASE_CONFIGURED&&cloudSession){await liveSyncPost('qgenda-feed',{action:'disconnect'})}}catch(e){}
  db.settings=db.settings||{}; db.settings.qgendaConnected=false; db.settings.qgendaMasked=''; qgendaStatusError=''; persist(); pushWatchQgenda('disconnected'); render();
}
function qgendaStatusRefresh(){
  if(!featureOn('featureQgenda'))return;
  if(qgendaStatusLoaded||!SUPABASE_CONFIGURED||!cloudSession)return; qgendaStatusLoaded=true;
  liveSyncPost('qgenda-feed',{action:'status'}).then(data=>{
    db.settings=db.settings||{};
    if(data&&data.connected){db.settings.qgendaConnected=true; if(data.masked)db.settings.qgendaMasked=String(data.masked)}
    else{db.settings.qgendaConnected=false; db.settings.qgendaMasked=''}
    persist(); render();
    // Stale-preview re-read: the held preview was parsed by an older
    // shift reader than the server runs now — re-read the feed so
    // its rows are replaced by the current reader's, and say so.
    if(data&&data.connected&&typeof data.parserVersion==='number'&&qgendaPendingPreview()&&!qgendaParserRevalidated){
      const held=schedulePreview.parserVersion;
      if(held==null||data.parserVersion>held){
        qgendaParserRevalidated=true;
        const target=data.parserVersion;
        fetchQgendaFeed({silent:true}).then(()=>{
          if(qgendaPendingPreview()&&typeof schedulePreview.parserVersion==='number'&&schedulePreview.parserVersion>=target){
            qgendaStatusError='Your QGenda preview was refreshed — the shift reader was updated since that preview was first read.';
            render();
          }
        }).catch(()=>{});
      }
    }
  }).catch(()=>{});
}
// Returning to the app (foreground) re-arms the status check once:
// a reader update deployed while the app sat open is picked up
// without waiting for a full reload.
if(typeof document!=='undefined'&&document&&typeof document.addEventListener==='function'){
  document.addEventListener('visibilitychange',()=>{
    if(document.visibilityState!=='visible')return;
    if(qgendaParserRevalidated)return;
    if(!(db.settings&&db.settings.qgendaConnected))return;
    qgendaStatusLoaded=false; qgendaStatusRefresh();
  });
}
function submitEntry(e){e.preventDefault();const kind=e.currentTarget.dataset.kind;if(kind==='documents'){submitDocument(e);return;}if(kind==='home-address'){submitHomeAddress(e);return;}if(kind==='portal-check'){submitPortalCheck(e);return;}if(kind==='portal-check-approve'){approvePortalCheck(e);return;}if(kind==='monitor-cadence'){const rec=Object.fromEntries(new FormData(e.currentTarget));const m=(db.portalMonitoring||[]).find(x=>x.key===rec.key);if(m){const v=parseInt(rec.cadenceDays,10);if(Number.isFinite(v)&&v>0)m.cadenceDays=v;persist();}render();return;}if(kind==='paycheck-edit'){submitPaycheckEdit(e);return;}const record=Object.fromEntries(new FormData(e.currentTarget));if(kind==='nbcrna'||kind==='aana'){db[kind]={...(db[kind]||{}),...record,source:'user_entered',updatedAt:new Date().toISOString()};persist();cloudSaveKind(kind);render();return;}if(kind==='licenses')record.source='user_entered';if(kind==='payStubs'){record.agency=String(record.agency||'').trim();record.facility=String(record.facility||'').trim();record.frequency=normalizePayFrequency(record.frequency);for(const d of ['periodStart','periodEnd','payDate'])record[d]=psValidISO(record[d]);for(const a of ['gross','net'])record[a]=rateOrNull(record[a])==null?'':String(rateOrNull(record[a]));if(!record.agency){alert('Enter the agency / employer name first.');return}if(!record.frequency||!record.payDate){alert('A pay schedule needs a pay frequency and a pay date — the calendar dates come from those.');return}if(!editId)record.source='manual';}if(kind==='vehicles'){record.name=String(record.name||'').trim();record.make=String(record.make||'').trim();record.model=String(record.model||'').trim();record.year=String(record.year||'').trim();delete record.plate;record.isDefault=record.isDefault==='on';if(!record.name){alert('Give the vehicle a name first \u2014 e.g. 2022 Silverado.');return}}if(kind==='shifts'&&!String(record.pay).trim()){const f=facilityByNameOrAlias(record.facility);const p=f?facilityPayFor(f,record.type,record.date):0;if(p>0){record.pay=String(Math.round(p*100)/100);record.incomplete=false}else{record.pay='';record.incomplete=true}}if(kind==='shifts'&&String(record.pay).trim()){record.incomplete=false;
// A pay typed by hand in this form is the user's own number, not a
// formula result — clear the derived markers so a later rate edit
// never reprices over it (derived pays carry payUnit hourly /
// facility; see repriceUnpricedShiftsForFacility).
record.payRate='';record.payUnit=''}if(kind==='shifts')record.status=normalizeShiftStatus(record.status);// Newest edit wins on the calendar side needs a timestamp: stamp every
// app-side shift save (add or edit) so the sync engine can tell a newer
// local edit from the provider copy and push the update to the app-owned
// calendar. Before this the stamp was never set (updatedAt stayed null)
// and the server's local-newer check never fired, so an edited shift
// never left the app.
if(['shifts','licenses','nbcrnaCE','aanaCE','credentials','vehicles'].includes(kind))record.updatedAt=new Date().toISOString();if(kind==='facilities'){record.ratesSource='manual';record.ratesSourceFile='';record.ratesSourceDate='';for(const k of RATE_FIELDS){if(!(k in record))continue;record[k]=rateOrNull(record[k])==null?'':String(rateOrNull(record[k]));}if(rateOrNull(record.paidHours8)==null)record.paidHours8='';if(rateOrNull(record.distance)==null){record.distance='';record.distanceSource=''}else if(record.distanceSource!=='auto')record.distanceSource='manual';if(!String(record.address||'').trim()){record.lat='';record.lng='';record.geocodedAddress=''}else if(editId){const old=(db.facilities||[]).find(x=>x.id===editId);if(old&&String(old.address||'').trim()!==String(record.address||'').trim()){record.lat='';record.lng='';record.geocodedAddress='';if(record.distanceSource==='auto'){record.distance='';record.distanceSource=''}}}}if(kind==='mileage'){if(!record.milesSource)record.milesSource=String(record.miles||'').trim()?'manual':'';record.tripType=record.tripType==='one-way'?'one-way':'round-trip';const oldTrip=editId?(db.mileage||[]).find(m=>m.id===editId):null;if(oldTrip&&record.tripType!==oldTrip.tripType&&Number(oldTrip.oneWayMiles)>0&&oldTrip.milesSource==='auto'){record.miles=String(tripMilesFor(oldTrip.oneWayMiles,record.tripType));record.oneWayMiles=String(oldTrip.oneWayMiles)}else if(Number(record.oneWayMiles)>0&&record.milesSource==='auto'){record.miles=String(tripMilesFor(record.oneWayMiles,record.tripType))}else{record.oneWayMiles=oneWayFromTripMiles(record.miles,record.tripType)}record.origin=record.origin==='hotel'?'hotel':record.origin==='other'?'other':'home';record.originChosen=true;if(record.origin==='home')record.hotelAddress='';if(record.origin==='hotel'&&String(record.hotelAddress||'').trim())db.settings.lastHotelAddress=String(record.hotelAddress).trim();if(record.vehicleId!==undefined){const vv=vehicleById(record.vehicleId);record.vehicleId=vv?vv.id:'';record.vehicleName=vv?String(vv.name||''):''}else if(!editId){const dst=defaultVehicleStamp();record.vehicleId=dst.vehicleId;record.vehicleName=dst.vehicleName}}if(kind==='hotelStays'&&String(record.hotelAddress||'').trim())db.settings.lastHotelAddress=String(record.hotelAddress).trim();if(kind==='facilities'&&!editId){const existing=(db.facilities||[]).find(x=>facilityNameKey(x.name)===facilityNameKey(record.name)||(String(record.aliases||'').trim()&&facilityAliases(x).some(a=>String(record.aliases||'').split(',').map(y=>facilityNameKey(y)).includes(facilityNameKey(a)))));if(existing)editId=existing.id}if(kind==='facilities'&&!String(record.name||'').trim()){alert('Enter the hospital / facility name first.');return}if(kind==='facilities'&&editId){const oldF=(db.facilities||[]).find(x=>x.id===editId);if(oldF&&facilityNameKey(oldF.name)!==facilityNameKey(record.name)){const keep=[];const seenK=new Set();for(const a of facilityAliases(oldF).concat(String(record.aliases||'').split(',').map(y=>y.trim()).filter(Boolean))){const kk=facilityNameKey(a);if(kk&&kk!==facilityNameKey(record.name)&&!seenK.has(kk)){seenK.add(kk);keep.push(a)}}const oldName=String(oldF.name||'').trim();if(oldName&&!seenK.has(facilityNameKey(oldName)))keep.push(oldName);record.aliases=keep.join(', ')}}if(kind==='shifts'&&!editId){
  // Double-booking guard (v115): a hand-added shift that lands on
  // an already-booked day (a different shift — any facility) is NOT
  // saved; the form reopens with the warning and the user's entry
  // intact, and saving takes an explicit "Add it anyway".
  const conflictCand=shiftConflictCandidate(record,db.shifts||[]);
  if(conflictCand&&!findSameShift(record,db.shifts||[])){
    pendingManualShift={record:{...record},against:{date:conflictCand.date,facility:conflictCand.facility,type:conflictCand.type,code:conflictCand.code}};
    showShiftForm=true;render();return;
  }
  pendingManualShift=null;
}
let savedId=editId;if(editId){const i=db[kind].findIndex(x=>x.id===editId);if(i>=0)db[kind][i]={...db[kind][i],...record};else{const rec={...record,id:id(),...(kind==='shifts'?{source:'user-entered'}:{})};if(kind==='shifts'){savedId=addShiftDeduped(rec).shift.id}else{db[kind].push(rec);savedId=rec.id}}}else{const rec={...record,id:id(),...(kind==='shifts'?{source:'user-entered'}:{})};if(kind==='shifts'){savedId=addShiftDeduped(rec).shift.id}else{db[kind].push(rec);savedId=rec.id}}editId=null;if(kind==='shifts')showShiftForm=false;if(kind==='mileage'){mileageFormDraft=null;mileageDraftHold=true;mileageCalcStatus=''}persist();if(kind==='vehicles'){const savedV=(db.vehicles||[]).find(v=>v.id===savedId);if(savedV&&savedV.isDefault){let clearedV=false;(db.vehicles||[]).forEach(v=>{if(v.id!==savedId&&v.isDefault){v.isDefault=false;clearedV=true;cloudSaveKind('vehicles',v.id)}});if(clearedV)persist();}}let repriced=0;let priceFix={priced:0,updated:0};if(kind==='facilities'){const saved=(db.facilities||[]).find(x=>x.id===savedId);if(saved&&String(saved.geocodedAddress||'').trim()&&String(saved.geocodedAddress||'').trim()!==String(saved.address||'').trim()){saved.lat='';saved.lng='';saved.geocodedAddress='';if(saved.distanceSource==='auto'){saved.distance='';saved.distanceSource=''}persist();}if(saved){priceFix=repairShiftPaysForFacility(saved);repriced=priceFix.priced+priceFix.updated;if(repriced>0)persist();}}if(kind==='shifts'&&typeof window!=='undefined'&&typeof window.liveSyncMarkShiftNotSynced==='function')window.liveSyncMarkShiftNotSynced(savedId);
if(kind==='shifts'&&typeof window!=='undefined'&&typeof window.liveSyncSchedulePush==='function')window.liveSyncSchedulePush();if(kind==='facilities'&&typeof window!=='undefined'&&typeof window.liveSyncSchedulePush==='function')window.liveSyncSchedulePush();if(['licenses','nbcrnaCE','aanaCE','shifts','facilities','mileage','payStubs','vehicles'].includes(kind))cloudSaveKind(kind,savedId);if(kind==='facilities'){const saved=(db.facilities||[]).find(x=>x.id===savedId);if(saved){const sgRec=(db.facilitySuggestions||[]).find(x=>normFacilityName(x.name)===normFacilityName(saved.name));const sgProvider=(sgRec&&sgRec.provider)||suggestionBornProviders[saved.id]||'';const hadSuggestion=clearFacilitySuggestion(saved.name);if(hadSuggestion||suggestionBornProviders[saved.id]){delete suggestionBornProviders[saved.id];if(typeof window!=='undefined'&&typeof window.liveSyncRescanAfterFacilitySave==='function')window.liveSyncRescanAfterFacilitySave(sgProvider||'apple',saved.name);}if(facilitySuggestionPrefill&&normFacilityName(facilitySuggestionPrefill.name)===normFacilityName(saved.name))facilitySuggestionPrefill=null;
  // Bug 2: a suggestion cleared by adding the facility means held
  // shifts exist for it. If the last import also skipped shifts as
  // legacy (paired by an earlier interrupted sync, migration 005 not
  // run), arm the one-shot repair so the next sync — which the
  // facility save already schedules — re-imports them instead of
  // leaving them blocked. Deleted shifts stay deleted: the server
  // only clears rows that are not flagged deleted and not tombstoned.
  if(hadSuggestion&&typeof liveSyncState!=='undefined'&&liveSyncState&&liveSyncState.lastImport&&Number(liveSyncState.lastImport.skippedLegacy||0)>0){liveSyncState.repairImport=true;if(typeof liveSyncStateSave==='function')liveSyncStateSave();}}}if(priceFix.priced+priceFix.updated>0){const facName=((db.facilities||[]).find(x=>x.id===savedId)||{}).name||'facility';const parts=[];if(priceFix.priced)parts.push(`Priced ${priceFix.priced} shift(s) from the ${facName} pay rules.`);if(priceFix.updated)parts.push(`Updated ${priceFix.updated} shift price(s) to match the ${facName} pay rules.`);alert(parts.join(' '))}render()}
// Change one shift's status (Saved shifts list). Re-prices the C/P
// totals immediately on the next render; a shift change is also queued
// for live calendar sync, like any other shift edit.
function setShiftStatus(shiftId,status){const x=(db.shifts||[]).find(s=>s.id===shiftId);if(!x)return;const v=normalizeShiftStatus(status);if(x.status===v)return;x.status=v;x.updatedAt=new Date().toISOString();persist();if(typeof window!=='undefined'&&typeof window.liveSyncSchedulePush==='function')window.liveSyncSchedulePush();render();}
// --- One-tap fix for shifts imported before Bug 1 (Nov 6, 2026) ---
// Past shifts that arrived as 'proposed' (e.g. Caleb's 139 in 2026)
// count in P only, so C and S year-to-date read $0. This reclassifies
// them in place — past proposed shifts in the year become 'confirmed'.
// Future shifts, today's shift, and any non-proposed status are never
// touched; unpriced shifts keep their status change but stay unpriced
// (never $0) and W-2 salary days stay excluded from every total, so
// the totals move only because past priced work is now confirmed.
function pastProposedShifts(year){const y=+year||currentYear();const today=localDate(new Date());return (db.shifts||[]).filter(x=>String(x.date||'').startsWith(String(y)+'-')&&String(x.date||'')<today&&normalizeShiftStatus(x.status)==='proposed')}
function confirmPastProposedShifts(year){const y=+year||currentYear();const list=pastProposedShifts(y);if(!list.length){alert('No past proposed shifts to confirm in '+y+'.');return 0}list.forEach(x=>{x.status='confirmed'});persist();if(typeof window!=='undefined'&&typeof window.liveSyncSchedulePush==='function')window.liveSyncSchedulePush();render();alert('Marked '+list.length+' past shift(s) in '+y+' as confirmed. They now count in Confirmed (C) year to date.');return list.length}
function actions(action,entry,date,from){if(action.startsWith('live-')){if(typeof liveSyncAction==='function')return liveSyncAction(action,entry);}if(action==='feature-toggle'){const fd=featureDef(entry);if(fd)setFeature(fd.key,!featureOn(fd.key));return;}if(action==='push-enable'){pushEnable();return;}if(action==='push-disable'){pushDisable();return;}if(action==='push-test'){pushTest();return;}if(action==='push-type-toggle'){db.settings.pushTypes=Object.assign({cert:true,ce:true,calendar:true,qgenda:true,portal:true,sync:true},db.settings.pushTypes||{});db.settings.pushTypes[entry]=!pushTypeOn(entry);pushTypesSave();render();return;}if(action==='proposed-email'){openProposedEmailSheet(entry||'');return;}if(action==='proposed-email-close'){propEmailOpen=false;render();return;}if(action==='proposed-email-send'){sendProposedEmail();return;}if(action==='onboard-dismiss'){onboardStep=0;db.settings.onboardingDismissed=true;persist();return render();}if(action==='onboard-goto'){setTab(entry);const st=onboardingSteps().find(x=>x.tab===entry&&(x.panel||'')===(date||''));onboardStep=st?st.n:0;render();if(date){const el=document.getElementById(date);if(el){if(el.tagName==='DETAILS')el.open=true;if(el.scrollIntoView)el.scrollIntoView({block:'start'});}}return;}if(action==='prev')return moveMonth(-1);if(action==='next')return moveMonth(1);if(action==='today'){month=new Date();month.setDate(1);selected=localDate(new Date());return render()}if(action==='day')return selectDay(date);if(action==='add-shift'){tab='Dashboard';editId=null;showShiftForm=true;render();return;}if(action==='assistant-open'){assistantSheetOpen=true;render();return;}if(action==='assistant-close'){assistantSheetOpen=false;render();return;}if(action==='ask-assistant'){assistantSheetOpen=true;render();return;}if(action==='connect-portal'){const key=({NBCRNA:'nbcrna',AANA:'aana','State Licenses':'licenses'})[entry]||entry;return portalOpenSignIn(key);}
if(action==='monitor-prompt-dismiss'){const m=(db.portalMonitoring||[]).find(x=>x.key===entry);if(m){const t=localDate(new Date());m.promptDismissedCycle=monitorNextDue(m,t);m.snoozeUntil=addDaysStr(t,monitorCadence(m));persist();pushWatchRefreshPortal();}return render();}
if(action==='monitor-toggle'){const m=(db.portalMonitoring||[]).find(x=>x.key===entry);if(m){m.enabled=!m.enabled;persist();}return render();}
if(action==='monitor-ack'){const m=(db.portalMonitoring||[]).find(x=>x.key===entry);if(m){m.changeFlag=false;persist();}return render();}
if(action==='monitor-assistant'){const m=(db.portalMonitoring||[]).find(x=>x.key===entry);if(m)return monitorAssistantCheck(m);return;}
if(action==='assistant-portal-check'){const src=({NBCRNA:'nbcrna',AANA:'aana','State Licenses':'licenses'})[entry]||entry;return startPortalCheck(src);}if(action==='portal-return'){const f=portalConnectFlow(entry);if(f)return f.returnToApp();return;}if(action==='portal-leave-go'){return portalLeaveGo(entry);}if(action==='portal-leave-cancel'){portalLeaveSheet='';return render();}if(action==='portal-check-cancel'){portalCheck=null;portalCheckError='';portalCheckOcrStatus='';portalStatePersist();return render();}if(action==='portal-guide-skip'){return portalGuideSkip();}if(action==='portal-guide-finish'){if(portalCheck){portalCheck.step='preview';portalCheckError='';portalStatePersist();}return render();}if(action==='ask'){return askAssistantLive(entry)}if(action==='clear-chat'){db.assistantChat=[];persist();return render()}if(action==='cancel'){if(tab==='Mileage'&&(db.mileage||[]).some(m=>m.id===editId)){mileageFormDraft=null;mileageDraftHold=true}editId=null;showShiftForm=false;facilitySuggestionPrefill=null;pendingManualShift=null;return render()}
if(action==='manual-shift-anyway'){const p=pendingManualShift;if(p){pendingManualShift=null;const rec={...p.record,id:id(),source:'user-entered'};const res=addShiftDeduped(rec);dismissDayConflict(conflictPairSignature(rec.date,rec,p.against));showShiftForm=false;persist();cloudSaveKind('shifts',res.shift.id);if(typeof window!=='undefined'&&typeof window.liveSyncMarkShiftNotSynced==='function')window.liveSyncMarkShiftNotSynced(res.shift.id);if(typeof window!=='undefined'&&typeof window.liveSyncSchedulePush==='function')window.liveSyncSchedulePush();}return render()}
if(action==='manual-shift-cancel'){pendingManualShift=null;return render()}if(action==='shift-origin-quick')return setShiftTripOrigin(entry,date);
if(action==='shift-origin-dismiss'){callOriginPromptDismissed.add(entry);return render()}
if(action==='vehicle-default'){const v=(db.vehicles||[]).find(x=>x.id===entry);if(v){(db.vehicles||[]).forEach(o=>{const was=!!o.isDefault;o.isDefault=o.id===entry;if(was!==!!o.isDefault)cloudSaveKind('vehicles',o.id)});persist();}return render()}if(action==='mileage-autocalc')return calcMileageForForm();if(action==='facility-distance')return calcFacilityDistance();if(action==='edit-profile'){profileEditing=true;return render()}
if(action==='edit-addresses'){addressesEditing=true;return render()}
if(action==='edit-paystub'){editId=entry;tab='Facilities';paystubPreview=null;paystubError='';paystubStatus='';render();const el=document.getElementById('paystub-panel');if(el&&el.scrollIntoView)el.scrollIntoView({block:'start'});return;}
if(action==='delete-paystub'){const delRec=(db.payStubs||[]).find(x=>x.id===entry);const delAct=delRec?paystubStubActual(delRec):null;const delMsg=delAct?`Delete this pay stub? Its own check (${delRec.payDate?fmt(delRec.payDate):'its pay date'}) will stop showing the stub actual ${currency(delAct.amount)} and fall back to an estimate calculated from your shifts. The amount is not kept anywhere else.`:"Delete this agency's pay schedule? Only this agency's estimated paychecks are removed — other agencies are untouched.";if(!confirm(delMsg))return;db.payStubs=(db.payStubs||[]).filter(x=>x.id!==entry);persist();cloudRecordTombstone('payStubs',entry);return render()}
if(action==='close-day'){dayViewOpen=false;if(paycheckEdit&&paycheckEdit.from==='day')paycheckEdit=null;render();return}
  if(action==='edit-paycheck'){paycheckEdit={stubId:entry,schedDate:date,from:from||'panel'};render();return}
  if(action==='paycheck-edit-cancel'){paycheckEdit=null;render();return}
  if(action==='paycheck-clear-actual'){const stub=(db.payStubs||[]).find(s=>s.id===entry);if(stub)savePaycheckOverride(stub,{schedDate:date,actual:''});paycheckEdit={stubId:entry,schedDate:date,from:from||'panel'};render();return}
  if(action==='delete-shifts'){const x=(db.shifts||[]).find(s=>s.id===entry);if(!x)return;shiftDeleteConfirm={id:entry,also:!!(db.settings&&db.settings.deleteAlsoFromCalendar)};render();return}
  if(action==='shift-delete-cancel'){shiftDeleteConfirm=null;render();return}
  if(action==='shift-delete-confirm'){return confirmShiftDelete(entry)}
  if(action.startsWith('edit-')){facilitySuggestionPrefill=null;const kind=action.slice(5);tab=({shifts:'Dashboard',facilities:'Facilities',credentials:'Credentials',mileage:'Mileage',hotelStays:'Mileage',vehicles:'Mileage',licenses:'Credentials',nbcrnaCE:'Credentials',aanaCE:'Credentials',documents:'Credentials'})[kind]||'Dashboard';if(['nbcrna','aana','licenses','credentials','nbcrnaCE','aanaCE'].includes(kind))manualType=({nbcrna:'NBCRNA',aana:'AANA',licenses:'State license',credentials:'Other credential',nbcrnaCE:'NBCRNA CE',aanaCE:'AANA CE'})[kind];editId=entry;if(kind==='shifts')showShiftForm=true;render();if(kind==='facilities')facilityScrollTo('facility-manual-panel');else if(kind==='vehicles'){const vel=document.getElementById('vehicles-panel');if(vel&&vel.scrollIntoView)vel.scrollIntoView({block:'start'})}else if(kind==='mileage'){const mel=document.getElementById('mileage-log-panel');if(mel&&mel.scrollIntoView)mel.scrollIntoView({block:'start'})}else if(kind!=='shifts')window.scrollTo(0,0);return}if(action.startsWith('delete-')){const kind=action.slice(7);if(!confirm(kind==='shifts'?'Delete this shift? It is removed from CRNA Hub right away. A shift imported from your calendar is not deleted from that calendar.':'Delete this record?'))return;if(kind==='shifts'){const gone=(db.shifts||[]).find(x=>x.id===entry);if(typeof window!=='undefined'&&typeof window.liveSyncRecordTombstone==='function')window.liveSyncRecordTombstone(entry);if(gone&&Array.isArray(db.mileage))db.mileage=db.mileage.filter(m=>!(m.status==='draft'&&mileageTripMatchesShift(m,gone)));}db[kind]=db[kind].filter(x=>x.id!==entry);persist();if(['licenses','nbcrnaCE','aanaCE'].includes(kind))cloudDeleteKind(kind,entry);if(kind==='documents')cloudDeleteDocument(entry);cloudRecordTombstone(kind,entry);return render()}if(action==='download-doc'){downloadDocument(entry);return;}if(action==='mileage-drafts')return makeMileageDrafts();if(action==='vehicles-goto'){tab='Mileage';editId=null;render();facilityScrollTo('vehicles-panel');return}if(action==='mileage-review-goto'){mileageReviewWeek=entry||'';tab='Mileage';editId=null;render();window.scrollTo(0,0);return}if(action==='mileage-review-prev')return mileageReviewStep(1);if(action==='mileage-review-next')return mileageReviewStep(-1);if(action==='mileage-review-generate')return generateWeeklyMileageDrafts(selectedMileageReviewWeek());if(action==='mileage-review-fix-facility')return mileageReviewFixAddress('facility',entry);if(action==='mileage-review-fix-home')return mileageReviewFixAddress('home','');if(action==='mileage-review-link-facility')return linkMileageFacility(entry,date);if(action==='mileage-review-confirm')return confirmWeeklyMileage(selectedMileageReviewWeek());if(action==='mileage-review-vehicle-apply'){const wk=selectedMileageReviewWeek();const selEl=$('mileageReviewVehicleSelect');const vid=(selEl&&selEl.value)||mileageReviewVehicleForWeek(wk);applyMileageReviewEdits(wk);if(vid){mileageReviewVehicleWeek=wk;mileageReviewVehicleId=vid;stampWeekVehicle(wk,vid)}persist();return render()}
if(action==='mileage-review-save'){applyMileageReviewEdits(selectedMileageReviewWeek());persist();return render()}if(action==='mileage-review-skip'){const m=(db.mileage||[]).find(x=>x.id===entry);if(m){m.status='skipped';persist()}return render()}if(action==='mileage-review-restore'){const m=(db.mileage||[]).find(x=>x.id===entry);if(m){m.status='draft';persist()}return render()}if(action==='mileage-clear-backlog'){const n=clearMileageBacklog();mileageClearStatus=n>0?('Cleared '+n+' older trip'+(n===1?'':'s')+' \u2014 they won\u2019t count toward mileage.'):'';return render()}if(action==='cloud-show-create'){cloudAuthMode='create';return render()}if(action==='cloud-show-signin'){cloudAuthMode='signin';return render()}if(action==='cloud-signup'){const em=$('f_email'),pw=$('f_password'),sn=$('f_scheduleName'),et=$('f_employmentType'),gl=$('f_incomeGoalStep1');if(!em||!pw||!em.value.trim()||!pw.value)return alert('Enter an email and password first.');cloudSignUp(em.value.trim(),pw.value,sn?String(sn.value||'').trim():'',et?String(et.value||'').trim():'',gl&&String(gl.value||'').trim()!==''?num(gl.value):undefined);return}
if(action==='skip-income-goal'){const gl=$('f_incomeGoalStep1');if(gl)gl.value='';cloudAuthStatus='No income goal set — you can set it later on the Account tab (Profile — step 1).';return render()}
if(action==='save-profile'){const nm=$('f_profileName'),et=$('f_profileEmploymentType'),gl=$('f_profileIncomeGoal');applyProfileValues({name:nm?String(nm.value||'').trim():'',employmentType:et?String(et.value||'').trim():'',monthlyIncomeGoal:gl&&String(gl.value||'').trim()!==''?num(gl.value):0});cloudSaveProfile();profileEditing=false;return render()}
if(action==='cloud-signout'){cloudSignOut();return}
if(action==='cloud-signout-clear'){cloudSignOutAndClearDevice();return}
if(action==='wipe-open'){wipeConfirm={text:'',armed:false,busy:false,step:'',error:'',report:null};render();return}
if(action==='wipe-cancel'){if(!wipeConfirm||!wipeConfirm.busy){wipeConfirm=null;render()}return}
if(action==='wipe-erase'){wipeEraseTap();return}
if(action==='wipe-retry'){if(wipeConfirm&&!wipeConfirm.busy){wipeConfirm.report=null;wipeConfirm.error='';wipeEraseRun()}return}
if(action==='goto-account')return setTab('Account');if(action==='goto-mileage')return setTab('Mileage');

if(action==='facility-contract-approve')return approveFacilityContract();
if(action==='facility-suggestion-yes'){const sg=(db.facilitySuggestions||[]).find(x=>x.id===entry);if(!sg)return;facilitySuggestionPrefill={name:sg.name,address:sg.address||''};editId=null;tab='Facilities';render();facilityScrollTo('facility-three-ways-panel');return;}
if(action==='facility-suggestion-path'){const sg=(db.facilitySuggestions||[]).find(x=>x.id===entry);const nm=sg?sg.name:(facilitySuggestionPrefill&&facilitySuggestionPrefill.name)||'';if(!nm)return;facilitySuggestionPrefill={name:nm,address:(sg&&sg.address)||(facilitySuggestionPrefill&&facilitySuggestionPrefill.address)||''};editId=null;tab='Facilities';render();facilityScrollTo(date==='contract'?'facility-contract-panel':'facility-manual-panel');return;}
if(action==='facility-suggestion-dismiss'){const sg=(db.facilitySuggestions||[]).find(x=>x.id===entry);if(sg){sg.dismissed=true;sg.dismissedAt=new Date().toISOString();persist();}return render();}
if(action==='facility-suggestion-undismiss'){const sg=(db.facilitySuggestions||[]).find(x=>x.id===entry);if(sg){sg.dismissed=false;sg.dismissedAt='';persist();}return render();}
if(action==='facility-suggestion-review')return setTab('Facilities');
if(action==='sync-result-close'){syncResultSheet=null;return render();}
if(action==='sync-result-setup'){const firstSg=activeFacilitySuggestions()[0];syncResultSheet=null;expandedSuggestionId=firstSg?firstSg.id:null;tab='Facilities';render();facilityScrollTo('facility-suggestions-panel');return;}
if(action==='facility-rescan-dismiss'){facilityRescanResult=null;return render();}
if(action==='facility-suggestion-expand'){expandedSuggestionId=entry;return render();}
if(action==='facility-suggestion-words'){const sg=(db.facilitySuggestions||[]).find(x=>x.id===entry);if(!sg)return;let fac=facilityByNameOrAlias(sg.name);if(!fac){fac={id:id(),name:sg.name,aliases:'',address:sg.address||'',distance:'',notes:'',rate8:'',rate10:'',rate12:'',rate24:'',rateSecond:'',hourlyRate:'',paidHours8:'',callBonus:'',hourlyCall1st:'',weekendRate24:'',weekendRateSecond:'',codeMap:{},ratesPromptSkipped:false};db.facilities=db.facilities||[];db.facilities.push(fac);persist();try{if(typeof cloudSaveKind==='function')cloudSaveKind('facilities',fac.id)}catch(_){}}suggestionBornProviders[fac.id]=sg.provider||'apple';clearFacilitySuggestion(sg.name);facilitySuggestionPrefill=null;describeOpenFac=fac.id;editId=null;tab='Facilities';render();facilityScrollTo('my-facilities-panel');return;}
if(action==='facility-scroll-to'){facilityScrollTo(entry);return;}
if(action==='facility-contract-discard'){facilityContractPreview=null;facilityContractConfirmCreate=false;facilityContractPendingImages=[];facilityContractOcrPages=[];facilityContractOcrStatus='';facilityContractError='';facilityContractCropNote='';facilityContractLastCropAdded=[];return render()}


if(action==='facility-reread-rates')return rereadFacilityRatesTable();
if(action==='facility-contract-ai')return readContractWithAI('facility');
if(action==='paystub-approve')return approvePaystub();
if(action==='paystub-card-toggle'){paystubCardOpenFac=paystubCardOpenFac===entry?'':entry;return render()}
if(action==='paystub-discard'){paystubPreview=null;paystubError='';paystubStatus='';paystubCardFacId='';paystubImportCtx=null;return render()}
if(action==='name-amb-confirm'){if(schedulePreview&&schedulePreview.nameAmb){const picks=Array.from(document.querySelectorAll('.nameAmbPick')).filter(x=>x.checked).map(x=>x.dataset.key);if(!picks.length){alert('Tick at least one label that is you — or discard this preview.');return}const amb=schedulePreview.nameAmb;amb.picks=picks;db.settings=db.settings||{};db.settings.namePicks=db.settings.namePicks||{};db.settings.namePicks[amb.memKey]={cands:amb.candidates.map(c=>c.key).sort(),picks:picks.slice()};applyNameAmbiguity(schedulePreview);persist()}return render()}

if(action==='contract-ai')return readContractWithAI('contract');
if(action==='contract-ocr')return importContractWithOCR();
if(action==='facility-page-crop-reread')return rereadFacilityPageCropped(+entry);
if(action==='contract-page-crop-reread')return rereadContractPageCropped(+entry);
if(action==='facility-page-remove'||action==='facility-page-up'||action==='facility-page-down'){const i=+entry;if(Number.isNaN(i)||i<0||i>=facilityContractPendingImages.length)return render();const mv=action.endsWith('-up')?-1:action.endsWith('-down')?1:0;if(mv){const j=i+mv;if(j<0||j>=facilityContractPendingImages.length)return render();[facilityContractPendingImages[i],facilityContractPendingImages[j]]=[facilityContractPendingImages[j],facilityContractPendingImages[i]]}else facilityContractPendingImages.splice(i,1);facilityContractOcrPages=orderedOcrPages(facilityContractOcrPages,facilityContractPendingImages);if(facilityContractOcrPages.length){if(!reparseFacilityContractOcrPages()){facilityContractError='The remaining pages contain no facility name or rate. Nothing was saved.';facilityContractPreview=null}}else{facilityContractPreview=null;facilityContractError=''}return render()}

if(action==='contract-page-remove'||action==='contract-page-up'||action==='contract-page-down'){const i=+entry;if(Number.isNaN(i)||i<0||i>=contractPendingImages.length)return render();const mv=action.endsWith('-up')?-1:action.endsWith('-down')?1:0;if(mv){const j=i+mv;if(j<0||j>=contractPendingImages.length)return render();[contractPendingImages[i],contractPendingImages[j]]=[contractPendingImages[j],contractPendingImages[i]]}else contractPendingImages.splice(i,1);contractOcrPages=orderedOcrPages(contractOcrPages,contractPendingImages);if(contractOcrPages.length){if(!reparseContractOcrPages()){contractImportError='The remaining pages contain no shifts by deterministic parsing. Nothing was saved.';contractPreview=null}}else{contractPreview=null;contractImportError=''}return render()}
if(action==='view-contract-image')return viewContractImage(entry);
if(action==='view-contract-image-page')return viewContractImage(entry,+date);
if(action==='backup')return download('crna-hub-backup.json',deviceBackupJSON(),'application/json');if(action==='confirm-past-shifts')return confirmPastProposedShifts(entry);if(action==='import-rates-skip'){const p=entry==='cal'?calPreview:schedulePreview;if(p){const t=importRatesTarget(p);p.ratesSkipped=true;if(t&&t.fac){t.fac.ratesPromptSkipped=true;persist()}}return render()}if(action==='describe-parse'){submitDescribe(String(entry||''));return}if(action==='describe-edit'){const dst=describeState(String(entry||''));if(dst)dst.collapsed=false;return render()}if(action==='describe-confirm'){confirmDescribe(String(entry||''));return}if(action==='describe-facility'){if(describeSavedFlashFac===entry)describeSavedFlashFac=null;describeOpenFac=describeOpenFac===entry?null:entry;return render()}if(action==='describe-dismiss'){const f=(db.facilities||[]).find(x=>x.id===entry);if(f){db.settings=db.settings||{};db.settings.rulesHealDismissed={...(db.settings.rulesHealDismissed&&typeof db.settings.rulesHealDismissed==='object'?db.settings.rulesHealDismissed:{}),[f.id]:rulesHealSignature(f)};persist()}return render()}if(action==='import-paysched-skip'){const p=entry==='cal'?calPreview:entry==='contract'?contractPreview:entry==='faccontract'?facilityContractPreview:schedulePreview;if(p){p.paySchedSkipped=true;const ag=String(p._paySchedAgency||(p.paySchedDraft&&p.paySchedDraft.agency)||'').trim();if(ag){db.settings=db.settings||{};const dis={...importPaySchedDismissed()};dis[paySchedAgencyKey(ag)]=true;db.settings.paySchedPromptDismissed=dis;persist()}}return render()}if(action==='facility-paysched-save'){const f=(db.facilities||[]).find(x=>x.id===entry);if(f){const d=facPaySchedDrafts[f.id]||{};const agency=String(d.agency||f.name).trim();const frequency=normalizePayFrequency(d.frequency);const payDate=psValidISO(d.payDate);if(!agency||!frequency||!payDate){alert('Add a pay frequency and one pay date you know for '+(agency||f.name)+", and we'll put its paychecks on your calendar.");return render()}if(paystubForAgency(agency)){alert(agency+' already has a pay schedule — you can edit it under Pay schedules on the Facilities tab.');delete facPaySchedDrafts[f.id];persist();return render()}const rec={id:id(),agency,facility:String(d.facility||f.name).trim(),frequency,periodStart:psValidISO(d.periodStart),periodEnd:psValidISO(d.periodEnd),payDate,gross:'',net:'',source:'facility-card',fileName:'',updatedAt:new Date().toISOString()};db.payStubs=db.payStubs||[];db.payStubs.push(rec);try{if(typeof cloudSaveKind==='function')cloudSaveKind('payStubs',rec.id)}catch(_){}delete facPaySchedDrafts[f.id];persist();render();alert(`Pay schedule saved for ${agency} — paychecks for its shifts now show on your calendar.`);return}return render()}if(action==='facility-paysched-dismiss'){const f=(db.facilities||[]).find(x=>x.id===entry);if(f){db.settings=db.settings||{};const dis={...importPaySchedDismissed()};dis[paySchedAgencyKey(f.name)]=true;db.settings.paySchedPromptDismissed=dis;delete facPaySchedDrafts[f.id];persist()}return render()}if(action==='cal-approve')return approveCalendarImport();if(action==='cal-discard'){calPreview=null;return render()}if(action==='schedule-approve')return approveScheduleImport();if(action==='schedule-discard'){schedulePreview=null;scheduleAiStatus='';scheduleImportError='';qgendaSheetOpen=false;qgendaClearPending();return render()}if(action==='save-schedule-name'){const el=$('f_scheduleNameUpload');if(el){db.settings=db.settings||{};db.settings.scheduleName=String(el.value||'').trim();persist()}return render()}if(action==='qgenda-fetch')return fetchQgendaFeed();if(action==='qgenda-sheet-close'){qgendaSheetOpen=false;return render()}if(action==='qgenda-disconnect')return disconnectQgendaFeed();if(action==='qgenda-open'){try{window.open('https://app.qgenda.com','_blank','noopener')}catch(e){}return}if(action==='qgenda-check-it'){scheduleImportContext='qgenda';render();const el=document.getElementById('schedule-import-panel');if(el&&el.scrollIntoView)el.scrollIntoView({block:'start'});return}if(action==='qgenda-review'){if(qgendaPendingPreview()){qgendaSheetOpen=true;return render()}return fetchQgendaFeed()}if(action==='qgenda-notice-dismiss'){qgendaNoticeDismissed=true;return render()}if(action==='conflict-alert-dismiss'){dismissDayConflict(entry);return render()}if(action==='conflict-held-keep-out'){dismissDayConflict(entry);return render()}if(action==='export-cal-all')return exportCalendarICS(db.shifts.slice().sort((a,b)=>a.date.localeCompare(b.date)),'crna-hub-shifts.ics');if(action==='export-cal-month'){const prefix=localDate(new Date()).slice(0,7);return exportCalendarICS(db.shifts.filter(x=>x.date.startsWith(prefix)).sort((a,b)=>a.date.localeCompare(b.date)),'crna-hub-shifts-'+prefix+'.ics')}if(action==='connect-calendar'){setTab('Account');return}if(action==='export-shifts')return exportCsv('crna-hub-shifts.csv',['date','facility','type','pay','status','note'],db.shifts);if(action==='export-mileage'){mileageExportInit();mileageExportOpen=true;return render()}if(action==='mileage-export-close'){mileageExportOpen=false;return render()}if(action==='mileage-export-this-month'){mileageExportApplyQuick('this-month');return render()}if(action==='mileage-export-ytd'){mileageExportApplyQuick('ytd');return render()}if(action==='mileage-export-all'){mileageExportApplyQuick('all');return render()}if(action==='mileage-export-none'){mileageExportApplyQuick('none');return render()}if(action==='mileage-export-download')return mileageExportDownload()}
async function makeMileageDrafts(){let count=0,auto=0,hotel=0,skipped=0;const skippedNoAddress=new Set();for(const x of db.shifts){if(/off|pto/i.test(x.type))continue;const f=facilityForRecord(x);if(!f)continue;if(db.mileage.some(m=>mileageTripMatchesShift(m,x)))continue;const stay=hotelStayFor(x.date,x.facility);let oneWay=null,source='',origin='home',hotelAddress='';if(stay){const res=await homeToFacilityMiles(f,stay.hotelAddress);if(res){oneWay=res.oneWay;source='auto';origin='hotel';hotelAddress=stay.hotelAddress}}else{const autoRes=await homeToFacilityMiles(f);if(autoRes){oneWay=autoRes.oneWay;source='auto'}else{oneWay=effectiveOneWayMiles(f);source='manual'}}const draft=mileageDraftForShift(x,f,oneWay,source,origin,hotelAddress,mileageTripType());if(!draft){skipped++;if(!String(f.address||'').trim())skippedNoAddress.add(f.name);continue}db.mileage.push(draft);count++;if(source==='auto')auto++;if(origin==='hotel')hotel++}persist();render();alert(`${count} mileage draft(s) created (${tripTypeLabel(mileageTripType())})${auto?` — ${auto} auto-calculated${hotel?`, ${hotel} from a hotel stay`:''}`:''}.${skipped?` ${skipped} shift(s) skipped — no usable address or manual distance on file.`:''}${skippedNoAddress.size?` Trips for ${[...skippedNoAddress].join(', ')} were skipped: no address is saved for ${skippedNoAddress.size===1?'that facility':'those facilities'} — add it on the Facilities tab so miles can be calculated.`:''} Review every trip and tax eligibility before using them.`)}
function csvEscape(v){const s=String(v??'');return /[",\n\r]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s}
function exportCsv(filename,headers,rows){download(filename,[headers.join(','),...rows.map(r=>headers.map(h=>csvEscape(r[h])).join(','))].join('\r\n'),'text/csv;charset=utf-8')}
function download(filename,contents,mime){const a=document.createElement('a'),url=URL.createObjectURL(new Blob([contents],{type:mime}));a.href=url;a.download=filename;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),3000)}
function parseCSV(str){const rows=[],row=[];let cell='',quote=false;for(let i=0;i<str.length;i++){const c=str[i];if(c==='"'){if(quote&&str[i+1]==='"'){cell+='"';i++}else quote=!quote}else if(c===','&&!quote){row.push(cell);cell=''}else if((c==='\n'||c==='\r')&&!quote){if(c==='\r'&&str[i+1]==='\n')i++;row.push(cell);if(row.some(x=>x.trim()))rows.push(row.slice());row.length=0;cell=''}else cell+=c}row.push(cell);if(row.some(x=>x.trim()))rows.push(row);return rows}
async function importCsv(e){e.preventDefault();const f=$('f_importFile').files[0],input=f?await f.text():$('f_importText').value,rows=parseCSV(input.replace(/^\uFEFF/,''));let count=0,skipped=0;const csvRecs=[];for(let i=0;i<rows.length;i++){const r=rows[i].map(x=>x.trim());if(i===0&&/date/i.test(r[0])&&!/^\d{4}-\d{2}-\d{2}$/.test(r[0]))continue;if(!/^\d{4}-\d{2}-\d{2}$/.test(r[0])||Number.isNaN(Date.parse(r[0]+'T12:00:00'))||!r[1]){skipped++;continue}const facility=r[1],type=r[2]||'Other',f=db.facilities.find(x=>x.name.toLowerCase()===facility.toLowerCase());let pay='',incomplete=true;if(r[3]!==undefined&&r[3]!==''){pay=String(num(r[3]));incomplete=false}else if(f){const p=facilityPayFor(f,type,r[0]);if(p>0){pay=String(p);incomplete=false}}csvRecs.push({id:id(),date:r[0],facility,type,pay,incomplete,status:importStatusForDate(r[0]),note:'CSV import',source:'csv-import',sources:['csv-import']})}
// Double-booking guard (v115): CSV has no preview to stop at, so
// conflicting rows are left out and named in the result message.
const csvCls=classifyImportRecords(csvRecs);const csvAdd=new Set([...csvCls.clean,...csvCls.dups]);
for(const rec of csvRecs){if(!csvAdd.has(rec))continue;const res=addShiftDeduped(rec);if(res.merged){skipped++;continue}count++}persist();render();alert(`Imported ${count} shift(s); skipped ${skipped} invalid or duplicate row(s).${csvCls.conflicts.length?` Left out ${csvCls.conflicts.length} row(s) that would double-book you: ${csvCls.conflicts.map(c=>c.text).join('; ')}.`:''}`)}
async function restoreBackup(e){const file=e.target.files[0];if(!file)return;try{const data=JSON.parse(await file.text());for(const key of ['shifts','facilities','pto','credentials','mileage'])if(!Array.isArray(data[key]))throw Error('Missing or invalid '+key);if(!confirm('Replace all current records with this backup?'))return;const next=empty();for(const k of ['shifts','facilities','pto','credentials','mileage'])next[k]=data[k];if(data.settings&&typeof data.settings==='object')next.settings={...next.settings,...data.settings};if(data.nbcrna&&typeof data.nbcrna==='object')next.nbcrna=data.nbcrna;if(data.aana&&typeof data.aana==='object')next.aana=data.aana;if(Array.isArray(data.nbcrnaCE))next.nbcrnaCE=data.nbcrnaCE;if(Array.isArray(data.aanaCE))next.aanaCE=data.aanaCE;if(Array.isArray(data.licenses))next.licenses=data.licenses;if(Array.isArray(data.documents))next.documents=data.documents;if(Array.isArray(data.assistantChat))next.assistantChat=data.assistantChat;if(Array.isArray(data.portalChecks))next.portalChecks=data.portalChecks;if(Array.isArray(data.portalMonitoring))next.portalMonitoring=data.portalMonitoring;if(Array.isArray(data.contracts))next.contracts=data.contracts;if(Array.isArray(data.payStubs))next.payStubs=data.payStubs;if(Array.isArray(data.hotelStays))next.hotelStays=data.hotelStays;normalizeStoredRates(next);db=next;dedupeShiftsInPlace();healShiftsAfterChange();persist();render();alert(cloudActive&&cloudSession?'Backup restored onto this device only. It did NOT overwrite your cloud account. They merge with your account automatically on the next sync.':'Backup restored.')}catch(err){alert('Could not restore backup: '+err.message)}}

// --- Contract import (AI vision PRIMARY, on-device OCR fallback) ---
// FINAL native-app form. Reads text the browser can actually read
// client-side: .txt, .csv contract text, .ics calendar files, and PDF files
// with a text layer (via PDF.js from a CDN, loaded on demand only for PDFs).
// Pictures (.png/.jpg/.jpeg/.webp, .heic where the browser can decode it)
// go to "Read with AI" FIRST (recommended): the selected photos are sent to
// OpenAI (gpt-4o-mini) through the extract-contract Edge Function, and the
// returned rates merge into the SAME preview — never straight to save.
// AI is primary because on-device OCR dropped the Daily / Premium / 1st-call
// rows from a real contract's rates table entirely (Nov 5, 2026) — OCR is
// the fallback only, for when there is no connection: it runs ON-DEVICE with
// Tesseract.js (loaded on demand from a CDN only when a picture is chosen),
// the picture is never sent to a server for OCR, and its rows are flagged
// lower-confidence ("from photo — check carefully"), because OCR can misread
// digits and dates. The fallback is an explicit button tap, never a silent
// default — a photo submit with no sign-in says so instead of OCR-ing.
// Nothing is saved until the user reviews the preview table and clicks
// Approve. Unpriced shifts keep pay '' and are marked incomplete, never $0.
// Certification-card OCR (Credentials tab) is separate and stays on-device:
// it works, and a card photo is not a contract rates table.
let contractPreview=null,contractImportError='';
// Set by approveFacilityContract when a contract is about to create a
// brand-new facility: the approval stops and the preview asks the user
// to confirm creating it (or point the contract at a saved facility
// instead) before anything is saved.
let facilityContractConfirmCreate=false;
let facilityContractPreview=null,facilityContractError='',facilityContractOcrStatus='',facilityContractPendingImages=[],facilityContractOcrPages=[];
let facilityContractFallbackNote='';
// Income disclaimer (Nov 5, 2026): income figures are estimates from the
// user's own rates and shifts. Short, visible but not blocking, and not
// legal advice — shown wherever income totals or the rates behind them
// appear (Dashboard, Facilities/contract preview).
const INCOME_DISCLAIMER='Income figures are estimates from your own rates and shifts — always double-check them against your actual paystubs. CRNA Hub is not liable for mistakes.';
let facilityContractCropNote='',facilityContractLastCropAdded=[];
// Plain-language rule chat (Nov 6, 2026): in the Facilities contract
// panel, the user can describe a pay rule the rate boxes do not cover
// ("24hr call, first 8 hours $250/hr, then after 3pm 175/hr until
// 7am"). The text goes to the extract-contract Edge Function in
// 'rule' mode (live AI, server-side key only); the structured rule
// comes back as a preview with editable fields, and NOTHING is saved
// until the user taps "Use this rule" (merges it into the facility
// contract preview) and then saves that preview. Pay totals are
// computed by facilityPayFor / firstCallPay — the deterministic
// engine — never by the AI.
// Last region picked per contract page for 'Re-read cropped'
// (kind:index -> 'top' | 'middle' | 'bottom'); default 'bottom'.
let cropRegionByPage={};
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
 if(/(?:2nd|21d|20d)\s+call|second\s+call/.test(l))return 'Second call';
 if(/24\s*-?\s*hour|24h\b|(?:1st|ist|lst)\s+call|first\s+call/.test(l))return '24-hour call';
 if(/\(main\)/.test(l))return '8-hour day';
 // "<Facility> 8/10/12" — a capitalised name directly before the hour
 // count (the facility's own shorthand, e.g. "Holzer 8"). Generic for
 // every facility (neutrality, Nov 10, 2026 — this used to match one
 // facility's name only); the capital letter keeps prose like "paid
 // for 12 years" from classifying, and month names never count.
 const nameNum=line.match(/(?:^|\s)(?!Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[A-Z][A-Za-z'.]*\s+(12|10|8)\b/);
 if(nameNum)return nameNum[1]==='12'?'12-hour shift':nameNum[1]==='10'?'10-hour shift':'8-hour day';
 if(/12\s*-?\s*hour|12h\b/.test(l))return '12-hour shift';
 if(/10\s*-?\s*hour|10h\b/.test(l))return '10-hour shift';
 if(/8\s*-?\s*hour|8h\b|day\s+shift/.test(l))return '8-hour day';
 if(/\bcall\b/.test(l))return 'Call (unclassified)';
 return ''}
function contractFacilityForLine(line,globalFacility){const l=line;
 const known=(db.facilities||[]).map(f=>[f.name,...facilityAliases(f)]).flat().filter(Boolean).sort((a,b)=>b.length-a.length).find(n=>l.toLowerCase().includes(n.toLowerCase()));
 if(known){const f=facilityByNameOrAlias(known);return {name:f?f.name:known,fromSaved:true}}
 // A capitalised name leading the line, directly before a shift
 // marker ("Riverside 8", "Holzer 8/2nd call") — the facility's own
 // shorthand, generic for every facility (neutrality, Nov 10, 2026 —
 // this used to return one hard-coded facility name). Month and
 // weekday names, and plain shift words, never count as a name.
 const leadNm=l.trim().match(/^(?!Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec|Mon|Tue|Wed|Thu|Fri|Sat|Sun|Shift|Call|Day|Night)([A-Z][A-Za-z'&.]*(?:\s+[A-Z][A-Za-z'&.]*){0,2})\s+(?=(?:8|10|12|24)\b|(?:2nd|1st|second|first)\s+call\b|call\b)/);
 if(leadNm)return {name:leadNm[1].trim(),fromSaved:false};
 // A line that is just one capitalised word is a facility header
 // ("Holzer", "CAMC", "Riverside") — again generic, with common
 // non-facility words excluded.
 const bareNm=l.trim().match(/^([A-Z][A-Za-z'&.]{2,})$/);
 if(bareNm&&!/^(shift|call|day|night|weekend|schedule|meeting|lunch|appointment|vacation|holiday|birthday|dinner|training|conference|class|work|office|home|travel|flight|hotel|personal|reminder|deadline|payment|school|church)$/i.test(bareNm[1]))return {name:bareNm[1],fromSaved:false};
 const lab=l.match(/(?:facility|hospital|location|site|work\s+at)\s*:\s*([A-Za-z][^,\n;—-]{2,60})/i);
 if(lab)return {name:lab[1].trim().replace(/\s+(shift|call|day).*$/i,'').trim(),fromSaved:false};
 const gen=l.match(/([A-Z][A-Za-z'& ]+?(?:Hospital|Medical Center|Health System|Clinic))/);
 if(gen)return {name:gen[1].trim(),fromSaved:false};
 if(globalFacility)return {name:globalFacility,fromHeader:true};
 return {name:'',fromSaved:false}}
function contractExtractRates(text){text=String(text||'').replace(/--- Page \d+: [^\n]* ---/g,' ').replace(/\$[^\n]{0,14}/g,seg=>seg.replace(/O/g,'0').replace(/[lI](?=[0-9])/g,'1'));const rates={};let m;
 const textNoWeekend=String(text).split(/\r?\n/).filter(l=>!/weekend|saturday|sunday/i.test(l)).join('\n');
 const flatBase=text;
 if((m=text.match(/\$([\d,]+(?:\.\d{2})?)\s*(?:\/\s*hr|per hour|an hour|\/hour|hourly)/i)))rates.hourly=Number(m[1].replace(/,/g,''));
 const flat=(label,rx)=>{const hit=textNoWeekend.match(rx);if(hit)rates[label]=Number(hit[1].replace(/,/g,''))};
 const flatWeekend=(label,rx)=>{const hit=text.match(rx);if(hit)rates[label]=Number(hit[1].replace(/,/g,''))};
 flat('rate24',/\$([\d,]+(?:\.\d{2})?)(?:(?!hourly)[^$\n.;]){0,60}?(?:24\s*-?\s*hour|24h|1st call|first call)/i);
 flat('rate24',/(?:24\s*-?\s*hour|24h|1st call|first call)(?:(?!hourly)[^$\n.;]){0,60}?\$([\d,]+(?:\.\d{2})?)/i);
 flat('rateSecond',/\$([\d,]+(?:\.\d{2})?)[^$\n.;]{0,60}?(?:(?:2nd|21d|20d) call|second call)/i);
 flat('rateSecond',/(?:(?:2nd|21d|20d) call|second call)[^$\n.;]{0,60}?\$([\d,]+(?:\.\d{2})?)/i);
 // A flat DAY rate must be stated per day: the amount's own clause
 // has to say "per day / a day / daily / per shift / flat". Without
 // that, "$250/hr" standing near an "8-hour" mention would invent
 // a $250 per-shift rate — and a flat rate outranks the hourly
 // rule in the pricer, so the invention would silently win.
 const dayClause=/^[^.;\n]{0,60}?(?:per\s+day|a\s+day|daily|per\s+shift|flat)/i;
 const flatDay=(label,hoursRx)=>{for(const seg of textNoWeekend.split(/[.;\n]/)){if(!dayClause.test(seg))continue;const hit=seg.match(new RegExp('\\$([\\d,]+(?:\\.\\d{2})?)[^$]{0,60}?(?:'+hoursRx+')','i'))||seg.match(new RegExp('(?:'+hoursRx+')[^$]{0,60}?\\$([\\d,]+(?:\\.\\d{2})?)','i'));if(hit){rates[label]=Number(hit[1].replace(/,/g,''));return}}};
 flatDay('rate8','8\\s*-?\\s*hour|8h\\b');
 flatDay('rate10','10\\s*-?\\s*hour|10h\\b');
 flatDay('rate12','12\\s*-?\\s*hour|12h\\b');
 // The weekend spans are clause-bounded too (Nov 11, 2026,
 // v128): "…$4,200 on weekends. Second call pays $3,000…"
 // used to file Call 2's WEEKDAY $3,000 as its weekend rate,
 // because the span walked across the sentence boundary to
 // the next dollar. A missing value surfaces; a wrong one
 // would have been silent.
 flatWeekend('weekendRate24',/(?:weekend|saturday|sunday)[^$\n.;]{0,80}?(?:24\s*-?\s*hour|1st call)[^$\n.;]{0,40}?\$([\d,]+(?:\.\d{2})?)/i);
 flatWeekend('weekendRateSecond',/(?:weekend|saturday|sunday)[^$\n.;]{0,80}?(?:(?:2nd|21d|20d) call|second call)[^$\n.;]{0,40}?\$([\d,]+(?:\.\d{2})?)/i);
 if((m=text.match(/\$([\d,]+(?:\.\d{2})?)[^$\n]{0,50}?(?:call bonus|overnight call bonus)/i))||(m=text.match(/(?:call bonus|overnight[^$\n]{0,30}bonus|bonus[^$\n]{0,30}call)[^$\n]{0,40}?\$([\d,]+(?:\.\d{2})?)/i)))rates.callBonus=Number(m[1].replace(/,/g,''));
 if((m=text.match(/paid\s+for\s+(\d+(?:\.\d+)?)\s*hours/i)))rates.paidHours8=Number(m[1]);
 if((m=text.match(/(\d+(?:\.\d+)?)\s*paid\s+hours/i)))rates.paidHours8=Number(m[1]);
 if((m=text.match(/paid\s+(\d+(?:\.\d+)?)\s*hours/i)))rates.paidHours8=Number(m[1]);
 if(rates.rate8==null&&(m=text.match(/\$([\d,]+(?:\.\d{2})?)[^$\n]{0,40}?(?:per day|a day|day rate)/i)))rates.rate8=Number(m[1].replace(/,/g,''));
 if(rates.rate8==null&&(m=text.match(/(?:day rate|per day)[^$\n]{0,40}?\$([\d,]+(?:\.\d{2})?)/i)))rates.rate8=Number(m[1].replace(/,/g,''));
 if(rates.rate24==null&&(m=text.match(/(?:24\s*-?\s*hour|1st call|first call)\s*(?:call\s+)?rate\s*[:\-]?\s*\$([\d,]+(?:\.\d{2})?)/i)))rates.rate24=Number(m[1].replace(/,/g,''));
 if(rates.rateSecond==null&&(m=text.match(/(?:(?:2nd|21d|20d) call|second call)\s*(?:call\s+)?rate\s*[:\-]?\s*\$([\d,]+(?:\.\d{2})?)/i)))rates.rateSecond=Number(m[1].replace(/,/g,''));
 if(rates.callBonus==null&&(m=text.match(/\$([\d,]+(?:\.\d{2})?)[^$\n]{0,50}?(?:on-?call bonus|call bonus)/i)))rates.callBonus=Number(m[1].replace(/,/g,''));
 if((m=text.match(/\$([\d,]+(?:\.\d{2})?)\s*\/\s*hr/i)))rates.hourly=Number(m[1].replace(/,/g,''));
 // OCR/table fallback: real addenda put the label in the left column and the
 // amount in the right column, and OCR often splits that row across lines,
 // so the same-line patterns above miss it. Two passes, and only rates
 // still missing are filled — never overwrite a rate already found, never
 // guess one. (1) QUALIFIED patterns on the flattened text (newlines
 // collapsed): the label itself is specific ("Regular Daily Rate",
 // "1st call ... Hourly", "(?:2nd|21d|20d) call weeknight"), so a long gap to the
 // amount is safe. (2) GENERIC patterns run PER LINE, never flattened: a
 // flattened generic pattern can join a date row ("1/4/2027 2nd Call")
 // to the NEXT row's amount and invent a rate — that must not happen.
 // "1st call ... Hourly ... $175" is an HOURLY call rate, NOT a flat 24h
 // rate: it is extracted as hourlyCall1st and rate24 is never set from an
 // hourly 1st-call line. 1st-call math (confirmed): weekend = 24h x $175 =
 // $4,200; weekday = first 8h at the $250 premium hourly rate + 16h x $175
 // = $4,800. The $250 premium rate is used once for those first 8 hours —
 // it is NOT double-applied.
 text=text.replace(/\bS(\d[\d,]*\.\d{2})\b/g,'$$$1').replace(/\$\s+(\d)/g,'$$$1');
 const flatText=text.replace(/\r?\n/g,' ').replace(/\s+/g,' ');
 const fill=(key,rx)=>{if(rates[key]==null){const h=flatText.match(rx);if(h)rates[key]=Number(h[1].replace(/,/g,''))}};
 const fillNum=(key,rx)=>{if(rates[key]==null){const h=flatText.match(rx);if(h)rates[key]=Number(h[1])}};
 const fillLine=(key,rx)=>{if(rates[key]!=null)return;for(const ln of text.split(/\r?\n/)){const h=ln.match(rx);if(h){rates[key]=Number(h[1].replace(/,/g,''));return}}};
 fill('hourlyCall1st',/(?:1st call|first call)(?:(?!hourly)[^$]){0,40}?hourly[^$]{0,220}?\$\s*([\d,]+(?:\.\d{2})?)/i);
 fill('hourlyCall1st',/(?:1st call|first call)[^$]{0,40}?hourly[^$]{0,40}?\$\s*([\d,]+(?:\.\d{2})?)/i);
 fill('rate8',/(?:regular daily rate|daily rate)[^$]{0,220}?\$\s*([\d,]+(?:\.\d{2})?)/i);
 fill('rate8',/\$\s*([\d,]+(?:\.\d{2})?)[^$]{0,220}?(?:regular daily rate|daily rate)/i);
 fill('hourly',/(?:premium hourly rate|hourly rate|rate per hour|per hour)[^$]{0,220}?\$\s*([\d,]+(?:\.\d{2})?)/i);
 fill('hourly',/\$\s*([\d,]+(?:\.\d{2})?)[^$]{0,220}?(?:premium hourly rate|hourly rate)/i);
 if(rates.hourly==null){const h=flatText.match(/([\d,]+(?:\.\d{2})?)\s*(?:per hour|\/\s*hr|an hour)/i);if(h)rates.hourly=Number(h[1].replace(/,/g,''))}
 fill('rateSecond',/(?:(?:2nd|21d|20d) call|second call)[^$]{0,40}?weeknight[^$]{0,220}?\$\s*([\d,]+(?:\.\d{2})?)/i);
 fill('weekendRateSecond',/(?:(?:2nd|21d|20d) call|second call)[^$.]{0,40}?weekend[^$.]{0,220}?\$\s*([\d,]+(?:\.\d{2})?)/i);
 fill('weekendRateSecond',/(?:weekend|saturday|sunday)[^$.]{0,220}?(?:(?:2nd|21d|20d) call|second call)[^$.]{0,220}?\$\s*([\d,]+(?:\.\d{2})?)/i);
 fill('callBonus',/(?:call stipend|stipend)[^$]{0,220}?\$\s*([\d,]+(?:\.\d{2})?)/i);
 fill('callBonus',/\$\s*([\d,]+(?:\.\d{2})?)[^$]{0,220}?(?:call stipend|stipend)/i);
 fillNum('paidHours8',/(\d+(?:\.\d+)?)\s*hours?\s+paid/i);
 fillNum('paidHours8',/compensated for\s*(\d+(?:\.\d+)?)\s*hours?/i);
 fillNum('paidHours8',/hours?\s+paid\s*[:\-]?\s*(\d+(?:\.\d+)?)/i);
 fillNum('paidHours8',/paid\s+hours?\s*[:\-]?\s*(\d+(?:\.\d+)?)/i);
 fillNum('paidHours8',/minimum\s+(\d+(?:\.\d+)?)\s*hrs?/i);
 // Generic patterns, per line only (see note above).
 fillLine('rate8',/(?<!after\s)(?:8\s*-?\s*hour|8h\b)[^$]{0,220}?\$\s*([\d,]+(?:\.\d{2})?)/i);
 fillLine('rate8',/\$\s*([\d,]+(?:\.\d{2})?)[^$]{0,220}?(?:8\s*-?\s*hour|8h\b)/i);
 fillLine('rate10',/(?:10\s*-?\s*hour|10h\b)[^$]{0,220}?\$\s*([\d,]+(?:\.\d{2})?)/i);
 fillLine('rate10',/\$\s*([\d,]+(?:\.\d{2})?)[^$]{0,220}?(?:10\s*-?\s*hour|10h\b)/i);
 fillLine('rate12',/(?:12\s*-?\s*hour|12h\b)[^$]{0,220}?\$\s*([\d,]+(?:\.\d{2})?)/i);
 fillLine('rate12',/\$\s*([\d,]+(?:\.\d{2})?)[^$]{0,220}?(?:12\s*-?\s*hour|12h\b)/i);
 fillLine('rate24',/(?:24\s*-?\s*hour|24h\b)(?:(?!hourly)[^$]){0,220}?\$\s*([\d,]+(?:\.\d{2})?)/i);
 fillLine('rate24',/\$\s*([\d,]+(?:\.\d{2})?)(?:(?!hourly)[^$]){0,220}?(?:24\s*-?\s*hour|24h\b)/i);
 fillLine('rateSecond',/(?:(?:2nd|21d|20d) call|second call)[^$]{0,220}?\$\s*([\d,]+(?:\.\d{2})?)/i);
 fillLine('rateSecond',/\$\s*([\d,]+(?:\.\d{2})?)[^$]{0,220}?(?:(?:2nd|21d|20d) call|second call)/i);
 // Call-back hours included in 2nd-call pay ("1st hour of call back
 // included", "First two hours of call back included") — recorded, not priced.
 {const wk=flatText.match(/(?:2nd|21d|20d) call weeknight[\s\S]{0,200}?(\d+)(?:st|nd|rd|th)?\s*hours? of call back included/i);if(wk)rates.includedCallBackHoursWeeknight=Number(wk[1]);
  const we=flatText.match(/(?:2nd|21d|20d) call weekend[\s\S]{0,200}?(?:first two hours|(\d+)(?:st|nd|rd|th)?\s*hours?) of call back included/i);if(we)rates.includedCallBackHoursWeekend=we[1]?Number(we[1]):2;}
 // TABLE PAIRING, per-label nearest-amount (real-OCR fallback).
 // Why the old order-pairing failed on Caleb's actual photos (Nov 5, 2026):
 // it paired labels<->amounts by position and overwrote earlier matches,
 // but on his photos only TWO rate labels survived OCR at all — the 2nd-call
 // weeknight and weekend rows. The Regular Daily Rate ($2,000), Premium
 // Hourly Rate ($250) and 1st-call ($175) rows are MISSING from the OCR
 // text entirely (Page 2 OCR jumps from the dates straight to a "back
 // time for STAT C-Sections" fragment): Tesseract skipped those table
 // rows, it did not misread them, so no pairing can recover them — they
 // are flagged UNREADABLE downstream (see detectUnreadableContractRates),
 // never guessed. What pairing CAN do is pair the labels that ARE present
 // robustly, whether the amount is inline mid-sentence ("1 hour of
 // $1,000.00", "in call $2,000.00 pay"), in the right column hundreds of
 // characters after the label block, or before the label (amounts-first).
 // Order matters: BLOCK layouts are detected FIRST (all amounts in a
 // block before the first label, or all amounts in a block after the
 // last label) and paired by order — a per-label "nearest amount"
 // matcher would steal the wrong amount in those layouts, because the
 // nearest amount before a label in an amounts-first block belongs to
 // a different label. Per-label nearest runs only for the remaining
 // keys, and only for INLINE amounts (after the label, or immediately
 // before it). One amount is never claimed twice; a date row's "1st
 // Call" cannot borrow a later label (needWithin checks); footer phone
 // numbers and bare dates never count as amounts (only $/S amounts,
 // plus comma-thousands .00 amounts in true column-major mode).
 try{
  const normAmt=raw=>{const d=String(raw).replace(/[Oo]/g,'0').replace(/[lI]/g,'1').replace(/[^0-9.]/g,'');const v=Number(d);return Number.isFinite(v)&&v>0?v:null};
  const amounts=[];
  const amtRx=/(?:\$|S)\s*([0-9][0-9,\s]*\.[0-9]{2})/g; let am;
  while((am=amtRx.exec(flatText))!==null){const v=normAmt(am[1]);if(v!=null)amounts.push({index:am.index,value:v});}
  amounts.sort((a,b)=>a.index-b.index);
  const claimed=new Set();
  const labelSpecs=[
   {key:'rate8',rx:/regular\s+daily\s+rate/i,after:600,before:80},
   {key:'hourly',rx:/premium\s+hourly\s+rate/i,after:600,before:80},
   {key:'hourlyCall1st',rx:/(?:1st|ist|lst|first)\s+call\b/i,need:/hourly/i,needWithin:35,after:600,before:80},
   {key:'rateSecond',rx:/(?:2nd|21d|20d|2na|second)\s+call\b/i,need:/weeknight|mon[- ]?friday/i,needWithin:60,after:400,before:80},
   {key:'weekendRateSecond',rx:/(?:2nd|21d|20d|2na|second)\s+call\b/i,need:/weekend|saturday|sunday/i,needWithin:60,after:400,before:80},
   {key:'rate24',rx:/24\s*-?\s*hour\s+call\s+rate/i,after:400,before:80},
   {key:'callBonus',rx:/(?:overnight\s+call\s+bonus|call\s+bonus|call\s+stipend|stipend)/i,after:400,before:80}];
  const findLabelOccurrences=spec=>{
   const rx=new RegExp(spec.rx.source,spec.rx.flags.includes('g')?spec.rx.flags:spec.rx.flags+'g');
   const out=[]; let h;
   while((h=rx.exec(flatText))!==null){
    if(spec.need){const after=flatText.slice(h.index,h.index+spec.needWithin);if(!spec.need.test(after))continue}
    out.push({key:spec.key,index:h.index});break}
   return out};
  // (1) BLOCK layouts, paired by order. This runs FIRST and OVERRIDES
  // the qualified fill() results above: in a block layout those fills
  // grab the WRONG amount (e.g. in an amounts-first block, the $ amount
  // 220 chars before "Premium Hourly Rate" is the Daily Rate's $2,000,
  // not the $250 premium rate). A block is only trusted when a whole
  // block of amounts sits before the first label or after the last one
  // with no label interleaved — inline layouts never look like that,
  // so their (correct) fill() results are never overridden here.
  const allLabels=[];
  for(const spec of labelSpecs)allLabels.push(...findLabelOccurrences(spec));
  allLabels.sort((a,b)=>a.index-b.index);
  if(allLabels.length>=2){
   const firstLabel=allLabels[0].index,lastLabel=allLabels[allLabels.length-1].index;
   const beforeBlock=amounts.filter(a=>a.index<firstLabel);
   const afterBlock=amounts.filter(a=>a.index>lastLabel+400);
   let blockPool=null;
   if(beforeBlock.length>=allLabels.length)blockPool=beforeBlock;
   else if(afterBlock.length>=allLabels.length){
    blockPool=afterBlock;
    if(blockPool.length<allLabels.length){
     const bareRx=/(\d{1,3}(?:,\d{3})+\.\d{2})/g; let bm;
     while((bm=bareRx.exec(flatText))!==null){if(amounts.some(a=>Math.abs(a.index-bm.index)<3))continue;const v=normAmt(bm[1]);if(v!=null&&bm.index>lastLabel+400)blockPool.push({index:bm.index,value:v})}
     blockPool.sort((a,b)=>a.index-b.index);
    }
   }
   if(blockPool&&blockPool.length>=allLabels.length){
    for(let i=0;i<allLabels.length;i++){rates[allLabels[i].key]=blockPool[i].value;claimed.add(blockPool[i].index)}
   }
  }
  // Amounts already found by the qualified fill() patterns are claimed
  // next, so the per-label matcher below never re-assigns them.
  const foundVals=Object.values(rates).filter(v=>typeof v==='number');
  for(const v of foundVals){const a=amounts.find(x=>x.value===v&&!claimed.has(x.index));if(a)claimed.add(a.index)}
  // (2) Per-label nearest INLINE amount, for whatever is still missing.
  const claimNearest=(labelIdx,afterMax,beforeMax)=>{
   let best=null,bestDist=Infinity;
   for(const a of amounts){if(claimed.has(a.index))continue;
    const d=a.index-labelIdx;
    if(d>=0&&d<=afterMax&&d<bestDist){best=a;bestDist=d}
    else if(d<0&&-d<=beforeMax&&-d<bestDist){best=a;bestDist=-d}}
   if(best){claimed.add(best.index);return best.value}return null};
  for(const spec of labelSpecs){
   if(rates[spec.key]!=null)continue;
   const occ=findLabelOccurrences(spec);
   for(const o of occ){const v=claimNearest(o.index,spec.after,spec.before);if(v!=null){rates[spec.key]=v;break}}
  }
 }catch(e){/* table pairing is a fallback only — never break parsing */}
 return rates}
// --- Rates a photo did NOT read vs rates the contract did NOT state ---
// On Caleb's actual photos (Nov 5, 2026) the Regular Daily Rate ($2,000),
// Premium Hourly Rate ($250) and 1st-call ($175) rows are MISSING from the
// OCR text entirely: Page 2 OCR jumps from the assignment dates straight
// to a "back time for STAT C-Sections" fragment. Tesseract skipped those
// table rows — it did not misread them — so no parser can recover them and
// they must NEVER be guessed. But leaving them as plain "Not stated in
// contract" is wrong too: the contract DOES state them, the photo just did
// not read them. This detector runs only on photo OCR text, and only when
// there is positive evidence the rates table was partially read — a
// 2nd-call row with its amount, a "call back included" fragment, or a
// "back time for STAT C-Sections" fragment (the tail of the 1st-call row).
// Then a missing Daily / Premium / 1st-call / weekend-2nd rate is
// UNREADABLE, not "not stated". A memo, a CAMC contract with no call
// rows, or pasted text returns nothing here: missing there really does
// mean not stated. Keys are facility-rate keys (hourlyRate, rate8, ...).
function detectUnreadableContractRates(text,rates){
 const t=String(text||'');
 const hasSecond=rates&&(rates.rateSecond!=null||rates.weekendRateSecond!=null);
 const hasCallFragment=/back\s+time\s+for\s+STAT/i.test(t)||/call\s+back\s+included/i.test(t)||/premium\s+pay\s+accrues/i.test(t);
 const hasSecondLabel=/(?:2nd|21d|20d|2na|second)\s+call/i.test(t);
 if(!hasSecond&&!hasCallFragment&&!hasSecondLabel)return [];
 const out=[];
 if(rates.rate8==null)out.push('rate8');
 if(rates.hourly==null)out.push('hourlyRate');
 if(rates.hourlyCall1st==null)out.push('hourlyCall1st');
 if(rates.rateSecond!=null&&rates.weekendRateSecond==null&&/weekend|saturday|sunday/i.test(t))out.push('weekendRateSecond');
 return out}
function unreadableRatesWarningHTML(keys){
 if(!keys||!keys.length)return '';
 const names=keys.map(k=>FACILITY_RATE_LABELS[k]||k);
 return '<p class="hint"><strong>Not readable from these photos — not the same as “not stated”.</strong> The app could not read: '+escapeHTML(names.join(', '))+'. These rates are in the rates table at the bottom of page 2 of this contract, but the photo read skipped those rows — the table may have been cut off at a page edge, or read as a picture rather than text. <strong>On the Facilities tab, “Re-read just the rates table” re-reads the bottom of each photo without a new picture</strong> — or re-photograph that section closer (fill the frame with just the rates table, flat, well-lit), then upload the new photo, or type the values in the fields below. Nothing was guessed.</p>'}
function firstCallPay(hourlyCall1st,premiumHourly,weekend){if(hourlyCall1st==null)return null;if(weekend)return {pay:Math.round(hourlyCall1st*24*100)/100,source:'1st call hourly rate stated in document ($'+hourlyCall1st+'/hr x 24 hours, weekend)'};if(premiumHourly!=null)return {pay:Math.round((premiumHourly*8+hourlyCall1st*16)*100)/100,source:'1st call rate stated in document (weekday: 8h x $'+premiumHourly+'/hr + 16h x $'+hourlyCall1st+'/hr)'};return {pay:Math.round(hourlyCall1st*24*100)/100,source:'1st call hourly rate stated in document ($'+hourlyCall1st+'/hr x 24 hours)'}}
function contractResolvePay(row,rates,facilityObj,savedContract){const weekend=row.date?(facilityObj?isFacilityWeekend(facilityObj,row.date):([0,6].includes(new Date(row.date+'T12:00:00').getDay()))):false;
 const flatKey=row.type==='24-hour call'?(weekend&&rates.weekendRate24?['weekendRate24','weekend flat rate stated in document']:['rate24','flat rate stated in document'])
  :row.type==='Second call'?(weekend&&rates.weekendRateSecond?['weekendRateSecond','weekend flat rate stated in document']:['rateSecond','flat rate stated in document'])
  :row.type==='8-hour day'?['rate8','flat rate stated in document']:row.type==='10-hour shift'?['rate10','flat rate stated in document']:row.type==='12-hour shift'?['rate12','flat rate stated in document']:null;
 if(flatKey&&rates[flatKey[0]]!=null)return {pay:String(rates[flatKey[0]]),source:flatKey[1],flags:[]};
 if(row.type==='24-hour call'){const fc=firstCallPay(rates.hourlyCall1st,rates.hourly,weekend);if(fc)return {pay:String(fc.pay),source:fc.source,flags:[]}}
 if(rates.hourly!=null){const hours=row.type==='8-hour day'?(rates.paidHours8||8):row.type==='10-hour shift'?10:row.type==='12-hour shift'?12:row.type==='24-hour call'?null:8;
   if(hours){let pay=rates.hourly*hours,flags=[];
     if(row.type==='Second call'){if(rates.callBonus!=null)pay+=rates.callBonus;else flags.push('call bonus not stated in document — pay may be incomplete')}
     return {pay:String(Math.round(pay*100)/100),source:'hourly rate stated in document',flags}}}
 if(facilityObj){const fpay=facilityPayFor(facilityObj,row.type,row.date);
   if(fpay>0)return {pay:String(fpay),source:'saved facility rate (not stated in this document)',flags:['rate reused from saved facility — not stated in this document']}}
 if(savedContract&&savedContract.rates){const r=savedContract.rates;if(row.type==='24-hour call'){const fc=firstCallPay(r.hourlyCall1st,r.hourly,weekend);if(fc)return {pay:String(fc.pay),source:fc.source+' — from a saved contract',flags:['rate reused from a saved contract — not stated in this document']}}const spay=row.type==='24-hour call'?r.rate24:row.type==='Second call'?r.rateSecond:row.type==='8-hour day'?r.rate8:row.type==='10-hour shift'?r.rate10:row.type==='12-hour shift'?r.rate12:null;
   if(spay!=null)return {pay:String(spay),source:'saved contract rate (not stated in this document)',flags:['rate reused from a saved contract — not stated in this document']}}
 return {pay:'',source:'',flags:['unknown rate — pay not yet priced (incomplete, not $0)']}}
function parseContractText(text,fileName){const clean=String(text||'').replace(/^\uFEFF/,'').replace(/--- Page \d+: [^\n]* ---/g,' ');const years=(clean.match(/\b(19|20)\d{2}\b/g)||[]);let defaultYear=new Date().getFullYear();{const counts={};let best=null,bestN=0;for(const y of years){counts[y]=(counts[y]||0)+1;if(counts[y]>bestN){bestN=counts[y];best=y}}if(best!=null)defaultYear=+best}
 const rates=contractExtractRates(clean);
 let globalFacility='';const lab=clean.match(/(?:facility|hospital|location|site)\s*:\s*([A-Za-z][^,\n;:]{2,60})/i);if(lab)globalFacility=lab[1].trim();
 if(!globalFacility){const known=(db.facilities||[]).find(f=>clean.toLowerCase().includes(f.name.toLowerCase()));if(known)globalFacility=known.name}
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
     rows.push({date:'',facility:fac.name,type,pay:'',paySource:'',flags,include:true,source:'extracted-from-contract',status:importStatusForDate('')});continue}
   for(const d of dates){const fac=contractFacilityForLine(line,globalFacility);const flags=[];
     if(+d.iso.slice(0,4)!==defaultYear)flags.push('date year '+d.iso.slice(0,4)+' differs from the rest of this document ('+defaultYear+') — likely a typo, verify the date before approving');
     if(d.ambiguous)flags.push('ambiguous date — year assumed, verify it');
     if(d.rangeError)flags.push('date range could not be expanded — verify the end date');
     if(!fac.name)flags.push('unknown facility');
     if(fac.fromHeader)flags.push('facility assumed from document header — verify it');
     if(type==='Call (unclassified)')flags.push('shift type not classified — confirm 1st vs 2nd call');
     const facilityObj=facilityByNameOrAlias(fac.name);
     const savedContract=(db.contracts||[]).find(c=>(c.facility||'').toLowerCase()===fac.name.toLowerCase());
     const resolved=contractResolvePay({date:d.iso,type},rates,facilityObj,savedContract);flags.push(...resolved.flags);
     const dup=(db.shifts||[]).some(x=>x.date===d.iso&&x.facility===fac.name&&x.type===type)||rows.some(x=>x.date===d.iso&&x.facility===fac.name&&x.type===type);
     if(dup)flags.push('overlapping / duplicate shift already recorded or listed above');
     const lineMoney=/\$/.test(line)?contractMoney(line):null;
     let pay=resolved.pay,paySource=resolved.source;
     if(lineMoney!=null&&/(flat|for|total)/i.test(line)){pay=String(lineMoney);paySource='flat amount stated on this line in the document'}
     rows.push({date:d.iso,facility:fac.name,type,pay,paySource,flags,include:true,source:'extracted-from-contract',status:importStatusForDate(d.iso)})}}
 if(!effStart&&rows.length){const ds=rows.map(r=>r.date).filter(Boolean).sort();if(ds.length){effStart=ds[0];effEnd=ds[ds.length-1]}}
 const contract={id:id(),facility:globalFacility||(rows[0]?rows[0].facility:''),effectiveStart:effStart,effectiveEnd:effEnd,rates,source:'extracted-from-contract',sourceFile:fileName||'',method:'deterministic-parse (no AI model)',extractedAt:new Date().toISOString()};
 return {contract,rows}}
// --- Facilities from a contract (upload-first) ---
// Guiding principle: as much of the app as possible is a simple upload
// with minimal manual entry. The contract upload is the primary path for
// adding a facility; the manual form is only the backup. Everything the
// document states — facility name, address, hourly rate, flat shift
// rates, call rates, paid hours, effective dates — is extracted here and
// shown for correction; the user never re-types what the document
// already states. Fields the document does not state stay blank
// (blank = not taken / not applicable, never $0), never guessed.
// Works on rate-only documents too: unlike the shift import, this does
// NOT require shift dates in the document.
const FACILITY_RATE_LABELS={hourlyRate:'Hourly rate',paidHours8:'Paid hours for an 8-hour shift',rate8:'8-hour shift rate',rate10:'10-hour shift rate',rate12:'12-hour shift rate',rate24:'24-hour call rate',hourlyCall1st:'1st call hourly rate',rateSecond:'Second call rate',callBonus:'Overnight call bonus',weekendRate24:'Weekend 24-hour call rate',weekendRateSecond:'Weekend second call rate'};
const FACILITY_RATE_KEYS=Object.keys(FACILITY_RATE_LABELS);
function contractExtractAddress(text,facilityName){
  const clean=String(text||'');
  const street=/(?:Ave|Avenue|St|Street|Rd|Road|Blvd|Boulevard|Dr|Drive|Ln|Lane|Way|Ct|Court|Pl|Place|Pike|Hwy|Highway|Sq|Square|Ter|Terrace|Trl|Trail|Pkwy|Parkway|Cir|Circle)\b/;
  const full=clean.match(/(\d{1,6}\s+[A-Za-z0-9 .'\-]+?(?:Ave|Avenue|St|Street|Rd|Road|Blvd|Boulevard|Dr|Drive|Ln|Lane|Way|Ct|Court|Pl|Place|Pike|Hwy|Highway|Sq|Square|Ter|Terrace|Trl|Trail|Pkwy|Parkway|Cir|Circle)\b[^,\n]{0,60}?,\s*[A-Za-z .]+?,\s*[A-Z]{2}\s*\d{5}(?:-\d{4})?)/i);
  if(full)return full[1].replace(/\s+/g,' ').trim();
  const lab=clean.match(/(?:address|location)\s*:\s*(\d{1,6}[^\n]{5,90})/i);
  if(lab&&street.test(lab[1]))return lab[1].replace(/\s+/g,' ').trim();
  return '';
}
// The codes a contract document itself names (Nov 11, 2026,
// v131): the shift listing's task names, in the document's own
// spelling ("HOLZ - G Main (8)", "HOLZ - PCDO"). They ride along
// on every preview facility entry, because the preview's
// pay-words reader needs a code UNIVERSE: without one, its
// per-code machinery — statement blocks, the unpaid classifier,
// per-code read-back — never runs on this surface, and a code
// whose only expression is a code statement in the user's words
// ("Holz PCDO=post call day off=no pay") falls to the unknown
// list even though the card path resolves it from the saved
// facility's codeMap. A line counts as a listing line when it
// carries a date or classifies as a shift; rate prose (a $ on
// the line) never contributes codes.
function contractDocumentCodes(text){
  const out=[];const seen=new Set();
  for(const rawLine of String(text||'').split(/\r?\n/)){
    const line=rawLine.trim();
    if(!line||line.length>160)continue;
    if(line.includes('$'))continue;
    if(!contractDateList(line,new Date().getFullYear()).length&&!contractShiftType(line))continue;
    const m=line.match(/\b([A-Z][A-Z0-9]{1,5})\s+-\s+([A-Za-z][A-Za-z0-9 ()/&.'-]{1,30})/);
    if(!m)continue;
    const task=m[2].replace(/\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\b.*$/i,'').replace(/\s+\d{1,2}[:/]\d{2}.*$/,'').replace(/[\s\-–—,;:|]+$/,'').trim();
    if(!task||task.split(/\s+/).length>5)continue;
    const code=(m[1]+' - '+task).replace(/\s+/g,' ').trim();
    const k=codeIdentityKey(code);
    if(!k||seen.has(k))continue;
    seen.add(k);
    const ctype=canonicalTypeOf(code);
    const hm=/^(\d+)-hour/.exec(ctype||'');
    out.push({code,ctype,hours:hm?hm[1]:''});
    if(out.length>=30)break;
  }
  return out;
}
function parseFacilityContract(text,fileName){
  const clean=String(text||'').replace(/^\uFEFF/,'').replace(/--- Page \d+: [^\n]* ---/g,' ');
  const rates=contractExtractRates(clean);
  let parsed=null;try{parsed=parseContractText(clean,fileName)}catch(e){parsed={contract:{facility:'',effectiveStart:'',effectiveEnd:'',rates},rows:[]}}
  const names=[];
  const addName=n=>{n=String(n||'').trim().replace(/\s+(shift|call|day).*$/i,'').trim();if(!n)return;const li=n.toLowerCase();if(names.some(x=>x.toLowerCase()===li))return;if(names.some(x=>li.startsWith(x.toLowerCase()+' ')))return;const longer=names.findIndex(x=>x.toLowerCase().startsWith(li+' '));if(longer>=0)names[longer]=n;else names.push(n)};
  if(parsed.contract&&parsed.contract.facility)addName(parsed.contract.facility);
  for(const r of (parsed.rows||[]))if(r.facility)addName(r.facility);
  for(const f of (db.facilities||[])){if(clean.toLowerCase().includes(f.name.toLowerCase()))addName(f.name);for(const a of facilityAliases(f))if(a&&clean.toLowerCase().includes(a.toLowerCase()))addName(f.name)}
  const gen=clean.match(/([A-Z][A-Za-z'& ]{2,60}?(?:Hospital|Medical Center|Health System|Clinic))/g);
  if(gen)for(const g of gen)addName(g.trim());
  // All-caps facility abbreviations ("CAMC", "WVU", a new user's own
  // hospital code) are candidates only in name positions the document
  // itself gives them — a line that is just the code, the start of a
  // line that states money, or anywhere on a classifiable shift line
  // — never from a hard-coded list of one user's hospitals
  // (neutrality, Nov 10, 2026). Generic document words are excluded,
  // so prose like "DAILY RATE $2,000" suggests nothing.
  const acrStop=new Set(['USD','CPT','ICD','LLC','INC','EHR','EMR','HIPAA','IRS','SSN','DOB','USA','THE','AND','FOR','ALL','ANY','PER','RATE','TOTAL']);
  for(const ln of clean.split(/\r?\n/)){
    const trimmed=ln.trim();
    if(/^[A-Z]{3,5}$/.test(trimmed)){if(!acrStop.has(trimmed))addName(trimmed);continue}
    const isShiftLine=!!contractShiftType(ln);
    if(!/\$/.test(ln)&&!isShiftLine)continue;
    const toks=new Set();
    const startTk=trimmed.match(/^([A-Z]{3,5})\b/);if(startTk)toks.add(startTk[1]);
    if(isShiftLine)for(const tk of (ln.match(/\b[A-Z]{3,5}\b/g)||[]))toks.add(tk);
    for(const tk of toks)if(!acrStop.has(tk))addName(tk);
  }
  const address=contractExtractAddress(clean,names[0]||'');
  const rateFields={};
  const map={hourly:'hourlyRate',paidHours8:'paidHours8',rate8:'rate8',rate10:'rate10',rate12:'rate12',rate24:'rate24',hourlyCall1st:'hourlyCall1st',rateSecond:'rateSecond',callBonus:'callBonus',weekendRate24:'weekendRate24',weekendRateSecond:'weekendRateSecond'};
  for(const [k,v] of Object.entries(rates))if(map[k]&&rateOrNull(v)!=null)rateFields[map[k]]=String(rateOrNull(v));
  if(rates.includedCallBackHoursWeeknight!=null||rates.includedCallBackHoursWeekend!=null){const bits=[];if(rates.includedCallBackHoursWeeknight!=null)bits.push('2nd call weeknight: first '+rates.includedCallBackHoursWeeknight+' hour(s) of call back included in call pay');if(rates.includedCallBackHoursWeekend!=null)bits.push('2nd call weekend: first '+rates.includedCallBackHoursWeekend+' hour(s) of call back included in call pay');rateFields._includedNote=bits.join('; ')}
  const found=[],missing=[];
  for(const k of FACILITY_RATE_KEYS){if(rateFields[k]!=null)found.push(FACILITY_RATE_LABELS[k]+' '+currency(Number(rateFields[k])));else missing.push(FACILITY_RATE_LABELS[k])}
  if(rateFields._includedNote)found.push(rateFields._includedNote);
  const facilities=(names.length?names:[{name:''}].map(x=>x.name)).map(n=>({name:n,aliases:'',address:address||'',rates:{...rateFields},effectiveStart:(parsed.contract&&parsed.contract.effectiveStart)||'',effectiveEnd:(parsed.contract&&parsed.contract.effectiveEnd)||'',include:true,found:[...(n?['Facility name']:[]),...(address?['Address']:[]),...found],missing:[...(n?[]:['Facility name']),...(address?[]:['Address']),...missing]}));
  const contract={id:id(),facility:facilities[0]?facilities[0].name:'',effectiveStart:(parsed.contract&&parsed.contract.effectiveStart)||'',effectiveEnd:(parsed.contract&&parsed.contract.effectiveEnd)||'',rates,source:'extracted-from-contract',sourceFile:fileName||'',method:'deterministic-parse (no AI model)',extractedAt:new Date().toISOString()};
  // Amounts the document names that no extracted rate accounts
  // for ride along on each preview facility (Nov 11, 2026,
  // v123): the preview lists them under the words box as one
  // words-level question — named amounts are always accounted
  // for, never silently dropped.
  const unattached=contractUnattachedAmounts(clean,rates);
  for(const f of facilities)f.unattached=unattached.slice();
  // The codes the document names ride along the same way (v131):
  // the preview's words reader gets its universe from them.
  const docCodes=contractDocumentCodes(clean);
  for(const f of facilities)f.codes=docCodes.map(c=>({...c}));
  return {contract,facilities,shiftCount:(parsed.rows||[]).length,isPhoto:false};
}
function icsAddDaysStr(d,n){const t=new Date(d+'T12:00:00Z');t.setUTCDate(t.getUTCDate()+n);return t.toISOString().slice(0,10)}
function icsSpanDays(dtStartRaw,dtEndRaw,startDateStr){
 // Covered calendar days of an ICS event (v130) — the same end
 // semantics as the server's spanLastCoveredDay: a date-only DTEND is
 // EXCLUSIVE (Mon + end Sat covers Mon–Fri); a DTEND at exactly
 // midnight does not claim that final day; any other DTEND covers its
 // date. And the same BLOCK test as the server's spanBlockLastDay: a
 // timed event is a block only at 48+ hours — one shift crossing
 // midnight (a night float, a 24-hour call) is not a block. Returns
 // [start] for single-day events, non-blocks, and spans over 62 days
 // (a placement/leave marker, not a shift block).
 if(!/^\d{4}-\d{2}-\d{2}$/.test(startDateStr||''))return [];
 const t=String(dtEndRaw||'').trim();let last='';
 let m=/^(\d{4})(\d{2})(\d{2})$/.exec(t);
 if(m)last=icsAddDaysStr(m[1]+'-'+m[2]+'-'+m[3],-1);
 else{m=/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})/.exec(t);if(m){const d=m[1]+'-'+m[2]+'-'+m[3];last=(m[4]==='00'&&m[5]==='00')?icsAddDaysStr(d,-1):d}}
 if(!last||last<=startDateStr)return [startDateStr];
 if(!/^\d{8}$/.test(t)){
   const ms=v=>{const mm=/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?/.exec(String(v||'').trim());return mm?Date.UTC(+mm[1],+mm[2]-1,+mm[3],+mm[4],+mm[5],+(mm[6]||0)):NaN};
   const dur=ms(dtEndRaw)-ms(dtStartRaw);
   if(!(dur>=48*3600*1000))return [startDateStr];
 }
 const total=Math.round((Date.parse(last+'T12:00:00Z')-Date.parse(startDateStr+'T12:00:00Z'))/86400000)+1;
 if(total<2||total>62)return [startDateStr];
 const out=[];for(let i=0;i<total;i++)out.push(icsAddDaysStr(startDateStr,i));
 return out}
function parseICS(text,fileName){const clean=String(text||'').replace(/^\uFEFF/,'');const rates=contractExtractRates(clean);const rows=[];let globalFacility='';
 const blocks=clean.split(/BEGIN:VEVENT/i).slice(1);
 for(let bi=0;bi<blocks.length;bi++){const b=blocks[bi];const get=k=>{const m=b.match(new RegExp(k+':(.*)','i'));return m?m[1].trim():''};
   const dt=get('DTSTART(?:;[^:]*)?');let dateStr=dt.replace(/^(\d{4})(\d{2})(\d{2}).*$/,'$1-$2-$3');if(!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)){const p=contractParseSingle(dt);dateStr=p.iso||''}
   const dtEnd=get('DTEND(?:;[^:]*)?');
   const summary=get('SUMMARY'),location=get('LOCATION'),desc=get('DESCRIPTION').replace(/\\n/g,' ');
   const type=contractShiftType(summary+' '+desc)||'Other';
   const facObj=contractFacilityForLine(location||summary,globalFacility);
   const facility=facObj.name||location||'';if(facility&&!globalFacility)globalFacility=facility;
   const flags=[];if(!facility)flags.push('unknown facility');if(type==='Other')flags.push('shift type not classified from event title');
   if(/RRULE/i.test(b))flags.push('recurring rule (RRULE) not expanded — only the first occurrence is listed');
   const facilityObj=facilityByNameOrAlias(facility);
   const savedContract=(db.contracts||[]).find(c=>(c.facility||'').toLowerCase()===facility.toLowerCase());
   const resolved=contractResolvePay({date:dateStr,type},rates,facilityObj,savedContract);flags.push(...resolved.flags);
   if((db.shifts||[]).some(x=>x.date===dateStr&&x.facility===facility&&x.type===type))flags.push('overlapping / duplicate shift already recorded');
   // Multi-day events (v130): one event covering several days (a week
   // block typed as a single calendar event) becomes ONE ROW PER
   // COVERED DAY when its kind is a day shift — or when it is an
   // all-day event at a facility the event itself names (each day is
   // then classified and priced per day at approve time, exactly like
   // a single-day import; an unpaid/PCDO day settles at $0 there). A CALL event is
   // never split: it stays one row on its first day, flagged. A timed
   // event whose kind cannot be classified also stays on its first
   // day, flagged — never guessed. Every row is listed in the preview
   // with its flag, so the expansion is approved explicitly, and each
   // row keeps its source block index (blockIndex) so per-block data
   // (an "Expected gross" line) still lands on the right block.
   const spanDays=icsSpanDays(dt,dtEnd,dateStr);
   const spanKind=(type==='24-hour call'||type==='Second call'||type==='Call (unclassified)')?'call':((type==='8-hour day'||type==='10-hour shift'||type==='12-hour shift')?'day':'');
   const expandSpan=spanDays.length>1&&(spanKind==='day'||(spanKind===''&&/^\d{8}$/.test(dt.trim())&&!!facObj.fromSaved));
   const emitDays=expandSpan?spanDays:[dateStr];
   for(const dayKey of emitDays){
     const dayFlags=flags.slice();
     if(spanDays.length>1){
       if(expandSpan)dayFlags.push('one day of a '+spanDays[0]+' to '+spanDays[spanDays.length-1]+' block — the event covered '+spanDays.length+' days and is split into one shift per day');
       else if(spanKind==='call')dayFlags.push('multi-day call ('+spanDays[0]+' to '+spanDays[spanDays.length-1]+') — imported as one shift on its first day; a call is a single assignment');
       else dayFlags.push('this event spans '+spanDays.length+' days ('+spanDays[0]+' to '+spanDays[spanDays.length-1]+') — imported on its first day only');
     }
     const dayResolved=dayKey===dateStr?resolved:contractResolvePay({date:dayKey,type},rates,facilityObj,savedContract);
     if(dayKey!==dateStr){dayResolved.flags.forEach(f=>{if(!dayFlags.includes(f))dayFlags.push(f)});if((db.shifts||[]).some(x=>x.date===dayKey&&x.facility===facility&&x.type===type))dayFlags.push('overlapping / duplicate shift already recorded')}
     rows.push({date:dayKey,facility,type,pay:dayResolved.pay,paySource:dayResolved.source,flags:dayFlags,include:true,source:'extracted-from-contract',status:importStatusForDate(dayKey),blockIndex:bi});
   }}
 const ds=rows.map(r=>r.date).filter(Boolean).sort();
 const contract={id:id(),facility:globalFacility||(rows[0]?rows[0].facility:''),effectiveStart:ds[0]||'',effectiveEnd:ds[ds.length-1]||'',rates,source:'extracted-from-contract',sourceFile:fileName||'',method:'deterministic-parse (no AI model)',extractedAt:new Date().toISOString()};
 return {contract,rows}}
function contractPreviewHTML(){if(!contractPreview)return '<p class="muted">No contract parsed yet. Choose a file or paste text above, then click “Parse contract” — nothing is saved until you approve the preview below.</p>';
 const c=contractPreview.contract,rows=contractPreview.rows,need=rows.filter(r=>r.flags.length).length,clean=rows.length-need;
 return (contractPreview.isPhoto?ocrDiagnosticsHTML(contractOcrPages,contractPendingImages,contractPreview.ocrText||''):'')+unreadableRatesWarningHTML(contractPreview.unreadableRates||[])+(contractPreview.aiNote?`<p class="hint">${escapeHTML(contractPreview.aiNote)}</p>`:'')+`<p><strong>Read from:</strong> ${escapeHTML(contractPreview.fileName||'pasted text')} — ${contractPreview.aiRead?'read with AI from your photo':contractPreview.isPhoto?'read from your photo on this device':'read from the text you pasted'}. Check every row carefully — a read can misread digits and dates.</p>
 <p class="muted">Contract on file will be: ${escapeHTML(c.facility||'(facility to confirm)')} · ${c.effectiveStart?fmt(c.effectiveStart):'—'} to ${c.effectiveEnd?fmt(c.effectiveEnd):'—'} · Rates found: ${Object.keys(c.rates||{}).length?Object.entries(c.rates).map(([k,v])=>`${k} ${currency(v)}`).join(', '):'none stated in the document'}</p>
 <p>${rows.length} shift(s) in preview · ${clean} clean · ${need} need review. <strong>Nothing has been saved yet.</strong> Edit a row, uncheck rows you do not want, then approve. Rows with a missing date or facility cannot be approved until fixed or unchecked.</p>
 <div class="table-scroll"><table class="contract-table"><thead><tr><th>Include</th><th>Date</th><th>Facility</th><th>Shift type</th><th>Pay ($)</th><th>Flags / pricing source</th></tr></thead><tbody>
 ${rows.map((r,i)=>`<tr><td><input type="checkbox" class="contractInclude" data-row="${i}" ${r.include?'checked':''}></td>
 <td><input type="date" class="contractEdit" data-row="${i}" data-field="date" value="${escapeHTML(r.date||'')}"></td>
 <td><input type="text" class="contractEdit" data-row="${i}" data-field="facility" value="${escapeHTML(r.facility||'')}"></td>
 <td><select class="contractEdit" data-row="${i}" data-field="type">${['8-hour day','10-hour shift','12-hour shift','24-hour call','Second call','Other','Call (unclassified)'].map(o=>`<option value="${o}" ${r.type===o?'selected':''}>${o}</option>`).join('')}</select></td>
 <td><input type="number" min="0" step="0.01" class="contractEdit" data-row="${i}" data-field="pay" value="${escapeHTML(r.pay??'')}" placeholder="Not priced"></td>
 <td>${r.flags.length?`<span class="pill warn">${escapeHTML(r.flags.join(' · '))}</span>`:'<span class="pill">Clean</span>'}<div class="muted">${escapeHTML(r.paySource||'No rate found — leave pay blank to mark incomplete')}</div><div class="muted">Status: ${escapeHTML(shiftStatusLabel(r.status))} · Source: ${escapeHTML(r.source||'extracted-from-contract')}</div></td></tr>`).join('')}
 </tbody></table></div>
 ${importPaySchedHTML(contractPreview,'contract')}
${importConflictsHTML(contractPreview,'contract')}
 <div class="toolbar" style="margin-top:12px"><button data-action="contract-approve">Approve selected — create contract &amp; shifts</button><button type="button" class="secondary" data-action="contract-discard">Discard preview (save nothing)</button></div>
 <p class="hint">Unpriced rows (pay left blank) are saved as incomplete, never as $0. Approved shifts are stored in the same shift store as CSV imports, with status “confirmed” for past dates and “proposed” for future ones, and source “extracted-from-contract” (or “extracted-from-contract-photo” for picture imports).</p>`}
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
let contractPendingImages=[],contractOcrPages=[],contractOcrStatus='';
function contractImageDb(){return new Promise((res,rej)=>{const req=indexedDB.open('crna-hub-files',1);req.onupgradeneeded=()=>{if(!req.result.objectStoreNames.contains('files'))req.result.createObjectStore('files',{keyPath:'id'})};req.onsuccess=()=>res(req.result);req.onerror=()=>rej(req.error)})}
async function saveContractImage(contractId,file,pageIndex,pageCount){const dbx=await contractImageDb();const key=pageCount>1?contractId+'-page-'+(pageIndex||0):contractId;return new Promise((res,rej)=>{const tx=dbx.transaction('files','readwrite');tx.objectStore('files').put({id:key,contractId,page:pageIndex||0,name:file.name,type:file.type,blob:file,savedAt:new Date().toISOString()});tx.oncomplete=()=>res(true);tx.onerror=()=>rej(tx.error)})}
async function getContractImages(contractId){const dbx=await contractImageDb();const out=[];for(let i=0;i<50;i++){const rec=await new Promise((res,rej)=>{const req=dbx.transaction('files','readonly').objectStore('files').get(contractId+'-page-'+i);req.onsuccess=()=>res(req.result||null);req.onerror=()=>rej(req.error)});if(!rec)break;out.push(rec)}if(out.length)return out;const single=await getContractImage(contractId);return single?[single]:[]}
async function getContractImage(contractId){const dbx=await contractImageDb();return new Promise((res,rej)=>{const req=dbx.transaction('files','readonly').objectStore('files').get(contractId);req.onsuccess=()=>res(req.result||null);req.onerror=()=>rej(req.error)})}
async function viewContractImage(contractId,page){try{const recs=await getContractImages(contractId);if(!recs.length){alert('No picture is stored on this device for this contract.');return}const rec=page!=null?(recs.find(r=>(r.page??0)===page)||recs[page]||null):recs[0];if(!rec||!rec.blob){alert('No picture is stored on this device for this contract.');return}const url=URL.createObjectURL(rec.blob);window.open(url,'_blank');setTimeout(()=>URL.revokeObjectURL(url),60000)}catch(err){alert('Could not open the stored picture: '+err.message)}}
async function loadTesseract(){if(window.Tesseract)return window.Tesseract;await new Promise((res,rej)=>{const sc=document.createElement('script');sc.src='https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';sc.onload=res;sc.onerror=()=>rej(new Error('OCR library (Tesseract.js CDN) failed to load — check your connection and try again, or paste the contract text instead.'));document.head.appendChild(sc)});if(!window.Tesseract)throw new Error('OCR library failed to initialise.');return window.Tesseract}
async function ocrImageFile(file,onProgress,opts){const T=await loadTesseract();const params={logger:m=>{if(onProgress)onProgress(m)}};if(opts&&opts.psm)params.tessedit_pageseg_mode=String(opts.psm);try{const out=await T.recognize(file,'eng',params);return (out&&out.data&&out.data.text)||''}catch(e){if(opts&&opts.psm){const out=await T.recognize(file,'eng',{logger:m=>{if(onProgress)onProgress(m)}});return (out&&out.data&&out.data.text)||''}throw e}}
// Score OCR text for how much of a rates table it contains: distinct rate
// labels found, $ amounts found, characters read. Used to pick the best
// of several OCR passes over the same photo.
function ocrScoreText(text){const t=String(text||'');const labels=[/regular\s+daily\s+rate/i,/premium\s+hourly\s+rate/i,/(?:1st|ist|lst|first)\s+call/i,/(?:2nd|21d|20d|2na|second)\s+call/i,/call\s+weeknight|weeknight/i,/call\s+weekend|weekend/i];let n=0;for(const rx of labels)if(rx.test(t))n++;const amounts=(t.match(/\$\s*[\d,]+\.\d{2}/g)||[]).length;return {labels:n,amounts,chars:t.trim().length}}
// Upscale + contrast-boost a photo on a canvas before OCR. Returns a Blob
// or null if the browser cannot do it — never throws.
async function preprocessImageForOcr(file){try{if(typeof createImageBitmap!=='function'||typeof document==='undefined')return null;const bmp=await createImageBitmap(file);const scale=Math.max(1.5,Math.min(2.5,2400/Math.max(bmp.width||1,bmp.height||1)));const cv=document.createElement('canvas');cv.width=Math.round(bmp.width*scale);cv.height=Math.round(bmp.height*scale);const ctx=cv.getContext('2d');if(!ctx)return null;try{ctx.filter='grayscale(1) contrast(1.5) brightness(1.05)'}catch(e){}ctx.drawImage(bmp,0,0,cv.width,cv.height);if(bmp.close)bmp.close();return await new Promise(res=>{try{cv.toBlob(b=>res(b),'image/png')}catch(e){res(null)}})}catch(e){return null}}
// --- Cropped re-read of a photo (crop-and-re-read OCR) ---
// Why: on Caleb's addendum photos the whole-page Tesseract passes
// consistently SKIP the rates-table rows (Nov 5, 2026: three whole-page
// attempts — default PSM 3, PSM 6, contrast-boosted PSM 6 — returned
// byte-identical text: dates, then a "back time for STAT C-Sections"
// fragment, then the 2nd-call weeknight row). Iterating on whole-page
// passes is done. Reading a vertical slice alone makes the table fill
// the frame, so Tesseract segments it as its own block instead of
// dropping it as a page-edge table. The "Re-read just the rates table"
// button crops the BOTTOM HALF of every page (where the table sits on
// this addendum); each page also offers a top / middle / bottom THIRD,
// since a rates table can sit anywhere on a page. Cropping is done on
// a canvas on-device; only the cropped blob is handed to Tesseract —
// no picture is sent to a server, same as whole-page OCR.
// Crop text is stored per page (pg.cropText) and parsed SEPARATELY from
// the whole-page text: mergeCropRates*() fills only rates the whole-page
// parse left blank, never overwrites a rate already found, never
// guesses one. The whole-page parse is untouched, so a cropped re-read
// cannot regress what the full page already read.
function ocrCropRegion(region,w,h){
  const r=String(region||'bottom-half');
  let y0=0,y1=1;
  if(r==='top'){y0=0;y1=1/3}
  else if(r==='middle'){y0=1/3;y1=2/3}
  else if(r==='bottom'){y0=2/3;y1=1}
  else{y0=0.5;y1=1} // 'bottom-half' (default)
  const y=Math.round(h*y0);
  return {x:0,y,width:w,height:Math.max(1,Math.round(h*y1)-y)};
}
function ocrCropLabel(region){return {'bottom-half':'bottom half','top':'top third','middle':'middle third','bottom':'bottom third'}[String(region||'')]||'bottom half'}
async function cropImageForOcr(file,region){
  try{
    if(typeof createImageBitmap!=='function'||typeof document==='undefined')return null;
    const bmp=await createImageBitmap(file);
    const box=ocrCropRegion(region,bmp.width||1,bmp.height||1);
    const scale=Math.max(1,Math.min(2,1600/Math.max(box.width,1)));
    const cv=document.createElement('canvas');
    cv.width=Math.round(box.width*scale);cv.height=Math.round(box.height*scale);
    const ctx=cv.getContext('2d');if(!ctx)return null;
    try{ctx.filter='grayscale(1) contrast(1.5) brightness(1.05)'}catch(e){}
    ctx.drawImage(bmp,box.x,box.y,box.width,box.height,0,0,cv.width,cv.height);
    if(bmp.close)bmp.close();
    return await new Promise(res=>{try{cv.toBlob(b=>res(b),'image/png')}catch(e){res(null)}});
  }catch(e){return null}
}
// OCR one cropped slice of one photo, best-pass scoring like the whole
// page. Returns {text, pass} or null when the browser cannot crop.
async function ocrCropForFile(file,region,onProgress){
  const crop=await cropImageForOcr(file,region);
  if(!crop)return null;
  return ocrBestPassForFile(crop,onProgress);
}

// Multi-pass OCR for contract photos. The default Tesseract pass (PSM 3,
// automatic page segmentation) SKIPPED the rates-table rows on Caleb's
// photos entirely — Page 2 OCR jumps from the dates to a "back time for
// STAT C-Sections" fragment, so the Daily / Premium / 1st-call rows were
// never in the text for the parser to find. A different segmentation
// mode (PSM 6: assume a uniform block of text) and a contrast-boosted
// image can read table rows the default pass drops. So: run the default
// pass; if it already found at least 3 rate labels, accept it (fast path
// — most photos). Otherwise re-read with PSM 6, then with a preprocessed
// image + PSM 6, and keep the pass that found the most rate labels
// (then most $ amounts, then most characters). Every pass is on-device;
// a failed pass is skipped, never fatal. Returns {text, pass} where
// pass is 'default', 'psm6' or 'preprocessed-psm6'.
async function ocrBestPassForFile(file,onProgress){
 const passes=[{name:'default'},{name:'psm6',psm:'6'},{name:'preprocessed-psm6',preprocess:true,psm:'6'}];
 let best=null;
 for(const pass of passes){
  if(best&&best.score.labels>=3)break;
  try{
   if(pass.name!=='default'&&onProgress)onProgress({status:'re-reading with a different layout ('+pass.name+') — trying to read table rows the first pass skipped',progress:null});
   let src=file;
   if(pass.preprocess){const pre=await preprocessImageForOcr(file);if(!pre)continue;src=pre}
   const t=await ocrImageFile(src,onProgress,pass.psm?{psm:pass.psm}:null);
   const sc=ocrScoreText(t);
   const cand={text:t,pass:pass.name,score:sc};
   if(!best||sc.labels>best.score.labels||(sc.labels===best.score.labels&&(sc.amounts>best.score.amounts||(sc.amounts===best.score.amounts&&sc.chars>best.score.chars))))best=cand;
  }catch(e){continue}
 }
 if(!best)throw new Error('OCR could not read this picture.');
 return best}
// --- Multi-page contract pictures ---
// A contract photographed page by page: every picture input accepts several
// files. Pages are OCR'd on-device one by one, in the order selected, and
// the texts are combined in that order before the deterministic parser
// runs — so a rate on page 2 and shifts on page 3 land in one preview.
// Pages can be removed or reordered from the list under the form; the
// preview is re-parsed from the remaining pages without re-running OCR.
// ocrPages entries keep their File reference so a page removed mid-OCR
// is dropped from the combined text.
function isImageFile(f){if(!f)return false;const n=String(f.name||'').toLowerCase();return /image\//.test(f.type||'')||['.png','.jpg','.jpeg','.webp','.heic'].includes('.'+n.split('.').pop())}
function orderedOcrPages(pages,files){return (files||[]).map(f=>pages.find(p=>p.file===f)).filter(Boolean)}
function combinedOcrText(pages,files){const ordered=files?orderedOcrPages(pages,files):pages;return ordered.map((p,i)=>'--- Page '+(i+1)+': '+p.name+' ---\n'+(p.text||'')).join('\n\n')}
function ocrPageStatus(pg){if(pg&&pg.status)return pg.status;const t=String((pg&&pg.text)||'');return t.trim().length?'ok':'empty'}
// Crop text kept per page: the raw crop OCR for every page that was
// re-read cropped, joined for parsing; and the same sections with a
// header, for the raw-text view (diagnostics only — never parsed).
function combinedCropText(pages,files){const ordered=files?orderedOcrPages(pages,files):(pages||[]);return ordered.map(p=>p.cropText||'').filter(t=>String(t).trim()).join('\n')}
function cropSectionsText(pages,files){const ordered=files?orderedOcrPages(pages,files):(pages||[]);return ordered.map((p,i)=>p.cropText?('--- Cropped re-read, page '+(i+1)+' ('+(p.cropRegionLabel||'cropped')+'): '+(p.name||'photo')+' ---\n'+p.cropText):'').filter(Boolean).join('\n\n')}
// Merge rates parsed from cropped re-reads into a facility-contract
// preview: fills ONLY blank rates, never overwrites, never guesses.
// Returns the labels added (for the "Cropped re-read found: …" note).
function mergeCropRatesIntoFacilityPreview(p,cropText){
  const cropRates=contractExtractRates(String(cropText||''));
  const map={hourly:'hourlyRate',paidHours8:'paidHours8',rate8:'rate8',rate10:'rate10',rate12:'rate12',rate24:'rate24',hourlyCall1st:'hourlyCall1st',rateSecond:'rateSecond',callBonus:'callBonus',weekendRate24:'weekendRate24',weekendRateSecond:'weekendRateSecond'};
  const added=[];
  for(const [raw,facKey] of Object.entries(map)){
    if(cropRates[raw]==null||rateOrNull(cropRates[raw])==null)continue;
    if(p.contract&&p.contract.rates&&p.contract.rates[raw]==null)p.contract.rates[raw]=cropRates[raw];
    for(const f of (p.facilities||[])){
      if(f.rates&&(f.rates[facKey]==null||f.rates[facKey]==='')){
        f.rates[facKey]=String(rateOrNull(cropRates[raw]));
        const label=FACILITY_RATE_LABELS[facKey]||facKey;
        f.found.push(label+' '+currency(Number(f.rates[facKey])));
        f.missing=(f.missing||[]).filter(m=>m!==label);
        if(!added.includes(label))added.push(label);
      }
    }
  }
  return added;
}
// Same merge for the Facilities contract preview: fills the
// contract rates, then re-prices rows that are still unpriced from the
// newly found rates. Returns {added, priced}.
function mergeCropRatesIntoContractPreview(p,cropText){
  const cropRates=contractExtractRates(String(cropText||''));
  const added=[];
  p.contract.rates=p.contract.rates||{};
  for(const [k,v] of Object.entries(cropRates)){if(v!=null&&p.contract.rates[k]==null){p.contract.rates[k]=v;added.push(k)}}
  let priced=0;
  for(const r of (p.rows||[])){
    if(String(r.pay||'').trim())continue;
    const resolved=contractResolvePay(r,p.contract.rates,null,null);
    if(String(resolved.pay||'').trim()){
      r.pay=resolved.pay;r.paySource=resolved.source;
      r.flags=(r.flags||[]).filter(f=>!/unknown rate/i.test(f));
      for(const fl of (resolved.flags||[]))if(!r.flags.includes(fl))r.flags.push(fl);
      priced++;
    }
  }
  return {added,priced};
}

  // --- AI contract reading ("Read with AI", PRIMARY path) ---
  // The primary path for contract photos — OCR dropped the rates table
  // on a real contract, so AI reads first. ONLY on the user's explicit
  // action (the submit button, or the "Read with AI" tap) — never on
  // page load, never silently in the background. The tap
  // sends ONLY the photos the user selected (resized client-side to
  // <=1024px on the long side, JPEG) to OpenAI (gpt-4o-mini) through
  // the extract-contract Edge Function via the same-origin proxy
  // (api/fn.js) and the user's own Supabase auth token. The function
  // returns structured rates + transcribed text; the app maps them into
  // the SAME preview-before-save flow as OCR below — AI fills only
  // blank fields, never overwrites a rate the preview (or the user)
  // already has, never invents one, and nothing is saved until Approve.
  // The 1st-call hourly math is NOT done by the model: contractResolvePay
  // / firstCallPay already price a 24-hour call from the hourly rates
  // (weekday 8h x premium + 16h x 1st-call = $4,800 at $250/$175;
  // weekend 24h x 1st-call = $4,200 at $175), so the AI rates flow
  // through the same pricing as OCR rates. Until the owner adds the
  // OpenAI key in Supabase (Edge Functions -> Manage secrets ->
  // OPENAI_API_KEY), the function answers openai_key_missing and the
  // button shows the setup message instead of failing silently.
  const AI_KEY_MISSING_MESSAGE='AI reading isn\'t available yet. Nothing was saved.';
  // Model keys -> the app's internal contract-rates keys (the same keys
  // contractExtractRates returns, so the existing pricing reuses them).
  const AI_RATE_TO_CONTRACT={regular_daily_rate:'rate8',premium_hourly_rate:'hourly',first_call_hourly_rate:'hourlyCall1st',second_call_weeknight_rate:'rateSecond',second_call_weekend_rate:'weekendRateSecond',call_bonus:'callBonus'};
  // Internal contract-rates keys -> facility preview keys (same map as
  // parseFacilityContract / mergeCropRatesIntoFacilityPreview).
  const AI_RATE_TO_FACILITY={hourly:'hourlyRate',paidHours8:'paidHours8',rate8:'rate8',rate10:'rate10',rate12:'rate12',rate24:'rate24',hourlyCall1st:'hourlyCall1st',rateSecond:'rateSecond',callBonus:'callBonus',weekendRate24:'weekendRate24',weekendRateSecond:'weekendRateSecond'};
  let aiContractBusy=false;
  function aiNum(v){if(typeof v==='number')return (Number.isFinite(v)&&v>0)?v:null;if(typeof v==='string'){const n=Number(v.replace(/[$,\s]/g,''));return (Number.isFinite(n)&&n>0)?n:null}return null}
  // Map one AI rates object to internal contract-rates keys. Nulls stay
  // absent (never 0, never guessed). paid_hours_8h true means the 8-hour
  // day is paid as 8 hours; a bare hour count (e.g. 8.5) passes through.
  function aiRatesToContractRates(ai){const out={};if(!ai||typeof ai!=='object')return out;for(const [aiKey,internal] of Object.entries(AI_RATE_TO_CONTRACT)){const n=aiNum(ai[aiKey]);if(n!=null)out[internal]=n}const ph=ai.paid_hours_8h;if(ph===true||ph===1||String(ph).toLowerCase()==='true'||String(ph).toLowerCase()==='yes')out.paidHours8=8;else if(typeof ph==='number'&&ph>0&&ph<=24)out.paidHours8=ph;return out}
  // Resize one photo to <=1024px on the long side as a JPEG data URL
  // (same bound as the vision helper). Returns null when the browser
  // cannot do it — the caller then falls back to the original file.
  async function resizeContractImageForAI(file){try{if(typeof createImageBitmap!=='function'||typeof document==='undefined')return null;const bmp=await createImageBitmap(file);const w=bmp.width||0,h=bmp.height||0;if(!w||!h)return null;const scale=Math.min(1,1024/Math.max(w,h));const cv=document.createElement('canvas');cv.width=Math.max(1,Math.round(w*scale));cv.height=Math.max(1,Math.round(h*scale));const ctx=cv.getContext('2d');if(!ctx)return null;ctx.drawImage(bmp,0,0,cv.width,cv.height);if(bmp.close)bmp.close();if(typeof cv.toDataURL!=='function')return null;const url=cv.toDataURL('image/jpeg',0.82);return (typeof url==='string'&&url.indexOf('data:image/jpeg;base64,')===0)?url:null}catch(e){return null}}
  function fileToDataURL(file){return new Promise((res,rej)=>{try{const r=new FileReader();r.onload=()=>res(String(r.result||''));r.onerror=()=>rej(new Error('Could not read this photo.'));r.readAsDataURL(file)}catch(e){rej(e)}})}
  async function aiContractImagesDataURLs(files){const out=[];for(const f of (files||[]).slice(0,4)){let url=null;try{url=await resizeContractImageForAI(f)}catch(e){url=null}if(!url){try{url=await fileToDataURL(f)}catch(e){url=null}}if(url)out.push(url)}return out}
  async function callExtractContract(files){if(!SUPABASE_CONFIGURED)throw new Error('Supabase is not configured yet.');if(!cloudSession)throw new Error('Not signed in — sign in on the Account tab first.');const images=await aiContractImagesDataURLs(files);if(!images.length)throw new Error('Could not read these photos in this browser — try JPG or PNG exports.');let data;try{data=await liveSyncPost('extract-contract',{action:'extract-contract',images})}catch(e){if(e&&e.data&&e.data.error==='openai_key_missing'){const k=new Error(AI_KEY_MISSING_MESSAGE);k.data=e.data;throw k}throw e}if(data&&data.error==='openai_key_missing')throw new Error(AI_KEY_MISSING_MESSAGE);if(!data||data.ok===false)throw new Error((data&&data.message)||(data&&data.error)||'AI reading failed.');return data}
  // Merge AI rates into a facility-contract preview: fills ONLY blank
  // rates, never overwrites — a user correction in the preview wins.
  // Returns the labels added (for the "AI reading added: …" note).
  function mergeAiRatesIntoFacilityPreview(p,aiRates){const added=[];if(!p)return added;p.contract=p.contract||{};p.contract.rates=p.contract.rates||{};for(const [raw,facKey] of Object.entries(AI_RATE_TO_FACILITY)){const v=aiRates?aiRates[raw]:undefined;const n=rateOrNull(v);if(n==null)continue;if(p.contract.rates[raw]==null)p.contract.rates[raw]=n;for(const f of (p.facilities||[])){if(f.rates&&(f.rates[facKey]==null||f.rates[facKey]==='')){f.rates[facKey]=String(n);const label=FACILITY_RATE_LABELS[facKey]||facKey;const shown=label+' '+currency(n);if(!f.found.includes(shown))f.found.push(shown);f.missing=(f.missing||[]).filter(m=>m!==label);if(!added.includes(label))added.push(label)}}}return added}
  // Same merge for the Facilities contract preview: fills the
  // contract rates, then re-prices rows that are still unpriced from
  // the newly found rates (1st-call hourly math included — see
  // contractResolvePay). A row the user already priced keeps its pay.
  function mergeAiRatesIntoContractPreview(p,aiRates){const added=[];let priced=0;if(!p)return {added,priced};p.contract.rates=p.contract.rates||{};for(const [k,v] of Object.entries(aiRates||{})){if(v!=null&&p.contract.rates[k]==null){p.contract.rates[k]=v;added.push(k)}}for(const r of (p.rows||[])){if(String(r.pay||'').trim())continue;const resolved=contractResolvePay(r,p.contract.rates,null,null);if(String(resolved.pay||'').trim()){r.pay=resolved.pay;r.paySource=resolved.source;r.flags=(r.flags||[]).filter(f=>!/unknown rate/i.test(f));for(const fl of (resolved.flags||[]))if(!r.flags.includes(fl))r.flags.push(fl);priced++}}return {added,priced}}
  function applyAiFacilityName(p,ai){if(!p||!ai)return;const f=(p.facilities||[])[0];if(!f)return;if(ai.facility&&!String(f.name||'').trim()){f.name=String(ai.facility).trim();if(!f.found.includes('Facility name'))f.found.push('Facility name');f.missing=(f.missing||[]).filter(m=>m!=='Facility name')}if(ai.address&&!String(f.address||'').trim()){f.address=String(ai.address).trim();if(!f.found.includes('Address'))f.found.push('Address');f.missing=(f.missing||[]).filter(m=>m!=='Address')}}
  function aiNoteFor(added,priced){const bits=[];if(added&&added.length)bits.push('AI reading added: '+added.join(', '));if(priced)bits.push(priced+' shift(s) priced from those rates');if(!bits.length)return 'AI reading found no new rates — the preview already had them, or the document did not state them. Nothing was overwritten.';return bits.join('. ')+'. Check the values below — nothing is saved yet.'}
  // Feed one AI result into the Facilities preview. Builds the preview
  // from the transcribed text when there is no OCR preview yet, and
  // merges into the existing preview otherwise. Returns false when the
  // result holds no facility name and no rate at all.
  function applyAiToFacilityPreview(data,fileName){const rates=(data&&data.rates)||{};const aiRates=aiRatesToContractRates(rates);const rawText=String((data&&data.raw_text)||rates.raw_text||'');if(facilityContractPreview){const added=mergeAiRatesIntoFacilityPreview(facilityContractPreview,aiRates);applyAiFacilityName(facilityContractPreview,rates);if(rawText)for(const f of (facilityContractPreview.facilities||[]))f.unattached=contractUnattachedAmounts(rawText,f.rates||{});facilityContractPreview.aiRead=true;facilityContractPreview.aiNote=aiNoteFor(added,0);if(rawText&&!facilityContractPreview.ocrText)facilityContractPreview.ocrText=rawText;return true}const p=parseFacilityContract(rawText,fileName);p.isPhoto=true;p.fileName=fileName;p.aiRead=true;const added=mergeAiRatesIntoFacilityPreview(p,aiRates);applyAiFacilityName(p,rates);if(rawText)for(const f of (p.facilities||[]))f.unattached=contractUnattachedAmounts(rawText,f.rates||{});p.contract.method='ai-vision + deterministic-parse (gpt-4o-mini)';p.aiNote=aiNoteFor(added,0);const hasName=p.facilities.some(x=>String(x.name||'').trim());const hasRate=p.facilities.some(x=>Object.values(x.rates||{}).some(v=>v!=null&&v!==''));if(!hasName&&!hasRate)return false;facilityContractPreview=p;return true}
  // Feed one AI result into the Facilities contract preview. Same
  // shape as applyAiToFacilityPreview: build from the transcribed text
  // when there is no preview yet, merge into it otherwise. Returns
  // false when the result holds no shifts at all.
  function applyAiToContractPreview(data,fileName){const rates=(data&&data.rates)||{};const aiRates=aiRatesToContractRates(rates);const rawText=String((data&&data.raw_text)||rates.raw_text||'');if(contractPreview){const res=mergeAiRatesIntoContractPreview(contractPreview,aiRates);contractPreview.aiRead=true;contractPreview.aiNote=aiNoteFor(res.added,res.priced);if(rawText&&!contractPreview.ocrText)contractPreview.ocrText=rawText;return true}const p=parseContractText(rawText,fileName);p.contract.method='ai-vision + deterministic-parse (gpt-4o-mini)';p.contract.source='extracted-from-contract-photo';const res=mergeAiRatesIntoContractPreview(p,aiRates);p.rows.forEach(r=>{r.source='extracted-from-contract-photo';if(!r.flags.includes('from photo — check carefully (AI vision read — check carefully)'))r.flags=['from photo — check carefully (AI vision read — check carefully)',...r.flags]});p.unreadableRates=[];contractPreview={...p,fileName,isPhoto:true,aiRead:true,aiNote:aiNoteFor(res.added,res.priced),ocrText:rawText,imageFileName:contractPendingImages[0]?contractPendingImages[0].name:'',imageFileNames:contractPendingImages.map(x=>x.name)};return contractPreview.rows.length>0}
  // The "Read with AI" tap for either panel: pick the selected photos,
  // send them (max 4) to extract-contract, feed the result into the
  // preview. Nothing is saved here — Approve still does that.
  async function readContractWithAI(kind){if(aiContractBusy)return;const isFac=kind==='facility';const inputId=isFac?'f_facilityContractFile':'f_contractFile';const files=Array.from((($(inputId)||{}).files)||[]);const images=files.filter(isImageFile);const setStatus=m=>{if(isFac){facilityContractOcrStatus=m}else{contractOcrStatus=m}render()};const setError=m=>{if(isFac){facilityContractPendingImages=[];facilityContractOcrPages=[];facilityContractError=m;facilityContractOcrStatus=''}else{contractPendingImages=[];contractOcrPages=[];contractImportError=m;contractOcrStatus=''}render()};if(!images.length){setError('Choose contract photos first, then tap “Read with AI”. Nothing was sent.');return}if(!SUPABASE_CONFIGURED){setError('Sign-in isn’t available yet. Nothing was sent.');return}if(!cloudSession){setError('Sign in on the Account tab first — AI reading runs for your signed-in account. Nothing was sent.');return}aiContractBusy=true;const fileName=images.map(f=>f.name).join(', ');try{if(isFac){facilityContractPendingImages=images}else{contractPendingImages=images}setStatus('Sending '+images.length+' photo(s) to AI for reading — this can take a few seconds…');const data=await callExtractContract(images.slice(0,4));let ok=false;if(isFac){ok=applyAiToFacilityPreview(data,fileName);if(!ok){facilityContractFallbackNote='AI couldn’t find rates in those photos, so this was read on your device instead — check the rates carefully.';return importFacilityContractWithOCR()}}else{ok=applyAiToContractPreview(data,fileName);if(!ok){setError('AI read the photos but found no shifts in them (no date + shift pattern). Try the on-device reading button below, or paste the contract text instead. Nothing was saved.');return}}if(isFac){facilityContractOcrStatus='';facilityContractError=''}else{contractOcrStatus='';contractImportError=''}render()}catch(e){if(isFac){facilityContractFallbackNote='AI reading didn’t work just now, so this was read on your device instead — check the rates carefully.';return importFacilityContractWithOCR()}const msg=String((e&&e.message)||e||'');if(msg===AI_KEY_MISSING_MESSAGE||(e&&e.data&&e.data.error==='openai_key_missing'))setError(AI_KEY_MISSING_MESSAGE);else setError('AI reading failed: '+msg+' Nothing was saved.')}finally{aiContractBusy=false}}

  // --- Pay stubs: AI vision read + text read + approve (Nov 5, 2026) ---
// Same pattern as contracts: photos go to AI FIRST (recommended) via
// extract-contract mode 'paystub' — the same Edge Function and the same
// server-side OPENAI_API_KEY secret; the photos travel once, over HTTPS,
// and are not stored server-side by the function. Pasted text and
// text-layer PDFs are read on-device with the deterministic parser
// (parsePaystubText) — no AI, no network. Nothing is saved until the
// user reviews the preview and taps Approve.
async function callExtractPaystub(files){if(!SUPABASE_CONFIGURED)throw new Error('Supabase is not configured yet.');if(!cloudSession)throw new Error('Not signed in — sign in on the Account tab first.');const images=await aiContractImagesDataURLs(files);if(!images.length)throw new Error('Could not read these photos in this browser — try JPG or PNG exports.');let data;try{data=await liveSyncPost('extract-contract',{action:'extract-contract',mode:'paystub',images})}catch(e){if(e&&e.data&&e.data.error==='openai_key_missing'){const k=new Error(AI_KEY_MISSING_MESSAGE);k.data=e.data;throw k}throw e}if(data&&data.error==='openai_key_missing')throw new Error(AI_KEY_MISSING_MESSAGE);if(!data||data.ok===false)throw new Error((data&&data.message)||(data&&data.error)||'AI reading failed.');return data}
function applyAiToPaystubPreview(data,fileName){
  const p=(data&&data.paystub)||{};
  const parsed={agency:String(p.employer||p.agency||'').trim(),facility:String(p.facility||'').trim(),frequency:normalizePayFrequency(p.frequency),periodStart:psValidISO(p.period_start||''),periodEnd:psValidISO(p.period_end||''),payDate:psValidISO(p.pay_date||''),gross:p.gross_pay!=null?String(p.gross_pay):'',net:p.net_pay!=null?String(p.net_pay):'',found:[]};
  if(parsed.agency)parsed.found.push('Agency / employer');
  if(parsed.periodStart&&parsed.periodEnd)parsed.found.push('Pay period');
  if(parsed.payDate)parsed.found.push('Pay date');
  if(rateOrNull(parsed.gross)!=null)parsed.found.push('Gross pay');
  if(rateOrNull(parsed.net)!=null)parsed.found.push('Net pay');
  if(!parsed.frequency&&parsed.periodStart&&parsed.periodEnd)parsed.frequency=paystubFrequencyFromPeriod(parsed.periodStart,parsed.periodEnd);
  if(!parsed.agency&&!parsed.payDate&&!parsed.gross&&!parsed.net)return false;
  landPaystubPreview(paystubPreviewFromParsed(parsed,fileName,'AI reading',true));
  return true;
}
async function readPaystubWithAI(presetFiles){
  if(paystubBusy)return;
  const files=presetFiles&&presetFiles.length?presetFiles.slice():Array.from((($('f_paystubFile')||{}).files)||[]);
  const images=files.filter(isImageFile);
  if(!images.length){paystubError='Choose pay stub photos first, then tap “Read my pay stub”. Nothing was sent.';render();return}
  if(!SUPABASE_CONFIGURED){paystubError='Sign-in isn’t available yet. Nothing was sent.';render();return}
  if(!cloudSession){paystubError='Sign in on the Account tab first — AI reading runs for your signed-in account. Nothing was sent.';render();return}
  paystubBusy=true;const fileName=images.map(f=>f.name).join(', ');
  try{
    paystubStatus='Sending '+images.length+' photo(s) to AI for reading — this can take a few seconds…';paystubError='';paystubPreview=null;render();
    const data=await callExtractPaystub(images.slice(0,4));
    const ok=applyAiToPaystubPreview(data,fileName);
    if(!ok){return readPaystubOnDevice('AI couldn’t find the pay details in those photos, so this stub was read on your device instead — check it carefully.')}
    paystubStatus='';paystubError='';render();
  }catch(e){
    return readPaystubOnDevice('AI reading didn’t work just now, so this stub was read on your device instead — check it carefully.');
  }finally{paystubBusy=false}
}
async function readPaystubOnDevice(note){
  // The entry point (the general form, or a facility's card) stages
  // its photos in paystubPendingImages before any read runs; the
  // general panel's file input is only the fallback for a direct
  // call with nothing staged.
  const staged=(paystubPendingImages||[]).filter(isImageFile);
  const domFiles=Array.from((($('f_paystubFile')||{}).files)||[]);
  const images=(staged.length?staged:domFiles).filter(isImageFile);
  if(!images.length){paystubError='Choose pay stub photos first. Nothing was saved.';paystubStatus='';render();return}
  paystubBusy=true;
  try{
    paystubStatus='Reading your stub on this device — this can take a few seconds…';paystubError='';paystubPreview=null;render();
    const pages=[];
    for(let i=0;i<images.length;i++){try{const best=await ocrBestPassForFile(images[i]);pages.push({file:images[i],name:images[i].name,text:(best&&best.text)||'',status:((best&&best.text)||'').trim().length?'ok':'empty'})}catch(pageErr){pages.push({file:images[i],name:images[i].name,text:'',status:'failed'})}}
    const text=combinedOcrText(orderedOcrPages(pages,images),images);
    if(!text.trim()){paystubError='We couldn’t read any text from those photos. Try clearer, well-lit photos, paste the stub text, or add the schedule manually. Nothing was saved.';paystubStatus='';render();return}
    const parsed=parsePaystubText(text);
    if(!parsed.agency&&!parsed.payDate&&!parsed.gross&&!parsed.net){paystubError='We read the photos on this device but found no employer, pay date, or pay amount. Paste the stub text, or add the schedule manually. Nothing was saved.';paystubStatus='';render();return}
    const pvDev=paystubPreviewFromParsed(parsed,images.map(f=>f.name).join(', '),'Read on this device',false);
    pvDev.source='device-ocr';
    landPaystubPreview(pvDev);
    paystubStatus=note||'Read on this device — check it carefully.';paystubError='';render();
  }catch(err){paystubError='On-device reading failed: '+err.message+' Nothing was saved.';paystubStatus='';paystubPreview=null;render()}
  finally{paystubBusy=false}
}
async function importPaystub(e){
  e.preventDefault();paystubCardFacId='';paystubImportCtx=null;
  return runPaystubRead($('f_paystubFile')?Array.from($('f_paystubFile').files||[]):[],$('f_paystubText')?$('f_paystubText').value:'');
}
async function importPaystubCard(e,facId){
  e.preventDefault();paystubCardFacId=facId||'';paystubCardOpenFac=facId||'';paystubImportCtx=null;
  const fileEl=$('f_paystubCardFile_'+facId),textEl=$('f_paystubCardText_'+facId);
  return runPaystubRead(fileEl?Array.from(fileEl.files||[]):[],textEl?textEl.value:'');
}
// Third front door, same pipeline (Nov 10, 2026): a stub uploaded
// inside an import preview's pay-schedule section. The binding is
// the section's own agency/facility (importPaySchedCtx — the draft
// values the user sees in the fields), captured BEFORE the read so
// the preview can state it; approving the stub stamps the import
// preview (paySchedStubSaved) so the section shows the schedule as
// on file and the import's own approve completes normally.
async function importPaystubImport(e,kind){
  e.preventDefault();
  const p=kind==='cal'?calPreview:kind==='contract'?contractPreview:kind==='faccontract'?facilityContractPreview:schedulePreview;
  const ctx=p?importPaySchedCtx(p,kind):null;
  paystubCardFacId='';paystubImportCtx={kind,agency:ctx?ctx.agency:'',facility:ctx?ctx.facility:''};
  const fileEl=$('f_paystubImpFile_'+kind),textEl=$('f_paystubImpText_'+kind);
  return runPaystubRead(fileEl?Array.from(fileEl.files||[]):[],textEl?String(textEl.value||''):'');
}
// One read pipeline behind both front doors (Nov 10, 2026): the
// general panel and a facility's card each gather their files/text
// and land here — same readers, same preview, same approve. The
// entry point's paystubCardFacId is what binds the preview.
async function runPaystubRead(files,pastedText){
  paystubError='';paystubStatus='';paystubPreview=null;
  const imageFiles=files.filter(isImageFile);
  if(imageFiles.length){
    // One action: stub photos are read with AI automatically. If AI
    // cannot run (signed out / not configured), the on-device read
    // takes over automatically and the preview says so — the user
    // never picks a reading method.
    paystubPendingImages=imageFiles;
    if(!SUPABASE_CONFIGURED||!cloudSession)return readPaystubOnDevice('AI reading needs sign-in, so this stub was read on your device instead — check it carefully.');
    return readPaystubWithAI(imageFiles);
  }
  try{
    let text='',fileName='pasted text';const f=files[0]||null;
    if(f){fileName=f.name;if(/\.pdf$/i.test(f.name)||f.type==='application/pdf')text=await extractPdfText(f);else text=await f.text()}
    else text=pastedText||'';
    if(!text.trim()){paystubError='Nothing to read: choose a pay stub photo or PDF, or paste the stub text first. Nothing was saved.';render();return}
    const parsed=parsePaystubText(text);
    if(!parsed.agency&&!parsed.payDate&&!parsed.gross&&!parsed.net){paystubError='No pay-stub fields were found in this text (no employer, pay date, or pay amount). Check the text, or upload a photo and use AI reading. Nothing was saved.';render();return}
    landPaystubPreview(paystubPreviewFromParsed(parsed,fileName,'Pasted text / text-layer PDF — deterministic parsing, no AI model read this document',false));
    render();
  }catch(err){paystubError='Could not read this file: '+err.message+' Nothing was saved.';paystubPreview=null;render()}
}
function approvePaystub(){
  if(!paystubPreview)return;
  const p=paystubPreview;
  const agency=String(p.agency||'').trim();
  if(!agency){alert('Enter the agency / employer name first — each pay schedule belongs to one agency.');return}
  const frequency=normalizePayFrequency(p.frequency);
  const payDate=psValidISO(p.payDate);
  if(!frequency||!payDate){alert('A pay schedule needs a pay frequency and a pay date — the calendar dates come from those.');return}
  const gross=rateOrNull(p.gross)==null?'':String(rateOrNull(p.gross));
  const net=rateOrNull(p.net)==null?'':String(rateOrNull(p.net));
  // No amount is required any more: paychecks are calculated from the
  // user's shifts per period. An amount on the stub is kept as that
  // stub's own check actual — it is never a template for other checks.
  const rec={id:p.id||id(),agency,facility:String(p.facility||'').trim(),frequency,periodStart:psValidISO(p.periodStart),periodEnd:psValidISO(p.periodEnd),payDate,gross,net,source:p.source||(p.aiRead?'ai-vision':'text-parse'),fileName:p.fileName||'',updatedAt:new Date().toISOString()};
  // One schedule per agency: a new stub for an agency already on file
  // replaces that agency's schedule only — every other agency is
  // untouched. An edit of the same record keeps its id.
  const ex=paystubForAgency(agency);
  if(ex&&ex.id!==rec.id){
    // The replaced record's own stub actual is never lost (Nov 9,
    // 2026): if it was the actual for a DIFFERENT payday than the
    // new stub's, it rides on the new record as that check's
    // entered actual — two stubs for one agency, uploaded one
    // after another, both keep showing as actuals. Its per-check
    // corrections carry over the same way.
    const carried={...(ex.occOverrides&&typeof ex.occOverrides==='object'?ex.occOverrides:{})};
    const exAct=paystubStubActual(ex);
    if(exAct&&psValidISO(ex.payDate)&&ex.payDate!==rec.payDate&&rateOrNull((carried[ex.payDate]||{}).actual)==null)carried[ex.payDate]={actual:String(exAct.amount),payDate:ex.payDate};
    // A re-upload whose read came back WITHOUT an amount must never
    // erase the actual already on file for the SAME payday (Nov 9,
    // 2026, live trace): the blank replaces nothing — the known
    // actual carries onto the new record as its own amount, in its
    // original basis. A stated new amount always wins over the old.
    if(exAct&&psValidISO(ex.payDate)&&ex.payDate===rec.payDate&&!paystubStubActual(rec)){
      if(exAct.basis==='net')rec.net=String(exAct.amount);else rec.gross=String(exAct.amount);
    }
    if(Object.keys(carried).length)rec.occOverrides={...carried,...(rec.occOverrides&&typeof rec.occOverrides==='object'?rec.occOverrides:{})};
    db.payStubs=(db.payStubs||[]).filter(x=>x.id!==ex.id);cloudRecordTombstone('payStubs',ex.id);
  }
  const i=(db.payStubs||[]).findIndex(x=>x.id===rec.id);
  if(i>=0)db.payStubs[i]={...db.payStubs[i],...rec};
  else db.payStubs.push(rec);
  // A stub approved from inside an import preview stamps that
  // preview: its pay-schedule section switches to the on-file line
  // (never asks twice) and its apply path saves nothing more.
  if(p.importKind){const ip=p.importKind==='cal'?calPreview:p.importKind==='contract'?contractPreview:p.importKind==='faccontract'?facilityContractPreview:schedulePreview;if(ip)ip.paySchedStubSaved={agency:rec.agency,frequency:rec.frequency}}
  const nextRec=paystubSchedules().find(s=>s.id===rec.id||(s.mergedFrom||[]).includes(rec.id))||rec;
  const next=paystubNextPaydays(nextRec,1)[0]||'';
  paystubPreview=null;paystubError='';paystubStatus='';paystubCardFacId='';paystubCardOpenFac='';paystubImportCtx=null;editId=null;persist();cloudSaveKind('payStubs',rec.id);render();
  alert(`Pay schedule saved for ${agency} — ${PAY_FREQUENCY_LABELS[frequency]}${next?`, next expected payday ${fmt(next)}`:''}. Each paycheck is calculated from your shifts in its pay period${(gross||net)?` — and this stub's own check (${fmt(payDate)}) counts as the actual ${currency(num(gross||net))} from the stub`:''}. Paychecks for ${agency} now show on the Dashboard and calendar, labelled estimate or actual.`);
}

function ocrDiagnosticsHTML(pages,files,text){return ''}
function contractPagesHTML(kind){const imgs=kind==='contract'?contractPendingImages:facilityContractPendingImages;const pages=kind==='contract'?contractOcrPages:facilityContractOcrPages;if(!imgs.length)return '';return `<div class="item"><strong>Contract pages (${imgs.length})</strong> <span class="muted">— read in this order. Move up / down to reorder, Remove to drop a page.</span><ol>${imgs.map((f,i)=>{const pg=(pages||[]).find(x=>x.file===f);const st=pg?ocrPageStatus(pg):'pending';const chars=pg?String(pg.text||'').trim().length:0;return `<li>${escapeHTML(f.name)}${pg?` — ${st==='ok'?chars+' characters read':st==='failed'?'could not be read':'no readable text'}`:''} <button type="button" data-action="${kind}-page-up" data-id="${i}" ${i===0?'disabled':''}>Move up</button> <button type="button" data-action="${kind}-page-down" data-id="${i}" ${i===imgs.length-1?'disabled':''}>Move down</button> <button type="button" class="secondary" data-action="${kind}-page-remove" data-id="${i}">Remove</button>${pg?` <select class="cropRegionSelect" data-kind="${kind}" data-i="${i}" aria-label="Which part of page ${i+1} to re-read">${['top','middle','bottom'].map(r=>`<option value="${r}" ${((cropRegionByPage[kind+':'+i]||'bottom')===r)?'selected':''}>${r} third</option>`).join('')}</select> <button type="button" data-action="${kind}-page-crop-reread" data-id="${i}">Re-read cropped</button>`:''}</li>`}).join('')}</ol></div>`}
function reparseContractOcrPages(){if(!contractOcrPages.length){contractPreview=null;return false}const names=contractPendingImages.map(f=>f.name);const fileName=names.join(', ');const text=combinedOcrText(contractOcrPages,contractPendingImages);const p=parseContractText(text,fileName);const cropText=combinedCropText(contractOcrPages,contractPendingImages);if(cropText.trim())mergeCropRatesIntoContractPreview(p,cropText);p.unreadableRates=detectUnreadableContractRates(text+(cropText.trim()?'\n'+cropText:''),p.contract&&p.contract.rates||{});p.rows.forEach(r=>{r.source='extracted-from-contract-photo';r.flags=['from photo — check carefully (OCR can misread digits and dates)',...r.flags]});p.contract.method='ocr + deterministic-parse (on-device OCR, no AI model, no server upload for OCR)';p.contract.source='extracted-from-contract-photo';contractPreview={...p,fileName,isPhoto:true,ocrText:text+(cropText.trim()?('\n\n'+cropSectionsText(contractOcrPages,contractPendingImages)):''),ocrPages:contractOcrPages,imageFileName:contractPendingImages[0].name,imageFileNames:names};return contractPreview.rows.length>0}
function reparseFacilityContractOcrPages(){if(!facilityContractOcrPages.length){facilityContractPreview=null;return false}const names=facilityContractPendingImages.map(f=>f.name);const text=combinedOcrText(facilityContractOcrPages,facilityContractPendingImages);const p=parseFacilityContract(text,names.join(', '));p.isPhoto=true;p.fileName=names.join(', ');const cropText=combinedCropText(facilityContractOcrPages,facilityContractPendingImages);facilityContractLastCropAdded=cropText.trim()?mergeCropRatesIntoFacilityPreview(p,cropText):[];p.ocrText=text+(cropText.trim()?('\n\n'+cropSectionsText(facilityContractOcrPages,facilityContractPendingImages)):'');p.ocrPages=facilityContractOcrPages;const un=detectUnreadableContractRates(p.ocrText,p.contract&&p.contract.rates||{});p.unreadableRates=un;for(const f of (p.facilities||[]))f.unreadable=un;facilityContractPreview=p;facilityContractConfirmCreate=false;return p.facilities.some(x=>String(x.name||'').trim())||Object.values((p.facilities[0]||{}).rates||{}).some(v=>v!=null&&v!=='')}
// --- On-device contract-picture OCR (FALLBACK ONLY, contract) ---
// Explicit fallback for when there is no connection: runs ONLY when the
// user taps “No connection? Try on-device reading”. Never the submit
// default, never silent — AI reads first. Same preview-before-save flow
// as AI reading; OCR rows are flagged “from photo — check carefully”.
async function importContractWithOCR(e){if(e)e.preventDefault();contractImportError='';contractPendingImages=[];contractOcrPages=[];contractOcrStatus='';const files=$('f_contractFile')?Array.from($('f_contractFile').files||[]):[];const imageFiles=files.filter(isImageFile);const anyHeic=imageFiles.some(x=>/\.heic$/i.test(x.name||''));if(!imageFiles.length){contractImportError='Choose contract photos first, then tap the on-device reading button. Nothing was read, nothing was saved.';render();return}
if(imageFiles.length){
   contractPendingImages=imageFiles;contractOcrStatus='Reading picture 1 of '+imageFiles.length+' — this can take a few seconds per page…';contractImportError='';contractPreview=null;render();
   try{
     for(let i=0;i<imageFiles.length;i++){const img=imageFiles[i];contractOcrStatus='Reading picture '+(i+1)+' of '+imageFiles.length+' ('+img.name+') on this device with OCR…';const el0=document.getElementById('contractOcrStatus');if(el0)el0.textContent=contractOcrStatus;
       let t='',ocrPass='default';try{const best=await ocrBestPassForFile(img,m=>{const el=document.getElementById('contractOcrStatus');if(el&&m&&m.status)el.textContent=`Reading picture ${i+1} of ${imageFiles.length} (${img.name}) on this device with OCR… ${m.status}${m.progress!=null?' '+Math.round(m.progress*100)+'%':''}`});t=best.text;ocrPass=best.pass;contractOcrPages.push({file:img,name:img.name,text:t,status:t.trim().length?'ok':'empty',ocrPass})}catch(pageErr){contractOcrPages.push({file:img,name:img.name,text:'',status:'failed',error:String(pageErr&&pageErr.message||pageErr)})}}
     contractOcrStatus='';contractOcrPages=orderedOcrPages(contractOcrPages,contractPendingImages);
     const text=combinedOcrText(contractOcrPages,contractPendingImages);
     if(!text.trim()){contractImportError='OCR read no text from these pictures. Try clearer, well-lit photos with the text upright, or paste the contract text instead. Nothing was saved.';contractPreview=null;contractPendingImages=[];contractOcrPages=[];render();return}
     if(!reparseContractOcrPages()){contractImportError='OCR read text, but deterministic parsing found no shifts in it (no date + shift pattern on the same line). Fix the photos or paste the contract text instead. Nothing was saved.';contractPreview=null;contractPendingImages=[];contractOcrPages=[];render();return}
     render()}catch(err){contractOcrStatus='';contractPreview=null;contractPendingImages=[];contractOcrPages=[];contractImportError=(anyHeic?'Could not read this picture: '+err.message+' HEIC pictures cannot always be decoded in a browser — export it as JPG or PNG and try again. ':'Could not read these pictures: '+err.message+' Try clearer photos, or paste the contract text instead. ')+'Nothing was saved.';render()}
   return}
}
async function importContract(e){e.preventDefault();contractImportError='';contractPendingImages=[];contractOcrPages=[];contractOcrStatus='';const files=$('f_contractFile')?Array.from($('f_contractFile').files||[]):[];const f=files[0]||null;
 const name=f?f.name:'';const ext=name?('.'+name.split('.').pop().toLowerCase()):'';const mime=f?f.type:'';
 const imageFiles=files.filter(isImageFile);const anyHeic=imageFiles.some(x=>/\.heic$/i.test(x.name||''));
 if(imageFiles.length){
   // AI FIRST (recommended): photos go to vision AI. On-device OCR is
   // the explicit fallback button below — never the silent default.
   // If AI cannot run (not signed in / not configured), say so plainly
   // and stop: do NOT fall back to OCR silently.
   if(!SUPABASE_CONFIGURED||!cloudSession){contractImportError='AI reading (recommended) needs you signed in on the Account tab — sign in and submit again, or use “No connection? Try on-device reading” below. Nothing was sent, nothing was saved.';render();return}
   return readContractWithAI('contract');}

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
 // Double-booking guard (v115): records built first; a conflict
 // stops the approve BEFORE the contract record is saved.
 const builtContract=rows.map(r=>{const pay=String(r.pay||'').trim();return {row:r,pay,rec:{id:id(),date:r.date,facility:r.facility.trim(),type:r.type,pay,status:importStatusForDate(r.date),source:r.source||'extracted-from-contract',sources:[r.source||'extracted-from-contract'],contractId,incomplete:!pay,note:`Extracted from contract: ${contractPreview.fileName} — check carefully, a read can misread digits and dates.${pay?'':' Pay not yet priced — incomplete.'}`}}});
 const cGate=importGateCheck(contractPreview,builtContract.map(b=>b.rec));
 if(cGate.stopped){render();gateStopAlert();return}
 if(!existing){db.contracts=db.contracts||[];db.contracts.push({...contractPreview.contract,id:contractId,shiftCount:0})}
 const cAddSet=new Set([...cGate.clean,...cGate.dups,...(cGate.addAnyway||[]).map(c=>c.rec)]);const cLeftOut=(cGate.skippedConflicts||[]).length;
 let created=0,skipped=0,incomplete=0;
 for(const b of builtContract){if(!cAddSet.has(b.rec))continue;const res=addShiftDeduped(b.rec);if(res.merged){skipped++;continue}if(!b.pay)incomplete++;created++}
 const c=(db.contracts||[]).find(x=>x.id===contractId);if(c){c.shiftCount=(db.shifts||[]).filter(x=>x.contractId===contractId).length;
   if(contractPreview.isPhoto&&contractPendingImages.length){try{for(let i=0;i<contractPendingImages.length;i++)await saveContractImage(contractId,contractPendingImages[i],i,contractPendingImages.length);c.imageFileName=contractPreview.imageFileName||contractPendingImages[0].name;c.imageFileNames=contractPendingImages.map(x=>x.name);c.imageStored='indexeddb';c.imageStorageNote='on-device only — cloud document storage not enabled yet'}catch(err){c.imageFileName=contractPreview.imageFileName||contractPendingImages[0].name;c.imageFileNames=contractPendingImages.map(x=>x.name);c.imageStored='failed';c.imageStorageNote='picture could not be stored on this device: '+err.message}}}
 acknowledgeImportConflicts(cGate);const paySchedSaved=applyImportPaySched(contractPreview,'contract');contractPreview=null;contractPendingImages=[];contractOcrPages=[];contractOcrStatus='';persist();render();alert(`Approved: ${created} shift(s) created${incomplete?` (${incomplete} incomplete — pay not yet priced)`:''}${skipped?`; ${skipped} duplicate(s) merged into existing shifts`:''}${cLeftOut?`; left out ${cLeftOut} shift(s) that would double-book you — tick "Add it anyway" in the preview if you really have both`:''}. Contract record saved and linked to the new shifts.${paySchedSaved?` Pay schedule saved for ${paySchedSaved.agency} — paychecks for these shifts now show on your calendar.`:''}`)}
// --- Facilities from a contract: upload, preview, approve ---
// Same text/PDF/OCR extraction as the shift contract import, but for
// rates only: a document with no shift dates still works here, because
// a facility's pay rule does not need dates. Nothing is saved until
// the user approves the preview.
// --- Cropped re-read actions (Facilities) ---
// Runs OCR on a vertical slice of a photo instead of the whole page.
// See ocrCropRegion/cropImageForOcr above for why whole-page passes
// stopped working on this addendum. Progress reuses the existing OCR
// status line; results merge into the preview, never straight to save.
async function rereadFacilityPageCropped(pageIndex){
  const img=facilityContractPendingImages[pageIndex];
  const pg=facilityContractOcrPages.find(p=>p.file===img);
  if(!img||!pg)return;
  const region=cropRegionByPage['facility:'+pageIndex]||'bottom';
  const label=ocrCropLabel(region);
  facilityContractOcrStatus='Re-reading page '+(pageIndex+1)+' cropped ('+label+') on this device with OCR — no picture is sent to a server. This can take a few seconds…';
  facilityContractCropNote='';facilityContractError='';
  render();
  try{
    const best=await ocrCropForFile(img,region,m=>{const el=document.getElementById('facilityContractOcrStatus');if(el&&m&&m.status)el.textContent='Re-reading page '+(pageIndex+1)+' cropped ('+label+') on this device with OCR… '+m.status});
    if(!best){facilityContractOcrStatus='';facilityContractError='Could not crop this photo in this browser — try a closer photo of the rates table instead. Nothing was saved.';render();return}
    pg.cropText=best.text;pg.cropRegion=region;pg.cropRegionLabel=label;pg.cropPass=best.pass;
    facilityContractOcrStatus='';
    if(!reparseFacilityContractOcrPages()){facilityContractError='The cropped re-read found no facility name or rate. Nothing was saved.';facilityContractPreview=null;render();return}
    facilityContractCropNote=cropRereadNote(facilityContractLastCropAdded,combinedCropText(facilityContractOcrPages,facilityContractPendingImages));
    render();
  }catch(err){facilityContractOcrStatus='';facilityContractError='Cropped re-read failed: '+err.message+' Nothing was saved.';render()}
}
async function rereadFacilityRatesTable(){
  if(!facilityContractPendingImages.length||!facilityContractOcrPages.length)return;
  facilityContractOcrStatus='Re-reading the rates table (bottom half of each photo) on this device with OCR — no picture is sent to a server. This can take a few seconds per page…';
  facilityContractCropNote='';facilityContractError='';
  render();
  let done=0;
  for(let i=0;i<facilityContractPendingImages.length;i++){
    const img=facilityContractPendingImages[i];
    const pg=facilityContractOcrPages.find(p=>p.file===img);
    if(!pg)continue;
    facilityContractOcrStatus='Re-reading the rates table — page '+(i+1)+' of '+facilityContractPendingImages.length+' (bottom half) on this device with OCR…';
    const el0=document.getElementById('facilityContractOcrStatus');if(el0)el0.textContent=facilityContractOcrStatus;
    try{
      const best=await ocrCropForFile(img,'bottom-half',m=>{const el=document.getElementById('facilityContractOcrStatus');if(el&&m&&m.status)el.textContent='Re-reading the rates table — page '+(i+1)+' of '+facilityContractPendingImages.length+' (bottom half) on this device with OCR… '+m.status});
      if(!best)continue;
      pg.cropText=best.text;pg.cropRegion='bottom-half';pg.cropRegionLabel='bottom half';pg.cropPass=best.pass;done++;
    }catch(e){continue}
  }
  facilityContractOcrStatus='';
  if(!done){facilityContractError='The cropped re-read could not read any page — try a closer photo of the rates table, or type the values in. Nothing was saved.';render();return}
  if(!reparseFacilityContractOcrPages()){facilityContractError='The cropped re-read found no facility name or rate. Nothing was saved.';facilityContractPreview=null;render();return}
  facilityContractCropNote=cropRereadNote(facilityContractLastCropAdded,combinedCropText(facilityContractOcrPages,facilityContractPendingImages));
  render();
}
function cropRereadNote(added,cropText){
  if(added&&added.length)return 'Cropped re-read found: '+added.join(', ')+'. Check the values below — nothing is saved yet.';
  const n=Object.values(contractExtractRates(String(cropText||''))).filter(v=>v!=null).length;
  if(n)return 'Cropped re-read read '+n+' rate(s), but they were already in the preview — no new rates.';
  return 'Cropped re-read could not read any rates from the cropped area — try a closer photo of the rates table, or type the values in.';
}
async function rereadContractPageCropped(pageIndex){
  const img=contractPendingImages[pageIndex];
  const pg=contractOcrPages.find(p=>p.file===img);
  if(!img||!pg)return;
  const region=cropRegionByPage['contract:'+pageIndex]||'bottom';
  const label=ocrCropLabel(region);
  contractOcrStatus='Re-reading page '+(pageIndex+1)+' cropped ('+label+') on this device with OCR — no picture is sent to a server. This can take a few seconds…';
  contractImportError='';
  render();
  try{
    const best=await ocrCropForFile(img,region,m=>{const el=document.getElementById('contractOcrStatus');if(el&&m&&m.status)el.textContent='Re-reading page '+(pageIndex+1)+' cropped ('+label+') on this device with OCR… '+m.status});
    if(!best){contractOcrStatus='';contractImportError='Could not crop this photo in this browser — try a closer photo instead. Nothing was saved.';render();return}
    pg.cropText=best.text;pg.cropRegion=region;pg.cropRegionLabel=label;pg.cropPass=best.pass;
    contractOcrStatus='';
    if(!reparseContractOcrPages()){contractImportError='The cropped re-read found no shifts by deterministic parsing. Nothing was saved.';contractPreview=null;render();return}
    render();
  }catch(err){contractOcrStatus='';contractImportError='Cropped re-read failed: '+err.message+' Nothing was saved.';render()}
}

// --- On-device contract-picture OCR (automatic fallback, facility) ---
// Runs only as the automatic fallback when the AI read cannot run or
// fails — never a button the user picks. The fallback is announced on
// the preview via facilityContractFallbackNote, never silent. Same
// preview-before-save flow as AI reading.
async function importFacilityContractWithOCR(e){if(e)e.preventDefault();const fbNote=facilityContractFallbackNote;facilityContractFallbackNote='';const priorImages=facilityContractPendingImages;facilityContractError='';facilityContractPendingImages=[];facilityContractOcrPages=[];facilityContractOcrStatus='';const domFiles=$('f_facilityContractFile')?Array.from($('f_facilityContractFile').files||[]):[];const files=domFiles.length?domFiles:priorImages;const imageFiles=files.filter(isImageFile);const anyHeic=imageFiles.some(x=>/\.heic$/i.test(x.name||''));if(!imageFiles.length){facilityContractError='Choose contract photos first. Nothing was read, nothing was saved.';render();return}
if(imageFiles.length){
   facilityContractPendingImages=imageFiles;facilityContractOcrStatus='Reading picture 1 of '+imageFiles.length+' — this can take a few seconds per page…';facilityContractPreview=null;render();
   try{
     for(let i=0;i<imageFiles.length;i++){const img=imageFiles[i];facilityContractOcrStatus='Reading picture '+(i+1)+' of '+imageFiles.length+' ('+img.name+') on this device with OCR…';const el0=document.getElementById('facilityContractOcrStatus');if(el0)el0.textContent=facilityContractOcrStatus;
       let t='',ocrPass='default';try{const best=await ocrBestPassForFile(img,m=>{const el=document.getElementById('facilityContractOcrStatus');if(el&&m&&m.status)el.textContent=`Reading picture ${i+1} of ${imageFiles.length} (${img.name}) on this device with OCR… ${m.status}${m.progress!=null?' '+Math.round(m.progress*100)+'%':''}`});t=best.text;ocrPass=best.pass;facilityContractOcrPages.push({file:img,name:img.name,text:t,status:t.trim().length?'ok':'empty',ocrPass})}catch(pageErr){facilityContractOcrPages.push({file:img,name:img.name,text:'',status:'failed',error:String(pageErr&&pageErr.message||pageErr)})}}
     facilityContractOcrStatus='';facilityContractOcrPages=orderedOcrPages(facilityContractOcrPages,facilityContractPendingImages);
     const text=combinedOcrText(facilityContractOcrPages,facilityContractPendingImages);
     if(!text.trim()){facilityContractError='OCR read no text from these pictures. Try clearer, well-lit photos with the text upright, or paste the contract text instead. Nothing was saved.';facilityContractPreview=null;facilityContractPendingImages=[];facilityContractOcrPages=[];render();return}
     if(!reparseFacilityContractOcrPages()){facilityContractError='OCR read text, but no facility name or rate was found in it. Check the photos, or enter the rates manually below. Nothing was saved.';facilityContractPreview=null;facilityContractPendingImages=[];facilityContractOcrPages=[];render();return}
     if(fbNote)facilityContractOcrStatus=fbNote;render()}catch(err){facilityContractOcrStatus='';facilityContractPreview=null;facilityContractPendingImages=[];facilityContractOcrPages=[];facilityContractError=(anyHeic?'Could not read this picture: '+err.message+' HEIC pictures cannot always be decoded in a browser — export it as JPG or PNG and try again. ':'Could not read these pictures: '+err.message+' Try clearer photos, or paste the contract text instead. ')+'Nothing was saved.';render()}
   return}
}
async function importFacilityContract(e){e.preventDefault();facilityContractError='';facilityContractFallbackNote='';facilityContractCropNote='';facilityContractLastCropAdded=[];facilityContractPendingImages=[];facilityContractOcrPages=[];facilityContractOcrStatus='';const files=$('f_facilityContractFile')?Array.from($('f_facilityContractFile').files||[]):[];const f=files[0]||null;
 const name=f?f.name:'';const ext=name?('.'+name.split('.').pop().toLowerCase()):'';const mime=f?f.type:'';
 const imageFiles=files.filter(isImageFile);const anyHeic=imageFiles.some(x=>/\.heic$/i.test(x.name||''));
 if(imageFiles.length){
   // One action: photos are read with AI automatically. If AI cannot
   // run (signed out / not configured), the on-device read takes over
   // automatically and the preview says so — the user never picks a
   // reading method.
   if(!SUPABASE_CONFIGURED||!cloudSession){facilityContractFallbackNote='AI reading needs sign-in, so this was read on your device instead — check the rates carefully.';return importFacilityContractWithOCR()}
   return readContractWithAI('facility');}

 try{let text='',fileName=name||'pasted text';
   if(f){if(ext==='.pdf'){text=await extractPdfText(f)}else{text=await f.text()}}
   else{text=$('f_facilityContractText')?$('f_facilityContractText').value:''}
   if(!text.trim()){facilityContractError='Nothing to read: choose a contract file or paste contract text first. Nothing was saved.';facilityContractPreview=null;render();return}
   let p;
   if(ext==='.ics'||/^BEGIN:VCALENDAR/i.test(text.trim())){const ic=parseICS(text,fileName);p={contract:ic.contract,facilities:[{name:ic.contract.facility||'',aliases:'',address:'',rates:{},effectiveStart:ic.contract.effectiveStart||'',effectiveEnd:ic.contract.effectiveEnd||'',include:true,found:[],missing:[]}],shiftCount:ic.rows.length,isPhoto:false,fileName};
     const r=ic.contract.rates||{};const map={hourly:'hourlyRate',paidHours8:'paidHours8',rate8:'rate8',rate10:'rate10',rate12:'rate12',rate24:'rate24',hourlyCall1st:'hourlyCall1st',rateSecond:'rateSecond',callBonus:'callBonus',weekendRate24:'weekendRate24',weekendRateSecond:'weekendRateSecond'};
     for(const [k,v] of Object.entries(r))if(map[k]&&rateOrNull(v)!=null)p.facilities[0].rates[map[k]]=String(rateOrNull(v));
     p.facilities[0].found=FACILITY_RATE_KEYS.filter(k=>p.facilities[0].rates[k]!=null).map(k=>FACILITY_RATE_LABELS[k]+' '+currency(Number(p.facilities[0].rates[k])));p.facilities[0].missing=FACILITY_RATE_KEYS.filter(k=>p.facilities[0].rates[k]==null).map(k=>FACILITY_RATE_LABELS[k]);
   }else{p=parseFacilityContract(text,fileName);p.fileName=fileName}
   if(!p.facilities.some(x=>String(x.name||'').trim())&&!p.facilities.some(x=>Object.values(x.rates||{}).some(v=>v!=null&&v!==''))){facilityContractError='No facility name or rate was found in this document. Check the file, or enter the rates manually below. Nothing was saved.';facilityContractPreview=null;render();return}
   facilityContractPreview=p;facilityContractConfirmCreate=false;render()}catch(err){facilityContractError='Could not read this file: '+err.message+' Nothing was saved.';facilityContractPreview=null;render()}}
async function approveFacilityContract(){
 if(!facilityContractPreview)return;
 const entries=facilityContractPreview.facilities.filter(f=>f.include);
 const unnamed=entries.filter(f=>!String(f.name||'').trim());
 if(unnamed.length){alert('Enter a facility name for every facility you want to save — the contract did not state one. Uncheck it, or type its name in the preview.');return}
 // Words-box parses join the save even when the user never
 // tapped the box's own confirm (Nov 11, 2026, v123): the words
 // ARE this preview's rate input, so staging them here — before
 // any record is built from f.rates — makes it structurally
 // impossible for Save to discard typed rules (the v110 lesson).
 for(const f of entries)stageFacPreviewDescribe(facilityContractPreview.facilities.indexOf(f));
 // A name that matches no saved facility CREATES a new one. That is
 // the contract path's one moment a facility mapping is decided
 // silently — so it never happens silently: the first save attempt
 // stops, and the preview asks the user to confirm creating it (or
 // fix the name / add an alias so it updates a saved facility
 // instead). Approving from that confirmation proceeds. Resolution
 // checks the preview entry's own name AND its aliases field — the
 // same resolution the save loop below applies when it merges.
 const resolvesSaved=f=>facilityByNameOrAlias(String(f.name).trim())||String(f.aliases||'').split(',').map(a=>facilityByNameOrAlias(a.trim())).find(Boolean);
 const creating=entries.filter(f=>!resolvesSaved(f));
 if(creating.length&&!facilityContractConfirmCreate){facilityContractConfirmCreate=true;render();return}
 const today=localDate(new Date());
 // Suggestion-born saves (Nov 11, 2026, v121): an entry whose name
 // matches a hospital a sync is holding shifts for — remember it so
 // the save below closes the loop with an automatic re-check.
 const sgMatch=entries.map(f=>{const sg=(db.facilitySuggestions||[]).find(x=>!x.dismissed&&normFacilityName(x.name)===normFacilityName(String(f.name||'').trim()));return sg?{name:String(f.name).trim(),provider:sg.provider||'apple'}:null}).find(Boolean)||null;
 let contractId=facilityContractPreview.contract.id;
 const first=entries[0];
 const existingContract=(db.contracts||[]).find(c=>(c.facility||'').toLowerCase()===(first.name||'').toLowerCase()&&JSON.stringify(c.rates||{})===JSON.stringify(facilityContractPreview.contract.rates||{}));
 if(existingContract)contractId=existingContract.id;
 else{db.contracts=db.contracts||[];db.contracts.push({...facilityContractPreview.contract,id:contractId,facility:first.name,shiftCount:0})}
 let saved=0,updated=0,repriced=0;
 for(const f of entries){
   const name=String(f.name).trim();
   // Resolution mirrors the create-confirmation gate above: the
   // entry's name, the entry's own aliases (a contract for
   // "Charleston Area Medical Center" that lists CAMC updates CAMC —
   // its canonical name rides along as a new alias), or an exact
   // name match. Without the aliases leg, an entry the gate waved
   // through as "resolves" would silently create a duplicate.
   const existing=facilityByNameOrAlias(name)||String(f.aliases||'').split(',').map(a=>facilityByNameOrAlias(a.trim())).find(Boolean)||(db.facilities||[]).find(x=>String(x.name||'').trim().toLowerCase()===name.toLowerCase());
   const rec={name,aliases:String(f.aliases||'').trim(),address:String(f.address||'').trim(),ratesSource:'contract',ratesSourceFile:facilityContractPreview.fileName||'',ratesSourceDate:today,contractId,contractEffectiveStart:f.effectiveStart||'',contractEffectiveEnd:f.effectiveEnd||''};
   for(const k of [...RATE_FIELDS,'paidHours8']){const v=f.rates&&f.rates[k];rec[k]=rateOrNull(v)==null?'':String(rateOrNull(v))}
   let savedFac=null;
   if(existing){
     // Merge only: a blank rate in the preview never wipes a rate the
     // facility already has — the document simply did not state it.
     const merged={...existing};
     for(const [k,v] of Object.entries(rec)){if(k==='name'||k==='aliases'||k==='address'){if(String(v||'').trim())merged[k]=v;continue}if(k==='ratesSource'||k==='ratesSourceFile'||k==='ratesSourceDate'||k==='contractId'||k==='contractEffectiveStart'||k==='contractEffectiveEnd'){if(String(v||'').trim())merged[k]=v;continue}if(v!==''&&v!=null)merged[k]=v}
     if(String(f.aliases||'').trim()&&!String(existing.aliases||'').includes(String(f.aliases).trim()))merged.aliases=String(existing.aliases?existing.aliases+', '+f.aliases.trim():f.aliases.trim());
     if(String(f.address||'').trim()&&String(existing.address||'').trim()!==String(f.address).trim()){merged.address=f.address.trim();merged.lat='';merged.lng='';merged.geocodedAddress='';if(merged.distanceSource==='auto'){merged.distance='';merged.distanceSource=''}}
     if(facilityNameKey(existing.name)!==facilityNameKey(merged.name))addFacilityAlias(merged,existing.name);
     if(!facilityHasUsableRates(merged))merged.ratesPromptSkipped=true;const i=db.facilities.findIndex(x=>x.id===existing.id);db.facilities[i]=merged;updated++;
     savedFac=merged;
     repriced+=repriceUnpricedShiftsForFacility(merged);
   }else{
     const nf={...rec,id:id(),notes:''};if(!facilityHasUsableRates(nf))nf.ratesPromptSkipped=true;db.facilities.push(nf);saved++;
     savedFac=nf;
     repriced+=repriceUnpricedShiftsForFacility(nf);
   }
   // The words box's code definitions + weekend rule land on
   // the saved facility through the same save path the facility
   // card uses (Nov 11, 2026, v123) — stated rates were already
   // staged into f.rates above; this applies the definitions
   // and the weekend provenance.
   if(savedFac&&f.describedParsed){repriced+=applyDescribedRules(savedFac,f.describedParsed);try{if(typeof cloudSaveKind==='function')cloudSaveKind('facilities',savedFac.id)}catch(_){}}
 }
 const c=(db.contracts||[]).find(x=>x.id===contractId);
 if(c&&facilityContractPreview.isPhoto&&facilityContractPendingImages.length){try{await awaitSaveContractImage(c,facilityContractPendingImages,facilityContractPreview)}catch(err){c.imageFileName=facilityContractPreview.fileName||'';c.imageFileNames=facilityContractPendingImages.map(x=>x.name);c.imageStored='failed';c.imageStorageNote='picture could not be stored on this device: '+err.message}}
 const paySchedSaved=applyImportPaySched(facilityContractPreview,'faccontract');
 facilityContractPreview=null;facilityContractConfirmCreate=false;facilityContractPendingImages=[];facilityContractOcrPages=[];facilityContractOcrStatus='';facilityContractError='';persist();render();
 if(typeof window!=='undefined'&&typeof window.liveSyncSchedulePush==='function')window.liveSyncSchedulePush();
 alert(`Saved ${saved} new facilit${saved===1?'y':'ies'}${updated?`, updated ${updated} existing facilit${updated===1?'y':'ies'}`:''} from the contract${repriced?`. ${repriced} unpriced shift(s) priced from the new pay rule${repriced===1?'':''}`:''}. Rates are labelled “from contract” on the facilities list.${paySchedSaved?` Pay schedule saved for ${paySchedSaved.agency} — paychecks for its shifts now show on your calendar.`:''}`);
 if(sgMatch){clearFacilitySuggestion(sgMatch.name);if(typeof window!=='undefined'&&typeof window.liveSyncRescanAfterFacilitySave==='function')window.liveSyncRescanAfterFacilitySave(sgMatch.provider,sgMatch.name);}
}
async function awaitSaveContractImage(c,files,preview){const list=Array.isArray(files)?files:[files];for(let i=0;i<list.length;i++)await saveContractImage(c.id,list[i],i,list.length);c.imageFileName=preview.fileName||list[0].name;c.imageFileNames=list.map(x=>x.name);c.imageStored='indexeddb';c.imageStorageNote='on-device only — cloud document storage not enabled yet'}
// --- Supabase Auth + credential sync (fetch-based, no extra dependency) ---
// Reads/writes ONLY the five migration-001 tables, with user_id = auth uid.
// Row Level Security on those tables restricts every row to its owner.
// Shifts, facilities, and mileage are NOT synced in this release: they
// stay on-device, and the Account tab says so. Live NBCRNA / AANA / state
// portal pulls are NOT part of this section: they need a server-side Edge
// Function (next phase) and are never faked from the browser.
// Sync is automatic (Nov 6, 2026): there is no direction for the user
// to choose. On sign-in the cloud and on-device credential records
// MERGE — union of both sides, the newest edit of a shared record wins,
// and a record that exists on only one side is never deleted. A shared
// record whose two versions cannot be ordered keeps BOTH copies. The
// merged result is pushed back up, and per-edit background sync (plus
// a merge on every boot) takes it from there.
const SUPABASE_CFG = (typeof window !== 'undefined' && window.CRNHUB_SUPABASE) || {};
const SUPABASE_CONFIGURED = !!(SUPABASE_CFG.url && SUPABASE_CFG.anonKey && String(SUPABASE_CFG.anonKey).indexOf('PASTE') === -1);
let cloudSession = null, cloudActive = false, cloudOffline = false, cloudError = '', cloudLastSync = '', cloudSyncTimes = {}, cloudAuthStatus = '', cloudPortals = [];
// Sign-in / create-account split (v126, Nov 11, 2026): the signed-out
// Account form is TWO forms — sign-in (email + password only) and
// create (email + password + the step-1 profile fields). The profile
// questions belong to creating an account; sign-in never needed them,
// but stacked on one screen they read as required every time.
// cloudAuthMode picks which form renders; cloudAuthDraft carries the
// typed email/password across the switch (and across re-renders while
// signed out), captured in render() like the mileage form draft.
let cloudAuthMode = 'signin', cloudAuthDraft = { email: '', password: '' };
function captureCloudAuthDraft() { try { if (cloudSession) return; const em = $('f_email'), pw = $('f_password'); if (em) cloudAuthDraft.email = String(em.value || ''); if (pw) cloudAuthDraft.password = String(pw.value || ''); } catch (e) {} }
function cloudAuthResetForm() { cloudAuthMode = 'signin'; cloudAuthDraft = { email: '', password: '' }; }
try { cloudSession = JSON.parse(localStorage.getItem('crna-hub-supabase-session') || 'null'); cloudActive = localStorage.getItem('crna-hub-cloud-active') === '1'; cloudLastSync = localStorage.getItem('crna-hub-last-sync') || ''; } catch (e) {}
function cloudPersistSession() { try { if (cloudSession) localStorage.setItem('crna-hub-supabase-session', JSON.stringify(cloudSession)); else localStorage.removeItem('crna-hub-supabase-session'); localStorage.setItem('crna-hub-cloud-active', cloudActive ? '1' : '0'); if (cloudLastSync) localStorage.setItem('crna-hub-last-sync', cloudLastSync); } catch (e) {} }
function cloudMode() { if (!SUPABASE_CONFIGURED) return 'not-configured'; if (!cloudSession) return 'signed-out'; if (!cloudActive) return 'signed-out'; return cloudOffline ? 'cloud-offline' : 'cloud'; }
function cloudSyncEnabled() { return SUPABASE_CONFIGURED && !!cloudSession && cloudActive; }
function cloudHeaderLabel() { const m = cloudMode(); if (m === 'not-configured') return 'On this device · Not signed in'; if (m === 'signed-out') return cloudSession ? 'Signed in · Syncing automatically' : 'On this device · Not signed in'; if (m === 'cloud-offline') return 'Cloud (offline) · On-device copy'; return 'Cloud · ' + (cloudSession.email || 'signed in'); }
function cloudModeHint() { const m = cloudMode(); if (m === 'not-configured') return 'Everything here is saved on this device only.'; if (m === 'signed-out') return 'Not signed in, so everything here is saved on this device only.'; if (m === 'cloud-offline') return 'Cloud account is unreachable right now, so this is the on-device copy. Credential edits will retry on the next sync.'; return 'Signed in — everything syncs to your account: credentials, shifts, facilities, mileage, and pay schedules.'; }
function cloudAssistantAnswer() { if (!SUPABASE_CONFIGURED) return 'You are not signed in, so everything is saved on this device only. Use the Account tab to download a JSON backup before changing phones or clearing browser data.'; if (!cloudSession) return 'You are not signed in, so data lives in this browser only (localStorage). Sign in on the Account tab to sync your records — credentials, shifts, facilities, mileage, and pay schedules — to your account. Use the Account tab to download a JSON backup before changing phones or clearing browser data.'; if (!cloudActive) return 'You are signed in, and your records are merging with your account automatically — newest edit wins, and nothing is overwritten or deleted. Once the merge finishes, edits sync in the background.'; return 'You are signed in and your records sync to your account — NBCRNA, AANA, licenses, CE records, shifts, facilities, mileage, pay schedules, and settings. Portal pulls run from the Credentials tab — NBCRNA by public lookup, AANA by one-time sign-in, state boards where automation is allowed (WV and Ohio block it). The Assistant tab can also check a portal for you: you sign in yourself, show it the record page, and confirm what it saves — it never stores a portal password. Records a pull brings back are labelled with their source; the rest are user-entered, not verified.'; }
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

function cloudStoreSession(data) { if (!data || !data.access_token) return false; cloudSession = { access_token: data.access_token, refresh_token: data.refresh_token || (cloudSession && cloudSession.refresh_token), expires_at: Math.floor(Date.now() / 1000) + (data.expires_in || 3600), email: (data.user && data.user.email) || (cloudSession && cloudSession.email) || '', user_id: (data.user && data.user.id) || (cloudSession && cloudSession.user_id) || '' }; const meta = (data && data.user && data.user.user_metadata) || {}; // Profile fields live in Auth user_metadata (same pattern as
  // schedule_name): on sign-in they fill local settings ONLY where the
  // device has nothing yet, so a value set on this device is never
  // clobbered by an older server copy.
  if (meta.schedule_name && !(db.settings && db.settings.scheduleName)) { db.settings = db.settings || {}; db.settings.scheduleName = String(meta.schedule_name); persist(); } if (meta.employment_type && EMPLOYMENT_TYPES.includes(String(meta.employment_type)) && !(db.settings && db.settings.employmentType)) { db.settings = db.settings || {}; db.settings.employmentType = String(meta.employment_type); persist(); } if (typeof meta.monthly_income_goal === 'number' && Number.isFinite(meta.monthly_income_goal) && !(db.settings && db.settings.monthlyIncomeGoal)) { db.settings = db.settings || {}; db.settings.monthlyIncomeGoal = meta.monthly_income_goal > 0 ? meta.monthly_income_goal : 0; persist(); } cloudPersistSession(); return true; }
// Save the step 1 profile to the signed-in Supabase account (Auth
// user_metadata — the same store signup writes; no new table, no
// migration). Best-effort and silent: local settings are already saved by
// the caller, so a failed metadata write never blocks the app — it is
// recorded as a sync problem and retried on the next profile save.
async function cloudSaveProfile() { if (!SUPABASE_CONFIGURED || !cloudSession) return; try { await cloudUpdateUserMetadata(profileMetadata()); cloudOffline = false; cloudError = ''; cloudLastSync = cloudNow(); cloudPersistSession(); } catch (e) { cloudOffline = true; cloudError = e.message; } }
async function cloudUpdateUserMetadata(data) {
  await cloudEnsureToken();
  const body = { data: data || {} };
  // Same-origin proxy first (api/auth.js 'update-user' -> PUT
  // /auth/v1/user with the user's own token), direct PUT only when the
  // proxy is absent (404/501) — never after the proxy has answered, so
  // a profile save is never submitted twice.
  let pr = null;
  try { pr = await fetch('/api/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint: 'update-user', token: cloudSession.access_token, body: body }) }); } catch (e) { pr = null; }
  if (pr && pr.status !== 404 && pr.status !== 501) { const text = await pr.text(); let out = null; try { out = text ? JSON.parse(text) : null; } catch (e) {} if (!pr.ok) throw new Error((out && (out.error_description || out.msg || out.message || out.error)) || ('Profile save failed (' + pr.status + ')')); return out; }
  const r = await fetch(SUPABASE_CFG.url + '/auth/v1/user?apikey=' + encodeURIComponent(SUPABASE_CFG.anonKey), { method: 'PUT', headers: { apikey: SUPABASE_CFG.anonKey, Authorization: 'Bearer ' + cloudSession.access_token, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const text = await r.text(); let out = null; try { out = text ? JSON.parse(text) : null; } catch (e) {}
  if (!r.ok) throw new Error((out && (out.error_description || out.msg || out.message || out.error)) || ('Profile save failed (' + r.status + ')'));
  return out;
}
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
async function cloudFetchAll() { const uid = cloudUid(), q = '?select=*&user_id=eq.' + encodeURIComponent(uid); const nb = await sbReq('/rest/v1/nbcrna_profiles' + q, 'GET'); const aa = await sbReq('/rest/v1/aana_memberships' + q, 'GET'); const lic = await sbReq('/rest/v1/licenses' + q, 'GET'); const ce = await sbReq('/rest/v1/ce_records' + q, 'GET'); const portals = await sbReq('/rest/v1/portal_connections' + q, 'GET'); let docs=[]; try { docs = await sbReq('/rest/v1/documents' + q, 'GET'); } catch (e) { docs = []; } const synced = { shifts: [], facilities: [], mileage: [], payStubs: [], vehicles: [], settings: null }; try { synced.shifts = ((await sbReq('/rest/v1/shifts' + q, 'GET')) || []).map(cloudRowToRecord).filter(Boolean); } catch (e) {} try { synced.facilities = ((await sbReq('/rest/v1/facilities' + q, 'GET')) || []).map(cloudRowToRecord).filter(Boolean); } catch (e) {} try { synced.mileage = ((await sbReq('/rest/v1/mileage_trips' + q, 'GET')) || []).map(cloudRowToRecord).filter(Boolean); } catch (e) {} try { synced.payStubs = ((await sbReq('/rest/v1/pay_stubs' + q, 'GET')) || []).map(cloudRowToRecord).filter(Boolean); } catch (e) {} try { synced.vehicles = ((await sbReq('/rest/v1/vehicles' + q, 'GET')) || []).map(cloudRowToRecord).filter(Boolean); } catch (e) {} try { const st = await sbReq('/rest/v1/user_settings' + q, 'GET'); if (st && st[0] && st[0].data && typeof st[0].data === 'object') { synced.settings = st[0].data; const su = cloudRowUpdatedAt(st[0]); if (su && !synced.settings.updatedAt) synced.settings.updatedAt = su; } } catch (e) {} return { nbcrna: (nb && nb[0]) || null, aana: (aa && aa[0]) || null, licenses: lic || [], ce: ce || [], portals: portals || [], documents: docs || [], shifts: synced.shifts, facilities: synced.facilities, mileage: synced.mileage, payStubs: synced.payStubs, vehicles: synced.vehicles, settings: synced.settings }; }
function cloudLocalHasNbcrna() { const n = db.nbcrna || {}; return !!(n.status || n.number || n.periodStart || n.periodEnd || n.renewalDeadline); }
function cloudLocalHasAana() { const a = db.aana || {}; return !!(a.status || a.number || a.expiration); }
function cloudLocalHasRecords() { return cloudLocalHasNbcrna() || cloudLocalHasAana() || (db.licenses || []).length > 0 || (db.nbcrnaCE || []).length > 0 || (db.aanaCE || []).length > 0; }
function cloudNumOrNull(v) { if (v === '' || v === null || v === undefined) return null; const n = Number(v); return Number.isFinite(n) ? n : null; }
function cloudNow() { return new Date().toISOString(); }
function cloudNbcrnaRow() { const n = db.nbcrna || {}; return { user_id: cloudUid(), certification_status: n.status || null, certification_number: n.number || null, period_start: n.periodStart || null, period_end: n.periodEnd || null, renewal_deadline: n.renewalDeadline || null, class_a_credits: cloudNumOrNull(n.classA), class_b_credits: cloudNumOrNull(n.classB), mac_ed_credits: cloudNumOrNull(n.macEd), mac_dev_credits: cloudNumOrNull(n.macDev), mac_ed_required: cloudNumOrNull(n.macEdRequired) || 60, mac_dev_required: cloudNumOrNull(n.macDevRequired) || 40, cpc_check_in_status: n.checkStatus || null, source: n.source || 'user_entered', last_synced_at: cloudNow() }; }
function cloudAanaRow() { const a = db.aana || {}; return { user_id: cloudUid(), membership_status: a.status || null, membership_number: a.number || null, expiration: a.expiration || null, source: a.source || 'user_entered', last_synced_at: cloudNow() }; }
function cloudLicenseRow(x) { return { id: x.id, user_id: cloudUid(), state: x.state, license_type: x.type, license_number: x.number || null, issue_date: x.issue || null, expiration_date: x.expiry || null, status: x.status || null, board_portal_url: x.portal || null, notes: x.note || null, source: x.source || 'user_entered', last_synced_at: cloudNow() }; }
function cloudCeRow(x, source) { return { id: x.id, user_id: cloudUid(), source: source, title: x.title || null, credits: cloudNumOrNull(x.credits) || 0, credit_class: source === 'nbcrna' ? (x.class || null) : null, completed_date: x.date || null }; }
async function cloudUpsertPortals() { const states = []; (db.licenses || []).forEach(x => { if (x.state && states.indexOf(x.state) === -1) states.push(x.state); }); const desired = [{ portal: 'nbcrna', state: null }, { portal: 'aana', state: null }].concat(states.map(st => ({ portal: 'state_board', state: st }))); let existing = []; try { existing = await sbReq('/rest/v1/portal_connections?select=*&user_id=eq.' + encodeURIComponent(cloudUid()), 'GET'); } catch (e) { existing = []; } // Only create rows that do not exist yet, as 'not_connected' —
// NEVER overwrite an existing row's status: a portal that a live pull
// marked 'connected' (or a failed attempt marked 'failed') must not be
// reset to 'connected' by a manual upload, or vice versa.
const missing = desired.filter(d => !(existing || []).some(e => e.portal === d.portal && (e.state || null) === (d.state || null))); if (missing.length) { const rows = missing.map(d => ({ id: id(), user_id: cloudUid(), portal: d.portal, state: d.state, status: 'not_connected', last_synced_at: null, last_error: null })); await sbReq('/rest/v1/portal_connections', 'POST', rows); } }
async function cloudUploadLocal(opts) { const silent = !!(opts && opts.silent); if (!cloudSession) return false; try { const rows = []; if (cloudLocalHasNbcrna()) rows.push(sbReq('/rest/v1/nbcrna_profiles', 'POST', cloudNbcrnaRow())); if (cloudLocalHasAana()) rows.push(sbReq('/rest/v1/aana_memberships', 'POST', cloudAanaRow())); if ((db.licenses || []).length) rows.push(sbReq('/rest/v1/licenses', 'POST', (db.licenses || []).map(cloudLicenseRow))); const ceRows = (db.nbcrnaCE || []).map(x => cloudCeRow(x, 'nbcrna')).concat((db.aanaCE || []).map(x => cloudCeRow(x, 'aana'))); if ((db.documents || []).length) rows.push(sbReq('/rest/v1/documents', 'POST', (db.documents || []).map(cloudDocumentRow))); if (ceRows.length) rows.push(sbReq('/rest/v1/ce_records', 'POST', ceRows)); await Promise.all(rows); await cloudUpsertPortals(); await cloudUploadSynced(); cloudActive = true; cloudOffline = false; cloudError = ''; cloudLastSync = cloudNow(); cloudPersistSession(); render(); if (!silent) alert('On-device records uploaded to your cloud account.'); return true; } catch (e) { cloudOffline = true; cloudError = e.message; render(); if (!silent) alert('Upload failed: ' + e.message); return false; } }
// --- Full cloud sync: shifts, facilities, mileage, pay stubs, settings
// (Nov 6, 2026) -------------------------------------------------------
// Migrations 007–009 created the typed per-user tables (shifts,
// facilities, mileage_trips) and 010 added a `data` jsonb payload
// column to each, plus pay_stubs and user_settings. The typed columns
// are populated best-effort (queries, reporting, calendar joins), but
// `data` carries the COMPLETE client record and is authoritative on
// the way down: the client records are camelCase and stringly typed,
// with fields no typed column has (a shift's contractId, a trip's
// dismissedAt), and a data-safety sync must round-trip a record
// exactly — never a best-effort subset of it.
// Merge discipline matches the credential merge — union of both sides,
// newest edit wins, a record on only one side is NEVER deleted by
// sync — with ONE deliberate difference: an un-orderable conflict
// keeps the LOCAL copy instead of keeping both under a fresh id.
// Shift ids are the calendar pairing key (calendar_sync_map pairs
// shift id -> provider event id server-side), so sync must never mint
// a new id for a record that already has one. The local copy is the
// one in hand and pushes back up, so nothing is lost either way.
// Deletes are the one exception to "never deleted", and they travel
// only as tombstones: a delete is recorded locally the moment it
// happens and replayed against the cloud until the DELETE lands, so
// a record deleted while offline cannot resurrect on the next sync.
function cloudPosOrNull(v) { const n = cloudNumOrNull(v); return n !== null && n > 0 ? n : null; }
function cloudDateOrNull(v) { const s = String(v || '').slice(0, 10); return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null; }
function cloudRecordCopy(x) { try { return JSON.parse(JSON.stringify(x)); } catch (e) { return Object.assign({}, x); } }
function cloudStampRecord(x) { if (!x.updatedAt || isNaN(Date.parse(x.updatedAt))) x.updatedAt = cloudNow(); return x.updatedAt; }
function cloudRowUpdatedAt(r) { try { return r && r.updated_at ? new Date(r.updated_at).toISOString() : ''; } catch (e) { return ''; } }
function cloudRowToRecord(r) { if (!r || typeof r !== 'object' || !r.data || typeof r.data !== 'object') return null; const rec = cloudRecordCopy(r.data); if (!rec || !rec.id) return null; rec.updatedAt = cloudRowUpdatedAt(r) || rec.updatedAt || ''; return rec; }
function cloudShiftRow(x) { const d = cloudDateOrNull(x.date); if (!d || !x.id) return null; return { id: x.id, user_id: cloudUid(), date: d, facility: String(x.facility || ''), type: String(x.type || ''), status: normalizeShiftStatus(x.status), pay: cloudPosOrNull(x.pay), incomplete: !!x.incomplete, note: x.note || null, source: x.source || null, data: cloudRecordCopy(x), updated_at: cloudStampRecord(x) }; }
function cloudFacilityRow(x) { if (!x.id || !String(x.name || '').trim()) return null; return { id: x.id, user_id: cloudUid(), name: String(x.name), aliases: x.aliases || null, address: x.address || null, lat: cloudNumOrNull(x.lat), lng: cloudNumOrNull(x.lng), geocoded_address: x.geocodedAddress || null, hourly_rate: cloudPosOrNull(x.hourlyRate), paid_hours_8: cloudPosOrNull(x.paidHours8), rate_8: cloudPosOrNull(x.rate8), rate_10: cloudPosOrNull(x.rate10), rate_12: cloudPosOrNull(x.rate12), rate_24: cloudPosOrNull(x.rate24), rate_second: cloudPosOrNull(x.rateSecond), weekend_rate_second: cloudPosOrNull(x.weekendRateSecond), call_bonus: cloudPosOrNull(x.callBonus), hourly_call_1st: cloudPosOrNull(x.hourlyCall1st), weekend_rate_24: cloudPosOrNull(x.weekendRate24), distance: cloudPosOrNull(x.distance), distance_source: (x.distanceSource === 'manual' || x.distanceSource === 'auto') ? x.distanceSource : null, rates_source: x.ratesSource || null, rates_source_file: x.ratesSourceFile || null, rates_source_date: x.ratesSourceDate || null, notes: x.notes || null, data: cloudRecordCopy(x), updated_at: cloudStampRecord(x) }; }
function cloudMileageRow(x) { const d = cloudDateOrNull(x.date); if (!d || !x.id) return null; return { id: x.id, user_id: cloudUid(), date: d, facility: x.facility || null, purpose: String(x.purpose || '').trim() || 'Work travel', miles: cloudPosOrNull(x.miles), one_way_miles: cloudPosOrNull(x.oneWayMiles), trip_type: x.tripType === 'one-way' ? 'one-way' : 'round-trip', miles_source: x.milesSource || null, origin: (x.origin === 'hotel' || x.origin === 'other') ? x.origin : 'home', hotel_address: x.hotelAddress || null, status: ['draft', 'verified', 'skipped', 'dismissed'].includes(x.status) ? x.status : 'draft', data: cloudRecordCopy(x), updated_at: cloudStampRecord(x) }; }
function cloudPayStubRow(x) { if (!x.id || !String(x.agency || '').trim()) return null; return { id: x.id, user_id: cloudUid(), agency: String(x.agency), pay_date: cloudDateOrNull(x.payDate), data: cloudRecordCopy(x), updated_at: cloudStampRecord(x) }; }
function cloudVehicleRow(x) { if (!x.id || !String(x.name || '').trim()) return null; return { id: x.id, user_id: cloudUid(), name: String(x.name), data: cloudRecordCopy(x), updated_at: cloudStampRecord(x) }; }
const CLOUD_SYNCED_LISTS = [
  { kind: 'shifts', table: 'shifts', row: cloudShiftRow },
  { kind: 'facilities', table: 'facilities', row: cloudFacilityRow },
  { kind: 'mileage', table: 'mileage_trips', row: cloudMileageRow },
  { kind: 'payStubs', table: 'pay_stubs', row: cloudPayStubRow },
  { kind: 'vehicles', table: 'vehicles', row: cloudVehicleRow },
];
function cloudSyncedSpec(kind) { return CLOUD_SYNCED_LISTS.find(s => s.kind === kind) || null; }
let cloudTombstones = [];
try { const t = JSON.parse(localStorage.getItem('crna-hub-cloud-tombstones') || '[]'); if (Array.isArray(t)) cloudTombstones = t.filter(x => x && x.kind && x.id); } catch (e) {}
let cloudSettingsSnapshot = null;
try { cloudSettingsSnapshot = localStorage.getItem('crna-hub-settings-snapshot'); } catch (e) {}
function cloudTombstonesPersist() { try { localStorage.setItem('crna-hub-cloud-tombstones', JSON.stringify(cloudTombstones)); } catch (e) {} }
function cloudTombstoneIds(kind) { return new Set(cloudTombstones.filter(t => t.kind === kind).map(t => t.id)); }
function cloudRecordTombstone(kind, recId) { const spec = cloudSyncedSpec(kind); if (!spec || !recId) return; if (!cloudTombstones.some(t => t.kind === kind && t.id === recId)) { cloudTombstones.push({ kind: kind, id: recId, at: cloudNow() }); cloudTombstonesPersist(); } if (cloudSyncEnabled()) { sbReq('/rest/v1/' + spec.table + '?id=eq.' + encodeURIComponent(recId), 'DELETE').then(() => { cloudTombstones = cloudTombstones.filter(t => !(t.kind === kind && t.id === recId)); cloudTombstonesPersist(); }).catch(e => { cloudOffline = true; cloudError = e.message; }); } }
async function cloudReplayTombstones() { if (!cloudTombstones.length) return; const keep = []; for (const t of cloudTombstones) { const spec = cloudSyncedSpec(t.kind); if (!spec) continue; try { await sbReq('/rest/v1/' + spec.table + '?id=eq.' + encodeURIComponent(t.id), 'DELETE'); } catch (e) { keep.push(t); } } cloudTombstones = keep; cloudTombstonesPersist(); }
function cloudMergeSyncedList(localArr, cloudArr, kind) { const gone = cloudTombstoneIds(kind); const out = []; const seen = new Map(); (Array.isArray(localArr) ? localArr : []).forEach(x => { if (x && x.id && !gone.has(x.id)) { out.push(x); seen.set(x.id, x); } }); for (const c of (cloudArr || [])) { if (!c || !c.id || gone.has(c.id)) continue; const l = seen.get(c.id); if (!l) { out.push(c); seen.set(c.id, c); continue; } if (cloudRecContent(l) === cloudRecContent(c)) { out[out.indexOf(l)] = c; seen.set(c.id, c); continue; } const lt = cloudRecTs(l), ct = cloudRecTs(c); if (ct && (!lt || ct > lt)) { out[out.indexOf(l)] = c; seen.set(c.id, c); } } return out; }
function cloudSettingsContent(s) { const c = Object.assign({}, s || {}); delete c.updatedAt; return JSON.stringify(c); }
function cloudMergeSettings(localS, cloudS) { if (!cloudS || typeof cloudS !== 'object') return localS; const local = (localS && typeof localS === 'object') ? localS : {}; const lt = String(local.updatedAt || ''), ct = String(cloudS.updatedAt || ''); const cloudNewer = (!!ct && !!lt && ct > lt) || (!lt && !!ct); const merged = Object.assign({}, local); for (const k of Object.keys(cloudS)) { if (k === 'updatedAt') continue; const lv = local[k], cv = cloudS[k]; const lEmpty = lv === '' || lv === null || lv === undefined, cEmpty = cv === '' || cv === null || cv === undefined; if (cEmpty) continue; if (lEmpty || (cloudNewer && String(lv) !== String(cv))) merged[k] = cv; } merged.updatedAt = cloudNewer ? ct : (lt || ct || ''); return merged; }
async function cloudUploadSynced() { await cloudReplayTombstones(); const jobs = []; for (const spec of CLOUD_SYNCED_LISTS) { const rows = (db[spec.kind] || []).map(spec.row).filter(Boolean); if (rows.length) jobs.push(sbReq('/rest/v1/' + spec.table, 'POST', rows)); } const sContent = cloudSettingsContent(db.settings || {}); if (sContent !== cloudSettingsSnapshot) { db.settings = (db.settings && typeof db.settings === 'object') ? db.settings : {}; db.settings.updatedAt = cloudNow(); const payload = { user_id: cloudUid(), data: cloudRecordCopy(db.settings), updated_at: db.settings.updatedAt }; jobs.push(sbReq('/rest/v1/user_settings', 'POST', payload).then(() => { cloudSettingsSnapshot = sContent; try { localStorage.setItem('crna-hub-settings-snapshot', sContent); } catch (e) {} })); } await Promise.all(jobs); persist(); }
// --- Automatic merge (Nov 6, 2026) -------------------------------------
// Union of cloud + on-device, newest edit wins, nothing one-sided is
// ever deleted, and a shared record whose two versions cannot be
// ordered keeps BOTH copies (the cloud copy joins under a fresh id).
// Local edit time is the record's updatedAt stamp; the cloud copy's is
// its row's last_synced_at, mapped onto updatedAt when it is read down.
function cloudRecTs(x) { return String((x && (x.updatedAt || x.uploadedAt)) || ''); }
function cloudRecContent(x) { const c = Object.assign({}, x); delete c.updatedAt; return JSON.stringify(c); }
function cloudMergeList(localArr, cloudArr) { const out = (Array.isArray(localArr) ? localArr : []).slice(); const seen = new Map(); out.forEach(x => { if (x && x.id) seen.set(x.id, x); }); for (const c of (cloudArr || [])) { if (!c || !c.id) continue; const l = seen.get(c.id); if (!l) { out.push(c); seen.set(c.id, c); continue; } if (cloudRecContent(l) === cloudRecContent(c)) { out[out.indexOf(l)] = c; seen.set(c.id, c); continue; } const lt = cloudRecTs(l), ct = cloudRecTs(c); if (lt && ct && lt !== ct) { if (ct > lt) { out[out.indexOf(l)] = c; seen.set(c.id, c); } continue; } if (ct && !lt) { out[out.indexOf(l)] = c; seen.set(c.id, c); continue; } if (lt && !ct) continue; out.push(Object.assign({}, c, { id: id() })); } return out; }
// Singletons (NBCRNA / AANA) have one slot, so they merge field by
// field: a value present on only one side always survives; a value in
// conflict resolves by the same newest-edit rule, and an exact tie
// keeps the local value — it is the copy in hand, pushed back up next.
function cloudMergeSingleton(localObj, cloudObj, hasLocal, hasCloud) { if (!hasCloud) return localObj; if (!hasLocal) return cloudObj; const lt = cloudRecTs(localObj), ct = cloudRecTs(cloudObj); const cloudNewer = (!!lt && !!ct && ct > lt) || (!lt && !!ct); const merged = Object.assign({}, localObj); for (const k of Object.keys(cloudObj)) { if (k === 'updatedAt' || k === 'docNote' || k === 'ceNote' || k === 'reminders') continue; const lv = localObj[k], cv = cloudObj[k]; const lEmpty = lv === '' || lv === null || lv === undefined, cEmpty = cv === '' || cv === null || cv === undefined; if (cEmpty) continue; if (lEmpty || (cloudNewer && String(lv) !== String(cv))) merged[k] = cv; } merged.docNote = localObj.docNote || cloudObj.docNote || ''; merged.ceNote = localObj.ceNote || cloudObj.ceNote || ''; merged.reminders = localObj.reminders || cloudObj.reminders || '90,60,30,7'; merged.updatedAt = cloudNewer ? ct : (lt || ct || ''); return merged; }
function cloudApplyData(data) { cloudPortals = data.portals || []; if (data.nbcrna) { const r = data.nbcrna; const cm = { status: r.certification_status || '', number: r.certification_number || '', periodStart: r.period_start || '', periodEnd: r.period_end || '', renewalDeadline: r.renewal_deadline || r.period_end || '', source: r.source || 'user_entered', classA: r.class_a_credits === null || r.class_a_credits === undefined ? '' : String(r.class_a_credits), classB: r.class_b_credits === null || r.class_b_credits === undefined ? '' : String(r.class_b_credits), macEd: r.mac_ed_credits === null || r.mac_ed_credits === undefined ? '' : String(r.mac_ed_credits), macDev: r.mac_dev_credits === null || r.mac_dev_credits === undefined ? '' : String(r.mac_dev_credits), macEdRequired: r.mac_ed_required || 60, macDevRequired: r.mac_dev_required || 40, checkStatus: r.cpc_check_in_status || '', docNote: '', ceNote: '', reminders: '90,60,30,7', updatedAt: r.last_synced_at || '' }; db.nbcrna = cloudMergeSingleton(db.nbcrna || {}, cm, cloudLocalHasNbcrna(), true); cloudSyncTimes.nbcrna = r.last_synced_at || ''; } if (data.aana) { const r = data.aana; const cm = { status: r.membership_status || '', number: r.membership_number || '', expiration: r.expiration || '', source: r.source || 'user_entered', docNote: '', ceNote: '', reminders: '90,60,30,7', updatedAt: r.last_synced_at || '' }; db.aana = cloudMergeSingleton(db.aana || {}, cm, cloudLocalHasAana(), true); cloudSyncTimes.aana = r.last_synced_at || ''; } const licRem = {}; (db.licenses || []).forEach(x => { licRem[x.id] = x.reminders; }); const cloudLic = (data.licenses || []).map(r => ({ id: r.id, state: r.state, type: r.license_type, status: r.status || '', number: r.license_number || '', issue: r.issue_date || '', expiry: r.expiration_date || '', portal: r.board_portal_url || '', note: r.notes || '', source: r.source || 'user_entered', reminders: licRem[r.id] || '90,60,30,7', updatedAt: r.last_synced_at || '' })); db.licenses = cloudMergeList(db.licenses || [], cloudLic); if (cloudLic.length) cloudSyncTimes.licenses = cloudLic.map(x => x.updatedAt || '').sort().pop(); db.nbcrnaCE = cloudMergeList(db.nbcrnaCE || [], (data.ce || []).filter(r => r.source === 'nbcrna').map(r => ({ id: r.id, title: r.title || '', date: r.completed_date || '', credits: r.credits === null || r.credits === undefined ? '' : String(r.credits), class: r.credit_class || 'Class A', updatedAt: r.last_synced_at || '' }))); db.aanaCE = cloudMergeList(db.aanaCE || [], (data.ce || []).filter(r => r.source === 'aana').map(r => ({ id: r.id, title: r.title || '', date: r.completed_date || '', credits: r.credits === null || r.credits === undefined ? '' : String(r.credits), note: '', updatedAt: r.last_synced_at || '' }))); if (Array.isArray(data.documents)) { db.documents = cloudMergeList(db.documents || [], data.documents.map(r => ({ id: r.id, certType: r.cert_type || '', issue: r.issue_date || '', expiry: r.expiration_date || '', expirySource: r.expiry_source || 'user_entered', fileName: r.file_name || '', storagePath: r.storage_path || '', storageStatus: r.storage_path ? 'cloud' : 'local_details_only', uploadedAt: r.uploaded_at || '', updatedAt: r.uploaded_at || '' }))); }
if (Array.isArray(data.shifts)) db.shifts = cloudMergeSyncedList(db.shifts || [], data.shifts, 'shifts'); if (Array.isArray(data.facilities)) db.facilities = cloudMergeSyncedList(db.facilities || [], data.facilities, 'facilities'); if (Array.isArray(data.mileage)) db.mileage = cloudMergeSyncedList(db.mileage || [], data.mileage, 'mileage'); if (Array.isArray(data.payStubs)) db.payStubs = cloudMergeSyncedList(db.payStubs || [], data.payStubs, 'payStubs'); if (Array.isArray(data.vehicles)) db.vehicles = cloudMergeSyncedList(db.vehicles || [], data.vehicles, 'vehicles'); if (data.settings && typeof data.settings === 'object') { db.settings = cloudMergeSettings(db.settings || {}, data.settings); cloudSettingsSnapshot = cloudSettingsContent(db.settings); try { localStorage.setItem('crna-hub-settings-snapshot', cloudSettingsSnapshot); } catch (e) {} }
cloudActive = true; cloudOffline = false; cloudError = ''; cloudLastSync = cloudNow(); cloudPersistSession(); persist(); }
async function cloudAutoMerge() { if (!cloudSession) return false; try { const data = await cloudFetchAll(); cloudApplyData(data); healShiftsAfterChange((absorbedId) => { cloudRecordTombstone('shifts', absorbedId); }, (shellId, twin) => { cloudRecordTombstone('facilities', shellId); if (twin && twin.id) { try { cloudSaveKind('facilities', twin.id); } catch (e) {} } }); try { healUnpricedShiftPays(); } catch (e) {} render(); await cloudUploadLocal({ silent: true }); return true; } catch (e) { cloudOffline = true; cloudError = e.message; render(); return false; } }
async function cloudAfterSignIn() { cloudAuthResetForm(); await cloudAutoMerge(); render(); setTab('Account'); monitorBackgroundSweep(); qgendaBootCheck(); pushWatchSyncHealth(); }
async function submitCloudAuth(e) { e.preventDefault(); const fd = new FormData(e.currentTarget); const email = String(fd.get('email') || '').trim(), password = String(fd.get('password') || ''); const sn = String(fd.get('scheduleName') || '').trim(); const et = String(fd.get('employmentType') || '').trim(); const goalRaw = String(fd.get('incomeGoalStep1') || '').trim(); if (cloudAuthMode === 'create') { // The create form's submit IS the old Create account button: same
    // validation, same message, same cloudSignUp path with the profile.
    if (!email || !password) return alert('Enter an email and password first.'); cloudSignUp(email, password, sn, et, goalRaw === '' ? undefined : num(goalRaw)); return; } // Sign-in carries no profile fields since v126 (they live on the
  // create form) — the reads below come back blank, and a blank field
  // never wipes a saved value, so signing in leaves the profile alone.
  applyProfileValues({ name: sn, employmentType: et, monthlyIncomeGoal: goalRaw === '' ? undefined : num(goalRaw) }); if (!email || !password) { cloudAuthStatus = 'Enter an email and password.'; render(); return alert('Enter an email and password.'); } cloudAuthStatus = 'Signing in\u2026'; render(); try { const data = await sbAuthReq('/auth/v1/token?grant_type=password', { email: email, password: password }); if (!cloudStoreSession(data)) throw new Error('Sign-in succeeded but no session was returned. If email confirmation is required, confirm from your inbox, then sign in again.'); cloudAuthStatus = ''; await cloudAfterSignIn(); } catch (err) { let msg = err.message || ''; if (/email not confirmed/i.test(msg)) msg = 'Email not confirmed yet \u2014 check your inbox for the confirmation email, open its link, then sign in again.'; cloudAuthStatus = 'Sign-in failed: ' + msg; render(); alert('Sign-in failed: ' + msg); } }
async function cloudSignUp(email, password, scheduleNm, employment, monthlyGoal) { cloudAuthStatus = 'Creating account\u2026'; render(); // Profile fields save locally first, then ride along in the signup
  // user_metadata (profileMetadata) so the account is created with them.
  applyProfileValues({ name: scheduleNm || '', employmentType: employment || '', monthlyIncomeGoal: monthlyGoal }); try { const signupBody = { email: email, password: password, data: profileMetadata() }; const data = await sbAuthReq('/auth/v1/signup', signupBody); if (!cloudStoreSession(data)) { cloudAuthMode = 'signin'; cloudAuthStatus = 'Account created. If Supabase requires email confirmation, confirm from your inbox, then sign in.'; render(); alert('Account created. If Supabase requires email confirmation, confirm from your inbox, then sign in.'); return; } cloudAuthStatus = ''; await cloudAfterSignIn(); } catch (err) { let msg = err.message || ''; if (/email rate limit/i.test(msg)) msg = 'Too many confirmation emails were sent recently \u2014 wait a little while and try again, or sign in if the account was already created.'; cloudAuthStatus = 'Sign-up failed: ' + msg; render(); alert('Sign-up failed: ' + msg); } }
async function cloudSignOut() { try { if (cloudSession) await sbAuthReq('/auth/v1/logout', {}, { token: cloudSession.access_token }); } catch (e) {} cloudSession = null; cloudActive = false; cloudOffline = false; cloudError = ''; cloudAuthResetForm(); cloudPersistSession(); render(); }
// --- Sign out & clear this device (Nov 6, 2026) -----------------------
// Plain Sign out leaves the on-device copy in place by design, so the
// data is still on screen for whoever picks the phone up next. This
// second option is for showing the app to someone else: it signs out
// AND wipes every user-specific store on this device, leaving the app
// exactly as a new visitor sees it. The cloud account is NOT touched —
// nothing here deletes anything server-side (the only network call is
// the auth logout), so the credential records that live in the account
// merge back automatically on the next sign-in.
// HONEST LIMIT, stated in the confirmation itself: shifts, facilities,
// mileage, pay stubs, contracts, and other on-device-only records have
// no cloud copy, so before clearing, the same JSON backup the Backup
// button makes is downloaded — the clear stays recoverable through
// Restore instead of silently destroying the only copy.
function deviceBackupJSON() { return JSON.stringify({ ...db, _backupMeta: { mode: cloudMode(), account: cloudSession ? cloudSession.email : null, exportedAt: new Date().toISOString(), note: 'Cloud vs on-device mode at export time. Restore loads records onto this device only; it never overwrites the cloud account.' } }, null, 2); }
function deviceHasLocalOnlyData() { return ['shifts', 'facilities', 'mileage', 'payStubs', 'contracts', 'hotelStays', 'credentials', 'pto'].some(k => Array.isArray(db[k]) && db[k].length > 0); }
function resetDeviceLocalState() { cloudTombstones = []; cloudSettingsSnapshot = null;
  db = empty();
  try {
    localStorage.removeItem(KEY);
    localStorage.removeItem(OLD);
    localStorage.removeItem(PORTAL_CHECK_STORAGE);
    localStorage.removeItem('crna-hub-live-sync');
    localStorage.removeItem('crna-hub-cloud-tombstones');
    localStorage.removeItem('crna-hub-settings-snapshot');
    localStorage.removeItem('crna-hub-supabase-session');
    localStorage.removeItem('crna-hub-cloud-active');
    localStorage.removeItem('crna-hub-last-sync');
    localStorage.removeItem('crna-hub-push');
  } catch (e) {}
  // Stored contract pictures live in IndexedDB, outside localStorage.
  try { if (typeof indexedDB !== 'undefined' && indexedDB && typeof indexedDB.deleteDatabase === 'function') indexedDB.deleteDatabase('crna-hub-files'); } catch (e) {}
  // In-memory state back to first-run values, so nothing from the
  // signed-in session can surface after the clear: no import previews,
  // no portal-check or guided-flow state, no pending prompts.
  showShiftForm = false; dayViewOpen = false; editId = null; savedShiftsYear = null; facilitySuggestionPrefill = null;
  month = new Date(); month.setDate(1); selected = localDate(new Date());
  shiftDeleteConfirm = null;
  paystubPreview = null; paystubError = ''; paystubStatus = ''; paystubBusy = false; paystubPendingImages = [];
  assistantChatBusy = false; assistantChatLastLiveAt = 0;
  portalCheck = null; portalCheckError = ''; portalCheckOcrStatus = '';
  portalOpened = {}; portalLeaveSheet = '';
  pushServerCheck = { state: 'idle', subId: '', at: 0 }; pushStatusMsg = '';
  Object.keys(portalFlows).forEach(k => { delete portalFlows[k]; });
  docStorageError = ''; docOcrStatus = '';
  mileageCalcStatus = ''; facilityDistanceStatus = ''; homeGeocodeStatus = ''; mileageClearStatus = '';
  profileEditing = false; addressesEditing = false;
  mileageReviewWeek = ''; mileageLogMonth = '';
  callOriginPromptDismissed = new Set();
  schedulePreview = null; scheduleImportError = ''; scheduleAiStatus = ''; scheduleImportContext = '';
  qgendaSheetOpen = false;
  qgendaStatusLoaded = false; qgendaStatusError = '';
  contractPreview = null; contractImportError = '';
  facilityContractPreview = null; facilityContractError = ''; facilityContractOcrStatus = ''; facilityContractPendingImages = []; facilityContractOcrPages = []; facilityContractFallbackNote = ''; facilityContractCropNote = ''; facilityContractLastCropAdded = [];
  cropRegionByPage = {};
  calPreview = null; calImportError = '';
  contractPendingImages = []; contractOcrPages = []; contractOcrStatus = '';
  onboardStep = 0;
  if (typeof window !== 'undefined' && window && typeof window.liveSyncResetDeviceState === 'function') window.liveSyncResetDeviceState();
}
async function cloudSignOutAndClearDevice() {
  const localOnly = deviceHasLocalOnlyData();
  const msg = localOnly
    ? 'This clears everything off this phone. A backup downloads first, just in case — everything stays saved in your account and will come back when you sign in.'
    : 'This clears everything off this phone. Your data stays saved in your account and comes back when you sign in.';
  if (!confirm(msg)) return;
  if (localOnly) { try { download('crna-hub-backup.json', deviceBackupJSON(), 'application/json'); } catch (e) {} }
  try { if (cloudSession) await sbAuthReq('/auth/v1/logout', {}, { token: cloudSession.access_token }); } catch (e) {}
  cloudSession = null; cloudActive = false; cloudOffline = false; cloudError = ''; cloudLastSync = ''; cloudSyncTimes = {}; cloudAuthStatus = ''; cloudPortals = []; portalAttemptFailed = {}; portalHealed = {};
  cloudAuthResetForm();
  resetDeviceLocalState();
  cloudPersistSession();
  try { localStorage.removeItem('crna-hub-last-sync'); } catch (e) {}
  render();
}
// =====================================================================
// TESTING UTILITY — Start over (testing): erase my account & this
// device (Nov 7, 2026, Caleb). NOT a product feature: Caleb asked for
// it to test the first-run experience from his real account after
// learning that (a) the on-device store is shared across accounts, so
// signing in with a new email merged his phone data INTO that account,
// and (b) the app had no way to un-copy it. He explicitly declined a
// backup ("I'm ok with not backing it up and starting from scratch on
// even on my actual account") — so this makes NO backup, on purpose.
//
// Placement is deliberately subdued: a collapsed "Testing tools" panel
// at the bottom of the Account tab, signed-in only, no onboarding or
// Getting Started mentions. Whether beta users ever see it is a later
// decision. REMOVAL is clean by construction: everything lives in this
// block plus three one-line tendrils — the testingToolsMountHTML()
// call at the end of accountPage()'s signed-in return, and the four
// wipe-* lines in the click dispatcher next to cloud-signout-clear.
// Delete those and this block, and nothing else references it.
//
// How it differs from "Sign out & clear this device" (which stays
// exactly as-is, right above): that tool clears ONLY this phone and
// keeps the account — sign back in and everything returns. This one
// erases the ACCOUNT's cloud data first (every user-scoped table,
// deleted through the user's own token so RLS scopes each delete to
// the caller — a second user's rows are unreachable), clears the
// profile fields stored in Auth user_metadata, and only then clears
// this device and signs out, through the same tail as
// cloudSignOutAndClearDevice.
//
// Auth decision: the Supabase Auth USER is kept — same email/password
// signs back in to a genuinely empty account (Caleb's stated goal:
// "start from scratch on my actual account"). Deleting the auth user
// would also work (every table references auth.users on delete
// cascade), but it needs the service-role key — which this app never
// ships to the browser — and would force a fresh sign-up; wiping the
// data + metadata leaves no residue the app can read back.
//
// Safety properties (do not weaken):
//  * Serious confirmation: a sheet naming the account email and
//    exactly what is erased, requiring the user to TYPE "ERASE" and
//    then tap an armed second confirm. One casual tap does nothing.
//  * Honest failure: steps run in order and STOP at the first failure.
//    The device is NOT cleared and the session is NOT ended unless
//    every server step succeeded; the sheet reports exactly which
//    sections were erased, which failed, and which were not attempted.
//    Re-running is safe: every step is an idempotent delete.
//  * No resurrection: the cloud tables end empty AND the local
//    tombstones/store are wiped by resetDeviceLocalState, so the next
//    sign-in merge finds nothing on either side. Calendar pairings
//    and connections are erased server-side too, so the account comes
//    back with no connected providers (the confirmation says the user
//    will need to reconnect their calendar).
// =====================================================================
let wipeConfirm = null;
function testingToolsMountHTML() { return testingToolsHTML() + wipeOverlayHTML(); }
function testingToolsHTML() {
  if (!cloudSession) return '';
  return collapsePanelHTML('testing-tools-panel', 'Testing tools',
    `<p class="muted">Helpers for testing the app — not part of the normal setup. “Sign out &amp; clear this device” above keeps your account; the tool below does not.</p><div class="item"><div><div class="item-title">Start over (testing) — erase my account &amp; this device</div><div class="muted">Erases everything saved in this account and on this device, then signs you out. No backup is made. Your sign-in still works afterwards — the account just comes back empty.</div></div><div class="item-actions"><button type="button" class="secondary tiny" data-action="wipe-open">Start over…</button></div></div>`,
    false);
}
function wipeOverlayHTML() {
  if (!wipeConfirm || !cloudSession) return '';
  const email = escapeHTML(cloudSession.email || '');
  if (wipeConfirm.report) {
    const r = wipeConfirm.report;
    const list = (arr) => arr.length ? `<ul>${arr.map(x => `<li>${escapeHTML(x)}</li>`).join('')}</ul>` : '<p class="muted">None.</p>';
    return `<div class="sheet-backdrop"></div><div class="sheet" role="dialog" aria-label="Start over stopped"><div class="sheet-head"><h2>Start over stopped</h2></div><p><strong>Nothing on this device was changed, and you are still signed in as ${email}.</strong></p><p>Erased from your account before it stopped:</p>${list(r.erased)}<p>Could not erase: <strong>${escapeHTML(r.failed)}</strong>${r.message ? ` — ${escapeHTML(r.message)}` : ''}</p><p>Not attempted:</p>${list(r.remaining)}<p class="muted">Trying again is safe — erasing an already-empty section just finds nothing.</p><div class="toolbar"><button type="button" data-action="wipe-retry">Try again</button><button type="button" class="secondary" data-action="wipe-cancel">Close</button></div></div>`;
  }
  const busy = wipeConfirm.busy, armed = wipeConfirm.armed;
  return `<div class="sheet-backdrop"></div><div class="sheet" role="dialog" aria-label="Start over — erase everything"><div class="sheet-head"><h2>Start over — erase everything?</h2></div><p>Signed in as <strong>${email}</strong>. This erases, for this account only:</p><ul><li>Everything in your account in the cloud — shifts, facilities, mileage, vehicles, pay stubs, licenses, CE records, NBCRNA &amp; AANA records, portal connections, certification documents and their uploaded files, settings, addresses and push subscriptions.</li><li>Your calendar connections and pairings (Apple, Google, Outlook, QGenda) — you will need to reconnect your calendar afterwards.</li><li>Everything saved on this device.</li></ul><p><strong>No backup is made, and this cannot be undone.</strong> Your sign-in (email &amp; password) still works — the account comes back empty, like a brand-new account.</p>${busy ? `<p><strong>Erasing: ${escapeHTML(wipeConfirm.step || '…')}</strong></p>` : `<div class="form-grid"><label>Type ERASE to confirm<input id="f_wipeText" type="text" value="${escapeHTML(wipeConfirm.text || '')}" autocomplete="off" placeholder="ERASE"></label></div>${wipeConfirm.error ? `<p class="hint">${escapeHTML(wipeConfirm.error)}</p>` : ''}<div class="toolbar"><button type="button" class="danger" data-action="wipe-erase">${armed ? 'Tap again to erase — this cannot be undone' : 'Erase everything'}</button><button type="button" class="secondary" data-action="wipe-cancel">Cancel</button></div>`}</div>`;
}
function wipeEraseTap() {
  if (!wipeConfirm || wipeConfirm.busy) return;
  const el = $('f_wipeText');
  const val = el ? String(el.value || '') : (wipeConfirm.text || '');
  wipeConfirm.text = val;
  if (val !== 'ERASE') { wipeConfirm.armed = false; wipeConfirm.error = 'Type ERASE (all capitals) to continue — nothing has been erased.'; render(); return; }
  wipeConfirm.error = '';
  if (!wipeConfirm.armed) { wipeConfirm.armed = true; render(); return; }
  wipeEraseRun();
}
function wipeEraseSteps() {
  const uid = cloudUid(), q = '?user_id=eq.' + encodeURIComponent(uid);
  const del = (t) => () => sbReq('/rest/v1/' + t + q, 'DELETE');
  return [
    { label: 'Uploaded certification files', run: wipeEraseStorageFiles },
    { label: 'Profile (name, employment type, income goal)', run: async () => { await cloudUpdateUserMetadata({ schedule_name: null, employment_type: null, monthly_income_goal: null }); } },
    { label: 'Shifts', run: del('shifts') },
    { label: 'Facilities', run: del('facilities') },
    { label: 'Mileage trips', run: del('mileage_trips') },
    { label: 'Pay stubs & pay schedules', run: del('pay_stubs') },
    { label: 'Vehicles', run: del('vehicles') },
    { label: 'Licenses', run: del('licenses') },
    { label: 'CE records', run: del('ce_records') },
    { label: 'NBCRNA record', run: del('nbcrna_profiles') },
    { label: 'AANA record', run: del('aana_memberships') },
    { label: 'Portal connections', run: del('portal_connections') },
    { label: 'Certification documents', run: del('documents') },
    { label: 'Calendar connections (Apple, Google, Outlook, QGenda)', run: del('calendar_connections') },
    { label: 'Calendar pairings', run: del('calendar_sync_map') },
    { label: 'Calendar import pairings', run: del('calendar_import_map') },
    { label: 'Pending calendar deletions', run: del('calendar_pending_deletions') },
    { label: 'Calendar sign-in leftovers', run: del('calendar_oauth_states') },
    { label: 'Sync log', run: del('sync_log') },
    { label: 'Push subscriptions', run: del('push_subscriptions') },
    { label: 'Push notification log', run: del('push_sent_log') },
    { label: 'Settings, addresses & feature choices', run: del('user_settings') },
  ];
}
async function wipeEraseStorageFiles() {
  const uid = cloudUid();
  const rows = await sbReq('/rest/v1/documents?select=storage_path&user_id=eq.' + encodeURIComponent(uid), 'GET');
  const paths = new Set();
  (rows || []).forEach(r => { if (r && r.storage_path) paths.add(r.storage_path); });
  (db.documents || []).forEach(d => { if (d && d.storagePath) paths.add(d.storagePath); });
  for (const p of paths) {
    const res = await sbStorageReq('/storage/v1/object/certification-documents/' + String(p).split('/').map(encodeURIComponent).join('/'), 'DELETE');
    if (res && res.ok === false) throw new Error('an uploaded file could not be deleted (' + res.status + ')');
  }
}
async function wipeEraseRun() {
  if (!wipeConfirm || wipeConfirm.busy || !cloudSession) return;
  wipeConfirm.busy = true; wipeConfirm.error = ''; wipeConfirm.report = null; wipeConfirm.step = 'Getting ready'; render();
  const steps = wipeEraseSteps();
  try { await cloudEnsureToken(); } catch (e) {
    wipeConfirm.busy = false; wipeConfirm.step = '';
    wipeConfirm.report = { erased: [], failed: 'Your sign-in session (it may have expired — sign in again, then retry)', remaining: steps.map(s => s.label), message: (e && e.message) || '' };
    render(); return;
  }
  const erased = [];
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    wipeConfirm.step = s.label; render();
    try { await s.run(); erased.push(s.label); } catch (e) {
      wipeConfirm.busy = false; wipeConfirm.step = '';
      wipeConfirm.report = { erased: erased.slice(), failed: s.label, remaining: steps.slice(i + 1).map(x => x.label), message: (e && e.message) || String(e) };
      render(); return;
    }
  }
  // Every server step succeeded — now the device half, mirroring
  // cloudSignOutAndClearDevice's tail EXCEPT the backup: this tool
  // exists because the user chose no backup (see the banner above).
  try { if (cloudSession) await sbAuthReq('/auth/v1/logout', {}, { token: cloudSession.access_token }); } catch (e) {}
  cloudSession = null; cloudActive = false; cloudOffline = false; cloudError = ''; cloudLastSync = ''; cloudSyncTimes = {}; cloudAuthStatus = ''; cloudPortals = []; portalAttemptFailed = {}; portalHealed = {};
  cloudAuthResetForm();
  wipeConfirm = null;
  resetDeviceLocalState();
  cloudPersistSession();
  try { localStorage.removeItem('crna-hub-last-sync'); } catch (e) {}
  cloudAuthStatus = 'Start over (testing) is done: this account and this device were erased. Sign in to a fresh, empty account.';
  render();
}
// --- End of TESTING UTILITY block ------------------------------
function cloudDocumentRow(x) { return { id: x.id, user_id: cloudUid(), cert_type: x.certType || null, file_name: x.fileName || null, storage_path: x.storagePath || null, issue_date: x.issue || null, expiration_date: x.expiry || null, expiry_source: x.expirySource || 'user_entered', storage_status: x.storageStatus || 'local_details_only', uploaded_at: x.uploadedAt || cloudNow() }; }
async function cloudSaveDocument(rec) { if (!cloudSyncEnabled()) return; try { await sbReq('/rest/v1/documents', 'POST', cloudDocumentRow(rec)); cloudOffline = false; cloudError = ''; cloudLastSync = cloudNow(); cloudPersistSession(); } catch (e) { cloudOffline = true; cloudError = e.message; } }
function cloudDeleteDocument(entryId) { if (!cloudSyncEnabled()) return; const rec = (db.documents || []).find(x => x.id === entryId); (async () => { try { if (rec && rec.storagePath) { await cloudEnsureToken(); await sbStorageReq('/storage/v1/object/certification-documents/' + rec.storagePath.split('/').map(encodeURIComponent).join('/'), 'DELETE'); } await sbReq('/rest/v1/documents?id=eq.' + encodeURIComponent(entryId), 'DELETE'); } catch (e) { cloudOffline = true; cloudError = e.message; } })(); }

function cloudSaveKind(kind, savedId) { if (!cloudSyncEnabled()) return; (async () => { try { const spec = cloudSyncedSpec(kind); if (spec) { const rec = (db[kind] || []).find(x => x.id === savedId); if (rec) { const row = spec.row(rec); if (row) await sbReq('/rest/v1/' + spec.table, 'POST', row); } } else if (kind === 'nbcrna') { if (cloudLocalHasNbcrna()) { await sbReq('/rest/v1/nbcrna_profiles', 'POST', cloudNbcrnaRow()); await cloudUpsertPortals(); } } else if (kind === 'aana') { if (cloudLocalHasAana()) { await sbReq('/rest/v1/aana_memberships', 'POST', cloudAanaRow()); await cloudUpsertPortals(); } } else if (kind === 'licenses') { const rec = (db.licenses || []).find(x => x.id === savedId); if (rec) { await sbReq('/rest/v1/licenses', 'POST', cloudLicenseRow(rec)); await cloudUpsertPortals(); } } else if (kind === 'nbcrnaCE') { const rec = (db.nbcrnaCE || []).find(x => x.id === savedId); if (rec) await sbReq('/rest/v1/ce_records', 'POST', cloudCeRow(rec, 'nbcrna')); } else if (kind === 'aanaCE') { const rec = (db.aanaCE || []).find(x => x.id === savedId); if (rec) await sbReq('/rest/v1/ce_records', 'POST', cloudCeRow(rec, 'aana')); } else if (kind === 'documents') { const rec = (db.documents || []).find(x => x.id === savedId); if (rec) await sbReq('/rest/v1/documents', 'POST', cloudDocumentRow(rec)); } cloudOffline = false; cloudError = ''; cloudLastSync = cloudNow(); cloudPersistSession(); } catch (e) { cloudOffline = true; cloudError = e.message; } })(); }
function cloudDeleteKind(kind, entryId) { if (!cloudSyncEnabled()) return; (async () => { try { const table = kind === 'licenses' ? 'licenses' : 'ce_records'; await sbReq('/rest/v1/' + table + '?id=eq.' + encodeURIComponent(entryId), 'DELETE'); } catch (e) { cloudOffline = true; cloudError = e.message; } })(); }
// A portal card may say Connected / Verified ONLY when a real pull
// actually returned a record. The portal_connections status string alone
// is not proof: a stale 'connected' row, or a status refresh that never
// landed, must never produce that label. Proof is the pulled record
// itself: a portal source on the record plus a retrieval date.
let portalAttemptFailed = {}; // key -> {at, error}: a pull failed this session
let portalHealed = {}; // key -> true: a stale 'connected' row was corrected once
function portalVerifiedRetrievedAt(key) {
  if (key === 'nbcrna') { const n = db.nbcrna || {}; return (n.source === 'public_verification' || n.source === 'nbcrna_portal') && cloudSyncTimes.nbcrna ? cloudSyncTimes.nbcrna : ''; }
  if (key === 'aana') { const a = db.aana || {}; return a.source === 'aana_portal' && cloudSyncTimes.aana ? cloudSyncTimes.aana : ''; }
  return (db.licenses || []).some(x => x.source === 'state_board_portal') && cloudSyncTimes.licenses ? cloudSyncTimes.licenses : '';
}
function portalHealStaleConnected(key, row) {
  if (portalHealed[key] || !row || !row.id) return;
  portalHealed[key] = true;
  // Make the in-memory copy honest at once so a re-render stays honest.
  row.status = 'failed';
  row.last_error = row.last_error || 'Last pull did not return a verified record.';
  // Best effort: correct the stored row too, so a later load also shows
  // the truth. The server already writes 'failed' on every failure path;
  // this covers a stale row whose failure write never landed.
  if (typeof cloudSyncEnabled === 'function' && cloudSyncEnabled()) {
    (async () => { try { await sbReq('/rest/v1/portal_connections?id=eq.' + encodeURIComponent(row.id), 'PATCH', { status: 'failed', last_error: 'Corrected: no verified record on file for this portal — last pull did not return a record.', last_synced_at: row.last_synced_at || cloudNow() }); } catch (e) {} })();
  }
}
function portalNoteFailed(key, error) {
  portalAttemptFailed[key] = { at: cloudNow(), error: error || '' };
  // Make the in-memory copy honest at once, even if the status refresh
  // below never lands: a failed attempt must never render as Connected.
  const rows = cloudPortals || [];
  const row = key === 'licenses'
    ? rows.filter(r => r.portal === 'state_board').sort((a, b) => String(b.last_synced_at || '').localeCompare(String(a.last_synced_at || '')))[0]
    : rows.find(r => r.portal === key);
  if (row) {
    row.status = 'failed';
    row.last_error = error || row.last_error || 'The last portal attempt failed.';
    row.last_synced_at = cloudNow();
    if (row.id && typeof cloudSyncEnabled === 'function' && cloudSyncEnabled()) {
      (async () => { try { await sbReq('/rest/v1/portal_connections?id=eq.' + encodeURIComponent(row.id), 'PATCH', { status: 'failed', last_error: error || 'The last portal attempt failed.', last_synced_at: cloudNow() }); } catch (e) {} })();
    }
  }
}
function cloudPortalState(key) { if (!SUPABASE_CONFIGURED) return { label: 'Not connected', detail: 'Sign-in isn’t available yet' }; if (!cloudSession) return { label: 'Not connected', detail: 'Sign in on the Account tab to sync records to your account' }; if (!cloudActive) return { label: 'Not connected', detail: 'Signed in — records are merging with your account automatically' }; if (cloudOffline) return { label: 'Signed in (offline)', detail: 'Showing the on-device copy; the last sync attempt failed' + (cloudError ? ' (' + cloudError + ')' : '') };
  // A pull that failed in this session outranks any stored row: the
  // refresh after a failure may itself fail to land, and the label must
  // still show the failure, never a stale Connected.
  const failedHere = portalAttemptFailed[key];
  if (failedHere) return { label: 'Not verified', detail: 'Last pull failed · last attempt ' + cloudFmtWhen(failedHere.at) + (failedHere.error ? ' — ' + failedHere.error : '') + '. Use the manual lookup / manual entry below.' };
  const rows = cloudPortals || [];
  const row = key === 'licenses'
    ? rows.filter(r => r.portal === 'state_board').sort((a, b) => String(b.last_synced_at || '').localeCompare(String(a.last_synced_at || '')))[0]
    : rows.find(r => r.portal === key);
  if (!row) return { label: 'Not verified', detail: 'No successful pull yet — use Connect below, or the manual entry fallback' };
  const when = row.last_synced_at ? ' · last attempt ' + cloudFmtWhen(row.last_synced_at) : '';
  if (row.status === 'connected') {
    const retrievedAt = portalVerifiedRetrievedAt(key);
    if (retrievedAt) return { label: 'Connected — live portal pull', detail: 'Verified by the portal · last verified ' + cloudFmtWhen(retrievedAt) };
    // Stale 'connected' row with no verified record behind it: never show
    // Connected / Verified. Correct the stored row once and say so.
    portalHealStaleConnected(key, row);
    return { label: 'Not verified', detail: 'Last pull did not return a verified record' + when + (row.last_error ? ' — ' + row.last_error : '') + '. Use the manual lookup / manual entry below.' };
  }
  if (row.status === 'needs_reauth') return { label: 'Not verified — sign-in needed', detail: (row.last_error || 'The portal session expired — connect again') + when };
  if (row.status === 'failed') return { label: 'Not verified', detail: 'Last pull failed' + when + (row.last_error ? ' — ' + row.last_error : '') + '. Use the manual lookup / manual entry below.' };
  return { label: 'Not verified', detail: 'No successful pull yet — use Connect below, or the manual entry fallback' }; }
function portalSourceLabel(source, when) { const labels = { 'public_verification': 'Verified — NBCRNA public lookup', 'nbcrna_portal': 'Verified — NBCRNA portal', 'aana_portal': 'Verified — AANA member sign-in', 'state_board_portal': 'Verified — state board lookup', 'assistant_portal_check': 'Assistant portal check — read from the portal page you showed the assistant', 'user_entered': 'User-entered — not verified' }; return (labels[source] || 'User-entered — not verified') + (when ? ' · ' + cloudFmtWhen(when) : ''); }
// --- Portal connect flow (final-product structure, Nov 6, 2026) ---
// ONE flow object per portal, built by portalConnectFlow() and shared
// by every Connect card (NBCRNA, AANA, State Licenses — and any portal
// added to PORTAL_CHECK_SOURCES later gets the same flow). The flow's
// steps are open() -> returnToApp() -> the assistant check, and they
// are the FINAL product's steps (see PORTAL_NATIVE_SPEC): in the
// finished native app, open() is Apple's system sign-in sheet
// (ASWebAuthenticationSession) — iPhone Passwords + Face ID fill the
// login, the app never sees a portal password, and when sign-in
// finishes the sheet RETURNS the user to the app automatically, where
// returnToApp() hands straight into the check.
//
// Why Connect is a real link, not a script redirect (Caleb's report,
// Nov 6, 2026): the old Connect was a button whose handler called
// window.open. In the home-screen / standalone app (and in-app
// webviews) there is no tab strip — iOS loads a script-opened window
// INTO the app's only window, so tapping Connect navigated the app
// itself away to the portal and the return prompt went with it. The
// Connect control is now an <a href target="_blank"> the browser
// itself opens as a new tab, and open() runs inside the tap:
//   * Browser tab: window.open (synchronous, in the tap handler —
//     async calls get popup-blocked on iOS) opens the tab and open()
//     cancels the link's own navigation, so the app tab stays exactly
//     where he left it, return prompt waiting. The handle is kept so
//     returnToApp() can close the portal tab; its opener is severed
//     at once, so the portal gets no handle back into this app.
//   * Standalone / home-screen app: open() does NOT hijack the tap —
//     the real link opens the portal outside the app window (Safari),
//     opened-state is persisted, and the app is still here, check
//     intact, when he comes back.
//   * Popup genuinely blocked (window.open returns nothing): NEVER
//     fall back to navigating this tab. open() shows a short
//     pre-leaving sheet — he's leaving the app, the two things to do
//     over there, the app will be right here — and the tab only
//     navigates on his explicit tap on that sheet (portalLeaveGo).
// Guided-check state is persisted on every step (portalStatePersist),
// so even a full reload resumes the check where he left off.
// Server-side pulls stay blocked — NBCRNA public verification submit
// 404s, AANA SSO sign-in is bot-gated, WV/OH board lookups block
// automation — so the check reads the record page the user brings
// back (screenshot or pasted text) and previews it before saving.
// (portalCall/portalRefreshStatus below still serve the monitoring log.)
let portalOpened = {}; // portalKey -> true once Connect opened the portal
let portalLeaveSheet = ''; // portalKey whose pre-leaving sheet is showing ('' = none)
const portalFlows = {}; // portalKey -> connect flow object
// True when the app runs as a home-screen / standalone app or another
// single-window webview, where a script window.open replaces the app
// instead of opening a tab.
function portalStandaloneMode() {
  try { if (typeof navigator !== 'undefined' && navigator && navigator.standalone === true) return true; } catch (e) {}
  try {
    if (typeof window !== 'undefined' && window && typeof window.matchMedia === 'function') {
      if (window.matchMedia('(display-mode: standalone)').matches) return true;
      if (window.matchMedia('(display-mode: fullscreen)').matches) return true;
    }
  } catch (e) {}
  return false;
}
function portalConnectFlow(key) {
  const meta = PORTAL_CHECK_SOURCES[key]; if (!meta) return null;
  if (!portalFlows[key]) {
    portalFlows[key] = {
      key, meta, win: null, openedAt: '', returnedAt: '',
      open(ev) {
        this.openedAt = new Date().toISOString();
        this.returnedAt = '';
        if (portalStandaloneMode()) {
          // Single-window app: let the real link take him to the
          // portal — do not touch the tap, do not re-render mid-tap.
          // State is persisted; the return prompt is waiting when he
          // comes back (the focus/visibility hook re-renders).
          portalOpened[key] = true;
          portalStatePersist();
          return 'link';
        }
        let win = null;
        try { win = window.open(this.meta.url, '_blank'); } catch (e) {}
        if (win) {
          if (ev && ev.preventDefault) ev.preventDefault();
          try { win.opener = null; } catch (e) {}
          this.win = win;
          portalOpened[key] = true;
          portalLeaveSheet = '';
          portalStatePersist();
          render();
          return 'tab';
        }
        // Blocked: never silently redirect this tab — pre-leaving
        // sheet first, and leaving is its own explicit tap.
        if (ev && ev.preventDefault) ev.preventDefault();
        portalLeaveSheet = key;
        render();
        return 'blocked';
      },
      returnToApp() {
        this.returnedAt = new Date().toISOString();
        if (this.win) { try { if (!this.win.closed) this.win.close(); } catch (e) {} this.win = null; }
        startPortalCheck(this.key);
      },
    };
  }
  return portalFlows[key];
}
// The Connect anchor's tap: runs the flow inside the tap handler, so
// the synchronous window.open keeps its user-activation on iOS.
function portalConnectClick(key, ev) { const f = portalConnectFlow(key); if (f) f.open(ev); }
function portalOpenSignIn(key) { const f = portalConnectFlow(key); if (f) f.open(); }
// The pre-leaving sheet's explicit tap — the ONLY place a portal
// connect navigates the current tab, and only after he has seen the
// sheet and chosen to go. His place is persisted before leaving.
function portalLeaveGo(key) {
  const meta = PORTAL_CHECK_SOURCES[key]; if (!meta) return;
  const f = portalConnectFlow(key);
  if (f) { f.openedAt = new Date().toISOString(); f.returnedAt = ''; }
  portalOpened[key] = true;
  portalLeaveSheet = '';
  portalStatePersist();
  try { if (typeof location !== 'undefined' && location && typeof location.assign === 'function') { location.assign(meta.url); return; } } catch (e) {}
  try { location.href = meta.url; } catch (e) {}
}
// The user coming back to this tab with a portal flow open: stamp the
// return and re-render, so the card's return prompt is on screen.
// (The web build cannot detect the moment sign-in completes inside
// the portal's tab; the native sheet reports exactly that, which is
// the hook returnToApp() hangs off in the finished app.)
function portalNoteReturn() {
  let any = false;
  Object.values(portalFlows).forEach((f) => { if (f.openedAt && !f.returnedAt) { f.returnedAt = new Date().toISOString(); any = true; } });
  if (any) render();
}
if (typeof document !== 'undefined' && document && typeof document.addEventListener === 'function') {
  document.addEventListener('visibilitychange', () => { if (!document.hidden) portalNoteReturn(); });
}
if (typeof window !== 'undefined' && window && typeof window.addEventListener === 'function') {
  window.addEventListener('focus', portalNoteReturn);
}
async function portalRefreshStatus() { try { if (typeof liveSyncGet !== 'function') return; const data = await liveSyncGet('portal-sync', 'status'); cloudPortals = data.connections || []; } catch (e) {} }
async function portalCall(body) { await cloudEnsureToken(); return await liveSyncPost('portal-sync', body); }
function portalErrMsg(e) { return (e && e.data && e.data.message) || (e && e.message) || 'The portal check failed.'; }
function syncSectionHTML(){
  // Three separate sibling panels (Nov 6, 2026): Live calendar sync,
  // QGenda, and Upload a schedule — each expands/collapses on its own
  // header tap. Nothing functional moved: same connect flows, same
  // preview-before-save, same sync log. QGenda and Upload a schedule
  // also render at the bottom of the Facilities tab (Nov 7, 2026) via
  // the same two component functions — shared state, either home.
  const liveBody=typeof liveSyncPanelHTML==='function'?liveSyncPanelHTML():'<p class="muted">Live calendar sync is loading…</p>';
  const liveOpen=typeof liveSyncPanelOpen==='function'?liveSyncPanelOpen():true;
  return collapsePanelHTML('live-sync-panel','Live calendar sync',onboardDirectionHTML(2)+liveBody,liveOpen)+qgendaFeedHTML()+scheduleImportHTML();
}
// Profile — step 1 section (Nov 6, 2026): once the profile is complete
// (name set) it renders collapsed — a one-line summary (name · employment
// type · goal, only what's set) with an Edit button. Edit reopens the
// full form with current values; Save profile collapses it again. An
// incomplete profile always renders the form, so step 1 never hides from
// a new user mid-setup.
function profileSectionHTML() {
  if (String(profileName() || '').trim() && !profileEditing) {
    const parts = [String(profileName()).trim()];
    if (employmentType()) parts.push(employmentTypeLabel());
    if (monthlyIncomeGoal() > 0) parts.push('Monthly goal: ' + currency(monthlyIncomeGoal()));
    return `<section class="panel" id="profile-panel"><h2>Profile — step 1</h2><p>${escapeHTML(parts.join(' · '))}</p><div class="toolbar"><button type="button" class="secondary" data-action="edit-profile">Edit</button></div></section>`;
  }
  return `<section class="panel" id="profile-panel"><h2>Profile — step 1</h2><p class="muted">Your profile — change anything, any time.</p><div class="form-grid">${field('profileName', 'Name as it appears on your schedule and licenses', 'text', profileName(), 'placeholder="e.g. J. Doe" autocomplete="off"')}${selectLabeled('profileEmploymentType','Employment type',[['','Select employment type'],['w2','W-2 — employed'],['1099','1099 — independent contractor'],['both','Both W-2 and 1099']],employmentType())}${field('profileIncomeGoal', 'Monthly income goal ($) — blank unsets it', 'number', monthlyIncomeGoal()>0?monthlyIncomeGoal():'', 'min="0" step="1" placeholder="e.g. 40000"')}</div><div class="toolbar"><button type="button" data-action="save-profile">Save profile</button></div><p class="muted">Employment type: ${escapeHTML(employmentTypeLabel())} — W-2 salary days are never double-counted; 1099 shifts price from contracts and facilities. Monthly goal: ${monthlyIncomeGoal()>0?currency(monthlyIncomeGoal()):'not set'}.</p></section>`;
}
function accountPage() {
  const home = homeAddressSection() + featuresSectionHTML() + notificationsPanelHTML();
  if (!SUPABASE_CONFIGURED) return onboardDirectionHTML(1) + `<section class="panel"><h2>Account</h2><p><strong>Sign-in isn’t available yet.</strong> Everything is saved on this device only.</p></section>` + home + syncSectionHTML() + backupHTML();
  if (!cloudSession) {
    // v126 split (Nov 11, 2026): TWO forms, one panel. Sign-in is the
    // default — email + password only; the step-1 profile fields live
    // on the create form behind "New here?". The status line (incl.
    // the post-erase banner) renders above whichever form is showing,
    // and the typed email/password ride across the switch via
    // cloudAuthDraft (captured in render()).
    const authStatus = cloudAuthStatus ? `<p class="hint" id="cloudAuthStatus">${escapeHTML(cloudAuthStatus)}</p>` : '';
    const confirmNote = `<p class="muted">If we email you a confirmation, tap it, then sign in.</p>`;
    if (cloudAuthMode === 'create') return onboardDirectionHTML(1) + `<section class="panel"><h2>Account — create your account</h2><p class="muted">Add the name as it appears on your schedule and licenses, pick W-2, 1099, or both, and set a monthly income goal — or skip it.</p>${authStatus}<form id="cloudAuthForm"><div class="form-grid">${field('email', 'Email', 'email', cloudAuthDraft.email, 'required autocomplete="email"')}${field('password', 'Password', 'password', cloudAuthDraft.password, 'required autocomplete="new-password"')}${field('scheduleName', 'Name as it appears on your schedule and licenses', 'text', (db.settings && db.settings.scheduleName) || '', 'placeholder="e.g. J. Doe" autocomplete="off"')}${selectLabeled('employmentType','Employment type',[['','Select employment type'],['w2','W-2 — employed'],['1099','1099 — independent contractor'],['both','Both W-2 and 1099']],employmentType())}${field('incomeGoalStep1', 'Monthly income goal ($) — optional', 'number', monthlyIncomeGoal()>0?monthlyIncomeGoal():'', 'min="0" step="1" placeholder="e.g. 40000"')}</div><div class="toolbar"><button type="button" class="secondary tiny" data-action="skip-income-goal">Skip — I\u2019ll set this later</button></div><p class="muted">No goal yet? No worries — skip it and set one later.</p>${formEnd('Create account')}</form><p class="muted">Already have an account? <button type="button" class="secondary tiny" data-action="cloud-show-signin">Sign in</button></p>${confirmNote}</section>` + home + syncSectionHTML() + backupHTML();
    return onboardDirectionHTML(1) + `<section class="panel"><h2>Account — sign in to sync credentials</h2><p class="muted">Sign in and everything syncs with your account.</p>${authStatus}<form id="cloudAuthForm"><div class="form-grid">${field('email', 'Email', 'email', cloudAuthDraft.email, 'required autocomplete="email"')}${field('password', 'Password', 'password', cloudAuthDraft.password, 'required autocomplete="current-password"')}</div>${formEnd('Sign in')}</form><p class="muted">New here? <button type="button" class="secondary tiny" data-action="cloud-show-create">Create your account</button></p>${confirmNote}</section>` + home + syncSectionHTML() + backupHTML();
  }
  const profileSection = profileSectionHTML();
  return onboardDirectionHTML(1) + profileSection + `<section class="panel"><h2>Account</h2><p><strong>Signed in as ${escapeHTML(cloudSession.email || '')}.</strong></p>${cloudLastSync ? `<p class="muted">Last sync: ${escapeHTML(cloudFmtWhen(cloudLastSync))}</p>` : ''}${cloudError ? `<p class="muted">Last sync problem: ${escapeHTML(cloudError)}</p>` : ''}<p class="muted">Your records sync with your account automatically — newest edit wins, and nothing one-sided is ever overwritten or deleted.</p><div class="toolbar"><button class="secondary" data-action="cloud-signout">Sign out</button><button class="secondary" data-action="cloud-signout-clear">Sign out &amp; clear this device</button></div></section>` + home + syncSectionHTML() + backupHTML() + testingToolsMountHTML();
}
if (typeof window !== 'undefined' && window && typeof window.addEventListener === 'function') { try { window.addEventListener('online', () => { if (cloudSession) cloudAutoMerge(); }); } catch (e) {} }
async function cloudInit() { if (!SUPABASE_CONFIGURED || !cloudSession) return; try { await cloudEnsureToken(); } catch (e) { cloudSession = null; cloudActive = false; cloudAuthResetForm(); cloudPersistSession(); render(); return; } await cloudAutoMerge(); render(); monitorBackgroundSweep(); qgendaBootCheck(); pushWatchSyncHealth(); }

// Boot (Nov 6, 2026): the first render is hardened — if anything in the
// first paint throws, the user still gets the tab bar and a visible error
// panel with a reload button, never a silent blank page (the boot watchdog
// in index.html is the second net, for failures before this file runs).
function bootRender(){try{render()}catch(e){try{console.error(e)}catch(_){ } const navEl=$('nav');if(navEl&&!navEl.innerHTML){navEl.innerHTML=tabs.map(t=>`<button class="${tab===t?'active':''}" data-tab="${escapeHTML(t)}">${escapeHTML(t)}</button>`).join('');try{navEl.querySelectorAll('[data-tab]').forEach(b=>b.addEventListener('click',()=>setTab(b.dataset.tab)))}catch(_){ }} const appEl=$('app');if(appEl)appEl.innerHTML=`<section class="panel"><h2>Something went wrong starting CRNA Hub</h2><p class="muted">${escapeHTML(String((e&&e.message)||e))}</p><p class="muted">Your saved data on this device is not affected. Tap a tab above to try that page, or reload.</p><p><button type="button" onclick="location.reload()">Reload</button></p></section>`}}
portalCheckRestore();pushDeepLinkApply();bootRender();cloudInit();if('serviceWorker'in navigator&&location.protocol==='https:')navigator.serviceWorker.register('./sw.js').then(reg=>{const promptReload=()=>{if(confirm('A newer version of CRNA Hub is available. Reload now to use it?'))window.location.reload()};if(reg.waiting)promptReload();reg.addEventListener('updatefound',()=>{const sw=reg.installing;if(!sw)return;sw.addEventListener('statechange',()=>{if(sw.state==='installed'&&navigator.serviceWorker.controller)promptReload()})});try{document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'){try{const p2=reg.update();if(p2&&p2.catch)p2.catch(()=>{})}catch(e){}}})}catch(e){}try{const p=reg.update();if(p&&p.catch)p.catch(()=>{})}catch(e){}}).catch(()=>{});

// Notification taps carry ?go=<screen> so a tap lands on the exact
// screen where the action is taken (watchdog payloads + sw.js).
function pushDeepLinkApply(){try{const go=new URLSearchParams(location.search).get('go');if(!go)return;const map={credentials:'Credentials',facilities:'Facilities',qgenda:'Facilities',dashboard:'Dashboard',account:'Account',mileage:'Mileage'};const t=map[String(go).toLowerCase()];if(t&&tabs.includes(t)){tab=t}}catch(e){}}
