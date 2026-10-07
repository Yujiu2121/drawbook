import type { Metadata } from "next";
import type { ReactNode } from "react";

/*
  /create is a client page, and a client page cannot export metadata, so its tab read only the
  bare "Drawbook" while every other route names itself. This layout exists to carry the title and
  renders nothing of its own.
*/
export const metadata: Metadata = {
  title: "Deploy a raffle",
  description:
    "Put up a prize and set the terms of a Drawbook raffle on Rialo. The raffle program holds the money and enforces the terms.",
};

export default function CreateLayout({ children }: { children: ReactNode }) {
  return children;
}
