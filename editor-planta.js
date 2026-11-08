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
        BERCO:      { tecla: "b", dica: "Clique para criar um berço: a casa (e o carregador) de um ou mais AGVs. Coloque num ramal, fora do caminho. Os AGVs de cada berço são escolhidos em Frota › Rotina." },
        SEGMENTO:   { tecla: "s", dica: "Clique no ponto inicial e depois nos próximos para desenhar a linha. Clicar no vazio cria um ponto. Esc termina." },
        LATERAL:    { tecla: "l", dica: "Troca lateral: clique num ponto de uma faixa e depois no ponto em frente, na faixa paralela. O AGV anda de lado entre eles, sem fita." },
        TAG:        { tecla: "t", dica: "Clique sobre uma linha para colocar uma tag RFID intermediária." },
        OBJETO:     { tecla: "o", dica: "Arraste para desenhar o objeto escolhido (ou clique para o tamanho padrão)." },
        ESCALA:     { tecla: "k", dica: "Clique em dois pontos de distância conhecida (na imagem de fundo) para corrigir a escala." },
        // 0.17: só pelo painel do desenho (sem tecla)
        ALINHAR:    { tecla: "", dica: "Alinhar o desenho: clique num canto do desenho e depois onde ele fica na planta; faça o mesmo com um segundo canto." }
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
                    if (!localStorage.getItem("postosFrota") && PlantaExemplo.postos) localStorage.setItem("postosFrota", JSON.stringify(PlantaExemplo.postos()));
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
        // 0.17: as linhas do DXF também (são as mesmas em todas as versões do desfazer)
        const linhasDesenho = estado.rascunho.desenho?.linhas;
        const copia = JSON.parse(JSON.stringify(estado.rascunho, (k, v) => (k === "imagem" || (k === "linhas" && Array.isArray(v)) ? undefined : v)));
        return { planta: copia, imagem, linhasDesenho };
    }

    function restaurar(foto) {
        const planta = Planta.clonar(foto.planta);
        if (planta.fundo && foto.imagem) planta.fundo.imagem = foto.imagem;
        if (planta.desenho && foto.linhasDesenho) planta.desenho.linhas = foto.linhasDesenho;
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
            orientacaoChegada: tipo === "ESTACAO" || tipo === "BERCO" ? 90 : null, barreira: 0
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
        if (Planta.tipoSegmento(segmento) !== "LINHA") return null;   // troca lateral e curva não se dividem
        const proj = projetar(segmento, ponto);
        if (proj.distancia < 0.1 || proj.comprimento - proj.distancia < 0.1) return null;
        const no = criarNo(tipo, proj.x, proj.y, estacaoId);
        const tags = segmento.tags || [];
        const novo = {
            id: Planta.proximoId(p().segmentos, "S"), tipo: "LINHA", a: no.id, b: segmento.b, sentido: segmento.sentido,
            velocidadeMaxima: segmento.velocidadeMaxima, barreira: segmento.barreira,
            ...(segmento.guia ? { guia: segmento.guia } : {}), ...(segmento.modulos ? { modulos: segmento.modulos.slice() } : {}), ...(segmento.ramal ? { ramal: true } : {}),
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

    // Modelos da frota (0.16): a validação confere se cada um chega nas estações dele
    function perfisDaFrota() {
        if (typeof Modelos === "undefined" || !Modelos.perfil || typeof agvs === "undefined") return [];
        const ids = [...new Set(Object.values(agvs).map(a => a.modelo).filter(Boolean))];
        return ids.map(id => Modelos.porId(id)).filter(Boolean).map(m => ({ nome: m.nome, perfil: Modelos.perfil(m) }));
    }

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
            estado.validacao = Planta.validar(p(), { perfis: perfisDaFrota() });
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

    // Biblioteca agrupada (0.16) para o seletor de objeto
    function opcoesBiblioteca(atual) {
        return (Planta.GRUPOS_LAYOUT || [["", ""]]).map(([g, titulo]) => {
            const itens = Object.entries(Planta.TIPOS_LAYOUT).filter(([, v]) => (v.grupo || "") === g);
            if (!itens.length) return "";
            return `<optgroup label="${esc(titulo)}">${itens.map(([k, v]) => `<option value="${k}" ${k === atual ? "selected" : ""}>${esc(v.nome)}</option>`).join("")}</optgroup>`;
        }).join("");
    }
    function textoRegraObjeto(o) {
        const tipo = Planta.TIPOS_LAYOUT[o.tipo] || {};
        if (tipo.regra === "FAIXA") return `${o.tipo === "FAIXA_PEDESTRE" ? "Faixa de pedestre" : "Cruzamento com empilhadeira"}: o Atta para ${Planta.FAIXA.pausaS} s antes, atravessa devagar com o LED piscando e nunca para em cima (nenhum ponto pode ficar aqui).`;
        if (tipo.regra === "LIVRE") return "Área livre obrigatória (frente de quadro elétrico, hidrante, saída de emergência): nenhum ponto de parada pode ficar aqui.";
        if (o.tipo === "ZONA_PROIBIDA") return "Nenhuma linha pode passar por aqui.";
        if (o.tipo === "ZONA_LENTA") return "Linhas que cruzam a zona ficam limitadas a esta velocidade.";
        if (tipo.solido) return "Objeto sólido: as linhas não podem atravessá-lo e o AGV virtual o enxerga nos sensores de distância.";
        return "Referência visual.";
    }

    // Modelo 3D próprio (GLB, 0.17) de um objeto
    function blocoModelo3d(o) {
        const ref = o.modelo3d ? (p().modelos3d || []).find(m => m.id === o.modelo3d) : null;
        return `<div class="editor-bloco">
            <span class="editor-subtitulo">Modelo 3D</span>
            ${ref ? `<p class="editor-texto"><strong>${esc(ref.nome)}</strong> · ${ref.tamanho >= 104858 ? (ref.tamanho / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(ref.tamanho / 1024)) + " kB"}</p>
                ${campoSelect("Tamanho no 3D", "objAjuste3d", o.ajuste3d || "caber", [["caber", "Cabe no retângulo do objeto"], ["real", "Tamanho real do arquivo (metros)"]])}
                <div class="editor-acoes"><button class="btn btn-mini" data-acao="escolherGlbObjeto">Trocar</button><button class="btn btn-mini" data-acao="removerGlbObjeto">Voltar ao modelo padrão</button></div>`
                : `<p class="editor-texto suave">No 3D aparece o modelo padrão da biblioteca. Para mostrar a máquina de verdade, use o GLB do fabricante ou do SketchUp/Blender (até ${Arquivos3D.LIMITE / 1048576} MB).</p>
                <button class="btn btn-mini" data-acao="escolherGlbObjeto">Usar um modelo 3D (GLB)</button>`}
        </div>`;
    }
    // O galpão em 3D (GLB, 0.17) no painel da planta
    function blocoGalpao3d(planta) {
        const g = planta.galpao3d;
        const ref = g ? (planta.modelos3d || []).find(m => m.id === g.modelo) : null;
        return `<div class="editor-bloco">
            <span class="editor-subtitulo">Galpão em 3D (GLB)</span>
            ${ref ? `<p class="editor-texto"><strong>${esc(ref.nome)}</strong> · ${ref.tamanho >= 104858 ? (ref.tamanho / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(ref.tamanho / 1024)) + " kB"}</p>
                <div class="editor-linha">${campoNumero("X", "galpaoX", g.x, 0.05, "m")}${campoNumero("Y", "galpaoY", g.y, 0.05, "m")}</div>
                <div class="editor-linha">${campoNumero("Rotação", "galpaoRotacao", g.rotacao, 0.5, "°")}${campoNumero("Escala", "galpaoEscala", g.escala, 0.001, "×", 'min="0.0001"')}</div>
                <div class="editor-acoes"><button class="btn btn-mini" data-acao="escolherGlbGalpao">Trocar</button><button class="btn btn-mini btn-perigo" data-acao="removerGlbGalpao">Remover</button></div>`
                : `<p class="editor-texto suave">O prédio (paredes, pilares, estrutura) exportado do Revit, SketchUp ou Blender, em metros. Exporte sem o telhado para ver o lado de dentro. Aparece só na vista 3D; a origem do arquivo vai no X/Y abaixo.</p>
                <button class="btn btn-mini" data-acao="escolherGlbGalpao">Importar GLB do galpão</button>`}
        </div>`;
    }
    // Tira da lista os modelos que nenhum objeto (nem o galpão) usa mais
    function limparModelos3d(planta) {
        const usados = new Set(planta.layout.map(o => o.modelo3d).filter(Boolean).concat(planta.galpao3d ? [planta.galpao3d.modelo] : []));
        planta.modelos3d = (planta.modelos3d || []).filter(m => usados.has(m.id));
    }
    async function importarGlb(arquivo) {
        const destino = estado.glbDestino;
        if (!destino) return;
        try {
            ui.aviso(`Enviando ${arquivo.name}…`, "info");
            const ref = await Arquivos3D.salvar(arquivo);
            registrarDesfazer();
            const planta = p();
            planta.modelos3d = planta.modelos3d || [];
            if (!planta.modelos3d.some(m => m.id === ref.id)) planta.modelos3d.push(ref);
            if (destino.tipo === "objeto") {
                const o = planta.layout.find(x => x.id === destino.id);
                if (!o) return;
                o.modelo3d = ref.id; o.ajuste3d = o.ajuste3d || "caber";
            } else {
                planta.galpao3d = Object.assign({ x: 0, y: 0, rotacao: 0, escala: 1 }, planta.galpao3d || {}, { modelo: ref.id });
            }
            limparModelos3d(planta);
            alterado();
            ui.aviso(`${ref.nome} pronto. Veja na vista 3D (botão 3D no mapa).`, "sucesso");
        } catch (e) {
            ui.aviso(e.message, "erro");
        }
    }

    // Desenho do CAD (DXF, 0.17) no painel da planta
    function blocoDesenho(planta) {
        const d = planta.desenho;
        if (!d) return `<div class="editor-bloco">
                <span class="editor-subtitulo">Desenho do CAD (DXF)</span>
                <p class="editor-texto suave">O layout do AutoCAD por baixo da planta, em escala. Camadas de parede viram sólidas (a fita não atravessa) e paredes no 3D. DWG: no AutoCAD, Salvar como › DXF.</p>
                <button class="btn btn-mini" data-acao="escolherDxf">Importar DXF</button>
            </div>`;
        const alinhando = estado.ferramenta === "ALINHAR";
        const passo = estado.alinhar?.pontos?.length || 0;
        const textosPasso = ["Clique num canto do desenho (ele pega o canto mais perto).", "Agora clique onde esse canto fica na planta.", "Clique num segundo canto do desenho, longe do primeiro.", "Clique onde o segundo canto fica na planta."];
        return `<div class="editor-bloco">
                <span class="editor-subtitulo">Desenho do CAD (DXF)</span>
                <p class="editor-texto"><strong>${esc(d.nome)}</strong> · ${Planta.arred(d.largura * d.escala, 1)} × ${Planta.arred(d.altura * d.escala, 1)} m · ${esc(d.unidade || "")}</p>
                <label class="editor-campo"><span>Opacidade</span><input type="range" min="0.05" max="1" step="0.05" data-campo="desenhoOpacidade" value="${d.opacidade}"></label>
                <div class="editor-linha">
                    ${campoNumero("X", "desenhoX", d.x, 0.05, "m")}
                    ${campoNumero("Y", "desenhoY", d.y, 0.05, "m")}
                </div>
                <div class="editor-linha">
                    ${campoNumero("Rotação", "desenhoRotacao", Planta.arred(d.rotacao, 2), 0.5, "°")}
                    ${campoNumero("Escala", "desenhoEscala", d.escala, 0.001, "×", 'min="0.0001"')}
                </div>
                <div class="editor-camadas">
                    ${d.camadas.map((c, i) => c.linhas ? `<div class="editor-camada">
                        <label class="config-chave"><input type="checkbox" data-campo="camadaVisivel" data-indice="${i}" ${c.visivel ? "checked" : ""}><span>${esc(c.nome)}</span></label>
                        <select data-campo="camadaUso" data-indice="${i}" aria-label="Uso da camada ${esc(c.nome)}">
                            ${[["fundo", "Só fundo"], ["paredes", "Paredes"], ["oculta", "Ocultar"]].map(([v, t]) => `<option value="${v}" ${c.uso === v ? "selected" : ""}>${t}</option>`).join("")}
                        </select><small class="suave">${c.linhas}</small></div>` : "").join("")}
                </div>
                ${alinhando ? `<div class="editor-aviso">Alinhar (${passo + 1}/4): ${textosPasso[Math.min(3, passo)]}</div>
                    <label class="config-chave"><input type="checkbox" data-campo="alinharEscala" ${estado.alinhar?.escala ? "checked" : ""}><span>Ajustar a escala também (o desenho não está em metros)</span></label>` : ""}
                <div class="editor-acoes">
                    <button class="btn btn-mini" data-acao="${alinhando ? "cancelarAlinhar" : "alinharDesenho"}">${alinhando ? "Cancelar alinhamento" : "Alinhar por 2 pontos"}</button>
                    <button class="btn btn-mini" data-acao="areaDoDesenho">Área = desenho</button>
                    <button class="btn btn-mini btn-perigo" data-acao="removerDesenho">Remover</button>
                </div>
                ${(d.avisos || []).length ? `<p class="editor-texto suave">${(d.avisos || []).map(esc).join(" ")}</p>` : ""}
            </div>`;
    }

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
                ${blocoDesenho(planta)}
                ${blocoGalpao3d(planta)}
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
            titulo.textContent = no.tipo === "ESTACAO" ? (acessos.length > 1 ? `Acesso da estação ${estacao.id}` : "Estação") : no.tipo === "ESPERA" ? "Ponto de espera" : no.tipo === "BERCO" ? "Berço" : "Referência";
            const donos = no.tipo === "BERCO" && estado.ganchos.agvsDoBerco ? estado.ganchos.agvsDoBerco(no.id) : [];
            const ligados = planta.segmentos.filter(s => s.a === no.id || s.b === no.id).length;
            const rfids = estado.ganchos.ultimosRfids ? estado.ganchos.ultimosRfids() : [];
            const maquinas = planta.layout.filter(o => Planta.TIPOS_LAYOUT[o.tipo]?.solido);
            painel.innerHTML = `
                <div class="editor-linha">
                    ${campo("Identificador", "noId", no.id, `maxlength="${Planta.LIMITES.tamanhoId}"`)}
                    ${campoSelect("Tipo", "noTipo", no.tipo, [["ESTACAO", "Estação"], ["REFERENCIA", "Referência"], ["ESPERA", "Espera"], ["BERCO", "Berço"]])}
                </div>
                ${no.tipo === "ESTACAO" && estacao ? `
                    <div class="editor-bloco destaque">
                        <span class="editor-subtitulo">Estação (destino das missões)</span>
                        <div class="editor-linha">
                            ${campo("ID da estação", "estacaoId", estacao.id, `maxlength="${Planta.LIMITES.tamanhoId}"`)}
                            ${campo("Nome", "estacaoNome", estacao.nome, 'placeholder="Ex.: Prensa 1"')}
                        </div>
                        ${maquinas.length ? campoSelect("Máquina atendida", "estacaoMaquina", estacao.maquina || "", [["", "—"]].concat(maquinas.map(m => [m.id, m.nome || m.id]))) : ""}
                        ${campoSelect("O que a estação troca", "estacaoCarga", estacao.carga || "", [["", "Qualquer (não definido)"]].concat(Object.entries(Planta.CARGAS).map(([k, v]) => [k, `${v.nome} · Atta ${v.modulo}`])))}
                        <small class="suave">${estacao.carga ? `Só o Atta ${Planta.CARGAS[estacao.carga].modulo} recebe missões para cá, e a planta confere se ele chega e sai (o comboio não anda de ré nem gira no ponto).` : "Defina para o despacho só mandar o módulo certo (kit: G, carrinho: E, esteira: R, comboio: T)."}</small>
                        ${typeof Modelos !== "undefined" && Modelos.lista().length ? `
                            <div class="editor-campo"><span>Atendida por</span>
                                <div class="editor-modelos">${Modelos.lista().map(m => `<label class="config-chave"><input type="checkbox" data-campo="estacaoModelo" data-modelo="${esc(m.id)}" ${(estacao.modelos || []).includes(m.id) ? "checked" : ""}><span>${esc(m.nome)}</span></label>`).join("")}</div>
                                <small class="suave">Nenhum marcado: qualquer modelo. Marcados: o despacho só manda AGVs desses modelos para esta estação.</small>
                            </div>` : ""}
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
                ${no.tipo === "BERCO" ? `
                    <div class="editor-bloco destaque">
                        <span class="editor-subtitulo">Casa de</span>
                        <p class="editor-texto">${donos.length ? donos.map(a => `<strong>${esc(a)}</strong>`).join(", ") : "nenhum AGV ainda"}</p>
                        <p class="editor-texto suave">Escolha os AGVs de cada berço em Frota › Rotina. Pode ser o mesmo berço para AGVs de turnos diferentes. A tag RFID do berço faz o AGV se reconhecer ao ser ligado aqui.</p>
                    </div>` : ""}
                ${no.tipo === "ESTACAO" || no.tipo === "BERCO" ? `
                    <div class="editor-bloco">
                        <span class="editor-subtitulo">Orientação de chegada</span>
                        <p class="editor-texto suave">Para onde a frente do AGV aponta quando ele para ${no.tipo === "BERCO" ? "no berço" : "na estação"}.</p>
                        <div class="editor-orientacao">
                            ${[[90, "↑"], [0, "→"], [270, "↓"], [180, "←"]].map(([a, s]) => `<button class="btn ${no.orientacaoChegada === a ? "ativo" : ""}" data-acao="orientacao" data-valor="${a}">${s} ${a}°</button>`).join("")}
                            <input type="number" step="1" min="0" max="359" data-campo="noOrientacao" value="${no.orientacaoChegada ?? ""}">
                        </div>
                    </div>` : ""}
                ${campoNumero("Barreira neste ponto", "noBarreira", no.barreira || "", 10, "mm", 'min="0" placeholder="padrão do AGV"')}
                <p class="editor-texto suave">Use quando o AGV para de frente para uma máquina (ex.: 300 mm). Mínimo ${Planta.LIMITES.barreiraMinima} mm.</p>
                <p class="editor-texto suave">${ligados} segmento(s) ligado(s).</p>
                ${planta.segmentos.filter(x => Planta.tipoSegmento(x) === "LINHA" && (x.a === no.id || x.b === no.id)).length === 2 ? `
                    <div class="editor-bloco">
                        <span class="editor-subtitulo">Curva para rebocador neste canto</span>
                        <p class="editor-texto suave">O comboio carregado não gira no ponto. A curva corta o canto; os outros Atta podem usar o canto ou a curva (o Eciton escolhe o mais rápido).</p>
                        <div class="editor-linha">
                            ${campoNumero("Raio", "cantoRaio", estado.raioCanto ?? 1.5, 0.1, "m", `min="${Planta.RAIO_MINIMO_CURVA}"`)}
                            <div class="editor-acoes compacto"><button class="btn btn-mini" data-acao="criarConcordancia">Criar curva</button></div>
                        </div>
                    </div>` : ""}
                <div class="editor-acoes"><button class="btn btn-mini btn-perigo" data-acao="excluir">Excluir ponto</button></div>`;
            return;
        }

        // Guia, módulos e ramal (0.16): o mesmo bloco para reta e curva
        const blocoModulos = s => `
                <div class="editor-bloco">
                    <span class="editor-subtitulo">Quem passa aqui</span>
                    ${campoSelect("Guia no chão", "segGuia", s.guia || "", [["", `Padrão da planta (${Planta.GUIAS[planta.guiaPadrao || "OPTICA"]})`]].concat(Object.entries(Planta.GUIAS)))}
                    <div class="editor-campo"><span>Só estes módulos</span>
                        <div class="editor-modelos">${["E", "G", "R", "T"].map(m => `<label class="config-chave"><input type="checkbox" data-campo="segModulo" data-modulo="${m}" ${(s.modulos || []).includes(m) ? "checked" : ""}><span>Atta ${m}</span></label>`).join("")}</div>
                        <small class="suave">Nenhum marcado: todos. Sem fita (LiDAR): só Atta -L passa.</small>
                    </div>
                    <label class="config-chave"><input type="checkbox" data-campo="segRamal" ${s.ramal ? "checked" : ""}><span>Ramal: quem volta daqui para a linha principal cede a vez</span></label>
                </div>`;

        if (sel.tipo === "segmento" && Planta.tipoSegmento(Planta.segmentoPorId(planta, sel.id)) === "CURVA") {
            const s = Planta.segmentoPorId(planta, sel.id);
            const g = Planta.geometriaCurva(planta, s);
            const d = Planta.descreverSegmento(planta, s, s.a);
            titulo.textContent = `Curva ${s.id}`;
            painel.innerHTML = `
                <p class="editor-texto"><strong>${esc(s.a)} → ${esc(s.b)}</strong> · ${Planta.arred(d.comprimento, 2)} m · sai a ${d.saida}°, chega a ${d.chegada}°</p>
                <p class="editor-texto suave">Fita em arco. O Atta segue a curva sem parar; na ponta onde a fita se divide ele segue a borda do lado certo (precisa de tag RFID no ponto).</p>
                <div class="editor-linha">
                    ${campoNumero("Raio", "segRaio", s.raio, 0.05, "m", `min="${Planta.RAIO_MINIMO_CURVA}"`)}
                    ${campoSelect("Vira para", "segLado", s.lado, [["ESQ", `esquerda (de ${s.a})`], ["DIR", `direita (de ${s.a})`]])}
                </div>
                ${g && g.raioPedido < g.corda / 2 - 0.001 ? `<div class="editor-aviso">O raio precisa ser pelo menos ${Planta.arred(g.corda / 2, 2)} m (metade da distância entre os pontos).</div>` : ""}
                ${campoSelect("Sentido", "segSentido", s.sentido, [["DUPLO", "Mão dupla"], ["A_PARA_B", `Só ${s.a} → ${s.b}`], ["B_PARA_A", `Só ${s.b} → ${s.a}`]])}
                ${campoNumero("Velocidade máx.", "segVelocidade", s.velocidadeMaxima || "", 0.005, "m/s", `min="0" max="${Planta.LIMITES.velocidadeMaxima}" placeholder="padrão"`)}
                ${blocoModulos(s)}
                <div class="editor-acoes">
                    <button class="btn btn-mini" data-acao="inverterSegmento">Inverter A/B</button>
                    <button class="btn btn-mini btn-perigo" data-acao="excluir">Excluir curva</button>
                </div>`;
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
                ${blocoModulos(s)}
                <div class="editor-bloco">
                    <span class="editor-subtitulo">Ramal (para o rebocador e para parar fora do corredor)</span>
                    <p class="editor-texto suave">Sai da linha em curva, corre paralelo e volta. Quem para no ramal deixa a linha principal livre; para voltar, cede a vez.</p>
                    <div class="editor-linha">
                        ${campoNumero("Começa a", "ramalDe", estado.ramal?.de ?? Planta.arred(Math.min(2, L / 4), 2), 0.1, "m", 'min="0.15"')}
                        ${campoNumero("Termina a", "ramalAte", estado.ramal?.ate ?? Planta.arred(Math.max(0.3, L - Math.min(2, L / 4)), 2), 0.1, "m", 'min="0.3"')}
                    </div>
                    <div class="editor-linha">
                        ${campoNumero("Afastamento", "ramalAfastamento", estado.ramal?.afastamento ?? 1.5, 0.1, "m", 'min="0.3"')}
                        ${campoNumero("Raio das curvas", "ramalRaio", estado.ramal?.raio ?? 1.5, 0.1, "m", `min="${Planta.RAIO_MINIMO_CURVA}"`)}
                    </div>
                    ${campoSelect("Lado", "ramalLado", estado.ramal?.lado ?? "ESQ", [["ESQ", `à esquerda de ${s.a}→${s.b}`], ["DIR", `à direita de ${s.a}→${s.b}`]])}
                    <p class="editor-texto suave">Distâncias medidas a partir de ${esc(s.a)} (o segmento tem ${Planta.arred(L, 2)} m).</p>
                    <div class="editor-acoes"><button class="btn btn-mini" data-acao="criarRamal">Criar ramal</button></div>
                </div>
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
                    <label class="editor-campo"><span>Tipo</span><select data-campo="objTipo">${opcoesBiblioteca(o.tipo)}</select></label>
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
                ${(Planta.TIPOS_LAYOUT[o.tipo]?.altura || 0) > 0 ? campoNumero("Altura (vista 3D)", "objAltura", o.altura || "", 0.1, "m", `min="0" placeholder="${Planta.TIPOS_LAYOUT[o.tipo].altura}"`) : ""}
                <p class="editor-texto suave">${esc(textoRegraObjeto(o))}</p>
                ${(Planta.TIPOS_LAYOUT[o.tipo]?.altura || 0) > 0 || o.modelo3d ? blocoModelo3d(o) : ""}
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
        // ferramentas de ramal e de canto (0.16): só guardam o valor até clicar em criar
        const chavesRamal = { ramalDe: "de", ramalAte: "ate", ramalAfastamento: "afastamento", ramalRaio: "raio", ramalLado: "lado" };
        if (chavesRamal[nome]) { estado.ramal = Object.assign({}, estado.ramal, { [chavesRamal[nome]]: nome === "ramalLado" ? valor : num }); return; }
        if (nome === "cantoRaio") { estado.raioCanto = num; return; }
        if (nome === "alinharEscala") { estado.alinhar = Object.assign({ pontos: [] }, estado.alinhar, { escala: alvo.checked }); return; }
        registrarDesfazer();

        switch (nome) {
            case "plantaNome": planta.nome = valor; break;
            case "plantaLargura": if (num >= 1) planta.dimensoes.largura = num; break;
            case "plantaAltura": if (num >= 1) planta.dimensoes.altura = num; break;
            case "plantaGrade": if (num >= 0.05) planta.grade = num; break;
            case "fundoOpacidade": planta.fundo.opacidade = num; break;
            case "desenhoOpacidade": planta.desenho.opacidade = num; break;
            case "galpaoX": planta.galpao3d.x = num || 0; break;
            case "galpaoY": planta.galpao3d.y = num || 0; break;
            case "galpaoRotacao": planta.galpao3d.rotacao = ((num || 0) % 360 + 360) % 360; break;
            case "galpaoEscala": if (num > 0) planta.galpao3d.escala = num; break;
            case "desenhoX": planta.desenho.x = num || 0; break;
            case "desenhoY": planta.desenho.y = num || 0; break;
            case "desenhoRotacao": planta.desenho.rotacao = ((num || 0) % 360 + 360) % 360; break;
            case "desenhoEscala": if (num > 0) planta.desenho.escala = num; break;
            case "camadaVisivel": planta.desenho.camadas[Number(alvo.dataset.indice)].visivel = alvo.checked; break;
            case "camadaUso": planta.desenho.camadas[Number(alvo.dataset.indice)].uso = valor; break;
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
                    if ((valor === "ESTACAO" || valor === "BERCO") && (no.orientacaoChegada === null || no.orientacaoChegada === undefined)) no.orientacaoChegada = 90;
                    if (valor === "ESTACAO") tornarEstacao(no);
                    if (valor !== "ESTACAO") {
                        if (valor !== "BERCO") no.orientacaoChegada = null;
                        delete no.estacao;
                        limparEstacoesVazias();
                    }
                    break;
                case "estacaoId": if (!renomearEstacao(no.estacao, valor)) { estado.desfazer.pop(); renderizarPropriedades(); return; } break;
                case "estacaoNome": { const e = Planta.estacaoPorId(planta, no.estacao); if (e) e.nome = valor.trim(); break; }
                case "estacaoMaquina": { const e = Planta.estacaoPorId(planta, no.estacao); if (e) { if (valor) e.maquina = valor; else delete e.maquina; } break; }
                case "estacaoCarga": { const e = Planta.estacaoPorId(planta, no.estacao); if (e) { if (Planta.CARGAS[valor]) e.carga = valor; else delete e.carga; } break; }
                case "estacaoModelo": {
                    const e = Planta.estacaoPorId(planta, no.estacao);
                    if (e) {
                        const l = new Set(e.modelos || []);
                        if (alvo.checked) l.add(alvo.dataset.modelo); else l.delete(alvo.dataset.modelo);
                        if (l.size) e.modelos = [...l].sort(); else delete e.modelos;
                    }
                    break;
                }
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
                case "segGuia": if (Planta.GUIAS[valor]) s.guia = valor; else delete s.guia; break;
                case "segModulo": {
                    const m = alvo.dataset.modulo;
                    const lista = new Set(s.modulos || []);
                    if (alvo.checked) lista.add(m); else lista.delete(m);
                    if (lista.size) s.modulos = ["E", "G", "R", "T"].filter(x => lista.has(x)); else delete s.modulos;
                    break;
                }
                case "segRamal": if (alvo.checked) s.ramal = true; else delete s.ramal; break;
                case "segRaio": if (num > 0) s.raio = Planta.arred(num); break;
                case "segLado": s.lado = valor === "DIR" ? "DIR" : "ESQ"; break;
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
                case "objAltura": if (num > 0) o.altura = Planta.arred(num, 2); else delete o.altura; break;
                case "objAjuste3d": o.ajuste3d = valor === "real" ? "real" : "caber"; break;
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
            case "criarRamal": {
                const s = Planta.segmentoPorId(p(), estado.selecao?.id);
                if (!s) return;
                const L = Planta.comprimentoSegmento(p(), s);
                const painelAtual = document.getElementById("editorPropriedades");
                const ler = (campoNome, padrao) => { const x = Number(painelAtual?.querySelector(`[data-campo="${campoNome}"]`)?.value); return Number.isFinite(x) && x > 0 ? x : padrao; };
                const opcoes = {
                    de: ler("ramalDe", Math.min(2, L / 4)), ate: ler("ramalAte", L - Math.min(2, L / 4)),
                    afastamento: ler("ramalAfastamento", 1.5), raio: ler("ramalRaio", 1.5),
                    lado: painelAtual?.querySelector('[data-campo="ramalLado"]')?.value || "ESQ"
                };
                registrarDesfazer();
                const r = Planta.criarRamal(p(), s.id, opcoes);
                if (!r.sucesso) { estado.desfazer.pop(); ui.aviso(r.erro, "aviso"); return; }
                estado.ramal = null;
                estado.selecao = { tipo: "segmento", id: r.segmentos.find(x => x.tipo === "LINHA" && x.a === r.paralelo[0].id)?.id || r.segmentos[0].id };
                ui.aviso(`Ramal criado: ${r.comprimentoUtil} m paralelos para parar fora da linha. Ponha tags RFID nas duas bifurcações (${r.entrada.id} e ${r.saida.id}).`, "sucesso");
                alterado();
                return;
            }
            case "criarConcordancia": {
                const no = Planta.noPorId(p(), estado.selecao?.id);
                if (!no) return;
                const raio = Number(document.querySelector('#editorPropriedades [data-campo="cantoRaio"]')?.value) || estado.raioCanto || 1.5;
                registrarDesfazer();
                const r = Planta.criarCurvaConcordancia(p(), no.id, raio);
                if (!r.sucesso) { estado.desfazer.pop(); ui.aviso(r.erro, "aviso"); return; }
                estado.selecao = { tipo: "segmento", id: r.curva.id };
                ui.aviso(`Curva de ${Planta.arred(raio, 2)} m criada. Ponha tags RFID em ${r.pontos.map(x => x.id).join(" e ")} (onde a fita se divide).`, "sucesso");
                alterado();
                return;
            }
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
            case "escolherDxf": document.getElementById("editorArquivoDxf")?.click(); return;
            case "escolherGlbObjeto": estado.glbDestino = { tipo: "objeto", id: estado.selecao?.id }; document.getElementById("editorArquivoGlb")?.click(); return;
            case "escolherGlbGalpao": estado.glbDestino = { tipo: "galpao" }; document.getElementById("editorArquivoGlb")?.click(); return;
            case "removerGlbObjeto": {
                const o = p().layout.find(x => x.id === estado.selecao?.id);
                if (!o) return;
                registrarDesfazer(); delete o.modelo3d; delete o.ajuste3d; limparModelos3d(p()); alterado();
                return;
            }
            case "removerGlbGalpao": registrarDesfazer(); p().galpao3d = null; limparModelos3d(p()); alterado(); return;
            case "alinharDesenho": estado.alinhar = { pontos: [], escala: false }; estado.selecao = null; selecionarFerramenta("ALINHAR"); return;
            case "cancelarAlinhar": estado.alinhar = null; selecionarFerramenta("SELECIONAR"); return;
            case "areaDoDesenho": {
                const d = p().desenho;
                if (!d) return;
                registrarDesfazer();
                const cantos = [[0, 0], [d.largura, 0], [0, d.altura], [d.largura, d.altura]].map(([x, y]) => Dxf.paraPlanta(d, x, y));
                const minX = Math.min(...cantos.map(c => c.x)), minY = Math.min(...cantos.map(c => c.y));
                if (minX < 0 || minY < 0) { d.x -= Math.min(0, minX); d.y -= Math.min(0, minY); }
                p().dimensoes.largura = Planta.arred(Math.max(...cantos.map(c => c.x)) - Math.min(0, minX), 2);
                p().dimensoes.altura = Planta.arred(Math.max(...cantos.map(c => c.y)) - Math.min(0, minY), 2);
                estado.mapa.ajustar();
                alterado();
                return;
            }
            case "removerDesenho":
                ui.confirmar({ titulo: "Remover o desenho do CAD?", texto: "Os pontos, linhas e objetos continuam onde estão.", confirmar: "Remover", perigo: true }).then(ok => {
                    if (!ok) return;
                    registrarDesfazer();
                    p().desenho = null;
                    alterado();
                });
                return;
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
                if (s.tipo === "CURVA") s.lado = s.lado === "DIR" ? "ESQ" : "DIR";   // mesma curva vista do outro lado
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
        estado.validacao = Planta.validar(p(), { perfis: perfisDaFrota() });
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

    // DXF (0.17): lê, simplifica e põe por baixo da planta, no canto (0, 0)
    async function importarDxf(arquivo) {
        if (arquivo.size > 60 * 1024 * 1024) { ui.aviso("DXF maior que 60 MB: apague o que não interessa (textos, cotas, detalhes) e exporte de novo.", "erro"); return; }
        if (/\.dwg$/i.test(arquivo.name)) { ui.aviso("DWG não dá para ler no navegador. No AutoCAD: Salvar como › DXF (ou converta com o ODA File Converter, que é grátis).", "erro"); return; }
        try {
            const texto = await arquivo.text();
            const lido = Dxf.ler(texto);
            const d = Dxf.paraDesenho(lido, arquivo.name);
            registrarDesfazer();
            const planta = p();
            planta.desenho = Planta.normalizarDesenho(d);
            planta.desenho.avisos = d.avisos;
            // planta vazia: do tamanho do desenho
            if (!planta.nos.length && !planta.layout.length) {
                planta.dimensoes.largura = Math.max(1, Planta.arred(d.largura, 2));
                planta.dimensoes.altura = Math.max(1, Planta.arred(d.altura, 2));
            }
            estado.mapa.ajustar();
            alterado();
            const paredes = d.camadas.filter(c => c.uso === "paredes" && c.linhas).map(c => c.nome);
            ui.aviso(`Desenho importado: ${d.linhas.length} linhas em ${d.camadas.filter(c => c.linhas).length} camadas, ${Planta.arred(d.largura, 1)} × ${Planta.arred(d.altura, 1)} m (${d.unidade}).` +
                (paredes.length ? ` Camadas como parede: ${paredes.join(", ")}.` : " Marque as camadas de parede no painel da planta.") + (d.avisos.length ? " " + d.avisos.join(" ") : ""), "sucesso");
        } catch (e) {
            ui.aviso("Não foi possível ler o DXF: " + e.message, "erro");
        }
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

        if (ferramenta === "ESTACAO" || ferramenta === "REFERENCIA" || ferramenta === "ESPERA" || ferramenta === "BERCO") {
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

        if (ferramenta === "ALINHAR") {
            const d = p().desenho;
            if (!d) return;
            const a = estado.alinhar || (estado.alinhar = { pontos: [], escala: false });
            const pegar = a.pontos.length % 2 === 0;
            if (pegar) {
                // um canto do desenho (coordenada dele), o mais perto do clique
                const v = Dxf.verticeMaisPerto(d, mundo.x, mundo.y, 20 / estado.mapa.pixelsPorMetro());
                if (!v) { ui.aviso("Clique em cima de uma linha do desenho (perto de um canto).", "aviso"); return; }
                a.pontos.push(v);
            } else {
                a.pontos.push(pontoAjustado(evento));
            }
            if (a.pontos.length === 4) {
                const [a1, b1, a2, b2] = a.pontos;
                try {
                    registrarDesfazer();
                    Object.assign(p().desenho, Dxf.alinharDoisPontos(p().desenho, a1, b1, a2, b2, a.escala));
                    ui.aviso(`Desenho alinhado (girou ${Planta.arred(p().desenho.rotacao, 1)}°${a.escala ? `, escala ${p().desenho.escala}` : ""}).`, "sucesso");
                    alterado();
                } catch (e) { ui.aviso(e.message, "aviso"); }
                estado.alinhar = null;
                selecionarFerramenta("SELECIONAR");
                return;
            }
            desenharMapa();
            renderizarPropriedades();
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
        if (estado.ferramenta === "ALINHAR" && estado.alinhar?.pontos?.length && p().desenho) {
            const d = p().desenho;
            estado.alinhar.pontos.forEach((q, i) => {
                const w = i % 2 === 0 ? Dxf.paraPlanta(d, q.x, q.y) : q;
                el("circle", { cx: w.x, cy: Y(w.y), r: px(6), fill: i % 2 === 0 ? corEscala : "none", stroke: corEscala, "stroke-width": 2, "vector-effect": "non-scaling-stroke", "pointer-events": "none" }, grupo);
                if (i % 2 === 1) { const o = Dxf.paraPlanta(d, estado.alinhar.pontos[i - 1].x, estado.alinhar.pontos[i - 1].y); el("line", { x1: o.x, y1: Y(o.y), x2: w.x, y2: Y(w.y), stroke: corEscala, "stroke-width": 1.5, "stroke-dasharray": "5 4", "vector-effect": "non-scaling-stroke", "pointer-events": "none" }, grupo); }
            });
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
        estado.validacao = Planta.validar(estado.rascunho, { perfis: perfisDaFrota() });
    }

    // Monta o mapa quando a tela aparece pela primeira vez
    function abrir() {
        const container = document.getElementById("editorMapa");
        if (!container) return;
        if (!estado.iniciado) {
            estado.iniciado = true;
            estado.mapa = MapaSVG.criar(container, { grade: true, editor: true, rastro: false, nome: "editor" });
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
            const seletorObjeto = document.getElementById("editorTipoObjeto");
            if (seletorObjeto) seletorObjeto.innerHTML = opcoesBiblioteca(estado.tipoObjeto);
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
            document.getElementById("editorArquivoGlb")?.addEventListener("change", e => {
                const arquivo = e.target.files[0];
                if (arquivo) importarGlb(arquivo);
                e.target.value = "";
            });
            document.getElementById("editorArquivoDxf")?.addEventListener("change", e => {
                const arquivo = e.target.files[0];
                if (arquivo) importarDxf(arquivo);
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
        // seleciona um ponto, segmento ou objeto (como o clique no mapa)
        selecionar: (tipo, id) => { estado.selecao = tipo ? { tipo, id } : null; desenharMapa(); renderizarPropriedades(); },
        _estado: estado
    };
})(typeof window !== "undefined" ? window : globalThis);
