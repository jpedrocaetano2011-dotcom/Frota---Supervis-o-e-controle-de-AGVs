/* ============================================================
   MIRA (0.18) — a assistente do Eciton, no navegador
   ============================================================
   - Botão "Mira" no canto; o painel conversa com a Edge Function
     "mira" do Supabase (a chave da Anthropic fica lá, nunca aqui).
   - Vai junto da pergunta um retrato do que está na tela (frota,
     pedidos, programação, planta), sem PIN, e-mail nem senha.
   - Mira Pro (adicional): diagnóstico com histórico, resumo do turno,
     análise de indicadores, "A Mira notou" (regras detectam aqui,
     a IA explica quando a pessoa pede) e AÇÕES QUE A PESSOA CONFIRMA.
   - Não aparece no tablet do posto. Sem nuvem, explica que precisa dela.
*/
(function (raiz) {
    "use strict";
    const $ = id => document.getElementById(id);
    const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
    const naNuvem = () => typeof Nuvem !== "undefined" && Nuvem.emNuvem && Nuvem.emNuvem() && Nuvem.cliente && Nuvem.cliente();
    const papel = () => (typeof Nuvem !== "undefined" && Nuvem.papel ? Nuvem.papel() : "admin");

    const estado = {
        aberta: false, modo: "mira", plano: null, conversa: [], ocupada: false, restantes: {},
        notou: { fila: [], vistos: new Map(), desde: new Map(), visivel: null, online: new Set() }
    };
    const NOME_TELA = () => {
        const t = document.querySelector(".tela.ativa");
        return t ? t.id : "";
    };
    const TITULO_TELA = () => (document.querySelector(".tela.ativa h1, .tela.ativa .titulo-tela")?.textContent || NOME_TELA()).trim().slice(0, 60);

    /* ---------- o pacote (o que esta empresa tem) ---------- */
    async function carregarPlano() {
        if (!naNuvem()) { estado.plano = null; return null; }
        try {
            const { data, error } = await Nuvem.cliente().rpc("meu_plano");
            estado.plano = error ? null : data;
        } catch (e) { estado.plano = null; }
        if (!temPro() && estado.modo === "pro") estado.modo = "mira";
        desenharCabecalho();
        return estado.plano;
    }
    const temMira = () => Boolean(estado.plano?.funcoes?.mira);
    const temPro = () => Boolean(estado.plano?.funcoes?.mira_pro);
    const disponivel = () => papel() !== "posto";

    /* ---------- o retrato do que está acontecendo ---------- */
    function contexto() {
        const lista = typeof agvs !== "undefined" ? Object.values(agvs) : [];
        const cat = a => (typeof categoriaEstadoAGV === "function" ? categoriaEstadoAGV(a) : { chave: "" });
        const c = {
            agora: new Date().toISOString(),
            agvs: lista.slice(0, 40).map(a => ({
                id: a.id, nome: a.nome || "", modelo: a.modelo || "", estado: cat(a).chave, situacao: cat(a).texto, online: Boolean(a.online),
                modo: a.modo || "", ponto: a.pontoAtual || "", missao: a.missaoAtual || "", estadoMissao: a.estadoMissao || "",
                led: a.leds || "", barreira: a.barreira || "", fila: (a.fila?.itens || []).length, virtual: Boolean(a.virtual),
                manutencao: typeof Manutencao !== "undefined" && Manutencao.ativa(a) ? (Manutencao.atual(a)?.motivo || "sim") : ""
            }))
        };
        if (typeof Despacho !== "undefined") {
            const ativos = ["pendente", "atribuido", "em_execucao"];
            c.pedidos = Despacho.lista().filter(p => ativos.includes(p.estado)).slice(0, 30).map(p => ({
                id: p.id, missao: p.missao, posto: p.posto, estado: p.estado, agv: p.agv, prioridade: p.prioridade, urgente: p.urgente,
                motivo: p.motivo, origem: p.origem, esperandoMin: p.criadoEm ? Math.round((Date.now() - p.criadoEm) / 6000) / 10 : null
            }));
            c.postos = Despacho.postos().slice(0, 40).map(p => ({ id: p.id, nome: p.nome, botoes: (p.botoes || []).map(b => b.missao) }));
        }
        if (typeof Programacao !== "undefined" && Programacao.lista) {
            c.programacoes = Programacao.lista().filter(p => p.ativo !== false).slice(0, 40).map(p => {
                const s = Programacao.situacaoDe ? Programacao.situacaoDe(p.posto, p.missao) : null;
                return { posto: p.posto, missao: p.missao, modo: p.modo, dura_min: p.dura_min ?? null, intervalo_min: p.intervalo_min ?? null,
                    pausado: Boolean(p.pausado), motivo: p.pausa_motivo || "", situacao: s?.situacao || "", proximoEmMin: s?.devidoEm ? Math.round((s.devidoEm - Date.now()) / 6000) / 10 : null };
            });
            try { const k = Programacao.capacidade(); c.capacidade = { viagensHora: k.viagensH, frota: k.frota, uso: k.uso }; } catch (e) { /* ignora */ }
        }
        if (typeof missoes !== "undefined") c.missoes = missoes.slice(0, 80).map(m => ({ id: m.id, nome: m.nome }));
        if (typeof plantaPublicada === "function") {
            const pl = plantaPublicada();
            if (pl) c.planta = { nome: pl.nome, revisao: pl.revisao, estacoes: (pl.estacoes || []).length, pontos: (pl.nos || []).length, desenhoCAD: Boolean(pl.desenho), modelos3d: (pl.modelos3d || []).length };
        }
        // 0.19: Eciton I/O, corredores fechados e impasses
        if (typeof Dispositivos !== "undefined") {
            const d = Dispositivos.resumo();
            if (d.length) c.dispositivos = d;
        }
        if (typeof TrafegoOperacao !== "undefined") {
            const f = TrafegoOperacao.ativos().map(x => ({ trecho: x.segmento, motivo: x.motivo || "", ate: x.ate || "até reabrir" }));
            if (f.length) c.corredoresFechados = f;
            const i = TrafegoOperacao.impassesConfirmados ? TrafegoOperacao.impasses() : [];
            if (i.length) c.impasses = i;
        }
        if (NOME_TELA() === "indicadores") c.indicadores = (document.getElementById("indicadoresConteudo")?.innerText || "").slice(0, 4000);
        return c;
    }

    /* ---------- conversar ---------- */
    async function perguntar(texto, opcoes = {}) {
        texto = String(texto || "").trim();
        if (estado.ocupada) return;
        if (!naNuvem()) { mostrar({ de: "mira", texto: "A Mira funciona com a nuvem do Eciton ligada (Supabase). Neste modo local, só no navegador, ela fica desligada." }); return; }
        if (!disponivel()) return;
        const modo = opcoes.modo || estado.modo;
        const tarefa = opcoes.tarefa || "pergunta";
        if (!texto && tarefa === "pergunta") return;
        const hist = estado.conversa.filter(m => m.texto && !m.erro).slice(-12).map(m => ({ de: m.de, texto: m.texto }));
        mostrar({ de: "eu", texto: texto || opcoes.rotulo || tarefa });
        const pensando = mostrar({ de: "mira", texto: "", pensando: true, modo });
        estado.ocupada = true; desenharEntrada();
        let r;
        try {
            const { data, error } = await Nuvem.cliente().functions.invoke("mira", {
                body: { modo, tarefa, pergunta: texto, tela: TITULO_TELA(), contexto: contexto(), historico: hist, alerta: opcoes.alerta || null }
            });
            if (error) {
                let msg = error.message || "erro";
                try { const j = await error.context.json(); msg = j.erro || msg; } catch (e) { /* ignora */ }
                if (error.context?.status === 404) msg = "A Mira ainda não foi ligada nesta empresa: falta publicar a função \"mira\" no Supabase (veja o LEIAME).";
                else if (/Failed to send|fetch/i.test(msg)) msg = "Sem conexão com a Mira agora. Tente de novo em instantes.";
                r = { erro: msg };
            } else r = data;
        } catch (e) { r = { erro: "Sem conexão com a Mira agora." }; }
        estado.ocupada = false;
        Object.assign(pensando, r?.erro ? { texto: r.erro, erro: true, pensando: false } : { texto: r.texto, acoes: r.acoes || [], id: r.id, pensando: false });
        if (r?.restantes) estado.restantes[modo] = r.restantes;
        desenharConversa(); desenharEntrada();
        return r;
    }
    function mostrar(m) { estado.conversa.push(m); if (estado.conversa.length > 60) estado.conversa.shift(); desenharConversa(); return m; }

    /* ---------- as ações sugeridas (a pessoa confirma) ---------- */
    const EXECUTAR = {
        async pausar_programacao(a) { return Programacao.pausar(a.posto, a.missao, true, a.motivo ? `${a.motivo} (sugerido pela Mira)` : "sugerido pela Mira"); },
        async retomar_programacao(a) { return Programacao.pausar(a.posto, a.missao, false, ""); },
        async pular_programacao(a) { return Programacao.pular(a.posto, a.missao); },
        async ajustar_consumo(a) { return Programacao.ajustarConsumo(a.posto, a.missao, a.dura_min); },
        async criar_pedido(a) { const r = await Despacho.criar({ missao: a.missao, posto: a.posto || null }); return r && r.ok === false ? r : { ok: true }; },
        async cancelar_pedido(a) {
            const p = Despacho.lista().find(x => x.id === Number(a.pedido));
            if (!p || p.estado !== "pendente") return { ok: false, erro: "Este pedido já começou ou não existe mais: não dá para cancelar por aqui." };
            const r = await Despacho.cancelar(p.id); return r && r.ok === false ? r : { ok: true };
        },
        async mudar_prioridade(a) { const r = await Despacho.alterarPrioridade(Number(a.pedido), Number(a.prioridade)); return r && r.ok === false ? r : { ok: true }; },
        async por_em_manutencao(a) { await Manutencao.entrar(a.agv); return { ok: Boolean(Manutencao.ativa(a.agv)), erro: Manutencao.ativa(a.agv) ? "" : "Ficou fora da manutenção (o formulário foi cancelado?)." }; }
    };
    async function confirmarAcao(m, i) {
        const ac = m.acoes?.[i];
        if (!ac || ac.feita) return;
        const ok = ac.tipo === "por_em_manutencao" || await ui.confirmar({ titulo: "Fazer o que a Mira sugeriu?", texto: ac.rotulo + "\n\nA ação fica registrada como sugerida pela Mira e confirmada por você.", confirmar: "Confirmar" });
        if (!ok) return;
        let r;
        try { r = await EXECUTAR[ac.tipo](ac.args); } catch (e) { r = { ok: false, erro: e.message }; }
        if (r && r.ok === false) { ui.aviso(r.erro || "Não deu para fazer.", "erro"); return; }
        ac.feita = true;
        if (m.id && naNuvem()) Nuvem.cliente().rpc("mira_confirmou", { p_conversa: m.id, p_acao: { tipo: ac.tipo, args: ac.args } }).then(() => {}, () => {});
        ui.aviso(`Feito: ${ac.rotulo}.`, "sucesso");
        desenharConversa();
    }

    /* ---------- "A Mira notou" (só na Pro): regras aqui, explicação na IA ---------- */
    function verificarRegras() {
        if (!temPro() || !disponivel() || !naNuvem()) return;
        const agora = Date.now();
        const achados = [];
        const desde = estado.notou.desde;
        const marcar = (k, ativo) => { if (!ativo) { desde.delete(k); return 0; } if (!desde.has(k)) desde.set(k, agora); return (agora - desde.get(k)) / 60000; };
        if (typeof agvs !== "undefined") for (const a of Object.values(agvs)) {
            if (typeof Manutencao !== "undefined" && Manutencao.ativa(a)) continue;
            const c = typeof categoriaEstadoAGV === "function" ? categoriaEstadoAGV(a) : { chave: "" };
            const minF = marcar("falha:" + a.id, ["falha", "emergencia"].includes(c.chave));
            if (minF >= 1) achados.push({ chave: "falha:" + a.id, texto: `${a.nome || a.id} está em ${c.texto.toLowerCase()} há ${Math.round(minF)} min${a.pontoAtual ? " em " + a.pontoAtual : ""}.` });
            const minA = marcar("atencao:" + a.id, c.chave === "atencao");
            if (minA >= 3) achados.push({ chave: "atencao:" + a.id, texto: `${a.nome || a.id} está parado (${c.texto.toLowerCase()}) há ${Math.round(minA)} min${a.pontoAtual ? " em " + a.pontoAtual : ""}.` });
            if (a.online) estado.notou.online.add(a.id);
            const minO = marcar("offline:" + a.id, !a.online && estado.notou.online.has(a.id) && !a.virtual);
            if (minO >= 2) achados.push({ chave: "offline:" + a.id, texto: `${a.nome || a.id} está sem conexão há ${Math.round(minO)} min.` });
        }
        if (typeof Despacho !== "undefined") for (const p of Despacho.lista().filter(p => p.estado === "pendente" && p.criadoEm)) {
            const min = (agora - p.criadoEm) / 60000;
            if (min >= 5) achados.push({ chave: "pedido:" + p.id, texto: `O pedido ${p.id} (${Despacho.nomeMissao ? Despacho.nomeMissao(p.missao) : p.missao}${p.posto ? ", " + p.posto : ""}) espera um AGV há ${Math.round(min)} min.` });
        }
        if (typeof Programacao !== "undefined" && Programacao.capacidade) {
            try { const k = Programacao.capacidade(); if (k.uso != null && k.uso > 0.85) achados.push({ chave: "capacidade", texto: `As programações pedem ${Math.round(k.uso * 100)}% do que a frota faz: os pedidos vão começar a atrasar.` }); } catch (e) { /* ignora */ }
        }
        for (const x of achados) {
            const visto = estado.notou.vistos.get(x.chave);
            if (visto && agora - visto < 60 * 60000) continue;
            estado.notou.vistos.set(x.chave, agora);
            estado.notou.fila.push(x);
        }
        mostrarNotou();
    }
    function mostrarNotou() {
        const caixa = $("miraNotou");
        if (!caixa || estado.notou.visivel || !estado.notou.fila.length) return;
        const x = estado.notou.visivel = estado.notou.fila.shift();
        caixa.innerHTML = `<div class="mira-notou-cartao" role="status">
            <span class="mira-notou-rot"><i class="mira-icone" aria-hidden="true"></i>A Mira notou</span>
            <p>${esc(x.texto)}</p>
            <div class="mira-notou-acoes"><button type="button" class="btn btn-mini btn-primario" data-mira-notou="explicar">Explicar</button><button type="button" class="btn btn-mini" data-mira-notou="dispensar">Dispensar</button></div>
        </div>`;
        caixa.hidden = false;
    }
    function fecharNotou() { const c = $("miraNotou"); if (c) { c.hidden = true; c.innerHTML = ""; } estado.notou.visivel = null; setTimeout(mostrarNotou, 400); }

    /* ---------- tela ---------- */
    const SUGESTOES = {
        visaoGeral: ["Por que este AGV está parado?", "Como mando uma missão para um AGV?"],
        frota: ["O que significa cada cor do LED?", "Como ponho um AGV em manutenção?"],
        despacho: ["Por que este pedido não saiu?", "Como torno um pedido urgente?"],
        programacao: ["Qual a diferença entre consumo e a cada X minutos?", "Por que a Prensa adiantou?"],
        controlePlanta: ["Como importo o DXF do AutoCAD?", "Como crio um ramal para o rebocador?"],
        indicadores: ["O que é tempo esperando passagem?", "Como tiro o relatório do piloto?"],
        postos: ["Como escolho quem atende um botão?", "Para que serve o PIN pessoal?"],
        agvVirtual: ["Como uso a frota de exemplo?", "Quantos Atta eu preciso?"]
    };
    function montar() {
        if ($("miraBotao")) return;
        const b = document.createElement("button");
        b.type = "button"; b.id = "miraBotao"; b.className = "mira-botao"; b.setAttribute("aria-label", "Abrir a Mira, a assistente do Eciton");
        b.innerHTML = `<i class="mira-icone" aria-hidden="true"></i><span>Mira</span>`;
        const p = document.createElement("aside");
        p.id = "miraPainel"; p.className = "mira-painel"; p.hidden = true; p.setAttribute("aria-label", "Mira, a assistente do Eciton");
        p.innerHTML = `<header class="mira-topo"><div id="miraCabecalho"></div><button type="button" class="mira-fechar" data-mira="fechar" aria-label="Fechar a Mira">×</button></header>
            <div class="mira-conversa" id="miraConversa" aria-live="polite"></div>
            <div class="mira-rodape"><div class="mira-sugestoes" id="miraSugestoes"></div>
            <form class="mira-entrada" id="miraForm"><textarea id="miraTexto" rows="2" maxlength="2000" placeholder="Pergunte à Mira… (Enter envia)"></textarea><button type="submit" class="btn btn-primario" id="miraEnviar">Enviar</button></form>
            <p class="mira-aviso" id="miraAviso">A Mira pode errar: confira antes de agir.</p></div>`;
        const n = document.createElement("div");
        n.id = "miraNotou"; n.className = "mira-notou"; n.hidden = true;
        document.body.append(b, p, n);
        b.addEventListener("click", () => abrir(!estado.aberta));
        p.addEventListener("click", e => {
            const x = e.target.closest("[data-mira]");
            if (!x) return;
            const a = x.dataset.mira;
            if (a === "fechar") abrir(false);
            else if (a === "modo") { estado.modo = x.dataset.modo === "pro" && temPro() ? "pro" : "mira"; desenharCabecalho(); desenharSugestoes(); desenharEntrada(); }
            else if (a === "sugestao") perguntar(x.textContent);
            else if (a === "resumo") perguntar("", { modo: "pro", tarefa: "resumo_turno", rotulo: "Resumo do turno" });
            else if (a === "analisar") perguntar("Analise os indicadores desta tela.", { modo: "pro", tarefa: "analisar_indicadores" });
            else if (a === "acao") confirmarAcao(estado.conversa[Number(x.dataset.m)], Number(x.dataset.i));
            else if (a === "copiar") { navigator.clipboard?.writeText(estado.conversa[Number(x.dataset.m)].texto).then(() => ui.aviso("Copiado.", "sucesso"), () => {}); }
        });
        $("miraForm").addEventListener("submit", e => { e.preventDefault(); const t = $("miraTexto").value; $("miraTexto").value = ""; perguntar(t); });
        $("miraTexto").addEventListener("keydown", e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); $("miraForm").requestSubmit(); } });
        n.addEventListener("click", e => {
            const x = e.target.closest("[data-mira-notou]");
            if (!x || !estado.notou.visivel) return;
            const v = estado.notou.visivel;
            if (x.dataset.miraNotou === "explicar") { abrir(true); perguntar(`A Mira notou: ${v.texto} O que aconteceu e o que eu faço?`, { modo: "pro", tarefa: "explicar_alerta", alerta: v.texto }); }
            fecharNotou();
        });
        document.addEventListener("keydown", e => { if (e.key === "Escape" && estado.aberta) abrir(false); });
        atualizarVisibilidade();
    }
    function abrir(sim) {
        estado.aberta = Boolean(sim);
        $("miraPainel").hidden = !estado.aberta;
        $("miraBotao").classList.toggle("ativo", estado.aberta);
        if (estado.aberta) {
            if (!estado.plano && naNuvem()) carregarPlano();
            desenharCabecalho(); desenharSugestoes(); desenharConversa(); desenharEntrada();
            setTimeout(() => $("miraTexto")?.focus(), 30);
        }
    }
    function desenharCabecalho() {
        const c = $("miraCabecalho");
        if (!c) return;
        const pro = temPro();
        c.innerHTML = `<b class="mira-nome"><i class="mira-icone" aria-hidden="true"></i>Mira${estado.modo === "pro" ? " <em>Pro</em>" : ""}</b>
            ${pro ? `<div class="mira-modos" role="group" aria-label="Qual Mira"><button type="button" data-mira="modo" data-modo="mira" aria-pressed="${estado.modo === "mira"}">Mira</button><button type="button" data-mira="modo" data-modo="pro" aria-pressed="${estado.modo === "pro"}">Pro</button></div>`
                : `<span class="mira-sub">${naNuvem() ? (estado.plano?.mira_pro_adicional ? "Mira Pro: adicional do pacote" : "") : "precisa da nuvem"}</span>`}`;
    }
    function desenharSugestoes() {
        const s = $("miraSugestoes");
        if (!s) return;
        const lista = SUGESTOES[NOME_TELA()] || ["O que dá para fazer nesta tela?", "Como funciona o despacho?"];
        s.innerHTML = lista.map(t => `<button type="button" class="mira-chip" data-mira="sugestao">${esc(t)}</button>`).join("")
            + (estado.modo === "pro" ? `<button type="button" class="mira-chip pro" data-mira="resumo">Resumo do turno</button>${NOME_TELA() === "indicadores" ? `<button type="button" class="mira-chip pro" data-mira="analisar">Analisar estes indicadores</button>` : ""}` : "");
    }
    function desenharConversa() {
        const c = $("miraConversa");
        if (!c) return;
        if (!estado.conversa.length) {
            c.innerHTML = `<div class="mira-vazia"><b>Oi! Eu sou a Mira.</b><p>Pergunte sobre qualquer tela do Eciton ou sobre o que está acontecendo agora na frota. Eu vejo o que está na sua tela, não mexo em nada sozinha.</p>
                ${temPro() ? "<p>Na <b>Mira Pro</b> eu também olho o histórico das últimas 24 h, faço o resumo do turno e sugiro ações para você confirmar.</p>" : ""}</div>`;
            return;
        }
        c.innerHTML = estado.conversa.map((m, k) => `<div class="mira-msg ${m.de === "eu" ? "eu" : "ela"}${m.erro ? " erro" : ""}">
            ${m.pensando ? `<span class="mira-pensando" aria-label="A Mira está pensando"><i></i><i></i><i></i></span>` : `<p>${esc(m.texto).replace(/\n/g, "<br>")}</p>`}
            ${(m.acoes || []).length ? `<div class="mira-acoes">${m.acoes.map((a, i) => `<button type="button" class="btn btn-mini ${a.feita ? "" : "btn-primario"}" data-mira="acao" data-m="${k}" data-i="${i}" ${a.feita ? "disabled" : ""}>${a.feita ? "✓ " : ""}${esc(a.rotulo)}</button>`).join("")}<small>Você confirma; nada acontece sozinho.</small></div>` : ""}
            ${m.de !== "eu" && !m.pensando && !m.erro && m.texto ? `<button type="button" class="mira-copiar" data-mira="copiar" data-m="${k}">copiar</button>` : ""}
        </div>`).join("");
        c.scrollTop = c.scrollHeight;
    }
    function desenharEntrada() {
        const b = $("miraEnviar"), t = $("miraTexto"), aviso = $("miraAviso");
        if (!b) return;
        b.disabled = estado.ocupada || !naNuvem();
        t.disabled = !naNuvem();
        const r = estado.restantes[estado.modo];
        aviso.textContent = !naNuvem() ? "A Mira precisa da nuvem do Eciton ligada." : (r ? `Restam ${Math.max(0, r.usuario_dia)} perguntas hoje. ` : "") + "A Mira pode errar: confira antes de agir.";
    }
    function atualizarVisibilidade() {
        const b = $("miraBotao");
        if (!b) return;
        const posto = document.querySelector("#posto.ativa") || document.body.classList.contains("modo-posto");
        b.hidden = !disponivel() || Boolean(posto);
        if (b.hidden && estado.aberta) abrir(false);
        if (b.hidden) fecharNotou();
    }

    function iniciar() {
        montar();
        if (naNuvem()) carregarPlano();
        setInterval(() => { atualizarVisibilidade(); try { verificarRegras(); } catch (e) { /* ignora */ } }, 15000);
        setInterval(atualizarVisibilidade, 1500);
        document.addEventListener("click", e => { if (e.target.closest("[data-tela]")) setTimeout(() => { if (estado.aberta) desenharSugestoes(); }, 50); });
    }
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", iniciar); else setTimeout(iniciar, 0);

    raiz.Mira = { perguntar, abrir, contexto, carregarPlano, verificarRegras, temPro, temMira, estado, _executar: EXECUTAR, confirmarAcao };
})(window);
