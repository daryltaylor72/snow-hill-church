export async function onRequestPost(context) {
    const { request, env } = context;
    const headers = {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store'
    };

    let body;
    try {
        body = await request.json();
    } catch {
        return new Response(JSON.stringify({ error: 'Invalid request' }), { status: 400, headers });
    }

    const { name, email, subject, message, website } = body;
    if (website) {
        return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
    }

    const cleanName = typeof name === 'string' ? name.trim() : '';
    const cleanEmail = typeof email === 'string' ? email.trim() : '';
    const cleanSubject = typeof subject === 'string' ? subject.trim() : '';
    const cleanMessage = typeof message === 'string' ? message.trim() : '';

    if (!cleanName || !cleanEmail || !cleanMessage) {
        return new Response(JSON.stringify({ error: 'Missing required fields' }), { status: 400, headers });
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
        return new Response(JSON.stringify({ error: 'Invalid email address' }), { status: 400, headers });
    }

    if (cleanName.length > 120 || cleanEmail.length > 254 || cleanSubject.length > 180 || cleanMessage.length > 5000) {
        return new Response(JSON.stringify({ error: 'Form input too long' }), { status: 400, headers });
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
