export async function onRequestPost(context) {
    const { request, env } = context;
    const allowedOrigins = new Set([
        'https://snowhillmbc.com',
        'https://www.snowhillmbc.com',
        'https://snowhillmissionarybaptistchurch.org',
        'https://www.snowhillmissionarybaptistchurch.org'
    ]);
    const headers = {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store'
    };
    const fail = (message, status = 400) =>
        new Response(JSON.stringify({ error: message }), { status, headers });
    const acceptsHtml = (request.headers.get('accept') || '').includes('text/html');
    const redirectWithStatus = (kind, message, status = 303) => {
        const url = new URL(request.url);
        url.pathname = '/';
        url.hash = 'contact';
        url.searchParams.set('contact', kind);
        if (message) {
            url.searchParams.set('message', message);
        }
        return Response.redirect(url.toString(), status);
    };
    const failResponse = (message, status = 400) =>
        acceptsHtml ? redirectWithStatus('error', message) : fail(message, status);

    const contentType = request.headers.get('content-type') || '';
    const isJson = contentType.toLowerCase().includes('application/json');
    const isForm = contentType.toLowerCase().includes('application/x-www-form-urlencoded') || contentType.toLowerCase().includes('multipart/form-data');
    if (!isJson && !isForm) {
        return failResponse('Unsupported content type', 415);
    }

    const origin = request.headers.get('origin');
    const referer = request.headers.get('referer');
    const source = origin || referer;
    if (!source) {
        return fail('Missing request origin', 403);
    }

    let sourceOrigin = '';
    try {
        sourceOrigin = new URL(source).origin;
    } catch {
        return failResponse('Invalid request origin', 403);
    }

    if (!allowedOrigins.has(sourceOrigin)) {
        return failResponse('Origin not allowed', 403);
    }

    let body;
    try {
        if (isJson) {
            body = await request.json();
        } else {
            const formData = await request.formData();
            body = {
                name: formData.get('name'),
                email: formData.get('email'),
                subject: formData.get('subject'),
                message: formData.get('message')
            };
        }
    } catch {
        return failResponse('Invalid request');
    }

    const { name, email, subject, message } = body;

    const cleanName = typeof name === 'string' ? name.trim() : '';
    const cleanEmail = typeof email === 'string' ? email.trim() : '';
    const cleanSubject = typeof subject === 'string' ? subject.trim() : '';
    const cleanMessage = typeof message === 'string' ? message.trim() : '';

    if (!cleanName || !cleanEmail || !cleanMessage) {
        return failResponse('Missing required fields');
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
        return failResponse('Invalid email address');
    }

    if (cleanName.length > 120 || cleanEmail.length > 254 || cleanSubject.length > 180 || cleanMessage.length > 5000) {
        return failResponse('Form input too long');
    }

    const escapeHtml = (value) =>
        value
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');

    const safeName = escapeHtml(cleanName);
    const safeEmail = escapeHtml(cleanEmail);
    const safeSubject = escapeHtml(cleanSubject || '(none)');
    const safeMessage = escapeHtml(cleanMessage).replace(/\n/g, '<br>');

    const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${env.RESEND_API_KEY}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            from: 'Snow Hill MBC Website <noreply@snowhillmbc.com>',
            to: ['info@snowhillmbc.com'],
            reply_to: cleanEmail,
            subject: cleanSubject ? `Contact Form: ${cleanSubject}` : `Contact Form Message from ${cleanName}`,
            html: `
                <h2>New Contact Form Submission</h2>
                <p><strong>Name:</strong> ${safeName}</p>
                <p><strong>Email:</strong> ${safeEmail}</p>
                <p><strong>Subject:</strong> ${safeSubject}</p>
                <p><strong>Message:</strong></p>
                <p>${safeMessage}</p>
            `
        })
    });

    if (!res.ok) {
        const err = await res.text();
        console.error('Resend error:', err);
        return acceptsHtml
            ? redirectWithStatus('error', 'Failed to send email')
            : new Response(JSON.stringify({ error: 'Failed to send email' }), { status: 500, headers });
    }

    return acceptsHtml
        ? redirectWithStatus('success', 'Message sent')
        : new Response(JSON.stringify({ ok: true }), { status: 200, headers });
}
