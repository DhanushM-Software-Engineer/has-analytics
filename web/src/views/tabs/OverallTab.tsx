/** Overall tab — daily events & reliability, P50/P95 trend, North Star trend,
 *  failures trend, activity + failures heatmaps. Chart configs ported 1:1. */
import { useMemo } from 'react';
import { Chart as ChartJS } from 'chart.js';
import type { ChartData } from 'chart.js';
import { Bar, Line, Chart as MixedChart } from 'react-chartjs-2';
import '../../charts/setup';
import { legendPt } from '../../charts/setup';
import type { HubDetail } from '../../types/api';
import { allSourceDaily } from '../../lib/pool';
import { InfoButton } from '../../components/common';
import { Heatmap } from '../../components/Heatmap';
import { useShowDayDebug } from '../../modals/dayDebug';

function interp(arr: (number | null)[]): (number | null)[] {
  const res = [...arr];
  for (let i = 0; i < res.length; i++) {
    if (res[i] == null) {
      const p = res.slice(0, i).reverse().find((v) => v != null);
      const n = res.slice(i + 1).find((v) => v != null);
      res[i] = p != null && n != null ? (p + n) / 2 : p != null ? p : n != null ? n : 0;
    }
  }
  return res;
}

export function OverallTab({ hub, d }: { hub: string; d: HubDetail }) {
  const showDayDebug = useShowDayDebug(hub);
  const daily = useMemo(() => allSourceDaily(hub, d), [hub, d]);
  const dates = daily.map((r) => `${r.date.slice(8, 10)}-${r.date.slice(5, 7)}`);
  const p50Arr = useMemo(() => interp(daily.map((r) => r.p50)), [daily]);
  const p95Arr = useMemo(() => interp(daily.map((r) => r.p95)), [daily]);
  const nsArr = useMemo(() => interp(daily.map((r) => r.ns)), [daily]);

  const pts = useMemo(() => ({
    rel: legendPt.rel(), tgt: legendPt.tgt(), p50: legendPt.p50(), p95: legendPt.p95(), ns: legendPt.ns(),
  }), []);

  const gridCfg = { color: 'rgba(255,255,255,0.02)' };

  return (<>
    <div className="grid-2">
      <div className="panel">
        <h3>DAILY EVENTS & RELIABILITY<InfoButton k="daily_chart" /></h3>
        <div className="chart-box" style={{ height: 260 }}>
          <MixedChart
            type="bar"
            data={{
              labels: dates,
              datasets: [
                { label: 'Hub Events', data: daily.map((r) => r.hub), backgroundColor: '#9353d4', order: 4, stack: 'Stack 0' },
                { label: 'App Events', data: daily.map((r) => r.app), backgroundColor: '#3d82f0', order: 3, stack: 'Stack 0' },
                { label: 'Dock Events', data: daily.map((r) => r.dock), backgroundColor: '#d4961f', order: 2, stack: 'Stack 0' },
                { label: 'Reliability %', data: daily.map((r) => r.rel), type: 'line' as const, borderColor: '#1fa355', backgroundColor: '#1fa355', yAxisID: 'y1', tension: 0.3, pointRadius: 3, borderWidth: 1.5, borderDash: [3, 3], order: 1 },
                { label: 'Target %', data: dates.map(() => 97), type: 'line' as const, yAxisID: 'y1', borderColor: 'rgba(160,160,160,1)', borderDash: [3, 3], borderWidth: 1.5, pointRadius: 0, fill: false, tension: 0, order: 0 },
              ],
            } as ChartData<'bar' | 'line', number[], string> as ChartData<'bar', number[], string>}
            options={{
              responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
              onClick: (_e, els) => {
                if (!els.length) return;
                const el = els[0]!;
                showDayDebug(daily[el.index], el.datasetIndex === 3 ? 'reliability' : 'events');
              },
              plugins: {
                legend: {
                  labels: {
                    usePointStyle: true, boxWidth: 32, padding: 20,
                    sort: (a, b) => (a.datasetIndex ?? 0) - (b.datasetIndex ?? 0),
                    generateLabels: (chart) => {
                      const labels = ChartJS.defaults.plugins.legend.labels.generateLabels(chart);
                      labels.forEach((l) => {
                        if (l.datasetIndex === 3) { l.pointStyle = pts.rel; }
                        else if (l.datasetIndex === 4) { l.pointStyle = pts.tgt; }
                        else { l.pointStyle = 'rect'; }
                      });
                      return labels;
                    },
                  },
                },
                tooltip: {
                  usePointStyle: true, boxWidth: 28, boxHeight: 10,
                  itemSort: (a, b) => a.datasetIndex - b.datasetIndex,
                  filter: (item) => item.datasetIndex < 4,
                  callbacks: {
                    labelPointStyle: (ctx) =>
                      ctx.datasetIndex === 3 ? { pointStyle: pts.rel, rotation: 0 }
                      : ctx.datasetIndex === 4 ? { pointStyle: pts.tgt, rotation: 0 }
                      : { pointStyle: 'rect', rotation: 0 },
                    label: (ctx) => `${ctx.dataset.label}: ${(ctx.dataset as { yAxisID?: string }).yAxisID === 'y1' ? (ctx.parsed.y ?? 0).toFixed(2) + '%' : (ctx.parsed.y ?? 0) + ' events'}`,
                  },
                },
              },
              scales: {
                x: { stacked: true, title: { display: true, text: 'Date' }, grid: gridCfg },
                y: { stacked: true, title: { display: true, text: 'Event Count' }, beginAtZero: true, grid: gridCfg },
                y1: { title: { display: true, text: 'Reliability %' }, position: 'right', min: 0, max: 102, grid: { display: false } },
              },
            }}
          />
        </div>
      </div>
      <div className="panel">
        <h3>P50 & P95 SPEED TREND<InfoButton k="p50_chart" /></h3>
        <div className="chart-box" style={{ height: 260 }}>
          <Line
            data={{
              labels: dates,
              datasets: [
                { label: 'P50 Speed (ms)', data: p50Arr, borderColor: '#d4961f', backgroundColor: 'rgba(212,150,31,.1)', fill: true, tension: 0.3, pointRadius: 3, spanGaps: true, order: 1 },
                { label: 'P95 Speed (ms)', data: p95Arr, borderColor: '#e74c3c', backgroundColor: 'rgba(231,76,60,0.1)', fill: true, tension: 0.3, pointRadius: 3, spanGaps: true, order: 2 },
                { label: 'Target (ms)', data: dates.map(() => 1000), borderColor: 'rgba(160,160,160,1)', borderDash: [3, 3], borderWidth: 1.5, pointRadius: 0, fill: false, tension: 0, order: 0 },
              ],
            }}
            options={{
              responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
              onClick: (_e, els) => { if (els.length) showDayDebug(daily[els[0]!.index], 'speed'); },
              plugins: {
                legend: {
                  labels: {
                    usePointStyle: true, boxWidth: 32, padding: 20,
                    sort: (a, b) => (a.datasetIndex ?? 0) - (b.datasetIndex ?? 0),
                    generateLabels: (chart) => {
                      const labels = ChartJS.defaults.plugins.legend.labels.generateLabels(chart);
                      labels.forEach((l) => {
                        if (l.datasetIndex === 0) l.pointStyle = pts.p50;
                        else if (l.datasetIndex === 1) l.pointStyle = pts.p95;
                        else if (l.datasetIndex === 2) l.pointStyle = pts.tgt;
                      });
                      return labels;
                    },
                  },
                },
                tooltip: {
                  usePointStyle: true, boxWidth: 28, boxHeight: 10, itemSort: (a, b) => a.datasetIndex - b.datasetIndex,
                  callbacks: {
                    labelPointStyle: (ctx) =>
                      ctx.datasetIndex === 0 ? { pointStyle: pts.p50, rotation: 0 }
                      : ctx.datasetIndex === 1 ? { pointStyle: pts.p95, rotation: 0 }
                      : { pointStyle: pts.tgt, rotation: 0 },
                    label: (ctx) =>
                      ctx.datasetIndex === 0 ? `P50 (ms) : ${Math.round(ctx.parsed.y ?? 0)} ms`
                      : ctx.datasetIndex === 1 ? `P95 (ms) : ${Math.round(ctx.parsed.y ?? 0)} ms`
                      : 'Target (ms) : <1000 ms',
                  },
                },
              },
              scales: {
                x: { title: { display: true, text: 'Date' }, grid: gridCfg },
                y: { title: { display: true, text: 'Speed (ms)' }, beginAtZero: true, grid: gridCfg },
              },
            }}
          />
        </div>
      </div>
    </div>

    <div className="grid-2">
      <div className="panel">
        <h3>NORTH STAR TREND<InfoButton k="ns_chart" /></h3>
        <div className="chart-box" style={{ height: 260 }}>
          <Line
            data={{
              labels: dates,
              datasets: [
                { label: 'North Star %', data: nsArr, borderColor: '#3d82f0', backgroundColor: 'rgba(61,130,240,.1)', fill: true, tension: 0.3, pointRadius: 3, spanGaps: true, order: 1 },
                { label: 'Target %', data: dates.map(() => 95), borderColor: 'rgba(160,160,160,1)', borderDash: [3, 3], borderWidth: 1.5, pointRadius: 0, fill: false, tension: 0, order: 0 },
              ],
            }}
            options={{
              responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
              onClick: (_e, els) => { if (els.length) showDayDebug(daily[els[0]!.index], 'ns'); },
              plugins: {
                legend: {
                  labels: {
                    usePointStyle: true, boxWidth: 32, padding: 20,
                    sort: (a, b) => (a.datasetIndex ?? 0) - (b.datasetIndex ?? 0),
                    generateLabels: (chart) => {
                      const labels = ChartJS.defaults.plugins.legend.labels.generateLabels(chart);
                      labels.forEach((l) => {
                        if (l.datasetIndex === 0) l.pointStyle = pts.ns;
                        else if (l.datasetIndex === 1) l.pointStyle = pts.tgt;
                      });
                      return labels;
                    },
                  },
                },
                tooltip: {
                  usePointStyle: true, boxWidth: 28, boxHeight: 10, itemSort: (a, b) => a.datasetIndex - b.datasetIndex,
                  callbacks: {
                    labelPointStyle: (ctx) =>
                      ctx.datasetIndex === 0 ? { pointStyle: pts.ns, rotation: 0 } : { pointStyle: pts.tgt, rotation: 0 },
                    label: (ctx) =>
                      ctx.datasetIndex === 0 ? `NS: ${(ctx.parsed.y ?? 0).toFixed(1)}%`
                      : ctx.datasetIndex === 1 ? 'Target: >= 95%'
                      : `${ctx.dataset.label}: ${ctx.parsed.y ?? 0}`,
                  },
                },
              },
              scales: {
                x: { title: { display: true, text: 'Date' }, grid: gridCfg },
                y: { title: { display: true, text: 'North Star %' }, beginAtZero: false, min: 60, max: 102, grid: gridCfg },
              },
            }}
          />
        </div>
      </div>
      <div className="panel">
        <h3>FAILURES TREND<InfoButton k="fail_trend_chart" /></h3>
        <div className="chart-box" style={{ height: 260 }}>
          <Bar
            data={{
              labels: dates,
              datasets: [
                { label: 'Hub Failures', data: daily.map((r) => r.failHub), backgroundColor: '#9353d4', order: 3, stack: 'Stack 0' },
                { label: 'App Failures', data: daily.map((r) => r.failApp), backgroundColor: '#e04545', order: 2, stack: 'Stack 0' },
                { label: 'Dock Failures', data: daily.map((r) => r.failDock), backgroundColor: '#d4961f', order: 1, stack: 'Stack 0' },
              ],
            }}
            options={{
              responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
              onClick: (_e, els) => { if (els.length) showDayDebug(daily[els[0]!.index], 'reliability'); },
              plugins: {
                legend: { labels: { usePointStyle: true, boxWidth: 12, padding: 20, sort: (a, b) => (a.datasetIndex ?? 0) - (b.datasetIndex ?? 0) } },
                tooltip: {
                  usePointStyle: true, boxWidth: 12, itemSort: (a, b) => a.datasetIndex - b.datasetIndex,
                  callbacks: { label: (ctx) => `${ctx.dataset.label}: ${ctx.parsed.y}` },
                },
              },
              scales: {
                x: { stacked: true, title: { display: true, text: 'Date' }, grid: gridCfg },
                y: { stacked: true, title: { display: true, text: 'Failure Count' }, beginAtZero: true, grid: gridCfg },
              },
            }}
          />
        </div>
      </div>
    </div>

    <div className="panel">
      <h3>ACTIVITY HEATMAP<InfoButton k="heatmap" /></h3>
      <Heatmap hub={hub} d={d} mode="activity" />
    </div>
    <div className="panel">
      <h3>FAILURES HEATMAP<InfoButton k="heatmap_fail" /></h3>
      <Heatmap hub={hub} d={d} mode="failures" />
    </div>
  </>);
}
