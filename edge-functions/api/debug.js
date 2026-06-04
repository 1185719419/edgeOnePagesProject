function getEnv(context, name) {
  try { if (context && context.env && context.env[name]) return context.env[name]; } catch (_) {}
  return undefined;
}

export default async function onRequest(context) {
  var results = {};

  // 0. context 结构
  results.context = {
    keys: context ? Object.keys(context) : [],
    hasEnv: !!(context && context.env),
    envType: context && context.env ? typeof context.env : 'undefined',
    envKeys: (context && context.env && typeof context.env === 'object') ? Object.keys(context.env) : [],
  };

  // 1. 环境变量检测
  var envId = getEnv(context, 'CLOUDBASE_ENV_ID');
  var apiKey = getEnv(context, 'CLOUDBASE_API_KEY');
  results.env = {
    CLOUDBASE_ENV_ID: envId ? envId.substring(0, 6) + '***' : '未设置',
    CLOUDBASE_API_KEY: apiKey ? '已设置(长度:' + apiKey.length + ')' : '未设置',
  };

  // 2. Crypto API 检测
  try {
    var enc = new TextEncoder();
    var hash = await crypto.subtle.digest('SHA-256', enc.encode('test'));
    var hex = Array.from(new Uint8Array(hash))
      .map(function(b) { return b.toString(16).padStart(2, '0'); })
      .join('');
    results.sha256 = { status: 'ok', test: hex.substring(0, 16) + '...' };
  } catch (e) {
    results.sha256 = { status: 'fail', error: e.message };
  }

  try {
    var key = await crypto.subtle.importKey('raw', enc.encode('test'), 'PBKDF2', false, ['deriveBits']);
    await crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt: enc.encode('salt'), iterations: 1000, hash: 'SHA-512' },
      key, 256
    );
    results.pbkdf2 = { status: 'ok' };
  } catch (e) {
    results.pbkdf2 = { status: 'fail', error: e.message };
  }

  // 3. CloudBase REST API 连通性测试
  if (envId && apiKey) {
    try {
      var url = 'https://' + envId + '.api.tcloudbasegateway.com/v1/database/instances/(default)/databases/(default)/collections/users/documents?limit=1';
      var res = await fetch(url, {
        headers: {
          'Authorization': 'Bearer ' + apiKey,
          'Content-Type': 'application/json',
        },
      });
      var data = await res.json();
      results.api_test = {
        status: res.ok ? 'ok' : 'fail',
        httpStatus: res.status,
        hasData: !!(data && data.data),
        itemCount: (data && data.data) ? data.data.length : 0,
        error: res.ok ? null : (data.message || data.error || ('HTTP ' + res.status)),
      };
    } catch (e) {
      results.api_test = { status: 'fail', error: e.message };
    }
  } else {
    results.api_test = { status: 'skipped', reason: '环境变量不完整' };
  }

  return new Response(JSON.stringify(results, null, 2), {
    status: 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}
