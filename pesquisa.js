/* ============================================================
   PESQUISA COM O CLIENTE (0.22) — o questionário do Estudo de frota
   ============================================================
   Um esquema só, usado em dois lugares:
   - cliente.html?pesquisa=<código>: o cliente responde sozinho, antes da visita;
   - Estudos › prospect › Pesquisa: o fornecedor vê e completa (na visita).
   Cada resposta numérica é { v } (valor), { min, max } (faixa) ou
   { naoSei: true }. O motor (estudo-negocio.js) preenche o que falta e
   marca a origem de cada número (dado do cliente, estimado, premissa).

   Obrigatório só: o layout (DXF, imagem ou "sem planta"), dois pontos,
   um fluxo com quantidade e os turnos. Todo o resto aceita "não sei".
*/
(function (raiz, fabrica) {
    if (typeof module === "object" && module.exports) module.exports = fabrica(raiz);
    else raiz.Pesquisa = fabrica(raiz);
})(typeof self !== "undefined" ? self : this, function (raiz) {
    const CARGAS = [["carrinho", "Carrinho com rodas"], ["caixa", "Caixa ou kit (pegar e soltar)"], ["esteira", "De uma esteira"], ["comboio", "Vários carrinhos de uma vez"], ["palete", "Palete"]];
    const HOJE = [["pe", "Pessoa a pé (empurrando)"], ["rebocador", "Rebocador manual"], ["empilhadeira", "Empilhadeira"], ["outro", "Outro"]];
    const UNIDADES = [["hora", "por hora"], ["turno", "por turno"], ["dia", "por dia"]];
    // 0.24: como o material chega hoje (o modo de entrega muda a viagem e a conta)
    const ENTREGAS = [["chamada", "Quando a linha pede"], ["troca", "Troca: leva o cheio, traz o vazio"], ["milkrun", "Milk run: rota com várias paradas, de tempo em tempo"]];

    // tipo: numero | texto | escolha | sim_nao | hora | longo | layout | pontos | fluxos
    const BLOCOS = [
        { id: "operacao", titulo: "A operação", ajuda: "Como a fábrica trabalha hoje.", campos: [
            { id: "setor", rotulo: "Setor", tipo: "escolha", opcoes: [["automotivo", "Automotivo e autopeças"], ["metalurgia", "Metalurgia e máquinas"], ["alimentos", "Alimentos e bebidas"], ["farma", "Farmacêutico e cosmético"], ["eletronicos", "Eletroeletrônicos"], ["plastico", "Plástico e embalagens"], ["logistica", "Centro de distribuição"], ["hospital", "Hospital"], ["hotel", "Hotel"], ["outro", "Outro"]] },
            { id: "turnos", rotulo: "Turnos por dia", tipo: "numero", min: 1, max: 3, obrigatorio: true },
            { id: "inicio", rotulo: "Começo do 1º turno", tipo: "hora" },
            { id: "horasTurno", rotulo: "Horas por turno", tipo: "numero", unidade: "h", min: 1, max: 12 },
            { id: "dias", rotulo: "Dias trabalhados por mês", tipo: "numero", min: 1, max: 31 },
            { id: "almoco", rotulo: "Intervalo de almoço ou jantar", tipo: "numero", unidade: "min", ajuda: "a logística para nesse tempo?" },
            { id: "picos", rotulo: "Quando é o pico de pedidos de material?", tipo: "longo", ajuda: "ex.: começo do turno, volta do almoço, fechamento do mês" }
        ] },
        { id: "layout", titulo: "A planta", ajuda: "O desenho do galpão. O DXF do AutoCAD é o melhor (DWG: Salvar como › DXF). Sem ele, uma foto ou imagem da planta com a largura do galpão serve.", campos: [
            { id: "desenho", rotulo: "Desenho da planta", tipo: "layout", obrigatorio: true }
        ] },
        { id: "corredores", titulo: "Corredores", ajuda: "Por onde o material anda.", campos: [
            { id: "largura", rotulo: "Largura dos corredores principais", tipo: "numero", unidade: "m" },
            { id: "maoUnica", rotulo: "Os corredores são de mão única?", tipo: "escolha", opcoes: [["nao", "Não, ida e volta no mesmo"], ["parte", "Alguns"], ["sim", "Sim"]] },
            { id: "cruzamentos", rotulo: "Cruzamentos com empilhadeira", tipo: "numero" },
            { id: "portas", rotulo: "Portas no caminho (automáticas ou não)", tipo: "numero" },
            { id: "elevadores", rotulo: "Elevadores ou mezanino no caminho", tipo: "numero" },
            { id: "rampa", rotulo: "Tem rampa no caminho?", tipo: "sim_nao" },
            { id: "piso", rotulo: "Como é o piso?", tipo: "escolha", opcoes: [["epoxi", "Epóxi ou pintado, liso"], ["concreto", "Concreto liso"], ["irregular", "Com buracos, juntas ou desnível"], ["molhado", "Fica molhado ou sujo de óleo"]] },
            { id: "wifi", rotulo: "Wi-Fi no galpão", tipo: "escolha", opcoes: [["bom", "Pega bem em tudo"], ["falhas", "Tem pontos sem sinal"], ["nao", "Não tem Wi-Fi no chão de fábrica"]] }
        ] },
        { id: "pontos", titulo: "Os pontos", ajuda: "Clique na planta onde o material sai e onde chega: supermercado, almoxarifado, linhas, docas. Dê um nome curto a cada um.", campos: [
            { id: "lista", rotulo: "Pontos", tipo: "pontos", obrigatorio: true }
        ] },
        { id: "fluxos", titulo: "O que vai de onde para onde", ajuda: "Uma linha para cada fluxo de material. Quantidade é o número de viagens (ou carrinhos, ou kits).", campos: [
            { id: "lista", rotulo: "Fluxos", tipo: "fluxos", obrigatorio: true }
        ] },
        { id: "custo", titulo: "Quanto custa hoje", ajuda: "Para comparar com a frota. Não sabe? Marque \"não sei\": usamos uma referência de mercado e deixamos isso claro no relatório.", campos: [
            { id: "pessoas", rotulo: "Pessoas por turno levando material", tipo: "numero", faixa: true },
            { id: "dedicadas", rotulo: "Dessas, quantas fazem só transporte?", tipo: "numero", ajuda: "abastecedor de linha, motorista do rebocador: quem sai inteiro se a frota assumir o trabalho dele" },
            { id: "destinoHoras", rotulo: "O que a empresa faria com essas pessoas?", tipo: "escolha", opcoes: [["desligar", "Desligar"], ["realocar", "Realocar em outra atividade"], ["evitar", "Evitar contratação (crescimento, turno novo)"]], ajuda: "muda a conta: realocar vale uma parte do custo, desligar ou evitar contratação vale o custo inteiro" },
            // 0.22.1: o custo da pessoa vem da folha do cliente (o relatório mostra a conta, encargo por encargo)
            { id: "custoPessoa", rotulo: "Custo total por pessoa por mês, se a empresa já tiver", tipo: "numero", unidade: "R$", ajuda: "salário, encargos e benefícios juntos; se preencher este, os quatro abaixo não são precisos" },
            { id: "salario", rotulo: "Salário médio de quem leva material", tipo: "numero", unidade: "R$", faixa: true, ajuda: "o salário na carteira, por mês, sem encargos" },
            { id: "beneficios", rotulo: "Benefícios por pessoa por mês", tipo: "numero", unidade: "R$", ajuda: "vale-refeição ou alimentação, vale-transporte (a parte da empresa), plano de saúde" },
            { id: "plr", rotulo: "PLR ou bônus por pessoa por ano", tipo: "numero", unidade: "R$" },
            { id: "regime", rotulo: "Regime de impostos da empresa", tipo: "escolha", opcoes: [["real", "Lucro Real"], ["presumido", "Lucro Presumido"], ["simples", "Simples Nacional"]], ajuda: "muda os encargos: no Simples não há INSS patronal" },
            { id: "empilhadeiras", rotulo: "Empilhadeiras ou rebocadores nesse trabalho", tipo: "numero" },
            { id: "custoEmpilhadeira", rotulo: "Custo de cada uma por mês (locação, manutenção, energia ou gás)", tipo: "numero", unidade: "R$" },
            { id: "horasExtras", rotulo: "Horas extras por mês na logística interna", tipo: "numero", unidade: "h" }
        ] },
        { id: "perdas", titulo: "Perdas", ajuda: "O que a falta de material ou o erro de entrega custa.", campos: [
            { id: "paradasMes", rotulo: "Paradas de linha por falta de material, por mês", tipo: "numero", faixa: true },
            { id: "minutosParada", rotulo: "Duração média de cada parada", tipo: "numero", unidade: "min" },
            { id: "custoMinuto", rotulo: "Custo de um minuto de linha parada", tipo: "numero", unidade: "R$", ajuda: "não sabe? o faturamento e as horas de produção abaixo servem para estimar" },
            { id: "faturamentoMes", rotulo: "Faturamento por mês (da área atendida)", tipo: "numero", unidade: "R$" },
            { id: "errosMes", rotulo: "Entregas erradas ou no lugar errado, por mês", tipo: "numero" },
            { id: "custoErro", rotulo: "Custo de cada erro (retrabalho, refugo)", tipo: "numero", unidade: "R$" },
            { id: "avariasMes", rotulo: "Avarias em material ou estrutura por mês", tipo: "numero", unidade: "R$" }
        ] },
        { id: "seguranca", titulo: "Segurança", ajuda: "Últimos 12 meses, na logística interna.", campos: [
            { id: "acidentes", rotulo: "Acidentes com empilhadeira ou transporte", tipo: "numero" },
            { id: "quaseAcidentes", rotulo: "Quase-acidentes registrados", tipo: "numero" },
            { id: "diasAfastamento", rotulo: "Dias de afastamento por esses acidentes", tipo: "numero" }
        ] },
        { id: "futuro", titulo: "O futuro", ajuda: "Para a previsão de 3 anos.", campos: [
            { id: "crescimento", rotulo: "Crescimento de produção esperado por ano", tipo: "numero", unidade: "%", faixa: true },
            { id: "turnoNovo", rotulo: "Pensa em abrir mais um turno?", tipo: "sim_nao" },
            { id: "prazo", rotulo: "Para quando quer a frota rodando?", tipo: "escolha", opcoes: [["3m", "Até 3 meses"], ["6m", "Até 6 meses"], ["12m", "Até 1 ano"], ["sem", "Sem pressa, estudando"]] },
            { id: "orcamento", rotulo: "Orçamento previsto para o projeto", tipo: "numero", unidade: "R$" },
            { id: "custoCapital", rotulo: "Custo de capital da empresa (taxa ao ano)", tipo: "numero", unidade: "%" },
            { id: "obs", rotulo: "Mais alguma coisa que devemos saber?", tipo: "longo" }
        ] }
    ];

    /* ---------- leitura das respostas (Node também) ---------- */
    const valor = r => (r && typeof r === "object" ? (Number.isFinite(r.v) ? r.v : r.v ?? null) : r ?? null);
    const faixa = r => (r && Number.isFinite(r.min) && Number.isFinite(r.max) ? [Math.min(r.min, r.max), Math.max(r.min, r.max)] : null);
    const naoSei = r => Boolean(r && r.naoSei);
    const respondido = r => r != null && (naoSei(r) || faixa(r) || (valor(r) !== null && valor(r) !== ""));
    function campo(respostas, bloco, id) { return respostas?.[bloco]?.[id]; }

    // o que falta para enviar (só os obrigatórios)
    function faltando(resp) {
        const f = [];
        const d = resp?.layout?.desenho;
        if (!d || !d.tipo) f.push("a planta (ou marque que não tem desenho)");
        if (!valor(campo(resp, "operacao", "turnos"))) f.push("os turnos por dia");
        const pts = resp?.pontos?.lista || [];
        if (pts.length < 2) f.push("pelo menos dois pontos");
        const fl = (resp?.fluxos?.lista || []).filter(x => x.de && x.para && (Number(x.quantidade) > 0 || (x.entrega === "milkrun" && Number(x.ciclo) > 0)));
        if (!fl.length) f.push("pelo menos um fluxo com quantidade");
        return f;
    }
    // quanto do questionário foi respondido (por bloco: [respondidos, total])
    function progresso(resp) {
        const r = {};
        BLOCOS.forEach(b => {
            let feitos = 0, total = 0;
            b.campos.forEach(c => {
                total++;
                const x = resp?.[b.id]?.[c.id];
                if (c.tipo === "layout") { if (x?.tipo) feitos++; }
                else if (c.tipo === "pontos") { if ((x || []).length >= 2) feitos++; }
                else if (c.tipo === "fluxos") { if ((x || []).some(f => Number(f.quantidade) > 0 || (f.entrega === "milkrun" && Number(f.ciclo) > 0))) feitos++; }
                else if (respondido(x)) feitos++;
            });
            r[b.id] = [feitos, total];
        });
        return r;
    }

    /* ---------- a tela (só no navegador) ---------- */
    const esc = t => String(t ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
    const num = v => { const n = Number(String(v ?? "").replace(/\./g, "").replace(",", ".")); return Number.isFinite(n) ? n : null; };
    const numMeio = v => { const n = Number(String(v ?? "").replace(",", ".")); return Number.isFinite(n) ? n : null; };
    const idPonto = nome => (String(nome).normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z0-9]+/g, "").slice(0, 10) || "P");

    function htmlCampo(b, c, resp) {
        const x = resp?.[b.id]?.[c.id];
        const nome = `${b.id}.${c.id}`;
        const ns = naoSei(x), fx = faixa(x);
        const naoSeiHtml = c.obrigatorio || ["layout", "pontos", "fluxos", "longo", "texto"].includes(c.tipo) ? "" :
            `<label class="pq-naosei"><input type="checkbox" data-pq-naosei="${nome}" ${ns ? "checked" : ""}> não sei</label>`;
        let entrada = "";
        if (c.tipo === "numero") {
            const v = valor(x);
            entrada = fx ? `<span class="pq-faixa">entre <input type="text" inputmode="decimal" data-pq-min="${nome}" value="${esc(fx[0])}" aria-label="${esc(c.rotulo)}: mínimo"> e <input type="text" inputmode="decimal" data-pq-max="${nome}" value="${esc(fx[1])}" aria-label="${esc(c.rotulo)}: máximo"></span>`
                : `<input type="text" inputmode="decimal" data-pq="${nome}" value="${ns || v == null ? "" : esc(v)}" ${ns ? "disabled" : ""} aria-label="${esc(c.rotulo)}">`;
            entrada = `<span class="pq-un">${c.unidade === "R$" ? "<i>R$</i>" : ""}${entrada}${c.unidade && c.unidade !== "R$" ? `<i>${esc(c.unidade)}</i>` : ""}</span>${c.faixa && !ns ? `<button type="button" class="pq-link" data-pq-alternar-faixa="${nome}">${fx ? "um número só" : "é uma faixa"}</button>` : ""}`;
        } else if (c.tipo === "hora") {
            entrada = `<input type="time" data-pq="${nome}" value="${esc(valor(x) || "")}" ${ns ? "disabled" : ""} aria-label="${esc(c.rotulo)}">`;
        } else if (c.tipo === "escolha") {
            entrada = `<select data-pq="${nome}" ${ns ? "disabled" : ""} aria-label="${esc(c.rotulo)}"><option value="">—</option>${c.opcoes.map(([v, t]) => `<option value="${v}" ${valor(x) === v ? "selected" : ""}>${esc(t)}</option>`).join("")}</select>`;
        } else if (c.tipo === "sim_nao") {
            entrada = `<span class="pq-simnao">${[["sim", "Sim"], ["nao", "Não"]].map(([v, t]) => `<label><input type="radio" name="pq-${nome}" data-pq="${nome}" value="${v}" ${valor(x) === v ? "checked" : ""} ${ns ? "disabled" : ""}> ${t}</label>`).join("")}</span>`;
        } else if (c.tipo === "longo") {
            entrada = `<textarea data-pq="${nome}" rows="3" maxlength="1500" aria-label="${esc(c.rotulo)}">${esc(valor(x) || "")}</textarea>`;
        } else if (c.tipo === "layout") return htmlLayout(x);
        else if (c.tipo === "pontos") return htmlPontos(resp);
        else if (c.tipo === "fluxos") return htmlFluxos(resp);
        return `<div class="pq-campo ${ns ? "nao-sei" : ""}"><label class="pq-rotulo">${esc(c.rotulo)}${c.obrigatorio ? " *" : ""}${c.ajuda ? `<small>${esc(c.ajuda)}</small>` : ""}</label><div class="pq-entrada">${entrada}${naoSeiHtml}</div></div>`;
    }

    function htmlLayout(d) {
        const tipo = d?.tipo || "";
        const resumo = tipo === "dxf" ? `DXF: ${esc(d.desenho?.nome || "")} · ${n1(d.largura)} × ${n1(d.altura)} m` : tipo === "imagem" ? `Imagem · ${n1(d.largura)} × ${n1(d.altura)} m` : tipo === "nenhum" ? "Sem desenho: as distâncias vão em cada fluxo" : "";
        return `<div class="pq-layout">
            <div class="pq-layout-op">
                <label class="btn"><input type="file" accept=".dxf,.png,.jpg,.jpeg,.webp" data-pq-arquivo hidden>Enviar o DXF ou uma imagem</label>
                <button type="button" class="btn ${tipo === "nenhum" ? "ativo" : ""}" data-pq-sem-planta>Não tenho o desenho</button>
            </div>
            ${tipo === "imagem" ? `<label class="pq-campo"><span class="pq-rotulo">Largura do galpão na imagem<small>de uma ponta à outra do desenho, em metros: é o que dá a escala</small></span><span class="pq-un"><input type="text" inputmode="decimal" data-pq-largura value="${esc(d.largura)}"><i>m</i></span></label>` : ""}
            ${resumo ? `<p class="pq-ok">${resumo}</p>` : ""}
            ${tipo === "dxf" || tipo === "imagem" ? `<div class="pq-mapa">${svgPlanta(d, [])}</div>` : ""}
        </div>`;
    }
    const n1 = v => (Number.isFinite(Number(v)) ? String(Math.round(Number(v) * 10) / 10).replace(".", ",") : "--");

    // o desenho em SVG, em metros (y para cima, como a planta)
    function svgPlanta(d, pontos, opcoes = {}) {
        const L = Math.max(1, Number(d?.largura) || 40), A = Math.max(1, Number(d?.altura) || 25);
        const Y = y => A - y;
        let fundo = "";
        if (d?.tipo === "dxf" && d.desenho) {
            const visiveis = new Set((d.desenho.camadas || []).map((c, i) => (c.uso !== "oculta" && c.visivel !== false ? i : -1)));
            fundo = (d.desenho.linhas || []).filter(l => visiveis.has(l.c)).map(l => {
                const pts = [];
                for (let i = 0; i + 1 < l.p.length; i += 2) pts.push(`${l.p[i]},${Y(l.p[i + 1])}`);
                return `<polyline points="${pts.join(" ")}" class="${d.desenho.camadas[l.c]?.uso === "paredes" ? "pq-parede" : "pq-linha"}"/>`;
            }).join("");
        } else if (d?.tipo === "imagem" && d.imagem) fundo = `<image href="${d.imagem}" x="0" y="0" width="${L}" height="${A}" preserveAspectRatio="none" opacity="0.8"/>`;
        const r = Math.max(L, A) / 90;
        const pts = (pontos || []).filter(p => Number.isFinite(p.x)).map(p => `<g class="pq-ponto" data-pq-ponto="${esc(p.id)}"><circle cx="${p.x}" cy="${Y(p.y)}" r="${r}"/><text x="${p.x}" y="${Y(p.y) - r * 1.6}" font-size="${r * 2.2}" text-anchor="middle">${esc(p.nome)}</text></g>`).join("");
        return `<svg viewBox="${-L * 0.02} ${-A * 0.02} ${L * 1.04} ${A * 1.04}" class="pq-svg ${opcoes.clicavel ? "clicavel" : ""}" data-pq-l="${L}" data-pq-a="${A}" role="img" aria-label="Planta">${fundo}${pts}</svg>`;
    }

    function htmlPontos(resp) {
        const d = resp?.layout?.desenho;
        const lista = resp?.pontos?.lista || [];
        const temPlanta = d && (d.tipo === "dxf" || d.tipo === "imagem");
        return `<div class="pq-pontos">
            ${temPlanta ? `<p class="suave">Clique na planta para pôr um ponto. Arraste para mover.</p><div class="pq-mapa">${svgPlanta(d, lista, { clicavel: true })}</div>` : `<p class="suave">Sem desenho da planta: dê só os nomes. As distâncias entram em cada fluxo.</p>`}
            <div class="pq-lista-pontos">${lista.map(p => `<div class="pq-linha-ponto"><input type="text" maxlength="30" data-pq-ponto-nome="${esc(p.id)}" value="${esc(p.nome)}" aria-label="Nome do ponto"><select data-pq-ponto-tipo="${esc(p.id)}" aria-label="O que acontece no ponto">${[["ambos", "sai e chega"], ["coleta", "material sai"], ["entrega", "material chega"]].map(([v, t]) => `<option value="${v}" ${(p.tipo || "ambos") === v ? "selected" : ""}>${t}</option>`).join("")}</select><button type="button" class="btn-remover-fila" data-pq-ponto-tirar="${esc(p.id)}" aria-label="Tirar ${esc(p.nome)}">×</button></div>`).join("")}
            </div>
            <button type="button" class="btn btn-mini" data-pq-ponto-mais>+ Ponto${temPlanta ? " sem lugar na planta" : ""}</button>
        </div>`;
    }

    function htmlFluxos(resp) {
        const pts = resp?.pontos?.lista || [];
        const lista = resp?.fluxos?.lista || [];
        const semPlanta = resp?.layout?.desenho?.tipo === "nenhum";
        const opPts = sel => `<option value="">—</option>${pts.map(p => `<option value="${esc(p.id)}" ${sel === p.id ? "selected" : ""}>${esc(p.nome)}</option>`).join("")}`;
        const sel = (lista_, v, attr, rot) => `<select ${attr} aria-label="${rot}">${lista_.map(([k, t]) => `<option value="${k}" ${v === k ? "selected" : ""}>${esc(t)}</option>`).join("")}</select>`;
        if (pts.length < 2) return `<p class="pq-aviso">Marque pelo menos dois pontos no passo anterior.</p>`;
        return `<div class="pq-fluxos">
            ${lista.map((f, i) => `<div class="pq-fluxo">
                <div class="pq-fluxo-rota"><label>De<select data-pq-fluxo="${i}" data-c="de">${opPts(f.de)}</select></label><span>→</span><label>Para<select data-pq-fluxo="${i}" data-c="para">${opPts(f.para)}</select></label>
                    <button type="button" class="btn-remover-fila" data-pq-fluxo-tirar="${i}" aria-label="Tirar o fluxo">×</button></div>
                <div class="pq-fluxo-dados">
                    <label>Como entrega${sel(ENTREGAS, f.entrega || "chamada", `data-pq-fluxo="${i}" data-c="entrega"`, "Como entrega")}</label>
                    ${f.entrega === "milkrun" ? `<label>A rota passa a cada<span class="pq-un"><input type="text" inputmode="decimal" data-pq-fluxo="${i}" data-c="ciclo" value="${esc(f.ciclo ?? "")}" placeholder="20"><i>min</i></span></label>
                    <fieldset class="pq-paradas"><legend>Outras paradas da rota <small class="suave">(depois de "Para")</small></legend>${pts.filter(p => p.id !== f.de && p.id !== f.para).map(p => `<label class="pq-check"><input type="checkbox" data-pq-parada="${i}" value="${esc(p.id)}" ${(f.paradas || []).includes(p.id) ? "checked" : ""}>${esc(p.nome)}</label>`).join("") || `<span class="suave">marque mais pontos no passo anterior</span>`}</fieldset>` : ""}
                    <label>O que vai<input type="text" maxlength="40" data-pq-fluxo="${i}" data-c="oque" value="${esc(f.oque || "")}" placeholder="ex.: kit de parafusos"></label>
                    <label>Como vai${sel(CARGAS, f.carga || "carrinho", `data-pq-fluxo="${i}" data-c="carga"`, "Tipo de carga")}</label>
                    <label>Peso de cada viagem<span class="pq-un"><input type="text" inputmode="decimal" data-pq-fluxo="${i}" data-c="peso" value="${esc(f.peso ?? "")}"><i>kg</i></span></label>
                    ${f.entrega === "milkrun" ? "" : `<label>Quantas viagens<span class="pq-un"><input type="text" inputmode="decimal" data-pq-fluxo="${i}" data-c="quantidade" value="${esc(f.quantidade ?? "")}">${sel(UNIDADES, f.unidade || "hora", `data-pq-fluxo="${i}" data-c="unidade"`, "Por")}</span></label>`}
                    <label>Prazo aceitável<span class="pq-un"><input type="text" inputmode="decimal" data-pq-fluxo="${i}" data-c="prazo" value="${esc(f.prazo ?? "")}" placeholder="15"><i>min</i></span></label>
                    <label>Quem faz hoje${sel(HOJE, f.hoje || "pe", `data-pq-fluxo="${i}" data-c="hoje"`, "Quem faz hoje")}</label>
                    <label>Quanto tempo leva hoje<span class="pq-un"><input type="text" inputmode="decimal" data-pq-fluxo="${i}" data-c="tempoHoje" value="${esc(f.tempoHoje ?? "")}" placeholder="não sei"><i>min</i></span><small class="suave">da saída à volta, contando pegar, esperar e entregar</small></label>
                    ${semPlanta ? `<label>Distância aproximada<span class="pq-un"><input type="text" inputmode="decimal" data-pq-fluxo="${i}" data-c="distancia" value="${esc(f.distancia ?? "")}"><i>m</i></span></label>` : ""}
                </div>
            </div>`).join("")}
            <button type="button" class="btn" data-pq-fluxo-mais>+ Fluxo</button>
        </div>`;
    }

    /* o formulário em passos */
    function criar(caixa, inicial, opcoes = {}) {
        const resp = JSON.parse(JSON.stringify(inicial || {}));
        let passo = Math.min(BLOCOS.length - 1, Math.max(0, opcoes.passo || 0));
        let arraste = null, timer = null;
        const mudou = () => { clearTimeout(timer); timer = setTimeout(() => opcoes.aoMudar && opcoes.aoMudar(resp), 700); };
        const set = (bloco, id, v) => { resp[bloco] = resp[bloco] || {}; resp[bloco][id] = v; mudou(); };
        const blocoDe = n => BLOCOS.find(b => b.id === n.split(".")[0]);
        const campoDe = n => blocoDe(n)?.campos.find(c => c.id === n.split(".")[1]);

        // trocar o HTML no meio de um "blur" (um campo perde o foco porque outro redesenho começou)
        // quebra o navegador: um redesenho de cada vez, o outro fica para logo depois
        let desenhando = false;
        function desenhar() {
            if (desenhando) { setTimeout(desenhar, 0); return; }
            desenhando = true;
            try { desenharJa(); } finally { desenhando = false; }
        }
        function desenharJa() {
            const b = BLOCOS[passo];
            const prog = progresso(resp);
            const falta = faltando(resp);
            caixa.innerHTML = `<div class="pq">
                <ol class="pq-passos">${BLOCOS.map((x, i) => `<li><button type="button" data-pq-ir="${i}" class="${i === passo ? "ativo" : ""} ${prog[x.id][0] === prog[x.id][1] ? "completo" : prog[x.id][0] ? "parcial" : ""}">${i + 1}. ${esc(x.titulo)}</button></li>`).join("")}</ol>
                <section class="pq-bloco">
                    <h2>${esc(b.titulo)}</h2><p class="suave">${esc(b.ajuda || "")}</p>
                    ${b.campos.map(c => htmlCampo(b, c, resp)).join("")}
                </section>
                <div class="pq-acoes">
                    <button type="button" class="btn" data-pq-anterior ${passo === 0 ? "disabled" : ""}>Anterior</button>
                    ${passo < BLOCOS.length - 1 ? `<button type="button" class="btn btn-primario" data-pq-proximo>Próximo</button>` : ""}
                    ${opcoes.aoEnviar ? `<button type="button" class="btn ${passo === BLOCOS.length - 1 ? "btn-primario" : ""}" data-pq-enviar ${falta.length ? `title="Falta: ${esc(falta.join(", "))}"` : ""}>${opcoes.textoEnviar || "Enviar para a E4M"}</button>` : ""}
                    <span class="suave pq-salvo" aria-live="polite">${esc(opcoes.textoSalvo ? opcoes.textoSalvo() : "")}</span>
                </div>
                ${falta.length && passo === BLOCOS.length - 1 ? `<p class="pq-aviso">Para enviar ainda falta: ${esc(falta.join(", "))}.</p>` : ""}
            </div>`;
        }

        async function lerArquivo(arquivo) {
            if (/\.dwg$/i.test(arquivo.name)) { aviso("DWG não abre no navegador. No AutoCAD: Salvar como › DXF.", "erro"); return; }
            if (/\.dxf$/i.test(arquivo.name)) {
                if (arquivo.size > 60 * 1024 * 1024) { aviso("DXF maior que 60 MB: apague textos, cotas e detalhes e exporte de novo.", "erro"); return; }
                try {
                    const Dxf_ = raiz.Dxf;
                    const lido = Dxf_.ler(await arquivo.text());
                    const d = Dxf_.paraDesenho(lido, arquivo.name);
                    // o desenho vai no questionário: mais leve que na planta
                    let tol = 0.05;
                    const enxuto = Object.assign({}, d, { linhas: d.linhas.map(l => ({ c: l.c, p: Dxf_.simplificarPts(l.p, tol) })) });
                    resp.layout = resp.layout || {};
                    resp.layout.desenho = { tipo: "dxf", desenho: enxuto, largura: d.largura, altura: d.altura };
                    if (JSON.stringify(resp.layout).length > 1800000) aviso("O desenho é grande: se der erro ao salvar, apague textos e detalhes do DXF.", "aviso");
                    mudou(); desenhar();
                } catch (e) { aviso("Não foi possível ler o DXF: " + e.message, "erro"); }
                return;
            }
            const leitor = new FileReader();
            leitor.onload = () => {
                const img = new Image();
                img.onload = () => {
                    const f = Math.min(1, 1600 / Math.max(img.width, img.height));
                    const cv = document.createElement("canvas");
                    cv.width = Math.round(img.width * f); cv.height = Math.round(img.height * f);
                    const ctx = cv.getContext("2d");
                    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, cv.width, cv.height);
                    ctx.drawImage(img, 0, 0, cv.width, cv.height);
                    const largura = 60;
                    resp.layout = resp.layout || {};
                    resp.layout.desenho = { tipo: "imagem", imagem: cv.toDataURL("image/jpeg", 0.75), largura, altura: Math.round(largura * cv.height / cv.width * 10) / 10, proporcao: cv.height / cv.width };
                    mudou(); desenhar();
                };
                img.onerror = () => aviso("Não foi possível abrir a imagem.", "erro");
                img.src = leitor.result;
            };
            leitor.readAsDataURL(arquivo);
        }
        const aviso = (t, tipo) => (raiz.ui && raiz.ui.aviso ? raiz.ui.aviso(t, tipo) : opcoes.aviso ? opcoes.aviso(t, tipo) : alert(t));

        function pontoDoClique(svg, ev) {
            const pt = svg.createSVGPoint(); pt.x = ev.clientX; pt.y = ev.clientY;
            const m = pt.matrixTransform(svg.getScreenCTM().inverse());
            const A = Number(svg.dataset.pqA);
            return { x: Math.round(m.x * 10) / 10, y: Math.round((A - m.y) * 10) / 10 };
        }
        const pontos = () => { resp.pontos = resp.pontos || {}; resp.pontos.lista = resp.pontos.lista || []; return resp.pontos.lista; };
        function novoPonto(x, y) {
            const lista = pontos();
            const nome = `Ponto ${lista.length + 1}`;
            let id = idPonto(nome), k = 2;
            while (lista.some(p => p.id === id)) id = idPonto(nome) + k++;
            lista.push({ id, nome, tipo: "ambos", x, y });
            mudou(); desenhar();
            setTimeout(() => { const i = caixa.querySelector(`[data-pq-ponto-nome="${id}"]`); if (i) { i.focus(); i.select(); } }, 0);
        }

        caixa.addEventListener("click", ev => {
            const t = ev.target;
            const b = t.closest("button");
            if (b?.dataset.pqIr !== undefined) { passo = Number(b.dataset.pqIr); desenhar(); caixa.scrollIntoView?.({ block: "start" }); return; }
            if (b?.hasAttribute("data-pq-anterior")) { passo = Math.max(0, passo - 1); desenhar(); return; }
            if (b?.hasAttribute("data-pq-proximo")) { passo = Math.min(BLOCOS.length - 1, passo + 1); desenhar(); caixa.scrollIntoView?.({ block: "start" }); return; }
            if (b?.hasAttribute("data-pq-enviar")) {
                const f = faltando(resp);
                if (f.length) { aviso("Ainda falta: " + f.join(", ") + ".", "aviso"); return; }
                clearTimeout(timer);
                opcoes.aoEnviar(resp);
                return;
            }
            if (b?.hasAttribute("data-pq-sem-planta")) { resp.layout = { desenho: { tipo: "nenhum" } }; mudou(); desenhar(); return; }
            if (b?.dataset.pqAlternarFaixa) {
                const n = b.dataset.pqAlternarFaixa, [bl, id] = n.split(".");
                const x = resp[bl]?.[id];
                if (faixa(x)) set(bl, id, { v: faixa(x)[0] });
                else { const v = valor(x); set(bl, id, { min: v ?? "", max: v ?? "" }); }
                desenhar(); return;
            }
            if (b?.hasAttribute("data-pq-ponto-mais")) { novoPonto(null, null); return; }
            if (b?.dataset.pqPontoTirar) { resp.pontos.lista = pontos().filter(p => p.id !== b.dataset.pqPontoTirar); mudou(); desenhar(); return; }
            if (b?.hasAttribute("data-pq-fluxo-mais")) {
                resp.fluxos = resp.fluxos || {}; resp.fluxos.lista = resp.fluxos.lista || [];
                const pts = pontos();
                resp.fluxos.lista.push({ de: pts.find(p => p.tipo === "coleta")?.id || pts[0]?.id || "", para: "", carga: "carrinho", unidade: "hora", hoje: "pe" });
                mudou(); desenhar(); return;
            }
            if (b?.dataset.pqFluxoTirar !== undefined) { resp.fluxos.lista.splice(Number(b.dataset.pqFluxoTirar), 1); mudou(); desenhar(); return; }
            const svg = t.closest("svg.pq-svg.clicavel");
            if (svg && !t.closest(".pq-ponto") && !arraste?.moveu) { const p = pontoDoClique(svg, ev); novoPonto(p.x, p.y); }
        });
        caixa.addEventListener("pointerdown", ev => {
            const g = ev.target.closest(".pq-ponto");
            const svg = ev.target.closest("svg.pq-svg.clicavel");
            if (!g || !svg) { arraste = null; return; }
            arraste = { id: g.dataset.pqPonto, svg, moveu: false };
            ev.preventDefault();
        });
        caixa.addEventListener("pointermove", ev => {
            if (!arraste) return;
            const p = pontoDoClique(arraste.svg, ev);
            const ponto = pontos().find(x => x.id === arraste.id);
            if (!ponto) return;
            ponto.x = p.x; ponto.y = p.y; arraste.moveu = true;
            const g = arraste.svg.querySelector(`[data-pq-ponto="${CSS.escape(arraste.id)}"]`);
            const A = Number(arraste.svg.dataset.pqA);
            if (g) { const c = g.querySelector("circle"), tx = g.querySelector("text"); c.setAttribute("cx", p.x); c.setAttribute("cy", A - p.y); tx.setAttribute("x", p.x); tx.setAttribute("y", A - p.y - Number(c.getAttribute("r")) * 1.6); }
        });
        caixa.addEventListener("pointerup", () => { if (arraste?.moveu) { mudou(); setTimeout(() => { arraste = null; }, 0); } else arraste = null; });
        caixa.addEventListener("change", ev => {
            const t = ev.target;
            if (t.matches("[data-pq-arquivo]") && t.files?.[0]) { lerArquivo(t.files[0]); return; }
            if (t.matches("[data-pq-largura]")) {
                const d = resp.layout?.desenho; const L = numMeio(t.value);
                if (d && L > 0) { d.largura = L; d.altura = Math.round(L * (d.proporcao || d.altura / d.largura) * 10) / 10; mudou(); desenhar(); }
                return;
            }
            if (t.dataset.pqNaosei) { const [bl, id] = t.dataset.pqNaosei.split("."); set(bl, id, t.checked ? { naoSei: true } : { v: null }); desenhar(); return; }
            if (t.dataset.pqMin || t.dataset.pqMax) {
                const n = t.dataset.pqMin || t.dataset.pqMax, [bl, id] = n.split(".");
                const x = Object.assign({}, resp[bl]?.[id]);
                x[t.dataset.pqMin ? "min" : "max"] = num(t.value); delete x.v;
                set(bl, id, x); return;
            }
            if (t.dataset.pq) {
                const n = t.dataset.pq, [bl, id] = n.split("."), c = campoDe(n);
                const v = c?.tipo === "numero" ? (c.unidade === "R$" ? num(t.value) : numMeio(t.value)) : t.value;
                set(bl, id, { v: v === "" ? null : v });
                return;
            }
            if (t.dataset.pqPontoNome) { const p = pontos().find(x => x.id === t.dataset.pqPontoNome); if (p) { p.nome = t.value.trim().slice(0, 30) || p.nome; mudou(); desenhar(); } return; }
            if (t.dataset.pqPontoTipo) { const p = pontos().find(x => x.id === t.dataset.pqPontoTipo); if (p) { p.tipo = t.value; mudou(); } return; }
            if (t.dataset.pqFluxo !== undefined) {
                const f = resp.fluxos.lista[Number(t.dataset.pqFluxo)], c = t.dataset.c;
                if (!f) return;
                f[c] = ["peso", "quantidade", "prazo", "distancia", "tempoHoje", "ciclo"].includes(c) ? numMeio(t.value) : t.value;
                if (c === "entrega" && t.value === "milkrun" && !f.hoje) f.hoje = "rebocador";
                mudou();
                if (c === "de" || c === "para" || c === "entrega") desenhar();
                return;
            }
            if (t.dataset.pqParada !== undefined) {
                const f = resp.fluxos.lista[Number(t.dataset.pqParada)];
                if (!f) return;
                const set = new Set(f.paradas || []);
                if (t.checked) set.add(t.value); else set.delete(t.value);
                f.paradas = [...set];
                mudou();
            }
        });
        desenhar();
        return { respostas: () => resp, desenhar, passo: () => passo, irPara: i => { passo = i; desenhar(); }, salvarJa: () => { clearTimeout(timer); if (opcoes.aoMudar) opcoes.aoMudar(resp); } };
    }

    return { BLOCOS, CARGAS, HOJE, UNIDADES, ENTREGAS, valor, faixa, naoSei, respondido, faltando, progresso, campo, criar, svgPlanta, idPonto };
});
