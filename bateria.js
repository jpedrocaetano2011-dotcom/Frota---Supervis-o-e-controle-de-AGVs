/* ============================================================
   BATERIAS (0.23) — o motor: perfis, estimativa, quem carrega
   ============================================================
   Só a decisão, sem tela, sem MQTT e sem banco (roda no navegador,
   pela aba que despacha, e no Node, para os testes):
   - perfil de bateria por modelo (química, capacidade, nível de
     medição, limites, carga, consumo, temperatura) e regra própria
     por Atta (a do modelo com o que mudou);
   - a carga de quem não mede (nível 0, o protótipo): estimada pelo
     consumo rodando e parado e pela recarga no carregador;
   - planejar(): quem precisa carregar (crítica, baixa, oportunidade,
     comando do operador), a fila de carregadores (mínimo rodando,
     ordem, liberar o carregador), o horário de ponta e os alertas;
   - energia de uma missão (o despachante confere se ela cabe).
   Níveis de medição: 0 estimado · 1 tensão · 2 tensão e corrente ·
   3 BMS (saúde, ciclos, temperatura) · 9 simulada (Atta virtual).
*/
(function (raiz, fabrica) {
    if (typeof module === "object" && module.exports) module.exports = fabrica();
    else raiz.Bateria = fabrica();
})(typeof self !== "undefined" ? self : this, function () {
    "use strict";
    const VERSAO = "0.24.0";

    const QUIMICAS = {
        lifepo4: { nome: "LiFePO4 (lítio-ferro-fosfato)", tensaoNominal: 25.6, tensaoVazia: 24.0, tensaoCheia: 28.8, cargaAlvo: 90 },
        liion: { nome: "Li-ion (NMC)", tensaoNominal: 25.2, tensaoVazia: 21.0, tensaoCheia: 29.4, cargaAlvo: 80 },
        chumbo: { nome: "Chumbo-ácido", tensaoNominal: 24.0, tensaoVazia: 23.0, tensaoCheia: 27.6, cargaAlvo: 100 }
    };
    const NIVEIS = {
        0: "estimado pelo Eciton", 1: "tensão", 2: "tensão e corrente", 3: "BMS", 9: "simulado (Atta virtual)"
    };
    const PERFIL_BASE = {
        quimica: "lifepo4", capacidadeWh: 1280, medicao: 3,
        despacharAcima: 30,      // % para receber pedido
        irCarregarAbaixo: 25,    // % para ir carregar sozinho
        critico: 12,             // % crítica: carrega antes de tudo (e o Atta não parte da fila)
        reserva: 15,             // % que uma missão nunca pode consumir
        cargaAlvo: 90,           // % no dia a dia
        cargaCheia: 100,         // % quando pedir "carga cheia"
        potenciaCargaW: 640,
        consumoRodandoW: 120, consumoParadoW: 15,
        whKmVazio: 25, whKmCarregado: 40, whCicloCarga: 0.6,   // por pegar ou entregar
        tempMaxCarga: 45, tempMaxOperacao: 55, saudeTroca: 70,
        cicloVida: 3000
    };
    // de partida por módulo (o modelo e o Atta mudam)
    const POR_MODULO = {
        E: { capacidadeWh: 1280, consumoRodandoW: 110, potenciaCargaW: 640, whKmVazio: 22, whKmCarregado: 38 },
        G: { capacidadeWh: 1024, consumoRodandoW: 90, potenciaCargaW: 512, whKmVazio: 18, whKmCarregado: 26 },
        R: { capacidadeWh: 1280, consumoRodandoW: 100, potenciaCargaW: 640, whKmVazio: 22, whKmCarregado: 34 },
        T: { capacidadeWh: 2560, consumoRodandoW: 220, potenciaCargaW: 1280, whKmVazio: 40, whKmCarregado: 90 }
    };
    // o protótipo (TCC) não mede a bateria
    const POR_MODELO = { "atta-e-o": { medicao: 0, capacidadeWh: 60, consumoRodandoW: 12, consumoParadoW: 3, potenciaCargaW: 30, whKmVazio: 6, whKmCarregado: 8, whCicloCarga: 0.1 } };

    const CONFIG_PADRAO = {
        perfis: {},          // id do modelo → o que muda no perfil
        porAtta: {},         // id do Atta → { proprio: true, ...o que muda }
        oportunidade: { ativa: true, intervalos: true, ocioso: true, ociosoMin: 10 },
        fila: { minimoRodando: 1, liberarComEspera: true },
        ponta: { ativa: false, criticoCarrega: true, janelas: [{ inicio: "18:00", fim: "21:00", dias: [1, 2, 3, 4, 5] }] },
        alertas: { ativo: false, emails: [], eventos: { critica: true, carga_falhou: true, temperatura: true, saude: true } }
    };
    const CAMPOS_PERFIL = Object.keys(PERFIL_BASE);

    const num = (v, d) => (Number.isFinite(Number(v)) && v !== "" && v !== null ? Number(v) : d);
    const clonar = o => JSON.parse(JSON.stringify(o));
    function juntar(a, b) {
        Object.keys(b || {}).forEach(k => {
            if (b[k] && typeof b[k] === "object" && !Array.isArray(b[k]) && a[k] && typeof a[k] === "object" && !Array.isArray(a[k])) juntar(a[k], b[k]);
            else if (b[k] !== undefined) a[k] = b[k];
        });
        return a;
    }
    function configuracao(c) {
        const r = juntar(clonar(CONFIG_PADRAO), c && typeof c === "object" ? clonar(c) : {});
        r.ponta.janelas = (Array.isArray(r.ponta.janelas) ? r.ponta.janelas : []).filter(j => j && /^\d{2}:\d{2}$/.test(j.inicio) && /^\d{2}:\d{2}$/.test(j.fim))
            .map(j => ({ inicio: j.inicio, fim: j.fim, dias: (j.dias || []).map(Number).filter(d => d >= 0 && d <= 6) }));
        r.alertas.emails = (r.alertas.emails || []).map(e => String(e).trim().toLowerCase()).filter(Boolean).slice(0, 10);
        r.fila.minimoRodando = Math.max(0, Math.round(num(r.fila.minimoRodando, 1)));
        r.oportunidade.ociosoMin = Math.max(1, num(r.oportunidade.ociosoMin, 10));
        return r;
    }
    function limparPerfil(p) {
        const r = {};
        CAMPOS_PERFIL.forEach(k => {
            if (p[k] === undefined || p[k] === null || p[k] === "") return;
            if (k === "quimica") { if (QUIMICAS[p[k]]) r[k] = p[k]; }
            else if (k === "medicao") { if ([0, 1, 2, 3, 9].includes(Number(p[k]))) r[k] = Number(p[k]); }
            else if (Number.isFinite(Number(p[k]))) r[k] = Number(p[k]);
        });
        return r;
    }
    // perfil do modelo: base → módulo → modelo de fábrica → a regra da empresa
    function perfilDoModelo(modeloId, modulo, cfg) {
        const c = cfg || CONFIG_PADRAO;
        const p = Object.assign({}, PERFIL_BASE, POR_MODULO[modulo] || {}, POR_MODELO[modeloId] || {});
        const q = QUIMICAS[(c.perfis?.[modeloId] || {}).quimica || p.quimica];
        if (q && !(c.perfis?.[modeloId] || {}).cargaAlvo) p.cargaAlvo = q.cargaAlvo;
        return Object.assign(p, limparPerfil(c.perfis?.[modeloId] || {}));
    }
    // perfil do Atta: o do modelo, ou o do modelo com a regra própria dele
    function perfilDoAtta(agv, cfg) {
        const c = cfg || CONFIG_PADRAO;
        const base = perfilDoModelo(agv.modelo, agv.modulo, c);
        const proprio = c.porAtta?.[agv.id];
        const p = proprio && proprio.proprio ? Object.assign(base, limparPerfil(proprio)) : base;
        // coerência: crítico < ir carregar ≤ despachar ≤ alvo ≤ cheia
        p.critico = Math.max(1, Math.min(p.critico, 50));
        p.irCarregarAbaixo = Math.max(p.critico + 1, p.irCarregarAbaixo);
        p.despacharAcima = Math.max(p.irCarregarAbaixo, p.despacharAcima);
        p.cargaAlvo = Math.max(p.despacharAcima + 5, Math.min(100, p.cargaAlvo));
        p.cargaCheia = Math.max(p.cargaAlvo, Math.min(100, p.cargaCheia));
        p.reserva = Math.max(p.critico, Math.min(p.reserva, p.despacharAcima));
        p.proprio = Boolean(proprio && proprio.proprio);
        return p;
    }
    // o que o Atta recebe em comando/bateria CONFIGURAR
    function pacoteConfigurar(perfil, carregadores) {
        const q = QUIMICAS[perfil.quimica] || QUIMICAS.lifepo4;
        return { acao: "CONFIGURAR", capacidadeWh: perfil.capacidadeWh, tensaoNominal: q.tensaoNominal, tensaoVazia: q.tensaoVazia, tensaoCheia: q.tensaoCheia,
            criticaPct: perfil.critico, consumoRodandoW: perfil.consumoRodandoW, consumoParadoW: perfil.consumoParadoW, potenciaCargaW: perfil.potenciaCargaW,
            carregadores: (carregadores || []).slice(0, 8) };
    }

    /* ---------------- horário (ponta, intervalos) ---------------- */
    const minutos = t => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(t || "")); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
    // janela {inicio, fim, dias} valendo em ms (hora local) → { dentro, fimMs }
    function naJanela(j, ms) {
        const ini = minutos(j.inicio), fim = minutos(j.fim);
        if (ini === null || fim === null || ini === fim || !(j.dias || []).length) return { dentro: false };
        const d = new Date(ms), dia = d.getDay(), m = d.getHours() * 60 + d.getMinutes();
        const meiaNoite = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
        if (ini < fim) return j.dias.includes(dia) && m >= ini && m < fim ? { dentro: true, fimMs: meiaNoite + fim * 60000 } : { dentro: false };
        if (j.dias.includes(dia) && m >= ini) return { dentro: true, fimMs: meiaNoite + 86400000 + fim * 60000 };
        if (j.dias.includes((dia + 6) % 7) && m < fim) return { dentro: true, fimMs: meiaNoite + fim * 60000 };
        return { dentro: false };
    }
    function pontaAgora(cfg, ms) {
        const c = cfg || CONFIG_PADRAO;
        if (!c.ponta?.ativa) return null;
        for (const j of c.ponta.janelas || []) { const r = naJanela(j, ms); if (r.dentro) return Object.assign({}, j, r); }
        return null;
    }

    /* ---------------- energia ---------------- */
    // Wh de uma missão: andar vazio até o início, andar no corpo (metade carregado), parado e os pega/entrega
    function energiaMissao(perfil, m) {
        const vazio = num(m.metrosVazio, 0), corpo = num(m.metrosCorpo, 0), s = num(m.segundos, 0), ciclos = num(m.ciclos, 0);
        return vazio / 1000 * perfil.whKmVazio + corpo / 1000 * (perfil.whKmVazio + perfil.whKmCarregado) / 2 +
            perfil.consumoParadoW * s / 3600 + ciclos * perfil.whCicloCarga;
    }
    // a missão cabe? pct agora − (missão + volta ao carregador) ≥ reserva
    function cabe(perfil, pct, whMissao, whVolta) {
        if (pct == null || !Number.isFinite(pct)) return { cabe: true, sobra: null };
        const gasto = (whMissao + (whVolta || 0)) / Math.max(1, perfil.capacidadeWh) * 100;
        const sobra = pct - gasto;
        return { cabe: sobra >= perfil.reserva, sobra, gasto };
    }
    // estimativa (nível 0): a nova carga depois de dt segundos
    function estimar(perfil, pct, s) {
        const dt = Math.max(0, Math.min(3600, num(s.dt, 0)));
        let w;
        if (s.carregando) w = -perfil.potenciaCargaW * (pct > 80 ? 0.5 : 1);
        else if (s.andando) w = perfil.consumoRodandoW * (s.carregado ? 1.25 : 1);
        else w = perfil.consumoParadoW;
        const novo = Math.max(0, Math.min(100, num(pct, 80) - w * dt / 3600 / Math.max(1, perfil.capacidadeWh) * 100));
        return { pct: novo, whGasto: Math.max(0, w) * dt / 3600, whCarregado: Math.max(0, -w) * dt / 3600 };
    }
    // autonomia: horas e missões até a carga crítica
    function autonomia(perfil, pct, consumoMedioW, whPorMissao) {
        if (pct == null || !Number.isFinite(pct)) return { horas: null, missoes: null };
        const wh = Math.max(0, pct - perfil.critico) / 100 * perfil.capacidadeWh;
        const w = consumoMedioW > 0 ? consumoMedioW : (perfil.consumoRodandoW * 0.5 + perfil.consumoParadoW * 0.5);
        const porMissao = whPorMissao > 0 ? whPorMissao : perfil.consumoRodandoW * 4 / 60 + perfil.whCicloCarga * 2;
        return { horas: wh / w, missoes: Math.floor(wh / porMissao) };
    }
    // tempo de carga até o alvo (min)
    function minutosAte(perfil, pct, alvo) {
        if (pct == null || pct >= alvo) return 0;
        const ate80 = Math.max(0, Math.min(alvo, 80) - pct), depois = Math.max(0, alvo - Math.max(pct, 80));
        const whPct = perfil.capacidadeWh / 100;
        return (ate80 * whPct / perfil.potenciaCargaW + depois * whPct / (perfil.potenciaCargaW * 0.5)) * 60;
    }

    /* ---------------- quem carrega ---------------- */
    /* entrada: {
         agora, config,
         agvs: [{ id, nome, modelo, modulo, online, manutencao, pct, medido, t, saude, carregando, noCarregador, carga (o firmware: carga pedida),
                  pontoAtual, x, y, berco (o berço da rotina), livre (sem missão nem fila), indoCarregar (missão CARGA- em andamento ou na fila), destinoCarga,
                  emIntervalo, ociosoS, cargaDesdeS (há quanto tempo está no carregador com carga pedida), subiuDesdeCarga }],
         carregadores: [{ id, nome, modelos: [], x, y }],
         agora_: { <agv>: { acao: "carregar" | "cheia" | "pular" | "liberar", ate } }   (comandos do operador)
       }
       → { acoes: [{ tipo: "carregar" | "liberar" | "sair", agv, carregador?, destino?, motivo }], fila: [{ agv, motivo, posicao, carregador, esperaMin }],
           porAtta: { id: { perfil, situacao, motivo, precisa, alvo, autonomia } }, carregadores: [{ id, agv, previsaoMin }], ponta, alertas: [{ agv, alerta, texto }] } */
    function planejar(entrada) {
        const cfg = configuracao(entrada.config);
        const agora = entrada.agora || Date.now();
        const manual = entrada.comandos || {};
        const vale = k => manual[k] && (!manual[k].ate || Date.parse(manual[k].ate) > agora) ? manual[k].acao : null;
        const ponta = pontaAgora(cfg, agora);
        const agvs = (entrada.agvs || []).filter(a => a && a.id);
        const carregadores = (entrada.carregadores || []).filter(c => c && c.id);
        const acoes = [], alertas = [], fila = [], porAtta = {};
        const serve = (c, a) => !(c.modelos || []).length || c.modelos.includes(a.modelo);
        const dist = (a, c) => (Number.isFinite(a.x) && Number.isFinite(c.x) ? Math.hypot(a.x - c.x, a.y - c.y) : 0);

        // quem está em cada carregador (parado nele ou indo para ele)
        const ocupante = new Map();
        agvs.forEach(a => {
            if (a.noCarregador && a.pontoAtual) ocupante.set(a.pontoAtual, a.id);
            if (a.indoCarregar && a.destinoCarga) ocupante.set(a.destinoCarga, a.id);
        });

        agvs.forEach(a => {
            const p = perfilDoAtta(a, cfg);
            const pct = Number.isFinite(a.pct) ? a.pct : null;
            const cmd = vale(a.id);
            const alvo = cmd === "cheia" ? p.cargaCheia : p.cargaAlvo;
            const info = { perfil: p, pct, alvo, precisa: null, situacao: "sem dado", motivo: "", autonomia: autonomia(p, pct, a.consumoMedioW, a.whPorMissao) };
            porAtta[a.id] = info;
            // alertas (o banco manda os e-mails)
            if (pct != null && pct < p.critico) alertas.push({ agv: a.id, alerta: "critica", texto: `Carga em ${Math.round(pct)}% (crítica abaixo de ${p.critico}%).` });
            else if (a.noCarregador && a.carga && (a.cargaDesdeS || 0) > 300 && (a.carregando === false || (!a.subiuDesdeCarga && a.medido)))
                alertas.push({ agv: a.id, alerta: "carga_falhou", texto: "No carregador há mais de 5 min e a carga não sobe: confira o contato e o carregador." });
            else if (Number.isFinite(a.t) && a.t > (a.carregando ? p.tempMaxCarga : p.tempMaxOperacao))
                alertas.push({ agv: a.id, alerta: "temperatura", texto: `Bateria a ${Math.round(a.t)} °C (máx. ${a.carregando ? p.tempMaxCarga : p.tempMaxOperacao} °C).` });
            else if (Number.isFinite(a.saude) && a.saude < p.saudeTroca)
                alertas.push({ agv: a.id, alerta: "saude", texto: `Saúde da bateria em ${Math.round(a.saude)}% (trocar abaixo de ${p.saudeTroca}%).` });

            if (!a.online) { info.situacao = "offline"; return; }
            if (a.manutencao) { info.situacao = "manutenção"; return; }
            if (pct == null) { info.situacao = "sem dado"; return; }

            const noCarga = a.noCarregador && (a.carga || a.carregando);
            if (noCarga || a.indoCarregar) {
                info.situacao = a.indoCarregar && !a.noCarregador ? "indo carregar" : "carregando";
                // liberar: chegou no alvo; o operador mandou; ou alguém mais precisado espera e este já pode trabalhar
                if (a.noCarregador) {
                    if (cmd === "liberar") acoes.push({ tipo: "liberar", agv: a.id, motivo: "liberado pelo operador" });
                    else if (pct >= alvo) acoes.push({ tipo: "liberar", agv: a.id, motivo: `chegou em ${Math.round(pct)}% (alvo ${alvo}%)` });
                    else if (ponta && pct >= p.despacharAcima && cmd !== "carregar" && cmd !== "cheia") acoes.push({ tipo: "liberar", agv: a.id, motivo: "horário de ponta: a frota não carrega" });
                    else info.minutosRestantes = minutosAte(p, pct, alvo);
                }
                return;
            }
            // precisa carregar?
            let precisa = null;
            if (cmd === "pular") { info.situacao = a.livre ? "ocioso" : "rodando"; info.motivo = "fora da fila por ordem do operador"; return; }
            if (cmd === "carregar" || cmd === "cheia") precisa = { nivel: 1, motivo: cmd === "cheia" ? "carga cheia pedida pelo operador" : "o operador mandou carregar" };
            else if (pct < p.critico) precisa = { nivel: 0, motivo: `crítica (${Math.round(pct)}%)` };
            else if (pct < p.irCarregarAbaixo) precisa = { nivel: 2, motivo: `abaixo de ${p.irCarregarAbaixo}%` };
            else if (cfg.oportunidade.ativa && pct < alvo && a.livre &&
                ((cfg.oportunidade.intervalos && a.emIntervalo) || (cfg.oportunidade.ocioso && (a.ociosoS || 0) >= cfg.oportunidade.ociosoMin * 60)))
                precisa = { nivel: 3, motivo: a.emIntervalo ? "recarga de oportunidade (intervalo)" : `recarga de oportunidade (parado há ${Math.round((a.ociosoS || 0) / 60)} min)` };
            info.situacao = pct < p.critico ? "crítico" : a.livre ? "ocioso" : "rodando";
            if (!precisa) return;
            // horário de ponta: só o crítico (se a regra deixar) e o comando do operador
            if (ponta && !(precisa.nivel === 1) && !(precisa.nivel === 0 && cfg.ponta.criticoCarrega)) {
                info.motivo = `espera o fim do horário de ponta (${ponta.fim})`;
                info.precisa = Object.assign({}, precisa, { bloqueado: "ponta" });
                fila.push({ agv: a.id, motivo: precisa.motivo, nivel: precisa.nivel, pct, espera: "ponta", texto: info.motivo, fimPonta: ponta.fimMs });
                return;
            }
            info.precisa = precisa;
            fila.push({ agv: a.id, motivo: precisa.motivo, nivel: precisa.nivel, pct, livre: a.livre });
        });

        // ordem: crítico, comando do operador, abaixo do limite, oportunidade; depois a menor carga
        fila.sort((x, y) => (x.espera === "ponta") - (y.espera === "ponta") || x.nivel - y.nivel || x.pct - y.pct);
        // quem está disponível para trabalhar (o mínimo rodando)
        const disponivel = a => a.online && !a.manutencao && !a.indoCarregar && !(a.noCarregador && (a.carga || a.carregando)) &&
            Number.isFinite(a.pct) && a.pct >= porAtta[a.id].perfil.despacharAcima;
        let disponiveis = agvs.filter(disponivel).length;
        const livres = carregadores.filter(c => !ocupante.has(c.id));
        let posicao = 0;
        fila.forEach(f => {
            posicao++;
            f.posicao = posicao;
            const a = agvs.find(x => x.id === f.agv);
            const info = porAtta[f.agv];
            if (f.espera === "ponta") return;
            if (f.nivel >= 2 && disponivel(a) && disponiveis - 1 < cfg.fila.minimoRodando) {
                f.espera = "minimo"; f.texto = `espera: o mínimo de ${cfg.fila.minimoRodando} Atta rodando`; info.motivo = f.texto; return;
            }
            const opcoes = livres.filter(c => serve(c, a)).sort((c1, c2) => dist(a, c1) - dist(a, c2));
            if (!opcoes.length) {
                // carregador ocupado: libera quem já pode trabalhar, se alguém mais precisado espera
                const ocupados = carregadores.filter(c => serve(c, a) && ocupante.has(c.id));
                // um Atta parado no carregador sem carregar (já liberado): sai para o berço dele
                const parado = ocupados.map(c => ({ c, b: agvs.find(x => x.id === ocupante.get(c.id)) }))
                    .find(o => o.b && o.b.noCarregador && !o.b.carga && !o.b.carregando && o.b.livre && o.b.berco && o.b.berco !== o.c.id && o.b.id !== a.id);
                if (parado) {
                    if (!acoes.some(x => x.agv === parado.b.id)) acoes.push({ tipo: "sair", agv: parado.b.id, destino: parado.b.berco, motivo: `${f.agv} precisa do carregador ${parado.c.id}` });
                    f.espera = "carregador"; f.texto = `espera ${parado.b.id} sair do ${parado.c.nome || parado.c.id}`; info.motivo = f.texto;
                    return;
                }
                if (cfg.fila.liberarComEspera && f.nivel <= 2) {
                    const troca = ocupados.map(c => ({ c, b: agvs.find(x => x.id === ocupante.get(c.id)) }))
                        .filter(o => o.b && o.b.noCarregador && (o.b.carga || o.b.carregando) && Number.isFinite(o.b.pct) && o.b.pct >= porAtta[o.b.id].perfil.despacharAcima &&
                            vale(o.b.id) !== "carregar" && vale(o.b.id) !== "cheia" && !acoes.some(x => x.agv === o.b.id))
                        .sort((o1, o2) => o2.b.pct - o1.b.pct)[0];
                    if (troca) acoes.push({ tipo: "liberar", agv: troca.b.id, motivo: `${f.agv} precisa do carregador ${troca.c.id} (${f.motivo})` });
                }
                const prev = ocupados.map(c => { const b = agvs.find(x => x.id === ocupante.get(c.id)); return b ? porAtta[b.id]?.minutosRestantes ?? null : null; }).filter(v => v != null);
                f.espera = "carregador"; f.esperaMin = prev.length ? Math.min(...prev) : null;
                const preso = ocupados.map(c => agvs.find(x => x.id === ocupante.get(c.id))).find(b => b && b.noCarregador && !b.carga && !b.carregando);
                f.texto = !ocupados.length ? "nenhum carregador serve este modelo"
                    : preso && f.esperaMin == null ? `espera um carregador livre (${preso.id} está parado no carregador e não tem outro berço)`
                    : `espera um carregador livre${f.esperaMin != null ? ` (~${Math.ceil(f.esperaMin)} min)` : ""}`;
                info.motivo = f.texto;
                return;
            }
            if (!f.livre && f.nivel !== 0) { f.espera = "missao"; f.texto = "vai depois da missão atual"; info.motivo = f.texto; return; }
            if (!f.livre) { f.espera = "missao"; f.texto = "crítica: vai carregar assim que terminar a missão"; info.motivo = f.texto; return; }
            const c = opcoes[0];
            livres.splice(livres.indexOf(c), 1);
            ocupante.set(c.id, a.id);
            if (disponivel(a)) disponiveis--;
            f.carregador = c.id;
            f.texto = `vai para o carregador ${c.nome || c.id}`;
            info.motivo = `${f.motivo} → ${c.nome || c.id}`;
            acoes.push({ tipo: "carregar", agv: a.id, carregador: c.id, motivo: f.motivo, cheia: vale(a.id) === "cheia" });
        });
        const situacaoCarregadores = carregadores.map(c => {
            const id = ocupante.get(c.id);
            const b = id ? agvs.find(x => x.id === id) : null;
            return { id: c.id, nome: c.nome || c.id, modelos: c.modelos || [], agv: id || null, pct: b?.pct ?? null, indo: Boolean(b && !b.noCarregador),
                previsaoMin: b ? porAtta[b.id]?.minutosRestantes ?? null : null };
        });
        return { acoes, fila, porAtta, carregadores: situacaoCarregadores, ponta, alertas, disponiveis };
    }

    return {
        VERSAO, QUIMICAS, NIVEIS, PERFIL_BASE, POR_MODULO, POR_MODELO, CONFIG_PADRAO, CAMPOS_PERFIL,
        configuracao, perfilDoModelo, perfilDoAtta, pacoteConfigurar, naJanela, pontaAgora,
        energiaMissao, cabe, estimar, autonomia, minutosAte, planejar
    };
});
