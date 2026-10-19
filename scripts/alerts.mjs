// Job alerts: after each ingest, push newly discovered strong matches to your phone via ntfy.
// Uses the same match.js as the app. Reads only the opt-in alert profile you sync from Settings
// (skills, roles, work mode, places, years; never salary or visa details).
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { matchJob, profileReady } from '../match.js';

const read = p => readFile(p, 'utf8').then(JSON.parse).catch(() => null);
const S = await read('data/tracker.json');
const jobs = (await read('api/v1/jobs/index.json'))?.items || [];
const alerted = new Set((await read('data/store/alerted.json')) || []);
const cfg = S?.settings?.alerts || {};
const profile = S?.settings?.alertProfile;

if (!cfg.enabled || !profileReady(profile)) {
  console.log('alerts off or alert profile incomplete; nothing sent');
} else {
  const since = Date.now() - 36 * 3600e3;
  const minScore = Number(cfg.minScore || 70), companies = (cfg.companies || []).map(c => c.toLowerCase());
  const fresh = jobs.filter(j => !alerted.has(j.id) && Date.parse(j.first_seen_at || 0) >= since);
  const hits = fresh.map(j => ({ j, m: matchJob(j, profile) }))
    .filter(({ j, m }) => (m.score != null && m.score >= minScore && !m.dealBreakers.length && (!cfg.remoteOnly || j.work_mode === 'remote')) || companies.includes((j.company || '').toLowerCase()))
    .sort((a, b) => (b.m.score ?? 0) - (a.m.score ?? 0));
  if (hits.length && process.env.NTFY_TOPIC) {
    const body = hits.slice(0, 5).map(({ j, m }) => `${m.score ?? '–'} · ${j.title} at ${j.company}${j.work_mode ? ` (${j.work_mode})` : ''}`).join('\n') + (hits.length > 5 ? `\n+${hits.length - 5} more` : '');
    const r = await fetch(`https://ntfy.sh/${encodeURIComponent(process.env.NTFY_TOPIC)}`, { method: 'POST', body, headers: { Title: `${hits.length} new job match${hits.length > 1 ? 'es' : ''}`, Tags: 'briefcase', Click: `${process.env.SITE_URL || ''}#jobs` } }).catch(() => null);
    console.log('ntfy', r?.status, hits.length);
  } else console.log('job alerts:', hits.length, 'matches', process.env.NTFY_TOPIC ? '' : '(no NTFY_TOPIC)');
  for (const { j } of hits) alerted.add(j.id); // never alert the same listing twice
  await mkdir('data/store', { recursive: true });
  await writeFile('data/store/alerted.json', JSON.stringify([...alerted].slice(-5000)));
}
