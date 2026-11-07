export type Manifest = {
  version: 1;
  id: string;
  title: string;
  description?: string;
  binding: { receiver_id: string; method_name: string; deposit: string; gas: string };
  fields: Record<string, unknown>[];
  args: Record<string, unknown>;
  summary?: string;
};

export function createFundTemplate(input: {
  factory: string;
  dao: string;
  token: string;
  deposit: string;
  rules: Record<string, unknown>;
  dues: string;
}): Manifest;
export function fundTemplates(fund: string): Manifest[];
