// CloudBase NoSQL REST API - 用户配置 CRUD
function getEnv(context, name) {
  try { if (context && context.env && context.env[name]) return context.env[name]; } catch (_) {}
  return undefined;
}

var BASE_PATH = '/v1/database/instances/(default)/databases/(default)/collections';

async function apiCall(context, method, path, body) {
  var envId = getEnv(context, 'CLOUDBASE_ENV_ID');
  var apiKey = getEnv(context, 'CLOUDBASE_API_KEY');
  if (!envId) throw new Error('未配置 CLOUDBASE_ENV_ID');
  if (!apiKey) throw new Error('未配置 CLOUDBASE_API_KEY');

  var url = 'https://' + envId + '.api.tcloudbasegateway.com' + path;
  var options = {
    method: method,
    headers: { 'Authorization': 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
  };
  if (body) options.body = JSON.stringify(body);
  var res = await fetch(url, options);
  var data = await res.json();
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

async function ensureCollection(context, name) {
  try { await apiCall(context, 'POST', BASE_PATH, { collectionName: name }); } catch (e) {}
}

export default async function onRequest(context) {
  if (context.request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    });
  }

  try {
    var url = new URL(context.request.url);
    var userId = url.searchParams.get('userId');

    if (!userId) {
      return json({ error: '缺少 userId 参数' }, 400);
    }

    await ensureCollection(context, 'configs');

    if (context.request.method === 'GET') {
      // 获取用户配置
      var query = JSON.stringify({ userId: userId });
      var path = BASE_PATH + '/configs/documents?query=' + encodeURIComponent(query) + '&limit=1';
      var data = await apiCall(context, 'GET', path);

      if (data.data && data.data.length > 0) {
        var config = data.data[0];
        return json({ _id: config._id, intervals: config.intervals || [1, 3, 6, 13, 27] });
      }
      // 返回默认配置
      return json({ intervals: [1, 3, 6, 13, 27] });
    }

    if (context.request.method === 'POST') {
      var body = await context.request.json();

      // 先删除旧配置
      var query = JSON.stringify({ userId: userId });
      var existingPath = BASE_PATH + '/configs/documents?query=' + encodeURIComponent(query) + '&limit=1';
      try {
        var existing = await apiCall(context, 'GET', existingPath);
        if (existing.data && existing.data.length > 0) {
          var docId = existing.data[0]._id;
          // 删除旧文档
          var delPath = BASE_PATH + '/configs/documents/' + docId;
          try {
            await apiCall(context, 'DELETE', delPath);
          } catch (e) {}
        }
      } catch (e) {}

      // 插入新配置
      await apiCall(context, 'POST', BASE_PATH + '/configs/documents', {
        data: [{
          userId: userId,
          intervals: body.intervals || [1, 3, 6, 13, 27],
          updatedAt: Date.now(),
        }],
      });

      return json({ ok: true });
    }

    return json({ error: '不支持的请求方法' }, 405);
  } catch (err) {
    return json({ error: err.message || '服务器内部错误' }, 500);
  }
}
