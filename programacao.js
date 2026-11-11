/* ============================================================
   PROGRAMAÇÃO — pedidos que saem sozinhos (0.15)
   ============================================================
   Cada botão de um posto (posto + missão) pode pedir sozinho:
     consumo    "o material dura 5 min": o relógio começa quando o
                pedido anterior termina; o próximo sai a tempo de chegar
                (com a folga) antes de acabar, descontando a viagem
     intervalo  a cada X min (contando do último pedido do botão)
     horarios   em horários fixos (07:30, 10:00...)
   Só dentro da janela (início, fim e dias). Nunca mais de um pedido em
   aberto por botão: se o anterior não chegou, o próximo espera. Pedido
   à mão antes da hora "adianta" (o relógio recomeça dele). Ninguém
   despachando por um tempo: não acumula atrasados, retoma do agora.

   Quem cria o pedido é a aba que despacha (Despacho.ciclo chama
   Programacao.verificar). Operador e administrador programam; o posto,
   o líder, o operador e o administrador pausam, retomam e pulam, e tudo
   fica registrado (com o PIN pessoal, o nome da pessoa do posto).

   Na nuvem: programacoes, programacao_eventos, pessoas_posto (0.15).
   Sem nuvem: localStorage "programacoesFrota", "programacaoEventos",
   "pessoasPosto".
*/
(function (raiz) {
    "use strict";

    /* ========================================================
       NÚCLEO (sem tela: também roda no Node, nos testes)
       ======================================================== */

    const FUSO = "America/Sao_Paulo";
    const ATIVOS = ["pendente", "atribuido", "em_execucao"];
    const TOLERANCIA_HORARIO_MS = 10 * 60000;   // horário fixo perdido há mais que isso: pula (sem acumular)
    const VIAGEM_PADRAO_S = 180;
    const DIAS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
    const MODOS = { consumo: "Pelo consumo", intervalo: "A cada X minutos", horarios: "Horários fixos" };

    const minutos = hhmm => { const [h, m] = String(hhmm || "00:00").split(":").map(Number); return (h || 0) * 60 + (m || 0); };
    const hhmm = min => `${String(Math.floor(((min % 1440) + 1440) % 1440 / 60)).padStart(2, "0")}:${String(((min % 60) + 60) % 60).padStart(2, "0")}`;

    // Dia da semana e minuto do dia no fuso da programação
    function local(ms, fuso) {
        try {
            const p = new Intl.DateTimeFormat("en-GB", { timeZone: fuso || FUSO, weekday: "short", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" })
                .formatToParts(new Date(ms)).reduce((o, x) => (o[x.type] = x.value, o), {});
            const dia = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday);
            return { dia, min: Number(p.hour) * 60 + Number(p.minute), seg: Number(p.second) };
        } catch (e) {
            const d = new Date(ms);
            return { dia: d.getDay(), min: d.getHours() * 60 + d.getMinutes(), seg: d.getSeconds() };
        }
    }
    // Instante (ms) do minuto "alvo" do mesmo dia local de "ms" (deslocado em dias)
    function noDia(ms, alvoMin, fuso, deslocDias = 0) {
        const l = local(ms, fuso);
        return ms - ((l.min - alvoMin) * 60 + l.seg) * 1000 - (ms % 1000) + deslocDias * 86400000;
    }

    function normalizar(p) {
        const n = Object.assign({ ativo: true, modo: "consumo", dura_min: 5, folga_min: 1, intervalo_min: 30, horarios: [], inicio: "07:00", fim: "17:00",
            dias: [1, 2, 3, 4, 5], fuso: FUSO, primeiro: "janela", pausado: false, pausado_em: null, pausado_por_nome: "", pausa_motivo: "",
            pular_proximo: false, pulado_em: null, turnos: [], pausar_intervalos: true, abastecer_min: 0 }, p || {});
        n.turnos = Array.isArray(n.turnos) ? n.turnos.map(String) : [];
        n.pausar_intervalos = n.pausar_intervalos !== false;
        n.abastecer_min = Math.max(0, Number(n.abastecer_min) || 0);
        n.dura_min = n.dura_min == null ? null : Number(n.dura_min);
        n.folga_min = Number(n.folga_min ?? 1);
        n.intervalo_min = n.intervalo_min == null ? null : Number(n.intervalo_min);
        n.horarios = (n.horarios || []).filter(h => /^[0-2][0-9]:[0-5][0-9]$/.test(h)).sort();
        n.dias = (n.dias || []).map(Number);
        n.puladoMs = n.pulado_em ? (typeof n.pulado_em === "number" ? n.pulado_em : Date.parse(n.pulado_em)) : null;
        n.pausadoMs = n.pausado_em ? (typeof n.pausado_em === "number" ? n.pausado_em : Date.parse(n.pausado_em)) : null;
        return n;
    }

    // Janela do dia: { dentro, inicio (ms do começo da janela em curso), proxima (ms da próxima abertura) }
    function janela(prog, agora) {
        const p = normalizar(prog);
        const ini = minutos(p.inicio), fim = minutos(p.fim);
        const l = local(agora, p.fuso);
        const atravessa = fim <= ini;                              // ex.: 22:00 às 06:00
        let dentro = false, inicio = null;
        if (!atravessa) {
            if (p.dias.includes(l.dia) && l.min >= ini && l.min < fim) { dentro = true; inicio = noDia(agora, ini, p.fuso); }
        } else if (l.min >= ini && p.dias.includes(l.dia)) {
            dentro = true; inicio = noDia(agora, ini, p.fuso);
        } else if (l.min < fim && p.dias.includes((l.dia + 6) % 7)) {
            dentro = true; inicio = noDia(agora, ini, p.fuso, -1);
        }
        let proxima = null;
        for (let d = 0; d <= 7 && !proxima; d++) {
            const t = noDia(agora, ini, p.fuso, d);
            if (t > agora && p.dias.includes(local(t, p.fuso).dia)) proxima = t;
        }
        return { dentro, inicio, proxima };
    }

    // Tempo do pedido até a entrega (o que o "consumo" desconta): mediana dos últimos entregues
    function viagemEstimada(pedidosBotao, padraoS) {
        const v = (pedidosBotao || []).filter(p => p.estado === "concluido" && p.concluidoEm && p.criadoEm)
            .sort((a, b) => b.concluidoEm - a.concluidoEm).slice(0, 5).map(p => (p.concluidoEm - p.criadoEm) / 1000).filter(s => s > 0 && s < 7200).sort((a, b) => a - b);
        if (!v.length) return Math.round(padraoS || VIAGEM_PADRAO_S);
        return Math.round(v[Math.floor(v.length / 2)]);
    }
    // Quanto tempo um AGV fica ocupado num pedido (para a capacidade da frota)
    function ocupacaoEstimada(pedidosBotao, padraoS) {
        const v = (pedidosBotao || []).filter(p => p.estado === "concluido" && p.concluidoEm && p.atribuidoEm)
            .sort((a, b) => b.concluidoEm - a.concluidoEm).slice(0, 5).map(p => (p.concluidoEm - p.atribuidoEm) / 1000).filter(s => s > 0 && s < 7200).sort((a, b) => a - b);
        if (!v.length) return Math.round(padraoS || VIAGEM_PADRAO_S);
        return Math.round(v[Math.floor(v.length / 2)]);
    }

    function viagensPorHora(prog) {
        const p = normalizar(prog);
        if (!p.ativo) return 0;
        if (p.modo === "consumo") return p.dura_min > 0 ? 60 / p.dura_min : 0;
        if (p.modo === "intervalo") return p.intervalo_min > 0 ? 60 / p.intervalo_min : 0;
        if (!p.horarios.length) return 0;
        const ms = p.horarios.map(minutos);
        const horas = Math.max(1, (Math.max(...ms) - Math.min(...ms)) / 60 + 1);
        return p.horarios.length / horas;
    }

    /* Situação de um botão programado agora:
       { situacao, devidoEm, acabaEm, proximoEm, aberto, viagemS }
       situacao: desligado | pausado | fora | em_aberto | manual | aguardando | devido */
    function situacao(prog, pedidosBotao, agora, opcoes = {}) {
        const p = normalizar(prog);
        const pedidos = (pedidosBotao || []).slice();
        const viagemS = opcoes.viagemS ?? viagemEstimada(pedidos, opcoes.viagemPadraoS);
        const r = { situacao: "desligado", devidoEm: null, acabaEm: null, proximoEm: null, aberto: null, viagemS, pular: p.pular_proximo };
        if (!p.ativo) return r;
        if (p.pausado) return Object.assign(r, { situacao: "pausado" });
        const aberto = pedidos.filter(x => ATIVOS.includes(x.estado)).sort((a, b) => b.criadoEm - a.criadoEm)[0] || null;
        r.aberto = aberto;
        // 0.20: calendário da fábrica (opcoes.parada / opcoes.intervalo valendo para o posto agora)
        if (opcoes.parada) return Object.assign(r, { situacao: "fora", motivo: "parada", proximoEm: opcoes.parada.fimMs, nomeCalendario: opcoes.parada.nome });
        if (opcoes.intervalo && p.pausar_intervalos) {
            const it = opcoes.intervalo;
            const abastecerEm = p.abastecer_min > 0 ? it.fimMs - p.abastecer_min * 60000 : null;
            if (abastecerEm && agora >= abastecerEm && agora < it.fimMs) {
                const feito = pedidos.some(x => x.estado !== "cancelado" && x.criadoEm >= abastecerEm - 1000);
                if (!feito && !aberto) return Object.assign(r, { situacao: "devido", devidoEm: abastecerEm, motivo: "abastecer", nomeCalendario: it.nome });
                return Object.assign(r, { situacao: aberto ? "em_aberto" : "fora", motivo: "intervalo", proximoEm: it.fimMs, nomeCalendario: it.nome });
            }
            return Object.assign(r, { situacao: aberto ? "em_aberto" : "fora", motivo: "intervalo", proximoEm: abastecerEm || it.fimMs, abastecer: Boolean(abastecerEm), nomeCalendario: it.nome });
        }

        if (p.modo === "horarios") {
            if (!p.horarios.length) return r;
            const marcos = pedidos.filter(x => x.origem === "programado").map(x => x.criadoEm).concat(p.puladoMs ? [p.puladoMs] : []);
            const marco = marcos.length ? Math.max(...marcos) : 0;
            const hoje = local(agora, p.fuso);
            const slots = [];
            for (let d = 0; d <= 7; d++) {
                p.horarios.forEach(h => {
                    const t = noDia(agora, minutos(h), p.fuso, d);
                    if (p.dias.includes(local(t, p.fuso).dia)) slots.push(t);
                });
            }
            // o de hoje que já passou (e não foi feito), ainda dentro da tolerância
            const hojeSlots = p.horarios.map(h => noDia(agora, minutos(h), p.fuso)).filter(() => p.dias.includes(hoje.dia));
            const devido = hojeSlots.filter(t => t <= agora && t > marco && agora - t <= TOLERANCIA_HORARIO_MS).sort((a, b) => b - a)[0];
            r.proximoEm = slots.filter(t => t > agora).sort((a, b) => a - b)[0] || null;
            if (devido) {
                r.devidoEm = devido;
                r.situacao = aberto ? "em_aberto" : "devido";
                return r;
            }
            r.situacao = aberto ? "em_aberto" : "aguardando";
            r.devidoEm = r.proximoEm;
            return r;
        }

        // 0.20: com turnos escolhidos, a janela é a dos turnos do calendário
        const j = p.turnos.length && opcoes.janelaTurnos ? opcoes.janelaTurnos(p.turnos, agora) : janela(p, agora);
        if (!j.dentro) return Object.assign(r, { situacao: "fora", proximoEm: j.proxima });
        if (aberto) return Object.assign(r, { situacao: "em_aberto" });

        let marco = null, devido = null, acaba = null;
        if (p.modo === "consumo") {
            const entregue = pedidos.filter(x => x.estado === "concluido" && x.concluidoEm >= j.inicio).sort((a, b) => b.concluidoEm - a.concluidoEm)[0];
            marco = Math.max(entregue ? entregue.concluidoEm : 0, p.puladoMs && p.puladoMs >= j.inicio ? p.puladoMs : 0) || null;
            if (marco) {
                acaba = marco + p.dura_min * 60000;
                devido = Math.max(marco, acaba - p.folga_min * 60000 - viagemS * 1000);
            }
        } else {
            const criado = pedidos.filter(x => x.estado !== "cancelado" && x.criadoEm >= j.inicio).sort((a, b) => b.criadoEm - a.criadoEm)[0];
            marco = Math.max(criado ? criado.criadoEm : 0, p.puladoMs && p.puladoMs >= j.inicio ? p.puladoMs : 0) || null;
            if (marco) devido = marco + p.intervalo_min * 60000;
        }
        if (!marco) {
            if (p.primeiro === "manual") return Object.assign(r, { situacao: "manual" });
            devido = j.inicio;                                     // primeiro do dia: assim que a janela abre
        }
        // ninguém despachando por um tempo: não acumula, é um pedido só, agora
        r.devidoEm = devido;
        r.acabaEm = acaba;
        r.proximoEm = devido;
        r.situacao = devido <= agora ? "devido" : "aguardando";
        return r;
    }

    // "Adiantou 4 vezes hoje": quanto o material parece durar de verdade (min), pelos pedidos à mão
    function sugestaoConsumo(prog, pedidosBotao, agora) {
        const p = normalizar(prog);
        if (p.modo !== "consumo" || !p.dura_min) return null;
        const desde = agora - 12 * 3600000;
        const ord = (pedidosBotao || []).filter(x => x.criadoEm >= desde && x.estado !== "cancelado").sort((a, b) => a.criadoEm - b.criadoEm);
        const adiant = [], sobras = [];
        for (let i = 1; i < ord.length; i++) {
            const ant = ord[i - 1];
            if (!ant.concluidoEm) continue;
            const dur = (ord[i].criadoEm - ant.concluidoEm) / 60000;
            if (ord[i].adiantado && dur > 0) adiant.push(dur + (p.folga_min || 0));
        }
        if (adiant.length >= 3) {
            const m = adiant.sort((a, b) => a - b)[Math.floor(adiant.length / 2)];
            const arred = Math.max(0.5, Math.round(m * 2) / 2);
            if (arred < p.dura_min - 0.4) return { vezes: adiant.length, dura: arred, texto: `adiantou ${adiant.length} vezes hoje: o material parece durar ~${String(arred).replace(".", ",")} min, não ${String(p.dura_min).replace(".", ",")}` };
        }
        // chegou e ficou parado: entregue antes da hora com folga sobrando
        ord.filter(x => x.origem === "programado" && x.acabaEm && x.concluidoEm).forEach(x => sobras.push((x.acabaEm - x.concluidoEm) / 60000));
        if (sobras.length >= 4) {
            const m = sobras.sort((a, b) => a - b)[Math.floor(sobras.length / 2)];
            if (m > Math.max(2, (p.folga_min || 0) * 2.5)) return { vezes: sobras.length, sobra: m, dura: null, texto: `os kits estão chegando ~${Math.round(m)} min antes de acabar: dá para aumentar o tempo ou diminuir a folga` };
        }
        return null;
    }

    const Nucleo = { janela, situacao, viagemEstimada, ocupacaoEstimada, viagensPorHora, sugestaoConsumo, normalizar, local, noDia, minutos, hhmm, MODOS, DIAS };
    if (typeof module === "object" && module.exports) { module.exports = Nucleo; return; }

    /* ========================================================
       DADOS (programações, registro e pessoas do posto)
       ======================================================== */

    const esc = t => (typeof escaparHtml === "function" ? escaparHtml(t) : String(t ?? ""));
    const agora = () => Date.now();
    const naNuvem = () => Boolean(raiz.Nuvem && Nuvem.emNuvem());
    const papel = () => (naNuvem() ? Nuvem.papel() : "admin");
    const podeProgramar = () => !naNuvem() || Nuvem.pode("operar");
    const chave = (posto, missao) => `${posto}|${missao}`;
    const erroDe = e => (raiz.Nuvem ? Nuvem.traduzirErro(e) : (e?.message || String(e)));

    let programas = [];          // normalizados, com posto e missao
    let eventos = [];            // [{ em, posto, missao, tipo, motivo, por_nome, pessoa, pedido }]
    let pessoas = [];            // [{ id, posto, nome, matricula }]
    let carregado = false, ultimaLeitura = 0, tempoRealOk = false;
    const tentando = {};         // chave -> até quando não tenta de novo
    let ultimaVerificacao = 0;

    function lerLocal(nome, padrao) { try { const v = JSON.parse(localStorage.getItem(nome)); return v ?? padrao; } catch (e) { return padrao; } }
    function gravarLocal(nome, valor) { try { localStorage.setItem(nome, JSON.stringify(valor)); } catch (e) { /* sem espaço */ } }

    function anotarLocal(ev) {
        const lista = lerLocal("programacaoEventos", []);
        lista.unshift(Object.assign({ em: agora(), motivo: "", por_nome: naNuvem() ? "" : "este navegador", pessoa: "" }, ev));
        gravarLocal("programacaoEventos", lista.slice(0, 300));
        eventos = lista.slice(0, 300);
    }

    async function carregar() {
        ultimaLeitura = agora();
        if (!naNuvem()) {
            programas = lerLocal("programacoesFrota", []).map(normalizar);
            eventos = lerLocal("programacaoEventos", []);
            pessoas = lerLocal("pessoasPosto", []).map(p => ({ id: p.id, posto: p.posto, nome: p.nome, matricula: p.matricula || "" }));
            carregado = true;
            avisar();
            return;
        }
        const c = Nuvem.cliente(), emp = Nuvem.empresa().id;
        const [g, e, pp] = await Promise.all([
            c.from("programacoes").select("*").eq("empresa_id", emp),
            c.from("programacao_eventos").select("*").eq("empresa_id", emp).order("em", { ascending: false }).limit(150),
            Nuvem.pode("administrar") ? c.from("pessoas_posto").select("id, posto, nome, matricula").eq("empresa_id", emp).order("nome") : Promise.resolve({ data: [] })
        ]);
        if (!g.error) programas = g.data.map(normalizar);
        if (!e.error) eventos = e.data.map(x => Object.assign({}, x, { em: Date.parse(x.em) }));
        if (!pp.error) pessoas = pp.data || [];
        carregado = true;
        avisar();
    }

    function iniciarTempoReal() {
        if (!naNuvem()) {
            addEventListener("storage", ev => { if (["programacoesFrota", "programacaoEventos", "pessoasPosto"].includes(ev.key)) carregar(); });
            return;
        }
        try {
            const emp = Nuvem.empresa().id;
            Nuvem.cliente().channel(`programacao-${emp}`)
                .on("postgres_changes", { event: "*", schema: "public", table: "programacoes", filter: `empresa_id=eq.${emp}` }, () => carregar())
                .on("postgres_changes", { event: "INSERT", schema: "public", table: "programacao_eventos", filter: `empresa_id=eq.${emp}` }, ev => {
                    if (ev.new) { eventos.unshift(Object.assign({}, ev.new, { em: Date.parse(ev.new.em) })); eventos = eventos.slice(0, 150); avisar(); }
                })
                .subscribe(s => { tempoRealOk = s === "SUBSCRIBED"; });
        } catch (e) { tempoRealOk = false; }
    }

    const ouvintes = new Set();
    function avisar() {
        ouvintes.forEach(f => { try { f(); } catch (e) { console.error(e); } });
        if (document.getElementById("programacao")?.classList.contains("ativa")) desenhar();
        if (typeof TelaPosto !== "undefined") TelaPosto.desenhar();
    }

    const programa = (posto, missao) => programas.find(p => p.posto === posto && p.missao === missao) || null;
    function pedidosDoBotao(posto, missao) {
        return (typeof Despacho !== "undefined" ? Despacho.lista() : []).filter(p => p.posto === posto && p.missao === missao);
    }
    // 0.20: a viagem estimada usa a velocidade do primeiro modelo que atende o botão
    function agvDoBotao(missao, posto) {
        if (typeof Modelos === "undefined" || typeof Despacho === "undefined") return null;
        const ps = (Despacho.postos() || []).filter(p => !posto || p.id === posto);
        for (const p of ps) {
            const b = (p.botoes || []).find(x => x.missao === missao);
            const id = b && (b.modelos || [])[0];
            const m = id && Modelos.porId(id);
            if (m) return { perfil: Modelos.perfil(m) };
        }
        return null;
    }
    function viagemPadrao(missao, posto) {
        try {
            const m = typeof obterMissaoPorId === "function" ? obterMissaoPorId(missao) : null;
            const r = m && typeof Despachante !== "undefined" ? Despachante.prever(plantaPublicada(), m, null, null, agvDoBotao(missao, posto)) : null;
            if (r && r.ok && r.tempo > 0) return Math.round(r.tempo + 60);   // + a ida de um AGV livre até o começo
        } catch (e) { /* sem planta */ }
        return VIAGEM_PADRAO_S;
    }
    // 0.20: o que o calendário da fábrica diz para o posto agora
    function opcoesCalendario(posto, extra = {}) {
        if (typeof Calendario === "undefined" || !Calendario.carregado || !Calendario.carregado()) return extra;
        const t = agora();
        const parada = Calendario.paradaDoPosto(posto, t);
        return Object.assign({
            parada: parada && (parada.acao === "PROGRAMACAO" || parada.acao === "BERCO") ? parada : null,
            intervalo: Calendario.intervaloDoPosto(posto, t),
            janelaTurnos: (ids, ms) => Calendario.janelaDosTurnos(ids, ms)
        }, extra);
    }
    function situacaoDe(posto, missao) {
        const p = programa(posto, missao);
        if (!p) return null;
        return Object.assign(situacao(p, pedidosDoBotao(posto, missao), agora(), opcoesCalendario(posto, { viagemPadraoS: viagemPadrao(missao, posto) })), { programa: p });
    }
    // Quem pode pausar/retomar/pular este posto
    function podePausar(posto) {
        if (!naNuvem()) return true;
        if (Nuvem.pode("operar") || Nuvem.papel() === "lider") return true;
        return Nuvem.papel() === "posto" && (posto.usuarios || []).includes(Nuvem.usuario()?.id);
    }
    const pedePin = posto => naNuvem() && Nuvem.papel() === "posto" && Boolean(posto.pinPessoal);

    async function salvar(posto, missao, cfg) {
        if (!podeProgramar()) return { ok: false, erro: "Só operador e administrador programam pedidos." };
        if (naNuvem()) {
            const { error } = await Nuvem.cliente().rpc("salvar_programacao", { p_empresa: Nuvem.empresa().id, p_posto: posto, p_missao: missao, p_cfg: cfg });
            if (error) return { ok: false, erro: erroDe(error) };
            await carregar();
            return { ok: true };
        }
        const lista = lerLocal("programacoesFrota", []);
        const i = lista.findIndex(p => p.posto === posto && p.missao === missao);
        const antes = i >= 0 ? lista[i] : null;
        const novo = Object.assign({}, antes || {}, cfg, { posto, missao, atualizado_em: new Date().toISOString() });
        if (i >= 0) lista[i] = novo; else lista.push(novo);
        gravarLocal("programacoesFrota", lista);
        anotarLocal({ posto, missao, tipo: !antes ? "criada" : cfg.ativo === false ? "desligada" : "editada" });
        await carregar();
        return { ok: true };
    }

    async function pausar(posto, missao, pausarSim, motivo, pin) {
        if (naNuvem()) {
            const { data, error } = await Nuvem.cliente().rpc("pausar_programacao", { p_empresa: Nuvem.empresa().id, p_posto: posto, p_missao: missao, p_pausar: pausarSim, p_motivo: motivo || "", p_pin: pin ?? null });
            if (error) return { ok: false, erro: erroDe(error) };
            if (data?.erro) return { ok: false, erro: data.erro };
            await carregar();
            return { ok: true, pessoa: data?.pessoa || "" };
        }
        const lista = lerLocal("programacoesFrota", []);
        let pessoa = "";
        const posto0 = (typeof Despacho !== "undefined" ? Despacho.postos() : []).find(p => p.id === posto);
        if (posto0?.pinPessoal && pin != null) {
            const ach = lerLocal("pessoasPosto", []).find(x => x.posto === posto && x.pin === String(pin));
            if (!ach) return { ok: false, erro: "PIN não confere." };
            pessoa = ach.nome + (ach.matricula ? ` (matr. ${ach.matricula})` : "");
        }
        lista.filter(p => p.posto === posto && (missao == null || p.missao === missao) && p.ativo !== false && Boolean(p.pausado) !== pausarSim).forEach(p => {
            Object.assign(p, { pausado: pausarSim, pausado_em: pausarSim ? new Date().toISOString() : null, pausado_por_nome: pausarSim ? (pessoa || "este navegador") : "", pausa_motivo: pausarSim ? (motivo || "") : "" });
            anotarLocal({ posto, missao: p.missao, tipo: pausarSim ? "pausada" : "retomada", motivo: pausarSim ? (motivo || "") : "", pessoa });
        });
        gravarLocal("programacoesFrota", lista);
        await carregar();
        return { ok: true, pessoa };
    }

    async function pular(posto, missao, pin) {
        if (naNuvem()) {
            const { data, error } = await Nuvem.cliente().rpc("pular_programacao", { p_empresa: Nuvem.empresa().id, p_posto: posto, p_missao: missao, p_pin: pin ?? null });
            if (error) return { ok: false, erro: erroDe(error) };
            if (data?.erro) return { ok: false, erro: data.erro };
            await carregar();
            return { ok: true };
        }
        const lista = lerLocal("programacoesFrota", []);
        const p = lista.find(x => x.posto === posto && x.missao === missao);
        if (!p) return { ok: false, erro: "Este botão não tem programação." };
        let pessoa = "";
        const posto0 = (typeof Despacho !== "undefined" ? Despacho.postos() : []).find(x => x.id === posto);
        if (posto0?.pinPessoal && pin != null) {
            const ach = lerLocal("pessoasPosto", []).find(x => x.posto === posto && x.pin === String(pin));
            if (!ach) return { ok: false, erro: "PIN não confere." };
            pessoa = ach.nome + (ach.matricula ? ` (matr. ${ach.matricula})` : "");
        }
        p.pular_proximo = true;
        gravarLocal("programacoesFrota", lista);
        anotarLocal({ posto, missao, tipo: "pulada", pessoa });
        await carregar();
        return { ok: true };
    }

    // Sem nuvem: o "pular" que o banco faz dentro de criar_pedido_programado
    function consumirPuloLocal(posto, missao) {
        const lista = lerLocal("programacoesFrota", []);
        const p = lista.find(x => x.posto === posto && x.missao === missao);
        if (!p || !p.pular_proximo) return false;
        p.pular_proximo = false;
        p.pulado_em = new Date().toISOString();
        gravarLocal("programacoesFrota", lista);
        anotarLocal({ posto, missao, tipo: "pulou", por_nome: "Programação" });
        programas = lista.map(normalizar);
        return true;
    }
    // Sem nuvem: pedido à mão num botão programado (Despacho.criar chama)
    function aoPedidoManual(posto, missao, pedidoId) {
        const p = programa(posto, missao);
        if (!p || !p.ativo || p.pausado) return false;
        if (!naNuvem()) anotarLocal({ posto, missao, tipo: "adiantada", pedido: pedidoId });
        return true;
    }

    /* ---------------- pessoas do posto (PIN pessoal) ---------------- */

    async function salvarPessoa(posto, dados) {
        if (naNuvem()) {
            const { error } = await Nuvem.cliente().rpc("salvar_pessoa_posto", { p_empresa: Nuvem.empresa().id, p_posto: posto, p_id: dados.id ?? null,
                p_nome: dados.nome, p_matricula: dados.matricula || "", p_pin: dados.pin || null });
            if (error) return { ok: false, erro: erroDe(error) };
            await carregar();
            return { ok: true };
        }
        const lista = lerLocal("pessoasPosto", []);
        if (dados.pin && !/^[0-9]{4,8}$/.test(dados.pin)) return { ok: false, erro: "O PIN tem de 4 a 8 números." };
        if (dados.pin && lista.some(x => x.posto === posto && x.pin === dados.pin && x.id !== dados.id)) return { ok: false, erro: "Outra pessoa deste posto já usa esse PIN." };
        if (dados.id) {
            const x = lista.find(y => y.id === dados.id);
            if (x) Object.assign(x, { nome: dados.nome, matricula: dados.matricula || "" }, dados.pin ? { pin: dados.pin } : {});
        } else {
            if (!dados.pin) return { ok: false, erro: "Defina o PIN da pessoa." };
            lista.push({ id: Date.now(), posto, nome: dados.nome, matricula: dados.matricula || "", pin: dados.pin });
        }
        gravarLocal("pessoasPosto", lista);
        await carregar();
        return { ok: true };
    }
    async function removerPessoa(id) {
        if (naNuvem()) {
            const { error } = await Nuvem.cliente().rpc("remover_pessoa_posto", { p_empresa: Nuvem.empresa().id, p_id: id });
            if (error) return { ok: false, erro: erroDe(error) };
        } else gravarLocal("pessoasPosto", lerLocal("pessoasPosto", []).filter(x => x.id !== id));
        await carregar();
        return { ok: true };
    }

    // Parte do cartão do posto (Operação › Postos): ligar o PIN pessoal e as pessoas
    function htmlPessoas(posto, podeEditar) {
        if (!posto || !posto.id) return "";
        const delas = pessoas.filter(p => p.posto === posto.id);
        return `<div class="campo posto-pessoas">
            <label class="rotina-check"><input type="checkbox" data-campo="pinPessoal" ${posto.pinPessoal ? "checked" : ""} ${podeEditar ? "" : "disabled"}>
                <span>Pedir o PIN pessoal para pausar e pular a programação no tablet <small class="suave">(registra o nome da pessoa)</small></span></label>
            ${posto.pinPessoal || delas.length ? `<div class="pessoas-lista">
                ${delas.map(p => `<div class="pessoa-linha"><b>${esc(p.nome)}</b><span class="suave">${p.matricula ? "matr. " + esc(p.matricula) : ""}</span>
                    ${podeEditar ? `<button type="button" class="btn btn-mini" data-pessoas="pin" data-id="${esc(p.id)}" data-posto="${esc(posto.id)}">Trocar PIN</button>
                    <button type="button" class="btn btn-mini btn-perigo-suave" data-pessoas="tirar" data-id="${esc(p.id)}">Tirar</button>` : ""}</div>`).join("") || `<p class="suave">Ninguém cadastrado. Sem pessoas, o tablet não consegue pausar com o PIN ligado.</p>`}
                ${podeEditar ? `<button type="button" class="btn btn-mini" data-pessoas="nova" data-posto="${esc(posto.id)}">+ Pessoa</button>` : ""}
            </div>` : ""}
        </div>`;
    }
    document.addEventListener("click", async e => {
        const b = e.target.closest("[data-pessoas]");
        if (!b) return;
        const acao = b.dataset.pessoas;
        if (acao === "tirar") {
            const p = pessoas.find(x => String(x.id) === b.dataset.id);
            if (!await ui.confirmar({ titulo: "Tirar pessoa do posto", texto: `Tirar ${p?.nome || "esta pessoa"}? O PIN dela deixa de valer.`, confirmar: "Tirar", perigo: true })) return;
            const r = await removerPessoa(Number(b.dataset.id));
            if (!r.ok) ui.aviso(r.erro, "erro");
            if (typeof Postos !== "undefined") Postos.desenhar();
            return;
        }
        const existente = acao === "pin" ? pessoas.find(x => String(x.id) === b.dataset.id) : null;
        const v = await ui.formulario({
            titulo: existente ? `PIN de ${existente.nome}` : `Pessoa do posto ${b.dataset.posto}`,
            texto: "Não é uma conta no Eciton: só o nome, a matrícula e um PIN de 4 a 8 números, que a pessoa digita no tablet para pausar ou pular.",
            confirmar: "Salvar",
            campos: existente ? [{ nome: "pin", rotulo: "PIN novo", tipo: "password", obrigatorio: true, max: 8, largo: true }]
                : [{ nome: "nome", rotulo: "Nome", obrigatorio: true, max: 60 }, { nome: "matricula", rotulo: "Matrícula (opcional)", max: 20 },
                   { nome: "pin", rotulo: "PIN", tipo: "password", obrigatorio: true, max: 8, largo: true }]
        });
        if (!v) return;
        const r = await salvarPessoa(b.dataset.posto, existente ? { id: existente.id, nome: existente.nome, matricula: existente.matricula, pin: v.pin } : v);
        ui.aviso(r.ok ? "Pessoa salva." : r.erro, r.ok ? "sucesso" : "erro");
        if (typeof Postos !== "undefined") Postos.desenhar();
    });

    /* ========================================================
       MOTOR (só a aba que despacha)
       ======================================================== */

    async function verificar() {
        if (agora() - ultimaVerificacao < 2000) return;
        ultimaVerificacao = agora();
        if (!carregado) await carregar();
        if (naNuvem() && agora() - ultimaLeitura > (tempoRealOk ? 30000 : 5000)) await carregar();
        const postos = typeof Despacho !== "undefined" ? Despacho.postos() : [];
        for (const prog of programas) {
            const posto = postos.find(p => p.id === prog.posto);
            if (!posto || !(posto.botoes || []).some(b => b.missao === prog.missao)) continue;   // botão tirado do posto
            const k = chave(prog.posto, prog.missao);
            if (tentando[k] > agora()) continue;
            const s = situacao(prog, pedidosDoBotao(prog.posto, prog.missao), agora(), opcoesCalendario(prog.posto, { viagemPadraoS: viagemPadrao(prog.missao, prog.posto) }));
            if (s.situacao !== "devido") continue;
            tentando[k] = agora() + 8000;
            if (!naNuvem() && consumirPuloLocal(prog.posto, prog.missao)) { avisar(); continue; }
            const r = await Despacho.criarProgramado({ posto: prog.posto, missao: prog.missao, devidoEm: s.devidoEm, acabaEm: s.acabaEm });
            if (r.pulou) await carregar();
            if (r.ok && !naNuvem()) anotarLocal({ posto: prog.posto, missao: prog.missao, tipo: "pedido", pedido: r.pedido?.id, por_nome: "Programação" });
        }
    }

    /* ========================================================
       TEXTOS
       ======================================================== */

    const hora = ms => (ms ? new Date(ms).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "");
    function emQuanto(ms) {
        const s = Math.round((ms - agora()) / 1000);
        if (s <= 30) return "agora";
        if (s < 60) return `${s} s`;
        if (s < 3600) return `${Math.round(s / 60)} min`;
        return `às ${hora(ms)}`;
    }
    const num = v => String(v).replace(".", ",");
    function comoPede(p) {
        if (!p) return "Não pede sozinho";
        if (!p.ativo) return "Desligada";
        if (p.modo === "consumo") return `Pelo consumo · dura ${num(p.dura_min)} min${p.folga_min ? `, folga ${num(p.folga_min)} min` : ""}`;
        if (p.modo === "intervalo") return `A cada ${num(p.intervalo_min)} min`;
        return `Às ${p.horarios.join(", ")}`;
    }
    function janelaTexto(p) {
        if (p.turnos?.length && typeof Calendario !== "undefined") {
            const nomes = Calendario.atual().turnos.filter(t => p.turnos.includes(t.id)).map(t => t.nome);
            if (nomes.length) return `${nomes.join(" e ")}${p.pausar_intervalos ? " · pausa nos intervalos" : ""}${p.abastecer_min ? ` · abastece ${num(p.abastecer_min)} min antes da volta` : ""}`;
        }
        const dias = [1, 2, 3, 4, 5, 6, 0].filter(d => p.dias.includes(d)).map(d => DIAS[d]);
        const diasTxt = dias.length === 7 ? "todos os dias" : dias.join(", ");
        return p.modo === "horarios" ? diasTxt : `${p.inicio} às ${p.fim} · ${diasTxt}`;
    }
    // Uma linha curta (tablet e tela)
    function textoAgora(s) {
        if (!s) return "";
        const p = s.programa;
        switch (s.situacao) {
            case "desligado": return "Programação desligada";
            case "pausado": return `Pausado${p.pausa_motivo ? " · " + p.pausa_motivo : ""}${p.pausado_por_nome ? ` · por ${p.pausado_por_nome}` : ""}${p.pausadoMs ? " às " + hora(p.pausadoMs) : ""}`;
            case "fora":
                if (s.motivo === "parada") return `Parada planejada${s.nomeCalendario ? " · " + s.nomeCalendario : ""}${s.proximoEm ? " · volta às " + hora(s.proximoEm) : ""}`;
                if (s.motivo === "intervalo") return `${s.nomeCalendario || "Intervalo"}${s.proximoEm ? (s.abastecer ? " · abastece às " : " · volta às ") + hora(s.proximoEm) : ""}`;
                return s.proximoEm ? `Fora do horário · volta ${new Date(s.proximoEm).toDateString() === new Date().toDateString() ? "às " + hora(s.proximoEm) : DIAS[new Date(s.proximoEm).getDay()] + " às " + hora(s.proximoEm)}` : "Fora do horário";
            case "manual": return "Começa depois do primeiro pedido à mão";
            case "em_aberto": return "Pedido a caminho";
            case "devido": return s.pular ? "Pulando este" : s.motivo === "abastecer" ? `Abastecendo antes da volta do ${s.nomeCalendario || "intervalo"}` : "Pedindo agora";
            default: return s.devidoEm ? `Próximo pedido ${emQuanto(s.devidoEm) === "agora" ? "agora" : "em " + emQuanto(s.devidoEm)}${s.pular ? " (vai ser pulado)" : ""}` : "";
        }
    }

    /* ========================================================
       TABLET (TelaPosto chama)
       ======================================================== */

    // Linha embaixo do botão do tablet (sem pedido em aberto)
    function htmlTablet(posto, b, i) {
        const s = situacaoDe(posto.id, b.missao);
        if (!s || s.situacao === "desligado") return "";
        const pode = podePausar(posto);
        const acoes = [];
        if (pode && s.situacao === "pausado") acoes.push(`<button type="button" class="btn btn-mini" data-prog-tablet="retomar" data-posto-id="${esc(posto.id)}" data-botao="${i}">Retomar</button>`);
        else if (pode) {
            if (["aguardando", "devido"].includes(s.situacao) && !s.pular) acoes.push(`<button type="button" class="btn btn-mini" data-prog-tablet="pular" data-posto-id="${esc(posto.id)}" data-botao="${i}">Pular este</button>`);
            acoes.push(`<button type="button" class="btn btn-mini" data-prog-tablet="pausar" data-posto-id="${esc(posto.id)}" data-botao="${i}">Pausar</button>`);
        }
        return `<div class="posto-auto ${s.situacao}"><span class="posto-auto-txt"><b>automático</b> · ${esc(textoAgora(s))}</span>${acoes.length ? `<span class="posto-auto-acoes">${acoes.join("")}</span>` : ""}</div>`;
    }

    const MOTIVOS = [["linha parada", "Linha parada"], ["troca de ferramenta", "Troca de ferramenta"], ["sem operador", "Sem operador"], ["outro", "Outro"]];
    async function acaoTablet(botao) {
        const posto = (Despacho.postos() || []).find(p => p.id === botao.dataset.postoId);
        const b = posto?.botoes?.[Number(botao.dataset.botao)];
        if (!posto || !b) return;
        const acao = botao.dataset.progTablet;
        let motivo = "";
        if (acao === "pausar") {
            const v = await ui.formulario({ titulo: `Pausar · ${b.rotulo}`, texto: "O pedido automático para até alguém retomar. Pedir à mão continua funcionando.", confirmar: "Pausar",
                campos: [{ nome: "motivo", rotulo: "Por quê?", tipo: "radio", opcoes: MOTIVOS, valor: "linha parada" }] });
            if (!v) return;
            motivo = v.motivo;
        }
        const executar = async pin => {
            const r = acao === "pular" ? await pular(posto.id, b.missao, pin)
                : await pausar(posto.id, b.missao, acao === "pausar", motivo, pin);
            if (r.ok) ui.aviso(acao === "pular" ? `${b.rotulo}: o próximo pedido automático não vai sair.` : acao === "pausar" ? `${b.rotulo}: automático pausado.` : `${b.rotulo}: automático de volta.`, "sucesso");
            else ui.aviso(r.erro, "erro");
            if (typeof TelaPosto !== "undefined") TelaPosto.desenhar();
        };
        if (pedePin(posto) && typeof TelaPosto !== "undefined" && TelaPosto.pedirPin) TelaPosto.pedirPin(`${acao === "pular" ? "Pular" : acao === "pausar" ? "Pausar" : "Retomar"} · ${b.rotulo}`, "Digite o seu PIN.", executar);
        else executar(null);
    }
    document.addEventListener("click", e => {
        const b = e.target.closest("[data-prog-tablet]");
        if (b) acaoTablet(b);
    });

    /* ========================================================
       TELA OPERAÇÃO › PROGRAMAÇÃO
       ======================================================== */

    let editando = null;         // "posto|missao" em edição
    let rascunho = null;         // valores do formulário
    let laco = null;

    function capacidade() {
        const postos = Despacho.postos();
        let viagensH = 0, ocupS = [], n = 0;
        programas.forEach(p => {
            if (!p.ativo || p.pausado) return;
            if (!postos.some(x => x.id === p.posto && (x.botoes || []).some(b => b.missao === p.missao))) return;
            const v = viagensPorHora(p);
            if (!v) return;
            n++;
            viagensH += v;
            ocupS.push([v, ocupacaoEstimada(pedidosDoBotao(p.posto, p.missao), viagemPadrao(p.missao, p.posto))]);
        });
        const frota = Object.values(typeof agvs === "object" ? agvs : {}).filter(a => !(typeof Manutencao !== "undefined" && Manutencao.ativa(a)));
        const ocupMedia = ocupS.length ? ocupS.reduce((s, [v, o]) => s + v * o, 0) / ocupS.reduce((s, [v]) => s + v, 0) : null;
        const capH = ocupMedia ? frota.length * 3600 * 0.75 / ocupMedia : null;
        return { n, viagensH, frota: frota.length, ocupMedia, capH, uso: capH ? viagensH / capH : null };
    }

    function htmlCapacidade() {
        const c = capacidade();
        if (!c.n) return `<section class="card prog-capacidade"><div><h2>Capacidade</h2><p class="suave">Nenhum botão pede sozinho ainda. Escolha um botão abaixo e clique em <b>Programar</b>.</p></div></section>`;
        const pct = c.uso != null ? Math.round(c.uso * 100) : null;
        const cor = pct == null ? "" : pct > 100 ? "vermelho" : pct > 75 ? "ambar" : "verde";
        return `<section class="card prog-capacidade">
            <div><h2>Capacidade</h2>
            <p class="prog-cap-linha"><b>${c.n}</b> programaç${c.n === 1 ? "ão ativa" : "ões ativas"} · <b>~${Math.round(c.viagensH)}</b> viagens/h programadas · ${c.capH != null ? `a frota faz <b>~${Math.round(c.capH)}</b>/h` : "sem AGVs na frota"}</p></div>
            ${pct != null ? `<div class="prog-cap-barra ${cor}" role="img" aria-label="Frota ocupada ${pct}% pela programação"><i style="width:${Math.min(100, pct)}%"></i><span>${pct}% da frota</span></div>` : ""}
            ${pct != null && pct > 75 ? `<p class="prog-cap-aviso">${pct > 100 ? "A programação pede mais viagens do que a frota dá conta: os pedidos vão atrasar." : "Acima de 75%: sobra pouco para os pedidos à mão e para os atrasos."} Conta com ${c.frota} AGV${c.frota === 1 ? "" : "s"} fora de manutenção, ~${Math.round(c.ocupMedia / 60 * 10) / 10} min ocupado por viagem e 75% de ocupação máxima.</p>` : ""}
        </section>`;
    }

    function diasHtml(dias, pode) {
        return `<div class="prog-dias" role="group" aria-label="Dias da semana">${[1, 2, 3, 4, 5, 6, 0].map(d => `<label class="prog-dia"><input type="checkbox" data-prog-campo="dia" value="${d}" ${dias.includes(d) ? "checked" : ""} ${pode ? "" : "disabled"}><span>${DIAS[d].slice(0, 3)}</span></label>`).join("")}</div>`;
    }

    function htmlEditor(posto, b) {
        const p = rascunho;
        const turnosCal = typeof Calendario !== "undefined" ? Calendario.atual().turnos : [];
        const temIntervalos = typeof Calendario !== "undefined" && Calendario.atual().intervalos.some(i => !i.postos.length || i.postos.includes(posto.id));
        const pode = podeProgramar();
        const campo = (nome, rot, valor, extra = "") => `<label class="campo"><span>${rot}</span><input type="number" data-prog-campo="${nome}" value="${esc(valor ?? "")}" ${extra} ${pode ? "" : "disabled"}></label>`;
        return `<div class="prog-editor" data-prog-editor="${esc(posto.id)}|${esc(b.missao)}">
            <fieldset class="prog-modos"><legend>Como pedir</legend>
                ${Object.entries(MODOS).map(([v, t]) => `<label class="prog-modo"><input type="radio" name="progModo" data-prog-campo="modo" value="${v}" ${p.modo === v ? "checked" : ""} ${pode ? "" : "disabled"}><span><b>${t}</b><small class="suave">${v === "consumo" ? "pede de novo para chegar antes do material acabar" : v === "intervalo" ? "conta do último pedido deste botão" : "nas horas que você escolher"}</small></span></label>`).join("")}
            </fieldset>
            <div class="prog-campos">
                ${p.modo === "consumo" ? campo("dura_min", "O material dura (min)", p.dura_min, 'min="0.5" step="0.5"') + campo("folga_min", "Chegar com folga de (min)", p.folga_min, 'min="0" step="0.5"') : ""}
                ${p.modo === "intervalo" ? campo("intervalo_min", "A cada (min)", p.intervalo_min, 'min="1" step="1"') : ""}
                ${p.modo === "horarios" ? `<div class="campo prog-horarios"><span>Horários</span><div>${p.horarios.map((h, i) => `<span class="pilula prog-hora">${esc(h)}${pode ? `<button type="button" data-prog="tirarHora" data-i="${i}" aria-label="Tirar ${esc(h)}">×</button>` : ""}</span>`).join("")}
                    ${pode ? `<input type="time" data-prog-campo="novaHora" aria-label="Novo horário"><button type="button" class="btn btn-mini" data-prog="maisHora">+ horário</button>` : ""}</div></div>` : ""}
                ${turnosCal.length ? `<div class="campo prog-turnos-campo"><span>Quando vale</span><div class="rotina-turnos">${turnosCal.map((t, k) =>
                    `<label class="rotina-turno ${p.turnos.includes(t.id) ? "ativo" : ""}" style="--cor:${Calendario.CORES_TURNO[k % Calendario.CORES_TURNO.length]}"><input type="checkbox" data-prog-campo="turno" value="${esc(t.id)}" ${p.turnos.includes(t.id) ? "checked" : ""} ${pode ? "" : "disabled"}> ${esc(t.nome)} <small>${esc(t.inicio)}–${esc(t.fim)}</small></label>`).join("")}</div>
                    ${p.turnos.length ? "" : `<small class="suave">Nenhum turno marcado: vale o horário abaixo.</small>`}</div>` : ""}
                ${p.modo !== "horarios" && !p.turnos.length ? `<label class="campo"><span>Das</span><input type="time" data-prog-campo="inicio" value="${esc(p.inicio)}" ${pode ? "" : "disabled"}></label><label class="campo"><span>Às</span><input type="time" data-prog-campo="fim" value="${esc(p.fim)}" ${pode ? "" : "disabled"}></label>` : ""}
                ${!p.turnos.length ? `<div class="campo prog-dias-campo"><span>Dias</span>${diasHtml(p.dias, pode)}</div>` : ""}
                ${temIntervalos ? `<label class="campo rotina-check"><input type="checkbox" data-prog-campo="pausar_intervalos" ${p.pausar_intervalos ? "checked" : ""} ${pode ? "" : "disabled"}><span>Pausar nos intervalos do calendário</span></label>
                    ${p.pausar_intervalos ? campo("abastecer_min", "Abastecer antes da volta (min)", p.abastecer_min || "", 'min="0" max="60" step="1" placeholder="não"') : ""}` : ""}
                ${p.modo !== "horarios" ? `<label class="campo"><span>Primeiro pedido do dia</span><select data-prog-campo="primeiro" ${pode ? "" : "disabled"}><option value="janela" ${p.primeiro === "janela" ? "selected" : ""}>Assim que o horário começa</option><option value="manual" ${p.primeiro === "manual" ? "selected" : ""}>Só depois que alguém pedir à mão</option></select></label>` : ""}
            </div>
            <p class="prog-previa" id="progPrevia">${esc(previa(posto, b))}</p>
            <div class="prog-editor-acoes">
                ${pode ? `<button type="button" class="btn btn-primario" data-prog="salvar">Salvar</button>` : ""}
                <button type="button" class="btn" data-prog="fechar">${pode ? "Cancelar" : "Fechar"}</button>
                ${pode && programa(posto.id, b.missao)?.ativo ? `<button type="button" class="btn btn-perigo-suave" data-prog="desligar">Desligar</button>` : ""}
            </div>
        </div>`;
    }

    // "Com a viagem de hoje (~2 min), pede 2 min depois de cada entrega: ~12 viagens/h. A frota fica em 85%."
    function previa(posto, b) {
        const p = normalizar(rascunho);
        const viagem = viagemEstimada(pedidosDoBotao(posto.id, b.missao), viagemPadrao(b.missao, posto.id));
        const vh = viagensPorHora(p);
        let txt = "";
        if (p.modo === "consumo") {
            if (!(p.dura_min > 0)) return "Diga quanto tempo o material dura.";
            const antes = Math.max(0, p.dura_min - p.folga_min - viagem / 60);
            txt = `Com a viagem de hoje (~${num(Math.round(viagem / 6) / 10)} min), o Eciton pede ${antes < 0.25 ? "logo depois de cada entrega" : `${num(Math.round(antes * 10) / 10)} min depois de cada entrega`}: ~${Math.round(vh)} viagens/h.`;
            if (p.dura_min - p.folga_min < viagem / 60) txt += " O material dura menos que a viagem: o próximo vai chegar atrasado.";
        } else if (p.modo === "intervalo") {
            if (!(p.intervalo_min > 0)) return "Diga de quanto em quanto tempo pedir.";
            txt = `Um pedido a cada ${num(p.intervalo_min)} min: ~${Math.round(vh * 10) / 10} viagens/h.`;
        } else {
            if (!p.horarios.length) return "Coloque pelo menos um horário.";
            txt = `${p.horarios.length} pedido${p.horarios.length === 1 ? "" : "s"} por dia (${p.horarios.join(", ")}). Horário perdido há mais de 10 min é pulado, não acumula.`;
        }
        // capacidade com esta programação no lugar da atual
        const antiga = programa(posto.id, b.missao);
        const salvo = programas;
        programas = programas.filter(x => x !== antiga).concat([Object.assign({}, p, { posto: posto.id, missao: b.missao, ativo: true, pausado: false })]);
        const c = capacidade();
        programas = salvo;
        if (c.uso != null) txt += ` Com as outras programações, a frota fica em ${Math.round(c.uso * 100)}%${c.uso > 0.75 ? " ⚠" : ""}.`;
        return txt;
    }

    function lerEditor(el) {
        const r = Object.assign({}, rascunho);
        el.querySelectorAll("[data-prog-campo]").forEach(c => {
            const k = c.dataset.progCampo;
            if (k === "modo") { if (c.checked) r.modo = c.value; return; }
            if (k === "dia" || k === "novaHora" || k === "turno") return;
            if (k === "pausar_intervalos") { r[k] = c.checked; return; }
            if (["dura_min", "folga_min", "intervalo_min", "abastecer_min"].includes(k)) r[k] = c.value === "" ? null : Number(c.value);
            else r[k] = c.value;
        });
        const caixasDias = [...el.querySelectorAll('[data-prog-campo="dia"]')];
        if (caixasDias.length) r.dias = caixasDias.filter(c => c.checked).map(c => Number(c.value));
        const caixasTurnos = [...el.querySelectorAll('[data-prog-campo="turno"]')];
        if (caixasTurnos.length) r.turnos = caixasTurnos.filter(c => c.checked).map(c => c.value);
        return r;
    }

    function htmlPosto(posto) {
        const botoes = (posto.botoes || []).filter(b => b.missao);
        if (!botoes.length) return "";
        const linhas = botoes.map(b => {
            const p = programa(posto.id, b.missao);
            const s = p ? situacaoDe(posto.id, b.missao) : null;
            const k = chave(posto.id, b.missao);
            const sug = p && p.ativo ? sugestaoConsumo(p, pedidosDoBotao(posto.id, b.missao), agora()) : null;
            const acoes = [];
            if (podeProgramar()) acoes.push(`<button type="button" class="btn btn-mini" data-prog="editar" data-k="${esc(k)}">${p ? "Editar" : "Programar"}</button>`);
            if (p && p.ativo && podePausar(posto)) {
                if (p.pausado) acoes.push(`<button type="button" class="btn btn-mini btn-primario" data-prog="retomar" data-k="${esc(k)}">Retomar</button>`);
                else acoes.push(`<button type="button" class="btn btn-mini" data-prog="pausar" data-k="${esc(k)}">Pausar</button>`);
                if (s && ["aguardando", "devido"].includes(s.situacao) && !s.pular) acoes.push(`<button type="button" class="btn btn-mini" data-prog="pular" data-k="${esc(k)}">Pular o próximo</button>`);
            }
            return `<div class="prog-linha ${p && p.ativo ? (p.pausado ? "pausada" : "ativa") : "sem"}" data-k="${esc(k)}">
                <div class="prog-botao"><b>${esc(b.rotulo)}</b><span class="suave">${esc(b.missao)} · ${esc(Despacho.nomeMissao(b.missao))}</span></div>
                <div class="prog-como">${esc(comoPede(p))}${p && p.ativo ? `<small class="suave">${esc(janelaTexto(p))}</small>` : ""}</div>
                <div class="prog-agora">${p && p.ativo ? `<span class="pilula ${s.situacao === "pausado" ? "ambar" : s.situacao === "fora" || s.situacao === "manual" ? "" : "verde"}">${esc(textoAgora(s))}</span>` : `<span class="suave">—</span>`}</div>
                <div class="prog-acoes">${acoes.join("")}</div>
                ${sug ? `<div class="prog-sugestao">${esc(sug.texto)}.${sug.dura && podeProgramar() ? ` <button type="button" class="btn-link" data-prog="ajustar" data-k="${esc(k)}" data-dura="${sug.dura}">Ajustar para ${num(sug.dura)} min</button>` : ""}</div>` : ""}
                ${editando === k ? htmlEditor(posto, b) : ""}
            </div>`;
        }).join("");
        return `<section class="card prog-posto"><div class="card-barra"><div><h2>${esc(posto.nome)} <span class="suave">${esc(posto.id)}</span></h2></div></div>
            <div class="prog-linhas">${linhas}</div></section>`;
    }

    const NOMES_EVENTO = { criada: "programou", editada: "mudou a programação", desligada: "desligou", pausada: "pausou", retomada: "retomou",
        pulada: "pediu para pular o próximo", pulou: "pulou um pedido", adiantada: "pediu à mão antes da hora", pedido: "criou o pedido" };
    function htmlRegistro() {
        const itens = eventos.slice(0, 40);
        return `<section class="card prog-registro"><div class="card-barra"><div><h2>Registro</h2><div class="card-sub">Quem programou, pausou, retomou, pulou ou adiantou</div></div></div>
            ${itens.length ? `<ul class="prog-eventos">${itens.map(ev => `<li><span class="mono suave">${esc(new Date(ev.em).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }))}</span>
                <span><b>${esc(ev.pessoa || ev.por_nome || "—")}</b> ${esc(NOMES_EVENTO[ev.tipo] || ev.tipo)} · ${esc(ev.posto)} · ${esc(ev.missao)}${ev.motivo ? ` (${esc(ev.motivo)})` : ""}${ev.pedido ? ` <span class="suave">#${esc(ev.pedido)}</span>` : ""}</span></li>`).join("")}</ul>`
                : `<p class="suave">Nada ainda.</p>`}</section>`;
    }

    function desenhar() {
        const caixa = document.getElementById("programacaoConteudo");
        if (!caixa || !document.getElementById("programacao")?.classList.contains("ativa")) return;
        const postos = Despacho.postos();
        const corpo = postos.map(htmlPosto).filter(Boolean).join("");
        const html = htmlCapacidade() + (corpo || `<p class="suave rotina-vazio">Nenhum posto com botões. Cadastre os postos e os botões em Operação › Postos.</p>`) +
            (Despacho.lider().eu || Despacho.lider().nome ? "" : `<p class="alerta-faixa">Ninguém está despachando agora: a programação só cria pedidos enquanto alguma tela ou tablet estiver despachando.</p>`) + htmlRegistro();
        // não redesenha por cima de quem está digitando no editor
        const foco = document.activeElement;
        if (editando && foco && caixa.contains(foco) && foco.closest(".prog-editor")) return;
        ui.trocarHtml(caixa, html);
    }

    async function abrir() {
        if (!carregado) await carregar();
        desenhar();
        if (!laco) laco = setInterval(() => {
            if (!document.getElementById("programacao")?.classList.contains("ativa")) { clearInterval(laco); laco = null; return; }
            desenhar();
        }, 5000);
    }

    function iniciarRascunho(posto, missao) {
        const p = programa(posto, missao);
        const cal = typeof Calendario !== "undefined" ? Calendario.atual().turnos.map(t => t.id) : [];
        rascunho = p ? { modo: p.modo, dura_min: p.dura_min ?? 5, folga_min: p.folga_min ?? 1, intervalo_min: p.intervalo_min ?? 30, horarios: p.horarios.slice(), inicio: p.inicio, fim: p.fim, dias: p.dias.slice(), primeiro: p.primeiro,
                turnos: (p.turnos || []).slice(), pausar_intervalos: p.pausar_intervalos !== false, abastecer_min: p.abastecer_min || 0 }
            : { modo: "consumo", dura_min: 5, folga_min: 1, intervalo_min: 30, horarios: ["07:30"], inicio: "07:00", fim: "17:00", dias: [1, 2, 3, 4, 5], primeiro: "janela",
                turnos: cal, pausar_intervalos: true, abastecer_min: 0 };
    }

    function cfgParaSalvar(r, ativo = true) {
        return { ativo, modo: r.modo, dura_min: r.modo === "consumo" ? r.dura_min : null, folga_min: r.folga_min ?? 1,
            intervalo_min: r.modo === "intervalo" ? r.intervalo_min : null, horarios: r.modo === "horarios" ? r.horarios : [],
            inicio: r.inicio || "07:00", fim: r.fim || "17:00", dias: r.dias, primeiro: r.primeiro || "janela", fuso: FUSO,
            turnos: r.turnos || [], pausar_intervalos: r.pausar_intervalos !== false, abastecer_min: Number(r.abastecer_min) || 0 };
    }

    document.addEventListener("click", async e => {
        const b = e.target.closest("[data-prog]");
        if (!b || !b.closest("#programacao")) return;
        const acao = b.dataset.prog;
        const k = b.dataset.k || b.closest("[data-prog-editor]")?.dataset.progEditor || editando;
        const [postoId, missao] = String(k || "").split("|");
        const posto = Despacho.postos().find(p => p.id === postoId);
        const ed = b.closest(".prog-editor");
        if (ed) rascunho = lerEditor(ed);
        if (acao === "editar") { editando = k; iniciarRascunho(postoId, missao); desenhar(); document.querySelector("#programacao .prog-editor")?.scrollIntoView({ block: "nearest" }); return; }
        if (acao === "fechar") { editando = null; rascunho = null; desenhar(); return; }
        if (acao === "maisHora") {
            const h = ed.querySelector('[data-prog-campo="novaHora"]').value;
            if (/^[0-2][0-9]:[0-5][0-9]$/.test(h) && !rascunho.horarios.includes(h)) rascunho.horarios = rascunho.horarios.concat([h]).sort();
            redesenharEditor(); return;
        }
        if (acao === "tirarHora") { rascunho.horarios.splice(Number(b.dataset.i), 1); redesenharEditor(); return; }
        if (acao === "salvar" || acao === "desligar") {
            if (acao === "desligar" && !await ui.confirmar({ titulo: "Desligar a programação", texto: "Este botão deixa de pedir sozinho. Os pedidos que já saíram continuam.", confirmar: "Desligar", perigo: true })) return;
            const r = await salvar(postoId, missao, cfgParaSalvar(rascunho, acao === "salvar"));
            if (!r.ok) { ui.aviso(r.erro, "erro"); return; }
            ui.aviso(acao === "salvar" ? "Programação salva." : "Programação desligada.", "sucesso");
            editando = null; rascunho = null; desenhar();
            return;
        }
        if (acao === "ajustar") {
            const p = programa(postoId, missao);
            if (!p) return;
            const r = await ajustarConsumo(postoId, missao, Number(b.dataset.dura));
            ui.aviso(r.ok ? `Agora o material dura ${num(b.dataset.dura)} min.` : r.erro, r.ok ? "sucesso" : "erro");
            desenhar(); return;
        }
        if (!posto) return;
        if (acao === "pausar") {
            const v = await ui.formulario({ titulo: `Pausar · ${postoId} · ${missao}`, confirmar: "Pausar", campos: [{ nome: "motivo", rotulo: "Por quê?", tipo: "radio", opcoes: MOTIVOS, valor: "linha parada" }] });
            if (!v) return;
            const r = await pausar(postoId, missao, true, v.motivo);
            if (!r.ok) ui.aviso(r.erro, "erro");
        }
        if (acao === "retomar") { const r = await pausar(postoId, missao, false, ""); if (!r.ok) ui.aviso(r.erro, "erro"); }
        if (acao === "pular") { const r = await pular(postoId, missao); if (!r.ok) ui.aviso(r.erro, "erro"); }
        desenhar();
    });
    function redesenharEditor() {
        const el = document.querySelector("#programacao .prog-editor");
        if (!el) return;
        const [postoId, missao] = el.dataset.progEditor.split("|");
        const posto = Despacho.postos().find(p => p.id === postoId);
        const b = posto?.botoes.find(x => x.missao === missao);
        if (!b) return;
        const div = document.createElement("div");
        div.innerHTML = htmlEditor(posto, b);
        el.replaceWith(div.firstElementChild);
    }
    document.addEventListener("input", e => {
        const ed = e.target.closest("#programacao .prog-editor");
        if (!ed) return;
        rascunho = lerEditor(ed);
        if (["modo", "turno", "pausar_intervalos"].includes(e.target.dataset.progCampo)) return;
        const [postoId, missao] = ed.dataset.progEditor.split("|");
        const posto = Despacho.postos().find(p => p.id === postoId);
        const b = posto?.botoes.find(x => x.missao === missao);
        const pv = document.getElementById("progPrevia");
        if (pv && b) pv.textContent = previa(posto, b);
    });
    document.addEventListener("change", e => {
        const ed = e.target.closest("#programacao .prog-editor");
        if (ed && ["modo", "turno", "pausar_intervalos"].includes(e.target.dataset.progCampo)) { rascunho = lerEditor(ed); redesenharEditor(); }
    });

    function iniciar() {
        carregar().then(() => iniciarTempoReal());
        setInterval(() => { if (!naNuvem() || agora() - ultimaLeitura > 60000) carregar(); }, 30000);
    }

    // Mudar quanto o material dura (a sugestão de ajuste e a Mira Pro usam)
    async function ajustarConsumo(posto, missao, dura) {
        const p = programa(posto, missao);
        if (!p) return { ok: false, erro: "Este botão não tem programação." };
        if (p.modo !== "consumo") return { ok: false, erro: "Esta programação não é pelo consumo." };
        if (!(dura > 0)) return { ok: false, erro: "Tempo inválido." };
        if (!podeProgramar()) return { ok: false, erro: "Seu perfil não permite mudar a programação." };
        return salvar(posto, missao, cfgParaSalvar(Object.assign({}, p, { dura_min: Number(dura) }), true));
    }

    raiz.Programacao = Object.assign({}, Nucleo, {
        iniciar, carregar, abrir, desenhar, verificar, salvar, pausar, pular, ajustarConsumo, situacaoDe, programa, textoAgora, comoPede,
        htmlTablet, htmlPessoas, podePausar, podeProgramar, aoPedidoManual, capacidade, ouvir: f => ouvintes.add(f),
        lista: () => programas.slice(), eventos: () => eventos.slice(), pessoas: () => pessoas.slice()
    });
    setTimeout(iniciar, 0);
})(typeof window !== "undefined" ? window : globalThis);
