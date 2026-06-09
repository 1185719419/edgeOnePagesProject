// 配置 API - 每个用户一个文档，用户 ID 作为文档 _id
function getEnv(context, name) {
  try { if (context && context.env && context.env[name]) return context.env[name]; } catch (_) {}
  return undefined;
}

async function hmacSign(data, secret) {
  var enc = new TextEncoder();
  var key = await crypto.subtle.importKey(
    'raw', enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false, ['sign']
  );
  var sig = await crypto.subtle.sign('HMAC', key, enc.encode(data));
  return Array.from(new Uint8Array(sig)).map(function(b) { return b.toString(16).padStart(2, '0'); }).join('');
}

async function validateToken(token, secret) {
  try {
    var decoded = atob(token);
    var parts = decoded.split(':');
    if (parts.length !== 3) return null;
    var userId = parts[0];
    var exp = parseInt(parts[1]);
    var sig = parts[2];
    if (Date.now() > exp) return null;
    var expected = await hmacSign(userId + ':' + exp, secret);
    return sig === expected ? userId : null;
  } catch (e) { return null; }
}

var BASE = '/v1/database/instances/(default)/databases/(default)/collections';

async function apiCall(context, method, path, body) {
  var envId = getEnv(context, 'CLOUDBASE_ENV_ID');
  var apiKey = getEnv(context, 'CLOUDBASE_API_KEY');
  if (!envId) throw new Error('未配置 CLOUDBASE_ENV_ID');
  if (!apiKey) throw new Error('未配置 CLOUDBASE_API_KEY');

  var url = 'https://' + envId + '.api.tcloudbasegateway.com' + path;
  var opts = { method: method, headers: { 'Authorization': 'Bearer ' + apiKey, 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  var res = await fetch(url, opts);
  var text = await res.text();
  var data = null;
  try { data = JSON.parse(text); } catch (e) { data = { _raw: text }; }
  if (!res.ok) throw new Error(data.message || data.error || ('HTTP ' + res.status));
  return data;
}

function json(data, status) {
  status = status || 200;
  return new Response(JSON.stringify(data), {
    status: status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

export default async function onRequest(context) {
  if (context.request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: {
      'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type',
    }});
  }

  try {
    var url = new URL(context.request.url);
    var authHeader = context.request.headers.get('Authorization') || '';
    var token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : (url.searchParams.get('token') || '');
    var secret = getEnv(context, 'AUTH_SECRET') || 'mcs_default_secret_2026';
    var userId = await validateToken(token, secret);
    if (!userId) return json({ error: '登录已过期，请重新登录' }, 401);

    try { await apiCall(context, 'POST', BASE, { collectionName: 'configs' }); } catch (e) {}

    if (context.request.method === 'GET') {
      try {
        var data = await apiCall(context, 'GET', BASE + '/configs/documents/' + encodeURIComponent(userId));
        var intervals = (data && data.intervals) ? data.intervals : null;
        if (!intervals && data && data.data && data.data.intervals) {
          intervals = data.data.intervals;
        }
        var valid = intervals && intervals.length >= 5;
        if (valid) {
          for (var i = 0; i < intervals.length; i++) {
            var v = intervals[i];
            if (typeof v !== 'number' || v < 1 || v > 365) { valid = false; break; }
          }
        }
        return json({ intervals: valid ? intervals : [2, 7, 14, 30, 60] });
      } catch (e) {
        return json({ intervals: [2, 7, 14, 30, 60] });
      }
    }

    if (context.request.method === 'POST') {
      var body = await context.request.json();

      try { await apiCall(context, 'DELETE', BASE + '/configs/documents/' + encodeURIComponent(userId)); } catch (e) {}

      await apiCall(context, 'POST', BASE + '/configs/documents', {
        data: [{ _id: userId, userId: userId, intervals: (body.intervals && body.intervals.length >= 5) ? body.intervals : [2, 7, 14, 30, 60], updated_at: Date.now() }],
      });

      return json({ ok: true });
    }

    return json({ error: '不支持的请求方法' }, 405);
  } catch (err) {
    return json({ error: err.message }, 500);
  }
}
