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

  // 2. Crypto 检测
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

  // 测试迭代 SHA-256 哈希一致性
  try {
    var enc = new TextEncoder();
    var data1 = enc.encode('salt12345' + 'password123');
    for (var i = 0; i < 100; i++) {
      data1 = new Uint8Array(await crypto.subtle.digest('SHA-256', data1));
    }
    var result1 = Array.from(data1).map(function(b) { return b.toString(16).padStart(2, '0'); }).join('');

    var data2 = enc.encode('salt12345' + 'password123');
    for (var j = 0; j < 100; j++) {
      data2 = new Uint8Array(await crypto.subtle.digest('SHA-256', data2));
    }
    var result2 = Array.from(data2).map(function(b) { return b.toString(16).padStart(2, '0'); }).join('');

    results.hash_consistency = {
      status: result1 === result2 ? 'ok (deterministic)' : 'FAIL (non-deterministic!)',
      hash: result1.substring(0, 16) + '...',
    };
  } catch (e) {
    results.hash_consistency = { status: 'fail', error: e.message };
  }

  // 检查用户文档格式
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
      if (data && data.data && data.data.length > 0) {
        var doc = data.data[0];
        results.user_sample = {
          type: typeof doc,
          isString: typeof doc === 'string',
          keys: typeof doc === 'object' ? Object.keys(doc).slice(0, 8) : null,
          hasSalt: typeof doc === 'object' ? !!(doc.salt) : null,
          hasPasswordHash: typeof doc === 'object' ? !!(doc.password_hash) : null,
          saltLen: (typeof doc === 'object' && doc.salt) ? doc.salt.length : 0,
          hashLen: (typeof doc === 'object' && doc.password_hash) ? doc.password_hash.length : 0,
        };
      } else {
        results.user_sample = { status: 'no users found' };
      }
    } catch (e) {
      results.user_sample = { status: 'error', error: e.message };
    }
  }

  return new Response(JSON.stringify(results, null, 2), {
    status: 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}
