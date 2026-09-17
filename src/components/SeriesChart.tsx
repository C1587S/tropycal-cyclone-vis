import type { EChartsOption } from "echarts";
import { useMemo, useState } from "react";
import type { StormSeries } from "../lib/data";
import { chartTheme } from "../lib/palette";
import { EChart } from "./EChart";

function fmtLatLon(lat: number, lon: number): string {
  return `${Math.abs(lat).toFixed(1)}°${lat < 0 ? "S" : "N"} ${Math.abs(lon).toFixed(1)}°${lon < 0 ? "W" : "E"}`;
}

/** Water level over time at the storm's top-ranked gauges.
 *
 * One gauge at a time (chips select it), two series on one meter axis:
 * surge anomaly (eta − sl_init) and water depth (h). Gauges report on
 * staggered hourly clocks; the export already compressed each to its own
 * finite samples.
 */
export function SeriesChart({ series }: { series: StormSeries }) {
  const [sel, setSel] = useState(0);
  const gauge = series.gauges[sel];
  const t = chartTheme();

  const option = useMemo<EChartsOption>(() => {
    const sl = series.sl_init_m ?? 0;
    const surge = gauge.t.map((ts, i) => {
      const eta = gauge.eta[i];
      return [ts * 1000, eta == null ? null : +(eta - sl).toFixed(3)];
    });
    const depth = gauge.t.map((ts, i) => [ts * 1000, gauge.h[i]]);
    return {
      backgroundColor: "transparent",
      grid: { left: 48, right: 16, top: 30, bottom: 30 },
      legend: {
        top: 0,
        left: 0,
        textStyle: { color: t.textSecondary, fontSize: 12 },
        itemWidth: 14,
      },
      tooltip: {
        trigger: "axis",
        valueFormatter: (v) => (v == null ? "–" : `${(v as number).toFixed(2)} m`),
      },
      xAxis: {
        type: "time",
        axisLine: { lineStyle: { color: t.baseline } },
        axisLabel: { color: t.textMuted, fontSize: 11 },
        splitLine: { show: false },
      },
      yAxis: {
        type: "value",
        name: "m",
        nameTextStyle: { color: t.textMuted },
        splitLine: { lineStyle: { color: t.grid } },
        axisLabel: { color: t.textMuted, fontSize: 11 },
      },
      series: [
        {
          name: "surge (eta − sl_init)",
          type: "line",
          data: surge,
          showSymbol: false,
          lineStyle: { width: 2, color: t.series1 },
          itemStyle: { color: t.series1 },
          connectNulls: true,
        },
        {
          name: "depth (h)",
          type: "line",
          data: depth,
          showSymbol: false,
          lineStyle: { width: 2, color: t.series2 },
          itemStyle: { color: t.series2 },
          connectNulls: true,
        },
      ],
    };
  }, [gauge, series.sl_init_m, t]);

  return (
    <div>
      <div className="gauge-chips">
        {series.gauges.map((g, i) => (
          <button key={g.id} className={i === sel ? "active" : ""} onClick={() => setSel(i)}>
            {g.kind === "surge" ? "surge" : "depth"} {g.peak.toFixed(2)} m · {fmtLatLon(g.lat, g.lon)}
          </button>
        ))}
      </div>
      <EChart option={option} height={260} />
      <div className="muted" style={{ fontSize: 11 }}>
        gauge {gauge.id} at ({gauge.lon.toFixed(2)}, {gauge.lat.toFixed(2)}), top gauges ranked by peak{" "}
        {gauge.kind}
      </div>
    </div>
  );
}
