/* ============================================================
   DESPACHO — pedidos de missão, o despachante e a tela Despacho
   ============================================================
   Pedido = "preciso da missão X" (de um posto, do Despacho ou do
   "+ Fila" do cartão do AGV), com ou sem AGV fixo.

   Onde ficam os pedidos:
     local/demo  localStorage (pedidosFrota); abas do mesmo navegador
                 se enxergam pelo evento "storage".
     nuvem       tabela pedidos (Supabase), mudanças só pelas funções
                 do banco; tempo real + leitura a cada poucos segundos.

   O despachante roda numa aba só por empresa (a "líder"): qualquer
   aba que pode despachar (admin, operador ou o tablet do posto) e
   enxerga os AGVs tenta assumir; a liderança vence em 10 s se não
   for renovada. A líder decide (despachante.js), grava no banco e
   manda a missão para a fila do AGV (adicionarNaFilaDoAGV). Depois
   acompanha o pedido pelo que o AGV publica (status e eventos).
*/
const Despacho = (function () {
    "use strict";

    const SESSAO = "aba-" + Math.random().toString(36).slice(2, 12) + Date.now().toString(36);
    const CHAVE_LOCAL = "pedidosFrota";
    const CHAVE_LIDER = "despachoLider";
    const ESTADOS_ATIVOS = ["pendente", "atribuido", "em_execucao"];
    const MISSAO_AUTOMATICA = /^(?:SAIDA|CASA|IDA)-/;
    const NOMES_ESTADO = {
        pendente: ["Na fila", "cinza"], atribuido: ["A caminho", "azul"], em_execucao: ["Em execução", "azul"],
        concluido: ["Concluído", "verde"], cancelado: ["Cancelado", "cinza"], falhou: ["Falhou", "vermelho"]
    };

    let lista = [];
    let espera = {};                  // pedidoId -> por que ainda não saiu
    let situacaoAgvs = {};
    const lider = { eu: false, nome: "", verificado: 0 };
    let ultimaLeitura = 0, tempoRealOk = false, rodando = false, timerAcordar = null;
    const bloqueioAgv = {};           // agvId -> até quando não recebe (envio falhou)
    const ouvintes = new Set();
    const vistos = new Set();         // eventos já tratados (agv|evento|missão|instante)

    const usarNuvem = () => Boolean(window.Nuvem && Nuvem.emNuvem());
    const podeNivel = nivel => !window.Nuvem || Nuvem.pode(nivel);
    const esc = t => (typeof escaparHtml === "function" ? escaparHtml(t) : String(t ?? ""));
    const agora = () => Date.now();

    function nomeDestaAba() {
        if (usarNuvem()) {
            const p = Nuvem.perfil();
            return (p?.nome || p?.email || "aba") + (Nuvem.papel() === "posto" ? " (tablet)" : "");
        }
        return "este navegador";
    }

    /* ========================================================
       PEDIDOS: formato e armazenamento
       ======================================================== */

    const ms = v => (v ? (typeof v === "number" ? v : Date.parse(v)) : null);
    function doBanco(x) {
        return {
            id: Number(x.id), missao: x.missao, posto: x.posto || null, agvFixo: x.agv_fixo || null,
            prioridade: Number(x.prioridade ?? 1), urgente: Boolean(x.urgente), urgentePor: x.urgente_por || null,
            estado: x.estado, agv: x.agv || null, motivo: x.motivo || "", eta: x.eta_s ?? null,
            vinculo: x.vinculo != null ? Number(x.vinculo) : null, criadoPor: x.criado_por_nome || "",
            criadoEm: ms(x.criado_em), atribuidoEm: ms(x.atribuido_em), iniciadoEm: ms(x.iniciado_em),
            concluidoEm: ms(x.concluido_em)
        };
    }

    function lerLocal() {
        try {
            const d = JSON.parse(localStorage.getItem(CHAVE_LOCAL));
            if (d && Array.isArray(d.lista)) return d;
        } catch (e) { /* ignora */ }
        return { seq: 0, lista: [] };
    }
    function gravarLocal(d) {
        const ativos = d.lista.filter(p => ESTADOS_ATIVOS.includes(p.estado));
        const finais = d.lista.filter(p => !ESTADOS_ATIVOS.includes(p.estado)).sort((a, b) => b.id - a.id).slice(0, 200);
        d.lista = ativos.concat(finais).sort((a, b) => a.id - b.id);
        try { localStorage.setItem(CHAVE_LOCAL, JSON.stringify(d)); } catch (e) { /* sem espaço */ }
        lista = d.lista.slice();
        avisar();
    }
    // Muda um pedido local respeitando as mesmas transições do banco
    function mudarLocal(id, mudar) {
        const d = lerLocal();
        const p = d.lista.find(x => x.id === Number(id));
        if (!p) return { ok: false, erro: "Pedido não encontrado." };
        const r = mudar(p, d);
        if (r && r.ok === false) return r;
        gravarLocal(d);
        return Object.assign({ ok: true }, r || {});
    }

    async function recarregar() {
        ultimaLeitura = agora();
        if (!usarNuvem()) {
            lista = lerLocal().lista.slice();
            avisar();
            return;
        }
        const cliente = Nuvem.cliente(), empresa = Nuvem.empresa();
        const desde = new Date(agora() - 12 * 3600 * 1000).toISOString();
        const [ativos, recentes] = await Promise.all([
            cliente.from("pedidos").select("*").eq("empresa_id", empresa.id).in("estado", ESTADOS_ATIVOS).order("id"),
            cliente.from("pedidos").select("*").eq("empresa_id", empresa.id).not("estado", "in", `(${ESTADOS_ATIVOS.join(",")})`)
                .gte("criado_em", desde).order("id", { ascending: false }).limit(150)
        ]);
        if (ativos.error || recentes.error) return;
        lista = ativos.data.concat(recentes.data).map(doBanco).sort((a, b) => a.id - b.id);
        avisar();
    }

    function iniciarTempoReal() {
        if (!usarNuvem()) {
            addEventListener("storage", e => {
                if (e.key === CHAVE_LOCAL) { lista = lerLocal().lista.slice(); avisar(); acordar(); }
            });
            return;
        }
        try {
            const empresa = Nuvem.empresa();
            Nuvem.cliente().channel(`pedidos-${empresa.id}`)
                .on("postgres_changes", { event: "*", schema: "public", table: "pedidos", filter: `empresa_id=eq.${empresa.id}` }, ev => {
                    const novo = ev.new && ev.new.id ? doBanco(ev.new) : null;
                    if (novo) {
                        const i = lista.findIndex(p => p.id === novo.id);
                        if (i >= 0) lista[i] = novo; else lista.push(novo);
                        avisar();
                        acordar();
                    }
                })
                .subscribe(status => { tempoRealOk = status === "SUBSCRIBED"; });
        } catch (e) {
            tempoRealOk = false;
        }
    }

    function avisar() {
        ouvintes.forEach(f => { try { f(); } catch (e) { console.error(e); } });
    }

    const erroDe = e => (window.Nuvem ? Nuvem.traduzirErro(e) : (e?.message || String(e)));

    /* ========================================================
       AÇÕES (qualquer aba)
       ======================================================== */

    function missaoPorId(id) {
        return (typeof obterMissaoPorId === "function" ? obterMissaoPorId(id) : null);
    }
    function postosAtuais() {
        if (window.Nuvem) return Nuvem.postos();
        try { return JSON.parse(localStorage.getItem("postosFrota") || "[]"); } catch (e) { return []; }
    }
    function pinLocal() {
        try { return localStorage.getItem("pinLiderLocal") || "1234"; } catch (e) { return "1234"; }
    }

    // { missao, posto, agvFixo, vinculo, repetir, pin } -> { ok, pedido, erro, repetido }
    async function criar(dados) {
        const missao = String(dados.missao || "");
        const posto = dados.posto || null;
        const agvFixo = dados.agvFixo || null;
        if (!podeNivel("pedir")) return { ok: false, erro: "Seu perfil não permite pedir missões." };
        try {
            if (usarNuvem()) {
                const { data, error } = await Nuvem.cliente().rpc("criar_pedido", {
                    p_empresa: Nuvem.empresa().id, p_missao: missao, p_posto: posto, p_agv: agvFixo,
                    p_vinculo: dados.vinculo ?? null, p_repetir: Boolean(dados.repetir), p_pin: dados.pin ?? null
                });
                if (error) return { ok: false, erro: erroDe(error), repetido: error.hint === "repetido" || /igual aguardando/.test(error.message || "") };
                if (data?.erro) return { ok: false, erro: data.erro };
                const novo = doBanco(data);
                if (!lista.some(p => p.id === novo.id)) lista.push(novo);
                avisar();
                acordar();
                return { ok: true, pedido: novo };
            }
            const m = missaoPorId(missao);
            if (!m) return { ok: false, erro: `A missão ${missao} não existe.` };
            const p = posto ? postosAtuais().find(x => x.id === posto) : null;
            if (posto && !p) return { ok: false, erro: `O posto ${posto} não existe.` };
            if (dados.pin != null) {
                if (p && !p.permiteUrgente) return { ok: false, erro: "Este posto não aceita pedido urgente." };
                if (String(dados.pin) !== pinLocal()) return { ok: false, erro: "PIN não confere." };
            }
            const d = lerLocal();
            if (!dados.repetir) {
                const igual = d.lista.find(x => x.missao === missao && (x.posto || null) === posto && (x.agvFixo || null) === agvFixo && ["pendente", "atribuido"].includes(x.estado));
                if (igual) return { ok: false, erro: `Já existe um pedido igual aguardando (#${igual.id}).`, repetido: true };
            }
            const urgente = dados.pin != null;
            const novo = {
                id: ++d.seq, missao, posto, agvFixo, prioridade: urgente ? 3 : Math.max(0, Math.min(3, Number(m.prioridade ?? 1))),
                urgente, urgentePor: urgente ? "líder (PIN)" : null, estado: "pendente", agv: null, motivo: "", eta: null,
                vinculo: dados.vinculo ?? null, criadoPor: dados.criadoPor || (posto ? `Posto ${posto}` : "Despacho"),
                criadoEm: agora(), atribuidoEm: null, iniciadoEm: null, concluidoEm: null
            };
            d.lista.push(novo);
            gravarLocal(d);
            acordar();
            return { ok: true, pedido: novo };
        } catch (e) {
            return { ok: false, erro: erroDe(e) };
        }
    }

    async function chamar(rpc, args, local) {
        try {
            if (usarNuvem()) {
                const { data, error } = await Nuvem.cliente().rpc(rpc, args);
                if (error) return { ok: false, erro: erroDe(error) };
                if (typeof data === "string" && data !== "ok") return { ok: false, erro: data };
                await recarregar();
                acordar();
                return { ok: true };
            }
            const r = local();
            acordar();
            return r;
        } catch (e) {
            return { ok: false, erro: erroDe(e) };
        }
    }

    function tornarUrgente(id, pin) {
        return chamar("tornar_urgente", { p_pedido: id, p_pin: pin ?? null }, () => mudarLocal(id, p => {
            const posto = p.posto ? postosAtuais().find(x => x.id === p.posto) : null;
            if (pin != null) {
                if (posto && !posto.permiteUrgente) return { ok: false, erro: "Este posto não aceita pedido urgente." };
                if (String(pin) !== pinLocal()) return { ok: false, erro: "PIN não confere." };
            }
            if (p.estado !== "pendente") return { ok: false, erro: `O pedido já saiu para o AGV ${p.agv || ""}.` };
            Object.assign(p, { prioridade: 3, urgente: true, urgentePor: pin != null ? "líder (PIN)" : "Despacho" });
        }));
    }

    function alterarPrioridade(id, prioridade) {
        return chamar("alterar_prioridade", { p_pedido: id, p_prioridade: prioridade }, () => mudarLocal(id, p => {
            if (p.estado !== "pendente") return { ok: false, erro: `O pedido já saiu para o AGV ${p.agv || ""}.` };
            Object.assign(p, { prioridade, urgente: prioridade === 3 });
        }));
    }

    function liberar(id) {
        return chamar("liberar_pedido", { p_pedido: id }, () => mudarLocal(id, p => {
            if (p.estado !== "pendente") return { ok: false, erro: `O pedido já saiu para o AGV ${p.agv || ""}.` };
            p.motivo = `liberado para automático (era do AGV ${p.agvFixo})`;
            p.agvFixo = null;
        }));
    }

    // Cancela. Se já está na fila do AGV, tira de lá (só se ainda não carregou).
    async function cancelar(id) {
        const p = lista.find(x => x.id === Number(id));
        if (!p) return { ok: false, erro: "Pedido não encontrado." };
        if (p.estado === "atribuido") {
            const agv = agvs[p.agv];
            const indice = indiceNaFila(p);
            if (agv && indice < 0 && agvTemMissao(agv, p.missao)) {
                return { ok: false, erro: `O AGV ${p.agv} já carregou a missão: cancele a missão no AGV (Visão geral).` };
            }
            if (agv && indice >= 0 && typeof removerDaFilaDoAGV === "function") removerDaFilaDoAGV(agv, indice, { avisarDespacho: false });
        }
        return chamar("cancelar_pedido", { p_pedido: id }, () => mudarLocal(id, x => {
            if (!["pendente", "atribuido"].includes(x.estado)) return { ok: false, erro: "O pedido já começou; cancele a missão no AGV." };
            Object.assign(x, { estado: "cancelado", concluidoEm: agora(), motivo: "cancelado" });
        }));
    }

    /* ========================================================
       DESPACHANTE (só a aba líder)
       ======================================================== */

    function podeDespachar() {
        if (!podeNivel("despachar")) return false;
        return Object.values(agvs).some(a => typeof canalDisponivel === "function" && canalDisponivel(a));
    }

    async function renovarLideranca() {
        lider.verificado = agora();
        if (!podeDespachar()) {
            if (lider.eu && !usarNuvem()) soltarLideranca();
            lider.eu = false;
            if (!usarNuvem()) {
                try { const d = JSON.parse(localStorage.getItem(CHAVE_LIDER)); lider.nome = d && d.ate > agora() ? d.nome : ""; } catch (e) { lider.nome = ""; }
            }
            return;
        }
        if (usarNuvem()) {
            try {
                const { data, error } = await Nuvem.cliente().rpc("assumir_despacho", { p_empresa: Nuvem.empresa().id, p_sessao: SESSAO, p_nome: nomeDestaAba() });
                if (error) throw error;
                lider.eu = Boolean(data?.lider);
                lider.nome = data?.nome || "";
            } catch (e) {
                lider.eu = false;
            }
            return;
        }
        let d = null;
        try { d = JSON.parse(localStorage.getItem(CHAVE_LIDER)); } catch (e) { /* ignora */ }
        if (!d || d.ate < agora() || d.sessao === SESSAO) {
            d = { sessao: SESSAO, nome: nomeDestaAba(), ate: agora() + 6000 };
            try { localStorage.setItem(CHAVE_LIDER, JSON.stringify(d)); } catch (e) { /* ignora */ }
        }
        lider.eu = d.sessao === SESSAO;
        lider.nome = d.nome;
    }
    function soltarLideranca() {
        try {
            const d = JSON.parse(localStorage.getItem(CHAVE_LIDER));
            if (d && d.sessao === SESSAO) localStorage.removeItem(CHAVE_LIDER);
        } catch (e) { /* ignora */ }
    }
    addEventListener("pagehide", () => { if (!usarNuvem()) soltarLideranca(); });

    async function despacharNoBanco(p, agvId, motivo, eta) {
        if (usarNuvem()) {
            const { data, error } = await Nuvem.cliente().rpc("despachar_pedido", { p_pedido: p.id, p_agv: agvId, p_motivo: motivo, p_eta: eta, p_sessao: SESSAO });
            if (error) { lider.eu = false; return false; }
            if (data) Object.assign(p, { estado: "atribuido", agv: agvId, motivo, eta, atribuidoEm: agora() });
            return Boolean(data);
        }
        return mudarLocal(p.id, x => {
            if (x.estado !== "pendente" || (x.agvFixo && x.agvFixo !== agvId)) return { ok: false };
            Object.assign(x, { estado: "atribuido", agv: agvId, motivo, eta, atribuidoEm: agora() });
        }).ok;
    }

    async function atualizarNoBanco(p, estado, motivo = "") {
        const permitido = (p.estado === "atribuido" && ["em_execucao", "pendente", "falhou", "concluido"].includes(estado)) ||
            (p.estado === "em_execucao" && ["concluido", "falhou"].includes(estado));
        if (!permitido) return false;
        const mudar = x => {
            x.estado = estado;
            if (motivo) x.motivo = motivo;
            if (estado === "pendente") { x.agv = null; x.atribuidoEm = null; }
            if (estado === "em_execucao") x.iniciadoEm = agora();
            if (estado === "concluido" || estado === "falhou") x.concluidoEm = agora();
        };
        if (usarNuvem()) {
            const { data, error } = await Nuvem.cliente().rpc("atualizar_pedido", { p_pedido: p.id, p_estado: estado, p_motivo: motivo, p_sessao: SESSAO });
            if (error) { lider.eu = false; return false; }
            if (data) { mudar(p); avisar(); }
            return Boolean(data);
        }
        return mudarLocal(p.id, x => {
            const ok = (x.estado === "atribuido" && ["em_execucao", "pendente", "falhou", "concluido"].includes(estado)) ||
                (x.estado === "em_execucao" && ["concluido", "falhou"].includes(estado));
            if (!ok) return { ok: false };
            mudar(x);
        }).ok;
    }

    // Estado do AGV no formato do despachante
    function agvParaDespacho(agv) {
        const f = agv.fila;
        const itens = (f?.itens || []).length + (agv.filaPendentes || []).filter(p => agora() - p.quando < 4000).length;
        const st = agv.rotinaStatus;
        const no = agv.pontoAtual && typeof plantaPublicada === "function" ? Planta.noPorId(plantaPublicada(), agv.pontoAtual) : null;
        const usoHoje = lista.filter(p => p.agv === agv.id && p.estado === "concluido" && p.concluidoEm && new Date(p.concluidoEm).toDateString() === new Date().toDateString()).length;
        const ocupado = (typeof MISSAO_OCUPADA !== "undefined" && MISSAO_OCUPADA.includes(agv.estadoMissao)) || itens > 0 ||
            Boolean(f?.suspensa) || f?.partidaEm != null || Boolean(agv.carregamentoPendente);
        return {
            id: agv.id,
            online: Boolean(agv.online) && !(bloqueioAgv[agv.id] > agora()),
            modo: agv.modo,
            emergencia: Boolean(agv.emergencia || agv.maquina === "EMERGENCIA"),
            falha: agv.maquina === "PARADO" || agv.barreira === "FALHA_LEITURA" || agv.estadoMissao === "ERRO" || Boolean(agv.aguardandoRearme),
            turno: st ? (st.fimDeTurno || (st.estado && st.estado !== "TRABALHANDO") ? "fora" : "dentro") : null,
            bateria: agv.bateria ?? null,
            posicaoConhecida: Boolean(agv.posicaoConhecida),
            pontoAtual: agv.pontoAtual || null,
            orientacao: Number(agv.orientacao) || 0,
            ocupado,
            filaVazia: itens === 0,
            fimPrevisto: typeof pontoPrevistoFila === "function" ? pontoPrevistoFila(agv) : null,
            noBerco: no?.tipo === "BERCO",
            semFila: !f || f.flash === false,
            filaCheia: f ? itens >= (Number(f.max) || 8) : false,
            usoHoje
        };
    }

    // O AGV tem a missão (na fila, carregada ou em execução)?
    function agvTemMissao(agv, missao) {
        if (!agv) return false;
        const f = agv.fila || {};
        return (f.itens || []).some(i => i.id === missao) || f.atual?.id === missao || agv.missaoCarregada === missao ||
            agv.missaoAtual === missao || (agv.filaPendentes || []).some(p => p.id === missao && agora() - p.quando < 8000);
    }

    // Posição do pedido na fila do AGV (as atribuições do mesmo AGV e missão, em ordem)
    function indiceNaFila(p) {
        const agv = agvs[p.agv];
        const itens = agv?.fila?.itens || [];
        const irmaos = lista.filter(x => x.estado === "atribuido" && x.agv === p.agv && x.missao === p.missao).sort((a, b) => (a.atribuidoEm || 0) - (b.atribuidoEm || 0));
        const carregadaAntes = agv && (agv.missaoCarregada === p.missao || agv.missaoAtual === p.missao) ? 1 : 0;
        const ordem = irmaos.indexOf(p) - carregadaAntes;
        if (ordem < 0) return -1;
        let visto = 0;
        for (let i = 0; i < itens.length; i++) {
            if (itens[i].id === p.missao) {
                if (visto === ordem) return i;
                visto++;
            }
        }
        return -1;
    }

    async function despachar() {
        const pendentes = lista.filter(p => p.estado === "pendente");
        if (!pendentes.length) { espera = {}; return; }
        const planta = plantaPublicada();
        const r = Despachante.decidir({
            pedidos: lista.filter(p => ESTADOS_ATIVOS.includes(p.estado)).map(p => Object.assign({}, p)),
            agvs: Object.values(agvs).map(agvParaDespacho),
            planta, missoes: Array.isArray(missoes) ? missoes : [], agora: agora(),
            config: configuracao()
        });
        espera = r.espera;
        situacaoAgvs = r.agvs;
        for (const a of r.atribuicoes) {
            const p = lista.find(x => x.id === a.pedido.id);
            if (!p || p.estado !== "pendente") continue;
            if (!await despacharNoBanco(p, a.agv, a.motivo, a.eta)) continue;
            const enviado = typeof adicionarNaFilaDoAGV === "function" &&
                adicionarNaFilaDoAGV(a.agv, p.missao, { silencioso: true, prioridade: p.prioridade, pedido: p.id });
            if (enviado) {
                registrarAcaoSite?.(a.agv, "missao", "PEDIDO_DESPACHADO", `Pedido #${p.id} (${p.missao}${p.posto ? ", posto " + p.posto : ""}): ${a.motivo}`);
            } else {
                const aviso = agvs[a.agv]?.avisoMissao?.texto || "não deu para enviar";
                bloqueioAgv[a.agv] = agora() + 30000;
                const atual = lista.find(x => x.id === p.id) || p;
                await atualizarNoBanco(atual, "pendente", `AGV ${a.agv}: ${aviso}`);
            }
        }
        if (r.atribuicoes.length) avisar();
    }

    // Acompanha os pedidos já entregues pelo estado dos AGVs (rede de segurança
    // para eventos perdidos; o caminho normal é aoStatusMissao/aoEventoMissao).
    async function acompanhar() {
        for (const p of lista.filter(x => x.estado === "atribuido" || x.estado === "em_execucao")) {
            const agv = agvs[p.agv];
            if (!agv || !agv.online) continue;
            if (p.estado === "atribuido" && agora() - (p.atribuidoEm || 0) > 20000 && !agvTemMissao(agv, p.missao)) {
                await atualizarNoBanco(p, "pendente", `o AGV ${p.agv} não ficou com a missão; volta para a fila`);
            } else if (p.estado === "em_execucao" && agora() - (p.iniciadoEm || 0) > 15000 && !agvTemMissao(agv, p.missao)) {
                if (["ERRO", "CANCELADA"].includes(agv.estadoMissao)) await atualizarNoBanco(p, "falhou", `missão ${agv.estadoMissao === "ERRO" ? "com erro" : "cancelada"} no AGV`);
                else await atualizarNoBanco(p, "concluido", "fim pelo estado do AGV");
            }
        }
    }

    function primeiro(estado, agvId, missao) {
        return lista.filter(p => p.estado === estado && p.agv === agvId && p.missao === missao)
            .sort((a, b) => (a.atribuidoEm || 0) - (b.atribuidoEm || 0))[0] || null;
    }

    // Chamado pelo script.js a cada status/missao
    function aoStatusMissao(agv, status, missaoId) {
        if (!lider.eu || !agv || !missaoId || MISSAO_AUTOMATICA.test(missaoId)) return;
        if (["EM_EXECUCAO", "AGUARDANDO_CONFIRMACAO", "INTERROMPIDA"].includes(status)) {
            if (!primeiro("em_execucao", agv.id, missaoId)) {
                const p = primeiro("atribuido", agv.id, missaoId);
                if (p) atualizarNoBanco(p, "em_execucao");
            }
        } else if (status === "CONCLUIDA") {
            const p = primeiro("em_execucao", agv.id, missaoId);
            if (p) atualizarNoBanco(p, "concluido");
        } else if (status === "CANCELADA" || status === "ERRO") {
            const p = primeiro("em_execucao", agv.id, missaoId);
            if (p) atualizarNoBanco(p, "falhou", status === "ERRO" ? "erro na missão" : "missão cancelada no AGV");
        }
    }

    // Chamado pelo script.js a cada evento/missao
    function aoEventoMissao(agv, tipo, dados) {
        if (!lider.eu || !agv) return;
        const missao = dados?.missao ? String(dados.missao) : null;
        const chave = `${agv.id}|${tipo}|${missao}|${dados?.t ?? dados?.instante ?? Math.floor(agora() / 500)}`;
        if (vistos.has(chave)) return;
        vistos.add(chave);
        if (vistos.size > 500) vistos.clear();
        if (missao && MISSAO_AUTOMATICA.test(missao)) return;
        if (tipo === "MISSAO_INICIADA" && missao) aoStatusMissao(agv, "EM_EXECUCAO", missao);
        if (tipo === "MISSAO_CONCLUIDA" && missao) {
            const p = primeiro("em_execucao", agv.id, missao) || primeiro("atribuido", agv.id, missao);
            if (p) atualizarNoBanco(p, "concluido");
        }
        if (tipo === "MISSAO_ERRO" && missao) {
            const p = primeiro("em_execucao", agv.id, missao);
            if (p) atualizarNoBanco(p, "falhou", dados?.mensagem || "erro na missão");
        }
        if (tipo === "FILA_REJEITADA") {
            const p = lista.filter(x => x.estado === "atribuido" && x.agv === agv.id && agora() - (x.atribuidoEm || 0) < 15000)
                .sort((a, b) => (b.atribuidoEm || 0) - (a.atribuidoEm || 0))[0];
            if (p) {
                bloqueioAgv[agv.id] = agora() + 30000;
                atualizarNoBanco(p, "pendente", `AGV ${agv.id} recusou: ${dados?.mensagem || "fila"}`);
            }
        }
    }

    // O operador tirou uma missão da fila do AGV pelo × da Visão geral
    function aoRemoverDaFila(agv, missaoId, indice) {
        const candidatos = lista.filter(p => p.estado === "atribuido" && p.agv === agv.id && p.missao === missaoId);
        const p = candidatos.find(x => indiceNaFila(x) === indice) || candidatos[candidatos.length - 1];
        if (!p) return;
        chamar("cancelar_pedido", { p_pedido: p.id }, () => mudarLocal(p.id, x => {
            Object.assign(x, { estado: "cancelado", concluidoEm: agora(), motivo: "tirado da fila do AGV" });
        }));
    }

    function configuracao() {
        try { return JSON.parse(localStorage.getItem("despachoConfig") || "{}"); } catch (e) { return {}; }
    }

    /* ========================================================
       CICLO
       ======================================================== */

    async function ciclo() {
        if (rodando) return;
        rodando = true;
        try {
            if (agora() - lider.verificado > 3000) await renovarLideranca();
            if (usarNuvem() && agora() - ultimaLeitura > (tempoRealOk ? 15000 : 2500)) await recarregar();
            if (lider.eu) {
                await acompanhar();
                await despachar();
            }
        } catch (e) {
            console.error("Despacho:", e);
        } finally {
            rodando = false;
        }
        desenhar();
    }

    function acordar() {
        clearTimeout(timerAcordar);
        timerAcordar = setTimeout(ciclo, 60);
    }

    async function iniciar() {
        await recarregar();
        iniciarTempoReal();
        await renovarLideranca();
        setInterval(ciclo, 1000);
        ciclo();
    }

    /* ========================================================
       TEXTOS (usados pela tela Despacho, pela tela do posto e
       pelos cartões dos AGVs)
       ======================================================== */

    function nomeMissao(id) {
        const m = missaoPorId(id);
        return m ? (m.nome || m.id) : id;
    }
    function textoEstado(p) {
        return (NOMES_ESTADO[p.estado] || [p.estado])[0];
    }
    function corEstado(p) {
        return (NOMES_ESTADO[p.estado] || [0, "cinza"])[1];
    }
    // segundos até terminar (estimativa), ou null
    function faltam(p) {
        if (!["atribuido", "em_execucao"].includes(p.estado) || !p.eta) return null;
        return Math.max(0, Math.round(p.eta - (agora() - (p.atribuidoEm || agora())) / 1000));
    }
    function textoTempo(s) {
        if (s == null) return "";
        if (s < 60) return `${s} s`;
        return `${Math.round(s / 60)} min`;
    }
    function porQue(p) {
        if (p.estado === "pendente") return espera[p.id] || p.motivo || "aguardando o despachante";
        return p.motivo || "";
    }
    const nomePrioridade = p => p.urgente ? "Urgente" : Despachante.NOMES_PRIORIDADE[p.prioridade] || "Normal";

    /* ========================================================
       TELA DESPACHO
       ======================================================== */

    let selecionado = null, mapa = null, animacao = null, mostrarFinais = false;

    function abrir() {
        montarFormulario();
        desenhar(true);
        renderizarMapa(true);
    }
    const visivel = () => document.getElementById("despacho")?.classList.contains("ativa") && !document.hidden;

    function montarFormulario() {
        const selM = document.getElementById("despachoMissao");
        const selA = document.getElementById("despachoAgv");
        if (!selM || !selA) return;
        const assM = (missoes || []).map(m => `${m.id}:${m.nome}:${m.prioridade ?? 1}`).join("|");
        if (selM.dataset.ass !== assM) {
            const atual = selM.value;
            selM.innerHTML = `<option value="">${missoes.length ? "Escolha a missão" : "Nenhuma missão cadastrada"}</option>` +
                missoes.map(m => `<option value="${esc(m.id)}">${esc(m.id)} · ${esc(m.nome || "")} (${esc(Despachante.NOMES_PRIORIDADE[m.prioridade ?? 1])})</option>`).join("");
            selM.value = atual;
            selM.dataset.ass = assM;
        }
        const ids = Object.keys(agvs).sort();
        const assA = ids.join("|");
        if (selA.dataset.ass !== assA) {
            const atual = selA.value;
            selA.innerHTML = `<option value="">Automático (o sistema escolhe)</option>` + ids.map(id => `<option value="${esc(id)}">AGV ${esc(id)} · ${esc(agvs[id].nome || "")}</option>`).join("");
            selA.value = atual;
            selA.dataset.ass = assA;
        }
    }

    async function pedirPeloDespacho() {
        const missao = document.getElementById("despachoMissao")?.value;
        const agvFixo = document.getElementById("despachoAgv")?.value || null;
        if (!missao) { ui.aviso("Escolha a missão.", "aviso"); return; }
        let r = await criar({ missao, agvFixo, criadoPor: "Despacho" });
        if (!r.ok && r.repetido) {
            if (await ui.confirmar({ titulo: "Pedido repetido", texto: `${r.erro} Pedir mais um mesmo assim?`, confirmar: "Pedir mais um" })) r = await criar({ missao, agvFixo, repetir: true, criadoPor: "Despacho" });
            else return;
        }
        if (r.ok) ui.aviso(`Pedido #${r.pedido.id} na fila${agvFixo ? ` para o AGV ${agvFixo}` : ""}.`, "sucesso");
        else ui.aviso(r.erro, "erro");
        desenhar();
    }

    function htmlPedido(p) {
        const f = faltam(p);
        const tempo = p.estado === "pendente" ? `esperando há ${textoTempo(Math.round((agora() - p.criadoEm) / 1000))}`
            : f != null ? (p.estado === "atribuido" ? `termina em ~${textoTempo(f)}` : `termina em ~${textoTempo(f)}`)
            : p.concluidoEm ? (typeof tempoRelativo === "function" ? tempoRelativo(p.concluidoEm) : "") : "";
        const operar = podeNivel("operar");
        const acoes = [];
        if (p.estado === "pendente" && !p.urgente && podeNivel("urgente")) acoes.push(`<button type="button" class="btn btn-mini" data-desp="urgente" data-id="${p.id}">Urgente</button>`);
        if (p.estado === "pendente" && operar) {
            acoes.push(`<select class="desp-prio" data-desp="prioridade" data-id="${p.id}" aria-label="Prioridade do pedido ${p.id}">${Despachante.NOMES_PRIORIDADE.map((n, i) => `<option value="${i}" ${i === p.prioridade ? "selected" : ""}>${n}</option>`).join("")}</select>`);
            if (p.agvFixo) acoes.push(`<button type="button" class="btn btn-mini" data-desp="liberar" data-id="${p.id}">Liberar para automático</button>`);
        }
        if (["pendente", "atribuido"].includes(p.estado) && operar) acoes.push(`<button type="button" class="btn btn-mini btn-perigo-suave" data-desp="cancelar" data-id="${p.id}">Cancelar</button>`);
        const agvTxt = p.agv ? `AGV ${esc(p.agv)}` : p.agvFixo ? `só AGV ${esc(p.agvFixo)}` : "automático";
        return `<article class="desp-pedido ${p.id === selecionado ? "selecionado" : ""} ${p.urgente ? "urgente" : ""}" data-pedido="${p.id}" tabindex="0">
            <div class="desp-linha1">
                <span class="desp-num">#${p.id}</span>
                <strong>${esc(p.missao)}</strong><span class="suave">${esc(nomeMissao(p.missao))}</span>
                <span class="pilula ${p.urgente ? "vermelho" : p.prioridade >= 2 ? "ambar" : ""}">${nomePrioridade(p)}</span>
                <span class="pilula ${corEstado(p)}">${textoEstado(p)}</span>
            </div>
            <div class="desp-linha2">
                <span>${p.posto ? `Posto <b>${esc(p.posto)}</b>` : esc(p.criadoPor || "Despacho")}</span>
                <span>${agvTxt}</span>
                <span class="suave">${esc(tempo)}</span>
            </div>
            ${porQue(p) ? `<div class="desp-motivo">${esc(porQue(p))}</div>` : ""}
            ${acoes.length ? `<div class="desp-acoes">${acoes.join("")}</div>` : ""}
        </article>`;
    }

    function desenhar(forcar) {
        if (typeof window.aoMudarDespacho === "function") window.aoMudarDespacho();
        if (!document.getElementById("despacho")?.classList.contains("ativa") && !forcar) return;
        const caixaLider = document.getElementById("despachoLider");
        if (caixaLider) {
            const html = lider.eu
                ? `<span class="pilula verde">Despachando nesta aba</span>`
                : lider.nome ? `<span class="pilula">Despachante: ${esc(lider.nome)}</span>`
                : `<span class="pilula ambar" title="Abra o site com um usuário que opera os AGVs (ou o tablet de um posto) e MQTT conectado">Ninguém despachando</span>`;
            ui.trocarHtml(caixaLider, html);
        }
        const ativos = lista.filter(p => ESTADOS_ATIVOS.includes(p.estado));
        const pendentes = Despachante.ordenar(ativos.filter(p => p.estado === "pendente"), agora(), configuracao());
        const andamento = ativos.filter(p => p.estado !== "pendente").sort((a, b) => (a.atribuidoEm || 0) - (b.atribuidoEm || 0));
        const finais = lista.filter(p => !ESTADOS_ATIVOS.includes(p.estado)).sort((a, b) => (b.concluidoEm || b.id) - (a.concluidoEm || a.id)).slice(0, 30);
        const blocos = [
            ["Na fila", pendentes, "Nenhum pedido esperando."],
            ["Em andamento", andamento, "Nenhum AGV fazendo pedido agora."]
        ];
        let html = blocos.map(([titulo, itens, vazio]) => `
            <section class="desp-bloco"><h3>${titulo} <span class="suave">${itens.length}</span></h3>
            ${itens.length ? itens.map(htmlPedido).join("") : `<p class="suave desp-vazio">${vazio}</p>`}</section>`).join("");
        html += `<section class="desp-bloco"><h3><button type="button" class="desp-alternar" data-desp="finais" aria-expanded="${mostrarFinais}">Concluídos e cancelados (últimas 12 h) <span class="suave">${finais.length}</span></button></h3>
            ${mostrarFinais ? (finais.length ? finais.map(htmlPedido).join("") : `<p class="suave desp-vazio">Nada ainda.</p>`) : ""}</section>`;
        const caixa = document.getElementById("despachoLista");
        if (caixa) ui.trocarHtml(caixa, html);
        const resumo = document.getElementById("despachoResumo");
        if (resumo) {
            const livres = Object.values(agvs).filter(a => !agvParaDespacho(a).ocupado && a.online).length;
            const t = `${pendentes.length} na fila · ${andamento.length} em andamento · ${livres} AGV${livres === 1 ? "" : "s"} livre${livres === 1 ? "" : "s"}`;
            if (resumo.textContent !== t) resumo.textContent = t;
        }
        if (visivel()) renderizarMapa();
    }

    document.addEventListener("click", async e => {
        const b = e.target.closest("[data-desp]");
        if (b && b.tagName !== "SELECT") {
            const id = Number(b.dataset.id);
            let r = null;
            if (b.dataset.desp === "urgente") {
                if (!await ui.confirmar({ titulo: "Pedido urgente", texto: `Tornar o pedido #${id} urgente? Ele passa na frente da fila e no tráfego.`, confirmar: "Tornar urgente" })) return;
                r = await tornarUrgente(id);
            }
            if (b.dataset.desp === "liberar") r = await liberar(id);
            if (b.dataset.desp === "cancelar") {
                if (!await ui.confirmar({ titulo: "Cancelar pedido", texto: `Cancelar o pedido #${id}?`, confirmar: "Cancelar pedido", perigo: true })) return;
                r = await cancelar(id);
            }
            if (b.dataset.desp === "finais") { mostrarFinais = !mostrarFinais; desenhar(); return; }
            if (r && !r.ok) ui.aviso(r.erro, "erro");
            desenhar();
            return;
        }
        const art = e.target.closest("#despachoLista .desp-pedido");
        if (art) {
            selecionado = Number(art.dataset.pedido) === selecionado ? null : Number(art.dataset.pedido);
            desenhar();
            renderizarMapa();
        }
    });
    document.addEventListener("change", async e => {
        const s = e.target.closest("select[data-desp='prioridade']");
        if (!s) return;
        const r = await alterarPrioridade(Number(s.dataset.id), Number(s.value));
        if (!r.ok) ui.aviso(r.erro, "erro");
        s.blur();
        desenhar();
    });
    document.getElementById("btnDespachoPedir")?.addEventListener("click", pedirPeloDespacho);

    /* ---------------- mapa do Despacho ---------------- */

    function renderizarMapa(abrindo) {
        const container = document.getElementById("mapaDespacho");
        if (!container || typeof MapaSVG === "undefined") return;
        if (!mapa) {
            mapa = MapaSVG.criar(container, { rota: true, rastro: false, outros: true, mostrarTags: false });
            mapa.sobreposicao = desenharPostos;
        }
        const planta = plantaPublicada();
        if (mapa.planta !== planta || abrindo) {
            mapa.ajustado = false;
            mapa.definirPlanta(planta);
        }
        const p = lista.find(x => x.id === selecionado) || null;
        const agvDoPedido = p && p.agv ? agvs[p.agv] : null;
        mapa.agvs = Object.values(agvs).map(agv => {
            const pose = typeof poseEstimadaAGV === "function" ? poseSuavizada(agv, poseEstimadaAGV(agv), 100) : null;
            if (!pose) return null;
            const cat = categoriaEstadoAGV(agv);
            return Object.assign({}, pose, { id: agv.id, rotulo: `AGV ${agv.id}`, destaque: agv === agvDoPedido, estado: cat.chave, carga: typeof garraCarregada === "function" && garraCarregada(agv) });
        }).filter(Boolean);
        const rota = agvDoPedido && (agvDoPedido.missaoAtual === p.missao || agvDoPedido.missaoCarregada === p.missao) ? rotaDoAGV(agvDoPedido) : null;
        mapa.rota = rota;
        const destinos = new Set();
        if (p) {
            const m = missaoPorId(p.missao);
            (m?.etapas || []).filter(e => e.tipo === "IR_PARA").forEach(e => {
                const c = Planta.candidatosDestino(planta, e.destino);
                (c?.nos || []).forEach(n => destinos.add(n.id));
            });
        }
        mapa.destinos = destinos;
        mapa.desenhar();
        if (!animacao && visivel()) {
            animacao = setInterval(() => {
                if (!visivel()) { clearInterval(animacao); animacao = null; return; }
                renderizarMapa();
            }, 150);
        }
    }

    // Postos no mapa: nome e quantos pedidos esperando
    function desenharPostos(m, grupo, { Y, px, tema }) {
        const t = tema || MapaSVG.tema();
        const planta = m.planta;
        postosAtuais().forEach(posto => {
            const no = posto.ponto ? (Planta.noPorId(planta, posto.ponto) || Planta.acessosDaEstacao(planta, posto.ponto)?.[0]) : null;
            if (!no) return;
            const n = lista.filter(p => p.posto === posto.id && ESTADOS_ATIVOS.includes(p.estado)).length;
            const urg = lista.some(p => p.posto === posto.id && p.urgente && ESTADOS_ATIVOS.includes(p.estado));
            const texto = `${posto.id}${n ? ` · ${n}` : ""}`;
            const largura = px(12 + texto.length * 7);
            // à esquerda do ponto (em cima fica o nome da máquina, à direita o id do ponto)
            const x = no.x - px(16) - largura / 2, y = Y(no.y);
            MapaSVG.el("rect", { x: x - largura / 2, y: y - px(11), width: largura, height: px(20), rx: px(10),
                fill: n ? (urg ? t.red : t.accent) : t.card, stroke: n ? "none" : t.borda, "stroke-width": px(1) }, grupo);
            const el = MapaSVG.el("text", { x, y: y + px(4), "text-anchor": "middle", "font-size": px(11), "font-weight": 700,
                fill: n ? "#fff" : t.texto, "pointer-events": "none" }, grupo);
            el.textContent = texto;
        });
    }

    return {
        iniciar, abrir, desenhar, acordar,
        lista: () => lista.slice(), lider: () => Object.assign({}, lider), sessao: SESSAO,
        criar, tornarUrgente, alterarPrioridade, cancelar, liberar,
        aoStatusMissao, aoEventoMissao, aoRemoverDaFila, ouvir: f => ouvintes.add(f),
        nomeMissao, textoEstado, corEstado, faltam, textoTempo, porQue, nomePrioridade, postos: postosAtuais,
        ESTADOS_ATIVOS, pinLocal
    };
})();
