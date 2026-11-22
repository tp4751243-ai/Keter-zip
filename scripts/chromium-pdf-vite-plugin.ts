import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Plugin } from 'vite';

const escapeHtml = (value: unknown) => String(value ?? '').replace(/[&<>"]/g, ch => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;',
}[ch]!));

const fontFamily = (name: string) => {
  const value = String(name || '').toLowerCase();
  if (value.includes('david')) return '"Keter David Libre"';
  if (value.includes('rashi') || value.includes('noto')) return '"Keter Frank Ruhl"';
  return '"Keter Frank Ruhl"';
};

export function chromiumPdfPlugin(): Plugin {
  return {
    name: 'keter-chromium-pdf',
    configureServer(server) {
      server.middlewares.use('/__keter/chromium-pdf', async (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.setHeader('Allow', 'POST');
          res.end('Method Not Allowed');
          return;
        }

        let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
        try {
          const chunks: Buffer[] = [];
          for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          const pages = payload.pages;
          if (!Array.isArray(pages) || pages.length === 0) throw new Error('לא התקבלו עמודים לייצוא.');
          const geometry = pages[0].geometry;
          if (!geometry || !(geometry.pageWidth > 0) || !(geometry.pageHeight > 0)) {
            throw new Error('מידות העמוד חסרות או אינן תקינות.');
          }

          const fontDir = path.resolve(process.cwd(), 'public/fonts');
          const [regular, bold, david] = await Promise.all([
            readFile(path.join(fontDir, 'FrankRuhlLibre-Regular.ttf')),
            readFile(path.join(fontDir, 'FrankRuhlLibre-Bold.ttf')),
            readFile(path.join(fontDir, 'DavidLibre-Regular.ttf')),
          ]);
          const fonts = {
            regular: regular.toString('base64'),
            bold: bold.toString('base64'),
            david: david.toString('base64'),
          };

          const pageHtml = pages.map((entry: any, pageIndex: number) => {
            const g = entry.geometry || geometry;
            const plan = entry.plan;
            if (!plan || !Array.isArray(plan.lines)) throw new Error(`תוכנית העימוד של עמוד ${pageIndex + 1} חסרה.`);
            const words = plan.lines.flatMap((line: any) => (line.words || []).map((word: any) => {
              const right = g.pageWidth - word.xRight;
              const color = word.textColor || line.textColor || '#111';
              const weight = word.fontWeight || line.baseFontWeight || 400;
              return '<span class="word" style="right:' + right + 'pt;top:' + word.yBaseline +
                'pt;width:' + word.width + 'pt;font-family:' + escapeHtml(fontFamily(word.fontFamily || line.fontFamily)) +
                ';font-size:' + word.fontSizePt + 'pt;font-weight:' + weight +
                ';color:' + escapeHtml(color) + ';transform:translateY(-0.82em)">' +
                escapeHtml(word.text) + '</span>';
            })).join('');
            // v0.8.0 Part E: image-only pages — draw the plan's images
            // fitted into the content area (object-contain), like the
            // canvas preview and the native PDF path.
            let images = '';
            if (plan.isImageOnlyPage && Array.isArray(plan.pageImages) && plan.pageImages.length > 0) {
              const mTop = g.marginTop || 0;
              const mBottom = g.marginBottom || 0;
              const mLeft = g.marginInside || 0;
              const mRight = g.marginOutside || 0;
              const contentW = g.pageWidth - mLeft - mRight;
              const contentH = g.pageHeight - mTop - mBottom;
              const gap = 12;
              const slotH = (contentH - gap * (plan.pageImages.length - 1)) / plan.pageImages.length;
              images = plan.pageImages.map((img: any, i: number) => {
                if (!img || !img.dataUrl) return '';
                const top = mTop + i * (slotH + gap);
                const caption = img.altText
                  ? '<div style="position:absolute;left:0;right:0;top:' + (top + slotH - 14) + 'pt;text-align:center;font-size:10pt;color:#5C5346;font-style:italic">' + escapeHtml(img.altText) + '</div>'
                  : '';
                return '<img src="' + img.dataUrl + '" alt="' + escapeHtml(img.altText || '') + '" style="position:absolute;left:' + mLeft + 'pt;top:' + top + 'pt;width:' + contentW + 'pt;height:' + (slotH - (img.altText ? 14 : 0)) + 'pt;object-fit:contain" />' + caption;
              }).join('');
            }
            return '<section class="page" style="width:' + g.pageWidth + 'pt;height:' + g.pageHeight +
              'pt;break-after:' + (pageIndex === pages.length - 1 ? 'auto' : 'page') + '">' + words + images + '</section>';
          }).join('');

          const html = `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><style>
            @font-face{font-family:"Keter Frank Ruhl";src:url(data:font/ttf;base64,${fonts.regular}) format("truetype");font-weight:400}
            @font-face{font-family:"Keter Frank Ruhl";src:url(data:font/ttf;base64,${fonts.bold}) format("truetype");font-weight:600 900}
            @font-face{font-family:"Keter David Libre";src:url(data:font/ttf;base64,${fonts.david}) format("truetype");font-weight:400}
            @page{size:${geometry.pageWidth}pt ${geometry.pageHeight}pt;margin:0}
            *{box-sizing:border-box}html,body{margin:0;padding:0;background:#fff;color:#111}
            .page{position:relative;overflow:hidden;background:#fff;break-inside:avoid}
            .word{position:absolute;display:block;white-space:pre;direction:rtl;unicode-bidi:isolate;text-align:right;line-height:1;overflow:visible}
          </style></head><body>${pageHtml}</body></html>`;

          browser = await chromium.launch({ headless: true });
          const page = await browser.newPage();
          await page.setContent(html, { waitUntil: 'load' });
          await page.evaluate(() => document.fonts.ready);
          const pdf = await page.pdf({
            preferCSSPageSize: true,
            printBackground: true,
            tagged: true,
            displayHeaderFooter: false,
          });
          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/pdf');
          res.setHeader('Content-Disposition', 'attachment; filename="keter-chromium-export.pdf"');
          res.setHeader('Content-Length', String(pdf.length));
          res.end(pdf);
        } catch (error) {
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
        } finally {
          await browser?.close().catch(() => undefined);
        }
      });
    },
  };
}
