export default function onRequest(context) {
  return new Response(
    JSON.stringify({
      time: new Date().toISOString(),
      unix: Date.now(),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    }),
    {
      headers: { 'Content-Type': 'application/json' },
    }
  );
}
