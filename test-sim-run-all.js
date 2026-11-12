'use strict';
// CRNA Hub — SIMULATED-USER PASS runner (standing, approved by
// Caleb Nov 11, 2026). Runs the three persona journeys, the
// pinned found-bugs file, the full node suite, and the Deno
// suites, then prints ONE verdict screen.
//
//   node test-sim-run-all.js                everything
//   node test-sim-run-all.js --personas     personas + found bugs only (fast)
//   node test-sim-run-all.js --no-deno      skip the Deno suites
//
// Standing rule: every build round runs this BEFORE its delivery
// is reported, and the delivery report includes the verdict.
// See hidden_files/simulated-user-pass.md.
//
// Exit code: 0 = verdict PASS (found bugs in their documented
// state are NOT failures); 1 = regressions or persona failures;
// 3 = a pinned found bug now passes — promote its pin (the
// verdict prints ACTION either way; 3 only when nothing else
// failed).
const fs = require('fs'); const path = require('path');
const { spawnSync } = require('child_process');
const R = __dirname;
const args = new Set(process.argv.slice(2));
const PERSONAS = ['test-sim-persona1-locum.js', 'test-sim-persona2-w2-sidegig.js', 'test-sim-persona3-grid.js'];
const FOUND_BUGS = 'test-sim-found-bugs.js';
const SELF = 'test-sim-run-all.js';
// The four known pre-existing failures (byte-identical FAIL lines
// on pristine trees since long before the sim pass; recorded in
// the checklist). File -> expected FAIL-line count.
const KNOWN = { 'test-ai-assistant-final.js': 1, 'test-calendar-editing.js': 3, 'test-dashboard-dayview-cleanup.js': 6, 'test-paystub.js': 1 };
const DENO_FILES = ['supabase/functions/_shared/calendar.test.ts', 'supabase/functions/qgenda-feed/parse.test.ts', 'supabase/functions/extract-contract/normalize.test.ts', 'supabase/functions/ics-feed/parse.test.ts'];

function runNode(file, timeoutMs) {
  const r = spawnSync(process.execPath, [path.join(R, file)], { cwd: R, encoding: 'utf8', timeout: timeoutMs || 240000, maxBuffer: 64 * 1024 * 1024 });
  const out = (r.stdout || '') + (r.stderr || '');
  return {
    file, code: r.status, timedOut: !!r.error && r.error.code === 'ETIMEDOUT',
    pass: (out.match(/^PASS /gm) || []).length,
    failLines: (out.match(/^FAIL /gm) || []).length,
    foundBugLines: out.split('\n').filter(l => l.startsWith('FOUND-BUG')),
    out,
  };
}
function head() {
  try { return require('child_process').execSync('git rev-parse --short HEAD', { cwd: R, encoding: 'utf8' }).trim(); } catch (e) { return '?'; }
}

const lines = [];
let regressions = [], personaFails = [], actions = [];
lines.push(`CRNA HUB — SIMULATED-USER PASS · ${new Date().toISOString()} · head ${head()}`);

/* ---- personas ---- */
const personaResults = PERSONAS.map(f => { process.stdout.write(`  … ${f}\r`); return runNode(f); });
const personaSummary = personaResults.map(r => {
  const ok = r.code === 0 && r.failLines === 0;
  if (!ok) personaFails.push(`${r.file} (exit ${r.code}, ${r.failLines} FAIL)`);
  return `${r.file.replace('test-sim-', '').replace('.js', '')} ${ok ? 'PASS' : 'FAIL'} (${r.pass} pins)`;
});
lines.push('Personas:  ' + personaSummary.join(' · '));

/* ---- found bugs ---- */
const fbRes = runNode(FOUND_BUGS);
const fbStill = fbRes.foundBugLines.filter(l => l.includes('(expected fail)')).length;
const fbFixed = fbRes.foundBugLines.filter(l => l.includes('NOW PASSES')).length;
if (fbRes.code === 3 || fbFixed > 0) actions.push(`${fbFixed} pinned found bug(s) now PASS — promote the pin(s) into the owning suite and remove from test-sim-found-bugs.js`);
if (fbRes.code !== 0 && fbRes.code !== 3) regressions.push(`${FOUND_BUGS} exited ${fbRes.code} (expected 0, or 3 when a bug is fixed)`);
lines.push(`Found bugs pinned: ${fbStill} in documented state${fbFixed ? ` · ${fbFixed} NOW PASSING (action below)` : ''} — test-sim-found-bugs.js (FB1 + FB2 promoted in v139; no open pins)`);

if (!args.has('--personas')) {
  /* ---- standard node suites ---- */
  const all = fs.readdirSync(R).filter(f => /^test-.*\.js$/.test(f) && !PERSONAS.includes(f) && f !== FOUND_BUGS && f !== SELF).sort();
  let green = 0; const knownSeen = [];
  for (const f of all) {
    process.stdout.write(`  … suites ${f}\r`);
    const r = runNode(f);
    if (r.code === 0 && r.failLines === 0) { green++; continue; }
    if (Object.prototype.hasOwnProperty.call(KNOWN, f)) {
      knownSeen.push(`${f} (${r.failLines} FAIL${r.failLines === KNOWN[f] ? '' : ` — baseline is ${KNOWN[f]}, COUNT DRIFT`})`);
      if (r.failLines !== KNOWN[f]) actions.push(`${f}: known-failure count drifted ${KNOWN[f]} -> ${r.failLines}; refresh the baseline only after confirming the same lines fail on a pristine tree`);
      continue;
    }
    regressions.push(`${f} (exit ${r.code}, ${r.failLines} FAIL${r.timedOut ? ', TIMED OUT' : ''})`);
  }
  lines.push(`Standard suites: ${all.length} files — ${green} green · ${knownSeen.length} known pre-existing failures · ${regressions.length} regression(s)`);
  for (const k of knownSeen) lines.push(`  known: ${k}`);

  /* ---- deno suites ---- */
  if (!args.has('--no-deno')) {
    const deno = path.join(process.env.HOME || '', '.deno', 'bin', 'deno');
    if (fs.existsSync(deno)) {
      const parts = [];
      for (const f of DENO_FILES) {
        const r = spawnSync(deno, ['test', '--no-check', '--allow-read', '--allow-env', f], { cwd: R, encoding: 'utf8', timeout: 300000, maxBuffer: 64 * 1024 * 1024 });
        const out = ((r.stdout || '') + (r.stderr || '')).replace(/\x1b\[[0-9;]*m/g, '');
        const m = out.match(/(\d+) passed \| (\d+) failed/);
        const name = f.split('/').slice(-2).join('/');
        if (m && +m[2] === 0) parts.push(`${name} ${m[1]}/${m[1]}`);
        else { parts.push(`${name} ${m ? `${m[1]} passed, ${m[2]} FAILED` : 'NO RESULT'}`); regressions.push(`deno ${f} (${m ? m[2] + ' failed' : 'no result'})`); }
      }
      lines.push('Deno suites: ' + parts.join(' · '));
    } else lines.push('Deno suites: SKIPPED (no deno binary)');
  }
}

for (const a of actions) lines.push('ACTION: ' + a);
for (const r of regressions) lines.push('REGRESSION: ' + r);
for (const p of personaFails) lines.push('PERSONA FAIL: ' + p);
const bad = regressions.length + personaFails.length;
lines.push(bad ? `VERDICT: FAIL — ${bad} problem(s) above` : `VERDICT: PASS${actions.length ? ' (with actions above)' : ''} — personas green, no regressions, found bugs in documented state`);
process.stdout.write(lines.join('\n') + '\n');
process.exitCode = bad ? 1 : (actions.length ? 3 : 0);
