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
        G: ["Garra", "pega o carrinho por baixo e leva"],
        T: ["Rebocador", "puxa carrinhos engatados"],
        R: ["Roletes", "recebe e entrega por roletes"],
        E: ["Elevação", "levanta a carga por baixo"]
    };
    const GUIAMENTOS = { O: "Óptico (fita no chão)", M: "Magnético (fita magnética)", L: "LiDAR (sem fita)" };
    const GRUPOS = [
        ["dimensoes", "Dimensões e espaço"], ["movimento", "Movimento"], ["tracao", "Tração"],
        ["carga", "Carga e indexação"], ["guiamento", "Guiamento e sensores"], ["energia", "Energia e piso"]
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
        ["movimento", "vel_lateral_ms", "Velocidade de lado", "m/s"],
        ["movimento", "aceleracao_ms2", "Aceleração", "m/s²"],
        ["movimento", "parada_mm", "Distância de parada (máx., com carga)", "mm"],
        ["movimento", "rampa_max_pct", "Rampa máxima", "%"],
        ["tracao", "motor", "Motores", ""],
        ["tracao", "torque_nm", "Torque por motor", "N·m"],
        ["tracao", "raio_roda_m", "Raio da roda", "m"],
        ["tracao", "rodas", "Rodas", ""],
        ["carga", "carga_kg", "Carga máxima", "kg"],
        ["carga", "indexacao", "Indexação (como pega a carga)", ""],
        ["carga", "garra_curso_mm", "Curso", "mm"],
        ["carga", "garra_altura_min_mm", "Altura mínima", "mm"],
        ["carga", "garra_altura_max_mm", "Altura máxima", "mm"],
        ["carga", "garra_tempo_s", "Tempo para pegar / soltar", "s"],
        ["carga", "garra_orientacao", "Orientação da carga", ""],
        ["carga", "garra_lados", "Lados de acesso", ""],
        ["carga", "torque_elevacao_nm", "Torque da elevação", "N·m"],
        ["carga", "fuso", "Fuso", ""],
        ["guiamento", "guiamento", "Como se guia", ""],
        ["guiamento", "precisao_parada_mm", "Precisão de parada", "± mm"],
        ["guiamento", "sensores", "Sensores", ""],
        ["guiamento", "cobertura", "Cobertura dos sensores", ""],
        ["energia", "energia", "Bateria", ""],
        ["energia", "autonomia_h", "Autonomia", "h"],
        ["energia", "recarga", "Recarga", ""],
        ["energia", "piso", "Piso", ""],
        ["energia", "desnivel_max_mm", "Desnível máximo", "mm"]
    ].map(([grupo, chave, rotulo, unidade]) => ({ grupo, chave, rotulo, unidade }));

    // Fotos que vêm com o site (o fornecedor pode trocar)
    const FOTOS = { "atta-g-o": "img/modelos/atta-g-o.webp" };

    // O protótipo: o mesmo do 01_esquema.sql
    const PADRAO = [{
        id: "atta-g-o", nome: "Atta G-O", modulo: "G", guiamento: "O", ativo: true,
        descricao: "Garra que ergue o carrinho por baixo, guiado por fita óptica no chão. Protótipo funcional (TCC).",
        ficha: {
            comprimento_mm: "a medir", largura_mm: "a medir", altura_mm: "a medir", giro_diametro_mm: "a medir",
            corredor_min_mm: "a medir", massa_kg: 5, vel_max_ms: 0.10, vel_lateral_ms: 0.03, aceleracao_ms2: 0.20,
            parada_mm: "a medir", rampa_max_pct: 0, motor: "4 × NEMA 17 (passo)", torque_nm: 0.52, raio_roda_m: 0.036,
            rodas: "4 mecanum", carga_kg: 10, indexacao: "Garra por baixo do carrinho (fuso TR8x8)",
            garra_curso_mm: "a medir", garra_altura_min_mm: "a medir", garra_altura_max_mm: "a medir",
            garra_tempo_s: "a medir", garra_orientacao: "Frente do AGV", garra_lados: "Entra por baixo, pela frente",
            torque_elevacao_nm: 0.52, fuso: "TR8x8 (avanço 8 mm)", guiamento: "Fita óptica no chão (QTR-8A) e tags RFID nos pontos",
            precisao_parada_mm: "a medir", sensores: "QTR-8A (linha), 2 × VL53L0X (frente), leitor RFID",
            cobertura: "Frente, até ~1,2 m", energia: "a definir", autonomia_h: "a medir", recarga: "a definir",
            piso: "Liso e plano, fita contrastante", desnivel_max_mm: "a medir"
        },
        parametros: { RAIO_RODA: 0.036, VELOCIDADE_MAXIMA: 0.10, ACELERACAO_LINEAR: 0.20 },
        foto: "", docUrl: ""
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
            if (Array.isArray(d) && d.length) return d.map(normalizar);
        } catch (e) { /* ignora */ }
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
        if (!/^[a-z0-9][a-z0-9-]{1,31}$/.test(novo.id)) throw new Error("O código usa 2 a 32 letras minúsculas, números e - (ex.: atta-g-o).");
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

    function abrir() {
        editando = null;
        if (!carregado) carregar().then(desenhar);
        desenhar();
    }

    const tela = document.getElementById("modelosConteudo");
    tela?.addEventListener("click", aoClicar);
    tela?.addEventListener("change", aoMudar);
    setTimeout(carregar, 0);   // depois de "Modelos" existir (o aviso redesenha a frota)

    return {
        MODULOS, GUIAMENTOS, CAMPOS, GRUPOS, PADRAO,
        carregar, lista: () => lista.slice(), disponiveis, porId, doAgv, modulo, nome, foto, resumo, valorFicha,
        nomeModulo, opcoesHtml, documentacao, abrirDocumentacao, salvar, liberar, abrir, desenhar, silhuetaSvg,
        podeEditar, podeVerDoc
    };
})();
