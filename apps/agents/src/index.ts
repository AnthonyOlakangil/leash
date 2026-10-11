import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { loadEnv } from "./env.js";
import { bootChecks, publicClient } from "./chain.js";
import { chooseModel } from "./model.js";
import { makeChildren, type Ctx } from "./tree.js";
import { runScripted } from "./scripted.js";
import { runLive } from "./live.js";
import { endOfTodayPT, log, setPrefix } from "./util.js";

async function main() {
  const argv = process.argv.slice(2);
  const dry = argv.includes("--dry");
  const fresh = !argv.includes("--reuse-keys"); // fresh child keys (and budgets) every run unless asked
  const scripted = process.env.DEMO_SCRIPTED === "1" || argv.includes("--scripted");
  setPrefix(scripted ? "[SCRIPTED]" : "[LIVE]");

  if (argv.includes("--check-model")) {
    setPrefix("");
    const env = loadEnv(true);
    console.log(`model: ${await chooseModel(env.anthropicKey)}`);
    return;
  }

  const env = loadEnv(dry);
  if (dry && env.walletIsPlaceholder) log("LEASH_WALLET is empty: using a placeholder wallet address for the dry run only");

  let decimals = 6; // dry-run default; real runs read it from the token
  let model = "";
  if (!dry) {
    const pc0 = publicClient(env);
    ({ decimals } = await bootChecks(env, pc0));
    if (!scripted) {
      model = await chooseModel(env.anthropicKey);
      log(`model: ${model}`);
    }
  } else if (!scripted) {
    model = "(not checked in --dry)";
  }
  log(`${scripted ? "DEMO_SCRIPTED deterministic replay" : "LLM mode"}${dry ? " [DRY]" : ""}  wallet=${env.wallet}  decimals=${decimals}`);

  const rootKey = env.rootKey ?? generatePrivateKey();
  const ctx: Ctx = {
    env,
    pc: publicClient(env),
    decimals,
    dry,
    fresh,
    root: privateKeyToAccount(rootKey),
    rootId: 1n, // dry-run assumption; real runs read nodeOfKey(root)
    rootExpiry: endOfTodayPT(),
  };
  const children = makeChildren(env, decimals, dry, fresh);
  if (scripted) await runScripted(ctx, children);
  else await runLive(ctx, children, model);
}

main().catch((e) => {
  console.error(`ERROR: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
