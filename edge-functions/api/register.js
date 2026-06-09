// 注册 API - 用户名作为文档 _id，按 ID 直读（绕过列表查询权限问题）
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

async function generateToken(userId, secret) {
  var exp = Date.now() + 60000;
  var payload = userId + ':' + exp;
  var sig = await hmacSign(payload, secret);
  return btoa(payload + ':' + sig);
}

function generateSalt() {
  var arr = new Uint8Array(32);
  crypto.getRandomValues(arr);
  return Array.from(arr).map(function(b) { return b.toString(16).padStart(2, '0'); }).join('');
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

    if (!username || !password) return json({ error: '请填写账号和密码' }, 400);
    if (password.length < 6) return json({ error: '密码长度不能少于6位' }, 400);

    // IP 注册频率限制
    var ip = context.request.headers.get('x-forwarded-for') || context.request.headers.get('x-real-ip') || 'unknown';
    ip = ip.split(',')[0].trim();
    try { await apiCall(context, 'POST', BASE, { collectionName: 'reg_limits' }); } catch (e) {}
    var today = new Date().toISOString().slice(0, 10);
    var limitDocId = 'reg_' + ip + '_' + today;
    var limitCount = 0;
    try {
      var limitDoc = await apiCall(context, 'GET', BASE + '/reg_limits/documents/' + encodeURIComponent(limitDocId));
      var c = parseInt(limitDoc && limitDoc.count);
      if (!isNaN(c)) limitCount = c;
    } catch (e) {}
    if (limitCount >= 1) {
      return json({ error: '该设备今日注册次数已达上限（1次），请明天再试' }, 429);
    }

    // 确保 users 集合存在
    try { await apiCall(context, 'POST', BASE, { collectionName: 'users' }); } catch (e) {}

    // 检查用户名是否已存在（按 ID 直读）
    try {
      await apiCall(context, 'GET', BASE + '/users/documents/' + encodeURIComponent(username));
      return json({ error: '该账号已被注册' }, 409);
    } catch (e) {
      // 404 表示用户不存在，可以注册
    }

    // 创建用户，用用户名作为 _id
    var salt = generateSalt();
    var passwordHash = await hashPassword(password, salt);

    await apiCall(context, 'POST', BASE + '/users/documents', {
      data: [{
        _id: username,
        username: username,
        password_hash: passwordHash,
        salt: salt,
        created_at: Date.now(),
      }],
    });

    // 更新注册计数
    try {
      await apiCall(context, 'DELETE', BASE + '/reg_limits/documents/' + encodeURIComponent(limitDocId));
    } catch (e) {}
    await apiCall(context, 'POST', BASE + '/reg_limits/documents', {
      data: [{ _id: limitDocId, ip: ip, date: today, count: limitCount + 1 }],
    });

    // 生成 token 自动登录
    var secret = getEnv(context, 'AUTH_SECRET') || 'mcs_default_secret_2026';
    var token = await generateToken(username, secret);

    return json({ success: true, message: '注册成功', token: token, user: { id: username, username: username } });
  } catch (err) {
    return json({ error: err.message }, 500);
  }
}
