// 配置 API - 每个用户一个文档，用户 ID 作为文档 _id
function getEnv(context, name) {
  try { if (context && context.env && context.env[name]) return context.env[name]; } catch (_) {}
  return undefined;
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
    var userId = url.searchParams.get('userId');
    if (!userId) return json({ error: '缺少 userId 参数' }, 400);

    try { await apiCall(context, 'POST', BASE, { collectionName: 'configs' }); } catch (e) {}

    if (context.request.method === 'GET') {
      try {
        var data = await apiCall(context, 'GET', BASE + '/configs/documents/' + encodeURIComponent(userId));
        return json({ intervals: (data.intervals && data.intervals.length > 0) ? data.intervals : [1, 3, 6, 13, 27] });
      } catch (e) {
        return json({ intervals: [1, 3, 6, 13, 27] });
      }
    }

    if (context.request.method === 'POST') {
      var body = await context.request.json();

      try { await apiCall(context, 'DELETE', BASE + '/configs/documents/' + encodeURIComponent(userId)); } catch (e) {}

      await apiCall(context, 'POST', BASE + '/configs/documents', {
        data: [{ _id: userId, userId: userId, intervals: (body.intervals && body.intervals.length >= 5) ? body.intervals : [1, 3, 6, 13, 27], updated_at: Date.now() }],
      });

      return json({ ok: true });
    }

    return json({ error: '不支持的请求方法' }, 405);
  } catch (err) {
    return json({ error: err.message }, 500);
  }
}
