from pipeline.extract import extract_page, html_to_text, list_links, parse_feed, parse_hf_papers

RSS = b"""<?xml version="1.0"?><rss version="2.0"><channel><title>Blog</title>
<item><title>First &amp; best</title><link>https://ex.com/a?utm_source=rss</link><pubDate>Mon, 06 Oct 2025 19:00:00 GMT</pubDate>
<description><![CDATA[<p>Hello <script>evil()</script><b>world</b></p>]]></description></item>
<item><title>No date</title><link>https://ex.com/b</link></item>
<item><title>No link</title></item></channel></rss>"""
ATOM = b"""<?xml version="1.0" encoding="utf-8"?><feed xmlns="http://www.w3.org/2005/Atom"><title>A</title>
<entry><title>Atom post</title><link href="https://ex.com/atom-1"/><updated>2025-09-27T00:00:00+00:00</updated>
<content type="html">&lt;p&gt;Full body text here&lt;/p&gt;</content></entry></feed>"""
MALFORMED = b"<rss version='2.0'><channel><item><title>Fish & chips</title><link>https://ex.com/c</link></item><item><title>Ok</title><link>https://ex.com/d</link><description><p>unclosed</description></item>"
PAGE = """<html lang="en-GB"><head><title>Fallback</title><link rel="canonical" href="/posts/x">
<meta property="og:title" content="Real title"><meta property="og:description" content="Desc">
<meta property="og:image" content="https://ex.com/i.png"><meta property="article:published_time" content="2025-10-01T10:00:00Z">
<script type="application/ld+json">{"@type":"BlogPosting","author":{"name":"Ada"},"dateModified":"2025-10-02T10:00:00Z"}</script>
<script>var tracking=1;</script></head><body><nav>Menu items</nav><article><h1>Real title</h1><p>Body paragraph one.</p><p>Two.</p></article>
<footer>Copyright</footer><a href="/blog/1">1</a><a href="/blog/1">dup</a><a href="/blog/2">2</a><a href="/about">about</a></body></html>"""


def test_rss_parsing_and_cleaning():
    entries, title = parse_feed(RSS, "https://ex.com/feed")
    assert title == "Blog" and len(entries) == 2
    assert entries[0]["title"] == "First & best" and entries[0]["published_at"] == "2025-10-06T19:00:00Z"
    assert "evil" not in entries[0]["description"] and "world" in entries[0]["description"]
    assert entries[1]["published_at"] is None


def test_atom_with_only_updated_date():
    entries, _ = parse_feed(ATOM, "https://ex.com/atom")
    assert entries[0]["published_at"] is None and entries[0]["updated_at"] == "2025-09-27T00:00:00Z"
    assert entries[0]["content_text"] == "Full body text here"


def test_malformed_feed_recovers_what_it_can():
    entries, _ = parse_feed(MALFORMED, "https://ex.com/feed")
    assert any(e["url"] == "https://ex.com/d" for e in entries)


def test_page_extraction():
    p = extract_page(PAGE, "https://ex.com/posts/x?ref=home")
    assert p["title"] == "Real title" and p["canonical"] == "https://ex.com/posts/x" and p["author"] == "Ada"
    assert p["published_at"] == "2025-10-01T10:00:00Z" and p["updated_at"] == "2025-10-02T10:00:00Z"
    assert "Body paragraph one." in p["content_text"] and "Menu" not in p["content_text"] and "tracking" not in p["content_text"]
    assert p["language"] == "en-GB"


def test_page_with_missing_metadata_returns_none_not_guesses():
    p = extract_page("<html><body><p>Just text</p></body></html>", "https://ex.com/z")
    assert p["published_at"] is None and p["author"] is None and p["canonical"] is None


def test_list_links_dedupes_and_resolves():
    assert list_links(PAGE, "https://ex.com/blog", 'a[href^="/blog/"]::attr(href)', 10) == ["https://ex.com/blog/1", "https://ex.com/blog/2"]


def test_hf_papers():
    out = parse_hf_papers(b'[{"paper":{"id":"2510.00001","title":"T","summary":"S","authors":[{"name":"A"}],"publishedAt":"2025-10-01T00:00:00.000Z","upvotes":3}}]')
    assert out[0]["url"] == "https://arxiv.org/abs/2510.00001" and out[0]["votes"] == 3


def test_html_to_text_plain_passthrough():
    assert html_to_text("a &amp; b") == "a & b"
