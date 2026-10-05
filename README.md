# Pontos em movimento

Um unit chart que se transforma. Cada item vira um ponto, e os pontos escorregam de um arranjo para outro: começam desenhando um mapa, se juntam em grupos, viram barras, deslizam até um eixo. Quando o total muda, pontos nascem e somem na frente de quem está olhando.

É uma biblioteca pequena em JavaScript puro com D3 v7, sem build. Abriu o HTML, funciona.

Veja rodando, direto no navegador:

- [Exemplo das lojas](https://acosta240182-afk.github.io/pontos-em-movimento/exemplo.html)
- [Exemplo dos anos e cenários](https://acosta240182-afk.github.io/pontos-em-movimento/exemplo-anos.html)

## Como usar

```html
<link rel="stylesheet" href="pontos.css">
<div id="palco" style="height: 90vh"></div>
<script src="https://cdn.jsdelivr.net/npm/d3@7.9.0/dist/d3.min.js"></script>
<script src="pontos.js"></script>
<script>
  const itens = [{ id: 1, valor: 120, regiao: "Norte", x: 3, y: 7 } /* ... */];
  const cenas = [{ tipo: "mapa", titulo: "Onde estão" }, { tipo: "agrupar", por: "regiao", titulo: "Por região" }];
  const pm = Pontos.criar("#palco", { itens, cenas, cor: { campo: "regiao" } });
</script>
```

Cada item precisa de `id`. O resto é livre: `valor` dá o tamanho do ponto, `x` e `y` servem para o mapa, e qualquer outro campo pode virar grupo, eixo ou cor.

## Cenas disponíveis

| tipo | o que faz |
|---|---|
| `amontoado` | todos os pontos juntos num bolo só |
| `agrupar` | um bolo por grupo (`por: "campo"`), com o total em cima |
| `grade` | um bloco quadrado de pontos iguais por grupo, um ponto por item |
| `barras` | barras feitas de pontos iguais, em pé ou deitadas (`orientacao: "vertical"`, `"horizontal"` ou `"auto"`) |
| `eixo` | cada ponto desliza até o seu valor num eixo numérico e os parecidos se empilham (beeswarm) |
| `dispersao` | X contra Y, com linha de referência opcional |
| `mapa` | posição fixa a partir de `x` e `y`, mantendo a proporção |

Opções úteis em qualquer cena: `filtro(item)` (quem aparece; quem sai some encolhendo e quem entra nasce crescendo), `cor`, `vazado` (ponto só com contorno, bom para valor estimado), `tamanho: "unidade"` (todos do mesmo tamanho), `ordem`, `rotuloGrupo`, `rotulos`, `legendaExtra`, `duracao`.

## O que vem pronto

- Botões, bolinhas de cena e teclado: setas, PageUp e PageDown, Home, End, `P` liga o roteiro automático e `F` abre a tela cheia.
- No celular, arrastar o dedo para o lado troca de cena e tocar no ponto mostra a dica.
- Clicar num item da legenda destaca aquela categoria.
- Acima de 1.000 pontos o desenho passa para Canvas (`limiteCanvas`), porque SVG com milhares de círculos animados perde fluidez.
- Respeita `prefers-reduced-motion`: quem pediu menos movimento vê a troca direta.
- Tema por variáveis CSS (`--pm-fundo`, `--pm-texto`, `--pm-c1` a `--pm-c5` e outras em `pontos.css`). O padrão é escuro, estilo HUD, e há um tema claro em `[data-tema="claro"]`. As duas paletas passaram em teste de contraste e de separação para daltonismo.

## Exemplos

- `exemplo.html`: 3.000 lojas fictícias em seis cenas (mapa, regiões, porte, barras, satisfação e dispersão).
- `exemplo-anos.html`: 1 ponto = 1 unidade vendida, de 2023 a 2026 com os meses estimados vazados, e três cenários para 2027 se abrindo.

Todos os dados são inventados no próprio navegador, com semente fixa.

## Teste

`python testes/testar.py` abre os dois exemplos em 1440x900 e 390x844 com Playwright, passa por todas as cenas, guarda os prints em `_prints/` (fora do git) e confere erro de console, texto vazando, rótulo cortado, dica e tempo de quadro.

## Créditos

A ideia de pontos que desenham um mapa e depois se reorganizam veio de um reel do [@tonycelestino](https://www.instagram.com/reel/DeHeTlWxZnA/) sobre a eleição de 2026. Só a ideia: o código aqui foi escrito do zero.

## Licença

MIT. Veja o arquivo `LICENSE`.
