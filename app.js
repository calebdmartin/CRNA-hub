'use strict';
const KEY='crna-hub-v2',OLD='crna-hub-starter-v1',tabs=['Account','Dashboard','Facilities','PTO','Credentials','Mileage','Assistant'];
const empty=()=>({shifts:[],facilities:[],pto:[],credentials:[],mileage:[],contracts:[],payStubs:[],nbcrna:{status:'',number:'',periodStart:'',periodEnd:'',renewalDeadline:'',classA:'',classB:'',macEd:'',macDev:'',macEdRequired:60,macDevRequired:40,docNote:'',ceNote:'',reminders:'90,60,30,7',source:'user_entered'},aana:{status:'',number:'',expiration:'',docNote:'',ceNote:'',reminders:'90,60,30,7',source:'user_entered'},nbcrnaCE:[],aanaCE:[],licenses:[],documents:[],assistantChat:[],portalChecks:[],portalMonitoring:[],hotelStays:[],facilitySuggestions:[],settings:{monthlyIncomeGoal:0,employmentType:'',scheduleName:'',scheduleImported:false,scheduleImportFile:'',scheduleImportedAt:'',qgendaConnected:false,qgendaMasked:'',ptoAnnual:0,ptoStarting:0,ptoHoursPerPeriod:0,homeAddress:'',homeLat:'',homeLng:'',homeGeocodedAddress:'',lastHotelAddress:'',mileageTripType:'round-trip'}});
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
  return obj;
}
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
const SHIFT_STATUSES=['proposed','submitted','confirmed','rejected','canceled','completed'];
// Helpers MUST be declared before load() runs below: load() ->
// normalizeStoredRates() calls num() on any stored shift/pay stub, so
// declaring these consts after `let db=load()` was a temporal-dead-zone
// crash ("Cannot access 'num' before initialization") for every user
// with saved data — the app only booted on empty storage (Nov 6, 2026).
const $=id=>document.getElementById(id),escapeHTML=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c])),currency=n=>Number(n||0).toLocaleString('en-US',{style:'currency',currency:'USD',maximumFractionDigits:2}),num=n=>Number(n||0),id=()=>crypto.randomUUID(),fmt=d=>new Date(d+'T12:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});
let db=load(),tab='Dashboard',showShiftForm=false,dayViewOpen=false,manualType='NBCRNA',month=new Date(),selected=localDate(new Date()),editId=null,savedShiftsYear=null,facilitySuggestionPrefill=null;month.setDate(1);
function localDate(d){return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-')}
// Income totals are scoped to one calendar year at a time (default: the
// current calendar year). Shifts from other years stay in the list and
// the calendar — they are simply out of that year's total, never deleted.
function currentYear(){return new Date().getFullYear()}
function shiftYears(){const ys=[...new Set((db.shifts||[]).map(x=>String(x.date||'').slice(0,4)).filter(y=>/^\d{4}$/.test(y)))].sort();if(!ys.includes(String(currentYear())))ys.push(String(currentYear()));return ys.sort()}
function selectedShiftsYear(){const y=savedShiftsYear||currentYear();return shiftYears().includes(String(y))?+y:currentYear()}
function shiftsForYear(y){const p=String(y)+'-';return (db.shifts||[]).filter(x=>String(x.date||'').startsWith(p))}
// --- Shift status: confirmed / submitted / proposed (C/S/P) ---
// Every shift carries a status. Manually added shifts start as
// 'proposed' until the user moves them along (proposed -> submitted ->
// confirmed). Imported shifts are different (Bug 1, Nov 6, 2026): a
// shift dated before today already happened, so it arrives as
// 'confirmed' — see importStatusForDate below. 'rejected' and
// 'canceled' shifts count in NO total. 'completed' is confirmed work
// already done, so it counts with confirmed. A missing or unknown
// status (older data) defaults to 'proposed' — never silently treated
// as confirmed income.
const SHIFT_STATUS_LABELS={proposed:'Proposed',submitted:'Submitted',confirmed:'Confirmed',rejected:'Rejected',canceled:'Canceled',completed:'Completed'};
function normalizeShiftStatus(s){const v=String(s||'').trim().toLowerCase();return SHIFT_STATUSES.includes(v)?v:'proposed'}
// Status a shift arrives with at import time (Bug 1, Nov 6, 2026):
// dated before today (local date) it already happened, so it arrives
// 'confirmed' — otherwise a user whose whole history imported as
// proposed sees $0 in Confirmed (C) and Submitted (S) year-to-date.
// Future shifts, and today's shift (not over yet), stay 'proposed'.
// An invalid or missing date stays 'proposed': never silently confirm
// a shift with no date. Only the import stamp uses this — a stored
// status is never rewritten by a later sync, and the user can still
// change any shift's status by hand (or with "Mark past shifts as
// confirmed" below).
function importStatusForDate(date,todayStr){const d=String(date||'').trim();if(!/^\d{4}-\d{2}-\d{2}$/.test(d))return 'proposed';const today=todayStr||localDate(new Date());return d<today?'confirmed':'proposed'}
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
// Split one calendar year's billable shifts at today into three totals:
//   C = confirmed only (confirmed + completed — completed is confirmed
//       work already done),
//   S = submitted-inclusive (C + submitted — income if every submitted
//       date is approved),
//   P = proposed-inclusive (S + proposed — possible income, not confirmed).
// Each total has a year-to-date part (dated today or earlier) and a
// predicted-annual part (YTD + still scheduled). Rejected and canceled
// shifts count in no total. Unpriced and W-2 salary shifts are excluded
// from all three totals and counted separately. Deterministic: plain
// sums over the stored shifts, no model arithmetic. The legacy
// ytd/futureGross/predicted fields stay mapped to P (proposed-inclusive),
// the single combined total this function used to return, so existing
// callers keep working.
function yearIncomeSplit(y,todayStr){const today=todayStr||localDate(new Date());const shifts=shiftsForYear(y);const priced=shifts.filter(isBillableShift);const unpriced=shifts.filter(x=>!isPricedShift(x)&&!isW2SalaryShift(x));const w2=shifts.filter(isW2SalaryShift);const bucket=statuses=>{const inB=priced.filter(x=>statuses.includes(normalizeShiftStatus(x.status)));const past=inB.filter(x=>String(x.date||'')<=today);const future=inB.filter(x=>String(x.date||'')>today);const ytd=past.reduce((a,x)=>a+num(x.pay),0);const fut=future.reduce((a,x)=>a+num(x.pay),0);return {ytd:ytd,future:fut,predicted:ytd+fut,pastCount:past.length,futureCount:future.length,count:inB.length}};const c=bucket(['confirmed','completed']);const s=bucket(['confirmed','completed','submitted']);const p=bucket(['confirmed','completed','submitted','proposed']);return {c:c,s:s,p:p,ytd:p.ytd,futureGross:p.future,predicted:p.predicted,futureCount:p.futureCount,pastCount:p.pastCount,unpriced:unpriced.length,unpricedFuture:unpriced.filter(x=>String(x.date||'')>today).length,w2Salary:w2.length,w2SalaryPriced:w2.filter(isPricedShift).length,proposedFuture:priced.filter(x=>String(x.date||'')>today&&normalizeShiftStatus(x.status)==='proposed').length,byStatus:{proposed:countByStatus(priced,['proposed']),submitted:countByStatus(priced,['submitted']),confirmed:countByStatus(priced,['confirmed']),completed:countByStatus(priced,['completed']),rejected:countByStatus(priced,['rejected']),canceled:countByStatus(priced,['canceled'])},total:shifts.length}}
// Same C/S/P split for one calendar month (prefix 'YYYY-MM'), whole month
// (no past/future split — the month is the unit the income goal tracks).
function monthIncomeSplit(prefix){const shifts=(db.shifts||[]).filter(x=>String(x.date||'').startsWith(prefix));const priced=shifts.filter(isBillableShift);return {c:sumByStatus(priced,['confirmed','completed']),s:sumByStatus(priced,['confirmed','completed','submitted']),p:sumByStatus(priced,['confirmed','completed','submitted','proposed']),byStatus:{proposed:countByStatus(priced,['proposed']),submitted:countByStatus(priced,['submitted']),confirmed:countByStatus(priced,['confirmed']),completed:countByStatus(priced,['completed'])},unpriced:shifts.filter(x=>!isPricedShift(x)&&!isW2SalaryShift(x)).length,w2Salary:shifts.filter(isW2SalaryShift).length,total:shifts.length}}
// --- Pay stubs: one pay schedule per agency / employer (Nov 5, 2026) ---
// One stub per agency: the user uploads a pay stub (photo or PDF, or
// pastes its text) and the app reads the pay frequency, pay period,
// pay date, and gross/net per check — AI vision first (extract-contract
// mode 'paystub', same server function and key as contracts), deterministic
// text parsing for pasted text / text-layer PDFs. NOTHING is saved until
// the user checks the preview and approves it; the stub photo/PDF itself
// is never stored — the extracted schedule is what is saved, on this
// device only, like shifts and facilities (no cloud sync for pay stubs
// in this release, and no new migration). A stub is optional: facilities
// and contracts work without one.
// Each agency gets its own schedule — never merged into one combined
// paycheck. Two agencies paying on the same date show as two separate
// entries, each labelled with its agency. Re-uploading a stub for an
// agency replaces only that agency's schedule; deleting a stub removes
// only that agency's estimated paychecks. Every generated paycheck is
// an ESTIMATE, labelled as such on the calendar and in the list, with
// the paystub disclaimer — never added into the C/S/P shift-income
// totals, so the same pay is never counted twice. Estimated paychecks
// appear on the in-app Dashboard calendar only; they are NOT pushed to
// Google / Apple / Outlook — estimates do not belong in the user's real
// calendar unasked.
const PAY_FREQUENCIES=['weekly','biweekly','semi-monthly','monthly'];
const PAY_FREQUENCY_LABELS={weekly:'Weekly',biweekly:'Every 2 weeks','semi-monthly':'Twice a month (semi-monthly)',monthly:'Monthly'};
const PAYSTUB_DISCLAIMER='Paycheck dates and amounts are estimates from your pay stub — always double-check them against your actual paystubs. CRNA Hub is not liable for mistakes.';
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
// Every estimated paycheck for one stub inside [fromISO, toISO].
// Steps from the stub's own pay date, so the cadence never drifts from
// what the stub actually showed.
function paystubOccurrences(stub,fromISO,toISO){const out=[];if(!stub||!psValidISO(stub.payDate)||!normalizePayFrequency(stub.frequency))return out;const anchor=+stub.payDate.slice(8,10);let d=stub.payDate,guard=0;while(d<fromISO&&guard++<400){const n=paystubStepDate(d,stub.frequency,anchor);if(!n||n<=d)return out;d=n}guard=0;while(d<=toISO&&guard++<120){out.push({date:d,gross:stub.gross||'',net:stub.net||'',agency:stub.agency||'',facility:stub.facility||'',stubId:stub.id||''});const n=paystubStepDate(d,stub.frequency,anchor);if(!n||n<=d)break;d=n}return out}
function paystubOccurrencesInMonth(prefix){const y=+prefix.slice(0,4),m=+prefix.slice(5,7),from=prefix+'-01',to=prefix+'-'+String(psDaysInMonth(y,m)).padStart(2,'0');const all=[];for(const s of (db.payStubs||[]))all.push(...paystubOccurrences(s,from,to));all.sort((a,b)=>a.date.localeCompare(b.date)||String(a.agency).localeCompare(String(b.agency)));return all}
function paystubUpcoming(limit,todayStr){const today=todayStr||localDate(new Date());const to=psAddDays(today,120);const all=[];for(const s of (db.payStubs||[]))all.push(...paystubOccurrences(s,today,to));all.sort((a,b)=>a.date.localeCompare(b.date)||String(a.agency).localeCompare(String(b.agency)));return all.slice(0,limit||6)}
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
function paystubPreviewHTML(){
  if(paystubError)return `<p class="hint">${escapeHTML(paystubError)}</p>`;
  if(!paystubPreview)return '<p class="muted">No pay stub read yet. Upload a photo or PDF, or paste its text below, then check the preview — nothing is saved until you approve it.</p>';
  const p=paystubPreview;
  const ex=p.agency?paystubForAgency(p.agency):null;
  const replaces=ex&&ex.id!==p.id;
  return `<p><strong>Read from:</strong> ${escapeHTML(p.fileName||'pasted text')} · <strong>Method:</strong> ${escapeHTML(p.method||'')}</p><p><strong>Nothing is saved yet.</strong> Correct anything wrong below, then save. Fields the stub did not state are left blank — blank means “not stated”, never $0. ${p.found&&p.found.length?('Found: '+escapeHTML(p.found.join(', '))+'.'):''}</p>${replaces?`<p class="hint">This will replace the existing pay schedule for ${escapeHTML(p.agency)} — the old schedule is removed when you save. Other agencies are untouched.</p>`:''}<div class="form-grid"><div class="field"><label for="f_payPrev_agency">Agency / employer *</label><input id="f_payPrev_agency" class="paystubEdit" data-field="agency" type="text" value="${escapeHTML(p.agency||'')}" placeholder="e.g. Premier Anesthesia Group"></div><div class="field"><label for="f_payPrev_facility">Facility (if the stub names one)</label><input id="f_payPrev_facility" class="paystubEdit" data-field="facility" type="text" value="${escapeHTML(p.facility||'')}" placeholder="e.g. Holzer"></div><div class="field"><label for="f_payPrev_frequency">Pay frequency *</label><select id="f_payPrev_frequency" class="paystubEdit" data-field="frequency"><option value="">— choose —</option>${PAY_FREQUENCIES.map(f=>`<option value="${f}" ${f===p.frequency?'selected':''}>${PAY_FREQUENCY_LABELS[f]}</option>`).join('')}</select></div><div class="field"><label for="f_payPrev_payDate">Pay date (this check) *</label><input id="f_payPrev_payDate" class="paystubEdit" data-field="payDate" type="date" value="${escapeHTML(p.payDate||'')}"></div><div class="field"><label for="f_payPrev_periodStart">Pay period start</label><input id="f_payPrev_periodStart" class="paystubEdit" data-field="periodStart" type="date" value="${escapeHTML(p.periodStart||'')}"></div><div class="field"><label for="f_payPrev_periodEnd">Pay period end</label><input id="f_payPrev_periodEnd" class="paystubEdit" data-field="periodEnd" type="date" value="${escapeHTML(p.periodEnd||'')}"></div><div class="field"><label for="f_payPrev_gross">Gross per check ($)</label><input id="f_payPrev_gross" class="paystubEdit" data-field="gross" type="number" min="0" step="0.01" value="${escapeHTML(p.gross||'')}" placeholder="Not stated"></div><div class="field"><label for="f_payPrev_net">Net per check ($)</label><input id="f_payPrev_net" class="paystubEdit" data-field="net" type="number" min="0" step="0.01" value="${escapeHTML(p.net||'')}" placeholder="Not stated"></div></div><p class="muted" id="paystubNextDates">${escapeHTML(paystubNextDatesText(p))}</p><div class="toolbar" style="margin-top:12px"><button data-action="paystub-approve">Save pay schedule — I checked this</button><button type="button" class="secondary" data-action="paystub-discard">Discard preview (save nothing)</button></div>`;
}
function paystubListHTML(){
  const stubs=(db.payStubs||[]).slice().sort((a,b)=>String(a.agency||'').localeCompare(String(b.agency||'')));
  if(!stubs.length)return '<p class="muted">No pay stubs yet — optional. Add one per agency below and each agency gets its own estimated pay schedule on the calendar.</p>';
  return stubs.map(x=>{
    const next=paystubNextPayDate(x);
    const dates=[];let d=next;for(let i=0;i<3&&d;i++){dates.push(d);const n=paystubStepDate(d,x.frequency,+String(x.payDate||'').slice(8,10));if(!n||n<=d)break;d=n}
    const src=x.source==='ai-vision'?'Read from pay stub with AI':x.source==='text-parse'?'Read from pasted text / PDF':x.source==='manual'?'Entered manually':'Saved pay schedule';
    return `<div class="item"><div><div class="item-title">${escapeHTML(x.agency||'Unnamed agency')}${x.facility?` <span class="muted">(${escapeHTML(x.facility)})</span>`:''}</div><div class="muted">${PAY_FREQUENCY_LABELS[x.frequency]||'Frequency not set'} · Last pay date ${x.payDate?fmt(x.payDate):'not set'}${x.periodStart&&x.periodEnd?` · Period ${fmt(x.periodStart)} – ${fmt(x.periodEnd)}`:''}</div><div class="muted">Estimated per check: ${x.gross?currency(num(x.gross))+' gross':''}${x.gross&&x.net?' · ':''}${x.net?currency(num(x.net))+' net':''}${!x.gross&&!x.net?'amount not stated':''} · <span class="pill">estimate</span></div><div class="muted">Next expected pay dates: ${dates.length?dates.map(z=>fmt(z)).join(' · '):'set a pay frequency and pay date to see them'}</div><div class="muted">${escapeHTML(src)}${x.fileName?` · ${escapeHTML(x.fileName)}`:''}</div></div><div class="item-actions"><button class="tiny secondary" data-action="edit-paystub" data-id="${escapeHTML(x.id)}">Edit</button><button class="tiny danger" data-action="delete-paystub" data-id="${escapeHTML(x.id)}">Delete</button></div></div>`;
  }).join('');
}
function paystubPanelHTML(){
  const px=db.payStubs.find(x=>x.id===editId)||{};
  return `<section class="panel" id="paystub-panel"><h2>Upload a pay stub (optional)</h2><p class="muted">Upload one stub per agency and we’ll put your estimated paydays on the calendar. The stub itself is never stored — only the pay schedule.</p><form id="paystubForm"><div class="form-grid">${field('paystubFile','Choose a pay stub — photo or PDF (several photos for a multi-page stub)','file','','accept=".pdf,.png,.jpg,.jpeg,.webp,.heic,image/*" multiple')}${area('paystubText','Or paste the pay stub text','','Employer: Premier Anesthesia Group\nPay Period: 10/19/2026 - 11/01/2026\nPay Date: 11/06/2026\nGross Pay: $3,200.00\nNet Pay: $2,400.00')}</div><div class="form-actions"><button type="submit">Read with AI — recommended (preview only, nothing saved yet)</button><button type="button" class="secondary" data-action="paystub-read-text">Read pasted text / PDF instead — no AI</button></div></form>${paystubStatus?`<p class="hint" id="paystubStatus">${escapeHTML(paystubStatus)}</p>`:''}<div style="margin-top:14px">${paystubPreviewHTML()}</div><h3>Saved pay schedules — one per agency</h3>${paystubListHTML()}<p class="muted">A new stub for an agency replaces that agency's schedule only. Deleting a stub removes only that agency's estimated paychecks.</p><h3>${editId&&px.id?'Edit pay schedule':'Add a pay schedule manually'}</h3><p class="muted">No stub handy? Type the schedule instead — same result.</p><form id="entryForm" data-kind="payStubs"><div class="form-grid">${field('agency','Agency / employer','text',px.agency||'','required')}${field('facility','Facility (if it applies)','text',px.facility||'')}${select('frequency','Pay frequency',PAY_FREQUENCIES,px.frequency||'')}${field('payDate','Pay date (this check)','date',px.payDate||'','required')}${field('periodStart','Pay period start','date',px.periodStart||'')}${field('periodEnd','Pay period end','date',px.periodEnd||'')}${field('gross','Gross per check ($)','number',px.gross??'','min="0" step="0.01"')}${field('net','Net per check ($)','number',px.net??'','min="0" step="0.01"')}</div>${formEnd(editId&&px.id?'Save pay schedule':'Add pay schedule')}</form></section>`;
}
function paystubUpcomingHTML(){
  const stubs=db.payStubs||[];
  if(!stubs.length)return '';
  const up=paystubUpcoming(4);
  return `<section class="panel"><h2>Upcoming paychecks (estimated)</h2>${up.length?up.map(x=>`<div class="item"><strong>${fmt(x.date)}</strong> · ${escapeHTML(x.agency)}${x.facility?` <span class="muted">(${escapeHTML(x.facility)})</span>`:''}<div class="muted">Estimated ${x.net?currency(num(x.net))+' net':currency(num(x.gross))+' gross'}${x.net&&x.gross?` · ${currency(num(x.gross))} gross`:''} · <span class="pill">estimate</span></div></div>`).join(''):'<p class="muted">No upcoming paycheck could be worked out — check each stub has a pay frequency and a pay date (Facilities tab).</p>'}<p class="muted">${PAYSTUB_DISCLAIMER}</p></section>`;
}

function persist(){try{localStorage.setItem(KEY,JSON.stringify(db))}catch(e){alert('Storage failed. Export a backup: '+e.message)}}
function setTab(t){onboardStep=0;tab=t;editId=null;showShiftForm=false;dayViewOpen=false;render();window.scrollTo(0,0)}
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
function assistantClinical(q){return /\b(patient|diagnos|treatment|prescri|dosage|\bdose\b|drug interaction|intubat|airway management|anesthet\w+ (for|plan|technique)|clinical decision|symptom|disease)\b/i.test(q)}
function assistantUpcoming(){const now=localDate(new Date());return db.shifts.filter(x=>x.date>=now).sort((a,b)=>a.date.localeCompare(b.date))}
function assistantMonthShifts(){const prefix=localDate(new Date()).slice(0,7);return db.shifts.filter(x=>x.date?.startsWith(prefix))}
function answerQuestion(raw){
  const q=String(raw||'').trim();if(!q)return 'Ask me something — try one of the suggested questions below.';
  const l=q.toLowerCase();
  if(assistantClinical(q))return 'I can\'t answer clinical questions — CRNA Hub is an administrative assistant, not clinical decision support, and it holds no patient information. For a clinical question, check your facility protocols, a current clinical reference, or a qualified colleague. I can help with scheduling, income, credentials, mileage, and PTO instead.';
  if(/help me|what (can|does) (this|crna hub)|how (do|does) (this|crna hub|it) work|getting started|what is crna hub/.test(l))return 'CRNA Hub is your schedule, income, and professional life in one place. Use the Dashboard calendar to see shifts and expected gross, the Dashboard Add shift button to add shifts, Facilities to store each hospital and its rates, Credentials for NBCRNA, AANA, and state licenses with 90/60/30/7-day reminders, Mileage to log and export business trips, and PTO to track a W-2 balance. Everything in this release is stored on this device only — no cloud sync yet, so export backups regularly.';
  if(/\b(w-2|1099|employment type|how (am i|do i get) paid)\b/.test(l)){const t=employmentType();if(!t)return 'No employment type is set yet — pick W-2, 1099, or both on the Account tab (onboarding step 1). It drives the income totals: W-2 salary days are never double-counted, 1099 shifts price from contracts and facilities, and hybrid does both.';return `Employment type: ${employmentTypeLabel()}${t==='w2'?' — your pay comes as salary, so per-shift totals do not apply here and no shift counts as billable income; Off / PTO days are salary days.':t==='1099'?' — shifts price from your contracts and facilities; Off / PTO days are W-2 salary days and are excluded from every total, never double-counted.':' — W-2 salary days are excluded from every total and never double-counted; 1099 shifts price from your contracts and facilities.'} Change it on the Account tab.`}
  if(/pay ?stub|paycheck|next (pay|paycheck)|when (do|will) i get paid|pay ?day/.test(l)){const up=paystubUpcoming(6);if(!(db.payStubs||[]).length)return 'No pay stubs are saved yet — upload one per agency on the Facilities tab and the app will read the pay frequency and pay date and show each agency\'s estimated paychecks on the calendar. A stub is optional; facilities work without one.';if(!up.length)return 'Pay stubs are saved, but no upcoming paycheck could be worked out — check that each stub has a pay frequency and a pay date on the Facilities tab.';return `Next estimated paychecks, one per agency (estimates from your pay stubs — always double-check against your actual paystubs; CRNA Hub is not liable for mistakes): ${up.map(x=>`${fmt(x.date)} — ${x.agency}${x.facility?` (${x.facility})`:''} · est. ${x.net?currency(num(x.net))+' net':currency(num(x.gross))+' gross'}`).join('; ')}.`}
  if(/shift.*(coming|upcoming|next)|upcoming shift/.test(l)){const up=assistantUpcoming();if(!up.length)return 'You have no upcoming shifts recorded on this device. Add one from the Dashboard, or import a schedule CSV.';const top=up.slice(0,5),total=up.filter(isBillableShift).reduce((s,x)=>s+num(x.pay),0),conf=up.filter(x=>isBillableShift(x)&&['confirmed','completed'].includes(normalizeShiftStatus(x.status))).reduce((s,x)=>s+num(x.pay),0);return `You have ${up.length} upcoming shift(s) recorded, worth ${currency(total)} in expected gross (proposed-inclusive; ${currency(conf)} of that is confirmed). Next up: ${top.map(x=>`${fmt(x.date)} at ${x.facility} (${x.type}, ${x.pay===''||x.incomplete?'pay not yet priced':currency(x.pay)}, ${shiftStatusLabel(x.status)})`).join('; ')}${up.length>5?` — plus ${up.length-5} more.`:''}`}
  if(/this year|year.*(income|gross|earn|pay)|income.*year|annual (income|gross|pay)|how much.*year/.test(l)){const y=currentYear(),cur=shiftsForYear(y);if(!cur.length)return `No shifts are recorded for ${y} yet, so I can't project this year's income. Add shifts or import a CSV, and this answer will use them.`;const split=yearIncomeSplit(y);return `Income for ${y}, from recorded shifts only — three totals, same split as the Dashboard: C (confirmed only) ${currency(split.c.ytd)} year to date and ${currency(split.c.predicted)} predicted annual; S (submitted-inclusive — confirmed plus submitted, if every submitted date is approved) ${currency(split.s.ytd)} year to date and ${currency(split.s.predicted)} predicted annual; P (proposed-inclusive — S plus proposed shifts you might pick up) ${currency(split.p.ytd)} year to date and ${currency(split.p.predicted)} predicted annual. None of these is paid income — they are estimates from scheduled shifts. Shifts from other years are not included.${split.unpriced?` ${split.unpriced} shift(s) in ${y} are unpriced and are not included in any of the three totals.`:''}${split.w2Salary?` ${split.w2Salary} W-2 salary day(s) are excluded — paid through W-2 salary, never double-counted.`:''}`}
  if(/income|projected|earn|gross|pay.*month|this month/.test(l)){const cur=assistantMonthShifts();if(!cur.length)return 'No shifts are recorded for this month, so I can\'t project income yet. Add shifts or import a CSV, and this answer will use them.';const m=monthIncomeSplit(localDate(new Date()).slice(0,7));const by={};cur.filter(x=>isBillableShift(x)&&['confirmed','completed'].includes(normalizeShiftStatus(x.status))).forEach(x=>{by[x.facility||'Unknown']=(by[x.facility||'Unknown']||0)+num(x.pay)});return `Projected income this month, from recorded shifts only — three totals, same split as the Dashboard: C (confirmed only) ${currency(m.c)}; S (submitted-inclusive) ${currency(m.s)}; P (proposed-inclusive) ${currency(m.p)}, across ${cur.length} shift(s). By facility (confirmed only): ${Object.keys(by).length?Object.entries(by).map(([f,v])=>`${f} ${currency(v)}`).join('; '):'no confirmed shifts yet'}. None of these is paid income.${m.unpriced?` ${m.unpriced} shift(s) this month are unpriced and are not included in any total.`:''}`}
  if(/check (my )?(portal|nbcrna|aana|license)|portal check|ask.*assistant.*(nbcrna|aana|license|portal)/.test(l))return 'A portal check is the assistant\'s job, and it works like this: you sign in to the portal yourself — in the finished native app that opens in Apple\'s system sign-in sheet, so iPhone Passwords + Face ID fill the login and the app never sees your password. Preview stand-in — the finished app signs you in with the system sign-in sheet; in this web preview it opens in a new tab instead. Then you show me the page that lists your record (a screenshot, or the copied text). I read it on this device, show you exactly what I found, and save nothing until you check the preview and approve it. I never store a portal password, and I never claim a record is verified unless I actually read it. Tap "Check NBCRNA", "Check AANA", or "Check a state license" in the portal-check section below, or the “I signed in — check it” button on any Connect card on the Credentials tab. Honest limits: NBCRNA\'s public verification submit does not answer the server, AANA\'s sign-in page is bot-gated, and WV and Ohio board lookups block automation — for those, I read the lookup page you show me, and Nursys e-Notify can alert you when a license changes.';
  if(/monitor|watch.*portal|what.*(monitoring|watching)|active.*check|check.*(weekly|regular|automatic|automatically)/.test(l)){const mons=ensurePortalMonitoring(),today=localDate(new Date()),due=mons.filter(m=>monitorIsDue(m,today));return `Portal monitoring — the assistant watches NBCRNA, AANA, and your state licenses on a schedule, not just when you ask. ${mons.map(m=>`${m.label}: last checked ${m.lastChecked?String(m.lastChecked).slice(0,10):'never'}, next due ${monitorNextDue(m,today)}, ${m.enabled?(monitorIsDue(m,today)?'due now':'on schedule'):'paused'}, last outcome ${m.lastOutcome||'not checked yet'}`).join('; ')}.${due.length?` ${due.length} check(s) are due — open the Assistant tab and tap Run check.`:''} Public checks run automatically where the source allows it; private portals run when you sign in yourself, and the assistant prompts you when a sign-in is due. In this web preview checks run when you open the app and tap Run — the app cannot run in the background while it is closed. In the finished native app the assistant runs them on schedule in the background and only asks you to sign in when a private portal needs it.`;}
  if(/credential|license|nbcrna|aana|expir/.test(l)){const d=credentialDeadlines();if(!d.length)return 'No credential deadlines are inside their reminder windows right now, based on the records on this device. Check the Credentials tab to confirm your NBCRNA, AANA, and state license dates are entered.';return `Credentials needing attention: ${d.slice(0,8).map(x=>`${x.label} — ${fmt(x.date)} (${x.days<0?('expired '+Math.abs(x.days)+' days ago'):x.days===0?'due today':('due in '+x.days+' days')})`).join('; ')}. Records a portal pull brought back are labelled with their source; the rest are user-entered and not verified by NBCRNA, AANA, or a state board.`}
  if(/mileage|miles|trip/.test(l)){if(!db.mileage.length)return 'No mileage trips are logged yet. Log one from the Mileage tab, or generate schedule-based drafts there and confirm each trip.';const total=verifiedMileageTotal(),verified=verifiedMileageTrips().length,draft=db.mileage.filter(x=>x.status==='draft').length;return `Mileage on this device: ${total.toFixed(1)} verified miles across ${verified} confirmed trip(s), including ${draft} draft(s) still needing confirmation (drafts are not counted until the weekly review confirms them). Mileage defaults to ${tripTypeLabel(mileageTripType())}, and each trip shows whether it is round trip or one way — a round-trip trip is counted once, never doubled. Drafts are not verified trips — confirm the trip occurred and the actual miles before using them.`}
  if(/\bpto\b|time off|vacation/.test(l)){const bal=num(db.settings.ptoStarting)+db.pto.reduce((s,x)=>s+num(x.hours),0);return `Your recorded W-2 PTO balance is ${bal.toFixed(2)} hours, from ${db.pto.length} ledger entr(ies). This is what you recorded here — your employer's actual balance may differ.`}
  if(/facilit|hospital/.test(l)){if(!db.facilities.length)return 'No facilities are saved yet. Add one from the Facilities tab with its rates, and shifts can then use those rates.';return `You have ${db.facilities.length} facilit(ies) saved: ${db.facilities.map(f=>`${f.name} (8h ${currency(f.rate8)}, 24h ${currency(f.rate24)}, 2nd call ${currency(f.rateSecond)})`).join('; ')}. I don't quote facility notes here, since they may hold authorized facility codes.`}
  if(/contract|rate|pay.*(shift|call|hour)/.test(l))return 'Each facility stores a flat rate for 8-hour, 24-hour, and second-call shifts. The Facilities tab has a contract import (text, CSV text, .ics, and text-based PDF): it parses facility names, dates, shift types, and stated rates, shows a preview for your approval, and links approved shifts to a saved contract record. Contract pictures are read with AI vision first — “Read with AI” (recommended) on the Facilities tab sends only the photos you selected to OpenAI (gpt-4o-mini) through the CRNA Hub server function and shows the same preview for your approval, because on-device OCR dropped the Daily / Premium / 1st-call rows from a real contract’s rates table. On-device OCR (Tesseract.js) is the fallback for when you have no connection — less accurate on rate tables, and nothing is sent to a server for it.';
  if(/ce |continuing education|credits/.test(l)){const a=ceTotal(db.nbcrnaCE,'Class A'),b=ceTotal(db.nbcrnaCE,'Class B'),n=db.nbcrna||{},aa=db.aana||{};return `CE recorded here — NBCRNA: ${a} Class A and ${b} Class B credits from ${db.nbcrnaCE.length} record(s); MAC Ed ${n.macEd||0} of ${n.macEdRequired||60}, MAC Dev ${n.macDev||0} of ${n.macDevRequired||40}. AANA: ${ceTotal(db.aanaCE)} credits from ${db.aanaCE.length} record(s). These are user-entered totals, not a live AANA/NBCRNA transcript.`}
  if(/sync|cloud|supabase|account|sign ?in|backup/.test(l))return cloudAssistantAnswer();
  if(/c\/s\/p|confirmed|submitted|proposed|forecast/.test(l)){const y=currentYear(),split=yearIncomeSplit(y);return `Income split for ${y} — C (confirmed only) ${currency(split.c.ytd)} year to date, ${currency(split.c.predicted)} predicted annual; S (submitted-inclusive — confirmed plus submitted, if every submitted date is approved) ${currency(split.s.ytd)} year to date, ${currency(split.s.predicted)} predicted annual; P (proposed-inclusive — S plus proposed shifts you might pick up) ${currency(split.p.ytd)} year to date, ${currency(split.p.predicted)} predicted annual. Tap a shift's day on the Dashboard calendar to change its status, and these totals re-price immediately. None of these is paid income.${split.unpriced?` ${split.unpriced} shift(s) in ${y} are unpriced and are not included in any total.`:''}`}
  return 'I can answer from what is actually recorded on this device: upcoming shifts, this month\'s projected income, upcoming paychecks (estimates from pay stubs), credentials expiring soon, facilities and their rates, mileage, PTO, and CE totals — plus how CRNA Hub itself works. Try one of the suggested questions, or ask about one of those topics. I won\'t guess at records that aren\'t here, and I don\'t answer clinical questions.';
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
  const byFacility={};
  month.filter(isBillableShift).forEach(x=>{const f=x.facility||'Unknown';byFacility[f]=(byFacility[f]||0)+num(x.pay)});
  return {
    today: now,
    profile:{name: profileName(), employmentType: employmentType()||null, monthlyIncomeGoal: monthlyIncomeGoal()},
    month:{label: now.slice(0,7), shiftCount: month.length, gross: monthIncome.p, confirmed: monthIncome.c, submittedInclusive: monthIncome.s, proposedInclusive: monthIncome.p, monthlyIncomeGoal: monthlyIncomeGoal(), byFacility: Object.entries(byFacility).map(([facility,gross])=>({facility,gross}))},
    year:{year: y, ytd: split.ytd, predicted: split.predicted, futureCount: split.futureCount, futureGross: split.futureGross, unpriced: split.unpriced||0, w2Salary: split.w2Salary||0, c:{ytd: split.c.ytd, predicted: split.c.predicted}, s:{ytd: split.s.ytd, predicted: split.s.predicted}, p:{ytd: split.p.ytd, predicted: split.p.predicted}},
    upcoming: assistantUpcoming().slice(0,5).map(x=>({date:x.date, facility:x.facility||'', type:x.type||'', pay: (x.pay===''||x.pay==null)?null:num(x.pay)})),
    credentials: credentialDeadlines().slice(0,8).map(x=>({label:x.label, date:x.date, days:x.days})),
    facilities: (db.facilities||[]).map(f=>({name:f.name||'', rate8: num(f.rate8)||null, rate24: num(f.rate24)||null, rateSecond: num(f.rateSecond)||null})),
    mileage:{verifiedMiles: verifiedMileageTotal(), verifiedTrips: verifiedMileageTrips().length, drafts: (db.mileage||[]).filter(x=>x.status==='draft').length},
    pto:{balanceHours: num(db.settings.ptoStarting)+(db.pto||[]).reduce((s,x)=>s+num(x.hours),0), entries:(db.pto||[]).length},
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
const PORTAL_STANDIN_LABEL='Preview stand-in — the finished app signs you in with the system sign-in sheet';
const PORTAL_CHECK_SOURCES={
  nbcrna:{title:'NBCRNA',short:'NBCRNA',url:'https://portal.nbcrna.com/',siteLabel:'portal.nbcrna.com',
    what:'certification status, certification period, renewal / recertification deadline, MAC Ed / MAC Dev progress, and CPC check-in status',
    how:'NBCRNA has its own sign-in portal. Open portal.nbcrna.com and sign in yourself, then screenshot the page that shows your certification timeline / record — status, period, and MAC progress.',
    finalFlow:'In the finished app, Connect opens portal.nbcrna.com in the system sign-in sheet — Face ID fills the login, the app never sees your password — and the assistant reads your certification record and shows a preview before saving anything. The public verification pull is still unproven (its submit endpoint 404s), so the signed-in record page is the route.',
    limit:'Honest limit: NBCRNA’s public verification submit does not answer (404), so the assistant cannot pull NBCRNA directly — it reads the page you show it instead.'},
  aana:{title:'AANA',short:'AANA',url:'https://www.aana.com/login',siteLabel:'aana.com/login',
    what:'membership status, membership expiration, and CE transcript totals (Class A / Class B)',
    how:'AANA needs a member sign-in. Open aana.com/login and sign in yourself, then screenshot your membership page or CE transcript — the page that shows your status and totals.',
    finalFlow:'In the finished app, Connect opens aana.com/login in the system sign-in sheet — Face ID fills the login, the app never sees your password — and the assistant reads your membership page or CE transcript and shows a preview before saving anything. AANA sign-in is SSO and bot-gated, so the sheet may still be blocked; if it is, the assistant reads the member page you show it instead.',
    limit:'Honest limit: AANA sign-in runs through SSO and that page is bot-gated, so the assistant cannot sign in for you — it reads the member page you show it instead. AANA also shares CE with NBCRNA, so NBCRNA totals may already cover the same credits.'},
  licenses:{title:'State Licenses',short:'a state license',url:'https://www.nursys.com/',siteLabel:'your state board lookup (via Nursys)',
    what:'license status, license type (RN / APRN), license number, issue date, and expiration date',
    how:'Open your state board\u2019s license lookup (or Nursys), look yourself up, and screenshot the result page that shows your license.',
    finalFlow:'In the finished app, Connect opens your state board lookup in the system sign-in sheet where the board needs a sign-in (Face ID fills it, the app never sees your password), or the public lookup where it does not — and the assistant reads the result page and shows a preview before saving anything. WV and Ohio lookups block automation, so the assistant reads the lookup page you show it; Nursys e-Notify can also alert you when a license changes.',
    limit:'Honest limit: WV and Ohio board lookups block automation, so the assistant cannot pull them directly — it reads the lookup page you show it instead. Nursys e-Notify can alert you when a license changes.'}
};
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
//   * Web-preview limit, stated in the UI: this preview cannot run checks
//     in the background while it is closed. Checks run when the app is open
//     (due checks are flagged and one tap runs them). Background execution
//     on schedule is a finished-native-app capability.
// Monitoring state lives on this device (db.portalMonitoring, included in
// JSON backups); the check log reuses db.portalChecks (last 20).
const MONITOR_SOURCES={
  nbcrna:{title:'NBCRNA',method:'public',blocked:'NBCRNA public verification submit currently does not answer the server (404), so a public check is attempted and recorded as blocked — never faked. The signed-in check reads the verification page you show the assistant instead.'},
  aana:{title:'AANA',method:'signed_in',blocked:'AANA SSO sign-in is bot-gated, so the assistant cannot sign in for you — checks run when you sign in yourself, and the assistant prompts you when a check is due.'},
  licenses:{title:'State Licenses',method:'signed_in',blocked:'WV and Ohio board lookups block automation — checks read the lookup page you show the assistant. Nursys e-Notify can also alert you when a license changes.'}
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
  if(!mon.lastChecked)return today;
  return addDaysStr(String(mon.lastChecked).slice(0,10),monitorCadence(mon));
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
  if(outcome==='changed')mon.changeFlag=true;
  db.portalChecks=[{source:mon.source,state:mon.state||'',retrievedAt:when,status:outcome,summary:summary||''},...(db.portalChecks||[])].slice(0,20);
  persist();
  return mon;
}
function monitorOutcomeLabel(o){return {'no_change':'Checked — no change','changed':'Changed','needs_signin':'Needs sign-in','blocked':'Blocked — automation not allowed','failed':'Check failed','not_checked':'Not checked yet'}[o]||o||'Not checked yet'}
function portalMonitoringHTML(){
  const mons=ensurePortalMonitoring(),today=localDate(new Date());
  const due=mons.filter(m=>monitorIsDue(m,today));
  const log=(db.portalChecks||[]).slice(0,8);
  return `<section class="panel"><h2>Portal monitoring — the assistant watches for you</h2><p class="muted">The assistant checks NBCRNA, AANA, and your state licenses on a schedule — <strong>weekly by default, faster near renewal</strong> (every 3 days inside 90 days, every 2 days inside 30 days, daily inside 7 days). Public checks run automatically where allowed; private portals run when you sign in yourself, and the assistant prompts you when a check is due. It never silently logs in as you and never stores a portal password.</p><p class="muted"><strong>Web-preview limit:</strong> this preview cannot run checks in the background while it is closed — due checks are flagged here and run when you tap Run check. In the finished app the assistant runs them on schedule and only asks you to sign in when a private portal needs it.</p>${due.length?`<p><strong>${due.length} check(s) due now:</strong> ${due.map(m=>escapeHTML(m.label)).join(', ')} — tap Run check below.</p>`:'<p class="muted">No checks are due right now.</p>'}${mons.map(m=>{const cad=monitorCadence(m),next=monitorNextDue(m,today),isDue=monitorIsDue(m,today);return `<div class="item"><strong>${escapeHTML(m.label)}</strong> · ${m.enabled?'Monitoring on':'Paused'} · every ${cad} day${cad>1?'s':''}${cad!==monitorBaseCadence(m)?' (escalated — renewal is near)':' (weekly)'}<div class="muted">Last checked: ${m.lastChecked?fmt(String(m.lastChecked).slice(0,10)):'never'} · Next due: ${fmt(next)}${isDue?' · <strong>due now</strong>':''} · Method: ${m.source==='nbcrna'?'public check (no login)':'signed-in session — prompts you to sign in when due'} · Outcome: ${escapeHTML(monitorOutcomeLabel(m.lastOutcome))}${m.lastSummary?` — ${escapeHTML(m.lastSummary)}`:''}</div><div class="muted">${escapeHTML((MONITOR_SOURCES[m.source]||{}).blocked||'')}</div><div class="toolbar"><button type="button" data-action="monitor-run" data-id="${escapeHTML(m.key)}">Run check now</button><button type="button" class="secondary" data-action="monitor-assistant" data-id="${escapeHTML(m.key)}">Check with assistant</button><button type="button" class="secondary" data-action="monitor-toggle" data-id="${escapeHTML(m.key)}">${m.enabled?'Pause monitoring':'Resume monitoring'}</button>${m.changeFlag?`<button type="button" class="secondary" data-action="monitor-ack" data-id="${escapeHTML(m.key)}">Mark change reviewed</button>`:''}</div><form data-kind="monitor-cadence"><input type="hidden" name="key" value="${escapeHTML(m.key)}"><div class="form-grid"><div class="field"><label>Base cadence</label><select name="cadenceDays">${[1,3,7,14].map(v=>`<option value="${v}" ${monitorBaseCadence(m)===v?'selected':''}>Every ${v} day${v>1?'s':''}${v===7?' (weekly)':''}</option>`).join('')}</select></div></div><div class="form-actions"><button type="submit">Save cadence</button></div></form></div>`}).join('')}${log.length?`<h3>Monitoring log</h3>${log.map(c=>`<div class="item"><strong>${escapeHTML((PORTAL_CHECK_SOURCES[c.source]||{}).short||c.source)}</strong> · ${c.retrievedAt?fmt(String(c.retrievedAt).slice(0,10)):''} · ${escapeHTML(monitorOutcomeLabel(c.status))}<div class="muted">${escapeHTML(c.summary||'')}</div></div>`).join('')}`:'<p class="muted">No monitoring checks logged yet — run a check above and it will appear here.</p>'}</section>`;
}
function dashboardMonitoringPanel(){
  const mons=ensurePortalMonitoring(),today=localDate(new Date());
  const due=mons.filter(m=>monitorIsDue(m,today));
  const changed=mons.filter(m=>m.changeFlag);
  if(!due.length&&!changed.length)return '';
  return `<section class="panel"><h2>Portal monitoring</h2>${changed.length?`<p><strong>The assistant found a change:</strong> ${changed.map(m=>escapeHTML(m.label)+' — '+escapeHTML(m.lastSummary||'changed')).join('; ')} (read ${changed[0].lastChecked?String(changed[0].lastChecked).slice(0,10):''}). Check the Assistant tab to review it.</p>`:''}${due.length?`<p><strong>${due.length} portal check(s) due:</strong> ${due.map(m=>escapeHTML(m.label)).join(', ')}.</p>`:''}<div class="toolbar"><button data-action="ask-assistant">Open Assistant — run checks</button></div></section>`;
}
// Run one due check now. NBCRNA: public verification, attempted with the
// name stored on the monitor (asked once, never a password). AANA and state
// licenses: signed-in check through the assistant flow — the user signs in
// themselves. Outcomes (including blocked / failed) are recorded in the
// monitoring log; nothing is ever faked.
async function monitorRunCheck(key){
  const mon=(db.portalMonitoring||[]).find(x=>x.key===key);if(!mon)return;
  if(mon.source!=='nbcrna')return monitorAssistantCheck(mon);
  if(!SUPABASE_CONFIGURED){alert('Supabase is not configured yet — sign in on the Account tab first.');return setTab('Account')}
  if(!cloudSession){alert('Sign in on the Account tab first. The public check runs for your signed-in account.');return setTab('Account')}
  const before=monitorSnapshot('nbcrna');
  let first=mon.firstName||'',last=mon.lastName||'';
  if(!first||!last){
    const f=prompt('NBCRNA public verification — first name (as certified):','');
    if(f===null||!String(f).trim())return;
    const l=prompt('Last name (as certified):','');
    if(l===null||!String(l).trim())return;
    first=String(f).trim();last=String(l).trim();mon.firstName=first;mon.lastName=last;
  }
  try{
    const data=await portalCall({action:'verify-nbcrna',firstName:first,lastName:last,certNumber:((db.nbcrna||{}).number||''),state:''});
    const r=data.record||{};
    db.nbcrna={...(db.nbcrna||{}),status:r.certification_status||'Certified',number:r.certification_number||(db.nbcrna&&db.nbcrna.number)||'',periodEnd:r.period_end||(db.nbcrna&&db.nbcrna.periodEnd)||'',renewalDeadline:r.renewal_deadline||(db.nbcrna&&db.nbcrna.renewalDeadline)||'',source:'public_verification',reminders:(db.nbcrna&&db.nbcrna.reminders)||'90,60,30,7'};
    cloudSyncTimes.nbcrna=data.retrievedAt||cloudNow();
    delete portalAttemptFailed['nbcrna'];delete portalHealed['nbcrna'];
    persist();cloudSaveKind('nbcrna');await portalRefreshStatus();
    const changed=monitorSnapshotChanged(before,monitorSnapshot('nbcrna'));
    recordMonitorCheck(key,changed?'changed':'no_change',changed?('NBCRNA record changed on public check — '+(r.certification_number||'certification')+' expires '+(r.period_end||'unknown')):'NBCRNA public check: no change','public');
    render();
    alert(changed?'NBCRNA changed — see the monitoring log on the Assistant tab.':'NBCRNA checked — no change.');
  }catch(e){
    const msg=portalErrMsg(e);portalNoteFailed('nbcrna',msg);
    recordMonitorCheck(key,/404|did not answer|unavailable|not answer/i.test(msg)?'blocked':'failed','NBCRNA public check could not run: '+msg,'public');
    await portalRefreshStatus();render();
    alert('NBCRNA monitoring check could not run: '+msg+'\n\nThis is recorded in the monitoring log — nothing was faked.');
  }
}
function monitorAssistantCheck(mon){
  const src=mon.source;
  startPortalCheck(src);
  if(src==='licenses'&&mon.state)portalCheck.state=mon.state;
  render();
}

let portalCheck=null, portalCheckError='', portalCheckOcrStatus='';
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
  portalCheck={source,state:'West Virginia',step:'intro',fields:{},found:[],missing:[],retrievedAt:'',via:''};
  portalCheckError=''; portalCheckOcrStatus='';
  db.assistantChat=[...(db.assistantChat||[]),
    {role:'user',text:'Ask the assistant to check my '+meta.title+' portal'},
    {role:'assistant',text:'Portal check — '+meta.title+'. '+meta.how+' '+meta.limit+' I will never store your portal password, and nothing is saved until you check the preview and approve it. Start below: open the portal, sign in yourself, and bring back a screenshot (or the text) of the page that shows your record.'}].slice(-50);
  persist(); tab='Assistant'; render();
}
function portalCheckFieldRows(source,f){
  if(source==='nbcrna') return field('status','Certification status','text',f.status||'')+field('number','Certification number','text',f.number||'')+field('periodStart','Certification period start','date',f.periodStart||'')+field('periodEnd','Certification period end','date',f.periodEnd||'')+field('renewalDeadline','Renewal / recertification deadline','date',f.renewalDeadline||f.periodEnd||'')+field('classA','Class A credits','number',f.classA??'','min="0" step="0.25"')+field('classB','Class B credits','number',f.classB??'','min="0" step="0.25"')+field('macEd','MAC Ed credits','number',f.macEd??'','min="0" step="1"')+field('macDev','MAC Dev credits','number',f.macDev??'','min="0" step="1"');
  if(source==='aana') return field('status','Membership status','text',f.status||'')+field('number','Membership number','text',f.number||'')+field('expiration','Membership expiration','date',f.expiration||'');
  return select('state','State',US_STATES,f.state||(portalCheck&&portalCheck.state)||'West Virginia')+select('type','License type',['RN','APRN'],f.type||'APRN')+field('number','License number','text',f.number||'')+field('issue','Issue date','date',f.issue||'')+field('expiry','Expiration date','date',f.expiry||'','required');
}
function portalCheckHTML(){
  const checks=(db.portalChecks||[]);
  let inner='';
  if(!portalCheck){
    inner=`<p class="muted">The assistant checks a portal the way you would: it opens the portal for <strong>you</strong> to sign in yourself, reads the record page you show it, and reports back for you to confirm before anything is saved. No portal password is ever stored, and a record is only called verified if the assistant actually read it.</p><p class="muted">In the finished app, Connect opens the portal in Apple’s system sign-in sheet — iPhone Passwords + Face ID fill the login, and the app never sees your password.</p><div class="standin"><span class="standin-label">Preview stand-in</span> ${PORTAL_STANDIN_LABEL} — in this web preview the portal opens in a new tab instead: sign in there yourself, screenshot the page that shows your record, and bring the screenshot back here.</div><div class="toolbar">${['nbcrna','aana','licenses'].map(s=>`<button type="button" data-action="assistant-portal-check" data-id="${s}">Check ${PORTAL_CHECK_SOURCES[s].short}</button>`).join('')}</div><p class="muted">Honest limits: NBCRNA’s public verification submit does not answer (404), so the assistant cannot pull NBCRNA directly. AANA’s sign-in page is bot-gated, so the assistant cannot sign in for you. WV and Ohio board lookups block automation — the assistant reads the lookup page you show it, and Nursys e-Notify can alert you when a license changes.</p>${checks.length?`<p class="muted">Recent assistant portal checks: ${checks.slice(0,3).map(c=>`${PORTAL_CHECK_SOURCES[c.source]?PORTAL_CHECK_SOURCES[c.source].short:c.source} · ${c.retrievedAt?String(c.retrievedAt).slice(0,10):''} · ${escapeHTML(c.summary||c.status||'')}`).join('; ')}</p>`:''}`;
  } else if(portalCheck.step==='intro'){
    const m=PORTAL_CHECK_SOURCES[portalCheck.source];
    inner=`<h3>Portal check — ${m.title}</h3><p class="muted">${m.finalFlow||m.how}</p><p class="muted">${m.limit}</p><div class="standin"><span class="standin-label">Preview stand-in</span> ${PORTAL_STANDIN_LABEL} — follow the steps below in this preview; the finished app does step 1 in the system sign-in sheet instead.</div><ol class="muted"><li>Open the portal and sign in yourself: <a href="${m.url}" target="_blank" rel="noopener">${m.siteLabel}</a>. In the finished app this opens in the system sign-in sheet with Face ID; here it opens in a new tab.</li><li>Screenshot the page that shows your record — status, dates, and totals — or copy its text.</li><li>Upload the screenshot or paste the text below. The assistant reads it on this device (OCR for pictures — nothing is sent to a server), shows you what it found, and saves nothing until you approve.</li></ol><p class="muted">What it looks for: ${m.what}. Anything it cannot read is left blank for you to fill in — never guessed.</p><form data-kind="portal-check"><div class="form-grid">${portalCheck.source==='licenses'?select('state','State',US_STATES,portalCheck.state||'West Virginia'):''}${field('shotFile','Screenshot of the portal page (PNG/JPG)','file','','accept=".png,.jpg,.jpeg,.webp,.heic,image/*"')}${area('pasted','Or paste the portal text','','Status: Certified\nCertification expires: June 30, 2028')}</div><div class="form-actions"><button type="submit">Read the page — preview only (nothing saved yet)</button><button type="button" class="secondary" data-action="portal-check-cancel">Cancel</button></div></form>${portalCheckOcrStatus?`<p class="hint" id="portalCheckOcrStatus">${escapeHTML(portalCheckOcrStatus)}</p>`:''}${portalCheckError?`<p class="hint">${escapeHTML(portalCheckError)}</p>`:''}`;
  } else {
    const m=PORTAL_CHECK_SOURCES[portalCheck.source], f=portalCheck.fields||{};
    inner=`<h3>Preview — ${m.title} portal check</h3><p class="muted">Read from the portal page you showed the assistant on ${portalCheck.retrievedAt?String(portalCheck.retrievedAt).slice(0,10):'today'} (${portalCheck.via==='ocr'?'on-device OCR':portalCheck.via==='pdf'?'PDF text':portalCheck.via==='file'?'uploaded file':'pasted text'}). <strong>Check every field — correct anything wrong.</strong> Nothing is saved until you approve below. Source on save: assistant portal check — read from the page you provided, not a server portal pull.</p><p class="muted">Found: ${(portalCheck.found||[]).join(', ')||'nothing recognised'}.${(portalCheck.missing||[]).length?(' Not found on the page — fill in by hand if you know it: '+(portalCheck.missing||[]).join(', ')+'.'):''}</p><form data-kind="portal-check-approve"><input type="hidden" name="source" value="${portalCheck.source}"><div class="form-grid">${portalCheckFieldRows(portalCheck.source,f)}</div><div class="form-actions"><button type="submit">Save — I checked this</button><button type="button" class="secondary" data-action="portal-check-cancel">Discard — save nothing</button></div></form>`;
  }
  return `<section class="panel"><h2>Ask the assistant to check my portals</h2>${inner}</section>`;
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
        portalCheckOcrStatus='Reading your screenshot on this device with OCR (Tesseract.js) — no picture is sent to a server for OCR. This can take a few seconds…';
        render();
        try{ text=await ocrImageFile(file); }catch(err){ portalCheckOcrStatus=''; portalCheckError='Could not read this picture with on-device OCR: '+err.message+' Try a clearer screenshot, or paste the portal text instead. Nothing was saved.'; render(); return; }
        portalCheckOcrStatus='';
        if(!text.trim()){ portalCheckError='OCR read no text from this screenshot. Try a clearer, well-lit screenshot with the text upright, or paste the portal text instead. Nothing was saved.'; render(); return; }
        via='ocr';
      } else if(/\.pdf$/i.test(file.name)||file.type==='application/pdf'){ text=await extractPdfText(file); via='pdf'; }
      else { text=await file.text(); via='file'; }
    }catch(err){ portalCheckOcrStatus=''; portalCheckError='Could not read that file: '+err.message+' — try a clearer screenshot, or paste the portal text instead. Nothing was saved.'; render(); return; }
  } else if(pasted){ text=pasted; via='pasted'; }
  else { portalCheckError='Upload a screenshot of the portal page, or paste the portal text — nothing was read yet, and nothing was saved.'; render(); return; }
  const parsed=parsePortalCheckText(text,portalCheck.source,{ocr:via==='ocr'});
  if(!Object.keys(parsed.fields).length){
    portalCheckError='The assistant read the page but found no status, dates, or numbers it recognises. Check the screenshot shows the record itself (not just the sign-in page), or paste the details. Nothing was saved.';
    render(); return;
  }
  portalCheck={...portalCheck,step:'preview',state,fields:parsed.fields,found:parsed.found,missing:parsed.missing,retrievedAt:cloudNow(),via};
  portalCheckError=''; render();
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
    db.nbcrna={...cur,status:f.status||cur.status||'',number:f.number||cur.number||'',periodStart:f.periodStart||cur.periodStart||'',periodEnd:f.periodEnd||cur.periodEnd||'',renewalDeadline:f.renewalDeadline||f.periodEnd||cur.renewalDeadline||'',classA:f.classA!==undefined?f.classA:(cur.classA??''),classB:f.classB!==undefined?f.classB:(cur.classB??''),macEd:f.macEd!==undefined?f.macEd:(cur.macEd??''),macDev:f.macDev!==undefined?f.macDev:(cur.macDev??''),macEdRequired:cur.macEdRequired||60,macDevRequired:cur.macDevRequired||40,docNote:cur.docNote||'',ceNote:cur.ceNote||'',reminders:cur.reminders||'90,60,30,7',source:keep(cur)};
    cloudSyncTimes.nbcrna=when; cloudSaveKind('nbcrna');
    return 'NBCRNA '+(f.status||db.nbcrna.status||'')+' · expires '+(db.nbcrna.renewalDeadline||db.nbcrna.periodEnd||'unknown');
  }
  if(source==='aana'){
    const cur=db.aana||{};
    db.aana={...cur,status:f.status||cur.status||'',number:f.number||cur.number||'',expiration:f.expiration||cur.expiration||'',docNote:cur.docNote||'',ceNote:cur.ceNote||'',reminders:cur.reminders||'90,60,30,7',source:keep(cur)};
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
  portalCheck=null; portalCheckError=''; portalCheckOcrStatus=''; persist(); render();
  alert('Saved from the assistant portal check ('+String(when).slice(0,10)+'): '+summary+'\n\nSource: assistant portal check — read from the portal page you showed the assistant. It is not a server portal pull, and nothing was stored from your sign-in.');
}

function assistantPage(){
  const hist=db.assistantChat||[];
  return `<section class="panel"><h2>Ask Assistant</h2><p class="muted">Live AI assistant — answers come from a live model (gpt-4o-mini) through the CRNA Hub server function, using only a minimal summary of your records (counts, totals, next shifts) — never facility notes or codes, never documents, never patient information. When the live model is unavailable, answers fall back to the on-device answers from your records, labelled “On-device answer”. No clinical questions, and it never shows facility codes, passwords, or patient information. It can also check NBCRNA, AANA, and state license portals for you — see below.</p><div class="chat">${hist.length?hist.map(m=>`<div class="msg ${m.role==='user'?'user':'assistant'}"><strong>${m.role==='user'?'You':'Assistant'}${m.role==='assistant'?(m.source==='live'?' · Live AI':m.source==='pending'?' · …':' · On-device answer'):''}</strong><div>${escapeHTML(m.text)}</div></div>`).join(''):'<p class="muted">Ask about your schedule, income, credentials, mileage, or how CRNA Hub works.</p>'}</div><div class="toolbar" style="margin-top:12px">${ASSISTANT_STARTERS.map(q=>`<button type="button" class="secondary tiny" data-action="ask" data-id="${escapeHTML(q)}">${escapeHTML(q)}</button>`).join('')}</div><form id="assistantForm" class="chat-form"><label for="assistantInput" class="muted">Your question</label><input id="assistantInput" name="question" type="text" placeholder="Ask about your shifts, income, or credentials…" autocomplete="off"><button type="submit">Ask</button></form><div class="toolbar"><button type="button" class="secondary tiny" data-action="clear-chat">Clear chat history</button></div></section>${portalCheckHTML()}${portalMonitoringHTML()}`;
}
function submitAssistant(e){e.preventDefault();const input=$('assistantInput');if(!input)return;const q=input.value.trim();if(!q)return;input.value='';askAssistantLive(q)}

function render(){ if(window.__crnaBootWatch){clearTimeout(window.__crnaBootWatch);window.__crnaBootWatch=null} const ss=$('storageStatus');if(ss)ss.textContent=cloudHeaderLabel();$('nav').innerHTML=tabs.map(t=>`<button class="${tab===t?'active':''}" data-tab="${escapeHTML(t)}">${escapeHTML(t)}</button>`).join('');$('app').innerHTML=({Dashboard:dashboard,Facilities:facilitiesPage,PTO:ptoPage,Credentials:credentialsPage,Mileage:mileagePage,Assistant:assistantPage,Account:accountPage}[tab])();document.querySelectorAll('[data-tab]').forEach(b=>b.addEventListener('click',()=>setTab(b.dataset.tab)));document.querySelectorAll('[data-action]').forEach(b=>b.addEventListener('click',()=>actions(b.dataset.action,b.dataset.id,b.dataset.date)));document.querySelectorAll('[data-shift-status]').forEach(el=>el.addEventListener('change',()=>{setShiftStatus(el.dataset.shiftStatus,el.value)}));document.querySelectorAll('form[data-kind]').forEach(f=>f.addEventListener('submit',submitEntry));const mt=$('manualTypeSelect');if(mt)mt.addEventListener('change',()=>{manualType=mt.value;editId=null;render();});const ssy=$('savedShiftsYear');if(ssy)ssy.addEventListener('change',()=>{savedShiftsYear=+ssy.value;render();});const mrw=$('mileageReviewWeekSelect');if(mrw)mrw.addEventListener('change',()=>{mileageReviewWeek=mrw.value;render();});const schedForm=$('scheduleForm');if(schedForm)schedForm.addEventListener('submit',importSchedule);const qf=$('qgendaForm');if(qf)qf.addEventListener('submit',saveQgendaFeed);if(tab==='Account')qgendaStatusRefresh();const restore=$('restoreFile');if(restore)restore.addEventListener('change',restoreBackup);const facilityContractForm=$('facilityContractForm');if(facilityContractForm)facilityContractForm.addEventListener('submit',importFacilityContract);const paystubForm=$('paystubForm');if(paystubForm)paystubForm.addEventListener('submit',importPaystub);const ruleChatForm=$('ruleChatForm');if(ruleChatForm)ruleChatForm.addEventListener('submit',submitRuleChat);document.querySelectorAll('.ruleEdit').forEach(el=>el.addEventListener('change',()=>{if(!ruleChatPreview)return;ruleChatPreview.rates[el.dataset.field]=el.value;render()}));document.querySelectorAll('.paystubEdit').forEach(el=>el.addEventListener('change',()=>{if(!paystubPreview)return;paystubPreview[el.dataset.field]=el.value;const nd=$('paystubNextDates');if(nd)nd.textContent=paystubNextDatesText(paystubPreview)}));document.querySelectorAll('.cropRegionSelect').forEach(el=>{const k=el.dataset.kind+':'+el.dataset.i;if(cropRegionByPage[k])el.value=cropRegionByPage[k];el.addEventListener('change',()=>{cropRegionByPage[k]=el.value})});document.querySelectorAll('.facContractEdit').forEach(el=>el.addEventListener('change',()=>{if(!facilityContractPreview)return;const f=facilityContractPreview.facilities[+el.dataset.i];if(!f)return;if(FACILITY_RATE_KEYS.includes(el.dataset.field)){f.rates=f.rates||{};f.rates[el.dataset.field]=el.value}else f[el.dataset.field]=el.value}));document.querySelectorAll('.facContractInclude').forEach(el=>el.addEventListener('change',()=>{if(!facilityContractPreview)return;const f=facilityContractPreview.facilities[+el.dataset.i];if(f)f.include=el.checked}));const calendarForm=$('calendarForm');if(calendarForm)calendarForm.addEventListener('submit',importCalendar);document.querySelectorAll('.calEdit').forEach(el=>el.addEventListener('change',()=>{if(!calPreview)return;const r=calPreview.rows[+el.dataset.row];if(r)r[el.dataset.field]=el.value}));document.querySelectorAll('.calInclude').forEach(el=>el.addEventListener('change',()=>{if(!calPreview)return;const r=calPreview.rows[+el.dataset.row];if(r)r.include=el.checked}));document.querySelectorAll('.schedEdit').forEach(el=>el.addEventListener('change',()=>{if(!schedulePreview)return;const r=schedulePreview.rows[+el.dataset.row];if(r)r[el.dataset.field]=el.value}));document.querySelectorAll('.schedInclude').forEach(el=>el.addEventListener('change',()=>{if(!schedulePreview)return;const r=schedulePreview.rows[+el.dataset.row];if(r)r.include=el.checked}));const af=$('assistantForm');if(af)af.addEventListener('submit',submitAssistant);const cf=$('cloudAuthForm');if(cf)cf.addEventListener('submit',submitCloudAuth);const mi=$('f_miles');if(mi)mi.addEventListener('change',()=>{const s=$('f_milesSource');if(s&&s.value==='auto'){s.value='manual-override';const st=$('mileageCalcStatus');if(st)st.textContent='Miles edited — this trip is now your manual override of the auto-calculated distance.'}});const tt=$('f_tripType');if(tt)tt.addEventListener('change',()=>{const owEl=$('f_oneWayMiles'),milesEl=$('f_miles'),srcEl=$('f_milesSource'),t=tt.value==='one-way'?'one-way':'round-trip';let m=null;const ow=owEl&&Number(owEl.value)>0?Number(owEl.value):null;if(ow!=null&&srcEl&&srcEl.value==='auto')m=tripMilesFor(ow,t);else if(milesEl&&Number(milesEl.value)>0)m=t==='one-way'?Math.round(Number(milesEl.value)/2*10)/10:roundTripMiles(milesEl.value);if(m!=null&&milesEl){milesEl.value=String(m);const st=$('mileageCalcStatus');if(st){st.textContent='Mileage type changed — miles updated to '+m.toFixed(1)+' mi '+tripTypeLabel(t)+'.';mileageCalcStatus=st.textContent}}});const mtt=$('mileageTripTypeSelect');if(mtt)mtt.addEventListener('change',()=>{db.settings.mileageTripType=mtt.value==='one-way'?'one-way':'round-trip';persist();render();});const di=$('f_distance');if(di)di.addEventListener('change',()=>{const s=$('f_distanceSource');if(s&&s.value==='auto'){s.value='manual';const st=$('facilityDistanceStatus');if(st)st.textContent='Distance edited — now saved as a manual distance.'}})}
function field(name,label,type='text',value='',extra=''){return `<div class="field"><label for="f_${name}">${label}</label><input id="f_${name}" name="${name}" type="${type}" value="${escapeHTML(value)}" ${extra}></div>`}
function area(name,label,value='',placeholder=''){return `<div class="field wide"><label for="f_${name}">${label}</label><textarea id="f_${name}" name="${name}" placeholder="${escapeHTML(placeholder)}">${escapeHTML(value)}</textarea></div>`}
function select(name,label,options,value){return `<div class="field"><label for="f_${name}">${label}</label><select name="${name}" id="f_${name}">${options.map(o=>`<option value="${escapeHTML(o)}" ${o===value?'selected':''}>${escapeHTML(o)}</option>`).join('')}</select></div>`}
function selectLabeled(name,label,pairs,value){return `<div class="field"><label for="f_${name}">${label}</label><select name="${name}" id="f_${name}">${pairs.map(([v,l])=>`<option value="${escapeHTML(v)}" ${v===value?'selected':''}>${escapeHTML(l)}</option>`).join('')}</select></div>`}
function formEnd(label){return `<div class="form-actions"><button type="submit">${label}</button>${editId?'<button type="button" class="secondary" data-action="cancel">Cancel</button>':''}</div></form>`}
function list(kind,items,description){return items.length?items.map(x=>`<div class="item"><div>${description(x)}</div><div class="item-actions"><button class="tiny secondary" data-action="edit-${kind}" data-id="${escapeHTML(x.id)}">Edit</button><button class="tiny danger" data-action="delete-${kind}" data-id="${escapeHTML(x.id)}">Delete</button></div></div>`).join(''):'<p class="muted">No records yet.</p>'}
function calendar(){const y=month.getFullYear(),m=month.getMonth(),prefix=`${y}-${String(m+1).padStart(2,'0')}`,start=new Date(y,m,1).getDay(),days=new Date(y,m+1,0).getDate();let grid=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(x=>`<div class="weekday">${x}</div>`).join('');for(let n=0;n<start;n++)grid+='<div class="day blank"></div>';const paysByMonth=paystubOccurrencesInMonth(prefix);for(let n=1;n<=days;n++){const date=`${prefix}-${String(n).padStart(2,'0')}`,entries=db.shifts.filter(x=>x.date===date),pays=paysByMonth.filter(p=>p.date===date);grid+=`<button class="day ${date===localDate(new Date())?'today':''} ${date===selected?'selected':''}" data-action="day" data-date="${date}" aria-label="${fmt(date)}: ${entries.length} shifts${pays.length?`, ${pays.length} estimated paycheck(s)`:''}"><span class="day-number">${n}</span>${entries.slice(0,3).map(x=>`<span class="chip ${/24.hour/i.test(x.type)?'call':/second/i.test(x.type)?'second':/off|pto/i.test(x.type)?'off':''}">${escapeHTML(x.facility||'Off')}<br>${escapeHTML(x.type||'Shift')}</span>`).join('')}${pays.slice(0,2).map(p=>`<span class="chip paycheck" title="Estimated paycheck — ${escapeHTML(p.agency)} — gross ${p.gross?currency(num(p.gross)):'not stated'}, net ${p.net?currency(num(p.net)):'not stated'}. Estimates from your pay stub — always double-check against your actual paystubs.">💰 ${escapeHTML(p.agency||'Paycheck')}<br>est. ${p.net?currency(num(p.net)):p.gross?currency(num(p.gross)):'—'}</span>`).join('')}${entries.length+pays.length>3?`<span class="muted">+${entries.length+pays.length-3}</span>`:''}</button>`}const shifts=db.shifts.filter(x=>x.date?.startsWith(prefix));const paysTotal=paysByMonth.reduce((s,p)=>s+num(p.net||p.gross),0);return `<section class="panel"><div class="toolbar"><button class="secondary" data-action="prev" aria-label="Previous month">‹</button><h2>${month.toLocaleDateString('en-US',{month:'long',year:'numeric'})}</h2><button class="secondary" data-action="next" aria-label="Next month">›</button><button class="secondary tiny" data-action="today">Today</button></div><div class="calendar">${grid}</div><p class="muted">${shifts.length} shifts · ${currency(shifts.reduce((s,x)=>s+num(x.pay),0))} expected gross this month${paysByMonth.length?` · ${paysByMonth.length} estimated paycheck(s) · ${currency(paysTotal)} est. take-home`:''} · Tap a day to see its shifts, add one, or delete one</p>${paysByMonth.length?`<p class="muted">💰 = estimated paycheck from a pay stub — ${PAYSTUB_DISCLAIMER}</p>`:''}</section>`}

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
// --- Confirmed / submitted / proposed income panel (Dashboard + Saved shifts) ---
// One table per selected year: YTD and predicted-annual for each of C, S, P.
function incomeCSPTableHTML(y,split){
  const row=(label,key)=>`<tr><td>${label}</td><td><strong>${currency(split.c[key])}</strong></td><td><strong>${currency(split.s[key])}</strong></td><td><strong>${currency(split.p[key])}</strong></td></tr>`;
  // One-tap fix for pre-Bug-1 imports (Nov 6, 2026): past shifts still
  // proposed count in P only, so C year-to-date reads $0. The button
  // shows only while such shifts exist in this year.
  const pastN=pastProposedShifts(y).length;
  // Dashboard cleanup (Nov 6, 2026): the table alone shows by default.
  // The C/S/P explanation, the priced-shift counts, and the paystub
  // disclaimer moved behind a collapsed "What do C, S and P mean?"
  // toggle on this card — out of the main Dashboard flow. The
  // disclaimer also lives in small print on the Account tab.
  const explain=`C is confirmed income you can plan on. S adds submitted shifts — income if every submitted date is approved. P adds proposed shifts too — possible income, not confirmed. ${split.byStatus?`Priced shifts in ${y}: ${split.byStatus.confirmed+split.byStatus.completed} confirmed/completed, ${split.byStatus.submitted} submitted, ${split.byStatus.proposed} proposed${split.byStatus.rejected||split.byStatus.canceled?`, ${split.byStatus.rejected} rejected, ${split.byStatus.canceled} canceled (counted in no total)`:''}.`:''}${split.unpriced?` ${split.unpriced} shift(s) in ${y} unpriced — not included in any total, never $0.`:''}${split.w2Salary?` ${split.w2Salary} W-2 salary day(s) (Off / PTO) excluded — paid through W-2 salary, never double-counted.`:''}${pastN?` ${pastN} shift${pastN===1?'':'s'} in ${y} dated before today ${pastN===1?'is':'are'} still proposed, so ${pastN===1?'it counts':'they count'} in P only — not in Confirmed (C) year to date. The button above marks ${pastN===1?'it':'them'} confirmed in one tap; future shifts stay proposed, and unpriced shifts stay unpriced (never $0).`:''}`;
  return `<div class="table-scroll"><table class="csp-table"><thead><tr><th></th><th>C — Confirmed only</th><th>S — Submitted-inclusive</th><th>P — Proposed-inclusive</th></tr></thead><tbody>${row('Year to date','ytd')}${row('Predicted '+y+' annual','predicted')}</tbody></table></div>${pastN?`<div class="toolbar"><button type="button" data-action="confirm-past-shifts" data-id="${y}">Mark ${pastN} past shift${pastN===1?'':'s'} as confirmed</button></div>`:''}${!employmentIncludes1099()?`<p class="muted">Employment type: W-2 only — your pay comes as salary, so these per-shift totals are $0 and do not apply. Change the employment type on the Account tab if you also work 1099.</p>`:''}<details class="csp-info"><summary>What do C, S and P mean?</summary><p class="muted">${explain}</p><p class="muted">${INCOME_DISCLAIMER}</p></details>`;
}
function incomeCSPHTML(y,split){return `<section class="panel"><h2>Income · ${y} — confirmed vs submitted vs proposed</h2>${incomeCSPTableHTML(y,split)}</section>`}
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

function dashboard(){const now=localDate(new Date()),prefix=now.slice(0,7),current=db.shifts.filter(x=>x.date?.startsWith(prefix)),gross=current.reduce((s,x)=>s+num(x.pay),0),upcoming=db.shifts.filter(x=>x.date>=now).sort((a,b)=>a.date.localeCompare(b.date)).slice(0,6),expiring=credentialDeadlines().length,ytdSplit=yearIncomeSplit(currentYear());return `<section class="panel"><h2>Overview · ${new Date().toLocaleDateString('en-US',{month:'long',year:'numeric'})}</h2><div class="stats"><div class="stat"><strong>${current.length}</strong>Shifts this month</div><div class="stat"><strong>${currency(gross)}</strong>Expected gross · this month (all statuses)</div><div class="stat"><strong>${db.facilities.length}</strong>Facilities</div><div class="stat"><strong>${expiring}</strong>Credential deadlines (90 days)</div></div></section>${paystubUpcomingHTML()}${dashboardFacilitySuggestionsHTML()}${onboardingHTML()}${(showShiftForm||editId&&db.shifts.some(x=>x.id===editId))?shiftFormHTML():''}${calendar()}${dayViewHTML()}${incomeCSPHTML(currentYear(),ytdSplit)}${dashboardMonitoringPanel()}<div class="two"><section class="panel"><h2>Upcoming shifts</h2>${upcoming.length?upcoming.map(x=>`<div class="item"><strong>${fmt(x.date)}</strong> · ${escapeHTML(x.facility)}<div class="muted">${escapeHTML(x.type)} · ${x.pay===''||x.incomplete?'Pay not yet priced':currency(x.pay)} · ${shiftStatusLabel(x.status)}</div></div>`).join(''):'<p class="muted">No upcoming shifts.</p>'}</section><section class="panel"><h2>Quick actions</h2><div class="toolbar"><button data-action="add-shift">Add shift</button><button class="secondary" data-action="export-shifts">Export shifts</button><button class="secondary" data-action="backup">Back up data</button><button class="secondary" data-action="ask-assistant">Ask Assistant</button></div><p class="hint">${cloudModeHint()} Export backups regularly.</p></section></div>`}
function shiftFormHTML(){const x=db.shifts.find(x=>x.id===editId)||{},f=db.facilities;return `<section class="panel"><h2>${editId?'Edit':'Add'} shift</h2><form id="entryForm" data-kind="shifts"><div class="form-grid">${field('date','Date','date',x.date||selected,'required')}${field('facility','Hospital / facility','text',x.facility||'','list="facilityNames" required')}<datalist id="facilityNames">${f.map(a=>`<option value="${escapeHTML(a.name)}"></option>`).join('')}</datalist>${select('type','Shift type',['8-hour day','12-hour shift','24-hour call','Second call','Other','Off / PTO'],x.type||'8-hour day')}${select('status','Status',['proposed','submitted','confirmed','rejected','canceled','completed'],normalizeShiftStatus(x.status))}${field('pay','Expected gross pay ($)','number',x.pay??'','min="0" step="0.01" placeholder="Auto from facility"')}${area('note','Shift notes',x.note||'')}</div>${formEnd(editId?'Save changes':'Add shift')}${editId?'':''}<p class="muted">Leave pay blank to use the saved facility rate.</p>${!employmentIncludes1099()?'<p class="muted">Employment type: W-2 only — pay entered here is not counted as billable income, because your pay comes as salary. Off / PTO days are salary days.</p>':''}<p class="muted">New shifts start as Proposed. Changing the status re-prices the totals right away.</p>${editId?'':'<div class="toolbar"><button type="button" class="secondary" data-action="cancel">Close form</button></div>'}</section>`}
function dayViewHTML(){
  if(!dayViewOpen)return '';
  const rows=db.shifts.filter(x=>x.date===selected).slice().sort((a,b)=>String(a.facility||'').localeCompare(String(b.facility||'')));
  const head=`<section class="panel" id="day-view"><h2>${fmt(selected)}</h2>`;
  if(!rows.length)return `${head}<p class="muted">No shifts on this day yet.</p><div class="toolbar"><button data-action="add-shift">Add a shift on this day</button></div></section>`;
  return `${head}${list('shifts',rows,x=>`<div class="item-title">${escapeHTML(x.facility)}</div><div class="muted">${escapeHTML(x.type)} · ${x.pay===''||x.incomplete?'Pay not yet priced — incomplete':currency(x.pay)}${isW2SalaryShift(x)?' · <span class="pill">W-2 salary day — excluded from income totals</span>':''}${x.source==='extracted-from-contract'?' · <span class="pill">from contract</span>':x.source==='extracted-from-contract-photo'?' · <span class="pill">from contract photo</span>':x.source==='user-entered'?' · <span class="pill">user-entered</span>':x.source&&x.source.startsWith('calendar-')?' · <span class="pill">'+escapeHTML({"calendar-google":"from Google Calendar","calendar-apple":"from Apple Calendar","calendar-outlook":"from Outlook","calendar-file":"from calendar file"}[x.source]||'from calendar')+'</span>':''}${typeof liveSyncShiftSyncLabel==='function'?liveSyncShiftSyncLabel(x):''}</div><div class="muted"><label>Status <select data-shift-status="${escapeHTML(x.id)}" aria-label="Status for shift on ${escapeHTML(x.date)}">${shiftStatusOptions(x.status)}</select></label></div><div class="muted"><a href="${googleCalUrl(x)}" target="_blank" rel="noopener">Add to Google</a> · <a href="${outlookCalUrl(x)}" target="_blank" rel="noopener">Add to Outlook</a></div>${x.note?`<p>${escapeHTML(x.note)}</p>`:''}`)}<div class="toolbar"><button data-action="add-shift">Add a shift on this day</button></div><p class="muted">Deleting a shift removes it here right away. A shift that came from a calendar import is never deleted from your calendar — only its copy in the CRNA Hub calendar is removed at the next sync, and the import is flagged so the shift does not come back.</p></section>`;
}
function facilityAliases(f){return String((f&&f.aliases)||'').split(',').map(s=>s.trim()).filter(Boolean)}
function facilityByNameOrAlias(name){const n=String(name||'').trim().toLowerCase();if(!n)return null;return (db.facilities||[]).find(f=>String(f.name||'').trim().toLowerCase()===n||facilityAliases(f).some(a=>a.toLowerCase()===n))||null}
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
function facilitySuggestionsHTML(){
  const active=activeFacilitySuggestions(),dismissed=dismissedFacilitySuggestions();
  if(!active.length&&!dismissed.length)return '';
  let html=`<section class="panel" id="facility-suggestions-panel"><h2>Hospitals noticed in your calendar</h2>`;
  for(const sg of active){
    const range=facilitySuggestionRange(sg);
    html+=`<div class="item"><div class="item-title">We noticed shifts at ${escapeHTML(sg.name)} in your calendar. Add it as a facility?</div><div class="muted">${sg.count?sg.count+' shift(s)':''}${sg.count&&range?' · ':''}${range}${sg.sourceCalendarName?` · from “${escapeHTML(sg.sourceCalendarName)}”`:''}${sg.address?` · ${escapeHTML(sg.address)}`:''}</div>${facilityThreePathsHTML(sg)}<div class="item-actions"><button type="button" class="tiny" data-action="facility-suggestion-yes" data-id="${escapeHTML(sg.id)}">Yes, add facility</button><button type="button" class="tiny secondary" data-action="facility-suggestion-dismiss" data-id="${escapeHTML(sg.id)}">Not now</button></div></div>`;
  }
  if(dismissed.length){
    html+=`<details><summary>Dismissed suggestions (${dismissed.length}) — not asked again on sync</summary>${dismissed.map(sg=>`<div class="item"><div class="item-title">${escapeHTML(sg.name)}</div><div class="muted">${sg.count?sg.count+' shift(s) · ':''}${facilitySuggestionRange(sg)}${sg.sourceCalendarName?` · from “${escapeHTML(sg.sourceCalendarName)}”`:''}</div><div class="item-actions"><button type="button" class="tiny secondary" data-action="facility-suggestion-undismiss" data-id="${escapeHTML(sg.id)}">Ask again</button></div></div>`).join('')}</details>`;
  }
  return html+'</section>';
}
function dashboardFacilitySuggestionsHTML(){
  const active=activeFacilitySuggestions();
  if(!active.length)return '';
  const sg=active[0];
  return `<section class="panel"><h2>New hospital noticed in your calendar</h2><p>We noticed shifts at <strong>${escapeHTML(sg.name)}</strong>${sg.count?` (${sg.count} shift(s)${facilitySuggestionRange(sg)?', '+facilitySuggestionRange(sg):''})`:''} — add it as a facility?</p><p class="muted">Sync your calendar, upload a contract, or manually enter a facility's hourly rate.</p><div class="toolbar"><button type="button" data-action="facility-suggestion-review">Review on Facilities tab</button></div></section>`;
}
function facilityScrollTo(elId){try{const el=document.getElementById(elId);if(el&&el.scrollIntoView)el.scrollIntoView({block:'start'})}catch(e){}}
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
  if(!facilityContractPreview)return '<p class="muted">No contract read yet. Upload a contract or paste its text above, then click “Extract rates” — nothing is saved until you approve the preview below.</p>';
  const p=facilityContractPreview;
  let out=(p.isPhoto?ocrDiagnosticsHTML(facilityContractOcrPages,facilityContractPendingImages,p.ocrText||''):'' )+`<p><strong>Read from:</strong> ${escapeHTML(p.fileName||'pasted text')} · <strong>Method:</strong> ${p.aiRead?'AI vision (gpt-4o-mini) — you tapped “Read with AI”, so the photos you selected were sent to OpenAI for reading. Every field below is flagged “from photo — check carefully”: a vision read can misread digits and dates.':p.isPhoto?'On-device OCR (Tesseract.js) — no picture was sent to a server, and no AI model read this document. Every field below is flagged “from photo — check carefully”: OCR can misread digits and dates.':'deterministic text parsing — no AI model read this document.'}</p><p><strong>Nothing is saved yet.</strong> Correct anything wrong below, uncheck any facility you do not want, then save. Fields the contract did not state are left blank — blank means “not taken here / not applicable”, never $0.</p>${p.aiNote?`<p class="hint">${escapeHTML(p.aiNote)}</p>`:''}`;
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
    <p class="muted">Found: ${f.found.length?escapeHTML(f.found.join(', ')):'nothing recognised'}.${(f.unreadable||[]).length?(' Not readable from the photos (see above): '+escapeHTML((f.unreadable||[]).map(k=>FACILITY_RATE_LABELS[k]||k).join(', '))+'.'):''}${(()=>{const unL=(f.unreadable||[]).map(k=>FACILITY_RATE_LABELS[k]||k);const rest=f.missing.filter(m=>!unL.includes(m));return rest.length?(' Not stated in the contract — fill in by hand if it applies: '+escapeHTML(rest.join(', '))+'.'):''})()}${f.effectiveStart?(' Contract dates: '+fmt(f.effectiveStart)+' to '+fmt(f.effectiveEnd||f.effectiveStart)+'.'):''}${p.shiftCount?(' This document also lists '+p.shiftCount+' shift(s) — shifts are not created here; use the schedule upload on the Account tab to import them from the same contract.'):''}</p></div>`;
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
function facilitiesPage(){const x=db.facilities.find(x=>x.id===editId)||{};const pre=(!editId&&facilitySuggestionPrefill)?facilitySuggestionPrefill:null;const blankHint='placeholder="Leave blank if not taken here"';return `${onboardDirectionHTML(3)}${facilitySuggestionsHTML()}${pre?facilityThreeWaysHTML(pre):''}<section class="panel" id="facility-contract-panel"><h2>Add a facility from a contract</h2><p class="muted">Upload your contract and we’ll extract your dates and pay — you just check the preview. Nothing is saved until you approve below.</p><form id="facilityContractForm"><div class="form-grid">${field('facilityContractFile','Choose contract file(s) — select several pictures for a multi-page contract','file','','accept=".txt,.csv,.ics,.pdf,.png,.jpg,.jpeg,.webp,.heic,text/plain,text/csv,text/calendar,image/*" multiple')}${area('facilityContractText','Or paste contract text','','Facility: Holzer\nRate: $250/hr, $1,000 overnight call bonus\n24-hour / 1st call: $4,800')}</div><div class="form-actions"><button type="submit">Read with AI — recommended (preview only, nothing saved yet)</button><button type="button" class="secondary" data-action="facility-contract-ocr">No connection? Try on-device reading — less accurate on rate tables</button></div></form>${contractPagesHTML('facility')}${facilityContractOcrStatus?`<p class="hint" id="facilityContractOcrStatus">${escapeHTML(facilityContractOcrStatus)}</p>`:''}${facilityContractError&&!facilityContractPreview?`<p class="hint">${escapeHTML(facilityContractError)}</p>`:''}<div style="margin-top:14px">${facilityContractPreviewHTML()}</div>${ruleChatHTML()}</section>${paystubPanelHTML()}<section class="panel" id="facility-manual-panel"><h2>${editId?'Edit hospital':'Add a facility manually'}</h2><p class="muted">No contract? No problem — type the hospital and its rates, and sync will recognise its shifts.</p><p class="muted">Rates are all optional — leave a rate blank if you don’t take it here.</p><form id="entryForm" data-kind="facilities"><div class="form-grid">${field('name','Hospital / facility name','text',x.name||(pre&&pre.name)||'','required')}${field('aliases','Short names / abbreviations (comma-separated)','text',x.aliases||'','placeholder="e.g. CAMC"')}${field('address','Address','text',x.address||(pre&&pre.address)||'')}${field('hourlyRate','Hourly rate ($)','number',x.hourlyRate||'','min="0" step="0.01" '+blankHint)}${field('paidHours8','Paid hours for an 8-hour shift','number',x.paidHours8||'','min="0" step="0.5" placeholder="8"')}${field('rate8','8-hour shift rate ($)','number',x.rate8||'','min="0" step="0.01" '+blankHint)}${field('rate10','10-hour shift rate ($)','number',x.rate10||'','min="0" step="0.01" '+blankHint)}${field('rate12','12-hour shift rate ($)','number',x.rate12||'','min="0" step="0.01" '+blankHint)}${field('rate24','24-hour call rate ($)','number',x.rate24||'','min="0" step="0.01" '+blankHint)}${field('hourlyCall1st','1st call hourly rate ($/hr)','number',x.hourlyCall1st||'','min="0" step="0.01" '+blankHint)}${field('rateSecond','Second call rate — weeknight ($)','number',x.rateSecond||'','min="0" step="0.01" '+blankHint)}${field('weekendRateSecond','Second call rate — weekend ($)','number',x.weekendRateSecond||'','min="0" step="0.01" '+blankHint)}${field('callBonus','Overnight call bonus ($)','number',x.callBonus||'','min="0" step="0.01" '+blankHint)}${field('distance','One-way miles','number',x.distance||'','min="0" step="0.1" placeholder="Auto from home, or enter manually"')}<input type="hidden" name="distanceSource" id="f_distanceSource" value="${escapeHTML(x.distanceSource||(x.distance?'manual':''))}">${area('notes','Offline facility notes',x.notes||'','Parking, protocols, phone numbers, authorized facility codes, EHR URL or username (never passwords)')}</div><p class="hint" id="facilityDistanceStatus">${escapeHTML(facilityDistanceStatus)}</p><div class="toolbar"><button type="button" class="secondary" data-action="facility-distance">Calculate one-way distance from home</button></div>${formEnd(editId?'Save facility':'Add facility')}</section><section class="panel"><h2>My facilities</h2>${list('facilities',db.facilities,x=>{const s=facilityRateSummary(x);return `<div class="item-title">${escapeHTML(x.name)}${facilityAliases(x).length?` <span class="muted">(${escapeHTML(facilityAliases(x).join(', '))})</span>`:''}</div><div class="muted">${escapeHTML(x.address||'No address')} · ${s.set.length?s.set.join(' · '):'No rates set'}${s.missing.length?` · <span class="warning">Not taken here: ${escapeHTML(s.missing.join(', '))}</span>`:''} · ${x.distance?escapeHTML(x.distance)+' miles one-way ('+roundTripMiles(x.distance).toFixed(1)+' round trip)'+(x.distanceSource==='auto'?' (auto-calculated from home)':' (manual)'):'distance not set'}</div>${x.ratesSource?`<div class="muted">Rates from ${escapeHTML(x.ratesSource)}${x.ratesSourceFile?` · ${escapeHTML(x.ratesSourceFile)}`:''}${x.ratesSourceDate?` · ${escapeHTML(x.ratesSourceDate)}`:''}</div>`:'<div class="muted">Rates entered manually.</div>'}${s.set.length===0?'<div class="muted">No pay rule yet — shifts for this facility import unpriced until you set one.</div>':''}${x.notes?`<p style="white-space:pre-wrap">${escapeHTML(x.notes)}</p>`:''}`})}<p class="hint">Facility notes are stored unencrypted in this browser — no passwords or patient information.</p></section>`}
function ptoPage(){const x=db.pto.find(x=>x.id===editId)||{},balance=num(db.settings.ptoStarting)+db.pto.reduce((s,x)=>s+num(x.hours),0);return `<div class="two"><section class="panel"><h2>W-2 PTO balance</h2><div class="stat"><strong>${balance.toFixed(2)} hours</strong>Current recorded balance</div><p class="muted">Positive hours are earned; negative hours are used. Your employer’s balance may differ.</p><div class="form-grid">${field('starting','Starting balance (hours)','number',db.settings.ptoStarting||0,'step="0.25"')}${field('annual','Annual allowance (hours)','number',db.settings.ptoAnnual||0,'step="0.25"')}${field('perperiod','Accrual per pay period (hours)','number',db.settings.ptoHoursPerPeriod||0,'step="0.25"')}</div><div class="form-actions"><button data-action="save-pto-settings">Save PTO rules</button><button class="secondary" data-action="post-accrual">Post pay-period accrual</button></div></section><section class="panel"><h2>${editId?'Edit':'Record'} PTO</h2><form id="entryForm" data-kind="pto"><div class="form-grid">${field('date','Date','date',x.date||localDate(new Date()),'required')}${field('hours','Hours (+ earned / − used)','number',x.hours??'','step="0.25" required')}${field('note','Description','text',x.note||'')}</div>${formEnd(editId?'Save entry':'Record PTO')}</section></div><section class="panel"><h2>PTO ledger</h2>${list('pto',db.pto.slice().sort((a,b)=>b.date.localeCompare(a.date)),x=>`<strong>${fmt(x.date)}</strong> · <span class="${num(x.hours)<0?'expired':'success'}">${num(x.hours)>0?'+':''}${escapeHTML(x.hours)} hours</span><div class="muted">${escapeHTML(x.note||'')}</div>`)}</section>`}

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
  return `<section class="panel" id="cert-documents"><h2>Certification documents</h2>${onboardDirectionHTML(5)}<p class="muted">${escapeHTML(docStorageStatus())}</p><p class="muted">Upload a cert and we’ll read its expiration date — fix it if we misread.</p>${docOcrStatus ? `<p class="hint" id="docOcrStatus">${escapeHTML(docOcrStatus)}</p>` : ''}${docStorageError ? `<p class="hint">Storage note: ${escapeHTML(docStorageError)}</p>` : ''}
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
  // Connect card: the FINAL model leads — system sign-in sheet, Face ID,
  // no passwords in the app. The new-tab sign-in below it is a
  // clearly-labelled preview stand-in (class "standin"), not the design.
  const connCard=(title,desc,pulls,manualNote,siteLabel,siteUrl,portalKey)=>{const st=cloudPortalState(portalKey);const meta=PORTAL_CHECK_SOURCES[portalKey]||{};const opened=portalOpened[portalKey];const spec=(PORTAL_NATIVE_SPEC.sources||{})[portalKey]||{};return `<section class="panel"><h2>${title}</h2><p><strong>Status: ${escapeHTML(st.label)}</strong>${st.detail?` — ${escapeHTML(st.detail)}`:''}</p><p class="muted">${desc}</p><p class="muted">${manualNote}</p>${spec.status?`<p class="muted">Final-design status: <strong>${escapeHTML(spec.status)}</strong> — ${escapeHTML(spec.note||'')}</p>`:''}<div class="standin"><span class="standin-label">Preview stand-in</span> ${PORTAL_STANDIN_LABEL} — sign in on the portal's own page: <a href="${siteUrl}" target="_blank" rel="noopener">${siteLabel}</a>. We never ask for your portal password.${opened?` <strong>${escapeHTML(siteLabel)} is open in a new tab.</strong> Sign in there, then tap “I signed in — check it”.`:''}<div class="toolbar"><button type="button" data-action="connect-portal" data-id="${title}">Connect ${title} — open portal</button><button type="button" class="secondary" data-action="assistant-portal-check" data-id="${title}">I signed in — check it</button><a class="button secondary" href="${siteUrl}" target="_blank" rel="noopener">Open in Safari</a></div></div></section>`};
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
  return `${onboardDirectionHTML(4)}<p class="hint">Tap Connect and sign in on the portal’s own page — in the finished app, Apple’s system sign-in sheet with iPhone Passwords + Face ID, and the app never sees your password.${profileName()?` Portal records are matched to the name from step 1 — “${escapeHTML(profileName())}”.`:``} Records a check brings back are labelled with their source; the rest is user-entered, not verified.</p>
  ${connCard('NBCRNA','National Board of Certification and Recertification for Nurse Anesthetists — your certification record.','certification status, certification period, renewal / recertification deadline, MAC Ed / MAC Dev progress, and CPC check-in status.',nbcrnaManual,'portal.nbcrna.com','https://portal.nbcrna.com/','nbcrna')}
  ${connCard('AANA','American Association of Nurse Anesthesiology — your membership and CE transcript. Kept separate from NBCRNA certification.','membership status, membership expiration, and CE transcript totals (Class A / Class B).',aanaManual,'aana.com/login','https://www.aana.com/login','aana')}
  ${portalMonitoringHTML()}
  ${connCard('State Licenses','State boards of nursing — RN and APRN licenses, one connection per state you hold a license in.','license status, license type (RN / APRN), license number, issue date, and expiration date.',licManual,'State board portals (per license, below)','https://www.nursys.com/','licenses')}
  ${documentsSection(doc)}
  <h2>Manual entry (fallback only)</h2><p class="muted">Use this form when a portal pull is unavailable or has not run. Choose the type below — only that type’s fields are shown. Records saved here are user-entered, not verified; saving here overwrites a portal-pulled record’s source back to user-entered. Real document uploads live in “Certification documents” under the State Licenses card above. Do not store patient information or portal passwords.</p>
  <section class="panel"><h2>Manual entry</h2><div class="form-grid"><div class="field"><label for="f_manualType">Entry type</label><select id="manualTypeSelect" name="manualType"><option value="NBCRNA" ${manualType==='NBCRNA'?'selected':''}>NBCRNA</option><option value="AANA" ${manualType==='AANA'?'selected':''}>AANA</option><option value="State license" ${manualType==='State license'?'selected':''}>State license</option><option value="NBCRNA CE" ${manualType==='NBCRNA CE'?'selected':''}>NBCRNA CE record</option><option value="AANA CE" ${manualType==='AANA CE'?'selected':''}>AANA CE record</option><option value="Other credential" ${manualType==='Other credential'?'selected':''}>Other credential</option></select></div></div>
  ${manualForm}
  ${manualList}</section>`;
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
// re-query; the home address itself is stored on-device only, like shifts
// and facilities, and is sent only to those two public services when a
// calculation is requested.
let mileageCalcStatus='',facilityDistanceStatus='',homeGeocodeStatus='';
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
async function homeToFacilityMiles(f,originAddr){
  const home=String(originAddr!==undefined?originAddr:(db.settings&&db.settings.homeAddress)||'').trim();
  const dest=String((f&&f.address)||'').trim();
  if(!home||!dest)return null;
  const isHome=!originAddr||home===String((db.settings&&db.settings.homeAddress)||'').trim();
  let h=null;
  if(isHome&&db.settings.homeLat&&db.settings.homeLng&&db.settings.homeGeocodedAddress===home)h={lat:+db.settings.homeLat,lon:+db.settings.homeLng};
  else{h=await geocodeAddress(home);if(!h)return null;if(isHome){db.settings.homeLat=String(h.lat);db.settings.homeLng=String(h.lon);db.settings.homeGeocodedAddress=home;persist()}}
  let d=null;
  if(f.lat&&f.lng&&f.geocodedAddress===dest)d={lat:+f.lat,lon:+f.lng};
  else{d=await geocodeAddress(dest);if(!d)return null;f.lat=String(d.lat);f.lng=String(d.lon);f.geocodedAddress=dest;persist()}
  const miles=await drivingMilesOneWay(h,d);
  return miles==null?null:{oneWay:miles};
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
      const want=String(s.facility).trim().toLowerCase();
      if(!f||String(f.name||'').trim().toLowerCase()!==want)return false;
    }
    return true;
  })||null;
}
function knownHotelAddresses(){
  const seen=new Set(),out=[];
  const add=a=>{const s=String(a||'').trim();if(s&&!seen.has(s.toLowerCase())){seen.add(s.toLowerCase());out.push(s)}};
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
  return {id:id(),date:x.date,purpose:'Scheduled facility trip: '+f.name,facility:f.name,miles:String(miles),status:'draft',milesSource:source,origin:o,hotelAddress:(o==='hotel'||o==='other')?String(hotelAddress||''):'' ,tripType:t,oneWayMiles:String(Math.round(Number(oneWay)*10)/10)};
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
// rule is created. Past weeks stay reviewable until confirmed.
let mileageReviewWeek='';
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
  return String(m.date||'')===String(shift.date||'')&&String(m.facility||'').trim().toLowerCase()===String(shift.facility||'').trim().toLowerCase();
}
function weeklyMileageReview(start,todayStr){
  const end=weekEndISO(start),today=todayStr||localDate(new Date());
  const shifts=shiftsInWeek(start),trips=mileageTripsInWeek(start);
  const drafts=trips.filter(x=>x.status==='draft');
  const verified=trips.filter(x=>x.status==='verified');
  const skipped=trips.filter(x=>x.status==='skipped');
  const missing=shifts.filter(sh=>!trips.some(t=>mileageTripMatchesShift(t,sh)));
  const needsMiles=drafts.filter(x=>!(num(x.miles)>0));
  const toReview=drafts.length+missing.length;
  return {start:start,end:end,shifts:shifts,trips:trips,drafts:drafts,verified:verified,skipped:skipped,missing:missing,needsMiles:needsMiles,toReview:toReview,allConfirmed:shifts.length>0&&toReview===0,due:toReview>0&&today>=end,overdue:toReview>0&&today>end};
}
function dueMileageWeeks(todayStr){
  const today=todayStr||localDate(new Date());
  return mileageWeeks().map(w=>weeklyMileageReview(w,today)).filter(r=>r.due).sort((a,b)=>a.start.localeCompare(b.start));
}
function mileageReviewStatusLine(start,todayStr){
  const r=weeklyMileageReview(start,todayStr);
  return r.allConfirmed?('Week of '+weekRangeLabel(start)+': All confirmed'):('Week of '+weekRangeLabel(start)+': '+r.toReview+' trip'+(r.toReview===1?'':'s')+' to review');
}
function selectedMileageReviewWeek(todayStr){
  const weeks=mileageWeeks();
  if(!weeks.length)return weekStartISO(todayStr||localDate(new Date()));
  if(mileageReviewWeek&&weeks.includes(mileageReviewWeek))return mileageReviewWeek;
  const due=dueMileageWeeks(todayStr);
  if(due.length)return due[0].start;
  return weeks[0];
}
function verifiedMileageTrips(){return (db.mileage||[]).filter(x=>x.status==='verified')}
function verifiedMileageTotal(){return verifiedMileageTrips().reduce((s,x)=>s+num(x.miles),0)}
function mileageOriginLabel(m){
  if(m.origin==='hotel')return 'Hotel'+(m.hotelAddress?': '+m.hotelAddress:'');
  if(m.origin==='other')return m.hotelAddress||'Other address';
  return 'Home';
}
function mileageTripLine(x){
  const miles=num(x.miles)>0?escapeHTML(x.miles)+' mi':'miles not entered';
  const type=x.tripType==='one-way'?'one way':'round trip';
  return `<strong>${fmt(x.date)}</strong> \u00b7 ${miles} <span class="pill">${escapeHTML(x.status||'verified')}</span>${x.status==='draft'?' <span class="pill warn">needs weekly review</span>':''}${x.milesSource==='auto'?' <span class="pill">auto-calculated</span>':x.milesSource==='manual-override'?' <span class="pill">auto-calculated, edited by you</span>':x.milesSource==='needs-manual'?' <span class="pill warn">miles needed</span>':''}<div class="muted">${x.facility?escapeHTML(x.facility)+' \u00b7 ':''}${escapeHTML(mileageOriginLabel(x))} \u00b7 ${type} \u00b7 ${escapeHTML(x.purpose)}</div>`;
}
// A draft for a shift whose distance cannot be computed: blank miles,
// flagged for manual entry. Never a guessed number.
function blankMileageDraftForShift(x,origin,hotelAddress){
  const o=origin==='hotel'?'hotel':'home';
  return {id:id(),date:x.date,purpose:'Scheduled facility trip: '+String(x.facility||''),facility:String(x.facility||''),miles:'',status:'draft',milesSource:'needs-manual',origin:o,hotelAddress:o==='hotel'?String(hotelAddress||''):'' ,tripType:mileageTripType(),oneWayMiles:''};
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
    const f=facilityByNameOrAlias(x.facility);
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
async function generateWeeklyMileageDrafts(start){
  let created=0,auto=0,hotel=0,blank=0;
  for(const m of mileageTripsInWeek(start).filter(x=>x.status==='draft'&&!(num(x.miles)>0))){
    const f=facilityByNameOrAlias(m.facility);
    if(!f)continue;
    const addr=(m.origin!=='home'&&m.hotelAddress)?m.hotelAddress:undefined;
    const res=await homeToFacilityMiles(f,addr);
    if(!res)continue;
    const t=m.tripType==='one-way'?'one-way':'round-trip';
    m.oneWayMiles=String(res.oneWay);
    m.miles=String(tripMilesFor(res.oneWay,t));
    m.tripType=t;
    m.milesSource='auto';
    auto++;
  }
  for(const x of shiftsInWeek(start)){
    if((db.mileage||[]).some(m=>mileageTripMatchesShift(m,x)))continue;
    const f=facilityByNameOrAlias(x.facility);
    const stay=hotelStayFor(x.date,x.facility);
    let oneWay=null,source='',origin='home',hotelAddress='';
    if(stay&&f){const res=await homeToFacilityMiles(f,stay.hotelAddress);if(res){oneWay=res.oneWay;source='auto';origin='hotel';hotelAddress=stay.hotelAddress}}
    else if(f){const res=await homeToFacilityMiles(f);if(res){oneWay=res.oneWay;source='auto'}else{oneWay=effectiveOneWayMiles(f);source='manual'}}
    let draft=null;
    if(oneWay>0&&f)draft=mileageDraftForShift(x,f,oneWay,source,origin,hotelAddress,mileageTripType());
    if(draft){db.mileage.push(draft);created++;if(source==='auto')auto++;if(origin==='hotel')hotel++;}
    else{db.mileage.push(blankMileageDraftForShift(x,stay?'hotel':'home',stay?stay.hotelAddress:''));created++;blank++;}
  }
  persist();render();
  alert(created+' mileage draft(s) created for the week of '+weekRangeLabel(start)+(auto?' ('+auto+' auto-calculated'+(hotel?', '+hotel+' from a hotel stay':'')+')':'')+'.'+(blank?' '+blank+' could not be calculated, so '+(blank===1?'its miles are':'their miles are')+' blank \u2014 enter them manually, nothing was guessed.':'')+' Review the week and confirm all trips.');
  return {created:created,auto:auto,hotel:hotel,blank:blank};
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
  let changed=0;
  for(const m of weeklyMileageReview(start).drafts){
    const origin=reviewInputValue('reviewOrigin',m.id);
    const milesRaw=reviewInputValue('reviewMiles',m.id);
    const otherRaw=reviewInputValue('reviewOther',m.id);
    const typeRaw=reviewInputValue('reviewTripType',m.id);
    if(origin==='home'||origin==='hotel'||origin==='other'){
      if(origin!==m.origin){
        m.origin=origin;
        m.miles='';m.oneWayMiles='';m.milesSource='needs-manual';
        const stay=hotelStayFor(m.date,m.facility);
        if(origin==='hotel'&&stay)m.hotelAddress=stay.hotelAddress;
        else if(origin!=='home'&&otherRaw!=null&&String(otherRaw).trim())m.hotelAddress=String(otherRaw).trim();
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
  if(changed>0)persist();
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
    alert('Confirmed '+confirmed+' trip(s) for the week of '+weekRangeLabel(start)+'. '+left.toReview+' trip(s) still need review'+(left.needsMiles.length?' \u2014 '+left.needsMiles.length+' still '+(left.needsMiles.length===1?'has':'have')+' no miles, so '+(left.needsMiles.length===1?'it stays':'they stay')+' a draft until you enter miles':'')+'. Nothing was guessed.');
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
function mileageReviewHTML(){
  const weeks=mileageWeeks();
  if(!weeks.length)return '';
  const start=selectedMileageReviewWeek();
  ensureWeeklyMileageDrafts(start);
  const r=weeklyMileageReview(start);
  const due=dueMileageWeeks();
  const rows=[...r.trips].sort((a,b)=>String(a.date||'').localeCompare(String(b.date||'')));
  const originOptions=m=>`<select class="reviewOrigin" data-trip="${escapeHTML(m.id)}"><option value="home" ${m.origin!=='hotel'&&m.origin!=='other'?'selected':''}>Home</option><option value="hotel" ${m.origin==='hotel'?'selected':''}>Hotel</option><option value="other" ${m.origin==='other'?'selected':''}>Other address</option></select><input class="reviewOther" data-trip="${escapeHTML(m.id)}" value="${escapeHTML(m.hotelAddress||'')}" placeholder="Hotel / other address">`;
  const typeOptions=m=>`<select class="reviewTripType" data-trip="${escapeHTML(m.id)}"><option value="round-trip" ${m.tripType!=='one-way'?'selected':''}>Round trip</option><option value="one-way" ${m.tripType==='one-way'?'selected':''}>One way</option></select>`;
  const body=rows.map(m=>{
    if(m.status==='verified')return `<tr><td>${fmt(m.date)}</td><td>${escapeHTML(m.facility)}</td><td>${escapeHTML(mileageOriginLabel(m))}</td><td>${escapeHTML(m.miles)} mi</td><td>${m.tripType==='one-way'?'One way':'Round trip'}</td><td><span class="pill">Confirmed</span></td></tr>`;
    if(m.status==='skipped')return `<tr><td>${fmt(m.date)}</td><td>${escapeHTML(m.facility)}</td><td>${escapeHTML(mileageOriginLabel(m))}</td><td>${num(m.miles)>0?escapeHTML(m.miles)+' mi':'\u2014'}</td><td>${m.tripType==='one-way'?'One way':'Round trip'}</td><td><span class="pill warn">Skipped</span> <button type="button" class="tiny secondary" data-action="mileage-review-restore" data-id="${escapeHTML(m.id)}">Restore</button></td></tr>`;
    return `<tr><td>${fmt(m.date)}</td><td>${escapeHTML(m.facility)}</td><td>${originOptions(m)}</td><td><input type="number" class="reviewMiles" data-trip="${escapeHTML(m.id)}" value="${escapeHTML(m.miles||'')}" min="0" step="0.1" placeholder="Enter miles">${!(num(m.miles)>0)?' <span class="pill warn">miles needed</span>':''}</td><td>${typeOptions(m)}</td><td><button type="button" class="tiny secondary" data-action="mileage-review-skip" data-id="${escapeHTML(m.id)}">Skip</button></td></tr>`;
  }).join('');
  return `<section class="panel"><h2>Weekly mileage review</h2><p><strong>${escapeHTML(mileageReviewStatusLine(start))}</strong>${r.overdue?' \u00b7 <span class="expired">overdue \u2014 the week ended '+fmt(r.end)+'</span>':r.due?' \u00b7 due now':''}</p><div class="toolbar"><button type="button" class="secondary" data-action="mileage-review-prev">\u2039 Previous week</button><select id="mileageReviewWeekSelect">${weeks.map(w=>`<option value="${w}" ${w===start?'selected':''}>Week of ${weekRangeLabel(w)}${weeklyMileageReview(w).allConfirmed?' \u2014 All confirmed':' \u2014 '+weeklyMileageReview(w).toReview+' to review'}</option>`).join('')}</select><button type="button" class="secondary" data-action="mileage-review-next">Next week \u203a</button><button type="button" class="secondary" data-action="mileage-review-generate">Calculate miles for this week</button></div><p class="muted">One screen per week: check every trip, fix the starting point or miles, skip any trip that did not happen, then confirm the whole week at once. Only confirmed trips count in totals and exports. Past weeks stay here until confirmed. Changing a starting point clears its miles — enter them, or tap Calculate miles for this week.</p>${rows.length?`<div class="table-scroll"><table class="contract-table"><thead><tr><th>Date</th><th>Facility</th><th>Starting point</th><th>Miles</th><th>Type</th><th></th></tr></thead><tbody>${body}</tbody></table></div>`:'<p class="muted">No trips in this week.</p>'}<div class="form-actions"><button type="button" data-action="mileage-review-confirm">Confirm all \u2014 ${r.drafts.length} trip(s)</button><button type="button" class="secondary" data-action="mileage-review-save">Save changes</button></div><p class="muted">${r.needsMiles.length?r.needsMiles.length+' trip(s) have no miles yet \u2014 enter miles to confirm them; nothing is guessed. ':''}${due.length>1?'Other weeks still to review: '+due.filter(d=>d.start!==start).map(d=>mileageReviewStatusLine(d.start)).join('; ')+'.':''}</p></section>`;
}
function dashboardMileageNudgeHTML(){
  const due=dueMileageWeeks();
  if(!due.length)return '';
  const r=due[0],others=due.length-1;
  return `<section class="panel"><h2>Mileage review ${r.overdue?'overdue':'due'}</h2><p><strong>${escapeHTML(mileageReviewStatusLine(r.start))}</strong>${r.overdue?' \u2014 the week ended '+fmt(r.end)+' and it is still unconfirmed.':''}${others?' Plus '+others+' other week'+(others===1?'':'s')+' to review.':''}</p><div class="toolbar"><button data-action="mileage-review-goto" data-id="${escapeHTML(r.start)}">Review week of ${escapeHTML(weekRangeLabel(r.start))}</button><button class="secondary" data-action="goto-mileage">Open Mileage tab</button></div><p class="muted">One screen per week — confirm all trips at once. Only confirmed trips count in totals and exports.</p></section>`;
}
function homeAddressSection(){
  const s=db.settings||{},saved=String(s.homeAddress||'').trim();
  return `<section class="panel"><h2>Home address — for automatic mileage</h2><p class="muted">Enter your home address once and mileage is calculated automatically from home to each facility — round trip by default, or one way if you pick that on the Mileage tab. ${saved?`Saved: <strong>${escapeHTML(saved)}</strong>${s.homeLat&&s.homeLng?' (located — ready to calculate)':' (saved, but not located yet — it will be checked when you calculate mileage)'}.`:'No home address saved yet.'}</p><form data-kind="home-address"><div class="form-grid">${field('homeAddress','Home address','text',s.homeAddress||'','placeholder="Street, City, State ZIP"')}</div>${formEnd('Save home address')}</form>${homeGeocodeStatus?`<p class="hint">${escapeHTML(homeGeocodeStatus)}</p>`:''}<p class="muted">Your home address is stored on this device only and used only to calculate mileage. A calculation sends it to the public OpenStreetMap geocoder and OSRM routing service (no account or key) to get the driving distance — nothing else is sent anywhere. Leave it blank if you do not want automatic mileage.</p></section>`;
}
async function submitHomeAddress(e){
  const fd=new FormData(e.currentTarget);
  const addr=String(fd.get('homeAddress')||'').trim();
  db.settings.homeAddress=addr;
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
  const originAddr=origin==='hotel'?(hotelEl?String(hotelEl.value||'').trim():''):String((db.settings&&db.settings.homeAddress)||'').trim();
  const originLabel=origin==='hotel'?'hotel':'home';
  if(!originAddr){setStatus(origin==='hotel'?'Enter the hotel address first — mileage is calculated from the hotel to this facility.':'Set your home address on the Account tab first — mileage is calculated from home to this facility.');return}
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
function mileagePage(){const x=db.mileage.find(x=>x.id===editId)||{},stay=db.hotelStays.find(x=>x.id===editId)||{},total=verifiedMileageTotal(),draftCount=db.mileage.filter(x=>x.status==='draft').length,home=String((db.settings&&db.settings.homeAddress)||'').trim(),hotels=knownHotelAddresses(),isStayEdit=!!stay;const tripOrigin=x.origin==='hotel'?'hotel':x.origin==='other'?'other':'home',tripHotel=x.hotelAddress||((db.settings&&db.settings.lastHotelAddress)||'');const tripType=x.tripType==='one-way'?'one-way':mileageTripType(),rtCount=verifiedMileageTrips().filter(m=>m.tripType!=='one-way').length,owCount=verifiedMileageTrips().length-rtCount;return `${mileageReviewHTML()}<div class="two"><section class="panel"><h2>${editId&&!isStayEdit?'Edit':'Log'} business mileage</h2><p class="muted">${home?`Home: ${escapeHTML(home)} — mileage below can be auto-calculated from home.`:`No home address saved yet — set it on the Account tab to auto-calculate mileage.`}</p><div class="toolbar"><button type="button" class="secondary tiny" data-action="goto-account">Set home address on the Account tab</button></div><form id="entryForm" data-kind="mileage"><div class="form-grid">${field('date','Trip date','date',x.date||localDate(new Date()),'required')}${select('facility','Hospital / facility',[''].concat((db.facilities||[]).map(f=>f.name)),x.facility||'')}${selectLabeled('origin','Starting point',[['home','Home'],['hotel','Hotel'],['other','Other address']],tripOrigin)}${field('hotelAddress','Hotel / other address (only when starting point is Hotel or Other address)','text',tripHotel,'list="hotelAddresses" placeholder="Hotel street, city, state ZIP"')}<datalist id="hotelAddresses">${hotels.map(h=>`<option value="${escapeHTML(h)}"></option>`).join('')}</datalist>${selectLabeled('tripType','Mileage type',[['round-trip','Round trip'],['one-way','One way']],tripType)}${field('miles','Actual miles','number',x.miles??'','min="0" step="0.1" required')}<input type="hidden" name="milesSource" id="f_milesSource" value="${escapeHTML(x.milesSource||(x.miles?'manual':''))}"><input type="hidden" name="oneWayMiles" id="f_oneWayMiles" value="${escapeHTML(x.oneWayMiles||'')}">${field('purpose','Business purpose','text',x.purpose||'','required')}${select('status','Verification',['verified','draft'],x.status||'verified')}</div><p class="hint" id="mileageCalcStatus">${escapeHTML(mileageCalcStatus)}</p><div class="toolbar"><button type="button" class="secondary" data-action="mileage-autocalc">Calculate miles (from home or hotel)</button></div>${formEnd(editId&&!isStayEdit?'Save trip':'Log trip')}</section><section class="panel"><h2>Mileage summary</h2><div class="stat"><strong>${total.toFixed(1)} miles</strong>Verified trips only — ${rtCount} round-trip · ${owCount} one-way${draftCount?` · ${draftCount} draft(s) not counted yet`:''}</div><p class="muted">Each trip is counted once. A round trip already includes the return leg, so it is never doubled.</p><div class="field"><label for="mileageTripTypeSelect">Default mileage type for new trips and drafts</label><select id="mileageTripTypeSelect"><option value="round-trip" ${mileageTripType()==='round-trip'?'selected':''}>Round trip (default)</option><option value="one-way" ${mileageTripType()==='one-way'?'selected':''}>One way</option></select></div><div class="toolbar" style="margin-top:14px"><button data-action="mileage-drafts">Generate schedule-based drafts</button><button class="secondary" data-action="export-mileage">Export CSV</button></div><p class="hint">Drafts use your default mileage type (currently ${tripTypeLabel(mileageTripType())}): the auto-calculated ${tripTypeLabel(mileageTripType())} distance from home when it can be computed, otherwise the facility’s saved one-way distance converted to ${tripTypeLabel(mileageTripType())}. A shift inside a saved hotel stay below is calculated from the HOTEL address instead. Trips with neither show up in the weekly review above with blank miles — never guessed. Confirm the trip happened, the miles, and that it counts for tax. Regular commuting is generally not deductible.</p></section></div><section class="panel"><h2>Hotel stays — one address for a whole block</h2><p class="muted">Staying in a hotel for a block of shifts? Enter the hotel address and dates once here. Drafts for shifts in that block are calculated from the hotel, not home — and when you log a trip by hand, pick “Hotel” and the address is already filled in. A hotel address you enter on a trip is remembered for the next one.</p><p class="muted">Drafts from a stay use your mileage type — currently ${tripTypeLabel(mileageTripType())} — and show as hotel-based in the trip log.</p><form id="stayForm" data-kind="hotelStays"><div class="form-grid">${field('hotelAddress','Hotel address','text',stay.hotelAddress||'','required placeholder="Hotel street, city, state ZIP"')}${field('checkIn','Check-in date','date',stay.checkIn||localDate(new Date()),'required')}${field('checkOut','Check-out date','date',stay.checkOut||localDate(new Date()),'required')}${select('facility','Facility (blank = any facility)',[''].concat((db.facilities||[]).map(f=>f.name)),stay.facility||'')}${field('note','Note','text',stay.note||'','placeholder="e.g. Call block"')}</div>${formEnd(isStayEdit?'Save hotel stay':'Add hotel stay')}</form>${list('hotelStays',(db.hotelStays||[]).slice().sort((a,b)=>(b.checkIn||'').localeCompare(a.checkIn||'')),s=>`<div class="item-title">${escapeHTML(s.hotelAddress)}</div><div class="muted">${fmt(s.checkIn)} to ${fmt(s.checkOut)}${s.facility?` · ${escapeHTML(s.facility)}`:' · any facility'}${s.note?` · ${escapeHTML(s.note)}`:''}</div>`)}</section><section class="panel"><h2>Trip log</h2>${list('mileage',db.mileage.slice().sort((a,b)=>b.date.localeCompare(a.date)),mileageTripLine)})}</section>`}

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
function calPreviewHTML(){if(!calPreview)return '<p class="muted">No calendar file parsed yet. Choose an .ics file above, then parse it — nothing is saved until you approve the preview.</p>';const rows=calPreview.rows,dup=rows.filter(r=>r.duplicate).length,need=rows.filter(r=>r.flags.length).length;return `<p><strong>Parsed from:</strong> ${escapeHTML(calPreview.fileName)} · Source: ${escapeHTML(calPreview.sourceLabel)} · ${rows.length} event(s) · ${rows.filter(r=>r.include&&!r.duplicate).length} would be added · ${dup} duplicate(s) will be skipped</p><p class="muted">Duplicates are events already in the app with the same date, facility, and shift type. Uncheck any row to leave it out. Rows with a missing date or facility block approval until fixed or unchecked.</p><div class="table-scroll"><table class="contract-table"><thead><tr><th></th><th>Date</th><th>Facility</th><th>Shift type</th><th>Pay</th><th>Flags</th></tr></thead><tbody>${rows.map((r,i)=>`<tr><td><input type="checkbox" class="calInclude" data-row="${i}" ${r.include?'checked':''}></td><td><input type="date" class="calEdit" data-row="${i}" data-field="date" value="${escapeHTML(r.date||'')}"></td><td><input class="calEdit" data-row="${i}" data-field="facility" value="${escapeHTML(r.facility||'')}"></td><td><input class="calEdit" data-row="${i}" data-field="type" value="${escapeHTML(r.type||'')}"></td><td><input class="calEdit" data-row="${i}" data-field="pay" value="${escapeHTML(r.pay||'')}"></td><td>${r.duplicate?'<span class="pill warn">duplicate — will be skipped</span> ':''}${r.flags.map(f=>`<span class="pill warn">${escapeHTML(f)}</span>`).join(' ')||'<span class="pill">clean</span>'}</td></tr>`).join('')}</tbody></table></div><div class="form-actions"><button type="button" data-action="cal-approve">Approve selected — add shifts</button><button type="button" class="secondary" data-action="cal-discard">Discard preview</button></div>`}
async function importCalendar(e){e.preventDefault();calImportError='';const f=$('f_calFile').files[0];const sourceLabel=$('f_calSource').value||'Calendar file';if(!f){calImportError='Choose an .ics calendar file first (Google, Apple, or Outlook can all export one).';return render()}let text='';try{text=await f.text()}catch(err){calImportError='Could not read that file: '+err.message;return render()}if(!/^BEGIN:VCALENDAR/i.test(text.trim())){calImportError='That file is not a calendar (.ics) file. Export your calendar as .ics from Google, Apple, or Outlook and try again. Nothing was saved.';calPreview=null;return render()}const parsed=parseICS(text,f.name);const sourceCode=CAL_SOURCES[sourceLabel]||'calendar-file';const grossByBlock=text.split(/BEGIN:VEVENT/i).slice(1).map(b=>{const m=b.match(/Expected gross:\s*\$?([\d\\,]+(?:\.\d+)?)/i);return m?m[1].replace(/[\\,]/g,''):''});const rows=parsed.rows.map((r,ri)=>{if(grossByBlock[ri])r={...r,pay:grossByBlock[ri]};const duplicate=(db.shifts||[]).some(x=>x.date===r.date&&x.facility===r.facility&&x.type===r.type);const flags=[...r.flags];if(duplicate)flags.push('already in CRNA Hub — duplicate');return {...r,source:sourceCode,sourceLabel,status:importStatusForDate(r.date),include:!duplicate,duplicate,incomplete:!String(r.pay||'').trim(),note:'Imported from '+sourceLabel+' (.ics): '+f.name}});calPreview={fileName:f.name,sourceLabel,sourceCode,rows};if(!rows.length){calImportError='No events found in that calendar file. Nothing was saved.';calPreview=null}render()}
function approveCalendarImport(){if(!calPreview)return;const rows=calPreview.rows.filter(r=>r.include&&!r.duplicate);const blocked=rows.filter(r=>!r.date||!/^\d{4}-\d{2}-\d{2}$/.test(r.date)||!String(r.facility||'').trim());if(blocked.length){alert('Fix or uncheck these rows before approving: '+(blocked.map(r=>`${r.date||'(no date)'} ${r.facility||'(no facility)'} ${r.type}`).join('; ')));return}let created=0,skipped=0,newFacilities=0;for(const r of rows){if((db.shifts||[]).some(x=>x.date===r.date&&x.facility===r.facility&&x.type===r.type)){skipped++;continue}const pay=String(r.pay||'').trim();db.shifts.push({id:id(),date:r.date,facility:String(r.facility).trim(),type:r.type,pay,status:importStatusForDate(r.date),source:r.source,incomplete:!pay,note:r.note});created++;if(r.facility&&!facilityByNameOrAlias(r.facility)){db.facilities.push({id:id(),name:String(r.facility).trim(),aliases:'',address:'',rate8:'',rate10:'',rate12:'',rate24:'',rateSecond:'',hourlyRate:'',paidHours8:'',callBonus:'',distance:'',notes:''});newFacilities++}}const dups=calPreview.rows.filter(r=>r.duplicate).length;calPreview=null;persist();render();alert(`Added ${created} shift(s) from the calendar. Skipped ${skipped+dups} duplicate(s).${newFacilities?` New facilit(ies) learned: set their pay rules on the Facilities tab.`:''}`)}
function exportCalendarICS(shifts,filename){if(!shifts.length){alert('No shifts to export.');return}download(filename,shiftsToICS(shifts),'text/calendar;charset=utf-8')}
function backupHTML(){
  return `<section class="panel"><h2>Backup &amp; restore</h2><p class="muted">Back up before changing phones, clearing browser data, or replacing the website. Backups include saved contracts and their linked shifts.</p><p class="muted">Current mode: <strong>${escapeHTML(cloudHeaderLabel())}</strong>. A backup restores records onto this device only — it never overwrites your cloud account. To push restored records to the cloud, use “Upload my on-device records” above.</p><div class="toolbar"><button data-action="backup">Download JSON backup</button><button class="secondary" data-action="export-shifts">Download shift CSV</button><button class="secondary" data-action="export-mileage">Download mileage CSV</button></div><label for="restoreFile">Restore a CRNA Hub JSON backup (replaces current records)</label><input id="restoreFile" type="file" accept=".json,application/json"><p class="muted" style="font-size:0.85em">${INCOME_DISCLAIMER}</p><p class="muted" style="font-size:0.85em">CRNA Hub version: ${escapeHTML(BUILD_STAMP)}</p></section>`;
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
    const duplicate=(db.shifts||[]).some(x=>x.date===r.date&&x.facility===r.facility&&x.type===r.type);
    const cls=scheduleClassifyRow(r);
    if(cls.match!=='uncertain')anyName=true;
    const flags=[];
    if(duplicate)flags.push('already in CRNA Hub — duplicate');
    if(cls.match==='other')flags.push('other person — excluded');
    if(cls.match==='uncertain')flags.push('uncertain — check to include');
    if(r.facility&&!facilityByNameOrAlias(r.facility))flags.push('new facility — will be suggested, not created');
    rows.push({...r,match:cls.match,matchedName:cls.matchedName,include:cls.match==='matched'&&!duplicate,duplicate,flags,incomplete:!String(r.pay||'').trim(),source:'schedule-import'});
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
    for(const r of rows){r.match='matched';r.matchedName='';r.include=!r.duplicate;r.flags=r.flags.filter(f=>f!=='uncertain — check to include')}
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
  return `<div id="schedule-import-panel"><h2>Upload a schedule</h2><p class="muted">No live calendar? Upload a schedule instead — we’ll pick out only your shifts.</p>${scheduleImportContext==='qgenda'?'<p class="hint">Signed in to QGenda? Upload a screenshot of the schedule page or a Reports export here — the app reads it and shows a preview before saving anything. QGenda sessions expire, so re-sign in and re-check for fresh shifts; this path does not sync in the background.</p>':''}<form id="scheduleForm"><div class="form-grid">${field('scheduleNameUpload','Name as it appears on your schedule','text',nm,'placeholder="e.g. C. Martin"')}${field('scheduleFile','Choose a schedule file','file','','accept=".csv,.xlsx,.pdf,.png,.jpg,.jpeg,.webp,.heic,text/plain,text/csv"')}${area('scheduleText','Or paste schedule text','','2026-11-10, Holzer, 8-hour day\nNov 12 — C. Martin — Holzer 8/2nd call')}</div><div class="form-actions"><button type="submit">Read schedule — preview only (nothing saved yet)</button><button type="button" class="secondary" data-action="save-schedule-name">Save name only</button></div></form>${scheduleAiStatus?`<p class="hint">${escapeHTML(scheduleAiStatus)}</p>`:''}${scheduleImportError?`<p class="hint">${escapeHTML(scheduleImportError)}</p>`:''}<div style="margin-top:14px">${schedulePreviewHTML()}</div></div>`;
}
function schedulePreviewHTML(){
  if(!schedulePreview)return '<p class="muted">No schedule parsed yet. Choose a file above, then read it — nothing is saved until you approve the preview.</p>';
  const rows=schedulePreview.rows;
  const matched=rows.filter(r=>r.match==='matched').length,other=rows.filter(r=>r.match==='other').length,unc=rows.filter(r=>r.match==='uncertain').length,dup=rows.filter(r=>r.duplicate).length;
  return `<p><strong>Parsed from:</strong> ${escapeHTML(schedulePreview.fileName)} · ${rows.length} row(s) · ${rows.filter(r=>r.include&&!r.duplicate).length} would be added · ${dup} duplicate(s) will be skipped</p><p class="muted">Matched name: <strong>${escapeHTML(schedulePreview.matchedName||'(not set — add it above)')}</strong>${schedulePreview.noNamesInFile?' — no names found in this file, so it was treated as your own schedule; uncheck anything that is not yours.':''} ${matched} row(s) matched you, ${other} row(s) for other people are excluded, ${unc} uncertain row(s) are unchecked — check one to include it. Rows with a missing date or facility block approval until fixed or unchecked. Past shifts arrive confirmed (they already happened); future shifts arrive proposed.</p><div class="table-scroll"><table class="contract-table"><thead><tr><th></th><th>Date</th><th>Facility</th><th>Shift type</th><th>Pay</th><th>Name on row</th><th>Flags</th></tr></thead><tbody>${rows.map((r,i)=>`<tr><td><input type="checkbox" class="schedInclude" data-row="${i}" ${r.include?'checked':''} ${r.match==='other'?'disabled':''}></td><td><input type="date" class="schedEdit" data-row="${i}" data-field="date" value="${escapeHTML(r.date||'')}"></td><td><input class="schedEdit" data-row="${i}" data-field="facility" value="${escapeHTML(r.facility||'')}"></td><td><input class="schedEdit" data-row="${i}" data-field="type" value="${escapeHTML(r.type||'')}"></td><td><input class="schedEdit" data-row="${i}" data-field="pay" value="${escapeHTML(r.pay||'')}"></td><td>${escapeHTML(r.matchedName||r.name||'—')}</td><td>${r.flags.map(f=>`<span class="pill warn">${escapeHTML(f)}</span>`).join(' ')||'<span class="pill">clean</span>'}</td></tr>`).join('')}</tbody></table></div><div class="form-actions"><button type="button" data-action="schedule-approve">Approve selected — add shifts</button><button type="button" class="secondary" data-action="schedule-discard">Discard preview</button></div>`;
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
  const rows=schedulePreview.rows.filter(r=>r.include&&!r.duplicate&&r.match!=='other');
  const blocked=rows.filter(r=>!r.date||!/^\d{4}-\d{2}-\d{2}$/.test(r.date)||!String(r.facility||'').trim());
  if(blocked.length){alert('Fix or uncheck these rows before approving: '+(blocked.map(r=>`${r.date||'(no date)'} ${r.facility||'(no facility)'} ${r.type}`).join('; ')));return}
  if(!rows.length){alert('Nothing selected to add — check the rows that are yours, or discard the preview.');return}
  let created=0,skipped=0,incomplete=0; const newNames=[];
  for(const r of rows){
    if((db.shifts||[]).some(x=>x.date===r.date&&x.facility===r.facility&&x.type===r.type)){skipped++;continue}
    let pay=String(r.pay||'').trim(),inc=!pay;
    if(!pay){const fac=facilityByNameOrAlias(r.facility); if(fac){const p=facilityPayFor(fac,r.type,r.date); if(p>0){pay=String(p);inc=false}}}
    if(!pay)incomplete++;
    db.shifts.push({id:id(),date:r.date,facility:String(r.facility).trim(),type:r.type,pay,status:importStatusForDate(r.date),source:r.source||'schedule-import',incomplete:inc,updatedAt:new Date().toISOString(),note:'Schedule import: '+schedulePreview.fileName+(schedulePreview.matchedName?(' — matched name "'+schedulePreview.matchedName+'"'):'')});
    created++;
    if(r.facility&&!facilityByNameOrAlias(r.facility)&&!newNames.some(n=>normFacilityName(n)===normFacilityName(r.facility)))newNames.push(r.facility);
  }
  if(newNames.length)mergeFacilitySuggestions('schedule-import',newNames.map(n=>({name:n,count:(db.shifts||[]).filter(x=>normFacilityName(x.facility)===normFacilityName(n)).length,firstDate:'',lastDate:''})),schedulePreview.fileName);
  const fileName=schedulePreview.fileName;
  schedulePreview=null; db.settings=db.settings||{}; db.settings.scheduleImported=true; db.settings.scheduleImportFile=fileName; db.settings.scheduleImportedAt=new Date().toISOString();
  persist(); render();
  alert(`Added ${created} shift(s) from the schedule.${skipped?` Skipped ${skipped} duplicate(s).`:''}${incomplete?` ${incomplete} unpriced — set the pay rule on the Facilities tab.`:''}${newNames.length?` New facilit(ies) noticed — check the suggestion on the Dashboard before their shifts are priced.`:''} Past shifts arrive confirmed (they already happened); future shifts stay proposed until you confirm them.`);
}
// Photos of a schedule go to the same AI reader as contracts, in
// "schedule" mode: the server prompt returns only shifts for the
// schedule name, and the client still classifies every row before
// showing the preview — an AI row for someone else stays excluded.
async function callExtractSchedule(files,scheduleNm){
  if(!SUPABASE_CONFIGURED)throw new Error('Supabase is not configured yet.');
  if(!cloudSession)throw new Error('Not signed in — sign in on the Account tab first.');
  const images=await aiContractImagesDataURLs(files);
  if(!images.length)throw new Error('Could not read these photos in this browser — try JPG or PNG exports.');
  let data;
  try{data=await liveSyncPost('extract-contract',{action:'extract-contract',mode:'schedule',scheduleName:scheduleNm,images})}
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
    const date=String(sh.date||''); const facility=String(sh.facility||'').trim(); const type=String(sh.type||'Other');
    const rowName=String(sh.name||'').trim();
    const match=rowName?(scheduleNamesMatch(rowName,name)?'matched':(name?'other':'uncertain')):'uncertain';
    const duplicate=(db.shifts||[]).some(x=>x.date===date&&x.facility===facility&&x.type===type);
    const flags=[]; if(duplicate)flags.push('already in CRNA Hub — duplicate'); if(match==='other')flags.push('other person — excluded'); if(match==='uncertain')flags.push('uncertain — check to include'); if(facility&&!facilityByNameOrAlias(facility))flags.push('new facility — will be suggested, not created');
    return {date,facility,type,pay:String(sh.pay||''),name:rowName,matchedName:rowName,match,include:match==='matched'&&!duplicate,duplicate,flags,source:'schedule-import-ai',incomplete:!String(sh.pay||'').trim()};
  });
  schedulePreview={fileName,source:'schedule-import-ai',matchedName:name,rows,noNamesInFile:false,ai:true};
  return rows.length>0;
}
async function readScheduleWithAI(images){
  scheduleImportError='';
  scheduleAiStatus='Sending '+images.length+' photo(s) to AI for reading — this can take a few seconds…'; render();
  try{
    const fileName=images.map(f=>f.name).join(', ');
    const data=await callExtractSchedule(images.slice(0,4),scheduleName());
    const ok=applyAiToSchedulePreview(data,fileName);
    if(!ok){scheduleImportError='AI read the photos but found no shifts in them. Check the name as it appears on the schedule (above), or paste the schedule text instead. Nothing was saved.';scheduleAiStatus='';schedulePreview=null;render();return}
    scheduleAiStatus=''; scheduleImportError=''; render();
  }catch(e){const msg=String((e&&e.message)||e||''); scheduleAiStatus=''; schedulePreview=null; scheduleImportError=(msg===AI_KEY_MISSING_MESSAGE?AI_KEY_MISSING_MESSAGE:'AI reading failed: '+msg+' Nothing was saved — upload a CSV or text file instead (read on this device).'); render()}
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
//      password, and this path has no background sync: sessions expire,
//      so re-sign in and re-check for fresh shifts.
// NOT built here: the official QGenda REST API — it needs a per-hospital
// API account + Company Key from QGenda, a written agreement, and fees.
// That is a later per-hospital step. No other user's shifts are ever
// touched: the subscription URL belongs to one person, and the sign-in
// path only reads what the signed-in user shows the app.
let qgendaStatusLoaded=false,qgendaStatusError='';
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
  const connected=!!(db.settings&&db.settings.qgendaConnected);
  const masked=String((db.settings&&db.settings.qgendaMasked)||'');
  let inner='';
  if(connected){
    inner=`<p><strong>QGenda feed connected.</strong> <span class="muted">${escapeHTML(masked)}</span> — the full URL is stored encrypted on the server and is never shown here.</p><div class="toolbar"><button type="button" data-action="qgenda-fetch">Check feed now</button><button type="button" class="secondary" data-action="qgenda-disconnect">Disconnect QGenda feed</button></div><p class="muted">Paste your QGenda subscription URL and we’ll pull in just your shifts — preview first, nothing saved until you approve.</p>${qgendaStatusError?`<p class="hint">${escapeHTML(qgendaStatusError)}</p>`:''}`;
  } else {
    inner=`<p class="muted">In QGenda, open Sync and copy “Your Subscription URL”, then paste it here. The URL is a secret — stored encrypted on the server, never shown in full. No QGenda password is ever asked for or stored.</p><form id="qgendaForm"><div class="form-grid">${field('qgendaUrl','Your QGenda Subscription URL','password','','placeholder="https://app.qgenda.com/… — paste from the Sync button" autocomplete="off"')}</div><div class="form-actions"><button type="submit">Connect QGenda feed</button><button type="button" class="secondary" data-action="qgenda-open">Open QGenda to copy it</button></div></form>${qgendaStatusError?`<p class="hint">${escapeHTML(qgendaStatusError)}</p>`:''}<p class="muted">No subscription URL? <button type="button" class="secondary tiny" data-action="qgenda-check-it">I signed in to QGenda — use my schedule</button> Sign in yourself in the QGenda tab (the app never sees your password), then bring back a screenshot or a Reports export in the schedule upload below — it reads it and shows a preview before saving anything. That path has no background sync: your QGenda session expires, so re-sign in and re-check for fresh shifts. The official QGenda API (per-hospital account, agreement, fees) is a later step, not this one.</p>`;
  }
  return `<div id="qgenda-panel"><h2>QGenda</h2>${inner}</div>`;
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
  }catch(err){qgendaStatusError='Could not connect the QGenda feed: '+String((err&&err.data&&err.data.message)||(err&&err.message)||err)+' Nothing was saved.'; render()}
}
async function fetchQgendaFeed(){
  if(!SUPABASE_CONFIGURED||!cloudSession){qgendaStatusError='Sign in on the Account tab first.';render();return}
  try{
    qgendaStatusError='Checking your QGenda feed…'; render();
    const facilities=(db.facilities||[]).map(f=>({name:f.name,aliases:String(f.aliases||'').split(',').map(x=>x.trim()).filter(Boolean),hourlyRate:f.hourlyRate,rate8:f.rate8,rate10:f.rate10,rate12:f.rate12,rate24:f.rate24,rateSecond:f.rateSecond,weekendRateSecond:f.weekendRateSecond,callBonus:f.callBonus,paidHours8:f.paidHours8,hourlyCall1st:f.hourlyCall1st,weekendRate24:f.weekendRate24}));
    const data=await liveSyncPost('qgenda-feed',{action:'fetch',facilities});
    qgendaStatusError='';
    if(!data||!Array.isArray(data.shifts)||!data.shifts.length){schedulePreview=null; qgendaStatusError='The QGenda feed answered but listed no shifts. If you have no upcoming shifts in QGenda, that is correct — otherwise check the feed in QGenda.'; render(); return}
    const name=scheduleName();
    const rows=data.shifts.map(sh=>{
      const date=String(sh.date||''),facility=String(sh.facility||'').trim(),type=String(sh.type||'Other');
      const duplicate=(db.shifts||[]).some(x=>x.date===date&&x.facility===facility&&x.type===type);
      const flags=[]; if(duplicate)flags.push('already in CRNA Hub — duplicate'); if(!sh.facilityKnown)flags.push('new facility — will be suggested, not created');
      return {date,facility,type,pay:String(sh.pay||''),name:name,matchedName:name,match:'matched',include:!duplicate,duplicate,flags,source:'qgenda-feed',incomplete:!String(sh.pay||'').trim()};
    });
    schedulePreview={fileName:'QGenda feed',source:'qgenda-feed',matchedName:name,rows,noNamesInFile:false,ai:false};
    db.settings=db.settings||{}; db.settings.qgendaConnected=true; if(data.masked)db.settings.qgendaMasked=String(data.masked);
    persist(); render();
  }catch(err){qgendaStatusError='Could not check the QGenda feed: '+String((err&&err.data&&err.data.message)||(err&&err.message)||err); render()}
}
async function disconnectQgendaFeed(){
  if(!confirm('Disconnect the QGenda feed? The stored URL is deleted from the server. Shifts already imported stay.'))return;
  try{if(SUPABASE_CONFIGURED&&cloudSession){await liveSyncPost('qgenda-feed',{action:'disconnect'})}}catch(e){}
  db.settings=db.settings||{}; db.settings.qgendaConnected=false; db.settings.qgendaMasked=''; qgendaStatusError=''; persist(); render();
}
function qgendaStatusRefresh(){
  if(qgendaStatusLoaded||!SUPABASE_CONFIGURED||!cloudSession)return; qgendaStatusLoaded=true;
  liveSyncPost('qgenda-feed',{action:'status'}).then(data=>{
    db.settings=db.settings||{};
    if(data&&data.connected){db.settings.qgendaConnected=true; if(data.masked)db.settings.qgendaMasked=String(data.masked)}
    else{db.settings.qgendaConnected=false; db.settings.qgendaMasked=''}
    persist(); render();
  }).catch(()=>{});
}
function submitEntry(e){e.preventDefault();const kind=e.currentTarget.dataset.kind;if(kind==='documents'){submitDocument(e);return;}if(kind==='home-address'){submitHomeAddress(e);return;}if(kind==='portal-check'){submitPortalCheck(e);return;}if(kind==='portal-check-approve'){approvePortalCheck(e);return;}if(kind==='monitor-cadence'){const rec=Object.fromEntries(new FormData(e.currentTarget));const m=(db.portalMonitoring||[]).find(x=>x.key===rec.key);if(m){const v=parseInt(rec.cadenceDays,10);if(Number.isFinite(v)&&v>0)m.cadenceDays=v;persist();}render();return;}const record=Object.fromEntries(new FormData(e.currentTarget));if(kind==='nbcrna'||kind==='aana'){db[kind]={...(db[kind]||{}),...record,source:'user_entered'};persist();cloudSaveKind(kind);render();return;}if(kind==='licenses')record.source='user_entered';if(kind==='payStubs'){record.agency=String(record.agency||'').trim();record.facility=String(record.facility||'').trim();record.frequency=normalizePayFrequency(record.frequency);for(const d of ['periodStart','periodEnd','payDate'])record[d]=psValidISO(record[d]);for(const a of ['gross','net'])record[a]=rateOrNull(record[a])==null?'':String(rateOrNull(record[a]));if(!record.agency){alert('Enter the agency / employer name first.');return}if(!record.frequency||!record.payDate){alert('A pay schedule needs a pay frequency and a pay date — the calendar dates come from those.');return}if(!editId)record.source='manual';}if(kind==='shifts'&&!String(record.pay).trim()){const f=facilityByNameOrAlias(record.facility);const p=f?facilityPayFor(f,record.type,record.date):0;if(p>0){record.pay=String(Math.round(p*100)/100);record.incomplete=false}else{record.pay='';record.incomplete=true}}if(kind==='shifts'&&String(record.pay).trim())record.incomplete=false;if(kind==='shifts')record.status=normalizeShiftStatus(record.status);// Newest edit wins on the calendar side needs a timestamp: stamp every
// app-side shift save (add or edit) so the sync engine can tell a newer
// local edit from the provider copy and push the update to the app-owned
// calendar. Before this the stamp was never set (updatedAt stayed null)
// and the server's local-newer check never fired, so an edited shift
// never left the app.
if(kind==='shifts')record.updatedAt=new Date().toISOString();if(kind==='facilities'){record.ratesSource='manual';record.ratesSourceFile='';record.ratesSourceDate='';for(const k of RATE_FIELDS)record[k]=rateOrNull(record[k])==null?'':String(rateOrNull(record[k]));if(rateOrNull(record.paidHours8)==null)record.paidHours8='';if(rateOrNull(record.distance)==null){record.distance='';record.distanceSource=''}else if(record.distanceSource!=='auto')record.distanceSource='manual';if(!String(record.address||'').trim()){record.lat='';record.lng='';record.geocodedAddress=''}else if(editId){const old=(db.facilities||[]).find(x=>x.id===editId);if(old&&String(old.address||'').trim()!==String(record.address||'').trim()){record.lat='';record.lng='';record.geocodedAddress='';if(record.distanceSource==='auto'){record.distance='';record.distanceSource=''}}}}if(kind==='mileage'){if(!record.milesSource)record.milesSource=String(record.miles||'').trim()?'manual':'';record.tripType=record.tripType==='one-way'?'one-way':'round-trip';const oldTrip=editId?(db.mileage||[]).find(m=>m.id===editId):null;if(oldTrip&&record.tripType!==oldTrip.tripType&&Number(oldTrip.oneWayMiles)>0&&oldTrip.milesSource==='auto'){record.miles=String(tripMilesFor(oldTrip.oneWayMiles,record.tripType));record.oneWayMiles=String(oldTrip.oneWayMiles)}else if(Number(record.oneWayMiles)>0&&record.milesSource==='auto'){record.miles=String(tripMilesFor(record.oneWayMiles,record.tripType))}else{record.oneWayMiles=oneWayFromTripMiles(record.miles,record.tripType)}record.origin=record.origin==='hotel'?'hotel':record.origin==='other'?'other':'home';if(record.origin==='home')record.hotelAddress='';if(record.origin==='hotel'&&String(record.hotelAddress||'').trim())db.settings.lastHotelAddress=String(record.hotelAddress).trim()}if(kind==='hotelStays'&&String(record.hotelAddress||'').trim())db.settings.lastHotelAddress=String(record.hotelAddress).trim();if(kind==='facilities'&&!editId){const existing=(db.facilities||[]).find(x=>String(x.name||'').trim().toLowerCase()===String(record.name||'').trim().toLowerCase()||(String(record.aliases||'').trim()&&facilityAliases(x).some(a=>String(record.aliases||'').split(',').map(y=>y.trim().toLowerCase()).includes(a.toLowerCase()))));if(existing)editId=existing.id}if(kind==='facilities'&&!String(record.name||'').trim()){alert('Enter the hospital / facility name first.');return}let savedId=editId;if(editId){const i=db[kind].findIndex(x=>x.id===editId);if(i>=0)db[kind][i]={...db[kind][i],...record};else{const rec={...record,id:id(),...(kind==='shifts'?{source:'user-entered'}:{})};db[kind].push(rec);savedId=rec.id}}else{const rec={...record,id:id(),...(kind==='shifts'?{source:'user-entered'}:{})};db[kind].push(rec);savedId=rec.id}editId=null;if(kind==='shifts')showShiftForm=false;persist();let repriced=0;if(kind==='facilities'){const saved=(db.facilities||[]).find(x=>x.id===savedId);repriced=repriceUnpricedShiftsForFacility(saved);if(repriced>0)persist();}if(kind==='shifts'&&typeof window!=='undefined'&&typeof window.liveSyncMarkShiftNotSynced==='function')window.liveSyncMarkShiftNotSynced(savedId);
if(kind==='shifts'&&typeof window!=='undefined'&&typeof window.liveSyncSchedulePush==='function')window.liveSyncSchedulePush();if(kind==='facilities'&&typeof window!=='undefined'&&typeof window.liveSyncSchedulePush==='function')window.liveSyncSchedulePush();if(['licenses','nbcrnaCE','aanaCE'].includes(kind))cloudSaveKind(kind,savedId);if(kind==='facilities'){const saved=(db.facilities||[]).find(x=>x.id===savedId);if(saved){const hadSuggestion=clearFacilitySuggestion(saved.name);if(facilitySuggestionPrefill&&normFacilityName(facilitySuggestionPrefill.name)===normFacilityName(saved.name))facilitySuggestionPrefill=null;
  // Bug 2: a suggestion cleared by adding the facility means held
  // shifts exist for it. If the last import also skipped shifts as
  // legacy (paired by an earlier interrupted sync, migration 005 not
  // run), arm the one-shot repair so the next sync — which the
  // facility save already schedules — re-imports them instead of
  // leaving them blocked. Deleted shifts stay deleted: the server
  // only clears rows that are not flagged deleted and not tombstoned.
  if(hadSuggestion&&typeof liveSyncState!=='undefined'&&liveSyncState&&liveSyncState.lastImport&&Number(liveSyncState.lastImport.skippedLegacy||0)>0){liveSyncState.repairImport=true;if(typeof liveSyncStateSave==='function')liveSyncStateSave();}}}if(repriced>0)alert(`${repriced} unpriced shift(s) priced from the ${((db.facilities||[]).find(x=>x.id===savedId)||{}).name||'facility'} pay rule. The next calendar sync also re-scans past events for this facility.`);render()}
// Change one shift's status (Saved shifts list). Re-prices the C/S/P
// totals immediately on the next render; a shift change is also queued
// for live calendar sync, like any other shift edit.
function setShiftStatus(shiftId,status){const x=(db.shifts||[]).find(s=>s.id===shiftId);if(!x)return;const v=normalizeShiftStatus(status);if(x.status===v)return;x.status=v;persist();if(typeof window!=='undefined'&&typeof window.liveSyncSchedulePush==='function')window.liveSyncSchedulePush();render();}
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
function actions(action,entry,date){if(action.startsWith('live-')){if(typeof liveSyncAction==='function')return liveSyncAction(action,entry);}if(action==='onboard-dismiss'){onboardStep=0;db.settings.onboardingDismissed=true;persist();return render();}if(action==='onboard-goto'){setTab(entry);const st=onboardingSteps().find(x=>x.tab===entry&&(x.panel||'')===(date||''));onboardStep=st?st.n:0;render();if(date){const el=document.getElementById(date);if(el)el.scrollIntoView({block:'start'});}return;}if(action==='prev')return moveMonth(-1);if(action==='next')return moveMonth(1);if(action==='today'){month=new Date();month.setDate(1);selected=localDate(new Date());return render()}if(action==='day')return selectDay(date);if(action==='add-shift'){tab='Dashboard';editId=null;showShiftForm=true;render();window.scrollTo(0,0);return;}if(action==='ask-assistant')return setTab('Assistant');if(action==='connect-portal'){const key=({NBCRNA:'nbcrna',AANA:'aana','State Licenses':'licenses'})[entry]||entry;return portalOpenSignIn(key);}if(action==='monitor-run')return monitorRunCheck(entry);
if(action==='monitor-toggle'){const m=(db.portalMonitoring||[]).find(x=>x.key===entry);if(m){m.enabled=!m.enabled;persist();}return render();}
if(action==='monitor-ack'){const m=(db.portalMonitoring||[]).find(x=>x.key===entry);if(m){m.changeFlag=false;persist();}return render();}
if(action==='monitor-assistant'){const m=(db.portalMonitoring||[]).find(x=>x.key===entry);if(m)return monitorAssistantCheck(m);return;}
if(action==='assistant-portal-check'){const src=({NBCRNA:'nbcrna',AANA:'aana','State Licenses':'licenses'})[entry]||entry;return startPortalCheck(src);}if(action==='portal-check-cancel'){portalCheck=null;portalCheckError='';portalCheckOcrStatus='';return render();}if(action==='ask'){return askAssistantLive(entry)}if(action==='clear-chat'){db.assistantChat=[];persist();return render()}if(action==='cancel'){editId=null;showShiftForm=false;facilitySuggestionPrefill=null;return render()}if(action==='mileage-autocalc')return calcMileageForForm();if(action==='facility-distance')return calcFacilityDistance();if(action==='edit-paystub'){editId=entry;tab='Facilities';paystubPreview=null;paystubError='';paystubStatus='';render();const el=document.getElementById('paystub-panel');if(el&&el.scrollIntoView)el.scrollIntoView({block:'start'});return;}
if(action==='delete-paystub'){if(!confirm("Delete this agency's pay schedule? Only this agency's estimated paychecks are removed — other agencies are untouched."))return;db.payStubs=(db.payStubs||[]).filter(x=>x.id!==entry);persist();return render()}
if(action.startsWith('edit-')){facilitySuggestionPrefill=null;const kind=action.slice(5);tab=({shifts:'Dashboard',facilities:'Facilities',pto:'PTO',credentials:'Credentials',mileage:'Mileage',hotelStays:'Mileage',licenses:'Credentials',nbcrnaCE:'Credentials',aanaCE:'Credentials',documents:'Credentials'})[kind];if(['nbcrna','aana','licenses','credentials','nbcrnaCE','aanaCE'].includes(kind))manualType=({nbcrna:'NBCRNA',aana:'AANA',licenses:'State license',credentials:'Other credential',nbcrnaCE:'NBCRNA CE',aanaCE:'AANA CE'})[kind];editId=entry;if(kind==='shifts')showShiftForm=true;render();window.scrollTo(0,0);return}if(action.startsWith('delete-')){const kind=action.slice(7);if(!confirm(kind==='shifts'?'Delete this shift? It is removed from CRNA Hub right away. A shift imported from your calendar is not deleted from that calendar.':'Delete this record?'))return;if(kind==='shifts'){const gone=(db.shifts||[]).find(x=>x.id===entry);if(typeof window!=='undefined'&&typeof window.liveSyncRecordTombstone==='function')window.liveSyncRecordTombstone(entry);if(gone&&Array.isArray(db.mileage))db.mileage=db.mileage.filter(m=>!(m.status==='draft'&&mileageTripMatchesShift(m,gone)));}db[kind]=db[kind].filter(x=>x.id!==entry);persist();if(['licenses','nbcrnaCE','aanaCE'].includes(kind))cloudDeleteKind(kind,entry);if(kind==='documents')cloudDeleteDocument(entry);return render()}if(action==='download-doc'){downloadDocument(entry);return;}if(action==='save-pto-settings'){db.settings.ptoStarting=num($('f_starting').value);db.settings.ptoAnnual=num($('f_annual').value);db.settings.ptoHoursPerPeriod=num($('f_perperiod').value);persist();return render()}if(action==='post-accrual'){const h=num(db.settings.ptoHoursPerPeriod);if(h<=0)return alert('Set the pay-period accrual first.');db.pto.push({id:id(),date:localDate(new Date()),hours:String(h),note:'Pay-period accrual'});persist();return render()}if(action==='mileage-drafts')return makeMileageDrafts();if(action==='mileage-review-goto'){mileageReviewWeek=entry||'';tab='Mileage';editId=null;render();window.scrollTo(0,0);return}if(action==='mileage-review-prev')return mileageReviewStep(1);if(action==='mileage-review-next')return mileageReviewStep(-1);if(action==='mileage-review-generate')return generateWeeklyMileageDrafts(selectedMileageReviewWeek());if(action==='mileage-review-confirm')return confirmWeeklyMileage(selectedMileageReviewWeek());if(action==='mileage-review-save'){applyMileageReviewEdits(selectedMileageReviewWeek());persist();return render()}if(action==='mileage-review-skip'){const m=(db.mileage||[]).find(x=>x.id===entry);if(m){m.status='skipped';persist()}return render()}if(action==='mileage-review-restore'){const m=(db.mileage||[]).find(x=>x.id===entry);if(m){m.status='draft';persist()}return render()}if(action==='cloud-signup'){const em=$('f_email'),pw=$('f_password'),sn=$('f_scheduleName'),et=$('f_employmentType'),gl=$('f_incomeGoalStep1');if(!em||!pw||!em.value.trim()||!pw.value)return alert('Enter an email and password first.');cloudSignUp(em.value.trim(),pw.value,sn?String(sn.value||'').trim():'',et?String(et.value||'').trim():'',gl&&String(gl.value||'').trim()!==''?num(gl.value):undefined);return}
if(action==='skip-income-goal'){const gl=$('f_incomeGoalStep1');if(gl)gl.value='';cloudAuthStatus='No income goal set — you can set it later on the Account tab (Profile — step 1).';return render()}
if(action==='save-profile'){const nm=$('f_profileName'),et=$('f_profileEmploymentType'),gl=$('f_profileIncomeGoal');applyProfileValues({name:nm?String(nm.value||'').trim():'',employmentType:et?String(et.value||'').trim():'',monthlyIncomeGoal:gl&&String(gl.value||'').trim()!==''?num(gl.value):0});cloudSaveProfile();return render()}
if(action==='cloud-upload'){if(!confirm('Upload on-device credential records to your cloud account? This overwrites the credential records currently stored in your cloud account (NBCRNA, AANA, licenses, CE records) with the ones on this device. Shifts, facilities, mileage, and PTO are not uploaded.'))return;cloudUploadLocal();return}
if(action==='cloud-load'){if(!confirm('Load cloud credential records onto this device? This replaces the NBCRNA, AANA, license, and CE records on this device with the ones in your cloud account. Shifts, facilities, mileage, and PTO are untouched.'))return;cloudLoadIntoLocal();return}
if(action==='cloud-sync'){if(!confirm('Sync now downloads your cloud credential records onto this device, replacing the NBCRNA, AANA, license, and CE records here. Continue?'))return;cloudLoadIntoLocal();return}
if(action==='cloud-signout'){cloudSignOut();return}
if(action==='cloud-keep-local'){cloudPending=null;render();return}
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
if(action==='paystub-read-text')return importPaystubText();

if(action==='facility-contract-ocr')return importFacilityContractWithOCR();
if(action==='contract-ai')return readContractWithAI('contract');
if(action==='contract-ocr')return importContractWithOCR();
if(action==='facility-page-crop-reread')return rereadFacilityPageCropped(+entry);
if(action==='contract-page-crop-reread')return rereadContractPageCropped(+entry);
if(action==='check-app-update')return checkAppUpdate();
if(action==='facility-page-remove'||action==='facility-page-up'||action==='facility-page-down'){const i=+entry;if(Number.isNaN(i)||i<0||i>=facilityContractPendingImages.length)return render();const mv=action.endsWith('-up')?-1:action.endsWith('-down')?1:0;if(mv){const j=i+mv;if(j<0||j>=facilityContractPendingImages.length)return render();[facilityContractPendingImages[i],facilityContractPendingImages[j]]=[facilityContractPendingImages[j],facilityContractPendingImages[i]]}else facilityContractPendingImages.splice(i,1);facilityContractOcrPages=orderedOcrPages(facilityContractOcrPages,facilityContractPendingImages);if(facilityContractOcrPages.length){if(!reparseFacilityContractOcrPages()){facilityContractError='The remaining pages contain no facility name or rate. Nothing was saved.';facilityContractPreview=null}}else{facilityContractPreview=null;facilityContractError=''}return render()}

if(action==='contract-page-remove'||action==='contract-page-up'||action==='contract-page-down'){const i=+entry;if(Number.isNaN(i)||i<0||i>=contractPendingImages.length)return render();const mv=action.endsWith('-up')?-1:action.endsWith('-down')?1:0;if(mv){const j=i+mv;if(j<0||j>=contractPendingImages.length)return render();[contractPendingImages[i],contractPendingImages[j]]=[contractPendingImages[j],contractPendingImages[i]]}else contractPendingImages.splice(i,1);contractOcrPages=orderedOcrPages(contractOcrPages,contractPendingImages);if(contractOcrPages.length){if(!reparseContractOcrPages()){contractImportError='The remaining pages contain no shifts by deterministic parsing. Nothing was saved.';contractPreview=null}}else{contractPreview=null;contractImportError=''}return render()}
if(action==='view-contract-image')return viewContractImage(entry);
if(action==='view-contract-image-page')return viewContractImage(entry,+date);
if(action==='backup')return download('crna-hub-backup.json',JSON.stringify({...db,_backupMeta:{mode:cloudMode(),account:cloudSession?cloudSession.email:null,exportedAt:new Date().toISOString(),note:'Cloud vs on-device mode at export time. Restore loads records onto this device only; it never overwrites the cloud account.'}},null,2),'application/json');if(action==='confirm-past-shifts')return confirmPastProposedShifts(entry);if(action==='cal-approve')return approveCalendarImport();if(action==='cal-discard'){calPreview=null;return render()}if(action==='schedule-approve')return approveScheduleImport();if(action==='schedule-discard'){schedulePreview=null;return render()}if(action==='save-schedule-name'){const el=$('f_scheduleNameUpload');if(el){db.settings=db.settings||{};db.settings.scheduleName=String(el.value||'').trim();persist()}return render()}if(action==='qgenda-fetch')return fetchQgendaFeed();if(action==='qgenda-disconnect')return disconnectQgendaFeed();if(action==='qgenda-open'){try{window.open('https://app.qgenda.com','_blank','noopener')}catch(e){}return}if(action==='qgenda-check-it'){scheduleImportContext='qgenda';render();const el=document.getElementById('schedule-import-panel');if(el&&el.scrollIntoView)el.scrollIntoView({block:'start'});return}if(action==='export-cal-all')return exportCalendarICS(db.shifts.slice().sort((a,b)=>a.date.localeCompare(b.date)),'crna-hub-shifts.ics');if(action==='export-cal-month'){const prefix=localDate(new Date()).slice(0,7);return exportCalendarICS(db.shifts.filter(x=>x.date.startsWith(prefix)).sort((a,b)=>a.date.localeCompare(b.date)),'crna-hub-shifts-'+prefix+'.ics')}if(action==='connect-calendar'){setTab('Account');return}if(action==='export-shifts')return exportCsv('crna-hub-shifts.csv',['date','facility','type','pay','status','note'],db.shifts);if(action==='export-mileage')return exportCsv('crna-hub-mileage.csv',['date','facility','purpose','miles','tripType','oneWayMiles','milesSource','origin','hotelAddress','status'],verifiedMileageTrips())}
async function makeMileageDrafts(){let count=0,auto=0,hotel=0,skipped=0;for(const x of db.shifts){if(/off|pto/i.test(x.type))continue;const f=(db.facilities||[]).find(f=>String(f.name||'').trim().toLowerCase()===String(x.facility||'').trim().toLowerCase());if(!f)continue;if(db.mileage.some(m=>mileageTripMatchesShift(m,x)))continue;const stay=hotelStayFor(x.date,x.facility);let oneWay=null,source='',origin='home',hotelAddress='';if(stay){const res=await homeToFacilityMiles(f,stay.hotelAddress);if(res){oneWay=res.oneWay;source='auto';origin='hotel';hotelAddress=stay.hotelAddress}}else{const autoRes=await homeToFacilityMiles(f);if(autoRes){oneWay=autoRes.oneWay;source='auto'}else{oneWay=effectiveOneWayMiles(f);source='manual'}}const draft=mileageDraftForShift(x,f,oneWay,source,origin,hotelAddress,mileageTripType());if(!draft){skipped++;continue}db.mileage.push(draft);count++;if(source==='auto')auto++;if(origin==='hotel')hotel++}persist();render();alert(`${count} mileage draft(s) created (${tripTypeLabel(mileageTripType())})${auto?` — ${auto} auto-calculated${hotel?`, ${hotel} from a hotel stay`:''}`:''}.${skipped?` ${skipped} shift(s) skipped — no usable address or manual distance on file, so no miles were guessed.`:''} Review every trip and tax eligibility before using them.`)}
function csvEscape(v){const s=String(v??'');return /[",\n\r]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s}
function exportCsv(filename,headers,rows){download(filename,[headers.join(','),...rows.map(r=>headers.map(h=>csvEscape(r[h])).join(','))].join('\r\n'),'text/csv;charset=utf-8')}
function download(filename,contents,mime){const a=document.createElement('a'),url=URL.createObjectURL(new Blob([contents],{type:mime}));a.href=url;a.download=filename;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),3000)}
function parseCSV(str){const rows=[],row=[];let cell='',quote=false;for(let i=0;i<str.length;i++){const c=str[i];if(c==='"'){if(quote&&str[i+1]==='"'){cell+='"';i++}else quote=!quote}else if(c===','&&!quote){row.push(cell);cell=''}else if((c==='\n'||c==='\r')&&!quote){if(c==='\r'&&str[i+1]==='\n')i++;row.push(cell);if(row.some(x=>x.trim()))rows.push(row.slice());row.length=0;cell=''}else cell+=c}row.push(cell);if(row.some(x=>x.trim()))rows.push(row);return rows}
async function importCsv(e){e.preventDefault();const f=$('f_importFile').files[0],input=f?await f.text():$('f_importText').value,rows=parseCSV(input.replace(/^\uFEFF/,''));let count=0,skipped=0;for(let i=0;i<rows.length;i++){const r=rows[i].map(x=>x.trim());if(i===0&&/date/i.test(r[0])&&!/^\d{4}-\d{2}-\d{2}$/.test(r[0]))continue;if(!/^\d{4}-\d{2}-\d{2}$/.test(r[0])||Number.isNaN(Date.parse(r[0]+'T12:00:00'))||!r[1]){skipped++;continue}const facility=r[1],type=r[2]||'Other',f=db.facilities.find(x=>x.name.toLowerCase()===facility.toLowerCase());let pay='',incomplete=true;if(r[3]!==undefined&&r[3]!==''){pay=String(num(r[3]));incomplete=false}else if(f){const p=facilityPayFor(f,type,r[0]);if(p>0){pay=String(p);incomplete=false}}if(db.shifts.some(x=>x.date===r[0]&&x.facility===facility&&x.type===type)){skipped++;continue}db.shifts.push({id:id(),date:r[0],facility,type,pay,incomplete,status:importStatusForDate(r[0]),note:'CSV import',source:'csv-import'});count++}persist();render();alert(`Imported ${count} shift(s); skipped ${skipped} invalid or duplicate row(s).`)}
async function restoreBackup(e){const file=e.target.files[0];if(!file)return;try{const data=JSON.parse(await file.text());for(const key of ['shifts','facilities','pto','credentials','mileage'])if(!Array.isArray(data[key]))throw Error('Missing or invalid '+key);if(!confirm('Replace all current records with this backup?'))return;const next=empty();for(const k of ['shifts','facilities','pto','credentials','mileage'])next[k]=data[k];if(data.settings&&typeof data.settings==='object')next.settings={...next.settings,...data.settings};if(data.nbcrna&&typeof data.nbcrna==='object')next.nbcrna=data.nbcrna;if(data.aana&&typeof data.aana==='object')next.aana=data.aana;if(Array.isArray(data.nbcrnaCE))next.nbcrnaCE=data.nbcrnaCE;if(Array.isArray(data.aanaCE))next.aanaCE=data.aanaCE;if(Array.isArray(data.licenses))next.licenses=data.licenses;if(Array.isArray(data.documents))next.documents=data.documents;if(Array.isArray(data.assistantChat))next.assistantChat=data.assistantChat;if(Array.isArray(data.portalChecks))next.portalChecks=data.portalChecks;if(Array.isArray(data.portalMonitoring))next.portalMonitoring=data.portalMonitoring;if(Array.isArray(data.contracts))next.contracts=data.contracts;if(Array.isArray(data.payStubs))next.payStubs=data.payStubs;if(Array.isArray(data.hotelStays))next.hotelStays=data.hotelStays;normalizeStoredRates(next);db=next;persist();render();alert(cloudActive&&cloudSession?'Backup restored onto this device only. It did NOT overwrite your cloud account. To push these records to the cloud, use "Upload my on-device records" on the Account tab.':'Backup restored.')}catch(err){alert('Could not restore backup: '+err.message)}}

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
// Build stamp, shown on the Facilities contract panel so a stale
// service-worker cache is visible at a glance: date + what changed +
// the service-worker cache version in sw.js. Bump all three together on
// every preview build — a static file cannot know its own commit hash,
// so the hash lives in the deploy report, not here.
// Import & Backup tab removed Nov 5, 2026 — its pieces moved to the Account tab (sync, backup) and Facilities (contract import).
const BUILD_STAMP='2026-11-06 · cache v38';
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
 return (contractPreview.isPhoto?ocrDiagnosticsHTML(contractOcrPages,contractPendingImages,contractPreview.ocrText||''):'')+unreadableRatesWarningHTML(contractPreview.unreadableRates||[])+(contractPreview.aiNote?`<p class="hint">${escapeHTML(contractPreview.aiNote)}</p>`:'')+`<p><strong>Parsed from:</strong> ${escapeHTML(contractPreview.fileName||'pasted text')} · <strong>Method:</strong> ${contractPreview.aiRead?'AI vision (gpt-4o-mini) — you tapped “Read with AI”, so the photos you selected were sent to OpenAI for reading. Every row below is flagged “from photo — check carefully”: a vision read can misread digits and dates.':contractPreview.isPhoto?'On-device OCR (Tesseract.js) — no picture was sent to a server, and no AI model read this document. Every row below is flagged “from photo — check carefully”: OCR can misread digits and dates.':'deterministic text parsing — no AI model read this document.'}</p>
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
 <p class="hint">Unpriced rows (pay left blank) are saved as incomplete, never as $0. Approved shifts are stored on this device only, in the same shift store as CSV imports, with status “confirmed” for past dates and “proposed” for future ones, and source “extracted-from-contract” (or “extracted-from-contract-photo” for picture imports).</p>`}
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
  const AI_KEY_MISSING_MESSAGE='AI reading isn\'t set up yet — add the OpenAI key in Supabase (Edge Functions → Manage secrets → OPENAI_API_KEY)';
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
  async function readContractWithAI(kind){if(aiContractBusy)return;const isFac=kind==='facility';const inputId=isFac?'f_facilityContractFile':'f_contractFile';const files=Array.from((($(inputId)||{}).files)||[]);const images=files.filter(isImageFile);const setStatus=m=>{if(isFac){facilityContractOcrStatus=m}else{contractOcrStatus=m}render()};const setError=m=>{if(isFac){facilityContractPendingImages=[];facilityContractOcrPages=[];facilityContractError=m;facilityContractOcrStatus=''}else{contractPendingImages=[];contractOcrPages=[];contractImportError=m;contractOcrStatus=''}render()};if(!images.length){setError('Choose contract photos first, then tap “Read with AI”. Nothing was sent.');return}if(!SUPABASE_CONFIGURED){setError('Sign-in is not configured yet — paste the publishable key into supabase-config.js (see the Account tab), then sign in and try again. Nothing was sent.');return}if(!cloudSession){setError('Sign in on the Account tab first — AI reading runs for your signed-in account. Nothing was sent.');return}aiContractBusy=true;const fileName=images.map(f=>f.name).join(', ');try{if(isFac){facilityContractPendingImages=images}else{contractPendingImages=images}setStatus('Sending '+images.length+' photo(s) to AI for reading — this can take a few seconds…');const data=await callExtractContract(images.slice(0,4));let ok=false;if(isFac){ok=applyAiToFacilityPreview(data,fileName);if(!ok){setError('AI read the photos but found no facility name or rate in them. Try the on-device reading button below, or enter the rates manually. Nothing was saved.');return}}else{ok=applyAiToContractPreview(data,fileName);if(!ok){setError('AI read the photos but found no shifts in them (no date + shift pattern). Try the on-device reading button below, or paste the contract text instead. Nothing was saved.');return}}if(isFac){facilityContractOcrStatus='';facilityContractError=''}else{contractOcrStatus='';contractImportError=''}render()}catch(e){const msg=String((e&&e.message)||e||'');if(msg===AI_KEY_MISSING_MESSAGE||(e&&e.data&&e.data.error==='openai_key_missing'))setError(AI_KEY_MISSING_MESSAGE);else setError('AI reading failed: '+msg+' Nothing was saved — use “No connection? Try on-device reading” below for the on-device fallback.')}finally{aiContractBusy=false}}

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
  paystubPreview=paystubPreviewFromParsed(parsed,fileName,'AI vision (gpt-4o-mini) — you tapped “Read with AI”, so the photos you selected were sent to OpenAI for reading. Every field below is flagged “from photo — check carefully” because a vision read can misread digits and dates.',true);
  return true;
}
async function readPaystubWithAI(){
  if(paystubBusy)return;
  const files=Array.from((($('f_paystubFile')||{}).files)||[]);
  const images=files.filter(isImageFile);
  if(!images.length){paystubError='Choose pay stub photos first, then tap “Read with AI”. Nothing was sent.';render();return}
  if(!SUPABASE_CONFIGURED){paystubError='Sign-in is not configured yet — paste the publishable key into supabase-config.js (see the Account tab), then sign in and try again. Nothing was sent.';render();return}
  if(!cloudSession){paystubError='Sign in on the Account tab first — AI reading runs for your signed-in account. Nothing was sent.';render();return}
  paystubBusy=true;const fileName=images.map(f=>f.name).join(', ');
  try{
    paystubStatus='Sending '+images.length+' photo(s) to AI for reading — this can take a few seconds…';paystubError='';paystubPreview=null;render();
    const data=await callExtractPaystub(images.slice(0,4));
    const ok=applyAiToPaystubPreview(data,fileName);
    if(!ok){paystubError='AI read the photos but found no employer, pay date, or pay amount in them. Try a clearer photo, paste the stub text, or enter the schedule manually below. Nothing was saved.';paystubPreview=null;paystubStatus='';render();return}
    paystubStatus='';paystubError='';render();
  }catch(e){
    const msg=String((e&&e.message)||e||'');
    if(msg===AI_KEY_MISSING_MESSAGE||(e&&e.data&&e.data.error==='openai_key_missing'))paystubError=AI_KEY_MISSING_MESSAGE;
    else paystubError='AI reading failed: '+msg+' Nothing was saved — use “Read pasted text / PDF instead” below.';
    paystubStatus='';paystubPreview=null;render();
  }finally{paystubBusy=false}
}
async function importPaystub(e){
  e.preventDefault();paystubError='';paystubStatus='';paystubPreview=null;
  const files=$('f_paystubFile')?Array.from($('f_paystubFile').files||[]):[];
  const imageFiles=files.filter(isImageFile);
  if(imageFiles.length){
    // AI FIRST (recommended): photos go to vision AI. The text button
    // below is the explicit fallback — never a silent default. If AI
    // cannot run (not signed in / not configured), say so plainly and
    // stop: do NOT fall back silently.
    if(!SUPABASE_CONFIGURED||!cloudSession){paystubError='AI reading (recommended) needs you signed in on the Account tab — sign in and submit again, or use “Read pasted text / PDF instead” below. Nothing was sent, nothing was saved.';render();return}
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
async function importPaystubText(){
  paystubError='';paystubStatus='';paystubPreview=null;
  const files=$('f_paystubFile')?Array.from($('f_paystubFile').files||[]):[];
  const imageFiles=files.filter(isImageFile);
  if(imageFiles.length&&!files.some(f=>/\.pdf$/i.test(f.name||'')||/text\//.test(f.type||''))){paystubError='This button reads text, not photos — upload a photo and use “Read with AI”, or paste the stub text below. Nothing was saved.';render();return}
  try{
    let text='',fileName='pasted text';const f=files.find(x=>/\.pdf$/i.test(x.name||'')||/text\//.test(x.type||'')||/\.txt$/i.test(x.name||''))||null;
    if(f){fileName=f.name;if(/\.pdf$/i.test(f.name)||f.type==='application/pdf')text=await extractPdfText(f);else text=await f.text()}
    else text=$('f_paystubText')?$('f_paystubText').value:'';
    if(!text.trim()){paystubError='Nothing to read: paste the pay stub text, or choose a text / PDF file first. Nothing was saved.';render();return}
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
  if(!gross&&!net){alert('Enter a gross or net amount per check — otherwise the calendar estimates have no amount to show.');return}
  const rec={id:p.id||id(),agency,facility:String(p.facility||'').trim(),frequency,periodStart:psValidISO(p.periodStart),periodEnd:psValidISO(p.periodEnd),payDate,gross,net,source:p.source||(p.aiRead?'ai-vision':'text-parse'),fileName:p.fileName||'',updatedAt:new Date().toISOString()};
  // One schedule per agency: a new stub for an agency already on file
  // replaces that agency's schedule only — every other agency is
  // untouched. An edit of the same record keeps its id.
  const ex=paystubForAgency(agency);
  if(ex&&ex.id!==rec.id)db.payStubs=(db.payStubs||[]).filter(x=>x.id!==ex.id);
  const i=(db.payStubs||[]).findIndex(x=>x.id===rec.id);
  if(i>=0)db.payStubs[i]={...db.payStubs[i],...rec};
  else db.payStubs.push(rec);
  const next=paystubNextPayDate(rec);
  paystubPreview=null;paystubError='';paystubStatus='';editId=null;persist();render();
  alert(`Pay schedule saved for ${agency} — ${PAY_FREQUENCY_LABELS[frequency]}, estimated ${net?currency(num(net))+' net':currency(num(gross))+' gross'} per check${next?`, next expected payday ${fmt(next)}`:''}. Estimated paychecks for ${agency} now show on the Dashboard calendar, labelled as estimates.`);
}

function ocrDiagnosticsHTML(pages,files,text){const ordered=files?orderedOcrPages(pages,files):(pages||[]);if(!ordered.length)return '';const total=String(text||'').replace(/--- Page \d+: [^\n]* ---/g,'').trim().length;let out='<div class="item"><strong>What the app read from your photos</strong><ul>';ordered.forEach((pg,i)=>{const st=ocrPageStatus(pg);const chars=String(pg.text||'').trim().length;out+='<li>Page '+(i+1)+' ('+escapeHTML(pg.name||'photo')+'): '+(st==='ok'?chars+' characters read'+(pg.ocrPass&&pg.ocrPass!=='default'?(' (re-read with '+escapeHTML(pg.ocrPass)+')'):'' ):st==='failed'?('could not be read'+(pg.error?(' — '+escapeHTML(pg.error)):'')):'0 characters — no readable text, try a clearer, well-lit photo of this page, or re-take it')+(pg.cropText?(' · cropped re-read ('+escapeHTML(pg.cropRegionLabel||'cropped')+'): '+String(pg.cropText).trim().length+' characters read'+(pg.cropPass?(' ('+escapeHTML(pg.cropPass)+')'):'') ):'')+'</li>'});out+='</ul>';if(total<200)out+='<p class="hint">Very little text was read from these photos ('+total+' characters). Rates in a table or faint print often need a clearer, closer, well-lit photo with the page flat and upright. Nothing was invented — fields the app could not read are left blank for you to fill in.</p>';out+='<details><summary>View the text the app read</summary><pre style="white-space:pre-wrap">'+escapeHTML(String(text||'(no text read)'))+'</pre></details></div>';return out}
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
   contractPendingImages=imageFiles;contractOcrStatus='Reading picture 1 of '+imageFiles.length+' on this device with OCR (Tesseract.js) — no picture is sent to a server for OCR. This can take a few seconds per page…';contractImportError='';contractPreview=null;render();
   try{
     for(let i=0;i<imageFiles.length;i++){const img=imageFiles[i];contractOcrStatus='Reading picture '+(i+1)+' of '+imageFiles.length+' ('+img.name+') on this device with OCR…';const el0=document.getElementById('contractOcrStatus');if(el0)el0.textContent=contractOcrStatus;
       let t='',ocrPass='default';try{const best=await ocrBestPassForFile(img,m=>{const el=document.getElementById('contractOcrStatus');if(el&&m&&m.status)el.textContent=`Reading picture ${i+1} of ${imageFiles.length} (${img.name}) on this device with OCR… ${m.status}${m.progress!=null?' '+Math.round(m.progress*100)+'%':''}`});t=best.text;ocrPass=best.pass;contractOcrPages.push({file:img,name:img.name,text:t,status:t.trim().length?'ok':'empty',ocrPass})}catch(pageErr){contractOcrPages.push({file:img,name:img.name,text:'',status:'failed',error:String(pageErr&&pageErr.message||pageErr)})}}
     contractOcrStatus='';contractOcrPages=orderedOcrPages(contractOcrPages,contractPendingImages);
     const text=combinedOcrText(contractOcrPages,contractPendingImages);
     if(!text.trim()){contractImportError='OCR read no text from these pictures. Try clearer, well-lit photos with the text upright, or paste the contract text instead. Nothing was saved.';contractPreview=null;contractPendingImages=[];contractOcrPages=[];render();return}
     if(!reparseContractOcrPages()){contractImportError='OCR read text, but deterministic parsing found no shifts in it (no date + shift pattern on the same line). Fix the photos or paste the contract text instead. Nothing was saved.';contractPreview=null;contractPendingImages=[];contractOcrPages=[];render();return}
     render()}catch(err){contractOcrStatus='';contractPreview=null;contractPendingImages=[];contractOcrPages=[];contractImportError=(anyHeic?'Could not read this picture: '+err.message+' HEIC pictures cannot always be decoded in a browser — export it as JPG or PNG and try again. ':'Could not read these pictures with on-device OCR: '+err.message+' Try clearer photos, or paste the contract text instead. ')+'Nothing was saved.';render()}
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
 for(const r of rows){if((db.shifts||[]).some(x=>x.date===r.date&&x.facility===r.facility&&x.type===r.type)){skipped++;continue}
   const pay=String(r.pay||'').trim();if(!pay)incomplete++;
   db.shifts.push({id:id(),date:r.date,facility:r.facility.trim(),type:r.type,pay,status:importStatusForDate(r.date),source:r.source||'extracted-from-contract',contractId,incomplete:!pay,note:`Extracted from contract: ${contractPreview.fileName} — ${contractPreview.aiRead?'AI vision read (gpt-4o-mini) — check carefully, a vision read can misread digits and dates.':contractPreview.isPhoto?'OCR on-device (Tesseract.js) + deterministic parse — check carefully, OCR can misread digits and dates.':'deterministic parse, no AI model read this document.'}${pay?'':' Pay not yet priced — incomplete.'}`});created++}
 const c=(db.contracts||[]).find(x=>x.id===contractId);if(c){c.shiftCount=(db.shifts||[]).filter(x=>x.contractId===contractId).length;
   if(contractPreview.isPhoto&&contractPendingImages.length){try{for(let i=0;i<contractPendingImages.length;i++)await saveContractImage(contractId,contractPendingImages[i],i,contractPendingImages.length);c.imageFileName=contractPreview.imageFileName||contractPendingImages[0].name;c.imageFileNames=contractPendingImages.map(x=>x.name);c.imageStored='indexeddb';c.imageStorageNote='on-device only — cloud document storage not enabled yet'}catch(err){c.imageFileName=contractPreview.imageFileName||contractPendingImages[0].name;c.imageFileNames=contractPendingImages.map(x=>x.name);c.imageStored='failed';c.imageStorageNote='picture could not be stored on this device: '+err.message}}}
 contractPreview=null;contractPendingImages=[];contractOcrPages=[];contractOcrStatus='';persist();render();alert(`Approved: ${created} shift(s) created${incomplete?` (${incomplete} incomplete — pay not yet priced)`:''}${skipped?`; ${skipped} duplicate(s) skipped`:''}. Contract record saved and linked to the new shifts.`)}
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
// --- App update check (service worker) ---
// The app is cached by a service worker, so a new preview can sit
// unnoticed behind the old one. On load the app registers the worker,
// asks it to check for an update, and prompts to reload when a newer
// worker is waiting or finishes installing.
function checkAppUpdate(){
  if(typeof navigator==='undefined'||!('serviceWorker'in navigator)){alert('Service workers are not available in this browser — reload the page to pick up the latest version ('+BUILD_STAMP+').');return}
  navigator.serviceWorker.getRegistration().then(reg=>{
    if(!reg){alert('No service worker registered yet — reload the page to pick up the latest version.');return}
    if(reg.waiting){if(confirm('A newer version of CRNA Hub is ready. Reload now to use it?'))window.location.reload();return}
    try{const p=reg.update();if(p&&p.catch)p.catch(()=>{})}catch(e){}
    alert('Checking for a newer version — if one is found, the app will ask you to reload. You are on build '+BUILD_STAMP+'.');
  }).catch(()=>{alert('Could not check for updates — reload the page to pick up the latest version.')});
}

// --- On-device contract-picture OCR (FALLBACK ONLY, facility) ---
// Explicit fallback for when there is no connection: runs ONLY when the
// user taps “No connection? Try on-device reading”. Never the submit
// default, never silent — AI reads first. Same preview-before-save flow
// as AI reading; OCR rows are flagged “from photo — check carefully”.
async function importFacilityContractWithOCR(e){if(e)e.preventDefault();facilityContractError='';facilityContractPendingImages=[];facilityContractOcrPages=[];facilityContractOcrStatus='';const files=$('f_facilityContractFile')?Array.from($('f_facilityContractFile').files||[]):[];const imageFiles=files.filter(isImageFile);const anyHeic=imageFiles.some(x=>/\.heic$/i.test(x.name||''));if(!imageFiles.length){facilityContractError='Choose contract photos first, then tap the on-device reading button. Nothing was read, nothing was saved.';render();return}
if(imageFiles.length){
   facilityContractPendingImages=imageFiles;facilityContractOcrStatus='Reading picture 1 of '+imageFiles.length+' on this device with OCR (Tesseract.js) — no picture is sent to a server for OCR. This can take a few seconds per page…';facilityContractPreview=null;render();
   try{
     for(let i=0;i<imageFiles.length;i++){const img=imageFiles[i];facilityContractOcrStatus='Reading picture '+(i+1)+' of '+imageFiles.length+' ('+img.name+') on this device with OCR…';const el0=document.getElementById('facilityContractOcrStatus');if(el0)el0.textContent=facilityContractOcrStatus;
       let t='',ocrPass='default';try{const best=await ocrBestPassForFile(img,m=>{const el=document.getElementById('facilityContractOcrStatus');if(el&&m&&m.status)el.textContent=`Reading picture ${i+1} of ${imageFiles.length} (${img.name}) on this device with OCR… ${m.status}${m.progress!=null?' '+Math.round(m.progress*100)+'%':''}`});t=best.text;ocrPass=best.pass;facilityContractOcrPages.push({file:img,name:img.name,text:t,status:t.trim().length?'ok':'empty',ocrPass})}catch(pageErr){facilityContractOcrPages.push({file:img,name:img.name,text:'',status:'failed',error:String(pageErr&&pageErr.message||pageErr)})}}
     facilityContractOcrStatus='';facilityContractOcrPages=orderedOcrPages(facilityContractOcrPages,facilityContractPendingImages);
     const text=combinedOcrText(facilityContractOcrPages,facilityContractPendingImages);
     if(!text.trim()){facilityContractError='OCR read no text from these pictures. Try clearer, well-lit photos with the text upright, or paste the contract text instead. Nothing was saved.';facilityContractPreview=null;facilityContractPendingImages=[];facilityContractOcrPages=[];render();return}
     if(!reparseFacilityContractOcrPages()){facilityContractError='OCR read text, but no facility name or rate was found in it. Check the photos, or enter the rates manually below. Nothing was saved.';facilityContractPreview=null;facilityContractPendingImages=[];facilityContractOcrPages=[];render();return}
     render()}catch(err){facilityContractOcrStatus='';facilityContractPreview=null;facilityContractPendingImages=[];facilityContractOcrPages=[];facilityContractError=(anyHeic?'Could not read this picture: '+err.message+' HEIC pictures cannot always be decoded in a browser — export it as JPG or PNG and try again. ':'Could not read these pictures with on-device OCR: '+err.message+' Try clearer photos, or paste the contract text instead. ')+'Nothing was saved.';render()}
   return}
}
async function importFacilityContract(e){e.preventDefault();facilityContractError='';facilityContractCropNote='';facilityContractLastCropAdded=[];facilityContractPendingImages=[];facilityContractOcrPages=[];facilityContractOcrStatus='';const files=$('f_facilityContractFile')?Array.from($('f_facilityContractFile').files||[]):[];const f=files[0]||null;
 const name=f?f.name:'';const ext=name?('.'+name.split('.').pop().toLowerCase()):'';const mime=f?f.type:'';
 const imageFiles=files.filter(isImageFile);const anyHeic=imageFiles.some(x=>/\.heic$/i.test(x.name||''));
 if(imageFiles.length){
   // AI FIRST (recommended): photos go to vision AI. On-device OCR is
   // the explicit fallback button below — never the silent default.
   // If AI cannot run (not signed in / not configured), say so plainly
   // and stop: do NOT fall back to OCR silently.
   if(!SUPABASE_CONFIGURED||!cloudSession){facilityContractError='AI reading (recommended) needs you signed in on the Account tab — sign in and submit again, or use “No connection? Try on-device reading” below. Nothing was sent, nothing was saved.';render();return}
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
 alert(`Saved ${saved} new facilit${saved===1?'y':'ies'}${updated?`, updated ${updated} existing facilit${updated===1?'y':'ies'}`:''} from the contract${repriced?`. ${repriced} unpriced shift(s) priced from the new pay rule${repriced===1?'':''}`:''}. Rates are labelled “from contract” on the facilities list.`);
}
async function awaitSaveContractImage(c,files,preview){const list=Array.isArray(files)?files:[files];for(let i=0;i<list.length;i++)await saveContractImage(c.id,list[i],i,list.length);c.imageFileName=preview.fileName||list[0].name;c.imageFileNames=list.map(x=>x.name);c.imageStored='indexeddb';c.imageStorageNote='on-device only — cloud document storage not enabled yet'}
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
function cloudAssistantAnswer() { if (!SUPABASE_CONFIGURED) return 'Cloud accounts and sync are not in this release on this device yet: Supabase is not configured (paste the publishable key into supabase-config.js — see the README), so data lives in this browser only (localStorage). Use the Account tab to download a JSON backup before changing phones or clearing browser data.'; if (!cloudSession) return 'You are not signed in, so data lives in this browser only (localStorage). Sign in on the Account tab to sync NBCRNA, AANA, license, and CE records to your Supabase account. Use the Account tab to download a JSON backup before changing phones or clearing browser data.'; if (cloudPending) return 'You are signed in, but you have not chosen how to merge yet, so records are still on-device only. Open the Account tab and choose "Upload my on-device records" or "Load cloud records".'; return 'You are signed in and credential records (NBCRNA, AANA, licenses, CE records) sync to your Supabase account; shifts, facilities, mileage, and PTO stay on this device. Portal pulls run from the Credentials tab — NBCRNA by public lookup, AANA by one-time sign-in, state boards where automation is allowed (WV and Ohio block it). The Assistant tab can also check a portal for you: you sign in yourself, show it the record page, and confirm what it saves — it never stores a portal password. Records a pull brings back are labelled with their source; the rest are user-entered, not verified.'; }
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
async function submitCloudAuth(e) { e.preventDefault(); const fd = new FormData(e.currentTarget); const email = String(fd.get('email') || '').trim(), password = String(fd.get('password') || ''); const sn = String(fd.get('scheduleName') || '').trim(); const et = String(fd.get('employmentType') || '').trim(); const goalRaw = String(fd.get('incomeGoalStep1') || '').trim(); // Profile fields on the sign-in form save locally when provided —
  // a blank field never wipes a saved value.
  applyProfileValues({ name: sn, employmentType: et, monthlyIncomeGoal: goalRaw === '' ? undefined : num(goalRaw) }); if (!email || !password) { cloudAuthStatus = 'Enter an email and password.'; render(); return alert('Enter an email and password.'); } cloudAuthStatus = 'Signing in\u2026'; render(); try { const data = await sbAuthReq('/auth/v1/token?grant_type=password', { email: email, password: password }); if (!cloudStoreSession(data)) throw new Error('Sign-in succeeded but no session was returned. If email confirmation is required, confirm from your inbox, then sign in again.'); cloudAuthStatus = ''; await cloudAfterSignIn(); } catch (err) { let msg = err.message || ''; if (/email not confirmed/i.test(msg)) msg = 'Email not confirmed yet \u2014 check your inbox for the confirmation email, open its link, then sign in again.'; cloudAuthStatus = 'Sign-in failed: ' + msg; render(); alert('Sign-in failed: ' + msg); } }
async function cloudSignUp(email, password, scheduleNm, employment, monthlyGoal) { cloudAuthStatus = 'Creating account\u2026'; render(); // Profile fields save locally first, then ride along in the signup
  // user_metadata (profileMetadata) so the account is created with them.
  applyProfileValues({ name: scheduleNm || '', employmentType: employment || '', monthlyIncomeGoal: monthlyGoal }); try { const signupBody = { email: email, password: password, data: profileMetadata() }; const data = await sbAuthReq('/auth/v1/signup', signupBody); if (!cloudStoreSession(data)) { cloudAuthStatus = 'Account created. If Supabase requires email confirmation, confirm from your inbox, then sign in with the form above.'; render(); alert('Account created. If Supabase requires email confirmation, confirm from your inbox, then sign in with the form above.'); return; } cloudAuthStatus = ''; await cloudAfterSignIn(); } catch (err) { let msg = err.message || ''; if (/email rate limit/i.test(msg)) msg = 'Too many confirmation emails were sent recently \u2014 wait a little while and try again, or sign in if the account was already created.'; cloudAuthStatus = 'Sign-up failed: ' + msg; render(); alert('Sign-up failed: ' + msg); } }
async function cloudSignOut() { try { if (cloudSession) await sbAuthReq('/auth/v1/logout', {}, { token: cloudSession.access_token }); } catch (e) {} cloudSession = null; cloudActive = false; cloudPending = null; cloudOffline = false; cloudError = ''; cloudPersistSession(); render(); }
function cloudDocumentRow(x) { return { id: x.id, user_id: cloudUid(), cert_type: x.certType || null, file_name: x.fileName || null, storage_path: x.storagePath || null, issue_date: x.issue || null, expiration_date: x.expiry || null, expiry_source: x.expirySource || 'user_entered', storage_status: x.storageStatus || 'local_details_only', uploaded_at: x.uploadedAt || cloudNow() }; }
async function cloudSaveDocument(rec) { if (!cloudSyncEnabled()) return; try { await sbReq('/rest/v1/documents', 'POST', cloudDocumentRow(rec)); cloudOffline = false; cloudError = ''; cloudLastSync = cloudNow(); cloudPersistSession(); } catch (e) { cloudOffline = true; cloudError = e.message; } }
function cloudDeleteDocument(entryId) { if (!cloudSyncEnabled()) return; const rec = (db.documents || []).find(x => x.id === entryId); (async () => { try { if (rec && rec.storagePath) { await cloudEnsureToken(); await sbStorageReq('/storage/v1/object/certification-documents/' + rec.storagePath.split('/').map(encodeURIComponent).join('/'), 'DELETE'); } await sbReq('/rest/v1/documents?id=eq.' + encodeURIComponent(entryId), 'DELETE'); } catch (e) { cloudOffline = true; cloudError = e.message; } })(); }

function cloudSaveKind(kind, savedId) { if (!cloudSyncEnabled()) return; (async () => { try { if (kind === 'nbcrna') { if (cloudLocalHasNbcrna()) { await sbReq('/rest/v1/nbcrna_profiles', 'POST', cloudNbcrnaRow()); await cloudUpsertPortals(); } } else if (kind === 'aana') { if (cloudLocalHasAana()) { await sbReq('/rest/v1/aana_memberships', 'POST', cloudAanaRow()); await cloudUpsertPortals(); } } else if (kind === 'licenses') { const rec = (db.licenses || []).find(x => x.id === savedId); if (rec) { await sbReq('/rest/v1/licenses', 'POST', cloudLicenseRow(rec)); await cloudUpsertPortals(); } } else if (kind === 'nbcrnaCE') { const rec = (db.nbcrnaCE || []).find(x => x.id === savedId); if (rec) await sbReq('/rest/v1/ce_records', 'POST', cloudCeRow(rec, 'nbcrna')); } else if (kind === 'aanaCE') { const rec = (db.aanaCE || []).find(x => x.id === savedId); if (rec) await sbReq('/rest/v1/ce_records', 'POST', cloudCeRow(rec, 'aana')); } else if (kind === 'documents') { const rec = (db.documents || []).find(x => x.id === savedId); if (rec) await sbReq('/rest/v1/documents', 'POST', cloudDocumentRow(rec)); } cloudOffline = false; cloudError = ''; cloudLastSync = cloudNow(); cloudPersistSession(); } catch (e) { cloudOffline = true; cloudError = e.message; } })(); }
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
function cloudPortalState(key) { if (!SUPABASE_CONFIGURED) return { label: 'Not connected', detail: 'Supabase not configured — paste the publishable key (see the Account tab)' }; if (!cloudSession) return { label: 'Not connected', detail: 'Sign in on the Account tab to sync records to your account' }; if (cloudPending || !cloudActive) return { label: 'Not connected', detail: 'Signed in — choose upload or load on the Account tab first' }; if (cloudOffline) return { label: 'Signed in (offline)', detail: 'Showing the on-device copy; the last sync attempt failed' + (cloudError ? ' (' + cloudError + ')' : '') };
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
// --- Connect: open the REAL portal (preview stand-in for the final sheet) ---
// FINAL native design (see PORTAL_NATIVE_SPEC above): Connect opens the
// portal in Apple's system sign-in sheet (ASWebAuthenticationSession) —
// iPhone Passwords + Face ID fill the login, the app never sees a portal
// password, and the assistant reads the record page and previews it before
// saving. This web preview cannot open a system sheet, so Connect below is
// the PREVIEW STAND-IN: it opens the official sign-in page in a new browser
// tab, where the user's own browser, Face ID, and saved passwords work.
// The user signs in there, comes back, and taps "I signed in — check it",
// which opens the assistant portal-check flow (screenshot or pasted text,
// preview before save). The stand-in is labelled as such everywhere it
// appears (PORTAL_STANDIN_LABEL, class "standin") — never present it as
// the final flow, and never build preview-only workarounds into the native
// layer. No portal password is ever collected, sent, or stored by this app.
// Server-side pulls stay blocked — NBCRNA public verification submit 404s,
// AANA SSO sign-in is bot-gated, WV/OH board lookups block automation —
// and the old in-app AANA username/password form could never complete a
// sign-in (the server connect-aana endpoint was deleted Nov 5, 2026 —
// audit F9; see supabase/functions/portal-sync/index.ts).
// (portalCall/portalRefreshStatus below still serve the monitoring log.)
let portalOpened = {}; // portalKey -> true once Connect opened the real portal in a new tab this session
async function portalRefreshStatus() { try { if (typeof liveSyncGet !== 'function') return; const data = await liveSyncGet('portal-sync', 'status'); cloudPortals = data.connections || []; } catch (e) {} }
async function portalCall(body) { await cloudEnsureToken(); return await liveSyncPost('portal-sync', body); }
function portalErrMsg(e) { return (e && e.data && e.data.message) || (e && e.message) || 'The portal check failed.'; }
function portalOpenSignIn(key) {
  const meta = PORTAL_CHECK_SOURCES[key]; if (!meta) return;
  portalOpened[key] = true;
  try { window.open(meta.url, '_blank', 'noopener'); } catch (e) {}
  render();
}
function cloudCountsLine(c) { if (!c) return 'unknown'; return 'NBCRNA: ' + c.nbcrna + ' · AANA: ' + c.aana + ' · Licenses: ' + c.licenses + ' · CE records: ' + c.ce; }
function syncSectionHTML(){
  return `<section class="panel" id="live-sync-panel">${onboardDirectionHTML(2)}${typeof liveSyncPanelHTML==='function'?liveSyncPanelHTML():'<h2>Live calendar sync</h2><p class="muted">Live calendar sync is loading…</p>'}${qgendaFeedHTML()}${scheduleImportHTML()}<details><summary>Manual fallback — import or export a .ics file</summary><h3>Import shifts from a calendar (.ics)</h3><p class="muted">Export your calendar as a .ics file and import it here — duplicates are skipped, never doubled.</p><form id="calendarForm"><div class="form-grid">${field('calFile','Choose .ics file','file','','accept=".ics,text/calendar"')}${select('calSource','Which calendar is this from?',['Google Calendar','Apple Calendar','Outlook','Calendar file'],'Calendar file')}</div><div class="form-actions"><button type="submit">Parse calendar — preview only (nothing saved yet)</button></div></form>${calImportError?`<p class="hint">${escapeHTML(calImportError)}</p>`:''}<div style="margin-top:14px">${calPreviewHTML()}</div><h3>Export shifts to a calendar (.ics)</h3><div class="toolbar"><button data-action="export-cal-all">Download all shifts (.ics)</button><button data-action="export-cal-month">Download this month (.ics)</button></div></details></section>`;
}
function accountPage() {
  const home = homeAddressSection();
  if (!SUPABASE_CONFIGURED) return onboardDirectionHTML(1) + `<section class="panel"><h2>Account — Supabase not configured</h2><p><strong>Sign-in and cloud sync are not available yet.</strong> The app is working on-device only, exactly as before.</p><p class="muted">To enable it, the owner pastes the project's publishable (anon) key into <code>supabase-config.js</code> (replacing <code>PASTE_PUBLISHABLE_KEY_HERE</code>) and redeploys. Find it in the Supabase dashboard: Project Settings → API → Publishable key, for project <code>xgoghgihfhtnyevgapyp</code> (<code>https://xgoghgihfhtnyevgapyp.supabase.com</code>).</p><p class="muted">The publishable key is a public client key and is safe to embed. Never paste the secret key or service-role key into this repo or any client file — those bypass Row Level Security and belong server-side only.</p><p class="muted">Until the key is filled in, nothing here fails silently: this page, the header, and the Credentials cards all say "not configured".</p></section>` + syncSectionHTML() + backupHTML() + home;
  if (!cloudSession) return onboardDirectionHTML(1) + `<section class="panel"><h2>Account — sign in to sync credentials</h2><p class="muted">Create your account, add the name as it appears on your schedule and licenses, pick W-2, 1099, or both, and set a monthly income goal — or skip it.</p><form id="cloudAuthForm"><div class="form-grid">${field('email', 'Email', 'email', '', 'required autocomplete="email"')}${field('password', 'Password', 'password', '', 'required autocomplete="current-password"')}${field('scheduleName', 'Name as it appears on your schedule and licenses', 'text', (db.settings && db.settings.scheduleName) || '', 'placeholder="e.g. C. Martin" autocomplete="off"')}${selectLabeled('employmentType','Employment type',[['','Select employment type'],['w2','W-2 — employed'],['1099','1099 — independent contractor'],['both','Both W-2 and 1099']],employmentType())}${field('incomeGoalStep1', 'Monthly income goal ($) — optional', 'number', monthlyIncomeGoal()>0?monthlyIncomeGoal():'', 'min="0" step="1" placeholder="e.g. 40000"')}</div><div class="toolbar"><button type="button" class="secondary tiny" data-action="skip-income-goal">Skip — I\u2019ll set this later</button></div><p class="muted">No goal yet? No worries — skip it and set one later.</p>${formEnd('Sign in')}</form>${cloudAuthStatus ? `<p class="hint" id="cloudAuthStatus">${escapeHTML(cloudAuthStatus)}</p>` : ''}<div class="toolbar"><button type="button" class="secondary" data-action="cloud-signup">Create account</button></div><p class="muted">If we email you a confirmation, tap it, then sign in.</p></section>` + syncSectionHTML() + backupHTML() + home;
  if (cloudPending) { const c = cloudPending.counts; return onboardDirectionHTML(1) + `<section class="panel"><h2>Account — choose how to sync</h2><p><strong>Signed in as ${escapeHTML(cloudSession.email || '')}.</strong> Before anything syncs, choose one direction. Nothing has been overwritten.</p><p class="muted">Cloud records: ${escapeHTML(cloudCountsLine(c))}</p><p class="muted">On-device records: ${escapeHTML(cloudCountsLine(cloudLocalCounts()))}</p><div class="toolbar"><button data-action="cloud-upload">Upload my on-device records to my account</button><button class="secondary" data-action="cloud-load">Load cloud records onto this device</button></div><p class="muted">Shifts, facilities, mileage, and PTO are untouched either way.</p><div class="toolbar"><button type="button" class="secondary tiny" data-action="cloud-keep-local">Decide later (keep working on-device for now)</button><button type="button" class="secondary tiny" data-action="cloud-signout">Sign out</button></div></section>` + syncSectionHTML() + backupHTML() + home; }
  const lc = cloudLocalCounts(); const profileSection = `<section class="panel"><h2>Profile — step 1</h2><p class="muted">Your profile — change anything, any time.</p><div class="form-grid">${field('profileName', 'Name as it appears on your schedule and licenses', 'text', profileName(), 'placeholder="e.g. C. Martin" autocomplete="off"')}${selectLabeled('profileEmploymentType','Employment type',[['','Select employment type'],['w2','W-2 — employed'],['1099','1099 — independent contractor'],['both','Both W-2 and 1099']],employmentType())}${field('profileIncomeGoal', 'Monthly income goal ($) — blank unsets it', 'number', monthlyIncomeGoal()>0?monthlyIncomeGoal():'', 'min="0" step="1" placeholder="e.g. 40000"')}</div><div class="toolbar"><button type="button" data-action="save-profile">Save profile</button></div><p class="muted">Employment type: ${escapeHTML(employmentTypeLabel())} — W-2 salary days are never double-counted; 1099 shifts price from contracts and facilities. Monthly goal: ${monthlyIncomeGoal()>0?currency(monthlyIncomeGoal()):'not set'}.</p></section>`;
  return onboardDirectionHTML(1) + profileSection + `<section class="panel"><h2>Account</h2><p><strong>Signed in as ${escapeHTML(cloudSession.email || '')}.</strong> Mode: <strong>${escapeHTML(cloudHeaderLabel())}</strong></p><p class="muted">On-device credential records: ${escapeHTML(cloudCountsLine(lc))}${cloudLastSync ? ' · Last sync: ' + escapeHTML(cloudFmtWhen(cloudLastSync)) : ''}</p>${cloudError ? `<p class="muted">Last sync problem: ${escapeHTML(cloudError)}</p>` : ''}<p class="muted">Credential edits save to your account automatically. Shifts, facilities, mileage, and PTO stay on this device.</p><div class="toolbar"><button data-action="cloud-sync">Sync now (download cloud records)</button><button class="secondary" data-action="cloud-upload">Upload my on-device records</button><button class="secondary" data-action="cloud-signout">Sign out</button></div><p class="muted">Sync now pulls your account records down; Upload pushes these up. Both ask first.</p></section>` + syncSectionHTML() + backupHTML() + home;
}
async function cloudInit() { if (!SUPABASE_CONFIGURED || !cloudSession) return; try { await cloudEnsureToken(); } catch (e) { cloudSession = null; cloudActive = false; cloudPending = null; cloudPersistSession(); render(); return; } if (cloudActive) { try { const data = await cloudFetchAll(); cloudApplyData(data); render(); } catch (e) { cloudOffline = true; cloudError = e.message; render(); } } else { try { const data = await cloudFetchAll(); cloudPending = { counts: cloudCountsOf(data), hasLocal: cloudLocalHasRecords() }; render(); } catch (e) { cloudPending = { counts: null, hasLocal: cloudLocalHasRecords() }; render(); } } }

// Boot (Nov 6, 2026): the first render is hardened — if anything in the
// first paint throws, the user still gets the tab bar and a visible error
// panel with a reload button, never a silent blank page (the boot watchdog
// in index.html is the second net, for failures before this file runs).
function bootRender(){try{render()}catch(e){try{console.error(e)}catch(_){ } const navEl=$('nav');if(navEl&&!navEl.innerHTML){navEl.innerHTML=tabs.map(t=>`<button class="${tab===t?'active':''}" data-tab="${escapeHTML(t)}">${escapeHTML(t)}</button>`).join('');try{navEl.querySelectorAll('[data-tab]').forEach(b=>b.addEventListener('click',()=>setTab(b.dataset.tab)))}catch(_){ }} const appEl=$('app');if(appEl)appEl.innerHTML=`<section class="panel"><h2>Something went wrong starting CRNA Hub</h2><p class="muted">${escapeHTML(String((e&&e.message)||e))}</p><p class="muted">Your saved data on this device is not affected. Tap a tab above to try that page, or reload.</p><p><button type="button" onclick="location.reload()">Reload</button></p></section>`}}
bootRender();cloudInit();if('serviceWorker'in navigator&&location.protocol==='https:')navigator.serviceWorker.register('./sw.js').then(reg=>{const promptReload=()=>{if(confirm('A newer version of CRNA Hub is available. Reload now to use it?'))window.location.reload()};if(reg.waiting)promptReload();reg.addEventListener('updatefound',()=>{const sw=reg.installing;if(!sw)return;sw.addEventListener('statechange',()=>{if(sw.state==='installed'&&navigator.serviceWorker.controller)promptReload()})});try{const p=reg.update();if(p&&p.catch)p.catch(()=>{})}catch(e){}}).catch(()=>{});
