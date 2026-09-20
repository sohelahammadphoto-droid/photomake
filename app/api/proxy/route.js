export const maxDuration = 60; // 60 seconds max duration

export async function POST(request) {
  try {
    const body = await request.json();
    const { targetUrl, image, filename } = body;

    if (!targetUrl) {
      return Response.json({ success: false, error: "targetUrl is required" }, { status: 400 });
    }

    const colabRes = await fetch(targetUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image, filename }),
    });

    const data = await colabRes.json();
    return Response.json(data, { status: colabRes.status });
  } catch (err) {
    return Response.json({ success: false, error: `Proxy Error: ${err.message}` }, { status: 500 });
  }
}
