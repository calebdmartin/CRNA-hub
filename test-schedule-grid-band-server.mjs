// CRNA Hub — server normalizer tests for grid band extraction
// (Nov 7, 2026). Run: node --experimental-strip-types
// test-schedule-grid-band-server.mjs
//
// Pins normalizeAiGridLocate / normalizeAiBandRead against the
// fixture truth: header 23-Nov -> 6-Dec (14 columns), Martin's
// cells at columns 9-13: 5**, 5*, 5**, 5*, 7.
import { normalizeAiGridLocate, normalizeAiBandRead } from './supabase/functions/extract-contract/normalize.ts';

let failures = 0;
const t = (name, cond) => {
  console.log((cond ? 'PASS ' : 'FAIL ') + name);
  if (!cond) { failures++; process.exitCode = 1; }
};
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const loc = normalizeAiGridLocate({
  is_grid: true,
  header_dates: ['23-Nov', '24-Nov', '25-Nov'],
  row_labels: ['Adkins', '', 'Martin'],
});
t('locate: grid + coerced header dates + labels kept in order (blanks preserved)',
  loc.isGrid === true && loc.headerDates.length === 3 && eq(loc.rowLabels, ['Adkins', '', 'Martin']));
t('locate: not-a-grid / junk input degrades to empty, never throws',
  normalizeAiGridLocate(null).isGrid === false &&
  normalizeAiGridLocate({ is_grid: true, header_dates: ['x'], row_labels: [] }).isGrid === false);

const HDR = ['23-Nov', '24-Nov', '25-Nov', '26-Nov', '27-Nov', '28-Nov', '29-Nov', '30-Nov', '1-Dec', '2-Dec', '3-Dec', '4-Dec', '5-Dec', '6-Dec'];
const CELLS = ['', '', '', '', '', '', '', '', '5**', '5*', '5**', '5*', '7', ''];
const band = normalizeAiBandRead({ header_dates: HDR, cells: CELLS }, 'Martin');
t('band: exactly the five filled cells become shifts', band.shifts.length === 5);
t('band: fixture truth — columns 9-13, codes verbatim',
  eq(band.shifts.map((s) => s.column), [9, 10, 11, 12, 13]) &&
  eq(band.shifts.map((s) => s.code), ['5**', '5*', '5**', '5*', '7']));
const yr = new Date().getFullYear();
t('band: dates re-derived from the header (anchored), never from the model',
  eq(band.shifts.map((s) => s.date), [
    `${yr}-12-01`, `${yr}-12-02`, `${yr}-12-03`, `${yr}-12-04`, `${yr}-12-05`,
  ]) && band.shifts.every((s) => s.anchored === true));
t('band: blank cells produce nothing; a cell with no readable header date is dropped',
  normalizeAiBandRead({ header_dates: ['', '24-Nov'], cells: ['9', '8'] }, 'Martin').shifts.length === 1);
t('band: junk input degrades to empty, never throws',
  normalizeAiBandRead(null, 'Martin').shifts.length === 0 &&
  normalizeAiBandRead({ cells: 'nope' }, 'Martin').shifts.length === 0);

console.log(failures ? failures + ' FAILURES' : 'ALL PASS');
