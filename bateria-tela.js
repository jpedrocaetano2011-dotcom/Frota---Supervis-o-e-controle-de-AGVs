/* ============================================================
   BATERIAS (0.23) — a guia Frota › Baterias e a operação
   ============================================================
   - Cartões ao vivo de cada Atta: carga, de onde vem (medida pelo
     Atta ou estimada pelo Eciton), autonomia em horas e em missões,
     temperatura, saúde, estado. Carregar agora, carga cheia, liberar
     o carregador, pular a fila.
   - Linha do tempo: a carga de cada Atta e a energia da frota no dia,
     na semana e no mês (uma amostra a cada 5 min, gravada pela aba que
     despacha; na nuvem, bateria_historico).
   - Fila dos carregadores (os berços com carregador, na planta),
     recarga de oportunidade, horário de ponta, regras por modelo e
     a regra própria de um Atta, alertas por e-mail.
   - A aba que despacha comanda: manda o perfil para cada Atta
     (comando/bateria CONFIGURAR), manda carregar (CARGA_INICIO + a
     missão CARGA-<carregador>) e libera (CARGA_FIM). O despachante
     pergunta aqui se o Atta pode receber pedido e quanto ele tem.
*/
const BateriaOperacao = (function () {
    "use strict";
    const B = () => Bateria;
    const CHAVE_CFG = "bateriaConfig", CHAVE_CMD = "bateriaComandos", CHAVE_HIST = "bateriaHistorico", CHAVE_EST = "bateriaEstimativas";
    const AMOSTRA_MS = 5 * 60000, TICK_MS = 5000, RELER_MS = 15000;
    const esc = t => String(t ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
    const naNuvem = () => Boolean(window.Nuvem && Nuvem.emNuvem && Nuvem.emNuvem());
    const pode = n => !window.Nuvem || !naNuvem() || Nuvem.pode(n);
    const souLider = () => typeof Despacho !== "undefined" && Despacho.lider && Despacho.lider().eu;
    const ler = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k) || "null"); return v ?? d; } catch (e) { return d; } };
    const gravar = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* sem espaço */ } };
    const n0 = v => (v == null || !Number.isFinite(v) ? "--" : String(Math.round(v)));
    const n1 = v => (v == null || !Number.isFinite(v) ? "--" : (Math.round(v * 10) / 10).toLocaleString("pt-BR"));

    let config = B().configuracao(null), comandos = {}, carregado = false, configEm = 0;
    let plano = { acoes: [], fila: [], porAtta: {}, carregadores: [], alertas: [], ponta: null };
    const est = ler(CHAVE_EST, {});        // estimativas (nível 0): id → { pct, em, whGasto, whCarregado }
    const vivo = {};                       // id → { ultimoMs, ociosoDesde, cargaDesde, pctCarga, enviadoCarga, liberadoEm, cfgHash, online, pctInicioMissao, missao, whPorMissao, consumo }
    let historico = ler(CHAVE_HIST, []);
    let periodo = "dia", serie = null, serieEm = 0, alertasAvisados = new Set();

    /* ---------------- dados ---------------- */
    async function carregar() {
        if (naNuvem() && Nuvem.empresa && Nuvem.empresa()) {
            const r = await Nuvem.cliente().from("bateria_config").select("dados, agora, atualizado_em").eq("empresa_id", Nuvem.empresa().id).maybeSingle();
            if (!r.error) { config = B().configuracao(r.data?.dados || null); comandos = r.data?.agora || {}; }
        } else {
            config = B().configuracao(ler(CHAVE_CFG, null));
            comandos = ler(CHAVE_CMD, {});
        }
        carregado = true; configEm = Date.now();
    }
    async function salvarConfig() {
        if (!pode("administrar")) { ui.aviso("Só o administrador muda as regras das baterias.", "aviso"); return false; }
        if (naNuvem()) {
            const r = await Nuvem.cliente().rpc("salvar_bateria_config", { p_empresa: Nuvem.empresa().id, p_dados: config });
            if (r.error) { ui.aviso(r.error.message, "erro"); return false; }
        } else gravar(CHAVE_CFG, config);
        Object.values(vivo).forEach(v => { v.cfgHash = null; });   // manda o perfil de novo
        return true;
    }
    async function comandar(agvId, acao, minutos = 60) {
        if (!pode("bateria")) { ui.aviso("Seu perfil não comanda a carga dos Atta.", "aviso"); return; }
        if (naNuvem()) {
            const r = await Nuvem.cliente().rpc("bateria_comando", { p_empresa: Nuvem.empresa().id, p_agv: agvId, p_acao: acao, p_minutos: minutos });
            if (r.error) { ui.aviso(r.error.message, "erro"); return; }
            comandos = r.data || {};
        } else {
            if (acao === "nenhum") delete comandos[agvId];
            else comandos[agvId] = { acao, em: new Date().toISOString(), ate: new Date(Date.now() + minutos * 60000).toISOString() };
            gravar(CHAVE_CMD, comandos);
        }
        const t = { carregar: "vai carregar assim que puder", cheia: "vai carregar até a carga cheia", liberar: "o carregador vai ser liberado", pular: "fica fora da fila por 1 hora", nenhum: "volta às regras normais" }[acao];
        ui.aviso(`${agvId} ${t}.`, "sucesso");
        tick(true);
    }

    /* ---------------- o estado de cada Atta ---------------- */
    const lista = () => (typeof agvs !== "undefined" ? Object.values(agvs) : []).filter(a => a && a.id);
    const planta = () => (typeof plantaPublicada === "function" ? plantaPublicada() : null);
    function carregadores() {
        const p = planta();
        return (p?.nos || []).filter(n => n.tipo === "BERCO" && n.carregador).map(n => ({ id: n.id, nome: n.nome || n.id, modelos: n.carregaModelos || [], x: n.x, y: n.y }));
    }
    const moduloDe = a => (typeof Modelos !== "undefined" && Modelos.porId ? Modelos.porId(a.modelo)?.modulo : null) || "E";
    const ocupado = a => (typeof MISSAO_OCUPADA !== "undefined" ? MISSAO_OCUPADA.includes(a.estadoMissao) : a.estadoMissao === "EM_EXECUCAO");
    const filaIds = a => (a.fila?.itens || []).map(i => String(i.id || "")).concat((a.filaPendentes || []).map(p => String(p.id || "")));
    const idMissaoAtual = a => String(a.missaoAtual || a.fila?.atual?.id || a.missaoCompilada?.missao || "");
    function idaCarga(a) {
        const atual = ocupado(a) ? idMissaoAtual(a) : "";
        const ids = [atual].concat(filaIds(a)).filter(x => /^CARGA-/.test(x));
        const env = vivo[a.id]?.enviadoCarga;
        if (!ids.length && env && Date.now() - env.em < 30000) return env.carregador;
        return ids.length ? ids[0].slice(6) : null;
    }
    function perfil(a) { return B().perfilDoAtta({ id: a.id, modelo: a.modelo, modulo: moduloDe(a) }, config); }
    // a carga agora: a medida (status/bateria com pct) ou a estimada
    function cargaDe(a) {
        const s = a.bateriaStatus || {};
        if (Number.isFinite(Number(s.pct)) && s.pct !== null && s.pct !== undefined && Date.now() - (s.em || 0) < 180000) return { pct: Number(s.pct), medido: true, nivel: s.nivel ?? 1 };
        if (Number.isFinite(est[a.id]?.pct)) return { pct: est[a.id].pct, medido: false, nivel: 0 };
        return { pct: null, medido: false, nivel: s.nivel ?? 0 };
    }
    function entradaDe(a, ch) {
        const s = a.bateriaStatus || {};
        const c = cargaDe(a);
        const no = a.pontoAtual && planta() ? Planta.noPorId(planta(), a.pontoAtual) : null;
        const noCarregador = s.carregador != null ? Boolean(s.carregador) : Boolean(a.posicaoConhecida && ch.some(x => x.id === a.pontoAtual) && !ocupado(a));
        const v = vivo[a.id] = vivo[a.id] || {};
        const livre = !ocupado(a) && !filaIds(a).length && a.online;
        const destino = idaCarga(a);
        return {
            id: a.id, nome: a.nome || a.id, modelo: a.modelo, modulo: moduloDe(a), online: Boolean(a.online),
            manutencao: typeof Manutencao !== "undefined" && Manutencao.ativa(a),
            pct: c.pct, medido: c.medido, t: Number.isFinite(Number(s.t)) ? Number(s.t) : null, saude: Number.isFinite(Number(s.saude)) ? Number(s.saude) : null,
            carregando: s.carregando != null ? Boolean(s.carregando) : (noCarregador && (s.carga ?? v.cargaPedida) ? true : null),
            berco: typeof rotinaDoAGV === "function" ? (rotinaDoAGV(a).berco || null) : null,
            noCarregador, carga: s.carga != null ? Boolean(s.carga) : Boolean(v.cargaPedida), pontoAtual: a.pontoAtual || null, x: no?.x, y: no?.y,
            livre, indoCarregar: Boolean(destino) && !(noCarregador && a.pontoAtual === destino), destinoCarga: destino,
            emIntervalo: Boolean(a.rotinaStatus?.fimDeTurno && a.rotinaStatus?.motivo === "INTERVALO"),
            ociosoS: v.ociosoDesde ? (Date.now() - v.ociosoDesde) / 1000 : 0,
            cargaDesdeS: v.cargaDesde ? (Date.now() - v.cargaDesde) / 1000 : 0, subiuDesdeCarga: v.pctCarga != null && c.pct != null && c.pct > v.pctCarga + 0.5,
            consumoMedioW: v.consumo?.w || null, whPorMissao: v.whPorMissao || null
        };
    }

    // a cada 5 s: estimativa, ocioso, consumo; o plano; e (na aba que despacha) as ações e o histórico
    let ultimoTick = 0, ultimasChavesAlerta = "";
    function tick(forcar = false) {
        if (!carregado || typeof Bateria === "undefined") return;
        const agora = Date.now();
        if (!forcar && agora - ultimoTick < TICK_MS - 50) return;
        const dt = ultimoTick ? Math.min(60, (agora - ultimoTick) / 1000) : 0;
        ultimoTick = agora;
        const ch = carregadores();
        const lst = lista();
        lst.forEach(a => {
            const v = vivo[a.id] = vivo[a.id] || {};
            const p = perfil(a);
            const c = cargaDe(a);
            const e0 = entradaDe(a, ch);
            // estimativa de quem não mede
            if (!c.medido && a.online) {
                const atual = est[a.id] || { pct: 80, em: agora, whGasto: 0, whCarregado: 0 };
                const r = B().estimar(p, atual.pct, { dt, andando: a.estadoMissao === "EM_EXECUCAO", carregado: typeof garraCarregada === "function" && garraCarregada(a), carregando: e0.noCarregador && e0.carga });
                est[a.id] = { pct: r.pct, em: agora, whGasto: (atual.whGasto || 0) + r.whGasto, whCarregado: (atual.whCarregado || 0) + r.whCarregado };
            } else if (c.medido && v.ultimoPct != null) {
                const d = (c.pct - v.ultimoPct) / 100 * p.capacidadeWh;
                const e = est[a.id] = est[a.id] || { pct: c.pct, whGasto: 0, whCarregado: 0 };
                e.pct = c.pct; e.em = agora;
                if (d < 0) e.whGasto = (e.whGasto || 0) - d; else e.whCarregado = (e.whCarregado || 0) + d;
            }
            v.ultimoPct = c.pct;
            // consumo médio (Wh/h) na última hora, para a autonomia
            if (c.pct != null && dt > 0 && !e0.noCarregador) {
                const w = Math.max(0, (v.pctAnterior != null ? (v.pctAnterior - c.pct) : 0) / 100 * p.capacidadeWh * 3600 / dt);
                v.consumo = { w: v.consumo ? v.consumo.w * 0.98 + w * 0.02 : null };
                if (v.consumo.w === null) v.consumo.w = p.consumoRodandoW * 0.5 + p.consumoParadoW * 0.5;
            }
            v.pctAnterior = c.pct;
            // energia por missão (média das últimas)
            const missaoAgora = a.estadoMissao === "EM_EXECUCAO" ? idMissaoAtual(a) : "";
            if (missaoAgora && v.missao !== missaoAgora) { v.missao = missaoAgora; v.pctInicioMissao = c.pct; }
            if (!missaoAgora && v.missao) {
                if (!/^CARGA-/.test(v.missao) && v.pctInicioMissao != null && c.pct != null && v.pctInicioMissao > c.pct) {
                    const wh = (v.pctInicioMissao - c.pct) / 100 * p.capacidadeWh;
                    v.whPorMissao = v.whPorMissao ? v.whPorMissao * 0.8 + wh * 0.2 : wh;
                }
                v.missao = null;
            }
            // ocioso desde / no carregador desde
            if (e0.livre && !e0.noCarregador) v.ociosoDesde = v.ociosoDesde || agora; else v.ociosoDesde = null;
            if (e0.noCarregador && e0.carga) { if (!v.cargaDesde) { v.cargaDesde = agora; v.pctCarga = c.pct; } } else { v.cargaDesde = null; v.pctCarga = null; }
        });
        gravar(CHAVE_EST, est);
        // as regras e os comandos mudam em outras abas: quem não despacha relê também
        if (!souLider() && agora - configEm > RELER_MS) { configEm = agora; carregar().catch(() => {}); }
        plano = B().planejar({ agora, config, comandos, agvs: lst.map(a => entradaDe(a, ch)), carregadores: ch });
        if (souLider()) executar(lst, ch).catch(e => console.error("Baterias:", e));
        // um alerta novo vai para o histórico na hora (o e-mail sai do banco), sem esperar a amostra de 5 min
        const chavesAlerta = plano.alertas.map(x => x.agv + ":" + x.alerta).sort().join();
        const alertaNovo = plano.alertas.some(x => !(ultimasChavesAlerta || "").split(",").includes(x.agv + ":" + x.alerta));
        ultimasChavesAlerta = chavesAlerta;
        if (souLider()) amostrar(lst, alertaNovo).catch(e => console.error("Baterias (histórico):", e));
        avisarAlertas();
        atualizarBadge();
        const tela = document.getElementById("baterias");
        if (tela && tela.classList.contains("ativa")) desenhar();
    }

    /* ---------------- a aba que despacha comanda ---------------- */
    const pub = (a, payload) => (typeof publicar === "function" && typeof TOPICOS !== "undefined" ? publicar(TOPICOS.comando.bateria, JSON.stringify(payload), a.id) : false);
    async function executar(lst, ch) {
        const agora = Date.now();
        // o perfil e os carregadores de cada Atta (quando muda ou quando ele volta)
        lst.forEach(a => {
            const v = vivo[a.id];
            if (!a.online) { v.cfgHash = null; return; }
            const p = perfil(a);
            const meus = ch.filter(c => !(c.modelos || []).length || c.modelos.includes(a.modelo)).map(c => c.id);
            const pacote = B().pacoteConfigurar(p, meus);
            const hash = JSON.stringify(pacote);
            if (v.cfgHash !== hash && pub(a, pacote)) v.cfgHash = hash;
        });
        for (const ac of plano.acoes) {
            const a = agvs[ac.agv];
            if (!a) continue;
            const v = vivo[a.id];
            if (ac.tipo === "carregar") {
                if (v.enviadoCarga && agora - v.enviadoCarga.em < 30000) continue;
                v.enviadoCarga = { carregador: ac.carregador, em: agora };
                v.cargaPedida = true;
                pub(a, { acao: "CARGA_INICIO" });
                const ok = typeof adicionarNaFilaDoAGV === "function" && adicionarNaFilaDoAGV(a.id, "CARGA-" + ac.carregador, { silencioso: true });
                if (typeof registrarAcaoSite === "function") registrarAcaoSite(a.id, "bateria", "IR_CARREGAR", `Vai carregar em ${ac.carregador}: ${ac.motivo}`);
                if (!ok) v.enviadoCarga = null;
            } else if (ac.tipo === "sair") {
                if (v.saiuEm && agora - v.saiuEm < 60000) continue;
                v.saiuEm = agora;
                const ok = typeof adicionarNaFilaDoAGV === "function" && adicionarNaFilaDoAGV(a.id, "CASA-" + ac.destino, { silencioso: true });
                if (ok && typeof registrarAcaoSite === "function") registrarAcaoSite(a.id, "bateria", "SAIU_DO_CARREGADOR", `Volta ao berço ${ac.destino}: ${ac.motivo}`);
            } else if (ac.tipo === "liberar") {
                if (v.liberadoEm && agora - v.liberadoEm < 30000) continue;
                v.liberadoEm = agora;
                v.cargaPedida = false;
                pub(a, { acao: "CARGA_FIM" });
                if (typeof registrarAcaoSite === "function") registrarAcaoSite(a.id, "bateria", "CARGA_LIBERADA", ac.motivo);
                const c = comandos[a.id]?.acao;
                if (c === "liberar" || c === "carregar" || c === "cheia") await comandarSilencioso(a.id, "nenhum");
            }
        }
        // pediu carga e foi embora (pegou um pedido): solta a marca de carga
        lst.forEach(a => {
            const s = a.bateriaStatus || {};
            const v = vivo[a.id];
            const e = entradaDe(a, ch);
            if (s.carga && !e.noCarregador && !e.indoCarregar) {
                v.longeDesde = v.longeDesde || agora;
                if (agora - v.longeDesde > 60000 && (!v.liberadoEm || agora - v.liberadoEm > 60000)) { v.liberadoEm = agora; pub(a, { acao: "CARGA_FIM" }); }
            } else v.longeDesde = null;
        });
        // relê os comandos do dia (outras abas mandam)
        if (agora - configEm > RELER_MS) await carregar();
    }
    async function comandarSilencioso(agvId, acao) {
        try {
            if (naNuvem()) { const r = await Nuvem.cliente().rpc("bateria_comando", { p_empresa: Nuvem.empresa().id, p_agv: agvId, p_acao: acao, p_minutos: 60 }); if (!r.error) comandos = r.data || {}; }
            else { delete comandos[agvId]; gravar(CHAVE_CMD, comandos); }
        } catch (e) { /* tenta de novo */ }
    }
    // uma amostra a cada 5 min por Atta (nuvem: bateria_historico; sem nuvem: este navegador, 14 dias)
    let ultimaAmostra = 0;
    async function amostrar(lst, forcar = false) {
        const agora = Date.now();
        if (!forcar && agora - ultimaAmostra < AMOSTRA_MS) return;
        ultimaAmostra = agora;
        const amostras = lst.filter(a => a.online || cargaDe(a).pct != null).map(a => {
            const c = cargaDe(a), s = a.bateriaStatus || {}, e = est[a.id] || {};
            const al = plano.alertas.find(x => x.agv === a.id);
            const am = { agv: a.id, em: new Date(agora).toISOString(), pct: c.pct == null ? null : Math.round(c.pct * 10) / 10, fonte: c.medido ? "medido" : "estimado",
                whGasto: Math.round((e.whGasto || 0) * 10) / 10, whCarregado: Math.round((e.whCarregado || 0) * 10) / 10,
                carregando: Boolean(plano.porAtta[a.id]?.situacao === "carregando" || s.carregando), t: Number.isFinite(Number(s.t)) ? Number(s.t) : null,
                saude: Number.isFinite(Number(s.saude)) ? Number(s.saude) : null, alerta: al?.alerta || "", texto: al?.texto || "" };
            if (est[a.id]) { est[a.id].whGasto = 0; est[a.id].whCarregado = 0; }
            return am;
        });
        if (!amostras.length) return;
        if (naNuvem()) {
            const r = await Nuvem.cliente().rpc("registrar_bateria", { p_empresa: Nuvem.empresa().id, p_amostras: amostras });
            if (r.error) console.warn("Baterias:", r.error.message);
        } else {
            historico = historico.concat(amostras).filter(x => agora - Date.parse(x.em) < 14 * 86400000).slice(-40000);
            gravar(CHAVE_HIST, historico);
        }
        serieEm = 0;
    }
    function avisarAlertas() {
        if (naNuvem()) return;   // na nuvem, o e-mail sai pelo banco
        plano.alertas.forEach(x => {
            const k = x.agv + ":" + x.alerta;
            if (!alertasAvisados.has(k)) { alertasAvisados.add(k); ui.aviso(`${x.agv}: ${x.texto}`, x.alerta === "critica" ? "erro" : "aviso"); }
        });
        const ativos = new Set(plano.alertas.map(x => x.agv + ":" + x.alerta));
        [...alertasAvisados].forEach(k => { if (!ativos.has(k)) alertasAvisados.delete(k); });
    }
    function atualizarBadge() {
        const b = document.getElementById("menuBadgeBaterias");
        if (b) b.hidden = !plano.alertas.length;
    }

    // o que o despachante precisa: a carga, o perfil e por que não pode receber pedido
    function paraDespacho(a) {
        if (!carregado || typeof Bateria === "undefined") return null;
        const info = plano.porAtta[a.id];
        const p = info?.perfil || perfil(a);
        const c = cargaDe(a);
        if (c.pct == null) return null;
        let impedimento = null;
        if (info?.situacao === "indo carregar") impedimento = "indo carregar";
        else if (info?.situacao === "carregando" && c.pct < p.despacharAcima) impedimento = `carregando (${Math.round(c.pct)}%)`;
        else if (info?.precisa && info.precisa.nivel <= 2 && !info.precisa.bloqueado) impedimento = `precisa carregar: ${info.precisa.motivo}`;
        else if (c.pct < p.despacharAcima) impedimento = `bateria baixa (${Math.round(c.pct)}%, recebe pedido a partir de ${p.despacharAcima}%)`;
        const ch = carregadores().filter(x => !(x.modelos || []).length || x.modelos.includes(a.modelo)).map(x => x.id);
        return { pct: c.pct, medido: c.medido, impedimento, carregadores: ch,
            perfil: { capacidadeWh: p.capacidadeWh, reserva: p.reserva, whKmVazio: p.whKmVazio, whKmCarregado: p.whKmCarregado, consumoParadoW: p.consumoParadoW, whCicloCarga: p.whCicloCarga } };
    }
    function aoReceber(a) {
        const v = vivo[a.id] = vivo[a.id] || {};
        if (a.bateriaStatus && a.bateriaStatus.carga === false) v.cargaPedida = false;
    }

    /* ---------------- linha do tempo ---------------- */
    const PERIODOS = { dia: { ms: 86400000, passo: 15, nome: "Hoje (24 h)" }, semana: { ms: 7 * 86400000, passo: 120, nome: "7 dias" }, mes: { ms: 30 * 86400000, passo: 720, nome: "30 dias" } };
    async function carregarSerie() {
        const P = PERIODOS[periodo], ate = Date.now(), de = ate - P.ms;
        if (naNuvem()) {
            const r = await Nuvem.cliente().rpc("bateria_resumo", { p_empresa: Nuvem.empresa().id, p_de: new Date(de).toISOString(), p_ate: new Date(ate).toISOString(), p_passo_min: P.passo });
            serie = r.error ? [] : (r.data || []);
        } else {
            const passo = P.passo * 60000, grupos = new Map();
            historico.filter(x => Date.parse(x.em) >= de).forEach(x => {
                const f = Math.floor(Date.parse(x.em) / passo) * passo, k = f + "|" + x.agv;
                const g = grupos.get(k) || { em: new Date(f).toISOString(), agv: x.agv, soma: 0, n: 0, whGasto: 0, whCarregado: 0, carregando: false };
                if (x.pct != null) { g.soma += x.pct; g.n++; }
                g.whGasto += x.whGasto || 0; g.whCarregado += x.whCarregado || 0; g.carregando = g.carregando || x.carregando;
                grupos.set(k, g);
            });
            serie = [...grupos.values()].map(g => ({ em: g.em, agv: g.agv, pct: g.n ? g.soma / g.n : null, whGasto: g.whGasto, whCarregado: g.whCarregado, carregando: g.carregando }));
        }
        serieEm = Date.now();
        desenhar();
    }
    // cores categóricas na ordem (a mesma do mapa de calor e dos indicadores)
    const CORES = ["var(--accent, #1E63C7)", "#E8702A", "#11764F", "#8F5AC9", "#C4364F", "#2E8FA8", "#8C6D1F", "#5B6573"];
    function svgLinha() {
        const P = PERIODOS[periodo], ate = Date.now(), de = ate - P.ms;
        const W = 960, H = 262, x0 = 44, x1 = W - 14, y0 = 14, y1 = 170, yb = 250, bh = 40;
        const X = t => x0 + (t - de) / (ate - de) * (x1 - x0), Y = v => y1 - v / 100 * (y1 - y0);
        const ids = [...new Set((serie || []).map(s => s.agv))].sort();
        const linhas = ids.map((id, i) => {
            const pts = (serie || []).filter(s => s.agv === id && s.pct != null).sort((a, b) => a.em.localeCompare(b.em));
            if (!pts.length) return "";
            const d = pts.map((s, k) => `${k ? "L" : "M"}${X(Date.parse(s.em)).toFixed(1)} ${Y(s.pct).toFixed(1)}`).join(" ");
            const carga = pts.filter(s => s.carregando).map(s => `<circle cx="${X(Date.parse(s.em)).toFixed(1)}" cy="${Y(s.pct).toFixed(1)}" r="2.6" fill="${CORES[i % CORES.length]}"><title>${esc(id)} carregando · ${n0(s.pct)}%</title></circle>`).join("");
            const ult = pts[pts.length - 1];
            const agoraPt = `<circle cx="${X(Date.parse(ult.em)).toFixed(1)}" cy="${Y(ult.pct).toFixed(1)}" r="3.5" fill="var(--card, #fff)" stroke="${CORES[i % CORES.length]}" stroke-width="2"><title>${esc(id)} · ${n0(ult.pct)}%</title></circle>`;
            return `<path d="${d}" fill="none" stroke="${CORES[i % CORES.length]}" stroke-width="2" stroke-linejoin="round"><title>${esc(id)}</title></path>${carga}${agoraPt}`;
        }).join("");
        // energia da frota por faixa (gasta para cima, carregada para baixo, no mesmo eixo)
        const faixas = new Map();
        (serie || []).forEach(s => { const g = faixas.get(s.em) || { g: 0, c: 0 }; g.g += s.whGasto || 0; g.c += s.whCarregado || 0; faixas.set(s.em, g); });
        const maxE = Math.max(1, ...[...faixas.values()].map(f => Math.max(f.g, f.c)));
        const larg = Math.max(2, (x1 - x0) / ((ate - de) / (P.passo * 60000)) - 2);
        const barras = [...faixas.entries()].map(([em, f]) => {
            const x = X(Date.parse(em));
            return `<rect x="${(x - larg / 2).toFixed(1)}" y="${(yb - f.g / maxE * bh).toFixed(1)}" width="${larg.toFixed(1)}" height="${(f.g / maxE * bh).toFixed(1)}" rx="1.5" class="bt-gasto"><title>${new Date(em).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })} · gasto ${n1(f.g / 1000)} kWh · carregado ${n1(f.c / 1000)} kWh</title></rect>`;
        }).join("");
        // horário de ponta (no dia)
        const pontas = [];
        if (config.ponta.ativa) for (let t = de; t < ate; t += 15 * 60000) { if (B().pontaAgora(config, t)) pontas.push(t); }
        const sombra = pontas.map(t => `<rect x="${X(t).toFixed(1)}" y="${y0}" width="${Math.max(1, X(t + 15 * 60000) - X(t)).toFixed(1)}" height="${y1 - y0}" class="bt-ponta"/>`).join("");
        const marcas = [];
        const passoMarca = periodo === "dia" ? 3 * 3600000 : 86400000 * (periodo === "semana" ? 1 : 5);
        for (let t = Math.ceil(de / passoMarca) * passoMarca; t <= ate; t += passoMarca) {
            const txt = periodo === "dia" ? new Date(t).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : new Date(t).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
            marcas.push(`<line x1="${X(t).toFixed(1)}" x2="${X(t).toFixed(1)}" y1="${y0}" y2="${y1}" class="bt-grade"/><text x="${X(t).toFixed(1)}" y="${y1 + 14}" text-anchor="middle" class="bt-eixo">${txt}</text>`);
        }
        const yMarcas = [0, 25, 50, 75, 100].map(v => `<line x1="${x0}" x2="${x1}" y1="${Y(v)}" y2="${Y(v)}" class="bt-grade"/><text x="${x0 - 6}" y="${Y(v) + 4}" text-anchor="end" class="bt-eixo">${v}%</text>`).join("");
        const legenda = ids.map((id, i) => `<span><i style="background:${CORES[i % CORES.length]}"></i>${esc(agvs?.[id]?.nome || id)}</span>`).join("") +
            `<span><i class="bt-l-gasto"></i>energia gasta pela frota</span>${config.ponta.ativa ? `<span><i class="bt-l-ponta"></i>horário de ponta</span>` : ""}<span><b>●</b> carregando</span>`;
        if (!ids.length) return `<div class="empty-state">Ainda sem histórico neste período. A aba que despacha grava uma amostra a cada 5 minutos.</div>`;
        return `<figure class="bt-grafico"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="A carga de cada Atta e a energia da frota">${sombra}${yMarcas}${marcas.join("")}${linhas}
            <text x="${x0}" y="${yb - bh - 6}" class="bt-eixo">energia gasta (máx. ${n1(maxE / 1000)} kWh por faixa)</text><line x1="${x0}" x2="${x1}" y1="${yb}" y2="${yb}" class="bt-grade"/>${barras}</svg>
            <figcaption>${legenda}</figcaption></figure>`;
    }

    /* ---------------- a tela ---------------- */
    const SIT = { carregando: ["carregando", "verde"], "indo carregar": ["indo carregar", "azul"], rodando: ["rodando", "azul"], ocioso: ["parado", "cinza"], "crítico": ["crítico", "vermelho"], offline: ["offline", "cinza"], "manutenção": ["manutenção", "roxo"], "sem dado": ["sem dado", "cinza"] };
    function cartao(a) {
        const info = plano.porAtta[a.id] || {};
        const p = info.perfil || perfil(a);
        const c = cargaDe(a), s = a.bateriaStatus || {};
        const pct = c.pct;
        const cor = pct == null ? "cinza" : pct < p.critico ? "vermelho" : pct < p.irCarregarAbaixo ? "ambar" : "verde";
        const [sit, corSit] = SIT[info.situacao] || [info.situacao || "--", "cinza"];
        const au = info.autonomia || {};
        const cmd = comandos[a.id] && (!comandos[a.id].ate || Date.parse(comandos[a.id].ate) > Date.now()) ? comandos[a.id].acao : null;
        const podeCmd = pode("bateria");
        const carregando = info.situacao === "carregando" || info.situacao === "indo carregar";
        return `<article class="card bt-cartao" data-bt-agv="${esc(a.id)}">
            <div class="bt-topo"><div><b>${esc(a.nome || a.id)}</b><small class="suave">${esc(a.id)} · ${esc(typeof Modelos !== "undefined" ? Modelos.nome(a.modelo) : a.modelo || "")}</small></div><span class="pilula ${corSit}">${esc(sit)}</span></div>
            <div class="bt-carga ${cor}"><div class="bt-barra"><i style="width:${pct == null ? 0 : Math.max(2, pct)}%"></i>${[p.critico, p.irCarregarAbaixo, p.cargaAlvo].map(m => `<em style="left:${m}%" title="${m}%"></em>`).join("")}</div>
                <strong>${pct == null ? "--" : n0(pct)}<small>%</small></strong></div>
            <p class="suave bt-fonte">${c.medido ? `medido pelo Atta (${esc(B().NIVEIS[c.nivel] || "")})` : pct == null ? "sem dado ainda" : "estimado pelo Eciton (o Atta não mede)"}${p.proprio ? " · regra própria" : ""}</p>
            <dl class="bt-dados">
                <div><dt>Autonomia</dt><dd>${au.horas == null ? "--" : `~${n1(au.horas)} h`} · ${au.missoes == null ? "--" : `~${au.missoes} missões`}</dd></div>
                <div><dt>Temperatura</dt><dd>${s.t != null ? `${n1(Number(s.t))} °C` : "--"}</dd></div>
                <div><dt>Saúde</dt><dd>${s.saude != null ? `${n0(Number(s.saude))}%` : "--"}${s.ciclos != null ? ` · ${s.ciclos} ciclos` : ""}</dd></div>
                <div><dt>${carregando ? "Até o alvo" : "Recebe pedido"}</dt><dd>${carregando ? (info.minutosRestantes != null ? `~${Math.ceil(info.minutosRestantes)} min (${info.alvo}%)` : `${info.alvo ?? p.cargaAlvo}%`) : `acima de ${p.despacharAcima}%`}</dd></div>
            </dl>
            ${info.motivo ? `<p class="bt-motivo">${esc(info.motivo)}</p>` : ""}
            ${cmd ? `<p class="bt-motivo azul">Comando: ${esc({ carregar: "carregar agora", cheia: "carga cheia", pular: "fora da fila", liberar: "liberar o carregador" }[cmd] || cmd)} <button type="button" class="btn-link" data-bt-cmd="nenhum" data-agv="${esc(a.id)}">desfazer</button></p>` : ""}
            ${podeCmd ? `<div class="grupo bt-acoes">
                ${carregando ? `<button type="button" class="btn btn-mini" data-bt-cmd="liberar" data-agv="${esc(a.id)}">Liberar o carregador</button>` : `<button type="button" class="btn btn-mini" data-bt-cmd="carregar" data-agv="${esc(a.id)}">Carregar agora</button>`}
                <button type="button" class="btn btn-mini" data-bt-cmd="cheia" data-agv="${esc(a.id)}">Carga cheia</button>
                ${!carregando ? `<button type="button" class="btn btn-mini" data-bt-cmd="pular" data-agv="${esc(a.id)}">Pular a fila</button>` : ""}
                ${pode("administrar") ? `<button type="button" class="btn btn-mini" data-bt-regra="${esc(a.id)}">${p.proprio ? "Regra própria" : "Regra do modelo"}</button>` : ""}</div>` : ""}
        </article>`;
    }
    function htmlFila() {
        const ch = plano.carregadores || [];
        return `<section class="card"><div class="estudo-cab"><h3>Fila dos carregadores</h3><span class="suave">${plano.disponiveis ?? 0} Atta disponíveis para pedido</span></div>
            ${ch.length ? `<div class="bt-carregadores">${ch.map(c => `<div class="bt-carregador ${c.agv ? "ocupado" : ""}"><b>${esc(c.nome)}</b><small class="suave">${(c.modelos || []).length ? c.modelos.map(m => esc(typeof Modelos !== "undefined" ? Modelos.nome(m) : m)).join(", ") : "todos os modelos"}</small>
                <span>${c.agv ? `${esc(c.agv)} ${c.indo ? "a caminho" : `· ${n0(c.pct)}%${c.previsaoMin != null ? ` · ~${Math.ceil(c.previsaoMin)} min` : ""}`}` : "livre"}</span></div>`).join("")}</div>`
                : `<div class="missao-dica ambar">Nenhum berço com carregador na planta. No editor da planta, escolha um berço e marque "Tem carregador".</div>`}
            ${(plano.fila || []).length ? `<ol class="bt-fila">${plano.fila.map(f => `<li><b>${esc(f.agv)}</b> ${f.pct != null ? `${n0(f.pct)}%` : ""} · ${esc(f.motivo)}<small class="suave">${esc(f.texto || "")}</small></li>`).join("")}</ol>` : `<p class="suave">Ninguém na fila agora.</p>`}
            <div class="estudo-premissas bt-regras-fila">
                <label class="campo"><span>Mínimo de Atta rodando</span><input type="number" min="0" max="50" data-bt="fila.minimoRodando" value="${config.fila.minimoRodando}"><small class="suave">quem está acima do limite só sai para carregar se ficarem pelo menos estes trabalhando (o crítico sempre vai)</small></label>
                <label class="config-chave"><input type="checkbox" data-bt="fila.liberarComEspera" ${config.fila.liberarComEspera ? "checked" : ""}><span>Liberar o carregador quando alguém mais precisado espera (e o Atta já pode trabalhar)</span></label>
            </div>
            <p class="suave">Ordem: bateria crítica, comando do operador, abaixo do limite de ir carregar, recarga de oportunidade; no empate, a menor carga. Vai para o carregador livre mais perto que serve o modelo.</p></section>`;
    }
    const DIAS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
    function htmlPonta() {
        const agora = B().pontaAgora(config, Date.now());
        return `<section class="card"><div class="estudo-cab"><h3>Horário de ponta</h3>
                <label class="config-chave"><input type="checkbox" data-bt="ponta.ativa" ${config.ponta.ativa ? "checked" : ""}><span>Não carregar nestes horários</span></label></div>
            <p class="suave">Na tarifa horossazonal, a energia da ponta custa mais. Nestas janelas a frota não começa a carregar, e quem está carregando e já pode trabalhar sai do carregador. ${config.ponta.ativa ? (agora ? `<b>Agora é horário de ponta (até ${esc(agora.fim)}).</b>` : "Agora está fora da ponta.") : ""}</p>
            <div class="bt-janelas">${config.ponta.janelas.map((j, i) => `<div class="bt-janela">
                <label class="campo"><span>Das</span><input type="time" data-bt-janela="${i}" data-c="inicio" value="${esc(j.inicio)}"></label>
                <label class="campo"><span>às</span><input type="time" data-bt-janela="${i}" data-c="fim" value="${esc(j.fim)}"></label>
                <div class="editor-dias">${DIAS.map((d, k) => `<label class="config-chave"><input type="checkbox" data-bt-janela="${i}" data-c="dia" data-dia="${k}" ${j.dias.includes(k) ? "checked" : ""}><span>${d}</span></label>`).join("")}</div>
                <button type="button" class="btn-remover-fila" data-bt-tirar-janela="${i}" aria-label="Tirar a janela">×</button></div>`).join("")}</div>
            <div class="grupo"><button type="button" class="btn btn-mini" data-bt-acao="janela">+ Janela</button></div>
            <label class="config-chave"><input type="checkbox" data-bt="ponta.criticoCarrega" ${config.ponta.criticoCarrega ? "checked" : ""}><span>Bateria crítica carrega mesmo na ponta (para o Atta não parar no corredor)</span></label>
            <p class="suave">Numa emergência, o botão <b>Carregar agora</b> do cartão passa por cima da ponta.</p></section>`;
    }
    function htmlOportunidade() {
        const o = config.oportunidade;
        return `<section class="card"><div class="estudo-cab"><h3>Recarga de oportunidade</h3>
                <label class="config-chave"><input type="checkbox" data-bt="oportunidade.ativa" ${o.ativa ? "checked" : ""}><span>Ligada</span></label></div>
            <p class="suave">Carrega um pouco quando dá, para não chegar no limite no meio do turno: até a carga alvo do perfil (o pedido sempre tem preferência).</p>
            <div class="estudo-premissas">
                <label class="config-chave"><input type="checkbox" data-bt="oportunidade.intervalos" ${o.intervalos ? "checked" : ""}><span>Nos intervalos do calendário</span></label>
                <label class="config-chave"><input type="checkbox" data-bt="oportunidade.ocioso" ${o.ocioso ? "checked" : ""}><span>Quando o Atta fica parado sem pedido</span></label>
                <label class="campo"><span>Parado há pelo menos</span><span class="estudo-un"><input type="number" min="1" max="240" data-bt="oportunidade.ociosoMin" value="${o.ociosoMin}"><i>min</i></span></label>
            </div></section>`;
    }
    function modelosDaFrota() {
        const ids = [...new Set(lista().map(a => a.modelo).filter(Boolean))];
        return ids.length ? ids : ["atta-e-o"];
    }
    function htmlRegras() {
        const linhas = modelosDaFrota().map(m => {
            const mod = (typeof Modelos !== "undefined" && Modelos.porId(m)?.modulo) || "E";
            const p = B().perfilDoAtta({ id: "", modelo: m, modulo: mod }, config);
            return [`<b>${esc(typeof Modelos !== "undefined" ? Modelos.nome(m) : m)}</b>${config.perfis[m] ? `<br><small class="suave">mudado pela empresa</small>` : ""}`,
                esc(B().QUIMICAS[p.quimica]?.nome.split(" (")[0] || p.quimica), `${n1(p.capacidadeWh / 1000)} kWh`, esc(B().NIVEIS[p.medicao] || ""),
                `${p.despacharAcima}%`, `${p.irCarregarAbaixo}%`, `${p.critico}%`, `${p.reserva}%`, `${p.cargaAlvo}% · ${p.cargaCheia}%`,
                pode("administrar") ? `<button type="button" class="btn btn-mini" data-bt-modelo="${esc(m)}">Editar</button>` : ""];
        });
        const proprios = Object.entries(config.porAtta || {}).filter(([, r]) => r.proprio);
        return `<section class="card"><h3>Regras por modelo</h3>
            <p class="suave">Cada Atta segue o perfil do modelo dele. Um Atta pode ter regra própria (ex.: bateria mais velha): no cartão dele, <b>Regra do modelo</b>.</p>
            <div class="tabela-rolagem"><table class="tabela-usuarios ind-tabela"><thead><tr><th>Modelo</th><th>Química</th><th>Capacidade</th><th>Medição</th><th>Recebe pedido</th><th>Vai carregar</th><th>Crítico</th><th>Reserva</th><th>Alvo · cheia</th><th></th></tr></thead>
            <tbody>${linhas.map(l => `<tr>${l.map(c => `<td>${c}</td>`).join("")}</tr>`).join("")}</tbody></table></div>
            ${proprios.length ? `<p class="suave">Com regra própria: ${proprios.map(([id]) => `<b>${esc(id)}</b>`).join(", ")}.</p>` : ""}</section>`;
    }
    function htmlAlertas() {
        const a = config.alertas;
        const EV = [["critica", "Bateria crítica"], ["carga_falhou", "No carregador e não carrega"], ["temperatura", "Bateria quente"], ["saude", "Bateria para trocar (saúde baixa)"]];
        return `<section class="card"><div class="estudo-cab"><h3>Alertas por e-mail</h3>
                <label class="config-chave"><input type="checkbox" data-bt="alertas.ativo" ${a.ativo ? "checked" : ""}><span>Mandar e-mail</span></label></div>
            <label class="campo"><span>Quem recebe (um e-mail por linha, até 10)</span><textarea rows="3" data-bt="alertas.emails" placeholder="manutencao@empresa.com.br">${esc(a.emails.join("\n"))}</textarea></label>
            <div class="estudo-premissas">${EV.map(([k, t]) => `<label class="config-chave"><input type="checkbox" data-bt-evento="${k}" ${a.eventos[k] !== false ? "checked" : ""}><span>${t}</span></label>`).join("")}</div>
            <p class="suave">${naNuvem() ? "Um e-mail quando o alerta abre e outro quando ele se resolve, pelo banco (precisa do 03_alertas.sql e da chave do Resend no cofre)." : "Sem nuvem, os alertas aparecem só aqui na tela."}</p></section>`;
    }
    function desenhar() {
        const caixa = document.getElementById("bateriasConteudo");
        if (!caixa) return;
        if (!carregado) { caixa.innerHTML = `<div class="empty-state">Carregando…</div>`; return; }
        const lst = lista().sort((a, b) => String(a.id).localeCompare(String(b.id), "pt-BR", { numeric: true }));
        const lider = typeof Despacho !== "undefined" && Despacho.lider ? Despacho.lider() : { eu: true };
        if (!serie || Date.now() - serieEm > 60000) { serieEm = Date.now(); carregarSerie().catch(() => {}); }
        const html = `<section class="card estudos-topo"><div class="estudo-topo-linha"><div><h2>Baterias</h2>
                <p class="suave">${lider.eu ? "Esta aba comanda as cargas (é a que despacha)." : `Quem comanda as cargas é a aba que despacha${lider.nome ? ` (${esc(lider.nome)})` : ""}; esta mostra.`}
                ${plano.ponta ? ` <b>Horário de ponta até ${esc(plano.ponta.fim)}.</b>` : ""}</p></div></div></section>
            ${plano.alertas.length ? `<div class="missao-dica vermelho" role="alert">${plano.alertas.map(x => `<b>${esc(x.agv)}</b>: ${esc(x.texto)}`).join("<br>")}</div>` : ""}
            ${lst.length ? `<div class="bt-cartoes">${lst.map(cartao).join("")}</div>` : `<div class="empty-state">Nenhum Atta cadastrado.</div>`}
            <section class="card"><div class="estudo-cab"><h3>Linha do tempo</h3><nav class="ind-abas" role="tablist">${Object.entries(PERIODOS).map(([k, p]) => `<button type="button" role="tab" data-bt-periodo="${k}" class="${periodo === k ? "ativo" : ""}" aria-selected="${periodo === k}">${p.nome}</button>`).join("")}</nav></div>
                ${serie ? svgLinha() : `<div class="empty-state">Carregando o histórico…</div>`}</section>
            ${htmlFila()}
            <div class="estudo-duas">${htmlOportunidade()}${htmlPonta()}</div>
            ${htmlRegras()}
            ${htmlAlertas()}`;
        if (caixa.__html !== html) { caixa.__html = html; ui.trocarHtml(caixa, html); }
    }

    /* ---------------- editar ---------------- */
    const CAMPOS = [["quimica", "Química"], ["capacidadeWh", "Capacidade (Wh)"], ["medicao", "O que o Atta mede"], ["despacharAcima", "Recebe pedido acima de (%)"], ["irCarregarAbaixo", "Vai carregar abaixo de (%)"],
        ["critico", "Crítico abaixo de (%)"], ["reserva", "Reserva que a missão não toca (%)"], ["cargaAlvo", "Carga alvo no dia a dia (%)"], ["cargaCheia", "Carga cheia (%)"], ["potenciaCargaW", "Potência do carregador (W)"],
        ["consumoRodandoW", "Consumo rodando (W)"], ["consumoParadoW", "Consumo parado (W)"], ["whKmVazio", "Wh por km vazio"], ["whKmCarregado", "Wh por km carregado"], ["whCicloCarga", "Wh por pegar ou entregar"],
        ["tempMaxCarga", "Temperatura máxima carregando (°C)"], ["tempMaxOperacao", "Temperatura máxima rodando (°C)"], ["saudeTroca", "Trocar a bateria abaixo de (% de saúde)"]];
    async function editarPerfil(modelo, agvId = null) {
        const mod = (typeof Modelos !== "undefined" && Modelos.porId(modelo)?.modulo) || "E";
        const atual = agvId ? B().perfilDoAtta({ id: agvId, modelo, modulo: mod }, config) : B().perfilDoModelo(modelo, mod, config);
        const proprio = agvId ? Boolean(config.porAtta?.[agvId]?.proprio) : false;
        const campos = (agvId ? [{ nome: "proprio", rotulo: "Este Atta tem regra própria (senão, segue o modelo)", tipo: "checkbox", valor: proprio }] : []).concat(CAMPOS.map(([k, r]) => ({
            nome: k, rotulo: r, valor: atual[k],
            opcoes: k === "quimica" ? Object.entries(B().QUIMICAS).map(([q, x]) => [q, x.nome]) : k === "medicao" ? [0, 1, 2, 3].map(n => [String(n), `${n} · ${B().NIVEIS[n]}`]) : undefined,
            tipo: k === "quimica" || k === "medicao" ? undefined : "number"
        })));
        const v = await ui.formulario({ titulo: agvId ? `Regra de bateria de ${agvId}` : `Perfil de bateria: ${typeof Modelos !== "undefined" ? Modelos.nome(modelo) : modelo}`, confirmar: "Salvar", campos,
            texto: agvId ? "Desmarcado, o Atta volta a seguir o perfil do modelo." : "Vale para todos os Atta deste modelo (menos os com regra própria)." });
        if (!v) return;
        const fab = B().perfilDoModelo(modelo, mod, B().configuracao(null));
        const mudou = {};
        CAMPOS.forEach(([k]) => {
            const val = k === "quimica" ? v[k] : Number(String(v[k]).replace(",", "."));
            if (k !== "quimica" && !Number.isFinite(val)) return;
            const base = agvId ? B().perfilDoModelo(modelo, mod, config)[k] : fab[k];
            if (val !== base) mudou[k] = val;
        });
        if (agvId) {
            config.porAtta = Object.assign({}, config.porAtta);
            if (v.proprio) config.porAtta[agvId] = Object.assign({ proprio: true }, mudou); else delete config.porAtta[agvId];
        } else {
            config.perfis = Object.assign({}, config.perfis);
            if (Object.keys(mudou).length) config.perfis[modelo] = mudou; else delete config.perfis[modelo];
        }
        if (await salvarConfig()) { ui.aviso("Regra de bateria salva. Os Atta recebem o perfil novo em instantes.", "sucesso"); tick(true); }
    }
    let timerSalvar = null;
    function salvarDepois() { clearTimeout(timerSalvar); timerSalvar = setTimeout(async () => { if (await salvarConfig()) tick(true); }, 600); }
    function gravarCampo(cam, valor) {
        const ks = cam.split(".");
        let o = config;
        ks.slice(0, -1).forEach(k => { o = o[k] = o[k] || {}; });
        o[ks[ks.length - 1]] = valor;
        config = B().configuracao(config);
    }
    function ligar() {
        const caixa = document.getElementById("bateriasConteudo");
        if (!caixa || caixa.dataset.ligado) return;
        caixa.dataset.ligado = "1";
        caixa.addEventListener("click", ev => {
            const b = ev.target.closest("button");
            if (!b) return;
            if (b.dataset.btCmd) { comandar(b.dataset.agv, b.dataset.btCmd, b.dataset.btCmd === "pular" ? 60 : 180); return; }
            if (b.dataset.btPeriodo) { periodo = b.dataset.btPeriodo; serie = null; desenhar(); return; }
            if (b.dataset.btModelo) { editarPerfil(b.dataset.btModelo); return; }
            if (b.dataset.btRegra) { const a = agvs[b.dataset.btRegra]; if (a) editarPerfil(a.modelo, a.id); return; }
            if (b.dataset.btTirarJanela !== undefined) { if (!pode("administrar")) return; config.ponta.janelas.splice(Number(b.dataset.btTirarJanela), 1); salvarDepois(); desenhar(); return; }
            if (b.dataset.btAcao === "janela") { if (!pode("administrar")) return; config.ponta.janelas.push({ inicio: "18:00", fim: "21:00", dias: [1, 2, 3, 4, 5] }); salvarDepois(); desenhar(); }
        });
        caixa.addEventListener("change", ev => {
            const t = ev.target;
            if (!pode("administrar") && (t.dataset.bt || t.dataset.btJanela !== undefined || t.dataset.btEvento)) { ui.aviso("Só o administrador muda as regras das baterias.", "aviso"); desenhar(); return; }
            if (t.dataset.bt) {
                const cam = t.dataset.bt;
                if (cam === "alertas.emails") {
                    const lista_ = t.value.split(/[\s,;]+/).map(x => x.trim().toLowerCase()).filter(Boolean);
                    const ruins = lista_.filter(e => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e));
                    if (ruins.length) { ui.aviso(`E-mail inválido: ${ruins.join(", ")}`, "aviso"); return; }
                    if (lista_.length > 10) { ui.aviso("No máximo 10 e-mails.", "aviso"); return; }
                    gravarCampo(cam, lista_);
                } else gravarCampo(cam, t.type === "checkbox" ? t.checked : Number(t.value));
                salvarDepois(); return;
            }
            if (t.dataset.btEvento) { config.alertas.eventos = Object.assign({}, config.alertas.eventos, { [t.dataset.btEvento]: t.checked }); salvarDepois(); return; }
            if (t.dataset.btJanela !== undefined) {
                const j = config.ponta.janelas[Number(t.dataset.btJanela)];
                if (!j) return;
                if (t.dataset.c === "dia") { const d = Number(t.dataset.dia); j.dias = t.checked ? [...new Set(j.dias.concat([d]))].sort() : j.dias.filter(x => x !== d); }
                else if (/^\d{2}:\d{2}$/.test(t.value)) j[t.dataset.c] = t.value;
                salvarDepois(); return;
            }
        });
    }
    async function abrir() {
        ligar();
        if (!carregado) { desenhar(); await carregar(); }
        tick(true);
        desenhar();
    }

    // começa: carrega as regras, a primeira estimativa de quem não mede vem da última amostra
    (async () => {
        try { await carregar(); } catch (e) { carregado = true; }
        if (naNuvem()) {
            try {
                const r = await Nuvem.cliente().from("bateria_historico").select("agv, pct, fonte, em").eq("empresa_id", Nuvem.empresa().id).gt("em", new Date(Date.now() - 86400000).toISOString()).order("em", { ascending: false }).limit(200);
                (r.data || []).forEach(x => { if (x.fonte === "estimado" && x.pct != null && !est[x.agv]) est[x.agv] = { pct: x.pct, em: Date.parse(x.em) }; });
            } catch (e) { /* sem histórico */ }
        }
        setInterval(() => tick(), TICK_MS);
        tick(true);
    })();
    return { abrir, desenhar, tick, paraDespacho, aoReceber, cargaDe, carregadores, comandar, plano: () => plano, config: () => config, _estado: () => ({ est, vivo, comandos, historico }), amostrarAgora: () => amostrar(lista(), true) };
})();
if (typeof window !== "undefined") window.BateriaOperacao = BateriaOperacao;
