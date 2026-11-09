/* ============================================================
   TRÁFEGO NA OPERAÇÃO (0.19)
   ============================================================
   - Corredores fechados: o líder fecha um trecho sem republicar a
     planta (limpeza, derramamento, manutenção). As próximas missões
     desviam; sem outro caminho, o pedido espera e diz por quê.
     Na nuvem fica em trechos_fechados (todos os sites releem a cada
     20 s); sem nuvem, neste navegador.
   - Impasse: dois ou mais Atta esperando um pelo outro (A espera a
     zona que B ocupa e B espera a que A ocupa). O site detecta, avisa
     e sugere cancelar a missão de um deles: parado sem missão, ele
     sai sozinho para um ponto de espera e libera o outro.
*/

const TrafegoOperacao = (function () {
    "use strict";

    const CHAVE_LOCAL = "trechosFechados";
    const IMPASSE_S = 20;
    let fechados = [];            // [{ segmento, motivo, ate (ISO|null), por_nome, em }]
    const impasseDesde = new Map();
    const avisados = new Set();

    const esc = t => (typeof escaparHtml === "function" ? escaparHtml(t) : String(t ?? ""));
    const planta = () => (typeof plantaPublicada === "function" ? plantaPublicada() : null);
    const naNuvem = () => Boolean(window.Nuvem && Nuvem.emNuvem && Nuvem.emNuvem());
    const pode = nivel => !window.Nuvem || Nuvem.pode(nivel);
    const ativos = () => fechados.filter(f => !f.ate || new Date(f.ate).getTime() > Date.now());

    function aplicar() {
        if (typeof Planta === "undefined") return;
        Planta.definirContextoRota({ fechados: ativos().map(f => f.segmento) });
    }

    async function carregar() {
        if (naNuvem()) {
            const emp = Nuvem.empresa();
            if (!emp) return;
            const r = await Nuvem.cliente().from("trechos_fechados").select("segmento, motivo, ate, por_nome, em").eq("empresa_id", emp.id);
            if (!r.error) fechados = r.data || [];
        } else {
            try { fechados = JSON.parse(localStorage.getItem(CHAVE_LOCAL) || "[]"); } catch (e) { fechados = []; }
        }
        const antes = JSON.stringify(Planta.definirContextoRota().fechados.sort());
        aplicar();
        if (JSON.stringify(Planta.definirContextoRota().fechados.sort()) !== antes) redesenharMapas();
        renderizar();
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
        ui.aviso(`Fechado: ${segmentos.join(", ")}. As próximas missões desviam${afetados.length ? `; ${afetados.join(", ")} já tem rota por ali (missão carregada antes): cancele e peça de novo se precisar` : ""}.`, afetados.length ? "aviso" : "sucesso");
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
                <div class="card-barra"><div><h2>Corredores fechados</h2><div class="card-sub">Feche um trecho sem republicar a planta: as próximas missões desviam; sem outro caminho, o pedido espera.</div></div></div>
                ${lista.length ? `<div class="tabela-rolagem"><table class="tabela-usuarios"><thead><tr><th>Trecho</th><th>Motivo</th><th>Até</th><th>Por</th><th></th></tr></thead><tbody>
                    ${lista.map(f => { const s = Planta.segmentoPorId(p, f.segmento); return `<tr>
                        <td><strong>${esc(s ? descreverSegmento(p, s) : f.segmento)}</strong>${s ? "" : ` <span class="pilula ambar">não existe mais na planta</span>`}</td>
                        <td>${esc(f.motivo || "—")}</td>
                        <td class="suave">${f.ate ? new Date(f.ate).toLocaleString("pt-BR", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" }) : "até reabrir"}</td>
                        <td class="suave">${esc(f.por_nome || "")}</td>
                        <td class="usuarios-acao">${podeFechar ? `<button type="button" class="btn btn-mini" data-trafego="reabrir" data-id="${esc(f.segmento)}">Reabrir</button>` : ""}</td>
                    </tr>`; }).join("")}</tbody></table></div>` : `<p class="suave trafego-vazio">Nenhum corredor fechado agora.</p>`}
                ${podeFechar ? `<form class="trafego-form" onsubmit="return false">
                    <label class="campo"><span>Trecho</span><select id="trafegoTrecho">${segs.filter(s => !lista.some(f => f.segmento === s.id)).map(s => `<option value="${esc(s.id)}">${esc(descreverSegmento(p, s))}</option>`).join("")}</select></label>
                    <label class="campo"><span>Motivo</span><input id="trafegoMotivo" maxlength="120" placeholder="Ex.: limpeza do piso"></label>
                    <label class="campo"><span>Reabre</span><select id="trafegoAte"><option value="0">quando alguém reabrir</option><option value="30">em 30 min</option><option value="60">em 1 h</option><option value="120">em 2 h</option><option value="240">em 4 h</option></select></label>
                    <button type="button" class="btn btn-perigo" data-trafego="fechar">Fechar o trecho</button>
                </form>` : ""}
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

    return { carregar, fechar, reabrir, ativos, impasses, impassesConfirmados, htmlImpasses, renderizar, resolver };
})();
