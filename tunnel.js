const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const urlFile = path.join(__dirname, 'public_url.txt');

function startTunnel() {
  console.log('[Tunnel] Establishing persistent SSH tunnel via localhost.run...');
  const proc = spawn('ssh', [
    '-R', '80:localhost:3000',
    '-o', 'ServerAliveInterval=15',
    '-o', 'ServerAliveCountMax=3',
    '-o', 'StrictHostKeyChecking=no',
    'nokey@localhost.run'
  ]);

  proc.stdout.on('data', (data) => {
    const text = data.toString();
    process.stdout.write(text);
    const match = text.match(/https:\/\/[a-z0-9]+\.lhr\.life/);
    if (match) {
      const url = match[0];
      console.log(`\n==============================================`);
      console.log(`>>> [Tunnel] LIVE PUBLIC URL: ${url} <<<`);
      console.log(`==============================================\n`);
      fs.writeFileSync(urlFile, url, 'utf8');
    }
  });

  proc.stderr.on('data', (data) => {
    process.stderr.write(data.toString());
  });

  proc.on('close', (code) => {
    console.log(`[Tunnel] Connection closed (code ${code}). Auto-reconnecting in 3 seconds...`);
    setTimeout(startTunnel, 3000);
  });

  proc.on('error', (err) => {
    console.error('[Tunnel] Error:', err.message);
    setTimeout(startTunnel, 5000);
  });
}

startTunnel();
