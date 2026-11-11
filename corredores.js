/* ============================================================
   TRÁFEGO NA OPERAÇÃO (0.19)
   ============================================================
   - Corredores fechados: o líder fecha um trecho sem republicar a
     planta (limpeza, derramamento, manutenção). As próximas missões
     desviam; sem outro caminho, o pedido espera e diz por quê.
     Na nuvem fica em trechos_fechados (todos os sites releem a cada
     20 s); sem nuvem, neste navegador.
   - (0.23) Desvio automático: a aba que despacha confere a rota de quem
     já está em missão; trecho fechado à frente (ou um Atta parado no
     caminho: sem bateria, em falha ou emergência há 1 min fora do berço
     e da estação, que fecha os trechos dele sozinho, até sair) → a rota
     é refeita a partir do próximo ponto e vai em comando/desvio; o Atta
     troca ao chegar nesse ponto. Sem outro caminho, a aba avisa e registra
     (o Atta segue a rota que tem: reabra o trecho ou cancele a missão).
   - (0.24.1) Regras do tráfego (o card, para quem pode fechar trechos):
     depois de quanto tempo um Atta parado no caminho fecha os trechos
     dele (padrão 60 s; 0 = nunca) e depois de quanto tempo um obstáculo
     que segura um Atta em missão fecha o trecho para os outros (padrão
     0 = nunca). O Atta que está na frente do obstáculo não recua (não tem
     sensor atrás): ele segue quando o caminho ficar livre; os outros
     desviam. Fila atrás de outro Atta não conta como obstáculo.
     Na nuvem fica em trafego_config; sem nuvem, neste navegador.
   - Impasse: dois ou mais Atta esperando um pelo outro (A espera a
     zona que B ocupa e B espera a que A ocupa). O site detecta, avisa
     e sugere cancelar a missão de um deles: parado sem missão, ele
     sai sozinho para um ponto de espera e libera o outro.
*/

const TrafegoOperacao = (function () {
    "use strict";

    const CHAVE_LOCAL = "trechosFechados";
    const CHAVE_REGRAS = "trafegoRegras";
    const REGRAS_PADRAO = { fecharParadoS: 60, desviarObstaculoS: 0 };
    let regras = Object.assign({}, REGRAS_PADRAO);
    const validarRegras = r => ({
        fecharParadoS: Number(r.fecharParadoS) === 0 ? 0 : Math.max(10, Math.min(1800, Math.round(Number(r.fecharParadoS) || 60))),
        desviarObstaculoS: Number(r.desviarObstaculoS) === 0 ? 0 : Math.max(15, Math.min(600, Math.round(Number(r.desviarObstaculoS) || 0)))
    });
    const IMPASSE_S = 20;
    let fechados = [];            // [{ segmento, motivo, ate (ISO|null), por_nome, em }]
    const impasseDesde = new Map();
    const avisados = new Set();

    const esc = t => (typeof escaparHtml === "function" ? escaparHtml(t) : String(t ?? ""));
    const planta = () => (typeof plantaPublicada === "function" ? plantaPublicada() : null);
    const naNuvem = () => Boolean(window.Nuvem && Nuvem.emNuvem && Nuvem.emNuvem());
    const pode = nivel => !window.Nuvem || Nuvem.pode(nivel);
    const ativos = () => fechados.filter(f => !f.ate || new Date(f.ate).getTime() > Date.now());

    // 0.23: trechos fechados sozinhos por um Atta parado no caminho (só nesta aba, até ele sair)
    let automaticos = [];   // [{ segmento, agv, motivo, em }]
    function aplicar() {
        if (typeof Planta === "undefined") return;
        Planta.definirContextoRota({ fechados: [...new Set(ativos().map(f => f.segmento).concat(automaticos.map(a => a.segmento)))] });
    }

    async function carregar() {
        if (naNuvem()) {
            const emp = Nuvem.empresa();
            if (!emp) return;
            const r = await Nuvem.cliente().from("trechos_fechados").select("segmento, motivo, ate, por_nome, em").eq("empresa_id", emp.id);
            if (!r.error) fechados = r.data || [];
            // as regras (o banco sem a tabela nova: ficam os padrões)
            const g = await Nuvem.cliente().from("trafego_config").select("fechar_parado_s, desviar_obstaculo_s").eq("empresa_id", emp.id).maybeSingle();
            if (!g.error) regras = g.data ? validarRegras({ fecharParadoS: g.data.fechar_parado_s, desviarObstaculoS: g.data.desviar_obstaculo_s }) : Object.assign({}, REGRAS_PADRAO);
        } else {
            try { fechados = JSON.parse(localStorage.getItem(CHAVE_LOCAL) || "[]"); } catch (e) { fechados = []; }
            try { regras = validarRegras(Object.assign({}, REGRAS_PADRAO, JSON.parse(localStorage.getItem(CHAVE_REGRAS) || "{}"))); } catch (e) { regras = Object.assign({}, REGRAS_PADRAO); }
        }
        const antes = JSON.stringify(Planta.definirContextoRota().fechados.sort());
        aplicar();
        if (JSON.stringify(Planta.definirContextoRota().fechados.sort()) !== antes) redesenharMapas();
        renderizar();
    }

    async function salvarRegras(novas) {
        const r = validarRegras(novas);
        if (naNuvem()) {
            const x = await Nuvem.cliente().rpc("salvar_trafego_config", { p_empresa: Nuvem.empresa().id, p_fechar_parado_s: r.fecharParadoS, p_desviar_obstaculo_s: r.desviarObstaculoS });
            if (x.error) { ui.aviso(/salvar_trafego_config|trafego_config/.test(x.error.message || "") ? "O banco ainda não tem as regras do tráfego: rode o 01_esquema.sql atual no Supabase." : `Não salvou: ${x.error.message}`, "erro"); return false; }
        } else {
            try { localStorage.setItem(CHAVE_REGRAS, JSON.stringify(r)); } catch (e) { /* ignora */ }
        }
        regras = r;
        ui.aviso("Regras do tráfego salvas.", "sucesso");
        renderizar();
        return true;
    }

    function gravarLocal() {
        try { localStorage.setItem(CHAVE_LOCAL, JSON.stringify(fechados)); } catch (e) { /* ignora */ }
    }

    async function fechar(segmentos, motivo, minutos) {
        if (window.Nuvem && !Nuvem.exigir("trafego", "fechar corredores")) return false;
        const ate = minutos > 0 ? new Date(Date.now() + minutos * 60000).toISOString() : null;
        if (naNuvem()) {
            const r = await Nuvem.cliente().rpc("fechar_trechos", { p_empresa: Nuvem.empresa().id, p_segmentos: segmentos, p_motivo: motivo || "", p_ate: ate });
            if (r.error) { ui.aviso(Nuvem.traduzirErro ? Nuvem.traduzirErro(r.error) : r.error.message, "erro"); return false; }
        } else {
            const nome = window.Nuvem?.usuario?.()?.email || "";
            segmentos.forEach(sg => {
                fechados = fechados.filter(f => f.segmento !== sg);
                fechados.push({ segmento: sg, motivo: motivo || "", ate, por_nome: nome, em: new Date().toISOString() });
            });
            gravarLocal();
        }
        await carregar();
        const afetados = agvsComRotaPor(segmentos);
        ui.aviso(`Fechado: ${segmentos.join(", ")}. As próximas missões desviam${afetados.length ? `; ${afetados.join(", ")} já tem rota por ali: a aba que despacha manda a rota nova (o Atta troca no próximo ponto)` : ""}.`, afetados.length ? "aviso" : "sucesso");
        return true;
    }

    async function reabrir(segmentos) {
        if (window.Nuvem && !Nuvem.exigir("trafego", "reabrir corredores")) return false;
        if (naNuvem()) {
            const r = await Nuvem.cliente().rpc("reabrir_trechos", { p_empresa: Nuvem.empresa().id, p_segmentos: segmentos });
            if (r.error) { ui.aviso(r.error.message, "erro"); return false; }
        } else {
            fechados = fechados.filter(f => !segmentos.includes(f.segmento));
            gravarLocal();
        }
        await carregar();
        ui.aviso(`Reaberto: ${segmentos.join(", ")}.`, "sucesso");
        return true;
    }

    // AGVs com missão em andamento cuja rota passa por estes trechos
    function agvsComRotaPor(segmentos) {
        if (typeof agvs === "undefined") return [];
        return Object.values(agvs).filter(a => {
            const c = a.missaoCompilada;
            const ativa = c && (a.missaoAtual === c.missao || a.missaoCarregada === c.missao);
            const etapas = ativa ? c.etapas || [] : [];
            return etapas.some(e => (e.trechos || []).some(t => segmentos.includes(t.segmento)));
        }).map(a => a.id);
    }

    function redesenharMapas() {
        try { if (typeof EditorPlanta !== "undefined" && EditorPlanta.redesenhar) EditorPlanta.redesenhar(); } catch (e) { /* ignora */ }
        try { if (typeof renderizarMapaVisaoGeral === "function" && document.getElementById("visaoGeral")?.classList.contains("ativa")) renderizarMapaVisaoGeral(); } catch (e) { /* ignora */ }
    }

    /* ---------------- desvio automático (0.23) ---------------- */
    const EM_MISSAO = ["EM_EXECUCAO", "AGUARDANDO_CONFIRMACAO", "INTERROMPIDA"];
    const paradoDesde = new Map();
    const obstruidoDesde = new Map();
    const semDesvioAvisado = new Map();
    let ultimoDesvio = 0;
    // Atta parado no caminho: sem bateria, em falha ou emergência há 1 min, num ponto que não é berço, espera nem estação
    function atualizarAutomaticos(p) {
        const agora = Date.now();
        const novos = [];
        Object.values(agvs).forEach(a => {
            const bat = typeof BateriaOperacao !== "undefined" ? BateriaOperacao.cargaDe(a) : { pct: a.bateria };
            const semBateria = bat.pct != null && bat.pct < 3;
            const falha = a.online && (a.emergencia || a.maquina === "EMERGENCIA" || a.maquina === "PARADO" || a.estadoMissao === "ERRO");
            const motivo = semBateria ? "sem bateria" : falha ? "em falha ou emergência" : null;
            const no = a.posicaoConhecida && a.pontoAtual ? Planta.noPorId(p, a.pontoAtual) : null;
            if (!motivo || !no || ["BERCO", "ESPERA", "ESTACAO"].includes(no.tipo) || EM_MISSAO.includes(a.estadoMissao) && !falha || !regras.fecharParadoS) { paradoDesde.delete(a.id); return; }
            const desde = paradoDesde.get(a.id) || agora;
            paradoDesde.set(a.id, desde);
            if (agora - desde < regras.fecharParadoS * 1000) return;
            p.segmentos.filter(sg => sg.a === no.id || sg.b === no.id).forEach(sg => novos.push({ segmento: sg.id, agv: a.id, tipo: "parado", motivo: `${a.id} parado (${motivo}) em ${no.id}`, em: desde }));
        });
        // 0.24.1: obstáculo que segura um Atta em missão (não é fila atrás de outro Atta): fecha o trecho dele para os outros
        Object.values(agvs).forEach(a => {
            const tr = regras.desviarObstaculoS && a.online && a.trafego?.ob && EM_MISSAO.includes(a.estadoMissao) ? trechoAtual(a) : null;
            const fila = tr && Object.values(agvs).some(b => b !== a && b.online && (b.pontoAtual === tr.destino || trechoAtual(b)?.segmento === tr.segmento));
            if (!tr || !tr.segmento || fila) { obstruidoDesde.delete(a.id); return; }
            const desde = obstruidoDesde.get(a.id) || agora;
            obstruidoDesde.set(a.id, desde);
            if (agora - desde < regras.desviarObstaculoS * 1000) return;
            const s0 = Planta.segmentoPorId(p, tr.segmento);
            const gemeo = s0 && Planta.segmentoGemeo ? Planta.segmentoGemeo(p, s0) : null;
            [tr.segmento].concat(gemeo ? [gemeo.id] : []).forEach(sg => novos.push({ segmento: sg, agv: a.id, tipo: "obstaculo", motivo: `obstáculo na frente do ${a.id} em ${tr.origem || "?"} → ${tr.destino || "?"} (ele segue quando o caminho ficar livre)`, em: desde }));
        });
        const antes = automaticos.map(x => x.segmento).sort().join();
        automaticos = novos;
        if (novos.map(x => x.segmento).sort().join() !== antes) {
            aplicar();
            if (novos.length) {
                ui.aviso(`Trecho fechado sozinho: ${[...new Set(novos.map(x => x.motivo))].join("; ")}. Quem passaria por ali desvia.`, "aviso");
                const ant = new Set(antes.split(","));
                novos.filter(x => !ant.has(x.segmento)).forEach(x => { if (typeof registrarAcaoSite === "function") registrarAcaoSite(x.agv, "trafego", x.tipo === "obstaculo" ? "TRECHO_FECHADO_OBSTACULO" : "TRECHO_FECHADO_PARADO", `${x.segmento}: ${x.motivo}`); });
            }
            renderizar();
        }
    }
    // o trecho em que o Atta está agora (pela missão compilada e o progresso)
    function trechoAtual(a) {
        const c = a.missaoCompilada;
        if (!c || !c.etapas) return null;
        const pr = a.progressoTrecho && Date.now() - (a.progressoTrecho.quando || 0) < 5000 ? a.progressoTrecho : null;
        const i = pr ? pr.indice : Number(a.etapaMissao) || 0;
        const t = pr ? pr.trecho : Number(a.trechoMissao) || 0;
        const e = c.etapas[i];
        return e && e.tipo === "MOVIMENTO" ? (e.trechos || [])[t] || null : null;
    }
    // a origem da missão (para refazer o resto dela): a missão cadastrada ou a de saída/carga
    function missaoOriginal(id) {
        const m = typeof obterMissaoPorId === "function" ? obterMissaoPorId(id) : null;
        if (m) return m;
        const saida = /^(?:SAIDA|CASA|IDA|CARGA)-(.+)$/.exec(String(id));
        return saida ? { id: String(id), etapas: [{ tipo: "IR_PARA", destino: saida[1], exato: true }] } : null;
    }
    function segmentosDe(etapas) { return etapas.flatMap(e => (e.trechos || []).map(t => t.segmento)).filter(Boolean); }
    // confere todos os Atta em missão (só a aba que despacha chama)
    function desviar() {
        const agora = Date.now();
        if (agora - ultimoDesvio < 3000 || typeof agvs === "undefined" || typeof Planta === "undefined") return;
        ultimoDesvio = agora;
        const p = planta();
        if (!p) return;
        atualizarAutomaticos(p);
        const bloqueados = new Set(ativos().map(f => f.segmento).concat(automaticos.map(x => x.segmento)));
        if (!bloqueados.size) return;
        Object.values(agvs).forEach(a => {
            if (!a.online || !EM_MISSAO.includes(a.estadoMissao)) return;
            const c = a.missaoCompilada;
            if (!c || !c.etapas || String(c.missao) !== String(a.missaoAtual)) return;
            const pr = a.progressoTrecho && Date.now() - (a.progressoTrecho.quando || 0) < 5000 ? a.progressoTrecho : null;
            const i = pr ? pr.indice : Number(a.etapaMissao) || 0;
            const t = pr ? pr.trecho : Number(a.trechoMissao) || 0;
            const fase = pr ? pr.fase : a.faseMissao;
            const etapa = c.etapas[i];
            if (!etapa || etapa.tipo !== "MOVIMENTO" || !(etapa.trechos || []).length) return;
            // onde trocar: parado na origem do trecho = aqui; andando = o fim do trecho atual (nunca no meio)
            const parado = fase === "INICIO" && a.posicaoConhecida && a.pontoAtual === etapa.trechos[t]?.origem;
            const ponto = parado ? etapa.trechos[t].origem : etapa.trechos[t]?.destino || etapa.destino;
            const resto = [Object.assign({}, etapa, { trechos: etapa.trechos.slice(parado ? t : t + 1) })].concat(c.etapas.slice(i + 1));
            const naFrente = segmentosDe(resto).filter(sg => bloqueados.has(sg));
            if (!naFrente.length) { semDesvioAvisado.delete(a.id); return; }
            if (a.desvio && a.desvio.ponto === ponto && agora - a.desvio.em < 20000) return;   // já mandado, esperando o Atta
            const orig = missaoOriginal(c.missao);
            const k = etapa.passo ?? etapa.indice ?? i;
            if (!orig || !orig.etapas?.[k] || orig.etapas[k].tipo !== "IR_PARA") return;
            const nova = Object.assign({}, orig, { id: String(c.missao), etapas: [Object.assign({}, orig.etapas[k])].concat(orig.etapas.slice(k + 1)) });
            const trecho = etapa.trechos[parado ? t : t];
            const orientacao = parado ? Number(a.orientacao) || 0 : Number(trecho?.anguloFinal ?? trecho?.angulo ?? a.orientacao) || 0;
            aplicar();
            const comp = Planta.compilarMissao(p, nova, { ponto, orientacao }, typeof opcoesRotaAgv === "function" ? opcoesRotaAgv(a, true) : {});
            const aindaBloqueia = comp.sucesso && segmentosDe(comp.pacote.etapas).some(sg => bloqueados.has(sg));
            if (!comp.sucesso || aindaBloqueia) {
                if (!semDesvioAvisado.has(a.id)) {
                    semDesvioAvisado.set(a.id, agora);
                    ui.aviso(`${a.id}: ${naFrente.join(", ")} fechado à frente e sem outro caminho a partir de ${ponto}. Ele segue a rota que tem: reabra o trecho ou cancele a missão.`, "aviso");
                    if (typeof registrarAcaoSite === "function") registrarAcaoSite(a.id, "trafego", "SEM_DESVIO", `Sem outro caminho a partir de ${ponto} (fechado: ${naFrente.join(", ")})`);
                }
                return;
            }
            const rev = String(Math.abs([...segmentosDe(comp.pacote.etapas).join("|") + ponto].reduce((h, ch) => ((h << 5) - h + ch.charCodeAt(0)) | 0, 0))).slice(0, 12);
            const pacote = Object.assign(Planta.pacoteParaESP(comp.pacote), { desvio: { ponto, rev } });
            if (typeof publicar === "function" && publicar(TOPICOS.comando.desvio, JSON.stringify(pacote), a.id)) {
                a.desvio = { ponto, rev, em: agora, etapas: comp.pacote.etapas, fechados: naFrente };
                if (typeof registrarAcaoSite === "function") registrarAcaoSite(a.id, "trafego", "DESVIO_ENVIADO", `Rota nova a partir de ${ponto} (fechado à frente: ${naFrente.join(", ")})`);
            }
        });
    }
    // o Atta respondeu (evento/missao DESVIO_*)
    function aoEventoDesvio(a, dados) {
        const ev = dados.evento || dados.tipo;
        if (ev === "DESVIO_APLICADO" && a.desvio?.etapas) {
            a.missaoCompilada = { missao: String(a.missaoAtual || a.missaoCompilada?.missao || ""), revisao: planta()?.revisao, etapas: a.desvio.etapas };
            ui.aviso(`${a.id} desviou: ${dados.mensagem || "rota nova"}.`, "info");
            a.desvio = null;
            redesenharMapas();
        } else if (ev === "DESVIO_REJEITADO") {
            if (a.desvio) a.desvio.em = Date.now() - 10000;   // tenta de novo em 10 s
            console.warn(`${a.id}: desvio recusado: ${dados.mensagem || ""}`);
        }
    }

    /* ---------------- impasse ---------------- */

    // Ciclos de espera entre AGVs (cada um parado esperando zona que o próximo ocupa)
    function impasses() {
        if (typeof agvs === "undefined") return [];
        const lista = Object.values(agvs).filter(a => a.trafego && a.trafego.ag && (a.trafego.p || []).length);
        const espera = new Map();
        lista.forEach(a => {
            const quem = Object.values(agvs).filter(b => b !== a && b.trafego && (b.trafego.o || []).some(z => a.trafego.p.includes(z))).map(b => b.id);
            espera.set(a.id, quem);
        });
        const ciclos = [];
        const vistos = new Set();
        espera.forEach((_, inicio) => {
            const caminho = [];
            const andar = id => {
                const k = caminho.indexOf(id);
                if (k >= 0) { ciclos.push(caminho.slice(k)); return true; }
                if (!espera.has(id) || caminho.length > 12) return false;
                caminho.push(id);
                for (const prox of espera.get(id)) if (andar(prox)) return true;
                caminho.pop();
                return false;
            };
            if (!vistos.has(inicio)) andar(inicio);
            caminho.forEach(id => vistos.add(id));
        });
        // um por conjunto
        const unicos = new Map();
        ciclos.forEach(c => { const k = [...c].sort().join("+"); if (!unicos.has(k)) unicos.set(k, c); });
        return [...unicos.values()];
    }

    // Quem sugerir para sair: menor prioridade; empate: quem tem mais caminho pela frente
    function sugerido(ciclo) {
        return [...ciclo].sort((x, y) => {
            const a = agvs[x].trafego || {}, b = agvs[y].trafego || {};
            return (Number(a.pr ?? 1) - Number(b.pr ?? 1)) || (Number(b.r || 0) - Number(a.r || 0));
        })[0];
    }

    function impassesConfirmados() {
        const agora = Date.now();
        const atuais = impasses();
        const chaves = new Set(atuais.map(c => [...c].sort().join("+")));
        [...impasseDesde.keys()].forEach(k => { if (!chaves.has(k)) { impasseDesde.delete(k); avisados.delete(k); } });
        return atuais.filter(c => {
            const k = [...c].sort().join("+");
            if (!impasseDesde.has(k)) impasseDesde.set(k, agora);
            const ok = agora - impasseDesde.get(k) >= IMPASSE_S * 1000;
            if (ok && !avisados.has(k)) {
                avisados.add(k);
                ui.aviso(`Impasse: ${c.join(" e ")} esperam um pelo outro. Veja em Despacho › Tráfego.`, "erro");
                if (typeof registrarAcaoSite === "function") c.forEach(id => { try { registrarAcaoSite(id, "trafego", "IMPASSE", `Esperando ${c.filter(x => x !== id).join(", ")} (e vice-versa)`); } catch (e) { /* ignora */ } });
            }
            return ok;
        }).map(c => ({ agvs: c, desde: impasseDesde.get([...c].sort().join("+")), sugerido: sugerido(c) }));
    }

    function resolver(id) {
        if (typeof selecionarAGV === "function") selecionarAGV(id);
        if (typeof mudarTela === "function") mudarTela("visaoGeral");
        setTimeout(() => { if (typeof abrirFormularioCancelamentoMissao === "function") abrirFormularioCancelamentoMissao(); }, 200);
    }

    // Bloco de impasses (Frota › Tráfego e Despacho)
    function htmlImpasses() {
        const lista = impassesConfirmados();
        if (!lista.length) return "";
        return lista.map(i => `<div class="trafego-impasse" role="alert">
            <b>Impasse há ${ui.duracao(Math.round((Date.now() - i.desde) / 1000))}:</b> ${i.agvs.map(id => `<strong>${esc(id)}</strong> espera ${esc((agvs[id].trafego?.p || []).join(", "))}`).join(" · ")}.
            Nenhum vai andar sozinho. Cancele a missão de um deles: parado, ele sai para um ponto de espera e libera o outro (o pedido volta para a fila).
            ${pode("operar") ? `<button type="button" class="btn btn-mini btn-perigo" data-trafego="resolver" data-id="${esc(i.sugerido)}">Cancelar a missão de ${esc(i.sugerido)}</button>` : ""}
        </div>`).join("");
    }

    /* ---------------- tela (Despacho › Tráfego) ---------------- */

    function descreverSegmento(p, s) {
        const n = id => Planta.nomeDoPonto ? Planta.nomeDoPonto(p, id) : id;
        const seta = s.sentido === "B_PARA_A" ? "←" : s.sentido === "A_PARA_B" ? "→" : "↔";
        return `${s.id} · ${n(s.a)} ${seta} ${n(s.b)} (${String(Planta.arred(Planta.comprimentoSegmento(p, s), 1)).replace(".", ",")} m)`;
    }

    function renderizar() {
        const caixa = document.getElementById("trafegoOperacao");
        if (!caixa) return;
        const p = planta();
        if (!p) { caixa.innerHTML = ""; return; }
        const lista = ativos();
        const segs = p.segmentos.filter(s => Planta.temFita ? Planta.temFita(s) || Planta.tipoSegmento(s) === "LATERAL" : true)
            .sort((a, b) => a.id.localeCompare(b.id, "pt-BR", { numeric: true }));
        const proibidas = (p.layout || []).filter(o => o.horario && o.tipo === "ZONA_PROIBIDA" && Planta.horarioAtivo(o));
        const lentas = (p.layout || []).filter(o => o.horario && o.tipo === "ZONA_LENTA" && Planta.horarioAtivo(o));
        const podeFechar = pode("trafego");
        const html = `
            ${htmlImpasses()}
            <section class="card card-sem-padding">
                <div class="card-barra"><div><h2>Controle de Tráfego</h2><div class="card-sub">Feche um trecho sem republicar a planta: o Atta em missão refaz a rota no próximo ponto (desvio automático) e as próximas missões já saem desviando; sem outro caminho, o pedido espera. Um Atta parado sem bateria no caminho fecha os trechos dele sozinho.</div></div></div>
                ${automaticos.length ? `<div class="missao-dica ambar">Fechados sozinhos (até o Atta sair ou o caminho ficar livre): ${automaticos.map(x => `<b>${esc(x.segmento)}</b> (${esc(x.motivo)})`).join(", ")}.</div>` : ""}
                ${lista.length ? `<div class="tabela-rolagem"><table class="tabela-usuarios"><thead><tr><th>Trecho</th><th>Motivo</th><th>Até</th><th>Por</th><th></th></tr></thead><tbody>
                    ${lista.map(f => { const s = Planta.segmentoPorId(p, f.segmento); return `<tr>
                        <td><strong>${esc(s ? descreverSegmento(p, s) : f.segmento)}</strong>${s ? "" : ` <span class="pilula ambar">não existe mais na planta</span>`}</td>
                        <td>${esc(f.motivo || "—")}</td>
                        <td class="suave">${f.ate ? new Date(f.ate).toLocaleString("pt-BR", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" }) : "até reabrir"}</td>
                        <td class="suave">${esc(f.por_nome || "")}</td>
                        <td class="usuarios-acao">${podeFechar ? `<button type="button" class="btn btn-mini" data-trafego="reabrir" data-id="${esc(f.segmento)}">Reabrir</button>` : ""}</td>
                    </tr>`; }).join("")}</tbody></table></div>` : `<p class="suave trafego-vazio">Nenhum trecho fechado agora.</p>`}
                ${podeFechar ? `<form class="trafego-form" onsubmit="return false">
                    <label class="campo"><span>Trecho</span><select id="trafegoTrecho">${segs.filter(s => !lista.some(f => f.segmento === s.id)).map(s => `<option value="${esc(s.id)}">${esc(descreverSegmento(p, s))}</option>`).join("")}</select></label>
                    <label class="campo"><span>Motivo</span><input id="trafegoMotivo" maxlength="120" placeholder="Ex.: limpeza do piso"></label>
                    <label class="campo"><span>Reabre</span><select id="trafegoAte"><option value="0">quando alguém reabrir</option><option value="30">em 30 min</option><option value="60">em 1 h</option><option value="120">em 2 h</option><option value="240">em 4 h</option></select></label>
                    <button type="button" class="btn btn-perigo" data-trafego="fechar">Fechar o trecho</button>
                </form>` : ""}
                <details class="trafego-auto"${podeFechar ? "" : " open"}><summary>Regras automáticas: <b>Atta parado ${regras.fecharParadoS ? `fecha os trechos em ${ui.duracao(regras.fecharParadoS)}` : "não fecha os trechos"}</b> · <b>obstáculo ${regras.desviarObstaculoS ? `desvia os outros em ${ui.duracao(regras.desviarObstaculoS)}` : "só faz esperar"}</b></summary>
                    ${podeFechar ? `<form class="trafego-form" onsubmit="return false">
                        <label class="campo"><span>Atta parado no caminho fecha os trechos dele depois de</span><span class="campo-unidade"><input type="number" id="trafegoParadoS" min="0" max="1800" step="5" value="${regras.fecharParadoS}"><i>s</i></span><small class="suave">Sem bateria, em falha ou emergência, fora de berço, espera e estação. 0 = nunca. Curto: desvia rápido, mas também numa parada de segundos.</small></label>
                        <label class="campo"><span>Obstáculo na frente desvia os outros depois de</span><span class="campo-unidade"><input type="number" id="trafegoObstaculoS" min="0" max="600" step="5" value="${regras.desviarObstaculoS}"><i>s</i></span><small class="suave">Fecha o trecho do Atta parado pelo obstáculo para quem vem atrás. Ele mesmo não recua (não tem sensor atrás): segue quando o caminho ficar livre. Fila atrás de outro Atta não conta. 0 = nunca. Use bem mais que o "Retomar depois de obstáculo" (Configurações), senão uma pessoa passando já desvia a frota.</small></label>
                        <button type="button" class="btn" data-trafego="regras">Salvar as regras</button>
                    </form>` : `<p class="suave">Só quem pode fechar trechos muda as regras.</p>`}
                </details>
            </section>
            ${proibidas.length || lentas.length ? `<section class="card"><h2>Regras por horário valendo agora</h2><ul class="trafego-regras">
                ${proibidas.map(o => `<li><span class="pilula vermelho">zona proibida</span> ${esc(o.nome || o.id)} · ${esc(Planta.descreverHorario(o.horario))}</li>`).join("")}
                ${lentas.map(o => `<li><span class="pilula ambar">zona lenta</span> ${esc(o.nome || o.id)} · ${String(o.velocidadeMaxima || "").replace(".", ",")} m/s · ${esc(Planta.descreverHorario(o.horario))}</li>`).join("")}
            </ul></section>` : ""}`;
        if (caixa.__html !== html) { caixa.__html = html; ui.trocarHtml(caixa, html); }
    }

    document.addEventListener("click", evento => {
        const b = evento.target.closest("[data-trafego]");
        if (!b) return;
        if (b.dataset.trafego === "reabrir") reabrir([b.dataset.id]);
        if (b.dataset.trafego === "resolver") resolver(b.dataset.id);
        if (b.dataset.trafego === "regras") salvarRegras({ fecharParadoS: document.getElementById("trafegoParadoS")?.value, desviarObstaculoS: document.getElementById("trafegoObstaculoS")?.value });
        if (b.dataset.trafego === "fechar") {
            const sg = document.getElementById("trafegoTrecho")?.value;
            if (!sg) return;
            const motivo = document.getElementById("trafegoMotivo")?.value.trim() || "";
            const min = Number(document.getElementById("trafegoAte")?.value) || 0;
            const p = planta();
            const s = p && Planta.segmentoPorId(p, sg);
            const gemeo = s && Planta.segmentoGemeo(p, s);
            fechar(gemeo ? [sg, gemeo.id] : [sg], motivo, min);
        }
    });

    // relê (nuvem), expira e confere impasses
    setInterval(() => {
        if (naNuvem()) carregar().catch(() => {});
        else { aplicar(); }
        if (document.getElementById("despacho")?.classList.contains("ativa")) renderizar();
    }, 20000);
    setInterval(() => {
        const n = impassesConfirmados().length;
        const despacho = document.getElementById("despacho")?.classList.contains("ativa");
        if (despacho || n) renderizar();
    }, 3000);
    setTimeout(() => carregar().catch(() => {}), 800);

    return { carregar, fechar, reabrir, ativos, impasses, impassesConfirmados, htmlImpasses, renderizar, resolver, desviar, aoEventoDesvio, automaticos: () => automaticos.slice(),
        regras: () => Object.assign({}, regras), salvarRegras };
})();
