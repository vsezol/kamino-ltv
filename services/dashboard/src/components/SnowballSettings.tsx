import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getSnowballCredentials,
  saveSnowballCredentials,
  deleteSnowballCredentials,
  listSnowballPortfolios,
  updateSnowballPortfolio,
  syncSnowballPortfolios,
} from "@/api/stats";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function SnowballSettings() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const { data: credentials } = useQuery({
    queryKey: ["snowball-credentials"],
    queryFn: getSnowballCredentials
  });

  const { data: portfoliosData } = useQuery({
    queryKey: ["snowball-portfolios"],
    queryFn: listSnowballPortfolios,
    enabled: credentials?.connected === true
  });

  const saveMutation = useMutation({
    mutationFn: (data: { email: string; password: string }) => 
      saveSnowballCredentials(data.email, data.password),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["snowball-credentials"] });
      queryClient.invalidateQueries({ queryKey: ["snowball-portfolios"] });
      setEmail("");
      setPassword("");
      setError(null);
    },
    onError: (err: Error) => {
      setError(err.message);
    }
  });

  const deleteMutation = useMutation({
    mutationFn: deleteSnowballCredentials,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["snowball-credentials"] });
      queryClient.invalidateQueries({ queryKey: ["snowball-portfolios"] });
    }
  });

  const syncMutation = useMutation({
    mutationFn: syncSnowballPortfolios,
    onSuccess: () => {
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ["snowball-portfolios"] });
      }, 2000);
    }
  });

  const updatePortfolioMutation = useMutation({
    mutationFn: ({ id, excluded }: { id: number; excluded: boolean }) =>
      updateSnowballPortfolio(id, excluded),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["snowball-portfolios"] });
    }
  });

  const handleSave = () => {
    if (!email.trim() || !password.trim()) {
      setError("Email and password are required");
      return;
    }
    saveMutation.mutate({ email, password });
  };

  const formatBalance = (usd: number) => {
    return `$${usd.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  const portfolios = portfoliosData?.portfolios || [];
  const regularPortfolios = portfolios.filter(p => !p.isComposite);

  return (
    <Card className="border-foreground/10">
      <CardHeader className="pb-4">
        <CardTitle className="flex items-center justify-between text-base font-medium">
          <span>Snowball Income</span>
          {credentials?.connected && (
            <span className="text-xs font-normal text-green-500">Connected</span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {!credentials?.connected ? (
          <>
            <div className="space-y-3">
              <input
                type="email"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  setError(null);
                }}
                placeholder="Email"
                className="w-full rounded-md border border-foreground/20 bg-background px-3 py-2 text-sm"
              />
              <input
                type="password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setError(null);
                }}
                placeholder="Password"
                className="w-full rounded-md border border-foreground/20 bg-background px-3 py-2 text-sm"
              />
              {error && (
                <p className="text-xs text-red-500">{error}</p>
              )}
              <Button
                size="sm"
                onClick={handleSave}
                disabled={!email.trim() || !password.trim() || saveMutation.isPending}
                className="w-full"
              >
                {saveMutation.isPending ? "Connecting..." : "Connect"}
              </Button>
            </div>
          </>
        ) : (
          <>
            <div className="flex items-center justify-between text-xs">
              <span className="text-foreground/60">
                {credentials.email && <span>Email: {credentials.email}</span>}
              </span>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => syncMutation.mutate()}
                  disabled={syncMutation.isPending}
                >
                  {syncMutation.isPending ? "Syncing..." : "Sync"}
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => {
                    if (confirm("Disconnect Snowball Income?")) {
                      deleteMutation.mutate();
                    }
                  }}
                >
                  Disconnect
                </Button>
              </div>
            </div>

            {regularPortfolios.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs text-foreground/60">
                  Portfolios ({regularPortfolios.length})
                </p>
                <div className="max-h-64 overflow-y-auto space-y-1">
                  {regularPortfolios.map((portfolio) => (
                    <div
                      key={portfolio.id}
                      className="flex items-center justify-between rounded-md border border-foreground/10 px-3 py-2 text-xs"
                    >
                      <div className="flex-1 min-w-0">
                        <span className={portfolio.excluded ? "text-foreground/40 line-through" : ""}>
                          {portfolio.name}
                        </span>
                        <span className="ml-2 text-foreground/50">
                          {formatBalance(portfolio.currentCostUsd)}
                        </span>
                        {portfolio.incomePercent !== 0 && (
                          <span className={`ml-2 ${portfolio.incomePercent >= 0 ? "text-green-500" : "text-red-500"}`}>
                            {portfolio.incomePercent >= 0 ? "+" : ""}{portfolio.incomePercent.toFixed(2)}%
                          </span>
                        )}
                      </div>
                      <label className="flex items-center gap-1 text-foreground/50 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={portfolio.excluded}
                          onChange={(e) => {
                            updatePortfolioMutation.mutate({
                              id: portfolio.id,
                              excluded: e.target.checked
                            });
                          }}
                          className="rounded"
                        />
                        <span>Exclude</span>
                      </label>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
