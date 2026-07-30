import { Panel } from "./panel";

/**
 * The two flows, spelled out.
 *
 * The previous index explained nothing about how to take part, which is a real omission for a
 * mechanism people have not seen before: commit-reveal is not guessable from a list of raffles.
 * Numbered steps rather than prose because the order is the point.
 */

const PLAYER = [
  "Connect a wallet and take testnet RLO from the faucet",
  "Buy a ticket, which publishes a commitment to a secret only you hold",
  "Reveal that secret once the sale closes, or forfeit your bond",
  "The draw fires on its own and pays the winners",
];

const CREATOR = [
  "Put up a prize and set the ticket price, supply and winner count",
  "Choose how long the sale runs and how long reveals get",
  "Share the raffle, people buy in and commit",
  "Both deadlines are on chain already, so nothing needs watching",
];

function Steps({ label, steps }: { label: string; steps: string[] }) {
  return (
    <Panel label={label}>
      <ol className="divide-y divide-line">
        {steps.map((step, i) => (
          <li key={step} className="flex gap-3 px-6 py-3">
            <span className="tnum shrink-0 text-xs text-text-3">
              {String(i + 1).padStart(2, "0")}
            </span>
            <span className="text-xs leading-relaxed text-text-2">{step}</span>
          </li>
        ))}
      </ol>
    </Panel>
  );
}

export function HowItWorks() {
  return (
    <>
      <Steps label="For players" steps={PLAYER} />
      <Steps label="For creators" steps={CREATOR} />
    </>
  );
}
