// --- Crypto helpers ---
async function sha256(message) {
  const data = new TextEncoder().encode(message);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function hmacSha256(key, message) {
  const enc = new TextEncoder();
  const keyData = typeof key === 'string' ? enc.encode(key) : key;
  const cryptoKey = await crypto.subtle.importKey(
    'raw', keyData, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, enc.encode(message));
  return new Uint8Array(sig);
}

async function hmacSha256Hex(key, message) {
  const sig = await hmacSha256(key, message);
  return Array.from(sig).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// --- TC3-HMAC-SHA256 签名 ---
async function tc3Sign(secretId, secretKey, service, host, action, payload) {
  const timestamp = Math.floor(Date.now() / 1000);
  const date = new Date(timestamp * 1000).toISOString().split('T')[0];
  const credentialScope = `${date}/${service}/tc3_request`;

  const canonicalHeaders = `content-type:application/json\nhost:${host}\n`;
  const signedHeaders = 'content-type;host';
  const hashedPayload = await sha256(payload);
  const canonicalRequest = `POST\n/\n\n${canonicalHeaders}\n${signedHeaders}\n${hashedPayload}`;

  const hashedCanonicalRequest = await sha256(canonicalRequest);
  const stringToSign = `TC3-HMAC-SHA256\n${timestamp}\n${credentialScope}\n${hashedCanonicalRequest}`;

  const secretDate = await hmacSha256(`TC3${secretKey}`, date);
  const secretService = await hmacSha256(secretDate, service);
  const secretSigning = await hmacSha256(secretService, 'tc3_request');
  const signature = await hmacSha256Hex(secretSigning, stringToSign);

  return {
    authorization: `TC3-HMAC-SHA256 Credential=${secretId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    timestamp,
  };
}

// --- 调用 CloudBase TCB API ---
async function tcbApiCall(action, params) {
  const secretId = process.env.CLOUDBASE_SECRET_ID;
  const secretKey = process.env.CLOUDBASE_SECRET_KEY;
  const host = 'tcb.tencentcloudapi.com';
  const service = 'tcb';

  if (!secretId || !secretKey) {
    throw new Error('CloudBase 凭证未配置，请在 EdgeOne 控制台设置环境变量 CLOUDBASE_SECRET_ID 和 CLOUDBASE_SECRET_KEY');
  }

  const payload = JSON.stringify(params);
  const { authorization, timestamp } = await tc3Sign(secretId, secretKey, service, host, action, payload);

  const response = await fetch(`https://${host}/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Host': host,
      'X-TC-Action': action,
      'X-TC-Version': '2019-06-08',
      'X-TC-Timestamp': String(timestamp),
      'X-TC-Region': process.env.CLOUDBASE_REGION || 'ap-guangzhou',
      'Authorization': authorization,
    },
    body: payload,
  });

  const data = await response.json();

  if (data.Response && data.Response.Error) {
    throw new Error(`CloudBase API 错误: ${data.Response.Error.Code} - ${data.Response.Error.Message}`);
  }

  return data;
}

// --- 查询用户 ---
async function findUserByUsername(envId, username) {
  const result = await tcbApiCall('DatabaseQuery', {
    EnvId: envId,
    Query: `db.collection("users").where({username:"${username.replace(/"/g, '\\"')}"}).limit(1).get()`,
  });

  const items = result.Response?.Data || [];
  if (items.length === 0) return null;

  return typeof items[0] === 'string' ? JSON.parse(items[0]) : items[0];
}

// --- 密码哈希 ---
async function hashPassword(password, salt) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: enc.encode(salt), iterations: 100000, hash: 'SHA-512' },
    key, 512
  );
  return Array.from(new Uint8Array(bits))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function generateSalt() {
  const arr = new Uint8Array(32);
  crypto.getRandomValues(arr);
  return Array.from(arr).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// --- 响应工具 ---
function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

// --- 主处理函数 ---
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
    const { username, password } = await context.request.json();

    if (!username || !password) {
      return json({ error: '请输入账号和密码' }, 400);
    }

    const envId = process.env.CLOUDBASE_ENV_ID;
    if (!envId) {
      return json({ error: '服务配置错误：缺少 CLOUDBASE_ENV_ID' }, 500);
    }

    const user = await findUserByUsername(envId, username);

    if (!user) {
      return json({ error: '账号或密码错误' }, 401);
    }

    const hashed = await hashPassword(password, user.salt);
    if (hashed !== user.password_hash) {
      return json({ error: '账号或密码错误' }, 401);
    }

    return json({
      success: true,
      message: '登录成功',
      user: { id: user._id, username: user.username },
    });
  } catch (err) {
    console.error('Login error:', err);
    return json({ error: '服务器内部错误' }, 500);
  }
}
