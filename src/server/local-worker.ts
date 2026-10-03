import "server-only";
import { runDueAttempts } from "./assessments";
import { processLocalVideos } from "./local-video";
const state = globalThis as typeof globalThis & {
  dorosnaDeadlineWorker?: ReturnType<typeof setInterval>;
  dorosnaDeadlineBusy?: boolean;
};
export function startLocalWorker() {
  if (
    process.env.DOROSNA_LOCAL_ONLY !== "1" ||
    !process.env.DATABASE_URL ||
    state.dorosnaDeadlineWorker
  )
    return;
  async function tick() {
    if (state.dorosnaDeadlineBusy) return;
    state.dorosnaDeadlineBusy = true;
    try {
      await runDueAttempts();
      await processLocalVideos();
    } catch {
      console.error("Local deadline worker could not finish a batch.");
    } finally {
      state.dorosnaDeadlineBusy = false;
    }
  }
  state.dorosnaDeadlineWorker = setInterval(() => void tick(), 5000);
  state.dorosnaDeadlineWorker.unref();
  void tick();
}
