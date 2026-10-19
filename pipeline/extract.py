"""Turn fetched bytes into article candidates. Feeds via feedparser; pages via Scrapling's Selector."""
import html as htmllib
import json
import re

import feedparser
from scrapling.parser import Selector

from .normalize import clean_text, parse_date

DROP = "script, style, noscript, nav, footer, aside, form, header, svg, iframe"


def html_to_text(fragment: str) -> str:
    if not fragment:
        return ""
    if "<" not in fragment:
        return clean_text(htmllib.unescape(fragment))
    sel = Selector(f"<div id='x'>{fragment}</div>")
    for node in sel.css(DROP):
        _drop(node)
    root = sel.css("#x")
    return clean_text(root[0].get_all_text(separator=" ") if root else "")


def _drop(node):
    try:
        el = node._root if hasattr(node, "_root") else None
        if el is not None and el.getparent() is not None:
            el.getparent().remove(el)
    except Exception:
        pass


def parse_feed(body: bytes, base_url: str):
    """RSS and Atom. Returns (entries, feed_title). Malformed feeds return what feedparser recovered."""
    feed = feedparser.parse(body)
    out = []
    for e in feed.entries:
        link = e.get("link") or next((l.get("href") for l in e.get("links", []) if l.get("href")), None)
        if not link:
            continue
        content_html = ""
        if e.get("content"):
            content_html = max((c.get("value", "") for c in e.content), key=len)
        summary_html = e.get("summary", "")
        image = None
        for m in e.get("media_content", []) + e.get("media_thumbnail", []):
            if m.get("url"):
                image = m["url"]; break
        out.append({
            "title": clean_text(htmllib.unescape(e.get("title", ""))),
            "url": link,
            "author": clean_text(e.get("author", "")) or None,
            "published_at": parse_date(e.get("published_parsed") or e.get("published")),
            "updated_at": parse_date(e.get("updated_parsed") or e.get("updated")),
            "description": html_to_text(summary_html),
            "content_text": html_to_text(content_html) if content_html else "",
            "image_url": image,
        })
    return out, clean_text(feed.feed.get("title", ""))


def parse_hf_papers(body: bytes):
    out = []
    for p in json.loads(body or b"[]"):
        paper = p.get("paper") or {}
        pid = paper.get("id")
        if not pid:
            continue
        authors = [a.get("name") for a in paper.get("authors", []) if a.get("name")]
        out.append({
            "title": clean_text(paper.get("title") or p.get("title", "")),
            "url": f"https://arxiv.org/abs/{pid}",
            "author": ", ".join(authors[:4]) + (" et al." if len(authors) > 4 else "") if authors else None,
            "published_at": parse_date(paper.get("publishedAt") or p.get("publishedAt")),
            "updated_at": None,
            "description": clean_text(paper.get("summary", "")),
            "content_text": clean_text(paper.get("summary", "")),
            "image_url": p.get("thumbnail"),
            "votes": paper.get("upvotes", 0),
        })
    return out


def _first(sel, *queries):
    for q in queries:
        try:
            v = sel.css(q).get()
        except Exception:
            v = None
        if v and str(v).strip():
            return str(v).strip()
    return None


def _jsonld(sel):
    for raw in sel.css('script[type="application/ld+json"]::text').getall():
        try:
            data = json.loads(raw)
        except (ValueError, TypeError):
            continue
        items = data if isinstance(data, list) else data.get("@graph", [data]) if isinstance(data, dict) else []
        for it in items:
            if isinstance(it, dict) and any(t in str(it.get("@type", "")) for t in ("Article", "BlogPosting", "NewsArticle", "TechArticle")):
                return it
    return {}


def extract_page(html: str, url: str):
    """Metadata and main text from an article page. Missing fields come back as None, never guessed."""
    sel = Selector(html, url=url)
    ld = _jsonld(sel)
    author = ld.get("author")
    if isinstance(author, list):
        author = ", ".join(a.get("name", "") for a in author if isinstance(a, dict)) or None
    elif isinstance(author, dict):
        author = author.get("name")
    for node in sel.css(DROP):
        _drop(node)
    body = None
    for q in ("article", "main", '[role="main"]', ".post-content", ".entry-content", "body"):
        nodes = sel.css(q)
        if nodes:
            body = max(nodes, key=lambda n: len(n.get_all_text(separator=" "))).get_all_text(separator=" ")
            break
    canonical = _first(sel, 'link[rel="canonical"]::attr(href)', 'meta[property="og:url"]::attr(content)')
    return {
        "title": clean_text(_first(sel, 'meta[property="og:title"]::attr(content)', 'meta[name="twitter:title"]::attr(content)', "title::text", "h1::text") or ld.get("headline") or ""),
        "canonical": sel.urljoin(canonical) if canonical else None,
        "author": clean_text(author or _first(sel, 'meta[name="author"]::attr(content)', 'meta[property="article:author"]::attr(content)') or "") or None,
        "published_at": parse_date(ld.get("datePublished") or _first(sel, 'meta[property="article:published_time"]::attr(content)', "time::attr(datetime)")),
        "updated_at": parse_date(ld.get("dateModified") or _first(sel, 'meta[property="article:modified_time"]::attr(content)')),
        "description": clean_text(_first(sel, 'meta[property="og:description"]::attr(content)', 'meta[name="description"]::attr(content)') or ld.get("description") or ""),
        "image_url": _first(sel, 'meta[property="og:image"]::attr(content)'),
        "language": _first(sel, "html::attr(lang)"),
        "content_text": clean_text(body or ""),
    }


def list_links(html: str, url: str, selector: str, limit: int):
    sel = Selector(html, url=url)
    seen, out = set(), []
    for href in sel.css(selector).getall():
        full = sel.urljoin(href.strip())
        if full not in seen and full.rstrip("/") != url.rstrip("/"):
            seen.add(full); out.append(full)
        if len(out) >= limit:
            break
    return out
