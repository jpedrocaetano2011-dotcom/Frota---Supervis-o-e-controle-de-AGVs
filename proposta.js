/* ============================================================
   PROPOSTA COMERCIAL (0.23)
   ============================================================
   montar(R, precos, prospect, opcoes) → os dados da proposta (uma
   foto: o que foi emitido não muda quando a tabela muda), a partir do
   resultado do estudo e da Tabela da E4M (preços, planos, serviços e
   condições comerciais). html(dados) desenha a proposta (no Eciton,
   no PDF e no link do cliente). pendencias(precos) diz o que ainda é
   exemplo na tabela.
*/
(function (raiz, fabrica) {
    if (typeof module === "object" && module.exports) module.exports = fabrica(require("./estudo-negocio.js"));
    else raiz.PropostaDoc = fabrica(raiz.EstudoNegocio);
})(typeof self !== "undefined" ? self : this, function (N) {
    "use strict";
    const VERSAO = "0.24.0";
    const esc = t => String(t ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
    const fmt = (v, c = 0) => (v == null || !Number.isFinite(v) ? "--" : v.toLocaleString("pt-BR", { minimumFractionDigits: c, maximumFractionDigits: c }));
    const brl = v => (v == null || !Number.isFinite(v) ? "--" : "R$ " + fmt(Math.round(v * 100) / 100, Math.abs(v - Math.round(v)) > 0.004 ? 2 : 0));
    const pct = v => (v == null || !Number.isFinite(v) ? "--" : `${fmt(v * 100, Math.abs(v * 100 - Math.round(v * 100)) > 0.04 ? 1 : 0)}%`);
    const meses = v => (v == null || !Number.isFinite(v) ? "não se paga em 5 anos" : `${fmt(v, v < 10 ? 1 : 0)} meses`);
    const letra = r => String.fromCharCode(64 + Math.max(1, Math.min(26, Number(r) || 1)));
    const nomeModelo = id => ({ "atta-g-o": "Atta G-O", "atta-e-o-serie": "Atta E-O", "atta-r-o": "Atta R-O", "atta-t-o": "Atta T-O", "atta-e-o": "Atta E-O protótipo" }[id] || id);
    const DESC_MODELO = { "atta-g-o": "garra, caixas até 250 kg", "atta-e-o-serie": "elevação, carrinhos e paletes até 1.000 kg", "atta-r-o": "roletes, troca com esteira", "atta-t-o": "rebocador de comboio", "atta-e-o": "protótipo" };

    /* ---------------- o que ainda é exemplo na tabela ---------------- */
    // cada campo da tabela que a proposta usa; "confirmados" (na tabela) lista os que a E4M já mudou
    const CAMPOS = [
        ["atta", "Atta", "Preço dos Atta"], ["planos", "Planos", "Planos do Eciton"],
        ["implantacaoPct", "Serviços", "Implantação"], ["manutencaoPct", "Serviços", "Manutenção"], ["moduloIO", "Serviços", "Módulo Eciton I/O"],
        ["locacaoPctMes", "Serviços", "Mensalidade do hardware"], ["locacaoMeses", "Serviços", "Contrato da mensalidade"], ["bercoExtra", "Serviços", "Berço a mais"],
        ["comercial.validadeDias", "Condições", "Validade da proposta"], ["comercial.prazoFabricacaoSemanas", "Condições", "Prazo de fabricação"],
        ["comercial.pagamentoCompra", "Condições", "Pagamento na compra"], ["comercial.pagamentoMensal", "Condições", "Pagamento na mensalidade"],
        ["comercial.garantiaMeses", "Condições", "Meses de garantia"], ["comercial.garantia", "Condições", "O que a garantia cobre"], ["comercial.suporte", "Condições", "Suporte"],
        ["comercial.frete", "Condições", "Frete"], ["comercial.impostos", "Condições", "Impostos"], ["comercial.reajuste", "Condições", "Reajuste"],
        ["comercial.inclui", "Condições", "O que a implantação inclui"], ["comercial.naoInclui", "Condições", "O que fica com o cliente"], ["comercial.condicoesGerais", "Condições", "Condições gerais"]
    ];
    const confirmado = (pr, cam) => (pr.confirmados || []).some(c => c === cam || c.startsWith(cam + ".") || cam.startsWith(c + "."));
    function pendencias(pr) {
        const p = N.precos(pr);
        const lista = CAMPOS.filter(([cam]) => !confirmado(p, cam)).map(([cam, grupo, rotulo]) => ({ campo: cam, grupo, rotulo }));
        if (!String(p.comercial.cnpj || "").trim()) lista.push({ campo: "comercial.cnpj", grupo: "Empresa", rotulo: "CNPJ (sem ele, a proposta sai como preliminar)", aviso: true });
        return lista;
    }

    /* ---------------- montar ---------------- */
    // opcoes: { qtd: { modelo: n }, modulosIO, bercos, extras: [{ descricao, qtd, unitario }], descontoPct, validadeDias, observacoes,
    //           mostrar: { compra, mensalidade }, plano, contato: { nome, email } }
    function frotaDoEstudo(R) { return (R?.simulacao?.recomendado?.frota || []).filter(g => g.n > 0).map(g => ({ modelo: g.modelo, n: g.n })); }
    function montar(R, precos, prospect = {}, opcoes = {}) {
        const pr = N.precos(precos);
        const c = pr.comercial;
        const frota = frotaDoEstudo(R);
        const modelos = [...new Set(frota.map(g => g.modelo).concat(Object.keys(opcoes.qtd || {})))];
        const qtd = m => Math.max(0, Math.round(Number(opcoes.qtd?.[m] ?? frota.find(g => g.modelo === m)?.n ?? 0)));
        const itens = [];
        modelos.forEach(m => { const n = qtd(m); if (n > 0) itens.push({ grupo: "atta", descricao: nomeModelo(m), detalhe: DESC_MODELO[m] || "", modelo: m, qtd: n, unitario: Number(pr.atta[m]) || 0 }); });
        const nIO = Math.max(0, Math.round(Number(opcoes.modulosIO) || 0));
        if (nIO) itens.push({ grupo: "modulo", descricao: "Módulo Eciton I/O instalado", detalhe: "semáforo, porta ou cruzamento com empilhadeira", qtd: nIO, unitario: Number(pr.moduloIO) || 0 });
        const nB = Math.max(0, Math.round(Number(opcoes.bercos) || 0));
        if (nB) itens.push({ grupo: "berco", descricao: "Berço a mais", detalhe: "espera ou recarga além dos do projeto", qtd: nB, unitario: Number(pr.bercoExtra) || 0 });
        (opcoes.extras || []).filter(x => x && String(x.descricao || "").trim() && Number(x.qtd) > 0).slice(0, 12).forEach(x =>
            itens.push({ grupo: "extra", descricao: String(x.descricao).trim().slice(0, 80), detalhe: String(x.detalhe || "").slice(0, 80), qtd: Math.round(Number(x.qtd)), unitario: Math.max(0, Number(x.unitario) || 0) }));
        itens.forEach(i => { i.total = i.qtd * i.unitario; });
        const nAtta = itens.filter(i => i.grupo === "atta").reduce((s, i) => s + i.qtd, 0);
        const hwAtta = itens.filter(i => i.grupo === "atta").reduce((s, i) => s + i.total, 0);
        const bruto = itens.reduce((s, i) => s + i.total, 0);
        const descontoPct = Math.max(0, Math.min(0.5, Number(opcoes.descontoPct) || 0));
        const desconto = bruto * descontoPct;
        const hardware = bruto - desconto;
        const implantacao = hwAtta * (1 - descontoPct) * pr.implantacaoPct;
        const plano = N.planoDe(pr, opcoes.plano || R?.plano || pr.planoPadrao);
        const planoMes = N.mensalidade(plano, nAtta);
        const compraTotal = hardware + implantacao;
        const hwMes = hardware * pr.locacaoPctMes;
        const mostrar = { compra: opcoes.mostrar?.compra !== false, mensalidade: opcoes.mostrar?.mensalidade !== false };
        if (!mostrar.compra && !mostrar.mensalidade) mostrar.compra = true;
        const parcelas = (c.pagamentoCompra || []).filter(x => Number(x.pct) > 0).map(x => ({ quando: String(x.quando || ""), pct: Number(x.pct) / 100, valor: compraTotal * Number(x.pct) / 100 }));
        // o que o estudo disse (com a frota recomendada e os preços da tabela, sem desconto)
        const C = R?.financeiro?.cenarios || {};
        const igualEstudo = descontoPct === 0 && frota.length && frota.every(g => qtd(g.modelo) === g.n) && modelos.every(m => qtd(m) === (frota.find(g => g.modelo === m)?.n || 0));
        const validadeDias = Math.max(1, Math.min(180, Math.round(Number(opcoes.validadeDias) || Number(c.validadeDias) || 30)));
        const pend = pendencias(pr);
        const cron = [{ fase: "Fabricação", quando: `${fmt(Number(c.prazoFabricacaoSemanas) || 0)} semanas a partir do pedido`, oque: `${fmt(nAtta)} Atta e os módulos` }]
            .concat((R?.implantacao || []).map(f => ({ fase: f.fase, quando: f.quando, oque: f.oque })));
        return {
            versao: VERSAO, validadeDias,
            cliente: { nome: prospect.nome || R?.cliente?.nome || "", setor: prospect.setor || R?.cliente?.setor || "", cidade: prospect.cidade || R?.cliente?.cidade || "",
                contato: { nome: String(opcoes.contato?.nome ?? prospect.contato?.nome ?? "").slice(0, 80), email: String(opcoes.contato?.email ?? prospect.contato?.email ?? "").slice(0, 120) } },
            emitente: { nomeFantasia: c.nomeFantasia || "E4M Engineering for Motion", razaoSocial: c.razaoSocial || "", cnpj: c.cnpj || "", endereco: c.endereco || "", email: c.email || "", telefone: c.telefone || "", site: c.site || "", responsavel: c.responsavel || "" },
            preliminar: !String(c.cnpj || "").trim(),
            estudo: R ? { frota: R.simulacao?.recomendado?.nome || null, noPrazo: R.simulacao?.recomendado?.r?.noPrazo?.[1] ?? null, entregasDia: R.hoje?.entregasDia ?? null,
                custoHojeAno: R.hoje?.custoTransporteAno ?? null, paybackConservador: C.conservador?.compra?.payback ?? null, paybackProvavel: C.provavel?.compra?.payback ?? null,
                paybackMensalidade: C.provavel?.locacao?.payback ?? null, economiaAno: C.provavel?.economiaAno1?.total ?? null, economiaConfirmada: C.provavel?.economiaAno1?.confirmados ?? null, semFrota: Boolean(R.semFrota), igual: Boolean(igualEstudo), em: R.em || null } : null,
            itens, nAtta, bruto, descontoPct, desconto, hardware,
            implantacao: { pct: pr.implantacaoPct, valor: implantacao, inclui: (c.inclui || []).slice(0, 20) },
            plano: { id: plano.id, nome: plano.nome, inclui: plano.inclui, mira: plano.mira, textoMira: N.MIRA_PLANO[plano.mira], fixoMes: plano.fixoMes, porAttaMes: plano.porAttaMes, mensal: planoMes },
            mostrar,
            compra: { total: compraTotal, parcelas, mensal: planoMes, manutencaoPct: pr.manutencaoPct, manutencaoAno: hardware * pr.manutencaoPct },
            mensalidade: { inicial: implantacao, hardwareMes: hwMes, planoMes, total: hwMes + planoMes, meses: pr.locacaoMeses, pctMes: pr.locacaoPctMes, pagamento: c.pagamentoMensal || "" },
            cronograma: cron,
            condicoes: { prazoFabricacaoSemanas: Number(c.prazoFabricacaoSemanas) || 0, garantiaMeses: Number(c.garantiaMeses) || 0, garantia: c.garantia || "", suporte: c.suporte || "",
                frete: c.frete || "", impostos: c.impostos || "", reajuste: c.reajuste || "", naoInclui: (c.naoInclui || []).slice(0, 20), condicoesGerais: c.condicoesGerais || "" },
            observacoes: String(opcoes.observacoes || "").slice(0, 2000),
            exemplo: pend.filter(x => !x.aviso).map(x => x.rotulo)
        };
    }

    /* ---------------- o documento ---------------- */
    const tabela = (cab, linhas, classe = "") => `<div class="rv-tabela-caixa"><table class="rv-tabela ${classe}"><thead><tr>${cab.map(c => `<th>${c}</th>`).join("")}</tr></thead><tbody>${linhas.map(l => `<tr>${l.map(c => `<td>${c}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
    const secao = (n, titulo, corpo) => `<section class="rv-secao"><h2><span class="rv-num">${n}</span>${esc(titulo)}</h2>${corpo}</section>`;
    const dataTxt = s => (s ? new Date(String(s).length === 10 ? s + "T12:00:00" : s).toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" }) : "--");
    const lista = xs => `<ul class="pp-lista">${(xs || []).map(x => `<li>${esc(x)}</li>`).join("")}</ul>`;

    // opcoes: { marca, rascunho (ainda não emitida), status, aceite, vencida, temRevisaoNova }
    function html(d, opcoes = {}) {
        if (!d) return "";
        const e = d.emitente || {}, cl = d.cliente || {};
        const num = d.numero ? `${esc(d.numero)} rev. ${letra(d.revisao)}` : "rascunho";
        const ex = (d.exemplo || []).length;
        const partes = [];
        partes.push(`<header class="rv-capa">
            ${opcoes.marca !== false ? `<img src="${esc(opcoes.marca || "img/e4m-marca-claro.webp")}" alt="E4M" width="130" height="41" class="rv-marca">` : ""}
            <div><div class="rv-sobre">Proposta comercial · ${num}</div><h1>${esc(cl.nome || "Cliente")}</h1>
            <p>${[cl.setor, cl.cidade].filter(Boolean).map(esc).join(" · ")}${cl.contato?.nome ? ` · aos cuidados de ${esc(cl.contato.nome)}` : ""}</p>
            <p>${d.emitidaEm ? `Emitida em ${esc(dataTxt(d.emitidaEm))} · válida até ${esc(dataTxt(d.validaAte))}` : `Validade: ${fmt(d.validadeDias)} dias a partir da emissão`}</p></div>
        </header>
        ${opcoes.rascunho ? `<p class="rv-exemplo">RASCUNHO · ainda não emitida (sem número)</p>` : ""}
        ${ex ? `<p class="rv-exemplo">CONDIÇÕES DE EXEMPLO · ${ex} item(ns) da tabela ainda não foram definidos pela E4M: ${(d.exemplo || []).slice(0, 8).map(esc).join(", ")}${ex > 8 ? "…" : ""}</p>` : ""}
        ${d.preliminar ? `<p class="pp-preliminar">Proposta preliminar: o contrato de fornecimento e a nota fiscal são emitidos pela pessoa jurídica da E4M.</p>` : ""}
        ${opcoes.status === "substituida" || opcoes.temRevisaoNova ? `<p class="rv-exemplo">Esta revisão foi substituída por uma mais nova. Peça o link atualizado à E4M.</p>` : ""}
        ${opcoes.status === "cancelada" ? `<p class="rv-exemplo">Esta proposta foi cancelada.</p>` : ""}
        ${opcoes.vencida && opcoes.status !== "aceita" ? `<p class="rv-exemplo">A validade desta proposta venceu. Peça uma revisão à E4M.</p>` : ""}`);

        // 1. resumo
        const es = d.estudo;
        const opc = [d.mostrar?.compra ? `compra: ${brl(d.compra.total)} e ${brl(d.compra.mensal)} por mês` : "", d.mostrar?.mensalidade ? `mensalidade: ${brl(d.mensalidade.inicial)} na implantação e ${brl(d.mensalidade.total)} por mês` : ""].filter(Boolean);
        partes.push(secao(1, "Resumo", `<p>A E4M propõe ${fmt(d.nAtta)} Atta (${esc(d.itens.filter(i => i.grupo === "atta").map(i => `${i.qtd} ${i.descricao}`).join(" + "))}) com o ${esc(d.plano.nome)} ${esc(d.plano.textoMira || "")}, a implantação completa e o acompanhamento do piloto. ${opc.length ? `Opções: ${opc.join("; ")}.` : ""}</p>
            ${es ? `<div class="rv-destaques">
                <div class="rv-destaque"><span>Frota do estudo</span><b>${esc(es.frota || "--")}</b>${es.noPrazo != null ? `<small>${pct(es.noPrazo)} das entregas no prazo</small>` : ""}</div>
                <div class="rv-destaque ${es.paybackProvavel != null ? "ok" : ""}"><span>Payback provável (compra)</span><b>${esc(meses(es.paybackProvavel))}</b><small>no mínimo (conservador): ${esc(es.paybackConservador != null ? meses(es.paybackConservador) : "não volta em 5 anos")}</small></div>
                <div class="rv-destaque"><span>Ganho por ano (provável)</span><b>${brl(es.economiaAno)}</b><small>${es.economiaConfirmada != null ? `${brl(es.economiaConfirmada)} confirmados` : "do estudo de frota"}</small></div>
            </div>${es.igual ? "" : `<p class="rv-nota">O estudo foi calculado com a frota recomendada e os preços sem desconto; os valores desta proposta são os da tabela abaixo.</p>`}` : ""}`));

        // 2. escopo
        partes.push(secao(2, "O que a E4M fornece", `${tabela(["Item", "Qtd.", "Preço unitário", "Total"], d.itens.map(i => [`<b>${esc(i.descricao)}</b>${i.detalhe ? `<small>${esc(i.detalhe)}</small>` : ""}`, fmt(i.qtd), brl(i.unitario), brl(i.total)])
                .concat(d.desconto > 0 ? [[`Desconto (${pct(d.descontoPct)})`, "", "", `−${brl(d.desconto)}`]] : [])
                .concat([[`<b>Hardware</b>`, "", "", `<b>${brl(d.hardware)}</b>`], [`<b>Implantação</b><small>${pct(d.implantacao.pct)} do valor dos Atta</small>`, "", "", `<b>${brl(d.implantacao.valor)}</b>`]]), "pp-itens")}
            <div class="rv-duas"><div><h3>A implantação inclui</h3>${lista(d.implantacao.inclui)}</div>
            <div><h3>${esc(d.plano.nome)} <small>${esc(d.plano.textoMira || "")}</small></h3><p>${esc(d.plano.inclui || "")}</p>
                <p>${d.plano.fixoMes ? `${brl(d.plano.fixoMes)} por mês pela fábrica + ` : ""}${brl(d.plano.porAttaMes)} por Atta por mês: <b>${brl(d.plano.mensal)} por mês</b> para ${fmt(d.nAtta)} Atta.</p></div></div>`));

        // 3. o que fica com o cliente
        partes.push(secao(3, "O que fica com o cliente", `${lista(d.condicoes.naoInclui)}<p class="rv-nota">Sem esses itens prontos, a implantação espera; a E4M ajuda a definir cada um na visita técnica.</p>`));

        // 4. investimento
        const blocoCompra = d.mostrar?.compra ? `<div class="rv-cenario principal"><h3>Comprar</h3><dl>
            <dt>Investimento</dt><dd><b>${brl(d.compra.total)}</b></dd><dt>Por mês</dt><dd>${brl(d.compra.mensal)} <small>(${esc(d.plano.nome)})</small></dd>
            <dt>Manutenção</dt><dd>${pct(d.compra.manutencaoPct)} do hardware por ano, a partir do 2º ano (${brl(d.compra.manutencaoAno)})</dd></dl>
            ${d.compra.parcelas.length ? tabela(["Pagamento", "%", "Valor"], d.compra.parcelas.map(x => [esc(x.quando), pct(x.pct), brl(x.valor)])) : ""}</div>` : "";
        const blocoMens = d.mostrar?.mensalidade ? `<div class="rv-cenario"><h3>Pagar por mês</h3><dl>
            <dt>Na implantação</dt><dd><b>${brl(d.mensalidade.inicial)}</b></dd><dt>Por mês</dt><dd><b>${brl(d.mensalidade.total)}</b></dd>
            <dt>Composição</dt><dd>hardware ${brl(d.mensalidade.hardwareMes)} (${pct(d.mensalidade.pctMes)} ao mês, com a manutenção) + ${esc(d.plano.nome)} ${brl(d.mensalidade.planoMes)}</dd>
            <dt>Contrato</dt><dd>${fmt(d.mensalidade.meses)} meses</dd></dl>${d.mensalidade.pagamento ? `<p class="rv-nota">${esc(d.mensalidade.pagamento)}</p>` : ""}</div>` : "";
        partes.push(secao(4, "Investimento", `<div class="rv-cenarios pp-opcoes">${blocoCompra}${blocoMens}</div>
            <p class="rv-nota">${esc(d.condicoes.impostos)} ${esc(d.condicoes.reajuste)} ${esc(d.condicoes.frete)}</p>`));

        // 5. prazos
        partes.push(secao(5, "Prazos", tabela(["Fase", "Quando", "O quê"], (d.cronograma || []).map(f => [`<b>${esc(f.fase)}</b>`, esc(f.quando), esc(f.oque)]))));

        // 6. garantia e suporte
        partes.push(secao(6, "Garantia e suporte", `<p><b>Garantia de ${fmt(d.condicoes.garantiaMeses)} meses.</b> ${esc(d.condicoes.garantia)}</p><p><b>Suporte.</b> ${esc(d.condicoes.suporte)}</p>`));

        // 7. condições e aceite
        const ac = opcoes.aceite;
        partes.push(secao(7, "Condições e aceite", `<p>${esc(d.condicoes.condicoesGerais)}</p>
            ${d.observacoes ? `<h3>Observações</h3><p class="pp-obs">${esc(d.observacoes)}</p>` : ""}
            ${ac ? `<div class="pp-aceite ok"><b>Aceita</b> por ${esc(ac.nome)}${ac.cargo ? `, ${esc(ac.cargo)}` : ""}, em ${esc(new Date(ac.em).toLocaleString("pt-BR"))}, pelo link desta proposta (${num}).</div>`
                : `<div class="pp-assinaturas"><div><span></span>${esc(cl.nome || "Cliente")}<small>nome, cargo e data</small></div><div><span></span>${esc(e.nomeFantasia)}<small>${esc(e.responsavel || "responsável")}</small></div></div>`}`));

        partes.push(`<footer class="rv-rodape">${esc(e.nomeFantasia)}${e.razaoSocial ? ` · ${esc(e.razaoSocial)}` : ""}${e.cnpj ? ` · CNPJ ${esc(e.cnpj)}` : ""}${e.endereco ? ` · ${esc(e.endereco)}` : ""}${e.email ? ` · ${esc(e.email)}` : ""}${e.telefone ? ` · ${esc(e.telefone)}` : ""}${e.site ? ` · ${esc(e.site)}` : ""} · Proposta ${num}</footer>`);
        return `<article class="rv2 pp">${partes.join("")}</article>`;
    }

    return { VERSAO, CAMPOS, pendencias, montar, html, letra, frotaDoEstudo, brl };
});
