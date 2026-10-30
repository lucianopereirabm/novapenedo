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
  return { desc: Array.from(r.descriptor, x => Math.round(x * 1e5) / 1e5), box: r.detection.box, score: r.detection.score };
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
