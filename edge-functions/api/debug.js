function getEnv(context, name) {
  try { if (context && context.env && context.env[name]) return context.env[name]; } catch (_) {}
  return undefined;
}

export default async function onRequest(context) {
  var results = {};
  var envId = getEnv(context, 'CLOUDBASE_ENV_ID');
  var apiKey = getEnv(context, 'CLOUDBASE_API_KEY');

  results.env = {
    envId: envId ? envId.substring(0, 8) + '***' : '未设置',
    apiKey: apiKey ? '已设置(长度:' + apiKey.length + ')' : '未设置',
  };

  if (!envId || !apiKey) {
    results.error = '环境变量不完整';
    return new Response(JSON.stringify(results, null, 2), {
      status: 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  }

  var BASE = 'https://' + envId + '.api.tcloudbasegateway.com/v1/database/instances/(default)/databases/(default)/collections';
  var headers = { 'Authorization': 'Bearer ' + apiKey, 'Content-Type': 'application/json' };

  // Test 1: 创建 test_debug 集合
  try {
    var r1 = await fetch(BASE, { method: 'POST', headers: headers, body: JSON.stringify({ collectionName: 'test_debug' }) });
    var d1 = await r1.json();
    results.createCollection = { status: r1.status, ok: r1.ok, body: d1 };
  } catch (e) {
    results.createCollection = { error: e.message };
  }

  // Test 2: 插入一条测试文档
  try {
    var testDoc = { test_field: 'hello', ts: Date.now() };
    var r2 = await fetch(BASE + '/test_debug/documents', {
      method: 'POST',
      headers: headers,
      body: JSON.stringify({ data: [testDoc] }),
    });
    var d2 = await r2.json();
    results.insertDoc = { status: r2.status, ok: r2.ok, body: JSON.stringify(d2).substring(0, 500) };
  } catch (e) {
    results.insertDoc = { error: e.message };
  }

  // Test 3: 查询 test_debug 集合
  try {
    var r3 = await fetch(BASE + '/test_debug/documents?limit=5', { headers: headers });
    var d3 = await r3.json();
    results.queryTestDebug = {
      status: r3.status,
      ok: r3.ok,
      count: (d3.data && d3.data.length) || 0,
      firstDoc: d3.data && d3.data[0] ? JSON.stringify(d3.data[0]).substring(0, 300) : 'none',
    };
  } catch (e) {
    results.queryTestDebug = { error: e.message };
  }

  // Test 4: 查询 users 集合
  try {
    var r4 = await fetch(BASE + '/users/documents?limit=5', { headers: headers });
    var d4 = await r4.json();
    results.queryUsers = {
      status: r4.status,
      ok: r4.ok,
      count: (d4.data && d4.data.length) || 0,
      firstDoc: d4.data && d4.data[0] ? JSON.stringify(d4.data[0]).substring(0, 400) : 'none',
    };
  } catch (e) {
    results.queryUsers = { error: e.message };
  }

  // Test 5: 尝试不带 EJSON 包装直接 POST 到 users
  try {
    var testUser = { username: 'test_write_' + Date.now(), test: true };
    var r5 = await fetch(BASE + '/users/documents', {
      method: 'POST',
      headers: headers,
      body: JSON.stringify({ data: [testUser] }),
    });
    var d5 = await r5.json();
    results.insertUserTest = { status: r5.status, ok: r5.ok, body: JSON.stringify(d5).substring(0, 500) };
  } catch (e) {
    results.insertUserTest = { error: e.message };
  }

  // Test 6: 查询 users 确认
  try {
    var r6 = await fetch(BASE + '/users/documents?limit=5', { headers: headers });
    var d6 = await r6.json();
    results.queryUsersAfter = {
      status: r6.status,
      ok: r6.ok,
      count: (d6.data && d6.data.length) || 0,
      firstDoc: d6.data && d6.data[0] ? JSON.stringify(d6.data[0]).substring(0, 400) : 'none',
    };
  } catch (e) {
    results.queryUsersAfter = { error: e.message };
  }

  return new Response(JSON.stringify(results, null, 2), {
    status: 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}
