/* =====================================================================
   interactions.js — 사용자 인터랙션 (클릭/버튼)
   ⚠️ 규칙 2: 콘텐츠 자동 페이드 금지. 동작은 "실행 버튼 클릭"으로만 시작된다.

   슬라이드 4(직렬 vs 병렬): "스마일 그리기" 데모.
   - CPU 레인: 픽셀을 한 칸씩 순차로 칠한다(느림).
   - GPU 레인: 스마일 픽셀을 한 번에 칠한다(병렬).
   네트워크 의존 없는 로컬 구현(YouTube 임베드가 막힌 환경에서도 항상 동작).
   원본 영상(NVIDIA×Mythbusters)은 슬라이드의 참고 이미지/링크로 연결.
   ===================================================================== */

// 1 = 스마일(칠할 픽셀), 0 = 배경
const SMILEY = [
  "000011110000",
  "001111111100",
  "011111111110",
  "011001100110",  // 눈
  "111111111111",
  "111111111111",
  "010111111010",  // 입 끝
  "011011110110",  // 입
  "001100001100",  // 입 바닥
  "000011110000",
];
const COLS = SMILEY[0].length;          // 12
const FLAT = SMILEY.join("").split("");  // 길이 120
const N = FLAT.length;

const CELL_MS  = 16;     // 화면상 CPU 한 칸 점등 간격
const CPU_UNIT = 0.07;   // 가상 연산시간(초)/칸
const GPU_TIME = 0.08;   // 병렬 총 시간(초) — Mythbusters의 "80ms" 오마주

function buildGrid(el) {
  el.style.setProperty("--cols", COLS);
  const frag = document.createDocumentFragment();
  for (let i = 0; i < N; i++) {
    const c = document.createElement("span");
    c.className = FLAT[i] === "1" ? "cell img" : "cell";
    frag.appendChild(c);
  }
  el.appendChild(frag);
  return [...el.children];
}

function initPaintDemo() {
  const gc = document.getElementById("gridCpu");
  const gg = document.getElementById("gridGpu");
  const btn = document.querySelector(".runbtn");
  if (!gc || !gg || !btn) return;
  if (gc.childElementCount) return; // 중복 초기화 방지

  const cpuCells = buildGrid(gc);
  const gpuCells = buildGrid(gg);
  const cpuT = document.querySelector('[data-time="cpu"]');
  const gpuT = document.querySelector('[data-time="gpu"]');
  const verdict = document.querySelector(".verdict");

  let timers = [];
  let running = false;

  function reset() {
    timers.forEach(clearTimeout); timers = [];
    [...cpuCells, ...gpuCells].forEach((c) => c.classList.remove("on"));
    cpuT.textContent = "0.00s"; gpuT.textContent = "0.00s";
    if (verdict) verdict.textContent = "";
  }

  btn.addEventListener("click", () => {
    if (running) { reset(); running = false; btn.textContent = "▶ 실행"; return; }
    reset(); running = true; btn.textContent = "■ 초기화";

    // CPU: 모든 픽셀을 한 칸씩 훑으며 스마일 칸만 칠한다(순차).
    cpuCells.forEach((c, i) => {
      timers.push(setTimeout(() => {
        if (c.classList.contains("img")) c.classList.add("on");
        cpuT.textContent = ((i + 1) * CPU_UNIT).toFixed(2) + "s";
        if (i === N - 1) {
          if (verdict) verdict.textContent = "→ 병렬이 훨씬 빠르다";
          running = false; btn.textContent = "▶ 실행";
        }
      }, CELL_MS * (i + 1)));
    });

    // GPU: 스마일 칸을 한 틱에 전부 칠한다(병렬).
    timers.push(setTimeout(() => {
      gpuCells.forEach((c) => { if (c.classList.contains("img")) c.classList.add("on"); });
      gpuT.textContent = GPU_TIME.toFixed(2) + "s";
    }, CELL_MS));
  });
}

function initInteractions() {
  initPaintDemo();
}
window.initInteractions = initInteractions;
