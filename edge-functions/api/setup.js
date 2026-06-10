// 临时接口：创建小程序需要的数据库集合
function getEnv(context, name) {
  try { if (context && context.env && context.env[name]) return context.env[name]; } catch (_) {}
  return undefined;
}

export default async function onRequest(context) {
  var envId = getEnv(context, 'CLOUDBASE_ENV_ID');
  var apiKey = getEnv(context, 'CLOUDBASE_API_KEY');
  var BASE = 'https://' + envId + '.api.tcloudbasegateway.com/v1/database/instances/(default)/databases/(default)/collections';
  var headers = { 'Authorization': 'Bearer ' + apiKey, 'Content-Type': 'application/json' };
  var results = {};

  for (var name of ['quota', 'reminders']) {
    try {
      var res = await fetch(BASE, { method: 'POST', headers: headers, body: JSON.stringify({ collectionName: name }) });
      results[name] = res.ok ? 'ok' : ('HTTP ' + res.status);
    } catch (e) {
      results[name] = e.message;
    }
  }

  return new Response(JSON.stringify(results), {
    status: 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' },
  });
}
