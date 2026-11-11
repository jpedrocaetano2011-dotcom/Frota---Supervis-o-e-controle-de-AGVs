/* ============================================================
   ESTUDOS (0.22) — o ambiente de estudo de frota da E4M
   ============================================================
   Só o fornecedor (e o modo local, sem nuvem, para bancada). Cada estudo
   é de um prospect, um cliente em negociação que ainda não é empresa no
   Eciton. Abas de cada prospect:
     Cliente    — contato, etapa, links (questionário, diário, relatório),
                  converter em empresa;
     Pesquisa   — o questionário (o mesmo do cliente), o modelo do setor,
                  a planilha de movimentações, o diário de viagens, a Mira Pro;
     Planta     — a planta de estudo gerada do questionário, o editor de
                  sempre (modo estudo) e as variantes de layout;
     Fluxos     — os fluxos que a simulação usa, as metas e a proposta;
     Resultado  — roda o estudo completo (estudo-negocio.js) e mostra o
                  relatório (relatorio-estudo.js), o PDF e o link.
   Na nuvem: public.prospects e companhia (só o fornecedor lê); sem nuvem,
   neste navegador (prospectsEstudo).
*/
const EstudosTela = (function () {
    const CHAVE = "prospectsEstudo", CHAVE_PRECOS = "tabelaPrecosEstudo";
    const esc = t => String(t ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
    const naNuvem = () => Boolean(window.Nuvem && Nuvem.emNuvem && Nuvem.emNuvem());
    const pode = () => !naNuvem() || Nuvem.papel() === "fornecedor";
    const N = () => EstudoNegocio;
    const ETAPAS = [["pesquisa", "Pesquisa"], ["estudo", "Estudo"], ["proposta", "Proposta"], ["fechado", "Fechado"], ["perdido", "Perdido"]];
    const ABAS = [["cliente", "Cliente"], ["pesquisa", "Pesquisa"], ["planta", "Planta"], ["fluxos", "Fluxos"], ["resultado", "Resultado"], ["proposta", "Proposta"]];
    const CHAVE_NUM = "propostasNumeracao";
    const MODELOS = [["atta-g-o", "Atta G-O (garra, até 250 kg)"], ["atta-e-o-serie", "Atta E-O (elevação, até 1.000 kg)"], ["atta-r-o", "Atta R-O (roletes)"], ["atta-t-o", "Atta T-O (rebocador)"]];
    const CARGA_DO_MODELO = { "atta-g-o": "caixa", "atta-e-o-serie": "carrinho", "atta-r-o": "esteira", "atta-t-o": "comboio" };
    const dataTxt = s => (s ? new Date(s).toLocaleDateString("pt-BR") : "--");
    const n1 = v => (v == null || !Number.isFinite(Number(v)) ? "--" : ui.numero(Number(v), Number(v) < 10 ? 1 : 0));

    let lista = [], atual = null, aba = "cliente", carregado = false, precosTabela = null;
    let propostas = [];
    let links = [], viagens = [], rodando = null, form = null, vezForm = 0, sujos = new Set(), timer = null, salvando = false;

    /* ---------------- guardar ---------------- */
    const lerLocal = () => { try { return JSON.parse(localStorage.getItem(CHAVE) || "[]"); } catch (e) { return []; } };
    const gravarLocal = l => { try { localStorage.setItem(CHAVE, JSON.stringify(l)); return true; } catch (e) { ui.aviso("Sem espaço no navegador para guardar o estudo (a planta com DXF ocupa muito). Use a nuvem.", "erro"); return false; } };
    const RESUMO = "id, nome, setor, cidade, etapa, rev, empresa_id, respondido_em, atualizado_em, criado_em";

    async function carregarLista() {
        if (naNuvem()) {
            const r = await Nuvem.cliente().from("prospects").select(RESUMO + ", payback:resultado->financeiro->cenarios->provavel->compra->payback, frota:resultado->simulacao->recomendado->>nome").order("atualizado_em", { ascending: false });
            if (r.error) { ui.aviso(/prospects/.test(r.error.message || "") ? "O banco ainda não tem os estudos (rode o 01_esquema.sql da 0.22)." : r.error.message, "erro"); lista = []; }
            else lista = r.data || [];
            const t = await Nuvem.cliente().from("tabela_precos").select("dados").maybeSingle();
            precosTabela = t.data?.dados || null;
        } else {
            lista = lerLocal().map(p => ({ id: p.id, nome: p.nome, setor: p.setor, cidade: p.cidade, etapa: p.etapa, rev: p.rev, respondido_em: p.respondido_em, atualizado_em: p.atualizado_em, criado_em: p.criado_em,
                payback: p.resultado?.financeiro?.cenarios?.provavel?.compra?.payback, frota: p.resultado?.simulacao?.recomendado?.nome }));
            try { precosTabela = JSON.parse(localStorage.getItem(CHAVE_PRECOS) || "null"); } catch (e) { precosTabela = null; }
        }
        carregado = true;
    }
    async function abrirProspect(id) {
        if (sujos.size) await salvarJa();
        if (naNuvem()) {
            const r = await Nuvem.cliente().from("prospects").select("*").eq("id", id).single();
            if (r.error) { ui.aviso(r.error.message, "erro"); return; }
            atual = r.data;
            await carregarLinks();
        } else {
            atual = JSON.parse(JSON.stringify(lerLocal().find(p => p.id === id) || null));
            links = []; viagens = [];
            propostas = (atual?.propostas || []).slice().sort((a, b) => String(b.emitida_em).localeCompare(String(a.emitida_em)));
        }
        if (!atual) return;
        atual.estudo = atual.estudo || {}; atual.respostas = atual.respostas || {}; atual.contato = atual.contato || {};
        form = null; sujos.clear();
        if (!ABAS.some(([k]) => k === aba)) aba = "cliente";
        desenhar();
    }
    async function carregarLinks() {
        if (!naNuvem() || !atual?.id) { links = []; viagens = []; propostas = (atual?.propostas || []).slice().sort((a, b) => String(b.emitida_em).localeCompare(String(a.emitida_em))); return; }
        const [l, v] = await Promise.all([
            Nuvem.cliente().from("prospect_links").select("codigo, tipo, criado_em, expira_em, cancelado, usos, ultimo_uso").eq("prospect_id", atual.id).order("criado_em", { ascending: false }),
            Nuvem.cliente().from("prospect_viagens").select("de, para, saiu_em, chegou_em, carga, quem").eq("prospect_id", atual.id).order("saiu_em", { ascending: true }).limit(20000)
        ]);
        links = l.data || []; viagens = v.data || [];
        const pp = await Nuvem.cliente().from("propostas").select("id, numero, revisao, status, valida_ate, emitida_em, aceite, aceita_em, dados").eq("prospect_id", atual.id).order("emitida_em", { ascending: false });
        propostas = pp.error ? [] : (pp.data || []);
    }
    function marcar(...campos) {
        campos.forEach(c => sujos.add(c));
        if (["respostas", "planta", "estudo"].some(c => campos.includes(c)) && atual.resultado && !campos.includes("resultado")) { atual.resultado.desatualizado = true; sujos.add("resultado"); }
        clearTimeout(timer);
        timer = setTimeout(salvarJa, 1200);
        const s = document.getElementById("estudosSalvo"); if (s) s.textContent = "Salvando…";
    }
    async function salvarJa() {
        clearTimeout(timer);
        if (!atual || !sujos.size || salvando) return true;
        salvando = true;
        const campos = {};
        [...sujos].forEach(k => { campos[k] = atual[k]; });
        sujos.clear();
        let ok = true;
        if (naNuvem()) {
            const r = await Nuvem.cliente().rpc("salvar_prospect", { p_id: atual.id, p_campos: campos, p_rev: atual.rev });
            if (r.error) {
                ok = false;
                if (/outra aba/.test(r.error.message || "")) {
                    ui.aviso("Este estudo mudou em outro lugar (o cliente respondeu ou outra aba salvou). Recarreguei a versão nova: confira e refaça a última mudança.", "aviso");
                    salvando = false; await abrirProspect(atual.id); return false;
                }
                ui.aviso(r.error.message || "Não foi possível salvar o estudo.", "erro");
                Object.keys(campos).forEach(k => sujos.add(k));
            } else { atual.rev = r.data.rev; atual.atualizado_em = r.data.atualizado_em; }
        } else {
            atual.rev = (atual.rev || 0) + 1; atual.atualizado_em = new Date().toISOString();
            const l = lerLocal().filter(p => p.id !== atual.id);
            ok = gravarLocal([JSON.parse(JSON.stringify(atual))].concat(l));
        }
        salvando = false;
        const s = document.getElementById("estudosSalvo"); if (s) s.textContent = ok ? "Salvo" : "Não salvo";
        if (sujos.size) marcar();
        return ok;
    }
    async function novoProspect() {
        const v = await ui.formulario({ titulo: "Novo prospect", confirmar: "Criar", campos: [
            { nome: "nome", rotulo: "Empresa", obrigatorio: true, max: 80, largo: true },
            { nome: "setor", rotulo: "Setor", opcoes: [["", "—"]].concat(Object.entries(N().SETORES).map(([k, s]) => [k, s.nome]), [["outro", "Outro"]]) },
            { nome: "cidade", rotulo: "Cidade", max: 60 },
            { nome: "contato", rotulo: "Contato (nome)", max: 80 }, { nome: "email", rotulo: "E-mail do contato", tipo: "email", max: 120 }
        ] });
        if (!v || !v.nome.trim()) return;
        const setorNome = N().SETORES[v.setor]?.nome || (v.setor === "outro" ? "Outro" : "");
        const campos = { nome: v.nome.trim(), setor: setorNome, cidade: v.cidade.trim(), contato: { nome: v.contato.trim(), email: v.email.trim() }, respostas: v.setor ? { operacao: { setor: { v: v.setor } } } : {} };
        if (naNuvem()) {
            const r = await Nuvem.cliente().rpc("salvar_prospect", { p_id: null, p_campos: campos });
            if (r.error) { ui.aviso(r.error.message, "erro"); return; }
            await carregarLista(); aba = "cliente"; await abrirProspect(r.data.id);
        } else {
            const p = Object.assign({ id: "L" + Date.now().toString(36), etapa: "pesquisa", notas: "", estudo: {}, planta: null, resultado: null, rev: 1, criado_em: new Date().toISOString(), atualizado_em: new Date().toISOString() }, campos);
            gravarLocal([p].concat(lerLocal()));
            await carregarLista(); aba = "cliente"; await abrirProspect(p.id);
        }
    }
    async function apagar() {
        if (!await ui.confirmar({ titulo: `Apagar o estudo de ${atual.nome}?`, texto: "O questionário, a planta, o resultado, os links e o diário somem de vez.", confirmar: "Apagar", perigo: true })) return;
        if (naNuvem()) { const r = await Nuvem.cliente().rpc("apagar_prospect", { p_id: atual.id }); if (r.error) { ui.aviso(r.error.message, "erro"); return; } }
        else gravarLocal(lerLocal().filter(p => p.id !== atual.id));
        atual = null; sujos.clear();
        await carregarLista(); desenhar();
    }

    /* ---------------- links ---------------- */
    const urlCliente = (tipo, codigo) => new URL(`cliente.html?${tipo}=${codigo}`, location.href).href;
    async function criarLink(tipo) {
        if (!naNuvem()) { ui.aviso("Os links para o cliente precisam da nuvem (config.js).", "aviso"); return; }
        if (tipo === "relatorio" && !atual.resultado) { ui.aviso("Rode o estudo antes de mandar o relatório.", "aviso"); return; }
        if (tipo === "diario" && (atual.respostas?.pontos?.lista || []).length < 2) { ui.aviso("O diário usa os pontos do questionário: marque pelo menos dois antes.", "aviso"); return; }
        const dias = { pesquisa: 15, diario: 7, relatorio: 30 }[tipo];
        const v = await ui.formulario({ titulo: { pesquisa: "Link do questionário", diario: "Link do diário de viagens", relatorio: "Link do relatório" }[tipo], confirmar: "Criar o link",
            campos: [{ nome: "dias", rotulo: "Vale por (dias)", tipo: "number", valor: dias }],
            texto: { pesquisa: "O cliente responde sozinho, sem conta. O que ele salva aparece aqui na aba Pesquisa.", diario: "No celular: a equipe toca \"saí\" e \"cheguei\" em cada viagem. Três a cinco dias bastam.", relatorio: "Só leitura, com o botão de baixar em PDF. Se você rodar o estudo de novo, o link mostra o resultado novo." }[tipo] });
        if (!v) return;
        if (sujos.size) await salvarJa();
        const r = await Nuvem.cliente().rpc("criar_link_prospect", { p_id: atual.id, p_tipo: tipo, p_dias: Math.max(1, Math.min(90, Math.round(Number(v.dias) || dias))) });
        if (r.error) { ui.aviso(r.error.message, "erro"); return; }
        await carregarLinks(); desenhar();
        copiar(urlCliente(tipo, r.data.codigo));
    }
    async function copiar(texto) {
        try { await navigator.clipboard.writeText(texto); ui.aviso("Link copiado. Mande ao cliente por e-mail ou WhatsApp.", "sucesso"); }
        catch (e) { await ui.perguntar({ titulo: "Copie o link", valor: texto, confirmar: "Fechar" }); }
    }
    async function cancelarLink(codigo) {
        if (!await ui.confirmar({ titulo: "Cancelar o link?", texto: "Quem tiver o endereço não abre mais.", confirmar: "Cancelar o link", perigo: true })) return;
        const r = await Nuvem.cliente().rpc("cancelar_link_prospect", { p_codigo: codigo });
        if (r.error) { ui.aviso(r.error.message, "erro"); return; }
        await carregarLinks(); desenhar();
    }

    /* ---------------- planta e fluxos do questionário ---------------- */
    function gerarDoQuestionario(manterPlanta = false) {
        const resp = atual.respostas || {};
        const falta = Pesquisa.faltando(resp).filter(f => !/turnos/.test(f) || !resp.operacao?.turnos);
        if ((resp.pontos?.lista || []).length < 2 || !(resp.fluxos?.lista || []).some(f => f.de && f.para && (Number(f.quantidade) > 0 || (f.entrega === "milkrun" && Number(f.ciclo) > 0)))) { ui.aviso("Faltam os pontos e os fluxos no questionário (aba Pesquisa).", "aviso"); return false; }
        let planta = atual.planta, mapa = atual.estudo?.mapa || {}, avisos = atual.estudo?.avisosPlanta || [];
        if (!manterPlanta || !planta) {
            const g = N().plantaDoQuestionario(resp, { nome: `Estudo · ${atual.nome}`.slice(0, 60) });
            if (!g.planta) { ui.aviso(g.avisos.join(" "), "aviso"); return false; }
            planta = g.planta; mapa = g.mapa; avisos = g.avisos;
        } else {
            // a planta foi editada: os pontos novos do questionário ligam no nó de mesmo id, se houver
            (resp.pontos?.lista || []).forEach(p => { if (!mapa[p.id] && planta.nos.some(n => n.id === p.id)) mapa[p.id] = p.id; });
        }
        const { fluxos, missoes } = N().fluxosDoQuestionario(resp, mapa);
        const postos = N().postosDosFluxos(fluxos, planta, resp);
        atual.planta = planta;
        atual.estudo = Object.assign({}, atual.estudo, { fluxos, missoes, postos, mapa, avisosPlanta: avisos, gerado: new Date().toISOString(), calendario: N().calendarioDoQuestionario(resp) });
        if (atual.etapa === "pesquisa") { atual.etapa = "estudo"; marcar("etapa"); }
        marcar("planta", "estudo");
        if (falta.length) ui.aviso("Ainda falta no questionário: " + falta.join(", ") + ".", "aviso");
        return true;
    }
    function abrirEditor(indiceVariante = null) {
        const variante = indiceVariante != null ? atual.estudo.variantes?.[indiceVariante] : null;
        const pl = variante ? variante.planta : atual.planta;
        if (!pl) { ui.aviso("Gere a planta do questionário primeiro.", "aviso"); return; }
        if (typeof EditorPlanta === "undefined" || !EditorPlanta.modoEstudo) { ui.aviso("O editor de planta não carregou.", "erro"); return; }
        const id = atual.id;
        mudarTela("controlePlanta");
        EditorPlanta.modoEstudo(pl, {
            titulo: variante ? `Variante "${variante.nome}" · ${atual.nome}` : `Estudo · ${atual.nome}`,
            aoSalvar: (nova, final) => {
                if (!atual || atual.id !== id) return;
                if (variante) { atual.estudo.variantes[indiceVariante].planta = semFundo(nova); marcar("estudo"); }
                else { atual.planta = nova; marcar("planta"); }
                if (final) salvarJa();
            },
            aoSair: () => { mudarTela("estudos"); aba = "planta"; desenhar(); }
        });
    }
    const semFundo = pl => Object.assign({}, pl, { desenho: null, fundo: null });
    async function guardarVariante() {
        const v = await ui.formulario({ titulo: "Nova variante de layout", confirmar: "Criar e editar", campos: [
            { nome: "nome", rotulo: "Nome", obrigatorio: true, max: 50, largo: true, placeholder: "ex.: segundo corredor na montagem" },
            { nome: "custo", rotulo: "Custo da obra (R$)", tipo: "number", valor: "" },
            { nome: "descricao", rotulo: "O que muda", tipo: "textarea", max: 300, largo: true }
        ], texto: "A variante começa igual à planta do estudo. Desenhe a mudança no editor: o estudo simula cada variante como uma ação e compara no relatório." });
        if (!v) return;
        atual.estudo.variantes = (atual.estudo.variantes || []).concat([{ nome: v.nome.trim().slice(0, 50), custo: Math.max(0, Number(v.custo) || 0), descricao: v.descricao.trim().slice(0, 300), planta: semFundo(JSON.parse(JSON.stringify(atual.planta))) }]).slice(0, 4);
        marcar("estudo");
        abrirEditor(atual.estudo.variantes.length - 1);
    }

    /* ---------------- pesquisa: setor, planilha, diário, Mira ---------------- */
    function usarSetor() {
        const setor = Pesquisa.valor(atual.respostas?.operacao?.setor) || Object.keys(N().SETORES).find(k => N().SETORES[k].nome === atual.setor);
        if (!N().SETORES[setor]) { ui.aviso("Escolha o setor no questionário (A operação › Setor) para usar o modelo.", "aviso"); return; }
        const r = N().aplicarSetor(atual.respostas, setor);
        if (!r.novos) { ui.aviso("O questionário já tem os pontos e os fluxos do modelo.", "info"); return; }
        atual.respostas = r.respostas; marcar("respostas"); form = null; desenhar();
        ui.aviso(`${r.novos} ponto(s) e fluxo(s) do modelo ${N().SETORES[setor].nome}. Marque os pontos na planta e confira as quantidades: são valores de partida.`, "sucesso");
    }
    async function lerArquivoPlanilha(arquivo) {
        let linhas;
        if (/\.(xlsx|xls)$/i.test(arquivo.name)) {
            if (!window.XLSX) await new Promise((ok, falha) => { const s = document.createElement("script"); s.src = "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js"; s.onload = ok; s.onerror = () => falha(new Error("Não deu para baixar o leitor de Excel (sem internet?). Salve como CSV.")); document.head.appendChild(s); });
            const wb = XLSX.read(await arquivo.arrayBuffer(), { type: "array" });
            linhas = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: "" });
        } else {
            const texto = await arquivo.text();
            const sep = (texto.split("\n")[0].match(/;/g) || []).length >= (texto.split("\n")[0].match(/,/g) || []).length ? ";" : ",";
            linhas = texto.split(/\r?\n/).filter(l => l.trim()).map(l => l.split(sep).map(c => c.replace(/^"|"$/g, "").trim()));
        }
        return N().lerPlanilha(linhas);
    }
    async function importarPlanilha(arquivo) {
        let movs;
        try { movs = await lerArquivoPlanilha(arquivo); } catch (e) { ui.aviso(e.message, "erro"); return; }
        const res = N().resumoPlanilha(movs);
        const pts = atual.respostas?.pontos?.lista || [];
        const sem = t => String(t).normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z0-9]/g, "");
        const achar = nome => pts.find(p => sem(p.id) === sem(nome) || sem(p.nome) === sem(nome))?.id || null;
        const nomes = [...new Set(res.pares.flatMap(p => [p.de, p.para]))];
        const soltos = nomes.filter(n => !achar(n)).slice(0, 12);
        const mapa = {};
        nomes.forEach(n => { mapa[n] = achar(n); });
        if (soltos.length) {
            const v = await ui.formulario({ titulo: "De que ponto é cada local da planilha?", confirmar: "Usar", campos: soltos.map((n, i) => ({ nome: "m" + i, rotulo: n, opcoes: [["", "criar um ponto novo"]].concat(pts.map(p => [p.id, p.nome])) })),
                texto: `${movs.length} movimentações em ${res.dias} dia(s). Estes locais não batem com os pontos do questionário.` });
            if (!v) return;
            soltos.forEach((n, i) => {
                let id = v["m" + i];
                if (!id) { id = Pesquisa.idPonto(n); let k = 2; while (pts.some(p => p.id === id)) id = Pesquisa.idPonto(n) + k++; pts.push({ id, nome: String(n).slice(0, 30), tipo: "ambos", x: null, y: null }); }
                mapa[n] = id;
            });
            atual.respostas.pontos = { lista: pts };
        }
        const fl = (atual.respostas.fluxos = atual.respostas.fluxos || {}).lista = atual.respostas.fluxos.lista || [];
        let novos = 0, mudados = 0;
        res.pares.forEach(p => {
            const de = mapa[p.de], para = mapa[p.para];
            if (!de || !para || de === para) return;
            let f = fl.find(x => x.de === de && x.para === para);
            if (!f) { f = { de, para, oque: "", carga: "carrinho", hoje: "pe", prazo: 15 }; fl.push(f); novos++; } else mudados++;
            if (f.fonte !== "planilha") f.quantidadeCliente = f.quantidade;
            Object.assign(f, { quantidade: Math.round(p.porDia * 10) / 10, unidade: "dia", fonte: "planilha", horarios: p.horarios.length >= 3 ? p.horarios : undefined });
        });
        marcar("respostas"); form = null; desenhar();
        ui.aviso(`Planilha: ${mudados} fluxo(s) atualizados e ${novos} novo(s), pela média de ${res.dias} dia(s)${res.diaMaisCheio ? ` (horários do dia mais cheio, ${res.diaMaisCheio})` : ""}. Gere a planta de novo para usar.`, "sucesso");
    }
    function usarDiario() {
        const op = N().operacao(atual.respostas);
        const d = N().resumoDiario(viagens, op);
        if (!d.pares.length) { ui.aviso("O diário ainda não tem viagens.", "aviso"); return; }
        const fl = (atual.respostas.fluxos = atual.respostas.fluxos || {}).lista = atual.respostas.fluxos.lista || [];
        let n = 0;
        d.pares.forEach(p => {
            let f = fl.find(x => x.de === p.de && x.para === p.para);
            if (!f) { f = { de: p.de, para: p.para, oque: "", carga: "carrinho", hoje: "pe", prazo: 15 }; fl.push(f); }
            if (f.fonte !== "diario") f.quantidadeCliente = f.quantidade;
            Object.assign(f, { quantidade: Math.round(p.porDia * 10) / 10, unidade: "dia", fonte: "diario", minutosHoje: Math.round(p.minutos * 10) / 10 });
            n++;
        });
        marcar("respostas"); form = null; desenhar();
        ui.aviso(`Diário: ${d.total} viagens em ${d.dias} dia(s) viraram a quantidade de ${n} fluxo(s). Gere a planta de novo para usar.`, "sucesso");
    }
    async function miraNoQuestionario() {
        if (!window.Mira || !Mira.temPro()) { ui.aviso("Montar os fluxos que faltam é da Mira Pro.", "aviso"); return; }
        const resp = atual.respostas || {};
        const pts = resp.pontos?.lista || [];
        if (pts.length < 2) { ui.aviso("Marque os pontos primeiro: a Mira usa só os pontos do questionário.", "aviso"); return; }
        const linhas = [];
        Pesquisa.BLOCOS.forEach(b => b.campos.forEach(c => {
            const x = resp[b.id]?.[c.id];
            if (["layout", "pontos", "fluxos"].includes(c.tipo) || !Pesquisa.respondido(x)) return;
            const f = Pesquisa.faixa(x);
            linhas.push(`${c.rotulo}: ${Pesquisa.naoSei(x) ? "não sabe" : f ? `${f[0]} a ${f[1]}` : Pesquisa.valor(x)}${c.unidade ? " " + c.unidade : ""}`);
        }));
        const fl = (resp.fluxos?.lista || []).map(f => `${pts.find(p => p.id === f.de)?.nome || f.de} → ${pts.find(p => p.id === f.para)?.nome || f.para}: ${f.oque || ""} ${f.quantidade || "?"} por ${f.unidade || "hora"}`);
        const texto = `Questionário do prospect ${atual.nome} (${atual.setor || "setor não informado"}).\n${linhas.join("\n")}\nFluxos que o cliente já deu:\n${fl.join("\n") || "nenhum"}\nProponha os fluxos de material que FALTAM entre estes pontos (típicos do setor: retorno de vazios, expedição, abastecimento), com viagens por hora de partida. Não repita os que o cliente já deu.`;
        const contexto = { pontos: pts.map(p => ({ id: p.id, nome: p.nome, tipo: p.tipo })), modelos: MODELOS.map(([id, nome]) => ({ id, nome })), missoes: [], fluxosAtuais: fl.slice(0, 30) };
        Mira.abrir(true);
        const r = await Mira.perguntar(texto, { modo: "pro", tarefa: "estudo_fluxos", contexto, semHistorico: true });
        if (!r || r.erro) return;
        const novos = (r.fluxos || []).filter(f => f.de && f.para && !(resp.fluxos?.lista || []).some(x => x.de === f.de && x.para === f.para)).map(f => ({
            de: f.de, para: f.para, oque: f.nome.split(/[·:-]/).pop().trim().slice(0, 40), carga: CARGA_DO_MODELO[(f.modelos || [])[0]] || "carrinho", quantidade: f.porHora, unidade: "hora", prazo: f.prazoMin, hoje: "pe", fonte: "mira", obs: f.obs || ""
        }));
        if (!novos.length) { ui.aviso("A Mira não propôs nenhum fluxo novo entre os pontos do questionário.", "info"); return; }
        atual.respostas.fluxos = { lista: (resp.fluxos?.lista || []).concat(novos) };
        marcar("respostas"); form = null; desenhar();
        ui.aviso(`A Mira propôs ${novos.length} fluxo(s), marcados como estimados. Confira com o cliente.`, "sucesso");
    }

    /* ---------------- rodar o estudo ---------------- */
    async function rodar() {
        if (!atual.planta || !(atual.estudo?.fluxos || []).length) { ui.aviso("Gere a planta e os fluxos do questionário primeiro (aba Planta).", "aviso"); return; }
        const fl = atual.estudo.fluxos.filter(f => f.ativo !== false);
        const quebrados = fl.filter(f => !atual.planta.nos.some(n => n.id === f.de) || !atual.planta.nos.some(n => n.id === f.para));
        if (quebrados.length) { ui.aviso(`Fluxo(s) apontando para ponto que não existe mais na planta: ${quebrados.map(f => f.nome).join(", ")}. Corrija na aba Fluxos.`, "aviso"); aba = "fluxos"; desenhar(); return; }
        rodando = { p: 0, msg: "Começando" }; aba = "resultado"; desenhar();
        let R;
        try {
            R = await N().estudar({ viabilidade: atual.estudo.viabilidade || {},
                respostas: atual.respostas, planta: atual.planta, fluxos: fl, missoes: atual.estudo.missoes || [], calendario: atual.estudo.calendario || N().calendarioDoQuestionario(atual.respostas),
                premissas: atual.estudo.premissas || {}, precos: precosTabela, opcoes: atual.estudo.opcoes || {}, variantes: atual.estudo.variantes || [], premissasNegocio: atual.estudo.premissasNegocio || {},
                avisos: atual.estudo.avisosPlanta || [], cliente: { nome: atual.nome, setor: atual.setor, cidade: atual.cidade }
            }, (p, msg) => {
                rodando = { p, msg };
                const b = document.getElementById("estudosProgresso");
                if (b) { b.value = p; const t = document.getElementById("estudosProgressoTexto"); if (t) t.textContent = `${Math.round(p * 100)}% · ${msg || ""}`; }
            });
        } catch (e) { rodando = null; desenhar(); ui.aviso("O estudo não rodou: " + (e.message || e), "erro"); console.error(e); return; }
        rodando = null;
        R.resumoMira = "";
        atual.resultado = R;
        if (atual.etapa === "pesquisa" || atual.etapa === "estudo") { atual.etapa = "proposta"; marcar("etapa"); }
        marcar("resultado");
        await salvarJa();
        desenhar();
        const pb = R.financeiro?.cenarios?.provavel?.compra?.payback;
        ui.aviso(R.simulacao.recomendado ? `Frota: ${R.simulacao.recomendado.nome}. Payback provável: ${RelatorioEstudo.meses(pb)}${R.fase1 ? `; fase 1 (${R.fase1.frota}): ${RelatorioEstudo.meses(R.fase1.payback)}` : ""}.` : "Nenhuma frota fecha: o estudo não calcula payback. Veja as ações e os cenários da planta.", R.simulacao.recomendado ? "sucesso" : "aviso");
    }
    async function resumoMira() {
        const R = atual.resultado;
        if (!R || !window.Mira || !Mira.temPro()) return;
        Mira.abrir(true);
        const r = await Mira.perguntar("Escreva o resumo executivo deste estudo de frota para a diretoria do cliente.", { modo: "pro", tarefa: "estudo_relatorio", contexto: { cliente: R.cliente, resumo: N().resumoTexto(R), premissas: (R.premissas || []).slice(0, 25).map(p => ({ nome: p.nome, v: p.v, origem: p.origem })) }, semHistorico: true });
        if (!r || r.erro || !r.texto) return;
        atual.resultado.resumoMira = String(r.texto).slice(0, 4000);
        marcar("resultado"); desenhar();
    }
    function imprimir() {
        const R = atual.resultado;
        if (!R) return;
        let caixa = document.getElementById("relatorioImpressao");
        if (!caixa) { caixa = document.createElement("div"); caixa.id = "relatorioImpressao"; document.body.appendChild(caixa); }
        caixa.innerHTML = RelatorioEstudo.html(R, { paraCliente: true });
        document.body.classList.add("imprimindo-relatorio");
        const fim = () => { document.body.classList.remove("imprimindo-relatorio"); removeEventListener("afterprint", fim); };
        addEventListener("afterprint", fim);
        setTimeout(() => { window.print(); setTimeout(fim, 500); }, 250);
    }
    async function converter() {
        if (!naNuvem()) { ui.aviso("Converter em empresa precisa da nuvem.", "aviso"); return; }
        if (!atual.planta) { ui.aviso("Gere a planta do estudo antes: a empresa nasce com ela, as missões e os postos.", "aviso"); return; }
        const sug = atual.nome.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 30);
        const v = await ui.formulario({ titulo: `Converter ${atual.nome} em empresa`, confirmar: "Criar a empresa", campos: [
            { nome: "codigo", rotulo: "Código da empresa", valor: sug, obrigatorio: true, max: 30, dica: "letras minúsculas, números e hífen (vai nos tópicos do MQTT)" },
            { nome: "email", rotulo: "E-mail do administrador do cliente", tipo: "email", valor: atual.contato?.email || "", max: 120, dica: "recebe o convite; pode deixar vazio e convidar depois" }
        ], texto: `A empresa nasce com a planta do estudo publicada (revisão 1), ${(atual.estudo?.missoes || []).length} missão(ões) e ${(atual.estudo?.postos || []).length} posto(s). A planta de estudo é simplificada: revise na implantação.` });
        if (!v) return;
        if (sujos.size) await salvarJa();
        const r = await Nuvem.cliente().rpc("converter_prospect", { p_id: atual.id, p_codigo: v.codigo.trim(), p_email_admin: v.email.trim() });
        if (r.error) { ui.aviso(r.error.message, "erro"); return; }
        ui.aviso(`Empresa criada. Ela aparece em Trocar empresa.`, "sucesso");
        await abrirProspect(atual.id);
    }
    /* ---------------- a proposta comercial (0.23) ---------------- */
    const P = () => PropostaDoc;
    const rascProposta = () => (atual.estudo.proposta = atual.estudo.proposta || {});
    // o rascunho da proposta fica no estudo, mas não deixa o resultado "antigo"
    function marcarProposta() { sujos.add("estudo"); clearTimeout(timer); timer = setTimeout(salvarJa, 1200); const s = document.getElementById("estudosSalvo"); if (s) s.textContent = "Salvando…"; }
    const dadosProposta = () => P().montar(atual.resultado, precosTabela, atual, rascProposta());
    const numLetra = x => `${x.numero} rev. ${P().letra(x.revisao)}`;
    const ultimaAberta = () => propostas.find(x => x.status === "emitida" || x.status === "aceita");
    function proximoNumeroLocal() {
        const ano = new Date().getFullYear();
        let n = {}; try { n = JSON.parse(localStorage.getItem(CHAVE_NUM) || "{}"); } catch (e) { n = {}; }
        n[ano] = (Number(n[ano]) || 0) + 1;
        try { localStorage.setItem(CHAVE_NUM, JSON.stringify(n)); } catch (e) { /* segue */ }
        return `P-${ano}-${String(n[ano]).padStart(3, "0")}`;
    }
    async function emitirProposta(revisaoDe = null) {
        if (!atual.resultado) { ui.aviso("Rode o estudo antes da proposta.", "aviso"); return; }
        if (atual.resultado.desatualizado && !await ui.confirmar({ titulo: "O estudo mudou depois do resultado", texto: "A proposta usa o resultado de agora (frota, payback). Rode de novo antes, se a mudança importa.", confirmar: "Emitir assim mesmo" })) return;
        const d = dadosProposta();
        if (!d.nAtta) { ui.aviso("A proposta precisa de pelo menos um Atta.", "aviso"); return; }
        const ex = d.exemplo.length;
        const ok = await ui.confirmar({ titulo: revisaoDe ? `Emitir a revisão de ${revisaoDe}?` : "Emitir a proposta?", confirmar: "Emitir",
            texto: `${ex ? `Atenção: ${ex} item(ns) da Tabela da E4M ainda são exemplo (${d.exemplo.slice(0, 4).join(", ")}${ex > 4 ? "…" : ""}) e a proposta sai marcada assim. ` : ""}Depois de emitida, a proposta não muda: uma mudança vira uma revisão nova.${revisaoDe ? " A revisão anterior fica substituída." : ""}` });
        if (!ok) return;
        if (sujos.size) await salvarJa();
        const dados = Object.assign({}, d, { opcoes: JSON.parse(JSON.stringify(rascProposta())) });
        if (naNuvem()) {
            const r = await Nuvem.cliente().rpc("emitir_proposta", { p_prospect: atual.id, p_dados: dados, p_numero: revisaoDe });
            if (r.error) { ui.aviso(r.error.message, "erro"); return; }
            await abrirProspect(atual.id);
            ui.aviso(`Proposta ${numLetra(r.data)} emitida.`, "sucesso");
        } else {
            const hoje = new Date();
            const lista = atual.propostas = atual.propostas || [];
            const numero = revisaoDe || proximoNumeroLocal();
            const revisao = revisaoDe ? Math.max(...lista.filter(x => x.numero === numero).map(x => x.revisao)) + 1 : 1;
            lista.forEach(x => { if (x.numero === numero && x.status === "emitida") x.status = "substituida"; });
            const valida = new Date(hoje.getTime() + d.validadeDias * 864e5).toISOString().slice(0, 10);
            lista.push({ id: "PL" + Date.now().toString(36), numero, revisao, status: "emitida", valida_ate: valida, emitida_em: hoje.toISOString(), aceite: null, dados: Object.assign(dados, { numero, revisao, emitidaEm: hoje.toISOString(), validaAte: valida }) });
            if (atual.etapa === "pesquisa" || atual.etapa === "estudo") atual.etapa = "proposta";
            sujos.add("etapa");
            gravarLocal([JSON.parse(JSON.stringify(atual))].concat(lerLocal().filter(p => p.id !== atual.id)));
            propostas = lista.slice().sort((a, b) => String(b.emitida_em).localeCompare(String(a.emitida_em)));
            await salvarJa(); desenhar();
            ui.aviso(`Proposta ${numero} rev. ${P().letra(revisao)} emitida (sem nuvem: só neste navegador, sem link para o cliente).`, "sucesso");
        }
    }
    async function cancelarProposta(id) {
        const x = propostas.find(p => p.id === id);
        if (!x || !await ui.confirmar({ titulo: `Cancelar a proposta ${numLetra(x)}?`, texto: "Os links dela param de abrir. O número não volta.", confirmar: "Cancelar a proposta", perigo: true })) return;
        if (naNuvem()) { const r = await Nuvem.cliente().rpc("cancelar_proposta", { p_id: id }); if (r.error) { ui.aviso(r.error.message, "erro"); return; } await abrirProspect(atual.id); }
        else { const p = (atual.propostas || []).find(p => p.id === id); if (p) p.status = "cancelada"; gravarLocal([JSON.parse(JSON.stringify(atual))].concat(lerLocal().filter(q => q.id !== atual.id))); propostas = (atual.propostas || []).slice().reverse(); desenhar(); }
    }
    async function linkProposta(id) {
        if (!naNuvem()) { ui.aviso("O link da proposta precisa da nuvem. Sem ela, mande o PDF.", "aviso"); return; }
        const x = propostas.find(p => p.id === id);
        const v = await ui.formulario({ titulo: `Link da proposta ${numLetra(x)}`, confirmar: "Criar o link", campos: [{ nome: "dias", rotulo: "Vale por (dias)", tipo: "number", valor: 30 }],
            texto: "O cliente abre sem conta, baixa em PDF e pode aceitar (nome, cargo, e-mail e data ficam registrados)." });
        if (!v) return;
        const r = await Nuvem.cliente().rpc("criar_link_proposta", { p_proposta: id, p_dias: Math.max(1, Math.min(90, Math.round(Number(v.dias) || 30))) });
        if (r.error) { ui.aviso(r.error.message, "erro"); return; }
        await carregarLinks(); desenhar();
        copiar(urlCliente("proposta", r.data.codigo));
    }
    function imprimirProposta(id) {
        const x = id ? propostas.find(p => p.id === id) : null;
        const d = x ? x.dados : dadosProposta();
        let caixa = document.getElementById("relatorioImpressao");
        if (!caixa) { caixa = document.createElement("div"); caixa.id = "relatorioImpressao"; document.body.appendChild(caixa); }
        caixa.innerHTML = P().html(d, x ? { status: x.status, aceite: x.aceite ? { nome: x.aceite.nome, cargo: x.aceite.cargo, em: x.aceita_em || x.aceite.em } : null } : { rascunho: true });
        document.body.classList.add("imprimindo-relatorio");
        const fim = () => { document.body.classList.remove("imprimindo-relatorio"); removeEventListener("afterprint", fim); };
        addEventListener("afterprint", fim);
        setTimeout(() => { window.print(); setTimeout(fim, 500); }, 250);
    }
    function usarComoBase(id) {
        const x = propostas.find(p => p.id === id);
        if (!x?.dados?.opcoes) return;
        atual.estudo.proposta = JSON.parse(JSON.stringify(x.dados.opcoes));
        marcarProposta(); desenhar();
        ui.aviso(`O rascunho agora parte de ${numLetra(x)}, com os preços de hoje da tabela.`, "info");
    }
    function htmlProposta() {
        const R = atual.resultado;
        if (!R) return `<div class="empty-state">A proposta sai do estudo: rode o estudo na aba Fluxos primeiro.</div>`;
        const o = rascProposta();
        const d = dadosProposta();
        const pr = N().precos(precosTabela);
        const brl = P().brl;
        const frota = P().frotaDoEstudo(R);
        const modelos = [...new Set(frota.map(g => g.modelo).concat(Object.keys(o.qtd || {})).concat(MODELOS.map(([m]) => m)))];
        const pend = P().pendencias(precosTabela);
        const aberta = ultimaAberta();
        const extras = (o.extras || []).concat([{}]).slice(0, 12);
        const STATUS = { emitida: "emitida", aceita: "aceita", substituida: "substituída", cancelada: "cancelada" };
        const cont = d.cliente.contato || {};
        return `${R.desatualizado ? `<div class="missao-dica ambar">O estudo mudou depois do resultado: a proposta usa o resultado antigo. Rode de novo se a mudança importa.</div>` : ""}
        ${pend.length ? `<div class="missao-dica ambar"><b>${pend.filter(x => !x.aviso).length} item(ns) da Tabela da E4M ainda são exemplo</b> e saem marcados na proposta: ${pend.map(x => esc(x.rotulo)).join(", ")}. <button type="button" class="btn-link" data-es="precos">Abrir a Tabela da E4M</button></div>` : ""}
        <section class="card estudo-duas proposta-form">
            <div><h3>O que vai na proposta</h3>
                <p class="suave">Parte da frota do estudo (${esc(R.simulacao?.recomendado?.nome || "nenhuma fecha")}). Preços, plano, serviços e condições vêm da Tabela da E4M.</p>
                <div class="estudo-premissas">${modelos.map(m => `<label class="campo"><span>${esc(MODELOS.find(x => x[0] === m)?.[1].split(" (")[0] || m)} <small class="suave">${brl(Number(pr.atta[m]) || 0)}</small></span><input type="number" min="0" step="1" class="estudo-num" data-pp-qtd="${esc(m)}" value="${o.qtd?.[m] ?? (frota.find(g => g.modelo === m)?.n || 0)}"></label>`).join("")}
                    <label class="campo"><span>Módulos Eciton I/O <small class="suave">${brl(pr.moduloIO)}</small></span><input type="number" min="0" step="1" class="estudo-num" data-pp="modulosIO" value="${Number(o.modulosIO) || 0}"></label>
                    <label class="campo"><span>Berços a mais <small class="suave">${brl(pr.bercoExtra)}</small></span><input type="number" min="0" step="1" class="estudo-num" data-pp="bercos" value="${Number(o.bercos) || 0}"></label>
                    <label class="campo"><span>Desconto no hardware</span><span class="estudo-un"><input type="number" min="0" max="50" step="0.5" data-pp="descontoPct" value="${Math.round((Number(o.descontoPct) || 0) * 1000) / 10}"><i>%</i></span></label>
                    <label class="campo"><span>Validade</span><span class="estudo-un"><input type="number" min="1" max="180" step="1" data-pp="validadeDias" value="${d.validadeDias}"><i>dias</i></span></label></div>
                <h4>Itens a mais</h4>
                ${tabela(["Descrição", "Qtd.", "Preço unitário (R$)", ""], extras.map((x, i) => [
                    `<input type="text" maxlength="80" data-pp-extra="${i}" data-c="descricao" value="${esc(x.descricao || "")}" placeholder="${i === (o.extras || []).length ? "ex.: carrinho adaptado" : ""}" aria-label="Descrição">`,
                    `<input type="number" min="0" step="1" class="estudo-num" data-pp-extra="${i}" data-c="qtd" value="${x.qtd ?? ""}" aria-label="Quantidade">`,
                    `<input type="text" inputmode="decimal" class="estudo-num" data-pp-extra="${i}" data-c="unitario" value="${x.unitario != null ? String(x.unitario).replace(".", ",") : ""}" aria-label="Preço unitário">`,
                    i < (o.extras || []).length ? `<button type="button" class="btn-remover-fila" data-pp-tirar="${i}" aria-label="Tirar o item">×</button>` : ""]), "proposta-extras")}
            </div>
            <div><h3>Para quem e como</h3>
                <label class="campo"><span>Aos cuidados de</span><input type="text" maxlength="80" data-pp-contato="nome" value="${esc(cont.nome || "")}"></label>
                <label class="campo"><span>E-mail do contato</span><input type="email" maxlength="120" data-pp-contato="email" value="${esc(cont.email || "")}"></label>
                <label class="campo"><span>Plano do Eciton</span><select data-pp="plano">${pr.planos.map(x => `<option value="${esc(x.id)}" ${d.plano.id === x.id ? "selected" : ""}>${esc(x.nome)} · ${brl(N().mensalidade(x, d.nAtta))}/mês</option>`).join("")}</select></label>
                <label class="config-chave"><input type="checkbox" data-pp-mostrar="compra" ${d.mostrar.compra ? "checked" : ""}><span>Opção de compra</span></label>
                <label class="config-chave"><input type="checkbox" data-pp-mostrar="mensalidade" ${d.mostrar.mensalidade ? "checked" : ""}><span>Opção de pagar por mês</span></label>
                <label class="campo"><span>Observações (vão na proposta)</span><textarea rows="3" maxlength="2000" data-pp="observacoes">${esc(o.observacoes || "")}</textarea></label>
                <div class="proposta-totais"><div><span>Compra</span><b>${brl(d.compra.total)}</b><small>+ ${brl(d.compra.mensal)}/mês</small></div><div><span>Por mês</span><b>${brl(d.mensalidade.total)}</b><small>+ ${brl(d.mensalidade.inicial)} na implantação</small></div></div>
                <div class="grupo"><button type="button" class="btn btn-primario" data-es="emitirProposta">${aberta && aberta.status === "emitida" ? "Emitir como proposta nova" : "Emitir a proposta"}</button>
                    ${aberta && aberta.status === "emitida" ? `<button type="button" class="btn" data-es="revisarProposta">Emitir a revisão de ${esc(aberta.numero)}</button>` : ""}
                    <button type="button" class="btn" data-es="pdfRascunho">${ui.icone("pdf", "icone-p")}PDF do rascunho</button></div>
            </div>
        </section>
        ${propostas.length ? `<section class="card"><h3>Propostas emitidas</h3>${tabela(["Proposta", "Emitida", "Válida até", "Compra", "Situação", ""], propostas.map(x => [
            `<b>${esc(numLetra(x))}</b>`, dataTxt(x.emitida_em), x.valida_ate ? new Date(x.valida_ate + "T12:00:00").toLocaleDateString("pt-BR") : "--", brl(x.dados?.compra?.total),
            `<span class="estudo-chip ${x.status === "aceita" ? "ok" : ""}">${STATUS[x.status] || x.status}</span>${x.aceite ? `<small class="suave estudo-origem">por ${esc(x.aceite.nome)}${x.aceite.cargo ? `, ${esc(x.aceite.cargo)}` : ""} em ${dataTxt(x.aceita_em || x.aceite.em)}</small>` : ""}`,
            `<button type="button" class="btn btn-mini" data-pp-pdf="${esc(x.id)}">PDF</button>
             ${x.status === "emitida" || x.status === "aceita" ? `<button type="button" class="btn btn-mini" data-pp-link="${esc(x.id)}">Link</button>` : ""}
             <button type="button" class="btn btn-mini" data-pp-base="${esc(x.id)}">Usar como base</button>
             ${x.status === "emitida" ? `<button type="button" class="btn btn-mini btn-perigo-suave" data-pp-cancelar="${esc(x.id)}">Cancelar</button>` : ""}`]))}</section>` : ""}
        <div class="estudos-relatorio">${P().html(d, { rascunho: true })}</div>`;
    }

    /* ---------------- a tabela da E4M (preços, planos, a pessoa de referência e as premissas) ---------------- */
    // as premissas mostradas em %, e o caminho de cada campo no rascunho ("atta.atta-g-o", "planos.0.nome", "premissas.pfd.0")
    const PCT_PREM = new Set(["pfd", "faltas", "disponibilidadeAtta", "coberturaFrota", "reducaoParadas", "reducaoErros", "reducaoAvarias", "reducaoAcidentes", "margemMinuto", "materialPct", "coberturaHoje", "coberturaE4M", "crescimento", "custoCapital"]);
    const PREM_NOMES = { velocidadePe: "Velocidade a pé com carga (m/s)", velocidadeEmp: "Velocidade da empilhadeira (m/s)", manuseioS: "Pegar ou entregar à mão, por ponta (s)", manuseioEmpS: "Pegar ou deixar de empilhadeira, por ponta (s)",
        pfd: "Pausas, fadiga e esperas", faltas: "Faltas e afastamentos", disponibilidadeAtta: "Disponibilidade do Atta", coberturaFrota: "Parte do transporte que a frota assume", custoEmpilhadeira: "Empilhadeira por mês, sem o operador (R$)",
        reducaoParadas: "Paradas evitadas", reducaoErros: "Erros evitados", reducaoAvarias: "Avarias evitadas", reducaoAcidentes: "Acidentes evitados", custoAcidente: "Acidente com afastamento (R$)",
        margemMinuto: "Margem perdida no minuto parado", materialPct: "Material sobre o faturamento", coberturaHoje: "Estoque na linha hoje (h)", coberturaE4M: "Estoque na linha com a frota (h)",
        crescimento: "Crescimento da demanda por ano", custoCapital: "Custo de capital por ano", custoM2: "Aluguel do m² por mês (R$)", larguraEmp: "Corredor de empilhadeira (m)", larguraAtta: "Corredor do Atta (m)",
        kwhHoraAtta: "Consumo do Atta (kWh por hora)", co2Kwh: "CO₂ da energia (kg por kWh)", glpHora: "Gás da empilhadeira (kg por hora)", co2Glp: "CO₂ do gás (kg por kg)", horasMes: "Horas de trabalho por mês" };
    let tabelaRasc = null, tabelaSuja = false;
    let voltarPara = null;
    // os campos que a E4M já mudou (os outros saem como exemplo na proposta)
    const confirmadoRasc = cam => (tabelaRasc?.confirmados || []).some(c => c === cam || c.startsWith(cam + ".") || cam.startsWith(c + "."));
    function confirmar(cam) {
        if (!tabelaRasc || !cam) return;
        const k = /^atta\./.test(cam) ? "atta" : /^planos/.test(cam) ? "planos" : /^comercial\.pagamentoCompra/.test(cam) ? "comercial.pagamentoCompra" : cam;
        tabelaRasc.confirmados = [...new Set((tabelaRasc.confirmados || []).concat(k))];
    }
    async function abrirTabela() {
        if (atual) { if (sujos.size) await salvarJa(); voltarPara = { id: atual.id, aba }; atual = null; }
        tabelaRasc = JSON.parse(JSON.stringify(N().precos(precosTabela)));
        tabelaSuja = false; desenhar();
    }
    const lerCaminho = (o, cam) => cam.split(".").reduce((x, k) => (x == null ? x : x[k]), o);
    function gravarCaminho(o, cam, v) {
        const ks = cam.split(".");
        let x = o;
        ks.slice(0, -1).forEach((k, i) => { if (x[k] == null) x[k] = /^\d+$/.test(ks[i + 1]) ? [] : {}; x = x[k]; });
        x[ks[ks.length - 1]] = v;
    }
    // número em pt-BR: "2.410,74", "1.200" (milhar) e "2410.74" (ponto decimal) valem
    const numTxt = t => {
        let x = String(t ?? "").trim().replace(/\s|R\$/g, "");
        if (!x) return null;
        if (x.includes(",")) x = x.replace(/\./g, "").replace(",", ".");
        else if (/^-?\d{1,3}(\.\d{3})+$/.test(x)) x = x.replace(/\./g, "");
        const n = Number(x);
        return Number.isFinite(n) ? n : null;
    };
    const virg = v => String(v).replace(".", ",");
    async function salvarTabela() {
        const dados = JSON.parse(JSON.stringify(tabelaRasc));
        // premissas iguais às de fábrica não vão (a fábrica pode mudar numa versão nova)
        Object.keys(dados.premissas || {}).forEach(k => {
            const f = N().PREMISSAS[k], o = dados.premissas[k];
            if (!f || !Array.isArray(o) || o.some(x => !Number.isFinite(Number(x))) || (o[0] === f[0] && o[1] === f[1] && o[2] === f[2])) delete dados.premissas[k];
        });
        if (!dados.planos.length) { ui.aviso("A tabela precisa de pelo menos um plano.", "aviso"); return; }
        const somaParc = (dados.comercial.pagamentoCompra || []).reduce((x, y) => x + (Number(y.pct) || 0), 0);
        if (Math.abs(somaParc - 100) > 0.01) { ui.aviso(`As parcelas do pagamento na compra somam ${somaParc}%: precisam dar 100%.`, "aviso"); return; }
        dados.atualizado = new Date().toISOString();
        if (naNuvem()) { const r = await Nuvem.cliente().rpc("salvar_tabela_precos", { p_dados: dados }); if (r.error) { ui.aviso(r.error.message, "erro"); return; } }
        else try { localStorage.setItem(CHAVE_PRECOS, JSON.stringify(dados)); } catch (e) { /* sem espaço */ }
        precosTabela = dados; tabelaSuja = false;
        ui.aviso("Tabela da E4M salva. Os estudos usam a tabela quando rodam: rode de novo os que já têm resultado.", "sucesso");
        desenhar();
    }
    function htmlTabela() {
        const t = tabelaRasc, Nn = N(), REF = Nn.REFERENCIAS || {};
        const brl = RelatorioEstudo.brl;
        const exTag = cam => (confirmadoRasc(cam) ? "" : ` <span class="tag-exemplo" title="Valor de exemplo: mude para o da E4M">exemplo</span>`);
        const campo = (cam, rot, opc = {}) => {
            const v = lerCaminho(t, cam);
            const marca = opc.exemplo ? exTag(cam) : "";
            if (opc.area || opc.linhas) {
                const txt = opc.linhas ? (Array.isArray(v) ? v.join("\n") : String(v || "")) : String(v ?? "");
                return `<label class="campo campo-inteiro"><span>${rot}${marca}</span><textarea rows="${opc.linhas ? Math.max(3, (Array.isArray(v) ? v.length : 3) + 1) : 2}" data-tp="${esc(cam)}" data-tp-texto ${opc.linhas ? "data-tp-linhas" : ""} maxlength="${opc.max || 1000}">${esc(txt)}</textarea>${opc.dica ? `<small class="suave">${esc(opc.dica)}</small>` : ""}</label>`;
            }
            const mostra = opc.texto ? (v ?? "") : v == null || v === "" ? "" : virg(opc.pct ? Math.round(v * 10000) / 100 : v);
            return `<label class="campo ${opc.texto ? "campo-largo" : ""}"><span>${rot}${marca}</span><span class="estudo-un"><input type="${opc.texto ? "text" : "text"}" ${opc.texto ? "" : 'inputmode="decimal"'} data-tp="${esc(cam)}" ${opc.pct ? "data-tp-pct" : ""} ${opc.texto ? "data-tp-texto" : ""} value="${esc(mostra)}" ${opc.max ? `maxlength="${opc.max}"` : ""}>${opc.un ? `<i>${opc.un}</i>` : opc.pct ? "<i>%</i>" : ""}</span>${opc.dica ? `<small class="suave">${esc(opc.dica)}</small>` : ""}</label>`;
        };
        const ref = k => (REF[k] ? `<p class="suave tabela-ref">Referência: ${esc(REF[k])}</p>` : "");
        const pes = t.pessoa;
        const enc = Nn.encargos(t, pes.regime);
        const refPessoa = pes.salario * (1 + enc.total) + Number(pes.beneficios || 0);
        const fab = Nn.PREMISSAS;
        return `<section class="card estudos-topo"><div class="estudo-topo-linha"><div><button type="button" class="btn-link" data-es="voltarTabela">← Estudos</button><h2>Tabela da E4M</h2>
            <p class="suave">Os preços, os planos e as premissas que o estudo usa. Só a E4M vê e muda; o cliente vê no relatório apenas o preço dos Atta da proposta, o plano escolhido e o resultado. Vale para os estudos que rodarem depois de salvar.</p></div>
            <div class="grupo"><button type="button" class="btn" data-es="fabricaTabela">Valores de fábrica</button><button type="button" class="btn btn-primario" data-es="salvarTabela" ${tabelaSuja ? "" : "disabled"}>Salvar a tabela</button></div></div>
            ${precosTabela?.atualizado ? `<p class="suave">Última mudança salva em ${dataTxt(precosTabela.atualizado)}.</p>` : `<p class="missao-dica ambar">A E4M ainda não salvou uma tabela: os estudos usam os valores de partida abaixo.</p>`}
        </section>
        <section class="card"><h3>Atta (preço de venda, por unidade)${exTag("atta")}</h3>
            <div class="estudo-premissas">${MODELOS.map(([id, nome]) => campo("atta." + id, nome.split(" (")[0], { un: "R$" })).join("")}</div>${ref("atta")}</section>
        <section class="card"><div class="estudo-cab"><h3>Planos do Eciton${exTag("planos")}</h3><button type="button" class="btn" data-es="planoNovo">+ Plano</button></div>
            <p class="suave">O relatório usa o preço do plano escolhido em cada estudo (por mês: o fixo pela fábrica mais o valor por Atta). No resultado, a E4M vê o payback do estudo em cada plano daqui.</p>
            <div class="tabela-planos">${t.planos.map((p, i) => `<div class="tabela-plano ${t.planoPadrao === p.id ? "padrao" : ""}" data-tp-plano="${i}">
                <label class="campo tabela-plano-nome"><span>Nome do plano</span><input type="text" data-tp="planos.${i}.nome" data-tp-texto maxlength="40" value="${esc(p.nome)}"></label>
                <div class="tabela-plano-topo">
                    <label class="campo"><span>Mira</span><select data-tp="planos.${i}.mira" data-tp-texto>${Object.entries(Nn.MIRA_PLANO).map(([k, x]) => `<option value="${k}" ${p.mira === k ? "selected" : ""}>${x}</option>`).join("")}</select></label>
                    <label class="config-chave tabela-plano-padrao"><input type="radio" name="tpPadrao" data-tp-padrao="${esc(p.id)}" ${t.planoPadrao === p.id ? "checked" : ""}><span>Padrão</span></label>
                    ${t.planos.length > 1 ? `<button type="button" class="btn-remover-fila" data-tp-tirar="${i}" aria-label="Tirar o plano ${esc(p.nome)}" title="Tirar o plano">×</button>` : ""}
                </div>
                <label class="campo"><span>O que inclui <small class="suave">(vai no relatório do cliente)</small></span><textarea data-tp="planos.${i}.inclui" data-tp-texto maxlength="160" rows="2">${esc(p.inclui)}</textarea></label>
                <div class="tabela-plano-precos">
                    <label class="campo"><span>Fixo por mês <small class="suave">(a fábrica)</small></span><span class="estudo-un"><input type="text" inputmode="decimal" data-tp="planos.${i}.fixoMes" value="${virg(p.fixoMes)}"><i>R$</i></span></label>
                    <label class="campo"><span>Por Atta, por mês</span><span class="estudo-un"><input type="text" inputmode="decimal" data-tp="planos.${i}.porAttaMes" value="${virg(p.porAttaMes)}"><i>R$</i></span></label>
                    <p class="suave tabela-plano-exemplo">Com 5 Atta: <b>${brl(Nn.mensalidade(p, 5), false)}</b> por mês</p>
                </div>
            </div>`).join("")}</div>
            ${ref("software")}${ref("mensalidade")}</section>
        <section class="card"><h3>Serviços</h3><div class="estudo-premissas">
            ${campo("implantacaoPct", "Implantação (do hardware)", { exemplo: true,  pct: true })}${campo("manutencaoPct", "Manutenção por ano (do hardware)", { exemplo: true,  pct: true, dica: "a partir do 2º ano" })}
            ${campo("expansaoPct", "Implantação de Atta a mais (do hardware novo)", { pct: true })}${campo("moduloIO", "Módulo Eciton I/O instalado", { exemplo: true,  un: "R$" })}
            ${campo("locacaoPctMes", "Mensalidade do hardware (por mês)", { exemplo: true,  pct: true, dica: "na opção de pagar por mês, com a manutenção" })}${campo("locacaoMeses", "Contrato da mensalidade", { exemplo: true,  un: "meses" })}
            ${campo("segundoAcesso", "Segundo acesso no gargalo", { un: "R$" })}${campo("bercoExtra", "Berço a mais", { exemplo: true,  un: "R$" })}${campo("energiaKwh", "Energia", { un: "R$/kWh" })}</div>
            ${ref("manutencao")}${ref("implantacao")}</section>
        <section class="card"><h3>Adaptar a planta para outro módulo${exTag("adaptacao")}</h3>
            <p class="suave">Nos cenários da planta, quando um módulo passa a levar a carga de outro, o estudo soma este custo por ponto atendido (a origem e o destino de cada fluxo que muda). A carga sem linha aqui não vai nesse módulo.</p>
            <div class="estudo-premissas">${Object.keys(t.adaptacao || {}).map(k => { const [cg, md] = k.split(":"); return campo(`adaptacao.${k}.0`, `${{ caixa: "Caixa ou kit", carrinho: "Carrinho", esteira: "Esteira", palete: "Palete", comboio: "Comboio" }[cg] || cg} no Atta ${md}`, { un: "R$", dica: t.adaptacao[k][1] }); }).join("")}</div></section>
        <section class="card"><h3>A empresa na proposta</h3>
            <p class="suave">Sem CNPJ, a proposta sai como <b>preliminar</b> ("o contrato e a nota fiscal são emitidos pela pessoa jurídica"). Preencha quando a E4M tiver o CNPJ: as próximas propostas já saem com ele.</p>
            <div class="estudo-premissas">${campo("comercial.nomeFantasia", "Nome", { texto: true, max: 80 })}${campo("comercial.razaoSocial", "Razão social", { texto: true, max: 120 })}
                ${campo("comercial.cnpj", "CNPJ", { texto: true, max: 20 })}${campo("comercial.endereco", "Endereço", { texto: true, max: 160 })}
                ${campo("comercial.email", "E-mail comercial", { texto: true, max: 120 })}${campo("comercial.telefone", "Telefone", { texto: true, max: 30 })}
                ${campo("comercial.site", "Site", { texto: true, max: 120 })}${campo("comercial.responsavel", "Quem assina pela E4M", { texto: true, max: 80 })}
                ${campo("comercial.avisoAceite", "E-mail que recebe o aviso de aceite", { texto: true, max: 120, dica: "precisa do Resend ligado no banco (como os alertas)" })}</div></section>
        <section class="card"><h3>Condições comerciais <small class="suave">da proposta</small></h3>
            <p class="suave">Os valores de partida são <b>exemplos</b> e saem marcados assim na proposta até vocês mudarem cada um. Revise as condições com o jurídico e a contabilidade.</p>
            <div class="estudo-premissas">${campo("comercial.validadeDias", "Validade da proposta", { un: "dias", exemplo: true })}${campo("comercial.prazoFabricacaoSemanas", "Prazo de fabricação", { un: "semanas", exemplo: true })}
                ${campo("comercial.garantiaMeses", "Garantia", { un: "meses", exemplo: true })}</div>
            <h4>Pagamento na compra${exTag("comercial.pagamentoCompra")} <small class="suave">(soma ${(t.comercial.pagamentoCompra || []).reduce((a, x) => a + (Number(x.pct) || 0), 0)}%${(t.comercial.pagamentoCompra || []).reduce((a, x) => a + (Number(x.pct) || 0), 0) !== 100 ? ", precisa dar 100%" : ""})</small></h4>
            ${tabela(["Quando", "%", ""], (t.comercial.pagamentoCompra || []).map((x, i) => [
                `<input type="text" maxlength="60" data-tp="comercial.pagamentoCompra.${i}.quando" data-tp-texto value="${esc(x.quando)}" aria-label="Quando" class="tabela-largo">`,
                `<span class="estudo-un"><input type="text" inputmode="decimal" class="estudo-num" data-tp="comercial.pagamentoCompra.${i}.pct" value="${virg(x.pct)}" aria-label="Porcentagem"><i>%</i></span>`,
                (t.comercial.pagamentoCompra || []).length > 1 ? `<button type="button" class="btn-remover-fila" data-tp-tirar-parcela="${i}" aria-label="Tirar a parcela">×</button>` : ""]))}
            <button type="button" class="btn btn-mini" data-es="parcelaNova">+ Parcela</button>
            <div class="estudo-premissas tabela-textos">${campo("comercial.pagamentoMensal", "Pagamento na opção por mês", { area: true, exemplo: true })}
                ${campo("comercial.garantia", "O que a garantia cobre", { area: true, exemplo: true })}${campo("comercial.suporte", "Suporte", { area: true, exemplo: true })}
                ${campo("comercial.frete", "Frete", { area: true, exemplo: true })}${campo("comercial.impostos", "Impostos", { area: true, exemplo: true })}${campo("comercial.reajuste", "Reajuste", { area: true, exemplo: true })}
                ${campo("comercial.inclui", "A implantação inclui (um por linha)", { linhas: true, exemplo: true })}${campo("comercial.naoInclui", "O que fica com o cliente (um por linha)", { linhas: true, exemplo: true })}
                ${campo("comercial.condicoesGerais", "Condições gerais", { area: true, exemplo: true, max: 3000 })}</div></section>
        <section class="card"><h3>A pessoa de referência <small class="suave">quando o cliente não sabe a folha</small></h3>
            <p class="suave">O cliente responde no questionário o salário médio, os benefícios, a PLR e o regime de impostos; o estudo calcula os encargos com os percentuais daqui. Sem resposta, usa esta pessoa. Hoje: <b>${brl(refPessoa, false)}</b> por mês (encargos de ${(Math.round(enc.total * 1000) / 10).toLocaleString("pt-BR")}%).</p>
            <div class="estudo-premissas">${campo("pessoa.salario", "Salário", { un: "R$" })}${campo("pessoa.fonteSalario", "Fonte do salário (vai no relatório)", { texto: true, max: 120 })}
                ${campo("pessoa.beneficios", "Benefícios por mês", { un: "R$", dica: "VR ou VA, VT (a parte da empresa), plano de saúde" })}
                <label class="campo"><span>Regime padrão</span><select data-tp="pessoa.regime" data-tp-texto>${[["real", "Lucro Real"], ["presumido", "Lucro Presumido"], ["simples", "Simples Nacional"]].map(([k, x]) => `<option value="${k}" ${pes.regime === k ? "selected" : ""}>${x}</option>`).join("")}</select></label></div>
            <h4>Encargos (sobre o salário)</h4><div class="estudo-premissas">
                ${campo("pessoa.encargos.decimo", "13º salário", { pct: true })}${campo("pessoa.encargos.ferias", "Férias + 1/3", { pct: true })}${campo("pessoa.encargos.inss", "INSS patronal", { pct: true, dica: "fora do Simples" })}
                ${campo("pessoa.encargos.rat", "RAT", { pct: true, dica: "1% a 3%, pelo risco da atividade" })}${campo("pessoa.encargos.terceiros", "Terceiros (Sistema S e outros)", { pct: true, dica: "fora do Simples" })}
                ${campo("pessoa.encargos.fgts", "FGTS", { pct: true })}${campo("pessoa.encargos.rescisao", "Reserva de rescisão", { pct: true })}</div>
            <p class="suave">INSS, RAT, terceiros e FGTS incidem também sobre o 13º e as férias (o estudo já faz essa conta).</p>${ref("salario")}${ref("encargos")}</section>
        <section class="card"><h3>Premissas técnicas</h3>
            <p class="suave">Valem quando o cliente não tem o dado. Em branco: o valor de fábrica. A faixa vai para o conservador (o lado ruim) e o otimista.</p>
            ${tabela(["Premissa", "Valor", "Mínimo", "Máximo", "De fábrica"], Object.keys(fab).filter(k => PREM_NOMES[k]).map(k => {
                const f = fab[k], o = t.premissas?.[k], pc = PCT_PREM.has(k);
                const mostra = x => (x == null ? "" : virg(pc ? Math.round(x * 10000) / 100 : x));
                const fv = x => (pc ? `${Math.round(x * 1000) / 10}%` : String(x).replace(".", ","));
                return [`<b>${esc(PREM_NOMES[k])}</b><small class="suave">${esc(f[3] || "")}</small>`,
                    ...[0, 1, 2].map(j => `<span class="estudo-un"><input type="text" inputmode="decimal" class="estudo-num" data-tp-prem="${k}" data-j="${j}" value="${esc(mostra(o?.[j]))}" placeholder="${esc(mostra(f[j]))}" aria-label="${esc(PREM_NOMES[k])} ${["valor", "mínimo", "máximo"][j]}">${pc ? "<i>%</i>" : ""}</span>`),
                    `${fv(f[0])} <small class="suave">${fv(f[1])} a ${fv(f[2])}</small>`];
            }), "tabela-premissas")}</section>`;
    }

    /* ---------------- desenhar ---------------- */
    const tabela = (cab, linhas, classe = "") => `<div class="tabela-rolagem"><table class="tabela-usuarios ind-tabela ${classe}"><thead><tr>${cab.map(c => `<th>${c}</th>`).join("")}</tr></thead><tbody>${linhas.map(l => `<tr>${l.map(c => `<td>${c}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
    const etapaTxt = e => ETAPAS.find(([k]) => k === e)?.[1] || e;

    function htmlLista() {
        return `<section class="card estudos-topo">
            <div class="estudo-topo-linha"><div><h2>Estudos de frota</h2><p class="suave">Prospects em negociação: o cliente responde o questionário pelo link, o estudo gera a planta, simula, testa as ações e faz as contas; o relatório vai pelo link ou em PDF. Fechou: converter em empresa.</p></div>
            <div class="grupo"><button type="button" class="btn" data-es="precos">Tabela da E4M</button><button type="button" class="btn btn-primario" data-es="novo">+ Prospect</button></div></div>
            ${naNuvem() ? "" : `<p class="missao-dica ambar">Sem nuvem: os estudos ficam neste navegador e não há links para o cliente.</p>`}
        </section>
        ${lista.length ? `<section class="card">${tabela(["Prospect", "Setor", "Etapa", "Questionário", "Frota", "Payback provável", "Atualizado"], lista.map(p => [
            `<button type="button" class="btn-link" data-es-abrir="${esc(p.id)}"><b>${esc(p.nome)}</b></button>${p.cidade ? `<small class="suave estudo-origem">${esc(p.cidade)}</small>` : ""}`,
            esc(p.setor || "--"), `<span class="estudo-chip">${esc(etapaTxt(p.etapa))}</span>`, p.respondido_em ? `respondido em ${dataTxt(p.respondido_em)}` : `<span class="suave">aguardando</span>`,
            esc(p.frota || "--"), p.payback !== undefined && p.frota ? esc(RelatorioEstudo.meses(p.payback)) : "--", dataTxt(p.atualizado_em)]))}</section>`
            : `<div class="empty-state">Nenhum prospect ainda. Comece por <b>+ Prospect</b> e mande o link do questionário.</div>`}`;
    }
    function htmlTopo() {
        return `<section class="card estudos-topo">
            <div class="estudo-topo-linha"><div><button type="button" class="btn-link" data-es="voltar">← Estudos</button><h2>${esc(atual.nome)}</h2>
                <p class="suave">${[atual.setor, atual.cidade].filter(Boolean).map(esc).join(" · ")} · etapa <b>${esc(etapaTxt(atual.etapa))}</b>${atual.empresa_id ? " · já é empresa no Eciton" : ""}</p></div>
                <span class="suave" id="estudosSalvo">${sujos.size ? "Salvando…" : "Salvo"}</span></div>
            <nav class="ind-abas" role="tablist">${ABAS.map(([k, t]) => `<button type="button" role="tab" data-es-aba="${k}" class="${aba === k ? "ativo" : ""}" aria-selected="${aba === k}">${t}${k === "resultado" && atual.resultado?.desatualizado ? " (antigo)" : ""}</button>`).join("")}</nav>
        </section>`;
    }
    function htmlCliente() {
        const c = atual.contato || {};
        const vivos = links.filter(l => !l.cancelado && Date.parse(l.expira_em) > Date.now());
        const TIPO = { pesquisa: "Questionário", diario: "Diário de viagens", relatorio: "Relatório", proposta: "Proposta" };
        return `<section class="card estudo-duas">
            <div><h3>Prospect</h3>
                <label class="campo"><span>Empresa</span><input type="text" data-es-campo="nome" maxlength="80" value="${esc(atual.nome)}"></label>
                <label class="campo"><span>Setor</span><input type="text" data-es-campo="setor" maxlength="60" value="${esc(atual.setor || "")}"></label>
                <label class="campo"><span>Cidade</span><input type="text" data-es-campo="cidade" maxlength="60" value="${esc(atual.cidade || "")}"></label>
                <label class="campo"><span>Etapa</span><select data-es-campo="etapa">${ETAPAS.map(([k, t]) => `<option value="${k}" ${atual.etapa === k ? "selected" : ""}>${t}</option>`).join("")}</select></label>
            </div>
            <div><h3>Contato</h3>
                <label class="campo"><span>Nome</span><input type="text" data-es-contato="nome" maxlength="80" value="${esc(c.nome || "")}"></label>
                <label class="campo"><span>E-mail</span><input type="email" data-es-contato="email" maxlength="120" value="${esc(c.email || "")}"></label>
                <label class="campo"><span>Telefone</span><input type="text" data-es-contato="telefone" maxlength="30" value="${esc(c.telefone || "")}"></label>
                <label class="campo"><span>Notas (só a E4M vê)</span><textarea data-es-campo="notas" rows="3" maxlength="4000">${esc(atual.notas || "")}</textarea></label>
            </div>
        </section>
        <section class="card"><div class="estudo-cab"><h3>Links para o cliente</h3>
            <div class="grupo"><button type="button" class="btn" data-es-link="pesquisa">Questionário</button><button type="button" class="btn" data-es-link="diario">Diário de viagens</button><button type="button" class="btn" data-es-link="relatorio" ${atual.resultado ? "" : "disabled"}>Relatório</button></div></div>
            ${!naNuvem() ? `<p class="suave">Os links precisam da nuvem.</p>` : vivos.length ? tabela(["Link", "Vale até", "Aberto", ""], vivos.map(l => [TIPO[l.tipo], dataTxt(l.expira_em), `${l.usos}×${l.ultimo_uso ? ` · último ${dataTxt(l.ultimo_uso)}` : ""}`,
                `<button type="button" class="btn btn-mini" data-es-copiar="${esc(urlCliente(l.tipo, l.codigo))}">Copiar</button> <button type="button" class="btn btn-mini btn-perigo-suave" data-es-cancelar="${esc(l.codigo)}">Cancelar</button>`])) : `<p class="suave">Nenhum link valendo. Comece pelo questionário: o cliente responde sozinho, sem conta.</p>`}
            ${atual.respondido_em ? `<p class="estudo-ok">O cliente enviou o questionário em ${dataTxt(atual.respondido_em)}.</p>` : ""}
            ${viagens.length ? `<p class="suave">Diário: ${viagens.length} viagem(ns) registrada(s). Use na aba Pesquisa.</p>` : ""}
        </section>
        <section class="card"><div class="grupo">
            ${atual.empresa_id ? `<span class="estudo-ok">Convertido em empresa.</span>` : `<button type="button" class="btn btn-primario" data-es="converter">Converter em empresa</button>`}
            <button type="button" class="btn btn-perigo-suave" data-es="apagar">Apagar o prospect</button></div>
            <p class="suave">Converter cria a empresa no Eciton com a planta do estudo, as missões e os postos, e convida o administrador do cliente.</p></section>`;
    }
    function htmlPesquisa() {
        const prog = Pesquisa.progresso(atual.respostas || {});
        const feitos = Object.values(prog).reduce((s, x) => s + x[0], 0), total = Object.values(prog).reduce((s, x) => s + x[1], 0);
        const temPro = window.Mira && Mira.temPro && Mira.temPro();
        const d = viagens.length ? N().resumoDiario(viagens, N().operacao(atual.respostas)) : null;
        return `<section class="card"><div class="estudo-cab"><h3>Questionário <small class="suave">${feitos} de ${total} respondidos${atual.respondido_em ? ` · enviado pelo cliente em ${dataTxt(atual.respondido_em)}` : ""}</small></h3>
            <div class="grupo"><button type="button" class="btn" data-es="setor">Usar o modelo do setor</button>
                <label class="btn"><input type="file" accept=".csv,.xlsx,.xls,.txt" data-es-planilha hidden>Planilha de movimentações</label>
                ${d ? `<button type="button" class="btn" data-es="diario">Usar o diário (${d.total} viagens, ${d.dias} dia(s))</button>` : ""}
                ${temPro ? `<button type="button" class="btn" data-es="mira">Completar com a Mira Pro</button>` : ""}</div></div>
            <p class="suave">O mesmo questionário que o cliente vê pelo link. Na visita, complete aqui. Planilha: colunas <b>de</b>, <b>para</b> e <b>data/hora</b> (ou <b>quantidade</b>), exportada do sistema do cliente.</p>
        </section><div id="estudosPesquisa"></div>`;
    }
    function htmlPlanta() {
        const pl = atual.planta;
        const resumo = pl ? { nos: pl.nos.map(n => ({ id: n.id, tipo: n.tipo, x: n.x, y: n.y, nome: n.nome || pl.estacoes?.find(e => e.id === n.estacao)?.nome || "" })), segmentos: pl.segmentos, semDesenho: pl.estudo?.semDesenho } : null;
        const avisos = atual.estudo?.avisosPlanta || [];
        const vars = atual.estudo?.variantes || [];
        const respMudou = pl && atual.estudo?.gerado && atual.atualizado_em && atual.respondido_em && Date.parse(atual.respondido_em) > Date.parse(atual.estudo.gerado);
        return `<section class="card"><div class="estudo-cab"><h3>Planta de estudo</h3>
            <div class="grupo">${pl ? `<button type="button" class="btn btn-primario" data-es="editor">Abrir no editor</button><button type="button" class="btn" data-es="gerar">Gerar de novo do questionário</button><button type="button" class="btn" data-es="refluxos">Só refazer os fluxos</button>` : `<button type="button" class="btn btn-primario" data-es="gerar">Gerar a planta do questionário</button>`}</div></div>
            <p class="suave">Simplificada: um corredor de mão única em volta dos pontos (curvas nos cantos), um ramal curto de mão dupla até cada estação e os berços. Sem tags e sem acessos detalhados: isso é da implantação. ${pl ? "No editor, ajuste o corredor, junte pontos, mude sentidos; o estudo usa a planta como estiver." : ""}</p>
            ${respMudou ? `<div class="missao-dica ambar">O cliente mexeu no questionário depois que a planta foi gerada. Gere de novo (ou só refaça os fluxos, se a planta foi editada).</div>` : ""}
            ${avisos.length ? `<div class="missao-dica ambar">${avisos.map(esc).join("<br>")}</div>` : ""}
            ${resumo ? RelatorioEstudo.svgPlanta(resumo) : `<div class="empty-state">Com os pontos e os fluxos do questionário, a planta sai sozinha.</div>`}
        </section>
        ${pl ? `<section class="card"><div class="estudo-cab"><h3>Variantes de layout</h3><button type="button" class="btn" data-es="variante" ${vars.length >= 4 ? "disabled" : ""}>+ Variante</button></div>
            <p class="suave">Outro corredor, uma estação a mais, um sentido diferente: cada variante é simulada como uma ação e entra no ranking do relatório (até 4).</p>
            ${vars.length ? tabela(["Variante", "Custo da obra", "O que muda", ""], vars.map((v, i) => [esc(v.nome), v.custo ? RelatorioEstudo.brl(v.custo) : "--", esc(v.descricao || ""),
                `<button type="button" class="btn btn-mini" data-es-variante="${i}">Editar</button> <button type="button" class="btn-remover-fila" data-es-tirar-variante="${i}" aria-label="Tirar ${esc(v.nome)}">×</button>`])) : ""}</section>` : ""}`;
    }
    function htmlFluxos() {
        const fl = atual.estudo?.fluxos || [];
        if (!fl.length) return `<div class="empty-state">Os fluxos saem do questionário quando a planta é gerada (aba Planta).</div>`;
        const pl = atual.planta;
        const pontos = (pl?.nos || []).filter(n => ["ESTACAO", "ESPERA", "BERCO"].includes(n.tipo)).map(n => [n.id, n.nome || pl.estacoes?.find(e => e.id === n.estacao)?.nome || n.id]);
        const sel = (lista_, v, attr) => `<select ${attr}>${lista_.map(([k, t]) => `<option value="${esc(k)}" ${k === v ? "selected" : ""}>${esc(t)}</option>`).join("")}</select>`;
        const pr = Object.assign({}, Estudo.PREMISSAS_PADRAO, { rodadas: 6 }, atual.estudo.premissas || {});
        const op = atual.estudo.opcoes || {};
        const tp = N().precos(precosTabela);
        const pn = atual.estudo.premissasNegocio || {};
        const tpPrem = k => (Array.isArray(tp.premissas?.[k]) ? tp.premissas[k] : N().PREMISSAS[k]);
        const PN = [["manuseioS", "Pegar ou entregar à mão, por ponta (s)"], ["velocidadePe", "Velocidade a pé com carga (m/s)"], ["pfd", "Pausas, fadiga e esperas"], ["faltas", "Faltas e afastamentos"], ["coberturaFrota", "Parte do transporte que a frota assume"], ["disponibilidadeAtta", "Disponibilidade do Atta"]];
        const P = [["prazoAlvo", "Entregas no prazo (meta)", "%"], ["ocupacaoMax", "Ocupação máxima de cada Atta", "%"], ["variacao", "Variação de um dia para outro", "%"], ["picoInicio", "Pico no começo do turno", "%"], ["picoVolta", "Pico na volta do intervalo", "%"], ["preparo", "Pré-abastecimento (parte do pico que sai antes)", "%"], ["rodadas", "Dias simulados por frota", ""]];
        const ORIG = { "questionário": "cliente", "diário": "diario", "planilha": "planilha", "Mira Pro": "estimado", "modelo do setor": "premissa" };
        return `<section class="card"><h3>Fluxos da simulação</h3>
            ${tabela(["", "Fluxo", "De", "Para", "Atta", "Viagens/h", "Prazo", "Origem"], fl.map((f, i) => [
                `<input type="checkbox" data-es-fluxo="${i}" data-c="ativo" ${f.ativo !== false ? "checked" : ""} aria-label="Usar ${esc(f.nome)}">`, `<b>${esc(f.nome)}</b>${f.entrega && f.entrega !== "chamada" ? `<small class="suave estudo-origem">${esc(Estudo.ENTREGAS[f.entrega] || f.entrega)}${f.paradas?.length ? ` · ${f.paradas.length + 1} paradas` : ""}</small>` : ""}`,
                sel(pontos, f.de, `data-es-fluxo="${i}" data-c="de" aria-label="De"`), sel(pontos, f.para, `data-es-fluxo="${i}" data-c="para" aria-label="Para"`),
                sel(MODELOS.map(([k, t]) => [k, t.split(" (")[0]]), (f.modelos || [])[0], `data-es-fluxo="${i}" data-c="modelo" aria-label="Modelo"`),
                f.demanda?.tipo === "porHora" ? `<input type="number" min="0" step="0.5" class="estudo-num" data-es-fluxo="${i}" data-c="porHora" value="${f.demanda.porHora}" aria-label="Viagens por hora">`
                    : f.demanda?.tipo === "ciclo" ? `a cada <input type="number" min="5" step="1" class="estudo-num" data-es-fluxo="${i}" data-c="ciclo" value="${f.demanda.cicloMin}" aria-label="Ciclo da rota"> min` : `${(f.demanda?.horarios || []).length} horários`,
                `<input type="number" min="1" step="1" class="estudo-num" data-es-fluxo="${i}" data-c="prazoMin" value="${f.prazoMin}" aria-label="Prazo"> min`,
                `<span class="rv-tag rv-o-${ORIG[f.origem] || "cliente"}">${esc(f.origem || "questionário")}</span>`]))}
            <p class="suave">Mudar aqui vale para a simulação; o questionário do cliente fica como ele respondeu. "Gerar de novo" (aba Planta) refaz os fluxos a partir do questionário.</p></section>
        <section class="card estudo-duas">
            <div><h3>Metas e variação</h3><div class="estudo-premissas">${P.map(([k, rot, un]) => `<label class="campo"><span>${rot}</span><span class="estudo-un"><input type="number" step="1" min="0" data-es-premissa="${k}" value="${un === "%" ? Math.round(pr[k] * 100) : pr[k]}">${un ? `<i>${un}</i>` : ""}</span></label>`).join("")}</div></div>
            <div><h3>A proposta</h3>
                <label class="campo"><span>Plano do Eciton</span><select data-es-opcao="plano">${[["", `o padrão (${tp.planos.find(x => x.id === tp.planoPadrao)?.nome || ""})`], ...tp.planos.map(x => [x.id, `${x.nome} · ${x.fixoMes ? RelatorioEstudo.brl(x.fixoMes, false) + " + " : ""}${RelatorioEstudo.brl(x.porAttaMes, false)} por Atta`])].map(([k, t]) => `<option value="${esc(k)}" ${(op.plano || "") === k ? "selected" : ""}>${esc(t)}</option>`).join("")}</select></label>
                ${op.plano && !tp.planos.some(x => x.id === op.plano) ? `<p class="missao-dica ambar">O plano escolhido antes não está mais na tabela: o estudo usa o padrão.</p>` : ""}
                <p class="suave">Preços e planos: Estudos › Tabela da E4M.</p></div>
        </section>
        <section class="card"><h3>Premissas deste estudo <small class="suave">só se a visita mostrou algo diferente da tabela da E4M</small></h3>
            <div class="estudo-premissas">${PN.map(([k, rot]) => { const f = tpPrem(k), o = pn[k], pc = PCT_PREM.has(k); const mo = x => (x == null ? "" : pc ? Math.round(x * 10000) / 100 : x);
                return `<label class="campo"><span>${esc(rot)}</span><span class="estudo-un"><input type="text" inputmode="decimal" data-es-pn="${k}" value="${esc(mo(o?.[0]))}" placeholder="${esc(mo(f[0]))}">${pc ? "<i>%</i>" : ""}</span></label>`; }).join("")}</div>
            <p class="suave">Em branco: o valor da tabela. O tempo de cada entrega que o cliente informou (ou o diário) vale mais do que estas premissas.</p></section>
        <div class="estudo-rodar"><button type="button" class="btn btn-primario btn-grande" data-es="rodar">Rodar o estudo completo</button><span class="suave">Simula a frota, cada ação, os 3 anos e faz as contas: de alguns segundos a um minuto.</span></div>`;
    }
    function htmlResultado() {
        if (rodando) return `<section class="card estudo-rodando"><h3>Rodando o estudo…</h3><progress id="estudosProgresso" max="1" value="${rodando.p}"></progress><span id="estudosProgressoTexto">${Math.round(rodando.p * 100)}% · ${esc(rodando.msg || "")}</span></section>`;
        const R = atual.resultado;
        if (!R) return `<div class="empty-state">Rode o estudo na aba Fluxos.</div><div class="estudo-rodar"><button type="button" class="btn btn-primario btn-grande" data-es="rodar" ${(atual.estudo?.fluxos || []).length ? "" : "disabled"}>Rodar o estudo completo</button></div>`;
        const temPro = window.Mira && Mira.temPro && Mira.temPro();
        const eq = R.financeiro?.equilibrio;
        const brl = RelatorioEstudo.brl;
        return `${R.desatualizado ? `<div class="missao-dica ambar">O estudo mudou depois deste resultado. Rode de novo antes de mandar.</div>` : ""}
        <section class="card"><div class="grupo">
            <button type="button" class="btn btn-primario" data-es="pdf">${ui.icone("pdf", "icone-p")}PDF</button>
            <button type="button" class="btn" data-es-link="relatorio">Link do relatório</button>
            ${temPro ? `<button type="button" class="btn" data-es="resumoMira">${R.resumoMira ? "Refazer o resumo com a Mira Pro" : "Resumo com a Mira Pro"}</button>` : ""}
            <button type="button" class="btn" data-es="rodar">Rodar de novo</button></div>
            ${eq ? `<p class="suave estudo-equilibrio"><b>Só para a E4M:</b> cada Atta custa ${brl(eq.custoAttaAno)} por ano (compra em 5 anos, implantação, plano e manutenção), ${ui.numero(eq.custoAttaAno / Math.max(1, eq.pessoaAno), 1)} vez(es) o custo de uma pessoa (${brl(eq.pessoaAno / 12, false)} por mês). Payback de ${eq.alvo} meses no cenário provável: ${eq.fatorPreco != null ? `com o Atta a ${Math.round(eq.fatorPreco * 100)}% da tabela (≈ ${brl(eq.precoMedio)} em média)` : "nem com o Atta de graça"}${eq.fatorAssinatura != null ? `, ou com o plano a ${brl(eq.assinatura, false)} por mês para a frota (hoje ${brl(eq.assinaturaHoje, false)})` : ""}.</p>` : ""}
            ${(R.planos || []).length > 1 ? `<div class="estudo-equilibrio"><b class="suave">Só para a E4M: este estudo em cada plano da tabela</b>${tabela(["Plano", "Mira", "Por mês (esta frota)", "Payback provável", "Payback conservador", "VPL em 5 anos"], R.planos.map(p => [`${p.escolhido ? "<b>" : ""}${esc(p.nome)}${p.escolhido ? "</b> <small class=\"suave\">(no relatório)</small>" : ""}`, esc(N().MIRA_PLANO[p.mira] || ""), brl(p.mensal, false), esc(RelatorioEstudo.meses(p.paybackProvavel)), esc(RelatorioEstudo.meses(p.paybackConservador)), brl(p.vpl5)]))}</div>` : ""}
        </section>
        ${htmlCenariosE4M(R)}
        <div class="estudos-relatorio">${RelatorioEstudo.html(R, { paraCliente: false })}</div>`;
    }
    // 0.24: a E4M marca na visita se cada cenário da planta é viável; "usar no estudo" muda os fluxos (e a planta) e pede rodar de novo
    function htmlCenariosE4M(R) {
        const CP = (R.cenariosPlanta || []).filter(c => c.id !== "atual");
        if (!CP.length) return "";
        const v = atual.estudo.viabilidade || {};
        const OPC = [["confirmar", "a confirmar na visita"], ["sim", "viável"], ["nao", "não dá"]];
        return `<section class="card"><h3>Cenários da planta <small class="suave">só para a E4M: depois da visita, marque o que dá para fazer</small></h3>
            ${tabela(["Cenário", "Frota", "Payback (hoje)", "Viável?", "Por quê", ""], CP.map(c => [`<b>${esc(c.nome)}</b>`, c.fecha === false ? "não fecha" : esc(c.frota), c.fecha === false ? "—" : esc(RelatorioEstudo.meses(c.payback)),
                `<select data-es-viavel="${esc(c.id)}" aria-label="Viável?">${OPC.map(([k, t]) => `<option value="${k}" ${(v[c.id]?.v || "confirmar") === k ? "selected" : ""}>${t}</option>`).join("")}</select>`,
                `<input type="text" maxlength="120" data-es-viavel-motivo="${esc(c.id)}" value="${esc(v[c.id]?.motivo || "")}" placeholder="ex.: a linha 2 não cabe rack" aria-label="Por quê">`,
                c.fecha === false ? "" : `<button type="button" class="btn btn-mini" data-es-usar-cenario="${esc(c.id)}">Usar no estudo</button>`]))}
            <p class="suave">O relatório mostra a marcação na hora, sem rodar de novo. "Usar no estudo" muda os fluxos${CP.some(c => c.tipo === "milkrun") ? " (no milk run, o questionário e a planta)" : ""} para o cenário; depois rode o estudo.</p></section>`;
    }
    async function usarCenario(id) {
        const R = atual.resultado;
        const c = (R?.cenariosPlanta || []).find(x => x.id === id);
        if (!c) return;
        if (!await ui.confirmar({ titulo: `Usar "${c.nome}" no estudo?`, texto: c.tipo === "milkrun" ? "O questionário ganha a rota de milk run no lugar dos fluxos dela e a planta de estudo é gerada de novo (o que foi mudado no editor se perde)." : c.tipo === "mista" ? "Os fluxos desse módulo ficam fora da simulação (continuam com as pessoas)." : "Os fluxos passam para o módulo novo e as estações deles aceitam esse módulo.", confirmar: "Usar" })) return;
        const m = N().aplicarCenario({ fluxos: atual.estudo.fluxos, missoes: atual.estudo.missoes, planta: atual.planta, respostas: atual.respostas }, c);
        if (!m) { ui.aviso("Este cenário não dá para aplicar sozinho: mude os fluxos na aba Fluxos.", "aviso"); return; }
        if (m.respostas) { atual.respostas = m.respostas; marcar("respostas"); if (!gerarDoQuestionario(false)) return; }
        else { atual.estudo.fluxos = m.fluxos; if (m.planta) { atual.planta = m.planta; marcar("planta"); } marcar("estudo"); }
        aba = "fluxos"; desenhar();
        ui.aviso(`Cenário aplicado: ${c.nome}. Rode o estudo de novo.`, "sucesso");
    }

    function desenhar() {
        const caixa = document.getElementById("estudosConteudo");
        if (!caixa || !document.getElementById("estudos")?.classList.contains("ativa")) return;
        if (!pode()) { caixa.innerHTML = `<div class="empty-state">Os estudos de frota são da E4M.</div>`; return; }
        if (!carregado) { caixa.innerHTML = `<div class="empty-state">Carregando…</div>`; return; }
        if (!atual && tabelaRasc) { caixa.innerHTML = htmlTabela(); return; }
        if (!atual) { caixa.innerHTML = htmlLista(); return; }
        const corpo = { cliente: htmlCliente, pesquisa: htmlPesquisa, planta: htmlPlanta, fluxos: htmlFluxos, resultado: htmlResultado, proposta: htmlProposta }[aba]();
        caixa.innerHTML = htmlTopo() + corpo;
        if (aba === "pesquisa") {
            const alvo = document.getElementById("estudosPesquisa");
            // só o formulário que está na tela grava (um antigo, com a gravação atrasada, não passa por cima)
            const vez = ++vezForm;
            form = Pesquisa.criar(alvo, atual.respostas || {}, { aoMudar: resp => { if (vez !== vezForm || aba !== "pesquisa") return; atual.respostas = JSON.parse(JSON.stringify(resp)); marcar("respostas"); }, passo: form?.passo ? form.passo() : 0 });
        } else form = null;
    }

    /* ---------------- eventos ---------------- */
    function ligar() {
        const caixa = document.getElementById("estudosConteudo");
        if (!caixa || caixa.dataset.ligado) return;
        caixa.dataset.ligado = "1";
        caixa.addEventListener("click", async ev => {
            const b = ev.target.closest("button");
            if (!b) return;
            const a = b.dataset.es;
            if (b.dataset.ppPdf) { imprimirProposta(b.dataset.ppPdf); return; }
            if (b.dataset.ppLink) { linkProposta(b.dataset.ppLink); return; }
            if (b.dataset.ppBase) { usarComoBase(b.dataset.ppBase); return; }
            if (b.dataset.ppCancelar) { cancelarProposta(b.dataset.ppCancelar); return; }
            if (b.dataset.ppTirar !== undefined) { const o = rascProposta(); (o.extras || []).splice(Number(b.dataset.ppTirar), 1); marcarProposta(); desenhar(); return; }
            if (a === "emitirProposta") { emitirProposta(null); return; }
            if (a === "revisarProposta") { emitirProposta(ultimaAberta()?.numero || null); return; }
            if (a === "pdfRascunho") { imprimirProposta(null); return; }
            if (b.dataset.tpTirarParcela !== undefined && tabelaRasc) { tabelaRasc.comercial.pagamentoCompra.splice(Number(b.dataset.tpTirarParcela), 1); confirmar("comercial.pagamentoCompra"); tabelaSuja = true; desenhar(); return; }
            if (b.dataset.tpTirar !== undefined && tabelaRasc) {
                const i = Number(b.dataset.tpTirar), p = tabelaRasc.planos[i];
                if (!p || !await ui.confirmar({ titulo: `Tirar o plano ${p.nome}?`, texto: "Os estudos que usam este plano passam para o plano padrão quando rodarem de novo.", confirmar: "Tirar", perigo: true })) return;
                tabelaRasc.planos.splice(i, 1); confirmar("planos");
                if (!tabelaRasc.planos.some(x => x.id === tabelaRasc.planoPadrao)) tabelaRasc.planoPadrao = tabelaRasc.planos[0].id;
                tabelaSuja = true; desenhar(); return;
            }
            if (b.dataset.esAbrir) { aba = "cliente"; await abrirProspect(b.dataset.esAbrir); return; }
            if (b.dataset.esUsarCenario) { usarCenario(b.dataset.esUsarCenario); return; }
            if (b.dataset.esAba) { if (sujos.size) salvarJa(); aba = b.dataset.esAba; desenhar(); return; }
            if (b.dataset.esLink) { criarLink(b.dataset.esLink); return; }
            if (b.dataset.esCopiar) { copiar(b.dataset.esCopiar); return; }
            if (b.dataset.esCancelar) { cancelarLink(b.dataset.esCancelar); return; }
            if (b.dataset.esVariante) { abrirEditor(Number(b.dataset.esVariante)); return; }
            if (b.dataset.esTirarVariante) {
                const i = Number(b.dataset.esTirarVariante);
                if (!await ui.confirmar({ titulo: "Tirar a variante?", texto: atual.estudo.variantes[i]?.nome || "", confirmar: "Tirar", perigo: true })) return;
                atual.estudo.variantes.splice(i, 1); marcar("estudo"); desenhar(); return;
            }
            if (a === "novo") novoProspect();
            else if (a === "precos") abrirTabela();
            else if (a === "salvarTabela") salvarTabela();
            else if (a === "voltarTabela") {
                if (tabelaSuja && !await ui.confirmar({ titulo: "Sair sem salvar?", texto: "As mudanças na tabela da E4M se perdem.", confirmar: "Sair sem salvar", perigo: true })) return;
                tabelaRasc = null; tabelaSuja = false;
                if (voltarPara) { const v = voltarPara; voltarPara = null; aba = v.aba; await abrirProspect(v.id); } else desenhar();
            } else if (a === "fabricaTabela") {
                if (!await ui.confirmar({ titulo: "Voltar aos valores de fábrica?", texto: "Preços, planos, a pessoa de referência e as premissas voltam aos de partida (só ficam valendo se salvar).", confirmar: "Voltar" })) return;
                tabelaRasc = JSON.parse(JSON.stringify(N().precos(null))); tabelaSuja = true; desenhar();
            } else if (a === "planoNovo") {
                let n = tabelaRasc.planos.length + 1, id = "plano" + n;
                while (tabelaRasc.planos.some(p => p.id === id)) id = "plano" + (++n);
                tabelaRasc.planos.push({ id, nome: "Plano novo", inclui: "", mira: "nao", fixoMes: 0, porAttaMes: 0 }); confirmar("planos"); tabelaSuja = true; desenhar();
            } else if (a === "parcelaNova") {
                tabelaRasc.comercial.pagamentoCompra.push({ quando: "", pct: 0 }); confirmar("comercial.pagamentoCompra"); tabelaSuja = true; desenhar();
            }
            else if (a === "voltar") { if (sujos.size) await salvarJa(); atual = null; await carregarLista(); desenhar(); }
            else if (a === "apagar") apagar();
            else if (a === "converter") converter();
            else if (a === "setor") usarSetor();
            else if (a === "diario") usarDiario();
            else if (a === "mira") miraNoQuestionario();
            else if (a === "gerar") {
                if (atual.planta && !await ui.confirmar({ titulo: "Gerar a planta de novo?", texto: "A planta do estudo é refeita a partir do questionário: o que foi mudado no editor se perde (as variantes ficam).", confirmar: "Gerar de novo" })) return;
                if (gerarDoQuestionario(false)) { desenhar(); ui.aviso(`Planta e ${atual.estudo.fluxos.length} fluxo(s) gerados.`, "sucesso"); }
            } else if (a === "refluxos") { if (gerarDoQuestionario(true)) { desenhar(); ui.aviso(`${atual.estudo.fluxos.length} fluxo(s) refeitos do questionário (a planta ficou como está).`, "sucesso"); } }
            else if (a === "editor") abrirEditor(null);
            else if (a === "variante") guardarVariante();
            else if (a === "rodar") rodar();
            else if (a === "pdf") imprimir();
            else if (a === "resumoMira") resumoMira();
        });
        caixa.addEventListener("change", ev => {
            const t = ev.target;
            if (atual && aba === "proposta" && (t.dataset.pp || t.dataset.ppQtd || t.dataset.ppExtra !== undefined || t.dataset.ppContato || t.dataset.ppMostrar)) {
                const o = rascProposta();
                if (t.dataset.ppQtd) o.qtd = Object.assign({}, o.qtd, { [t.dataset.ppQtd]: Math.max(0, Math.round(Number(t.value) || 0)) });
                else if (t.dataset.ppMostrar) o.mostrar = Object.assign({ compra: true, mensalidade: true }, o.mostrar, { [t.dataset.ppMostrar]: t.checked });
                else if (t.dataset.ppContato) o.contato = Object.assign({}, o.contato, { [t.dataset.ppContato]: t.value.trim() });
                else if (t.dataset.ppExtra !== undefined) {
                    const i = Number(t.dataset.ppExtra), c = t.dataset.c;
                    o.extras = (o.extras || []).slice();
                    const x = o.extras[i] = Object.assign({}, o.extras[i] || {});
                    x[c] = c === "descricao" ? t.value.trim() : c === "qtd" ? Math.max(0, Math.round(Number(t.value) || 0)) : (numTxt(t.value) ?? 0);
                    o.extras = o.extras.filter(e => e && (e.descricao || e.qtd || e.unitario));
                } else {
                    const k = t.dataset.pp;
                    if (k === "plano" || k === "observacoes") o[k] = t.value;
                    else if (k === "descontoPct") o.descontoPct = Math.max(0, Math.min(50, Number(t.value) || 0)) / 100;
                    else o[k] = Math.max(0, Math.round(Number(t.value) || 0));
                }
                marcarProposta(); desenhar(); return;
            }
            if (tabelaRasc && !atual && (t.dataset.tp || t.dataset.tpPrem || t.dataset.tpPadrao)) {
                if (t.dataset.tpPadrao) tabelaRasc.planoPadrao = t.dataset.tpPadrao;
                else if (t.dataset.tpPrem) {
                    const k = t.dataset.tpPrem, j = Number(t.dataset.j), f = N().PREMISSAS[k];
                    let v = numTxt(t.value);
                    if (v != null && PCT_PREM.has(k)) v = v / 100;
                    const o = (tabelaRasc.premissas[k] || f.slice(0, 3)).slice(0, 3);
                    o[j] = v == null ? f[j] : v;
                    if (o[0] === f[0] && o[1] === f[1] && o[2] === f[2]) delete tabelaRasc.premissas[k]; else tabelaRasc.premissas[k] = o;
                } else if (t.hasAttribute("data-tp-linhas")) gravarCaminho(tabelaRasc, t.dataset.tp, t.value.split(/\n+/).map(x => x.trim()).filter(Boolean).slice(0, 20));
                else if (t.hasAttribute("data-tp-texto")) gravarCaminho(tabelaRasc, t.dataset.tp, t.value.trim());
                else {
                    const v = numTxt(t.value);
                    if (v == null || v < 0) { ui.aviso("Use um número (zero ou mais).", "aviso"); t.value = t.hasAttribute("data-tp-pct") ? Math.round(lerCaminho(tabelaRasc, t.dataset.tp) * 10000) / 100 : lerCaminho(tabelaRasc, t.dataset.tp); return; }
                    gravarCaminho(tabelaRasc, t.dataset.tp, t.hasAttribute("data-tp-pct") ? v / 100 : v);
                }
                tabelaSuja = true;
                confirmar(t.dataset.tp || (t.dataset.tpPadrao ? "planos" : ""));
                const bt = document.querySelector('[data-es="salvarTabela"]'); if (bt) bt.disabled = false;
                // o total da pessoa de referência, os planos, a soma das parcelas e as marcas de exemplo mudam na hora
                if (/^(pessoa|planos|comercial)\./.test(t.dataset.tp || "") || /^(atta|implantacaoPct|manutencaoPct|moduloIO|locacao|bercoExtra)/.test(t.dataset.tp || "") || t.dataset.tpPadrao) desenhar();
                return;
            }
            if (t.matches("[data-es-planilha]") && t.files?.[0]) { importarPlanilha(t.files[0]); t.value = ""; return; }
            if (t.dataset.esCampo) { atual[t.dataset.esCampo] = t.value; marcar(t.dataset.esCampo); if (t.dataset.esCampo === "nome" || t.dataset.esCampo === "etapa") desenharTopo(); return; }
            if (t.dataset.esContato) { atual.contato = Object.assign({}, atual.contato, { [t.dataset.esContato]: t.value.trim() }); marcar("contato"); return; }
            if (t.dataset.esFluxo !== undefined) {
                const f = atual.estudo.fluxos[Number(t.dataset.esFluxo)], c = t.dataset.c;
                if (!f) return;
                if (c === "ativo") f.ativo = t.checked;
                else if (c === "porHora") f.demanda = { tipo: "porHora", porHora: Math.max(0, Number(t.value) || 0) };
                else if (c === "ciclo") { const cmin = Math.max(5, Math.round(Number(t.value) || 20)); f.demanda = { tipo: "ciclo", cicloMin: cmin }; f.prazoMin = cmin; }
                else if (c === "prazoMin") { f.prazoMin = Math.max(1, Number(t.value) || 15); f.prazoOrigem = "cliente"; }
                else if (c === "modelo") f.modelos = [t.value];
                else if (c === "de" || c === "para") {
                    f[c] = t.value;
                    const m = (atual.estudo.missoes || []).find(x => x.id === f.missao);
                    if (m) m.etapas = Estudo.etapasDaEntrega(f);
                }
                marcar("estudo"); return;
            }
            if (t.dataset.esPremissa) {
                const k = t.dataset.esPremissa, v = Number(t.value);
                atual.estudo.premissas = Object.assign({}, atual.estudo.premissas, { [k]: ["prazoAlvo", "ocupacaoMax", "variacao", "picoInicio", "picoVolta", "preparo"].includes(k) ? Math.max(0, v) / 100 : Math.max(1, Math.min(20, Math.round(v) || 6)) });
                marcar("estudo"); return;
            }
            if (t.dataset.esPn) {
                const k = t.dataset.esPn, pc = PCT_PREM.has(k);
                let v = numTxt(t.value);
                const pn = Object.assign({}, atual.estudo.premissasNegocio);
                if (v == null) delete pn[k];
                else {
                    if (pc) v = v / 100;
                    const tp = N().precos(precosTabela), f = Array.isArray(tp.premissas?.[k]) ? tp.premissas[k] : N().PREMISSAS[k];
                    pn[k] = [v, Math.min(v, f[1]), Math.max(v, f[2])];
                }
                atual.estudo.premissasNegocio = pn; marcar("estudo"); return;
            }
            if (t.dataset.esViavel || t.dataset.esViavelMotivo) {
                const id = t.dataset.esViavel || t.dataset.esViavelMotivo;
                const v = Object.assign({}, atual.estudo.viabilidade);
                v[id] = Object.assign({ v: "confirmar", motivo: "" }, v[id], t.dataset.esViavel ? { v: t.value } : { motivo: t.value.trim().slice(0, 120) });
                atual.estudo.viabilidade = v;
                // vale na hora no relatório (não deixa o resultado "antigo")
                if (atual.resultado) { atual.resultado.viabilidade = v; sujos.add("resultado"); }
                sujos.add("estudo"); clearTimeout(timer); timer = setTimeout(salvarJa, 1200);
                const rel = document.querySelector("#estudosConteudo .estudos-relatorio");
                if (rel && atual.resultado) rel.innerHTML = RelatorioEstudo.html(atual.resultado, { paraCliente: false });
                return;
            }
            if (t.dataset.esOpcao) { atual.estudo.opcoes = Object.assign({}, atual.estudo.opcoes, { [t.dataset.esOpcao]: t.type === "checkbox" ? t.checked : t.value }); marcar("estudo"); }
        });
    }
    function desenharTopo() {
        const topo = document.querySelector("#estudosConteudo .estudos-topo");
        if (topo) { const novo = document.createElement("div"); novo.innerHTML = htmlTopo(); topo.replaceWith(novo.firstElementChild); }
    }

    async function abrir() {
        ligar();
        if (EditorPlanta?.emModoEstudo?.()) EditorPlanta.sairModoEstudo();
        if (!pode()) { desenhar(); return; }
        if (!carregado) { desenhar(); await carregarLista(); }
        desenhar();
    }
    window.addEventListener("beforeunload", ev => { if (sujos.size) { salvarJa(); ev.preventDefault(); ev.returnValue = ""; } });
    return { abrir, desenhar, _estado: () => ({ lista, atual, aba, sujos: [...sujos] }), salvarJa };
})();
if (typeof window !== "undefined") window.EstudosTela = EstudosTela;
