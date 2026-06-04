// CloudBase NoSQL REST API - 用户注册（带完整诊断）
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
  var text = await res.text();
  var data = null;
  try { data = JSON.parse(text); } catch (e) { data = { _raw: text }; }

  return { ok: res.ok, status: res.status, data: data, url: url };
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

function json(data, status) {
  status = status || 200;
  return new Response(JSON.stringify(data, null, 2), {
    status: status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

export default async function onRequest(context) {
  if (context.request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    });
  }

  if (context.request.method !== 'POST') {
    return json({ error: '请使用 POST 请求' }, 405);
  }

  var debugLog = [];

  try {
    var body = await context.request.json();
    var username = body.username;
    var password = body.password;

    if (!username || !password) {
      return json({ error: '请填写账号和密码' }, 400);
    }

    if (password.length < 6) {
      return json({ error: '密码长度不能少于6位' }, 400);
    }

    // Step 1: 创建集合
    var r1 = await apiCall(context, 'POST', BASE_PATH, { collectionName: 'users' });
    debugLog.push({ step: 'ensureCollection', status: r1.status, ok: r1.ok, body: r1.data });

    // Step 2: 检查用户是否存在
    var query = JSON.stringify({ username: username });
    var checkPath = BASE_PATH + '/users/documents?query=' + encodeURIComponent(query) + '&limit=1';
    var r2 = await apiCall(context, 'GET', checkPath);
    debugLog.push({ step: 'checkExisting', status: r2.status, ok: r2.ok, found: (r2.data.data && r2.data.data.length > 0), dataKeys: r2.data.data ? r2.data.data.length : 0 });

    if (r2.data.data && r2.data.data.length > 0) {
      return json({ error: '该账号已被注册' }, 409);
    }

    // Step 3: 哈希密码
    var salt = generateSalt();
    var passwordHash = await hashPassword(password, salt);
    debugLog.push({ step: 'hashPassword', saltLen: salt.length, hashLen: passwordHash.length, salt16: salt.substring(0, 16), hash16: passwordHash.substring(0, 16) });

    // Step 4: 插入用户
    var userDoc = {
      username: username,
      password_hash: passwordHash,
      salt: salt,
      created_at: Date.now(),
    };
    var r3 = await apiCall(context, 'POST', BASE_PATH + '/users/documents', { data: [userDoc] });
    debugLog.push({ step: 'insertUser', status: r3.status, ok: r3.ok, body: r3.data, url: r3.url });

    // Step 5: 回读验证
    var r4 = await apiCall(context, 'GET', checkPath);
    var found = (r4.data.data && r4.data.data.length > 0);
    debugLog.push({ step: 'verifyInsert', status: r4.status, ok: r4.ok, found: found, dataSample: found ? JSON.stringify(r4.data.data[0]).substring(0, 200) : 'NOT FOUND' });

    if (found) {
      return json({ success: true, message: '注册成功', debug: debugLog });
    } else {
      return json({ error: '注册失败：数据未能写入数据库', debug: debugLog }, 500);
    }
  } catch (err) {
    return json({ error: err.message, debug: debugLog }, 500);
  }
}
