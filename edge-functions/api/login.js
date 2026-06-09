// 登录 API — 手机验证码登录（自动注册）
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
    var phone = (body.phone || '').trim();
    var code = (body.code || '').trim();

    if (!phone) return json({ error: '请输入手机号' }, 400);
    if (!code) return json({ error: '请输入验证码' }, 400);
    if (!/^1[3-9]\d{9}$/.test(phone)) return json({ error: '手机号格式不正确' }, 400);

    // 验证短信验证码
    try { await apiCall(context, 'POST', BASE, { collectionName: 'sms_codes' }); } catch (e) {}
    var codeDoc;
    try {
      codeDoc = await apiCall(context, 'GET', BASE + '/sms_codes/documents/' + encodeURIComponent(phone));
    } catch (e) {
      return json({ error: '请先获取验证码' }, 401);
    }

    if (!codeDoc || !codeDoc.code) return json({ error: '请先获取验证码' }, 401);
    if (Date.now() > codeDoc.expires_at) return json({ error: '验证码已过期，请重新获取' }, 401);

    var attempts = (codeDoc.attempts || 0) + 1;
    if (attempts > 5) {
      try { await apiCall(context, 'DELETE', BASE + '/sms_codes/documents/' + encodeURIComponent(phone)); } catch (e) {}
      return json({ error: '验证码尝试次数过多，请重新获取' }, 401);
    }

    if (codeDoc.code !== code) {
      // 更新失败次数
      try {
        await apiCall(context, 'DELETE', BASE + '/sms_codes/documents/' + encodeURIComponent(phone));
      } catch (e) {}
      await apiCall(context, 'POST', BASE + '/sms_codes/documents', {
        data: [{ _id: phone, code: codeDoc.code, expires_at: codeDoc.expires_at, sent_at: codeDoc.sent_at, attempts: attempts }],
      });
      return json({ error: '验证码错误' }, 401);
    }

    // 验证通过，删除验证码
    try { await apiCall(context, 'DELETE', BASE + '/sms_codes/documents/' + encodeURIComponent(phone)); } catch (e) {}

    // 查找或创建用户（手机号即 _id）
    try { await apiCall(context, 'POST', BASE, { collectionName: 'users' }); } catch (e) {}
    var user;
    var isNew = false;
    try {
      user = await apiCall(context, 'GET', BASE + '/users/documents/' + encodeURIComponent(phone));
    } catch (e) {
      // 用户不存在，自动注册
      user = { _id: phone, phone: phone, created_at: Date.now() };
      await apiCall(context, 'POST', BASE + '/users/documents', { data: [user] });
      isNew = true;
    }

    var userId = user._id;
    if (typeof userId === 'object' && userId.$oid) userId = userId.$oid;

    var secret = getEnv(context, 'AUTH_SECRET') || 'mcs_default_secret_2026';
    var token = await generateToken(userId, secret);

    return json({
      success: true,
      message: isNew ? '注册并登录成功' : '登录成功',
      token: token,
      user: { id: userId, phone: phone },
      isNew: isNew,
    });
  } catch (err) {
    return json({ error: err.message }, 500);
  }
}
