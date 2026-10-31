/* ============================================================
   EDITOR DA PLANTA (tela "Controle da Planta")
   ============================================================
   Rascunho x publicada:
   - O editor sempre mexe no RASCUNHO (salvo sozinho no navegador).
   - As missoes usam a planta PUBLICADA. "PUBLICAR" valida o rascunho
     e, se nao houver erros, vira a nova revisao publicada.
*/

(function (raiz) {
    "use strict";

    const CHAVE_RASCUNHO = "plantaAGV2";
    const CHAVE_PUBLICADA = "plantaAGV2Publicada";
    const MAX_DESFAZER = 60;

    const FERRAMENTAS = {
        SELECIONAR: { tecla: "v", dica: "Clique para selecionar. Arraste pontos e objetos. Arraste o fundo para mover a vista; use a roda para zoom." },
        ESTACAO:    { tecla: "e", dica: "Clique para criar uma estação (o ponto onde o AGV para). Sobre uma linha, a estação é inserida nela. Para uma estação com mais de uma entrada, use “+ Outro acesso” nas propriedades." },
        REFERENCIA: { tecla: "r", dica: "Clique para criar um ponto de referência (cruzamento, curva, entrada de estação). Sobre uma linha, divide a linha." },
        ESPERA:     { tecla: "w", dica: "Clique para criar um ponto de espera (estacionamento do AGV)." },
        SEGMENTO:   { tecla: "s", dica: "Clique no ponto inicial e depois nos próximos para desenhar a linha. Clicar no vazio cria um ponto. Esc termina." },
        LATERAL:    { tecla: "l", dica: "Troca lateral: clique num ponto de uma faixa e depois no ponto em frente, na faixa paralela. O AGV anda de lado entre eles, sem fita." },
        TAG:        { tecla: "t", dica: "Clique sobre uma linha para colocar uma tag RFID intermediária." },
        OBJETO:     { tecla: "o", dica: "Arraste para desenhar o objeto escolhido (ou clique para o tamanho padrão)." },
        ESCALA:     { tecla: "k", dica: "Clique em dois pontos de distância conhecida (na imagem de fundo) para corrigir a escala." }
    };

    const estado = {
        rascunho: null,
        publicada: null,
        avisosMigracao: [],
        mapa: null,
        ferramenta: "SELECIONAR",
        tipoObjeto: "MAQUINA",
        selecao: null,           // { tipo: "no"|"segmento"|"layout", id, tag? }
        desfazer: [],
        refazer: [],
        inicioSegmento: null,
        inicioLateral: null,
        novoAcessoDe: null,      // estação que vai ganhar um acesso no próximo clique
        ultimaFaixa: null,       // { origem, nova, pares, sugestao } logo depois de criar uma faixa paralela
        ponteiro: null,          // posicao do mouse no mundo
        arrasto: null,
        retangulo: null,
        escala: [],
        validacao: { erros: [], avisos: [] },
        usarGrade: true,
        iniciado: false,
        timerSalvar: null,
        timerValidar: null,
        ganchos: {
            aoPublicar: null,          // (planta) => void
            aoRenomearNo: null,        // (antigo, novo) => void
            ultimosRfids: null,        // () => [{ agv, codigo }]
            missoesUsandoNo: null      // (id) => [nomes]
        }
    };


    /* ========================================================
       ARMAZENAMENTO
       ======================================================== */

    function lerJSON(chave) {
        try {
            const texto = localStorage.getItem(chave);
            return texto ? JSON.parse(texto) : null;
        } catch (erro) {
            return null;
        }
    }

    // Com a nuvem, só o administrador altera a planta; os outros só olham.
    function somenteLeitura() {
        return typeof Nuvem !== "undefined" && !Nuvem.pode("administrar");
    }

    function carregar() {
        let rascunho = lerJSON(CHAVE_RASCUNHO);
        let publicada = lerJSON(CHAVE_PUBLICADA);
        const daNuvem = typeof Nuvem !== "undefined" ? Nuvem.plantaDaNuvem() : null;

        if (daNuvem) {
            // A planta da empresa vem do banco (sem exemplo nem migração).
            publicada = daNuvem.publicada;
            rascunho = daNuvem.rascunho || (publicada ? Planta.clonar(publicada) : null);
        } else if (!rascunho && !publicada) {
            // Primeira vez com o editor novo: migra a planta antiga, se houver.
            const antiga = lerJSON("plantaAGVOperacional") || lerJSON("plantaAGV");
            if (antiga && Array.isArray(antiga.pontos) && antiga.pontos.length) {
                const migracao = Planta.migrarV1(antiga);
                publicada = migracao.planta;
                publicada.revisao = 1;
                rascunho = Planta.clonar(publicada);
                estado.avisosMigracao = migracao.avisos;
            } else if (typeof PlantaExemplo !== "undefined") {
                // Primeira vez que o site abre: planta de exemplo publicada
                // (apresentação e AGV virtual) e as missões de exemplo.
                publicada = PlantaExemplo.planta();
                rascunho = Planta.clonar(publicada);
                try {
                    if (!localStorage.getItem("missoesAGV")) localStorage.setItem("missoesAGV", JSON.stringify(PlantaExemplo.missoes()));
                } catch (erro) { /* sem espaço: segue sem as missões */ }
            }
        }
        estado.publicada = publicada ? Planta.normalizar(publicada) : Planta.criarVazia();
        estado.rascunho = rascunho ? Planta.normalizar(rascunho) : Planta.clonar(estado.publicada);
        salvarAgora(true);
    }

    function salvarAgora(soNoNavegador) {
        if (!soNoNavegador && typeof Nuvem !== "undefined") Nuvem.salvarPlanta(estado.rascunho, estado.publicada);
        try {
            localStorage.setItem(CHAVE_RASCUNHO, JSON.stringify(estado.rascunho));
            localStorage.setItem(CHAVE_PUBLICADA, JSON.stringify(estado.publicada));
            return true;
        } catch (erro) {
            ui.aviso("Não foi possível salvar a planta no navegador (espaço cheio). " +
                  "Tente uma imagem de fundo menor ou remova a imagem.", "erro");
            return false;
        }
    }

    function agendarSalvar() {
        clearTimeout(estado.timerSalvar);
        estado.timerSalvar = setTimeout(salvarAgora, 400);
    }


    /* ========================================================
       DESFAZER / REFAZER
       ======================================================== */

    function instantaneo() {
        // A imagem de fundo (texto grande) e compartilhada, nao copiada.
        const imagem = estado.rascunho.fundo?.imagem;
        const copia = JSON.parse(JSON.stringify(estado.rascunho, (k, v) => (k === "imagem" ? undefined : v)));
        return { planta: copia, imagem };
    }

    function restaurar(foto) {
        const planta = Planta.clonar(foto.planta);
        if (planta.fundo && foto.imagem) planta.fundo.imagem = foto.imagem;
        estado.rascunho = Planta.normalizar(planta);
    }

    function registrarDesfazer() {
        estado.desfazer.push(instantaneo());
        if (estado.desfazer.length > MAX_DESFAZER) estado.desfazer.shift();
        estado.refazer = [];
    }

    function desfazer() {
        if (!estado.desfazer.length) return;
        estado.refazer.push(instantaneo());
        restaurar(estado.desfazer.pop());
        validarSelecao();
        alterado();
    }

    function refazerAcao() {
        if (!estado.refazer.length) return;
        estado.desfazer.push(instantaneo());
        restaurar(estado.refazer.pop());
        validarSelecao();
        alterado();
    }


    /* ========================================================
       OPERACOES SOBRE O RASCUNHO
       ======================================================== */

    const p = () => estado.rascunho;

    function arredondarGrade(valor) {
        if (!estado.usarGrade) return Planta.arred(valor, 3);
        const g = p().grade || 0.5;
        return Planta.arred(Math.round(valor / g) * g, 3);
    }

    // Ids de pontos e de estações não podem se repetir entre si
    function idLivre(prefixo) {
        return Planta.proximoId([...p().nos, ...(p().estacoes || [])], prefixo);
    }

    function idAcessoLivre(estacaoId) {
        let n = Planta.acessosDaEstacao(p(), estacaoId).length + 1;
        while (Planta.noPorId(p(), `${estacaoId}-${n}`) || Planta.estacaoPorId(p(), `${estacaoId}-${n}`)) n++;
        return `${estacaoId}-${n}`;
    }

    function criarNo(tipo, x, y, estacaoId) {
        const id = tipo === "ESTACAO" && estacaoId ? idAcessoLivre(estacaoId) : idLivre(Planta.prefixoNo(tipo));
        const no = {
            id, tipo, nome: "", x: Planta.arred(x), y: Planta.arred(y), rfid: "",
            orientacaoChegada: tipo === "ESTACAO" ? 90 : null, barreira: 0
        };
        if (tipo === "ESTACAO") {
            if (!estacaoId) {
                p().estacoes.push({ id, nome: "" });
                estacaoId = id;
            } else {
                const outro = Planta.acessosDaEstacao(p(), estacaoId)[0];
                if (outro) no.orientacaoChegada = outro.orientacaoChegada;
            }
            no.estacao = estacaoId;
        }
        p().nos.push(no);
        return no;
    }

    // Estação sem nenhum acesso some junto
    function limparEstacoesVazias() {
        p().estacoes = (p().estacoes || []).filter(e => Planta.acessosDaEstacao(p(), e.id).length > 0);
    }

    function tornarEstacao(no) {
        if (no.estacao && Planta.estacaoPorId(p(), no.estacao)) return;
        const id = Planta.estacaoPorId(p(), no.id) ? idLivre("E") : no.id;
        p().estacoes.push({ id, nome: no.nome || "" });
        no.nome = "";
        no.estacao = id;
    }

    function criarSegmento(a, b) {
        if (a === b) return null;
        const existe = p().segmentos.find(s => Planta.tipoSegmento(s) === "LINHA" && ((s.a === a && s.b === b) || (s.a === b && s.b === a)));
        if (existe) return existe;
        const s = { id: Planta.proximoId(p().segmentos, "S"), tipo: "LINHA", a, b, sentido: "DUPLO", velocidadeMaxima: 0, barreira: 0, tags: [] };
        p().segmentos.push(s);
        return s;
    }

    // Projeta um ponto num segmento: { distancia, x, y, comprimento }
    function projetar(segmento, ponto) {
        const a = Planta.noPorId(p(), segmento.a), b = Planta.noPorId(p(), segmento.b);
        const dx = b.x - a.x, dy = b.y - a.y;
        const L = Math.hypot(dx, dy) || 1;
        let t = ((ponto.x - a.x) * dx + (ponto.y - a.y) * dy) / (L * L);
        t = Math.max(0, Math.min(1, t));
        return { distancia: t * L, x: a.x + dx * t, y: a.y + dy * t, comprimento: L };
    }

    // Insere um no no meio de um segmento (divide em dois)
    function dividirSegmento(segmento, ponto, tipo, estacaoId) {
        if (Planta.tipoSegmento(segmento) === "LATERAL") return null;
        const proj = projetar(segmento, ponto);
        if (proj.distancia < 0.1 || proj.comprimento - proj.distancia < 0.1) return null;
        const no = criarNo(tipo, proj.x, proj.y, estacaoId);
        const tags = segmento.tags || [];
        const novo = {
            id: Planta.proximoId(p().segmentos, "S"), tipo: "LINHA", a: no.id, b: segmento.b, sentido: segmento.sentido,
            velocidadeMaxima: segmento.velocidadeMaxima, barreira: segmento.barreira,
            tags: tags.filter(t => t.distancia > proj.distancia).map(t => ({ rfid: t.rfid, distancia: Planta.arred(t.distancia - proj.distancia) }))
        };
        segmento.tags = tags.filter(t => t.distancia < proj.distancia);
        segmento.b = no.id;
        p().segmentos.push(novo);
        return no;
    }

    async function excluirSelecao() {
        const sel = estado.selecao;
        if (!sel) return;
        if (sel.tipo === "no") {
            const no = Planta.noPorId(p(), sel.id);
            const ultimoAcesso = no?.estacao && Planta.acessosDaEstacao(p(), no.estacao).length === 1 ? no.estacao : null;
            const usos = estado.ganchos.missoesUsandoNo
                ? [...new Set([...estado.ganchos.missoesUsandoNo(sel.id), ...(ultimoAcesso ? estado.ganchos.missoesUsandoNo(ultimoAcesso) : [])])]
                : [];
            if (usos.length && !(await ui.confirmar({
                titulo: `Excluir ${sel.id}?`,
                texto: `${ultimoAcesso ? `É o único acesso da estação ${ultimoAcesso}, que` : "Este ponto"} é destino nas missões: ${usos.join(", ")}.`,
                confirmar: "Excluir mesmo assim", perigo: true
            }))) {
                return;
            }
        }
        registrarDesfazer();
        if (sel.tipo === "no") {
            p().nos = p().nos.filter(n => n.id !== sel.id);
            p().segmentos = p().segmentos.filter(s => s.a !== sel.id && s.b !== sel.id);
            limparEstacoesVazias();
        } else if (sel.tipo === "segmento") {
            if (sel.tag !== undefined && sel.tag !== null) {
                const s = Planta.segmentoPorId(p(), sel.id);
                if (s) s.tags.splice(sel.tag, 1);
                estado.selecao = { tipo: "segmento", id: sel.id };
                alterado();
                return;
            }
            p().segmentos = p().segmentos.filter(s => s.id !== sel.id);
        } else if (sel.tipo === "layout") {
            p().layout = p().layout.filter(o => o.id !== sel.id);
        }
        estado.selecao = null;
        alterado();
    }

    function renomearNo(antigo, novo) {
        novo = String(novo || "").trim();
        if (!novo || novo === antigo) return false;
        if (!/^[A-Za-z0-9_-]+$/.test(novo) || novo.length > Planta.LIMITES.tamanhoId) {
            ui.aviso(`Use até ${Planta.LIMITES.tamanhoId} caracteres: letras, números, _ ou -.`, "aviso");
            return false;
        }
        if (Planta.noPorId(p(), novo) || (Planta.estacaoPorId(p(), novo) && Planta.noPorId(p(), antigo)?.estacao !== novo)) {
            ui.aviso(`Já existe um ponto ou estação ${novo}.`, "aviso");
            return false;
        }
        const no = Planta.noPorId(p(), antigo);
        no.id = novo;
        p().segmentos.forEach(s => {
            if (s.a === antigo) s.a = novo;
            if (s.b === antigo) s.b = novo;
        });
        estado.selecao = { tipo: "no", id: novo };
        if (estado.ganchos.aoRenomearNo) estado.ganchos.aoRenomearNo(antigo, novo);
        return true;
    }

    function renomearEstacao(antigo, novo) {
        novo = String(novo || "").trim();
        if (!novo || novo === antigo) return false;
        if (!/^[A-Za-z0-9_-]+$/.test(novo) || novo.length > Planta.LIMITES.tamanhoId) {
            ui.aviso(`Use até ${Planta.LIMITES.tamanhoId} caracteres: letras, números, _ ou -.`, "aviso");
            return false;
        }
        const ocupado = Planta.estacaoPorId(p(), novo) || (Planta.noPorId(p(), novo) && Planta.noPorId(p(), novo).estacao !== antigo);
        if (ocupado) {
            ui.aviso(`Já existe um ponto ou estação ${novo}.`, "aviso");
            return false;
        }
        const estacao = Planta.estacaoPorId(p(), antigo);
        estacao.id = novo;
        Planta.acessosDaEstacao(p(), antigo).forEach(no => { no.estacao = novo; });
        p().nos.forEach(no => { if (no.estacao === antigo) no.estacao = novo; });
        if (estado.ganchos.aoRenomearNo) estado.ganchos.aoRenomearNo(antigo, novo);
        return true;
    }

    // Escala tudo em torno de um ponto (corrige desenho feito na escala errada)
    function escalarTudo(fator, origem) {
        const e = (v, o) => Planta.arred(o + (v - o) * fator, 3);
        const planta = p();
        planta.nos.forEach(n => { n.x = e(n.x, origem.x); n.y = e(n.y, origem.y); });
        planta.layout.forEach(o => {
            o.x = e(o.x, origem.x); o.y = e(o.y, origem.y);
            o.largura = Planta.arred(o.largura * fator); o.profundidade = Planta.arred(o.profundidade * fator);
        });
        planta.segmentos.forEach(s => s.tags.forEach(t => { t.distancia = Planta.arred(t.distancia * fator); }));
        if (planta.fundo) {
            planta.fundo.x = e(planta.fundo.x, origem.x);
            planta.fundo.y = e(planta.fundo.y, origem.y);
            planta.fundo.largura = Planta.arred(planta.fundo.largura * fator);
            planta.fundo.altura = Planta.arred(planta.fundo.altura * fator);
        }
        planta.dimensoes.largura = Math.max(1, Planta.arred(planta.dimensoes.largura * fator, 2));
        planta.dimensoes.altura = Math.max(1, Planta.arred(planta.dimensoes.altura * fator, 2));
    }


    /* ========================================================
       ATUALIZACAO DA TELA
       ======================================================== */

    function validarSelecao() {
        const sel = estado.selecao;
        if (!sel) return;
        const existe =
            (sel.tipo === "no" && Planta.noPorId(p(), sel.id)) ||
            (sel.tipo === "segmento" && Planta.segmentoPorId(p(), sel.id)) ||
            (sel.tipo === "layout" && p().layout.find(o => o.id === sel.id));
        if (!existe) estado.selecao = null;
        if (estado.novoAcessoDe && !Planta.estacaoPorId(p(), estado.novoAcessoDe)) estado.novoAcessoDe = null;
    }

    function alterado() {
        agendarSalvar();
        desenharMapa();
        renderizarPropriedades();
        atualizarStatus();
        clearTimeout(estado.timerValidar);
        estado.timerValidar = setTimeout(() => {
            estado.validacao = Planta.validar(p());
            renderizarValidacao();
            desenharMapa();
        }, 200);
    }

    function desenharMapa() {
        const mapa = estado.mapa;
        if (!mapa) return;
        mapa.planta = p();
        mapa.selecao = estado.selecao;
        mapa.destaques = new Set(estado.validacao.erros.map(e => e.alvo));
        mapa.desenhar();
    }

    function semPublicar() {
        const limpa = planta => JSON.stringify(Object.assign({}, planta, { revisao: 0 }));
        return limpa(estado.rascunho) !== limpa(estado.publicada);
    }

    function atualizarStatus() {
        const status = document.getElementById("editorStatus");
        if (!status) return;
        const rev = estado.publicada.revisao || 0;
        if (semPublicar()) {
            status.textContent = rev ? `Alterações não publicadas · em uso: rev ${rev}` : "Rascunho ainda não publicado";
            status.className = "editor-status pendente";
        } else {
            status.textContent = rev ? `Publicada · rev ${rev}` : "Planta vazia";
            status.className = "editor-status ok";
        }
        const btnDesfazer = document.getElementById("editorDesfazer");
        const btnRefazer = document.getElementById("editorRefazer");
        if (btnDesfazer) btnDesfazer.disabled = !estado.desfazer.length;
        if (btnRefazer) btnRefazer.disabled = !estado.refazer.length;
    }

    function selecionarFerramenta(nome) {
        estado.ferramenta = nome;
        estado.inicioSegmento = null;
        estado.inicioLateral = null;
        if (nome !== "ESTACAO") estado.novoAcessoDe = null;
        estado.escala = [];
        document.querySelectorAll("[data-ferramenta]").forEach(b => {
            b.classList.toggle("ativo", b.dataset.ferramenta === nome);
        });
        const dica = document.getElementById("editorDica");
        if (dica) dica.textContent = estado.novoAcessoDe && nome === "ESTACAO"
            ? `Clique onde fica o outro acesso da estação ${estado.novoAcessoDe} (outro lado da máquina, outra faixa…).`
            : FERRAMENTAS[nome]?.dica || "";
        const container = document.getElementById("editorMapa");
        if (container) container.dataset.ferramenta = nome;
        if (nome === "ESCALA" && !p().fundo) {
            if (dica) dica.textContent = "Clique em dois pontos de distância conhecida. (Sem imagem de fundo, a escala corrige os pontos e objetos desenhados.)";
        }
        desenharMapa();
        renderizarPropriedades();
    }


    /* ========================================================
       PAINEL DE PROPRIEDADES
       ======================================================== */

    const esc = valor => String(valor ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

    function campo(rotulo, nomeCampo, valor, extra = "") {
        return `<label class="editor-campo"><span>${rotulo}</span><input data-campo="${nomeCampo}" value="${esc(valor)}" ${extra}></label>`;
    }

    function campoNumero(rotulo, nomeCampo, valor, passo = 0.01, unidade = "", extra = "") {
        return `<label class="editor-campo"><span>${rotulo}</span><div class="editor-com-unidade"><input type="number" step="${passo}" data-campo="${nomeCampo}" value="${esc(valor)}" ${extra}>${unidade ? `<em>${unidade}</em>` : ""}</div></label>`;
    }

    function campoSelect(rotulo, nomeCampo, valor, opcoes) {
        return `<label class="editor-campo"><span>${rotulo}</span><select data-campo="${nomeCampo}">${opcoes.map(([v, t]) => `<option value="${esc(v)}" ${String(v) === String(valor) ? "selected" : ""}>${esc(t)}</option>`).join("")}</select></label>`;
    }

    function renderizarPropriedades() {
        const painel = document.getElementById("editorPropriedades");
        const titulo = document.getElementById("editorPropTitulo");
        if (!painel) return;
        const sel = estado.selecao;
        const planta = p();

        if (estado.ferramenta === "ESCALA") {
            titulo.textContent = "Corrigir escala";
            const [a, b] = estado.escala;
            if (!a || !b) {
                painel.innerHTML = `<p class="editor-texto">Clique no ${a ? "segundo" : "primeiro"} ponto de uma medida conhecida (ex.: uma parede ou a largura de um corredor).</p>`;
                return;
            }
            const medido = Math.hypot(b.x - a.x, b.y - a.y);
            painel.innerHTML = `
                <p class="editor-texto">Distância no desenho: <strong>${Planta.arred(medido, 3)} m</strong></p>
                ${campoNumero("Distância real", "escalaReal", Planta.arred(medido, 3), 0.01, "m", 'id="editorEscalaReal"')}
                <div class="editor-acoes"><button class="btn btn-primario" data-acao="aplicarEscala">Aplicar escala</button><button class="btn" data-acao="cancelarEscala">Cancelar</button></div>
                <p class="editor-texto suave">Imagem de fundo, pontos, objetos e tags serão escalados juntos.</p>`;
            return;
        }

        if (!sel) {
            titulo.textContent = "Planta";
            const f = planta.fundo;
            painel.innerHTML = `
                ${campo("Nome", "plantaNome", planta.nome)}
                <div class="editor-linha">
                    ${campoNumero("Largura", "plantaLargura", planta.dimensoes.largura, 0.5, "m", 'min="1"')}
                    ${campoNumero("Altura", "plantaAltura", planta.dimensoes.altura, 0.5, "m", 'min="1"')}
                </div>
                ${campoNumero("Passo da grade", "plantaGrade", planta.grade, 0.05, "m", 'min="0.05"')}
                <div class="editor-bloco">
                    <span class="editor-subtitulo">Imagem de fundo</span>
                    ${f ? `
                        <label class="editor-campo"><span>Opacidade</span><input type="range" min="0.05" max="1" step="0.05" data-campo="fundoOpacidade" value="${f.opacidade ?? 0.5}"></label>
                        <div class="editor-linha">
                            ${campoNumero("X", "fundoX", f.x, 0.05, "m")}
                            ${campoNumero("Y", "fundoY", f.y, 0.05, "m")}
                        </div>
                        ${campoNumero("Largura da imagem", "fundoLargura", f.largura, 0.05, "m")}
                        <div class="editor-acoes">
                            <button class="btn btn-mini" data-acao="ferramentaEscala">Corrigir escala</button>
                            <button class="btn btn-mini" data-acao="areaDaImagem">Área = imagem</button>
                            <button class="btn btn-mini btn-perigo" data-acao="removerFundo">Remover</button>
                        </div>` : `
                        <p class="editor-texto suave">Importe a planta baixa (foto, PDF exportado como imagem, CAD) para desenhar por cima.</p>
                        <button class="btn btn-mini" data-acao="escolherImagem">Importar imagem</button>`}
                </div>
                <div class="editor-bloco">
                    <span class="editor-subtitulo">Resumo</span>
                    <p class="editor-texto">${(planta.estacoes || []).length} estações (${planta.nos.filter(n => n.tipo === "ESTACAO").length} acessos) · ${planta.nos.length} pontos · ${planta.segmentos.filter(x => Planta.tipoSegmento(x) === "LINHA").length} linhas · ${planta.segmentos.filter(x => Planta.tipoSegmento(x) === "LATERAL").length} trocas laterais · ${planta.layout.length} objetos</p>
                    ${typeof PlantaExemplo !== "undefined" && planta.nome === PlantaExemplo.NOME ? `<div class="editor-aviso"><strong>Planta de exemplo.</strong> Serve para apresentar o sistema e testar com o AGV virtual. Para a sua fábrica, edite esta planta ou comece uma vazia e desenhe as suas linhas, estações e tags.</div>` : ""}
                    ${estado.avisosMigracao.length ? `<div class="editor-aviso"><strong>Planta antiga convertida:</strong><ul>${estado.avisosMigracao.map(a => `<li>${esc(a)}</li>`).join("")}</ul></div>` : ""}
                </div>
                <div class="editor-acoes">
                    <button class="btn btn-mini" data-acao="descartarRascunho" ${semPublicar() ? "" : "disabled"}>Descartar alterações</button>
                    ${typeof PlantaExemplo !== "undefined" ? `<button class="btn btn-mini" data-acao="plantaExemplo">Carregar planta de exemplo</button>` : ""}
                    <button class="btn btn-mini btn-perigo" data-acao="plantaVazia">Nova planta vazia</button>
                </div>`;
            return;
        }

        if (sel.tipo === "no") {
            const no = Planta.noPorId(planta, sel.id);
            const estacao = no.tipo === "ESTACAO" ? Planta.estacaoPorId(planta, no.estacao) : null;
            const acessos = estacao ? Planta.acessosDaEstacao(planta, estacao.id) : [];
            titulo.textContent = no.tipo === "ESTACAO" ? (acessos.length > 1 ? `Acesso da estação ${estacao.id}` : "Estação") : no.tipo === "ESPERA" ? "Ponto de espera" : "Referência";
            const ligados = planta.segmentos.filter(s => s.a === no.id || s.b === no.id).length;
            const rfids = estado.ganchos.ultimosRfids ? estado.ganchos.ultimosRfids() : [];
            const maquinas = planta.layout.filter(o => Planta.TIPOS_LAYOUT[o.tipo]?.solido);
            painel.innerHTML = `
                <div class="editor-linha">
                    ${campo("Identificador", "noId", no.id, `maxlength="${Planta.LIMITES.tamanhoId}"`)}
                    ${campoSelect("Tipo", "noTipo", no.tipo, [["ESTACAO", "Estação"], ["REFERENCIA", "Referência"], ["ESPERA", "Espera"]])}
                </div>
                ${no.tipo === "ESTACAO" && estacao ? `
                    <div class="editor-bloco destaque">
                        <span class="editor-subtitulo">Estação (destino das missões)</span>
                        <div class="editor-linha">
                            ${campo("ID da estação", "estacaoId", estacao.id, `maxlength="${Planta.LIMITES.tamanhoId}"`)}
                            ${campo("Nome", "estacaoNome", estacao.nome, 'placeholder="Ex.: Prensa 1"')}
                        </div>
                        ${maquinas.length ? campoSelect("Máquina atendida", "estacaoMaquina", estacao.maquina || "", [["", "—"]].concat(maquinas.map(m => [m.id, m.nome || m.id]))) : ""}
                        <div class="editor-acessos">
                            ${acessos.map(a => `<div class="editor-acesso ${a.id === no.id ? "atual" : ""}"><span>${esc(a.id)}${a.nome ? " · " + esc(a.nome) : ""} · chega a ${a.orientacaoChegada ?? "?"}°</span>${a.id === no.id ? "<span>este</span>" : `<button class="btn btn-mini" data-acao="selecionarNo" data-id="${esc(a.id)}">Ver</button>`}</div>`).join("")}
                        </div>
                        <button class="btn btn-mini" data-acao="novoAcesso">+ Outro acesso</button>
                        <p class="editor-texto suave">Mais de um acesso (dos dois lados da máquina, ou um em cada faixa): a missão vai para a estação e o AGV escolhe o acesso de caminho mais curto.</p>
                        ${(planta.estacoes || []).length > 1 ? campoSelect("Este ponto é acesso de", "noEstacao", estacao.id, planta.estacoes.map(e => [e.id, e.nome ? `${e.id} · ${e.nome}` : e.id])) : ""}
                    </div>` : ""}
                ${campo(no.tipo === "ESTACAO" ? "Nome do acesso" : "Nome", "noNome", no.nome, `placeholder="${no.tipo === "ESTACAO" ? "Ex.: Norte (opcional)" : "Ex.: Cruzamento 3"}"`)}
                <div class="editor-linha">
                    ${campoNumero("X", "noX", no.x, 0.01, "m")}
                    ${campoNumero("Y", "noY", no.y, 0.01, "m")}
                </div>
                ${campo("Tag RFID no centro", "noRfid", no.rfid, 'placeholder="ex.: 0A0000001C" maxlength="14" spellcheck="false" title="10 caracteres hexadecimais, como o AGV lê"')}
                ${rfids.length ? `<div class="editor-rfids">${rfids.map(r => `<button class="btn btn-mini" data-acao="usarRfid" data-rfid="${esc(r.codigo)}" title="Último lido pelo AGV ${esc(r.agv)}">${esc(r.codigo)} <em>AGV ${esc(r.agv)}</em></button>`).join("")}</div>` : ""}
                ${no.tipo === "ESTACAO" ? `
                    <div class="editor-bloco">
                        <span class="editor-subtitulo">Orientação de chegada</span>
                        <p class="editor-texto suave">Para onde a frente do AGV aponta quando ele para na estação.</p>
                        <div class="editor-orientacao">
                            ${[[90, "↑"], [0, "→"], [270, "↓"], [180, "←"]].map(([a, s]) => `<button class="btn ${no.orientacaoChegada === a ? "ativo" : ""}" data-acao="orientacao" data-valor="${a}">${s} ${a}°</button>`).join("")}
                            <input type="number" step="1" min="0" max="359" data-campo="noOrientacao" value="${no.orientacaoChegada ?? ""}">
                        </div>
                    </div>` : ""}
                ${campoNumero("Barreira neste ponto", "noBarreira", no.barreira || "", 10, "mm", 'min="0" placeholder="padrão do AGV"')}
                <p class="editor-texto suave">Use quando o AGV para de frente para uma máquina (ex.: 300 mm). Mínimo ${Planta.LIMITES.barreiraMinima} mm.</p>
                <p class="editor-texto suave">${ligados} segmento(s) ligado(s).</p>
                <div class="editor-acoes"><button class="btn btn-mini btn-perigo" data-acao="excluir">Excluir ponto</button></div>`;
            return;
        }

        if (sel.tipo === "segmento") {
            const s = Planta.segmentoPorId(planta, sel.id);
            const a = Planta.noPorId(planta, s.a), b = Planta.noPorId(planta, s.b);
            const L = Planta.comprimentoSegmento(planta, s);
            const lateral = Planta.tipoSegmento(s) === "LATERAL";
            const gemeo = Planta.segmentoGemeo(planta, s);
            const ang = Planta.anguloExato(a, b);
            const resto = ((ang % 45) + 45) % 45;
            const desvio = Math.min(resto, 45 - resto);
            const faixa = estado.ultimaFaixa && estado.ultimaFaixa.nova === s.id ? estado.ultimaFaixa : null;
            titulo.textContent = lateral ? `Troca lateral ${s.id}` : `Linha ${s.id}`;
            const vZona = Planta.velocidadeSegmento(planta, s);
            if (lateral) {
                const sugestao = Planta.sugestaoTrocaFaixa(L);
                painel.innerHTML = `
                    <p class="editor-texto"><strong>${esc(s.a)} ↔ ${esc(s.b)}</strong> · ${Planta.arred(L, 3)} m · ${Planta.anguloEntre(a, b)}°</p>
                    <p class="editor-texto suave">O AGV anda de lado entre as duas faixas, sem fita e sem girar, e encontra a outra linha pelo QTR (ou pela tag do ponto de chegada). Os sensores de distância não olham para o lado: o trecho é feito devagar.</p>
                    ${campoSelect("Sentido", "segSentido", s.sentido, [["DUPLO", "Nos dois sentidos"], ["A_PARA_B", `Só ${s.a} → ${s.b}`], ["B_PARA_A", `Só ${s.b} → ${s.a}`]])}
                    ${sugestao && sugestao.tipo !== "LATERAL" ? `<div class="editor-aviso">${esc(sugestao.texto)}</div>` : ""}
                    ${!Planta.lateralPerpendicular(planta, s) ? `<div class="editor-aviso">A troca lateral deve cruzar as duas faixas em 90°. Mova um dos pontos para ficar em frente ao outro.</div>` : ""}
                    <div class="editor-acoes"><button class="btn btn-mini btn-perigo" data-acao="excluir">Excluir troca lateral</button></div>`;
                return;
            }
            painel.innerHTML = `
                <p class="editor-texto"><strong>${esc(s.a)} → ${esc(s.b)}</strong> · ${Planta.arred(L, 3)} m · ${Planta.arred(ang, 1)}°</p>
                ${faixa ? `
                    <div class="editor-bloco destaque">
                        <span class="editor-subtitulo">Faixa paralela criada</span>
                        <p class="editor-texto">${esc(faixa.sugestao?.texto || "")}</p>
                        <div class="editor-acoes">
                            <button class="btn btn-mini ${faixa.sugestao?.tipo === "LATERAL" ? "btn-primario" : ""}" data-acao="ligarPontas" data-tipo="LATERAL">Ligar as pontas: troca lateral</button>
                            <button class="btn btn-mini ${faixa.sugestao?.tipo === "LINHA" ? "btn-primario" : ""}" data-acao="ligarPontas" data-tipo="LINHA">Ligar as pontas: retorno com fita</button>
                            <button class="btn btn-mini" data-acao="esquecerFaixa">Não ligar agora</button>
                        </div>
                    </div>` : ""}
                ${desvio > 0.05 && desvio < 5 ? `<div class="editor-aviso">Está a ${Planta.arred(desvio, 1)}° de ${Math.round(ang / 45) * 45 % 360}°: o AGV faria um giro pequeno à toa. <button class="btn btn-mini" data-acao="alinhar" data-id="${esc(s.id)}">Alinhar</button></div>` : ""}
                ${campoSelect("Sentido", "segSentido", s.sentido, [["DUPLO", "Mão dupla"], ["A_PARA_B", `Só ${s.a} → ${s.b}`], ["B_PARA_A", `Só ${s.b} → ${s.a}`]])}
                ${gemeo ? `<p class="editor-texto suave">Tem o sentido contrário em <a href="#" data-acao="selecionarSegmento" data-id="${esc(gemeo.id)}">${esc(gemeo.id)}</a> (mesma fita, com tags e velocidade próprias).</p>` : ""}
                <div class="editor-linha">
                    ${campoNumero("Velocidade máx.", "segVelocidade", s.velocidadeMaxima || "", 0.005, "m/s", `min="0" max="${Planta.LIMITES.velocidadeMaxima}" placeholder="padrão"`)}
                    ${campoNumero("Barreira", "segBarreira", s.barreira || "", 10, "mm", 'min="0" placeholder="padrão"')}
                </div>
                ${vZona && vZona !== s.velocidadeMaxima ? `<p class="editor-texto suave">Limitado a ${vZona} m/s por zona lenta.</p>` : ""}
                <div class="editor-bloco">
                    <span class="editor-subtitulo">Tags intermediárias (máx. ${Planta.LIMITES.checkpointsPorTrecho})</span>
                    <p class="editor-texto suave">Corrigem a odometria no meio do caminho. Distância medida a partir de ${esc(s.a)}.</p>
                    ${(s.tags || []).map((t, i) => `
                        <div class="editor-tag ${sel.tag === i ? "selecionada" : ""}" style="display:grid;grid-template-columns:1fr 110px 36px;gap:6px">
                            <input data-campo="tagRfid" data-indice="${i}" value="${esc(t.rfid)}" placeholder="ex.: 0A000000C1" maxlength="14" spellcheck="false" title="10 caracteres hexadecimais, como o AGV lê">
                            <div class="editor-com-unidade"><input type="number" step="0.01" min="0" max="${Planta.arred(L, 2)}" data-campo="tagDistancia" data-indice="${i}" value="${t.distancia}"><em>m</em></div>
                            <button class="btn btn-mini" data-acao="removerTag" data-indice="${i}" title="Remover tag" aria-label="Remover tag">✕</button>
                        </div>`).join("")}
                    <button class="btn btn-mini" data-acao="adicionarTag" ${(s.tags || []).length >= Planta.LIMITES.checkpointsPorTrecho ? "disabled" : ""}>+ Tag no meio</button>
                </div>
                <div class="editor-bloco">
                    <span class="editor-subtitulo">Dupla faixa</span>
                    <p class="editor-texto suave">Duas faixas paralelas de sentido único (ida e volta). A distância entre elas depende do espaço: até ${Planta.DISTANCIA_SUGESTAO_LATERAL} m o site sugere troca lateral; acima disso, retorno com fita.</p>
                    <div class="editor-linha">
                        ${campoNumero("Distância", "paralelaDistancia", estado.distanciaParalela ?? 0.5, 0.05, "m", `min="${Planta.LIMITES.lateralMinima}" id="editorDistanciaParalela"`)}
                        ${campoSelect("Lado", "paralelaLado", estado.ladoParalela ?? 1, [[1, `à esquerda de ${s.a}→${s.b}`], [-1, `à direita de ${s.a}→${s.b}`]])}
                    </div>
                    <div class="editor-acoes">
                        <button class="btn btn-mini" data-acao="criarParalela">Criar faixa paralela</button>
                        ${gemeo ? "" : `<button class="btn btn-mini" data-acao="criarGemeo" title="Segmento de sentido contrário sobre a mesma fita">+ Sentido contrário na mesma fita</button>`}
                    </div>
                </div>
                <div class="editor-acoes">
                    <button class="btn btn-mini" data-acao="inverterSegmento">Inverter A/B</button>
                    <button class="btn btn-mini btn-perigo" data-acao="excluir">Excluir linha</button>
                </div>`;
            return;
        }

        if (sel.tipo === "layout") {
            const o = planta.layout.find(x => x.id === sel.id);
            titulo.textContent = Planta.TIPOS_LAYOUT[o.tipo]?.nome || "Objeto";
            painel.innerHTML = `
                <div class="editor-linha">
                    ${campoSelect("Tipo", "objTipo", o.tipo, Object.entries(Planta.TIPOS_LAYOUT).map(([k, v]) => [k, v.nome]))}
                    ${campo("Nome", "objNome", o.nome || "", 'placeholder="Ex.: Prensa 3"')}
                </div>
                <div class="editor-linha">
                    ${campoNumero("Centro X", "objX", o.x, 0.01, "m")}
                    ${campoNumero("Centro Y", "objY", o.y, 0.01, "m")}
                </div>
                <div class="editor-linha">
                    ${campoNumero("Largura", "objLargura", o.largura, 0.05, "m", 'min="0.05"')}
                    ${campoNumero("Profundidade", "objProfundidade", o.profundidade, 0.05, "m", 'min="0.05"')}
                </div>
                <div class="editor-linha">
                    ${campoNumero("Rotação", "objRotacao", o.rotacao, 1, "°")}
                    <div class="editor-acoes compacto"><button class="btn btn-mini" data-acao="girarObjeto" data-valor="90">⟲ 90°</button><button class="btn btn-mini" data-acao="girarObjeto" data-valor="-90">⟳ 90°</button></div>
                </div>
                ${o.tipo === "ZONA_LENTA" ? campoNumero("Velocidade máx. na zona", "objVelocidade", o.velocidadeMaxima || "", 0.005, "m/s", `min="0" max="${Planta.LIMITES.velocidadeMaxima}"`) : ""}
                <p class="editor-texto suave">${Planta.TIPOS_LAYOUT[o.tipo]?.solido ? "Objeto sólido: as linhas não podem atravessá-lo e o AGV virtual o enxerga nos sensores de distância." : o.tipo === "ZONA_PROIBIDA" ? "Nenhuma linha pode passar por aqui." : o.tipo === "ZONA_LENTA" ? "Linhas que cruzam a zona ficam limitadas a esta velocidade." : "Apenas referência visual."}</p>
                <div class="editor-acoes">
                    <button class="btn btn-mini" data-acao="duplicarObjeto">Duplicar</button>
                    <button class="btn btn-mini btn-perigo" data-acao="excluir">Excluir</button>
                </div>`;
        }
    }

    function aoMudarCampo(evento) {
        if (somenteLeitura()) { renderizarPropriedades(); return; }
        const alvo = evento.target;
        const nome = alvo.dataset.campo;
        if (!nome) return;
        const valor = alvo.value;
        const num = Number(valor);
        const planta = p();
        const sel = estado.selecao;

        if (nome === "escalaReal") return;
        if (nome === "paralelaDistancia") { estado.distanciaParalela = num; return; }
        if (nome === "paralelaLado") { estado.ladoParalela = num; return; }
        registrarDesfazer();

        switch (nome) {
            case "plantaNome": planta.nome = valor; break;
            case "plantaLargura": if (num >= 1) planta.dimensoes.largura = num; break;
            case "plantaAltura": if (num >= 1) planta.dimensoes.altura = num; break;
            case "plantaGrade": if (num >= 0.05) planta.grade = num; break;
            case "fundoOpacidade": planta.fundo.opacidade = num; break;
            case "fundoX": planta.fundo.x = num; break;
            case "fundoY": planta.fundo.y = num; break;
            case "fundoLargura":
                if (num > 0) {
                    planta.fundo.altura = Planta.arred(planta.fundo.altura * num / planta.fundo.largura);
                    planta.fundo.largura = num;
                }
                break;
        }

        if (sel?.tipo === "no") {
            const no = Planta.noPorId(planta, sel.id);
            switch (nome) {
                case "noId": if (!renomearNo(no.id, valor)) { estado.desfazer.pop(); renderizarPropriedades(); return; } break;
                case "noTipo":
                    no.tipo = valor;
                    if (valor === "ESTACAO" && (no.orientacaoChegada === null || no.orientacaoChegada === undefined)) no.orientacaoChegada = 90;
                    if (valor === "ESTACAO") tornarEstacao(no);
                    if (valor !== "ESTACAO") {
                        no.orientacaoChegada = null;
                        delete no.estacao;
                        limparEstacoesVazias();
                    }
                    break;
                case "estacaoId": if (!renomearEstacao(no.estacao, valor)) { estado.desfazer.pop(); renderizarPropriedades(); return; } break;
                case "estacaoNome": { const e = Planta.estacaoPorId(planta, no.estacao); if (e) e.nome = valor.trim(); break; }
                case "estacaoMaquina": { const e = Planta.estacaoPorId(planta, no.estacao); if (e) { if (valor) e.maquina = valor; else delete e.maquina; } break; }
                case "noEstacao":
                    if (Planta.estacaoPorId(planta, valor)) { no.estacao = valor; limparEstacoesVazias(); }
                    break;
                case "noNome": no.nome = valor.trim(); break;
                case "noX": no.x = num; break;
                case "noY": no.y = num; break;
                case "noRfid": no.rfid = Planta.normalizarRfid(valor); break;
                case "noOrientacao": no.orientacaoChegada = valor === "" ? null : Planta.normalizarAngulo(num); break;
                case "noBarreira": no.barreira = Math.max(0, Math.round(num) || 0); break;
            }
        }
        if (sel?.tipo === "segmento") {
            const s = Planta.segmentoPorId(planta, sel.id);
            const i = Number(alvo.dataset.indice);
            switch (nome) {
                case "segSentido": s.sentido = valor; break;
                case "segVelocidade": s.velocidadeMaxima = Math.max(0, Math.min(Planta.LIMITES.velocidadeMaxima, num || 0)); break;
                case "segBarreira": s.barreira = Math.max(0, Math.round(num) || 0); break;
                case "tagRfid": s.tags[i].rfid = Planta.normalizarRfid(valor); break;
                case "tagDistancia": s.tags[i].distancia = Planta.arred(Math.max(0, num || 0)); break;
            }
        }
        if (sel?.tipo === "layout") {
            const o = planta.layout.find(x => x.id === sel.id);
            switch (nome) {
                case "objTipo": o.tipo = valor; break;
                case "objNome": o.nome = valor.trim(); break;
                case "objX": o.x = num; break;
                case "objY": o.y = num; break;
                case "objLargura": if (num > 0) o.largura = num; break;
                case "objProfundidade": if (num > 0) o.profundidade = num; break;
                case "objRotacao": o.rotacao = ((num % 360) + 360) % 360; break;
                case "objVelocidade": o.velocidadeMaxima = Math.max(0, Math.min(Planta.LIMITES.velocidadeMaxima, num || 0)); break;
            }
        }
        alterado();
    }

    function aoClicarPainel(evento) {
        const botao = evento.target.closest("[data-acao]");
        if (!botao) return;
        const acao = botao.dataset.acao;
        if (somenteLeitura() && acao !== "selecionarNo") return;
        const planta = p();
        const sel = estado.selecao;

        switch (acao) {
            case "excluir": excluirSelecao(); return;
            case "selecionarNo": estado.selecao = { tipo: "no", id: botao.dataset.id }; desenharMapa(); renderizarPropriedades(); return;
            case "selecionarSegmento": evento.preventDefault(); estado.selecao = { tipo: "segmento", id: botao.dataset.id }; desenharMapa(); renderizarPropriedades(); return;
            case "novoAcesso": {
                const no = Planta.noPorId(planta, sel.id);
                estado.novoAcessoDe = no.estacao;
                selecionarFerramenta("ESTACAO");
                return;
            }
            case "alinhar": {
                registrarDesfazer();
                const seg = Planta.segmentoPorId(planta, botao.dataset.id);
                // move o ponto com menos ligações
                const grau = id => planta.segmentos.filter(x => x.a === id || x.b === id).length;
                Planta.alinharSegmento(planta, seg.id, grau(seg.a) < grau(seg.b) ? seg.a : seg.b);
                alterado();
                return;
            }
            case "criarParalela": {
                const seg = Planta.segmentoPorId(planta, sel.id);
                const distancia = Number(document.getElementById("editorDistanciaParalela")?.value) || 0.5;
                const lado = Number(estado.ladoParalela ?? 1) || 1;
                registrarDesfazer();
                const r = Planta.criarFaixaParalela(planta, seg.id, distancia, lado);
                if (!r.sucesso) { estado.desfazer.pop(); ui.aviso(r.erro, "aviso"); return; }
                const [a2, b2] = r.pontos;
                estado.ultimaFaixa = { origem: seg.id, nova: r.segmento.id, pares: [[seg.a, a2.id], [seg.b, b2.id]], sugestao: r.sugestao };
                estado.selecao = { tipo: "segmento", id: r.segmento.id };
                alterado();
                return;
            }
            case "ligarPontas": {
                const f = estado.ultimaFaixa;
                if (!f) return;
                registrarDesfazer();
                const tipo = botao.dataset.tipo;
                const criados = [];
                f.pares.forEach(([x, y]) => {
                    const r = Planta.ligarFaixas(planta, x, y, tipo);
                    if (r.sucesso) criados.push(r.segmento.id);
                });
                estado.ultimaFaixa = null;
                ui.aviso(`${criados.length} ligação(ões) ${tipo === "LATERAL" ? "de troca lateral" : "com fita"} criada(s): ${criados.join(", ")}.`, "sucesso");
                alterado();
                return;
            }
            case "esquecerFaixa": estado.ultimaFaixa = null; renderizarPropriedades(); return;
            case "criarGemeo": {
                const seg = Planta.segmentoPorId(planta, sel.id);
                registrarDesfazer();
                if (seg.sentido === "DUPLO") seg.sentido = "A_PARA_B";
                const gemeo = {
                    id: Planta.proximoId(planta.segmentos, "S"), tipo: "LINHA", a: seg.a, b: seg.b,
                    sentido: seg.sentido === "A_PARA_B" ? "B_PARA_A" : "A_PARA_B",
                    velocidadeMaxima: seg.velocidadeMaxima, barreira: seg.barreira, tags: []
                };
                planta.segmentos.push(gemeo);
                estado.selecao = { tipo: "segmento", id: gemeo.id };
                ui.aviso(`${gemeo.id} criado no sentido contrário de ${seg.id}. Use quando a ida e a volta precisam de tags ou velocidades diferentes.`, "info");
                alterado();
                return;
            }
            case "escolherImagem": document.getElementById("editorArquivoImagem")?.click(); return;
            case "ferramentaEscala": selecionarFerramenta("ESCALA"); return;
            case "cancelarEscala": selecionarFerramenta("SELECIONAR"); return;
            case "aplicarEscala": {
                const [a, b] = estado.escala;
                const real = Number(document.getElementById("editorEscalaReal")?.value);
                const medido = Math.hypot(b.x - a.x, b.y - a.y);
                if (!(real > 0) || !(medido > 0)) return;
                registrarDesfazer();
                escalarTudo(real / medido, a);
                selecionarFerramenta("SELECIONAR");
                estado.mapa.ajustar();
                alterado();
                return;
            }
            case "areaDaImagem":
                registrarDesfazer();
                planta.dimensoes.largura = Planta.arred(planta.fundo.x + planta.fundo.largura, 2);
                planta.dimensoes.altura = Planta.arred(planta.fundo.y + planta.fundo.altura, 2);
                estado.mapa.ajustar();
                alterado();
                return;
            case "removerFundo":
                ui.confirmar({ titulo: "Remover a imagem de fundo?", texto: "Os pontos, linhas e objetos continuam onde estão.", confirmar: "Remover", perigo: true }).then(ok => {
                    if (!ok) return;
                    registrarDesfazer();
                    p().fundo = null;
                    alterado();
                });
                return;
            case "descartarRascunho":
                ui.confirmar({ titulo: "Descartar as alterações?", texto: "O rascunho volta a ser igual à planta publicada.", confirmar: "Descartar", perigo: true }).then(ok => {
                    if (!ok) return;
                    registrarDesfazer();
                    estado.rascunho = Planta.clonar(estado.publicada);
                    estado.selecao = null;
                    alterado();
                });
                return;
            case "plantaVazia":
                ui.confirmar({ titulo: "Começar uma planta vazia?", texto: "A planta publicada continua em uso até você publicar a nova.", confirmar: "Começar do zero", perigo: true }).then(ok => {
                    if (!ok) return;
                    registrarDesfazer();
                    estado.rascunho = Planta.criarVazia();
                    estado.rascunho.revisao = estado.publicada.revisao;
                    estado.selecao = null;
                    estado.mapa.ajustar();
                    alterado();
                });
                return;
            case "plantaExemplo":
                ui.confirmar({ titulo: "Carregar a planta de exemplo?", texto: "O rascunho atual é trocado pelo galpão de exemplo. A planta publicada continua em uso até você publicar.", confirmar: "Carregar exemplo" }).then(ok => {
                    if (!ok) return;
                    registrarDesfazer();
                    estado.rascunho = PlantaExemplo.planta();
                    estado.rascunho.revisao = estado.publicada.revisao;
                    estado.selecao = null;
                    estado.mapa.ajustar();
                    alterado();
                    if (estado.ganchos.aoCarregarExemplo) estado.ganchos.aoCarregarExemplo();
                });
                return;
            case "usarRfid": {
                const no = Planta.noPorId(planta, sel.id);
                registrarDesfazer();
                no.rfid = Planta.normalizarRfid(botao.dataset.rfid);
                alterado();
                return;
            }
            case "orientacao": {
                const no = Planta.noPorId(planta, sel.id);
                registrarDesfazer();
                no.orientacaoChegada = Number(botao.dataset.valor);
                alterado();
                return;
            }
            case "adicionarTag": {
                const s = Planta.segmentoPorId(planta, sel.id);
                registrarDesfazer();
                s.tags.push({ rfid: "", distancia: Planta.arred(Planta.comprimentoSegmento(planta, s) / 2, 2) });
                estado.selecao = { tipo: "segmento", id: s.id, tag: s.tags.length - 1 };
                alterado();
                return;
            }
            case "removerTag": {
                const s = Planta.segmentoPorId(planta, sel.id);
                registrarDesfazer();
                s.tags.splice(Number(botao.dataset.indice), 1);
                estado.selecao = { tipo: "segmento", id: s.id };
                alterado();
                return;
            }
            case "inverterSegmento": {
                const s = Planta.segmentoPorId(planta, sel.id);
                registrarDesfazer();
                const L = Planta.comprimentoSegmento(planta, s);
                [s.a, s.b] = [s.b, s.a];
                s.tags.forEach(t => { t.distancia = Planta.arred(L - t.distancia); });
                if (s.sentido === "A_PARA_B") s.sentido = "B_PARA_A";
                else if (s.sentido === "B_PARA_A") s.sentido = "A_PARA_B";
                alterado();
                return;
            }
            case "girarObjeto": {
                const o = planta.layout.find(x => x.id === sel.id);
                registrarDesfazer();
                o.rotacao = (((o.rotacao + Number(botao.dataset.valor)) % 360) + 360) % 360;
                alterado();
                return;
            }
            case "duplicarObjeto": {
                const o = planta.layout.find(x => x.id === sel.id);
                registrarDesfazer();
                const copia = Object.assign({}, o, { id: Planta.proximoId(planta.layout, "L"), x: Planta.arred(o.x + planta.grade), y: Planta.arred(o.y - planta.grade) });
                planta.layout.push(copia);
                estado.selecao = { tipo: "layout", id: copia.id };
                alterado();
                return;
            }
        }
    }


    /* ========================================================
       VALIDACAO
       ======================================================== */

    function renderizarValidacao() {
        const lista = document.getElementById("editorValidacao");
        const resumo = document.getElementById("editorValidacaoResumo");
        if (!lista) return;
        const { erros, avisos } = estado.validacao;
        if (resumo) {
            resumo.textContent = erros.length ? `${erros.length} erro(s)` : avisos.length ? `${avisos.length} aviso(s)` : "Tudo certo";
            resumo.className = `pilula ${erros.length ? "vermelho" : avisos.length ? "ambar" : "verde"}`;
        }
        if (!erros.length && !avisos.length) {
            lista.innerHTML = `<p class="editor-texto suave">Nenhum problema encontrado.</p>`;
            return;
        }
        const alinhaveis = avisos.filter(a => a.alinhar);
        lista.innerHTML = (alinhaveis.length > 1 ? `<button class="btn btn-mini" data-alinhar-todos="1">Alinhar as ${alinhaveis.length} linhas tortas</button>` : "") +
            erros.map(e => `<div class="editor-problema erro" role="button" tabindex="0" data-alvo="${esc(e.alvo)}">${esc(e.msg)}</div>`).join("") +
            avisos.map(a => `<div class="editor-problema aviso" role="button" tabindex="0" data-alvo="${esc(a.alvo)}"><span>${esc(a.msg)}</span>${a.alinhar ? `<button class="btn btn-mini" data-alinhar="${esc(a.alvo)}">Alinhar</button>` : ""}</div>`).join("");
    }

    function alinharSegmentos(ids) {
        const planta = p();
        registrarDesfazer();
        const grau = id => planta.segmentos.filter(x => x.a === id || x.b === id).length;
        ids.forEach(id => {
            const seg = Planta.segmentoPorId(planta, id);
            if (seg) Planta.alinharSegmento(planta, seg.id, grau(seg.a) < grau(seg.b) ? seg.a : seg.b);
        });
        alterado();
    }

    function focarAlvo(id) {
        const planta = p();
        const estacao = Planta.estacaoPorId(planta, id);
        if (estacao && !Planta.noPorId(planta, id)) {
            const acesso = Planta.acessosDaEstacao(planta, id)[0];
            if (acesso) id = acesso.id;
        }
        if (Planta.noPorId(planta, id)) estado.selecao = { tipo: "no", id };
        else if (Planta.segmentoPorId(planta, id)) estado.selecao = { tipo: "segmento", id };
        else if (planta.layout.find(o => o.id === id)) estado.selecao = { tipo: "layout", id };
        else return;
        selecionarFerramenta("SELECIONAR");
    }


    /* ========================================================
       PUBLICAR, IMPORTAR, EXPORTAR, IMAGEM
       ======================================================== */

    async function publicar() {
        if (typeof Nuvem !== "undefined" && !Nuvem.exigir("administrar", "publicar a planta")) return;
        estado.validacao = Planta.validar(p());
        renderizarValidacao();
        desenharMapa();
        if (!estado.validacao.valida) {
            ui.aviso(`A planta tem ${estado.validacao.erros.length} erro(s). Corrija antes de publicar (veja o painel Validação).`, "erro");
            return;
        }
        if (!semPublicar()) {
            ui.aviso("Não há alterações para publicar.", "info");
            return;
        }
        const avisos = estado.validacao.avisos.length ? `\n\n${estado.validacao.avisos.length} aviso(s) na validação (não impedem).` : "";
        if (!(await ui.confirmar({
            titulo: `Publicar a revisão ${(estado.publicada.revisao || 0) + 1}?`,
            texto: "As próximas missões usam a planta nova. Missões já carregadas nos AGVs continuam com a revisão anterior." + avisos,
            confirmar: "Publicar"
        }))) {
            return;
        }
        const nova = Planta.clonar(p());
        nova.revisao = (estado.publicada.revisao || 0) + 1;
        estado.publicada = nova;
        estado.rascunho.revisao = nova.revisao;
        estado.avisosMigracao = [];
        salvarAgora();
        atualizarStatus();
        renderizarPropriedades();
        if (estado.ganchos.aoPublicar) estado.ganchos.aoPublicar(estado.publicada);
        ui.aviso(`Planta publicada: revisão ${estado.publicada.revisao}.`, "sucesso");
    }

    function exportar() {
        const planta = p();
        const texto = JSON.stringify(planta, null, 2);
        const blob = new Blob([texto], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        const nome = (planta.nome || "planta").normalize("NFD").replace(/[^\w-]+/g, "_");
        a.href = url;
        a.download = `${nome}-rev${planta.revisao || 0}.json`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    function importarTexto(texto) {
        let dados;
        try {
            dados = JSON.parse(texto);
        } catch (erro) {
            ui.aviso("Arquivo inválido: não é um JSON.", "erro");
            return;
        }
        let planta;
        if (dados && (dados.versao === 2 || dados.versao === 3) && Array.isArray(dados.nos)) {
            planta = Planta.normalizar(dados);
        } else if (dados && Array.isArray(dados.pontos)) {
            const m = Planta.migrarV1(dados);
            planta = m.planta;
            estado.avisosMigracao = m.avisos;
        } else {
            ui.aviso("Arquivo não reconhecido como planta.", "erro");
            return;
        }
        registrarDesfazer();
        planta.revisao = estado.publicada.revisao;
        estado.rascunho = planta;
        estado.selecao = null;
        estado.mapa.ajustar();
        alterado();
    }

    function importarImagem(arquivo) {
        const leitor = new FileReader();
        leitor.onload = () => {
            const img = new Image();
            img.onload = () => {
                const maximo = 2000;
                const f = Math.min(1, maximo / Math.max(img.width, img.height));
                const canvas = document.createElement("canvas");
                canvas.width = Math.round(img.width * f);
                canvas.height = Math.round(img.height * f);
                const ctx = canvas.getContext("2d");
                ctx.fillStyle = "#ffffff";
                ctx.fillRect(0, 0, canvas.width, canvas.height);
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                const dados = canvas.toDataURL("image/jpeg", 0.78);
                registrarDesfazer();
                const planta = p();
                const largura = planta.dimensoes.largura;
                const altura = Planta.arred(largura * canvas.height / canvas.width);
                planta.fundo = { imagem: dados, x: 0, y: 0, largura, altura, opacidade: 0.55 };
                if (!planta.nos.length && !planta.layout.length) planta.dimensoes.altura = Math.max(1, Planta.arred(altura, 2));
                estado.mapa.ajustar();
                alterado();
                selecionarFerramenta("ESCALA");
                const dica = document.getElementById("editorDica");
                if (dica) dica.textContent = "Imagem importada. Agora clique em dois pontos de distância conhecida para acertar a escala.";
            };
            img.onerror = () => ui.aviso("Não foi possível abrir a imagem.", "erro");
            img.src = leitor.result;
        };
        leitor.readAsDataURL(arquivo);
    }


    /* ========================================================
       INTERACAO COM O MAPA
       ======================================================== */

    function alvoDoEvento(evento) {
        const elemento = evento.target.closest("[data-tipo]");
        if (!elemento) return null;
        return { tipo: elemento.dataset.tipo, id: elemento.dataset.id, indice: elemento.dataset.indice };
    }

    function pontoAjustado(evento) {
        const m = estado.mapa.paraMundo(evento);
        if (evento.altKey) return { x: Planta.arred(m.x), y: Planta.arred(m.y) };
        return { x: arredondarGrade(m.x), y: arredondarGrade(m.y) };
    }

    function aoPressionar(evento) {
        if (evento.button !== 0) return;
        const alvo = alvoDoEvento(evento);
        const ferramenta = somenteLeitura() ? "SELECIONAR" : estado.ferramenta;
        const planta = p();
        const mundo = estado.mapa.paraMundo(evento);

        if (ferramenta === "SELECIONAR") {
            if (!alvo) return;   // o mapa cuida do arraste da vista
            if (alvo.tipo === "no" || alvo.tipo === "layout") {
                const objeto = alvo.tipo === "no" ? Planta.noPorId(planta, alvo.id) : planta.layout.find(o => o.id === alvo.id);
                estado.selecao = { tipo: alvo.tipo, id: alvo.id };
                if (!somenteLeitura()) {
                    estado.arrasto = { objeto, dx: objeto.x - mundo.x, dy: objeto.y - mundo.y, registrado: false, x0: evento.clientX, y0: evento.clientY };
                    estado.mapa.svg.setPointerCapture(evento.pointerId);
                }
            } else if (alvo.tipo === "segmento") {
                estado.selecao = { tipo: "segmento", id: alvo.id };
            } else if (alvo.tipo === "tag") {
                estado.selecao = { tipo: "segmento", id: alvo.id, tag: Number(alvo.indice) };
            }
            desenharMapa();
            renderizarPropriedades();
            return;
        }

        if (ferramenta === "ESTACAO" || ferramenta === "REFERENCIA" || ferramenta === "ESPERA") {
            const acessoDe = ferramenta === "ESTACAO" ? estado.novoAcessoDe : null;
            if (alvo?.tipo === "no") {
                const existente = Planta.noPorId(planta, alvo.id);
                if (acessoDe && existente && existente.tipo !== "ESTACAO") {
                    // transforma o ponto clicado em acesso da estação
                    registrarDesfazer();
                    existente.tipo = "ESTACAO";
                    existente.estacao = acessoDe;
                    existente.orientacaoChegada = Planta.acessosDaEstacao(planta, acessoDe)[0]?.orientacaoChegada ?? 90;
                    estado.novoAcessoDe = null;
                    selecionarFerramenta("SELECIONAR");
                }
                estado.selecao = { tipo: "no", id: alvo.id };
            } else {
                registrarDesfazer();
                let no = null;
                if (alvo?.tipo === "segmento") no = dividirSegmento(Planta.segmentoPorId(planta, alvo.id), mundo, ferramenta, acessoDe || undefined);
                if (!no) {
                    const pt = pontoAjustado(evento);
                    no = criarNo(ferramenta, pt.x, pt.y, acessoDe || undefined);
                }
                if (acessoDe) {
                    estado.novoAcessoDe = null;
                    selecionarFerramenta("SELECIONAR");
                    ui.aviso(`Acesso ${no.id} criado para a estação ${acessoDe}. Ajuste a orientação de chegada dele.`, "sucesso");
                }
                estado.selecao = { tipo: "no", id: no.id };
            }
            alterado();
            return;
        }

        if (ferramenta === "LATERAL") {
            if (alvo?.tipo !== "no") {
                ui.aviso("Clique num ponto que já existe (de preferência um cruzamento da faixa).", "aviso");
                return;
            }
            if (!estado.inicioLateral || estado.inicioLateral === alvo.id) {
                estado.inicioLateral = alvo.id;
                desenharMapa();
                return;
            }
            const a = Planta.noPorId(planta, estado.inicioLateral), b = Planta.noPorId(planta, alvo.id);
            const distancia = Math.hypot(b.x - a.x, b.y - a.y);
            if (distancia < Planta.LIMITES.lateralMinima || distancia > Planta.LIMITES.lateralMaxima) {
                ui.aviso(`A troca lateral precisa de ${Planta.LIMITES.lateralMinima} a ${Planta.LIMITES.lateralMaxima} m entre os pontos (aqui são ${Planta.arred(distancia, 2)} m). Para faixas mais afastadas, use um retorno com fita.`, "aviso");
                estado.inicioLateral = null;
                desenharMapa();
                return;
            }
            registrarDesfazer();
            const r = Planta.ligarFaixas(planta, a.id, b.id, "LATERAL");
            estado.inicioLateral = null;
            if (r.sucesso) {
                estado.selecao = { tipo: "segmento", id: r.segmento.id };
                const sugestao = Planta.sugestaoTrocaFaixa(distancia);
                if (sugestao && sugestao.tipo === "LINHA") ui.aviso(sugestao.texto, "aviso");
            }
            alterado();
            return;
        }

        if (ferramenta === "SEGMENTO") {
            let no = null;
            let mudou = false;
            registrarDesfazer();
            if (alvo?.tipo === "no") {
                no = Planta.noPorId(planta, alvo.id);
            } else {
                if (alvo?.tipo === "segmento") no = dividirSegmento(Planta.segmentoPorId(planta, alvo.id), mundo, "REFERENCIA");
                if (!no) {
                    const pt = pontoAjustado(evento);
                    no = criarNo("REFERENCIA", pt.x, pt.y);
                }
                mudou = true;
            }
            if (estado.inicioSegmento && estado.inicioSegmento !== no.id) {
                const s = criarSegmento(estado.inicioSegmento, no.id);
                if (s) {
                    estado.selecao = { tipo: "segmento", id: s.id };
                    mudou = true;
                }
            }
            if (!mudou) estado.desfazer.pop();
            estado.inicioSegmento = no.id;
            alterado();
            return;
        }

        if (ferramenta === "TAG") {
            if (alvo?.tipo !== "segmento" && alvo?.tipo !== "tag") return;
            const s = Planta.segmentoPorId(planta, alvo.id);
            if ((s.tags || []).length >= Planta.LIMITES.checkpointsPorTrecho) {
                ui.aviso(`O segmento ${s.id} já tem ${Planta.LIMITES.checkpointsPorTrecho} tags intermediárias.`, "aviso");
                return;
            }
            registrarDesfazer();
            const proj = projetar(s, mundo);
            s.tags.push({ rfid: "", distancia: Planta.arred(Math.round(proj.distancia * 100) / 100, 2) });
            s.tags.sort((x, y) => x.distancia - y.distancia);
            estado.selecao = { tipo: "segmento", id: s.id, tag: s.tags.findIndex(t => t.rfid === "") };
            alterado();
            setTimeout(() => document.querySelector(`#editorPropriedades [data-campo="tagRfid"][data-indice="${estado.selecao.tag}"]`)?.focus(), 30);
            return;
        }

        if (ferramenta === "OBJETO") {
            const pt = pontoAjustado(evento);
            estado.retangulo = { x0: pt.x, y0: pt.y, x1: pt.x, y1: pt.y };
            estado.mapa.svg.setPointerCapture(evento.pointerId);
            return;
        }

        if (ferramenta === "ESCALA") {
            const pt = { x: Planta.arred(mundo.x), y: Planta.arred(mundo.y) };
            if (estado.escala.length >= 2) estado.escala = [];
            estado.escala.push(pt);
            desenharMapa();
            renderizarPropriedades();
            if (estado.escala.length === 2) setTimeout(() => document.getElementById("editorEscalaReal")?.select(), 30);
        }
    }

    function aoMover(evento) {
        const mundo = estado.mapa.paraMundo(evento);
        estado.ponteiro = mundo;
        const coord = document.getElementById("editorCoord");
        if (coord) coord.textContent = `x ${Planta.arred(mundo.x, 2).toFixed(2)} m · y ${Planta.arred(mundo.y, 2).toFixed(2)} m`;

        if (estado.arrasto) {
            const a = estado.arrasto;
            if (!a.registrado) {
                if (Math.abs(evento.clientX - a.x0) + Math.abs(evento.clientY - a.y0) < 4) return;
                registrarDesfazer();
                a.registrado = true;
            }
            const x = mundo.x + a.dx, y = mundo.y + a.dy;
            a.objeto.x = evento.altKey ? Planta.arred(x) : arredondarGrade(x);
            a.objeto.y = evento.altKey ? Planta.arred(y) : arredondarGrade(y);
            desenharMapa();
            return;
        }
        if (estado.retangulo) {
            const pt = pontoAjustado(evento);
            estado.retangulo.x1 = pt.x;
            estado.retangulo.y1 = pt.y;
            desenharMapa();
            return;
        }
        if (estado.ferramenta === "SEGMENTO" && estado.inicioSegmento) desenharMapa();
        if (estado.ferramenta === "LATERAL" && estado.inicioLateral) desenharMapa();
        if (estado.ferramenta === "ESCALA" && estado.escala.length === 1) desenharMapa();
    }

    function aoSoltar(evento) {
        if (estado.arrasto) {
            const moveu = estado.arrasto.registrado;
            estado.arrasto = null;
            try { estado.mapa.svg.releasePointerCapture(evento.pointerId); } catch (e) { /* ignora */ }
            if (moveu) alterado();
            return;
        }
        if (estado.retangulo) {
            const r = estado.retangulo;
            estado.retangulo = null;
            try { estado.mapa.svg.releasePointerCapture(evento.pointerId); } catch (e) { /* ignora */ }
            const tipo = estado.tipoObjeto;
            const padrao = Planta.TIPOS_LAYOUT[tipo];
            let largura = Math.abs(r.x1 - r.x0), profundidade = Math.abs(r.y1 - r.y0);
            let cx = (r.x0 + r.x1) / 2, cy = (r.y0 + r.y1) / 2;
            if (largura < 0.1 || profundidade < 0.1) {
                largura = padrao.largura;
                profundidade = padrao.profundidade;
                cx = r.x0;
                cy = r.y0;
            }
            registrarDesfazer();
            const o = {
                id: Planta.proximoId(p().layout, "L"), tipo, nome: "",
                x: Planta.arred(cx), y: Planta.arred(cy), largura: Planta.arred(largura), profundidade: Planta.arred(profundidade), rotacao: 0
            };
            if (tipo === "ZONA_LENTA") o.velocidadeMaxima = 0.04;
            p().layout.push(o);
            estado.selecao = { tipo: "layout", id: o.id };
            alterado();
            return;
        }
        // clique no vazio com a selecao: limpa a selecao (se nao foi arraste da vista)
        if (estado.ferramenta === "SELECIONAR" && !alvoDoEvento(evento) && !estado.mapa.ultimoArrasteMoveu && estado.selecao) {
            estado.selecao = null;
            desenharMapa();
            renderizarPropriedades();
        }
        estado.mapa.ultimoArrasteMoveu = false;
    }

    // Desenhos temporarios: linha em construcao, retangulo, medida de escala
    function sobreposicao(mapa, grupo, { Y, px, tema }) {
        const el = MapaSVG.el;
        const pt = estado.ponteiro;
        const cor = tema ? tema.accent : "#1E63C7";
        const corEscala = tema ? tema.tag : "#E09A1A";
        if (estado.ferramenta === "LATERAL" && estado.inicioLateral && pt) {
            const a = Planta.noPorId(p(), estado.inicioLateral);
            if (a) {
                el("line", { x1: a.x, y1: Y(a.y), x2: pt.x, y2: Y(pt.y), stroke: cor, "stroke-width": 2.5, "stroke-dasharray": "2 6", "stroke-linecap": "round", "vector-effect": "non-scaling-stroke", "pointer-events": "none" }, grupo);
                const L = Math.hypot(pt.x - a.x, pt.y - a.y);
                MapaSVG.pilula(grupo, (a.x + pt.x) / 2, Y((a.y + pt.y) / 2) - px(14), `lateral ${Planta.arred(L, 2)} m`, px, { fundo: tema?.accentSoft || "#E5EEFB", cor, tamanho: 10.5, altura: 18 });
            }
        }
        if (estado.ferramenta === "SEGMENTO" && estado.inicioSegmento && pt) {
            const a = Planta.noPorId(p(), estado.inicioSegmento);
            if (a) {
                el("line", { x1: a.x, y1: Y(a.y), x2: pt.x, y2: Y(pt.y), stroke: cor, "stroke-width": 2, "stroke-dasharray": "6 5", "vector-effect": "non-scaling-stroke", "pointer-events": "none" }, grupo);
                const L = Math.hypot(pt.x - a.x, pt.y - a.y);
                const t = el("text", { x: (a.x + pt.x) / 2, y: Y((a.y + pt.y) / 2) - px(10), "font-size": px(11), fill: cor, "text-anchor": "middle", "pointer-events": "none", "font-family": "IBM Plex Mono, monospace" }, grupo);
                t.textContent = `${Planta.arred(L, 2)} m · ${Planta.anguloEntre(a, pt)}°`;
            }
        }
        if (estado.retangulo) {
            const r = estado.retangulo;
            el("rect", { x: Math.min(r.x0, r.x1), y: Y(Math.max(r.y0, r.y1)), width: Math.abs(r.x1 - r.x0), height: Math.abs(r.y1 - r.y0), fill: tema ? tema.accentSoft : "rgba(30,99,199,.12)", "fill-opacity": 0.6, stroke: cor, "stroke-width": 1, "stroke-dasharray": "4 3", "vector-effect": "non-scaling-stroke", "pointer-events": "none" }, grupo);
        }
        if (estado.ferramenta === "ESCALA" && estado.escala.length) {
            const [a, b] = estado.escala;
            const fim = b || pt;
            [a, b].filter(Boolean).forEach(q => el("circle", { cx: q.x, cy: Y(q.y), r: px(5), fill: corEscala, "pointer-events": "none" }, grupo));
            if (fim) el("line", { x1: a.x, y1: Y(a.y), x2: fim.x, y2: Y(fim.y), stroke: corEscala, "stroke-width": 2, "vector-effect": "non-scaling-stroke", "pointer-events": "none" }, grupo);
        }
    }

    function aoTeclar(evento) {
        const tela = document.getElementById("controlePlanta");
        if (!tela || !tela.classList.contains("ativa")) return;
        if (somenteLeitura()) return;
        const emCampo = /INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName || "");
        if ((evento.ctrlKey || evento.metaKey) && evento.key.toLowerCase() === "z" && !emCampo) {
            evento.preventDefault();
            if (evento.shiftKey) refazerAcao(); else desfazer();
            return;
        }
        if ((evento.ctrlKey || evento.metaKey) && evento.key.toLowerCase() === "y" && !emCampo) {
            evento.preventDefault();
            refazerAcao();
            return;
        }
        if (emCampo || evento.ctrlKey || evento.metaKey || evento.altKey) return;
        if (evento.key === "Escape") {
            if (estado.inicioSegmento || estado.inicioLateral || estado.escala.length || estado.novoAcessoDe) {
                estado.inicioSegmento = null;
                estado.inicioLateral = null;
                estado.novoAcessoDe = null;
                estado.escala = [];
                desenharMapa();
                renderizarPropriedades();
            } else {
                selecionarFerramenta("SELECIONAR");
            }
            return;
        }
        if (evento.key === "Delete" || evento.key === "Backspace") {
            evento.preventDefault();
            excluirSelecao();
            return;
        }
        const ferramenta = Object.entries(FERRAMENTAS).find(([, f]) => f.tecla === evento.key.toLowerCase());
        if (ferramenta) selecionarFerramenta(ferramenta[0]);
    }


    /* ========================================================
       INICIO
       ======================================================== */

    function iniciar(ganchos = {}) {
        Object.assign(estado.ganchos, ganchos);
        carregar();
        estado.validacao = Planta.validar(estado.rascunho);
    }

    // Monta o mapa quando a tela aparece pela primeira vez
    function abrir() {
        const container = document.getElementById("editorMapa");
        if (!container) return;
        if (!estado.iniciado) {
            estado.iniciado = true;
            estado.mapa = MapaSVG.criar(container, { grade: true, editor: true, rastro: false });
            estado.mapa.ferramentaAtiva = () => estado.ferramenta;
            estado.mapa.sobreposicao = sobreposicao;
            estado.mapa.definirPlanta(p());
            const svg = estado.mapa.svg;
            svg.addEventListener("pointerdown", aoPressionar);
            svg.addEventListener("pointermove", aoMover);
            svg.addEventListener("pointerup", aoSoltar);
            svg.addEventListener("contextmenu", evento => {
                if (estado.inicioSegmento) {
                    evento.preventDefault();
                    estado.inicioSegmento = null;
                    desenharMapa();
                }
            });
            svg.addEventListener("dblclick", evento => {
                if (estado.ferramenta === "SEGMENTO") {
                    estado.inicioSegmento = null;
                    desenharMapa();
                }
                evento.preventDefault();
            });

            document.querySelectorAll("[data-ferramenta]").forEach(b => b.addEventListener("click", () => selecionarFerramenta(b.dataset.ferramenta)));
            document.getElementById("editorTipoObjeto")?.addEventListener("change", e => {
                estado.tipoObjeto = e.target.value;
                selecionarFerramenta("OBJETO");
            });
            document.getElementById("editorDesfazer")?.addEventListener("click", desfazer);
            document.getElementById("editorRefazer")?.addEventListener("click", refazerAcao);
            document.getElementById("editorAjustar")?.addEventListener("click", () => estado.mapa.ajustar());
            document.getElementById("editorZoomMais")?.addEventListener("click", () => estado.mapa.zoom(1 / 1.3));
            document.getElementById("editorZoomMenos")?.addEventListener("click", () => estado.mapa.zoom(1.3));
            document.getElementById("editorGrade")?.addEventListener("change", e => { estado.usarGrade = e.target.checked; });
            document.getElementById("editorPublicar")?.addEventListener("click", publicar);
            document.getElementById("editorExportar")?.addEventListener("click", exportar);
            document.getElementById("editorImportar")?.addEventListener("click", () => document.getElementById("editorArquivoJson")?.click());
            document.getElementById("editorImagem")?.addEventListener("click", () => document.getElementById("editorArquivoImagem")?.click());
            document.getElementById("editorArquivoJson")?.addEventListener("change", e => {
                const arquivo = e.target.files[0];
                if (arquivo) arquivo.text().then(importarTexto);
                e.target.value = "";
            });
            document.getElementById("editorArquivoImagem")?.addEventListener("change", e => {
                const arquivo = e.target.files[0];
                if (arquivo) importarImagem(arquivo);
                e.target.value = "";
            });
            const painel = document.getElementById("editorPropriedades");
            painel?.addEventListener("change", aoMudarCampo);
            painel?.addEventListener("click", aoClicarPainel);
            painel?.addEventListener("keydown", evento => {
                if (evento.key === "Enter" && evento.target.matches("input")) evento.target.blur();
            });
            document.getElementById("editorValidacao")?.addEventListener("click", evento => {
                const um = evento.target.closest("[data-alinhar]");
                if (um) { alinharSegmentos([um.dataset.alinhar]); return; }
                if (evento.target.closest("[data-alinhar-todos]")) {
                    alinharSegmentos(estado.validacao.avisos.filter(a => a.alinhar).map(a => a.alvo));
                    return;
                }
                const item = evento.target.closest("[data-alvo]");
                if (item) focarAlvo(item.dataset.alvo);
            });
            document.getElementById("editorValidacao")?.addEventListener("keydown", evento => {
                if (evento.key !== "Enter") return;
                const item = evento.target.closest("[data-alvo]");
                if (item) focarAlvo(item.dataset.alvo);
            });
            document.addEventListener("keydown", aoTeclar);
            selecionarFerramenta("SELECIONAR");
        } else {
            estado.mapa.definirPlanta(p());
        }
        renderizarPropriedades();
        renderizarValidacao();
        atualizarStatus();
        requestAnimationFrame(() => estado.mapa.ajustado ? desenharMapa() : estado.mapa.ajustar());
    }

    raiz.EditorPlanta = {
        iniciar,
        abrir,
        publicada: () => estado.publicada,
        rascunho: () => estado.rascunho,
        importarTexto,
        publicar,
        _estado: estado
    };
})(typeof window !== "undefined" ? window : globalThis);
