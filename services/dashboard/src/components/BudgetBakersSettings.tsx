import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getBBCredentials,
  saveBBCredentials,
  deleteBBCredentials,
  listBBAccounts,
  updateBBAccount,
  syncBBAccounts,
  getBBScript,
  BBCredentialsInput,
  BBAccount
} from "@/api/stats";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function BudgetBakersSettings() {
  const [credentialsJson, setCredentialsJson] = useState("");
  const [parseError, setParseError] = useState<string | null>(null);
  const [showInstructions, setShowInstructions] = useState(false);
  const queryClient = useQueryClient();

  const { data: credentials } = useQuery({
    queryKey: ["bb-credentials"],
    queryFn: getBBCredentials
  });

  const { data: accountsData, refetch: refetchAccounts } = useQuery({
    queryKey: ["bb-accounts"],
    queryFn: listBBAccounts,
    enabled: credentials?.connected === true
  });

  const saveMutation = useMutation({
    mutationFn: saveBBCredentials,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bb-credentials"] });
      queryClient.invalidateQueries({ queryKey: ["bb-accounts"] });
      setCredentialsJson("");
      setParseError(null);
    },
    onError: (error: Error) => {
      setParseError(error.message);
    }
  });

  const deleteMutation = useMutation({
    mutationFn: deleteBBCredentials,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bb-credentials"] });
      queryClient.invalidateQueries({ queryKey: ["bb-accounts"] });
    }
  });

  const syncMutation = useMutation({
    mutationFn: syncBBAccounts,
    onSuccess: () => {
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ["bb-accounts"] });
      }, 2000);
    }
  });

  const updateAccountMutation = useMutation({
    mutationFn: ({ id, excluded }: { id: number; excluded: boolean }) =>
      updateBBAccount(id, excluded),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bb-accounts"] });
    }
  });

  const handleCopyScript = async () => {
    try {
      const script = await getBBScript();
      await navigator.clipboard.writeText(script);
      alert("Script copied to clipboard!");
    } catch {
      alert("Failed to copy script");
    }
  };

  const handleSaveCredentials = () => {
    try {
      const parsed = JSON.parse(credentialsJson) as BBCredentialsInput;
      if (!parsed.email || !parsed.couchUrl || !parsed.couchDb || !parsed.couchLogin || !parsed.couchToken) {
        setParseError("Invalid credentials format. Make sure all fields are present.");
        return;
      }
      saveMutation.mutate(parsed);
    } catch {
      setParseError("Invalid JSON format");
    }
  };

  const formatBalance = (cents: number, currency?: string) => {
    const value = cents / 100;
    return `${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency || ""}`;
  };

  const accounts = accountsData?.accounts || [];
  const activeAccounts = accounts.filter(a => !a.archived);

  return (
    <Card className="border-foreground/10">
      <CardHeader className="pb-4">
        <CardTitle className="flex items-center justify-between text-base font-medium">
          <span>Wallet by BudgetBakers</span>
          {credentials?.connected && (
            <span className="text-xs font-normal text-green-500">Connected</span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {!credentials?.connected ? (
          <>
            <div className="space-y-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowInstructions(!showInstructions)}
                className="w-full"
              >
                {showInstructions ? "Hide" : "Show"} Instructions
              </Button>

              {showInstructions && (
                <div className="rounded-lg bg-foreground/5 p-3 text-xs space-y-2">
                  <p><strong>Step 1:</strong> Open <a href="https://web.budgetbakers.com" target="_blank" rel="noopener noreferrer" className="text-blue-400 underline">web.budgetbakers.com</a> and log in</p>
                  <p><strong>Step 2:</strong> Open DevTools (F12) → Console tab</p>
                  <p><strong>Step 3:</strong> Click the button below to copy the script, then paste it in the console and press Enter</p>
                  <p><strong>Step 4:</strong> The credentials JSON will be copied to your clipboard - paste it below</p>
                </div>
              )}

              <Button
                variant="secondary"
                size="sm"
                onClick={handleCopyScript}
                className="w-full"
              >
                📋 Copy Script to Clipboard
              </Button>
            </div>

            <div className="space-y-2">
              <textarea
                value={credentialsJson}
                onChange={(e) => {
                  setCredentialsJson(e.target.value);
                  setParseError(null);
                }}
                placeholder='Paste credentials JSON here...'
                className="w-full h-24 rounded-md border border-foreground/20 bg-background px-3 py-2 text-xs font-mono resize-none"
              />
              {parseError && (
                <p className="text-xs text-red-500">{parseError}</p>
              )}
              <Button
                size="sm"
                onClick={handleSaveCredentials}
                disabled={!credentialsJson.trim() || saveMutation.isPending}
                className="w-full"
              >
                {saveMutation.isPending ? "Saving..." : "Save Credentials"}
              </Button>
            </div>
          </>
        ) : (
          <>
            <div className="flex items-center justify-between text-xs">
              <span className="text-foreground/60">Email: {credentials.email}</span>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => syncMutation.mutate()}
                  disabled={syncMutation.isPending}
                >
                  {syncMutation.isPending ? "Syncing..." : "🔄 Sync"}
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => {
                    if (confirm("Disconnect BudgetBakers?")) {
                      deleteMutation.mutate();
                    }
                  }}
                >
                  Disconnect
                </Button>
              </div>
            </div>

            {activeAccounts.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs text-foreground/60">
                  Accounts ({activeAccounts.length})
                </p>
                <div className="max-h-64 overflow-y-auto space-y-1">
                  {activeAccounts.map((account) => (
                    <div
                      key={account.id}
                      className="flex items-center justify-between rounded-md border border-foreground/10 px-3 py-2 text-xs"
                    >
                      <div className="flex-1 min-w-0">
                        <span className={account.excluded ? "text-foreground/40 line-through" : ""}>
                          {account.name}
                        </span>
                        <span className="ml-2 text-foreground/50">
                          {formatBalance(account.balanceCents, account.currencyCode)}
                        </span>
                      </div>
                      <label className="flex items-center gap-1 text-foreground/50 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={account.excluded}
                          onChange={(e) => {
                            updateAccountMutation.mutate({
                              id: account.id,
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
