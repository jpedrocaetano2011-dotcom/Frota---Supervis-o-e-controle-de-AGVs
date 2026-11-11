/* ============================================================
   ESTUDO DE FROTA (0.21) — a tela e o relatório
   ============================================================
   Operação › Estudo de frota. O motor está em estudo.js (roda no Node
   também); aqui fica o cenário, o resultado e o relatório em PDF.

   1. O que a frota leva: os fluxos (importados dos botões dos postos e da
      programação, repetidos de um dia que já aconteceu, digitados ou
      montados pela Mira Pro a partir de uma descrição);
   2. Quando: o calendário da fábrica (Turnos e berços) e o dia simulado;
   3. Premissas: crescimento, variação, picos, metas;
   4. Frota a testar: de quantos a quantos Atta de cada modelo.
   Rodar: "achar a frota" põe um Atta de cada vez onde mais falta até
   cumprir as metas, depois testa a previsão (+25/50/100% de demanda e um
   Atta parado). Os números vêm sempre da simulação; a Mira Pro só monta
   o rascunho dos fluxos e escreve o resumo.

   Quem usa: a E4M (o fornecedor), para estudar a ampliação de uma empresa que já usa o Eciton (0.22: saiu do Eciton do cliente; prospects ficam em Estudos de frota). Na nuvem fica em
   public.estudos; sem nuvem, neste navegador (estudosFrota).
*/
const EstudoTela = (function () {
    const CHAVE = "estudosFrota";
    const esc = t => String(t ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
    const naNuvem = () => Boolean(window.Nuvem && Nuvem.emNuvem && Nuvem.emNuvem());
    const pode = () => !naNuvem() || Nuvem.pode("estudo");
    const n1 = v => (v == null || !Number.isFinite(v) ? "--" : ui.numero(v, v < 10 ? 1 : 0));
    const pct = v => (v == null || !Number.isFinite(v) ? "--" : `${Math.round(v * 100)}%`);
    const faixaPct = f => (f && f[1] != null ? `${pct(f[1])} <small class="suave">(${pct(f[0])} a ${pct(f[2])})</small>` : "--");
    const minTxt = v => (v == null || !Number.isFinite(v) ? "--" : `${ui.numero(v, v < 10 ? 1 : 0)} min`);
    const nomeModelo = id => (typeof Modelos !== "undefined" && Modelos.porId(id)?.nome) || id;
    const DIAS = [[1, "Segunda"], [2, "Terça"], [3, "Quarta"], [4, "Quinta"], [5, "Sexta"], [6, "Sábado"], [0, "Domingo"]];
    const PREMISSAS = [
        ["crescimento", "Crescimento da demanda", "%", "mais pedidos do que hoje (0 = igual)"],
        ["variacao", "Variação de um dia para outro", "%", "quanto um dia pode ser mais cheio que outro"],
        ["picoInicio", "Pico no começo do turno", "%", "a mais na 1ª hora (todo mundo pede junto)"],
        ["picoVolta", "Pico na volta do intervalo", "%", "a mais na meia hora depois do almoço"],
        ["ocupacaoMax", "Ocupação máxima de cada Atta", "%", "acima disso não sobra folga para imprevisto"],
        ["prazoAlvo", "Entregas no prazo (meta)", "%", "a frota recomendada cumpre esta meta"],
        ["indisponiveis", "Atta em manutenção", "", "quantos ficam fora o tempo todo"],
        ["rodadas", "Dias simulados por frota", "", "mais dias = faixa mais confiável, estudo mais lento"]
    ];

    let estudos = [], atual = null, aba = "cenario", rodando = null, carregado = false, sujo = false;

    /* ---------------- guardar ---------------- */
    const novo = nome => ({ id: null, nome: nome || "Estudo de frota", dados: { fluxos: [], premissas: Object.assign({}, Estudo.PREMISSAS_PADRAO), frotas: [], busca: "achar", dia: 1 }, resultado: null });
    function lerLocal() { try { return JSON.parse(localStorage.getItem(CHAVE) || "[]"); } catch (e) { return []; } }
    function gravarLocal() { try { localStorage.setItem(CHAVE, JSON.stringify(estudos)); } catch (e) { ui.aviso("Sem espaço no navegador para guardar o estudo.", "erro"); } }

    async function carregar() {
        if (naNuvem()) {
            const r = await Nuvem.cliente().from("estudos").select("id, nome, dados, resultado, por_nome, atualizado_em").eq("empresa_id", Nuvem.empresa().id).order("atualizado_em", { ascending: false });
            if (r.error) { estudos = []; if (!/estudos/.test(r.error.message || "")) ui.aviso(r.error.message, "erro"); }
            else estudos = r.data || [];
        } else estudos = lerLocal();
        carregado = true;
        if (atual?.id) atual = JSON.parse(JSON.stringify(estudos.find(e => e.id === atual.id) || atual));
        else if (!atual) atual = estudos[0] ? JSON.parse(JSON.stringify(estudos[0])) : novo();
        desenhar();
    }
    async function salvar(silencioso) {
        if (!pode()) { ui.aviso("Só a E4M salva estudos de frota.", "aviso"); return false; }
        const e = atual;
        if (naNuvem()) {
            const r = await Nuvem.cliente().rpc("salvar_estudo", { p_empresa: Nuvem.empresa().id, p_id: e.id, p_nome: e.nome, p_dados: e.dados, p_resultado: e.resultado });
            if (r.error) { ui.aviso(r.error.message || "Não foi possível salvar o estudo.", "erro"); return false; }
            e.id = r.data;
            const i = estudos.findIndex(x => x.id === e.id);
            const copia = JSON.parse(JSON.stringify(e));
            if (i >= 0) estudos[i] = copia; else estudos.unshift(copia);
        } else {
            if (!e.id) e.id = "L" + Date.now().toString(36);
            e.atualizado_em = new Date().toISOString();
            estudos = [JSON.parse(JSON.stringify(e))].concat(estudos.filter(x => x.id !== e.id));
            gravarLocal();
        }
        sujo = false;
        if (!silencioso) ui.aviso("Estudo salvo.", "sucesso");
        desenhar();
        return true;
    }
    async function apagar() {
        if (!atual?.id) { atual = estudos[0] ? JSON.parse(JSON.stringify(estudos[0])) : novo(); desenhar(); return; }
        if (!await ui.confirmar({ titulo: "Apagar o estudo?", texto: `"${atual.nome}" e o resultado dele somem de vez.`, confirmar: "Apagar", perigo: true })) return;
        if (naNuvem()) {
            const r = await Nuvem.cliente().rpc("apagar_estudo", { p_id: atual.id });
            if (r.error) { ui.aviso(r.error.message, "erro"); return; }
        }
        estudos = estudos.filter(x => x.id !== atual.id);
        if (!naNuvem()) gravarLocal();
        atual = estudos[0] ? JSON.parse(JSON.stringify(estudos[0])) : novo();
        aba = "cenario";
        desenhar();
    }
    function mudou() { sujo = true; if (atual.resultado) atual.resultado.desatualizado = true; }

    /* ---------------- dados da planta ---------------- */
    const planta = () => (typeof plantaPublicada === "function" ? plantaPublicada() : null);
    const listaMissoes = () => (typeof missoes !== "undefined" && Array.isArray(missoes) ? missoes : []);
    const listaPostos = () => (typeof Despacho !== "undefined" && Despacho.postos ? Despacho.postos() : []);
    const listaProgramacoes = () => (typeof Programacao !== "undefined" && Programacao.lista ? Programacao.lista() : []);
    const pontos = () => (planta()?.nos || []).filter(n => ["ESTACAO", "ESPERA", "BERCO"].includes(n.tipo));
    const calendario = () => {
        const c = typeof Calendario !== "undefined" && Calendario.atual ? Calendario.atual() : null;
        return c && (c.turnos || []).length ? c : { turnos: [{ id: "_", nome: "Dia", inicio: "06:00", fim: "22:00", dias: [0, 1, 2, 3, 4, 5, 6] }], intervalos: [], paradas: [] };
    };
    function sincronizarFrotas() {
        // um grupo por modelo usado nos fluxos (sem apagar o que a pessoa ajustou)
        const usados = [...new Set(atual.dados.fluxos.filter(f => f.ativo !== false).flatMap(f => f.modelos || []))];
        usados.forEach(m => { if (!atual.dados.frotas.some(g => g.modelo === m)) atual.dados.frotas.push({ modelo: m, de: 1, ate: 6 }); });
    }

    /* ---------------- fluxos ---------------- */
    const idFluxo = () => "F" + Math.random().toString(36).slice(2, 8);
    function importarDaPlanta() {
        const lista = Estudo.fluxosDaPlanta(listaPostos(), listaProgramacoes(), listaMissoes());
        if (!lista.length) { ui.aviso("Nenhum posto com botão de missão. Cadastre os postos (Operação › Postos) ou monte os fluxos à mão.", "aviso"); return; }
        const ja = new Set(atual.dados.fluxos.map(f => f.id));
        const novos = lista.filter(f => !ja.has(f.id));
        atual.dados.fluxos.push(...novos);
        sincronizarFrotas(); mudou(); desenhar();
        ui.aviso(novos.length ? `${novos.length} fluxo(s) dos postos. Confira a demanda de cada um.` : "Os fluxos dos postos já estão no estudo.", "sucesso");
    }
    async function repetirDia() {
        if (!atual.dados.fluxos.length) importarDaPlanta();
        if (!atual.dados.fluxos.length) return;
        const ontem = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
        const v = await ui.formulario({ titulo: "Repetir a demanda de um dia", confirmar: "Usar este dia", campos: [{ nome: "dia", rotulo: "Dia", tipo: "date", valor: ontem }],
            texto: "Os pedidos daquele dia (de cada botão de posto) viram horários fixos no estudo. Bom para responder: \"com a frota de hoje, aquele dia teria dado conta?\"" });
        if (!v?.dia) return;
        let pedidos = [];
        if (naNuvem()) {
            const ini = new Date(`${v.dia}T00:00:00-03:00`).toISOString(), fim = new Date(Date.parse(`${v.dia}T00:00:00-03:00`) + 86400000).toISOString();
            const r = await Nuvem.cliente().from("pedidos").select("posto, missao, estado, criado_em").eq("empresa_id", Nuvem.empresa().id).gte("criado_em", ini).lt("criado_em", fim).limit(5000);
            if (r.error) { ui.aviso(r.error.message, "erro"); return; }
            pedidos = (r.data || []).map(x => ({ posto: x.posto, missao: x.missao, estado: x.estado, criadoEm: Date.parse(x.criado_em) }));
        } else pedidos = typeof Despacho !== "undefined" ? Despacho.lista() : [];
        const doDia = Estudo.fluxosDoDia(pedidos, atual.dados.fluxos, v.dia);
        const total = doDia.reduce((s, f) => s + (f.demanda.horarios || []).length, 0);
        if (!total) { ui.aviso(`Nenhum pedido dos postos em ${v.dia.split("-").reverse().join("/")}.`, "aviso"); return; }
        atual.dados.fluxos = doDia;
        atual.dados.dia = new Date(`${v.dia}T12:00:00-03:00`).getDay();
        mudou(); desenhar();
        ui.aviso(`${total} pedidos de ${v.dia.split("-").reverse().join("/")} viraram horários.`, "sucesso");
    }
    async function editarFluxo(id) {
        const f = id ? atual.dados.fluxos.find(x => x.id === id) : null;
        const base = f || { id: idFluxo(), nome: "", missao: listaMissoes()[0]?.id || "", modelos: [], demanda: { tipo: "porHora", porHora: 2 }, pegarS: 30, entregarS: 30, prazoMin: 15, prioridade: 1, ativo: true, origem: "digitado" };
        const d = base.demanda || {};
        const mods = typeof Modelos !== "undefined" ? Modelos.disponiveis() : [];
        const v = await ui.formulario({ titulo: f ? `Fluxo: ${f.nome}` : "Novo fluxo", confirmar: f ? "Aplicar" : "Pôr no estudo", campos: [
            { nome: "nome", rotulo: "Nome", valor: base.nome, obrigatorio: true, max: 60, largo: true, placeholder: "ex.: Kit da submontagem 1" },
            { nome: "missao", rotulo: "Missão", valor: base.missao || "__rota", opcoes: listaMissoes().map(m => [m.id, `${m.id} · ${m.nome || ""}`]).concat([["__rota", "Sem missão: de um ponto a outro"]]) },
            { nome: "prazoMin", rotulo: "Prazo (min, do pedido à entrega)", tipo: "number", valor: base.prazoMin },
            { nome: "de", rotulo: "Pega em (sem missão)", valor: base.de || "", opcoes: [["", "—"]].concat(pontos().map(n => [n.id, `${n.id}${n.nome ? " · " + n.nome : ""}`])) },
            { nome: "para", rotulo: "Entrega em (sem missão)", valor: base.para || "", opcoes: [["", "—"]].concat(pontos().map(n => [n.id, `${n.id}${n.nome ? " · " + n.nome : ""}`])) },
            { nome: "tipo", rotulo: "Demanda", tipo: "radio", valor: d.tipo || "porHora", opcoes: [["porHora", "Viagens por hora"], ["consumo", "Pelo consumo", "peças por hora ÷ peças por viagem"], ["horarios", "Horários fixos"]] },
            { nome: "porHora", rotulo: "Viagens por hora", tipo: "number", valor: d.porHora ?? "" },
            { nome: "horarios", rotulo: "Horários (separe com vírgula)", valor: (d.horarios || []).join(", "), placeholder: "08:00, 10:30, 14:00" },
            { nome: "pecasHora", rotulo: "Peças consumidas por hora", tipo: "number", valor: d.pecasHora ?? "" },
            { nome: "porViagem", rotulo: "Peças por viagem (carrinho, caixa)", tipo: "number", valor: d.porViagem ?? "" },
            { nome: "pegarS", rotulo: "Tempo para pegar (s)", tipo: "number", valor: base.pegarS },
            { nome: "entregarS", rotulo: "Tempo para entregar (s)", tipo: "number", valor: base.entregarS },
            { nome: "prioridade", rotulo: "Prioridade", valor: String(base.prioridade ?? 1), opcoes: [["0", "Baixa"], ["1", "Normal"], ["2", "Alta"], ["3", "Urgente"]] },
            ...mods.map(m => ({ nome: "m_" + m.id, rotulo: `Atende: ${m.nome}`, tipo: "checkbox", valor: (base.modelos || []).includes(m.id), largo: false }))
        ] });
        if (!v) return;
        const numero = (x, p) => { const n = Number(String(x).replace(",", ".")); return Number.isFinite(n) && String(x).trim() !== "" ? n : p; };
        const semMissao = v.missao === "__rota";
        if (semMissao && (!v.de || !v.para || v.de === v.para)) { ui.aviso("Sem missão: escolha onde pega e onde entrega (pontos diferentes).", "aviso"); return; }
        const demanda = v.tipo === "consumo" ? { tipo: "consumo", pecasHora: numero(v.pecasHora, 0), consumoPeca: 1, porViagem: Math.max(1, numero(v.porViagem, 1)) }
            : v.tipo === "horarios" ? { tipo: "horarios", horarios: String(v.horarios || "").split(/[,;\s]+/).filter(h => /^\d{1,2}:\d{2}$/.test(h)).map(h => h.padStart(5, "0")).sort() }
            : { tipo: "porHora", porHora: Math.max(0, numero(v.porHora, 0)) };
        const pronto = Object.assign({}, base, {
            nome: v.nome.trim().slice(0, 60), missao: semMissao ? "" : v.missao, de: semMissao ? v.de : "", para: semMissao ? v.para : "",
            prazoMin: Math.max(1, numero(v.prazoMin, 15)), pegarS: Math.max(0, numero(v.pegarS, 30)), entregarS: Math.max(0, numero(v.entregarS, 30)),
            prioridade: Number(v.prioridade) || 0, demanda, modelos: mods.filter(m => v["m_" + m.id]).map(m => m.id)
        });
        if (f) Object.assign(f, pronto); else atual.dados.fluxos.push(pronto);
        sincronizarFrotas(); mudou(); desenhar();
    }
    async function montarComMira() {
        if (!window.Mira || !Mira.temPro()) { ui.aviso("Montar os fluxos pela descrição é da Mira Pro (adicional do plano).", "aviso"); return; }
        const v = await ui.formulario({ titulo: "Montar os fluxos com a Mira Pro", confirmar: "Pedir à Mira", campos: [
            { nome: "texto", rotulo: "Conte como é a operação", tipo: "textarea", linhas: 6, max: 1800, largo: true, obrigatorio: true,
                placeholder: "ex.: 4 linhas de submontagem consomem 120 peças/h cada; o kit leva 30 peças e sai do supermercado KITS. A solda recebe um carrinho a cada 20 min da prensa..." }
        ], texto: "A Mira monta o rascunho dos fluxos com as missões, os pontos e os modelos da sua planta. Você confere na tabela antes de rodar: os números do estudo vêm sempre da simulação." });
        if (!v?.texto) return;
        const pl = planta();
        const contexto = {
            missoes: listaMissoes().slice(0, 60).map(m => ({ id: m.id, nome: m.nome || "", etapas: (m.etapas || []).map(e => e.tipo + (e.destino ? " " + e.destino : "")).join(", ") })),
            pontos: (pl?.nos || []).filter(n => ["ESTACAO", "ESPERA", "BERCO"].includes(n.tipo)).slice(0, 120).map(n => ({ id: n.id, nome: n.nome || "", tipo: n.tipo })),
            modelos: (typeof Modelos !== "undefined" ? Modelos.disponiveis() : []).map(m => ({ id: m.id, nome: m.nome, modulo: m.modulo })),
            postos: listaPostos().slice(0, 40).map(p => ({ id: p.id, nome: p.nome, botoes: (p.botoes || []).map(b => b.missao) })),
            fluxosAtuais: atual.dados.fluxos.slice(0, 30).map(f => f.nome)
        };
        Mira.abrir(true);
        const r = await Mira.perguntar(v.texto, { modo: "pro", tarefa: "estudo_fluxos", contexto, semHistorico: true });
        if (!r || r.erro) return;
        const lista = (r.fluxos || []).map(f => ({
            id: idFluxo(), nome: f.nome, missao: f.missao || "", de: f.de || "", para: f.para || "", modelos: f.modelos || [],
            demanda: { tipo: "porHora", porHora: f.porHora }, prazoMin: f.prazoMin, pegarS: f.pegarS, entregarS: f.entregarS, prioridade: f.prioridade, ativo: true, origem: "Mira Pro", obs: f.obs || ""
        }));
        if (!lista.length) { ui.aviso("A Mira não montou nenhum fluxo que bata com a planta. Tente descrever com os nomes dos pontos e das missões.", "aviso"); return; }
        atual.dados.fluxos.push(...lista);
        sincronizarFrotas(); mudou(); desenhar();
        ui.aviso(`A Mira montou ${lista.length} fluxo(s). Confira cada um antes de rodar.`, "sucesso");
    }

    /* ---------------- rodar ---------------- */
    async function rodar() {
        const pl = planta();
        if (!pl?.nos?.length) { ui.aviso("Publique a planta primeiro (Fábrica › Planta): o estudo usa as rotas dela.", "aviso"); return; }
        const fl = atual.dados.fluxos.filter(f => f.ativo !== false);
        if (!fl.length) { ui.aviso("Coloque pelo menos um fluxo.", "aviso"); return; }
        sincronizarFrotas();
        if (!atual.dados.frotas.some(g => Number(g.ate) > 0)) { ui.aviso("Diga de quantos a quantos Atta de cada modelo testar.", "aviso"); return; }
        const cal = calendario();
        const cenario = { calendario: cal, fluxos: fl, premissas: Object.assign({}, atual.dados.premissas, { dia: Number(atual.dados.dia ?? 1) }), frotas: atual.dados.frotas, busca: atual.dados.busca === "todas" ? "todas" : "achar" };
        rodando = 0; aba = "resultado"; desenhar();
        let res;
        try {
            res = await Estudo.rodar(cenario, { planta: pl, missoes: listaMissoes() }, p => { rodando = p; const b = document.getElementById("estudoProgresso"); if (b) { b.value = p; b.nextElementSibling.textContent = `${Math.round(p * 100)}%`; } });
        } catch (e) {
            rodando = null; aba = "cenario"; desenhar();
            ui.aviso("O estudo não rodou: " + (e.message || e), "erro"); return;
        }
        rodando = null;
        atual.resultado = {
            em: new Date().toISOString(), planta: { nome: pl.nome || "", revisao: pl.revisao || 0 }, calendario: cal, dia: cenario.premissas.dia,
            cenarios: res.cenarios, recomendado: res.recomendado, sensibilidade: res.sensibilidade, premissas: res.premissas, avisos: res.avisos,
            fluxos: res.fluxos, viagens: res.viagens, diaUtil: res.dia, ms: res.ms, busca: cenario.busca, resumoMira: "", limite: res.limite, gargalo: res.gargalo
        };
        if (typeof CamadasMapa !== "undefined" && CamadasMapa.definirEstudo) CamadasMapa.definirEstudo(atual.resultado, atual.nome);
        if (pode()) await salvar(true);
        desenhar();
        ui.aviso(res.recomendado ? `Frota recomendada: ${res.recomendado.nome}.` : "Nenhuma frota testada cumpre as metas. Veja o resultado.", res.recomendado ? "sucesso" : "aviso");
    }

    /* ---------------- gráficos (SVG simples) ---------------- */
    function graficoHoras(porHora, { altura = 150 } = {}) {
        if (!porHora?.length) return "";
        const w = 640, h = altura, m = { e: 30, d: 6, t: 10, b: 22 };
        const max = Math.max(1, ...porHora.map(x => Math.max(x.pedidos || 0, x.entregas || 0)));
        const passo = (w - m.e - m.d) / porHora.length, larg = Math.max(2, passo / 2 - 2);
        const y = v => m.t + (h - m.t - m.b) * (1 - v / max);
        const barras = porHora.map((x, i) => {
            const x0 = m.e + i * passo + 1;
            return `<g><title>${x.h}h: ${Math.round(x.pedidos || 0)} pedidos, ${Math.round(x.entregas || 0)} entregas, ocupação ${pct(x.ocupacao)}</title>
                <rect x="${x0}" y="${y(x.pedidos || 0)}" width="${larg}" height="${h - m.b - y(x.pedidos || 0)}" rx="2" class="eg-pedidos"/>
                <rect x="${x0 + larg + 2}" y="${y(x.entregas || 0)}" width="${larg}" height="${h - m.b - y(x.entregas || 0)}" rx="2" class="eg-entregas"/>
                <text x="${x0 + larg}" y="${h - 6}" text-anchor="middle" class="eg-eixo">${x.h}h</text></g>`;
        }).join("");
        const grade = [0, 0.5, 1].map(f => `<line x1="${m.e}" x2="${w - m.d}" y1="${y(max * f)}" y2="${y(max * f)}" class="eg-grade"/><text x="${m.e - 4}" y="${y(max * f) + 4}" text-anchor="end" class="eg-eixo">${Math.round(max * f)}</text>`).join("");
        return `<figure class="estudo-grafico"><svg viewBox="0 0 ${w} ${h}" role="img" aria-label="Pedidos e entregas por hora">${grade}${barras}</svg>
            <figcaption class="ind-legenda"><span><i class="eg-pedidos"></i>Pedidos</span><span><i class="eg-entregas"></i>Entregas</span></figcaption></figure>`;
    }
    function graficoOcupacao(porHora) {
        if (!porHora?.length) return "";
        return `<div class="estudo-ocup" role="img" aria-label="Ocupação da frota por hora">${porHora.map(x => `<span title="${x.h}h: ${pct(x.ocupacao)}"><i style="height:${Math.min(100, Math.round((x.ocupacao || 0) * 100))}%"></i><b>${x.h}</b></span>`).join("")}</div>`;
    }
    const tabela = (cab, linhas, classe = "") => `<div class="tabela-rolagem"><table class="tabela-usuarios ind-tabela ${classe}"><thead><tr>${cab.map(c => `<th>${c}</th>`).join("")}</tr></thead><tbody>${linhas.map(l => `<tr>${l.map(c => `<td>${c}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
    const tile = (rotulo, valor, sub) => `<div class="tile ind-tile"><div class="tile-rotulo">${esc(rotulo)}</div><div class="tile-valor">${valor}</div>${sub ? `<div class="ind-sub">${sub}</div>` : ""}</div>`;

    /* ---------------- textos do resultado ---------------- */
    function demandaTexto(f) {
        const d = f.demanda || {};
        if (d.tipo === "consumo") return `${n1(d.pecasHora)} peças/h ÷ ${n1(d.porViagem)} = ${n1(Estudo.taxaBase(f))}/h`;
        if (d.tipo === "horarios") return `${(d.horarios || []).length} horários`;
        return `${n1(d.porHora)}/h`;
    }
    // a frota que a situação pede (ou por que nenhuma resolve)
    function precisaTexto(s) {
        if (s.atende) return "a mesma";
        if (s.precisa) return s.precisa.nome;
        if (s.limite === "trafego") return `mais Atta não resolve: o tráfego${s.gargalo ? ` em ${s.gargalo}` : ""} trava antes${s.melhor ? ` (no máximo ${pct(s.melhor.noPrazo[1])} no prazo, com ${s.melhor.nome})` : ""}`;
        return "mais de 6 a mais de cada modelo";
    }
    const rotaTexto = f => (f.missao ? esc(f.missao) : f.de ? `${esc(f.de)} → ${esc(f.para)}` : "--");
    function resumoAutomatico(R) {
        const rec = R.recomendado;
        const pr = R.premissas;
        const pedidosDia = rec ? rec.r.pedidos[1] : R.cenarios[0]?.r.pedidos[1];
        const partes = [];
        if (rec) {
            partes.push(`Para atender cerca de ${Math.round(pedidosDia)} pedidos por dia (${R.fluxos.length} fluxos), a menor frota que cumpre as metas é ${rec.nome}: ${pct(rec.r.noPrazo[1])} das entregas no prazo (de ${pct(rec.r.noPrazo[0])} num dia ruim a ${pct(rec.r.noPrazo[2])} num dia bom), entrega em ${minTxt(rec.r.tempoMedio[1])} em média e cada Atta ocupado ${pct(rec.r.ocupacao[1])} do tempo.`);
            const antes = R.cenarios.filter(c => c.total < rec.total).slice(-1)[0];
            if (antes) partes.push(`Com um Atta a menos (${antes.nome}), só ${pct(antes.r.noPrazo[1])} sairiam no prazo${antes.r.naoAtendidos[1] > 0.5 ? (Math.round(antes.r.naoAtendidos[1]) === 1 ? " e sobraria 1 pedido no fim do dia" : ` e sobrariam ${Math.round(antes.r.naoAtendidos[1])} pedidos no fim do dia`) : ""}.`);
            const zonas = Object.entries(rec.r.esperaZona || {}).sort((a, b) => b[1] - a[1]).slice(0, 2);
            if (zonas.length && zonas[0][1] > 60) partes.push(`O tráfego custa ${minTxt(rec.r.esperaTrafegoMin[1])} de espera por dia, quase tudo em ${zonas.map(([z, s]) => `${z} (${minTxt(s / 60)})`).join(" e ")}.`);
            const travados = R.sensibilidade.filter(s => !s.atende && !s.precisa && s.limite === "trafego" && s.crescimento);
            R.sensibilidade.filter(s => !travados.includes(s)).forEach(s => {
                if (s.atende) partes.push(`${s.nome}: a mesma frota ainda dá conta (${pct(s.r.noPrazo[1])} no prazo).`);
                else partes.push(`${s.nome}: a frota não dá conta (${pct(s.r.noPrazo[1])} no prazo)${s.precisa ? `; seriam necessários ${s.precisa.nome}` : "; nem com 6 Atta a mais de cada modelo"}.`);
            });
            if (travados.length) {
                const nomes = travados.map(s => s.nome.replace(" de demanda", ""));
                const lista = nomes.length > 1 ? nomes.slice(0, -1).join(", ") + " e " + nomes[nomes.length - 1] : nomes[0];
                const g = travados[0].gargalo;
                partes.push(`Com ${lista} de demanda (${travados.map(s => pct(s.r.noPrazo[1])).join(", ")} no prazo), mais Atta não resolve: o tráfego${g ? ` em ${g}` : ""} trava antes. Para crescer, o caminho é o layout (outro corredor, mão única, outra estação), não só a frota.`);
            }
        } else {
            const ult = R.cenarios[R.cenarios.length - 1];
            partes.push(`Nenhuma frota testada cumpre a meta de ${pct(pr.prazoAlvo)} no prazo com ocupação até ${pct(pr.ocupacaoMax)}.${ult ? ` A maior testada (${ult.nome}) chegou a ${pct(ult.r.noPrazo[1])} no prazo.` : ""} Aumente a faixa de Atta, revise os prazos ou a demanda.`);
        }
        return partes;
    }

    /* ---------------- desenhar ---------------- */
    function htmlTopo() {
        const opcoes = estudos.map(e => `<option value="${esc(e.id)}" ${e.id === atual.id ? "selected" : ""}>${esc(e.nome)}</option>`).join("");
        return `<section class="card estudo-topo">
            <div class="estudo-topo-linha">
                <div><h2>Estudo de frota</h2><p class="suave">Quantos Atta a operação precisa, simulando o turno inteiro na sua planta: rotas, cruzamentos, calendário e picos. Rode antes de comprar, de mudar o layout ou de aumentar a produção.</p></div>
                <div class="estudo-escolha">
                    <label class="campo"><span>Estudo</span><select id="estudoEscolha">${atual.id ? "" : `<option value="">${esc(atual.nome)} (novo)</option>`}${opcoes}</select></label>
                    <div class="grupo">
                        <button type="button" class="btn" data-estudo="novo">Novo</button>
                        ${atual.id ? `<button type="button" class="btn" data-estudo="duplicar">Duplicar</button><button type="button" class="btn btn-perigo-suave" data-estudo="apagar">Apagar</button>` : ""}
                    </div>
                </div>
            </div>
            <div class="estudo-nome"><label class="campo"><span>Nome</span><input type="text" id="estudoNome" maxlength="80" value="${esc(atual.nome)}" autocomplete="off"></label>
                ${sujo ? `<button type="button" class="btn btn-primario" data-estudo="salvar">Salvar</button>` : `<span class="suave">${atual.id ? "Salvo" : ""}</span>`}</div>
            <nav class="ind-abas" role="tablist">
                <button type="button" role="tab" data-estudo-aba="cenario" class="${aba === "cenario" ? "ativo" : ""}" aria-selected="${aba === "cenario"}">Cenário</button>
                <button type="button" role="tab" data-estudo-aba="resultado" class="${aba === "resultado" ? "ativo" : ""}" aria-selected="${aba === "resultado"}" ${atual.resultado || rodando != null ? "" : "disabled"}>Resultado${atual.resultado?.desatualizado ? " (antigo)" : ""}</button>
            </nav>
        </section>`;
    }

    function htmlCenario() {
        const d = atual.dados;
        const fl = d.fluxos;
        const temPro = window.Mira && Mira.temPro && Mira.temPro();
        const total = fl.filter(f => f.ativo !== false).reduce((s, f) => s + Estudo.taxaBase(f), 0);
        const dem = fl.length ? Estudo.demandaPorHora({ calendario: calendario(), fluxos: fl, premissas: Object.assign({}, d.premissas, { dia: d.dia }) }) : [];
        const cal = calendario();
        const turnos = (cal.turnos || []).filter(t => (t.dias || []).includes(Number(d.dia)));
        const intervalos = (cal.intervalos || []).filter(t => (t.dias || []).includes(Number(d.dia)) && !(t.postos || []).length);
        const mods = typeof Modelos !== "undefined" ? Modelos.disponiveis() : [];
        return `
        <section class="card">
            <div class="estudo-cab"><h3>1. O que a frota leva</h3>
                <div class="grupo">
                    <button type="button" class="btn" data-estudo="importar">Importar dos postos</button>
                    <button type="button" class="btn" data-estudo="dia">Repetir um dia</button>
                    <button type="button" class="btn" data-estudo="fluxo">+ Fluxo</button>
                    ${temPro ? `<button type="button" class="btn" data-estudo="mira">Montar com a Mira Pro</button>` : ""}
                </div></div>
            ${fl.length ? tabela(["", "Fluxo", "Missão / rota", "Quem atende", "Demanda", "Prazo", ""], fl.map(f => [
                `<input type="checkbox" data-fluxo-ativo="${esc(f.id)}" ${f.ativo !== false ? "checked" : ""} aria-label="Usar ${esc(f.nome)}">`,
                `<b>${esc(f.nome)}</b>${f.origem && f.origem !== "digitado" ? `<small class="suave estudo-origem">${esc(f.origem)}</small>` : ""}${f.obs ? `<small class="suave estudo-origem">${esc(f.obs)}</small>` : ""}`,
                rotaTexto(f),
                (f.modelos || []).length ? f.modelos.map(m => `<span class="estudo-chip">${esc(nomeModelo(m))}</span>`).join(" ") : `<span class="suave">qualquer um</span>`,
                f.demanda?.tipo === "porHora" ? `<input type="number" min="0" step="0.5" class="estudo-num" data-fluxo-porhora="${esc(f.id)}" value="${f.demanda.porHora}" aria-label="Viagens por hora de ${esc(f.nome)}"> /h` : esc(demandaTexto(f)),
                `<input type="number" min="1" step="1" class="estudo-num" data-fluxo-prazo="${esc(f.id)}" value="${f.prazoMin}" aria-label="Prazo de ${esc(f.nome)}"> min`,
                `<button type="button" class="btn btn-mini" data-fluxo-editar="${esc(f.id)}">Editar</button> <button type="button" class="btn-remover-fila" data-fluxo-tirar="${esc(f.id)}" aria-label="Tirar ${esc(f.nome)}">×</button>`
            ]), "estudo-fluxos") : `<div class="empty-state">Comece por <b>Importar dos postos</b>: um fluxo por botão, com a demanda da programação. Ou monte à mão com <b>+ Fluxo</b>.</div>`}
            ${fl.length ? `<p class="suave estudo-total">${n1(total)} viagens por hora em média, sem picos${dem.length ? ` · cerca de ${Math.round(dem.reduce((s, x) => s + x.pedidos, 0))} pedidos no dia, com picos` : ""}.</p>` : ""}
        </section>
        <section class="card estudo-duas">
            <div>
                <h3>2. Quando</h3>
                <label class="campo"><span>Dia simulado</span><select id="estudoDia">${DIAS.map(([v, n]) => `<option value="${v}" ${Number(d.dia) === v ? "selected" : ""}>${n}</option>`).join("")}</select></label>
                <p class="suave">${turnos.length ? `Turnos: ${turnos.map(t => `${esc(t.nome)} ${t.inicio}–${t.fim}`).join(", ")}` : "Sem turno neste dia."}${intervalos.length ? `<br>Intervalos: ${intervalos.map(t => `${esc(t.nome)} ${t.inicio}–${t.fim} (${t.acao === "BERCO" ? "no berço" : t.acao === "URGENTES" ? "só urgentes" : "trabalhando"})`).join(", ")}` : ""}<br>Vem do calendário da fábrica (Frota › Turnos e berços).</p>
            </div>
            <div>
                <h3>3. Premissas</h3>
                <div class="estudo-premissas">${PREMISSAS.map(([k, rot, un, dica]) => {
                    const v = d.premissas[k] ?? Estudo.PREMISSAS_PADRAO[k];
                    return `<label class="campo" title="${esc(dica)}"><span>${esc(rot)}</span><span class="estudo-un"><input type="number" step="1" min="0" data-premissa="${k}" value="${un === "%" ? Math.round(v * 100) : v}">${un ? `<i>${un}</i>` : ""}</span></label>`;
                }).join("")}</div>
            </div>
        </section>
        <section class="card">
            <div class="estudo-cab"><h3>4. Frota a testar</h3>
                <div class="grupo-segmentado" role="radiogroup" aria-label="Como testar">
                    <button type="button" data-estudo-busca="achar" class="${d.busca !== "todas" ? "ativo" : ""}" aria-pressed="${d.busca !== "todas"}">Achar a frota</button>
                    <button type="button" data-estudo-busca="todas" class="${d.busca === "todas" ? "ativo" : ""}" aria-pressed="${d.busca === "todas"}">Testar todas as combinações</button>
                </div></div>
            <p class="suave">${d.busca === "todas" ? `Roda cada combinação das faixas (até ${Estudo.MAX_FROTAS}) e recomenda a menor que cumpre as metas.` : "Começa no mínimo de cada modelo e põe um Atta de cada vez onde mais falta, até cumprir as metas. Mais rápido."}</p>
            ${d.frotas.length ? tabela(["Modelo", "De", "Até", ""], d.frotas.map((g, i) => [
                `<b>${esc(nomeModelo(g.modelo))}</b>`,
                `<input type="number" min="0" max="40" class="estudo-num" data-frota-de="${i}" value="${g.de}" aria-label="Mínimo de ${esc(nomeModelo(g.modelo))}">`,
                `<input type="number" min="0" max="40" class="estudo-num" data-frota-ate="${i}" value="${g.ate}" aria-label="Máximo de ${esc(nomeModelo(g.modelo))}">`,
                `<button type="button" class="btn-remover-fila" data-frota-tirar="${i}" aria-label="Tirar ${esc(nomeModelo(g.modelo))}">×</button>`
            ])) : ""}
            <div class="grupo estudo-mais-modelo"><select id="estudoMaisModelo" aria-label="Modelo">${mods.filter(m => !d.frotas.some(g => g.modelo === m.id)).map(m => `<option value="${esc(m.id)}">${esc(m.nome)}</option>`).join("")}</select><button type="button" class="btn btn-mini" data-estudo="maisModelo">+ Modelo</button></div>
        </section>
        <div class="estudo-rodar">
            <button type="button" class="btn btn-primario btn-grande" data-estudo="rodar" ${fl.length ? "" : "disabled"}>Rodar o estudo</button>
            <span class="suave">Leva de alguns segundos a um minuto. Usa a planta publicada${planta()?.revisao ? ` (rev ${planta().revisao})` : ""}.</span>
        </div>`;
    }

    function htmlResultado() {
        if (rodando != null) return `<section class="card estudo-rodando"><h3>Simulando o turno…</h3><progress id="estudoProgresso" max="1" value="${rodando}"></progress><span>${Math.round(rodando * 100)}%</span><p class="suave">Cada frota roda ${atual.dados.premissas.rodadas || 8} dias com variação; depois vem a previsão com mais demanda e com um Atta parado.</p></section>`;
        const R = atual.resultado;
        if (!R) return `<div class="empty-state">Rode o estudo na aba Cenário.</div>`;
        const rec = R.recomendado, r = rec?.r || R.cenarios[R.cenarios.length - 1]?.r;
        const temPro = window.Mira && Mira.temPro && Mira.temPro();
        const zonas = Object.entries(r?.esperaZona || {}).sort((a, b) => b[1] - a[1]).slice(0, 8);
        const trechos = Object.entries(r?.passagens || {}).sort((a, b) => b[1] - a[1]).slice(0, 8);
        return `
        ${R.desatualizado ? `<div class="missao-dica ambar">O cenário mudou depois deste resultado. Rode de novo para atualizar.</div>` : ""}
        <section class="card estudo-recomendacao ${rec ? "ok" : "falta"}">
            <div class="tile-rotulo">${rec ? "Frota recomendada" : "Nenhuma frota testada cumpre as metas"}</div>
            <div class="estudo-frota">${esc(rec ? rec.nome : R.cenarios[R.cenarios.length - 1]?.nome || "--")}</div>
            ${(() => { const t = resumoAutomatico(R); return `<p>${esc(t[0])}</p>${t.length > 1 ? `<ul class="estudo-pontos">${t.slice(1).map(x => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}`; })()}
            <div class="grupo">
                <button type="button" class="btn btn-primario" data-estudo="pdf">${ui.icone("pdf", "icone-p")}Relatório completo (PDF)</button>
                ${temPro ? `<button type="button" class="btn" data-estudo="resumoMira">${R.resumoMira ? "Refazer o resumo com a Mira Pro" : "Resumo para a diretoria (Mira Pro)"}</button>` : ""}
                ${rec ? `<button type="button" class="btn" data-estudo="virtual">Montar esta frota no Atta virtual</button>` : ""}
                <button type="button" class="btn" data-estudo="mapa">Ver o fluxo no mapa</button>
            </div>
        </section>
        ${R.resumoMira ? `<section class="card estudo-mira"><h3>Resumo da Mira Pro</h3><div class="estudo-mira-texto">${esc(R.resumoMira)}</div></section>` : ""}
        ${R.avisos?.length ? `<div class="missao-dica ambar">${R.avisos.map(esc).join("<br>")}</div>` : ""}
        ${r ? `<div class="ind-tiles">
            ${tile("Entregas no prazo", pct(r.noPrazo[1]), `dia ruim ${pct(r.noPrazo[0])} · dia bom ${pct(r.noPrazo[2])} · meta ${pct(R.premissas.prazoAlvo)}`)}
            ${tile("Tempo do pedido à entrega", minTxt(r.tempoMedio[1]), `90% em até ${minTxt(r.tempoP90[1])}`)}
            ${tile("Ocupação de cada Atta", pct(r.ocupacao[1]), `${pct(r.ocupacao[0])} a ${pct(r.ocupacao[2])} · máximo ${pct(R.premissas.ocupacaoMax)}`)}
            ${tile("Entregas por hora", n1(r.entregasHora[1]), `${Math.round(r.entregas[1])} no dia`)}
            ${tile("Espera no tráfego", minTxt(r.esperaTrafegoMin[1]), "no dia, a frota toda")}
            ${tile("Pedidos sem atender", String(Math.round(r.naoAtendidos[1])), "no fim do dia")}
        </div>` : ""}
        <section class="card"><h3>Como chegamos nela</h3>
            ${tabela(["Frota", "Atta", "No prazo", "Tempo médio", "90% até", "Ocupação", "Espera no tráfego", "Sobraram", ""], R.cenarios.map(c => [
                esc(c.nome), c.total, faixaPct(c.r.noPrazo), minTxt(c.r.tempoMedio[1]), minTxt(c.r.tempoP90[1]), pct(c.r.ocupacao[1]), minTxt(c.r.esperaTrafegoMin[1]), Math.round(c.r.naoAtendidos[1]),
                c === rec || (rec && c.nome === rec.nome) ? `<b class="estudo-ok">✓ recomendada</b>` : c.atende ? `<span class="estudo-ok">✓</span>` : ""]))}
        </section>
        ${r ? `<section class="card"><h3>Hora a hora${rec ? " com a frota recomendada" : ""}</h3>${graficoHoras(r.porHora)}<h4 class="suave">Ocupação da frota</h4>${graficoOcupacao(r.porHora)}</section>` : ""}
        <section class="card estudo-duas">
            <div><h3>Onde se espera</h3>${zonas.length ? tabela(["Zona", "Espera no dia"], zonas.map(([z, s]) => [esc(z), minTxt(s / 60)])) : `<p class="suave">Ninguém espera nos cruzamentos.</p>`}</div>
            <div><h3>Trechos mais usados</h3>${trechos.length ? tabela(["Trecho", "Passagens no dia"], trechos.map(([t, n]) => [esc(t), Math.round(n)])) : ""}</div>
        </section>
        ${r ? `<section class="card"><h3>Por fluxo</h3>${tabela(["Fluxo", "Pedidos no dia", "No prazo", "Tempo médio", "Só a viagem"], R.fluxos.map(f => {
            const v = r.porFluxo[f.id] || { pedidos: 0, entregues: 0, noPrazo: 0, soma: 0 };
            return [esc(f.nome), Math.round(v.pedidos), v.pedidos ? pct(v.noPrazo / v.pedidos) : "--", v.entregues ? minTxt(v.soma / v.entregues) : "--", R.viagens[f.id] ? minTxt(R.viagens[f.id].min) : "--"];
        }))}</section>
        <section class="card"><h3>Por Atta</h3>${tabela(["Atta", "Viagens no dia", "km no dia", "Ocupação"], r.porAtta.map(a => [esc(a.id.replace(/^(.*)#(\d+)$/, (x, m, n) => `${nomeModelo(m)} ${n}`)), Math.round(a.viagens), ui.numero(a.km, 1), pct(a.ocupacao)]))}</section>` : ""}
        ${R.sensibilidade?.length ? `<section class="card"><h3>Previsão</h3>${tabela(["Se…", "No prazo", "Ocupação", "Dá conta?", "Frota necessária"], R.sensibilidade.map(s => [
            esc(s.nome), faixaPct(s.r.noPrazo), pct(s.r.ocupacao[1]), s.atende ? `<span class="estudo-ok">sim</span>` : `<span class="estudo-nao">não</span>`, esc(precisaTexto(s))]))}</section>` : ""}
        <p class="suave estudo-metodo">Simulação rápida por eventos: rotas e tempos da planta publicada na velocidade de cada modelo, reserva das zonas de cruzamento como o firmware faz, calendário, picos e ${R.premissas.rodadas} dias por frota (faixa de um dia ruim a um dia bom). Não simula bateria, falhas nem pessoas no caminho. Confira o cenário escolhido no Atta virtual. Rodado em ${new Date(R.em).toLocaleString("pt-BR")} em ${ui.numero(R.ms / 1000, 1)} s.</p>`;
    }

    function desenhar() {
        const caixa = document.getElementById("estudoConteudo");
        if (!caixa || !document.getElementById("estudo")?.classList.contains("ativa")) return;
        if (!pode()) { caixa.innerHTML = `<div class="empty-state">O estudo de frota é da E4M.</div>`; return; }
        if (!carregado || !atual) { caixa.innerHTML = `<div class="empty-state">Carregando…</div>`; return; }
        caixa.innerHTML = htmlTopo() + (aba === "resultado" ? htmlResultado() : htmlCenario());
    }

    /* ---------------- relatório (PDF pelo navegador) ---------------- */
    function relatorio() {
        const R = atual.resultado;
        if (!R) return;
        const empresa = window.Nuvem && Nuvem.emNuvem() ? Nuvem.empresa()?.nome || "" : "";
        const rec = R.recomendado, r = rec?.r || R.cenarios[R.cenarios.length - 1]?.r;
        const pr = R.premissas;
        const zonas = Object.entries(r?.esperaZona || {}).sort((a, b) => b[1] - a[1]).slice(0, 10);
        const trechos = Object.entries(r?.passagens || {}).sort((a, b) => b[1] - a[1]).slice(0, 10);
        const cal = R.calendario || {};
        const dia = Number(R.dia ?? 1);
        const modelosRec = rec ? rec.frota.filter(g => g.n) : [];
        let caixa = document.getElementById("relatorioImpressao");
        if (!caixa) { caixa = document.createElement("div"); caixa.id = "relatorioImpressao"; document.body.appendChild(caixa); }
        const secao = (titulo, html) => `<section class="rel-secao"><h2>${titulo}</h2>${html}</section>`;
        caixa.innerHTML = `
            <header class="rel-capa">
                <img src="img/e4m-marca-claro.webp" alt="E4M" width="130" height="41">
                <div><h1>Estudo de frota${empresa ? " · " + esc(empresa) : ""}</h1><p>${esc(atual.nome)} · planta ${esc(R.planta?.nome || "")}${R.planta?.revisao ? ` rev ${R.planta.revisao}` : ""} · ${new Date(R.em).toLocaleString("pt-BR")} · Eciton, supervisão de frota</p></div>
            </header>
            ${R.desatualizado ? `<p class="rel-simulacao">O cenário foi alterado depois desta simulação.</p>` : ""}
            ${typeof PlantaExemplo !== "undefined" && R.planta?.nome === PlantaExemplo.NOME ? `<p class="rel-simulacao">EXEMPLO · planta e demanda fictícias (a metalúrgica de exemplo do Eciton)</p>` : ""}
            ${secao("1. Resumo", `<div class="rel-destaque"><span>${rec ? "Frota recomendada" : "Nenhuma frota testada cumpre as metas"}</span><b>${esc(rec ? rec.nome : "--")}</b></div>
                ${R.resumoMira ? `<div class="rel-texto">${esc(R.resumoMira)}</div><p class="rel-nota">Resumo escrito pela Mira Pro a partir dos números abaixo.</p>` : resumoAutomatico(R).map(t => `<p>${esc(t)}</p>`).join("")}`)}
            ${r ? secao("2. Resultado da frota " + (rec ? "recomendada" : "maior testada"), `<div class="ind-tiles">
                ${tile("Entregas no prazo (P50)", pct(r.noPrazo[1]), `dia ruim ${pct(r.noPrazo[0])} · dia bom ${pct(r.noPrazo[2])}`)}
                ${tile("Tempo médio do pedido à entrega", minTxt(r.tempoMedio[1]), `90% em até ${minTxt(r.tempoP90[1])}`)}
                ${tile("Ocupação de cada Atta", pct(r.ocupacao[1]), `${pct(r.ocupacao[0])} a ${pct(r.ocupacao[2])}`)}
                ${tile("Entregas por dia", String(Math.round(r.entregas[1])), `${n1(r.entregasHora[1])} por hora de trabalho`)}
                ${tile("Espera no tráfego", minTxt(r.esperaTrafegoMin[1]), "no dia, a frota toda")}
                ${tile("Pedidos sem atender", String(Math.round(r.naoAtendidos[1])), "no fim do dia")}</div>
                <h3>Hora a hora</h3>${graficoHoras(r.porHora)}
                <h3>Por fluxo</h3>${tabela(["Fluxo", "Missão / rota", "Pedidos no dia", "No prazo", "Tempo médio", "Só a viagem", "Prazo"], R.fluxos.map(f => {
                    const v = r.porFluxo[f.id] || { pedidos: 0, entregues: 0, noPrazo: 0, soma: 0 };
                    return [esc(f.nome), rotaTexto(f), Math.round(v.pedidos), v.pedidos ? pct(v.noPrazo / v.pedidos) : "--", v.entregues ? minTxt(v.soma / v.entregues) : "--", R.viagens[f.id] ? minTxt(R.viagens[f.id].min) : "--", minTxt(f.prazoMin)];
                }))}
                <h3>Por Atta</h3>${tabela(["Atta", "Viagens no dia", "km no dia", "Ocupação"], r.porAtta.map(a => [esc(a.id.replace(/^(.*)#(\d+)$/, (x, m, n) => `${nomeModelo(m)} ${n}`)), Math.round(a.viagens), ui.numero(a.km, 1), pct(a.ocupacao)]))}`) : ""}
            ${secao("3. Como chegamos nela", `<p>${R.busca === "todas" ? "Cada combinação das faixas foi simulada." : "O estudo começou no mínimo de cada modelo e pôs um Atta de cada vez onde mais faltava (o modelo dos fluxos fora do prazo ou o mais ocupado), até cumprir as metas."} Metas: ${pct(pr.prazoAlvo)} das entregas no prazo, ocupação de cada Atta até ${pct(pr.ocupacaoMax)} e nenhum pedido sobrando no fim do dia.</p>
                ${tabela(["Frota", "Atta", "No prazo (P10–P90)", "Tempo médio", "Ocupação", "Espera no tráfego", "Sobraram", "Cumpre?"], R.cenarios.map(c => [esc(c.nome), c.total, `${pct(c.r.noPrazo[1])} (${pct(c.r.noPrazo[0])}–${pct(c.r.noPrazo[2])})`, minTxt(c.r.tempoMedio[1]), pct(c.r.ocupacao[1]), minTxt(c.r.esperaTrafegoMin[1]), Math.round(c.r.naoAtendidos[1]), c.atende ? "sim" : "não"]))}`)}
            ${secao("4. Previsão", R.sensibilidade?.length ? `<p>A frota recomendada diante de mais demanda e de um Atta parado (manutenção). Quando não dá conta, o estudo procura quantos Atta seriam necessários.</p>
                ${tabela(["Situação", "No prazo (P50)", "Ocupação", "Dá conta?", "Frota necessária"], R.sensibilidade.map(s => [esc(s.nome), pct(s.r.noPrazo[1]), pct(s.r.ocupacao[1]), s.atende ? "sim" : "não", esc(precisaTexto(s))]))}` : `<p>Sem frota recomendada, a previsão não foi feita.</p>`)}
            ${secao("5. Gargalos", `<div class="rel-duas"><div><h3>Onde se espera (zonas de cruzamento)</h3>${zonas.length ? tabela(["Zona", "Espera no dia"], zonas.map(([z, s]) => [esc(z), minTxt(s / 60)])) : "<p>Ninguém espera nos cruzamentos.</p>"}</div>
                <div><h3>Trechos mais usados</h3>${trechos.length ? tabela(["Trecho", "Passagens no dia"], trechos.map(([t, n]) => [esc(t), Math.round(n)])) : ""}</div></div>`)}
            ${secao("6. Cenário", `<h3>Fluxos de material</h3>${tabela(["Fluxo", "Missão / rota", "Quem atende", "Demanda", "Pegar / entregar", "Prazo", "Prioridade"], R.fluxos.map(f => [esc(f.nome) + (f.obs ? `<br><small>${esc(f.obs)}</small>` : ""), rotaTexto(f), (f.modelos || []).map(nomeModelo).map(esc).join(", ") || "qualquer", esc(demandaTexto(f)), `${f.pegarS ?? 30} s / ${f.entregarS ?? 30} s`, minTxt(f.prazoMin), ["baixa", "normal", "alta", "urgente"][f.prioridade] || "normal"]))}
                <h3>Calendário (${esc(DIAS.find(x => x[0] === dia)?.[1] || "")})</h3><p>Turnos: ${(cal.turnos || []).filter(t => (t.dias || []).includes(dia)).map(t => `${esc(t.nome)} ${t.inicio}–${t.fim}`).join(", ") || "nenhum"}. Intervalos: ${(cal.intervalos || []).filter(t => (t.dias || []).includes(dia)).map(t => `${esc(t.nome)} ${t.inicio}–${t.fim}`).join(", ") || "nenhum"}. Horas de trabalho no dia: ${n1(r?.horasDisp)} h.</p>
                <h3>Premissas</h3>${tabela(["Premissa", "Valor"], PREMISSAS.map(([k, rot, un]) => [esc(rot), un === "%" ? pct(pr[k]) : String(pr[k])]))}`)}
            ${secao("7. Investimento e retorno (a preencher)", `<p>Valores da proposta comercial. O estudo dá a quantidade; o preço e a economia entram aqui.</p>
                ${tabela(["Item", "Quantidade", "Valor unitário", "Total"], modelosRec.map(g => [esc(nomeModelo(g.modelo)), g.n, "R$ ____________", "R$ ____________"]).concat([
                    ["Eciton (plano e implantação)", "1", "R$ ____________", "R$ ____________"], ["Fita, tags RFID e berços", "", "", "R$ ____________"], ["Eciton I/O (portas, semáforos)", "", "", "R$ ____________"], ["<b>Investimento total</b>", "", "", "<b>R$ ____________</b>"]]), "rel-preencher")}
                ${tabela(["Retorno", "Valor"], [["Pessoas e empilhadeiras liberadas por turno", "____________"], ["Custo por pessoa por mês (com encargos)", "R$ ____________"], ["Economia por mês", "R$ ____________"], ["Retorno do investimento (meses)", "____________"]], "rel-preencher")}`)}
            ${secao("8. Método e limites", `<p>Simulação por eventos do dia de trabalho, rodada ${pr.rodadas} vezes por frota com variação de ${pct(pr.variacao)} entre dias; os resultados aparecem como faixa (P10 = dia ruim, P50 = dia típico, P90 = dia bom). Cada viagem usa a rota que o Eciton calcula na planta publicada e o tempo de cada trecho na velocidade do modelo (zona lenta, faixa de pedestre, curvas e giros). Nos cruzamentos, cada Atta pede as zonas como o firmware faz e espera quem está dentro. O despacho manda o pedido para o Atta livre do modelo certo que chega antes, com a prioridade primeiro. O calendário (turnos e intervalos no berço) e os picos de começo de turno (+${pct(pr.picoInicio)}) e de volta do intervalo (+${pct(pr.picoVolta)}) entram na demanda.</p>
                <p>Não entram: bateria e recarga, falhas, pessoas e obstáculos no caminho, nem o tempo de voltar ao berço. Por isso a meta de ocupação deixa folga (${pct(pr.ocupacaoMax)}). Antes de fechar, rode a frota escolhida no Atta virtual do Eciton, com o firmware real.</p>`)}
            <footer class="rel-rodape">E4M · Engineering for Motion · São Bernardo do Campo, SP</footer>`;
        document.body.classList.add("imprimindo-relatorio");
        const fim = () => { document.body.classList.remove("imprimindo-relatorio"); removeEventListener("afterprint", fim); };
        addEventListener("afterprint", fim);
        setTimeout(() => { window.print(); setTimeout(fim, 500); }, 250);
    }

    async function resumoMira() {
        const R = atual.resultado;
        if (!R || !window.Mira || !Mira.temPro()) return;
        const enxuto = c => c && ({ frota: c.nome, atta: c.total, noPrazo: c.r.noPrazo.map(x => Math.round(x * 100)), tempoMedioMin: Math.round((c.r.tempoMedio[1] || 0) * 10) / 10, p90Min: Math.round((c.r.tempoP90[1] || 0) * 10) / 10,
            ocupacao: Math.round(c.r.ocupacao[1] * 100), esperaTrafegoMin: Math.round(c.r.esperaTrafegoMin[1]), sobraram: Math.round(c.r.naoAtendidos[1]), pedidosDia: Math.round(c.r.pedidos[1]), cumpre: Boolean(c.atende) });
        const rec = R.recomendado;
        const contexto = {
            estudo: atual.nome, metas: { noPrazo: Math.round(R.premissas.prazoAlvo * 100), ocupacaoMax: Math.round(R.premissas.ocupacaoMax * 100) },
            premissas: R.premissas, recomendado: enxuto(rec), caminho: R.cenarios.map(enxuto),
            previsao: (R.sensibilidade || []).map(s => ({ situacao: s.nome, noPrazo: Math.round(s.r.noPrazo[1] * 100), ocupacao: Math.round(s.r.ocupacao[1] * 100), daConta: s.atende, frotaNecessaria: precisaTexto(s) })),
            gargalos: Object.entries(rec?.r.esperaZona || {}).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([z, s]) => ({ zona: z, esperaMinDia: Math.round(s / 60) })),
            fluxos: R.fluxos.map(f => { const v = rec?.r.porFluxo[f.id]; return { nome: f.nome, pedidosDia: Math.round(v?.pedidos || 0), noPrazo: v?.pedidos ? Math.round(v.noPrazo / v.pedidos * 100) : null, soViagemMin: R.viagens[f.id] ? Math.round(R.viagens[f.id].min * 10) / 10 : null }; }),
            avisos: R.avisos
        };
        Mira.abrir(true);
        const r = await Mira.perguntar(`Escreva o resumo do estudo de frota "${atual.nome}" para a diretoria.`, { modo: "pro", tarefa: "estudo_resumo", contexto, semHistorico: true });
        if (!r || r.erro || !r.texto) return;
        R.resumoMira = r.texto;
        if (pode()) await salvar(true);
        desenhar();
    }

    async function montarVirtual() {
        const rec = atual.resultado?.recomendado;
        if (!rec || typeof AgvVirtual === "undefined") return;
        const total = rec.frota.reduce((s, g) => s + g.n, 0);
        if (total > 12) { ui.aviso("O Atta virtual roda até 12 Atta no navegador. Monte parte da frota pela tela do AGV virtual.", "aviso"); return; }
        if (!await ui.confirmar({ titulo: "Montar no Atta virtual?", texto: `Cria ${total} Atta virtuais (${rec.nome}) com o firmware real, na planta publicada. Depois é só pedir as missões e ver o tráfego.`, confirmar: "Montar" })) return;
        for (const g of rec.frota) for (let i = 0; i < g.n; i++) { try { await AgvVirtual.criarNovo(g.modelo); } catch (e) { ui.aviso("Não deu para criar um Atta virtual: " + e.message, "erro"); return; } }
        if (typeof mudarTela === "function") mudarTela("agvVirtual");
    }

    /* ---------------- eventos ---------------- */
    document.addEventListener("click", async e => {
        const caixa = document.getElementById("estudoConteudo");
        if (!caixa || !caixa.contains(e.target)) return;
        const b = e.target.closest("button");
        if (!b || b.disabled) return;
        const a = b.dataset.estudo;
        if (b.dataset.estudoAba) { aba = b.dataset.estudoAba; desenhar(); return; }
        if (b.dataset.estudoBusca) { atual.dados.busca = b.dataset.estudoBusca; mudou(); desenhar(); return; }
        if (b.dataset.fluxoEditar) { editarFluxo(b.dataset.fluxoEditar); return; }
        if (b.dataset.fluxoTirar) { atual.dados.fluxos = atual.dados.fluxos.filter(f => f.id !== b.dataset.fluxoTirar); mudou(); desenhar(); return; }
        if (b.dataset.frotaTirar !== undefined) { atual.dados.frotas.splice(Number(b.dataset.frotaTirar), 1); mudou(); desenhar(); return; }
        if (a === "novo") { atual = novo(); aba = "cenario"; sujo = false; desenhar(); }
        if (a === "duplicar") { atual = Object.assign(JSON.parse(JSON.stringify(atual)), { id: null, nome: (atual.nome + " (cópia)").slice(0, 80) }); sujo = true; desenhar(); }
        if (a === "apagar") apagar();
        if (a === "salvar") salvar();
        if (a === "importar") importarDaPlanta();
        if (a === "dia") repetirDia();
        if (a === "fluxo") editarFluxo(null);
        if (a === "mira") montarComMira();
        if (a === "rodar") rodar();
        if (a === "pdf") relatorio();
        if (a === "resumoMira") resumoMira();
        if (a === "virtual") montarVirtual();
        if (a === "maisModelo") { const m = document.getElementById("estudoMaisModelo")?.value; if (m) { atual.dados.frotas.push({ modelo: m, de: 1, ate: 4 }); mudou(); desenhar(); } }
        if (a === "mapa") {
            if (typeof CamadasMapa !== "undefined" && CamadasMapa.definirEstudo) { CamadasMapa.definirEstudo(atual.resultado, atual.nome); CamadasMapa.ativar("estudo"); }
            if (typeof mudarTela === "function") mudarTela("controlePlanta");
        }
    });
    document.addEventListener("change", e => {
        const caixa = document.getElementById("estudoConteudo");
        if (!caixa || !caixa.contains(e.target)) return;
        const t = e.target;
        const numero = v => { const n = Number(String(v).replace(",", ".")); return Number.isFinite(n) ? n : 0; };
        if (t.id === "estudoEscolha") { const x = estudos.find(s => s.id === t.value); if (x) { atual = JSON.parse(JSON.stringify(x)); sujo = false; aba = x.resultado ? "resultado" : "cenario"; if (x.resultado && typeof CamadasMapa !== "undefined" && CamadasMapa.definirEstudo) CamadasMapa.definirEstudo(x.resultado, x.nome); } desenhar(); return; }
        if (t.id === "estudoNome") { atual.nome = t.value.trim().slice(0, 80) || "Estudo de frota"; sujo = true; desenhar(); return; }
        if (t.id === "estudoDia") { atual.dados.dia = Number(t.value); mudou(); desenhar(); return; }
        if (t.dataset.fluxoAtivo) { const f = atual.dados.fluxos.find(x => x.id === t.dataset.fluxoAtivo); if (f) f.ativo = t.checked; mudou(); desenhar(); return; }
        if (t.dataset.fluxoPorhora) { const f = atual.dados.fluxos.find(x => x.id === t.dataset.fluxoPorhora); if (f) f.demanda = { tipo: "porHora", porHora: Math.max(0, numero(t.value)) }; mudou(); desenhar(); return; }
        if (t.dataset.fluxoPrazo) { const f = atual.dados.fluxos.find(x => x.id === t.dataset.fluxoPrazo); if (f) f.prazoMin = Math.max(1, numero(t.value)); mudou(); desenhar(); return; }
        if (t.dataset.frotaDe !== undefined || t.dataset.frotaAte !== undefined) {
            const g = atual.dados.frotas[Number(t.dataset.frotaDe ?? t.dataset.frotaAte)];
            if (!g) return;
            const v = Math.max(0, Math.min(40, Math.round(numero(t.value))));
            if (t.dataset.frotaDe !== undefined) { g.de = v; g.ate = Math.max(g.ate, v); } else { g.ate = v; g.de = Math.min(g.de, v); }
            mudou(); desenhar(); return;
        }
        if (t.dataset.premissa) {
            const k = t.dataset.premissa, un = PREMISSAS.find(p => p[0] === k)?.[2];
            let v = Math.max(0, numero(t.value));
            if (un === "%") v = v / 100;
            if (k === "rodadas") v = Math.max(1, Math.min(40, Math.round(v)));
            if (k === "indisponiveis") v = Math.min(10, Math.round(v));
            if (k === "prazoAlvo" || k === "ocupacaoMax") v = Math.max(0.1, Math.min(1, v));
            atual.dados.premissas[k] = v; mudou(); desenhar();
        }
    });
    // o menu: só para quem pode
    setInterval(() => { const m = document.querySelector('.menu-item[data-tela="estudo"]'); if (m) m.hidden = naNuvem() && !Nuvem.pode("estudo"); }, 2000);
    window.addEventListener("beforeunload", ev => { if (sujo && atual?.dados?.fluxos?.length) { ev.preventDefault(); ev.returnValue = ""; } });

    function abrir() {
        if (!carregado) { desenhar(); carregar().catch(e => ui.aviso("Não foi possível ler os estudos: " + (e.message || e), "erro")); return; }
        desenhar();
    }
    return { abrir, carregar, rodar, relatorio, desenhar, atual: () => atual, estudos: () => estudos.slice(), _importar: importarDaPlanta, _definir: e => { atual = e; desenhar(); } };
})();
if (typeof window !== "undefined") window.EstudoTela = EstudoTela;
