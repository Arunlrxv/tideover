import type { Account, FailoverRpcProvider, actions } from "near-api-js";

export function sendAndPoll(
  account: Account,
  provider: FailoverRpcProvider,
  receiverId: string,
  actions: ReturnType<(typeof actions)[keyof typeof actions]>[],
  seconds?: number,
): Promise<never>;
