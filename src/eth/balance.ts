import { ERC20_INTERFACE } from "./erc20.js";
import type { FallbackRpcProvider } from "./rpcProvider.js";

/** ERC-20 balanceOf(address), as a raw base-unit bigint string. */
export async function getTokenBalance(
  rpc: FallbackRpcProvider,
  tokenAddress: string,
  wallet: string,
): Promise<string> {
  const data = ERC20_INTERFACE.encodeFunctionData("balanceOf", [wallet]);
  const result = await rpc.call({ to: tokenAddress, data });
  const [balance] = ERC20_INTERFACE.decodeFunctionResult("balanceOf", result);
  return (balance as bigint).toString();
}
