// Converts Confluence storage format (the XHTML that Confluence Server/Data Center
// returns) into the small subset of ADF that Tie-Out's engine reads. Only used by
// the measurement script: the Forge app itself reads ADF straight from Confluence Cloud.

const ENT = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&nbsp;': ' ', '&ndash;': '–', '&mdash;': '—', '&rsquo;': '’', '&lsquo;': '‘', '&ldquo;': '“', '&rdquo;': '”' };
const unescape = (s) => s.replace(/&#(\d+);/g, (m, n) => String.fromCodePoint(+n)).replace(/&#x([0-9a-f]+);/gi, (m, n) => String.fromCodePoint(parseInt(n, 16))).replace(/&[a-z#0-9]+;/gi, (m) => ENT[m] ?? ' ');

const BROWSE = 'https://issues.apache.org/jira/browse/';

function inline(html) {
  const nodes = [];
  let rest = html;
  const push = (t) => { const text = unescape(t.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' '); if (text.trim()) nodes.push({ type: 'text', text }); else if (text && nodes.length) nodes.push({ type: 'text', text: ' ' }); };
  const re = /<ac:structured-macro[^>]*ac:name="jira"[^>]*>([\s\S]*?)<\/ac:structured-macro>|<a\s[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>|<time\s[^>]*datetime="(\d{4}-\d{2}-\d{2})"[^>]*\/?>|<ac:structured-macro[^>]*ac:name="status"[^>]*>([\s\S]*?)<\/ac:structured-macro>/g;
  let last = 0;
  let m;
  while ((m = re.exec(rest)) !== null) {
    push(rest.slice(last, m.index));
    last = m.index + m[0].length;
    if (m[1] !== undefined) {
      const key = /ac:name="key">\s*([A-Z][A-Z0-9]+-\d+)\s*</.exec(m[1]);
      if (key) nodes.push({ type: 'inlineCard', attrs: { url: BROWSE + key[1] } });
    } else if (m[2] !== undefined) {
      const label = unescape(m[3].replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ');
      if (label.trim()) nodes.push({ type: 'text', text: label, marks: [{ type: 'link', attrs: { href: unescape(m[2]) } }] });
    } else if (m[4] !== undefined) {
      nodes.push({ type: 'date', attrs: { timestamp: String(Date.parse(`${m[4]}T00:00:00Z`)) } });
    } else if (m[5] !== undefined) {
      const title = /ac:name="title">([^<]*)</.exec(m[5]);
      if (title) nodes.push({ type: 'status', attrs: { text: unescape(title[1]), color: 'neutral' } });
    }
  }
  push(rest.slice(last));
  return nodes;
}

function blocks(html) {
  // split on block boundaries; each piece becomes a paragraph
  return html
    .split(/<\/p>|<br\s*\/?>|<\/li>|<\/div>|<\/h[1-6]>|<p[^>]*>|<li[^>]*>|<div[^>]*>|<h[1-6][^>]*>|<\/?ul[^>]*>|<\/?ol[^>]*>/i)
    .map((piece) => inline(piece))
    .filter((content) => content.some((n) => n.type !== 'text' || n.text.trim()))
    .map((content) => ({ type: 'paragraph', content }));
}

export function storageToAdf(storage) {
  const content = [];
  const tableRe = /<table[^>]*>([\s\S]*?)<\/table>/g;
  let last = 0;
  let m;
  while ((m = tableRe.exec(storage)) !== null) {
    content.push(...blocks(storage.slice(last, m.index)));
    last = m.index + m[0].length;
    const rows = [...m[1].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map((r) => ({
      type: 'tableRow',
      content: [...r[1].matchAll(/<(t[dh])[^>]*>([\s\S]*?)<\/t[dh]>/g)].map((c) => {
        const paras = blocks(c[2]);
        return { type: c[1] === 'th' ? 'tableHeader' : 'tableCell', attrs: {}, content: paras.length ? paras : [{ type: 'paragraph', content: [] }] };
      }),
    })).filter((r) => r.content.length);
    if (rows.length) content.push({ type: 'table', attrs: {}, content: rows });
  }
  content.push(...blocks(storage.slice(last)));
  return { type: 'doc', version: 1, content };
}
