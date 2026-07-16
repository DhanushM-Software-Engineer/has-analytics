/** Chart.js registration + global defaults (matches vanilla dashboard). */
import {
  Chart,
  ArcElement,
  BarElement,
  LineElement,
  PointElement,
  BarController,
  LineController,
  DoughnutController,
  PieController,
  CategoryScale,
  LinearScale,
  Filler,
  Legend,
  Tooltip,
} from 'chart.js';

Chart.register(
  ArcElement, BarElement, LineElement, PointElement,
  BarController, LineController, DoughnutController, PieController,
  CategoryScale, LinearScale, Filler, Legend, Tooltip,
);

Chart.defaults.color = '#7c7c89';
Chart.defaults.borderColor = '#22222a';
Chart.defaults.font.family = 'Inter';
Chart.defaults.font.size = 10;

/** Small legend point-style canvases used by the vanilla charts. */
function lineDotCanvas(color: string, dashed: boolean, dot: boolean): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = 24; c.height = 10;
  const ctx = c.getContext('2d')!;
  ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 1.5;
  if (dashed) ctx.setLineDash([3, 3]);
  ctx.beginPath(); ctx.moveTo(0, 5); ctx.lineTo(24, 5); ctx.stroke();
  if (dot) { ctx.setLineDash([]); ctx.beginPath(); ctx.arc(12, 5, 3.5, 0, Math.PI * 2); ctx.fill(); }
  return c;
}

export const legendPt = {
  rel: () => lineDotCanvas('#10b981', true, true),
  tgt: () => lineDotCanvas('rgba(160,160,160,1)', true, false),
  p50: () => lineDotCanvas('#f59e0b', false, true),
  p95: () => lineDotCanvas('#f43f5e', false, true),
  ns: () => lineDotCanvas('#6366f1', false, true),
};

