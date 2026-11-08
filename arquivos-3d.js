/* ============================================================
   ARQUIVOS 3D (0.17) — os GLB importados (máquinas e o galpão)
   ============================================================
   Um GLB pode ter vários MB: não vai dentro da planta. A planta
   guarda só a referência ({ id, nome, tamanho }) e o arquivo fica:
     - na nuvem: Supabase Storage, bucket "modelos3d", pasta da empresa
       (quem vê a empresa baixa; só o administrador envia e apaga);
     - sem nuvem: no próprio navegador (IndexedDB).
   O id é o começo do SHA-256 do arquivo: o mesmo arquivo enviado
   duas vezes é um só.
*/
const Arquivos3D = (function () {
    "use strict";

    const LIMITE = 15 * 1024 * 1024;     // por arquivo (o bucket também confere)
    const BUCKET = "modelos3d";
    const cache = new Map();             // id -> ArrayBuffer
    const pendentes = new Map();         // id -> Promise

    const emNuvem = () => typeof Nuvem !== "undefined" && Nuvem.emNuvem && Nuvem.emNuvem() && Nuvem.cliente && Nuvem.cliente();
    const caminho = id => `${Nuvem.empresa().id}/${id}.glb`;

    async function idDe(buffer) {
        const h = await crypto.subtle.digest("SHA-256", buffer);
        return [...new Uint8Array(h)].slice(0, 10).map(b => b.toString(16).padStart(2, "0")).join("");
    }

    // GLB: "glTF" + versão 2 + tamanho certo
    function conferir(buffer, nome = "") {
        if (/\.gltf$/i.test(nome)) throw new Error("Este é um .gltf (texto, com arquivos à parte). Exporte como .glb (um arquivo só): no Blender, Exportar › glTF 2.0 › Formato: glTF Binário.");
        if (buffer.byteLength > LIMITE) throw new Error(`O arquivo tem ${(buffer.byteLength / 1048576).toFixed(1)} MB; o máximo é ${LIMITE / 1048576} MB. Reduza os polígonos ou as texturas (no Blender: Decimate e texturas de até 1024 px).`);
        const v = new DataView(buffer);
        if (buffer.byteLength < 20 || v.getUint32(0, true) !== 0x46546C67) throw new Error("Não é um arquivo GLB (glTF binário).");
        if (v.getUint32(4, true) !== 2) throw new Error("GLB de versão antiga: exporte em glTF 2.0.");
        if (v.getUint32(8, true) > buffer.byteLength) throw new Error("O arquivo GLB está incompleto.");
        return true;
    }

    /* ---------- no navegador (sem nuvem) ---------- */
    let dbPromessa = null;
    function db() {
        if (!dbPromessa) dbPromessa = new Promise((ok, erro) => {
            const r = indexedDB.open("eciton-arquivos-3d", 1);
            r.onupgradeneeded = () => r.result.createObjectStore("arquivos");
            r.onsuccess = () => ok(r.result);
            r.onerror = () => erro(r.error || new Error("O navegador não deixou guardar arquivos (modo anônimo?)."));
        });
        return dbPromessa;
    }
    async function local(modo, id, valor) {
        const banco = await db();
        return new Promise((ok, erro) => {
            const t = banco.transaction("arquivos", modo === "ler" ? "readonly" : "readwrite").objectStore("arquivos");
            const r = modo === "ler" ? t.get(id) : modo === "apagar" ? t.delete(id) : t.put(valor, id);
            r.onsuccess = () => ok(r.result);
            r.onerror = () => erro(r.error);
        });
    }

    /* ---------- API ---------- */
    // arquivo: File (do input). Devolve { id, nome, tamanho }
    async function salvar(arquivo) {
        const buffer = await arquivo.arrayBuffer();
        conferir(buffer, arquivo.name);
        const id = await idDe(buffer);
        const ref = { id, nome: String(arquivo.name || "modelo.glb").slice(0, 80), tamanho: buffer.byteLength };
        if (emNuvem()) {
            const { error } = await Nuvem.cliente().storage.from(BUCKET).upload(caminho(id), buffer.slice(0), { contentType: "model/gltf-binary", upsert: true });
            if (error) throw new Error(/row-level|403|Unauthorized|policy/i.test(error.message || "") ? "Só o administrador da empresa envia modelos 3D." : "Não foi possível enviar o arquivo: " + error.message);
        } else {
            await local("gravar", id, buffer);
        }
        cache.set(id, buffer);
        return ref;
    }

    async function obter(id) {
        if (cache.has(id)) return cache.get(id);
        if (pendentes.has(id)) return pendentes.get(id);
        const p = (async () => {
            let buffer = null;
            if (emNuvem()) {
                const { data, error } = await Nuvem.cliente().storage.from(BUCKET).download(caminho(id));
                if (error) throw new Error("Não foi possível baixar o modelo 3D: " + (error.message || error));
                buffer = await data.arrayBuffer();
            } else {
                buffer = await local("ler", id);
                if (!buffer) throw new Error("Este modelo 3D não está neste navegador (foi importado em outro computador). Importe o GLB de novo.");
            }
            cache.set(id, buffer);
            return buffer;
        })();
        pendentes.set(id, p);
        try { return await p; } finally { pendentes.delete(id); }
    }

    async function remover(id) {
        cache.delete(id);
        if (emNuvem()) await Nuvem.cliente().storage.from(BUCKET).remove([caminho(id)]);
        else await local("apagar", id).catch(() => {});
    }

    return { salvar, obter, remover, conferir, idDe, LIMITE, BUCKET };
})();
