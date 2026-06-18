// ─── Retry wrapper for native genai calls (handles 503) ───────────────────────
export async function withRetry<T>(
  fn: () => Promise<T>,
  retries = 3,
  delayMs = 2000
): Promise<T> {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (err: any) {
      if (err?.status === 503 && i < retries - 1) {
        console.log(`⚠️  503 received, retrying in ${delayMs}ms… (attempt ${i + 1})`);
        await new Promise((res) => setTimeout(res, delayMs));
      } else {
        throw err;
      }
    }
  }
  throw new Error("Max retries exceeded");
}
