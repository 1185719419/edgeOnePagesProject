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

  // Test 5: 插入测试用户并记录 ID
  var insertedId = null;
  var testUsername = 'test_write_' + Date.now();
  try {
    var testUser = { username: testUsername, test: true };
    var r5 = await fetch(BASE + '/users/documents', {
      method: 'POST',
      headers: headers,
      body: JSON.stringify({ data: [testUser] }),
    });
    var d5 = await r5.json();
    if (d5.insertedIds && d5.insertedIds[0]) insertedId = d5.insertedIds[0];
    results.insertUserTest = { status: r5.status, ok: r5.ok, insertedId: insertedId, body: JSON.stringify(d5).substring(0, 300) };
  } catch (e) {
    results.insertUserTest = { error: e.message };
  }

  // Test 6a: 按 ID 直接读用户文档
  if (insertedId) {
    try {
      var r6a = await fetch(BASE + '/users/documents/' + insertedId, { headers: headers });
      var d6a = await r6a.json();
      results.getById = { status: r6a.status, ok: r6a.ok, found: !!(d6a && d6a.data), body: JSON.stringify(d6a).substring(0, 300) };
    } catch (e) {
      results.getById = { error: e.message };
    }
  }

  // Test 6b: 不带 filter 查询 users
  try {
    var r6b = await fetch(BASE + '/users/documents', { headers: headers });
    var d6b = await r6b.json();
    results.queryAllUsers = {
      status: r6b.status,
      ok: r6b.ok,
      count: (d6b.data && d6b.data.length) || 0,
      firstDoc: d6b.data && d6b.data[0] ? JSON.stringify(d6b.data[0]).substring(0, 300) : 'none',
    };
  } catch (e) {
    results.queryAllUsers = { error: e.message };
  }

  // Test 6: 测试用自定义 _id (用户名作为文档ID) 写入和读取
  var customId = 'user_test_' + Date.now();
  try {
    // 写入时指定 _id
    var docWithId = { _id: customId, username: customId, test: true, ts: Date.now() };
    var r7a = await fetch(BASE + '/users/documents', {
      method: 'POST',
      headers: headers,
      body: JSON.stringify({ data: [docWithId] }),
    });
    var d7a = await r7a.json();
    results.insertWithCustomId = { status: r7a.status, ok: r7a.ok, body: JSON.stringify(d7a).substring(0, 200) };

    // 用自定义 ID 直读
    var r7b = await fetch(BASE + '/users/documents/' + customId, { headers: headers });
    var d7b = await r7b.json();
    results.getByCustomId = { status: r7b.status, ok: r7b.ok, found: !!(d7b && d7b.data), body: JSON.stringify(d7b).substring(0, 300) };
  } catch (e) {
    results.customIdTest = { error: e.message };
  }

  return new Response(JSON.stringify(results, null, 2), {
    status: 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}
