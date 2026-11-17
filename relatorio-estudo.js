/* ============================================================
   RELATÓRIO DO ESTUDO DE FROTA v3 (0.24.6)
   ============================================================
   Desenha o resultado de EstudoNegocio.estudar() em HTML, igual na tela
   (Estudos › Relatório), no PDF (imprimir do navegador) e no link do
   cliente (cliente.html?relatorio=...). Não depende de mais nada do site:
   o resultado já traz a planta resumida, os números e as origens.

   Cada número leva a origem: dado do cliente · simulação · estimado ·
   referência pública · premissa de mercado. O payback principal é o do
   cenário provável (0.24); o conservador fica ao lado como piso ("no
   mínimo") e o otimista como teto. Sem frota que cumpra as metas, o
   relatório não mostra payback: diz o que segura a operação.

   0.24.6: uma história em 6 partes (a resposta, hoje, a solução, o
   dinheiro, além do dinheiro, próximos passos) e um anexo técnico. O
   payback aparece só na resposta e no dinheiro; as origens ficam no anexo.
*/
(function (raiz, fabrica) {
    if (typeof module === "object" && module.exports) module.exports = fabrica();
    else raiz.RelatorioEstudo = fabrica();
})(typeof self !== "undefined" ? self : this, function () {
    const esc = t => String(t ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
    const fmt = (v, casas = 0) => (v == null || !Number.isFinite(v) ? "--" : v.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas }));
    const n1 = v => (v == null || !Number.isFinite(v) ? "--" : fmt(v, Math.abs(v) < 10 ? 1 : 0));
    const pct = v => (v == null || !Number.isFinite(v) ? "--" : `${Math.round(v * 100)}%`);
    function brl(v, curto = true) {
        if (v == null || !Number.isFinite(v)) return "--";
        if (Math.abs(v) < 0.005) return "R$ 0";
        const s = v < 0 ? "−" : "", a = Math.abs(v);
        if (curto && a >= 1e6) return `${s}R$ ${fmt(a / 1e6, a >= 1e7 ? 1 : 2)} mi`;
        if (curto && a >= 1e4) return `${s}R$ ${fmt(a / 1e3, 0)} mil`;
        return `${s}R$ ${fmt(a, a < 100 ? 2 : 0)}`;
    }
    const meses = v => (v == null || !Number.isFinite(v) ? "não se paga em 5 anos" : v < 1 ? "menos de 1 mês" : `${fmt(v, v < 10 ? 1 : 0)} meses`);
    const minTxt = v => (v == null || !Number.isFinite(v) ? "--" : `${n1(v)} min`);
    const ORIG = { cliente: "dado do cliente", diario: "diário de viagens", planilha: "planilha do cliente", simulacao: "simulação", estimado: "estimado", referencia: "referência pública", premissa: "premissa de mercado", tabela: "tabela E4M" };
    const tag = o => `<span class="rv-tag rv-o-${esc(o || "premissa")}">${esc(ORIG[o] || o || "premissa")}</span>`;
    const tabela = (cab, linhas, classe = "") => `<div class="rv-tabela-caixa"><table class="rv-tabela ${classe}"><thead><tr>${cab.map(c => `<th>${c}</th>`).join("")}</tr></thead><tbody>${linhas.map(l => `<tr>${l.map(c => `<td>${c}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
    const tile = (rot, val, sub, origem) => `<div class="rv-tile"><div class="rv-tile-rot">${esc(rot)}</div><div class="rv-tile-val">${val}</div>${sub ? `<div class="rv-tile-sub">${sub}</div>` : ""}${origem ? tag(origem) : ""}</div>`;
    const secao = (n, titulo, html, classe = "") => `<section class="rv-secao ${classe}"><h2><span class="rv-num">${n}</span>${esc(titulo)}</h2>${html}</section>`;
    const premissa = (R, k) => (R.premissas || []).find(p => p.chave === k) || {};
    const nomeModelo = id => ({ "atta-g-o": "Atta G-O", "atta-e-o-serie": "Atta E-O", "atta-r-o": "Atta R-O", "atta-t-o": "Atta T-O", "atta-e-o": "Atta E-O protótipo" }[id] || id);

    /* ---------------- gráficos ---------------- */
    function svgPlanta(pl) {
        if (!pl?.nos?.length) return "";
        const xs = pl.nos.map(n => n.x), ys = pl.nos.map(n => n.y);
        const W0 = Math.max(...xs) - Math.min(...xs), H0 = Math.max(...ys) - Math.min(...ys);
        const r = Math.max(W0, H0, 10) / 120;
        const fs = r * 2.9, larg = t => t.length * fs * 0.56;
        const curto = t => (t.length > 20 ? t.slice(0, 19) + "…" : t);
        // rótulos: em cima do ponto; se encostar em outro, embaixo; se ainda encostar, ao lado
        const vis = pl.nos.filter(n => n.tipo !== "REFERENCIA" && n.tipo !== "BERCO");
        const postos = [];
        const bate = (a) => postos.some(b => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1);
        const rot = new Map();
        vis.slice().sort((a, b) => b.y - a.y || a.x - b.x).forEach(n => {
            const t = curto(n.nome || n.id), w = larg(t);
            const opc = [[n.x, n.y + r * 2.2, "middle"], [n.x, n.y - r * 4.4, "middle"], [n.x + r * 2, n.y - r * 1, "start"], [n.x - r * 2, n.y - r * 1, "end"]];
            let esc1 = opc[0];
            for (const o of opc) {
                const x0 = o[2] === "middle" ? o[0] - w / 2 : o[2] === "start" ? o[0] : o[0] - w;
                const caixa = { x0, x1: x0 + w, y0: o[1], y1: o[1] + fs };
                if (!bate(caixa)) { esc1 = o; postos.push(caixa); break; }
                if (o === opc[opc.length - 1]) postos.push(caixa);
            }
            rot.set(n.id, { t, x: esc1[0], y: esc1[1], a: esc1[2], w });
        });
        const ext = [...rot.values()].flatMap(o => [o.a === "middle" ? o.x - o.w / 2 : o.a === "start" ? o.x : o.x - o.w, o.a === "middle" ? o.x + o.w / 2 : o.a === "start" ? o.x + o.w : o.x]);
        const x0 = Math.min(...xs, ...ext) - r * 2, x1 = Math.max(...xs, ...ext) + r * 2;
        const ysR = [...rot.values()].flatMap(o => [o.y, o.y + fs]);
        const y0 = Math.min(...ys, ...ysR) - r * 2, y1 = Math.max(...ys, ...ysR) + r * 2;
        const W = x1 - x0, H = y1 - y0, Y = y => y1 - y + y0;
        const por = new Map(pl.nos.map(n => [n.id, n]));
        const linhas = pl.segmentos.map(s => { const a = por.get(s.a), b = por.get(s.b); return a && b ? `<line x1="${a.x}" y1="${Y(a.y)}" x2="${b.x}" y2="${Y(b.y)}" class="${s.sentido === "DUPLO" ? "rv-ramal" : "rv-anel"}"/>` : ""; }).join("");
        const pontos = pl.nos.filter(n => n.tipo !== "REFERENCIA").map(n => {
            if (n.tipo === "BERCO") return `<rect x="${n.x - r}" y="${Y(n.y) - r}" width="${2 * r}" height="${2 * r}" class="rv-berco"><title>${esc(n.nome || n.id)}</title></rect>`;
            const o = rot.get(n.id);
            return `<g><title>${esc(n.nome || n.id)}</title><circle cx="${n.x}" cy="${Y(n.y)}" r="${r * 1.2}" class="rv-estacao"/><text x="${o.x}" y="${Y(o.y)}" font-size="${fs}" text-anchor="${o.a}" class="rv-rotulo">${esc(o.t)}</text></g>`;
        }).join("");
        return `<figure class="rv-planta"><svg viewBox="${x0} ${y0} ${W} ${H}" role="img" aria-label="Planta do estudo: corredor de mão única e ramais até as estações">${linhas}${pontos}</svg>
            <figcaption><span><i class="rv-l-anel"></i>corredor de mão única</span><span><i class="rv-l-ramal"></i>ramal de mão dupla</span><span><i class="rv-l-est"></i>estação</span><span><i class="rv-l-berco"></i>berço</span>${pl.semDesenho ? "<span>posições pelas distâncias informadas (sem desenho)</span>" : ""}</figcaption></figure>`;
    }
    function svgHoras(porHora) {
        if (!porHora?.length) return "";
        const w = 640, h = 190, m = { e: 30, d: 6, t: 10, b: 22 };
        const max = Math.max(1, ...porHora.map(x => Math.max(x.pedidos || 0, x.entregas || 0)));
        const passo = (w - m.e - m.d) / porHora.length, larg = Math.max(2, passo / 2 - 2);
        const y = v => m.t + (h - m.t - m.b) * (1 - v / max);
        const barras = porHora.map((x, i) => {
            const x0 = m.e + i * passo + 1;
            return `<g><title>${x.h % 24}h: ${Math.round(x.pedidos || 0)} pedidos, ${Math.round(x.entregas || 0)} entregas</title><rect x="${x0}" y="${y(x.pedidos || 0)}" width="${larg}" height="${h - m.b - y(x.pedidos || 0)}" rx="2" class="rv-b1"/><rect x="${x0 + larg + 2}" y="${y(x.entregas || 0)}" width="${larg}" height="${h - m.b - y(x.entregas || 0)}" rx="2" class="rv-b2"/><text x="${x0 + larg}" y="${h - 6}" text-anchor="middle" class="rv-eixo">${x.h % 24}h</text></g>`;
        }).join("");
        const grade = [0, 0.5, 1].map(f => `<line x1="${m.e}" x2="${w - m.d}" y1="${y(max * f)}" y2="${y(max * f)}" class="rv-grade"/><text x="${m.e - 4}" y="${y(max * f) + 4}" text-anchor="end" class="rv-eixo">${Math.round(max * f)}</text>`).join("");
        return `<figure class="rv-grafico"><svg viewBox="0 0 ${w} ${h}" role="img" aria-label="Pedidos e entregas por hora">${grade}${barras}</svg><figcaption><span><i class="rv-b1"></i>pedidos</span><span><i class="rv-b2"></i>entregas</span></figcaption></figure>`;
    }
    // caixa acumulada nos 60 meses (os três cenários, com rótulo na ponta)
    function svgCaixa(cen) {
        const series = [["provavel", "Provável", "rv-c1"], ["conservador", "Conservador", "rv-c2"], ["otimista", "Otimista", "rv-c3"]].filter(([k]) => cen[k]?.mensal);
        if (!series.length) return "";
        const acum = k => { let s = 0; return cen[k].mensal.map(x => (s += x)); };
        const dados = series.map(([k, n, c]) => [acum(k), n, c]);
        const todos = dados.flatMap(d => d[0]);
        const lo = Math.min(0, ...todos), hi = Math.max(0, ...todos);
        const w = 980, h = 300, m = { e: 74, d: 190, t: 14, b: 26 };
        const X = i => m.e + (w - m.e - m.d) * i / 60, Y = v => m.t + (h - m.t - m.b) * (hi - v) / Math.max(1, hi - lo);
        const linhas = dados.map(([v, n, c]) => `<polyline points="${v.map((x, i) => `${X(i).toFixed(1)},${Y(x).toFixed(1)}`).join(" ")}" class="rv-linha ${c}"/><text x="${X(60) + 6}" y="${Y(v[60]) + 4}" class="rv-eixo rv-fim">${n}: ${brl(v[60])}</text>`).join("");
        const anos = [0, 1, 2, 3, 4, 5].map(a => `<text x="${X(a * 12)}" y="${h - 8}" text-anchor="middle" class="rv-eixo">${a ? "ano " + a : "início"}</text>`).join("");
        const marcas = [lo, (lo + hi) / 2, hi].map(v => `<line x1="${m.e}" x2="${w - m.d}" y1="${Y(v)}" y2="${Y(v)}" class="rv-grade"/><text x="${m.e - 6}" y="${Y(v) + 4}" text-anchor="end" class="rv-eixo">${brl(v)}</text>`).join("");
        return `<figure class="rv-grafico"><svg viewBox="0 0 ${w} ${h}" role="img" aria-label="Caixa acumulado em 5 anos, comprando a frota">${marcas}<line x1="${m.e}" x2="${w - m.d}" y1="${Y(0)}" y2="${Y(0)}" class="rv-zero"/>${linhas}${anos}</svg><figcaption>Caixa acumulado comprando a frota: abaixo da linha do zero, o investimento ainda não voltou.</figcaption></figure>`;
    }
    function svgTornado(lista, base) {
        const itens = (lista || []).filter(s => s.paybackDe != null || s.paybackAte != null).slice(0, 7);
        if (!itens.length) return `<p class="rv-nota">Nenhuma premissa sozinha faz o investimento voltar em 5 anos no cenário provável.</p>`;
        const v = x => (x == null ? 60 : Math.min(60, x));
        const max = Math.max(...itens.flatMap(s => [v(s.paybackDe), v(s.paybackAte)]), v(base) || 0, 12);
        const w = 980, lh = 30, m = { e: 280, d: 120 }, h = itens.length * lh + 30;
        const X = x => m.e + (w - m.e - m.d) * x / max;
        const barras = itens.map((s, i) => {
            const a = v(s.paybackDe), b = v(s.paybackAte), y = 8 + i * lh;
            const lo = Math.min(a, b), hi = Math.max(a, b);
            return `<text x="${m.e - 8}" y="${y + 13}" text-anchor="end" class="rv-eixo rv-forte">${esc(s.nome)}</text><rect x="${X(lo)}" y="${y + 2}" width="${Math.max(2, X(hi) - X(lo))}" height="${lh - 10}" rx="4" class="rv-tor"/><text x="${X(hi) + 4}" y="${y + 13}" class="rv-eixo">${fmt(lo, 0)}–${hi >= 60 ? "60+" : fmt(hi, 0)} meses</text>`;
        }).join("");
        const linha = base != null ? `<line x1="${X(v(base))}" x2="${X(v(base))}" y1="2" y2="${h - 18}" class="rv-zero"/><text x="${X(v(base))}" y="${h - 4}" text-anchor="middle" class="rv-eixo">provável: ${fmt(base, 0)} meses</text>` : "";
        return `<figure class="rv-grafico"><svg viewBox="0 0 ${w} ${h}" role="img" aria-label="Quanto cada premissa mexe no payback">${barras}${linha}</svg><figcaption>Cada barra: o payback com a premissa no mínimo e no máximo da faixa, o resto igual.</figcaption></figure>`;
    }
    function barrasConfianca(conf) {
        return `<div class="rv-conf">${(conf || []).map(c => `<div class="rv-conf-linha"><span class="rv-conf-nome">${esc(c.secao)}</span><span class="rv-conf-barra" role="img" aria-label="${esc(c.secao)}: ${pct(c.cliente)} dado do cliente ou simulação, ${pct(c.estimado)} estimado, ${pct(c.premissa)} premissa"><i class="rv-cf1" style="width:${c.cliente * 100}%"></i><i class="rv-cf2" style="width:${c.estimado * 100}%"></i><i class="rv-cf3" style="width:${c.premissa * 100}%"></i></span><b>${pct(c.cliente)}</b></div>`).join("")}
            <div class="rv-legenda"><span><i class="rv-cf1"></i>dado do cliente ou simulação</span><span><i class="rv-cf2"></i>estimado ou referência pública</span><span><i class="rv-cf3"></i>premissa de mercado</span></div></div>`;
    }

    /* ---------------- texto do resumo (sem Mira) ---------------- */
    function motivoSemFrota(sf) {
        if (!sf) return "";
        const m = sf.melhor;
        return `${sf.motivo === "trafego" ? `Mais Atta não resolve: o tráfego trava antes${sf.gargalo ? ` (a zona que mais segura é ${sf.gargalo})` : ""}.` : "Nenhuma frota testada cumpre as metas de prazo e ocupação."}${m ? ` A melhor testada (${m.nome}) entrega ${pct(m.noPrazo)} no prazo.` : ""}`;
    }
    function resumo(R) {
        const rec = R.simulacao?.recomendado;
        const c = R.financeiro?.cenarios || {};
        const partes = [];
        if (rec) partes.push(`Para atender cerca de ${fmt(R.hoje?.entregasDia, 0)} entregas por dia (${R.fluxos.length} fluxos, ${R.operacao.turnos} turno${R.operacao.turnos > 1 ? "s" : ""}), a menor frota que cumpre as metas é ${rec.nome}: ${pct(rec.r?.noPrazo?.[1])} das entregas no prazo, ${minTxt(rec.r?.tempoMedio?.[1])} do pedido à entrega em média.`);
        else { partes.push(`${motivoSemFrota(R.semFrota) || "Nenhuma frota testada cumpre as metas de prazo e ocupação."} Sem uma frota que atenda, este estudo não calcula payback: veja as ações, o layout e os cenários da planta.`); return partes; }
        const co = c.conservador?.compra, pv = c.provavel?.compra, ot = c.otimista?.compra;
        if (pv) {
            if (pv.payback != null) partes.push(`No cenário provável, o investimento de ${brl(pv.investimento)} volta em ${meses(pv.payback)}${co?.payback != null ? `; no mínimo (conservador, só ganhos confirmados), em ${meses(co.payback)}` : "; no cenário conservador, só com os ganhos confirmados, não volta em 5 anos"}.`);
            else if (ot?.payback != null) partes.push(`No cenário provável, o investimento de ${brl(pv.investimento)} não volta em 5 anos. Contando todos os ganhos potenciais (paradas, erros, acidentes, estoque), volta em ${meses(ot.payback)}.`);
            else partes.push(`Com os números de hoje, o investimento de ${brl(pv.investimento)} não volta em 5 anos, nem contando os ganhos potenciais. Veja a fase 1, os cenários da planta e o que refinar.`);
        }
        if (R.fase1 && R.fase1.payback != null && (pv?.payback == null || R.fase1.payback < pv.payback - 2)) partes.push(`Começando só pelos fluxos que mais valem (fase 1: ${R.fase1.frota}), o investimento de ${brl(R.fase1.investimento)} volta em ${meses(R.fase1.payback)}.`);
        const melhorCen = melhorCenario(R);
        if (melhorCen && melhorCen.id !== "atual") partes.push(`Ajustando a planta (${melhorCen.nome.toLowerCase()}), a frota vira ${melhorCen.frota} e o payback, com a demanda de hoje, ${meses(melhorCen.payback)}${melhorCen.viavel === "sim" ? "" : " (a confirmar na visita)"}.`);
        const a = (R.acoes || [])[0];
        if (a && a.liquidoAno > 0) partes.push(`A ação que mais vale: ${a.nome.toLowerCase()} (${brl(a.liquidoAno)} por ano${a.evitaHoje ? `, ${a.evitaHoje} Atta a menos hoje` : a.evita3 ? `, ${a.evita3} Atta a menos no ano 3` : ""}).`);
        return partes;
    }

    // o cenário da planta que mais vale (os viáveis; os "a confirmar" entram como oportunidade)
    function melhorCenario(R) {
        const lista = (R.cenariosPlanta || []).filter(c => c.fecha !== false && c.payback != null && (R.viabilidade?.[c.id]?.v || c.viavel) !== "nao");
        const atual = lista.find(c => c.id === "atual");
        const melhor = lista.slice().sort((a, b) => a.payback - b.payback)[0];
        return melhor && atual && melhor.payback < atual.payback - 1 ? melhor : null;
    }
    function svgCurva(cv, fase1, total) {
        const pts = (cv?.pontos || []).filter(p => p.payback != null);
        if (pts.length < 2) return "";
        const w = 980, h = 260, m = { e: 64, d: 30, t: 18, b: 40 };
        const nMax = Math.max(...pts.map(p => p.n)), nMin = Math.min(...pts.map(p => p.n));
        const yMax = Math.min(60, Math.max(24, ...pts.map(p => p.payback)) * 1.1);
        const X = n => m.e + (w - m.e - m.d) * (nMax === nMin ? 0.5 : (n - nMin) / (nMax - nMin));
        const Y = v => m.t + (h - m.t - m.b) * (1 - Math.min(v, yMax) / yMax);
        const linha = pts.map(p => `${X(p.n).toFixed(1)},${Y(p.payback).toFixed(1)}`).join(" ");
        const marcas = pts.map(p => `<g><circle cx="${X(p.n)}" cy="${Y(p.payback)}" r="${p === cv.melhor ? 7 : 4.5}" class="rv-curva-ponto ${p === cv.melhor ? "melhor" : ""}"><title>${p.n} Atta, ${p.k} de ${total} fluxos: ${fmt(p.payback, 0)} meses</title></circle><text x="${X(p.n)}" y="${Y(p.payback) - 12}" text-anchor="middle" class="rv-eixo">${fmt(p.payback, 0)} m</text><text x="${X(p.n)}" y="${h - 22}" text-anchor="middle" class="rv-eixo">${p.n} Atta</text><text x="${X(p.n)}" y="${h - 8}" text-anchor="middle" class="rv-eixo rv-suave">${p.k}/${total} fluxos</text></g>`).join("");
        const ref = 24 <= yMax ? `<line x1="${m.e}" x2="${w - m.d}" y1="${Y(24)}" y2="${Y(24)}" class="rv-grade rv-ref"/><text x="${m.e - 6}" y="${Y(24) + 4}" text-anchor="end" class="rv-eixo">24 m</text>` : "";
        return `<figure class="rv-grafico"><svg viewBox="0 0 ${w} ${h}" role="img" aria-label="Payback por tamanho da frota, começando pelos fluxos que mais valem">${ref}<polyline points="${linha}" class="rv-linha rv-c1"/>${marcas}</svg><figcaption>Cada ponto: a frota que cobre os fluxos que mais valem até ali e o payback dela, com a demanda de hoje (${esc(cv.nota || "")}).${fase1 ? ` O maior: a fase 1.` : ""}</figcaption></figure>`;
    }

    /* ---------------- peças visuais da v3 (0.24.6) ---------------- */
    const PAL = { pessoas: "#1E63C7", empilhadeiras: "#5B8FD9", horasExtras: "#A9C6EE", turnoNovo: "#2C4F86",
        paradas: "#C2410C", erros: "#E07B39", avarias: "#F0A35E", acidentes: "#8A2F0A", estoque: "#F6C99A" };
    // barra empilhada com legenda (valores em R$)
    function barraEmpilhada(itens, total, rotulo) {
        const lista = itens.filter(x => x && x.v > 0);
        const soma = total || lista.reduce((s, x) => s + x.v, 0);
        if (!soma) return "";
        return `<figure class="rv3-barra" role="img" aria-label="${esc(rotulo || "")}: ${lista.map(x => `${esc(x.nome)} ${brl(x.v)}`).join(", ")}">
            <div class="rv3-barra-trilho">${lista.map(x => `<i style="width:${Math.max(0.6, x.v / soma * 100)}%;background:${x.cor}${x.leve ? ";opacity:.55" : ""}" title="${esc(x.nome)}: ${brl(x.v)}"></i>`).join("")}</div>
            <figcaption>${lista.map(x => `<span><i style="background:${x.cor}${x.leve ? ";opacity:.55" : ""}"></i>${esc(x.nome)} <b>${brl(x.v)}</b>${x.sub ? ` <em>${x.sub}</em>` : ""}</span>`).join("")}</figcaption></figure>`;
    }
    // a régua do payback: otimista, provável e conservador numa linha de 0 a 5 anos
    function svgRegua(C) {
        const pv = C.provavel?.compra?.payback, co = C.conservador?.compra?.payback, ot = C.otimista?.compra?.payback;
        if (pv == null && ot == null) return "";
        const w = 860, h = 112, m = { e: 24, d: 150 }, fim = 60;
        const X = v => m.e + (w - m.e - m.d) * Math.min(v, fim) / fim;
        const Xf = v => (v == null ? w - m.d / 2 : X(v));
        const y = 58;
        const marcas = [0, 12, 24, 36, 48, 60].map(t => `<line x1="${X(t)}" x2="${X(t)}" y1="${y - 6}" y2="${y + 6}" class="rv3-tick"/><text x="${X(t)}" y="${y + 24}" text-anchor="middle" class="rv-eixo">${t === 0 ? "hoje" : t / 12 + (t === 12 ? " ano" : " anos")}</text>`).join("");
        const lo = Math.min(Xf(ot), Xf(pv), Xf(co)), hi = Math.max(Xf(ot), Xf(pv), Xf(co));
        const ponto = (v, nome, classe, cima) => {
            const x = Xf(v), txt = v == null ? "não volta em 5 anos" : meses(v);
            return `<g class="${classe}"><circle cx="${x}" cy="${y}" r="${classe === "rv3-pv" ? 11 : 7}"/>
                <text x="${x}" y="${cima ? y - 22 : y + 44}" text-anchor="middle" class="rv3-r-nome">${nome}</text>
                <text x="${x}" y="${cima ? y - 38 : y + 60}" text-anchor="middle" class="rv3-r-val">${txt}</text></g>`;
        };
        return `<figure class="rv3-regua"><svg viewBox="0 0 ${w} ${h + 26}" role="img" aria-label="Payback: provável ${meses(pv)}; no mínimo (conservador) ${co != null ? meses(co) : "não volta em 5 anos"}; otimista ${meses(ot)}">
            <line x1="${m.e}" x2="${w - m.d}" y1="${y}" y2="${y}" class="rv3-eixo"/>
            <line x1="${w - m.d}" x2="${w - 8}" y1="${y}" y2="${y}" class="rv3-eixo rv3-tracejado"/><text x="${w - m.d / 2}" y="${y - 12}" text-anchor="middle" class="rv-eixo">depois de 5 anos</text>
            <rect x="${lo}" y="${y - 5}" width="${Math.max(2, hi - lo)}" height="10" rx="5" class="rv3-faixa"/>
            ${marcas}
            ${ot != null ? ponto(ot, "otimista", "rv3-ot", false) : ""}${ponto(co, "no mínimo", "rv3-co", false)}${ponto(pv, "provável", "rv3-pv", true)}
        </svg></figure>`;
    }
    // caixa acumulado em 5 anos, com o mês em que cada cenário volta ao zero
    function svgCaixa3(cen) {
        const series = [["conservador", "No mínimo (conservador)", "rv3-c2"], ["provavel", "Provável", "rv3-c1"], ["otimista", "Otimista", "rv3-c3"]].filter(([k]) => cen[k]?.mensal);
        if (!series.length) return "";
        const acum = k => { let s = 0; return cen[k].mensal.map(x => (s += x)); };
        const dados = series.map(([k, n, c]) => [acum(k), n, c, cen[k].compra?.payback]);
        const todos = dados.flatMap(d => d[0]);
        const lo = Math.min(0, ...todos), hi = Math.max(0, ...todos);
        const w = 900, h = 300, m = { e: 70, d: 168, t: 16, b: 28 };
        const X = i => m.e + (w - m.e - m.d) * i / 60, Y = v => m.t + (h - m.t - m.b) * (hi - v) / Math.max(1, hi - lo);
        const area = (() => { const v = dados.find(d => d[2] === "rv3-c1")?.[0]; if (!v) return ""; return `<path d="M${X(0)},${Y(0)} ${v.map((x, i) => `L${X(i).toFixed(1)},${Y(x).toFixed(1)}`).join(" ")} L${X(60)},${Y(0)} Z" class="rv3-area"/>`; })();
        // os rótulos da ponta não se encostam
        const fins = dados.map(d => ({ y: Y(d[0][60]) + 4, d })).sort((a, b) => a.y - b.y);
        for (let i = 1; i < fins.length; i++) if (fins[i].y - fins[i - 1].y < 15) fins[i].y = fins[i - 1].y + 15;
        const linhas = dados.map(([v, n, c, pb]) => `<polyline points="${v.map((x, i) => `${X(i).toFixed(1)},${Y(x).toFixed(1)}`).join(" ")}" class="rv-linha ${c}"/>${pb != null && pb <= 60 ? `<circle cx="${X(pb)}" cy="${Y(0)}" r="5" class="rv3-zero-pt ${c}"/>` : ""}`).join("")
            + fins.map(f => `<text x="${X(60) + 8}" y="${f.y}" class="rv-eixo rv-fim ${f.d[2]}-t">${f.d[1].replace(" (conservador)", "")}: ${brl(f.d[0][60])}</text>`).join("");
        const anos = [0, 1, 2, 3, 4, 5].map(a => `<text x="${X(a * 12)}" y="${h - 8}" text-anchor="middle" class="rv-eixo">${a ? "ano " + a : "início"}</text>`).join("");
        const marcas = [lo, hi].map(v => `<line x1="${m.e}" x2="${w - m.d}" y1="${Y(v)}" y2="${Y(v)}" class="rv-grade"/><text x="${m.e - 6}" y="${Y(v) + 4}" text-anchor="end" class="rv-eixo">${brl(v)}</text>`).join("") + `<text x="${m.e - 6}" y="${Y(0) + 4}" text-anchor="end" class="rv-eixo rv-forte">R$ 0</text>`;
        // depois do payback, um mês negativo no provável = compra de mais Atta para o crescimento
        const mp = cen.provavel?.mensal || [], pbP = cen.provavel?.compra?.payback;
        const iCompra = pbP != null ? mp.findIndex((x, i) => i > pbP + 1 && x < 0) : -1;
        const vP = dados.find(d => d[2] === "rv3-c1")?.[0];
        const yN = iCompra > 0 && vP ? Y(Math.max(vP[iCompra - 1], vP[iCompra])) : 0;
        const nota = iCompra > 0 && vP ? `<line x1="${X(iCompra)}" x2="${X(iCompra)}" y1="${yN - 6}" y2="${yN - 26}" class="rv3-nota-l"/><text x="${X(iCompra)}" y="${yN - 31}" text-anchor="middle" class="rv-eixo">mais Atta para o crescimento</text>` : "";
        return `<figure class="rv-grafico rv3-caixa"><svg viewBox="0 0 ${w} ${h}" role="img" aria-label="Caixa acumulado em 5 anos, comprando a frota">${marcas}${area}<line x1="${m.e}" x2="${w - m.d}" y1="${Y(0)}" y2="${Y(0)}" class="rv-zero"/>${linhas}${nota}${anos}</svg>
            <figcaption>O dinheiro acumulado desde a compra. Abaixo da linha do zero, o investimento ainda não voltou; o ponto marca o mês em que volta.</figcaption></figure>`;
    }
    // a implantação numa linha do tempo, com a economia subindo
    function linhaTempo(fases) {
        if (!fases?.length) return "";
        return `<ol class="rv3-tempo">${fases.map((f, i) => `<li class="${f.economia ? "ganha" : ""}"><span class="rv3-tempo-bola">${i + 1}</span><b>${esc(f.fase)}</b><em>${esc(f.quando)}</em><span>${esc(f.oque)}</span>${f.economia ? `<strong>${pct(f.economia)} da economia</strong>` : `<strong class="zero">preparação</strong>`}</li>`).join("")}</ol>`;
    }
    // antes e depois em duas barras
    function antesDepois(rot, antes, depois, un, sub) {
        if (antes == null || depois == null || !(antes > 0)) return "";
        const fx = v => (un === "R$" ? brl(v, false) : `${n1(v)} ${un}`);
        return `<div class="rv3-ad"><div class="rv3-ad-rot">${esc(rot)}</div>
            <div class="rv3-ad-linha"><span>hoje</span><i style="width:100%" class="antes"></i><b>${fx(antes)}</b></div>
            <div class="rv3-ad-linha"><span>com a E4M</span><i style="width:${Math.max(2, depois / antes * 100)}%" class="depois"></i><b>${fx(depois)}</b></div>
            ${sub ? `<p>${sub}</p>` : ""}</div>`;
    }
    // "2 Atta T-O + 3 Atta E-O" → { "Atta T-O": 2, "Atta E-O": 3 }
    const lerFrota = nome => { const m = {}; String(nome || "").split(" + ").forEach(t => { const x = /^(\d+)\s+(.+)$/.exec(t.trim()); if (x) m[x[2]] = (m[x[2]] || 0) + Number(x[1]); }); return m; };
    // o que falta comprar além da frota recomendada ("+1 Atta E-O"), ou null se é a mesma
    function aMais(nomeBase, nomeNova) {
        const a = lerFrota(nomeBase), b = lerFrota(nomeNova);
        const mais = Object.keys(b).filter(k => b[k] > (a[k] || 0)).map(k => `+${b[k] - (a[k] || 0)} ${k}`);
        const menos = Object.keys(a).filter(k => (b[k] || 0) < a[k]).map(k => `−${a[k] - (b[k] || 0)} ${k}`);
        return mais.length || menos.length ? mais.concat(menos).join(" ") : null;
    }
    const pct1 = v => (v == null || !Number.isFinite(v) ? "--" : `${(Math.round(v * 1000) / 10).toLocaleString("pt-BR")}%`);
    // de onde vem o valor por ano de uma ação (a mesma conta do estudo)
    function contaAcao(a, R) {
        const custo5 = a.custo ? ` − ${brl(a.custo)} de custo ÷ 5 anos (${brl(a.custo / 5)})` : "";
        if (a.nIO || (a.potencial && a.tipo === "segurança")) {
            const ac = premissa(R, "acidentesAno").v, ca = premissa(R, "custoAcidente").v;
            return a.ganhoAno > 0 && ac && ca ? `${fmt(ac, Number.isInteger(ac) ? 0 : 1)} acidente${ac === 1 ? "" : "s"} por ano × 30% evitados × ${brl(ca, false)} cada = ${brl(a.ganhoAno)}${custo5}.` : `Segurança: não muda a frota${custo5}.`;
        }
        const f = Math.max(a.evitaHoje || 0, (a.evita3 || 0) * 0.6);
        if (!(f > 0) || !(a.ganhoAno > 0)) return `Não muda a frota${a.custo ? `: o custo (${brl(a.custo)}) não volta em Atta evitado` : ""}.`;
        const va = a.ganhoAno / f;
        return (a.evitaHoje || 0) >= (a.evita3 || 0) * 0.6
            ? `${a.evitaHoje} Atta a menos já hoje × ${brl(va)} por ano (o que um Atta custa por ano: compra e implantação em 5 anos, Eciton e manutenção)${custo5}.`
            : `${a.evita3} Atta a menos a partir do ano 3 × ${brl(va)} por ano (o que um Atta custa por ano: compra e implantação em 5 anos, Eciton e manutenção) × 60% (vale nos anos 3 a 5)${custo5}.`;
    }
    const cartao = (rot, val, sub, classe = "") => `<div class="rv3-cartao ${classe}"><span>${esc(rot)}</span><b>${val}</b>${sub ? `<em>${sub}</em>` : ""}</div>`;
    const parte = (n, titulo, frase, corpo, classe = "") => `<section class="rv-secao rv3-parte ${classe}"><h2><span class="rv-num">${n}</span>${esc(titulo)}</h2>${frase ? `<p class="rv3-frase">${frase}</p>` : ""}${corpo}</section>`;
    const anexo = (l, titulo, corpo) => `<section class="rv-secao rv3-anexo-sec"><h2><span class="rv-num rv-num-anexo">${l}</span>${esc(titulo)}</h2>${corpo}</section>`;
    const nomeFluxo = nome => { const [rota, ...resto] = String(nome || "").split(" · "); return `<b>${esc(rota)}</b>${resto.length ? `<small>${esc(resto.join(" · "))}</small>` : ""}`; };
    const chipModelo = id => `<span class="rv3-chip rv3-m-${esc(String(id).split("-")[1] || "x")}">${esc(nomeModelo(id))}</span>`;
    const pessoasTxt = v => `${v != null && Math.abs(v - Math.round(v)) < 0.05 ? fmt(Math.round(v)) : n1(v)} pessoa${v != null && Math.abs(v - 1) < 0.05 ? "" : "s"}`;

    /* ---------------- o relatório (0.24.6: a resposta, 5 partes e o anexo) ---------------- */
    function html(R, opcoes = {}) {
        if (!R) return "";
        const cli = R.cliente || {};
        const rec = R.simulacao?.recomendado;
        const r = rec?.r;
        const H = R.hoje || {};
        const F = R.financeiro || {};
        const C = F.cenarios || {};
        const Mt = R.metricas || {};
        const Hh = R.horas || {};
        const turnos = R.operacao?.turnos || 1;
        const data = new Date(R.em || Date.now()).toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" });
        const pP = k => premissa(R, k);
        const semF = R.semFrota;
        const co = C.conservador?.compra, pv = C.provavel?.compra, ot = C.otimista?.compra;
        const ep = C.provavel?.economiaAno1;
        const partes = [];

        // ---------- capa ----------
        partes.push(`<header class="rv-capa">
            ${opcoes.marca !== false ? `<img src="${esc(opcoes.marca || "img/e4m-marca-claro.webp")}" alt="E4M" width="130" height="41" class="rv-marca">` : ""}
            <div><div class="rv-sobre">Estudo de frota</div><h1>${esc(cli.nome || "Cliente")}</h1>
            <p>${[cli.setor, cli.cidade].filter(Boolean).map(esc).join(" · ")}${cli.setor || cli.cidade ? " · " : ""}${esc(data)} · E4M Engineering for Motion</p></div>
        </header>
        ${opcoes.exemplo ? `<p class="rv-exemplo">EXEMPLO · empresa, planta e números fictícios</p>` : ""}
        ${R.desatualizado ? `<p class="rv-exemplo">O estudo mudou depois deste relatório.</p>` : ""}`);

        // ---------- 1. a resposta ----------
        const liberadasTot = ep ? ep.liberadas * turnos : null;
        const destinoTxt = Hh.destino === "realocar" ? "realocadas para outras tarefas" : Hh.destino === "evitar" ? "contratações que deixam de ser feitas" : "liberadas";
        const hw = pv ? pv.investimento / (1 + (R.precos?.implantacaoPct || 0)) : null;
        const mensal = hw && R.precos?.locacaoPctMes ? hw * R.precos.locacaoPctMes : null;
        if (semF) {
            partes.push(parte(1, "A resposta", `Nenhuma frota testada cumpre as metas de prazo da operação, então este estudo <b>não calcula payback</b>: primeiro é preciso destravar a operação.`,
                `<div class="rv3-alerta"><b>O estudo ficou sem frota que atenda.</b> ${esc(motivoSemFrota(semF))} As ações da parte 6 e os cenários da planta (anexo) mostram o que segura a operação.</div>`, "rv3-resposta"));
        } else {
            const frase = pv?.payback != null
                ? `Com <b>${esc(rec?.nome || "a frota recomendada")}</b>, o investimento de <b>${brl(pv.investimento)}</b> volta em <b class="rv3-dest">${meses(pv.payback)}</b> no cenário provável.`
                : ot?.payback != null ? `Com <b>${esc(rec?.nome || "a frota recomendada")}</b>, o investimento de <b>${brl(pv?.investimento)}</b> não volta em 5 anos no cenário provável; contando todos os ganhos potenciais, volta em <b class="rv3-dest">${meses(ot.payback)}</b>.`
                    : `Com os números de hoje, o investimento de <b>${brl(pv?.investimento)}</b> não volta em 5 anos, nem contando os ganhos potenciais.`;
            const porque = [
                r ? `<b>${pct(r.noPrazo[1])}</b> das entregas no prazo, ${minTxt(r.tempoMedio[1])} do pedido à entrega em média` : "",
                ep && liberadasTot ? `A frota assume o trabalho de <b>${pessoasTxt(liberadasTot)}</b>${turnos > 1 ? ` (${fmt(ep.liberadas)} por turno)` : ""}, ${destinoTxt}${ep.empL ? `, e devolve <b>${fmt(ep.empL)} empilhadeira${ep.empL > 1 ? "s" : ""}</b>` : ""}` : "",
                R.capacidade != null ? `Aguenta até <b>+${pct(R.capacidade)}</b> de demanda sem um Atta a mais` : "",
                mensal ? `Ou sem comprar: entrada de <b>${brl(C.provavel.locacao.investimento)}</b> e cerca de <b>${brl(mensal)}</b> por mês` : ""].filter(Boolean);
            partes.push(parte(1, "A resposta", frase, `
                <div class="rv3-tres">
                    ${cartao("Hoje, mover material custa", `${brl(H.custoTransporteAno)}<small>/ano</small>`, `${brl(H.custoEntrega, false)} por entrega`)}
                    ${cartao("Investimento (compra)", brl(pv?.investimento), `${esc(rec?.nome || "")}, com implantação`)}
                    ${cartao("Payback provável", meses(pv?.payback), `no mínimo (conservador): ${co?.payback != null ? meses(co.payback) : "não volta em 5 anos"}`, pv?.payback != null ? "ok" : "falta")}
                </div>
                ${svgRegua(C)}
                <p class="rv3-legenda-regua"><b>Provável</b>: os ganhos que já são certos e as perdas que a operação informou. <b>No mínimo</b>: só os ganhos certos, com as premissas do lado ruim. <b>Otimista</b>: todos os ganhos possíveis.</p>
                <ul class="rv3-porque">${porque.map(t => `<li>${t}</li>`).join("")}</ul>
                ${R.resumoMira ? `<div class="rv3-mira"><div class="rv-texto">${esc(R.resumoMira)}</div><p class="rv-nota">Análise escrita pela Mira Pro a partir dos números deste relatório.</p></div>` : ""}`, "rv3-resposta"));
        }

        // ---------- 2. hoje ----------
        const cp = R.custoPessoa?.v || pP("custoPessoa").v || 0;
        const pesAno = (H.pessoas || 0) * cp * 12 * (H.fracaoPe ?? 1);
        const empAno = (H.empilhadeiras || 0) * (pP("custoEmpilhadeira").v || 0) * 12 * (H.fracaoEmp ?? 1);
        const extraAno = Math.max(0, (H.custoTransporteAno || 0) - pesAno - empAno);
        const perdas = [
            { nome: "Linha parada por falta de material", v: H.paradasAno, cor: PAL.paradas, sub: H.paradasMinMes ? `${fmt(H.paradasMinMes, 0)} min/mês` : "" },
            { nome: "Entregas erradas", v: H.errosAno, cor: PAL.erros },
            { nome: "Avarias", v: H.avariasAno, cor: PAL.avarias },
            { nome: "Acidentes", v: H.acidentesCustoAno, cor: PAL.acidentes, sub: H.acidentesAno ? `${fmt(H.acidentesAno)}/ano` : "" }];
        const totPerdas = perdas.reduce((s, x) => s + (x.v || 0), 0);
        partes.push(parte(2, "Hoje", `Mover material custa <b>${brl(H.custoTransporteAno)} por ano</b>, ${brl(H.custoEntrega, false)} por entrega${totPerdas ? `, e o transporte ainda causa <b>${brl(totPerdas)} por ano</b> em perdas` : ""}.`, `
            <div class="rv3-mini">
                ${cartao("No transporte", `${n1(H.pessoasTurno)} <small>pessoas por turno</small>`, `${fmt(turnos)} turno${turnos > 1 ? "s" : ""}${H.empilhadeiras ? ` · ${fmt(H.empilhadeiras)} empilhadeira${H.empilhadeiras > 1 ? "s" : ""}` : ""}`)}
                ${cartao("Entregas por dia", fmt(H.entregasDia, 0), `${(R.fluxos || []).length} fluxos`)}
                ${cartao("Andando por dia", `${n1(H.kmDia)} <small>km</small>`, `${n1(H.tonDia)} t empurradas`)}
            </div>
            <h3>Para onde vai o custo do transporte</h3>
            ${barraEmpilhada([{ nome: "Pessoas", v: pesAno, cor: PAL.pessoas }, { nome: "Empilhadeiras e rebocadores", v: empAno, cor: PAL.empilhadeiras }, { nome: "Horas extras", v: extraAno, cor: PAL.horasExtras }], H.custoTransporteAno, "Custo do transporte por ano")}
            ${totPerdas ? `<h3>As perdas que o transporte causa</h3>${barraEmpilhada(perdas, totPerdas, "Perdas por ano")}` : ""}`));

        // ---------- 3. a solução ----------
        const fc = R.forecast || [];
        const ano3 = fc.find(x => x.ano === 3) || fc[fc.length - 1];
        const precisaAno = fc.find(x => x.ano > 0 && x.so?.total > (rec?.total || 0));
        const cresc = fc.length && rec ? `Com a demanda crescendo ${pct(pP("crescimento").v)} por ano, ${precisaAno ? `${precisaAno.ano > 1 ? `a mesma frota dá conta até o ano ${precisaAno.ano - 1}; no ano ${precisaAno.ano}` : "já no ano 1"} precisa de ${precisaAno.plano?.total && precisaAno.plano.total < precisaAno.so.total ? `${precisaAno.plano.total} Atta com o plano de ações (ou ${precisaAno.so.total} só comprando)` : `${precisaAno.so.total} Atta`}.` : `a mesma frota dá conta até o ano ${ano3?.ano || 3}.`}` : "";
        partes.push(parte(3, "A solução", rec ? `<b>${esc(rec.nome)}</b> fazem os ${(R.fluxos || []).length} fluxos e cumprem <b>${pct(r?.noPrazo?.[1])}</b> das entregas no prazo.` : `Nenhuma frota testada fecha a operação. ${esc(motivoSemFrota(semF))}`, `
            <div class="rv3-solucao">
                ${svgPlanta(R.planta)}
                ${r ? `<div class="rv3-col">
                    ${cartao("Entregas no prazo", pct(r.noPrazo[1]), `num dia ruim: ${pct(r.noPrazo[0])}`, "ok")}
                    ${cartao("Do pedido à entrega", minTxt(r.tempoMedio[1]), `90% em até ${minTxt(r.tempoP90[1])}`)}
                    ${cartao("Ocupação de cada Atta", pct(r.ocupacao[1]), "a folga fica para o imprevisto")}
                </div>` : ""}
            </div>
            <h3>Os fluxos</h3>
            ${tabela(["Fluxo", "Atta", "Viagens por dia", "Prazo"], (R.fluxos || []).map(f => [nomeFluxo(f.nome), chipModelo(f.modelo), fmt(f.viagensDia, 0), `${fmt(f.prazoMin)} min`]), "rv3-fluxos")}
            ${R.simulacao?.porHora?.length ? `<h3>Pedidos e entregas ao longo do dia</h3>${svgHoras(R.simulacao.porHora)}` : ""}
            ${cresc ? `<p class="rv3-obs">${esc(cresc)}</p>` : ""}`));

        // ---------- 4. o dinheiro ----------
        if (semF) {
            partes.push(parte(4, "O dinheiro", "", `<div class="rv3-alerta"><b>Sem frota que cumpra as metas, o estudo não calcula o dinheiro.</b> ${esc(motivoSemFrota(semF))} Resolva o que segura a operação (parte 6 e anexo) e rode de novo.</div>`));
        } else {
            const cenTxt = { conservador: ["No mínimo", "conservador: só os ganhos certos, com a demanda de hoje"], provavel: ["Provável", "os ganhos certos e as perdas informadas, com o crescimento"], otimista: ["Otimista", "todos os ganhos possíveis, com o crescimento"] };
            const cartaoCen = k => C[k] ? `<div class="rv3-cen ${k === "provavel" ? "principal" : ""}"><span class="rv3-cen-nome">${cenTxt[k][0]}</span><em>${cenTxt[k][1]}</em>
                <b class="${C[k].compra.payback == null ? "longo" : ""}">${meses(C[k].compra.payback)}</b><small>de payback</small>
                <dl><dt>Ganho por ano</dt><dd>${brl(C[k].economiaAno1.total)}</dd><dt>Caixa em 5 anos</dt><dd>${brl(C[k].compra.acumulado)}</dd><dt>VPL · TIR</dt><dd>${brl(C[k].compra.vpl)} · ${C[k].compra.tir != null ? pct(C[k].compra.tir) : "--"}</dd></dl></div>` : "";
            const nomePessoas = Hh.destino === "realocar" ? `Pessoas realocadas (${pct(Hh.valorRealocacao)} do custo)` : Hh.destino === "evitar" ? "Contratações evitadas" : "Pessoas liberadas";
            const ganhos = ep ? [
                { nome: nomePessoas + (ep.porPosto ? " · por posto" : ""), v: ep.conf.pessoas, cor: PAL.pessoas, sub: liberadasTot ? `${pessoasTxt(liberadasTot)}` : "" },
                { nome: "Empilhadeiras devolvidas", v: ep.conf.empilhadeiras, cor: PAL.empilhadeiras, sub: ep.empL ? fmt(ep.empL) : "" },
                { nome: "Horas extras", v: ep.conf.horasExtras, cor: PAL.horasExtras },
                { nome: "Turno novo sem contratar", v: ep.conf.turnoNovo, cor: PAL.turnoNovo },
                { nome: "Paradas evitadas", v: ep.pot?.paradas, cor: PAL.paradas, leve: true },
                { nome: "Erros evitados", v: ep.pot?.erros, cor: PAL.erros, leve: true },
                { nome: "Avarias evitadas", v: ep.pot?.avarias, cor: PAL.avarias, leve: true },
                { nome: "Acidentes evitados", v: ep.pot?.acidentes, cor: PAL.acidentes, leve: true }] : [];
            const sens = (R.sensibilidade || []).filter(s => s.paybackDe != null && s.paybackAte != null).map(s => ({ s, d: Math.abs(s.paybackAte - s.paybackDe) })).sort((a, b) => b.d - a.d);
            const sensTxt = sens.length ? `A premissa que mais mexe no payback é <b>${esc((t => t.charAt(0).toLowerCase() + t.slice(1))(sens[0].s.nome.replace(/\s*\(.*\)$/, "")))}</b>: de ${fmt(Math.min(sens[0].s.paybackDe, sens[0].s.paybackAte), 0)} a ${fmt(Math.max(sens[0].s.paybackDe, sens[0].s.paybackAte), 0)} meses.${sens[1] ? ` Nenhuma outra muda mais que ${fmt(Math.max(1, sens[1].d), 0)} ${Math.round(sens[1].d) === 1 ? "mês" : "meses"}.` : ""}` : "";
            const cmp = F.comparacao || {};
            const maxCmp = Math.max(cmp.naoFazer || 0, cmp.comE4M || 0);
            partes.push(parte(4, "O dinheiro", pv?.payback != null ? `No cenário provável, o investimento volta em <b>${meses(pv.payback)}</b> e deixa <b>${brl(pv.acumulado)}</b> em caixa em 5 anos.` : `No cenário provável, o investimento não volta em 5 anos${ot?.payback != null ? `; no otimista, volta em ${meses(ot.payback)}` : ""}.`, `
                <div class="rv3-cens">${["conservador", "provavel", "otimista"].map(cartaoCen).join("")}</div>
                ${svgCaixa3(C)}
                ${ganhos.some(g => g.v > 0) ? `<h3>De onde vem o ganho (provável, por ano)</h3>
                    ${barraEmpilhada(ganhos, ep.total, "Ganho por ano no cenário provável")}
                    <p class="rv3-obs">As cores fortes são ganhos certos; as claras, perdas que o transporte deixa de causar.${ep.porPosto ? ` Por posto: quem faz só transporte (${Hh.rotasMilkRun ? `o motorista de cada rota de milk run${Hh.dedicadas?.origem === "cliente" ? " e os dedicados que vocês informaram" : ""}` : "os dedicados que vocês informaram"}) sai inteiro quando a frota assume o trabalho dele.` : ""}${F.destinos && Hh.destino !== "desligar" && F.destinos.desligar != null ? (Hh.destino === "realocar" ? ` Se as pessoas forem desligadas em vez de realocadas, o payback provável cai para ${meses(F.destinos.desligar)}.` : "") : ""}</p>` : ""}
                <div>
                    <div><h3>Comprar ou pagar por mês</h3><div class="rv3-opcoes">
                        <div class="rv3-opcao"><span>Comprar</span><b>${brl(pv?.investimento)}</b><em>à vista, com a implantação</em><dl><dt>Payback</dt><dd>${meses(pv?.payback)}</dd><dt>Caixa em 5 anos</dt><dd>${brl(pv?.acumulado)}</dd></dl></div>
                        <div class="rv3-opcao"><span>Pagar por mês</span><b>${brl(C.provavel?.locacao?.investimento)}</b><em>de entrada${mensal ? ` + ${brl(mensal)} por mês, ${fmt(R.precos?.locacaoMeses)} meses` : ""}</em><dl><dt>Payback</dt><dd>${meses(C.provavel?.locacao?.payback)}</dd><dt>Caixa em 5 anos</dt><dd>${brl(C.provavel?.locacao?.acumulado)}</dd></dl></div>
                    </div></div>
                    ${maxCmp ? `<div><h3>O custo da logística em 5 anos</h3><div class="rv3-cmp">
                        <div><span>Sem fazer nada</span><i style="width:${(cmp.naoFazer || 0) / maxCmp * 100}%" class="antes"></i><b>${brl(cmp.naoFazer)}</b></div>
                        <div><span>Com a E4M</span><i style="width:${(cmp.comE4M || 0) / maxCmp * 100}%" class="depois"></i><b>${brl(cmp.comE4M)}</b></div></div>
                        ${cmp.naoFazer && cmp.comE4M ? `<p class="rv3-obs"><b>${brl(cmp.naoFazer - cmp.comE4M)}</b> a menos em 5 anos, contando o investimento, o Eciton, a energia e a manutenção.</p>` : ""}</div>` : ""}
                </div>
                ${sensTxt ? `<p class="rv3-obs">${sensTxt} O detalhe está no anexo.</p>` : ""}
                <p class="rv-nota">Investimento: Atta pela tabela de preços (${Object.entries(R.precos?.atta || {}).map(([k, v]) => `${nomeModelo(k)} ${brl(v)}`).join(", ")}), implantação ${pct(R.precos?.implantacaoPct)} do hardware. Por mês: ${esc(R.nomePlano || "Eciton")}${R.planoInfo ? ` (${esc(R.planoInfo.textoMira)}${R.planoInfo.inclui ? `: ${esc(R.planoInfo.inclui)}` : ""}) ${R.planoInfo.fixoMes ? `${brl(R.planoInfo.fixoMes, false)} pela fábrica + ` : ""}${brl(R.planoInfo.porAttaMes, false)} por Atta` : ` ${brl(R.precos?.eciton?.[R.plano], false)} por Atta`}, energia; manutenção ${pct(R.precos?.manutencaoPct)} do hardware por ano a partir do 2º ano. A economia entra aos poucos: piloto no 2º mês (25%), metade da frota no 3º (60%), tudo do 4º em diante.</p>`));
        }

        // ---------- 5. além do dinheiro ----------
        const Mk = Mt.kmDia || {}, Mtn = Mt.tonDia || {}, Mc = Mt.custoEntrega || {}, Mp = Mt.paradas || {}, Me = Mt.espaco || {}, Men = Mt.energia || {};
        partes.push(parte(5, "Além do dinheiro", `As pessoas deixam de andar <b>${n1((Mk.hoje || 0) - (Mk.e4m || 0))} km</b> e de empurrar <b>${n1((Mtn.hoje || 0) - (Mtn.e4m || 0))} t</b> por dia, e cada entrega fica registrada.`, `
            <div class="rv3-ads">
                ${antesDepois("Andando por dia", Mk.hoje, Mk.e4m, "km", "as pessoas param de empurrar carrinho")}
                ${antesDepois("Empurrando por dia", Mtn.hoje, Mtn.e4m, "t", `hoje, ${n1(Mtn.porPessoa)} t por pessoa`)}
                ${antesDepois("Custo por entrega", Mc.hoje, Mc.e4m, "R$", "o transporte inteiro dividido pelas entregas")}
            </div>
            <div class="rv3-mini">
                ${cartao("Rastreabilidade", "100%", `${fmt(Mt.rastreabilidade?.entregasAno, 0)} entregas por ano registradas: quem pediu, quando saiu, quando chegou`)}
                ${Mp.minutosMes ? cartao("Paradas de linha", `−${fmt(Mp.minutosMes * pP("reducaoParadas").v, 0)} <small>min/mês</small>`, `${n1(Mp.pontosOEE)} ponto(s) de OEE`) : ""}
                ${Me.m2 > 1 ? cartao("Espaço de corredor", `${fmt(Me.m2, 0)} <small>m²</small>`, "se o corredor da empilhadeira encolher") : ""}
                ${Men.kwhAno ? cartao("Energia da frota", `${fmt(Men.kwhAno, 0)} <small>kWh/ano</small>`, Men.co2Emp > 0.05 ? `−${n1(Men.co2Emp)} t de CO₂ se a empilhadeira for a gás` : `${n1(Men.co2Atta)} t de CO₂ por ano`) : ""}
            </div>`));

        // ---------- 6. próximos passos ----------
        const acoes = (R.acoes || []).filter(a => a.liquidoAno > 0 || a.tipo === "segurança").slice(0, 3);
        const coe = R.coerencia;
        const refinar = (R.refinar || []).slice(0, 3);
        const mesFim = /mês (\d+)/.exec((R.implantacao || []).find(f => /completa/i.test(f.fase))?.quando || "")?.[1];
        const mesPil = /mês (\d+)/.exec((R.implantacao || []).find(f => /piloto/i.test(f.fase))?.quando || "")?.[1];
        partes.push(parte(6, "Próximos passos", `${mesFim ? `Em cerca de <b>${mesFim} meses</b> a frota está completa` : "A frota entra aos poucos"}${mesPil ? `; a economia começa no piloto, no ${mesPil}º mês` : ""}.`, `
            ${linhaTempo(R.implantacao)}
            ${R.wifi === "nao" ? `<p class="rv3-alerta"><b>Sem Wi-Fi no chão de fábrica.</b> O Atta se comunica por Wi-Fi: a cobertura da área de operação é pré-requisito e fica com o cliente (ou entra no escopo, a combinar). Inclua isto no "o que fica com o cliente" da proposta.</p>` : R.wifi === "falhas" ? `<p class="rv3-alerta"><b>Wi-Fi com pontos sem sinal.</b> Os trechos sem cobertura na rota do Atta precisam de reforço antes de a frota rodar.</p>` : ""}
            ${acoes.length ? `<h3>O que melhora o resultado</h3><div class="rv3-acoes">${acoes.map(a => `<div class="rv3-acao"><span class="rv3-acao-n">${a.ordem}</span><div><b>${esc(a.nome)}</b><p>${esc(a.descricao || "")}</p>
                <div class="rv3-acao-num"><span>${a.custo ? brl(a.custo) : "sem custo"}</span><span>${a.liquidoAno > 0 ? `${brl(a.liquidoAno)} por ano` : "segurança"}</span>${a.evitaHoje ? `<span class="ok">−${a.evitaHoje} Atta hoje</span>` : a.evita3 ? `<span class="ok">−${a.evita3} Atta no ano 3</span>` : ""}<span>esforço ${esc(a.esforco)}</span></div><p class="rv3-conta">${esc(contaAcao(a, R))}</p></div></div>`).join("")}</div>` : ""}
            ${refinar.length || coe ? `<h3>O que a visita técnica vai confirmar</h3><ul class="rv3-visita">
                ${coe ? `<li><b>Quantas pessoas fazem só transporte.</b> Vocês informaram ${n1(coe.informadas)} pessoas no transporte (somando os turnos), e os fluxos do estudo explicam ${n1(coe.explicadas)}. As outras fazem outros fluxos ou outras tarefas?</li>` : ""}
                ${refinar.map(x => `<li><b>${esc(x.item.replace(/\s*\(.*\)$/, ""))}.</b> ${esc(x.como.charAt(0).toUpperCase() + x.como.slice(1))}.</li>`).join("")}</ul>` : ""}`));

        // ---------- anexo técnico ----------
        partes.push(`<div class="rv3-anexo"><div class="rv3-anexo-cab"><h2>Anexo técnico</h2><p>As contas por trás de cada parte. Cada número leva a origem: ${["cliente", "simulacao", "estimado", "premissa"].map(tag).join(" ")}</p></div>`);
        let L = 0;
        const letra = () => String.fromCharCode(65 + L++);
        const AP = R.attaPessoa;
        if (AP) {
            partes.push(anexo(letra(), "O tempo de cada entrega", `<p class="rv-nota">Uma pessoa transporta de fato ${n1(AP.horasPessoa)} h por turno (sem o intervalo, as pausas e as faltas); um Atta fica disponível ${n1(AP.horasAtta)} h. A frota assume ${pessoasTxt(AP.assume.v)} de trabalho (${n1(AP.porAtta?.v)} por Atta).</p>
                ${tabela(["Fluxo", "Viagens/dia", "Por gente (ida e volta)", "Como", "Atta: só a viagem"], (AP.fluxos || []).map(f => [nomeFluxo(f.nome), fmt(f.viagensDia, 0), minTxt(f.pessoaMin), `<small>${esc(f.como)}</small> ${tag(f.origem)}`, minTxt(f.attaViagemMin)]), "rv-pequena")}
                ${tabela(["Modelo", "Atta", "Entrega por gente", "Atta ocupado por entrega", "Um Atta cheio faz o trabalho de", "Ocupação"], (AP.porModelo || []).map(m => [esc(nomeModelo(m.modelo)), fmt(m.n), minTxt(m.pessoaMin), minTxt(m.attaMin), m.potencial != null ? pessoasTxt(m.potencial) : "--", pct(m.ocupacao)]), "rv-pequena")}`));
        }
        const cP = R.custoPessoa;
        const conta = cP?.conta;
        if (cP) {
            const r0 = v => `R$&nbsp;${fmt(Math.round(v))}`;
            partes.push(anexo(letra(), "O custo de uma pessoa", conta ? tabela(["", "Por mês", ""], [
                ["Salário", r0(conta.salario), tag(conta.origemSalario)],
                ...conta.itens.map(x => [`<small>${esc(x.nome)} (${(Math.round(x.pct * 1000) / 10).toLocaleString("pt-BR")}%)</small>`, `<small>${r0(x.valor)}</small>`, ""]),
                [`Encargos (${esc(conta.nomeRegime)})`, r0(conta.encargos), tag(conta.origemRegime === "cliente" ? "cliente" : "premissa")],
                ["Benefícios", r0(conta.beneficios), tag(conta.origemBeneficios)],
                ...(conta.plr ? [["PLR (por mês)", r0(conta.plr), tag("cliente")]] : []),
                ["<b>Total</b>", `<b>${r0(conta.total)}</b>`, ""]], "rv-conta") : `<p><b>${brl(cP.v, false)}</b> por mês ${tag(cP.origem)}</p><p class="rv-nota">${esc(cP.nota || "")}</p>`));
        }
        if ((R.simulacao?.sensibilidade || []).length || fc.length || (R.sazonal?.pico > 0)) {
            const alvo = R.simulacao?.premissas?.prazoAlvo ?? 0.95, ocMax = R.simulacao?.premissas?.ocupacaoMax ?? 0.75;
            const recNome = rec?.nome || "";
            const porque = (prazo, ocup) => [prazo != null && prazo < alvo ? `só ${pct1(prazo)} no prazo (a meta é ${pct(alvo)})` : "", ocup != null && ocup > ocMax ? `cada Atta ${pct1(ocup)} ocupado (o limite é ${pct(ocMax)}, para sobrar folga)` : ""].filter(Boolean).join(" e ");
            const linhaP = (icone, titulo, txt, chip, classe) => `<li class="rv3-pres ${classe}"><span class="rv3-pres-ic" aria-hidden="true">${icone}</span><div><b>${titulo}</b><p>${txt}</p></div><span class="rv3-pres-frota">${chip}</span></li>`;
            const sens = (R.simulacao?.sensibilidade || []).map(x => {
                const pz = x.noPrazo?.[1], oc = x.ocupacao?.[1];
                if (x.atende) return linhaP("✓", esc(x.nome), `A folga da frota dá conta: ${pct(pz)} no prazo, cada Atta ${pct(oc)} ocupado.`, "a recomendada", "ok");
                const pq = porque(pz, oc) || `o resultado fica abaixo das metas`;
                const ab = x.indisponiveis ? `Com um Atta parado, os outros não cobrem: ${pq}.` : `Com a frota recomendada, ${pq}.`;
                if (x.precisa) return linhaP("+", esc(x.nome), ab, esc(aMais(recNome, x.precisa.nome) || x.precisa.nome), "mais");
                return linhaP("!", esc(x.nome), `${ab} ${x.limite === "trafego" ? `Mais Atta não resolve: o tráfego${x.gargalo ? ` em ${esc(x.gargalo)}` : ""} trava antes.` : "Nem com 6 Atta a mais de cada modelo."}`, x.limite === "trafego" ? "ação de layout" : "repensar a operação", "nao");
            });
            const anos = fc.filter(x => x.ano > 0).map(x => {
                const tit = `Ano ${x.ano} · demanda +${pct(x.crescimento)}`;
                if (!x.so?.nome) return linhaP("!", tit, `${fmt(x.pedidosDia, 0)} entregas por dia: comprar mais Atta não fecha${x.so?.limite === "trafego" ? ` (o tráfego${x.so.gargalo ? " em " + esc(x.so.gargalo) : ""} trava)` : ""}${x.plano?.nome ? `; com o plano de ações, ${esc(aMais(recNome, x.plano.nome) || "a recomendada")}` : ""}.`, x.plano?.nome ? esc(aMais(recNome, x.plano.nome) || "a recomendada") : "ação de layout", "nao");
                const mais = aMais(recNome, x.so.nome), maisPl = x.plano?.nome ? aMais(recNome, x.plano.nome) : mais;
                if (!mais) return linhaP("✓", tit, `${fmt(x.pedidosDia, 0)} entregas por dia: a folga da frota absorve o crescimento.`, "a recomendada", "ok");
                return linhaP("+", tit, `${fmt(x.pedidosDia, 0)} entregas por dia passam do que a frota aguenta (até +${pct(R.capacidade)}).${x.plano?.nome && maisPl !== mais ? ` Só comprando, ${esc(mais)}; com o plano de ações, basta ${esc(maisPl || "a recomendada")}.` : ""}`, esc(x.plano?.nome && maisPl !== mais ? (maisPl || "a recomendada") : mais), "mais");
            });
            const saz = R.sazonal && R.sazonal.pico > 0 ? (() => {
                const s = R.sazonal;
                const tit = `Mês mais cheio · +${pct(s.pico)}${s.meses ? ` · ${fmt(s.meses, 0)} ${s.meses === 1 ? "mês" : "meses"} por ano` : ""}`;
                if (s.atende) return linhaP("✓", tit, `A folga da frota cobre o pico sazonal sem reforço.`, "a recomendada", "ok");
                if (s.precisa) return linhaP("+", tit, `No pico, a frota recomendada não cumpre o prazo. O reforço é temporário — alugar nos meses cheios, não comprar.`, esc(aMais(recNome, s.precisa.nome) || s.precisa.nome), "mais");
                return linhaP("!", tit, `Nem comprando mais Atta o pico fecha${s.limite === "trafego" ? `: o tráfego${s.gargalo ? ` em ${esc(s.gargalo)}` : ""} trava antes` : ""}.`, s.limite === "trafego" ? "ação de layout" : "repensar a operação", "nao");
            })() : "";
            partes.push(anexo(letra(), "A frota sob pressão", `<p class="rv-nota">O que acontece com a frota recomendada (${esc(recNome)}) quando a operação aperta. "A recomendada" quer dizer que ela dá conta sem comprar nada; "+1 Atta" é o que falta comprar.</p>
                ${sens.length ? `<h3>E se…</h3><ul class="rv3-pres-lista">${sens.join("")}</ul>` : ""}
                ${saz ? `<h3>No pico sazonal</h3><ul class="rv3-pres-lista">${saz}</ul>` : ""}
                ${anos.length ? `<h3>Os próximos 3 anos</h3><ul class="rv3-pres-lista">${anos.join("")}</ul>` : ""}`));
        }
        if (R.bateria) {
            partes.push(anexo(letra(), "Bateria e recarga", `<p>${fmt(R.bateria.carregadores)} carregador${R.bateria.carregadores > 1 ? "es" : ""}, ${n1(R.bateria.kwhDia)} kWh por dia (${fmt(R.bateria.kwhMes, 0)} kWh por mês). ${R.bateria.attaExtra ? `A recarga pede +${R.bateria.attaExtra} Atta.` : esc(R.bateria.como.charAt(0).toUpperCase() + R.bateria.como.slice(1))}. ${tag(R.bateria.origem)}</p>
                ${tabela(["Modelo", "Atta", "Energia por dia", "Recargas por dia", "Autonomia", "Carga por dia", "Folga no turno"], R.bateria.porModelo.map(m => [esc(nomeModelo(m.modelo)), fmt(m.n), `${n1(m.whDia / 1000)} kWh`, n1(m.recargasDia), `~${n1(m.autonomiaH)} h`, `${n1(m.cargaH)} h`, `${n1(m.folgaH)} h`]), "rv-pequena")}
                <p class="rv-nota">Com o perfil de bateria de cada modelo (capacidade, carga alvo, potência do carregador); os km e as viagens de cada Atta saem da simulação. A recarga de oportunidade e a fila dos carregadores ficam no Eciton (Frota › Baterias).</p>`));
        }
        if (!semF) partes.push(anexo(letra(), "O que mais mexe no payback", svgTornado(R.sensibilidade, pv?.payback)));
        const outras = (R.acoes || []).filter(a => !acoes.includes(a));
        if (outras.length) {
            partes.push(anexo(letra(), "As outras ações testadas", `<p class="rv-nota">Cada ação foi simulada sozinha, com a demanda de hoje e a do ano 3. As que mais valem estão nos próximos passos; estas ficaram de fora porque valem menos ou não mudam a frota.</p>
                <div class="rv3-outras">${outras.map(a => `<div class="rv3-outra"><div class="rv3-outra-cab"><b>${esc(a.nome)}</b><span class="rv3-chip">${esc(a.tipo)}</span></div>
                    ${a.descricao ? `<p>${esc(a.descricao)}</p>` : ""}
                    <div class="rv3-acao-num"><span>${a.custo ? brl(a.custo) : "sem custo"}</span><span class="${a.liquidoAno > 0 ? "ok" : ""}">${a.liquidoAno > 0 ? `${brl(a.liquidoAno)} por ano` : a.liquidoAno < 0 ? `${brl(a.liquidoAno)} por ano` : "não muda o valor"}</span>${a.evitaHoje ? `<span class="ok">−${a.evitaHoje} Atta hoje</span>` : a.evita3 ? `<span class="ok">−${a.evita3} Atta no ano 3</span>` : a.destrava ? `<span class="ok">destrava o ano 3</span>` : ""}<span>esforço ${esc(a.esforco)}</span></div>
                    <p class="rv3-conta">${esc(contaAcao(a, R))}</p></div>`).join("")}</div>`));
        }
        const CP = R.cenariosPlanta || [];
        if (CP.length > 1) {
            const viav = c => R.viabilidade?.[c.id]?.v || c.viavel || "confirmar";
            const motivo = c => R.viabilidade?.[c.id]?.motivo || c.motivo || "";
            const melhorC = melhorCenario(R);
            const VTXT = { sim: "sim", nao: "não", confirmar: "a confirmar na visita" };
            partes.push(anexo(letra(), "Cenários da planta", `<p class="rv-nota">A planta pede hoje ${esc(CP[0].modulos?.length ? `${CP[0].modulos.length} modelo${CP[0].modulos.length > 1 ? "s" : ""} de Atta (${CP[0].modulos.join(", ")})` : "os modelos acima")}. Menos variantes dividem melhor o trabalho, mas trocar um módulo pede adaptar os pontos (rack, carrinho, engate). Cada cenário foi simulado com a demanda de hoje e a frota fixa, para comparar os cenários entre si.</p>
            ${tabela(["Cenário", "Frota", "Adaptar a planta", "Investimento", "Payback (hoje)", "Viável?"], CP.map(c => [
                `<b>${esc(c.nome)}</b>${c.descricao ? `<small>${esc(c.descricao)}</small>` : ""}`,
                c.fecha === false ? `<span class="rv-nao">não fecha${c.limite === "trafego" ? " (o tráfego trava)" : ""}</span>` : `<b>${fmt(c.total)} Atta</b><small>${esc(c.frota)}</small>`,
                c.adaptacao ? `${brl(c.adaptacao)}<small>${fmt(c.pontos)} ponto(s): ${esc(c.oque)}</small> ${tag("tabela")}` : "—",
                c.fecha === false ? "—" : brl(c.investimento), c.fecha === false ? "—" : `<b>${meses(c.payback)}</b>`,
                `${melhorC && melhorC.id === c.id ? `<b class="rv-ok">${esc(VTXT[viav(c)])}</b>` : esc(VTXT[viav(c)])}${motivo(c) ? `<small>${esc(motivo(c))}</small>` : ""}`]), "rv-acoes rv-pequena")}`));
        }
        const f1 = R.fase1;
        if (f1) {
            partes.push(anexo(letra(), "Começar menor: a fase 1", `<p class="rv-nota">Os fluxos por ordem de valor (o tempo de pessoa que cada minuto de Atta tira), e a frota e o payback de cada parte, com a demanda de hoje.</p>
            ${svgCurva(R.curva, f1, R.curva?.total || (R.fluxos || []).length)}
            <div class="rv-fase1"><h3>Fase 1: ${esc(f1.frota)}</h3><div class="rv-tiles">
                ${tile("Investimento", brl(f1.investimento), "Atta e implantação", "tabela")}
                ${tile("Payback (hoje)", meses(f1.payback), "com a demanda de hoje", "simulacao")}
                ${tile("Pessoas", `${n1(f1.pessoas)}`, "liberadas, somando os turnos", "simulacao")}
                ${tile("No prazo", pct(f1.noPrazo), `${fmt(f1.fluxos.length)} fluxo(s)`, "simulacao")}</div>
                <p class="rv-nota">Os fluxos da fase 1: ${f1.fluxos.map(esc).join("; ")}. A frota da fase 1 foi simulada de novo; o resto entra numa fase 2.</p></div>`));
        }
        partes.push(anexo(letra(), "Confiança do estudo", `${barrasConfianca(R.confianca)}
            ${(R.refinar || []).length ? `<h3>O que falta, por ordem de peso</h3>${tabela(["O que", "Como medir", "Hoje vem de"], R.refinar.map(x => [esc(x.item) + (x.peso ? `<small>muda o payback em até ${fmt(Math.max(1, x.peso), 0)} ${Math.round(Math.max(1, x.peso)) === 1 ? "mês" : "meses"}</small>` : x.potencial ? "<small>ganho potencial</small>" : ""), esc(x.como), tag(x.origem)]), "rv-pequena")}` : ""}`));
        partes.push(anexo(letra(), "Premissas e método", `${tabela(["Premissa", "Valor", "Faixa", "Origem"], (R.premissas || []).map(p => {
            const un = /custo|Custo/.test(p.nome) ? "R$" : "";
            const fv = v => (["crescimento", "custoCapital", "pfd", "faltas", "disponibilidadeAtta", "coberturaFrota", "reducaoParadas", "reducaoErros", "reducaoAvarias", "reducaoAcidentes"].includes(p.chave) ? pct(v) : un ? brl(v, false) : n1(v));
            return [`${esc(p.nome)}${p.nota ? `<small>${esc(p.nota)}</small>` : ""}`, fv(p.v), p.min !== p.max ? `${fv(p.min)} a ${fv(p.max)}` : "", tag(p.origem)];
        }), "rv-pequena")}
            <p class="rv-nota">Simulação por eventos do turno inteiro (${fmt(R.simulacao?.premissas?.rodadas)} dias por frota, com variação de ${pct(R.simulacao?.premissas?.variacao)} e os picos do começo do turno e da volta do intervalo), na planta de estudo: corredor de mão única, um ramal de mão dupla por estação, cruzamentos reservados como o Atta faz, velocidade de cada modelo${R.operacaoAtta?.passarSemParar ? " (o Atta de produção passa pelos pontos do caminho sem parar)" : ""}${R.operacaoAtta?.preparo ? `; ${pct(R.operacaoAtta.preparo)} do pico do começo do turno e da volta do intervalo sai antes (pré-abastecimento, com o Atta trabalhando ${fmt(R.operacaoAtta.antecedenciaMin)} min antes)` : ""}. Meta: ${pct(R.simulacao?.premissas?.prazoAlvo)} das entregas no prazo com cada Atta ocupado até ${pct(R.simulacao?.premissas?.ocupacaoMax)}, e quase nenhum pedido sobrando no fim do dia. A bateria entra pela conta do anexo (não na simulação); não simula falhas nem pessoas no caminho. A planta de estudo é simplificada: a planta de implantação sai da visita técnica. Payback simples (meses até o caixa acumulado voltar ao zero); VPL e TIR com o custo de capital de ${pct(pP("custoCapital").v)} ao ano. ${esc(R.versao ? "Eciton " + R.versao : "")}.</p>`));
        partes.push(`</div>`);

        partes.push(`<footer class="rv-rodape">E4M Engineering for Motion · São Bernardo do Campo, SP · Estudo de frota${cli.nome ? " para " + esc(cli.nome) : ""}, ${esc(data)}</footer>`);
        return `<article class="rv2 rv3">${partes.join("")}</article>`;
    }

    return { html, resumo, brl, meses, svgPlanta, ORIG };
});
