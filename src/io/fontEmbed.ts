/**
 * Fonts for exported SVG / PNG / PDF.
 *
 * The exporter rasterises the backend's SVG through a Blob URL (`new Image()`),
 * which is a *separate document*: the app's `@font-face` rules do not apply
 * there. Without embedding the binaries the exported text silently falls back
 * to a system face and no longer matches the canvas.  Both families are SIL
 * OFL-1.1 (licence texts ship in `public/fonts/`).
 */
interface Face {
  family: string;
  file: string;
  weight: string;
}

/** Keep in sync with the `@font-face` block at the top of `src/styles.css`. */
const FACES: Face[] = [
  { family: 'Montserrat', file: 'Montserrat-latin.woff2', weight: '100 900' },
  { family: 'Open Sans', file: 'OpenSans-latin.woff2', weight: '300 800' },
  { family: 'NeverMind', file: 'NeverMind-Regular.woff2', weight: '400' },
  { family: 'NeverMind', file: 'NeverMind-Medium.woff2', weight: '500 600' },
  { family: 'NeverMind', file: 'NeverMind-Bold.woff2', weight: '700 900' },
  { family: 'NeverMindHand', file: 'NeverMindHand-Regular.woff2', weight: '400' },
  { family: 'NeverMind Condensed', file: 'NeverMindCondensed-Regular.woff2', weight: '400' },
];

function base64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk));
  }
  return btoa(binary);
}

let cached: Promise<string> | null = null;

/** `<style>` with every face as a data URI, or `''` when a font is missing. */
function fontStyle(): Promise<string> {
  if (!cached) {
    cached = (async () => {
      const rules = await Promise.all(FACES.map(async (face) => {
        try {
          const response = await fetch(`/fonts/${face.file}`);
          if (!response.ok) return '';
          const bytes = new Uint8Array(await response.arrayBuffer());
          return `@font-face{font-family:'${face.family}';`
            + `src:url(data:font/woff2;base64,${base64(bytes)}) format('woff2');`
            + `font-style:normal;font-weight:${face.weight}}`;
        } catch {
          return '';
        }
      }));
      const css = rules.filter(Boolean).join('\n');
      return css ? `<style type="text/css"><![CDATA[\n${css}\n]]></style>` : '';
    })().catch(() => '');
  }
  return cached;
}

/** Inject the faces right after the root `<svg>` tag. */
export async function embedFonts(svg: string): Promise<string> {
  const style = await fontStyle();
  if (!style) return svg;
  return svg.replace(/<svg\b[^>]*>/, (tag) => `${tag}\n${style}`);
}
