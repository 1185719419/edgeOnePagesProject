function getEnv(name) {
  try {
    if (typeof process !== 'undefined' && process.env && process.env[name]) {
      return process.env[name];
    }
  } catch (_) {}
  return undefined;
}

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

async function tc3Sign(secretId, secretKey, service, host, action, payload) {
  const timestamp = Math.floor(Date.now() / 1000);
  const date = new Date(timestamp * 1000).toISOString().split('T')[0];
  const credentialScope = date + '/' + service + '/tc3_request';

  const canonicalHeaders = 'content-type:application/json\nhost:' + host + '\n';
  const signedHeaders = 'content-type;host';
  const hashedPayload = await sha256(payload);
  const canonicalRequest = 'POST\n/\n\n' + canonicalHeaders + '\n' + signedHeaders + '\n' + hashedPayload;

  const hashedCanonicalRequest = await sha256(canonicalRequest);
  const stringToSign = 'TC3-HMAC-SHA256\n' + timestamp + '\n' + credentialScope + '\n' + hashedCanonicalRequest;

  const secretDate = await hmacSha256('TC3' + secretKey, date);
  const secretService = await hmacSha256(secretDate, service);
  const secretSigning = await hmacSha256(secretService, 'tc3_request');
  const signature = await hmacSha256Hex(secretSigning, stringToSign);

  return {
    authorization: 'TC3-HMAC-SHA256 Credential=' + secretId + '/' + credentialScope + ', SignedHeaders=' + signedHeaders + ', Signature=' + signature,
    timestamp: timestamp,
  };
}

function json(data, status) {
  status = status || 200;
  return new Response(JSON.stringify(data, null, 2), {
    status: status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

export default async function onRequest(context) {
  var results = {};

  // 1. 测试环境变量
  var envId = getEnv('CLOUDBASE_ENV_ID');
  var secretId = getEnv('CLOUDBASE_SECRET_ID');
  var secretKey = getEnv('CLOUDBASE_SECRET_KEY');
  results.env = {
    CLOUDBASE_ENV_ID: envId ? envId.substring(0, 6) + '***' : '未设置',
    CLOUDBASE_SECRET_ID: secretId ? secretId.substring(0, 8) + '***' : '未设置',
    CLOUDBASE_SECRET_KEY: secretKey ? '已设置(长度:' + secretKey.length + ')' : '未设置',
  };

  // 2. 测试 crypto API
  try {
    var testHash = await sha256('test');
    results.crypto = { status: 'ok', sha256_test: testHash.substring(0, 16) + '...' };
  } catch (e) {
    results.crypto = { status: 'fail', error: e.message };
  }

  // 3. 测试 TCB API 连通性
  if (envId && secretId && secretKey) {
    try {
      var params = { EnvId: envId, Query: 'db.collection("users").limit(1).get()' };
      var payload = JSON.stringify(params);
      var host = 'tcb.tencentcloudapi.com';
      var service = 'tcb';
      var auth = await tc3Sign(secretId, secretKey, service, host, 'DatabaseQuery', payload);

      var response = await fetch('https://' + host + '/', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Host': host,
          'X-TC-Action': 'DatabaseQuery',
          'X-TC-Version': '2019-06-08',
          'X-TC-Timestamp': String(auth.timestamp),
          'X-TC-Region': getEnv('CLOUDBASE_REGION') || 'ap-guangzhou',
          'Authorization': auth.authorization,
        },
        body: payload,
      });

      var data = await response.json();
      results.tcb_api = {
        status: 'ok',
        responseCode: response.status,
        hasError: !!(data.Response && data.Response.Error),
        errorInfo: data.Response ? (data.Response.Error || null) : null,
        dataCount: data.Response && data.Response.Data ? data.Response.Data.length : 0,
      };
    } catch (e) {
      results.tcb_api = { status: 'fail', error: e.message };
    }
  } else {
    results.tcb_api = { status: 'skipped', reason: '环境变量未完整配置' };
  }

  // 4. 测试 PBKDF2
  try {
    var enc = new TextEncoder();
    var key = await crypto.subtle.importKey('raw', enc.encode('test'), 'PBKDF2', false, ['deriveBits']);
    var bits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt: enc.encode('salt'), iterations: 1000, hash: 'SHA-512' },
      key, 512
    );
    var hex = Array.from(new Uint8Array(bits))
      .map(function(b) { return b.toString(16).padStart(2, '0'); })
      .join('');
    results.pbkdf2 = { status: 'ok', test_hash: hex.substring(0, 16) + '...' };
  } catch (e) {
    results.pbkdf2 = { status: 'fail', error: e.message };
  }

  return json(results);
}
