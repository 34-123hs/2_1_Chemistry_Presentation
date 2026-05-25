/* =====================================================================
   charts.js — 발표용 Chart.js 그래프 (값은 모두 임의의 예시)

   ⚠️ 규칙 2: AI 느낌의 느린 등장 금지 → Chart.defaults.animation = false.
   숨겨진 reveal 슬라이드에서도 0-size 없이 그려지도록 canvas는 고정 픽셀
   크기 + responsive:false 로 둔다.
   ===================================================================== */

const C = {
  ink:    "#15171c",
  soft:   "#8a8f99",
  line:   "#e2ddd1",
  accent: "#1f3bff",   // 코발트 블루 (NN / 근사)
  green:  "#0e9f6e",   // 그린 (실측 / 참값)
  coral:  "#ff5a36",   // 코랄 (강조)
  band:   "rgba(31,59,255,0.08)", // 학습 구간 음영
};

const charts = {};       // id -> Chart 인스턴스
let built = false;

// --- 공통 옵션 --------------------------------------------------------
function baseOptions(extra = {}) {
  return Object.assign({
    responsive: false,
    maintainAspectRatio: false,
    animation: false,
    plugins: {
      legend: { labels: { boxWidth: 12, font: { size: 11 } } },
    },
    scales: {
      x: { grid: { color: C.line }, ticks: { font: { size: 10 }, color: C.soft } },
      y: { grid: { color: C.line }, ticks: { font: { size: 10 }, color: C.soft } },
    },
  }, extra);
}

// 학습 구간(가로 x범위)을 옅게 칠하는 작은 플러그인
function trainRegionPlugin(xMin, xMax) {
  return {
    id: "trainRegion",
    beforeDraw(chart) {
      const { ctx, chartArea, scales } = chart;
      if (!scales.x) return;
      const x1 = scales.x.getPixelForValue(xMin);
      const x2 = scales.x.getPixelForValue(xMax);
      ctx.save();
      ctx.fillStyle = C.band;
      ctx.fillRect(x1, chartArea.top, x2 - x1, chartArea.bottom - chartArea.top);
      ctx.restore();
    },
  };
}

// --- 데이터 생성기 (임의값) ------------------------------------------
function sinData(from, to, step) {
  const xs = [], y = [];
  for (let x = from; x <= to + 1e-9; x += step) { xs.push(+x.toFixed(2)); y.push(+Math.sin(x).toFixed(3)); }
  return { xs, y };
}

// 학습 범위 [-π,π] 밖에서 빗나가는 "외삽 실패" NN 근사
function nnExtrap(xs) {
  const P = Math.PI;
  return xs.map((x) => {
    if (x >= -P && x <= P) return +(Math.sin(x) + (Math.random() - 0.5) * 0.04).toFixed(3);
    if (x > P) return +(-0.45 * (x - P)).toFixed(3);          // 위로 다시 오르지 못하고 어긋남
    return +(0.45 * (x + P)).toFixed(3);
  });
}

// =====================================================================
function buildCharts() {
  if (built || typeof Chart === "undefined") return;
  built = true;

  Chart.defaults.animation = false;
  Chart.defaults.font.family = "Pretendard, system-ui, sans-serif";
  Chart.defaults.color = C.ink;

  // 1) sin 근사 ---------------------------------------------------------
  if (document.getElementById("chartSin")) {
    const d = sinData(0, 2 * Math.PI, 0.25);
    charts.chartSin = new Chart(document.getElementById("chartSin"), {
      type: "line",
      data: {
        labels: d.xs,
        datasets: [
          { label: "참값 sin", data: d.y, borderColor: C.green, borderWidth: 2, pointRadius: 0 },
          { label: "NN 근사", data: d.y.map((v) => +(v + (Math.random() - 0.5) * 0.06).toFixed(3)),
            borderColor: C.accent, borderWidth: 2, borderDash: [5, 4], pointRadius: 0 },
        ],
      },
      options: baseOptions(),
    });
  }

  // 2) 2D 평면의 원 (경계 학습) ----------------------------------------
  if (document.getElementById("chartCircle")) {
    const inside = [], outside = [];
    for (let i = 0; i < 60; i++) {
      const x = +(Math.random() * 4 - 2).toFixed(2);
      const y = +(Math.random() * 4 - 2).toFixed(2);
      (x * x + y * y <= 1 ? inside : outside).push({ x, y });
    }
    const ring = [];
    for (let t = 0; t <= 2 * Math.PI + 0.1; t += 0.1) ring.push({ x: +Math.cos(t).toFixed(3), y: +Math.sin(t).toFixed(3) });
    charts.chartCircle = new Chart(document.getElementById("chartCircle"), {
      type: "scatter",
      data: {
        datasets: [
          { label: "안", data: inside, backgroundColor: C.green, pointRadius: 3 },
          { label: "밖", data: outside, backgroundColor: C.soft, pointRadius: 3 },
          { label: "학습 경계", data: ring, type: "line", borderColor: C.accent, borderWidth: 2, pointRadius: 0, showLine: true },
        ],
      },
      options: baseOptions({ scales: {
        x: { min: -2, max: 2, grid: { color: C.line }, ticks: { font: { size: 10 }, color: C.soft } },
        y: { min: -2, max: 2, grid: { color: C.line }, ticks: { font: { size: 10 }, color: C.soft } },
      } }),
    });
  }

  // 3) KNO3 용해도 vs 온도 ---------------------------------------------
  if (document.getElementById("chartKNO3")) {
    const temps = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    const sol   = [13, 21, 32, 46, 64, 86, 110, 138, 169, 202, 246]; // 임의(실측 느낌)
    charts.chartKNO3 = new Chart(document.getElementById("chartKNO3"), {
      type: "scatter",
      data: {
        datasets: [
          { label: "실측", data: temps.map((t, i) => ({ x: t, y: sol[i] })), backgroundColor: C.green, pointRadius: 4 },
          { label: "NN 근사", type: "line", data: temps.map((t, i) => ({ x: t, y: sol[i] + (Math.random() - 0.5) * 6 })),
            borderColor: C.accent, borderWidth: 2, pointRadius: 0, showLine: true, tension: 0.4 },
        ],
      },
      options: baseOptions({ scales: {
        x: { title: { display: true, text: "온도 (°C)", font: { size: 10 } }, grid: { color: C.line }, ticks: { font: { size: 10 }, color: C.soft } },
        y: { title: { display: true, text: "용해도 (g)", font: { size: 10 } }, grid: { color: C.line }, ticks: { font: { size: 10 }, color: C.soft } },
      } }),
    });
  }

  // 4) 외삽 실패 (학습 범위 밖) ----------------------------------------
  if (document.getElementById("chartExtrap")) {
    const d = sinData(-3 * Math.PI, 3 * Math.PI, 0.2);
    charts.chartExtrap = new Chart(document.getElementById("chartExtrap"), {
      type: "line",
      data: {
        labels: d.xs,
        datasets: [
          { label: "참값 sin", data: d.y, borderColor: C.green, borderWidth: 2, pointRadius: 0 },
          { label: "NN 근사", data: nnExtrap(d.xs), borderColor: C.accent, borderWidth: 2, borderDash: [5, 4], pointRadius: 0 },
        ],
      },
      options: baseOptions(),
      plugins: [trainRegionPlugin(-Math.PI, Math.PI)],
    });
  }

  // 5) 에너지 수렴 곡선 -------------------------------------------------
  if (document.getElementById("chartConverge")) {
    const steps = Array.from({ length: 30 }, (_, i) => i);
    const e = steps.map((i) => +(8 * Math.exp(-i / 6) + 0.3 + (Math.random() - 0.5) * 0.15).toFixed(3));
    charts.chartConverge = new Chart(document.getElementById("chartConverge"), {
      type: "line",
      data: {
        labels: steps,
        datasets: [
          { label: "에너지", data: e, borderColor: C.accent, backgroundColor: C.band,
            borderWidth: 2, pointRadius: 0, fill: true },
        ],
      },
      options: baseOptions({ scales: {
        x: { title: { display: true, text: "반복 step", font: { size: 10 } }, grid: { color: C.line }, ticks: { font: { size: 10 }, color: C.soft } },
        y: { title: { display: true, text: "에너지", font: { size: 10 } }, grid: { color: C.line }, ticks: { font: { size: 10 }, color: C.soft } },
      } }),
    });
  }
}

// 슬라이드 진입 시 해당 슬라이드 안의 차트만 다시 크기 맞춤(안전망)
function resizeChartsIn(slide) {
  if (!slide) return;
  slide.querySelectorAll("canvas").forEach((cv) => {
    const ch = charts[cv.id];
    if (ch) ch.resize();
  });
}

window.buildCharts = buildCharts;
window.resizeChartsIn = resizeChartsIn;
