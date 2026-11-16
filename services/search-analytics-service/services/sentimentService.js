// Hugging Face API URLs/models can change. Set HF_INFERENCE_URL explicitly to
// an inference endpoint returning a sentiment label or label/score array.
async function classify(text) {
  const url = process.env.HF_INFERENCE_URL, token = process.env.HF_TOKEN;
  if (!url || !token) return { status: "not_configured", label: null, confidence: null };
  const endpoint = new URL(url);
  if (endpoint.protocol !== "https:") return { status: "unavailable", label: null, confidence: null };
  try {
    const response = await fetch(endpoint, {
      method: "POST", headers: { "authorization": `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ inputs: text }), signal: AbortSignal.timeout(7000)
    });
    if (!response.ok) return { status: "unavailable", label: null, confidence: null };
    const raw = await response.json();
    const candidates = Array.isArray(raw) ? (Array.isArray(raw[0]) ? raw[0] : raw) :
      Array.isArray(raw?.results) ? raw.results : [];
    const top = candidates.filter(x => typeof x?.label === "string" && Number.isFinite(Number(x?.score)))
      .sort((a,b) => b.score - a.score)[0];
    if (!top) return { status: "unavailable", label: null, confidence: null };
    return { status: "completed", label: top.label.slice(0,32), confidence: Number(top.score) };
  } catch { return { status: "unavailable", label: null, confidence: null }; }
}
module.exports = { classify };
