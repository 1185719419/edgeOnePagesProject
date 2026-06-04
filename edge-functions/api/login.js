// 登录 API - 用户名即文档 _id，按 ID 直读
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

async function hashPassword(password, salt) {
  var enc = new TextEncoder();
  var d = enc.encode(salt + password);
  for (var i = 0; i < 10000; i++) {
    d = new Uint8Array(await crypto.subtle.digest('SHA-256', d));
  }
  return Array.from(d).map(function(b) { return b.toString(16).padStart(2, '0'); }).join('');
}

function json(data, status) {
  status = status || 200;
  return new Response(JSON.stringify(data), {
    status: status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

export default async function onRequest(context) {
  if (context.request.method !== 'POST') {
    if (context.request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: {
        'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type',
      }});
    }
    return json({ error: '请使用 POST 请求' }, 405);
  }

  try {
    var body = await context.request.json();
    var username = body.username;
    var password = body.password;

    if (!username || !password) return json({ error: '请输入账号和密码' }, 400);

    // 按文档 ID 直读用户（用户名即为 _id）
    var user;
    try {
      user = await apiCall(context, 'GET', BASE + '/users/documents/' + encodeURIComponent(username));
    } catch (e) {
      return json({ error: '账号或密码错误' }, 401);
    }

    if (!user || !user.salt || !user.password_hash) {
      return json({ error: '账号或密码错误' }, 401);
    }

    // 验证密码
    var hashed = await hashPassword(password, user.salt);
    if (hashed !== user.password_hash) {
      return json({ error: '账号或密码错误' }, 401);
    }

    // 处理 EJSON _id
    var userId = user._id;
    if (typeof userId === 'object' && userId.$oid) userId = userId.$oid;

    return json({
      success: true,
      message: '登录成功',
      user: { id: userId, username: user.username },
    });
  } catch (err) {
    return json({ error: err.message }, 500);
  }
}
