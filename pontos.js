/*! pontos.js v0.1.0 | Licença MIT
 *  Unit chart que se transforma: pontos que mudam de arranjo com animação.
 *  Depende só do D3 v7 (carregue antes deste arquivo). Sem build.
 *
 *  Uso mínimo:
 *    const pm = Pontos.criar('#palco', { itens, cenas });
 *    pm.proxima();
 *
 *  Cada item: { id, valor, categoria, x, y, ...campos livres }
 *  Tipos de cena: amontoado, agrupar, grade, barras, eixo, dispersao, mapa
 */
(function (raiz) {
  "use strict";
  const d3 = raiz.d3;
  if (!d3 || !d3.forceSimulation) {
    throw new Error("pontos.js precisa do D3 v7 carregado antes (d3.min.js).");
  }

  const TAU = Math.PI * 2;
  const nf = new Intl.NumberFormat("pt-BR");
  const comparar = new Intl.Collator("pt-BR", { numeric: true }).compare;
  const PALETA_VARS = ["--pm-c1", "--pm-c2", "--pm-c3", "--pm-c4", "--pm-c5"];

  const PADRAO = {
    limiteCanvas: 1000,      // acima disso desenha em Canvas, abaixo em SVG (medido: SVG cai para 10 a 25 fps com 2 mil pontos)
    renderizador: "auto",    // "auto" | "svg" | "canvas"
    duracao: 1400,           // ms de cada transição
    escalonamento: 0.38,     // fração da duração usada para os pontos saírem em sequência
    intervaloRoteiro: 5200,  // ms entre cenas no modo roteiro
    repetirRoteiro: false,
    densidade: 0.14,         // fração da área do palco ocupada pelos pontos (cenas por valor)
    campoValor: "valor",
    cor: null,               // { campo: "regiao" | fn(item), cores: { Norte: "#..." }, ordem: [...] }
    vazado: null,            // "campo" | fn(item) => true para ponto vazado
    dica: null,              // fn(item, cena) => HTML da dica
    teclado: true,
    controles: true,
    telaCheiaAlvo: null,     // elemento que vai para tela cheia (padrão: a página inteira)
    semente: 7,
    aoMudarCena: null,
  };

  /* ---------- utilidades ---------- */
  function rngSemente(s) {
    let a = s >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const chaveDe = (spec, item) => (typeof spec === "function" ? spec(item) : item[spec]);
  const facil = d3.easeCubicInOut;
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  function el(tag, cls, pai) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (pai) pai.appendChild(e);
    return e;
  }
  function gruposDe(nos, por, ordem) {
    const m = new Map();
    for (const n of nos) {
      const k = por ? String(chaveDe(por, n.item)) : "Todos";
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(n);
    }
    let chaves = [...m.keys()];
    if (Array.isArray(ordem)) {
      const pos = new Map(ordem.map((k, i) => [String(k), i]));
      chaves.sort((a, b) => (pos.has(a) ? pos.get(a) : 1e9) - (pos.has(b) ? pos.get(b) : 1e9) || a.localeCompare(b, "pt-BR"));
    } else if (ordem === "tamanho") {
      chaves.sort((a, b) => m.get(b).length - m.get(a).length);
    } else {
      chaves.sort((a, b) => a.localeCompare(b, "pt-BR", { numeric: true }));
    }
    return chaves.map((k) => ({ chave: k, nos: m.get(k) }));
  }
  function caixa(c, cena, padrao) {
    const m = Object.assign({}, padrao, cena.margem || {});
    return { x0: m.left, y0: m.top, x1: c.W - m.right, y1: c.H - m.bottom, w: Math.max(10, c.W - m.left - m.right), h: Math.max(10, c.H - m.top - m.bottom), m };
  }
  // raio proporcional à raiz do valor, para a área ocupada bater com a densidade pedida
  function raiosPorValor(nos, area, densidade, campoValor) {
    let soma = 0;
    for (const n of nos) soma += Math.max(0, +n.item[campoValor] || 0);
    if (!soma) return nos.forEach((n) => (n.tr = 2));
    const k = Math.sqrt((densidade * area) / (Math.PI * soma));
    for (const n of nos) n.tr = Math.max(0.8, k * Math.sqrt(Math.max(0, +n.item[campoValor] || 0)));
  }
  function grelha(n, larg, cena) {
    if (cena.colunas) return Math.min(n, cena.colunas);
    if (larg < 560) return Math.min(n, 2);
    if (larg < 900) return Math.min(n, 3);
    return Math.min(n, 5);
  }
  // colisão própria, por grade espacial: a d3.forceCollide resolve o mesmo problema, mas com
  // 3 mil pontos de tamanhos variados ficava lenta demais em máquina modesta
  function forcaColisao(folga, passadas) {
    let nos = [];
    function forca() {
      for (let p = 0; p < (passadas || 1); p++) passada();
    }
    function passada() {
      const n = nos.length;
      if (!n) return;
      let rmax = 0, x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const d of nos) {
        if (d.r > rmax) rmax = d.r;
        if (d.x < x0) x0 = d.x; if (d.x > x1) x1 = d.x;
        if (d.y < y0) y0 = d.y; if (d.y > y1) y1 = d.y;
      }
      const cel = Math.max(1, 2 * rmax + folga);
      const nx = Math.min(2048, Math.floor((x1 - x0) / cel) + 1), ny = Math.min(2048, Math.floor((y1 - y0) / cel) + 1);
      const cab = new Int32Array(nx * ny).fill(-1), prox = new Int32Array(n);
      const ci = new Int32Array(n), cj = new Int32Array(n);
      for (let i = 0; i < n; i++) {
        const d = nos[i];
        const a = Math.min(nx - 1, ((d.x - x0) / cel) | 0), b = Math.min(ny - 1, ((d.y - y0) / cel) | 0);
        ci[i] = a; cj[i] = b;
        const c = b * nx + a;
        prox[i] = cab[c];
        cab[c] = i;
      }
      for (let i = 0; i < n; i++) {
        const A = nos[i];
        for (let oy = -1; oy <= 1; oy++) {
          const b = cj[i] + oy;
          if (b < 0 || b >= ny) continue;
          for (let ox = -1; ox <= 1; ox++) {
            const a = ci[i] + ox;
            if (a < 0 || a >= nx) continue;
            for (let j = cab[b * nx + a]; j !== -1; j = prox[j]) {
              if (j <= i) continue;
              const B = nos[j];
              let dx = B.x - A.x, dy = B.y - A.y;
              const min = A.r + B.r + folga;
              let d2 = dx * dx + dy * dy;
              if (d2 >= min * min) continue;
              if (d2 < 1e-6) { dx = ((i * 7919 + j) % 13) / 13 - 0.5 || 0.1; dy = 0.05; d2 = dx * dx + dy * dy; }
              const d = Math.sqrt(d2), m = (min - d) / d;
              const ra = A.r * A.r, rb = B.r * B.r, wa = ra / (ra + rb || 1), wb = 1 - wa;
              A.x -= dx * m * wb; A.y -= dy * m * wb;
              B.x += dx * m * wa; B.y += dy * m * wa;
            }
          }
        }
      }
    }
    forca.initialize = (n) => { nos = n; };
    return forca;
  }
  function simular(nosSim, forcas, ticks, rng) {
    const sim = d3.forceSimulation(nosSim).randomSource(rng).stop();
    for (const [nome, f] of forcas) sim.force(nome, f);
    sim.alphaDecay(1 - Math.pow(0.001, 1 / ticks));
    for (let i = 0; i < ticks; i++) sim.tick();
    return nosSim;
  }
  /* ---------- layouts: cada um preenche n.tx, n.ty, n.tr e devolve as guias ---------- */
  const LAYOUTS = {};

  // amontoado é o agrupar com um grupo só
  LAYOUTS.amontoado = (nos, cena, c) => LAYOUTS.agrupar(nos, Object.assign({}, cena, { por: cena.por || null }), c);

  LAYOUTS.agrupar = function (nos, cena, c) {
    const grupos = gruposDe(nos, cena.por, cena.ordem);
    const cx = caixa(c, cena, { top: cena.por ? 36 : 16, right: 14, bottom: 14, left: 14 });
    const n = grupos.length;
    const cols = grelha(n, c.W, cena);
    const lins = Math.ceil(n / cols);
    const cw = cx.w / cols, ch = cx.h / lins;
    const tamanho = cena.tamanho || "valor";
    // densidade limitada para o maior grupo caber na própria célula
    let dens = cena.densidade || c.op.densidade * 1.8;
    if (tamanho === "valor") {
      raiosPorValor(nos, cx.w * cx.h, dens, c.op.campoValor);
      const limite = Math.min(cw, ch - (cena.por ? 26 : 0)) * 0.46;
      let pior = 1;
      for (const g of grupos) {
        let a = 0;
        for (const no of g.nos) a += Math.PI * no.tr * no.tr;
        const R = Math.sqrt(a / 0.72 / Math.PI);
        pior = Math.max(pior, R / limite);
      }
      if (pior > 1) for (const no of nos) no.tr = Math.max(0.7, no.tr / pior);
    } else {
      for (const no of nos) no.tr = cena.raio || 2.4;
    }
    const guias = { rotulos: [] };
    const sims = [];
    const centros = new Map();
    grupos.forEach((g, i) => {
      const col = i % cols, lin = Math.floor(i / cols);
      const gx = cx.x0 + cw * (col + 0.5), gy = cx.y0 + ch * (lin + 0.5) + (cena.por ? 8 : 0);
      centros.set(g.chave, [gx, gy]);
      // ponto de partida em espiral de girassol (maiores no meio): já nasce quase arrumado
      const ord = g.nos.slice().sort((a, b) => b.tr - a.tr || comparar(a.id, b.id));
      let area = 0;
      ord.forEach((no, j) => {
        area += Math.PI * (no.tr + 0.5) * (no.tr + 0.5);
        const rr = Math.sqrt(area / (Math.PI * 0.82)), ang = j * 2.399963;
        sims.push({ n: no, r: no.tr, gx, gy, x: gx + rr * Math.cos(ang), y: gy + rr * Math.sin(ang) });
      });
    });
    const ticks = sims.length > 1500 ? 70 : 110;
    simular(sims, [
      ["x", d3.forceX((s) => s.gx).strength(0.09)],
      ["y", d3.forceY((s) => s.gy).strength(0.09)],
      ["colisao", forcaColisao(0.6)],
    ], ticks, c.rng);
    const topo = new Map();
    for (const s of sims) {
      s.n.tx = s.x; s.n.ty = s.y;
      const k = s.n.grupo;
      topo.set(k, Math.min(topo.has(k) ? topo.get(k) : Infinity, s.y - s.r));
    }
    if (cena.por) {
      for (const g of grupos) {
        const [gx] = centros.get(g.chave);
        guias.rotulos.push({ x: gx, y: Math.max(14, topo.get(g.chave) - 10), t: rotuloGrupo(cena, g.chave), num: g.nos.length, ancora: "middle" });
      }
    }
    return guias;
  };

  // grade (waffle): cada grupo vira um bloco de pontos iguais, um ponto por item
  LAYOUTS.grade = function (nos, cena, c) {
    const grupos = gruposDe(nos, cena.por, cena.ordem);
    const cx = caixa(c, cena, { top: 34, right: 14, bottom: 12, left: 14 });
    const n = grupos.length;
    const cols = grelha(n, c.W, cena);
    const lins = Math.ceil(n / cols);
    const cw = cx.w / cols, ch = cx.h / lins;
    const bw = cw * 0.86, bh = ch - 30;
    const asp = bw / Math.max(10, bh);
    let d = Math.min(26, bw, bh), ks;
    for (; d > 1.1; d *= 0.97) {
      const kmax = Math.max(1, Math.floor(bw / d));
      ks = grupos.map((g) => Math.min(kmax, Math.max(1, Math.ceil(Math.sqrt(g.nos.length * asp)))));
      if (grupos.every((g, i) => Math.ceil(g.nos.length / ks[i]) * d <= bh)) break;
    }
    const r = Math.max(0.6, d * 0.42);
    const guias = { rotulos: [] };
    grupos.forEach((g, i) => {
      const col = i % cols, lin = Math.floor(i / cols);
      const k = ks[i], linhas = Math.ceil(g.nos.length / k);
      const larg = k * d, alt = linhas * d;
      const gx0 = cx.x0 + cw * (col + 0.5) - larg / 2;
      const gy0 = cx.y0 + ch * lin + 30 + (bh - alt) / 2;
      ordenarDentro(g.nos, cena, c);
      g.nos.forEach((no, j) => {
        no.tx = gx0 + (j % k) * d + d / 2;
        no.ty = gy0 + Math.floor(j / k) * d + d / 2;
        no.tr = r;
      });
      guias.rotulos.push({ x: gx0 + larg / 2, y: gy0 - 10, t: rotuloGrupo(cena, g.chave), num: g.nos.length, ancora: "middle" });
    });
    return guias;
  };

  // barras de unidades: colunas (ou linhas) de pontos iguais, comparáveis pela altura
  LAYOUTS.barras = function (nos, cena, c) {
    const grupos = gruposDe(nos, cena.por, cena.ordem || "tamanho");
    const n = grupos.length;
    let ori = cena.orientacao || "auto";
    if (ori === "auto") ori = c.W / Math.max(1, n) >= 74 ? "vertical" : "horizontal";
    const guias = { rotulos: [], linhas: [] };
    const maior = d3.max(grupos, (g) => g.nos.length) || 1;
    const linhasRot = (k) => String(rotuloGrupo(cena, k)).split("\n").length;
    if (ori === "vertical") {
      const nl = d3.max(grupos, (g) => linhasRot(g.chave)) || 1;
      const cx = caixa(c, cena, { top: 30, right: 14, bottom: 14 + nl * 14, left: 14 });
      const bw = cx.w / n, esp = bw * 0.72;
      let d = Math.min(24, esp), k;
      for (; d > 1.1; d *= 0.97) {
        k = Math.max(1, Math.floor(esp / d));
        if (Math.ceil(maior / k) * d <= cx.h) break;
      }
      const r = Math.max(0.6, d * 0.42);
      guias.linhas.push({ x1: cx.x0, x2: cx.x1, y1: cx.y1 + 3, y2: cx.y1 + 3 });
      grupos.forEach((g, i) => {
        const x0 = cx.x0 + bw * (i + 0.5) - (k * d) / 2;
        ordenarDentro(g.nos, cena, c);
        g.nos.forEach((no, j) => {
          no.tx = x0 + (j % k) * d + d / 2;
          no.ty = cx.y1 - Math.floor(j / k) * d - d / 2;
          no.tr = r;
        });
        const alt = Math.ceil(g.nos.length / k) * d;
        guias.rotulos.push({ x: x0 + (k * d) / 2, y: cx.y1 + 18, t: rotuloGrupo(cena, g.chave), ancora: "middle", classe: "pm-rotulo" });
        guias.rotulos.push({ x: x0 + (k * d) / 2, y: cx.y1 - alt - 8, num: g.nos.length, chaveNum: g.chave, ancora: "middle" });
      });
    } else {
      const maxCar = d3.max(grupos, (g) => d3.max(String(rotuloGrupo(cena, g.chave)).split("\n"), (s) => s.length)) || 6;
      const esq = Math.min(c.W * 0.42, 14 + maxCar * 7.4);
      const cx = caixa(c, cena, { top: 12, right: 52, bottom: 12, left: esq });
      const bh = cx.h / n, esp = bh * 0.7;
      let d = Math.min(24, esp), k;
      for (; d > 1.1; d *= 0.97) {
        k = Math.max(1, Math.floor(esp / d));
        if (Math.ceil(maior / k) * d <= cx.w) break;
      }
      const r = Math.max(0.6, d * 0.42);
      guias.linhas.push({ x1: cx.x0 - 3, x2: cx.x0 - 3, y1: cx.y0, y2: cx.y1 });
      grupos.forEach((g, i) => {
        const y0 = cx.y0 + bh * (i + 0.5) - (k * d) / 2;
        ordenarDentro(g.nos, cena, c);
        g.nos.forEach((no, j) => {
          no.tx = cx.x0 + Math.floor(j / k) * d + d / 2;
          no.ty = y0 + (j % k) * d + d / 2;
          no.tr = r;
        });
        const comp = Math.ceil(g.nos.length / k) * d;
        guias.rotulos.push({ x: cx.x0 - 10, y: y0 + (k * d) / 2 + 4, t: rotuloGrupo(cena, g.chave), ancora: "end", classe: "pm-rotulo", centroV: true });
        guias.rotulos.push({ x: cx.x0 + comp + 8, y: y0 + (k * d) / 2 + 4, num: g.nos.length, chaveNum: g.chave, ancora: "start" });
      });
    }
    return guias;
  };

  // eixo numérico (beeswarm): cada ponto escorrega até o seu valor e a colisão empilha
  LAYOUTS.eixo = function (nos, cena, c) {
    const ex = cena.x || {};
    const cx = caixa(c, cena, { top: 18, right: 22, bottom: 44, left: 22 });
    const vals = nos.map((no) => +chaveDe(ex.campo, no.item)).filter(Number.isFinite);
    const dom = ex.dominio || d3.extent(vals);
    const sx = d3.scaleLinear().domain(dom).range([cx.x0 + 6, cx.x1 - 6]).clamp(true);
    if ((cena.tamanho || "valor") === "valor") raiosPorValor(nos, cx.w * cx.h, cena.densidade || c.op.densidade * 0.8, c.op.campoValor);
    else for (const no of nos) no.tr = cena.raio || 2.2;
    const meio = cx.y0 + cx.h / 2;
    const sims = nos.map((no) => {
      const v = +chaveDe(ex.campo, no.item);
      const alvo = Number.isFinite(v) ? sx(v) : cx.x0;
      return { n: no, r: no.tr, alvo, x: alvo, y: meio };
    });
    // empilhamento inicial por faixa de x, alternando acima e abaixo do meio
    const passo = 2 * (d3.mean(sims, (s) => s.r) || 2) + 0.9;
    const pilhas = new Map();
    sims.slice().sort((a, b) => b.r - a.r).forEach((s) => {
      const f = Math.round(s.alvo / passo);
      const k = pilhas.get(f) || 0;
      pilhas.set(f, k + 1);
      s.y = meio + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * passo;
    });
    simular(sims, [
      ["x", d3.forceX((s) => s.alvo).strength(0.35)],
      ["y", d3.forceY(meio).strength(0.03)],
      ["colisao", forcaColisao(0.5, 3)],
    ], sims.length > 1500 ? 80 : 120, c.rng);
    for (const s of sims) {
      s.n.tx = s.x;
      s.n.ty = Math.max(cx.y0 + s.r, Math.min(cx.y1 - s.r, s.y));
    }
    return {
      rotulos: rotulosDeDados(cena, sx, null, cx),
      eixoX: { escala: sx, y: cx.y1 + 4, titulo: ex.rotulo, formato: ex.formato, x0: cx.x0, x1: cx.x1 },
    };
  };

  LAYOUTS.dispersao = function (nos, cena, c) {
    const ex = cena.x || {}, ey = cena.y || {};
    const cx = caixa(c, cena, { top: 26, right: 20, bottom: 46, left: 54 });
    const xs = nos.map((no) => +chaveDe(ex.campo, no.item)), ys = nos.map((no) => +chaveDe(ey.campo, no.item));
    const sx = d3.scaleLinear().domain(ex.dominio || d3.extent(xs)).range([cx.x0 + 6, cx.x1 - 6]).nice();
    const sy = d3.scaleLinear().domain(ey.dominio || d3.extent(ys)).range([cx.y1 - 6, cx.y0 + 6]).nice();
    if ((cena.tamanho || "valor") === "valor") raiosPorValor(nos, cx.w * cx.h, cena.densidade || c.op.densidade * 0.7, c.op.campoValor);
    else for (const no of nos) no.tr = cena.raio || 2.2;
    nos.forEach((no, i) => {
      no.tx = Number.isFinite(xs[i]) ? sx(xs[i]) : cx.x0;
      no.ty = Number.isFinite(ys[i]) ? sy(ys[i]) : cx.y1;
    });
    const linhas = [];
    if (Number.isFinite(ey.referencia)) linhas.push({ x1: cx.x0, x2: cx.x1, y1: sy(ey.referencia), y2: sy(ey.referencia), tracejada: true });
    if (Number.isFinite(ex.referencia)) linhas.push({ x1: sx(ex.referencia), x2: sx(ex.referencia), y1: cx.y0, y2: cx.y1, tracejada: true });
    return {
      linhas,
      rotulos: rotulosDeDados(cena, sx, sy, cx),
      eixoX: { escala: sx, y: cx.y1 + 4, titulo: ex.rotulo, formato: ex.formato, x0: cx.x0, x1: cx.x1 },
      eixoY: { escala: sy, x: cx.x0 - 4, titulo: ey.rotulo, formato: ey.formato, y0: cx.y0, y1: cx.y1 },
    };
  };

  // mapa / posição fixa: usa item.x e item.y (ou os campos da cena) mantendo a proporção
  LAYOUTS.mapa = function (nos, cena, c) {
    const fx = cena.campoX || "x", fy = cena.campoY || "y";
    const cx = caixa(c, cena, { top: 16, right: 16, bottom: 16, left: 16 });
    const todos = c.todos.filter((no) => Number.isFinite(+no.item[fx]) && Number.isFinite(+no.item[fy]));
    const [x0, x1] = d3.extent(todos, (no) => +no.item[fx]);
    const [y0, y1] = d3.extent(todos, (no) => +no.item[fy]);
    const esc = Math.min(cx.w / Math.max(1e-9, x1 - x0), cx.h / Math.max(1e-9, y1 - y0));
    const ox = cx.x0 + (cx.w - (x1 - x0) * esc) / 2, oy = cx.y0 + (cx.h - (y1 - y0) * esc) / 2;
    const inverte = cena.inverterY !== false;
    const px = (v) => ox + (v - x0) * esc;
    const py = (v) => (inverte ? oy + (y1 - v) * esc : oy + (v - y0) * esc);
    const area = (x1 - x0) * esc * (y1 - y0) * esc;
    if ((cena.tamanho || "valor") === "valor") raiosPorValor(nos, area, cena.densidade || c.op.densidade * 1.2, c.op.campoValor);
    else for (const no of nos) no.tr = cena.raio || 2;
    for (const no of nos) {
      no.tx = px(+no.item[fx]);
      no.ty = py(+no.item[fy]);
    }
    const rot = (cena.rotulos || []).map((r) => ({ x: px(r.x), y: py(r.y), t: r.texto, ancora: "middle", classe: "pm-rotulo" }));
    return { rotulos: rot };
  };

  function rotuloGrupo(cena, chave) {
    return cena.rotuloGrupo ? cena.rotuloGrupo(chave) : chave;
  }
  function ordenarDentro(lista, cena, c) {
    if (cena.ordenarDentro) lista.sort((a, b) => cena.ordenarDentro(a.item, b.item));
    else lista.sort((a, b) => a.ordCor - b.ordCor || comparar(String(a.item.id), String(b.item.id)));
  }
  function rotulosDeDados(cena, sx, sy, cx) {
    return (cena.rotulos || []).map((r) => ({
      x: Math.max(cx.x0 + 4, Math.min(cx.x1 - 4, sx(r.x))),
      y: sy ? sy(r.y) : cx.y0 + 12,
      t: r.texto,
      ancora: r.ancora || "middle",
      classe: "pm-rotulo",
    }));
  }

  /* ---------- o componente ---------- */
  function criar(alvo, opcoes) {
    const raizEl = typeof alvo === "string" ? document.querySelector(alvo) : alvo;
    if (!raizEl) throw new Error("pontos.js: não achei o elemento " + alvo);
    const op = Object.assign({}, PADRAO, opcoes || {});
    const cenas = op.cenas || [];
    if (!cenas.length) throw new Error("pontos.js: informe pelo menos uma cena.");
    const reduzMovimento = raiz.matchMedia && raiz.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const rng = rngSemente(op.semente);

    raizEl.classList.add("pm");
    raizEl.innerHTML = "";
    const cabeca = el("div", "pm-cabeca", raizEl);
    const passoEl = el("div", "pm-passo", cabeca);
    const tituloEl = el("h2", "pm-titulo", cabeca);
    const textoEl = el("p", "pm-texto", cabeca);
    const palco = el("div", "pm-palco", raizEl);
    palco.setAttribute("role", "img");
    const legenda = el("div", "pm-legenda", raizEl);
    const controles = el("div", "pm-controles", raizEl);
    if (!op.controles) controles.style.display = "none";
    const dica = el("div", "pm-dica", palco);

    let usaCanvas = false, canvas = null, ctx2d = null, svgPontos = null, gPontos = null;
    let W = 0, H = 0, dpr = 1;
    const svgGuias = d3.select(palco).append("svg").attr("class", "pm-guias").attr("aria-hidden", "true");
    const gFoco = svgGuias.append("g");
    let gGuiaAtual = null;
    const ultimoNum = new Map();

    let nos = [];          // estado de cada ponto
    let porId = new Map();
    let versaoDados = 0;
    const cache = new Map();
    let indice = -1;
    let destaque = null;
    let animando = false, t0 = 0, dur = op.duracao, ultimoQuadro = 0;
    const metricas = { quadros: [], desenhoMs: [], transicoes: 0, layoutMs: [] };
    let temporizadorRoteiro = null, roteiroLigado = false, animProgresso = null;
    let cores = {};

    /* ---- dados ---- */
    function montarNos(itens) {
      const novos = [];
      const vistos = new Set();
      for (const item of itens) {
        const id = String(item.id);
        vistos.add(id);
        let n = porId.get(id);
        if (!n) {
          n = { id, item, cx: 0, cy: 0, cr: 0, co: 0, sx: 0, sy: 0, sr: 0, so: 0, tx: 0, ty: 0, tr: 0, to: 0, atraso: 0, fim: true, cor: "#888", corA: "#888", corB: "#888", vaz: false, vazA: false, vazB: false, chave: "", chaveB: "", el: null };
          porId.set(id, n);
        } else n.item = item;
        novos.push(n);
      }
      for (const [id, n] of porId) if (!vistos.has(id)) { n.removido = true; novos.push(n); }
      // maiores primeiro, para os pequenos ficarem por cima quando se sobrepõem
      novos.sort((a, b) => (+b.item[op.campoValor] || 0) - (+a.item[op.campoValor] || 0));
      nos = novos;
      versaoDados++;
      cache.clear();
      prepararRender();
    }

    function prepararRender() {
      const vivos = nos.filter((n) => !n.removido).length;
      const querCanvas = op.renderizador === "canvas" || (op.renderizador === "auto" && vivos > op.limiteCanvas);
      if (querCanvas !== usaCanvas || (!canvas && !svgPontos)) {
        if (canvas) canvas.remove();
        if (svgPontos) svgPontos.remove();
        canvas = svgPontos = gPontos = ctx2d = null;
        usaCanvas = querCanvas;
        if (usaCanvas) {
          canvas = document.createElement("canvas");
          palco.insertBefore(canvas, palco.firstChild);
          ctx2d = canvas.getContext("2d");
          for (const n of nos) n.el = null;
        } else {
          svgPontos = document.createElementNS("http://www.w3.org/2000/svg", "svg");
          svgPontos.setAttribute("class", "pm-pontos");
          palco.insertBefore(svgPontos, palco.firstChild);
          gPontos = svgPontos;
        }
        dimensionar();
      }
      if (!usaCanvas) {
        for (const n of nos) {
          if (!n.el) {
            n.el = document.createElementNS("http://www.w3.org/2000/svg", "circle");
            n.el.setAttribute("r", 0);
            gPontos.appendChild(n.el);
          }
        }
        // ordem do desenho igual à da lista
        for (const n of nos) gPontos.appendChild(n.el);
      }
      palco.dataset.render = usaCanvas ? "canvas" : "svg";
    }

    function dimensionar() {
      const r = palco.getBoundingClientRect();
      W = Math.max(50, Math.round(r.width));
      H = Math.max(50, Math.round(r.height));
      dpr = Math.min(2, raiz.devicePixelRatio || 1);
      if (canvas) {
        canvas.width = Math.round(W * dpr);
        canvas.height = Math.round(H * dpr);
      }
      if (svgPontos) svgPontos.setAttribute("viewBox", `0 0 ${W} ${H}`);
      svgGuias.attr("viewBox", `0 0 ${W} ${H}`);
    }

    /* ---- cor ---- */
    function lerTema() {
      corResolvida.clear();
      const cs = getComputedStyle(raizEl);
      const v = (nome) => cs.getPropertyValue(nome).trim();
      cores = { paleta: PALETA_VARS.map(v).filter(Boolean), fundo: v("--pm-fundo") || "#040914", texto: v("--pm-texto") || "#fff" };
      if (!cores.paleta.length) cores.paleta = ["#139FC0", "#D55181", "#C98500", "#9085E9", "#199E70"];
    }
    const corResolvida = new Map();
    function resolverCor(valor) {
      if (typeof valor === "string" && valor.startsWith("var(")) {
        if (!corResolvida.has(valor)) {
          const nome = valor.slice(4, -1).trim();
          corResolvida.set(valor, getComputedStyle(raizEl).getPropertyValue(nome).trim() || "#888");
        }
        return corResolvida.get(valor);
      }
      return valor;
    }
    function specCor(cena) { return cena.cor || op.cor || null; }
    function specVazado(cena) { return cena.vazado !== undefined ? cena.vazado : op.vazado; }
    function ordemCor(spec) {
      if (spec && spec.ordem) return spec.ordem.map(String);
      const s = new Set();
      for (const n of nos) s.add(String(spec ? chaveDe(spec.campo, n.item) : "Todos"));
      return [...s].sort((a, b) => a.localeCompare(b, "pt-BR", { numeric: true }));
    }
    function corPara(spec, chave, ordem) {
      if (spec && spec.cores && spec.cores[chave]) return resolverCor(spec.cores[chave]);
      const i = Math.max(0, ordem.indexOf(chave));
      if (i >= cores.paleta.length && !corPara.avisou) {
        corPara.avisou = true;
        console.warn("pontos.js: mais categorias do que cores na paleta. Junte as menores em \"Outros\".");
      }
      return cores.paleta[i % cores.paleta.length];
    }

    /* ---- layout de uma cena (com cache) ---- */
    function calcular(i) {
      const cena = cenas[i];
      const chave = i + "|" + W + "x" + H + "|" + versaoDados;
      if (cache.has(chave)) return cache.get(chave);
      const t = performance.now();
      const visiveis = nos.filter((n) => !n.removido && (!cena.filtro || cena.filtro(n.item)));
      const spec = specCor(cena), ordem = ordemCor(spec);
      for (const n of visiveis) { n.chaveB = String(spec ? chaveDe(spec.campo, n.item) : "Todos"); n.ordCor = ordem.indexOf(n.chaveB); }
      const fn = LAYOUTS[cena.tipo];
      if (!fn) throw new Error("pontos.js: tipo de cena desconhecido: " + cena.tipo);
      for (const n of visiveis) n.grupo = cena.por ? String(chaveDe(cena.por, n.item)) : "Todos";
      const guias = fn(visiveis, cena, { W, H, op, rng, todos: nos.filter((n) => !n.removido) }) || {};
      const alvo = new Map();
      const vz = specVazado(cena);
      for (const n of visiveis) {
        const vazado = vz ? !!chaveDe(vz, n.item) : false;
        alvo.set(n.id, [n.tx, n.ty, n.tr, corPara(spec, n.chaveB, ordem), vazado, n.chaveB]);
      }
      const res = { alvo, guias, legenda: montarLegenda(visiveis, spec, ordem, vz, cena) };
      metricas.layoutMs.push(performance.now() - t);
      cache.set(chave, res);
      return res;
    }

    function montarLegenda(visiveis, spec, ordem, vz, cena) {
      if (!spec && !cena.legendaExtra) return [];
      const cont = new Map();
      for (const n of visiveis) {
        const k = n.chaveB;
        const e = cont.get(k) || { n: 0, vaz: 0 };
        e.n++;
        if (vz && chaveDe(vz, n.item)) e.vaz++;
        cont.set(k, e);
      }
      const itens = spec ? ordem.filter((k) => cont.has(k)).map((k) => ({ chave: k, cor: corPara(spec, k, ordem), n: cont.get(k).n, vazado: cont.get(k).vaz === cont.get(k).n })) : [];
      for (const ex of cena.legendaExtra || []) itens.push({ chave: ex.rotulo, cor: resolverCor(ex.cor || cores.paleta[0]), vazado: !!ex.vazado, fixo: true });
      return itens;
    }

    /* ---- transição ---- */
    function ir(i, opc) {
      i = Math.max(0, Math.min(cenas.length - 1, i));
      const mudou = i !== indice;
      indice = i;
      const cena = cenas[i];
      const res = calcular(i);
      const d = reduzMovimento ? 0 : (opc && opc.duracao !== undefined ? opc.duracao : (cena.duracao || op.duracao));
      const fracEsc = opc && opc.semEscalonar ? 0 : op.escalonamento;
      for (const n of nos) {
        n.sx = n.cx; n.sy = n.cy; n.sr = n.cr; n.so = n.co;
        n.corA = n.cor; n.vazA = n.vaz;
        const a = res.alvo.get(n.id);
        if (a) {
          [n.tx, n.ty, n.tr, n.corB, n.vazB, n.chave] = a;
          n.to = 1;
          if (n.co < 0.02) { // nasce no lugar certo, crescendo
            n.sx = n.tx; n.sy = n.ty; n.sr = 0; n.so = 0; n.corA = n.corB; n.vazA = n.vazB;
          }
        } else { // some no lugar onde está, encolhendo
          n.tx = n.cx; n.ty = n.cy; n.tr = 0; n.to = 0; n.corB = n.cor; n.vazB = n.vaz;
        }
        const xRef = a ? n.tx : n.cx;
        n.atraso = (0.65 * (W ? xRef / W : 0) + 0.35 * rng()) * fracEsc * d;
        n.fim = false;
      }
      dur = d;
      desenharGuias(res.guias, d);
      atualizarTextos(i, res);
      metricas.transicoes++;
      t0 = performance.now();
      if (d === 0) { avancar(Infinity); desenhar(); animando = false; }
      else if (!animando) { animando = true; ultimoQuadro = 0; requestAnimationFrame(quadro); }
      if (mudou && typeof op.aoMudarCena === "function") op.aoMudarCena(i, cena);
      agendarRoteiro();
      raizEl.dispatchEvent(new CustomEvent("pontos:cena", { detail: { indice: i, cena } }));
    }

    // calcula a próxima cena com o navegador ocioso, para o clique seguinte sair na hora
    function aquecer(i) {
      if (i < 0 || i >= cenas.length) return;
      const fazer = () => { if (!animando) calcular(i); };
      if (raiz.requestIdleCallback) raiz.requestIdleCallback(fazer, { timeout: 800 });
      else setTimeout(fazer, 60);
    }

    function avancar(T) {
      let todos = true;
      const span = dur * (1 - op.escalonamento) || 1;
      for (const n of nos) {
        if (n.fim) continue;
        let lt = (T - n.atraso) / span;
        if (lt >= 1 || !Number.isFinite(lt)) { lt = 1; n.fim = true; } else { todos = false; if (lt < 0) lt = 0; }
        const e = facil(lt);
        n.cx = n.sx + (n.tx - n.sx) * e;
        n.cy = n.sy + (n.ty - n.sy) * e;
        n.cr = n.sr + (n.tr - n.sr) * e;
        n.co = n.so + (n.to - n.so) * e;
        n.cor = lt < 0.5 ? n.corA : n.corB;
        n.vaz = lt < 0.5 ? n.vazA : n.vazB;
        n.sujo = true;
      }
      return todos;
    }

    function quadro(agora) {
      if (ultimoQuadro) {
        metricas.quadros.push(agora - ultimoQuadro);
        if (metricas.quadros.length > 4000) metricas.quadros.shift();
      }
      ultimoQuadro = agora;
      const terminou = avancar(agora - t0);
      const td = performance.now();
      desenhar();
      metricas.desenhoMs.push(performance.now() - td);
      if (metricas.desenhoMs.length > 4000) metricas.desenhoMs.shift();
      if (terminou) {
        animando = false;
        aquecer(indice + 1);
        raizEl.dispatchEvent(new CustomEvent("pontos:parado", { detail: { indice } }));
      } else requestAnimationFrame(quadro);
    }

    /* ---- desenho ---- */
    function alfa(n) {
      return n.co * (destaque !== null && n.chave !== destaque ? 0.12 : 1);
    }
    function desenhar(tudo) {
      if (usaCanvas) {
        const c = ctx2d;
        c.setTransform(dpr, 0, 0, dpr, 0, 0);
        c.clearRect(0, 0, W, H);
        c.lineJoin = "round";
        for (const n of nos) {
          if (n.co < 0.01 || n.cr < 0.08) continue;
          const a = alfa(n);
          c.globalAlpha = a * 0.92;
          c.beginPath();
          if (n.vaz) {
            const lw = Math.max(0.8, Math.min(1.6, n.cr * 0.38));
            c.arc(n.cx, n.cy, Math.max(0.3, n.cr - lw / 2), 0, TAU);
            c.lineWidth = lw;
            c.strokeStyle = n.cor;
            c.stroke();
          } else {
            c.arc(n.cx, n.cy, n.cr, 0, TAU);
            c.fillStyle = n.cor;
            c.fill();
            if (n.cr > 2.6) { // anel fino da cor do fundo separa pontos sobrepostos
              c.lineWidth = 0.8;
              c.strokeStyle = cores.fundo;
              c.stroke();
            }
          }
        }
        c.globalAlpha = 1;
      } else {
        for (const n of nos) {
          if (!n.sujo && !tudo) continue;
          n.sujo = false;
          const e = n.el;
          if (n.co < 0.01 || n.cr < 0.08) { e.setAttribute("r", 0); continue; }
          e.setAttribute("cx", n.cx.toFixed(1));
          e.setAttribute("cy", n.cy.toFixed(1));
          if (n.vaz) {
            const lw = Math.max(0.8, Math.min(1.6, n.cr * 0.38));
            e.setAttribute("r", Math.max(0.3, n.cr - lw / 2).toFixed(2));
            e.setAttribute("fill", "none");
            e.setAttribute("stroke", n.cor);
            e.setAttribute("stroke-width", lw.toFixed(2));
          } else {
            e.setAttribute("r", n.cr.toFixed(2));
            e.setAttribute("fill", n.cor);
            e.setAttribute("stroke", n.cr > 2.6 ? cores.fundo : "none");
            e.setAttribute("stroke-width", 0.8);
          }
          e.setAttribute("opacity", (alfa(n) * 0.92).toFixed(3));
        }
      }
    }

    function desenharGuias(g, d) {
      const tSai = Math.min(250, d * 0.25), tEntra = Math.min(450, d * 0.35);
      if (gGuiaAtual) {
        const velho = gGuiaAtual;
        if (d) velho.transition().duration(tSai).attr("opacity", 0).remove();
        else velho.remove();
      }
      const novo = svgGuias.insert("g", ":first-child").attr("opacity", d ? 0 : 1);
      gGuiaAtual = novo;
      for (const l of g.linhas || []) {
        novo.append("line").attr("class", "pm-base").attr("x1", l.x1).attr("x2", l.x2).attr("y1", l.y1).attr("y2", l.y2)
          .attr("stroke-dasharray", l.tracejada ? "4 4" : null);
      }
      if (g.eixoX) {
        const e = g.eixoX;
        const ax = d3.axisBottom(e.escala).ticks(W < 520 ? 4 : 8).tickSizeOuter(0);
        if (e.formato) ax.tickFormat(e.formato);
        novo.append("g").attr("transform", `translate(0,${e.y})`).call(ax);
        if (e.titulo) novo.append("text").attr("class", "pm-eixo-titulo").attr("x", e.x1).attr("y", e.y + 34).attr("text-anchor", "end").text(e.titulo);
      }
      if (g.eixoY) {
        const e = g.eixoY;
        const ay = d3.axisLeft(e.escala).ticks(H < 420 ? 4 : 6).tickSizeOuter(0);
        if (e.formato) ay.tickFormat(e.formato);
        novo.append("g").attr("transform", `translate(${e.x},0)`).call(ay);
        if (e.titulo) novo.append("text").attr("class", "pm-eixo-titulo").attr("x", e.x + 8).attr("y", e.y0 + 4).attr("text-anchor", "start").text(e.titulo);
      }
      novo.selectAll(".tick text").attr("class", null);
      for (const r of g.rotulos || []) {
        const tx = novo.append("text").attr("x", r.x).attr("y", r.y).attr("text-anchor", r.ancora || "middle").attr("class", r.classe || null);
        const linhas = r.t !== undefined ? String(r.t).split("\n") : [];
        linhas.forEach((s, j) => {
          const ts = tx.append("tspan").text(s + (j === linhas.length - 1 && r.num !== undefined ? " " : ""));
          if (j > 0) ts.attr("x", r.x).attr("dy", "1.2em");
          else if (r.centroV && linhas.length > 1) ts.attr("dy", (-(linhas.length - 1) * 0.6) + "em");
        });
        if (r.num !== undefined) {
          const chaveNum = r.chaveNum || r.t;
          const de = ultimoNum.has(chaveNum) ? ultimoNum.get(chaveNum) : 0;
          const sp = tx.append("tspan").attr("class", "pm-num").text(nf.format(d ? de : r.num));
          ultimoNum.set(chaveNum, r.num);
          if (d && de !== r.num) {
            sp.transition().delay(d * 0.3).duration(Math.max(300, d * 0.65)).ease(d3.easeCubicOut)
              .tween("text", function () {
                const f = d3.interpolateNumber(de, r.num);
                return (t) => { this.textContent = nf.format(Math.round(f(t))); };
              });
          } else sp.text(nf.format(r.num));
        }
      }
      if (d) novo.transition().delay(d * 0.35).duration(tEntra).attr("opacity", 1);
    }

    function atualizarTextos(i, res) {
      const cena = cenas[i];
      preencherCabeca(i);
      palco.setAttribute("aria-label", (cena.titulo || "") + ". " + (cena.texto || ""));
      desenharLegenda(res.legenda);
      bolinhas.forEach((b, j) => b.setAttribute("aria-current", j === i ? "true" : "false"));
      btAnt.disabled = i === 0;
      btProx.disabled = i === cenas.length - 1 && !op.repetirRoteiro;
      esconderDica();
    }
    function preencherCabeca(i) {
      const cena = cenas[i];
      passoEl.textContent = String(i + 1).padStart(2, "0") + " / " + String(cenas.length).padStart(2, "0");
      tituloEl.textContent = cena.titulo || "";
      textoEl.textContent = cena.texto || "";
    }
    function desenharLegenda(itens) {
      legenda.innerHTML = "";
      if (destaque !== null && !itens.some((it) => it.chave === destaque)) destaque = null;
      legenda.classList.toggle("filtrando", destaque !== null);
      for (const it of itens) {
        const b = el("button", "pm-chip" + (it.fixo ? " fixo" : ""), legenda);
        b.type = "button";
        const bolinha = el("i", it.vazado ? "vazado" : "", b);
        bolinha.style.background = it.cor;
        bolinha.style.color = it.cor;
        el("span", "", b).textContent = it.chave;
        if (it.n !== undefined) el("em", "", b).textContent = nf.format(it.n);
        if (it.fixo) { b.tabIndex = -1; b.setAttribute("aria-hidden", "true"); continue; }
        b.setAttribute("aria-pressed", destaque === it.chave ? "true" : "false");
        b.title = "Destacar " + it.chave;
        b.addEventListener("click", () => {
          destaque = destaque === it.chave ? null : it.chave;
          legenda.classList.toggle("filtrando", destaque !== null);
          legenda.querySelectorAll(".pm-chip:not(.fixo)").forEach((x) => x.setAttribute("aria-pressed", x === b && destaque !== null ? "true" : "false"));
          desenhar(true);
        });
      }
    }

    // reserva a altura da maior legenda e do maior texto, para o palco não mudar de tamanho entre cenas
    function fixarAlturas() {
      cabeca.style.minHeight = legenda.style.minHeight = "";
      let hc = 0, hl = 0;
      const atual = indice;
      cenas.forEach((cena, i) => {
        preencherCabeca(i);
        hc = Math.max(hc, cabeca.offsetHeight);
        const spec = specCor(cena), ordem = ordemCor(spec);
        const vis = nos.filter((n) => !n.removido && (!cena.filtro || cena.filtro(n.item)));
        for (const n of vis) n.chaveB = String(spec ? chaveDe(spec.campo, n.item) : "Todos");
        desenharLegenda(montarLegenda(vis, spec, ordem, specVazado(cena), cena));
        hl = Math.max(hl, legenda.offsetHeight);
      });
      cabeca.style.minHeight = hc + "px";
      legenda.style.minHeight = hl + "px";
      if (atual >= 0) {
        preencherCabeca(atual);
        desenharLegenda(calcularLegendaAtual());
      }
    }
    function calcularLegendaAtual() {
      const cena = cenas[indice];
      const spec = specCor(cena), ordem = ordemCor(spec);
      const vis = nos.filter((n) => !n.removido && (!cena.filtro || cena.filtro(n.item)));
      for (const n of vis) n.chaveB = String(spec ? chaveDe(spec.campo, n.item) : "Todos");
      return montarLegenda(vis, spec, ordem, specVazado(cena), cena);
    }

    /* ---- dica ao tocar no ponto ---- */
    function pontoPerto(x, y, folga) {
      let melhor = null, md = Infinity;
      for (const n of nos) {
        if (n.co < 0.5 || n.cr < 0.3 || (destaque !== null && n.chave !== destaque)) continue;
        const dx = n.cx - x, dy = n.cy - y;
        const d2 = dx * dx + dy * dy;
        const lim = (n.cr + folga) * (n.cr + folga);
        if (d2 <= lim && d2 - n.cr * n.cr < md) { md = d2 - n.cr * n.cr; melhor = n; }
      }
      return melhor;
    }
    function textoDica(item) {
      const cena = cenas[indice];
      if (typeof cena.dica === "function") return cena.dica(item, cena);
      if (typeof op.dica === "function") return op.dica(item, cena);
      const v = item[op.campoValor];
      return `<b>${esc(item.nome || item.id)}</b>` + (item.categoria !== undefined ? `<br><span>${esc(item.categoria)}</span>` : "") +
        (v !== undefined ? `<br><span>valor</span> ${esc(nf.format(v))}` : "");
    }
    function mostrarDica(n) {
      dica.innerHTML = textoDica(n.item);
      dica.classList.add("on");
      const lw = dica.offsetWidth, lh = dica.offsetHeight;
      let x = n.cx + n.cr + 10, y = n.cy - lh - 6;
      if (x + lw > W - 6) x = n.cx - n.cr - 10 - lw;
      if (x < 6) x = Math.max(6, Math.min(W - lw - 6, n.cx - lw / 2));
      if (y < 6) y = n.cy + n.cr + 10;
      if (y + lh > H - 6) y = H - lh - 6;
      dica.style.left = x + "px";
      dica.style.top = y + "px";
      gFoco.selectAll("circle").data([n]).join("circle").attr("class", "pm-foco")
        .attr("cx", n.cx).attr("cy", n.cy).attr("r", n.cr + 3);
    }
    function esconderDica() {
      dica.classList.remove("on");
      gFoco.selectAll("circle").remove();
    }
    function coordenadas(ev) {
      const r = palco.getBoundingClientRect();
      return [ev.clientX - r.left, ev.clientY - r.top];
    }
    palco.addEventListener("pointermove", (ev) => {
      if (ev.pointerType !== "mouse" || animando) return;
      const [x, y] = coordenadas(ev);
      const n = pontoPerto(x, y, 4);
      n ? mostrarDica(n) : esconderDica();
    });
    palco.addEventListener("pointerleave", (ev) => { if (ev.pointerType === "mouse") esconderDica(); });
    let toque = null;
    palco.addEventListener("pointerdown", (ev) => { toque = { x: ev.clientX, y: ev.clientY, t: performance.now() }; });
    palco.addEventListener("pointerup", (ev) => {
      if (!toque) return;
      const dx = ev.clientX - toque.x, dy = ev.clientY - toque.y;
      toque = null;
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) { // arrastar para o lado troca de cena
        pararRoteiro();
        dx < 0 ? proxima() : anterior();
        return;
      }
      if (ev.pointerType !== "mouse" && Math.abs(dx) < 10 && Math.abs(dy) < 10) {
        const [x, y] = coordenadas(ev);
        const n = pontoPerto(x, y, 12);
        n ? mostrarDica(n) : esconderDica();
      }
    });

    /* ---- controles ---- */
    const ICONES = {
      ant: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M10 3 5 8l5 5"/></svg>',
      prox: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8"><path d="m6 3 5 5-5 5"/></svg>',
      play: '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M4 2.5v11l9-5.5z"/></svg>',
      pausa: '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M4 2.5h3v11H4zM9 2.5h3v11H9z"/></svg>',
      cheia: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4"/></svg>',
    };
    function botao(html, rotulo, fn) {
      const b = el("button", "pm-btn", controles);
      b.type = "button";
      b.innerHTML = html;
      b.setAttribute("aria-label", rotulo);
      b.title = rotulo;
      b.addEventListener("click", fn);
      return b;
    }
    const btAnt = botao(ICONES.ant, "Cena anterior (seta para a esquerda)", () => { pararRoteiro(); anterior(); });
    const caixaBol = el("div", "pm-bolinhas", controles);
    const bolinhas = cenas.map((c, i) => {
      const b = el("button", "pm-bolinha", caixaBol);
      b.type = "button";
      b.setAttribute("aria-label", "Ir para a cena " + (i + 1) + ": " + (c.titulo || ""));
      b.addEventListener("click", () => { pararRoteiro(); ir(i); });
      return b;
    });
    const btProx = botao(ICONES.prox, "Próxima cena (seta para a direita)", () => { pararRoteiro(); proxima(); });
    const btRot = botao(ICONES.play, "Roteiro automático (tecla P)", () => roteiro(!roteiroLigado));
    btRot.setAttribute("aria-pressed", "false");
    let btCheia = null;
    if (document.fullscreenEnabled) btCheia = botao(ICONES.cheia, "Modo apresentação, tela cheia (tecla F)", telaCheia);
    const progresso = el("div", "pm-progresso", raizEl);
    const barraProg = el("i", "", progresso);

    function proxima() {
      if (indice < cenas.length - 1) ir(indice + 1);
      else if (op.repetirRoteiro) ir(0);
    }
    function anterior() { if (indice > 0) ir(indice - 1); }
    function agendarRoteiro() {
      clearTimeout(temporizadorRoteiro);
      if (animProgresso) { animProgresso.cancel(); animProgresso = null; }
      if (!roteiroLigado) return;
      if (indice >= cenas.length - 1 && !op.repetirRoteiro) { roteiro(false); return; }
      const espera = (cenas[indice].intervalo || op.intervaloRoteiro) + dur;
      if (barraProg.animate && !reduzMovimento) animProgresso = barraProg.animate([{ width: "0%" }, { width: "100%" }], { duration: espera, easing: "linear" });
      temporizadorRoteiro = setTimeout(proxima, espera);
    }
    function roteiro(liga) {
      roteiroLigado = liga === undefined ? true : !!liga;
      btRot.innerHTML = roteiroLigado ? ICONES.pausa : ICONES.play;
      btRot.setAttribute("aria-pressed", roteiroLigado ? "true" : "false");
      if (roteiroLigado && indice >= cenas.length - 1) ir(0);
      else agendarRoteiro();
    }
    function pararRoteiro() { if (roteiroLigado) roteiro(false); }
    function telaCheia() {
      const alvoTC = op.telaCheiaAlvo || document.documentElement;
      if (document.fullscreenElement) document.exitFullscreen();
      else if (alvoTC.requestFullscreen) alvoTC.requestFullscreen().catch(() => {});
    }
    function teclas(ev) {
      if (ev.defaultPrevented || ev.altKey || ev.ctrlKey || ev.metaKey) return;
      const tag = (ev.target && ev.target.tagName) || "";
      if (/INPUT|TEXTAREA|SELECT/.test(tag)) return;
      const k = ev.key;
      if (k === "ArrowRight" || k === "PageDown" || (k === " " && tag !== "BUTTON")) { pararRoteiro(); proxima(); }
      else if (k === "ArrowLeft" || k === "PageUp") { pararRoteiro(); anterior(); }
      else if (k === "Home") { pararRoteiro(); ir(0); }
      else if (k === "End") { pararRoteiro(); ir(cenas.length - 1); }
      else if (k === "p" || k === "P") roteiro(!roteiroLigado);
      else if (k === "f" || k === "F") telaCheia();
      else if (k === "Escape") { esconderDica(); pararRoteiro(); }
      else return;
      ev.preventDefault();
    }
    if (op.teclado) document.addEventListener("keydown", teclas);

    /* ---- redimensionar ---- */
    let espera = null, ultimaLarg = 0;
    const ro = new ResizeObserver(() => {
      clearTimeout(espera);
      espera = setTimeout(() => {
        const larg = raizEl.clientWidth;
        if (Math.abs(larg - ultimaLarg) > 1) { ultimaLarg = larg; fixarAlturas(); }
        const r = palco.getBoundingClientRect();
        if (Math.abs(r.width - W) < 2 && Math.abs(r.height - H) < 2) return;
        dimensionar();
        cache.clear();
        for (const n of nos) n.sujo = true;
        if (indice >= 0) ir(indice, { duracao: 420, semEscalonar: true });
      }, 140);
    });

    /* ---- início ---- */
    lerTema();
    montarNos(op.itens || []);
    ultimaLarg = raizEl.clientWidth;
    fixarAlturas();
    dimensionar();
    ro.observe(palco);
    ro.observe(raizEl);
    ir(op.inicio || 0);

    const api = {
      ir: (i) => { pararRoteiro(); ir(i); },
      proxima, anterior, roteiro, telaCheia,
      get cenaAtual() { return indice; },
      get totalCenas() { return cenas.length; },
      get animando() { return animando; },
      get renderizador() { return usaCanvas ? "canvas" : "svg"; },
      metricas,
      // posição atual dos pontos visíveis (útil para teste e para anotar a tela)
      pontos() {
        return nos.filter((n) => n.co > 0.5 && n.cr > 0.3).map((n) => ({ id: n.id, x: n.cx, y: n.cy, r: n.cr, item: n.item }));
      },
      // troca os dados: ids novos nascem, ids que saíram somem, os outros se movem
      atualizar(itens) { montarNos(itens); fixarAlturas(); ir(indice); },
      // relê as variáveis CSS depois de trocar o tema
      tema() {
        lerTema(); cache.clear();
        const res = calcular(indice);
        for (const n of nos) {
          const a = res.alvo.get(n.id);
          if (a) n.cor = n.corA = n.corB = a[3];
          n.sujo = true;
        }
        desenharLegenda(res.legenda);
        desenhar(true);
      },
      destacar(chave) { destaque = chave === undefined ? null : chave; desenharLegenda(calcularLegendaAtual()); desenhar(true); },
      destruir() {
        ro.disconnect();
        clearTimeout(temporizadorRoteiro);
        document.removeEventListener("keydown", teclas);
        raizEl.innerHTML = "";
        raizEl.classList.remove("pm");
      },
    };
    return api;
  }

  raiz.Pontos = { criar, layouts: LAYOUTS, versao: "0.1.0" };
})(typeof window !== "undefined" ? window : this);
