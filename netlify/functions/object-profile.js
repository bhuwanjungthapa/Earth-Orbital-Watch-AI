export async function handler(event) {
  const norad = event.queryStringParameters?.norad;

  if (!norad) {
    return json({ error: "Missing NORAD catalog id." }, 400);
  }

  try {
    const [satcat, gp] = await Promise.allSettled([
      fetchJson(`https://celestrak.org/satcat/records.php?CATNR=${encodeURIComponent(norad)}&FORMAT=JSON`),
      fetchJson(`https://celestrak.org/NORAD/elements/gp.php?CATNR=${encodeURIComponent(norad)}&FORMAT=json`)
    ]);

    return json({
      norad,
      fetchedAt: new Date().toISOString(),
      satcat: satcat.status === "fulfilled" ? firstRecord(satcat.value) : null,
      gp: gp.status === "fulfilled" ? firstRecord(gp.value) : null,
      errors: [satcat, gp]
        .filter((result) => result.status === "rejected")
        .map((result) => result.reason instanceof Error ? result.reason.message : String(result.reason))
    });
  } catch (error) {
    return json(
      {
        norad,
        fetchedAt: new Date().toISOString(),
        satcat: null,
        gp: null,
        errors: [error instanceof Error ? error.message : "Unknown profile error"]
      },
      502
    );
  }
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      "user-agent": "Earth-Orbital-Watch-AI/0.1"
    }
  });

  if (!response.ok) {
    throw new Error(`${url} failed with ${response.status}`);
  }

  return response.json();
}

function firstRecord(value) {
  return Array.isArray(value) ? value[0] ?? null : value;
}

function json(payload, statusCode = 200) {
  return {
    statusCode,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
      "cache-control": "public, max-age=900, s-maxage=7200"
    },
    body: JSON.stringify(payload)
  };
}
