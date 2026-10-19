// Runs in GitHub Actions on Node 20. No dependencies, no API keys.
// 1. Reads data/tracker.json (synced from the app) and sends one ntfy push if it is useful.
// The reading feed is produced by the ingest workflow (python -m pipeline); this script only nudges.
import { readFile } from 'node:fs/promises';
import { START_DATE, DAYS, ROTATION, WEEKS, MODES, DSA } from '../data.js';

const slot = process.env.SLOT || 'morning';
const pad = n => String(n).padStart(2, '0');
const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return iso(d); };
const diff = (a, b) => Math.round((parse(a) - parse(b)) / 864e5);
const today = iso(new Date());

const S = await readFile('data/tracker.json', 'utf8').then(JSON.parse).catch(() => null);
const digest = await readFile('api/v1/digest/today.json', 'utf8').then(JSON.parse).catch(() => null);
const brief = digest?.reads?.length ? `\nBriefing: ${digest.reads.length} reads, about ${digest.total_minutes} min. Top: ${digest.reads[0].title}` : '';

function minutes(rec) {
  if (!rec) return 0;
  if (rec.minutes != null && rec.minutes !== '') return Number(rec.minutes) || 0;
  const ticked = MODES[rec.mode || 'full'].blocks.filter(([k]) => rec.blocks?.[k]).reduce((t, b) => t + b[2], 0);
  return Math.max(ticked, Math.round((rec.timer || 0) / 60));
}
const logged = d => minutes(S?.days?.[d]) >= 10;

async function nudge(title, body, tags) {
  if (!process.env.NTFY_TOPIC) return console.log('No NTFY_TOPIC secret; skipping push:', title, '-', body);
  const r = await fetch(`https://ntfy.sh/${encodeURIComponent(process.env.NTFY_TOPIC)}`, {
    method: 'POST', body,
    headers: { Title: title, Tags: tags, Click: process.env.SITE_URL || '' },
  });
  console.log('ntfy', r.status, title);
}

if (S) {
  const start = S.startDate || START_DATE, i = diff(today, start);
  const week = i < 0 ? 0 : Math.min(12, Math.floor(i / 7) + 1);
  const rot = ROTATION[(parse(today).getDay() + 6) % 7];
  const due = DSA.filter(p => S.dsa?.[p.id]?.solved && S.dsa[p.id].next && S.dsa[p.id].next <= today);
  if (i >= DAYS) {
    // Plan finished: stay quiet.
  } else if (slot === 'morning' && !logged(today)) {
    const w = WEEKS[week];
    const focus = { learn: w.learn, build: `Atlas: ${w.build}`, dsa: 'DSA: 2 new problems + 1 re-solve', oss: week >= 3 ? 'Open source: move your PR one step' : `Atlas: ${w.build}`, review: 'Deep read + weekly review' }[rot.focus];
    await nudge(`Week ${week} · ${rot.focus}`, `${focus}${due.length ? `\n${due.length} re-solve${due.length > 1 ? 's' : ''} due: ${due[0].name}` : ''}${brief}`, 'sunrise');
  } else if (slot === 'evening' && !logged(today)) {
    const missedYesterday = Object.keys(S.days || {}).length && !logged(addDays(today, -1));
    await nudge(missedYesterday ? 'Streak resets tonight' : 'Today is still empty', missedYesterday ? 'You missed yesterday. Ten minutes now keeps the streak alive.' : 'A 10-minute minimum day keeps the streak. Anki + one log line.', 'warning');
  }
}
