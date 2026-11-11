/* ============================================================
   ESTUDO DE FROTA PARA PROSPECTS (0.22) — o motor de negócio
   ============================================================
   Em cima do motor de simulação (estudo.js), o que faz o estudo vender:

   1. Do questionário (pesquisa.js) para a simulação, sem trabalho manual:
      - plantaDoQuestionario: uma planta de estudo simplificada (anel de mão
        única em volta dos pontos, um ramal curto de mão dupla até cada
        estação, curvas nos cantos, berços), com o DXF ou a imagem de fundo;
        sem desenho, as posições saem das distâncias de cada fluxo;
      - fluxosDoQuestionario: cada linha de → para vira um fluxo, com o modelo
        escolhido pelo tipo de carga e pelo peso, e a missão de cada um;
      - calendarioDoQuestionario: turnos, dias e o intervalo de almoço.
   2. Quando falta resposta: resolver() preenche cada número, nesta ordem:
      a conta a partir de outra resposta (estimado) → a referência pública →
      a premissa de mercado conservadora. Cada número leva a origem.
   3. estudar(): roda a simulação, testa as ações (pré-abastecimento,
      prioridade, segundo acesso no gargalo, berço perto, variantes de
      planta, semáforo do Eciton I/O) e ranqueia pelo valor líquido; prevê
      3 anos; calcula o financeiro de 5 anos (payback, VPL, TIR, compra ×
      mensalidade, contra "não fazer nada" e "só comprar mais Atta") nos
      cenários conservador, provável e otimista; a sensibilidade; as
      métricas (km andados, ergonomia, custo por entrega, paradas, espaço,
      energia, rastreabilidade, crescer sem contratar); o plano de
      implantação; a confiança por seção e o "para refinar o estudo".
   O resultado é um objeto só (sem a planta inteira), que o relatório
   (relatorio-estudo.js) desenha no Eciton e no link do cliente.

   Roda no navegador (window.EstudoNegocio) e no Node (require).
*/
(function (raiz, fabrica) {
    if (typeof module === "object" && module.exports) module.exports = fabrica(raiz);
    else raiz.EstudoNegocio = fabrica(raiz);
})(typeof self !== "undefined" ? self : this, function (raiz) {
    const noNode = typeof module === "object" && module.exports && typeof require === "function";
    const P = () => raiz.Planta || (typeof Planta !== "undefined" ? Planta : noNode ? require("./planta.js") : null);
    const E = () => raiz.Estudo || (typeof Estudo !== "undefined" ? Estudo : noNode ? require("./estudo.js") : null);
    const Q = () => raiz.Pesquisa || (typeof Pesquisa !== "undefined" ? Pesquisa : noNode ? require("./pesquisa.js") : null);
    const M = () => raiz.Modelos || (typeof Modelos !== "undefined" ? Modelos : null);
    const VERSAO = "0.24.0";

    /* ---------------- tabela de preços (exemplo, editável em Estudos) ---------------- */
    // Valores de partida (exemplo até a E4M mudar). 0.24: o Atta na faixa de um AGV guiado por
    // linha nacional (R$ 150 mil a 220 mil): lá fora, o AGV de fita magnética ou óptica (AGC) sai
    // por US$ 14 mil a 23 mil e o rebocador por US$ 20 mil a 50 mil; importado, soma o imposto de
    // importação (20% para bem de capital) e os outros impostos. Manutenção ~5% do hardware por ano.
    const PRECOS_PADRAO = {
        atta: { "atta-g-o": 170000, "atta-e-o-serie": 180000, "atta-r-o": 190000, "atta-t-o": 210000 },
        // 0.22.1: os planos do Eciton são da E4M (cria, renomeia, muda o preço, apaga); o relatório usa o preço do plano escolhido
        planos: [
            { id: "silver", nome: "Eciton Silver", inclui: "Eciton: missões, frota, mapa ao vivo, postos e relatórios. Sem a Mira.", mira: "nao", fixoMes: 0, porAttaMes: 450 },
            { id: "gold", nome: "Eciton Gold", inclui: "Eciton com estudos de demanda e mapa de calor, mais a Mira.", mira: "mira", fixoMes: 500, porAttaMes: 650 },
            { id: "platinum", nome: "Eciton Platinum", inclui: "Eciton completo, com integrações, mais a Mira Pro.", mira: "pro", fixoMes: 1500, porAttaMes: 850 }
        ],
        planoPadrao: "gold",
        implantacaoPct: 0.20, moduloIO: 8000, manutencaoPct: 0.05,
        locacaoPctMes: 0.032, locacaoMeses: 48, cambio: 5.5,
        energiaKwh: 0.85, segundoAcesso: 12000, bercoExtra: 6000, expansaoPct: 0.10,
        // 0.22.1: a pessoa de referência (quando o cliente não sabe a folha) e os encargos da lei
        pessoa: {
            salario: 2410.74, fonteSalario: "Novo CAGED, salário médio real de admissão, agosto de 2026", beneficios: 900, regime: "real",
            encargos: { decimo: 0.0833, ferias: 0.1111, inss: 0.20, rat: 0.03, terceiros: 0.058, fgts: 0.08, rescisao: 0.04 }
        },
        // as premissas técnicas que a E4M muda (chave → [valor, mínimo, máximo]); vazio = as de fábrica
        premissas: {},
        // 0.23: as condições comerciais da proposta (valores de EXEMPLO até a E4M mudar cada um)
        comercial: {
            nomeFantasia: "E4M Engineering for Motion", razaoSocial: "", cnpj: "", endereco: "São Bernardo do Campo, SP", email: "", telefone: "", site: "", responsavel: "",
            avisoAceite: "",
            validadeDias: 30, prazoFabricacaoSemanas: 10, garantiaMeses: 12,
            pagamentoCompra: [{ quando: "no pedido", pct: 40 }, { quando: "na entrega dos Atta", pct: 40 }, { quando: "no aceite da implantação", pct: 20 }],
            pagamentoMensal: "Implantação: 50% no pedido e 50% no aceite. Mensalidade: todo dia 10, a partir do mês seguinte ao piloto.",
            garantia: "Defeitos de fabricação dos Atta e dos módulos, com troca de peças e mão de obra, nas instalações do cliente.",
            suporte: "Atendimento remoto em dias úteis, das 8 h às 18 h, com resposta em até 4 h úteis. Visita preventiva a cada 6 meses.",
            frete: "Por conta da E4M no estado de São Paulo; fora dele, cotado à parte.",
            impostos: "Preços sem impostos. Os impostos entram na nota fiscal, conforme a legislação.",
            reajuste: "Mensalidade reajustada uma vez por ano pelo IPCA.",
            inclui: ["Visita técnica e projeto da planta", "Fita, tags e marcação no chão nas rotas do projeto", "Berços de espera e de recarga do projeto", "Configuração do Eciton, das missões e dos postos", "Treinamento dos operadores e dos líderes", "Acompanhamento do piloto"],
            naoInclui: ["Rede Wi-Fi na área de operação", "Pontos de energia para os carregadores", "Piso nivelado e sem buracos nas rotas", "Obras civis e mudanças de layout", "Integração com sistemas do cliente (cotada à parte)"],
            condicoesGerais: "Modelo: revise com o jurídico e a contabilidade antes de usar. O pedido é confirmado pelo aceite desta proposta e pelo contrato de fornecimento. Cancelamento depois da fabricação: 30% do valor do hardware."
        },
        // 0.24: adaptar a planta para outro módulo levar a carga (R$ por posto atendido): "carga:módulo" → [custo, o que é]
        // (o módulo de origem da carga não precisa de adaptação; sem a chave, o módulo não leva essa carga)
        adaptacao: {
            "caixa:E": [2500, "rack ou carrinho que o Atta E ergue, um por posto"],
            "caixa:T": [3000, "carrinho de comboio com prateleira, um por posto"],
            "caixa:R": [9000, "transportador de rolos no posto"],
            "carrinho:T": [800, "engate no carrinho (o Atta T reboca)"],
            "esteira:E": [4000, "rack no fim da esteira para o Atta E erguer"],
            "palete:T": [1500, "carrinho de palete para o comboio"]
        },
        // os campos que a E4M já mudou (os outros aparecem como exemplo na proposta)
        confirmados: []
    };
    // o módulo que leva cada carga sem adaptar nada
    const NATIVO = { caixa: "G", carrinho: "E", esteira: "R", comboio: "T", palete: "E" };
    // o prazo de partida por tipo de carga, quando o cliente não diz (min): kit e esteira acabam rápido; carrinho e palete têm mais estoque na linha
    const PRAZO_CARGA = { caixa: 15, carrinho: 20, esteira: 10, comboio: 30, palete: 30 };
    // as referências de mercado de cada preço (aparecem ao lado do campo na tabela da E4M)
    const REFERENCIAS = {
        atta: "AGV de fita magnética ou óptica (AGC) US$ 14 mil a 23 mil; rebocador US$ 20 mil a 50 mil; AMR de navegação natural US$ 25 mil a 40 mil; paleteira automática ~US$ 55 mil; empilhadeira AGV ~US$ 80 mil (AGV Network). Importado: imposto de importação de 20% para bem de capital (NCM 8427.10.19); empilhadeira AGV com SLAM tem ex-tarifário a 0% até 30/06/2028",
        software: "atualizações de software até ~US$ 1.000 por robô por ano (Qviro); na Safelog, o gerenciador de frota vem no preço",
        manutencao: "exemplo do Qviro: US$ 2 mil por ano num robô de US$ 50 mil (4%)",
        implantacao: "integração de US$ 5 mil a 20 mil, mais US$ 2 mil a 5 mil de treinamento (Qviro)",
        mensalidade: "RaaS com tudo: US$ 1.900 a 2.200 por robô por mês (Brightpick, 2025)",
        salario: "Novo CAGED: salário médio real de admissão (todos os setores e estados)",
        encargos: "13º 8,33%; férias + 1/3 11,11%; INSS patronal 20%, RAT 1% a 3%, terceiros ~5,8% e FGTS 8% (também sobre o 13º e as férias); reserva de rescisão ~4%. No Simples Nacional, sem INSS patronal, RAT e terceiros"
    };
    const NOMES_PLANO = { base: "Eciton Base", pro: "Eciton Pro", fabrica: "Eciton Fábrica" };   // os planos da tabela antiga (até a 0.22.0)
    const MIRA_PLANO = { nao: "sem a Mira", mira: "com a Mira", pro: "com a Mira Pro" };
    function precos(t) {
        const r = JSON.parse(JSON.stringify(PRECOS_PADRAO));
        const juntar = (a, b) => { Object.keys(b || {}).forEach(k => {
            if (b[k] && typeof b[k] === "object" && !Array.isArray(b[k]) && a[k] && typeof a[k] === "object" && !Array.isArray(a[k])) juntar(a[k], b[k]);
            else if (b[k] !== undefined && b[k] !== null && b[k] !== "") a[k] = b[k];
        }); };
        if (t && typeof t === "object") juntar(r, t);
        // a tabela antiga (chave solta "atta-g-o": valor; salário e fator de encargos soltos)
        Object.keys(r.atta).forEach(id => { if (Number(t?.[id]) > 0) r.atta[id] = Number(t[id]); });
        if (Number(t?.salario) > 0 && !t?.pessoa?.salario) r.pessoa.salario = Number(t.salario);
        // a tabela antiga: { eciton: { base, pro, fabrica }, plano, miraPro } (preço por Atta por mês)
        if (t && t.eciton && typeof t.eciton === "object" && !Array.isArray(t.planos)) {
            r.planos = Object.entries(t.eciton).filter(([, v]) => Number(v) > 0).map(([id, v]) => ({ id, nome: NOMES_PLANO[id] || id, inclui: "", mira: id === "base" ? "nao" : "mira", fixoMes: 0, porAttaMes: Number(v) }));
            if (t.plano) r.planoPadrao = t.plano;
        }
        delete r.eciton; delete r.plano; delete r.miraPro; delete r.salario; delete r.encargos;
        r.planos = (Array.isArray(r.planos) ? r.planos : []).filter(x => x && x.id).map(x => ({ id: String(x.id), nome: String(x.nome || x.id), inclui: String(x.inclui || ""), mira: ["nao", "mira", "pro"].includes(x.mira) ? x.mira : "nao", fixoMes: Math.max(0, Number(x.fixoMes) || 0), porAttaMes: Math.max(0, Number(x.porAttaMes) || 0) }));
        if (!r.planos.length) r.planos = JSON.parse(JSON.stringify(PRECOS_PADRAO.planos));
        if (!r.planos.some(x => x.id === r.planoPadrao)) r.planoPadrao = r.planos[0].id;
        if (!Array.isArray(r.confirmados)) r.confirmados = [];
        if (!Array.isArray(r.comercial.pagamentoCompra) || !r.comercial.pagamentoCompra.length) r.comercial.pagamentoCompra = JSON.parse(JSON.stringify(PRECOS_PADRAO.comercial.pagamentoCompra));
        ["inclui", "naoInclui"].forEach(k => { if (!Array.isArray(r.comercial[k])) r.comercial[k] = String(r.comercial[k] || "").split(/\n+/).map(x => x.trim()).filter(Boolean); });
        return r;
    }
    // o plano (da tabela) e a mensalidade de uma frota de n Atta
    const planoDe = (pr, id) => pr.planos.find(x => x.id === id) || pr.planos.find(x => x.id === pr.planoPadrao) || pr.planos[0];
    const mensalidade = (plano, n) => (n > 0 ? plano.fixoMes + plano.porAttaMes * n : 0);
    const precoAtta = (pr, modelo) => Number(pr.atta[modelo]) || Number(pr.atta["atta-e-o-serie"]) || 280000;
    // encargos sobre o salário, pela lei, conforme o regime de impostos
    function encargos(pr, regime) {
        const e = pr.pessoa.encargos;
        const simples = regime === "simples";
        const sobreFerias = 1 + e.decimo + e.ferias;   // INSS, RAT, terceiros e FGTS incidem também no 13º e nas férias
        const itens = [
            { nome: "13º salário", pct: e.decimo },
            { nome: "Férias + 1/3", pct: e.ferias },
            simples ? null : { nome: "INSS patronal", pct: e.inss * sobreFerias },
            simples ? null : { nome: "RAT (acidente de trabalho)", pct: e.rat * sobreFerias },
            simples ? null : { nome: "Terceiros (Sistema S, salário-educação, INCRA)", pct: e.terceiros * sobreFerias },
            { nome: "FGTS", pct: e.fgts * sobreFerias },
            { nome: "Reserva de rescisão (multa do FGTS, aviso prévio)", pct: e.rescisao }
        ].filter(Boolean);
        return { itens, total: itens.reduce((s, x) => s + x.pct, 0) };
    }
    // o custo de referência de uma pessoa (quando o cliente não sabe nada da folha)
    const pessoaMes = pr => Math.round((pr.pessoa.salario * (1 + encargos(pr, pr.pessoa.regime).total) + pr.pessoa.beneficios) / 10) * 10;
    const brl0 = v => "R$ " + Math.round(v).toLocaleString("pt-BR");
    const pct0 = v => (Math.round(v * 1000) / 10).toLocaleString("pt-BR") + "%";
    // o custo de uma pessoa por mês: o total do cliente → o salário do cliente com os encargos do regime → a referência da E4M.
    // devolve { custo: num(...), conta: { salario, origemSalario, regime, itens, pctEncargos, encargos, beneficios, origemBeneficios, plr, total } }
    function custoDaPessoa(resp, pr) {
        const regimeCli = lerTexto(resp, "custo", "regime");
        const regime = ["real", "presumido", "simples"].includes(regimeCli) ? regimeCli : pr.pessoa.regime;
        const nomeRegime = { real: "Lucro Real", presumido: "Lucro Presumido", simples: "Simples Nacional" }[regime] || regime;
        const enc = encargos(pr, regime);
        const total = lerNum(resp, "custo", "custoPessoa");
        const sal = lerNum(resp, "custo", "salario");
        const ben = lerNum(resp, "custo", "beneficios");
        const plr = lerNum(resp, "custo", "plr");
        const conta = (salario, origemSalario, beneficios, origemBeneficios, plrAno) => {
            const encR = salario * enc.total;
            return { salario, origemSalario, regime, nomeRegime, origemRegime: regimeCli ? "cliente" : "premissa", itens: enc.itens.map(x => ({ nome: x.nome, pct: x.pct, valor: salario * x.pct })),
                pctEncargos: enc.total, encargos: encR, beneficios, origemBeneficios, plr: plrAno / 12, total: salario + encR + beneficios + plrAno / 12 };
        };
        if (total && Number.isFinite(total.v) && total.v > 0) return { custo: Object.assign({}, total, { nota: total.nota || "custo total informado pelo cliente" }), conta: null };
        const b = ben && Number.isFinite(ben.v) ? ben.v : pr.pessoa.beneficios;
        const oB = ben && Number.isFinite(ben.v) ? "cliente" : "referencia";
        const pl = plr && Number.isFinite(plr.v) ? plr.v : 0;
        if (sal && Number.isFinite(sal.v) && sal.v > 0) {
            const c = conta(sal.v, "cliente", b, oB, pl);
            const lo = conta(sal.min, "cliente", b, oB, pl).total, hi = conta(sal.max, "cliente", b, oB, pl).total;
            return { custo: num(Math.round(c.total), "cliente", `salário ${brl0(sal.v)} + encargos de ${pct0(enc.total)} (${nomeRegime}) + benefícios ${brl0(b)}${pl ? ` + PLR ${brl0(pl / 12)} por mês` : ""}`, Math.round(lo), Math.round(hi)), conta: c };
        }
        const c = conta(pr.pessoa.salario, "referencia", b, oB, pl);
        return { custo: num(Math.round(c.total), "referencia", `${pr.pessoa.fonteSalario || "salário de referência"} (${brl0(pr.pessoa.salario)}) + encargos de ${pct0(enc.total)} (${nomeRegime}) + benefícios ${brl0(b)}`,
            Math.round(c.total * 0.9), Math.round(c.total * 1.3)), conta: c };
    }

    /* ---------------- origem de cada número ---------------- */
    const ORIGENS = {
        cliente: "dado do cliente", diario: "diário de viagens", planilha: "planilha do cliente", simulacao: "simulação",
        estimado: "estimado", referencia: "referência pública", premissa: "premissa de mercado"
    };
    const CONFIRMA = new Set(["cliente", "diario", "planilha", "simulacao"]);
    const num = (v, origem, nota = "", min = v, max = v) => ({ v, min: Math.min(min, max), max: Math.max(min, max), origem, nota });

    // premissas de mercado (todas conservadoras; o fornecedor muda no estudo)
    const PREMISSAS = {
        velocidadePe: [0.9, 0.7, 1.1, "andando com carrinho, caixa ou paleteira, m/s (paleteira manual: 70 m/min menos 20% de manobra, IMAM)"],
        velocidadeEmp: [2.7, 2.0, 3.3, "empilhadeira ou rebocador com operador, m/s (200 m/min menos 20% de manobra, IMAM)"],
        manuseioS: [90, 60, 150, "pegar ou entregar à mão, por ponta, contando procurar, esperar e conferir, s"],
        manuseioEmpS: [60, 40, 90, "pegar ou deixar com a empilhadeira, por ponta, s"],
        pfd: [0.12, 0.10, 0.15, "pausas pessoais, fadiga e esperas no turno (PF&D: pessoal ~5%, fadiga 3% a 5%, espera 2% a 4%)"],
        faltas: [0.04, 0.02, 0.06, "faltas e afastamentos (sem média nacional confiável: premissa)"],
        disponibilidadeAtta: [0.92, 0.88, 0.96, "parte do turno em que o Atta está disponível (recarga e manutenção fora)"],
        coberturaFrota: [0.8, 0.8, 1.0, "parte do transporte que a frota assume (o resto fica com as pessoas: exceções, carga especial)"],
        custoEmpilhadeira: [5500, 4000, 7000, "locação de empilhadeira com manutenção e energia, R$ por mês"],
        reducaoParadas: [0.6, 0.4, 0.8, "paradas por falta de material evitadas com entrega no prazo"],
        reducaoErros: [0.7, 0.5, 0.9, "entregas erradas evitadas (rota e destino fixos, registro de cada entrega)"],
        reducaoAvarias: [0.5, 0.3, 0.7, "avarias evitadas (sem empilhadeira batendo em estrutura e material)"],
        reducaoAcidentes: [0.6, 0.4, 0.8, "acidentes de transporte evitados (menos gente e empilhadeira no corredor)"],
        custoAcidente: [15000, 8000, 30000, "custo para a empresa de um acidente com afastamento (15 dias pagos, reposição, investigação, avarias)"],
        margemMinuto: [0.3, 0.2, 0.4, "parte do faturamento por minuto que é margem perdida na parada"],
        materialPct: [0.45, 0.35, 0.55, "parte do faturamento que é material (para o estoque na linha)"],
        coberturaHoje: [2, 1.5, 4, "horas de material na linha hoje (entregas grandes e espaçadas)"],
        coberturaE4M: [1, 0.75, 1.5, "horas de material na linha com entregas menores e mais frequentes"],
        crescimento: [0.05, 0, 0.10, "crescimento da demanda por ano"],
        custoCapital: [0.15, 0.12, 0.18, "custo de capital ao ano (desconto do VPL)"],
        custoM2: [30, 20, 45, "custo do m² de galpão por mês (aluguel e condomínio)"],
        larguraEmp: [3.5, 3.2, 4, "largura de corredor que a empilhadeira pede, m"],
        larguraAtta: [1.6, 1.4, 1.8, "largura de corredor que o Atta pede, m"],
        kwhHoraAtta: [0.2, 0.15, 0.3, "energia de um Atta por hora disponível, kWh"],
        co2Kwh: [0.05, 0.04, 0.09, "kg de CO₂ por kWh da rede (varia mês a mês)"],
        glpHora: [2.5, 2, 3, "kg de GLP por hora de empilhadeira a gás"],
        co2Glp: [2.95, 2.9, 3.0, "kg de CO₂ por kg de GLP queimado"],
        horasMes: [176, 176, 176, "horas trabalhadas por mês (para a hora extra)"],
        // 0.24: quando a empresa realoca as pessoas em vez de desligar
        valorRealocacao: [0.5, 0.3, 0.8, "parte do custo da pessoa realocada que vira ganho (ela vai para um trabalho que hoje custa ou não é feito); no conservador, zero"]
    };
    // a premissa de fábrica, ou a da E4M (tabela) ou a do estudo, se mudaram
    const premissa = (k, ov) => {
        const [v0, a0, b0, nota] = PREMISSAS[k];
        const o = ov && ov[k];
        if (Array.isArray(o) && Number.isFinite(Number(o[0]))) return num(Number(o[0]), "premissa", nota + " (valor da E4M)", Number(o[1] ?? o[0]), Number(o[2] ?? o[0]));
        return num(v0, "premissa", nota, a0, b0);
    };
    const PESO_PADRAO = { carrinho: 150, caixa: 15, esteira: 30, comboio: 400, palete: 500 };
    const CAPACIDADE = { G: 250, E: 1000, R: 1000, T: 3000 };

    /* ---------------- leitura do questionário ---------------- */
    function lerNum(resp, b, id) {
        const x = resp?.[b]?.[id];
        if (!x) return null;
        if (Q().naoSei(x)) return { naoSei: true };
        const f = Q().faixa(x);
        if (f) return num((f[0] + f[1]) / 2, "cliente", "faixa informada", f[0], f[1]);
        const v0 = Q().valor(x);
        const v = Number(v0);
        if (v0 !== null && v0 !== "" && Number.isFinite(v)) return num(v, "cliente");
        return null;
    }
    const lerTexto = (resp, b, id) => { const v = Q().valor(resp?.[b]?.[id]); return v == null ? "" : String(v); };
    const valorOu = (x, padrao) => (x && Number.isFinite(x.v) ? x : padrao);

    /* ---------------- calendário ---------------- */
    const hhmm = m => { m = ((Math.round(m) % 1440) + 1440) % 1440; return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`; };
    const minDe = s => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || "")); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
    function operacao(resp) {
        const turnos = Math.max(1, Math.min(3, Math.round(lerNum(resp, "operacao", "turnos")?.v || 1)));
        const ht = lerNum(resp, "operacao", "horasTurno");
        const horasTurno = valorOu(ht, num(turnos === 3 ? 8 : 8.8, "premissa", "jornada de 44 h por semana"));
        const dm = lerNum(resp, "operacao", "dias");
        const diasMes = valorOu(dm, num(21, "premissa", "segunda a sexta"));
        const al = lerNum(resp, "operacao", "almoco");
        const almoco = valorOu(al, num(60, "premissa", "uma hora de almoço ou jantar por turno"));
        const ini = minDe(lerTexto(resp, "operacao", "inicio"));
        return { turnos, horasTurno, diasMes, almoco, inicio: ini ?? 360, inicioOrigem: ini == null ? "premissa" : "cliente" };
    }
    function calendarioDoQuestionario(resp) {
        const op = operacao(resp);
        const dias = op.diasMes.v <= 22 ? [1, 2, 3, 4, 5] : op.diasMes.v <= 26 ? [1, 2, 3, 4, 5, 6] : [0, 1, 2, 3, 4, 5, 6];
        const dur = Math.round(Math.min(12, Math.max(1, op.horasTurno.v)) * 60);
        const turnos = [], intervalos = [];
        for (let i = 0; i < op.turnos; i++) {
            const a = op.inicio + i * Math.max(dur, op.turnos === 3 ? 480 : dur);
            turnos.push({ id: "T" + (i + 1), nome: `${i + 1}º turno`, inicio: hhmm(a), fim: hhmm(a + dur), dias });
            if (op.almoco.v > 0) {
                const meio = Math.round((a + dur / 2 - op.almoco.v / 2) / 30) * 30;
                intervalos.push({ id: "I" + (i + 1), nome: i === 0 ? "Almoço" : i === 1 ? "Jantar" : "Intervalo", inicio: hhmm(meio), fim: hhmm(meio + op.almoco.v), dias, acao: "BERCO", postos: [] });
            }
        }
        return { turnos, intervalos, paradas: [] };
    }

    /* ---------------- modelos por carga ---------------- */
    function modeloDoFluxo(f) {
        const peso = Number(f.peso) || PESO_PADRAO[f.carga] || 150;
        if (f.entrega === "milkrun") return "atta-t-o";   // a rota com paradas vai de comboio
        if (f.carga === "esteira") return peso <= CAPACIDADE.R ? "atta-r-o" : "atta-t-o";
        if (f.carga === "comboio") return "atta-t-o";
        if (f.carga === "caixa") return peso <= CAPACIDADE.G ? "atta-g-o" : peso <= CAPACIDADE.E ? "atta-e-o-serie" : "atta-t-o";
        return peso <= CAPACIDADE.E ? "atta-e-o-serie" : "atta-t-o";
    }
    const MODULO = { "atta-g-o": "G", "atta-e-o-serie": "E", "atta-r-o": "R", "atta-t-o": "T" };
    const MODELO_DO_MODULO = { G: "atta-g-o", E: "atta-e-o-serie", R: "atta-r-o", T: "atta-t-o" };
    // 0.23: o motor das baterias (perfil de partida por módulo), no navegador ou no Node
    const BAT = () => (typeof Bateria !== "undefined" ? Bateria : (() => { try { return typeof require === "function" ? require("./bateria.js") : null; } catch (e) { return null; } })());
    const CARGA_ESTACAO = { G: "KIT", E: "CARRINHO", R: "ESTEIRA", T: "COMBOIO" };
    const TEMPOS_CARGA = { caixa: [20, 20], carrinho: [25, 25], esteira: [20, 20], comboio: [60, 60], palete: [30, 30] };
    const ENTREGAS_OK = new Set(["chamada", "troca", "milkrun"]);
    const nomeModelo = id => M()?.porId?.(id)?.nome || { "atta-g-o": "Atta G-O", "atta-e-o-serie": "Atta E-O", "atta-r-o": "Atta R-O", "atta-t-o": "Atta T-O" }[id] || id;

    /* ---------------- sem desenho: posições pelas distâncias (MDS) ---------------- */
    function posicoesPorDistancias(pontos, fluxos, avisos) {
        const n = pontos.length;
        const idx = new Map(pontos.map((p, i) => [p.id, i]));
        const INF = 1e9;
        const D = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, k) => (i === k ? 0 : INF)));
        let algum = false;
        fluxos.forEach(f => {
            const a = idx.get(f.de), b = idx.get(f.para), d = Number(f.distancia);
            if (a == null || b == null || !(d > 0)) return;
            algum = true;
            D[a][b] = D[b][a] = Math.min(D[a][b], d);
        });
        if (!algum) avisos.push("Sem desenho e sem distância nos fluxos: os pontos ficaram a 30 m um do outro (premissa). Peça as distâncias ao cliente.");
        for (let k = 0; k < n; k++) for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) if (D[i][k] + D[k][j] < D[i][j]) D[i][j] = D[i][k] + D[k][j];
        const conhecidos = D.flat().filter(x => x > 0 && x < INF);
        const padrao = conhecidos.length ? Math.max(...conhecidos) : 30;
        for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) if (D[i][j] >= INF) D[i][j] = padrao;
        // MDS clássico: B = -1/2 J D² J, os dois maiores autovetores
        const D2 = D.map(l => l.map(x => x * x));
        const mL = D2.map(l => l.reduce((s, x) => s + x, 0) / n);
        const mT = mL.reduce((s, x) => s + x, 0) / n;
        const B = D2.map((l, i) => l.map((x, j) => -0.5 * (x - mL[i] - mL[j] + mT)));
        const vetores = [];
        for (let e = 0; e < 2; e++) {
            let v = Array.from({ length: n }, (_, i) => Math.sin(i * 1.7 + e + 1));
            let lam = 0;
            for (let it = 0; it < 200; it++) {
                let w = B.map(l => l.reduce((s, x, j) => s + x * v[j], 0));
                vetores.forEach(([u, l]) => { const d = w.reduce((s, x, j) => s + x * u[j], 0); w = w.map((x, j) => x - d * u[j]); });
                const nn = Math.hypot(...w) || 1;
                lam = nn; v = w.map(x => x / nn);
            }
            vetores.push([v, lam]);
        }
        return pontos.map((p, i) => ({ ...p, x: vetores[0][0][i] * Math.sqrt(Math.max(0, vetores[0][1])), y: vetores[1][0][i] * Math.sqrt(Math.max(0, vetores[1][1])) }));
    }

    /* ---------------- paredes do DXF (rotas que não atravessam parede) ---------------- */
    function paredesDoLayout(layout) {
        const d = layout?.tipo === "dxf" ? layout.desenho : null;
        if (!d?.linhas?.length) return [];
        const lista = [];
        d.linhas.forEach(l => {
            if (d.camadas?.[l.c]?.uso !== "paredes") return;
            for (let i = 2; i < l.p.length; i += 2) lista.push([l.p[i - 2], l.p[i - 1], l.p[i], l.p[i + 1]]);
        });
        return lista.slice(0, 40000);
    }
    const cruza = (ax, ay, bx, by, cx, cy, dx, dy) => {
        const o = (px, py, qx, qy, rx, ry) => Math.sign((qx - px) * (ry - py) - (qy - py) * (rx - px));
        return o(ax, ay, bx, by, cx, cy) * o(ax, ay, bx, by, dx, dy) < 0 && o(cx, cy, dx, dy, ax, ay) * o(cx, cy, dx, dy, bx, by) < 0;
    };
    const cruzamentos = (paredes, ax, ay, bx, by) => { let n = 0; for (const w of paredes) if (cruza(ax, ay, bx, by, w[0], w[1], w[2], w[3])) n++; return n; };
    // caminho livre entre dois pontos (A* numa grade de 0,25 m, longe das paredes), já simplificado
    function caminhoLivre(paredes, a, b) {
        const c = 0.25, folga = 0.45;
        const x0 = Math.min(a.x, b.x) - 12, y0 = Math.min(a.y, b.y) - 12, x1 = Math.max(a.x, b.x) + 12, y1 = Math.max(a.y, b.y) + 12;
        const W = Math.ceil((x1 - x0) / c), H = Math.ceil((y1 - y0) / c);
        if (W * H > 400000) return null;
        const bloq = new Uint8Array(W * H);
        const marcar = (x, y) => { const i = Math.floor((x - x0) / c), k = Math.floor((y - y0) / c); const r = Math.ceil(folga / c); for (let di = -r; di <= r; di++) for (let dk = -r; dk <= r; dk++) { const ii = i + di, kk = k + dk; if (ii >= 0 && kk >= 0 && ii < W && kk < H && di * di + dk * dk <= r * r) bloq[kk * W + ii] = 1; } };
        paredes.forEach(w => { if (Math.max(w[0], w[2]) < x0 || Math.min(w[0], w[2]) > x1 || Math.max(w[1], w[3]) < y0 || Math.min(w[1], w[3]) > y1) return; const L = Math.hypot(w[2] - w[0], w[3] - w[1]), n = Math.max(1, Math.ceil(L / (c / 2))); for (let t = 0; t <= n; t++) marcar(w[0] + (w[2] - w[0]) * t / n, w[1] + (w[3] - w[1]) * t / n); });
        const cel = p => [Math.max(0, Math.min(W - 1, Math.floor((p.x - x0) / c))), Math.max(0, Math.min(H - 1, Math.floor((p.y - y0) / c)))];
        const [ai, ak] = cel(a), [bi, bk] = cel(b);
        bloq[ak * W + ai] = 0; bloq[bk * W + bi] = 0;
        const g = new Float64Array(W * H).fill(Infinity), de = new Int32Array(W * H).fill(-1), fechado = new Uint8Array(W * H);
        const h = i => Math.hypot((i % W) - bi, Math.floor(i / W) - bk);
        const heap = [];
        const por = (f, i) => { heap.push([f, i]); for (let k = heap.length - 1; k > 0;) { const pk = (k - 1) >> 1; if (heap[pk][0] <= heap[k][0]) break; [heap[pk], heap[k]] = [heap[k], heap[pk]]; k = pk; } };
        const tirar = () => { const t = heap[0], u = heap.pop(); if (heap.length) { heap[0] = u; for (let k = 0; ;) { const l = 2 * k + 1, r = l + 1; let m = k; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === k) break; [heap[m], heap[k]] = [heap[k], heap[m]]; k = m; } } return t; };
        const ini = ak * W + ai, fim = bk * W + bi;
        g[ini] = 0; por(h(ini), ini);
        let passos = 0;
        while (heap.length && passos++ < 300000) {
            const [, i] = tirar();
            if (fechado[i]) continue;
            fechado[i] = 1;
            if (i === fim) break;
            const x = i % W, y = Math.floor(i / W);
            for (const [dx, dy, cst] of [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.414], [1, -1, 1.414], [-1, 1, 1.414], [-1, -1, 1.414]]) {
                const nx = x + dx, ny = y + dy;
                if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
                const j = ny * W + nx;
                if (bloq[j] || fechado[j]) continue;
                const v = g[i] + cst;
                if (v < g[j]) { g[j] = v; de[j] = i; por(v + h(j), j); }
            }
        }
        if (!Number.isFinite(g[fim])) return null;
        const pts = [];
        for (let i = fim; i >= 0; i = de[i]) pts.push({ x: x0 + ((i % W) + 0.5) * c, y: y0 + (Math.floor(i / W) + 0.5) * c });
        pts.reverse();
        pts[0] = { x: a.x, y: a.y }; pts[pts.length - 1] = { x: b.x, y: b.y };
        // simplifica (Douglas-Peucker) sem passar por parede
        const simpl = (lista, ini, fim, saida) => {
            let m = -1, dm = 0;
            const A = lista[ini], B = lista[fim], L = Math.hypot(B.x - A.x, B.y - A.y) || 1e-9;
            for (let k = ini + 1; k < fim; k++) { const d = Math.abs((B.x - A.x) * (A.y - lista[k].y) - (A.x - lista[k].x) * (B.y - A.y)) / L; if (d > dm) { dm = d; m = k; } }
            if (m > 0 && (dm > 0.3 || cruzamentos(paredes, A.x, A.y, B.x, B.y))) { simpl(lista, ini, m, saida); simpl(lista, m, fim, saida); }
            else saida.push(B);
        };
        const saida = [pts[0]];
        simpl(pts, 0, pts.length - 1, saida);
        return saida;
    }

    /* ---------------- a planta de estudo ---------------- */
    // opcoes: { raio, afastamento, bercos (quantos), bercoPerto (id do ponto), escala }
    const RESERVADO = /^(J\d+|C[NS][OE]|B\d+|S\d+|R\d+)$/;  // ids que a planta de estudo usa
    function plantaDoQuestionario(resp, opcoes = {}) {
        const Pl = P();
        const avisos = [];
        const layout = resp?.layout?.desenho || {};
        const fluxosQ = (resp?.fluxos?.lista || []).filter(f => f && f.de && f.para && f.de !== f.para);
        let pontos = (resp?.pontos?.lista || []).filter(p => p && p.id).map(p => ({ id: String(p.id), nome: String(p.nome || p.id), tipo: p.tipo || "ambos", x: Number(p.x), y: Number(p.y) }));
        // só os pontos que algum fluxo usa (e todos, se não houver fluxo)
        const usados = new Set(fluxosQ.flatMap(f => [f.de, f.para].concat(f.entrega === "milkrun" ? f.paradas || [] : [])));
        if (usados.size) pontos = pontos.filter(p => usados.has(p.id));
        if (pontos.length < 2) return { planta: null, mapa: {}, avisos: ["São precisos pelo menos dois pontos ligados por um fluxo."], semDesenho: true };
        const temCoord = p => Number.isFinite(p.x) && Number.isFinite(p.y);
        const semDesenho = layout.tipo === "nenhum" || !layout.tipo || !pontos.some(temCoord);
        if (semDesenho) {
            pontos = posicoesPorDistancias(pontos, fluxosQ, avisos);
            const esc = Number(opcoes.escala) || 1;
            pontos.forEach(p => { p.x *= esc; p.y *= esc; });
        } else {
            // pontos sem lugar: em fila, acima do desenho
            const L = Number(layout.largura) || 40, A = Number(layout.altura) || 25;
            const soltos = pontos.filter(p => !temCoord(p));
            soltos.forEach((p, i) => { p.x = L * (i + 1) / (soltos.length + 1); p.y = A + 4; });
            if (soltos.length) avisos.push(`${soltos.length} ponto(s) sem lugar na planta ficaram acima do desenho: ${soltos.map(p => p.nome).join(", ")}.`);
        }
        // um ponto em cima do outro: afasta
        for (let i = 0; i < pontos.length; i++) for (let k = i + 1; k < pontos.length; k++) {
            if (Math.hypot(pontos[i].x - pontos[k].x, pontos[i].y - pontos[k].y) < 1.5) { pontos[k].x += 2; avisos.push(`${pontos[k].nome} estava em cima de ${pontos[i].nome}: afastado 2 m.`); }
        }
        // origem com folga (o desenho do cliente começa no 0,0)
        if (semDesenho) {
            const mx = Math.min(...pontos.map(p => p.x)), my = Math.min(...pontos.map(p => p.y));
            pontos.forEach(p => { p.x = Math.round((p.x - mx + 6) * 10) / 10; p.y = Math.round((p.y - my + 6) * 10) / 10; });
        }
        // modelo de cada ponto (pelos fluxos que passam nele)
        const modulosDo = {};
        fluxosQ.forEach(f => { const m = MODULO[modeloDoFluxo(f)]; [f.de, f.para].concat(f.entrega === "milkrun" ? f.paradas || [] : []).forEach(id => { (modulosDo[id] = modulosDo[id] || new Set()).add(m); }); });

        // o anel: o retângulo que deixa os ramais curtos onde passa mais viagem
        // (soma de ramal × viagens + um pouco do perímetro, que todo mundo anda)
        const raio = Number(opcoes.raio) || 1.5, margem = raio + 0.6;
        const xs = pontos.map(p => p.x), ys = pontos.map(p => p.y);
        const peso = {};
        fluxosQ.forEach(f => { const w = f.entrega === "milkrun" ? 60 / Math.max(5, Number(f.ciclo) || 20) : Math.max(0.2, Number(f.quantidade) || 1) * (f.unidade === "dia" ? 0.1 : f.unidade === "turno" ? 0.15 : 1); [f.de, f.para].concat(f.entrega === "milkrun" ? f.paradas || [] : []).forEach(id => { peso[id] = (peso[id] || 0) + w; }); });
        const pesoTotal = pontos.reduce((s, p) => s + (peso[p.id] || 0.2), 0);
        const minL = 10, minA = 5;
        const distRet = (p, x0, y0, x1, y1) => {
            const dentro = p.x > x0 && p.x < x1 && p.y > y0 && p.y < y1;
            if (dentro) return Math.min(p.x - x0, x1 - p.x, p.y - y0, y1 - p.y);
            const dx = Math.max(x0 - p.x, 0, p.x - x1), dy = Math.max(y0 - p.y, 0, p.y - y1);
            return Math.hypot(dx, dy);
        };
        const paredes = paredesDoLayout(layout);
        const custoRet = (x0, y0, x1, y1) => {
            if (x1 - x0 < minL || y1 - y0 < minA) return Infinity;
            // ramal de menos de 1,5 m vira 1,5 m (o ponto não fica em cima do corredor)
            let c = pontos.reduce((s, p) => s + (peso[p.id] || 0.2) * Math.max(1.5, distRet(p, x0, y0, x1, y1)), 0) + pesoTotal * 0.12 * 2 * ((x1 - x0) + (y1 - y0));
            // com o DXF: o corredor que atravessa parede custa muito (cada cruzamento)
            if (paredes.length) c += pesoTotal * 40 * (cruzamentos(paredes, x0, y0, x1, y0) + cruzamentos(paredes, x1, y0, x1, y1) + cruzamentos(paredes, x1, y1, x0, y1) + cruzamentos(paredes, x0, y1, x0, y0));
            return c;
        };
        const candX = [...new Set(xs.flatMap(x => [x - 3, x, x + 3]).map(v => Math.round(v * 2) / 2))].sort((a, b) => a - b);
        const candY = [...new Set(ys.flatMap(y => [y - 3, y, y + 3]).map(v => Math.round(v * 2) / 2))].sort((a, b) => a - b);
        const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
        let x0 = Math.min(cx - minL / 2, Math.min(...xs) + 3), x1 = Math.max(cx + minL / 2, Math.max(...xs) - 3);
        let y0 = Math.min(cy - minA / 2, Math.min(...ys) + 3), y1 = Math.max(cy + minA / 2, Math.max(...ys) - 3);
        if (x1 - x0 < minL) { x0 = cx - minL / 2; x1 = cx + minL / 2; }
        if (y1 - y0 < minA) { y0 = cy - minA / 2; y1 = cy + minA / 2; }
        for (let volta = 0; volta < 4; volta++) {
            candX.forEach(v => { if (custoRet(v, y0, x1, y1) < custoRet(x0, y0, x1, y1)) x0 = v; });
            candX.forEach(v => { if (custoRet(x0, y0, v, y1) < custoRet(x0, y0, x1, y1)) x1 = v; });
            candY.forEach(v => { if (custoRet(x0, v, x1, y1) < custoRet(x0, y0, x1, y1)) y0 = v; });
            candY.forEach(v => { if (custoRet(x0, y0, x1, v) < custoRet(x0, y0, x1, y1)) y1 = v; });
        }
        // o desenho começa no 0,0: o anel não sai dele
        if (!semDesenho && Number(layout.largura) > 0) { x0 = Math.max(1.5, x0); x1 = Math.min(Number(layout.largura) - 1.5, x1); if (x1 - x0 < minL) x1 = x0 + minL; }
        if (!semDesenho && Number(layout.altura) > 0) { y0 = Math.max(1.5, y0); y1 = Math.min(Number(layout.altura) - 1.5, y1); if (y1 - y0 < minA) y1 = y0 + minA; }
        const r1 = v => Math.round(v * 10) / 10;
        x0 = r1(x0); x1 = r1(x1); y0 = r1(y0); y1 = r1(y1);
        // lados no sentido anti-horário: sul (oeste→leste), leste (sul→norte), norte (leste→oeste), oeste (norte→sul)
        const LADOS = [
            { id: "S", a: [x0, y0], b: [x1, y0], fora: [0, -1] }, { id: "L", a: [x1, y0], b: [x1, y1], fora: [1, 0] },
            { id: "N", a: [x1, y1], b: [x0, y1], fora: [0, 1] }, { id: "O", a: [x0, y1], b: [x0, y0], fora: [-1, 0] }
        ];
        const projetar = (lado, p) => {
            const [ax, ay] = lado.a, [bx, by] = lado.b;
            const L = Math.hypot(bx - ax, by - ay), ux = (bx - ax) / L, uy = (by - ay) / L;
            const t = Math.max(margem, Math.min(L - margem, (p.x - ax) * ux + (p.y - ay) * uy));
            const x = ax + ux * t, y = ay + uy * t;
            return { t, x, y, d: Math.hypot(p.x - x, p.y - y) };
        };
        const ligacoes = pontos.map(p => {
            let melhor = null;
            LADOS.forEach(l => { const pr = projetar(l, p); if (!melhor || pr.d < melhor.d) melhor = Object.assign({ lado: l }, pr); });
            // 0.24: um ponto em que o comboio para fica no próprio corredor (o rebocador carregado não gira nem entra em ramal);
            // os outros módulos que usam o mesmo ponto param ali também
            const temT = modulosDo[p.id] && [...modulosDo[p.id]].some(m => m === "T");
            const soT = temT && [...modulosDo[p.id]].every(m => m === "T");
            return { p, ...melhor, emLinha: temT, soT };
        });
        // as junções de cada lado, em ordem; perto demais (1,2 m) viram uma só
        const nos = [], segs = [], estacoes = [];
        let tag = 0x200;
        const rfid = () => "0E" + (tag++).toString(16).toUpperCase().padStart(8, "0");
        const no = (id, x, y, tipo = "REFERENCIA", extra = {}) => { const n = Object.assign({ id, tipo, nome: "", x: r1(x), y: r1(y), rfid: rfid(), orientacaoChegada: null, barreira: 0 }, extra); nos.push(n); return n; };
        let ns = 0;
        const seg = (a, b, sentido = "A_PARA_B") => segs.push({ id: "S" + String(++ns).padStart(2, "0"), tipo: "LINHA", a, b, sentido, velocidadeMaxima: 0, barreira: 0, tags: [] });
        const mapa = {};
        const idLivre = base => { let id = String(base).toUpperCase().replace(/[^A-Z0-9_-]/g, "").slice(0, 10) || "P"; if (RESERVADO.test(id)) id = "P" + id.slice(0, 9); let k = 2, cand = id; while (nos.some(n => n.id === cand)) cand = (id.slice(0, 8) + k++); return cand; };
        const cantos = { S: no("CSO", x0, y0), L: no("CSE", x1, y0), N: no("CNE", x1, y1), O: no("CNO", x0, y1) };
        let nj = 0, nr = 0, desviados = 0;
        const juncoesDo = {};
        LADOS.forEach(l => {
            const deste = ligacoes.filter(x => x.lado === l).sort((a, b) => a.t - b.t);
            const grupos = [];
            deste.forEach(x => { const g = grupos[grupos.length - 1]; if (g && x.t - g.t <= 1.2 && !x.emLinha && !g.emLinha) { g.membros.push(x); } else grupos.push({ t: x.t, membros: [x], emLinha: x.emLinha }); });
            juncoesDo[l.id] = grupos;
        });
        // berços: no maior vão (ou perto do ponto pedido)
        const nBercos = Math.max(1, Math.min(4, Number(opcoes.bercos) || 2));
        const vaos = [];
        LADOS.forEach(l => {
            const L = Math.hypot(l.b[0] - l.a[0], l.b[1] - l.a[1]);
            const ts = [margem - 0.6].concat(juncoesDo[l.id].map(g => g.t), [L - margem + 0.6]);
            for (let i = 1; i < ts.length; i++) if (ts[i] - ts[i - 1] >= 3.5) vaos.push({ lado: l, t: (ts[i] + ts[i - 1]) / 2, tam: ts[i] - ts[i - 1] });
        });
        const perto = opcoes.bercoPerto ? ligacoes.find(x => x.p.id === opcoes.bercoPerto) : null;
        const escolhidos = [];
        if (perto) {
            const L = Math.hypot(perto.lado.b[0] - perto.lado.a[0], perto.lado.b[1] - perto.lado.a[1]);
            const t = perto.t - 2.5 >= margem ? perto.t - 2.5 : Math.min(L - margem, perto.t + 2.5);
            escolhidos.push({ lado: perto.lado, t, perto: true });
        }
        vaos.sort((a, b) => b.tam - a.tam).forEach(v => { if (escolhidos.length < nBercos + (perto ? 1 : 0) && !escolhidos.some(e => e.lado === v.lado && Math.abs(e.t - v.t) < 3)) escolhidos.push(v); });
        escolhidos.forEach(e => juncoesDo[e.lado.id].push({ t: e.t, membros: [], berco: true }));
        // monta os lados
        LADOS.forEach((l, i) => {
            const L = Math.hypot(l.b[0] - l.a[0], l.b[1] - l.a[1]), ux = (l.b[0] - l.a[0]) / L, uy = (l.b[1] - l.a[1]) / L;
            const grupos = juncoesDo[l.id].sort((a, b) => a.t - b.t);
            // 0.24: duas paradas no mesmo ponto do corredor (projetadas no mesmo lugar) ficam a 1,6 m uma da outra
            const tDe = g => (g.membros.length ? g.membros.reduce((s2, x) => s2 + x.t, 0) / g.membros.length : g.t);
            for (let k = 1; k < grupos.length; k++) {
                const a0 = tDe(grupos[k - 1]), a1 = tDe(grupos[k]);
                if (a1 - a0 < 1.6) { const novo = Math.min(L - 0.4, a0 + 1.6); grupos[k].t = novo; grupos[k].membros.forEach(x => { x.t = novo; }); }
            }
            let anterior = cantos[l.id].id;
            grupos.forEach(g => {
                const t = g.membros.length ? g.membros.reduce((s, x) => s + x.t, 0) / g.membros.length : g.t;
                const x = l.a[0] + ux * t, y = l.a[1] + uy * t;
                let j;
                if (g.emLinha) {
                    // parada do comboio no próprio corredor (o rebocador carregado não entra em ramal)
                    const m = g.membros[0];
                    const id = idLivre(m.p.id);
                    j = no(id, x, y, "ESTACAO", { estacao: id, orientacaoChegada: Pl.anguloEntre({ x: l.a[0], y: l.a[1] }, { x: l.b[0], y: l.b[1] }) });
                    estacoes.push({ id, nome: m.p.nome, carga: m.soT ? "COMBOIO" : "" });
                    mapa[m.p.id] = id;
                    avisos.push(`${m.p.nome}: parada do comboio no próprio corredor${m.soT ? "" : " (os outros Atta param ali também)"}.`);
                } else j = no("J" + String(++nj).padStart(2, "0"), x, y);
                seg(anterior, j.id);
                anterior = j.id;
                if (g.berco) {
                    const nb = nos.filter(n => n.tipo === "BERCO").length + 1;
                    const b = no("B" + String(nb).padStart(2, "0"), x + l.fora[0] * 2.5, y + l.fora[1] * 2.5, "BERCO", { nome: `Berço ${nb}`, orientacaoChegada: Pl.anguloEntre({ x, y }, { x: x + l.fora[0], y: y + l.fora[1] }) });
                    seg(j.id, b.id, "DUPLO");
                }
                if (!g.emLinha) g.membros.forEach(m => {
                    let px = m.p.x, py = m.p.y;
                    let d = Math.hypot(px - x, py - y);
                    if (d < 1.2) {
                        // em cima do corredor: o ramal sai para o lado de fora (ou para o lado em que ele está)
                        const lado = (px - x) * l.fora[0] + (py - y) * l.fora[1] < -0.05 ? -1 : 1;
                        px = x + l.fora[0] * 1.5 * lado; py = y + l.fora[1] * 1.5 * lado; d = 1.5;
                    }
                    const id = idLivre(m.p.id);
                    const mods = [...(modulosDo[m.p.id] || [])];
                    const carga = mods.length === 1 && CARGA_ESTACAO[mods[0]] !== "COMBOIO" ? CARGA_ESTACAO[mods[0]] : "";
                    estacoes.push({ id, nome: m.p.nome, carga });
                    // o ramal que atravessaria parede contorna (caminho livre no desenho)
                    let via = null;
                    if (paredes.length && cruzamentos(paredes, x, y, px, py)) {
                        via = caminhoLivre(paredes, { x, y }, { x: px, y: py });
                        if (via && via.length > 2) desviados++;
                        else { via = null; avisos.push(`${m.p.nome}: o ramal atravessa uma parede do desenho e não achei passagem; ajuste no editor.`); }
                    }
                    const ultimo = via ? via[via.length - 2] : { x, y };
                    no(id, px, py, "ESTACAO", { estacao: id, nome: "", orientacaoChegada: Pl.anguloEntre(ultimo, { x: px, y: py }) });
                    let ant = j.id;
                    (via || []).slice(1, -1).forEach(v => { const r = no("R" + String(++nr).padStart(2, "0"), v.x, v.y); seg(ant, r.id, "DUPLO"); ant = r.id; });
                    seg(ant, id, "DUPLO");
                    mapa[m.p.id] = id;
                    if (d > 25) avisos.push(`${m.p.nome} fica a ${Math.round(d)} m do corredor de estudo: confira na planta (talvez precise de outro corredor).`);
                });
            });
            seg(anterior, cantos[LADOS[(i + 1) % 4].id].id);
        });
        const p = Pl.criarVazia(opcoes.nome || "Planta de estudo");
        const W = Math.max(...nos.map(n => n.x), Number(layout.largura) || 0) + 4, A = Math.max(...nos.map(n => n.y), Number(layout.altura) || 0) + 4;
        p.dimensoes = { largura: Math.ceil(W), altura: Math.ceil(A) };
        p.grade = 1;
        p.nos = nos; p.segmentos = segs; p.estacoes = estacoes;
        if (layout.tipo === "dxf" && layout.desenho) p.desenho = Pl.normalizarDesenho(Object.assign({}, layout.desenho, { x: 0, y: 0, rotacao: 0, escala: 1 }));
        if (layout.tipo === "imagem" && layout.imagem) p.fundo = { imagem: layout.imagem, x: 0, y: 0, largura: Number(layout.largura) || 60, altura: Number(layout.altura) || 40, opacidade: 0.5 };
        p.layout = [{ id: "L01", tipo: "CORREDOR", nome: "Corredor de estudo", x: r1((x0 + x1) / 2), y: r1(y0), largura: r1(x1 - x0 + 2), profundidade: 2, rotacao: 0 },
            { id: "L02", tipo: "CORREDOR", nome: "", x: r1((x0 + x1) / 2), y: r1(y1), largura: r1(x1 - x0 + 2), profundidade: 2, rotacao: 0 },
            { id: "L03", tipo: "CORREDOR", nome: "", x: r1(x0), y: r1((y0 + y1) / 2), largura: 2, profundidade: r1(y1 - y0 - 2), rotacao: 0 },
            { id: "L04", tipo: "CORREDOR", nome: "", x: r1(x1), y: r1((y0 + y1) / 2), largura: 2, profundidade: r1(y1 - y0 - 2), rotacao: 0 }];
        ["CSO", "CSE", "CNE", "CNO"].forEach(c => { const r = Pl.criarCurvaConcordancia(p, c, raio); if (r && r.sucesso === false) avisos.push(`Curva em ${c}: ${r.erro}`); });
        if (paredes.length) {
            const lados = cruzamentos(paredes, x0, y0, x1, y0) + cruzamentos(paredes, x1, y0, x1, y1) + cruzamentos(paredes, x1, y1, x0, y1) + cruzamentos(paredes, x0, y1, x0, y0);
            if (lados) avisos.push(`O corredor de estudo cruza ${lados} parede(s) do desenho (não coube um anel sem cruzar): no editor, desvie o corredor por uma porta ou portão.`);
            if (desviados) avisos.push(`${desviados} ramal(is) contornam paredes do desenho.`);
        }
        p.nos.forEach(n => { if (!n.rfid) n.rfid = rfid(); });
        const pronta = Pl.normalizar(p);
        pronta.revisao = 1;
        pronta.estudo = { gerada: VERSAO, semDesenho, anel: { x0, y0, x1, y1 } };
        return { planta: pronta, mapa, avisos, semDesenho };
    }

    /* ---------------- fluxos, missões e postos ---------------- */
    function porHoraDe(f, op) {
        const q = Number(f.quantidade) || 0;
        if (f.unidade === "turno") return q / Math.max(1, op.horasTurno.v - op.almoco.v / 60);
        if (f.unidade === "dia") return q / Math.max(1, op.turnos * (op.horasTurno.v - op.almoco.v / 60));
        return q;
    }
    function fluxosDoQuestionario(resp, mapa) {
        const op = operacao(resp);
        const nomes = Object.fromEntries((resp?.pontos?.lista || []).map(p => [p.id, p.nome || p.id]));
        const fluxos = [], missoes = [];
        (resp?.fluxos?.lista || []).forEach((f, i) => {
            if (!f || !f.de || !f.para || f.de === f.para || !(Number(f.quantidade) > 0 || (f.entrega === "milkrun" && Number(f.ciclo) > 0))) return;
            const de = mapa[f.de], para = mapa[f.para];
            if (!de || !para) return;
            const entrega = ENTREGAS_OK.has(f.entrega) ? f.entrega : "chamada";
            const modelo = modeloDoFluxo(Object.assign({}, f, { entrega }));
            const [pg, en] = entrega === "milkrun" ? TEMPOS_CARGA.comboio : TEMPOS_CARGA[f.carga] || [25, 25];
            const id = "Q" + String(i + 1).padStart(2, "0");
            // milk run: as paradas depois da primeira (pontos do questionário que existem na planta)
            const paradas = entrega === "milkrun" ? (Array.isArray(f.paradas) ? f.paradas : []).map(x => mapa[x]).filter(x => x && x !== de && x !== para) : [];
            const nomeRota = entrega === "milkrun" ? `Milk run ${nomes[f.de]} → ${[f.para].concat((f.paradas || []).filter(x => mapa[x])).map(x => nomes[x] || x).join(", ")}` : `${nomes[f.de]} → ${nomes[f.para]}`;
            const nome = `${nomeRota}${f.oque ? " · " + String(f.oque).slice(0, 30) : ""}`.slice(0, 60);
            const mid = "M" + String(i + 1).padStart(2, "0");
            const fx = { de, para, paradas, entrega };
            missoes.push({ id: mid, nome: nome.slice(0, 80), prioridade: 1, etapas: E() ? E().etapasDaEntrega(fx) : [{ tipo: "IR_PARA", destino: de }, { tipo: "CARREGAR" }, { tipo: "IR_PARA", destino: para }, { tipo: "DESCARREGAR" }] });
            // a planilha de movimentações traz os horários do dia mais cheio
            const horarios = Array.isArray(f.horarios) ? f.horarios.filter(h => /^\d{2}:\d{2}$/.test(h)) : [];
            const ciclo = Number(f.ciclo) > 0 ? Number(f.ciclo) : Number(f.quantidade) > 0 && entrega === "milkrun" ? Math.round(60 / Math.max(0.2, porHoraDe(f, op))) : 20;
            const demanda = entrega === "milkrun" ? { tipo: "ciclo", cicloMin: ciclo }
                : horarios.length >= 3 ? { tipo: "horarios", horarios: horarios.slice(0, 2000) } : { tipo: "porHora", porHora: Math.round(porHoraDe(f, op) * 100) / 100 };
            const fonte = ["diario", "planilha", "mira"].includes(f.fonte) ? f.fonte : f.modelo ? "setor" : "cliente";
            // 0.24: prazo do cliente → (milk run) o ciclo → o de partida da carga (o estoque que costuma ficar na linha)
            const prazo = Number(f.prazo) > 0 ? Number(f.prazo) : entrega === "milkrun" ? ciclo : PRAZO_CARGA[f.carga] || 15;
            fluxos.push({
                id, nome, missao: mid, de, para, paradas, entrega, modelos: [modelo], demanda,
                pegarS: pg, entregarS: en, prazoMin: prazo, prazoOrigem: Number(f.prazo) > 0 ? "cliente" : entrega === "milkrun" ? "cliente" : "premissa",
                prioridade: 1, ativo: true, origem: { cliente: "questionário", diario: "diário", planilha: "planilha", mira: "Mira Pro", setor: "modelo do setor" }[fonte],
                q: { de: f.de, para: f.para, carga: entrega === "milkrun" ? (f.carga === "comboio" ? "carrinho" : f.carga || "carrinho") : f.carga || "carrinho", peso: Number(f.peso) || null, hoje: f.hoje || (entrega === "milkrun" ? "rebocador" : "pe"), distancia: Number(f.distancia) || null, quantidade: Number(f.quantidade), unidade: f.unidade || "hora",
                    entrega, paradas: (f.paradas || []).slice(), ciclo: entrega === "milkrun" ? ciclo : null,
                    tempoHoje: Number(f.tempoHoje) > 0 ? Number(f.tempoHoje) : null, minutosHoje: Number(f.minutosHoje) > 0 ? Number(f.minutosHoje) : null,
                    fonte: { cliente: "cliente", diario: "diario", planilha: "planilha", mira: "estimado", setor: "premissa" }[fonte] }
            });
        });
        return { fluxos, missoes };
    }
    // os postos da empresa nova (converter em empresa): um por ponto de entrega
    function postosDosFluxos(fluxos, planta, resp) {
        const nomes = Object.fromEntries((resp?.pontos?.lista || []).map(p => [p.id, p.nome || p.id]));
        const porPonto = {};
        fluxos.forEach(f => { (porPonto[f.para] = porPonto[f.para] || []).push(f); });
        let n = 0;
        return Object.entries(porPonto).map(([ponto, fl]) => ({
            id: "P" + String(++n).padStart(2, "0"), nome: String(nomes[fl[0].q?.para] || ponto).slice(0, 60), ponto, permiteUrgente: true, usuarios: [],
            botoes: fl.slice(0, 6).map(f => ({ rotulo: ("Pedir " + (f.nome.split(" · ")[1] || "material")).slice(0, 30), missao: f.missao }))
        }));
    }

    /* ---------------- diário de viagens e planilha ---------------- */
    // viagens: [{ de, para, saiu_em, chegou_em }] (ids dos pontos do questionário)
    function resumoDiario(viagens, op) {
        const porPar = {};
        const dias = new Set();
        (viagens || []).forEach(v => {
            const t0 = Date.parse(v.saiu_em), t1 = Date.parse(v.chegou_em);
            if (!v.de || !v.para || !Number.isFinite(t0) || !(t1 > t0)) return;
            dias.add(new Date(t0 - 3 * 3600000).toISOString().slice(0, 10));
            const k = v.de + "→" + v.para;
            const r = porPar[k] = porPar[k] || { de: v.de, para: v.para, n: 0, soma: 0 };
            r.n++; r.soma += (t1 - t0) / 1000;
        });
        const nd = Math.max(1, dias.size);
        const horasDia = op.turnos * Math.max(1, op.horasTurno.v - op.almoco.v / 60);
        return { dias: dias.size, total: (viagens || []).length, pares: Object.values(porPar).map(r => ({ de: r.de, para: r.para, porDia: r.n / nd, porHora: r.n / nd / horasDia, minutos: r.soma / r.n / 60 })) };
    }
    // a planilha de movimentações: [[cabeçalho...], [linha...]] → [{ de, para, quando, qtd }]
    function lerPlanilha(linhas) {
        if (!Array.isArray(linhas) || linhas.length < 2) throw new Error("A planilha está vazia.");
        const sem = t => String(t ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
        const cab = linhas[0].map(sem);
        const achar = re => cab.findIndex(c => re.test(c));
        const iDe = achar(/^(de|origem|from|saida|local de origem|origem.*)$/), iPara = achar(/^(para|destino|to|chegada|local de destino|destino.*)$/);
        const iQuando = achar(/(data.?hora|hora|horario|data|quando|time|timestamp)/), iQtd = achar(/^(qtd|quantidade|qtde|viagens|n|numero)$/);
        if (iDe < 0 || iPara < 0) throw new Error("Não achei as colunas de origem e destino (use \"de\" e \"para\", ou \"origem\" e \"destino\").");
        const lista = [];
        linhas.slice(1).forEach(l => {
            const de = String(l[iDe] ?? "").trim(), para = String(l[iPara] ?? "").trim();
            if (!de || !para || de === para) return;
            let quando = iQuando >= 0 ? l[iQuando] : null;
            if (typeof quando === "number" && quando > 20000) quando = new Date(Math.round((quando - 25569) * 86400000)).toISOString().slice(0, 16);   // data do Excel
            else if (typeof quando === "number" && quando < 1) { const m = Math.round(quando * 1440); quando = hhmm(m); }
            lista.push({ de, para, quando: quando == null ? "" : String(quando), qtd: iQtd >= 0 ? Math.max(1, Number(String(l[iQtd]).replace(",", ".")) || 1) : 1 });
        });
        if (!lista.length) throw new Error("Nenhuma movimentação com origem e destino.");
        return lista;
    }
    // movimentações → por par: viagens por dia e os horários (para a demanda "horários fixos" do dia mais cheio)
    function resumoPlanilha(movs) {
        const dias = new Map();
        const porPar = {};
        movs.forEach(m => {
            const mt = /(\d{4}-\d{2}-\d{2})?[T\s]*(\d{1,2}):(\d{2})/.exec(m.quando || "");
            const br = /(\d{2})\/(\d{2})\/(\d{4})/.exec(m.quando || "");
            const dia = mt?.[1] || (br ? `${br[3]}-${br[2]}-${br[1]}` : "dia");
            const hora = mt ? `${String(mt[2]).padStart(2, "0")}:${mt[3]}` : "";
            const k = m.de + "→" + m.para;
            const r = porPar[k] = porPar[k] || { de: m.de, para: m.para, total: 0, porDia: {} };
            r.total += m.qtd;
            const d = r.porDia[dia] = r.porDia[dia] || [];
            for (let i = 0; i < m.qtd; i++) d.push(hora);
            dias.set(dia, (dias.get(dia) || 0) + m.qtd);
        });
        const cheio = [...dias.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
        return { dias: dias.size, diaMaisCheio: cheio, pares: Object.values(porPar).map(r => ({ de: r.de, para: r.para, porDia: r.total / Math.max(1, dias.size), horarios: (r.porDia[cheio] || []).filter(Boolean).sort() })) };
    }

    /* ---------------- modelos por setor (fluxos típicos para começar) ---------------- */
    const P_ = (id, nome, tipo = "ambos") => ({ id, nome, tipo, x: null, y: null });
    const F_ = (de, para, oque, carga, peso, quantidade, unidade, prazo) => ({ de, para, oque, carga, peso, quantidade, unidade, prazo, hoje: carga === "palete" ? "empilhadeira" : "pe" });
    const SETORES = {
        automotivo: { nome: "Automotivo e autopeças", pontos: [P_("SUPER", "Supermercado", "coleta"), P_("L1", "Linha 1"), P_("L2", "Linha 2"), P_("SEQ", "Sequenciamento", "coleta"), P_("EXP", "Expedição", "entrega")],
            fluxos: [F_("SUPER", "L1", "kit de peças", "caixa", 12, 6, "hora", 15), F_("SUPER", "L2", "kit de peças", "caixa", 12, 6, "hora", 15), F_("SEQ", "L1", "carrinho sequenciado", "carrinho", 180, 3, "hora", 10), F_("L1", "EXP", "produto acabado", "carrinho", 250, 2, "hora", 30)] },
        metalurgia: { nome: "Metalurgia e máquinas", pontos: [P_("ALMOX", "Almoxarifado", "coleta"), P_("PRENSA", "Prensas"), P_("SOLDA", "Solda"), P_("MONT", "Montagem"), P_("EXP", "Expedição", "entrega")],
            fluxos: [F_("ALMOX", "PRENSA", "blanks", "carrinho", 300, 3, "hora", 20), F_("PRENSA", "SOLDA", "peças estampadas", "carrinho", 250, 3, "hora", 20), F_("SOLDA", "MONT", "conjuntos", "carrinho", 200, 2, "hora", 20), F_("MONT", "EXP", "produto acabado", "carrinho", 300, 2, "hora", 30)] },
        alimentos: { nome: "Alimentos e bebidas", pontos: [P_("INSUMOS", "Insumos", "coleta"), P_("PROD", "Produção"), P_("EMB", "Embalagem"), P_("PALET", "Paletização"), P_("EXP", "Expedição", "entrega")],
            fluxos: [F_("INSUMOS", "PROD", "insumos", "carrinho", 200, 3, "hora", 20), F_("PROD", "EMB", "produto a granel", "carrinho", 250, 4, "hora", 15), F_("EMB", "PALET", "caixas", "esteira", 40, 8, "hora", 10), F_("PALET", "EXP", "palete", "palete", 700, 3, "hora", 30)] },
        logistica: { nome: "Centro de distribuição", pontos: [P_("REC", "Recebimento", "coleta"), P_("ARM", "Armazenagem"), P_("PICK", "Picking"), P_("CONF", "Conferência"), P_("EXP", "Expedição", "entrega")],
            fluxos: [F_("REC", "ARM", "palete recebido", "palete", 600, 6, "hora", 30), F_("ARM", "PICK", "reposição", "palete", 500, 4, "hora", 20), F_("PICK", "CONF", "pedido separado", "carrinho", 120, 12, "hora", 15), F_("CONF", "EXP", "pedido conferido", "carrinho", 120, 12, "hora", 15)] },
        hospital: { nome: "Hospital", pontos: [P_("FARM", "Farmácia", "coleta"), P_("ROUP", "Rouparia", "coleta"), P_("COZ", "Cozinha", "coleta"), P_("ALA1", "Ala 1", "entrega"), P_("ALA2", "Ala 2", "entrega"), P_("CME", "CME")],
            fluxos: [F_("FARM", "ALA1", "medicamentos", "caixa", 8, 2, "hora", 30), F_("FARM", "ALA2", "medicamentos", "caixa", 8, 2, "hora", 30), F_("ROUP", "ALA1", "enxoval", "carrinho", 80, 4, "dia", 120), F_("COZ", "ALA1", "refeições", "carrinho", 120, 3, "dia", 20), F_("CME", "ALA2", "material esterilizado", "carrinho", 60, 6, "dia", 60)] },
        hotel: { nome: "Hotel", pontos: [P_("LAV", "Lavanderia", "coleta"), P_("COZ", "Cozinha", "coleta"), P_("AND1", "Andar 1", "entrega"), P_("AND2", "Andar 2", "entrega")],
            fluxos: [F_("LAV", "AND1", "enxoval", "carrinho", 80, 6, "dia", 120), F_("LAV", "AND2", "enxoval", "carrinho", 80, 6, "dia", 120), F_("COZ", "AND1", "room service", "caixa", 10, 2, "hora", 20)] }
    };
    // junta o modelo do setor nas respostas: só o que falta (não mexe no que o cliente respondeu)
    function aplicarSetor(resp, setor) {
        const s = SETORES[setor];
        if (!s) return { respostas: resp, novos: 0 };
        const r = JSON.parse(JSON.stringify(resp || {}));
        r.pontos = r.pontos || {}; r.pontos.lista = r.pontos.lista || [];
        r.fluxos = r.fluxos || {}; r.fluxos.lista = r.fluxos.lista || [];
        let novos = 0;
        s.pontos.forEach(p => { if (!r.pontos.lista.some(x => x.id === p.id || Q().idPonto(x.nome) === p.id)) { r.pontos.lista.push(Object.assign({}, p, { modelo: setor })); novos++; } });
        const id = x => r.pontos.lista.find(p => p.id === x || Q().idPonto(p.nome) === x)?.id || x;
        s.fluxos.forEach(f => { const de = id(f.de), para = id(f.para); if (!r.fluxos.lista.some(x => x.de === de && x.para === para)) { r.fluxos.lista.push(Object.assign({}, f, { de, para, modelo: setor })); novos++; } });
        return { respostas: r, novos };
    }

    /* ---------------- quando falta resposta ---------------- */
    // o tempo de uma entrega feita por gente hoje (ida e volta, pegar, esperar, entregar), em minutos, nos três lados
    // ordem: o tempo que o cliente informou → o diário (ida × 2) → a conta pela distância
    const comVeiculo = f => f.q?.hoje === "empilhadeira" || f.q?.hoje === "rebocador";
    function tempoManual(f, R) {
        const emp = comVeiculo(f);
        if (f.q?.tempoHoje > 0) { const t = f.q.tempoHoje; return { v: t, min: t * 0.9, max: t * 1.1, origem: "cliente", como: "informado pelo cliente" }; }
        if (f.q?.minutosHoje > 0) { const t = f.q.minutosHoje * 2; return { v: t, min: t * 0.9, max: t * 1.1, origem: "diario", como: "diário de viagens (ida × 2)" }; }
        const vel = emp ? R.velocidadeEmp : R.velocidadePe, mao = emp ? R.manuseioEmpS : R.manuseioS;
        const veic = f.q?.hoje === "rebocador" ? "de rebocador" : emp ? "de empilhadeira" : "a pé";
        if (f.entrega === "milkrun") {
            // a volta inteira da rota (o motorista do rebocador hoje): o caminho + deixar e pegar em cada parada
            const d = f.metros || f.distPessoa || 200, np = 1 + (f.paradas || []).length;
            const t = (v, m) => (d / v + (2 * np + 2) * m) / 60;
            return { v: t(vel.v, mao.v), min: t(vel.max, mao.min), max: t(vel.min, mao.max), origem: "estimado", como: `${Math.round(d)} m de rota ${veic}, ${np} parada${np > 1 ? "s" : ""}, ${Math.round(mao.v)} s para deixar e pegar em cada uma` };
        }
        const d = f.distPessoa || 30;
        const pontas = f.entrega === "troca" ? 4 : 2;   // troca: deixa o cheio e traz o vazio
        const t = (v, m) => (2 * d / v + pontas * m) / 60;
        return { v: t(vel.v, mao.v), min: t(vel.max, mao.min), max: t(vel.min, mao.max), origem: "estimado", como: `${Math.round(d)} m ida e volta ${veic} + ${Math.round(mao.v)} s em cada ponta${pontas > 2 ? " (leva o cheio e traz o vazio)" : ""}` };
    }
    // ctx: { fluxos (com viagensDia e metros), op, precos, premissasNegocio }
    function resolver(resp, ctx) {
        const pr = precos(ctx.precos);
        const op = ctx.op || operacao(resp);
        const ov = Object.assign({}, pr.premissas || {}, ctx.premissasNegocio || {});
        const R = {};
        const fluxos = ctx.fluxos || [];
        R.turnos = num(op.turnos, "cliente");
        R.horasTurno = op.horasTurno; R.diasMes = op.diasMes; R.almoco = op.almoco;
        ["velocidadePe", "velocidadeEmp", "manuseioS", "manuseioEmpS", "pfd", "faltas", "disponibilidadeAtta", "coberturaFrota", "reducaoParadas", "reducaoErros", "reducaoAvarias", "reducaoAcidentes",
            "margemMinuto", "materialPct", "coberturaHoje", "coberturaE4M", "custoM2", "larguraEmp", "larguraAtta", "kwhHoraAtta", "co2Kwh", "glpHora", "co2Glp", "horasMes", "valorRealocacao"].forEach(k => { R[k] = premissa(k, ov); });
        // as horas que uma pessoa de fato transporta num turno: tira o intervalo, as pausas e a fadiga (PF&D) e as faltas
        const horasTrab = Math.max(1, op.horasTurno.v - op.almoco.v / 60);
        const prod = (pfd, fal) => horasTrab * (1 - pfd) * (1 - fal);
        R.horasPessoa = num(prod(R.pfd.v, R.faltas.v), "estimado", `${String(Math.round(horasTrab * 10) / 10).replace(".", ",")} h de turno sem o intervalo, menos ${Math.round(R.pfd.v * 100)}% de pausas e fadiga e ${Math.round(R.faltas.v * 100)}% de faltas`,
            prod(R.pfd.max, R.faltas.max), prod(R.pfd.min, R.faltas.min));
        R.horasAtta = num(op.horasTurno.v * R.disponibilidadeAtta.v, "estimado", `${String(op.horasTurno.v).replace(".", ",")} h de turno × ${Math.round(R.disponibilidadeAtta.v * 100)}% de disponibilidade (recarga e manutenção fora)`,
            op.horasTurno.v * R.disponibilidadeAtta.min, op.horasTurno.v * R.disponibilidadeAtta.max);
        // o trabalho de transporte que os fluxos do estudo pedem hoje (horas por turno), nos três lados
        const trabalho = { pe: { v: 0, min: 0, max: 0 }, emp: { v: 0, min: 0, max: 0 } };
        const origens = new Set();
        fluxos.forEach(f => {
            const por = f.viagensDia / op.turnos;
            const t = tempoManual(f, R);
            f.tempoManual = t;
            origens.add(t.origem);
            const w = comVeiculo(f) ? trabalho.emp : trabalho.pe;
            w.v += por * t.v / 60; w.min += por * t.min / 60; w.max += por * t.max / 60;
        });
        const oT = origens.size === 1 ? [...origens][0] : "estimado";
        R.horasTransporteTurno = num(trabalho.pe.v, oT, "viagens × tempo de cada entrega feita a pé, por turno", trabalho.pe.min, trabalho.pe.max);
        R.horasEmpilhadeiraTurno = num(trabalho.emp.v, oT, "viagens × tempo de cada entrega de empilhadeira, por turno", trabalho.emp.min, trabalho.emp.max);
        // pessoas-equivalentes: quantas pessoas cheias esse trabalho ocupa (é o que a frota pode de fato assumir)
        // (quem dirige a empilhadeira também é pessoa: entra aqui; a máquina entra à parte)
        const tv = trabalho.pe.v + trabalho.emp.v, tmin = trabalho.pe.min + trabalho.emp.min, tmax = trabalho.pe.max + trabalho.emp.max;
        R.pessoasEquivalentes = num(tv / R.horasPessoa.v, oT === "cliente" || oT === "diario" ? oT : "estimado", `${String(Math.round(tv * 10) / 10).replace(".", ",")} h de transporte por turno ÷ ${String(Math.round(R.horasPessoa.v * 10) / 10).replace(".", ",")} h produtivas de uma pessoa`,
            tmin / R.horasPessoa.max, tmax / R.horasPessoa.min);
        // pessoas: o cliente → a conta pelos fluxos
        const pc = lerNum(resp, "custo", "pessoas");
        const estPessoas = Math.max(tv > 0.05 ? 1 : 0, Math.ceil(R.pessoasEquivalentes.v - 1e-9));
        R.pessoasTurno = valorOu(pc, num(estPessoas, "estimado", `pelos fluxos: ${R.pessoasEquivalentes.nota}`, Math.max(tv > 0 ? 1 : 0, Math.ceil(R.pessoasEquivalentes.min - 1e-9)), Math.ceil(R.pessoasEquivalentes.max - 1e-9)));
        const cdp = custoDaPessoa(resp, pr);
        R.custoPessoa = cdp.custo;
        R.contaPessoa = cdp.conta;
        const em = lerNum(resp, "custo", "empilhadeiras");
        const estEmp = trabalho.emp.v > 0.05 ? Math.ceil(trabalho.emp.v / R.horasPessoa.v) : 0;
        R.empilhadeiras = valorOu(em, num(estEmp, "estimado", "pelos fluxos feitos de empilhadeira", estEmp ? Math.max(1, estEmp - 1) : 0, estEmp ? estEmp + 1 : 0));
        R.custoEmpilhadeira = valorOu(lerNum(resp, "custo", "custoEmpilhadeira"), premissa("custoEmpilhadeira"));
        R.horasExtras = valorOu(lerNum(resp, "custo", "horasExtras"), num(0, "premissa", "sem hora extra (não entra na conta)"));
        // perdas
        R.paradasMes = valorOu(lerNum(resp, "perdas", "paradasMes"), num(0, "premissa", "sem paradas informadas (não entra na conta)"));
        R.minutosParada = valorOu(lerNum(resp, "perdas", "minutosParada"), num(15, "premissa", "parada típica por falta de material", 10, 30));
        const fat = lerNum(resp, "perdas", "faturamentoMes");
        R.faturamentoMes = valorOu(fat, num(0, "premissa", "não informado"));
        const cm = lerNum(resp, "perdas", "custoMinuto");
        const minutosMes = op.diasMes.v * op.turnos * horasTrab * 60;
        if (cm && Number.isFinite(cm.v)) R.custoMinuto = cm;
        else if (R.faturamentoMes.v > 0) { const v = Math.round(R.faturamentoMes.v / minutosMes * R.margemMinuto.v); R.custoMinuto = num(v, "estimado", `faturamento por minuto × ${Math.round(R.margemMinuto.v * 100)}% de margem perdida`, Math.round(v * 0.67), Math.round(v * 1.33)); }
        else R.custoMinuto = num(0, "premissa", "não informado (paradas não entram em R$)");
        R.errosMes = valorOu(lerNum(resp, "perdas", "errosMes"), num(0, "premissa", "não informado"));
        R.custoErro = valorOu(lerNum(resp, "perdas", "custoErro"), num(0, "premissa", "não informado"));
        R.avariasMes = valorOu(lerNum(resp, "perdas", "avariasMes"), num(0, "premissa", "não informado"));
        // segurança
        R.acidentesAno = valorOu(lerNum(resp, "seguranca", "acidentes"), num(0, "premissa", "não informado (não entra na conta)"));
        R.quaseAcidentes = valorOu(lerNum(resp, "seguranca", "quaseAcidentes"), num(0, "premissa", "não informado"));
        R.diasAfastamento = valorOu(lerNum(resp, "seguranca", "diasAfastamento"), num(0, "premissa", "não informado"));
        R.custoAcidente = premissa("custoAcidente");
        if (R.acidentesAno.v > 0 && R.diasAfastamento.v > 0) {
            const porAcidente = R.diasAfastamento.v / R.acidentesAno.v * (R.custoPessoa.v / 22) * 2.5;
            if (porAcidente > R.custoAcidente.v) R.custoAcidente = num(Math.round(porAcidente / 100) * 100, "estimado", "dias de afastamento × custo do dia × 2,5 (reposição, investigação, avarias)", porAcidente * 0.7, porAcidente * 1.3);
        }
        // futuro
        const cr = lerNum(resp, "futuro", "crescimento");
        R.crescimento = cr && Number.isFinite(cr.v) ? num(cr.v / 100, "cliente", cr.nota, cr.min / 100, cr.max / 100) : premissa("crescimento");
        const cc = lerNum(resp, "futuro", "custoCapital");
        R.custoCapital = cc && Number.isFinite(cc.v) ? num(cc.v / 100, "cliente", "", cc.min / 100, cc.max / 100) : premissa("custoCapital");
        R.orcamento = valorOu(lerNum(resp, "futuro", "orcamento"), num(0, "premissa", "não informado"));
        R.cruzamentos = valorOu(lerNum(resp, "corredores", "cruzamentos"), num(0, "premissa", "não informado"));
        R.portas = valorOu(lerNum(resp, "corredores", "portas"), num(0, "premissa", "não informado"));
        R.turnoNovo = lerTexto(resp, "futuro", "turnoNovo") === "sim";
        // 0.24: postos dedicados (quem faz só transporte sai inteiro quando a frota assume o trabalho dele) e o destino das horas
        R.rotasMilkRun = fluxos.filter(f => f.entrega === "milkrun").length;
        const ded = lerNum(resp, "custo", "dedicadas");
        R.dedicadas = ded && Number.isFinite(ded.v) ? num(Math.min(ded.v, R.pessoasTurno.v), "cliente", "pessoas por turno que fazem só transporte", Math.min(ded.min, R.pessoasTurno.min), Math.min(ded.max, R.pessoasTurno.max))
            : R.rotasMilkRun ? num(Math.min(R.rotasMilkRun, R.pessoasTurno.v), "estimado", "um motorista dedicado por rota de milk run") : null;
        const dest = lerTexto(resp, "custo", "destinoHoras");
        R.destinoHoras = ["desligar", "realocar", "evitar"].includes(dest) ? dest : "";
        return R;
    }

    /* ---------------- contas de dinheiro ---------------- */
    const taxaMes = a => Math.pow(1 + a, 1 / 12) - 1;
    function vpl(fluxo, anual) { const i = taxaMes(anual); return fluxo.reduce((s, x, m) => s + x / Math.pow(1 + i, m), 0); }
    function tir(fluxo) {
        const f = i => fluxo.reduce((s, x, m) => s + x / Math.pow(1 + i, m), 0);
        let a = -0.9, b = 1.5;
        if (!(f(a) > 0 && f(b) < 0)) return null;
        for (let k = 0; k < 100; k++) { const c = (a + b) / 2; if (f(c) > 0) a = c; else b = c; }
        return Math.pow(1 + (a + b) / 2, 12) - 1;
    }
    function payback(fluxo) {
        let s = 0;
        for (let m = 0; m < fluxo.length; m++) { const antes = s; s += fluxo[m]; if (m > 0 && s >= 0 && antes < 0) return m - 1 + (-antes) / (fluxo[m] || 1); if (m === 0 && s >= 0) return 0; }
        return null;
    }
    // a economia entra aos poucos: preparação, piloto, metade, tudo
    const RAMPA = [0, 0, 0.25, 0.6, 1];
    const rampa = m => (m < RAMPA.length ? RAMPA[m] : 1);

    // custo de um Atta a mais por ano (para o ranking das ações)
    function custoAttaAno(pr, modelo, n = 1) {
        const p = precoAtta(pr, modelo);
        const pl = planoDe(pr, pr.planoPadrao);
        return p / 5 + p * pr.implantacaoPct / 5 + (pl.porAttaMes + pl.fixoMes / Math.max(1, n)) * 12 + p * pr.manutencaoPct;
    }
    const totalFrota = fr => (fr || []).reduce((s, g) => s + g.n, 0);
    const hardware = (pr, fr) => (fr || []).reduce((s, g) => s + g.n * precoAtta(pr, g.modelo), 0);

    // o financeiro de um cenário. e: { frotaAnos[0..5], economiaAno(k) → { total }, modulosIO, energiaMes, capitalGiro, fixoPct (parte do fixo do plano que entra) }
    function fluxoCaixa(pr, e) {
        const meses = 60;
        const compra = new Array(meses + 1).fill(0), locacao = new Array(meses + 1).fill(0);
        const pl = planoDe(pr, pr.planoPadrao);
        const plano = e.fixoPct != null ? Object.assign({}, pl, { fixoMes: pl.fixoMes * e.fixoPct }) : pl;
        let frotaAntes = [];
        const detalhe = [];
        for (let m = 0; m <= meses; m++) {
            const ano = Math.min(5, Math.floor(Math.max(0, m - 1) / 12));
            const fr = e.frotaAnos[Math.min(e.frotaAnos.length - 1, ano)] || e.frotaAnos[0];
            const hw = hardware(pr, fr);
            if (m === 0 || (m > 1 && (m - 1) % 12 === 0)) {
                const novo = m === 0 ? hw : Math.max(0, hw - hardware(pr, frotaAntes));
                const impl = m === 0 ? hw * pr.implantacaoPct + e.modulosIO * pr.moduloIO + (Number(e.extraInv) || 0) : novo * pr.expansaoPct;
                compra[m] -= novo + impl;
                locacao[m] -= impl;
                frotaAntes = fr;
            }
            if (m === 0) continue;
            const n = totalFrota(fr);
            const ligado = m >= 2;   // assinatura e energia desde o piloto
            const custoMes = (ligado ? mensalidade(plano, n) + n * e.energiaMes : 0) + (m >= 13 ? hw * pr.manutencaoPct / 12 : 0);
            const custoLoc = (ligado ? mensalidade(plano, n) + n * e.energiaMes : 0) + (ligado ? hw * pr.locacaoPctMes : 0);
            const ec = e.economiaAno(ano);
            const ganho = rampa(m) * (ec.total / 12) + (m === 4 ? e.capitalGiro || 0 : 0);
            compra[m] += ganho - custoMes;
            locacao[m] += ganho - custoLoc;
            if (m % 12 === 0) detalhe.push({ ano: m / 12, frota: n, economia: ec.total, custos: custoMes * 12 });
        }
        return { compra, locacao, detalhe };
    }
    const resumoFluxo = (f, taxa) => ({ payback: payback(f), vpl: vpl(f, taxa), tir: tir(f), acumulado: f.reduce((s, x) => s + x, 0), investimento: -Math.min(0, f[0]) });

    /* ---------------- a análise inteira ---------------- */
    const respirar = () => new Promise(r => setTimeout(r, 0));
    const atendeCom = pr => r => E().atendeR(r, pr);

    // a menor frota para uma situação (começa abaixo e põe um Atta de cada vez)
    async function menorFrota(ctx, pr, inicio, extra = 8) {
        const Es = E();
        const ini = inicio.map(g => ({ modelo: g.modelo, n: Math.max(1, g.n) }));
        const limites = inicio.map(g => ({ modelo: g.modelo, de: 1, ate: Math.max(1, g.n) + extra }));
        const atende = atendeCom(pr);
        const info = {};
        const c = await Es.acharFrota(ctx, pr, ini, limites, async fr => {
            await respirar();
            const r = Es.rodarFrota(ctx, fr, pr);
            return { frota: fr.map(g => ({ modelo: g.modelo, n: g.n })), nome: Es.nomeFrota(fr), total: totalFrota(fr), r, atende: atende(r) };
        }, info);
        return c ? { frota: c.frota, nome: c.nome, total: c.total, r: c.r } : { frota: null, limite: info.motivo, gargalo: info.gargalo || "", melhor: info.melhor ? { nome: info.melhor.nome, total: info.melhor.total, noPrazo: info.melhor.r.noPrazo } : null };
    }
    const menos = (fr, k = 2) => fr.map(g => ({ modelo: g.modelo, n: Math.max(1, g.n - k) }));
    const resumoR = r => r ? { noPrazo: r.noPrazo, tempoMedio: r.tempoMedio, tempoP90: r.tempoP90, ocupacao: r.ocupacao, entregasHora: r.entregasHora, entregas: r.entregas, pedidos: r.pedidos, esperaTrafegoMin: r.esperaTrafegoMin, naoAtendidos: r.naoAtendidos, horasDisp: r.horasDisp } : null;

    /* entrada: {
         respostas, planta, mapa, fluxos, missoes, calendario, premissas (simulação), precos,
         opcoes: { plano, rodadasAcoes }, premissasNegocio: { chave: [v, min, max] }, variantes: [{ nome, planta }], diario, planilha,
         cliente: { nome, setor, cidade }
       } */
    async function estudar(entrada, aoProgresso = () => {}) {
        const Es = E();
        const t0 = Date.now();
        const pr = precos(entrada.precos);
        if (entrada.opcoes?.plano && pr.planos.some(x => x.id === entrada.opcoes.plano)) pr.planoPadrao = entrada.opcoes.plano;
        else if (entrada.opcoes?.miraPro && pr.planos.some(x => x.mira === "pro")) pr.planoPadrao = pr.planos.find(x => x.mira === "pro").id;   // estudo antigo (Mira Pro à parte)
        const plano = planoDe(pr, pr.planoPadrao);
        const resp = entrada.respostas || {};
        const op = operacao(resp);
        const planta = entrada.planta;
        if (!planta?.nos?.length) throw new Error("O estudo precisa de uma planta (gere a planta do questionário).");
        const fluxos = (entrada.fluxos || []).filter(f => f.ativo !== false);
        if (!fluxos.length) throw new Error("O estudo precisa de pelo menos um fluxo.");
        const calendario = entrada.calendario || calendarioDoQuestionario(resp);
        const prSim = Object.assign({}, Es.PREMISSAS_PADRAO, { rodadas: 6 }, entrada.premissas || {}, { dia: 1 });
        const modelos = [...new Set(fluxos.flatMap(f => f.modelos || []))];
        const frotas = (entrada.frotas && entrada.frotas.length ? entrada.frotas : modelos.map(m => ({ modelo: m, de: 1, ate: 12 })));
        const base = { planta, missoes: entrada.missoes || [] };
        const cenario = { calendario, fluxos, premissas: prSim, frotas, busca: "achar", capacidadeZonas: entrada.capacidadeZonas || {} };

        // 1. a frota de hoje (a simulação do motor de sempre)
        aoProgresso(0.02, "Simulando o turno com a demanda de hoje");
        const res = await Es.rodar(cenario, base, p => aoProgresso(0.02 + p * 0.33, "Simulando o turno com a demanda de hoje"));
        const rec = res.recomendado;
        const r = rec?.r || res.cenarios[res.cenarios.length - 1]?.r;
        // 0.24: sem frota que atenda, o estudo não inventa payback: avisa e diz o que segura
        const melhorTestado = res.cenarios.slice().sort((a, b) => (b.r?.noPrazo?.[1] || 0) - (a.r?.noPrazo?.[1] || 0))[0];
        const semFrota = rec ? null : { motivo: res.limite || "faixa", gargalo: res.gargalo || "", melhor: melhorTestado ? { nome: melhorTestado.nome, total: melhorTestado.total, noPrazo: melhorTestado.r?.noPrazo?.[1], ocupacao: melhorTestado.r?.ocupacao?.[1], naoAtendidos: melhorTestado.r?.naoAtendidos?.[1] } : null };
        const ctx = Es.contexto(cenario, base);
        const prA = Object.assign({}, res.premissas);

        // distâncias e viagens por dia de cada fluxo
        const noPorId = id => planta.nos.find(n => n.id === id);
        const fl = fluxos.map(f => {
            const v = res.viagens[f.id] || {};
            const a = noPorId(f.de || ""), b = noPorId(f.para || "");
            const reta = a && b ? Math.abs(a.x - b.x) + Math.abs(a.y - b.y) : null;
            const distPessoa = f.entrega === "milkrun" ? (f.q?.distancia || v.metros || 200) : f.q?.distancia || (reta && v.metros ? Math.min(v.metros, reta * 1.1) : v.metros || reta || 30);
            const viagensDia = r?.porFluxo?.[f.id]?.pedidos || Es.taxaBase(f) * op.turnos * (op.horasTurno.v - op.almoco.v / 60);
            return Object.assign({}, f, { metros: v.metros || null, minViagem: v.min || null, distPessoa, viagensDia });
        });
        const R = resolver(resp, { fluxos: fl, op, precos: pr, premissasNegocio: entrada.premissasNegocio });
        const diasAno = R.diasMes.v * 12;

        // 2. hoje
        const ehPe = f => !comVeiculo(f);
        const kmDia = fl.filter(ehPe).reduce((s, f) => s + f.viagensDia * 2 * f.distPessoa, 0) / 1000;
        const kmEmpDia = fl.filter(f => !ehPe(f)).reduce((s, f) => s + f.viagensDia * 2 * f.distPessoa, 0) / 1000;
        const tonDia = fl.filter(ehPe).reduce((s, f) => s + f.viagensDia * (f.q?.peso || PESO_PADRAO[f.q?.carga] || 150), 0) / 1000;
        const entregasDia = fl.reduce((s, f) => s + f.viagensDia, 0);
        const entregasAno = entregasDia * diasAno;
        const horasTrab = Math.max(1, op.horasTurno.v - op.almoco.v / 60);
        // a parte da equipe (e das empilhadeiras) que os fluxos do estudo ocupam
        const fracaoPe = R.pessoasTurno.v > 0 ? Math.min(1, R.pessoasEquivalentes.v / R.pessoasTurno.v) : 0;
        const fracaoEmp = R.empilhadeiras.v > 0 ? Math.min(1, R.horasEmpilhadeiraTurno.v / (R.empilhadeiras.v * R.horasPessoa.v)) : 0;
        const custoHojeAno = (R.pessoasTurno.v * op.turnos * R.custoPessoa.v + R.empilhadeiras.v * R.custoEmpilhadeira.v) * 12 + R.horasExtras.v * (R.custoPessoa.v / R.horasMes.v) * 1.5 * 12;
        const custoTransporteAno = (R.pessoasTurno.v * op.turnos * R.custoPessoa.v * fracaoPe + R.empilhadeiras.v * R.custoEmpilhadeira.v * fracaoEmp) * 12 + R.horasExtras.v * (R.custoPessoa.v / R.horasMes.v) * 1.5 * 12 * fracaoPe;
        const paradasAno = R.paradasMes.v * R.minutosParada.v * R.custoMinuto.v * 12;
        const hoje = {
            custoAno: custoHojeAno, custoTransporteAno, pessoasTurno: R.pessoasTurno.v, pessoas: R.pessoasTurno.v * op.turnos, empilhadeiras: R.empilhadeiras.v,
            kmDia, kmAno: kmDia * diasAno, kmEmpDia, horasAno: (R.horasTransporteTurno.v + R.horasEmpilhadeiraTurno.v) * op.turnos * diasAno,
            tonDia, tonPessoaDia: R.pessoasTurno.v > 0 ? tonDia / (R.pessoasTurno.v * op.turnos) : 0,
            entregasDia, entregasAno, custoEntrega: entregasAno ? custoTransporteAno / entregasAno : null,
            paradasAno, paradasMinMes: R.paradasMes.v * R.minutosParada.v, errosAno: R.errosMes.v * R.custoErro.v * 12, avariasAno: R.avariasMes.v * 12,
            acidentesAno: R.acidentesAno.v, acidentesCustoAno: R.acidentesAno.v * R.custoAcidente.v, fracaoPe, fracaoEmp
        };

        // 3. ações (cada uma é um cenário simulado)
        const g = R.crescimento.v;
        const cresc3 = Math.pow(1 + g, 3) - 1;
        const frotaRec = rec ? rec.frota.filter(x => x.n) : modelos.map(m => ({ modelo: m, n: 1 }));
        const precoMedio = frotaRec.reduce((s, x) => s + precoAtta(pr, x.modelo) * x.n, 0) / Math.max(1, totalFrota(frotaRec));
        const valorAtta = custoAttaAno(pr, frotaRec[0]?.modelo, totalFrota(frotaRec));
        const gargalo = Object.entries(r?.esperaZona || {}).sort((a, b) => b[1] - a[1])[0];
        const baseHoje = rec ? { frota: rec.frota, total: rec.total, nome: rec.nome, r: rec.r } : await menorFrota(ctx, res.premissas, frotaRec, 6);
        aoProgresso(0.38, "Testando a demanda daqui a 3 anos");
        const pr3 = Object.assign({}, prA, { crescimento: (prA.crescimento || 0) + cresc3 });
        const base3 = g > 0 ? await menorFrota(ctx, pr3, baseHoje.frota || frotaRec, 10) : baseHoje;
        const candidatas = [];
        // 0.24: o pré-abastecimento já entra na frota recomendada (premissa preparo); vira ação só se o estudo o desligou
        if (!(Number(prA.preparo) >= 0.5)) candidatas.push({ id: "pre", nome: "Pré-abastecer antes da troca de turno e da volta do intervalo", tipo: "operação", esforco: "baixo", custo: 0, origemCusto: "premissa",
            descricao: "O Atta sai antes do turno e antes do fim do intervalo e deixa na linha o que ela vai pedir no pico: a frota não precisa ser do tamanho do pico.",
            mudar: c => { c.premissas = Object.assign({}, c.premissas, { preparo: 0.7 }); } });
        const apertados = fl.slice().sort((a, b) => (a.prazoMin / (a.minViagem || 1)) - (b.prazoMin / (b.minViagem || 1))).slice(0, Math.max(1, Math.ceil(fl.length / 3))).map(f => f.id);
        candidatas.push({ id: "prioridade", nome: "Prioridade para os fluxos de prazo curto", tipo: "operação", esforco: "baixo", custo: 0, origemCusto: "premissa",
            descricao: `Os pedidos dos fluxos com o prazo mais curto (${fl.filter(f => apertados.includes(f.id)).map(f => f.nome.split(" · ")[0]).slice(0, 3).join("; ")}) passam na frente.`,
            mudar: c => { c.fluxos = c.fluxos.map(f => Object.assign({}, f, { prioridade: apertados.includes(f.id) ? 3 : 1 })); } });
        if (gargalo && gargalo[1] > 300) candidatas.push({ id: "gargalo", nome: `Segundo acesso no gargalo (${gargalo[0]})`, tipo: "layout", esforco: "médio", custo: Number(pr.segundoAcesso) || 12000, origemCusto: "premissa",
            descricao: `Na zona ${gargalo[0]} os Atta esperam ${Math.round(gargalo[1] / 60)} min por dia. Uma segunda passagem (ou uma segunda estação ao lado) deixa dois Atta passarem ao mesmo tempo.`,
            mudar: c => { c.capacidadeZonas = Object.assign({}, c.capacidadeZonas || {}, { [gargalo[0]]: 2 }); } });
        if (planta.estudo?.gerada && entrada.respostas) {
            const maisUsado = Object.entries(fl.reduce((o, f) => { o[f.q?.de] = (o[f.q?.de] || 0) + f.viagensDia; return o; }, {})).sort((a, b) => b[1] - a[1])[0]?.[0];
            if (maisUsado) candidatas.push({ id: "berco", nome: "Berço ao lado do ponto mais usado", tipo: "layout", esforco: "baixo", custo: Number(pr.bercoExtra) || 6000, origemCusto: "premissa",
                descricao: "Depois do intervalo e no começo do turno, o Atta sai de perto de onde a maior parte das viagens começa.",
                planta: () => { const nv = plantaDoQuestionario(entrada.respostas, { bercoPerto: maisUsado, nome: planta.nome, bercos: 2 }); return nv.planta; } });
        }
        (entrada.variantes || []).filter(v => v?.planta?.nos?.length).slice(0, 4).forEach((v, i) => candidatas.push({ id: "var" + i, nome: `Layout: ${v.nome || "variante " + (i + 1)}`, tipo: "layout", esforco: "alto", custo: Number(v.custo) || 0, origemCusto: v.custo ? "cliente" : "premissa", descricao: v.descricao || "Variante da planta desenhada no estudo.", planta: () => v.planta }));

        const acoes = [];
        for (let i = 0; i < candidatas.length; i++) {
            const a = candidatas[i];
            aoProgresso(0.42 + 0.3 * i / candidatas.length, `Testando: ${a.nome}`);
            const c2 = JSON.parse(JSON.stringify({ calendario, fluxos, premissas: prA, frotas, capacidadeZonas: cenario.capacidadeZonas }));
            if (a.mudar) a.mudar(c2);
            const pl2 = a.planta ? a.planta() : planta;
            if (!pl2) continue;
            const ctx2 = Es.contexto(c2, { planta: pl2, missoes: base.missoes });
            const pr2 = Object.assign({}, prA, c2.premissas);
            const hojeA = await menorFrota(ctx2, pr2, menos(baseHoje.frota || frotaRec), 6);
            const pr23 = Object.assign({}, pr2, { crescimento: (pr2.crescimento || 0) + cresc3 });
            const ano3 = g > 0 ? await menorFrota(ctx2, pr23, menos(base3.frota || baseHoje.frota || frotaRec), 10) : hojeA;
            const nH = hojeA.frota ? totalFrota(hojeA.frota) : null, n3 = ano3.frota ? totalFrota(ano3.frota) : null;
            const bH = baseHoje.frota ? totalFrota(baseHoje.frota) : null, b3 = base3.frota ? totalFrota(base3.frota) : null;
            const evitaHoje = nH != null && bH != null ? Math.max(0, bH - nH) : 0;
            const evita3 = n3 != null && b3 != null ? Math.max(0, b3 - n3) : (n3 != null && b3 == null ? 1 : 0);
            const destrava = b3 == null && n3 != null;
            const ganhoAno = Math.max(evitaHoje, evita3 * 0.6) * valorAtta;
            const rr = hojeA.r || null;
            acoes.push({
                id: a.id, nome: a.nome, tipo: a.tipo, esforco: a.esforco, descricao: a.descricao, custo: a.custo, origemCusto: a.origemCusto,
                frotaHoje: hojeA.frota ? Es.nomeFrota(hojeA.frota) : null, totalHoje: nH, frota3: ano3.frota ? Es.nomeFrota(ano3.frota) : null, total3: n3,
                evitaHoje, evita3, destrava, noPrazo: rr ? rr.noPrazo[1] : null, espera: rr ? rr.esperaTrafegoMin[1] : null,
                ganhoAno, liquidoAno: ganhoAno - a.custo / 5, mudar: a.id
            });
        }
        // o semáforo do Eciton I/O (segurança: não muda a frota)
        const nIO = Math.max(R.cruzamentos.v || 0, fl.some(f => f.q?.hoje === "empilhadeira") ? 1 : 0);
        if (nIO > 0) {
            const evitados = R.acidentesAno.v * 0.3 * R.custoAcidente.v;
            acoes.push({ id: "io", nome: `Semáforo do Eciton I/O ${nIO > 1 ? `nos ${nIO} cruzamentos` : "no cruzamento"} com empilhadeira`, tipo: "segurança", esforco: "baixo", custo: nIO * pr.moduloIO, origemCusto: "tabela",
                descricao: "O módulo segura a empilhadeira (ou o Atta) no cruzamento e acende o semáforo: ninguém cruza com o outro passando.",
                evitaHoje: 0, evita3: 0, ganhoAno: evitados, liquidoAno: evitados - nIO * pr.moduloIO / 5, potencial: true, nIO });
        }
        acoes.sort((a, b) => b.liquidoAno - a.liquidoAno || a.custo - b.custo);
        acoes.forEach((a, i) => { a.ordem = i + 1; });
        const boas = acoes.filter(a => a.mudar && (a.evitaHoje > 0 || a.evita3 > 0 || a.destrava) && a.tipo === "operação");

        // 4. forecast de 3 anos: só mais Atta × com o plano de ações (as de operação, que não custam)
        const forecast = [];
        aoProgresso(0.75, "Prevendo os próximos 3 anos");
        const cPlano = JSON.parse(JSON.stringify({ calendario, fluxos, premissas: prA, frotas, capacidadeZonas: cenario.capacidadeZonas }));
        boas.forEach(a => candidatas.find(c => c.id === a.id)?.mudar?.(cPlano));
        const ctxPlano = Es.contexto(cPlano, base);
        let antesSo = baseHoje, antesPlano = null;
        for (let k = 0; k <= 3; k++) {
            const cres = Math.pow(1 + g, k) - 1;
            const prK = Object.assign({}, prA, { crescimento: (prA.crescimento || 0) + cres });
            let so = k === 0 ? baseHoje : k === 3 && g > 0 ? base3 : g > 0 ? await menorFrota(ctx, prK, antesSo.frota || baseHoje.frota || frotaRec, 10) : baseHoje;
            let plano = boas.length ? await menorFrota(ctxPlano, Object.assign({}, prK, cPlano.premissas, { crescimento: (prA.crescimento || 0) + cres }), menos(antesPlano?.frota || so.frota || frotaRec, k ? 0 : 2), 10) : so;
            if (so.frota) antesSo = so;
            if (plano.frota) antesPlano = plano;
            forecast.push({ ano: k, crescimento: cres, pedidosDia: entregasDia * (1 + cres), so: so.frota ? { nome: Es.nomeFrota(so.frota), total: totalFrota(so.frota), frota: so.frota } : { nome: null, limite: so.limite, gargalo: so.gargalo },
                plano: plano.frota ? { nome: Es.nomeFrota(plano.frota), total: totalFrota(plano.frota), frota: plano.frota } : { nome: null, limite: plano.limite, gargalo: plano.gargalo } });
            aoProgresso(0.75 + 0.1 * (k + 1) / 4, "Prevendo os próximos 3 anos");
        }

        // 5. crescer sem contratar: até quanto a frota recomendada aguenta
        let capacidade = null;
        if (baseHoje.frota) {
            aoProgresso(0.86, "Medindo a folga da frota");
            const atende = atendeCom(prA);
            let lo = 0, hi = 1.5;
            const rodaCom = async c => { await respirar(); return atende(Es.rodarFrota(ctx, baseHoje.frota, Object.assign({}, prA, { crescimento: (prA.crescimento || 0) + c }))); };
            if (await rodaCom(hi)) lo = hi;
            else for (let k = 0; k < 5; k++) { const m = (lo + hi) / 2; if (await rodaCom(m)) lo = m; else hi = m; }
            capacidade = Math.round(lo * 100) / 100;
        }

        // 6. o financeiro (5 anos), nos três cenários
        aoProgresso(0.9, "Fazendo as contas");
        const frotaFin = baseHoje.frota || frotaRec;
        const frotaPorAno = (lista, campo) => [0, 1, 2, 3, 3, 3].map(k => lista[Math.min(3, k)]?.[campo]?.frota || frotaFin);
        const energiaMes = R.kwhHoraAtta.v * (r?.horasDisp || op.turnos * horasTrab) * R.diasMes.v * pr.energiaKwh;
        const modulosIO = 0;   // os módulos I/O entram pela ação (não no investimento básico)
        const escolha = (x, lado) => (lado === "min" ? x.min : lado === "max" ? x.max : x.v);
        // as pessoas-equivalentes do lado do cenário (nunca mais do que o cliente tem; o que sobra delas faz outras coisas)
        const pessoasDoLado = lado => Math.min(escolha(R.pessoasTurno, lado), escolha(R.pessoasEquivalentes, lado));
        const idsTodos = fl.map(f => f.id);
        // 0.24: o trabalho de transporte (pessoas-equivalentes por turno) de uma parte dos fluxos, nos três lados
        function eqDe(ids) {
            const set = new Set(ids);
            let v = 0, a = 0, b = 0, emp = 0, ent = 0;
            fl.filter(f => set.has(f.id)).forEach(f => {
                const por = f.viagensDia / op.turnos, t = f.tempoManual;
                v += por * t.v / 60; a += por * t.min / 60; b += por * t.max / 60; ent += f.viagensDia;
                if (comVeiculo(f)) emp += por * t.v / 60;
            });
            return { v: v / R.horasPessoa.v, min: a / R.horasPessoa.max, max: b / R.horasPessoa.min, horasEmp: emp, entregas: ent };
        }
        // os ganhos potenciais que o cliente informou, pelo lado mínimo (o cenário provável conta só estes)
        const informado = k => R[k] && R[k].origem === "cliente";
        const potMinimo = {
            paradas: informado("paradasMes") && R.custoMinuto.v > 0 ? R.paradasMes.min * R.minutosParada.min * R.custoMinuto.min * 12 * R.reducaoParadas.min : 0,
            erros: informado("errosMes") && R.custoErro.v > 0 ? R.errosMes.min * R.custoErro.min * 12 * R.reducaoErros.min : 0,
            avarias: informado("avariasMes") ? R.avariasMes.min * 12 * R.reducaoAvarias.min : 0,
            acidentes: informado("acidentesAno") ? R.acidentesAno.min * R.custoAcidente.min * R.reducaoAcidentes.min : 0
        };
        function economia(cen) {
            // cen: { lado: "min" | "v" | "max", crescimento: bool, potenciais: false | "min" (só os informados, lado mínimo) | "max" (todos),
            //        turnoNovo: bool, ids (parte dos fluxos; sem: todos), nAtta (energia do turno novo), liberadasTurno (fixo, para as contas de equilíbrio) }
            const lado = cen.lado;
            const ids = cen.ids || idsTodos;
            const parte = ids !== idsTodos && ids.length !== idsTodos.length;
            const eq = parte ? eqDe(ids) : R.pessoasEquivalentes;
            const cob = escolha(R.coberturaFrota, lado);
            const pessoasT = escolha(R.pessoasTurno, lado);
            const custoP = escolha(R.custoPessoa, lado);
            const base = Math.min(pessoasT, escolha(eq, lado));
            const fr = pessoasT > 0 ? base / pessoasT : 0;
            // conservador: só pessoas inteiras; provável e otimista: o arredondado
            const arred = lado === "min" ? Math.floor : Math.round;
            // por posto: cada rota de milk run tira o motorista inteiro; quem o cliente diz que faz só transporte sai inteiro
            const set = new Set(ids);
            const rotas = fl.filter(f => f.entrega === "milkrun" && set.has(f.id)).length;
            const parteEq = R.pessoasEquivalentes.v > 0 ? Math.min(1, escolha(eq, "v") / R.pessoasEquivalentes.v) : 0;
            const ded = R.dedicadas?.origem === "cliente" ? escolha(R.dedicadas, lado) * parteEq : 0;
            const porPosto = Math.min(pessoasT, rotas + arred(Math.max(0, ded - rotas) * cob + 1e-9));
            const porHora = arred(base * cob + 1e-9);
            const liberadas = cen.liberadasTurno != null ? cen.liberadasTurno : Math.max(porHora, porPosto);
            const contaPorPosto = cen.liberadasTurno == null && porPosto > porHora;
            const parteEmp = R.horasEmpilhadeiraTurno.v > 0 ? Math.min(1, (parte ? eq.horasEmp : R.horasEmpilhadeiraTurno.v) / R.horasEmpilhadeiraTurno.v) : 0;
            const empL = cen.liberadasTurno != null ? 0 : R.empilhadeiras.v > 0 ? Math.max(arred(escolha(R.empilhadeiras, lado) * fracaoEmp * parteEmp * cob), Math.min(escolha(R.empilhadeiras, lado), rotas)) : 0;
            const custoE = escolha(R.custoEmpilhadeira, lado);
            const hx = cen.liberadasTurno != null ? 0 : R.horasExtras.v * (custoP / R.horasMes.v) * 1.5 * 12 * fr * cob;
            // o destino das horas: desligar ou evitar contratação vale o custo inteiro; realocar vale uma parte (zero no conservador)
            const valorPessoa = cen.liberadasTurno == null && R.destinoHoras === "realocar" ? (lado === "min" ? 0 : escolha(R.valorRealocacao, lado)) : 1;
            const parteEnt = entregasDia > 0 ? (parte ? eqDe(ids).entregas : entregasDia) / entregasDia : 0;
            const turnoNovo = Boolean(cen.turnoNovo && R.turnoNovo && op.turnos < 3 && cen.liberadasTurno == null);
            return k => {
                const fator = cen.crescimento ? Math.pow(1 + escolha(R.crescimento, lado), k) : 1;
                // com a demanda maior, sem a frota seriam precisas mais pessoas (contratações evitadas)
                const pessoasAno = liberadas * op.turnos * custoP * 12 * valorPessoa + (cen.crescimento ? Math.max(0, Math.floor(base * cob * (fator - 1))) * op.turnos * custoP * 12 : 0);
                // o turno novo (a partir do 2º ano): a frota cobre o transporte dele sem contratar; a energia do turno a mais sai do ganho
                const tn = turnoNovo && k >= 1 ? liberadas * custoP * 12 - (cen.nAtta || 0) * energiaMes / op.turnos * 12 : 0;
                const conf = { pessoas: pessoasAno, empilhadeiras: empL * custoE * 12, horasExtras: hx, turnoNovo: Math.max(0, tn) };
                const pot = cen.potenciais === "min" ? { paradas: potMinimo.paradas * parteEnt, erros: potMinimo.erros * parteEnt, avarias: potMinimo.avarias * parteEnt, acidentes: potMinimo.acidentes * parteEnt }
                    : cen.potenciais ? {
                        paradas: hoje.paradasAno * escolha(R.reducaoParadas, lado) * parteEnt, erros: hoje.errosAno * escolha(R.reducaoErros, lado) * parteEnt,
                        avarias: hoje.avariasAno * escolha(R.reducaoAvarias, lado) * parteEnt, acidentes: hoje.acidentesCustoAno * escolha(R.reducaoAcidentes, lado) * parteEnt
                    } : {};
                const confirmados = Object.values(conf).reduce((s, x) => s + x, 0), potenciais = Object.values(pot).reduce((s, x) => s + x, 0);
                return { conf, pot, confirmados, potenciais, total: confirmados + potenciais, liberadas, empL, porPosto: contaPorPosto, valorPessoa };
            };
        }
        // os três cenários (0.24: o provável conta as perdas que o cliente informou, pela redução mínima, e o turno novo previsto)
        const nFrotaFin = totalFrota(frotaFin);
        const CEN = {
            conservador: { lado: "min", crescimento: false, potenciais: false },
            provavel: { lado: "v", crescimento: true, potenciais: "min", turnoNovo: true, nAtta: nFrotaFin },
            otimista: { lado: "max", crescimento: true, potenciais: "max", turnoNovo: true, nAtta: nFrotaFin }
        };
        const materialHora = R.faturamentoMes.v > 0 ? R.faturamentoMes.v * R.materialPct.v / (R.diasMes.v * op.turnos * horasTrab) : 0;
        const capitalGiro = materialHora * Math.max(0, R.coberturaHoje.v - R.coberturaE4M.v);
        const cenarios = {};
        [["conservador", CEN.conservador, frotaPorAno(forecast.map(() => null), "so")],
            ["provavel", CEN.provavel, frotaPorAno(forecast, "so")],
            ["otimista", CEN.otimista, frotaPorAno(forecast, boas.length ? "plano" : "so")]].forEach(([id, cen, frotaAnos]) => {
            const ec = economia(cen);
            const fc = fluxoCaixa(pr, { frotaAnos, economiaAno: ec, modulosIO, energiaMes, capitalGiro: cen.potenciais === "max" ? capitalGiro : 0 });
            const taxa = escolha(R.custoCapital, id === "conservador" ? "max" : id === "otimista" ? "min" : "v");
            const e0 = ec(0);
            cenarios[id] = { compra: resumoFluxo(fc.compra, taxa), locacao: resumoFluxo(fc.locacao, taxa), economiaAno1: e0, economiaAno2: ec(1), anos: fc.detalhe, taxa, mensal: fc.compra.map(Math.round), mensalLocacao: fc.locacao.map(Math.round), frota: Es.nomeFrota(frotaAnos[0]), frota5: Es.nomeFrota(frotaAnos[5]) };
        });
        // comparações (5 anos, custo total da logística interna)
        const prov = cenarios.provavel;
        const naoFazer = [0, 1, 2, 3, 4].reduce((s, k) => s + custoHojeAno * Math.pow(1 + g, k), 0);
        const custoE4M = (fluxoTotalCusto => fluxoTotalCusto)(naoFazer - prov.compra.acumulado);
        let soMaisAtta = null;
        if (boas.length && forecast[3]?.so?.frota && forecast[3]?.plano?.frota) {
            const ecP = economia(CEN.provavel);
            const fcP = fluxoCaixa(pr, { frotaAnos: frotaPorAno(forecast, "plano"), economiaAno: ecP, modulosIO, energiaMes, capitalGiro: 0 });
            soMaisAtta = { comPlano: resumoFluxo(fcP.compra, R.custoCapital.v), soAtta: prov.compra, frotaSo: forecast[3].so.nome, frotaPlano: forecast[3].plano.nome };
        }
        const comparacao = { naoFazer, comE4M: custoE4M, economia5: prov.compra.acumulado, soMaisAtta };
        // 0.24: o payback provável se as pessoas forem desligadas ou realocadas (o cliente decide)
        const destinos = {};
        ["desligar", "realocar"].forEach(d => {
            const antes = R.destinoHoras;
            R.destinoHoras = d;
            destinos[d] = payback(fluxoCaixa(pr, { frotaAnos: frotaPorAno(forecast, "so"), economiaAno: economia(CEN.provavel), modulosIO, energiaMes, capitalGiro: 0 }).compra);
            R.destinoHoras = antes;
        });

        // 7. sensibilidade (payback do cenário provável)
        aoProgresso(0.94, "Sensibilidade");
        const paybackCom = (mud) => {
            const R0 = {};
            Object.keys(mud).filter(k => !k.startsWith("__")).forEach(k => { R0[k] = R[k]; R[k] = Object.assign({}, R[k], { v: mud[k], min: mud[k], max: mud[k] }); });
            const prx = Object.assign({}, pr);
            if (mud.__preco) prx.atta = Object.fromEntries(Object.entries(pr.atta).map(([k, v]) => [k, v * mud.__preco]));
            if (mud.__impl) prx.implantacaoPct = mud.__impl;
            if (mud.__assin != null) prx.planos = pr.planos.map(x => Object.assign({}, x, { fixoMes: x.fixoMes * mud.__assin, porAttaMes: x.porAttaMes * mud.__assin }));
            const ec = economia(CEN.provavel);
            const fc = fluxoCaixa(prx, { frotaAnos: frotaPorAno(forecast, "so"), economiaAno: ec, modulosIO, energiaMes, capitalGiro: 0 });
            Object.keys(R0).forEach(k => { R[k] = R0[k]; });
            return payback(fc.compra);
        };
        const variaveis = [
            ["custoPessoa", "Custo de cada pessoa"], ["pessoasEquivalentes", "Tempo de transporte (pessoas-equivalentes)"], ["pessoasTurno", "Pessoas no transporte"], ["coberturaFrota", "Parte do transporte que a frota assume"],
            ["crescimento", "Crescimento da demanda"], ["custoEmpilhadeira", "Custo da empilhadeira"]
        ].filter(([k]) => R[k] && R[k].min !== R[k].max && !(k === "custoEmpilhadeira" && !R.empilhadeiras.v));
        const sensib = variaveis.map(([k, nome]) => {
            const a = paybackCom({ [k]: R[k].min }), b = paybackCom({ [k]: R[k].max });
            return { chave: k, nome, de: R[k].min, ate: R[k].max, origem: R[k].origem, paybackDe: a, paybackAte: b };
        });
        sensib.push({ chave: "preco", nome: "Preço do Atta (±15%)", de: 0.85, ate: 1.15, origem: "tabela", paybackDe: paybackCom({ __preco: 0.85 }), paybackAte: paybackCom({ __preco: 1.15 }) });
        sensib.push({ chave: "implantacao", nome: "Implantação (15% a 30% do hardware)", de: 0.15, ate: 0.3, origem: "tabela", paybackDe: paybackCom({ __impl: 0.15 }), paybackAte: paybackCom({ __impl: 0.3 }) });
        const amplitude = s => Math.abs((s.paybackDe ?? 61) - (s.paybackAte ?? 61));
        sensib.sort((a, b) => amplitude(b) - amplitude(a));
        // só para o fornecedor (não vai no relatório do cliente): o preço e a assinatura que fecham o payback em 24 meses
        const ALVO = 24;
        const acharFator = (chave, lo, hi) => {
            const ok = f => { const pb = paybackCom({ [chave]: f }); return pb != null && pb <= ALVO; };
            if (ok(hi)) return hi;
            if (!ok(lo)) return null;
            for (let k = 0; k < 30; k++) { const m = (lo + hi) / 2; if (ok(m)) lo = m; else hi = m; }
            return lo;
        };
        const fPreco = acharFator("__preco", 0.05, 1), fAssin = acharFator("__assin", 0.0, 1);
        const nFin = totalFrota(baseHoje.frota || frotaRec);
        const equilibrio = { alvo: ALVO, fatorPreco: fPreco, precoMedio: fPreco != null ? precoMedio * fPreco : null, fatorAssinatura: fAssin,
            assinatura: fAssin != null ? mensalidade(plano, nFin) * fAssin : null, assinaturaHoje: mensalidade(plano, nFin), frotaN: nFin,
            custoAttaAno: valorAtta, pessoaAno: R.custoPessoa.v * 12 };

        // 7b. Atta × pessoa: o tempo de cada entrega, quantas pessoas a frota de fato assume e quantas precisaria para se pagar
        const attaPessoa = (() => {
            const porAtta = rec?.r?.porAtta || [];
            const hDisp = r?.horasDisp || op.turnos * horasTrab;
            const nF = totalFrota(frotaFin);
            const porModelo = [...new Set(porAtta.map(a => a.modelo))].map(modelo => {
                const as = porAtta.filter(a => a.modelo === modelo);
                const viagens = as.reduce((s, a) => s + a.viagens, 0);
                const ocupado = as.reduce((s, a) => s + a.ocupacao * hDisp * 60, 0);
                const fls = fl.filter(f => (f.modelos || [])[0] === modelo);
                const vd = fls.reduce((s, f) => s + f.viagensDia, 0);
                const pessoaMin = vd ? fls.reduce((s, f) => s + f.viagensDia * f.tempoManual.v, 0) / vd : null;
                const attaMin = viagens ? ocupado / viagens : null;
                // se o Atta estivesse cheio: as entregas dele num turno ÷ as de uma pessoa num turno
                const potencial = pessoaMin && attaMin ? (R.horasAtta.v * 60 / attaMin) / (R.horasPessoa.v * 60 / pessoaMin) : null;
                return { modelo, n: as.length, pessoaMin, attaMin, potencial, ocupacao: as.length ? as.reduce((s, a) => s + a.ocupacao, 0) / as.length : 0, viagensDia: viagens };
            });
            const fluxos = fl.map(f => ({ id: f.id, nome: f.nome, modelo: (f.modelos || [])[0] || "", viagensDia: f.viagensDia, pessoaMin: f.tempoManual.v, pessoaMinMin: f.tempoManual.min, pessoaMinMax: f.tempoManual.max, origem: f.tempoManual.origem, como: f.tempoManual.como, attaViagemMin: f.minViagem }));
            // o que a frota de fato assume (pessoas no total, todos os turnos), nos três lados
            const assume = lado => pessoasDoLado(lado) * escolha(R.coberturaFrota, lado) * op.turnos;
            const liberadas = { min: cenarios.conservador.economiaAno1.liberadas * op.turnos, v: cenarios.provavel.economiaAno1.liberadas * op.turnos, max: cenarios.otimista.economiaAno1.liberadas * op.turnos };
            // quantas pessoas por Atta a frota precisaria assumir para se pagar em 24, 36 e 48 meses (cenário provável, sem crescimento nem ganhos potenciais)
            const pbFrota = x => payback(fluxoCaixa(pr, { frotaAnos: [0, 1, 2, 3, 4, 5].map(() => frotaFin), economiaAno: economia({ lado: "v", crescimento: false, potenciais: false, liberadasTurno: x * nF / op.turnos }), modulosIO, energiaMes, capitalGiro: 0 }).compra);
            const minimo = (pb, alvo) => {
                const ok = x => { const p = pb(x); return p != null && p <= alvo; };
                let lo = 0, hi = 12;
                if (!ok(hi)) return null;
                for (let k = 0; k < 30; k++) { const m = (lo + hi) / 2; if (ok(m)) hi = m; else lo = m; }
                return hi;
            };
            // um Atta sozinho (o modelo mais usado), com a parte dele no fixo do plano
            const modeloP = frotaFin.slice().sort((a, b) => b.n - a.n)[0]?.modelo || modelos[0];
            const pbUm = k => payback(fluxoCaixa(pr, { frotaAnos: [0, 1, 2, 3, 4, 5].map(() => [{ modelo: modeloP, n: 1 }]), economiaAno: () => ({ total: k * R.custoPessoa.v * 12 }), modulosIO: 0, energiaMes, capitalGiro: 0, fixoPct: 1 / Math.max(1, nF) }).compra);
            const pl = planoDe(pr, pr.planoPadrao);
            return {
                frotaN: nF, pessoasEquivalentes: { v: R.pessoasEquivalentes.v * op.turnos, min: R.pessoasEquivalentes.min * op.turnos, max: R.pessoasEquivalentes.max * op.turnos },
                assume: { min: assume("min"), v: assume("v"), max: assume("max") }, liberadas,
                porAtta: nF ? { min: assume("min") / nF, v: assume("v") / nF, max: assume("max") / nF } : null,
                precisa: Object.fromEntries([24, 36, 48].map(m => [m, minimo(pbFrota, m)])),
                horasPessoa: R.horasPessoa.v, horasAtta: R.horasAtta.v, ocupacaoMedia: porAtta.length ? porAtta.reduce((s, a) => s + a.ocupacao, 0) / porAtta.length : null,
                poucoUsados: porAtta.filter(a => a.ocupacao < 0.35).map(a => ({ id: a.id, modelo: a.modelo, ocupacao: a.ocupacao, viagens: a.viagens })),
                porModelo, fluxos,
                umAtta: { modelo: modeloP, preco: precoAtta(pr, modeloP), mensal: pl.porAttaMes + pl.fixoMes / Math.max(1, nF) + energiaMes, custoPessoaMes: R.custoPessoa.v,
                    linhas: [1, 2, 3].map(k => ({ pessoas: k, payback: pbUm(k) })), precisa: Object.fromEntries([24, 36, 48].map(m => [m, minimo(pbUm, m)])) }
            };
        })();
        // 7c. bateria e recarga (0.23): a energia de cada Atta no dia, quantas recargas, se cabem nas folgas e quantos carregadores
        const bateria = (() => {
            const porAtta = rec?.r?.porAtta || [];
            if (!porAtta.length) return null;
            const hDisp = r?.horasDisp || op.turnos * horasTrab;
            const noite = Math.max(0, 24 - op.turnos * op.horasTurno.v);
            const intervaloH = op.turnos * op.almoco.v / 60;
            const Bt = BAT();
            const perfil = modelo => {
                const mod = MODULO[modelo] || M()?.porId?.(modelo)?.modulo || "E";
                if (Bt) return Bt.perfilDoModelo(modelo, mod, Bt.configuracao(entrada.bateria || null));
                return { capacidadeWh: 1280, cargaAlvo: 90, irCarregarAbaixo: 25, potenciaCargaW: 640, consumoParadoW: 15, whKmVazio: 22, whKmCarregado: 38, whCicloCarga: 0.6 };
            };
            const linhas = porAtta.map(a => {
                const p = perfil(a.modelo);
                const rodandoH = a.ocupacao * hDisp;
                const whDia = a.km * (p.whKmVazio + p.whKmCarregado) / 2 + a.viagens * 2 * p.whCicloCarga + Math.max(0, hDisp - rodandoH) * p.consumoParadoW;
                const util = p.capacidadeWh * Math.max(10, p.cargaAlvo - p.irCarregarAbaixo) / 100;
                const cargaH = whDia / Math.max(1, p.potenciaCargaW);
                const folgaH = Math.max(0, hDisp - rodandoH);
                return { id: a.id, modelo: a.modelo, whDia, recargasDia: whDia / Math.max(1, util), cargaH, folgaH, autonomiaH: util / Math.max(1, whDia / Math.max(0.1, hDisp)),
                    capacidadeWh: p.capacidadeWh, potenciaCargaW: p.potenciaCargaW, cheiaH: util / Math.max(1, p.potenciaCargaW) };
            });
            const porModelo = [...new Set(linhas.map(l => l.modelo))].map(modelo => {
                const ls = linhas.filter(l => l.modelo === modelo);
                const med = k => ls.reduce((s, l) => s + l[k], 0) / ls.length;
                return { modelo, n: ls.length, whDia: med("whDia"), recargasDia: med("recargasDia"), cargaH: med("cargaH"), folgaH: med("folgaH"), autonomiaH: med("autonomiaH"),
                    capacidadeWh: ls[0].capacidadeWh, potenciaCargaW: ls[0].potenciaCargaW };
            });
            // onde a carga cabe: na noite (fora dos turnos), nas folgas do turno (recarga de oportunidade) ou tirando Atta da operação
            const cabeNoite = linhas.every(l => l.recargasDia <= 1 && noite >= l.cheiaH);
            const cabeFolga = linhas.every(l => l.cargaH * 1.25 <= l.folgaH + (noite > 0 ? Math.min(noite, l.cheiaH) : 0));
            const totalCargaH = linhas.reduce((s, l) => s + l.cargaH, 0);
            // carregadores: com a noite livre, cada um atende quantos couberem em sequência; no turno, a carga se espalha pelas folgas
            const porCarregadorNoite = Math.max(1, Math.floor(noite / Math.max(0.25, Math.max(...linhas.map(l => l.cheiaH)))));
            const noTurno = Math.max(0, totalCargaH - (noite > 0 ? linhas.length * Math.min(noite, Math.max(...linhas.map(l => l.cheiaH))) : 0));
            const carregadores = Math.max(1, cabeNoite ? Math.ceil(linhas.length / porCarregadorNoite) : Math.ceil(noTurno / Math.max(1, hDisp * 0.6)));
            const faltaH = linhas.reduce((s, l) => s + Math.max(0, l.cargaH * 1.25 - l.folgaH - (noite > 0 ? Math.min(noite, l.cheiaH) : 0)), 0);
            const attaExtra = faltaH > 0.05 ? Math.ceil(faltaH / Math.max(1, hDisp)) : 0;
            const kwhDia = linhas.reduce((s, l) => s + l.whDia, 0) / 1000;
            return {
                porModelo, kwhDia, kwhMes: kwhDia * (Number(op.diasMes?.v ?? op.diasMes) || 22), carregadores, attaExtra, cabeNoite, cabeFolga, noiteH: noite, intervaloH,
                como: cabeNoite ? "uma carga por dia, fora dos turnos (à noite) basta"
                    : cabeFolga ? "a carga cabe nas folgas do turno (recarga de oportunidade nos intervalos e quando o Atta fica parado)"
                    : `a carga não cabe nas folgas: a recarga tira ${(Math.round(faltaH * 10) / 10).toLocaleString("pt-BR")} h de Atta por dia (${attaExtra} Atta a mais para não faltar)`,
                origem: Bt ? "estimado" : "premissa"
            };
        })();

        // 7d. (0.24) o payback de uma frota fixa servindo uma parte dos fluxos, com a demanda de hoje (para comparar cenários e a curva)
        const pagarCom = (frota, ids, extraInv = 0) => {
            const n = totalFrota(frota);
            const ec = economia(Object.assign({}, CEN.provavel, { crescimento: false, ids, nAtta: n }));
            const fc = fluxoCaixa(pr, { frotaAnos: [0, 1, 2, 3, 4, 5].map(() => frota), economiaAno: ec, modulosIO, energiaMes, capitalGiro: 0, extraInv });
            const e0 = ec(1);
            return { payback: payback(fc.compra), investimento: -Math.min(0, fc.compra[0]), ganhoAno: e0.total, pessoas: e0.liberadas * op.turnos, vpl: vpl(fc.compra, R.custoCapital.v) };
        };
        // os pontos de um fluxo (de/para do questionário ou os destinos da missão da planta)
        const pontosDe = f => {
            if (f.de || f.para) return [f.de, f.para].concat(f.paradas || []).filter(Boolean);
            const m = Es.missaoDoFluxo(f, base.missoes);
            return [...new Set((m?.etapas || []).filter(e => e.tipo === "IR_PARA" && e.destino).map(e => e.destino))];
        };
        const origemDe = f => f.de || pontosDe(f)[0];
        const destinoDe = f => f.para || pontosDe(f)[1] || pontosDe(f)[0];
        const cargaDe = f => f.q?.carga || { G: "caixa", E: "carrinho", R: "esteira", T: "comboio" }[MODULO[(f.modelos || [])[0]]] || "carrinho";
        const modDe = f => MODULO[(f.modelos || [])[0]] || null;
        const pesoDe = f => Number(f.q?.peso) || PESO_PADRAO[cargaDe(f)] || 150;
        // o módulo M leva a carga do fluxo? (null = não; { custo, oque } = sim, com a adaptação por ponto)
        const podeLevar = (f, mod) => {
            if (pesoDe(f) > (CAPACIDADE[mod] || 0)) return null;
            if (f.entrega === "milkrun") return mod === "T" ? { custo: 0, oque: "" } : null;
            const c = cargaDe(f);
            if (modDe(f) === mod || NATIVO[c] === mod) return { custo: 0, oque: "" };
            const k = (pr.adaptacao || {})[c + ":" + mod];
            return Array.isArray(k) ? { custo: Math.max(0, Number(k[0]) || 0), oque: String(k[1] || "") } : null;
        };
        // o custo de adaptar os pontos dos fluxos que mudam de módulo (cada ponto uma vez, pelo maior custo)
        const adaptar = (lista, mod) => {
            const porPonto = {}, oques = new Set();
            lista.forEach(f => { const c = podeLevar(f, mod); if (!c || !c.custo) return; pontosDe(f).forEach(pt => { if (pt) porPonto[pt] = Math.max(porPonto[pt] || 0, c.custo); }); if (c.oque) oques.add(c.oque); });
            return { custo: Object.values(porPonto).reduce((a, b) => a + b, 0), pontos: Object.keys(porPonto).length, oque: [...oques].join("; ") };
        };
        // a planta do cenário: as estações dos pontos que mudam de módulo passam a aceitar o módulo novo (é a adaptação)
        const plantaAdaptada = (fluxos2, mudam) => {
            if (!mudam || !mudam.length) return planta;
            const pl = JSON.parse(JSON.stringify(planta));
            const pts = new Set(fl.filter(f => mudam.includes(f.id)).flatMap(pontosDe));
            fluxos2.filter(f => f.entrega === "milkrun").forEach(f => pontosDe(f).forEach(x => pts.add(x)));
            pts.forEach(id => {
                const no = pl.nos.find(n => n.id === id);
                const est = no && (pl.estacoes || []).find(e => e.id === no.estacao);
                if (!est) return;
                const mods = new Set(fluxos2.filter(f => pontosDe(f).includes(id)).map(f => MODULO[(f.modelos || [])[0]]).filter(Boolean));
                if (mods.size === 1 && [...mods][0] !== "T") est.carga = CARGA_ESTACAO[[...mods][0]]; else delete est.carga;
            });
            return pl;
        };
        const simularFluxos = async (fluxos2, missoes2, inicio, mudam, plantaPronta) => {
            const c2 = JSON.parse(JSON.stringify({ calendario, fluxos: fluxos2, premissas: prA, frotas: [], capacidadeZonas: cenario.capacidadeZonas }));
            const ctx2 = Es.contexto(c2, { planta: plantaPronta || plantaAdaptada(fluxos2, mudam), missoes: missoes2 || base.missoes });
            const mods = [...new Set(fluxos2.flatMap(f => (f.modelos || []).slice(0, 1)))];
            const ini = inicio || mods.map(m => ({ modelo: m, n: Math.max(1, (frotaFin.find(g => g.modelo === m)?.n || 1) - 1) }));
            return menorFrota(ctx2, prA, ini, 8);
        };
        const cenariosPlanta = [];
        if (baseHoje.frota && !semFrota && entrada.opcoes?.cenarios !== false) {
            aoProgresso(0.95, "Testando os cenários da planta");
            const pAtual = pagarCom(frotaFin, idsTodos);
            const famHoje = [...new Set(frotaFin.filter(g => g.n).map(g => MODULO[g.modelo] || g.modelo))];
            cenariosPlanta.push({ id: "atual", tipo: "atual", nome: "Como a planta pede hoje", descricao: `${famHoje.length} modelo${famHoje.length > 1 ? "s" : ""} de Atta (${famHoje.join(", ")}), cada fluxo com o módulo da carga dele.`,
                modulos: famHoje, frota: Es.nomeFrota(frotaFin), total: totalFrota(frotaFin), adaptacao: 0, pontos: 0, oque: "", viavel: "sim", ...pAtual });
            const propostas = [];
            // trocar uma família por outra que já está na frota (menos variantes de Atta)
            famHoje.forEach(F => famHoje.filter(G => G !== F).forEach(G => {
                const deF = fl.filter(f => modDe(f) === F);
                if (!deF.length || !deF.every(f => podeLevar(f, G))) return;
                propostas.push({ id: `troca-${F}-${G}`, tipo: "troca", nome: `Os fluxos do Atta ${F} feitos pelo Atta ${G}`, de: F, para: G, mudam: deF.map(f => f.id),
                    fluxos: fl.map(f => (modDe(f) === F ? Object.assign({}, f, { modelos: [MODELO_DO_MODULO[G]] }) : f)), ad: adaptar(deF, G) });
            }));
            // um modelo só (quando nenhuma troca de uma família já chega nele)
            if (famHoje.length > 2) ["E", "T", "G", "R"].forEach(M => {
                if (propostas.some(x => x.tipo === "unico")) return;
                const mudam = fl.filter(f => modDe(f) !== M);
                if (!fl.every(f => podeLevar(f, M))) return;
                propostas.push({ id: `unico-${M}`, tipo: "unico", nome: `Um modelo só: Atta ${M} em todos os fluxos`, para: M, mudam: mudam.map(f => f.id),
                    fluxos: fl.map(f => Object.assign({}, f, { modelos: [MODELO_DO_MODULO[M]] })), ad: adaptar(mudam, M) });
            });
            // frota mista: a família em que a pessoa é mais rápida fica com as pessoas
            (attaPessoa.porModelo || []).filter(m => m.potencial != null && m.potencial < 0.8).forEach(m => {
                const F = MODULO[m.modelo] || m.modelo;
                const resto = fl.filter(f => modDe(f) !== F);
                if (!resto.length || resto.length === fl.length) return;
                propostas.push({ id: `mista-${F}`, tipo: "mista", nome: `Os fluxos do Atta ${F} ficam com as pessoas`, de: F, mudam: fl.filter(f => modDe(f) === F).map(f => f.id),
                    fluxos: resto, ids: resto.map(f => f.id), ad: { custo: 0, pontos: 0, oque: "" }, nota: `Neles a pessoa é mais rápida (um Atta ${F} cheio faz o trabalho de ${(Math.round(m.potencial * 100) / 100).toLocaleString("pt-BR")} pessoa).` });
            });
            // milk run: três ou mais fluxos chamados do mesmo ponto viram uma rota de comboio. O comboio carregado não gira
            // no ponto nem entra em ramal: as paradas ficam no corredor, então a planta de estudo é gerada de novo (só
            // para plantas geradas pelo questionário; numa planta desenhada à mão, isso é uma variante de layout)
            if (planta.estudo?.gerada && entrada.respostas) {
                const porOrigem = {};
                fl.filter(f => (f.entrega || "chamada") === "chamada" && ["caixa", "carrinho"].includes(cargaDe(f)) && pesoDe(f) <= CAPACIDADE.T && f.q?.de && f.q?.para).forEach(f => { (porOrigem[f.q.de] = porOrigem[f.q.de] || []).push(f); });
                Object.entries(porOrigem).filter(([, l]) => l.length >= 3).sort((a, b) => b[1].length - a[1].length).slice(0, 1).forEach(([deQ, l]) => {
                    const pts = entrada.respostas?.pontos?.lista || [];
                    const pq = id => pts.find(x => x.id === id) || { x: 0, y: 0 };
                    const resta = [...new Set(l.map(f => f.q.para))], ordem = [];
                    let atual = pq(deQ);
                    while (resta.length) { resta.sort((a, b) => Math.hypot((pq(a).x || 0) - (atual.x || 0), (pq(a).y || 0) - (atual.y || 0)) - Math.hypot((pq(b).x || 0) - (atual.x || 0), (pq(b).y || 0) - (atual.y || 0))); const prox = resta.shift(); ordem.push(prox); atual = pq(prox); }
                    const r2 = JSON.parse(JSON.stringify(entrada.respostas));
                    const tirar = new Set(l.map(f => `${f.q.de}>${f.q.para}`));
                    r2.fluxos.lista = (r2.fluxos.lista || []).filter(f => !(f && f.entrega !== "milkrun" && tirar.has(`${f.de}>${f.para}`)));
                    const rotaQ = { de: deQ, para: ordem[0], paradas: ordem.slice(1), entrega: "milkrun", carga: "carrinho", oque: "kits e caixas", ciclo: 20, hoje: "pe" };
                    r2.fluxos.lista.push(rotaQ);
                    const g = plantaDoQuestionario(r2, { nome: planta.nome, bercos: (planta.nos || []).filter(n => n.tipo === "BERCO").length || 2 });
                    if (!g.planta) return;
                    const fq = fluxosDoQuestionario(r2, g.mapa);
                    const rota = fq.fluxos.find(f => f.entrega === "milkrun" && f.q?.de === deQ && f.q?.para === ordem[0]);
                    if (!rota) return;
                    const mis = fq.missoes.find(m => m.id === rota.missao);
                    const volta = Es.criarRotas(g.planta, fq.missoes, { passarSemParar: Number(prA.passarSemParar) > 0 })(mis, rota.de, "atta-t-o", rota);
                    if (!volta.ok) return;
                    // o ciclo cabe uma volta com folga (o comboio leva os kits que cada parada consome nesse tempo)
                    const ciclo = Math.max(10, Math.min(40, Math.ceil(volta.dur / 60 * 1.25 / 5) * 5));
                    rota.demanda = { tipo: "ciclo", cicloMin: ciclo }; rota.prazoMin = ciclo;
                    const nomes = Object.fromEntries(pts.map(x => [x.id, x.nome || x.id]));
                    const ad = adaptar(l, "T");
                    propostas.push({ id: "milkrun-" + deQ, tipo: "milkrun", rotaQ: Object.assign({}, rotaQ, { ciclo }), tirarQ: [...tirar], nome: `Milk run saindo de ${nomes[deQ] || deQ} (${ordem.length} paradas, a cada ${ciclo} min)`, mudam: l.map(f => f.id),
                        fluxos: fq.fluxos.filter(f => f.ativo !== false), missoes: fq.missoes, planta: g.planta, ad,
                        nota: `O comboio passa de tempo em tempo deixando o cheio e pegando o vazio (${ordem.map(x => nomes[x] || x).join(", ")}), em vez de uma viagem por pedido. As paradas ficam no corredor.` });
                });
            }
            const viab = entrada.viabilidade || {};
            // um pouco de cada tipo: até 2 trocas de família, 1 modelo só, 2 frotas mistas e 1 milk run
            const limite = { troca: 2, unico: 1, mista: 2, milkrun: 1 }, usados = {};
            const ordenadas = propostas.filter(c => c.tipo === "troca").sort((x, y) => x.ad.custo - y.ad.custo).concat(propostas.filter(c => c.tipo !== "troca"));
            const escolhidas = ordenadas.filter(c => { usados[c.tipo] = (usados[c.tipo] || 0) + 1; return usados[c.tipo] <= (limite[c.tipo] || 1); });
            for (const c of escolhidas) {
                const sim = await simularFluxos(c.fluxos, c.missoes, null, c.tipo === "mista" ? null : c.mudam, c.planta);
                if (!sim.frota) { cenariosPlanta.push({ id: c.id, tipo: c.tipo, nome: c.nome, descricao: c.nota || "", fecha: false, limite: sim.limite, melhor: sim.melhor, viavel: viab[c.id]?.v || "confirmar", motivo: viab[c.id]?.motivo || "", mudam: c.mudam }); continue; }
                const pg = pagarCom(sim.frota, c.ids || idsTodos, c.ad.custo);
                const mods = [...new Set(sim.frota.filter(g => g.n).map(g => MODULO[g.modelo] || g.modelo))];
                cenariosPlanta.push({ id: c.id, tipo: c.tipo, nome: c.nome, descricao: c.nota || "", modulos: mods, frota: Es.nomeFrota(sim.frota), frotaLista: sim.frota, total: totalFrota(sim.frota), fecha: true, rotaQ: c.rotaQ || null, tirarQ: c.tirarQ || null,
                    adaptacao: c.ad.custo, pontos: c.ad.pontos, oque: c.ad.oque, noPrazo: sim.r?.noPrazo?.[1], viavel: viab[c.id]?.v || "confirmar", motivo: viab[c.id]?.motivo || "", mudam: c.mudam, de: c.de, para: c.para, ...pg });
            }
        }
        // 7e. (0.24) onde o projeto se paga: os fluxos por ordem de valor (o tempo que tiram das pessoas por minuto de Atta), a frota que cada parte pede e o payback
        const curvaPb = (() => {
            if (!baseHoje.frota || semFrota || !(attaPessoa.porModelo || []).length) return null;
            const attaMinDe = f => (attaPessoa.porModelo.find(m => m.modelo === (f.modelos || [])[0])?.attaMin) || (f.minViagem || 3) * 1.5;
            const ordem = fl.slice().sort((a, b) => b.tempoManual.v / attaMinDe(b) - a.tempoManual.v / attaMinDe(a) || b.viagensDia - a.viagensDia);
            const capAtta = (r?.horasDisp || op.turnos * horasTrab) * 60 * prA.ocupacaoMax;
            const minTodos = {};
            fl.forEach(f => { const m = (f.modelos || [])[0]; minTodos[m] = (minTodos[m] || 0) + f.viagensDia * attaMinDe(f); });
            // calibra pela simulação: a frota da conta, com todos os fluxos, fica igual à recomendada
            const fator = Object.fromEntries(Object.keys(minTodos).map(m => [m, Math.max(1, frotaFin.find(g => g.modelo === m)?.n || 1) / Math.max(0.01, minTodos[m] / capAtta)]));
            const porN = {};
            for (let k = 1; k <= ordem.length; k++) {
                const sub = ordem.slice(0, k);
                const min_ = {};
                sub.forEach(f => { const m = (f.modelos || [])[0]; min_[m] = (min_[m] || 0) + f.viagensDia * attaMinDe(f); });
                const frota = Object.entries(min_).map(([modelo, md]) => ({ modelo, n: Math.max(1, Math.ceil(md / capAtta * fator[modelo] - 0.05)) }));
                const n = totalFrota(frota);
                const pg = pagarCom(frota, sub.map(f => f.id));
                // para cada tamanho de frota, a parte com mais fluxos (mais ganho com o mesmo investimento)
                porN[n] = { n, k, frota: Es.nomeFrota(frota), frotaLista: frota, ids: sub.map(f => f.id), fluxos: sub.map(f => f.nome), ultimo: sub[k - 1].nome, ...pg };
            }
            const pontos = Object.values(porN).sort((a, b) => a.n - b.n);
            const valido = pontos.filter(p => p.payback != null);
            const melhor = valido.slice().sort((a, b) => a.payback - b.payback || a.n - b.n)[0] || null;
            return { pontos, melhor, total: fl.length, nota: "estimativa pelos tempos da simulação; a fase 1 é simulada de novo" };
        })();
        let fase1 = null;
        if (curvaPb?.melhor && curvaPb.melhor.k < fl.length) {
            aoProgresso(0.97, "Simulando a fase 1");
            const sub = fl.filter(f => curvaPb.melhor.ids.includes(f.id));
            const sim = await simularFluxos(sub, null, curvaPb.melhor.frotaLista.map(g => ({ modelo: g.modelo, n: Math.max(1, g.n - 1) })));
            if (sim.frota) {
                const pg = pagarCom(sim.frota, sub.map(f => f.id));
                const todo = cenariosPlanta[0] || pagarCom(frotaFin, idsTodos);
                // a fase 1 só vale se ela se paga bem antes do projeto inteiro (3 meses ou mais)
                if (pg.payback != null && (todo.payback == null || pg.payback <= todo.payback - 3)) fase1 = { frota: Es.nomeFrota(sim.frota), frotaLista: sim.frota, total: totalFrota(sim.frota), fluxos: sub.map(f => f.nome), ids: sub.map(f => f.id), noPrazo: sim.r?.noPrazo?.[1], ...pg };
            }
        }
        // 7f. (0.24) coerência das pessoas: o cliente informou bem mais gente do que os fluxos explicam?
        const coerencia = (() => {
            if (R.pessoasTurno.origem !== "cliente") return null;
            const inf = R.pessoasTurno.v, exp = R.pessoasEquivalentes.v;
            if (!(inf - exp >= 2 && inf > exp * 1.4)) return null;
            return { informadas: inf * op.turnos, explicadas: exp * op.turnos, sobra: (inf - exp) * op.turnos, dedicadas: R.dedicadas?.origem === "cliente" ? R.dedicadas.v * op.turnos : null };
        })();

        // só para a E4M: o mesmo estudo em cada plano da tabela
        const planosCmp = pr.planos.map(p => {
            const prx = Object.assign({}, pr, { planoPadrao: p.id });
            const fP = fluxoCaixa(prx, { frotaAnos: frotaPorAno(forecast, "so"), economiaAno: economia(CEN.provavel), modulosIO, energiaMes, capitalGiro: 0 });
            const fC = fluxoCaixa(prx, { frotaAnos: frotaPorAno(forecast.map(() => null), "so"), economiaAno: economia(CEN.conservador), modulosIO, energiaMes, capitalGiro: 0 });
            return { id: p.id, nome: p.nome, mira: p.mira, inclui: p.inclui, mensal: mensalidade(p, totalFrota(frotaFin)), paybackProvavel: payback(fP.compra), paybackConservador: payback(fC.compra),
                vpl5: vpl(fP.compra, R.custoCapital.v), escolhido: p.id === plano.id };
        });

        // 8. métricas
        const frN = totalFrota(frotaFin);
        const custoE4MAno = (n, hw) => mensalidade(plano, n) * 12 + hw * pr.manutencaoPct + hw * (1 + pr.implantacaoPct) / 5 + n * energiaMes * 12;
        const residual = custoTransporteAno * (1 - R.coberturaFrota.v);
        const curva = [0, 0.25, 0.5, 1].map(c => {
            const s = c === 0 ? { frota: frotaFin } : res.sensibilidade.find(x => Math.abs(x.crescimento - c) < 1e-6 && !x.indisponiveis);
            const fr = c === 0 ? frotaFin : s ? (s.atende ? frotaFin : s.precisa?.frota || null) : null;
            const ent = entregasAno * (1 + c);
            return { demanda: 1 + c, hoje: ent ? custoTransporteAno * (1 + c) / ent : null, e4m: fr && ent ? (custoE4MAno(totalFrota(fr), hardware(pr, fr)) + residual * (1 + c)) / ent : null };
        });
        const minDisp = R.diasMes.v * op.turnos * horasTrab * 60;
        const metricas = {
            kmDia: { hoje: kmDia, e4m: kmDia * (1 - R.coberturaFrota.v) }, horasAno: { hoje: hoje.horasAno, e4m: hoje.horasAno * (1 - R.coberturaFrota.v) },
            tonDia: { hoje: tonDia, e4m: tonDia * (1 - R.coberturaFrota.v), porPessoa: hoje.tonPessoaDia },
            custoEntrega: { hoje: hoje.custoEntrega, e4m: entregasAno ? (custoE4MAno(frN, hardware(pr, frotaFin)) + residual) / entregasAno : null, curva },
            estoque: { materialHora, liberado: capitalGiro, ganhoAno: capitalGiro * R.custoCapital.v },
            paradas: { minutosMes: hoje.paradasMinMes, pontosOEE: minDisp ? hoje.paradasMinMes / minDisp * 100 * R.reducaoParadas.v : 0, reaisAno: hoje.paradasAno * R.reducaoParadas.v },
            espaco: (() => { const L = fl.filter(f => !ehPe(f)).reduce((s, f) => Math.max(s, f.distPessoa), 0); const m2 = L * Math.max(0, R.larguraEmp.v - R.larguraAtta.v); return { metros: L, m2, reaisAno: m2 * R.custoM2.v * 12 }; })(),
            energia: { kwhAno: frN * R.kwhHoraAtta.v * (r?.horasDisp || op.turnos * horasTrab) * diasAno, co2Atta: frN * R.kwhHoraAtta.v * (r?.horasDisp || op.turnos * horasTrab) * diasAno * R.co2Kwh.v / 1000,
                co2Emp: R.empilhadeiras.v * fracaoEmp * R.coberturaFrota.v * op.turnos * R.horasPessoa.v * diasAno * R.glpHora.v * R.co2Glp.v / 1000 },
            rastreabilidade: { entregasAno },
            crescer: { capacidade, turnoNovo: R.turnoNovo && op.turnos < 3, pessoasTurno: R.pessoasTurno.v, custoTurno: R.pessoasTurno.v * fracaoPe * R.custoPessoa.v * 12 },
            atta: (rec?.r?.porAtta || []).map(a => ({ id: a.id, modelo: a.modelo, viagens: a.viagens, km: a.km, ocupacao: a.ocupacao }))
        };

        // 9. implantação
        const implantacao = [
            { fase: "Pedido e projeto", quando: "semanas 1 a 3", oque: "visita técnica, planta revisada, missões, postos, Wi-Fi", economia: 0 },
            { fase: "Instalação", quando: "semanas 4 a 6", oque: "fita e tags no chão, berços, Eciton configurado, treinamento", economia: 0 },
            { fase: "Piloto", quando: "mês 2", oque: `1 Atta no fluxo mais usado (${fl.slice().sort((a, b) => b.viagensDia - a.viagensDia)[0]?.nome || "fluxo principal"})`, economia: RAMPA[2] },
            { fase: "Meia frota", quando: "mês 3", oque: "metade da frota, os fluxos principais", economia: RAMPA[3] },
            { fase: "Frota completa", quando: "mês 4 em diante", oque: `${Es.nomeFrota(frotaFin)}, todos os fluxos do estudo`, economia: 1 }
        ];

        // 10. confiança por seção e o que refinar
        const peso = (k, w) => ({ k, w, o: R[k]?.origem || "premissa" });
        const secoes = {
            "Custo de hoje": [peso("pessoasTurno", 2), peso("pessoasEquivalentes", 2), peso("custoPessoa", 2), peso("empilhadeiras", R.empilhadeiras.v ? 1 : 0), peso("custoEmpilhadeira", R.empilhadeiras.v ? 1 : 0), peso("horasExtras", 0.5)],
            "Demanda e rotas": fl.map(f => ({ k: f.id, w: f.viagensDia, o: f.q?.fonte || "cliente" }))
                .concat([{ k: "distancias", w: entregasDia || 1, o: planta.estudo?.semDesenho ? (fl.some(f => f.q?.distancia) ? "cliente" : "premissa") : "cliente" }, { k: "prazos", w: (entregasDia || 1) / 2, o: fl.every(f => f.prazoOrigem !== "premissa") ? "cliente" : "premissa" }]),
            "Perdas e segurança": [peso("paradasMes", 2), peso("custoMinuto", 2), peso("errosMes", 1), peso("acidentesAno", 1)],
            "Futuro": [peso("crescimento", 2), peso("custoCapital", 1)]
        };
        const confianca = Object.entries(secoes).map(([nome, itens]) => {
            const tot = itens.reduce((s, x) => s + x.w, 0) || 1;
            const bom = itens.filter(x => CONFIRMA.has(x.o)).reduce((s, x) => s + x.w, 0);
            const est = itens.filter(x => x.o === "estimado" || x.o === "referencia").reduce((s, x) => s + x.w, 0);
            return { secao: nome, cliente: bom / tot, estimado: est / tot, premissa: Math.max(0, 1 - (bom + est) / tot) };
        });
        const COMO = {
            pessoasTurno: "conte quem leva material em cada turno (empilhadeira, carrinho, rebocador), mesmo que faça outras coisas",
            custoPessoa: "o RH: o salário médio de quem leva material, os benefícios e o regime de impostos (o estudo calcula os encargos)",
            pessoasEquivalentes: "quanto tempo leva hoje cada entrega, da saída à volta: o diário de viagens, ou uma cronometragem de alguns dias",
            custoEmpilhadeira: "o contrato de locação, ou a manutenção, a bateria ou o gás por mês",
            crescimento: "o planejamento de produção ou comercial dos próximos 3 anos",
            paradasMes: "o apontamento de paradas da produção (motivo: falta de material)",
            custoMinuto: "a controladoria: a margem de contribuição de uma hora de linha",
            errosMes: "as não conformidades de abastecimento no mês",
            acidentesAno: "o SESMT: CATs e registros de quase-acidente dos últimos 12 meses",
            custoCapital: "a área financeira (a taxa que a empresa usa para avaliar projetos)",
            coberturaFrota: "a visita técnica: quais viagens o Atta faz sozinho e quais precisam de alguém"
        };
        const refinar = [];
        sensib.forEach(s => { if (R[s.chave] && !CONFIRMA.has(R[s.chave].origem) && COMO[s.chave]) refinar.push({ item: s.nome, peso: amplitude(s), como: COMO[s.chave], origem: R[s.chave].origem }); });
        ["paradasMes", "custoMinuto", "errosMes", "acidentesAno"].forEach(k => { if (!CONFIRMA.has(R[k].origem)) refinar.push({ item: { paradasMes: "Paradas de linha por falta de material", custoMinuto: "Custo do minuto parado", errosMes: "Entregas erradas", acidentesAno: "Acidentes e quase-acidentes" }[k], peso: 0, como: COMO[k], origem: R[k].origem, potencial: true }); });
        if (fl.some(f => f.origem === "questionário")) refinar.push({ item: "Quantidade de viagens de cada fluxo", peso: 0, como: "o diário de viagens no celular por 3 a 5 dias, ou a planilha de movimentações do sistema", origem: "cliente", diario: true });
        if (planta.estudo?.semDesenho) refinar.push({ item: "Distâncias", peso: 0, como: "o DXF da planta (ou uma imagem com a largura do galpão)", origem: "premissa" });
        if (fl.some(f => f.prazoOrigem === "premissa")) refinar.push({ item: "Prazos aceitáveis de cada fluxo", peso: 0, como: "com a produção: quanto tempo a linha espera o material sem parar", origem: "premissa" });

        // premissas usadas (para o relatório)
        const LISTA = { pessoasTurno: "Pessoas no transporte, por turno", custoPessoa: "Custo de uma pessoa por mês", empilhadeiras: "Empilhadeiras ou rebocadores", custoEmpilhadeira: "Custo de cada empilhadeira por mês", horasExtras: "Horas extras por mês",
            paradasMes: "Paradas por falta de material, por mês", minutosParada: "Duração de cada parada", custoMinuto: "Custo do minuto parado", errosMes: "Entregas erradas por mês", custoErro: "Custo de cada erro", avariasMes: "Avarias por mês",
            acidentesAno: "Acidentes em 12 meses", custoAcidente: "Custo de um acidente com afastamento", crescimento: "Crescimento da demanda por ano", custoCapital: "Custo de capital",
            velocidadePe: "Velocidade a pé com carga", velocidadeEmp: "Velocidade da empilhadeira", manuseioS: "Pegar ou entregar à mão, por ponta", manuseioEmpS: "Pegar ou deixar com a empilhadeira, por ponta",
            pfd: "Pausas, fadiga e esperas", faltas: "Faltas e afastamentos", horasPessoa: "Horas produtivas de uma pessoa por turno", disponibilidadeAtta: "Disponibilidade do Atta", horasAtta: "Horas do Atta por turno",
            pessoasEquivalentes: "Pessoas-equivalentes no transporte, por turno", coberturaFrota: "Parte do transporte que a frota assume",
            reducaoParadas: "Paradas evitadas", reducaoErros: "Erros evitados", reducaoAvarias: "Avarias evitadas", reducaoAcidentes: "Acidentes evitados", horasTurno: "Horas por turno", diasMes: "Dias por mês", almoco: "Intervalo" };
        const premissasLista = Object.entries(LISTA).filter(([k]) => R[k]).map(([k, nome]) => ({ chave: k, nome, v: R[k].v, min: R[k].min, max: R[k].max, origem: R[k].origem, nota: R[k].nota }));

        aoProgresso(1, "Pronto");
        const cortar = c => ({ nome: c.nome, total: c.total, frota: c.frota, atende: c.atende, r: resumoR(c.r) });
        return {
            versao: VERSAO, em: new Date().toISOString(), ms: Date.now() - t0,
            cliente: entrada.cliente || {}, precos: pr, plano: plano.id, nomePlano: plano.nome, planoInfo: Object.assign({}, plano, { textoMira: MIRA_PLANO[plano.mira] }), miraPro: plano.mira === "pro",
            custoPessoa: { v: R.custoPessoa.v, origem: R.custoPessoa.origem, nota: R.custoPessoa.nota, conta: R.contaPessoa }, attaPessoa, planos: planosCmp, bateria,
            semFrota, cenariosPlanta, curva: curvaPb, fase1, coerencia, viabilidade: entrada.viabilidade || {},
            horas: { destino: R.destinoHoras || "", valorRealocacao: R.valorRealocacao.v, dedicadas: R.dedicadas ? { v: R.dedicadas.v * op.turnos, origem: R.dedicadas.origem } : null, rotasMilkRun: R.rotasMilkRun, turnoNovo: Boolean(R.turnoNovo && op.turnos < 3) },
            operacaoAtta: { passarSemParar: Number(prA.passarSemParar) > 0, preparo: Number(prA.preparo) || 0, antecedenciaMin: Number(prA.antecedenciaMin) || 30 },
            operacao: { turnos: op.turnos, horasTurno: op.horasTurno.v, diasMes: op.diasMes.v, almoco: op.almoco.v },
            planta: { nome: planta.nome, semDesenho: Boolean(planta.estudo?.semDesenho), gerada: Boolean(planta.estudo?.gerada), nos: planta.nos.map(n => ({ id: n.id, tipo: n.tipo, x: n.x, y: n.y, nome: n.nome || planta.estacoes?.find(e => e.id === n.estacao)?.nome || "" })),
                segmentos: planta.segmentos.map(s => ({ a: s.a, b: s.b, sentido: s.sentido, tipo: s.tipo })), dimensoes: planta.dimensoes },
            fluxos: fl.map(f => ({ id: f.id, nome: f.nome, modelo: (f.modelos || [])[0] || "", porHora: Es.taxaBase(f), entrega: f.entrega || "chamada", ciclo: f.demanda?.tipo === "ciclo" ? f.demanda.cicloMin : null, viagensDia: f.viagensDia, prazoMin: f.prazoMin, prazoOrigem: f.prazoOrigem || "cliente", metros: f.metros, distPessoa: f.distPessoa, minViagem: f.minViagem, hoje: f.q?.hoje || "", carga: f.q?.carga || "", origem: f.origem || "" })),
            simulacao: { recomendado: rec ? cortar(rec) : null, cenarios: res.cenarios.map(cortar), sensibilidade: res.sensibilidade.map(s => ({ nome: s.nome, crescimento: s.crescimento, indisponiveis: s.indisponiveis, atende: s.atende, noPrazo: s.r.noPrazo, ocupacao: s.r.ocupacao, precisa: s.precisa ? { nome: s.precisa.nome, total: s.precisa.total } : null, limite: s.limite || "", gargalo: s.gargalo || "" })),
                porHora: r?.porHora || [], esperaZona: r?.esperaZona || {}, porFluxo: r?.porFluxo || {}, premissas: res.premissas, avisos: res.avisos, limite: res.limite, gargalo: res.gargalo },
            hoje, acoes, forecast, capacidade, financeiro: { cenarios, comparacao, capitalGiro, energiaMes, equilibrio, destinos }, sensibilidade: sensib, metricas, implantacao, confianca, refinar, premissas: premissasLista,
            avisos: (entrada.avisos || []).concat(res.avisos || []), resumoMira: ""
        };
    }

    // 0.24: usar um cenário da planta no estudo (a E4M confirmou na visita). Devolve o que muda:
    // { fluxos, planta } (troca de módulo, frota mista) ou { respostas } (milk run: gerar a planta de novo)
    function aplicarCenario(est, c) {
        if (!c || !est) return null;
        const fluxos = (est.fluxos || []).map(f => Object.assign({}, f));
        const mudam = new Set(c.mudam || []);
        if (c.tipo === "mista") return { fluxos: fluxos.map(f => (mudam.has(f.id) ? Object.assign(f, { ativo: false }) : f)), planta: est.planta };
        if (c.tipo === "troca" || c.tipo === "unico") {
            const novo = MODELO_DO_MODULO[c.para];
            if (!novo) return null;
            const fl2 = fluxos.map(f => (mudam.has(f.id) ? Object.assign(f, { modelos: [novo] }) : f));
            const pl = JSON.parse(JSON.stringify(est.planta));
            const pontos = f => (f.de || f.para) ? [f.de, f.para].concat(f.paradas || []).filter(Boolean)
                : [...new Set(((est.missoes || []).find(m => m.id === f.missao)?.etapas || []).filter(e => e.tipo === "IR_PARA" && e.destino).map(e => e.destino))];
            const pts = new Set(fl2.filter(f => mudam.has(f.id)).flatMap(pontos));
            pts.forEach(id => {
                const no = pl.nos.find(n => n.id === id);
                const e = no && (pl.estacoes || []).find(x => x.id === no.estacao);
                if (!e) return;
                const mods = new Set(fl2.filter(f => f.ativo !== false && pontos(f).includes(id)).map(f => MODULO[(f.modelos || [])[0]]).filter(Boolean));
                if (mods.size === 1 && [...mods][0] !== "T") e.carga = CARGA_ESTACAO[[...mods][0]]; else delete e.carga;
            });
            return { fluxos: fl2, planta: pl };
        }
        if (c.tipo === "milkrun" && c.rotaQ && est.respostas) {
            const r2 = JSON.parse(JSON.stringify(est.respostas));
            const tirar = new Set(c.tirarQ || []);
            r2.fluxos = r2.fluxos || {};
            r2.fluxos.lista = (r2.fluxos.lista || []).filter(f => !(f && f.entrega !== "milkrun" && tirar.has(`${f.de}>${f.para}`))).concat([Object.assign({}, c.rotaQ)]);
            return { respostas: r2 };
        }
        return null;
    }

    // um resumo curto (para a Mira Pro escrever o texto e para a lista de prospects)
    function resumoTexto(Rs) {
        // 0.24: o cenário provável em destaque; o conservador é o piso ("no mínimo")
        const f = Rs.financeiro?.cenarios?.provavel;
        const co = Rs.financeiro?.cenarios?.conservador;
        const rec = Rs.simulacao?.recomendado;
        const mm = v => (v == null ? null : Math.round(v * 10) / 10);
        return {
            frota: rec?.nome || null, noPrazo: rec?.r?.noPrazo?.[1], custoHojeAno: Rs.hoje?.custoAno, economiaAno: f?.economiaAno1?.total,
            paybackProvavel: f?.compra?.payback, investimento: f?.compra?.investimento, vpl5: f?.compra?.vpl, tir: f?.compra?.tir,
            paybackConservador: co?.compra?.payback, paybackOtimista: Rs.financeiro?.cenarios?.otimista?.compra?.payback,
            ganhosProvavel: f?.economiaAno1 ? { pessoas: f.economiaAno1.conf?.pessoas, empilhadeiras: f.economiaAno1.conf?.empilhadeiras, perdasInformadas: f.economiaAno1.potenciais } : null,
            semFrota: Rs.semFrota || null, coerencia: Rs.coerencia || null, horas: Rs.horas || null,
            cenariosPlanta: (Rs.cenariosPlanta || []).map(c => ({ nome: c.nome, frota: c.frota || null, fecha: c.fecha !== false, paybackHoje: mm(c.payback), investimento: c.investimento, adaptacao: c.adaptacao, viavel: c.viavel })),
            fase1: Rs.fase1 ? { frota: Rs.fase1.frota, fluxos: Rs.fase1.fluxos, payback: mm(Rs.fase1.payback), investimento: Rs.fase1.investimento, pessoas: Rs.fase1.pessoas } : null, acoes: (Rs.acoes || []).slice(0, 4).map(a => ({ nome: a.nome, evitaHoje: a.evitaHoje, evita3: a.evita3, liquidoAno: Math.round(a.liquidoAno), custo: a.custo })),
            forecast: (Rs.forecast || []).map(x => ({ ano: x.ano, so: x.so?.nome || "não fecha", plano: x.plano?.nome || "não fecha" })), capacidade: Rs.capacidade,
            kmDia: Rs.metricas?.kmDia?.hoje, tonDia: Rs.metricas?.tonDia?.hoje, refinar: (Rs.refinar || []).slice(0, 4).map(x => x.item),
            plano: Rs.nomePlano || null, custoPessoaMes: Rs.custoPessoa?.v, custoPessoaOrigem: Rs.custoPessoa?.origem,
            attaPessoa: Rs.attaPessoa ? { pessoasEquivalentes: Rs.attaPessoa.pessoasEquivalentes?.v, frotaAssume: Rs.attaPessoa.assume?.v, porAtta: Rs.attaPessoa.porAtta?.v, precisaPorAtta24: Rs.attaPessoa.precisa?.[24], ocupacaoMedia: Rs.attaPessoa.ocupacaoMedia } : null,
            bateria: Rs.bateria ? { carregadores: Rs.bateria.carregadores, kwhDia: Rs.bateria.kwhDia, como: Rs.bateria.como, attaExtra: Rs.bateria.attaExtra } : null
        };
    }

    return {
        VERSAO, PRECOS_PADRAO, REFERENCIAS, NOMES_PLANO, MIRA_PLANO, ORIGENS, PREMISSAS, SETORES, CAPACIDADE, precos, planoDe, mensalidade, encargos, custoDaPessoa, tempoManual, pessoaMes, operacao, calendarioDoQuestionario, modeloDoFluxo,
        plantaDoQuestionario, fluxosDoQuestionario, postosDosFluxos, resumoDiario, lerPlanilha, resumoPlanilha, aplicarSetor, resolver,
        vpl, tir, payback, fluxoCaixa, estudar, resumoTexto, nomeModelo, aplicarCenario, PRAZO_CARGA, NATIVO
    };
});
