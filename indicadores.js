/* ============================================================
   INDICADORES — o que a frota fez, e o registro que alimenta
   ============================================================
   Registro: a aba que despacha (a líder) grava quando o estado de um
   AGV muda e os eventos que os AGVs publicam (registrar_frota, em
   lotes a cada 10 s). Sem nuvem, guarda neste navegador.

   Tela Indicadores (abas): Resumo, Entregas, Frota, Paradas (mapa de
   calor), Tráfego, Ganhos e Manutenção, para hoje, 7 ou 30 dias.
   "Relatório do piloto" abre a versão para imprimir ou salvar em PDF.
   Na demonstração os números são de exemplo, gerados a partir da planta
   e das missões de exemplo, e a tela diz isso em destaque.
*/
const Registro = (function () {
    "use strict";

    // Eventos que não valem guardar (dezenas por missão, nada a medir)
    const IGNORAR = /^(CHECKPOINT|TRECHO_CONCLUIDO|ETAPA_INICIADA|ETAPA_CONCLUIDA|MANOBRA_INICIADA|GIRO_CHEGADA|TROCA_LATERAL|RFID_ESPERADO|TESTE_LEDS|CONFIRMACAO_RECEBIDA|FILA_ADICIONADA|MISSAO_CARREGADA)$/;
    const ultimo = {};            // agvId -> estado gravado
    let lote = { estados: [], eventos: [] };
    let eraLider = false, ultimoEnvio = 0, enviando = false;
    const naNuvem = () => Boolean(window.Nuvem && Nuvem.emNuvem());
    const souLider = () => typeof Despacho !== "undefined" && Despacho.lider().eu;
    // AGV que nunca conectou (cadastrado e ainda sem firmware) não entra no registro
    const registravel = agv => agv && !(naNuvem() && agv.virtual) && Boolean(agv.ultimoHeartbeat || agv.online);

    // missao | pronto | atencao | falha | emergencia | offline | desligado | manutencao | fora_turno
    function estadoDe(agv) {
        if (typeof Manutencao !== "undefined" && Manutencao.ativa(agv)) return "manutencao";
        const chave = typeof categoriaEstadoAGV === "function" ? categoriaEstadoAGV(agv).chave : "offline";
        const st = agv.rotinaStatus;
        const foraTurno = st && (st.fimDeTurno || (st.estado && /^ENCERRADO|SEM_BERCO/.test(st.estado)));
        if (foraTurno && ["pronto", "desligado", "offline"].includes(chave)) return "fora_turno";
        return chave === "manutencao" ? "manutencao" : chave;
    }

    function tique() {
        const lider = souLider();
        if (!lider) { eraLider = false; return; }
        const agora = new Date().toISOString();
        Object.values(typeof agvs === "object" ? agvs : {}).filter(registravel).forEach(agv => {
            const e = estadoDe(agv);
            const ponto = agv.posicaoConhecida ? String(agv.pontoAtual || "") : "";
            if (!eraLider || ultimo[agv.id] !== e) {
                ultimo[agv.id] = e;
                lote.estados.push({ agv: agv.id, em: agora, estado: e, ponto, missao: String(agv.missaoAtual || "") });
            }
        });
        eraLider = true;
        if (lote.estados.length + lote.eventos.length >= 60 || Date.now() - ultimoEnvio > 10000) enviar();
    }

    function evento(agvId, dados, categoria) {
        if (!souLider()) return;
        const agv = typeof agvs === "object" ? agvs[agvId] : null;
        if (!registravel(agv)) return;
        const nome = dados && typeof dados === "object" ? String(dados.evento || dados.tipo || "") : String(dados || "").slice(0, 40);
        if (!nome || IGNORAR.test(nome)) return;
        lote.eventos.push({
            agv: agvId, em: new Date().toISOString(), categoria: String(categoria || ""), evento: nome,
            mensagem: dados && typeof dados === "object" ? String(dados.mensagem || "").slice(0, 200) : "",
            ponto: agv.posicaoConhecida ? String(agv.pontoAtual || "") : ""
        });
        if (lote.eventos.length > 300) lote.eventos.splice(0, lote.eventos.length - 300);
    }

    async function enviar() {
        if (enviando || (!lote.estados.length && !lote.eventos.length)) { ultimoEnvio = Date.now(); return; }
        enviando = true;
        const agora = lote;
        lote = { estados: [], eventos: [] };
        try {
            if (naNuvem()) {
                const { error } = await Nuvem.cliente().rpc("registrar_frota", { p_empresa: Nuvem.empresa().id, p_sessao: Despacho.sessao, p_lote: agora });
                if (error) throw error;
            } else {
                gravarLocal(agora);
            }
        } catch (erro) {
            // devolve para tentar de novo (sem passar do limite)
            lote.estados = agora.estados.concat(lote.estados).slice(-300);
            lote.eventos = agora.eventos.concat(lote.eventos).slice(-300);
            console.warn("Registro da frota:", erro?.message || erro);
        } finally {
            enviando = false;
            ultimoEnvio = Date.now();
        }
    }

    function lerLocal() {
        try { const d = JSON.parse(localStorage.getItem("historicoFrota") || "{}"); return { estados: d.estados || [], eventos: d.eventos || [] }; }
        catch (e) { return { estados: [], eventos: [] }; }
    }
    function gravarLocal(novo) {
        const d = lerLocal();
        const limite = Date.now() - 30 * 86400000;
        d.estados = d.estados.concat(novo.estados).filter(x => Date.parse(x.em) > limite).slice(-6000);
        d.eventos = d.eventos.concat(novo.eventos).filter(x => Date.parse(x.em) > limite).slice(-4000);
        try { localStorage.setItem("historicoFrota", JSON.stringify(d)); } catch (e) { /* sem espaço */ }
    }

    setInterval(tique, 3000);
    addEventListener("pagehide", () => { if (!naNuvem() && (lote.estados.length || lote.eventos.length)) gravarLocal(lote); });

    return { evento, estadoDe, enviar, lerLocal, tique };
})();


const Indicadores = (function () {
    "use strict";

    const ABAS = [["resumo", "Resumo"], ["entregas", "Entregas"], ["frota", "Frota"], ["paradas", "Paradas"],
                  ["trafego", "Tráfego"], ["ganhos", "Ganhos"], ["manutencao", "Manutenção"]];
    const PERIODOS = [["hoje", "Hoje"], ["7", "7 dias"], ["30", "30 dias"]];
    const ESTADOS = {
        missao: ["Em missão", "var(--accent)"], pronto: ["Pronto, sem missão", "var(--green)"], atencao: ["Atenção (obstáculo, confirmação)", "var(--amber)"],
        falha: ["Falha", "var(--red)"], emergencia: ["Emergência", "#8f1d1d"], offline: ["Sem sinal", "var(--muted)"],
        desligado: ["Desligado", "var(--border)"], manutencao: ["Manutenção (planejada)", "var(--purple)"], fora_turno: ["Fora do turno", "var(--soft)"]
    };
    const PARADAS = /^(EMERGENCIA_ACIONADA|STOP_ACIONADO|BARREIRA_INVADIDA|MISSAO_INTERROMPIDA|MISSAO_ERRO|TAG_NAO_LIDA|FALHA_HARDWARE|FALHA_SENSORES_BARREIRA|FALHA_COMUNICACAO_PAINEL|PONTO_BLOQUEADO|ROTA_INVALIDA|POSICAO_PERDIDA)$/;
    const NOMES_PARADA = {
        EMERGENCIA_ACIONADA: "Emergência", STOP_ACIONADO: "STOP", BARREIRA_INVADIDA: "Obstáculo à frente", MISSAO_INTERROMPIDA: "Missão interrompida",
        MISSAO_ERRO: "Erro na missão", TAG_NAO_LIDA: "Tag RFID não lida", FALHA_HARDWARE: "Falha de hardware", FALHA_SENSORES_BARREIRA: "Falha nos sensores de distância",
        FALHA_COMUNICACAO_PAINEL: "Falha no painel", PONTO_BLOQUEADO: "Ponto bloqueado", ROTA_INVALIDA: "Rota inválida", POSICAO_PERDIDA: "Posição perdida"
    };

    let aba = "resumo", periodo = "7";
    let dados = null, carregando = false, mapaCalor = null, versao = 0;
    const esc = t => (typeof escaparHtml === "function" ? escaparHtml(t) : String(t ?? ""));
    const naNuvem = () => Boolean(window.Nuvem && Nuvem.emNuvem());
    const demo = () => Boolean(window.Nuvem && Nuvem.modo() === "demo");
    const ms = v => (v == null ? null : typeof v === "number" ? v : Date.parse(v));
    const H = 3600000;

    function ganhosConfig() {
        try { return Object.assign({ minutosPorEntrega: 6, custoHora: 35 }, JSON.parse(localStorage.getItem("indicadoresGanhos") || "{}")); }
        catch (e) { return { minutosPorEntrega: 6, custoHora: 35 }; }
    }

    function intervalo() {
        const ate = Date.now();
        if (periodo === "hoje") { const d = new Date(); d.setHours(0, 0, 0, 0); return { desde: d.getTime(), ate }; }
        return { desde: ate - Number(periodo) * 86400000, ate };
    }

    /* ---------------- dados ---------------- */

    async function buscar() {
        const { desde, ate } = intervalo();
        if (demo()) return Object.assign(exemplo(desde, ate), { desde, ate, exemplo: true });
        let estados = [], eventos = [], pedidos = [], pausas = [];
        if (naNuvem()) {
            const c = Nuvem.cliente(), emp = Nuvem.empresa().id;
            const antes = new Date(desde - 2 * 86400000).toISOString();
            const [e, v, p] = await Promise.all([
                c.from("estados_frota").select("agv, em, estado, ponto, missao").eq("empresa_id", emp).gte("em", antes).order("em").limit(20000),
                c.from("eventos_frota").select("agv, em, categoria, evento, mensagem, ponto").eq("empresa_id", emp).gte("em", new Date(desde).toISOString()).order("em").limit(10000),
                c.from("pedidos").select("id, missao, posto, agv, estado, prioridade, urgente, criado_em, atribuido_em, iniciado_em, concluido_em, origem, acaba_em, adiantado").eq("empresa_id", emp)
                    .gte("criado_em", new Date(desde).toISOString()).order("criado_em").limit(10000)
            ]);
            if (e.error && !/does not exist|relation/i.test(e.error.message)) throw e.error;
            estados = e.data || []; eventos = v.data || [];
            const pz = await c.from("programacao_eventos").select("posto, missao, em, tipo, motivo, por_nome, pessoa").eq("empresa_id", emp)
                .in("tipo", ["pausada", "retomada"]).gte("em", new Date(desde - 86400000).toISOString()).order("em").limit(5000);
            pausas = (pz.data || []).map(x => Object.assign({}, x, { em: ms(x.em) }));
            pedidos = (p.data || []).map(x => ({ id: x.id, missao: x.missao, posto: x.posto, agv: x.agv, estado: x.estado, urgente: x.urgente,
                criadoEm: ms(x.criado_em), atribuidoEm: ms(x.atribuido_em), iniciadoEm: ms(x.iniciado_em), concluidoEm: ms(x.concluido_em),
                origem: x.origem || "manual", acabaEm: ms(x.acaba_em), adiantado: Boolean(x.adiantado) }));
        } else {
            const d = Registro.lerLocal();
            estados = d.estados; eventos = d.eventos.filter(x => ms(x.em) >= desde);
            pedidos = (typeof Despacho !== "undefined" ? Despacho.lista() : []).filter(x => ms(x.criadoEm) >= desde);
            pausas = (typeof Programacao !== "undefined" ? Programacao.eventos() : []).filter(x => ["pausada", "retomada"].includes(x.tipo)).map(x => Object.assign({}, x, { em: ms(x.em) })).sort((a, b) => a.em - b.em);
        }
        const manut = typeof Manutencao !== "undefined" ? Manutencao.historico().concat(Manutencao.lista()) : [];
        return { desde, ate, estados: estados.map(x => Object.assign({}, x, { em: ms(x.em) })), eventos: eventos.map(x => Object.assign({}, x, { em: ms(x.em) })),
                 pedidos, pausas, manutencoes: manut.filter(m => (m.fim || ate) >= desde), exemplo: false };
    }

    // Intervalos de cada AGV no período: [{agv, estado, ini, fim, ponto}]
    function intervalos(d) {
        const porAgv = {};
        d.estados.forEach(s => (porAgv[s.agv] = porAgv[s.agv] || []).push(s));
        const saida = [];
        Object.entries(porAgv).forEach(([agv, l]) => {
            l.sort((a, b) => a.em - b.em);
            for (let i = 0; i < l.length; i++) {
                const ini = Math.max(d.desde, l[i].em), fim = Math.min(d.ate, i + 1 < l.length ? l[i + 1].em : d.ate);
                if (fim > ini) saida.push({ agv, estado: l[i].estado, ini, fim, ponto: l[i].ponto || "" });
            }
        });
        return saida;
    }

    function calcular(d) {
        const iv = intervalos(d);
        const agvsIds = [...new Set(iv.map(x => x.agv).concat(d.pedidos.map(p => p.agv).filter(Boolean)))].sort((a, b) => String(a).localeCompare(String(b), "pt-BR", { numeric: true }));
        const tempo = {};
        agvsIds.forEach(a => { tempo[a] = Object.fromEntries(Object.keys(ESTADOS).map(k => [k, 0])); });
        iv.forEach(x => { if (tempo[x.agv]) tempo[x.agv][x.estado] = (tempo[x.agv][x.estado] || 0) + (x.fim - x.ini); });
        const soma = k => agvsIds.reduce((s, a) => s + (tempo[a][k] || 0), 0);
        const util = t => {
            const base = Object.values(t).reduce((s, v) => s + v, 0) - t.fora_turno - t.manutencao - t.desligado;
            return base > 0 ? t.missao / base : null;
        };
        const disp = t => {
            const base = Object.values(t).reduce((s, v) => s + v, 0) - t.fora_turno - t.manutencao - t.desligado;
            return base > 0 ? (base - t.falha - t.emergencia - t.offline) / base : null;
        };
        const total = Object.fromEntries(Object.keys(ESTADOS).map(k => [k, soma(k)]));

        const conc = d.pedidos.filter(p => p.estado === "concluido" && p.concluidoEm);
        const atendimento = conc.map(p => (p.concluidoEm - p.criadoEm) / 1000).filter(v => v >= 0);
        const espera = d.pedidos.filter(p => p.atribuidoEm).map(p => (p.atribuidoEm - p.criadoEm) / 1000).filter(v => v >= 0);
        const media = l => (l.length ? l.reduce((s, v) => s + v, 0) / l.length : null);
        const p90 = l => { if (!l.length) return null; const o = l.slice().sort((a, b) => a - b); return o[Math.min(o.length - 1, Math.floor(o.length * 0.9))]; };

        const paradas = d.eventos.filter(e => PARADAS.test(e.evento));
        const porPonto = {};
        iv.filter(x => ["atencao", "falha", "emergencia"].includes(x.estado) && x.ponto).forEach(x => {
            const p = porPonto[x.ponto] || (porPonto[x.ponto] = { ponto: x.ponto, tempo: 0, vezes: 0, causas: {} });
            p.tempo += x.fim - x.ini; p.vezes++;
        });
        paradas.filter(e => e.ponto).forEach(e => {
            const p = porPonto[e.ponto] || (porPonto[e.ponto] = { ponto: e.ponto, tempo: 0, vezes: 0, causas: {} });
            p.causas[e.evento] = (p.causas[e.evento] || 0) + 1;
        });
        const causas = {};
        paradas.forEach(e => { causas[e.evento] = (causas[e.evento] || 0) + 1; });

        // tráfego: AGUARDANDO até LIBERADO do mesmo AGV
        const esperas = [];
        const abertas = {};
        d.eventos.filter(e => /^TRAFEGO_(AGUARDANDO|LIBERADO)$/.test(e.evento)).forEach(e => {
            if (e.evento === "TRAFEGO_AGUARDANDO") { if (!abertas[e.agv]) abertas[e.agv] = e; }
            else if (abertas[e.agv]) {
                const a = abertas[e.agv];
                const zona = (String(a.mensagem).match(/zona[s]?\s+([A-Za-z0-9_, -]+)/i) || [])[1] || a.ponto || "?";
                esperas.push({ agv: e.agv, ini: a.em, s: (e.em - a.em) / 1000, zona: zona.trim(), ponto: a.ponto });
                delete abertas[e.agv];
            }
        });
        const porZona = {};
        esperas.forEach(x => { const z = porZona[x.zona] || (porZona[x.zona] = { zona: x.zona, vezes: 0, s: 0 }); z.vezes++; z.s += x.s; });

        const g = ganhosConfig();
        const manut = d.manutencoes.map(m => ({ ...m, dur: Math.max(0, Math.min(d.ate, m.fim || d.ate) - Math.max(d.desde, m.inicio)) }));
        const falhasN = d.eventos.filter(e => /^(MISSAO_ERRO|FALHA_HARDWARE|FALHA_SENSORES_BARREIRA|FALHA_COMUNICACAO_PAINEL|EMERGENCIA_ACIONADA)$/.test(e.evento)).length;
        const tempoOperando = total.missao + total.pronto + total.atencao;
        const reparos = iv.filter(x => x.estado === "falha" || x.estado === "emergencia");

        return {
            d, iv, agvsIds, tempo, total, util, disp,
            frota: { util: util(total), disp: disp(total) },
            entregas: {
                pedidos: d.pedidos.length, concluidos: conc.length, falharam: d.pedidos.filter(p => p.estado === "falhou").length,
                cancelados: d.pedidos.filter(p => p.estado === "cancelado").length, abertos: d.pedidos.filter(p => ["pendente", "atribuido", "em_execucao"].includes(p.estado)).length,
                atendimentoMedio: media(atendimento), atendimentoP90: p90(atendimento), esperaMedia: media(espera),
                porHora: Array.from({ length: 24 }, (_, h) => conc.filter(p => new Date(p.concluidoEm).getHours() === h).length),
                // 0.21: quando os pedidos nascem (a demanda), por hora do dia, média por dia do período
                pedidosPorHora: (() => {
                    const dias = Math.max(1, new Set(d.pedidos.map(p => new Date(p.criadoEm).toDateString())).size);
                    return Array.from({ length: 24 }, (_, h) => d.pedidos.filter(p => p.criadoEm && new Date(p.criadoEm).getHours() === h).length / dias);
                })(),
                porDia: porDia(conc, d), porMissao: agrupar(conc, p => p.missao), porPosto: agrupar(conc.filter(p => p.posto), p => p.posto),
                porAgv: agrupar(conc.filter(p => p.agv), p => p.agv), urgentes: d.pedidos.filter(p => p.urgente).length,
                // 0.15: programação
                programados: d.pedidos.filter(p => p.origem === "programado").length, adiantados: d.pedidos.filter(p => p.adiantado).length,
                comPrazo: conc.filter(p => p.origem === "programado" && p.acabaEm).length,
                faltou: conc.filter(p => p.origem === "programado" && p.acabaEm && p.concluidoEm > p.acabaEm),
                pausas: pausasDaProgramacao(d)
            },
            paradas: { n: paradas.length, causas, porPonto: Object.values(porPonto).sort((a, b) => b.tempo - a.tempo || (Object.values(b.causas).reduce((s, v) => s + v, 0) - Object.values(a.causas).reduce((s, v) => s + v, 0))), tempo: total.atencao + total.falha + total.emergencia },
            trafego: { esperas, porZona: Object.values(porZona).sort((a, b) => b.s - a.s), total: esperas.reduce((s, x) => s + x.s, 0) },
            ganhos: { config: g, horas: conc.length * g.minutosPorEntrega / 60, reais: conc.length * g.minutosPorEntrega / 60 * g.custoHora },
            manutencao: {
                lista: manut, n: manut.length, tempo: manut.reduce((s, m) => s + m.dur, 0), falhas: falhasN,
                mtbf: falhasN ? tempoOperando / falhasN : null, mttr: reparos.length ? reparos.reduce((s, x) => s + (x.fim - x.ini), 0) / reparos.length : null
            }
        };
    }

    function agrupar(lista, chave) {
        const m = {};
        lista.forEach(p => { const k = chave(p) || "—"; const x = m[k] || (m[k] = { chave: k, n: 0, s: 0 }); x.n++; x.s += Math.max(0, (p.concluidoEm - p.criadoEm) / 1000); });
        return Object.values(m).sort((a, b) => b.n - a.n);
    }
    function porDia(conc, d) {
        const dias = [];
        const ini = new Date(d.desde); ini.setHours(0, 0, 0, 0);
        for (let t = ini.getTime(); t <= d.ate; t += 86400000) {
            const fim = t + 86400000;
            dias.push({ dia: t, n: conc.filter(p => p.concluidoEm >= t && p.concluidoEm < fim).length });
        }
        return dias;
    }

    /* ---------------- dados de exemplo (só na demonstração) ---------------- */

    function exemplo(desde, ate) {
        let semente = 20261107;
        const rnd = () => { semente = (semente * 1103515245 + 12345) % 2147483648; return semente / 2147483648; };
        const planta = typeof plantaPublicada === "function" ? plantaPublicada() : { nos: [] };
        const pontos = planta.nos.filter(n => n.tipo !== "BERCO").map(n => n.id);
        const ids = Object.keys(typeof agvs === "object" ? agvs : {}).length ? Object.keys(agvs).slice(0, 4) : ["01", "02", "03"];
        const lm = (Array.isArray(typeof missoes !== "undefined" ? missoes : null) ? missoes : []).map(m => m.id);
        const ms_ = lm.length ? lm : ["M010", "M011"];
        const postos = typeof Despacho !== "undefined" ? Despacho.postos().map(p => p.id) : [];
        const estados = [], eventos = [], pedidos = [];
        let pid = 1;
        const ini = new Date(desde); ini.setHours(0, 0, 0, 0);
        for (let dia = ini.getTime(); dia < ate; dia += 86400000) {
            const sem = new Date(dia).getDay();
            ids.forEach((agv, i) => {
                const turnoIni = dia + 7 * H, turnoFim = dia + 17 * H;
                estados.push({ agv, em: dia, estado: "fora_turno", ponto: "" });
                if (sem === 0 || sem === 6) return;
                if (i === ids.length - 1 && Math.floor((dia - ini) / 86400000) % 9 === 3) {
                    estados.push({ agv, em: turnoIni, estado: "manutencao", ponto: "" });
                    estados.push({ agv, em: turnoIni + 3 * H, estado: "pronto", ponto: pontos[0] || "" });
                }
                let t = Math.max(turnoIni + (i === ids.length - 1 ? 3 * H : 0), dia);
                while (t < Math.min(turnoFim, ate)) {
                    const missao = ms_[Math.floor(rnd() * ms_.length)];
                    const espera = (2 + rnd() * 18) * 60000;
                    const dur = (3 + rnd() * 6) * 60000;
                    const ponto = pontos[Math.floor(rnd() * pontos.length)] || "";
                    estados.push({ agv, em: t, estado: "pronto", ponto });
                    const criado = t + espera * 0.7;
                    t += espera;
                    if (t >= Math.min(turnoFim, ate)) break;
                    estados.push({ agv, em: t, estado: "missao", ponto, missao });
                    const p = { id: pid++, missao, posto: postos.length ? postos[Math.floor(rnd() * postos.length)] : null, agv, estado: "concluido", urgente: rnd() < 0.05,
                                criadoEm: criado, atribuidoEm: criado + 5000 + rnd() * 40000, iniciadoEm: t, concluidoEm: t + dur };
                    // 0.15: parte dos pedidos sai da programação (consumo); alguns chegam depois de o material acabar
                    if (p.posto && rnd() < 0.6) { p.origem = "programado"; p.acabaEm = t + dur + (rnd() < 0.08 ? -1 : 1) * (0.5 + rnd() * 3) * 60000; }
                    else { p.origem = "manual"; p.adiantado = Boolean(p.posto) && rnd() < 0.15; }
                    if (rnd() < 0.18) {
                        const meio = t + dur * (0.3 + rnd() * 0.4);
                        const pp = pontos[Math.floor(rnd() * Math.min(pontos.length, 4))] || ponto;
                        const grave = rnd() < 0.15;
                        estados.push({ agv, em: meio, estado: grave ? "falha" : "atencao", ponto: pp });
                        estados.push({ agv, em: meio + (grave ? 4 : 0.6) * 60000, estado: "missao", ponto: pp, missao });
                        eventos.push({ agv, em: meio, categoria: grave ? "missao" : "seguranca", evento: grave ? "TAG_NAO_LIDA" : "BARREIRA_INVADIDA", mensagem: "", ponto: pp });
                    }
                    if (rnd() < 0.05) {
                        // Wi-Fi caiu um pouco no meio da missão
                        const q = t + dur * 0.5;
                        estados.push({ agv, em: q, estado: "offline", ponto });
                        estados.push({ agv, em: q + (1 + rnd() * 3) * 60000, estado: "missao", ponto, missao });
                    }
                    if (rnd() < 0.25) {
                        const z = ["Z1", "Z2", "Z3"][Math.floor(rnd() * 3)];
                        const a = t + dur * 0.2;
                        eventos.push({ agv, em: a, categoria: "missao", evento: "TRAFEGO_AGUARDANDO", mensagem: `Aguardando zona ${z}`, ponto });
                        eventos.push({ agv, em: a + (5 + rnd() * 40) * 1000, categoria: "missao", evento: "TRAFEGO_LIBERADO", mensagem: "", ponto });
                    }
                    t += dur;
                    if (p.concluidoEm <= ate) pedidos.push(p);
                }
                estados.push({ agv, em: Math.min(turnoFim, ate), estado: "fora_turno", ponto: "" });
            });
        }
        const manutencoes = [];
        ids.slice(-1).forEach(agv => {
            for (let dia = ini.getTime(); dia < ate; dia += 86400000) {
                if (Math.floor((dia - ini) / 86400000) % 9 === 3 && ![0, 6].includes(new Date(dia).getDay())) {
                    manutencoes.push({ agv, motivo: "Revisão das rodas (exemplo)", inicio: dia + 7 * H, fim: dia + 10 * H, foraDaLinha: true });
                }
            }
        });
        // pausas de exemplo da programação: troca de ferramenta de manhã, linha parada à tarde
        const pausas = [];
        for (let dia = ini.getTime(); dia < ate; dia += 86400000) {
            const sem = new Date(dia).getDay();
            if (sem === 0 || sem === 6 || !postos.length) continue;
            const p1 = postos[0], p2 = postos[1] || postos[0];
            [[p1, 9.5 * 3600000, 18, "troca de ferramenta"], [p2, 14 * 3600000, 35, "linha parada"]].forEach(([posto, h, min, motivo]) => {
                if (dia + h + min * 60000 > ate) return;
                pausas.push({ posto, missao: "", em: dia + h, tipo: "pausada", motivo, por_nome: "Exemplo" });
                pausas.push({ posto, missao: "", em: dia + h + min * 60000, tipo: "retomada", motivo: "", por_nome: "Exemplo" });
            });
        }
        return { estados: estados.filter(s => s.em <= ate), eventos: eventos.filter(e => e.em <= ate), pedidos, manutencoes, pausas };
    }

    /* ---------------- desenho ---------------- */

    const pct = v => (v == null ? "--" : `${Math.round(v * 100)}%`);
    function dur(msv) {
        if (msv == null) return "--";
        const s = msv / 1000;
        if (s < 90) return `${Math.round(s)} s`;
        if (s < 5400) return `${Math.round(s / 60)} min`;
        return `${ui.numero(s / 3600, s < 36000 ? 1 : 0)} h`;
    }
    const durS = s => (s == null ? "--" : dur(s * 1000));
    const reais = v => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

    function tile(rotulo, valor, sub) {
        return `<div class="tile ind-tile"><div class="tile-rotulo">${esc(rotulo)}</div><div class="tile-valor">${valor}</div>${sub ? `<div class="ind-sub">${sub}</div>` : ""}</div>`;
    }

    // Barras verticais simples (uma cor): [{rotulo, valor, dica}]
    function barras(itens, { altura = 140, formato = v => String(v), passo = 1 } = {}) {
        const max = Math.max(1, ...itens.map(i => i.valor));
        const maior = itens.reduce((m, it) => (it.valor > (m?.valor ?? -1) ? it : m), null);
        return `<div class="ind-barras" style="--altura:${altura}px" role="img" aria-label="gráfico de barras">${itens.map((it, i) => `
            <div class="ind-coluna" title="${esc(it.dica || `${it.rotulo}: ${formato(it.valor)}`)}">
                <div class="ind-trilho">${it === maior && it.valor ? `<span class="ind-valor">${esc(formato(it.valor))}</span>` : ""}<i style="height:${it.valor / max * 100}%"></i></div>
                <span class="ind-eixo">${i % passo === 0 ? esc(it.rotulo) : ""}</span>
            </div>`).join("")}</div>`;
    }

    // Barra empilhada de estados de um AGV (com legenda à parte)
    function barraEstados(t) {
        const tot = Object.values(t).reduce((s, v) => s + v, 0) || 1;
        return `<div class="ind-estados">${Object.keys(ESTADOS).filter(k => t[k] > 0).map(k =>
            `<span style="width:${t[k] / tot * 100}%;background:${ESTADOS[k][1]}" title="${esc(ESTADOS[k][0])}: ${dur(t[k])} (${Math.round(t[k] / tot * 100)}%)"></span>`).join("")}</div>`;
    }
    const legendaEstados = () => `<div class="ind-legenda">${Object.entries(ESTADOS).map(([k, [n, c]]) => `<span><i style="background:${c}"></i>${esc(n)}</span>`).join("")}</div>`;

    function tabela(cab, linhas, vazio = "Nada no período.") {
        if (!linhas.length) return `<div class="empty-state" style="padding:16px">${esc(vazio)}</div>`;
        return `<div class="tabela-rolagem"><table class="tabela-usuarios ind-tabela"><thead><tr>${cab.map(c => `<th>${esc(c)}</th>`).join("")}</tr></thead><tbody>${linhas.map(l => `<tr>${l.map(c => `<td>${c}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
    }

    function htmlResumo(r) {
        const e = r.entregas;
        const dias = e.porDia;
        return `
            <div class="ind-tiles">
                ${tile("Entregas concluídas", ui.milhar(e.concluidos), `${e.pedidos} pedidos · ${e.falharam} falharam · ${e.cancelados} cancelados`)}
                ${tile("Tempo médio de atendimento", durS(e.atendimentoMedio), `do pedido à entrega · 90% em até ${durS(e.atendimentoP90)}`)}
                ${tile("Disponibilidade da frota", pct(r.frota.disp), "no turno, sem falha, emergência ou falta de sinal")}
                ${tile("Utilização", pct(r.frota.util), "tempo em missão no turno")}
                ${tile("Paradas não planejadas", ui.milhar(r.paradas.n), `${dur(r.paradas.tempo)} parado ou em atenção`)}
                ${tile("Horas de pessoas liberadas", ui.numero(r.ganhos.horas, r.ganhos.horas < 10 ? 1 : 0) + " h", `estimativa · ${reais(r.ganhos.reais)}`)}
            </div>
            <section class="card ind-card"><h3>Entregas por ${periodo === "hoje" ? "hora" : "dia"}</h3>
                ${periodo === "hoje"
                    ? barras(e.porHora.map((n, h) => ({ rotulo: String(h), valor: n, dica: `${h}h: ${n} entrega(s)` })), { passo: 2 })
                    : barras(dias.map(x => ({ rotulo: new Date(x.dia).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }), valor: x.n })), { passo: Math.ceil(dias.length / 10) })}
            </section>
            <section class="card ind-card"><h3>Tempo de cada AGV</h3>${legendaEstados()}
                ${r.agvsIds.map(a => `<div class="ind-agv-linha"><b>${esc(a)}</b>${barraEstados(r.tempo[a])}<span class="suave">${pct(r.util(r.tempo[a]))} em missão</span></div>`).join("") || `<div class="empty-state">Sem registro no período.</div>`}
            </section>`;
    }

    // Pausas da programação no período: por posto e motivo, com o tempo pausado
    function pausasDaProgramacao(d) {
        const abertas = {}, soma = {};
        (d.pausas || []).forEach(ev => {
            const k = ev.posto + "|" + ev.missao;
            if (ev.tipo === "pausada") abertas[k] = ev;
            else if (abertas[k]) { somar(abertas[k], ev.em); delete abertas[k]; }
        });
        Object.values(abertas).forEach(ev => somar(ev, d.ate));
        function somar(ev, fim) {
            const ini = Math.max(ev.em, d.desde), f = Math.min(fim, d.ate);
            if (f <= ini) return;
            const k = ev.posto + "|" + (ev.motivo || "sem motivo");
            const x = soma[k] || (soma[k] = { posto: ev.posto, motivo: ev.motivo || "sem motivo", n: 0, s: 0 });
            x.n++; x.s += (f - ini) / 1000;
        }
        return Object.values(soma).sort((a, b) => b.s - a.s);
    }

    function htmlEntregas(r) {
        const e = r.entregas;
        return `
            <div class="ind-tiles">
                ${tile("Pedidos", ui.milhar(e.pedidos), `${e.abertos} ainda abertos · ${e.urgentes} urgentes`)}
                ${tile("Concluídos", ui.milhar(e.concluidos), e.pedidos ? pct(e.concluidos / e.pedidos) + " dos pedidos" : "")}
                ${tile("Espera até sair um AGV", durS(e.esperaMedia), "média, do pedido ao despacho")}
                ${tile("Atendimento", durS(e.atendimentoMedio), `90% em até ${durS(e.atendimentoP90)}`)}
            </div>
            ${e.programados || e.adiantados ? `<div class="ind-tiles">
                ${tile("Programados", ui.milhar(e.programados), e.pedidos ? `${pct(e.programados / e.pedidos)} dos pedidos saíram sozinhos` : "")}
                ${tile("Pedidos à mão", ui.milhar(e.pedidos - e.programados), `${e.adiantados} adiantaram o automático`)}
                ${tile("Faltou material", ui.milhar(e.faltou.length), e.comPrazo ? `${pct(e.faltou.length / e.comPrazo)} dos programados chegaram depois de acabar` : "kit que chegou depois de o anterior acabar")}
            </div>` : ""}
            <div class="ind-duas">
                <section class="card ind-card"><h3>Pedidos por hora do dia</h3>${barras(e.pedidosPorHora.map((n, h) => ({ rotulo: String(h), valor: Math.round(n * 10) / 10, dica: `${h}h: ${ui.numero(n, 1)} pedido(s) por dia, em média` })), { passo: 2, formato: v => ui.numero(v, 1) })}
                    <p class="suave">Média por dia do período: mostra os picos (começo de turno, volta do almoço). Para saber se a frota dá conta, use o <a href="#" data-ind-estudo>Estudo de frota</a>.</p></section>
                <section class="card ind-card"><h3>Concluídas por hora do dia</h3>${barras(e.porHora.map((n, h) => ({ rotulo: String(h), valor: n, dica: `${h}h: ${n}` })), { passo: 2 })}</section>
            </div>
            <div class="ind-duas">
                <section class="card ind-card"><h3>Por missão</h3>${tabela(["Missão", "Entregas", "Atendimento médio"], e.porMissao.slice(0, 12).map(x => [esc(x.chave) + (typeof Despacho !== "undefined" ? ` <span class="suave">${esc(Despacho.nomeMissao(x.chave) !== x.chave ? Despacho.nomeMissao(x.chave) : "")}</span>` : ""), ui.milhar(x.n), durS(x.s / x.n)]))}</section>
                <section class="card ind-card"><h3>Por posto</h3>${tabela(["Posto", "Entregas", "Atendimento médio"], e.porPosto.slice(0, 12).map(x => [esc(x.chave), ui.milhar(x.n), durS(x.s / x.n)]), "Nenhum pedido de posto no período.")}</section>
            </div>
            ${e.pausas.length ? `<section class="card ind-card"><h3>Pausas da programação</h3>${tabela(["Posto", "Motivo", "Vezes", "Tempo pausado"], e.pausas.slice(0, 12).map(x => [esc(x.posto), esc(x.motivo), ui.milhar(x.n), dur(x.s * 1000)]))}</section>` : ""}`;
    }

    function htmlFrota(r) {
        return `
            <div class="ind-tiles">
                ${tile("Disponibilidade", pct(r.frota.disp), "no turno")}
                ${tile("Utilização", pct(r.frota.util), "em missão no turno")}
                ${tile("Em missão", dur(r.total.missao), "soma da frota")}
                ${tile("Parado sem missão", dur(r.total.pronto), "pronto, esperando pedido")}
            </div>
            <section class="card ind-card"><h3>Tempo de cada AGV</h3>${legendaEstados()}
                ${tabela(["AGV", "Distribuição", "Missão", "Sem missão", "Atenção", "Falha + emergência", "Sem sinal", "Manutenção", "Utilização", "Disponib.", "Entregas"],
                    r.agvsIds.map(a => {
                        const t = r.tempo[a];
                        return [`<b>${esc(a)}</b>`, barraEstados(t), dur(t.missao), dur(t.pronto), dur(t.atencao), dur(t.falha + t.emergencia), dur(t.offline), dur(t.manutencao),
                                pct(r.util(t)), pct(r.disp(t)), ui.milhar(r.entregas.porAgv.find(x => x.chave === a)?.n || 0)];
                    }), "Sem registro da frota no período.")}
            </section>
            <p class="suave ind-nota">Utilização e disponibilidade contam só o tempo dentro do turno, sem a manutenção planejada. Sem nenhuma tela despachando, o registro para (o último estado continua valendo).</p>`;
    }

    function htmlParadas(r) {
        const p = r.paradas;
        const causas = Object.entries(p.causas).sort((a, b) => b[1] - a[1]);
        return `
            <div class="ind-tiles">
                ${tile("Paradas", ui.milhar(p.n), "eventos de parada")}
                ${tile("Tempo parado ou em atenção", dur(p.tempo), "falha, emergência, obstáculo, confirmação")}
                ${tile("Ponto que mais parou", p.porPonto[0] ? esc(p.porPonto[0].ponto) : "--", p.porPonto[0] ? dur(p.porPonto[0].tempo) : "")}
            </div>
            <div class="ind-duas">
                <section class="card ind-card ind-calor"><h3>Onde a frota para</h3><div class="ind-mapa" id="indMapaCalor"></div>
                    <div class="ind-legenda"><span><i class="calor-1"></i>pouco</span><span><i class="calor-2"></i></span><span><i class="calor-3"></i></span><span><i class="calor-4"></i>muito tempo parado</span></div></section>
                <section class="card ind-card"><h3>Por causa</h3>${tabela(["Causa", "Vezes"], causas.map(([k, n]) => [esc(NOMES_PARADA[k] || k), ui.milhar(n)]), "Nenhuma parada no período.")}
                    <h3 style="margin-top:14px">Por ponto</h3>${tabela(["Ponto", "Tempo", "Vezes", "Causas"], p.porPonto.slice(0, 10).map(x => [`<b>${esc(x.ponto)}</b>`, dur(x.tempo), ui.milhar(x.vezes), esc(Object.entries(x.causas).map(([k, n]) => `${NOMES_PARADA[k] || k} (${n})`).join(", "))]))}</section>
            </div>`;
    }

    function htmlTrafego(r) {
        const t = r.trafego;
        return `
            <div class="ind-tiles">
                ${tile("Esperas no tráfego", ui.milhar(t.esperas.length), "um AGV esperando outro sair da zona")}
                ${tile("Tempo esperando", durS(t.total), t.esperas.length ? `média ${durS(t.total / t.esperas.length)}` : "")}
                ${tile("Zona mais disputada", t.porZona[0] ? esc(t.porZona[0].zona) : "--", t.porZona[0] ? `${t.porZona[0].vezes} esperas` : "")}
            </div>
            <section class="card ind-card"><h3>Por zona</h3>${tabela(["Zona", "Esperas", "Tempo total", "Média"], t.porZona.map(z => [`<b>${esc(z.zona)}</b>`, ui.milhar(z.vezes), durS(z.s), durS(z.s / z.vezes)]), "Nenhuma espera no período.")}</section>
            <p class="suave ind-nota">Zona com muita espera: vale criar um ponto de espera antes dela, um desvio, ou separar o sentido dos corredores.</p>`;
    }

    function htmlGanhos(r) {
        const g = r.ganhos;
        return `
            <form class="card ind-card ind-ganhos-form" onsubmit="return false">
                <h3>Base do cálculo</h3>
                <p class="suave">Troque pelos números da sua operação. É uma estimativa: entregas concluídas × tempo que uma pessoa levaria.</p>
                <div class="editor-linha">
                    <label class="campo"><span>Minutos de uma pessoa por entrega</span><input type="number" min="0.5" step="0.5" data-ganho="minutosPorEntrega" value="${g.config.minutosPorEntrega}"></label>
                    <label class="campo"><span>Custo da hora (R$, com encargos)</span><input type="number" min="1" step="1" data-ganho="custoHora" value="${g.config.custoHora}"></label>
                </div>
            </form>
            <div class="ind-tiles">
                ${tile("Entregas concluídas", ui.milhar(r.entregas.concluidos), "no período")}
                ${tile("Horas de pessoas liberadas", ui.numero(g.horas, g.horas < 10 ? 1 : 0) + " h", "para trabalho que agrega valor")}
                ${tile("Equivale a", reais(g.reais), "no período")}
                ${tile("Por mês (ritmo atual)", reais(g.reais / Math.max(1, (r.d.ate - r.d.desde) / 86400000) * 30), "projeção simples")}
            </div>`;
    }

    function htmlManutencao(r) {
        const m = r.manutencao;
        return `
            <div class="ind-tiles">
                ${tile("Manutenções", ui.milhar(m.n), dur(m.tempo) + " no período (planejado)")}
                ${tile("Falhas e emergências", ui.milhar(m.falhas), "eventos")}
                ${tile("Tempo médio entre falhas", dur(m.mtbf), "MTBF, em operação")}
                ${tile("Tempo médio para resolver", dur(m.mttr), "MTTR, falha ou emergência")}
            </div>
            <section class="card ind-card"><h3>Manutenções no período</h3>${tabela(["AGV", "Motivo", "Início", "Fim", "Duração"],
                m.lista.sort((a, b) => b.inicio - a.inicio).map(x => [`<b>${esc(x.agv)}</b>`, esc(x.motivo), new Date(x.inicio).toLocaleString("pt-BR"), x.fim ? new Date(x.fim).toLocaleString("pt-BR") : `<span class="pilula ambar">em andamento</span>`, dur(x.dur)]), "Nenhuma manutenção no período.")}</section>`;
    }

    const HTML_ABA = { resumo: htmlResumo, entregas: htmlEntregas, frota: htmlFrota, paradas: htmlParadas, trafego: htmlTrafego, ganhos: htmlGanhos, manutencao: htmlManutencao };

    function desenharCalor(r, container) {
        if (!container || typeof MapaSVG === "undefined") return null;
        const planta = plantaPublicada();
        if (!planta.nos.length) { container.innerHTML = `<div class="empty-state">Sem planta publicada.</div>`; return null; }
        const m = MapaSVG.criar(container, { rota: false, rastro: false, outros: false, mostrarTags: false, rotulos: true, tresD: false });
        const max = Math.max(1, ...r.paradas.porPonto.map(x => x.tempo));
        m.sobreposicao = (mapa, grupo, { Y, px }) => {
            r.paradas.porPonto.forEach(x => {
                const no = Planta.noPorId(planta, x.ponto);
                if (!no) return;
                const f = Math.sqrt(x.tempo / max);
                const nivel = f > 0.75 ? 4 : f > 0.5 ? 3 : f > 0.25 ? 2 : 1;
                const c = MapaSVG.el("circle", { cx: no.x, cy: Y(no.y), r: px(10 + f * 26), class: `calor calor-${nivel}` }, grupo);
                const t = MapaSVG.el("title", {}, c);
                t.textContent = `${x.ponto}: ${dur(x.tempo)} parado ou em atenção, ${x.vezes} vez(es)`;
            });
        };
        m.agvs = [];
        m.definirPlanta(planta);
        m.desenhar();
        return m;
    }

    async function atualizar(forcar) {
        const caixa = document.getElementById("indicadoresConteudo");
        if (!caixa) return;
        const v = ++versao;
        if (!dados || forcar) {
            carregando = true;
            desenharMoldura(caixa, null);
            try { dados = calcular(await buscar()); }
            catch (erro) { dados = null; caixa.querySelector(".ind-corpo").innerHTML = `<div class="empty-state">Não foi possível carregar: ${esc(window.Nuvem ? Nuvem.traduzirErro(erro) : erro.message)}</div>`; carregando = false; return; }
            carregando = false;
            if (v !== versao) return;
        }
        desenharMoldura(caixa, dados);
    }

    function desenharMoldura(caixa, r) {
        const sim = demo();
        caixa.innerHTML = `
            ${sim ? `<div class="alerta-faixa ind-simulacao"><b>SIMULAÇÃO</b><span>Dados de exemplo, gerados a partir da planta e das missões de demonstração. Não são de uma operação real.</span></div>` : ""}
            <div class="barra-acoes ind-barra">
                <div class="grupo-segmentado" role="tablist" aria-label="Período">${PERIODOS.map(([k, n]) => `<button type="button" data-ind-periodo="${k}" class="${periodo === k ? "ativo" : ""}" aria-pressed="${periodo === k}">${n}</button>`).join("")}</div>
                <div class="grupo">
                    <button type="button" class="btn" data-ind-acao="recarregar">Atualizar</button>
                    <button type="button" class="btn btn-primario" data-ind-acao="pdf" ${r ? "" : "disabled"}>${ui.icone("pdf", "icone-p")}Relatório do piloto (PDF)</button>
                </div>
            </div>
            <nav class="ind-abas" role="tablist">${ABAS.map(([k, n]) => `<button type="button" role="tab" data-ind-aba="${k}" class="${aba === k ? "ativo" : ""}" aria-selected="${aba === k}">${n}</button>`).join("")}</nav>
            <div class="ind-corpo">${r ? HTML_ABA[aba](r) : `<div class="empty-state">${carregando ? "Carregando…" : "Sem dados."}</div>`}</div>
            ${r && !sim && !r.d.estados.length && !r.d.pedidos.length ? `<p class="suave ind-nota">Ainda sem histórico. Ele é gravado enquanto alguma tela (supervisório ou tablet de posto) estiver despachando.</p>` : ""}`;
        if (r && aba === "paradas") mapaCalor = desenharCalor(r, document.getElementById("indMapaCalor"));
    }

    /* ---------------- relatório (PDF pelo navegador) ---------------- */

    function relatorio() {
        const r = dados;
        if (!r) return;
        const empresa = window.Nuvem && Nuvem.emNuvem() ? Nuvem.empresa().nome : demo() ? "Demonstração" : "";
        const periodoTxt = `${new Date(r.d.desde).toLocaleDateString("pt-BR")} a ${new Date(r.d.ate).toLocaleDateString("pt-BR")}`;
        let caixa = document.getElementById("relatorioImpressao");
        if (!caixa) { caixa = document.createElement("div"); caixa.id = "relatorioImpressao"; document.body.appendChild(caixa); }
        const abaAntes = aba;
        const secao = (k, titulo) => { aba = k; return `<section class="rel-secao"><h2>${titulo}</h2>${HTML_ABA[k](r)}</section>`; };
        caixa.innerHTML = `
            <header class="rel-capa">
                <img src="img/e4m-marca-claro.webp" alt="E4M" width="130" height="41">
                <div><h1>Relatório do piloto${empresa ? " · " + esc(empresa) : ""}</h1><p>${periodoTxt} · gerado em ${new Date().toLocaleString("pt-BR")} · Eciton, supervisão de frota</p></div>
            </header>
            ${r.d.exemplo ? `<p class="rel-simulacao">SIMULAÇÃO · dados de exemplo, não são de uma operação real</p>` : ""}
            ${secao("resumo", "Resumo")}${secao("entregas", "Entregas")}${secao("frota", "Frota")}${secao("paradas", "Paradas")}
            ${secao("trafego", "Tráfego")}${secao("ganhos", "Ganhos")}${secao("manutencao", "Manutenção")}
            <footer class="rel-rodape">E4M · Engineering for Motion · São Bernardo do Campo, SP</footer>`;
        aba = abaAntes;
        caixa.querySelectorAll("input").forEach(i => i.setAttribute("disabled", ""));
        const mapa = caixa.querySelector("#indMapaCalor");
        if (mapa) { mapa.id = "relMapaCalor"; desenharCalor(r, mapa); }
        document.body.classList.add("imprimindo-relatorio");
        const fim = () => { document.body.classList.remove("imprimindo-relatorio"); removeEventListener("afterprint", fim); };
        addEventListener("afterprint", fim);
        setTimeout(() => { window.print(); setTimeout(fim, 500); }, 250);
    }

    document.addEventListener("click", evento => {
        const caixa = evento.target.closest("#indicadoresConteudo");
        if (!caixa) return;
        if (evento.target.closest("[data-ind-estudo]")) { evento.preventDefault(); if (typeof mudarTela === "function") mudarTela("estudo"); return; }
        const b = evento.target.closest("[data-ind-aba],[data-ind-periodo],[data-ind-acao]");
        if (!b) return;
        if (b.dataset.indAba) { aba = b.dataset.indAba; desenharMoldura(caixa, dados); }
        if (b.dataset.indPeriodo) { periodo = b.dataset.indPeriodo; atualizar(true); }
        if (b.dataset.indAcao === "recarregar") atualizar(true);
        if (b.dataset.indAcao === "pdf") relatorio();
    });
    document.addEventListener("change", evento => {
        const campo = evento.target.closest("[data-ganho]");
        if (!campo) return;
        const g = ganhosConfig();
        const n = Number(campo.value);
        if (Number.isFinite(n) && n > 0) g[campo.dataset.ganho] = n;
        try { localStorage.setItem("indicadoresGanhos", JSON.stringify(g)); } catch (e) { /* ignora */ }
        if (dados) { dados.ganhos = { config: g, horas: dados.entregas.concluidos * g.minutosPorEntrega / 60, reais: dados.entregas.concluidos * g.minutosPorEntrega / 60 * g.custoHora }; }
        desenharMoldura(document.getElementById("indicadoresConteudo"), dados);
    });

    function abrir() { atualizar(true); }

    return { abrir, atualizar, relatorio, calcular, exemplo, intervalos, dados: () => dados };
})();
