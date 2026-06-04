function getEnv(context, name) {
  // 方式1: context.env (Cloudflare Workers 风格)
  try {
    if (context.env && context.env[name]) {
      return context.env[name];
    }
  } catch (_) {}
  // 方式2: process.env (Node.js 风格)
  try {
    if (typeof process !== 'undefined' && process.env && process.env[name]) {
      return process.env[name];
    }
  } catch (_) {}
  // 方式3: 全局变量
  try {
    if (typeof globalThis !== 'undefined' && globalThis[name]) {
      return globalThis[name];
    }
  } catch (_) {}
  return undefined;
}

export default async function onRequest(context) {
  var results = {};

  // 0. 检查 context 结构
  results.context_keys = Object.keys(context || {});
  results.context_env_type = typeof (context.env);
  results.context_env_keys = (context.env && typeof context.env === 'object') ? Object.keys(context.env) : 'N/A';

  // 1. 测试环境变量（多方式）
  var envId = getEnv(context, 'CLOUDBASE_ENV_ID');
  var secretId = getEnv(context, 'CLOUDBASE_SECRET_ID');
  var secretKey = getEnv(context, 'CLOUDBASE_SECRET_KEY');
  results.env = {
    method: 'context.env + process.env + globalThis',
    CLOUDBASE_ENV_ID: envId ? envId.substring(0, 6) + '***' : '未设置',
    CLOUDBASE_SECRET_ID: secretId ? secretId.substring(0, 8) + '***' : '未设置',
    CLOUDBASE_SECRET_KEY: secretKey ? '已设置(长度:' + secretKey.length + ')' : '未设置',
  };

  // 2. 测试 crypto API
  try {
    var data = new TextEncoder().encode('test');
    var hash = await crypto.subtle.digest('SHA-256', data);
    var hex = Array.from(new Uint8Array(hash))
      .map(function(b) { return b.toString(16).padStart(2, '0'); })
      .join('');
    results.crypto = { status: 'ok', sha256: hex.substring(0, 16) + '...' };
  } catch (e) {
    results.crypto = { status: 'fail', error: e.message };
  }

  // 3. 测试 PBKDF2
  try {
    var enc = new TextEncoder();
    var key = await crypto.subtle.importKey('raw', enc.encode('test'), 'PBKDF2', false, ['deriveBits']);
    var bits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt: enc.encode('salt'), iterations: 1000, hash: 'SHA-512' },
      key, 512
    );
    results.pbkdf2 = { status: 'ok' };
  } catch (e) {
    results.pbkdf2 = { status: 'fail', error: e.message };
  }

  // 4. 测试 TCB API 连通性
  if (envId && secretId && secretKey) {
    try {
      var tc3 = await testTc3(secretId, secretKey, envId);
      results.tcb_api = tc3;
    } catch (e) {
      results.tcb_api = { status: 'fail', error: e.message };
    }
  } else {
    results.tcb_api = { status: 'skipped', reason: '环境变量不完整' };
  }

  return new Response(JSON.stringify(results, null, 2), {
    status: 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

async function testTc3(secretId, secretKey, envId) {
  var enc = new TextEncoder();

  async function sha256(msg) {
    var hash = await crypto.subtle.digest('SHA-256', enc.encode(msg));
    return Array.from(new Uint8Array(hash))
      .map(function(b) { return b.toString(16).padStart(2, '0'); })
      .join('');
  }

  async function hmacSha256(key, msg) {
    var k = typeof key === 'string' ? enc.encode(key) : key;
    var cryptoKey = await crypto.subtle.importKey('raw', k, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    var sig = await crypto.subtle.sign('HMAC', cryptoKey, enc.encode(msg));
    return new Uint8Array(sig);
  }

  async function hmacSha256Hex(key, msg) {
    var sig = await hmacSha256(key, msg);
    return Array.from(sig).map(function(b) { return b.toString(16).padStart(2, '0'); }).join('');
  }

  var host = 'tcb.tencentcloudapi.com';
  var service = 'tcb';
  var action = 'DatabaseQuery';
  var params = JSON.stringify({ EnvId: envId, Query: 'db.collection("users").limit(1).get()' });
  var timestamp = Math.floor(Date.now() / 1000);
  var date = new Date(timestamp * 1000).toISOString().split('T')[0];
  var credentialScope = date + '/' + service + '/tc3_request';

  var canonicalHeaders = 'content-type:application/json\nhost:' + host + '\n';
  var signedHeaders = 'content-type;host';
  var hashedPayload = await sha256(params);
  var canonicalRequest = 'POST\n/\n\n' + canonicalHeaders + '\n' + signedHeaders + '\n' + hashedPayload;

  var hashedCanonicalRequest = await sha256(canonicalRequest);
  var stringToSign = 'TC3-HMAC-SHA256\n' + timestamp + '\n' + credentialScope + '\n' + hashedCanonicalRequest;

  var secretDate = await hmacSha256('TC3' + secretKey, date);
  var secretService = await hmacSha256(secretDate, service);
  var secretSigning = await hmacSha256(secretService, 'tc3_request');
  var signature = await hmacSha256Hex(secretSigning, stringToSign);
  var authorization = 'TC3-HMAC-SHA256 Credential=' + secretId + '/' + credentialScope + ', SignedHeaders=' + signedHeaders + ', Signature=' + signature;

  var response = await fetch('https://' + host + '/', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Host': host,
      'X-TC-Action': action,
      'X-TC-Version': '2019-06-08',
      'X-TC-Timestamp': String(timestamp),
      'X-TC-Region': 'ap-guangzhou',
      'Authorization': authorization,
    },
    body: params,
  });

  var data = await response.json();
  return {
    status: 'ok',
    httpStatus: response.status,
    hasError: !!(data.Response && data.Response.Error),
    errorInfo: data.Response ? (data.Response.Error || null) : null,
    dataCount: data.Response && data.Response.Data ? data.Response.Data.length : 0,
  };
}
