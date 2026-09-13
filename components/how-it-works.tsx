import { Plate } from "./panel";

/**
 * The two flows, spelled out.
 *
 * Commit-reveal is not guessable from a list of raffles, so the mechanism gets said in words as well
 * as drawn in card stock. Numbered steps rather than prose because the order is the point, and a
 * plate rather than a ticket because this is reference material: it explains the objects, it is not
 * one of them.
 */

const PLAYER = [
  "Connect a wallet and take testnet RLO from the faucet",
  "Buy a ticket. Its drum half carries a commitment, and you keep the half the secret is printed on",
  "Present your half once the sale closes, or forfeit the bond held against it",
  "The draw fires on its own at the reveal deadline and pays the winners",
];

const CREATOR = [
  "Put up a prize and set the ticket price, supply and winner count",
  "Choose how long the sale runs and how long reveals get",
  "Share the raffle. Every ticket sold files one more commitment in the drum",
  "Both deadlines are on chain already, so nothing needs watching",
];

function Steps({ label, steps, index }: { label: string; steps: string[]; index: number }) {
  return (
    <Plate label={label} index={index}>
      <ol className="divide-y divide-line">
        {steps.map((step, i) => (
          <li key={step} className="flex gap-3 px-5 py-3.5">
            <span className="tnum shrink-0 text-xs text-text-3">
              {String(i + 1).padStart(2, "0")}
            </span>
            <span className="text-sm text-text-2">{step}</span>
          </li>
        ))}
      </ol>
    </Plate>
  );
}

export function HowItWorks({ index = 0 }: { index?: number }) {
  return (
    <>
      <Steps label="For players" steps={PLAYER} index={index} />
      <Steps label="For creators" steps={CREATOR} index={index + 1} />
    </>
  );
}
