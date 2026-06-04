export default function handler(request) {
  const url = new URL(request.url);
  const name = url.searchParams.get('name') || 'World';

  return new Response(
    JSON.stringify({
      greeting: `你好, ${name}!`,
      message: '这条消息来自 EdgeOne Pages Edge Function',
    }),
    {
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    }
  );
}
