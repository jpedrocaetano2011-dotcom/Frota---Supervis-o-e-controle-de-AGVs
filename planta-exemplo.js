/* ============================================================
   PLANTA DE EXEMPLO
   ============================================================
   Carregada sozinha na primeira vez que o site abre (sem planta
   nenhuma no navegador), para apresentar o sistema e usar com o
   AGV virtual. Na fábrica, o operador apaga ou edita e desenha
   as próprias linhas, estações e tags.

   Galpão de 24 × 13 m com duas faixas paralelas (ida y = 5,5 m e
   volta y = 6,0 m), trocas laterais nas pontas e no meio, 4
   estações (uma com dois acessos), ponto de espera e zona lenta.

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

    const NOME = "Galpão de exemplo";

    function planta() {
        const p = Planta.criarVazia(NOME);
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
        no("E03", "ESTACAO", 5, 2.3, { estacao: "E03", orientacaoChegada: 270 });
        no("E04", "ESTACAO", 15, 2.3, { estacao: "E04", orientacaoChegada: 270, barreira: 300 });
        no("E04-2", "ESTACAO", 17.5, 9.4, { estacao: "E04", orientacaoChegada: 90, nome: "Kits" });
        no("R17", "REFERENCIA", 17.5, 6.0);
        no("W01", "ESPERA", 20, 2.3, { nome: "Espera" });

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

    function missoes() {
        return [
            { id: "M001", nome: "Abastecer montagem", etapas: [
                { tipo: "IR_PARA", destino: "E01" }, { tipo: "CARREGAR" }, { tipo: "IR_PARA", destino: "E04" },
                { tipo: "AGUARDAR_CONFIRMACAO", mensagem: "Kit conferido?" }, { tipo: "DESCARREGAR" }] },
            { id: "M002", nome: "Voltar para a espera", etapas: [{ tipo: "IR_PARA", destino: "W01" }] },
            { id: "M003", nome: "Ronda de inspeção", etapas: [
                { tipo: "IR_PARA", destino: "E01" }, { tipo: "IR_PARA", destino: "E02" }, { tipo: "AGUARDAR", tempo: 5 },
                { tipo: "IR_PARA", destino: "E04" }, { tipo: "IR_PARA", destino: "W01" }] }
        ];
    }

    return { NOME, planta, missoes };
});
