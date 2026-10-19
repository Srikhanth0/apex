import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { matchJob, profileReady, findSkills, yearsFromText, personalize, buildIndex, search, diversify } from '../match.js';

const vocab = JSON.parse(readFileSync(new URL('../sources/skills.json', import.meta.url))).skills;
const job = { title: 'Machine Learning Engineer', company: 'Acme', location: 'Remote - India', work_mode: 'remote', employment_type: 'full-time',
  required_skills: ['Python', 'PyTorch', 'RAG', 'Docker'], preferred_skills: ['Kubernetes'], experience_min_years: 2, salary_min: 2000000, salary_max: 3000000, salary_currency: 'INR' };
const me = { skills: ['Python', 'PyTorch', 'RAG', 'FastAPI'], targetRoles: ['ML engineer', 'Machine learning engineer'], years: 2, remote: 'remote', locations: ['India'], employmentTypes: ['full-time'], salaryMin: 2500000, currency: 'INR' };

test('no score without enough profile data', () => {
  const m = matchJob(job, {});
  assert.equal(m.score, null); assert.equal(m.sufficient, false); assert.ok(m.unknown.length >= 2);
  assert.equal(profileReady({ skills: ['Python'] }), false);
});
test('full profile gives a transparent breakdown that adds up', () => {
  const m = matchJob(job, me);
  assert.ok(m.score >= 75 && m.score <= 100, `score ${m.score}`);
  assert.deepEqual(m.matched, ['Python', 'PyTorch', 'RAG']); assert.deepEqual(m.missing, ['Docker']);
  const pts = m.parts.reduce((t, p) => t + p.points, 0), max = m.parts.reduce((t, p) => t + p.max, 0);
  assert.equal(m.score, Math.round(100 * pts / max)); assert.equal(m.dealBreakers.length, 0);
});
test('remote-only profile flags an onsite job as a deal-breaker', () => {
  const m = matchJob({ ...job, work_mode: 'onsite', location: 'San Francisco' }, me);
  assert.ok(m.dealBreakers.some(d => d.startsWith('Not remote')));
});
test('big experience gap and visa wording are flagged, never hidden', () => {
  const m = matchJob({ ...job, experience_min_years: 8, description: 'We are unable to sponsor visas for this role.' }, { ...me, needsSponsorship: 'yes' });
  assert.ok(m.dealBreakers.some(d => d.includes('8+ years'))); assert.ok(m.dealBreakers.some(d => d.includes('sponsor')));
});
test('salary in another currency is left out, not guessed', () => {
  const m = matchJob({ ...job, salary_currency: 'USD', salary_max: 150000 }, me);
  assert.ok(!m.parts.some(p => p.key === 'salary')); assert.ok(m.unknown.some(u => u.startsWith('Salary')));
});
test('listing with no recognised skills still gets judged on the rest', () => {
  const m = matchJob({ ...job, required_skills: [], preferred_skills: [] }, me);
  assert.ok(m.score != null); assert.ok(m.unknown.some(u => u.startsWith('Required skills')));
});
test('CV parsing finds skills and years without false positives', () => {
  const s = findSkills('5 years of experience building RAG pipelines in Python with PyTorch; I go to the gym and react quickly.', vocab);
  assert.ok(s.includes('Python') && s.includes('PyTorch') && s.includes('RAG')); assert.ok(!s.includes('Go') && !s.includes('React'));
  assert.equal(yearsFromText('5 years of experience, 2 years of professional experience'), 5);
});
test('personalize hides dismissed and known, boosts interests', () => {
  const items = [{ id: 'a', score: 0.5, topics: ['health'], source_id: 's1' }, { id: 'b', score: 0.45, topics: ['llm-engineering'], source_id: 's2' }, { id: 'c', score: 0.9, topics: ['x'], source_id: 's3' }];
  const { items: out, personalized } = personalize(items, { interests: ['llm-engineering'], reads: { c: { feedback: 'dismissed' } } });
  assert.deepEqual(out.map(x => x.id), ['b', 'a']); assert.equal(personalized, true);
  assert.equal(personalize(items, {}).personalized, false);
});
test('search matches all words, ranks titles higher and supports prefixes', () => {
  const docs = [{ title: 'Evaluating RAG systems', summary: 'evals for retrieval' }, { title: 'Cooking pasta', summary: 'rag doll' }, { title: 'Agents and tools', summary: 'retrieval evaluation' }];
  const idx = buildIndex(docs, [['title', 3], ['summary', 1]]);
  assert.equal(search(idx, 'rag')[0].title, 'Evaluating RAG systems');
  assert.deepEqual(search(idx, 'retrieval eval').map(d => d.title).sort(), ['Agents and tools', 'Evaluating RAG systems']);
  assert.equal(search(idx, '').length, 0);
});
test('diversify caps one source', () => {
  const xs = [1, 2, 3, 4].map(i => ({ id: i, source_id: 'a', topics: ['t' + i] })).concat([{ id: 9, source_id: 'b', topics: ['z'] }]);
  assert.deepEqual(diversify(xs, 3, 2).map(x => x.id), [1, 2, 9]);
});

test('one listed skill and a generic title word cannot produce a high score', () => {
  const m = matchJob({ title: 'IT Systems Engineer, M&A', location: 'Boston', work_mode: 'remote', required_skills: ['Python'] }, { ...me, targetRoles: ['Software engineer'] });
  assert.ok(m.parts.find(p => p.key === 'required').max < 15);
  assert.equal(m.parts.find(p => p.key === 'role').points, 0);
  assert.ok(m.score < 75, `score ${m.score}`);
});
