"use client";
import { useAccount, useConnect, useDisconnect } from "wagmi";
import { injected } from "wagmi/connectors";
import { Button } from "@/components/ui/Primitives";
import { shortAddr } from "@/lib/format";

export function WalletMenu() {
  const { address, isConnected } = useAccount();
  const { connect } = useConnect();
  const { disconnect } = useDisconnect();

  if (isConnected && address) {
    return (
      <Button variant="secondary" onClick={() => disconnect()} title="Wallet connected - Studionet">
        <span className="font-mono text-xs">{shortAddr(address)}</span>
      </Button>
    );
  }
  return (
    <Button variant="primary" onClick={() => connect({ connector: injected() })}>
      Connect Wallet
    </Button>
  );
}
