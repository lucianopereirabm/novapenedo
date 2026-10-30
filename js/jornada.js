// Cálculo da jornada do dia e do banco de horas (usado no app e na Gestão)
export const CARGA_PADRAO = { 0: 0, 1: 480, 2: 480, 3: 480, 4: 480, 5: 480, 6: 240 }; // minutos por dia da semana (dom=0)
export const ALMOCO_PADRAO = { min: 60, acimaDe: 360 }; // desconta 1h quando a jornada passa de 6h

export function regrasJornada(cfgApp) {
  const c = (cfgApp && cfgApp.jornada) || {};
  const carga = Object.assign({}, CARGA_PADRAO, c.carga || {});
  return { carga, almocoMin: c.almocoMin ?? ALMOCO_PADRAO.min, almocoAcima: c.almocoAcima ?? ALMOCO_PADRAO.acimaDe };
}

// Jornada = do primeiro check-in do dia até o check-out da última loja.
// vs = visitas do promotor no dia. Em andamento (hoje, ainda em loja ou com rota pendente) conta até agora.
export function calcJornada({ vs = [], date, regras, agora = Date.now(), hoje }) {
  const wd = new Date(date + 'T12:00:00').getDay();
  const esperado = (regras.carga[wd] || 0);
  const ins = vs.map(v => v.checkin).filter(Boolean);
  if (!ins.length) return { tem: false, esperado, wd };
  const inicio = Math.min(...ins);
  const outs = vs.map(v => v.checkout).filter(Boolean);
  const emLoja = vs.some(v => v.status === 'em_loja');
  let fim, andamento = false, fimEst = false;
  if (emLoja && date === hoje) { fim = agora; andamento = true; }
  else if (emLoja) { fim = Math.max(...ins.concat(outs)); fimEst = true; } // dia passado sem check-out: conta até a última entrada
  else fim = Math.max(...outs.concat(ins));
  const bruto = Math.max(0, Math.round((fim - inicio) / 60000));
  const almoco = bruto > regras.almocoAcima ? regras.almocoMin : 0;
  const trabalhado = Math.max(0, bruto - almoco);
  return { tem: true, inicio, fim, fimEst, andamento, emLoja, bruto, almoco, trabalhado, esperado, saldo: trabalhado - esperado, wd };
}

export const hmin = m => { if (m == null) return '—'; const s = m < 0 ? '-' : ''; m = Math.abs(Math.round(m)); return s + Math.floor(m / 60) + 'h' + String(m % 60).padStart(2, '0'); };
export const saldoTxt = m => (m > 0 ? '+' : '') + hmin(m);
