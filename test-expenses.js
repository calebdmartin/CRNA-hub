'use strict';
// CRNA Hub — expense tracking v1 (v158, Nov 12, 2026).
// Run: node test-expenses.js
//
// The simulated-user journey for the Expenses feature, in the app's
// real code (same vm harness as the rest of the suite):
//   photo-first add (AI read stubbed in the deployed function's own
//     answer shape, fed the generated sample receipt in
//     test-assets/sample-receipt.png) -> confirm form -> save
//   manual add (backup path) -> edit -> delete (confirm dialog)
//   month + YTD totals math
//   expenses CSV contents + range filter
//   CPA pack for the year -> every figure reconciles with the app's
//     own occurrence engine / mileage totals / expense totals
//   feature toggle off -> section collapses to one line, data kept;
//     on -> restored
//   categories: defaults are the neutral starter list, custom add /
//     remove persist per-user in settings
//   cloud round trip: cloudExpenseRow -> cloudRowToRecord ->
//     cloudMergeSyncedList restores the record under a fresh device
//   neutrality: no Caleb facility/vendor/amount anywhere in defaults
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const R = __dirname + path.sep;

function makeWorld(store) {
  function el() {
    return {
      innerHTML: '', textContent: '', value: '', checked: false, files: [],
      addEventListener() {}, append() {}, click() {}, remove() {},
      dataset: {}, style: {}, scrollIntoView() {},
    };
  }
  const elements = {};
  class FakeFormData {
    constructor(form) { this._e = (form && form._entries) || []; }
    get(k) { const hit = this._e.find(([key]) => key === k); return hit ? hit[1] : null; }
    *[Symbol.iterator]() { yield* this._e; }
  }
  class FakeFileReader {
    readAsDataURL() { this.result = 'data:image/png;base64,iVBORw0KGgo='; if (this.onload) this.onload(); }
  }
  const sandbox = {
    console, setTimeout, clearTimeout, URL, URLSearchParams, Date, JSON, Math,
    crypto: require('crypto').webcrypto,
    FormData: FakeFormData, FileReader: FakeFileReader,
    localStorage: {
      getItem: (k) => store.has(k) ? store.get(k) : null,
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
    },
    document: {
      getElementById: (id) => elements[id] || (elements[id] = el()),
      querySelectorAll: () => [], createElement: () => el(), body: { append() {} },
    },
    window: null, navigator: {}, location: { protocol: 'https:', search: '', pathname: '/' },
    alert: () => {},
    confirm: () => true,
    fetch: async () => ({ status: 200, ok: true, text: async () => '{}', json: async () => ({}) }),
    history: { replaceState() {} },
  };
  sandbox.window = sandbox;
  sandbox.window.scrollTo = () => {};
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(R + 'supabase-config.js', 'utf8'), sandbox);
  vm.runInContext(fs.readFileSync(R + 'app.js', 'utf8'), sandbox);
  return { sandbox, run: (code) => vm.runInContext(code, sandbox) };
}

let failures = 0;
const t = (name, cond) => {
  console.log((cond ? 'PASS ' : 'FAIL ') + name);
  if (!cond) { failures++; process.exitCode = 1; }
};

(async () => {
  const store = new Map();
  const { run } = makeWorld(store);
  const today = run(`localDate(new Date())`);
  const prefix = today.slice(0, 7), year = today.slice(0, 4);
  const d1 = prefix + '-04', d2 = prefix + '-11';
  const jan = year + '-01-15';

  // ---------- Defaults & neutrality ----------
  t('featureExpenses defaults ON for a fresh account', run(`db.settings.featureExpenses === true && featureOn('featureExpenses')`));
  t('Account Features panel carries the Expense tracking toggle',
    run(`accountPage()`).includes('Expense tracking'));
  t('default categories are the neutral starter list (no user data baked in)',
    run(`JSON.stringify(expenseCategories())`) === JSON.stringify(['Licenses & certifications', 'CE & education', 'Dues & memberships', 'Lodging', 'Travel', 'Meals', 'Equipment & supplies', 'Other']));

  // ---------- Photo-first add (AI read in the function's own shape) ----------
  run(`
    cloudSession = { user_id: 'sim-user', access_token: 'sim-token', email: 'sim.tester@crna-hub-test.local' };
    liveSyncPost = async function (name, body) {
      if (name === 'extract-contract' && body && body.mode === 'receipt')
        return { ok: true, mode: 'receipt', receipt: { vendor: 'Riverbend Medical Supply', date: '${d1}', amount: 86.40, raw_text: 'RIVERBEND MEDICAL SUPPLY ... TOTAL $86.40' }, raw_text: 'receipt', model: 'gpt-4o-mini' };
      throw new Error('unexpected liveSyncPost ' + name);
    };
  `);
  await run(`readExpenseReceipt({ name: 'sample-receipt.png', type: 'image/png' })`);
  t('AI read lands in the confirm draft — vendor/date/TOTAL from the sample receipt',
    run(`expenseDraft && expenseDraft.vendor === 'Riverbend Medical Supply' && expenseDraft.date === '${d1}' && expenseDraft.amount === '86.4'`));
  t('nothing is saved from the photo alone (preview-before-save)',
    run(`db.expenses.length`) === 0);
  t('the section re-renders with the draft values in the form',
    run(`expensesSectionHTML()`).includes('Riverbend Medical Supply'));
  // User confirms the form as-is (entries = what the form would post).
  await run(`submitExpense({ preventDefault() {}, currentTarget: { dataset: { kind: 'expenses' }, _entries: [
    ['date', '${d1}'], ['vendor', 'Riverbend Medical Supply'], ['amount', '86.40'],
    ['category', 'Equipment & supplies'], ['facility', ''], ['note', 'Scrub set + tubing']
  ], querySelector: () => null } })`);
  t('confirm saves exactly one expense, sourced ai-vision, receipt attached',
    run(`db.expenses.length === 1 && db.expenses[0].source === 'ai-vision' && db.expenses[0].fileName === 'sample-receipt.png' && expenseAmount(db.expenses[0]) === 86.4`));

  // ---------- Manual add (backup path) ----------
  await run(`submitExpense({ preventDefault() {}, currentTarget: { dataset: { kind: 'expenses' }, _entries: [
    ['date', '${d2}'], ['vendor', 'AANA'], ['amount', '499'], ['category', 'Dues & memberships'], ['facility', ''], ['note', 'Annual dues']
  ], querySelector: () => null } })`);
  await run(`submitExpense({ preventDefault() {}, currentTarget: { dataset: { kind: 'expenses' }, _entries: [
    ['date', '${jan}'], ['vendor', 'MedEd Courses LLC'], ['amount', '250'], ['category', 'CE & education'], ['facility', ''], ['note', '']
  ], querySelector: () => null } })`);
  t('manual adds save as manual with no receipt',
    run(`db.expenses.length === 3 && db.expenses[1].source === 'manual' && db.expenses[1].fileName === ''`));

  // ---------- Totals math ----------
  t('month total = 86.40 + 499 = 585.40', run(`expenseMonthTotal('${prefix}')`) === 585.4);
  t('YTD total = 585.40 + 250 (January) = 835.40', run(`expenseYearTotal('${year}')`) === 835.4);
  const page = run(`mileagePage()`);
  t('Mileage view carries the Expenses section with totals and this month\u2019s rows',
    page.includes('Expenses') && page.includes('AANA') && page.includes('Riverbend Medical Supply') && page.includes('CPA pack'));

  // ---------- Edit ----------
  run(`editId = db.expenses[1].id;`);
  await run(`submitExpense({ preventDefault() {}, currentTarget: { dataset: { kind: 'expenses' }, _entries: [
    ['date', '${d2}'], ['vendor', 'AANA'], ['amount', '450'], ['category', 'Dues & memberships'], ['facility', ''], ['note', 'Annual dues (early rate)']
  ], querySelector: () => null } })`);
  t('edit updates in place (count unchanged, amount + note move, month total follows)',
    run(`db.expenses.length === 3 && db.expenses[1].amount === '450' && db.expenses[1].note.includes('early rate') && expenseMonthTotal('${prefix}') === 536.4`));

  // ---------- CSV export ----------
  const csv = run(`expenseCsvText('${prefix}', '${prefix}')`);
  t('expenses CSV: header + exactly this month\u2019s rows, amounts plain',
    csv.startsWith('date,vendor,category,facility,amount,note') && csv.split('\r\n').length === 3 && csv.includes('Riverbend Medical Supply') && csv.includes('86.4') && !csv.includes('MedEd'));
  const csvYear = run(`expenseCsvText('${year}-01', '${year}-12')`);
  t('expenses CSV: full-year range carries all three rows', csvYear.split('\r\n').length === 4);

  // ---------- Delete (generic delete path, confirm stubbed true) ----------
  const delId = run(`db.expenses[2].id`);
  run(`actions('delete-expenses', '${delId}')`);
  t('delete removes the row and totals follow',
    run(`db.expenses.length === 2 && expenseYearTotal('${year}') === 536.4`));

  // ---------- Categories: per-user add / remove, persisted ----------
  run(`db.settings.expenseCategories = expenseCategories().slice();`);
  run(`const inp = document.getElementById('expenseNewCategory'); inp.value = 'Conference travel';`);
  run(`addExpenseCategoryFromInput()`);
  t('custom category added and persisted in settings (rides settings sync)',
    run(`db.settings.expenseCategories.includes('Conference travel')`) &&
    JSON.parse(store.get('crna-hub-v2')).settings.expenseCategories.includes('Conference travel'));
  run(`deleteExpenseCategory('Conference travel')`);
  t('custom category removed', run(`!db.settings.expenseCategories.includes('Conference travel')`));

  // ---------- Feature toggle: off collapses, data preserved; on restores ----------
  run(`setFeature('featureExpenses', false)`);
  const offPage = run(`mileagePage()`);
  t('expenses off: section collapses to the one quiet line with Turn on',
    offPage.includes('Expense tracking is off') && offPage.includes('Turn on') && !offPage.includes('Add an expense') && !offPage.includes('CPA pack'));
  t('expenses off: records preserved untouched', run(`db.expenses.length`) === 2);
  run(`setFeature('featureExpenses', true)`);
  t('expenses back on: full section restored with the same totals',
    run(`mileagePage()`).includes('Add an expense') && run(`expenseYearTotal('${year}')`) === 536.4);

  // ---------- Cloud round trip (fresh device restores) ----------
  run(`
    const row = cloudExpenseRow(db.expenses[0]);
    window.__cloudRow = row;
  `);
  const rowOk = run(`!!window.__cloudRow && window.__cloudRow.table !== '' && window.__cloudRow.expense_date === db.expenses[0].date && window.__cloudRow.amount === 86.4 && window.__cloudRow.data.vendor === 'Riverbend Medical Supply'`);
  t('cloudExpenseRow: typed columns + complete data payload', rowOk);
  const restored = run(`
    (() => {
      const rec = cloudRowToRecord(window.__cloudRow);
      const merged = cloudMergeSyncedList([], [rec], 'expenses');
      return merged.length === 1 && merged[0].vendor === 'Riverbend Medical Supply' && expenseAmount(merged[0]) === 86.4 && merged[0].fileName === 'sample-receipt.png';
    })()
  `);
  t('cloud round trip: a fresh device merges the expense back exactly', restored);
  t('cloud spec registered for the expenses kind', run(`!!cloudSyncedSpec('expenses') && cloudSyncedSpec('expenses').table === 'expenses'`));

  // ---------- CPA pack reconciles with the app's own totals ----------
  // Demo income + mileage for the same year: one facility, a biweekly
  // schedule anchored on a stub whose own check is an ACTUAL, plus
  // priced shifts in its periods; one verified trip this month.
  run(`
    db.facilities = [{ id: 'fac1', name: 'Demo General', hourlyRate: '200', paidHours8: '8' }];
    const payday = '${d2}';
    const pEnd = addDaysStr(payday, -9), pStart = addDaysStr(pEnd, -13);
    db.shifts = [
      { id: 'cp1', date: pStart, facility: 'Demo General', type: '8-hour day', pay: '1600', status: 'confirmed' },
      { id: 'cp2', date: pEnd, facility: 'Demo General', type: '8-hour day', pay: '1600', status: 'confirmed' }
    ];
    db.payStubs = [{ id: 'cps1', agency: 'Demo Staffing LLC', facility: 'Demo General', frequency: 'biweekly', payDate: payday, periodStart: pStart, periodEnd: pEnd, gross: '3100', net: '', source: 'ai-vision' }];
    db.mileage = [{ id: 'cpm1', date: '${d1}', facility: 'Demo General', purpose: 'Work', miles: '50', oneWayMiles: 25, tripType: 'round-trip', milesSource: 'manual', origin: 'home', status: 'verified' }];
    persist();
  `);
  const pack = run(`cpaPackCsv('${year}')`);
  const occAmt = run(`paystubOccurrencesInMonth('${prefix}').filter(o => o.stubId === 'cps1').reduce((s, o) => s + (paystubOccurrenceAmount(o) || 0), 0)`);
  t('CPA pack: sections present (summary, income by facility, detail, mileage, expenses)',
    ['SUMMARY', 'INCOME - PAYCHECKS BY FACILITY', 'INCOME - PAYCHECK DETAIL', 'MILEAGE LOG', 'EXPENSE LOG'].every(h => pack.includes(h)));
  t('CPA pack: the stub-backed check is labeled actual and counted at the stub actual $3,100',
    pack.includes('actual (pay stub)') && occAmt === 3100 && pack.includes('3100'));
  t('CPA pack: income by facility reconciles with the occurrence engine',
    pack.includes('Demo General') && run(`cpaIncomeByFacility('${year}').actual`) === 3100);
  t('CPA pack: mileage miles reconcile with the verified trips (50.0)',
    run(`Math.round(verifiedMileageTrips().filter(m => m.date.startsWith('${year}-')).reduce((s, x) => s + num(x.miles), 0) * 10) / 10`) === 50 &&
    pack.split('MILEAGE LOG')[1].includes('50'));
  t('CPA pack: expense total reconciles with expenseYearTotal (536.40)',
    pack.includes('TOTAL EXPENSES') && pack.includes('536.4') && run(`expenseYearTotal('${year}')`) === 536.4);
  t('CPA pack: year picker includes the current year and defaults sensibly',
    run(`cpaPackYears().includes('${year}')`));

  console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL EXPENSE TESTS PASS');
})();
