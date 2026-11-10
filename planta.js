/* ============================================================
   PLANTA v3 — modelo, validacao, rotas e compilacao de missoes
   ============================================================

   Modelo (tudo em METROS, eixo y para CIMA, angulos em graus:
   0 = direita/leste, 90 = cima/norte, sentido anti-horario):

   {
     versao: 3,
     revisao: 1,                       // sobe a cada publicacao
     nome: "Fabrica",
     dimensoes: { largura: 20, altura: 12 },
     grade: 0.5,
     fundo: null | { imagem: "data:...", x, y, largura, altura, opacidade },

     // CAMADA DE LAYOUT (o que existe na fabrica)
     layout: [ { id, tipo, nome, x, y, largura, profundidade, rotacao, velocidadeMaxima? } ],

     // ESTACOES = locais de trabalho. Cada uma tem um ou mais ACESSOS
     // (pontos de parada do tipo ESTACAO), cada acesso com a sua tag e a
     // sua orientacao de chegada. "IR PARA" uma estacao escolhe o acesso
     // pelo caminho mais curto.
     estacoes: [ { id, nome, maquina, modelos?, carga?, lado?, altura? } ]
     //   modelos = só esses modelos atendem (0.14)
     //   carga (0.16) = o que a estação troca: KIT (Atta G) | CARRINHO (Atta E) |
     //   ESTEIRA (Atta R) | COMBOIO (parada do Atta T); vazio = qualquer módulo

     // CAMADA DE NAVEGACAO (por onde o AGV anda)
     nos: [ { id, tipo, nome, x, y, rfid, orientacaoChegada, barreira, estacao } ],
     //   tipo: ESTACAO (acesso de uma estacao) | REFERENCIA | ESPERA | BERCO (casa/carregador de AGVs)
     segmentos: [ { id, tipo, a, b, sentido, velocidadeMaxima, barreira, tags: [{ rfid, distancia }],
                    raio?, lado?, guia?, modulos?, ramal? } ]
     //   tipo: LINHA (fita reta) | LATERAL (troca de faixa andando de lado, sem fita)
     //         | CURVA (0.16: arco de "raio" m indo de a para b, virando para "lado" ESQ ou DIR)
     //   guia (0.16): OPTICA | MAGNETICA | VIRTUAL (sem fita: só Atta -L); padrão planta.guiaPadrao
     //   modulos (0.16): só esses módulos passam (ex.: ["E","G"]); vazio = todos
     //   ramal (0.16): quem sai deste trecho para a linha principal cede a vez
     //   sentido: DUPLO | A_PARA_B | B_PARA_A
     //   Dois segmentos LINHA entre os mesmos pontos sao permitidos se forem de
     //   sentido unico e opostos (faixa de ida e faixa de volta).
   }
*/

(function (raiz) {
    "use strict";

    const VERSAO = 3;

    // Limites do firmware (AGV_FROTA.ino)
    const LIMITES = {
        tamanhoId: 11,            // TAM_ID_PONTO - 1
        tamanhoRfid: 11,          // TAM_RFID - 1
        trechosPorEtapa: 16,      // MAX_TRECHOS_ETAPA
        checkpointsPorTrecho: 4,  // MAX_CHECKPOINTS_TRECHO
        etapasPorMissao: 20,      // MAX_ETAPAS_MISSAO
        barreiraMinima: 150,
        // 0.20: o teto é da placa de cada Atta (o protótipo para em 0,10 m/s sozinho);
        // a planta aceita até 2 m/s para os modelos de produção
        velocidadeMaxima: 2.0,
        lateralMinima: 0.05,
        lateralMaxima: 2.0
    };

    // Estimativas para escolher a rota (so comparam caminhos entre si)
    const CUSTO = {
        velocidadePadrao: 0.06,   // m/s em cruzeiro
        velocidadeLateral: 0.03,  // m/s na troca lateral
        wManobra: 0.35,           // rad/s
        paradaPorManobra: 2.0     // s para parar, girar e achar a linha
    };

    // Acima desta distancia entre faixas o editor sugere retorno com fita
    // (a troca lateral anda sem a protecao dos sensores de distancia).
    const DISTANCIA_SUGESTAO_LATERAL = 1.0;

    const TIPOS_NO = ["ESTACAO", "REFERENCIA", "ESPERA", "BERCO"];
    const TIPOS_SEGMENTO = ["LINHA", "LATERAL", "CURVA"];
    const GUIAS = { OPTICA: "Fita óptica", MAGNETICA: "Fita magnética", VIRTUAL: "Sem fita (LiDAR)" };
    // O que cada estação troca e qual módulo faz isso
    const CARGAS = {
        KIT:      { nome: "Kit ou caixa",       modulo: "G" },
        CARRINHO: { nome: "Carrinho",           modulo: "E" },
        ESTEIRA:  { nome: "Esteira",            modulo: "R" },
        COMBOIO:  { nome: "Parada de comboio",  modulo: "T" }
    };
    const RAIO_MINIMO_CURVA = 0.3;     // m (o QTR perde a fita em curvas mais fechadas)
    const ANGULO_BIFURCACAO = 40;      // graus: fitas que saem do mesmo ponto com menos que isso se dividem
    // Faixa de pedestre: para 1 s antes, atravessa devagar, LED piscando
    const FAIXA = { pausaS: 1, folgaParada: 0.30, folgaSaida: 0.20, velocidade: 0.04 };

    // Biblioteca (0.16): cada objeto com o tamanho padrão, a altura (para o 3D),
    // o grupo na paleta do editor e, para alguns, uma regra para os Atta.
    //   solido: o Atta não atravessa (erro na planta) e o sensor de distância vê
    //   regra: FAIXA  (para 1 s antes, atravessa devagar, LED piscando, nunca para em cima)
    //          LIVRE  (área que precisa ficar livre: nenhum ponto de parada dentro)
    //          LENTA  (velocidade máxima da zona) | PROIBIDA (nenhum trecho passa)
    //          PORTA  (0.19: porta automática ligada a um Eciton I/O; o Atta pede e
    //                  só passa com o sensor "aberta" confirmado)
    const GRUPOS_LAYOUT = [
        ["estrutura", "Estrutura"], ["armazenagem", "Armazenagem"], ["maquinas", "Máquinas"],
        ["logistica", "Postos e logística"], ["circulacao", "Circulação e segurança"], ["escala", "Pessoas e veículos"]
    ];
    const TIPOS_LAYOUT = {
        PAREDE:        { nome: "Parede",                 grupo: "estrutura",   solido: true,  largura: 4.0, profundidade: 0.15, altura: 3.0 },
        PILAR:         { nome: "Pilar",                  grupo: "estrutura",   solido: true,  largura: 0.3, profundidade: 0.3, altura: 4.5 },
        GRADE:         { nome: "Grade de proteção",      grupo: "estrutura",   solido: true,  largura: 3.0, profundidade: 0.05, altura: 2.0 },
        PORTA:         { nome: "Porta",                  grupo: "estrutura",   solido: false, largura: 1.0, profundidade: 0.15, altura: 2.1 },
        PORTAO:        { nome: "Portão",                 grupo: "estrutura",   solido: false, largura: 4.0, profundidade: 0.2, altura: 4.0 },
        PORTA_AUTOMATICA: { nome: "Porta automática",    grupo: "estrutura",   solido: false, largura: 3.0, profundidade: 0.2, altura: 3.5, regra: "PORTA" },
        PRATELEIRA:    { nome: "Prateleira",             grupo: "armazenagem", solido: true,  largura: 2.0, profundidade: 0.5, altura: 2.0 },
        PORTA_PALETE:  { nome: "Porta-palete",           grupo: "armazenagem", solido: true,  largura: 2.7, profundidade: 1.1, altura: 4.5 },
        FLOW_RACK:     { nome: "Flow rack (kits)",       grupo: "armazenagem", solido: true,  largura: 2.0, profundidade: 1.2, altura: 1.8 },
        PALETE:        { nome: "Palete com carga",       grupo: "armazenagem", solido: true,  largura: 1.2, profundidade: 1.0, altura: 1.3 },
        CAIXAS:        { nome: "Pilha de caixas",        grupo: "armazenagem", solido: true,  largura: 0.8, profundidade: 0.6, altura: 1.0 },
        MAQUINA:       { nome: "Máquina",                grupo: "maquinas",    solido: true,  largura: 1.2, profundidade: 0.8, altura: 1.8 },
        CNC:           { nome: "Centro de usinagem CNC", grupo: "maquinas",    solido: true,  largura: 2.6, profundidade: 2.0, altura: 2.5 },
        TORNO:         { nome: "Torno",                  grupo: "maquinas",    solido: true,  largura: 3.0, profundidade: 1.2, altura: 1.7 },
        PRENSA:        { nome: "Prensa",                 grupo: "maquinas",    solido: true,  largura: 2.2, profundidade: 2.0, altura: 3.6 },
        INJETORA:      { nome: "Injetora",               grupo: "maquinas",    solido: true,  largura: 5.0, profundidade: 1.8, altura: 2.2 },
        CELULA_ROBO:   { nome: "Célula de robô",         grupo: "maquinas",    solido: true,  largura: 3.5, profundidade: 3.5, altura: 2.4 },
        SOLDA:         { nome: "Box de solda",           grupo: "maquinas",    solido: true,  largura: 2.5, profundidade: 2.5, altura: 2.2 },
        ESTEIRA:       { nome: "Esteira",                grupo: "maquinas",    solido: true,  largura: 4.0, profundidade: 0.6, altura: 0.8 },
        BANCADA:       { nome: "Bancada",                grupo: "maquinas",    solido: true,  largura: 1.5, profundidade: 0.7, altura: 0.9 },
        INSPECAO:      { nome: "Mesa de inspeção",       grupo: "maquinas",    solido: true,  largura: 1.8, profundidade: 0.9, altura: 1.6 },
        POSTO:         { nome: "Posto logístico",        grupo: "logistica",   solido: true,  largura: 0.8, profundidade: 0.6, altura: 1.1 },
        CARREGADOR:    { nome: "Carregador de bateria",  grupo: "logistica",   solido: true,  largura: 0.6, profundidade: 0.3, altura: 0.7 },
        DOCA:          { nome: "Doca",                   grupo: "logistica",   solido: false, largura: 3.5, profundidade: 0.4, altura: 3.5 },
        ESCRITORIO:    { nome: "Escritório",             grupo: "logistica",   solido: true,  largura: 6.0, profundidade: 2.5, altura: 2.7 },
        CORREDOR:      { nome: "Corredor",               grupo: "circulacao",  solido: false, largura: 4.0, profundidade: 1.2, altura: 0 },
        FAIXA_PEDESTRE:{ nome: "Faixa de pedestre",      grupo: "circulacao",  solido: false, largura: 1.2, profundidade: 3.0, altura: 0, regra: "FAIXA" },
        CRUZAMENTO_EMPILHADEIRA: { nome: "Cruzamento com empilhadeira", grupo: "circulacao", solido: false, largura: 3.0, profundidade: 3.0, altura: 0, regra: "FAIXA" },
        AREA_LIVRE:    { nome: "Área livre obrigatória", grupo: "circulacao",  solido: false, largura: 2.0, profundidade: 2.0, altura: 0, regra: "LIVRE" },
        ZONA_LENTA:    { nome: "Zona lenta",             grupo: "circulacao",  solido: false, largura: 2.0, profundidade: 2.0, altura: 0, regra: "LENTA" },
        ZONA_PROIBIDA: { nome: "Zona proibida",          grupo: "circulacao",  solido: false, largura: 2.0, profundidade: 2.0, altura: 0, regra: "PROIBIDA" },
        PESSOA:        { nome: "Pessoa (escala)",        grupo: "escala",      solido: false, largura: 0.5, profundidade: 0.4, altura: 1.75 },
        EMPILHADEIRA:  { nome: "Empilhadeira parada",    grupo: "escala",      solido: true,  largura: 2.3, profundidade: 1.1, altura: 2.1 }
    };


    /* ========================================================
       UTILITARIOS
       ======================================================== */

    function clonar(objeto) {
        return JSON.parse(JSON.stringify(objeto));
    }

    function arred(valor, casas = 3) {
        const f = Math.pow(10, casas);
        return Math.round(Number(valor) * f) / f;
    }

    function normalizarAngulo(angulo) {
        const a = Math.round(Number(angulo) || 0) % 360;
        return a < 0 ? a + 360 : a;
    }

    // Giro com sinal de "atual" para "alvo", entre -179 e 180 (+ = anti-horario)
    function calcularGiro(atual, alvo) {
        let delta = normalizarAngulo(alvo - atual);
        if (delta > 180) delta -= 360;
        return delta;
    }

    // Codigo como o RDM6300 manda: 10 caracteres hexadecimais (0-9, A-F).
    // Espacos, ":" e "-" digitados no meio sao removidos.
    const FORMATO_RFID = /^[0-9A-F]{10}$/;
    function normalizarRfid(rfid) {
        return String(rfid || "").replace(/[\s:-]/g, "").toUpperCase();
    }

    function criarVazia(nome = "Planta") {
        return {
            versao: VERSAO,
            revisao: 0,
            modelos016: true,
            nome,
            dimensoes: { largura: 20, altura: 12 },
            grade: 0.5,
            fundo: null,
            desenho: null,      // 0.17: DXF importado (importar-dxf.js)
            modelos3d: [],      // 0.17: GLB importados [{ id, nome, tamanho }] (arquivos-3d.js)
            galpao3d: null,     // 0.17: { modelo, x, y, rotacao, escala } o galpão em 3D
            layout: [],
            estacoes: [],
            nos: [],
            segmentos: [],
            dispositivos: []    // 0.19: Eciton I/O [{ id, nome, alarme }]
        };
    }

    function noPorId(planta, id) {
        return planta.nos.find(no => no.id === id) || null;
    }

    function segmentoPorId(planta, id) {
        return planta.segmentos.find(s => s.id === id) || null;
    }

    function estacaoPorId(planta, id) {
        return (planta.estacoes || []).find(e => e.id === id) || null;
    }

    function acessosDaEstacao(planta, estacaoId) {
        return planta.nos.filter(no => no.tipo === "ESTACAO" && no.estacao === estacaoId);
    }

    function estacaoDoNo(planta, no) {
        if (!no || no.tipo !== "ESTACAO") return null;
        return estacaoPorId(planta, no.estacao);
    }

    // Nome amigavel de um ponto: "Montagem (E04)" ou "Montagem · acesso Norte (E04-2)"
    function nomeDoPonto(planta, id) {
        const no = noPorId(planta, id);
        if (!no) {
            const estacao = estacaoPorId(planta, id);
            return estacao ? (estacao.nome ? `${estacao.nome} (${estacao.id})` : estacao.id) : (id || "");
        }
        const estacao = estacaoDoNo(planta, no);
        if (estacao) {
            const varios = acessosDaEstacao(planta, estacao.id).length > 1;
            const base = estacao.nome || estacao.id;
            const acesso = varios ? ` · ${no.nome ? "acesso " + no.nome : "acesso " + no.id}` : "";
            return `${base}${acesso} (${no.id})`;
        }
        return no.nome ? `${no.nome} (${no.id})` : no.id;
    }

    function comprimentoSegmento(planta, segmento) {
        const a = noPorId(planta, segmento.a);
        const b = noPorId(planta, segmento.b);
        if (!a || !b) return 0;
        if (segmento.tipo === "CURVA") {
            const g = geometriaCurva(planta, segmento);
            return g ? g.comprimento : 0;
        }
        return Math.hypot(b.x - a.x, b.y - a.y);
    }

    // Direcao (graus) de quem anda de "de" para "para"
    function anguloEntre(de, para) {
        return normalizarAngulo(Math.atan2(para.y - de.y, para.x - de.x) * 180 / Math.PI);
    }

    // Angulo exato (sem arredondar), para os avisos de alinhamento
    function anguloExato(de, para) {
        let a = Math.atan2(para.y - de.y, para.x - de.x) * 180 / Math.PI;
        if (a < 0) a += 360;
        return a;
    }

    function proximoId(lista, prefixo) {
        let maior = 0;
        const re = new RegExp("^" + prefixo + "(\\d+)$");
        lista.forEach(item => {
            const m = re.exec(typeof item === "string" ? item : item.id);
            if (m) maior = Math.max(maior, Number(m[1]));
        });
        return prefixo + String(maior + 1).padStart(2, "0");
    }

    function prefixoNo(tipo) {
        return tipo === "ESTACAO" ? "E" : tipo === "ESPERA" ? "W" : tipo === "BERCO" ? "B" : "R";
    }

    function tipoSegmento(segmento) {
        return segmento && (segmento.tipo === "LATERAL" || segmento.tipo === "CURVA") ? segmento.tipo : "LINHA";
    }

    // Segmento com fita no chão (ou caminho virtual, para o -L): linha reta ou curva
    function temFita(segmento) {
        return tipoSegmento(segmento) !== "LATERAL";
    }

    function guiaSegmento(planta, segmento) {
        if (tipoSegmento(segmento) === "LATERAL") return null;
        return GUIAS[segmento.guia] ? segmento.guia : (GUIAS[planta.guiaPadrao] ? planta.guiaPadrao : "OPTICA");
    }

    // Tags de um segmento na ordem de quem anda de "origem" para o outro lado
    function tagsNoSentido(planta, segmento, origemId) {
        const comprimento = comprimentoSegmento(planta, segmento);
        const tags = (segmento.tags || []).map(tag => ({
            rfid: normalizarRfid(tag.rfid),
            distancia: origemId === segmento.a ? Number(tag.distancia) : comprimento - Number(tag.distancia)
        }));
        return tags.sort((x, y) => x.distancia - y.distancia);
    }

    function segmentoPermite(segmento, origemId) {
        if (segmento.sentido === "A_PARA_B") return segmento.a === origemId;
        if (segmento.sentido === "B_PARA_A") return segmento.b === origemId;
        return true;
    }

    // Segmento "irmao": o outro sentido entre os mesmos dois pontos
    function segmentoGemeo(planta, segmento) {
        return planta.segmentos.find(s => s !== segmento && tipoSegmento(s) === tipoSegmento(segmento) &&
            ((s.a === segmento.a && s.b === segmento.b) || (s.a === segmento.b && s.b === segmento.a))) || null;
    }

    // Procura uma tag em nos e segmentos
    function rfidValido(rfid) {
        return FORMATO_RFID.test(normalizarRfid(rfid));
    }

    function localizarRfid(planta, rfid) {
        const alvo = normalizarRfid(rfid);
        if (!alvo) return null;
        const no = planta.nos.find(n => normalizarRfid(n.rfid) === alvo);
        if (no) return { tipo: "NO", no };
        for (const segmento of planta.segmentos) {
            const tag = (segmento.tags || []).find(t => normalizarRfid(t.rfid) === alvo);
            if (tag) return { tipo: "SEGMENTO", segmento, tag };
        }
        return null;
    }


    /* ========================================================
       GEOMETRIA (cruzamentos com zonas e obstaculos)
       ======================================================== */

    function cantosRetangulo(objeto) {
        const r = (Number(objeto.rotacao) || 0) * Math.PI / 180;
        const c = Math.cos(r), s = Math.sin(r);
        const hx = objeto.largura / 2, hy = objeto.profundidade / 2;
        return [[-hx, -hy], [hx, -hy], [hx, hy], [-hx, hy]].map(([x, y]) => ({
            x: objeto.x + x * c - y * s,
            y: objeto.y + x * s + y * c
        }));
    }

    function pontoNoRetangulo(p, objeto, folga = 0) {
        const r = -(Number(objeto.rotacao) || 0) * Math.PI / 180;
        const dx = p.x - objeto.x, dy = p.y - objeto.y;
        const lx = dx * Math.cos(r) - dy * Math.sin(r);
        const ly = dx * Math.sin(r) + dy * Math.cos(r);
        return Math.abs(lx) <= objeto.largura / 2 + folga && Math.abs(ly) <= objeto.profundidade / 2 + folga;
    }

    function segmentosSeCruzam(p1, p2, p3, p4) {
        const d = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
        const d1 = d(p3, p4, p1), d2 = d(p3, p4, p2), d3 = d(p1, p2, p3), d4 = d(p1, p2, p4);
        return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
    }

    function linhaCruzaRetangulo(p1, p2, objeto) {
        if (pontoNoRetangulo(p1, objeto) || pontoNoRetangulo(p2, objeto)) return true;
        const cantos = cantosRetangulo(objeto);
        for (let i = 0; i < 4; i++) {
            if (segmentosSeCruzam(p1, p2, cantos[i], cantos[(i + 1) % 4])) return true;
        }
        return false;
    }

    function distanciaPontoSegmento(p, a, b) {
        const dx = b.x - a.x, dy = b.y - a.y;
        const l2 = dx * dx + dy * dy;
        let t = l2 > 0 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2 : 0;
        t = Math.max(0, Math.min(1, t));
        return Math.hypot(a.x + t * dx - p.x, a.y + t * dy - p.y);
    }

    /* ========================================================
       CURVAS (0.16)
       ========================================================
       CURVA: arco de circunferência de raio "raio" ligando a ao b, virando
       para "lado" (ESQ = anti-horário, DIR = horário) de quem anda de a
       para b. Sempre o arco menor (até 180°). */

    const graus = r => r * 180 / Math.PI;

    // DXF importado (0.17): confere a estrutura e os números; inválido = sem desenho
    function normalizarDesenho(d) {
        if (!d || typeof d !== "object" || !Array.isArray(d.linhas) || !Array.isArray(d.camadas)) return null;
        const n = (v, padrao) => Number.isFinite(Number(v)) ? Number(v) : padrao;
        const camadas = d.camadas.slice(0, 500).map(c => ({
            nome: String(c.nome || "0").slice(0, 80), linhas: Math.max(0, n(c.linhas, 0) | 0), visivel: c.visivel !== false,
            uso: ["fundo", "paredes", "oculta"].includes(c.uso) ? c.uso : "fundo"
        }));
        const linhas = d.linhas.filter(l => l && Array.isArray(l.p) && l.p.length >= 4 && l.p.length % 2 === 0 && Number.isInteger(l.c) && l.c >= 0 && l.c < camadas.length)
            .map(l => ({ c: l.c, p: l.p.map(v => n(v, 0)) }));
        if (!linhas.length) return null;
        return {
            nome: String(d.nome || "desenho.dxf").slice(0, 80), unidade: String(d.unidade || ""), fator: n(d.fator, 1),
            camadas, linhas, x: n(d.x, 0), y: n(d.y, 0), rotacao: n(d.rotacao, 0), escala: Math.max(1e-4, n(d.escala, 1)),
            opacidade: Math.max(0.05, Math.min(1, n(d.opacidade, 0.55))), largura: n(d.largura, 0), altura: n(d.altura, 0)
        };
    }

    // Linhas das camadas "paredes" do desenho, já na posição da planta
    function paredesDoDesenho(planta) {
        const d = planta.desenho;
        const lista = [];
        if (!d) return lista;
        const a = (d.rotacao || 0) * Math.PI / 180, e = d.escala || 1, c = Math.cos(a), s = Math.sin(a);
        const pp = (x, y) => ({ x: d.x + e * (x * c - y * s), y: d.y + e * (x * s + y * c) });
        d.linhas.forEach(l => {
            const cam = d.camadas[l.c];
            if (!cam || cam.uso !== "paredes") return;
            for (let i = 2; i < l.p.length; i += 2) lista.push([pp(l.p[i - 2], l.p[i - 1]), pp(l.p[i], l.p[i + 1])]);
        });
        return lista;
    }

    function geometriaCurva(planta, s) {
        const a = noPorId(planta, s.a), b = noPorId(planta, s.b);
        if (!a || !b) return null;
        const corda = Math.hypot(b.x - a.x, b.y - a.y);
        if (corda < 1e-6) return null;
        const R = Math.max(Number(s.raio) || 0, corda / 2);
        const esq = s.lado !== "DIR";
        const sg = esq ? 1 : -1;
        const ux = (b.x - a.x) / corda, uy = (b.y - a.y) / corda;
        const h = Math.sqrt(Math.max(0, R * R - corda * corda / 4));
        const cx = (a.x + b.x) / 2 - uy * h * sg, cy = (a.y + b.y) / 2 + ux * h * sg;
        const a0 = Math.atan2(a.y - cy, a.x - cx), a1 = Math.atan2(b.y - cy, b.x - cx);
        let varredura = a1 - a0;
        if (esq) { while (varredura <= 1e-9) varredura += 2 * Math.PI; while (varredura > 2 * Math.PI) varredura -= 2 * Math.PI; }
        else { while (varredura >= -1e-9) varredura -= 2 * Math.PI; while (varredura < -2 * Math.PI) varredura += 2 * Math.PI; }
        return {
            cx, cy, R, a0, varredura, esq, corda,
            comprimento: R * Math.abs(varredura),
            rumoA: graus(a0 + sg * Math.PI / 2),      // frente em a, andando para b
            rumoB: graus(a1 + sg * Math.PI / 2),      // frente ao chegar em b
            raioPedido: Number(s.raio) || 0
        };
    }

    // Frente (graus, exata) de quem sai de "deId" pelo segmento
    function rumoExatoSaida(planta, s, deId) {
        if (tipoSegmento(s) === "CURVA") {
            const g = geometriaCurva(planta, s);
            if (!g) return 0;
            return deId === s.a ? g.rumoA : g.rumoB + 180;
        }
        const de = noPorId(planta, deId), para = noPorId(planta, deId === s.a ? s.b : s.a);
        return de && para ? anguloExato(de, para) : 0;
    }

    // Frente (graus, exata) ao chegar na outra ponta, saindo de "deId"
    function rumoExatoChegada(planta, s, deId) {
        if (tipoSegmento(s) === "CURVA") {
            const g = geometriaCurva(planta, s);
            if (!g) return 0;
            return deId === s.a ? g.rumoB : g.rumoA + 180;
        }
        return rumoExatoSaida(planta, s, deId);
    }

    // Ponto a "d" metros de "deId" ao longo do segmento, com a frente
    function pontoNoSegmento(planta, s, deId, d) {
        const de = noPorId(planta, deId), outroId = deId === s.a ? s.b : s.a, para = noPorId(planta, outroId);
        if (!de || !para) return null;
        const L = comprimentoSegmento(planta, s) || 1;
        const dd = Math.max(0, Math.min(L, Number(d) || 0));
        if (tipoSegmento(s) === "CURVA") {
            const g = geometriaCurva(planta, s);
            const ida = deId === s.a;
            const sinal = (g.varredura > 0 ? 1 : -1) * (ida ? 1 : -1);
            const inicio = ida ? g.a0 : g.a0 + g.varredura;
            const ang = inicio + sinal * dd / g.R;
            return { x: g.cx + g.R * Math.cos(ang), y: g.cy + g.R * Math.sin(ang), rumo: normalizarAngulo(graus(ang + sinal * Math.PI / 2)) };
        }
        const f = dd / L;
        return { x: de.x + (para.x - de.x) * f, y: de.y + (para.y - de.y) * f, rumo: anguloEntre(de, para) };
    }

    // Polilinha do segmento (de a para b), para desenhar e para as contas de geometria
    function pontosSegmento(planta, s, passo = 0.15) {
        const a = noPorId(planta, s.a), b = noPorId(planta, s.b);
        if (!a || !b) return [];
        if (tipoSegmento(s) !== "CURVA") return [{ x: a.x, y: a.y }, { x: b.x, y: b.y }];
        const L = comprimentoSegmento(planta, s);
        const n = Math.max(4, Math.ceil(L / passo));
        const pts = [];
        for (let i = 0; i <= n; i++) { const p = pontoNoSegmento(planta, s, s.a, L * i / n); pts.push({ x: p.x, y: p.y }); }
        return pts;
    }

    function segmentoCruzaRetangulo(planta, s, objeto) {
        const pts = pontosSegmento(planta, s);
        for (let i = 1; i < pts.length; i++) if (linhaCruzaRetangulo(pts[i - 1], pts[i], objeto)) return true;
        return false;
    }

    function polilinhasSeCruzam(p, q) {
        for (let i = 1; i < p.length; i++) for (let k = 1; k < q.length; k++) {
            if (segmentosSeCruzam(p[i - 1], p[i], q[k - 1], q[k])) return true;
        }
        return false;
    }

    // Trechos [inicio, fim] (metros desde "deId") em que o segmento passa por
    // objetos com a regra FAIXA (faixa de pedestre, cruzamento com empilhadeira)
    function faixasNoSegmento(planta, s, deId) {
        const faixas = (planta.layout || []).filter(o => TIPOS_LAYOUT[o.tipo]?.regra === "FAIXA");
        if (!faixas.length || !temFita(s)) return [];
        const L = comprimentoSegmento(planta, s);
        const passo = 0.02, n = Math.max(2, Math.ceil(L / passo));
        const lista = [];
        faixas.forEach(o => {
            if (!segmentoCruzaRetangulo(planta, s, o)) return;
            let ini = null;
            for (let i = 0; i <= n; i++) {
                const d = L * i / n, p = pontoNoSegmento(planta, s, deId, d);
                const dentro = pontoNoRetangulo(p, o);
                if (dentro && ini === null) ini = d;
                if (!dentro && ini !== null) { lista.push({ inicio: ini, fim: d, objeto: o }); ini = null; }
            }
            if (ini !== null) lista.push({ inicio: ini, fim: L, objeto: o });
        });
        return lista.sort((x, y) => x.inicio - y.inicio);
    }

    // Bifurcação: outras fitas que saem do mesmo ponto quase na mesma direção.
    // Devolve de que borda da fita o Atta segue ali: +1 esquerda, -1 direita, 0 nenhuma.
    //   saida = true: o Atta sai de noId por s; false: chega em noId por s
    function bordaNoPonto(planta, s, noId, saida) {
        if (!temFita(s)) return 0;
        const guia = guiaSegmento(planta, s);
        if (guia === "VIRTUAL") return 0;
        const base = noPorId(planta, noId);
        if (!base) return 0;
        // direção de cada fita pelo ponto a 30 cm do nó (a curva sai tangente,
        // então a direção na ponta é igual à da reta; 30 cm adiante elas já se separam)
        const direcao = seg => {
            const p = pontoNoSegmento(planta, seg, noId, Math.min(0.3, comprimentoSegmento(planta, seg)));
            const L = Math.hypot(p.x - base.x, p.y - base.y) || 1;
            return { x: (p.x - base.x) / L, y: (p.y - base.y) / L };
        };
        const minha = direcao(s);
        const anda = saida ? minha : { x: -minha.x, y: -minha.y };
        let esquerda = false, direita = false;
        planta.segmentos.forEach(o => {
            if (o === s || !temFita(o) || (o.a !== noId && o.b !== noId)) return;
            if (guiaSegmento(planta, o) !== guia) return;
            const outra = direcao(o);
            const ang = Math.acos(Math.max(-1, Math.min(1, minha.x * outra.x + minha.y * outra.y))) * 180 / Math.PI;
            if (ang < 0.5 || ang > ANGULO_BIFURCACAO) return;
            if (anda.x * outra.y - anda.y * outra.x > 0) esquerda = true; else direita = true;
        });
        if (esquerda === direita) return 0;
        // a outra fita à esquerda: segue a borda direita da sua (e vice-versa)
        return esquerda ? -1 : 1;
    }

    // Comprimento do trecho e direções no sentido de quem anda, para o editor e os testes
    function descreverSegmento(planta, s, deId = s.a) {
        return {
            comprimento: comprimentoSegmento(planta, s),
            saida: normalizarAngulo(rumoExatoSaida(planta, s, deId)),
            chegada: normalizarAngulo(rumoExatoChegada(planta, s, deId))
        };
    }

    function velocidadeSegmento(planta, segmento) {
        if (tipoSegmento(segmento) === "LATERAL") return 0;
        let v = Number(segmento.velocidadeMaxima) || 0;
        const a = noPorId(planta, segmento.a), b = noPorId(planta, segmento.b);
        if (a && b) {
            planta.layout
                .filter(o => o.tipo === "ZONA_LENTA" && Number(o.velocidadeMaxima) > 0 && horarioAtivo(o))
                .forEach(zona => {
                    if (segmentoCruzaRetangulo(planta, segmento, zona)) {
                        v = v > 0 ? Math.min(v, zona.velocidadeMaxima) : Number(zona.velocidadeMaxima);
                    }
                });
        }
        return v > 0 ? Math.min(v, LIMITES.velocidadeMaxima) : 0;
    }

    // Diferenca (graus, 0 a 90) entre a direcao de um segmento e a de outro
    function diferencaDirecao(a1, a2) {
        let d = Math.abs(((a1 - a2) % 180 + 180) % 180);
        return d > 90 ? 180 - d : d;
    }

    // Para a troca lateral: a direcao do salto e perpendicular as linhas dos dois lados?
    function lateralPerpendicular(planta, segmento) {
        const a = noPorId(planta, segmento.a), b = noPorId(planta, segmento.b);
        if (!a || !b) return false;
        const salto = anguloExato(a, b);
        const linhasDe = no => planta.segmentos.filter(s => temFita(s) && (s.a === no.id || s.b === no.id))
            .map(s => rumoExatoSaida(planta, s, no.id));
        const ok = no => linhasDe(no).some(ang => Math.abs(diferencaDirecao(ang, salto) - 90) <= 15);
        return ok(a) && ok(b);
    }

    // Sugestao para ligar duas faixas paralelas a esta distancia
    function sugestaoTrocaFaixa(distancia) {
        if (!(distancia > 0)) return null;
        if (distancia < LIMITES.lateralMinima) {
            return { tipo: "NENHUMA", texto: "As faixas estão coladas: aumente a distância entre elas." };
        }
        if (distancia <= DISTANCIA_SUGESTAO_LATERAL) {
            return {
                tipo: "LATERAL",
                texto: `Faixas a ${arred(distancia, 2)} m: troca lateral (anda de lado, sem fita e sem girar).`
            };
        }
        return {
            tipo: "LINHA",
            texto: `Faixas a ${arred(distancia, 2)} m: retorno com fita (a troca lateral andaria ${arred(distancia, 2)} m sem os sensores de distância).`
        };
    }


    /* ========================================================
       NORMALIZACAO E MIGRACAO
       ======================================================== */

    /* ========================================================
       ECITON I/O (0.19): portas automáticas, semáforos e alarme
       ========================================================
       planta.dispositivos: [{ id: "IO1", nome, alarme: { entrada: 4, nf: true } | null }]
       objeto.io (porta automática):   { dispositivo, rele, aberta, fechada, fechar, abrirMax }
       objeto.io (faixa / cruzamento): { dispositivo, vermelho, verde, botao, segurar }
       Reles e entradas numerados 1..4. A zona de tráfego do objeto é "P"+id
       (porta) ou "F"+id (faixa/cruzamento): o módulo ocupa a zona e os Atta
       pedem, como num cruzamento. */
    const IO = { reles: 4, entradas: 4, maxZonas: 8, fecharPadrao: 5, abrirMaxPadrao: 15, segurarPadrao: 20, folgaPorta: 0.5, pontoPorta: 1.5 };
    const TEM_HORARIO = ["ZONA_LENTA", "ZONA_PROIBIDA"];
    const idIoValido = id => /^[A-Za-z0-9_-]{1,12}$/.test(String(id || ""));
    const pino = (v, max) => { const n = Math.round(Number(v)); return n >= 1 && n <= max ? n : 0; };

    function normalizarDispositivo(d) {
        if (!d || !idIoValido(d.id)) return null;
        const r = { id: String(d.id), nome: String(d.nome || "").slice(0, 40) };
        const e = pino(d.alarme?.entrada, IO.entradas);
        r.alarme = d.alarme && e ? { entrada: e, nf: d.alarme.nf !== false } : null;
        if (d.virtual) r.virtual = true;
        return r;
    }

    function normalizarIoObjeto(o) {
        const regra = TIPOS_LAYOUT[o.tipo]?.regra;
        if (!o.io || (regra !== "PORTA" && regra !== "FAIXA")) { delete o.io; return; }
        const d = String(o.io.dispositivo || "");
        if (regra === "PORTA") {
            o.io = { dispositivo: d, rele: pino(o.io.rele, IO.reles), aberta: pino(o.io.aberta, IO.entradas), fechada: pino(o.io.fechada, IO.entradas),
                     fechar: Math.min(120, Math.max(1, Math.round(Number(o.io.fechar) || IO.fecharPadrao))),
                     abrirMax: Math.min(120, Math.max(2, Math.round(Number(o.io.abrirMax) || IO.abrirMaxPadrao))) };
        } else {
            o.io = { dispositivo: d, vermelho: pino(o.io.vermelho, IO.reles), verde: pino(o.io.verde, IO.reles), botao: pino(o.io.botao, IO.entradas),
                     segurar: Math.min(600, Math.max(3, Math.round(Number(o.io.segurar) || IO.segurarPadrao))) };
        }
        if (!d) delete o.io;
    }

    // "HH:MM" -> minutos do dia
    const minutos = t => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(t || "")); return m ? Math.min(1439, Number(m[1]) * 60 + Number(m[2])) : null; };
    function normalizarHorario(h) {
        const de = minutos(h?.de), ate = minutos(h?.ate);
        if (de === null || ate === null || de === ate) return null;
        const dias = Array.isArray(h.dias) ? [...new Set(h.dias.map(Number).filter(d => d >= 0 && d <= 6))].sort() : [0, 1, 2, 3, 4, 5, 6];
        const fmt = m => String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0");
        return { de: fmt(de), ate: fmt(ate), dias: dias.length ? dias : [0, 1, 2, 3, 4, 5, 6] };
    }
    // A regra vale agora? Sem horário: sempre. Atravessa a meia-noite se "de" > "ate".
    function horarioAtivo(objeto, agora = null) {
        if (!objeto.horario) return true;
        const d = agora || contextoRota.agora || new Date();
        const m = d.getHours() * 60 + d.getMinutes(), de = minutos(objeto.horario.de), ate = minutos(objeto.horario.ate);
        const dia = d.getDay(), ontem = (dia + 6) % 7;
        if (de < ate) return objeto.horario.dias.includes(dia) && m >= de && m < ate;
        return (m >= de && objeto.horario.dias.includes(dia)) || (m < ate && objeto.horario.dias.includes(ontem));
    }
    function descreverHorario(h) {
        if (!h) return "sempre";
        const NOMES = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
        const dias = h.dias.length === 7 ? "todo dia" : h.dias.length === 5 && h.dias.join() === "1,2,3,4,5" ? "seg a sex" : h.dias.map(d => NOMES[d]).join(", ");
        return `das ${h.de} às ${h.ate}, ${dias}`;
    }

    // Contexto das rotas (0.19): corredores fechados agora e a hora (regras por horário).
    // O site atualiza; os testes podem fixar a hora.
    const contextoRota = { fechados: new Set(), agora: null };
    function definirContextoRota(c = {}) {
        if (c.fechados !== undefined) contextoRota.fechados = new Set(c.fechados || []);
        if (c.agora !== undefined) contextoRota.agora = c.agora;
        return { fechados: [...contextoRota.fechados], agora: contextoRota.agora };
    }
    // Por que nenhum Atta pode passar por este segmento agora (null = pode)
    function recusaAgora(planta, s) {
        if (contextoRota.fechados.has(s.id)) return "corredor fechado";
        const z = (planta.layout || []).find(o => o.tipo === "ZONA_PROIBIDA" && o.horario && horarioAtivo(o) && segmentoCruzaRetangulo(planta, s, o));
        return z ? `zona proibida agora (${z.nome || z.id}, ${descreverHorario(z.horario)})` : null;
    }

    const zonaDoObjetoIo = o => ((TIPOS_LAYOUT[o.tipo]?.regra === "PORTA" ? "P" : "F") + o.id).slice(0, 9);
    function objetosIo(planta, dispositivoId = null) {
        return (planta.layout || []).filter(o => o.io && (!dispositivoId || o.io.dispositivo === dispositivoId));
    }

    // A configuração que o site manda para o módulo (config/io, retida)
    function configIO(planta, dispositivoId) {
        const d = (planta.dispositivos || []).find(x => x.id === dispositivoId);
        if (!d) return null;
        const portas = [], cruzamentos = [];
        objetosIo(planta, dispositivoId).forEach(o => {
            const nome = o.nome || TIPOS_LAYOUT[o.tipo].nome;
            if (TIPOS_LAYOUT[o.tipo].regra === "PORTA") {
                const p = { id: o.id, nome, zona: zonaDoObjetoIo(o), rele: o.io.rele, aberta: o.io.aberta, fechar: o.io.fechar, abrirMax: o.io.abrirMax };
                if (o.io.fechada) p.fechada = o.io.fechada;
                portas.push(p);
            } else {
                const c = { id: o.id, nome, zona: zonaDoObjetoIo(o), segurar: o.io.segurar };
                if (o.io.vermelho) c.vermelho = o.io.vermelho;
                if (o.io.verde) c.verde = o.io.verde;
                if (o.io.botao) c.botao = o.io.botao;
                cruzamentos.push(c);
            }
        });
        const cfg = { rev: Number(planta.revisao) || 0, portas, cruzamentos };
        if (d.alarme) cfg.alarme = { entrada: d.alarme.entrada, nf: d.alarme.nf };
        return cfg;
    }

    // Problemas do Eciton I/O (erros impedem publicar)
    function validarIO(planta, erros, avisos) {
        const disp = planta.dispositivos || [];
        const usados = new Map();   // dispositivo -> { reles: Map, entradas: Map, zonas }
        const uso = id => { if (!usados.has(id)) usados.set(id, { reles: new Map(), entradas: new Map(), zonas: 0 }); return usados.get(id); };
        const marcar = (id, tipo, n, quem, alvo) => {
            if (!n) return;
            const u = uso(id)[tipo];
            const nome = tipo === "reles" ? `Relé ${n}` : `Entrada ${n}`;
            if (u.has(n)) erros.push({ alvo, msg: `${id}: ${nome} usado em ${u.get(n)} e em ${quem}.` });
            else u.set(n, quem);
        };
        disp.forEach(d => { if (d.alarme) marcar(d.id, "entradas", d.alarme.entrada, "alarme de incêndio", null); });
        (planta.layout || []).forEach(o => {
            const regra = TIPOS_LAYOUT[o.tipo]?.regra;
            const nome = o.nome || `${TIPOS_LAYOUT[o.tipo]?.nome || "objeto"} ${o.id}`;
            if (regra === "PORTA" && !o.io) {
                avisos.push({ alvo: o.id, msg: `${nome}: porta automática sem Eciton I/O. Os Atta passam sem pedir para abrir; ligue a porta a um módulo.` });
                return;
            }
            if (!o.io) return;
            if (!disp.some(d => d.id === o.io.dispositivo)) { erros.push({ alvo: o.id, msg: `${nome}: o módulo ${o.io.dispositivo} não existe (crie em Dispositivos da planta).` }); return; }
            const u = uso(o.io.dispositivo);
            u.zonas++;
            if (regra === "PORTA") {
                if (!o.io.rele) erros.push({ alvo: o.id, msg: `${nome}: escolha o relé que abre a porta.` });
                if (!o.io.aberta) erros.push({ alvo: o.id, msg: `${nome}: escolha a entrada do sensor "aberta" (o Atta só passa com a porta confirmada aberta).` });
                marcar(o.io.dispositivo, "reles", o.io.rele, nome, o.id);
                marcar(o.io.dispositivo, "entradas", o.io.aberta, nome + " (aberta)", o.id);
                marcar(o.io.dispositivo, "entradas", o.io.fechada, nome + " (fechada)", o.id);
                const cruzam = planta.segmentos.filter(s => temFita(s) && noPorId(planta, s.a) && noPorId(planta, s.b) && segmentoCruzaRetangulo(planta, s, o));
                if (!cruzam.length) avisos.push({ alvo: o.id, msg: `${nome}: nenhuma fita passa pela porta.` });
                cruzam.forEach(s => {
                    if (comprimentoSegmento(planta, s) > 6) avisos.push({ alvo: s.id, msg: `${nome}: o trecho ${s.id} que passa pela porta é longo; ponha um ponto de cada lado da porta (botão "Criar pontos dos dois lados") para ela abrir só na hora.` });
                });
                planta.nos.forEach(no => {
                    if (pontoNoRetangulo(no, o, IO.folgaPorta)) erros.push({ alvo: no.id, msg: `${no.id} está embaixo (ou colado) da ${nome}: o Atta nunca pode parar ali. Mude o ponto para fora.` });
                });
            } else {
                if (!o.io.vermelho && !o.io.verde && !o.io.botao) erros.push({ alvo: o.id, msg: `${nome}: escolha o relé do semáforo ou a entrada do botão.` });
                marcar(o.io.dispositivo, "reles", o.io.vermelho, nome + " (vermelho)", o.id);
                marcar(o.io.dispositivo, "reles", o.io.verde, nome + " (verde)", o.id);
                marcar(o.io.dispositivo, "entradas", o.io.botao, nome + " (botão)", o.id);
            }
        });
        disp.forEach(d => {
            const u = usados.get(d.id);
            if (!u || (!u.zonas && !d.alarme)) avisos.push({ alvo: null, msg: `Módulo ${d.id}${d.nome ? " (" + d.nome + ")" : ""} sem nada ligado.` });
            if (u && u.zonas > IO.maxZonas) erros.push({ alvo: null, msg: `Módulo ${d.id}: no máximo ${IO.maxZonas} portas e cruzamentos.` });
            const portas = objetosIo(planta, d.id).filter(o => TIPOS_LAYOUT[o.tipo].regra === "PORTA").length;
            if (portas > 4 || objetosIo(planta, d.id).length - portas > 4) erros.push({ alvo: null, msg: `Módulo ${d.id}: no máximo 4 portas e 4 cruzamentos.` });
        });
    }

    // Pontos de referência dos dois lados da porta (a porta abre só quando o Atta chega perto)
    function criarPontosPorta(planta, objetoId, distancia = IO.pontoPorta) {
        const o = (planta.layout || []).find(x => x.id === objetoId);
        if (!o) return { sucesso: false, erro: "Porta não encontrada." };
        const criados = [];
        const cruzam = planta.segmentos.filter(s => tipoSegmento(s) === "LINHA" && segmentoCruzaRetangulo(planta, s, o));
        if (!cruzam.length) return { sucesso: false, erro: "Nenhuma linha reta passa pela porta." };
        const vistos = new Set();
        cruzam.forEach(s0 => {
            if (vistos.has(s0.id)) return;
            const g = segmentoGemeo(planta, s0);
            if (g) vistos.add(g.id);
            let s = s0;
            const a = noPorId(planta, s.a), b = noPorId(planta, s.b);
            const L = comprimentoSegmento(planta, s);
            // onde a fita entra e sai da porta (amostra de 2 cm)
            let primeiro = null, ultimo = null;
            for (let d = 0; d <= L; d += 0.02) {
                const f = d / L, q = { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
                if (pontoNoRetangulo(q, o)) { if (primeiro === null) primeiro = d; ultimo = d; }
            }
            if (primeiro === null) return;
            const antes = primeiro - distancia, depois = ultimo + distancia;
            // primeiro o ponto de depois (as distâncias de antes continuam valendo)
            if (depois <= L - 0.3) { const r = dividirSegmento(planta, s.id, arred(depois, 2)); if (r.sucesso) criados.push(r.ponto.id); }
            if (antes >= 0.3) { const r = dividirSegmento(planta, s.id, arred(antes, 2)); if (r.sucesso) criados.push(r.ponto.id); }
        });
        return criados.length ? { sucesso: true, pontos: criados } : { sucesso: false, erro: "A porta já está perto dos pontos (nada a dividir)." };
    }

    function normalizar(entrada) {
        const p = Object.assign(criarVazia(), clonar(entrada || {}));
        p.versao = VERSAO;
        p.revisao = Number(p.revisao) || 0;
        p.dimensoes = {
            largura: Math.max(1, Number(p.dimensoes?.largura) || 20),
            altura: Math.max(1, Number(p.dimensoes?.altura) || 12)
        };
        p.grade = Math.max(0.05, Number(p.grade) || 0.5);
        p.layout = Array.isArray(p.layout) ? p.layout : [];
        p.estacoes = Array.isArray(p.estacoes) ? p.estacoes : [];
        p.nos = Array.isArray(p.nos) ? p.nos : [];
        p.segmentos = Array.isArray(p.segmentos) ? p.segmentos : [];

        p.layout.forEach(o => {
            o.x = Number(o.x) || 0;
            o.y = Number(o.y) || 0;
            o.largura = Math.max(0.05, Number(o.largura) || 1);
            o.profundidade = Math.max(0.05, Number(o.profundidade) || 1);
            o.rotacao = Number(o.rotacao) || 0;
            if (!TIPOS_LAYOUT[o.tipo]) o.tipo = "MAQUINA";
            if (Number(o.altura) > 0) o.altura = arred(Number(o.altura), 2); else delete o.altura;
            normalizarIoObjeto(o);
            if (TEM_HORARIO.includes(o.tipo) && o.horario) o.horario = normalizarHorario(o.horario); else delete o.horario;
            if (!o.horario) delete o.horario;
        });
        p.dispositivos = (Array.isArray(p.dispositivos) ? p.dispositivos : []).map(normalizarDispositivo).filter(Boolean)
            .filter((d, i, l) => l.findIndex(x => x.id === d.id) === i);
        p.estacoes.forEach(e => {
            e.id = String(e.id || "");
            e.nome = e.nome || "";
            if (!e.maquina) delete e.maquina;
            if (Array.isArray(e.modelos)) { e.modelos = e.modelos.map(String).filter(Boolean); if (!e.modelos.length) delete e.modelos; } else delete e.modelos;
            if (!CARGAS[e.carga]) delete e.carga;
            if (!["ESQ", "DIR", "FRENTE"].includes(e.lado)) delete e.lado;
            if (Number(e.altura) > 0) e.altura = Math.round(Number(e.altura)); else delete e.altura;
        });
        p.nos.forEach(no => {
            no.x = Number(no.x) || 0;
            no.y = Number(no.y) || 0;
            if (!TIPOS_NO.includes(no.tipo)) no.tipo = "REFERENCIA";
            no.rfid = normalizarRfid(no.rfid);
            no.nome = no.nome || "";
            no.barreira = Number(no.barreira) || 0;
            if (no.tipo === "ESTACAO") {
                no.orientacaoChegada = no.orientacaoChegada === null || no.orientacaoChegada === undefined ||
                                       no.orientacaoChegada === ""
                    ? null : normalizarAngulo(no.orientacaoChegada);
                // Planta v2: cada ponto ESTACAO era uma estacao com um acesso.
                if (!no.estacao || !estacaoPorId(p, no.estacao)) {
                    const id = no.estacao || no.id;
                    if (!estacaoPorId(p, id)) {
                        const estacao = { id, nome: no.nome };
                        if (no.maquina) estacao.maquina = no.maquina;
                        p.estacoes.push(estacao);
                        no.nome = "";
                    }
                    no.estacao = id;
                }
                delete no.maquina;
            } else if (no.tipo === "BERCO") {
                // berço: o AGV estaciona sempre virado para o mesmo lado (para se reconhecer ao ligar)
                no.orientacaoChegada = no.orientacaoChegada === null || no.orientacaoChegada === undefined ||
                                       no.orientacaoChegada === "" ? null : normalizarAngulo(no.orientacaoChegada);
                delete no.estacao;
                delete no.maquina;
            } else {
                no.orientacaoChegada = null;
                delete no.estacao;
            }
        });
        p.segmentos.forEach(s => {
            s.tipo = TIPOS_SEGMENTO.includes(s.tipo) ? s.tipo : "LINHA";
            if (!["DUPLO", "A_PARA_B", "B_PARA_A"].includes(s.sentido)) s.sentido = "DUPLO";
            s.velocidadeMaxima = s.tipo === "LATERAL" ? 0 : Number(s.velocidadeMaxima) || 0;
            s.barreira = Number(s.barreira) || 0;
            s.tags = s.tipo !== "LATERAL" && Array.isArray(s.tags)
                ? s.tags.map(t => ({ rfid: normalizarRfid(t.rfid), distancia: arred(Number(t.distancia) || 0) }))
                : [];
            if (s.tipo === "CURVA") {
                s.raio = arred(Math.max(0, Number(s.raio) || 0));
                s.lado = s.lado === "DIR" ? "DIR" : "ESQ";
            } else { delete s.raio; delete s.lado; }
            if (s.tipo === "LATERAL" || !GUIAS[s.guia]) delete s.guia;
            if (Array.isArray(s.modulos)) { s.modulos = s.modulos.map(String).filter(m => /^[GERT]$/.test(m)); if (!s.modulos.length) delete s.modulos; } else delete s.modulos;
            if (s.ramal) s.ramal = true; else delete s.ramal;
        });
        if (!GUIAS[p.guiaPadrao]) delete p.guiaPadrao;
        // 0.16.1: até a 0.15 o protótipo se chamava "atta-g-o"; agora ele é o "atta-e-o"
        // e "atta-g-o" é a família de garras. Planta antiga: a estação que era do
        // protótipo continua do protótipo.
        p.desenho = normalizarDesenho(p.desenho);
        // modelos 3D (GLB): só a referência; o arquivo fica no Storage / no navegador
        p.modelos3d = (Array.isArray(p.modelos3d) ? p.modelos3d : []).filter(m => m && /^[0-9a-f]{20}$/.test(m.id))
            .map(m => ({ id: m.id, nome: String(m.nome || "modelo.glb").slice(0, 80), tamanho: Math.max(0, Number(m.tamanho) || 0) }));
        const temModelo = id => p.modelos3d.some(m => m.id === id);
        p.layout.forEach(o => {
            if (o.modelo3d && temModelo(o.modelo3d)) o.ajuste3d = o.ajuste3d === "real" ? "real" : "caber";
            else { delete o.modelo3d; delete o.ajuste3d; }
        });
        const g = p.galpao3d;
        p.galpao3d = g && temModelo(g.modelo) ? { modelo: g.modelo, x: Number(g.x) || 0, y: Number(g.y) || 0, rotacao: Number(g.rotacao) || 0, escala: Math.max(0.0001, Number(g.escala) || 1) } : null;
        if (!(entrada && entrada.modelos016)) {
            (p.estacoes || []).forEach(e => { if (Array.isArray(e.modelos)) e.modelos = [...new Set(e.modelos.map(m => m === "atta-g-o" ? "atta-e-o" : m))]; });
            p.modelos016 = true;
        }
        return p;
    }

    // Planta antiga (v1): pontos em % do mapa (y para baixo), cada ponto com
    // uma ou mais tags e conexoes que dizem qual tag usar em cada sentido
    // (dupla faixa = tags diferentes na ida e na volta). Cada tag vira um
    // ponto proprio; os pontos de uma mesma estacao viram acessos dela.
    function migrarV1(antiga, largura = 10, altura = 6) {
        const nova = criarVazia("Planta migrada");
        nova.dimensoes = { largura, altura };
        const avisos = [];
        if (!antiga || !Array.isArray(antiga.pontos)) {
            return { planta: nova, avisos };
        }
        const SEPARACAO = 0.30;   // distancia entre os pontos criados a partir de um ponto antigo
        const porRfid = new Map();
        const principal = new Map();   // ponto antigo -> id do primeiro no criado
        const conexoes = antiga.conexoes || [];

        const posicaoAntiga = ponto => ({
            x: arred((Number(ponto.x) || 0) / 100 * largura),
            y: arred((100 - (Number(ponto.y) || 0)) / 100 * altura)
        });
        const pontoAntigo = id => antiga.pontos.find(p => String(p.id) === String(id));

        antiga.pontos.forEach(ponto => {
            const id = String(ponto.id);
            const rfids = (Array.isArray(ponto.rfids) ? ponto.rfids : (ponto.rfid ? [ponto.rfid] : []))
                .map(normalizarRfid).filter(Boolean);
            const lista = rfids.length ? rfids : [""];
            const centro = posicaoAntiga(ponto);
            const ehEstacao = ponto.tipo === "ESTACAO";

            // Direcao das conexoes deste ponto: os pontos extras ficam lado a lado,
            // perpendiculares a ela (como faixas paralelas).
            let dx = 0, dy = 0;
            conexoes.forEach(c => {
                const a = String(c.origem || c.pontoA), b = String(c.destino || c.pontoB);
                if (a !== id && b !== id) return;
                const outro = pontoAntigo(a === id ? b : a);
                if (!outro) return;
                const q = posicaoAntiga(outro);
                const L = Math.hypot(q.x - centro.x, q.y - centro.y) || 1;
                let ux = (q.x - centro.x) / L, uy = (q.y - centro.y) / L;
                if (ux < -1e-9 || (Math.abs(ux) < 1e-9 && uy < 0)) { ux = -ux; uy = -uy; }
                dx += ux; dy += uy;
            });
            const L = Math.hypot(dx, dy);
            const perp = L > 1e-6 ? { x: -dy / L, y: dx / L } : { x: 0, y: 1 };

            if (ehEstacao) {
                nova.estacoes.push({ id, nome: ponto.nome || ponto.nomeEstacao || "" });
            }
            lista.forEach((rfid, k) => {
                const deslocamento = (k - (lista.length - 1) / 2) * SEPARACAO;
                const noId = lista.length === 1 ? id : `${id}-${k + 1}`.slice(0, LIMITES.tamanhoId);
                nova.nos.push({
                    id: noId,
                    tipo: ehEstacao ? "ESTACAO" : "REFERENCIA",
                    nome: "",
                    x: arred(centro.x + perp.x * deslocamento),
                    y: arred(centro.y + perp.y * deslocamento),
                    rfid,
                    orientacaoChegada: ehEstacao ? 90 : null,
                    barreira: 0,
                    estacao: ehEstacao ? id : undefined
                });
                if (rfid) porRfid.set(rfid, noId);
                if (k === 0) principal.set(id, noId);
            });
            if (lista.length > 1) {
                avisos.push(`${id} tinha ${lista.length} tags: virou ${lista.length} pontos lado a lado ` +
                            `(${SEPARACAO} m)${ehEstacao ? ", como acessos da mesma estação" : ""}. Confira no desenho.`);
            }
        });

        const noDaTag = (rfid, pontoId) => porRfid.get(normalizarRfid(rfid)) || principal.get(String(pontoId));
        const existentes = new Set();
        const adicionar = (a, b, sentido) => {
            if (!a || !b || a === b) return;
            const chave = `${a}>${b}`, inversa = `${b}>${a}`;
            if (sentido === "A_PARA_B" && existentes.has(inversa + "|ida")) {
                // ja existe o sentido contrario nos mesmos pontos: vira mao dupla
                const s = nova.segmentos.find(x => x.a === b && x.b === a && x.sentido === "A_PARA_B");
                if (s) { s.sentido = "DUPLO"; existentes.add(chave + "|ida"); return; }
            }
            if (existentes.has(chave + "|ida") || existentes.has(chave + "|duplo") || existentes.has(inversa + "|duplo")) return;
            nova.segmentos.push({
                id: proximoId(nova.segmentos, "S"), tipo: "LINHA", a, b, sentido,
                velocidadeMaxima: 0, barreira: 0, tags: []
            });
            existentes.add(chave + (sentido === "DUPLO" ? "|duplo" : "|ida"));
        };

        conexoes.forEach(conexao => {
            const pa = String(conexao.origem || conexao.pontoA);
            const pb = String(conexao.destino || conexao.pontoB);
            if (!principal.has(pa) || !principal.has(pb)) return;
            const ida = conexao.rfids?.origemDestino;
            const volta = conexao.rfids?.destinoOrigem;
            const circulacao = conexao.circulacao || "MAO_DUPLA";
            const idaA = noDaTag(ida?.origem, pa), idaB = noDaTag(ida?.destino, pb);
            const voltaB = noDaTag(volta?.origem, pb), voltaA = noDaTag(volta?.destino, pa);

            if (circulacao === "SENTIDO_UNICO") {
                if (conexao.sentidoUnico === "DESTINO_ORIGEM") adicionar(voltaB, voltaA, "A_PARA_B");
                else adicionar(idaA, idaB, "A_PARA_B");
                return;
            }
            if (circulacao === "DUPLA_FAIXA" || idaA !== voltaA || idaB !== voltaB) {
                // Cada sentido com as suas tags: duas faixas de sentido unico.
                adicionar(idaA, idaB, "A_PARA_B");
                adicionar(voltaB, voltaA, "A_PARA_B");
                return;
            }
            adicionar(idaA, idaB, "DUPLO");
        });

        avisos.push(`Coordenadas convertidas para uma área de ${largura} × ${altura} m. ` +
                    "Ajuste as distâncias reais no editor.");
        if (nova.estacoes.length) {
            avisos.push("Confira a orientação de chegada das estações (ficou 90°).");
        }
        return { planta: normalizar(nova), avisos };
    }


    /* ========================================================
       VALIDACAO
       ======================================================== */

    // opcoes.perfis (0.16): [{ nome, perfil }] dos modelos da frota: confere se
    // cada um chega nas estações que atende (comboio sem giro, raio, guia...)
    function validar(planta, opcoes = {}) {
        const erros = [];
        const avisos = [];
        const ids = new Set();

        planta.nos.forEach(no => {
            if (!no.id || no.id.length > LIMITES.tamanhoId) {
                erros.push({ alvo: no.id, msg: `Ponto "${no.id}": identificador vazio ou com mais de ${LIMITES.tamanhoId} caracteres.` });
            }
            if (!/^[A-Za-z0-9_-]*$/.test(no.id)) {
                erros.push({ alvo: no.id, msg: `Ponto "${no.id}": use só letras, números, _ e -.` });
            }
            if (ids.has(no.id)) erros.push({ alvo: no.id, msg: `Ponto "${no.id}" repetido.` });
            ids.add(no.id);
            if (no.x < 0 || no.y < 0 || no.x > planta.dimensoes.largura || no.y > planta.dimensoes.altura) {
                avisos.push({ alvo: no.id, msg: `${no.id} está fora da área da planta.` });
            }
            if (no.tipo === "ESTACAO" && (no.orientacaoChegada === null || no.orientacaoChegada === undefined)) {
                erros.push({ alvo: no.id, msg: `Acesso ${no.id} sem orientação de chegada.` });
            }
            if (no.tipo === "BERCO") {
                if (no.orientacaoChegada === null || no.orientacaoChegada === undefined) {
                    erros.push({ alvo: no.id, msg: `Berço ${no.id} sem orientação de chegada (para onde o AGV fica virado nele).` });
                }
                const ligacoes = planta.segmentos.filter(s => s.a === no.id || s.b === no.id).length;
                if (ligacoes > 1) avisos.push({ alvo: no.id, msg: `Berço ${no.id} no meio do caminho: AGV parado nele atrapalha os outros. Coloque-o num ramal (uma linha só).` });
            }
            if (!no.rfid) {
                avisos.push({ alvo: no.id, msg: `${no.id} sem tag RFID: a chegada será só por odometria.` });
            } else if (!rfidValido(no.rfid)) {
                erros.push({ alvo: no.id, msg: `${no.id}: tag "${no.rfid}" fora do formato. Use os 10 caracteres hexadecimais que o AGV lê (ex.: 0A0000001C).` });
            }
            if (no.barreira && no.barreira < LIMITES.barreiraMinima) {
                erros.push({ alvo: no.id, msg: `${no.id}: barreira mínima é ${LIMITES.barreiraMinima} mm.` });
            }
        });

        // Estacoes (locais)
        const idsEstacao = new Set();
        (planta.estacoes || []).forEach(e => {
            if (!e.id || e.id.length > LIMITES.tamanhoId || !/^[A-Za-z0-9_-]+$/.test(e.id)) {
                erros.push({ alvo: e.id, msg: `Estação "${e.id}": identificador inválido.` });
            }
            if (idsEstacao.has(e.id)) erros.push({ alvo: e.id, msg: `Estação "${e.id}" repetida.` });
            idsEstacao.add(e.id);
            const acessos = acessosDaEstacao(planta, e.id);
            if (!acessos.length) {
                avisos.push({ alvo: e.id, msg: `Estação ${e.nome || e.id} sem nenhum acesso.` });
            }
            // O id da estacao e destino de missao: nao pode ser de outro ponto qualquer.
            const outro = noPorId(planta, e.id);
            if (outro && !(outro.tipo === "ESTACAO" && outro.estacao === e.id)) {
                erros.push({ alvo: e.id, msg: `A estação ${e.id} tem o mesmo identificador de outro ponto.` });
            }
        });

        // Tags repetidas
        const tags = new Map();
        const registrarTag = (rfid, onde) => {
            if (!rfid) return;
            if (tags.has(rfid)) {
                erros.push({ alvo: onde, msg: `Tag ${rfid} usada em ${tags.get(rfid)} e em ${onde}.` });
            } else {
                tags.set(rfid, onde);
            }
        };
        planta.nos.forEach(no => registrarTag(no.rfid, no.id));

        const pares = new Map();
        planta.segmentos.forEach(s => {
            const a = noPorId(planta, s.a), b = noPorId(planta, s.b);
            if (!a || !b) {
                erros.push({ alvo: s.id, msg: `Segmento ${s.id} ligado a um ponto inexistente.` });
                return;
            }
            if (s.a === s.b) erros.push({ alvo: s.id, msg: `Segmento ${s.id} liga o ponto a ele mesmo.` });
            const par = [s.a, s.b].sort().join("|");
            if (pares.has(par)) {
                const outro = pares.get(par);
                const opostos = tipoSegmento(s) === "LINHA" && tipoSegmento(outro) === "LINHA" &&
                    s.sentido !== "DUPLO" && outro.sentido !== "DUPLO" &&
                    (s.sentido === "A_PARA_B" ? s.a : s.b) !== (outro.sentido === "A_PARA_B" ? outro.a : outro.b);
                if (!opostos || outro.gemeoVisto) {
                    erros.push({ alvo: s.id, msg: `Há segmentos demais entre ${s.a} e ${s.b} (só dois de sentido único e opostos).` });
                }
                outro.gemeoVisto = true;
            } else {
                pares.set(par, s);
            }

            const comprimento = comprimentoSegmento(planta, s);
            if (tipoSegmento(s) === "LATERAL") {
                if (comprimento < LIMITES.lateralMinima || comprimento > LIMITES.lateralMaxima) {
                    erros.push({ alvo: s.id, msg: `Troca lateral ${s.id}: distância entre ${LIMITES.lateralMinima} e ${LIMITES.lateralMaxima} m (está ${arred(comprimento, 2)} m).` });
                } else if (comprimento > DISTANCIA_SUGESTAO_LATERAL) {
                    avisos.push({ alvo: s.id, msg: `Troca lateral ${s.id} com ${arred(comprimento, 2)} m: o AGV anda de lado sem os sensores de distância. Prefira retorno com fita.` });
                }
                if (!lateralPerpendicular(planta, s)) {
                    avisos.push({ alvo: s.id, msg: `Troca lateral ${s.id}: deve ligar duas linhas paralelas, cruzando-as em 90°.` });
                }
            } else if (comprimento < 0.15) {
                erros.push({ alvo: s.id, msg: `Segmento ${s.id} (${s.a}–${s.b}) muito curto (${arred(comprimento, 2)} m).` });
            }
            if (tipoSegmento(s) === "CURVA") {
                const corda = Math.hypot(b.x - a.x, b.y - a.y);
                if (!(s.raio > 0) || s.raio < corda / 2 - 0.001) {
                    erros.push({ alvo: s.id, msg: `Curva ${s.id}: o raio (${arred(s.raio || 0, 2)} m) precisa ser pelo menos metade da distância entre ${s.a} e ${s.b} (${arred(corda / 2, 2)} m).` });
                } else if (s.raio < RAIO_MINIMO_CURVA) {
                    erros.push({ alvo: s.id, msg: `Curva ${s.id}: raio mínimo de ${RAIO_MINIMO_CURVA} m (o sensor perde a fita em curvas mais fechadas).` });
                }
            }
            const faixasSeg = faixasNoSegmento(planta, s, s.a);
            if (faixasSeg.length > 1) {
                erros.push({ alvo: s.id, msg: `Segmento ${s.id} passa por ${faixasSeg.length} faixas: ponha um ponto entre elas (o Atta trata uma faixa por trecho).` });
            }
            if ((s.tags || []).length > LIMITES.checkpointsPorTrecho) {
                erros.push({ alvo: s.id, msg: `Segmento ${s.id}: no máximo ${LIMITES.checkpointsPorTrecho} tags intermediárias.` });
            }
            (s.tags || []).forEach(t => {
                registrarTag(t.rfid, `${s.id}@${arred(t.distancia, 2)}m`);
                if (!t.rfid) {
                    erros.push({ alvo: s.id, msg: `Segmento ${s.id}: tag intermediária sem código.` });
                } else if (!rfidValido(t.rfid)) {
                    erros.push({ alvo: s.id, msg: `Segmento ${s.id}: tag "${t.rfid}" fora do formato. Use os 10 caracteres hexadecimais que o AGV lê (ex.: 0A0000001C).` });
                }
                if (t.distancia <= 0.05 || t.distancia >= comprimento - 0.05) {
                    erros.push({ alvo: s.id, msg: `Tag ${t.rfid} fora do segmento ${s.id} ou colada num ponto.` });
                }
            });
            if (s.barreira && s.barreira < LIMITES.barreiraMinima) {
                erros.push({ alvo: s.id, msg: `${s.id}: barreira mínima é ${LIMITES.barreiraMinima} mm.` });
            }

            // Quase alinhado (ex.: 2°): giros pequenos e desnecessarios.
            if (tipoSegmento(s) === "LINHA" && comprimento >= 0.15) {
                const ang = anguloExato(a, b);
                const resto = ((ang % 45) + 45) % 45;
                const desvio = Math.min(resto, 45 - resto);
                if (desvio > 0.05 && desvio < 5) {
                    avisos.push({ alvo: s.id, msg: `Segmento ${s.id} está a ${arred(desvio, 1)}° de ${Math.round(ang / 45) * 45 % 360}°: use ALINHAR para evitar giros pequenos.`, alinhar: true });
                }
            }

            planta.layout.forEach(o => {
                if (o.tipo === "ZONA_PROIBIDA" && o.horario && segmentoCruzaRetangulo(planta, s, o)) {
                    avisos.push({ alvo: s.id, msg: `Segmento ${s.id} passa pela zona proibida ${o.nome || o.id} (${descreverHorario(o.horario)}): nesse horário os Atta desviam ou esperam.` });
                } else if (o.tipo === "ZONA_PROIBIDA" && segmentoCruzaRetangulo(planta, s, o)) {
                    erros.push({ alvo: s.id, msg: `Segmento ${s.id} passa pela zona proibida ${o.nome || o.id}.` });
                } else if (TIPOS_LAYOUT[o.tipo]?.solido && segmentoCruzaRetangulo(planta, s, o)) {
                    const dentroA = pontoNoRetangulo(a, o), dentroB = pontoNoRetangulo(b, o);
                    if (!dentroA && !dentroB) {
                        erros.push({ alvo: s.id, msg: `Segmento ${s.id} atravessa ${TIPOS_LAYOUT[o.tipo].nome.toLowerCase()} ${o.nome || o.id}.` });
                    } else {
                        avisos.push({ alvo: s.id, msg: `Um ponto do segmento ${s.id} está dentro de ${o.nome || o.id}.` });
                    }
                }
            });
        });
        planta.segmentos.forEach(s => { delete s.gemeoVisto; });

        // Cruzamentos de linhas sem ponto (o AGV veria uma linha transversal)
        const linhas = planta.segmentos.filter(s => temFita(s) && noPorId(planta, s.a) && noPorId(planta, s.b))
            .map(s => {
                const pts = pontosSegmento(planta, s);
                const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
                return { s, pts, x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
            });
        for (let i = 0; i < linhas.length; i++) {
            for (let j = i + 1; j < linhas.length; j++) {
                const l1 = linhas[i], l2 = linhas[j], s1 = l1.s, s2 = l2.s;
                if (l1.x1 < l2.x0 || l2.x1 < l1.x0 || l1.y1 < l2.y0 || l2.y1 < l1.y0) continue;
                if (new Set([s1.a, s1.b, s2.a, s2.b]).size < 4) continue;
                if (polilinhasSeCruzam(l1.pts, l2.pts)) {
                    avisos.push({ alvo: s1.id, msg: `Segmentos ${s1.id} e ${s2.id} se cruzam sem um ponto no cruzamento.` });
                }
            }
        }

        // Paredes do desenho importado (0.17): a fita não atravessa
        const paredes = paredesDoDesenho(planta);
        if (paredes.length) {
            linhas.forEach(l => {
                const atravessa = paredes.find(([a, b]) => !(Math.max(a.x, b.x) < l.x0 || Math.min(a.x, b.x) > l.x1 || Math.max(a.y, b.y) < l.y0 || Math.min(a.y, b.y) > l.y1) &&
                    l.pts.some((p, i) => i > 0 && segmentosSeCruzam(l.pts[i - 1], p, a, b)));
                if (atravessa) erros.push({ alvo: l.s.id, msg: `Segmento ${l.s.id} atravessa uma parede do desenho (${planta.desenho.nome}). Se não é parede, marque a camada como "só fundo".` });
            });
        }

        // Faixa de pedestre e área livre: o Atta nunca para em cima (0.16).
        // Todo ponto é um lugar onde ele para (chega, confere a tag e segue).
        (planta.layout || []).forEach(o => {
            const regra = TIPOS_LAYOUT[o.tipo]?.regra;
            if (regra !== "FAIXA" && regra !== "LIVRE") return;
            planta.nos.forEach(no => {
                const parada = no.tipo === "ESTACAO" || no.tipo === "ESPERA" || no.tipo === "BERCO";
                if (regra === "FAIXA" && pontoNoRetangulo(no, o, FAIXA.folgaParada)) {
                    erros.push({ alvo: no.id, msg: `${no.id} está em cima (ou colado) de ${TIPOS_LAYOUT[o.tipo].nome.toLowerCase()} ${o.nome || o.id}: o Atta nunca pode parar ali. Mude o ponto para fora.` });
                } else if (regra === "LIVRE" && pontoNoRetangulo(no, o)) {
                    (parada ? erros : avisos).push({ alvo: no.id, msg: `${no.id} está dentro da área livre ${o.nome || o.id}${parada ? ": nenhum ponto de parada pode ficar ali." : ": o Atta para rapidamente nesse ponto."}` });
                }
            });
        });

        validarIO(planta, erros, avisos);

        // Bifurcação sem tag: o Atta precisa saber onde a fita se divide
        planta.nos.forEach(no => {
            if (no.rfid) return;
            const fitas = planta.segmentos.filter(s => temFita(s) && (s.a === no.id || s.b === no.id));
            if (fitas.length >= 3 && fitas.some(s => bordaNoPonto(planta, s, no.id, true) !== 0)) {
                avisos.push({ alvo: no.id, msg: `${no.id} é uma bifurcação (a fita se divide) sem tag RFID: ponha uma tag para o Atta saber de que lado seguir.` });
            }
        });

        // Conectividade e becos sem saida
        const grau = new Map(planta.nos.map(no => [no.id, { entra: 0, sai: 0 }]));
        planta.segmentos.forEach(s => {
            if (!grau.has(s.a) || !grau.has(s.b)) return;
            if (segmentoPermite(s, s.a)) { grau.get(s.a).sai++; grau.get(s.b).entra++; }
            if (segmentoPermite(s, s.b)) { grau.get(s.b).sai++; grau.get(s.a).entra++; }
        });
        planta.nos.forEach(no => {
            const g = grau.get(no.id);
            if (g.entra === 0 && g.sai === 0) {
                avisos.push({ alvo: no.id, msg: `${no.id} não está ligado a nenhum segmento.` });
            } else if (g.sai === 0) {
                erros.push({ alvo: no.id, msg: `${no.id}: dá para chegar mas não para sair (sentido único).` });
            } else if (g.entra === 0) {
                avisos.push({ alvo: no.id, msg: `${no.id}: dá para sair mas nunca chegar.` });
            }
        });

        const estacoes = (planta.estacoes || []).filter(e => acessosDaEstacao(planta, e.id).length);
        if (estacoes.length >= 2) {
            const base = estacoes[0];
            const origem = acessosDaEstacao(planta, base.id)[0];
            estacoes.slice(1).forEach(e => {
                if (!compilarIrPara(planta, origem.id, origem.orientacaoChegada ?? 0, e.id, false, null, true).sucesso) {
                    avisos.push({ alvo: e.id, msg: `Não há caminho de ${base.id} até ${e.id}.` });
                }
                const volta = acessosDaEstacao(planta, e.id)[0];
                if (!compilarIrPara(planta, volta.id, volta.orientacaoChegada ?? 0, base.id, false, null, true).sucesso) {
                    avisos.push({ alvo: e.id, msg: `Não há caminho de ${e.id} até ${base.id}.` });
                }
            });
        }

        // Por modelo (0.16): cada modelo chega nas estações que atende, vazio e carregado?
        (opcoes.perfis || []).forEach(({ nome, perfil }) => {
            avisosDoModelo(planta, nome, perfil).forEach(a => avisos.push(a));
        });

        // Frota: AGV que termina numa estacao sem nada na fila sai para um ponto de espera
        if (planta.nos.some(n => n.tipo === "ESTACAO") && !planta.nos.some(n => n.tipo === "ESPERA" || n.tipo === "BERCO")) {
            avisos.push({ alvo: null, msg: "Nenhum berço nem ponto de espera: com mais de um AGV, um AGV parado numa estação não tem para onde sair e pode travar quem precisa dela." });
        }
        return { erros, avisos, valida: erros.length === 0 };
    }


    /* ========================================================
       ROTA (Dijkstra sobre estados "ponto + direcao da frente")
       ======================================================== */

    function custoGiro(graus) {
        const g = Math.abs(graus);
        if (g === 0) return 0;
        return g * Math.PI / 180 / CUSTO.wManobra + CUSTO.paradaPorManobra;
    }

    // Perfil de rota (0.16): o que um modelo consegue fazer, vazio ou carregado.
    //   { modulo: "E", guia: "O"|"M"|"L", gira: bool (gira no ponto), lateral: bool,
    //     raioMinimo: m, comboio: m (comprimento atrás do Atta), frente: m (do centro à frente) }
    // null = sem restrição (a planta sozinha, como até a 0.15).
    function normalizarPerfil(perfil) {
        if (!perfil) return null;
        return {
            modulo: perfil.modulo || null,
            guia: ["O", "M", "L"].includes(perfil.guia) ? perfil.guia : null,
            gira: perfil.gira !== false,
            lateral: perfil.lateral !== false,
            raioMinimo: Math.max(0, Number(perfil.raioMinimo) || 0),
            comboio: Math.max(0, Number(perfil.comboio) || 0),
            frente: Math.max(0, Number(perfil.frente) || 0.2),
            nome: perfil.nome || ""
        };
    }

    const GIRO_TOLERADO_SEM_GIRAR = 10;   // graus: comboio não gira no ponto, mas aceita fita levemente torta

    function podeGirar(perfil, giro) {
        return !perfil || perfil.gira || Math.abs(giro) <= GIRO_TOLERADO_SEM_GIRAR;
    }

    // Por que este perfil não pode passar por este segmento (null = pode)
    function recusaSegmento(planta, perfil, s) {
        if (!perfil) return null;
        const tipo = tipoSegmento(s);
        if (tipo === "LATERAL") return perfil.lateral ? null : "não anda de lado";
        const guia = guiaSegmento(planta, s);
        if (perfil.guia === "O" && guia !== "OPTICA") return guia === "VIRTUAL" ? "trecho sem fita" : "trecho com fita magnética";
        if (perfil.guia === "M" && guia !== "MAGNETICA") return guia === "VIRTUAL" ? "trecho sem fita" : "trecho com fita óptica";
        if (s.modulos && perfil.modulo && !s.modulos.includes(perfil.modulo)) return "trecho não liberado para o módulo";
        if (tipo === "CURVA" && perfil.raioMinimo > (Number(s.raio) || 0) + 1e-6) return `curva de ${arred(s.raio, 2)} m (precisa de ${arred(perfil.raioMinimo, 2)} m)`;
        return null;
    }

    // A estação aceita este módulo? (pelo tipo de carga dela)
    function estacaoAceita(planta, estacaoId, modulo) {
        const e = estacaoPorId(planta, estacaoId);
        if (!e || !e.carga || !modulo) return true;
        return CARGAS[e.carga]?.modulo === modulo;
    }

    // Lista de passagens possiveis saindo de um no
    function saidas(planta, noId, perfil = null) {
        const resultado = [];
        planta.segmentos.forEach(s => {
            if (s.a !== noId && s.b !== noId) return;
            if (!segmentoPermite(s, noId)) return;
            const outro = s.a === noId ? s.b : s.a;
            const de = noPorId(planta, noId), para = noPorId(planta, outro);
            if (!de || !para) return;
            if (recusaSegmento(planta, perfil, s) || recusaAgora(planta, s)) return;
            const tipo = tipoSegmento(s);
            resultado.push({
                segmento: s, tipo, de: noId, para: outro,
                angulo: tipo === "CURVA" ? normalizarAngulo(rumoExatoSaida(planta, s, noId)) : anguloEntre(de, para),
                anguloChegada: tipo === "CURVA" ? normalizarAngulo(rumoExatoChegada(planta, s, noId)) : anguloEntre(de, para)
            });
        });
        return resultado;
    }

    // orientacaoInicial: graus ou null (desconhecida -> sem custo no primeiro giro)
    // Cada passo devolvido tem "orientacao": a frente do AGV durante o trecho.
    // perfil (0.16): o que o modelo consegue fazer (normalizarPerfil); null = tudo
    function calcularRota(planta, origemId, orientacaoInicial, destinoId, orientacaoFinal = null, perfil = null) {
        perfil = normalizarPerfil(perfil);
        if (!noPorId(planta, origemId)) return { sucesso: false, erro: `Ponto de origem "${origemId}" não existe na planta.` };
        if (!noPorId(planta, destinoId)) return { sucesso: false, erro: `Ponto de destino "${destinoId}" não existe na planta.` };

        const inicial = orientacaoInicial === null || orientacaoInicial === undefined ? null : normalizarAngulo(orientacaoInicial);
        const chave = (no, ang) => `${no}|${ang === null ? "-" : ang}`;
        const dist = new Map();
        const anterior = new Map();
        const abertos = [{ no: origemId, ang: inicial, custo: 0 }];
        dist.set(chave(origemId, inicial), 0);
        let melhorFinal = null;

        while (abertos.length) {
            abertos.sort((x, y) => x.custo - y.custo);
            const atual = abertos.shift();
            const kAtual = chave(atual.no, atual.ang);
            if (atual.custo > (dist.get(kAtual) ?? Infinity)) continue;
            if (melhorFinal && atual.custo >= melhorFinal.custo) break;

            if (atual.no === destinoId) {
                const giroFinal = orientacaoFinal === null || atual.ang === null ? 0 : calcularGiro(atual.ang, orientacaoFinal);
                const total = atual.custo + custoGiro(giroFinal);
                if (podeGirar(perfil, giroFinal) && (!melhorFinal || total < melhorFinal.custo)) melhorFinal = { chave: kAtual, custo: total };
            }

            saidas(planta, atual.no, perfil).forEach(passo => {
                let custo, angulo;
                const L = comprimentoSegmento(planta, passo.segmento);
                if (passo.tipo === "LATERAL") {
                    // Anda de lado com a frente ao longo das faixas (perpendicular ao
                    // salto). Se a frente nao estiver assim, gira antes no ponto.
                    const relativo = atual.ang === null ? 90 : Math.abs(calcularGiro(atual.ang, passo.angulo));
                    const opcoes = relativo >= 70 && relativo <= 110 && atual.ang !== null
                        ? [atual.ang]
                        : [normalizarAngulo(passo.angulo + 90), normalizarAngulo(passo.angulo - 90)];
                    opcoes.forEach(frente => {
                        const giro = atual.ang === null ? 0 : calcularGiro(atual.ang, frente);
                        if (!podeGirar(perfil, giro)) return;
                        const c = atual.custo + custoGiro(giro) + L / CUSTO.velocidadeLateral + CUSTO.paradaPorManobra;
                        const k = chave(passo.para, frente);
                        if (c < (dist.get(k) ?? Infinity)) {
                            dist.set(k, c);
                            anterior.set(k, { chave: kAtual, passo: Object.assign({}, passo, { orientacao: frente }) });
                            abertos.push({ no: passo.para, ang: frente, custo: c });
                        }
                    });
                    return;
                } else {
                    const giro = atual.ang === null ? 0 : calcularGiro(atual.ang, passo.angulo);
                    if (!podeGirar(perfil, giro)) return;
                    let v = velocidadeSegmento(planta, passo.segmento) || CUSTO.velocidadePadrao;
                    if (passo.tipo === "CURVA") v = Math.min(v, CUSTO.velocidadePadrao * 0.7);
                    angulo = passo.anguloChegada;
                    custo = atual.custo + custoGiro(giro) + L / v;
                }
                const k = chave(passo.para, angulo);
                if (custo < (dist.get(k) ?? Infinity)) {
                    dist.set(k, custo);
                    anterior.set(k, { chave: kAtual, passo: Object.assign({}, passo, { orientacao: angulo }) });
                    abertos.push({ no: passo.para, ang: angulo, custo });
                }
            });
        }

        if (!melhorFinal) {
            const quem = perfil && perfil.nome ? ` para ${perfil.nome}` : "";
            const porque = perfil && !perfil.gira ? " (carregado ele não gira no ponto nem anda de lado: precisa de curvas e de saída para a frente)" : "";
            // 0.19: corredor fechado ou zona proibida neste horário pode ser o motivo
            const agora = planta.segmentos.filter(s => recusaAgora(planta, s)).map(s => s.id);
            const fechado = agora.length ? ` (agora fechados: ${agora.slice(0, 6).join(", ")}${agora.length > 6 ? "…" : ""})` : "";
            return { sucesso: false, erro: `Não existe caminho${quem} de ${origemId} até ${destinoId} respeitando os sentidos${porque}${fechado}.` };
        }
        const passos = [];
        let k = melhorFinal.chave;
        while (anterior.has(k)) {
            const item = anterior.get(k);
            passos.unshift(item.passo);
            k = item.chave;
        }
        return { sucesso: true, passos, custo: melhorFinal.custo };
    }


    // Avisos de um modelo na planta (0.16): estações que ele atende (pelo tipo
    // de carga) e onde ele, carregado, não chega ou de onde não sai.
    // perfis: { vazio, carregado } ou um perfil só.
    function avisosDoModelo(planta, nome, perfis) {
        const avisos = [];
        const pc = normalizarPerfil(perfis && (perfis.carregado || perfis.vazio) || perfis);
        if (!pc || !pc.modulo) return avisos;
        const estacoes = (planta.estacoes || []).filter(e => e.carga && CARGAS[e.carga].modulo === pc.modulo && acessosDaEstacao(planta, e.id).length);
        if (estacoes.length < 2) return avisos;
        const chega = new Map(estacoes.map(e => [e.id, false])), sai = new Map(estacoes.map(e => [e.id, false]));
        estacoes.forEach(o => {
            acessosDaEstacao(planta, o.id).forEach(acesso => {
                estacoes.forEach(d => {
                    if (d === o || (sai.get(o.id) && chega.get(d.id))) return;
                    const r = compilarIrPara(planta, acesso.id, acesso.orientacaoChegada ?? 0, d.id, false, pc, true);
                    if (r.sucesso) { sai.set(o.id, true); chega.set(d.id, true); }
                });
            });
        });
        estacoes.forEach(e => {
            const nomeE = e.nome || e.id;
            if (!chega.get(e.id)) avisos.push({ alvo: e.id, msg: `${nome} carregado não chega em ${nomeE} vindo das outras estações dele${pc.gira ? "" : " (sem girar no ponto: falta curva ou ramal)"}.` });
            else if (!sai.get(e.id)) avisos.push({ alvo: e.id, msg: `${nome} carregado chega em ${nomeE} mas não sai de lá${pc.gira ? "" : " (comboio não anda de ré: a estação precisa de saída para a frente)"}.` });
        });
        return avisos;
    }


    /* ========================================================
       COMPILACAO DAS MISSOES PARA O FIRMWARE
       ======================================================== */

    function montarTrecho(planta, passo, perfil = null) {
        const de = noPorId(planta, passo.de);
        const para = noPorId(planta, passo.para);
        const s = passo.segmento;
        const comprimento = comprimentoSegmento(planta, s);
        const barreira = s.barreira || (para.barreira || 0);
        const trecho = {
            origem: de.id,
            destino: para.id,
            angulo: passo.angulo,
            comprimento: arred(comprimento),
            rfidOrigem: de.rfid || "",
            rfidDestino: para.rfid || ""
        };
        if (tipoSegmento(s) === "LATERAL") {
            trecho.tipo = "LATERAL";
            trecho.orientacao = passo.orientacao;   // frente durante o deslocamento (o ESP usa)
        } else {
            if (tipoSegmento(s) === "CURVA") {
                // 0.16: segue a fita em arco; a frente gira de "angulo" até "anguloFinal"
                const g = geometriaCurva(planta, s);
                trecho.tipo = "CURVA";
                trecho.anguloFinal = passo.anguloChegada;
                trecho.raio = arred(g.R);
                trecho.curva = (g.esq === (de.id === s.a)) ? 1 : -1;   // +1 vira para a esquerda
            }
            const checkpoints = tagsNoSentido(planta, s, de.id).map(t => ({ rfid: t.rfid, distancia: arred(t.distancia) }));
            if (checkpoints.length) trecho.checkpoints = checkpoints;
            const v = velocidadeSegmento(planta, s);
            if (v > 0) trecho.velocidade = arred(v);
            // Bifurcação: de que borda da fita seguir ao sair do ponto / ao chegar
            const bs = bordaNoPonto(planta, s, de.id, true), bc = bordaNoPonto(planta, s, para.id, false);
            if (bs) trecho.bordaSaida = bs;
            if (bc) trecho.bordaChegada = bc;
            // Faixa de pedestre: para 1 s antes, atravessa devagar até a traseira passar
            const faixa = faixasNoSegmento(planta, s, de.id)[0];
            if (faixa) {
                const frente = perfil ? perfil.frente : 0.2;
                const cauda = (perfil ? perfil.comboio : 0) + frente;
                trecho.faixa = {
                    parar: arred(Math.max(0, faixa.inicio - FAIXA.folgaParada - frente), 2),
                    ate: arred(Math.min(comprimento + 5, faixa.fim + FAIXA.folgaSaida + cauda), 2)
                };
                trecho.faixaNome = faixa.objeto.nome || faixa.objeto.id || "";   // só o site usa
            }
            if (s.ramal) trecho.ramal = true;          // só o site usa (ceder a vez)
        }
        if (perfil && perfil.comboio > 0) trecho.cauda = arred(perfil.comboio, 2);   // só o site usa
        if (barreira > 0) trecho.barreira = Math.max(LIMITES.barreiraMinima, Math.round(barreira));
        // ignorados pelo ESP; usados no mapa do site
        trecho.segmento = s.id;
        trecho.frente = passo.orientacao;
        return trecho;
    }

    // Destino de uma missao: estacao (escolhe o acesso) ou ponto
    // exato: o próprio ponto, mesmo que tenha o id de uma estação com outros acessos
    function candidatosDestino(planta, destinoId, exato = false) {
        const estacao = exato ? null : estacaoPorId(planta, destinoId);
        if (estacao) {
            return { estacao, nos: acessosDaEstacao(planta, estacao.id) };
        }
        const no = noPorId(planta, destinoId);
        if (!no) return null;
        return { estacao: estacaoDoNo(planta, no), nos: [no] };
    }

    // longo (0.16): aceita rota com mais trechos que o Atta guarda por etapa
    // (compilarMissao divide em etapas seguidas); sem ele, é erro como antes.
    function compilarIrPara(planta, origemId, orientacao, destinoId, exato = false, perfil = null, longo = false) {
        perfil = normalizarPerfil(perfil);
        const candidatos = candidatosDestino(planta, destinoId, exato && Boolean(noPorId(planta, destinoId)));
        if (!candidatos || !candidatos.nos.length) {
            return { sucesso: false, erro: `Destino "${destinoId}" não existe na planta publicada${candidatos ? " (estação sem acessos)" : ""}.` };
        }
        const orientacaoInicial = normalizarAngulo(orientacao);
        let melhor = null;
        let ultimoErro = null;

        candidatos.nos.forEach(destino => {
            const chegada = (destino.tipo === "ESTACAO" || destino.tipo === "BERCO") && destino.orientacaoChegada !== null && destino.orientacaoChegada !== undefined ? destino.orientacaoChegada : null;
            if (origemId === destino.id) {
                if (chegada !== null && !podeGirar(perfil, calcularGiro(orientacaoInicial, chegada))) {
                    ultimoErro = { sucesso: false, erro: `Em ${destino.id}, carregado, o Atta não consegue girar para a orientação de chegada.` };
                    return;
                }
                const custo = chegada === null ? 0 : custoGiro(calcularGiro(orientacaoInicial, chegada));
                if (!melhor || custo < melhor.custo) {
                    melhor = {
                        custo, destino, chegada,
                        etapa: {
                            tipo: "MOVIMENTO", origem: origemId, destino: destino.id,
                            orientacaoInicial, orientacaoFinal: chegada ?? orientacaoInicial,
                            orientacaoChegada: chegada ?? -1, trechos: []
                        },
                        orientacaoFinal: chegada ?? orientacaoInicial
                    };
                }
                return;
            }
            if (perfil && perfil.modulo && destino.estacao && !estacaoAceita(planta, destino.estacao, perfil.modulo)) {
                const est = estacaoPorId(planta, destino.estacao);
                ultimoErro = { sucesso: false, erro: `${est.nome || est.id} troca ${CARGAS[est.carga].nome.toLowerCase()}: precisa de um Atta ${CARGAS[est.carga].modulo}.` };
                return;
            }
            const rota = calcularRota(planta, origemId, orientacao, destino.id, chegada, perfil);
            if (!rota.sucesso) { ultimoErro = rota; return; }
            if (rota.passos.length > LIMITES.trechosPorEtapa && !longo) {
                ultimoErro = {
                    sucesso: false,
                    erro: `Rota de ${origemId} até ${destino.id} tem ${rota.passos.length} trechos ` +
                          `(o AGV aceita ${LIMITES.trechosPorEtapa} por etapa). Divida em mais etapas IR PARA.`
                };
                return;
            }
            if (melhor && rota.custo >= melhor.custo) return;
            const trechos = rota.passos.map(p => montarTrecho(planta, p, perfil));
            const ultima = rota.passos[rota.passos.length - 1].orientacao;
            melhor = {
                custo: rota.custo, destino, chegada,
                etapa: {
                    tipo: "MOVIMENTO", origem: origemId, destino: destino.id,
                    orientacaoInicial,
                    orientacaoFinal: ultima,
                    orientacaoChegada: chegada ?? -1,
                    trechos
                },
                orientacaoFinal: chegada ?? ultima
            };
        });

        if (!melhor) return ultimoErro || { sucesso: false, erro: `Não existe caminho até ${destinoId}.` };
        if (candidatos.estacao) melhor.etapa.estacao = candidatos.estacao.id;   // so para o site
        return { sucesso: true, etapa: melhor.etapa, orientacaoFinal: melhor.orientacaoFinal, ponto: melhor.destino.id };
    }

    function dividirEtapasLongas(planta, etapas) {
        const limite = LIMITES.trechosPorEtapa;
        if (!etapas.some(e => e.tipo === "MOVIMENTO" && (e.trechos || []).length > limite)) {
            return etapas.map(e => Object.assign(e, { passo: e.indice }));
        }
        const emZona = new Set();
        zonasDeConflito(planta).forEach(z => z.nos.forEach(n => emZona.add(n)));
        const saida = [];
        etapas.forEach(e => {
            const trechos = e.trechos || [];
            if (e.tipo !== "MOVIMENTO" || trechos.length <= limite) { saida.push(Object.assign(e, { passo: e.indice })); return; }
            let inicio = 0, orientacao = e.orientacaoInicial;
            while (inicio < trechos.length) {
                let fim = Math.min(trechos.length, inicio + limite);
                if (fim < trechos.length) {
                    // corta no último ponto fora de zona (o Atta espera ali sem prender ninguém)
                    for (let k = fim; k > inicio + 1; k--) if (!emZona.has(trechos[k - 1].destino)) { fim = k; break; }
                }
                const pedaco = trechos.slice(inicio, fim);
                const ultimo = fim === trechos.length;
                const final = pedaco[pedaco.length - 1].frente ?? pedaco[pedaco.length - 1].angulo;
                const etapa = {
                    tipo: "MOVIMENTO", origem: pedaco[0].origem, destino: pedaco[pedaco.length - 1].destino,
                    orientacaoInicial: orientacao, orientacaoFinal: ultimo ? e.orientacaoFinal : final,
                    orientacaoChegada: ultimo ? e.orientacaoChegada : -1, trechos: pedaco, passo: e.indice
                };
                if (ultimo && e.estacao) etapa.estacao = e.estacao;
                saida.push(etapa);
                orientacao = final;
                inicio = fim;
            }
        });
        saida.forEach((e, i) => { e.indice = i; });
        return saida;
    }

    // missao: { id, etapas: [{ tipo: IR_PARA, destino } | AGUARDAR | CARREGAR | DESCARREGAR | ...] }
    // posicao: { ponto, orientacao } (pode ser null se a missao nao anda)
    // opcoes (0.16): { perfil: { vazio, carregado } (o modelo do Atta), carregado: bool (já sai com carga) }
    //   CARREGAR (pegar a carga) passa para o perfil carregado; DESCARREGAR (entregar) volta ao vazio.
    function compilarMissao(planta, missao, posicao, opcoes = {}) {
        const perfis = opcoes.perfil || null;
        let carregado = opcoes.carregado === true;
        const perfilAgora = () => !perfis ? null : (perfis.vazio || perfis.carregado ? (carregado ? (perfis.carregado || perfis.vazio) : (perfis.vazio || perfis.carregado)) : perfis);
        if (!missao || !Array.isArray(missao.etapas) || missao.etapas.length === 0) {
            return { sucesso: false, erro: "A missão não possui etapas." };
        }
        if (missao.etapas.length > LIMITES.etapasPorMissao) {
            return { sucesso: false, erro: `A missão tem ${missao.etapas.length} etapas (máximo ${LIMITES.etapasPorMissao}).` };
        }
        const anda = missao.etapas.some(e => e.tipo === "IR_PARA");
        if (anda && (!posicao || !posicao.ponto)) {
            return {
                sucesso: false,
                erro: "A posição do AGV é desconhecida. Use DEFINIR POSIÇÃO na Visão Geral antes de carregar uma missão com IR PARA."
            };
        }
        if (anda && !noPorId(planta, posicao.ponto)) {
            return { sucesso: false, erro: `O AGV está em "${posicao.ponto}", que não existe na planta publicada.` };
        }

        let ponto = posicao?.ponto || null;
        let orientacao = normalizarAngulo(posicao?.orientacao || 0);
        const etapas = [];

        for (let i = 0; i < missao.etapas.length; i++) {
            const etapa = missao.etapas[i];
            if (etapa.tipo === "CARREGAR") carregado = true;
            if (etapa.tipo === "DESCARREGAR") carregado = false;
            if (etapa.tipo === "IR_PARA") {
                const r = compilarIrPara(planta, ponto, orientacao, etapa.destino, etapa.exato === true, perfilAgora(), true);
                if (!r.sucesso) return { sucesso: false, erro: `Etapa ${i + 1}: ${r.erro}` };
                etapas.push(Object.assign({ indice: i }, r.etapa));
                ponto = r.ponto;
                orientacao = r.orientacaoFinal;
                continue;
            }
            if (etapa.tipo === "AGUARDAR") {
                etapas.push({ indice: i, tipo: "AGUARDAR", tempo: Number(etapa.tempo) || 0 });
                continue;
            }
            const copia = Object.assign({ indice: i }, clonar(etapa));
            etapas.push(copia);
        }

        // 0.16: rota longa (o anel de uma fábrica grande) vira etapas de movimento
        // seguidas, de até LIMITES.trechosPorEtapa trechos, cortadas de
        // preferência num ponto fora das zonas de conflito. "passo" (só o site
        // usa) diz de qual etapa da missão cada uma veio.
        const divididas = dividirEtapasLongas(planta, etapas);
        if (divididas.length > LIMITES.etapasPorMissao) {
            return { sucesso: false, erro: `A missão ficou com ${divididas.length} etapas no Atta (rotas longas são divididas; máximo ${LIMITES.etapasPorMissao}). Divida a missão em duas.` };
        }
        const pacote = { tipo: "CARREGAR_MISSAO", missao: String(missao.id), revisaoPlanta: planta.revisao, etapas: divididas };
        const prioridade = Math.max(0, Math.min(3, Math.round(Number(missao.prioridade ?? 1))));
        if (prioridade !== 1) pacote.prioridade = prioridade;
        const trafego = anotarTrafego(planta, pacote, posicao?.ponto || null);
        if (!trafego.sucesso) return { sucesso: false, erro: trafego.erro };
        return {
            sucesso: true,
            pacote,
            posicaoFinal: { ponto, orientacao },
            carregadoFinal: carregado
        };
    }


    /* ========================================================
       TRAFEGO: ZONAS DE CONFLITO
       ========================================================
       Onde dois AGVs podem se encontrar, calculado da planta:
       - juncao/cruzamento: ponto onde chegam caminhos de dois lados;
       - corredor de mao dupla (com a estacao na ponta, se houver);
       - troca lateral (com os dois pontos das pontas).
       Zonas que se tocam viram uma so. Fora delas os AGVs andam em fila
       (o sensor de distancia cuida). Antes de uma zona o AGV pede
       passagem; se nao puder, para MARGEM_PARADA antes do ponto, num
       trecho de linha comum ("trecho de espera"), e espera.
    */
    const TRAFEGO = { margemParada: 1.2, margemSaida: 0.8, esperaMinima: 2.4, maxZonasMissao: 32, distanciaVizinhos: 1.2 };

    function zonasDeConflito(planta) {
        const pai = new Map();
        const achar = x => { while (pai.get(x) !== x) { pai.set(x, pai.get(pai.get(x))); x = pai.get(x); } return x; };
        const unir = (a, b) => { const ra = achar(a), rb = achar(b); if (ra !== rb) pai.set(ra, rb); };
        const marcados = new Set();
        const elemento = e => { if (!pai.has(e)) pai.set(e, e); return e; };
        const zona = itens => { itens.forEach(elemento); itens.forEach(i => marcados.add(i)); for (let k = 1; k < itens.length; k++) unir(itens[0], itens[k]); };

        const antes = new Map();       // no -> pontos de onde se chega nele
        const grau = new Map();        // no -> segmentos ligados
        const liga = (de, para) => { if (!antes.has(para)) antes.set(para, new Set()); antes.get(para).add(de); };
        planta.segmentos.forEach(s => {
            if (!noPorId(planta, s.a) || !noPorId(planta, s.b)) return;
            grau.set(s.a, (grau.get(s.a) || 0) + 1);
            grau.set(s.b, (grau.get(s.b) || 0) + 1);
            if (s.sentido === "A_PARA_B") liga(s.a, s.b);
            else if (s.sentido === "B_PARA_A") liga(s.b, s.a);
            else { liga(s.a, s.b); liga(s.b, s.a); }
        });
        // juncoes: chega gente de dois lugares diferentes
        antes.forEach((origens, no) => { if (origens.size >= 2) zona(["n:" + no]); });
        planta.segmentos.forEach(s => {
            if (!noPorId(planta, s.a) || !noPorId(planta, s.b)) return;
            if (tipoSegmento(s) === "LATERAL") {
                zona(["s:" + s.id, "n:" + s.a, "n:" + s.b]);
            } else if (s.sentido === "DUPLO") {
                // corredor de mao dupla: o segmento, a ponta sem saida (estacao)
                // e os pontos internos do corredor
                const itens = ["s:" + s.id];
                [s.a, s.b].forEach(n => {
                    const ligados = planta.segmentos.filter(x => x.a === n || x.b === n);
                    const soCorredor = ligados.every(x => x.sentido === "DUPLO" && tipoSegmento(x) === "LINHA");
                    if (grau.get(n) === 1 || (soCorredor && grau.get(n) === 2)) itens.push("n:" + n);
                });
                zona(itens);
            }
        });
        // pontos de zona muito perto um do outro (ex.: as duas faixas a 0,5 m,
        // com uma estacao de cada lado na mesma coluna): dois AGVs chegando de
        // frente um para o outro se veem no sensor e ninguem anda. Viram uma zona so.
        const nosZona = [...marcados].filter(e => e.startsWith("n:")).map(e => noPorId(planta, e.slice(2))).filter(Boolean);
        for (let i = 0; i < nosZona.length; i++) for (let k = i + 1; k < nosZona.length; k++) {
            const a = nosZona[i], b = nosZona[k];
            if (Math.hypot(a.x - b.x, a.y - b.y) < TRAFEGO.distanciaVizinhos) unir("n:" + a.id, "n:" + b.id);
        }

        const grupos = new Map();
        marcados.forEach(e => {
            const r = achar(e);
            if (!grupos.has(r)) grupos.set(r, { nos: [], segmentos: [] });
            const g = grupos.get(r);
            if (e.startsWith("n:")) g.nos.push(e.slice(2)); else g.segmentos.push(e.slice(2));
        });
        const lista = [...grupos.values()].map(g => {
            g.nos.sort(); g.segmentos.sort();
            const base = g.nos[0] || g.segmentos[0];
            return { id: ("Z" + base).slice(0, 9), nos: g.nos, segmentos: g.segmentos };
        });
        // ids unicos (cortados em 9 caracteres para caber no firmware)
        const usados = new Map();
        lista.forEach(z => { const n = usados.get(z.id) || 0; usados.set(z.id, n + 1); if (n) z.id = (z.id.slice(0, 7) + "~" + n).slice(0, 9); });
        // 0.19: porta automática e faixa/cruzamento ligados a um Eciton I/O:
        // zona própria (o módulo ocupa), por cima das zonas de sempre
        objetosIo(planta).forEach(o => {
            const segs = planta.segmentos.filter(s => temFita(s) && noPorId(planta, s.a) && noPorId(planta, s.b) && segmentoCruzaRetangulo(planta, s, o)).map(s => s.id).sort();
            if (segs.length) lista.push({ id: zonaDoObjetoIo(o), nos: [], segmentos: segs, objeto: o.id, tipo: TIPOS_LAYOUT[o.tipo].regra, dispositivo: o.io.dispositivo });
        });
        return lista.sort((a, b) => a.id.localeCompare(b.id));
    }

    // Marca na missao compilada onde pedir passagem, onde parar e o que
    // liberar. Campos no trecho (so quando ha trafego):
    //   pedir     mascara das zonas que precisa ter antes de passar de "parada"
    //   parada    metros desde o inicio do trecho (-1 = antes de sair do ponto)
    //   liberar   mascara das zonas a soltar depois de "liberarEm" metros
    // Na missao: zonas (nomes; bit i = zonas[i]) e zonasInicio (do ponto de partida).
    function anotarTrafego(planta, pacote, pontoInicial) {
        const zonas = zonasDeConflito(planta);
        const doNo = new Map(), doSeg = new Map();   // segmento -> [zonas] (0.19: porta por cima do corredor)
        zonas.forEach(z => { z.nos.forEach(n => doNo.set(n, z.id)); z.segmentos.forEach(s => { if (!doSeg.has(s)) doSeg.set(s, []); doSeg.get(s).push(z.id); }); });
        const trechos = [];
        const inicioEtapa = new Set(), fimEtapa = new Set();
        pacote.etapas.forEach(e => {
            if (!(e.trechos || []).length) return;
            inicioEtapa.add(trechos.length);
            e.trechos.forEach(t => trechos.push(t));
            fimEtapa.add(trechos.length - 1);
        });
        trechos.forEach(t => { delete t.pedir; delete t.parada; delete t.liberar; delete t.liberarEm; delete t.ceder; });
        delete pacote.zonas; delete pacote.zonasInicio;
        const inicio = pontoInicial ? doNo.get(pontoInicial) : null;
        const ocupa = trechos.map(t => {
            const z = new Set();
            (doSeg.get(t.segmento) || []).forEach(id => z.add(id));
            if (doNo.has(t.destino)) z.add(doNo.get(t.destino));
            return z;
        });
        const usadas = new Set(inicio ? [inicio] : []);
        ocupa.forEach(z => z.forEach(id => usadas.add(id)));
        if (!usadas.size) return { sucesso: true };
        if (usadas.size > TRAFEGO.maxZonasMissao) {
            return { sucesso: false, erro: `A rota passa por ${usadas.size} zonas de conflito (máximo ${TRAFEGO.maxZonasMissao}). Divida a missão.` };
        }
        const nomes = [...usadas].sort();
        const bit = id => 2 ** nomes.indexOf(id);
        const mascara = conj => [...conj].reduce((m, id) => m + bit(id), 0);
        const espera = trechos.map(t => t.tipo !== "LATERAL" && !doSeg.has(t.segmento) && t.comprimento >= TRAFEGO.esperaMinima);

        // Grupo a partir do trecho j: tudo que ele usa ate poder parar de novo
        // fora de uma zona: o proximo trecho de espera ou o fim da etapa (o AGV
        // para no destino; numa estacao, so a zona dela fica com ele).
        const grupo = j => {
            const g = new Set();
            for (let k = j; k < trechos.length; k++) {
                if (k > j && espera[k]) break;
                ocupa[k].forEach(id => g.add(id));
                if (fimEtapa.has(k)) break;
            }
            return g;
        };
        // Simula o que o AGV segura, trecho a trecho:
        // - pede antes de sair do ponto (comeco de etapa que nao e trecho de
        //   espera) ou no ponto de parada de cada trecho de espera;
        // - solta o que nao vai mais usar ate a proxima parada.
        // Sai do ramal para a linha principal neste grupo? Então cede a vez (0.16)
        const cedeNoGrupo = j => {
            for (let k = j; k < trechos.length; k++) {
                if (k > j && espera[k]) break;
                if (trechos[k].ramal && k + 1 < trechos.length && !trechos[k + 1].ramal) return true;
                if (fimEtapa.has(k)) break;
            }
            return false;
        };
        // Comboio (0.16): a zona só é solta quando o último carrinho sai dela.
        // pendentes: { ids, falta } metros que ainda faltam andar para soltar.
        let pendentes = [];
        let segura = new Set(inicio ? [inicio] : []);
        trechos.forEach((t, j) => {
            if (inicioEtapa.has(j) && !espera[j]) {
                const g = grupo(j);
                const falta = [...g].filter(id => !segura.has(id));
                if (falta.length) { t.pedir = mascara(g); t.parada = -1; if (cedeNoGrupo(j)) t.ceder = 1; }
                g.forEach(id => segura.add(id));
            }
            const fica = grupo(j);
            const soltar = [...segura].filter(id => !fica.has(id) && !pendentes.some(p => p.ids.includes(id)));
            const L = t.comprimento || 0;
            // sem comboio: como até a 0.15 (solta neste trecho, no máximo no fim dele)
            if (soltar.length) pendentes.push({ ids: soltar, falta: Number(t.cauda) > 0 ? TRAFEGO.margemSaida + Number(t.cauda) : Math.min(TRAFEGO.margemSaida, L) });
            // solta neste trecho o que já dá; o resto passa para os próximos
            const agora = pendentes.filter(p => p.falta <= L || fimEtapa.has(j) && j === trechos.length - 1);
            const voltaram = [];
            pendentes = pendentes.filter(p => {
                if (agora.includes(p)) return false;
                if (p.ids.some(id => fica.has(id))) { voltaram.push(p); return false; }   // a rota volta a usar: segue com ela
                p.falta -= L;
                return true;
            });
            if (agora.length) {
                const ids = agora.flatMap(p => p.ids);
                t.liberar = mascara(ids);
                t.liberarEm = arred(Math.min(Math.max(...agora.map(p => p.falta)), L), 2);
                ids.forEach(id => segura.delete(id));
            }
            if (espera[j]) {
                const g = grupo(j);
                const falta = [...g].filter(id => !segura.has(id));
                if (falta.length) {
                    t.pedir = mascara(g);
                    let parada = Math.max(TRAFEGO.margemSaida, t.comprimento - TRAFEGO.margemParada);
                    // nunca espera em cima da faixa: para antes dela
                    if (t.faixa && parada > t.faixa.parar && parada < t.faixa.ate) parada = t.faixa.parar;
                    t.parada = arred(parada, 2);
                    if (cedeNoGrupo(j)) t.ceder = 1;
                }
                g.forEach(id => segura.add(id));
            }
        });
        // O que sobrou (a missão terminou antes da cauda sair): solta no fim do último trecho
        if (pendentes.length && trechos.length) {
            const ultimo = trechos[trechos.length - 1];
            const ids = pendentes.flatMap(p => p.ids);
            ultimo.liberar = (ultimo.liberar || 0) + mascara(ids.filter(id => !(ultimo.liberar & bit(id))));
            ultimo.liberarEm = arred(ultimo.comprimento || 0, 2);
        }
        pacote.zonas = nomes;
        if (inicio) pacote.zonasInicio = bit(inicio);
        return { sucesso: true };
    }

    // Remove campos que so o site usa (economiza bytes no MQTT)
    function pacoteParaESP(pacote) {
        const copia = clonar(pacote);
        copia.etapas.forEach(e => {
            delete e.estacao;
            delete e.passo;
            (e.trechos || []).forEach(t => { delete t.segmento; delete t.frente; delete t.faixaNome; delete t.ramal; delete t.cauda; });
        });
        return copia;
    }


    /* ========================================================
       POSICAO NO MAPA DURANTE A MISSAO
       ======================================================== */

    // Pose estimada do AGV andando num trecho (distancia desde a origem)
    function poseNoTrecho(planta, trecho, distancia, orientacao) {
        const de = noPorId(planta, trecho.origem), para = noPorId(planta, trecho.destino);
        if (!de || !para) return null;
        if (trecho.tipo === "CURVA") {
            const s = segmentoPorId(planta, trecho.segmento) ||
                planta.segmentos.find(x => tipoSegmento(x) === "CURVA" && ((x.a === de.id && x.b === para.id) || (x.b === de.id && x.a === para.id)));
            if (s) {
                const p = pontoNoSegmento(planta, s, de.id, distancia);
                return { x: p.x, y: p.y, orientacao: orientacao !== undefined && orientacao !== null ? orientacao : p.rumo };
            }
        }
        const L = Math.hypot(para.x - de.x, para.y - de.y) || 1;
        const f = Math.max(0, Math.min(1, (Number(distancia) || 0) / L));
        const frente = orientacao !== undefined && orientacao !== null ? orientacao
            : trecho.frente ?? trecho.orientacao ?? trecho.angulo;
        return { x: de.x + (para.x - de.x) * f, y: de.y + (para.y - de.y) * f, orientacao: frente };
    }

    // Pose a partir da odometria do AGV: base (ponto conhecido) + deslocamento
    // no referencial da frente do AGV na base.
    function poseOdometria(planta, base, baseOrientacao, dx, dy, dthGraus) {
        const no = noPorId(planta, base);
        if (!no) return null;
        const t = (Number(baseOrientacao) || 0) * Math.PI / 180;
        return {
            x: no.x + dx * Math.cos(t) - dy * Math.sin(t),
            y: no.y + dx * Math.sin(t) + dy * Math.cos(t),
            orientacao: normalizarAngulo((Number(baseOrientacao) || 0) + (Number(dthGraus) || 0))
        };
    }


    /* ========================================================
       EDICAO (usadas pelo editor e pelos testes)
       ======================================================== */

    // Cria uma faixa paralela a um segmento: pontos novos deslocados de
    // "distancia" para a esquerda (lado = 1) ou direita (lado = -1) de a->b,
    // com o sentido contrario. Reaproveita pontos que ja existam ali.
    function criarFaixaParalela(planta, segmentoId, distancia, lado = 1) {
        const s = segmentoPorId(planta, segmentoId);
        if (!s || tipoSegmento(s) !== "LINHA") return { sucesso: false, erro: "Escolha um segmento de linha." };
        const a = noPorId(planta, s.a), b = noPorId(planta, s.b);
        const L = Math.hypot(b.x - a.x, b.y - a.y);
        if (!(distancia >= LIMITES.lateralMinima) || L < 0.15) return { sucesso: false, erro: "Distância inválida." };
        const nx = -(b.y - a.y) / L * lado, ny = (b.x - a.x) / L * lado;
        const pontoEm = (x, y) => planta.nos.find(n => Math.hypot(n.x - x, n.y - y) < 0.02);
        const criar = (origem) => {
            const x = arred(origem.x + nx * distancia), y = arred(origem.y + ny * distancia);
            const existente = pontoEm(x, y);
            if (existente) return existente;
            const no = { id: proximoId(planta.nos, "R"), tipo: "REFERENCIA", nome: "", x, y, rfid: "", orientacaoChegada: null, barreira: 0 };
            planta.nos.push(no);
            return no;
        };
        const a2 = criar(a), b2 = criar(b);
        if (s.sentido === "DUPLO") s.sentido = "A_PARA_B";
        const idaDeA = s.sentido === "A_PARA_B";
        const nova = {
            id: proximoId(planta.segmentos, "S"), tipo: "LINHA", a: b2.id, b: a2.id,
            sentido: idaDeA ? "A_PARA_B" : "B_PARA_A",
            velocidadeMaxima: s.velocidadeMaxima, barreira: s.barreira, tags: []
        };
        planta.segmentos.push(nova);
        return { sucesso: true, segmento: nova, pontos: [a2, b2], sugestao: sugestaoTrocaFaixa(distancia) };
    }

    // Liga dois pontos de faixas paralelas: LATERAL (sem fita) ou LINHA (retorno com fita)
    function ligarFaixas(planta, aId, bId, tipo) {
        const a = noPorId(planta, aId), b = noPorId(planta, bId);
        if (!a || !b || a === b) return { sucesso: false, erro: "Escolha dois pontos diferentes." };
        const existe = planta.segmentos.find(s => tipoSegmento(s) === tipo &&
            ((s.a === aId && s.b === bId) || (s.a === bId && s.b === aId)));
        if (existe) return { sucesso: true, segmento: existe };
        const s = {
            id: proximoId(planta.segmentos, "S"), tipo: tipo === "LATERAL" ? "LATERAL" : "LINHA",
            a: aId, b: bId, sentido: "DUPLO", velocidadeMaxima: 0, barreira: 0, tags: []
        };
        planta.segmentos.push(s);
        return { sucesso: true, segmento: s };
    }

    // Divide um segmento reto (0.16) a "distancia" metros de a: cria um ponto
    // ali e um segmento novo do ponto até b (mesmas propriedades). A faixa
    // gêmea (sentido contrário entre os mesmos pontos) é dividida junto.
    function dividirSegmento(planta, segmentoId, distancia) {
        const s = segmentoPorId(planta, segmentoId);
        if (!s || tipoSegmento(s) !== "LINHA") return { sucesso: false, erro: "Escolha um segmento reto." };
        const a = noPorId(planta, s.a), b = noPorId(planta, s.b);
        const L = comprimentoSegmento(planta, s);
        if (!(distancia >= 0.15 && distancia <= L - 0.15)) return { sucesso: false, erro: `Ponto fora do segmento (entre 0,15 e ${arred(L - 0.15, 2)} m).` };
        const f = distancia / L;
        const no = { id: proximoId(planta.nos, "R"), tipo: "REFERENCIA", nome: "", x: arred(a.x + (b.x - a.x) * f), y: arred(a.y + (b.y - a.y) * f), rfid: "", orientacaoChegada: null, barreira: 0 };
        planta.nos.push(no);
        const partir = seg => {
            const daA = seg.a === s.a;     // gêmeo pode estar invertido
            const d = daA ? distancia : L - distancia;
            const novo = Object.assign(clonar(seg), { id: proximoId(planta.segmentos, "S") });
            novo.a = no.id; novo.b = seg.b;
            seg.b = no.id;
            const tags = seg.tags || [];
            seg.tags = tags.filter(t => t.distancia < d - 0.05);
            novo.tags = tags.filter(t => t.distancia > d + 0.05).map(t => ({ rfid: t.rfid, distancia: arred(t.distancia - d) }));
            planta.segmentos.push(novo);
            return novo;
        };
        const gemeo = segmentoGemeo(planta, s);
        const novo = partir(s);
        if (gemeo) partir(gemeo);
        return { sucesso: true, ponto: no, segmento: novo };
    }

    // Curva de concordância (0.16): no canto entre dois segmentos retos, um arco
    // de "raio" m que corta o canto (para o rebocador carregado, que não gira
    // no ponto). Os Atta omni continuam usando o canto.
    function criarCurvaConcordancia(planta, noId, raio, idsSegmentos = null) {
        const no = noPorId(planta, noId);
        if (!no) return { sucesso: false, erro: "Escolha o ponto do canto." };
        const retos = planta.segmentos.filter(s => tipoSegmento(s) === "LINHA" && (s.a === noId || s.b === noId) &&
            (!idsSegmentos || idsSegmentos.includes(s.id)));
        if (retos.length !== 2) return { sucesso: false, erro: retos.length < 2 ? "O canto precisa de dois segmentos retos." : "Este ponto tem mais de dois segmentos: escolha quais formam o canto." };
        if (!(raio >= RAIO_MINIMO_CURVA)) return { sucesso: false, erro: `Raio mínimo de ${RAIO_MINIMO_CURVA} m.` };
        const dir = seg => { const o = noPorId(planta, seg.a === noId ? seg.b : seg.a); const L = Math.hypot(o.x - no.x, o.y - no.y); return { x: (o.x - no.x) / L, y: (o.y - no.y) / L, L }; };
        const u1 = dir(retos[0]), u2 = dir(retos[1]);
        const fi = Math.acos(Math.max(-1, Math.min(1, u1.x * u2.x + u1.y * u2.y)));   // ângulo interno
        if (fi < 20 * Math.PI / 180 || fi > 160 * Math.PI / 180) return { sucesso: false, erro: "Os dois segmentos não formam um canto (já estão quase alinhados ou voltam um sobre o outro)." };
        const t = raio / Math.tan(fi / 2);
        if (t > u1.L - 0.15 || t > u2.L - 0.15) return { sucesso: false, erro: `Raio grande demais para estes segmentos: a curva começaria a ${arred(t, 2)} m do canto.` };
        // divide cada segmento a t metros do canto
        const pontoEm = seg => {
            const d = seg.a === noId ? t : comprimentoSegmento(planta, seg) - t;
            const r = dividirSegmento(planta, seg.id, d);
            return r.sucesso ? r.ponto : null;
        };
        const p1 = pontoEm(retos[0]), p2 = pontoEm(retos[1]);
        if (!p1 || !p2) return { sucesso: false, erro: "Não deu para dividir os segmentos." };
        // de p1 para p2: a frente em p1 aponta para o canto (-u1); vira para o lado de u2
        const cruz = (-u1.x) * u2.y - (-u1.y) * u2.x;
        const parte = id => planta.segmentos.find(s => tipoSegmento(s) === "LINHA" && ((s.a === id && s.b === noId) || (s.b === id && s.a === noId)));
        const s1 = parte(p1.id), s2 = parte(p2.id);
        const vai = (seg, de) => segmentoPermite(seg, de);
        const ida = vai(s1, p1.id) && vai(s2, noId), volta = vai(s2, p2.id) && vai(s1, noId);
        const curva = {
            id: proximoId(planta.segmentos, "S"), tipo: "CURVA", a: p1.id, b: p2.id, raio: arred(raio), lado: cruz > 0 ? "ESQ" : "DIR",
            sentido: ida && volta ? "DUPLO" : ida ? "A_PARA_B" : "B_PARA_A", velocidadeMaxima: 0, barreira: 0, tags: []
        };
        if (s1.guia) curva.guia = s1.guia;
        planta.segmentos.push(curva);
        return { sucesso: true, curva, pontos: [p1, p2] };
    }

    // Ramal (0.16): sai da linha principal em curva, corre paralelo a
    // "afastamento" m e volta, entre "de" e "ate" metros do ponto a do segmento.
    // Quem está no ramal deixa a linha principal livre e, para voltar, cede a vez.
    //   opcoes: { de, ate, afastamento, raio, lado: "ESQ"|"DIR" (de quem anda de a para b), angulo: graus (45) }
    function criarRamal(planta, segmentoId, opcoes = {}) {
        const s = segmentoPorId(planta, segmentoId);
        if (!s || tipoSegmento(s) !== "LINHA") return { sucesso: false, erro: "Escolha um segmento reto da linha principal." };
        const a = noPorId(planta, s.a), b = noPorId(planta, s.b);
        const L = comprimentoSegmento(planta, s);
        const de = Number(opcoes.de), ate = Number(opcoes.ate);
        const d = Number(opcoes.afastamento) || 1.5, R = Number(opcoes.raio) || 1.5;
        if (!(R >= RAIO_MINIMO_CURVA)) return { sucesso: false, erro: `Raio mínimo de ${RAIO_MINIMO_CURVA} m.` };
        if (!(de >= 0.15 && ate <= L - 0.15 && ate > de)) return { sucesso: false, erro: "Escolha o começo e o fim do ramal dentro do segmento." };
        let th = (Number(opcoes.angulo) || 45) * Math.PI / 180;
        let diagonal = (d - 2 * R * (1 - Math.cos(th))) / Math.sin(th);
        if (diagonal < 0) { th = Math.acos(Math.max(-1, 1 - d / (2 * R))); diagonal = 0; }
        const avanco = 2 * R * Math.sin(th) + diagonal * Math.cos(th);
        if (ate - de < 2 * avanco + 0.3) return { sucesso: false, erro: `Ramal curto: com raio ${arred(R, 2)} m e afastamento ${arred(d, 2)} m, precisa de pelo menos ${arred(2 * avanco + 0.3, 2)} m na linha principal.` };
        const ux = (b.x - a.x) / L, uy = (b.y - a.y) / L;
        const sg = opcoes.lado === "DIR" ? -1 : 1;
        const nx = -uy * sg, ny = ux * sg;
        const em = (ao, lat) => ({ x: arred(a.x + ux * ao + nx * lat), y: arred(a.y + uy * ao + ny * lat) });
        const novo = (p, tipo = "REFERENCIA") => { const n = { id: proximoId(planta.nos, "R"), tipo, nome: "", x: p.x, y: p.y, rfid: "", orientacaoChegada: null, barreira: 0 }; planta.nos.push(n); return n; };
        const arco1 = R * Math.sin(th), lat1 = R * (1 - Math.cos(th));
        // pontos na linha principal (divide; o pedaço depois de "de" é dividido em "ate")
        const r1 = dividirSegmento(planta, s.id, de);
        if (!r1.sucesso) return r1;
        const r2 = dividirSegmento(planta, r1.segmento.id, ate - de);
        if (!r2.sucesso) return r2;
        const f1 = r1.ponto, f2 = r2.ponto;
        const c1 = novo(em(de + arco1, lat1));
        const c2 = diagonal > 0 ? novo(em(de + arco1 + diagonal * Math.cos(th), lat1 + diagonal * Math.sin(th))) : c1;
        const p1 = novo(em(de + avanco, d)), p2 = novo(em(ate - avanco, d));
        const c3 = diagonal > 0 ? novo(em(ate - arco1 - diagonal * Math.cos(th), lat1 + diagonal * Math.sin(th))) : null;
        const c4 = novo(em(ate - arco1, lat1));
        const lado = sg > 0 ? "ESQ" : "DIR", outro = sg > 0 ? "DIR" : "ESQ";
        const sentido = s.sentido;     // mesmo sentido da principal (a -> b)
        const base = { sentido, velocidadeMaxima: 0, barreira: 0, tags: [], ramal: true };
        if (s.guia) base.guia = s.guia;
        const segs = [];
        const ligar = (x, y, tipo, extra = {}) => { const seg = Object.assign({ id: proximoId(planta.segmentos, "S"), tipo, a: x.id, b: y.id }, clonar(base), extra); planta.segmentos.push(seg); segs.push(seg); };
        ligar(f1, c1, "CURVA", { raio: arred(R), lado });
        if (diagonal > 0) ligar(c1, c2, "LINHA");
        ligar(c2, p1, "CURVA", { raio: arred(R), lado: outro });
        ligar(p1, p2, "LINHA");
        const c3r = c3 || c4;
        ligar(p2, c3r, "CURVA", { raio: arred(R), lado: outro });
        if (c3) ligar(c3, c4, "LINHA");
        ligar(c4, f2, "CURVA", { raio: arred(R), lado });
        return { sucesso: true, entrada: f1, saida: f2, paralelo: [p1, p2], segmentos: segs, comprimentoUtil: arred(ate - de - 2 * avanco, 2) };
    }

    // Move o ponto "b" para o segmento ficar exatamente no multiplo de 45 graus mais proximo
    function alinharSegmento(planta, segmentoId, moverId) {
        const s = segmentoPorId(planta, segmentoId);
        if (!s) return false;
        const fixoId = moverId === s.a ? s.b : s.a;
        const fixo = noPorId(planta, fixoId), movel = noPorId(planta, moverId || s.b);
        if (!fixo || !movel) return false;
        const L = Math.hypot(movel.x - fixo.x, movel.y - fixo.y);
        const alvo = Math.round(anguloExato(fixo, movel) / 45) * 45 * Math.PI / 180;
        movel.x = arred(fixo.x + L * Math.cos(alvo));
        movel.y = arred(fixo.y + L * Math.sin(alvo));
        return true;
    }


    // Rotas de saída de um AGV, já compiladas, que ele guarda na flash:
    //   CASA   de cada ponto até o berço dele (fim de turno, parado sem missão)
    //   ESPERA de cada ponto até os pontos de espera mais perto (berço ocupado, liberar o ponto)
    //   IDA    do berço até cada estação/ponto de espera (começo do turno: até onde a fila começa)
    // Devolve { rev, rotas: [{ ponto, tipo, destino, zona, comprimento, missao }] }, na ordem
    // de importância (o AGV pode ficar sem espaço para as últimas).
    function compilarSaidas(planta, opcoes = {}) {
        const berco = opcoes.berco ? noPorId(planta, opcoes.berco) : null;
        const maximoEsperas = opcoes.esperas ?? 2;
        const zonas = zonasDeConflito(planta);
        const zonaDoNo = new Map();
        zonas.forEach(z => z.nos.forEach(n => zonaDoNo.set(n, z.id)));
        const esperas = planta.nos.filter(n => n.tipo === "ESPERA");
        const paradas = planta.nos.filter(n => n.tipo === "ESTACAO" || n.tipo === "ESPERA" || n.tipo === "BERCO");
        const rota = (no, tipo, destino) => {
            const prefixo = tipo === "CASA" ? "CASA-" : tipo === "IDA" ? "IDA-" : "SAIDA-";
            const missao = { id: (prefixo + destino.id).slice(0, 31), nome: tipo, etapas: [{ tipo: "IR_PARA", destino: destino.id, exato: true }] };
            const c = compilarMissao(planta, missao, { ponto: no.id, orientacao: no.orientacaoChegada ?? 0 });
            if (!c.sucesso) return null;
            const comprimento = c.pacote.etapas.reduce((t, e) => t + (e.trechos || []).reduce((u, tr) => u + (tr.comprimento || 0), 0), 0);
            return { ponto: no.id, tipo, destino: destino.id, zona: zonaDoNo.get(destino.id) || "", comprimento: arred(comprimento), missao: pacoteParaESP(c.pacote) };
        };
        const rotas = [];
        // 1. para casa e 2. para os pontos de espera mais perto, de cada parada
        paradas.forEach(no => {
            if (berco && no.id !== berco.id) {
                const r = rota(no, "CASA", berco);
                if (r) rotas.push(r);
            }
            esperas.filter(e => e.id !== no.id)
                .map(e => rota(no, "ESPERA", e)).filter(Boolean)
                .sort((a, b) => a.comprimento - b.comprimento)
                .slice(0, maximoEsperas)
                .forEach(r => rotas.push(r));
        });
        // 3. do berço para onde a fila pode começar (mais perto primeiro)
        if (berco) {
            paradas.filter(n => n.id !== berco.id && n.tipo !== "BERCO")
                .map(n => rota(berco, "IDA", n)).filter(Boolean)
                .sort((a, b) => a.comprimento - b.comprimento)
                .forEach(r => rotas.push(r));
        }
        // versão: muda quando qualquer rota muda (o AGV compara para saber se precisa de novas)
        const texto = JSON.stringify(rotas);
        let h = 2166136261;
        for (let i = 0; i < texto.length; i++) { h ^= texto.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
        return { rev: h.toString(36), rotas };
    }

    const API = {
        VERSAO, LIMITES, TIPOS_NO, TIPOS_LAYOUT, TIPOS_SEGMENTO, DISTANCIA_SUGESTAO_LATERAL,
        criarVazia, normalizar, migrarV1, validar,
        calcularRota, compilarIrPara, compilarMissao, pacoteParaESP, zonasDeConflito, anotarTrafego, TRAFEGO, compilarSaidas,
        noPorId, segmentoPorId, estacaoPorId, acessosDaEstacao, estacaoDoNo, nomeDoPonto, candidatosDestino,
        comprimentoSegmento, anguloEntre, anguloExato, tagsNoSentido, tipoSegmento, segmentoGemeo,
        localizarRfid, velocidadeSegmento, proximoId, prefixoNo, normalizarAngulo, diferencaDirecao,
        normalizarRfid, rfidValido, FORMATO_RFID, calcularGiro, poseNoTrecho, poseOdometria, cantosRetangulo, pontoNoRetangulo,
        distanciaPontoSegmento, lateralPerpendicular, sugestaoTrocaFaixa,
        criarFaixaParalela, ligarFaixas, alinharSegmento, clonar, arred,
        // 0.16
        GUIAS, CARGAS, FAIXA, GRUPOS_LAYOUT, RAIO_MINIMO_CURVA, ANGULO_BIFURCACAO,
        geometriaCurva, rumoExatoSaida, rumoExatoChegada, pontoNoSegmento, pontosSegmento, segmentoCruzaRetangulo,
        faixasNoSegmento, bordaNoPonto, descreverSegmento, temFita, guiaSegmento,
        normalizarPerfil, recusaSegmento, estacaoAceita, podeGirar, avisosDoModelo,
        dividirSegmento, criarCurvaConcordancia, criarRamal,
        // 0.17
        normalizarDesenho, paredesDoDesenho,
        // 0.19
        IO, configIO, validarIO, objetosIo, zonaDoObjetoIo, criarPontosPorta, normalizarHorario, horarioAtivo, descreverHorario,
        definirContextoRota, recusaAgora, TEM_HORARIO
    };

    if (typeof module !== "undefined" && module.exports) {
        module.exports = API;
    } else {
        raiz.Planta = API;
    }
})(typeof window !== "undefined" ? window : globalThis);
