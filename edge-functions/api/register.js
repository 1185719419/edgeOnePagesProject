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

// 查询用户
async function findUserByUsername(context, username) {
  var query = JSON.stringify({ username: username });
  var path = BASE_PATH + '/users/documents?query=' + encodeURIComponent(query) + '&limit=1';
  var data = await apiCall(context, 'GET', path);
  return (data.data && data.data.length > 0) ? data.data[0] : null;
}

// 插入用户
async function insertUser(context, userDoc) {
  return apiCall(context, 'POST', BASE_PATH + '/users/documents', {
    data: [userDoc],
  });
}

// --- PBKDF2 密码哈希 (Web Crypto API) ---
async function hashPassword(password, salt) {
  var enc = new TextEncoder();
  var key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  var bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: enc.encode(salt), iterations: 100000, hash: 'SHA-512' },
    key, 512
  );
  return Array.from(new Uint8Array(bits))
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
