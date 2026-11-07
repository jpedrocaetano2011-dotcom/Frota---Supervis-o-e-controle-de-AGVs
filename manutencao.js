/* ============================================================
   MANUTENÇÃO — tirar um AGV da operação e trazer de volta
   ============================================================
   Em manutenção o AGV sai do despacho e da rotina, os alertas dele
   ficam mudos e o tempo conta como parada planejada. O próprio AGV
   (firmware 0.14) recusa missão e fica com a fita branca fixa
   (comando/manutencao). Dois jeitos:
     · "Continua aqui": parado no ponto, a zona dele continua ocupada
       e os outros esperam ou desviam; no mapa ele fica cinza.
     · "Tirei da linha": foi para a oficina; as zonas são liberadas e,
       ao voltar, é preciso informar a posição.

   Na nuvem: tabela manutencoes (abrir_manutencao, encerrar_manutencao).
   Sem nuvem: localStorage "manutencoesFrota".
   Tela Manutenção: quem está em manutenção, o uso de cada AGV, as
   cópias de configuração e a documentação dos modelos.
*/
const Manutencao = (function () {
    "use strict";

    let abertas = new Map();      // agvId -> registro aberto
    let historico = [];           // encerradas (90 dias)
    let carregado = false;
    const ultimoEnvio = {};       // agvId -> instante do último comando de sincronia
    const esc = t => (typeof escaparHtml === "function" ? escaparHtml(t) : String(t ?? ""));
    const naNuvem = () => Boolean(window.Nuvem && Nuvem.emNuvem());
    const podeMexer = () => !window.Nuvem || Nuvem.pode("manutencao");
    // o AGV virtual não está no banco: só sem nuvem
    const podeMexerNo = agv => podeMexer() && Boolean(agv) && !(agv.virtual && naNuvem());

    function doBanco(x) {
        return {
            id: x.id, agv: x.agv, motivo: x.motivo || "", previsao: x.previsao ? Date.parse(x.previsao) : null,
            foraDaLinha: Boolean(x.fora_da_linha ?? x.foraDaLinha), ponto: x.ponto || "",
            inicio: Date.parse(x.inicio) || Date.now(), fim: x.fim ? Date.parse(x.fim) : null,
            porNome: x.aberta_por_nome ?? x.porNome ?? "", fimPorNome: x.encerrada_por_nome ?? x.fimPorNome ?? "",
            nota: x.nota_fim ?? x.nota ?? ""
        };
    }

    function lerLocal() {
        try {
            const d = JSON.parse(localStorage.getItem("manutencoesFrota") || "{}");
            return (Array.isArray(d.lista) ? d.lista : []).map(doBanco);
        } catch (e) { return []; }
    }
    function gravarLocal() {
        const tudo = [...abertas.values(), ...historico].map(r => Object.assign({}, r, {
            inicio: new Date(r.inicio).toISOString(), fim: r.fim ? new Date(r.fim).toISOString() : null,
            previsao: r.previsao ? new Date(r.previsao).toISOString() : null
        }));
        try { localStorage.setItem("manutencoesFrota", JSON.stringify({ lista: tudo.slice(0, 300) })); } catch (e) { /* sem espaço */ }
    }

    function aplicar(linhas) {
        abertas = new Map();
        historico = [];
        linhas.sort((a, b) => b.inicio - a.inicio).forEach(r => {
            if (r.fim) historico.push(r);
            else if (!abertas.has(r.agv)) abertas.set(r.agv, r);
        });
        carregado = true;
        aoMudar();
    }

    async function carregar() {
        if (!naNuvem()) { aplicar(lerLocal()); return; }
        try {
            const desde = new Date(Date.now() - 90 * 86400000).toISOString();
            const r = await Nuvem.cliente().from("manutencoes").select("*").eq("empresa_id", Nuvem.empresa().id)
                .or(`fim.is.null,inicio.gte.${desde}`).order("inicio", { ascending: false }).limit(500);
            if (r.error) throw r.error;
            aplicar(r.data.map(doBanco));
        } catch (erro) {
            console.warn("Manutenções indisponíveis:", erro?.message || erro);
            aplicar([]);
        }
    }

    function iniciarTempoReal() {
        if (!naNuvem()) return;
        try {
            Nuvem.cliente().channel(`manutencoes-${Nuvem.empresa().id}`)
                .on("postgres_changes", { event: "*", schema: "public", table: "manutencoes", filter: `empresa_id=eq.${Nuvem.empresa().id}` }, () => carregar())
                .subscribe();
        } catch (e) { /* sem tempo real: recarrega ao abrir a tela */ }
    }

    // Outra aba (mesmo navegador, sem nuvem) mudou
    addEventListener("storage", e => { if (e.key === "manutencoesFrota" && !naNuvem()) aplicar(lerLocal()); });

    function aoMudar() {
        const badge = document.getElementById("menuBadgeManutencao");
        if (badge) { badge.hidden = abertas.size === 0; badge.textContent = abertas.size; }
        document.dispatchEvent(new CustomEvent("manutencaomudou"));
        if (typeof renderizarFrota === "function") renderizarFrota();
        if (typeof agendarAtualizacaoTela === "function") agendarAtualizacaoTela();
        if (typeof atualizarPainel === "function") atualizarPainel();
        if (document.getElementById("manutencao")?.classList.contains("ativa")) desenhar();
        Object.values(typeof agvs === "object" ? agvs : {}).forEach(sincronizar);
    }

    /* ---------------- leitura ---------------- */

    const idDe = a => (a && typeof a === "object" ? a.id : a);
    const atual = a => abertas.get(idDe(a)) || null;
    const ativa = a => abertas.has(idDe(a));
    const foraDaLinha = a => Boolean(abertas.get(idDe(a))?.foraDaLinha);
    const lista = () => [...abertas.values()];
    const historicoDe = a => historico.filter(r => r.agv === idDe(a));

    const hora = t => new Date(t).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
    function textoCurto(r) {
        if (!r) return "";
        const atrasada = r.previsao && r.previsao < Date.now();
        return `${r.motivo} · desde ${hora(r.inicio)}${r.previsao ? ` · ${atrasada ? "previsão vencida" : "previsão"} ${hora(r.previsao)}` : ""}${r.foraDaLinha ? " · fora da linha" : ""}`;
    }

    /* ---------------- o AGV: comando/manutencao ---------------- */

    // O AGV tem de estar como o site diz (firmware 0.14 publica status/manutencao)
    function sincronizar(agv) {
        if (!agv || !agv.online || agv.manutencaoAgv == null) return;
        const quer = ativa(agv);
        if (agv.manutencaoAgv === quer) return;
        if (window.Nuvem && Nuvem.emNuvem() && !Nuvem.pode("manutencao")) return;
        if (Date.now() - (ultimoEnvio[agv.id] || 0) < 5000) return;
        ultimoEnvio[agv.id] = Date.now();
        const ultima = historicoDe(agv)[0];
        const esquecer = !quer && ultima && ultima.foraDaLinha && Date.now() - (ultima.fim || 0) < 3600000;
        if (typeof publicar === "function") publicar("comando/manutencao", JSON.stringify({ ativa: quer, esquecerPosicao: Boolean(esquecer) }), agv.id);
    }

    /* ---------------- pôr e tirar ---------------- */

    async function entrar(agvId) {
        const agv = agvs[agvId];
        if (!agv) return;
        if (!podeMexer()) { Nuvem.exigir("manutencao", "pôr AGVs em manutenção"); return; }
        if (!podeMexerNo(agv)) { ui.aviso("O AGV virtual não entra em manutenção com a nuvem ligada (ele não está no banco).", "aviso"); return; }
        const r = atual(agv);
        if (!r && ["EM_EXECUCAO", "AGUARDANDO_CONFIRMACAO", "INTERROMPIDA"].includes(agv.estadoMissao)) {
            ui.aviso(`O AGV ${agv.id} está com a missão ${agv.missaoAtual || ""} em andamento. Termine ou cancele a missão antes de pôr em manutenção.`, "aviso");
            return;
        }
        const fila = (agv.fila?.itens || []).length;
        const previsao = r?.previsao ? new Date(r.previsao - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : "";
        const campos = [
            { nome: "motivo", rotulo: "Motivo", valor: r?.motivo || "", obrigatorio: true, largo: true, max: 200, placeholder: "Ex.: troca de roda, revisão de 50 km" },
            { nome: "previsao", rotulo: "Previsão de volta (opcional)", tipo: "datetime-local", valor: previsao, largo: true },
            { nome: "local", rotulo: "Onde ele fica", tipo: "radio", valor: r ? (r.foraDaLinha ? "fora" : "aqui") : "aqui", opcoes: [
                ["aqui", "Continua aqui", "Parado no ponto. A zona dele continua ocupada: os outros AGVs esperam ou desviam."],
                ["fora", "Tirei da linha", "Vai para a oficina. As zonas dele são liberadas e, na volta, é preciso informar a posição."]] }
        ];
        if (!r && fila) campos.push({ nome: "devolver", rotulo: `Devolver as ${fila} missões da fila dele para o despacho`, tipo: "checkbox", valor: true, dica: "Os pedidos voltam para a fila da frota e vão para outro AGV." });
        const v = await ui.formulario({
            titulo: r ? `Manutenção do AGV ${agv.id}` : `Pôr o AGV ${agv.id} em manutenção`,
            texto: r ? "" : `${agv.nome}: sai do despacho e da rotina, não aceita missão e a fita fica branca. Os alertas dele ficam mudos.`,
            confirmar: r ? "Salvar" : "Pôr em manutenção", campos
        });
        if (!v) return;
        const dados = {
            motivo: String(v.motivo || "").trim(), previsao: v.previsao ? Date.parse(v.previsao) : null,
            foraDaLinha: v.local === "fora", ponto: agv.posicaoConhecida ? (agv.pontoAtual || "") : ""
        };
        if (dados.motivo.length < 2) { ui.aviso("Escreva o motivo.", "aviso"); return; }
        try {
            if (naNuvem()) {
                const { data, error } = await Nuvem.cliente().rpc("abrir_manutencao", {
                    p_empresa: Nuvem.empresa().id, p_agv: agv.id, p_motivo: dados.motivo,
                    p_previsao: dados.previsao ? new Date(dados.previsao).toISOString() : null, p_fora_da_linha: dados.foraDaLinha, p_ponto: dados.ponto
                });
                if (error) throw error;
                abertas.set(agv.id, doBanco(data));
            } else {
                abertas.set(agv.id, Object.assign({ id: Date.now(), agv: agv.id, inicio: r?.inicio || Date.now(), fim: null, porNome: "este navegador", fimPorNome: "", nota: "" }, r || {}, dados));
                gravarLocal();
            }
        } catch (erro) {
            ui.aviso(`Não foi possível salvar: ${window.Nuvem ? Nuvem.traduzirErro(erro) : erro.message}`, "erro");
            return;
        }
        if (!r || r.foraDaLinha !== dados.foraDaLinha) {
            if (v.devolver && fila && typeof publicar === "function") publicar("comando/fila", JSON.stringify({ acao: "LIMPAR" }), agv.id);
            if (typeof publicar === "function") publicar("comando/manutencao", JSON.stringify({ ativa: true }), agv.id);
            // tirado da linha: as zonas de tráfego dele ficam livres para os outros
            if (dados.foraDaLinha && agv.trafego && (agv.trafego.o || []).length && typeof publicar === "function") {
                publicar("comando/trafego", JSON.stringify({ acao: "LIBERAR" }), agv.id);
            }
        }
        ultimoEnvio[agv.id] = Date.now();
        if (typeof registrarAcaoSite === "function") registrarAcaoSite(agv.id, "sistema", r ? "MANUTENCAO_ALTERADA" : "MANUTENCAO_INICIADA", textoCurto(abertas.get(agv.id)));
        ui.aviso(r ? `Manutenção do AGV ${agv.id} atualizada.` : `AGV ${agv.id} em manutenção.`, "sucesso");
        aoMudar();
    }

    async function sair(agvId) {
        const agv = agvs[agvId];
        const r = atual(agvId);
        if (!agv || !r) return;
        if (!podeMexer()) { Nuvem.exigir("manutencao", "tirar AGVs da manutenção"); return; }
        const v = await ui.formulario({
            titulo: `Voltar o AGV ${agv.id} para a operação?`,
            texto: r.foraDaLinha
                ? "Ele foi tirado da linha: leve o AGV até um ponto da planta e informe a posição (Visão geral › Informar posição) antes da próxima missão."
                : "Ele volta a receber missões do despacho e a seguir a rotina.",
            confirmar: "Voltar para a operação",
            campos: [{ nome: "nota", rotulo: "O que foi feito (opcional)", tipo: "textarea", max: 300, largo: true }]
        });
        if (!v) return;
        try {
            if (naNuvem()) {
                const { data, error } = await Nuvem.cliente().rpc("encerrar_manutencao", { p_empresa: Nuvem.empresa().id, p_agv: agv.id, p_nota: v.nota || "" });
                if (error) throw error;
                if (data) historico.unshift(doBanco(data));
            } else {
                historico.unshift(Object.assign({}, r, { fim: Date.now(), fimPorNome: "este navegador", nota: v.nota || "" }));
            }
            abertas.delete(agv.id);
            if (!naNuvem()) gravarLocal();
        } catch (erro) {
            ui.aviso(`Não foi possível salvar: ${window.Nuvem ? Nuvem.traduzirErro(erro) : erro.message}`, "erro");
            return;
        }
        if (typeof publicar === "function") publicar("comando/manutencao", JSON.stringify({ ativa: false, esquecerPosicao: r.foraDaLinha }), agv.id);
        ultimoEnvio[agv.id] = Date.now();
        if (typeof registrarAcaoSite === "function") registrarAcaoSite(agv.id, "sistema", "MANUTENCAO_ENCERRADA", v.nota || r.motivo);
        ui.aviso(r.foraDaLinha ? `AGV ${agv.id} de volta. Informe a posição dele antes da próxima missão.` : `AGV ${agv.id} de volta à operação.`, "sucesso");
        aoMudar();
    }

    function alternar(agvId) {
        return ativa(agvId) ? sair(agvId) : entrar(agvId);
    }

    /* ---------------- pedaços para outras telas ---------------- */

    // Linha no cartão da frota e faixa na visão geral
    function linhaCartao(agv) {
        const r = atual(agv);
        if (!r) return "";
        return `<dt>${ui.icone("chave", "icone-p")} Manutenção</dt><dd class="texto-aviso">${esc(textoCurto(r))}</dd>`;
    }

    // Faixa embaixo dos mapas: AGVs fora da linha não aparecem no mapa
    function faixaMapa() {
        const fora = lista().filter(r => r.foraDaLinha);
        if (!fora.length) return "";
        return `<div class="faixa-manutencao">${ui.icone("chave", "icone-p")}<b>Em manutenção, fora da linha:</b> ${fora.map(r => `AGV ${esc(r.agv)} <span class="suave">(${esc(r.motivo)}${r.previsao ? ", volta " + hora(r.previsao) : ""})</span>`).join(" · ")}</div>`;
    }

    /* ---------------- tela Manutenção ---------------- */

    function duracao(ms) {
        const min = Math.max(1, Math.round(ms / 60000));
        if (min < 60) return `${min} min`;
        const h = min / 60;
        return h < 48 ? `${ui.numero(h, h < 10 ? 1 : 0)} h` : `${ui.numero(h / 24, 1)} dias`;
    }

    function desenhar() {
        const caixa = document.getElementById("manutencaoConteudo");
        if (!caixa) return;
        const todos = Object.values(agvs).sort((a, b) => String(a.id).localeCompare(String(b.id), "pt-BR", { numeric: true }));
        const pode = podeMexer();
        const agora = Date.now();
        const emManut = lista().sort((a, b) => a.inicio - b.inicio);
        const linhasAbertas = emManut.map(r => {
            const agv = agvs[r.agv];
            const atrasada = r.previsao && r.previsao < agora;
            return `<tr>
                <td><strong>${esc(r.agv)}</strong> <span class="suave">${esc(agv?.nome || "")}</span><br><small class="suave">${esc(Modelos.nome(agv?.modelo) || "sem modelo")}</small></td>
                <td>${esc(r.motivo)}${r.porNome ? `<br><small class="suave">por ${esc(r.porNome)}</small>` : ""}</td>
                <td>${hora(r.inicio)}<br><small class="suave">há ${duracao(agora - r.inicio)}</small></td>
                <td>${r.previsao ? `<span class="${atrasada ? "texto-erro" : ""}">${hora(r.previsao)}${atrasada ? " · vencida" : ""}</span>` : `<span class="suave">—</span>`}</td>
                <td>${r.foraDaLinha ? `<span class="pilula ambar">fora da linha</span>` : `<span class="pilula">no ponto ${esc(r.ponto || "?")}</span>`}</td>
                <td class="usuarios-acao">${pode ? `<button type="button" class="btn btn-mini" data-manut-editar="${esc(r.agv)}">Editar</button> <button type="button" class="btn btn-mini btn-primario" data-manut-sair="${esc(r.agv)}">Voltar à operação</button>` : ""}</td>
            </tr>`;
        }).join("");

        const linhasFrota = todos.map(agv => {
            const u = agv.diagnostico?.uso || {};
            const km = Number(u.metros) / 1000;
            const rev = agv.manutencao || { intervaloKm: 50, ultimaKm: 0 };
            const desde = Number.isFinite(km) ? Math.max(0, km - (rev.ultimaKm || 0)) : null;
            const pct = desde == null ? 0 : Math.min(100, desde / (rev.intervaloKm || 50) * 100);
            const ultima = historicoDe(agv)[0];
            const m = Modelos.doAgv(agv);
            const copias = typeof Copias !== "undefined" ? Copias.contagem(agv.id) : null;
            return `<tr>
                <td><strong>${esc(agv.id)}</strong> <span class="suave">${esc(agv.nome)}</span>${agv.serie ? `<br><small class="suave mono">série ${esc(agv.serie)}</small>` : ""}</td>
                <td>${m ? esc(m.nome) : `<span class="suave">—</span>`}</td>
                <td class="mono">${Number.isFinite(km) ? (km >= 1 ? ui.numero(km, 1) + " km" : ui.numero(km * 1000, 0) + " m") : "--"}</td>
                <td>${desde == null ? `<span class="suave">--</span>` : `<div class="barra-progresso fina" title="${ui.numero(desde, 1)} de ${rev.intervaloKm || 50} km"><div style="width:${pct}%;background:${pct >= 100 ? "var(--red)" : pct >= 85 ? "var(--amber)" : "var(--green)"}"></div></div><small class="suave">${pct >= 100 ? "revisão vencida" : `faltam ~${ui.numero(Math.max(0, (rev.intervaloKm || 50) - desde), 1)} km`}</small>`}</td>
                <td>${ultima ? `${hora(ultima.fim)}<br><small class="suave">${esc(ultima.motivo)}</small>` : `<span class="suave">—</span>`}</td>
                <td>${copias == null ? "--" : copias.n ? `${copias.n}<br><small class="suave">última ${hora(copias.ultima)}</small>` : `<span class="suave">nenhuma</span>`}</td>
                <td class="usuarios-acao">
                    <button type="button" class="btn btn-mini" data-manut-abrir="${esc(agv.id)}">Diagnóstico</button>
                    ${m && Modelos.podeVerDoc() ? `<button type="button" class="btn btn-mini" data-manut-doc="${esc(m.id)}">Documentação</button>` : ""}
                    ${pode && podeMexerNo(agv) && !ativa(agv) ? `<button type="button" class="btn btn-mini" data-manut-entrar="${esc(agv.id)}">${ui.icone("chave", "icone-p")}Manutenção</button>` : ""}
                </td>
            </tr>`;
        }).join("");

        const linhasHist = historico.slice(0, 60).map(r => `<tr>
            <td><strong>${esc(r.agv)}</strong></td>
            <td>${esc(r.motivo)}${r.nota ? `<br><small class="suave">${esc(r.nota)}</small>` : ""}</td>
            <td>${hora(r.inicio)} → ${hora(r.fim)}</td>
            <td>${duracao(r.fim - r.inicio)}</td>
            <td><small class="suave">${esc(r.porNome || "")}${r.fimPorNome && r.fimPorNome !== r.porNome ? " · " + esc(r.fimPorNome) : ""}</small></td>
        </tr>`).join("");

        ui.trocarHtml(caixa, `
            <section class="card card-sem-padding">
                <div class="card-barra"><div><h2>Em manutenção agora</h2><div class="card-sub">Fora do despacho e da rotina, sem alertas. O tempo conta como parada planejada.</div></div></div>
                ${emManut.length ? `<div class="tabela-rolagem"><table class="tabela-usuarios"><thead><tr><th>AGV</th><th>Motivo</th><th>Desde</th><th>Previsão</th><th>Onde</th><th></th></tr></thead><tbody>${linhasAbertas}</tbody></table></div>`
                    : `<div class="empty-state">Nenhum AGV em manutenção.</div>`}
            </section>
            <section class="card card-sem-padding">
                <div class="card-barra"><div><h2>Frota</h2><div class="card-sub">Uso gravado em cada AGV, revisão das rodas (Diagnóstico › Uso e manutenção) e cópias da configuração.</div></div></div>
                ${todos.length ? `<div class="tabela-rolagem"><table class="tabela-usuarios"><thead><tr><th>AGV</th><th>Modelo</th><th>Rodado</th><th>Revisão</th><th>Última manutenção</th><th>Cópias da config.</th><th></th></tr></thead><tbody>${linhasFrota}</tbody></table></div>`
                    : `<div class="empty-state">Nenhum AGV cadastrado.</div>`}
            </section>
            <section class="card card-sem-padding">
                <div class="card-barra"><div><h2>Histórico</h2><div class="card-sub">Manutenções encerradas nos últimos 90 dias</div></div></div>
                ${historico.length ? `<div class="tabela-rolagem"><table class="tabela-usuarios"><thead><tr><th>AGV</th><th>Motivo</th><th>Período</th><th>Duração</th><th>Quem</th></tr></thead><tbody>${linhasHist}</tbody></table></div>`
                    : `<div class="empty-state">Nenhuma manutenção encerrada ainda.</div>`}
            </section>`);
    }

    function abrir() {
        carregar();
        if (typeof Copias !== "undefined") Copias.carregarTodas().then(desenhar);
        desenhar();
    }

    document.addEventListener("click", evento => {
        const alvo = evento.target.closest("[data-manut-entrar],[data-manut-editar],[data-manut-sair],[data-manut-alternar],[data-manut-abrir],[data-manut-doc]");
        if (!alvo) return;
        evento.stopPropagation();
        const d = alvo.dataset;
        if (d.manutEntrar || d.manutEditar) entrar(d.manutEntrar || d.manutEditar);
        else if (d.manutSair) sair(d.manutSair);
        else if (d.manutAlternar) alternar(d.manutAlternar);
        else if (d.manutDoc) Modelos.abrirDocumentacao(d.manutDoc);
        else if (d.manutAbrir) { selecionarAGV(d.manutAbrir); mudarTela("diagnostico"); }
    }, true);

    setTimeout(() => carregar().then(iniciarTempoReal), 0);

    return {
        carregar, abrir, desenhar, entrar, sair, alternar, sincronizar,
        atual, ativa, foraDaLinha, lista, historicoDe, textoCurto, linhaCartao, faixaMapa, podeMexer, podeMexerNo,
        historico: () => historico.slice()
    };
})();
