import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { fetchWalletHistory, PricePoint, Wallet, listBBAccounts, fetchBBAccountHistory, BBAccount } from "@/api/stats";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  createChart,
  ColorType,
  CrosshairMode,
  IChartApi,
  ISeriesApi,
  LineSeries,
  LineData,
  UTCTimestamp,
  MouseEventParams
} from "lightweight-charts";

interface ModeChartsProps {
  wallets: Wallet[];
  trackedWallets: string[];
  lastUpdatedAt?: Date | null;
  isSSEConnected?: boolean;
}

const WALLET_COLORS = [
  "#7c3aed", // purple
  "#22d3ee", // cyan
  "#f97316", // orange
  "#ec4899", // pink
  "#f43f5e", // red
  "#a3e635"  // lime
];

const BB_COLORS = [
  "#3b82f6", // blue
  "#14b8a6", // teal
  "#8b5cf6", // violet
  "#06b6d4", // cyan
  "#84cc16", // lime
  "#f59e0b", // amber
  "#ef4444", // red
  "#6366f1"  // indigo
];

const SUM_COLOR = "#10b981"; // emerald - color for summed chart

const PERIODS = {
  "1H": { key: "1H", label: "1H", days: 1 / 24, bucketMs: 5 * 60 * 1000 },
  "6H": { key: "6H", label: "6H", days: 6 / 24, bucketMs: 15 * 60 * 1000 },
  "12H": { key: "12H", label: "12H", days: 12 / 24, bucketMs: 30 * 60 * 1000 },
  "1D": { key: "1D", label: "1D", days: 1, bucketMs: 60 * 60 * 1000 },
  "1W": { key: "1W", label: "1W", days: 7, bucketMs: 6 * 60 * 60 * 1000 },
  "30D": { key: "30D", label: "30D", days: 30, bucketMs: 24 * 60 * 60 * 1000 },
  "1Y": { key: "1Y", label: "1Y", days: 365, bucketMs: 7 * 24 * 60 * 60 * 1000 }
};

type PeriodKey = keyof typeof PERIODS;

function buildRangeForPeriod(period: PeriodKey) {
  const to = new Date();
  const from = new Date();
  from.setTime(to.getTime() - PERIODS[period].days * 24 * 60 * 60 * 1000);
  return {
    from: from.toISOString(),
    to: to.toISOString(),
    fromMs: from.getTime(),
    toMs: to.getTime(),
    bucketMs: PERIODS[period].bucketMs
  };
}

function bucketPoints(points: PricePoint[], bucketMs: number) {
  const buckets = new Map<number, { sum: number; count: number }>();
  if (!points || !Array.isArray(points)) return buckets;
  points.forEach((point) => {
    if (!point) return;
    const time = new Date(point.recordedAt).getTime();
    if (Number.isNaN(time)) return;
    const bucket = Math.floor(time / bucketMs) * bucketMs;
    const entry = buckets.get(bucket) || { sum: 0, count: 0 };
    const price = Number(point.priceUsd);
    if (Number.isNaN(price)) return;
    entry.sum += price;
    entry.count += 1;
    buckets.set(bucket, entry);
  });
  return buckets;
}

interface SeriesData {
  id: number | string;
  label: string;
  color: string;
  data: LineData[];
  isBB?: boolean;
}

function buildSeriesData({
  series,
  selectedIds,
  range,
  sumSelected,
  tracked
}: {
  series: Array<{ id: number; label: string; points: PricePoint[] }>;
  selectedIds: Set<number>;
  range: { bucketMs: number };
  sumSelected: boolean;
  tracked: Wallet[];
}): SeriesData[] {
  if (!series || !Array.isArray(series)) return [];

  const result: SeriesData[] = [];
  
  // Build buckets for all wallets
  const allWalletBuckets = series
    .filter((item) => item)
    .map((item) => {
      const trackedIndex = tracked.findIndex(w => w.id === item.id);
      return {
        id: item.id,
        label: item.label,
        color: WALLET_COLORS[trackedIndex % WALLET_COLORS.length],
        buckets: bucketPoints(item.points || [], range.bucketMs)
      };
    });

  if (allWalletBuckets.length === 0) return [];

  // Get only selected wallets
  const selectedWalletBuckets = allWalletBuckets.filter((w) => selectedIds.has(w.id));
  
  if (selectedWalletBuckets.length === 0) return [];

  // Find all unique timestamps across SELECTED wallets only
  const allTimestamps = new Set<number>();
  selectedWalletBuckets.forEach((wallet) => {
    wallet.buckets.forEach((_, time) => {
      allTimestamps.add(time);
    });
  });

  if (allTimestamps.size === 0) return [];

  // Sort timestamps
  const sortedTimestamps = Array.from(allTimestamps).sort((a, b) => a - b);

  if (sumSelected) {
    // Sum all selected wallets into one line
    const sumData: LineData[] = [];
    const lastValues = new Map<number, number>();

    sortedTimestamps.forEach((time) => {
      selectedWalletBuckets.forEach((wallet) => {
        const entry = wallet.buckets.get(time);
        if (entry) {
          lastValues.set(wallet.id, entry.sum / entry.count);
        }
      });

      if (lastValues.size > 0) {
        let total = 0;
        lastValues.forEach((value) => {
          total += value;
        });
        sumData.push({
          time: (time / 1000) as UTCTimestamp,
          value: total
        });
      }
    });

    if (sumData.length > 0) {
      // Build label from selected wallet names
      const selectedLabels = selectedWalletBuckets.map(w => w.label).join(" + ");
      result.push({
        id: "sum",
        label: selectedLabels.length > 30 ? "Sum" : selectedLabels,
        color: SUM_COLOR,
        data: sumData
      });
    }
  } else {
    // Show individual lines for each selected wallet
    selectedWalletBuckets.forEach((wallet) => {
      const data: LineData[] = [];
      let lastValue: number | null = null;

      sortedTimestamps.forEach((time) => {
        const entry = wallet.buckets.get(time);
        if (entry) {
          lastValue = entry.sum / entry.count;
        }
        if (lastValue !== null) {
          data.push({
            time: (time / 1000) as UTCTimestamp,
            value: lastValue
          });
        }
      });

      if (data.length > 0) {
        result.push({
          id: wallet.id,
          label: wallet.label,
          color: wallet.color,
          data
        });
      }
    });
  }

  return result;
}

function getWalletLabel(wallet: Wallet) {
  let label = wallet.label || wallet.address;
  
  if (typeof label === 'string' && label.endsWith('-Test')) {
    label = label.slice(0, -5);
  }
  
  if (!wallet.label && wallet.address.length > 10) {
    return `${wallet.address.slice(0, 6)}…${wallet.address.slice(-4)}`;
  }
  
  return label;
}

interface LegendItem {
  label: string;
  color: string;
  value: string | null;
}

export default function ModeCharts({ wallets, trackedWallets }: ModeChartsProps) {
  const tracked = wallets.filter((wallet) =>
    trackedWallets.map((item) => item.toLowerCase()).includes(wallet.address.toLowerCase())
  );

  const [period, setPeriod] = useState<PeriodKey>("1H");
  const range = useMemo(() => buildRangeForPeriod(period), [period]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [sumSelected, setSumSelected] = useState(false);
  
  const initializedRef = useRef(false);
  const knownIdsRef = useRef<Set<string>>(new Set());
  
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesMapRef = useRef<Map<number | string, ISeriesApi<"Line">>>(new Map());
  
  const [legendItems, setLegendItems] = useState<LegendItem[]>([]);
  const [hasData, setHasData] = useState(false);

  const { data: bbAccountsData } = useQuery({
    queryKey: ["bb-accounts"],
    queryFn: listBBAccounts,
    refetchInterval: 60000
  });

  const bbAccounts = useMemo(() => {
    if (!bbAccountsData?.connected || !bbAccountsData?.accounts) return [];
    return bbAccountsData.accounts.filter(acc => !acc.excluded && !acc.archived);
  }, [bbAccountsData]);

  const walletQueries = useQueries({
    queries: tracked.map((wallet) => ({
      queryKey: ["history", wallet.id, range.from, range.to, period],
      queryFn: () => fetchWalletHistory(wallet.id, range.from, range.to),
      refetchInterval: 60000
    }))
  });

  const bbHistoryQueries = useQueries({
    queries: bbAccounts.map((acc) => ({
      queryKey: ["bb-history", acc.id, range.from, range.to, period],
      queryFn: () => fetchBBAccountHistory(acc.id, range.from, range.to),
      refetchInterval: 60000
    }))
  });

  const trackedIds = useMemo(() => tracked.map((w) => `wallet-${w.id}`), [tracked]);
  const bbIds = useMemo(() => bbAccounts.map((acc) => `bb-${acc.id}`), [bbAccounts]);
  const allIds = useMemo(() => [...trackedIds, ...bbIds], [trackedIds, bbIds]);
  const allIdsKey = allIds.join(",");

  useEffect(() => {
    if (!initializedRef.current && allIds.length > 0) {
      initializedRef.current = true;
      allIds.forEach((id) => knownIdsRef.current.add(id));
      setSelectedIds(allIds);
      return;
    }

    if (initializedRef.current) {
      const genuinelyNewIds = allIds.filter((id) => !knownIdsRef.current.has(id));
      
      if (genuinelyNewIds.length > 0) {
        genuinelyNewIds.forEach((id) => knownIdsRef.current.add(id));
        setSelectedIds((prev) => [...prev, ...genuinelyNewIds]);
      }
      
      setSelectedIds((prev) => prev.filter((id) => allIds.includes(id)));
    }
  }, [allIdsKey]);

  const series = useMemo(
    () =>
      tracked.map((wallet, index) => ({
        id: `wallet-${wallet.id}`,
        label: getWalletLabel(wallet),
        points: (walletQueries[index]?.data as PricePoint[]) || [],
        isBB: false
      })),
    [tracked, walletQueries]
  );

  const bbSeries = useMemo(
    () =>
      bbAccounts.map((acc, index) => {
        const historyData = bbHistoryQueries[index]?.data;
        const points: PricePoint[] = historyData?.points?.map(p => ({
          priceUsd: p.balanceUsd ?? 0,
          recordedAt: p.recordedAt
        })) || [];
        return {
          id: `bb-${acc.id}`,
          label: acc.name,
          points,
          isBB: true
        };
      }),
    [bbAccounts, bbHistoryQueries]
  );

  const allSeries = useMemo(() => [...series, ...bbSeries], [series, bbSeries]);

  const selectedIdsSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  const seriesData = useMemo(() => {
    if (!allSeries || !Array.isArray(allSeries)) return [];

    const result: SeriesData[] = [];
    
    const allWalletBuckets = allSeries
      .filter((item) => item)
      .map((item, globalIndex) => {
        const isBB = item.isBB;
        const colorIndex = isBB 
          ? bbAccounts.findIndex(acc => `bb-${acc.id}` === item.id)
          : tracked.findIndex(w => `wallet-${w.id}` === item.id);
        const color = isBB 
          ? BB_COLORS[colorIndex % BB_COLORS.length]
          : WALLET_COLORS[colorIndex % WALLET_COLORS.length];
        return {
          id: item.id,
          label: item.label,
          color,
          buckets: bucketPoints(item.points || [], range.bucketMs),
          isBB
        };
      });

    if (allWalletBuckets.length === 0) return [];

    const selectedWalletBuckets = allWalletBuckets.filter((w) => selectedIdsSet.has(w.id));
    
    if (selectedWalletBuckets.length === 0) return [];

    const allTimestamps = new Set<number>();
    selectedWalletBuckets.forEach((wallet) => {
      wallet.buckets.forEach((_, time) => {
        allTimestamps.add(time);
      });
    });

    if (allTimestamps.size === 0) return [];

    const sortedTimestamps = Array.from(allTimestamps).sort((a, b) => a - b);

    if (sumSelected) {
      const sumData: LineData[] = [];
      const lastValues = new Map<string, number>();

      sortedTimestamps.forEach((time) => {
        selectedWalletBuckets.forEach((wallet) => {
          const entry = wallet.buckets.get(time);
          if (entry) {
            lastValues.set(wallet.id, entry.sum / entry.count);
          }
        });

        if (lastValues.size > 0) {
          let total = 0;
          lastValues.forEach((value) => {
            total += value;
          });
          sumData.push({
            time: (time / 1000) as UTCTimestamp,
            value: total
          });
        }
      });

      if (sumData.length > 0) {
        const selectedLabels = selectedWalletBuckets.map(w => w.label).join(" + ");
        result.push({
          id: "sum",
          label: selectedLabels.length > 30 ? "Sum" : selectedLabels,
          color: SUM_COLOR,
          data: sumData
        });
      }
    } else {
      selectedWalletBuckets.forEach((wallet) => {
        const data: LineData[] = [];
        let lastValue: number | null = null;

        sortedTimestamps.forEach((time) => {
          const entry = wallet.buckets.get(time);
          if (entry) {
            lastValue = entry.sum / entry.count;
          }
          if (lastValue !== null) {
            data.push({
              time: (time / 1000) as UTCTimestamp,
              value: lastValue
            });
          }
        });

        if (data.length > 0) {
          result.push({
            id: wallet.id,
            label: wallet.label,
            color: wallet.color,
            data,
            isBB: wallet.isBB
          });
        }
      });
    }

    return result;
  }, [allSeries, selectedIdsSet, range, sumSelected, tracked, bbAccounts]);

  // Initialize chart
  useEffect(() => {
    if (!chartContainerRef.current) return;

    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "rgba(255, 255, 255, 0.6)"
      },
      grid: {
        vertLines: { color: "rgba(255, 255, 255, 0.06)" },
        horzLines: { color: "rgba(255, 255, 255, 0.06)" }
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: {
          color: "rgba(255, 255, 255, 0.3)",
          width: 1,
          style: 2,
          labelBackgroundColor: "#1f2937"
        },
        horzLine: {
          color: "rgba(255, 255, 255, 0.3)",
          width: 1,
          style: 2,
          labelBackgroundColor: "#1f2937"
        }
      },
      rightPriceScale: {
        borderColor: "rgba(255, 255, 255, 0.1)",
        scaleMargins: {
          top: 0.1,
          bottom: 0.1
        }
      },
      timeScale: {
        borderColor: "rgba(255, 255, 255, 0.1)",
        timeVisible: true,
        secondsVisible: false
      },
      handleScroll: {
        mouseWheel: true,
        pressedMouseMove: true,
        horzTouchDrag: true,
        vertTouchDrag: false
      },
      handleScale: {
        axisPressedMouseMove: true,
        mouseWheel: true,
        pinch: true
      }
    });

    chartRef.current = chart;

    // Handle resize
    const handleResize = () => {
      if (chartContainerRef.current && chartRef.current) {
        chartRef.current.applyOptions({
          width: chartContainerRef.current.clientWidth,
          height: 360
        });
      }
    };

    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(chartContainerRef.current);

    // Handle crosshair move for legend
    chart.subscribeCrosshairMove((param: MouseEventParams) => {
      if (!param.time || !param.seriesData) {
        // Reset to latest values when not hovering
        const items: LegendItem[] = [];
        seriesMapRef.current.forEach((series, id) => {
          const data = series.data();
          if (data.length > 0) {
            const lastPoint = data[data.length - 1] as LineData;
            const seriesInfo = seriesData.find(s => s.id === id);
            if (seriesInfo) {
              items.push({
                label: seriesInfo.label,
                color: seriesInfo.color,
                value: `$${lastPoint.value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
              });
            }
          }
        });
        setLegendItems(items);
        return;
      }

      const items: LegendItem[] = [];
      param.seriesData.forEach((data, series) => {
        const lineData = data as LineData;
        if (lineData && typeof lineData.value === 'number') {
          // Find series info
          let found = false;
          seriesMapRef.current.forEach((s, id) => {
            if (s === series) {
              const seriesInfo = seriesData.find(si => si.id === id);
              if (seriesInfo) {
                items.push({
                  label: seriesInfo.label,
                  color: seriesInfo.color,
                  value: `$${lineData.value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                });
                found = true;
              }
            }
          });
        }
      });
      setLegendItems(items);
    });

    handleResize();

    return () => {
      resizeObserver.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesMapRef.current.clear();
    };
  }, []);

  // Update series data
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    // Remove all existing series
    seriesMapRef.current.forEach((series) => {
      chart.removeSeries(series);
    });
    seriesMapRef.current.clear();

    if (seriesData.length === 0) {
      setHasData(false);
      setLegendItems([]);
      return;
    }

    setHasData(true);

    // Add new series
    seriesData.forEach((data) => {
      const isSum = data.id === "sum";
      const series = chart.addSeries(LineSeries, {
        color: data.color,
        lineWidth: isSum ? 3 : 2,
        priceFormat: {
          type: "custom",
          formatter: (price: number) => `$${price.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
        },
        crosshairMarkerVisible: true,
        crosshairMarkerRadius: 4,
        lastValueVisible: false,
        priceLineVisible: false
      });

      series.setData(data.data);
      seriesMapRef.current.set(data.id, series);
    });

    // Fit content
    chart.timeScale().fitContent();

    // Set initial legend items
    const items: LegendItem[] = seriesData.map(s => {
      const lastPoint = s.data[s.data.length - 1];
      return {
        label: s.label,
        color: s.color,
        value: lastPoint ? `$${lastPoint.value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : null
      };
    });
    setLegendItems(items);
  }, [seriesData]);

  const toggleWallet = useCallback((id: string) => {
    setSelectedIds((prev) => {
      return prev.includes(id) 
        ? prev.filter((item) => item !== id) 
        : [...prev, id];
    });
  }, []);

  return (
    <Card className="bg-black/30">
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <CardTitle>Portfolio history</CardTitle>
        <div className="flex flex-wrap gap-2">
          {Object.values(PERIODS).map((item) => (
            <Button
              key={item.key}
              variant={item.key === period ? "default" : "ghost"}
              size="sm"
              className={item.key === period ? "" : "border border-white/10"}
              onClick={() => setPeriod(item.key as PeriodKey)}
            >
              {item.label}
            </Button>
          ))}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          {tracked.length === 0 && bbAccounts.length === 0 && (
            <p className="text-sm text-foreground/60">
              Add wallets or connect BudgetBakers to unlock portfolio history.
            </p>
          )}
          {(tracked.length > 0 || bbAccounts.length > 0) && (
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={sumSelected}
                onChange={(e) => setSumSelected(e.target.checked)}
                className="w-4 h-4 rounded border-gray-600 bg-transparent text-emerald-500 focus:ring-emerald-500 focus:ring-offset-0 cursor-pointer"
              />
              <span className="text-sm text-foreground/80">Суммировать графики</span>
            </label>
          )}
          {tracked.map((wallet, index) => {
            const label = getWalletLabel(wallet);
            const walletId = `wallet-${wallet.id}`;
            const isSelected = selectedIdsSet.has(walletId);
            const color = WALLET_COLORS[index % WALLET_COLORS.length];
            
            return (
              <button
                key={walletId}
                className="inline-flex items-center justify-center rounded-full font-medium transition h-9 px-4 text-sm border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
                style={{
                  backgroundColor: isSelected ? color : "transparent",
                  borderColor: color,
                  color: isSelected ? "white" : "rgba(255, 255, 255, 0.8)"
                }}
                onClick={() => toggleWallet(walletId)}
                title={wallet.address}
              >
                {label}
              </button>
            );
          })}
          {bbAccounts.map((acc, index) => {
            const bbId = `bb-${acc.id}`;
            const isSelected = selectedIdsSet.has(bbId);
            const color = BB_COLORS[index % BB_COLORS.length];
            
            return (
              <button
                key={bbId}
                className="inline-flex items-center justify-center rounded-full font-medium transition h-9 px-4 text-sm border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
                style={{
                  backgroundColor: isSelected ? color : "transparent",
                  borderColor: color,
                  color: isSelected ? "white" : "rgba(255, 255, 255, 0.8)"
                }}
                onClick={() => toggleWallet(bbId)}
                title={`BudgetBakers: ${acc.name}`}
              >
                {acc.name}
              </button>
            );
          })}
        </div>

        {/* Legend */}
        {legendItems.length > 0 && (
          <div className="flex flex-wrap gap-4 text-sm">
            {legendItems.map((item) => (
              <div key={item.label} className="flex items-center gap-2">
                <span
                  className="w-3 h-3 rounded-full"
                  style={{ backgroundColor: item.color }}
                />
                <span className="text-foreground/60">{item.label}:</span>
                <span className="font-mono font-medium">{item.value || "—"}</span>
              </div>
            ))}
          </div>
        )}

        {/* Chart container */}
        <div className="w-full relative">
          <div
            ref={chartContainerRef}
            className="w-full"
            style={{ height: 360 }}
          />
          
          {/* Empty state overlay */}
          {!hasData && (tracked.length > 0 || bbAccounts.length > 0) && (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-foreground/40 bg-black/20">
              <div className="h-12 w-12 rounded-full border-2 border-dashed border-current animate-pulse" />
              <p className="text-center mt-4">
                No data for the last {PERIODS[period].label}.
                {(period === "30D" || period === "1Y" || period === "1W") && (
                  <span className="block text-sm mt-1">
                    Try selecting 1H or 6H to see recent activity.
                  </span>
                )}
              </p>
            </div>
          )}
          
          {tracked.length === 0 && bbAccounts.length === 0 && (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-foreground/40">
              <p className="text-center">Add wallets or connect BudgetBakers to see portfolio history.</p>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
