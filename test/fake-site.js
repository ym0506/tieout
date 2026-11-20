// An in-memory Atlassian site that answers the REST calls Tie-Out makes.
// Used to test the Forge adapters and handlers end to end without a network.

const ok = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) });
const fail = (status, message = 'error') => ({ ok: false, status, json: async () => ({ message }), text: async () => message });

export function createFakeSite() {
  const site = {
    issues: {},          // key → Jira REST issue {key, fields}
    changelogs: {},      // key → histories[]
    pages: {},           // id → {id, title, spaceId, version, doc, deleted}
    spaces: [{ id: '100', key: 'TEAM', name: 'Team space', type: 'global' }],
    hiddenFromUser: new Set(),   // issue keys the current user may not see
    calls: [],
    kv: new Map(),
    nextPageId: 5000,
    graph: { owners: ['acc-owner'], linked: [] },
    twgAvailable: true,
  };

  const visible = (key, as) => site.issues[key] && !(as === 'user' && site.hiddenFromUser.has(key));

  const pageBody = (p) => ({
    id: p.id,
    title: p.title,
    spaceId: p.spaceId,
    version: { number: p.version },
    body: { atlas_doc_format: { value: JSON.stringify(p.doc) } },
    _links: { webui: `/spaces/TEAM/pages/${p.id}` },
  });

  async function jira(as, path, opts = {}) {
    site.calls.push({ product: 'jira', as, path, method: opts.method || 'GET' });
    const body = opts.body ? JSON.parse(opts.body) : null;
    if (path === '/rest/api/3/issue/bulkfetch') {
      const issues = body.issueIdsOrKeys.filter((k) => visible(k, as)).map((k) => site.issues[k]);
      return ok({ issues, issueErrors: [] });
    }
    let m = /^\/rest\/api\/3\/issue\/([^/?]+)\/changelog/.exec(path);
    if (m) {
      const key = decodeURIComponent(m[1]);
      if (!visible(key, as)) return fail(404);
      const values = site.changelogs[key] || [];
      return ok({ total: values.length, values });
    }
    m = /^\/rest\/api\/3\/issue\/([^/?]+)/.exec(path);
    if (m) {
      const key = decodeURIComponent(m[1]);
      return visible(key, as) ? ok(site.issues[key]) : fail(404);
    }
    if (path === '/rest/api/3/search/jql') {
      const issues = Object.values(site.issues).filter((i) => visible(i.key, as)).slice(0, body.maxResults);
      return ok({ issues });
    }
    return fail(404, `unhandled jira ${path}`);
  }

  async function confluence(as, path, opts = {}) {
    site.calls.push({ product: 'confluence', as, path, method: opts.method || 'GET' });
    const body = opts.body ? JSON.parse(opts.body) : null;
    let m = /^\/wiki\/api\/v2\/pages\/(\d+)/.exec(path);
    if (m) {
      const page = site.pages[m[1]];
      if (!page || page.deleted) return fail(404);
      if ((opts.method || 'GET') === 'PUT') {
        if (body.version.number !== page.version + 1) return fail(409, 'version conflict');
        page.doc = JSON.parse(body.body.value);
        page.version = body.version.number;
        page.lastMessage = body.version.message;
        page.lastEditedAs = as;
        return ok(pageBody(page));
      }
      return ok(pageBody(page));
    }
    if (path.startsWith('/wiki/api/v2/pages')) {
      if ((opts.method || 'GET') === 'POST') {
        const id = String(site.nextPageId++);
        site.pages[id] = { id, title: body.title, spaceId: body.spaceId, version: 1, doc: JSON.parse(body.body.value) };
        return ok(pageBody(site.pages[id]));
      }
      const q = new URLSearchParams(path.split('?')[1] || '');
      const limit = Number(q.get('limit') || 25);
      const start = Number(q.get('cursor') || 0);
      const all = Object.values(site.pages).filter((p) => !p.deleted);
      const slice = all.slice(start, start + limit);
      const next = start + limit < all.length ? `/wiki/api/v2/pages?cursor=${start + limit}&limit=${limit}` : undefined;
      return ok({ results: slice.map(pageBody), _links: next ? { next } : {} });
    }
    if (path.startsWith('/wiki/api/v2/spaces')) return ok({ results: site.spaces });
    return fail(404, `unhandled confluence ${path}`);
  }

  async function graph(query, variables) {
    site.calls.push({ product: 'graph', as: 'user', path: variables && variables.id });
    if (!site.twgAvailable) return fail(403);
    return ok({
      data: {
        confluencePageOwners: { edges: site.graph.owners.map((a) => ({ node: { __typename: 'AtlassianUser', id: `ari:cloud:identity::user/${a}` } })) },
        confluencePageLinkedConfluencePages: {
          edges: site.graph.linked.map((l) => ({ node: { __typename: 'ConfluencePage', id: `ari:cloud:confluence:cloud-1:page/${l.id}`, title: l.title } })),
        },
      },
    });
  }

  const clientFor = (as) => ({
    requestJira: (path, opts) => jira(as, path, opts),
    requestConfluence: (path, opts) => confluence(as, path, opts),
    requestTeamworkGraph: (query, variables) => graph(query, variables),
  });

  // What `route` returns in Forge is an object; here a plain encoded string is enough.
  const route = (strings, ...values) => strings.reduce((acc, s, i) => acc + s + (i < values.length ? encodeURIComponent(values[i]) : ''), '');

  const api = { asUser: () => clientFor('user'), asApp: () => clientFor('app') };

  const kvs = {
    get: async (k) => (site.kv.has(k) ? JSON.parse(site.kv.get(k)) : undefined),
    set: async (k, v) => { site.kv.set(k, JSON.stringify(v)); },
    delete: async (k) => { site.kv.delete(k); },
    query: () => {
      const state = { prefix: '', limit: 100, cursor: 0 };
      const q = {
        where: (prop, cond) => { state.prefix = cond.value; return q; },
        limit: (n) => { state.limit = n; return q; },
        cursor: (c) => { state.cursor = Number(c); return q; },
        getMany: async () => {
          const keys = [...site.kv.keys()].filter((k) => k.startsWith(state.prefix)).sort();
          const slice = keys.slice(state.cursor, state.cursor + state.limit);
          return {
            results: slice.map((k) => ({ key: k, value: JSON.parse(site.kv.get(k)) })),
            nextCursor: state.cursor + state.limit < keys.length ? String(state.cursor + state.limit) : undefined,
          };
        },
      };
      return q;
    },
  };
  const WhereConditions = { beginsWith: (value) => ({ condition: 'BEGINS_WITH', value }) };

  // helpers for tests
  site.addIssue = (key, over = {}) => {
    site.issues[key] = {
      key,
      fields: {
        summary: `Summary of ${key}`,
        duedate: '2026-12-17',
        assignee: { accountId: 'acc-jiyoung', displayName: 'Jiyoung Park' },
        status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } },
        fixVersions: [{ name: '2.4.0' }],
        priority: { name: 'High' },
        ...over,
      },
    };
    return site.issues[key];
  };
  site.addPage = (id, title, doc) => {
    site.pages[id] = { id: String(id), title, spaceId: '100', version: 1, doc };
    return site.pages[id];
  };

  return { site, api, route, kvs, WhereConditions };
}
