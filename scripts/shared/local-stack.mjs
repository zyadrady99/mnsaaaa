// Keep the existing local Supabase workdir stable, including its Docker volumes.
export {
  localSettings,
  provider,
  projectRoot as localStackRoot,
} from "../../experiments/auth-spike/scripts/local-runtime.mjs";
