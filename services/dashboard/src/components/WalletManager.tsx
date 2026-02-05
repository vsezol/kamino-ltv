import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createWallet, listWallets, Wallet } from "@/api/stats";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { Plus, Trash2 } from "lucide-react";

interface WalletManagerProps {
  trackedWallets: string[];
  setTrackedWallets: (wallets: string[]) => void;
}

export default function WalletManager({
  trackedWallets,
  setTrackedWallets
}: WalletManagerProps) {
  const [value, setValue] = useState("");
  const queryClient = useQueryClient();

  const { data: wallets = [] } = useQuery({
    queryKey: ["wallets"],
    queryFn: listWallets,
    refetchInterval: 60000
  });

  const walletMap = useMemo(() => {
    const map = new Map<string, Wallet>();
    wallets.forEach((wallet) => map.set(wallet.address.toLowerCase(), wallet));
    return map;
  }, [wallets]);

  const { mutateAsync, isPending } = useMutation({
    mutationFn: (address: string) => createWallet(address),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["wallets"] })
  });

  const addWallet = async () => {
    const address = value.trim();
    if (!address) return;

    if (!trackedWallets.includes(address)) {
      setTrackedWallets([...trackedWallets, address]);
    }

    try {
      await mutateAsync(address);
      setValue("");
    } catch {
      // keep local entry even if API fails
    }
  };

  const removeWallet = (address: string) => {
    setTrackedWallets(trackedWallets.filter((item) => item !== address));
  };

  return (
    <Card className="bg-black/20">
      <CardHeader>
        <CardTitle>Tracked wallets</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:gap-3">
          <Input
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder="Paste wallet address"
          />
          <Button onClick={addWallet} disabled={isPending}>
            <Plus className="mr-2 h-4 w-4" /> Add
          </Button>
        </div>

        <div className="space-y-2">
          {trackedWallets.length === 0 && (
            <p className="text-sm text-foreground/60">
              Add wallets to start tracking your portfolio.
            </p>
          )}

          {trackedWallets.map((address) => {
            const wallet = walletMap.get(address.toLowerCase());
            return (
              <div
                key={address}
                className={cn(
                  "flex flex-col gap-2 rounded-2xl border border-white/10",
                  "bg-black/30 px-3 py-2 text-sm sm:flex-row sm:items-center sm:justify-between sm:px-4 sm:py-3"
                )}
              >
                <div className="min-w-0">
                  <div className="break-all font-medium text-foreground">
                    {address}
                  </div>
                  {wallet?.latestPriceUsd != null ? (
                    <div className="flex flex-wrap items-center gap-x-2 text-xs text-foreground/60">
                      <span>Latest: ${wallet.latestPriceUsd.toLocaleString()}</span>
                      {wallet.latestAt && (
                        <span className="text-foreground/40">
                          · {new Date(wallet.latestAt).toLocaleTimeString()}
                        </span>
                      )}
                    </div>
                  ) : (
                    <div className="text-xs text-orange-300">
                      Not synced yet
                    </div>
                  )}
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => removeWallet(address)}
                  className="self-end sm:self-auto"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
