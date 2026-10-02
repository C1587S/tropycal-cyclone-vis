import * as echarts from "echarts";
import { useEffect, useRef } from "react";

interface Props {
  option: echarts.EChartsOption;
  height?: number;
  /** click on a data point; receives the ECharts event params */
  onClick?: (params: echarts.ECElementEvent) => void;
  /** pointer entered a data point */
  onHover?: (params: echarts.ECElementEvent) => void;
  /** pointer left the chart's data entirely */
  onHoverEnd?: () => void;
}

/** Thin ECharts wrapper: owns init/dispose and resizes with its container. */
export function EChart({ option, height = 260, onClick, onHover, onHoverEnd }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const chart = useRef<echarts.ECharts>();
  const clickRef = useRef(onClick);
  clickRef.current = onClick;
  const hoverRef = useRef(onHover);
  hoverRef.current = onHover;
  const hoverEndRef = useRef(onHoverEnd);
  hoverEndRef.current = onHoverEnd;

  useEffect(() => {
    if (!ref.current) return;
    chart.current = echarts.init(ref.current);
    chart.current.on("click", (params) => clickRef.current?.(params as echarts.ECElementEvent));
    chart.current.on("mouseover", (params) => hoverRef.current?.(params as echarts.ECElementEvent));
    chart.current.on("globalout", () => hoverEndRef.current?.());
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
