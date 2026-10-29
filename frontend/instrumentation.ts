// Runs once when a server instance starts, before it takes requests.
// Loading the embedding model here means the first rewrite on a fresh instance does not pay for it.
export async function register() {
  // The edge runtime has no file system, and nothing there embeds text
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  try {
    const { getEmbedder } = await import("@/lib/style/embedder");
    getEmbedder();
  } catch (error) {
    // A broken model must not stop the site: references are optional and fail soft
    console.error("Embedder preload failed", error);
  }
}
