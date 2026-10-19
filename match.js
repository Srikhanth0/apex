// Shared by the browser and Node (alerts + tests). No DOM, no dependencies.

/* ---------- job matching ---------- */
// Points per factor. A factor without data on either side is left out and the score is taken over the
// factors that remain; with less than half the points knowable, no score is given at all.
export const MATCH_WEIGHTS = { required: 35, role: 20, experience: 15, location: 12, preferred: 10, employment: 4, salary: 4 };
const SENIOR = /\b(senior|sr|staff|principal|lead|head|director|manager)\b/;
const NO_SPONSOR = /\b(no|not able to|unable to|cannot|can't|will not|won't) (provide |offer )?(visa )?sponsor|must (already )?(be|have) (legally )?authori[sz]ed|without (the need for )?sponsorship/i;
const words = s => (s || '').toLowerCase().replace(/[^a-z0-9+#]+/g, ' ').trim().split(' ').filter(w => w && !['and', 'of', 'the', 'i', 'ii', 'iii', 'iv', 'sr', 'jr', 'senior', 'junior', 'staff', 'principal', 'lead'].includes(w));
const canon = s => (s || '').toLowerCase().trim();
// Words that appear in most tech titles; they cannot make a role match on their own.
const GENERIC = new Set(['engineer', 'engineering', 'developer', 'specialist', 'associate', 'member', 'technical', 'team', 'analyst', 'intern', 'manager']);

export function profileReady(p) {
  return !!(p && ((p.skills || []).length >= 3) && ((p.targetRoles || []).length >= 1));
}

export function matchJob(job, p = {}) {
  const parts = [], matched = [], missing = [], unknown = [], dealBreakers = [], notes = [];
  const have = new Set((p.skills || []).map(canon));
  const add = (key, label, points, detail, max = MATCH_WEIGHTS[key]) => parts.push({ key, label, points: Math.round(points * 10) / 10, max: Math.round(max * 10) / 10, detail });
  const skip = (label, why) => unknown.push(`${label}: ${why}`);

  // Required skills
  const req = job.required_skills || [];
  if (!req.length) skip('Required skills', 'the listing names none we recognise');
  else if (!have.size) skip('Required skills', 'your profile has no skills yet');
  else {
    req.forEach(s => (have.has(canon(s)) ? matched : missing).push(s));
    // A listing that names only one or two skills tells us little: it can earn at most n/3 of this factor.
    const max = MATCH_WEIGHTS.required * Math.min(1, req.length / 3);
    add('required', 'Required skills', max * (matched.length / req.length), `${matched.length} of ${req.length} listed`, max);
  }
  // Preferred skills
  const pref = job.preferred_skills || [];
  const prefHit = pref.filter(s => have.has(canon(s)));
  if (pref.length && have.size) { const max = MATCH_WEIGHTS.preferred * Math.min(1, pref.length / 2); add('preferred', 'Nice-to-have skills', max * (prefHit.length / pref.length), `${prefHit.length} of ${pref.length}`, max); }
  // Role alignment
  const core = w => { const c = w.filter(x => !GENERIC.has(x)); return c.length ? c : w; };
  const targets = (p.targetRoles || []).map(words).map(core).filter(w => w.length);
  if (!targets.length) skip('Role', 'no target roles in your profile');
  else {
    const t = new Set(words(job.title));
    const best = Math.max(...targets.map(tw => tw.filter(w => t.has(w)).length / tw.length));
    add('role', 'Role fit', MATCH_WEIGHTS.role * (best >= 1 ? 1 : best >= 0.5 ? 0.6 : best > 0 ? 0.3 : 0), best >= 1 ? 'title matches a target role' : best > 0 ? 'partly matches a target role' : 'not one of your target roles');
  }
  // Experience
  const need = job.experience_min_years, yrs = p.years === '' || p.years == null ? null : Number(p.years);
  if (need == null) skip('Experience', 'the listing states no years');
  else if (yrs == null) skip('Experience', 'your profile has no years of experience');
  else {
    const gap = need - yrs;
    add('experience', 'Experience', MATCH_WEIGHTS.experience * (gap <= 0 ? 1 : gap <= 1 ? 0.5 : 0), `asks ${need}+ years, you have ${yrs}`);
    if (gap >= 3) dealBreakers.push(`Asks for ${need}+ years; you have ${yrs}`);
  }
  if (yrs != null && yrs < 3 && SENIOR.test((job.title || '').toLowerCase())) notes.push('Senior-level title for your experience; apply only with strong evidence');
  // Location and work mode
  const pm = p.remote || 'any', locs = (p.locations || []).map(canon).filter(Boolean), jl = canon(job.location);
  if (!job.work_mode && !jl) skip('Location', 'the listing gives no location or work mode');
  else {
    const inPlace = locs.some(l => jl.includes(l));
    let pts = 0, detail;
    if (job.work_mode === 'remote') { pts = pm === 'onsite' ? 0.5 : 1; detail = `remote${job.location ? ` (${job.location})` : ''}`; if (/\b(us|usa|united states|eu|europe|uk)\b only|\bmust (live|reside) in\b/i.test(job.location || '')) notes.push(`Remote but limited to: ${job.location}`); }
    else if (inPlace) { pts = pm === 'remote' ? 0.5 : 1; detail = `${job.work_mode || 'location'} in ${job.location}, one of your places`; }
    else { pts = 0; detail = `${job.work_mode || 'based'} in ${job.location || 'an unlisted place'}`; if (pm === 'remote') dealBreakers.push(`Not remote: ${job.location || job.work_mode}`); }
    if (!locs.length && job.work_mode !== 'remote') { skip('Location', 'no preferred locations in your profile'); }
    else add('location', 'Location and work mode', MATCH_WEIGHTS.location * pts, detail);
  }
  // Employment type
  const types = p.employmentTypes || [];
  if (job.employment_type && types.length) add('employment', 'Employment type', types.includes(job.employment_type) ? MATCH_WEIGHTS.employment : 0, job.employment_type);
  // Salary, only when both sides are disclosed in the same currency
  if (p.salaryMin && (job.salary_max || job.salary_min)) {
    if (p.currency && job.salary_currency && canon(p.currency) !== canon(job.salary_currency)) skip('Salary', `listing is in ${job.salary_currency}, yours in ${p.currency}`);
    else {
      const top = job.salary_max || job.salary_min, ok = top >= Number(p.salaryMin);
      add('salary', 'Salary', ok ? MATCH_WEIGHTS.salary : 0, `up to ${top.toLocaleString()} ${job.salary_currency || ''}`.trim());
      if (!ok) dealBreakers.push(`Top of range ${top.toLocaleString()} is under your minimum`);
    }
  }
  if (p.needsSponsorship && NO_SPONSOR.test(job.description || '')) dealBreakers.push('The listing says it does not sponsor visas');

  const max = parts.reduce((t, x) => t + x.max, 0), got = parts.reduce((t, x) => t + x.points, 0);
  const sufficient = max >= 50;
  return {
    score: sufficient ? Math.round((100 * got) / max) : null, sufficient, coverage: max, parts, matched, missing,
    preferredMatched: prefHit, unknown, dealBreakers, notes,
  };
}

/* ---------- skills from text (resume or profile) ---------- */
export function findSkills(text, vocab) {
  const low = ` ${(text || '').toLowerCase()} `;
  const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return vocab.filter(s => (s.aliases.length ? s.aliases : [s.name]).some(a => a.trim() && new RegExp(`(?<![a-z0-9+#])${esc(a.trim().toLowerCase())}(?![a-z0-9+#])`).test(low))).map(s => s.name);
}
export function yearsFromText(text) {
  const m = [...(text || '').matchAll(/(\d{1,2})\s*\+?\s*years?\s+(of\s+)?(professional\s+|industry\s+|work\s+)?experience/gi)].map(x => Number(x[1])).filter(n => n > 0 && n < 40);
  return m.length ? Math.max(...m) : null;
}

/* ---------- article personalisation ---------- */
// Base score comes from the pipeline. On the device it is adjusted by your interests and feedback:
// +0.12 per matching interest topic (max 2), learned topic weights from useful / not useful, and
// hidden when dismissed, already known or read.
export function topicWeights(reads) {
  const w = {};
  for (const r of Object.values(reads || {})) {
    const d = r.feedback === 'useful' || r.saved ? 1 : r.feedback === 'not-useful' ? -1 : r.feedback === 'dismissed' ? -0.5 : 0;
    if (!d) continue;
    (r.topics || []).forEach((t, i) => { w[t] = (w[t] || 0) + d * (i === 0 ? 1 : 0.5); });
  }
  return w;
}
export function personalize(items, { interests = [], reads = {}, maxMinutes = 0, hideRead = true } = {}) {
  const tw = topicWeights(reads), personal = interests.length > 0 || Object.keys(tw).length > 0;
  const out = [];
  for (const a of items) {
    const r = reads[a.id];
    if (r && (r.feedback === 'dismissed' || r.feedback === 'known' || (hideRead && r.status === 'read'))) continue;
    const topics = a.topics || [];
    let s = a.score || 0;
    s += 0.12 * Math.min(2, topics.filter(t => interests.includes(t)).length);
    s += topics.reduce((t, x) => t + Math.max(-0.3, Math.min(0.3, (tw[x] || 0) * 0.05)), 0);
    if (maxMinutes && a.reading_minutes && a.reading_minutes > maxMinutes) s -= 0.1;
    out.push({ ...a, personal_score: Math.round(s * 1000) / 1000 });
  }
  out.sort((x, y) => y.personal_score - x.personal_score);
  return { items: out, personalized: personal };
}
export function diversify(items, n, perSource = 2, perTopic = 3) {
  const out = [], src = {}, top = {};
  for (const it of items) {
    const t = (it.topics || ['other'])[0];
    if ((src[it.source_id] || 0) >= perSource || (top[t] || 0) >= perTopic) continue;
    out.push(it); src[it.source_id] = (src[it.source_id] || 0) + 1; top[t] = (top[t] || 0) + 1;
    if (out.length >= n) return out;
  }
  for (const it of items) { if (!out.includes(it)) out.push(it); if (out.length >= n) break; }
  return out;
}

/* ---------- search: a small BM25 index with prefix matching ---------- */
const STOP = new Set('a an and are as at be by for from has have how in is it of on or that the this to was what when where which who why with you your'.split(' '));
export const tokens = s => (s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9+#.]+/g, ' ').split(' ').map(w => w.replace(/^\.+|\.+$/g, '')).filter(w => w.length > 1 && !STOP.has(w));
export function buildIndex(docs, fields) {
  const postings = new Map(), lens = [];
  docs.forEach((d, i) => {
    let len = 0;
    for (const [f, boost] of fields) {
      const v = Array.isArray(d[f]) ? d[f].join(' ') : d[f];
      for (const t of tokens(v)) { len++; const m = postings.get(t) || new Map(); m.set(i, (m.get(i) || 0) + boost); postings.set(t, m); }
    }
    lens.push(len || 1);
  });
  return { docs, postings, lens, avg: lens.reduce((a, b) => a + b, 0) / (lens.length || 1), terms: [...postings.keys()] };
}
export function search(index, q, limit = 50) {
  const qt = tokens(q);
  if (!qt.length) return [];
  const N = index.docs.length, scores = new Map();
  qt.forEach((t, qi) => {
    const last = qi === qt.length - 1;
    const terms = index.postings.has(t) ? [t] : last && t.length >= 2 ? index.terms.filter(x => x.startsWith(t)).slice(0, 30) : [];
    for (const term of terms) {
      const post = index.postings.get(term), idf = Math.log(1 + (N - post.size + 0.5) / (post.size + 0.5));
      for (const [i, tf] of post) {
        const s = idf * ((tf * 2.2) / (tf + 1.2 * (0.25 + 0.75 * (index.lens[i] / index.avg)))) * (term === t ? 1 : 0.7);
        scores.set(i, (scores.get(i) || 0) + s);
      }
    }
  });
  // every query word must match something (AND), so results stay precise
  return [...scores.entries()]
    .filter(([i]) => qt.every((t, qi) => { const d = index.docs[i]; const hay = JSON.stringify(d).toLowerCase(); return hay.includes(t) || (qi === qt.length - 1 && hay.includes(t.slice(0, 3))); }))
    .sort((a, b) => b[1] - a[1]).slice(0, limit).map(([i, s]) => ({ ...index.docs[i], _score: s }));
}
