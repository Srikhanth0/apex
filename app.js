import {
  START_DATE, DAYS, ROTATION, MODES, WEEKS, WEEK0_TASKS, GATES, DSA, PATTERN_USE, REVIEW_STEPS,
  LIBRARY, SKILL_CREDITS_PER_MONTH, SKILL_BADGES, PERKS, CHEATS, ACHIEVEMENTS,
} from './data.js';
import { createIntel } from './intel.js';

/* ---------- utilities ---------- */
const $ = s => document.querySelector(s);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = n => String(n).padStart(2, '0');
const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return iso(d); };
const diff = (a, b) => Math.round((parse(a) - parse(b)) / 864e5);
const today = () => iso(new Date());
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WD = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const fmt = s => { const d = parse(s); return `${d.getDate()} ${MONTHS[d.getMonth()]}`; };
const weekday = s => (parse(s).getDay() + 6) % 7;
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const now = () => Date.now();
const safe = fn => { try { return fn(); } catch { return null; } };
const isUrl = s => /^https?:\/\/\S+$/i.test(s || '');

/* ---------- state ---------- */
const KEY = 'apex:v1', SYNC_KEY = 'apex:sync', LOCAL_KEY = 'apex:local';
const MAPS = ['days', 'dsa', 'prs', 'notes', 'lib', 'libStatus', 'skills', 'perks', 'tasks', 'ach', 'reads', 'apps', 'jobfb', 'settings'];
const blank = () => ({ v: 1, u: 0, name: '', startDate: START_DATE, reminder: '07:30', ...Object.fromEntries(MAPS.map(k => [k, {}])) });
let S = Object.assign(blank(), safe(() => JSON.parse(localStorage.getItem(KEY))) || {});
MAPS.forEach(k => { S[k] = S[k] || {}; });
const sync = Object.assign({ repo: '', branch: 'main', path: 'data/tracker.json', token: '', last: 0, sha: '' }, safe(() => JSON.parse(localStorage.getItem(SYNC_KEY))) || {});
const local = Object.assign({ timerStart: 0, filter: 'due', libTab: 'resources', ntfy: '', theme: 'system' }, safe(() => JSON.parse(localStorage.getItem(LOCAL_KEY))) || {});
const saveLocal = () => safe(() => localStorage.setItem(LOCAL_KEY, JSON.stringify(local)));
const saveSync = () => safe(() => localStorage.setItem(SYNC_KEY, JSON.stringify(sync)));

function save(quiet) {
  S.u = now();
  checkAchievements();
  safe(() => localStorage.setItem(KEY, JSON.stringify(S)));
  if (!quiet) render();
  schedulePush();
}
// Upsert one record in a map with its own timestamp so two devices merge cleanly.
function put(map, id, patch) { S[map][id] = { ...(S[map][id] || {}), ...patch, u: now() }; }

function merge(a, b) {
  const out = (a.u || 0) >= (b.u || 0) ? { ...b, ...a } : { ...a, ...b };
  for (const k of MAPS) {
    const m = { ...(a[k] || {}) };
    for (const [id, rec] of Object.entries(b[k] || {})) if (!m[id] || (rec.u || 0) > (m[id].u || 0)) m[id] = rec;
    out[k] = m;
  }
  out.u = Math.max(a.u || 0, b.u || 0);
  return out;
}

/* ---------- plan position ---------- */
function position(d = today()) {
  const i = diff(d, S.startDate);
  if (i < -7) return { phase: 'before', week: 0, day: 0, i };
  if (i < 0) return { phase: 'setup', week: 0, day: 7 + i + 1, i };
  if (i >= DAYS) return { phase: 'done', week: 12, day: DAYS, i };
  return { phase: 'run', week: Math.floor(i / 7) + 1, day: i + 1, i };
}

/* ---------- day status and the consistency algorithm ---------- */
function loggedMinutes(rec) {
  if (!rec) return 0;
  if (rec.minutes != null && rec.minutes !== '') return Number(rec.minutes) || 0;
  const mode = MODES[rec.mode || 'full'];
  const ticked = mode.blocks.filter(([k]) => rec.blocks?.[k]).reduce((t, b) => t + b[2], 0);
  return Math.max(ticked, Math.round((rec.timer || 0) / 60));
}
function status(rec) {
  const m = loggedMinutes(rec);
  if (m >= 75) return 'full';
  if (m >= 25) return 'low';
  if (m >= 10 || rec?.blocks && Object.values(rec.blocks).some(Boolean)) return 'min';
  return null;
}
const VALUE = { full: 1, low: 0.6, min: 0.3 };

// Streak rules: any session (10+ min) extends it. A missed day spends a freeze if you have one
// (earned every 7 straight days, max 2). Without a freeze, one missed day is forgiven; two in a row
// break the streak. "Never miss twice" is the rule the algorithm enforces.
function consistency() {
  const t = today();
  const dates = Object.keys(S.days).filter(d => status(S.days[d])).sort();
  const res = { streak: 0, best: 0, freezes: 0, comebacks: 0, atRisk: false, first: dates[0] || null, map: {}, score: null, score7: null, bestFullWeek: 0 };
  if (!dates.length) return res;
  let streak = 0, freezes = 0, misses = 0, earned = 0;
  for (let d = dates[0]; d <= t; d = addDays(d, 1)) {
    const st = status(S.days[d]);
    if (st) {
      if (misses === 1) res.comebacks++;
      streak++; misses = 0; earned++;
      if (earned % 7 === 0 && freezes < 2) freezes++;
      res.map[d] = st;
    } else if (d === t) {
      res.map[d] = 'pending';
    } else if (freezes > 0) {
      freezes--; res.map[d] = 'frozen';
    } else if (misses === 0) {
      misses = 1; res.map[d] = 'miss';
    } else {
      misses++; streak = 0; earned = 0; res.map[d] = 'miss';
    }
    res.best = Math.max(res.best, streak);
  }
  res.streak = streak; res.freezes = freezes;
  res.atRisk = !status(S.days[t]) && res.map[addDays(t, -1)] === 'miss';
  // Weighted consistency: recent days count more (0.93 per day back), days before your first log ignored.
  const score = n => {
    let w = 0, v = 0;
    const end = status(S.days[t]) ? t : addDays(t, -1);
    for (let k = 0; k < n; k++) {
      const d = addDays(end, -k);
      if (d < dates[0]) break;
      const wt = 0.93 ** k; w += wt; v += wt * (VALUE[status(S.days[d])] || 0);
    }
    return w ? Math.round((100 * v) / w) : null;
  };
  res.score = score(28); res.score7 = score(7);
  for (let wk = 0; wk <= 12; wk++) {
    const s0 = addDays(S.startDate, (wk - 1) * 7);
    let n = 0; for (let k = 0; k < 7; k++) if (status(S.days[addDays(s0, k)]) === 'full') n++;
    res.bestFullWeek = Math.max(res.bestFullWeek, n);
  }
  return res;
}

/* ---------- DSA spaced re-solves ---------- */
function dsaState(p) {
  const r = S.dsa[p.id];
  if (!r?.solved) return { kind: 'new', label: 'Not started' };
  if (r.next == null) return { kind: 'mastered', label: 'Mastered' };
  const late = diff(today(), r.next);
  if (late >= 0) return { kind: 'due', label: late ? `Re-solve ${late}d late` : 'Re-solve today' };
  return { kind: 'scheduled', label: `Re-solve ${fmt(r.next)}` };
}
function solve(id) {
  const t = today();
  put('dsa', id, { solved: t, step: 0, next: addDays(t, REVIEW_STEPS[0]), passes: 0, fails: 0 });
}
function review(id, ok) {
  const r = S.dsa[id], t = today();
  if (ok) {
    const step = (r.step || 0) + 1;
    const gap = step < REVIEW_STEPS.length ? REVIEW_STEPS[step] - REVIEW_STEPS[step - 1] : null;
    put('dsa', id, { step, passes: (r.passes || 0) + 1, last: t, next: gap ? addDays(t, gap) : null });
  } else {
    put('dsa', id, { fails: (r.fails || 0) + 1, last: t, next: addDays(t, 1) });
  }
}

/* ---------- stats ---------- */
function stats() {
  const c = consistency();
  const days = Object.entries(S.days).filter(([, r]) => status(r));
  const minutes = days.reduce((t, [, r]) => t + loggedMinutes(r), 0);
  const timerMin = days.reduce((t, [, r]) => t + Math.min(loggedMinutes(r), Math.round((r.timer || 0) / 60)), 0);
  const proofDays = days.filter(([, r]) => isUrl(r.proof)).length;
  const backfilled = days.filter(([d, r]) => r.created && diff(r.created, d) > 1).length;
  const dsaSolved = DSA.filter(p => S.dsa[p.id]?.solved).length;
  const resolvesPassed = Object.values(S.dsa).reduce((t, r) => t + (r.passes || 0), 0);
  const due = DSA.filter(p => dsaState(p).kind === 'due');
  const prs = Object.values(S.prs).filter(p => !p.deleted);
  const notes = Object.values(S.notes).filter(n => !n.deleted);
  const badges = Object.values(S.skills).filter(b => b.status === 'earned').length;
  return {
    ...c, daysLogged: days.length, hours: Math.round(minutes / 6) / 10, minutes, timerShare: minutes ? Math.round((100 * timerMin) / minutes) : null,
    proofDays, proofRate: days.length ? Math.round((100 * proofDays) / days.length) : null, backfilled,
    dsaSolved, resolvesPassed, due, prsOpened: prs.length, prsMerged: prs.filter(p => p.status === 'merged').length,
    papers: notes.length, badges, bestStreak: c.best,
  };
}
function checkAchievements() {
  const s = stats();
  for (const a of ACHIEVEMENTS) if (!S.ach[a.id] && a.test(s)) { S.ach[a.id] = { d: today(), u: now() }; toast(`Achievement: ${a.title}`); }
}

/* ---------- today's session ---------- */
function nextProblems(n, week) {
  const open = DSA.filter(p => !S.dsa[p.id]?.solved);
  const mine = open.filter(p => p.week <= Math.max(week, 1));
  return (mine.length ? mine : open).slice(0, n);
}
function session(d = today()) {
  const pos = position(d), wd = weekday(d), rot = ROTATION[wd];
  const wk = WEEKS[Math.min(Math.max(pos.week, 0), 12)];
  const s = stats();
  const firstDue = s.due[0];
  let main, side = rot.side;
  if (pos.phase === 'before' || pos.phase === 'setup') {
    main = 'Week 0 setup: work through the kickoff checklist on the Plan tab';
    side = 'Solve Two Sum and Contains Duplicate as a timed baseline';
  } else if (rot.focus === 'learn') main = `${wd === 4 ? 'AI/ML track' : 'Concept from scratch'}: ${wk.learn}`;
  else if (rot.focus === 'build') main = `Atlas: ${wk.build}`;
  else if (rot.focus === 'dsa') {
    const ps = nextProblems(2, pos.week).map(p => p.name).join(' and ');
    main = `DSA: ${ps || 'timed mixed set'}${firstDue ? ` + re-solve ${firstDue.name}` : ''}`;
  } else if (rot.focus === 'oss') main = pos.week >= 3 ? 'Open source: move your current PR one step (issue, reproduce, patch, review)' : `Atlas: ${wk.build}`;
  else main = `Deep read one paper, then the weekly review. Proof this week: ${wk.proof}`;
  if (/DSA problem/.test(side)) { const p = nextProblems(1, pos.week)[0]; if (p) side = `1 DSA problem: ${p.name}`; }
  return { pos, wk, rot, main, side };
}
function finding(s, ses) {
  const t = today(), rec = S.days[t], hr = new Date().getHours();
  if (ses.pos.phase === 'done') return 'All 12 weeks are behind you. Run the Gate 3 retro and plan the next 90 days.';
  if (s.atRisk) return 'You missed yesterday. Log 10 minutes today or the streak resets tomorrow.';
  if (!status(rec) && hr >= 20 && s.streak > 0) return `Streak of ${s.streak} at risk tonight. A 10-minute minimum day keeps it.`;
  if (s.due.length) return `${s.due.length} re-solve${s.due.length > 1 ? 's' : ''} due: ${s.due[0].name} first.`;
  if (s.score7 != null && s.score7 < 50) return `Last 7 days at ${s.score7}% consistency. Run Low mode until 3 days land in a row.`;
  const g = GATES.find(g => g.date >= t);
  if (g && diff(g.date, t) <= 7) return `Gate ${g.n} in ${diff(g.date, t)} days: ${s.dsaSolved} of ${g.dsa} problems, ${s.prsOpened} of ${g.prsOpened} PRs opened.`;
  if (status(rec) === 'full') return 'Today is done. Log the proof link and stop; rest is part of the plan.';
  return `Today: ${ses.main}.`;
}

/* ---------- rendering helpers ---------- */
const ICON = {
  today: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  plan: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  practice: '<path d="M8 8l-4 4 4 4M16 8l4 4-4 4M13.5 5l-3 14"/>',
  library: '<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M4 19V5M8 7h7"/>',
  progress: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  read: '<path d="M3 5h7a3 3 0 0 1 3 3v12a2 2 0 0 0-2-2H3zM21 5h-7a3 3 0 0 0-3 3v12a2 2 0 0 1 2-2h8z"/>',
  jobs: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 13h18"/>',
  more: '<circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/>',
  settings: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
};
const icon = k => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[k]}</svg>`;
const VIEWS = [['today', 'Today'], ['read', 'Read'], ['jobs', 'Jobs'], ['practice', 'Practice'], ['plan', 'Plan'], ['library', 'Library'], ['progress', 'Progress']];
const TABS = [['today', 'Today'], ['read', 'Read'], ['jobs', 'Jobs'], ['practice', 'Practice'], ['more', 'More']];
const TITLES = { ...Object.fromEntries(VIEWS), settings: 'Settings', more: 'More' };
const panel = (title, body, { chip, end, cls = '' } = {}) => `<section class="panel ${cls}"><div class="ph"><h2>${title}</h2>${chip != null ? `<span class="chip">${chip}</span>` : ''}${end ? `<div class="end">${end}</div>` : ''}</div>${body}</section>`;
const pill = (text, kind = '') => `<span class="pill ${kind}">${esc(text)}</span>`;
const check = (act, on, label, extra = '') => `<button class="check" data-act="${act}" ${extra} aria-pressed="${!!on}" aria-label="${esc(label)}"></button>`;

/* ---------- views ---------- */
// Adaptive load: after a weak week the app proposes Low mode until you choose otherwise.
const defaultMode = (rec, s = stats()) => rec?.mode || (s.score7 != null && s.score7 < 50 ? 'low' : 'full');
function viewToday() {
  const t = today(), ses = session(t), s = stats(), rec = S.days[t] || {};
  const mode = defaultMode(rec, s);
  const M = MODES[mode], hr = new Date().getHours();
  const hello = hr < 5 ? 'Late night' : hr < 12 ? 'Morning' : hr < 17 ? 'Afternoon' : 'Evening';
  const name = S.name ? `, ${esc(S.name)}` : '';
  const where = ses.pos.phase === 'run' ? `Week ${ses.pos.week}, day ${ses.pos.day} of ${DAYS} · ${WD[weekday(t)]}: ${ses.rot.focus}` : ses.pos.phase === 'done' ? 'Plan complete' : `Week 0, setup · Week 1 starts ${fmt(S.startDate)}`;
  const mins = loggedMinutes(rec), st = status(rec);
  const nextGate = GATES.find(g => g.date >= t);
  const blockText = k => k === 'main' ? ses.main : k === 'side' ? ses.side : null;
  const strip = M.blocks.map(([k, , m]) => `<i class="${rec.blocks?.[k] ? 'on' : ''}" style="flex:${m}"></i>`).join('');
  const blocks = M.blocks.map(([k, label, m, hint]) => `<div class="row ${rec.blocks?.[k] ? 'done' : ''}">${check(`block:${k}`, rec.blocks?.[k], `Mark ${label} done`)}<div class="main"><b>${esc(label)} · ${m} min</b><span>${esc(blockText(k) || hint)}</span></div></div>`).join('');
  const running = !!local.timerStart;
  const dueRows = s.due.slice(0, 4).map(p => `<div class="row"><div class="main"><a href="${p.url}" target="_blank" rel="noopener"><b>${esc(p.name)}</b></a><span>${esc(p.pattern)} · ${esc(dsaState(p).label)}</span></div><div class="act"><button class="btn sm" data-act="review:${p.id}:1">Passed</button><button class="btn sm link" data-act="review:${p.id}:0">Failed</button></div></div>`).join('');
  const recent = Object.keys(S.days).filter(d => d < t && status(S.days[d])).sort().reverse().slice(0, 4);
  const wk = ses.wk;
  return `<div class="col view-enter">
    <header class="greet"><h1>${hello}${name}. ${st === 'full' ? 'Today is done.' : s.streak ? `Day ${s.streak} of the streak.` : 'Day one starts now.'}</h1>
      <p class="finding">${esc(finding(s, ses))}</p><p>${esc(where)}</p></header>
    <div class="grid">
      <div class="tile s3 ${s.atRisk ? 'risk' : ''}"><span>Streak</span><b>${s.streak} <small>days</small></b><em>${s.freezes} freeze${s.freezes === 1 ? '' : 's'} saved · best ${s.best}</em></div>
      <div class="tile s3"><span>Consistency, 28 days</span><b>${s.score ?? '–'}${s.score != null ? '<small> %</small>' : ''}</b><em>${s.score7 != null ? `Last 7 days ${s.score7}%` : 'Starts with your first log'}</em></div>
      <div class="tile s3"><span>Today</span><b>${mins} <small>of ${M.minutes} min</small></b><em>${st ? `${MODES[st].label} day counted` : 'Nothing logged yet'}</em></div>
      <div class="tile s3"><span>${nextGate ? `Gate ${nextGate.n}` : 'Gates'}</span><b>${nextGate ? `${Math.max(0, diff(nextGate.date, t))} <small>days</small>` : 'Done'}</b><em>${nextGate ? `${s.dsaSolved}/${nextGate.dsa} DSA · ${s.prsOpened}/${nextGate.prsOpened} PRs · ${s.hours}/${nextGate.hours} h` : 'All three gates passed'}</em></div>
      <section class="panel white s9">
        <div class="ph"><h2>Today's session</h2><span class="chip">${M.minutes} min</span><div class="end"><div class="seg" role="group" aria-label="Energy mode">${Object.entries(MODES).map(([k, m]) => `<button data-act="mode:${k}" aria-pressed="${k === mode}">${m.label}</button>`).join('')}</div></div></div>
        <div class="strip" aria-hidden="true">${strip}</div>
        <div class="strip-key"><span>${M.blocks.map(b => `${b[1]} ${b[2]}`).join(' · ')}</span><span>${mins} min logged</span></div>
        <div class="rows">${blocks}</div>
        <div class="form" style="margin-top:16px">
          <div class="timer wide"><b id="clock">${clock(rec)}</b><button class="btn ${running ? '' : 'primary'}" data-act="timer">${running ? 'Pause focus timer' : 'Start focus timer'}</button><span class="muted small">Timer minutes count as verified time.</span></div>
          <label class="f">Energy, 1 to 5<div class="seg" role="group" aria-label="Energy">${[1, 2, 3, 4, 5].map(n => `<button data-act="energy:${n}" aria-pressed="${rec.energy === n}">${n}</button>`).join('')}</div></label>
          <label class="f">Proof link <small>Commit, PR, note or post. Days with proof count toward integrity.</small><input type="url" data-bind="proof" placeholder="https://github.com/…" value="${esc(rec.proof)}"></label>
          <label class="f wide">One-line log <small>What you did, what confused you, what is next.</small><textarea data-bind="note" rows="2">${esc(rec.note)}</textarea></label>
        </div>
      </section>
      <div class="s3 stack">
        ${panel('Re-solves due', dueRows || '<p class="empty">Nothing due. New problems wait on the Practice tab.</p>', { chip: s.due.length })}
        ${intel.todayPanel()}
        ${panel('Ask your mentor', '<p class="muted">Opens Claude with today\'s check-in line filled in. No API key used.</p><button class="btn primary" data-act="mentor">Open check-in</button>')}
      </div>
      <section class="panel s6"><div class="ph"><h2>This week</h2><span class="chip">Week ${wk.n}</span><div class="end"><a class="more" href="#plan">Full plan</a></div></div>
        <div class="rows"><div class="row"><div class="main"><b>Learn</b><span>${esc(wk.learn)}</span></div></div><div class="row"><div class="main"><b>Build</b><span>${esc(wk.build)}</span></div></div><div class="row"><div class="main"><b>Proof by Sunday</b><span>${esc(wk.proof)}</span></div></div></div></section>
      <section class="panel s6"><div class="ph"><h2>Recent days</h2><span class="chip">${s.daysLogged}</span><div class="end"><a class="more" href="#progress">Progress</a></div></div>
        <div class="rows">${recent.map(d => { const r = S.days[d]; return `<div class="row"><div class="main"><b>${WD[weekday(d)]} ${fmt(d)} · ${loggedMinutes(r)} min</b><span>${esc(r.note || 'No note')}</span></div>${pill(MODES[status(r)].label, status(r) === 'full' ? 'acc' : '')}</div>`; }).join('') || '<p class="empty">Your first logged day shows here.</p>'}</div></section>
    </div></div>`;
}

function viewPlan() {
  const cur = position().week, done = WEEK0_TASKS.filter(([id]) => S.tasks[id]?.done).length;
  const rows = WEEKS.map(w => `<tr class="${w.n === cur ? 'cur' : ''}"><td class="n">${w.n}</td><td>${esc(w.learn)}</td><td>${esc(w.build)}</td><td>${esc(w.dsa)}</td><td>${w.gate ? `<b>${esc(w.proof)}</b>` : esc(w.proof)}</td></tr>`).join('');
  const rot = ROTATION.map((r, i) => `<tr><td>${WD[i]}</td><td>${esc(r.main)}</td><td>${esc(r.side)}</td></tr>`).join('');
  return `<div class="col view-enter">
    <header class="title"><div><h1>The 12-week plan</h1><p>${fmt(S.startDate)} to ${fmt(addDays(S.startDate, DAYS - 1))} · three phases, three gates · you are in Week ${cur}</p></div></header>
    <div class="grid">
      ${panel('Week by week', `<div class="tablewrap"><table><thead><tr><th class="n">Wk</th><th>Learn</th><th>Build (Atlas)</th><th>DSA</th><th>Proof</th></tr></thead><tbody>${rows}</tbody></table></div>`, { cls: 'white s12' })}
      ${panel('Week 0 kickoff', `<div class="rows">${WEEK0_TASKS.map(([id, t]) => `<div class="row ${S.tasks[id]?.done ? 'done' : ''}">${check(`task:${id}`, S.tasks[id]?.done, t)}<div class="main"><b>${esc(t)}</b></div></div>`).join('')}</div>`, { chip: `${done}/${WEEK0_TASKS.length}`, cls: 's6' })}
      <div class="s6 stack">
        ${panel('Weekly rotation', `<table><thead><tr><th>Day</th><th>Main block, 60 min</th><th>Side, 15 min</th></tr></thead><tbody>${rot}</tbody></table>`)}
        ${panel('Three rules', '<div class="rows"><div class="row"><div class="main"><b>You write the learning code</b><span>AI explains, quizzes and reviews; it never writes code in a learning block.</span></div></div><div class="row"><div class="main"><b>Nothing counts until shipped</b><span>A commit, test, PR, note or log line. Reading alone earns zero.</span></div></div><div class="row"><div class="main"><b>Never miss twice</b><span>A bad day becomes a 10-minute day, never two zeros.</span></div></div></div>')}
      </div>
    </div></div>`;
}

function viewPractice() {
  const s = stats(), f = local.filter, wk = Math.max(position().week, 1);
  const list = DSA.filter(p => f === 'all' || (f === 'due' ? dsaState(p).kind === 'due' || (dsaState(p).kind === 'new' && p.week <= wk) : p.week === wk));
  const groups = [...new Set(list.map(p => p.pattern))];
  const row = p => {
    const st = dsaState(p), r = S.dsa[p.id];
    const kind = { new: '', due: 'warn', scheduled: '', mastered: 'good' }[st.kind];
    const act = st.kind === 'new' ? `<button class="btn sm" data-act="solve:${p.id}">Solved</button>` : st.kind === 'due' ? `<button class="btn sm" data-act="review:${p.id}:1">Passed</button><button class="btn sm link" data-act="review:${p.id}:0">Failed</button>` : `<button class="btn sm link" data-act="unsolve:${p.id}">Reset</button>`;
    return `<div class="row"><div class="main"><a href="${p.url}" target="_blank" rel="noopener"><b>${esc(p.name)}</b></a><span>Week ${p.week}${r?.solved ? ` · solved ${fmt(r.solved)} · ${r.passes || 0} passed, ${r.fails || 0} failed` : ''}</span></div>${pill(st.label, kind)}<div class="act">${act}</div></div>`;
  };
  const prs = Object.entries(S.prs).filter(([, p]) => !p.deleted).sort((a, b) => (b[1].opened || '').localeCompare(a[1].opened || ''));
  return `<div class="col view-enter">
    <header class="title"><div><h1>Practice</h1><p>${s.dsaSolved} of 60 solved · ${s.resolvesPassed} re-solves passed · ${s.due.length} due · ${s.prsMerged} of ${s.prsOpened} PRs merged</p></div>
      <div class="seg" role="group" aria-label="Filter problems">${[['due', 'To do now'], ['week', `Week ${wk}`], ['all', 'All 60']].map(([k, l]) => `<button data-act="filter:${k}" aria-pressed="${f === k}">${l}</button>`).join('')}</div></header>
    <div class="grid">
      <div class="s8 stack">${groups.map(g => panel(esc(g), `<p class="muted small">${esc(PATTERN_USE[g])}</p><div class="rows">${list.filter(p => p.pattern === g).map(row).join('')}</div>`, { chip: `${DSA.filter(p => p.pattern === g && S.dsa[p.id]?.solved).length}/${DSA.filter(p => p.pattern === g).length}` })).join('') || panel('Nothing to do now', '<p class="empty">No re-solves due and this week\'s problems are solved. Try the All 60 view or rest.</p>')}</div>
      <div class="s4 stack">
        ${panel('How to practise', '<div class="rows"><div class="row"><div class="main"><b>5 min: brute force + Big-O</b><span>Out loud or in a comment.</span></div></div><div class="row"><div class="main"><b>25 min attempt</b><span>Stuck at 25? Read the solution, then retype it from memory.</span></div></div><div class="row"><div class="main"><b>Re-solve at 3, 14 and 30 days</b><span>The app schedules these. A fail brings it back tomorrow.</span></div></div></div>')}
        ${panel('Open-source PRs', `<form class="stack" data-form="pr"><input type="text" name="repo" placeholder="owner/repo" required aria-label="Repository"><input type="text" name="title" placeholder="What the PR does" required aria-label="PR title"><input type="url" name="url" placeholder="https://github.com/…/pull/123" aria-label="PR link"><button class="btn primary" type="submit">Add PR</button></form>
          <div class="rows" style="margin-top:12px">${prs.map(([id, p]) => `<div class="row"><div class="main">${isUrl(p.url) ? `<a href="${esc(p.url)}" target="_blank" rel="noopener"><b>${esc(p.title)}</b></a>` : `<b>${esc(p.title)}</b>`}<span>${esc(p.repo)} · opened ${fmt(p.opened)}${p.merged ? ` · merged ${fmt(p.merged)}` : ''}</span></div><select data-pr="${id}" aria-label="PR status">${['opened', 'in review', 'merged', 'closed'].map(o => `<option ${p.status === o ? 'selected' : ''}>${o}</option>`).join('')}</select></div>`).join('') || '<p class="empty">Your first PR target is Week 4.</p>'}</div>`, { chip: prs.length })}
      </div>
    </div></div>`;
}

function libItems() {
  const custom = Object.entries(S.lib).filter(([, r]) => !r.deleted).map(([id, r]) => ({ id, ...r, custom: true }));
  return [...custom, ...LIBRARY];
}
function viewLibrary() {
  const tab = local.libTab, month = today().slice(0, 7);
  const tabs = [['resources', 'Resources'], ['fresh', 'Fresh'], ['notes', 'Paper notes'], ['credits', 'Google Skills'], ['perks', 'Student Pack'], ['cheats', 'Cheat sheets']];
  let body = '';
  if (tab === 'resources') {
    const q = (local.q || '').toLowerCase(), items = libItems().filter(r => !q || `${r.title} ${r.tags.join(' ')} ${r.kind}`.toLowerCase().includes(q));
    const cyc = { todo: 'To do', doing: 'In progress', done: 'Done' };
    const rowR = r => { const st = (S.libStatus[r.id]?.s) || 'todo'; return `<div class="row"><div class="main"><a href="${esc(r.url)}" target="_blank" rel="noopener"><b>${esc(r.title)}</b></a><span>${esc(r.kind)} · ${esc(r.tags.join(', '))}${r.week ? ` · Week ${r.week}` : ''}${r.custom ? ' · added by you' : ''}</span></div><button class="btn sm ${st === 'done' ? '' : 'link'}" data-act="lib:${r.id}">${cyc[st]}</button>${r.custom ? `<button class="btn sm link" data-act="libdel:${r.id}" aria-label="Remove">Remove</button>` : ''}</div>`; };
    body = `<div class="grid"><div class="s8">${panel('All resources', `<input type="search" data-bind-local="q" placeholder="Search by title, tag or kind" value="${esc(local.q || '')}" aria-label="Search resources" style="margin-bottom:12px"><div class="rows">${items.map(rowR).join('')}</div>`, { chip: items.length })}</div>
      <div class="s4 stack">${panel('Add a source', `<form class="stack" data-form="lib"><input type="text" name="title" placeholder="Title" required aria-label="Title"><input type="url" name="url" placeholder="https://…" required aria-label="Link"><select name="kind" aria-label="Kind">${['course', 'video', 'docs', 'blog', 'paper', 'tool', 'book', 'paper-feed'].map(k => `<option>${k}</option>`).join('')}</select><input type="text" name="tags" placeholder="Tags, comma separated" aria-label="Tags"><button class="btn primary" type="submit">Add to library</button></form>`)}
      ${panel('The rule', '<p>One primary resource per topic, finished. To add a feed, drop one first: the list stays near ten.</p>')}</div></div>`;
  } else if (tab === 'fresh') {
    const feed = FEED.items || [];
    body = panel('Fresh this week', feed.length ? `<p class="muted small">Base-ranked by the ingest workflow on ${esc(FEED.updated || '')}. The full briefing, search and summaries are on the <a href=\"#read\">Read</a> tab.</p><div class="rows">${feed.slice(0, 40).map((it, i) => `<div class="row"><div class="main"><a href="${esc(it.url)}" target="_blank" rel="noopener"><b>${esc(it.title)}</b></a><span>${esc(it.source)}${it.date ? ` · ${esc(it.date)}` : ''}</span></div><button class="btn sm" data-act="save:${i}">Save</button></div>`).join('')}</div>` : '<p class="empty">The feed fills after the first run of the ingest workflow on GitHub. It crawls about 35 sources every few hours, with no API key needed.</p>', { chip: feed.length, cls: 'white' });
  } else if (tab === 'notes') {
    const notes = Object.entries(S.notes).filter(([, n]) => !n.deleted).sort((a, b) => b[1].d.localeCompare(a[1].d));
    body = `<div class="grid"><div class="s8">${panel('Paper notes', `<div class="rows">${notes.map(([id, n]) => `<div class="row"><div class="main">${isUrl(n.url) ? `<a href="${esc(n.url)}" target="_blank" rel="noopener"><b>${esc(n.title)}</b></a>` : `<b>${esc(n.title)}</b>`}<span>${fmt(n.d)} · ${esc(n.note)}</span></div><button class="btn sm link" data-act="notedel:${id}">Remove</button></div>`).join('') || '<p class="empty">Sunday deep reads land here: claim, evidence, and whether it changes what you build.</p>'}</div>`, { chip: notes.length })}</div>
      <div class="s4">${panel('New note', `<form class="stack" data-form="note"><input type="text" name="title" placeholder="Paper or post title" required aria-label="Title"><input type="url" name="url" placeholder="https://alphaxiv.org/abs/…" aria-label="Link"><textarea name="note" rows="5" placeholder="What it claims, the evidence, does it change what I build? (about 150 words)" required aria-label="Note"></textarea><button class="btn primary" type="submit">Save note</button></form>`)}</div></div>`;
  } else if (tab === 'credits') {
    const spent = SKILL_BADGES.reduce((t, b) => t + (S.skills[b.id]?.month === month ? Number(S.skills[b.id]?.cost) || 0 : 0), 0);
    const left = SKILL_CREDITS_PER_MONTH - spent;
    const fits = SKILL_BADGES.filter(b => !b.free && S.skills[b.id]?.status !== 'earned' && Number(S.skills[b.id]?.cost) > 0 && Number(S.skills[b.id].cost) <= left);
    const rowB = b => { const r = S.skills[b.id] || {}; return `<div class="row"><div class="main"><b>${esc(b.title)}</b><span>${b.free ? 'Free course, no credits' : 'Uses credits'} · fits Week ${b.week}${r.earned ? ` · earned ${fmt(r.earned)}` : ''}</span></div>${b.free ? '' : `<input type="number" min="0" max="35" data-cost="${b.id}" value="${esc(r.cost ?? '')}" placeholder="Cost" aria-label="Credit cost" style="width:84px">`}<select data-skill="${b.id}" aria-label="Status">${['planned', 'doing', 'earned'].map(o => `<option ${(r.status || 'planned') === o ? 'selected' : ''}>${o}</option>`).join('')}</select></div>`; };
    body = `<div class="grid"><div class="tile s4"><span>Credits left in ${MONTHS[Number(month.slice(5)) - 1]}</span><b>${left} <small>of ${SKILL_CREDITS_PER_MONTH}</small></b><em>${spent} spent on badges started this month</em></div>
      <div class="tile s4"><span>Badges earned</span><b>${Object.values(S.skills).filter(r => r.status === 'earned').length}</b><em>Share each one on your site and LinkedIn</em></div>
      <div class="tile s4"><span>Fits what is left</span><b>${fits.length}</b><em>${fits[0] ? esc(fits[0].title.replace(/ \(.*\)/, '')) : 'Enter costs to plan the month'}</em></div>
      <div class="s8">${panel('Badges for this plan', `<div class="rows">${SKILL_BADGES.map(rowB).join('')}</div>`)}</div>
      <div class="s4">${panel('Using 35 credits well', '<div class="rows"><div class="row"><div class="main"><b>Free courses first</b><span>The intro courses cost nothing; do them in Week 5.</span></div></div><div class="row"><div class="main"><b>One credit badge a month</b><span>Pick the badge that matches the week\'s Atlas work, so the lab doubles as practice.</span></div></div><div class="row"><div class="main"><b>Read before you start a lab</b><span>Lab timers run on credits. Read the steps first, then run it once.</span></div></div><div class="row"><div class="main"><b>Enter the real cost</b><span>Costs change; copy each from its badge page. Names may also differ; check them on Google Skills.</span></div></div></div>')}</div></div>`;
  } else if (tab === 'perks') {
    const n = PERKS.filter(p => S.perks[p.id]?.claimed).length;
    body = `<div class="grid"><div class="s8">${panel('GitHub Student Developer Pack', `<div class="rows">${PERKS.map(p => `<div class="row ${S.perks[p.id]?.claimed ? 'done' : ''}">${check(`perk:${p.id}`, S.perks[p.id]?.claimed, `Claimed ${p.title}`)}<div class="main"><b>${esc(p.title)}</b><span>${esc(p.use)}</span></div></div>`).join('')}</div>`, { chip: `${n}/${PERKS.length}`, end: '<a class="more" href="https://education.github.com/pack" target="_blank" rel="noopener">Open the pack</a>' })}</div>
      <div class="s4">${panel('Claim order', '<p>Domain and Copilot this week, Codespaces before your first OSS PR, cloud credits in Week 10 when Atlas deploys. Offers change: check each on the pack page.</p>')}</div></div>`;
  } else {
    body = `<div class="grid">${CHEATS.map(c => `<div class="s6">${panel(esc(c.title), `<dl class="cheat">${c.body.map(([a, b]) => `<dt>${esc(a)}</dt><dd>${esc(b)}</dd>`).join('')}</dl>`, { cls: 'white' })}</div>`).join('')}</div>`;
  }
  return `<div class="col view-enter"><header class="title"><div><h1>Library</h1><p>${libItems().length} resources · ${Object.values(S.libStatus).filter(r => r.s === 'done').length} finished · ${stats().papers} paper notes</p></div></header>
    <div class="seg subtabs" role="tablist" aria-label="Library sections">${tabs.map(([k, l]) => `<button role="tab" data-act="libtab:${k}" aria-pressed="${tab === k}" aria-selected="${tab === k}">${l}</button>`).join('')}</div>${body}</div>`;
}

function viewProgress() {
  const s = stats(), t = today(), pos = position(), map = s.map;
  // 84-day ladder: a column per week (0-12), a row per weekday, gates under weeks 4, 8, 12.
  let cells = `<span></span>${WEEKS.map(w => `<span class="wk">${w.n}</span>`).join('')}`;
  for (let r = 0; r < 7; r++) {
    cells += `<span class="dl">${WD[r]}</span>`;
    for (let w = 0; w <= 12; w++) {
      const d = addDays(S.startDate, (w - 1) * 7 + r), st = map[d] || (d < t && s.first && d >= s.first ? 'miss' : '');
      cells += `<i class="${st === 'pending' ? '' : st} ${d === t ? 'today' : ''}" title="${fmt(d)}${st && st !== 'pending' ? ` · ${st}` : ''}"></i>`;
    }
  }
  cells += `<span></span>${WEEKS.map(w => `<span class="gate">${w.gate ? `G${w.gate}` : ''}</span>`).join('')}`;
  const nextG = GATES.find(g => g.date >= t) || GATES[2];
  const metric = (label, now, key, fmtv = v => v) => `<tr><td>${label}</td><td class="n"><b>${fmtv(now)}</b></td>${GATES.map(g => `<td class="n ${g === nextG ? '' : 'muted'}">${fmtv(g[key])}</td>`).join('')}</tr>`;
  // Weekly hours, one bar per week; the current week in the accent.
  const wh = WEEKS.map(w => { let m = 0; for (let k = 0; k < 7; k++) m += loggedMinutes(S.days[addDays(S.startDate, (w.n - 1) * 7 + k)]); return m / 60; });
  const max = Math.max(10.5, ...wh), H = 160, bw = 34, gap = (640 - 13 * bw) / 12;
  const bars = `<svg class="bars" viewBox="0 0 680 ${H + 40}" role="img" aria-label="Hours per week"><line x1="30" x2="670" y1="${H - (10.5 / max) * (H - 20)}" y2="${H - (10.5 / max) * (H - 20)}" style="stroke:var(--grid)" stroke-dasharray="4 4"/><text x="670" y="${H - (10.5 / max) * (H - 20) - 6}" text-anchor="end" font-size="11" style="fill:var(--muted)">10.5 h plan</text>${wh.map((h, i) => { const x = 30 + i * (bw + gap), bh = (h / max) * (H - 20); return `<rect x="${x}" y="${H - bh}" width="${bw}" height="${Math.max(bh, h ? 2 : 0)}" rx="4" style="fill:${i === pos.week ? 'var(--accent)' : 'var(--bar-quiet)'}"/><text x="${x + bw / 2}" y="${H + 18}" text-anchor="middle" font-size="11" style="fill:var(--muted)">${i}</text>${h ? `<text x="${x + bw / 2}" y="${H - bh - 6}" text-anchor="middle" font-size="11" style="fill:var(--text)">${h.toFixed(1)}</text>` : ''}`; }).join('')}<line x1="30" x2="670" y1="${H}" y2="${H}" style="stroke:var(--grid)"/></svg>`;
  const ach = ACHIEVEMENTS.map(a => `<div class="row ${S.ach[a.id] ? '' : 'locked'}"><div class="main"><b${S.ach[a.id] ? '' : ' class="muted"'}>${esc(a.title)}</b><span>${esc(a.desc)}${S.ach[a.id] ? ` · ${fmt(S.ach[a.id].d)}` : ''}</span></div>${S.ach[a.id] ? pill('Earned', 'acc') : pill('Locked')}</div>`).join('');
  return `<div class="col view-enter">
    <header class="title"><div><h1>Progress</h1><p>${pos.phase === 'run' ? `Day ${pos.day} of ${DAYS}` : pos.phase === 'done' ? 'Plan complete' : 'Week 0'} · ${s.hours} hours · ${s.daysLogged} days logged · ${Object.keys(S.ach).length} of ${ACHIEVEMENTS.length} achievements</p></div><button class="btn" data-act="export">Export data</button></header>
    <div class="grid">
      ${panel('The 84-day ladder', `<div class="ladder">${cells}</div><div class="key"><span><i style="background:var(--accent)"></i>Full</span><span><i style="background:var(--accent-mid)"></i>Low</span><span><i style="background:var(--accent-soft)"></i>Minimum</span><span><i style="border:1.5px dashed var(--accent-mid)"></i>Freeze used</span><span><i style="background:var(--miss)"></i>Missed</span></div>`, { cls: 'white s8', chip: `best streak ${s.best}` })}
      <div class="s4 stack">${panel('Integrity', `<p class="muted small">Cheating yourself shows up here. Aim for every number to stay high.</p><div class="rows">
        <div class="row"><div class="main"><b>Days with a proof link</b><span>Commit, PR or note attached</span></div><b class="num">${s.proofRate ?? '–'}${s.proofRate != null ? '%' : ''}</b></div>
        <div class="row"><div class="main"><b>Time on the focus timer</b><span>Verified, not typed in</span></div><b class="num">${s.timerShare ?? '–'}${s.timerShare != null ? '%' : ''}</b></div>
        <div class="row"><div class="main"><b>Days logged late</b><span>Filled in 2+ days after</span></div><b class="num" ${s.backfilled ? 'style="color:var(--warning)"' : ''}>${s.backfilled}</b></div>
        <div class="row"><div class="main"><b>Re-solves failed</b><span>Honest fails beat fake passes</span></div><b class="num">${Object.values(S.dsa).reduce((t, r) => t + (r.fails || 0), 0)}</b></div></div>`)}</div>
      ${panel('Scoreboard', `<div class="tablewrap"><table><thead><tr><th>Metric</th><th class="n">Now</th>${GATES.map(g => `<th class="n">Gate ${g.n} · ${fmt(g.date)}</th>`).join('')}</tr></thead><tbody>
        ${metric('Hours logged', s.hours, 'hours')}${metric('Days with a session', s.daysLogged, 'days')}${metric('DSA problems solved', s.dsaSolved, 'dsa')}${metric('Re-solves passed', s.resolvesPassed, 'resolves')}${metric('PRs opened', s.prsOpened, 'prsOpened')}${metric('PRs merged', s.prsMerged, 'prsMerged')}${metric('Paper notes', s.papers, 'papers')}
        <tr><td>Atlas release</td><td class="n">–</td>${GATES.map(g => `<td class="n">${g.release}</td>`).join('')}</tr></tbody></table></div>`, { cls: 'white s12' })}
      ${panel('Hours per week', bars, { cls: 's6', chip: `${s.hours} h total` })}
      ${panel('Achievements', `<div class="rows">${ach}</div>`, { cls: 's6', chip: `${Object.keys(S.ach).length}/${ACHIEVEMENTS.length}` })}
    </div></div>`;
}

function viewSettings() {
  const configured = sync.repo && sync.token;
  return `<div class="col view-enter"><header class="title"><div><h1>Settings</h1><p>Your data lives on this device and, once sync is set, in your GitHub repo.</p></div></header>
    <div class="grid">
      ${panel('Appearance', `<div class="seg" role="group" aria-label="Theme">${[['system', 'System'], ['light', 'Light'], ['dark', 'Dark']].map(([k, l]) => `<button data-act="theme:${k}" aria-pressed="${local.theme === k}">${l}</button>`).join('')}</div>`, { cls: 's12' })}
      ${panel('You', `<div class="form"><label class="f">Name<input type="text" data-bind-s="name" value="${esc(S.name)}" placeholder="Shown in the greeting"></label><label class="f">Week 1 starts<small>A Monday. Week 0 is the 7 days before.</small><input type="date" data-bind-s="startDate" value="${esc(S.startDate)}"></label><label class="f">Daily reminder time<input type="time" data-bind-s="reminder" value="${esc(S.reminder)}"></label></div>`, { cls: 's6' })}
      ${panel('Phone notifications', `<div class="stack"><p>Three ways, no paid service and no API key. Use the first two together.</p>
        <div class="row"><div class="main"><b>Calendar reminder</b><span>A daily event with an alert at your reminder time. Works on every phone.</span></div><button class="btn sm" data-act="ics">Download .ics</button></div>
        <div class="row"><div class="main"><b>Smart nudges via ntfy</b><span>The coach workflow reads your synced log and only pings when the streak is at risk or re-solves are due.</span></div></div>
        <label class="f">ntfy topic<small>Make it long and private. Install the ntfy app, subscribe to this topic, add it as the NTFY_TOPIC secret in your repo.</small><div class="inline"><input type="text" data-bind-local="ntfy" value="${esc(local.ntfy)}" placeholder="apex-${uid()}" style="flex:1"><button class="btn sm" data-act="ntfytest">Send test</button></div></label>
        <div class="row"><div class="main"><b>In-app alerts</b><span>When the app is open after 8 pm and today is empty.</span></div><button class="btn sm" data-act="notify">${'Notification' in window && Notification.permission === 'granted' ? 'On' : 'Turn on'}</button></div></div>`, { cls: 's6' })}
      ${panel('Sync with GitHub', `<div class="form"><label class="f">Repository<small>owner/repo that hosts this app</small><input type="text" data-bind-sync="repo" value="${esc(sync.repo)}" placeholder="yourname/apex"></label><label class="f">Branch<input type="text" data-bind-sync="branch" value="${esc(sync.branch)}"></label>
        <label class="f wide">Fine-grained token<small>GitHub, Settings, Developer settings, Fine-grained tokens: this one repo only, with Contents and Actions set to read and write (Actions lets the app start ingest runs). Stored only on this device.</small><input type="password" data-bind-sync="token" value="${esc(sync.token)}" placeholder="github_pat_…" autocomplete="off"></label>
        <div class="inline wide"><button class="btn primary" data-act="syncnow" ${configured ? '' : 'disabled'}>Sync now</button><span class="muted small">${sync.last ? `Last synced ${new Date(sync.last).toLocaleString()}` : 'Not synced yet'}</span></div></div>`, { cls: 's6' })}
      ${panel('Data', `<div class="stack"><p>Export a backup any time. Import merges, keeping the newer copy of each record.</p><div class="inline"><button class="btn" data-act="export">Export JSON</button><label class="btn">Import JSON<input type="file" accept="application/json" data-import hidden></label><button class="btn link" data-act="reset">Erase this device</button></div></div>`, { cls: 's6' })}
    </div></div>`;
}

/* ---------- render ---------- */
const intel = createIntel({ S: () => S, local, saveLocal, put, save, render: () => render(), esc, panel, pill, fmt, toast, today, sync });
const RENDER = { today: viewToday, plan: viewPlan, practice: viewPractice, library: viewLibrary, progress: viewProgress, settings: viewSettings, read: sub => intel.read(sub), jobs: sub => intel.jobs(sub), more: () => intel.more() };
function applyTheme() { const t = local.theme; if (t === 'system') document.documentElement.removeAttribute('data-theme'); else document.documentElement.dataset.theme = t; }
applyTheme();
let FEED = {};
let lastView = '';
function render() {
  const [v, ...sub] = (location.hash.slice(1) || 'today').split('?')[0].split('/');
  const view = RENDER[v] ? v : 'today';
  const a = document.activeElement, attr = a && ['bind', 'bind-s', 'bind-sync', 'bind-local'].find(n => a.hasAttribute?.(`data-${n}`));
  const keep = attr ? `[data-${attr}="${a.getAttribute(`data-${attr}`)}"]` : null;
  const sel = keep ? safe(() => a.selectionStart) : null;
  const scroll = window.scrollY;
  const key = `${view}/${sub.join('/')}`;
  $('#view').innerHTML = RENDER[view](sub);
  if (key === lastView) { $('#view .view-enter')?.classList.remove('view-enter'); window.scrollTo(0, scroll); }
  else window.scrollTo(0, 0);
  if (keep) { const el = $(keep); if (el) { el.focus(); if (sel != null) safe(() => el.setSelectionRange(sel, sel)); } }
  lastView = key;
  const s = stats();
  const jb = intel.badge();
  const nav = VIEWS.map(([k, l]) => `<a href="#${k}" ${k === view ? 'aria-current="page"' : ''}>${icon(k)}<span>${l}</span>${k === 'practice' && s.due.length ? `<span class="badge">${s.due.length}</span>` : k === 'jobs' && jb ? `<span class="badge">${jb}</span>` : ''}</a>${k === 'jobs' ? '<div class="gap"></div>' : ''}`).join('');
  $('#nav').innerHTML = nav + `<a href="#settings" ${view === 'settings' ? 'aria-current="page"' : ''}>${icon('settings')}<span>Settings</span></a>`;
  const inMore = ['plan', 'library', 'progress', 'settings', 'more'].includes(view);
  $('#tabs').innerHTML = TABS.map(([k, l]) => `<a href="#${k}" ${k === view || (k === 'more' && inMore) ? 'aria-current="page"' : ''}>${icon(k)}<span>${l}</span></a>`).join('');
  $('#topTitle').textContent = TITLES[view];
  $('#who').textContent = S.name ? `${S.name}'s 90-day coach` : '90-day coach';
  $('#syncState').innerHTML = sync.repo && sync.token ? `Synced to <b>${esc(sync.repo)}</b>${sync.last ? ` · ${timeAgo(sync.last)}` : ''}` : 'Local only · set up sync in Settings';
  document.title = `${TITLES[view]} · Apex`;
  $('#themeBtn') && ($('#themeBtn').textContent = `Theme: ${{ system: 'System', light: 'Light', dark: 'Dark' }[local.theme]}`);
}
const timeAgo = ms => { const m = Math.round((now() - ms) / 6e4); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`; };
function clock(rec) {
  const sec = (rec.timer || 0) + (local.timerStart ? Math.floor((now() - local.timerStart) / 1000) : 0);
  return `${pad(Math.floor(sec / 60))}:${pad(sec % 60)}`;
}
let toastT;
function toast(msg) { const el = $('#toast'); el.textContent = msg; el.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('show'), 2600); }

/* ---------- actions ---------- */
function day(patch) {
  const t = today(), r = S.days[t] || { created: t };
  S.days[t] = { ...r, ...patch, u: now() };
}
function stopTimer() {
  if (!local.timerStart) return;
  const t = today(), add = Math.floor((now() - local.timerStart) / 1000);
  day({ timer: (S.days[t]?.timer || 0) + add });
  local.timerStart = 0; saveLocal();
}
const ACTIONS = {
  block: k => { const r = S.days[today()] || {}; day({ mode: defaultMode(r), blocks: { ...(r.blocks || {}), [k]: !r.blocks?.[k] } }); save(); },
  mode: k => { day({ mode: k }); save(); },
  energy: n => { day({ energy: Number(n) }); save(); },
  timer: () => { if (local.timerStart) stopTimer(); else { local.timerStart = now(); saveLocal(); } save(); },
  task: id => { put('tasks', id, { done: !S.tasks[id]?.done }); save(); },
  perk: id => { put('perks', id, { claimed: !S.perks[id]?.claimed }); save(); },
  solve: id => { solve(id); save(); toast('Solved. Re-solve scheduled in 3 days.'); },
  review: (id, ok) => { review(id, ok === '1'); save(); toast(ok === '1' ? 'Passed. Next re-solve scheduled.' : 'Logged as failed. Back tomorrow; add an Anki card.'); },
  unsolve: id => { if (confirm('Reset this problem to not started?')) { put('dsa', id, { solved: null, next: null, step: 0 }); save(); } },
  filter: k => { local.filter = k; saveLocal(); render(); },
  libtab: k => { local.libTab = k; saveLocal(); render(); },
  lib: id => { const order = ['todo', 'doing', 'done'], cur = S.libStatus[id]?.s || 'todo'; put('libStatus', id, { s: order[(order.indexOf(cur) + 1) % 3] }); save(); },
  libdel: id => { put('lib', id, { deleted: true }); save(); },
  notedel: id => { put('notes', id, { deleted: true }); save(); },
  save: i => { const it = FEED.items[i]; put('lib', uid(), { title: it.title, url: it.url, kind: 'paper', tags: [it.source], week: 0 }); save(); toast('Saved to your library.'); },
  mentor: () => {
    const s = stats(), ses = session(), r = S.days[addDays(today(), -1)];
    const line = `Week ${ses.pos.week}, Day ${ses.pos.day}, ${MODES[S.days[today()]?.mode || 'full'].minutes} min, energy ${S.days[today()]?.energy || '?'}. Yesterday: ${r?.note || 'not logged'}. Streak ${s.streak}, consistency ${s.score ?? '–'}%. Planned main block: ${ses.main}. Re-solves due: ${s.due.map(p => p.name).join(', ') || 'none'}. Blockers: none. Give me today's session in the master-prompt format.`;
    safe(() => navigator.clipboard.writeText(line));
    window.open(`https://claude.ai/new?q=${encodeURIComponent(line)}`, '_blank', 'noopener');
    toast('Check-in copied and opened in Claude.');
  },
  export: () => download(`apex-${today()}.json`, JSON.stringify(S, null, 2), 'application/json'),
  reset: () => { if (confirm('Erase all Apex data on this device? Synced data on GitHub stays.')) { localStorage.removeItem(KEY); location.reload(); } },
  ics: () => {
    const [h, m] = (S.reminder || '07:30').split(':');
    const st = today().replace(/-/g, '') + `T${h}${m}00`;
    const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Apex//Coach//EN', 'BEGIN:VEVENT', `UID:apex-daily-${st}@apex`, `DTSTAMP:${st}`, `DTSTART:${st}`, 'DURATION:PT90M', 'RRULE:FREQ=DAILY;COUNT=91', 'SUMMARY:Apex: 90-minute session', `DESCRIPTION:Open ${location.origin}${location.pathname} and start the focus timer.`, 'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:Apex session', 'TRIGGER:PT0M', 'END:VALARM', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
    download('apex-daily.ics', ics, 'text/calendar');
  },
  ntfytest: async () => {
    if (!local.ntfy) return toast('Enter a topic first.');
    const ok = await fetch(`https://ntfy.sh/${encodeURIComponent(local.ntfy)}`, { method: 'POST', body: 'Apex test: notifications reach this phone.' }).then(r => r.ok).catch(() => false);
    toast(ok ? 'Test sent. Check the ntfy app.' : 'Could not reach ntfy.sh.');
  },
  notify: async () => { if (!('Notification' in window)) return toast('This browser has no notifications.'); const p = await Notification.requestPermission(); toast(p === 'granted' ? 'In-app alerts on.' : 'Notifications were blocked.'); render(); },
  syncnow: () => pull(true),
  theme: t => { local.theme = t || { system: 'light', light: 'dark', dark: 'system' }[local.theme]; saveLocal(); applyTheme(); render(); },
};
function download(name, text, type) { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); }

document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]'); if (!el) return;
  const [name, ...args] = el.dataset.act.split(':');
  if (name === 'intel') return intel.actions[args[0]]?.(...args.slice(1));
  ACTIONS[name]?.(...args);
});
let typeT;
document.addEventListener('input', e => {
  const el = e.target, d = el.dataset;
  if (el.tagName !== 'SELECT' && intel.onInput(el)) return;
  if (d.bind) { day({ [d.bind]: el.value }); clearTimeout(typeT); typeT = setTimeout(() => save(true), 400); }
  else if (d.bindS) { S[d.bindS] = el.value; clearTimeout(typeT); typeT = setTimeout(() => save(true), 400); }
  else if (d.bindSync) { sync[d.bindSync] = el.value.trim(); saveSync(); }
  else if (d.bindLocal) { local[d.bindLocal] = el.value; saveLocal(); if (d.bindLocal === 'q') render(); }
  else if (d.cost) { put('skills', d.cost, { cost: el.value }); clearTimeout(typeT); typeT = setTimeout(() => save(true), 400); }
});
document.addEventListener('change', e => {
  const el = e.target, d = el.dataset;
  if (el.tagName === 'SELECT' && (d.ex || d.jf || d.prof) && intel.onInput(el)) return;
  if (intel.onChange(el)) return;
  if (d.bindS || d.bind || d.cost) save();
  if (d.bindSync) render();
  if (d.pr) { put('prs', d.pr, { status: el.value, merged: el.value === 'merged' ? today() : null }); save(); }
  if (d.skill) { const month = today().slice(0, 7), r = S.skills[d.skill] || {}; put('skills', d.skill, { status: el.value, month: el.value !== 'planned' ? (r.month || month) : null, earned: el.value === 'earned' ? today() : null }); save(); }
  if (el.matches('[data-import]') && el.files[0]) el.files[0].text().then(txt => { const inc = safe(() => JSON.parse(txt)); if (!inc) return toast('That file is not Apex data.'); S = merge(S, inc); save(); toast('Imported and merged.'); });
});
document.addEventListener('submit', e => {
  const f = e.target.closest('[data-form]'); if (!f) return;
  e.preventDefault();
  const v = Object.fromEntries(new FormData(f));
  if (intel.onSubmit(f.dataset.form, v)) { f.reset?.(); return; }
  if (f.dataset.form === 'pr') { put('prs', uid(), { repo: v.repo, title: v.title, url: v.url, status: 'opened', opened: today() }); toast('PR logged. Move it to merged when it lands.'); }
  if (f.dataset.form === 'lib') put('lib', uid(), { title: v.title, url: v.url, kind: v.kind, tags: (v.tags || '').split(',').map(x => x.trim()).filter(Boolean), week: 0 });
  if (f.dataset.form === 'note') put('notes', uid(), { title: v.title, url: v.url, note: v.note, d: today() });
  save();
});
window.addEventListener('hashchange', render);

/* ---------- GitHub sync: data/tracker.json in your repo ---------- */
const b64e = s => btoa(String.fromCharCode(...new TextEncoder().encode(s)));
const b64d = s => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/\n/g, '')), c => c.charCodeAt(0)));
const api = (path, opt = {}) => fetch(`https://api.github.com/repos/${sync.repo}/contents/${path}`, { ...opt, headers: { Authorization: `Bearer ${sync.token}`, Accept: 'application/vnd.github+json', ...(opt.headers || {}) } });
let pushT, busy = false;
function schedulePush() { if (!sync.repo || !sync.token) return; clearTimeout(pushT); pushT = setTimeout(() => push(), 4000); }
async function pull(loud) {
  if (!sync.repo || !sync.token || busy) return;
  busy = true;
  try {
    const r = await api(`${sync.path}?ref=${encodeURIComponent(sync.branch)}`);
    if (r.status === 404) { sync.sha = ''; busy = false; return push(loud); }
    if (!r.ok) throw new Error(`GitHub said ${r.status}`);
    const j = await r.json(); sync.sha = j.sha;
    const remote = safe(() => JSON.parse(b64d(j.content)));
    if (remote) { const before = JSON.stringify(S); S = merge(S, remote); if (JSON.stringify(S) !== before) safe(() => localStorage.setItem(KEY, JSON.stringify(S))); }
    sync.last = now(); saveSync(); busy = false;
    if ((remote?.u || 0) < S.u) await push(loud); else if (loud) toast('Synced.');
    render();
  } catch (err) { busy = false; if (loud) toast(`Sync failed: ${err.message}`); }
}
async function push(loud) {
  if (busy) return; busy = true;
  try {
    const body = { message: `log: ${today()}`, content: b64e(JSON.stringify(S, null, 1)), branch: sync.branch, ...(sync.sha ? { sha: sync.sha } : {}) };
    const r = await api(sync.path, { method: 'PUT', body: JSON.stringify(body) });
    if (r.status === 409 || r.status === 422) { busy = false; return pull(loud); }
    if (!r.ok) throw new Error(`GitHub said ${r.status}`);
    sync.sha = (await r.json()).content.sha; sync.last = now(); saveSync();
    if (loud) toast('Synced.');
    $('#syncState').innerHTML = `Synced to <b>${esc(sync.repo)}</b> · just now`;
  } catch (err) { if (loud) toast(`Sync failed: ${err.message}`); }
  busy = false;
}

/* ---------- boot ---------- */
async function boot() {
  // A visitor with no local data sees the published log read-only; your own device keeps editing.
  if (!S.u) { const pub = await fetch('data/tracker.json', { cache: 'no-store' }).then(r => r.ok ? r.json() : null).catch(() => null); if (pub?.u) { S = merge(blank(), pub); } }
  FEED = await fetch('api/v1/feed.json', { cache: 'no-cache' }).then(r => r.ok ? r.json() : {}).then(f => ({ updated: (f.generated_at || '').slice(0, 10), items: (f.items || []).map(a => ({ title: a.title, url: a.url, source: a.source_name, date: (a.published_at || '').slice(0, 10) })) })).catch(() => ({}));
  intel.warm();
  render();
  pull(false);
  setInterval(() => { const c = $('#clock'); if (c && local.timerStart) c.textContent = clock(S.days[today()] || {}); }, 1000);
  // Evening nudge while the app is open.
  setTimeout(() => {
    if ('Notification' in window && Notification.permission === 'granted' && new Date().getHours() >= 20 && !status(S.days[today()])) {
      navigator.serviceWorker?.ready.then(r => r.showNotification('Apex', { body: 'Today is still empty. Ten minutes keeps the streak.', icon: 'icon-192.png', tag: 'apex-evening' })).catch(() => {});
    }
  }, 3000);
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
  document.addEventListener('visibilitychange', () => { if (document.hidden) { if (local.timerStart) { stopTimer(); local.timerStart = now(); saveLocal(); save(true); } push(); } else pull(false); });
}
boot();
