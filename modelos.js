/* ============================================================
   MODELOS — catálogo de modelos do Atta e ficha técnica
   ============================================================
   O fornecedor cadastra cada modelo (Atta G-O, ...) com o que importa
   para a operação: medidas, velocidades, carga, como pega a carga
   (indexação), guiamento e sensores. Cada AGV da frota é de um modelo:
   o despacho sabe quais estações cada modelo atende e o mapa desenha
   cada módulo de um jeito.

   Na nuvem: tabela modelos (o cliente só vê os liberados para a
   empresa dele), modelos_empresas (liberação) e o link da documentação
   pela função documentacao_modelo (administrador e manutenção).
   Sem nuvem: fica neste navegador (localStorage "modelosFrota").
*/
const Modelos = (function () {
    "use strict";

    const MODULOS = {
        E: ["Elevação", "entra embaixo do carrinho, levanta e leva"],
        G: ["Garra", "pega e solta caixas e kits (garra feita para a carga)"],
        R: ["Roletes", "recebe e entrega na esteira, pelos rolos"],
        T: ["Rebocador", "puxa carrinhos engatados em comboio"]
    };
    const GUIAMENTOS = { O: "Óptico (fita no chão)", M: "Magnético (fita magnética)", L: "LiDAR (sem fita)" };
    const GRUPOS = [
        ["dimensoes", "Dimensões e espaço"], ["movimento", "Movimento"], ["tracao", "Tração"],
        ["carga", "Carga e indexação"], ["manobra", "Com carga (manobra)"], ["guiamento", "Guiamento e sensores"], ["energia", "Energia e piso"],
        ["geral", "Situação"]
    ];
    // Campos da ficha: só o que interessa à operação (tráfego, despacho, layout)
    const CAMPOS = [
        ["dimensoes", "comprimento_mm", "Comprimento", "mm"],
        ["dimensoes", "largura_mm", "Largura", "mm"],
        ["dimensoes", "altura_mm", "Altura", "mm"],
        ["dimensoes", "giro_diametro_mm", "Diâmetro para girar no lugar", "mm"],
        ["dimensoes", "corredor_min_mm", "Corredor mínimo", "mm"],
        ["dimensoes", "massa_kg", "Massa vazio", "kg"],
        ["movimento", "vel_max_ms", "Velocidade máxima", "m/s"],
        ["movimento", "vel_cruzeiro_ms", "Velocidade em corredor só da frota", "m/s"],
        ["movimento", "vel_pessoas_ms", "Velocidade perto de pessoas", "m/s"],
        ["movimento", "vel_lateral_ms", "Velocidade de lado", "m/s"],
        ["movimento", "aceleracao_ms2", "Aceleração", "m/s²"],
        ["movimento", "parada_mm", "Distância de parada (máx., com carga)", "mm"],
        ["movimento", "rampa_max_pct", "Rampa máxima", "%"],
        ["tracao", "motor", "Motores", ""],
        ["tracao", "torque_nm", "Torque por motor", "N·m"],
        ["tracao", "raio_roda_m", "Raio da roda", "m"],
        ["tracao", "rodas", "Rodas", ""],
        ["carga", "carga_kg", "Carga máxima", "kg"],
        ["carga", "carga_tipica", "Carga típica", ""],
        ["carga", "indexacao", "Indexação (como pega a carga)", ""],
        ["carga", "garra_curso_mm", "Curso", "mm"],
        ["carga", "garra_altura_min_mm", "Altura mínima", "mm"],
        ["carga", "garra_altura_max_mm", "Altura máxima", "mm"],
        ["carga", "garra_tempo_s", "Tempo para pegar / soltar", "s"],
        ["carga", "garra_orientacao", "Orientação da carga", ""],
        ["carga", "garra_lados", "Lados de acesso", ""],
        ["carga", "torque_elevacao_nm", "Torque da elevação", "N·m"],
        ["carga", "fuso", "Fuso", ""],
        // 0.16: o que muda quando ele está com carga (a planta e o despacho usam)
        ["manobra", "comprimento_carregado_mm", "Comprimento com carga", "mm"],
        ["manobra", "largura_carregado_mm", "Largura com carga", "mm"],
        ["manobra", "gira_carregado", "Gira no lugar com carga", "sim/não"],
        ["manobra", "lateral_carregado", "Anda de lado com carga", "sim/não"],
        ["manobra", "raio_min_carregado_m", "Raio mínimo de curva com carga", "m"],
        ["manobra", "comboio_m", "Comprimento do comboio (atrás do Atta)", "m"],
        ["guiamento", "guiamento", "Como se guia", ""],
        ["guiamento", "precisao_parada_mm", "Precisão de parada", "± mm"],
        ["guiamento", "sensores", "Sensores", ""],
        ["guiamento", "cobertura", "Cobertura dos sensores", ""],
        ["energia", "energia", "Bateria", ""],
        ["energia", "autonomia_h", "Autonomia", "h"],
        ["energia", "recarga", "Recarga", ""],
        ["energia", "piso", "Piso", ""],
        ["energia", "desnivel_max_mm", "Desnível máximo", "mm"],
        ["geral", "situacao", "Situação", ""]
    ].map(([grupo, chave, rotulo, unidade]) => ({ grupo, chave, rotulo, unidade }));

    // Fotos que vêm com o site (o fornecedor pode trocar)
    const FOTOS = { "atta-e-o": "img/modelos/atta-e-o.webp", "atta-e-o-serie": "img/modelos/atta-e-o.webp" };
    // 0.16: o protótipo ergue o carrinho por baixo, então é um Atta E (era "Atta G-O";
    // "atta-g-o" agora é a família de garras). Na nuvem o banco renomeia; aqui, o script.js.

    // 0.20: valores de produção por módulo (os do site de vendas). vel_max = o topo da faixa
    // típica; em corredor só da frota anda a 1,2 m/s; perto de pessoas, a 0,8 m/s (zona lenta).
    const PRODUCAO = {
        E: { vel_max_ms: 1.5, carga_kg: 1000, carga_tipica: "300 a 1.000 kg" },
        G: { vel_max_ms: 1.5, carga_kg: 250, carga_tipica: "50 a 250 kg" },
        R: { vel_max_ms: 1.2, carga_kg: 1000, carga_tipica: "100 a 1.000 kg" },
        T: { vel_max_ms: 2.0, carga_kg: 3000, carga_tipica: "500 a 3.000 kg rebocados (vazio 1 a 2 m/s, menos com comboio)" }
    };
    const VEL_FROTA = 1.2, VEL_PESSOAS = 0.8, ACEL_PRODUCAO = 0.4, VEL_LATERAL_PRODUCAO = 0.3;
    function VALORES_PRODUCAO(modulo, extra) {
        const p = PRODUCAO[modulo];
        return Object.assign({ vel_max_ms: p.vel_max_ms, vel_cruzeiro_ms: Math.min(VEL_FROTA, p.vel_max_ms), vel_pessoas_ms: VEL_PESSOAS,
            vel_lateral_ms: "a definir", aceleracao_ms2: ACEL_PRODUCAO, carga_kg: p.carga_kg, carga_tipica: p.carga_tipica }, extra || {});
    }
    // Os parâmetros do firmware que fazem o Atta virtual andar como o de produção
    function PARAMETROS_PRODUCAO(modulo) {
        const v = PRODUCAO[modulo].vel_max_ms;
        return { VELOCIDADE_MAXIMA: v, FRACAO_CRUZEIRO: Math.round(Math.min(VEL_FROTA, v) / v * 100) / 100,
            FRACAO_APROXIMACAO: 0.3, ACELERACAO_LINEAR: ACEL_PRODUCAO, VELOCIDADE_LATERAL: VEL_LATERAL_PRODUCAO };
    }

    // O protótipo e os modelos de referência dos outros módulos (o mesmo do 01_esquema.sql)
    const PADRAO = [{
        // 0.20: o código "atta-e-o" continua sendo o protótipo (as plantas, os postos e
        // os AGVs que já usam esse código não mudam); o de produção é o "atta-e-o-serie".
        id: "atta-e-o", nome: "Atta E-O protótipo", modulo: "E", guiamento: "O", ativo: true,
        descricao: "Protótipo funcional (TCC): entra embaixo do carrinho e ergue por um fuso, guiado por fita óptica no chão. Até 0,10 m/s e 10 kg.",
        ficha: {
            comprimento_mm: "a medir", largura_mm: "a medir", altura_mm: "a medir", giro_diametro_mm: "a medir",
            corredor_min_mm: "a medir", massa_kg: 5, vel_max_ms: 0.10, vel_lateral_ms: 0.03, aceleracao_ms2: 0.20,
            parada_mm: "a medir", rampa_max_pct: 0, motor: "4 × NEMA 17 (passo)", torque_nm: 0.52, raio_roda_m: 0.036,
            rodas: "4 mecanum", carga_kg: 10, indexacao: "Elevação por baixo do carrinho (fuso TR8x8)",
            garra_curso_mm: "a medir", garra_altura_min_mm: "a medir", garra_altura_max_mm: "a medir",
            garra_tempo_s: "a medir", garra_orientacao: "Frente do AGV", garra_lados: "Entra por baixo, pela frente",
            torque_elevacao_nm: 0.52, fuso: "TR8x8 (avanço 8 mm)",
            comprimento_carregado_mm: "tamanho do carrinho", gira_carregado: "sim", lateral_carregado: "sim",
            guiamento: "Fita óptica no chão (QTR-8A) e tags RFID nos pontos",
            precisao_parada_mm: "a medir", sensores: "QTR-8A (linha), 2 × VL53L0X (frente), leitor RFID",
            cobertura: "Frente, até ~1,2 m", energia: "a definir", autonomia_h: "a medir", recarga: "a definir",
            piso: "Liso e plano, fita contrastante", desnivel_max_mm: "a medir", situacao: "Pronto para piloto"
        },
        parametros: { RAIO_RODA: 0.036, VELOCIDADE_MAXIMA: 0.10, ACELERACAO_LINEAR: 0.20 },
        foto: "", docUrl: ""
    }, {
        // 0.20: os valores de produção são os do site de vendas (Atta › "Velocidade típica",
        // "Carga típica" e a conta do configurador: 0,8 m/s perto de pessoas, 1,2 m/s em
        // corredor só da frota, 0,4 m/s²). Os que ainda não existem ficam "a definir".
        id: "atta-e-o-serie", nome: "Atta E-O", modulo: "E", guiamento: "O", ativo: true,
        descricao: "Entra embaixo do carrinho e ergue, guiado por fita óptica no chão. Modelo de produção: 0,8 a 1,5 m/s, 300 a 1.000 kg.",
        ficha: VALORES_PRODUCAO("E", { indexacao: "Elevação por baixo do carrinho", comprimento_carregado_mm: "tamanho do carrinho",
            gira_carregado: "sim", lateral_carregado: "sim", rodas: "4 mecanum", guiamento: "Fita óptica no chão e tags RFID nos pontos", situacao: "Em desenvolvimento" }),
        parametros: PARAMETROS_PRODUCAO("E"), foto: "", docUrl: ""
    }, {
        id: "atta-g-o", nome: "Atta G-O", modulo: "G", guiamento: "O", ativo: true,
        descricao: "Família de garras feitas para cada carga (caixa, KLT, kit). Pega e solta sozinho na estação.",
        ficha: VALORES_PRODUCAO("G", { indexacao: "Garra sob medida para a carga", gira_carregado: "sim", lateral_carregado: "sim", rodas: "4 mecanum",
            guiamento: "Fita óptica no chão e tags RFID nos pontos", situacao: "Sob encomenda" }),
        parametros: PARAMETROS_PRODUCAO("G"), foto: "", docUrl: ""
    }, {
        id: "atta-r-o", nome: "Atta R-O", modulo: "R", guiamento: "O", ativo: true,
        descricao: "Rolos no topo: encosta na esteira e transfere a carga pelos rolos.",
        ficha: VALORES_PRODUCAO("R", { indexacao: "Rolos motorizados, troca com a esteira", gira_carregado: "sim", lateral_carregado: "sim", rodas: "4 mecanum",
            precisao_parada_mm: 10, guiamento: "Fita óptica no chão e tags RFID nos pontos", situacao: "Sob encomenda" }),
        parametros: PARAMETROS_PRODUCAO("R"), foto: "", docUrl: ""
    }, {
        id: "atta-t-o", nome: "Atta T-O", modulo: "T", guiamento: "O", ativo: true,
        descricao: "Rebocador: engata carrinhos em comboio e faz o milk-run pelos ramais.",
        ficha: VALORES_PRODUCAO("T", { indexacao: "Engate traseiro para comboio", gira_carregado: "não", lateral_carregado: "não", raio_min_carregado_m: 1.5,
            comboio_m: 6, rodas: "4 mecanum", guiamento: "Fita óptica no chão e tags RFID nos pontos", situacao: "Em desenvolvimento" }),
        parametros: PARAMETROS_PRODUCAO("T"), foto: "", docUrl: ""
    }];

    let lista = [];
    let liberados = null;         // fornecedor na nuvem: ids liberados para a empresa aberta
    let selecionado = null;
    let editando = null;          // cópia em edição
    let carregado = false;
    const esc = t => String(t ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    const naNuvem = () => Boolean(window.Nuvem && Nuvem.emNuvem());
    const fornecedor = () => naNuvem() && Nuvem.papel() === "fornecedor";
    const podeEditar = () => !naNuvem() || fornecedor();
    const podeVerDoc = () => !naNuvem() || ["fornecedor", "admin", "manutencao"].includes(Nuvem.papel());

    function normalizar(m) {
        return {
            id: String(m.id || ""), nome: String(m.nome || m.id || ""), modulo: MODULOS[m.modulo] ? m.modulo : "G",
            guiamento: GUIAMENTOS[m.guiamento] ? m.guiamento : "O", descricao: String(m.descricao || ""),
            ficha: m.ficha && typeof m.ficha === "object" ? m.ficha : {},
            parametros: m.parametros && typeof m.parametros === "object" ? m.parametros : {},
            foto: String(m.foto || ""), ativo: m.ativo !== false, docUrl: String(m.docUrl || "")
        };
    }

    function lerLocal() {
        try {
            const d = JSON.parse(localStorage.getItem("modelosFrota") || "null");
            if (Array.isArray(d) && d.length) {
                // 0.16: o protótipo gravado como "atta-g-o" (garra) vira o Atta E-O; os de referência entram
                const lidos = d.map(normalizar).map(m => m.id === "atta-g-o" && /ergue o carrinho/.test(m.descricao)
                    ? Object.assign(normalizar(PADRAO[0]), { ficha: Object.assign({}, m.ficha, PADRAO[0].ficha, { indexacao: PADRAO[0].ficha.indexacao }), docUrl: m.docUrl, foto: m.foto })
                    : m);
                PADRAO.forEach(p => { if (!lidos.some(m => m.id === p.id)) lidos.push(normalizar(p)); });
                try { localStorage.setItem("modelos016", "1"); } catch (e) { /* ignora */ }
                return lidos;
            }
        } catch (e) { /* ignora */ }
        try { localStorage.setItem("modelos016", "1"); } catch (e) { /* ignora */ }
        return PADRAO.map(normalizar);
    }
    function gravarLocal() {
        try { localStorage.setItem("modelosFrota", JSON.stringify(lista)); } catch (e) { /* sem espaço */ }
    }

    async function carregar() {
        if (!naNuvem()) {
            lista = lerLocal();
            carregado = true;
            avisar();
            return lista;
        }
        const c = Nuvem.cliente();
        try {
            const r = await c.from("modelos").select("id, nome, modulo, guiamento, descricao, ficha, parametros, foto, ativo").order("nome");
            if (r.error) throw r.error;
            lista = r.data.map(normalizar);
            if (fornecedor()) {
                const l = await c.from("modelos_empresas").select("modelo_id").eq("empresa_id", Nuvem.empresa().id);
                liberados = new Set((l.data || []).map(x => x.modelo_id));
            }
        } catch (erro) {
            // banco ainda sem a 0.14: o catálogo padrão, só para ver
            console.warn("Modelos indisponíveis na nuvem:", erro?.message || erro);
            lista = PADRAO.map(normalizar);
            liberados = null;
        }
        carregado = true;
        avisar();
        return lista;
    }

    function avisar() {
        document.dispatchEvent(new CustomEvent("modelosmudaram"));
        if (document.getElementById("modelos")?.classList.contains("ativa")) desenhar();
    }

    /* ---------------- leitura pelo resto do site ---------------- */

    // Na tela de cadastro do AGV: os que a empresa pode usar
    function disponiveis() {
        if (fornecedor() && liberados) return lista.filter(m => m.ativo);
        return lista.filter(m => m.ativo);
    }
    const porId = id => lista.find(m => m.id === id) || null;
    const doAgv = agv => (agv && agv.modelo ? porId(agv.modelo) : null);
    const modulo = agv => doAgv(agv)?.modulo || null;
    const nome = id => porId(id)?.nome || id || "";
    const foto = m => (m ? m.foto || FOTOS[m.id] || "" : "");
    const nomeModulo = cod => MODULOS[cod]?.[0] || cod || "";

    // 0.20: as velocidades que o Atta usa de verdade (m/s), para as estimativas do despacho,
    // da programação e do estudo de frota. Ordem: os parâmetros que o AGV informou
    // (status/configuracao) > os do modelo > os do firmware do protótipo.
    const PADRAO_FIRMWARE = { VELOCIDADE_MAXIMA: 0.10, FRACAO_CRUZEIRO: 0.6, FRACAO_APROXIMACAO: 0.35, ACELERACAO_LINEAR: 0.20, VELOCIDADE_LATERAL: 0.03 };
    function velocidades(m, agv) {
        const de = chave => {
            const a = Number(agv?.parametros?.[chave]), b = Number(m?.parametros?.[chave]);
            return Number.isFinite(a) && a > 0 ? a : Number.isFinite(b) && b > 0 ? b : PADRAO_FIRMWARE[chave];
        };
        const maxima = de("VELOCIDADE_MAXIMA");
        return { maxima, cruzeiro: maxima * de("FRACAO_CRUZEIRO"), aproximacao: maxima * de("FRACAO_APROXIMACAO"),
            aceleracao: de("ACELERACAO_LINEAR"), lateral: de("VELOCIDADE_LATERAL") };
    }

    // Perfil de rota do modelo (0.16), vazio e carregado, para a planta e o despacho.
    // Sem ficha preenchida: o padrão do módulo (T carregado: sem giro, sem lado, raio 1,5 m, comboio 6 m).
    function perfil(agvOuModelo) {
        const m = agvOuModelo && agvOuModelo.modulo && agvOuModelo.ficha ? agvOuModelo : doAgv(agvOuModelo);
        if (!m) return null;
        const f = m.ficha || {};
        const num = (v, padrao) => { const n = Number(String(v ?? "").replace(",", ".")); return Number.isFinite(n) && String(v ?? "").trim() !== "" ? n : padrao; };
        const simNao = (v, padrao) => { const t = String(v ?? "").trim().toLowerCase(); return t.startsWith("s") ? true : t.startsWith("n") ? false : padrao; };
        const reboque = m.modulo === "T";
        const comprimento = num(f.comprimento_mm, null);
        const frente = comprimento ? comprimento / 2000 : 0.2;
        const base = { modulo: m.modulo, guia: m.guiamento, frente, nome: m.nome, gira: true, lateral: true, raioMinimo: 0, comboio: 0,
            velocidade: velocidades(m, agvOuModelo && agvOuModelo !== m ? agvOuModelo : null) };
        const comCarga = Object.assign({}, base, {
            gira: simNao(f.gira_carregado, !reboque),
            lateral: simNao(f.lateral_carregado, !reboque),
            raioMinimo: num(f.raio_min_carregado_m, reboque ? 1.5 : 0),
            comboio: num(f.comboio_m, reboque ? 6 : 0)
        });
        const cc = num(f.comprimento_carregado_mm, null);
        if (cc) comCarga.frente = Math.max(frente, cc / 2000);
        return { vazio: base, carregado: comCarga };
    }

    function valorFicha(m, chave) {
        const v = m?.ficha?.[chave];
        if (v === undefined || v === null || v === "") return "";
        return typeof v === "number" ? String(v).replace(".", ",") : String(v);
    }
    // Uma linha curta: "Garra · óptico · 10 kg · 0,10 m/s"
    function resumo(m) {
        if (!m) return "";
        const partes = [nomeModulo(m.modulo), (GUIAMENTOS[m.guiamento] || "").split(" ")[0].toLowerCase()];
        const carga = valorFicha(m, "carga_kg"), vel = valorFicha(m, "vel_max_ms");
        if (carga && carga !== "a medir") partes.push(`${carga} kg`);
        if (vel && vel !== "a medir") partes.push(`${vel} m/s`);
        return partes.filter(Boolean).join(" · ");
    }

    function opcoesHtml(atual, comVazio = true) {
        const ops = disponiveis();
        const extra = atual && !ops.some(m => m.id === atual) ? [{ id: atual, nome: `${atual} (fora do catálogo)` }] : [];
        return (comVazio ? `<option value="">Sem modelo</option>` : "") +
            ops.concat(extra).map(m => `<option value="${esc(m.id)}" ${m.id === atual ? "selected" : ""}>${esc(m.nome)}</option>`).join("");
    }

    // Cartão do modelo no cadastro do AGV: foto, o que ele é e os números que a operação usa
    function cartaoCadastroHtml(m) {
        if (!m) return "";
        const f = foto(m);
        const v = (chave, unidade) => { const x = valorFicha(m, chave); return !x ? "—" : x === "a medir" ? `<i>a medir</i>` : esc(x) + (unidade ? ` ${unidade}` : ""); };
        const dim = ["comprimento_mm", "largura_mm", "altura_mm"].map(k => valorFicha(m, k));
        const medidas = dim.every(x => x && x !== "a medir") ? `${dim.join(" × ")} mm` : `<i>a medir</i>`;
        const linhas = [["Carga máxima", v("carga_kg", "kg")], ["Velocidade máxima", v("vel_max_ms", "m/s")], ["Medidas (C × L × A)", medidas],
            ["Corredor mínimo", v("corredor_min_mm", "mm")], ["Como pega a carga", v("indexacao")], ["Precisão de parada", v("precisao_parada_mm", "± mm")]];
        return `<div class="cad-modelo">
            ${f ? `<img class="cad-modelo-foto" src="${esc(f)}" alt="${esc(m.nome)}">` : `<div class="cad-modelo-foto vazia">${silhuetaSvg(m.modulo)}</div>`}
            <div class="cad-modelo-info">
                <b>${esc(m.nome)}</b>
                <span class="suave">${esc(nomeModulo(m.modulo))} · ${esc(GUIAMENTOS[m.guiamento] || "")}</span>
                <dl>${linhas.map(([r, x]) => `<dt>${r}</dt><dd>${x}</dd>`).join("")}</dl>
                <button type="button" class="btn-link" data-cad-ficha="${esc(m.id)}">Ver a ficha completa</button>
            </div>
        </div>`;
    }

    async function documentacao(id) {
        const m = porId(id);
        if (!m || !podeVerDoc()) return "";
        if (!naNuvem()) return m.docUrl || "";
        const c = Nuvem.cliente();
        try {
            if (fornecedor()) {
                const r = await c.from("modelos_docs").select("url").eq("modelo_id", id).maybeSingle();
                return r.data?.url || "";
            }
            const r = await c.rpc("documentacao_modelo", { p_empresa: Nuvem.empresa().id, p_modelo: id });
            return r.error ? "" : (r.data || "");
        } catch (e) { return ""; }
    }

    async function abrirDocumentacao(id) {
        const url = await documentacao(id);
        if (!url) { ui.aviso(`O ${nome(id)} ainda não tem link de documentação. ${podeEditar() ? "Coloque em Frota › Modelos › Editar." : "Peça ao fornecedor."}`, "aviso"); return; }
        window.open(url, "_blank", "noopener");
    }

    /* ---------------- gravação (fornecedor / sem nuvem) ---------------- */

    async function salvar(m, docUrl) {
        const novo = normalizar(m);
        if (!/^[a-z0-9][a-z0-9-]{1,31}$/.test(novo.id)) throw new Error("O código usa 2 a 32 letras minúsculas, números e - (ex.: atta-e-o).");
        if (novo.nome.trim().length < 2) throw new Error("Dê um nome ao modelo.");
        if (naNuvem()) {
            if (!fornecedor()) throw new Error("Só o fornecedor altera o catálogo.");
            const c = Nuvem.cliente();
            const { error } = await c.from("modelos").upsert({
                id: novo.id, nome: novo.nome, modulo: novo.modulo, guiamento: novo.guiamento, descricao: novo.descricao,
                ficha: novo.ficha, parametros: novo.parametros, foto: novo.foto, ativo: novo.ativo
            });
            if (error) throw error;
            if (docUrl !== undefined) {
                const d = String(docUrl || "").trim();
                const r = d ? await c.from("modelos_docs").upsert({ modelo_id: novo.id, url: d }) : await c.from("modelos_docs").delete().eq("modelo_id", novo.id);
                if (r.error) throw r.error;
            }
            await carregar();
            return;
        }
        if (docUrl !== undefined) novo.docUrl = String(docUrl || "").trim();
        lista = lista.filter(x => x.id !== novo.id).concat([novo]).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
        gravarLocal();
        avisar();
    }

    async function liberar(id, sim) {
        if (!fornecedor()) return;
        const c = Nuvem.cliente();
        const emp = Nuvem.empresa().id;
        const r = sim ? await c.from("modelos_empresas").upsert({ modelo_id: id, empresa_id: emp })
                      : await c.from("modelos_empresas").delete().eq("modelo_id", id).eq("empresa_id", emp);
        if (r.error) throw r.error;
        await carregar();
    }

    // Foto: reduz para no máximo 800 px e grava em webp dentro do próprio modelo
    function reduzirFoto(arquivo) {
        return new Promise((resolver, rejeitar) => {
            const img = new Image();
            img.onload = () => {
                const escala = Math.min(1, 800 / Math.max(img.width, img.height));
                const tela = document.createElement("canvas");
                tela.width = Math.round(img.width * escala);
                tela.height = Math.round(img.height * escala);
                tela.getContext("2d").drawImage(img, 0, 0, tela.width, tela.height);
                let q = 0.82, url = tela.toDataURL("image/webp", q);
                while (url.length > 380000 && q > 0.3) { q -= 0.12; url = tela.toDataURL("image/webp", q); }
                URL.revokeObjectURL(img.src);
                if (url.length > 380000) rejeitar(new Error("A foto ficou grande demais mesmo reduzida."));
                else resolver(url);
            };
            img.onerror = () => rejeitar(new Error("Não foi possível abrir a imagem."));
            img.src = URL.createObjectURL(arquivo);
        });
    }

    /* ---------------- tela Frota › Modelos ---------------- */

    function agvsDoModelo(id) {
        return typeof agvs === "object" ? Object.values(agvs).filter(a => a.modelo === id) : [];
    }

    function htmlCartao(m) {
        const f = foto(m);
        const n = agvsDoModelo(m.id).length;
        return `
            <button type="button" class="modelo-cartao ${m.id === selecionado ? "ativo" : ""} ${m.ativo ? "" : "inativo"}" data-modelo="${esc(m.id)}">
                <span class="modelo-foto">${f ? `<img src="${esc(f)}" alt="" loading="lazy">` : `<span class="modelo-silhueta">${silhuetaSvg(m.modulo)}</span>`}</span>
                <span class="modelo-cartao-texto">
                    <b>${esc(m.nome)}</b>
                    <small>${esc(resumo(m))}</small>
                    <small class="suave">${n ? `${n} AGV${n > 1 ? "s" : ""} na frota` : "nenhum AGV na frota"}${fornecedor() && liberados ? (liberados.has(m.id) ? " · liberado" : " · não liberado") : ""}${m.ativo ? "" : " · fora de linha"}</small>
                </span>
            </button>`;
    }

    // Silhueta do módulo vista de cima (a mesma ideia do mapa)
    function silhuetaSvg(mod) {
        const extra = {
            G: `<rect x="44" y="14" width="10" height="4" rx="1"/><rect x="44" y="30" width="10" height="4" rx="1"/>`,
            T: `<line x1="4" y1="24" x2="-4" y2="24" stroke-width="3"/><circle cx="-6" cy="24" r="3"/>`,
            R: `<line x1="18" y1="14" x2="18" y2="34"/><line x1="24" y1="14" x2="24" y2="34"/><line x1="30" y1="14" x2="30" y2="34"/><line x1="36" y1="14" x2="36" y2="34"/>`,
            E: `<circle cx="27" cy="24" r="8" fill="none"/>`
        }[mod] || "";
        return `<svg viewBox="-10 0 70 48" aria-hidden="true"><g fill="currentColor" stroke="currentColor" stroke-width="2"><rect x="6" y="8" width="38" height="32" rx="5" fill="none"/>${extra}<path d="M40 24l-7-6v12z" stroke="none"/></g></svg>`;
    }

    function htmlFicha(m) {
        const grupos = GRUPOS.map(([g, titulo]) => {
            const linhas = CAMPOS.filter(c => c.grupo === g).map(c => {
                const v = valorFicha(m, c.chave);
                if (!v) return "";
                const medir = /^a (medir|definir)$/i.test(v);
                return `<dt>${esc(c.rotulo)}</dt><dd class="${medir ? "a-medir" : ""}">${esc(v)}${!medir && c.unidade ? ` <span class="suave">${esc(c.unidade)}</span>` : ""}</dd>`;
            }).join("");
            return linhas ? `<section class="ficha-grupo"><h3>${esc(titulo)}</h3><dl class="lista-dl">${linhas}</dl></section>` : "";
        }).join("");
        const f = foto(m);
        const n = agvsDoModelo(m.id);
        return `
            <div class="modelo-detalhe-topo">
                ${f ? `<img class="modelo-detalhe-foto" src="${esc(f)}" alt="${esc(m.nome)}">` : `<div class="modelo-detalhe-foto vazia">${silhuetaSvg(m.modulo)}</div>`}
                <div>
                    <h2>${esc(m.nome)}</h2>
                    <p class="suave">${esc(m.descricao)}</p>
                    <div class="modelo-pilulas">
                        <span class="pilula azul">${esc(nomeModulo(m.modulo))}</span>
                        <span class="pilula">${esc(GUIAMENTOS[m.guiamento])}</span>
                        ${m.ativo ? "" : `<span class="pilula ambar">fora de linha</span>`}
                    </div>
                    <p class="suave" style="margin-top:8px">${n.length ? `Na frota: ${n.map(a => `<b>${esc(a.id)}</b> ${esc(a.nome)}`).join(", ")}` : "Nenhum AGV da frota é deste modelo."}</p>
                    <div class="grupo" style="margin-top:10px">
                        ${podeVerDoc() ? `<button type="button" class="btn" data-acao-modelo="doc">${ui.icone("documento", "icone-p")}Documentação</button>` : ""}
                        ${podeEditar() ? `<button type="button" class="btn btn-primario" data-acao-modelo="editar">${ui.icone("lapis", "icone-p")}Editar</button>` : ""}
                        ${fornecedor() && liberados ? `<label class="config-chave"><input type="checkbox" data-acao-modelo="liberar" ${liberados.has(m.id) ? "checked" : ""}><span>Liberado para ${esc(Nuvem.empresa().nome)}</span></label>` : ""}
                    </div>
                </div>
            </div>
            <p class="suave modelo-nota">“a medir”: ainda não medido no protótipo. Esta ficha traz só o que interessa à operação; desenhos, cálculos e esquemas ficam na documentação.</p>
            <div class="ficha-grade">${grupos}</div>`;
    }

    function htmlEdicao(m, novo) {
        const grupos = GRUPOS.map(([g, titulo]) => `
            <fieldset class="ficha-grupo"><legend>${esc(titulo)}</legend>
                ${CAMPOS.filter(c => c.grupo === g).map(c => `
                    <label class="campo"><span>${esc(c.rotulo)}${c.unidade ? ` (${esc(c.unidade)})` : ""}</span>
                        <input data-ficha="${esc(c.chave)}" value="${esc(m.ficha[c.chave] ?? "")}" placeholder="a medir"></label>`).join("")}
            </fieldset>`).join("");
        return `
            <form class="modelo-edicao" id="formModelo" onsubmit="return false">
                <h2>${novo ? "Novo modelo" : `Editar ${esc(m.nome)}`}</h2>
                <div class="modelo-edicao-topo">
                    <label class="campo"><span>Código</span><input name="id" value="${esc(m.id)}" ${novo ? "" : "disabled"} placeholder="atta-e-m" maxlength="32"></label>
                    <label class="campo"><span>Nome</span><input name="nome" value="${esc(m.nome)}" maxlength="40" placeholder="Atta E-M"></label>
                    <label class="campo"><span>Módulo</span><select name="modulo">${Object.entries(MODULOS).map(([k, [n, d]]) => `<option value="${k}" ${m.modulo === k ? "selected" : ""}>${k} · ${n} (${d})</option>`).join("")}</select></label>
                    <label class="campo"><span>Guiamento</span><select name="guiamento">${Object.entries(GUIAMENTOS).map(([k, n]) => `<option value="${k}" ${m.guiamento === k ? "selected" : ""}>${k} · ${n}</option>`).join("")}</select></label>
                    <label class="campo largo"><span>Descrição curta</span><input name="descricao" value="${esc(m.descricao)}" maxlength="400"></label>
                    <label class="campo largo"><span>Link da documentação (desenhos, cálculos, esquema elétrico)</span><input name="doc" type="url" value="" placeholder="https://drive.google.com/..." data-doc-modelo></label>
                    <div class="campo"><span>Foto</span>
                        <div class="grupo"><button type="button" class="btn btn-mini" data-acao-modelo="foto">Escolher foto</button>
                        ${m.foto ? `<button type="button" class="btn btn-mini" data-acao-modelo="semFoto">Usar a padrão</button>` : ""}
                        <input type="file" accept="image/*" hidden data-arquivo-modelo></div>
                        <small class="suave">${m.foto ? "Foto própria" : foto(m) ? "Foto que vem com o site" : "Sem foto: aparece a silhueta"}</small>
                    </div>
                    <label class="config-chave"><input type="checkbox" name="ativo" ${m.ativo ? "checked" : ""}><span>Em linha (aparece no cadastro de AGVs)</span></label>
                </div>
                <div class="ficha-grade edicao">${grupos}</div>
                <label class="campo largo"><span>Parâmetros do firmware para este modelo (ponto de partida de um AGV novo)</span>
                    <textarea name="parametros" rows="3" spellcheck="false" class="mono">${esc(JSON.stringify(m.parametros || {}))}</textarea>
                    <small class="suave">Ex.: {"RAIO_RODA": 0.036, "VELOCIDADE_MAXIMA": 0.10}. Usados em Configurações › Cópias › “Padrão do modelo”.</small></label>
                <div class="grupo" style="justify-content:flex-end">
                    <button type="button" class="btn" data-acao-modelo="cancelar">Cancelar</button>
                    <button type="button" class="btn btn-primario" data-acao-modelo="salvar">Salvar</button>
                </div>
            </form>`;
    }

    function desenhar() {
        const caixa = document.getElementById("modelosConteudo");
        if (!caixa) return;
        if (!carregado) { caixa.innerHTML = `<div class="empty-state">Carregando o catálogo…</div>`; return; }
        if (!selecionado || !porId(selecionado)) selecionado = lista[0]?.id || null;
        const m = porId(selecionado);
        const lado = editando ? htmlEdicao(editando.modelo, editando.novo) : m ? htmlFicha(m) : `<div class="empty-state">Nenhum modelo no catálogo${podeEditar() ? ". Use “+ Modelo”." : " liberado para a sua empresa. Fale com o fornecedor."}</div>`;
        const listaHtml = lista.length ? lista.map(htmlCartao).join("") : `<div class="empty-state">Catálogo vazio.</div>`;
        caixa.innerHTML = `
            <div class="modelos-grade">
                <section class="card card-sem-padding modelos-lista">
                    <div class="card-barra"><div><h2>Catálogo</h2><div class="card-sub">${naNuvem() && !fornecedor() ? "Modelos liberados para a sua empresa" : "Modelos do Atta"}</div></div>
                        ${podeEditar() ? `<button type="button" class="btn btn-mini btn-primario" data-acao-modelo="novo">+ Modelo</button>` : ""}</div>
                    <div class="modelos-cartoes">${listaHtml}</div>
                </section>
                <section class="card modelo-detalhe">${lado}</section>
            </div>`;
        if (editando && !editando.novo && podeVerDoc()) {
            documentacao(editando.modelo.id).then(url => {
                const campo = caixa.querySelector("[data-doc-modelo]");
                if (campo && !campo.value) campo.value = url || "";
            });
        }
    }

    function lerFormulario() {
        const form = document.getElementById("formModelo");
        const m = JSON.parse(JSON.stringify(editando.modelo));
        const v = Object.fromEntries(new FormData(form));
        if (editando.novo) m.id = String(v.id || "").trim().toLowerCase();
        m.nome = String(v.nome || "").trim();
        m.modulo = v.modulo;
        m.guiamento = v.guiamento;
        m.descricao = String(v.descricao || "").trim();
        m.ativo = form.querySelector('[name="ativo"]').checked;
        form.querySelectorAll("[data-ficha]").forEach(el => {
            const t = el.value.trim();
            const n = Number(t.replace(",", "."));
            if (!t) delete m.ficha[el.dataset.ficha];
            else m.ficha[el.dataset.ficha] = /^-?\d+([.,]\d+)?$/.test(t) && Number.isFinite(n) ? n : t;
        });
        try {
            const p = JSON.parse(String(v.parametros || "{}").trim() || "{}");
            if (!p || typeof p !== "object" || Array.isArray(p)) throw new Error();
            m.parametros = p;
        } catch (e) {
            throw new Error("Os parâmetros do firmware não são um JSON válido ({\"NOME\": valor}).");
        }
        return { m, doc: v.doc };
    }

    async function aoClicar(evento) {
        const cartao = evento.target.closest("[data-modelo]");
        if (cartao && !editando) { selecionado = cartao.dataset.modelo; desenhar(); return; }
        const botao = evento.target.closest("[data-acao-modelo]");
        if (!botao) return;
        const acao = botao.dataset.acaoModelo;
        const m = porId(selecionado);
        if (acao === "doc" && m) abrirDocumentacao(m.id);
        if (acao === "editar" && m) { editando = { modelo: JSON.parse(JSON.stringify(m)), novo: false }; desenhar(); }
        if (acao === "novo") {
            editando = { modelo: normalizar({ id: "", nome: "", modulo: "G", guiamento: "O", ficha: {}, parametros: {} }), novo: true };
            desenhar();
        }
        if (acao === "cancelar") { editando = null; desenhar(); }
        if (acao === "foto") document.querySelector("[data-arquivo-modelo]")?.click();
        if (acao === "semFoto" && editando) { editando.modelo.foto = ""; desenhar(); }
        if (acao === "salvar" && editando) {
            try {
                const { m: novo, doc } = lerFormulario();
                if (editando.novo && porId(novo.id)) throw new Error(`Já existe o modelo ${novo.id}.`);
                botao.disabled = true;
                await salvar(novo, doc);
                selecionado = novo.id;
                editando = null;
                desenhar();
                ui.aviso(`${novo.nome} salvo.`, "sucesso");
            } catch (erro) {
                botao.disabled = false;
                ui.aviso(window.Nuvem ? Nuvem.traduzirErro(erro) : String(erro.message || erro), "erro");
            }
        }
    }

    async function aoMudar(evento) {
        const alvo = evento.target;
        if (alvo.matches("[data-arquivo-modelo]") && alvo.files?.[0] && editando) {
            try {
                // guarda o que já foi digitado antes de redesenhar
                try { const { m } = lerFormulario(); m.foto = editando.modelo.foto; editando.modelo = m; } catch (e) { /* segue */ }
                editando.modelo.foto = await reduzirFoto(alvo.files[0]);
                desenhar();
            } catch (erro) { ui.aviso(erro.message, "erro"); }
        }
        if (alvo.matches('[data-acao-modelo="liberar"]') && selecionado) {
            try { await liberar(selecionado, alvo.checked); desenhar(); }
            catch (erro) { ui.aviso(Nuvem.traduzirErro(erro), "erro"); alvo.checked = !alvo.checked; }
        }
    }

    function abrir(id) {
        editando = null;
        if (id && porId(id)) selecionado = id;
        if (!carregado) carregar().then(desenhar);
        desenhar();
    }

    const tela = document.getElementById("modelosConteudo");
    tela?.addEventListener("click", aoClicar);
    tela?.addEventListener("change", aoMudar);
    setTimeout(carregar, 0);   // depois de "Modelos" existir (o aviso redesenha a frota)

    return {
        MODULOS, GUIAMENTOS, CAMPOS, GRUPOS, PADRAO, perfil, velocidades, PADRAO_FIRMWARE,
        carregar, lista: () => lista.slice(), disponiveis, porId, doAgv, modulo, nome, foto, resumo, valorFicha,
        nomeModulo, opcoesHtml, cartaoCadastroHtml, documentacao, abrirDocumentacao, salvar, liberar, abrir, desenhar, silhuetaSvg,
        podeEditar, podeVerDoc
    };
})();
