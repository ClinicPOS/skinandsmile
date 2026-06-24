import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { to, subject, html } = body;

    if (!to || !subject || !html) {
      return NextResponse.json(
        { error: 'Missing required fields: to, subject, html' },
        { status: 400 }
      );
    }

    const mailgunDomain = process.env.NEXT_PUBLIC_MAILGUN_DOMAIN;
    const mailgunApiKey = process.env.MAILGUN_API_KEY;

    if (!mailgunDomain || !mailgunApiKey) {
      return NextResponse.json(
        { error: 'Mailgun credentials not configured' },
        { status: 500 }
      );
    }

    console.log('Mailgun config:', { domain: mailgunDomain, keyLength: mailgunApiKey?.length });

    const params = new URLSearchParams();
    params.append('from', `Skin & Smile Dental Clinic <noreply@${mailgunDomain}>`);
    params.append('to', to);
    params.append('subject', subject);
    params.append('html', html);

    const mailgunUrl = `https://api.mailgun.net/v3/${mailgunDomain}/messages`;
    const auth = `api:${mailgunApiKey}`;
    const encodedAuth = Buffer.from(auth).toString('base64');

    console.log('Sending email to:', to);
    console.log('Mailgun URL:', mailgunUrl);

    const response = await fetch(mailgunUrl, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${encodedAuth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });

    if (!response.ok) {
      const contentType = response.headers.get('content-type') || 'unknown';
      const errorText = await response.text();
      console.error('Mailgun error response:', {
        status: response.status,
        statusText: response.statusText,
        contentType,
        body: errorText,
      });
      return NextResponse.json(
        {
          error: 'Failed to send email',
          status: response.status,
          statusText: response.statusText,
          details: errorText || 'No response body returned from Mailgun',
        },
        { status: response.status }
      );
    }

    const result = await response.json();
    console.log('Email sent successfully:', result.id);
    return NextResponse.json(
      { success: true, messageId: result.id },
      { status: 200 }
    );
  } catch (error) {
    console.error('Send invoice error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
