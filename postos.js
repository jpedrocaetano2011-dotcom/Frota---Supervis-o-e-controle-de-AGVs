/* ============================================================
   POSTOS — cadastro (Frota › Postos) e a tela do posto (tablet)
   ============================================================
   Posto = um lugar que pede missões: nome, ponto da planta, botões
   (cada botão aponta para uma missão), se aceita pedido urgente
   (com o PIN de um líder) e quais usuários (tablets) o usam.
   A tela do posto é uma página só: mostra os postos do usuário
   logado (1 posto: tela inteira; 2: lado a lado; 3 ou mais: abas).
*/

const Postos = (function () {
    "use strict";
    const esc = t => escaparHtml(t);
    let usuariosPosto = [];      // nuvem: [{ id, nome, email }] com papel posto
    let novo = null;             // posto em criação (ainda não salvo)

    const podeEditar = () => !window.Nuvem || Nuvem.pode("administrar");

    function pontosDaPlanta() {
        const planta = plantaPublicada();
        const estacoes = (planta.estacoes || []).map(e => ({ id: e.id, texto: `${e.id} · ${e.nome || "estação"}` }));
        const nos = planta.nos.filter(n => n.tipo === "ESTACAO" && !planta.estacoes.some(e => e.id === n.id))
            .map(n => ({ id: n.id, texto: `${n.id}${n.nome ? " · " + n.nome : ""}` }));
        return estacoes.concat(nos);
    }

    async function carregarUsuarios() {
        if (!window.Nuvem || !Nuvem.emNuvem() || !Nuvem.pode("administrar")) { usuariosPosto = []; return; }
        const { data } = await Nuvem.cliente().from("perfis").select("usuario_id, email, nome, papel").eq("empresa_id", Nuvem.empresa().id).eq("papel", "posto").order("email");
        usuariosPosto = (data || []).map(u => ({ id: u.usuario_id, nome: u.nome, email: u.email }));
    }

    // Módulos que a missão pede, pelas estações dela (0.16): kit = G, carrinho = E...
    function modulosDaMissao(idMissao) {
        const m = (missoes || []).find(x => x.id === idMissao);
        const planta = typeof plantaPublicada === "function" ? plantaPublicada() : null;
        if (!m || !planta) return [];
        const mods = new Set();
        (m.etapas || []).filter(e => e.tipo === "IR_PARA").forEach(e => {
            const c = Planta.candidatosDestino(planta, e.destino);
            const carga = c?.estacao?.carga;
            if (carga && Planta.CARGAS[carga]) mods.add(Planta.CARGAS[carga].modulo);
        });
        return [...mods];
    }
    // Modelos que servem para a missão (todos, se as estações não dizem a carga)
    function modelosCompativeis(idMissao) {
        const lista = typeof Modelos !== "undefined" ? Modelos.disponiveis() : [];
        const mods = modulosDaMissao(idMissao);
        return lista.filter(m => !mods.length || (mods.length === 1 && mods[0] === m.modulo));
    }

    // Quem atende o botão (0.16): modelos (obrigatório), preferidos e "só estes"
    function htmlQuemAtende(b, i, pode) {
        if (typeof Modelos === "undefined" || !Modelos.disponiveis().length) return "";
        const mods = modulosDaMissao(b.missao);
        const servem = new Set(modelosCompativeis(b.missao).map(m => m.id));
        const marcados = new Set(b.modelos || []);
        const frota = typeof agvs !== "undefined" ? Object.values(agvs).filter(a => !marcados.size || marcados.has(a.modelo)) : [];
        const preferidos = new Set(b.preferidos || []);
        const espera = Number(b.esperaPreferidoS ?? 120);
        return `<div class="posto-atende" data-atende="${i}">
            <div class="posto-atende-linha"><span class="posto-atende-rotulo">Quem atende</span>
                ${Modelos.disponiveis().map(m => {
                    const ok = servem.has(m.id);
                    return `<label class="rotina-check ${ok ? "" : "nao-serve"}" title="${ok ? "" : `A missão vai a estações do Atta ${mods.join(", ")}`}"><input type="checkbox" data-campo="modelo" data-modelo="${esc(m.id)}" ${marcados.has(m.id) ? "checked" : ""} ${ok ? "" : "disabled"} ${pode}><span>${esc(m.nome)}</span></label>`;
                }).join("")}
            </div>
            ${b.missao && !marcados.size ? `<p class="posto-atende-aviso">Escolha os modelos que atendem este botão${mods.length ? ` (a missão vai a estações do Atta ${mods.join(", ")})` : ""}.</p>` : ""}
            ${frota.length ? `<div class="posto-atende-linha"><span class="posto-atende-rotulo">Preferidos</span>
                ${frota.map(a => `<label class="rotina-check"><input type="checkbox" data-campo="preferido" data-agv="${esc(a.id)}" ${preferidos.has(a.id) ? "checked" : ""} ${pode}><span>${esc(a.id)}</span></label>`).join("")}
            </div>
            <div class="posto-atende-linha ${preferidos.size ? "" : "apagado"}">
                <label class="rotina-check"><input type="checkbox" data-campo="soEstes" ${b.soEstes ? "checked" : ""} ${pode}><span>Só estes (espera se estiverem ocupados)</span></label>
                <label class="posto-atende-espera">sem eles, manda outro depois de
                    <select data-campo="esperaPreferidoS" ${pode}>${[[60, "1 min"], [120, "2 min"], [300, "5 min"], [600, "10 min"]].map(([v, t]) => `<option value="${v}" ${v === espera ? "selected" : ""}>${t}</option>`).join("")}</select>
                </label>
            </div>` : ""}
        </div>`;
    }

    function htmlCartao(p, criando) {
        const pontos = pontosDaPlanta();
        const pode = podeEditar() ? "" : "disabled";
        const opcoesMissao = sel => `<option value="">— missão —</option>` + (missoes || []).map(m =>
            `<option value="${esc(m.id)}" ${m.id === sel ? "selected" : ""}>${esc(m.id)} · ${esc(m.nome || "")}</option>`).join("");
        const botoes = (p.botoes || []).map((b, i) => `
            <div class="posto-botao-linha" data-botao="${i}">
                <input type="text" data-campo="rotulo" value="${esc(b.rotulo || "")}" placeholder="Rótulo (ex.: Pedir kit)" aria-label="Rótulo do botão ${i + 1}" ${pode}>
                <select data-campo="missao" aria-label="Missão do botão ${i + 1}" ${pode}>${opcoesMissao(b.missao)}</select>
                <button type="button" class="btn-remover-fila" data-postos="tirarBotao" aria-label="Tirar o botão ${i + 1}" ${pode}>×</button>
                ${htmlQuemAtende(b, i, pode)}
            </div>`).join("");
        const usuarios = window.Nuvem && Nuvem.emNuvem()
            ? `<div class="campo"><span>Tablets (usuários com papel Posto)</span>
                ${usuariosPosto.length ? `<div class="posto-usuarios">${usuariosPosto.map(u => `<label class="rotina-check"><input type="checkbox" data-usuario="${esc(u.id)}" ${(p.usuarios || []).includes(u.id) ? "checked" : ""} ${pode}><span>${esc(u.nome || u.email)}</span></label>`).join("")}</div>`
                : `<p class="suave">Nenhum usuário com papel Posto. Convide em Usuários (um por posto).</p>`}</div>`
            : "";
        return `<article class="card posto-cartao" data-posto="${esc(criando ? "" : p.id)}">
            <div class="posto-campos">
                <label class="campo"><span>ID</span><input type="text" data-campo="id" value="${esc(p.id)}" maxlength="16" placeholder="P1" ${pode}></label>
                <label class="campo"><span>Nome</span><input type="text" data-campo="nome" value="${esc(p.nome)}" maxlength="60" placeholder="Prensa 1" ${pode}></label>
                <label class="campo"><span>Ponto da planta</span><select data-campo="ponto" ${pode}><option value="">— sem ponto —</option>${pontos.map(o => `<option value="${esc(o.id)}" ${o.id === p.ponto ? "selected" : ""}>${esc(o.texto)}</option>`).join("")}${p.ponto && !pontos.some(o => o.id === p.ponto) ? `<option value="${esc(p.ponto)}" selected>${esc(p.ponto)} (não existe na planta)</option>` : ""}</select></label>
            </div>
            <div class="campo"><span>Botões do tablet (cada um pede uma missão; a prioridade é a da missão)</span>
                <div class="posto-botoes">${botoes || `<p class="suave">Sem botões.</p>`}</div>
                ${(p.botoes || []).length < 6 && podeEditar() ? `<button type="button" class="btn btn-mini" data-postos="maisBotao">+ Botão</button>` : ""}
            </div>
            <label class="rotina-check"><input type="checkbox" data-campo="permiteUrgente" ${p.permiteUrgente ? "checked" : ""} ${pode}><span>Aceita pedido urgente (com o PIN de um líder)</span></label>
            ${usuarios}
            ${!criando && typeof Programacao !== "undefined" ? Programacao.htmlPessoas(p, podeEditar()) : ""}
            <div class="posto-acoes">
                ${podeEditar() ? `<button type="button" class="btn btn-primario" data-postos="salvar">Salvar</button>` : ""}
                ${!criando ? `<button type="button" class="btn" data-postos="abrirTela">Abrir a tela do posto</button>` : ""}
                ${podeEditar() ? `<button type="button" class="btn btn-perigo-suave" data-postos="${criando ? "descartar" : "excluir"}">${criando ? "Descartar" : "Excluir"}</button>` : ""}
            </div>
        </article>`;
    }

    // Lê o cartão (o que está nos campos agora)
    function lerCartao(cartao) {
        const v = c => cartao.querySelector(`[data-campo="${c}"]`);
        return {
            id: v("id").value.trim(),
            nome: v("nome").value.trim(),
            ponto: v("ponto").value,
            permiteUrgente: v("permiteUrgente").checked,
            pinPessoal: Boolean(v("pinPessoal")?.checked),
            botoes: [...cartao.querySelectorAll("[data-botao]")].map(l => {
                const b = {
                    rotulo: l.querySelector('[data-campo="rotulo"]').value.trim(),
                    missao: l.querySelector('[data-campo="missao"]').value
                };
                const atende = l.querySelector("[data-atende]");
                if (atende) {
                    const modelos = [...atende.querySelectorAll('[data-campo="modelo"]')].filter(c => c.checked && !c.disabled).map(c => c.dataset.modelo);
                    const preferidos = [...atende.querySelectorAll('[data-campo="preferido"]')].filter(c => c.checked).map(c => c.dataset.agv);
                    if (modelos.length) b.modelos = modelos;
                    if (preferidos.length) {
                        b.preferidos = preferidos;
                        if (atende.querySelector('[data-campo="soEstes"]')?.checked) b.soEstes = true;
                        b.esperaPreferidoS = Number(atende.querySelector('[data-campo="esperaPreferidoS"]')?.value) || 120;
                    }
                }
                return b;
            }),
            usuarios: [...cartao.querySelectorAll("[data-usuario]")].filter(c => c.checked).map(c => c.dataset.usuario)
        };
    }

    function desenhar() {
        const caixa = document.getElementById("postosLista");
        if (!caixa) return;
        const lista = Despacho.postos();
        let html = (novo ? htmlCartao(novo, true) : "") + lista.map(p => htmlCartao(p, false)).join("");
        if (!html) html = `<p class="suave rotina-vazio">Nenhum posto cadastrado. Um posto é quem pede missões pelo tablet (ou pela tela do posto): por exemplo, “Prensa 1” com os botões “Pedir kit” e “Levar vazio”.</p>`;
        ui.trocarHtml(caixa, html, true);
        const pin = document.getElementById("postosPinLocal");
        if (pin) {
            pin.hidden = Boolean(window.Nuvem && Nuvem.emNuvem());
            const campo = document.getElementById("pinLiderLocal");
            if (campo && document.activeElement !== campo) campo.value = Despacho.pinLocal();
        }
        document.getElementById("btnNovoPosto")?.toggleAttribute("disabled", !podeEditar());
    }

    async function abrir() {
        await carregarUsuarios();
        desenhar();
    }

    async function salvar(cartao) {
        const idAntigo = cartao.dataset.posto || null;
        const p = lerCartao(cartao);
        if (!/^[A-Za-z0-9_-]{1,16}$/.test(p.id)) { ui.aviso("ID do posto: até 16 letras, números, - ou _.", "aviso"); return; }
        if (!p.nome) { ui.aviso("Dê um nome ao posto.", "aviso"); return; }
        if (Despacho.postos().some(x => x.id === p.id && x.id !== idAntigo)) { ui.aviso(`Já existe o posto ${p.id}.`, "aviso"); return; }
        p.botoes = p.botoes.filter(b => b.missao || b.rotulo);
        const semMissao = p.botoes.find(b => !b.missao);
        if (semMissao) { ui.aviso(`Escolha a missão do botão “${semMissao.rotulo}”.`, "aviso"); return; }
        // 0.16: quem atende é escolha explícita (nunca "qualquer um")
        const semQuem = typeof Modelos !== "undefined" && Modelos.disponiveis().length && p.botoes.find(b => !(b.modelos || []).length);
        if (semQuem) { ui.aviso(`Escolha quem atende o botão “${semQuem.rotulo || Despacho.nomeMissao(semQuem.missao)}” (os modelos de Atta).`, "aviso"); return; }
        p.botoes.forEach(b => { if (!b.rotulo) b.rotulo = Despacho.nomeMissao(b.missao); });
        try {
            if (await Nuvem.salvarPosto(p, idAntigo)) {
                if (!idAntigo) novo = null;
                ui.aviso(`Posto ${p.id} salvo.`, "sucesso");
                desenhar();
            }
        } catch (e) {
            ui.aviso(`Não foi possível salvar o posto: ${Nuvem.traduzirErro(e)}`, "erro");
        }
    }

    // Trocou a missão ou os modelos de um botão: redesenha o cartão (modelos que servem e a frota deles)
    document.addEventListener("change", e => {
        const linha = e.target.closest(".posto-cartao [data-botao]");
        if (!linha || !["missao", "modelo"].includes(e.target.dataset.campo)) return;
        const cartao = linha.closest(".posto-cartao");
        const p = lerCartao(cartao);
        const i = Number(linha.dataset.botao);
        if (e.target.dataset.campo === "missao" && p.botoes[i]) {
            // sugestão: os modelos que servem para a missão nova
            p.botoes[i].modelos = modelosCompativeis(p.botoes[i].missao).map(m => m.id);
            delete p.botoes[i].preferidos; delete p.botoes[i].soEstes;
        }
        const criando = !cartao.dataset.posto;
        if (criando) novo = p;
        const div = document.createElement("div");
        div.innerHTML = htmlCartao(p, criando);
        const novoCartao = div.firstElementChild;
        if (!criando) novoCartao.dataset.posto = cartao.dataset.posto;
        cartao.replaceWith(novoCartao);
    });

    document.addEventListener("click", async e => {
        const b = e.target.closest("[data-postos]");
        if (!b) return;
        const cartao = b.closest(".posto-cartao");
        const acao = b.dataset.postos;
        if (acao === "maisBotao" || acao === "tirarBotao") {
            const p = lerCartao(cartao);
            if (acao === "maisBotao") p.botoes.push({ rotulo: "", missao: "" });
            else p.botoes.splice(Number(b.closest("[data-botao]").dataset.botao), 1);
            const criando = !cartao.dataset.posto;
            if (criando) novo = p;
            const div = document.createElement("div");
            div.innerHTML = htmlCartao(Object.assign(p, criando ? {} : { id: p.id }), criando);
            const novoCartao = div.firstElementChild;
            if (!criando) novoCartao.dataset.posto = cartao.dataset.posto;
            cartao.replaceWith(novoCartao);
            return;
        }
        if (acao === "salvar") return salvar(cartao);
        if (acao === "descartar") { novo = null; desenhar(); return; }
        if (acao === "excluir") {
            const id = cartao.dataset.posto;
            if (!await ui.confirmar({ titulo: "Excluir posto", texto: `Excluir o posto ${id}? Os pedidos antigos dele continuam no histórico.`, confirmar: "Excluir", perigo: true })) return;
            try { await Nuvem.removerPosto(id); desenhar(); } catch (erro) { ui.aviso(Nuvem.traduzirErro(erro), "erro"); }
            return;
        }
        if (acao === "abrirTela") TelaPosto.abrir([cartao.dataset.posto]);
    });
    // Acrescenta as missões e os postos de exemplo que faltam (não troca nem apaga nada)
    document.getElementById("btnExemplosDespacho")?.addEventListener("click", async () => {
        if (typeof PlantaExemplo === "undefined" || !PlantaExemplo.postos) return;
        const idsMissoes = new Set((missoes || []).map(m => m.id));
        // as missões e os postos da metalúrgica de exemplo que ainda não existem aqui
        const novasMissoes = PlantaExemplo.missoes().filter(m => !idsMissoes.has(m.id));
        const idsPostos = new Set(Despacho.postos().map(p => p.id));
        const novosPostos = PlantaExemplo.postos().filter(p => !idsPostos.has(p.id));
        if (!novasMissoes.length && !novosPostos.length) { ui.aviso("As missões e os postos de exemplo já estão aqui (mesmos IDs).", "info"); return; }
        const planta = plantaPublicada();
        const faltam = ["KITS", "SUB1", "PR1", "SOLDA", "EXPED", "CNC1", "INSP", "MONT", "SUPER"].filter(id => !(planta.estacoes || []).some(e => e.id === id));
        const texto = [
            novasMissoes.length ? `Missões: ${novasMissoes.map(m => m.id).join(", ")}.` : "",
            novosPostos.length ? `Postos: ${novosPostos.map(p => `${p.id} ${p.nome}`).join(", ")}.` : "",
            "Nada do que já existe é trocado (IDs repetidos ficam de fora).",
            faltam.length ? `Atenção: sua planta não tem ${faltam.slice(0, 4).join(", ")}${faltam.length > 4 ? "…" : ""}; essas missões só funcionam na metalúrgica de exemplo (Planta › Exemplo), ou depois de você trocar os destinos.` : ""
        ].filter(Boolean).join(" ");
        if (!await ui.confirmar({ titulo: "Adicionar exemplos do Despacho", texto, confirmar: "Adicionar" })) return;
        if (novasMissoes.length) {
            missoes.push(...novasMissoes);
            salvarMissoesNoNavegador();
            if (typeof renderizarListaMissoes === "function") renderizarListaMissoes();
        }
        try {
            for (const p of novosPostos) await Nuvem.salvarPosto(p, null);
        } catch (e) { ui.aviso(`Postos: ${Nuvem.traduzirErro(e)}`, "erro"); }
        ui.aviso(`Adicionado: ${novasMissoes.length} missão(ões) e ${novosPostos.length} posto(s).`, "sucesso");
        desenhar();
    });
    document.getElementById("btnNovoPosto")?.addEventListener("click", () => {
        const usados = new Set(Despacho.postos().map(p => p.id));
        let n = 1;
        while (usados.has("P" + n)) n++;
        novo = { id: "P" + n, nome: "", ponto: "", botoes: [{ rotulo: "Pedir kit", missao: "" }], permiteUrgente: false, usuarios: [] };
        desenhar();
    });
    document.getElementById("pinLiderLocal")?.addEventListener("change", e => {
        const v = e.target.value.trim();
        if (!/^[0-9]{4,8}$/.test(v)) { ui.aviso("O PIN tem de 4 a 8 números.", "aviso"); e.target.value = Despacho.pinLocal(); return; }
        try { localStorage.setItem("pinLiderLocal", v); } catch (erro) { /* ignora */ }
        ui.aviso("PIN do líder (modo local) salvo neste navegador.", "sucesso");
    });
    window.aoMudarPostos = () => {
        if (document.getElementById("postos")?.classList.contains("ativa") && !novo) desenhar();
        TelaPosto.desenhar();
    };

    return { abrir, desenhar };
})();


/* ============================================================
   TELA DO POSTO (tablet)
   ============================================================ */
const TelaPosto = (function () {
    "use strict";
    const esc = t => escaparHtml(t);
    let abertos = null;          // ids (prévia aberta pelo admin/operador)
    let aba = null;
    let pinAberto = null;        // { titulo, aoConfirmar(pin) }
    let pinDigitado = "";
    const avisados = new Set();  // pedidos cuja chegada já foi avisada
    const juntos = new Set();    // "posto|botão" com "na mesma viagem" marcado (a tela redesenha a cada segundo)
    let travaTela = null;
    let laco = null;

    const ehTablet = () => Boolean(window.Nuvem && Nuvem.emNuvem() && Nuvem.papel() === "posto");
    const precisaPin = () => Boolean(window.Nuvem && Nuvem.emNuvem() && !Nuvem.pode("urgente"));

    function meusPostos() {
        const todos = Despacho.postos();
        if (ehTablet()) {
            const eu = Nuvem.usuario()?.id;
            return todos.filter(p => (p.usuarios || []).includes(eu));
        }
        let ids = abertos;
        if (!ids) { try { ids = JSON.parse(sessionStorage.getItem("postosAbertos") || "null"); } catch (e) { ids = null; } }
        const lista = ids ? todos.filter(p => ids.includes(p.id)) : todos.slice(0, 1);
        return lista.length ? lista : todos.slice(0, 1);
    }

    function abrir(ids) {
        if (ids) {
            abertos = ids;
            try { sessionStorage.setItem("postosAbertos", JSON.stringify(ids)); } catch (e) { /* ignora */ }
        }
        if (!document.getElementById("posto")?.classList.contains("ativa")) { mudarTela("posto"); return; }
        document.body.classList.add("tela-posto");
        manterTelaLigada();
        desenhar();
        if (!laco) laco = setInterval(() => {
            if (!document.getElementById("posto")?.classList.contains("ativa")) {
                clearInterval(laco); laco = null;
                document.body.classList.remove("tela-posto");
                return;
            }
            desenhar();
        }, 1000);
    }

    async function manterTelaLigada() {
        try {
            if (navigator.wakeLock && !travaTela) {
                travaTela = await navigator.wakeLock.request("screen");
                travaTela.addEventListener("release", () => { travaTela = null; });
            }
        } catch (e) { /* sem suporte ou sem permissão */ }
    }
    document.addEventListener("visibilitychange", () => {
        if (!document.hidden && document.getElementById("posto")?.classList.contains("ativa")) manterTelaLigada();
    });

    function nosDoPosto(posto) {
        const planta = plantaPublicada();
        if (!posto.ponto) return new Set();
        const c = Planta.candidatosDestino(planta, posto.ponto);
        return new Set((c?.nos || []).map(n => n.id).concat([posto.ponto]));
    }

    // Botão B pode ir na mesma viagem do botão A (começa onde A termina)?
    function botaoJunto(posto, a) {
        const planta = plantaPublicada();
        const ma = Despacho.nomeMissao && obterMissaoPorId(a.missao);
        if (!ma) return null;
        const inicio = (ma.etapas || []).find(e => e.tipo === "IR_PARA");
        const cand = inicio ? Planta.candidatosDestino(planta, inicio.destino) : null;
        const partida = cand?.nos?.[0];
        if (!partida) return null;
        const pa = Despachante.prever(planta, ma, partida.id, partida.orientacaoChegada ?? 0);
        if (!pa.ok) return null;
        for (const b of posto.botoes || []) {
            if (b === a || b.missao === a.missao) continue;
            const mb = obterMissaoPorId(b.missao);
            if (!mb) continue;
            const pb = Despachante.prever(planta, mb, pa.fim, null);
            if (pb.ok && pb.vazia) return b;
        }
        return null;
    }

    function posicaoNaFila(p) {
        const pend = Despachante.ordenar(Despacho.lista().filter(x => x.estado === "pendente"), Date.now(), {});
        const i = pend.findIndex(x => x.id === p.id);
        return i >= 0 ? i + 1 : null;
    }

    function statusPedido(p, posto) {
        const agv = p.agv ? agvs[p.agv] : null;
        if (p.estado === "pendente") {
            const n = posicaoNaFila(p);
            return { titulo: "Aguardando AGV", detalhe: n ? `${n}º na fila${p.urgente ? " · urgente" : ""}` : (p.urgente ? "urgente" : ""), cor: p.urgente ? "vermelho" : "cinza" };
        }
        const chegou = agv && nosDoPosto(posto).has(agv.pontoAtual) && p.estado === "em_execucao";
        if (chegou) return { titulo: `AGV ${p.agv} chegou`, detalhe: "no posto", cor: "verde", chegou: true };
        const f = Despacho.faltam(p);
        return {
            titulo: p.estado === "atribuido" && agv && MISSAO_OCUPADA.includes(agv.estadoMissao) && agv.missaoAtual !== p.missao
                ? `AGV ${p.agv} vem em seguida` : `AGV ${p.agv} a caminho`,
            detalhe: f != null ? `cerca de ${Despacho.textoTempo(f)}` : "", cor: "azul"
        };
    }

    function htmlPosto(posto) {
        const pedidos = Despacho.lista().filter(p => p.posto === posto.id);
        const ativos = pedidos.filter(p => Despacho.ESTADOS_ATIVOS.includes(p.estado));
        const recentes = pedidos.filter(p => p.estado === "concluido" && Date.now() - (p.concluidoEm || 0) < 60000);
        const botoes = (posto.botoes || []).map((b, i) => {
            const aberto = ativos.filter(p => p.missao === b.missao).sort((x, y) => y.id - x.id)[0];
            const entregue = !aberto && recentes.filter(p => p.missao === b.missao).sort((x, y) => y.id - x.id)[0];
            const missao = obterMissaoPorId(b.missao);
            if (aberto) {
                const s = statusPedido(aberto, posto);
                const acoes = [];
                if (aberto.estado === "pendente" && posto.permiteUrgente && !aberto.urgente && (precisaPin() || !window.Nuvem || Nuvem.pode("urgente") || Nuvem.pode("pedir")))
                    acoes.push(`<button type="button" class="btn" data-posto="urgente" data-id="${aberto.id}">Tornar urgente</button>`);
                if (aberto.estado === "pendente") acoes.push(`<button type="button" class="btn" data-posto="cancelar" data-id="${aberto.id}">Cancelar</button>`);
                acoes.push(`<button type="button" class="btn" data-posto="maisUm" data-posto-id="${esc(posto.id)}" data-botao="${i}">Pedir mais um</button>`);
                return `<div class="posto-pedido ${s.cor} ${s.chegou ? "chegou" : ""}" data-pedido="${aberto.id}">
                    <div class="posto-pedido-rotulo">${esc(b.rotulo)} <span class="suave">#${aberto.id}</span>${aberto.origem === "programado" ? ` <span class="posto-tag-auto">automático</span>` : ""}</div>
                    <div class="posto-pedido-status">${esc(s.titulo)}</div>
                    <div class="posto-pedido-detalhe">${esc(s.detalhe)}</div>
                    <div class="posto-pedido-acoes">${acoes.join("")}</div>
                </div>${typeof Programacao !== "undefined" ? Programacao.htmlTablet(posto, b, i) : ""}`;
            }
            const junto = botaoJunto(posto, b);
            return `<div class="posto-botao-bloco">
                <button type="button" class="posto-botao" data-posto="pedir" data-posto-id="${esc(posto.id)}" data-botao="${i}" ${missao ? "" : "disabled"}>
                    <span class="posto-botao-rotulo">${esc(b.rotulo)}</span>
                    <span class="posto-botao-sub">${missao ? esc(`${b.missao} · ${missao.nome || ""}`) : "missão não encontrada"}</span>
                    ${entregue ? `<span class="posto-botao-entregue">Entregue ${typeof tempoRelativo === "function" ? tempoRelativo(entregue.concluidoEm) : ""}</span>` : ""}
                </button>
                ${typeof Programacao !== "undefined" ? Programacao.htmlTablet(posto, b, i) : ""}
                <div class="posto-botao-opcoes">
                    ${junto ? `<label class="posto-junto"><input type="checkbox" data-junto="${esc(posto.id)}|${i}" ${juntos.has(posto.id + "|" + i) ? "checked" : ""}><span>+ ${esc(junto.rotulo)} na mesma viagem</span></label>` : ""}
                    ${posto.permiteUrgente ? `<button type="button" class="posto-link-urgente" data-posto="pedirUrgente" data-posto-id="${esc(posto.id)}" data-botao="${i}">Pedir como urgente</button>` : ""}
                </div>
            </div>`;
        }).join("");
        return `<section class="posto-painel" data-painel="${esc(posto.id)}" aria-label="Posto ${esc(posto.nome)}">
            <header class="posto-cabecalho"><h2>${esc(posto.nome)}</h2><span class="posto-id">${esc(posto.id)}</span></header>
            <div class="posto-botoes-grade">${botoes || `<p class="suave">Este posto não tem botões. Configure em Frota › Postos.</p>`}</div>
        </section>`;
    }

    function desenhar() {
        const caixa = document.getElementById("postoConteudo");
        if (!caixa || !document.getElementById("posto")?.classList.contains("ativa")) return;
        const lista = meusPostos();
        const sairPrevia = document.getElementById("postoSair");
        if (sairPrevia) sairPrevia.hidden = ehTablet();
        // no tablet o menu lateral fica escondido: o Sair da conta fica aqui em cima
        const sairConta = document.getElementById("postoSairConta");
        if (sairConta) {
            sairConta.hidden = !ehTablet();
            const quem = Nuvem.perfil?.()?.email || "";
            sairConta.title = quem ? `Sair da conta ${quem}` : "Sair da conta";
        }
        const lider = Despacho.lider();
        const aviso = document.getElementById("postoAvisoDespacho");
        if (aviso) {
            const semDespachante = !lider.eu && !lider.nome;
            aviso.hidden = !semDespachante;
        }
        if (!lista.length) {
            ui.trocarHtml(caixa, `<div class="posto-vazio"><h2>Nenhum posto para este usuário</h2><p>Peça ao administrador para vincular este usuário a um posto em Frota › Postos.</p></div>`);
            return;
        }
        if (aba && !lista.some(p => p.id === aba)) aba = null;
        if (!aba) { try { aba = sessionStorage.getItem("postoAba"); } catch (e) { /* ignora */ } }
        if (!aba || !lista.some(p => p.id === aba)) aba = lista[0].id;
        let html;
        if (lista.length <= 2) {
            html = `<div class="posto-colunas n${lista.length}">${lista.map(htmlPosto).join("")}</div>`;
        } else {
            const abas = lista.map(p => {
                const n = Despacho.lista().filter(x => x.posto === p.id && Despacho.ESTADOS_ATIVOS.includes(x.estado)).length;
                const chegando = Despacho.lista().some(x => x.posto === p.id && x.estado === "em_execucao" && agvs[x.agv] && nosDoPosto(p).has(agvs[x.agv].pontoAtual));
                return `<button type="button" class="posto-aba ${p.id === aba ? "ativa" : ""} ${chegando ? "chegando" : ""}" data-posto="aba" data-posto-id="${esc(p.id)}" aria-pressed="${p.id === aba}">${esc(p.nome)}${n ? ` <b>${n}</b>` : ""}</button>`;
            }).join("");
            const resumo = Despacho.lista().filter(x => lista.some(p => p.id === x.posto) && Despacho.ESTADOS_ATIVOS.includes(x.estado))
                .map(x => `<span class="posto-resumo-item">${esc(x.posto)} · ${esc(x.missao)}: ${esc(statusPedido(x, lista.find(p => p.id === x.posto)).titulo)}</span>`).join("");
            html = `<div class="posto-abas" role="group" aria-label="Postos">${abas}</div>
                ${htmlPosto(lista.find(p => p.id === aba))}
                <div class="posto-resumo">${resumo || `<span class="suave">Nenhum pedido em andamento.</span>`}</div>`;
        }
        ui.trocarHtml(caixa, html);
        avisarChegadas(lista);
        desenharPin();
    }

    // Aviso grande com som quando um AGV chega num dos postos do usuário
    function avisarChegadas(lista) {
        Despacho.lista().forEach(p => {
            const posto = lista.find(x => x.id === p.posto);
            // chegou: em execução com o AGV no posto, ou acabou de terminar lá (a missão que termina no posto)
            const recente = p.estado === "concluido" && Date.now() - (p.concluidoEm || 0) < 15000;
            if (!posto || !(p.estado === "em_execucao" || recente) || avisados.has(p.id)) return;
            const agv = agvs[p.agv];
            if (!agv || !nosDoPosto(posto).has(agv.pontoAtual)) return;
            avisados.add(p.id);
            const faixa = document.getElementById("postoChegada");
            if (faixa) {
                faixa.textContent = `AGV ${p.agv} chegou · ${posto.nome}`;
                faixa.hidden = false;
                clearTimeout(faixa._t);
                faixa._t = setTimeout(() => { faixa.hidden = true; }, 8000);
            }
            bip();
        });
    }
    function bip() {
        try {
            const C = window.AudioContext || window.webkitAudioContext;
            if (!C) return;
            const ctx = bip.ctx || (bip.ctx = new C());
            [0, 0.25].forEach(atraso => {
                const o = ctx.createOscillator(), g = ctx.createGain();
                o.frequency.value = 880;
                g.gain.setValueAtTime(0.0001, ctx.currentTime + atraso);
                g.gain.exponentialRampToValueAtTime(0.3, ctx.currentTime + atraso + 0.02);
                g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + atraso + 0.18);
                o.connect(g).connect(ctx.destination);
                o.start(ctx.currentTime + atraso);
                o.stop(ctx.currentTime + atraso + 0.2);
            });
        } catch (e) { /* sem som */ }
    }

    /* ---------------- pedir ---------------- */

    function botaoDe(alvo) {
        const posto = Despacho.postos().find(p => p.id === alvo.dataset.postoId);
        const b = posto?.botoes?.[Number(alvo.dataset.botao)];
        return posto && b ? { posto, b } : null;
    }

    async function pedir(posto, b, { repetir = false, pin = null, urgente = false } = {}) {
        // lê a caixa "na mesma viagem" antes: a tela é redesenhada quando o pedido entra
        const chave = posto.id + "|" + posto.botoes.indexOf(b);
        if (urgente && pin == null && window.Nuvem && Nuvem.emNuvem()) {
            // quem tem permissão de urgente: cria e marca (sem PIN)
            const r0 = await Despacho.criar({ missao: b.missao, posto: posto.id, repetir, criadoPor: posto.nome });
            if (!r0.ok) { ui.aviso(r0.erro, "erro"); return null; }
            const u = await Despacho.tornarUrgente(r0.pedido.id, null);
            ui.aviso(u.ok ? `${b.rotulo}: pedido #${r0.pedido.id} urgente.` : u.erro, u.ok ? "sucesso" : "erro");
            desenhar();
            return r0.pedido;
        }
        const marcado = juntos.has(chave) || Boolean(document.querySelector(`[data-junto="${CSS.escape(chave)}"]`)?.checked);
        const r = await Despacho.criar({ missao: b.missao, posto: posto.id, repetir, pin, criadoPor: posto.nome });
        if (!r.ok) {
            if (r.repetido) ui.aviso(`${b.rotulo}: já tem um pedido aguardando. Use “Pedir mais um” se precisar de outro.`, "aviso");
            else ui.aviso(r.erro, "erro");
            return null;
        }
        if (marcado) {
            const junto = botaoJunto(posto, b);
            if (junto) {
                const r2 = await Despacho.criar({ missao: junto.missao, posto: posto.id, vinculo: r.pedido.id, repetir: true, criadoPor: posto.nome });
                if (!r2.ok) ui.aviso(`${junto.rotulo}: ${r2.erro}`, "aviso");
            }
        }
        ui.aviso(`${b.rotulo}: pedido #${r.pedido.id} feito${pin ? " (urgente)" : ""}.`, "sucesso");
        desenhar();
        return r.pedido;
    }

    // urgente: quem tem permissão confirma; o tablet pede o PIN do líder
    function comPinOuConfirmacao(titulo, executar) {
        if (!precisaPin() && window.Nuvem && Nuvem.emNuvem()) {
            ui.confirmar({ titulo, texto: "O pedido passa na frente da fila e no tráfego. Fica registrado quem marcou.", confirmar: "Marcar urgente" })
                .then(ok => { if (ok) executar(null); });
            return;
        }
        pinAberto = { titulo, executar };
        pinDigitado = "";
        desenharPin();
    }
    // PIN pessoal das pessoas do posto (programação: pausar, retomar, pular)
    function pedirPin(titulo, texto, executar) {
        pinAberto = { titulo, texto, executar, rotulo: "seu PIN" };
        pinDigitado = "";
        desenharPin();
    }

    function desenharPin() {
        const caixa = document.getElementById("postoPin");
        if (!caixa) return;
        if (!pinAberto) { caixa.hidden = true; return; }
        caixa.hidden = false;
        const html = `<div class="posto-pin" role="dialog" aria-modal="true" aria-labelledby="postoPinTitulo">
            <h2 id="postoPinTitulo">${esc(pinAberto.titulo)}</h2>
            <p>${esc(pinAberto.texto || "Peça para um líder digitar o PIN.")}</p>
            <div class="posto-pin-visor" aria-live="polite">${pinDigitado ? "•".repeat(pinDigitado.length) : `<span class='suave'>${esc(pinAberto.rotulo || "PIN do líder")}</span>`}</div>
            <div class="posto-pin-teclas">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => `<button type="button" data-pin="${n}">${n}</button>`).join("")}
                <button type="button" data-pin="apagar" aria-label="Apagar">⌫</button><button type="button" data-pin="0">0</button>
                <button type="button" data-pin="ok" class="ok" ${pinDigitado.length >= 4 ? "" : "disabled"}>OK</button></div>
            <button type="button" class="btn" data-pin="fechar">Voltar</button>
        </div>`;
        ui.trocarHtml(caixa, html, true);
    }

    document.addEventListener("click", async e => {
        const t = e.target.closest("[data-pin]");
        if (t && pinAberto) {
            const v = t.dataset.pin;
            if (v === "fechar") { pinAberto = null; desenharPin(); return; }
            if (v === "apagar") pinDigitado = pinDigitado.slice(0, -1);
            else if (v === "ok") {
                const acao = pinAberto;
                const pin = pinDigitado;
                pinAberto = null; pinDigitado = "";
                desenharPin();
                acao.executar(pin);
                return;
            } else if (pinDigitado.length < 8) pinDigitado += v;
            desenharPin();
            return;
        }
        const b = e.target.closest("[data-posto]");
        if (!b) return;
        const acao = b.dataset.posto;
        if (acao === "aba") {
            aba = b.dataset.postoId;
            try { sessionStorage.setItem("postoAba", aba); } catch (erro) { /* ignora */ }
            desenhar();
            return;
        }
        if (acao === "pedir" || acao === "maisUm") {
            const x = botaoDe(b);
            if (x) await pedir(x.posto, x.b, { repetir: acao === "maisUm" });
            return;
        }
        if (acao === "pedirUrgente") {
            const x = botaoDe(b);
            if (!x) return;
            comPinOuConfirmacao(`${x.b.rotulo} · urgente`, pin => pedir(x.posto, x.b, { pin, repetir: true, urgente: true }));
            return;
        }
        if (acao === "urgente") {
            const id = Number(b.dataset.id);
            comPinOuConfirmacao(`Pedido #${id} · urgente`, async pin => {
                const r = await Despacho.tornarUrgente(id, pin);
                if (r.ok) ui.aviso(`Pedido #${id} agora é urgente.`, "sucesso"); else ui.aviso(r.erro, "erro");
                desenhar();
            });
            return;
        }
        if (acao === "cancelar") {
            const id = Number(b.dataset.id);
            if (!await ui.confirmar({ titulo: "Cancelar pedido", texto: `Cancelar o pedido #${id}?`, confirmar: "Cancelar pedido", perigo: true })) return;
            const r = await Despacho.cancelar(id);
            if (!r.ok) ui.aviso(r.erro, "erro");
            desenhar();
        }
    });
    document.addEventListener("change", e => {
        const c = e.target.closest("[data-junto]");
        if (c) { if (c.checked) juntos.add(c.dataset.junto); else juntos.delete(c.dataset.junto); }
    });
    document.getElementById("postoSair")?.addEventListener("click", () => {
        document.body.classList.remove("tela-posto");
        mudarTela("postos");
    });
    document.getElementById("postoSairConta")?.addEventListener("click", async () => {
        const quem = Nuvem.perfil?.()?.email || "deste posto";
        const ok = await ui.confirmar({
            titulo: "Sair deste tablet?",
            texto: `A conta ${quem} sai deste aparelho. Para pedir de novo por aqui, é preciso entrar com o e-mail e a senha do posto.`,
            confirmar: "Sair"
        });
        if (ok) Nuvem.sair();
    });
    document.getElementById("postoTelaCheia")?.addEventListener("click", () => {
        if (document.fullscreenElement) document.exitFullscreen?.();
        else document.documentElement.requestFullscreen?.().catch(() => {});
    });
    Despacho.ouvir(() => { if (document.getElementById("posto")?.classList.contains("ativa")) desenhar(); });

    return { abrir, desenhar, meusPostos, pedirPin };
})();

// "Meu PIN": líder, operador ou admin define o próprio PIN (nuvem)
(function () {
    const b = document.getElementById("btnMeuPin");
    if (!b || !window.Nuvem || !Nuvem.emNuvem()) return;
    b.hidden = !["admin", "operador", "lider"].includes(Nuvem.papel());
    b.addEventListener("click", async () => {
        const pin = await Usuarios.pedirPin("você");
        if (!pin) return;
        const { error } = await Nuvem.cliente().rpc("definir_pin", { p_usuario: Nuvem.usuario().id, p_pin: pin });
        ui.aviso(error ? Nuvem.traduzirErro(error) : "Seu PIN foi definido.", error ? "erro" : "sucesso");
    });
})();

// Número no menu: pedidos esperando AGV
window.aoMudarDespacho = () => {
    const b = document.getElementById("menuBadgeDespacho");
    if (!b) return;
    const n = Despacho.lista().filter(p => p.estado === "pendente").length;
    b.hidden = !n;
    if (b.textContent !== String(n)) b.textContent = n;
};

// O tablet do posto (papel Posto na nuvem) abre direto na tela do posto
if (window.Nuvem && Nuvem.emNuvem() && Nuvem.papel() === "posto") {
    setTimeout(() => mudarTela("posto"), 0);
}
Despacho.iniciar();
