// --- 环境变量 ---
function getEnv(context, name) {
  try { if (context && context.env && context.env[name]) return context.env[name]; } catch (_) {}
  return undefined;
}

// --- Crypto helpers ---
async function sha256(message) {
  var data = new TextEncoder().encode(message);
  var hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash))
    .map(function(b) { return b.toString(16).padStart(2, '0'); })
    .join('');
}

async function hmacSha256Hex(key, message) {
  var enc = new TextEncoder();
  var keyData = typeof key === 'string' ? enc.encode(key) : key;
  var cryptoKey = await crypto.subtle.importKey('raw', keyData, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  var sig = await crypto.subtle.sign('HMAC', cryptoKey, enc.encode(message));
  return Array.from(new Uint8Array(sig))
    .map(function(b) { return b.toString(16).padStart(2, '0'); })
    .join('');
}

// --- TC3 签名 ---
async function tc3Sign(secretId, secretKey, host, action, payload, timestamp) {
  var date = new Date(timestamp * 1000).toISOString().split('T')[0];
  var credentialScope = date + '/tcb/tc3_request';

  var canonicalHeaders = 'content-type:application/json\nhost:' + host + '\n';
  var signedHeaders = 'content-type;host';
  var hashedPayload = await sha256(payload);
  var canonicalRequest = 'POST\n/\n\n' + canonicalHeaders + '\n' + signedHeaders + '\n' + hashedPayload;

  var hashedCanonicalRequest = await sha256(canonicalRequest);
  var stringToSign = 'TC3-HMAC-SHA256\n' + timestamp + '\n' + credentialScope + '\n' + hashedCanonicalRequest;

  var kDate = await hmacSha256Hex('TC3' + secretKey, date);
  var kService = await hmacSha256Hex(kDate, 'tcb');
  var kSigning = await hmacSha256Hex(kService, 'tc3_request');
  var signature = await hmacSha256Hex(kSigning, stringToSign);

  return 'TC3-HMAC-SHA256 Credential=' + secretId + '/' + credentialScope + ', SignedHeaders=' + signedHeaders + ', Signature=' + signature;
}

// --- CloudBase TCB API ---
async function tcbApiCall(context, action, params) {
  var secretId = getEnv(context, 'CLOUDBASE_SECRET_ID');
  var secretKey = getEnv(context, 'CLOUDBASE_SECRET_KEY');
  var host = 'tcb.tencentcloudapi.com';

  if (!secretId || !secretKey) {
    throw new Error('CloudBase 凭证未配置，请在 EdgeOne 控制台设置环境变量');
  }

  var payload = JSON.stringify(params);
  var timestamp = Math.floor(Date.now() / 1000);
  var authorization = await tc3Sign(secretId, secretKey, host, action, payload, timestamp);

  var response = await fetch('https://' + host + '/', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Host': host,
      'X-TC-Action': action,
      'X-TC-Version': '2019-06-08',
      'X-TC-Timestamp': String(timestamp),
      'X-TC-Region': getEnv(context, 'CLOUDBASE_REGION') || 'ap-guangzhou',
      'Authorization': authorization,
    },
    body: payload,
  });

  var data = await response.json();

  if (data.Response && data.Response.Error) {
    throw new Error(data.Response.Error.Code + ': ' + data.Response.Error.Message);
  }

  return data;
}

// --- 数据库查询 ---
async function findUserByUsername(context, envId, username) {
  var safeName = username.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  var result = await tcbApiCall(context, 'DatabaseQuery', {
    EnvId: envId,
    Query: 'db.collection("users").where({username:"' + safeName + '"}).limit(1).get()',
  });

  var items = result.Response && result.Response.Data ? result.Response.Data : [];
  if (items.length === 0) return null;

  return typeof items[0] === 'string' ? JSON.parse(items[0]) : items[0];
}

// --- 插入用户 ---
async function insertUser(context, envId, userDoc) {
  return tcbApiCall(context, 'DatabaseAdd', {
    EnvId: envId,
    Query: 'db.collection("users").add(' + JSON.stringify(userDoc) + ')',
  });
}

// --- 密码哈希 ---
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

    var envId = getEnv(context, 'CLOUDBASE_ENV_ID');
    if (!envId) {
      return json({ error: '服务配置错误：缺少 CLOUDBASE_ENV_ID 环境变量' }, 500);
    }

    // 检查用户是否已存在
    var existing = await findUserByUsername(context, envId, username);
    if (existing) {
      return json({ error: '该账号已被注册' }, 409);
    }

    // 创建用户
    var salt = generateSalt();
    var passwordHash = await hashPassword(password, salt);

    await insertUser(context, envId, {
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
