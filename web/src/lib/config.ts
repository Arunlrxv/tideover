import deployment from "../deployment.json";
import type { Deployment } from "./types";

export const D = deployment as Deployment;

// The last one refuses browsers (no CORS), so it only ever helps the server.
export const RPCS = ["https://rpc.testnet.fastnear.com", "https://near-testnet.drpc.org", "https://test.rpc.fastnear.com"];

export const EXPLORER = "https://testnet.nearblocks.io";
export const txUrl = (hash: string) => `${EXPLORER}/txns/${hash}`;
export const accountUrl = (id: string) => `${EXPLORER}/address/${id}`;

export const isDeployed = () => Boolean(D.fund);
