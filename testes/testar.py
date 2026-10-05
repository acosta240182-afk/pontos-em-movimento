"""Teste dos exemplos com Playwright.

Abre os dois exemplos em 1440x900 e 390x844, passa por todas as cenas, guarda um print
de cada cena em _prints/ e confere: erro de console, rolagem horizontal, texto vazando
do bloco, rótulo cortado pela borda do palco, dica (tooltip) aparecendo e tempo de quadro.

Uso:  python testes/testar.py            (Chromium com a placa de vídeo, como no uso real)
      python testes/testar.py --software (renderização por software, o pior caso)
"""
import json
import statistics
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

RAIZ = Path(__file__).resolve().parent.parent
PRINTS = RAIZ / "_prints"
PRINTS.mkdir(exist_ok=True)

PAGINAS = [("exemplo", "exemplo.html", ""), ("anos", "exemplo-anos.html", "")]
TELAS = [("1440x900", 1440, 900, False), ("390x844", 390, 844, True)]
EXTRA = [("exemplo-svg", "exemplo.html", "?render=svg")]  # 3.000 pontos forçados em SVG, só para comparar

CHECAGEM = """
() => {
  const palco = document.querySelector('.pm-palco').getBoundingClientRect();
  const problemas = [];
  if (document.documentElement.scrollWidth > innerWidth + 1) problemas.push('rolagem horizontal na página');
  for (const sel of ['.pm-titulo', '.pm-texto', '.pm-chip', 'header h1', 'footer div', '.pm-controles']) {
    document.querySelectorAll(sel).forEach(e => {
      if (e.scrollWidth > e.clientWidth + 1) problemas.push('texto vazando em ' + sel + ': ' + e.textContent.slice(0, 40));
    });
  }
  const app = document.querySelector('.app').getBoundingClientRect();
  if (app.bottom > innerHeight + 1) problemas.push('página passa da altura da tela');
  document.querySelectorAll('.pm-guias > g:first-child text').forEach(t => {
    const b = t.getBoundingClientRect();
    if (!b.width) return;
    if (b.left < palco.left - 1 || b.right > palco.right + 1 || b.top < palco.top - 1 || b.bottom > palco.bottom + 1)
      problemas.push('rótulo cortado pela borda: ' + t.textContent);
  });
  // pontos fora do palco
  const fora = window.pm.pontos().filter(p => p.x + p.r < 0 || p.y + p.r < 0 || p.x - p.r > palco.width || p.y - p.r > palco.height).length;
  if (fora) problemas.push(fora + ' pontos fora do palco');
  return problemas;
}
"""


def esperar_parar(page):
    page.wait_for_function("() => window.pm && !window.pm.animando", timeout=15000)
    page.wait_for_timeout(600)  # guias terminam o fade


def resumo_quadros(q):
    if not q:
        return {}
    q = sorted(q)
    media = statistics.mean(q)
    return {
        "quadros": len(q),
        "media_ms": round(media, 2),
        "p95_ms": round(q[int(len(q) * 0.95) - 1], 2),
        "max_ms": round(q[-1], 2),
        "fps_medio": round(1000 / media, 1),
    }


def rodar():
    relatorio = []
    falhou = False
    with sync_playwright() as p:
        software = "--software" in sys.argv
        args = [] if software else ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"]
        nav = p.chromium.launch(args=args)
        print("modo:", "software" if software else "placa de vídeo")
        casos = [(n, a, q, t) for (n, a, q) in PAGINAS for t in TELAS] + [(n, a, q, TELAS[0]) for (n, a, q) in EXTRA]
        for nome, arquivo, query, (tela, w, h, movel) in casos:
            ctx = nav.new_context(viewport={"width": w, "height": h}, device_scale_factor=1, has_touch=movel, is_mobile=movel)
            page = ctx.new_page()
            erros = []
            page.on("console", lambda m: erros.append(m.text) if m.type == "error" else None)
            page.on("pageerror", lambda e: erros.append(str(e)))
            page.goto((RAIZ / arquivo).as_uri() + query)
            esperar_parar(page)
            total = page.evaluate("pm.totalCenas")
            caso = {"pagina": nome, "tela": tela, "render": page.evaluate("pm.renderizador"), "cenas": total, "problemas": []}
            for i in range(total):
                if i > 0:
                    page.keyboard.press("ArrowRight")
                    page.wait_for_timeout(50)
                    esperar_parar(page)
                assert page.evaluate("pm.cenaAtual") == i, "a seta não trocou a cena"
                if not query and "--software" not in sys.argv:
                    page.screenshot(path=str(PRINTS / f"{nome}_{tela}_cena{i + 1}.png"))
                for prob in page.evaluate(CHECAGEM):
                    caso["problemas"].append(f"cena {i + 1}: {prob}")
            # dica: toca/passa num ponto visível do meio da lista
            pt = page.evaluate("(() => { const p = pm.pontos(); const a = p[Math.floor(p.length / 2)]; const r = document.querySelector('.pm-palco').getBoundingClientRect(); return {x: r.left + a.x, y: r.top + a.y}; })()")
            if movel:
                page.touchscreen.tap(pt["x"], pt["y"])
            else:
                page.mouse.move(pt["x"], pt["y"])
            page.wait_for_timeout(250)
            caso["dica_ok"] = page.evaluate("document.querySelector('.pm-dica').classList.contains('on')")
            if not query and "--software" not in sys.argv:
                page.screenshot(path=str(PRINTS / f"{nome}_{tela}_dica.png"))
            # volta ao início pelo Home e mede o roteiro automático por 2 cenas
            page.keyboard.press("Home")
            esperar_parar(page)
            page.keyboard.press("p")
            page.wait_for_function("pm.cenaAtual >= 1", timeout=20000)
            caso["roteiro_ok"] = True
            page.keyboard.press("p")
            m = page.evaluate("pm.metricas")
            caso["quadro"] = resumo_quadros(m["quadros"])
            caso["desenho_ms_medio"] = round(statistics.mean(m["desenhoMs"]), 2) if m["desenhoMs"] else None
            caso["layout_ms_max"] = round(max(m["layoutMs"]), 1) if m["layoutMs"] else None
            caso["erros_console"] = erros
            if erros or caso["problemas"] or not caso["dica_ok"]:
                falhou = True
            relatorio.append(caso)
            ctx.close()
        nav.close()
    (PRINTS / ("relatorio_teste_software.json" if "--software" in sys.argv else "relatorio_teste.json")).write_text(json.dumps(relatorio, ensure_ascii=False, indent=2), encoding="utf-8")
    for c in relatorio:
        print(f"{c['pagina']:12} {c['tela']:9} {c['render']:6} cenas={c['cenas']} "
              f"fps={c['quadro'].get('fps_medio')} p95={c['quadro'].get('p95_ms')}ms desenho={c['desenho_ms_medio']}ms "
              f"layout_max={c['layout_ms_max']}ms dica={c['dica_ok']} erros={len(c['erros_console'])} problemas={len(c['problemas'])}")
        for prob in c["problemas"] + c["erros_console"]:
            print("   ", prob)
    print("VEREDITO:", "FALHOU" if falhou else "OK")
    return 1 if falhou else 0


if __name__ == "__main__":
    sys.exit(rodar())
