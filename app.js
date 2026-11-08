'use strict';
const KEY='crna-hub-v2',OLD='crna-hub-starter-v1',tabs=['Account','Dashboard','Facilities','Credentials','Mileage','Assistant'];
const empty=()=>({shifts:[],facilities:[],pto:[],credentials:[],mileage:[],vehicles:[],contracts:[],payStubs:[],nbcrna:{status:'',number:'',periodStart:'',periodEnd:'',renewalDeadline:'',classA:'',classB:'',macEd:'',macDev:'',macEdRequired:60,macDevRequired:40,docNote:'',ceNote:'',reminders:'90,60,30,7',source:'user_entered'},aana:{status:'',number:'',expiration:'',docNote:'',ceNote:'',reminders:'90,60,30,7',source:'user_entered'},nbcrnaCE:[],aanaCE:[],licenses:[],documents:[],assistantChat:[],portalChecks:[],portalMonitoring:[],hotelStays:[],facilitySuggestions:[],settings:{monthlyIncomeGoal:0,employmentType:'',scheduleName:'',scheduleImported:false,scheduleImportFile:'',scheduleImportedAt:'',qgendaConnected:false,qgendaMasked:'',qgendaLastCheckedAt:'',ptoAnnual:0,ptoStarting:0,ptoHoursPerPeriod:0,homeAddress:'',hotelAddress:'',homeLat:'',homeLng:'',homeGeocodedAddress:'',lastHotelAddress:'',mileageTripType:'round-trip',deleteAlsoFromCalendar:false,featureMileage:true,featurePaychecks:true,featureCredentials:true,featureQgenda:true}});
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
  {key:'featureQgenda',label:'QGenda feed',blurb:'Pull your shifts straight from your QGenda schedule.'}
];
function featureDef(key){return FEATURE_DEFS.find(f=>f.key===key)||null}
function featureOn(key){return !db||!db.settings||db.settings[key]!==false}
function normalizeFeatureFlags(obj){if(!obj||typeof obj!=='object')return obj;if(!obj.settings||typeof obj.settings!=='object')obj.settings={};for(const f of FEATURE_DEFS)if(typeof obj.settings[f.key]!=='boolean')obj.settings[f.key]=true;return obj}
function setFeature(key,on){db.settings=db.settings||{};db.settings[key]=!!on;persist();if(typeof cloudUploadSynced==='function'&&typeof cloudSyncEnabled==='function'&&cloudSyncEnabled()){try{const p=cloudUploadSynced();if(p&&p.catch)p.catch(()=>{})}catch(e){}}render()}
function featureOffHTML(key){const f=featureDef(key);return `<section class="panel"><p>${escapeHTML(f.label)} is off. Your data is saved \u2014 turn it back on any time. <button type="button" class="secondary tiny" data-action="feature-toggle" data-id="${f.key}">Turn on</button></p></section>`}
function featureTurnOffLineHTML(key){const f=featureDef(key);return `<p class="muted" style="margin-top:14px">Don\u2019t need this? <button type="button" class="secondary tiny" data-action="feature-toggle" data-id="${f.key}">Turn off ${escapeHTML(f.label.toLowerCase())}</button> \u2014 it just tucks away; nothing is deleted.</p>`}
function featuresSectionHTML(){return `<section class="panel"><h2>Features</h2><p class="muted">Use what you need \u2014 turn the rest off and they just tuck away. Nothing is ever deleted.</p>${FEATURE_DEFS.map(f=>{const on=featureOn(f.key);return `<div class="item"><div><div class="item-title">${escapeHTML(f.label)}</div><div class="muted">${escapeHTML(f.blurb)}</div></div><div class="item-actions"><button type="button" class="${on?'secondary ':''}tiny" data-action="feature-toggle" data-id="${f.key}">${on?'On \u2014 tap to turn off':'Off \u2014 tap to turn on'}</button></div></div>`}).join('')}</section>`}
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
// Boot cleanup (cross-source dedupe, Nov 6, 2026): data stored before
// the identity rule existed can already hold the same shift two or
// three times (calendar + QGenda + upload). Collapse exact identity
// matches once at load — richest data, best status, and every source
// survive on the one record. Guarded: a failure here must never block
// the app from booting.
try{const bootDedupe=dedupeShiftsInPlace();if(bootDedupe.collapsed)persist()}catch(e){}
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
function isW2SalaryShift(x){return !!x&&/off|pto/i.test(String(x.type||''))}
// A shift is priced when it has a pay amount and is not flagged incomplete.
// Unpriced shifts are never $0 - they are excluded from every total and
// counted separately so a total is never silently low.
function isPricedShift(x){return !!x && x.pay!=='' && x.pay!=null && !x.incomplete && num(x.pay)>0}
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
function shiftTypeKeyOf(x){return String((x&&x.type)||'').trim().toLowerCase().replace(/\s+/g,' ')}
function shiftsSameShift(a,b){if(!a||!b)return false;const da=String(a.date||''),dbb=String(b.date||'');if(!/^\d{4}-\d{2}-\d{2}$/.test(da)||da!==dbb)return false;const ta=shiftTypeKeyOf(a),tb=shiftTypeKeyOf(b);if(!ta||ta!==tb)return false;if(shiftFacilityKeyOf(a)!==shiftFacilityKeyOf(b))return false;const sa=shiftStartOf(a),sb=shiftStartOf(b);if(sa&&sb&&sa!==sb)return false;return true}
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
  if(sf)return paystubFacilityKey(sf)===fk?1:0;
  const ak=normFacilityName(stub.agency||'').replace(/\s+/g,' ');
  if(ak&&fk&&(ak===fk||(ak.length>=3&&fk.length>=3&&(ak.includes(fk)||fk.includes(ak)))))return 2;
  return 3;
}
function paystubShiftClaims(){const claims=new Map();const stubs=(db.payStubs||[]).slice().sort((a,b)=>String(a.agency||'').localeCompare(String(b.agency||''))||String(a.id||'').localeCompare(String(b.id||'')));const shifts=(db.shifts||[]).filter(x=>x&&x.id&&psValidISO(x.date));for(const tier of [1,2,3]){for(const stub of stubs){if(!stub.id)continue;for(const x of shifts){if(claims.has(x.id))continue;if(paystubShiftClaimTier(stub,x)===tier)claims.set(x.id,stub.id)}}}return claims}
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
    if(!isPricedShift(x)){out.unpriced++;continue}
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
function paystubReconciliations(){const out=[];const claims=paystubShiftClaims();for(const stub of (db.payStubs||[])){const act=paystubStubActual(stub);const anchor=paystubAnchorPeriod(stub);if(act&&anchor){const totals=paystubPeriodTotals(stub,anchor.start,anchor.end,claims);out.push({stubId:stub.id||'',agency:stub.agency||'',facility:stub.facility||'',payday:stub.payDate||'',periodStart:anchor.start,periodEnd:anchor.end,actual:act.amount,actualBasis:act.basis,shiftSum:totals.gross,shiftSumP:totals.grossWithProposed,shiftCount:totals.shiftCount,delta:Math.round((act.amount-totals.gross)*100)/100,deltaP:Math.round((act.amount-totals.grossWithProposed)*100)/100})}
  // Entered actuals (calendar corrections, Nov 7, 2026): the same
  // reconciliation, one check each — the entered amount replaces that
  // period's shift sum in the YTD figures, exactly like a stub actual,
  // and teaches the schedule nothing (no forward rule is built).
  const ovs=(stub.occOverrides&&typeof stub.occOverrides==='object')?stub.occOverrides:{};
  for(const sd of Object.keys(ovs)){if(sd===stub.payDate)continue;const oa=rateOrNull(ovs[sd]&&ovs[sd].actual);if(oa==null||oa<=0||!anchor)continue;const period=paystubPeriodForPayday(stub,sd,anchor);if(!period)continue;const totals=paystubPeriodTotals(stub,period.start,period.end,claims);out.push({stubId:stub.id||'',agency:stub.agency||'',facility:stub.facility||'',payday:psValidISO(ovs[sd].payDate)||sd,periodStart:period.start,periodEnd:period.end,actual:oa,actualBasis:'entered',shiftSum:totals.gross,shiftSumP:totals.grossWithProposed,shiftCount:totals.shiftCount,delta:Math.round((oa-totals.gross)*100)/100,deltaP:Math.round((oa-totals.grossWithProposed)*100)/100})}}return out}
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
function paystubStubBackedOccurrence(stub,schedDate){return !!(stub&&schedDate&&schedDate===stub.payDate&&paystubStubActual(stub))}
function paystubOccurrences(stub,fromISO,toISO,claimsIn){const out=[];if(!stub||!psValidISO(stub.payDate)||!normalizePayFrequency(stub.frequency))return out;const claims=claimsIn||paystubShiftClaims();const anchor=paystubAnchorPeriod(stub);const act=paystubStubActual(stub);const anchorDay=+stub.payDate.slice(8,10);
// Generate over a WIDENED scheduled window and filter on the DISPLAY
// date: a one-off pay-date correction can pull a check across a month
// boundary in either direction, and the check belongs to the month it
// now lands in.
const lo=psAddDays(fromISO,-70),hi=psAddDays(toISO,70);let d=stub.payDate,guard=0;while(d>lo&&guard++<400){const p=paystubStepBackDate(d,stub.frequency,anchorDay);if(!p||p>=d)break;d=p}guard=0;while(d<=hi&&guard++<300){const period=anchor?paystubPeriodForPayday(stub,d,anchor):null;const totals=period?paystubPeriodTotals(stub,period.start,period.end,claims):{gross:0,grossWithProposed:0,total:0,shiftCount:0,pricedCount:0,unpriced:0};const stubBacked=!!(act&&d===stub.payDate);const ov=stubBacked?null:paystubOccurrenceOverride(stub,d);let date=d,enteredActual=null;if(ov){const od=psValidISO(ov.payDate);if(od)date=od;const oa=rateOrNull(ov.actual);if(oa!=null&&oa>0)enteredActual=oa}const isActual=stubBacked||enteredActual!=null;if(date>=fromISO&&date<=toISO)out.push({date,schedDate:d,dateOverridden:date!==d,periodStart:period?period.start:'',periodEnd:period?period.end:'',gross:totals.gross,grossWithProposed:totals.grossWithProposed,total:totals.total,unpriced:totals.unpriced,shiftCount:totals.shiftCount,agency:stub.agency||'',facility:stub.facility||'',stubId:stub.id||'',isActual,actual:stubBacked?act.amount:enteredActual,actualBasis:stubBacked?act.basis:(enteredActual!=null?'entered':''),enteredActual:enteredActual!=null,stubBacked});const n=paystubStepDate(d,stub.frequency,anchorDay);if(!n||n<=d)break;d=n}return out}
function paystubOccurrencesOn(dateISO){const claims=paystubShiftClaims();const all=[];for(const s of (db.payStubs||[]))all.push(...paystubOccurrences(s,dateISO,dateISO,claims));all.sort((a,b)=>String(a.agency).localeCompare(String(b.agency)));return all}
function paystubOccurrencesInMonth(prefix){if(!featureOn('featurePaychecks'))return[];const y=+prefix.slice(0,4),m=+prefix.slice(5,7),from=prefix+'-01',to=prefix+'-'+String(psDaysInMonth(y,m)).padStart(2,'0');const claims=paystubShiftClaims();const all=[];for(const s of (db.payStubs||[]))all.push(...paystubOccurrences(s,from,to,claims));all.sort((a,b)=>a.date.localeCompare(b.date)||String(a.agency).localeCompare(String(b.agency)));return all}
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
function paystubUpcoming(limit,todayStr){const today=todayStr||localDate(new Date());const to=psAddDays(today,120);const claims=paystubShiftClaims();const all=[];for(const s of (db.payStubs||[]))all.push(...paystubOccurrences(s,today,to,claims));all.sort((a,b)=>a.date.localeCompare(b.date)||String(a.agency).localeCompare(String(b.agency)));return all.slice(0,limit||6)}
// A paycheck's calculated amount: EVERY priced shift in its period
// (confirmed + proposed — see paystubPeriodTotals). Falls back to the
// proposed-inclusive figure on any occurrence built without `total`.
function paystubOccurrenceTotal(x){if(!x)return 0;if(x.total!=null)return x.total;if(x.grossWithProposed!=null)return x.grossWithProposed;return x.gross||0}
// The amount a paycheck displays: the stub actual for a stub's own
// check, the calculated period total otherwise, null when no shifts
// are recorded for the period yet (never a fake $0 from the stub).
function paystubOccurrenceAmount(x){if(!x)return null;if(x.isActual)return x.actual;return x.shiftCount?paystubOccurrenceTotal(x):null}
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
function paystubPreviewFromParsed(parsed,fileName,method,aiRead){const clean={agency:String(parsed.agency||'').trim(),facility:String(parsed.facility||'').trim(),frequency:normalizePayFrequency(parsed.frequency),periodStart:psValidISO(parsed.periodStart),periodEnd:psValidISO(parsed.periodEnd),payDate:psValidISO(parsed.payDate),gross:rateOrNull(parsed.gross)==null?'':String(rateOrNull(parsed.gross)),net:rateOrNull(parsed.net)==null?'':String(rateOrNull(parsed.net))};return {...clean,id:'',fileName:fileName||'',method:method||'',aiRead:!!aiRead,source:aiRead?'ai-vision':'text-parse',found:(parsed.found||[]).slice()}}
let paystubPreview=null,paystubError='',paystubStatus='',paystubBusy=false;
let paystubPendingImages=[];
function paystubPreviewHTML(){
  if(paystubError)return `<p class="hint">${escapeHTML(paystubError)}</p>`;
  if(!paystubPreview)return '<p class="muted">No pay stub read yet. Upload a photo or PDF, or paste its text below, then check the preview — nothing is saved until you approve it.</p>';
  const p=paystubPreview;
  const ex=p.agency?paystubForAgency(p.agency):null;
  const replaces=ex&&ex.id!==p.id;
  return `<p><strong>Read from:</strong> ${escapeHTML(p.fileName||'pasted text')}</p><p><strong>Nothing is saved yet.</strong> Correct anything wrong below, then save. Fields the stub did not state are left blank — blank means “not stated”, never $0. ${p.found&&p.found.length?('Found: '+escapeHTML(p.found.join(', '))+'.'):''}</p>${replaces?`<p class="hint">This will replace the existing pay schedule for ${escapeHTML(p.agency)} — the old schedule is removed when you save. Other agencies are untouched.</p>`:''}<div class="form-grid"><div class="field"><label for="f_payPrev_agency">Agency / employer *</label><input id="f_payPrev_agency" class="paystubEdit" data-field="agency" type="text" value="${escapeHTML(p.agency||'')}" placeholder="e.g. Premier Anesthesia Group"></div><div class="field"><label for="f_payPrev_facility">Facility (if the stub names one)</label><input id="f_payPrev_facility" class="paystubEdit" data-field="facility" type="text" value="${escapeHTML(p.facility||'')}" placeholder="e.g. Holzer"></div><div class="field"><label for="f_payPrev_frequency">Pay frequency *</label><select id="f_payPrev_frequency" class="paystubEdit" data-field="frequency"><option value="">— choose —</option>${PAY_FREQUENCIES.map(f=>`<option value="${f}" ${f===p.frequency?'selected':''}>${PAY_FREQUENCY_LABELS[f]}</option>`).join('')}</select></div><div class="field"><label for="f_payPrev_payDate">Pay date (this check) *</label><input id="f_payPrev_payDate" class="paystubEdit" data-field="payDate" type="date" value="${escapeHTML(p.payDate||'')}"></div><div class="field"><label for="f_payPrev_periodStart">Pay period start</label><input id="f_payPrev_periodStart" class="paystubEdit" data-field="periodStart" type="date" value="${escapeHTML(p.periodStart||'')}"></div><div class="field"><label for="f_payPrev_periodEnd">Pay period end</label><input id="f_payPrev_periodEnd" class="paystubEdit" data-field="periodEnd" type="date" value="${escapeHTML(p.periodEnd||'')}"></div><div class="field"><label for="f_payPrev_gross">Gross on this stub ($)</label><input id="f_payPrev_gross" class="paystubEdit" data-field="gross" type="number" min="0" step="0.01" value="${escapeHTML(p.gross||'')}" placeholder="Not stated"></div><div class="field"><label for="f_payPrev_net">Net on this stub ($)</label><input id="f_payPrev_net" class="paystubEdit" data-field="net" type="number" min="0" step="0.01" value="${escapeHTML(p.net||'')}" placeholder="Not stated"></div></div><p class="muted">The amounts on this stub are the actual for this check's pay period only — they are never copied onto later checks. Later paychecks are calculated from your shifts in each period.</p><p class="muted" id="paystubNextDates">${escapeHTML(paystubNextDatesText(p))}</p><div class="toolbar" style="margin-top:12px"><button data-action="paystub-approve">Save pay schedule — I checked this</button><button type="button" class="secondary" data-action="paystub-discard">Discard preview (save nothing)</button></div>`;
}
function paystubListHTML(){
  const stubs=(db.payStubs||[]).slice().sort((a,b)=>String(a.agency||'').localeCompare(String(b.agency||'')));
  if(!stubs.length)return '<p class="muted">No pay stubs yet — optional. Add one per agency below and each agency gets its own estimated pay schedule on the calendar.</p>';
  return stubs.map(x=>{
    const next=paystubNextPayDate(x);
    const dates=[];let d=next;for(let i=0;i<3&&d;i++){dates.push(d);const n=paystubStepDate(d,x.frequency,+String(x.payDate||'').slice(8,10));if(!n||n<=d)break;d=n}
    const src=x.source==='ai-vision'?'Read from pay stub with AI':x.source==='device-ocr'?'Read from pay stub on this device':x.source==='text-parse'?'Read from pasted text / PDF':x.source==='manual'?'Entered manually':'Saved pay schedule';
    return `<div class="item"><div><div class="item-title">${escapeHTML(x.agency||'Unnamed agency')}${x.facility?` <span class="muted">(${escapeHTML(x.facility)})</span>`:''}</div><div class="muted">${PAY_FREQUENCY_LABELS[x.frequency]||'Frequency not set'} · Last pay date ${x.payDate?fmt(x.payDate):'not set'}${x.periodStart&&x.periodEnd?` · Period ${fmt(x.periodStart)} – ${fmt(x.periodEnd)}`:''}</div><div class="muted">${(()=>{const act=paystubStubActual(x);return act?`This stub's own check (${x.payDate?fmt(x.payDate):'pay date not set'}): ${currency(act.amount)} ${act.basis} — the actual for its period. Every other paycheck is calculated from your shifts in that period.`:'No amount on this stub — every paycheck is calculated from your shifts in that period.'})()}</div><div class="muted">Next expected pay dates: ${dates.length?dates.map(z=>fmt(z)).join(' · '):'set a pay frequency and pay date to see them'}</div><div class="muted">${escapeHTML(src)}${x.fileName?` · ${escapeHTML(x.fileName)}`:''}</div></div><div class="item-actions"><button class="tiny secondary" data-action="edit-paystub" data-id="${escapeHTML(x.id)}">Edit</button><button class="tiny danger" data-action="delete-paystub" data-id="${escapeHTML(x.id)}">Delete</button></div></div>`;
  }).join('');
}
function paystubPanelHTML(){
  if(!featureOn('featurePaychecks'))return collapsePanelHTML('paystub-panel','Paycheck estimates',featureOffHTML('featurePaychecks'),false);
  const px=db.payStubs.find(x=>x.id===editId)||{};
  return collapsePanelHTML('paystub-panel','Upload a pay stub (optional)',`<p class="muted">One stub per agency — it sets the pay dates, and each paycheck is calculated from your shifts in that period. The stub itself is never stored.</p><form id="paystubForm"><div class="form-grid">${field('paystubFile','Choose a pay stub — photo or PDF (several photos for a multi-page stub)','file','','accept=".pdf,.png,.jpg,.jpeg,.webp,.heic,image/*" multiple')}${area('paystubText','Or paste the pay stub text','','Employer: Premier Anesthesia Group\nPay Period: 10/19/2026 - 11/01/2026\nPay Date: 11/06/2026\nGross Pay: $3,200.00\nNet Pay: $2,400.00')}</div><div class="form-actions"><button type="submit">Read my pay stub</button></div></form>${paystubStatus?`<p class="hint" id="paystubStatus">${escapeHTML(paystubStatus)}</p>`:''}<div style="margin-top:14px">${paystubPreviewHTML()}</div><h3>Saved pay schedules — one per agency</h3>${paystubListHTML()}<details class="collapse-sub" id="paystub-manual"${editId&&px.id?' open':''}><summary class="collapse-head"><span class="collapse-title">${editId&&px.id?'Edit pay schedule':'Add a pay schedule manually'}</span><span class="collapse-chevron" aria-hidden="true">▾</span></summary><form id="entryForm" data-kind="payStubs"><div class="form-grid">${field('agency','Agency / employer','text',px.agency||'','required')}${field('facility','Facility (if it applies)','text',px.facility||'')}${select('frequency','Pay frequency',PAY_FREQUENCIES,px.frequency||'')}${field('payDate','Pay date (this check)','date',px.payDate||'','required')}${field('periodStart','Pay period start','date',px.periodStart||'')}${field('periodEnd','Pay period end','date',px.periodEnd||'')}${field('gross','Gross on this check ($)','number',px.gross??'','min="0" step="0.01"')}${field('net','Net on this check ($)','number',px.net??'','min="0" step="0.01"')}</div><p class="muted">Amounts belong to this check only — later paychecks are calculated from your shifts.</p>${formEnd(editId&&px.id?'Save pay schedule':'Add pay schedule')}</details>`,!!(paystubPreview||paystubError||paystubStatus||(editId&&px.id)));
}
function paystubPaycheckLineHTML(x){
  if(x.isActual&&x.actualBasis==='entered')return `<div class="muted">${currency(x.actual)} actual · entered from calendar <span class="pill">actual</span></div>${x.shiftCount?`<div class="muted">Your shifts for ${fmt(x.periodStart)} – ${fmt(x.periodEnd)} added up to ${currency(paystubOccurrenceTotal(x))} — the amount you entered replaces the estimate for this check only.</div>`:`<div class="muted">No shifts recorded for ${fmt(x.periodStart)} – ${fmt(x.periodEnd)} — the amount you entered is counted for this check.</div>`}`;
  if(x.isActual)return `<div class="muted">${currency(x.actual)} actual · from pay stub <span class="pill">actual</span></div>${x.shiftCount?`<div class="muted">Your shifts for ${fmt(x.periodStart)} – ${fmt(x.periodEnd)} added up to ${currency(paystubOccurrenceTotal(x))} — the stub is the actual for this period.</div>`:`<div class="muted">No shifts recorded for ${fmt(x.periodStart)} – ${fmt(x.periodEnd)} — this is income the calendar didn't see, counted from the stub alone.</div>`}`;
  if(!x.shiftCount)return `<div class="muted">No shifts recorded for this pay period yet — its amount is calculated once shifts are on the calendar. <span class="pill">estimate</span></div>`;
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
  const stub=(db.payStubs||[]).find(s=>s.id===stubId);if(!stub||!psValidISO(schedDate))return null;
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
  return `<div class="sheet-backdrop sheet-backdrop-over" data-action="shift-delete-cancel"></div><div class="sheet sheet-over" role="dialog" aria-label="Delete shift"><div class="sheet-head"><h2>Delete this shift?</h2><button type="button" class="sheet-close" data-action="shift-delete-cancel" aria-label="Close">×</button></div><p><strong>${fmt(x.date)}</strong> · ${escapeHTML(x.facility||'')} · ${escapeHTML(x.type||'')}</p><p class="muted">${line}</p>${box}<div class="toolbar"><button type="button" class="danger" data-action="shift-delete-confirm" data-id="${escapeHTML(x.id)}">Delete shift</button><button type="button" class="secondary" data-action="shift-delete-cancel">Cancel</button></div></div>`;
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
  return `<section class="panel"><h2>Credential deadlines</h2><p class="muted">Deadlines from your records — portal-pulled records are labelled with their source on the Credentials tab; the rest are user-entered, not verified. <a href="https://www.nbcrna.com/" target="_blank" rel="noopener">NBCRNA</a> · <a href="https://www.aana.com/" target="_blank" rel="noopener">AANA</a></p>${items.length?items.map(x=>`<div class="item"><strong>${escapeHTML(x.label)}</strong> · ${fmt(x.date)} <span class="${x.days<0?'expired':x.days<=7?'expired':x.days<=30?'warning':'success'}">${x.days<0?('Expired '+Math.abs(x.days)+' days ago'):(x.days===0?'Due today':('Due in '+x.days+' days'))}</span><div class="muted">${escapeHTML(x.source)}</div></div>`).join(''):'<p class="muted">No credential deadlines within their reminder windows.</p>'}</section>`;
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
  if(/credential|license|nbcrna|aana|expir/.test(l)){const d=credentialDeadlines();if(!d.length)return 'No credential deadlines are inside their reminder windows right now, based on the records on this device. Check the Credentials tab to confirm your NBCRNA, AANA, and state license dates are entered.';return `Credentials needing attention: ${d.slice(0,8).map(x=>`${x.label} — ${fmt(x.date)} (${x.days<0?('expired '+Math.abs(x.days)+' days ago'):x.days===0?'due today':('due in '+x.days+' days')})`).join('; ')}. Records a portal pull brought back are labelled with their source; the rest are user-entered and not verified by NBCRNA, AANA, or a state board.`}
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
  licenses:{title:'State Licenses',short:'a state license',url:'https://www.nursys.com/',siteLabel:'your state board lookup (via Nursys)',
    what:'license status, license type (RN / APRN), license number, issue date, and expiration date',
    how:'Open your state board\u2019s license lookup (or Nursys), look yourself up, and screenshot the result page that shows your license.',
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
  nbcrna:[['status','Certification status'],['number','License / certification number'],['periodStart','Certification period start'],['periodEnd','Certification period end'],['renewalDeadline','Renewal / recertification deadline'],['classA','Class A credits'],['classB','Class B credits'],['macEd','MAC Ed credits'],['macDev','MAC Dev credits']],
  aana:[['status','Membership status'],['number','Membership number'],['expiration','Membership expiration'],['classA','Class A credits'],['classB','Class B credits']],
  licenses:[['status','License status'],['number','License / certification number'],['type','License type'],['issue','Issue date'],['expiry','Expiration date']]
};
const PORTAL_NAV_MAPS={
  nbcrna:{required:['status','periodEnd'],pages:[
    {key:'record',name:'certification record',direction:'Open your certification record — that’s the page I need.',fields:['status','number','periodStart','periodEnd','renewalDeadline']},
    {key:'progress',name:'CPC progress',direction:'Now open your CPC progress — that’s the page I need.',fields:['classA','classB','macEd','macDev']}]},
  aana:{required:['status','expiration'],pages:[
    {key:'membership',name:'membership page',direction:'Open your membership page — that’s the page I need.',fields:['status','number','expiration']},
    {key:'transcript',name:'CE transcript',direction:'Now open your CE transcript — that’s the page I need.',fields:['classA','classB']}]},
  licenses:{required:['status','expiry'],pages:[
    {key:'license',name:'license lookup result',direction:'Open your license lookup result — that’s the page I need.',fields:['status','number','type','issue','expiry']}]}
};
function portalNavMap(source){ return PORTAL_NAV_MAPS[source]||{required:[],pages:[{key:'record',name:'record page',direction:'Open the page that lists your record — that’s the page I need.',fields:[]}]}; }
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
  if(!mon.lastChecked)due=today;
  else due=addDaysStr(String(mon.lastChecked).slice(0,10),monitorCadence(mon));
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
      db.portalMonitoring.push({key,source,state:state||'',type:type||'',label:'',enabled:true,cadenceDays:7,lastChecked:'',lastOutcome:'',lastSummary:'',lastMethod:'',changeFlag:false,firstName:'',lastName:''});
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
  if(source==='nbcrna'){const n=db.nbcrna||{};return [n.status,n.number,n.periodStart,n.periodEnd,n.renewalDeadline,n.classA,n.classB,n.macEd,n.macDev].map(v=>String(v??'')).join('|')}
  if(source==='aana'){const a=db.aana||{};return [a.status,a.number,a.expiration].map(v=>String(v??'')).join('|')}
  const lic=(db.licenses||[]).find(x=>String(x.state||'')===String(state||'')&&String(x.type||'').toUpperCase()===String(type||'APRN').toUpperCase());
  return lic?[lic.status||'',lic.number,lic.issue,lic.expiry].map(v=>String(v??'')).join('|'):'';
}
function monitorSnapshotChanged(before,after){return String(before||'')!==String(after||'')}
function recordMonitorCheck(key,outcome,summary,method){
  const mons=ensurePortalMonitoring();
  const mon=mons.find(m=>m.key===key);if(!mon)return null;
  const when=cloudNow();
  mon.lastChecked=when;mon.lastOutcome=outcome;mon.lastSummary=summary||'';mon.lastMethod=method||'';
  mon.snoozeUntil='';mon.promptDismissedCycle='';mon.autoAttemptCycle='';
  if(outcome==='changed')mon.changeFlag=true;
  db.portalChecks=[{source:mon.source,state:mon.state||'',retrievedAt:when,status:outcome,summary:summary||''},...(db.portalChecks||[])].slice(0,20);
  persist();
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
  return collapsePanelHTML('credentials-monitoring-panel',monTitle,`<p class="muted">Checks run on their own every 7 days — faster near renewal. If a check needs your sign-in, you get one prompt here. We never store a portal password.</p>${mons.map(m=>{const cad=monitorCadence(m),next=monitorNextDue(m,today),isDue=monitorIsDue(m,today),prompt=monitorPromptVisible(m,today);return `<div class="item"><strong>${escapeHTML(m.label)}</strong> · ${m.enabled?'Monitoring on':'Paused'} · every ${cad} day${cad>1?'s':''}${cad!==monitorBaseCadence(m)?' (faster — renewal is near)':''}<div class="muted">Last checked: ${m.lastChecked?fmt(String(m.lastChecked).slice(0,10)):'never'} · Next due: ${fmt(next)}${isDue?' · <strong>due now</strong>':''} · Outcome: ${escapeHTML(monitorOutcomeLabel(m.lastOutcome))}${m.lastSummary?` — ${escapeHTML(m.lastSummary)}`:''}</div>${prompt?monitorDuePromptHTML(m):''}<div class="toolbar">${isDue&&monitorMethod(m)!=='public'?`<button type="button" class="secondary" data-action="monitor-assistant" data-id="${escapeHTML(m.key)}">Check with assistant</button>`:''}<button type="button" class="secondary" data-action="monitor-toggle" data-id="${escapeHTML(m.key)}">${m.enabled?'Pause monitoring':'Resume monitoring'}</button>${m.changeFlag?`<button type="button" class="secondary" data-action="monitor-ack" data-id="${escapeHTML(m.key)}">Mark change reviewed</button>`:''}</div><details><summary class="muted">Cadence</summary><form data-kind="monitor-cadence"><input type="hidden" name="key" value="${escapeHTML(m.key)}"><div class="form-grid"><div class="field"><label>Base cadence</label><select name="cadenceDays">${[1,3,7,14].map(v=>`<option value="${v}" ${monitorBaseCadence(m)===v?'selected':''}>Every ${v} day${v>1?'s':''}${v===7?' (weekly)':''}</option>`).join('')}</select></div></div><div class="form-actions"><button type="submit">Save cadence</button></div></form></details></div>`}).join('')}${log.length?`<h3>Monitoring log</h3>${log.map(c=>`<div class="item"><strong>${escapeHTML((PORTAL_CHECK_SOURCES[c.source]||{}).short||c.source)}</strong> · ${c.retrievedAt?fmt(String(c.retrievedAt).slice(0,10)):''} · ${escapeHTML(monitorOutcomeLabel(c.status))}<div class="muted">${escapeHTML(c.summary||'')}</div></div>`).join('')}`:'<p class="muted">No checks logged yet — they will appear here as monitoring runs.</p>'}` ,monOpen);
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
// lastChecked only moves when a check actually ran. Nothing is faked.
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
    :[/(?:certification|certificate|license|lic\.?)\s*(?:no\.?|number|#)\s*[:#]?\s*([A-Za-z0-9][A-Za-z0-9-]{3,19})/i,
      /(?:cert|lic)\s*#\s*[:#]?\s*([A-Za-z0-9][A-Za-z0-9-]{3,19})/i];
  for(const re of pats){ const m=t.match(re); if(m) return m[1]; }
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
    take('macEd','MAC Ed credits',portalCheckCredits(t,'MAC\\s*Ed(?:ucation)?(?:\\s+credits?)?'));
    take('macDev','MAC Dev credits',portalCheckCredits(t,'MAC\\s*Dev(?:elopment)?(?:\\s+credits?)?'));
  } else if(source==='aana'){
    const exp=extractExpiryDateInfo(t,opts);
    take('expiration','Membership expiration',exp.iso||'');
    take('classA','Class A credits',portalCheckCredits(t,'class\\s*A(?:\\s+credits?)?'));
    take('classB','Class B credits',portalCheckCredits(t,'class\\s*B(?:\\s+credits?)?'));
  } else {
    take('type','License type',/\bAPRN\b/i.test(t)?'APRN':(/\bRN\b/i.test(t)?'RN':''));
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
  if(source==='nbcrna') return field('status','Certification status','text',f.status||'')+field('number','Certification number','text',f.number||'')+field('periodStart','Certification period start','date',f.periodStart||'')+field('periodEnd','Certification period end','date',f.periodEnd||'')+field('renewalDeadline','Renewal / recertification deadline','date',f.renewalDeadline||f.periodEnd||'')+field('classA','Class A credits','number',f.classA??'','min="0" step="0.25"')+field('classB','Class B credits','number',f.classB??'','min="0" step="0.25"')+field('macEd','MAC Ed credits','number',f.macEd??'','min="0" step="1"')+field('macDev','MAC Dev credits','number',f.macDev??'','min="0" step="1"');
  if(source==='aana') return field('status','Membership status','text',f.status||'')+field('number','Membership number','text',f.number||'')+field('expiration','Membership expiration','date',f.expiration||'')+field('classA','Class A credits','number',f.classA??'','min="0" step="0.25"')+field('classB','Class B credits','number',f.classB??'','min="0" step="0.25"');
  return select('state','State',US_STATES,f.state||(portalCheck&&portalCheck.state)||'West Virginia')+select('type','License type',['RN','APRN'],f.type||'APRN')+field('number','License number','text',f.number||'')+field('issue','Issue date','date',f.issue||'')+field('expiry','Expiration date','date',f.expiry||'','required');
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
    inner=`<h3>${m.title} — step ${stepNo} of ${stepCount}</h3><p><strong>${escapeHTML(page.direction)}</strong></p><p class="muted">📸 On your phone: screenshot that page over there, come back to this tab, then upload it below.</p><p class="muted">No screenshot handy? Paste the page's text below instead.</p>${portalCheck.notice?`<p class="hint">${escapeHTML(portalCheck.notice)}</p>`:''}<div class="item"><strong>Your record so far</strong>${rows}</div><form data-kind="portal-check"><div class="form-grid">${portalCheck.source==='licenses'?select('state','State',US_STATES,portalCheck.state||'West Virginia'):''}${field('shotFile','Screenshot of that page (PNG/JPG)','file','','accept=".png,.jpg,.jpeg,.webp,.heic,image/*"')}${area('pasted','Or paste that page’s text','','Status: Certified\nCertification expires: June 30, 2028')}</div><div class="form-actions"><button type="submit">Read it</button>${stepCount>1?`<button type="button" class="secondary" data-action="portal-guide-skip">Skip this page</button>`:''}${(portalCheck.pagesShown||0)>0?`<button type="button" class="secondary" data-action="portal-guide-finish">That’s everything — show my report</button>`:''}<button type="button" class="secondary" data-action="portal-check-cancel">Cancel</button></div></form>${portalCheckOcrStatus?`<p class="hint" id="portalCheckOcrStatus">${escapeHTML(portalCheckOcrStatus)}</p>`:''}${portalCheckError?`<p class="hint">${escapeHTML(portalCheckError)}</p>`:''}`;
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
  const map={status:'status',number:'number',periodStart:'period_start',periodEnd:'period_end',renewalDeadline:'renewal_deadline',classA:'class_a',classB:'class_b',macEd:'mac_ed',macDev:'mac_dev',expiration:'expiration',type:'license_type',issue:'issue_date',expiry:'expiry',state:'state'};
  for(const k of Object.keys(map)){
    const v=portal?portal[map[k]]:null;
    if(v!==null&&v!==undefined&&String(v).trim()!=='') fields[k]=String(v);
  }
  const fm=portalCheckFoundMissing(source,fields);
  return {fields,found:fm.found,missing:fm.missing};
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
        let aiParsed=null, aiFailed=false;
        try{
          const data=await callExtractPortalCheck([file],portalCheck.source);
          aiParsed=portalCheckFieldsFromAi(data.portal||{},data.raw_text||'',portalCheck.source);
        }catch(aiErr){ aiFailed=true; }
        if(aiParsed){
          portalCheckOcrStatus='';
          portalGuideIngest(aiParsed,'ai',state);
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
  const keep=(cur)=>PORTAL_VERIFIED_SOURCES.includes(cur&&cur.source)?cur.source:'assistant_portal_check';
  if(source==='nbcrna'){
    const cur=db.nbcrna||{};
    db.nbcrna={...cur,status:f.status||cur.status||'',number:f.number||cur.number||'',periodStart:f.periodStart||cur.periodStart||'',periodEnd:f.periodEnd||cur.periodEnd||'',renewalDeadline:f.renewalDeadline||f.periodEnd||cur.renewalDeadline||'',classA:f.classA!==undefined?f.classA:(cur.classA??''),classB:f.classB!==undefined?f.classB:(cur.classB??''),macEd:f.macEd!==undefined?f.macEd:(cur.macEd??''),macDev:f.macDev!==undefined?f.macDev:(cur.macDev??''),macEdRequired:cur.macEdRequired||60,macDevRequired:cur.macDevRequired||40,docNote:cur.docNote||'',ceNote:cur.ceNote||'',reminders:cur.reminders||'90,60,30,7',source:keep(cur),updatedAt:new Date().toISOString()};
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
    Object.assign(existing,{number:f.number||existing.number||'',issue:f.issue||existing.issue||'',expiry:f.expiry||existing.expiry||'',source:keep(existing),reminders:existing.reminders||'90,60,30,7'});
  } else {
    recId=id();
    (db.licenses=db.licenses||[]).push({id:recId,state,type,number:f.number||'',issue:f.issue||'',expiry:f.expiry||'',portal:'',note:'',source:'assistant_portal_check',reminders:'90,60,30,7'});
  }
  cloudSaveKind('licenses',recId);
  return state+' '+type+' '+(f.number||'')+' · expires '+(f.expiry||'unknown');
}
function approvePortalCheck(e){
  const f=Object.fromEntries(new FormData(e.currentTarget));
  const source=f.source||(portalCheck&&portalCheck.source);
  if(!source) return;
  const fields={};
  for(const k of ['status','number','periodStart','periodEnd','renewalDeadline','classA','classB','macEd','macDev','expiration','state','type','issue','expiry'])
    if(String(f[k]||'').trim()) fields[k]=String(f[k]).trim();
  if(!Object.keys(fields).length){ alert('Nothing to save — every field is blank. Fill in at least one detail, or discard this check.'); return; }
  const when=(portalCheck&&portalCheck.retrievedAt)||cloudNow();
  const monKey=monitorKey(source,fields.state||(portalCheck&&portalCheck.state)||'',fields.type||'APRN');
  const beforeSnap=monitorSnapshot(source,fields.state||(portalCheck&&portalCheck.state)||'',fields.type||'APRN');
  const summary=applyPortalCheckRecord(source,fields,when);
  const changed=monitorSnapshotChanged(beforeSnap,monitorSnapshot(source,fields.state||(portalCheck&&portalCheck.state)||'',fields.type||'APRN'));
  recordMonitorCheck(monKey,changed?'changed':'no_change',(changed?'Changed on assistant check — ':'Checked, no change — ')+summary,'signed_in');
  portalCheck=null; portalCheckError=''; portalCheckOcrStatus=''; portalStatePersist(); persist(); render();
  alert('Saved from the assistant portal check ('+String(when).slice(0,10)+'): '+summary+'\n\nSource: assistant portal check — read from the portal page you showed the assistant. It is not a server portal pull, and nothing was stored from your sign-in.');
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
  return assistantFabHTML()+assistantSheetHTML();
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
function render(){ captureMileageLogDraft(); if(window.__crnaBootWatch){clearTimeout(window.__crnaBootWatch);window.__crnaBootWatch=null} const ss=$('storageStatus');if(ss)ss.textContent=cloudHeaderLabel();$('nav').innerHTML=tabs.map(t=>`<button class="${tab===t?'active':''}" data-tab="${escapeHTML(t)}">${escapeHTML(t)}</button>`).join('');$('app').innerHTML=({Dashboard:dashboard,Facilities:facilitiesPage,Credentials:credentialsPage,Mileage:mileagePage,Assistant:assistantPage,Account:accountPage}[tab]||dashboard)()+assistantOverlayHTML();document.querySelectorAll('[data-tab]').forEach(b=>b.addEventListener('click',()=>setTab(b.dataset.tab)));document.querySelectorAll('[data-action]').forEach(b=>b.addEventListener('click',()=>actions(b.dataset.action,b.dataset.id,b.dataset.date,b.dataset.from)));document.querySelectorAll('[data-portal-connect]').forEach(a=>a.addEventListener('click',e=>portalConnectClick(a.dataset.portalConnect,e)));document.querySelectorAll('[data-shift-status]').forEach(el=>el.addEventListener('change',()=>{setShiftStatus(el.dataset.shiftStatus,el.value)}));document.querySelectorAll('[data-shift-origin]').forEach(el=>el.addEventListener('change',()=>{setShiftTripOrigin(el.dataset.shiftOrigin,el.value)}));document.querySelectorAll('form[data-kind]').forEach(f=>f.addEventListener('submit',submitEntry));const mt=$('manualTypeSelect');if(mt)mt.addEventListener('change',()=>{manualType=mt.value;editId=null;render();});const ssy=$('savedShiftsYear');if(ssy)ssy.addEventListener('change',()=>{savedShiftsYear=+ssy.value;render();});const dac=$('f_deleteAlsoFromCalendar');if(dac)dac.addEventListener('change',()=>{if(shiftDeleteConfirm)shiftDeleteConfirm.also=!!dac.checked});const mrw=$('mileageReviewWeekSelect');if(mrw)mrw.addEventListener('change',()=>{mileageReviewWeek=mrw.value;render();});const mrv=$('mileageReviewVehicleSelect');if(mrv)mrv.addEventListener('change',()=>{const wk=selectedMileageReviewWeek();mileageReviewVehicleWeek=wk;mileageReviewVehicleId=mrv.value;});const mlm=$('mileageLogMonthSelect');if(mlm)mlm.addEventListener('change',()=>{mileageLogMonth=mlm.value;render();});const mey=$('mileageExportYearSelect');if(mey)mey.addEventListener('change',()=>{mileageExportYear=mey.value;mileageExportSel=new Set();render();});document.querySelectorAll('.mileageExportMonth').forEach(el=>el.addEventListener('change',()=>{if(el.checked)mileageExportSel.add(el.value);else mileageExportSel.delete(el.value);const tot=$('mileageExportTotals');if(tot)tot.textContent=mileageExportTotalsLine();const dl=document.querySelector('[data-action="mileage-export-download"]');if(dl)dl.disabled=!mileageExportSelected().length;}));const schedForm=$('scheduleForm');if(schedForm)schedForm.addEventListener('submit',importSchedule);const qf=$('qgendaForm');if(qf)qf.addEventListener('submit',saveQgendaFeed);if(tab==='Account'||tab==='Facilities')qgendaStatusRefresh();const restore=$('restoreFile');if(restore)restore.addEventListener('change',restoreBackup);const facilityContractForm=$('facilityContractForm');if(facilityContractForm)facilityContractForm.addEventListener('submit',importFacilityContract);const paystubForm=$('paystubForm');if(paystubForm)paystubForm.addEventListener('submit',importPaystub);const ruleChatForm=$('ruleChatForm');if(ruleChatForm)ruleChatForm.addEventListener('submit',submitRuleChat);document.querySelectorAll('.ruleEdit').forEach(el=>el.addEventListener('change',()=>{if(!ruleChatPreview)return;ruleChatPreview.rates[el.dataset.field]=el.value;render()}));document.querySelectorAll('.paystubEdit').forEach(el=>el.addEventListener('change',()=>{if(!paystubPreview)return;paystubPreview[el.dataset.field]=el.value;const nd=$('paystubNextDates');if(nd)nd.textContent=paystubNextDatesText(paystubPreview)}));document.querySelectorAll('.cropRegionSelect').forEach(el=>{const k=el.dataset.kind+':'+el.dataset.i;if(cropRegionByPage[k])el.value=cropRegionByPage[k];el.addEventListener('change',()=>{cropRegionByPage[k]=el.value})});document.querySelectorAll('.facContractEdit').forEach(el=>el.addEventListener('change',()=>{if(!facilityContractPreview)return;const f=facilityContractPreview.facilities[+el.dataset.i];if(!f)return;if(FACILITY_RATE_KEYS.includes(el.dataset.field)){f.rates=f.rates||{};f.rates[el.dataset.field]=el.value}else f[el.dataset.field]=el.value}));document.querySelectorAll('.facContractInclude').forEach(el=>el.addEventListener('change',()=>{if(!facilityContractPreview)return;const f=facilityContractPreview.facilities[+el.dataset.i];if(f)f.include=el.checked}));const calendarForm=$('calendarForm');if(calendarForm)calendarForm.addEventListener('submit',importCalendar);document.querySelectorAll('.calEdit').forEach(el=>el.addEventListener('change',()=>{if(!calPreview)return;const r=calPreview.rows[+el.dataset.row];if(r)r[el.dataset.field]=el.value}));document.querySelectorAll('.calInclude').forEach(el=>el.addEventListener('change',()=>{if(!calPreview)return;const r=calPreview.rows[+el.dataset.row];if(r)r.include=el.checked}));document.querySelectorAll('.schedEdit').forEach(el=>el.addEventListener('change',()=>{if(!schedulePreview)return;const r=schedulePreview.rows[+el.dataset.row];if(r)r[el.dataset.field]=el.value}));document.querySelectorAll('.schedInclude').forEach(el=>el.addEventListener('change',()=>{if(!schedulePreview)return;const r=schedulePreview.rows[+el.dataset.row];if(r)r.include=el.checked}));const af=$('assistantForm');if(af)af.addEventListener('submit',submitAssistant);if(assistantSheetOpen){const ai=$('assistantInput');if(ai&&ai.focus)ai.focus();const sc=document.querySelector('.assistant-sheet .chat');if(sc)sc.scrollTop=sc.scrollHeight;}const cf=$('cloudAuthForm');if(cf)cf.addEventListener('submit',submitCloudAuth);const mi=$('f_miles');if(mi)mi.addEventListener('change',()=>{const s=$('f_milesSource');if(s&&s.value==='auto'){s.value='manual-override';const st=$('mileageCalcStatus');if(st)st.textContent='Miles edited — this trip is now your manual override of the auto-calculated distance.'}});const tt=$('f_tripType');if(tt)tt.addEventListener('change',()=>{const owEl=$('f_oneWayMiles'),milesEl=$('f_miles'),srcEl=$('f_milesSource'),t=tt.value==='one-way'?'one-way':'round-trip';let m=null;const ow=owEl&&Number(owEl.value)>0?Number(owEl.value):null;if(ow!=null&&srcEl&&srcEl.value==='auto')m=tripMilesFor(ow,t);else if(milesEl&&Number(milesEl.value)>0)m=t==='one-way'?Math.round(Number(milesEl.value)/2*10)/10:roundTripMiles(milesEl.value);if(m!=null&&milesEl){milesEl.value=String(m);const st=$('mileageCalcStatus');if(st){st.textContent='Mileage type changed — miles updated to '+m.toFixed(1)+' mi '+tripTypeLabel(t)+'.';mileageCalcStatus=st.textContent}}});const mtt=$('mileageTripTypeSelect');if(mtt)mtt.addEventListener('change',()=>{db.settings.mileageTripType=mtt.value==='one-way'?'one-way':'round-trip';persist();render();});const di=$('f_distance');if(di)di.addEventListener('change',()=>{const s=$('f_distanceSource');if(s&&s.value==='auto'){s.value='manual';const st=$('facilityDistanceStatus');if(st)st.textContent='Distance edited — now saved as a manual distance.'}})}
function field(name,label,type='text',value='',extra=''){return `<div class="field"><label for="f_${name}">${label}</label><input id="f_${name}" name="${name}" type="${type}" value="${escapeHTML(value)}" ${extra}></div>`}
function area(name,label,value='',placeholder=''){return `<div class="field wide"><label for="f_${name}">${label}</label><textarea id="f_${name}" name="${name}" placeholder="${escapeHTML(placeholder)}">${escapeHTML(value)}</textarea></div>`}
function select(name,label,options,value){return `<div class="field"><label for="f_${name}">${label}</label><select name="${name}" id="f_${name}">${options.map(o=>`<option value="${escapeHTML(o)}" ${o===value?'selected':''}>${escapeHTML(o)}</option>`).join('')}</select></div>`}
function selectLabeled(name,label,pairs,value){return `<div class="field"><label for="f_${name}">${label}</label><select name="${name}" id="f_${name}">${pairs.map(([v,l])=>`<option value="${escapeHTML(v)}" ${v===value?'selected':''}>${escapeHTML(l)}</option>`).join('')}</select></div>`}
function formEnd(label){return `<div class="form-actions"><button type="submit">${label}</button>${editId?'<button type="button" class="secondary" data-action="cancel">Cancel</button>':''}</div></form>`}
function list(kind,items,description){return items.length?items.map(x=>`<div class="item"><div>${description(x)}</div><div class="item-actions"><button class="tiny secondary" data-action="edit-${kind}" data-id="${escapeHTML(x.id)}">Edit</button><button class="tiny danger" data-action="delete-${kind}" data-id="${escapeHTML(x.id)}">Delete</button></div></div>`).join(''):'<p class="muted">No records yet.</p>'}
function calendar(){const y=month.getFullYear(),m=month.getMonth(),prefix=`${y}-${String(m+1).padStart(2,'0')}`,start=new Date(y,m,1).getDay(),days=new Date(y,m+1,0).getDate();let grid=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(x=>`<div class="weekday">${x}</div>`).join('');for(let n=0;n<start;n++)grid+='<div class="day blank"></div>';const paysByMonth=paystubOccurrencesInMonth(prefix);for(let n=1;n<=days;n++){const date=`${prefix}-${String(n).padStart(2,'0')}`,entries=db.shifts.filter(x=>x.date===date),pays=paysByMonth.filter(p=>p.date===date);grid+=`<button class="day ${date===localDate(new Date())?'today':''} ${date===selected?'selected':''}" data-action="day" data-date="${date}" aria-label="${fmt(date)}: ${entries.length} shifts${pays.length?`, ${pays.length} estimated paycheck(s)`:''}"><span class="day-number">${n}</span>${entries.slice(0,3).map(x=>`<span class="chip ${/24.hour/i.test(x.type)?'call':/second/i.test(x.type)?'second':/off|pto/i.test(x.type)?'off':''}">${escapeHTML(x.facility||'Off')}<br>${escapeHTML(x.type||'Shift')}</span>`).join('')}${pays.slice(0,2).map(p=>{const amt=paystubOccurrenceAmount(p);return `<span class="chip paycheck" title="${p.isActual?`Paycheck — ${escapeHTML(p.agency)} — ${currency(p.actual)} actual ${p.actualBasis==='entered'?'you entered from the calendar':'from your pay stub'} for ${fmt(p.periodStart)} – ${fmt(p.periodEnd)}.`:`Estimated paycheck — ${escapeHTML(p.agency)} — calculated from your shifts in ${fmt(p.periodStart)} – ${fmt(p.periodEnd)}${p.shiftCount?`: ${currency(paystubOccurrenceTotal(p))} gross${p.unpriced?`, ${p.unpriced} shift(s) not priced yet — may be low`:''}`:' — no shifts recorded for this period yet'}. Always double-check against your actual paystubs.`}">💰 ${escapeHTML(p.agency||'Paycheck')}<br>${p.isActual?'actual '+currency(p.actual):amt!=null?'est. '+currency(amt):'payday'}</span>`}).join('')}${entries.length+pays.length>3?`<span class="muted">+${entries.length+pays.length-3}</span>`:''}</button>`}const shifts=db.shifts.filter(x=>x.date?.startsWith(prefix));const head=monthHeadline(prefix);const bannerQual=head.anyActual?'incl. actual from pay stub':head.partial?'paychecks + other shifts':'';const banner=`<div class="month-banner"><span>${month.toLocaleDateString('en-US',{month:'long',year:'numeric'})}</span><span>Expected gross <strong>${currency(head.gross)}</strong>${bannerQual?` <span class="mb-qual">· ${bannerQual}</span>`:''}</span></div>`;return `<section class="panel"><div class="toolbar"><button class="secondary" data-action="prev" aria-label="Previous month">‹</button><h2>${month.toLocaleDateString('en-US',{month:'long',year:'numeric'})}</h2><button class="secondary" data-action="next" aria-label="Next month">›</button><button class="secondary tiny" data-action="today">Today</button></div>${banner}<div class="calendar">${grid}</div><p class="muted">${shifts.length} shifts · Tap a day to see its shifts, add one, or delete one</p>${paysByMonth.length?`<p class="muted">💰 = paycheck calculated from your shifts in its pay period (a stub's own check shows its actual) — ${PAYSTUB_DISCLAIMER}</p>`:''}</section>`}

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

function dashboard(){const now=localDate(new Date()),prefix=now.slice(0,7),current=db.shifts.filter(x=>x.date?.startsWith(prefix)),gross=monthHeadline(prefix).gross,upcoming=db.shifts.filter(x=>x.date>=now).sort((a,b)=>a.date.localeCompare(b.date)).slice(0,6),expiring=credentialDeadlines().length,ytdSplit=reconciledYearSplit(currentYear());return `<section class="panel"><h2>Overview · ${new Date().toLocaleDateString('en-US',{month:'long',year:'numeric'})}</h2><div class="stats"><div class="stat"><strong>${current.length}</strong>Shifts this month</div><div class="stat"><strong>${currency(gross)}</strong>Expected gross · this month (all statuses)</div><div class="stat"><strong>${db.facilities.length}</strong>Facilities</div>${featureOn('featureCredentials')?`<div class="stat"><strong>${expiring}</strong>Credential deadlines (90 days)</div>`:''}</div></section>${dashboardFacilitySuggestionsHTML()}${dashboardQgendaNoticeHTML()}${onboardingHTML()}${calendar()}${dayViewHTML()}${paystubUpcomingHTML()}${incomeCSPHTML(currentYear(),ytdSplit)}<div class="two"><section class="panel"><h2>Upcoming shifts</h2>${upcoming.length?upcoming.map(x=>`<div class="item"><strong>${fmt(x.date)}</strong> · ${escapeHTML(x.facility)}<div class="muted">${escapeHTML(x.type)} · ${x.pay===''||x.incomplete?'Pay not yet priced':currency(x.pay)} · ${shiftStatusLabel(x.status)}</div></div>`).join(''):'<p class="muted">No upcoming shifts.</p>'}</section><section class="panel"><h2>Quick actions</h2><div class="toolbar"><button data-action="add-shift">Add shift</button><button class="secondary" data-action="export-shifts">Export shifts</button><button class="secondary" data-action="backup">Back up data</button><button class="secondary" data-action="ask-assistant">Ask Assistant</button></div><p class="hint">${cloudModeHint()} Export backups regularly.</p></section></div>${shiftFormOverlayHTML()}${paycheckOverlayHTML()}${shiftDeleteOverlayHTML()}`}
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
function shiftFormHTML(){const x=db.shifts.find(x=>x.id===editId)||{},f=db.facilities;const statusField=editId?select('status','Status',SHIFT_STATUSES,normalizeShiftStatus(x.status)):manualStatusPickerHTML();return `<section class="panel"><h2>${editId?'Edit':'Add'} shift</h2><form id="entryForm" data-kind="shifts"><div class="form-grid">${field('date','Date','date',x.date||selected,'required')}${field('facility','Hospital / facility','text',x.facility||'','list="facilityNames" required')}<datalist id="facilityNames">${f.map(a=>`<option value="${escapeHTML(a.name)}"></option>`).join('')}</datalist>${select('type','Shift type',['8-hour day','12-hour shift','24-hour call','Second call','Other','Off / PTO'],x.type||'8-hour day')}${statusField}${field('pay','Expected gross pay ($)','number',x.pay??'','min="0" step="0.01" placeholder="Auto from facility"')}${area('note','Shift notes',x.note||'')}</div>${formEnd(editId?'Save changes':'Add shift')}${editId?'':''}<p class="muted">Leave pay blank to use the saved facility rate.</p>${!employmentIncludes1099()?'<p class="muted">Employment type: W-2 only — pay entered here is not counted as billable income, because your pay comes as salary. Off / PTO days are salary days.</p>':''}${editId?'<p class="muted">Changing the status re-prices the totals right away.</p>':'<p class="muted">Shifts you sync or import arrive Confirmed on their own — this choice is only for shifts you add by hand.</p>'}${editId?'':'<div class="toolbar"><button type="button" class="secondary" data-action="cancel">Close form</button></div>'}</section>`}
function dayViewHTML(){
  if(!dayViewOpen)return '';
  const rows=db.shifts.filter(x=>x.date===selected).slice().sort((a,b)=>String(a.facility||'').localeCompare(String(b.facility||'')));
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
  return `${head}${paysSection}${list('shifts',rows,x=>`<div class="item-title">${escapeHTML(x.facility)}</div><div class="muted">${escapeHTML(x.type)} · ${x.pay===''||x.incomplete?'Pay not yet priced — incomplete':currency(x.pay)}${isW2SalaryShift(x)?' · <span class="pill">W-2 salary day — excluded from income totals</span>':''}${x.source==='extracted-from-contract'?' · <span class="pill">from contract</span>':x.source==='extracted-from-contract-photo'?' · <span class="pill">from contract photo</span>':x.source==='user-entered'?' · <span class="pill">user-entered</span>':x.source&&x.source.startsWith('calendar-')?' · <span class="pill">'+escapeHTML({"calendar-google":"from Google Calendar","calendar-apple":"from Apple Calendar","calendar-outlook":"from Outlook","calendar-file":"from calendar file"}[x.source]||'from calendar')+'</span>':''}${typeof liveSyncShiftSyncLabel==='function'?liveSyncShiftSyncLabel(x):''}</div><div class="muted"><label>Status <select data-shift-status="${escapeHTML(x.id)}" aria-label="Status for shift on ${escapeHTML(x.date)}">${shiftStatusOptions(x.status)}</select></label></div>${shiftTripOriginHTML(x)}<div class="muted"><a href="${googleCalUrl(x)}" target="_blank" rel="noopener">Add to Google</a> · <a href="${outlookCalUrl(x)}" target="_blank" rel="noopener">Add to Outlook</a></div>${x.note?`<p>${escapeHTML(x.note)}</p>`:''}`)}<div class="toolbar"><button data-action="add-shift">Add a shift on this day</button></div><p class="muted">${(()=>{const s=rows.map(r=>shiftLiveCalendarSource(r)).find(Boolean);return s?('Deleting removes it here and from your CRNA Hub calendar — your '+escapeHTML(s.calendarName)+' calendar isn\'t touched, and it won\'t be imported again.'):'Deleting removes it here and from your CRNA Hub calendar right away.'})()}</p></section>`;
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
// The paths, in Caleb's order and wording, as one numbered list.
// Each row's button is an affirmative choice (Yes, via that path); the
// list is used both on the suggestion card and on the facility form
// once Yes / a path is picked.
function facilityThreePathsHTML(s){
  const sid=s&&s.id?String(s.id):'';
  const nm=s&&s.name?String(s.name):'';
  return `<p><strong>Sync your calendar or manually enter a facility's hourly rate.</strong></p><ol><li><strong>Sync your calendar</strong> — ${nm?`shifts at ${escapeHTML(nm)} are already in your calendar. `:''}Save the hospital below — the next sync pulls those shifts in, priced once its rates are set.<div class="toolbar"><button type="button" class="tiny" data-action="facility-suggestion-path" data-id="${escapeHTML(sid)}" data-date="sync">Sync your calendar</button></div></li><li><strong>Manually enter the facility's hourly rate</strong> — enter the hourly rate and any other rates by hand below — the fallback when sync or a contract did not provide them.<div class="toolbar"><button type="button" class="tiny" data-action="facility-suggestion-path" data-id="${escapeHTML(sid)}" data-date="manual">Enter rates manually</button></div></li></ol>`;
}
function facilityThreeWaysHTML(pre){
  return `<section class="panel" id="facility-three-ways-panel"><h2>Add ${escapeHTML(pre.name||'a facility')} — pick a path</h2>${facilityThreePathsHTML({id:(db.facilitySuggestions||[]).find(x=>normFacilityName(x.name)===normFacilityName(pre.name))?.id||'',name:pre.name})}<p class="muted">Nothing is saved until you add the facility below — with its rates from a contract (above) or entered by hand. The next calendar sync then pulls in the shifts it held for this hospital.</p></section>`;
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
  let html=`<section class="panel" id="facility-suggestions-panel"><h2>Hospitals noticed in your calendar</h2>`;
  for(const sg of active){
    const range=facilitySuggestionRange(sg);
    html+=`<div class="item"><div class="item-title">We noticed shifts at ${escapeHTML(sg.name)} in your calendar. Add it as a facility?</div><div class="muted">${sg.count?sg.count+' shift(s)':''}${sg.count&&range?' · ':''}${range}${sg.sourceCalendarName?` · from “${escapeHTML(sg.sourceCalendarName)}”`:''}${sg.address?` · ${escapeHTML(sg.address)}`:''}</div>${facilityThreePathsHTML(sg)}<div class="item-actions"><button type="button" class="tiny" data-action="facility-suggestion-yes" data-id="${escapeHTML(sg.id)}">Yes, add facility</button><button type="button" class="tiny secondary" data-action="facility-suggestion-dismiss" data-id="${escapeHTML(sg.id)}">Not now</button></div></div>`;
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
function facilityPayFor(f,type,date){if(!f)return 0;const hourly=rateOrNull(f.hourlyRate),hours8=rateOrNull(f.paidHours8)||8;if(/24-hour/i.test(type)){const weekend=date?([0,6].includes(new Date(date+'T12:00:00').getDay())):false;if(weekend){const wknd24=rateOrNull(f.weekendRate24);if(wknd24!=null)return wknd24}const flat=rateOrNull(f.rate24);if(flat!=null)return flat;const h=rateOrNull(f.hourlyCall1st);if(h==null)return 0;const fc=firstCallPay(h,hourly,weekend);return fc?fc.pay:0;}if(/second/i.test(type)){const weekend=date?([0,6].includes(new Date(date+'T12:00:00').getDay())):false;if(weekend){const wknd=rateOrNull(f.weekendRateSecond);if(wknd!=null)return wknd}const flat=rateOrNull(f.rateSecond);if(flat!=null)return flat;const base=rateOrNull(f.rate8)!=null?rateOrNull(f.rate8):(hourly!=null?hourly*hours8:null);const bonus=rateOrNull(f.callBonus);return (base!=null&&bonus!=null)?base+bonus:0}if(/10-hour/i.test(type)){const flat=rateOrNull(f.rate10);return flat!=null?flat:(hourly!=null?hourly*10:0)}if(/12-hour/i.test(type)){const flat=rateOrNull(f.rate12);return flat!=null?flat:(hourly!=null?hourly*12:0)}if(/8-hour/i.test(type)){const flat=rateOrNull(f.rate8);return flat!=null?flat:(hourly!=null?hourly*hours8:0)}return 0}
// Price every still-unpriced shift for this facility from its (new or
// edited) pay rule. Returns how many were priced. Called when a
// facility is saved, so shifts imported unpriced get priced on the
// device at once; the next calendar sync re-prices the rest server-side.
function repriceUnpricedShiftsForFacility(f){if(!f)return 0;let n=0;for(const x of (db.shifts||[])){if(String(x.pay||'').trim()||!x.facility)continue;const match=facilityByNameOrAlias(x.facility);if(!match||match.id!==f.id)continue;const pay=facilityPayFor(f,x.type,x.date);if(pay>0){x.pay=String(Math.round(pay*100)/100);x.incomplete=false;x.updatedAt=new Date().toISOString();n++}}return n}
// One-line rate summary for the facilities list. Only rates that are set
// are shown as amounts; a blank rate is shown as "not set", never $0.00.
function facilityRateSummary(x){
  const set=[];
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
function facilityContractPreviewHTML(){
  if(facilityContractError)return `<p class="hint">${escapeHTML(facilityContractError)}</p>`;
  if(!facilityContractPreview)return '<p class="muted">No contract read yet. Upload a contract or paste its text above, then tap “Read my contract” — nothing is saved until you approve the preview below.</p>';
  const p=facilityContractPreview;
  let out=(p.isPhoto?ocrDiagnosticsHTML(facilityContractOcrPages,facilityContractPendingImages,p.ocrText||''):'' )+`<p><strong>Read from:</strong> ${escapeHTML(p.fileName||'pasted text')} — ${p.aiRead?'read with AI from your photo':p.isPhoto?'read from your photo on this device':'read from the text you pasted'}. Check every field carefully — a read can misread digits and dates.</p><p><strong>Nothing is saved yet.</strong> Correct anything wrong below, uncheck any facility you do not want, then save. Fields the contract did not state are left blank — blank means “not taken here / not applicable”, never $0.</p>${p.aiNote?`<p class="hint">${escapeHTML(p.aiNote)}</p>`:''}`;
  if(p.isPhoto)out+=`<div class="toolbar"><button type="button" data-action="facility-reread-rates">Re-read just the rates table</button><span class="muted">Crops the bottom half of each photo and reads only that — the rates table sits at the bottom of this addendum. New rates are merged into the preview below; nothing is saved yet. No picture leaves this device.</span></div>${facilityContractCropNote?`<p class="hint">${escapeHTML(facilityContractCropNote)}</p>`:''}`;
  p.facilities.forEach((f,i)=>{
    const rateInputs=FACILITY_RATE_KEYS.map(k=>{const un=(f.unreadable||[]).includes(k);return `<div class="field"><label for="f_facPrev_${i}_${k}">${FACILITY_RATE_LABELS[k]} ($)</label><input id="f_facPrev_${i}_${k}" class="facContractEdit" data-i="${i}" data-field="${k}" type="number" min="0" step="0.01" value="${escapeHTML(f.rates&&f.rates[k]!=null?f.rates[k]:'')}" placeholder="${un?'Not readable from photo — re-take or type':'Not stated in contract'}"></div>`}).join('');
    out+=`<div class="item" style="display:block"><label><input type="checkbox" class="facContractInclude" data-i="${i}" ${f.include?'checked':''}> Save this facility</label>
    <div class="form-grid">
    <div class="field"><label for="f_facPrev_${i}_name">Facility name</label><input id="f_facPrev_${i}_name" class="facContractEdit" data-i="${i}" data-field="name" type="text" value="${escapeHTML(f.name||'')}" placeholder="Not found — type the facility name"></div>
    <div class="field"><label for="f_facPrev_${i}_aliases">Short names / abbreviations</label><input id="f_facPrev_${i}_aliases" class="facContractEdit" data-i="${i}" data-field="aliases" type="text" value="${escapeHTML(f.aliases||'')}" placeholder="e.g. CAMC"></div>
    <div class="field"><label for="f_facPrev_${i}_address">Address</label><input id="f_facPrev_${i}_address" class="facContractEdit" data-i="${i}" data-field="address" type="text" value="${escapeHTML(f.address||'')}" placeholder="Not stated in contract"></div>
    ${rateInputs}
    </div>
    ${unreadableRatesWarningHTML(f.unreadable||[])}
    <p class="muted">Found: ${f.found.length?escapeHTML(f.found.join(', ')):'nothing recognised'}.${(f.unreadable||[]).length?(' Not readable from the photos (see above): '+escapeHTML((f.unreadable||[]).map(k=>FACILITY_RATE_LABELS[k]||k).join(', '))+'.'):''}${(()=>{const unL=(f.unreadable||[]).map(k=>FACILITY_RATE_LABELS[k]||k);const rest=f.missing.filter(m=>!unL.includes(m));return rest.length?(' Not stated in the contract — fill in by hand if it applies: '+escapeHTML(rest.join(', '))+'.'):''})()}${f.effectiveStart?(' Contract dates: '+fmt(f.effectiveStart)+' to '+fmt(f.effectiveEnd||f.effectiveStart)+'.'):''}${p.shiftCount?(' This document also lists '+p.shiftCount+' shift(s) — shifts are not created here; use Upload a schedule on this tab to import them from the same contract.'):''}</p></div>`;
  });
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
// Totals for a rule preview, computed ONLY by the deterministic
// engine (facilityPayFor / firstCallPay) on the mapped rates — the
// AI never does this arithmetic. 2026-01-05 is a Monday, 2026-01-03
// a Saturday.
function ruleTotalsText(rule,rates){
  if(!rule||!rule.shift_type)return '';
  const f={hourlyRate:rates.hourlyRate||'',paidHours8:'',rate8:rates.rate8||'',rate10:rates.rate10||'',rate12:rates.rate12||'',rate24:rates.rate24||'',weekendRate24:rates.weekendRate24||'',hourlyCall1st:rates.hourlyCall1st||'',rateSecond:rates.rateSecond||'',weekendRateSecond:rates.weekendRateSecond||'',callBonus:rates.callBonus||''};
  const wd=facilityPayFor(f,rule.shift_type,'2026-01-05'),we=facilityPayFor(f,rule.shift_type,'2026-01-03');
  const bits=[];
  if(wd>0)bits.push('Weekday: '+currency(wd));
  if(we>0&&we!==wd)bits.push('Weekend: '+currency(we));
  if(rule.shift_type==='24-hour call'){
    const fc=firstCallPay(rateOrNull(rates.hourlyCall1st),rateOrNull(rates.hourlyRate),false);
    if(fc&&wd>0)bits.push('('+fc.source.replace(' stated in document','')+')');
  }
  return bits.length?('What the engine prices from this rule — '+rule.shift_type+': '+bits.join(' · ')+'.'):'';
}
function ruleChatHTML(){
  const msgs=ruleChatMessages.map(m=>`<p class="${m.who==='user'?'':'muted'}"><strong>${m.who==='user'?'You':'CRNA Hub'}:</strong> ${escapeHTML(m.text)}</p>`).join('');
  let preview='';
  if(ruleChatPreview){
    const p=ruleChatPreview;
    const segText=(p.segments||[]).filter(s=>s&&(s.rate!=null||s.hours!=null)).map(s=>`${s.hours!=null?escapeHTML(s.hours)+'h ':''}${s.rate!=null?'@ '+currency(Number(s.rate))+'/hr':''}${s.from||s.to?` (${escapeHTML(s.from||'')}–${escapeHTML(s.to||'')})`:''}${s.label?' — '+escapeHTML(s.label):''}`).join(' · ');
    const rateInputs=FACILITY_RATE_KEYS.filter(k=>p.rates&&p.rates[k]!=null&&p.rates[k]!=='').map(k=>`<div class="field"><label for="f_rule_${k}">${FACILITY_RATE_LABELS[k]} ($)</label><input id="f_rule_${k}" class="ruleEdit" data-field="${k}" type="number" min="0" step="0.01" value="${escapeHTML(p.rates[k])}"></div>`).join('');
    const totals=ruleTotalsText(p.rule,p.rates);
    preview=`<div class="item" style="display:block"><p><strong>Here's the rule I understood:</strong> ${escapeHTML(p.summary||'')}</p>${p.rule&&p.rule.shift_type?`<p class="muted">Shift type: ${escapeHTML(p.rule.shift_type)}${p.rule.applies_to?(' · applies: '+escapeHTML(p.rule.applies_to)):''}</p>`:''}${segText?`<p class="muted">Parts: ${segText}</p>`:''}${totals?`<p><strong>${escapeHTML(totals)}</strong></p>`:''}${(p.rule&&p.rule.missing&&p.rule.missing.length)?`<p class="muted">Not stated: ${escapeHTML(p.rule.missing.join(', '))} — leave blank if it does not apply.</p>`:''}${p.clarifying_question?`<p class="hint">One thing first: ${escapeHTML(p.clarifying_question)} Answer in the box below and I'll update the rule — or edit the numbers here and use it as-is.</p>`:''}${rateInputs?`<div class="form-grid">${rateInputs}</div>`:''}<div class="toolbar"><button type="button" data-action="rule-use">Use this rule — add it to the facility preview</button><button type="button" class="secondary" data-action="rule-discard">Discard rule (save nothing)</button></div><p class="muted">Nothing is saved yet. “Use this rule” puts these rates into the facility preview above; saving happens only when you save that preview.</p></div>`;
  }
  return `<div style="margin-top:16px"><h3>Describe it in your own words</h3><p class="muted">No box for your shift type? Type how it pays — e.g. “24hr call, first 8 hours $250/hr, then after 3pm 175/hr until 7am” — and the AI makes the rule for you. If anything is unclear, it asks instead of guessing. Use it to clarify any shift assignment so the pay prediction is more accurate.</p>${msgs}${ruleChatBusy?'<p class="hint">Reading your rule…</p>':''}${ruleChatError?`<p class="hint">${escapeHTML(ruleChatError)}</p>`:''}${preview}<form id="ruleChatForm"><div class="form-grid">${area('ruleChatText',ruleChatPreview?'Your answer / a clearer description':'Your pay rule, in your own words','','24hr call, first 8 hours $250/hr, then after 3pm 175/hr until 7am')}</div><div class="form-actions"><button type="submit">${ruleChatPreview?'Send — update the rule':'Make my rule with AI'}</button></div></form></div>`;
}
async function submitRuleChat(e){
  if(e&&e.preventDefault)e.preventDefault();
  if(ruleChatBusy)return;
  const el=$('f_ruleChatText');
  const text=el?String(el.value||'').trim():'';
  if(!text){ruleChatError='Type your pay rule first — nothing was sent.';render();return}
  if(!SUPABASE_CONFIGURED){ruleChatError='Sign-in is not configured yet — AI rule reading runs for your signed-in account. Nothing was sent.';render();return}
  if(!cloudSession){ruleChatError='Sign in on the Account tab first — AI rule reading runs for your signed-in account. Nothing was sent.';render();return}
  const history=ruleChatMessages.slice(-6).map(m=>({role:m.who==='user'?'user':'assistant',text:m.text}));
  ruleChatMessages.push({who:'user',text});
  ruleChatBusy=true;ruleChatError='';render();
  try{
    const data=await liveSyncPost('extract-contract',{action:'extract-contract',mode:'rule',ruleText:text,ruleHistory:history});
    if(data&&data.error==='openai_key_missing')throw new Error(AI_KEY_MISSING_MESSAGE);
    if(!data||data.ok===false||!data.rule)throw new Error((data&&data.message)||(data&&data.error)||'AI rule reading failed.');
    const rule=data.rule;
    const rates=ruleToFacilityRates(rule);
    if(!rule.shift_type&&!Object.keys(rates).length&&!rule.clarifying_question){ruleChatError='The AI could not make a rule from that — try naming the shift type and the rates, e.g. “24hr call, first 8 hours $250/hr, then $175/hr until 7am”. Nothing was saved.';ruleChatBusy=false;render();return}
    ruleChatPreview={rule,rates,summary:rule.summary||'',segments:rule.segments||[],clarifying_question:rule.clarifying_question||null};
    const reply=rule.clarifying_question?rule.clarifying_question:(rule.summary||'Here is the rule I understood — check it below.');
    ruleChatMessages.push({who:'ai',text:reply});
  }catch(err){
    const msg=String((err&&err.message)||err||'');
    ruleChatError=(msg===AI_KEY_MISSING_MESSAGE)?AI_KEY_MISSING_MESSAGE:('AI rule reading failed: '+msg+' Nothing was saved — the rate boxes above still work by hand.');
  }finally{ruleChatBusy=false;render()}
}
// "Use this rule": merge the previewed rates into the facility
// contract preview (creating one if needed) — the SAME preview the
// contract upload uses, saved only by its Save button. Fields the
// rule states are set; fields it does not state are left as-is.
function useRuleChatPreview(){
  if(!ruleChatPreview)return;
  const rates={...ruleChatPreview.rates};
  if(!Object.keys(rates).length){ruleChatError='This rule has no rates to add yet — answer the question above or add the rates first.';render();return}
  if(!facilityContractPreview){
    facilityContractPreview={facilities:[{name:'',aliases:'',address:'',rates:{},found:[],missing:FACILITY_RATE_KEYS.map(k=>FACILITY_RATE_LABELS[k]),include:true,unreadable:[]}],contract:{rates:{},method:'plain-language AI rule (gpt-4o-mini)'},fileName:'Described in your own words',isPhoto:false,aiRead:true,shiftCount:0};
  }
  const p=facilityContractPreview;
  const f=p.facilities[0]||(p.facilities[0]={name:'',rates:{},found:[],missing:[],include:true});
  f.rates=f.rates||{};
  const added=[];
  for(const k of Object.keys(rates)){f.rates[k]=rates[k];const label=FACILITY_RATE_LABELS[k]||k;const shown=label+' '+currency(Number(rates[k]));if(!(f.found||[]).includes(shown)){(f.found=f.found||[]).push(shown)}f.missing=(f.missing||[]).filter(m=>m!==label);added.push(label)}
  p.aiRead=true;
  p.aiNote='Plain-language rule added: '+(ruleChatPreview.summary||added.join(', '))+'. Check the values below — nothing is saved yet.';
  ruleChatMessages.push({who:'ai',text:'Added to the facility preview above: '+added.join(', ')+'. Name the facility there if it is blank, check the numbers, then tap “Save facilities — I checked this”.'});
  ruleChatPreview=null;ruleChatError='';
  render();
}
function facilityAddressLine(x){const a=String((x&&x.address)||'').trim();if(a)return `<div class="muted facility-addr" data-action="edit-facilities" data-id="${escapeHTML(x.id)}" title="Tap to edit this facility">${escapeHTML(a)}</div>`;return `<div class="warning facility-addr" data-action="edit-facilities" data-id="${escapeHTML(x.id)}">No address saved — mileage can’t calculate for this facility. Tap to add it.</div>`}
function myFacilitiesHTML(){return `<section class="panel" id="my-facilities-panel"><h2>My facilities</h2>${list('facilities',db.facilities,x=>{const s=facilityRateSummary(x);return `<div class="item-title">${escapeHTML(x.name)}${facilityAliases(x).length?` <span class="muted">(${escapeHTML(facilityAliases(x).join(', '))})</span>`:''}</div>${facilityAddressLine(x)}<div class="muted">${s.set.length?s.set.join(' · '):'No rates set'}${s.missing.length?` · <span class="warning">Not taken here: ${escapeHTML(s.missing.join(', '))}</span>`:''} · ${x.distance?escapeHTML(x.distance)+' miles one-way ('+roundTripMiles(x.distance).toFixed(1)+' round trip)'+(x.distanceSource==='auto'?' (auto-calculated from home)':' (manual)'):'distance not set'}</div>${x.ratesSource?`<div class="muted">Rates from ${escapeHTML(x.ratesSource)}${x.ratesSourceFile?` · ${escapeHTML(x.ratesSourceFile)}`:''}${x.ratesSourceDate?` · ${escapeHTML(x.ratesSourceDate)}`:''}</div>`:'<div class="muted">Rates entered manually.</div>'}${s.set.length===0?'<div class="muted">No pay rule yet — shifts for this facility import unpriced until you set one.</div>':''}${x.notes?`<p style="white-space:pre-wrap">${escapeHTML(x.notes)}</p>`:''}`})}<p class="hint">Facility notes are stored unencrypted in this browser — no passwords or patient information.</p></section>`}
// QGenda and Upload a schedule live at the bottom of this tab too
// (Nov 7, 2026) — the same qgendaFeedHTML()/scheduleImportHTML()
// components as the Account sync area, not copies: one tab renders at
// a time, so the shared state (connect form, upload preview, panel
// open logic, feature toggle) is identical from either home.
function facilitiesPage(){const x=db.facilities.find(x=>x.id===editId)||{};const pre=(!editId&&facilitySuggestionPrefill)?facilitySuggestionPrefill:null;const blankHint='placeholder="Leave blank if not taken here"';return `${myFacilitiesHTML()}${onboardDirectionHTML(3)}${facilitySuggestionsHTML()}${pre?facilityThreeWaysHTML(pre):''}${collapsePanelHTML('facility-contract-panel','Add a facility from a contract',`<form id="facilityContractForm"><div class="form-grid">${field('facilityContractFile','Choose contract file(s) — select several pictures for a multi-page contract','file','','accept=".txt,.csv,.ics,.pdf,.png,.jpg,.jpeg,.webp,.heic,text/plain,text/csv,text/calendar,image/*" multiple')}${area('facilityContractText','Or paste contract text','','Facility: Holzer\nRate: $250/hr, $1,000 overnight call bonus\n24-hour / 1st call: $4,800')}</div><div class="form-actions"><button type="submit">Read my contract</button></div></form>${contractPagesHTML('facility')}${facilityContractOcrStatus?`<p class="hint" id="facilityContractOcrStatus">${escapeHTML(facilityContractOcrStatus)}</p>`:''}${facilityContractError&&!facilityContractPreview?`<p class="hint">${escapeHTML(facilityContractError)}</p>`:''}<div style="margin-top:14px">${facilityContractPreviewHTML()}</div>${ruleChatHTML()}`,!!((db.facilities||[]).length===0||facilityContractPreview||facilityContractError||facilityContractOcrStatus||(facilityContractPendingImages||[]).length>0||ruleChatPreview||ruleChatError||pre))}${paystubPanelHTML()}${collapsePanelHTML('facility-manual-panel',(editId&&x.id)?'Edit hospital':'Add a facility manually',`<p class="muted">Type the hospital and its rates — every rate is optional; leave blank what you don’t take here.</p><form id="entryForm" data-kind="facilities"><div class="form-grid">${field('name','Hospital / facility name','text',x.name||(pre&&pre.name)||'','required')}${field('aliases','Short names / abbreviations (comma-separated)','text',x.aliases||'','placeholder="e.g. CAMC"')}${field('address','Address','text',x.address||(pre&&pre.address)||'','placeholder="Street, City, State ZIP — used to calculate mileage"')}${field('hourlyRate','Hourly rate ($)','number',x.hourlyRate||'','min="0" step="0.01" '+blankHint)}${field('paidHours8','Paid hours for an 8-hour shift','number',x.paidHours8||'','min="0" step="0.5" placeholder="8"')}${field('rate8','8-hour shift rate ($)','number',x.rate8||'','min="0" step="0.01" '+blankHint)}${field('rate10','10-hour shift rate ($)','number',x.rate10||'','min="0" step="0.01" '+blankHint)}${field('rate12','12-hour shift rate ($)','number',x.rate12||'','min="0" step="0.01" '+blankHint)}${field('rate24','24-hour call rate ($)','number',x.rate24||'','min="0" step="0.01" '+blankHint)}${field('hourlyCall1st','1st call hourly rate ($/hr)','number',x.hourlyCall1st||'','min="0" step="0.01" '+blankHint)}${field('rateSecond','Second call rate — weeknight ($)','number',x.rateSecond||'','min="0" step="0.01" '+blankHint)}${field('weekendRateSecond','Second call rate — weekend ($)','number',x.weekendRateSecond||'','min="0" step="0.01" '+blankHint)}${field('callBonus','Overnight call bonus ($)','number',x.callBonus||'','min="0" step="0.01" '+blankHint)}${field('distance','One-way miles','number',x.distance||'','min="0" step="0.1" placeholder="Auto from home, or enter manually"')}<input type="hidden" name="distanceSource" id="f_distanceSource" value="${escapeHTML(x.distanceSource||(x.distance?'manual':''))}">${area('notes','Offline facility notes',x.notes||'','Parking, protocols, phone numbers, authorized facility codes, EHR URL or username (never passwords)')}</div><p class="hint" id="facilityDistanceStatus">${escapeHTML(facilityDistanceStatus)}</p><div class="toolbar"><button type="button" class="secondary" data-action="facility-distance">Calculate one-way distance from home</button></div>${formEnd(editId?'Save facility':'Add facility')}`,!!((editId&&x.id)||pre))}${qgendaFeedHTML()}${scheduleImportHTML()}${dismissedFacilitySuggestionsHTML()}`}
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
function calPreviewHTML(){if(!calPreview)return '<p class="muted">No calendar file parsed yet. Choose an .ics file above, then parse it — nothing is saved until you approve the preview.</p>';const rows=calPreview.rows,dup=rows.filter(r=>r.duplicate).length,need=rows.filter(r=>r.flags.length).length;return `<p><strong>Parsed from:</strong> ${escapeHTML(calPreview.fileName)} · Source: ${escapeHTML(calPreview.sourceLabel)} · ${rows.length} event(s) · ${rows.filter(r=>r.include&&!r.duplicate).length} would be added · ${dup} duplicate(s) will merge into the existing shift — never doubled</p><p class="muted">Duplicates are events already in the app with the same date, facility, and shift type. Uncheck any row to leave it out. Rows with a missing date or facility block approval until fixed or unchecked.</p><div class="table-scroll"><table class="contract-table"><thead><tr><th></th><th>Date</th><th>Facility</th><th>Shift type</th><th>Pay</th><th>Flags</th></tr></thead><tbody>${rows.map((r,i)=>`<tr><td><input type="checkbox" class="calInclude" data-row="${i}" ${r.include?'checked':''}></td><td><input type="date" class="calEdit" data-row="${i}" data-field="date" value="${escapeHTML(r.date||'')}"></td><td><input class="calEdit" data-row="${i}" data-field="facility" value="${escapeHTML(r.facility||'')}"></td><td><input class="calEdit" data-row="${i}" data-field="type" value="${escapeHTML(r.type||'')}"></td><td><input class="calEdit" data-row="${i}" data-field="pay" value="${escapeHTML(r.pay||'')}"></td><td>${r.duplicate?'<span class="pill warn">duplicate — will merge</span> ':''}${r.flags.map(f=>`<span class="pill warn">${escapeHTML(f)}</span>`).join(' ')||'<span class="pill">clean</span>'}</td></tr>`).join('')}</tbody></table></div><div class="form-actions"><button type="button" data-action="cal-approve">Approve selected — add shifts</button><button type="button" class="secondary" data-action="cal-discard">Discard preview</button></div>`}
async function importCalendar(e){e.preventDefault();calImportError='';const f=$('f_calFile').files[0];const sourceLabel=$('f_calSource').value||'Calendar file';if(!f){calImportError='Choose an .ics calendar file first (Google, Apple, or Outlook can all export one).';return render()}let text='';try{text=await f.text()}catch(err){calImportError='Could not read that file: '+err.message;return render()}if(!/^BEGIN:VCALENDAR/i.test(text.trim())){calImportError='That file is not a calendar (.ics) file. Export your calendar as .ics from Google, Apple, or Outlook and try again. Nothing was saved.';calPreview=null;return render()}const parsed=parseICS(text,f.name);const sourceCode=CAL_SOURCES[sourceLabel]||'calendar-file';const grossByBlock=text.split(/BEGIN:VEVENT/i).slice(1).map(b=>{const m=b.match(/Expected gross:\s*\$?([\d\\,]+(?:\.\d+)?)/i);return m?m[1].replace(/[\\,]/g,''):''});const rows=parsed.rows.map((r,ri)=>{if(grossByBlock[ri])r={...r,pay:grossByBlock[ri]};const duplicate=(db.shifts||[]).some(x=>shiftsSameShift(x,r));const flags=[...r.flags];if(duplicate)flags.push('already in CRNA Hub — will merge, not double');return {...r,source:sourceCode,sourceLabel,status:importStatusForDate(r.date),include:true,duplicate,incomplete:!String(r.pay||'').trim(),note:'Imported from '+sourceLabel+' (.ics): '+f.name}});calPreview={fileName:f.name,sourceLabel,sourceCode,rows};if(!rows.length){calImportError='No events found in that calendar file. Nothing was saved.';calPreview=null}render()}
function approveCalendarImport(){if(!calPreview)return;const rows=calPreview.rows.filter(r=>r.include);const blocked=rows.filter(r=>!r.date||!/^\d{4}-\d{2}-\d{2}$/.test(r.date)||!String(r.facility||'').trim());if(blocked.length){alert('Fix or uncheck these rows before approving: '+(blocked.map(r=>`${r.date||'(no date)'} ${r.facility||'(no facility)'} ${r.type}`).join('; ')));return}let created=0,skipped=0,newFacilities=0;for(const r of rows){const pay=String(r.pay||'').trim();const res=addShiftDeduped({id:id(),date:r.date,facility:String(r.facility).trim(),type:r.type,pay,status:importStatusForDate(r.date),source:r.source,sources:[r.source],incomplete:!pay,note:r.note});if(res.merged){skipped++;continue}created++;if(r.facility&&!facilityByNameOrAlias(r.facility)){db.facilities.push({id:id(),name:String(r.facility).trim(),aliases:'',address:'',rate8:'',rate10:'',rate12:'',rate24:'',rateSecond:'',hourlyRate:'',paidHours8:'',callBonus:'',distance:'',notes:''});newFacilities++}}const dups=calPreview.rows.filter(r=>r.duplicate).length;calPreview=null;persist();render();if(typeof window!=='undefined'&&typeof window.liveSyncSchedulePush==='function')window.liveSyncSchedulePush();alert(`Added ${created} shift(s) from the calendar. Merged ${skipped} duplicate(s) into existing shifts — never doubled.${newFacilities?` New facilit(ies) learned: set their pay rules on the Facilities tab.`:''}`)}
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
  const toks=s.split(' ').filter(Boolean);
  if(!toks.length) return null;
  if(toks.length===1) return {first:'',last:toks[0]};
  if(hasComma) return {first:toks.slice(1).join(' '),last:toks[0]};
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
    else{match='other';matchedName=cands[0]}
  }
  return {match,matchedName};
}
function parseScheduleText(text,fileName){
  const clean=String(text||'').replace(/^\uFEFF/,'');
  const name=scheduleName();
  const rows=[];
  let anyName=false;
  const pushRow=(r)=>{
    const duplicate=(db.shifts||[]).some(x=>shiftsSameShift(x,r));
    const cls=scheduleClassifyRow(r);
    if(cls.match!=='uncertain')anyName=true;
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
  return {fileName,source:'schedule-import',matchedName:name,rows,noNamesInFile:rows.length>0&&!anyName,ai:false};
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
  const body=`<p class="muted">No live calendar? Upload a schedule instead — we’ll pick out only your shifts.</p>${scheduleImportContext==='qgenda'?'<p class="hint">Signed in to QGenda? Upload a screenshot of the schedule page or a Reports export here — the app reads it and shows a preview before saving anything. Screenshots never check themselves; if your QGenda feed is connected, the app checks it each time you open CRNA Hub and new shifts wait here for your review.</p>':''}<details class="csp-info"><summary>Taking a photo of a paper schedule?</summary><p class="muted">One photo of the whole grid is best — dates across the top and your name row both in frame.</p><p class="muted">Straight-on and sharp helps — the app zooms into your row for a close-up read, so there's no need to crop.</p><p class="muted">Check the preview before approving — cells the reads couldn't agree on are flagged for you.</p></details><form id="scheduleForm"><div class="form-grid">${field('scheduleNameUpload','Name as it appears on your schedule','text',nm,'placeholder="e.g. C. Martin"')}${field('scheduleFile','Choose a schedule file','file','','accept=".csv,.xlsx,.pdf,.png,.jpg,.jpeg,.webp,.heic,text/plain,text/csv"')}${area('scheduleText','Or paste schedule text','','2026-11-10, Holzer, 8-hour day\nNov 12 — C. Martin — Holzer 8/2nd call')}</div><div class="form-actions"><button type="submit">Read schedule — preview only (nothing saved yet)</button><button type="button" class="secondary" data-action="save-schedule-name">Save name only</button></div></form>${scheduleAiStatus?`<p class="hint">${escapeHTML(scheduleAiStatus)}</p>`:''}${scheduleImportError?`<p class="hint">${escapeHTML(scheduleImportError)}</p>`:''}<div style="margin-top:14px">${schedulePreviewHTML()}</div><details><summary>Manual fallback — import or export a .ics file</summary><h3>Import shifts from a calendar (.ics)</h3><p class="muted">Export your calendar as a .ics file and import it here — duplicates are skipped, never doubled.</p><form id="calendarForm"><div class="form-grid">${field('calFile','Choose .ics file','file','','accept=".ics,text/calendar"')}${select('calSource','Which calendar is this from?',['Google Calendar','Apple Calendar','Outlook','Calendar file'],'Calendar file')}</div><div class="form-actions"><button type="submit">Parse calendar — preview only (nothing saved yet)</button></div></form>${calImportError?`<p class="hint">${escapeHTML(calImportError)}</p>`:''}<div style="margin-top:14px">${calPreviewHTML()}</div><h3>Export shifts to a calendar (.ics)</h3><div class="toolbar"><button data-action="export-cal-all">Download all shifts (.ics)</button><button data-action="export-cal-month">Download this month (.ics)</button></div></details>`;
  return collapsePanelHTML('schedule-import-panel','Upload a schedule',body,open);
}
function schedulePreviewHTML(){
  if(!schedulePreview)return '<p class="muted">No schedule parsed yet. Choose a file above, then read it — nothing is saved until you approve the preview.</p>';
  const rows=schedulePreview.rows;
  const matched=rows.filter(r=>r.match==='matched').length,other=rows.filter(r=>r.match==='other').length,unc=rows.filter(r=>r.match==='uncertain').length,dup=rows.filter(r=>r.duplicate).length;
  return `<p><strong>Parsed from:</strong> ${escapeHTML(schedulePreview.fileName)} · ${rows.length} row(s) · ${rows.filter(r=>r.include&&!r.duplicate).length} would be added · ${dup} duplicate(s) will merge into the existing shift — never doubled</p><p class="muted">Matched name: <strong>${escapeHTML(schedulePreview.matchedName||'(not set — add it above)')}</strong>${schedulePreview.noNamesInFile?' — no names found in this file, so it was treated as your own schedule; uncheck anything that is not yours.':''} ${matched} row(s) matched you, ${other} row(s) for other people are excluded, ${unc} uncertain row(s) are unchecked — check one to include it. Rows with a missing date — or a missing facility with no grid code — block approval until fixed or unchecked; grid-code rows save without a facility and stay unpriced. Imported shifts arrive confirmed — they are on a real schedule.</p><div class="table-scroll"><table class="contract-table"><thead><tr><th></th><th>Date</th><th>Facility</th><th>Shift type</th><th>Pay</th><th>Name on row</th><th>Flags</th></tr></thead><tbody>${rows.map((r,i)=>`<tr><td><input type="checkbox" class="schedInclude" data-row="${i}" ${r.include?'checked':''} ${r.match==='other'?'disabled':''}></td><td><input type="date" class="schedEdit" data-row="${i}" data-field="date" value="${escapeHTML(r.date||'')}"></td><td><input class="schedEdit" data-row="${i}" data-field="facility" value="${escapeHTML(r.facility||'')}"></td><td><input class="schedEdit" data-row="${i}" data-field="type" value="${escapeHTML(r.type||'')}"></td><td><input class="schedEdit" data-row="${i}" data-field="pay" value="${escapeHTML(r.pay||'')}"></td><td>${escapeHTML(r.matchedName||r.name||'—')}</td><td>${r.flags.map(f=>`<span class="pill warn">${escapeHTML(f)}</span>`).join(' ')||'<span class="pill">clean</span>'}</td></tr>`).join('')}</tbody></table></div><div class="form-actions"><button type="button" data-action="schedule-approve">Approve selected — add shifts</button><button type="button" class="secondary" data-action="schedule-discard">Discard preview</button></div>`;
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
  const rows=schedulePreview.rows.filter(r=>r.include&&r.match!=='other');
  // A grid-code row may save without a facility (the grid prints
  // none) — it stays unpriced, carrying its code as the type.
  const blocked=rows.filter(r=>!r.date||!/^\d{4}-\d{2}-\d{2}$/.test(r.date)||(!String(r.facility||'').trim()&&!String(r.code||'').trim()));
  if(blocked.length){alert('Fix or uncheck these rows before approving: '+(blocked.map(r=>`${r.date||'(no date)'} ${r.facility||'(no facility)'} ${r.type}`).join('; ')));return}
  if(!rows.length){alert('Nothing selected to add — check the rows that are yours, or discard the preview.');return}
  let created=0,skipped=0,incomplete=0; const newNames=[];
  for(const r of rows){
    let pay=String(r.pay||'').trim(),inc=!pay;
    if(!pay){const fac=facilityByNameOrAlias(r.facility); if(fac){const p=facilityPayFor(fac,r.type,r.date); if(p>0){pay=String(p);inc=false}}}
    const res=addShiftDeduped({id:id(),date:r.date,facility:String(r.facility).trim(),type:r.type,pay,status:importStatusForDate(r.date),source:r.source||'schedule-import',sources:[r.source||'schedule-import'],incomplete:inc,updatedAt:new Date().toISOString(),note:'Schedule import: '+schedulePreview.fileName+(schedulePreview.matchedName?(' — matched name "'+schedulePreview.matchedName+'"'):'')});
    if(res.merged){skipped++;continue}
    if(!pay)incomplete++;
    created++;
    if(r.facility&&!facilityByNameOrAlias(r.facility)&&!newNames.some(n=>normFacilityName(n)===normFacilityName(r.facility)))newNames.push(r.facility);
  }
  if(newNames.length)mergeFacilitySuggestions('schedule-import',newNames.map(n=>({name:n,count:(db.shifts||[]).filter(x=>normFacilityName(x.facility)===normFacilityName(n)).length,firstDate:'',lastDate:''})),schedulePreview.fileName);
  const fileName=schedulePreview.fileName;
  schedulePreview=null; qgendaClearPending(); db.settings=db.settings||{}; db.settings.scheduleImported=true; db.settings.scheduleImportFile=fileName; db.settings.scheduleImportedAt=new Date().toISOString();
  persist(); render();
  if(typeof window!=='undefined'&&typeof window.liveSyncSchedulePush==='function')window.liveSyncSchedulePush();
  alert(`Added ${created} shift(s) from the schedule.${skipped?` Merged ${skipped} duplicate(s) into existing shifts — never doubled.`:''}${incomplete?` ${incomplete} unpriced — set the pay rule on the Facilities tab.`:''}${newNames.length?` New facilit(ies) noticed — check the suggestion on the Dashboard before their shifts are priced.`:''} Imported shifts arrive confirmed — they are on a real schedule.`);
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
  const rows=shifts.map(sh=>{
    const date=String(sh.date||''); const facility=String(sh.facility||'').trim();
    // Grid schedules (Nov 6, 2026): a cell code ("5**") is carried
    // verbatim as the shift type — never interpreted, never priced
    // until the user renames it to a known shift type or maps it in
    // the preview. Grid shifts have no facility on the page.
    const code=String(sh.code||'').trim();
    const type=code||String(sh.type||'Other');
    const rowName=String(sh.name||'').trim();
    const match=rowName?(scheduleNamesMatch(rowName,name)?'matched':(name?'other':'uncertain')):'uncertain';
    const duplicate=(db.shifts||[]).some(x=>shiftsSameShift(x,{date,facility,type}));
    const flags=[]; if(duplicate)flags.push('already in CRNA Hub — will merge, not double'); if(match==='other')flags.push('other person — excluded'); if(match==='uncertain')flags.push('uncertain — check to include'); if(facility&&!facilityByNameOrAlias(facility))flags.push('new facility — will be suggested, not created'); if(code)flags.push('grid code "'+code+'" — not a known shift type; saved as-is, unpriced (rename it here if you know it)'); if(sh.check)flags.push('check this one — '+(sh.checkReason||'the two reads of this photo disagreed here'));
    return {date,facility,type,code,pay:String(sh.pay||''),name:rowName,matchedName:rowName,match,include:match==='matched'&&sh.includeDefault!==false,duplicate,flags,source:'schedule-import-ai',incomplete:!String(sh.pay||'').trim()};
  });
  schedulePreview={fileName,source:'schedule-import-ai',matchedName:name,rows,noNamesInFile:false,ai:true};
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
    const pendingLine=(qgendaPendingNew>0&&qgendaPendingPreview())?`<p class="hint"><strong>QGenda: ${qgendaPendingNew} new shift${qgendaPendingNew===1?'':'s'} ready to review</strong> — see the preview under Upload a schedule; nothing is saved until you approve it.</p>`:'';
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
// "Check feed now" button / the connect flow — status line, errors
// shown, an all-duplicate result still opens the preview) and silent
// (the boot auto-check — no status line, no error banner, and an
// all-known result leaves no trace beyond the last-checked stamp).
async function fetchQgendaFeed(opts){
  const silent=!!(opts&&opts.silent);
  if(!featureOn('featureQgenda'))return;
  if(!SUPABASE_CONFIGURED||!cloudSession){if(!silent){qgendaStatusError='Sign in on the Account tab first.';render()}return}
  try{
    if(!silent){qgendaStatusError='Checking your QGenda feed…'; render()}
    const facilities=(db.facilities||[]).map(f=>({name:f.name,aliases:String(f.aliases||'').split(',').map(x=>x.trim()).filter(Boolean),hourlyRate:f.hourlyRate,rate8:f.rate8,rate10:f.rate10,rate12:f.rate12,rate24:f.rate24,rateSecond:f.rateSecond,weekendRateSecond:f.weekendRateSecond,callBonus:f.callBonus,paidHours8:f.paidHours8,hourlyCall1st:f.hourlyCall1st,weekendRate24:f.weekendRate24}));
    const data=await liveSyncPost('qgenda-feed',{action:'fetch',facilities});
    qgendaStatusError='';
    // A successful answer — even an empty one — is a check: stamp it
    // so the panel's "Last checked" line is honest in both modes.
    db.settings=db.settings||{}; db.settings.qgendaLastCheckedAt=new Date().toISOString();
    if(!data||!Array.isArray(data.shifts)||!data.shifts.length){
      if(silent){persist(); return}
      schedulePreview=null; qgendaStatusError='The QGenda feed answered but listed no shifts. If you have no upcoming shifts in QGenda, that is correct — otherwise check the feed in QGenda.'; render(); return}
    const name=scheduleName();
    const rows=data.shifts.map(sh=>{
      const date=String(sh.date||''),facility=String(sh.facility||'').trim(),type=String(sh.type||'Other');
      const duplicate=(db.shifts||[]).some(x=>shiftsSameShift(x,{date,facility,type}));
      const flags=[]; if(duplicate)flags.push('already in CRNA Hub — will merge, not double'); if(!sh.facilityKnown)flags.push('new facility — will be suggested, not created');
      return {date,facility,type,pay:String(sh.pay||''),name:name,matchedName:name,match:'matched',include:true,duplicate,flags,source:'qgenda-feed',incomplete:!String(sh.pay||'').trim()};
    });
    const fresh=rows.filter(r=>!r.duplicate).length;
    // Boot check with nothing new: every returned shift is already
    // here — no preview, no notice, just the last-checked stamp.
    if(silent&&!fresh){persist(); render(); return}
    schedulePreview={fileName:'QGenda feed',source:'qgenda-feed',matchedName:name,rows,noNamesInFile:false,ai:false};
    qgendaPendingNew=fresh; qgendaNoticeDismissed=false;
    db.settings.qgendaConnected=true; if(data.masked)db.settings.qgendaMasked=String(data.masked);
    persist(); render();
  }catch(err){if(silent){qgendaFriendlyError(err,'fetch')}else{qgendaStatusError=qgendaFriendlyError(err,'fetch'); render()}}
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
  db.settings=db.settings||{}; db.settings.qgendaConnected=false; db.settings.qgendaMasked=''; qgendaStatusError=''; persist(); render();
}
function qgendaStatusRefresh(){
  if(!featureOn('featureQgenda'))return;
  if(qgendaStatusLoaded||!SUPABASE_CONFIGURED||!cloudSession)return; qgendaStatusLoaded=true;
  liveSyncPost('qgenda-feed',{action:'status'}).then(data=>{
    db.settings=db.settings||{};
    if(data&&data.connected){db.settings.qgendaConnected=true; if(data.masked)db.settings.qgendaMasked=String(data.masked)}
    else{db.settings.qgendaConnected=false; db.settings.qgendaMasked=''}
    persist(); render();
  }).catch(()=>{});
}
function submitEntry(e){e.preventDefault();const kind=e.currentTarget.dataset.kind;if(kind==='documents'){submitDocument(e);return;}if(kind==='home-address'){submitHomeAddress(e);return;}if(kind==='portal-check'){submitPortalCheck(e);return;}if(kind==='portal-check-approve'){approvePortalCheck(e);return;}if(kind==='monitor-cadence'){const rec=Object.fromEntries(new FormData(e.currentTarget));const m=(db.portalMonitoring||[]).find(x=>x.key===rec.key);if(m){const v=parseInt(rec.cadenceDays,10);if(Number.isFinite(v)&&v>0)m.cadenceDays=v;persist();}render();return;}if(kind==='paycheck-edit'){submitPaycheckEdit(e);return;}const record=Object.fromEntries(new FormData(e.currentTarget));if(kind==='nbcrna'||kind==='aana'){db[kind]={...(db[kind]||{}),...record,source:'user_entered',updatedAt:new Date().toISOString()};persist();cloudSaveKind(kind);render();return;}if(kind==='licenses')record.source='user_entered';if(kind==='payStubs'){record.agency=String(record.agency||'').trim();record.facility=String(record.facility||'').trim();record.frequency=normalizePayFrequency(record.frequency);for(const d of ['periodStart','periodEnd','payDate'])record[d]=psValidISO(record[d]);for(const a of ['gross','net'])record[a]=rateOrNull(record[a])==null?'':String(rateOrNull(record[a]));if(!record.agency){alert('Enter the agency / employer name first.');return}if(!record.frequency||!record.payDate){alert('A pay schedule needs a pay frequency and a pay date — the calendar dates come from those.');return}if(!editId)record.source='manual';}if(kind==='vehicles'){record.name=String(record.name||'').trim();record.make=String(record.make||'').trim();record.model=String(record.model||'').trim();record.year=String(record.year||'').trim();delete record.plate;record.isDefault=record.isDefault==='on';if(!record.name){alert('Give the vehicle a name first \u2014 e.g. 2022 Silverado.');return}}if(kind==='shifts'&&!String(record.pay).trim()){const f=facilityByNameOrAlias(record.facility);const p=f?facilityPayFor(f,record.type,record.date):0;if(p>0){record.pay=String(Math.round(p*100)/100);record.incomplete=false}else{record.pay='';record.incomplete=true}}if(kind==='shifts'&&String(record.pay).trim())record.incomplete=false;if(kind==='shifts')record.status=normalizeShiftStatus(record.status);// Newest edit wins on the calendar side needs a timestamp: stamp every
// app-side shift save (add or edit) so the sync engine can tell a newer
// local edit from the provider copy and push the update to the app-owned
// calendar. Before this the stamp was never set (updatedAt stayed null)
// and the server's local-newer check never fired, so an edited shift
// never left the app.
if(['shifts','licenses','nbcrnaCE','aanaCE','credentials','vehicles'].includes(kind))record.updatedAt=new Date().toISOString();if(kind==='facilities'){record.ratesSource='manual';record.ratesSourceFile='';record.ratesSourceDate='';for(const k of RATE_FIELDS)record[k]=rateOrNull(record[k])==null?'':String(rateOrNull(record[k]));if(rateOrNull(record.paidHours8)==null)record.paidHours8='';if(rateOrNull(record.distance)==null){record.distance='';record.distanceSource=''}else if(record.distanceSource!=='auto')record.distanceSource='manual';if(!String(record.address||'').trim()){record.lat='';record.lng='';record.geocodedAddress=''}else if(editId){const old=(db.facilities||[]).find(x=>x.id===editId);if(old&&String(old.address||'').trim()!==String(record.address||'').trim()){record.lat='';record.lng='';record.geocodedAddress='';if(record.distanceSource==='auto'){record.distance='';record.distanceSource=''}}}}if(kind==='mileage'){if(!record.milesSource)record.milesSource=String(record.miles||'').trim()?'manual':'';record.tripType=record.tripType==='one-way'?'one-way':'round-trip';const oldTrip=editId?(db.mileage||[]).find(m=>m.id===editId):null;if(oldTrip&&record.tripType!==oldTrip.tripType&&Number(oldTrip.oneWayMiles)>0&&oldTrip.milesSource==='auto'){record.miles=String(tripMilesFor(oldTrip.oneWayMiles,record.tripType));record.oneWayMiles=String(oldTrip.oneWayMiles)}else if(Number(record.oneWayMiles)>0&&record.milesSource==='auto'){record.miles=String(tripMilesFor(record.oneWayMiles,record.tripType))}else{record.oneWayMiles=oneWayFromTripMiles(record.miles,record.tripType)}record.origin=record.origin==='hotel'?'hotel':record.origin==='other'?'other':'home';record.originChosen=true;if(record.origin==='home')record.hotelAddress='';if(record.origin==='hotel'&&String(record.hotelAddress||'').trim())db.settings.lastHotelAddress=String(record.hotelAddress).trim();if(record.vehicleId!==undefined){const vv=vehicleById(record.vehicleId);record.vehicleId=vv?vv.id:'';record.vehicleName=vv?String(vv.name||''):''}else if(!editId){const dst=defaultVehicleStamp();record.vehicleId=dst.vehicleId;record.vehicleName=dst.vehicleName}}if(kind==='hotelStays'&&String(record.hotelAddress||'').trim())db.settings.lastHotelAddress=String(record.hotelAddress).trim();if(kind==='facilities'&&!editId){const existing=(db.facilities||[]).find(x=>facilityNameKey(x.name)===facilityNameKey(record.name)||(String(record.aliases||'').trim()&&facilityAliases(x).some(a=>String(record.aliases||'').split(',').map(y=>facilityNameKey(y)).includes(facilityNameKey(a)))));if(existing)editId=existing.id}if(kind==='facilities'&&!String(record.name||'').trim()){alert('Enter the hospital / facility name first.');return}if(kind==='facilities'&&editId){const oldF=(db.facilities||[]).find(x=>x.id===editId);if(oldF&&facilityNameKey(oldF.name)!==facilityNameKey(record.name)){const keep=[];const seenK=new Set();for(const a of facilityAliases(oldF).concat(String(record.aliases||'').split(',').map(y=>y.trim()).filter(Boolean))){const kk=facilityNameKey(a);if(kk&&kk!==facilityNameKey(record.name)&&!seenK.has(kk)){seenK.add(kk);keep.push(a)}}const oldName=String(oldF.name||'').trim();if(oldName&&!seenK.has(facilityNameKey(oldName)))keep.push(oldName);record.aliases=keep.join(', ')}}let savedId=editId;if(editId){const i=db[kind].findIndex(x=>x.id===editId);if(i>=0)db[kind][i]={...db[kind][i],...record};else{const rec={...record,id:id(),...(kind==='shifts'?{source:'user-entered'}:{})};if(kind==='shifts'){savedId=addShiftDeduped(rec).shift.id}else{db[kind].push(rec);savedId=rec.id}}}else{const rec={...record,id:id(),...(kind==='shifts'?{source:'user-entered'}:{})};if(kind==='shifts'){savedId=addShiftDeduped(rec).shift.id}else{db[kind].push(rec);savedId=rec.id}}editId=null;if(kind==='shifts')showShiftForm=false;if(kind==='mileage'){mileageFormDraft=null;mileageDraftHold=true;mileageCalcStatus=''}persist();if(kind==='vehicles'){const savedV=(db.vehicles||[]).find(v=>v.id===savedId);if(savedV&&savedV.isDefault){let clearedV=false;(db.vehicles||[]).forEach(v=>{if(v.id!==savedId&&v.isDefault){v.isDefault=false;clearedV=true;cloudSaveKind('vehicles',v.id)}});if(clearedV)persist();}}let repriced=0;if(kind==='facilities'){const saved=(db.facilities||[]).find(x=>x.id===savedId);if(saved&&String(saved.geocodedAddress||'').trim()&&String(saved.geocodedAddress||'').trim()!==String(saved.address||'').trim()){saved.lat='';saved.lng='';saved.geocodedAddress='';if(saved.distanceSource==='auto'){saved.distance='';saved.distanceSource=''}persist();}repriced=repriceUnpricedShiftsForFacility(saved);if(repriced>0)persist();}if(kind==='shifts'&&typeof window!=='undefined'&&typeof window.liveSyncMarkShiftNotSynced==='function')window.liveSyncMarkShiftNotSynced(savedId);
if(kind==='shifts'&&typeof window!=='undefined'&&typeof window.liveSyncSchedulePush==='function')window.liveSyncSchedulePush();if(kind==='facilities'&&typeof window!=='undefined'&&typeof window.liveSyncSchedulePush==='function')window.liveSyncSchedulePush();if(['licenses','nbcrnaCE','aanaCE','shifts','facilities','mileage','payStubs','vehicles'].includes(kind))cloudSaveKind(kind,savedId);if(kind==='facilities'){const saved=(db.facilities||[]).find(x=>x.id===savedId);if(saved){const hadSuggestion=clearFacilitySuggestion(saved.name);if(facilitySuggestionPrefill&&normFacilityName(facilitySuggestionPrefill.name)===normFacilityName(saved.name))facilitySuggestionPrefill=null;
  // Bug 2: a suggestion cleared by adding the facility means held
  // shifts exist for it. If the last import also skipped shifts as
  // legacy (paired by an earlier interrupted sync, migration 005 not
  // run), arm the one-shot repair so the next sync — which the
  // facility save already schedules — re-imports them instead of
  // leaving them blocked. Deleted shifts stay deleted: the server
  // only clears rows that are not flagged deleted and not tombstoned.
  if(hadSuggestion&&typeof liveSyncState!=='undefined'&&liveSyncState&&liveSyncState.lastImport&&Number(liveSyncState.lastImport.skippedLegacy||0)>0){liveSyncState.repairImport=true;if(typeof liveSyncStateSave==='function')liveSyncStateSave();}}}if(repriced>0)alert(`${repriced} unpriced shift(s) priced from the ${((db.facilities||[]).find(x=>x.id===savedId)||{}).name||'facility'} pay rule. The next calendar sync also re-scans past events for this facility.`);render()}
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
function actions(action,entry,date,from){if(action.startsWith('live-')){if(typeof liveSyncAction==='function')return liveSyncAction(action,entry);}if(action==='feature-toggle'){const fd=featureDef(entry);if(fd)setFeature(fd.key,!featureOn(fd.key));return;}if(action==='onboard-dismiss'){onboardStep=0;db.settings.onboardingDismissed=true;persist();return render();}if(action==='onboard-goto'){setTab(entry);const st=onboardingSteps().find(x=>x.tab===entry&&(x.panel||'')===(date||''));onboardStep=st?st.n:0;render();if(date){const el=document.getElementById(date);if(el){if(el.tagName==='DETAILS')el.open=true;if(el.scrollIntoView)el.scrollIntoView({block:'start'});}}return;}if(action==='prev')return moveMonth(-1);if(action==='next')return moveMonth(1);if(action==='today'){month=new Date();month.setDate(1);selected=localDate(new Date());return render()}if(action==='day')return selectDay(date);if(action==='add-shift'){tab='Dashboard';editId=null;showShiftForm=true;render();return;}if(action==='assistant-open'){assistantSheetOpen=true;render();return;}if(action==='assistant-close'){assistantSheetOpen=false;render();return;}if(action==='ask-assistant'){assistantSheetOpen=true;render();return;}if(action==='connect-portal'){const key=({NBCRNA:'nbcrna',AANA:'aana','State Licenses':'licenses'})[entry]||entry;return portalOpenSignIn(key);}
if(action==='monitor-prompt-dismiss'){const m=(db.portalMonitoring||[]).find(x=>x.key===entry);if(m){const t=localDate(new Date());m.promptDismissedCycle=monitorNextDue(m,t);m.snoozeUntil=addDaysStr(t,monitorCadence(m));persist();}return render();}
if(action==='monitor-toggle'){const m=(db.portalMonitoring||[]).find(x=>x.key===entry);if(m){m.enabled=!m.enabled;persist();}return render();}
if(action==='monitor-ack'){const m=(db.portalMonitoring||[]).find(x=>x.key===entry);if(m){m.changeFlag=false;persist();}return render();}
if(action==='monitor-assistant'){const m=(db.portalMonitoring||[]).find(x=>x.key===entry);if(m)return monitorAssistantCheck(m);return;}
if(action==='assistant-portal-check'){const src=({NBCRNA:'nbcrna',AANA:'aana','State Licenses':'licenses'})[entry]||entry;return startPortalCheck(src);}if(action==='portal-return'){const f=portalConnectFlow(entry);if(f)return f.returnToApp();return;}if(action==='portal-leave-go'){return portalLeaveGo(entry);}if(action==='portal-leave-cancel'){portalLeaveSheet='';return render();}if(action==='portal-check-cancel'){portalCheck=null;portalCheckError='';portalCheckOcrStatus='';portalStatePersist();return render();}if(action==='portal-guide-skip'){return portalGuideSkip();}if(action==='portal-guide-finish'){if(portalCheck){portalCheck.step='preview';portalCheckError='';portalStatePersist();}return render();}if(action==='ask'){return askAssistantLive(entry)}if(action==='clear-chat'){db.assistantChat=[];persist();return render()}if(action==='cancel'){if(tab==='Mileage'&&(db.mileage||[]).some(m=>m.id===editId)){mileageFormDraft=null;mileageDraftHold=true}editId=null;showShiftForm=false;facilitySuggestionPrefill=null;return render()}if(action==='shift-origin-quick')return setShiftTripOrigin(entry,date);
if(action==='shift-origin-dismiss'){callOriginPromptDismissed.add(entry);return render()}
if(action==='vehicle-default'){const v=(db.vehicles||[]).find(x=>x.id===entry);if(v){(db.vehicles||[]).forEach(o=>{const was=!!o.isDefault;o.isDefault=o.id===entry;if(was!==!!o.isDefault)cloudSaveKind('vehicles',o.id)});persist();}return render()}if(action==='mileage-autocalc')return calcMileageForForm();if(action==='facility-distance')return calcFacilityDistance();if(action==='edit-profile'){profileEditing=true;return render()}
if(action==='edit-addresses'){addressesEditing=true;return render()}
if(action==='edit-paystub'){editId=entry;tab='Facilities';paystubPreview=null;paystubError='';paystubStatus='';render();const el=document.getElementById('paystub-panel');if(el&&el.scrollIntoView)el.scrollIntoView({block:'start'});return;}
if(action==='delete-paystub'){if(!confirm("Delete this agency's pay schedule? Only this agency's estimated paychecks are removed — other agencies are untouched."))return;db.payStubs=(db.payStubs||[]).filter(x=>x.id!==entry);persist();cloudRecordTombstone('payStubs',entry);return render()}
if(action==='close-day'){dayViewOpen=false;if(paycheckEdit&&paycheckEdit.from==='day')paycheckEdit=null;render();return}
  if(action==='edit-paycheck'){paycheckEdit={stubId:entry,schedDate:date,from:from||'panel'};render();return}
  if(action==='paycheck-edit-cancel'){paycheckEdit=null;render();return}
  if(action==='paycheck-clear-actual'){const stub=(db.payStubs||[]).find(s=>s.id===entry);if(stub)savePaycheckOverride(stub,{schedDate:date,actual:''});paycheckEdit={stubId:entry,schedDate:date,from:from||'panel'};render();return}
  if(action==='delete-shifts'){const x=(db.shifts||[]).find(s=>s.id===entry);if(!x)return;shiftDeleteConfirm={id:entry,also:!!(db.settings&&db.settings.deleteAlsoFromCalendar)};render();return}
  if(action==='shift-delete-cancel'){shiftDeleteConfirm=null;render();return}
  if(action==='shift-delete-confirm'){return confirmShiftDelete(entry)}
  if(action.startsWith('edit-')){facilitySuggestionPrefill=null;const kind=action.slice(5);tab=({shifts:'Dashboard',facilities:'Facilities',credentials:'Credentials',mileage:'Mileage',hotelStays:'Mileage',vehicles:'Mileage',licenses:'Credentials',nbcrnaCE:'Credentials',aanaCE:'Credentials',documents:'Credentials'})[kind]||'Dashboard';if(['nbcrna','aana','licenses','credentials','nbcrnaCE','aanaCE'].includes(kind))manualType=({nbcrna:'NBCRNA',aana:'AANA',licenses:'State license',credentials:'Other credential',nbcrnaCE:'NBCRNA CE',aanaCE:'AANA CE'})[kind];editId=entry;if(kind==='shifts')showShiftForm=true;render();if(kind==='facilities')facilityScrollTo('facility-manual-panel');else if(kind==='vehicles'){const vel=document.getElementById('vehicles-panel');if(vel&&vel.scrollIntoView)vel.scrollIntoView({block:'start'})}else if(kind==='mileage'){const mel=document.getElementById('mileage-log-panel');if(mel&&mel.scrollIntoView)mel.scrollIntoView({block:'start'})}else if(kind!=='shifts')window.scrollTo(0,0);return}if(action.startsWith('delete-')){const kind=action.slice(7);if(!confirm(kind==='shifts'?'Delete this shift? It is removed from CRNA Hub right away. A shift imported from your calendar is not deleted from that calendar.':'Delete this record?'))return;if(kind==='shifts'){const gone=(db.shifts||[]).find(x=>x.id===entry);if(typeof window!=='undefined'&&typeof window.liveSyncRecordTombstone==='function')window.liveSyncRecordTombstone(entry);if(gone&&Array.isArray(db.mileage))db.mileage=db.mileage.filter(m=>!(m.status==='draft'&&mileageTripMatchesShift(m,gone)));}db[kind]=db[kind].filter(x=>x.id!==entry);persist();if(['licenses','nbcrnaCE','aanaCE'].includes(kind))cloudDeleteKind(kind,entry);if(kind==='documents')cloudDeleteDocument(entry);cloudRecordTombstone(kind,entry);return render()}if(action==='download-doc'){downloadDocument(entry);return;}if(action==='mileage-drafts')return makeMileageDrafts();if(action==='vehicles-goto'){tab='Mileage';editId=null;render();facilityScrollTo('vehicles-panel');return}if(action==='mileage-review-goto'){mileageReviewWeek=entry||'';tab='Mileage';editId=null;render();window.scrollTo(0,0);return}if(action==='mileage-review-prev')return mileageReviewStep(1);if(action==='mileage-review-next')return mileageReviewStep(-1);if(action==='mileage-review-generate')return generateWeeklyMileageDrafts(selectedMileageReviewWeek());if(action==='mileage-review-fix-facility')return mileageReviewFixAddress('facility',entry);if(action==='mileage-review-fix-home')return mileageReviewFixAddress('home','');if(action==='mileage-review-link-facility')return linkMileageFacility(entry,date);if(action==='mileage-review-confirm')return confirmWeeklyMileage(selectedMileageReviewWeek());if(action==='mileage-review-vehicle-apply'){const wk=selectedMileageReviewWeek();const selEl=$('mileageReviewVehicleSelect');const vid=(selEl&&selEl.value)||mileageReviewVehicleForWeek(wk);applyMileageReviewEdits(wk);if(vid){mileageReviewVehicleWeek=wk;mileageReviewVehicleId=vid;stampWeekVehicle(wk,vid)}persist();return render()}
if(action==='mileage-review-save'){applyMileageReviewEdits(selectedMileageReviewWeek());persist();return render()}if(action==='mileage-review-skip'){const m=(db.mileage||[]).find(x=>x.id===entry);if(m){m.status='skipped';persist()}return render()}if(action==='mileage-review-restore'){const m=(db.mileage||[]).find(x=>x.id===entry);if(m){m.status='draft';persist()}return render()}if(action==='mileage-clear-backlog'){const n=clearMileageBacklog();mileageClearStatus=n>0?('Cleared '+n+' older trip'+(n===1?'':'s')+' \u2014 they won\u2019t count toward mileage.'):'';return render()}if(action==='cloud-signup'){const em=$('f_email'),pw=$('f_password'),sn=$('f_scheduleName'),et=$('f_employmentType'),gl=$('f_incomeGoalStep1');if(!em||!pw||!em.value.trim()||!pw.value)return alert('Enter an email and password first.');cloudSignUp(em.value.trim(),pw.value,sn?String(sn.value||'').trim():'',et?String(et.value||'').trim():'',gl&&String(gl.value||'').trim()!==''?num(gl.value):undefined);return}
if(action==='skip-income-goal'){const gl=$('f_incomeGoalStep1');if(gl)gl.value='';cloudAuthStatus='No income goal set — you can set it later on the Account tab (Profile — step 1).';return render()}
if(action==='save-profile'){const nm=$('f_profileName'),et=$('f_profileEmploymentType'),gl=$('f_profileIncomeGoal');applyProfileValues({name:nm?String(nm.value||'').trim():'',employmentType:et?String(et.value||'').trim():'',monthlyIncomeGoal:gl&&String(gl.value||'').trim()!==''?num(gl.value):0});cloudSaveProfile();profileEditing=false;return render()}
if(action==='cloud-signout'){cloudSignOut();return}
if(action==='cloud-signout-clear'){cloudSignOutAndClearDevice();return}
if(action==='goto-account')return setTab('Account');if(action==='goto-mileage')return setTab('Mileage');

if(action==='facility-contract-approve')return approveFacilityContract();
if(action==='facility-suggestion-yes'){const sg=(db.facilitySuggestions||[]).find(x=>x.id===entry);if(!sg)return;facilitySuggestionPrefill={name:sg.name,address:sg.address||''};editId=null;tab='Facilities';render();facilityScrollTo('facility-three-ways-panel');return;}
if(action==='facility-suggestion-path'){const sg=(db.facilitySuggestions||[]).find(x=>x.id===entry);const nm=sg?sg.name:(facilitySuggestionPrefill&&facilitySuggestionPrefill.name)||'';if(!nm)return;facilitySuggestionPrefill={name:nm,address:(sg&&sg.address)||(facilitySuggestionPrefill&&facilitySuggestionPrefill.address)||''};editId=null;tab='Facilities';render();facilityScrollTo(date==='contract'?'facility-contract-panel':'facility-manual-panel');return;}
if(action==='facility-suggestion-dismiss'){const sg=(db.facilitySuggestions||[]).find(x=>x.id===entry);if(sg){sg.dismissed=true;sg.dismissedAt=new Date().toISOString();persist();}return render();}
if(action==='facility-suggestion-undismiss'){const sg=(db.facilitySuggestions||[]).find(x=>x.id===entry);if(sg){sg.dismissed=false;sg.dismissedAt='';persist();}return render();}
if(action==='facility-suggestion-review')return setTab('Facilities');
if(action==='facility-scroll-to'){facilityScrollTo(entry);return;}
if(action==='facility-contract-discard'){facilityContractPreview=null;facilityContractPendingImages=[];facilityContractOcrPages=[];facilityContractOcrStatus='';facilityContractError='';facilityContractCropNote='';facilityContractLastCropAdded=[];return render()}
if(action==='rule-use')return useRuleChatPreview();
if(action==='rule-discard'){ruleChatPreview=null;ruleChatError='';ruleChatMessages.push({who:'ai',text:'Rule discarded — nothing was saved. Describe it again any time.'});return render()}
if(action==='facility-reread-rates')return rereadFacilityRatesTable();
if(action==='facility-contract-ai')return readContractWithAI('facility');
if(action==='paystub-approve')return approvePaystub();
if(action==='paystub-discard'){paystubPreview=null;paystubError='';paystubStatus='';return render()}

if(action==='contract-ai')return readContractWithAI('contract');
if(action==='contract-ocr')return importContractWithOCR();
if(action==='facility-page-crop-reread')return rereadFacilityPageCropped(+entry);
if(action==='contract-page-crop-reread')return rereadContractPageCropped(+entry);
if(action==='facility-page-remove'||action==='facility-page-up'||action==='facility-page-down'){const i=+entry;if(Number.isNaN(i)||i<0||i>=facilityContractPendingImages.length)return render();const mv=action.endsWith('-up')?-1:action.endsWith('-down')?1:0;if(mv){const j=i+mv;if(j<0||j>=facilityContractPendingImages.length)return render();[facilityContractPendingImages[i],facilityContractPendingImages[j]]=[facilityContractPendingImages[j],facilityContractPendingImages[i]]}else facilityContractPendingImages.splice(i,1);facilityContractOcrPages=orderedOcrPages(facilityContractOcrPages,facilityContractPendingImages);if(facilityContractOcrPages.length){if(!reparseFacilityContractOcrPages()){facilityContractError='The remaining pages contain no facility name or rate. Nothing was saved.';facilityContractPreview=null}}else{facilityContractPreview=null;facilityContractError=''}return render()}

if(action==='contract-page-remove'||action==='contract-page-up'||action==='contract-page-down'){const i=+entry;if(Number.isNaN(i)||i<0||i>=contractPendingImages.length)return render();const mv=action.endsWith('-up')?-1:action.endsWith('-down')?1:0;if(mv){const j=i+mv;if(j<0||j>=contractPendingImages.length)return render();[contractPendingImages[i],contractPendingImages[j]]=[contractPendingImages[j],contractPendingImages[i]]}else contractPendingImages.splice(i,1);contractOcrPages=orderedOcrPages(contractOcrPages,contractPendingImages);if(contractOcrPages.length){if(!reparseContractOcrPages()){contractImportError='The remaining pages contain no shifts by deterministic parsing. Nothing was saved.';contractPreview=null}}else{contractPreview=null;contractImportError=''}return render()}
if(action==='view-contract-image')return viewContractImage(entry);
if(action==='view-contract-image-page')return viewContractImage(entry,+date);
if(action==='backup')return download('crna-hub-backup.json',deviceBackupJSON(),'application/json');if(action==='confirm-past-shifts')return confirmPastProposedShifts(entry);if(action==='cal-approve')return approveCalendarImport();if(action==='cal-discard'){calPreview=null;return render()}if(action==='schedule-approve')return approveScheduleImport();if(action==='schedule-discard'){schedulePreview=null;qgendaClearPending();return render()}if(action==='save-schedule-name'){const el=$('f_scheduleNameUpload');if(el){db.settings=db.settings||{};db.settings.scheduleName=String(el.value||'').trim();persist()}return render()}if(action==='qgenda-fetch')return fetchQgendaFeed();if(action==='qgenda-disconnect')return disconnectQgendaFeed();if(action==='qgenda-open'){try{window.open('https://app.qgenda.com','_blank','noopener')}catch(e){}return}if(action==='qgenda-check-it'){scheduleImportContext='qgenda';render();const el=document.getElementById('schedule-import-panel');if(el&&el.scrollIntoView)el.scrollIntoView({block:'start'});return}if(action==='qgenda-review'){scheduleImportContext='qgenda';setTab('Facilities');render();const el=document.getElementById('schedule-import-panel');if(el&&el.scrollIntoView)el.scrollIntoView({block:'start'});return}if(action==='qgenda-notice-dismiss'){qgendaNoticeDismissed=true;return render()}if(action==='export-cal-all')return exportCalendarICS(db.shifts.slice().sort((a,b)=>a.date.localeCompare(b.date)),'crna-hub-shifts.ics');if(action==='export-cal-month'){const prefix=localDate(new Date()).slice(0,7);return exportCalendarICS(db.shifts.filter(x=>x.date.startsWith(prefix)).sort((a,b)=>a.date.localeCompare(b.date)),'crna-hub-shifts-'+prefix+'.ics')}if(action==='connect-calendar'){setTab('Account');return}if(action==='export-shifts')return exportCsv('crna-hub-shifts.csv',['date','facility','type','pay','status','note'],db.shifts);if(action==='export-mileage'){mileageExportInit();mileageExportOpen=true;return render()}if(action==='mileage-export-close'){mileageExportOpen=false;return render()}if(action==='mileage-export-this-month'){mileageExportApplyQuick('this-month');return render()}if(action==='mileage-export-ytd'){mileageExportApplyQuick('ytd');return render()}if(action==='mileage-export-all'){mileageExportApplyQuick('all');return render()}if(action==='mileage-export-none'){mileageExportApplyQuick('none');return render()}if(action==='mileage-export-download')return mileageExportDownload()}
async function makeMileageDrafts(){let count=0,auto=0,hotel=0,skipped=0;const skippedNoAddress=new Set();for(const x of db.shifts){if(/off|pto/i.test(x.type))continue;const f=facilityForRecord(x);if(!f)continue;if(db.mileage.some(m=>mileageTripMatchesShift(m,x)))continue;const stay=hotelStayFor(x.date,x.facility);let oneWay=null,source='',origin='home',hotelAddress='';if(stay){const res=await homeToFacilityMiles(f,stay.hotelAddress);if(res){oneWay=res.oneWay;source='auto';origin='hotel';hotelAddress=stay.hotelAddress}}else{const autoRes=await homeToFacilityMiles(f);if(autoRes){oneWay=autoRes.oneWay;source='auto'}else{oneWay=effectiveOneWayMiles(f);source='manual'}}const draft=mileageDraftForShift(x,f,oneWay,source,origin,hotelAddress,mileageTripType());if(!draft){skipped++;if(!String(f.address||'').trim())skippedNoAddress.add(f.name);continue}db.mileage.push(draft);count++;if(source==='auto')auto++;if(origin==='hotel')hotel++}persist();render();alert(`${count} mileage draft(s) created (${tripTypeLabel(mileageTripType())})${auto?` — ${auto} auto-calculated${hotel?`, ${hotel} from a hotel stay`:''}`:''}.${skipped?` ${skipped} shift(s) skipped — no usable address or manual distance on file.`:''}${skippedNoAddress.size?` Trips for ${[...skippedNoAddress].join(', ')} were skipped: no address is saved for ${skippedNoAddress.size===1?'that facility':'those facilities'} — add it on the Facilities tab so miles can be calculated.`:''} Review every trip and tax eligibility before using them.`)}
function csvEscape(v){const s=String(v??'');return /[",\n\r]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s}
function exportCsv(filename,headers,rows){download(filename,[headers.join(','),...rows.map(r=>headers.map(h=>csvEscape(r[h])).join(','))].join('\r\n'),'text/csv;charset=utf-8')}
function download(filename,contents,mime){const a=document.createElement('a'),url=URL.createObjectURL(new Blob([contents],{type:mime}));a.href=url;a.download=filename;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),3000)}
function parseCSV(str){const rows=[],row=[];let cell='',quote=false;for(let i=0;i<str.length;i++){const c=str[i];if(c==='"'){if(quote&&str[i+1]==='"'){cell+='"';i++}else quote=!quote}else if(c===','&&!quote){row.push(cell);cell=''}else if((c==='\n'||c==='\r')&&!quote){if(c==='\r'&&str[i+1]==='\n')i++;row.push(cell);if(row.some(x=>x.trim()))rows.push(row.slice());row.length=0;cell=''}else cell+=c}row.push(cell);if(row.some(x=>x.trim()))rows.push(row);return rows}
async function importCsv(e){e.preventDefault();const f=$('f_importFile').files[0],input=f?await f.text():$('f_importText').value,rows=parseCSV(input.replace(/^\uFEFF/,''));let count=0,skipped=0;for(let i=0;i<rows.length;i++){const r=rows[i].map(x=>x.trim());if(i===0&&/date/i.test(r[0])&&!/^\d{4}-\d{2}-\d{2}$/.test(r[0]))continue;if(!/^\d{4}-\d{2}-\d{2}$/.test(r[0])||Number.isNaN(Date.parse(r[0]+'T12:00:00'))||!r[1]){skipped++;continue}const facility=r[1],type=r[2]||'Other',f=db.facilities.find(x=>x.name.toLowerCase()===facility.toLowerCase());let pay='',incomplete=true;if(r[3]!==undefined&&r[3]!==''){pay=String(num(r[3]));incomplete=false}else if(f){const p=facilityPayFor(f,type,r[0]);if(p>0){pay=String(p);incomplete=false}}const res=addShiftDeduped({id:id(),date:r[0],facility,type,pay,incomplete,status:importStatusForDate(r[0]),note:'CSV import',source:'csv-import',sources:['csv-import']});if(res.merged){skipped++;continue}count++}persist();render();alert(`Imported ${count} shift(s); skipped ${skipped} invalid or duplicate row(s).`)}
async function restoreBackup(e){const file=e.target.files[0];if(!file)return;try{const data=JSON.parse(await file.text());for(const key of ['shifts','facilities','pto','credentials','mileage'])if(!Array.isArray(data[key]))throw Error('Missing or invalid '+key);if(!confirm('Replace all current records with this backup?'))return;const next=empty();for(const k of ['shifts','facilities','pto','credentials','mileage'])next[k]=data[k];if(data.settings&&typeof data.settings==='object')next.settings={...next.settings,...data.settings};if(data.nbcrna&&typeof data.nbcrna==='object')next.nbcrna=data.nbcrna;if(data.aana&&typeof data.aana==='object')next.aana=data.aana;if(Array.isArray(data.nbcrnaCE))next.nbcrnaCE=data.nbcrnaCE;if(Array.isArray(data.aanaCE))next.aanaCE=data.aanaCE;if(Array.isArray(data.licenses))next.licenses=data.licenses;if(Array.isArray(data.documents))next.documents=data.documents;if(Array.isArray(data.assistantChat))next.assistantChat=data.assistantChat;if(Array.isArray(data.portalChecks))next.portalChecks=data.portalChecks;if(Array.isArray(data.portalMonitoring))next.portalMonitoring=data.portalMonitoring;if(Array.isArray(data.contracts))next.contracts=data.contracts;if(Array.isArray(data.payStubs))next.payStubs=data.payStubs;if(Array.isArray(data.hotelStays))next.hotelStays=data.hotelStays;normalizeStoredRates(next);db=next;dedupeShiftsInPlace();persist();render();alert(cloudActive&&cloudSession?'Backup restored onto this device only. It did NOT overwrite your cloud account. They merge with your account automatically on the next sync.':'Backup restored.')}catch(err){alert('Could not restore backup: '+err.message)}}

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
let ruleChatMessages=[],ruleChatPreview=null,ruleChatBusy=false,ruleChatError='';
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
 if(/holzer\s+8\s*\/\s*2nd|(?:2nd|21d|20d)\s+call|second\s+call/.test(l))return 'Second call';
 if(/24\s*-?\s*hour|24h\b|(?:1st|ist|lst)\s+call|first\s+call/.test(l))return '24-hour call';
 if(/\(main\)/.test(l))return '8-hour day';
 if(/holzer\s+12\b/.test(l))return '12-hour shift';
 if(/12\s*-?\s*hour|12h\b/.test(l))return '12-hour shift';
 if(/10\s*-?\s*hour|10h\b/.test(l))return '10-hour shift';
 if(/holzer\s+10\b/.test(l))return '10-hour shift';
 if(/holzer\s+8\b/.test(l))return '8-hour day';
 if(/8\s*-?\s*hour|8h\b|day\s+shift/.test(l))return '8-hour day';
 if(/\bcall\b/.test(l))return 'Call (unclassified)';
 return ''}
function contractFacilityForLine(line,globalFacility){const l=line;
 const known=(db.facilities||[]).map(f=>[f.name,...facilityAliases(f)]).flat().filter(Boolean).sort((a,b)=>b.length-a.length).find(n=>l.toLowerCase().includes(n.toLowerCase()));
 if(known){const f=facilityByNameOrAlias(known);return {name:f?f.name:known,fromSaved:true}}
 if(/^holzer\b/i.test(l.trim())||/\bholzer\s+(8|10|12|24)\b/i.test(l))return {name:'Holzer',fromSaved:false};
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
 flat('rate24',/\$([\d,]+(?:\.\d{2})?)(?:(?!hourly)[^$\n]){0,60}?(?:24\s*-?\s*hour|24h|1st call|first call)/i);
 flat('rate24',/(?:24\s*-?\s*hour|24h|1st call|first call)(?:(?!hourly)[^$\n]){0,60}?\$([\d,]+(?:\.\d{2})?)/i);
 flat('rateSecond',/\$([\d,]+(?:\.\d{2})?)[^$\n]{0,60}?(?:(?:2nd|21d|20d) call|second call)/i);
 flat('rateSecond',/(?:(?:2nd|21d|20d) call|second call)[^$\n]{0,60}?\$([\d,]+(?:\.\d{2})?)/i);
 flat('rate8',/\$([\d,]+(?:\.\d{2})?)[^$\n]{0,60}?(?:8\s*-?\s*hour|8h)/i);
 flat('rate8',/(?<!after\s)(?:8\s*-?\s*hour|8h\b)[^$\n]{0,60}?\$([\d,]+(?:\.\d{2})?)/i);
 flat('rate10',/\$([\d,]+(?:\.\d{2})?)[^$\n]{0,60}?(?:10\s*-?\s*hour|10h)/i);
 flat('rate10',/(?:10\s*-?\s*hour|10h)[^$\n]{0,60}?\$([\d,]+(?:\.\d{2})?)/i);
 flat('rate12',/\$([\d,]+(?:\.\d{2})?)[^$\n]{0,60}?(?:12\s*-?\s*hour|12h)/i);
 flat('rate12',/(?:12\s*-?\s*hour|12h)[^$\n]{0,60}?\$([\d,]+(?:\.\d{2})?)/i);
 flatWeekend('weekendRate24',/(?:weekend|saturday|sunday)[^$\n]{0,80}?(?:24\s*-?\s*hour|1st call)[^$\n]{0,40}?\$([\d,]+(?:\.\d{2})?)/i);
 flatWeekend('weekendRateSecond',/(?:weekend|saturday|sunday)[^$\n]{0,80}?(?:(?:2nd|21d|20d) call|second call)[^$\n]{0,40}?\$([\d,]+(?:\.\d{2})?)/i);
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
 fill('weekendRateSecond',/(?:(?:2nd|21d|20d) call|second call)[^$]{0,40}?weekend[^$]{0,220}?\$\s*([\d,]+(?:\.\d{2})?)/i);
 fill('weekendRateSecond',/(?:weekend|saturday|sunday)[^$]{0,220}?(?:(?:2nd|21d|20d) call|second call)[^$]{0,220}?\$\s*([\d,]+(?:\.\d{2})?)/i);
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
function contractResolvePay(row,rates,facilityObj,savedContract){const weekend=row.date?([0,6].includes(new Date(row.date+'T12:00:00').getDay())):false;
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
function parseFacilityContract(text,fileName){
  const clean=String(text||'').replace(/^\uFEFF/,'').replace(/--- Page \d+: [^\n]* ---/g,' ');
  const rates=contractExtractRates(clean);
  let parsed=null;try{parsed=parseContractText(clean,fileName)}catch(e){parsed={contract:{facility:'',effectiveStart:'',effectiveEnd:'',rates},rows:[]}}
  const names=[];
  const addName=n=>{n=String(n||'').trim().replace(/\s+(shift|call|day).*$/i,'').trim();if(!n)return;const li=n.toLowerCase();if(names.some(x=>x.toLowerCase()===li))return;if(names.some(x=>li.startsWith(x.toLowerCase()+' ')))return;const longer=names.findIndex(x=>x.toLowerCase().startsWith(li+' '));if(longer>=0)names[longer]=n;else names.push(n)};
  if(parsed.contract&&parsed.contract.facility)addName(parsed.contract.facility);
  for(const r of (parsed.rows||[]))if(r.facility)addName(r.facility);
  for(const f of (db.facilities||[])){if(clean.toLowerCase().includes(f.name.toLowerCase()))addName(f.name);for(const a of facilityAliases(f))if(a&&clean.toLowerCase().includes(a.toLowerCase()))addName(f.name)}
  if(/holzer/i.test(clean))addName('Holzer');
  const gen=clean.match(/([A-Z][A-Za-z'& ]{2,60}?(?:Hospital|Medical Center|Health System|Clinic))/g);
  if(gen)for(const g of gen)addName(g.trim());
  const acr=clean.match(/\b(CAMC|WVU|UPMC|HCA)\b/g);
  if(acr)for(const a of acr)addName(a);
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
  return {contract,facilities,shiftCount:(parsed.rows||[]).length,isPhoto:false};
}
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
   const facilityObj=facilityByNameOrAlias(facility);
   const savedContract=(db.contracts||[]).find(c=>(c.facility||'').toLowerCase()===facility.toLowerCase());
   const resolved=contractResolvePay({date:dateStr,type},rates,facilityObj,savedContract);flags.push(...resolved.flags);
   if((db.shifts||[]).some(x=>x.date===dateStr&&x.facility===facility&&x.type===type))flags.push('overlapping / duplicate shift already recorded');
   rows.push({date:dateStr,facility,type,pay:resolved.pay,paySource:resolved.source,flags,include:true,source:'extracted-from-contract',status:importStatusForDate(dateStr)})}
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
  function applyAiToFacilityPreview(data,fileName){const rates=(data&&data.rates)||{};const aiRates=aiRatesToContractRates(rates);const rawText=String((data&&data.raw_text)||rates.raw_text||'');if(facilityContractPreview){const added=mergeAiRatesIntoFacilityPreview(facilityContractPreview,aiRates);applyAiFacilityName(facilityContractPreview,rates);facilityContractPreview.aiRead=true;facilityContractPreview.aiNote=aiNoteFor(added,0);if(rawText&&!facilityContractPreview.ocrText)facilityContractPreview.ocrText=rawText;return true}const p=parseFacilityContract(rawText,fileName);p.isPhoto=true;p.fileName=fileName;p.aiRead=true;const added=mergeAiRatesIntoFacilityPreview(p,aiRates);applyAiFacilityName(p,rates);p.contract.method='ai-vision + deterministic-parse (gpt-4o-mini)';p.aiNote=aiNoteFor(added,0);const hasName=p.facilities.some(x=>String(x.name||'').trim());const hasRate=p.facilities.some(x=>Object.values(x.rates||{}).some(v=>v!=null&&v!==''));if(!hasName&&!hasRate)return false;facilityContractPreview=p;return true}
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
  paystubPreview=paystubPreviewFromParsed(parsed,fileName,'AI reading',true);
  return true;
}
async function readPaystubWithAI(){
  if(paystubBusy)return;
  const files=Array.from((($('f_paystubFile')||{}).files)||[]);
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
  const domFiles=Array.from((($('f_paystubFile')||{}).files)||[]);
  const images=(domFiles.length?domFiles:paystubPendingImages).filter(isImageFile);
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
    paystubPreview=paystubPreviewFromParsed(parsed,images.map(f=>f.name).join(', '),'Read on this device',false);
    paystubPreview.source='device-ocr';
    paystubStatus=note||'Read on this device — check it carefully.';paystubError='';render();
  }catch(err){paystubError='On-device reading failed: '+err.message+' Nothing was saved.';paystubStatus='';paystubPreview=null;render()}
  finally{paystubBusy=false}
}
async function importPaystub(e){
  e.preventDefault();paystubError='';paystubStatus='';paystubPreview=null;
  const files=$('f_paystubFile')?Array.from($('f_paystubFile').files||[]):[];
  const imageFiles=files.filter(isImageFile);
  if(imageFiles.length){
    // One action: stub photos are read with AI automatically. If AI
    // cannot run (signed out / not configured), the on-device read
    // takes over automatically and the preview says so — the user
    // never picks a reading method.
    paystubPendingImages=imageFiles;
    if(!SUPABASE_CONFIGURED||!cloudSession)return readPaystubOnDevice('AI reading needs sign-in, so this stub was read on your device instead — check it carefully.');
    return readPaystubWithAI();
  }
  try{
    let text='',fileName='pasted text';const f=files[0]||null;
    if(f){fileName=f.name;if(/\.pdf$/i.test(f.name)||f.type==='application/pdf')text=await extractPdfText(f);else text=await f.text()}
    else text=$('f_paystubText')?$('f_paystubText').value:'';
    if(!text.trim()){paystubError='Nothing to read: choose a pay stub photo or PDF, or paste the stub text first. Nothing was saved.';render();return}
    const parsed=parsePaystubText(text);
    if(!parsed.agency&&!parsed.payDate&&!parsed.gross&&!parsed.net){paystubError='No pay-stub fields were found in this text (no employer, pay date, or pay amount). Check the text, or upload a photo and use AI reading. Nothing was saved.';render();return}
    paystubPreview=paystubPreviewFromParsed(parsed,fileName,'Pasted text / text-layer PDF — deterministic parsing, no AI model read this document',false);
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
  if(ex&&ex.id!==rec.id){db.payStubs=(db.payStubs||[]).filter(x=>x.id!==ex.id);cloudRecordTombstone('payStubs',ex.id);}
  const i=(db.payStubs||[]).findIndex(x=>x.id===rec.id);
  if(i>=0)db.payStubs[i]={...db.payStubs[i],...rec};
  else db.payStubs.push(rec);
  const next=paystubNextPayDate(rec);
  paystubPreview=null;paystubError='';paystubStatus='';editId=null;persist();cloudSaveKind('payStubs',rec.id);render();
  alert(`Pay schedule saved for ${agency} — ${PAY_FREQUENCY_LABELS[frequency]}${next?`, next expected payday ${fmt(next)}`:''}. Each paycheck is calculated from your shifts in its pay period${(gross||net)?` — and this stub's own check (${fmt(payDate)}) counts as the actual ${currency(num(gross||net))} from the stub`:''}. Paychecks for ${agency} now show on the Dashboard and calendar, labelled estimate or actual.`);
}

function ocrDiagnosticsHTML(pages,files,text){return ''}
function contractPagesHTML(kind){const imgs=kind==='contract'?contractPendingImages:facilityContractPendingImages;const pages=kind==='contract'?contractOcrPages:facilityContractOcrPages;if(!imgs.length)return '';return `<div class="item"><strong>Contract pages (${imgs.length})</strong> <span class="muted">— read in this order. Move up / down to reorder, Remove to drop a page.</span><ol>${imgs.map((f,i)=>{const pg=(pages||[]).find(x=>x.file===f);const st=pg?ocrPageStatus(pg):'pending';const chars=pg?String(pg.text||'').trim().length:0;return `<li>${escapeHTML(f.name)}${pg?` — ${st==='ok'?chars+' characters read':st==='failed'?'could not be read':'no readable text'}`:''} <button type="button" data-action="${kind}-page-up" data-id="${i}" ${i===0?'disabled':''}>Move up</button> <button type="button" data-action="${kind}-page-down" data-id="${i}" ${i===imgs.length-1?'disabled':''}>Move down</button> <button type="button" class="secondary" data-action="${kind}-page-remove" data-id="${i}">Remove</button>${pg?` <select class="cropRegionSelect" data-kind="${kind}" data-i="${i}" aria-label="Which part of page ${i+1} to re-read">${['top','middle','bottom'].map(r=>`<option value="${r}" ${((cropRegionByPage[kind+':'+i]||'bottom')===r)?'selected':''}>${r} third</option>`).join('')}</select> <button type="button" data-action="${kind}-page-crop-reread" data-id="${i}">Re-read cropped</button>`:''}</li>`}).join('')}</ol></div>`}
function reparseContractOcrPages(){if(!contractOcrPages.length){contractPreview=null;return false}const names=contractPendingImages.map(f=>f.name);const fileName=names.join(', ');const text=combinedOcrText(contractOcrPages,contractPendingImages);const p=parseContractText(text,fileName);const cropText=combinedCropText(contractOcrPages,contractPendingImages);if(cropText.trim())mergeCropRatesIntoContractPreview(p,cropText);p.unreadableRates=detectUnreadableContractRates(text+(cropText.trim()?'\n'+cropText:''),p.contract&&p.contract.rates||{});p.rows.forEach(r=>{r.source='extracted-from-contract-photo';r.flags=['from photo — check carefully (OCR can misread digits and dates)',...r.flags]});p.contract.method='ocr + deterministic-parse (on-device OCR, no AI model, no server upload for OCR)';p.contract.source='extracted-from-contract-photo';contractPreview={...p,fileName,isPhoto:true,ocrText:text+(cropText.trim()?('\n\n'+cropSectionsText(contractOcrPages,contractPendingImages)):''),ocrPages:contractOcrPages,imageFileName:contractPendingImages[0].name,imageFileNames:names};return contractPreview.rows.length>0}
function reparseFacilityContractOcrPages(){if(!facilityContractOcrPages.length){facilityContractPreview=null;return false}const names=facilityContractPendingImages.map(f=>f.name);const text=combinedOcrText(facilityContractOcrPages,facilityContractPendingImages);const p=parseFacilityContract(text,names.join(', '));p.isPhoto=true;p.fileName=names.join(', ');const cropText=combinedCropText(facilityContractOcrPages,facilityContractPendingImages);facilityContractLastCropAdded=cropText.trim()?mergeCropRatesIntoFacilityPreview(p,cropText):[];p.ocrText=text+(cropText.trim()?('\n\n'+cropSectionsText(facilityContractOcrPages,facilityContractPendingImages)):'');p.ocrPages=facilityContractOcrPages;const un=detectUnreadableContractRates(p.ocrText,p.contract&&p.contract.rates||{});p.unreadableRates=un;for(const f of (p.facilities||[]))f.unreadable=un;facilityContractPreview=p;return p.facilities.some(x=>String(x.name||'').trim())||Object.values((p.facilities[0]||{}).rates||{}).some(v=>v!=null&&v!=='')}
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
 else{db.contracts=db.contracts||[];db.contracts.push({...contractPreview.contract,id:contractId,shiftCount:0})}
 let created=0,skipped=0,incomplete=0;
 for(const r of rows){const pay=String(r.pay||'').trim();const res=addShiftDeduped({id:id(),date:r.date,facility:r.facility.trim(),type:r.type,pay,status:importStatusForDate(r.date),source:r.source||'extracted-from-contract',sources:[r.source||'extracted-from-contract'],contractId,incomplete:!pay,note:`Extracted from contract: ${contractPreview.fileName} — check carefully, a read can misread digits and dates.${pay?'':' Pay not yet priced — incomplete.'}`});if(res.merged){skipped++;continue}if(!pay)incomplete++;created++}
 const c=(db.contracts||[]).find(x=>x.id===contractId);if(c){c.shiftCount=(db.shifts||[]).filter(x=>x.contractId===contractId).length;
   if(contractPreview.isPhoto&&contractPendingImages.length){try{for(let i=0;i<contractPendingImages.length;i++)await saveContractImage(contractId,contractPendingImages[i],i,contractPendingImages.length);c.imageFileName=contractPreview.imageFileName||contractPendingImages[0].name;c.imageFileNames=contractPendingImages.map(x=>x.name);c.imageStored='indexeddb';c.imageStorageNote='on-device only — cloud document storage not enabled yet'}catch(err){c.imageFileName=contractPreview.imageFileName||contractPendingImages[0].name;c.imageFileNames=contractPendingImages.map(x=>x.name);c.imageStored='failed';c.imageStorageNote='picture could not be stored on this device: '+err.message}}}
 contractPreview=null;contractPendingImages=[];contractOcrPages=[];contractOcrStatus='';persist();render();alert(`Approved: ${created} shift(s) created${incomplete?` (${incomplete} incomplete — pay not yet priced)`:''}${skipped?`; ${skipped} duplicate(s) merged into existing shifts`:''}. Contract record saved and linked to the new shifts.`)}
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
   facilityContractPreview=p;render()}catch(err){facilityContractError='Could not read this file: '+err.message+' Nothing was saved.';facilityContractPreview=null;render()}}
async function approveFacilityContract(){
 if(!facilityContractPreview)return;
 const entries=facilityContractPreview.facilities.filter(f=>f.include);
 const unnamed=entries.filter(f=>!String(f.name||'').trim());
 if(unnamed.length){alert('Enter a facility name for every facility you want to save — the contract did not state one. Uncheck it, or type its name in the preview.');return}
 const today=localDate(new Date());
 let contractId=facilityContractPreview.contract.id;
 const first=entries[0];
 const existingContract=(db.contracts||[]).find(c=>(c.facility||'').toLowerCase()===(first.name||'').toLowerCase()&&JSON.stringify(c.rates||{})===JSON.stringify(facilityContractPreview.contract.rates||{}));
 if(existingContract)contractId=existingContract.id;
 else{db.contracts=db.contracts||[];db.contracts.push({...facilityContractPreview.contract,id:contractId,facility:first.name,shiftCount:0})}
 let saved=0,updated=0,repriced=0;
 for(const f of entries){
   const name=String(f.name).trim();
   const existing=facilityByNameOrAlias(name)||(db.facilities||[]).find(x=>String(x.name||'').trim().toLowerCase()===name.toLowerCase());
   const rec={name,aliases:String(f.aliases||'').trim(),address:String(f.address||'').trim(),ratesSource:'contract',ratesSourceFile:facilityContractPreview.fileName||'',ratesSourceDate:today,contractId,contractEffectiveStart:f.effectiveStart||'',contractEffectiveEnd:f.effectiveEnd||''};
   for(const k of [...RATE_FIELDS,'paidHours8']){const v=f.rates&&f.rates[k];rec[k]=rateOrNull(v)==null?'':String(rateOrNull(v))}
   if(existing){
     // Merge only: a blank rate in the preview never wipes a rate the
     // facility already has — the document simply did not state it.
     const merged={...existing};
     for(const [k,v] of Object.entries(rec)){if(k==='name'||k==='aliases'||k==='address'){if(String(v||'').trim())merged[k]=v;continue}if(k==='ratesSource'||k==='ratesSourceFile'||k==='ratesSourceDate'||k==='contractId'||k==='contractEffectiveStart'||k==='contractEffectiveEnd'){if(String(v||'').trim())merged[k]=v;continue}if(v!==''&&v!=null)merged[k]=v}
     if(String(f.aliases||'').trim()&&!String(existing.aliases||'').includes(String(f.aliases).trim()))merged.aliases=String(existing.aliases?existing.aliases+', '+f.aliases.trim():f.aliases.trim());
     if(String(f.address||'').trim()&&String(existing.address||'').trim()!==String(f.address).trim()){merged.address=f.address.trim();merged.lat='';merged.lng='';merged.geocodedAddress='';if(merged.distanceSource==='auto'){merged.distance='';merged.distanceSource=''}}
     if(facilityNameKey(existing.name)!==facilityNameKey(merged.name))addFacilityAlias(merged,existing.name);
     const i=db.facilities.findIndex(x=>x.id===existing.id);db.facilities[i]=merged;updated++;
     repriced+=repriceUnpricedShiftsForFacility(merged);
   }else{
     const nf={...rec,id:id(),notes:''};db.facilities.push(nf);saved++;
     repriced+=repriceUnpricedShiftsForFacility(nf);
   }
 }
 const c=(db.contracts||[]).find(x=>x.id===contractId);
 if(c&&facilityContractPreview.isPhoto&&facilityContractPendingImages.length){try{await awaitSaveContractImage(c,facilityContractPendingImages,facilityContractPreview)}catch(err){c.imageFileName=facilityContractPreview.fileName||'';c.imageFileNames=facilityContractPendingImages.map(x=>x.name);c.imageStored='failed';c.imageStorageNote='picture could not be stored on this device: '+err.message}}
 facilityContractPreview=null;facilityContractPendingImages=[];facilityContractOcrPages=[];facilityContractOcrStatus='';facilityContractError='';persist();render();
 if(typeof window!=='undefined'&&typeof window.liveSyncSchedulePush==='function')window.liveSyncSchedulePush();
 alert(`Saved ${saved} new facilit${saved===1?'y':'ies'}${updated?`, updated ${updated} existing facilit${updated===1?'y':'ies'}`:''} from the contract${repriced?`. ${repriced} unpriced shift(s) priced from the new pay rule${repriced===1?'':''}`:''}. Rates are labelled “from contract” on the facilities list.`);
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
function cloudNbcrnaRow() { const n = db.nbcrna || {}; return { user_id: cloudUid(), certification_status: n.status || null, certification_number: n.number || null, period_start: n.periodStart || null, period_end: n.periodEnd || null, renewal_deadline: n.renewalDeadline || null, class_a_credits: cloudNumOrNull(n.classA), class_b_credits: cloudNumOrNull(n.classB), mac_ed_credits: cloudNumOrNull(n.macEd), mac_dev_credits: cloudNumOrNull(n.macDev), mac_ed_required: cloudNumOrNull(n.macEdRequired) || 60, mac_dev_required: cloudNumOrNull(n.macDevRequired) || 40, cpc_check_in_status: null, source: n.source || 'user_entered', last_synced_at: cloudNow() }; }
function cloudAanaRow() { const a = db.aana || {}; return { user_id: cloudUid(), membership_status: a.status || null, membership_number: a.number || null, expiration: a.expiration || null, source: a.source || 'user_entered', last_synced_at: cloudNow() }; }
function cloudLicenseRow(x) { return { id: x.id, user_id: cloudUid(), state: x.state, license_type: x.type, license_number: x.number || null, issue_date: x.issue || null, expiration_date: x.expiry || null, status: null, board_portal_url: x.portal || null, notes: x.note || null, source: x.source || 'user_entered', last_synced_at: cloudNow() }; }
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
function cloudApplyData(data) { cloudPortals = data.portals || []; if (data.nbcrna) { const r = data.nbcrna; const cm = { status: r.certification_status || '', number: r.certification_number || '', periodStart: r.period_start || '', periodEnd: r.period_end || '', renewalDeadline: r.renewal_deadline || r.period_end || '', source: r.source || 'user_entered', classA: r.class_a_credits === null || r.class_a_credits === undefined ? '' : String(r.class_a_credits), classB: r.class_b_credits === null || r.class_b_credits === undefined ? '' : String(r.class_b_credits), macEd: r.mac_ed_credits === null || r.mac_ed_credits === undefined ? '' : String(r.mac_ed_credits), macDev: r.mac_dev_credits === null || r.mac_dev_credits === undefined ? '' : String(r.mac_dev_credits), macEdRequired: r.mac_ed_required || 60, macDevRequired: r.mac_dev_required || 40, docNote: '', ceNote: '', reminders: '90,60,30,7', updatedAt: r.last_synced_at || '' }; db.nbcrna = cloudMergeSingleton(db.nbcrna || {}, cm, cloudLocalHasNbcrna(), true); cloudSyncTimes.nbcrna = r.last_synced_at || ''; } if (data.aana) { const r = data.aana; const cm = { status: r.membership_status || '', number: r.membership_number || '', expiration: r.expiration || '', source: r.source || 'user_entered', docNote: '', ceNote: '', reminders: '90,60,30,7', updatedAt: r.last_synced_at || '' }; db.aana = cloudMergeSingleton(db.aana || {}, cm, cloudLocalHasAana(), true); cloudSyncTimes.aana = r.last_synced_at || ''; } const licRem = {}; (db.licenses || []).forEach(x => { licRem[x.id] = x.reminders; }); const cloudLic = (data.licenses || []).map(r => ({ id: r.id, state: r.state, type: r.license_type, number: r.license_number || '', issue: r.issue_date || '', expiry: r.expiration_date || '', portal: r.board_portal_url || '', note: r.notes || '', source: r.source || 'user_entered', reminders: licRem[r.id] || '90,60,30,7', updatedAt: r.last_synced_at || '' })); db.licenses = cloudMergeList(db.licenses || [], cloudLic); if (cloudLic.length) cloudSyncTimes.licenses = cloudLic.map(x => x.updatedAt || '').sort().pop(); db.nbcrnaCE = cloudMergeList(db.nbcrnaCE || [], (data.ce || []).filter(r => r.source === 'nbcrna').map(r => ({ id: r.id, title: r.title || '', date: r.completed_date || '', credits: r.credits === null || r.credits === undefined ? '' : String(r.credits), class: r.credit_class || 'Class A', updatedAt: r.last_synced_at || '' }))); db.aanaCE = cloudMergeList(db.aanaCE || [], (data.ce || []).filter(r => r.source === 'aana').map(r => ({ id: r.id, title: r.title || '', date: r.completed_date || '', credits: r.credits === null || r.credits === undefined ? '' : String(r.credits), note: '', updatedAt: r.last_synced_at || '' }))); if (Array.isArray(data.documents)) { db.documents = cloudMergeList(db.documents || [], data.documents.map(r => ({ id: r.id, certType: r.cert_type || '', issue: r.issue_date || '', expiry: r.expiration_date || '', expirySource: r.expiry_source || 'user_entered', fileName: r.file_name || '', storagePath: r.storage_path || '', storageStatus: r.storage_path ? 'cloud' : 'local_details_only', uploadedAt: r.uploaded_at || '', updatedAt: r.uploaded_at || '' }))); }
if (Array.isArray(data.shifts)) db.shifts = cloudMergeSyncedList(db.shifts || [], data.shifts, 'shifts'); if (Array.isArray(data.facilities)) db.facilities = cloudMergeSyncedList(db.facilities || [], data.facilities, 'facilities'); if (Array.isArray(data.mileage)) db.mileage = cloudMergeSyncedList(db.mileage || [], data.mileage, 'mileage'); if (Array.isArray(data.payStubs)) db.payStubs = cloudMergeSyncedList(db.payStubs || [], data.payStubs, 'payStubs'); if (Array.isArray(data.vehicles)) db.vehicles = cloudMergeSyncedList(db.vehicles || [], data.vehicles, 'vehicles'); if (data.settings && typeof data.settings === 'object') { db.settings = cloudMergeSettings(db.settings || {}, data.settings); cloudSettingsSnapshot = cloudSettingsContent(db.settings); try { localStorage.setItem('crna-hub-settings-snapshot', cloudSettingsSnapshot); } catch (e) {} }
cloudActive = true; cloudOffline = false; cloudError = ''; cloudLastSync = cloudNow(); cloudPersistSession(); persist(); }
async function cloudAutoMerge() { if (!cloudSession) return false; try { const data = await cloudFetchAll(); cloudApplyData(data); dedupeShiftsInPlace((absorbedId) => { cloudRecordTombstone('shifts', absorbedId); }); render(); await cloudUploadLocal({ silent: true }); return true; } catch (e) { cloudOffline = true; cloudError = e.message; render(); return false; } }
async function cloudAfterSignIn() { await cloudAutoMerge(); render(); setTab('Account'); monitorBackgroundSweep(); qgendaBootCheck(); }
async function submitCloudAuth(e) { e.preventDefault(); const fd = new FormData(e.currentTarget); const email = String(fd.get('email') || '').trim(), password = String(fd.get('password') || ''); const sn = String(fd.get('scheduleName') || '').trim(); const et = String(fd.get('employmentType') || '').trim(); const goalRaw = String(fd.get('incomeGoalStep1') || '').trim(); // Profile fields on the sign-in form save locally when provided —
  // a blank field never wipes a saved value.
  applyProfileValues({ name: sn, employmentType: et, monthlyIncomeGoal: goalRaw === '' ? undefined : num(goalRaw) }); if (!email || !password) { cloudAuthStatus = 'Enter an email and password.'; render(); return alert('Enter an email and password.'); } cloudAuthStatus = 'Signing in\u2026'; render(); try { const data = await sbAuthReq('/auth/v1/token?grant_type=password', { email: email, password: password }); if (!cloudStoreSession(data)) throw new Error('Sign-in succeeded but no session was returned. If email confirmation is required, confirm from your inbox, then sign in again.'); cloudAuthStatus = ''; await cloudAfterSignIn(); } catch (err) { let msg = err.message || ''; if (/email not confirmed/i.test(msg)) msg = 'Email not confirmed yet \u2014 check your inbox for the confirmation email, open its link, then sign in again.'; cloudAuthStatus = 'Sign-in failed: ' + msg; render(); alert('Sign-in failed: ' + msg); } }
async function cloudSignUp(email, password, scheduleNm, employment, monthlyGoal) { cloudAuthStatus = 'Creating account\u2026'; render(); // Profile fields save locally first, then ride along in the signup
  // user_metadata (profileMetadata) so the account is created with them.
  applyProfileValues({ name: scheduleNm || '', employmentType: employment || '', monthlyIncomeGoal: monthlyGoal }); try { const signupBody = { email: email, password: password, data: profileMetadata() }; const data = await sbAuthReq('/auth/v1/signup', signupBody); if (!cloudStoreSession(data)) { cloudAuthStatus = 'Account created. If Supabase requires email confirmation, confirm from your inbox, then sign in with the form above.'; render(); alert('Account created. If Supabase requires email confirmation, confirm from your inbox, then sign in with the form above.'); return; } cloudAuthStatus = ''; await cloudAfterSignIn(); } catch (err) { let msg = err.message || ''; if (/email rate limit/i.test(msg)) msg = 'Too many confirmation emails were sent recently \u2014 wait a little while and try again, or sign in if the account was already created.'; cloudAuthStatus = 'Sign-up failed: ' + msg; render(); alert('Sign-up failed: ' + msg); } }
async function cloudSignOut() { try { if (cloudSession) await sbAuthReq('/auth/v1/logout', {}, { token: cloudSession.access_token }); } catch (e) {} cloudSession = null; cloudActive = false; cloudOffline = false; cloudError = ''; cloudPersistSession(); render(); }
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
  Object.keys(portalFlows).forEach(k => { delete portalFlows[k]; });
  docStorageError = ''; docOcrStatus = '';
  mileageCalcStatus = ''; facilityDistanceStatus = ''; homeGeocodeStatus = ''; mileageClearStatus = '';
  profileEditing = false; addressesEditing = false;
  mileageReviewWeek = ''; mileageLogMonth = '';
  callOriginPromptDismissed = new Set();
  schedulePreview = null; scheduleImportError = ''; scheduleAiStatus = ''; scheduleImportContext = '';
  qgendaStatusLoaded = false; qgendaStatusError = '';
  contractPreview = null; contractImportError = '';
  facilityContractPreview = null; facilityContractError = ''; facilityContractOcrStatus = ''; facilityContractPendingImages = []; facilityContractOcrPages = []; facilityContractFallbackNote = ''; facilityContractCropNote = ''; facilityContractLastCropAdded = [];
  ruleChatMessages = []; ruleChatPreview = null; ruleChatBusy = false; ruleChatError = '';
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
  resetDeviceLocalState();
  cloudPersistSession();
  try { localStorage.removeItem('crna-hub-last-sync'); } catch (e) {}
  render();
}
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
  return `<section class="panel" id="profile-panel"><h2>Profile — step 1</h2><p class="muted">Your profile — change anything, any time.</p><div class="form-grid">${field('profileName', 'Name as it appears on your schedule and licenses', 'text', profileName(), 'placeholder="e.g. C. Martin" autocomplete="off"')}${selectLabeled('profileEmploymentType','Employment type',[['','Select employment type'],['w2','W-2 — employed'],['1099','1099 — independent contractor'],['both','Both W-2 and 1099']],employmentType())}${field('profileIncomeGoal', 'Monthly income goal ($) — blank unsets it', 'number', monthlyIncomeGoal()>0?monthlyIncomeGoal():'', 'min="0" step="1" placeholder="e.g. 40000"')}</div><div class="toolbar"><button type="button" data-action="save-profile">Save profile</button></div><p class="muted">Employment type: ${escapeHTML(employmentTypeLabel())} — W-2 salary days are never double-counted; 1099 shifts price from contracts and facilities. Monthly goal: ${monthlyIncomeGoal()>0?currency(monthlyIncomeGoal()):'not set'}.</p></section>`;
}
function accountPage() {
  const home = homeAddressSection() + featuresSectionHTML();
  if (!SUPABASE_CONFIGURED) return onboardDirectionHTML(1) + `<section class="panel"><h2>Account</h2><p><strong>Sign-in isn’t available yet.</strong> Everything is saved on this device only.</p></section>` + home + syncSectionHTML() + backupHTML();
  if (!cloudSession) return onboardDirectionHTML(1) + `<section class="panel"><h2>Account — sign in to sync credentials</h2><p class="muted">Create your account, add the name as it appears on your schedule and licenses, pick W-2, 1099, or both, and set a monthly income goal — or skip it.</p><form id="cloudAuthForm"><div class="form-grid">${field('email', 'Email', 'email', '', 'required autocomplete="email"')}${field('password', 'Password', 'password', '', 'required autocomplete="current-password"')}${field('scheduleName', 'Name as it appears on your schedule and licenses', 'text', (db.settings && db.settings.scheduleName) || '', 'placeholder="e.g. C. Martin" autocomplete="off"')}${selectLabeled('employmentType','Employment type',[['','Select employment type'],['w2','W-2 — employed'],['1099','1099 — independent contractor'],['both','Both W-2 and 1099']],employmentType())}${field('incomeGoalStep1', 'Monthly income goal ($) — optional', 'number', monthlyIncomeGoal()>0?monthlyIncomeGoal():'', 'min="0" step="1" placeholder="e.g. 40000"')}</div><div class="toolbar"><button type="button" class="secondary tiny" data-action="skip-income-goal">Skip — I\u2019ll set this later</button></div><p class="muted">No goal yet? No worries — skip it and set one later.</p>${formEnd('Sign in')}</form>${cloudAuthStatus ? `<p class="hint" id="cloudAuthStatus">${escapeHTML(cloudAuthStatus)}</p>` : ''}<div class="toolbar"><button type="button" class="secondary" data-action="cloud-signup">Create account</button></div><p class="muted">If we email you a confirmation, tap it, then sign in.</p></section>` + home + syncSectionHTML() + backupHTML();
  const profileSection = profileSectionHTML();
  return onboardDirectionHTML(1) + profileSection + `<section class="panel"><h2>Account</h2><p><strong>Signed in as ${escapeHTML(cloudSession.email || '')}.</strong></p>${cloudLastSync ? `<p class="muted">Last sync: ${escapeHTML(cloudFmtWhen(cloudLastSync))}</p>` : ''}${cloudError ? `<p class="muted">Last sync problem: ${escapeHTML(cloudError)}</p>` : ''}<p class="muted">Your records sync with your account automatically — newest edit wins, and nothing one-sided is ever overwritten or deleted.</p><div class="toolbar"><button class="secondary" data-action="cloud-signout">Sign out</button><button class="secondary" data-action="cloud-signout-clear">Sign out &amp; clear this device</button></div></section>` + home + syncSectionHTML() + backupHTML();
}
if (typeof window !== 'undefined' && window && typeof window.addEventListener === 'function') { try { window.addEventListener('online', () => { if (cloudSession) cloudAutoMerge(); }); } catch (e) {} }
async function cloudInit() { if (!SUPABASE_CONFIGURED || !cloudSession) return; try { await cloudEnsureToken(); } catch (e) { cloudSession = null; cloudActive = false; cloudPersistSession(); render(); return; } await cloudAutoMerge(); render(); monitorBackgroundSweep(); qgendaBootCheck(); }

// Boot (Nov 6, 2026): the first render is hardened — if anything in the
// first paint throws, the user still gets the tab bar and a visible error
// panel with a reload button, never a silent blank page (the boot watchdog
// in index.html is the second net, for failures before this file runs).
function bootRender(){try{render()}catch(e){try{console.error(e)}catch(_){ } const navEl=$('nav');if(navEl&&!navEl.innerHTML){navEl.innerHTML=tabs.map(t=>`<button class="${tab===t?'active':''}" data-tab="${escapeHTML(t)}">${escapeHTML(t)}</button>`).join('');try{navEl.querySelectorAll('[data-tab]').forEach(b=>b.addEventListener('click',()=>setTab(b.dataset.tab)))}catch(_){ }} const appEl=$('app');if(appEl)appEl.innerHTML=`<section class="panel"><h2>Something went wrong starting CRNA Hub</h2><p class="muted">${escapeHTML(String((e&&e.message)||e))}</p><p class="muted">Your saved data on this device is not affected. Tap a tab above to try that page, or reload.</p><p><button type="button" onclick="location.reload()">Reload</button></p></section>`}}
portalCheckRestore();bootRender();cloudInit();if('serviceWorker'in navigator&&location.protocol==='https:')navigator.serviceWorker.register('./sw.js').then(reg=>{const promptReload=()=>{if(confirm('A newer version of CRNA Hub is available. Reload now to use it?'))window.location.reload()};if(reg.waiting)promptReload();reg.addEventListener('updatefound',()=>{const sw=reg.installing;if(!sw)return;sw.addEventListener('statechange',()=>{if(sw.state==='installed'&&navigator.serviceWorker.controller)promptReload()})});try{const p=reg.update();if(p&&p.catch)p.catch(()=>{})}catch(e){}}).catch(()=>{});
