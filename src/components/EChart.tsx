import * as echarts from "echarts";
import { useEffect, useRef } from "react";

interface Props {
  option: echarts.EChartsOption;
  height?: number;
  /** click on a data point; receives the ECharts event params */
  onClick?: (params: echarts.ECElementEvent) => void;
}

/** Thin ECharts wrapper: owns init/dispose and resizes with its container. */
export function EChart({ option, height = 260, onClick }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const chart = useRef<echarts.ECharts>();
  const clickRef = useRef(onClick);
  clickRef.current = onClick;

  useEffect(() => {
    if (!ref.current) return;
    chart.current = echarts.init(ref.current);
    chart.current.on("click", (params) => clickRef.current?.(params as echarts.ECElementEvent));
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
