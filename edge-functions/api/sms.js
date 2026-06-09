// 短信验证码 API — 阿里云号码认证（Dypnsapi）
function getEnv(context, name) {
  try { if (context && context.env && context.env[name]) return context.env[name]; } catch (_) {}
  return undefined;
}

var BASE = '/v1/database/instances/(default)/databases/(default)/collections';

async function apiCall(context, method, path, body) {
  var envId = getEnv(context, 'CLOUDBASE_ENV_ID');
  var apiKey = getEnv(context, 'CLOUDBASE_API_KEY');
  if (!envId) throw new Error('未配置 CLOUDBASE_ENV_ID');
  if (!apiKey) throw new Error('未配置 CLOUDBASE_API_KEY');

  var url = 'https://' + envId + '.api.tcloudbasegateway.com' + path;
  var opts = { method: method, headers: { 'Authorization': 'Bearer ' + apiKey, 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  var res = await fetch(url, opts);
  var text = await res.text();
  var data = null;
  try { data = JSON.parse(text); } catch (e) { data = { _raw: text }; }
  if (!res.ok) throw new Error(data.message || data.error || ('HTTP ' + res.status));
  return data;
}

function json(data, status) {
  status = status || 200;
  return new Response(JSON.stringify(data), {
    status: status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

// 阿里云 API 签名
async function aliSign(params, secret) {
  var enc = new TextEncoder();
  var keys = Object.keys(params).sort();
  var qs = keys.map(function(k) {
    return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]);
  }).join('&');
  var stringToSign = 'GET&' + encodeURIComponent('/') + '&' + encodeURIComponent(qs);
  var key = await crypto.subtle.importKey(
    'raw', enc.encode(secret + '&'),
    { name: 'HMAC', hash: 'SHA-1' },
    false, ['sign']
  );
  var sig = await crypto.subtle.sign('HMAC', key, enc.encode(stringToSign));
  return btoa(String.fromCharCode.apply(null, new Uint8Array(sig)));
}

async function sendVerifyCode(phone, code, accessKeyId, accessKeySecret, signName, templateCode) {
  var now = new Date();
  var params = {
    AccessKeyId: accessKeyId,
    Action: 'SendSmsVerifyCode',
    Format: 'JSON',
    PhoneNumber: phone,
    RegionId: 'cn-hangzhou',
    SignName: signName,
    SignatureMethod: 'HMAC-SHA1',
    SignatureNonce: Date.now() + '' + Math.random(),
    SignatureVersion: '1.0',
    TemplateCode: templateCode,
    TemplateParam: JSON.stringify({ code: code, min: '5' }),
    Timestamp: now.toISOString().replace(/\.\d{3}Z$/, 'Z'),
    Version: '2017-05-25',
    Interval: '60',
    DuplicatePolicy: '1',
  };

  var signature = await aliSign(params, accessKeySecret);
  params.Signature = signature;

  var keys = Object.keys(params).sort();
  var qs = keys.map(function(k) {
    return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]);
  }).join('&');

  var url = 'https://dypnsapi.aliyuncs.com/?' + qs;
  var res = await fetch(url);
  var text = await res.text();
  var data = null;
  try { data = JSON.parse(text); } catch (e) { data = { _raw: text }; }
  return data;
}

export default async function onRequest(context) {
  if (context.request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: {
      'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type',
    }});
  }

  if (context.request.method !== 'POST') {
    return json({ error: '请使用 POST 请求' }, 405);
  }

  try {
    var body = await context.request.json();
    var phone = (body.phone || '').trim();

    if (!phone) return json({ error: '请输入手机号' }, 400);
    if (!/^1[3-9]\d{9}$/.test(phone)) return json({ error: '手机号格式不正确' }, 400);

    var accessKeyId = getEnv(context, 'SMS_ACCESS_KEY_ID');
    var accessKeySecret = getEnv(context, 'SMS_ACCESS_KEY_SECRET');
    var signName = getEnv(context, 'SMS_SIGN_NAME');
    var templateCode = getEnv(context, 'SMS_TEMPLATE_CODE');
    if (!accessKeyId || !accessKeySecret || !signName || !templateCode) {
      return json({ error: '短信服务未配置' }, 500);
    }

    // 60 秒内不能重复发送
    try { await apiCall(context, 'POST', BASE, { collectionName: 'sms_codes' }); } catch (e) {}
    try {
      var old = await apiCall(context, 'GET', BASE + '/sms_codes/documents/' + encodeURIComponent(phone));
      if (old && old.sent_at && (Date.now() - old.sent_at) < 65000) {
        return json({ error: '发送太频繁，请65秒后再试' }, 429);
      }
    } catch (e) {}

    // 生成 6 位验证码
    var code = '';
    for (var i = 0; i < 6; i++) { code += Math.floor(Math.random() * 10); }

    // 调用阿里云号码认证
    var result = await sendVerifyCode(phone, code, accessKeyId, accessKeySecret, signName, templateCode);

    if (result.Code !== 'OK') {
      return json({ error: '短信发送失败: ' + (result.Message || '未知错误') }, 500);
    }

    // 存储验证码到 CloudBase，5 分钟过期
    try { await apiCall(context, 'DELETE', BASE + '/sms_codes/documents/' + encodeURIComponent(phone)); } catch (e) {}
    await apiCall(context, 'POST', BASE + '/sms_codes/documents', {
      data: [{ _id: phone, code: code, expires_at: Date.now() + 300000, sent_at: Date.now(), attempts: 0 }],
    });

    return json({ success: true, message: '验证码已发送' });
  } catch (err) {
    return json({ error: err.message }, 500);
  }
}
