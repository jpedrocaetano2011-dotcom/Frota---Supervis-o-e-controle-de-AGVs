/* ============================================================
   CÓPIAS DA CONFIGURAÇÃO DE CADA AGV
   ============================================================
   Cada vez que os parâmetros de um AGV mudam (status/configuracao),
   o site guarda uma cópia: as 20 últimas por AGV. Serve para:
     · voltar atrás depois de um ajuste que piorou;
     · placa nova ou memória apagada: o site percebe (outra placa em
       sistema/placa, ou tudo voltou ao padrão de fábrica) e oferece
       a última cópia boa;
     · começar um AGV novo pelo padrão do modelo (Frota › Modelos).
   Restaurar não manda direto: coloca os parâmetros escolhidos no
   rascunho de Configurações, para conferir e clicar em Enviar.
   A calibração do QTR não entra (é de cada sensor e do piso).

   Na nuvem: copias_config (guardar_copia_config). Sem nuvem:
   localStorage "copiasConfig".
*/
const Copias = (function () {
    "use strict";

    const MAX = 20;
    // Parâmetros que só mudam com calibração: todos no padrão = memória apagada
    const CALIBRADOS = ["BRACO_ROTACIONAL", "RAIO_RODA", "INVERTER_M1", "INVERTER_M2", "INVERTER_M3", "INVERTER_M4", "GARRA_CURSO"];
    const porAgv = {};            // agvId -> [copias] (mais nova primeiro)
    const contagens = {};         // agvId -> { n, ultima }
    const enviadas = {};          // agvId -> texto da última configuração já guardada/conferida
    const timers = {};
    const esc = t => (typeof escaparHtml === "function" ? escaparHtml(t) : String(t ?? ""));
    const naNuvem = () => Boolean(window.Nuvem && Nuvem.emNuvem());
    const podeGuardar = () => !window.Nuvem || Nuvem.pode("copiar_config");
    const podeRestaurar = () => !naNuvem() || ["fornecedor", "admin", "manutencao"].includes(Nuvem.papel());
    const hora = t => new Date(t).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });
    const ORIGENS = { agv: "do AGV", restaurada: "restaurada", modelo: "padrão do modelo", importada: "importada" };

    function doBanco(x) {
        return { id: x.id, agv: x.agv, criadaEm: Date.parse(x.criada_em ?? x.criadaEm) || Date.now(), porNome: x.criada_por_nome ?? x.porNome ?? "",
                 origem: x.origem || "agv", firmware: x.firmware || "", placa: x.placa || "", resumo: x.resumo || "", parametros: x.parametros || null };
    }

    function lerLocal() {
        try { return JSON.parse(localStorage.getItem("copiasConfig") || "{}"); } catch (e) { return {}; }
    }
    function gravarLocal(tudo) {
        try { localStorage.setItem("copiasConfig", JSON.stringify(tudo)); } catch (e) { /* sem espaço */ }
    }

    // ordem estável das chaves: a mesma configuração dá o mesmo texto
    const texto = p => JSON.stringify(Object.keys(p || {}).sort().reduce((o, k) => { o[k] = p[k]; return o; }, {}));
    const iguais = (a, b) => Math.abs(Number(a) - Number(b)) < 1e-6;

    async function carregar(agvId) {
        if (!naNuvem()) {
            porAgv[agvId] = (lerLocal()[agvId] || []).map(doBanco);
        } else {
            try {
                const r = await Nuvem.cliente().from("copias_config").select("*").eq("empresa_id", Nuvem.empresa().id).eq("agv", agvId)
                    .order("criada_em", { ascending: false }).limit(MAX);
                if (r.error) throw r.error;
                porAgv[agvId] = r.data.map(doBanco);
            } catch (e) {
                porAgv[agvId] = porAgv[agvId] || [];
            }
        }
        const l = porAgv[agvId];
        contagens[agvId] = { n: l.length, ultima: l[0]?.criadaEm || null };
        return l;
    }

    async function carregarTodas() {
        if (!naNuvem()) {
            const tudo = lerLocal();
            Object.keys(tudo).forEach(id => { porAgv[id] = tudo[id].map(doBanco); contagens[id] = { n: tudo[id].length, ultima: porAgv[id][0]?.criadaEm || null }; });
            return;
        }
        try {
            const r = await Nuvem.cliente().from("copias_config").select("agv, criada_em").eq("empresa_id", Nuvem.empresa().id).order("criada_em", { ascending: false }).limit(1000);
            if (r.error) throw r.error;
            Object.keys(contagens).forEach(k => delete contagens[k]);
            r.data.forEach(x => {
                const c = contagens[x.agv] || (contagens[x.agv] = { n: 0, ultima: Date.parse(x.criada_em) });
                c.n++;
            });
        } catch (e) { /* tabela ainda não existe */ }
    }

    const contagem = agvId => contagens[agvId] || { n: 0, ultima: null };
    const lista = agvId => porAgv[agvId] || [];

    /* ---------------- guardar quando a configuração chega ---------------- */

    // Configuração parece de fábrica nos parâmetros calibrados?
    function deFabrica(agv, p) {
        const e = agv.esquemaConfig || {};
        const conferidos = CALIBRADOS.filter(n => e[n] && p[n] !== undefined);
        return conferidos.length >= 2 && conferidos.every(n => iguais(p[n], e[n].padrao));
    }

    async function conferirPlaca(agv, p) {
        const anteriores = porAgv[agv.id] || await carregar(agv.id);
        const ultima = anteriores[0];
        if (!ultima || !ultima.parametros) return;
        const placa = String(agv.sistema?.placa || "");
        const boa = anteriores.find(c => c.parametros && !deFabrica(agv, c.parametros));
        if (placa && ultima.placa && placa !== ultima.placa && boa) {
            agv.avisoCopia = { tipo: "placa", copia: boa.id, quando: Date.now() };
        } else if (deFabrica(agv, p) && boa && texto(p) !== texto(boa.parametros)) {
            agv.avisoCopia = { tipo: "fabrica", copia: boa.id, quando: Date.now() };
        }
    }

    // Chamado pelo configuracoes.js a cada status/configuracao com parâmetros
    function aoReceber(agv) {
        if (!agv || !agv.parametros || !podeGuardar()) return;
        if (naNuvem() && agv.virtual) return;      // o virtual não está no banco
        const t = texto(agv.parametros);
        if (enviadas[agv.id] === t + "|" + (agv.sistema?.placa || "")) return;
        clearTimeout(timers[agv.id]);
        timers[agv.id] = setTimeout(() => guardar(agv, t), 2500);
    }

    async function guardar(agv, t) {
        const p = JSON.parse(t);
        const placa = String(agv.sistema?.placa || "");
        const chave = t + "|" + placa;
        if (enviadas[agv.id] === chave) return;
        const origem = agv.restauracao && agv.restauracao.ate > Date.now() ? agv.restauracao.origem : "agv";
        try {
            await conferirPlaca(agv, p);
            if (naNuvem()) {
                const { error } = await Nuvem.cliente().rpc("guardar_copia_config", {
                    p_empresa: Nuvem.empresa().id, p_agv: agv.id, p_parametros: p,
                    p_firmware: String(agv.sistema?.versao || ""), p_placa: placa, p_origem: origem
                });
                if (error) throw error;
                await carregar(agv.id);
            } else {
                const tudo = lerLocal();
                const l = tudo[agv.id] || [];
                const ultima = l[0];
                if (!ultima || texto(ultima.parametros) !== t || (ultima.placa || "") !== placa) {
                    const mudou = ultima ? Object.keys(Object.assign({}, p, ultima.parametros)).filter(k => !iguais(p[k], ultima.parametros[k])).sort() : [];
                    l.unshift({ id: Date.now(), agv: agv.id, criadaEm: Date.now(), porNome: "este navegador", origem, firmware: String(agv.sistema?.versao || ""), placa,
                                resumo: !ultima ? "primeira cópia" : mudou.length ? (mudou.length <= 4 ? mudou.join(", ") : mudou.slice(0, 4).join(", ") + ` e mais ${mudou.length - 4}`) : "outra placa",
                                parametros: p });
                    tudo[agv.id] = l.slice(0, MAX);
                    gravarLocal(tudo);
                }
                await carregar(agv.id);
            }
            enviadas[agv.id] = chave;
            if (agv.restauracao && origem !== "agv") agv.restauracao = null;
            if (agv.id === (typeof agvSelecionado !== "undefined" ? agvSelecionado : null)) desenhar();
        } catch (erro) {
            console.warn("Cópia da configuração não guardada:", erro?.message || erro);
        }
    }

    /* ---------------- tela (cartão em Configurações) ---------------- */

    function desenhar() {
        const caixa = document.getElementById("cardCopias");
        const agv = typeof agvAtual === "function" ? agvAtual() : null;
        if (!caixa || !agv) return;
        const l = lista(agv.id);
        const m = typeof Modelos !== "undefined" ? Modelos.doAgv(agv) : null;
        const aviso = agv.avisoCopia && Date.now() - agv.avisoCopia.quando < 3600000 ? l.find(c => c.id === agv.avisoCopia.copia) : null;
        const itens = l.map((c, i) => `
            <button type="button" class="copia-item" data-copia="${esc(c.id)}">
                <span><b>${hora(c.criadaEm)}</b>${i === 0 ? ` <span class="pilula verde">atual</span>` : ""} <span class="suave">${esc(ORIGENS[c.origem] || c.origem)}${c.porNome ? " · " + esc(c.porNome) : ""}</span></span>
                <small class="suave">${esc(c.resumo || "")}${c.firmware ? ` · firmware ${esc(c.firmware)}` : ""}</small>
            </button>`).join("");
        ui.trocarHtml(caixa, `
            <div class="card-header"><div><h2>Cópias da configuração</h2><span>as ${MAX} últimas · sem a calibração do QTR</span></div></div>
            ${aviso ? `<div class="alerta-faixa ambar copia-aviso">
                <span>${agv.avisoCopia.tipo === "placa" ? "<b>Placa trocada.</b> Este AGV está com outra placa." : "<b>Configuração de fábrica.</b> A memória do AGV parece ter sido apagada."}</span>
                ${podeRestaurar() ? `<button type="button" class="btn btn-mini btn-primario" data-copia="${esc(aviso.id)}">Restaurar a de ${hora(aviso.criadaEm)}</button>` : ""}
            </div>` : ""}
            <div class="copias-lista">
                ${m && Object.keys(m.parametros || {}).length ? `<button type="button" class="copia-item modelo" data-copia-modelo="${esc(m.id)}"><span><b>Padrão do modelo ${esc(m.nome)}</b></span><small class="suave">${Object.keys(m.parametros).length} parâmetro(s) do catálogo, para começar um AGV novo</small></button>` : ""}
                ${itens || `<div class="empty-state" style="padding:14px">Nenhuma cópia ainda. A primeira é guardada quando o AGV mandar a configuração.</div>`}
            </div>`);
    }

    async function abrir() {
        const agv = typeof agvAtual === "function" ? agvAtual() : null;
        if (!agv) return;
        desenhar();
        await carregar(agv.id);
        desenhar();
    }

    // Diferença entre o AGV agora e a cópia: escolhe o que voltar
    async function comparar(agv, parametros, origem, rotulo) {
        if (!agv.parametros || !agv.esquemaConfig) { ui.aviso("Conecte o AGV antes de restaurar: os parâmetros dele ainda não chegaram.", "aviso"); return; }
        const nomes = Object.keys(parametros).filter(n => agv.esquemaConfig[n] && Number.isFinite(Number(parametros[n])) && !iguais(parametros[n], agv.parametros[n]));
        if (!nomes.length) { ui.aviso(`A configuração do AGV ${agv.id} já é igual a ${rotulo}.`, "info"); return; }
        const rotuloDe = n => (typeof PARAMETROS_SITE !== "undefined" && PARAMETROS_SITE[n]?.rotulo) || n;
        const fmt = v => (typeof formatarNumero === "function" ? formatarNumero(v) : String(v));
        const v = await ui.formulario({
            titulo: `Restaurar ${rotulo}`,
            texto: `${nomes.length} parâmetro(s) diferentes do AGV ${agv.id} agora. Desmarque o que não quer voltar. Os marcados vão para o rascunho de Configurações: confira e clique em Enviar ao AGV.`,
            confirmar: "Levar para o rascunho",
            campos: nomes.map(n => ({ nome: n, tipo: "checkbox", valor: true, rotulo: `${rotuloDe(n)}: ${fmt(agv.parametros[n])} → ${fmt(parametros[n])}` }))
        });
        if (!v) return;
        const escolhidos = {};
        nomes.filter(n => v[n]).forEach(n => { escolhidos[n] = Number(parametros[n]); });
        if (!Object.keys(escolhidos).length) return;
        agv.restauracao = { origem, ate: Date.now() + 10 * 60000 };
        agv.avisoCopia = null;
        if (typeof carregarNoRascunho === "function") carregarNoRascunho(agv, escolhidos, rotulo);
        desenhar();
    }

    document.addEventListener("click", async evento => {
        const alvo = evento.target.closest("#cardCopias [data-copia], #cardCopias [data-copia-modelo]");
        if (!alvo) return;
        const agv = agvAtual();
        if (!agv) return;
        if (!podeRestaurar()) { ui.aviso("Só o administrador e a manutenção restauram a configuração.", "aviso"); return; }
        if (alvo.dataset.copiaModelo) {
            const m = Modelos.porId(alvo.dataset.copiaModelo);
            if (m) comparar(agv, m.parametros || {}, "modelo", `o padrão do ${m.nome}`);
            return;
        }
        const c = lista(agv.id).find(x => String(x.id) === alvo.dataset.copia);
        if (c?.parametros) comparar(agv, c.parametros, "restaurada", `a cópia de ${hora(c.criadaEm)}`);
    });

    return { aoReceber, carregar, carregarTodas, contagem, lista, abrir, desenhar, deFabrica };
})();
