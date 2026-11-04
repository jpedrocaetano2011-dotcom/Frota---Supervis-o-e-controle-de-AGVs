/* ============================================================
   UI — avisos, confirmações, ícones e tema
   ============================================================
   Substitui alert() e confirm() do navegador:
     ui.aviso("texto", "erro" | "sucesso" | "aviso" | "info")
     if (!(await ui.confirmar({ titulo, texto, confirmar, perigo }))) return;
   Carregado antes de todos os outros scripts.
*/

(function (raiz) {
    "use strict";

    const ICONES = {
        frota: "M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z",
        visao: "M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3zM9 3v15M15 6v15",
        manual: "M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18zM12 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6zM12 3v3M12 18v3M3 12h3M18 12h3",
        sensores: "M5 19a10 10 0 0 1 0-14M19 5a10 10 0 0 1 0 14M8.5 15.5a5 5 0 0 1 0-7M15.5 8.5a5 5 0 0 1 0 7",
        diagnostico: "M3 12h4l3-8 4 16 3-8h4",
        historico: "M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18zM12 7v5l3 2",
        config: "M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1M15 4v4M9 10v4M17 16v4",
        missoes: "M5 21V4h11l-2 4 2 4H5",
        planta: "M3 3h18v18H3zM3 9h8v12M11 14h10",
        virtual: "M12 2l9 5v10l-9 5-9-5V7zM12 22V12M21 7l-9 5-9-5",
        agv: "M4 6h16v12H4zM9 10h6M7.5 17v3M16.5 17v3",
        alerta: "M12 3l10 18H2zM12 10v4M12 17v.5",
        ok: "M5 12l5 5L20 7",
        info: "M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18zM12 11v6M12 7.5v.5",
        erro: "M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18zM9 9l6 6M15 9l-6 6",
        tag: "M3 12l9-9h7v7l-9 9zM15.5 8.5h0",
        giro: "M4 12a8 8 0 1 0 2.3-5.6M4 4v4h4",
        giroHorario: "M20 12a8 8 0 1 1-2.3-5.6M20 4v4h-4",
        enviar: "M4 12l16-8-6 16-2-7z",
        ajuste: "M4 6h9M17 6h3M4 18h11M19 18h1M15 4v4M17 16v4",
        liga: "M12 3v8M6.3 6.3a8 8 0 1 0 11.4 0",
        escudo: "M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z",
        escudoOk: "M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6zM9 12l2 2 4-4",
        local: "M12 21s7-6.2 7-12a7 7 0 1 0-14 0c0 5.8 7 12 7 12zM12 11.5a2.5 2.5 0 1 0 0-5a2.5 2.5 0 1 0 0 5z",
        subir: "M12 19V5M5 12l7-7 7 7",
        descer: "M12 5v14M5 12l7 7 7-7",
        confirmar: "M9 12l2 2 4-4M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18z",
        relogio: "M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18zM12 7v5l3 2",
        camadas: "M12 3l9 5-9 5-9-5zM3 13l9 5 9-5",
        busca: "M11 4a7 7 0 1 0 0 14a7 7 0 1 0 0-14zM20 20l-4-4",
        sol: "M12 8a4 4 0 1 0 0 8a4 4 0 1 0 0-8zM12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M5 19l1.5-1.5M17.5 6.5L19 5",
        lua: "M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z",
        menu: "M4 6h16M4 12h16M4 18h16",
        lapis: "M4 20h4L19 9l-4-4L4 16zM14 6l4 4",
        lixo: "M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13",
        copiar: "M8 8h12v12H8zM4 16V4h12",
        mais: "M12 5v14M5 12h14",
        x: "M6 6l12 12M18 6L6 18",
        cima: "M6 15l6-6 6 6",
        baixo: "M6 9l6 6 6-6",
        caixa: "M5 5h14v14H5z",
        rfid: "M12 2l3 7h7l-5.5 4.5 2 7.5-6.5-4.5L5.5 21l2-7.5L2 9h7z",
        wifi: "M2 9a15 15 0 0 1 20 0M5.5 12.5a10 10 0 0 1 13 0M9 16a5 5 0 0 1 6 0M12 19.5v.5",
        led: "M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.5c.8.8 1 1.5 1 2.5h6c0-1 .2-1.7 1-2.5A6 6 0 0 0 12 3z",
        lateral: "M4 12h16M8 8l-4 4 4 4M16 8l4 4-4 4"
    };

    function icone(nome, classe = "") {
        const d = ICONES[nome] || ICONES.info;
        return `<svg class="icone ${classe}" viewBox="0 0 24 24" aria-hidden="true"><path d="${d}"></path></svg>`;
    }

    function escapar(texto) {
        return String(texto ?? "")
            .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    }

    /* ---------------- avisos ---------------- */

    function caixaToasts() {
        let caixa = document.getElementById("toasts");
        if (!caixa) {
            caixa = document.createElement("div");
            caixa.id = "toasts";
            caixa.className = "toasts";
            caixa.setAttribute("role", "status");
            caixa.setAttribute("aria-live", "polite");
            document.body.appendChild(caixa);
        }
        return caixa;
    }

    // Tipo deduzido do texto quando não informado (mensagens antigas do site).
    function deduzirTipo(texto) {
        if (/desconectad|não foi|nao foi|erro|inválid|invalid|falh|não pode|não é possível|bloquead|impossível/i.test(texto)) return "erro";
        if (/salv|enviad|publicad|conclu|sucesso|copiad/i.test(texto)) return "sucesso";
        return "info";
    }

    function aviso(texto, tipo) {
        const conteudo = String(texto ?? "");
        const t = tipo || deduzirTipo(conteudo);
        const el = document.createElement("div");
        el.className = `toast ${t}`;
        const nomeIcone = t === "erro" ? "erro" : t === "sucesso" ? "ok" : t === "aviso" ? "alerta" : "info";
        el.innerHTML = `${icone(nomeIcone)}<p>${escapar(conteudo)}</p><button type="button" aria-label="Fechar">×</button>`;
        const fechar = () => {
            el.classList.add("saindo");
            setTimeout(() => el.remove(), 220);
        };
        el.querySelector("button").addEventListener("click", fechar);
        caixaToasts().appendChild(el);
        setTimeout(fechar, t === "erro" ? 7000 : 4500);
        return el;
    }

    /* ---------------- confirmação ---------------- */

    function confirmar(opcoes) {
        const o = typeof opcoes === "string" ? { texto: opcoes } : (opcoes || {});
        return new Promise(resolver => {
            const fundo = document.createElement("div");
            fundo.className = "modal-overlay ativo";
            fundo.innerHTML = `
                <div class="modal ui-confirmar ${o.perigo ? "perigo" : ""}" role="alertdialog" aria-modal="true" aria-labelledby="uiConfirmarTitulo">
                    <div class="modal-cabecalho">
                        <div><h2 id="uiConfirmarTitulo">${escapar(o.titulo || "Confirmar")}</h2></div>
                    </div>
                    <div class="modal-corpo"><p>${escapar(o.texto || "")}</p></div>
                    <div class="modal-acoes">
                        <button type="button" class="btn" data-r="0">${escapar(o.cancelar || "Voltar")}</button>
                        <button type="button" class="btn ${o.perigo ? "btn-perigo-cheio" : "btn-primario"}" data-r="1">${escapar(o.confirmar || "Confirmar")}</button>
                    </div>
                </div>`;
            const anterior = document.activeElement;
            const terminar = valor => {
                document.removeEventListener("keydown", tecla, true);
                fundo.remove();
                if (anterior && anterior.focus) anterior.focus();
                resolver(valor);
            };
            const tecla = e => {
                if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); terminar(false); }
            };
            fundo.addEventListener("click", e => {
                if (e.target === fundo) terminar(false);
                const botao = e.target.closest("[data-r]");
                if (botao) terminar(botao.dataset.r === "1");
            });
            document.addEventListener("keydown", tecla, true);
            document.body.appendChild(fundo);
            fundo.querySelector('[data-r="1"]').focus();
        });
    }

    // Caixa com um campo de texto. Devolve o texto, ou null se voltou.
    function perguntar(opcoes) {
        const o = opcoes || {};
        return new Promise(resolver => {
            const fundo = document.createElement("div");
            fundo.className = "modal-overlay ativo";
            fundo.innerHTML = `
                <div class="modal ui-confirmar" role="dialog" aria-modal="true" aria-labelledby="uiPerguntarTitulo">
                    <div class="modal-cabecalho"><div><h2 id="uiPerguntarTitulo">${escapar(o.titulo || "Digite")}</h2></div></div>
                    <form class="modal-corpo" style="display:flex;flex-direction:column;gap:10px">
                        ${o.texto ? `<p>${escapar(o.texto)}</p>` : ""}
                        <input type="${o.tipo === "password" ? "password" : "text"}" ${o.inputmode ? `inputmode="${escapar(o.inputmode)}"` : ""} autocomplete="off" value="${escapar(o.valor || "")}" aria-labelledby="uiPerguntarTitulo">
                    </form>
                    <div class="modal-acoes">
                        <button type="button" class="btn" data-r="0">Voltar</button>
                        <button type="button" class="btn btn-primario" data-r="1">${escapar(o.confirmar || "OK")}</button>
                    </div>
                </div>`;
            const anterior = document.activeElement;
            const campo = fundo.querySelector("input");
            const terminar = valor => {
                document.removeEventListener("keydown", tecla, true);
                fundo.remove();
                if (anterior && anterior.focus) anterior.focus();
                resolver(valor);
            };
            const tecla = e => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); terminar(null); } };
            fundo.querySelector("form").addEventListener("submit", e => { e.preventDefault(); terminar(campo.value); });
            fundo.addEventListener("click", e => {
                if (e.target === fundo) terminar(null);
                const botao = e.target.closest("[data-r]");
                if (botao) terminar(botao.dataset.r === "1" ? campo.value : null);
            });
            document.addEventListener("keydown", tecla, true);
            document.body.appendChild(fundo);
            campo.focus();
        });
    }

    /* ---------------- tema ---------------- */

    function temaAtual() {
        return document.documentElement.dataset.tema === "escuro" ? "escuro" : "claro";
    }

    function aplicarTema(tema) {
        document.documentElement.dataset.tema = tema === "escuro" ? "escuro" : "claro";
        try { localStorage.setItem("temaSite", document.documentElement.dataset.tema); } catch (e) { /* sem armazenamento */ }
        document.querySelectorAll("[data-acao-tema]").forEach(botao => {
            botao.innerHTML = temaAtual() === "claro" ? `${icone("lua", "icone-p")}Tema escuro` : `${icone("sol", "icone-p")}Tema claro`;
        });
        document.dispatchEvent(new CustomEvent("temaalterado", { detail: temaAtual() }));
    }

    function alternarTema() {
        aplicarTema(temaAtual() === "claro" ? "escuro" : "claro");
    }

    // Lê o tema antes de desenhar para não piscar
    (function temaInicial() {
        let salvo = null;
        try { salvo = localStorage.getItem("temaSite"); } catch (e) { /* ignora */ }
        if (!salvo && raiz.matchMedia && raiz.matchMedia("(prefers-color-scheme: dark)").matches) salvo = "escuro";
        document.documentElement.dataset.tema = salvo === "escuro" ? "escuro" : "claro";
    })();

    // Cores atuais (variáveis CSS) para desenhos em SVG
    function cor(nome) {
        return getComputedStyle(document.documentElement).getPropertyValue(nome).trim();
    }

    /* ---------------- formatação ---------------- */

    function numero(valor, casas = 2) {
        const n = Number(valor);
        if (!Number.isFinite(n)) return "--";
        return n.toFixed(casas).replace(".", ",");
    }

    function milhar(valor) {
        const n = Number(valor);
        return Number.isFinite(n) ? n.toLocaleString("pt-BR") : "--";
    }

    function duracao(segundos) {
        const s = Math.max(0, Math.floor(Number(segundos) || 0));
        const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
        if (h > 0) return `${h} h ${String(m).padStart(2, "0")} min`;
        if (m > 0) return `${m} min ${String(r).padStart(2, "0")} s`;
        return `${r} s`;
    }

    function direcao(graus) {
        const g = ((Math.round(Number(graus) || 0) % 360) + 360) % 360;
        const nomes = ["leste", "nordeste", "norte", "noroeste", "oeste", "sudoeste", "sul", "sudeste"];
        return nomes[Math.round(g / 45) % 8];
    }

    /* ---------------- redesenho seguro ----------------
       As telas são redesenhadas a cada mensagem do AGV. Trocar o HTML de
       um bloco destrói o campo que a pessoa está usando (o menu de um
       select fecha sozinho, o texto digitado some). Esta função só troca
       quando o conteúdo mudou e nunca enquanto o foco está num campo
       dentro do bloco (a não ser com "forcar"). */
    function campoEmUso(el) {
        const ativo = document.activeElement;
        if (!ativo || ativo === document.body || !el.contains(ativo)) return false;
        if (ativo.matches("select, textarea")) return true;
        return ativo.matches("input") && !["checkbox", "radio", "button", "range"].includes(ativo.type);
    }

    function trocarHtml(el, html, forcar = false) {
        if (!el) return false;
        if (!forcar && el.__htmlAtual === html) return false;
        if (!forcar && campoEmUso(el)) return false;
        el.innerHTML = html;
        el.__htmlAtual = html;
        return true;
    }

    raiz.ui = { aviso, confirmar, perguntar, trocarHtml, campoEmUso, icone, escapar, aplicarTema, alternarTema, temaAtual, cor, numero, milhar, duracao, direcao, ICONES };
})(window);
