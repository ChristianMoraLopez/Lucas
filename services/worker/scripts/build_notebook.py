"""Genera notebooks/laya_lucas_finetune.ipynb (y revisa que cada celda compile).

    uv run python scripts/build_notebook.py notebooks/laya_lucas_finetune.ipynb

Editar aquí y regenerar: así el notebook queda revisable en los diffs.
"""

import ast
import json
import sys
from pathlib import Path

cells = []


def md(s: str) -> None:
    cells.append({"cell_type": "markdown", "metadata": {}, "source": s.strip("\n").splitlines(keepends=True)})


def code(s: str) -> None:
    fuente = s.strip("\n").splitlines(keepends=True)
    cells.append({"cell_type": "code", "metadata": {}, "execution_count": None, "outputs": [], "source": fuente})


md(r"""
# Ajustar Laya para clasificar los gastos de Lucas

Este notebook toma los ejemplos que exporta `services/worker/scripts/export_training.py` (las correcciones de categoría que hicieron las personas en la bandeja de revisión), ajusta **Laya** con esos ejemplos, lo calibra, lo exporta a **ONNX INT8** y lo sube a tu repositorio privado de Hugging Face. El worker de Lucas lo baja de ahí y lo corre en CPU, sin PyTorch.

Corre en **Google Colab** o **Kaggle**, gratis:

| | Colab | Kaggle |
|---|---|---|
| GPU | *Entorno de ejecución → Cambiar tipo → T4 GPU* | *Settings → Accelerator → GPU T4 x1* (o x2) |
| Internet | ya viene | *Settings → Internet → On* |
| `HF_TOKEN` (permiso **write**) | 🔑 *Secrets* en la barra izquierda | *Add-ons → Secrets* |
| Datos | sube `laya-data.zip` cuando lo pida la celda 3 | *Add data → Upload* con `laya-data.zip` |

Las dos variantes que el worker sabe usar (`LAYA_VARIANT`):

| Variante | Checkpoint base | Lee | Para qué |
|---|---|---|---|
| `multilingual` | `convaiinnovations/laya-multilingual` (mmBERT-base, 322M) | el texto original en español: comercio, mensaje, ítems, recibo | la de siempre; más liviana |
| `english` | `convaiinnovations/laya` (ModernBERT-large, 421M) | comercio + la descripción normalizada en inglés que escribe Qwen | si la multilingüe se queda corta |

Tiempo aproximado en una T4 con unos cientos de ejemplos: 5 a 15 minutos, más ~5 de exportar.

> **Primera vez (todavía sin correcciones):** deja `SOLO_EXPORTAR = True` y corre todo: se sube el modelo base (zero-shot) tal cual, para que el worker ya tenga Laya, y el worker le pone techo a su confianza. **Para ajustarlo** con las correcciones de la gente, pon `SOLO_EXPORTAR = False` y sube `laya-data.zip` cuando lo pida la celda 3.
""")

code(r"""
# 1. Configuración ─────────────────────────────────────────────────────────────
VARIANTE = "multilingual"          # "multilingual" | "english" (igual a LAYA_VARIANT del worker)
HF_REPO = ""                       # vacío = <tu usuario de Hugging Face>/lucas-laya (privado)
SOLO_EXPORTAR = True               # True: sube el modelo base sin ajustar · False: ajusta con laya-data.zip
DATOS = "laya-data"                # carpeta (o .zip) que sale de export_training.py

EPOCAS = 4
LOTE = 8                # secuencias por paso
ACUMULAR = 2            # pasos por actualización (lote efectivo = 16)
LR_ENCODER = 2.0e-5
LR_CABEZA = 1.0e-4
MAX_LEN = 512           # los "state" de Lucas son cortos; 512 sobra y ahorra memoria
HEAD_MAX_LEN = 192
SEMILLA = 20260930

BASE = {"multilingual": "convaiinnovations/laya-multilingual", "english": "convaiinnovations/laya"}[VARIANTE]
import os
SALIDA = f"/content/lucas-laya-{VARIANTE}" if os.path.isdir("/content") else f"/kaggle/working/lucas-laya-{VARIANTE}"
print("Base:", BASE, "→", SALIDA)
""")

code(r"""
# 2. Dependencias (laya trae torch, transformers y el exportador ONNX) ─────────
!pip install -q "laya[onnx]==0.3.22" "huggingface_hub>=0.26" safetensors
import laya, torch, transformers
print("laya", laya.__version__, "· torch", torch.__version__, "· transformers", transformers.__version__)
print("GPU:", torch.cuda.get_device_name(0) if torch.cuda.is_available() else "no hay (va a ser MUY lento)")
""")

code(r"""
# 3. Token de Hugging Face y datos ────────────────────────────────────────────
import os, json, zipfile, glob

def secreto(nombre):
    try:
        from google.colab import userdata  # Colab
        return userdata.get(nombre)
    except Exception:
        pass
    try:
        from kaggle_secrets import UserSecretsClient  # Kaggle
        return UserSecretsClient().get_secret(nombre)
    except Exception:
        return os.environ.get(nombre)

HF_TOKEN = secreto("HF_TOKEN")
assert HF_TOKEN, "Falta el secreto HF_TOKEN (con permiso write)"
os.environ["HF_TOKEN"] = HF_TOKEN

# Antes de trabajar media hora: ¿el token sirve y el repo es tuyo?
from huggingface_hub import HfApi
yo = HfApi(token=HF_TOKEN).whoami()
usuario = yo["name"]
espacios = [usuario, *[o["name"] for o in yo.get("orgs", [])]]
if not HF_REPO or HF_REPO.startswith("tu-usuario/"):
    HF_REPO = f"{usuario}/lucas-laya"
assert HF_REPO.split("/")[0] in espacios, (
    f"HF_REPO es de «{HF_REPO.split('/')[0]}», pero el token es de «{usuario}». "
    f'Pon HF_REPO = "{usuario}/lucas-laya" o déjalo vacío')
assert (yo.get("auth") or {}).get("accessToken", {}).get("role") != "read", (
    "HF_TOKEN es de solo lectura: el notebook necesita uno de tipo Write")
print(f"Hugging Face: {usuario} · el modelo se sube a {HF_REPO}")

def ubicar_datos():
    for candidato in [DATOS, *glob.glob("/kaggle/input/*/" + DATOS), *glob.glob("/kaggle/input/*")]:
        if os.path.isdir(os.path.join(candidato, VARIANTE)):
            return candidato
        if candidato.endswith(".zip") and os.path.exists(candidato):
            zipfile.ZipFile(candidato).extractall(DATOS)
            return DATOS
    for z in glob.glob("*.zip") + glob.glob("/kaggle/input/*/*.zip"):
        zipfile.ZipFile(z).extractall(DATOS)
        return DATOS
    try:
        from google.colab import files  # Colab: pedir el zip
        subido = next(iter(files.upload()))
        zipfile.ZipFile(subido).extractall(DATOS)
        return DATOS
    except Exception:
        return None

carpeta = None if SOLO_EXPORTAR else ubicar_datos()

def leer(nombre):
    ruta = os.path.join(carpeta, VARIANTE, nombre)
    with open(ruta, encoding="utf-8") as f:
        return [json.loads(l) for l in f if l.strip()]

if SOLO_EXPORTAR:
    train_rows, test_rows, pregunta_lucas = [], [], None
else:
    assert carpeta, "No encontré los datos: sube laya-data.zip (sale de export_training.py)"
    train_rows, test_rows = leer("train.jsonl"), leer("test.jsonl")
    pregunta_lucas = json.load(open(os.path.join(carpeta, VARIANTE, "lucas_question.json"), encoding="utf-8"))
    print(f"{len(train_rows)} para entrenar · {len(test_rows)} para evaluar")
    print(json.load(open(os.path.join(carpeta, VARIANTE, "stats.json")))["labels"])
""")

code(r"""
# 4. Checkpoint base y secuencias con el formato exacto de Laya ───────────────
import random
from huggingface_hub import snapshot_download
from transformers import AutoTokenizer
from laya.agent import _fix_tokenizer_config
from laya.common import build_sequence, render_options, QTYPES

base_dir = snapshot_download(BASE)
_fix_tokenizer_config(base_dir)
tok = AutoTokenizer.from_pretrained(os.path.join(base_dir, "tokenizer"))
cfg = json.load(open(os.path.join(base_dir, "rl_agent_config.json")))
cfg["max_len"], cfg["head_max_len"] = MAX_LEN, HEAD_MAX_LEN

def item(row):
    # Igual que build_training_item del notebook oficial de Laya
    state = json.loads(row["state"])
    q = json.loads(row["questions"])["category"]
    g = json.loads(row["gold"])["category"]
    crit = q["criteria"]
    keys = list(crit)
    target = [g["probabilities"].get(k, 0.0) for k in keys]
    s = sum(target)
    target = [v / s for v in target]
    seq, markers = build_sequence(tok, state, {"t": "choice", "ins": q["instructions"], "crit": crit},
                                  cfg["max_len"], cfg["head_max_len"])
    if len(markers) != len(render_options({"t": "choice", "crit": crit})):
        return None
    return {"ids": seq, "markers": markers, "qtype": QTYPES["choice"], "target": target,
            "label": keys.index(g["label"]), "row": row}

train_items = [it for it in map(item, train_rows) if it]
test_items = [it for it in map(item, test_rows) if it]
print(len(train_items), "secuencias de entrenamiento ·", len(test_items), "de evaluación")
if train_items:
    print("Largo máximo:", max(len(it["ids"]) for it in train_items), "tokens")
""")

code(r"""
# 5. Cómo le va al modelo base (zero-shot) en tus datos ───────────────────────
def evaluar(agente, filas):
    if not filas:
        return None
    aciertos, confianzas = 0, []
    for r in filas:
        q = json.loads(r["questions"])
        a = agente.predict(json.loads(r["state"]), q)["answers"]["category"]
        oro = json.loads(r["gold"])["category"]["label"]
        aciertos += a["choice"] == oro
        confianzas.append(a["answer_confidence"])
    return {"exactitud": round(aciertos / len(filas), 3), "confianza_media": round(sum(confianzas) / len(confianzas), 3),
            "n": len(filas)}

dispositivo = "cuda" if torch.cuda.is_available() else "cpu"
metricas = {"zero_shot": None}
if test_rows:
    base_agent = laya.Agent(base_dir, device=dispositivo)
    metricas["zero_shot"] = evaluar(base_agent, test_rows)
    print("Zero-shot:", metricas["zero_shot"])
    del base_agent
    if torch.cuda.is_available():
        torch.cuda.empty_cache()
else:
    print("Sin datos de prueba: no hay nada que evaluar todavía")
""")

code(r"""
# 6. Ajuste (la receta del notebook oficial de Laya, en una sola GPU) ─────────
import time, math
from safetensors.torch import load_file, save_file
from laya.common import build_model, proper_reward

def collate(items, pad_id):
    n, L = len(items), max(len(it["ids"]) for it in items)
    k = max(len(it["markers"]) for it in items)
    ids = torch.full((n, L), pad_id, dtype=torch.long)
    att = torch.zeros((n, L), dtype=torch.long)
    mpos = torch.zeros((n, k), dtype=torch.long)
    mmask = torch.zeros((n, k), dtype=torch.bool)
    target = torch.zeros((n, k), dtype=torch.float32)
    for i, it in enumerate(items):
        ids[i, :len(it["ids"])] = torch.tensor(it["ids"])
        att[i, :len(it["ids"])] = 1
        mpos[i, :len(it["markers"])] = torch.tensor(it["markers"])
        mmask[i, :len(it["markers"])] = True
        target[i, :len(it["target"])] = torch.tensor(it["target"])
    return {"input_ids": ids, "attention_mask": att, "marker_pos": mpos, "marker_mask": mmask,
            "target": target, "qtype": torch.tensor([it["qtype"] for it in items])}

def ajustar_temperatura(pares):
    # pares = [(logits, target)]; como fit_one_temp del notebook oficial
    if len(pares) < 10:
        return 1.0
    kmax = max(len(z) for z, _ in pares)
    Z = torch.full((len(pares), kmax), -1e4)
    T = torch.zeros((len(pares), kmax))
    for i, (z, t) in enumerate(pares):
        Z[i, :len(z)] = torch.tensor(z)
        T[i, :len(t)] = torch.tensor(t, dtype=torch.float32)
    log_t = torch.zeros(1, requires_grad=True)
    opt = torch.optim.LBFGS([log_t], lr=0.1, max_iter=100)
    def cierre():
        opt.zero_grad()
        perdida = -(T * torch.log_softmax(Z / log_t.exp(), -1)).sum(-1).mean()
        perdida.backward()
        return perdida
    opt.step(cierre)
    return float(torch.clamp(log_t.exp(), 0.5, 5.0).item())

model = build_model(cfg, encoder_dir=os.path.join(base_dir, "encoder"))
model.load_state_dict(load_file(os.path.join(base_dir, "model.safetensors")), strict=True)
if not SOLO_EXPORTAR:
    model.to(dispositivo)
temperatura = cfg.get("temperature", [1.0, 1.0, 1.0])

if not SOLO_EXPORTAR:
    random.seed(SEMILLA); torch.manual_seed(SEMILLA)
    orden = list(range(len(train_items)))
    random.shuffle(orden)
    n_cal = max(10, len(train_items) // 10) if len(train_items) >= 60 else 0  # para calibrar, nunca se entrena con ellos
    calibrar = [train_items[i] for i in orden[:n_cal]]
    entrenar = [train_items[i] for i in orden[n_cal:]]

    model.encoder.gradient_checkpointing_enable(gradient_checkpointing_kwargs={"use_reentrant": False})
    model.head_checkpointing = True
    model.train()
    enc = [p for n, p in model.named_parameters() if n.startswith("encoder.")]
    cab = [p for n, p in model.named_parameters() if not n.startswith("encoder.")]
    opt = torch.optim.AdamW([{"params": enc, "lr": LR_ENCODER}, {"params": cab, "lr": LR_CABEZA}], weight_decay=0.01)
    pasos = max(1, math.ceil(len(entrenar) / (LOTE * ACUMULAR)) * EPOCAS)
    sched = torch.optim.lr_scheduler.CosineAnnealingLR(opt, T_max=pasos, eta_min=1e-6)
    usar_amp = dispositivo == "cuda"
    scaler = torch.amp.GradScaler("cuda", enabled=usar_amp)
    GRUPO, SIGMA0, SIGMA1 = 4, 0.4, 0.1
    t0 = time.time()
    for epoca in range(EPOCAS):
        random.shuffle(entrenar)
        sigma = SIGMA0 + (SIGMA1 - SIGMA0) * epoca / max(1, EPOCAS - 1)
        total, n = 0.0, 0
        opt.zero_grad(set_to_none=True)
        for b in range(0, len(entrenar), LOTE):
            lote = collate(entrenar[b:b + LOTE], tok.pad_token_id)
            with torch.autocast("cuda", dtype=torch.float16, enabled=usar_amp):
                logits, act = model(lote["input_ids"].to(dispositivo), lote["attention_mask"].to(dispositivo),
                                    lote["marker_pos"].to(dispositivo), lote["marker_mask"].to(dispositivo),
                                    lote["qtype"].to(dispositivo))
            logits = logits.float()
            mask = lote["marker_mask"].to(dispositivo)
            target = lote["target"].to(dispositivo)
            k = mask.sum(-1, keepdim=True).float()
            # RLCD: ruido de media cero sobre los logits, recompensa con reglas de puntaje propias…
            eps = torch.randn((GRUPO,) + logits.shape, device=dispositivo) * sigma * mask
            eps = (eps - eps.sum(-1, keepdim=True) / k) * mask
            z = logits.detach().unsqueeze(0) + eps
            q = torch.softmax(z.masked_fill(~mask, -1e4), -1)
            with torch.no_grad():
                r = proper_reward(q, target.unsqueeze(0), lote["qtype"].to(dispositivo), mask, w_sph=0.75, w_rps=1.0)
                ventaja = (r - r.mean(0, keepdim=True)) / (r.std() + 1e-6)
            logp = -(((z - logits.unsqueeze(0)) ** 2) * mask).sum(-1) / (2 * sigma ** 2)
            perdida_rl = -(ventaja * logp).mean()
            # …más entropía cruzada suave contra el gold
            perdida_ce = -(target * torch.log_softmax(logits.masked_fill(~mask, -1e4), -1)).sum(-1).mean()
            perdida = (perdida_rl + perdida_ce) / ACUMULAR + 0.0 * act.sum()
            scaler.scale(perdida).backward()
            n += 1
            if n % ACUMULAR == 0 or b + LOTE >= len(entrenar):
                scaler.unscale_(opt)
                torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
                scaler.step(opt); scaler.update(); sched.step()
                opt.zero_grad(set_to_none=True)
            total += perdida.item() * ACUMULAR
        print(f"Época {epoca + 1}/{EPOCAS} · pérdida {total / max(1, n):.4f} · {time.time() - t0:.0f} s")

    # Calibración: temperatura de las preguntas «choice» con lo que no se entrenó
    model.eval()
    pares = []
    with torch.no_grad():
        for b in range(0, len(calibrar), 16):
            lote = collate(calibrar[b:b + 16], tok.pad_token_id)
            with torch.autocast("cuda", dtype=torch.float16, enabled=usar_amp):
                lg, _ = model(lote["input_ids"].to(dispositivo), lote["attention_mask"].to(dispositivo),
                              lote["marker_pos"].to(dispositivo), lote["marker_mask"].to(dispositivo),
                              lote["qtype"].to(dispositivo))
            lg = lg.float().cpu().numpy()
            for i, it in enumerate(calibrar[b:b + 16]):
                pares.append((lg[i, :len(it["markers"])].tolist(), it["target"]))
    temperatura = list(cfg.get("temperature", [1.0, 1.0, 1.0]))
    if len(pares) >= 10:
        temperatura[0] = ajustar_temperatura(pares)
        print("Temperatura (choice):", round(temperatura[0], 3), f"· calibrada con {len(pares)} ejemplos")
    else:
        print("Pocos ejemplos para calibrar: se deja la temperatura del checkpoint base")
""")

code(r"""
# 7. Guardar el checkpoint (mismo formato que los de convaiinnovations) ──────
import shutil
ckpt = os.path.join(SALIDA, "checkpoint")
os.makedirs(ckpt, exist_ok=True)
model.eval().cpu()
save_file({k: v.half().contiguous() for k, v in model.state_dict().items()}, os.path.join(ckpt, "model.safetensors"))
model.encoder.config.save_pretrained(os.path.join(ckpt, "encoder"))
# ModernBERT activa torch.compile si alguna vez corrió en GPU; al cargarlo para
# exportar (en CPU) eso solo estorba
ruta_enc = os.path.join(ckpt, "encoder", "config.json")
cfg_enc = json.load(open(ruta_enc))
if cfg_enc.get("model_type") == "modernbert" or "reference_compile" in cfg_enc:
    cfg_enc["reference_compile"] = False
    json.dump(cfg_enc, open(ruta_enc, "w"), indent=2)
tok.save_pretrained(os.path.join(ckpt, "tokenizer"))
cfg_out = dict(cfg)
cfg_out["temperature"] = temperatura
if not SOLO_EXPORTAR:
    cfg_out["fine_tuned"] = True                     # el worker le quita el techo de confianza
    cfg_out["model_name"] = f"lucas-laya-{VARIANTE}"
    cfg_out.pop("temperature_by_options", None)      # la calibración nueva es por tipo
json.dump(cfg_out, open(os.path.join(ckpt, "rl_agent_config.json"), "w"), indent=2)

if not SOLO_EXPORTAR:
    ajustado = laya.Agent(ckpt, device=dispositivo)
    metricas["ajustado"] = evaluar(ajustado, test_rows)
    print("Zero-shot:", metricas["zero_shot"], "\nAjustado: ", metricas["ajustado"])
    del ajustado
""")

code(r"""
%%writefile exportar_onnx.py
# 8. Script que exporta a ONNX y a INT8 y comprueba que respondan como PyTorch.
#    Corre en un proceso aparte y solo con CPU: nada de lo que quedó en memoria
#    del entrenamiento (CUDA, autocast, torch.compile) se mete en la exportación.
#    Uso: python exportar_onnx.py <checkpoint> <salida> [muestras.json]
import json
import os
import shutil
import sys
import time

os.environ["CUDA_VISIBLE_DEVICES"] = ""  # antes de importar torch

import numpy as np
import torch

ckpt, out = sys.argv[1], sys.argv[2]
muestras = []
if len(sys.argv) > 3 and os.path.exists(sys.argv[3]):
    muestras = json.load(open(sys.argv[3], encoding="utf-8"))
os.makedirs(out, exist_ok=True)
fp32, int8 = os.path.join(out, "laya.onnx"), os.path.join(out, "laya.int8.onnx")

import laya

agente = laya.Agent(ckpt, compile=False, device="cpu")
modelo = agente.model.float().eval()
if getattr(modelo.encoder, "config", None) is not None:
    modelo.encoder.config.reference_compile = False  # ModernBERT: sin torch.compile al exportar
# Las capas de la cabeza (nn.TransformerEncoderLayer) tienen un atajo interno de
# PyTorch que no existe en ONNX; apagado, se exportan como operaciones normales.
if hasattr(torch.backends, "mha") and hasattr(torch.backends.mha, "set_fastpath_enabled"):
    torch.backends.mha.set_fastpath_enabled(False)

lote, largo, marcas = 2, 17, 3  # todo > 1 y distinto: así el grafo queda dinámico
entradas = (
    torch.randint(5, 100, (lote, largo), dtype=torch.long),
    torch.ones((lote, largo), dtype=torch.long),
    torch.tensor([[1, 5, 9]] * lote, dtype=torch.long),
    torch.ones((lote, marcas), dtype=torch.bool),
    torch.zeros(lote, dtype=torch.long),
)
ENTRADAS = ["input_ids", "attention_mask", "marker_pos", "marker_mask", "qtype"]
SALIDAS = ["logits", "act_logits"]


def exportador_clasico():
    torch.onnx.export(
        modelo, entradas, fp32, input_names=ENTRADAS, output_names=SALIDAS, opset_version=17,
        do_constant_folding=True, dynamo=False,
        dynamic_axes={
            "input_ids": {0: "batch", 1: "seq"}, "attention_mask": {0: "batch", 1: "seq"},
            "marker_pos": {0: "batch", 1: "k"}, "marker_mask": {0: "batch", 1: "k"},
            "qtype": {0: "batch"}, "logits": {0: "batch", 1: "k"}, "act_logits": {0: "batch"},
        },
    )


def exportador_torch_export():
    # La receta de laya/scripts/export_onnx.py
    B, S, K = torch.export.Dim("batch_size"), torch.export.Dim("seq_len"), torch.export.Dim("num_markers")
    torch.onnx.export(
        modelo, entradas, fp32, export_params=True, opset_version=18, do_constant_folding=True,
        input_names=ENTRADAS, output_names=SALIDAS,
        dynamic_shapes=({0: B, 1: S}, {0: B, 1: S}, {0: B, 1: K}, {0: B, 1: K}, {0: B}),
    )


fallas = []
for nombre, exportar in (("clásico (TorchScript)", exportador_clasico), ("torch.export", exportador_torch_export)):
    try:
        t0 = time.time()
        exportar()
        print(f"✓ ONNX exportado con el exportador {nombre} en {time.time() - t0:.0f} s")
        break
    except Exception as e:
        fallas.append(f"{nombre}: {type(e).__name__}: {str(e)[:400]}")
        print(f"✗ El exportador {nombre} falló; pruebo el siguiente")
else:
    sys.exit("No se pudo exportar a ONNX:\n" + "\n".join(fallas))

import onnx
from onnxruntime.quantization import QuantType, quantize_dynamic

m = onnx.load(fp32)
del m.graph.value_info[:]
quantize_dynamic(model_input=m, model_output=int8, op_types_to_quantize=["MatMul"],
                 weight_type=QuantType.QInt8, per_channel=True)
print(f"ONNX fp32 {os.path.getsize(fp32) / 1e6:.0f} MB · INT8 {os.path.getsize(int8) / 1e6:.0f} MB")

# Lo que ONNXAgent necesita junto al grafo
shutil.copy(os.path.join(ckpt, "rl_agent_config.json"), out)
for carpeta in ("tokenizer", "encoder"):
    shutil.copytree(os.path.join(ckpt, carpeta), os.path.join(out, carpeta), dirs_exist_ok=True)

# Comprobación: los mismos casos por PyTorch y por ONNX, con textos de distintos
# largos y preguntas de 3 y 8 opciones (si el grafo quedó con un tamaño fijo, aquí se nota)
from laya.onnx_agent import ONNXAgent

P8 = {"category": {"type": "choice", "instructions": "¿En qué categoría de gasto va esta compra hecha en Colombia?",
      "criteria": {"Transporte": "taxis, buses, lanchas, peajes, gasolina, vuelos", "Hospedaje": "hoteles, hostales",
                   "Licor": "estancos, cerveza, aguardiente", "Café": "cafeterías, panaderías",
                   "Restaurante": "almuerzos, cenas, comidas rápidas", "Mercado": "supermercados, tiendas de barrio",
                   "Servicios": "luz, agua, gas, internet, celular", "Otros": "todo lo demás"}}}
P3 = {"category": {"type": "choice", "instructions": "Which spending category does this expense belong to?",
      "criteria": {"groceries": "supermarkets and corner stores", "transport": "taxis and buses", "other": "anything else"}}}
ESTADOS = [
    {"comercio": "Tienda Don Beto", "items": ["Leche", "Huevos", "Arepas"]},
    {"comercio": "Taxi al aeropuerto"},
    {"merchant": "Hostal Brisas del Rodadero", "description": "Two nights at a beach hostel in Santa Marta"},
    {"comercio": "Panadería La Espiga",
     "texto": "PANADERIA LA ESPIGA NIT 900123456 2 Pandebono 5.000 1 Tinto grande 3.800 TOTAL 11.300 " * 12},
]
casos = [(json.loads(r["state"]), json.loads(r["questions"])) for r in muestras[:40]]
casos += [(e, p) for e in ESTADOS for p in (P8, P3)]


def comparar(ruta):
    onnx_agente = ONNXAgent(out, onnx_path=ruta)
    difs, cambios, seguros = [], 0, 0
    for estado, preguntas in casos:
        a = agente.predict(estado, preguntas)["answers"]["category"]
        b = onnx_agente.predict(estado, preguntas)["answers"]["category"]
        difs.append(max(abs(a["probabilities"][k] - b["probabilities"][k]) for k in a["probabilities"]))
        top = sorted(a["probabilities"].values(), reverse=True)
        if top[0] - top[1] > 0.1:  # solo cuenta cuando PyTorch no está dudando entre dos
            seguros += 1
            cambios += a["choice"] != b["choice"]
    return {"max_diff": round(max(difs), 4), "mediana_diff": round(float(np.median(difs)), 4),
            "cambios": cambios, "seguros": seguros, "n": len(casos)}


r32 = comparar(fp32)
print("ONNX fp32 vs PyTorch:", r32)
if r32["max_diff"] > 0.02:
    sys.exit("El ONNX fp32 no responde como PyTorch: la exportación salió mal (mira los mensajes de arriba)")
r8 = comparar(int8)
print("ONNX INT8 vs PyTorch:", r8)
elegido = "laya.int8.onnx"
if r8["mediana_diff"] > 0.05 or r8["cambios"] > max(1, r8["seguros"] // 10):
    elegido = "laya.onnx"
    print("La versión INT8 se aleja demasiado de PyTorch: se sube la fp32 (más pesada, igual de exacta)")
json.dump({"fp32": r32, "int8": r8, "elegido": elegido}, open(os.path.join(out, "onnx_check.json"), "w"), indent=2)
print("✓ Listo para subir:", elegido)
""")

code(r"""
# 9. Exportar (en un proceso aparte) y comprobar ─────────────────────────────
import gc
onnx_dir = os.path.join(SALIDA, "onnx")
muestras_path = os.path.join(SALIDA, "muestras.json")
json.dump(test_rows[:40], open(muestras_path, "w"), ensure_ascii=False)
# El proceso de exportación carga el modelo otra vez: se libera la memoria de este
for nombre in ("model", "opt", "scaler", "sched"):
    globals().pop(nombre, None)
gc.collect()
if torch.cuda.is_available():
    torch.cuda.empty_cache()

!python exportar_onnx.py "{ckpt}" "{onnx_dir}" "{muestras_path}"

ruta_chequeo = os.path.join(onnx_dir, "onnx_check.json")
assert os.path.exists(ruta_chequeo), "La exportación falló: el motivo está en el mensaje de arriba"
chequeo = json.load(open(ruta_chequeo))
archivo_onnx = os.path.join(onnx_dir, chequeo["elegido"])
metricas["onnx"] = chequeo
print("Se sube:", chequeo["elegido"])
""")

code(r"""
# 10. Subir a Hugging Face (repo privado) ─────────────────────────────────────
from huggingface_hub import HfApi
subir = os.path.join(SALIDA, "subir")
shutil.rmtree(subir, ignore_errors=True)
os.makedirs(subir)
shutil.copy(archivo_onnx, subir)
shutil.copy(os.path.join(onnx_dir, "rl_agent_config.json"), subir)
shutil.copytree(os.path.join(onnx_dir, "tokenizer"), os.path.join(subir, "tokenizer"))
if pregunta_lucas:
    # La pregunta con la que se entrenó: el worker la usa tal cual
    json.dump(pregunta_lucas, open(os.path.join(subir, "lucas_question.json"), "w"), ensure_ascii=False, indent=2)
json.dump({"base": BASE, "variante": VARIANTE, "solo_exportar": SOLO_EXPORTAR, **metricas},
          open(os.path.join(subir, "metrics.json"), "w"), ensure_ascii=False, indent=2)

api = HfApi(token=HF_TOKEN)
api.create_repo(HF_REPO, private=True, exist_ok=True)
api.upload_folder(folder_path=subir, path_in_repo=VARIANTE, repo_id=HF_REPO,
                  commit_message=f"Laya {VARIANTE}: {'zero-shot' if SOLO_EXPORTAR else metricas.get('ajustado')}")
print(f"Listo: https://huggingface.co/{HF_REPO}/tree/main/{VARIANTE}")
""")

md(r"""
## Usarlo en el worker

En el `.env` del servidor (Oracle):

```bash
LAYA_VARIANT=multilingual        # o english: la carpeta que acabas de subir
HF_REPO=tu-usuario/lucas-laya
HF_TOKEN=hf_…                    # uno de SOLO LECTURA en el servidor
```

y reinicia: `docker compose restart worker`. Al arrancar baja `<variante>/laya.int8.onnx`, `rl_agent_config.json`, `tokenizer/` y `lucas_question.json`; `docker compose exec worker python -m lucas_worker check` confirma cuál quedó cargado.

Para volver a ajustar más adelante, exporta solo lo nuevo (`export_training.py --marcar` marca lo que ya salió) o todo otra vez con `--todos --incluir-confirmados`, y vuelve a correr este notebook.
""")

nb = {
    "cells": cells,
    "metadata": {
        "accelerator": "GPU",
        "colab": {"gpuType": "T4", "provenance": []},
        "kernelspec": {"display_name": "Python 3", "language": "python", "name": "python3"},
        "language_info": {"name": "python"},
    },
    "nbformat": 4,
    "nbformat_minor": 5,
}
for i, c in enumerate(nb["cells"]):
    c["id"] = f"celda-{i:02d}"
out = Path(sys.argv[1])
out.write_text(json.dumps(nb, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")

# Validar: cada celda de código compila (sin las líneas «!pip»)
for c in nb["cells"]:
    if c["cell_type"] == "code":
        src = "".join(linea for linea in c["source"] if not linea.lstrip().startswith(("!", "%")))
        ast.parse(src)
print("ok", out, len(cells), "celdas")
