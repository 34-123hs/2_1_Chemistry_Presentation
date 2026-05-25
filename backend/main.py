"""
NNP 추론 서빙 API (FastAPI)

- PyTorch 모델을 GPU에 1회 로드(fp16)
- POST /predict : 원자(원소 + 좌표) JSON → 에너지/힘 추론 → JSON
- GET  /health  : 상태 점검

⚠️ 아직 학습된 모델이 없으므로 추론 결과는 '고정값'을 반환한다.
   실제 모델이 준비되면 load_model() / run_inference()의 표시된 부분만 교체하면 된다.

실행 (AWS EC2 예):
    pip install -r requirements.txt
    uvicorn main:app --host 0.0.0.0 --port 8000
"""

from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
from pathlib import Path

import torch
import torch.nn as nn
from fastapi import FastAPI
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, field_validator

# ----------------------------------------------------------------------
# 설정
# ----------------------------------------------------------------------
MODEL_PATH = Path("model.pt")           # 실제 모델 체크포인트 경로(아직 없음)
MAX_CONCURRENT_INFER = 4                # GPU 동시 추론 제한 개수
DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
DTYPE = torch.float16 if DEVICE == "cuda" else torch.float32  # GPU에서는 fp16

# GPU 동시 추론을 4개로 제한하는 세마포어 (Python 3.10+ : 모듈 레벨 생성 가능)
gpu_sem = asyncio.Semaphore(MAX_CONCURRENT_INFER)

# 로드된 모델을 담는 전역 (lifespan에서 1회만 로드)
_model: nn.Module | None = None


# ----------------------------------------------------------------------
# 모델 정의 / 로드
# ----------------------------------------------------------------------
class _PlaceholderNNP(nn.Module):
    """실제 모델 대체용 임시 네트워크.

    학습 모델 연결 전까지 GPU 로드/추론 경로를 그대로 태우기 위한 더미다.
    입력: (N, 4) = [원자번호 Z, x, y, z]  →  출력: 원자별 에너지 기여 (N,)
    """

    def __init__(self) -> None:
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(4, 64), nn.SiLU(),
            nn.Linear(64, 64), nn.SiLU(),
            nn.Linear(64, 1),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.net(x).squeeze(-1)


def load_model() -> nn.Module:
    """모델을 1회 로드해 GPU(fp16)에 올린다."""
    model = _PlaceholderNNP()

    # --- 실제 모델 연결 시 아래 두 줄 사용 ---
    # state = torch.load(MODEL_PATH, map_location="cpu")
    # model.load_state_dict(state)

    model = model.to(DEVICE)
    if DEVICE == "cuda":
        model = model.half()            # 수백 MB 모델 가정 → fp16
    model.eval()
    return model


@asynccontextmanager
async def lifespan(app: FastAPI):
    """서버 기동 시 모델을 1회 로드, 종료 시 해제."""
    global _model
    _model = load_model()
    yield
    _model = None


# ----------------------------------------------------------------------
# 입출력 스키마 (pydantic BaseModel)
# ----------------------------------------------------------------------
class Atom(BaseModel):
    element: str = Field(..., description="원소 기호 (예: 'C', 'H', 'O')")
    x: float
    y: float
    z: float

    @field_validator("element")
    @classmethod
    def _not_blank(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("element는 비어 있을 수 없습니다.")
        return v


class PredictRequest(BaseModel):
    atoms: list[Atom] = Field(..., min_length=1, description="분자를 구성하는 원자 목록")


class PredictResponse(BaseModel):
    energy: float = Field(..., description="예측 에너지")
    forces: list[list[float]] = Field(..., description="원자별 힘 [[fx, fy, fz], ...]")
    n_atoms: int
    unit: str = "eV"
    note: str = ""


class StepRequest(BaseModel):
    """MD 릴랙세이션 한 스텝 요청 (인터랙티브 데모용)."""
    atoms: list[Atom] = Field(..., min_length=1, description="현재 원자 배치")
    dt: float = Field(0.08, gt=0, description="스텝 크기(완화 속도)")


class StepResponse(BaseModel):
    atoms: list[list[float]] = Field(..., description="다음 스텝의 원자 좌표 [[x, y, z], ...]")
    energy: float
    note: str = ""


# 원소기호 → 원자번호 (간이 표; 실제 모델 연결 시 확장)
_Z = {"H": 1, "C": 6, "N": 7, "O": 8, "F": 9, "P": 15, "S": 16, "Cl": 17}


# ----------------------------------------------------------------------
# 추론 (블로킹) — run_in_threadpool 로 호출되어 이벤트 루프를 막지 않음
# ----------------------------------------------------------------------
def run_inference(req: PredictRequest) -> PredictResponse:
    n = len(req.atoms)

    # 입력을 (N, 4) 텐서로 구성 = [Z, x, y, z]
    feats = [[float(_Z.get(a.element, 0)), a.x, a.y, a.z] for a in req.atoms]
    x = torch.tensor(feats, dtype=DTYPE, device=DEVICE)

    with torch.no_grad():
        out = _model(x)                 # 추론 경로 실제 실행 (GPU / fp16 / no_grad)
    _ = out                             # (현재는 결과를 쓰지 않음 — 고정값 반환)

    # ⚠️ 학습 모델이 없으므로 결과는 '고정값'으로 반환한다.
    #    실제 모델 연결 시:
    #      energy = float(out.sum())
    #      forces = (-torch.autograd.grad(out.sum(), coords)[0]).tolist()
    energy = -123.456                   # 고정 예시 에너지
    forces = [[0.0, 0.0, 0.0] for _i in range(n)]
    return PredictResponse(
        energy=energy,
        forces=forces,
        n_atoms=n,
        note="고정값 (학습 모델 미연결)",
    )


def _relax_step(pos: list[list[float]], dt: float) -> tuple[list[list[float]], float]:
    """플레이스홀더 동역학: 원자들이 적당한 간격으로 퍼지며 '평형'에 수렴.

    실제 모델 연결 시 이 함수를 (힘 = -dE/dr 로 좌표 갱신)으로 교체한다.
    스케일 불변: 목표 간격을 평균 최근접 거리로 잡는다.
    """
    n = len(pos)
    if n < 2:
        return [list(p) for p in pos], 0.0

    # 목표 간격 = 평균 최근접 거리
    nn = []
    for i in range(n):
        nn.append(min(
            sum((pos[i][k] - pos[j][k]) ** 2 for k in range(3)) ** 0.5
            for j in range(n) if j != i
        ))
    target = (sum(nn) / n) or 1.0
    centroid = [sum(p[k] for p in pos) / n for k in range(3)]

    new = [list(p) for p in pos]
    energy = 0.0
    for i in range(n):
        f = [0.0, 0.0, 0.0]
        for j in range(n):
            if i == j:
                continue
            d = [pos[i][k] - pos[j][k] for k in range(3)]
            dist = (d[0] ** 2 + d[1] ** 2 + d[2] ** 2) ** 0.5 or 1e-6
            mag = -(dist - target) / target        # 너무 가까우면 +(밀어냄)
            for k in range(3):
                f[k] += (d[k] / dist) * mag
            energy += (dist - target) ** 2          # 평형에서 최소가 되는 가상 에너지
        for k in range(3):
            f[k] += (centroid[k] - pos[i][k]) * 0.02  # 약한 센터링(발산 방지)
            new[i][k] = pos[i][k] + f[k] * dt * target
    return new, energy * 0.5


def run_step(req: StepRequest) -> StepResponse:
    pos = [[a.x, a.y, a.z] for a in req.atoms]

    # 추론 경로 실제 실행(GPU / fp16 / no_grad) — 머신러닝 서빙 골격 유지
    feats = [[float(_Z.get(a.element, 0)), a.x, a.y, a.z] for a in req.atoms]
    x = torch.tensor(feats, dtype=DTYPE, device=DEVICE)
    with torch.no_grad():
        _ = _model(x)

    # ⚠️ 학습 모델이 없으므로 다음 위치는 '플레이스홀더 동역학'으로 계산한다.
    next_pos, energy = _relax_step(pos, req.dt)
    return StepResponse(atoms=next_pos, energy=energy, note="플레이스홀더 동역학 (학습 모델 미연결)")


# ----------------------------------------------------------------------
# FastAPI 앱
# ----------------------------------------------------------------------
app = FastAPI(title="NNP 추론 API", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        # TODO: 허용할 프론트엔드 출처를 여기에 채워 넣을 것
        # 예) "https://34-123hs.github.io",
    ],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health() -> dict:
    return {
        "status": "ok",
        "device": DEVICE,
        "dtype": str(DTYPE).replace("torch.", ""),
        "model_loaded": _model is not None,
        "cuda": torch.cuda.is_available(),
        "max_concurrent_infer": MAX_CONCURRENT_INFER,
    }


@app.post("/predict", response_model=PredictResponse)
async def predict(req: PredictRequest) -> PredictResponse:
    # GPU 동시 추론을 4개로 제한
    async with gpu_sem:
        # 블로킹 추론은 스레드풀에서 실행
        return await run_in_threadpool(run_inference, req)


@app.post("/step", response_model=StepResponse)
async def step(req: StepRequest) -> StepResponse:
    # MD 릴랙세이션 한 스텝 (인터랙티브 데모). 동시 추론 제한 동일 적용.
    async with gpu_sem:
        return await run_in_threadpool(run_step, req)
