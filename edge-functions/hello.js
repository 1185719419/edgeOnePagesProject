export default function onRequest(context) {
  return new Response(
    JSON.stringify({
      message: 'Hello from EdgeOne Pages Edge Function!',
      timestamp: Date.now(),
    }),
    {
      headers: {
        'Content-Type': 'application/json',
        'X-Powered-By': 'EdgeOne Pages',
      },
    }
  );
}
