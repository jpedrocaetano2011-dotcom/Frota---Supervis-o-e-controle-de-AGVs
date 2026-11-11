/* ============================================================
   RELATÓRIO DO ESTUDO DE FROTA v2 (0.22)
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
        const x0 = Math.min(...xs) - 9, x1 = Math.max(...xs) + 9, y0 = Math.min(...ys) - 4, y1 = Math.max(...ys) + 4;
        const W = x1 - x0, H = y1 - y0, Y = y => y1 - y + y0;
        const por = new Map(pl.nos.map(n => [n.id, n]));
        const r = Math.max(W, H) / 110;
        const linhas = pl.segmentos.map(s => { const a = por.get(s.a), b = por.get(s.b); return a && b ? `<line x1="${a.x}" y1="${Y(a.y)}" x2="${b.x}" y2="${Y(b.y)}" class="${s.sentido === "DUPLO" ? "rv-ramal" : "rv-anel"}"/>` : ""; }).join("");
        const pontos = pl.nos.filter(n => n.tipo !== "REFERENCIA").map(n => n.tipo === "BERCO"
            ? `<rect x="${n.x - r}" y="${Y(n.y) - r}" width="${2 * r}" height="${2 * r}" class="rv-berco"><title>${esc(n.nome || n.id)}</title></rect>`
            : `<g><circle cx="${n.x}" cy="${Y(n.y)}" r="${r * 1.2}" class="rv-estacao"/><text x="${n.x}" y="${Y(n.y) - r * 2}" font-size="${r * 2.6}" text-anchor="middle" class="rv-rotulo">${esc(n.nome || n.id)}</text></g>`).join("");
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

    /* ---------------- o relatório ---------------- */
    function html(R, opcoes = {}) {
        if (!R) return "";
        const cli = R.cliente || {};
        const rec = R.simulacao?.recomendado;
        const r = rec?.r;
        const H = R.hoje || {};
        const F = R.financeiro || {};
        const C = F.cenarios || {};
        const Mt = R.metricas || {};
        const data = new Date(R.em || Date.now()).toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" });
        const pP = k => premissa(R, k);
        const partes = [];

        // capa
        partes.push(`<header class="rv-capa">
            ${opcoes.marca !== false ? `<img src="${esc(opcoes.marca || "img/e4m-marca-claro.webp")}" alt="E4M" width="130" height="41" class="rv-marca">` : ""}
            <div><div class="rv-sobre">Estudo de frota</div><h1>${esc(cli.nome || "Cliente")}</h1>
            <p>${[cli.setor, cli.cidade].filter(Boolean).map(esc).join(" · ")}${cli.setor || cli.cidade ? " · " : ""}${esc(data)} · E4M Engineering for Motion</p></div>
        </header>
        ${opcoes.exemplo ? `<p class="rv-exemplo">EXEMPLO · empresa, planta e números fictícios</p>` : ""}
        ${R.desatualizado ? `<p class="rv-exemplo">O estudo mudou depois deste relatório.</p>` : ""}`);

        // a sua operação hoje
        partes.push(`<section class="rv-secao rv-hoje"><h2>A sua operação hoje</h2>
            <div class="rv-tiles">
                ${tile("Mover material custa", `${brl(H.custoTransporteAno)}<small>/ano</small>`, `${n1(H.pessoasTurno)} pessoa(s) por turno${H.empilhadeiras ? ` e ${fmt(H.empilhadeiras)} empilhadeira(s)` : ""}`, pP("pessoasTurno").origem)}
                ${tile("Por entrega", brl(H.custoEntrega, false), `${fmt(H.entregasDia, 0)} entregas por dia`, "estimado")}
                ${R.custoPessoa ? tile("Cada pessoa custa", `${brl(R.custoPessoa.v, false)}<small>/mês</small>`, R.custoPessoa.conta ? `salário ${brl(R.custoPessoa.conta.salario, false)} + encargos ${pct(R.custoPessoa.conta.pctEncargos)} + benefícios` : "custo total informado", R.custoPessoa.origem) : ""}
                ${tile("Andando por dia", `${n1(H.kmDia)} km`, `${fmt(H.horasAno, 0)} horas por ano só de transporte`, "estimado")}
                ${tile("Empurrando por dia", `${n1(H.tonDia)} t`, `${n1(H.tonPessoaDia)} t por pessoa`, "estimado")}
                ${H.paradasMinMes ? tile("Linha parada por falta de material", `${fmt(H.paradasMinMes, 0)} min<small>/mês</small>`, H.paradasAno ? `${brl(H.paradasAno)} por ano` : "", pP("paradasMes").origem) : ""}
                ${H.acidentesAno ? tile("Acidentes no transporte", `${fmt(H.acidentesAno)}<small>/ano</small>`, `${brl(H.acidentesCustoAno)} por ano`, pP("acidentesAno").origem) : ""}
            </div></section>`);

        // resumo
        const txt = R.resumoMira ? `<div class="rv-texto">${esc(R.resumoMira)}</div><p class="rv-nota">Análise escrita pela Mira Pro a partir dos números deste relatório.</p>` : resumo(R).map(t => `<p>${esc(t)}</p>`).join("");
        const co = C.conservador?.compra, pv = C.provavel?.compra;
        const semF = R.semFrota;
        const coe = R.coerencia;
        partes.push(secao(1, "Resumo", `<div class="rv-destaques">
                <div class="rv-destaque"><span>Frota recomendada</span><b>${esc(rec?.nome || "nenhuma fecha")}</b>${tag("simulacao")}</div>
                <div class="rv-destaque"><span>Investimento (compra)</span><b>${semF ? "--" : brl(pv?.investimento)}</b>${tag("tabela")}</div>
                ${semF ? `<div class="rv-destaque falta"><span>Payback</span><b>sem frota que atenda</b><small>o estudo não calcula payback</small></div>`
                    : `<div class="rv-destaque ${pv?.payback != null ? "ok" : "falta"}"><span>Payback provável</span><b>${meses(pv?.payback)}</b><small>no mínimo (conservador): ${co?.payback != null ? meses(co.payback) : "não volta em 5 anos"} · otimista: ${meses(C.otimista?.compra?.payback)}</small></div>`}
            </div>
            ${semF ? `<p class="rv-nota rv-alerta"><b>Nenhuma frota testada cumpre as metas.</b> ${esc(motivoSemFrota(semF))} Os números de dinheiro ficam de fora até a operação fechar: veja as ações, o layout e os cenários da planta.</p>` : ""}
            ${coe ? `<p class="rv-nota rv-alerta"><b>Pessoas: confira com o cliente.</b> Ele informou ${n1(coe.informadas)} pessoas no transporte (somando os turnos) e os fluxos deste estudo explicam ${n1(coe.explicadas)}. As outras ${n1(coe.sobra)} fazem o quê? Se fazem outros fluxos, eles faltam no estudo; se só esperam entre uma entrega e outra, ${coe.dedicadas != null ? `as ${n1(coe.dedicadas)} que fazem só transporte` : "as que fazem só transporte (pergunte quantas)"} saem inteiras quando a frota assume o trabalho delas.</p>` : ""}
            ${txt}`));

        // 2. frota
        partes.push(secao(2, "A frota recomendada", `
            ${r ? `<div class="rv-tiles">
                ${tile("Entregas no prazo", pct(r.noPrazo[1]), `dia ruim ${pct(r.noPrazo[0])} · dia bom ${pct(r.noPrazo[2])}`, "simulacao")}
                ${tile("Do pedido à entrega", minTxt(r.tempoMedio[1]), `90% em até ${minTxt(r.tempoP90[1])}`, "simulacao")}
                ${tile("Ocupação de cada Atta", pct(r.ocupacao[1]), "a folga fica para o imprevisto", "simulacao")}
                ${tile("Espera no tráfego", minTxt(r.esperaTrafegoMin[1]), "no dia, a frota toda", "simulacao")}
            </div>` : ""}
            <div class="rv-duas">${svgPlanta(R.planta)}<div>${svgHoras(R.simulacao?.porHora)}
            ${tabela(["Fluxo", "Atta", "Viagens/dia", "Prazo", "Só a viagem"], (R.fluxos || []).map(f => [esc(f.nome), esc(nomeModelo(f.modelo)), fmt(f.viagensDia, 0), `${fmt(f.prazoMin)} min ${f.prazoOrigem === "premissa" ? tag("premissa") : ""}`, minTxt(f.minViagem)]), "rv-pequena")}</div></div>
            ${(R.simulacao?.sensibilidade || []).length ? `<h3>E se…</h3>${tabela(["Situação", "No prazo", "Dá conta?", "Frota necessária"], R.simulacao.sensibilidade.map(s => [esc(s.nome), pct(s.noPrazo?.[1]), s.atende ? "sim" : "não", s.atende ? "a mesma" : s.precisa ? esc(s.precisa.nome) : s.limite === "trafego" ? `o tráfego${s.gargalo ? ` em ${esc(s.gargalo)}` : ""} trava: precisa de ação de layout` : "mais de 6 a mais de cada modelo"]))}` : ""}
            ${R.bateria ? `<h3>Bateria e recarga</h3>
            <div class="rv-tiles">
                ${tile("Carregadores", fmt(R.bateria.carregadores), R.bateria.cabeNoite ? "carregando fora dos turnos" : "espalhando a carga pelas folgas", R.bateria.origem)}
                ${tile("Energia da frota", `${n1(R.bateria.kwhDia)} <small>kWh/dia</small>`, `${fmt(R.bateria.kwhMes, 0)} kWh por mês`, R.bateria.origem)}
                ${tile("Recarga", R.bateria.attaExtra ? `+${R.bateria.attaExtra} Atta` : "cabe", esc(R.bateria.como), R.bateria.origem)}
            </div>
            ${tabela(["Modelo", "Atta", "Energia por dia", "Recargas por dia", "Autonomia", "Carga por dia", "Folga no turno"], R.bateria.porModelo.map(m => [esc(nomeModelo(m.modelo)), fmt(m.n),
                `${n1(m.whDia / 1000)} kWh`, n1(m.recargasDia), `~${n1(m.autonomiaH)} h`, `${n1(m.cargaH)} h`, `${n1(m.folgaH)} h`]), "rv-pequena")}
            <p class="rv-nota">Com o perfil de bateria de partida de cada modelo (capacidade, carga alvo, potência do carregador): os km e as viagens de cada Atta saem da simulação. A recarga de oportunidade e a fila dos carregadores ficam no Eciton (Frota › Baterias).</p>` : ""}`));

        // 3. Atta × pessoa
        const AP = R.attaPessoa;
        if (AP) {
            const cP = R.custoPessoa || {};
            const conta = cP.conta;
            const pesInf = (H.pessoasTurno || 0) * (R.operacao?.turnos || 1);
            const pp = v => `${v != null && Math.abs(v - Math.round(v)) < 0.005 ? fmt(Math.round(v)) : n1(v)} pessoa${v != null && Math.abs(v - 1) < 0.05 ? "" : "s"}`;
            const r0 = v => `R$&nbsp;${fmt(Math.round(v))}`;
            const gap = pesInf > 0 && AP.pessoasEquivalentes.v < pesInf * 0.8;
            partes.push(secao(3, "Atta × pessoa", `
            <p>Uma pessoa transporta de fato <b>${n1(AP.horasPessoa)} h</b> por turno (o turno sem o intervalo, menos pausas, fadiga e faltas) ${tag("premissa")}; um Atta fica disponível <b>${n1(AP.horasAtta)} h</b> (fora a recarga e a manutenção) ${tag("premissa")}. A conta abaixo usa o tempo de cada entrega feita por gente hoje e o tempo que o Atta fica ocupado por entrega na simulação (com as viagens vazias e a espera no tráfego).</p>
            <div class="rv-tiles">
                ${tile("O transporte de hoje ocupa", pp(AP.pessoasEquivalentes.v), `pessoas cheias, somando os turnos (${n1(AP.pessoasEquivalentes.min)} a ${n1(AP.pessoasEquivalentes.max)})${pesInf ? ` · o cliente informou ${n1(pesInf)}` : ""}`, (R.premissas || []).find(p => p.chave === "pessoasEquivalentes")?.origem || "estimado")}
                ${tile("A frota assume", pp(AP.assume.v), `${n1(AP.porAtta?.v)} por Atta · ${AP.frotaN} Atta · ${fmt(AP.liberadas.v)} realocada${AP.liberadas.v === 1 ? "" : "s"} no cenário provável (pessoas inteiras)`, "simulacao")}
                ${tile("Para se pagar em 24 meses", AP.precisa[24] != null ? `${n1(AP.precisa[24])} <small>por Atta</small>` : "mais de 12 por Atta", `36 meses: ${AP.precisa[36] != null ? n1(AP.precisa[36]) : "--"} · 48 meses: ${AP.precisa[48] != null ? n1(AP.precisa[48]) : "--"} (cenário provável, sem crescimento)`, "tabela")}
                ${tile("Ocupação média de cada Atta", pct(AP.ocupacaoMedia), AP.poucoUsados.length ? `${AP.poucoUsados.length} Atta abaixo de 35%` : "nenhum Atta abaixo de 35%", "simulacao")}
            </div>
            ${gap ? `<p class="rv-nota rv-alerta">O cliente informou ${n1(pesInf)} pessoas no transporte, e os fluxos deste estudo explicam ${n1(AP.pessoasEquivalentes.v)}. Ou cada entrega leva mais tempo do que a conta (meça com o diário de viagens), ou há fluxos fora do estudo, ou essas pessoas fazem outras tarefas. ${C.provavel?.economiaAno1?.porPosto ? "A economia conta por posto: quem faz só transporte sai inteiro (seção 6); o resto, pelo que os fluxos explicam." : "A economia usa só o que os fluxos explicam (ou quem o cliente disser que faz só transporte)."}</p>` : ""}
            <h3>Por modelo de Atta</h3>
            ${tabela(["Modelo", "Atta", "Entrega por gente", "Atta ocupado por entrega", "Um Atta cheio faz o trabalho de", "Ocupação"], (AP.porModelo || []).map(m => [esc(nomeModelo(m.modelo)), fmt(m.n), minTxt(m.pessoaMin), minTxt(m.attaMin), m.potencial != null ? pp(m.potencial) : "--", pct(m.ocupacao)]))}
            <p class="rv-nota">"Um Atta cheio": as entregas que um Atta faz nas horas disponíveis dele, divididas pelas que uma pessoa faz nas horas produtivas dela. A frota real fica abaixo disso porque é dimensionada para o pico e para o prazo, não para a média.${AP.poucoUsados.length ? ` Pouco usados: ${AP.poucoUsados.map(a => `${esc(nomeModelo(a.modelo))}${/#(\d+)$/.test(a.id) ? " nº " + esc(a.id.split("#").pop()) : " " + esc(a.id)} (${pct(a.ocupacao)})`).join(", ")}: veja se um modelo pode cobrir os fluxos de outro.` : ""}</p>
            <div class="rv-duas"><div><h3>Um ${esc(nomeModelo(AP.umAtta.modelo))} sozinho</h3>
            ${tabela(["Se substituir", "Payback"], AP.umAtta.linhas.map(l => [pp(l.pessoas), meses(l.payback)]))}
            <p class="rv-nota">${brl(AP.umAtta.preco)} mais a implantação; ${brl(AP.umAtta.mensal, false)} por mês (plano e energia); cada pessoa ${brl(AP.umAtta.custoPessoaMes, false)} por mês. Para 24 meses, precisa substituir ${AP.umAtta.precisa[24] != null ? pp(AP.umAtta.precisa[24]) : "mais de 12 pessoas"}.</p></div>
            <div><h3>O custo de uma pessoa</h3>${conta ? tabela(["", "Por mês", ""], [
                ["Salário", r0(conta.salario), tag(conta.origemSalario)],
                ...conta.itens.map(x => [`<small>${esc(x.nome)} (${(Math.round(x.pct * 1000) / 10).toLocaleString("pt-BR")}%)</small>`, `<small>${r0(x.valor)}</small>`, ""]),
                [`Encargos (${esc(conta.nomeRegime)})`, r0(conta.encargos), tag(conta.origemRegime === "cliente" ? "cliente" : "premissa")],
                ["Benefícios", r0(conta.beneficios), tag(conta.origemBeneficios)],
                ...(conta.plr ? [["PLR (por mês)", r0(conta.plr), tag("cliente")]] : []),
                ["<b>Total</b>", `<b>${r0(conta.total)}</b>`, ""]], "rv-conta") : `<p><b>${brl(cP.v, false)}</b> por mês ${tag(cP.origem)}</p><p class="rv-nota">${esc(cP.nota || "")}</p>`}</div></div>
            <h3>O tempo de cada entrega</h3>
            ${tabela(["Fluxo", "Viagens/dia", "Por gente (ida e volta)", "Como", "Atta: só a viagem"], (AP.fluxos || []).map(f => [esc(f.nome), fmt(f.viagensDia, 0), minTxt(f.pessoaMin), `<small>${esc(f.como)}</small> ${tag(f.origem)}`, minTxt(f.attaViagemMin)]), "rv-pequena")}`));
        }

        // 4. ações
        const acoes = R.acoes || [];
        partes.push(secao(4, "Plano de ações", acoes.length ? `<p class="rv-nota">Cada ação foi simulada sozinha, com a demanda de hoje e a do ano 3. Ordem: o valor líquido por ano (o que a ação evita em Atta e em risco, menos o custo dela dividido em 5 anos).</p>
            ${tabela(["", "Ação", "Tipo", "Frota hoje", "Frota no ano 3", "Custo", "Valor por ano", "Esforço"], acoes.map(a => [
                `<b>${a.ordem}</b>`, `<b>${esc(a.nome)}</b><small>${esc(a.descricao || "")}</small>`, esc(a.tipo),
                a.totalHoje != null ? `<b>${a.totalHoje} Atta</b>${a.evitaHoje ? ` <b class="rv-ok">−${a.evitaHoje}</b>` : ""}<small>${esc(a.frotaHoje)}</small>` : a.tipo === "segurança" ? "—" : "não fecha",
                a.total3 != null ? `<b>${a.total3} Atta</b>${a.evita3 ? ` <b class="rv-ok">−${a.evita3}</b>` : ""}${a.destrava ? ` <b class="rv-ok">destrava</b>` : ""}<small>${esc(a.frota3)}</small>` : a.tipo === "segurança" ? "—" : "não fecha",
                `${a.custo ? brl(a.custo) : "sem custo"} ${a.custo ? tag(a.origemCusto) : ""}`, `${brl(a.liquidoAno)}${a.potencial ? ` ${tag("premissa")}` : ""}`, esc(a.esforco)]), "rv-acoes")}` : `<p class="rv-nota">Nenhuma ação testada.</p>`));

        // 4. forecast
        const fc = R.forecast || [];
        const precisa = fc.find(x => x.ano > 0 && (!x.so?.nome || (x.plano?.total != null && x.so?.total != null && x.plano.total < x.so.total)));
        partes.push(secao(5, "Os próximos 3 anos", fc.length ? `<p>Com a demanda crescendo ${pct(pP("crescimento").v)} por ano ${tag(pP("crescimento").origem)}: ${R.capacidade != null ? `a frota recomendada aguenta até <b>+${pct(R.capacidade)}</b> de demanda sem um Atta a mais` : ""}${precisa ? `; a partir do ano ${precisa.ano}, o plano de ações ${precisa.so?.nome ? `economiza ${precisa.so.total - precisa.plano.total} Atta` : "é o que faz a operação fechar"}` : ""}.</p>
            ${tabela(["Ano", "Demanda", "Entregas por dia", "Só comprando mais Atta", "Com o plano de ações"], fc.map(x => [x.ano ? `ano ${x.ano}` : "hoje", `${x.crescimento ? "+" : ""}${pct(x.crescimento)}`, fmt(x.pedidosDia, 0),
                x.so?.nome ? esc(x.so.nome) : `<span class="rv-nao">não fecha${x.so?.limite === "trafego" ? ` (o tráfego${x.so.gargalo ? " em " + esc(x.so.gargalo) : ""} trava)` : ""}</span>`,
                x.plano?.nome ? esc(x.plano.nome) : `<span class="rv-nao">não fecha</span>`]))}` : ""));

        // 5. financeiro
        const cenTxt = { conservador: "Conservador (no mínimo)", provavel: "Provável", otimista: "Otimista" };
        const Hh = R.horas || {};
        const cenSub = { conservador: `demanda de hoje, só ganhos confirmados, premissas no lado ruim${Hh.destino === "realocar" ? "; pessoas realocadas não contam" : ""}`,
            provavel: `com o crescimento previsto, os ganhos confirmados e as perdas que o cliente informou (pela redução mínima)${Hh.turnoNovo ? ", e o turno novo sem contratar" : ""}`,
            otimista: "com o crescimento e todos os ganhos potenciais" };
        const ep = C.provavel?.economiaAno1, eo = C.otimista?.economiaAno1;
        const linhaEc = (nome, v, origem, extra) => (v ? [esc(nome), brl(v), extra != null ? extra : "", tag(origem)] : null);
        const nomePessoas = Hh.destino === "realocar" ? `Pessoas realocadas (${pct(Hh.valorRealocacao)} do custo vira ganho)` : Hh.destino === "evitar" ? "Contratações evitadas" : "Pessoas liberadas";
        const confs = ep ? [linhaEc(nomePessoas + (ep.porPosto ? " · por posto" : ""), ep.conf.pessoas, pP("pessoasTurno").origem, `${fmt(ep.liberadas)} por turno`), linhaEc("Empilhadeiras ou rebocadores devolvidos", ep.conf.empilhadeiras, pP("empilhadeiras").origem, ep.empL ? fmt(ep.empL) : ""), linhaEc("Horas extras", ep.conf.horasExtras, pP("horasExtras").origem),
            Hh.turnoNovo && C.provavel?.economiaAno2?.conf?.turnoNovo ? [esc("Turno novo sem contratar (a partir do 2º ano)"), brl(C.provavel.economiaAno2.conf.turnoNovo), "", tag("cliente")] : null].filter(Boolean) : [];
        const potL = (nome, k, o) => (eo?.pot?.[k] || ep?.pot?.[k] ? [esc(nome), ep?.pot?.[k] ? brl(ep.pot[k]) : "—", eo?.pot?.[k] ? brl(eo.pot[k]) : "—", tag(o)] : null);
        const pots = [potL("Paradas de linha evitadas", "paradas", pP("paradasMes").origem), potL("Entregas erradas evitadas", "erros", pP("errosMes").origem), potL("Avarias evitadas", "avarias", pP("avariasMes").origem), potL("Acidentes evitados", "acidentes", pP("acidentesAno").origem),
            F.capitalGiro ? [esc("Estoque na linha a menos (uma vez)"), "—", brl(F.capitalGiro), tag("premissa")] : null].filter(Boolean);
        const cmp = F.comparacao || {};
        const semDinheiro = Boolean(semF);
        partes.push(secao(6, "O dinheiro", semDinheiro ? `<p class="rv-nota rv-alerta"><b>Sem frota que cumpra as metas, o estudo não calcula o dinheiro.</b> ${esc(motivoSemFrota(semF))} Resolva o que segura a operação (seção 4 e cenários da planta) e rode de novo.</p>` : `
            <div class="rv-cenarios">${["provavel", "conservador", "otimista"].filter(k => C[k]).map(k => `<div class="rv-cenario ${k === "provavel" ? "principal" : ""}">
                <h3>${cenTxt[k]}</h3><p class="rv-nota">${cenSub[k]}</p>
                <dl><dt>Payback</dt><dd><b>${meses(C[k].compra.payback)}</b></dd><dt>VPL em 5 anos</dt><dd>${brl(C[k].compra.vpl)}</dd><dt>TIR</dt><dd>${C[k].compra.tir != null ? pct(C[k].compra.tir) + " ao ano" : "--"}</dd>
                <dt>Investimento</dt><dd>${brl(C[k].compra.investimento)}</dd><dt>Ganho no 1º ano cheio</dt><dd>${brl(C[k].economiaAno1.total)}</dd><dt>Frota</dt><dd>${esc(C[k].frota)}${C[k].frota5 !== C[k].frota ? ` → ${esc(C[k].frota5)}` : ""}</dd></dl></div>`).join("")}</div>
            ${svgCaixa(C)}
            <div class="rv-duas"><div><h3>Ganhos confirmados (por ano, provável)</h3>${confs.length ? tabela(["", "R$ por ano", "", "origem"], confs, "rv-ganhos") : `<p class="rv-nota">Sem ganho confirmado: os fluxos do estudo não liberam uma pessoa inteira.</p>`}
                ${ep?.porPosto ? `<p class="rv-nota">Por posto: quem faz só transporte (${Hh.rotasMilkRun ? `o motorista de cada rota de milk run${Hh.dedicadas?.origem === "cliente" ? " e os dedicados que o cliente informou" : ""}` : "os dedicados que o cliente informou"}) sai inteiro quando a frota assume o trabalho dele, mesmo que hoje fique parte do turno esperando.</p>` : ""}
                ${F.destinos && Hh.destino !== "desligar" && F.destinos.desligar != null ? `<p class="rv-nota">${Hh.destino === "realocar" ? `Se as pessoas forem desligadas em vez de realocadas, o payback provável cai para ${meses(F.destinos.desligar)}.` : `O estudo conta o custo inteiro das pessoas liberadas${F.destinos.realocar != null ? `; se forem realocadas, o payback provável vai para ${meses(F.destinos.realocar)}` : ""}.`}</p>` : ""}</div>
            <div><h3>Ganhos potenciais (por ano)</h3>${pots.length ? tabela(["", "Provável", "Otimista", "origem"], pots, "rv-ganhos") : `<p class="rv-nota">O cliente não informou paradas, erros, avarias nem acidentes.</p>`}<p class="rv-nota">O provável conta só as perdas que o cliente informou, com o lado mínimo da faixa e da melhoria; o otimista conta todas, com a melhoria do lado bom. O conservador não conta nenhuma.</p></div></div>
            <div class="rv-duas"><div><h3>Comprar ou pagar por mês</h3>${tabela(["", "Comprar", "Mensalidade"], [
                ["Investimento inicial", brl(C.provavel?.compra.investimento), brl(C.provavel?.locacao.investimento)],
                ["Payback (provável)", meses(C.provavel?.compra.payback), meses(C.provavel?.locacao.payback)],
                ["Caixa em 5 anos", brl(C.provavel?.compra.acumulado), brl(C.provavel?.locacao.acumulado)],
                ["VPL em 5 anos", brl(C.provavel?.compra.vpl), brl(C.provavel?.locacao.vpl)]])}
                <p class="rv-nota">Mensalidade: ${pct(R.precos?.locacaoPctMes)} do hardware por mês, com manutenção, contrato de ${fmt(R.precos?.locacaoMeses)} meses; a implantação é paga no início.</p></div>
            <div><h3>Em 5 anos, comparado com…</h3>${tabela(["", "Custo da logística interna em 5 anos"], [
                ["Não fazer nada", `${brl(cmp.naoFazer)} <small>(pessoas e equipamentos crescendo com a demanda)</small>`],
                ["Com a E4M (provável)", brl(cmp.comE4M)],
                ...(cmp.soMaisAtta ? [["Só comprar mais Atta", `caixa ${brl(cmp.soMaisAtta.soAtta.acumulado)} · ${esc(cmp.soMaisAtta.frotaSo)} no ano 3`], ["Com o plano de ações", `caixa ${brl(cmp.soMaisAtta.comPlano.acumulado)} · ${esc(cmp.soMaisAtta.frotaPlano)} no ano 3`]] : [])])}</div></div>
            <p class="rv-nota">Investimento: Atta pela tabela de preços (${Object.entries(R.precos?.atta || {}).map(([k, v]) => `${nomeModelo(k)} ${brl(v)}`).join(", ")}), implantação ${pct(R.precos?.implantacaoPct)} do hardware. Por mês: ${esc(R.nomePlano || "Eciton")}${R.planoInfo ? ` (${esc(R.planoInfo.textoMira)}${R.planoInfo.inclui ? `: ${esc(R.planoInfo.inclui)}` : ""}) ${R.planoInfo.fixoMes ? `${brl(R.planoInfo.fixoMes, false)} pela fábrica + ` : ""}${brl(R.planoInfo.porAttaMes, false)} por Atta` : ` ${brl(R.precos?.eciton?.[R.plano], false)} por Atta`}, energia; manutenção ${pct(R.precos?.manutencaoPct)} do hardware por ano a partir do 2º ano. A economia entra aos poucos: piloto no 2º mês (25%), metade da frota no 3º (60%), tudo do 4º em diante.</p>`));

        // 7. cenários da planta (0.24)
        const CP = R.cenariosPlanta || [];
        if (CP.length > 1) {
            const viav = c => R.viabilidade?.[c.id]?.v || c.viavel || "confirmar";
            const motivo = c => R.viabilidade?.[c.id]?.motivo || c.motivo || "";
            const melhorC = melhorCenario(R);
            const VTXT = { sim: "sim", nao: "não", confirmar: "a confirmar na visita" };
            partes.push(secao(7, "Cenários da planta", `<p>A planta pede hoje ${esc(CP[0].modulos?.length ? `${CP[0].modulos.length} modelo${CP[0].modulos.length > 1 ? "s" : ""} de Atta (${CP[0].modulos.join(", ")})` : "os modelos acima")}. Quanto menos variantes, mais a frota se divide o trabalho e menos Atta ficam parados; mas trocar um módulo pede adaptar os pontos (rack, carrinho, engate). Cada cenário foi simulado com a demanda de hoje.</p>
            ${tabela(["Cenário", "Frota", "Adaptar a planta", "Investimento", "Payback (hoje)", "Viável?"], CP.map(c => [
                `<b>${esc(c.nome)}</b>${c.descricao ? `<small>${esc(c.descricao)}</small>` : ""}`,
                c.fecha === false ? `<span class="rv-nao">não fecha${c.limite === "trafego" ? " (o tráfego trava)" : ""}</span>` : `<b>${fmt(c.total)} Atta</b><small>${esc(c.frota)}</small>`,
                c.adaptacao ? `${brl(c.adaptacao)}<small>${fmt(c.pontos)} ponto(s): ${esc(c.oque)}</small> ${tag("tabela")}` : "—",
                c.fecha === false ? "—" : brl(c.investimento), c.fecha === false ? "—" : `<b>${meses(c.payback)}</b>`,
                `${melhorC && melhorC.id === c.id ? `<b class="rv-ok">${esc(VTXT[viav(c)])}</b>` : esc(VTXT[viav(c)])}${motivo(c) ? `<small>${esc(motivo(c))}</small>` : ""}`]), "rv-acoes")}
            <p class="rv-nota">Payback com a demanda de hoje e a frota fixa (para comparar os cenários entre si); o da seção 6 conta também o crescimento. "A confirmar na visita": a E4M confere se os pontos aceitam a adaptação.${melhorC ? ` O que mais vale: <b>${esc(melhorC.nome.toLowerCase())}</b>.` : ""}</p>`));
        }
        // 8. onde o projeto se paga (0.24)
        if (R.curva?.pontos?.length > 1 || R.fase1) {
            const f1 = R.fase1;
            partes.push(secao(8, "Onde o projeto se paga", `<p>Os fluxos por ordem de valor (o tempo de pessoa que cada minuto de Atta tira), e a frota e o payback de cada parte. Um projeto pode começar por onde ele mais se paga e crescer depois.</p>
            ${svgCurva(R.curva, f1, R.curva?.total || (R.fluxos || []).length)}
            ${f1 ? `<div class="rv-fase1"><h3>Fase 1: ${esc(f1.frota)}</h3><div class="rv-tiles">
                ${tile("Investimento", brl(f1.investimento), "Atta e implantação", "tabela")}
                ${tile("Payback (hoje)", meses(f1.payback), "com a demanda de hoje", "simulacao")}
                ${tile("Pessoas", `${n1(f1.pessoas)}`, "liberadas, somando os turnos", "simulacao")}
                ${tile("No prazo", pct(f1.noPrazo), `${fmt(f1.fluxos.length)} fluxo(s)`, "simulacao")}</div>
                <p class="rv-nota">Os fluxos da fase 1: ${f1.fluxos.map(esc).join("; ")}. A frota da fase 1 foi simulada de novo; o resto entra numa fase 2, com os números deste estudo.</p></div>` : `<p class="rv-nota">O projeto inteiro já é o ponto que mais se paga: não há uma fase 1 menor que se pague antes.</p>`}`));
        }
        // 9. sensibilidade
        partes.push(secao(9, "O que mais mexe no payback", svgTornado(R.sensibilidade, C.provavel?.compra?.payback)));

        // 7. segurança, ergonomia, espaço, energia, rastreabilidade
        const Mk = Mt.kmDia || {}, Mtn = Mt.tonDia || {}, Mc = Mt.custoEntrega || {}, Mp = Mt.paradas || {}, Me = Mt.espaco || {}, Men = Mt.energia || {}, Mcr = Mt.crescer || {};
        partes.push(secao(10, "Além do dinheiro", `<div class="rv-tiles">
            ${tile("Andando por dia", `${n1(Mk.hoje)} → ${n1(Mk.e4m)} km`, "as pessoas param de empurrar carrinho", "estimado")}
            ${tile("Ergonomia", `${n1(Mtn.hoje)} → ${n1(Mtn.e4m)} t/dia`, `hoje ${n1(Mtn.porPessoa)} t empurradas por pessoa por dia`, "estimado")}
            ${tile("Custo por entrega", `${brl(Mc.hoje, false)} → ${brl(Mc.e4m, false)}`, (() => { const c = (Mc.curva || []).filter(x => x.e4m != null); return c.length > 1 && c[c.length - 1].e4m < c[0].e4m ? `com a frota, cai para ${brl(c[c.length - 1].e4m, false)} com ${pct(c[c.length - 1].demanda)} da demanda` : "hoje, com a demanda atual"; })(), "estimado")}
            ${Mp.minutosMes ? tile("Paradas evitadas", `${n1(Mp.pontosOEE)} ponto(s) de OEE`, `${fmt(Mp.minutosMes * pP("reducaoParadas").v, 0)} min por mês a menos`, "premissa") : ""}
            ${F.capitalGiro ? tile("Estoque na linha a menos", brl(F.capitalGiro), "entregas menores e mais frequentes: capital de giro", "premissa") : ""}
            ${Me.m2 > 1 ? tile("Espaço de corredor", `${fmt(Me.m2, 0)} m²`, `${brl(Me.reaisAno)} por ano, se o corredor da empilhadeira encolher`, "premissa") : ""}
            ${tile("Energia da frota", `${fmt(Men.kwhAno, 0)} kWh/ano`, `${n1(Men.co2Atta)} t de CO₂${Men.co2Emp > 0.05 ? ` · −${n1(Men.co2Emp)} t de CO₂ se a empilhadeira for a gás` : ""}`, "premissa")}
            ${tile("Rastreabilidade", "100% das entregas", `${fmt(Mt.rastreabilidade?.entregasAno, 0)} por ano registradas: quem pediu, quando saiu, quando chegou`, "simulacao")}
            ${Mcr.capacidade != null ? tile("Crescer sem contratar", `+${pct(Mcr.capacidade)}`, `de demanda com a mesma frota${Mcr.turnoNovo ? `; um turno a mais sem ${n1(Mcr.pessoasTurno)} contratação(ões)` : ""}`, "simulacao") : ""}
        </div>
        ${Mc.curva?.length ? `<h3>Custo por entrega e demanda</h3>${tabela(["Demanda", "Hoje (pessoas)", "Com a E4M"], Mc.curva.map(c => [`${pct(c.demanda)} da de hoje`, brl(c.hoje, false), c.e4m != null ? brl(c.e4m, false) : "precisa de ação de layout"]))}` : ""}`));

        // 8. implantação
        partes.push(secao(11, "Plano de implantação", tabela(["Fase", "Quando", "O que", "Economia"], (R.implantacao || []).map(f => [`<b>${esc(f.fase)}</b>`, esc(f.quando), esc(f.oque), f.economia ? pct(f.economia) : "—"]))));

        // 9. refinar e confiança
        partes.push(secao(12, "Para refinar o estudo", `<h3>Confiança por seção</h3>${barrasConfianca(R.confianca)}
            ${(R.refinar || []).length ? `<h3>O que falta, por ordem de peso</h3>${tabela(["O que", "Como medir", "Hoje vem de"], R.refinar.map(x => [esc(x.item) + (x.peso ? `<small>muda o payback em até ${fmt(x.peso, 0)} meses</small>` : x.potencial ? "<small>ganho potencial</small>" : ""), esc(x.como), tag(x.origem)]))}` : ""}`));

        // 10. premissas e método
        partes.push(secao(13, "Premissas e método", `${tabela(["Premissa", "Valor", "Faixa", "Origem"], (R.premissas || []).map(p => {
            const un = /custo|Custo/.test(p.nome) ? "R$" : "";
            const fv = v => (["crescimento", "custoCapital", "pfd", "faltas", "disponibilidadeAtta", "coberturaFrota", "reducaoParadas", "reducaoErros", "reducaoAvarias", "reducaoAcidentes"].includes(p.chave) ? pct(v) : un ? brl(v, false) : n1(v));
            return [`${esc(p.nome)}${p.nota ? `<small>${esc(p.nota)}</small>` : ""}`, fv(p.v), p.min !== p.max ? `${fv(p.min)} a ${fv(p.max)}` : "", tag(p.origem)];
        }), "rv-pequena")}
            <p class="rv-nota">Simulação por eventos do turno inteiro (${fmt(R.simulacao?.premissas?.rodadas)} dias por frota, com variação de ${pct(R.simulacao?.premissas?.variacao)} e os picos do começo do turno e da volta do intervalo), na planta de estudo: corredor de mão única, um ramal de mão dupla por estação, cruzamentos reservados como o Atta faz, velocidade de cada modelo${R.operacaoAtta?.passarSemParar ? " (o Atta de produção passa pelos pontos do caminho sem parar)" : ""}${R.operacaoAtta?.preparo ? `; ${pct(R.operacaoAtta.preparo)} do pico do começo do turno e da volta do intervalo sai antes (pré-abastecimento, com o Atta trabalhando ${fmt(R.operacaoAtta.antecedenciaMin)} min antes)` : ""}. Meta: ${pct(R.simulacao?.premissas?.prazoAlvo)} das entregas no prazo com cada Atta ocupado até ${pct(R.simulacao?.premissas?.ocupacaoMax)}, e quase nenhum pedido sobrando no fim do dia. A bateria entra pela conta da seção 2 (não na simulação); não simula falhas nem pessoas no caminho. A planta de estudo é simplificada: a planta de implantação sai da visita técnica. Payback simples (meses até o caixa acumulado voltar ao zero); VPL e TIR com o custo de capital de ${pct(pP("custoCapital").v)} ao ano. ${esc(R.versao ? "Eciton " + R.versao : "")}.</p>`));

        partes.push(`<footer class="rv-rodape">E4M Engineering for Motion · São Bernardo do Campo, SP · Estudo de frota${cli.nome ? " para " + esc(cli.nome) : ""}, ${esc(data)}</footer>`);
        return `<article class="rv2">${partes.join("")}</article>`;
    }

    return { html, resumo, brl, meses, svgPlanta, ORIG };
});
