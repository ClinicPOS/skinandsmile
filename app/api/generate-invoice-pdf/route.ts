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
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    const { html, filename } = await request.json();

    if (!html) {
      return Response.json({ error: "HTML content is required" }, { status: 400 });
    }

    const baseUrl = new URL(request.url).origin;
    const page = await browser.newPage();
    const htmlWithAbsoluteAssets = makeAbsoluteAssetUrls(html, baseUrl);

    await page.setContent(htmlWithAbsoluteAssets, { waitUntil: "load" });

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
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Failed to generate PDF";
    console.error("PDF generation error:", error);
    return Response.json({ error: errorMessage }, { status: 500 });
  } finally {
    await browser.close();
  }
}
