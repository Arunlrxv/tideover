// Custom proposal templates for Trezu. A treasury pastes one of these manifests into
// Trezu's template editor, and its members get a form that files an ordinary
// FunctionCall proposal. A template grants no power: the proposal still needs the DAO's
// normal votes. Trezu templates can only file function calls, so the role that lets the
// fund pay is still filed as its own proposal, and voted on in Trezu like any other.
const tgas = (n) => `${n}000000000000`;

/** The one that installs a fund. `rules` is complete apart from the dues, which the form sets. */
export function createFundTemplate({ factory, dao, token, deposit, rules, dues }) {
  return {
    version: 1,
    id: "tideover-create-fund",
    title: "Install Tideover: create the fund",
    description: "Creates a hardship fund for this treasury. It has no keys, and the money stays here.",
    binding: { receiver_id: factory, method_name: "create_fund", deposit, gas: tgas(220) },
    fields: [
      {
        name: "name",
        label: "Fund name",
        type: "text",
        required: true,
        help: "Becomes the fund's account name, so lowercase letters, numbers and hyphens only.",
        validation: { pattern: "^[a-z0-9-]+$" },
      },
      { name: "dues", label: "Monthly dues, in the token's smallest unit", type: "amount", required: true, default: dues },
      { name: "guardian", label: "Guardian", type: "account", required: true, help: "Can pause the fund or send a claim to the council." },
    ],
    args: { name: "{{name}}", dao, token, rules: { ...rules, dues: "{{dues}}" }, guardians: ["{{guardian}}"], registrar: null },
    summary: "Create the Tideover fund {{name}}",
  };
}

/** The everyday ones, for a fund that exists. */
export function fundTemplates(fund) {
  const call = (id, title, method_name, rest) => ({
    version: 1,
    id,
    title,
    binding: { receiver_id: fund, method_name, deposit: "0", gas: tgas(30) },
    ...rest,
  });
  return [
    call("tideover-admit-member", "Tideover: admit a member", "admit", {
      fields: [
        { name: "account", label: "Member's account", type: "account", required: true },
        {
          name: "prior_periods",
          label: "Months to carry over",
          type: "number",
          required: true,
          default: 0,
          help: "Their record so far in this community. It shows on the public records page.",
        },
      ],
      args: { account: "{{account}}", prior_periods: "{{prior_periods}}", commitment: null },
      summary: "Admit {{account}} with {{prior_periods}} months",
    }),
    call("tideover-set-rules", "Tideover: change the rules", "set_rules", {
      fields: [{ name: "rules", label: "Rules, as JSON", type: "json", required: true, help: "The whole rules object, as get_fund shows it." }],
      args: { rules: "{{rules}}" },
      summary: "Change the fund's rules",
    }),
    call("tideover-pin-clerk", "Tideover: pin a sealed clerk", "set_reviewer", {
      fields: [
        { name: "signer", label: "Clerk's signing key, hex", type: "text", required: true, validation: { pattern: "^[0-9a-f]{64}$" } },
        { name: "encryption_key", label: "Clerk's encryption key, hex", type: "text", required: true, validation: { pattern: "^[0-9a-f]{64}$" } },
        { name: "code_hash", label: "Build sha256, hex", type: "text", required: true, validation: { pattern: "^[0-9a-f]{64}$" } },
        { name: "prompt_sha256", label: "Prompt sha256, hex", type: "text", required: true, validation: { pattern: "^[0-9a-f]{64}$" } },
      ],
      args: { signer: "{{signer}}", encryption_key: "{{encryption_key}}", code_hash: "{{code_hash}}", prompt_sha256: "{{prompt_sha256}}" },
      summary: "Pin the clerk build {{code_hash}}",
    }),
    call("tideover-resume", "Tideover: resume after a pause", "resume", { fields: [], args: {}, summary: "Resume the fund" }),
  ];
}
