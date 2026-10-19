// Seed content for Apex. Everything the app shows that is not your own log lives here.
// Edit freely: ids must stay stable once you have progress against them.

export const START_DATE = '2026-10-26'; // Monday of Week 1. Week 0 = the 7 days before.
export const DAYS = 84;

// Weekly rotation: index 0 = Monday.
export const ROTATION = [
  { focus: 'learn', main: 'Learn: implement the week\'s concept from scratch', side: '1 DSA problem' },
  { focus: 'build', main: 'Build: the week\'s Atlas milestone', side: 'Research intake, 15 min skim' },
  { focus: 'dsa', main: 'DSA: 2 new problems + 1 re-solve from memory', side: 'Anki cards from mistakes' },
  { focus: 'build', main: 'Build: the week\'s Atlas milestone', side: 'Read 1 merged PR in a target repo' },
  { focus: 'learn', main: 'Learn: the week\'s AI/ML track', side: '1 DSA problem' },
  { focus: 'oss', main: 'Open source (from Week 3), otherwise Build', side: '1 DSA problem' },
  { focus: 'review', main: 'Deep read: 1 paper or blog with an AI tutor (40 min)', side: 'Weekly review + publish weekly log' },
];

export const MODES = {
  full: { label: 'Full', minutes: 90, blocks: [['warm', 'Warm-up', 10, 'Anki review, then recall yesterday in 3 lines'], ['main', 'Main block', 60, ''], ['side', 'Side block + log', 20, '']] },
  low: { label: 'Low', minutes: 30, blocks: [['warm', 'Anki', 10, 'Review due cards'], ['main', 'One re-solve or one PR read', 15, ''], ['side', 'Log', 5, 'One line in the log']] },
  min: { label: 'Minimum', minutes: 10, blocks: [['warm', 'Anki + one log line', 10, 'The streak survives']] },
};

export const WEEKS = [
  { n: 0, phase: 'Setup', learn: 'Tools, accounts, this app', build: 'Create growth + atlas repos, CI skeleton', dsa: 'Two Sum, Contains Duplicate as a baseline', proof: 'Day 0 log published' },
  { n: 1, phase: 'Foundations', learn: 'Python data model, iterators, generators, exceptions, modules, type hints; git, uv, ruff, pytest', build: 'Repo skeleton; CLI that pulls an RSS feed into dataclasses', dsa: 'Arrays and hashing', proof: 'Repo public, CI runs lint + tests' },
  { n: 2, phase: 'Foundations', learn: 'OOP: encapsulation, abstraction, composition vs inheritance, polymorphism, Protocols, dunder methods', build: 'Source protocol with arXiv, RSS and HF Papers sources; SQLite storage', dsa: 'Arrays, two pointers', proof: 'Class diagram + tests for every source' },
  { n: 3, phase: 'Foundations', learn: 'SOLID, cohesion and coupling, dependency injection; strategy, factory, adapter, repository, observer', build: 'Refactor to repository pattern + DI; fakes instead of mocks', dsa: 'Two pointers, sliding window', proof: 'Refactoring PR with before/after notes' },
  { n: 4, phase: 'Foundations', learn: 'Testing (pytest, Hypothesis), debugging, logging, profiling, asyncio + httpx', build: 'Async fetching, retries with backoff, rate limiting', dsa: 'Stack, binary search', proof: 'Gate 1: Atlas v0.1 tagged; first OSS PR opened', gate: 1 },
  { n: 5, phase: 'AI core', learn: 'How LLMs work: tokens, embeddings, attention; micrograd and tokenizer videos', build: 'Provider-agnostic LLMClient; Pydantic structured output; paper summaries', dsa: 'Binary search, linked list', proof: '50 paper summaries stored with a typed schema' },
  { n: 6, phase: 'AI core', learn: 'Retrieval: chunking, embeddings, BM25, hybrid search, reranking', build: 'RAG v1 with citations; FastAPI endpoint', dsa: 'Trees', proof: 'Cited answer from Atlas via the API' },
  { n: 7, phase: 'AI core', learn: 'Evals: golden sets, LLM-as-judge, recall@k, MRR, error analysis', build: 'Eval harness + 50-question golden set in CI; compare 3 chunkers', dsa: 'Trees, heap', proof: 'Eval report in README with numbers' },
  { n: 8, phase: 'AI core', learn: 'ML fundamentals: gradient descent, loss, overfitting, splits; makemore', build: 'Docker image; v0.2 release', dsa: 'Graphs', proof: 'Gate 2: Atlas v0.2; 1 OSS PR merged', gate: 2 },
  { n: 9, phase: 'Agents', learn: 'Agents: tool calling, ReAct loop, memory, MCP; the loop by hand first', build: 'Research agent: weekly digest + quiz cards', dsa: 'Graphs, backtracking', proof: 'Agent-written digest on your site' },
  { n: 10, phase: 'Agents', learn: 'Production: tracing, caching, cost and latency, guardrails, prompt injection', build: 'Langfuse tracing, cache, injection tests; free deploy', dsa: '1-D dynamic programming', proof: 'Live URL + trace screenshots' },
  { n: 11, phase: 'Agents', learn: 'Fine-tune vs RAG vs prompt; LoRA, quantization, serving', build: 'LoRA fine-tune on free Colab GPU vs a prompt baseline', dsa: 'DP, intervals, greedy', proof: 'Write-up: when fine-tuning was worth it' },
  { n: 12, phase: 'Agents', learn: 'AI system design, mock interviews, technical writing', build: 'v1.0: README, architecture diagram, demo video', dsa: 'Timed mixed sets', proof: 'Gate 3: v1.0 + blog post + 3 PRs merged', gate: 3 },
];

export const WEEK0_TASKS = [
  ['slot', 'Pick a daily 90-minute slot; add the calendar reminder from Settings'],
  ['tools', 'Install uv, ruff, pytest, VS Code, Docker Desktop and Ollama'],
  ['site', 'Push this app to GitHub Pages and log Day 0'],
  ['domain', 'Claim your free .me domain from the Student Pack (or yourname.is-a.dev)'],
  ['atlas', 'Create the atlas repo with src/ layout, README and CI'],
  ['anki', 'Install Anki; make the "AI Engineer" deck'],
  ['rss', 'Subscribe to the 10 sources; unfollow doom-scroll feeds'],
  ['keys', 'Free keys: Google AI Studio and Groq, in a git-ignored .env'],
  ['oss', 'Star and watch 3 candidate OSS repos'],
  ['ntfy', 'Install the ntfy app and subscribe to your topic'],
];

export const GATES = [
  { n: 1, week: 4, date: '2026-11-22', hours: 40, days: 26, dsa: 20, resolves: 10, prsMerged: 0, prsOpened: 1, papers: 4, release: 'v0.1' },
  { n: 2, week: 8, date: '2026-12-20', hours: 80, days: 52, dsa: 40, resolves: 25, prsMerged: 1, prsOpened: 2, papers: 8, release: 'v0.2' },
  { n: 3, week: 12, date: '2027-01-17', hours: 120, days: 78, dsa: 60, resolves: 45, prsMerged: 3, prsOpened: 4, papers: 12, release: 'v1.0' },
];

// 60 problems, 5 a week, in pattern order. [pattern, name, leetcode slug, why it matters for AI work]
const P = [
  ['Arrays and hashing', 'Contains Duplicate', 'contains-duplicate'],
  ['Arrays and hashing', 'Valid Anagram', 'valid-anagram'],
  ['Arrays and hashing', 'Two Sum', 'two-sum'],
  ['Arrays and hashing', 'Group Anagrams', 'group-anagrams'],
  ['Arrays and hashing', 'Top K Frequent Elements', 'top-k-frequent-elements'],
  ['Arrays and hashing', 'Product of Array Except Self', 'product-of-array-except-self'],
  ['Arrays and hashing', 'Valid Sudoku', 'valid-sudoku'],
  ['Arrays and hashing', 'Longest Consecutive Sequence', 'longest-consecutive-sequence'],
  ['Two pointers', 'Valid Palindrome', 'valid-palindrome'],
  ['Two pointers', 'Two Sum II', 'two-sum-ii-input-array-is-sorted'],
  ['Two pointers', '3Sum', '3sum'],
  ['Two pointers', 'Container With Most Water', 'container-with-most-water'],
  ['Two pointers', 'Trapping Rain Water', 'trapping-rain-water'],
  ['Sliding window', 'Best Time to Buy and Sell Stock', 'best-time-to-buy-and-sell-stock'],
  ['Sliding window', 'Longest Substring Without Repeating Characters', 'longest-substring-without-repeating-characters'],
  ['Sliding window', 'Longest Repeating Character Replacement', 'longest-repeating-character-replacement'],
  ['Sliding window', 'Minimum Window Substring', 'minimum-window-substring'],
  ['Stack', 'Valid Parentheses', 'valid-parentheses'],
  ['Stack', 'Min Stack', 'min-stack'],
  ['Stack', 'Evaluate Reverse Polish Notation', 'evaluate-reverse-polish-notation'],
  ['Stack', 'Daily Temperatures', 'daily-temperatures'],
  ['Stack', 'Car Fleet', 'car-fleet'],
  ['Binary search', 'Binary Search', 'binary-search'],
  ['Binary search', 'Search a 2D Matrix', 'search-a-2d-matrix'],
  ['Binary search', 'Koko Eating Bananas', 'koko-eating-bananas'],
  ['Binary search', 'Find Minimum in Rotated Sorted Array', 'find-minimum-in-rotated-sorted-array'],
  ['Binary search', 'Search in Rotated Sorted Array', 'search-in-rotated-sorted-array'],
  ['Linked list', 'Reverse Linked List', 'reverse-linked-list'],
  ['Linked list', 'Merge Two Sorted Lists', 'merge-two-sorted-lists'],
  ['Linked list', 'Linked List Cycle', 'linked-list-cycle'],
  ['Linked list', 'LRU Cache', 'lru-cache'],
  ['Trees', 'Invert Binary Tree', 'invert-binary-tree'],
  ['Trees', 'Maximum Depth of Binary Tree', 'maximum-depth-of-binary-tree'],
  ['Trees', 'Same Tree', 'same-tree'],
  ['Trees', 'Lowest Common Ancestor of a BST', 'lowest-common-ancestor-of-a-binary-search-tree'],
  ['Trees', 'Binary Tree Level Order Traversal', 'binary-tree-level-order-traversal'],
  ['Trees', 'Validate Binary Search Tree', 'validate-binary-search-tree'],
  ['Trees', 'Kth Smallest Element in a BST', 'kth-smallest-element-in-a-bst'],
  ['Trees', 'Implement Trie', 'implement-trie-prefix-tree'],
  ['Trees', 'Serialize and Deserialize Binary Tree', 'serialize-and-deserialize-binary-tree'],
  ['Heap', 'Kth Largest Element in a Stream', 'kth-largest-element-in-a-stream'],
  ['Heap', 'Last Stone Weight', 'last-stone-weight'],
  ['Heap', 'K Closest Points to Origin', 'k-closest-points-to-origin'],
  ['Heap', 'Find Median from Data Stream', 'find-median-from-data-stream'],
  ['Graphs', 'Number of Islands', 'number-of-islands'],
  ['Graphs', 'Clone Graph', 'clone-graph'],
  ['Graphs', 'Max Area of Island', 'max-area-of-island'],
  ['Graphs', 'Pacific Atlantic Water Flow', 'pacific-atlantic-water-flow'],
  ['Graphs', 'Rotting Oranges', 'rotting-oranges'],
  ['Graphs', 'Course Schedule', 'course-schedule'],
  ['Graphs', 'Redundant Connection', 'redundant-connection'],
  ['Backtracking', 'Subsets', 'subsets'],
  ['Backtracking', 'Combination Sum', 'combination-sum'],
  ['Backtracking', 'Word Search', 'word-search'],
  ['1-D dynamic programming', 'Climbing Stairs', 'climbing-stairs'],
  ['1-D dynamic programming', 'House Robber', 'house-robber'],
  ['1-D dynamic programming', 'Coin Change', 'coin-change'],
  ['1-D dynamic programming', 'Longest Increasing Subsequence', 'longest-increasing-subsequence'],
  ['Intervals and greedy', 'Merge Intervals', 'merge-intervals'],
  ['Intervals and greedy', 'Jump Game', 'jump-game'],
];
export const DSA = P.map(([pattern, name, slug], i) => ({ id: slug, pattern, name, week: Math.floor(i / 5) + 1, url: `https://leetcode.com/problems/${slug}/` }));
console.assert(DSA.length === 60, 'DSA list must hold 60 problems');

export const PATTERN_USE = {
  'Arrays and hashing': 'Deduplication, caching, vocabulary lookups',
  'Two pointers': 'Merging sorted result lists',
  'Sliding window': 'Context windows, chunk overlap, rate limiters',
  'Stack': 'Parsers, structured-output validation',
  'Binary search': 'Threshold tuning, sorted indexes',
  'Linked list': 'LRU caches for LLM responses',
  'Trees': 'Tries for tokenizers, tree retrieval',
  'Heap': 'Top-k retrieval, reranking',
  'Graphs': 'Agent task DAGs, dependency resolution',
  'Backtracking': 'Search over plans and tool calls',
  '1-D dynamic programming': 'Edit distance, beam search',
  'Intervals and greedy': 'Scheduling, batching requests',
};

// Spaced re-solve intervals in days after the first solve.
export const REVIEW_STEPS = [3, 14, 30];

// kind: course | video | docs | blog | tool | book | paper-feed
export const LIBRARY = [
  // Fundamentals
  ['cs50p', 'CS50P: Python', 'https://cs50.harvard.edu/python/', 'course', 'python', 1],
  ['pytut', 'Python tutorial', 'https://docs.python.org/3/tutorial/', 'docs', 'python', 1],
  ['cosmic', 'Architecture Patterns with Python', 'https://www.cosmicpython.com', 'book', 'oop,design', 2],
  ['refguru', 'Refactoring.Guru design patterns', 'https://refactoring.guru/design-patterns', 'docs', 'oop,design', 3],
  ['missing', 'The Missing Semester', 'https://missing.csail.mit.edu', 'course', 'tools', 1],
  ['pytest', 'pytest docs', 'https://docs.pytest.org', 'docs', 'testing', 4],
  ['fastapi', 'FastAPI docs', 'https://fastapi.tiangolo.com', 'docs', 'api', 6],
  // AI and ML
  ['zth', 'Karpathy: Neural Networks Zero to Hero', 'https://karpathy.ai/zero-to-hero.html', 'video', 'llm,ml', 5],
  ['3b1b', '3Blue1Brown: neural networks', 'https://www.3blue1brown.com/topics/neural-networks', 'video', 'ml,math', 5],
  ['txexp', 'Transformer Explainer (interactive)', 'https://poloclub.github.io/transformer-explainer/', 'tool', 'llm,interactive', 5],
  ['llmviz', 'LLM Visualization (interactive 3D)', 'https://bbycroft.net/llm', 'tool', 'llm,interactive', 5],
  ['illtx', 'The Illustrated Transformer', 'https://jalammar.github.io/illustrated-transformer/', 'blog', 'llm', 5],
  ['hfllm', 'Hugging Face LLM Course', 'https://huggingface.co/learn/llm-course', 'course', 'llm', 5],
  ['hfagents', 'Hugging Face Agents Course', 'https://huggingface.co/learn/agents-course', 'course', 'agents', 9],
  ['hfmcp', 'Hugging Face MCP Course', 'https://huggingface.co/learn/mcp-course', 'course', 'agents', 9],
  ['dlai', 'DeepLearning.AI short courses (free)', 'https://www.deeplearning.ai/short-courses/', 'course', 'llm,rag,agents', 6],
  ['msgenai', 'Microsoft Generative AI for Beginners', 'https://github.com/microsoft/generative-ai-for-beginners', 'course', 'llm', 5],
  ['anthcourses', 'Anthropic courses (prompting, tool use)', 'https://github.com/anthropics/courses', 'course', 'llm,prompting', 5],
  ['anthcook', 'Anthropic cookbook', 'https://github.com/anthropics/anthropic-cookbook', 'docs', 'llm,rag', 6],
  ['mlcc', 'Google Machine Learning Crash Course', 'https://developers.google.com/machine-learning/crash-course', 'course', 'ml', 8],
  ['fastai', 'fast.ai Practical Deep Learning', 'https://course.fast.ai', 'course', 'ml', 8],
  ['kaggle', 'Kaggle Learn (free certificates)', 'https://www.kaggle.com/learn', 'course', 'ml,python', 8],
  ['madewithml', 'Made With ML (MLOps)', 'https://madewithml.com', 'course', 'mlops', 10],
  ['cs336', 'Stanford CS336: LMs from Scratch', 'https://stanford-cs336.github.io', 'course', 'llm,deep', 11],
  ['mml', 'Mathematics for Machine Learning (free book)', 'https://mml-book.github.io', 'book', 'math', 5],
  ['hamel', 'Hamel Husain on evals', 'https://hamel.dev', 'blog', 'evals', 7],
  ['eugene', 'Eugene Yan', 'https://eugeneyan.com', 'blog', 'evals,rag', 7],
  ['lilian', 'Lilian Weng\'s blog', 'https://lilianweng.github.io', 'blog', 'agents,research', 9],
  ['ollama', 'Ollama (local models)', 'https://ollama.com', 'tool', 'tools', 0],
  // AI-assisted learning
  ['alphaxiv', 'alphaXiv: chat with any arXiv paper', 'https://www.alphaxiv.org', 'tool', 'papers,interactive', 0],
  ['notebooklm', 'NotebookLM: audio overviews of sources', 'https://notebooklm.google.com', 'tool', 'papers,interactive', 0],
  ['anki', 'Anki spaced repetition', 'https://apps.ankiweb.net', 'tool', 'memory', 0],
  ['neetcode', 'NeetCode practice list', 'https://neetcode.io/practice', 'tool', 'dsa', 1],
  // Staying current
  ['smolnews', 'AI News by smol.ai', 'https://news.smol.ai', 'paper-feed', 'news', 0],
  ['simon', 'Simon Willison\'s blog', 'https://simonwillison.net', 'paper-feed', 'news', 0],
  ['latent', 'Latent Space', 'https://www.latent.space', 'paper-feed', 'news', 0],
  ['hfpapers', 'Hugging Face Daily Papers', 'https://huggingface.co/papers', 'paper-feed', 'papers', 0],
  ['raschka', 'Ahead of AI', 'https://magazine.sebastianraschka.com', 'paper-feed', 'research', 0],
  ['interconnects', 'Interconnects', 'https://www.interconnects.ai', 'paper-feed', 'research', 0],
  ['importai', 'Import AI', 'https://importai.substack.com', 'paper-feed', 'research', 0],
  ['batch', 'The Batch', 'https://www.deeplearning.ai/the-batch/', 'paper-feed', 'news', 0],
  // Open source
  ['gfi', 'Good First Issue', 'https://goodfirstissue.dev', 'tool', 'oss', 3],
  ['ufg', 'Up For Grabs', 'https://up-for-grabs.net', 'tool', 'oss', 3],
].map(([id, title, url, kind, tags, week]) => ({ id, title, url, kind, tags: tags.split(','), week }));

// Google Skills: monthly credits. Costs differ per badge and change; enter the real cost from each badge page.
// free: true = the course itself costs no credits.
export const SKILL_CREDITS_PER_MONTH = 35;
export const SKILL_BADGES = [
  { id: 'intro-genai', title: 'Introduction to Generative AI', free: true, week: 5 },
  { id: 'intro-llm', title: 'Introduction to Large Language Models', free: true, week: 5 },
  { id: 'attention', title: 'Attention Mechanism', free: true, week: 5 },
  { id: 'transformer-bert', title: 'Transformer Models and BERT Model', free: true, week: 5 },
  { id: 'responsible-ai', title: 'Introduction to Responsible AI', free: true, week: 10 },
  { id: 'prompt-vertex', title: 'Prompt Design in Vertex AI (skill badge)', free: false, week: 5 },
  { id: 'gemini-api', title: 'Explore Generative AI with the Vertex AI Gemini API (skill badge)', free: false, week: 6 },
  { id: 'streamlit', title: 'Develop GenAI Apps with Gemini and Streamlit (skill badge)', free: false, week: 6 },
  { id: 'mm-rag', title: 'Inspect Rich Documents with Gemini Multimodality and Multimodal RAG (skill badge)', free: false, week: 7 },
  { id: 'real-world', title: 'Build Real World AI Applications with Gemini and Imagen (skill badge)', free: false, week: 9 },
  { id: 'vector-search', title: 'Vector Search and Embeddings (course)', free: false, week: 6 },
];

// GitHub Student Developer Pack: verify each offer on education.github.com/pack; offers change.
export const PERKS = [
  ['copilot', 'GitHub Copilot Pro', 'Use for code review and repo maps, never in learning blocks'],
  ['codespaces', 'GitHub Codespaces (Pro hours)', 'Dev environment for OSS repos without local setup'],
  ['domain', 'Free .me domain for a year (Namecheap) or name.com domain', 'Point it at this app on GitHub Pages'],
  ['frontendmasters', 'Frontend Masters (6 months)', 'Optional: Python, Git and system design courses'],
  ['datacamp', 'DataCamp (3 months)', 'SQL and pandas practice in Week 2 and Week 6'],
  ['azure', 'Microsoft Azure credit', 'Azure OpenAI or a small VM for the Week 10 deploy'],
  ['digitalocean', 'DigitalOcean credit', 'Alternative host for Atlas v1.0'],
  ['heroku', 'Heroku credit', 'Simple deploy for the FastAPI service'],
  ['jetbrains', 'JetBrains IDEs (PyCharm Pro)', 'Debugger and profiler for Week 4'],
  ['mongodb', 'MongoDB Atlas credit', 'Try Atlas Vector Search as a RAG store comparison'],
  ['onepassword', '1Password (1 year)', 'Store your API keys and tokens safely'],
  ['interviewcake', 'Interview Cake', 'Extra DSA explanations for Week 12'],
].map(([id, title, use]) => ({ id, title, use }));

export const CHEATS = [
  { id: 'patterns', title: 'DSA pattern triggers', body: [
    ['Sorted array + target', 'Two pointers or binary search'],
    ['Contiguous subarray or substring', 'Sliding window'],
    ['Need O(1) lookup or counting', 'Hash map / set'],
    ['Next greater or matching brackets', 'Monotonic stack'],
    ['Top k, median, streaming', 'Heap'],
    ['Grid, islands, dependencies', 'BFS / DFS, topological sort'],
    ['All combinations or paths', 'Backtracking'],
    ['Optimal count over choices', 'Dynamic programming'],
    ['Overlapping ranges', 'Sort by start, then merge'],
    ['Prefix lookups', 'Trie'],
  ] },
  { id: 'bigo', title: 'Big-O at a glance', body: [
    ['dict / set get, add', 'O(1) average'],
    ['list append / pop end', 'O(1) amortized'],
    ['list insert / pop front', 'O(n); use collections.deque'],
    ['sort', 'O(n log n)'],
    ['heapq push / pop', 'O(log n)'],
    ['binary search', 'O(log n)'],
    ['BFS / DFS', 'O(V + E)'],
  ] },
  { id: 'solid', title: 'SOLID in one line each', body: [
    ['Single responsibility', 'One reason to change per class'],
    ['Open/closed', 'Add behaviour by new code, not edits'],
    ['Liskov substitution', 'Subtypes keep the parent\'s promises'],
    ['Interface segregation', 'Small Protocols beat fat base classes'],
    ['Dependency inversion', 'Depend on abstractions; inject them'],
  ] },
  { id: 'python', title: 'Python OOP essentials', body: [
    ['__init__ / __repr__ / __eq__', 'Construct, debug-print, compare'],
    ['@dataclass(frozen=True)', 'Value objects with less code'],
    ['typing.Protocol', 'Structural interfaces without inheritance'],
    ['@property', 'Computed attributes, keep encapsulation'],
    ['__iter__ + yield', 'Lazy pipelines over big data'],
    ['contextlib.contextmanager', 'Setup and teardown with "with"'],
    ['functools.cache', 'Memoize pure functions'],
  ] },
  { id: 'git', title: 'Git for contributors', body: [
    ['git switch -c fix/thing', 'New branch for each PR'],
    ['git fetch upstream && git rebase upstream/main', 'Stay current with the project'],
    ['git commit --fixup <sha>; git rebase -i --autosquash', 'Clean history before review'],
    ['git bisect start / good / bad', 'Find the commit that broke it'],
    ['git push --force-with-lease', 'Safe force-push to your PR branch'],
  ] },
  { id: 'rag', title: 'RAG checklist', body: [
    ['Chunking', 'Split on structure; 200-800 tokens; 10-20% overlap'],
    ['Retrieval', 'Hybrid BM25 + embeddings beats either alone'],
    ['Reranking', 'Rerank top 20-50 down to top 5'],
    ['Generation', 'Cite chunk ids; say "not found" when retrieval is empty'],
    ['Evals', 'recall@k for retrieval, judged faithfulness for answers'],
  ] },
  { id: 'evals', title: 'Eval metrics', body: [
    ['recall@k', 'Share of questions whose answer chunk is in the top k'],
    ['MRR', 'Mean of 1 / rank of the first relevant result'],
    ['Faithfulness', 'Answer claims supported by retrieved text'],
    ['LLM-as-judge', 'Binary pass/fail with a written rubric; check it against your labels'],
    ['Error analysis', 'Read 50 failures, tag causes, fix the biggest bucket'],
  ] },
  { id: 'prompting', title: 'Prompting for engineers', body: [
    ['Role + task + constraints', 'State all three, in that order'],
    ['Examples', '2-5 varied examples beat long instructions'],
    ['Structured output', 'JSON schema or Pydantic, validated, retried on failure'],
    ['Untrusted text', 'Wrap retrieved or user text in tags; never obey it'],
    ['Iterate on evals', 'Change one thing, re-run the set, keep what wins'],
  ] },
];

export const ACHIEVEMENTS = [
  ['first-day', 'First session', 'Log any session', s => s.daysLogged >= 1],
  ['week-streak', 'Seven straight', 'A 7-day streak', s => s.bestStreak >= 7],
  ['month-streak', 'Twenty-eight straight', 'A 28-day streak', s => s.bestStreak >= 28],
  ['comeback', 'Never missed twice', 'Return the day after a missed day', s => s.comebacks >= 1],
  ['full-week', 'Full week', '7 full sessions in one week', s => s.bestFullWeek >= 7],
  ['dsa-10', 'Ten problems', 'Solve 10 DSA problems', s => s.dsaSolved >= 10],
  ['dsa-30', 'Halfway list', 'Solve 30 DSA problems', s => s.dsaSolved >= 30],
  ['dsa-60', 'Whole list', 'Solve all 60 problems', s => s.dsaSolved >= 60],
  ['resolve-10', 'Remembered', '10 re-solves passed from memory', s => s.resolvesPassed >= 10],
  ['pr-open', 'First PR', 'Open your first open-source PR', s => s.prsOpened >= 1],
  ['pr-merge', 'Merged', 'Get an open-source PR merged', s => s.prsMerged >= 1],
  ['pr-3', 'Contributor', '3 merged PRs', s => s.prsMerged >= 3],
  ['paper-4', 'Reader', '4 paper notes', s => s.papers >= 4],
  ['paper-12', 'Researcher', '12 paper notes', s => s.papers >= 12],
  ['badge-1', 'First badge', 'Earn a Google Skills badge', s => s.badges >= 1],
  ['hours-40', 'Forty hours', '40 hours logged', s => s.hours >= 40],
  ['hours-120', 'One hundred twenty', '120 hours logged', s => s.hours >= 120],
  ['honest', 'Every claim backed', '20 days logged with a proof link', s => s.proofDays >= 20],
].map(([id, title, desc, test]) => ({ id, title, desc, test }));
