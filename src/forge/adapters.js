// Forge-backed implementations of the adapters core.js expects.
// This is the only file (with handlers.js) that talks to Atlassian APIs.

import api, { route } from '@forge/api';
import { kvs, WhereConditions } from '@forge/kvs';
import { reduceIssue } from '../engine/index.js';

const FIELDS = ['summary', 'status', 'assignee', 'duedate', 'fixVersions', 'priority', 'security'];

const client = (as) => (as === 'app' ? api.asApp() : api.asUser());

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function json(res, what) {
  if (!res.ok) {
    let body = '';
    try { body = await res.text(); } catch (e) { /* ignore */ }
    throw new HttpError(res.status, `${what} failed with ${res.status}: ${body.slice(0, 300)}`);
  }
  return res.json();
}

// ---- Jira ------------------------------------------------------------------

export const jira = {
  /** @returns {Promise<Record<string, object>>} reduced issues by key; unknown or hidden keys are absent */
  async getIssues(keys, as) {
    const out = {};
    for (let i = 0; i < keys.length; i += 100) {
      const chunk = keys.slice(i, i + 100);
      const res = await client(as).requestJira(route`/rest/api/3/issue/bulkfetch`, {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ issueIdsOrKeys: chunk, fields: FIELDS }),
      });
      if (res.ok) {
        const data = await res.json();
        for (const issue of data.issues || []) out[issue.key] = reduceIssue(issue);
      } else if (res.status === 400 || res.status === 404) {
        // Older sites or a rejected batch: fall back to one request per key.
        for (const key of chunk) {
          const one = await client(as).requestJira(route`/rest/api/3/issue/${key}?fields=${FIELDS.join(',')}`, { headers: { Accept: 'application/json' } });
          if (one.ok) {
            const issue = await one.json();
            out[issue.key] = reduceIssue(issue);
            if (issue.key !== key) out[key] = out[issue.key]; // moved issue: old key still resolves
          }
        }
      } else {
        await json(res, 'Reading Jira work items');
      }
    }
    return out;
  },

  async getChangelog(key, as) {
    const first = await json(
      await client(as).requestJira(route`/rest/api/3/issue/${key}/changelog?maxResults=100`, { headers: { Accept: 'application/json' } }),
      'Reading the change history',
    );
    if ((first.total || 0) <= 100) return first.values || [];
    const startAt = first.total - 100;
    const last = await json(
      await client(as).requestJira(route`/rest/api/3/issue/${key}/changelog?maxResults=100&startAt=${startAt}`, { headers: { Accept: 'application/json' } }),
      'Reading the change history',
    );
    return last.values || [];
  },

  /**
   * Work items for the sample page: ones with a due date and an owner first, then the most recent.
   * With a project key, only that project (for example a marketing or HR project).
   */
  async sampleIssues(limit, as, projectKey = null) {
    const scope = projectKey && /^[A-Z][A-Z0-9_]{0,19}$/.test(projectKey) ? `project = "${projectKey}" AND ` : '';
    const search = async (jql) => {
      const res = await client(as).requestJira(route`/rest/api/3/search/jql`, {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ jql, maxResults: limit, fields: FIELDS }),
      });
      const data = await json(res, 'Searching Jira');
      return (data.issues || []).map(reduceIssue);
    };
    const dated = await search(`${scope}duedate is not EMPTY AND assignee is not EMPTY ORDER BY updated DESC`);
    if (dated.length >= limit) return dated.slice(0, limit);
    const recent = await search(`${scope}updated >= -730d ORDER BY updated DESC`);
    const seen = new Set(dated.map((i) => i.key));
    return [...dated, ...recent.filter((i) => !seen.has(i.key))].slice(0, limit);
  },

  /** Projects the person can see, for the sample page picker. Business projects first. */
  async listProjects(as) {
    const res = await client(as).requestJira(route`/rest/api/3/project/search?maxResults=50&orderBy=name`, { headers: { Accept: 'application/json' } });
    const data = await json(res, 'Listing Jira projects');
    const rank = { business: 0, service_desk: 1, product_discovery: 2, software: 3 };
    return (data.values || [])
      .map((p) => ({ key: p.key, name: p.name, type: p.projectTypeKey || 'other' }))
      .sort((a, b) => ((rank[a.type] ?? 4) - (rank[b.type] ?? 4)) || a.name.localeCompare(b.name));
  },

  async recentIssues(limit, as) {
    const res = await client(as).requestJira(route`/rest/api/3/search/jql`, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ jql: 'updated >= -365d ORDER BY duedate DESC, updated DESC', maxResults: limit, fields: FIELDS }),
    });
    const data = await json(res, 'Searching Jira');
    return (data.issues || []).map(reduceIssue);
  },
};

// ---- Confluence ------------------------------------------------------------

function toPage(raw) {
  let doc = { type: 'doc', version: 1, content: [] };
  const value = raw.body && raw.body.atlas_doc_format && raw.body.atlas_doc_format.value;
  if (value) {
    try { doc = JSON.parse(value); } catch (e) { /* keep the empty document */ }
  }
  const links = raw._links || {};
  return {
    id: String(raw.id),
    title: raw.title,
    spaceId: raw.spaceId,
    version: raw.version ? raw.version.number : 1,
    doc,
    url: links.webui ? `/wiki${links.webui}` : null,
    // null when the response did not include labels (page lists); fetched separately when needed
    labels: raw.labels && Array.isArray(raw.labels.results) ? raw.labels.results.map((l) => l.name) : null,
    parentId: raw.parentId && (!raw.parentType || raw.parentType === 'page') ? String(raw.parentId) : null,
  };
}

export const confluence = {
  async getPage(id, as) {
    const res = await client(as).requestConfluence(route`/wiki/api/v2/pages/${id}?body-format=atlas_doc_format&include-labels=true`, { headers: { Accept: 'application/json' } });
    return toPage(await json(res, 'Reading the page'));
  },

  async updatePage(page, doc, message, as) {
    const res = await client(as).requestConfluence(route`/wiki/api/v2/pages/${page.id}`, {
      method: 'PUT',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: page.id,
        status: 'current',
        title: page.title,
        body: { representation: 'atlas_doc_format', value: JSON.stringify(doc) },
        version: { number: page.version + 1, message },
      }),
    });
    const data = await json(res, 'Updating the page');
    return { version: data.version ? data.version.number : page.version + 1 };
  },

  async listPages({ cursor, limit }, as) {
    const res = cursor
      ? await client(as).requestConfluence(route`/wiki/api/v2/pages?limit=${limit}&sort=-modified-date&status=current&body-format=atlas_doc_format&cursor=${cursor}`, { headers: { Accept: 'application/json' } })
      : await client(as).requestConfluence(route`/wiki/api/v2/pages?limit=${limit}&sort=-modified-date&status=current&body-format=atlas_doc_format`, { headers: { Accept: 'application/json' } });
    const data = await json(res, 'Listing pages');
    const nextLink = data._links && data._links.next;
    const m = nextLink ? /[?&]cursor=([^&]+)/.exec(nextLink) : null;
    return { pages: (data.results || []).map(toPage), next: m ? decodeURIComponent(m[1]) : null };
  },

  /** A page's parent and labels, without its body. */
  async getPageMeta(id, as) {
    const res = await client(as).requestConfluence(route`/wiki/api/v2/pages/${id}?include-labels=true`, { headers: { Accept: 'application/json' } });
    const raw = await json(res, 'Reading the page');
    return {
      id: String(raw.id),
      parentId: raw.parentId && (!raw.parentType || raw.parentType === 'page') ? String(raw.parentId) : null,
      labels: raw.labels && Array.isArray(raw.labels.results) ? raw.labels.results.map((l) => l.name) : [],
    };
  },

  async getLabels(id, as) {
    const res = await client(as).requestConfluence(route`/wiki/api/v2/pages/${id}/labels?limit=100`, { headers: { Accept: 'application/json' } });
    const data = await json(res, 'Reading page labels');
    return (data.results || []).map((l) => l.name);
  },

  async listSpaces(as) {
    const res = await client(as).requestConfluence(route`/wiki/api/v2/spaces?limit=50&status=current`, { headers: { Accept: 'application/json' } });
    const data = await json(res, 'Listing spaces');
    return (data.results || []).map((s) => ({ id: String(s.id), key: s.key, name: s.name, type: s.type }));
  },

  async createPage({ spaceId, title, doc }, as) {
    const res = await client(as).requestConfluence(route`/wiki/api/v2/pages`, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ spaceId, status: 'current', title, body: { representation: 'atlas_doc_format', value: JSON.stringify(doc) } }),
    });
    const data = await json(res, 'Creating the page');
    const links = data._links || {};
    return { id: String(data.id), title: data.title, url: links.webui ? `/wiki${links.webui}` : null };
  },
};

// ---- storage ---------------------------------------------------------------

export const store = {
  getPage: (id) => kvs.get(`page:${id}`),
  setPage: (id, value) => kvs.set(`page:${id}`, value),
  deletePage: (id) => kvs.delete(`page:${id}`),
  getIssue: (key) => kvs.get(`issue:${key}`),
  setIssue: (key, value) => (value.pageIds.length ? kvs.set(`issue:${key}`, value) : kvs.delete(`issue:${key}`)),
  getMeta: (name) => kvs.get(`meta:${name}`),
  setMeta: (name, value) => kvs.set(`meta:${name}`, value),
  async listPages(max = 500) {
    const out = [];
    let cursor;
    do {
      let q = kvs.query().where('key', WhereConditions.beginsWith('page:')).limit(100);
      if (cursor) q = q.cursor(cursor);
      const res = await q.getMany();
      for (const r of res.results) out.push(r.value);
      cursor = res.nextCursor;
    } while (cursor && out.length < max);
    return out;
  },
};

// ---- Teamwork Graph --------------------------------------------------------

const PAGE_CONTEXT = `
query tieout_pageContext($id: ID!) {
  confluencePageOwners(id: $id, first: 5) {
    edges { node { __typename ... on AtlassianUser { id } } }
  }
  confluencePageLinkedConfluencePages(id: $id, first: 25) {
    edges { node { __typename ... on ConfluencePage { id title } } }
  }
}`;

const tail = (ari) => String(ari || '').split('/').pop();

/** Who owns the page and which pages it links to, from Teamwork Graph. Null when the graph is not available. */
export function makeGraph(cloudId) {
  return {
    async pageContext(pageId) {
      if (!cloudId) return null;
      const id = `ari:cloud:confluence:${cloudId}:page/${pageId}`;
      const res = await api.asUser().requestTeamworkGraph(PAGE_CONTEXT, { id });
      if (!res.ok) return null;
      const body = await res.json();
      if (!body || !body.data) return null;
      const edges = (conn) => ((conn && conn.edges) || []).map((e) => e.node).filter(Boolean);
      return {
        source: 'teamwork-graph',
        owners: edges(body.data.confluencePageOwners).map((n) => ({ accountId: tail(n.id) })).filter((o) => o.accountId),
        linked: edges(body.data.confluencePageLinkedConfluencePages)
          .filter((n) => n.id)
          .map((n) => ({ id: tail(n.id), title: n.title || 'Untitled page' }))
          .filter((n) => n.id !== String(pageId)),
      };
    },
  };
}
