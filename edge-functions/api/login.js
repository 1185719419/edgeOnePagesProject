// 登录 API — 手机验证码 + 密码登录
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

function generateSalt() {
  var arr = new Uint8Array(32);
  crypto.getRandomValues(arr);
  return Array.from(arr).map(function(b) { return b.toString(16).padStart(2, '0'); }).join('');
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

async function verifyCode(context, phone, code) {
  try { await apiCall(context, 'POST', BASE, { collectionName: 'sms_codes' }); } catch (e) {}
  var codeDoc;
  try {
    codeDoc = await apiCall(context, 'GET', BASE + '/sms_codes/documents/' + encodeURIComponent(phone));
  } catch (e) { return { error: '请先获取验证码' }; }
  if (!codeDoc || !codeDoc.code) return { error: '请先获取验证码' };
  if (Date.now() > codeDoc.expires_at) return { error: '验证码已过期，请重新获取' };

  var attempts = (codeDoc.attempts || 0) + 1;
  if (attempts > 5) {
    try { await apiCall(context, 'DELETE', BASE + '/sms_codes/documents/' + encodeURIComponent(phone)); } catch (e) {}
    return { error: '验证码尝试次数过多，请重新获取' };
  }

  if (codeDoc.code !== code) {
    try { await apiCall(context, 'DELETE', BASE + '/sms_codes/documents/' + encodeURIComponent(phone)); } catch (e) {}
    await apiCall(context, 'POST', BASE + '/sms_codes/documents', {
      data: [{ _id: phone, code: codeDoc.code, expires_at: codeDoc.expires_at, sent_at: codeDoc.sent_at, attempts: attempts }],
    });
    return { error: '验证码错误' };
  }
  return { ok: true };
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
    var password = (body.password || '').trim();

    if (!phone) return json({ error: '请输入手机号' }, 400);
    if (!/^1[3-9]\d{9}$/.test(phone)) return json({ error: '手机号格式不正确' }, 400);

    try { await apiCall(context, 'POST', BASE, { collectionName: 'users' }); } catch (e) {}

    // ===== 手机号 + 密码登录 =====
    if (password && !code) {
      if (password.length < 6) return json({ error: '密码长度不能少于6位' }, 400);

      var user;
      try {
        user = await apiCall(context, 'GET', BASE + '/users/documents/' + encodeURIComponent(phone));
      } catch (e) {
        return json({ error: '账号不存在，请先注册' }, 401);
      }

      if (!user || !user.salt || !user.password_hash) {
        return json({ error: '该账号未设置密码，请用验证码登录' }, 401);
      }

      var hashed = await hashPassword(password, user.salt);
      if (hashed !== user.password_hash) {
        return json({ error: '密码错误' }, 401);
      }

      var uid = user._id;
      if (typeof uid === 'object' && uid.$oid) uid = uid.$oid;
      var secret = getEnv(context, 'AUTH_SECRET') || 'mcs_default_secret_2026';
      var token = await generateToken(uid, secret);

      return json({ success: true, message: '登录成功', token: token, user: { id: uid, phone: phone } });
    }

    // ===== 验证码校验 =====
    if (!code) return json({ error: '请输入验证码' }, 400);

    var codeResult = await verifyCode(context, phone, code);
    if (!codeResult.ok) return json({ error: codeResult.error }, 401);

    // 检查用户是否存在
    var existingUser = null;
    try {
      existingUser = await apiCall(context, 'GET', BASE + '/users/documents/' + encodeURIComponent(phone));
      // 处理 EJSON _id
      var eid = existingUser._id;
      if (typeof eid === 'object' && eid.$oid) existingUser._id = eid.$oid;
    } catch (e) {}

    // ===== 验证码 + 密码 → 创建账号或设置密码 =====
    if (password) {
      if (password.length < 6) return json({ error: '密码长度不能少于6位' }, 400);

      var salt = generateSalt();
      var pwHash = await hashPassword(password, salt);

      if (existingUser) {
        // 已有账号，更新密码
        try { await apiCall(context, 'DELETE', BASE + '/users/documents/' + encodeURIComponent(phone)); } catch (e) {}
        existingUser.salt = salt;
        existingUser.password_hash = pwHash;
        await apiCall(context, 'POST', BASE + '/users/documents', { data: [existingUser] });
      } else {
        // 新建账号
        await apiCall(context, 'POST', BASE + '/users/documents', {
          data: [{ _id: phone, phone: phone, password_hash: pwHash, salt: salt, created_at: Date.now() }],
        });
      }

      // 删除验证码
      try { await apiCall(context, 'DELETE', BASE + '/sms_codes/documents/' + encodeURIComponent(phone)); } catch (e) {}

      var userId = existingUser ? existingUser._id : phone;
      var secret2 = getEnv(context, 'AUTH_SECRET') || 'mcs_default_secret_2026';
      var token2 = await generateToken(userId, secret2);

      return json({
        success: true,
        message: existingUser ? '密码设置成功' : '注册成功',
        token: token2,
        user: { id: userId, phone: phone },
      });
    }

    // ===== 仅验证码校验 → 已有用户直接登录 =====
    if (existingUser) {
      try { await apiCall(context, 'DELETE', BASE + '/sms_codes/documents/' + encodeURIComponent(phone)); } catch (e) {}

      var uid2 = existingUser._id;
      var secret3 = getEnv(context, 'AUTH_SECRET') || 'mcs_default_secret_2026';
      var token3 = await generateToken(uid2, secret3);

      return json({
        success: true,
        message: '登录成功',
        token: token3,
        user: { id: uid2, phone: phone },
      });
    }

    // 用户不存在
    return json({ error: '账号不存在，请先注册' }, 401);

  } catch (err) {
    return json({ error: err.message }, 500);
  }
}
