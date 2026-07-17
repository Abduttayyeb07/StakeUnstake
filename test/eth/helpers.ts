import { ERC20_INTERFACE } from "../../src/eth/erc20.js";
import type { MinimalLog } from "../../src/eth/processLog.js";

// all checksums verified via ethers.getAddress() — never hand-type mixed-case addresses
export const TOKEN = "0xb2617246d0c6c0087f18703d576831899ca94f01";
export const WALLET1 = "0x12d4Af7f9D4d369d81e4b033585Be24929e95b35";
export const WALLET2 = "0x000000000000000000000000000000000000dEaD";
export const OTHER = "0xCE270e49B554c25956A996471187f5df9Efa9157";

let logCounter = 0;

/** Builds a Transfer-event log fixture the way ethers' Interface would encode it. */
export function makeTransferLog(
  from: string,
  to: string,
  amount: bigint,
  overrides: Partial<MinimalLog> = {},
): MinimalLog {
  const fragment = ERC20_INTERFACE.getEvent("Transfer")!;
  const eventLog = ERC20_INTERFACE.encodeEventLog(fragment, [from, to, amount]);
  return {
    topics: eventLog.topics,
    data: eventLog.data,
    transactionHash: overrides.transactionHash ?? `0x${(logCounter++).toString(16).padStart(64, "0")}`,
    index: overrides.index ?? 0,
    blockNumber: overrides.blockNumber ?? 1_000_000,
  };
}
