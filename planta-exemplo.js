/* ============================================================
   PLANTA DE EXEMPLO
   ============================================================
   Carregada sozinha na primeira vez que o site abre (sem planta
   nenhuma no navegador), para apresentar o sistema e usar com o
   AGV virtual. Na fábrica, o operador apaga ou edita e desenha
   as próprias linhas, estações e tags.

   Galpão de 24 × 13 m com duas faixas paralelas (ida y = 5,5 m e
   volta y = 6,0 m), trocas laterais nas pontas e no meio, 4
   estações (uma com dois acessos), dois pontos de espera, dois berços e zona lenta.

   Tags no formato que o AGV lê: 10 caracteres hexadecimais
   (0A00000010, 0A00000011...). Ver LEIAME, "Tags RFID".

   Funciona no navegador (window.PlantaExemplo) e no Node
   (require), igual ao planta.js.
*/
(function (raiz, fabrica) {
    if (typeof module === "object" && module.exports) module.exports = fabrica(require("./planta.js"));
    else raiz.PlantaExemplo = fabrica(raiz.Planta);
})(typeof self !== "undefined" ? self : this, function (Planta) {
    "use strict";

    const NOME = "Metalúrgica de exemplo";
    const NOME_PEQUENA = "Galpão de exemplo";

    // A planta pequena da 0.15 (24 × 13 m): os testes usam
    function plantaPequena() {
        const p = Planta.criarVazia(NOME_PEQUENA);
        p.dimensoes = { largura: 24, altura: 13 };
        p.grade = 0.5;
        p.estacoes = [
            { id: "E01", nome: "Prensa 1" }, { id: "E02", nome: "Prensa 2" },
            { id: "E03", nome: "Almoxarifado" }, { id: "E04", nome: "Montagem" }
        ];
        let tag = 0x10;
        const rfid = () => "0A" + (tag++).toString(16).toUpperCase().padStart(8, "0");
        const no = (id, tipo, x, y, extra = {}) => p.nos.push(Object.assign(
            { id, tipo, nome: "", x, y, rfid: rfid(), orientacaoChegada: null, barreira: 0 }, extra));

        // faixa de ida (leste) y = 5,5 e faixa de volta (oeste) y = 6,0
        [[1.5, "01"], [5, "02"], [10, "03"], [15, "04"], [20, "05"], [22.5, "06"]].forEach(([x, n]) => {
            no("R" + n, "REFERENCIA", x, 5.5);
            no("R1" + n.slice(1), "REFERENCIA", x, 6.0);
        });
        no("E01", "ESTACAO", 5, 9.4, { estacao: "E01", orientacaoChegada: 90, barreira: 300 });
        no("E02", "ESTACAO", 10, 9.4, { estacao: "E02", orientacaoChegada: 90, barreira: 300 });
        no("E03", "ESTACAO", 5, 2.3, { estacao: "E03", orientacaoChegada: 270, barreira: 300 });
        no("E04", "ESTACAO", 15, 2.3, { estacao: "E04", orientacaoChegada: 270, barreira: 300 });
        no("E04-2", "ESTACAO", 17.5, 9.4, { estacao: "E04", orientacaoChegada: 90, nome: "Kits" });
        no("R17", "REFERENCIA", 17.5, 6.0);
        no("W01", "ESPERA", 20, 2.3, { nome: "Espera" });
        no("W02", "ESPERA", 10, 2.3, { nome: "Espera 2" });
        // berços (casa e carregador dos AGVs), em ramal, fora do caminho
        no("B01", "BERCO", 1.5, 2.3, { nome: "Berço 1", orientacaoChegada: 270, barreira: 300 });
        no("B02", "BERCO", 22.5, 2.3, { nome: "Berço 2", orientacaoChegada: 270, barreira: 300 });

        const seg = (id, a, b, sentido = "DUPLO", tipo = "LINHA", extra = {}) =>
            p.segmentos.push(Object.assign({ id, tipo, a, b, sentido, velocidadeMaxima: 0, barreira: 0, tags: [] }, extra));
        seg("S01", "R01", "R02", "A_PARA_B"); seg("S02", "R02", "R03", "A_PARA_B");
        seg("S03", "R03", "R04", "A_PARA_B", "LINHA", { tags: [{ rfid: "0A000000C1", distancia: 2.5 }] });
        seg("S04", "R04", "R05", "A_PARA_B"); seg("S05", "R05", "R06", "A_PARA_B");
        seg("S11", "R16", "R15", "A_PARA_B"); seg("S12", "R15", "R17", "A_PARA_B"); seg("S13", "R17", "R14", "A_PARA_B");
        seg("S14", "R14", "R13", "A_PARA_B"); seg("S15", "R13", "R12", "A_PARA_B"); seg("S16", "R12", "R11", "A_PARA_B");
        seg("S21", "R06", "R16", "DUPLO", "LATERAL"); seg("S22", "R11", "R01", "DUPLO", "LATERAL");
        seg("S23", "R13", "R03", "DUPLO", "LATERAL");
        seg("S31", "R12", "E01"); seg("S32", "R13", "E02"); seg("S33", "R02", "E03");
        seg("S34", "R04", "E04"); seg("S35", "R17", "E04-2"); seg("S36", "R05", "W01");
        seg("S37", "R03", "W02");
        seg("S38", "R01", "B01"); seg("S39", "R06", "B02");

        p.layout = [
            { id: "L01", tipo: "MAQUINA", nome: "Prensa 1", x: 5, y: 11.3, largura: 3.4, profundidade: 1.8, rotacao: 0 },
            { id: "L02", tipo: "MAQUINA", nome: "Prensa 2", x: 10, y: 11.3, largura: 3.4, profundidade: 1.8, rotacao: 0 },
            { id: "L03", tipo: "PRATELEIRA", nome: "Prateleira de kits", x: 18.5, y: 11.6, largura: 6, profundidade: 1, rotacao: 0 },
            { id: "L04", tipo: "BANCADA", nome: "Almoxarifado", x: 5, y: 0.9, largura: 4, profundidade: 1.2, rotacao: 0 },
            { id: "L05", tipo: "MAQUINA", nome: "Montagem", x: 15, y: 0.9, largura: 4, profundidade: 1.2, rotacao: 0 },
            { id: "L06", tipo: "CORREDOR", nome: "", x: 12, y: 5.75, largura: 23, profundidade: 2.2, rotacao: 0 },
            { id: "L07", tipo: "ZONA_LENTA", nome: "Zona lenta", x: 12.5, y: 5.75, largura: 2.2, profundidade: 2.6, rotacao: 0, velocidadeMaxima: 0.04 },
            { id: "L08", tipo: "PILAR", nome: "", x: 12.5, y: 8.6, largura: 0.35, profundidade: 0.35, rotacao: 0 },
            { id: "L09", tipo: "PILAR", nome: "", x: 12.5, y: 2.9, largura: 0.35, profundidade: 0.35, rotacao: 0 }
        ];
        const pronta = Planta.normalizar(p);
        pronta.revisao = 1;
        return pronta;
    }

    function missoesPequenas() {
        return [
            { id: "M001", nome: "Abastecer montagem", etapas: [
                { tipo: "IR_PARA", destino: "E01" }, { tipo: "CARREGAR" }, { tipo: "IR_PARA", destino: "E04" },
                { tipo: "AGUARDAR_CONFIRMACAO", mensagem: "Kit conferido?" }, { tipo: "DESCARREGAR" }] },
            { id: "M002", nome: "Voltar para a espera", etapas: [{ tipo: "IR_PARA", destino: "W01" }] },
            { id: "M003", nome: "Ronda de inspeção", etapas: [
                { tipo: "IR_PARA", destino: "E01" }, { tipo: "IR_PARA", destino: "E02" }, { tipo: "AGUARDAR", tempo: 5 },
                { tipo: "IR_PARA", destino: "E04" }, { tipo: "IR_PARA", destino: "W01" }] },
            // Kit e vazio de cada prensa (pedidos pelos postos P1 e P2):
            // o vazio começa onde o kit termina, então o despachante faz os dois na mesma viagem.
            { id: "M010", nome: "Kit para a Prensa 1", prioridade: 2, etapas: [
                { tipo: "IR_PARA", destino: "E03" }, { tipo: "CARREGAR" }, { tipo: "IR_PARA", destino: "E01" }, { tipo: "DESCARREGAR" }] },
            { id: "M011", nome: "Vazio da Prensa 1", prioridade: 1, etapas: [
                { tipo: "IR_PARA", destino: "E01" }, { tipo: "CARREGAR" }, { tipo: "IR_PARA", destino: "E03" }, { tipo: "DESCARREGAR" }] },
            { id: "M020", nome: "Kit para a Prensa 2", prioridade: 2, etapas: [
                { tipo: "IR_PARA", destino: "E03" }, { tipo: "CARREGAR" }, { tipo: "IR_PARA", destino: "E02" }, { tipo: "DESCARREGAR" }] },
            { id: "M021", nome: "Vazio da Prensa 2", prioridade: 1, etapas: [
                { tipo: "IR_PARA", destino: "E02" }, { tipo: "CARREGAR" }, { tipo: "IR_PARA", destino: "E03" }, { tipo: "DESCARREGAR" }] }
        ];
    }

    // Postos da planta pequena (Operação › Postos): cada um com os seus botões
    function postosPequenos() {
        return [
            { id: "P1", nome: "Prensa 1", ponto: "E01", permiteUrgente: true, usuarios: [],
              botoes: [{ rotulo: "Pedir kit", missao: "M010" }, { rotulo: "Levar vazio", missao: "M011" }] },
            { id: "P2", nome: "Prensa 2", ponto: "E02", permiteUrgente: true, usuarios: [],
              botoes: [{ rotulo: "Pedir kit", missao: "M020" }, { rotulo: "Levar vazio", missao: "M021" }] },
            { id: "P3", nome: "Montagem", ponto: "E04", permiteUrgente: false, usuarios: [],
              botoes: [{ rotulo: "Abastecer", missao: "M001" }] }
        ];
    }

    /* ========================================================
       METALÚRGICA DE EXEMPLO (0.16): 60 × 40 m
       ========================================================
       Anel de mão única (anti-horário): sul (y = 8, para leste), leste
       (x = 52, para o norte), norte (y = 34, para oeste) e oeste (x = 10,
       para o sul), com curva de concordância de 2 m em cada canto (o
       rebocador carregado não gira no ponto). Ramais com 2,5 m de
       afastamento no oeste (supermercado do comboio) e no leste
       (abastecimento da montagem). Ramos curtos de mão dupla até as
       estações: estamparia e expedição ao sul, submontagem logo ao norte
       do anel sul, usinagem e inspeção ao sul do anel norte, kits, berços
       e espera ao norte. Frota: 2 Atta G (kits), 2 Atta E (carrinhos),
       1 Atta R (CNC → inspeção pelas esteiras) e 1 Atta T (milk-run). */
    function planta() {
        const p = Planta.criarVazia(NOME);
        p.dimensoes = { largura: 60, altura: 40 };
        p.grade = 1;
        let tag = 0x100;
        const rfid = () => "0B" + (tag++).toString(16).toUpperCase().padStart(8, "0");
        const no = (id, x, y, tipo = "REFERENCIA", extra = {}) => {
            const n = Object.assign({ id, tipo, nome: "", x, y, rfid: rfid(), orientacaoChegada: null, barreira: 0 }, extra);
            p.nos.push(n);
            return n;
        };
        let ns = 0;
        const seg = (a, b, sentido = "A_PARA_B", extra = {}) => {
            const s = Object.assign({ id: "S" + String(++ns).padStart(2, "0"), tipo: "LINHA", a, b, sentido, velocidadeMaxima: 0, barreira: 0, tags: [] }, extra);
            p.segmentos.push(s);
            return s;
        };
        const estacao = (id, nome, carga, x, y, ori, ligarEm, barreira = 0) => {
            p.estacoes.push({ id, nome, carga });
            no(id, x, y, "ESTACAO", { estacao: id, orientacaoChegada: ori, barreira });
            seg(ligarEm, id, "DUPLO");
        };
        const parada = (id, nome, tipo, x, y, ligarEm, ori = null) => {
            no(id, x, y, tipo, { nome, orientacaoChegada: ori });
            seg(ligarEm, id, "DUPLO");
        };

        // ---------- anel ----------
        no("CSO", 10, 8); ["SUL18", "SUL26", "SUL34", "SUL42", "SUL48"].forEach(id => no(id, Number(id.slice(3)), 8, "REFERENCIA", { nome: `Corredor sul ${id.slice(3)}` })); no("CSE", 52, 8);
        no("CNE", 52, 34); ["NOR44", "NOR36", "NOR28", "NOR20", "NOR14"].forEach(id => no(id, Number(id.slice(3)), 34, "REFERENCIA", { nome: `Corredor norte ${id.slice(3)}` })); no("CNO", 10, 34);
        const sul = ["CSO", "SUL18", "SUL26", "SUL34", "SUL42", "SUL48", "CSE"];
        for (let i = 1; i < sul.length; i++) seg(sul[i - 1], sul[i]);
        seg("CSE", "CNE");
        const norte = ["CNE", "NOR44", "NOR36", "NOR28", "NOR20", "NOR14", "CNO"];
        for (let i = 1; i < norte.length; i++) seg(norte[i - 1], norte[i]);
        seg("CNO", "CSO");

        // ---------- estações e paradas (ramos de mão dupla) ----------
        estacao("PR1", "Prensa 1", "CARRINHO", 18, 5.2, 270, "SUL18");
        estacao("PR2", "Prensa 2", "CARRINHO", 26, 5.2, 270, "SUL26");
        estacao("PR3", "Prensa 3", "CARRINHO", 34, 5.2, 270, "SUL34");
        estacao("SOLDA", "Box de solda", "CARRINHO", 42, 5.2, 270, "SUL42");
        estacao("EXPED", "Expedição", "CARRINHO", 48, 5.2, 270, "SUL48");
        estacao("SUB1", "Submontagem 1", "KIT", 18, 11.4, 90, "SUL18");
        estacao("SUB2", "Submontagem 2", "KIT", 26, 11.4, 90, "SUL26");
        estacao("SUB3", "Submontagem 3", "KIT", 34, 11.4, 90, "SUL34");
        estacao("SUB4", "Submontagem 4", "KIT", 42, 11.4, 90, "SUL42");
        parada("W02", "Espera sul", "ESPERA", 48, 11.4, "SUL48");
        estacao("CNC1", "CNC 1", "ESTEIRA", 44, 31.2, 270, "NOR44", 250);
        estacao("CNC2", "CNC 2", "ESTEIRA", 36, 31.2, 270, "NOR36", 250);
        estacao("CNC3", "CNC 3", "ESTEIRA", 28, 31.2, 270, "NOR28", 250);
        estacao("INSP", "Inspeção", "ESTEIRA", 20, 31.2, 270, "NOR20", 250);
        estacao("KITS", "Supermercado de kits", "KIT", 14, 37, 90, "NOR14", 400);   // 0.24.3: o flow rack fica a 0,95 m do sensor (a barreira padrão, 1 m, parava o Atta 2 cm antes da tag)
        parada("W01", "Espera norte", "ESPERA", 20, 37, "NOR20");
        parada("B01", "Berço 1", "BERCO", 28, 37, "NOR28", 90);
        parada("B02", "Berço 2", "BERCO", 36, 37, "NOR36", 90);
        parada("B03", "Berço 3", "BERCO", 44, 37, "NOR44", 90);

        // ---------- curvas nos cantos e ramais ----------
        ["CSO", "CSE", "CNE", "CNO"].forEach(c => Planta.criarCurvaConcordancia(p, c, 2));
        const reta = (x1, y1, x2, y2) => p.segmentos.find(s => {
            const a = Planta.noPorId(p, s.a), b = Planta.noPorId(p, s.b);
            return s.tipo === "LINHA" && Math.abs(a.x - x1) < 0.01 && Math.abs(a.y - y1) < 0.01 && Math.abs(b.x - x2) < 0.01 && Math.abs(b.y - y2) < 0.01;
        });
        const leste = Planta.criarRamal(p, reta(52, 10, 52, 32).id, { de: 2, ate: 20, afastamento: 2.5, raio: 2, lado: "DIR" });
        const oeste = Planta.criarRamal(p, reta(10, 32, 10, 10).id, { de: 2, ate: 20, afastamento: 2.5, raio: 2, lado: "DIR" });
        // paradas do comboio nos ramais (o trem inteiro cabe fora da linha principal)
        const pararNoRamal = (ramal, id, nome, y, ori) => {
            const [p1, p2] = ramal.paralelo;
            const s = p.segmentos.find(x => x.a === p1.id && x.b === p2.id);
            const r = Planta.dividirSegmento(p, s.id, Math.abs(y - p1.y));
            const n = r.ponto;
            p.estacoes.push({ id, nome, carga: "COMBOIO" });
            const antigo = n.id;
            n.id = id; n.tipo = "ESTACAO"; n.estacao = id; n.orientacaoChegada = ori;
            p.segmentos.forEach(x => { if (x.a === antigo) x.a = id; if (x.b === antigo) x.b = id; });
        };
        pararNoRamal(leste, "MONT", "Abastecimento da montagem", 25.0, 90);
        pararNoRamal(oeste, "SUPER", "Supermercado do comboio", 17.5, 270);
        // todo ponto com tag (as bifurcações precisam dela)
        p.nos.forEach(n => { if (!n.rfid) n.rfid = rfid(); });

        // ---------- layout ----------
        let nl = 0;
        const obj = (tipo, x, y, largura, profundidade, nome = "", extra = {}) =>
            p.layout.push(Object.assign({ id: "L" + String(++nl).padStart(2, "0"), tipo, nome, x, y, largura, profundidade, rotacao: 0 }, extra));
        // corredores pintados sob o anel
        obj("CORREDOR", 31, 8, 45, 3); obj("CORREDOR", 31, 34, 45, 3);
        obj("CORREDOR", 10, 21, 3, 29); obj("CORREDOR", 52, 21, 3, 29);
        // segurança
        obj("FAIXA_PEDESTRE", 30, 8, 1.2, 3.4, "Faixa da estamparia");
        obj("FAIXA_PEDESTRE", 32, 34, 1.2, 3.4, "Faixa da usinagem");
        obj("CRUZAMENTO_EMPILHADEIRA", 10, 22, 3.4, 3.4, "Cruzamento das empilhadeiras");
        obj("ZONA_LENTA", 55.5, 21, 4, 15, "Montagem", { velocidadeMaxima: 0.05 });
        obj("AREA_LIVRE", 1.4, 5, 2.2, 2.4, "Saída de emergência");
        obj("PORTA", 0.12, 5, 1.2, 0.15, "Saída de emergência", { rotacao: 90 });
        obj("AREA_LIVRE", 58.6, 36, 2.4, 3, "Quadro elétrico");
        obj("MAQUINA", 59.6, 36, 0.5, 1.6, "Quadro elétrico", { altura: 2.0 });
        // estrutura
        [22, 34, 46].forEach(x => [18, 24].forEach(y => obj("PILAR", x, y, 0.4, 0.4)));
        obj("ESCRITORIO", 5, 38, 9, 3.4, "Escritório");
        obj("PORTAO", 4, 0.15, 4.5, 0.25, "Recebimento");
        // estamparia e solda (sul)
        [18, 26, 34].forEach((x, i) => obj("PRENSA", x, 2.6, 2.2, 2.0, `Prensa ${i + 1}`));
        obj("SOLDA", 42, 2.6, 2.5, 2.5, "Box de solda");
        [[15.4, 3], [23.4, 3], [31.4, 3]].forEach(([x, y]) => obj("PALETE", x, y, 1.2, 1.0, "", { altura: 0.9 }));
        // expedição
        [47.5, 52, 56.5].forEach((x, i) => obj("DOCA", x, 0.25, 3.5, 0.4, `Doca ${i + 1}`));
        obj("PALETE", 51, 3.2, 1.2, 1.0); obj("PALETE", 53, 3.2, 1.2, 1.0); obj("CAIXAS", 55, 3.2, 0.8, 0.6);
        obj("EMPILHADEIRA", 57.5, 4.2, 2.3, 1.1, "Empilhadeira", { rotacao: 180 });
        // submontagem
        [18, 26, 34, 42].forEach((x, i) => {
            obj("BANCADA", x, 13.3, 1.6, 0.7, `Submontagem ${i + 1}`);
            obj("POSTO", x + 1.4, 13.2, 0.8, 0.6, "");
            obj("PESSOA", x + 0.2, 14.3, 0.5, 0.4, "");
        });
        // centro: célula de robô, injetora e WIP
        obj("CELULA_ROBO", 28, 21, 3.6, 3.6, "Célula de robô");
        obj("INJETORA", 40, 21, 5, 1.8, "Injetora");
        obj("CAIXAS", 15.5, 20, 0.8, 0.6); obj("CAIXAS", 16.6, 20, 0.8, 0.6); obj("PALETE", 16, 22.5, 1.2, 1.0, "WIP");
        // usinagem (norte)
        [[44, "CNC 1"], [36, "CNC 2"], [28, "CNC 3"]].forEach(([x, nome]) => {
            obj("CNC", x, 27.2, 2.6, 2.0, nome);
            obj("ESTEIRA", x, 30.0, 0.6, 1.6, "", { altura: 0.9 });
        });
        obj("TORNO", 24, 27.4, 3, 1.2, "Torno");
        obj("INSPECAO", 20, 28.2, 1.8, 0.9, "Inspeção");
        obj("ESTEIRA", 20, 30.0, 0.6, 1.6, "", { altura: 0.9 });
        obj("PESSOA", 21.4, 28.4, 0.5, 0.4, "");
        // kits, berços e carregadores (norte)
        obj("FLOW_RACK", 14, 38.6, 3, 1.0, "Kits");
        [28, 36, 44].forEach(x => obj("CARREGADOR", x, 38.5, 0.6, 0.3));
        // supermercado do comboio (oeste)
        [13.5, 17, 20.5, 24, 27.5].forEach(y => obj("PORTA_PALETE", 2.2, y, 2.7, 1.1, "", { rotacao: 90 }));
        obj("FLOW_RACK", 5.2, 17.5, 1.0, 4, "Abastecimento do comboio");
        obj("PESSOA", 5.4, 20.2, 0.5, 0.4, "");
        // montagem final (leste)
        obj("ESTEIRA", 57.6, 21, 0.8, 14, "Linha de montagem");
        [17, 20.5, 24, 27.5].forEach((y, i) => {
            obj("POSTO", 56.5, y, 0.6, 0.8, `Montagem ${i + 1}`);
            obj("PESSOA", 56.6, y + 0.9, 0.5, 0.4, "");
        });
        return Planta.normalizar(p);
    }

    function missoes() {
        const ir = (destino, exato) => exato ? { tipo: "IR_PARA", destino, exato: true } : { tipo: "IR_PARA", destino };
        const levar = (id, nome, de, para, prioridade = 1) => ({ id, nome, prioridade, etapas: [ir(de), { tipo: "CARREGAR" }, ir(para), { tipo: "DESCARREGAR" }] });
        return [
            levar("M101", "Kit para a submontagem 1", "KITS", "SUB1", 2),
            levar("M102", "Kit para a submontagem 2", "KITS", "SUB2", 2),
            levar("M103", "Kit para a submontagem 3", "KITS", "SUB3", 2),
            levar("M104", "Kit para a submontagem 4", "KITS", "SUB4", 2),
            levar("M111", "Peças da Prensa 1 para a solda", "PR1", "SOLDA"),
            levar("M112", "Peças da Prensa 2 para a solda", "PR2", "SOLDA"),
            levar("M113", "Peças da Prensa 3 para a solda", "PR3", "SOLDA"),
            levar("M120", "Solda para a expedição", "SOLDA", "EXPED"),
            levar("M131", "CNC 1 para a inspeção", "CNC1", "INSP"),
            levar("M132", "CNC 2 para a inspeção", "CNC2", "INSP"),
            levar("M133", "CNC 3 para a inspeção", "CNC3", "INSP"),
            // milk-run: engata no supermercado, abastece a montagem pelo ramal e volta
            { id: "M140", nome: "Milk-run da montagem", prioridade: 1, etapas: [
                ir("SUPER"), { tipo: "CARREGAR" }, ir("SUL34", true), ir("MONT"),
                { tipo: "AGUARDAR_CONFIRMACAO", mensagem: "Carrinhos trocados?" }, ir("NOR28", true), ir("SUPER"), { tipo: "DESCARREGAR" }] },
            { id: "M150", nome: "Ir para a espera norte", prioridade: 0, etapas: [ir("W01")] },
            { id: "M151", nome: "Ir para a espera sul", prioridade: 0, etapas: [ir("W02")] }
        ];
    }

    function postos() {
        const botao = (rotulo, missao, modelos, extra = {}) => Object.assign({ rotulo, missao, modelos }, extra);
        return [
            ...[1, 2, 3, 4].map(n => ({ id: "S" + n, nome: `Submontagem ${n}`, ponto: "SUB" + n, permiteUrgente: true, usuarios: [],
                botoes: [botao("Pedir kit", "M10" + n, ["atta-g-o"])] })),
            ...[1, 2, 3].map(n => ({ id: "PR" + n, nome: `Prensa ${n}`, ponto: "PR" + n, permiteUrgente: false, usuarios: [],
                botoes: [botao("Levar peças", "M11" + n, ["atta-e-o"])] })),
            { id: "SOLDA", nome: "Box de solda", ponto: "SOLDA", permiteUrgente: false, usuarios: [], botoes: [botao("Levar para a expedição", "M120", ["atta-e-o"], { preferidos: ["E2"] })] },
            ...[1, 2, 3].map(n => ({ id: "CNC" + n, nome: `CNC ${n}`, ponto: "CNC" + n, permiteUrgente: false, usuarios: [],
                botoes: [botao("Levar para a inspeção", "M13" + n, ["atta-r-o"])] })),
            { id: "MONT", nome: "Montagem", ponto: "MONT", permiteUrgente: false, usuarios: [], botoes: [botao("Chamar o milk-run", "M140", ["atta-t-o"], { preferidos: ["T1"], soEstes: true })] }
        ];
    }

    // Os kits das submontagens chegam pelo consumo (um kit dura 6 min)
    function programacoes() {
        return [1, 2, 3, 4].map(n => ({ posto: "S" + n, missao: "M10" + n, ativo: true, modo: "consumo", dura_min: 6, folga_min: 1,
            inicio: "06:00", fim: "22:00", dias: [1, 2, 3, 4, 5, 6], primeiro: "janela" }))
            .concat([{ posto: "MONT", missao: "M140", ativo: true, modo: "intervalo", intervalo_min: 20, inicio: "06:00", fim: "22:00", dias: [1, 2, 3, 4, 5, 6], primeiro: "janela" }]);
    }

    // AGVs virtuais da apresentação: id, modelo e onde começam
    function frotaVirtual() {
        return [
            { id: "G1", nome: "Garra 1", modelo: "atta-g-o", ponto: "B01" },
            { id: "G2", nome: "Garra 2", modelo: "atta-g-o", ponto: "B02" },
            { id: "E1", nome: "Elevação 1", modelo: "atta-e-o", ponto: "B03" },
            { id: "E2", nome: "Elevação 2", modelo: "atta-e-o", ponto: "W02" },
            { id: "R1", nome: "Roletes 1", modelo: "atta-r-o", ponto: "W01" },
            { id: "T1", nome: "Rebocador 1", modelo: "atta-t-o", ponto: "SUPER" }
        ];
    }

    return { NOME, NOME_PEQUENA, planta, missoes, postos, programacoes, frotaVirtual, plantaPequena, missoesPequenas, postosPequenos };
});
