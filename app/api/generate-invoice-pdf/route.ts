import { NextRequest, NextResponse } from "next/server";
import puppeteer from "puppeteer";

export async function POST(request: NextRequest) {
  try {
    const { html, filename } = await request.json();

    if (!html) {
      return NextResponse.json({ error: "HTML content is required" }, { status: 400 });
    }

    // Launch Puppeteer
    const browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });

    const page = await browser.newPage();

    // Set content
    await page.setContent(html, { waitUntil: "load" });


    // Generate PDF
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

    await browser.close();

    // Return PDF as response
    return new Response(pdf, {
  status: 200,
  headers: {
    "Content-Type": "application/pdf",
    "Content-Disposition": `attachment; filename="${filename || "invoice.pdf"}"`,
  },
});

 return new Response(pdf, {
  status: 200,
  headers: {
    "Content-Type": "application/pdf",
    "Content-Disposition": `attachment; filename="${filename || "invoice.pdf"}"`,
  },
});
} catch (error) {
  console.error("PDF generation error:", error);
  return Response.json({ error: "Failed to generate PDF" }, { status: 500 });
}
}
