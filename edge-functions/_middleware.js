export default async function onRequest(request, context) {
  const start = Date.now();
  const response = await context.next();
  const duration = Date.now() - start;

  response.headers.set('X-Response-Time', `${duration}ms`);
  response.headers.set('X-Powered-By', 'EdgeOne Pages');

  console.log(`${request.method} ${request.url} - ${response.status} (${duration}ms)`);

  return response;
}
