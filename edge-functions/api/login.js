// CloudBase NoSQL REST API - 登录（带诊断）
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

  return { ok: res.ok, status: res.status, data: data };
}

function parseDoc(doc) {
  if (typeof doc === 'string') {
    try { doc = JSON.parse(doc); } catch (e) { return null; }
  }
  if (doc._id && typeof doc._id === 'object' && doc._id.$oid) {
    doc._id = doc._id.$oid;
  }
  return doc;
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
      return json({ error: '请输入账号和密码' }, 400);
    }

    // Step 1: 查询用户
    var query = JSON.stringify({ username: username });
    var path = BASE_PATH + '/users/documents?query=' + encodeURIComponent(query) + '&limit=2';
    var r1 = await apiCall(context, 'GET', path);
    var docs = (r1.data && r1.data.data) ? r1.data.data : [];
    debugLog.push({ step: 'queryUser', status: r1.status, ok: r1.ok, docCount: docs.length, docType: docs.length > 0 ? typeof docs[0] : 'none' });

    if (docs.length === 0) {
      // 也查一下所有用户看看
      var r1b = await apiCall(context, 'GET', BASE_PATH + '/users/documents?limit=5');
      var totalUsers = (r1b.data && r1b.data.data) ? r1b.data.data.length : 0;
      debugLog.push({ step: 'queryAllUsers', status: r1b.status, total: totalUsers, firstDoc: totalUsers > 0 ? JSON.stringify(r1b.data.data[0]).substring(0, 200) : 'none' });
      return json({ error: '账号或密码错误', debug: debugLog }, 401);
    }

    var user = parseDoc(docs[0]);
    debugLog.push({
      step: 'parseDoc',
      hasSalt: !!(user && user.salt),
      saltLen: (user && user.salt) ? user.salt.length : 0,
      hasHash: !!(user && user.password_hash),
      hashLen: (user && user.password_hash) ? user.password_hash.length : 0,
      salt16: (user && user.salt) ? user.salt.substring(0, 16) : 'N/A',
      hash16: (user && user.password_hash) ? user.password_hash.substring(0, 16) : 'N/A',
    });

    if (!user || !user.salt || !user.password_hash) {
      return json({ error: '数据异常：用户记录不完整', debug: debugLog }, 500);
    }

    // Step 2: 验证密码
    var hashed = await hashPassword(password, user.salt);
    debugLog.push({ step: 'hashInput', computedHash16: hashed.substring(0, 16), match: hashed === user.password_hash });

    if (hashed !== user.password_hash) {
      return json({ error: '账号或密码错误', debug: debugLog }, 401);
    }

    return json({
      success: true,
      message: '登录成功',
      user: { id: user._id, username: user.username },
    });
  } catch (err) {
    return json({ error: err.message, debug: debugLog }, 500);
  }
}
