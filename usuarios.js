/* ============================================================
   USUÁRIOS (e EMPRESAS, para o fornecedor)
   ============================================================
   Tela "Usuários": quem acessa a empresa, convites, papéis.
   O fornecedor também vê as empresas: cria, suspende e troca.
   Tudo passa pelas funções do banco (convidar, alterar_papel...),
   que conferem a permissão de novo do lado do servidor.
*/
const Usuarios = (() => {
    "use strict";

    const esc = t => ui.escapar(String(t ?? ""));
    const PAPEIS_EMPRESA = [["admin", "Administrador"], ["operador", "Operador"], ["visualizador", "Visualizador"]];
    let carregando = false;

    function conteudo() {
        return document.getElementById("usuariosConteudo");
    }

    async function abrir() {
        const el = conteudo();
        if (!el) return;
        if (!window.Nuvem || !Nuvem.emNuvem()) {
            el.innerHTML = `<section class="card"><p class="suave">Usuários e empresas existem quando o site está ligado à nuvem (config.js). Neste modo, tudo fica só neste navegador.</p></section>`;
            return;
        }
        if (!Nuvem.pode("administrar")) {
            el.innerHTML = `<section class="card"><p class="suave">Só o administrador da empresa gerencia os usuários.</p></section>`;
            return;
        }
        if (carregando) return;
        carregando = true;
        if (!el.innerHTML.trim()) el.innerHTML = `<section class="card"><p class="suave">Carregando…</p></section>`;
        try {
            const db = Nuvem.cliente();
            const empresa = Nuvem.empresa();
            const fornecedor = Nuvem.perfil().papel === "fornecedor";
            const [perfis, convites, empresas] = await Promise.all([
                db.from("perfis").select("usuario_id, email, nome, papel, criado_em").eq("empresa_id", empresa.id).order("email"),
                db.from("convites").select("email, papel, criado_em").eq("empresa_id", empresa.id).order("email"),
                fornecedor ? db.from("empresas").select("*").order("nome") : Promise.resolve({ data: null })
            ]);
            [perfis, convites, empresas].forEach(r => { if (r.error) throw r.error; });
            el.innerHTML = html(empresa, perfis.data, convites.data, empresas.data, fornecedor);
        } catch (erro) {
            el.innerHTML = `<section class="card"><p class="entrada-erro">Não foi possível carregar: ${esc(Nuvem.traduzirErro(erro))}</p><button type="button" class="btn" data-usuarios="recarregar">Tentar de novo</button></section>`;
        } finally {
            carregando = false;
        }
    }

    function selectPapel(valor, extra = "") {
        return `<select ${extra}>${PAPEIS_EMPRESA.map(([v, r]) => `<option value="${v}" ${v === valor ? "selected" : ""}>${r}</option>`).join("")}</select>`;
    }

    function html(empresa, perfis, convites, empresas, fornecedor) {
        const eu = Nuvem.usuario().id;
        const linhas = perfis.map(u => `
            <tr>
                <td><strong>${esc(u.nome || "—")}</strong><div class="suave mono">${esc(u.email)}</div></td>
                <td>${u.usuario_id === eu
                    ? `<span class="pilula">${esc(Nuvem.nomePapel(u.papel))} · você</span>`
                    : selectPapel(u.papel, `data-papel="${esc(u.usuario_id)}" aria-label="Papel de ${esc(u.email)}"`)}</td>
                <td class="usuarios-acao">${u.usuario_id === eu ? "" : `<button type="button" class="btn btn-mini btn-perigo" data-remover="${esc(u.usuario_id)}" data-email="${esc(u.email)}">Remover</button>`}</td>
            </tr>`).join("");
        const pendentes = convites.map(c => `
            <tr class="usuarios-pendente">
                <td><span class="pilula ambar">convite pendente</span><div class="suave mono">${esc(c.email)}</div></td>
                <td>${esc(Nuvem.nomePapel(c.papel))}</td>
                <td class="usuarios-acao"><button type="button" class="btn btn-mini" data-cancelar="${esc(c.email)}">Cancelar</button></td>
            </tr>`).join("");
        const link = location.origin + location.pathname;

        return `
        <div class="usuarios-grade">
            <section class="card card-sem-padding">
                <div class="card-barra"><div><h2>Usuários · ${esc(empresa.nome)}</h2><div class="card-sub">${perfis.length} com acesso${convites.length ? ` · ${convites.length} convite(s) pendente(s)` : ""}</div></div></div>
                <div class="tabela-rolagem">
                    <table class="tabela-usuarios">
                        <thead><tr><th>Pessoa</th><th>Papel</th><th></th></tr></thead>
                        <tbody>${linhas}${pendentes}</tbody>
                    </table>
                </div>
            </section>

            <div class="usuarios-lateral">
                <section class="card">
                    <h2>Liberar acesso</h2>
                    <form class="usuarios-form" data-form-usuarios="convidar">
                        <label class="campo"><span>E-mail da pessoa</span><input name="email" type="email" required placeholder="nome@empresa.com"></label>
                        <label class="campo"><span>Papel</span>${selectPapel("operador", 'name="papel"')}</label>
                        <button type="submit" class="btn btn-primario">Liberar</button>
                    </form>
                    <p class="suave usuarios-dica">A pessoa cria a conta em <span class="mono">${esc(link)}</span> com este e-mail e já entra na ${esc(empresa.nome)}. Se ela já tiver conta, o acesso vale na hora.</p>
                </section>
                <section class="card">
                    <h2>O que cada papel faz</h2>
                    <table class="tabela-papeis">
                        <thead><tr><th></th><th>Admin.</th><th>Operador</th><th>Visual.</th></tr></thead>
                        <tbody>
                            <tr><td>Ver frota, mapa, sensores, histórico</td><td>✓</td><td>✓</td><td>✓</td></tr>
                            <tr><td>Comandar AGVs e rodar missões</td><td>✓</td><td>✓</td><td>—</td></tr>
                            <tr><td>Criar e editar missões</td><td>✓</td><td>✓</td><td>—</td></tr>
                            <tr><td>Planta, cadastro de AGVs, configurações, firmware</td><td>✓</td><td>—</td><td>—</td></tr>
                            <tr><td>Usuários</td><td>✓</td><td>—</td><td>—</td></tr>
                        </tbody>
                    </table>
                    <p class="suave usuarios-dica">Parar o AGV (STOP) é permitido para todos.</p>
                </section>
            </div>

            ${fornecedor ? htmlEmpresas(empresas, empresa) : ""}
        </div>`;
    }

    function htmlEmpresas(empresas, atual) {
        return `
            <section class="card card-sem-padding usuarios-empresas">
                <div class="card-barra"><div><h2>Empresas</h2><div class="card-sub">Só você (fornecedor) vê esta parte</div></div></div>
                <div class="tabela-rolagem">
                    <table class="tabela-usuarios">
                        <thead><tr><th>Empresa</th><th>Código</th><th>Situação</th><th></th></tr></thead>
                        <tbody>${empresas.map(e => `
                            <tr>
                                <td><strong>${esc(e.nome)}</strong>${e.id === atual.id ? ` <span class="pilula verde">aberta</span>` : ""}</td>
                                <td class="mono">${esc(e.codigo)}</td>
                                <td>${e.ativa ? `<span class="pilula verde">ativa</span>` : `<span class="pilula vermelho">suspensa</span>`}</td>
                                <td class="usuarios-acao">
                                    ${e.id === atual.id ? "" : `<button type="button" class="btn btn-mini" data-abrir-empresa="${esc(e.id)}">Abrir</button>`}
                                    <button type="button" class="btn btn-mini ${e.ativa ? "btn-perigo" : ""}" data-ativa="${esc(e.id)}" data-valor="${e.ativa ? "0" : "1"}" data-nome="${esc(e.nome)}">${e.ativa ? "Suspender" : "Reativar"}</button>
                                </td>
                            </tr>`).join("")}</tbody>
                    </table>
                </div>
                <form class="usuarios-form usuarios-form-linha" data-form-usuarios="empresa">
                    <label class="campo"><span>Nova empresa</span><input name="nome" required maxlength="80" placeholder="Metalúrgica Alfa"></label>
                    <label class="campo"><span>Código (tópicos MQTT)</span><input name="codigo" required maxlength="24" pattern="[a-z0-9][a-z0-9\\-]{1,23}" placeholder="alfa"></label>
                    <label class="campo"><span>E-mail do administrador</span><input name="email" type="email" placeholder="ti@cliente.com"></label>
                    <button type="submit" class="btn btn-primario">Criar</button>
                </form>
            </section>`;
    }

    async function executar(promessa, sucesso) {
        try {
            const { data, error } = await promessa;
            if (error) throw error;
            if (sucesso) ui.aviso(typeof sucesso === "function" ? sucesso(data) : sucesso, "sucesso");
            return true;
        } catch (erro) {
            ui.aviso(Nuvem.traduzirErro(erro), "erro");
            return false;
        } finally {
            abrir();
        }
    }

    document.addEventListener("submit", async evento => {
        const form = evento.target.closest("[data-form-usuarios]");
        if (!form) return;
        evento.preventDefault();
        const v = Object.fromEntries(new FormData(form));
        const db = Nuvem.cliente();
        form.querySelectorAll("button, input, select").forEach(c => { c.disabled = true; });
        if (form.dataset.formUsuarios === "convidar") {
            await executar(db.rpc("convidar", { p_email: v.email, p_papel: v.papel, p_empresa: Nuvem.empresa().id }),
                r => r === "convidado" ? `Acesso liberado para ${v.email}. Ela entra ao criar a conta.` : `${v.email} já tinha conta: acesso liberado agora.`);
        } else if (form.dataset.formUsuarios === "empresa") {
            await executar(db.rpc("criar_empresa", { p_nome: v.nome, p_codigo: v.codigo, p_email_admin: v.email || "" }),
                `Empresa ${v.nome} criada.${v.email ? ` ${v.email} entra como administrador.` : ""}`);
        }
    });

    document.addEventListener("change", evento => {
        const select = evento.target.closest("[data-papel]");
        if (!select || !conteudo()?.contains(select)) return;
        executar(Nuvem.cliente().rpc("alterar_papel", { p_usuario: select.dataset.papel, p_papel: select.value }), "Papel alterado.");
    });

    document.addEventListener("click", async evento => {
        const el = conteudo();
        const alvo = evento.target.closest("button");
        if (!alvo || !el || !el.contains(alvo)) return;
        const db = Nuvem.cliente();
        if (alvo.dataset.usuarios === "recarregar") abrir();
        else if (alvo.dataset.remover) {
            if (!(await ui.confirmar({ titulo: "Remover o acesso?", texto: `${alvo.dataset.email} deixa de acessar a ${Nuvem.empresa().nome}. A conta continua existindo e pode ser liberada de novo.`, confirmar: "Remover", perigo: true }))) return;
            executar(db.rpc("remover_da_empresa", { p_usuario: alvo.dataset.remover }), "Acesso removido.");
        } else if (alvo.dataset.cancelar) {
            executar(db.rpc("cancelar_convite", { p_email: alvo.dataset.cancelar }), "Convite cancelado.");
        } else if (alvo.dataset.abrirEmpresa) {
            Nuvem.trocarEmpresa(alvo.dataset.abrirEmpresa);
        } else if (alvo.dataset.ativa) {
            const ativar = alvo.dataset.valor === "1";
            if (!ativar && !(await ui.confirmar({ titulo: `Suspender ${alvo.dataset.nome}?`, texto: "Os usuários dessa empresa perdem o acesso até você reativar. Nada é apagado.", confirmar: "Suspender", perigo: true }))) return;
            executar(db.from("empresas").update({ ativa: ativar }).eq("id", alvo.dataset.ativa), ativar ? "Empresa reativada." : "Empresa suspensa.");
        }
    });

    return { abrir };
})();
