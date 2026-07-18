// Especificación del serializador SVG.
//
// Dos cosas justifican testear algo tan chico con esta intensidad.
//
// **Inyección.** Los `clusterId` derivan de firmas que en la arena vienen de
// usuarios y terminan como atributos de un SVG montado en el DOM. Los tests de
// escapeo de acá son de seguridad, no de formato.
//
// **Determinismo del string.** El render se verifica comparando SVG byte a byte
// sin rasterizar (ADR 0007); eso solo funciona si el serializador es estable.

import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { el, escapeText, pointsAttr, svg, text, type Attrs } from "./svg.js";

describe("escapeText — la frontera de inyección", () => {
  it("neutraliza los caracteres que abren o cierran markup", () => {
    expect(escapeText("<script>")).toBe("&lt;script&gt;");
    expect(escapeText('a"b')).toBe("a&quot;b");
    expect(escapeText("a'b")).toBe("a&apos;b");
    expect(escapeText("a&b")).toBe("a&amp;b");
  });

  // Si `&` se escapara al final, `&lt;` volvería a escaparse a `&amp;lt;`.
  it("escapa el ampersand primero, sin re-escapar lo ya escapado", () => {
    expect(escapeText("<")).toBe("&lt;");
    expect(escapeText("&lt;")).toBe("&amp;lt;");
  });

  it("no deja pasar ningún carácter peligroso, sea cual sea la entrada", () => {
    fc.assert(
      fc.property(fc.string(), (raw) => {
        const escaped = escapeText(raw);
        expect(escaped).not.toMatch(/[<>"']/);
      }),
    );
  });

  it("deja intacto el texto que no tiene nada que escapar", () => {
    expect(escapeText("cluster-fuego-42")).toBe("cluster-fuego-42");
  });
});

describe("el — elementos", () => {
  it("auto-cierra los elementos sin hijos", () => {
    expect(el("circle", { r: 5 })).toBe('<circle r="5"/>');
    expect(el("g")).toBe("<g/>");
  });

  it("anida los hijos tal cual, sin escaparlos", () => {
    expect(el("g", { id: "ente" }, [el("circle", { r: 1 })])).toBe(
      '<g id="ente"><circle r="1"/></g>',
    );
  });

  it("formatea los números con la precisión de svgNumber", () => {
    expect(el("circle", { r: 1 / 3 })).toBe('<circle r="0.333"/>');
    expect(el("circle", { cx: -0 })).toBe('<circle cx="0"/>');
  });

  // Para poder escribir `opacity: adapted && 0.8` sin un `if` alrededor.
  it("omite los atributos false, null y undefined", () => {
    expect(el("g", { a: false, b: null, c: undefined, d: "x" })).toBe('<g d="x"/>');
  });

  it("emite los atributos true como vacíos", () => {
    expect(el("g", { hidden: true })).toBe('<g hidden=""/>');
  });

  it("no deja espacio colgando cuando no hay atributos que emitir", () => {
    expect(el("g", { a: undefined })).toBe("<g/>");
  });

  // El vector de inyección real: un clusterId hostil como valor de atributo.
  it("escapa los valores de atributo", () => {
    const hostil = '"><script>alert(1)</script><g id="';
    const out = el("g", { id: hostil });
    expect(out).not.toContain("<script>");
    expect(out).toBe(
      '<g id="&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;&lt;g id=&quot;"/>',
    );
  });

  it("mantiene el orden de inserción de los atributos", () => {
    expect(el("g", { z: 1, a: 2, m: 3 })).toBe('<g z="1" a="2" m="3"/>');
  });

  it("es determinista: mismas entradas, mismo string", () => {
    fc.assert(
      fc.property(
        fc.string(),
        fc.double({ min: -1000, max: 1000, noNaN: true }),
        (id, r) => {
          const attrs: Attrs = { id, r };
          expect(el("circle", attrs)).toBe(el("circle", attrs));
        },
      ),
    );
  });
});

describe("text — la única vía para texto plano", () => {
  it("escapa el contenido", () => {
    expect(text("<b>")).toBe("<text>&lt;b&gt;</text>");
  });

  it("acepta atributos como cualquier elemento", () => {
    expect(text("hola", { x: 1, y: 2 })).toBe('<text x="1" y="2">hola</text>');
  });
});

describe("svg — el elemento raíz", () => {
  it("lleva namespace y viewBox", () => {
    const out = svg(100, 50, []);
    expect(out).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(out).toContain('viewBox="0 0 100 50"');
    expect(out).toContain('width="100"');
    expect(out).toContain('height="50"');
  });

  it("envuelve a los hijos", () => {
    expect(svg(10, 10, [el("circle", { r: 1 })])).toContain("<circle r=\"1\"/>");
  });

  it("deja sobrescribir atributos propios", () => {
    expect(svg(10, 10, [], { class: "replay" })).toContain('class="replay"');
  });
});

describe("pointsAttr — vértices de un polígono", () => {
  it("emite pares x,y separados por espacio", () => {
    expect(
      pointsAttr([
        { x: 0, y: 1 },
        { x: 2.5, y: -3 },
      ]),
    ).toBe("0,1 2.5,-3");
  });

  it("aplica la precisión de svgNumber a las coordenadas", () => {
    expect(pointsAttr([{ x: 1 / 3, y: -0 }])).toBe("0.333,0");
  });

  it("da string vacío sin vértices", () => {
    expect(pointsAttr([])).toBe("");
  });
});
