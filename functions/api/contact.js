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

    const contentType = request.headers.get('content-type') || '';
    if (!contentType.toLowerCase().includes('application/json')) {
        return fail('Unsupported content type', 415);
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
        return fail('Invalid request origin', 403);
    }

    if (!allowedOrigins.has(sourceOrigin)) {
        return fail('Origin not allowed', 403);
    }

    let body;
    try {
        body = await request.json();
    } catch {
        return fail('Invalid request');
    }

    const { name, email, subject, message, turnstileToken } = body;

    const cleanName = typeof name === 'string' ? name.trim() : '';
    const cleanEmail = typeof email === 'string' ? email.trim() : '';
    const cleanSubject = typeof subject === 'string' ? subject.trim() : '';
    const cleanMessage = typeof message === 'string' ? message.trim() : '';

    if (!cleanName || !cleanEmail || !cleanMessage) {
        return fail('Missing required fields');
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
        return fail('Invalid email address');
    }

    if (cleanName.length > 120 || cleanEmail.length > 254 || cleanSubject.length > 180 || cleanMessage.length > 5000) {
        return fail('Form input too long');
    }

    if (env.TURNSTILE_SECRET_KEY) {
        if (typeof turnstileToken !== 'string' || !turnstileToken.trim()) {
            return fail('Verification required', 403);
        }

        const formData = new URLSearchParams();
        formData.set('secret', env.TURNSTILE_SECRET_KEY);
        formData.set('response', turnstileToken.trim());
        const clientIp = request.headers.get('CF-Connecting-IP');
        if (clientIp) {
            formData.set('remoteip', clientIp);
        }

        const verification = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
            method: 'POST',
            body: formData
        });
        const verificationResult = await verification.json();
        if (!verification.ok || !verificationResult.success) {
            return fail('Verification failed', 403);
        }
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
        return new Response(JSON.stringify({ error: 'Failed to send email' }), { status: 500, headers });
    }

    return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
}
