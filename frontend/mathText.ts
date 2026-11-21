import mathJaxUrl from "mathjax/es5/tex-svg.js?url";

interface MathJax {
  startup: { promise: Promise<unknown> };
  tex2svgPromise: (text: string) => Promise<HTMLElement>;
}

let ready: Promise<MathJax> | undefined;
export function loadMathJax() {
  return ready ??= new Promise<MathJax>((resolve, reject) => {
    const page = window as Window & { MathJax?: unknown };
    page.MathJax = { startup: { typeset: false }, svg: { fontCache: "none" } };
    const script = document.createElement("script");
    script.src = mathJaxUrl;
    script.onload = () => {
      const math = page.MathJax as MathJax;
      math.startup.promise.then(() => resolve(math), reject);
    };
    script.onerror = () => reject(new Error("Could not load MathJax."));
    document.head.append(script);
  });
}
