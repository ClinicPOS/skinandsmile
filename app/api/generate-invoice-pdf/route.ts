import { NextRequest } from "next/server";
import puppeteer from "puppeteer";
import {invoiceAssetAllowed} from '../../../lib/invoice-asset-policy';
import {readAppSession,createServerSupabaseClient} from '../../../lib/api-session';

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
  const {session,errorResponse}=await readAppSession(createServerSupabaseClient());
  if(!session)return errorResponse!;
  if(session.userRole!=='owner'&&(session.userRole!=='receptionist'||!session.receptionistId))return Response.json({error:'Sign in as a receptionist before printing invoices.'},{status:403});
  try {
    const { html, filename } = await request.json();

    if (typeof html!=='string'||!html||html.length>2000000) {
      return Response.json({ error: "HTML content is required" }, { status: 400 });
    }

    const baseUrl = new URL(request.url).origin;
    const browserLaunchOptions = {
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || process.env.CHROME_BIN || process.env.CHROMIUM_PATH || undefined,
      timeout: 15000,
    };

    const browser = await puppeteer.launch(browserLaunchOptions);
    try {
      const page = await browser.newPage();
      await page.setJavaScriptEnabled(false);
      page.setDefaultTimeout(10000);
      await page.setRequestInterception(true);
      page.on('request',resource=>{
        if(invoiceAssetAllowed(resource.url(),resource.resourceType(),resource.method(),baseUrl,process.env.NEXT_PUBLIC_SUPABASE_URL))void resource.continue();
        else void resource.abort();
      });
      const htmlWithAbsoluteAssets = makeAbsoluteAssetUrls(html, baseUrl);

      await page.setContent(htmlWithAbsoluteAssets, { waitUntil: "domcontentloaded" });
      // JavaScript is disabled for untrusted invoice HTML; wait for allowed assets without evaluating page scripts.
      await page.waitForNetworkIdle({ idleTime: 250, timeout: 5000 }).catch(error => {
        if (!(error instanceof Error) || error.name !== 'TimeoutError') throw error;
      });

      const pdf = await page.pdf({
        format: "A4",
        waitForFonts: false,
        timeout: 10000,
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
          "Content-Disposition": `attachment; filename="${typeof filename==='string'?filename.replace(/[^a-zA-Z0-9._-]/g,'_').slice(0,120)||'invoice.pdf':'invoice.pdf'}"`,
        },
      });
    } finally {
      await browser.close();
    }
  } catch (error) {
    console.error("PDF generation failed",{type:error instanceof Error?error.name:'Unknown'});
    return Response.json({ error: 'Invoice PDF could not be generated. Please try again.' }, { status: 500 });
  }
}
