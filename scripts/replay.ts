/**
 * Block replay: run the full parse pipeline against a real block and print
 * the alerts that would fire.
 *
 *   npm run replay -- <height> [wallet]
 */
import { loadConfig } from "../src/config.js";
import { RpcClient } from "../src/rpc.js";
import { parseTxToAlerts } from "../src/txParser.js";
import { formatAlert } from "../src/alerts.js";

const [, , heightArg, walletArg] = process.argv;
if (!heightArg) {
  console.error("usage: npm run replay -- <height> [wallet]");
  process.exit(1);
}

const config = loadConfig();
const wallets = new Set(walletArg ? [walletArg] : config.wallets);
const rpc = new RpcClient(config.rpcUrls);
const height = Number(heightArg);

const [block, results] = await Promise.all([
  rpc.getBlock(height),
  rpc.getBlockResults(height),
]);

console.log(`Block ${height}: ${block.txs.length} tx(s), watching ${[...wallets].join(", ")}\n`);

let total = 0;
block.txs.forEach((txBase64, i) => {
  const txResult = results.txsResults[i];
  if (!txResult) return;
  if (txResult.code !== 0) {
    console.log(`tx[${i}]: failed (code ${txResult.code}), skipped`);
    return;
  }
  const alerts = parseTxToAlerts({ txBase64, txResult, height, wallets });
  for (const alert of alerts) {
    total++;
    console.log(formatAlert(alert, config.explorerTxUrl).replace(/<[^>]+>/g, ""));
    console.log("---");
  }
});

console.log(`\n${total} alert(s) would fire.`);
