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
    const VERSAO = "0.24.6";
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

    // 0.24.6: o mesmo visual do relatório v3 (partes com uma frase que já responde, cartões e a linha do tempo)
    const parte = (n, titulo, frase, corpo) => `<section class="rv-secao rv3-parte"><h2><span class="rv-num">${n}</span>${esc(titulo)}</h2>${frase ? `<p class="rv3-frase">${frase}</p>` : ""}${corpo}</section>`;
    const cartao = (rot, val, sub, classe = "") => `<div class="rv3-cartao ${classe}"><span>${esc(rot)}</span><b>${val}</b>${sub ? `<em>${sub}</em>` : ""}</div>`;
    const checks = xs => `<ul class="rv3-porque pp-checks">${(xs || []).map(x => `<li>${esc(x)}</li>`).join("")}</ul>`;
    const chip = id => `<span class="rv3-chip rv3-m-${esc(String(id || "").split("-")[1] || "x")}">${esc(nomeModelo(id))}</span>`;

    // opcoes: { marca, rascunho (ainda não emitida), status, aceite, vencida, temRevisaoNova }
    function html(d, opcoes = {}) {
        if (!d) return "";
        const e = d.emitente || {}, cl = d.cliente || {};
        const num = d.numero ? `${esc(d.numero)} rev. ${letra(d.revisao)}` : "rascunho";
        const ex = (d.exemplo || []).length;
        const attas = d.itens.filter(i => i.grupo === "atta");
        const frotaTxt = attas.map(i => `${i.qtd} ${i.descricao}`).join(" + ");
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

        // 1. a proposta
        const es = d.estudo;
        const formas = [d.mostrar?.compra ? `<b>${brl(d.compra.total)}</b> na compra` : "", d.mostrar?.mensalidade ? `<b>${brl(d.mensalidade.inicial)}</b> de entrada e <b>${brl(d.mensalidade.total)} por mês</b>` : ""].filter(Boolean);
        partes.push(parte(1, "A proposta", `A E4M propõe <b>${esc(frotaTxt)}</b> com o ${esc(d.plano.nome)}, a implantação completa e o acompanhamento do piloto, por ${formas.join(" ou ")}.`, `
            <div class="rv3-tres">
                ${cartao("A frota", `${fmt(d.nAtta)} <small>Atta</small>`, attas.map(i => `${i.qtd} × ${chip(i.modelo)}`).join(" "))}
                ${d.mostrar?.compra ? cartao("Comprando", brl(d.compra.total), `com a implantação · ${brl(d.compra.mensal)} por mês de ${esc(d.plano.nome)}`) : cartao("Por mês", brl(d.mensalidade.total), `${brl(d.mensalidade.inicial)} de entrada · ${fmt(d.mensalidade.meses)} meses`)}
                ${es && !es.semFrota ? cartao("Payback provável (do estudo)", esc(meses(es.paybackProvavel)), `no mínimo (conservador): ${esc(es.paybackConservador != null ? meses(es.paybackConservador) : "não volta em 5 anos")}`, es.paybackProvavel != null ? "ok" : "falta longo") : cartao("Prazo de fabricação", `${fmt(d.condicoes.prazoFabricacaoSemanas)} <small>semanas</small>`, "a partir do pedido")}
            </div>
            ${es && !es.semFrota ? `<ul class="rv3-porque">
                ${es.frota ? `<li>A frota do estudo de frota: <b>${esc(es.frota)}</b>${es.noPrazo != null ? `, ${pct(es.noPrazo)} das entregas no prazo` : ""}</li>` : ""}
                ${es.economiaAno > 0 ? `<li>Ganho de <b>${brl(Math.round(es.economiaAno))} por ano</b> no cenário provável${es.economiaConfirmada != null ? ` (${brl(Math.round(es.economiaConfirmada))} são ganhos certos)` : ""}</li>` : ""}
                ${es.custoHojeAno != null ? `<li>Hoje, mover material custa <b>${brl(Math.round(es.custoHojeAno))} por ano</b></li>` : ""}
                ${es.paybackMensalidade != null && d.mostrar?.mensalidade ? `<li>Pagando por mês, o payback provável é de <b>${esc(meses(es.paybackMensalidade))}</b></li>` : ""}
            </ul>${es.igual ? "" : `<p class="rv3-obs">O estudo foi calculado com a frota recomendada e os preços sem desconto; os valores desta proposta são os da tabela da parte 2.</p>`}` : ""}`));

        // 2. o que a E4M fornece
        partes.push(parte(2, "O que a E4M fornece", `${fmt(d.nAtta)} Atta${d.itens.some(i => i.grupo !== "atta") ? " e os itens da instalação" : ""}, a implantação e o ${esc(d.plano.nome)} ${esc(d.plano.textoMira || "")}.`, `
            ${tabela(["Item", "Qtd.", "Preço unitário", "Total"], d.itens.map(i => [`<b>${esc(i.descricao)}</b>${i.detalhe ? `<small>${esc(i.detalhe)}</small>` : ""}`, fmt(i.qtd), brl(i.unitario), brl(i.total)])
                .concat(d.desconto > 0 ? [[`Desconto (${pct(d.descontoPct)})`, "", "", `−${brl(d.desconto)}`]] : [])
                .concat([[`<b>Hardware</b>`, "", "", `<b>${brl(d.hardware)}</b>`], [`<b>Implantação</b><small>${pct(d.implantacao.pct)} do valor dos Atta</small>`, "", "", `<b>${brl(d.implantacao.valor)}</b>`]]), "pp-itens rv3-fluxos")}
            <div class="rv3-duas pp-duas">
                <div class="rv3-cartao pp-bloco"><span>A implantação inclui</span>${checks(d.implantacao.inclui)}</div>
                <div class="rv3-cartao pp-bloco"><span>${esc(d.plano.nome)} ${esc(d.plano.textoMira || "")}</span><b>${brl(d.plano.mensal)} <small>por mês</small></b>
                    <em>${d.plano.fixoMes ? `${brl(d.plano.fixoMes)} pela fábrica + ` : ""}${brl(d.plano.porAttaMes)} por Atta, para ${fmt(d.nAtta)} Atta</em><p>${esc(d.plano.inclui || "")}</p></div>
            </div>`));

        // 3. investimento
        const opCompra = d.mostrar?.compra ? `<div class="rv3-opcao pp-opcao principal"><span>Comprar</span><b>${brl(d.compra.total)}</b><em>hardware e implantação</em>
            <dl><dt>Por mês</dt><dd>${brl(d.compra.mensal)} (${esc(d.plano.nome)})</dd><dt>Manutenção</dt><dd>${pct(d.compra.manutencaoPct)} ao ano a partir do 2º ano (${brl(d.compra.manutencaoAno)})</dd></dl>
            ${d.compra.parcelas.length ? `<ol class="pp-parcelas">${d.compra.parcelas.map(x => `<li><b>${pct(x.pct)}</b><span>${esc(x.quando)}</span><strong>${brl(x.valor)}</strong></li>`).join("")}</ol>` : ""}</div>` : "";
        const opMens = d.mostrar?.mensalidade ? `<div class="rv3-opcao pp-opcao"><span>Pagar por mês</span><b>${brl(d.mensalidade.total)} <small>por mês</small></b><em>${brl(d.mensalidade.inicial)} na implantação · contrato de ${fmt(d.mensalidade.meses)} meses</em>
            <dl><dt>Hardware com manutenção</dt><dd>${brl(d.mensalidade.hardwareMes)} (${pct(d.mensalidade.pctMes)} ao mês)</dd><dt>${esc(d.plano.nome)}</dt><dd>${brl(d.mensalidade.planoMes)}</dd></dl>
            ${d.mensalidade.pagamento ? `<p class="rv-nota">${esc(d.mensalidade.pagamento)}</p>` : ""}</div>` : "";
        partes.push(parte(3, "Investimento", d.mostrar?.compra && d.mostrar?.mensalidade ? "Duas formas de pagar, lado a lado: comprar a frota ou pagar por mês, com a manutenção incluída." : d.mostrar?.compra ? "Comprando a frota, com a implantação paga junto." : "Pagando por mês, com a manutenção incluída.", `
            <div class="rv3-opcoes pp-opcoes">${opCompra}${opMens}</div>
            <p class="rv3-obs">${[d.condicoes.impostos, d.condicoes.reajuste, d.condicoes.frete].filter(Boolean).map(esc).join(" ")}</p>`));

        // 4. prazos
        const cr = d.cronograma || [];
        partes.push(parte(4, "Prazos", cr.length ? `Do pedido à frota completa: fabricação em <b>${fmt(d.condicoes.prazoFabricacaoSemanas)} semanas</b> e a implantação em seguida, começando pelo piloto.` : "",
            `<ol class="rv3-tempo">${cr.map((f, i) => `<li class="${/piloto|frota|meia/i.test(f.fase) ? "ganha" : ""}"><span class="rv3-tempo-bola">${i + 1}</span><b>${esc(f.fase)}</b><em>${esc(f.quando)}</em><span>${esc(f.oque)}</span></li>`).join("")}</ol>`));

        // 5. o que fica com o cliente
        partes.push(parte(5, "O que fica com o cliente", "Sem estes itens prontos, a implantação espera; a E4M ajuda a definir cada um na visita técnica.", `<div class="rv3-cartao pp-bloco pp-cliente">${checks(d.condicoes.naoInclui)}</div>`));

        // 6. garantia, condições e aceite
        const ac = opcoes.aceite;
        partes.push(parte(6, "Garantia, condições e aceite", `<b>${fmt(d.condicoes.garantiaMeses)} meses de garantia</b> e suporte da E4M durante o contrato.`, `
            <div class="rv3-duas pp-duas">
                <div class="rv3-cartao pp-bloco"><span>Garantia</span><b>${fmt(d.condicoes.garantiaMeses)} <small>meses</small></b><p>${esc(d.condicoes.garantia)}</p></div>
                <div class="rv3-cartao pp-bloco"><span>Suporte</span><p>${esc(d.condicoes.suporte)}</p></div>
            </div>
            <h3>Condições gerais</h3><p class="pp-gerais">${esc(d.condicoes.condicoesGerais)}</p>
            ${d.observacoes ? `<h3>Observações</h3><p class="pp-obs">${esc(d.observacoes)}</p>` : ""}
            ${ac ? `<div class="pp-aceite ok"><b>Aceita</b> por ${esc(ac.nome)}${ac.cargo ? `, ${esc(ac.cargo)}` : ""}, em ${esc(new Date(ac.em).toLocaleString("pt-BR"))}, pelo link desta proposta (${num}).</div>`
                : `<div class="pp-assinaturas"><div><span></span>${esc(cl.nome || "Cliente")}<small>nome, cargo e data</small></div><div><span></span>${esc(e.nomeFantasia)}<small>${esc(e.responsavel || "responsável")}</small></div></div>`}`));

        partes.push(`<footer class="rv-rodape">${esc(e.nomeFantasia)}${e.razaoSocial ? ` · ${esc(e.razaoSocial)}` : ""}${e.cnpj ? ` · CNPJ ${esc(e.cnpj)}` : ""}${e.endereco ? ` · ${esc(e.endereco)}` : ""}${e.email ? ` · ${esc(e.email)}` : ""}${e.telefone ? ` · ${esc(e.telefone)}` : ""}${e.site ? ` · ${esc(e.site)}` : ""} · Proposta ${num}</footer>`);
        return `<article class="rv2 rv3 pp">${partes.join("")}</article>`;
    }

    return { VERSAO, CAMPOS, pendencias, montar, html, letra, frotaDoEstudo, brl };
});
