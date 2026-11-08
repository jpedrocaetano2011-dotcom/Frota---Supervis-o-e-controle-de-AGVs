/* ============================================================
   IMPORTAR DXF (0.17) — o desenho 2D do AutoCAD por baixo da planta
   ============================================================
   Lê DXF em texto (ASCII), de qualquer versão: LINE, LWPOLYLINE e
   POLYLINE (com arcos por "bulge"), CIRCLE, ARC, ELLIPSE, SPLINE e
   INSERT (blocos, com escala, rotação e blocos dentro de blocos).
   Textos, cotas e hachuras ficam de fora (só poluem o fundo).
   DWG não dá para ler no navegador: no AutoCAD, Salvar como › DXF
   (ou o ODA File Converter, grátis).

   O resultado vai para planta.desenho, em metros, simplificado:
     { nome, unidade, fator, camadas: [{ nome, visivel, uso, linhas }],
       linhas: [{ c: índice da camada, p: [x0, y0, x1, y1, ...] }],
       x, y, rotacao, escala, opacidade, limites }
   uso da camada: "fundo" (só desenho) | "paredes" (sólido: a fita não
   atravessa, e no 3D vira parede) | "oculta".
   (x, y, rotacao, escala): onde o desenho fica na planta (alinhar).
   Funciona no navegador e no Node (testes).
*/
(function (raiz) {
    "use strict";

    const UNIDADES = { 0: ["sem unidade", 0], 1: ["polegada", 0.0254], 2: ["pé", 0.3048], 4: ["milímetro", 0.001], 5: ["centímetro", 0.01], 6: ["metro", 1], 14: ["decímetro", 0.1] };
    const LIMITE_PONTOS = 40000;            // o desenho vai dentro da planta: fica leve
    const LIMITE_ENTIDADES = 400000;
    const PROFUNDIDADE_BLOCOS = 8;

    /* ---------- leitura dos pares código/valor ---------- */
    function pares(texto) {
        const linhas = texto.split(/\r\n|\r|\n/);
        const lista = [];
        for (let i = 0; i + 1 < linhas.length; i += 2) {
            const codigo = parseInt(linhas[i].trim(), 10);
            if (Number.isNaN(codigo)) {
                // linha em branco perdida: tenta se realinhar
                if (linhas[i].trim() === "") { i -= 1; continue; }
                throw new Error(`DXF inválido perto da linha ${i + 1}.`);
            }
            lista.push([codigo, linhas[i + 1].replace(/\s+$/, "")]);
        }
        return lista;
    }

    // Agrupa em entidades: cada uma começa no código 0
    function entidadesDe(lista, inicio, fim) {
        const ents = [];
        let atual = null;
        for (let k = inicio; k < fim; k++) {
            const [c, v] = lista[k];
            if (c === 0) { atual = { tipo: v.trim().toUpperCase(), g: [] }; ents.push(atual); }
            else if (atual) atual.g.push([c, v]);
        }
        return ents;
    }
    const valor = (e, codigo, padrao = null) => { const p = e.g.find(x => x[0] === codigo); return p ? p[1] : padrao; };
    const num = (e, codigo, padrao = 0) => { const v = valor(e, codigo); const n = v === null ? NaN : parseFloat(v); return Number.isFinite(n) ? n : padrao; };
    const todos = (e, codigo) => e.g.filter(x => x[0] === codigo).map(x => parseFloat(x[1]));

    /* ---------- geometria ---------- */
    function arco(cx, cy, r, a0, a1, pts, passoGraus = 6) {
        // a0 -> a1 anti-horário (graus)
        while (a1 <= a0) a1 += 360;
        const n = Math.max(2, Math.ceil((a1 - a0) / passoGraus));
        for (let i = 0; i <= n; i++) {
            const a = (a0 + (a1 - a0) * i / n) * Math.PI / 180;
            pts.push(cx + r * Math.cos(a), cy + r * Math.sin(a));
        }
    }
    // trecho de polilinha com bulge (arco entre dois vértices)
    function bulge(x0, y0, x1, y1, b, pts) {
        const th = 4 * Math.atan(b);
        const c = Math.hypot(x1 - x0, y1 - y0);
        if (Math.abs(b) < 1e-9 || c < 1e-12) { pts.push(x1, y1); return; }
        const r = c / (2 * Math.sin(Math.abs(th) / 2));
        const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
        const h = Math.sqrt(Math.max(0, r * r - c * c / 4)) * Math.sign(b) * (Math.abs(th) > Math.PI ? -1 : 1);
        const ux = (x1 - x0) / c, uy = (y1 - y0) / c;
        const cx = mx - uy * h, cy = my + ux * h;
        const a0 = Math.atan2(y0 - cy, x0 - cx);
        const n = Math.max(2, Math.ceil(Math.abs(th) / (6 * Math.PI / 180)));
        for (let i = 1; i <= n; i++) {
            const a = a0 + th * i / n;
            pts.push(cx + r * Math.cos(a), cy + r * Math.sin(a));
        }
    }

    // matriz 2D [a, b, c, d, e, f]: x' = a x + c y + e ; y' = b x + d y + f
    const IDENT = [1, 0, 0, 1, 0, 0];
    const multiplicar = (m, n) => [
        m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
        m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
        m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]
    ];
    function aplicar(m, pts) {
        for (let i = 0; i < pts.length; i += 2) {
            const x = pts[i], y = pts[i + 1];
            pts[i] = m[0] * x + m[2] * y + m[4];
            pts[i + 1] = m[1] * x + m[3] * y + m[5];
        }
        return pts;
    }

    /* ---------- leitura ---------- */
    function ler(texto, opcoes = {}) {
        if (typeof texto !== "string") throw new Error("Arquivo vazio.");
        if (texto.startsWith("AutoCAD Binary DXF")) throw new Error("Este DXF está em formato binário. No AutoCAD: Salvar como › DXF e escolha ASCII.");
        if (/^AC10\d\d/.test(texto)) throw new Error("Isto é um DWG, não um DXF. No AutoCAD: Salvar como › DXF (ou converta com o ODA File Converter, que é grátis).");
        const lista = pares(texto);
        const secoes = {};
        for (let k = 0; k < lista.length; k++) {
            if (lista[k][0] === 0 && lista[k][1].trim() === "SECTION" && lista[k + 1] && lista[k + 1][0] === 2) {
                const nome = lista[k + 1][1].trim().toUpperCase();
                let fim = k + 2;
                while (fim < lista.length && !(lista[fim][0] === 0 && lista[fim][1].trim() === "ENDSEC")) fim++;
                secoes[nome] = [k + 2, fim];
                k = fim;
            }
        }
        if (!secoes.ENTITIES) throw new Error("O arquivo não tem a seção ENTITIES: não parece um DXF.");
        const avisos = [];

        // unidades
        let insunits = 0;
        if (secoes.HEADER) {
            const [i0, i1] = secoes.HEADER;
            for (let k = i0; k < i1; k++) if (lista[k][0] === 9 && lista[k][1].trim() === "$INSUNITS" && lista[k + 1]) insunits = parseInt(lista[k + 1][1], 10) || 0;
        }

        // blocos
        const blocos = {};
        if (secoes.BLOCKS) {
            const ents = entidadesDe(lista, ...secoes.BLOCKS);
            let atual = null;
            ents.forEach(e => {
                if (e.tipo === "BLOCK") { atual = { nome: valor(e, 2, "").trim(), bx: num(e, 10), by: num(e, 20), ents: [] }; blocos[atual.nome.toUpperCase()] = atual; }
                else if (e.tipo === "ENDBLK") atual = null;
                else if (atual) atual.ents.push(e);
            });
        }

        const camadas = new Map();
        const polis = [];
        const ignoradas = {};
        let entidades = 0;
        const camada = (e, herdada) => {
            let n = (valor(e, 8, "0") || "0").trim();
            if (n === "0" && herdada) n = herdada;     // camada 0 dentro do bloco: a do INSERT
            if (!camadas.has(n)) camadas.set(n, { nome: n, linhas: 0 });
            return n;
        };
        const guardar = (nome, pts, fechada, m) => {
            if (pts.length < 4) return;
            if (fechada) pts.push(pts[0], pts[1]);
            aplicar(m, pts);
            polis.push({ camada: nome, pts });
            camadas.get(nome).linhas++;
        };

        function processar(ents, m, herdada, profundidade) {
            for (let k = 0; k < ents.length; k++) {
                const e = ents[k];
                if (++entidades > LIMITE_ENTIDADES) throw new Error("Desenho grande demais (mais de 400 mil elementos). Apague o que não interessa (textos, cotas, detalhes) e exporte de novo.");
                const espelho = num(e, 230, 1) < 0;     // eixo de extrusão (0,0,-1): o 2D vem espelhado em x
                const mo = espelho ? multiplicar(m, [-1, 0, 0, 1, 0, 0]) : m;
                switch (e.tipo) {
                    case "LINE": {
                        const nome = camada(e, herdada);
                        guardar(nome, [num(e, 10), num(e, 20), num(e, 11), num(e, 21)], false, m);
                        break;
                    }
                    case "LWPOLYLINE": {
                        const nome = camada(e, herdada);
                        const fechada = (num(e, 70) & 1) === 1;
                        const vs = [];
                        let ultimo = null;
                        e.g.forEach(([c, v]) => {
                            if (c === 10) { ultimo = { x: parseFloat(v), y: 0, b: 0 }; vs.push(ultimo); }
                            else if (c === 20 && ultimo) ultimo.y = parseFloat(v);
                            else if (c === 42 && ultimo) ultimo.b = parseFloat(v) || 0;
                        });
                        polilinha(nome, vs, fechada, mo);
                        break;
                    }
                    case "POLYLINE": {
                        const nome = camada(e, herdada);
                        const flags = num(e, 70);
                        const vs = [];
                        while (k + 1 < ents.length && ents[k + 1].tipo === "VERTEX") {
                            k++;
                            const v = ents[k];
                            if (num(v, 70) & 16) continue;    // ponto de controle de spline
                            vs.push({ x: num(v, 10), y: num(v, 20), b: num(v, 42) });
                        }
                        if (k + 1 < ents.length && ents[k + 1].tipo === "SEQEND") k++;
                        if (flags & 64 || flags & 16) { ignoradas.MALHA = (ignoradas.MALHA || 0) + 1; break; }   // malha 3D
                        polilinha(nome, vs, (flags & 1) === 1, mo);
                        break;
                    }
                    case "CIRCLE": {
                        const nome = camada(e, herdada);
                        const pts = [];
                        arco(num(e, 10), num(e, 20), num(e, 40), 0, 360, pts, 7.5);
                        guardar(nome, pts, false, mo);
                        break;
                    }
                    case "ARC": {
                        const nome = camada(e, herdada);
                        const pts = [];
                        arco(num(e, 10), num(e, 20), num(e, 40), num(e, 50), num(e, 51), pts);
                        guardar(nome, pts, false, mo);
                        break;
                    }
                    case "ELLIPSE": {
                        const nome = camada(e, herdada);
                        const cx = num(e, 10), cy = num(e, 20), ax = num(e, 11), ay = num(e, 21), razao = num(e, 40, 1);
                        let t0 = num(e, 41, 0), t1 = num(e, 42, Math.PI * 2);
                        while (t1 <= t0) t1 += Math.PI * 2;
                        const ra = Math.hypot(ax, ay), rb = ra * razao, rot = Math.atan2(ay, ax);
                        const n = Math.max(8, Math.ceil((t1 - t0) / (Math.PI / 24)));
                        const pts = [];
                        for (let i = 0; i <= n; i++) {
                            const t = t0 + (t1 - t0) * i / n, x = ra * Math.cos(t), y = rb * Math.sin(t);
                            pts.push(cx + x * Math.cos(rot) - y * Math.sin(rot), cy + x * Math.sin(rot) + y * Math.cos(rot));
                        }
                        guardar(nome, pts, false, mo);
                        break;
                    }
                    case "SPLINE": {
                        const nome = camada(e, herdada);
                        const fx = todos(e, 11), fy = todos(e, 21);
                        const cx = todos(e, 10), cy = todos(e, 20);
                        const xs = fx.length >= 2 ? fx : cx, ys = fx.length >= 2 ? fy : cy;
                        const pts = [];
                        for (let i = 0; i < Math.min(xs.length, ys.length); i++) pts.push(xs[i], ys[i]);
                        guardar(nome, pts, (num(e, 70) & 1) === 1, mo);
                        break;
                    }
                    case "INSERT": {
                        const bloco = blocos[(valor(e, 2, "") || "").trim().toUpperCase()];
                        if (!bloco) { ignoradas["bloco sem definição"] = (ignoradas["bloco sem definição"] || 0) + 1; break; }
                        if (profundidade >= PROFUNDIDADE_BLOCOS) { ignoradas["bloco dentro de bloco demais"] = (ignoradas["bloco dentro de bloco demais"] || 0) + 1; break; }
                        const sx = num(e, 41, 1), sy = num(e, 42, 1), rot = num(e, 50) * Math.PI / 180;
                        const c = Math.cos(rot), s = Math.sin(rot);
                        // T(insercao) · R · S · T(-base)
                        let t = [sx * c, sx * s, -sy * s, sy * c, num(e, 10), num(e, 20)];
                        t = multiplicar(t, [1, 0, 0, 1, -bloco.bx, -bloco.by]);
                        const herdar = camada(e, herdada);
                        // matriz de colunas e linhas (70/71) repete o bloco
                        const colunas = Math.max(1, Math.min(50, num(e, 70, 1) | 0)), linhasArr = Math.max(1, Math.min(50, num(e, 71, 1) | 0));
                        const dc = num(e, 44), dl = num(e, 45);
                        for (let i = 0; i < colunas; i++) for (let j = 0; j < linhasArr; j++) {
                            const desloc = [1, 0, 0, 1, c * i * dc - s * j * dl, s * i * dc + c * j * dl];
                            processar(bloco.ents, multiplicar(mo, multiplicar(desloc, t)), herdar, profundidade + 1);
                        }
                        break;
                    }
                    case "SOLID": case "TRACE": {
                        const nome = camada(e, herdada);
                        guardar(nome, [num(e, 10), num(e, 20), num(e, 11), num(e, 21), num(e, 13), num(e, 23), num(e, 12), num(e, 22)], true, mo);
                        break;
                    }
                    default:
                        if (!["VERTEX", "SEQEND", "ATTRIB", "ATTDEF", "VIEWPORT"].includes(e.tipo)) ignoradas[e.tipo] = (ignoradas[e.tipo] || 0) + 1;
                }
            }
        }
        function polilinha(nome, vs, fechada, m) {
            if (vs.length < 2) return;
            const pts = [vs[0].x, vs[0].y];
            const n = fechada ? vs.length : vs.length - 1;
            for (let i = 0; i < n; i++) {
                const a = vs[i], b = vs[(i + 1) % vs.length];
                bulge(a.x, a.y, b.x, b.y, a.b, pts);
            }
            guardar(nome, pts, false, m);
        }

        processar(entidadesDe(lista, ...secoes.ENTITIES), IDENT, null, 0);
        if (!polis.length) throw new Error("Não achei linhas no desenho (só textos, cotas ou elementos 3D?).");

        // unidade: a do arquivo; sem unidade, adivinha pelo tamanho
        const limites = limitesDe(polis);
        const tamanho = Math.max(limites.x1 - limites.x0, limites.y1 - limites.y0);
        let [unidade, fator] = UNIDADES[insunits] || UNIDADES[0];
        if (!fator || opcoes.fator) {
            if (opcoes.fator) { fator = opcoes.fator; unidade = "escolhida"; }
            else {
                fator = tamanho > 2000 ? 0.001 : tamanho > 300 ? 0.01 : 1;
                unidade = fator === 0.001 ? "milímetro (estimado)" : fator === 0.01 ? "centímetro (estimado)" : "metro (estimado)";
                avisos.push(`O arquivo não diz a unidade: pelo tamanho (${Math.round(tamanho)}), parece ${unidade.replace(" (estimado)", "")}. Confira as medidas.`);
            }
        }
        const nomesIgnorados = Object.entries(ignoradas).filter(([t]) => !["TEXT", "MTEXT", "DIMENSION", "HATCH", "POINT"].includes(t));
        if (nomesIgnorados.length) avisos.push("Ficaram de fora: " + nomesIgnorados.map(([t, n]) => `${n} ${t}`).join(", ") + ".");
        return { polis, camadas: [...camadas.values()], unidade, fator, insunits, limites, avisos, ignoradas };
    }

    function limitesDe(polis) {
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        polis.forEach(p => { for (let i = 0; i < p.pts.length; i += 2) { const x = p.pts[i], y = p.pts[i + 1]; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; } });
        return { x0, y0, x1, y1 };
    }

    // Douglas–Peucker numa polilinha plana [x, y, x, y...]
    function simplificarPts(pts, tol) {
        const n = pts.length / 2;
        if (n <= 2) return pts.slice();
        const manter = new Uint8Array(n);
        manter[0] = manter[n - 1] = 1;
        const pilha = [[0, n - 1]];
        while (pilha.length) {
            const [a, b] = pilha.pop();
            const ax = pts[a * 2], ay = pts[a * 2 + 1], bx = pts[b * 2], by = pts[b * 2 + 1];
            const L = Math.hypot(bx - ax, by - ay);
            let maior = -1, idx = -1;
            for (let i = a + 1; i < b; i++) {
                // polilinha fechada (começo = fim): a distância é até o ponto
                const d = L < 1e-9 ? Math.hypot(pts[i * 2] - ax, pts[i * 2 + 1] - ay)
                    : Math.abs((bx - ax) * (ay - pts[i * 2 + 1]) - (ax - pts[i * 2]) * (by - ay)) / L;
                if (d > maior) { maior = d; idx = i; }
            }
            if (maior > tol) { manter[idx] = 1; pilha.push([a, idx], [idx, b]); }
        }
        const saida = [];
        for (let i = 0; i < n; i++) if (manter[i]) saida.push(pts[i * 2], pts[i * 2 + 1]);
        return saida;
    }

    // Em metros, simplificado e com o canto inferior esquerdo em (0, 0)
    function paraDesenho(lido, nomeArquivo = "desenho.dxf", opcoes = {}) {
        const fator = opcoes.fator || lido.fator;
        const L = lido.limites;
        const r3 = v => Math.round(v * 1000) / 1000;
        let tol = 0.01;
        let linhas, total;
        const indice = new Map(lido.camadas.map((c, i) => [c.nome, i]));
        for (let tentativa = 0; tentativa < 8; tentativa++) {
            linhas = []; total = 0;
            for (const p of lido.polis) {
                const m = p.pts.map((v, i) => r3((v - (i % 2 ? L.y0 : L.x0)) * fator));
                let comp = 0;
                for (let i = 2; i < m.length; i += 2) comp += Math.hypot(m[i] - m[i - 2], m[i + 1] - m[i - 1]);
                if (comp < 0.02) continue;
                const s = simplificarPts(m, tol);
                total += s.length / 2;
                linhas.push({ c: indice.get(p.camada), p: s });
            }
            if (total <= LIMITE_PONTOS) break;
            tol *= 2;
        }
        const usadas = new Set(linhas.map(l => l.c));
        const camadas = lido.camadas.map((c, i) => ({
            nome: c.nome, linhas: linhas.filter(l => l.c === i).length, visivel: true,
            uso: /parede|wall|alvenaria|muro/i.test(c.nome) ? "paredes" : /text|cota|dim|hatch|hach|anota/i.test(c.nome) ? "oculta" : "fundo"
        }));
        return {
            nome: String(nomeArquivo).slice(0, 80), unidade: lido.unidade, fator,
            camadas, linhas,
            x: 0, y: 0, rotacao: 0, escala: 1, opacidade: 0.55,
            largura: r3((L.x1 - L.x0) * fator), altura: r3((L.y1 - L.y0) * fator),
            pontos: total, tolerancia: tol,
            avisos: lido.avisos.concat(tol > 0.01 ? [`Desenho muito detalhado: simplificado com tolerância de ${Math.round(tol * 100)} cm.`] : []),
            camadasVazias: lido.camadas.filter((c, i) => !usadas.has(i)).length
        };
    }

    /* ---------- posição do desenho na planta ---------- */
    // ponto do desenho (metros, local) -> planta
    function paraPlanta(d, x, y) {
        const a = (d.rotacao || 0) * Math.PI / 180, e = d.escala || 1;
        return { x: d.x + e * (x * Math.cos(a) - y * Math.sin(a)), y: d.y + e * (x * Math.sin(a) + y * Math.cos(a)) };
    }
    function daPlanta(d, x, y) {
        const a = (d.rotacao || 0) * Math.PI / 180, e = d.escala || 1;
        const dx = (x - d.x) / e, dy = (y - d.y) / e;
        return { x: dx * Math.cos(a) + dy * Math.sin(a), y: -dx * Math.sin(a) + dy * Math.cos(a) };
    }
    // Alinha por dois pares (ponto do desenho, local) -> (ponto da planta).
    // ajustarEscala = false: mantém a escala (só gira e move), o normal com DXF em unidade certa.
    function alinharDoisPontos(d, a1, b1, a2, b2, ajustarEscala = false) {
        const va = { x: a2.x - a1.x, y: a2.y - a1.y }, vb = { x: b2.x - b1.x, y: b2.y - b1.y };
        const la = Math.hypot(va.x, va.y), lb = Math.hypot(vb.x, vb.y);
        if (la < 1e-6 || lb < 1e-6) throw new Error("Os dois pontos precisam ser diferentes.");
        const rot = Math.atan2(vb.y, vb.x) - Math.atan2(va.y, va.x);
        const escala = ajustarEscala ? lb / la : (d.escala || 1);
        const c = Math.cos(rot), s = Math.sin(rot);
        const x = b1.x - escala * (a1.x * c - a1.y * s), y = b1.y - escala * (a1.x * s + a1.y * c);
        let graus = rot * 180 / Math.PI;
        graus = ((graus % 360) + 360) % 360;
        return Object.assign({}, d, { x: Math.round(x * 1000) / 1000, y: Math.round(y * 1000) / 1000, rotacao: Math.round(graus * 1000) / 1000, escala: Math.round(escala * 100000) / 100000 });
    }
    // vértice do desenho mais perto de um ponto da planta (para "pegar" o canto certo)
    function verticeMaisPerto(d, x, y, raio = 0.5) {
        const q = daPlanta(d, x, y), r = raio / (d.escala || 1);
        let melhor = null, dist = r;
        (d.linhas || []).forEach(l => {
            if (d.camadas[l.c] && (d.camadas[l.c].uso === "oculta" || !d.camadas[l.c].visivel)) return;
            for (let i = 0; i < l.p.length; i += 2) {
                const dd = Math.hypot(l.p[i] - q.x, l.p[i + 1] - q.y);
                if (dd < dist) { dist = dd; melhor = { x: l.p[i], y: l.p[i + 1] }; }
            }
        });
        return melhor;
    }
    // linhas das camadas "paredes", já na planta: [[x0, y0, x1, y1], ...]
    function paredesNaPlanta(d) {
        const lista = [];
        if (!d) return lista;
        (d.linhas || []).forEach(l => {
            const c = d.camadas[l.c];
            if (!c || c.uso !== "paredes") return;
            for (let i = 2; i < l.p.length; i += 2) {
                const a = paraPlanta(d, l.p[i - 2], l.p[i - 1]), b = paraPlanta(d, l.p[i], l.p[i + 1]);
                lista.push([a.x, a.y, b.x, b.y]);
            }
        });
        return lista;
    }

    const Dxf = { ler, paraDesenho, simplificarPts, paraPlanta, daPlanta, alinharDoisPontos, verticeMaisPerto, paredesNaPlanta, UNIDADES, LIMITE_PONTOS };
    if (typeof module !== "undefined" && module.exports) module.exports = Dxf;
    else raiz.Dxf = Dxf;
})(typeof window !== "undefined" ? window : globalThis);
