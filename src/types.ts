export interface Coin {
  denom: string;
  amount: string;
}

export interface RawEventAttribute {
  key: string;
  value: string;
  index?: boolean;
}

export interface RawEvent {
  type: string;
  attributes: RawEventAttribute[];
}

/** One entry of block_results.txs_results */
export interface TxResult {
  code: number;
  log?: string;
  events: RawEvent[];
}

interface AlertBase {
  height: number;
  txHash: string;
  /** The tracked wallet this alert is about */
  wallet: string;
}

export type Alert =
  | (AlertBase & {
      kind: "send";
      direction: "in" | "out";
      from: string;
      to: string;
      amounts: Coin[];
    })
  | (AlertBase & {
      kind: "ibc_transfer";
      sender: string;
      receiver: string;
      token: Coin;
    })
  | (AlertBase & {
      kind: "contract_call";
      sender: string;
      contract: string;
      action?: string;
      funds: Coin[];
    })
  | (AlertBase & {
      kind: "delegate";
      delegator: string;
      validator: string;
      amount: Coin;
    })
  | (AlertBase & {
      kind: "undelegate";
      delegator: string;
      validator: string;
      amount: Coin;
      completionTime?: string;
    })
  | (AlertBase & {
      kind: "redelegate";
      delegator: string;
      srcValidator: string;
      dstValidator: string;
      amount: Coin;
      completionTime?: string;
    })
  | (AlertBase & {
      kind: "withdraw_reward";
      delegator: string;
      validator: string;
      amounts: Coin[];
    });
