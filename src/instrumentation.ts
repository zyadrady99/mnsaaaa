export async function register() {
  if (
    process.env.NEXT_RUNTIME === "nodejs" &&
    process.env.DOROSNA_LOCAL_ONLY === "1"
  ) {
    const { startLocalWorker } = await import("./server/local-worker");
    startLocalWorker();
  }
}
