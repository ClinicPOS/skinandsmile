import { NextRequest } from "next/server";
import puppeteer from "puppeteer";

function makeAbsoluteAssetUrls(html: string, baseUrl: string) {
  return html.replace(/\b(src)=(["'])([^"']+)\2/gi, (_match, attribute, quote, value) => {
    if (!value || /^(https?:)?\/\//i.test(value) || value.startsWith("data:") || value.startsWith("mailto:") || value.startsWith("#")) {
      return `${attribute}=${quote}${value}${quote}`;
    }

    const absoluteUrl = new URL(value, baseUrl).toString();
    return `${attribute}=${quote}${absoluteUrl}${quote}`;
  });
}

export async function POST(request: NextRequest) {
  try {
    const { html, filename } = await request.json();

    if (!html) {
      return Response.json({ error: "HTML content is required" }, { status: 400 });
    }

    const baseUrl = new URL(request.url).origin;
    const browserLaunchOptions = {
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || process.env.CHROME_BIN || process.env.CHROMIUM_PATH || undefined,
    };

    const browser = await puppeteer.launch(browserLaunchOptions);
    try {
      const page = await browser.newPage();
      const htmlWithAbsoluteAssets = makeAbsoluteAssetUrls(html, baseUrl);

      await page.setContent(htmlWithAbsoluteAssets, { waitUntil: "domcontentloaded" });
      await page.evaluate(async () => {
        await Promise.all(Array.from(document.images).map((img) => {
          if (img.complete) return Promise.resolve();
          return new Promise<void>((resolve) => {
            img.addEventListener("load", () => resolve(), { once: true });
            img.addEventListener("error", () => resolve(), { once: true });
          });
        }));
      });

      const pdf = await page.pdf({
        format: "A4",
        margin: {
          top: "10mm",
          right: "10mm",
          bottom: "10mm",
          left: "10mm",
        },
        printBackground: true,
      });

      return new Response(Buffer.from(pdf), {
        status: 200,
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="${filename || "invoice.pdf"}"`,
        },
      });
    } finally {
      await browser.close();
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Failed to generate PDF";
    console.error("PDF generation error:", error);
    return Response.json({ error: errorMessage }, { status: 500 });
  }
}
