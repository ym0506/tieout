"""Minimal outside MCP client for the Tie-Out tools: OAuth 2.1 (dynamic registration + PKCE),
then initialize, tools/list and two tool calls. Standard library only. The access token is
kept in memory and never printed or written to disk.

Usage: python3 scripts/mcp-check.py <output.json>   (Python 3, standard library only)
Prints the authorization URL, waits up to 6 minutes for the consent redirect on 127.0.0.1:8765.
"""
import base64, hashlib, http.server, json, os, secrets, ssl, sys, threading, time, urllib.parse, urllib.request

APP = '472dda99-d578-4070-b2ab-05a2797cf96b'
RESOURCE = f'https://mcp.atlassian.com/forge/{APP}'
REDIRECT = 'http://127.0.0.1:8765/callback'
CTX = ssl.create_default_context(cafile='/etc/ssl/cert.pem') if os.path.exists('/etc/ssl/cert.pem') else ssl.create_default_context()
OUT = sys.argv[1]


def req(url, data=None, headers=None, method=None, form=False):
    h = dict(headers or {})
    body = None
    if data is not None:
        if form:
            body = urllib.parse.urlencode(data).encode()
            h['Content-Type'] = 'application/x-www-form-urlencoded'
        else:
            body = json.dumps(data).encode()
            h['Content-Type'] = 'application/json'
    r = urllib.request.Request(url, data=body, headers=h, method=method or ('POST' if body else 'GET'))
    try:
        with urllib.request.urlopen(r, timeout=60, context=CTX) as res:
            return res.status, dict(res.headers), res.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), e.read().decode()


def rpc_body(text):
    """Streamable HTTP answers are JSON or an SSE stream; return the JSON-RPC message."""
    text = text.strip()
    if text.startswith('{'):
        return json.loads(text)
    msgs = [json.loads(line[5:].strip()) for line in text.splitlines() if line.startswith('data:') and line[5:].strip()]
    return msgs[-1] if msgs else {'raw': text[:500]}


meta = json.loads(req(f'https://mcp.atlassian.com/.well-known/oauth-protected-resource/forge/{APP}')[2])
issuer = meta['authorization_servers'][0]
u = urllib.parse.urlparse(issuer)
asm = json.loads(req(f'{u.scheme}://{u.netloc}/.well-known/oauth-authorization-server{u.path}')[2])

status, _, body = req(asm['registration_endpoint'], {
    'client_name': 'Tie-Out MCP check (local test)',
    'redirect_uris': [REDIRECT],
    'grant_types': ['authorization_code'],
    'response_types': ['code'],
    'token_endpoint_auth_method': 'none',
})
if status >= 300:
    sys.exit(f'registration failed {status}: {body[:300]}')
client_id = json.loads(body)['client_id']

verifier = base64.urlsafe_b64encode(secrets.token_bytes(48)).rstrip(b'=').decode()
challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b'=').decode()
state = secrets.token_urlsafe(16)
auth_url = asm['authorization_endpoint'] + '?' + urllib.parse.urlencode({
    'response_type': 'code', 'client_id': client_id, 'redirect_uri': REDIRECT,
    'code_challenge': challenge, 'code_challenge_method': 'S256', 'state': state, 'resource': RESOURCE,
})

got = {}


class H(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        got.update({k: v[0] for k, v in q.items()})
        self.send_response(200)
        self.send_header('Content-Type', 'text/plain; charset=utf-8')
        self.end_headers()
        self.wfile.write('Tie-Out MCP check: consent received. You can close this tab.'.encode())

    def log_message(self, *a):
        pass


srv = http.server.HTTPServer(('127.0.0.1', 8765), H)
threading.Thread(target=srv.serve_forever, daemon=True).start()
print('AUTH_URL ' + auth_url, flush=True)
deadline = time.time() + 360
while 'code' not in got and 'error' not in got and time.time() < deadline:
    time.sleep(0.5)
srv.shutdown()
if 'code' not in got or got.get('state') != state:
    sys.exit(f'no consent: {got.get("error", "timeout")}')

status, _, body = req(asm['token_endpoint'], {
    'grant_type': 'authorization_code', 'code': got['code'], 'redirect_uri': REDIRECT,
    'client_id': client_id, 'code_verifier': verifier, 'resource': RESOURCE,
}, form=True)
if status >= 300:
    sys.exit(f'token exchange failed {status}: {body[:300]}')
token = json.loads(body)['access_token']

H0 = {'Authorization': f'Bearer {token}', 'Accept': 'application/json, text/event-stream'}
log = {'checkedAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), 'endpoint': RESOURCE, 'client': 'local stdlib client, OAuth 2.1 + PKCE'}
status, hdrs, body = req(RESOURCE, {'jsonrpc': '2.0', 'id': 1, 'method': 'initialize', 'params': {
    'protocolVersion': '2025-06-18', 'capabilities': {}, 'clientInfo': {'name': 'tieout-mcp-check', 'version': '0.1'}}}, H0)
log['initialize'] = {'status': status, 'result': rpc_body(body).get('result', rpc_body(body))}
sid = {k.lower(): v for k, v in hdrs.items()}.get('mcp-session-id')
H1 = dict(H0, **({'Mcp-Session-Id': sid} if sid else {}))
proto = (log['initialize']['result'] or {}).get('protocolVersion')
if proto:
    H1['MCP-Protocol-Version'] = proto
req(RESOURCE, {'jsonrpc': '2.0', 'method': 'notifications/initialized'}, H1)

status, _, body = req(RESOURCE, {'jsonrpc': '2.0', 'id': 2, 'method': 'tools/list'}, H1)
tools = rpc_body(body)
log['tools/list'] = {'status': status, 'names': [t.get('name') for t in tools.get('result', {}).get('tools', [])], 'raw': tools if 'result' not in tools else None}

calls = [('get-fact', {'workItem': 'MOBL-57'}),
         ('verify-claims', {'text': 'MOBL-57 is due Nov 6, 2026 and is owned by Mitch Davis.'})]
names = log['tools/list']['names']
log['calls'] = []
for want, args in calls:
    name = next((n for n in names if n == want or n.endswith(want) or want in n), want)
    status, _, body = req(RESOURCE, {'jsonrpc': '2.0', 'id': 3 + len(log['calls']), 'method': 'tools/call', 'params': {'name': name, 'arguments': args}}, H1)
    log['calls'].append({'tool': name, 'arguments': args, 'status': status, 'response': rpc_body(body)})

with open(OUT, 'w', encoding='utf-8') as f:
    json.dump(log, f, ensure_ascii=False, indent=2)
print('DONE tools=' + ','.join(names), flush=True)
