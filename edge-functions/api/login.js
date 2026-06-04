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
      return json({ error: '请输入账号和密码' }, 400);
    }

    var user = await findUserByUsername(context, username);

    if (!user) {
      return json({ error: '账号或密码错误' }, 401);
    }

    var hashed = await hashPassword(password, user.salt);
    if (hashed !== user.password_hash) {
      return json({ error: '账号或密码错误' }, 401);
    }

    return json({
      success: true,
      message: '登录成功',
      user: { id: user._id, username: user.username },
    });
  } catch (err) {
    return json({ error: err.message || '服务器内部错误' }, 500);
  }
}
