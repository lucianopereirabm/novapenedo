// Reconhecimento de rosto (roda no próprio celular/computador; nada é enviado para fora)
// Modelos em /models, biblioteca face-api (MIT) em /lib.
let fa = null, pronto = null;
export const LIMITE = 0.5; // distância máxima para considerar a mesma pessoa (quanto menor, mais parecido)

export function carregaRosto() {
  if (!pronto) pronto = (async () => {
    fa = await import('../lib/face-api.esm.js');
    try { await fa.tf.setBackend('webgl'); } catch (e) { await fa.tf.setBackend('cpu'); }
    await fa.tf.ready();
    const base = new URL('../models', import.meta.url).href;
    await Promise.all([
      fa.nets.tinyFaceDetector.loadFromUri(base),
      fa.nets.faceLandmark68Net.loadFromUri(base),
      fa.nets.faceRecognitionNet.loadFromUri(base)
    ]);
    return fa;
  })().catch(e => { pronto = null; throw e; });
  return pronto;
}

// Retorna { desc: number[128], box } do maior rosto da imagem, ou null se não achar rosto
export async function leRosto(fonte, tamanho = 416) {
  await carregaRosto();
  const r = await fa.detectSingleFace(fonte, new fa.TinyFaceDetectorOptions({ inputSize: tamanho, scoreThreshold: 0.45 }))
    .withFaceLandmarks().withFaceDescriptor();
  if (!r) return null;
  return { desc: Array.from(r.descriptor, x => Math.round(x * 1e5) / 1e5), box: r.detection.box, score: r.detection.score, pts: r.landmarks.positions.map(p => ({ x: p.x, y: p.y })) };
}

// Para fotos do cadastro: se o rosto estiver muito perto (ocupando a foto toda), tenta de novo com margem em volta
export async function leRostoFoto(img) {
  const W = img.naturalWidth || img.width, H = img.naturalHeight || img.height;
  for (const m of [0, 0.35, 0.7]) {
    let fonte = img;
    if (m) { const c = document.createElement('canvas'); c.width = Math.round(W * (1 + 2 * m)); c.height = Math.round(H * (1 + 2 * m)); const g = c.getContext('2d'); g.fillStyle = '#e8e8e4'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, W * m, H * m, W, H); fonte = c; }
    for (const t of [608, 416]) { const r = await leRosto(fonte, t); if (r) return { r, fonte }; }
  }
  return null;
}

export function distRosto(a, b) {
  if (!a || !b || a.length !== b.length) return null;
  let s = 0; for (let i = 0; i < a.length; i++) { const d = a[i] - b[i]; s += d * d; }
  return Math.round(Math.sqrt(s) * 1000) / 1000;
}

// Recorta o rosto (com margem) num quadrado de 240 px, para a foto do cadastro
export function recorteRosto(fonte, box, lado = 240) {
  const W = fonte.naturalWidth || fonte.videoWidth || fonte.width, H = fonte.naturalHeight || fonte.videoHeight || fonte.height;
  const m = Math.max(box.width, box.height) * 1.6;
  let x = box.x + box.width / 2 - m / 2, y = box.y + box.height / 2 - m / 2;
  x = Math.max(0, Math.min(x, W - m)); y = Math.max(0, Math.min(y, H - m));
  const c = document.createElement('canvas'); c.width = c.height = lado;
  c.getContext('2d').drawImage(fonte, x, y, Math.min(m, W), Math.min(m, H), 0, 0, lado, lado);
  return c.toDataURL('image/jpeg', 0.8);
}

// ---------- prova de vida: o rosto precisa se mexer (foto parada não passa) ----------
// Só os pontos do rosto (mais rápido que o reconhecimento completo)
export async function marcosRosto(fonte, tamanho = 320) {
  await carregaRosto();
  const r = await fa.detectSingleFace(fonte, new fa.TinyFaceDetectorOptions({ inputSize: tamanho, scoreThreshold: 0.45 })).withFaceLandmarks();
  if (!r) return null;
  return { pts: r.landmarks.positions.map(p => ({ x: p.x, y: p.y })), box: r.detection.box };
}
// Giro do rosto para os lados: 0 = de frente; positivo/negativo = virado para um lado.
// Numa foto (plana) esse valor não muda quando ela é inclinada; num rosto de verdade muda bastante.
export function giroRosto(pts) {
  const media = idx => idx.reduce((a, i) => ({ x: a.x + pts[i].x / idx.length, y: a.y + pts[i].y / idx.length }), { x: 0, y: 0 });
  const oe = media([36, 37, 38, 39, 40, 41]), od = media([42, 43, 44, 45, 46, 47]);
  const meio = { x: (oe.x + od.x) / 2, y: (oe.y + od.y) / 2 };
  const dist = Math.hypot(od.x - oe.x, od.y - oe.y) || 1;
  return (pts[30].x - meio.x) / dist;
}
// Máquina de passos da prova de vida (sem câmera: recebe uma função que lê o quadro atual).
// Passos: de frente e reconhecido -> vira o rosto para um lado (sorteado). Foto parada não consegue virar.
export const VIDA = { frente: 0.14, lado: 0.26, tempo: 40000 };
// primeiro = +1 ou -1 (lado sorteado: +1 = esquerda de quem está na câmera, -1 = direita)
export async function provaDeVida({ lerMarcos, lerRosto, ref, aviso, primeiro = Math.random() < 0.5 ? 1 : -1, cancelado = () => false, espera = 200, agora = () => Date.now() }) {
  const ini = agora(); let passo = 0, acertos = 0, dist = null, ultimoGiro = null, moveu = 0;
  const nome = s => s > 0 ? 'ESQUERDA ←' : 'DIREITA →';
  const msgs = ['Olhe de frente para a câmera…', `Agora vire o rosto devagar para a sua ${nome(primeiro)}`];
  aviso && aviso(msgs[0], 0);
  while (!cancelado()) {
    if (agora() - ini > VIDA.tempo) return { ok: false, motivo: passo === 0 ? 'rosto' : 'movimento' };
    if (passo === 0) {
      const r = await lerRosto();
      const d = r ? distRosto(r.desc, ref) : null;
      const g = r && r.pts ? giroRosto(r.pts) : null;
      if (d != null && d > LIMITE) { acertos = 0; aviso && aviso('Rosto não confere com o cadastro.', 0, 'no'); }
      else if (d != null && g != null && Math.abs(g) < VIDA.frente) { acertos++; if (acertos >= 2) { dist = d; passo = 1; aviso && aviso(msgs[1], 1, 'ok'); } }
      else { acertos = 0; aviso && aviso(d == null ? 'Procurando o rosto… olhe para a câmera.' : msgs[0], 0); }
    } else {
      const m = await lerMarcos();
      if (!m) { aviso && aviso('Não perca o rosto de vista: vire devagar.', 1); }
      else {
        const g = giroRosto(m.pts);
        if (ultimoGiro != null) moveu += Math.abs(g - ultimoGiro); ultimoGiro = g;
        if (Math.abs(g) > VIDA.lado && Math.sign(g) === primeiro) return { ok: true, dist, moveu };
        if (Math.abs(g) > VIDA.lado) aviso && aviso(`Para o outro lado: sua ${nome(primeiro)}`, 1);
      }
    }
    await new Promise(r => setTimeout(r, espera));
  }
  return { ok: false, motivo: 'cancelado' };
}
