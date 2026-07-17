export interface TransferAlert {
  direction: "in" | "out";
  wallet: string;
  walletLabel?: string;
  from: string;
  to: string;
  /** raw token amount, base units (respects tokenDecimals) */
  amount: string;
  txHash: string;
  logIndex: number;
  blockNumber: number;
}
