import { useState, useEffect } from "react";
import { Wallet } from "@/api/stats";
import { AnimatedPrice } from "@/components/AnimatedPrice";
import { Card, CardContent } from "@/components/ui/card";

interface ModeTotalProps {
  wallets: Wallet[];
  trackedWallets: string[];
  lastUpdatedAt?: Date | null;
  isSSEConnected?: boolean;
}

function formatRelativeTime(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

export default function ModeTotal({
  wallets,
  trackedWallets,
  lastUpdatedAt,
  isSSEConnected
}: ModeTotalProps) {
  const [relativeTime, setRelativeTime] = useState<string>("");

  const trackedSet = new Set(trackedWallets.map((item) => item.toLowerCase()));
  const total = wallets.reduce((sum, wallet) => {
    if (!trackedSet.has(wallet.address.toLowerCase())) {
      return sum;
    }
    return sum + (wallet.latestPriceUsd ?? 0);
  }, 0);

  // Update relative time every second
  useEffect(() => {
    if (!lastUpdatedAt) return;

    const update = () => setRelativeTime(formatRelativeTime(lastUpdatedAt));
    update();

    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [lastUpdatedAt]);

  return (
    <Card className="relative overflow-hidden bg-black/40">
      <CardContent className="flex min-h-[220px] flex-col items-center justify-center gap-3 text-center">
        <div className="flex items-center gap-2">
          <p className="text-xs uppercase tracking-[0.4em] text-foreground/60">
            Total balance
          </p>
          <span
            className={`h-2 w-2 rounded-full ${
              isSSEConnected ? "bg-green-500" : "bg-yellow-500"
            }`}
            title={isSSEConnected ? "Live updates active" : "Reconnecting..."}
          />
        </div>
        <div className="text-4xl font-semibold md:text-6xl">
          <AnimatedPrice value={total} duration={600} />
        </div>
        <p className="text-sm text-foreground/60">
          {lastUpdatedAt && relativeTime ? (
            <>Updated {relativeTime}</>
          ) : (
            <>Waiting for updates...</>
          )}
        </p>
      </CardContent>
    </Card>
  );
}
