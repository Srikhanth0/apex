// Read (articles) and Jobs screens. Data comes from the static API in api/v1/ that the ingest workflow
// publishes; everything personal (reading status, feedback, saved jobs, applications) stays in your log,
// and the career profile stays on this device unless you opt in to alerts.
import { matchJob, profileReady, findSkills, yearsFromText, personalize, diversify, buildIndex, search } from './match.js';

export function createIntel(ctx) {
  const { esc, panel, pill, toast } = ctx;
  const S = () => ctx.S();
  const cache = new Map();
  const PROFILE_KEY = 'apex:profile';
  const safe = fn => { try { return fn(); } catch { return null; } };
  let profile = safe(() => JSON.parse(localStorage.getItem(PROFILE_KEY))) || {};
  const saveProfile = () => { safe(() => localStorage.setItem(PROFILE_KEY, JSON.stringify(profile))); syncAlertProfile(); };
  const L = ctx.local;
  L.ex = L.ex || { sort: 'relevance', since: '7', status: 'all', page: 1 };
  L.jf = L.jf || { sort: 'match', page: 1 };

  /* ---------- data ---------- */
  function data(path) {
    const hit = cache.get(path);
    if (hit && (hit.value || hit.error)) return hit;
    if (!hit) {
      cache.set(path, { loading: true });
      fetch(`${path.startsWith('sources/') ? '' : 'api/v1/'}${path}.json`, { cache: 'no-cache' })
        .then(r => r.ok ? r.json() : Promise.reject(new Error(r.status === 404 ? 'not published yet' : `HTTP ${r.status}`)))
        .then(v => cache.set(path, { value: v }), e => cache.set(path, { error: e.message }))
        .finally(() => ctx.render());
    }
    return { loading: true };
  }
  const state = (d, what) => d.loading ? `<p class="skeleton" role="status">Loading ${what}…</p>`
    : `<div class="callout warn"><span>Could not load ${what}: ${esc(d.error)}. ${d.error === 'not published yet' ? 'It appears after the first run of the ingest workflow.' : 'Check your connection and try again.'}</span><button class="btn sm" data-act="intel:retry:${esc(what)}">Try again</button></div>`;
  const safeHref = u => /^https?:\/\//i.test(u || '') ? esc(u) : '#';
  const ago = iso => { if (!iso) return null; const h = (Date.now() - Date.parse(iso)) / 36e5; return h < 1 ? 'just now' : h < 24 ? `${Math.round(h)} h ago` : h < 24 * 14 ? `${Math.round(h / 24)} d ago` : ctx.fmt(iso.slice(0, 10)); };
  const settings = k => S().settings?.[k] || {};
  const setSetting = (k, patch) => { ctx.put('settings', k, { ...settings(k), ...patch }); };
  const topicLabel = id => (data('sources/topics').value?.topics?.[id]?.label) || id;

  /* ---------- articles ---------- */
  const reads = () => S().reads || {};
  function rd(a) { return reads()[a.id] || {}; }
  function setRead(a, patch) {
    ctx.put('reads', a.id, { title: a.title, url: a.url, source: a.source_name, topics: a.topics, d: ctx.today(), ...rd(a), ...patch });
  }
  const prefs = () => ({ interests: [], digestSize: 8, maxMinutes: 25, ...settings('prefs') });
  function personal(items) {
    const p = prefs();
    return personalize(items, { interests: p.interests, reads: reads(), maxMinutes: p.maxMinutes, hideRead: false });
  }
  function dateLabel(a) {
    if (!a.published_at) return 'Date not given';
    return `${a.date_basis === 'updated' ? 'Updated ' : ''}${ago(a.published_at)}`;
  }
  function articleRow(a, { compact } = {}) {
    const r = rd(a), mins = a.reading_minutes ? `${a.reading_minutes} min` : null;
    const fb = (k, label) => `<button class="btn sm ${r.feedback === k ? 'on' : 'link'}" data-act="intel:fb:${a.id}:${k}" aria-pressed="${r.feedback === k}">${label}</button>`;
    if (compact) return `<a class="row" href="#read/a/${a.id}" style="text-decoration:none"><div class="main"><b>${esc(a.title)}</b><span>${esc(a.source_name)} · ${esc(dateLabel(a))}${mins ? ` · ${mins}` : ''}</span></div></a>`;
    return `<article class="row top-align"><div class="main"><a href="#read/a/${a.id}"><b>${esc(a.title)}</b></a>
      <span>${esc(a.source_name)} · ${esc(dateLabel(a))}${mins ? ` · ${mins}` : ''}${r.status === 'read' ? ' · read' : ''}</span>
      ${a.summary ? `<p>${esc(a.summary.length > 260 ? a.summary.slice(0, 258) + '…' : a.summary)}</p>` : ''}
      <div class="tags">${(a.topics || []).slice(0, 3).map(t => pill(topicLabel(t), 'quiet')).join('')}</div>
      <div class="foot"><button class="btn sm ${r.saved ? 'on' : 'link'}" data-act="intel:save:${a.id}" aria-pressed="${!!r.saved}">${r.saved ? 'Saved' : 'Save'}</button>${fb('useful', 'Useful')}${fb('not-useful', 'Not useful')}${fb('known', 'Known')}${fb('dismissed', 'Hide')}</div></div></article>`;
  }
  const findArticle = id => data('articles/index').value?.items?.find(a => a.id === id) || cache.get(`articles/${id}`)?.value;

  function readTabs(cur) {
    const t = [['', 'Briefing'], ['explore', 'Explore'], ['saved', 'Library'], ['sources', 'Sources']];
    return `<div class="seg subtabs" role="tablist" aria-label="Read sections">${t.map(([k, l]) => `<button role="tab" data-act="intel:go:read${k ? '/' + k : ''}" aria-pressed="${cur === k}" aria-selected="${cur === k}">${l}</button>`).join('')}</div>`;
  }

  function viewBriefing() {
    const d = data('digest/today'), idx = data('articles/index'), p = prefs();
    if (!d.value || !idx.value) return readTabs('') + state(d.value ? idx : d, 'the briefing');
    const recentIds = new Set(idx.value.items.filter(a => a.published_at && Date.now() - Date.parse(a.published_at) < 48 * 36e5).map(a => a.id));
    const pool = idx.value.items.filter(a => recentIds.has(a.id));
    const { items, personalized } = personal(pool.length >= p.digestSize ? pool : idx.value.items.filter(a => a.published_at));
    const top = diversify(items, p.digestSize);
    const mins = top.reduce((t, a) => t + (a.reading_minutes || 0), 0), unknownMins = top.filter(a => !a.reading_minutes).length;
    const topics = data('sources/topics').value?.topics || {};
    return `${readTabs('')}
      <header class="title"><div><h1>Today's briefing</h1><p>${esc(d.value.overview)} ${top.length} picks · ${mins} min${unknownMins ? ` plus ${unknownMins} without a length` : ''} · ${personalized ? 'ranked for your interests and feedback' : 'not personalised yet: pick interests on the right'}</p></div>
      <span class="muted small">Updated ${esc(ago(d.value.generated_at) || '')}</span></header>
      <div class="grid"><section class="s8 stack">${panel('Recommended reads', `<div class="rows">${top.map(a => articleRow(a)).join('') || '<p class="empty">No recent articles yet.</p>'}</div>`, { chip: top.length, end: '<a class="more" href="#read/explore">Explore all</a>' })}</section>
      <aside class="s4 stack">
        ${panel('Act on it', d.value.action_ideas?.length ? `<div class="rows">${d.value.action_ideas.map(i => `<div class="row"><div class="main"><b>${esc(i.text)}</b><span>From <a href="#read/a/${esc(i.article_id)}">${esc(i.source)}</a></span></div></div>`).join('')}</div>` : '<p class="muted">Action ideas come from AI enrichment. Add a free Gemini key as the GEMINI_API_KEY repository secret to turn it on.</p>')}
        ${panel('Main themes', `<div class="chips">${(d.value.themes || []).map(t => `<button data-act="intel:topic:${esc(t.topic)}">${esc(t.label)} · ${t.count}</button>`).join('') || '<span class="muted">No themes yet.</span>'}</div>`)}
        ${d.value.developments?.length ? panel('Important developments', `<div class="rows">${d.value.developments.map(a => articleRow(a, { compact: true })).join('')}</div>`) : ''}
        ${panel('Your interests', `<div class="chips">${Object.entries(topics).map(([k, v]) => `<button data-act="intel:interest:${k}" aria-pressed="${p.interests.includes(k)}">${esc(v.label)}</button>`).join('')}</div>
          <div class="form" style="margin-top:14px"><label class="f">Picks per day<select data-pref="digestSize">${[5, 8, 10].map(n => `<option ${p.digestSize == n ? 'selected' : ''}>${n}</option>`).join('')}</select></label><label class="f">Longest read<select data-pref="maxMinutes">${[[10, '10 min'], [25, '25 min'], [60, '60 min'], [0, 'Any']].map(([n, l]) => `<option value="${n}" ${p.maxMinutes == n ? 'selected' : ''}>${l}</option>`).join('')}</select></label></div>`)}
      </aside></div>`;
  }

  let aIndex = null, aIndexOf = null;
  function viewExplore() {
    const idx = data('articles/index'), src = data('sources');
    if (!idx.value) return readTabs('explore') + state(idx, 'articles');
    const f = L.ex, all = idx.value.items, topics = data('sources/topics').value?.topics || {};
    if (aIndexOf !== idx.value) { aIndex = buildIndex(all, [['title', 3], ['summary', 1.5], ['description', 1], ['topics', 2], ['source_name', 1]]); aIndexOf = idx.value; }
    let list = f.q ? search(aIndex, f.q, 500) : all.slice();
    const since = Number(f.since || 0);
    list = list.filter(a => (!f.topic || (a.topics || []).includes(f.topic)) && (!f.source || a.source_id === f.source)
      && (!since || (a.published_at && Date.now() - Date.parse(a.published_at) <= since * 864e5))
      && (!Number(f.max) || (a.reading_minutes && a.reading_minutes <= Number(f.max)))
      && (f.status === 'all' || (f.status === 'unread' ? rd(a).status !== 'read' : f.status === 'saved' ? rd(a).saved : rd(a).status === 'read')));
    if (!f.q) {
      if (f.sort === 'newest') list.sort((a, b) => (b.published_at || '').localeCompare(a.published_at || ''));
      else if (f.sort === 'quality') list.sort((a, b) => (b.quality_score || 0) - (a.quality_score || 0));
      else list = personal(list).items;
    }
    const shown = list.slice(0, 20 * f.page);
    const sources = src.value?.sources || [];
    const sel = (key, opts, label) => `<select data-ex="${key}" aria-label="${label}">${opts.map(([v, l]) => `<option value="${esc(v)}" ${String(f[key] ?? '') === String(v) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
    return `${readTabs('explore')}<header class="title"><div><h1>Explore</h1><p>${all.length} articles from ${new Set(all.map(a => a.source_id)).size} sources · ${list.length} match</p></div></header>
      <div class="filters" role="search"><input class="q" type="search" data-ex="q" value="${esc(f.q || '')}" placeholder="Search titles, summaries, topics" aria-label="Search articles">
      ${sel('topic', [['', 'All topics'], ...Object.entries(topics).map(([k, v]) => [k, v.label])], 'Topic')}
      ${sel('source', [['', 'All sources'], ...sources.filter(s => s.articles).map(s => [s.id, s.name])], 'Source')}
      ${sel('since', [['1', 'Last 24 hours'], ['7', 'Last 7 days'], ['30', 'Last 30 days'], ['0', 'Any date']], 'Date')}
      ${sel('max', [['0', 'Any length'], ['5', 'Up to 5 min'], ['10', 'Up to 10 min'], ['25', 'Up to 25 min']], 'Reading time')}
      ${sel('sort', [['relevance', 'Most relevant'], ['newest', 'Newest'], ['quality', 'Highest quality']], 'Sort')}
      ${sel('status', [['all', 'All'], ['unread', 'Unread'], ['saved', 'Saved'], ['read', 'Read']], 'Reading status')}</div>
      <div class="rows">${shown.map(a => articleRow(a)).join('') || '<p class="empty">Nothing matches. Clear a filter or try another word.</p>'}</div>
      ${list.length > shown.length ? `<p style="text-align:center;margin-top:16px"><button class="btn" data-act="intel:more:ex">Show ${Math.min(20, list.length - shown.length)} more</button></p>` : ''}`;
  }

  function viewSaved() {
    const all = Object.entries(reads()).map(([id, r]) => ({ id, ...r }));
    const q = (L.libq || '').toLowerCase();
    const match = r => !q || `${r.title} ${r.source} ${r.note || ''} ${(r.topics || []).join(' ')}`.toLowerCase().includes(q);
    const saved = all.filter(r => r.saved && match(r)), hist = all.filter(r => r.status === 'read' && match(r)).sort((a, b) => (b.d || '').localeCompare(a.d || ''));
    const byTopic = {};
    saved.forEach(r => (r.topics || ['other']).slice(0, 1).forEach(t => (byTopic[t] = byTopic[t] || []).push(r)));
    const row = r => `<div class="row"><div class="main"><a href="#read/a/${esc(r.id)}"><b>${esc(r.title)}</b></a><span>${esc(r.source || '')}${r.d ? ` · ${ctx.fmt(r.d)}` : ''}${r.feedback ? ` · ${esc(r.feedback.replace('-', ' '))}` : ''}</span>${r.note ? `<p>${esc(r.note)}</p>` : ''}</div><a class="btn sm link" href="${safeHref(r.url)}" target="_blank" rel="noopener noreferrer">Original</a></div>`;
    return `${readTabs('saved')}<header class="title"><div><h1>Knowledge library</h1><p>${saved.length} saved · ${hist.length} read · notes stay with each article</p></div></header>
      <input type="search" data-bind-local="libq" value="${esc(L.libq || '')}" placeholder="Search saved articles and your notes" aria-label="Search library" style="margin-bottom:16px">
      <div class="grid"><div class="s8 stack">${Object.entries(byTopic).map(([t, rs]) => panel(esc(topicLabel(t)), `<div class="rows">${rs.map(row).join('')}</div>`, { chip: rs.length })).join('') || panel('Saved', '<p class="empty">Save articles from the briefing or Explore and they collect here by topic.</p>')}</div>
      <div class="s4">${panel('Reading history', `<div class="rows">${hist.slice(0, 15).map(row).join('') || '<p class="empty">Mark articles read from the reader.</p>'}</div>`, { chip: hist.length })}</div></div>`;
  }

  function viewArticle(id) {
    const d = data(`articles/${id}`);
    if (!d.value) return `<p><a class="more" href="#read">Back to briefing</a></p>${state(d, 'this article')}`;
    const a = d.value, r = rd(a);
    const list = (title, xs) => xs?.length ? `<h2>${title}</h2><ul>${xs.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : '';
    const method = a.method && a.method !== 'extractive' ? `AI summary (${esc(a.method)})` : 'Sentences taken from the article itself (no AI)';
    const fb = (k, label) => `<button class="btn sm ${r.feedback === k ? 'on' : ''}" data-act="intel:fb:${a.id}:${k}" aria-pressed="${r.feedback === k}">${label}</button>`;
    return `<div class="reader view-enter"><p><a class="more" href="#read">Back to briefing</a></p>
      <h1>${esc(a.title)}</h1>
      <p class="meta">${esc(a.source_name)}${a.author ? ` · ${esc(a.author)}` : ''} · ${a.published_at ? `${a.date_basis === 'updated' ? 'Updated' : 'Published'} ${esc(new Date(a.published_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }))}` : 'Publication date not given'} · ${a.reading_minutes ? `${a.reading_minutes} min read` : 'reading time unknown'}</p>
      <div class="inline" style="margin-bottom:20px"><a class="btn primary" href="${safeHref(a.url)}" target="_blank" rel="noopener noreferrer">Read the original</a>
        <div class="seg" role="group" aria-label="Reading status">${[['unread', 'Unread'], ['reading', 'Reading'], ['read', 'Read']].map(([k, l]) => `<button data-act="intel:status:${a.id}:${k}" aria-pressed="${(r.status || 'unread') === k}">${l}</button>`).join('')}</div>
        <button class="btn ${r.saved ? 'on' : ''}" data-act="intel:save:${a.id}">${r.saved ? 'Saved' : 'Save'}</button></div>
      ${a.summary ? `<p class="lead">${esc(a.summary)}</p><p class="muted small">${method}${a.extraction_complete ? '' : '. Built from the feed excerpt or part of the page; the original may say more.'}</p>` : `<p class="lead">${esc(a.description || 'No summary available.')}</p>`}
      ${a.why_useful ? `<h2>Why it may help you</h2><p>${esc(a.why_useful)}</p>` : ''}
      ${list('Key takeaways', a.takeaways)}${list('Techniques', a.techniques)}${list('Try this week', a.experiments)}${list('Worth verifying', a.verify)}
      <h2>Your feedback</h2><div class="inline">${fb('useful', 'Useful')}${fb('not-useful', 'Not useful')}${fb('known', 'Already knew this')}${fb('dismissed', 'Hide')}</div>
      <h2>Your note</h2><textarea data-note="${a.id}" rows="3" placeholder="What you'll apply, or why it matters">${esc(r.note || '')}</textarea>
      <p class="muted small" style="margin-top:20px">Full text stays on the publisher's site; this app keeps only the title, a short excerpt and the summary. Source: <a href="${safeHref(a.url)}" target="_blank" rel="noopener noreferrer">${esc(a.source_name)}</a>.</p></div>`;
  }

  /* ---------- admin: sources, runs, refresh ---------- */
  const gh = (path, opt = {}) => fetch(`https://api.github.com/repos/${ctx.sync.repo}/${path}`, { ...opt, headers: { Authorization: `Bearer ${ctx.sync.token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(opt.headers || {}) } });
  const canAdmin = () => !!(ctx.sync.repo && ctx.sync.token);
  const b64d = s => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/\n/g, '')), c => c.charCodeAt(0)));
  const b64e = s => btoa(String.fromCharCode(...new TextEncoder().encode(s)));
  async function editRegistry(file, mutate, message) {
    if (!canAdmin()) return toast('Set up GitHub sync in Settings first.');
    const r = await gh(`contents/sources/${file}?ref=${encodeURIComponent(ctx.sync.branch)}`);
    if (!r.ok) return toast(`GitHub said ${r.status}`);
    const j = await r.json(), reg = JSON.parse(b64d(j.content));
    const err = mutate(reg);
    if (err) return toast(err);
    const put = await gh(`contents/sources/${file}`, { method: 'PUT', body: JSON.stringify({ message, content: b64e(JSON.stringify(reg, null, 1) + '\n'), sha: j.sha, branch: ctx.sync.branch }) });
    toast(put.ok ? 'Saved to GitHub. The next ingest run uses it.' : `Could not save: GitHub said ${put.status}`);
    if (put.ok) { cache.delete(`sources/${file.replace('.json', '')}`); }
  }
  async function dispatch(kind, source) {
    if (!canAdmin()) return toast('Set up GitHub sync in Settings first.');
    const r = await gh('actions/workflows/ingest.yml/dispatches', { method: 'POST', body: JSON.stringify({ ref: ctx.sync.branch, inputs: { kind, source: source || '', force: 'true' }, return_run_details: true }) });
    if (r.status === 200) { const j = await r.json(); L.lastRun = { id: j.workflow_run_id, url: j.html_url, at: Date.now() }; ctx.saveLocal(); toast(`Run ${j.workflow_run_id} queued.`); }
    else if (r.status === 204) toast('Run queued. Open Actions on GitHub to follow it.');
    else toast(r.status === 403 || r.status === 404 ? 'Your token needs "Actions: read and write" on this repo.' : `GitHub said ${r.status}`);
    ctx.render();
  }
  let runInfo = null, runFetched = 0;
  function lastRunLine() {
    if (!L.lastRun) return '';
    if (canAdmin() && Date.now() - runFetched > 15000) {
      runFetched = Date.now();
      gh(`actions/runs/${L.lastRun.id}`).then(r => r.ok ? r.json() : null).then(j => { if (j) { runInfo = j; ctx.render(); } }).catch(() => {});
    }
    const st = runInfo && runInfo.id === L.lastRun.id ? `${runInfo.status}${runInfo.conclusion ? `, ${runInfo.conclusion}` : ''}` : 'queued';
    return `<div class="callout"><span>Run ${esc(L.lastRun.id)}: ${esc(st)}. The site updates a minute or two after it finishes.</span><a class="btn sm" href="${safeHref(L.lastRun.url)}" target="_blank" rel="noopener noreferrer">View on GitHub</a></div>`;
  }
  const health = s => !s.enabled ? pill('Disabled') : s.consecutive_failures ? pill(`Failing ×${s.consecutive_failures}`, 'bad') : s.last_success ? pill('Healthy', 'good') : pill('Not run yet', 'warn');
  function urlProblem(u) {
    let x; try { x = new URL(u); } catch { return 'Not a valid URL.'; }
    if (!/^https?:$/.test(x.protocol)) return 'Only http and https links.';
    if (x.username || x.password) return 'No credentials in the URL.';
    const h = x.hostname.toLowerCase();
    if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal') || /^\[|^\d+$|^(10|127|0)\.|^169\.254\.|^192\.168\.|^172\.(1[6-9]|2\d|3[01])\./.test(h)) return 'Private and local addresses are blocked.';
    return null;
  }
  function runsPanel(kind) {
    const runs = data('admin/runs');
    if (!runs.value) return panel('Recent runs', state(runs, 'run history'));
    const rows = runs.value.runs.filter(r => r.kind === kind).slice(0, 8);
    return panel('Recent runs', rows.length ? `<div class="tablewrap"><table><thead><tr><th>Finished</th><th>Trigger</th><th class="n">New</th><th class="n">Dupes</th><th class="n">Failed</th></tr></thead><tbody>${rows.map(r => `<tr><td>${esc(ago(r.finished_at) || '–')}</td><td>${esc(r.trigger || '')}</td><td class="n">${r.totals.new}</td><td class="n">${r.totals.duplicates}</td><td class="n">${r.totals.failed_sources}</td></tr>`).join('')}</tbody></table></div>` : '<p class="empty">No runs yet.</p>');
  }
  function viewSources() {
    const src = data('sources');
    const body = src.value ? `<div class="rows">${src.value.sources.map(s => `<div class="row"><div class="main"><b>${esc(s.name)}</b><span>${esc(s.type)} · every ${s.fetch_every_hours} h · trust ${s.trust}/5 · ${s.articles || 0} articles · last success ${esc(ago(s.last_success) || 'never')}${s.last_error ? ` · ${esc(s.last_error)}` : ''}</span></div>${health(s)}<div class="act"><button class="btn sm" data-act="intel:refresh:articles:${esc(s.id)}" ${canAdmin() && s.enabled ? '' : 'disabled'}>Refresh</button><button class="btn sm link" data-act="intel:toggle:articles:${esc(s.id)}" ${canAdmin() ? '' : 'disabled'}>${s.enabled ? 'Disable' : 'Enable'}</button></div></div>`).join('')}</div>` : state(src, 'sources');
    const topics = data('sources/topics').value?.topics || {};
    return `${readTabs('sources')}<header class="title"><div><h1>Article sources</h1><p>${src.value ? `${src.value.sources.filter(s => s.enabled).length} enabled · ${src.value.sources.filter(s => s.consecutive_failures).length} failing` : ''} · admin actions need your GitHub token with Contents and Actions access</p></div><button class="btn primary" data-act="intel:refresh:articles:" ${canAdmin() ? '' : 'disabled'}>Run ingest now</button></header>
      ${lastRunLine()}<div class="grid"><div class="s8">${panel('Sources and health', body)}</div><div class="s4 stack">${runsPanel('articles')}
      ${panel('Add a source', `<form class="stack" data-form="intel-source"><input type="text" name="name" placeholder="Name" required aria-label="Name"><input type="url" name="url" placeholder="Feed or page URL" required aria-label="URL"><select name="type" aria-label="Type"><option value="rss">RSS</option><option value="atom">Atom</option><option value="sitemap">Sitemap</option><option value="webpage">Web page (Scrapling)</option></select><input type="text" name="selector" placeholder="For web pages: link selector, e.g. a[href^=&quot;/blog/&quot;]::attr(href)" aria-label="Link selector"><select name="category" aria-label="Category">${Object.entries(topics).map(([k, v]) => `<option value="${k}">${esc(v.label)}</option>`).join('')}</select><div class="form"><label class="f">Trust<select name="trust">${[5, 4, 3, 2, 1].map(n => `<option ${n === 3 ? 'selected' : ''}>${n}</option>`).join('')}</select></label><label class="f">Every (hours)<input type="number" name="every" value="24" min="3" max="168"></label></div><button class="btn primary" type="submit" ${canAdmin() ? '' : 'disabled'}>Add source</button></form>`)}</div></div>`;
  }

  /* ---------- jobs ---------- */
  const apps = () => S().apps || {};
  const jobfb = () => S().jobfb || {};
  const STATUSES = [['interested', 'Interested'], ['saved', 'Saved'], ['applied', 'Applied'], ['interviewing', 'Interviewing'], ['offer', 'Offer'], ['rejected', 'Rejected'], ['withdrawn', 'Withdrawn']];
  const salary = j => j.salary_max || j.salary_min ? `${j.salary_currency || ''} ${(j.salary_min || j.salary_max).toLocaleString()}${j.salary_max && j.salary_min && j.salary_max !== j.salary_min ? `–${j.salary_max.toLocaleString()}` : ''}`.trim() : j.salary_text || null;
  const posted = j => j.published_verified && j.published_at ? `Posted ${ago(j.published_at)}` : `First seen ${ago(j.first_seen_at) || 'recently'}`;
  const scoreBox = m => m.score == null ? `<span class="score na" title="Not enough profile or listing data">n/a</span>` : `<span class="score ${m.score >= 75 ? 'hi' : m.score >= 55 ? 'mid' : ''}" title="Match score">${m.score}</span>`;
  function jobRow(j, m) {
    const a = apps()[j.id];
    return `<article class="row top-align">${scoreBox(m)}<div class="main"><a href="#jobs/j/${j.id}"><b>${esc(j.title)}</b></a>
      <span>${esc(j.company || 'Unknown company')} · ${esc(j.location || 'Location not stated')}${j.work_mode ? ` · ${esc(j.work_mode)}` : ''}${salary(j) ? ` · ${esc(salary(j))}` : ''} · ${esc(posted(j))}${j.attribution ? ` · via ${esc(j.attribution)}` : ''}${m.score != null && m.coverage < 70 ? ` · judged on ${m.coverage} of 100 points` : ''}</span>
      <div class="tags">${m.matched.slice(0, 4).map(s => pill(s, 'acc')).join('')}${m.missing.slice(0, 3).map(s => pill(`no ${s}`, 'quiet')).join('')}${m.dealBreakers.length ? pill(m.dealBreakers[0], 'warn') : ''}</div></div>
      <div class="act"><button class="btn sm ${a ? 'on' : ''}" data-act="intel:jsave:${j.id}">${a ? STATUSES.find(s => s[0] === a.status)[1] : 'Save'}</button><button class="btn sm link" data-act="intel:jdismiss:${j.id}">Dismiss</button><a class="btn sm link" href="${safeHref(j.application_url || j.url)}" target="_blank" rel="noopener noreferrer">Apply</a></div></article>`;
  }
  function jobsTabs(cur) {
    const t = [['', 'Recommended'], ['search', 'Search'], ['tracker', 'Applications'], ['profile', 'Profile'], ['sources', 'Sources']];
    return `<div class="seg subtabs" role="tablist" aria-label="Jobs sections">${t.map(([k, l]) => `<button role="tab" data-act="intel:go:jobs${k ? '/' + k : ''}" aria-pressed="${cur === k}" aria-selected="${cur === k}">${l}</button>`).join('')}</div>`;
  }
  let matchCache = { of: null, prof: '', map: new Map() };
  function matched(jobs) {
    const key = JSON.stringify(profile);
    if (matchCache.of !== jobs || matchCache.prof !== key) matchCache = { of: jobs, prof: key, map: new Map() };
    return jobs.map(j => { let m = matchCache.map.get(j.id); if (!m) { m = matchJob(j, profile); matchCache.map.set(j.id, m); } return [j, m]; });
  }
  const profileCallout = () => profileReady(profile) ? '' : `<div class="callout"><span>Add at least 3 skills and a target role to get match scores. Until then, jobs show without a score.</span><a class="btn sm" href="#jobs/profile">Set up profile</a></div>`;

  function viewRecommended() {
    const idx = data('jobs/index');
    if (!idx.value) return jobsTabs('') + state(idx, 'jobs');
    const dismissed = jobfb();
    let rows = matched(idx.value.items.filter(j => !dismissed[j.id]?.dismissed));
    const sort = L.jf.rsort || 'match';
    rows.sort(sort === 'newest' ? (a, b) => (b[0].published_at || b[0].first_seen_at || '').localeCompare(a[0].published_at || a[0].first_seen_at || '')
      : sort === 'salary' ? (a, b) => (b[0].salary_max || 0) - (a[0].salary_max || 0)
      : sort === 'company' ? (a, b) => (a[0].company || '').localeCompare(b[0].company || '')
      : (a, b) => ((b[1].score ?? -1) - (a[1].score ?? -1)) || (b[0].first_seen_at || '').localeCompare(a[0].first_seen_at || ''));
    if (L.jf.remoteOnly) rows = rows.filter(([j]) => j.work_mode === 'remote');
    if (L.jf.noBreakers) rows = rows.filter(([, m]) => !m.dealBreakers.length);
    const strong = rows.filter(([, m]) => m.score >= 75).length, shown = rows.slice(0, 25 * (L.jf.rpage || 1));
    return `${jobsTabs('')}<header class="title"><div><h1>Recommended jobs</h1><p>${idx.value.count} live listings from public ATS boards · ${profileReady(profile) ? `${strong} strong matches (75+)` : 'no profile yet'} · updated ${esc(ago(idx.value.generated_at) || '')}</p></div>
      <div class="inline"><select data-jf="rsort" aria-label="Sort">${[['match', 'Best match'], ['newest', 'Newest'], ['salary', 'Highest salary'], ['company', 'Company A–Z']].map(([v, l]) => `<option value="${v}" ${sort === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <button class="btn sm ${L.jf.remoteOnly ? 'on' : ''}" data-act="intel:jtoggle:remoteOnly" aria-pressed="${!!L.jf.remoteOnly}">Remote only</button><button class="btn sm ${L.jf.noBreakers ? 'on' : ''}" data-act="intel:jtoggle:noBreakers" aria-pressed="${!!L.jf.noBreakers}">Hide deal-breakers</button></div></header>
      ${profileCallout()}<div class="rows">${shown.map(([j, m]) => jobRow(j, m)).join('') || '<p class="empty">No listings match. Turn a toggle off.</p>'}</div>
      ${rows.length > shown.length ? `<p style="text-align:center;margin-top:16px"><button class="btn" data-act="intel:more:rjobs">Show 25 more</button></p>` : ''}`;
  }

  let jIndex = null, jIndexOf = null;
  function viewJobSearch() {
    const idx = data('jobs/index');
    if (!idx.value) return jobsTabs('search') + state(idx, 'jobs');
    const f = L.jf, all = idx.value.items;
    if (jIndexOf !== idx.value) { jIndex = buildIndex(all, [['title', 3], ['company', 2], ['required_skills', 2], ['preferred_skills', 1], ['location', 1], ['department', 1]]); jIndexOf = idx.value; }
    let list = f.q ? search(jIndex, f.q, 1000) : all.slice();
    const days = Number(f.since || 0), loc = (f.loc || '').toLowerCase();
    list = list.filter(j => (!f.company || j.company === f.company) && (!f.skill || [...(j.required_skills || []), ...(j.preferred_skills || [])].includes(f.skill))
      && (!loc || (j.location || '').toLowerCase().includes(loc)) && (!f.mode || j.work_mode === f.mode) && (!f.type || j.employment_type === f.type)
      && (!f.exp || (j.experience_min_years ?? 0) <= Number(f.exp)) && (!Number(f.salary) || (j.salary_max || j.salary_min || 0) >= Number(f.salary))
      && (!days || Date.now() - Date.parse(j.published_at || j.first_seen_at) <= days * 864e5) && (!f.saved || apps()[j.id]));
    if (!f.q) list.sort((a, b) => (b.published_at || b.first_seen_at || '').localeCompare(a.published_at || a.first_seen_at || ''));
    const rows = matched(list), shown = rows.slice(0, 25 * (f.page || 1));
    const companies = [...new Set(all.map(j => j.company).filter(Boolean))].sort();
    const skills = [...new Set(all.flatMap(j => j.required_skills || []))].sort();
    const sel = (key, opts, label) => `<select data-jf="${key}" aria-label="${label}">${opts.map(([v, l]) => `<option value="${esc(v)}" ${String(f[key] ?? '') === String(v) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
    return `${jobsTabs('search')}<header class="title"><div><h1>Search jobs</h1><p>${all.length} live listings · ${list.length} match</p></div></header>
      <div class="filters" role="search"><input class="q" type="search" data-jf="q" value="${esc(f.q || '')}" placeholder="Role, company or skill" aria-label="Search jobs">
      ${sel('company', [['', 'Any company'], ...companies.map(c => [c, c])], 'Company')}${sel('skill', [['', 'Any skill'], ...skills.map(s => [s, s])], 'Skill')}
      <input type="text" data-jf="loc" value="${esc(f.loc || '')}" placeholder="Location" aria-label="Location">
      ${sel('mode', [['', 'Any work mode'], ['remote', 'Remote'], ['hybrid', 'Hybrid'], ['onsite', 'On-site']], 'Work mode')}
      ${sel('type', [['', 'Any type'], ['full-time', 'Full-time'], ['part-time', 'Part-time'], ['contract', 'Contract'], ['internship', 'Internship']], 'Employment type')}
      ${sel('exp', [['', 'Any experience'], ['0', 'No years stated or 0'], ['2', 'Up to 2 years'], ['5', 'Up to 5 years']], 'Experience')}
      ${sel('salary', [['0', 'Any salary'], ['50000', '50k+'], ['100000', '100k+'], ['150000', '150k+'], ['200000', '200k+']], 'Minimum salary')}
      ${sel('since', [['0', 'Any time'], ['1', 'Last 24 hours'], ['7', 'Last 7 days'], ['30', 'Last 30 days']], 'Discovered')}
      <button class="btn sm ${f.saved ? 'on' : ''}" data-act="intel:jtoggle:saved" aria-pressed="${!!f.saved}">Saved only</button></div>
      <div class="rows">${shown.map(([j, m]) => jobRow(j, m)).join('') || '<p class="empty">No listings match these filters.</p>'}</div>
      ${rows.length > shown.length ? `<p style="text-align:center;margin-top:16px"><button class="btn" data-act="intel:more:jobs">Show 25 more</button></p>` : ''}`;
  }

  function viewJob(id) {
    const d = data(`jobs/${id}`);
    if (!d.value) return `<p><a class="more" href="#jobs">Back to jobs</a></p>${state(d, 'this job')}`;
    const j = d.value, m = matchJob(j, profile), a = apps()[j.id];
    const li = (xs, kind) => xs.length ? `<div class="tags">${xs.map(s => pill(s, kind)).join('')}</div>` : '<span class="muted">None</span>';
    return `<div class="reader view-enter" style="max-width:900px"><p><a class="more" href="#jobs">Back to jobs</a></p>
      <h1>${esc(j.title)}</h1><p class="meta">${esc(j.company || '')} · ${esc(j.location || 'Location not stated')}${j.work_mode ? ` · ${esc(j.work_mode)}` : ''}${j.employment_type ? ` · ${esc(j.employment_type)}` : ''}${salary(j) ? ` · ${esc(salary(j))}` : ''}</p>
      <div class="inline" style="margin-bottom:20px"><a class="btn primary" href="${safeHref(j.application_url || j.url)}" target="_blank" rel="noopener noreferrer">Apply on the employer's site</a>
        <select data-app="${j.id}" aria-label="Application status"><option value="">Track this job…</option>${STATUSES.map(([k, l]) => `<option value="${k}" ${a?.status === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
        <a class="btn sm link" href="${safeHref(j.url)}" target="_blank" rel="noopener noreferrer">Original listing</a></div>
      <div class="grid"><div class="s7">${panel(`Match ${m.score == null ? '— not enough data' : `${m.score} / 100`}`, `
        ${m.parts.length ? `<table class="breakdown"><thead><tr><th>Factor</th><th class="n">Points</th><th>Why</th></tr></thead><tbody>${m.parts.map(p => `<tr><td>${esc(p.label)}</td><td class="n">${p.points} / ${p.max}</td><td>${esc(p.detail)}</td></tr>`).join('')}</tbody></table>` : ''}
        ${m.dealBreakers.length ? `<div class="callout warn" style="margin-top:12px"><span>${m.dealBreakers.map(esc).join('<br>')}</span></div>` : ''}
        ${m.unknown.length ? `<p class="muted small" style="margin-top:12px">Left out of the score: ${m.unknown.map(esc).join('; ')}.</p>` : ''}${m.notes.map(n => `<p class="small">${esc(n)}</p>`).join('')}
        <p class="muted small">Score = points earned over points that could be judged (${m.coverage} of 100 here). ${profileReady(profile) ? '' : '<a href="#jobs/profile">Complete your profile</a> for a fuller score.'}</p>`, { cls: 'white' })}</div>
      <div class="s5 stack">${panel('Skills', `<p class="small"><b>You have</b></p>${li(m.matched, 'acc')}<p class="small"><b>Missing or not in your profile</b></p>${li(m.missing, 'quiet')}<p class="small"><b>Nice to have you have</b></p>${li(m.preferredMatched, 'acc')}`)}
        ${panel('Listing', `<p class="small">${esc(posted(j))}${j.published_verified ? '' : ' (the source gives no posting date)'} · last checked ${esc(ago(j.last_checked_at) || '')}<br>Experience asked: ${j.experience_min_years != null ? `${j.experience_min_years}+ years` : 'not stated'}${j.seniority ? ` · level: ${esc(j.seniority)}` : ''}<br>Source: ${esc(j.adapter)}${j.attribution ? `, via ${esc(j.attribution)}` : ''}${j.careers_url ? ` · <a href="${safeHref(j.careers_url)}" target="_blank" rel="noopener noreferrer">Company careers page</a>` : ''}</p>`)}</div></div>
      <h2>Description</h2>${j.description ? `<pre class="desc">${esc(j.description)}</pre>` : `<p>The description is on the <a href="${safeHref(j.url)}" target="_blank" rel="noopener noreferrer">original listing</a>.</p>`}
      <p class="muted small">This app never applies for you. Job text is scraped from the employer's public board and shown as data; it cannot change how the app behaves.</p></div>`;
  }

  function viewTracker() {
    const list = Object.entries(apps()).map(([id, a]) => ({ id, ...a })).filter(a => a.status);
    const col = (keys, title) => { const xs = list.filter(a => keys.includes(a.status)).sort((a, b) => (b.updated || '').localeCompare(a.updated || '')); return panel(title, `<div class="rows">${xs.map(a => `<div class="row top-align"><div class="main"><a href="#jobs/j/${esc(a.id)}"><b>${esc(a.title)}</b></a><span>${esc(a.company || '')} · ${ctx.fmt(a.updated || ctx.today())}</span><select data-app="${esc(a.id)}" aria-label="Status" style="margin-top:8px;height:34px">${STATUSES.map(([k, l]) => `<option value="${k}" ${a.status === k ? 'selected' : ''}>${l}</option>`).join('')}<option value="__remove">Remove</option></select></div></div>`).join('') || '<p class="empty">Nothing here.</p>'}</div>`, { chip: xs.length }); };
    const counts = Object.fromEntries(STATUSES.map(([k]) => [k, list.filter(a => a.status === k).length]));
    return `${jobsTabs('tracker')}<header class="title"><div><h1>Applications</h1><p>${list.length} tracked · ${counts.applied + counts.interviewing + counts.offer} active applications · ${counts.offer} offers</p></div></header>
      <div class="board">${col(['interested', 'saved'], 'Saved')}${col(['applied'], 'Applied')}${col(['interviewing'], 'Interviewing')}${col(['offer'], 'Offer')}</div>
      <div style="margin-top:16px">${col(['rejected', 'withdrawn'], 'Closed')}</div>`;
  }

  function syncAlertProfile() {
    if (!settings('alerts').enabled) return;
    const { skills, targetRoles, remote, locations, years, employmentTypes } = profile;
    ctx.put('settings', 'alertProfile', { skills, targetRoles, remote, locations, years, employmentTypes });
    ctx.save(true);
  }
  function viewProfile() {
    const vocab = data('sources/skills').value?.skills || [];
    const p = profile, al = settings('alerts');
    const arr = k => esc((p[k] || []).join(', '));
    const found = L.resumeFound;
    return `${jobsTabs('profile')}<header class="title"><div><h1>Career profile</h1><p>Stored only on this device. Nothing here is synced unless you turn on alerts, and then only skills, roles, work mode, places and years.</p></div></header>
      <div class="grid"><div class="s8 stack">${panel('About you', `<div class="form">
        <label class="f">Current role<input type="text" data-prof="currentRole" value="${esc(p.currentRole || '')}" placeholder="e.g. Associate software engineer"></label>
        <label class="f">Target roles<small>Comma separated</small><input type="text" data-prof-list="targetRoles" value="${arr('targetRoles')}" placeholder="AI engineer, ML engineer, backend engineer"></label>
        <label class="f">Years of experience<input type="number" min="0" max="40" data-prof="years" value="${esc(p.years ?? '')}"></label>
        <label class="f">Education<input type="text" data-prof="education" value="${esc(p.education || '')}" placeholder="Optional"></label>
        <label class="f">Preferred locations<small>Comma separated</small><input type="text" data-prof-list="locations" value="${arr('locations')}" placeholder="Bengaluru, India, Remote"></label>
        <label class="f">Work mode<select data-prof="remote">${[['any', 'Any'], ['remote', 'Remote only'], ['hybrid', 'Hybrid or remote'], ['onsite', 'On-site']].map(([v, l]) => `<option value="${v}" ${(p.remote || 'any') === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <label class="f">Minimum salary<small>Yearly, compared only when a listing shows pay in the same currency</small><div class="inline"><input type="number" data-prof="salaryMin" value="${esc(p.salaryMin ?? '')}" style="flex:2"><input type="text" data-prof="currency" value="${esc(p.currency || '')}" placeholder="INR" style="flex:1"></div></label>
        <label class="f">Industries<input type="text" data-prof-list="industries" value="${arr('industries')}" placeholder="AI, fintech, developer tools"></label>
        <label class="f wide">Employment types<div class="chips">${['full-time', 'part-time', 'contract', 'internship'].map(t => `<button data-act="intel:ptype:${t}" aria-pressed="${(p.employmentTypes || []).includes(t)}">${t}</button>`).join('')}</div></label>
        <label class="f">Needs visa sponsorship<small>Optional; used only to flag listings that say they do not sponsor</small><select data-prof="needsSponsorship"><option value="">Prefer not to say</option><option value="yes" ${p.needsSponsorship === 'yes' ? 'selected' : ''}>Yes</option><option value="no" ${p.needsSponsorship === 'no' ? 'selected' : ''}>No</option></select></label>
        <label class="f">Career goal<input type="text" data-prof="goals" value="${esc(p.goals || '')}" placeholder="One line"></label></div>`)}
        ${panel('Skills', `<div class="chips" style="margin-bottom:12px">${(p.skills || []).map(s => `<button data-act="intel:skilldel:${esc(s)}" aria-label="Remove ${esc(s)}" aria-pressed="true">${esc(s)} ×</button>`).join('') || '<span class="muted">No skills yet.</span>'}</div>
          <form class="inline" data-form="intel-skill"><input type="text" name="skill" list="skill-vocab" placeholder="Add a skill" aria-label="Add a skill" style="flex:1"><button class="btn" type="submit">Add</button></form><datalist id="skill-vocab">${vocab.map(s => `<option value="${esc(s.name)}">`).join('')}</datalist>`, { chip: (p.skills || []).length })}</div>
      <div class="s4 stack">${panel('Import from a CV', `<p class="muted small">.txt, .md or .pdf up to 2 MB. Read on this device; the text is discarded after skills are found.</p><label class="btn">Choose file<input type="file" accept=".txt,.md,.pdf,text/plain,text/markdown,application/pdf" data-resume hidden></label>
          ${found ? `<div style="margin-top:12px"><p class="small">Found ${found.skills.length} skills${found.years ? ` and ${found.years} years of experience` : ''}. Review before adding:</p><div class="chips">${found.skills.map(s => `<button data-act="intel:foundtoggle:${esc(s)}" aria-pressed="${!(found.off || []).includes(s)}">${esc(s)}</button>`).join('')}</div><div class="inline" style="margin-top:10px"><button class="btn primary sm" data-act="intel:foundadd">Add selected</button><button class="btn sm link" data-act="intel:founddrop">Discard</button></div></div>` : ''}`)}
        ${panel('Job alerts', `<p class="muted small">Pushes new strong matches to the ntfy app after each ingest run.</p><div class="stack"><button class="btn ${al.enabled ? 'on' : ''}" data-act="intel:alerts">${al.enabled ? 'Alerts on' : 'Turn on alerts'}</button>
          <label class="f">Minimum score<input type="number" min="40" max="100" data-alert="minScore" value="${esc(al.minScore ?? 70)}"></label>
          <label class="f">Always alert for these companies<input type="text" data-alert-list="companies" value="${esc((al.companies || []).join(', '))}" placeholder="Anthropic, Cohere"></label>
          <button class="btn sm ${al.remoteOnly ? 'on' : ''}" data-act="intel:alertremote">${al.remoteOnly ? 'Remote only' : 'Any work mode'}</button></div>`)}</div></div>`;
  }

  function viewJobSources() {
    const src = data('job-sources');
    const body = src.value ? `<div class="rows">${src.value.sources.map(s => `<div class="row"><div class="main"><b>${esc(s.company || s.board)}</b><span>${esc(s.adapter)} · ${esc(s.board)} · ${s.jobs} live · last success ${esc(ago(s.last_success) || 'never')}${s.last_error ? ` · ${esc(s.last_error)}` : ''}</span></div>${health(s)}<div class="act"><button class="btn sm" data-act="intel:refresh:jobs:${esc(s.id)}" ${canAdmin() && s.enabled ? '' : 'disabled'}>Refresh</button><button class="btn sm link" data-act="intel:toggle:jobs:${esc(s.id)}" ${canAdmin() ? '' : 'disabled'}>${s.enabled ? 'Disable' : 'Enable'}</button></div></div>`).join('')}</div>` : state(src, 'job sources');
    return `${jobsTabs('sources')}<header class="title"><div><h1>Job sources</h1><p>Public employer boards (Greenhouse, Ashby, Lever) and public job APIs. No logins, no LinkedIn, no CAPTCHA bypassing.</p></div><button class="btn primary" data-act="intel:refresh:jobs:" ${canAdmin() ? '' : 'disabled'}>Refresh all jobs</button></header>
      ${lastRunLine()}<div class="grid"><div class="s8">${panel('Boards and health', body)}</div><div class="s4 stack">${runsPanel('jobs')}
      ${panel('Add a company board', `<form class="stack" data-form="intel-board"><select name="adapter" aria-label="Board type"><option value="greenhouse">Greenhouse (job-boards.greenhouse.io/<b>slug</b>)</option><option value="ashby">Ashby (jobs.ashbyhq.com/<b>slug</b>)</option><option value="lever">Lever (jobs.lever.co/<b>slug</b>)</option></select><input type="text" name="board" placeholder="Board slug, e.g. anthropic" required pattern="[a-z0-9-]{2,60}" aria-label="Board slug"><input type="text" name="company" placeholder="Company name" required aria-label="Company"><button class="btn primary" type="submit" ${canAdmin() ? '' : 'disabled'}>Add board</button></form><p class="muted small">Find the slug in the company's careers page URL.</p>`)}</div></div>`;
  }

  /* ---------- More (phone) ---------- */
  function viewMore() {
    return `<div class="col view-enter"><header class="title"><div><h1>More</h1></div></header><div class="rows">
      ${[['plan', 'Plan', 'The 12 weeks, rotation and kickoff'], ['library', 'Library', 'Resources, credits, perks, cheat sheets'], ['progress', 'Progress', 'Ladder, scoreboard, achievements'], ['settings', 'Settings', 'Sync, notifications, theme, data']].map(([h, t, d]) => `<a class="row" href="#${h}" style="text-decoration:none"><div class="main"><b>${t}</b><span>${d}</span></div></a>`).join('')}</div></div>`;
  }

  /* ---------- events ---------- */
  async function readResume(file) {
    if (file.size > 2 * 1024 * 1024) return toast('That file is over 2 MB.');
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    if (!['txt', 'md', 'pdf'].includes(ext)) return toast('Use a .txt, .md or .pdf file.');
    let text = '';
    if (ext === 'pdf') {
      const head = new Uint8Array(await file.slice(0, 5).arrayBuffer());
      if (String.fromCharCode(...head) !== '%PDF-') return toast('That is not a valid PDF.');
      if (!window.pdfjsLib) await new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js'; s.onload = res; s.onerror = rej; document.head.appendChild(s); }).catch(() => null);
      if (!window.pdfjsLib) return toast('Could not load the PDF reader. Try a .txt file.');
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
      const pdf = await window.pdfjsLib.getDocument({ data: await file.arrayBuffer(), isEvalSupported: false }).promise;
      for (let i = 1; i <= Math.min(pdf.numPages, 8); i++) text += (await (await pdf.getPage(i)).getTextContent()).items.map(x => x.str).join(' ') + '\n';
    } else text = await file.text();
    const vocab = data('sources/skills').value?.skills || [];
    L.resumeFound = { skills: findSkills(text, vocab).filter(s => !(profile.skills || []).includes(s)), years: yearsFromText(text), off: [] };
    text = ''; // discard the CV text
    ctx.saveLocal(); ctx.render();
  }
  const actions = {
    retry: () => { for (const [k, v] of cache) if (v.error) cache.delete(k); ctx.render(); },
    go: (...p) => { location.hash = p.join(':'); },
    save: id => { const a = findArticle(id); if (a) { setRead(a, { saved: !rd(a).saved }); ctx.save(); } },
    fb: (id, k) => { const a = findArticle(id); if (a) { setRead(a, { feedback: rd(a).feedback === k ? null : k }); ctx.save(); if (k === 'dismissed') toast('Hidden. It will not show again.'); } },
    status: (id, k) => { const a = findArticle(id); if (a) { setRead(a, { status: k }); ctx.save(); } },
    interest: k => { const p = prefs(); setSetting('prefs', { interests: p.interests.includes(k) ? p.interests.filter(x => x !== k) : [...p.interests, k] }); ctx.save(); },
    topic: t => { L.ex = { ...L.ex, topic: t, page: 1 }; ctx.saveLocal(); location.hash = 'read/explore'; },
    more: k => { if (k === 'ex') L.ex.page = (L.ex.page || 1) + 1; else if (k === 'rjobs') L.jf.rpage = (L.jf.rpage || 1) + 1; else L.jf.page = (L.jf.page || 1) + 1; ctx.saveLocal(); ctx.render(); },
    refresh: (kind, id) => dispatch(kind, id),
    toggle: (kind, id) => editRegistry(`${kind}.json`, reg => { const s = reg.sources.find(x => x.id === id); if (!s) return 'Source not found.'; s.enabled = !s.enabled; }, `sources: toggle ${id}`),
    jsave: id => { const j = data('jobs/index').value?.items.find(x => x.id === id); if (!j) return; if (apps()[id]?.status) { location.hash = `jobs/j/${id}`; return; } ctx.put('apps', id, { title: j.title, company: j.company, url: j.application_url || j.url, status: 'saved', created: ctx.today(), updated: ctx.today(), history: [{ s: 'saved', d: ctx.today() }] }); ctx.save(); toast('Saved to Applications.'); },
    jdismiss: id => { ctx.put('jobfb', id, { dismissed: true, d: ctx.today() }); ctx.save(); },
    jtoggle: k => { L.jf[k] = !L.jf[k]; L.jf.page = 1; L.jf.rpage = 1; ctx.saveLocal(); ctx.render(); },
    ptype: t => { const xs = profile.employmentTypes || []; profile.employmentTypes = xs.includes(t) ? xs.filter(x => x !== t) : [...xs, t]; saveProfile(); ctx.render(); },
    skilldel: s => { profile.skills = (profile.skills || []).filter(x => x !== s); saveProfile(); ctx.render(); },
    foundtoggle: s => { const f = L.resumeFound; f.off = f.off.includes(s) ? f.off.filter(x => x !== s) : [...f.off, s]; ctx.saveLocal(); ctx.render(); },
    foundadd: () => { const f = L.resumeFound; profile.skills = [...new Set([...(profile.skills || []), ...f.skills.filter(s => !f.off.includes(s))])]; if (f.years != null && (profile.years == null || profile.years === '')) profile.years = f.years; L.resumeFound = null; saveProfile(); ctx.saveLocal(); ctx.render(); toast('Skills added. Edit them any time.'); },
    founddrop: () => { L.resumeFound = null; ctx.saveLocal(); ctx.render(); },
    alerts: () => { const on = !settings('alerts').enabled; setSetting('alerts', { enabled: on, minScore: settings('alerts').minScore ?? 70 }); if (on) syncAlertProfile(); else ctx.put('settings', 'alertProfile', {}); ctx.save(); toast(on ? 'Alerts on. Add NTFY_TOPIC as a repo secret if you have not.' : 'Alerts off.'); },
    alertremote: () => { setSetting('alerts', { remoteOnly: !settings('alerts').remoteOnly }); ctx.save(); },
  };
  function onInput(el) {
    const d = el.dataset;
    if (d.ex) { L.ex = { ...L.ex, [d.ex]: el.value, page: 1 }; ctx.saveLocal(); ctx.render(); return true; }
    if (d.jf) { L.jf = { ...L.jf, [d.jf]: el.value, page: 1, rpage: 1 }; ctx.saveLocal(); ctx.render(); return true; }
    if (d.prof) { profile[d.prof] = el.type === 'number' ? (el.value === '' ? null : Number(el.value)) : el.value; saveProfile(); return true; }
    if (d.profList) { profile[d.profList] = el.value.split(',').map(x => x.trim()).filter(Boolean); saveProfile(); return true; }
    if (d.note) { const a = findArticle(d.note); if (a) { setRead(a, { note: el.value }); ctx.save(true); } return true; }
    if (d.alert) { setSetting('alerts', { [d.alert]: Number(el.value) }); ctx.save(true); return true; }
    if (d.alertList) { setSetting('alerts', { [d.alertList]: el.value.split(',').map(x => x.trim()).filter(Boolean) }); ctx.save(true); return true; }
    return false;
  }
  function onChange(el) {
    const d = el.dataset;
    if (d.pref) { setSetting('prefs', { [d.pref]: Number(el.value) }); ctx.save(); return true; }
    if (d.app) {
      const id = d.app, v = el.value, cur = apps()[id];
      if (v === '__remove') { ctx.put('apps', id, { status: null }); ctx.save(); return true; }
      if (!v) return true;
      const j = data('jobs/index').value?.items.find(x => x.id === id) || cache.get(`jobs/${id}`)?.value || cur || {};
      ctx.put('apps', id, { title: j.title, company: j.company, url: j.application_url || j.url, created: cur?.created || ctx.today(), updated: ctx.today(), status: v, history: [...(cur?.history || []), { s: v, d: ctx.today() }] });
      ctx.save(); toast(`Marked ${v}.`); return true;
    }
    if (el.matches('[data-resume]') && el.files[0]) { readResume(el.files[0]).catch(() => toast('Could not read that file.')); el.value = ''; return true; }
    if (d.prof || d.profList) { ctx.render(); return true; }
    return false;
  }
  function onSubmit(name, v) {
    if (name === 'intel-skill') { const s = (v.skill || '').trim(); if (s) { profile.skills = [...new Set([...(profile.skills || []), s])]; saveProfile(); ctx.render(); } return true; }
    if (name === 'intel-source') {
      const bad = urlProblem(v.url); if (bad) { toast(bad); return true; }
      const id = (v.name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
      if (!id) { toast('Give the source a name.'); return true; }
      if (v.type === 'webpage' && !v.selector) { toast('Web page sources need a link selector.'); return true; }
      editRegistry('articles.json', reg => {
        if (reg.sources.some(s => s.id === id || s.url === v.url)) return 'That source already exists.';
        reg.sources.push({ id, name: v.name.slice(0, 80), url: v.url, type: v.type, categories: [v.category], tags: [], fetch_every_hours: Math.max(3, Math.min(168, Number(v.every) || 24)), priority: 3, trust: Number(v.trust) || 3, enabled: true, full_text: v.type === 'webpage', max_items: 10, ...(v.type === 'webpage' ? { list: { item_link: v.selector } } : {}) });
      }, `sources: add ${id}`);
      return true;
    }
    if (name === 'intel-board') {
      const board = (v.board || '').toLowerCase().trim();
      if (!/^[a-z0-9-]{2,60}$/.test(board)) { toast('The slug uses letters, numbers and dashes only.'); return true; }
      editRegistry('jobs.json', reg => { const id = `${v.adapter}-${board}`; if (reg.sources.some(s => s.id === id)) return 'That board is already listed.'; reg.sources.push({ id, adapter: v.adapter, board, company: v.company.slice(0, 80), enabled: true, fetch_every_hours: 12 }); }, `sources: add ${v.adapter} board ${board}`);
      return true;
    }
    return false;
  }

  return {
    read: sub => { const [a, b] = sub; return `<div class="col ${a === 'a' ? '' : 'view-enter'}">${a === 'a' ? viewArticle(b) : a === 'explore' ? viewExplore() : a === 'saved' ? viewSaved() : a === 'sources' ? viewSources() : viewBriefing()}</div>`; },
    jobs: sub => { const [a, b] = sub; return `<div class="col ${a === 'j' ? '' : 'view-enter'}">${a === 'j' ? viewJob(b) : a === 'search' ? viewJobSearch() : a === 'tracker' ? viewTracker() : a === 'profile' ? viewProfile() : a === 'sources' ? viewJobSources() : viewRecommended()}</div>`; },
    more: viewMore, actions, onInput, onChange, onSubmit,
    todayPanel: () => {
      const idx = data('articles/index'), jobs = data('jobs/index');
      const picks = idx.value ? diversify(personal(idx.value.items.filter(a => a.published_at && Date.now() - Date.parse(a.published_at) < 72 * 36e5)).items, 3) : [];
      const strong = jobs.value && profileReady(profile) ? matched(jobs.value.items.filter(j => !jobfb()[j.id]?.dismissed && Date.now() - Date.parse(j.first_seen_at) < 3 * 864e5)).filter(([, m]) => m.score >= 75).length : null;
      return panel('Read today', `${picks.length ? `<div class="rows">${picks.map(a => `<a class="row" href="#read/a/${a.id}" style="text-decoration:none"><div class="main"><b>${esc(a.title)}</b><span>${esc(a.source_name)}${a.reading_minutes ? ` · ${a.reading_minutes} min` : ''}</span></div></a>`).join('')}</div>` : `<p class="muted">${idx.loading ? 'Loading…' : 'The briefing appears after the first ingest run.'}</p>`}
        <p style="margin:12px 0 0"><a class="more" href="#read">Full briefing</a>${strong != null ? ` · <a class="more" href="#jobs">${strong} new strong job match${strong === 1 ? '' : 'es'}</a>` : ' · <a class="more" href="#jobs/profile">Set up job matching</a>'}</p>`);
    },
    badge: () => { const idx = cache.get('jobs/index')?.value; return idx && profileReady(profile) ? matched(idx.items.filter(j => !jobfb()[j.id]?.dismissed)).filter(([, m]) => m.score >= 75).length : 0; },
    warm: () => { data('sources/topics'); data('sources/skills'); },
  };
}
