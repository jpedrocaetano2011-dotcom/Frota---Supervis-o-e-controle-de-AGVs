/* ============================================================
   PLANTA 3D (0.16) — o gêmeo digital da frota
   ============================================================
   A mesma planta do 2D, em perspectiva: piso, fitas, objetos da
   biblioteca (cada tipo com o seu modelo 3D feito aqui, sem arquivo)
   e os Atta andando, cada módulo com a sua forma (E levanta o
   carrinho, G com a garra, R com os rolos, T puxando o comboio; -L
   com o sensor girando) e o LED na cor do estado.

   A biblioteca Three.js (MIT) só é baixada quando alguém abre o 3D
   (import map "three" no index.html). O 2D continua sendo o editor.

   Uso (pelo MapaSVG): const v = await Planta3D.criar(container, opcoes)
     v.atualizar(mapa)  planta, agvs (x, y, orientacao, estado, led...)
     v.vista("iso" | "cima" | "livre"), v.seguir(id | null), v.girar(bool)
     v.destruir()
*/
const Planta3D = (function () {
    "use strict";

    let THREE = null;
    let carregando = null;

    function suportado() {
        try {
            const c = document.createElement("canvas");
            return Boolean(window.WebGLRenderingContext && (c.getContext("webgl2") || c.getContext("webgl")));
        } catch (e) { return false; }
    }

    function carregar() {
        if (THREE) return Promise.resolve(THREE);
        if (!carregando) {
            const url = window.ECITON_THREE_URL || "three";
            carregando = import(url).then(m => { THREE = m; return m; }).catch(erro => { carregando = null; throw erro; });
        }
        return carregando;
    }

    // GLB (0.17): o leitor do Three.js vem só quando a planta tem um modelo importado
    let leitorGlb = null;
    function carregarLeitorGlb() {
        if (!leitorGlb) {
            const base = window.ECITON_THREE_ADDONS || "three/addons/";
            leitorGlb = Promise.all([import(base + "loaders/GLTFLoader.js"), import(base + "loaders/DRACOLoader.js")]).then(([g, d]) => {
                const leitor = new g.GLTFLoader();
                const draco = new d.DRACOLoader();
                draco.setDecoderPath(window.ECITON_DRACO_URL || "https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/libs/draco/gltf/");
                leitor.setDRACOLoader(draco);
                return leitor;
            }).catch(erro => { leitorGlb = null; throw erro; });
        }
        return leitorGlb;
    }
    // Um GLB é lido uma vez; cada uso é uma cópia que compartilha a geometria
    const modelosLidos = new Map();      // id -> Promise<Object3D>
    function modeloGlb(id) {
        if (!modelosLidos.has(id)) {
            const p = (async () => {
                if (typeof Arquivos3D === "undefined") throw new Error("sem Arquivos3D");
                const [leitor, buffer] = await Promise.all([carregarLeitorGlb(), Arquivos3D.obter(id)]);
                const gltf = await new Promise((ok, erro) => leitor.parse(buffer.slice(0), "", ok, erro));
                const cena = gltf.scene || gltf.scenes[0];
                cena.traverse(o => { if (o.isMesh) { o.userData.glb = true; o.castShadow = true; o.receiveShadow = true; } });
                cena.updateMatrixWorld(true);
                return cena;
            })();
            p.catch(() => modelosLidos.delete(id));
            modelosLidos.set(id, p);
        }
        return modelosLidos.get(id);
    }

    /* ---------------- cores ---------------- */

    function css(nome, padrao) {
        const v = getComputedStyle(document.documentElement).getPropertyValue(nome).trim();
        return v || padrao;
    }
    const escuro = () => {
        const fundo = css("--mapa-papel", "#ffffff");
        const m = /^#?([0-9a-f]{6})$/i.exec(fundo.replace("#", "#"));
        if (!m) return false;
        const n = parseInt(m[1], 16);
        return ((n >> 16) * 0.299 + ((n >> 8) & 255) * 0.587 + (n & 255) * 0.114) < 110;
    };

    const COR = {
        piso: 0xC9CDD1, pisoEscuro: 0x2A3138, corredor: 0xE2E5E8, corredorEscuro: 0x353D46,
        parede: 0xB8BEC6, pilar: 0x8C949D, amarelo: 0xF2B705, preto: 0x23272B, azulRack: 0x2F5DA8, laranja: 0xE26A1B,
        maquina: 0xDCE1E6, maquinaEscura: 0x5D6873, vidro: 0x1F2A33, verde: 0x2EAF5B, vermelho: 0xD8343B,
        madeira: 0xB98A55, caixa: 0xC9A06B, klt: 0x2F6BFF, atta: 0x2B3440, attaTopo: 0x3A4552, roda: 0x15191D,
        fitaOptica: 0x1C2024, fitaMagnetica: 0x4A5F86, virtual: 0x9B5CFF, tag: 0xF2B705
    };
    const CORES_ESTADO = { missao: "#22D35B", pronto: "#22D35B", atencao: "#FFB000", falha: "#FF2FB9", emergencia: "#FF3B3B",
        offline: "#59616B", manual: "#2F6BFF", virtual: "#9B5CFF", manutencao: "#F2F4F7" };

    /* ---------------- geometria básica ---------------- */

    function materiais() {
        const cache = new Map();
        return (cor, extra = {}) => {
            const chave = cor + JSON.stringify(extra);
            if (!cache.has(chave)) cache.set(chave, new THREE.MeshStandardMaterial(Object.assign({ color: cor, roughness: 0.72, metalness: 0.08 }, extra)));
            return cache.get(chave);
        };
    }

    // caixa com a base no chão local (y = 0) e centro em (x, z)
    function caixa(mat, grupo, w, h, d, x = 0, y = 0, z = 0, cor = COR.maquina, extra) {
        const m = new THREE.Mesh(new THREE.BoxGeometry(Math.max(0.005, w), Math.max(0.005, h), Math.max(0.005, d)), mat(cor, extra));
        m.position.set(x, y + h / 2, z);
        m.castShadow = h > 0.05;
        m.receiveShadow = true;
        grupo.add(m);
        return m;
    }
    function cilindro(mat, grupo, r, h, x = 0, y = 0, z = 0, cor = COR.maquina, horizontal = false, eixoX = true) {
        const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 18), mat(cor));
        if (horizontal) { if (eixoX) m.rotation.z = Math.PI / 2; else m.rotation.x = Math.PI / 2; m.position.set(x, y, z); }
        else m.position.set(x, y + h / 2, z);
        m.castShadow = true;
        grupo.add(m);
        return m;
    }

    /* ---------------- biblioteca 3D ---------------- */
    // Cada objeto: grupo com a origem no centro do retângulo, eixo x = largura,
    // eixo z = profundidade (no mapa, y), altura em y.

    function torreSinal(mat, g, x, y, z) {
        cilindro(mat, g, 0.03, 0.35, x, y, z, COR.maquinaEscura);
        [COR.vermelho, COR.amarelo, COR.verde].forEach((c, i) => {
            const m = cilindro(mat, g, 0.045, 0.07, x, y + 0.35 + i * 0.075, z, c);
            m.material = mat(c, { emissive: c, emissiveIntensity: i === 2 ? 0.9 : 0.15 });
        });
    }

    function grade(mat, g, w, h, d, cor = COR.amarelo) {
        const comprimento = Math.max(w, d), aoLongoX = w >= d;
        const postes = Math.max(2, Math.ceil(comprimento / 1.2) + 1);
        for (let i = 0; i < postes; i++) {
            const f = -comprimento / 2 + comprimento * i / (postes - 1);
            caixa(mat, g, 0.05, h, 0.05, aoLongoX ? f : 0, 0, aoLongoX ? 0 : f, cor);
        }
        const painel = caixa(mat, g, aoLongoX ? comprimento : 0.02, h * 0.85, aoLongoX ? 0.02 : comprimento, 0, h * 0.08, 0, 0x3B4148, { transparent: true, opacity: 0.35, wireframe: false });
        painel.castShadow = false;
        caixa(mat, g, aoLongoX ? comprimento : 0.04, 0.04, aoLongoX ? 0.04 : comprimento, 0, h - 0.04, 0, cor);
    }

    function prateleira(mat, g, w, h, d, niveis, corMontante, corViga, carga) {
        [[-w / 2, -d / 2], [w / 2, -d / 2], [-w / 2, d / 2], [w / 2, d / 2]].forEach(([x, z]) => caixa(mat, g, 0.07, h, 0.07, x, 0, z, corMontante));
        const vaos = Math.max(1, Math.round(w / 1.35));
        for (let k = 1; k < vaos; k++) [-d / 2, d / 2].forEach(z => caixa(mat, g, 0.07, h, 0.07, -w / 2 + w * k / vaos, 0, z, corMontante));
        for (let n = 0; n < niveis; n++) {
            const y = 0.12 + (h - 0.2) * n / niveis;
            [-d / 2, d / 2].forEach(z => caixa(mat, g, w, 0.08, 0.06, 0, y, z, corViga));
            if (carga) for (let k = 0; k < vaos; k++) {
                if ((n + k) % 3 === 2) continue;
                const cx = -w / 2 + w * (k + 0.5) / vaos;
                carga(cx, y + 0.08, w / vaos, d, (h - 0.2) / niveis);
            }
        }
    }

    const FABRICA = {
        PAREDE(mat, g, o, h) { caixa(mat, g, o.largura, h, o.profundidade, 0, 0, 0, COR.parede); },
        PILAR(mat, g, o, h) {
            caixa(mat, g, o.largura, h, o.profundidade, 0, 0, 0, COR.pilar);
            for (let i = 0; i < 4; i++) caixa(mat, g, o.largura + 0.02, 0.15, o.profundidade + 0.02, 0, 0.15 + i * 0.3, 0, i % 2 ? COR.preto : COR.amarelo);
        },
        GRADE(mat, g, o, h) { grade(mat, g, o.largura, h, o.profundidade); },
        PORTA(mat, g, o, h) {
            const w = o.largura;
            [-w / 2, w / 2].forEach(x => caixa(mat, g, 0.08, h, o.profundidade, x, 0, 0, COR.maquinaEscura));
            caixa(mat, g, w + 0.08, 0.1, o.profundidade, 0, h, 0, COR.maquinaEscura);
        },
        PORTAO(mat, g, o, h) {
            const w = o.largura;
            [-w / 2, w / 2].forEach(x => caixa(mat, g, 0.15, h, o.profundidade, x, 0, 0, COR.amarelo));
            caixa(mat, g, w, 0.5, o.profundidade * 1.4, 0, h - 0.5, 0, COR.maquinaEscura);
        },
        PRATELEIRA(mat, g, o, h) {
            prateleira(mat, g, o.largura, h, o.profundidade, 4, COR.azulRack, COR.laranja,
                (x, y, w, d, hh) => caixa(mat, g, w * 0.8, Math.min(0.3, hh * 0.6), d * 0.8, x, y, 0, COR.caixa));
        },
        PORTA_PALETE(mat, g, o, h) {
            prateleira(mat, g, o.largura, h, o.profundidade, 3, COR.azulRack, COR.laranja, (x, y, w, d, hh) => {
                caixa(mat, g, Math.min(1.2, w * 0.85), 0.12, d * 0.9, x, y, 0, COR.madeira);
                caixa(mat, g, Math.min(1.1, w * 0.8), Math.min(1.0, hh * 0.7), d * 0.85, x, y + 0.12, 0, COR.caixa);
            });
        },
        FLOW_RACK(mat, g, o, h) {
            const w = o.largura, d = o.profundidade;
            [[-w / 2, -d / 2], [w / 2, -d / 2], [-w / 2, d / 2], [w / 2, d / 2]].forEach(([x, z]) => caixa(mat, g, 0.05, h, 0.05, x, 0, z, COR.maquinaEscura));
            for (let n = 0; n < 4; n++) {
                const y = 0.3 + n * (h - 0.4) / 4;
                const prat = caixa(mat, g, w, 0.04, d, 0, y, 0, COR.maquina);
                prat.rotation.x = 0.12;
                for (let k = 0; k < Math.max(2, Math.round(w / 0.45)); k++) {
                    const b = caixa(mat, g, 0.36, 0.2, 0.5, -w / 2 + 0.25 + k * 0.45, y + 0.05, 0, n % 2 ? COR.klt : 0xE24A3B);
                    b.rotation.x = 0.12;
                }
            }
        },
        PALETE(mat, g, o, h) {
            caixa(mat, g, o.largura, 0.14, o.profundidade, 0, 0, 0, COR.madeira);
            caixa(mat, g, o.largura * 0.95, h - 0.14, o.profundidade * 0.95, 0, 0.14, 0, COR.caixa);
            caixa(mat, g, o.largura * 0.96, 0.04, o.profundidade * 0.96, 0, h * 0.55, 0, 0xE9E3D6, { transparent: true, opacity: 0.6 });
        },
        CAIXAS(mat, g, o, h) {
            const camadas = Math.max(1, Math.round(h / 0.33));
            for (let i = 0; i < camadas; i++) caixa(mat, g, o.largura * (1 - i * 0.03), h / camadas - 0.01, o.profundidade * (1 - i * 0.03), 0, i * h / camadas, 0, i % 2 ? COR.caixa : 0xBF935F);
        },
        MAQUINA(mat, g, o, h) {
            caixa(mat, g, o.largura, h * 0.85, o.profundidade, 0, 0, 0, COR.maquina);
            caixa(mat, g, o.largura * 0.5, h * 0.3, 0.04, 0, h * 0.35, o.profundidade / 2, COR.vidro);
            torreSinal(mat, g, o.largura / 2 - 0.12, h * 0.85, -o.profundidade / 2 + 0.12);
        },
        CNC(mat, g, o, h) {
            const w = o.largura, d = o.profundidade;
            caixa(mat, g, w, 0.25, d, 0, 0, 0, COR.maquinaEscura);
            caixa(mat, g, w, h - 0.45, d, 0, 0.25, 0, COR.maquina);
            caixa(mat, g, w * 0.55, (h - 0.45) * 0.55, 0.03, -w * 0.1, 0.25 + (h - 0.45) * 0.25, d / 2 + 0.01, COR.vidro, { metalness: 0.4, roughness: 0.2 });
            caixa(mat, g, w * 0.5, 0.06, 0.04, -w * 0.1, 0.25 + (h - 0.45) * 0.82, d / 2 + 0.02, COR.azulRack);
            caixa(mat, g, 0.35, 0.5, 0.12, w / 2 - 0.25, 0.9, d / 2 + 0.08, COR.maquinaEscura);
            caixa(mat, g, 0.28, 0.2, 0.02, w / 2 - 0.25, 1.15, d / 2 + 0.15, 0x0F6FD8, { emissive: 0x0F6FD8, emissiveIntensity: 0.5 });
            torreSinal(mat, g, w / 2 - 0.15, h - 0.2, -d / 2 + 0.15);
        },
        TORNO(mat, g, o, h) {
            const w = o.largura, d = o.profundidade;
            caixa(mat, g, w, h * 0.45, d * 0.7, 0, 0, 0, COR.maquinaEscura);
            caixa(mat, g, w * 0.95, 0.12, d * 0.45, 0, h * 0.45, 0, COR.maquina);
            caixa(mat, g, w * 0.28, h * 0.5, d * 0.75, -w * 0.33, h * 0.45, 0, COR.maquina);
            cilindro(mat, g, d * 0.18, 0.18, -w * 0.17, h * 0.78, 0, 0x9AA3AC, true);
            caixa(mat, g, w * 0.14, h * 0.25, d * 0.4, w * 0.3, h * 0.57, 0, COR.maquina);
            caixa(mat, g, w * 0.6, h * 0.35, 0.02, 0.05 * w, h * 0.6, d * 0.36, COR.vidro, { transparent: true, opacity: 0.4 });
            torreSinal(mat, g, -w / 2 + 0.12, h * 0.95, -d / 2 + 0.12);
        },
        PRENSA(mat, g, o, h) {
            const w = o.largura, d = o.profundidade;
            caixa(mat, g, w, 0.7, d, 0, 0, 0, COR.azulRack);
            [-w / 2 + 0.25, w / 2 - 0.25].forEach(x => caixa(mat, g, 0.4, h - 1.3, d * 0.8, x, 0.7, 0, COR.azulRack));
            caixa(mat, g, w, 0.6, d, 0, h - 0.6, 0, COR.azulRack);
            caixa(mat, g, w * 0.6, 0.35, d * 0.6, 0, h - 1.4, 0, COR.maquina);
            cilindro(mat, g, 0.12, 0.5, 0, h - 1.05, 0, 0x9AA3AC);
            caixa(mat, g, w * 0.7, 0.12, d * 0.75, 0, 0.7, 0, 0x9AA3AC);
            grade(mat, g, w * 0.9, 1.6, 0.03);
            g.children[g.children.length - 1].position.z += d / 2 + 0.25;
            torreSinal(mat, g, w / 2 - 0.15, h, d / 2 - 0.15);
        },
        INJETORA(mat, g, o, h) {
            const w = o.largura, d = o.profundidade;
            caixa(mat, g, w, h * 0.42, d * 0.75, 0, 0, 0, COR.maquina);
            caixa(mat, g, w * 0.42, h * 0.48, d * 0.85, -w * 0.25, h * 0.42, 0, COR.maquina);
            caixa(mat, g, w * 0.3, h * 0.36, 0.02, -w * 0.25, h * 0.48, d * 0.43, COR.vidro, { transparent: true, opacity: 0.5 });
            cilindro(mat, g, 0.13, w * 0.42, w * 0.18, h * 0.6, 0, 0x9AA3AC, true);
            const funil = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.5, 16), mat(COR.maquinaEscura));
            funil.rotation.x = Math.PI; funil.position.set(w * 0.3, h * 0.92, 0); funil.castShadow = true;
            g.add(funil);
            torreSinal(mat, g, -w / 2 + 0.15, h * 0.9, -d / 2 + 0.15);
        },
        CELULA_ROBO(mat, g, o, h) {
            const w = o.largura, d = o.profundidade;
            [[0, -d / 2, w, 0.04], [0, d / 2, w, 0.04], [-w / 2, 0, 0.04, d], [w / 2, 0, 0.04, d]].forEach(([x, z, ww, dd], i) => {
                const sub = new THREE.Group(); sub.position.set(x, 0, z); g.add(sub);
                grade(mat, sub, ww, h, dd);
                if (i === 1) sub.scale.x = 0.7;
            });
            cilindro(mat, g, 0.28, 0.5, 0, 0, 0, COR.laranja);
            const ombro = cilindro(mat, g, 0.16, 0.3, 0, 0.5, 0, COR.laranja);
            const braco = caixa(mat, g, 0.16, 1.0, 0.16, 0.25, 0.75, 0, COR.laranja);
            braco.rotation.z = -0.6;
            const ante = caixa(mat, g, 0.12, 0.8, 0.12, 0.75, 1.2, 0, COR.laranja);
            ante.rotation.z = 1.1;
            caixa(mat, g, w * 0.3, 0.9, d * 0.25, -w * 0.25, 0, -d * 0.25, COR.maquina);
            void ombro;
        },
        SOLDA(mat, g, o, h) {
            const w = o.largura, d = o.profundidade;
            [[-w / 2, -d / 2], [w / 2, -d / 2], [-w / 2, d / 2], [w / 2, d / 2]].forEach(([x, z]) => caixa(mat, g, 0.06, h, 0.06, x, 0, z, COR.maquinaEscura));
            caixa(mat, g, w, 0.06, d, 0, h - 0.06, 0, COR.maquinaEscura);
            [[0, -d / 2, w, 0.02], [-w / 2, 0, 0.02, d], [w / 2, 0, 0.02, d]].forEach(([x, z, ww, dd]) => {
                const c = caixa(mat, g, ww, h * 0.85, dd, x, 0.1, z, 0xB3262E, { transparent: true, opacity: 0.55 });
                c.castShadow = false;
            });
            caixa(mat, g, w * 0.5, 0.9, d * 0.4, 0, 0, 0, COR.maquina);
            caixa(mat, g, 0.4, 0.9, 0.4, w * 0.3, 0, -d * 0.3, 0xF2B705);
        },
        ESTEIRA(mat, g, o, h) {
            const w = o.largura, d = o.profundidade;
            const pernas = Math.max(2, Math.ceil(w / 1.5) + 1);
            for (let i = 0; i < pernas; i++) [-d / 2 + 0.05, d / 2 - 0.05].forEach(z => caixa(mat, g, 0.06, h - 0.1, 0.06, -w / 2 + 0.05 + (w - 0.1) * i / (pernas - 1), 0, z, COR.maquinaEscura));
            [-d / 2, d / 2].forEach(z => caixa(mat, g, w, 0.12, 0.05, 0, h - 0.12, z, 0x9AA3AC));
            const rolos = Math.max(4, Math.round(w / 0.12));
            for (let i = 0; i < rolos; i++) cilindro(mat, g, 0.035, d - 0.1, -w / 2 + (i + 0.5) * w / rolos, h - 0.05, 0, 0xB8C0C8, true, false);
            caixa(mat, g, 0.5, 0.3, d * 0.7, -w * 0.25, h, 0, COR.caixa);
        },
        BANCADA(mat, g, o, h) {
            const w = o.largura, d = o.profundidade;
            caixa(mat, g, w, 0.05, d, 0, h - 0.05, 0, 0xC8B79A);
            [[-w / 2 + 0.05, -d / 2 + 0.05], [w / 2 - 0.05, -d / 2 + 0.05], [-w / 2 + 0.05, d / 2 - 0.05], [w / 2 - 0.05, d / 2 - 0.05]].forEach(([x, z]) => caixa(mat, g, 0.05, h - 0.05, 0.05, x, 0, z, COR.maquinaEscura));
            caixa(mat, g, w * 0.9, 0.6, 0.03, 0, h, -d / 2 + 0.03, COR.maquinaEscura);
        },
        INSPECAO(mat, g, o, h) {
            FABRICA.BANCADA(mat, g, o, 0.9);
            caixa(mat, g, 0.05, h - 0.9, 0.05, -o.largura / 2 + 0.2, 0.9, -o.profundidade / 2 + 0.15, COR.maquinaEscura);
            caixa(mat, g, 0.6, 0.05, 0.12, -o.largura / 2 + 0.45, h - 0.05, -o.profundidade / 2 + 0.15, 0xF2F4F7, { emissive: 0xF2F4F7, emissiveIntensity: 0.4 });
            caixa(mat, g, 0.4, 0.3, 0.25, 0.2, 0.9, 0, 0x9AA3AC);
        },
        POSTO(mat, g, o, h) {
            const w = o.largura, d = o.profundidade;
            caixa(mat, g, w, 0.05, d, 0, h - 0.05, 0, 0xDDE3E8);
            caixa(mat, g, 0.08, h - 0.05, 0.08, 0, 0, 0, COR.maquinaEscura);
            const tela = caixa(mat, g, 0.3, 0.22, 0.02, 0, h, -d * 0.2, 0x0F6FD8, { emissive: 0x0F6FD8, emissiveIntensity: 0.55 });
            tela.rotation.x = -0.4;
            caixa(mat, g, w * 0.5, 0.25, d * 0.5, w * 0.15, h, d * 0.1, COR.klt);
        },
        CARREGADOR(mat, g, o, h) {
            caixa(mat, g, o.largura, h, o.profundidade, 0, 0, 0, 0x3A4552);
            caixa(mat, g, o.largura * 0.6, 0.08, 0.02, 0, h * 0.7, o.profundidade / 2 + 0.01, COR.verde, { emissive: COR.verde, emissiveIntensity: 0.9 });
        },
        DOCA(mat, g, o, h) {
            const w = o.largura;
            [-w / 2, w / 2].forEach(x => caixa(mat, g, 0.2, h, 0.25, x, 0, 0, COR.amarelo));
            caixa(mat, g, w + 0.2, 0.3, 0.25, 0, h - 0.3, 0, COR.maquinaEscura);
            caixa(mat, g, w * 0.9, 0.08, 1.2, 0, 0, 0.6, 0x7D858E);
        },
        ESCRITORIO(mat, g, o, h) {
            const w = o.largura, d = o.profundidade;
            caixa(mat, g, w, h, d, 0, 0, 0, 0xE9EDF1);
            for (let i = 0; i < Math.max(1, Math.floor(w / 1.6)); i++) caixa(mat, g, 0.9, 0.8, 0.03, -w / 2 + 0.8 + i * 1.6, 1.1, d / 2 + 0.01, COR.vidro, { metalness: 0.4, roughness: 0.2 });
            caixa(mat, g, 0.9, 2.0, 0.03, w / 2 - 0.7, 0, d / 2 + 0.015, 0x8C949D);
        },
        PESSOA(mat, g, o, h) {
            cilindro(mat, g, 0.09, h * 0.47, -0.08, 0, 0, 0x2B3440);
            cilindro(mat, g, 0.09, h * 0.47, 0.08, 0, 0, 0x2B3440);
            caixa(mat, g, 0.42, h * 0.33, 0.22, 0, h * 0.47, 0, 0xF2B705);
            const cabeca = new THREE.Mesh(new THREE.SphereGeometry(0.11, 16, 12), mat(0xD9A47E));
            cabeca.position.set(0, h - 0.11, 0); cabeca.castShadow = true; g.add(cabeca);
            const capacete = new THREE.Mesh(new THREE.SphereGeometry(0.125, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat(0xF2F4F7));
            capacete.position.set(0, h - 0.1, 0); g.add(capacete);
        },
        EMPILHADEIRA(mat, g, o, h) {
            const w = o.largura, d = o.profundidade;
            caixa(mat, g, w * 0.6, 0.9, d, -w * 0.15, 0.15, 0, COR.amarelo);
            caixa(mat, g, w * 0.35, 1.0, d * 0.9, -w * 0.25, 1.05, 0, COR.preto, { transparent: true, opacity: 0.35 });
            [-d / 2 + 0.05, d / 2 - 0.05].forEach(z => cilindro(mat, g, 0.2, 0.18, -w * 0.32, 0.2, z, COR.roda, true, false));
            [-d / 2 + 0.05, d / 2 - 0.05].forEach(z => cilindro(mat, g, 0.2, 0.18, w * 0.05, 0.2, z, COR.roda, true, false));
            [-d * 0.3, d * 0.3].forEach(z => caixa(mat, g, 0.08, h, 0.08, w * 0.2, 0, z, COR.preto));
            [-d * 0.25, d * 0.25].forEach(z => caixa(mat, g, w * 0.4, 0.05, 0.1, w * 0.42, 0.05, z, COR.preto));
        }
    };
    // Pisos (altura 0): pintura no chão
    const PISO = { CORREDOR: 1, ZONA_LENTA: 1, ZONA_PROIBIDA: 1, AREA_LIVRE: 1, FAIXA_PEDESTRE: 1, CRUZAMENTO_EMPILHADEIRA: 1 };

    function texturaListras(cor1, cor2, n = 8, diagonal = true) {
        const c = document.createElement("canvas");
        c.width = c.height = 128;
        const x = c.getContext("2d");
        x.fillStyle = cor2; x.fillRect(0, 0, 128, 128);
        x.strokeStyle = cor1; x.lineWidth = 128 / n / 2;
        for (let i = -n; i <= n * 2; i++) {
            x.beginPath();
            if (diagonal) { x.moveTo(i * 128 / n, 0); x.lineTo(i * 128 / n + 128, 128); }
            else { x.moveTo(0, i * 128 / n); x.lineTo(128, i * 128 / n); }
            x.stroke();
        }
        const t = new THREE.CanvasTexture(c);
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.colorSpace = THREE.SRGBColorSpace;
        return t;
    }

    /* ---------------- o Atta ---------------- */

    const MEDIDAS = { E: [1.05, 0.72, 0.28], G: [0.95, 0.70, 0.34], R: [1.00, 0.72, 0.42], T: [1.15, 0.68, 0.40] };

    function medidasDoModelo(modelo, modulo) {
        const padrao = MEDIDAS[modulo] || MEDIDAS.E;
        const f = modelo?.ficha || {};
        const n = (v, p) => { const x = Number(String(v ?? "").replace(",", ".")); return Number.isFinite(x) && x > 0 ? x / 1000 : p; };
        // o protótipo (0,34 m) fica legível numa fábrica de 60 m: mínimo de 0,6 m
        return [Math.max(0.6, n(f.comprimento_mm, padrao[0])), Math.max(0.45, n(f.largura_mm, padrao[1])), Math.max(0.22, n(f.altura_mm, padrao[2]))];
    }

    function carrinho(mat, comprido = 1.15, largo = 0.78) {
        const g = new THREE.Group();
        caixa(mat, g, comprido, 0.04, largo, 0, 0.42, 0, 0x8C949D);
        [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sz]) => {
            caixa(mat, g, 0.04, 1.0, 0.04, sx * (comprido / 2 - 0.03), 0.06, sz * (largo / 2 - 0.03), 0x8C949D);
            cilindro(mat, g, 0.05, 0.04, sx * (comprido / 2 - 0.06), 0.05, sz * (largo / 2 - 0.08), COR.roda, true, false);
        });
        caixa(mat, g, comprido, 0.03, largo, 0, 0.82, 0, 0x8C949D);
        caixa(mat, g, comprido * 0.4, 0.22, largo * 0.7, -comprido * 0.22, 0.46, 0, COR.klt);
        caixa(mat, g, comprido * 0.4, 0.22, largo * 0.7, comprido * 0.22, 0.46, 0, COR.caixa);
        caixa(mat, g, comprido * 0.5, 0.2, largo * 0.6, 0, 0.85, 0, 0xE24A3B);
        return g;
    }

    // Atta procedural: frente para +x local, base no chão
    function construirAtta(mat, modulo, guia, medidas) {
        const [C, L, A] = medidas;
        const g = new THREE.Group();
        const corpo = new THREE.Group();
        g.add(corpo);
        // chassi com cantos chanfrados (octógono alongado)
        const forma = new THREE.Shape();
        const ch = Math.min(C, L) * 0.14;
        forma.moveTo(-C / 2 + ch, -L / 2); forma.lineTo(C / 2 - ch, -L / 2); forma.lineTo(C / 2, -L / 2 + ch); forma.lineTo(C / 2, L / 2 - ch);
        forma.lineTo(C / 2 - ch, L / 2); forma.lineTo(-C / 2 + ch, L / 2); forma.lineTo(-C / 2, L / 2 - ch); forma.lineTo(-C / 2, -L / 2 + ch); forma.closePath();
        const base = new THREE.Mesh(new THREE.ExtrudeGeometry(forma, { depth: A * 0.78, bevelEnabled: false }), mat(COR.atta, { metalness: 0.25, roughness: 0.5 }));
        base.rotation.x = -Math.PI / 2; base.position.y = 0.05; base.castShadow = true; base.receiveShadow = true;
        corpo.add(base);
        const topo = new THREE.Mesh(new THREE.ExtrudeGeometry(forma, { depth: 0.02, bevelEnabled: false }), mat(COR.attaTopo));
        topo.rotation.x = -Math.PI / 2; topo.position.y = 0.05 + A * 0.78; topo.scale.set(0.96, 0.96, 1);
        corpo.add(topo);
        // faixa da marca na frente e o sensor
        caixa(mat, corpo, 0.02, A * 0.18, L * 0.62, C / 2 + 0.005, 0.05 + A * 0.42, 0, 0x2F6BFF, { emissive: 0x2F6BFF, emissiveIntensity: 0.25 });
        caixa(mat, corpo, 0.025, A * 0.12, L * 0.3, C / 2 + 0.01, 0.05 + A * 0.2, 0, 0x0B0E11, { metalness: 0.6, roughness: 0.2 });
        // rodas mecanum nos cantos
        [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sz]) => cilindro(mat, corpo, 0.07, 0.06, sx * (C / 2 - 0.16), 0.07, sz * (L / 2 - 0.02), COR.roda, true, false));
        // LED dos dois lados
        const leds = [];
        [-1, 1].forEach(sz => {
            const led = caixa(mat, corpo, C * 0.7, 0.025, 0.012, 0, 0.05 + A * 0.6, sz * (L / 2 + 0.002), 0x22D35B, { emissive: 0x22D35B, emissiveIntensity: 1.2 });
            led.material = led.material.clone();
            leds.push(led);
        });
        const topoY = 0.07 + A * 0.78;
        const partes = { grupo: g, leds, topoY, medidas, modulo };

        if (modulo === "E") {
            // plataforma de elevação e o carrinho que ele leva
            const plat = caixa(mat, corpo, C * 0.7, 0.04, L * 0.7, 0, topoY, 0, 0x9AA3AC, { metalness: 0.5 });
            partes.plataforma = plat;
            const car = carrinho(mat);
            car.visible = false;
            g.add(car);
            partes.carga = car;
        } else if (modulo === "G") {
            // torre com a garra (dois dedos) na frente, segurando a caixa
            caixa(mat, corpo, 0.12, 0.55, L * 0.75, C * 0.3, topoY, 0, 0x3A4552);
            const dedos = [-1, 1].map(sz => caixa(mat, corpo, 0.42, 0.06, 0.05, C * 0.5, topoY + 0.3, sz * L * 0.26, 0x9AA3AC, { metalness: 0.5 }));
            partes.dedos = dedos;
            const kit = caixa(mat, corpo, 0.4, 0.26, L * 0.42, C * 0.52, topoY + 0.2, 0, COR.klt);
            kit.visible = false;
            partes.carga = kit;
        } else if (modulo === "R") {
            const rolos = Math.round(C / 0.1);
            for (let i = 0; i < rolos; i++) cilindro(mat, corpo, 0.03, L * 0.8, -C / 2 + (i + 0.5) * C / rolos, topoY + 0.03, 0, 0xB8C0C8, true, false);
            [-1, 1].forEach(sz => caixa(mat, corpo, C, 0.08, 0.03, 0, topoY, sz * L * 0.42, 0x3A4552));
            const vol = caixa(mat, corpo, C * 0.7, 0.4, L * 0.7, 0, topoY + 0.06, 0, COR.caixa);
            vol.visible = false;
            partes.carga = vol;
        } else if (modulo === "T") {
            caixa(mat, corpo, C * 0.3, 0.35, L * 0.8, C * 0.25, topoY, 0, 0x3A4552);
            caixa(mat, corpo, 0.3, 0.04, 0.08, -C / 2 - 0.12, 0.25, 0, 0x9AA3AC);
            cilindro(mat, corpo, 0.035, 0.12, -C / 2 - 0.22, 0.2, 0, 0x9AA3AC);
            partes.comboio = [carrinho(mat, 1.5, 0.8), carrinho(mat, 1.5, 0.8), carrinho(mat, 1.5, 0.8)];
            partes.comboio.forEach(c => { c.visible = false; });
        }
        if (guia === "L") {
            const sensor = new THREE.Group();
            cilindro(mat, sensor, 0.07, 0.1, 0, 0, 0, 0x101418);
            caixa(mat, sensor, 0.05, 0.03, 0.12, 0.05, 0.035, 0, 0xFF3B3B, { emissive: 0xFF3B3B, emissiveIntensity: 0.8 });
            const leque = new THREE.Mesh(new THREE.RingGeometry(0.2, 4, 48, 1, -Math.PI * 0.75, Math.PI * 1.5),
                new THREE.MeshBasicMaterial({ color: 0xFF3B3B, transparent: true, opacity: 0.07, side: THREE.DoubleSide, depthWrite: false }));
            leque.rotation.x = -Math.PI / 2; leque.position.y = 0.05;
            sensor.position.set(C * 0.32, topoY + (modulo === "G" ? 0.55 : 0.02), 0);
            corpo.add(sensor);
            const lequeG = new THREE.Group(); lequeG.add(leque); lequeG.position.copy(sensor.position); lequeG.position.y = 0.12;
            corpo.add(lequeG);
            partes.sensor = sensor;
        }
        return partes;
    }

    /* ---------------- a vista ---------------- */

    function criarVista(container, opcoes = {}) {
        const mat = materiais();
        const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: Boolean(opcoes.capturar) });
        renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.05;
        const canvas = renderer.domElement;
        canvas.className = "mapa3d-canvas";
        container.appendChild(canvas);
        const etiquetas = document.createElement("div");
        etiquetas.className = "mapa3d-etiquetas";
        container.appendChild(etiquetas);
        const info = document.createElement("div");
        info.className = "mapa3d-info";
        info.hidden = true;
        container.appendChild(info);

        const cena = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 800);
        const hemi = new THREE.HemisphereLight(0xffffff, 0x8a8f96, 1.1);
        cena.add(hemi);
        const sol = new THREE.DirectionalLight(0xffffff, 1.7);
        sol.castShadow = true;
        sol.shadow.mapSize.set(2048, 2048);
        sol.shadow.bias = -0.0004;
        cena.add(sol);
        cena.add(sol.target);

        const grupos = { piso: new THREE.Group(), desenho: new THREE.Group(), galpao: new THREE.Group(), fitas: new THREE.Group(), objetos: new THREE.Group(), nos: new THREE.Group(), agvs: new THREE.Group() };
        Object.values(grupos).forEach(gr => cena.add(gr));

        const estado = {
            planta: null, revisao: null, chave: "", largura: 20, altura: 12,
            alvo: new THREE.Vector3(10, 0, -6), azimute: -Math.PI / 4 * 1.0 + Math.PI, elevacao: 0.62, distancia: 30,
            seguir: null, girar: false, ativo: true, ultimo: performance.now(), agvs: new Map(), dados: [], vista: "iso", geracao: 0, glb: { pedidos: 0, prontos: 0, erros: [] },
            clicar: typeof opcoes.aoClicar === "function" ? opcoes.aoClicar : null, escuro: escuro()
        };

        // mapa (x, y) -> mundo (x, 0, -y)
        const mundo = (x, y, h = 0) => new THREE.Vector3(x, h, -y);

        function limpar(grupo) {
            while (grupo.children.length) {
                const c = grupo.children.pop();
                c.traverse(o => { if (o.geometry && !o.userData.glb) o.geometry.dispose(); });
            }
        }

        function aplicarTema() {
            estado.escuro = escuro();
            const fundo = new THREE.Color(estado.escuro ? 0x141A20 : 0xEEF1F4);
            cena.background = fundo;
            cena.fog = new THREE.Fog(fundo, 120, 400);
            hemi.intensity = estado.escuro ? 0.8 : 1.1;
        }

        function construirPlanta(p) {
            ["piso", "desenho", "galpao", "fitas", "objetos", "nos"].forEach(k => limpar(grupos[k]));
            const geracao = ++estado.geracao;
            estado.glb = { pedidos: 0, prontos: 0, erros: [] };
            const W = p.dimensoes.largura, H = p.dimensoes.altura;
            estado.largura = W; estado.altura = H;
            aplicarTema();
            const corPiso = estado.escuro ? COR.pisoEscuro : COR.piso;
            const piso = new THREE.Mesh(new THREE.PlaneGeometry(W, H), mat(corPiso, { roughness: 0.92 }));
            piso.rotation.x = -Math.PI / 2; piso.position.set(W / 2, 0, -H / 2); piso.receiveShadow = true;
            grupos.piso.add(piso);
            // contorno do galpão: mureta
            [[W / 2, 0, W, 0.2], [W / 2, H, W, 0.2], [0, H / 2, 0.2, H], [W, H / 2, 0.2, H]].forEach(([x, y, w, d]) => {
                const m = caixa(mat, grupos.piso, w, 0.35, d, 0, 0, 0, estado.escuro ? 0x4A535D : 0xA9B0B8);
                m.position.x = x; m.position.z = -y;
            });
            // grade leve no piso (a cada 5 m)
            const linhas = [];
            for (let x = 0; x <= W; x += 5) linhas.push(x, 0.002, 0, x, 0.002, -H);
            for (let y = 0; y <= H; y += 5) linhas.push(0, 0.002, -y, W, 0.002, -y);
            const gl = new THREE.BufferGeometry();
            gl.setAttribute("position", new THREE.Float32BufferAttribute(linhas, 3));
            grupos.piso.add(new THREE.LineSegments(gl, new THREE.LineBasicMaterial({ color: estado.escuro ? 0x39424C : 0xB3BAC1, transparent: true, opacity: 0.6 })));

            // objetos
            const tipos = Planta.TIPOS_LAYOUT;
            const pisoPintado = (o, material, y = 0.004) => {
                const m = new THREE.Mesh(new THREE.PlaneGeometry(o.largura, o.profundidade), material);
                m.rotation.x = -Math.PI / 2; m.position.y = y; m.receiveShadow = true;
                return m;
            };
            const texProib = texturaListras("rgba(216,52,59,0.75)", "rgba(216,52,59,0.18)");
            const texLivre = texturaListras("rgba(242,183,5,0.85)", "rgba(242,183,5,0.12)");
            const texEmpi = texturaListras("#F2B705", "#23272B", 6);
            (p.layout || []).forEach(o => {
                const g = new THREE.Group();
                g.position.copy(mundo(o.x, o.y));
                g.rotation.y = (Number(o.rotacao) || 0) * Math.PI / 180;
                g.userData = { tipo: "objeto", id: o.id, nome: o.nome || tipos[o.tipo]?.nome || o.tipo };
                const h = Number(o.altura) > 0 ? Number(o.altura) : (tipos[o.tipo]?.altura || 1);
                if (PISO[o.tipo]) {
                    if (o.tipo === "CORREDOR") g.add(pisoPintado(o, mat(estado.escuro ? COR.corredorEscuro : COR.corredor, { roughness: 0.9 }), 0.003));
                    else if (o.tipo === "ZONA_LENTA") g.add(pisoPintado(o, new THREE.MeshStandardMaterial({ color: 0xF2B705, transparent: true, opacity: 0.22, depthWrite: false })));
                    else if (o.tipo === "ZONA_PROIBIDA") { const t = texProib.clone(); t.repeat.set(o.largura / 1.2, o.profundidade / 1.2); t.needsUpdate = true; g.add(pisoPintado(o, new THREE.MeshStandardMaterial({ map: t, transparent: true, depthWrite: false }))); }
                    else if (o.tipo === "AREA_LIVRE") { const t = texLivre.clone(); t.repeat.set(o.largura / 1.2, o.profundidade / 1.2); t.needsUpdate = true; g.add(pisoPintado(o, new THREE.MeshStandardMaterial({ map: t, transparent: true, depthWrite: false }))); }
                    else if (o.tipo === "CRUZAMENTO_EMPILHADEIRA") {
                        g.add(pisoPintado(o, new THREE.MeshStandardMaterial({ color: 0xF2B705, transparent: true, opacity: 0.18, depthWrite: false })));
                        const borda = 0.18;
                        [[0, -o.profundidade / 2 + borda / 2, o.largura, borda], [0, o.profundidade / 2 - borda / 2, o.largura, borda], [-o.largura / 2 + borda / 2, 0, borda, o.profundidade], [o.largura / 2 - borda / 2, 0, borda, o.profundidade]].forEach(([x, z, w, d]) => {
                            const t = texEmpi.clone(); t.repeat.set(w / 0.6, d / 0.6); t.needsUpdate = true;
                            const m = pisoPintado({ largura: w, profundidade: d }, new THREE.MeshStandardMaterial({ map: t }), 0.005);
                            m.position.x = x; m.position.z = z; g.add(m);
                        });
                    } else if (o.tipo === "FAIXA_PEDESTRE") {
                        // listras ao longo de quem anda (largura), repetidas na direção de quem atravessa
                        const n = Math.max(2, Math.round(o.profundidade / 0.5));
                        for (let i = 0; i < n; i++) {
                            const m = pisoPintado({ largura: o.largura * 0.9, profundidade: o.profundidade * 0.55 / n }, mat(0xF4F6F8, { roughness: 0.6 }), 0.005);
                            m.position.z = -o.profundidade / 2 + o.profundidade * (i + 0.5) / n;
                            g.add(m);
                        }
                    }
                } else {
                    const f = FABRICA[o.tipo] || FABRICA.MAQUINA;
                    f(mat, g, o, h);
                    if (o.modelo3d) trocarPorGlb(g, o, geracao);
                }
                grupos.objetos.add(g);
            });
            construirDesenho(p);
            if (p.galpao3d) colocarGalpao(p.galpao3d, geracao);

            // fitas no chão
            (p.segmentos || []).forEach(s => {
                const tipo = Planta.tipoSegmento(s);
                const pts = Planta.pontosSegmento(p, s, 0.2);
                if (pts.length < 2) return;
                const guia = Planta.guiaSegmento(p, s);
                const cor = tipo === "LATERAL" ? 0x7D858E : guia === "MAGNETICA" ? COR.fitaMagnetica : guia === "VIRTUAL" ? COR.virtual : COR.fitaOptica;
                const largura = tipo === "LATERAL" || guia === "VIRTUAL" ? 0.03 : 0.05;
                for (let i = 1; i < pts.length; i++) {
                    const a = pts[i - 1], b = pts[i];
                    const L = Math.hypot(b.x - a.x, b.y - a.y);
                    if (L < 1e-4) continue;
                    if ((tipo === "LATERAL" || guia === "VIRTUAL") && i % 2 === 0 && tipo !== "LATERAL") continue;
                    const passos = tipo === "LATERAL" ? Math.max(1, Math.floor(L / 0.12)) : 1;
                    for (let k = 0; k < passos; k += tipo === "LATERAL" ? 2 : 1) {
                        const f0 = k / passos, f1 = Math.min(1, (k + 1) / passos);
                        const x0 = a.x + (b.x - a.x) * f0, y0 = a.y + (b.y - a.y) * f0, x1 = a.x + (b.x - a.x) * f1, y1 = a.y + (b.y - a.y) * f1;
                        const comp = Math.hypot(x1 - x0, y1 - y0) + (tipo === "CURVA" ? 0.02 : 0);
                        const m = new THREE.Mesh(new THREE.PlaneGeometry(comp, largura), mat(cor, { roughness: 0.5 }));
                        m.rotation.x = -Math.PI / 2;
                        m.rotation.z = Math.atan2(y1 - y0, x1 - x0);
                        m.position.copy(mundo((x0 + x1) / 2, (y0 + y1) / 2, 0.006));
                        m.receiveShadow = true;
                        grupos.fitas.add(m);
                    }
                }
                (s.tags || []).forEach(t => {
                    const q = Planta.pontoNoSegmento(p, s, s.a, t.distancia);
                    const m = new THREE.Mesh(new THREE.PlaneGeometry(0.09, 0.09), mat(COR.tag));
                    m.rotation.x = -Math.PI / 2; m.position.copy(mundo(q.x, q.y, 0.008));
                    grupos.fitas.add(m);
                });
            });
            // pontos: estação (moldura verde), espera (losango âmbar), berço (roxo), tag
            (p.nos || []).forEach(no => {
                if (no.rfid) {
                    const m = new THREE.Mesh(new THREE.PlaneGeometry(0.1, 0.1), mat(COR.tag));
                    m.rotation.x = -Math.PI / 2; m.position.copy(mundo(no.x, no.y, 0.009));
                    grupos.nos.add(m);
                }
                const cor = no.tipo === "ESTACAO" ? 0x2EAF5B : no.tipo === "ESPERA" ? 0xF2B705 : no.tipo === "BERCO" ? 0x9B5CFF : null;
                if (!cor) return;
                const anel = new THREE.Mesh(new THREE.RingGeometry(no.tipo === "BERCO" ? 0.5 : 0.42, no.tipo === "BERCO" ? 0.58 : 0.5, 4, 1, Math.PI / 4),
                    new THREE.MeshBasicMaterial({ color: cor, transparent: true, opacity: 0.85 }));
                anel.rotation.x = -Math.PI / 2;
                if (no.tipo === "ESPERA") anel.rotation.z = Math.PI / 4;
                anel.position.copy(mundo(no.x, no.y, 0.01));
                grupos.nos.add(anel);
            });
            // sol e sombras cobrindo a planta
            const raio = Math.hypot(W, H) / 2 + 5;
            sol.position.set(W * 0.3, raio * 1.2, -H * 0.2 + raio * 0.6);
            sol.target.position.set(W / 2, 0, -H / 2);
            Object.assign(sol.shadow.camera, { left: -raio, right: raio, top: raio, bottom: -raio, near: 1, far: raio * 4 });
            sol.shadow.camera.updateProjectionMatrix();
            if (!estado.planta) enquadrar();
        }

        // Desenho do CAD (0.17): as linhas no chão; camadas de parede viram paredes de 2,5 m
        function construirDesenho(p) {
            const d = p.desenho;
            if (!d || !Array.isArray(d.linhas)) return;
            const a = (d.rotacao || 0) * Math.PI / 180, e = d.escala || 1, c = Math.cos(a), s = Math.sin(a);
            const px = (x, y) => d.x + e * (x * c - y * s), py = (x, y) => d.y + e * (x * s + y * c);
            const linhas = [], paredes = [];
            const ALT = 2.5, MAX_PAREDES = 30000;
            let nParedes = 0;
            d.linhas.forEach(l => {
                const cam = d.camadas[l.c];
                if (!cam || cam.uso === "oculta" || cam.visivel === false) return;
                for (let i = 2; i < l.p.length; i += 2) {
                    const x0 = px(l.p[i - 2], l.p[i - 1]), y0 = py(l.p[i - 2], l.p[i - 1]), x1 = px(l.p[i], l.p[i + 1]), y1 = py(l.p[i], l.p[i + 1]);
                    if (cam.uso === "paredes" && nParedes < MAX_PAREDES) {
                        nParedes++;
                        paredes.push(x0, 0, -y0, x1, 0, -y1, x1, ALT, -y1, x0, 0, -y0, x1, ALT, -y1, x0, ALT, -y0);
                    } else linhas.push(x0, 0.003, -y0, x1, 0.003, -y1);
                }
            });
            if (linhas.length) {
                const g = new THREE.BufferGeometry();
                g.setAttribute("position", new THREE.Float32BufferAttribute(linhas, 3));
                grupos.desenho.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: estado.escuro ? 0x8A96A3 : 0x55606B, transparent: true, opacity: Math.max(0.25, Math.min(1, d.opacidade ?? 0.6)) })));
            }
            if (paredes.length) {
                const g = new THREE.BufferGeometry();
                g.setAttribute("position", new THREE.Float32BufferAttribute(paredes, 3));
                g.computeVertexNormals();
                const m = new THREE.Mesh(g, mat(estado.escuro ? 0x56606B : COR.parede, { side: THREE.DoubleSide, roughness: 0.85 }));
                m.castShadow = true; m.receiveShadow = true;
                grupos.desenho.add(m);
            }
            estado.paredesDesenho = nParedes;
        }

        // Objeto com GLB próprio: o modelo padrão fica até o arquivo chegar
        function trocarPorGlb(g, o, geracao) {
            estado.glb.pedidos++;
            modeloGlb(o.modelo3d).then(modelo => {
                if (geracao !== estado.geracao) return;
                const copia = modelo.clone(true);
                const caixaM = new THREE.Box3().setFromObject(copia);
                const tam = caixaM.getSize(new THREE.Vector3()), centro = caixaM.getCenter(new THREE.Vector3());
                const esc = o.ajuste3d === "real" ? 1 : Math.min(o.largura / Math.max(1e-6, tam.x), o.profundidade / Math.max(1e-6, tam.z));
                const pivo = new THREE.Group();
                copia.position.set(-centro.x, -caixaM.min.y, -centro.z);
                pivo.add(copia);
                pivo.scale.setScalar(esc);
                pivo.userData.glbObjeto = true;
                limpar(g);
                g.add(pivo);
                estado.glb.prontos++;
            }).catch(erro => {
                if (geracao !== estado.geracao) return;
                estado.glb.erros.push(`${o.nome || o.id}: ${erro.message}`);
                console.warn("Modelo 3D de", o.nome || o.id, "não abriu:", erro.message);
            });
        }
        // Galpão: a origem do GLB vai em (x, y) da planta, girado e em escala
        function colocarGalpao(gp, geracao) {
            estado.glb.pedidos++;
            modeloGlb(gp.modelo).then(modelo => {
                if (geracao !== estado.geracao) return;
                const copia = modelo.clone(true);
                const pivo = new THREE.Group();
                pivo.position.copy(mundo(gp.x, gp.y));
                pivo.rotation.y = (gp.rotacao || 0) * Math.PI / 180;
                pivo.scale.setScalar(gp.escala || 1);
                pivo.add(copia);
                grupos.galpao.add(pivo);
                estado.glb.prontos++;
            }).catch(erro => {
                if (geracao !== estado.geracao) return;
                estado.glb.erros.push(`galpão: ${erro.message}`);
                console.warn("Modelo 3D do galpão não abriu:", erro.message);
            });
        }

        // A planta inteira cabe na tela (pela largura ou pela altura do mapa)
        function distanciaParaCaber() {
            const vfov = camera.fov * Math.PI / 180;
            const hfov = 2 * Math.atan(Math.tan(vfov / 2) * camera.aspect);
            return Math.max(8, Math.hypot(estado.largura, estado.altura) / 2 / Math.tan(Math.min(vfov, hfov) / 2) * 0.92);
        }
        function enquadrar() {
            estado.alvo.set(estado.largura / 2, 0, -estado.altura / 2);
            estado.distancia = distanciaParaCaber();
            estado.mexeu = false;
        }

        /* ---------- AGVs ---------- */
        function corLed(a) {
            const sinal = a.led && typeof SINAIS_LED_SITE !== "undefined" ? SINAIS_LED_SITE[a.led] : null;
            if (sinal) return { cor: sinal[0], efeito: sinal[1] };
            return { cor: CORES_ESTADO[a.estado] || "#22D35B", efeito: a.estado === "atencao" ? "pisca" : "fixo" };
        }

        function atualizarAgvs(lista) {
            const vistos = new Set();
            lista.forEach(a => {
                if (typeof a.x !== "number" || typeof a.y !== "number") return;
                vistos.add(a.id);
                const modelo = typeof Modelos !== "undefined" && a.modeloId ? Modelos.porId(a.modeloId) : null;
                const modulo = a.modulo || modelo?.modulo || "E";
                const guia = modelo?.guiamento || "O";
                const chave = modulo + guia + (modelo?.id || "");
                let item = estado.agvs.get(a.id);
                if (item && item.chave !== chave) {
                    grupos.agvs.remove(item.partes.grupo);
                    (item.partes.comboio || []).forEach(c => grupos.agvs.remove(c));
                    item = null;
                }
                if (!item) {
                    const partes = construirAtta(mat, modulo, guia, medidasDoModelo(modelo, modulo));
                    partes.grupo.userData = { tipo: "agv", id: a.id };
                    grupos.agvs.add(partes.grupo);
                    (partes.comboio || []).forEach(c => grupos.agvs.add(c));
                    const etiqueta = document.createElement("div");
                    etiqueta.className = "mapa3d-etiqueta";
                    etiquetas.appendChild(etiqueta);
                    item = { chave, partes, x: a.x, y: a.y, th: (a.orientacao || 0) * Math.PI / 180, elevar: 0, trilha: [], etiqueta };
                    estado.agvs.set(a.id, item);
                }
                item.dados = a;
            });
            estado.agvs.forEach((item, id) => {
                if (vistos.has(id)) return;
                grupos.agvs.remove(item.partes.grupo);
                (item.partes.comboio || []).forEach(c => grupos.agvs.remove(c));
                item.etiqueta.remove();
                estado.agvs.delete(id);
            });
        }

        function registrarTrilha(item) {
            const t = item.trilha;
            const ultimo = t[t.length - 1];
            if (ultimo && Math.hypot(ultimo.x - item.x, ultimo.y - item.y) < 0.05) return;
            t.push({ x: item.x, y: item.y, th: item.th });
            if (t.length > 600) t.shift();
        }
        // pose a "d" metros atrás do Atta, pela trilha que ele fez
        function poseAtras(item, d) {
            const t = item.trilha;
            let falta = d, ax = item.x, ay = item.y;
            for (let i = t.length - 1; i >= 0; i--) {
                const p = t[i];
                const L = Math.hypot(ax - p.x, ay - p.y);
                if (L >= falta && L > 1e-6) {
                    const f = falta / L;
                    return { x: ax + (p.x - ax) * f, y: ay + (p.y - ay) * f, th: Math.atan2(ay - p.y, ax - p.x) };
                }
                falta -= L; ax = p.x; ay = p.y;
            }
            return { x: item.x - Math.cos(item.th) * d, y: item.y - Math.sin(item.th) * d, th: item.th };
        }

        function animarAgvs(dt, agora) {
            estado.agvs.forEach(item => {
                const a = item.dados;
                if (!a || !Number.isFinite(a.x) || !Number.isFinite(a.y)) return;
                const k = 1 - Math.exp(-dt * 8);
                // pulo grande (posição informada, outro ponto): vai direto
                if (!Number.isFinite(item.x) || Math.hypot(a.x - item.x, a.y - item.y) > 8) { item.x = a.x; item.y = a.y; item.trilha.length = 0; }
                item.x += (a.x - item.x) * k;
                item.y += (a.y - item.y) * k;
                const alvo = (a.orientacao || 0) * Math.PI / 180;
                let d = alvo - item.th;
                while (d > Math.PI) d -= 2 * Math.PI;
                while (d < -Math.PI) d += 2 * Math.PI;
                item.th += d * k;
                registrarTrilha(item);
                const p = item.partes;
                p.grupo.position.copy(mundo(item.x, item.y));
                p.grupo.rotation.y = item.th;
                // carga e elevação
                const carregado = Boolean(a.carga);
                item.elevar += ((carregado ? 1 : 0) - item.elevar) * (1 - Math.exp(-dt * 3));
                if (p.modulo === "E") {
                    p.plataforma.position.y = p.topoY + 0.02 + item.elevar * 0.06;
                    p.carga.visible = item.elevar > 0.02;
                    p.carga.position.set(0, item.elevar * 0.06, 0);   // as rodas do carrinho saem do chão
                } else if (p.modulo === "G") {
                    p.carga.visible = carregado;
                    p.dedos.forEach((dd, i) => { dd.position.z = (i ? 1 : -1) * p.medidas[1] * (0.26 - item.elevar * 0.04); });
                } else if (p.modulo === "R") {
                    p.carga.visible = item.elevar > 0.5;
                } else if (p.modulo === "T") {
                    p.comboio.forEach((c, i) => {
                        c.visible = carregado;
                        if (!carregado) return;
                        const q = poseAtras(item, p.medidas[0] / 2 + 0.35 + 0.8 + i * 1.9);
                        c.position.copy(mundo(q.x, q.y));
                        c.rotation.y = q.th;
                    });
                }
                if (p.sensor) p.sensor.rotation.y = agora / 1000 * 8;
                // LED
                const { cor, efeito } = corLed(a);
                let brilho = 1.2;
                const s = agora / 1000;
                if (efeito === "pisca") brilho = Math.sin(s * Math.PI * 2) > 0 ? 1.4 : 0.1;
                else if (efeito === "estrobo") brilho = Math.sin(s * Math.PI * 8) > 0.3 ? 1.6 : 0.05;
                else if (efeito === "respira" || efeito === "respira-rapida") brilho = 0.3 + 0.9 * (0.5 + 0.5 * Math.sin(s * (efeito === "respira" ? 2 : 5)));
                else if (efeito === "perseguicao" || efeito === "flash3") brilho = 0.7 + 0.6 * (0.5 + 0.5 * Math.sin(s * 9));
                p.leds.forEach(led => {
                    led.material.color.set(cor);
                    led.material.emissive.set(cor);
                    led.material.emissiveIntensity = a.estado === "offline" ? 0.05 : brilho;
                });
            });
        }

        function atualizarEtiquetas() {
            const r = canvas.getBoundingClientRect();
            estado.agvs.forEach(item => {
                const a = item.dados;
                const p = mundo(item.x, item.y, item.partes.topoY + 0.8).project(camera);
                const fora = p.z > 1 || p.x < -1.1 || p.x > 1.1 || p.y < -1.1 || p.y > 1.1;
                item.etiqueta.hidden = fora;
                if (fora) return;
                const texto = a.rotulo || `AGV ${a.id}`;
                if (item.etiqueta.textContent !== texto) item.etiqueta.textContent = texto;
                item.etiqueta.classList.toggle("destaque", Boolean(a.destaque));
                item.etiqueta.style.transform = `translate(${((p.x + 1) / 2 * r.width).toFixed(1)}px, ${((1 - p.y) / 2 * r.height).toFixed(1)}px) translate(-50%, -100%)`;
            });
        }

        /* ---------- câmera ---------- */
        function posicionarCamera() {
            // até a pessoa mexer, a vista isométrica acompanha o tamanho do mapa
            if (!estado.mexeu && !estado.seguir && estado.vista === "iso") estado.distancia = distanciaParaCaber();
            if (estado.seguir && estado.agvs.has(estado.seguir)) {
                const it = estado.agvs.get(estado.seguir);
                const alvo = mundo(it.x, it.y);
                if (estado.saltar) { estado.alvo.copy(alvo); estado.saltar = false; }
                else estado.alvo.lerp(alvo, 0.12);
            }
            const e = Math.max(0.12, Math.min(1.5, estado.elevacao));
            const d = estado.distancia;
            camera.position.set(
                estado.alvo.x + d * Math.cos(e) * Math.sin(estado.azimute),
                estado.alvo.y + d * Math.sin(e),
                estado.alvo.z + d * Math.cos(e) * Math.cos(estado.azimute)
            );
            camera.lookAt(estado.alvo);
        }

        function vista(nome) {
            estado.vista = nome;
            if (nome === "iso") { estado.azimute = Math.PI * 0.75; estado.elevacao = 0.62; enquadrar(); }
            else if (nome === "cima") { estado.azimute = Math.PI; estado.elevacao = 1.5; enquadrar(); estado.distancia *= 0.95; }
            else if (nome === "frente") { estado.azimute = Math.PI; estado.elevacao = 0.35; enquadrar(); }
        }

        // arrastar = girar, botão direito ou Shift = mover, roda = zoom; no toque: 1 dedo gira, 2 dedos zoom e movem
        const toques = new Map();
        let arraste = null, clique = null;
        function aoPressionar(ev) {
            canvas.setPointerCapture?.(ev.pointerId);
            toques.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
            clique = { x: ev.clientX, y: ev.clientY, t: performance.now() };
            arraste = { modo: ev.button === 2 || ev.shiftKey ? "mover" : "girar", x: ev.clientX, y: ev.clientY };
            estado.girar = false;
            estado.mexeu = true;
        }
        function aoMover(ev) {
            if (!toques.has(ev.pointerId)) return;
            const antes = toques.get(ev.pointerId);
            toques.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
            if (toques.size === 2) {
                const [p1, p2] = [...toques.values()];
                const dist = Math.hypot(p1.x - p2.x, p1.y - p2.y);
                if (arraste.pinca) estado.distancia = Math.max(3, Math.min(300, estado.distancia * arraste.pinca / dist));
                arraste.pinca = dist;
                moverAlvo((ev.clientX - antes.x) / 2, (ev.clientY - antes.y) / 2);
                return;
            }
            const dx = ev.clientX - antes.x, dy = ev.clientY - antes.y;
            if (arraste.modo === "girar") {
                estado.azimute -= dx * 0.006;
                estado.elevacao = Math.max(0.12, Math.min(1.5, estado.elevacao + dy * 0.005));
            } else moverAlvo(dx, dy);
        }
        function moverAlvo(dx, dy) {
            estado.seguir = null;
            const escala = estado.distancia / Math.max(300, canvas.clientHeight) * 1.1;
            const direita = new THREE.Vector3(Math.cos(estado.azimute), 0, -Math.sin(estado.azimute));
            const frente = new THREE.Vector3(-Math.sin(estado.azimute), 0, -Math.cos(estado.azimute));
            estado.alvo.addScaledVector(direita, -dx * escala).addScaledVector(frente, dy * escala);
        }
        function aoSoltar(ev) {
            toques.delete(ev.pointerId);
            if (!toques.size) arraste = null;
            if (clique && Math.hypot(ev.clientX - clique.x, ev.clientY - clique.y) < 6 && performance.now() - clique.t < 1500) escolher(ev);
            clique = null;
        }
        function aoRolar(ev) {
            ev.preventDefault();
            estado.mexeu = true;
            estado.distancia = Math.max(3, Math.min(300, estado.distancia * Math.exp(ev.deltaY * 0.0012)));
        }
        // o 2D (por baixo) também escuta o mouse no container: aqui o evento para no 3D
        const so = f => ev => { ev.stopPropagation(); f(ev); };
        canvas.addEventListener("pointerdown", so(aoPressionar));
        canvas.addEventListener("pointermove", so(aoMover));
        canvas.addEventListener("pointerup", so(aoSoltar));
        canvas.addEventListener("pointercancel", so(aoSoltar));
        canvas.addEventListener("wheel", so(aoRolar), { passive: false });
        canvas.addEventListener("contextmenu", ev => ev.preventDefault());

        const raio = new THREE.Raycaster();
        function alvoEm(clientX, clientY) {
            const r = canvas.getBoundingClientRect();
            raio.setFromCamera(new THREE.Vector2((clientX - r.left) / r.width * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1), camera);
            const achados = raio.intersectObjects([grupos.agvs, grupos.objetos], true);
            for (const h of achados) {
                let o = h.object;
                while (o && !o.userData?.tipo) o = o.parent;
                if (o) return o.userData;
            }
            return null;
        }
        // onde um AGV aparece na tela (para os testes e para centralizar)
        function naTela(id) {
            const it = estado.agvs.get(id);
            if (!it) return null;
            const r = canvas.getBoundingClientRect();
            const q = mundo(it.x, it.y, it.partes.topoY * 0.6).project(camera);
            return { x: r.left + (q.x + 1) / 2 * r.width, y: r.top + (1 - q.y) / 2 * r.height };
        }
        function escolher(ev) {
            const alvo = alvoEm(ev.clientX, ev.clientY);
            if (!alvo) { info.hidden = true; return; }
            if (alvo.tipo === "agv") {
                const it = estado.agvs.get(alvo.id);
                const a = it?.dados || {};
                const modelo = typeof Modelos !== "undefined" && a.modeloId ? Modelos.nome(a.modeloId) : "";
                const sinal = corLed(a);
                info.innerHTML = `<b>AGV ${esc(alvo.id)}</b>${modelo ? `<span>${esc(modelo)}</span>` : ""}<span><i style="background:${esc(sinal.cor)}"></i>${esc(a.descricao || a.estado || "")}</span>
                    <div class="mapa3d-info-acoes"><button type="button" data-3d="seguir" data-id="${esc(alvo.id)}">${estado.seguir === alvo.id ? "Parar de seguir" : "Seguir"}</button></div>`;
                if (estado.clicar) estado.clicar({ tipo: "agv", id: alvo.id });
            } else {
                info.innerHTML = `<b>${esc(alvo.nome)}</b><span>${esc(Planta.TIPOS_LAYOUT[(estado.planta?.layout || []).find(o => o.id === alvo.id)?.tipo]?.nome || "")}</span>`;
            }
            info.hidden = false;
        }
        info.addEventListener("click", ev => {
            const b = ev.target.closest("[data-3d]");
            if (!b) return;
            if (b.dataset["3d"] === "seguir") { seguir(estado.seguir === b.dataset.id ? null : b.dataset.id); info.hidden = true; }
        });
        const esc = t => String(t ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

        function seguir(id) {
            estado.seguir = id || null;
            estado.saltar = Boolean(id);
            if (id) estado.distancia = Math.min(estado.distancia, 14);
        }

        /* ---------- laço ---------- */
        function redimensionar() {
            const w = Math.max(10, container.clientWidth), h = Math.max(10, container.clientHeight);
            if (canvas.width !== Math.round(w * renderer.getPixelRatio()) || canvas.height !== Math.round(h * renderer.getPixelRatio())) {
                renderer.setSize(w, h, false);
                camera.aspect = w / h;
                camera.updateProjectionMatrix();
            }
        }
        let quadro = null;
        function laco(agora) {
            quadro = estado.ativo ? requestAnimationFrame(laco) : null;
            if (!container.isConnected || container.offsetParent === null) return;
            const dt = Math.max(0, Math.min(0.1, (agora - estado.ultimo) / 1000));
            estado.ultimo = agora;
            redimensionar();
            if (estado.girar) estado.azimute += dt * 0.12;
            animarAgvs(dt, agora);
            posicionarCamera();
            renderer.render(cena, camera);
            atualizarEtiquetas();
        }
        quadro = requestAnimationFrame(laco);

        // Assinatura barata da planta: refaz a cena só quando algo mudou
        function assinatura(p) {
            let soma = 0;
            (p.layout || []).forEach(o => { soma += o.x * 3.1 + o.y * 7.3 + o.largura * 11 + o.profundidade * 13 + (o.rotacao || 0) + (o.altura || 0) * 17 + o.tipo.length; });
            (p.nos || []).forEach(n => { soma += n.x * 5.7 + n.y * 2.9 + n.tipo.length; });
            (p.segmentos || []).forEach(s => { soma += (s.raio || 0) * 19 + s.tipo.length + (s.guia || "").length * 23; });
            (p.layout || []).forEach(o => { if (o.modelo3d) soma += parseInt(o.modelo3d.slice(0, 6), 16) / 1e5 + (o.ajuste3d === "real" ? 29 : 31); });
            const d = p.desenho, gp = p.galpao3d;
            const extra = (d ? `${d.linhas.length},${d.x},${d.y},${d.rotacao},${d.escala},${d.opacidade},${d.camadas.map(c => c.uso[0] + (c.visivel === false ? 0 : 1)).join("")}` : "-")
                + "|" + (gp ? `${gp.modelo},${gp.x},${gp.y},${gp.rotacao},${gp.escala}` : "-");
            return `${extra}|${p.revisao}|${p.dimensoes.largura}x${p.dimensoes.altura}|${(p.layout || []).length}|${(p.segmentos || []).length}|${(p.nos || []).length}|${soma.toFixed(3)}|${escuro()}`;
        }

        function atualizar(mapa) {
            const p = mapa.planta;
            if (!p) return;
            const chave = assinatura(p);
            if (chave !== estado.chave) {
                estado.chave = chave;
                construirPlanta(p);
                estado.planta = p;
            }
            atualizarAgvs(mapa.agvs || []);
        }

        function destruir() {
            estado.ativo = false;
            if (quadro) cancelAnimationFrame(quadro);
            Object.values(grupos).forEach(limpar);
            renderer.dispose();
            canvas.remove(); etiquetas.remove(); info.remove();
        }

        return {
            atualizar, vista, seguir, destruir, alvoEm, naTela,
            girar: v => { estado.girar = v === undefined ? !estado.girar : Boolean(v); return estado.girar; },
            depurar: () => ({ dado: estado.seguir && estado.agvs.get(estado.seguir)?.dados ? [estado.agvs.get(estado.seguir).dados.x, estado.agvs.get(estado.seguir).dados.y] : null, alvo: estado.alvo.toArray().map(v => +v.toFixed(2)), cam: camera.position.toArray().map(v => +v.toFixed(2)), dist: estado.distancia, el: estado.elevacao,
                t1: estado.seguir && estado.agvs.get(estado.seguir) ? [estado.agvs.get(estado.seguir).x, estado.agvs.get(estado.seguir).y] : null, aspect: camera.aspect, w: canvas.width, h: canvas.height }),
            estado: () => ({ agvs: estado.agvs.size, objetos: grupos.objetos.children.length, fitas: grupos.fitas.children.length, seguir: estado.seguir, girar: estado.girar, vista: estado.vista,
                desenho: grupos.desenho.children.length, paredesDesenho: estado.paredesDesenho || 0, galpao: grupos.galpao.children.length,
                glb: Object.assign({}, estado.glb, { comModelo: grupos.objetos.children.filter(g => g.children.some(c => c.userData.glbObjeto)).length }) }),
            canvas
        };
    }

    async function criar(container, opcoes = {}) {
        if (!suportado()) throw new Error("Este navegador não tem WebGL (aceleração gráfica): a vista 3D não abre aqui.");
        await carregar();
        return criarVista(container, opcoes);
    }

    return { criar, carregar, suportado, FABRICA, MEDIDAS };
})();
