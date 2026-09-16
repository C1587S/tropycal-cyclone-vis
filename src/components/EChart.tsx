import * as echarts from "echarts";
import { useEffect, useRef } from "react";

/** Thin ECharts wrapper: owns init/dispose and resizes with its container. */
export function EChart({ option, height = 260 }: { option: echarts.EChartsOption; height?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const chart = useRef<echarts.ECharts>();

  useEffect(() => {
    if (!ref.current) return;
    chart.current = echarts.init(ref.current);
    const obs = new ResizeObserver(() => chart.current?.resize());
    obs.observe(ref.current);
    return () => {
      obs.disconnect();
      chart.current?.dispose();
    };
  }, []);

  useEffect(() => {
    chart.current?.setOption(option, { notMerge: true });
  }, [option]);

  return <div ref={ref} style={{ height, width: "100%" }} />;
}
