# Apex: coach, reading briefing and job finder

One personal web app, installable on your phone, with three jobs:

1. **Coach**: today's 90-minute session, streak, DSA re-solves, open-source PRs, library, credits.
2. **Read**: a daily briefing built from about 35 sources, with summaries, takeaways, search and a reading library.
3. **Jobs**: live listings from public employer boards, scored against your profile, plus an application tracker.

It needs no server. GitHub Actions runs the crawler on a schedule, the results are committed to a
`data` branch, and GitHub Pages serves the site. It costs nothing on a public repo.

## How it works

```
sources/*.json ──► GitHub Actions (every 3 h)
                   python -m pipeline  ── Scrapling + feedparser ──► data/store/*.json  (state, dedupe, cache)
                        │                                         └► api/v1/*.json      (static, read-only API)
                        └► node scripts/alerts.mjs ──► ntfy push (new strong job matches)
                   force-push store + api ──► branch `data` (one commit, no history growth)
                   assemble site + api ──► GitHub Pages
Browser (PWA) ──► reads api/v1/*.json; keeps your log, reading status, applications on device
              └─► syncs your log to data/tracker.json on main (fine-grained token)
              └─► admin: edits sources/*.json and starts ingest runs through the GitHub API
```

- **Scraping**: [Scrapling](https://github.com/D4Vinci/Scrapling) 0.5 (BSD-3) does every HTTP fetch and
  all HTML parsing. RSS and Atom go through feedparser. Web-page sources use a CSS selector to find
  article links, then Scrapling extracts title, canonical URL, author, dates, image and main text.
- **Safety**: each URL and each redirect hop is checked against private, loopback, link-local and
  cloud-metadata addresses. The crawler honours robots.txt, sends one request at a time per host
  with a 1 s gap, times out at 20 s, caps responses at 6 MB (80 MB for whole-board job APIs) and
  retries with exponential backoff and jitter. It never logs in or bypasses CAPTCHAs or paywalls.
- **Storage**: JSON files. Articles are deduplicated by canonical URL and content hash, with
  near-duplicate titles linked. Jobs are deduplicated by source and job ID, and by
  company + title + location across sources. Full article text is used for enrichment in memory
  and never stored or published; only the title, a 320-character excerpt and the summary are kept.
- **Enrichment**: optional AI with a free Gemini key or any OpenAI-compatible key. Results are cached
  by content hash, and at most 25 AI calls are made per run. Scraped text is passed as untrusted data
  and the model's output is validated. Without a key, the summary is the article's own leading
  sentences, labelled as such.
- **Ranking**: a weighted sum you can read in `pipeline/rank.py`: recency 0.25 (72 h half-life,
  undated items heavily discounted), source trust 0.20, interest relevance 0.25, quality 0.15,
  practical value 0.15. Results are capped per source and per topic for diversity. On your device,
  your interests and feedback (useful, not useful, known, hide) re-rank the feed. The app says when
  it is not personalised yet.
- **Job matching**: `match.js`, shared by the browser and the alert script. Points: required skills 35,
  role 20, experience 15, location and work mode 12, nice-to-have skills 10, employment type 4,
  salary 4. A factor with no data on either side is left out and shown as such. With fewer than 50
  judgeable points there is no score. Deal-breakers such as onsite-only for a remote-only profile,
  a 3+ year experience gap, pay below your minimum or "no visa sponsorship" are listed, never hidden.

### Why these repositories (checked 19 Oct 2026)

| Candidate | Verdict |
| --- | --- |
| D4Vinci/Scrapling (BSD-3, active) | **Used** as the fetch and extraction engine; a library, so it runs in Actions |
| gssantos/news-rag | Not used: no license, needs FastAPI + Postgres + a server |
| LeslieLeung/glean, simonives/reed | Not used: AGPL, self-hosted servers with their own databases |
| career-ops-hq/career-ops (MIT) | Not used: an interactive local agent needing Node 22+; its ATS-endpoint idea is what the adapters follow |
| QaliAI/ai-job-agent (MIT) | Not used: very young; same public-ATS approach implemented here directly |
| Charank18/JobSearch-Agent | Not used: logs into LinkedIn with your credentials (terms and ban risk) |
| ouverz/ai-job-tracker (MIT) | Not used: FastAPI + SQLite + React app that needs a server |

GitHub Models was retired on 30 July 2026, so the free Actions token cannot be used for AI. Use the
Gemini key or another provider instead.

## Static API (read-only, served by GitHub Pages)

| Logical endpoint | File |
| --- | --- |
| `GET /api/v1/articles` (paginated) | `api/v1/articles/index.json`, `api/v1/articles/page/{n}.json` (50 per page) |
| `GET /api/v1/articles/{id}` | `api/v1/articles/{id}.json` |
| `GET /api/v1/feed` | `api/v1/feed.json` (base ranking, not personalised) |
| `GET /api/v1/digest/today` | `api/v1/digest/today.json` |
| `GET /api/v1/topics`, `/sources` | `api/v1/topics.json`, `api/v1/sources.json` (with health) |
| `GET /api/v1/jobs`, `/jobs/{id}` | `api/v1/jobs/index.json`, `api/v1/jobs/{id}.json` |
| `GET /api/v1/companies` | `api/v1/companies.json` |
| `GET /api/v1/admin/job-sources`, `/admin/ingestion-runs` | `api/v1/job-sources.json`, `api/v1/admin/runs.json` |
| health | `api/v1/health.json` |

Search, filters, sorting, recommendations, bookmarks, reading status, preferences, saved jobs and
applications run in the browser over these files and your own log. Writes go through GitHub with
your token: adding, enabling or disabling a source commits `sources/*.json`, and "Refresh" or
"Run ingest now" calls the workflow-dispatch API, which returns a run ID the app shows and follows.
Only someone with your token can do either.

## Setup, about 25 minutes

1. **Create a public repo** called `apex` and push this folder:

   ```bash
   cd ~/Desktop/apex && git init -b main && git add . && git commit -m "Apex"
   ```

   ```bash
   git remote add origin https://github.com/YOUR_USERNAME/apex.git && git push -u origin main
   ```

2. **Pages**: repo Settings → Pages → Source: **GitHub Actions**.
3. **First crawl**: Actions → ingest → Run workflow, with force ticked. About 3 minutes. It creates the
   `data` branch and deploys `https://YOUR_USERNAME.github.io/apex/`.
4. **Token for sync and admin**: GitHub Settings → Developer settings → Fine-grained tokens. Choose the
   `apex` repo only, with Contents read and write and Actions read and write. Paste it in Apex
   Settings with the repo name. It is stored only on that device.
5. **Optional secrets** (repo Settings → Secrets and variables → Actions):
   `GEMINI_API_KEY` for AI summaries, and `NTFY_TOPIC` for phone nudges and job alerts. Install the
   ntfy app and subscribe to the same topic.
6. **Phone**: open the site, then Share → Add to Home Screen (iPhone) or Install (Android).
7. **Free domain (optional)**: claim the Student Pack `.me` domain and set it as a custom domain in
   Pages settings.

## Run it locally

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
```

```bash
AI_PROVIDER=none .venv/bin/python -m pipeline all --force
```

```bash
python3 -m http.server 5180
```

Then open http://localhost:5180. Other commands: `python -m pipeline articles --source simonw` for one
source, and `--max-enrich 10` to limit AI calls.

## Tests

```bash
.venv/bin/python -m pytest -q tests
```

```bash
node --test tests/
```

They cover SSRF rejection (including redirects and DNS answers that resolve to private addresses),
retries and Retry-After, robots.txt, size limits, conditional GET, RSS, Atom and malformed feeds,
page extraction, canonical URLs, dates, idempotent re-runs, schedules, dedupe, failure isolation and
backoff, the enrichment cache, budget and fallback, every job adapter, job expiry, skill
false-positives, ranking, publishing without full text, match scoring, CV parsing, personalisation
and search. CI runs both suites before every crawl.

## Adding sources

- **Articles**: Read → Sources → Add a source, or edit `sources/articles.json`. Types: `rss`, `atom`,
  `sitemap`, `webpage` (needs `list.item_link`, a Scrapling selector such as
  `a[href^="/blog/"]::attr(href)`) and `hf_papers`.
- **Jobs**: Jobs → Sources → Add a company board, with the slug from the careers URL
  (`job-boards.greenhouse.io/<slug>`, `jobs.ashbyhq.com/<slug>`, `jobs.lever.co/<slug>`).
- Interests and topics are in `sources/topics.json`; the skills vocabulary is in `sources/skills.json`.

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| A source shows "disallowed by robots.txt" | The site does not allow crawlers. It stays disabled; that is the intended behaviour |
| "HTTP 404" on a feed | The feed moved. Find the new URL and edit the source |
| "response larger than…" | A very large page or board. Raise `APEX_MAX_BYTES` or `APEX_JOB_MAX_BYTES` |
| "blocked URL" | The URL or a redirect points at a private or local address |
| Refresh button says the token needs Actions access | Give the fine-grained token Actions read and write |
| Old screens after an update | Close and reopen the app; the service worker refreshes on the next load |
| Briefing says "not personalised yet" | Pick interests in Read → Briefing, or give feedback on a few articles |

## Limits, honestly

- Data refreshes every 3 hours at best. GitHub can delay scheduled runs by several minutes.
- Remotive (robots.txt), Lobsters (robots.txt) and the Harvard Health feed (404) are disabled.
- Work mode is unknown for many Greenhouse jobs because the board does not say; the app shows it as unknown.
- Skills come from a fixed vocabulary of about 60 terms; edit `sources/skills.json` to extend it.
- The synced log `data/tracker.json` is public in a public repo. The career profile never leaves your
  device unless you turn on alerts; even then only skills, roles, work mode, places and years are synced.
