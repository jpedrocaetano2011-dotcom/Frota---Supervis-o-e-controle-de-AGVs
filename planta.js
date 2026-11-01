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
     estacoes: [ { id, nome, maquina } ],

     // CAMADA DE NAVEGACAO (por onde o AGV anda)
     nos: [ { id, tipo, nome, x, y, rfid, orientacaoChegada, barreira, estacao } ],
     //   tipo: ESTACAO (acesso de uma estacao) | REFERENCIA | ESPERA | BERCO (casa/carregador de AGVs)
     segmentos: [ { id, tipo, a, b, sentido, velocidadeMaxima, barreira, tags: [{ rfid, distancia }] } ]
     //   tipo: LINHA (fita no chao) | LATERAL (troca de faixa andando de lado, sem fita)
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
        velocidadeMaxima: 0.10,
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
    const TIPOS_SEGMENTO = ["LINHA", "LATERAL"];

    const TIPOS_LAYOUT = {
        MAQUINA:       { nome: "Máquina",        solido: true,  largura: 1.2, profundidade: 0.8 },
        BANCADA:       { nome: "Bancada",        solido: true,  largura: 1.5, profundidade: 0.7 },
        PRATELEIRA:    { nome: "Prateleira",     solido: true,  largura: 2.0, profundidade: 0.5 },
        PAREDE:        { nome: "Parede",         solido: true,  largura: 4.0, profundidade: 0.15 },
        PILAR:         { nome: "Pilar",          solido: true,  largura: 0.3, profundidade: 0.3 },
        POSTO:         { nome: "Posto logístico", solido: true, largura: 0.8, profundidade: 0.6 },
        CORREDOR:      { nome: "Corredor",       solido: false, largura: 4.0, profundidade: 1.2 },
        ZONA_LENTA:    { nome: "Zona lenta",     solido: false, largura: 2.0, profundidade: 2.0 },
        ZONA_PROIBIDA: { nome: "Zona proibida",  solido: false, largura: 2.0, profundidade: 2.0 }
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
            nome,
            dimensoes: { largura: 20, altura: 12 },
            grade: 0.5,
            fundo: null,
            layout: [],
            estacoes: [],
            nos: [],
            segmentos: []
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
        return segmento && segmento.tipo === "LATERAL" ? "LATERAL" : "LINHA";
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

    function velocidadeSegmento(planta, segmento) {
        if (tipoSegmento(segmento) === "LATERAL") return 0;
        let v = Number(segmento.velocidadeMaxima) || 0;
        const a = noPorId(planta, segmento.a), b = noPorId(planta, segmento.b);
        if (a && b) {
            planta.layout
                .filter(o => o.tipo === "ZONA_LENTA" && Number(o.velocidadeMaxima) > 0)
                .forEach(zona => {
                    if (linhaCruzaRetangulo(a, b, zona)) {
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
        const linhasDe = no => planta.segmentos.filter(s => tipoSegmento(s) === "LINHA" && (s.a === no.id || s.b === no.id))
            .map(s => anguloExato(noPorId(planta, s.a) || no, noPorId(planta, s.b) || no));
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
        });
        p.estacoes.forEach(e => {
            e.id = String(e.id || "");
            e.nome = e.nome || "";
            if (!e.maquina) delete e.maquina;
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
            s.tags = s.tipo === "LINHA" && Array.isArray(s.tags)
                ? s.tags.map(t => ({ rfid: normalizarRfid(t.rfid), distancia: arred(Number(t.distancia) || 0) }))
                : [];
        });
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

    function validar(planta) {
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
                if (o.tipo === "ZONA_PROIBIDA" && linhaCruzaRetangulo(a, b, o)) {
                    erros.push({ alvo: s.id, msg: `Segmento ${s.id} passa pela zona proibida ${o.nome || o.id}.` });
                } else if (TIPOS_LAYOUT[o.tipo]?.solido && linhaCruzaRetangulo(a, b, o)) {
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
        const linhas = planta.segmentos.filter(s => tipoSegmento(s) === "LINHA");
        for (let i = 0; i < linhas.length; i++) {
            for (let j = i + 1; j < linhas.length; j++) {
                const s1 = linhas[i], s2 = linhas[j];
                const n = [s1.a, s1.b, s2.a, s2.b].map(id => noPorId(planta, id));
                if (n.some(x => !x)) continue;
                if (new Set([s1.a, s1.b, s2.a, s2.b]).size < 4) continue;
                if (segmentosSeCruzam(n[0], n[1], n[2], n[3])) {
                    avisos.push({ alvo: s1.id, msg: `Segmentos ${s1.id} e ${s2.id} se cruzam sem um ponto no cruzamento.` });
                }
            }
        }

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
                if (!compilarIrPara(planta, origem.id, origem.orientacaoChegada ?? 0, e.id).sucesso) {
                    avisos.push({ alvo: e.id, msg: `Não há caminho de ${base.id} até ${e.id}.` });
                }
                const volta = acessosDaEstacao(planta, e.id)[0];
                if (!compilarIrPara(planta, volta.id, volta.orientacaoChegada ?? 0, base.id).sucesso) {
                    avisos.push({ alvo: e.id, msg: `Não há caminho de ${e.id} até ${base.id}.` });
                }
            });
        }

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

    // Lista de passagens possiveis saindo de um no
    function saidas(planta, noId) {
        const resultado = [];
        planta.segmentos.forEach(s => {
            if (s.a !== noId && s.b !== noId) return;
            if (!segmentoPermite(s, noId)) return;
            const outro = s.a === noId ? s.b : s.a;
            const de = noPorId(planta, noId), para = noPorId(planta, outro);
            if (!de || !para) return;
            resultado.push({ segmento: s, tipo: tipoSegmento(s), de: noId, para: outro, angulo: anguloEntre(de, para) });
        });
        return resultado;
    }

    // orientacaoInicial: graus ou null (desconhecida -> sem custo no primeiro giro)
    // Cada passo devolvido tem "orientacao": a frente do AGV durante o trecho.
    function calcularRota(planta, origemId, orientacaoInicial, destinoId, orientacaoFinal = null) {
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
                if (!melhorFinal || total < melhorFinal.custo) melhorFinal = { chave: kAtual, custo: total };
            }

            saidas(planta, atual.no).forEach(passo => {
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
                    const v = velocidadeSegmento(planta, passo.segmento) || CUSTO.velocidadePadrao;
                    angulo = passo.angulo;
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
            return { sucesso: false, erro: `Não existe caminho de ${origemId} até ${destinoId} respeitando os sentidos.` };
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


    /* ========================================================
       COMPILACAO DAS MISSOES PARA O FIRMWARE
       ======================================================== */

    function montarTrecho(planta, passo) {
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
            const checkpoints = tagsNoSentido(planta, s, de.id).map(t => ({ rfid: t.rfid, distancia: arred(t.distancia) }));
            if (checkpoints.length) trecho.checkpoints = checkpoints;
            const v = velocidadeSegmento(planta, s);
            if (v > 0) trecho.velocidade = arred(v);
        }
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

    function compilarIrPara(planta, origemId, orientacao, destinoId, exato = false) {
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
            const rota = calcularRota(planta, origemId, orientacao, destino.id, chegada);
            if (!rota.sucesso) { ultimoErro = rota; return; }
            if (rota.passos.length > LIMITES.trechosPorEtapa) {
                ultimoErro = {
                    sucesso: false,
                    erro: `Rota de ${origemId} até ${destino.id} tem ${rota.passos.length} trechos ` +
                          `(o AGV aceita ${LIMITES.trechosPorEtapa} por etapa). Divida em mais etapas IR PARA.`
                };
                return;
            }
            if (melhor && rota.custo >= melhor.custo) return;
            const trechos = rota.passos.map(p => montarTrecho(planta, p));
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

    // missao: { id, etapas: [{ tipo: IR_PARA, destino } | AGUARDAR | ...] }
    // posicao: { ponto, orientacao } (pode ser null se a missao nao anda)
    function compilarMissao(planta, missao, posicao) {
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
            if (etapa.tipo === "IR_PARA") {
                const r = compilarIrPara(planta, ponto, orientacao, etapa.destino, etapa.exato === true);
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

        const pacote = { tipo: "CARREGAR_MISSAO", missao: String(missao.id), revisaoPlanta: planta.revisao, etapas };
        const prioridade = Math.max(0, Math.min(3, Math.round(Number(missao.prioridade ?? 1))));
        if (prioridade !== 1) pacote.prioridade = prioridade;
        const trafego = anotarTrafego(planta, pacote, posicao?.ponto || null);
        if (!trafego.sucesso) return { sucesso: false, erro: trafego.erro };
        return {
            sucesso: true,
            pacote,
            posicaoFinal: { ponto, orientacao }
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
        const doNo = new Map(), doSeg = new Map();
        zonas.forEach(z => { z.nos.forEach(n => doNo.set(n, z.id)); z.segmentos.forEach(s => doSeg.set(s, z.id)); });
        const trechos = [];
        const inicioEtapa = new Set(), fimEtapa = new Set();
        pacote.etapas.forEach(e => {
            if (!(e.trechos || []).length) return;
            inicioEtapa.add(trechos.length);
            e.trechos.forEach(t => trechos.push(t));
            fimEtapa.add(trechos.length - 1);
        });
        trechos.forEach(t => { delete t.pedir; delete t.parada; delete t.liberar; delete t.liberarEm; });
        delete pacote.zonas; delete pacote.zonasInicio;
        const inicio = pontoInicial ? doNo.get(pontoInicial) : null;
        const ocupa = trechos.map(t => {
            const z = new Set();
            if (doSeg.has(t.segmento)) z.add(doSeg.get(t.segmento));
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
        let segura = new Set(inicio ? [inicio] : []);
        trechos.forEach((t, j) => {
            if (inicioEtapa.has(j) && !espera[j]) {
                const g = grupo(j);
                const falta = [...g].filter(id => !segura.has(id));
                if (falta.length) { t.pedir = mascara(g); t.parada = -1; }
                g.forEach(id => segura.add(id));
            }
            const fica = grupo(j);
            const soltar = [...segura].filter(id => !fica.has(id));
            if (soltar.length) {
                t.liberar = mascara(soltar);
                t.liberarEm = arred(Math.min(TRAFEGO.margemSaida, t.comprimento || 0), 2);
                soltar.forEach(id => segura.delete(id));
            }
            if (espera[j]) {
                const g = grupo(j);
                const falta = [...g].filter(id => !segura.has(id));
                if (falta.length) {
                    t.pedir = mascara(g);
                    t.parada = arred(Math.max(TRAFEGO.margemSaida, t.comprimento - TRAFEGO.margemParada), 2);
                }
                g.forEach(id => segura.add(id));
            }
        });
        pacote.zonas = nomes;
        if (inicio) pacote.zonasInicio = bit(inicio);
        return { sucesso: true };
    }

    // Remove campos que so o site usa (economiza bytes no MQTT)
    function pacoteParaESP(pacote) {
        const copia = clonar(pacote);
        copia.etapas.forEach(e => {
            delete e.estacao;
            (e.trechos || []).forEach(t => { delete t.segmento; delete t.frente; });
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
        criarFaixaParalela, ligarFaixas, alinharSegmento, clonar, arred
    };

    if (typeof module !== "undefined" && module.exports) {
        module.exports = API;
    } else {
        raiz.Planta = API;
    }
})(typeof window !== "undefined" ? window : globalThis);
