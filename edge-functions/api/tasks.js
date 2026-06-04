// CloudBase NoSQL REST API - 任务 CRUD
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

// 确保集合存在
async function ensureCollection(context, name) {
  try { await apiCall(context, 'POST', BASE_PATH, { collectionName: name }); } catch (e) {}
}

export default async function onRequest(context) {
  if (context.request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
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

    // 确保集合存在
    await ensureCollection(context, 'tasks');

    if (context.request.method === 'GET') {
      // 获取用户所有任务
      var query = JSON.stringify({ userId: userId });
      var path = BASE_PATH + '/tasks/documents?query=' + encodeURIComponent(query) + '&limit=2000';
      var data = await apiCall(context, 'GET', path);

      // 按 dateKey 分组返回
      var tasks = {};
      var items = data.data || [];
      items.forEach(function(item) {
        var key = item.dateKey;
        if (!tasks[key]) tasks[key] = [];
        tasks[key].push({
          _id: item._id,
          text: item.text,
          isReview: item.isReview || false,
          originalDate: item.originalDate || null,
          createdAt: item.createdAt,
          images: item.images || [],
        });
      });

      return json(tasks);
    }

    if (context.request.method === 'POST') {
      var body = await context.request.json();
      var tasksObj = body.tasks;  // { "2026-06-03": [{...}, ...], ... }

      if (!tasksObj || typeof tasksObj !== 'object') {
        return json({ error: '请提供 tasks 数据' }, 400);
      }

      // 先删除该用户所有旧任务
      try {
        await apiCall(context, 'POST', BASE_PATH + '/tasks/documents/remove', {
          query: { userId: userId },
          multi: true,
        });
      } catch (e) {}

      // 批量插入所有任务
      var docs = [];
      Object.keys(tasksObj).forEach(function(dateKey) {
        var dayTasks = tasksObj[dateKey];
        if (!Array.isArray(dayTasks)) return;
        dayTasks.forEach(function(task) {
          docs.push({
            userId: userId,
            dateKey: dateKey,
            text: task.text || '',
            isReview: task.isReview || false,
            originalDate: task.originalDate || null,
            createdAt: task.createdAt || new Date().toISOString(),
            images: task.images || [],
          });
        });
      });

      if (docs.length > 0) {
        // 分批插入（CloudBase 可能限制单次插入数量）
        var batchSize = 50;
        for (var i = 0; i < docs.length; i += batchSize) {
          var batch = docs.slice(i, i + batchSize);
          await apiCall(context, 'POST', BASE_PATH + '/tasks/documents', {
            data: batch,
          });
        }
      }

      return json({ ok: true, count: docs.length });
    }

    return json({ error: '不支持的请求方法' }, 405);
  } catch (err) {
    return json({ error: err.message || '服务器内部错误' }, 500);
  }
}
