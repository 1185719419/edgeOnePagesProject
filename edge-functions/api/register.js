// CloudBase NoSQL REST API 封装
// 文档: https://docs.cloudbase.net/http-api/nosql/nosql-restful-api

function getEnv(context, name) {
  try { if (context && context.env && context.env[name]) return context.env[name]; } catch (_) {}
  return undefined;
}

var BASE_PATH = '/v1/database/instances/(default)/databases/(default)/collections';

// 调用 CloudBase REST API
async function apiCall(context, method, path, body) {
  var envId = getEnv(context, 'CLOUDBASE_ENV_ID');
  var apiKey = getEnv(context, 'CLOUDBASE_API_KEY');

  if (!envId) throw new Error('未配置 CLOUDBASE_ENV_ID');
  if (!apiKey) throw new Error('未配置 CLOUDBASE_API_KEY，请在 CloudBase 控制台创建 API Key');

  var url = 'https://' + envId + '.api.tcloudbasegateway.com' + path;
  var options = {
    method: method,
    headers: {
      'Authorization': 'Bearer ' + apiKey,
      'Content-Type': 'application/json',
    },
  };
  if (body) {
    options.body = JSON.stringify(body);
  }

  var res = await fetch(url, options);
  var data = await res.json();

  if (!res.ok) {
    throw new Error(data.message || data.error || ('HTTP ' + res.status));
  }
  return data;
}

// 解析文档（处理 EJSON 和字符串格式）
function parseDoc(doc) {
  if (typeof doc === 'string') {
    try { doc = JSON.parse(doc); } catch (e) { return null; }
  }
  if (doc._id && typeof doc._id === 'object' && doc._id.$oid) {
    doc._id = doc._id.$oid;
  }
  return doc;
}

// 查询用户
async function findUserByUsername(context, username) {
  var query = JSON.stringify({ username: username });
  var path = BASE_PATH + '/users/documents?query=' + encodeURIComponent(query) + '&limit=1';
  try {
    var data = await apiCall(context, 'GET', path);
    if (data.data && data.data.length > 0) {
      return parseDoc(data.data[0]);
    }
    return null;
  } catch (e) {
    if (e.message && e.message.indexOf('not exist') !== -1) return null;
    throw e;
  }
}

// 确保集合存在（不存在则创建）
async function ensureCollection(context, name) {
  try {
    await apiCall(context, 'POST', BASE_PATH, { collectionName: name });
  } catch (e) {
    // 集合已存在或其他非致命错误，继续尝试插入
  }
}

// 插入用户
async function insertUser(context, userDoc) {
  return apiCall(context, 'POST', BASE_PATH + '/users/documents', {
    data: [userDoc],
  });
}

// --- SHA-256 迭代哈希（避免 PBKDF2 兼容性问题）---
async function hashPassword(password, salt) {
  var enc = new TextEncoder();
  var data = enc.encode(salt + password);
  for (var i = 0; i < 10000; i++) {
    data = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
  }
  return Array.from(data)
    .map(function(b) { return b.toString(16).padStart(2, '0'); })
    .join('');
}

function generateSalt() {
  var arr = new Uint8Array(32);
  crypto.getRandomValues(arr);
  return Array.from(arr).map(function(b) { return b.toString(16).padStart(2, '0'); }).join('');
}

// --- 响应 ---
function json(data, status) {
  status = status || 200;
  return new Response(JSON.stringify(data), {
    status: status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

// --- 主入口 ---
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

  try {
    var body = await context.request.json();
    var username = body.username;
    var password = body.password;

    if (!username || !password) {
      return json({ error: '请填写账号和密码' }, 400);
    }

    if (username.length < 2) {
      return json({ error: '账号长度不能少于2个字符' }, 400);
    }

    if (password.length < 6) {
      return json({ error: '密码长度不能少于6位' }, 400);
    }

    // 检查用户是否已存在
    var existing = await findUserByUsername(context, username);
    if (existing) {
      return json({ error: '该账号已被注册' }, 409);
    }

    // 确保 users 集合存在
    await ensureCollection(context, 'users');

    // 创建用户
    var salt = generateSalt();
    var passwordHash = await hashPassword(password, salt);

    await insertUser(context, {
      username: username,
      password_hash: passwordHash,
      salt: salt,
      created_at: Date.now(),
    });

    return json({ success: true, message: '注册成功' });
  } catch (err) {
    return json({ error: err.message || '服务器内部错误' }, 500);
  }
}
