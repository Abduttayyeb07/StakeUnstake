import { Interface, zeroPadValue } from "ethers";

export const ERC20_INTERFACE = new Interface([
  "event Transfer(address indexed from, address indexed to, uint256 value)",
  "function balanceOf(address) view returns (uint256)",
]);

export const TRANSFER_TOPIC = ERC20_INTERFACE.getEvent("Transfer")!.topicHash;

/** Encodes an address as a 32-byte topic for use in an eth_getLogs indexed-param filter. */
export function addressTopic(address: string): string {
  return zeroPadValue(address.toLowerCase(), 32);
}
