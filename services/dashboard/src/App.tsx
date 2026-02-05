import { useState, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { listWallets } from "@/api/stats";
import WalletManager from "@/components/WalletManager";
import ModeTotal from "@/components/ModeTotal";
import ModeCharts from "@/components/ModeCharts";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import { useSSE, PriceUpdate } from "@/hooks/useSSE";

export default function App() {
  const [trackedWallets, setTrackedWallets] = useLocalStorage<string[]>(
    "tracked_wallets",
    []
  );
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);
  const [isSSEConnected, setIsSSEConnected] = useState(false);
  const queryClient = useQueryClient();

  const handlePriceUpdate = useCallback(
    (data: PriceUpdate) => {
      setLastUpdatedAt(new Date(data.recordedAt));
      // Invalidate wallet queries to refetch with new data
      queryClient.invalidateQueries({ queryKey: ["wallets"] });
      // Invalidate history queries for this wallet
      queryClient.invalidateQueries({ queryKey: ["history", data.walletId] });
    },
    [queryClient]
  );

  useSSE({
    onPriceUpdate: handlePriceUpdate,
    onConnected: () => setIsSSEConnected(true),
    onDisconnected: () => setIsSSEConnected(false)
  });

  const { data: wallets = [] } = useQuery({
    queryKey: ["wallets"],
    queryFn: listWallets,
    refetchInterval: 30000
  });

  return (
    <div className="min-h-screen bg-background text-foreground overflow-x-hidden">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-6 sm:px-6 sm:py-10">
        <header className="flex flex-col gap-3">
          <p className="text-[10px] uppercase tracking-[0.4em] text-foreground/50 sm:text-xs">
            Portfolio Pulse
          </p>
          <h1 className="text-2xl font-semibold sm:text-3xl md:text-4xl">
            Your live wealth dashboard
          </h1>
          <p className="max-w-2xl text-sm text-foreground/60">
            Keep every wallet in one place, see your total balance, and drill
            down into history with cinematic charts.
          </p>
        </header>

      <ModeTotal
        wallets={wallets}
        trackedWallets={trackedWallets}
        lastUpdatedAt={lastUpdatedAt}
        isSSEConnected={isSSEConnected}
      />

      <ModeCharts
        wallets={wallets}
        trackedWallets={trackedWallets}
        lastUpdatedAt={lastUpdatedAt}
        isSSEConnected={isSSEConnected}
      />

      <WalletManager
        trackedWallets={trackedWallets}
        setTrackedWallets={setTrackedWallets}
      />
      </div>
    </div>
  );
}
