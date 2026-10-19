import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOURCES = ROOT / "sources"
STORE = ROOT / "data" / "store"
API = ROOT / "api" / "v1"

USER_AGENT = os.environ.get("APEX_USER_AGENT", "ApexBot/1.0 (+personal reading and job tracker; respects robots.txt)")
TIMEOUT = float(os.environ.get("APEX_TIMEOUT", "20"))
MAX_BYTES = int(os.environ.get("APEX_MAX_BYTES", str(6 * 1024 * 1024)))
PER_HOST_DELAY = float(os.environ.get("APEX_PER_HOST_DELAY", "1.0"))
WORKERS = int(os.environ.get("APEX_WORKERS", "6"))
RETRIES = int(os.environ.get("APEX_RETRIES", "3"))
MAX_REDIRECTS = 5
ARTICLE_RETENTION_DAYS = int(os.environ.get("APEX_ARTICLE_RETENTION_DAYS", "45"))
JOB_RETENTION_DAYS = int(os.environ.get("APEX_JOB_RETENTION_DAYS", "30"))
FULL_TEXT_CHARS = 12000      # text kept in memory for enrichment only; never published
DESCRIPTION_CHARS = 320      # excerpt published with each article
JOB_DESCRIPTION_CHARS = 6000
JOB_MAX_BYTES = int(os.environ.get("APEX_JOB_MAX_BYTES", str(80 * 1024 * 1024)))  # whole-board ATS responses
